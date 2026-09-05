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

/** Notes: one screen over the dimmed room, esc or Back returns to where you were. */
export function Pages() {
  const { page } = useStore(useShallow((s) => ({ page: s.page })));
  if (page === "footnotes")
    return (
      <div className="page" id="footnotes">
        <div className="t-rader mark">ATLAS</div>
        <Back />
        <div className="links">
          <span className="on">Notes</span>
        </div>
        <div className="bento">
          <div className="cell title">
            <div className="kicker">NOTES</div>
            <div className="big">
              Atlas Prototype
              <br />
              <span className="dim">Sep 2026</span>
            </div>
          </div>
          <div className="cell c01">
            <div className="kicker">01 · BRIEF</div>
            <div className="text quote">
              Make one thing you’d put in front of Christopher Nolan and Denis Villeneuve. You set the scope. I want to see what you think exceptional
              looks like.
            </div>
          </div>
          <div className="cell c02">
            <div className="kicker">02 · TECHNOLOGY</div>
            <div className="lead">Gaussian splats</div>
            <div className="text">Overlapping photos of a space, reconstructed as one 3D scene at true scale. Measurable, walkable.</div>
          </div>
          <div className="cell c03">
            <div className="kicker">03 · GOAL</div>
            <div className="text">A demo a CEO can run in five minutes without being taught.</div>
          </div>
          <div className="cell c04">
            <div className="col">
              <div className="kicker">04 · CONTEXT &amp; PROCESS</div>
              <ul className="bullets">
                <li>
                  I’ve been interested in working with gaussian splats for a year or two, I took this as an opportunity to do so, I thought this is a
                  great fit.
                </li>
                <li>
                  The garage scans were done in my sister’s garage. It took about 12 runs to get the right 4 output. The process took about a day to
                  learn and get right.
                </li>
                <li>The Bellevue gaussian splat was downloaded off the internet</li>
              </ul>
            </div>
            <div className="media">
              <img src="/notes/process.gif" alt="" />
            </div>
          </div>
          <div className="cell c05">
            <div className="kicker">05 · DESIGN INSPIRATION</div>
            <div className="text">Pinterest board</div>
            <a className="link" href="https://pin.it/Ic7LjgNtx" target="_blank" rel="noreferrer">
              pin.it/Ic7LjgNtx
            </a>
          </div>
          <div className="cell c06">
            <div className="kicker">06 · STACK</div>
            <ul className="bullets">
              <li>Gaussian splats, SPZ</li>
              <li>Spark + three.js</li>
              <li>React, zustand, TypeScript, Vite</li>
              <li>Python pipeline: NumPy, SciPy, Open3D</li>
            </ul>
          </div>
          <div className="cell c07">
            <div className="kicker">07 · ARCHITECTURE</div>
            <ul className="bullets">
              <li>Captures: one gaussian-splat scan per state</li>
              <li>Pipeline: register → diff → bake → publish</li>
              <li>Register: floor and walls, then ICP, into one room frame</li>
              <li>Diff: voxel occupancy, objects tracked across states</li>
              <li>Bake: metric world frame, SPZ and commits.json</li>
              <li>Viewer: store, scene model, three.js + Spark engine, React chrome</li>
            </ul>
          </div>
          <div className="cell c08 accent">
            <div className="kicker">08 · NEXT STEPS</div>
            <ul className="steps">
              <li>Scan a real factory</li>
              <li>Implement a strict and robust design system</li>
              <li>Add documentation entry functionality</li>
              <li>Refine HUD fade in and out behavior</li>
              <li>Split the stage engine: camera, picking and draft as their own modules</li>
              <li>Split the store into room and demo slices</li>
              <li>Unit-test the attention, store, layout and manifest</li>
              <li>Colour splats from a palette in the shader, not per-splat uploads</li>
              <li>Convert to Tailwind</li>
            </ul>
          </div>
        </div>
      </div>
    );
  return null;
}
