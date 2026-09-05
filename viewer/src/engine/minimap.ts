/**
 * The map: a top-down plan of the room in the design's small frame. Object footprints, the standard's
 * ghosts dashed in violet with their links, and the camera with its field of view. Drawn from the render
 * loop on the same frames as the detection overlay, so it never lags the view. It is also a control: a
 * footprint picks the thing, bare floor puts the camera there.
 */
import * as THREE from "three";
import { TONES, type BoxItem } from "./overlay";

export const MAP_W = 112; // css px, the design's frame
export const MAP_H = 150;
const PAD = 3; // px inside the edge
const MARGIN_M = 0.2; // metres of floor shown past the walls
const CONE_M = 3.2; // metres the view cone reaches

const rgba = (t: BoxItem["tone"], a: number) => `rgba(${TONES[t][0]}, ${TONES[t][1]}, ${TONES[t][2]}, ${a})`;

type Hit = { x0: number; y0: number; x1: number; y1: number; item: BoxItem };

export class Minimap {
  readonly canvas = document.createElement("canvas");
  /** A footprint was clicked. */
  onPick: ((item: BoxItem) => void) | null = null;
  /** Bare floor was clicked, at these world coordinates. */
  onGo: ((x: number, z: number) => void) | null = null;
  private ctx: CanvasRenderingContext2D;
  private hits: Hit[] = []; // what the last draw put down, for picking
  private dpr = 1;
  private room: THREE.Box3 | null = null;
  private scale = 1; // px per metre
  private ox = 0; // where the room's margin box starts, so the room sits centred
  private oz = 0;
  private readonly dir = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    this.canvas.className = "map";
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.canvas.addEventListener("pointermove", this.onMove);
    this.canvas.addEventListener("click", this.onClick);
  }

  private local(ev: MouseEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }

  /** The footprint under a canvas point, the smallest when they overlap; ghosts are seen, not clicked. */
  private hitAt(px: number, pz: number): BoxItem | null {
    let best: Hit | null = null;
    for (const h of this.hits) {
      if (h.item.pickable === false || px < h.x0 || px > h.x1 || pz < h.y0 || pz > h.y1) continue;
      if (!best || (h.x1 - h.x0) * (h.y1 - h.y0) < (best.x1 - best.x0) * (best.y1 - best.y0)) best = h;
    }
    return best?.item ?? null;
  }

  /** Canvas point → world floor coordinates, or null outside the room. */
  private worldAt(px: number, pz: number): [number, number] | null {
    const r = this.room;
    if (!r) return null;
    const x = (px - this.ox) / this.scale - MARGIN_M + r.min.x;
    const z = (pz - this.oz) / this.scale - MARGIN_M + r.min.z;
    if (x < r.min.x || x > r.max.x || z < r.min.z || z > r.max.z) return null;
    return [x, z];
  }

  private onMove = (ev: PointerEvent) => {
    const [px, pz] = this.local(ev);
    this.canvas.style.cursor = this.hitAt(px, pz) ? "pointer" : this.worldAt(px, pz) ? "crosshair" : "";
  };
  private onClick = (ev: MouseEvent) => {
    ev.stopPropagation();
    const [px, pz] = this.local(ev);
    const hit = this.hitAt(px, pz);
    if (hit) return this.onPick?.(hit);
    const w = this.worldAt(px, pz);
    if (w) this.onGo?.(w[0], w[1]);
  };

  /** Fit the room (x across, z down) into the frame, centred. */
  setRoom(room: THREE.Box3) {
    this.room = room;
    const sx = room.max.x - room.min.x + 2 * MARGIN_M;
    const sz = room.max.z - room.min.z + 2 * MARGIN_M;
    this.scale = Math.min((MAP_W - 2 * PAD) / sx, (MAP_H - 2 * PAD) / sz);
    this.ox = (MAP_W - sx * this.scale) / 2;
    this.oz = (MAP_H - sz * this.scale) / 2;
    this.dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = Math.round(MAP_W * this.dpr);
    this.canvas.height = Math.round(MAP_H * this.dpr);
    this.canvas.style.width = `${MAP_W}px`;
    this.canvas.style.height = `${MAP_H}px`;
  }

  private px(x: number, z: number): [number, number] {
    const r = this.room!;
    return [(x - r.min.x + MARGIN_M) * this.scale + this.ox, (z - r.min.z + MARGIN_M) * this.scale + this.oz];
  }

  draw(camera: THREE.PerspectiveCamera, target: THREE.Vector3, items: BoxItem[]) {
    const r = this.room;
    if (!r) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, MAP_W, MAP_H);
    ctx.lineWidth = 1;

    // the room
    const [x0, z0] = this.px(r.min.x, r.min.z);
    const [x1, z1] = this.px(r.max.x, r.max.z);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.strokeRect(Math.round(x0) + 0.5, Math.round(z0) + 0.5, Math.round(x1 - x0), Math.round(z1 - z0));

    // the view cone: horizontal field of view from the camera, along where it looks, projected to the floor
    camera.getWorldDirection(this.dir);
    const heading = Math.atan2(this.dir.z, this.dir.x);
    const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
    const [cx, cz] = this.px(camera.position.x, camera.position.z);
    const reach = CONE_M * this.scale;
    ctx.beginPath();
    ctx.moveTo(cx, cz);
    ctx.arc(cx, cz, reach, heading - half, heading + half);
    ctx.closePath();
    const glow = ctx.createRadialGradient(cx, cz, 0, cx, cz, reach);
    glow.addColorStop(0, "rgba(255, 255, 255, 0.14)");
    glow.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fill();

    // footprints: filled for what is there, dashed for a ghost
    this.hits = [];
    for (const it of items) {
      const sx = it.shift?.x ?? 0;
      const sz = it.shift?.z ?? 0;
      const [ax, az] = this.px(it.box.min.x + sx, it.box.min.z + sz);
      const [bx, bz] = this.px(it.box.max.x + sx, it.box.max.z + sz);
      const w = Math.max(3, bx - ax);
      const h = Math.max(3, bz - az);
      this.hits.push({ x0: ax - 2, y0: az - 2, x1: ax + w + 2, y1: az + h + 2, item: it });
      if (it.dashed) {
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = rgba(it.tone, 0.8);
        ctx.strokeRect(Math.round(ax) + 0.5, Math.round(az) + 0.5, Math.round(w), Math.round(h));
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle =
          it.tone === "neutral" ? `rgba(255, 255, 255, ${it.emphasis ? 0.94 : it.faint ? 0.25 : 0.5})` : rgba(it.tone, it.emphasis ? 0.94 : 0.7);
        ctx.fillRect(Math.round(ax), Math.round(az), Math.round(w), Math.round(h));
      }
    }
    // a moved or drifted thing tied to its other place
    for (const it of items) {
      if (!it.link) continue;
      const [ax, az] = this.px((it.box.min.x + it.box.max.x) / 2 + (it.shift?.x ?? 0), (it.box.min.z + it.box.max.z) / 2 + (it.shift?.z ?? 0));
      const [bx, bz] = this.px(it.link.x, it.link.z);
      ctx.strokeStyle = rgba(it.linkTone ?? "neutral", 0.9);
      ctx.beginPath();
      ctx.moveTo(ax, az);
      ctx.lineTo(bx, bz);
      ctx.stroke();
    }

    // orbit target, then the camera on top
    const [tx, tz] = this.px(target.x, target.z);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.beginPath();
    ctx.moveTo(tx - 3, tz);
    ctx.lineTo(tx + 3, tz);
    ctx.moveTo(tx, tz - 3);
    ctx.lineTo(tx, tz + 3);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.beginPath();
    ctx.arc(cx, cz, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  dispose() {
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("click", this.onClick);
    this.canvas.remove();
  }
}
