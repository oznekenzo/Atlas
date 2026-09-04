import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { attribution, placementsOf } from "../aura";

/** Diff mode's legend: the attribution. What moved, what arrived or left, which reactions changed and by how much. */
export function Legend() {
  const { M, mode } = useStore(useShallow((s) => ({ M: s.manifest, mode: s.mode })));
  const att = useMemo(() => (M && mode.kind === "diff" ? attribution(M, placementsOf(M, mode.a), placementsOf(M, mode.b)) : null), [M, mode]);
  if (!M || !att || mode.kind !== "diff") return null;
  const delta = att.auraB - att.auraA;
  return (
    <div id="legend" className="hud">
      <div className="h">
        <span className="k">aura</span>
        <span>
          <span className="half">{att.auraA}</span> → {att.auraB}
        </span>
        <span className={delta > 0 ? "add" : delta < 0 ? "rem" : "dim"}>{delta > 0 ? `+${delta}` : delta < 0 ? `−${-delta}` : "±0"}</span>
      </div>
      <div className="why">“{M.commits[mode.b].message}”</div>
      <div className="lines">
        {att.lines.map((l, i) => (
          <div key={i} className={`l ${l.k}`}>
            {l.t}
          </div>
        ))}
      </div>
    </div>
  );
}
