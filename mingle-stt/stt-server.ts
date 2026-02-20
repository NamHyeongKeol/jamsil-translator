import { createServer } from 'http';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import { config as loadDotenv } from 'dotenv';

const envCandidates = ['.env.local', '.env'];
for (const filename of envCandidates) {
    const fullPath = resolve(process.cwd(), filename);
    if (!existsSync(fullPath)) continue;
    loadDotenv({ path: fullPath });
}

const PORT = parseInt(process.env.PORT || '3001', 10);
const GLADIA_API_URL = 'https://api.gladia.io/v2/live';
const DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen';
const FIREWORKS_WS_URL = 'wss://audio-streaming.api.fireworks.ai/v1/audio/transcriptions/streaming';
const SONIOX_WS_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
const SONIOX_MANUAL_FINALIZE_SILENCE_MS = (() => {
    const raw = Number(process.env.SONIOX_MANUAL_FINALIZE_SILENCE_MS || '300');
    if (!Number.isFinite(raw)) return 300;
    return Math.max(100, Math.min(1000, Math.floor(raw)));
})();
const SONIOX_MANUAL_FINALIZE_COOLDOWN_MS = (() => {
    const raw = Number(process.env.SONIOX_MANUAL_FINALIZE_COOLDOWN_MS || '1200');
    if (!Number.isFinite(raw)) return 1200;
    return Math.max(300, Math.min(5000, Math.floor(raw)));
})();
const SONIOX_SILENCE_RMS_THRESHOLD = (() => {
    const raw = Number(process.env.SONIOX_SILENCE_RMS_THRESHOLD || '0.006');
    if (!Number.isFinite(raw)) return 0.006;
    return Math.max(0.001, Math.min(0.05, raw));
})();

const server = createServer();
const wss = new WebSocketServer({ server });

interface ClientConfig {
    sample_rate: number;
    languages: string[];
    stt_model: 'gladia' | 'gladia-stt' | 'deepgram' | 'deepgram-multi' | 'fireworks' | 'soniox';
    lang_hints_strict?: boolean;
}

interface FinalTurnPayload {
    text: string;
    language: string;
}

let connectionCounter = 0;

wss.on('connection', (clientWs) => {
    const connId = ++connectionCounter;
    const connectedAt = Date.now();
    console.log(`[conn:${connId}] client connected`);

    let sttWs: WebSocket | null = null;
    let isClientConnected = true;
    let abortController: AbortController | null = null;
    let currentModel: 'gladia' | 'gladia-stt' | 'deepgram' | 'deepgram-multi' | 'fireworks' | 'soniox' = 'gladia';
    let selectedLanguages: string[] = [];
    let finalizePendingTurnFromProvider: (() => Promise<FinalTurnPayload | null>) | null = null;
    let sonioxStopRequested = false;
    let sonioxSampleRate = 16_000;
    let sonioxHasPendingTranscript = false;
    let sonioxSawSpeechInCurrentSegment = false;
    let sonioxTrailingSilenceMs = 0;
    let sonioxManualFinalizeSent = false;
    let sonioxLastManualFinalizeAtMs = 0;

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
        sonioxHasPendingTranscript = false;
        sonioxSawSpeechInCurrentSegment = false;
        sonioxTrailingSilenceMs = 0;
        sonioxManualFinalizeSent = false;
        sonioxLastManualFinalizeAtMs = 0;
    };

    const resetSonioxSegmentState = () => {
        sonioxHasPendingTranscript = false;
        sonioxSawSpeechInCurrentSegment = false;
        sonioxTrailingSilenceMs = 0;
        sonioxManualFinalizeSent = false;
        sonioxLastManualFinalizeAtMs = 0;
    };

    const maybeTriggerSonioxManualFinalize = (pcmData: Buffer) => {
        if (currentModel !== 'soniox') return;
        if (!sttWs || sttWs.readyState !== WebSocket.OPEN) return;
        if (sonioxStopRequested) return;

        const sampleCount = Math.floor(pcmData.length / 2);
        if (sampleCount <= 0 || sonioxSampleRate <= 0) return;

        let sumSquares = 0;
        for (let i = 0; i + 1 < pcmData.length; i += 2) {
            const sample = pcmData.readInt16LE(i) / 32768;
            sumSquares += sample * sample;
        }
        const rms = Math.sqrt(sumSquares / sampleCount);
        const chunkDurationMs = (sampleCount / sonioxSampleRate) * 1000;
        if (!Number.isFinite(chunkDurationMs) || chunkDurationMs <= 0) return;

        if (rms >= SONIOX_SILENCE_RMS_THRESHOLD) {
            sonioxSawSpeechInCurrentSegment = true;
            sonioxTrailingSilenceMs = 0;
            return;
        }

        if (!sonioxSawSpeechInCurrentSegment) return;
        if (sonioxManualFinalizeSent) return;

        sonioxTrailingSilenceMs += chunkDurationMs;
        if (sonioxTrailingSilenceMs < SONIOX_MANUAL_FINALIZE_SILENCE_MS) return;
        if (!sonioxHasPendingTranscript) return;
        const now = Date.now();
        if ((now - sonioxLastManualFinalizeAtMs) < SONIOX_MANUAL_FINALIZE_COOLDOWN_MS) return;

        try {
            sttWs.send(JSON.stringify({ type: 'finalize' }));
            sonioxManualFinalizeSent = true;
            sonioxTrailingSilenceMs = 0;
            sonioxLastManualFinalizeAtMs = now;
        } catch (error) {
            console.error('Soniox manual finalize send failed:', error);
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
            sonioxSampleRate = Number.isFinite(config.sample_rate) && config.sample_rate > 0
                ? Math.floor(config.sample_rate)
                : 16_000;
            resetSonioxSegmentState();

            // 토큰 누적 상태 (Soniox는 토큰 단위로 반환)
            let finalizedText = '';
            let latestNonFinalText = '';
            let detectedLang = config.languages[0] || 'en';
            sonioxStopRequested = false;
            const stripEndpointMarkers = (text: string): string => text.replace(/<\/?(?:end|fin)>/ig, '');
            const extractFirstEndpointMarker = (text: string): string => {
                const match = /<\/?(?:end|fin)>/i.exec(text);
                return match ? match[0] : '<fin>';
            };

            const splitTurnAtFirstEndpointMarker = (text: string): { finalText: string; carryText: string } => {
                const markerMatch = /<\/?(?:end|fin)>/i.exec(text);
                if (!markerMatch) {
                    return {
                        finalText: text.trim(),
                        carryText: '',
                    };
                }
                const markerEndIndex = markerMatch.index + markerMatch[0].length;
                return {
                    finalText: text.slice(0, markerEndIndex).trim(),
                    carryText: text.slice(markerEndIndex).trim(),
                };
            };

            const emitFinalTurn = (text: string, language: string): FinalTurnPayload | null => {
                // Temporary debug mode: keep <end>/<fin> markers in emitted transcript text.
                const cleanedText = text.trim();
                const cleanedLang = (language || '').trim() || 'unknown';
                if (!cleanedText) return null;

                // Clear turn accumulators immediately.
                finalizedText = '';
                latestNonFinalText = '';
                resetSonioxSegmentState();

                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                        type: 'transcript',
                        data: {
                            is_final: true,
                            utterance: {
                                text: cleanedText,
                                language: cleanedLang,
                            },
                        },
                    }));
                }

                return {
                    text: cleanedText,
                    language: cleanedLang,
                };
            };

            finalizePendingTurnFromProvider = async () => {
                const merged = `${finalizedText}${latestNonFinalText}`.trim();
                return emitFinalTurn(merged, detectedLang) ?? null;
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
                    enable_endpoint_detection: false,
                    enable_language_identification: true,
                    enable_speaker_diarization: true,
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
                        if (token.is_final) {
                            newFinalText += token.text;
                        } else {
                            nonFinalText += token.text;
                        }
                    }

                    const previousMerged = `${finalizedText}${latestNonFinalText}`.trim();
                    finalizedText += newFinalText;
                    const hasEndpointToken = /<\/?(?:end|fin)>/i.test(newFinalText) || /<\/?(?:end|fin)>/i.test(nonFinalText);

                    if (nonFinalText) {
                        latestNonFinalText = nonFinalText;
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
                        clientWs.send(JSON.stringify(partialMsg));
                    }

                    const mergedSnapshot = `${finalizedText}${latestNonFinalText}`.trim();
                    sonioxHasPendingTranscript = mergedSnapshot.length > 0;
                    if (mergedSnapshot && mergedSnapshot !== previousMerged) {
                        // Allow another manual finalize only when transcript actually progressed.
                        sonioxManualFinalizeSent = false;
                    }

                    // 발화 완료 판단:
                    // Soniox endpoint(<end>/<fin>) 토큰이 포함된 경우에만 완료 처리
                    if (hasEndpointToken) {
                        const mergedAtEndpoint = `${finalizedText}${latestNonFinalText}`.trim();
                        const { finalText, carryText } = splitTurnAtFirstEndpointMarker(mergedAtEndpoint);
                        let finalTextToEmit = finalText;
                        let carryTextToEmit = carryText;

                        if (!stripEndpointMarkers(finalTextToEmit).trim() && carryTextToEmit) {
                            // Some Soniox finalize bursts can place endpoint marker before stale non-final tail.
                            // Recover readable final text as "<tail><fin>" instead of marker-only final.
                            finalTextToEmit = `${carryTextToEmit}${extractFirstEndpointMarker(finalTextToEmit)}`.trim();
                            carryTextToEmit = '';
                        }

                        if (stripEndpointMarkers(finalTextToEmit).trim()) {
                            emitFinalTurn(finalTextToEmit, detectedLang);
                        } else {
                            // Ignore marker-only finals to avoid <fin>-only bubble floods.
                            finalizedText = '';
                            latestNonFinalText = '';
                            resetSonioxSegmentState();
                        }

                        // Keep trailing text after endpoint marker as next-turn partial
                        // so it does not contaminate the just-finished final turn.
                        if (carryTextToEmit) {
                            latestNonFinalText = carryTextToEmit;
                            sonioxHasPendingTranscript = true;
                            sonioxSawSpeechInCurrentSegment = true;
                            sonioxTrailingSilenceMs = 0;
                            sonioxManualFinalizeSent = false;

                            if (clientWs.readyState === WebSocket.OPEN) {
                                clientWs.send(JSON.stringify({
                                    type: 'transcript',
                                    data: {
                                        is_final: false,
                                        utterance: {
                                            text: carryTextToEmit,
                                            language: detectedLang,
                                        },
                                    },
                                }));
                            }
                        }
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
                // stop_recording 경로가 아니면 남은 텍스트를 마지막 발화로 플러시
                if (isClientConnected && !sonioxStopRequested) {
                    void (async () => {
                        await finalizePendingTurnFromProvider?.();
                        if (clientWs.readyState === WebSocket.OPEN) {
                            clientWs.close();
                        }
                    })();
                }
            };

        } catch (error) {
            console.error('Error starting Soniox connection:', error);
            if (isClientConnected) {
                clientWs.close(1011, 'Failed to connect to Soniox service.');
            }
        }
    };

    const sendForcedFinalTurn = (rawText: string, rawLanguage: string): FinalTurnPayload | null => {
        const text = (rawText || '').trim();
        const language = (rawLanguage || '').trim() || 'unknown';
        if (!text) return null;

        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({
                type: 'transcript',
                data: {
                    is_final: true,
                    utterance: {
                        text,
                        language,
                    },
                },
            }));
        }

        return { text, language };
    };

    // ===== 클라이언트 메시지 핸들러 =====
    clientWs.onmessage = (event) => {
        const message = event.data.toString();
        let data: any;
        try {
            data = JSON.parse(message);
        } catch {
            return;
        }

        if (data?.type === 'stop_recording') {
            const pendingText = (data?.data?.pending_text || '').toString();
            const pendingLang = data?.data?.pending_language || selectedLanguages[0] || 'unknown';
            const cleanedPendingText = pendingText.trim();
            sonioxStopRequested = currentModel === 'soniox';

            let finalizedTurn: FinalTurnPayload | null = null;

            // User-initiated stop: finalize what the user currently sees.
            if (cleanedPendingText) {
                finalizedTurn = sendForcedFinalTurn(pendingText, pendingLang);
            } else if (finalizePendingTurnFromProvider) {
                // Synchronous path: just emit transcript, no async translation.
                void finalizePendingTurnFromProvider();
            }

            if (sttWs && (sttWs.readyState === WebSocket.OPEN || sttWs.readyState === WebSocket.CONNECTING)) {
                sttWs.close();
            }

            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({
                    type: 'stop_recording_ack',
                    data: {
                        finalized: Boolean(finalizedTurn),
                        final_turn: finalizedTurn,
                    },
                }));
                // Close client socket after ack.
                setTimeout(() => {
                    if (clientWs.readyState === WebSocket.OPEN) {
                        clientWs.close();
                    }
                }, 50);
            }
            sonioxStopRequested = false;
            return;
        }

        if (data.sample_rate && data.languages) {
            currentModel = data.stt_model || 'gladia';
            selectedLanguages = data.languages;
            finalizePendingTurnFromProvider = null;
            sonioxStopRequested = false;
            console.log(`[conn:${connId}] config model=${currentModel} langs=${selectedLanguages.join(',')}`);
            
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
                    if (currentModel === 'soniox') {
                        maybeTriggerSonioxManualFinalize(pcmData);
                    }
                }
            } else {
                // Gladia는 JSON 형식 그대로 전송
                sttWs.send(message);
            }
        }
    };

    clientWs.onclose = (event) => {
        const durationSec = ((Date.now() - connectedAt) / 1000).toFixed(1);
        console.log(`[conn:${connId}] client disconnected code=${event.code} duration=${durationSec}s model=${currentModel} langs=${selectedLanguages.join(',')}`);
        cleanup();
    };
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[stt-server] listening on 0.0.0.0:${PORT}`);
});
