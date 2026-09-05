/**
 * The detection overlay: screen-space boxes around tracked objects, drawn on a 2D canvas above the
 * splats, in the design's language: a thin frame, corner ticks, an uppercase tag above the top-left
 * corner, and for a thing that moved an arrow to where it was with the distance on it. Every number
 * on a tag is measured; the brackets are also the hit boxes.
 */
import * as THREE from "three";

export type Tone = "neutral" | "add" | "rem" | "std" | "ghost";
export type BoxItem = {
  id: number;
  /** A draft placement's key, so a copy can be picked up by the one you clicked. */
  key?: number;
  box: THREE.Box3;
  /** The object's own splat centres (world xyz, flat), when the drawing commit is loaded. The bracket hugs these. */
  pts?: Float32Array;
  label: string;
  tone: Tone;
  emphasis: boolean;
  /** Drawn dashed on the map too: a ghost, an old place, something not really there. */
  dashed?: boolean;
  /** Drawn solid even when not selected: a thing put down in a draft. */
  solid?: boolean;
  /** Receded: the unchanged things in a diff. */
  faint?: boolean;
  /** Where a draft has carried the object to, as an offset from where it was captured. */
  shift?: THREE.Vector3;
  /** A point this item is tied to on screen by an arrow, with a label at the midpoint. */
  link?: THREE.Vector3;
  linkLabel?: string;
  linkTone?: Tone;
  /** False for ghosts: seen, never clicked. */
  pickable?: boolean;
};
const MIN_PTS = 3; // fewer projected points than this is not an object on screen
const MAX_PTS = 4000; // points projected per object per frame; a big plant carries 100k, its outline needs far fewer

export const TONES: Record<Tone, [number, number, number]> = {
  neutral: [255, 255, 255],
  add: [127, 214, 164],
  rem: [224, 112, 92],
  std: [196, 181, 245],
  ghost: [255, 255, 255],
};
const TICK = 8; // corner tick arm, px
const PAD = 5;
const MIN_PX = 14; // ignore anything smaller than this on screen: it is a speck, not a detection
const LABEL_H = 18;
const ARROW = 7;
/** The chrome owns these regions; a tag that would land on them is dropped rather than drawn over them. */
const RESERVED = [
  "#sites",
  "#goals",
  "#actions",
  "#map-cell",
  "#cmdbar",
  "#modehud",
  "#menu",
  "#card .inner",
  "#panel .inner",
  "#timeline",
  "#details",
];

type Rect = { x0: number; y0: number; x1: number; y1: number };
const hits = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const rgba = (t: Tone, a: number) => `rgba(${TONES[t][0]}, ${TONES[t][1]}, ${TONES[t][2]}, ${a})`;
const INK_BG = "rgba(7, 7, 8, 0.82)";

export class Overlay {
  readonly canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private readonly corner = new THREE.Vector3();
  private readonly view = new THREE.Vector3();
  /** What the last draw put on screen: the brackets are the hit boxes, so picking reads this. */
  private placed: { r: Rect; item: BoxItem; depth: number }[] = [];

  constructor(parent: HTMLElement) {
    this.canvas.className = "overlay";
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
  }

  resize(w: number, h: number) {
    this.dpr = Math.min(devicePixelRatio, 2);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.placed = [];
  }

  /** The item whose bracket contains this canvas point, the nearest one when brackets overlap. */
  hitTest(x: number, y: number): BoxItem | null {
    let best: { item: BoxItem; depth: number } | null = null;
    for (const { r, item, depth } of this.placed) {
      if (item.pickable === false) continue;
      if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
      if (!best || depth < best.depth) best = { item, depth };
    }
    return best?.item ?? null;
  }

  /**
   * Project every box, draw the frames, then place as many tags as fit. Tags are placed in priority
   * order — what you are pointing at first, then the largest — and one that would collide with another
   * tag or with the chrome is dropped: a readable subset beats a wall of overlapping type.
   * @param padWorld the pick radius in world metres: the bracket grows by it at the object's depth, so its
   *   edge is where the pointer starts to hit.
   */
  draw(camera: THREE.PerspectiveCamera, items: BoxItem[], padWorld = 0) {
    this.clear();
    if (items.length === 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textBaseline = "middle";
    if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0.1em";

    const placed: { r: Rect; item: BoxItem; depth: number }[] = [];
    for (const item of items) {
      const hit = item.pts ? this.projectPoints(camera, item.pts, padWorld, item.shift) : this.project(camera, item.box, item.shift);
      if (hit) placed.push({ r: hit.r, item, depth: hit.depth });
    }
    this.placed = placed;
    for (const { r, item } of placed) this.frame(r, item);
    for (const { r, item } of placed) if (item.link) this.arrow(camera, r, item);

    const taken: Rect[] = this.reserved();
    const order = [...placed].sort(
      (a, b) => Number(b.item.emphasis) - Number(a.item.emphasis) || (b.r.x1 - b.r.x0) * (b.r.y1 - b.r.y0) - (a.r.x1 - a.r.x0) * (a.r.y1 - a.r.y0),
    );
    for (const { r, item } of order) {
      const tag = this.tagRect(r, item.label);
      if (taken.some((t) => hits(tag, t))) continue;
      taken.push(tag);
      this.tag(tag, item);
    }
    ctx.restore();
  }

  /** Screen rectangles of the chrome, so tags can keep out of them. */
  private reserved(): Rect[] {
    const out: Rect[] = [];
    for (const sel of RESERVED) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const b = el.getBoundingClientRect();
      if (b.width && b.height) out.push({ x0: b.left - 6, y0: b.top - 6, x1: b.right + 6, y1: b.bottom + 6 });
    }
    return out;
  }

  /** Screen bounds of the object's splats, grown by the pick radius at their mean depth. Null when off-screen or too small. */
  private projectPoints(camera: THREE.PerspectiveCamera, pts: Float32Array, padWorld: number, shift?: THREE.Vector3) {
    const sx = shift?.x ?? 0;
    const sy = shift?.y ?? 0;
    const sz = shift?.z ?? 0;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let depth = 0;
    let n = 0;
    const step = 3 * Math.max(1, Math.floor(pts.length / 3 / MAX_PTS));
    for (let i = 0; i < pts.length; i += step) {
      this.view.set(pts[i] + sx, pts[i + 1] + sy, pts[i + 2] + sz).applyMatrix4(camera.matrixWorldInverse);
      if (this.view.z > -camera.near) continue; // behind the near plane: this point is not on screen
      this.corner.set(pts[i] + sx, pts[i + 1] + sy, pts[i + 2] + sz).project(camera);
      const px = ((this.corner.x + 1) / 2) * this.w;
      const py = ((1 - this.corner.y) / 2) * this.h;
      if (px < x0) x0 = px;
      if (py < y0) y0 = py;
      if (px > x1) x1 = px;
      if (py > y1) y1 = py;
      depth -= this.view.z;
      n++;
    }
    if (n < MIN_PTS) return null;
    const mean = depth / n;
    const pad = (padWorld * (this.h / 2)) / (Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * mean);
    const r = this.bounds(x0 - pad, y0 - pad, x1 + pad, y1 + pad);
    return r && { r, depth: mean };
  }

  /** World box -> screen rectangle, or null when it is behind the camera, off-screen or too small. */
  private project(camera: THREE.PerspectiveCamera, box: THREE.Box3, shift?: THREE.Vector3) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let depth = 0;
    for (let i = 0; i < 8; i++) {
      this.corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      if (shift) this.corner.add(shift);
      // a corner behind the near plane projects to a mirrored point, so the whole box is dropped
      this.view.copy(this.corner).applyMatrix4(camera.matrixWorldInverse);
      if (this.view.z > -camera.near) return null;
      depth -= this.view.z / 8;
      this.corner.project(camera);
      const px = ((this.corner.x + 1) / 2) * this.w;
      const py = ((1 - this.corner.y) / 2) * this.h;
      if (px < x0) x0 = px;
      if (py < y0) y0 = py;
      if (px > x1) x1 = px;
      if (py > y1) y1 = py;
    }
    const r = this.bounds(x0, y0, x1, y1);
    return r && { r, depth };
  }

  /** A rectangle that is worth drawing: on screen, not a speck, and not the camera standing inside it. */
  private bounds(x0: number, y0: number, x1: number, y1: number): Rect | null {
    if (x1 < 0 || y1 < 0 || x0 > this.w || y0 > this.h) return null;
    if (x1 - x0 < MIN_PX || y1 - y0 < MIN_PX) return null;
    if (x0 < 0 && y0 < 0 && x1 > this.w && y1 > this.h) return null;
    return { x0, y0, x1, y1 };
  }

  /** The design's box: a 1 px frame, dashed unless it is the selected thing, with 2 px corner ticks. */
  private frame(r: Rect, item: BoxItem) {
    const ctx = this.ctx;
    const { tone, emphasis } = item;
    const a = item.faint ? 0.35 : emphasis ? 0.94 : 0.6;
    const x0 = Math.round(r.x0) + 0.5;
    const y0 = Math.round(r.y0) + 0.5;
    const x1 = Math.round(r.x1) + 0.5;
    const y1 = Math.round(r.y1) + 0.5;
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(tone, a);
    // every frame is dashed until it is the selected thing (or one put down by hand): the solid one is the one you chose
    ctx.setLineDash(emphasis || item.solid ? [] : [3, 4]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.setLineDash([]);
    if (item.tone === "add" || item.tone === "rem") {
      ctx.fillStyle = rgba(tone, 0.1);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    ctx.lineWidth = 2;
    const arm = Math.min(TICK, (x1 - x0) / 3, (y1 - y0) / 3);
    ctx.beginPath();
    for (const [cx, cy, sx, sy] of [
      [x0, y0, 1, 1],
      [x1, y0, -1, 1],
      [x0, y1, 1, -1],
      [x1, y1, -1, -1],
    ] as const) {
      ctx.moveTo(cx + sx * arm, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * arm);
    }
    ctx.stroke();
  }

  /** Where a segment from the rect's centre toward (tx, ty) leaves the rect. */
  private edge(r: Rect, tx: number, ty: number) {
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    const dx = tx - cx;
    const dy = ty - cy;
    const hw = (r.x1 - r.x0) / 2;
    const hh = (r.y1 - r.y0) / 2;
    const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity, 1);
    return { x: cx + dx * t, y: cy + dy * t };
  }

  /** An arrow from this box to a world point, with the distance in a bordered label at the midpoint. */
  private arrow(camera: THREE.PerspectiveCamera, r: Rect, item: BoxItem) {
    const p = item.link!;
    this.view.copy(p).applyMatrix4(camera.matrixWorldInverse);
    if (this.view.z > -camera.near) return; // behind the camera: no line
    this.corner.copy(p).project(camera);
    const tx = ((this.corner.x + 1) / 2) * this.w;
    const ty = ((1 - this.corner.y) / 2) * this.h;
    const from = this.edge(r, tx, ty);
    // stop short of the target if another placed box holds it, so the head lands on its frame
    let to = { x: tx, y: ty };
    for (const other of this.placed) {
      if (other.item === item) continue;
      if (tx >= other.r.x0 && tx <= other.r.x1 && ty >= other.r.y0 && ty <= other.r.y1) {
        to = this.edge(other.r, from.x, from.y);
        break;
      }
    }
    const tone = item.linkTone ?? "neutral";
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = rgba(tone, 0.94);
    ctx.fillStyle = rgba(tone, 0.94);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    const hx = to.x - Math.cos(ang) * ARROW;
    const hy = to.y - Math.sin(ang) * ARROW;
    const nx = -Math.sin(ang) * 3.5;
    const ny = Math.cos(ang) * 3.5;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(hx + nx, hy + ny);
    ctx.lineTo(hx - nx, hy - ny);
    ctx.closePath();
    ctx.fill();
    if (item.linkLabel) {
      ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
      const w = ctx.measureText(item.linkLabel).width + 14;
      const mx = (from.x + to.x) / 2 - w / 2;
      const my = (from.y + to.y) / 2 - 10;
      ctx.fillStyle = "rgba(7, 7, 8, 0.86)";
      ctx.fillRect(mx, my, w, 20);
      ctx.strokeStyle = rgba(tone, 0.94);
      ctx.strokeRect(mx + 0.5, my + 0.5, w - 1, 19);
      ctx.fillStyle = rgba(tone, 0.94);
      ctx.fillText(item.linkLabel, mx + 7, my + 10.5);
    }
    ctx.restore();
  }

  /** Where a tag would sit for this box: above the top-left corner, flipped below at the top edge. */
  private tagRect(r: Rect, label: string): Rect {
    const w = this.ctx.measureText(label.toUpperCase()).width + PAD * 2;
    const x0 = Math.max(0, Math.min(Math.round(r.x0) - 1, this.w - w));
    let y0 = Math.round(r.y0) - LABEL_H;
    if (y0 < 2) y0 = Math.min(Math.round(r.y1) + 1, this.h - LABEL_H - 2);
    return { x0, y0, x1: x0 + w, y1: y0 + LABEL_H };
  }

  private tag(r: Rect, item: BoxItem) {
    const ctx = this.ctx;
    const { tone, emphasis } = item;
    const a = item.faint ? 0.45 : 1;
    ctx.fillStyle = emphasis ? rgba(tone, 0.94) : INK_BG;
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, LABEL_H);
    if (!emphasis) {
      ctx.strokeStyle = rgba(tone, 0.25 * a);
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x0 + 0.5, r.y0 + 0.5, r.x1 - r.x0 - 1, LABEL_H - 1);
    }
    ctx.fillStyle = emphasis ? "rgba(10, 10, 12, 0.95)" : rgba(tone, 0.85 * a);
    ctx.fillText(item.label.toUpperCase(), r.x0 + PAD, r.y0 + LABEL_H / 2 + 0.5);
  }

  dispose() {
    this.canvas.remove();
  }
}
