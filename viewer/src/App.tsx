import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore, writeGuide } from "./store";
import { Stage } from "./components/Stage";
import { Title } from "./components/Title";
import { CommandBar, Curtain, Goals, Guide, Mark, ModeHud, PageLinks } from "./components/Chrome";
import { ObjectCard } from "./components/ObjectCard";
import { Panel } from "./components/Panel";
import { MonthBlock } from "./components/MonthBlock";
import { MapAndActions } from "./components/MapAndActions";
import { Pages } from "./components/Pages";

const LEAVE_MS = 1300; // the deck fades to black, then the room is there
const isEditable = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

function useKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return;
      const s = useStore.getState();
      const k = e.key;
      if (s.page === "title") {
        if (k === "Enter" || k === "ArrowRight" || k === " ") {
          e.preventDefault();
          s.nextSlide();
        } else if (k === "ArrowLeft" || k === "Backspace") s.prevSlide();
        return;
      }
      if (s.page !== "room") {
        if (k === "Escape") s.back();
        return;
      }
      if (e.repeat) return;
      if (k === "Enter" && s.tour >= 0) return s.tourNext();
      if (k === "ArrowRight") s.step(1);
      else if (k === "ArrowLeft") s.step(-1);
      else if (k === "d" || k === "D") s.toggleCompare();
      else if (k === "c" || k === "C") s.toggleGhosts();
      else if (k === "n" || k === "N") s.enterDraft();
      else if (k === "m" || k === "M") s.measure();
      else if (k === "?") s.openHow();
      else if (k === "f" || k === "F") s.openFoot();
      else if (k === "Escape") s.esc();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
}

/** The deck's exit and the room's arrival; the guide's persistence; the history preset's scripted past. */
function useTransitions() {
  const { leaving, curtain, floor, preset, ready } = useStore(
    useShallow((s) => ({ leaving: s.leaving, curtain: s.curtain, floor: !!s.loaded[0], preset: s.preset, ready: s.status === "ready" })),
  );
  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(() => useStore.getState().arrive(), LEAVE_MS);
    return () => clearTimeout(id);
  }, [leaving]);
  // the curtain lifts once there is a floor under it: at once on arrival, after the load on a switch of site
  useEffect(() => {
    if (!curtain || !floor) return;
    const id = window.setTimeout(() => useStore.getState().liftCurtain(), 80);
    return () => clearTimeout(id);
  }, [curtain, floor]);
  useEffect(
    () =>
      useStore.subscribe((s, p) => {
        if (s.goals !== p.goals || s.tour !== p.tour || s.hints !== p.hints) writeGuide(s);
      }),
    [],
  );
  useEffect(() => {
    if (preset !== "history" || !ready) return;
    const s = useStore.getState();
    if (s.history.length) return;
    s.go(1);
    s.go(2);
    s.toggleCompare();
    s.exitMode();
    s.go(3);
    if (!useStore.getState().ghosts) s.toggleGhosts();
  }, [preset, ready]);
}

/** Boot failure. */
function Status() {
  const { status, error, set } = useStore(useShallow((s) => ({ status: s.status, error: s.error, set: s.set })));
  if (status !== "error") return null;
  return (
    <div id="status" role="alert">
      <div className="k">could not open the set</div>
      <div className="msg">{error}</div>
      <div className="k dim">publish the {set} set and reload</div>
    </div>
  );
}

export default function App() {
  useKeys();
  useTransitions();
  const { page, moving, draggedYet, inHand, closeSites, sitesOpen } = useStore(
    useShallow((s) => ({
      page: s.page,
      moving: s.moving,
      draggedYet: s.history.some((a) => a.verb === "orbit" || a.verb === "pan" || a.verb === "dolly"),
      inHand: s.draft?.inHand != null,
      closeSites: s.closeSites,
      sitesOpen: s.sitesOpen,
    })),
  );
  const cls = [`page-${page}`, moving ? "moving" : "", inHand ? "in-hand" : ""].join(" ").trim();
  return (
    <div id="app" className={cls} onClick={() => sitesOpen && closeSites()}>
      <Stage />
      <Status />
      <div id="scrim-b" />
      <div id="chrome" hidden={page === "title"}>
        <Mark />
        <Goals />
        <CommandBar />
        <ModeHud />
        <PageLinks />
        <ObjectCard />
        <Panel />
        <MapAndActions />
        <div id="camhint" className={draggedYet ? "off" : ""}>
          drag to look · scroll to zoom
        </div>
        <MonthBlock />
        <Guide />
      </div>
      <Pages />
      <Curtain />
      {page === "title" && <Title />}
    </div>
  );
}
