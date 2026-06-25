> Practice constraint-driven creativity by *doing it*: redesign things under brutal limits, impose creative constraints to unstick yourself, and separate real constraints from imagined ones. **Global rules for every task:** (1) state your constraint as a *number* or a hard *ban*, not a vibe; (2) for each constraint, label it **essential** or **assumed** and say *who imposed it* and *what breaks if violated*; (3) when a budget blocks you, change the *design*, never the *budget*; (4) write the deliverable down — a few honest sentences beats a perfect imaginary answer.

---

## Task 1 — Unstick a blank page with a constraint

Take a deliberately vague prompt: **"build a link-sharing tool."** Notice the paralysis. Now add three hard constraints — e.g. *no database, one file, handles 100 links* — and design it in 15 minutes.

**Deliverable:** the vague version (1 line) vs. the constrained design (a short sketch). One paragraph on *what the constraint did* to your ability to start.

## Task 2 — The "1/10th" review on your own recent design

Pick a real design you shipped or proposed in the last month. Impose, in turn: **1/10th the RAM**, **1/10th the time**, **1/10th the cost**. For each, write what would have to change.

**Deliverable:** a 3-row table (resource cut → what collapses → what that reveals was gold-plating vs. essential). Mark anything you'd actually now remove from the real design.

## Task 3 — Derive a latency budget, then let it prune the architecture

Goal: "the search page should feel instant." Operationalize it as a number (e.g. **p99 < 100 ms server-side**), then *allocate* the budget across stages (auth, query, serialization, network, headroom).

**Deliverable:** the allocation table, plus one architecture you can now *rule out* purely because it doesn't fit the budget (e.g. three sequential DB hops, a synchronous cross-region call). Cross-check the decomposition method against [reasoning from fundamentals](../../05-first-principles-thinking/01-reasoning-from-fundamentals/).

## Task 4 — Make it 10x cheaper (not 10% cheaper)

Take any system with a running cost (real or hypothetical). **Decompose the cost into its dominant terms** (e.g. egress / compute / storage as rough percentages). Identify which term a 10x reduction *must* attack.

**Deliverable:** the cost decomposition + the single term you'd target + one concrete idea to cut it. State explicitly why optimizing the smallest term is wasted effort.

## Task 5 — Separate real from assumed constraints

List **8 constraints** you currently feel on your work or a current project ("we can't change the schema," "must be microservices," "p99 < 50 ms," "budget $X," etc.).

**Deliverable:** for each, fill `who imposed it | what breaks if violated | real or assumed`. Then pick the most *expensive* assumed constraint and write how you'd verify or dismantle it. Use the method from [questioning assumptions](../../05-first-principles-thinking/02-questioning-assumptions/).

## Task 6 — The "no new dependency / no new service" rule

Take a feature you'd instinctively reach for heavy infrastructure to build (full-text search, a notification system, a job runner). Impose: **"no new datastore/service for v1."**

**Deliverable:** the design that uses *only what you already have*. Then state the *real* constraint (a measured number) that would finally justify the heavy version. If you can't name one, you didn't need it yet.

## Task 7 — Timebox a spike and observe the scope-cutting

Pick a small open problem. Give yourself a **strict 90-minute box** to produce a working-ish answer, then stop — even if rough.

**Deliverable:** what you *cut* to fit the box, and which of those cuts you'd keep cut in the real version. Reflect on how the deadline (a constraint) forced you to find the true MVP hiding in the plan.

## Task 8 — Fit it in 64 KB (the demoscene exercise)

Conceptually design something that must fit in **64 KB total** — a tiny game world, a generative art piece, a data viz. You can't *store* much; you must *generate*.

**Deliverable:** what you'd store as *parameters/code* instead of *assets* (the procedural-generation move). One sentence on how this maps to "don't store what you can compute" in everyday backend work (caching vs. recomputing).

## Task 9 — Impose a constraint on a (hypothetical) team

You're the tech lead. The team is about to over-build. Write the **constraint-based brief** you'd give them: hard budgets as numbers, plus explicit *bans*, plus how each is *enforced*.

**Deliverable:** a short brief — `hard constraints (numeric) | derivation | enforcement (SLO/CI/alarm)`. Contrast it with the weak version ("please keep it simple") and explain why yours forces a better design without you arguing every feature.

## Task 10 — Catch a false constraint in the wild

Find one real rule in your codebase, team, or org that *everyone obeys* but no one can clearly justify ("we always do X," "compliance says Y"). Trace it to its **actual owner and actual reason**.

**Deliverable:** the rule, who you traced it to, and the verdict — real (and now justified) or imagined (and now a candidate to drop). Note how much simpler something gets if it's imagined and you remove it.

## Task 11 — Apply the Saint-Exupéry test

Take a design, config, API, or document you own. Apply *"nothing left to take away"*: aggressively list everything you could **remove** — a flag, an option, an endpoint, a dependency, a paragraph — and check whether it still works without each.

**Deliverable:** the list of removals + which ones you'd actually make. Tie the result to "creativity from removing options, not adding them."

## Task 12 — Redesign Twitter's constraint

Twitter's 140 (later 280) characters came from SMS limits. **Pick a different limit** — 50 characters, 500, voice-only, image-only — and reason about how the *product* would change.

**Deliverable:** for two different constraints, one paragraph each on how the constraint would reshape the product's identity. Conclude with why "the limit shapes the product, not just the message."
