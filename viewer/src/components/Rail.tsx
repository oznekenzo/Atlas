import { useStore } from "../store";

const stamp = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).toUpperCase();

export function Rail() {
  const { manifest: M, head, mode, loaded, checkout, diff } = useStore();
  if (!M) return null;
  const d = mode.kind === "diff" ? mode : null;
  return (
    <div id="rail">
      <div className="line" />
      {d && <div className="bracket" style={{ left: 96 * d.a + 48, width: 96 * (d.b - d.a) }} />}
      {M.commits.map(c => (
        <div key={c.id} className={`dot${c.index === head && !d ? " active" : ""}${loaded[c.index] ? "" : " pending"}`}
          onClick={(e) => (e.shiftKey && mode.kind !== "onion") ? diff(head, c.index) : checkout(c.index)}>
          <i />
          <div className="tip"><div className="hh">{c.hash}</div><div className="mm">{c.message}</div><div className="tt k">{stamp(c.captured)}</div></div>
        </div>
      ))}
    </div>
  );
}
