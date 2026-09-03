import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "./store";
import { Stage } from "./components/Stage";
import { Hud } from "./components/Hud";
import { Legend } from "./components/Legend";
import { Card } from "./components/Card";
import { Terminal } from "./components/Terminal";
import { Nav } from "./components/Nav";
import { ActionLog } from "./components/ActionLog";

const isEditable = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

function useKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isEditable(e.target)) return;
      const s = useStore.getState();
      if (s.terminalOpen || !s.manifest) return;
      const last = s.manifest.commits.length - 1;
      switch (e.key) {
        case "/":
        case "`":
          e.preventDefault();
          s.setTerminal(true);
          break;
        case "ArrowRight":
        case "j":
          s.checkout(Math.min(last, s.head + 1));
          break;
        case "ArrowLeft":
        case "k":
          s.checkout(Math.max(0, s.head - 1));
          break;
        case "d":
        case "D":
          if (s.mode.kind === "diff") s.checkout(s.head);
          else if (s.head > 0) s.diff(s.head - 1, s.head);
          break;
        case "o":
        case "O":
          s.toggleOnion();
          break;
        case "Escape":
          if (s.selected !== null) s.select(null);
          else if (s.mode.kind !== "normal") s.checkout(s.head);
          break;
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
}

/** Boot progress and failure. Nothing else in the chrome renders until the manifest is in. */
function Status() {
  const { status, error, loaded, total } = useStore(
    useShallow((s) => ({ status: s.status, error: s.error, loaded: s.loaded.filter(Boolean).length, total: s.loaded.length })),
  );
  if (status === "error") {
    return (
      <div id="status" role="alert">
        <div className="k">could not open set</div>
        <div className="msg">{error}</div>
        <div className="k dim">try ?set=garage or ?set=synthetic</div>
      </div>
    );
  }
  if (status === "loading" && loaded === 0) {
    return (
      <div id="status" aria-live="polite">
        <div className="k">{total ? `loading c${total - 1}…` : "opening set…"}</div>
      </div>
    );
  }
  return null;
}

export default function App() {
  useKeys();
  const moving = useStore((s) => s.moving);
  return (
    <div className={moving ? "moving" : ""}>
      <Stage />
      <Status />
      <Hud />
      <Legend />
      <Card />
      <ActionLog />
      <Terminal />
      <Nav />
    </div>
  );
}
