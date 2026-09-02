import { useEffect, useRef } from "react";
import { Stage as Engine } from "../engine/stage";
import { useStore } from "../store";
import { run as runGit } from "../git";
import { makeActions } from "../actions";

export function Stage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const engine = new Engine(ref.current!);
    engine.boot();
    // test / debug surface, same shape the headless harness drives
    (window as any).__patina = {
      get S() { return useStore.getState(); }, get M() { return useStore.getState().manifest; }, timings: engine.timings,
      checkout: (i: number) => useStore.getState().checkout(i), diff: (a: number, b: number) => useStore.getState().diff(a, b),
      onion: () => useStore.getState().toggleOnion(), select: (id: number | null) => useStore.getState().select(id),
      loaded: () => useStore.getState().loaded.filter(Boolean).length, git: (l: string) => runGit(l, makeActions()),
      pause: (p: boolean) => { engine.paused = p; if (p) { engine.renderOnce(); engine.renderOnce(); } },
      lookAt: (id: number, d?: number, h?: number) => engine.lookAt(id, d, h), setCam: (x: number, y: number, z: number) => engine.setCam(x, y, z),
      debug: () => engine.debug(), grab: () => engine.grab(), mem: () => (performance as any).memory?.usedJSHeapSize,
    };
    return () => { engine.dispose(); delete (window as any).__patina; };
  }, []);
  return <div id="stage" ref={ref} />;
}
