# Migrating Between Languages — Interview Q&A

A set of questions on language migration, from a mid-level "how would you move this service?" up to a staff-level "here's a 1M-line legacy monolith, give me the strategy." The interviewer is testing whether you fear migration appropriately, whether you reach for incremental patterns by reflex, and whether you can reason about the parts that aren't code — data, organization, and money. Each answer includes **what a strong response signals.**

---

## Section A — Fundamentals (1-4)

**Q1. What makes migrating a system to a new language so risky compared to normal feature work?**

A: The risk is asymmetric. Normal work adds value, so the upside is real and the downside is bounded. A migration, done *perfectly*, delivers parity — the user notices nothing — so there's essentially no upside, while every possible deviation is a regression. You're rebuilding software that already works, and the working version contains years of undocumented bug fixes and edge-case handling that the clean rewrite doesn't know about yet. You'll be forced to relearn every one of them, in production. It's a game where you can mostly only lose points.

*Signals:* Understands migration is downside-dominated and that "ugly old code" encodes irreplaceable knowledge. A weak answer treats a rewrite as straightforward "same logic, new syntax."

---

**Q2. A teammate says "this legacy code is a mess, let's just rewrite it from scratch." How do you respond?**

A: I'd slow it down. First, "mess" is often a *reading* problem — it's harder to read code than to write it, so old code always looks worse than it is. Second, a rewrite throws away years of bug fixes and recreates them from scratch; bad design also tends to survive translation, so a mess in one language is frequently a mess in the next. I'd ask: is the pain the *language* or just the design? If it's design, we refactor in place — far cheaper. If we truly must replace it, we do it incrementally with a strangler fig, never a big-bang. The canonical warning here is Joel Spolsky's "Things You Should Never Do," where Netscape's from-scratch rewrite handed the browser market to Microsoft.

*Signals:* Reflexively prefers refactor-or-wrap over rewrite, knows the Spolsky/Netscape lesson, distinguishes language pain from design pain.

---

**Q3. Explain the strangler fig pattern.**

A: Named by Martin Fowler after a vine that grows around a host tree until the tree dies and the fig stands in its place. You put a facade — a router, gateway, or proxy — in front of the existing system, and initially it forwards 100% of traffic to the old code. Then you replace functionality one slice at a time: build the new-language version of a slice, route that slice to it, leave everything else on the old system. The old system shrinks as the new one grows, and at no single moment does the whole thing switch over. When nothing routes to the old system anymore, you delete it.

*Signals:* Can name the pattern, explain the facade as the control point, and articulate that the value is *never being all-or-nothing*. Bonus for noting you can roll a slice back by flipping the routing rule.

---

**Q4. Why do big-bang rewrites fail so reliably?**

A: Three mechanisms. One, the feature freeze: while you rewrite, the old system can't get features without building them twice, so the business stalls for months or years — that's what killed Netscape. Two, the moving target: the old system keeps changing (bug fixes, new regulations), so the rewrite chases a spec that won't hold still. Three, the all-new-bugs cliff: on cutover day you replace a system full of battle-tested edge-case fixes with one that has none, so every edge case re-breaks at once, in production, under full load. Incremental migration avoids all three.

*Signals:* Gives *mechanisms*, not just "it's risky." Connecting the feature freeze to a real outcome (Netscape) is a strong sign.

---

## Section B — Mechanics (5-8)

**Q5. How would you migrate a single service from Python to Go?**

A: Incrementally, behind a facade. (1) Put a router in front of the Python service; day one it forwards everything to Python — no behavior change, but now I have a control point. (2) Pick the first slice: a read-only, low-risk, high-traffic endpoint, so there's no data-corruption risk and the shadow comparison gathers data fast. (3) Build the Go version and **shadow** it — mirror live traffic to both, return Python's answer to users, diff the responses in the background, and fix Go until the diff is near zero on real data. (4) Cut over by flipping the routing rule, keeping instant rollback ready, and ramp 1%→10%→100%. (5) Repeat endpoint by endpoint, saving write paths and money-touching paths for last. (6) Delete Python when nothing routes to it. Crucially, feature work never freezes.

*Signals:* Reaches for strangler + shadow + gradual rollout unprompted, sequences read-before-write and low-risk-first, and explicitly preserves feature velocity.

---

**Q6. What is shadow traffic / a parallel run, and why is it so valuable in a migration?**

A: You send each live request to *both* the old and the new system, return the old (trusted) system's response to the user, and discard the new system's response — but compare the two in the background. Because the new output is thrown away, a bug in it can't hurt anyone, yet you learn exactly where new disagrees with old, on real production data, before you trust it. You don't cut a slice over until the diff rate is near zero and the remaining diffs are understood — and often you discover the *old* system was the buggy one. It's automated diff testing against the source of truth, and it's the strongest de-risking tool available. GitHub's Scientist library was built for exactly this.

*Signals:* Understands the user never sees shadow output, that the diff is the deliverable, and that "near-zero understood diffs" is the cutover gate. Bonus for naming Scientist or noting old-system bugs surface this way.

---

**Q7. What's an anti-corruption layer and why do you need one during migration?**

A: It's a translation boundary between the new system's clean model and the old system's legacy model. The legacy data is full of weirdness — money as a string, status as a magic integer, dates in three formats. Without a barrier, those concepts leak into the new code and you end up with the old mess in a new language, which defeats the migration. The ACL is an adapter that maps the ugly legacy model to the clean new one (and back), keeping the legacy design from corrupting the new design.

*Signals:* Knows the migration's *point* is escaping the old design, and that without an ACL you just port the mess. Connects it to DDD vocabulary.

---

**Q8. What's usually the hardest part of a migration — and why do people underestimate it?**

A: The data and state, not the code. Code is stateless: you can run old and new side by side, diff them, and roll back in seconds. Data can't be rolled back once transformed — it's terabytes in a schema shaped by the old system's assumptions, and converting it (online, without downtime, while both systems are live and consistent) is the most bug-prone, least reversible work in the whole project. People underestimate it because they picture the code, which is the easy half. My rule: plan the data migration *first*, because it constrains everything else, and treat "just the data left" as meaning you're at best halfway.

*Signals:* Identifies data as the hard, irreversible half; mentions online migration / dual-write / backfill / reconciliation; plans data first.

---

**Q8b. During a strangler migration, what's the safe way to handle the *write* paths and the database?**

A: Two distinct problems. For *write paths*, you can't naively mirror traffic to shadow them — the new system would re-charge the card or re-send the email. So you shadow only the *computation*: compute what the new code *would* write and diff it against what the old code actually wrote, without performing the side effect twice. For the *database*, the clean end-state is each system owning its data, but during migration old and new usually share a store or dual-write to keep consistent. Sharing is deliberate, temporary scaffolding; I'd put an anti-corruption layer between the new model and the legacy schema so the old data shapes don't leak into the new design, and I'd run a reconciliation job that continuously diffs the two stores so divergence is caught while the old store is still the source of truth.

*Signals:* Distinguishes read-shadowing from write-shadowing, treats the shared DB as temporary scaffolding (not the goal), and reaches for reconciliation. A weak answer mirrors writes and double-charges.

---

## Section C — Judgment & Org (9-12)

**Q9. When would you decide NOT to migrate at all?**

A: Most of the time. A migration, done perfectly, only buys parity, so its real cost is opportunity cost — the features those engineer-years won't ship. So I push the alternatives first: if the problem is "messy code," refactor in place (the mess survives translation anyway); if it's "too slow," profile it (the bottleneck is usually a query, not the language); if it's "we want language X's features," add X for *new* services at the seams instead of rewriting the working core; if it's "nobody understands it," that's a docs/onboarding gap. I only replace when the *language itself* is the liability — it's end-of-life, genuinely unhireable, a standing security/compliance risk, or blocking the business in a way no refactor can.

*Signals:* Defaults to *don't migrate*, separates language problems from design/perf problems, and frames the cost as opportunity cost. This is the strongest senior signal in the set.

---

**Q10. Staff-level: We have a 1M-line legacy Perl monolith running the core business. Lay out a migration strategy.**

A: First, I'd challenge the premise: does the *language* need to change, or just the architecture? If Perl is genuinely the liability — EOL risk, can't hire, security — then:

- **Justify it in business terms** and quantify (hiring vacancy + revenue exposure, security/audit risk, compute cost). If I can't, I don't fund it.
- **Strangler fig, never big-bang.** Put a facade/gateway in front of the monolith. Carve it into vertical, user-nameable slices (auth, billing, reporting), not technical layers.
- **Sequence by risk and value:** low-risk read paths first to build the harness and team confidence; money-touching write paths last. Within each slice, shadow-traffic + diff against Perl, gradual rollout, instant rollback.
- **Data is the hard part — plan it first.** Expand/contract schema, dual-write with reconciliation, online backfill. Decide the source of truth for each entity during the cutover window.
- **Organize by embedding,** not a quarantined "migration team": the teams that own each domain migrate their slice with a central enablement group providing the facade, diff harness, and paved-road platform.
- **Protect velocity:** cap migration at a fraction of capacity so the business keeps shipping; otherwise the program gets defunded at 70% and we run two systems forever.
- **Forcing function:** freeze new feature work onto Perl (everything new lands in the target language), set a credible, leadership-backed shutdown date, and track per-team % migrated.
- **Kill criteria up front:** if the justification expires, payback moves out of reach, capacity never materializes, or fidelity won't converge, we stop and formalize a hybrid.

The headline: it's a multi-year *program*, run incrementally so it delivers value and can stop at any point with a working system — not a heroic rewrite with a cutover cliff.

*Signals:* Operates at program level — business case, org structure (embed vs. quarantine), data-first, forcing functions, kill criteria — while keeping the engineering core (strangler + shadow + rollback) intact. Mentioning capacity-capping and abandonment criteria is staff-grade.

---

**Q11. How do you justify a multi-year migration to leadership?**

A: In their currency: money, risk, and time — never aesthetics. Valid cases are end-of-life runtimes (unbounded security risk), unhireability (a 9-month vacancy on revenue-critical code is a continuity risk), security/compliance blockers (auditors kill the enterprise deal), or cost-at-scale (here's the compute bill and the payback period). I quantify each. And I anchor on opportunity cost — "this is N engineer-years we won't spend on the roadmap; reaching parity in a new language has to beat the best alternative use of that time." If the migration can't be expressed in business risk and quantified payback, that's usually a sign it shouldn't be funded.

*Signals:* Translates engineering reality into business language, quantifies, and uses opportunity cost as the anchor. Knowing that "it's more modern" is *not* a case is the tell.

---

**Q12. When and how do you abandon a migration in progress?**

A: When continuing costs more than it returns — and because sunk cost makes that hard to see, I set abandonment criteria *before* starting: the justification expired (the dying language revived, the role became hireable), re-estimated payback moved out of reach, the business will only ever fund capacity too small to finish, or fidelity isn't converging on critical paths. Abandoning is survivable precisely *because* we went incremental — we stop with a working hybrid, document the boundary, and stop pretending it'll complete. A zombie migration nobody will admit is dead is the most expensive outcome of all: you pay the two-system tax forever and never collect the payoff.

*Signals:* Treats stopping as a discipline, not a failure; pre-commits criteria; understands the incremental approach is what makes stopping possible. Naming the "zombie migration / two-system tax" trap is a strong sign.

---

**Q13. How do you stop a long migration from stalling at "80% done" forever?**

A: The last 20% never finishes on its own because the old system *works*, so there's no urgency to kill it — and meanwhile you pay the two-system tax indefinitely, which is the worst state of all. I attack it on three fronts. Technically: make every migrated slice deliver *visible* value (faster, cheaper, fewer pages) so the work isn't invisible and morale holds. Organizationally: a forcing function — freeze new features onto the old system so everything new lands in the target language (a one-way ratchet, not a feature freeze), and set a credible, leadership-backed shutdown date with the old platform's support contract and on-call rotation scheduled to *end*. Visibly: per-team "% migrated" scorecards so the last 20% gets the same attention as the first 80%. The deadline has to be one people believe — a fake deadline teaches the org that migration deadlines are theater.

*Signals:* Knows the last-20% drift problem and the two-system-tax trap, reaches for forcing functions and one-way ratchets, and distinguishes "freeze additions to the old system" from a destructive full feature freeze.

---

**Q14. What's the difference in outcome between Twitter's JVM migration and Netscape's rewrite, and why?**

A: Twitter moved a Rails monolith that was buckling under load onto the JVM (Scala/Java) *incrementally* — search, the message queue, then the serving stack — replacing components behind stable interfaces while the product kept running. Netscape rewrote the browser from scratch in a single multi-year effort, froze features for ~3 years, and lost the market before the rewrite shipped. Same category of decision, opposite outcomes — and the deciding variable wasn't the languages, it was the *strategy*: incremental and business-justified (the platform was falling over) versus big-bang and partly modernization-for-its-own-sake. The general pattern: public successes are strangler-style and ship value along the way; public failures are big-bang and deliver nothing until a finish line they often never reach.

*Signals:* Knows both cases concretely, extracts that *strategy predicts outcome more than language choice*, and ties Twitter's move to a genuine business justification.

---

## Summary — what they're really probing

| Question band | The capability under test |
|---|---|
| Q1–Q4 | Do you *fear migration correctly* and know the rewrite fallacy (Spolsky/Netscape)? |
| Q5–Q8 | Do you reach for **strangler + shadow + ACL + data-first** by reflex? |
| Q9, Q11, Q12 | Can you say **no**, justify in **business terms**, and **stop** a doomed program? |
| Q10 | Can you run it as a **multi-year org program**, not a heroic rewrite? |

---

**Memorize this:** the through-line of every strong answer is *incremental, reversible, business-justified.* Default to not migrating; when you must, strangler-fig it behind a facade, prove each slice with shadow traffic before cutover, plan the irreversible data migration first, embed it in owning teams without freezing the business, and pre-commit to kill criteria. Big-bang + aesthetics is the failure mode (Netscape); incremental + business case is the success mode (Twitter→JVM).
