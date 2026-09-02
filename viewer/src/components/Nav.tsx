import { useStore } from "../store";

const stamp = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).toUpperCase();

function Rail() {
  const { manifest: M, head, mode, loaded, checkout, diff } = useStore();
  if (!M) return null;
  const d = mode.kind === "diff" ? mode : null;
  return (
    <div id="rail">
      <div className="line" />
      {d && <div className="bracket" style={{ left: 72 * d.a + 36, width: 72 * (d.b - d.a) }} />}
      {M.commits.map(c => (
        <div key={c.id} className={`dot${c.index === head && !d ? " active" : ""}${loaded[c.index] ? "" : " pending"}`}
          onClick={(e) => (e.shiftKey && mode.kind !== "onion") ? diff(head, c.index) : checkout(c.index)}>
          <i />
          <div className="tip"><div className="hh">{c.hash}</div><div className="mm">{c.message}</div><div className="tt k">{stamp(c.captured)}</div></div>
        </div>
      ))}
    </div>
  );
}

function Hints() {
  const { mode, selected } = useStore();
  const text = mode.kind === "diff" ? "D  exit diff   ·   click  inspect"
    : mode.kind === "onion" ? "O  exit onion   ·   ← →  commits"
    : selected !== null ? "ESC  deselect"
    : "← →  commits   ·   D  diff   ·   O  onion   ·   /  commands";
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
