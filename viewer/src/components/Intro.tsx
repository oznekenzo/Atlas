import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";

const clock = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "--:--" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
};

/**
 * The title card. The load is the intro: each commit writes its log line as it lands, the room fades in behind,
 * and nothing else in the chrome shows until the user begins. Stays mounted (hidden) so the exit is a CSS fade.
 */
export function Intro() {
  const { intro, status, M, loaded, begin } = useStore(
    useShallow((s) => ({ intro: s.intro, status: s.status, M: s.manifest, loaded: s.loaded, begin: s.begin })),
  );
  if (status === "error") return null;
  const done = M !== null && loaded.every(Boolean);
  return (
    <div id="intro" className={intro ? "" : "gone"} aria-live="polite">
      <div className="wordmark">STATE ATLAS</div>
      <div className="thesis k">git for the physical world</div>
      <div className="log">
        {M?.commits.map((c) =>
          loaded[c.index] ? (
            <div key={c.id} className="row">
              <span className="hh">{c.hash}</span>
              <span className="tt">{clock(c.captured)}</span>
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
  );
}
