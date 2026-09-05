import { useEffect, useRef } from "react";
import { Stage as Engine } from "../engine/stage";
import { useStore } from "../store";
import type { Manifest } from "../types";

/** Test/debug surface, the shape the headless harness drives. Exposed only in dev or with ?debug. */
export type DebugApi = {
  readonly S: ReturnType<typeof useStore.getState>;
  readonly M: Manifest | null;
  timings: Record<string, number>;
  go: (i: number) => boolean;
  compare: () => void;
  ghosts: () => void;
  draft: () => void;
  place: (id: number, x: number, z: number) => void;
  measure: () => void;
  leaveDraft: () => void;
  select: (id: number | null) => void;
  loaded: () => number;
  pause: (p: boolean) => void;
  lookAt: (id: number, d?: number, h?: number) => void;
  setCam: (x: number, y: number, z: number) => void;
  debug: () => unknown;
  stats: () => unknown;
  engine: Engine;
  grab: () => string;
  mem: () => number | undefined;
};
declare global {
  interface Window {
    __patina?: DebugApi;
  }
}

const debugEnabled = () => import.meta.env.DEV || new URLSearchParams(location.search).has("debug");

export function Stage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const engine = new Engine(ref.current!);
    void engine.boot();
    if (debugEnabled()) {
      const s = () => useStore.getState();
      window.__patina = {
        get S() {
          return s();
        },
        get M() {
          return s().manifest;
        },
        timings: engine.timings,
        go: (i) => s().go(i),
        compare: () => s().toggleCompare(),
        ghosts: () => s().toggleGhosts(),
        draft: () => s().enterDraft(),
        place: (id, x, z) => {
          s().pickFromTray(id);
          s().placeAt(x, z);
        },
        measure: () => s().measure(),
        leaveDraft: () => s().leaveDraft(),
        select: (id) => s().select(id),
        loaded: () => s().loaded.filter(Boolean).length,
        pause: (p) => {
          engine.paused = p;
          if (p) {
            engine.renderOnce();
            engine.renderOnce();
          }
        },
        lookAt: (id, d, h) => engine.lookAt(id, d, h),
        setCam: (x, y, z) => engine.setCam(x, y, z),
        debug: () => engine.debug(),
        stats: () => engine.stats(),
        engine,
        grab: () => engine.grab(),
        mem: () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize,
      };
    }
    return () => {
      engine.dispose();
      delete window.__patina;
    };
  }, []);
  return <div id="stage" ref={ref} />;
}
