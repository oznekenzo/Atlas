import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";

export function Card() {
  const { M, selected, refScale, checkout } = useStore(
    useShallow((s) => ({ M: s.manifest, selected: s.selected, refScale: s.refScale, checkout: s.checkout })),
  );
  if (!M || selected === null) return null;
  const ob = M.objects[selected];
  const last = M.commits.length - 1;
  const [a, b] = ob.bbox;
  const size = [0, 1, 2].map((i) => Math.abs(b[i] - a[i]) * refScale);
  return (
    <div id="card">
      <div className="n">{ob.name}</div>
      <div className="k" style={{ marginTop: 9 }}>
        obj {String(ob.id).padStart(2, "0")} · {size.map((v) => v.toFixed(2)).join(" × ")} m
      </div>
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
    </div>
  );
}
