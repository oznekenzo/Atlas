import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { drift } from "../drift";
import { dateOf, monthOf, yearOf } from "../time";

/** Bottom centre: the month. Its date, its details, what is in it, its entry, and the rail of months under it. */
export function MonthBlock() {
  const { M, head, mode, standard, loaded, go, select, makeStandard } = useStore(
    useShallow((s) => ({
      M: s.manifest,
      head: s.head,
      mode: s.mode,
      standard: s.standard,
      loaded: s.loaded,
      go: s.go,
      select: s.select,
      makeStandard: s.makeStandard,
    })),
  );
  if (!M) return null;
  const c = M.commits[head];
  const n = M.commits.length;
  const std = standard;
  const cmp = mode.kind === "compare" ? mode : null;
  const things = M.objects.filter((o) => o.present.includes(head));
  // status, as designed: the standard, off or on it after, before it before
  let status = { text: "Before standard", cls: "before" };
  if (std !== null) {
    if (head === std) status = { text: "Standard", cls: "std" };
    else if (head > std) {
      const d = drift(M.objects, std, head);
      status = d.off + d.missing > 0 ? { text: "Off standard", cls: "off" } : { text: "On standard", cls: "on" };
    }
  }
  const canMakeStd = mode.kind === "normal" && head !== std;
  const rangeA = cmp ? cmp.a : head;
  const rangeB = cmp ? cmp.b : head;
  const segClass = (i: number) => {
    if (cmp && i >= rangeA && i < rangeB) return "seg lit";
    if (std !== null && i >= std) return `seg drift k${i - std} of${Math.max(1, n - 1 - std)}${head === std && i === std ? " from-std" : ""}`;
    return "seg";
  };
  return (
    <div id="month">
      <div className="date-row">
        <div className="date">{dateOf(c.captured)}</div>
        <div className={`make${canMakeStd ? " on" : ""}`}>
          <div className="btn" onClick={makeStandard}>
            Make this the standard
          </div>
        </div>
      </div>
      <div className="grid">
        <div className="col details">
          <div className="k">DETAILS</div>
          <div className="kv">
            <div>Sequence</div>
            <div className="v">
              {head + 1} / {n}
            </div>
            <div>Status</div>
            <div className={`v status ${status.cls}`}>{status.text}</div>
            <div>Stoppages</div>
            <div className="v">{c.stats?.stoppages ?? "—"}</div>
            <div>Changeover</div>
            <div className="v">{c.stats?.changeover ?? "—"}</div>
            <div>Output</div>
            <div className="v">{c.stats?.output ?? "—"}</div>
          </div>
        </div>
        <div className="col things">
          <div className="k">IN THIS STATE</div>
          <div className="names">
            {things.map((o) => (
              <div key={o.id} className="thing" onClick={() => select(o.id)}>
                {o.name}
              </div>
            ))}
            {things.length === 0 && <div className="none">No objects.</div>}
          </div>
        </div>
        <div className="col doc">
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
      <div className="rail" data-tour="rail">
        {M.commits.map((m, i) => {
          const isHead = i === head;
          const isStd = i === std;
          const end = cmp !== null && (i === cmp.a || i === cmp.b);
          const lit = isHead || end;
          const off = std !== null && i > std;
          const cls = ["cap", isStd ? "std" : "", lit ? "lit" : "", off ? "off" : "", loaded[i] ? "" : "pending", isStd && isHead ? "here" : ""]
            .join(" ")
            .trim();
          return [
            <div key={m.id} className={cls} onClick={() => go(i)}>
              {monthOf(m.captured)}
              <div className="year">{yearOf(m.captured)}</div>
            </div>,
            i < n - 1 ? (
              <div key={`s${i}`} className={`${segClass(i)}${i === std ? " after-std" : ""}${i + 1 === std ? " before-std" : ""}`} />
            ) : null,
          ];
        })}
      </div>
    </div>
  );
}
