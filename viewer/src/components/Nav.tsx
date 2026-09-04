import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { dateOf } from "../time";

function Rail() {
  const { M, head, mode, loaded, loadErrors, checkout, diff } = useStore(
    useShallow((s) => ({
      M: s.manifest,
      head: s.head,
      mode: s.mode,
      loaded: s.loaded,
      loadErrors: s.loadErrors,
      checkout: s.checkout,
      diff: s.diff,
    })),
  );
  if (!M) return null;
  const d = mode.kind === "diff" ? mode : null;
  return (
    <div id="rail">
      <div className="line" />
      {d && <div className="bracket" style={{ "--a": d.a, "--n": d.b - d.a } as React.CSSProperties} />}
      {M.commits.map((c) => {
        const err = loadErrors[c.index];
        const cls = ["dot", c.index === head && !d ? "active" : "", loaded[c.index] ? "" : err ? "failed" : "pending"].join(" ").trim();
        return (
          <div key={c.id} className={cls} onClick={(e) => (e.shiftKey && mode.kind !== "onion" ? diff(head, c.index) : checkout(c.index))}>
            <i />
            <div className="tip">
              <div className="hh">{c.hash}</div>
              <div className="mm">{err ? `failed: ${err}` : c.message}</div>
              <div className="tt k">{dateOf(c.captured).toUpperCase()}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Hints() {
  const { mode, selected } = useStore(useShallow((s) => ({ mode: s.mode, selected: s.selected })));
  const text =
    mode.kind === "diff"
      ? "D  exit diff   ·   click  inspect"
      : mode.kind === "onion"
        ? selected !== null
          ? "ESC  all states   ·   O  exit onion"
          : "click  trace an object   ·   O  exit onion"
        : selected !== null
          ? "ESC  deselect"
          : "← →  commits   ·   D  diff   ·   O  onion   ·   /  commands";
  return <div className="hints k">{text}</div>;
}

export function Nav() {
  return (
    <nav id="nav">
      <div className="wordmark">TRACE SYSTEMS</div>
      <Rail />
      <Hints />
    </nav>
  );
}
