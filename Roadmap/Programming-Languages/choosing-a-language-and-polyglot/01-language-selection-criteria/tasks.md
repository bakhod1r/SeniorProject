# Language Selection Criteria — Practice Tasks

Nine decision exercises. There is no code to write and no compiler to satisfy — the work is *reasoning*, and the deliverable for each task is a short written artifact: a matrix, an ADR, a critique, a recommendation. Every scenario gives you enough detail to actually do the analysis. The discipline being trained is the one the whole topic turns on: **start from the problem and the constraints, make the tradeoffs visible, and write down the *why* so it survives the next argument.**

Difficulty climbs from straightforward matrix-building to org-scale consolidation and adversarial defense.

---

## Task 1 — Build a weighted matrix from scratch *(warm-up)*

**Scenario.** A 12-person startup is building an **internal admin dashboard backend** — CRUD over a Postgres database, ~50 internal users, no meaningful performance requirements. The team's skills: 5 strong in Python, 3 in TypeScript/Node, 2 in Go, 2 generalists. Candidates: **Python (Django/FastAPI)**, **TypeScript (Node)**, **Go**.

**Do this.**
1. List 5–7 criteria appropriate to *this* project (not a generic list — an internal CRUD tool weights differently than a payments engine).
2. Assign weights summing to 100. Justify each weight in one line.
3. Score each candidate 1–5 per criterion. Note *whose* expertise you're scoring.
4. Compute weighted totals and declare a provisional winner.

**Acceptance.**
- [ ] Your weights reflect that this is low-stakes internal CRUD (performance should be a *small* weight; time-to-ship and team fluency large).
- [ ] No criterion where all three candidates score the same survives in the final matrix (it doesn't discriminate — drop it).
- [ ] You can state, in one sentence, which weight is driving the result.

**Trap to avoid.** Don't import a payments-grade criteria list onto a throwaway admin tool. The skill is *tailoring the criteria to the stakes.*

---

## Task 2 — Sensitivity analysis *(warm-up)*

**Scenario.** Reuse your matrix from Task 1. Suppose your provisional winner is Python with a total of 410, and Go is second at 375.

**Do this.**
1. Identify the **flip point**: how much would a single weight have to change for the answer to flip to the runner-up? Show the arithmetic.
2. State whether this decision is *robust* (large weight change needed to flip) or a *close call* (small change flips it).
3. If it's a close call, name the *one criterion* the decision is actually about — and rewrite the recommendation to debate *that* explicitly, instead of presenting the totals as settled.

**Acceptance.**
- [ ] You produce an actual number ("dropping team-fluency from 35 to 22 flips it to Go").
- [ ] You correctly classify the decision as robust or close.
- [ ] If close, your final sentence names the real axis of disagreement, not the totals.

**Why this matters.** A 35-point gap on subjective 1–5 scores is often a tie. Reporting confidence and flip points is what separates analysis from false precision.

---

## Task 3 — Apply the deal-breaker filter *(easy)*

**Scenario.** Five fictional projects, each with one hard constraint. For each, list which language *families* survive the filter and which are eliminated *before any scoring*.

| # | Project | Hard constraint |
|---|---|---|
| A | Interactive data-viz widget | Must run natively in the browser |
| B | Firmware for a battery sensor | Must fit in 32KB flash, no GC, vendor toolchain is C/C++ |
| C | High-frequency trading matching engine | Hard p99 < 1ms, zero GC pauses tolerated |
| D | CLI tool distributed to customers | Must ship as a single static binary, no runtime install |
| E | Plugin for an existing C++ rendering engine | Must call into it with zero serialization overhead |

**Do this.** For each, write the surviving set and the one-line reason. Then state, for the *whole exercise*, the meta-lesson about *ordering* (why you filter before you score).

**Acceptance.**
- [ ] A → JS/TS/WASM only. D → Go/Rust/C/C++ (not Python/Ruby/Node). C → Rust/C/C++/Zig (not Java/Go/C#).
- [ ] You note that there's no point scoring "team expertise" for a language that physically cannot meet a binary requirement.

---

## Task 4 — Write an ADR for a fictional decision *(medium)*

**Scenario.** You've decided to build a new **notification service** (sends email/SMS/push, ~5k messages/min, mostly I/O-bound on third-party providers) in **Go**, even though your largest team is a Java team. Your reasoning: the on-call platform team already runs a Go fleet; the workload is I/O-bound so Java's performance edge is irrelevant; Go's fast cold-start suits the scale-to-zero serverless you're deploying on; and a small Go service is cheap to rewrite if wrong.

**Do this.** Write a complete ADR (use the `middle.md` / `interview.md` template) with all of: Status, Context, Decision, Rationale (tie each point to a weighted criterion), **Rejected alternatives and why** (Java and at least one other), Consequences, and a **Revisit trigger**.

**Acceptance.**
- [ ] The rationale ties each point to a *criterion*, not a vibe ("Go is nice").
- [ ] You explicitly record why Java was rejected *despite* the team being Java-heavy — this is the interesting tension.
- [ ] There is a concrete, measurable revisit trigger (e.g., "revisit if message volume exceeds 100k/min or we need stateful in-process aggregation").
- [ ] A reader a year from now could reconstruct *why* without asking you.

---

## Task 5 — Critique a flawed selection *(medium)*

**Scenario.** A team submits this justification for a decision. Read it adversarially.

> *"We've decided to rewrite our order-processing monolith (Python, 180k LOC, profitable, handles 2k orders/min, currently meeting all SLOs) in Rust. Rust is the fastest systems language and memory-safe, it scored highest in our benchmark (3.2× faster on a JSON-parsing microbenchmark), and two of our engineers are excited to learn it. Hiring won't be a problem — Rust developers are very passionate. We expect the rewrite to take about four months."*

**Do this.** Write a critique identifying at least **six** distinct flaws. For each, name the flaw and explain why it's a flaw, referencing the principles from this topic.

**Acceptance.** Your critique should catch at least these:
- [ ] **No problem stated** — the system meets all SLOs; what is the rewrite *solving*? Language-first, problem-never.
- [ ] **Benchmark fallacy** — a JSON microbenchmark is meaningless for a system that's almost certainly I/O-bound on the database and payment providers.
- [ ] **Résumé-driven** — "engineers are excited to learn it" is not a business criterion.
- [ ] **Hiring hand-wave** — "passionate" ≠ "available"; Rust has a small, expensive hiring pool with long time-to-hire; "won't be a problem" is unevidenced.
- [ ] **The rewrite fallacy / second-system effect** — a 180k-LOC rewrite in an unfamiliar language in "four months" is a fantasy estimate; rewrites routinely overrun and reintroduce solved bugs.
- [ ] **Ignoring reversibility / blast radius** — rewriting a *profitable, working* core system is a one-way door with enormous downside and little upside.
- [ ] **Bonus:** no ADR, no revisit trigger, no measured pilot, no consideration of operating a new runtime.

---

## Task 6 — Resolve a conflicting-criteria dilemma *(medium-hard)*

**Scenario.** You're choosing a language for a new **real-time multiplayer game backend**: authoritative game-state server, target 60 ticks/sec, p99 < 16ms, thousands of concurrent connections per node, GC pauses cause visible lag. Your team of 6 is fluent in **C#** (you came from Unity); nobody has shipped **Rust** or **C++** in production. The "right tool" pressure points at Rust or C++; team fluency points hard at C#.

**Do this.**
1. Run the deal-breaker filter. Does C# survive the GC-pause constraint? (Research/state your assumption about modern .NET GC modes — e.g., server GC, low-latency modes — and whether they're *good enough* for a 16ms budget under load. State this as an assumption, then decide.)
2. **Refuse to average.** Frame the two futures explicitly: pick C# (ship fast, risk GC lag you may engineer around with tuning and object pooling) vs pick Rust/C++ (months of ramp, but the latency class fits).
3. Apply reversibility: how isolated is this server? Can the choice be wrapped behind a clean protocol boundary so it's a two-way door?
4. Hunt the unlisted criterion (is it hiring? a single key engineer? operating a new runtime?).
5. Make a recommendation and state it *as a bet*, with a measured pilot or kill criterion.

**Acceptance.**
- [ ] You do **not** present a weighted total as the verdict — you name the bet and each branch's failure mode.
- [ ] You make an explicit, falsifiable assumption about whether C#'s GC can meet 16ms p99, and your recommendation depends on it.
- [ ] You propose how to *de-risk* the choice (isolation seam + pilot), not just which language.

---

## Task 7 — Selection at two altitudes *(medium-hard)*

**Scenario.** Same fictional company, two decisions on the same day:
- **Decision X:** a language for one new latency-critical fraud-scoring service.
- **Decision Y:** the company's *default* backend language for the next 30 services.

**Do this.**
1. For each decision, list the top 3 criteria *by weight* and show how the weights differ between X and Y.
2. Explain in 3–4 sentences why the *same* company can correctly land on a specialized language for X and a "boring" broadly-capable language for Y — without contradiction.
3. Show how Y's existence changes how you'd document X (hint: X becomes a documented *exception* to Y).

**Acceptance.**
- [ ] X weights peak fit / performance highly; Y weights breadth, hiring, and consistency highly.
- [ ] You articulate that Y is judged by *worst-case fit across many teams*, X by *best-case fit for one*.
- [ ] You correctly frame X as an exception that opts out of the default, with the cost asymmetry that implies.

---

## Task 8 — Org-scale consolidation plan *(hard)*

**Scenario.** You're the new Principal Engineer at a 250-engineer company with **language sprawl**: Java (40% of services), Python (25%), Node/TS (15%), Go (10%), and a long tail of Scala, Ruby, Elixir, Kotlin, and one Haskell service. The Haskell and Elixir services each have a bus factor of 1. There is no governance — every team picks freely. Leadership asks you to "fix the sprawl."

**Do this.** Write a one-page consolidation plan covering:
1. **Diagnosis** — why does sprawl exist? (Name the root cause, not the symptom.)
2. **Blessed set** — propose 2–4 blessed languages and justify the set by breadth + hiring.
3. **Governance** — who owns the decision, the explicit decision rights (add/exception/sunset/tiebreak), and how you keep it legitimate.
4. **Paved road** — what "blessed" must *concretely* provide so the choice steers by gradient, not mandate.
5. **The freeze** — what you stop immediately.
6. **Triage** — how you handle the existing tail: which services migrate (and why), which run to end-of-life behind a boundary (and why), and how you treat the bus-factor-1 services specifically.
7. **Exception path** — how a team can still go off-road legitimately.

**Acceptance.**
- [ ] You diagnose sprawl as a *governance* failure (nobody owned the decision), not a technology failure.
- [ ] You lead with **freeze + paved road**, not "migrate everything to one language."
- [ ] You treat the bus-factor-1 Haskell/Elixir services as a *risk* priority distinct from the merely-non-standard ones.
- [ ] Your plan keeps a legitimate exception channel so the org doesn't re-sprawl or breed shadow polyglot.

**Trap to avoid.** "Standardize everything on Java and migrate the rest over 18 months" is a death-march answer that ignores blast radius, politics, and the fact that migration cost often exceeds the sprawl cost. Triage by cost and risk.

---

## Task 9 — Role-play: defend a choice under fire *(hard)*

**Scenario.** You recommended **Go** for a new high-throughput data pipeline at a previously all-Python company (the worked dilemma from `senior.md`). In a design review, three stakeholders push back. Write your response to each — two to four sentences each, grounded in the principles of this topic.

1. **The Rust advocate:** *"Go has a garbage collector. Rust would be strictly faster and we'd never worry about GC pauses. Why settle for the inferior tool?"*
2. **The CTO (cost-conscious):** *"We're a Python shop. Adding ANY new language doubles our operational surface. Why not just throw more Python workers at it?"*
3. **The skeptical staff engineer:** *"You ran a matrix and Go won by 15 points over Rust. That's noise. How do you know this isn't just confirmation bias?"*

**Do this.** For each, write a response that *concedes what's true* before making your case (a defense that denies the valid point loses credibility).

**Acceptance.**
- [ ] To the Rust advocate: concede Rust's raw edge, then argue the win is marginal for an I/O-heavy pipeline while the operational + hiring cost of Rust as a *first* second language is large; frame Go as 80% of the win at a fraction of the cost.
- [ ] To the CTO: concede the new-language tax is real, then show *why* Python can't meet the throughput target (GIL/GC) at acceptable cost — i.e., the deal-breaker filter already eliminated "more Python."
- [ ] To the staff engineer: *agree* the 15-point gap is noise, and pivot — the decision wasn't made by the matrix but by reversibility, the operational-readiness criterion, and the second-order "first second language" question. Then offer the pilot/kill criterion as the falsifiable de-risking step.

**The meta-skill.** Defending a choice well is not winning an argument — it's showing your reasoning was *sound and honest*, conceding real tradeoffs, and converting religion into falsifiable experiments.

---

## Validation

| Task | How to check your work |
|------|--------------|
| 1 | Weights match the *stakes* (low for perf, high for ship-speed); no dead-weight criteria. |
| 2 | You produced an actual flip-point number and classified robust vs close. |
| 3 | A→JS/TS/WASM, D→static-binary langs, C→no-GC langs; you stated *filter before score*. |
| 4 | ADR has rejected-alternatives *and* a measurable revisit trigger; Java's rejection is justified. |
| 5 | You caught ≥6 flaws including benchmark fallacy, rewrite fallacy, and "no problem stated". |
| 6 | You named the *bet* (not a total), made a falsifiable GC assumption, and proposed de-risking. |
| 7 | X and Y have visibly different top-weighted criteria; X is framed as an exception to Y. |
| 8 | Diagnosis = governance failure; plan leads with freeze + paved road; bus-factor-1 prioritized. |
| 9 | Each rebuttal *concedes the valid point first*, then reframes; religion → falsifiable pilot. |

---

## A meta-check before you submit any of these

For each artifact you produce, ask:

- **Did I start from the problem and the constraints, or from a language I already liked?**
- **Are my tradeoffs visible** — could a reviewer attack my reasoning, or did I bury it in a single number?
- **Did I write down the *why*** — including what I rejected and under what conditions I'd change my mind?
- **Did I weigh the expensive variables** (people, hiring, maintenance, reversibility) at least as heavily as the cheap ones (syntax, benchmarks)?

If yes to all four, you've practiced the actual skill — not the spreadsheet, but the judgment the spreadsheet is supposed to serve.

---

**Memorize this:** the deliverable of a language decision is never just the winner — it's the *honest, reviewable reasoning* that produced it. Tailor the criteria to the stakes, filter on hard constraints before you score, refuse to average away real conflicts, and write the ADR with a revisit trigger. When you defend the choice, concede what's true and convert belief into experiment. Do that, and being *wrong* becomes cheap to discover and cheap to fix — which is the whole point.
