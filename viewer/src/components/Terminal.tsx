import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { run as runGit } from "../git";
import { makeActions } from "../actions";

type Line = { k: string; t: string };
export function Terminal() {
  const { terminalOpen, setTerminal, manifest } = useStore();
  const [lines, setLines] = useState<Line[]>([]); const [hist, setHist] = useState<string[]>([]); const [hi, setHi] = useState(0);
  const inRef = useRef<HTMLInputElement>(null); const outRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (terminalOpen) inRef.current?.focus(); }, [terminalOpen]);
  useEffect(() => { outRef.current?.scrollTo(0, outRef.current.scrollHeight); }, [lines]);
  if (!terminalOpen || !manifest) return null;
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget; e.stopPropagation();
    if (e.key === "Enter") { const line = el.value; el.value = ""; if (!line.trim()) return;
      setHist(h => [...h, line]); setHi(hist.length + 1); useStore.getState().log("$", line); setLines(l => [...l, ...runGit(line, makeActions())]); }
    else if (e.key === "ArrowUp") { const i = Math.max(0, hi - 1); setHi(i); el.value = hist[i] ?? ""; e.preventDefault(); }
    else if (e.key === "ArrowDown") { const i = Math.min(hist.length, hi + 1); setHi(i); el.value = hist[i] ?? ""; e.preventDefault(); }
    else if (e.key === "Escape") setTerminal(false);
  };
  return (
    <div id="term">
      <div className="out" id="term-out" ref={outRef}>{lines.map((l, i) => <div key={i} className={l.k}>{(l.k === "in" ? "$ " : "") + l.t}</div>)}</div>
      <div className="line"><span className="dim">$</span><input ref={inRef} id="term-in" autoFocus autoComplete="off" spellCheck={false} onKeyDown={onKey} /></div>
    </div>
  );
}
