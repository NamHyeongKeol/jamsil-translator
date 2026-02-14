"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

const CANVAS_WIDTH = 480;

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
  const frameHeight = useMemo(() => `calc(100svh / ${normalizedScale})`, [normalizedScale]);
  const scaledWidth = useMemo(() => `${CANVAS_WIDTH * normalizedScale}px`, [normalizedScale]);

  return (
    <div className="mobile-canvas-stage">
      <div className="mobile-canvas-shell" style={{ width: scaledWidth }}>
        <div
          className="mobile-canvas-frame"
          style={{
            transform: `scale(${normalizedScale})`,
            height: frameHeight,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
