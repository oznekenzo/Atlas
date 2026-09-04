import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { shortDateOf } from "../time";

/**
 * The commits as a list: hash, date, message; the current one lit. Click checks one out, shift-click diffs it
 * against HEAD. In diff mode the two ends are bracketed; in a proposal its commits sit indented under the base.
 */
export function Commits() {
  const { M, head, mode, loaded, loadErrors, checkout, diff, proposal } = useStore(
    useShallow((s) => ({
      M: s.manifest,
      head: s.head,
      mode: s.mode,
      loaded: s.loaded,
      loadErrors: s.loadErrors,
      checkout: s.checkout,
      diff: s.diff,
      proposal: s.proposal,
    })),
  );
  if (!M) return null;
  const d = mode.kind === "diff" ? mode : null;
  const branch = mode.kind === "proposal" ? proposal : null;
  return (
    <div id="commits">
      <div className="k">commits</div>
      {M.commits.map((c) => {
        const err = loadErrors[c.index];
        const inDiff = d !== null && (c.index === d.a || c.index === d.b);
        const cls = ["row", c.index === head && !d && !branch ? "active" : "", inDiff ? "end" : "", loaded[c.index] ? "" : err ? "failed" : "pending"]
          .join(" ")
          .trim();
        return (
          <div key={c.id}>
            <div
              className={cls}
              onClick={(e) => (e.shiftKey && mode.kind !== "onion" ? diff(head, c.index) : checkout(c.index))}
              title={err ? `failed: ${err}` : undefined}
            >
              <span className="hh">{c.hash}</span>
              <span className="tt">{shortDateOf(c.captured)}</span>
              <span className="mm">{err ? `failed: ${err}` : c.message}</span>
            </div>
            {branch && branch.base === c.index && (
              <div className="branch">
                {branch.commits.map((k) => (
                  <div key={k.n} className="row proposal">
                    <span className="hh">{branch.name}</span>
                    <span className="tt">{k.n}</span>
                    <span className="mm">{k.msg}</span>
                  </div>
                ))}
                <div className="row proposal head">
                  <span className="hh">{branch.name}</span>
                  <span className="tt">{branch.commits.length + 1}</span>
                  <span className="mm">working</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** What the mouse does, then what the keys do in this mode. A pill at the bottom, centred. */
export function Controls() {
  const { mode, selected, placing } = useStore(useShallow((s) => ({ mode: s.mode, selected: s.selected, placing: s.placing })));
  const room =
    mode.kind === "proposal"
      ? placing !== null
        ? "click the floor  put it down   ·   ESC  drop"
        : "tray  pick a thing   ·   /  git commit -m   ·   /  git push"
      : mode.kind === "diff"
        ? "D  exit diff   ·   click  inspect"
        : mode.kind === "onion"
          ? selected !== null
            ? "ESC  all states   ·   O  exit onion"
            : "click  trace an object   ·   O  exit onion"
          : selected !== null
            ? "ESC  deselect"
            : "← →  commits   ·   D  diff   ·   O  onion   ·   /  commands";
  return (
    <div id="controls" className="k">
      <span className="cam">drag orbit · right drag / ⇧ drag pan · scroll zoom</span>
      <span className="sep" />
      <span className="keys">{room}</span>
    </div>
  );
}
