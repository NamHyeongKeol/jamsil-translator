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
const SONIOX_SPEAKER_IDLE_FINALIZE_MS = (() => {
    const fallback = Math.max(4500, SONIOX_MANUAL_FINALIZE_SILENCE_MS + 3500);
    const raw = Number(process.env.SONIOX_SPEAKER_IDLE_FINALIZE_MS || String(fallback));
    if (!Number.isFinite(raw)) return fallback;
    return Math.max(2500, Math.min(12000, Math.floor(raw)));
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
    speaker?: string;
}

interface SonioxSpeakerTurnState {
    speaker: string;
    finalizedText: string;
    latestNonFinalText: string;
    latestNonFinalIsProvisionalCarry: boolean;
    lastActivityAtMs: number;
    lastFinalizedEndMs: number;
    detectedLang: string;
    finalizeSnapshotTextLen: number | null;
    currentMergedTextLen: number;
    carryExpiryTimer: NodeJS.Timeout | null;
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
    let sonioxSpeakerStates = new Map<string, SonioxSpeakerTurnState>();
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
        for (const state of sonioxSpeakerStates.values()) {
            if (state.carryExpiryTimer) {
                clearTimeout(state.carryExpiryTimer);
                state.carryExpiryTimer = null;
            }
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
        sonioxSpeakerStates.clear();
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
        sonioxSpeakerStates.clear();
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
            for (const state of sonioxSpeakerStates.values()) {
                state.finalizeSnapshotTextLen = state.currentMergedTextLen;
            }
            sonioxFinalizeSnapshotTextLen = sonioxCurrentMergedTextLen;
            sttWs.send(JSON.stringify({ type: 'finalize' }));
            sonioxManualFinalizeSent = true;
            sonioxLastManualFinalizeAtMs = now;
            clearSonioxManualFinalizeTimer();
        } catch (error) {
            console.error('Soniox manual finalize send failed:', error);
            for (const state of sonioxSpeakerStates.values()) {
                state.finalizeSnapshotTextLen = null;
            }
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
            sonioxStopRequested = false;
            sonioxSpeakerStates = new Map<string, SonioxSpeakerTurnState>();
            let lastObservedSpeakerId = 'speaker_unknown';
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

            const normalizeSpeakerId = (rawSpeaker: unknown): string | null => {
                if (typeof rawSpeaker !== 'string') return null;
                const speaker = rawSpeaker.trim().toLowerCase();
                if (!speaker) return null;

                const numeric = /^(\d+)$/.exec(speaker);
                if (numeric) return `speaker_${String(Number(numeric[1]))}`;

                const speakerWithNumber = /^speaker(?:[_\s-]+)?(\d+)$/.exec(speaker);
                if (speakerWithNumber) return `speaker_${String(Number(speakerWithNumber[1]))}`;
                const shortSpeakerWithNumber = /^(?:s|spk)(?:[_\s-]+)?(\d+)$/.exec(speaker);
                if (shortSpeakerWithNumber) return `speaker_${String(Number(shortSpeakerWithNumber[1]))}`;

                const sanitized = speaker.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                if (!sanitized) return null;
                if (sanitized.startsWith('speaker_')) return sanitized;
                if (sanitized === 'speaker') return null;
                return `speaker_${sanitized}`;
            };

            const getSpeakerFromToken = (token: Record<string, unknown>): string => {
                const fromToken = normalizeSpeakerId(
                    token.speaker
                    ?? token.speaker_id
                    ?? token.speakerId
                    ?? token.spk
                    ?? token.diarization_speaker,
                );
                if (fromToken) {
                    lastObservedSpeakerId = fromToken;
                    return fromToken;
                }
                return lastObservedSpeakerId || 'speaker_unknown';
            };

            const clearSpeakerState = (state: SonioxSpeakerTurnState) => {
                state.finalizedText = '';
                state.latestNonFinalText = '';
                state.latestNonFinalIsProvisionalCarry = false;
                state.finalizeSnapshotTextLen = null;
                state.currentMergedTextLen = 0;
                if (state.carryExpiryTimer) {
                    clearTimeout(state.carryExpiryTimer);
                    state.carryExpiryTimer = null;
                }
            };

            const ensureSpeakerState = (speaker: string, languageFallback?: string): SonioxSpeakerTurnState => {
                const normalizedSpeaker = normalizeSpeakerId(speaker) || 'speaker_unknown';
                const existing = sonioxSpeakerStates.get(normalizedSpeaker);
                if (existing) {
                    if (languageFallback && languageFallback.trim()) {
                        existing.detectedLang = languageFallback.trim();
                    }
                    return existing;
                }
                const created: SonioxSpeakerTurnState = {
                    speaker: normalizedSpeaker,
                    finalizedText: '',
                    latestNonFinalText: '',
                    latestNonFinalIsProvisionalCarry: false,
                    lastActivityAtMs: 0,
                    lastFinalizedEndMs: -1,
                    detectedLang: (languageFallback || config.languages[0] || 'unknown').trim() || 'unknown',
                    finalizeSnapshotTextLen: null,
                    currentMergedTextLen: 0,
                    carryExpiryTimer: null,
                };
                sonioxSpeakerStates.set(normalizedSpeaker, created);
                return created;
            };

            const emitPartialTurn = (speaker: string, text: string, language: string) => {
                if (clientWs.readyState !== WebSocket.OPEN) return;
                const cleanedText = text.trim();
                if (!cleanedText) return;
                clientWs.send(JSON.stringify({
                    type: 'transcript',
                    data: {
                        is_final: false,
                        utterance: {
                            text: cleanedText,
                            language: (language || '').trim() || 'unknown',
                            speaker,
                        },
                    },
                }));
            };

            const emitFinalTurn = (speaker: string, text: string, language: string): FinalTurnPayload | null => {
                // Keep endpoint markers in server-emitted text; client normalizes them away.
                const cleanedText = text.trim();
                const cleanedLang = (language || '').trim() || 'unknown';
                const cleanedSpeaker = normalizeSpeakerId(speaker) || 'speaker_unknown';
                if (!cleanedText) return null;

                const state = ensureSpeakerState(cleanedSpeaker, cleanedLang);
                clearSpeakerState(state);

                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                        type: 'transcript',
                        data: {
                            is_final: true,
                            utterance: {
                                text: cleanedText,
                                language: cleanedLang,
                                speaker: cleanedSpeaker,
                            },
                        },
                    }));
                }

                return {
                    text: cleanedText,
                    language: cleanedLang,
                    speaker: cleanedSpeaker,
                };
            };

            finalizePendingTurnFromProvider = async () => {
                const finalizedTurns: FinalTurnPayload[] = [];
                for (const state of sonioxSpeakerStates.values()) {
                    if (state.latestNonFinalIsProvisionalCarry && !state.finalizedText.trim()) {
                        continue;
                    }
                    const merged = composeTurnText(state.finalizedText, state.latestNonFinalText);
                    if (!merged) continue;
                    const finalized = emitFinalTurn(state.speaker, merged, state.detectedLang);
                    if (finalized) {
                        finalizedTurns.push(finalized);
                    }
                }
                sonioxHasPendingTranscript = false;
                clearSonioxManualFinalizeTimer();
                return finalizedTurns[0] ?? null;
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
                        speaker?: unknown;
                        speaker_id?: unknown;
                        speakerId?: unknown;
                        spk?: unknown;
                        diarization_speaker?: unknown;
                    };
                    const tokens = (Array.isArray(msg.tokens) ? msg.tokens : []) as SonioxToken[];
                    if (tokens.length === 0) {
                        return;
                    }
                    const frameNow = Date.now();

                    const tokensBySpeaker = new Map<string, SonioxToken[]>();
                    for (const token of tokens) {
                        const speaker = getSpeakerFromToken(token as unknown as Record<string, unknown>);
                        const grouped = tokensBySpeaker.get(speaker);
                        if (grouped) {
                            grouped.push(token);
                        } else {
                            tokensBySpeaker.set(speaker, [token]);
                        }
                    }

                    let hadTranscriptProgress = false;
                    let hasProvisionalCarryInFrame = false;
                    const speakersWithActivityInFrame = new Set<string>();

                    for (const [speaker, speakerTokens] of tokensBySpeaker.entries()) {
                        const state = ensureSpeakerState(speaker);
                        const previousFinalizedText = state.finalizedText;
                        const previousNonFinalText = state.latestNonFinalText;
                        const hadPendingTextBeforeFrame = composeTurnText(previousFinalizedText, previousNonFinalText).length > 0;
                        let newFinalText = '';
                        let rebuiltNonFinalText = '';
                        let maxSeenFinalEndMs = state.lastFinalizedEndMs;
                        let hasEndpointToken = false;
                        let endpointMarkerText = '';
                        let hasProgressTokenBeyondWatermark = false;
                        let hasTimestampedProgressBeyondWatermark = false;

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

                        let rawFinalStartMs: number | null = null;
                        let rawFinalEndMs: number | null = null;
                        let rawNonFinalStartMs: number | null = null;
                        let rawNonFinalEndMs: number | null = null;

                        for (const token of speakerTokens) {
                            if (typeof token.language === 'string' && token.language.trim()) {
                                state.detectedLang = token.language.trim();
                            }
                            const tokenText = typeof token.text === 'string' ? token.text : '';
                            if (!tokenText) continue;
                            const tokenStartMs = parseTokenTimeMs(token.start_ms);
                            const tokenEndMs = parseTokenTimeMs(token.end_ms);

                            const isEndpointMarkerToken = /<\/?(?:end|fin)>/i.test(tokenText);
                            if (isEndpointMarkerToken) {
                                hasEndpointToken = true;
                                if (!endpointMarkerText) {
                                    endpointMarkerText = tokenText;
                                }
                                continue;
                            }

                            if (token.is_final === true) {
                                const mergedRange = mergeTokenTimeRange(
                                    rawFinalStartMs,
                                    rawFinalEndMs,
                                    tokenStartMs,
                                    tokenEndMs,
                                );
                                rawFinalStartMs = mergedRange.nextStartMs;
                                rawFinalEndMs = mergedRange.nextEndMs;
                            } else {
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
                                state.lastFinalizedEndMs,
                            );

                            if (token.is_final === true) {
                                if (!includeByWatermark) continue;
                                newFinalText += tokenText;
                                hasProgressTokenBeyondWatermark = true;
                                if (isTokenTimestampedBeyondWatermark(tokenStartMs, tokenEndMs, state.lastFinalizedEndMs)) {
                                    hasTimestampedProgressBeyondWatermark = true;
                                }
                                if (tokenEndMs !== null && tokenEndMs > maxSeenFinalEndMs) {
                                    maxSeenFinalEndMs = tokenEndMs;
                                }
                            } else {
                                if (!includeByWatermark) continue;
                                rebuiltNonFinalText += tokenText;
                                hasProgressTokenBeyondWatermark = true;
                                if (isTokenTimestampedBeyondWatermark(tokenStartMs, tokenEndMs, state.lastFinalizedEndMs)) {
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
                        // After a snapshot-based endpoint split, carry text is parked
                        // as provisional. Promote it when timestamped progress arrives.
                        if (state.latestNonFinalIsProvisionalCarry && previousNonFinalText.trim()) {
                            const carryRaw = stripEndpointMarkers(previousNonFinalText).trim();
                            if (carryRaw && hasTimestampedProgressBeyondWatermark) {
                                if (state.carryExpiryTimer) {
                                    clearTimeout(state.carryExpiryTimer);
                                    state.carryExpiryTimer = null;
                                }
                                const incomingClean = stripEndpointMarkers(
                                    `${stripEndpointMarkers(newFinalText)}${rebuiltNonFinalText}`,
                                ).trim();
                                if (incomingClean.startsWith(carryRaw)) {
                                    state.latestNonFinalIsProvisionalCarry = false;
                                } else {
                                    const carryPrefix = carryRaw.replace(/[.!?]+\s*$/, '').trim();
                                    if (carryPrefix) {
                                        state.finalizedText = carryPrefix + ' ' + state.finalizedText;
                                    }
                                    state.latestNonFinalIsProvisionalCarry = false;
                                }
                            }
                        }

                        if (newFinalText) {
                            state.finalizedText += newFinalText;
                            if (maxSeenFinalEndMs > state.lastFinalizedEndMs) {
                                state.lastFinalizedEndMs = maxSeenFinalEndMs;
                            }
                        }

                        if (rebuiltNonFinalText) {
                            if (state.latestNonFinalIsProvisionalCarry) {
                                const prevCarry = previousNonFinalText.trim();
                                const incoming = rebuiltNonFinalText.trim();
                                const hasProgress = incoming.length > prevCarry.length || !incoming.startsWith(prevCarry);
                                if (hasProgress) {
                                    state.latestNonFinalIsProvisionalCarry = false;
                                }
                            }
                            state.latestNonFinalText = rebuiltNonFinalText;
                            const fullText = composeTurnText(state.finalizedText, rebuiltNonFinalText);
                            emitPartialTurn(state.speaker, fullText, state.detectedLang);
                        } else if (!state.latestNonFinalIsProvisionalCarry) {
                            state.latestNonFinalText = '';
                        }

                        const previousMergedSnapshot = composeTurnText(previousFinalizedText, previousNonFinalText);
                        const mergedSnapshot = composeTurnText(state.finalizedText, state.latestNonFinalText);
                        state.currentMergedTextLen = mergedSnapshot.length;
                        const previousMergedTextForIdle = stripEndpointMarkers(previousMergedSnapshot);
                        const mergedTextForIdle = stripEndpointMarkers(mergedSnapshot);
                        if (mergedTextForIdle !== previousMergedTextForIdle) {
                            state.lastActivityAtMs = frameNow;
                            speakersWithActivityInFrame.add(state.speaker);
                        }
                        const transcriptAdded = mergedTextForIdle.length > previousMergedTextForIdle.length;
                        if (transcriptAdded) {
                            hadTranscriptProgress = true;
                        }

                        // 발화 완료 판단:
                        // Soniox endpoint(<end>/<fin>) 토큰이 포함된 경우에만 완료 처리
                        const mergedHasEndpointMarker = /<\/?(?:end|fin)>/i.test(mergedSnapshot);
                        const hasPendingTextSnapshot = stripEndpointMarkers(mergedSnapshot).trim().length > 0;
                        if (hasEndpointToken && (hasProgressTokenBeyondWatermark || mergedHasEndpointMarker || hasPendingTextSnapshot)) {
                            const mergedAtEndpoint = composeTurnText(state.finalizedText, state.latestNonFinalText);

                            // --- Snapshot-based split ---
                            // When we send { type: 'finalize' }, we capture merged
                            // text length and keep suffix as carry.
                            let finalTextToEmit: string;
                            let carryTextToEmit: string;
                            let usedSnapshotBoundary = false;

                            if (state.finalizeSnapshotTextLen !== null && state.finalizeSnapshotTextLen >= 0) {
                                let snapshotBoundary = Math.min(
                                    Math.max(0, state.finalizeSnapshotTextLen),
                                    mergedAtEndpoint.length,
                                );
                                snapshotBoundary = snapBoundaryForwardInsideAsciiWord(
                                    mergedAtEndpoint,
                                    snapshotBoundary,
                                );

                                const textUpToSnapshot = mergedAtEndpoint.slice(0, snapshotBoundary);
                                const textAfterSnapshot = mergedAtEndpoint.slice(snapshotBoundary);
                                const marker = extractFirstEndpointMarker(mergedAtEndpoint);
                                finalTextToEmit = `${stripEndpointMarkers(textUpToSnapshot).trim()}${marker}`.trim();
                                carryTextToEmit = stripEndpointMarkers(textAfterSnapshot).trim();
                                usedSnapshotBoundary = true;
                                state.finalizeSnapshotTextLen = null;
                            } else {
                                const split = splitTurnAtFirstEndpointMarker(mergedAtEndpoint);
                                finalTextToEmit = split.finalText;
                                carryTextToEmit = split.carryText;
                            }

                            if (!stripEndpointMarkers(finalTextToEmit).trim() && carryTextToEmit && !usedSnapshotBoundary) {
                                finalTextToEmit = `${carryTextToEmit}${extractFirstEndpointMarker(finalTextToEmit)}`.trim();
                                carryTextToEmit = '';
                            }

                            if (stripEndpointMarkers(finalTextToEmit).trim()) {
                                emitFinalTurn(state.speaker, finalTextToEmit, state.detectedLang);
                            } else {
                                clearSpeakerState(state);
                            }

                            // Keep trailing text after endpoint marker as next-turn
                            // provisional partial.
                            if (carryTextToEmit) {
                                state.latestNonFinalText = carryTextToEmit;
                                state.latestNonFinalIsProvisionalCarry = true;
                                hasProvisionalCarryInFrame = true;
                                sonioxManualFinalizeSent = true;
                                clearSonioxManualFinalizeTimer();

                                if (state.carryExpiryTimer) {
                                    clearTimeout(state.carryExpiryTimer);
                                    state.carryExpiryTimer = null;
                                }
                                const carryExpiryMs = SONIOX_MANUAL_FINALIZE_SILENCE_MS + SONIOX_MANUAL_FINALIZE_COOLDOWN_MS;
                                state.carryExpiryTimer = setTimeout(() => {
                                    state.carryExpiryTimer = null;
                                    if (
                                        state.latestNonFinalIsProvisionalCarry
                                        && state.latestNonFinalText.trim()
                                        && !state.finalizedText.trim()
                                    ) {
                                        const carryText = composeTurnText('', state.latestNonFinalText);
                                        if (carryText) {
                                            emitFinalTurn(state.speaker, carryText, state.detectedLang);
                                        }
                                    }
                                }, carryExpiryMs);

                                emitPartialTurn(state.speaker, carryTextToEmit, state.detectedLang);
                            } else {
                                state.latestNonFinalIsProvisionalCarry = false;
                            }
                        }
                    }

                    for (const state of sonioxSpeakerStates.values()) {
                        if (speakersWithActivityInFrame.has(state.speaker)) continue;
                        if (state.lastActivityAtMs <= 0) continue;
                        const idleMs = frameNow - state.lastActivityAtMs;
                        if (idleMs < SONIOX_SPEAKER_IDLE_FINALIZE_MS) continue;
                        if (state.latestNonFinalIsProvisionalCarry && !state.finalizedText.trim()) continue;
                        const merged = composeTurnText(state.finalizedText, state.latestNonFinalText);
                        if (!merged) continue;
                        emitFinalTurn(state.speaker, merged, state.detectedLang);
                    }

                    sonioxCurrentMergedTextLen = Array.from(sonioxSpeakerStates.values())
                        .reduce((sum, state) => sum + state.currentMergedTextLen, 0);
                    sonioxHasPendingTranscript = Array.from(sonioxSpeakerStates.values()).some((state) => {
                        const mergedSnapshot = composeTurnText(state.finalizedText, state.latestNonFinalText);
                        return mergedSnapshot.length > 0
                            && !(state.latestNonFinalIsProvisionalCarry && !state.finalizedText.trim());
                    });
                    if (hasProvisionalCarryInFrame) {
                        sonioxManualFinalizeSent = true;
                        clearSonioxManualFinalizeTimer();
                    } else if (hadTranscriptProgress) {
                        sonioxManualFinalizeSent = false;
                        scheduleSonioxManualFinalizeFromTranscriptProgress();
                    } else if (!sonioxHasPendingTranscript) {
                        clearSonioxManualFinalizeTimer();
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

    const normalizeSpeakerIdForPayload = (rawSpeaker: unknown): string | undefined => {
        if (typeof rawSpeaker !== 'string') return undefined;
        const speaker = rawSpeaker.trim().toLowerCase();
        if (!speaker) return undefined;

        const numeric = /^(\d+)$/.exec(speaker);
        if (numeric) return `speaker_${String(Number(numeric[1]))}`;

        const speakerWithNumber = /^speaker(?:[_\s-]+)?(\d+)$/.exec(speaker);
        if (speakerWithNumber) return `speaker_${String(Number(speakerWithNumber[1]))}`;
        const shortSpeakerWithNumber = /^(?:s|spk)(?:[_\s-]+)?(\d+)$/.exec(speaker);
        if (shortSpeakerWithNumber) return `speaker_${String(Number(shortSpeakerWithNumber[1]))}`;

        const sanitized = speaker.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        if (!sanitized) return undefined;
        if (sanitized.startsWith('speaker_')) return sanitized;
        if (sanitized === 'speaker') return undefined;
        return `speaker_${sanitized}`;
    };

    const sendForcedFinalTurn = (rawText: string, rawLanguage: string, rawSpeaker?: string): FinalTurnPayload | null => {
        const text = (rawText || '').trim();
        const language = (rawLanguage || '').trim() || 'unknown';
        const speaker = normalizeSpeakerIdForPayload(rawSpeaker);
        if (!text) return null;

        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({
                type: 'transcript',
                data: {
                    is_final: true,
                    utterance: {
                        text,
                        language,
                        ...(speaker ? { speaker } : {}),
                    },
                },
            }));
        }

        return speaker ? { text, language, speaker } : { text, language };
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
            void (async () => {
                const pendingText = (data?.data?.pending_text || '').toString();
                const pendingLang = data?.data?.pending_language || selectedLanguages[0] || 'unknown';
                const pendingTurnsRaw = Array.isArray(data?.data?.pending_turns) ? data.data.pending_turns : [];
                const pendingTurns = pendingTurnsRaw
                    .map((item: any) => ({
                        text: (item?.text || '').toString().trim(),
                        language: (item?.language || '').toString().trim() || 'unknown',
                        speaker: typeof item?.speaker === 'string' ? item.speaker.trim() : '',
                    }))
                    .filter((item: { text: string; language: string; speaker: string }) => item.text.length > 0);
                const cleanedPendingText = pendingText.trim();
                sonioxStopRequested = currentModel === 'soniox';
                clearSonioxManualFinalizeTimer();

                const finalizedTurns: FinalTurnPayload[] = [];

                try {
                    // User-initiated stop: finalize what the user currently sees.
                    if (pendingTurns.length > 0) {
                        for (const turn of pendingTurns) {
                            const finalized = sendForcedFinalTurn(turn.text, turn.language, turn.speaker);
                            if (finalized) {
                                finalizedTurns.push(finalized);
                            }
                        }
                    } else if (cleanedPendingText) {
                        const finalized = sendForcedFinalTurn(pendingText, pendingLang);
                        if (finalized) {
                            finalizedTurns.push(finalized);
                        }
                    } else if (finalizePendingTurnFromProvider) {
                        const finalized = await finalizePendingTurnFromProvider();
                        if (finalized) {
                            finalizedTurns.push(finalized);
                        }
                    }
                } catch (stopError) {
                    console.error('Error finalizing pending turn on stop:', stopError);
                } finally {
                    if (sttWs && (sttWs.readyState === WebSocket.OPEN || sttWs.readyState === WebSocket.CONNECTING)) {
                        sttWs.close();
                    }

                    if (clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(JSON.stringify({
                            type: 'stop_recording_ack',
                            data: {
                                finalized: finalizedTurns.length > 0,
                                final_turn: finalizedTurns[0] || null,
                                final_turns: finalizedTurns,
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
                }
            })();
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
