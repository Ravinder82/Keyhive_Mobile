import { useEffect, useState } from "react";

export type LayoutMode = "compact" | "normal" | "expanded";

/**
 * DashboardLayoutEngine (doc §9): measures available space and picks a layout
 * mode so the UI reflows rather than shrinks.
 *  - compact:  narrow popup (or very short viewport)
 *  - normal:   default popup size
 *  - expanded: the full-page dashboard tab
 */
export function pickLayout(width: number, height: number): LayoutMode {
  if (width < 340 || height < 420) return "compact";
  if (width >= 700 && height >= 560) return "expanded";
  return "normal";
}

export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(() =>
    pickLayout(
      typeof window !== "undefined" ? window.innerWidth : 400,
      typeof window !== "undefined" ? window.innerHeight : 600,
    ),
  );

  useEffect(() => {
    const update = () => setMode(pickLayout(window.innerWidth, window.innerHeight));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return mode;
}
