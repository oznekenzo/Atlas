import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { changeSummary } from "../identity";
import { diffLines } from "../attribution";
import { measure } from "../measure";

/** Diff summary, derived from the manifest — the engine paints, it does not report. */
export function Legend() {
  const { M, mode, proposal } = useStore(useShallow((s) => ({ M: s.manifest, mode: s.mode, proposal: s.proposal })));
  // measured here, not in the selector: a fresh object per read would never compare equal and React would spin
  const report = useMemo(
    () =>
      M && proposal && mode.kind === "proposal"
        ? measure(M.objects, proposal.base, proposal.target, proposal.placements, `c${proposal.target}`)
        : null,
    [M, proposal, mode],
  );
  if (M && mode.kind === "proposal" && proposal && report) {
    const t = M.commits[proposal.target];
    return (
      <div id="legend">
        <div className="k head">
          measured against c{proposal.target} {t.hash}
        </div>
        <div className="why">“{t.message}”</div>
        <div className="lines">
          {report.lines.map((l) => (
            <div key={`${l.k}${l.id}`} className={`l ${l.k}`}>
              {l.t}
            </div>
          ))}
        </div>
        <div className="stat">
          <span>
            {report.placed} of {report.ofN} placed
            {report.meanM !== null ? ` · mean ${report.meanM.toFixed(2)} m` : ""}
            {report.done ? " · restored" : ""}
          </span>
        </div>
      </div>
    );
  }
  return <DiffLegend />;
}

function DiffLegend() {
  const { M, mode } = useStore(useShallow((s) => ({ M: s.manifest, mode: s.mode })));
  const stats = useMemo(() => {
    if (!M || mode.kind !== "diff") return null;
    const { added, removed, moved } = changeSummary(M.objects, mode.a, mode.b);
    // volume_vox_m3 is already metric (the pipeline scales by metres per ref unit) — do not scale it again
    const vol = [...added, ...removed, ...moved.map((m) => m.to)].reduce((acc, id) => acc + M.objects[id].volume_vox_m3, 0);
    return { added: added.length, removed: removed.length, moved: moved.length, volumeM3: vol, lines: diffLines(M.objects, mode.a, mode.b) };
  }, [M, mode]);
  if (!M || !stats || mode.kind !== "diff") return null;
  return (
    <div id="legend">
      <div className="k head">
        diff · c{mode.a} → c{mode.b}
      </div>
      <div className="why">“{M.commits[mode.b].message}”</div>
      <div className="lines">
        {stats.lines.map((l) => (
          <div key={`${l.k}${l.id}`} className={`l ${l.k}`}>
            {l.t}
          </div>
        ))}
      </div>
      <div className="stat">
        <i style={{ background: "var(--add)" }} />
        <span>{stats.added} added</span>
      </div>
      <div className="stat">
        <i style={{ background: "var(--rem)" }} />
        <span>{stats.removed} removed</span>
      </div>
      {stats.moved > 0 && (
        <div className="stat">
          <i style={{ background: "var(--ink-70)" }} />
          <span>{stats.moved} moved</span>
        </div>
      )}
      <div className="k" style={{ marginTop: 16 }}>
        {stats.volumeM3.toFixed(2)} m³ changed
      </div>
    </div>
  );
}
