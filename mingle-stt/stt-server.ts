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
    const raw = Number(process.env.SONIOX_MANUAL_FINALIZE_SILENCE_MS || '500');
    if (!Number.isFinite(raw)) return 500;
    return Math.max(100, Math.min(1000, Math.floor(raw)));
})();
const SONIOX_MANUAL_FINALIZE_COOLDOWN_MS = (() => {
    const raw = Number(process.env.SONIOX_MANUAL_FINALIZE_COOLDOWN_MS || '1200');
    if (!Number.isFinite(raw)) return 1200;
    return Math.max(300, Math.min(5000, Math.floor(raw)));
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
    let sonioxHasPendingTranscript = false;
    let sonioxManualFinalizeSent = false;
    let sonioxLastManualFinalizeAtMs = 0;
    let sonioxLastTranscriptProgressAtMs = 0;
    let sonioxManualFinalizeTimer: NodeJS.Timeout | null = null;
    let sonioxManualFinalizeDueAtMs = 0;
    // Snapshot of accumulated merged-text length (final + non-final) at the
    // moment we send { type: 'finalize' } to Soniox.  When the <fin> response
    // eventually arrives, text beyond this boundary was spoken *after* the
    // finalize request and should become carry for the next utterance.
    let sonioxFinalizeSnapshotTextLen: number | null = null;
    // Mirror of `(finalizedText + latestNonFinalText).length` from inside
    // startSonioxConnection,
    // kept in connection scope so maybeTriggerSonioxManualFinalize can read it.
    let sonioxCurrentMergedTextLen = 0;
    // --- Carry expiry timer ---
    // When carry text is parked (latestNonFinalIsProvisionalCarry), this timer
    // fires after silence+cooldown to finalize the carry as its own utterance
    // if no new speech arrives.  This does NOT touch the normal finalize flow.
    let sonioxCarryExpiryTimer: NodeJS.Timeout | null = null;
    const gladiaApiKey = process.env.GLADIA_API_KEY;
    const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
    const fireworksApiKey = process.env.FIREWORKS_API_KEY;
    const sonioxApiKey = process.env.SONIOX_API_KEY;

    const clearSonioxManualFinalizeTimer = () => {
        if (sonioxManualFinalizeTimer) {
            clearTimeout(sonioxManualFinalizeTimer);
            sonioxManualFinalizeTimer = null;
        }
        sonioxManualFinalizeDueAtMs = 0;
    };

    const clearSonioxCarryExpiryTimer = () => {
        if (sonioxCarryExpiryTimer) {
            clearTimeout(sonioxCarryExpiryTimer);
            sonioxCarryExpiryTimer = null;
        }
    };

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
        clearSonioxManualFinalizeTimer();
        clearSonioxCarryExpiryTimer();
        sonioxHasPendingTranscript = false;
        sonioxManualFinalizeSent = false;
        sonioxLastManualFinalizeAtMs = 0;
        sonioxLastTranscriptProgressAtMs = 0;
    };

    const resetSonioxSegmentState = () => {
        clearSonioxManualFinalizeTimer();
        clearSonioxCarryExpiryTimer();
        sonioxHasPendingTranscript = false;
        sonioxManualFinalizeSent = false;
        sonioxLastManualFinalizeAtMs = 0;
        sonioxLastTranscriptProgressAtMs = 0;
        sonioxFinalizeSnapshotTextLen = null;
        sonioxCurrentMergedTextLen = 0;
    };

    const maybeTriggerSonioxManualFinalize = () => {
        if (currentModel !== 'soniox') return;
        if (!sttWs || sttWs.readyState !== WebSocket.OPEN) return;
        if (sonioxStopRequested) return;
        if (!sonioxHasPendingTranscript) {
            clearSonioxManualFinalizeTimer();
            return;
        }
        if (sonioxManualFinalizeSent) return;

        const now = Date.now();
        if (sonioxLastTranscriptProgressAtMs <= 0) {
            sonioxLastTranscriptProgressAtMs = now;
        }
        const elapsedSinceTranscriptProgressMs = now - sonioxLastTranscriptProgressAtMs;
        if (elapsedSinceTranscriptProgressMs < SONIOX_MANUAL_FINALIZE_SILENCE_MS) {
            const waitMs = Math.max(1, SONIOX_MANUAL_FINALIZE_SILENCE_MS - elapsedSinceTranscriptProgressMs);
            clearSonioxManualFinalizeTimer();
            sonioxManualFinalizeTimer = setTimeout(
                () => maybeTriggerSonioxManualFinalize(),
                waitMs,
            );
            sonioxManualFinalizeDueAtMs = now + waitMs;
            return;
        }

        const elapsedSinceLastManualFinalizeMs = now - sonioxLastManualFinalizeAtMs;
        if (elapsedSinceLastManualFinalizeMs < SONIOX_MANUAL_FINALIZE_COOLDOWN_MS) {
            const waitMs = Math.max(1, SONIOX_MANUAL_FINALIZE_COOLDOWN_MS - elapsedSinceLastManualFinalizeMs);
            clearSonioxManualFinalizeTimer();
            sonioxManualFinalizeTimer = setTimeout(
                () => maybeTriggerSonioxManualFinalize(),
                waitMs,
            );
            sonioxManualFinalizeDueAtMs = now + waitMs;
            return;
        }

        try {
            // Capture snapshot of accumulated text length before sending
            // finalize.  Tokens arriving after this point belong to the
            // *next* utterance, even though Soniox may place them before
            // the <fin> marker in its response.
            sonioxFinalizeSnapshotTextLen = sonioxCurrentMergedTextLen;
            sttWs.send(JSON.stringify({ type: 'finalize' }));
            sonioxManualFinalizeSent = true;
            sonioxLastManualFinalizeAtMs = now;
            clearSonioxManualFinalizeTimer();
        } catch (error) {
            console.error('Soniox manual finalize send failed:', error);
            sonioxFinalizeSnapshotTextLen = null;
        }
    };

    const scheduleSonioxManualFinalizeFromTranscriptProgress = () => {
        if (currentModel !== 'soniox') return;
        if (sonioxStopRequested) return;
        if (!sonioxHasPendingTranscript) {
            clearSonioxManualFinalizeTimer();
            return;
        }

        const now = Date.now();
        sonioxLastTranscriptProgressAtMs = now;
        if (sonioxManualFinalizeSent) return;

        const waitMs = SONIOX_MANUAL_FINALIZE_SILENCE_MS;
        clearSonioxManualFinalizeTimer();
        sonioxManualFinalizeTimer = setTimeout(
            () => maybeTriggerSonioxManualFinalize(),
            waitMs,
        );
        sonioxManualFinalizeDueAtMs = now + waitMs;
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
            resetSonioxSegmentState();

            // 토큰 누적 상태 (Soniox는 토큰 단위로 반환)
            let finalizedText = '';
            let latestNonFinalText = '';
            let latestNonFinalIsProvisionalCarry = false;
            let lastFinalizedEndMs = -1;
            let detectedLang = config.languages[0] || 'en';
            sonioxStopRequested = false;
            const stripEndpointMarkers = (text: string): string => text.replace(/<\/?(?:end|fin)>/ig, '');
            const extractFirstEndpointMarker = (text: string): string => {
                const match = /<\/?(?:end|fin)>/i.exec(text);
                return match ? match[0] : '<fin>';
            };
            const composeTurnText = (finalText: string, nonFinalText: string): string => {
                return `${finalText || ''}${nonFinalText || ''}`.trim();
            };
            const parseTokenTimeMs = (raw: unknown): number | null => {
                if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
                return raw;
            };
            const isTokenBeyondWatermark = (
                tokenStartMs: number | null,
                tokenEndMs: number | null,
                watermarkMs: number,
            ): boolean => {
                if (tokenEndMs !== null) return tokenEndMs > watermarkMs;
                if (tokenStartMs !== null) return tokenStartMs > watermarkMs;
                // No timestamp -> keep text (don't drop words), but treat as
                // non-timestamped progress for carry-promotion gating.
                return true;
            };
            // Returns true only when a token with an actual timestamp is beyond
            // the watermark.  Used for carry-promotion gating to avoid false
            // triggers from timestamp-less tokens.
            const isTokenTimestampedBeyondWatermark = (
                tokenStartMs: number | null,
                tokenEndMs: number | null,
                watermarkMs: number,
            ): boolean => {
                if (tokenEndMs !== null) return tokenEndMs > watermarkMs;
                if (tokenStartMs !== null) return tokenStartMs > watermarkMs;
                return false;
            };
            // Forward-snap only when the boundary cuts through an ASCII word.
            // This avoids swallowing whole no-space-script suffixes (ko/ja/zh).
            const isAsciiWordChar = (char: string): boolean => /[A-Za-z0-9']/u.test(char);
            const snapBoundaryForwardInsideAsciiWord = (text: string, boundary: number): number => {
                if (boundary <= 0 || boundary >= text.length) return boundary;
                const prevChar = text[boundary - 1] || '';
                const currChar = text[boundary] || '';
                if (!isAsciiWordChar(prevChar) || !isAsciiWordChar(currChar)) {
                    return boundary;
                }

                let snapped = boundary;
                while (snapped < text.length && isAsciiWordChar(text[snapped])) {
                    snapped += 1;
                }
                return snapped;
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
                // Keep endpoint markers in server-emitted text; client normalizes them away.
                const cleanedText = text.trim();
                const cleanedLang = (language || '').trim() || 'unknown';
                if (!cleanedText) return null;

                // Clear turn accumulators immediately.
                finalizedText = '';
                latestNonFinalText = '';
                latestNonFinalIsProvisionalCarry = false;
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
                if (latestNonFinalIsProvisionalCarry && !finalizedText.trim()) {
                    return null;
                }
                const merged = composeTurnText(finalizedText, latestNonFinalText);
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
                    const rawSonioxMessage = event.data.toString();
                    const msg = JSON.parse(rawSonioxMessage);

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

                    type SonioxToken = {
                        text?: unknown;
                        start_ms?: unknown;
                        end_ms?: unknown;
                        is_final?: unknown;
                        language?: unknown;
                    };
                    const tokens = (Array.isArray(msg.tokens) ? msg.tokens : []) as SonioxToken[];
                    if (tokens.length === 0) {
                        return;
                    }

                    const previousFinalizedText = finalizedText;
                    const previousNonFinalText = latestNonFinalText;
                    const hadPendingTextBeforeFrame = composeTurnText(previousFinalizedText, previousNonFinalText).length > 0;
                    let newFinalText = '';
                    let rebuiltNonFinalText = '';
                    let maxSeenFinalEndMs = lastFinalizedEndMs;
                    let hasEndpointToken = false;
                    let endpointMarkerText = '';
                    let hasProgressTokenBeyondWatermark = false;
                    let hasTimestampedProgressBeyondWatermark = false;
                    let rawFinalText = '';
                    let rawNonFinalText = '';
                    let rawEndpointText = '';
                    let rawFinalTokenCount = 0;
                    let rawNonFinalTokenCount = 0;
                    let rawEndpointTokenCount = 0;
                    let rawFinalStartMs: number | null = null;
                    let rawFinalEndMs: number | null = null;
                    let rawNonFinalStartMs: number | null = null;
                    let rawNonFinalEndMs: number | null = null;
                    const mergeTokenTimeRange = (
                        startMs: number | null,
                        endMs: number | null,
                        tokenStartMs: number | null,
                        tokenEndMs: number | null,
                    ): { nextStartMs: number | null; nextEndMs: number | null } => {
                        let nextStartMs = startMs;
                        let nextEndMs = endMs;
                        if (tokenStartMs !== null) {
                            nextStartMs = nextStartMs === null
                                ? tokenStartMs
                                : Math.min(nextStartMs, tokenStartMs);
                        }
                        if (tokenEndMs !== null) {
                            nextEndMs = nextEndMs === null
                                ? tokenEndMs
                                : Math.max(nextEndMs, tokenEndMs);
                        }
                        return { nextStartMs, nextEndMs };
                    };

                    for (const token of tokens) {
                        if (typeof token.language === 'string' && token.language.trim()) {
                            detectedLang = token.language;
                        }
                        const tokenText = typeof token.text === 'string' ? token.text : '';
                        if (!tokenText) continue;
                        const tokenStartMs = parseTokenTimeMs(token.start_ms);
                        const tokenEndMs = parseTokenTimeMs(token.end_ms);

                        const isEndpointMarkerToken = /<\/?(?:end|fin)>/i.test(tokenText);
                        if (isEndpointMarkerToken) {
                            hasEndpointToken = true;
                            rawEndpointTokenCount += 1;
                            rawEndpointText += tokenText;
                            if (!endpointMarkerText) {
                                endpointMarkerText = tokenText;
                            }
                            continue;
                        }

                        if (token.is_final === true) {
                            rawFinalText += tokenText;
                            rawFinalTokenCount += 1;
                            const mergedRange = mergeTokenTimeRange(
                                rawFinalStartMs,
                                rawFinalEndMs,
                                tokenStartMs,
                                tokenEndMs,
                            );
                            rawFinalStartMs = mergedRange.nextStartMs;
                            rawFinalEndMs = mergedRange.nextEndMs;
                        } else {
                            rawNonFinalText += tokenText;
                            rawNonFinalTokenCount += 1;
                            const mergedRange = mergeTokenTimeRange(
                                rawNonFinalStartMs,
                                rawNonFinalEndMs,
                                tokenStartMs,
                                tokenEndMs,
                            );
                            rawNonFinalStartMs = mergedRange.nextStartMs;
                            rawNonFinalEndMs = mergedRange.nextEndMs;
                        }

                        const includeByWatermark = isTokenBeyondWatermark(
                            tokenStartMs,
                            tokenEndMs,
                            lastFinalizedEndMs,
                        );

                        if (token.is_final === true) {
                            if (!includeByWatermark) continue;
                            newFinalText += tokenText;
                            hasProgressTokenBeyondWatermark = true;
                            if (isTokenTimestampedBeyondWatermark(tokenStartMs, tokenEndMs, lastFinalizedEndMs)) {
                                hasTimestampedProgressBeyondWatermark = true;
                            }
                            if (tokenEndMs !== null && tokenEndMs > maxSeenFinalEndMs) {
                                maxSeenFinalEndMs = tokenEndMs;
                            }
                        } else {
                            if (!includeByWatermark) continue;
                            rebuiltNonFinalText += tokenText;
                            hasProgressTokenBeyondWatermark = true;
                            if (isTokenTimestampedBeyondWatermark(tokenStartMs, tokenEndMs, lastFinalizedEndMs)) {
                                hasTimestampedProgressBeyondWatermark = true;
                            }
                        }
                    }

                    const hasAnyPendingTextForEndpoint = hadPendingTextBeforeFrame
                        || newFinalText.trim().length > 0
                        || rebuiltNonFinalText.trim().length > 0;
                    if (endpointMarkerText && (hasProgressTokenBeyondWatermark || hasAnyPendingTextForEndpoint)) {
                        newFinalText += endpointMarkerText;
                    }

                    // --- Carry promotion ---
                    // After a snapshot-based endpoint split, carry text (e.g.
                    // "Right now") is parked in latestNonFinalText as provisional.
                    // Soniox already considers those tokens finalized and won't
                    // re-send them in subsequent frames.  When new progress tokens
                    // arrive for continued speech, we must promote the carry into
                    // finalizedText as a prefix so it won't be overwritten when
                    // latestNonFinalText is replaced with the fresh non-final text.
                    if (latestNonFinalIsProvisionalCarry && previousNonFinalText.trim()) {
                        const carryRaw = stripEndpointMarkers(previousNonFinalText).trim();
                        if (carryRaw && hasTimestampedProgressBeyondWatermark) {
                            // Cancel carry expiry timer since new speech arrived.
                            clearSonioxCarryExpiryTimer();
                            // Check if Soniox re-included the carry in its new tokens
                            // (sometimes overlapping tokens are re-sent).
                            const incomingClean = stripEndpointMarkers(
                                `${stripEndpointMarkers(newFinalText)}${rebuiltNonFinalText}`,
                            ).trim();
                            if (incomingClean.startsWith(carryRaw)) {
                                // Soniox re-included the carry; no promotion needed.
                                latestNonFinalIsProvisionalCarry = false;
                            } else {
                                // Soniox moved past carry; promote it as prefix.
                                // Strip trailing sentence-ending punctuation since the
                                // carry is merging into the MIDDLE of the next utterance.
                                // e.g. "Don't be." → "Don't be" when prefixed.
                                const carryPrefix = carryRaw.replace(/[.!?]+\s*$/, '').trim();
                                if (carryPrefix) {
                                    finalizedText = carryPrefix + ' ' + finalizedText;
                                }
                                latestNonFinalIsProvisionalCarry = false;
                            }
                        }
                    }

                    if (newFinalText) {
                        finalizedText += newFinalText;
                        if (maxSeenFinalEndMs > lastFinalizedEndMs) {
                            lastFinalizedEndMs = maxSeenFinalEndMs;
                        }
                    }

                    if (rebuiltNonFinalText) {
                        if (latestNonFinalIsProvisionalCarry) {
                            const prevCarry = previousNonFinalText.trim();
                            const incoming = rebuiltNonFinalText.trim();
                            const hasProgress = incoming.length > prevCarry.length || !incoming.startsWith(prevCarry);
                            if (hasProgress) {
                                latestNonFinalIsProvisionalCarry = false;
                            }
                        }
                        latestNonFinalText = rebuiltNonFinalText;
                        // 부분 결과: 확정된 텍스트 + 미확정 텍스트
                        const fullText = composeTurnText(finalizedText, rebuiltNonFinalText);
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
                    } else if (!latestNonFinalIsProvisionalCarry) {
                        // Non-final snapshot이 빈 경우 기존 tail을 지워 stale carry가 남지 않도록 함.
                        latestNonFinalText = '';
                    }

                    const previousMergedSnapshot = composeTurnText(previousFinalizedText, previousNonFinalText);
                    const mergedSnapshot = composeTurnText(finalizedText, latestNonFinalText);
                    sonioxCurrentMergedTextLen = mergedSnapshot.length;
                    const previousMergedTextForIdle = stripEndpointMarkers(previousMergedSnapshot);
                    const mergedTextForIdle = stripEndpointMarkers(mergedSnapshot);
                    sonioxHasPendingTranscript = mergedSnapshot.length > 0
                        && !(latestNonFinalIsProvisionalCarry && !finalizedText.trim());
                    const transcriptAdded = mergedTextForIdle.length > previousMergedTextForIdle.length;
                    if (transcriptAdded) {
                        // Re-arm manual finalize only when transcript text is added.
                        sonioxManualFinalizeSent = false;
                        scheduleSonioxManualFinalizeFromTranscriptProgress();
                    } else if (!sonioxHasPendingTranscript) {
                        clearSonioxManualFinalizeTimer();
                    }

                    // 발화 완료 판단:
                    // Soniox endpoint(<end>/<fin>) 토큰이 포함된 경우에만 완료 처리
                    const mergedHasEndpointMarker = /<\/?(?:end|fin)>/i.test(mergedSnapshot);
                    const hasPendingTextSnapshot = stripEndpointMarkers(mergedSnapshot).trim().length > 0;
                    let endpointFinalized = false;
                    let endpointFinalText = '';
                    let endpointCarryText = '';
                    if (hasEndpointToken && (hasProgressTokenBeyondWatermark || mergedHasEndpointMarker || hasPendingTextSnapshot)) {
                        const mergedAtEndpoint = composeTurnText(finalizedText, latestNonFinalText);

                        // --- Snapshot-based split ---
                        // When we sent { type: 'finalize' } to Soniox, we recorded
                        // the length of merged text (`finalized + non-final`) at
                        // that instant. Any text added after that boundary belongs
                        // to the next utterance, even if Soniox reports endpoint
                        // markers later in the same burst.
                        let finalTextToEmit: string;
                        let carryTextToEmit: string;
                        let usedSnapshotBoundary = false;

                        if (sonioxFinalizeSnapshotTextLen !== null && sonioxFinalizeSnapshotTextLen >= 0) {
                            // Use merged text boundary so pre-finalize non-final tail
                            // stays in the finalized utterance instead of leaking.
                            let snapshotBoundary = Math.min(
                                Math.max(0, sonioxFinalizeSnapshotTextLen),
                                mergedAtEndpoint.length,
                            );

                            // --- Word-boundary snap-forward ---
                            // Only snap-forward when the split is inside an ASCII word.
                            // For no-space scripts, keep raw boundary to avoid moving
                            // the entire suffix into current final utterance.
                            snapshotBoundary = snapBoundaryForwardInsideAsciiWord(
                                mergedAtEndpoint,
                                snapshotBoundary,
                            );

                            const textUpToSnapshot = mergedAtEndpoint.slice(0, snapshotBoundary);
                            const textAfterSnapshot = mergedAtEndpoint.slice(snapshotBoundary);

                            // The utterance text is: snapshot prefix + endpoint marker.
                            // Carry is: text added after snapshot boundary.
                            const marker = extractFirstEndpointMarker(mergedAtEndpoint);
                            finalTextToEmit = `${stripEndpointMarkers(textUpToSnapshot).trim()}${marker}`.trim();
                            carryTextToEmit = stripEndpointMarkers(textAfterSnapshot).trim();
                            usedSnapshotBoundary = true;
                            sonioxFinalizeSnapshotTextLen = null;
                        } else {
                            // No snapshot (e.g. Soniox-initiated endpoint, not our
                            // manual finalize).  Fall back to marker-position split.
                            const split = splitTurnAtFirstEndpointMarker(mergedAtEndpoint);
                            finalTextToEmit = split.finalText;
                            carryTextToEmit = split.carryText;
                        }

                        if (!stripEndpointMarkers(finalTextToEmit).trim() && carryTextToEmit && !usedSnapshotBoundary) {
                            // Some Soniox finalize bursts can place endpoint marker before stale non-final tail.
                            // Recover readable final text as "<tail><fin>" instead of marker-only final.
                            finalTextToEmit = `${carryTextToEmit}${extractFirstEndpointMarker(finalTextToEmit)}`.trim();
                            carryTextToEmit = '';
                        }

                        if (stripEndpointMarkers(finalTextToEmit).trim()) {
                            emitFinalTurn(finalTextToEmit, detectedLang);
                            endpointFinalized = true;
                            endpointFinalText = finalTextToEmit;
                        } else {
                            // Ignore marker-only finals to avoid <fin>-only bubble floods.
                            finalizedText = '';
                            sonioxCurrentMergedTextLen = 0;
                            latestNonFinalText = '';
                            latestNonFinalIsProvisionalCarry = false;
                            resetSonioxSegmentState();
                        }

                        // Keep trailing text after endpoint marker as next-turn partial
                        // so it does not contaminate the just-finished final turn.
                        if (carryTextToEmit) {
                            endpointCarryText = carryTextToEmit;
                            latestNonFinalText = carryTextToEmit;
                            latestNonFinalIsProvisionalCarry = true;
                            // Keep the normal finalize state untouched — carry is
                            // provisional and does NOT count as pending transcript
                            // for the normal finalize flow.
                            sonioxHasPendingTranscript = false;
                            sonioxManualFinalizeSent = true;
                            clearSonioxManualFinalizeTimer();

                            // --- Carry expiry ---
                            // If no new speech arrives within silence+cooldown,
                            // finalize the carry as its own utterance.
                            clearSonioxCarryExpiryTimer();
                            const carryExpiryMs = SONIOX_MANUAL_FINALIZE_SILENCE_MS + SONIOX_MANUAL_FINALIZE_COOLDOWN_MS;
                            sonioxCarryExpiryTimer = setTimeout(() => {
                                sonioxCarryExpiryTimer = null;
                                // Only fire if carry is still pending (hasn't been
                                // promoted or consumed by new speech).
                                if (
                                    latestNonFinalIsProvisionalCarry
                                    && latestNonFinalText.trim()
                                    && !finalizedText.trim()
                                ) {
                                    const carryText = composeTurnText('', latestNonFinalText);
                                    if (carryText) {
                                        emitFinalTurn(carryText, detectedLang);
                                    }
                                }
                            }, carryExpiryMs);

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
                        } else {
                            latestNonFinalIsProvisionalCarry = false;
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
            clearSonioxManualFinalizeTimer();

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
    console.log(
        `[stt-server] soniox_finalize_tuning silenceMs=${SONIOX_MANUAL_FINALIZE_SILENCE_MS} cooldownMs=${SONIOX_MANUAL_FINALIZE_COOLDOWN_MS}`,
    );
});
