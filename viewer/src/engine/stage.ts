/**
 * The 3D side. Owns three.js, Spark, the layers (one per commit) and the camera.
 * Subscribes to the store; never touches React. React never touches this except to mount it.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SparkRenderer, SplatMesh, RgbaArray, unpackSplat } from "@sparkjsdev/spark";
import type { Manifest } from "../types";
import { parseManifest } from "../manifest";
import { loadLabels, makeVoxelLookup, refScaleOf, roomBox } from "../labels";
import { useStore, objectsChanged, traceChain, type State, type Cam } from "../store";
import { ADD, REM, buildObjects, makeStyle, paint, setColor, setDim, setHidden, setOpacity, type Layer, type Style } from "./layer";
import { Gestures } from "./gestures";
import { Overlay, type BoxItem } from "./overlay";
import { Minimap } from "./minimap";
import { auraOf, placementsOf, score } from "../aura";

const CLICK_MS = 250;
const GHOST_OPACITY = 0.12;
const GHOST_FOCUS_OPACITY = 0.4; // tracing one object draws far less, so its past states can be bolder
const UNFOCUSED_DIM = 0.45;
const DIFF_CONTEXT_DIM = 0.28;
const REMOVED_ALPHA = 0.85;
const LABEL_CHUNK = 262144; // splats labelled per task before yielding to the render loop
const PICK_STRIDE = 3; // keep every 3rd labelled splat for picking
const PICK_RADIUS_VOXELS = 1.5; // the pointer hits an object when it passes within this many voxels of one of its splats
const SETTLE_MS = 1200; // keep rendering this long after the last change (damping tails, Spark's async sort results)
const MOVING_SETTLE_MS = 900;
const TWEEN_MS = 700;
const WATCHDOG_MS = 250;

type Tween = { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t0: number; ms: number };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const yieldToLoop = () => new Promise<void>((r) => setTimeout(r, 0));

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly spark: SparkRenderer;
  readonly timings: Record<string, number> = {};
  paused = false;

  private M: Manifest | null = null;
  layers: (Layer | undefined)[] = [];
  private boxes: THREE.Box3[] = []; // tight, room-aligned: what the overlay draws
  private cull: THREE.Box3[] = []; // the same grown by the pick radius: a cheap first pass for picking
  private pickR2 = 0; // squared pick radius in world units
  private voxelOf: (x: number, y: number, z: number) => number = () => -1;
  private gestures: Gestures;
  private overlay: Overlay;
  private minimap: Minimap;
  private tween: Tween | null = null;
  private activeUntil = performance.now() + SETTLE_MS;
  private needsFrame = true; // a change is guaranteed at least one frame, however slow the GPU
  private frames = 0;
  private fpsT = performance.now();
  private raf = 0;
  private watchdog = 0;
  private lastTick = performance.now();
  private moveTimer = 0;
  private dragging = false;
  private downAt = 0;
  private disposed = false;
  private readonly abort = new AbortController();
  private readonly unsubs: (() => void)[] = [];
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  constructor(private el: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(el.clientWidth, el.clientHeight);
    this.renderer.setClearColor(0x050506, 1);
    el.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, el.clientWidth / el.clientHeight, 0.05, 100);
    this.camera.position.set(4.2, 2.1, 5.4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 14;
    // Spark generates and sorts asynchronously; onDirty fires when new results land, so the idle gate reopens for them
    this.spark = new SparkRenderer({ renderer: this.renderer, onDirty: () => this.touch() });
    this.scene.add(this.spark);
    this.gestures = new Gestures(this.camera, this.controls);
    this.overlay = new Overlay(el);
    this.overlay.resize(el.clientWidth, el.clientHeight);
    this.minimap = new Minimap(el);

    useStore.setState({ liveCamera: () => this.gestures.snapshot() });
    this.controls.addEventListener("change", this.onControlsChange);
    const dom = this.renderer.domElement;
    dom.addEventListener("pointermove", this.onPointerMove);
    dom.addEventListener("pointerdown", this.onPointerDown);
    dom.addEventListener("pointerup", this.onPointerUp);
    dom.addEventListener("pointerleave", this.onPointerLeave);
    addEventListener("resize", this.onResize);

    this.unsubs.push(
      // restore requests: tween the camera back to a logged state
      useStore.subscribe((s, prev) => {
        if (s.camRequest && s.camRequest !== prev.camRequest) this.tweenTo(s.camRequest.cam);
      }),
      useStore.subscribe((s, prev) => {
        if (s.head !== prev.head || s.mode !== prev.mode || s.selected !== prev.selected || s.loaded !== prev.loaded) {
          this.applyMode(s);
        }
      }),
      // hover never restyles splats; it only changes which overlay box is emphasised, so a redraw is enough
      useStore.subscribe((s, prev) => {
        if (s.hover !== prev.hover) this.touch();
      }),
    );
    this.raf = requestAnimationFrame(this.loop);
    // watchdog: headless and throttled contexts can stop issuing animation frames; keep the loop alive at a low rate
    this.watchdog = window.setInterval(() => {
      if (performance.now() - this.lastTick > WATCHDOG_MS) this.loop();
    }, WATCHDOG_MS);
  }

  /** Fetch the set's manifest, then its commits oldest-first: c0 is the first frame and the log writes itself forward in time. */
  async boot(set = new URLSearchParams(location.search).get("set") ?? "garage") {
    const base = `sets/${encodeURIComponent(set)}/`;
    const store = useStore.getState();
    const t0 = performance.now();
    try {
      const res = await fetch(base + "commits.json", { signal: this.abort.signal });
      // SPA hosts answer missing files with index.html and a 200, so check the type, not just the status
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error(`no such set '${set}'`);
      const M = parseManifest(await res.json());
      if (this.disposed) return;
      this.M = M;
      this.voxelOf = makeVoxelLookup(M);
      const refScale = refScaleOf(M);
      const pickR = M.voxel * refScale * PICK_RADIUS_VOXELS;
      this.pickR2 = pickR ** 2;
      this.boxes = M.objects.map(
        (o) =>
          new THREE.Box3(
            new THREE.Vector3(...(o.bbox[0] as [number, number, number])),
            new THREE.Vector3(...(o.bbox[1] as [number, number, number])),
          ),
      );
      // grown by the pick radius the boxes cull candidates without ever rejecting a real hit
      this.cull = this.boxes.map((b) => b.clone().expandByScalar(pickR));
      const room = roomBox(M);
      this.frameRoom(room);
      this.minimap.setRoom(room);
      store.setManifest(M, refScale);
      let any = false;
      for (let i = 0; i < M.commits.length; i++) {
        try {
          await this.loadCommit(base, i);
          any = true;
          if (i === 0) this.timings.firstFrameMs = Math.round(performance.now() - t0);
        } catch (e) {
          if (this.disposed) return;
          store.markFailed(i, errMsg(e));
        }
      }
      if (!any) throw new Error(`no commit of '${set}' could be loaded`);
      this.timings.allLoadedMs = Math.round(performance.now() - t0);
      store.setStatus("ready");
    } catch (e) {
      if (!this.disposed) store.fail(errMsg(e));
    }
  }

  private async loadCommit(base: string, i: number) {
    const M = this.M!;
    const c = M.commits[i];
    const t0 = performance.now();
    const mesh = new SplatMesh({ url: base + c.file }); // no LOD: per-splat rgba injection is disabled under LOD
    mesh.visible = false;
    try {
      const [, label] = await Promise.all([mesh.initialized, loadLabels(base + c.labels, M.shape, this.abort.signal)]);
      if (this.disposed) throw new Error("disposed");
      const n = mesh.numSplats;
      const packed = mesh.packedSplats?.packedArray;
      if (!packed) throw new Error(`${c.file}: splats not unpacked`);
      const enc = mesh.packedSplats?.splatEncoding;
      const orig = new Uint8Array(n * 4);
      const lab = new Uint16Array(n);
      const acc: number[][] = []; // per label: sampled splat centres, for picking
      const seen: number[] = [];
      // Label in chunks so a 4M-splat commit does not freeze the frame it lands in.
      for (let k0 = 0; k0 < n; k0 += LABEL_CHUNK) {
        const k1 = Math.min(n, k0 + LABEL_CHUNK);
        for (let k = k0; k < k1; k++) {
          const s = unpackSplat(packed, k, enc);
          orig[k * 4] = s.color.r * 255;
          orig[k * 4 + 1] = s.color.g * 255;
          orig[k * 4 + 2] = s.color.b * 255;
          orig[k * 4 + 3] = s.opacity * 255;
          const v = this.voxelOf(s.center.x, s.center.y, s.center.z);
          const o = v < 0 ? 0 : label[v];
          lab[k] = o;
          if (o > 0) {
            if ((seen[o] = (seen[o] ?? 0) + 1) % PICK_STRIDE === 0) (acc[o] ??= []).push(s.center.x, s.center.y, s.center.z);
          }
        }
        if (k1 < n) await yieldToLoop();
        if (this.disposed) throw new Error("disposed");
      }
      const rgba = new RgbaArray({ array: orig.slice(), count: n });
      mesh.splatRgba = rgba;
      mesh.updateGenerator(); // attach ONCE; mode changes only rewrite the array
      this.scene.add(mesh);
      const L: Layer = { mesh, n, orig, label: lab, rgba, style: null, objects: null, pts: acc.map((a) => (a ? new Float32Array(a) : undefined)) };
      L.objects = buildObjects(L);
      if (L.objects) {
        await L.objects.mesh.initialized;
        this.scene.add(L.objects.mesh);
        this.timings[`objects c${i}`] = L.objects.n;
      }
      this.layers[i] = L;
      this.timings[`load c${i}`] = Math.round(performance.now() - t0);
      useStore.getState().markLoaded(i, n);
    } catch (e) {
      mesh.dispose();
      throw e;
    }
  }

  /** Start inside the room, near a corner at standing height, looking at its centre; bound the orbit to the room. */
  private frameRoom(box: THREE.Box3) {
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.z) || 1;
    const diag = size.length() || 1;
    this.controls.target.set(c.x, box.min.y + size.y * 0.3, c.z);
    this.camera.position.set(c.x + size.x * 0.46, box.min.y + Math.min(size.y * 0.6, 1.7), c.z + size.z * 0.46);
    this.controls.minDistance = span * 0.1;
    this.controls.maxDistance = diag * 0.9;
    this.camera.far = span * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.touch();
  }

  /** Recompute every layer's visibility, opacity and per-object style from the store. Unchanged layers are not repainted. */
  applyMode(s: State) {
    const M = this.M;
    if (!M) return;
    const t0 = performance.now();
    const nObj = M.objects.length;
    // emphasis is selection only: hovering never changes what the room looks like
    const sel = s.selected === null ? -1 : s.selected + 1;
    for (const L of this.layers) {
      if (!L) continue;
      L.mesh.visible = false;
      if (L.objects) L.objects.mesh.visible = false;
    }

    if (s.mode.kind === "diff") {
      const { a: ca, b: cb } = s.mode;
      const A = this.layers[ca];
      const B = this.layers[cb];
      if (!A || !B) return;
      const { added, removed } = objectsChanged(M, ca, cb);
      const sb: Style = makeStyle(nObj);
      const sa: Style = makeStyle(nObj);
      for (let o = 0; o <= nObj; o++) {
        if (added.has(o - 1)) setColor(sb, o, ADD, 1);
        else setDim(sb, o, DIFF_CONTEXT_DIM);
        if (removed.has(o - 1)) setColor(sa, o, REM, REMOVED_ALPHA);
        else setHidden(sa, o);
      }
      for (const L of [A, B]) {
        L.mesh.visible = true;
        setOpacity(L.mesh, 1);
      }
      paint(B, sb);
      paint(A, sa);
    } else if (s.mode.kind === "onion") {
      // Every state at once, standing in the commit you are on: HEAD's own capture is the room, and every
      // other commit lends only its objects. The room is untouched between captures, so drawing it once
      // per commit would cost N× and blur N copies of the same wall at the registration residual.
      // With an object selected this becomes a trace of that one object: only its past states appear.
      const traced = s.selected === null ? null : new Set(traceChain(M, s.selected));
      const shell = this.layers[s.head];
      if (shell) {
        shell.mesh.visible = true;
        setOpacity(shell.mesh, 1);
        const st = makeStyle(nObj);
        const lit = (o: number) => (traced ? traced.has(o - 1) : o === sel);
        if (traced || sel > 0) for (let o = 0; o <= nObj; o++) if (!lit(o)) setDim(st, o, UNFOCUSED_DIM);
        paint(shell, st);
      }
      const chain = traced;
      const ghost = makeStyle(nObj);
      // when tracing, every other object's splats are hidden rather than drawn faintly
      if (chain) for (let o = 0; o <= nObj; o++) if (!chain.has(o - 1)) setHidden(ghost, o);
      for (let i = 0; i < this.layers.length; i++) {
        if (i === s.head) continue;
        const objects = this.layers[i]?.objects;
        if (!objects) continue;
        objects.mesh.visible = true;
        setOpacity(objects.mesh, chain === null ? GHOST_OPACITY : GHOST_FOCUS_OPACITY);
        paint(objects, ghost);
      }
    } else {
      const L = this.layers[s.head];
      if (L) {
        L.mesh.visible = true;
        setOpacity(L.mesh, 1);
        const st = makeStyle(nObj);
        if (sel > 0) for (let o = 0; o <= nObj; o++) if (o !== sel) setDim(st, o, UNFOCUSED_DIM);
        paint(L, st);
      }
    }
    this.touch();
    this.timings.lastModeMs = Math.round(performance.now() - t0);
  }

  /**
   * Object under the pointer, among objects present in the visible commit(s). The bounding box only culls candidates;
   * the hit is decided against the object's own splats, so the pointer has to be on the thing, not near it.
   * Ghost layers are not pickable.
   */
  pick(ev: { clientX: number; clientY: number }): number | null {
    const M = this.M;
    if (!M) return null;
    const s = useStore.getState();
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const ray = this.ray.ray;
    const vis = s.mode.kind === "diff" ? [s.mode.a, s.mode.b] : s.mode.kind === "onion" ? M.commits.map((c) => c.index) : [s.head];
    let best: { id: number; d: number } | null = null;
    const hit = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (const ob of M.objects) {
      if (!vis.some((v) => ob.present.includes(v))) continue;
      if (!ray.intersectBox(this.cull[ob.id], hit)) continue;
      let d2min = Infinity;
      let d = 0;
      for (const v of vis) {
        const P = ob.present.includes(v) ? this.layers[v]?.pts[ob.id + 1] : undefined;
        if (!P) continue;
        for (let i = 0; i < P.length; i += 3) {
          p.set(P[i], P[i + 1], P[i + 2]);
          const d2 = ray.distanceSqToPoint(p);
          if (d2 < d2min) {
            d2min = d2;
            d = p.distanceTo(this.camera.position);
          }
        }
      }
      if (d2min > this.pickR2) continue;
      if (!best || d < best.d) best = { id: ob.id, d };
    }
    return best?.id ?? null;
  }

  /** Frame an object from the room's centre side and log it. */
  lookAt(id: number, dist = 3.5, h = 1.5) {
    const box = this.boxes[id];
    if (!box) return;
    this.cancelTween();
    const c = box.getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3(c.x, 0, c.z).normalize().multiplyScalar(-1);
    this.camera.position.set(c.x + dir.x * dist, h, c.z + dir.z * dist);
    this.controls.target.copy(c);
    this.controls.update();
    this.gestures.record("frame", `obj ${String(id).padStart(2, "0")}`);
  }

  setCam(x: number, y: number, z: number) {
    this.cancelTween();
    this.camera.position.set(x, y, z);
    this.controls.update();
    this.touch();
  }

  tweenTo(cam: Cam, ms = TWEEN_MS) {
    this.gestures.flushDolly();
    this.controls.enabled = false; // user input during a tween would fight it; a pointerdown cancels instead
    this.tween = {
      from: this.camera.position.clone(),
      to: new THREE.Vector3(...cam.pos),
      tFrom: this.controls.target.clone(),
      tTo: new THREE.Vector3(...cam.target),
      t0: performance.now(),
      ms,
    };
  }

  private cancelTween() {
    if (!this.tween) return;
    this.tween = null;
    this.controls.enabled = true;
  }

  /** Advance the camera tween; returns true while one is running. */
  private stepTween(): boolean {
    const tw = this.tween;
    if (!tw) return false;
    const u = Math.min(1, (performance.now() - tw.t0) / tw.ms);
    const e = 1 - Math.pow(1 - u, 3);
    this.camera.position.lerpVectors(tw.from, tw.to, e);
    this.controls.target.lerpVectors(tw.tFrom, tw.tTo, e);
    if (u >= 1) {
      this.cancelTween();
      useStore.getState().setCamera(this.gestures.snapshot());
    }
    return true;
  }

  renderOnce() {
    this.stepTween();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.drawChrome();
  }

  /** The 2D layers above the splats: the detection overlay and the minimap, from one pass over the mode. */
  private drawChrome() {
    const items = this.boxItems(useStore.getState());
    this.overlay.draw(this.camera, items);
    this.minimap.draw(this.camera, this.controls.target, items);
  }

  /**
   * What the detection overlay should box, given the mode: what is present now, what changed, or —
   * when tracing — every position one object has occupied. Labels carry measured values only.
   */
  private boxItems(s: State): BoxItem[] {
    const M = this.M;
    if (!M) return [];
    const vol = (o: number) => `${M.objects[o].volume_vox_m3.toFixed(2)} m³`;
    const sc = s.mode.kind === "diff" ? null : score(M, placementsOf(M, s.head));
    // the tag is the name, a thing's sublabel, and for a plant in a scene its aura: measured values only
    const tag = (o: number) => {
      const ob = M.objects[o];
      const label = /^object \d+$/i.test(ob.name) ? `obj ${String(o).padStart(2, "0")}` : ob.name;
      if (ob.kind === "plant") return sc && ob.present.includes(s.head) ? `${label} · ${auraOf(sc, o)}` : label;
      return ob.sub ? `${label} · ${ob.sub}` : label;
    };
    const items: BoxItem[] = [];
    const push = (o: number, label: string, tone: BoxItem["tone"], emphasis: boolean) => items.push({ box: this.boxes[o], label, tone, emphasis });

    if (s.mode.kind === "diff") {
      const { added, removed } = objectsChanged(M, s.mode.a, s.mode.b);
      for (const o of added) push(o, `+ ${tag(o)}`, "add", o === s.selected || o === s.hover);
      for (const o of removed) push(o, `− ${tag(o)}`, "rem", o === s.selected || o === s.hover);
      return items;
    }
    if (s.mode.kind === "onion") {
      const chain = s.selected === null ? null : traceChain(M, s.selected);
      if (chain) {
        for (const o of chain) {
          const at = M.objects[o].present.map((c) => `c${c}`).join(" ");
          push(o, `${at} · ${vol(o)}`, "trace", o === s.selected);
        }
        return items;
      }
      for (const ob of M.objects) push(ob.id, tag(ob.id), "neutral", ob.id === s.selected || ob.id === s.hover);
      return items;
    }
    for (const ob of M.objects) {
      if (!ob.present.includes(s.head)) continue;
      push(ob.id, tag(ob.id), "neutral", ob.id === s.selected || ob.id === s.hover);
    }
    return items;
  }

  private loop = () => {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
    this.lastTick = performance.now();
    if (this.paused) return;
    const tweening = this.stepTween();
    const moved = this.controls.update();
    if (tweening || moved) this.touch();
    const t = performance.now();
    if (t - this.fpsT > 1000) {
      this.timings.fps = Math.round((this.frames * 1000) / (t - this.fpsT));
      this.frames = 0;
      this.fpsT = t;
    }
    // idle gate: nothing changed recently. Spark's async sort needs no frames to progress; onDirty reopens the gate when it lands
    if (!this.needsFrame && t > this.activeUntil) return;
    this.needsFrame = false;
    this.renderer.render(this.scene, this.camera);
    this.drawChrome();
    this.frames++;
  };

  /** Something changed: render for a while, then go idle again. */
  touch() {
    this.needsFrame = true;
    this.activeUntil = performance.now() + SETTLE_MS;
  }

  private onControlsChange = () => {
    this.touch();
    const st = useStore.getState();
    st.setMoving(true);
    clearTimeout(this.moveTimer);
    this.moveTimer = window.setTimeout(() => useStore.getState().setMoving(false), MOVING_SETTLE_MS);
  };
  private onPointerMove = (ev: PointerEvent) => {
    if (this.dragging) return; // no hover churn mid-gesture
    const id = this.pick(ev);
    this.renderer.domElement.style.cursor = id === null ? "" : "pointer";
    useStore.getState().setHover(id);
  };
  private onPointerDown = () => {
    this.downAt = performance.now();
    this.dragging = true;
    this.cancelTween();
    this.gestures.flushDolly(); // a click or drag after zooming closes the zoom entry first
  };
  private onPointerUp = (ev: PointerEvent) => {
    this.dragging = false;
    if (performance.now() - this.downAt < CLICK_MS) useStore.getState().select(this.pick(ev));
  };
  private onPointerLeave = () => {
    this.dragging = false;
    useStore.getState().setHover(null);
  };
  private onResize = () => {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.overlay.resize(w, h);
    this.touch();
  };

  dispose() {
    this.disposed = true;
    this.abort.abort();
    cancelAnimationFrame(this.raf);
    clearInterval(this.watchdog);
    clearTimeout(this.moveTimer);
    for (const u of this.unsubs) u();
    this.gestures.dispose();
    this.controls.removeEventListener("change", this.onControlsChange);
    this.controls.dispose();
    const dom = this.renderer.domElement;
    dom.removeEventListener("pointermove", this.onPointerMove);
    dom.removeEventListener("pointerdown", this.onPointerDown);
    dom.removeEventListener("pointerup", this.onPointerUp);
    dom.removeEventListener("pointerleave", this.onPointerLeave);
    removeEventListener("resize", this.onResize);
    for (const L of this.layers) {
      if (!L) continue;
      L.rgba.dispose();
      L.mesh.dispose();
      L.objects?.rgba.dispose();
      L.objects?.mesh.dispose();
    }
    this.layers = [];
    this.spark.dispose();
    this.overlay.dispose();
    this.minimap.dispose();
    this.renderer.dispose();
    dom.remove();
    useStore.setState({ liveCamera: null });
  }

  /** Test/debug hooks (used by smoke.py). */
  stats() {
    return this.layers.map((L, i) => {
      if (!L) return { i, loaded: false };
      let labelled = 0;
      for (let k = 0; k < L.n; k++) if (L.label[k]) labelled++;
      const a = L.rgba.array;
      let changed = 0;
      if (a) for (let k = 0; k < L.n * 4; k += 4) if (a[k] !== L.orig[k] || a[k + 3] !== L.orig[k + 3]) changed++;
      return {
        i,
        loaded: true,
        n: L.n,
        labelled,
        changed,
        visible: L.mesh.visible,
        opacity: L.mesh.opacity,
        injected: L.mesh.splatRgba === L.rgba,
        objects: L.objects?.n ?? 0,
        drawn: (L.mesh.visible ? L.n : 0) + (L.objects?.mesh.visible ? L.objects.n : 0),
      };
    });
  }

  debug() {
    const L = this.layers[useStore.getState().head];
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    this.renderOnce();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(4 * 512);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.readPixels(Math.floor(w / 2) - 256, Math.floor(h / 2), 512, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0;
    let nz = 0;
    for (let i = 0; i < 512; i++) {
      const v = px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2];
      sum += v;
      if (v > 30) nz++;
    }
    return { info: { ...this.renderer.info.render }, numSplats: L?.n, centreRowMeanRGB: sum / 512, centreRowLitPixels: nz };
  }

  grab() {
    for (let i = 0; i < 8; i++) this.renderOnce();
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  }
}
