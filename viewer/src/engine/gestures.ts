/**
 * Camera gesture recording. Every orbit/pan/dolly is logged on release, classified by the largest
 * motion in metres. A click (short, negligible motion) is not a camera action — it is a selection,
 * and the selection snapshot carries the camera. Wheel ticks arrive as separate gestures, so dolly
 * is coalesced: one row per zoom session, amended in place until another action intervenes.
 */
import type * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { useStore, type Cam } from "../store";

const CLICK_MS = 250;
const CLICK_SLOP_M = 0.05;
const MOTION_EPS_M = 0.01;
const DOLLY_SETTLE_MS = 800;

export class Gestures {
  private gesture: { pos: THREE.Vector3; target: THREE.Vector3; t0: number } | null = null;
  private pendingDolly: { d0: number; timer: number } | null = null;
  private dollyRun: { d0: number } | null = null;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private controls: OrbitControls,
  ) {
    controls.addEventListener("start", this.onStart);
    controls.addEventListener("end", this.onEnd);
  }

  snapshot(): Cam {
    const p = this.camera.position;
    const t = this.controls.target;
    return { pos: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
  }

  /** Log a camera action with the current pose. */
  record(verb: string, detail: string) {
    const cam = this.snapshot();
    const st = useStore.getState();
    st.setCamera(cam);
    st.log(verb, detail, { cam });
  }

  /** Close an open zoom session now (called before any other action so ordering stays causal). */
  flushDolly() {
    const pd = this.pendingDolly;
    if (!pd) return;
    clearTimeout(pd.timer);
    this.pendingDolly = null;
    const d1 = this.camera.position.distanceTo(this.controls.target);
    if (Math.abs(d1 - pd.d0) < MOTION_EPS_M) return;
    const st = useStore.getState();
    const last = st.history[st.history.length - 1];
    if (!(last?.verb === "dolly" && this.dollyRun)) this.dollyRun = { d0: pd.d0 };
    const cam = this.snapshot();
    st.setCamera(cam);
    st.amend("dolly", `${this.dollyRun.d0.toFixed(2)} → ${d1.toFixed(2)} m`, { cam });
  }

  dispose() {
    this.flushDolly();
    this.controls.removeEventListener("start", this.onStart);
    this.controls.removeEventListener("end", this.onEnd);
  }

  private onStart = () => {
    this.gesture = { pos: this.camera.position.clone(), target: this.controls.target.clone(), t0: performance.now() };
  };

  private onEnd = () => {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    const p = this.camera.position;
    const t = this.controls.target;
    const d0 = g.pos.distanceTo(g.target);
    const d1 = p.distanceTo(t);
    const mPan = t.distanceTo(g.target);
    const mDolly = Math.abs(d1 - d0);
    const ang = g.pos.clone().sub(g.target).angleTo(p.clone().sub(t));
    const mOrbit = ang * d0;
    const biggest = Math.max(mPan, mDolly, mOrbit);
    const click = performance.now() - g.t0 < CLICK_MS;
    if (biggest < (click ? CLICK_SLOP_M : MOTION_EPS_M)) return; // a click, or nothing moved
    const verb = biggest === mPan ? "pan" : biggest === mDolly ? "dolly" : "orbit";
    if (verb === "dolly") {
      if (!this.pendingDolly) this.pendingDolly = { d0, timer: 0 };
      clearTimeout(this.pendingDolly.timer);
      this.pendingDolly.timer = window.setTimeout(() => this.flushDolly(), DOLLY_SETTLE_MS);
      return;
    }
    this.flushDolly();
    const detail =
      verb === "pan"
        ? `→ ${t.x.toFixed(2)} ${t.y.toFixed(2)} ${t.z.toFixed(2)}`
        : `${((ang * 180) / Math.PI).toFixed(0)}°  ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}`;
    this.record(verb, detail);
  };
}
