import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";

const stamp = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "UNDATED";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).toUpperCase();
};

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
              <div className="tt k">{stamp(c.captured)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Hints() {
  const { mode, selected, boxes } = useStore(useShallow((s) => ({ mode: s.mode, selected: s.selected, boxes: s.boxes })));
  const b = boxes ? "B  hide boxes" : "B  detect";
  const text =
    mode.kind === "diff"
      ? `D  exit diff   ·   ${b}   ·   click  inspect`
      : mode.kind === "onion"
        ? selected !== null
          ? `ESC  all states   ·   ${b}   ·   O  exit onion`
          : `click  trace an object   ·   ${b}   ·   O  exit onion`
        : selected !== null
          ? `ESC  deselect   ·   ${b}`
          : `← →  commits   ·   D  diff   ·   O  onion   ·   ${b}`;
  return <div className="hints k">{text}</div>;
}

export function Nav() {
  return (
    <nav id="nav">
      <div className="wordmark">WORLDSTATE</div>
      <Rail />
      <Hints />
    </nav>
  );
}
