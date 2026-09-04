/**
 * When a commit was captured. HEAD is the present: a commit whose `captured` is the literal "today" is dated
 * the day the viewer is opened. Commits are years apart, so every display is a date, never a time of day.
 */
export const TODAY = "today";

export const capturedAt = (captured: string): Date | null => {
  if (captured === TODAY) return new Date();
  const d = new Date(captured);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** "14 Jun 2012", or "today" for HEAD's present. */
export const dateOf = (captured: string): string => {
  if (captured === TODAY) return TODAY;
  const d = capturedAt(captured);
  return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "undated";
};

/** Just the year, for the log that writes itself on the title card. */
export const yearOf = (captured: string): string => {
  const d = capturedAt(captured);
  return d ? String(d.getFullYear()) : "————";
};
