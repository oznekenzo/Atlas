import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { identityOf } from "../identity";

export function Card() {
  const { M, selected, checkout } = useStore(useShallow((s) => ({ M: s.manifest, selected: s.selected, checkout: s.checkout })));
  if (!M || selected === null) return null;
  const ob = M.objects[selected];
  const who = identityOf(M.objects, selected);
  const last = M.commits.length - 1;
  const [a, b] = ob.bbox; // world metres, room-aligned
  const size = [0, 1, 2].map((i) => Math.abs(b[i] - a[i]));
  return (
    <div id="card">
      <div className="n">{ob.name}</div>
      <div className="k" style={{ marginTop: 9 }}>
        {size.map((v) => v.toFixed(2)).join(" × ")} m
      </div>
      <div style={{ height: 16 }} />
      <div className="row">
        <span className="k">appeared</span>
        <span className="add">
          c{who.first} {M.commits[who.first].hash}
        </span>
      </div>
      {who.moves.length > 0 && (
        <div className="row">
          <span className="k">moved</span>
          <span className="half">{who.moves.map((m) => `c${m.commit}`).join(", ")}</span>
        </div>
      )}
      <div className="row">
        <span className="k">last seen</span>
        <span className="half">{who.last === null ? `c${last}  HEAD` : `c${who.last - 1}  (removed in c${who.last})`}</span>
      </div>
      <div style={{ height: 16 }} />
      <div className="k">present in</div>
      <div className="mini">
        {M.commits.map((c) => (
          <i key={c.id} className={who.present.includes(c.index) ? "on" : ""} onClick={() => checkout(c.index)} title={`c${c.index}`} />
        ))}
      </div>
    </div>
  );
}
