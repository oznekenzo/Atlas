/**
 * The 3D side. Owns three.js, Spark, the splat meshes and the per-splat RGBA arrays.
 * Subscribes to the store; never touches React. React never touches this except to mount it.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SparkRenderer, SplatMesh, RgbaArray } from "@sparkjsdev/spark";
import type { Manifest } from "../types";
import { loadLabels, makeVoxelLookup, worldBox } from "../labels";
import { useStore, objectsChanged, type State } from "../store";

type Loaded = { mesh: SplatMesh; n: number; orig: Uint8Array; label: Uint16Array; rgba: RgbaArray };
const ADD = [127, 214, 164], REM = [224, 112, 92];

export class Stage {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera: THREE.PerspectiveCamera; controls: OrbitControls;
  spark: SparkRenderer; loaded: (Loaded | undefined)[] = []; boxes: THREE.Box3[] = [];
  M!: Manifest; voxelOf!: (x: number, y: number, z: number) => number;
  timings: Record<string, number> = {}; paused = false; private frames = 0; private fpsT = performance.now();
  private unsub: () => void; private unsubCam: () => void = () => {}; private raf = 0; private moveTimer = 0;
  private pendingDolly: { d0: number; timer: number } | null = null;
  private dollyRun: { d0: number } | null = null;   // one dolly row per zoom session: amended in place until another action intervenes
  private flushDolly() { const pd = this.pendingDolly; if (!pd) return; clearTimeout(pd.timer); this.pendingDolly = null;
    const d1 = this.camera.position.distanceTo(this.controls.target); if (Math.abs(d1 - pd.d0) < 0.01) return;
    const st = useStore.getState(); const last = st.history[st.history.length - 1];
    if (!(last?.verb === "dolly" && this.dollyRun)) this.dollyRun = { d0: pd.d0 };
    const p = this.camera.position, t = this.controls.target; const cam = { pos: [p.x, p.y, p.z] as [number, number, number], target: [t.x, t.y, t.z] as [number, number, number] };
    st.setCamera(cam); st.amend("dolly", `${this.dollyRun.d0.toFixed(2)} → ${d1.toFixed(2)} m`, { cam }); }
  private tween: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t0: number; ms: number } | null = null;

  constructor(private el: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.setSize(el.clientWidth, el.clientHeight);
    this.renderer.setClearColor(0x050506, 1); el.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(50, el.clientWidth / el.clientHeight, 0.05, 100); this.camera.position.set(4.2, 2.1, 5.4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.0, 0); this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49; this.controls.minDistance = 1; this.controls.maxDistance = 14;
    this.spark = new SparkRenderer({ renderer: this.renderer }); this.scene.add(this.spark);
    this.controls.addEventListener("change", () => { useStore.getState().setMoving(true); clearTimeout(this.moveTimer);
      this.moveTimer = window.setTimeout(() => useStore.getState().setMoving(false), 900); });
    useStore.setState({ liveCamera: () => { const p = this.camera.position, t = this.controls.target; return { pos: [p.x, p.y, p.z], target: [t.x, t.y, t.z] }; } });
    // every gesture is recorded on release, classified by the largest motion in metres: orbit (arc), pan (target), dolly (distance).
    // A click (short, negligible motion) is not a camera action — it is a selection, and the selection snapshot carries the camera.
    let gesture: { pos: THREE.Vector3; target: THREE.Vector3; t0: number } | null = null;
    this.controls.addEventListener("start", () => { gesture = { pos: this.camera.position.clone(), target: this.controls.target.clone(), t0: performance.now() }; });
    this.controls.addEventListener("end", () => {
      if (!gesture) return; const g = gesture; gesture = null; const p = this.camera.position, t = this.controls.target;
      const d0 = g.pos.distanceTo(g.target), d1 = p.distanceTo(t);
      const mPan = t.distanceTo(g.target), mDolly = Math.abs(d1 - d0), ang = g.pos.clone().sub(g.target).angleTo(p.clone().sub(t)), mOrbit = ang * d0;
      const biggest = Math.max(mPan, mDolly, mOrbit); const click = performance.now() - g.t0 < 250;
      if (biggest < (click ? 0.05 : 0.01)) return;                       // a click, or nothing moved
      const verb = biggest === mPan ? "pan" : biggest === mDolly ? "dolly" : "orbit";
      if (verb === "dolly") {                                             // wheel ticks arrive as separate gestures: coalesce them
        if (!this.pendingDolly) this.pendingDolly = { d0, timer: 0 }; clearTimeout(this.pendingDolly.timer);
        this.pendingDolly.timer = window.setTimeout(() => this.flushDolly(), 800); return;
      }
      this.flushDolly();
      const detail = verb === "pan" ? `→ ${t.x.toFixed(2)} ${t.y.toFixed(2)} ${t.z.toFixed(2)}` : `${(ang * 180 / Math.PI).toFixed(0)}°  ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}`;
      this.recordCamera(verb, detail);
    });
    this.renderer.domElement.addEventListener("pointerdown", () => this.flushDolly());   // a click or drag after zooming closes the zoom entry first
    // restore requests: tween the camera back to a logged state
    this.unsubCam = useStore.subscribe((s, prev) => { if (s.camRequest && s.camRequest !== prev.camRequest) this.tweenTo(s.camRequest.cam); });
    this.onResize = this.onResize.bind(this); addEventListener("resize", this.onResize);
    this.unsub = useStore.subscribe((s, prev) => { if (s.head !== prev.head || s.mode !== prev.mode || s.selected !== prev.selected || s.hover !== prev.hover) this.applyMode(s); });
    this.renderer.domElement.addEventListener("pointermove", (ev) => useStore.getState().setHover(this.pick(ev)));
    let downAt = 0; this.renderer.domElement.addEventListener("pointerdown", () => { downAt = performance.now(); });
    this.renderer.domElement.addEventListener("pointerup", (ev) => { if (performance.now() - downAt < 250) useStore.getState().select(this.pick(ev)); });
    this.loop = this.loop.bind(this); this.raf = requestAnimationFrame(this.loop);
  }

  async boot(manifestUrl = "commits.json") {
    const M: Manifest = await (await fetch(manifestUrl)).json(); this.M = M;
    const refScale = Math.cbrt(Math.abs(new THREE.Matrix3().set(...(M.world_from_ref.slice(0, 3).flatMap(r => r.slice(0, 3)) as [number, number, number, number, number, number, number, number, number])).determinant()));
    this.voxelOf = makeVoxelLookup(M); this.boxes = M.objects.map(o => worldBox(M, o.bbox));
    useStore.getState().setManifest(M, refScale);
    const t0 = performance.now(); const head = M.commits.length - 1;
    await this.loadCommit(head); this.applyMode(useStore.getState()); this.timings.firstFrameMs = Math.round(performance.now() - t0);
    for (let i = head - 1; i >= 0; i--) await this.loadCommit(i);
    this.timings.allLoadedMs = Math.round(performance.now() - t0);
  }

  private async loadCommit(i: number) {
    const c = this.M.commits[i]; const t0 = performance.now();
    const mesh = new SplatMesh({ url: c.file });            // no lod: per-splat rgba injection is disabled under LOD
    mesh.visible = false; this.scene.add(mesh);
    const [, label] = await Promise.all([mesh.initialized, loadLabels(c.labels, this.M.shape)]);
    const n = mesh.numSplats; const orig = new Uint8Array(n * 4); const lab = new Uint16Array(n);
    mesh.forEachSplat((idx, center, _s, _q, opacity, color) => {
      orig[idx * 4] = color.r * 255; orig[idx * 4 + 1] = color.g * 255; orig[idx * 4 + 2] = color.b * 255; orig[idx * 4 + 3] = opacity * 255;
      const v = this.voxelOf(center.x, center.y, center.z); lab[idx] = v < 0 ? 0 : label[v];
    });
    const rgba = new RgbaArray({ array: orig.slice(), count: n });
    mesh.splatRgba = rgba; mesh.updateGenerator();          // attach ONCE; mode changes only rewrite the array
    this.loaded[i] = { mesh, n, orig, label: lab, rgba }; this.timings[`load c${i}`] = Math.round(performance.now() - t0);
    useStore.getState().markLoaded(i, n);
  }

  private paint(i: number, f: (obj: number, a: Uint8Array, o: number) => void) {
    const L = this.loaded[i]!; const a = L.rgba.array!; const lab = L.label;
    for (let k = 0; k < L.n; k++) f(lab[k] - 1, a, k * 4);
    L.rgba.needsUpdate = true;
  }

  applyMode(s: State) {
    const t0 = performance.now(); const M = this.M; if (!M) return;
    for (const L of this.loaded) if (L) { L.mesh.visible = false; L.mesh.opacity = 1; }
    const emph = (obj: number) => (s.selected !== null && obj === s.selected) || (s.hover !== null && obj === s.hover);
    const anyEmph = s.selected !== null || s.hover !== null;
    if (s.mode.kind === "normal" || s.mode.kind === "onion") {
      const show = (s.mode.kind === "onion" ? this.loaded.map((_, i) => i) : [s.head]).filter(i => this.loaded[i]);
      for (const i of show) {
        const L = this.loaded[i]!; L.mesh.visible = true; L.mesh.opacity = i === s.head ? 1 : 0.12;
        this.paint(i, (obj, a, o) => { const d = anyEmph && !emph(obj) ? 0.45 : 1;
          a[o] = L.orig[o] * d; a[o + 1] = L.orig[o + 1] * d; a[o + 2] = L.orig[o + 2] * d; a[o + 3] = L.orig[o + 3]; });
      }
      if (s.diffStats) useStore.getState().setDiffStats(null);
    } else {
      const { a: ca, b: cb } = s.mode; const A = this.loaded[ca], B = this.loaded[cb]; if (!A || !B) return;
      const { added, removed } = objectsChanged(M, ca, cb);
      B.mesh.visible = true; A.mesh.visible = true;
      this.paint(cb, (obj, a, o) => { if (added.has(obj)) { a[o] = ADD[0]; a[o + 1] = ADD[1]; a[o + 2] = ADD[2]; a[o + 3] = B.orig[o + 3]; }
        else { a[o] = B.orig[o] * 0.28; a[o + 1] = B.orig[o + 1] * 0.28; a[o + 2] = B.orig[o + 2] * 0.28; a[o + 3] = B.orig[o + 3]; } });
      // hidden splats need rgb=0 AND alpha=0: colour is premultiplied downstream
      this.paint(ca, (obj, a, o) => { if (removed.has(obj)) { a[o] = REM[0]; a[o + 1] = REM[1]; a[o + 2] = REM[2]; a[o + 3] = A.orig[o + 3] * 0.85; } else { a[o] = 0; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0; } });
      const vol = [...added, ...removed].reduce((acc, id) => acc + M.objects[id].volume_vox_m3, 0) * s.refScale ** 3;
      useStore.getState().setDiffStats({ added: added.size, removed: removed.size, volumeM3: vol });
    }
    this.timings.lastModeMs = Math.round(performance.now() - t0);
  }

  private ray = new THREE.Raycaster(); private ndc = new THREE.Vector2();
  pick(ev: PointerEvent): number | null {
    const s = useStore.getState(); if (!this.M) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); this.ray.setFromCamera(this.ndc, this.camera);
    const vis = s.mode.kind === "diff" ? [s.mode.a, s.mode.b] : [s.head];
    let best: { id: number; d: number } | null = null;
    for (const ob of this.M.objects) { if (!vis.some(v => ob.present.includes(v))) continue;
      const hit = this.ray.ray.intersectBox(this.boxes[ob.id], new THREE.Vector3()); if (!hit) continue;
      const d = hit.distanceTo(this.camera.position); if (!best || d < best.d) best = { id: ob.id, d }; }
    this.renderer.domElement.style.cursor = best ? "pointer" : ""; return best?.id ?? null;
  }

  lookAt(id: number, dist = 3.5, h = 1.5) { const c = this.boxes[id].getCenter(new THREE.Vector3()); const dir = new THREE.Vector3(c.x, 0, c.z).normalize().multiplyScalar(-1);
    this.camera.position.set(c.x + dir.x * dist, h, c.z + dir.z * dist); this.controls.target.copy(c); this.controls.update(); this.recordCamera("frame", `obj ${String(id).padStart(2, "0")}`); }
  recordCamera(verb: string, detail: string) { const p = this.camera.position, t = this.controls.target;
    const cam = { pos: [p.x, p.y, p.z] as [number, number, number], target: [t.x, t.y, t.z] as [number, number, number] }; const st = useStore.getState(); st.setCamera(cam); st.log(verb, detail, { cam }); }
  setCam(x: number, y: number, z: number) { this.camera.position.set(x, y, z); this.controls.update(); }
  tweenTo(cam: { pos: number[]; target: number[] }, ms = 700) {
    this.tween = { from: this.camera.position.clone(), to: new THREE.Vector3(...(cam.pos as [number, number, number])),
      tFrom: this.controls.target.clone(), tTo: new THREE.Vector3(...(cam.target as [number, number, number])), t0: performance.now(), ms }; }
  private stepTween() { const tw = this.tween; if (!tw) return; const u = Math.min(1, (performance.now() - tw.t0) / tw.ms); const e = 1 - Math.pow(1 - u, 3);
    this.camera.position.lerpVectors(tw.from, tw.to, e); this.controls.target.lerpVectors(tw.tFrom, tw.tTo, e);
    if (u >= 1) { this.tween = null; const p = this.camera.position, t = this.controls.target; useStore.getState().setCamera({ pos: [p.x, p.y, p.z], target: [t.x, t.y, t.z] }); } }
  renderOnce() { this.stepTween(); this.controls.update(); this.renderer.render(this.scene, this.camera); }
  private onResize() { const w = this.el.clientWidth, h = this.el.clientHeight; this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h); }
  private loop() { if (!this.paused) { this.renderOnce(); this.frames++; const t = performance.now(); if (t - this.fpsT > 1000) { this.timings.fps = Math.round(this.frames * 1000 / (t - this.fpsT)); this.frames = 0; this.fpsT = t; } } this.raf = requestAnimationFrame(this.loop); }
  dispose() { this.flushDolly(); cancelAnimationFrame(this.raf); this.unsub(); this.unsubCam(); removeEventListener("resize", this.onResize); for (const L of this.loaded) L?.mesh.dispose(); this.renderer.dispose(); this.el.innerHTML = ""; }

  /** Test/debug hooks (used by test_viewer.py). */
  debug() { const L = this.loaded[useStore.getState().head]; const gl = this.renderer.getContext() as WebGL2RenderingContext; this.renderOnce();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight; const px = new Uint8Array(4 * 512); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.readPixels(Math.floor(w / 2) - 256, Math.floor(h / 2), 512, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0, nz = 0; for (let i = 0; i < 512; i++) { const v = px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]; sum += v; if (v > 30) nz++; }
    return { info: { ...this.renderer.info.render }, numSplats: L?.n, centreRowMeanRGB: sum / 512, centreRowLitPixels: nz }; }
  grab() { for (let i = 0; i < 8; i++) this.renderOnce(); const gl = this.renderer.getContext() as WebGL2RenderingContext; const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const c = document.createElement("canvas"); c.width = w; c.height = h; const ctx = c.getContext("2d")!; const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255; ctx.putImageData(img, 0, 0); return c.toDataURL("image/png"); }
}
