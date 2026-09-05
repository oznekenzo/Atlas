import { useEffect, useLayoutEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore, type State } from "../store";
import { GOALS, TOUR } from "../demo";
import { dateOf } from "../time";
import { cellOf } from "../layout";

/** The grid's bands: two columns and two bands with hairlines, the room showing through. */
export function Bands() {
  return (
    <>
      <div className="band" id="band-t" />
      <div className="band" id="band-b" />
      <div className="band" id="col-l" />
      <div className="band" id="col-r" />
    </>
  );
}

/** Top left: the site picker, filling its cell. */
export function Sites() {
  const { M, site, open, toggle, pick } = useStore(
    useShallow((s) => ({ M: s.manifest, site: s.site, open: s.sitesOpen, toggle: s.toggleSites, pick: s.pickSite })),
  );
  const sites = M?.sites ?? [];
  const cur = sites.find((x) => x.id === site) ?? sites[0];
  const split = (name: string) => {
    const [a, b] = name.split(" · ");
    return [a, b ?? ""];
  };
  if (!cur) return <div id="sites" />;
  return (
    <div id="sites" className={open ? "open" : ""}>
      <div
        data-tour="site"
        className="site"
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
  );
}

/** Top right: the mark, and under it the pages and the restart. */
export function Menu() {
  const { open, toggle, openHow, openFoot, restart } = useStore(
    useShallow((s) => ({ open: s.menuOpen, toggle: s.toggleMenu, openHow: s.openHow, openFoot: s.openFoot, restart: s.restartDemo })),
  );
  return (
    <div id="menu" className={open ? "open" : ""}>
      <div
        className="head"
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        <span className="t-rader">ATLAS</span>
        <span className="caret">▾</span>
      </div>
      {open && (
        <div className="list" onClick={(e) => e.stopPropagation()}>
          <div className="row" onClick={openHow}>
            How it works
          </div>
          <div className="row" onClick={openFoot}>
            Notes
          </div>
          <div className="row" onClick={restart}>
            Restart demo
          </div>
        </div>
      )}
    </div>
  );
}

/** The checklist: six things to do, ticked by real state. */
export function Goals() {
  const { goals, openGoal, tour, toggleGoal } = useStore(
    useShallow((s) => ({ goals: s.goals, openGoal: s.openGoal, tour: s.tour, toggleGoal: s.toggleGoal })),
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

/** Hanging from the top band: which mode the room is in. Keeps its last text while fading out. */
export function ModeHud() {
  const { M, mode, head, standard, ghosts } = useStore(
    useShallow((s) => ({ M: s.manifest, mode: s.mode, head: s.head, standard: s.standard, ghosts: s.ghosts })),
  );
  const [last, setLast] = useState("");
  const mo = (i: number) => (M ? new Date(M.commits[i].captured).toLocaleDateString("en-GB", { month: "short" }).toUpperCase() : "");
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

/** Black over the room, lifted on arrival. */
export function Curtain() {
  const curtain = useStore((s) => s.curtain);
  return <div id="curtain" className={curtain ? "down" : ""} />;
}

/** Before a state becomes the standard: what that means, and a way out. */
export function ConfirmStandard() {
  const { on, M, head, standard, cancel, confirm } = useStore(
    useShallow((s) => ({
      on: s.confirmStd,
      M: s.manifest,
      head: s.head,
      standard: s.standard,
      cancel: s.cancelStandard,
      confirm: s.confirmStandard,
    })),
  );
  if (!on || !M) return null;
  const old = standard !== null ? dateOf(M.commits[standard].captured) : "none";
  return (
    <div id="confirm" onClick={cancel}>
      <div className="box" onClick={(e) => e.stopPropagation()}>
        <div className="head">MAKE THIS THE STANDARD</div>
        <div className="body">
          <div className="date">{dateOf(M.commits[head].captured)}</div>
          <div className="copy">Every state will be measured against this layout. The current standard, {old}, is released.</div>
        </div>
        <div className="acts">
          <div className="cancel" onClick={cancel}>
            Cancel <kbd>esc</kbd>
          </div>
          <div className="go" onClick={confirm}>
            Confirm <kbd>↵</kbd>
          </div>
        </div>
      </div>
    </div>
  );
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
  // the target's rect: a grid cell by arithmetic, or an element measured while the guide is up
  useLayoutEffect(() => {
    if (!target) {
      setRc(null);
      return;
    }
    const measure = () => {
      let r = cellOf(target, size.W, size.H);
      if (!r) {
        const el = document.querySelector(`[data-tour="${target}"]`);
        if (!el) return;
        const b = el.getBoundingClientRect();
        r = { x: b.left, y: b.top, w: b.width, h: b.height };
      }
      const n = r;
      setRc((o) =>
        o && o.t === target && Math.abs(o.x - n.x) < 1 && Math.abs(o.y - n.y) < 1 && Math.abs(o.w - n.w) < 1 && Math.abs(o.h - n.h) < 1
          ? o
          : { ...n, t: target },
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
  const side = target === "goals" || target === "actions" || target === "map" || target === "site" ? "right" : below ? "below" : "above";
  let tipX = cx;
  let tipY = below ? rc.y + rc.h + 14 : rc.y - 14;
  let tx = "-50%";
  let ty = below ? "0" : "-100%";
  if (target === "room") {
    tipY = rc.y + rc.h / 2;
    ty = "-50%";
  }
  if (side === "right") {
    tipX = rc.x + rc.w + 14;
    tipY = rc.y + Math.min(rc.h / 2, 24);
    tx = "0";
    ty = target === "map" ? "-50%" : "-24px";
    if (target === "map") tipY = rc.y + rc.h / 2;
  }
  if (tx === "-50%" && tipX - 160 < 16) {
    tipX = Math.max(16, rc.x);
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
    const stdMonth =
      s.M && s.standard !== null ? new Date(s.M.commits[s.standard].captured).toLocaleDateString("en-GB", { month: "long" }) : "This month";
    text =
      target === "cmd-esc"
        ? "Press esc to exit the current mode first."
        : target === "cmd-fwd" && g.id === "std"
          ? `${stdMonth} is the standard. Go to a different month first.`
          : g.hint;
  }
  return (
    <>
      <div className="ring" style={{ left: rc.x, top: rc.y, width: rc.w, height: rc.h }} />
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
