import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "./store";
import { Stage } from "./components/Stage";
import { Hud } from "./components/Hud";
import { Legend } from "./components/Legend";
import { Card } from "./components/Card";
import { Terminal } from "./components/Terminal";
import { Commits, Controls, Mark } from "./components/Nav";
import { ActionLog } from "./components/ActionLog";
import { Intro } from "./components/Intro";
import { Tray } from "./components/Tray";

const isEditable = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

function useKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isEditable(e.target)) return;
      const s = useStore.getState();
      if (s.intro) {
        if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " " || e.key === "j") {
          e.preventDefault();
          s.begin();
        }
        return;
      }
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
        case "g":
        case "G":
          if (s.standard !== null) s.toggleGhosts();
          break;
        case "Escape":
          if (s.placing !== null) s.unplace(s.placing);
          else if (s.selected !== null) s.select(null);
          else if (s.mode.kind !== "normal") s.checkout(s.head);
          break;
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
}

/** Boot failure. Progress is the title card's job. */
function Status() {
  const { status, error } = useStore(useShallow((s) => ({ status: s.status, error: s.error })));
  if (status !== "error") return null;
  return (
    <div id="status" role="alert">
      <div className="k">could not open set</div>
      <div className="msg">{error}</div>
      <div className="k dim">publish the garage set and reload</div>
    </div>
  );
}

export default function App() {
  useKeys();
  const { moving, intro, lit, docs } = useStore(
    useShallow((s) => ({
      moving: s.moving,
      intro: s.intro,
      lit: s.loaded.some(Boolean),
      docs: s.selected !== null || s.mode.kind !== "normal" || s.standard !== null,
    })),
  );
  const cls = [moving ? "moving" : "", intro ? "intro" : "", lit ? "lit" : ""].join(" ").trim();
  return (
    <div className={cls}>
      <Stage />
      <Status />
      <Intro />
      {/* left: the scene — who, where in time, the commits; the minimap and the reflog sit below, fixed */}
      <div id="scene">
        <Mark />
        <Hud />
        <Commits />
        <div id="map-slot" />
        <ActionLog />
      </div>
      {/* right: the documentation — the diff's, the object's, a proposal's; only what the mode calls for */}
      <div id="docs" className={docs ? "on" : ""}>
        <Tray />
        <Legend />
        <Card />
      </div>
      <Terminal />
      <Controls />
    </div>
  );
}
