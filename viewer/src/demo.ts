/**
 * The demo's script: the title deck's slides, the checklist a first-time user works through, the tour that
 * names the controls, and the start presets (?s=<name>) that open the room in any state for testing.
 */
import type { Mode } from "./store";
import type { Proposal } from "./drafts";

/** The state the deck lands in: the second month, June 2026, the floor with its first stations in. */
export const LANDING = 1;

export type Slide = { title: string; lead: string; body: string };
export const SLIDES: Slide[] = [
  {
    title: "TECH",
    lead: "Gaussian splatting arrived in 2023.",
    body: "Many overlapping photos of a space are stitched into a single 3D reconstruction, at true scale, viewable from any angle. Unlike photo or video, it can be measured and walked through.",
  },
  {
    title: "PROJECT",
    lead: "Atlas is a speculative design for the modern factory built on this technology.",
    body: "The floor is captured with a camera in a walk or drone sweep during off hours, weekly or monthly.",
  },
  {
    title: "PROBLEM",
    lead: "Factories are laid out to a standard.",
    body: "Tools, carts and materials drift from it, and nobody notices until a job is blocked or a changeover runs long. Today the check is a person walking the floor. ATLAS measures the drift from the standard every month, for everything on the floor.",
  },
  {
    title: "FUNDAMENTALS",
    lead: "With ATLAS, space is software and follows software fundamentals.",
    body: "A space is captured and versioned. Its machinery, tools, their layout and its changes are documented thoroughly by their maintainers.",
  },
  {
    title: "DEMO",
    lead: "In this demo, a floor is captured once a month.",
    body: "Four months. The third is the approved layout: the \u201cstandard\u201d. Move through the months. Diff their spatial states. Compare against the standard. See how far the floor has drifted from the standard. Draft a new layout proposal and save it as a branch. Tour a remote factory.",
  },
];

export type Goal = { id: string; label: string; target: string; hint: string };
export const GOALS: Goal[] = [
  { id: "ui", label: "Understand the UI", target: "bar", hint: "" },
  { id: "move", label: "Move through states", target: "cmd-fwd", hint: "Press \u2192 or click Next state to go to the next month." },
  {
    id: "diff",
    label: "Diff spatial states",
    target: "cmd-compare",
    hint: "Press D. Diff lists what was added, removed and moved between two months.",
  },
  { id: "std", label: "Compare against the standard", target: "cmd-std", hint: "Press C. This overlays the approved layout on the current month." },
  { id: "draft", label: "Draft a layout proposal", target: "cmd-restore", hint: "Press N. Place objects on the floor to propose a new layout." },
  { id: "tour", label: "Tour a remote factory", target: "site", hint: "Open the site menu and select Bellevue. The room becomes that floor." },
];

export type TourStep = { target: string; text: string };
export const TOUR: TourStep[] = [
  { target: "bar", text: "Commands and their keyboard shortcuts. Available commands update in real time." },
  { target: "rail", text: "Timeline. Four monthly captures of this floor. Click a month or use \u2190 \u2192 to switch." },
  { target: "map", text: "Map: the floor from above. Click a thing to open it, click bare floor to stand there." },
  { target: "actions", text: "Actions: what you have done, in order. Any entry restores that moment." },
  {
    target: "room",
    text: "Camera\nOrbit \u00b7 left-click drag\nPan \u00b7 right-click drag, or \u21e7 + left-click drag\nZoom \u00b7 scroll, or \u2318 + scroll for fine control",
  },
  { target: "room", text: "The floor. Click an object to open its details." },
  { target: "goals", text: "The demo checklist. Each item is marked off as you do it." },
];

/** A start state, by name. `?s=<name>` opens the room there; the smoke test and the screenshots use them. */
export type Preset = {
  page: "room" | "footnotes";
  head: number;
  mode?: Mode;
  selected?: number;
  ghosts?: boolean;
  draft?: Proposal;
  history?: boolean;
};
export const PRESETS: Record<string, Preset> = {
  empty: { page: "room", head: 0 },
  explore: { page: "room", head: 2 },
  selected: { page: "room", head: 3, selected: 7 },
  compare: { page: "room", head: 2, mode: { kind: "compare", a: 1, b: 2, headBefore: 2 } },
  drift: { page: "room", head: 3, mode: { kind: "compare", a: 2, b: 3, headBefore: 3 } },
  ghosts: { page: "room", head: 3, ghosts: true },
  "restore-hand": { page: "room", head: 3, ghosts: true, mode: { kind: "draft" }, draft: { base: null, placements: [], attempts: [] } },
  measured: {
    page: "room",
    head: 3,
    ghosts: true,
    mode: { kind: "draft" },
    draft: {
      base: null,
      placements: [
        { id: 0, x: -1.2, z: -1.6 },
        { id: 6, x: -0.6, z: 1.9 },
      ],
      attempts: ["2 placed"],
    },
  },
  footnotes: { page: "footnotes", head: 3 },
  history: { page: "room", head: 3, ghosts: true, history: true },
};
