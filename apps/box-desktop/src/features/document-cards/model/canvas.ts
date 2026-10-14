export type Point = { x: number; y: number };
export type Camera = Point & { scale: number };

export const MIN_SCALE = 0.45;
export const MAX_SCALE = 1.8;
export const ZOOM_STEP = 0.15;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function initialCardPosition(index: number): Point {
  const columns = 4;
  const column = index % columns;
  const row = Math.floor(index / columns);
  return { x: column * 286, y: row * 226 };
}

export function panCamera(camera: Camera, delta: Point): Camera {
  return { ...camera, x: camera.x + delta.x, y: camera.y + delta.y };
}

export function moveCard(position: Point, screenDelta: Point, scale: number): Point {
  return {
    x: position.x + screenDelta.x / scale,
    y: position.y + screenDelta.y / scale,
  };
}

export function zoomCameraAt(camera: Camera, requestedScale: number, anchor: Point): Camera {
  const scale = clampScale(requestedScale);
  if (scale === camera.scale) return camera;
  const ratio = scale / camera.scale;
  return {
    scale,
    x: anchor.x - (anchor.x - camera.x) * ratio,
    y: anchor.y - (anchor.y - camera.y) * ratio,
  };
}
