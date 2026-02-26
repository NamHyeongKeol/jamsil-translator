import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import 'dotenv/config';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const PORT = 3001;
const GLADIA_API_URL = 'https://api.gladia.io/v2/live';
const DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen';
const FIREWORKS_WS_URL = 'wss://audio-streaming.api.fireworks.ai/v1/audio/transcriptions/streaming';
const SONIOX_WS_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';

const server = createServer();
const wss = new WebSocketServer({ server });



type TranslateModel = 'gpt-5-nano' | 'claude-haiku-4-5' | 'gemini-2.5-flash-lite' | 'gemini-3-flash-preview';

interface ClientConfig {
    sample_rate: number;
    languages: string[];
    stt_model: 'gladia' | 'gladia-stt' | 'deepgram' | 'deepgram-multi' | 'fireworks' | 'soniox';
    translate_model?: TranslateModel;
    lang_hints_strict?: boolean;
}

wss.on('connection', (clientWs) => {
    let sttWs: WebSocket | null = null;
    let isClientConnected = true;
    let abortController: AbortController | null = null;
    let currentModel: 'gladia' | 'gladia-stt' | 'deepgram' | 'deepgram-multi' | 'fireworks' | 'soniox' = 'gladia';
    let selectedLanguages: string[] = [];
    let translateModel: TranslateModel = 'claude-haiku-4-5';

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
                return;
            }

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Failed to get Gladia URL: ${response.status} ${response.statusText} - ${errorBody}`);
            }

            const data = await response.json() as { url?: string };
            const gladiaWsUrl = data.url;

            if (!gladiaWsUrl) {
                throw new Error('No url in Gladia response');
            }

            if (!isClientConnected) {
                return;
            }

            sttWs = new WebSocket(gladiaWsUrl);

            sttWs.onopen = () => {
                if (isClientConnected) {
                    clientWs.send(JSON.stringify({ status: 'ready' }));
                } else {
                    sttWs?.close();
                }
            };

            sttWs.onmessage = (event) => {
                if (isClientConnected) {
                    const raw = event.data.toString();
                    clientWs.send(raw);

                    // Gladia-STT (번역 미사용) 모드에서 GPT 번역 적용
                    if (!enableTranslation && selectedLanguages.length > 0) {
                        try {
                            const msg = JSON.parse(raw);
                            if (msg.type === 'transcript' && msg.data?.is_final && msg.data?.utterance?.text) {
                                translateText(msg.data.utterance.text, msg.data.utterance.language || 'en', selectedLanguages, clientWs);
                            }
                        } catch { /* ignore parse errors for non-JSON messages */ }
                    }
                }
            };

            sttWs.onerror = (error) => {
                console.error('Gladia WebSocket error:', error);
                if (isClientConnected) {
                    clientWs.close();
                }
            };

            sttWs.onclose = () => {
                if (isClientConnected) {
                    clientWs.close();
                }
            };

        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
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

            sttWs = new WebSocket(wsUrl.toString(), {
                headers: {
                    'Authorization': `Token ${deepgramApiKey}`,
                },
            });

            sttWs.onopen = () => {
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
                                const detectedLang = alternatives[0].detected_language ||
                                                     channel?.detected_language ||
                                                     msg.metadata?.detected_language ||
                                                     config.languages[0] || 'en';

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
                                    clientWs.send(JSON.stringify(gladiaStyleMsg));

                                    if (isFinal && selectedLanguages.length > 0) {
                                        translateText(transcript, detectedLang, selectedLanguages, clientWs);
                                    }
                                }
                            }
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

            sttWs.onclose = () => {
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

            sttWs = new WebSocket(wsUrl.toString(), {
                headers: {
                    'Authorization': `Token ${deepgramApiKey}`,
                },
            });

            sttWs.onopen = () => {
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

                                const words = alternatives[0].words;
                                let detectedLang = 'multi';

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
                                    clientWs.send(JSON.stringify(gladiaStyleMsg));

                                    if (isFinal && selectedLanguages.length > 0) {
                                        translateText(transcript, detectedLang, selectedLanguages, clientWs);
                                    }
                                }
                            }
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

            sttWs.onclose = () => {
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
            wsUrl.searchParams.set('model', 'fireworks-asr-large');
            wsUrl.searchParams.set('language', language);
            wsUrl.searchParams.set('response_format', 'verbose_json');
            wsUrl.searchParams.set('sample_rate', config.sample_rate.toString()); // 필수: 클라이언트 샘플 레이트(48000 등) 전달

            sttWs = new WebSocket(wsUrl.toString(), {
                headers: {
                    'Authorization': `Bearer ${fireworksApiKey}`,
                },
            });

            sttWs.onopen = () => {
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
                        const text = msg.text || '';
                        const isFinal = msg.is_final || false;

                        if (text) {
                            const gladiaStyleMsg = {
                                type: 'transcript',
                                data: {
                                    is_final: isFinal,
                                    utterance: {
                                        text: text,
                                        language: language,
                                    },
                                },
                            };
                            clientWs.send(JSON.stringify(gladiaStyleMsg));

                            if (isFinal && selectedLanguages.length > 0) {
                                translateText(text, language, selectedLanguages, clientWs);
                            }
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

            sttWs.onclose = () => {
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
            sttWs = new WebSocket(SONIOX_WS_URL);

            // 토큰 누적 상태 (Soniox는 토큰 단위로 반환)
            let finalizedText = '';
            let detectedLang = config.languages[0] || 'en';
            let detectedSpeaker = 'speaker_unknown';
            let hadNonFinal = false;
            let lastPartialTranslateTime = 0;
            let partialTranslateInFlight = false;
            const normalizeSpeakerId = (rawSpeaker: unknown): string | null => {
                if (typeof rawSpeaker !== 'string') return null;
                const speaker = rawSpeaker.trim().toLowerCase();
                if (!speaker) return null;
                const numeric = /^(\d+)$/.exec(speaker);
                if (numeric) return `speaker_${numeric[1]}`;
                const speakerWithNumber = /^speaker(?:[_\s-]+)?(\d+)$/.exec(speaker);
                if (speakerWithNumber) return `speaker_${speakerWithNumber[1]}`;
                const sanitized = speaker.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                if (!sanitized) return null;
                if (sanitized.startsWith('speaker_')) return sanitized;
                if (sanitized === 'speaker') return null;
                return `speaker_${sanitized}`;
            };

            sttWs.onopen = () => {
                const sonioxConfig = {
                    api_key: sonioxApiKey,
                    model: 'stt-rt-v4',
                    audio_format: 'pcm_s16le',
                    sample_rate: config.sample_rate,
                    num_channels: 1,
                    language_hints: config.languages,
                    language_hints_strict: config.lang_hints_strict !== false,
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

                    // 오디오 처리 시간을 클라이언트에 전송
                    if (msg.final_audio_proc_ms !== undefined || msg.total_audio_proc_ms !== undefined) {
                        const usageMsg = {
                            type: 'usage',
                            data: {
                                final_audio_sec: (msg.final_audio_proc_ms || 0) / 1000,
                                total_audio_sec: (msg.total_audio_proc_ms || 0) / 1000,
                                finished: !!msg.finished,
                            },
                        };
                        clientWs.send(JSON.stringify(usageMsg));
                    }

                    if (msg.finished) {
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
                        const tokenSpeaker = normalizeSpeakerId(
                            token.speaker
                            ?? token.speaker_id
                            ?? token.speakerId
                            ?? token.spk
                            ?? token.diarization_speaker,
                        );
                        if (tokenSpeaker) {
                            detectedSpeaker = tokenSpeaker;
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
                                    speaker: detectedSpeaker,
                                },
                            },
                        };
                        clientWs.send(JSON.stringify(partialMsg));

                        // 부분 번역: ~1.5초마다 중간 번역 실행
                        const now = Date.now();
                        if (selectedLanguages.length > 0 && !partialTranslateInFlight && now - lastPartialTranslateTime > 1500 && fullText.trim().length > 3) {
                            partialTranslateInFlight = true;
                            lastPartialTranslateTime = now;
                            translateText(fullText.trim(), detectedLang, selectedLanguages, clientWs, true).finally(() => {
                                partialTranslateInFlight = false;
                            });
                        }
                    } else if (newFinalText && hadNonFinal) {
                        // 모델이 엔드포인트를 감지하여 토큰을 확정함 → 발화 완료
                        const finalText = finalizedText.trim();
                        const finalMsg = {
                            type: 'transcript',
                            data: {
                                is_final: true,
                                utterance: {
                                    text: finalText,
                                    language: detectedLang,
                                    speaker: detectedSpeaker,
                                },
                            },
                        };
                        clientWs.send(JSON.stringify(finalMsg));

                        if (selectedLanguages.length > 0) {
                            translateText(finalText, detectedLang, selectedLanguages, clientWs);
                        }

                        finalizedText = '';
                        hadNonFinal = false;
                        lastPartialTranslateTime = 0;
                        partialTranslateInFlight = false;
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

            sttWs.onclose = () => {
                // 남은 텍스트가 있으면 마지막 발화로 전송
                if (isClientConnected && finalizedText) {
                    const remainingText = finalizedText.trim();
                    const finalMsg = {
                        type: 'transcript',
                        data: {
                            is_final: true,
                            utterance: {
                                text: remainingText,
                                language: detectedLang,
                                speaker: detectedSpeaker,
                            },
                        },
                    };
                    clientWs.send(JSON.stringify(finalMsg));

                    if (selectedLanguages.length > 0) {
                        translateText(remainingText, detectedLang, selectedLanguages, clientWs);
                    }

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

    // ===== GPT 번역 =====
    const LANG_NAMES: Record<string, string> = {
        en: 'English', ko: 'Korean', zh: 'Chinese', ja: 'Japanese',
        es: 'Spanish', fr: 'French', de: 'German', ru: 'Russian',
        pt: 'Portuguese', ar: 'Arabic', hi: 'Hindi', vi: 'Vietnamese',
        it: 'Italian', id: 'Indonesian', tr: 'Turkish', pl: 'Polish',
        nl: 'Dutch', sv: 'Swedish', th: 'Thai', ms: 'Malay',
    };

    const translateText = async (text: string, sourceLang: string, targetLangs: string[], ws: WebSocket, isPartial = false) => {
        const langs = targetLangs.filter(l => l !== sourceLang);
        if (langs.length === 0 || !text.trim()) return;

        const langList = langs.map(l => `${l} (${LANG_NAMES[l] || l})`).join(', ');
        const systemPrompt = `You are a translator. Translate the given text into the requested languages. Respond ONLY with a JSON object mapping language codes to translations. No extra text.`;
        const userPrompt = `Translate to ${langList}:\n"${text}"`;

        try {
            let content: string | undefined;

            if (translateModel === 'claude-haiku-4-5') {
                const resp = await anthropic.messages.create({
                    model: 'claude-haiku-4-5-20251001',
                    max_tokens: 1024,
                    system: systemPrompt,
                    messages: [{ role: 'user', content: userPrompt }],
                });
                const block = resp.content[0];
                if (block.type === 'text') content = block.text.trim();
            } else if (translateModel === 'gemini-2.5-flash-lite' || translateModel === 'gemini-3-flash-preview') {
                const model = genAI.getGenerativeModel({
                    model: translateModel,
                    systemInstruction: systemPrompt,
                });
                const result = await model.generateContent(userPrompt);
                content = result.response.text()?.trim();
            } else {
                const resp = await openai.chat.completions.create({
                    model: 'gpt-5-nano',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt },
                    ],
                    temperature: 0.1,
                });
                content = resp.choices[0]?.message?.content?.trim();
            }

            if (!content) return;

            // parse JSON (handle possible markdown code fences)
            const jsonStr = content.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
            const translations: Record<string, string> = JSON.parse(jsonStr);

            for (const lang of langs) {
                let translated = translations[lang];
                if (translated && ws.readyState === WebSocket.OPEN) {
                    // Clean <end> tokens from translation output
                    translated = translated.replace(/<\/?end>/gi, '').trim();
                    if (!translated) continue;
                    ws.send(JSON.stringify({
                        type: 'translation',
                        data: {
                            target_language: lang,
                            translated_utterance: { text: translated },
                            is_partial: isPartial,
                        },
                    }));
                }
            }
        } catch (err) {
            console.error('Translation error:', err);
        }
    };

    // ===== 클라이언트 메시지 핸들러 =====
    clientWs.onmessage = (event) => {
        const message = event.data.toString();
        const data = JSON.parse(message);

        if (data.sample_rate && data.languages) {
            currentModel = data.stt_model || 'gladia';
            selectedLanguages = data.languages;
            translateModel = data.translate_model || 'claude-haiku-4-5';
            
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
                // Deepgram, Fireworks, Soniox는 바이너리 데이터를 직접 전송해야 함 (Gladia/Gladia-STT는 JSON 형식)
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
        cleanup();
    };
});

server.listen(PORT, '0.0.0.0');
