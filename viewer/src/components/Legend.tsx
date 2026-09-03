import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { objectsChanged, useStore } from "../store";

/** Diff summary, derived from the manifest — the engine paints, it does not report. */
export function Legend() {
  const { M, mode, refScale } = useStore(useShallow((s) => ({ M: s.manifest, mode: s.mode, refScale: s.refScale })));
  const stats = useMemo(() => {
    if (!M || mode.kind !== "diff") return null;
    const { added, removed } = objectsChanged(M, mode.a, mode.b);
    const vol = [...added, ...removed].reduce((acc, id) => acc + M.objects[id].volume_vox_m3, 0) * refScale ** 3;
    return { added: added.size, removed: removed.size, volumeM3: vol };
  }, [M, mode, refScale]);
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
      <div className="k" style={{ marginTop: 16 }}>
        {stats.volumeM3.toFixed(2)} m³ changed
      </div>
    </div>
  );
}
