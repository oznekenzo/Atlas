import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";

const Back = () => {
  const back = useStore((s) => s.back);
  return (
    <div className="back" onClick={back}>
      Back <kbd>esc</kbd>
    </div>
  );
};

/** How it works and Footnotes: one screen each over the dimmed room, esc or Back returns to where you were. */
export function Pages() {
  const { page } = useStore(useShallow((s) => ({ page: s.page })));
  if (page === "how")
    return (
      <div className="page" id="how">
        <Back />
        <div className="body">
          <div className="h">How it works</div>
          <div className="rows">
            <div className="t">State</div>
            <div>The room is scanned. Each scan is one state, dated.</div>
            <div className="t">Register</div>
            <div>All states are aligned into one frame, so a spot is the same spot every month.</div>
            <div className="t">Diff</div>
            <div>Any two states: what was added, removed, moved, and how far.</div>
            <div className="t std">Standard</div>
            <div>One state is declared the standard. Every later state is measured against it: the drift.</div>
          </div>
          <div className="diagram">
            <div className="box" />
            <div className="link" />
            <div className="box" />
            <div className="link" />
            <div className="box std">
              <div className="cap">STANDARD</div>
            </div>
            <div className="link" />
            <div className="box">
              <div className="ghost" />
              <div className="cap below">DRIFT · 2.6 m</div>
            </div>
          </div>
        </div>
      </div>
    );
  if (page === "footnotes")
    return (
      <div className="page" id="footnotes">
        <Back />
        <div className="body">
          <div className="h">Footnotes</div>
          <div className="notes">
            <div className="n">1</div>
            <div>Objects are found by voxel occupancy and matched by size and overlap. Two similar boxes can be confused.</div>
            <div className="n">2</div>
            <div>The room is assumed rectangular. Anything within 60 cm of a wall is ignored.</div>
            <div className="n">3</div>
            <div>The states are of the Torrance floor. Plants stand in for carts and tools.</div>
            <div className="n">4</div>
            <div>Distances are in metres, in the state&apos;s own frame. Registration residual is about 1 cm.</div>
            <div className="n">5</div>
            <div>Nothing you do here changes a state.</div>
            <div className="n">6</div>
            <div>Next: a real floor, weekly states, and the drift list issued as a work order.</div>
          </div>
          <div className="colophon">Torrance set · captured May–Aug 2026 · build {__GIT_HASH__} · written 4 Sep 2026</div>
        </div>
      </div>
    );
  return null;
}
