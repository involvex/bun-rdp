/**
 * Dirty-rect optimisation using DXGI Desktop Duplication.
 *
 * DXGI reports which screen regions changed since the last frame via:
 *   IDXGIOutputDuplication::GetFrameDirtyRects   — changed rectangles
 *   IDXGIOutputDuplication::GetFrameMoveRects    — block-move operations (scroll, drag)
 *
 * Strategy:
 *   1. AcquireNextFrame → inspect dirty + move rects
 *   2. If total dirty area < FULL_FRAME_THRESHOLD → encode only dirty tiles
 *   3. Otherwise fall through to full-frame encode
 *   4. Merge overlapping rects → minimal encode regions
 *
 * Bandwidth savings on a typical idle desktop: ~70–85 %.
 */
import type { dxgi } from '../win32-compat';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MoveRect {
  src: Rect;
  dst: Rect;
}

export interface DirtyInfo {
  dirtyRects: Rect[];
  moveRects: MoveRect[];
  /** True when dirty area covers ≥ FULL_FRAME_THRESHOLD of total pixels */
  fullFrame: boolean;
  /** 0.0–1.0 fraction of screen that changed */
  dirtyRatio: number;
}

/** If dirty area exceeds this fraction of total pixels → send full frame */
const FULL_FRAME_THRESHOLD = 0.4;

/** Align rect outward to tile boundary (default 16px — DCT-friendly) */
const TILE = 16;
function alignRect(r: Rect): Rect {
  const x2 = r.x + r.w;
  const y2 = r.y + r.h;
  const ax = Math.floor(r.x / TILE) * TILE;
  const ay = Math.floor(r.y / TILE) * TILE;
  const ax2 = Math.ceil(x2 / TILE) * TILE;
  const ay2 = Math.ceil(y2 / TILE) * TILE;
  return { x: ax, y: ay, w: ax2 - ax, h: ay2 - ay };
}

/** Clamp rect to screen bounds */
function clampRect(r: Rect, sw: number, sh: number): Rect {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  const x2 = Math.min(sw, r.x + r.w);
  const y2 = Math.min(sh, r.y + r.h);
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

/** Merge overlapping / adjacent rects using a simple sweep */
export function mergeRects(rects: Rect[], sw: number, sh: number): Rect[] {
  if (rects.length === 0) return [];
  if (rects.length === 1) return rects;

  // Convert to [x1,y1,x2,y2] for easier overlap detection
  type R4 = [number, number, number, number];
  const boxes: R4[] = rects.map((r) => [r.x, r.y, r.x + r.w, r.y + r.h]);

  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        // Do they overlap or touch?
        if (a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]) {
          boxes[i] = [
            Math.min(a[0], b[0]),
            Math.min(a[1], b[1]),
            Math.max(a[2], b[2]),
            Math.max(a[3], b[3]),
          ];
          boxes.splice(j, 1);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
  }

  return boxes
    .map(([x1, y1, x2, y2]) => clampRect({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, sw, sh))
    .filter((r) => r.w > 0 && r.h > 0);
}

// ─── DirtyRectTracker ─────────────────────────────────────────────────────────

export class DirtyRectTracker {
  private duplication: unknown = null;
  private screenW = 0;
  private screenH = 0;

  constructor(
    readonly screenWidth: number,
    readonly screenHeight: number
  ) {
    this.screenW = screenWidth;
    this.screenH = screenHeight;
  }

  /** Attach to an existing DXGI output duplication object */
  attach(duplication: unknown) {
    this.duplication = duplication;
  }

  /**
   * Query dirty and move rects for the most recently acquired frame.
   * Must be called AFTER AcquireNextFrame and BEFORE ReleaseFrame.
   */
  query(): DirtyInfo {
    const dup = this.duplication as ReturnType<
      typeof dxgi.IDXGIOutputDuplication.prototype.AcquireNextFrame
    >;

    const rawDirty: Rect[] = [];
    const rawMove: MoveRect[] = [];

    try {
      // GetFrameDirtyRects — array of RECT structs
      const dirtyBuf = dup.GetFrameDirtyRects();
      for (const r of dirtyBuf ?? []) {
        rawDirty.push({
          x: r.left,
          y: r.top,
          w: r.right - r.left,
          h: r.bottom - r.top,
        });
      }

      // GetFrameMoveRects — scroll / drag optimisation
      const moveBuf = dup.GetFrameMoveRects();
      for (const m of moveBuf ?? []) {
        rawMove.push({
          src: {
            x: m.SourcePoint.x,
            y: m.SourcePoint.y,
            w: m.DestinationRect.right - m.DestinationRect.left,
            h: m.DestinationRect.bottom - m.DestinationRect.top,
          },
          dst: {
            x: m.DestinationRect.left,
            y: m.DestinationRect.top,
            w: m.DestinationRect.right - m.DestinationRect.left,
            h: m.DestinationRect.bottom - m.DestinationRect.top,
          },
        });
        // Treat move destination as dirty too
        rawDirty.push({
          x: m.DestinationRect.left,
          y: m.DestinationRect.top,
          w: m.DestinationRect.right - m.DestinationRect.left,
          h: m.DestinationRect.bottom - m.DestinationRect.top,
        });
      }
    } catch {
      // Fallback: treat whole screen as dirty
      return {
        dirtyRects: [{ x: 0, y: 0, w: this.screenW, h: this.screenH }],
        moveRects: [],
        fullFrame: true,
        dirtyRatio: 1.0,
      };
    }

    // Align to tile boundaries + merge
    const aligned = rawDirty.map((r) => alignRect(r));
    const merged = mergeRects(aligned, this.screenW, this.screenH);

    const totalPixels = this.screenW * this.screenH;
    const dirtyPixels = merged.reduce((s, r) => s + r.w * r.h, 0);
    const dirtyRatio = Math.min(1.0, dirtyPixels / totalPixels);
    const fullFrame = dirtyRatio >= FULL_FRAME_THRESHOLD;

    return { dirtyRects: merged, moveRects: rawMove, fullFrame, dirtyRatio };
  }

  /**
   * Crop a raw BGRA frame buffer to a sub-rectangle.
   * Returns a new Uint8Array with only the tile's pixels (still BGRA).
   */
  static cropBGRA(full: Uint8Array, fw: number, rect: Rect): Uint8Array {
    const out = new Uint8Array(rect.w * rect.h * 4);
    for (let row = 0; row < rect.h; row++) {
      const srcOff = ((rect.y + row) * fw + rect.x) * 4;
      const dstOff = row * rect.w * 4;
      out.set(full.subarray(srcOff, srcOff + rect.w * 4), dstOff);
    }
    return out;
  }
}
