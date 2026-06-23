# Migrating Between Languages — Practice Tasks

Seven reasoning-and-design exercises. There's almost no code here — migration is a judgment discipline, and these tasks force you to make the calls: design a strangler-fig migration, build (or kill) a business case, plan shadow validation, sequence a cutover, and dismantle a doomed big-bang plan. Each task includes acceptance criteria so you can grade your own reasoning.

---

## Task 1 — Design a strangler-fig migration

**Scenario.** `OrderFlow` is a 6-year-old Python (Django) monolith handling e-commerce orders: browse catalog, add to cart, checkout/payment, order history, admin reports, and a nightly settlement batch job. It's hitting CPU limits; the team is now Go-first and wants to migrate. It serves 2,000 req/s and writes to one Postgres database. There is no appetite for a feature freeze.

**Objective.** Produce a strangler-fig migration plan: where the facade goes, what the first slice is and why, and how the old system shrinks to zero.

**Deliverables.**
- A diagram (ASCII is fine) showing the facade/router in front of Python and Go.
- An ordered list of slices to migrate, each labeled vertical (user-nameable) not horizontal (technical layer).
- A justification for your *first* slice choice and your *last* slice choice.
- The transitional data strategy (shared DB? dual-write?) and when it ends.

**Acceptance.**
- [ ] A facade exists from day one and initially routes 100% to Python (no behavior change).
- [ ] The first slice is **read-only and low-risk** (e.g. `GET /orders/{id}` or catalog browse), with a stated reason.
- [ ] Payment/checkout and the settlement batch are migrated **last**, with a stated reason (money + irreversibility).
- [ ] Every slice is a vertical capability, not "all the DB access" or "all the templates."
- [ ] The plan never requires a feature freeze, and the old system reaches 0% routed before deletion.

**Trap to avoid.** Slicing by technical layer ("first migrate the data layer, then the service layer"). That can't be cut over or validated independently — it's a big-bang in disguise.

---

## Task 2 — Build the business case (justify the migration)

**Scenario.** Your team runs a revenue-critical service in **Scala**. Symptoms: a senior Scala req has been open 11 months; two of the four engineers who know it best left this year; the remaining build is slow and onboarding takes 3 months. Leadership asks: "Why should we spend a year of team capacity moving this to Kotlin/JVM instead of shipping the roadmap?"

**Objective.** Write the one-page business case — in leadership's currency, not engineering aesthetics.

**Deliverables.**
- The justification category (EOL / unhireable / security / cost / talent flight) and the *quantified* version of it.
- The opportunity-cost framing (what the team won't ship).
- Why a migration beats the alternatives (refactor in place? wrap it? hire harder?).
- A revisit/kill trigger.

**Acceptance.**
- [ ] The case is stated in money/risk/time, never "Kotlin is nicer."
- [ ] At least one number is attached (vacancy duration + revenue exposure of the under-owned service, onboarding cost, bus-factor risk).
- [ ] Opportunity cost is named explicitly ("N engineer-months not on the roadmap").
- [ ] The case honestly addresses why *not* refactor-in-place (here: the problem is the *talent market*, which refactoring can't fix — a legitimate language-level liability).
- [ ] A measurable kill trigger is included (e.g. "if we fill the Scala req and retain the team, we pause").

**Trap to avoid.** A case that would equally justify migrating *any* working system. If "the code is old and we'd enjoy Kotlin" is the real argument, you've failed the task — that's an aesthetic, not a business case.

---

## Task 3 — Build the KILL case (argue against a proposed rewrite)

**Scenario.** A respected engineer proposes rewriting your stable, profitable PHP monolith in Rust. Their reasons: "PHP is a mess, Rust is memory-safe and fast, and the codebase is hard to read." The monolith works, is fully staffed, and you can hire PHP developers easily. Traffic is comfortably within capacity.

**Objective.** Write the case to *not* do this rewrite — respectfully and on the merits.

**Deliverables.**
- A point-by-point rebuttal of each stated reason.
- The opportunity-cost argument.
- The cheaper alternatives that address the real pain.
- The conditions under which you *would* reconsider (so it's not just "no").

**Acceptance.**
- [ ] "It's a mess" is answered with: bad design survives translation; refactor in place; reading code is harder than writing it.
- [ ] "Fast/safe" is answered with: profile first — is performance or a memory bug actually a problem here? (Traffic is within capacity, so likely no.)
- [ ] "Hard to read" is answered with: documentation/onboarding gap, not a language problem; a rewrite destroys the embedded knowledge rather than capturing it.
- [ ] Opportunity cost is quantified at least roughly (a multi-year Rust rewrite vs. the roadmap).
- [ ] You name a *real* trigger that would flip your answer (e.g. "if we couldn't hire PHP devs, or hit a security/EOL wall").

**Trap to avoid.** Dismissing the proposer ("Rust fanboy"). The strong version engages each technical claim and shows the *fix is cheaper than the migration* — and concedes the conditions that would change your mind.

---

## Task 4 — Design a shadow-traffic validation plan

**Scenario.** You're about to migrate the `GET /pricing/quote` endpoint (computes a price with taxes, discounts, and currency conversion) from Java to Go. It's high-traffic, read-only, and *full* of accumulated edge cases (regional tax rules, promo stacking, rounding). You must not ship the Go version until you trust it.

**Objective.** Design the shadow-traffic plan that earns that trust.

**Deliverables.**
- The request/response flow showing what the *user* sees vs. what gets mirrored and compared.
- The comparison logic: what counts as a "match," how you handle expected differences (e.g. a timestamp field).
- The cutover gate: the specific condition on the diff metrics that lets you flip the route.
- The rollout shape after cutover, and the rollback trigger.

**Acceptance.**
- [ ] The user always receives the **old (Java)** response; the Go response is discarded during shadowing.
- [ ] Both systems run on the same live requests, and responses are diffed in the background.
- [ ] You define "match" precisely and exclude known-irrelevant fields (request id, timestamp) from the diff.
- [ ] The cutover gate is concrete: e.g. "diff rate < 0.1% sustained over 7 days, and 100% of remaining diffs root-caused (and where the *old* system is wrong, documented)."
- [ ] Post-cutover ramp is gradual (1%→10%→50%→100%) with an automatic rollback trigger on error/diff spikes.

**Bonus.** Name the failure mode where the diff *can't* reach zero (the new system genuinely can't reproduce a behavior because the requirement was never understood) and say what you'd do (stop, investigate the requirement — don't force the cutover).

---

## Task 5 — Sequence a component-by-component cutover

**Scenario.** A logistics platform must move from Ruby to Go. Components: (A) public read-only tracking page, (B) carrier rate lookup (read-only, calls external APIs), (C) shipment creation (writes, money), (D) the address-book CRUD, (E) the nightly invoice-settlement batch job (writes, money, irreversible), (F) internal admin dashboard.

**Objective.** Produce a defensible migration *order* for these six components and justify it.

**Deliverables.**
- An ordered list (first → last) of A–F.
- For each, a one-line reason tied to **risk** (read vs. write, money, reversibility) and **value/learning** (traffic volume, harness-building).
- A note on which components share data and how that constrains ordering.

**Acceptance.**
- [ ] **Read-only, low-stakes, high-traffic** components come first (A and F are strong openers; A builds the harness on real traffic safely).
- [ ] **Money-touching writes** (C) and especially the **irreversible batch** (E) come last.
- [ ] The reasoning explicitly trades off "learn fast / low blast radius first" against "highest irreversibility last."
- [ ] Shared-data coupling is acknowledged (e.g. C and E both touch shipment/invoice state, so they're sequenced with that dependency in mind).
- [ ] No step requires migrating everything at once.

**Discussion.** There's no single right answer, but any order that migrates the irreversible money batch (E) *first* is wrong — explain why (you'd be betting the riskiest, least-reversible component on the least-mature harness).

---

## Task 6 — Critique a doomed big-bang plan

**Scenario.** A plan lands on your desk:

> *"We'll build the new TypeScript version of the platform in parallel over the next 18 months with a dedicated 'Migration Team' of 6 engineers. The product teams keep building features on the old Python system meanwhile. At the 18-month mark we cut over to the new system in a single weekend release. Data will be migrated during the cutover weekend. We'll freeze no features."*

**Objective.** Identify every failure mode in this plan and rewrite it into something survivable.

**Deliverables.**
- A list of the specific anti-patterns, each named.
- The consequence each one produces.
- A rewritten plan that fixes them.

**Acceptance — you should catch at least these:**
- [ ] **Big-bang cutover** ("single weekend") → the all-new-bugs cliff; no incremental validation; rollback is enormous. Fix: strangler fig, slice by slice.
- [ ] **Moving target** → product teams add features to Python for 18 months, so the migration target never stops moving and the new system is always behind. Fix: forcing function — new features land in the new system; freeze *additions* to the old one (this is *not* a feature freeze, it's a one-way ratchet).
- [ ] **The "Migration Team" anti-pattern** → split ownership from domain knowledge; low-status backwater; first defunded. Fix: embed migration in owning teams + a central enablement group.
- [ ] **Data migrated in the cutover weekend** → the hardest, most irreversible work crammed into the riskiest moment. Fix: online data migration (expand/contract, dual-write, backfill, reconcile) done *incrementally and first*.
- [ ] **"No features frozen" claim is incoherent** with parallel-build-then-flip — either you double-build every feature (impossible for 6 people) or the old system diverges. Fix: the strangler lets feature work continue *because* slices move one at a time.

**Bonus.** Estimate how this plan actually ends if shipped as written (most likely: slips past 18 months, the cutover weekend fails or is aborted, the program loses funding, and you're left running two systems indefinitely).

---

## Task 7 — Decide: migrate, wrap, refactor, or leave alone

**Scenario.** Four systems, four decisions. For each, choose **migrate / wrap / refactor-in-place / leave alone**, and justify in one paragraph.

1. A COBOL mainframe banking core: works flawlessly, processes billions, almost no one left who can modify it, but it rarely needs modification.
2. A Python 2 internal tool: Python 2 is EOL (no security patches), the tool handles customer PII, actively developed.
3. A 50k-line Java service that's "ugly" and slow on one endpoint; team knows Java well; traffic is growing but within capacity.
4. A Perl reporting script nobody understands, run weekly, that occasionally produces wrong numbers.

**Acceptance.**
- [ ] **(1) Wrap (or leave alone) — do NOT migrate.** It works, change is rare, and a rewrite of a flawless billions-scale core is pure downside. Put a clean API/service layer in front if integration is the pain; otherwise leave it.
- [ ] **(2) Migrate.** EOL + PII + active development = the language/runtime *itself* is a security liability no refactor can fix. This is a textbook justified migration (cf. the real-world Python 2→3 EOL pressure).
- [ ] **(3) Refactor in place.** "Ugly" is design, not language; the team knows Java; profile and fix the one slow endpoint. A migration here would be pure aesthetics — the kill-case scenario.
- [ ] **(4) Refactor/rewrite the *script*, not the language — and add tests.** The real defect is correctness + comprehension, not Perl. A tiny weekly script is cheap to rewrite *with* a shadow/diff check against the old output; this is the rare case where a small rewrite is reasonable, but the goal is captured knowledge + correctness, not "escape Perl."

**Discussion.** The point of this task: the *language* is the right thing to change in only one of the four (case 2). The others are design, performance, or knowledge problems wearing migration clothing — exactly the discrimination a senior is paid to make.

---

## Summary — how to grade yourself

| If your instinct was… | Re-read |
|---|---|
| "Rewrite it, it's a mess" | `junior.md` §2, §4 (the mess is knowledge; Spolsky) |
| "Big cutover at the end" | `middle.md` §2 (why big-bang fails) |
| "We'll do the data at the end" | `senior.md` §3 (data is the hard, irreversible half) |
| "Spin up a migration team" | `professional.md` §3 (embed, don't quarantine) |
| "Migrate because the new language is better" | `senior.md` §1, `professional.md` §1 (business case, not aesthetics) |

---

**Memorize this:** in every one of these exercises the winning move is the same shape — *don't migrate unless the language itself is the liability; when you do, go incremental (strangler + shadow + data-first + instant rollback), justify it in business terms, embed it in owning teams without freezing the business, and pre-commit to kill criteria.* If your plan has a cutover cliff, a migration team, or end-of-project data migration, you've designed the failure mode, not the migration.
