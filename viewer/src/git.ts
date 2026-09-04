/**
 * The git terminal: real git grammar over a history that cannot be rewritten.
 * Pure — takes an Actions adapter, returns lines. No store import, so it is trivially testable.
 */
import type { Commit, Obj } from "./types";
import { identityOf } from "./identity";
import { diffLines } from "./attribution";
import { dateOf } from "./time";

export type ReflogEntry = { id: number; verb: string; detail: string };
export type Actions = {
  reflog: () => ReflogEntry[]; // navigational entries only, oldest first
  restore: (id: number) => boolean;
  checkout: (i: number) => boolean;
  diff: (a: number, b: number) => boolean;
  head: () => number;
  objects: () => Obj[];
  commits: () => Commit[];
  select: (id: number | null) => void;
  status: () => string[];
  /** The proposal branch. */
  branch: (name: string, target: number) => boolean;
  enterBranch: () => boolean;
  proposal: () => { name: string; base: number; target: number; commits: number } | null;
  onBranch: () => boolean;
  commit: (
    msg: string,
  ) => { lines: { k: "off" | "missing" | "extra"; t: string }[]; placed: number; ofN: number; meanM: number | null; done: boolean } | null;
};
export type Line = { k: "in" | "o" | "e" | "a" | "d"; t: string };

const fmt = (c: Commit) => `${c.hash}  ${dateOf(c.captured).padEnd(11)}  ${c.message}`;
const pad3 = (n: number) => String(n).padStart(3, "0");

/** Resolve a revision to a commit index. Throws with git's wording on failure. */
export function resolveRef(ref: string, A: Actions): number {
  const cs = A.commits();
  const head = A.head();
  let m: RegExpMatchArray | null;
  if (ref === "HEAD") return head;
  if ((m = ref.match(/^HEAD~(\d+)$/))) {
    const i = head - parseInt(m[1], 10);
    if (i < 0) throw new Error(`fatal: ambiguous argument '${ref}': unknown revision (only ${head} commit${head === 1 ? "" : "s"} before HEAD)`);
    return i;
  }
  if ((m = ref.match(/^c(\d+)$/))) {
    const i = parseInt(m[1], 10);
    if (i >= cs.length) throw new Error(`fatal: ambiguous argument '${ref}': unknown revision (c0…c${cs.length - 1})`);
    return i;
  }
  const byHash = cs.filter((c) => c.hash.startsWith(ref));
  if (byHash.length === 1) return byHash[0].index;
  if (byHash.length > 1) throw new Error(`error: short object ID ${ref} is ambiguous`);
  throw new Error(`fatal: ambiguous argument '${ref}': unknown revision`);
}

/** Name → the thing's first id, so blame and bisect answer for its whole history, not for one of its moves. */
const findObject = (A: Actions, words: string[]) => {
  const q = words.join(" ").toLowerCase();
  const objects = A.objects();
  const hit = q ? objects.find((o) => o.name.toLowerCase().includes(q)) : undefined;
  return hit ? objects[identityOf(objects, hit.id).root] : undefined;
};

/** What changed between two commits, as terminal lines: ~ moved (with the distance), + arrived, − left. */
const changeLines = (objects: Obj[], a: number, b: number): Line[] =>
  diffLines(objects, a, b).map((l): Line => ({
    k: l.k === "add" ? "a" : l.k === "rem" ? "e" : "o",
    t: `${l.k === "add" ? "+" : l.k === "rem" ? "-" : "~"} ${l.t}`,
  }));

export function run(cmdline: string, A: Actions): Line[] {
  const out: Line[] = [{ k: "in", t: cmdline }];
  const argv =
    cmdline
      .trim()
      .match(/(?:[^\s"]+|"[^"]*")+/g)
      ?.map((s) => s.replace(/^"|"$/g, "")) ?? [];
  if (argv[0] !== "git") {
    out.push({ k: "e", t: `${argv[0] ?? ""}: command not found` });
    return out;
  }
  const [, sub, ...rest] = argv;
  const cs = A.commits();
  const checkout = (i: number) => {
    if (A.checkout(i)) out.push({ k: "o", t: `HEAD is now at ${cs[i].hash} ${cs[i].message}` });
    else out.push({ k: "e", t: `error: c${i} is still loading` });
  };
  try {
    switch (sub) {
      case "log": {
        for (const c of [...cs].reverse()) out.push({ k: "o", t: fmt(c) });
        break;
      }
      case "reflog": {
        const h = A.reflog();
        for (let n = 0; n < h.length; n++) {
          const a = h[h.length - 1 - n];
          out.push({ k: n === 0 ? "o" : "d", t: `HEAD@{${n}}  ${pad3(a.id)}  ${a.verb.padEnd(9)} ${a.detail}` });
        }
        break;
      }
      case "checkout": {
        if (rest[0] === "-b") {
          // a proposal: a branch off HEAD that puts things back where they stood in the target (default HEAD~1)
          const name = rest[1];
          if (!name) throw new Error("usage: git checkout -b <branch> [<target>]");
          const target = resolveRef(rest[2] ?? "HEAD~1", A);
          if (!A.branch(name, target)) throw new Error(`fatal: cannot branch '${name}' here (target c${target} must differ from HEAD and be loaded)`);
          out.push(
            { k: "o", t: `Switched to a new branch '${name}'` },
            { k: "d", t: `measured against ${cs[target].hash} (c${target}) — ${cs[target].message}` },
          );
          break;
        }
        const p = A.proposal();
        if (p && rest[0] === p.name) {
          if (A.enterBranch()) out.push({ k: "o", t: `Switched to branch '${p.name}'` });
          break;
        }
        if (rest[0] === "main") {
          checkout(A.head());
          break;
        }
        const m = (rest[0] ?? "").match(/^HEAD@\{(\d+)\}$/);
        if (m) {
          const h = A.reflog();
          const a = h[h.length - 1 - parseInt(m[1], 10)];
          if (!a) throw new Error(`fatal: log for 'HEAD' only has ${h.length} entries`);
          if (A.restore(a.id)) out.push({ k: "o", t: `restored ${pad3(a.id)}  ${a.verb} ${a.detail}` });
          else out.push({ k: "d", t: "already there" });
          break;
        }
        checkout(resolveRef(rest[0] ?? "HEAD", A));
        break;
      }
      case "diff": {
        let a: number;
        let b: number;
        if (rest.length === 0) {
          b = A.head();
          a = Math.max(0, b - 1);
        } else if (rest.length === 1) {
          b = A.head();
          a = resolveRef(rest[0], A);
        } else {
          a = resolveRef(rest[0], A);
          b = resolveRef(rest[1], A);
        }
        if (a === b) {
          out.push({ k: "d", t: "(no changes)" });
          break;
        }
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        if (!A.diff(lo, hi)) {
          out.push({ k: "e", t: `error: c${lo} or c${hi} is still loading` });
          break;
        }
        out.push({ k: "o", t: `“${cs[hi].message}”` });
        const lines = changeLines(A.objects(), lo, hi);
        out.push(...lines);
        if (lines.length === 0) out.push({ k: "d", t: "(no object changes)" });
        break;
      }
      case "show": {
        const i = resolveRef(rest[0] ?? "HEAD", A);
        if (!A.checkout(i)) {
          out.push({ k: "e", t: `error: c${i} is still loading` });
          break;
        }
        out.push({ k: "o", t: fmt(cs[i]) }, { k: "d", t: "" });
        if (i > 0) out.push(...changeLines(A.objects(), i - 1, i));
        break;
      }
      case "branch": {
        const p = A.proposal();
        out.push({ k: "o", t: `${p && A.onBranch() ? "  " : "* "}main` });
        if (p) out.push({ k: "o", t: `${A.onBranch() ? "* " : "  "}${p.name}` });
        break;
      }
      case "commit": {
        if (!A.onBranch()) throw new Error("fatal: the physical world does not support commit. (git checkout -b to propose one)");
        const mi = rest.indexOf("-m");
        const msg = mi >= 0 ? rest.slice(mi + 1).join(" ") : "";
        if (!msg) throw new Error('fatal: a proposal needs a message: git commit -m "what you expect"');
        const r = A.commit(msg)!;
        const p = A.proposal()!;
        out.push({ k: "o", t: `[${p.name} ${p.commits}] ${msg}` });
        for (const l of r.lines) out.push({ k: l.k === "missing" ? "e" : l.k === "extra" ? "d" : "o", t: `  ${l.t}` });
        out.push({
          k: r.done ? "a" : "d",
          t: `  ${r.placed} of ${r.ofN} placed${r.meanM !== null ? ` · mean ${r.meanM.toFixed(2)} m off` : ""}${r.done ? " · restored" : ""}`,
        });
        break;
      }
      case "status": {
        if (A.onBranch()) {
          const p = A.proposal()!;
          out.push({ k: "o", t: `On branch ${p.name} — measured against c${p.target} ${cs[p.target].hash}` });
          for (const l of A.status()) out.push({ k: l.includes("missing") ? "e" : "o", t: `  ${l}` });
          break;
        }
        out.push({ k: "o", t: `On commit c${A.head()} — “${cs[A.head()].message}”` });
        const lines = A.status();
        if (lines.length === 0) out.push({ k: "d", t: "  nothing changed in this commit" });
        for (const l of lines) out.push({ k: l.startsWith("+") ? "a" : l.startsWith("-") ? "e" : "o", t: `  ${l}` });
        break;
      }
      case "blame": {
        const o = findObject(A, rest);
        if (!o) throw new Error(`fatal: no such object '${rest.join(" ")}'`);
        const who = identityOf(A.objects(), o.id);
        A.select(o.id);
        checkout(who.first);
        if (o.doc) out.push({ k: "d", t: o.doc });
        out.push({ k: "o", t: `${o.name}: appeared in ${cs[who.first].hash} (c${who.first}) — ${cs[who.first].message}` });
        for (const m of who.moves) out.push({ k: "o", t: `           moved in ${cs[m.commit].hash} (c${m.commit}) — ${cs[m.commit].message}` });
        if (who.last !== null) out.push({ k: "o", t: `           removed in ${cs[who.last].hash} (c${who.last})` });
        break;
      }
      case "bisect": {
        const o = findObject(A, rest);
        if (!o) throw new Error("usage: git bisect <object>");
        const first = identityOf(A.objects(), o.id).first;
        let lo = 0;
        let hi = cs.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          const has = mid >= first;
          out.push({ k: "d", t: `  bisect: c${mid} ${has ? "has" : "lacks"} ${o.name}` });
          if (has) hi = mid;
          else lo = mid + 1;
        }
        checkout(lo);
        A.select(o.id);
        out.push({ k: "o", t: `${cs[lo].hash} is the first commit with ${o.name}` });
        break;
      }
      case "reset":
        out.push({ k: "e", t: "fatal: the physical world does not support reset." });
        break;
      case "revert":
        out.push({ k: "e", t: "fatal: the physical world does not support revert." });
        break;
      case "rebase":
        out.push({ k: "e", t: "fatal: history here is not yours to rewrite." });
        break;
      case "push": {
        out.push({ k: "e", t: "fatal: remote is reality. read-only." });
        const p = A.proposal();
        if (p && A.onBranch()) out.push({ k: "d", t: `${p.name} stays local.` });
        break;
      }
      case "stash":
        out.push({ k: "e", t: "fatal: nowhere to put it." });
        break;
      case "help":
      case undefined:
        out.push(
          { k: "o", t: "log · checkout <ref> · diff [a] [b] · show <ref> · status · blame <object> · bisect <object> · reflog" },
          { k: "o", t: "checkout -b <branch> [<target>] · commit -m <msg> · branch · push" },
          { k: "d", t: `refs: c0…c${cs.length - 1}, HEAD, HEAD~n, a hash prefix, or HEAD@{n} from the reflog` },
        );
        break;
      default:
        out.push({ k: "e", t: `git: '${sub}' is not a git command. See 'git help'.` });
    }
  } catch (e) {
    out.push({ k: "e", t: e instanceof Error ? e.message : String(e) });
  }
  return out;
}
