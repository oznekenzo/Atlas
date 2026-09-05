# ATLAS — the domain

Spatial version control for gaussian-splat captures of a room. The words below are the ones the code uses.

- **Capture** — one gaussian-splat scan of the room. The pipeline registers captures into one frame.
- **State** — a capture as the viewer shows it: dated, numbered, one per month in the demo. The old word was commit.
- **Standard** — the one state declared the approved layout. There are exactly two kinds of state: the standard, and every other.
- **Object** — a detection in one state: a labelled cluster of splats with an id, a name and a box. When a thing moves, the tracker gives it a new object id and links the two (`moved_from` / `moved_to`).
- **Thing** — one physical object across states: the chain of object ids it wears. `scene.ts` owns this.
- **Diff** — two states read together: for each thing, same, moved (with the distance), added, removed. One definition, in `scene.ts`: the same thing standing more than 5 cm from where it stood is a move, whether or not it was re-labelled.
- **Drift** — the diff whose earlier state is the standard, worded as what the later state must do to match: keep, move, remove, add.
- **Standing** — one thing's relation to the standard at a state: where the standard has it, off by N m, missing, not in the standard.
- **Draft** — a layout tried on the empty floor: things placed by hand, from scratch or from a state used as a template. Measure counts what is down. Save keeps it as a branch; esc discards what is unsaved.
- **Branch** — a saved draft: a layout proposal kept beside the states and shown after them in the timeline, dashed. Held in the browser per set (`localStorage`, `atlas.drafts.<set>`), cleared by Restart demo. Never a state: nothing is written back to the captures.
- **Entry** — the written record kept with a state, a diff or an object: what happened, and who signed it.
- **Reflog / actions** — every action taken, with a snapshot of the state after it; any entry restores. Branches are not in the snapshot, so a restore never undeletes one; an entry from a deleted branch reopens as an unsaved draft.
- **Site** — one floor on the picker, with the set of states behind it. Picking another floor empties the room under the curtain and opens that set; the log starts over there. `store.ts` owns the switch (`set`), the engine follows it.
- **Scene model** — `viewer/src/scene.ts`: the pure module that decides things, diffs, drift, standing and months. The engine, the panels, the card, the month block and the map read it and never re-derive it.
