import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { status as statusOf } from "../scene";
import { dateOf, monthOf, yearOf } from "../time";

/** The bottom band under the middle column: four timeline cells, a gap, and the state's three detail cells. */
export function BottomBand() {
  const { M, head, mode, standard, loaded, go, select, ask } = useStore(
    useShallow((s) => ({
      M: s.manifest,
      head: s.head,
      mode: s.mode,
      standard: s.standard,
      loaded: s.loaded,
      go: s.go,
      select: s.select,
      ask: s.askStandard,
    })),
  );
  if (!M) return null;
  const c = M.commits[head];
  const n = M.commits.length;
  const cmp = mode.kind === "compare" ? mode : null;
  const things = M.objects.filter((o) => o.present.includes(head));
  const status = statusOf(M.objects, head, standard);
  const canMakeStd = mode.kind === "normal" && head !== standard;
  return (
    <div id="bottom">
      <div id="timeline" data-tour="rail">
        {M.commits.map((m, i) => {
          const isStd = i === standard;
          const lit = i === head || (cmp !== null && (i === cmp.a || i === cmp.b));
          const off = standard !== null && i > standard;
          const tag = isStd ? "STANDARD" : off ? "OFF STANDARD" : `${i + 1} / ${n}`;
          const cls = ["cell", isStd ? "std" : "", off ? "off" : "", lit ? "lit" : "", loaded[i] ? "" : "pending"].join(" ").trim();
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
      </div>
      <div className="gap" />
      <div id="details">
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
        <div className="cell doc">
          <div className="k">DOCUMENTATION</div>
          {c.doc ? (
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
