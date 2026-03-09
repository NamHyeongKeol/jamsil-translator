"use client";

import { useLayoutEffect } from "react";
import type { ReactNode } from "react";

const ZOOM_STYLE_ID = "__mingle_canvas_zoom";

/** head 인라인 스크립트와 동일한 로직 – useLayoutEffect는 첫 페인트 전 실행 */
function applyZoom() {
  document.getElementById(ZOOM_STYLE_ID)?.remove();
  const w = window.innerWidth;
  if (w > 0 && w < 400) {
    const z = w / 400;
    const s = document.createElement("style");
    s.id = ZOOM_STYLE_ID;
    s.textContent = [
      `.mobile-canvas-shell{`,
      `zoom:${z} !important;`,
      `height:calc(100svh / ${z}) !important;`,
      `min-height:calc(100svh / ${z}) !important`,
      `}`,
    ].join("");
    document.head.appendChild(s);
  }
}

export default function MobileCanvasShell({ children }: { children: ReactNode }) {
  // head 인라인 스크립트로 1차 적용 완료 상태.
  // useLayoutEffect는 혹시 초기값이 틀렸을 경우를 위한 보험 (첫 페인트 전 실행됨).
  useLayoutEffect(() => {
    applyZoom();
  }, []);

  return (
    <div className="mobile-canvas-stage">
      <div className="mobile-canvas-shell">{children}</div>
    </div>
  );
}
