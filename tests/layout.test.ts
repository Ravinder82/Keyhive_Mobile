import { describe, expect, it } from "vitest";
import { pickLayout } from "../src/ui/useLayout";

describe("dashboard layout engine", () => {
  it("chooses compact for narrow or short viewports", () => {
    expect(pickLayout(320, 600)).toBe("compact");
    expect(pickLayout(400, 300)).toBe("compact");
  });

  it("chooses normal for the default popup size", () => {
    expect(pickLayout(400, 600)).toBe("normal");
    expect(pickLayout(360, 480)).toBe("normal");
  });

  it("chooses expanded for large viewports (dashboard tab)", () => {
    expect(pickLayout(1280, 800)).toBe("expanded");
    expect(pickLayout(900, 700)).toBe("expanded");
  });

  it("reflows monotonically across sizes", () => {
    const seq = [
      pickLayout(300, 400),
      pickLayout(400, 600),
      pickLayout(800, 800),
    ];
    expect(seq).toEqual(["compact", "normal", "expanded"]);
  });
});
