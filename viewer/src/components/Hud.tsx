import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { identityOf } from "../identity";
import { compact, dateOf } from "../time";

/** The state of the scene: what HEAD is, what the commit said, and the facts of the capture. Top of the scene column. */
export function Hud() {
  const { M, head, mode, splats, refScale, selected, proposal } = useStore(
    useShallow((s) => ({
      M: s.manifest,
      head: s.head,
      mode: s.mode,
      splats: s.splatCount[s.head],
      refScale: s.refScale,
      selected: s.selected,
      proposal: s.mode.kind === "proposal" ? s.proposal : null,
    })),
  );
  if (!M) return null;
  const c = M.commits[head];
  const diff = mode.kind === "diff" ? mode : null;
  // onion with an object selected is a trace of that one object through time
  const traced = mode.kind === "onion" && selected !== null ? { name: M.objects[selected].name, ...identityOf(M.objects, selected) } : null;
  return (
    <div id="tl" className="state">
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
        ) : proposal ? (
          <>
            HEAD <span className="dim">→</span> {proposal.name} <span className="dim">·</span>{" "}
            <span className="half">
              c{proposal.base}+{proposal.commits.length}
            </span>
          </>
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
              : proposal
                ? `measured against c${proposal.target} ${M.commits[proposal.target].hash}`
                : `“${c.message}”`}
      </div>
      <div className="facts">
        {dateOf(c.captured)} · {splats ? `${compact(splats)} splats` : "…"} · {(M.voxel * refScale * 1000).toFixed(0)} mm voxels
      </div>
    </div>
  );
}
