import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type Action } from "../store";

const ROW = 18;
const EXIT_MS = 640;
const clock = (ms: number) => {
  const t = Math.floor(ms / 1000);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

type Row = Action & { exiting?: boolean; fresh?: boolean };

/** The left column under the checklist: the actions taken, newest on top, each restorable, as many as the cell holds. */
export function Actions() {
  const history = useStore((s) => s.history);
  const restore = useStore((s) => s.restore);
  const list = useRef<HTMLDivElement>(null);
  const [keep, setKeep] = useState(12);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const fit = () => setKeep(Math.max(1, Math.floor(el.getBoundingClientRect().height / ROW)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const actions = useMemo(() => history.slice(-keep).reverse(), [history, keep]);
  const [rows, setRows] = useState<Row[]>([]);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    setRows((prev) => {
      const liveIds = new Set(actions.map((a) => a.id));
      const prevIds = new Set(prev.map((r) => r.id));
      const dropped = prev.filter((r) => !liveIds.has(r.id) && !r.exiting).map((r) => ({ ...r, exiting: true }));
      const next: Row[] = [
        ...actions.map((a) => (prevIds.has(a.id) ? a : { ...a, fresh: true })),
        ...dropped,
        ...prev.filter((r) => r.exiting && !liveIds.has(r.id)),
      ];
      for (const r of dropped) timers.current.push(window.setTimeout(() => setRows((rs) => rs.filter((x) => x.id !== r.id)), EXIT_MS));
      return next;
    });
    const id = window.setTimeout(() => setRows((rs) => rs.map((r) => (r.fresh ? { ...r, fresh: false } : r))), 24);
    return () => clearTimeout(id);
  }, [actions]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const order = new Map(actions.map((a, i) => [a.id, i]));
  return (
    <div id="actions-cell" data-tour="actions">
      <div className="k">ACTIONS</div>
      <div id="actions" ref={list}>
        {rows.map((r) => {
          const i = r.exiting ? keep : (order.get(r.id) ?? keep);
          const y = r.fresh ? -ROW : i * ROW;
          const last = i === 0 && !r.exiting;
          return (
            <div
              key={r.id}
              className={`row${last ? " last" : ""}`}
              style={{ transform: `translate3d(0, ${y}px, 0)`, opacity: r.fresh || r.exiting ? 0 : 1, transition: r.fresh ? "none" : undefined }}
              onClick={() => !r.exiting && !last && restore(r.id)}
              title={last ? undefined : "restore this state"}
            >
              <span className="t">{clock(r.t)}</span>
              <span className="verb">{r.verb}</span>
              <span className="detail">{r.detail}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Bottom left: the map in its cell. The engine mounts its canvas into the frame. */
export function MapCell() {
  return (
    <div id="map-cell" data-tour="map">
      <div className="k">MAP</div>
      <div className="centre">
        <div id="map-slot" className="frame" />
      </div>
    </div>
  );
}
