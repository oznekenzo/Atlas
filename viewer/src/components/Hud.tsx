import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { dateOf } from "../time";
import { identityOf } from "../identity";

export function Hud() {
  const { M, head, mode, splats, refScale, selected } = useStore(
    useShallow((s) => ({
      M: s.manifest,
      head: s.head,
      mode: s.mode,
      splats: s.splatCount[s.head],
      refScale: s.refScale,
      selected: s.selected,
    })),
  );
  if (!M) return null;
  const c = M.commits[head];
  const diff = mode.kind === "diff" ? mode : null;
  // onion with an object selected is a trace of that one object through time
  const traced = mode.kind === "onion" && selected !== null ? { name: M.objects[selected].name, ...identityOf(M.objects, selected) } : null;
  return (
    <>
      <div id="tl" className="hud">
        <div className="h">
          {diff ? (
            <>
              DIFF{" "}
              <span className="dim">
                &nbsp;{M.commits[diff.a].hash}&nbsp;…&nbsp;{M.commits[diff.b].hash}
              </span>
            </>
          ) : traced ? (
            <>
              TRACING <span className="dim">·</span> {traced.name.toUpperCase()}
            </>
          ) : mode.kind === "onion" ? (
            "ALL COMMITS"
          ) : (
            <>
              HEAD <span className="dim">→</span> {c.hash} <span className="dim">·</span>{" "}
              <span className="half">
                c{c.index} · {M.commits.length} commits
              </span>
            </>
          )}
        </div>
        <div className="m">
          {diff
            ? `c${diff.a} → c${diff.b}`
            : traced
              ? `${traced.present.length} ${traced.present.length === 1 ? "state" : "states"} · c${traced.first} → ${traced.last === null ? "HEAD" : `c${traced.last - 1}`}`
              : mode.kind === "onion"
                ? `${M.commits.length} states, one room`
                : `“${c.message}”`}
        </div>
      </div>
      <div id="tr" className="hud">
        <div>
          <span className="k">captured</span>
          <span>{dateOf(c.captured)}</span>
        </div>
        <div>
          <span className="k">splats</span>
          <span>{splats ? splats.toLocaleString() : "…"}</span>
        </div>
        <div>
          <span className="k">voxel</span>
          <span>{(M.voxel * refScale * 1000).toFixed(0)} mm</span>
        </div>
      </div>
    </>
  );
}
