import { useShallow } from "zustand/react/shallow";
import { LAST_SLIDE, useStore } from "../store";
import { yearOf } from "../time";

/**
 * The deck. Two cards, then the log: each commit writes its line as it lands, the room waits dimmed behind,
 * and nothing else in the chrome shows until the user begins. Enter turns a card; → begins from the log.
 * Stays mounted (hidden) so the exit is a CSS fade.
 */
export function Intro() {
  const { intro, slide, status, M, loaded, advance, begin } = useStore(
    useShallow((s) => ({ intro: s.intro, slide: s.slide, status: s.status, M: s.manifest, loaded: s.loaded, advance: s.advance, begin: s.begin })),
  );
  if (status === "error") return null;
  const done = M !== null && loaded.every(Boolean);
  const onLog = slide >= LAST_SLIDE;
  return (
    <div id="intro" className={intro ? "" : "gone"} aria-live="polite">
      {slide === 0 && (
        <div className="card" key="name">
          <div className="wordmark">TRACE SYSTEMS</div>
          <div className="thesis k">spatial version control</div>
        </div>
      )}
      {slide === 1 && (
        <div className="card" key="for">
          <div className="line">For home &amp; factory.</div>
        </div>
      )}
      {onLog && (
        <div className="card" key="log">
          <div className="wordmark">TRACE SYSTEMS</div>
          <div className="thesis k">spatial version control</div>
          <div className="log">
            {M?.commits.map((c) =>
              loaded[c.index] ? (
                <div key={c.id} className="row">
                  <span className="hh">{c.hash}</span>
                  <span className="tt">{yearOf(c.captured)}</span>
                  <span className="mm">{c.message}</span>
                </div>
              ) : null,
            )}
            {!done && <div className="row cursor">▍</div>}
          </div>
        </div>
      )}
      {!onLog && (
        <div className="begin k" onClick={advance}>
          enter&nbsp;&nbsp;↵
        </div>
      )}
      {onLog && M && loaded[0] && (
        <div className="begin k" onClick={begin}>
          →&nbsp;&nbsp;begin
        </div>
      )}
    </div>
  );
}
