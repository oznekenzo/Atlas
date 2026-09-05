import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { metres, months } from "../scene";
import { monthOf } from "../time";

/** Top right: the selected thing. Its name and size, where it is month by month, and its written entry. */
export function ObjectCard() {
  const { M, selected, head, standard, go } = useStore(
    useShallow((s) => ({ M: s.manifest, selected: s.selected, head: s.head, standard: s.standard, go: s.go })),
  );
  if (!M || selected === null) return <div id="card" />;
  const ob = M.objects[selected];
  const [a, b] = ob.bbox;
  const size = [0, 1, 2].map((i) => Math.abs(b[i] - a[i]).toFixed(2)).join(" × ");
  const rows = months(M.objects, M.commits.length, selected).reverse();
  const inState = ob.present.includes(head);
  return (
    <div id="card" className="on">
      <div className="top">
        <div className="kicker">{inState ? "OBJECT" : "OBJECT · NOT IN THIS STATE"}</div>
        <div className="name">{ob.name}</div>
        <div className="dims">{size} m</div>
      </div>
      <div className="states">
        {rows.map((r) => {
          const c = M.commits[r.state];
          return (
            <div
              key={c.id}
              className={[
                "row",
                r.state === head ? "head" : "",
                r.state === standard ? "std" : "",
                r.mark === "moved" ? "moved" : "",
                r.id === null ? "absent" : "",
              ]
                .join(" ")
                .trim()}
              onClick={() => go(r.state)}
            >
              <span className="month">{monthOf(c.captured)}</span>
              <span className="mark">{r.mark === "moved" && r.metres !== null ? `moved ${metres(r.metres)}` : r.mark}</span>
              <span className="tag">{r.state === standard ? "standard" : ""}</span>
            </div>
          );
        })}
      </div>
      <div className="entry">
        {ob.doc ? (
          <>
            <div className="text">{ob.doc}</div>
            <div className="by">{ob.by}</div>
          </>
        ) : (
          <div className="none">No entry.</div>
        )}
      </div>
    </div>
  );
}
