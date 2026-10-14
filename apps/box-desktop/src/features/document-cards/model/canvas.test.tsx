import { describe, expect, it } from "vitest";
import { clampScale, initialCardPosition, moveCard, panCamera, zoomCameraAt } from "./canvas";

describe("document card canvas coordinates", () => {
  it("lays cards out deterministically without overlapping the first grid", () => {
    expect(initialCardPosition(0)).toEqual({ x: 0, y: 0 });
    expect(initialCardPosition(3)).toEqual({ x: 858, y: 0 });
    expect(initialCardPosition(4)).toEqual({ x: 0, y: 226 });
  });

  it("moves the camera in screen space and cards in world space", () => {
    expect(panCamera({ x: 10, y: 20, scale: 2 }, { x: -5, y: 7 })).toEqual({ x: 5, y: 27, scale: 2 });
    expect(moveCard({ x: 100, y: 80 }, { x: 40, y: -20 }, 2)).toEqual({ x: 120, y: 70 });
  });

  it("keeps the world point under the pointer fixed while zooming", () => {
    const camera = { x: 40, y: 20, scale: 1 };
    const anchor = { x: 240, y: 170 };
    const worldBefore = { x: (anchor.x - camera.x) / camera.scale, y: (anchor.y - camera.y) / camera.scale };
    const zoomed = zoomCameraAt(camera, 1.5, anchor);
    expect((anchor.x - zoomed.x) / zoomed.scale).toBeCloseTo(worldBefore.x);
    expect((anchor.y - zoomed.y) / zoomed.scale).toBeCloseTo(worldBefore.y);
  });

  it("clamps zoom to a usable range", () => {
    expect(clampScale(0.1)).toBe(0.45);
    expect(clampScale(3)).toBe(1.8);
  });
});
