import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { run as runGit, type Line } from "../git";
import { makeActions } from "../actions";

export function Terminal() {
  const { open, setTerminal, ready } = useStore(
    useShallow((s) => ({ open: s.terminalOpen, setTerminal: s.setTerminal, ready: s.manifest !== null })),
  );
  const [lines, setLines] = useState<Line[]>([]);
  const [hist, setHist] = useState<string[]>([]);
  const [hi, setHi] = useState(0);
  const outRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    outRef.current?.scrollTo(0, outRef.current.scrollHeight);
  }, [lines]);
  if (!open || !ready) return null;

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    e.stopPropagation();
    if (e.key === "Enter") {
      const line = el.value;
      el.value = "";
      if (!line.trim()) return;
      useStore.getState().log("$", line);
      const out = runGit(line, makeActions()); // side effects happen here, once — never inside a state updater
      setHist((h) => [...h, line]);
      setHi(hist.length + 1);
      setLines((l) => [...l, ...out]);
    } else if (e.key === "ArrowUp") {
      const i = Math.max(0, hi - 1);
      setHi(i);
      el.value = hist[i] ?? "";
      e.preventDefault();
    } else if (e.key === "ArrowDown") {
      const i = Math.min(hist.length, hi + 1);
      setHi(i);
      el.value = hist[i] ?? "";
      e.preventDefault();
    } else if (e.key === "Escape") {
      setTerminal(false);
    }
  };
  return (
    <div id="term">
      <div className="out" id="term-out" ref={outRef}>
        {lines.map((l, i) => (
          <div key={i} className={l.k}>
            {(l.k === "in" ? "$ " : "") + l.t}
          </div>
        ))}
      </div>
      <div className="line">
        <span className="dim">$</span>
        <input id="term-in" autoFocus autoComplete="off" spellCheck={false} onKeyDown={onKey} aria-label="git command" />
      </div>
    </div>
  );
}
