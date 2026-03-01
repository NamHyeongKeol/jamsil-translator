/**
 * segmentation-strategy.ts
 *
 * 발화 분리(Utterance Segmentation) 전략 인터페이스와 구현체.
 *
 * 전략 선택: SONIOX_SEGMENTATION_STRATEGY 환경변수
 *   'silence-timer'    (기본값) — transcript 진행이 멈추면 finalize 명령 전송
 *   'soniox-endpoint'            — enable_endpoint_detection: true, Soniox 마커 기반
 *   'llm-segmentation'           — (Phase 2 미구현) silence-timer로 fallback
 */

// ===== 공용 헬퍼 =====

export const ENDPOINT_MARKER_RE = /<\/?(?:end|fin)>/i;
export const ENDPOINT_MARKER_RE_GLOBAL = /<\/?(?:end|fin)>/gi;

export function stripEndpointMarkers(text: string): string {
    return text.replace(ENDPOINT_MARKER_RE_GLOBAL, '');
}

export function extractFirstEndpointMarker(text: string): string {
    const match = ENDPOINT_MARKER_RE.exec(text);
    return match ? match[0] : '<fin>';
}

export function splitTurnAtFirstEndpointMarker(text: string): { finalText: string; carryText: string } {
    const markerMatch = ENDPOINT_MARKER_RE.exec(text);
    if (!markerMatch) {
        return { finalText: text.trim(), carryText: '' };
    }
    const markerEndIndex = markerMatch.index + markerMatch[0].length;
    return {
        finalText: text.slice(0, markerEndIndex).trim(),
        carryText: text.slice(markerEndIndex).trim(),
    };
}

// ===== 전략 타입 =====

export type SegmentationStrategyId = 'fin' | 'end' | 'llm';

/** onTokenFrame()이 돌려주는 결정 */
export type SegmentationDecision =
    | { action: 'none' }
    | {
          action: 'finalize';
          text: string;
          /** 마커 이후 텍스트 — 다음 발화의 carry로 쓸 것 */
          carryText: string;
          /** snapshot 기반으로 split한 경우 true — carry에 punctuation strip 不要 */
          usedSnapshotBoundary: boolean;
      }
    | { action: 'send-finalize-command' };

/**
 * 토큰 프레임 컨텍스트.
 * startSonioxConnection 내의 onmessage 핸들러가 구성해 전략에 전달한다.
 */
export interface TokenFrameContext {
    finalizedText: string;
    latestNonFinalText: string;
    /** composeTurnText(finalizedText, latestNonFinalText) */
    mergedSnapshot: string;
    /** 이번 프레임에 <end>/<fin> 마커 토큰이 있었는지 */
    hasEndpointToken: boolean;
    /** 첫 번째 마커 토큰 텍스트 */
    endpointMarkerText: string;
    hasProgressTokenBeyondWatermark: boolean;
    /** maybeTriggerSonioxManualFinalize 에서 기록한 finalize 직전 merged text 길이 */
    finalizeSnapshotTextLen: number | null;
    /** 이전 프레임 전까지 누적 텍스트가 있었는지 */
    hadPendingTextBeforeFrame: boolean;
}

/** 전략 인터페이스 */
export interface SegmentationStrategy {
    readonly id: SegmentationStrategyId;

    /** Soniox onopen 설정에 스프레드할 오버라이드 */
    sonioxConfigOverrides(): Record<string, unknown>;

    /**
     * manual finalize 직전 캡처한 merged text 길이 (snapshot 기반 split에 사용).
     * SonioxEndpointStrategy는 항상 null을 반환한다.
     */
    getSnapshotTextLen(): number | null;

    /**
     * 토큰 프레임 수신 후 호출.
     * endpoint 마커 감지 또는 snapshot 기반 split이 필요한지 판단.
     */
    onTokenFrame(ctx: TokenFrameContext): SegmentationDecision;

    /**
     * transcript 누적 텍스트 진행 여부 알림.
     * SilenceTimerStrategy는 이 콜백에서 타이머를 관리한다.
     */
    onTranscriptProgress(hasPending: boolean, added: boolean): void;

    /** cleanup / stop_recording 시 타이머 등 정리 */
    dispose(): void;
}

// ===== 공통: endpoint 마커 기반 finalize 판단 로직 =====
// SilenceTimerStrategy와 SonioxEndpointStrategy 둘 다 endpoint 마커가 도착하면 finalize한다.
// 차이는 마커가 어떤 경로로 오는가:
//   SilenceTimer  → 서버가 { type: 'finalize' } 보낸 후 Soniox가 <fin> 응답
//   SonioxEndpoint → enable_endpoint_detection=true 상태에서 Soniox가 자체 <end> 생성

function evaluateEndpointMarker(ctx: TokenFrameContext): SegmentationDecision {
    if (!ctx.hasEndpointToken) return { action: 'none' };

    const mergedHasEndpointMarker = ENDPOINT_MARKER_RE.test(ctx.mergedSnapshot);
    const hasPendingTextSnapshot =
        stripEndpointMarkers(ctx.mergedSnapshot).trim().length > 0;

    if (
        !ctx.hasProgressTokenBeyondWatermark &&
        !mergedHasEndpointMarker &&
        !hasPendingTextSnapshot
    ) {
        return { action: 'none' };
    }

    const mergedAtEndpoint = ctx.mergedSnapshot.trim();

    // --- Snapshot 기반 split (SilenceTimer 전략에서 manual finalize 후 도착한 <fin>) ---
    if (ctx.finalizeSnapshotTextLen !== null && ctx.finalizeSnapshotTextLen >= 0) {
        return buildSnapshotDecision(mergedAtEndpoint, ctx.finalizeSnapshotTextLen);
    }

    // --- 마커 위치 기반 split ---
    return buildMarkerDecision(mergedAtEndpoint);
}

function buildSnapshotDecision(mergedAtEndpoint: string, snapshotLen: number): SegmentationDecision {
    let snapshotBoundary = Math.min(Math.max(0, snapshotLen), mergedAtEndpoint.length);
    snapshotBoundary = snapBoundaryForwardInsideAsciiWord(mergedAtEndpoint, snapshotBoundary);

    const textUpToSnapshot = mergedAtEndpoint.slice(0, snapshotBoundary);
    const textAfterSnapshot = mergedAtEndpoint.slice(snapshotBoundary);

    const marker = extractFirstEndpointMarker(mergedAtEndpoint);
    const finalTextToEmit = `${stripEndpointMarkers(textUpToSnapshot).trim()}${marker}`.trim();
    const carryTextToEmit = stripEndpointMarkers(textAfterSnapshot).trim();

    if (!stripEndpointMarkers(finalTextToEmit).trim()) {
        return { action: 'none' };
    }

    return {
        action: 'finalize',
        text: finalTextToEmit,
        carryText: carryTextToEmit,
        usedSnapshotBoundary: true,
    };
}

function buildMarkerDecision(mergedAtEndpoint: string): SegmentationDecision {
    const { finalText, carryText } = splitTurnAtFirstEndpointMarker(mergedAtEndpoint);
    let finalTextToEmit = finalText;
    let carryTextToEmit = carryText;

    if (!stripEndpointMarkers(finalTextToEmit).trim() && carryTextToEmit) {
        // endpoint 마커가 텍스트 앞에 왔을 때 recover
        finalTextToEmit = `${carryTextToEmit}${extractFirstEndpointMarker(finalTextToEmit)}`.trim();
        carryTextToEmit = '';
    }

    if (!stripEndpointMarkers(finalTextToEmit).trim()) {
        return { action: 'none' };
    }

    return {
        action: 'finalize',
        text: finalTextToEmit,
        carryText: carryTextToEmit,
        usedSnapshotBoundary: false,
    };
}

function snapBoundaryForwardInsideAsciiWord(text: string, boundary: number): number {
    if (boundary <= 0 || boundary >= text.length) return boundary;
    const prevChar = text[boundary - 1] ?? '';
    const currChar = text[boundary] ?? '';
    const isAsciiWordChar = (c: string): boolean => /[A-Za-z0-9']/u.test(c);
    if (!isAsciiWordChar(prevChar) || !isAsciiWordChar(currChar)) return boundary;
    let snapped = boundary;
    while (snapped < text.length && isAsciiWordChar(text[snapped]!)) {
        snapped += 1;
    }
    return snapped;
}

// ===== 전략 A: SonioxEndpointStrategy =====
// enable_endpoint_detection: true → Soniox가 자체적으로 <end> 마커를 생성한다.
// 서버는 마커를 받으면 즉시 finalize. manual finalize 타이머는 사용하지 않는다.

export class SonioxEndpointStrategy implements SegmentationStrategy {
    readonly id: SegmentationStrategyId = 'end';

    sonioxConfigOverrides(): Record<string, unknown> {
        return { enable_endpoint_detection: true };
    }

    getSnapshotTextLen(): number | null { return null; }

    onTokenFrame(ctx: TokenFrameContext): SegmentationDecision {
        return evaluateEndpointMarker(ctx);
    }

    onTranscriptProgress(_hasPending: boolean, _added: boolean): void {
        // 타이머 없음
    }

    dispose(): void {
        // no-op
    }
}

// ===== 전략 B: SilenceTimerStrategy (기본값) =====
// enable_endpoint_detection: false → Soniox 자체 마커 비활성.
// transcript 진행이 silenceMs 동안 멈추면 { type: 'finalize' } 전송.
// finalize 후 Soniox가 <fin>을 돌려보내면 evaluateEndpointMarker()가 처리.

export interface SilenceTimerStrategyOptions {
    silenceMs: number;
    cooldownMs: number;
    /** { type: 'finalize' }를 Soniox WS로 실제 전송하는 콜백 */
    sendFinalizeCommand: (snapshotTextLen: number) => void;
    /** carry 만료 시 emitFinalTurn 호출하는 콜백 */
    onCarryExpiry: () => void;
}

export class SilenceTimerStrategy implements SegmentationStrategy {
    readonly id: SegmentationStrategyId = 'fin';

    private readonly silenceMs: number;
    private readonly cooldownMs: number;
    private readonly sendFinalizeCommand: (snapshotTextLen: number) => void;
    private readonly onCarryExpiry: () => void;

    private hasPending = false;
    private finalizeSent = false;
    private lastFinalizeAtMs = 0;
    private lastProgressAtMs = 0;
    private finalizeTimer: ReturnType<typeof setTimeout> | null = null;
    private carryExpiryTimer: ReturnType<typeof setTimeout> | null = null;
    /** manual finalize 직전 merged text 길이 (snapshot 기반 split에 사용) */
    private snapshotTextLen: number | null = null;
    /** 현재 merged text 길이 — sendFinalizeCommand 시 캡처 */
    currentMergedTextLen = 0;

    constructor(opts: SilenceTimerStrategyOptions) {
        this.silenceMs = opts.silenceMs;
        this.cooldownMs = opts.cooldownMs;
        this.sendFinalizeCommand = opts.sendFinalizeCommand;
        this.onCarryExpiry = opts.onCarryExpiry;
    }

    sonioxConfigOverrides(): Record<string, unknown> {
        return { enable_endpoint_detection: false };
    }

    getSnapshotTextLen(): number | null {
        return this.snapshotTextLen;
    }

    onTokenFrame(ctx: TokenFrameContext): SegmentationDecision {
        // snapshotTextLen을 ctx에서 갱신 (서버가 결정한 snapshot을 전략이 기억)
        if (ctx.finalizeSnapshotTextLen !== null) {
            this.snapshotTextLen = ctx.finalizeSnapshotTextLen;
        }
        const ctxWithSnapshot: TokenFrameContext = {
            ...ctx,
            finalizeSnapshotTextLen: this.snapshotTextLen,
        };
        const decision = evaluateEndpointMarker(ctxWithSnapshot);
        if (decision.action === 'finalize') {
            // snapshot 소비 완료
            this.snapshotTextLen = null;
        }
        return decision;
    }

    onTranscriptProgress(hasPending: boolean, added: boolean): void {
        this.hasPending = hasPending;

        if (!hasPending) {
            this.clearFinalizeTimer();
            return;
        }

        if (added) {
            this.finalizeSent = false;
            this.lastProgressAtMs = Date.now();
            this.scheduleFinalizeCheck();
        }
    }

    /** carry 텍스트가 생긴 직후 호출 — carry 만료 타이머 설정 */
    scheduleCarryExpiry(): void {
        this.clearCarryExpiryTimer();
        const expiryMs = this.silenceMs + this.cooldownMs;
        this.carryExpiryTimer = setTimeout(() => {
            this.carryExpiryTimer = null;
            this.onCarryExpiry();
        }, expiryMs);
    }

    clearCarryExpiryTimer(): void {
        if (this.carryExpiryTimer) {
            clearTimeout(this.carryExpiryTimer);
            this.carryExpiryTimer = null;
        }
    }

    /** resetSonioxSegmentState / cleanup 에서 호출 */
    resetState(): void {
        this.clearFinalizeTimer();
        this.clearCarryExpiryTimer();
        this.hasPending = false;
        this.finalizeSent = false;
        this.lastFinalizeAtMs = 0;
        this.lastProgressAtMs = 0;
        this.snapshotTextLen = null;
        this.currentMergedTextLen = 0;
    }

    dispose(): void {
        this.clearFinalizeTimer();
        this.clearCarryExpiryTimer();
    }

    // --- 내부 ---

    private clearFinalizeTimer(): void {
        if (this.finalizeTimer) {
            clearTimeout(this.finalizeTimer);
            this.finalizeTimer = null;
        }
    }

    private scheduleFinalizeCheck(): void {
        if (this.finalizeSent) return;
        this.clearFinalizeTimer();
        this.finalizeTimer = setTimeout(() => this.maybeTrigger(), this.silenceMs);
    }

    private maybeTrigger(): void {
        this.finalizeTimer = null;
        if (!this.hasPending) return;
        if (this.finalizeSent) return;

        const now = Date.now();
        if (this.lastProgressAtMs <= 0) this.lastProgressAtMs = now;

        const elapsedSince = now - this.lastProgressAtMs;
        if (elapsedSince < this.silenceMs) {
            const wait = Math.max(1, this.silenceMs - elapsedSince);
            this.finalizeTimer = setTimeout(() => this.maybeTrigger(), wait);
            return;
        }

        const elapsedSinceLastFinalize = now - this.lastFinalizeAtMs;
        if (elapsedSinceLastFinalize < this.cooldownMs) {
            const wait = Math.max(1, this.cooldownMs - elapsedSinceLastFinalize);
            this.finalizeTimer = setTimeout(() => this.maybeTrigger(), wait);
            return;
        }

        this.snapshotTextLen = this.currentMergedTextLen;
        this.finalizeSent = true;
        this.lastFinalizeAtMs = now;
        this.sendFinalizeCommand(this.currentMergedTextLen);
    }
}

// ===== Factory =====

export function readSegmentationStrategyId(): SegmentationStrategyId {
    const raw = (process.env['SONIOX_SEGMENTATION_STRATEGY'] ?? '').trim().toLowerCase();
    if (raw === 'end') return 'end';
    if (raw === 'llm') return 'llm';
    // 'fin' 이거나 값이 없으면 기존 동작(fin) 사용
    return 'fin';
}

export function createSegmentationStrategy(
    id: SegmentationStrategyId,
    opts: SilenceTimerStrategyOptions,
): SegmentationStrategy {
    switch (id) {
        case 'end':
            return new SonioxEndpointStrategy();
        case 'llm':
            // Phase 2: LLM 전략 구현 전까지 fin으로 fallback
            console.warn('[stt-server] llm segmentation not yet implemented; using fin');
            return new SilenceTimerStrategy(opts);
        case 'fin':
        default:
            return new SilenceTimerStrategy(opts);
    }
}
