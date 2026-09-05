import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type Action } from "../store";

const ROW = 18;
const KEEP = 7;
const EXIT_MS = 640;
const clock = (ms: number) => {
  const t = Math.floor(ms / 1000);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

type Row = Action & { exiting?: boolean; fresh?: boolean };

/** Bottom left: the map, and above it the actions taken, newest on top, each restorable. Hidden on narrow screens. */
export function MapAndActions() {
  const [show, setShow] = useState(innerWidth >= 1500);
  useEffect(() => {
    const on = () => setShow(innerWidth >= 1500);
    addEventListener("resize", on);
    return () => removeEventListener("resize", on);
  }, []);
  return (
    <div id="left" data-tour="left" className={show ? "" : "off"}>
      <div className="section">
        <div className="k">MAP</div>
        <div id="map-slot" className="frame" />
      </div>
      <Actions />
    </div>
  );
}

function Actions() {
  const history = useStore((s) => s.history);
  const restore = useStore((s) => s.restore);
  const actions = useMemo(() => history.slice(-KEEP).reverse(), [history]);
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
    <div className="section">
      <div className="k">ACTIONS</div>
      <div id="actions">
        {rows.map((r) => {
          const i = r.exiting ? KEEP : (order.get(r.id) ?? KEEP);
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
