import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type Action } from "../store";

const ROW = 18;
const KEEP = 6;
const EXIT_MS = 520;
const clock = (ms: number) => {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
};

type Row = Action & { exiting?: boolean; fresh?: boolean };

/**
 * Newest action enters at the top; older rows slide down and dim; rows past KEEP sink and dissolve.
 * Rows are absolutely positioned and moved with transforms so every reorder is a single composited transition.
 */
export function ActionLog() {
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
    // clear the "fresh" flag after one paint so the enter transition plays (timeout, not rAF: rAF stalls in background tabs)
    const id = window.setTimeout(() => setRows((rs) => rs.map((r) => (r.fresh ? { ...r, fresh: false } : r))), 24);
    return () => clearTimeout(id);
  }, [actions]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const order = new Map(actions.map((a, i) => [a.id, i]));
  return (
    <div id="actions" aria-live="polite">
      <div className="k head">history</div>
      {rows.map((r) => {
        const i = r.exiting ? KEEP : (order.get(r.id) ?? KEEP);
        const y = r.fresh ? -ROW * 0.6 : i * ROW;
        const style: React.CSSProperties = {
          transform: `translate3d(0, ${y}px, 0)`,
          opacity: r.fresh || r.exiting ? 0 : Math.max(0.16, 1 - i * 0.17),
          filter: r.fresh || r.exiting ? "blur(2px)" : "blur(0)",
          // the stylesheet's easing and durations, so the log moves like everything else
          transition: r.fresh
            ? "none"
            : `transform var(--t-slow) var(--ease), opacity ${r.exiting ? EXIT_MS : 420}ms var(--ease), filter var(--t-base) var(--ease)`,
        };
        const head = i === 0 && !r.exiting;
        return (
          <div
            key={r.id}
            className={`row${head ? " head" : ""}`}
            style={style}
            onClick={() => !r.exiting && !head && restore(r.id)}
            title={head ? undefined : "restore this state"}
          >
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
