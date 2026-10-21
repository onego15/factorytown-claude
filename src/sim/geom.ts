// Shared grid ↔ world geometry used by both the simulation and the renderer.

export const LEVEL_H = 0.5; // world units per terrain level
export const BELT_Y = 0.13; // belt surface above ground

// 0 = east (+x), 1 = south (+y), 2 = west (-x), 3 = north (-y)
export const DX = [1, 0, -1, 0];
export const DY = [0, 1, 0, -1];

export const rightOf = (d: number) => (d + 1) & 3;
export const leftOf = (d: number) => (d + 3) & 3;
export const opposite = (d: number) => (d + 2) & 3;

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** World-space center of tile (x,y) for a map of width w, height h */
export function tileCenter(x: number, y: number, w: number, h: number): { x: number; z: number } {
  return { x: x + 0.5 - w / 2, z: y + 0.5 - h / 2 };
}

export interface BeltGeom {
  x: number;
  y: number;
  dir: number;
  shape: number; // 0 straight, 1 enters from left side, 2 enters from right side
  yIn: number; // world height at entry edge (belt surface)
  yOut: number; // world height at exit edge
}

/** Point along a belt for progress t in [0,1] */
export function beltPoint(b: BeltGeom, t: number, w: number, h: number, out: V3): V3 {
  const c = tileCenter(b.x, b.y, w, h);
  const fx = DX[b.dir], fz = DY[b.dir];
  if (b.shape === 0) {
    out.x = c.x + fx * (t - 0.5);
    out.z = c.z + fz * (t - 0.5);
    out.y = b.yIn + (b.yOut - b.yIn) * t;
    return out;
  }
  const sd = b.shape === 1 ? leftOf(b.dir) : rightOf(b.dir);
  const sx = DX[sd], sz = DY[sd];
  const cornerX = c.x + sx * 0.5 + fx * 0.5;
  const cornerZ = c.z + sz * 0.5 + fz * 0.5;
  const a = t * Math.PI * 0.5;
  const ca = Math.cos(a), sa = Math.sin(a);
  out.x = cornerX - fx * 0.5 * ca - sx * 0.5 * sa;
  out.z = cornerZ - fz * 0.5 * ca - sz * 0.5 * sa;
  out.y = b.yOut;
  return out;
}

/** Yaw (rotation about Y) of travel direction at progress t */
export function beltYaw(b: BeltGeom, t: number): number {
  const base = -dirAngle(b.dir);
  if (b.shape === 0) return base;
  // entering from the left means travelling in the right direction initially
  const startDir = b.shape === 1 ? rightOf(b.dir) : leftOf(b.dir);
  let s = -dirAngle(startDir);
  let diff = base - s;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return s + diff * t;
}

/** Angle of direction d in the XZ plane, measured from +x toward +z */
export function dirAngle(d: number) {
  return (d * Math.PI) / 2;
}
