import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { changeSummary } from "../identity";

/** Diff summary, derived from the manifest — the engine paints, it does not report. */
export function Legend() {
  const { M, mode } = useStore(useShallow((s) => ({ M: s.manifest, mode: s.mode })));
  const stats = useMemo(() => {
    if (!M || mode.kind !== "diff") return null;
    const { added, removed, moved } = changeSummary(M.objects, mode.a, mode.b);
    // volume_vox_m3 is already metric (the pipeline scales by metres per ref unit) — do not scale it again
    const vol = [...added, ...removed, ...moved.map((m) => m.to)].reduce((acc, id) => acc + M.objects[id].volume_vox_m3, 0);
    return { added: added.length, removed: removed.length, moved: moved.length, volumeM3: vol };
  }, [M, mode]);
  if (!stats) return null;
  return (
    <div id="legend" className="hud">
      <div>
        <i style={{ background: "var(--add)" }} />
        <span>{stats.added} added</span>
      </div>
      <div>
        <i style={{ background: "var(--rem)" }} />
        <span>{stats.removed} removed</span>
      </div>
      {stats.moved > 0 && (
        <div>
          <i style={{ background: "var(--fg)" }} />
          <span>{stats.moved} moved</span>
        </div>
      )}
      <div className="k" style={{ marginTop: 16 }}>
        {stats.volumeM3.toFixed(2)} m³ changed
      </div>
    </div>
  );
}
