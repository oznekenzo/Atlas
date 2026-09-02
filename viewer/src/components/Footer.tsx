import { useStore } from "../store";
export function Footer() {
  const { mode, selected } = useStore();
  const right = mode.kind === "diff" ? "D  exit diff   ·   click  inspect object"
    : mode.kind === "onion" ? "O  exit onion   ·   ← →  commits"
    : selected !== null ? "ESC  deselect   ·   B  blame"
    : "← →  commits   ·   D  diff   ·   O  onion   ·   ESC";
  return (<>
    <div id="bl" className="hud k">/  commands</div>
    <div id="br" className="hud k">{right}</div>
  </>);
}
