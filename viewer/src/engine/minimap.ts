/**
 * The minimap: a top-down plan of the room in the corner, the way a game shows where you are. Room
 * outline, object footprints in the mode's tones, and the camera with its horizontal field of view.
 * Drawn from the render loop on the same frames as the detection overlay, so it never lags the view.
 */
import * as THREE from "three";
import { TONES, type BoxItem } from "./overlay";

const MAP_H = 200; // css px: the room (plus margin) fits this height
const MAX_W = 260; // and this width
const PAD = 8; // px inside the panel edge
const MARGIN_M = 0.5; // metres of floor shown past the walls, so an orbit outside them stays on the map
const CONE_M = 3.2; // metres the view cone reaches

const rgba = (t: BoxItem["tone"], a: number) => `rgba(${TONES[t][0]}, ${TONES[t][1]}, ${TONES[t][2]}, ${a})`;

export class Minimap {
  readonly canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private room: THREE.Box3 | null = null;
  private scale = 1; // px per metre
  private readonly dir = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    this.canvas.className = "minimap";
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
  }

  /** Fit the room (x across, z down the panel) into the panel; the legend above reads the height back. */
  setRoom(room: THREE.Box3) {
    this.room = room;
    const sx = room.max.x - room.min.x + 2 * MARGIN_M;
    const sz = room.max.z - room.min.z + 2 * MARGIN_M;
    this.scale = Math.min((MAX_W - 2 * PAD) / sx, (MAP_H - 2 * PAD) / sz);
    this.w = Math.round(sx * this.scale + 2 * PAD);
    this.h = Math.round(sz * this.scale + 2 * PAD);
    this.dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    document.documentElement.style.setProperty("--map-h", `${this.h}px`);
  }

  private px(x: number, z: number): [number, number] {
    const r = this.room!;
    return [(x - r.min.x + MARGIN_M) * this.scale + PAD, (z - r.min.z + MARGIN_M) * this.scale + PAD];
  }

  draw(camera: THREE.PerspectiveCamera, target: THREE.Vector3, items: BoxItem[]) {
    const r = this.room;
    if (!r) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = "rgba(5, 5, 6, 0.62)";
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, this.w - 1, this.h - 1);

    // the room
    const [x0, z0] = this.px(r.min.x, r.min.z);
    const [x1, z1] = this.px(r.max.x, r.max.z);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
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
    glow.addColorStop(0, "rgba(255, 255, 255, 0.16)");
    glow.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(heading - half) * reach, cz + Math.sin(heading - half) * reach);
    ctx.lineTo(cx, cz);
    ctx.lineTo(cx + Math.cos(heading + half) * reach, cz + Math.sin(heading + half) * reach);
    ctx.stroke();

    // object footprints
    for (const it of items) {
      const [ax, az] = this.px(it.box.min.x, it.box.min.z);
      const [bx, bz] = this.px(it.box.max.x, it.box.max.z);
      const w = Math.max(2, bx - ax);
      const h = Math.max(2, bz - az);
      ctx.fillStyle = rgba(it.tone, it.emphasis ? 0.55 : 0.22);
      ctx.fillRect(ax, az, w, h);
      ctx.strokeStyle = rgba(it.tone, it.emphasis ? 1 : 0.6);
      ctx.strokeRect(Math.round(ax) + 0.5, Math.round(az) + 0.5, Math.round(w), Math.round(h));
    }

    // orbit target, then the camera on top
    const [tx, tz] = this.px(target.x, target.z);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.beginPath();
    ctx.moveTo(tx - 3, tz);
    ctx.lineTo(tx + 3, tz);
    ctx.moveTo(tx, tz - 3);
    ctx.lineTo(tx, tz + 3);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.beginPath();
    ctx.arc(cx, cz, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  dispose() {
    this.canvas.remove();
    document.documentElement.style.removeProperty("--map-h");
  }
}
