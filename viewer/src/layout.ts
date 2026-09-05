/** The grid the room's chrome sits in: two columns and two bands, in CSS pixels. styles.css carries the same numbers. */
export const COL_L = 268;
export const COL_R = 328;
export const BAND_T = 48;
export const BAND_B = 164;
/** The cells the walkthrough can spotlight, from the viewport size. `cmd-*` targets resolve to the bar. */
export const cellOf = (t: string, W: number, H: number): { x: number; y: number; w: number; h: number } | null => {
  const mid = W - COL_L - COL_R;
  switch (t.startsWith("cmd-") ? "bar" : t) {
    case "bar":
      return { x: COL_L, y: 0, w: mid, h: BAND_T + 1 };
    case "rail":
      return { x: COL_L, y: H - BAND_B - 1, w: mid, h: 33 };
    case "map":
      return { x: 0, y: H - BAND_B - 1, w: COL_L + 1, h: BAND_B + 1 };
    case "site":
      return { x: 0, y: 0, w: COL_L + 1, h: BAND_T + 1 };
    case "room":
      return { x: COL_L + 1, y: BAND_T + 1, w: mid, h: H - BAND_T - BAND_B - 1 };
    default:
      return null;
  }
};

const BRANCH_FR = 0.8; // a branch cell against a state cell
/**
 * The rail's and the details' columns, as one grid: the states share the width equally, the branches after them
 * a little narrower, and a set with fewer than four cells keeps a quarter each (an empty track fills the rest).
 * The details' first two cells stay under the first two states, so the hairlines meet.
 */
export const railColumns = (states: number, branches: number): { rail: string; details: string } => {
  const used = states + branches * BRANCH_FR;
  const units = Math.max(4, used);
  const spare = units - used;
  const rail = [
    ...Array(states).fill("minmax(0, 1fr)"),
    ...Array(branches).fill(`minmax(0, ${BRANCH_FR}fr)`),
    ...(spare > 0 ? [`minmax(0, ${spare}fr)`] : []),
  ].join(" ");
  const details = `minmax(0, 1fr) minmax(0, 1fr) minmax(0, ${units - 2}fr)`;
  return { rail, details };
};
