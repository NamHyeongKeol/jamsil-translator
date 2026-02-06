import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import 'dotenv/config';

const PORT = 3001;
const GLADIA_API_URL = 'https://api.gladia.io/v2/live';
const DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen';
const FIREWORKS_WS_URL = 'wss://audio-streaming.api.fireworks.ai/v1/audio/transcriptions/streaming';
const SONIOX_WS_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';

const server = createServer();
const wss = new WebSocketServer({ server });

console.log('Starting STT WebSocket proxy server...');

interface ClientConfig {
    sample_rate: number;
    languages: string[];
    stt_model: 'gladia' | 'gladia-stt' | 'deepgram' | 'deepgram-multi' | 'fireworks' | 'soniox';
}

wss.on('connection', (clientWs) => {
    console.log('Client connected to proxy');

    let sttWs: WebSocket | null = null;
    let isClientConnected = true;
    let abortController: AbortController | null = null;
    let currentModel: 'gladia' | 'gladia-stt' | 'deepgram' | 'deepgram-multi' | 'fireworks' | 'soniox' = 'gladia';

    const gladiaApiKey = process.env.GLADIA_API_KEY;
    const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
    const fireworksApiKey = process.env.FIREWORKS_API_KEY;
    const sonioxApiKey = process.env.SONIOX_API_KEY;

    const cleanup = () => {
        isClientConnected = false;
        
        // 진행 중인 fetch 요청 취소
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
        
        // STT WebSocket 연결 정리 (모든 상태에서)
        if (sttWs) {
            if (sttWs.readyState === WebSocket.OPEN || sttWs.readyState === WebSocket.CONNECTING) {
                sttWs.close();
            }
            sttWs = null;
        }
    };

    // ===== GLADIA 연결 =====
    const startGladiaConnection = async (config: ClientConfig, enableTranslation = true) => {
        if (!gladiaApiKey) {
            console.error("GLADIA_API_KEY environment variable not set!");
            clientWs.close(1011, "Server configuration error: Gladia API key not found.");
            return;
        }

        try {
            abortController = new AbortController();
            
            console.log(`Requesting Gladia audio URL with languages: ${config.languages}, translation: ${enableTranslation}`);
            const requestBody: Record<string, unknown> = {
                sample_rate: config.sample_rate,
                encoding: 'wav/pcm',
                bit_depth: 16,
                channels: 1,
                model: 'solaria-1',
                language_config: {
                    languages: config.languages,
                    code_switching: config.languages.length > 1,
                },
                endpointing: 0.05,
                maximum_duration_without_endpointing: 15,
                messages_config: {
                    receive_partial_transcripts: true,
                },
            };

            if (enableTranslation) {
                requestBody.realtime_processing = {
                    translation: true,
                    translation_config: {
                        target_languages: config.languages,
                        model: 'enhanced',
                    },
                };
            }

            const response = await fetch(GLADIA_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-gladia-key': gladiaApiKey,
                },
                body: JSON.stringify(requestBody),
                signal: abortController.signal,
            });

            if (!isClientConnected) {
                console.log('Client already disconnected, aborting Gladia connection');
                return;
            }

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Failed to get Gladia URL: ${response.status} ${response.statusText} - ${errorBody}`);
            }

            const data = await response.json() as { url?: string };
            console.log("Full response from Gladia:", data);
            const gladiaWsUrl = data.url;

            if (!gladiaWsUrl) {
                throw new Error('No url in Gladia response');
            }

            if (!isClientConnected) {
                console.log('Client already disconnected, aborting Gladia WebSocket connection');
                return;
            }

            console.log('Got Gladia URL, connecting to WebSocket...');
            sttWs = new WebSocket(gladiaWsUrl);

            sttWs.onopen = () => {
                console.log('Proxy connected to Gladia WebSocket');
                if (isClientConnected) {
                    clientWs.send(JSON.stringify({ status: 'ready' }));
                } else {
                    sttWs?.close();
                }
            };

            sttWs.onmessage = (event) => {
                if (isClientConnected) {
                    const msg = JSON.parse(event.data.toString());
                    if (msg.type === 'transcript') {
                        console.log(`[Gladia] transcript is_final=${msg.data?.is_final}, lang=${msg.data?.utterance?.language}, text="${msg.data?.utterance?.text?.slice(0, 20)}..."`);
                    } else if (msg.type === 'translation') {
                        console.log(`[Gladia] translation target=${msg.data?.target_language}, text="${msg.data?.translated_utterance?.text?.slice(0, 20)}..."`);
                    } else if (msg.type !== 'audio_chunk') {
                        console.log(`[Gladia] ${msg.type}`);
                    }
                    clientWs.send(event.data.toString());
                }
            };

            sttWs.onerror = (error) => {
                console.error('Gladia WebSocket error:', error);
                if (isClientConnected) {
                    clientWs.close();
                }
            };

            sttWs.onclose = (event) => {
                console.log('Gladia connection closed:', event.code, event.reason);
                if (isClientConnected) {
                    clientWs.close();
                }
            };

        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                console.log('Gladia connection request was aborted');
                return;
            }
            console.error('Error starting Gladia connection:', error);
            if (isClientConnected) {
                clientWs.close(1011, 'Failed to connect to transcription service.');
            }
        }
    };

    // ===== DEEPGRAM 연결 =====
    const startDeepgramConnection = async (config: ClientConfig) => {
        if (!deepgramApiKey) {
            console.error("DEEPGRAM_API_KEY environment variable not set!");
            clientWs.close(1011, "Server configuration error: Deepgram API key not found.");
            return;
        }

        try {
            // Deepgram 언어 코드 매핑 (일부 언어는 다른 형식 필요)
            const langMap: Record<string, string> = {
                'en': 'en-US',
                'ko': 'ko',
                'zh': 'zh-CN',
                'ja': 'ja',
                'es': 'es',
                'fr': 'fr',
                'de': 'de',
                'ru': 'ru',
                'pt': 'pt-BR',
                'ar': 'ar',
                'hi': 'hi',
                'vi': 'vi',
                'it': 'it',
                'id': 'id',
                'tr': 'tr',
                'pl': 'pl',
                'nl': 'nl',
                'sv': 'sv',
                'th': 'th',
                'ms': 'ms',
            };

            const primaryLang = langMap[config.languages[0]] || 'en-US';
            
            // Deepgram WebSocket URL 생성
            const wsUrl = new URL(DEEPGRAM_WS_URL);
            wsUrl.searchParams.set('model', 'nova-3');  // 최신 모델 - 더 높은 정확도 + 다국어 코드 스위칭
            wsUrl.searchParams.set('encoding', 'linear16');
            wsUrl.searchParams.set('sample_rate', config.sample_rate.toString());
            wsUrl.searchParams.set('channels', '1');
            wsUrl.searchParams.set('interim_results', 'true');
            wsUrl.searchParams.set('punctuate', 'true');
            wsUrl.searchParams.set('smart_format', 'true');
            wsUrl.searchParams.set('endpointing', '100'); // ms
            
            // 항상 첫 번째 선택된 언어로 지정 (detect_language는 스트리밍에서 400 에러 유발)
            wsUrl.searchParams.set('language', primaryLang);

            console.log('Connecting to Deepgram with URL:', wsUrl.toString());
            console.log('Language:', primaryLang);

            sttWs = new WebSocket(wsUrl.toString(), {
                headers: {
                    'Authorization': `Token ${deepgramApiKey}`,
                },
            });

            sttWs.onopen = () => {
                console.log('Proxy connected to Deepgram WebSocket');
                if (isClientConnected) {
                    clientWs.send(JSON.stringify({ status: 'ready' }));
                } else {
                    sttWs?.close();
                }
            };

            sttWs.onmessage = (event) => {
                if (isClientConnected) {
                    try {
                        const msg = JSON.parse(event.data.toString());
                        
                        // Deepgram 응답 형식을 Gladia 형식으로 변환
                        if (msg.type === 'Results' || msg.channel) {
                            const channel = msg.channel;
                            const alternatives = channel?.alternatives;
                            if (alternatives && alternatives.length > 0) {
                                const transcript = alternatives[0].transcript;
                                const isFinal = msg.is_final;
                                // Deepgram multi 모드에서 감지된 언어
                                const detectedLang = alternatives[0].detected_language || 
                                                     channel?.detected_language || 
                                                     msg.metadata?.detected_language ||
                                                     config.languages[0] || 'en';
                                
                                if (transcript) {
                                    // Gladia 형식으로 변환하여 클라이언트에 전송
                                    const gladiaStyleMsg = {
                                        type: 'transcript',
                                        data: {
                                            is_final: isFinal,
                                            utterance: {
                                                text: transcript,
                                                language: detectedLang,
                                            },
                                        },
                                    };
                                    
                                    console.log(`[Deepgram] transcript is_final=${isFinal}, lang=${detectedLang}, text="${transcript.slice(0, 30)}..."`);
                                    clientWs.send(JSON.stringify(gladiaStyleMsg));
                                }
                            }
                        } else if (msg.type === 'Metadata') {
                            console.log('[Deepgram] Metadata received:', msg);
                        } else if (msg.type === 'UtteranceEnd') {
                            console.log('[Deepgram] Utterance ended');
                        }
                    } catch (parseError) {
                        console.error('Error parsing Deepgram message:', parseError);
                    }
                }
            };

            sttWs.onerror = (error) => {
                console.error('Deepgram WebSocket error:', error);
                if (isClientConnected) {
                    clientWs.close();
                }
            };

            sttWs.onclose = (event) => {
                console.log('Deepgram connection closed:', event.code, event.reason);
                if (isClientConnected) {
                    clientWs.close();
                }
            };

        } catch (error) {
            console.error('Error starting Deepgram connection:', error);
            if (isClientConnected) {
                clientWs.close(1011, 'Failed to connect to Deepgram transcription service.');
            }
        }
    };

    // ===== DEEPGRAM MULTI 연결 (다국어 코드 스위칭) =====
    const startDeepgramMultiConnection = async (config: ClientConfig) => {
        if (!deepgramApiKey) {
            console.error("DEEPGRAM_API_KEY environment variable not set!");
            clientWs.close(1011, "Server configuration error: Deepgram API key not found.");
            return;
        }

        try {
            // Deepgram WebSocket URL 생성 - multi 언어 모드
            const wsUrl = new URL(DEEPGRAM_WS_URL);
            wsUrl.searchParams.set('model', 'nova-3');
            wsUrl.searchParams.set('encoding', 'linear16');
            wsUrl.searchParams.set('sample_rate', config.sample_rate.toString());
            wsUrl.searchParams.set('channels', '1');
            wsUrl.searchParams.set('interim_results', 'true');
            wsUrl.searchParams.set('punctuate', 'true');
            wsUrl.searchParams.set('smart_format', 'true');
            wsUrl.searchParams.set('endpointing', '100');

            // multi 언어 모드: 여러 언어를 자동 감지하여 전사
            wsUrl.searchParams.set('language', 'multi');

            console.log('Connecting to Deepgram Multi with URL:', wsUrl.toString());
            console.log('Languages (multi mode):', config.languages);

            sttWs = new WebSocket(wsUrl.toString(), {
                headers: {
                    'Authorization': `Token ${deepgramApiKey}`,
                },
            });

            sttWs.onopen = () => {
                console.log('Proxy connected to Deepgram Multi WebSocket');
                if (isClientConnected) {
                    clientWs.send(JSON.stringify({ status: 'ready' }));
                } else {
                    sttWs?.close();
                }
            };

            sttWs.onmessage = (event) => {
                if (isClientConnected) {
                    try {
                        const msg = JSON.parse(event.data.toString());

                        if (msg.type === 'Results' || msg.channel) {
                            const channel = msg.channel;
                            const alternatives = channel?.alternatives;
                            if (alternatives && alternatives.length > 0) {
                                const transcript = alternatives[0].transcript;
                                const isFinal = msg.is_final;

                                // multi 모드 언어 감지 우선순위:
                                // 1) alternatives[0].languages: 이 utterance에서 감지된 언어 배열
                                // 2) channel.languages: channel 레벨 감지 언어 배열
                                // 3) word[0].language: 첫 단어의 언어 태그
                                // 4) fallback: 'multi'
                                const words = alternatives[0].words;
                                let detectedLang = 'multi';

                                // 디버그: raw 응답 구조 확인 (final 결과만)
                                if (isFinal && transcript) {
                                    const wordLangs = words?.slice(0, 5).map((w: { word: string; language?: string }) => `${w.word}(${w.language || '?'})`);
                                    console.log(`[Deepgram-Multi DEBUG] channel.languages=${JSON.stringify(channel?.languages)}, word_langs=[${wordLangs}], alternatives[0].languages=${JSON.stringify(alternatives[0]?.languages)}`);
                                }

                                if (alternatives[0]?.languages && alternatives[0].languages.length > 0) {
                                    detectedLang = alternatives[0].languages[0];
                                } else if (channel?.languages && channel.languages.length > 0) {
                                    detectedLang = channel.languages[0];
                                } else if (words && words.length > 0 && words[0].language) {
                                    detectedLang = words[0].language;
                                }

                                if (transcript) {
                                    const gladiaStyleMsg = {
                                        type: 'transcript',
                                        data: {
                                            is_final: isFinal,
                                            utterance: {
                                                text: transcript,
                                                language: detectedLang,
                                            },
                                        },
                                    };

                                    console.log(`[Deepgram-Multi] transcript is_final=${isFinal}, lang=${detectedLang}, text="${transcript.slice(0, 30)}..."`);
                                    clientWs.send(JSON.stringify(gladiaStyleMsg));
                                }
                            }
                        } else if (msg.type === 'Metadata') {
                            console.log('[Deepgram-Multi] Metadata received:', msg);
                        } else if (msg.type === 'UtteranceEnd') {
                            console.log('[Deepgram-Multi] Utterance ended');
                        }
                    } catch (parseError) {
                        console.error('Error parsing Deepgram Multi message:', parseError);
                    }
                }
            };

            sttWs.onerror = (error) => {
                console.error('Deepgram Multi WebSocket error:', error);
                if (isClientConnected) {
                    clientWs.close();
                }
            };

            sttWs.onclose = (event) => {
                console.log('Deepgram Multi connection closed:', event.code, event.reason);
                if (isClientConnected) {
                    clientWs.close();
                }
            };

        } catch (error) {
            console.error('Error starting Deepgram Multi connection:', error);
            if (isClientConnected) {
                clientWs.close(1011, 'Failed to connect to Deepgram Multi transcription service.');
            }
        }
    };

    // ===== FIREWORKS 연결 =====
    const startFireworksConnection = async (config: ClientConfig) => {
        if (!fireworksApiKey) {
            console.error("FIREWORKS_API_KEY environment variable not set!");
            clientWs.close(1011, "Server configuration error: Fireworks API key not found.");
            return;
        }

        try {
            // Fireworks URL 생성
            const wsUrl = new URL(FIREWORKS_WS_URL);
            
            // Fireworks 언어 코드 매핑
            const langMap: Record<string, string> = {
                'en': 'en', 'ko': 'ko', 'zh': 'zh', 'ja': 'ja',
                'es': 'es', 'fr': 'fr', 'de': 'de', 'ru': 'ru',
                'pt': 'pt', 'it': 'it'
            };
            // 1순위 언어 사용
            const language = langMap[config.languages[0]] || 'en';
            
            // 최신 V2 모델 사용 (더 빠르고 정확함)
            wsUrl.searchParams.set('model', 'fireworks-asr-v2');
            wsUrl.searchParams.set('language', language);
            wsUrl.searchParams.set('response_format', 'verbose_json');
            wsUrl.searchParams.set('sample_rate', config.sample_rate.toString()); // 필수: 클라이언트 샘플 레이트(48000 등) 전달

            console.log('Connecting to Fireworks with URL:', wsUrl.toString());

            sttWs = new WebSocket(wsUrl.toString(), {
                headers: {
                    'Authorization': `Bearer ${fireworksApiKey}`,
                },
            });

            sttWs.onopen = () => {
                console.log('Proxy connected to Fireworks WebSocket');
                if (isClientConnected) {
                    clientWs.send(JSON.stringify({ status: 'ready' }));
                } else {
                    sttWs?.close();
                }
            };

            sttWs.onmessage = (event) => {
                if (isClientConnected) {
                    try {
                        const msg = JSON.parse(event.data.toString());
                        // Fireworks (Whisper format) -> Gladia/Client format
                        // Expected msg: { text: "...", segments: [...] } or partial?
                        // Fireworks documentation says it sends JSON. 
                        // Let's assume standard field 'text'.
                        
                        const text = msg.text || '';
                        const isFinal = msg.is_final || false; // Fireworks might verify 'is_final'

                        if (text) {
                            const gladiaStyleMsg = {
                                type: 'transcript',
                                data: {
                                    is_final: isFinal, 
                                    utterance: {
                                        text: text,
                                        language: language // Fireworks might not return detected language in stream
                                    }
                                }
                            };
                            console.log(`[Fireworks] text="${text.slice(0, 30)}..." final=${isFinal}`);
                            clientWs.send(JSON.stringify(gladiaStyleMsg));
                        }
                    } catch (e) {
                        console.error('Error parsing Fireworks msg:', e);
                    }
                }
            };

            sttWs.onerror = (error) => {
                console.error('Fireworks WebSocket error:', error);
                if (isClientConnected) {
                    clientWs.close();
                }
            };

            sttWs.onclose = (event) => {
                console.log('Fireworks connection closed:', event.code, event.reason);
                if (isClientConnected) {
                    clientWs.close();
                }
            };

        } catch (error) {
            console.error('Error starting Fireworks connection:', error);
            if (isClientConnected) {
                clientWs.close(1011, 'Failed to connect to Fireworks service.');
            }
        }
    };

    // ===== SONIOX 연결 (다국어 실시간, 토큰 기반, 발화자 분리) =====
    const startSonioxConnection = async (config: ClientConfig) => {
        if (!sonioxApiKey) {
            console.error("SONIOX_API_KEY environment variable not set!");
            clientWs.close(1011, "Server configuration error: Soniox API key not found.");
            return;
        }

        try {
            console.log('Connecting to Soniox with languages:', config.languages);
            sttWs = new WebSocket(SONIOX_WS_URL);

            // 토큰 누적 상태 (Soniox는 토큰 단위로 반환)
            let finalizedText = '';
            let detectedLang = config.languages[0] || 'en';
            let hadNonFinal = false;

            sttWs.onopen = () => {
                console.log('Proxy connected to Soniox WebSocket');

                const sonioxConfig = {
                    api_key: sonioxApiKey,
                    model: 'stt-rt-v4',
                    audio_format: 'pcm_s16le',
                    sample_rate: config.sample_rate,
                    num_channels: 1,
                    language_hints: config.languages,
                    enable_endpoint_detection: true,
                    enable_language_identification: true,
                    enable_speaker_diarization: true,
                    max_endpoint_delay_ms: 500,
                };
                sttWs!.send(JSON.stringify(sonioxConfig));

                if (isClientConnected) {
                    clientWs.send(JSON.stringify({ status: 'ready' }));
                } else {
                    sttWs?.close();
                }
            };

            sttWs.onmessage = (event) => {
                if (!isClientConnected) return;

                try {
                    const msg = JSON.parse(event.data.toString());

                    if (msg.error_code) {
                        console.error(`[Soniox] Error: ${msg.error_code} - ${msg.error_message}`);
                        return;
                    }

                    if (msg.finished) {
                        console.log('[Soniox] Session finished');
                        return;
                    }

                    const tokens = msg.tokens || [];
                    if (tokens.length === 0) return;

                    let newFinalText = '';
                    let nonFinalText = '';

                    for (const token of tokens) {
                        if (token.language) {
                            detectedLang = token.language;
                        }
                        if (token.is_final) {
                            newFinalText += token.text;
                        } else {
                            nonFinalText += token.text;
                        }
                    }

                    finalizedText += newFinalText;

                    if (nonFinalText) {
                        hadNonFinal = true;
                        // 부분 결과: 확정된 텍스트 + 미확정 텍스트
                        const fullText = finalizedText + nonFinalText;
                        const partialMsg = {
                            type: 'transcript',
                            data: {
                                is_final: false,
                                utterance: {
                                    text: fullText.trim(),
                                    language: detectedLang,
                                },
                            },
                        };
                        console.log(`[Soniox] partial lang=${detectedLang}, text="${fullText.trim().slice(0, 30)}..."`);
                        clientWs.send(JSON.stringify(partialMsg));
                    } else if (newFinalText && hadNonFinal) {
                        // 모델이 엔드포인트를 감지하여 토큰을 확정함 → 발화 완료
                        const finalMsg = {
                            type: 'transcript',
                            data: {
                                is_final: true,
                                utterance: {
                                    text: finalizedText.trim(),
                                    language: detectedLang,
                                },
                            },
                        };
                        console.log(`[Soniox] FINAL lang=${detectedLang}, text="${finalizedText.trim().slice(0, 30)}..."`);
                        clientWs.send(JSON.stringify(finalMsg));
                        finalizedText = '';
                        hadNonFinal = false;
                    }
                } catch (parseError) {
                    console.error('Error parsing Soniox message:', parseError);
                }
            };

            sttWs.onerror = (error) => {
                console.error('Soniox WebSocket error:', error);
                if (isClientConnected) {
                    clientWs.close();
                }
            };

            sttWs.onclose = (event) => {
                console.log('Soniox connection closed:', event.code, event.reason);
                // 남은 텍스트가 있으면 마지막 발화로 전송
                if (isClientConnected && finalizedText) {
                    const finalMsg = {
                        type: 'transcript',
                        data: {
                            is_final: true,
                            utterance: {
                                text: finalizedText.trim(),
                                language: detectedLang,
                            },
                        },
                    };
                    clientWs.send(JSON.stringify(finalMsg));
                    finalizedText = '';
                }
                if (isClientConnected) {
                    clientWs.close();
                }
            };

        } catch (error) {
            console.error('Error starting Soniox connection:', error);
            if (isClientConnected) {
                clientWs.close(1011, 'Failed to connect to Soniox service.');
            }
        }
    };

    // ===== 클라이언트 메시지 핸들러 =====
    clientWs.onmessage = (event) => {
        const message = event.data.toString();
        const data = JSON.parse(message);

        if (data.sample_rate && data.languages) {
            // 첫 번째 메시지 - 설정 정보
            console.log("Received config from client:", data);
            currentModel = data.stt_model || 'gladia';
            
            if (currentModel === 'deepgram') {
                startDeepgramConnection(data as ClientConfig);
            } else if (currentModel === 'deepgram-multi') {
                startDeepgramMultiConnection(data as ClientConfig);
            } else if (currentModel === 'fireworks') {
                startFireworksConnection(data as ClientConfig);
            } else if (currentModel === 'soniox') {
                startSonioxConnection(data as ClientConfig);
            } else if (currentModel === 'gladia-stt') {
                startGladiaConnection(data as ClientConfig, false);
            } else {
                startGladiaConnection(data as ClientConfig, true);
            }
        } else if (sttWs && sttWs.readyState === WebSocket.OPEN) {
            // 오디오 프레임 전송
            if (currentModel === 'deepgram' || currentModel === 'deepgram-multi' || currentModel === 'fireworks' || currentModel === 'soniox') {
                // Deepgram, Fireworks는 바이너리 데이터를 직접 전송해야 함 (Gladia/Gladia-STT는 JSON 형식)
                if (data.type === 'audio_chunk' && data.data?.chunk) {
                    const pcmData = Buffer.from(data.data.chunk, 'base64');
                    sttWs.send(pcmData);
                }
            } else {
                // Gladia는 JSON 형식 그대로 전송
                sttWs.send(message);
            }
        }
    };

    clientWs.onclose = () => {
        console.log('Client disconnected from proxy');
        cleanup();
    };
});

server.listen(PORT, () => {
    console.log(`STT WebSocket proxy server listening on port ${PORT}`);
});