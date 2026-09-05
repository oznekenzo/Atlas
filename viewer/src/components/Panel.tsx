import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { diff, drift, metres, things } from "../scene";
import { monthOf } from "../time";
import type { Manifest } from "../types";

const CLOSED = 51; // the kicker alone
const HOLD_MS = 560; // the cell keeps its content while it collapses

type Live = { k: "compare"; a: number; b: number } | { k: "std"; head: number; standard: number } | { k: "draft" };

/** Right column, second cell: what the mode calls for. The diff, the comparison to the standard, or the draft. */
export function Panel() {
  const { M, mode, head, standard, ghosts, draft } = useStore(
    useShallow((s) => ({ M: s.manifest, mode: s.mode, head: s.head, standard: s.standard, ghosts: s.ghosts, draft: s.draft })),
  );
  const live: Live | null =
    mode.kind === "draft" && draft
      ? { k: "draft" }
      : mode.kind === "compare"
        ? { k: "compare", a: mode.a, b: mode.b }
        : ghosts && standard !== null && head !== standard
          ? { k: "std", head, standard }
          : null;
  const [shown, setShown] = useState<Live | null>(live);
  const [h, setH] = useState(CLOSED);
  const body = useRef<HTMLDivElement>(null);
  const liveKey = live ? JSON.stringify(live) : "";
  useEffect(() => {
    if (live) {
      setShown(live);
      return;
    }
    const id = window.setTimeout(() => setShown(null), HOLD_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey]);
  useLayoutEffect(() => {
    if (!live) {
      setH(CLOSED);
      return;
    }
    const el = body.current;
    if (!el) return;
    // the body scrolls, so its scroll height is the content's height: the kicker, the gap, the content, the padding
    const measure = () => setH(18 + 6 + Math.round(el.scrollHeight) + 33);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey, shown, draft]);
  const kicker =
    shown?.k === "compare"
      ? "LAYOUT · DIFF"
      : shown?.k === "std"
        ? "LAYOUT · COMPARE TO STANDARD"
        : shown?.k === "draft"
          ? "LAYOUT · DRAFT"
          : "LAYOUT · NONE ACTIVE";
  return (
    <div id="panel" className={live ? "on" : ""} style={{ flexBasis: h }}>
      <div className="inner">
        <div className="kicker">{kicker}</div>
        {M && shown && (
          <div className="body" ref={body}>
            {shown.k === "compare" && <ComparePanel M={M} a={shown.a} b={shown.b} />}
            {shown.k === "std" && <StandardPanel M={M} head={shown.head} standard={shown.standard} />}
            {shown.k === "draft" && draft && <DraftPanel M={M} />}
          </div>
        )}
      </div>
    </div>
  );
}

const Entry = ({ doc, by }: { doc: string | null; by: string | null }) => (
  <div className="entry">
    <div className="kicker">DOCS</div>
    {doc ? (
      <>
        <div className="text">{doc}</div>
        <div className="by">{by}</div>
      </>
    ) : (
      <div className="none">No entry.</div>
    )}
  </div>
);

/** The diff, grouped as the design groups it: unchanged, moved with the distance, removed, added. */
function ComparePanel({ M, a, b }: { M: Manifest; a: number; b: number }) {
  const groups = useMemo(() => {
    const d = diff(M.objects, a, b);
    const of = (k: "same" | "moved" | "removed" | "added") =>
      d.changes.filter((c) => c.k === k).map((c) => ({ name: c.name, value: c.k === "moved" ? metres(c.metres) : "" }));
    return [
      { sign: "=", title: "UNCHANGED", cls: "un", lines: of("same") },
      { sign: "Δ", title: "MOVED", cls: "mv", lines: of("moved") },
      { sign: "−", title: "REMOVED", cls: "rm", lines: of("removed") },
      { sign: "+", title: "ADDED", cls: "ad", lines: of("added") },
    ];
  }, [M, a, b]);
  const e = M.diffs[`${a}-${b}`] ?? { doc: null, by: null };
  return (
    <>
      <div className="top">
        <div className="sub">A real change, earlier → later.</div>
        <div className="title">
          {monthOf(M.commits[a].captured)} → {monthOf(M.commits[b].captured)}
        </div>
      </div>
      <div className="groups">
        {groups.map((g) => (
          <div key={g.title} className={`group ${g.cls}`}>
            <div className="ghead">
              <span className="sign">{g.sign}</span>
              <span className="gtitle">{g.title}</span>
              <span className="count">{g.lines.length}</span>
            </div>
            {g.lines.map((l) => (
              <div key={l.name + l.value} className="line">
                <span className="name">{l.name}</span>
                <span className="value">{l.value}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <Entry doc={e.doc} by={e.by} />
    </>
  );
}

/** What this state must do to match the standard. */
function StandardPanel({ M, head, standard }: { M: Manifest; head: number; standard: number }) {
  const lines = useMemo(() => {
    const d = drift(M.objects, standard, head);
    const out = d.lines.map((l) =>
      l.k === "keep"
        ? { sign: "=", name: l.name, value: "keep", keep: true }
        : l.k === "move"
          ? { sign: "Δ", name: l.name, value: `must move ${metres(l.metres)}`, keep: false }
          : l.k === "remove"
            ? { sign: "−", name: l.name, value: "must remove", keep: false }
            : { sign: "+", name: l.name, value: "must add", keep: false },
    );
    return out.length ? out : [{ sign: "", name: "On standard", value: "", keep: true }];
  }, [M, head, standard]);
  return (
    <>
      <div className="top">
        <div className="sub">A theoretical comparison: what this state must do to match the standard.</div>
        <div className="title">
          {monthOf(M.commits[head].captured)} → <span className="std">{monthOf(M.commits[standard].captured)}</span>
        </div>
      </div>
      <div className="stdlines">
        {lines.map((l, i) => (
          <div key={i} className={`line${l.keep ? " keep" : ""}`}>
            <span className="sign">{l.sign}</span>
            <span className="name">{l.name}</span>
            <span className="value">{l.value}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/** The draft: where it starts from, the tray of every thing, what has been put down. */
function DraftPanel({ M }: { M: Manifest }) {
  const { draft, head, standard, setBase, pick } = useStore(
    useShallow((s) => ({ draft: s.draft!, head: s.head, standard: s.standard, setBase: s.setDraftBase, pick: s.pickFromTray })),
  );
  const [open, setOpen] = useState(false);
  const tray = useMemo(() => things(M.objects), [M]);
  const placed = draft.placements.length;
  const baseMonth = monthOf(M.commits[draft.base ?? head].captured);
  const counts = new Map<number, number>();
  for (const p of draft.placements) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  const hint = draft.inHand
    ? "Click the floor to put it down."
    : placed
      ? "Click a placed thing to pick it up."
      : "Pick a thing, then click the floor.";
  return (
    <>
      <div className="top">
        <div className="title">{placed ? `${placed} placed` : "Draft a layout"}</div>
      </div>
      <div className="seg">
        <div
          className={`opt${draft.base === null ? " on" : ""}`}
          onClick={() => {
            setOpen(false);
            setBase(null);
          }}
        >
          From scratch
        </div>
        <div className={`opt state${draft.base !== null ? " on" : ""}`} onClick={() => setOpen((o) => !o)}>
          From state <span className="mono">{baseMonth}</span>
          <span className="caret">▾</span>
        </div>
        {open && (
          <div className="pick">
            {M.commits.map((c) => (
              <div
                key={c.id}
                className={`row${draft.base === c.index ? " cur" : ""}`}
                onClick={() => {
                  setOpen(false);
                  setBase(c.index);
                }}
              >
                <span>{monthOf(c.captured)}</span>
                <span className="tag">{c.index === standard ? "standard" : ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="tray">
        {tray.map((t) => {
          const n = t.ids.reduce((s, i) => s + (counts.get(i) ?? 0), 0);
          const hand = draft.inHand !== null && t.ids.includes(draft.inHand.id);
          return (
            <div key={t.root} className={["row", hand ? "hand" : "", n ? "placed" : ""].join(" ").trim()} onClick={() => pick(t.root)}>
              <span>{t.name}</span>
              <span className="state">{hand ? "in hand" : `× ${n}`}</span>
            </div>
          );
        })}
      </div>
      <div className="hint">{hint}</div>
      {draft.attempts.length > 0 && (
        <div className="attempts">
          {draft.attempts.map((a) => (
            <div key={a.n} className="row">
              <span>Attempt {a.n}</span>
              <span className="text">{a.text}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
