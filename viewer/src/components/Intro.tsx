import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { dateOf } from "../time";

/**
 * The intro: the load is the title card. Each commit writes its log line as it lands, the room waits dimmed
 * behind, and nothing else in the chrome shows until the user begins. Stays mounted (hidden) so the exit is a CSS fade.
 */
export function Intro() {
  const { intro, status, M, loaded, begin } = useStore(
    useShallow((s) => ({ intro: s.intro, status: s.status, M: s.manifest, loaded: s.loaded, begin: s.begin })),
  );
  if (status === "error") return null;
  const done = M !== null && loaded.every(Boolean);
  return (
    <div id="intro" className={intro ? "" : "gone"} aria-live="polite">
      <div className="card">
        <div className="t-mark lg">STATE ATLAS</div>
        <div className="thesis k">spatial version control</div>
        <div className="log">
          {M?.commits.map((c) =>
            loaded[c.index] ? (
              <div key={c.id} className="row">
                <span className="hh">{c.hash}</span>
                <span className="tt">{dateOf(c.captured)}</span>
                <span className="mm">{c.message}</span>
              </div>
            ) : null,
          )}
          {!done && <div className="row cursor">▍</div>}
        </div>
        {M && loaded[0] && (
          <div className="begin k" onClick={begin}>
            →&nbsp;&nbsp;begin
          </div>
        )}
      </div>
    </div>
  );
}
