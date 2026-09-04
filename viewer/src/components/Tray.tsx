import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { trayOf } from "../measure";

/** The things a proposal can place: what stood in the target and is not here now. Click one to carry it to the floor. */
export function Tray() {
  const { M, mode, proposal, placing, beginPlace } = useStore(
    useShallow((s) => ({ M: s.manifest, mode: s.mode, proposal: s.proposal, placing: s.placing, beginPlace: s.beginPlace })),
  );
  if (!M || !proposal || mode.kind !== "proposal") return null;
  const ids = trayOf(M.objects, proposal.base, proposal.target);
  return (
    <div id="tray">
      <div className="k head">
        tray · from c{proposal.target} · {ids.filter((id) => !proposal.placements[id]).length} to place
      </div>
      {ids.map((id) => {
        const ob = M.objects[id];
        const placed = !!proposal.placements[id];
        const [a, b] = ob.bbox;
        const size = [0, 2].map((i) => Math.abs(b[i] - a[i]).toFixed(1)).join(" × ");
        return (
          <div key={id} className={`row hypo${placing === id ? " hand" : placed ? " placed" : ""}`} onClick={() => beginPlace(id)}>
            <span className="n">{ob.name}</span>
            <span className="k">{placing === id ? "in hand" : placed ? "placed" : `${size} m`}</span>
          </div>
        );
      })}
    </div>
  );
}
