"use client";

import { useLayoutEffect } from "react";
import type { ReactNode } from "react";

const ZOOM_STYLE_ID = "__mingle_canvas_zoom";

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
  useLayoutEffect(() => {
    // requestAnimationFrame: 브라우저가 첫 레이아웃을 완료한 후 innerWidth를 읽음
    // → 모바일 WebView 초기 로드 타이밍 문제 해결
    const rafId = requestAnimationFrame(() => {
      applyZoom();
      // 측정 완료 후 shell을 보이게 (visibility: hidden으로 초기 flash 방지)
      const shell = document.querySelector<HTMLElement>(".mobile-canvas-shell");
      if (shell) shell.style.visibility = "";
    });

    // PC에서 창 크기 조절 시 실시간 zoom 재적용
    window.addEventListener("resize", applyZoom);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", applyZoom);
    };
  }, []);

  return (
    <div className="mobile-canvas-stage">
      {/* visibility:hidden → rAF 후 해제: 잘못된 zoom으로 첫 프레임이 보이는 flash 방지 */}
      <div className="mobile-canvas-shell" style={{ visibility: "hidden" }}>
        {children}
      </div>
    </div>
  );
}
