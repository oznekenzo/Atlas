import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { landingOf, useStore } from "../store";
import { SLIDES } from "../demo";
import { startTitleField } from "../titleField";

/**
 * The deck: the name over the point field, then one sentence group per slide, then the floor. The captures
 * load behind it from the moment it appears; ENTER is live once the landing state's is in.
 */
export function Title() {
  const { slide, leaving, loaded, landing, nextSlide, prevSlide } = useStore(
    useShallow((s) => ({
      slide: s.slide,
      leaving: s.leaving,
      loaded: s.loaded,
      landing: landingOf(s.manifest),
      nextSlide: s.nextSlide,
      prevSlide: s.prevSlide,
    })),
  );
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => startTitleField(canvas.current!), []);
  const n = SLIDES.length;
  const last = slide === n;
  const ready = loaded[landing] === true;
  const have = loaded.filter(Boolean).length;
  const all = loaded.length > 0 && have === loaded.length;
  return (
    <div id="title" className={slide > 0 ? "on" : ""} onClick={nextSlide}>
      <canvas className="field" ref={canvas} />
      <div className="vignette" />
      <div className="dimmer" />
      <div className="name">
        <div className="mark">
          ATLAS<span aria-hidden="true">ATLAS</span>
        </div>
        <div className="sub">Spatial Version Control</div>
      </div>
      {SLIDES.map((s, k) => {
        const on = slide === k + 1;
        return (
          <div key={s.title} className={`slide${on ? " on" : slide > k + 1 ? " past" : ""}`}>
            <div className="num">
              <span>{String(k + 1).padStart(2, "0")}</span>
              <span>{s.title}</span>
            </div>
            <div className="lead">{s.lead}</div>
            <div className="body">{s.body}</div>
          </div>
        );
      })}
      <div className={`leave${leaving ? " on" : ""}`} />
      <div className="foot-l">
        <span className="t-rader">ATLAS</span>
        <span>
          {String(slide).padStart(2, "0")} / {String(n).padStart(2, "0")}
        </span>
        {!all && (
          <span className="loading">
            loading {have} / {loaded.length || 4}
          </span>
        )}
      </div>
      <div className="foot-r">
        <div
          className={`back${slide > 0 ? "" : " off"}`}
          onClick={(e) => {
            e.stopPropagation();
            prevSlide();
          }}
        >
          BACK
        </div>
        <div
          className={`enter${last && !ready ? " wait" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            nextSlide();
          }}
        >
          {slide === 0 ? "ENTER" : last ? (ready ? "ENTER THE FLOOR" : `LOADING ${have} / ${loaded.length || 4}`) : "CONTINUE"}
        </div>
      </div>
    </div>
  );
}
