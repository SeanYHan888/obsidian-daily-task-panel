# Manual project order lives in frontmatter, never in the panel

Backlogs sort by a fixed rule (deadline soonest first, then now → next → later, then name). Users want to place a project where they want it — a `later` project actually being worked on sits at the bottom — so the panel gains a hand-arranged order (#20). Where that order lives is the decision.

**Decision: an integer `order` key in each project note's frontmatter**, read and written through the project store like `status` and `deadline`, not journaled. Ranked projects lead the list by `order` ascending; unranked ones follow under the pacing rules; an arrived deadline overrides everything (a commitment that has come due is never buried by a hand-arranged order). Ranks are sparse integers — a move writes only the notes involved (top is min − 1); the one act that renumbers everything 1..n is the Backlogs menu's Organize by status, which groups by status tier while keeping the order inside each tier (idempotent). A transition to `now` writes the top rank, so what was just committed to is what is seen first.

**Rejected: an ordered list of note paths in `data.json`.** It is exactly the derived state ADR-0001 forbids: it drifts when a note is renamed or moved outside the panel, it is invisible to Bases and to a plain-text reader of the note, and it would make the panel the only thing that knows the order. Frontmatter keeps markdown as the database; Bases can sort by the same key; a user can fix a rank in the note by hand.

**Rejected: order within status tiers.** The requirement was that a `later` project can be moved above `now` ones; tiers would forbid it. Organize by status is offered as an act instead of a constraint.

Consequence: `order` joins `status` and `deadline` as the project frontmatter Daily Task Panel owns writes to (ADR-0004's interop list). Drag-to-reorder headers (#21) writes the same key through the same core arithmetic (`core/order.ts` `placeWrites`), so there is no second write path; a dragged header carries a different payload from a dragged row, and arrived-deadline projects neither lift nor land.
