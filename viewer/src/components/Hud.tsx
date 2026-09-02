import { useStore } from "../store";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function Hud() {
  const { manifest: M, head, mode, splatCount, refScale } = useStore();
  if (!M) return null;
  const c = M.commits[head]; const diff = mode.kind === "diff" ? mode : null;
  return (
    <>
      <div id="tl" className="hud">
        <div className="h">
          {diff ? <>DIFF <span className="dim">&nbsp;{M.commits[diff.a].hash}&nbsp;…&nbsp;{M.commits[diff.b].hash}</span></>
            : mode.kind === "onion" ? "ALL COMMITS"
            : <>HEAD <span className="dim">→</span> {c.hash} <span className="dim">·</span> <span className="half">c{c.index} · {M.commits.length} commits</span></>}
        </div>
        <div className="m">{diff ? `c${diff.a} → c${diff.b}` : mode.kind === "onion" ? `${M.commits.length} states, one room` : `“${c.message}”`}</div>
      </div>
      <div id="tr" className="hud">
        <div><span className="k">captured</span><span>{when(c.captured)}</span></div>
        <div><span className="k">splats</span><span>{splatCount[head] ? splatCount[head].toLocaleString() : "…"}</span></div>
        <div><span className="k">voxel</span><span>{(M.voxel * refScale * 1000).toFixed(0)} mm</span></div>
      </div>
    </>
  );
}
