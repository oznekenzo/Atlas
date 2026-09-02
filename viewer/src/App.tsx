import { useEffect } from "react";
import { useStore } from "./store";
import { Stage } from "./components/Stage";
import { Hud } from "./components/Hud";
import { Legend } from "./components/Legend";
import { Card } from "./components/Card";
import { Terminal } from "./components/Terminal";
import { Nav } from "./components/Nav";

function useKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState(); if (s.terminalOpen || !s.manifest) return; const last = s.manifest.commits.length - 1;
      if (e.key === "/" || e.key === "`") { e.preventDefault(); s.setTerminal(true); }
      else if (e.key === "ArrowRight" || e.key === "j") s.checkout(Math.min(last, s.head + 1));
      else if (e.key === "ArrowLeft" || e.key === "k") s.checkout(Math.max(0, s.head - 1));
      else if (e.key === "d" || e.key === "D") { if (s.mode.kind === "diff") s.checkout(s.head); else if (s.head > 0) s.diff(s.head - 1, s.head); }
      else if (e.key === "o" || e.key === "O") s.toggleOnion();
      else if (e.key === "Escape") { if (s.selected !== null) s.select(null); else if (s.mode.kind !== "normal") s.checkout(s.head); }
    };
    addEventListener("keydown", onKey); return () => removeEventListener("keydown", onKey);
  }, []);
}

export default function App() {
  useKeys();
  const moving = useStore(s => s.moving);
  return (
    <div className={moving ? "moving" : ""}>
      <Stage /><Hud /><Legend /><Card /><Terminal /><Nav />
    </div>
  );
}
