import type { Commit, Obj } from "./types";

export type Actions = {
  checkout: (i: number) => void; diff: (a: number, b: number) => void; head: () => number;
  objects: () => Obj[]; commits: () => Commit[]; select: (id: number | null) => void; status: () => string[];
};
type Line = { k: "in" | "o" | "e" | "a" | "d"; t: string };

const fmt = (c: Commit) => `${c.hash}  ${new Date(c.captured).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}   ${c.message}`;

export function resolveRef(ref: string, A: Actions): number | null {
  const cs = A.commits(); const head = A.head();
  let m: RegExpMatchArray | null;
  if (ref === "HEAD") return head;
  if ((m = ref.match(/^HEAD~(\d+)$/))) return Math.max(0, head - parseInt(m[1]));
  if ((m = ref.match(/^c(\d)$/))) { const i = parseInt(m[1]); return i < cs.length ? i : null; }
  const byHash = cs.find(c => c.hash.startsWith(ref)); if (byHash) return byHash.index;
  return null;
}

export function run(cmdline: string, A: Actions): Line[] {
  const out: Line[] = [{ k: "in", t: cmdline }];
  const argv = cmdline.trim().match(/(?:[^\s"]+|"[^"]*")+/g)?.map(s => s.replace(/^"|"$/g, "")) ?? [];
  if (argv[0] !== "git") { out.push({ k: "e", t: `${argv[0] ?? ""}: command not found` }); return out; }
  const [, sub, ...rest] = argv; const cs = A.commits();
  const bad = (r: string) => out.push({ k: "e", t: `fatal: ambiguous argument '${r}': unknown revision` });
  switch (sub) {
    case "log": { for (const c of [...cs].reverse()) out.push({ k: "o", t: fmt(c) }); break; }
    case "checkout": { const i = resolveRef(rest[0] ?? "HEAD", A); if (i === null) { bad(rest[0]); break; }
      A.checkout(i); out.push({ k: "o", t: `HEAD is now at ${cs[i].hash} ${cs[i].message}` }); break; }
    case "diff": { let a: number | null, b: number | null;
      if (rest.length === 0) { b = A.head(); a = Math.max(0, b - 1); }
      else if (rest.length === 1) { b = A.head(); a = resolveRef(rest[0], A); }
      else { a = resolveRef(rest[0], A); b = resolveRef(rest[1], A); }
      if (a === null || b === null) { bad(rest.join(" ")); break; }
      if (a === b) { out.push({ k: "d", t: "(no changes)" }); break; }
      A.diff(Math.min(a, b), Math.max(a, b));
      const lo = Math.min(a, b), hi = Math.max(a, b);
      for (const o of A.objects()) {
        const inA = o.present.includes(lo), inB = o.present.includes(hi);
        if (inB && !inA) out.push({ k: "a", t: `+ ${o.name}` });
        if (inA && !inB) out.push({ k: "e", t: `- ${o.name}` });
      }
      break; }
    case "show": { const i = resolveRef(rest[0] ?? "HEAD", A); if (i === null) { bad(rest[0]); break; }
      A.checkout(i); out.push({ k: "o", t: fmt(cs[i]) }, { k: "d", t: "" });
      for (const o of A.objects()) { if (o.added_in === i && i > 0) out.push({ k: "a", t: `+ ${o.name}` }); if (o.removed_in === i) out.push({ k: "e", t: `- ${o.name}` }); }
      break; }
    case "status": { out.push({ k: "o", t: `On commit c${A.head()} — “${cs[A.head()].message}”` });
      for (const l of A.status()) out.push({ k: l.startsWith("+") ? "a" : "e", t: `  ${l}` }); break; }
    case "blame": { const q = rest.join(" ").toLowerCase(); const o = A.objects().find(o => o.name.toLowerCase().includes(q));
      if (!o) { out.push({ k: "e", t: `fatal: no such object '${rest.join(" ")}'` }); break; }
      A.select(o.id); A.checkout(o.added_in);
      out.push({ k: "o", t: `${o.name}: appeared in ${cs[o.added_in].hash} (c${o.added_in}) — ${cs[o.added_in].message}` });
      if (o.removed_in !== null) out.push({ k: "o", t: `           removed in ${cs[o.removed_in].hash} (c${o.removed_in})` });
      break; }
    case "bisect": { const q = rest.join(" ").toLowerCase(); const o = A.objects().find(o => o.name.toLowerCase().includes(q));
      if (!o) { out.push({ k: "e", t: `usage: git bisect <object>` }); break; }
      let lo = 0, hi = cs.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; const has = o.present.includes(mid) || mid >= o.added_in;
        out.push({ k: "d", t: `  bisect: c${mid} ${has ? "has" : "lacks"} ${o.name}` }); if (has) hi = mid; else lo = mid + 1; }
      A.checkout(lo); A.select(o.id); out.push({ k: "o", t: `${cs[lo].hash} is the first commit with ${o.name}` }); break; }
    case "reset": out.push({ k: "e", t: "fatal: the physical world does not support reset." }); break;
    case "revert": out.push({ k: "e", t: "fatal: the physical world does not support revert." }); break;
    case "push": out.push({ k: "e", t: "fatal: remote is reality. read-only." }); break;
    case "stash": out.push({ k: "e", t: "fatal: nowhere to put it." }); break;
    case "help": case undefined: out.push({ k: "o", t: "log · checkout <ref> · diff [a] [b] · show <ref> · status · blame <object> · bisect <object>" },
      { k: "d", t: "refs: c0…c5, HEAD, HEAD~n, or a hash prefix" }); break;
    default: out.push({ k: "e", t: `git: '${sub}' is not a git command. See 'git help'.` });
  }
  return out;
}
