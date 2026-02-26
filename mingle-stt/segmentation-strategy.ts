// ===== 발화 분리 전략 인터페이스 =====

// ===== 발화 분리 전략 인터페이스 =====

export type SegmentationStrategyId = 'soniox-endpoint' | 'silence-timer' | 'llm-segmentation';

export interface TokenFrameContext {
    /** 현재까지 확정된 텍스트 (endpoint 마커 포함 가능) */
    finalizedText: string;
    /** 현재 미확정 텍스트 */
    nonFinalText: string;
    /** 이번 프레임에 endpoint 마커 토큰이 포함되었는지 */
    hasEndpointMarker: boolean;
    /** endpoint 마커 텍스트 (예: "<fin>") */
    endpointMarkerText: string;
    /** 마커 제외 실제 텍스트가 존재하는지 */
    hasTextContent: boolean;
    /** 이번 프레임에서 watermark 이후 진행 토큰이 있었는지 */
    hasProgressTokenBeyondWatermark: boolean;
    /** 이전 프레임까지 pending 텍스트가 있었는지 */
    hadPendingTextBeforeFrame: boolean;
    /** 감지된 언어 */
    detectedLanguage: string;
    /** carry인 non-final인지 */
    isProvisionalCarry: boolean;
}

export type SegmentationDecision =
    | { action: 'none' }
    | { action: 'finalize'; text: string; carryText: string }
    | { action: 'send-finalize-command' };

export interface SegmentationStrategy {
    readonly id: SegmentationStrategyId;
    /** Soniox 초기 설정에 반영할 오버라이드 */
    sonioxConfigOverrides(): Record<string, unknown>;
    /**
     * 각 토큰 프레임 수신 시 호출.
     * 현재 누적 상태를 기반으로 finalize 여부를 판단한다.
     */
    onTokenFrame(ctx: TokenFrameContext): SegmentationDecision;
    /**
     * transcript 길이가 변했을 때(또는 변하지 않았을 때) 호출.
     * silence timer 등 시간 기반 전략에서 사용.
     */
    onTranscriptProgress(hasPendingTranscript: boolean, transcriptAdded: boolean): void;
    /** 리소스 정리 */
    dispose(): void;
}

// ===== helper =====

export function stripEndpointMarkers(text: string): string {
    return text.replace(/<\/?(?:end|fin)>/gi, '');
}

export function extractFirstEndpointMarker(text: string): string {
    const match = /<\/?(?:end|fin)>/i.exec(text);
    return match ? match[0] : '<fin>';
}

export function splitTurnAtFirstEndpointMarker(text: string): { finalText: string; carryText: string } {
    const markerMatch = /<\/?(?:end|fin)>/i.exec(text);
    if (!markerMatch) {
        return { finalText: text.trim(), carryText: '' };
    }
    const markerEndIndex = markerMatch.index + markerMatch[0].length;
    return {
        finalText: text.slice(0, markerEndIndex).trim(),
        carryText: text.slice(markerEndIndex).trim(),
    };
}

// ===== 전략 A: Soniox Endpoint =====

export class SonioxEndpointStrategy implements SegmentationStrategy {
    readonly id: SegmentationStrategyId = 'soniox-endpoint';

    sonioxConfigOverrides(): Record<string, unknown> {
        return { enable_endpoint_detection: true };
    }

    onTokenFrame(ctx: TokenFrameContext): SegmentationDecision {
        if (!ctx.hasEndpointMarker) return { action: 'none' };

        const mergedHasEndpointMarker = /<\/?(?:end|fin)>/i.test(
            `${ctx.finalizedText}${ctx.nonFinalText}`,
        );
        const hasPendingTextSnapshot = stripEndpointMarkers(
            `${ctx.finalizedText}${ctx.nonFinalText}`,
        ).trim().length > 0;

        if (!(ctx.hasProgressTokenBeyondWatermark || mergedHasEndpointMarker || hasPendingTextSnapshot)) {
            return { action: 'none' };
        }

        const mergedAtEndpoint = `${ctx.finalizedText || ''}${ctx.nonFinalText || ''}`.trim();
        const { finalText, carryText } = splitTurnAtFirstEndpointMarker(mergedAtEndpoint);
        let finalTextToEmit = finalText;
        let carryTextToEmit = carryText;

        if (!stripEndpointMarkers(finalTextToEmit).trim() && carryTextToEmit) {
            finalTextToEmit = `${carryTextToEmit}${extractFirstEndpointMarker(finalTextToEmit)}`.trim();
            carryTextToEmit = '';
        }

        if (!stripEndpointMarkers(finalTextToEmit).trim()) {
            return { action: 'none' };
        }

        return { action: 'finalize', text: finalTextToEmit, carryText: carryTextToEmit };
    }

    onTranscriptProgress(_hasPendingTranscript: boolean, _transcriptAdded: boolean): void {
        // Soniox endpoint 전략은 transcript progress를 사용하지 않음
    }

    dispose(): void {
        // no-op
    }
}

// ===== 전략 B: Silence Timer =====

export interface SilenceTimerStrategyOptions {
    silenceMs: number;
    cooldownMs: number;
    sendFinalize: () => void;
}

export class SilenceTimerStrategy implements SegmentationStrategy {
    readonly id: SegmentationStrategyId = 'silence-timer';
    private silenceMs: number;
    private cooldownMs: number;
    private sendFinalize: () => void;

    private timer: NodeJS.Timeout | null = null;
    private dueAtMs = 0;
    private hasPendingTranscript = false;
    private manualFinalizeSent = false;
    private lastManualFinalizeAtMs = 0;
    private lastTranscriptProgressAtMs = 0;

    constructor(opts: SilenceTimerStrategyOptions) {
        this.silenceMs = opts.silenceMs;
        this.cooldownMs = opts.cooldownMs;
        this.sendFinalize = opts.sendFinalize;
    }

    sonioxConfigOverrides(): Record<string, unknown> {
        return { enable_endpoint_detection: false };
    }

    onTokenFrame(ctx: TokenFrameContext): SegmentationDecision {
        // Silence timer는 endpoint 마커를 사용할 수도 있음 (Soniox가 manual finalize 후
        // 응답에 마커를 보내면). 이 경우도 해석한다.
        if (!ctx.hasEndpointMarker) return { action: 'none' };

        const mergedHasEndpointMarker = /<\/?(?:end|fin)>/i.test(
            `${ctx.finalizedText}${ctx.nonFinalText}`,
        );
        const hasPendingTextSnapshot = stripEndpointMarkers(
            `${ctx.finalizedText}${ctx.nonFinalText}`,
        ).trim().length > 0;

        if (!(ctx.hasProgressTokenBeyondWatermark || mergedHasEndpointMarker || hasPendingTextSnapshot)) {
            return { action: 'none' };
        }

        const mergedAtEndpoint = `${ctx.finalizedText || ''}${ctx.nonFinalText || ''}`.trim();
        const { finalText, carryText } = splitTurnAtFirstEndpointMarker(mergedAtEndpoint);
        let finalTextToEmit = finalText;
        let carryTextToEmit = carryText;

        if (!stripEndpointMarkers(finalTextToEmit).trim() && carryTextToEmit) {
            finalTextToEmit = `${carryTextToEmit}${extractFirstEndpointMarker(finalTextToEmit)}`.trim();
            carryTextToEmit = '';
        }

        if (!stripEndpointMarkers(finalTextToEmit).trim()) {
            return { action: 'none' };
        }

        return { action: 'finalize', text: finalTextToEmit, carryText: carryTextToEmit };
    }

    onTranscriptProgress(hasPendingTranscript: boolean, transcriptAdded: boolean): void {
        this.hasPendingTranscript = hasPendingTranscript;

        if (!hasPendingTranscript) {
            this.clearTimer();
            return;
        }

        if (transcriptAdded) {
            this.manualFinalizeSent = false;
            this.lastTranscriptProgressAtMs = Date.now();
            this.scheduleCheck();
        }
    }

    /** cleanup, resetSonioxSegmentState 에서 호출 */
    resetState(): void {
        this.clearTimer();
        this.hasPendingTranscript = false;
        this.manualFinalizeSent = false;
        this.lastManualFinalizeAtMs = 0;
        this.lastTranscriptProgressAtMs = 0;
    }

    dispose(): void {
        this.clearTimer();
    }

    // --- internal ---

    private clearTimer(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.dueAtMs = 0;
    }

    private scheduleCheck(): void {
        if (this.manualFinalizeSent) return;
        const waitMs = this.silenceMs;
        this.clearTimer();
        this.timer = setTimeout(() => this.maybeTrigger(), waitMs);
        this.dueAtMs = Date.now() + waitMs;
    }

    private maybeTrigger(): void {
        if (!this.hasPendingTranscript) {
            this.clearTimer();
            return;
        }
        if (this.manualFinalizeSent) return;

        const now = Date.now();
        if (this.lastTranscriptProgressAtMs <= 0) {
            this.lastTranscriptProgressAtMs = now;
        }

        const elapsedSinceProgress = now - this.lastTranscriptProgressAtMs;
        if (elapsedSinceProgress < this.silenceMs) {
            const waitMs = Math.max(1, this.silenceMs - elapsedSinceProgress);
            this.clearTimer();
            this.timer = setTimeout(() => this.maybeTrigger(), waitMs);
            this.dueAtMs = now + waitMs;
            return;
        }

        const elapsedSinceLastFinalize = now - this.lastManualFinalizeAtMs;
        if (elapsedSinceLastFinalize < this.cooldownMs) {
            const waitMs = Math.max(1, this.cooldownMs - elapsedSinceLastFinalize);
            this.clearTimer();
            this.timer = setTimeout(() => this.maybeTrigger(), waitMs);
            this.dueAtMs = now + waitMs;
            return;
        }

        this.manualFinalizeSent = true;
        this.lastManualFinalizeAtMs = now;
        this.clearTimer();
        this.sendFinalize();
    }
}

// ===== Factory =====

const STRATEGY_ENV_KEY = 'SONIOX_SEGMENTATION_STRATEGY';

export function readSegmentationStrategyId(): SegmentationStrategyId {
    const raw = (process.env[STRATEGY_ENV_KEY] || '').trim().toLowerCase();
    if (raw === 'soniox-endpoint') return 'soniox-endpoint';
    if (raw === 'llm-segmentation') return 'llm-segmentation';
    return 'silence-timer'; // default
}

export function createSegmentationStrategy(
    id: SegmentationStrategyId,
    opts: {
        silenceMs: number;
        cooldownMs: number;
        sendFinalize: () => void;
    },
): SegmentationStrategy {
    switch (id) {
        case 'soniox-endpoint':
            return new SonioxEndpointStrategy();
        case 'silence-timer':
            return new SilenceTimerStrategy({
                silenceMs: opts.silenceMs,
                cooldownMs: opts.cooldownMs,
                sendFinalize: opts.sendFinalize,
            });
        case 'llm-segmentation':
            // Phase 2: LLM 전략 — 현재는 silence-timer를 fallback으로 사용
            console.warn(`[stt-server] llm-segmentation not yet implemented, falling back to silence-timer`);
            return new SilenceTimerStrategy({
                silenceMs: opts.silenceMs,
                cooldownMs: opts.cooldownMs,
                sendFinalize: opts.sendFinalize,
            });
        default:
            return new SilenceTimerStrategy({
                silenceMs: opts.silenceMs,
                cooldownMs: opts.cooldownMs,
                sendFinalize: opts.sendFinalize,
            });
    }
}
