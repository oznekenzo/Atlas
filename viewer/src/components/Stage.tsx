import { useEffect, useRef } from "react";
import { Stage as Engine } from "../engine/stage";
import { useStore } from "../store";
import type { Manifest } from "../types";
import { attentionLevel } from "../attention";
import { draftDirty, type SavedDraft } from "../drafts";

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
  saveDraft: () => void;
  openDraft: (id: number) => boolean;
  deleteDraft: (id: number) => void;
  dirty: () => boolean;
  readonly drafts: SavedDraft[];
  select: (id: number | null) => void;
  loaded: () => number;
  pause: (p: boolean) => void;
  lookAt: (id: number, d?: number, h?: number) => void;
  setCam: (x: number, y: number, z: number) => void;
  mapGo: (x: number, z: number) => void;
  debug: () => unknown;
  stats: () => unknown;
  engine: Engine;
  grab: () => string;
  mem: () => number | undefined;
  hud: () => string;
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
        saveDraft: () => s().saveDraft(),
        openDraft: (id) => s().openDraft(id),
        deleteDraft: (id) => s().deleteDraft(id),
        dirty: () => {
          const st = s();
          return st.mode.kind === "draft" && st.draft ? draftDirty(st.draft, st.drafts, st.manifest) : false;
        },
        get drafts() {
          return s().drafts;
        },
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
        mapGo: (x, z) => engine.goFromMap(x, z),
        debug: () => engine.debug(),
        stats: () => engine.stats(),
        engine,
        grab: () => engine.grab(),
        mem: () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize,
        hud: () => attentionLevel(),
      };
    }
    return () => {
      engine.dispose();
      delete window.__patina;
    };
  }, []);
  return <div id="stage" ref={ref} />;
}
