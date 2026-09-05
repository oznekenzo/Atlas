import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { status as statusOf } from "../scene";
import { draftDirty, nameOf as draftName, placedByThing, savedOf } from "../drafts";
import { railColumns } from "../layout";
import { dateOf, monthOf, timeOf, yearOf } from "../time";

/**
 * The bottom band under the middle column: the timeline cells (the states, then every branch: a saved draft, and the
 * open one while it is unsaved), a gap, and three detail cells: the state's, or the branch's while a draft is open.
 */
export function BottomBand() {
  const { M, head, mode, standard, loaded, drafts, draftSeq, draftId, base, placements, attempts, dirty, go, select, ask, openDraft } = useStore(
    useShallow((s) => ({
      M: s.manifest,
      head: s.head,
      mode: s.mode,
      standard: s.standard,
      loaded: s.loaded,
      drafts: s.drafts,
      draftSeq: s.draftSeq,
      // scalars and the placements array, never the draft itself: the thing in hand replaces it on every pointer move
      draftId: s.draft?.id ?? null,
      base: s.draft?.base ?? null,
      placements: s.mode.kind === "draft" ? (s.draft?.placements ?? null) : null,
      attempts: s.draft?.attempts.length ?? 0,
      dirty: s.mode.kind === "draft" && s.draft ? draftDirty(s.draft, s.drafts, s.manifest) : false,
      go: s.go,
      select: s.select,
      ask: s.askStandard,
      openDraft: s.openDraft,
    })),
  );
  if (!M) return null;
  const c = M.commits[head];
  const n = M.commits.length;
  const cmp = mode.kind === "compare" ? mode : null;
  const inDraft = placements !== null;
  const things = M.objects.filter((o) => o.present.includes(head));
  const status = statusOf(M.objects, head, standard);
  const canMakeStd = mode.kind === "normal" && head !== standard;
  const name = draftName(draftId, drafts, draftSeq);
  const saved = savedOf(drafts, draftId);
  const fromOf = (b: number | null) => (b === null ? "SCRATCH" : `FROM ${monthOf(M.commits[b].captured).toUpperCase()}`);
  const cols = railColumns(n, drafts.length + (inDraft && draftId === null ? 1 : 0));
  const down = inDraft ? placedByThing(M.objects, placements) : [];
  return (
    <div id="bottom">
      <div id="timeline" data-tour="rail" style={{ gridTemplateColumns: cols.rail }}>
        {M.commits.map((m, i) => {
          const isStd = i === standard;
          const lit = !inDraft && (i === head || (cmp !== null && (i === cmp.a || i === cmp.b)));
          const off = standard !== null && i > standard;
          const tag = isStd ? "STANDARD" : off ? "OFF STANDARD" : `${i + 1} / ${n}`;
          const cls = ["cell", isStd ? "std" : "", off ? "off" : "", lit ? "lit" : "", loaded[i] ? "" : "pending", dirty ? "locked" : ""]
            .join(" ")
            .trim();
          return (
            <div key={m.id} className={cls} onClick={() => go(i)}>
              {i === head && canMakeStd && (
                <div
                  className="tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    ask();
                  }}
                >
                  MAKE THIS THE STANDARD
                </div>
              )}
              <span className="m">
                {monthOf(m.captured)} <span className="y">{yearOf(m.captured)}</span>
              </span>
              <span className="tag">{tag}</span>
            </div>
          );
        })}
        {drafts.map((d) => {
          const open = inDraft && draftId === d.id;
          const cls = ["cell", "branch", open ? "lit" : "", dirty && !open ? "locked" : ""].join(" ").trim();
          return (
            <div key={`branch-${d.id}`} className={cls} onClick={() => openDraft(d.id)}>
              <span className="m">{d.name}</span>
              <span className="tag">{open && dirty ? "BRANCH · UNSAVED" : `BRANCH · ${fromOf(d.base)}`}</span>
            </div>
          );
        })}
        {inDraft && draftId === null && (
          <div className="cell branch unsaved lit">
            <span className="m">{name}</span>
            <span className="tag">BRANCH · UNSAVED</span>
          </div>
        )}
      </div>
      <div className="gap" />
      <div id="details" style={{ gridTemplateColumns: cols.details }}>
        {inDraft ? (
          <div className="cell state">
            <div className="k">BRANCH</div>
            <div className="kv">
              <span>NAME</span>
              <span className="v">{name.toUpperCase()}</span>
              <span>FROM</span>
              <span className="v">{base === null ? "SCRATCH" : dateOf(M.commits[base].captured).toUpperCase()}</span>
              <span>PLACED</span>
              <span className="v">{placements.length}</span>
              <span>MEASURED</span>
              <span className="v">{attempts ? `${attempts} ×` : "—"}</span>
              <span>SAVED</span>
              <span className={`v${dirty ? " status off" : ""}`}>{saved ? (dirty ? "UNSAVED CHANGES" : timeOf(saved.savedAt)) : "NEVER"}</span>
            </div>
          </div>
        ) : (
          <div className="cell state">
            <div className="k">STATE</div>
            <div className="kv">
              <span>OUTPUT</span>
              <span className="v">{c.stats?.output ?? "—"}</span>
              <span>DATE</span>
              <span className="v">{dateOf(c.captured).toUpperCase()}</span>
              <span>SEQUENCE</span>
              <span className="v">
                {head + 1} / {n}
              </span>
              <span>STATUS</span>
              <span className={`v status ${status.cls}`}>{status.text.toUpperCase()}</span>
              <span>STOPPAGES</span>
              <span className="v">{c.stats?.stoppages ?? "—"}</span>
              <span>CHANGEOVER</span>
              <span className="v">{(c.stats?.changeover ?? "—").toUpperCase()}</span>
            </div>
          </div>
        )}
        {inDraft ? (
          <div className="cell things">
            <div className="k">IN THIS DRAFT · {placements.length}</div>
            <div className="names">
              {down.map((t) => (
                <span key={t.name}>
                  {t.name}
                  {t.n > 1 ? ` × ${t.n}` : ""}
                </span>
              ))}
              {down.length === 0 && <span className="none">Nothing placed.</span>}
            </div>
          </div>
        ) : (
          <div className="cell things">
            <div className="k">IN THIS STATE · {things.length}</div>
            <div className="names">
              {things.map((o) => (
                <span key={o.id} className="thing" onClick={() => select(o.id)}>
                  {o.name}
                </span>
              ))}
              {things.length === 0 && <span className="none">No objects.</span>}
            </div>
          </div>
        )}
        <div className="cell doc">
          <div className="k">DOCUMENTATION</div>
          {!inDraft && c.doc ? (
            <>
              <div className="text">{c.doc}</div>
              <div className="by">{c.by}</div>
            </>
          ) : (
            <div className="none">No entry.</div>
          )}
        </div>
      </div>
    </div>
  );
}
