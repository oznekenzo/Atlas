import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore, objectsChanged } from "../store";
import { centre } from "../attribution";
import { drift } from "../drift";
import { monthOf } from "../time";
import type { Manifest } from "../types";

/** Right side, one slot: what the mode calls for. The diff, the comparison to the standard, or the draft. */
export function Panel() {
  const { M, mode, head, standard, ghosts, draft } = useStore(
    useShallow((s) => ({ M: s.manifest, mode: s.mode, head: s.head, standard: s.standard, ghosts: s.ghosts, draft: s.draft })),
  );
  if (!M) return <div id="panel" />;
  const showDraft = mode.kind === "draft";
  const showCompare = !showDraft && mode.kind === "compare";
  const showStd = !showDraft && !showCompare && ghosts && standard !== null && head !== standard;
  const on = showDraft || showCompare || showStd;
  return (
    <>
      <div id="scrim-r" className={on ? "on" : ""} />
      <div id="panel" className={on ? "on" : ""}>
        <div className="inner">
          {showCompare && mode.kind === "compare" && <ComparePanel M={M} a={mode.a} b={mode.b} />}
          {showStd && standard !== null && <StandardPanel M={M} head={head} standard={standard} />}
          {showDraft && draft && <DraftPanel M={M} />}
        </div>
      </div>
    </>
  );
}

const Entry = ({ doc, by }: { doc: string | null; by: string | null }) => (
  <div className="entry">
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

function ComparePanel({ M, a, b }: { M: Manifest; a: number; b: number }) {
  const groups = useMemo(() => {
    const { added, removed } = objectsChanged(M, a, b);
    const movedNew = new Map<number, number>(); // new id → old id
    for (const o of M.objects) if (removed.has(o.id) && o.moved_to !== null && added.has(o.moved_to)) movedNew.set(o.moved_to, o.id);
    const movedOld = new Set(movedNew.values());
    const dist = (p: number, q: number) => {
      const x = centre(M.objects[p]);
      const y = centre(M.objects[q]);
      return Math.hypot(x.x - y.x, x.z - y.z);
    };
    const un: { name: string; value: string }[] = [];
    const mv: { name: string; value: string }[] = [];
    const rm: { name: string; value: string }[] = [];
    const ad: { name: string; value: string }[] = [];
    for (const o of M.objects) {
      const old = movedNew.get(o.id);
      if (old !== undefined) mv.push({ name: o.name, value: `${dist(old, o.id).toFixed(1)} m` });
      else if (added.has(o.id)) ad.push({ name: o.name, value: "" });
      else if (movedOld.has(o.id)) continue;
      else if (removed.has(o.id)) rm.push({ name: o.name, value: "" });
      else if (o.present.includes(a) && o.present.includes(b)) un.push({ name: o.name, value: "" });
    }
    return [
      { sign: "=", title: "UNCHANGED", cls: "un", lines: un },
      { sign: "Δ", title: "MOVED", cls: "mv", lines: mv },
      { sign: "−", title: "REMOVED", cls: "rm", lines: rm },
      { sign: "+", title: "ADDED", cls: "ad", lines: ad },
    ];
  }, [M, a, b]);
  const e = M.diffs[`${a}-${b}`] ?? { doc: null, by: null };
  return (
    <>
      <div className="top">
        <div className="kicker">DIFF</div>
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

function StandardPanel({ M, head, standard }: { M: Manifest; head: number; standard: number }) {
  const lines = useMemo(() => {
    const d = drift(M.objects, standard, head);
    const off = new Set(d.lines.flatMap((l) => (l.k === "off" ? [l.id] : [])));
    const extra = new Set(d.lines.flatMap((l) => (l.k === "extra" ? [l.id] : [])));
    const out: { sign: string; name: string; value: string; keep?: boolean }[] = [];
    for (const o of M.objects)
      if (o.present.includes(head) && !off.has(o.id) && !extra.has(o.id)) out.push({ sign: "=", name: o.name, value: "keep", keep: true });
    for (const l of d.lines) if (l.k === "off") out.push({ sign: "Δ", name: M.objects[l.id].name, value: `must move ${l.metres.toFixed(1)} m` });
    for (const l of d.lines) if (l.k === "extra") out.push({ sign: "−", name: M.objects[l.id].name, value: "must remove" });
    for (const l of d.lines) if (l.k === "missing") out.push({ sign: "+", name: M.objects[l.stdId].name, value: "must add" });
    if (out.length === 0) out.push({ sign: "", name: "On standard", value: "", keep: true });
    return out;
  }, [M, head, standard]);
  return (
    <>
      <div className="top">
        <div className="kicker">COMPARE TO STANDARD</div>
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

function DraftPanel({ M }: { M: Manifest }) {
  const { draft, head, standard, setBase, pick } = useStore(
    useShallow((s) => ({ draft: s.draft!, head: s.head, standard: s.standard, setBase: s.setDraftBase, pick: s.pickFromTray })),
  );
  const [open, setOpen] = useState(false);
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
        <div className="kicker">DRAFT</div>
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
        {M.objects
          .filter((o) => o.moved_from === null) // one row per thing; its later ids are the same thing moved
          .map((o) => {
            const ids = [o.id];
            for (let n = o.moved_to; n !== null; n = M.objects[n].moved_to) ids.push(n);
            const n = ids.reduce((s, i) => s + (counts.get(i) ?? 0), 0);
            const hand = draft.inHand !== null && ids.includes(draft.inHand.id);
            return (
              <div key={o.id} className={["row", hand ? "hand" : "", n ? "placed" : ""].join(" ").trim()} onClick={() => pick(o.id)}>
                <span>{o.name}</span>
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
