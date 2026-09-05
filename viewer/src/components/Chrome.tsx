import { useEffect, useLayoutEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore, type State } from "../store";
import { GOALS, TOUR } from "../demo";
import { monthOf } from "../time";

/** Top left: the mark, and the site picker beside it. */
export function Mark() {
  const { M, site, open, toggle, pick } = useStore(
    useShallow((s) => ({ M: s.manifest, site: s.site, open: s.sitesOpen, toggle: s.toggleSites, pick: s.pickSite })),
  );
  const sites = M?.sites ?? [];
  const cur = sites.find((x) => x.id === site) ?? sites[0];
  const split = (name: string) => {
    const [a, b] = name.split(" · ");
    return [a, b ?? ""];
  };
  return (
    <div id="mark">
      <div className="t-rader">ATLAS</div>
      {cur && (
        <div className="sites">
          <div
            data-tour="site"
            className={`site${open ? " open" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
          >
            <span className="cols">
              <span>{split(cur.name)[0]}</span>
              <span className="room">{split(cur.name)[1]}</span>
              <span className="count">{cur.count} states</span>
            </span>
            <span className="caret">▾</span>
          </div>
          {open && (
            <div className="menu" onClick={(e) => e.stopPropagation()}>
              {sites.map((st) => (
                <div key={st.id} className={`row${st.id === cur.id ? " cur" : ""}`} onClick={() => pick(st.id)}>
                  <span className="cols">
                    <span>{split(st.name)[0]}</span>
                    <span className="room">{split(st.name)[1]}</span>
                    <span className="count">{st.count} states</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The checklist: six things to do, ticked by real state. */
export function Goals() {
  const { goals, openGoal, tour, toggleGoal, restart } = useStore(
    useShallow((s) => ({ goals: s.goals, openGoal: s.openGoal, tour: s.tour, toggleGoal: s.toggleGoal, restart: s.restartDemo })),
  );
  const nextIdx = GOALS.findIndex((g) => !goals[g.id]);
  const n = GOALS.filter((g) => goals[g.id]).length;
  return (
    <div id="goals" data-tour="goals">
      <div className="head">
        <span>DEMO</span>
        <span>
          {n} / {GOALS.length}
        </span>
      </div>
      <div className="list">
        {GOALS.map((g, k) => {
          const d = !!goals[g.id];
          const open = openGoal === g.id;
          const next = !d && nextIdx === k;
          const clickable = !d && g.id !== "ui" && tour < 0;
          const cls = ["goal", d ? "done" : "", open ? "open" : "", next ? "next" : "", clickable ? "click" : ""].join(" ").trim();
          return (
            <div
              key={g.id}
              className={cls}
              onClick={(e) => {
                e.stopPropagation();
                if (clickable) toggleGoal(g.id);
              }}
            >
              <span className="box">{d ? "✓" : ""}</span>
              <span className="label">{g.label}</span>
            </div>
          );
        })}
      </div>
      <div
        className="restart"
        onClick={(e) => {
          e.stopPropagation();
          restart();
        }}
      >
        <span>RESTART DEMO</span>
        <span>↺</span>
      </div>
    </div>
  );
}

type Cmd = { id: string; label: string; key: string; on: boolean; dim?: boolean; active?: boolean; accent?: boolean; run: () => void };

/** Every command available right now, with its key; entries slide in and out as the state changes. */
export function CommandBar() {
  const { M, mode, head, standard, ghosts, selected, placed } = useStore(
    useShallow((s) => ({
      M: s.manifest,
      mode: s.mode,
      head: s.head,
      standard: s.standard,
      ghosts: s.ghosts,
      selected: s.selected,
      placed: s.draft?.placements.length ?? 0,
    })),
  );
  const S = useStore.getState;
  const last = (M?.commits.length ?? 1) - 1;
  const normal = mode.kind === "normal";
  const cmp = mode.kind === "compare";
  const draft = mode.kind === "draft";
  const cmds: Cmd[] = [
    { id: "back", label: "Prev state", key: "←", on: true, dim: !normal || head === 0, run: () => S().step(-1) },
    { id: "fwd", label: "Next state", key: "→", on: true, dim: !normal || head === last, run: () => S().step(1) },
    { id: "compare", label: cmp ? "Diffing" : "Diff", key: "D", on: !draft, active: cmp, run: () => S().toggleCompare() },
    {
      id: "std",
      label: "Compare to standard",
      key: "C",
      on: normal && standard !== null && head !== standard,
      active: ghosts,
      accent: true,
      run: () => S().toggleGhosts(),
    },
    { id: "restore", label: "Draft", key: "N", on: normal && selected === null, run: () => S().enterDraft() },
    { id: "measure", label: "Measure", key: "M", on: draft, dim: placed === 0, run: () => S().measure() },
    { id: "esc", label: "Back", key: "esc", on: selected !== null || cmp || draft || ghosts, run: () => S().esc() },
  ];
  return (
    <div id="cmdbar" data-tour="bar">
      {cmds.map((c) => (
        <div key={c.id} className={`slot${c.on ? " on" : ""}`}>
          <div
            data-tour={`cmd-${c.id}`}
            className={["cmd", c.dim ? "dim" : "", c.active ? "active" : "", c.accent ? "accent" : ""].join(" ").trim()}
            onClick={(e) => {
              e.stopPropagation();
              if (c.on && !c.dim) c.run();
            }}
          >
            <kbd>{c.key}</kbd>
            <span>{c.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Under the command bar: which mode the room is in, dashed. Keeps its last text while fading out. */
export function ModeHud() {
  const { M, mode, head, standard, ghosts } = useStore(
    useShallow((s) => ({ M: s.manifest, mode: s.mode, head: s.head, standard: s.standard, ghosts: s.ghosts })),
  );
  const [last, setLast] = useState("");
  const mo = (i: number) => (M ? monthOf(M.commits[i].captured).toUpperCase() : "");
  const text =
    mode.kind === "compare"
      ? `DIFF MODE · ${mo(mode.a)} → ${mo(mode.b)}`
      : mode.kind === "draft"
        ? "DRAFT MODE"
        : ghosts && standard !== null && head !== standard
          ? `COMPARE TO STANDARD MODE · ${mo(head)} → ${mo(standard)}`
          : "";
  useEffect(() => {
    if (text) setLast(text);
  }, [text]);
  return (
    <div id="modehud" className={text ? "on" : ""}>
      {text || last}
    </div>
  );
}

/** Top right: the two pages. */
export function PageLinks() {
  const { openHow, openFoot } = useStore(useShallow((s) => ({ openHow: s.openHow, openFoot: s.openFoot })));
  return (
    <div id="pages">
      <div onClick={openHow}>How it works</div>
      <div onClick={openFoot}>Footnotes</div>
    </div>
  );
}

/** Black over the room, lifted on arrival. */
export function Curtain() {
  const curtain = useStore((s) => s.curtain);
  return <div id="curtain" className={curtain ? "down" : ""} />;
}

// ---- the guide: a spotlight on the target, a note tethered to it ---------------------------------------------

const guideTarget = (s: State): string | null => {
  if (s.page !== "room") return null;
  if (s.tour >= 0 && s.tour < TOUR.length) return TOUR[s.tour].target;
  if (!s.openGoal) return null;
  const g = GOALS.find((x) => x.id === s.openGoal && !s.goals[x.id]);
  if (!g) return null;
  const normal = s.mode.kind === "normal";
  if (g.id === "std" && s.head === s.standard) return "cmd-fwd";
  if (g.id === "draft" && (!normal || s.selected !== null || s.ghosts)) return "cmd-esc";
  if (g.id === "std" && !normal) return "cmd-esc";
  if (g.id === "diff" && (!normal || s.ghosts)) return "cmd-esc";
  if (g.id === "tour" && (!normal || s.ghosts || s.selected !== null)) return "cmd-esc";
  return g.target;
};

type Rc = { x: number; y: number; w: number; h: number };
const PAD = 10;

export function Guide() {
  const s = useStore(
    useShallow((st) => ({
      page: st.page,
      tour: st.tour,
      openGoal: st.openGoal,
      goals: st.goals,
      head: st.head,
      standard: st.standard,
      mode: st.mode,
      selected: st.selected,
      ghosts: st.ghosts,
      M: st.manifest,
    })),
  );
  const target = guideTarget(useStore.getState());
  const [rc, setRc] = useState<(Rc & { t: string }) | null>(null);
  const [size, setSize] = useState({ W: innerWidth, H: innerHeight });
  useEffect(() => {
    const on = () => setSize({ W: innerWidth, H: innerHeight });
    addEventListener("resize", on);
    return () => removeEventListener("resize", on);
  }, []);
  // the target's rect, re-measured while the guide is up: the command bar slides, the panels fade
  useLayoutEffect(() => {
    if (!target) {
      setRc(null);
      return;
    }
    const measure = () => {
      let r: Rc;
      if (target === "room") r = { x: size.W * 0.3, y: size.H * 0.28, w: size.W * 0.4, h: size.H * 0.32 };
      else {
        const el = document.querySelector(`[data-tour="${target}"]`);
        if (!el) return;
        const b = el.getBoundingClientRect();
        r = { x: b.left, y: b.top, w: b.width, h: b.height };
      }
      setRc((o) =>
        o && o.t === target && Math.abs(o.x - r.x) < 1 && Math.abs(o.y - r.y) < 1 && Math.abs(o.w - r.w) < 1 && Math.abs(o.h - r.h) < 1
          ? o
          : { ...r, t: target },
      );
    };
    measure();
    const id = window.setInterval(measure, 80);
    return () => clearInterval(id);
  }, [target, size, s.mode, s.selected, s.ghosts, s.head]);
  if (!target || !rc || rc.t !== target) return null;
  const S = useStore.getState;
  const inTour = s.tour >= 0;
  const cx = rc.x + rc.w / 2;
  const below = rc.y < size.H / 2;
  const side = target === "goals" || target === "left" || target === "site" ? "right" : below ? "below" : "above";
  let tipX = cx;
  let tipY = below ? rc.y + rc.h + PAD + 14 : rc.y - PAD - 14;
  let tx = "-50%";
  let ty = below ? "0" : "-100%";
  if (side === "right") {
    tipX = rc.x + rc.w + PAD + 14;
    tipY = rc.y + Math.min(rc.h / 2, 24);
    tx = "0";
    ty = target === "left" ? "-50%" : "-24px";
  }
  if (tx === "-50%" && tipX - 160 < 16) {
    tipX = Math.max(16, rc.x - PAD);
    tx = "0";
  }
  if (tx === "-50%" && tipX + 160 > size.W - 16) {
    tipX = size.W - 16;
    tx = "-100%";
  }
  let kicker: string;
  let count: string;
  let text: string;
  if (inTour) {
    kicker = "CONTROLS";
    count = `${s.tour + 1} / ${TOUR.length}`;
    text = TOUR[s.tour].text;
  } else {
    const g = GOALS.find((x) => x.id === s.openGoal)!;
    kicker = g.label.toUpperCase();
    count = `${GOALS.indexOf(g) + 1} / ${GOALS.length}`;
    const stdMonth = s.M && s.standard !== null ? s.M.commits[s.standard].captured : "";
    text =
      target === "cmd-esc"
        ? "Press esc to exit the current mode first."
        : target === "cmd-fwd" && g.id === "std"
          ? `${stdMonth ? new Date(stdMonth).toLocaleDateString("en-GB", { month: "long" }) : "This month"} is the standard. Go to a different month first.`
          : g.hint;
  }
  return (
    <>
      <div className="ring" style={{ left: rc.x - PAD, top: rc.y - PAD, width: rc.w + PAD * 2, height: rc.h + PAD * 2 }} />
      <div
        key={`${kicker}|${text}`}
        className="tip"
        style={{ left: tipX, top: tipY, transform: `translate(${tx}, ${ty})` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="kicker">
          <span>{kicker}</span>
          <span>{count}</span>
        </div>
        <div className="text">{text}</div>
        <div className="foot">
          <span className="skip" onClick={() => (inTour ? S().tourSkip() : useStore.setState({ openGoal: null }))}>
            {inTour ? "Skip" : "Close"}
          </span>
          {inTour && (
            <span className="next" onClick={() => S().tourNext()}>
              {s.tour === TOUR.length - 1 ? "Begin" : "Next"} <kbd>↵</kbd>
            </span>
          )}
        </div>
      </div>
    </>
  );
}
