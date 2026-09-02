import { useStore } from "../store";
export function Legend() {
  const { mode, diffStats } = useStore();
  if (mode.kind !== "diff" || !diffStats) return null;
  return (
    <div id="legend" className="hud">
      <div><i style={{ background: "var(--add)" }} /><span>{diffStats.added} added</span></div>
      <div><i style={{ background: "var(--rem)" }} /><span>{diffStats.removed} removed</span></div>
      <div className="k" style={{ marginTop: 16 }}>{diffStats.volumeM3.toFixed(2)} m³ changed</div>
    </div>
  );
}
