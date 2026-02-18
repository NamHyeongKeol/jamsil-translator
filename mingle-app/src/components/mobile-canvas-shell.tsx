"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

const CANVAS_WIDTH = 400;

function calculateScale() {
  if (typeof window === "undefined") return 1;
  return Math.min(1, window.innerWidth / CANVAS_WIDTH);
}

export default function MobileCanvasShell({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const updateScale = () => {
      setScale(calculateScale());
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    window.addEventListener("orientationchange", updateScale);

    return () => {
      window.removeEventListener("resize", updateScale);
      window.removeEventListener("orientationchange", updateScale);
    };
  }, []);

  const normalizedScale = scale > 0 ? scale : 1;
  const needsScale = normalizedScale < 1;
  const frameHeight = useMemo(() => needsScale ? `calc(100svh / ${normalizedScale})` : '100svh', [needsScale, normalizedScale]);
  const scaledWidth = useMemo(() => `${CANVAS_WIDTH * normalizedScale}px`, [normalizedScale]);

  // When scale is 1 (device width >= CANVAS_WIDTH), skip the transform entirely
  // to avoid creating an unnecessary compositing layer that hurts scroll perf in WKWebView.
  if (!needsScale) {
    return (
      <div className="mobile-canvas-stage">
        <div className="mobile-canvas-shell" style={{ width: `${CANVAS_WIDTH}px` }}>
          <div style={{ height: '100svh', width: `${CANVAS_WIDTH}px`, overflow: 'hidden' }}>
            {children}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-canvas-stage">
      <div className="mobile-canvas-shell" style={{ width: scaledWidth }}>
        <div
          className="mobile-canvas-frame"
          style={{
            transform: `scale(${normalizedScale})`,
            height: frameHeight,
            width: `${CANVAS_WIDTH}px`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
