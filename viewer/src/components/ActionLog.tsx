import { useEffect, useRef, useState } from "react";
import { useStore, type Action } from "../store";

const ROW = 18, KEEP = 6, EXIT_MS = 520;
const clock = (ms: number) => { const s = ms / 1000; const m = Math.floor(s / 60); return `${String(m).padStart(2, "0")}:${(s - m * 60).toFixed(3).padStart(6, "0")}`; };

type Row = Action & { exiting?: boolean; fresh?: boolean };

/**
 * Newest action enters at the top; older rows slide down and dim; rows past KEEP sink and dissolve.
 * Rows are absolutely positioned and moved with transforms so every reorder is a single composited transition.
 */
export function ActionLog() {
  const actions = useStore(s => s.actions);
  const [rows, setRows] = useState<Row[]>([]);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    setRows(prev => {
      const live = actions.slice(0, KEEP); const liveIds = new Set(live.map(a => a.id)); const prevIds = new Set(prev.map(r => r.id));
      const dropped = prev.filter(r => !liveIds.has(r.id) && !r.exiting).map(r => ({ ...r, exiting: true }));
      const next: Row[] = [...live.map(a => (prevIds.has(a.id) ? a : { ...a, fresh: true })), ...dropped, ...prev.filter(r => r.exiting && !liveIds.has(r.id))];
      for (const r of dropped) timers.current.push(window.setTimeout(() => setRows(rs => rs.filter(x => x.id !== r.id)), EXIT_MS));
      return next;
    });
    // clear the "fresh" flag after one paint so the enter transition plays (timeout, not rAF: rAF stalls in background tabs)
    const id = window.setTimeout(() => setRows(rs => rs.map(r => (r.fresh ? { ...r, fresh: false } : r))), 24);
    return () => clearTimeout(id);
  }, [actions]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const order = new Map(actions.map((a, i) => [a.id, i])); const restore = useStore(s => s.restore);
  return (
    <div id="actions" aria-live="polite">
      {rows.map(r => {
        const i = r.exiting ? KEEP : (order.get(r.id) ?? KEEP);
        const y = r.fresh ? -ROW * 0.6 : i * ROW;
        const style: React.CSSProperties = {
          transform: `translate3d(0, ${y}px, 0)`,
          opacity: r.fresh || r.exiting ? 0 : Math.max(0.16, 1 - i * 0.17),
          filter: r.fresh || r.exiting ? "blur(2px)" : "blur(0)",
          transition: r.fresh ? "none" : `transform 480ms cubic-bezier(.22,1,.36,1), opacity ${r.exiting ? EXIT_MS : 420}ms ease-out, filter 420ms ease-out`,
        };
        return (
          <div key={r.id} className={`row${i === 0 && !r.exiting ? " head" : ""}`} style={style}
            onClick={() => !r.exiting && i !== 0 && restore(r.id)} title={i === 0 ? undefined : "restore this state"}>
            <span className="seq">{String(r.id).padStart(3, "0")}</span>
            <span className="t">{clock(r.t)}</span>
            <span className="verb">{r.verb}</span>
            <span className="detail">{r.detail}</span>
          </div>
        );
      })}
    </div>
  );
}
