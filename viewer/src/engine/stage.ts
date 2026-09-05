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
import { useStore, type State, type Cam, type Placed } from "../store";
import {
  ADD,
  REM,
  buildObject,
  buildObjects,
  makeStyle,
  paint,
  setColor,
  setDim,
  setFade,
  setHidden,
  setOpacity,
  type Layer,
  type Paintable,
  type Style,
} from "./layer";
import { Gestures } from "./gestures";
import { Overlay, type BoxItem, type Tone } from "./overlay";
import { Minimap } from "./minimap";
import { centre, diff, drift, metres, type Change } from "../scene";
import { monthOf } from "../time";

const CLICK_MS = 250;
const STANDARD_GHOST_OPACITY = 0.35; // the standard's ghost of a thing, where it belongs
const IN_HAND_OPACITY = 0.7; // a draft's thing in hand, following the pointer
const OLD_PLACE_ALPHA = 0.5; // in a diff, a moved thing's old place under the arrow to its new one
const UNFOCUSED_DIM = 0.45;
const DIM_DELAY_MS = 200; // the dim on selection starts after the documentation rail has begun to rise…
const DIM_MS = 1000; // …and takes this long, slower than the rail
const REMOVED_ALPHA = 0.85;
const LABEL_CHUNK = 262144; // splats labelled per task before yielding to the render loop
const PICK_STRIDE = 3; // keep every 3rd labelled splat for picking
const PICK_RADIUS_VOXELS = 1.5; // a bracket reaches this far past the object's splats; inside the bracket is a hit
const SETTLE_MS = 1200; // keep rendering this long after the last change (damping tails, Spark's async sort results)
const MOVING_SETTLE_MS = 900;
const TWEEN_MS = 700;
const WALL_MARGIN_M = 0.15; // the camera stays this far inside the walls, floor and ceiling
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
  // the dim on selection: the head layer's recolor uniform ramps between 1 and UNFOCUSED_DIM; nothing is repainted.
  // The selected thing is drawn as its own part at full colour on top, and stays while the dim fades back out.
  private dimTarget = 1;
  private dimValue = 1;
  private dimFrom = 1;
  private dimT0 = 0;
  private focusId: number | null = null; // the thing kept bright, kept until the ramp is back at 1
  private bounds: THREE.Box3 | null = null; // the room, shrunk by the margin: the camera and its target stay inside
  private roomCentre = new THREE.Vector3(); // what a click on the map's floor turns the camera toward
  private eyeY = 1.6; // standing height for a camera put down from the map
  private readonly floorRay = new THREE.Raycaster();
  private readonly floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // y = 0: where a proposal puts things down
  private readonly floorHit = new THREE.Vector3();
  private readonly ndc = new THREE.Vector2();
  private readonly dirTmp = new THREE.Vector3();
  private boxes: THREE.Box3[] = []; // tight, room-aligned: the minimap footprint, and the bracket until the commit loads
  private copies = new Map<number, Paintable>(); // a draft's placements by key: each its own mesh, so copies are cheap
  private pickR = 0; // world metres a bracket extends past the object's splats
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
  private gen = 0; // which open() is current: a later one supersedes an earlier one's loads as they land
  private loader: AbortController | null = null; // the current open()'s fetches
  private readonly unsubs: (() => void)[] = [];

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
    // the map is a section of the scene rail; the rail leaves it a slot. Without one (tests, other hosts) it sits beside the stage.
    this.minimap = new Minimap(document.getElementById("map-slot") ?? el.parentElement ?? el);
    this.minimap.onPick = (item) => {
      const st = useStore.getState();
      if (st.mode.kind === "draft") {
        if (item.key !== undefined && !st.draft?.inHand) st.pickUpPlaced(item.key);
        return;
      }
      st.select(item.id);
    };
    this.minimap.onGo = (x, z) => this.goFromMap(x, z);

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
        if (
          s.head !== prev.head ||
          s.mode !== prev.mode ||
          s.selected !== prev.selected ||
          s.loaded !== prev.loaded ||
          s.ghosts !== prev.ghosts ||
          s.standard !== prev.standard ||
          s.draft !== prev.draft
        ) {
          this.applyMode(s);
        }
      }),
      // hover never restyles splats; it only changes which overlay box is emphasised, so a redraw is enough
      useStore.subscribe((s, prev) => {
        if (s.hover !== prev.hover) this.touch();
      }),
      // a thing in hand follows the pointer; the orbit waits
      useStore.subscribe((s, prev) => {
        const held = s.draft?.inHand != null;
        if (held !== (prev.draft?.inHand != null)) {
          this.controls.enableRotate = !held;
          this.controls.enablePan = !held;
          this.renderer.domElement.style.cursor = held ? "crosshair" : "";
          this.touch();
        }
      }),
      // the deck is opaque: nothing renders behind it until the user arrives
      useStore.subscribe((s, prev) => {
        if (s.page !== prev.page) this.touch();
      }),
    );
    this.raf = requestAnimationFrame(this.loop);
    // watchdog: headless and throttled contexts can stop issuing animation frames; keep the loop alive at a low rate
    this.watchdog = window.setInterval(() => {
      if (performance.now() - this.lastTick > WATCHDOG_MS) this.loop();
    }, WATCHDOG_MS);
  }

  /** Open the set the store shows, and every set it switches to after: a change of site empties the room and loads the next. */
  boot() {
    this.unsubs.push(
      useStore.subscribe((s, prev) => {
        if (s.set !== prev.set) void this.open(s.set);
      }),
    );
    return this.open(useStore.getState().set);
  }

  /** A load from an earlier open(), or after dispose: its results are dropped. */
  private stale(gen: number) {
    return this.disposed || gen !== this.gen;
  }

  /** Fetch a set's manifest, then its commits oldest-first: c0 is the first frame and the log writes itself forward in time. */
  private async open(set: string) {
    const gen = ++this.gen;
    this.loader?.abort();
    const loader = (this.loader = new AbortController());
    this.clear();
    const base = `sets/${encodeURIComponent(set)}/`;
    const store = useStore.getState();
    const t0 = performance.now();
    try {
      const res = await fetch(base + "commits.json", { signal: loader.signal });
      // SPA hosts answer missing files with index.html and a 200, so check the type, not just the status
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error(`no such set '${set}'`);
      const M = parseManifest(await res.json());
      if (this.stale(gen)) return;
      this.M = M;
      this.voxelOf = makeVoxelLookup(M);
      const refScale = refScaleOf(M);
      this.pickR = M.voxel * refScale * PICK_RADIUS_VOXELS;
      this.boxes = M.objects.map(
        (o) =>
          new THREE.Box3(
            new THREE.Vector3(...(o.bbox[0] as [number, number, number])),
            new THREE.Vector3(...(o.bbox[1] as [number, number, number])),
          ),
      );
      const room = roomBox(M);
      this.bounds = room.clone().expandByScalar(-WALL_MARGIN_M);
      this.frameRoom(room, M.view);
      this.minimap.setRoom(room);
      store.setManifest(M, refScale);
      // arriving from another floor, the log starts over with it (from the deck, `arrive` writes "begin")
      if (gen > 1 && useStore.getState().page !== "title") store.log("open", useStore.getState().sites.find((x) => x.set === set)?.name ?? set);
      let any = false;
      for (let i = 0; i < M.commits.length; i++) {
        try {
          await this.loadCommit(base, i, gen, loader.signal);
          any = true;
          if (i === 0) this.timings.firstFrameMs = Math.round(performance.now() - t0);
        } catch (e) {
          if (this.stale(gen)) return;
          store.markFailed(i, errMsg(e));
        }
      }
      if (!any) throw new Error(`no commit of '${set}' could be loaded`);
      this.timings.allLoadedMs = Math.round(performance.now() - t0);
      store.setStatus("ready");
    } catch (e) {
      if (!this.stale(gen)) store.fail(errMsg(e));
    }
  }

  /** Empty the room: every layer, part and copy gone, the manifest forgotten. */
  private clear() {
    this.cancelTween();
    for (const L of this.layers) {
      if (!L) continue;
      for (const p of [L, L.objects, ...L.parts.values()]) {
        if (!p) continue;
        this.scene.remove(p.mesh);
        p.rgba.dispose();
        p.mesh.dispose();
      }
    }
    this.layers = [];
    this.pruneCopies(new Set());
    this.M = null;
    this.boxes = [];
    this.bounds = null;
    this.focusId = null;
    this.dimValue = this.dimTarget = this.dimFrom = 1;
    this.touch();
  }

  private async loadCommit(base: string, i: number, gen: number, signal: AbortSignal) {
    const M = this.M!;
    const c = M.commits[i];
    const t0 = performance.now();
    const mesh = new SplatMesh({ url: base + c.file }); // no LOD: per-splat rgba injection is disabled under LOD
    mesh.visible = false;
    try {
      const [, label] = await Promise.all([mesh.initialized, loadLabels(base + c.labels, M.shape, signal)]);
      if (this.stale(gen)) throw new Error("superseded");
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
        if (this.stale(gen)) throw new Error("superseded");
      }
      const rgba = new RgbaArray({ array: orig.slice(), count: n });
      mesh.splatRgba = rgba;
      mesh.updateGenerator(); // attach ONCE; mode changes only rewrite the array
      this.scene.add(mesh);
      const L: Layer = {
        mesh,
        n,
        orig,
        label: lab,
        rgba,
        style: null,
        objects: null,
        parts: new Map(),
        pts: acc.map((a) => (a ? new Float32Array(a) : undefined)),
      };
      L.objects = buildObjects(L);
      if (L.objects) {
        await L.objects.mesh.initialized;
        if (this.stale(gen)) {
          this.scene.remove(mesh);
          L.objects.mesh.dispose();
          L.rgba.dispose();
          L.objects.rgba.dispose();
          throw new Error("superseded");
        }
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

  /** Keep the camera and what it orbits inside the room. Orbit re-derives its spherical state from the position, so a clamp holds. */
  private clampToRoom() {
    const b = this.bounds;
    if (!b) return;
    this.camera.position.clamp(b.min, b.max);
    this.controls.target.clamp(b.min, b.max);
  }

  /** Start where the set says, else inside the room near a corner at standing height, looking at its centre; bound the orbit to the room. */
  private frameRoom(box: THREE.Box3, view: Manifest["view"]) {
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.z) || 1;
    const diag = size.length() || 1;
    this.controls.target.set(c.x, box.min.y + size.y * 0.3, c.z);
    this.roomCentre.set(c.x, box.min.y + size.y * 0.3, c.z);
    this.eyeY = box.min.y + Math.min(size.y * 0.6, 1.7);
    this.camera.position.set(c.x + size.x * 0.46, this.eyeY, c.z + size.z * 0.46);
    if (view) {
      this.camera.position.set(view.pos[0], view.pos[1], view.pos[2]);
      this.controls.target.set(view.target[0], view.target[1], view.target[2]);
    }
    this.controls.minDistance = span * 0.1;
    this.controls.maxDistance = diag * 0.9;
    this.camera.far = span * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.touch();
  }

  /** The standard's ghosts: these objects drawn from the standard's own capture, where it put them. */
  private standardGhosts(ids: number[], standard: number, nObj: number) {
    for (const id of ids) {
      const part = this.part(standard, id);
      if (!part || !part.mesh.parent) continue;
      part.mesh.position.set(0, 0, 0);
      part.mesh.visible = true;
      setOpacity(part.mesh, STANDARD_GHOST_OPACITY);
      paint(part, makeStyle(nObj));
    }
  }

  /** Recompute every layer's visibility, opacity and per-object style from the store. Unchanged layers are not repainted. */
  applyMode(s: State) {
    const M = this.M;
    if (!M) return;
    const t0 = performance.now();
    const nObj = M.objects.length;
    // emphasis is selection only: hovering never changes what the room looks like
    const wanted = s.selected !== null && s.mode.kind === "normal" ? UNFOCUSED_DIM : 1;
    if (wanted !== this.dimTarget) {
      this.dimFrom = this.dimValue;
      this.dimTarget = wanted;
      this.dimT0 = performance.now();
    }
    if (s.selected !== null && s.mode.kind === "normal") this.focusId = s.selected;
    else if (this.dimValue >= 1) this.focusId = null; // the ramp is back: the part can go
    for (const L of this.layers) {
      if (!L) continue;
      L.mesh.recolor.setScalar(1); // only the head layer carries the dim, set below
      L.mesh.visible = false;
      if (L.objects) L.objects.mesh.visible = false;
      for (const part of L.parts.values()) part.mesh.visible = false;
    }
    for (const c of this.copies.values()) c.mesh.visible = false;

    if (s.mode.kind === "compare") {
      // the later state as it is, its additions tinted; the earlier state lends its objects: what left tinted,
      // what moved faded under the arrow to where it went, everything else hidden
      const { a: ca, b: cb } = s.mode;
      const A = this.layers[ca];
      const B = this.layers[cb];
      if (!A || !B) return;
      const d = diff(M.objects, ca, cb);
      const sb: Style = makeStyle(nObj);
      const sa: Style = makeStyle(nObj);
      for (let o = 0; o <= nObj; o++) {
        if (d.added.has(o - 1)) setColor(sb, o, ADD, 1);
        else if (d.movedTo.has(o - 1)) setDim(sb, o, 1);
        else setDim(sb, o, UNFOCUSED_DIM); // the unchanged recede at once; a diff has no ramp
        if (d.movedFrom.has(o - 1)) setFade(sa, o, 0.9, OLD_PLACE_ALPHA);
        else if (d.removed.has(o - 1)) setColor(sa, o, REM, REMOVED_ALPHA);
        else setHidden(sa, o);
      }
      B.mesh.visible = true;
      setOpacity(B.mesh, 1);
      paint(B, sb);
      if (A.objects) {
        A.objects.mesh.visible = true;
        setOpacity(A.objects.mesh, 1);
        paint(A.objects, sa);
      }
      this.pruneCopies(new Set());
    } else if (s.mode.kind === "draft") {
      // the empty floor, and on it every placement drawn from its own splats; the standard's ghosts as a guide if asked
      const L0 = this.layers[0];
      if (L0) {
        L0.mesh.visible = true;
        setOpacity(L0.mesh, 1);
        paint(L0, makeStyle(nObj));
      }
      const live = new Set<number>();
      const d = s.draft;
      if (d) {
        const place = (p: Placed, opacity: number) => {
          const c = this.copy(p.key, p.id);
          if (!c || !c.mesh.parent) return;
          const o = centre(M.objects[p.id]);
          c.mesh.position.set(p.x - o.x, 0, p.z - o.z);
          c.mesh.visible = true;
          setOpacity(c.mesh, opacity);
          paint(c, makeStyle(nObj));
        };
        for (const p of d.placements) {
          live.add(p.key);
          place(p, 1);
        }
        if (d.inHand) {
          live.add(d.inHand.key);
          if (d.inHand.at) place(d.inHand, IN_HAND_OPACITY);
        }
      }
      this.pruneCopies(live);
      if (s.ghosts && s.standard !== null) {
        const std = s.standard;
        this.standardGhosts(
          M.objects.filter((o) => o.present.includes(std)).map((o) => o.id),
          std,
          nObj,
        );
      }
    } else {
      const L = this.layers[s.head];
      if (L) {
        L.mesh.visible = true;
        setOpacity(L.mesh, 1);
        L.mesh.recolor.setScalar(this.dimValue); // the whole capture recedes as one uniform: no repaint
        paint(L, makeStyle(nObj));
      }
      // the thing in focus, at full colour over the dimmed capture, from its own splats
      if (this.focusId !== null && M.objects[this.focusId].present.includes(s.head)) {
        const part = this.part(s.head, this.focusId);
        if (part && part.mesh.parent) {
          part.mesh.position.set(0, 0, 0);
          part.mesh.visible = true;
          setOpacity(part.mesh, 1);
          paint(part, makeStyle(nObj));
        }
      }
      // compare to standard: a drifted or missing thing where the standard put it, from the standard's own capture
      if (s.ghosts && s.standard !== null && s.head !== s.standard) {
        const ids = drift(M.objects, s.standard, s.head).lines.flatMap((l) => (l.k === "move" || l.k === "add" ? [l.stdId] : []));
        this.standardGhosts(ids, s.standard, nObj);
      }
      this.pruneCopies(new Set());
    }
    this.touch();
    this.timings.lastModeMs = Math.round(performance.now() - t0);
  }

  /** One object as its own mesh, from the commit it was captured in. Built on first use; shows once Spark has it. */
  private part(commit: number, id: number): Paintable | null {
    const L = this.layers[commit];
    if (!L) return null;
    const have = L.parts.get(id);
    if (have) return have;
    const built = buildObject(L, id);
    if (!built) return null;
    L.parts.set(id, built);
    void built.mesh.initialized.then(() => {
      if (this.disposed) return;
      this.scene.add(built.mesh);
      this.applyMode(useStore.getState());
      this.touch();
    });
    return built;
  }

  /** A draft placement's own mesh, by key: one object extracted again for every copy. Built on first use. */
  private copy(key: number, id: number): Paintable | null {
    const have = this.copies.get(key);
    if (have) return have;
    const M = this.M!;
    const L = this.layers[M.objects[id].present[0]];
    if (!L) return null;
    const built = buildObject(L, id);
    if (!built) return null;
    this.copies.set(key, built);
    void built.mesh.initialized.then(() => {
      if (this.disposed) return;
      if (this.copies.get(key) !== built) {
        built.rgba.dispose();
        built.mesh.dispose();
        return;
      }
      this.scene.add(built.mesh);
      this.applyMode(useStore.getState());
      this.touch();
    });
    return built;
  }

  /** Drop the meshes of placements that are gone. */
  private pruneCopies(live: Set<number>) {
    for (const [key, c] of this.copies) {
      if (live.has(key)) continue;
      this.copies.delete(key);
      if (!c.mesh.parent) continue; // still initialising: the callback disposes it
      this.scene.remove(c.mesh);
      c.rgba.dispose();
      c.mesh.dispose();
    }
  }

  /** Where the pointer meets the floor, clamped inside the room. */
  private floorAt(ev: { clientX: number; clientY: number }): THREE.Vector3 | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.floorRay.setFromCamera(this.ndc, this.camera);
    if (!this.floorRay.ray.intersectPlane(this.floor, this.floorHit)) return null;
    if (this.bounds) this.floorHit.clamp(this.bounds.min, this.bounds.max);
    return this.floorHit;
  }

  /** What is under the pointer: whichever bracket the overlay drew there. What you see is what you can click. */
  pick(ev: { clientX: number; clientY: number }): BoxItem | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    return this.overlay.hitTest(ev.clientX - r.left, ev.clientY - r.top);
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
    this.gestures.record("frame", this.M?.objects[id]?.name ?? `obj ${id}`);
  }

  /** Put the camera on this floor point at standing height, facing the room's centre, and log it. */
  goFromMap(x: number, z: number) {
    const c = this.roomCentre;
    const pos = new THREE.Vector3(x, this.eyeY, z);
    if (this.bounds) pos.clamp(this.bounds.min, this.bounds.max);
    // standing on the centre itself: keep the current heading rather than look at your own feet
    const target = c.clone();
    if (Math.hypot(pos.x - c.x, pos.z - c.z) < 0.3) {
      this.camera.getWorldDirection(this.dirTmp);
      target.set(pos.x + this.dirTmp.x * 2, c.y, pos.z + this.dirTmp.z * 2);
    }
    const cam: Cam = { pos: [pos.x, pos.y, pos.z], target: [target.x, target.y, target.z] };
    this.gestures.flushDolly();
    const st = useStore.getState();
    st.setCamera(cam);
    st.log("move", `from the map · ${x.toFixed(1)}, ${z.toFixed(1)} m`, { cam });
    this.tweenTo(cam, 500);
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
    this.clampToRoom();
    this.renderer.render(this.scene, this.camera);
    this.drawChrome();
  }

  /** The 2D layers above the splats: the detection overlay and the minimap, from one pass over the mode. */
  private drawChrome() {
    const items = this.boxItems(useStore.getState());
    this.overlay.draw(this.camera, items, this.pickR);
    this.minimap.draw(this.camera, this.controls.target, items);
  }

  /**
   * What the detection overlay should box, in the design's language: every thing in the state by name; in a
   * diff what was added, removed and moved with an arrow to where it was; against the standard what matches,
   * what drifted with an arrow to where it belongs, and the standard's ghosts; in a draft what has been put down.
   */
  private boxItems(s: State): BoxItem[] {
    const M = this.M;
    if (!M) return [];
    const items: BoxItem[] = [];
    const name = (o: number) => M.objects[o].name;
    const yOf = (o: number) => (M.objects[o].bbox[0][1] + M.objects[o].bbox[1][1]) / 2;
    const mid = (o: number) => {
      const c = centre(M.objects[o]);
      return new THREE.Vector3(c.x, yOf(o), c.z);
    };
    const lit = (o: number) => o === s.selected || o === s.hover;
    // the bracket hugs the object's splats in the commit it is drawn from; the box stands in until that commit loads
    const push = (it: Partial<BoxItem> & { id: number; label: string; tone: Tone }, commit: number) =>
      items.push({ box: this.boxes[it.id], pts: this.layers[commit]?.pts[it.id + 1], emphasis: false, ...it });

    if (s.mode.kind === "compare") {
      const { a, b } = s.mode;
      const label = (c: Change) => ({ same: `= ${c.name}`, moved: `Δ ${c.name}`, added: `+ ${c.name}`, removed: `− ${c.name}` })[c.k];
      for (const c of diff(M.objects, a, b).changes) {
        if (c.k === "moved") {
          push({ id: c.id, label: label(c), tone: "neutral", emphasis: lit(c.id), link: mid(c.from), linkLabel: metres(c.metres) }, b);
          push({ id: c.from, label: monthOf(M.commits[a].captured), tone: "ghost", dashed: true, faint: true, pickable: false }, a);
        } else if (c.k === "added") push({ id: c.id, label: label(c), tone: "add", emphasis: lit(c.id) }, b);
        else if (c.k === "removed") push({ id: c.id, label: label(c), tone: "rem", dashed: true, emphasis: lit(c.id) }, a);
        else push({ id: c.id, label: label(c), tone: "neutral", faint: true, emphasis: lit(c.id) }, b);
      }
      return items;
    }
    if (s.mode.kind === "draft") {
      const d = s.draft;
      if (d) {
        const counts = new Map<number, number>();
        for (const p of d.placements) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
        const seen = new Map<number, number>();
        const shiftOf = (p: Placed) => {
          const c = centre(M.objects[p.id]);
          return new THREE.Vector3(p.x - c.x, 0, p.z - c.z);
        };
        for (const p of d.placements) {
          const n = (seen.get(p.id) ?? 0) + 1;
          seen.set(p.id, n);
          const label = (counts.get(p.id) ?? 1) > 1 ? `${name(p.id)} ${n}` : name(p.id);
          push({ id: p.id, key: p.key, label, tone: "neutral", emphasis: s.hover === p.id, shift: shiftOf(p) }, M.objects[p.id].present[0]);
        }
        if (d.inHand?.at) {
          const p = d.inHand;
          push(
            { id: p.id, key: p.key, label: `${name(p.id)} · in hand`, tone: "neutral", emphasis: true, pickable: false, shift: shiftOf(p) },
            M.objects[p.id].present[0],
          );
        }
      }
      if (s.ghosts && s.standard !== null) {
        for (const ob of M.objects)
          if (ob.present.includes(s.standard)) push({ id: ob.id, label: name(ob.id), tone: "std", dashed: true, pickable: false }, s.standard);
      }
      return items;
    }
    // a state: everything in it; against the standard, marked by how it stands
    const std = s.standard;
    const D = s.ghosts && std !== null && s.head !== std ? drift(M.objects, std, s.head) : null;
    if (!D || std === null) {
      for (const ob of M.objects)
        if (ob.present.includes(s.head)) push({ id: ob.id, label: name(ob.id), tone: "neutral", emphasis: lit(ob.id) }, s.head);
      return items;
    }
    for (const l of D.lines) {
      if (l.k === "keep") push({ id: l.id, label: `= ${name(l.id)}`, tone: "std", emphasis: lit(l.id) }, s.head);
      else if (l.k === "remove") push({ id: l.id, label: `− ${name(l.id)}`, tone: "neutral", emphasis: lit(l.id) }, s.head);
      else if (l.k === "move") {
        const link = new THREE.Vector3(l.from.x, yOf(l.stdId), l.from.z);
        push(
          { id: l.id, label: `Δ ${name(l.id)}`, tone: "neutral", emphasis: lit(l.id), link, linkLabel: metres(l.metres), linkTone: "std" },
          s.head,
        );
        push({ id: l.stdId, label: name(l.stdId), tone: "std", dashed: true, pickable: false }, std);
      } else push({ id: l.stdId, label: `+ ${name(l.stdId)}`, tone: "std", dashed: true, pickable: false }, std);
    }
    return items;
  }

  private loop = () => {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
    this.lastTick = performance.now();
    if (this.paused || useStore.getState().page === "title") return;
    const tweening = this.stepTween();
    if (this.dimValue !== this.dimTarget) {
      // step the dim ramp on the uniform; when it lands back at 1 the focused part is released
      const u = Math.min(1, Math.max(0, performance.now() - this.dimT0 - DIM_DELAY_MS) / DIM_MS);
      const e = 1 - Math.pow(1 - u, 3);
      this.dimValue = u >= 1 ? this.dimTarget : this.dimFrom + (this.dimTarget - this.dimFrom) * e;
      const L = this.layers[useStore.getState().head];
      if (L) L.mesh.recolor.setScalar(this.dimValue);
      if (u >= 1 && this.dimTarget === 1) this.applyMode(useStore.getState());
      this.touch();
    }
    const moved = this.controls.update();
    this.clampToRoom();
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
    const st = useStore.getState();
    if (st.mode.kind === "draft" && st.draft?.inHand) {
      const at = this.floorAt(ev);
      if (at) st.moveInHand(at.x, at.z);
      return;
    }
    if (this.dragging) return; // no hover churn mid-gesture
    const hit = this.pick(ev);
    this.renderer.domElement.style.cursor = hit === null ? "" : "pointer";
    st.setHover(hit?.id ?? null);
  };
  private onPointerDown = () => {
    this.downAt = performance.now();
    this.dragging = true;
    this.cancelTween();
    this.gestures.flushDolly(); // a click or drag after zooming closes the zoom entry first
  };
  private onPointerUp = (ev: PointerEvent) => {
    this.dragging = false;
    if (performance.now() - this.downAt >= CLICK_MS) return;
    const st = useStore.getState();
    st.closeSites();
    if (st.mode.kind === "draft") {
      if (st.draft?.inHand) {
        const at = this.floorAt(ev); // where the click landed, in case the pointer never moved on the way
        if (at) st.placeAt(at.x, at.z);
        return;
      }
      const hit = this.pick(ev);
      if (hit?.key !== undefined) st.pickUpPlaced(hit.key); // a placed thing is picked up again
      return;
    }
    const hit = this.pick(ev);
    st.select(hit?.id ?? null); // the selected thing again lets it go; the floor deselects
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
    this.loader?.abort();
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
    this.clear();
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
