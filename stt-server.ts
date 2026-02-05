import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import 'dotenv/config';

const PORT = 3001;
const GLADIA_API_URL = 'https://api.gladia.io/v2/live';
const DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen';

const server = createServer();
const wss = new WebSocketServer({ server });

console.log('Starting STT WebSocket proxy server...');

interface ClientConfig {
    sample_rate: number;
    languages: string[];
    stt_model: 'gladia' | 'deepgram';
}

wss.on('connection', (clientWs) => {
    console.log('Client connected to proxy');

    let sttWs: WebSocket | null = null;
    let isClientConnected = true;
    let abortController: AbortController | null = null;
    let currentModel: 'gladia' | 'deepgram' = 'gladia';

    const gladiaApiKey = process.env.GLADIA_API_KEY;
    const deepgramApiKey = process.env.DEEPGRAM_API_KEY;

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
    const startGladiaConnection = async (config: ClientConfig) => {
        if (!gladiaApiKey) {
            console.error("GLADIA_API_KEY environment variable not set!");
            clientWs.close(1011, "Server configuration error: Gladia API key not found.");
            return;
        }

        try {
            abortController = new AbortController();
            
            console.log('Requesting Gladia audio URL with languages:', config.languages);
            const response = await fetch(GLADIA_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-gladia-key': gladiaApiKey,
                },
                body: JSON.stringify({
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
                    realtime_processing: {
                        translation: true,
                        translation_config: {
                            target_languages: config.languages,
                            model: 'enhanced',
                        },
                    },
                    messages_config: {
                        receive_partial_transcripts: true,
                    },
                }),
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
            } else {
                startGladiaConnection(data as ClientConfig);
            }
        } else if (sttWs && sttWs.readyState === WebSocket.OPEN) {
            // 오디오 프레임 전송
            if (currentModel === 'deepgram') {
                // Deepgram은 바이너리 데이터를 직접 전송해야 함
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