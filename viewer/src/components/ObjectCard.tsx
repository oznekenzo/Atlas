import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { metres, months } from "../scene";
import { monthOf } from "../time";

const CLOSED = 51; // the kicker alone
const HOLD_MS = 560; // the card keeps its content while it collapses

/** Right column, first cell: the selected thing. Grows to its content, holds its last content while it closes. */
export function ObjectCard() {
  const { M, selected, head, standard, go } = useStore(
    useShallow((s) => ({ M: s.manifest, selected: s.selected, head: s.head, standard: s.standard, go: s.go })),
  );
  const [shown, setShown] = useState<number | null>(selected); // what the body shows, kept through the hold
  const [h, setH] = useState(CLOSED);
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected !== null) {
      setShown(selected);
      return;
    }
    const id = window.setTimeout(() => setShown(null), HOLD_MS);
    return () => clearTimeout(id);
  }, [selected]);
  useLayoutEffect(() => {
    if (selected === null) {
      setH(CLOSED);
      return;
    }
    const el = inner.current;
    if (!el) return;
    const measure = () => setH(Math.round(el.getBoundingClientRect().height) + 33);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [selected, shown, head, standard]);
  const ob = M && shown !== null ? M.objects[shown] : null;
  const rows = M && shown !== null ? months(M.objects, M.commits.length, shown).reverse() : [];
  const inState = ob ? ob.present.includes(head) : false;
  return (
    <div id="card" className={selected !== null ? "on" : ""} style={{ height: h }}>
      <div className="inner" ref={inner}>
        <div className="kicker">{ob ? (inState ? "OBJECT" : "OBJECT · NOT IN THIS STATE") : "OBJECT · NONE SELECTED"}</div>
        {ob && M && (
          <>
            <div className="top">
              <div className="name">{ob.name}</div>
              <div className="dims">{[0, 1, 2].map((i) => Math.abs(ob.bbox[1][i] - ob.bbox[0][i]).toFixed(2)).join(" × ")} m</div>
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
              <div className="kicker">DOCS</div>
              {ob.doc ? (
                <>
                  <div className="text">{ob.doc}</div>
                  <div className="by">{ob.by}</div>
                </>
              ) : (
                <div className="none">No entry.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
