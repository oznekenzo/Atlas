import { useEffect, useRef } from "react";
import { Stage as Engine } from "../engine/stage";
import { useStore } from "../store";
import { run as runGit } from "../git";
import { makeActions } from "../actions";
import type { Manifest } from "../types";

/** Test/debug surface, the shape the headless harness drives. Exposed only in dev or with ?debug. */
export type DebugApi = {
  readonly S: ReturnType<typeof useStore.getState>;
  readonly M: Manifest | null;
  timings: Record<string, number>;
  checkout: (i: number) => boolean;
  diff: (a: number, b: number) => boolean;
  onion: () => void;
  select: (id: number | null) => void;
  loaded: () => number;
  git: (line: string) => unknown;
  pause: (p: boolean) => void;
  lookAt: (id: number, d?: number, h?: number) => void;
  setCam: (x: number, y: number, z: number) => void;
  debug: () => unknown;
  stats: () => unknown;
  engine: Engine;
  grab: () => string;
  mem: () => number | undefined;
  branch: (name: string, target: number) => boolean;
  place: (id: number, x: number, z: number) => void;
  drop: () => void;
  commit: (msg: string) => unknown;
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
        checkout: (i) => s().checkout(i),
        diff: (a, b) => s().diff(a, b),
        onion: () => s().toggleOnion(),
        select: (id) => s().select(id),
        loaded: () => s().loaded.filter(Boolean).length,
        git: (l) => runGit(l, makeActions()),
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
        branch: (name, target) => s().branch(name, target),
        place: (id, x, z) => {
          s().beginPlace(id);
          s().place(id, x, z);
        },
        drop: () => s().drop(),
        commit: (msg) => s().commitProposal(msg),
      };
    }
    return () => {
      engine.dispose();
      delete window.__patina;
    };
  }, []);
  return <div id="stage" ref={ref} />;
}
