import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { chainOf } from "../identity";
import { centre } from "../attribution";
import { monthOf } from "../time";

/** Top right: the selected thing. Its name and size, where it is month by month, and its written entry. */
export function ObjectCard() {
  const { M, selected, head, standard, go } = useStore(
    useShallow((s) => ({ M: s.manifest, selected: s.selected, head: s.head, standard: s.standard, go: s.go })),
  );
  if (!M || selected === null) return <div id="card" />;
  const ob = M.objects[selected];
  const chain = chainOf(M.objects, selected);
  const [a, b] = ob.bbox;
  const size = [0, 1, 2].map((i) => Math.abs(b[i] - a[i]).toFixed(2)).join(" × ");
  // the object's id in each month, following its moves; null where it is not in the room
  const idAt = (c: number) => chain.find((i) => M.objects[i].present.includes(c)) ?? null;
  const first = Math.min(...chain.map((i) => M.objects[i].added_in));
  const rows = M.commits
    .map((c) => {
      const id = idAt(c.index);
      const prev = c.index > 0 ? idAt(c.index - 1) : null;
      let mark = "not in room";
      let moved = false;
      if (id !== null && prev !== null && id !== prev) {
        const p = centre(M.objects[prev]);
        const q = centre(M.objects[id]);
        mark = `moved ${Math.hypot(p.x - q.x, p.z - q.z).toFixed(1)} m`;
        moved = true;
      } else if (id !== null && c.index === first) mark = "arrived";
      else if (id !== null) mark = "in room";
      return { c, id, mark, moved };
    })
    .reverse();
  const inState = ob.present.includes(head);
  return (
    <div id="card" className="on">
      <div className="top">
        <div className="kicker">{inState ? "OBJECT" : "OBJECT · NOT IN THIS STATE"}</div>
        <div className="name">{ob.name}</div>
        <div className="dims">{size} m</div>
      </div>
      <div className="states">
        {rows.map(({ c, id, mark, moved }) => (
          <div
            key={c.id}
            className={["row", c.index === head ? "head" : "", c.index === standard ? "std" : "", moved ? "moved" : "", id === null ? "absent" : ""]
              .join(" ")
              .trim()}
            onClick={() => go(c.index)}
          >
            <span className="month">{monthOf(c.captured)}</span>
            <span className="mark">{mark}</span>
            <span className="tag">{c.index === standard ? "standard" : ""}</span>
          </div>
        ))}
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
