/**
 * The HUD's attention: full while the pointer is on it, lighter while the pointer is in the room or a camera drag
 * is under way, and gone after two seconds of stillness in the room. Stillness means the camera is not
 * moving; the pointer drifting inside the room does not count. Once gone, it stays gone until a click: hovering
 * over where the HUD was may be an inspection of the room behind it. A click on a thing brings it back to the middle
 * level, a click on the HUD brings it back in full; a menu, the confirm or the walkthrough pin it in full. A piece
 * of the HUD that stands into the room's cell (the standard tab on a timeline cell, the mode readout under the
 * bar) is still the HUD: the pointer on it is not in the room.
 *
 * One attribute on the root element, `data-hud`, carries the level; the stylesheet's tokens, defined on the same
 * element, do the rest. Nothing re-renders.
 */
import { useStore } from "./store";
import { cellOf } from "./layout";

export type Level = "hud" | "room" | "quiet";
const STILL_MS = 2000;

export const attentionLevel = (): Level => (document.documentElement.dataset.hud as Level | undefined) ?? "hud";

export function startAttention(): () => void {
  const app = document.documentElement;
  let inRoom = false;
  let dragging = false;
  let still = false;
  let latched = false; // gone, and staying gone until a click
  let timer = 0;
  let level: Level = "hud";

  const held = () => {
    const s = useStore.getState();
    return s.page !== "room" || s.sitesOpen || s.menuOpen || s.confirmStd || s.tour >= 0 || s.openGoal !== null;
  };
  const apply = () => {
    const s = useStore.getState();
    const next: Level = held() ? "hud" : !inRoom && !dragging ? "hud" : still && !s.moving && !dragging ? "quiet" : "room";
    if (latched && next !== "quiet") return; // gone stays gone; only wake() lifts the latch
    if (next === "quiet") latched = true;
    if (next === level) return;
    level = next;
    app.dataset.hud = next;
  };
  const wake = () => {
    latched = false;
  };
  /** Stillness starts counting again from now. */
  const restart = () => {
    clearTimeout(timer);
    still = false;
    timer = window.setTimeout(() => {
      still = true;
      apply();
    }, STILL_MS);
    apply();
  };
  const stop = () => {
    clearTimeout(timer);
    still = false;
    apply();
  };

  const onMove = (e: PointerEvent) => {
    const r = cellOf("room", innerWidth, innerHeight)!;
    const inCell = e.clientX >= r.x && e.clientX <= r.x + r.w && e.clientY >= r.y && e.clientY <= r.y + r.h;
    const onHud = e.target instanceof Element && e.target.closest("#chrome") !== null; // a piece standing into the cell
    const now = inCell && !onHud;
    if (now === inRoom) return;
    inRoom = now;
    if (latched) return; // hovering over a gone HUD may be an inspection of what is behind it
    if (inRoom) restart();
    else stop();
  };
  // any click wakes a gone HUD; a drag on the room's canvas holds the middle level until the button is released
  const onDown = (e: PointerEvent) => {
    wake();
    if (!(e.target instanceof HTMLCanvasElement) || !e.target.closest("#stage")) {
      apply(); // on the HUD: full
      return;
    }
    dragging = true;
    clearTimeout(timer);
    still = false;
    apply();
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    if (inRoom) restart();
    else stop();
  };
  const unsub = useStore.subscribe((s, p) => {
    if (s.moving !== p.moving) {
      if (latched) return; // a wheel zoom over a gone HUD does not bring it back
      if (s.moving) {
        clearTimeout(timer);
        still = false;
        apply();
      } else if (inRoom) restart();
      return;
    }
    if (s.selected !== p.selected && s.selected !== null) {
      wake();
      if (inRoom) restart();
      else apply();
      return;
    }
    if (
      s.page !== p.page ||
      s.sitesOpen !== p.sitesOpen ||
      s.menuOpen !== p.menuOpen ||
      s.confirmStd !== p.confirmStd ||
      s.tour !== p.tour ||
      s.openGoal !== p.openGoal
    ) {
      if (held()) wake();
      if (!held() && inRoom) restart();
      else apply();
    }
  });
  addEventListener("pointermove", onMove);
  addEventListener("pointerdown", onDown, true);
  addEventListener("pointerup", onUp, true);
  addEventListener("pointercancel", onUp, true);
  apply();
  return () => {
    clearTimeout(timer);
    unsub();
    removeEventListener("pointermove", onMove);
    removeEventListener("pointerdown", onDown, true);
    removeEventListener("pointerup", onUp, true);
    removeEventListener("pointercancel", onUp, true);
    delete app.dataset.hud;
  };
}
