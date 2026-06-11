# The Mikado Method — Find the Bug

> **Source:** Ola Ellnestam & Daniel Brolund, *The Mikado Method* (Manning, 2014)

Each scenario shows the method applied *wrong*. Diagnose the violation, then prescribe the fix. The bugs here are process bugs, not code bugs — that's the point.

---

## Scenario 1 — The non-reverter

> "I attempted the goal, the build went red in four places, so I fixed the first one. That broke two more, so I fixed those. After an hour I had eleven files changed and the build still broken, but I was 'making progress' so I kept going."

**What's wrong?** The cardinal violation: **didn't revert on red.** Fixing-as-you-go on a naive attempt is the exact mechanism that builds the swamp — each fix spawns new breaks, the broken front grows, and you lose any clean baseline. There's also no graph, so the dependency knowledge is being thrown away while the broken code is being kept — backwards on both counts.

**Fix.** Hard rule: the instant a naive attempt goes red, the *only* legal moves are (a) write each break as a prerequisite node, and (b) **revert to green**. Reset to the last green commit (`git reset --hard HEAD`), draw the four breaks as leaves, recurse into one leaf, and commit only non-breaking changes. Keep the knowledge (graph), discard the code (revert) — not the other way round.

---

## Scenario 2 — Root-first execution

> Graph:
> ```
> [~] GOAL: ReportService takes Repository via ctor
>    ├── [ ] A: PdfRenderer takes Repository
>    └── [ ] B: CsvRenderer takes Repository
> ```
> "I went straight at the GOAL — wired the constructor and tried to make `ReportService` compile, fixing A and B inline as I hit them."

**What's wrong?** **Working root-first.** The goal has unmet children (A, B), so it is *not* a leaf and must not be attempted. Attacking it forces you to fix A and B *inside* the same broken attempt — collapsing three independent, separately-committable steps into one unreviewable, unshippable change. That's the swamp wearing a graph as a disguise.

**Fix.** Enforce "**only attempt a leaf.**" A node with any `[ ]`/`[~]` child is forbidden as a target. Do A (attempt, commit green), then B (attempt, commit green); *only then* does the GOAL become a leaf you may attempt. Each step ships independently.

---

## Scenario 3 — The vague node

> ```
> [ ] Clean up the OrderService config handling
> ```
> "I've been on this node for a day. I keep tweaking things but I can't tell if it's done, so I haven't committed."

**What's wrong?** **Fuzzy, uncheckable node.** "Clean up" has no done-state, so there's no moment at which you can declare it green-and-committed. It becomes a mini-swamp inside one node — endless tweaking, no commit, no progress.

**Fix.** Every node must be a checkable claim. Replace it with something binary: *"`OrderService` reads `taxRate` and `shippingRate` from an injected `Config` field; no `Config.INSTANCE` reference remains in `OrderService`."* Now "done" is a `grep` away, and you can attempt → verify → commit.

---

## Scenario 4 — Goal too big, graph won't shrink

> "Goal: 'Migrate the whole billing module to the new architecture.' I've been drawing the graph for three days. It has 60+ nodes, it's still growing every attempt, and I haven't committed a single leaf because nothing feels safe to ship in isolation."

**What's wrong?** **Goal too big** — it's a program, not a goal. The graph grows without converging because in a tangled module everything depends on everything, so no small leaf is cleanly shippable, and there's no early value. The endless growth is the symptom.

**Fix.** Stop executing; **re-scope**. Slice into independently *shippable* goals: *"`InvoiceGenerator` no longer depends on `LegacyTaxTable`,"* then the next, then the next. Each is a tractable Mikado run that clears in hours-to-days and ships green. The 60-node graph wasn't wasted — it's the dependency evidence that tells you *where* to cut.

---

## Scenario 5 — Committing the unverified leaf

> "Leaf C was obviously safe — just adding an overloaded constructor — so I committed it without running the tests. Next day my revert during leaf D took me back to C's commit and the build was red. Turns out C's new constructor shadowed a Spring `@Autowired` and broke wiring at runtime."

**What's wrong?** **Committed a leaf without verifying green.** "Obviously safe" is not a verified baseline. The unverified commit poisoned the baseline, so the *next* revert returned to broken code — destroying the clean-baseline guarantee the whole method rests on.

**Fix.** Green-or-it-didn't-happen: compile **and** run the relevant tests (including the wiring/integration tests that would catch the `@Autowired` clash) before *every* leaf commit. The only thing that proves a leaf is non-breaking is observing the build go green — never your confidence.

---

## Scenario 6 — Reverting the green leaf

> "Discipline is 'revert,' so after every attempt I reset hard — including the ones that compiled and passed. I keep re-doing the same constructor change every morning and the graph never shrinks."

**What's wrong?** **Mis-applied the rule — reverting on *green*.** The discipline is "revert on **red**." A non-breaking leaf is the work you *keep* — it's the only thing you ever commit. Reverting greens means you never bank progress, so the graph can't shrink and you loop forever.

**Fix.** Split the cases explicitly: red naive attempt → record prerequisite + revert; green non-breaking leaf → **commit and cross off**, then climb. Make the commit the *reflex* on green, so banked progress is automatic.

---

## Scenario 7 — Mining a swamp without a graph

> "Two engineers each pushed through their own breaking migration on the same module, no graphs, on long-lived branches. Now we're three weeks in trying to merge two swamps and reconcile which broke what."

**What's wrong?** **Two swamps + no graph + parallelized without a dependency map.** You cannot parallelize a swamp — there's no clean baseline to branch from and no analysis of what's independent, so the branches inevitably overlap and conflict. The missing graph means there's no record of which prerequisite belongs to whom.

**Fix.** Abandon both branches' *code* (park them for reference only). Establish one green trunk. Draw a *single shared* Mikado graph for the migration; identify independent subtrees and shared serialization-barrier leaves (do the shared ones once, first). Then assign whole subtrees to each engineer, every cleared leaf committed green to trunk — continuous integration instead of a three-week merge. The graph is what makes the parallel work safe in the first place.
