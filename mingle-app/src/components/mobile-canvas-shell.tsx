import type { ReactNode } from "react";

export default function MobileCanvasShell({ children }: { children: ReactNode }) {
  return (
    <div className="mobile-canvas-stage">
      <div className="mobile-canvas-shell">{children}</div>
    </div>
  );
}
