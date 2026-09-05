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
