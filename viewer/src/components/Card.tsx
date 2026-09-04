import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { objectLines, placementsOf, score } from "../aura";

export function Card() {
  const { M, selected, head, checkout } = useStore(useShallow((s) => ({ M: s.manifest, selected: s.selected, head: s.head, checkout: s.checkout })));
  const lines = useMemo(() => (M && selected !== null ? objectLines(M, score(M, placementsOf(M, head)), selected) : []), [M, selected, head]);
  if (!M || selected === null) return null;
  const ob = M.objects[selected];
  const last = M.commits.length - 1;
  const [a, b] = ob.bbox; // world metres, room-aligned
  const size = [0, 1, 2].map((i) => Math.abs(b[i] - a[i]));
  const inScene = ob.present.includes(head);
  return (
    <div id="card">
      <div className="n">{ob.name}</div>
      <div className="k" style={{ marginTop: 9 }}>
        obj {String(ob.id).padStart(2, "0")} · {ob.kind === "plant" ? "plant" : (ob.sub ?? "thing")} · {size.map((v) => v.toFixed(2)).join(" × ")} m
      </div>
      {ob.doc && <div className="doc">{ob.doc}</div>}
      <div style={{ height: 16 }} />
      <div className="row">
        <span className="k">appeared</span>
        <span className="add">
          c{ob.added_in} {M.commits[ob.added_in].hash}
        </span>
      </div>
      <div className="row">
        <span className="k">last seen</span>
        <span className="half">{ob.removed_in === null ? `c${last}  HEAD` : `c${ob.removed_in - 1}  (removed in c${ob.removed_in})`}</span>
      </div>
      <div style={{ height: 16 }} />
      <div className="k">present in</div>
      <div className="mini">
        {M.commits.map((c) => (
          <i key={c.id} className={ob.present.includes(c.index) ? "on" : ""} onClick={() => checkout(c.index)} title={`c${c.index}`} />
        ))}
      </div>
      {inScene && lines.length > 0 && (
        <>
          <div style={{ height: 16 }} />
          <div className="k">in c{head}</div>
          <div className="lines">
            {lines.map((l, i) => (
              <div key={i} className={`l ${l.k}`}>
                {l.t}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
