# Line, Branch & Path Coverage — Professional Level

> **Roadmap:** [Code Coverage](../README.md) → Line, Branch & Path Coverage
> *The senior page taught you what each criterion counts and how they subsume each other. This page is about choosing which criterion to **require** — where, on which code, at what cost — when the answer feeds a merge gate, a fleet's build budget, and occasionally a certification auditor. Here "branch vs MC/DC" stops being a lattice diagram and becomes a line item in your CI bill and a clause in a DO-178C plan.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Criterion Selection Is a Risk Decision, Not a Default](#criterion-selection-is-a-risk-decision-not-a-default)
4. [The Cost Multiplier of Each Criterion](#the-cost-multiplier-of-each-criterion)
5. [Regulated and Safety-Critical Contexts](#regulated-and-safety-critical-contexts)
6. [Instrumentation Overhead at Fleet Scale](#instrumentation-overhead-at-fleet-scale)
7. [Deciding "Good Enough" Per Risk Tier](#deciding-good-enough-per-risk-tier)
8. [The Path-Coverage Trap on Business Code](#the-path-coverage-trap-on-business-code)
9. [Wiring Criterion Choice Into the Gate Policy](#wiring-criterion-choice-into-the-gate-policy)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Choosing and enforcing a coverage criterion as an engineering and risk decision across many codebases — where richer criteria buy real assurance but cost build time, money, and engineering hours, and where regulation occasionally takes the choice out of your hands.**

The senior page settled the theory: statement ⊂ branch ⊂ condition/decision ⊂ MC/DC ⊂ full path, and 100% of a weaker criterion never implies the next one up. At the professional level the question is no longer *what does MC/DC mean* — it's *should this repository be required to hit it, and what does that decision cost when multiplied by 600 services and a CI budget?*

These choices show up in different rooms than the theory did. A platform team picks "branch coverage, 80% on the diff" as the org default and has to defend why it isn't line, and why it isn't MC/DC. A flight-controls team is told by a DER (Designated Engineering Representative) that Level A software requires **MC/DC**, full stop, and that the *absence* of a covered branch is now an audit finding. A SRE notices the coverage-instrumented integration suite takes 40% longer than the plain one and asks why it runs on every commit. A staff engineer kills a well-meaning push to chase path coverage on the billing service before it consumes a quarter writing tests for combinations that can't occur.

None of this is new *theory*. It's the same subsumption hierarchy, now priced. The skill is judgment: matching the criterion to the blast radius of the code, knowing the cost multiplier you're signing up for, recognizing the few contexts where a regulator mandates the answer, and refusing to spend MC/DC effort on a CRUD endpoint. This page is the pragmatic, battle-tested layer where the criterion becomes policy.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — the subsumption hierarchy, what each criterion counts and ignores, MC/DC's independence requirement, path explosion, how instrumentation records hits.
- **Required:** You've owned (or seriously argued about) a coverage gate in CI and felt the politics of a number that blocks merges.
- **Helpful:** You've worked on a codebase with tiers of risk — a payment path next to an internal admin tool — and felt that one test bar can't fit both.
- **Helpful:** You've seen, or read about, a certification regime (DO-178C, ISO 26262, IEC 62304) or a security framework that asks for structural coverage evidence.

---

## Criterion Selection Is a Risk Decision, Not a Default

The single most common professional mistake is treating "which coverage criterion" as a tooling default — whatever the language's coverage tool reports by default — rather than a deliberate choice scaled to risk. The criteria differ in *what kind of untested behavior they can detect*, and that detection power should match what failure costs.

A working hierarchy of *requirements* (distinct from the academic subsumption hierarchy):

- **Line/statement coverage** is the baseline diagnostic. It answers one question well: *which code did no test execute at all?* That's genuinely valuable — wholly unexecuted code is the highest-density bug reservoir there is — and it's cheap and universally supported. But line coverage is blind to *decisions*: a one-line ternary, a short-circuit `a && b`, an `if` with no `else` — line coverage can read 100% while one side of the decision was never taken. Use it as the **floor** for general code and the *only* automatic signal you trust everywhere.

- **Branch/decision coverage is the sane default to actually enforce.** It closes line coverage's biggest blind spot — the untaken branch — at modest extra cost, and it maps to the most common real defect: *the error path nobody ran.* The empty-`else`, the early `return` on a guard, the `catch` block — branch coverage forces a test that takes each. If your org is going to *enforce* one criterion in a gate, branch is the one that pays for itself. (Note the tooling trap: many setups report "coverage" that is line-only by default — `--branch` in Coverage.py, `-covermode` choices in Go, branch counters in JaCoCo are opt-in or report-distinct. "We have coverage gating" frequently means line gating with branches invisible.)

- **Condition / MC/DC coverage is specialist equipment.** MC/DC (Modified Condition/Decision Coverage) requires that *each boolean condition independently affect the decision's outcome* — for an `n`-condition decision it needs `n+1` carefully chosen test cases, not the `2^n` of full condition combinations. It catches a class of defect the others can't: a condition that's present in the code but whose value never actually changed the outcome under test (a stuck `||` that's always short-circuited by an earlier term). That power costs real money. **Require MC/DC only where regulation or safety demands it** — flight controls, ABS braking logic, infusion-pump dosing — not on your service layer.

- **Full path coverage is almost never a *requirement*.** Path count is exponential in branch count (a function with 10 sequential `if`s has up to `2^10` paths; a loop makes it unbounded), so "100% path coverage" on real business code is usually unachievable and, where achievable, a colossal waste. Path *thinking* is a design and review tool, not a gate.

> **The principle:** the criterion is a dial on a cost/assurance curve, and you set the dial by the cost of the code being wrong. Line for "is it run at all," branch as the default you enforce, MC/DC only where a regulator or a coroner would otherwise be involved, path coverage essentially never as a hard target. Picking the criterion is the engineering decision; the number you attach to it is secondary.

---

## The Cost Multiplier of Each Criterion

Engineers underestimate criterion cost because they price the *tooling* (often free) and ignore the *test-writing labor*, which is where the money goes. The labor scales with the number of distinct cases the criterion demands you cover, and that scales very differently per criterion.

A useful order-of-magnitude model, holding the code fixed:

| Criterion | Test cases to satisfy (per decision of `n` conditions) | Relative effort to reach high coverage | Where the cost actually lands |
|---|---|---|---|
| Line / statement | 1 (execute the line once) | **1×** (baseline) | Trivial; one happy-path test often does it |
| Branch / decision | 2 per branch (both outcomes) | **~2–3×** | Forcing error/guard/empty-`else` paths; setup for failure cases |
| Condition (each condition both ways) | up to `2n` | **~3–5×** | Constructing inputs that flip each sub-condition |
| **MC/DC** | `n+1` *carefully chosen* | **~5–10×+** | Designing the independence cases *and proving* each condition's independent effect; auditor-grade test design and documentation |
| Full path | up to `2^n` (unbounded with loops) | **exponential / infeasible** | Combinatorial explosion; mostly infeasible on real code |

The MC/DC multiplier is the one that surprises teams. The `n+1` test count sounds cheap, but the cost isn't the *count* — it's that each case must be *engineered* to demonstrate one condition's independent influence while holding others fixed, and in a regulated context each must be *traced to a requirement and reviewed*. A complex boolean (`(a || b) && (c || d)`) needs hand-derived test vectors; tooling tells you whether you hit MC/DC but does *not* write the vectors for you. On a large avionics or automotive codebase this is a substantial fraction of total engineering effort — which is exactly why it's reserved for the software that warrants it.

> **The hard number to internalize:** moving the *required* criterion up a rung is not a linear increase in test work — it's roughly multiplicative, and MC/DC is a 5–10× multiplier over branch on the affected code. That multiplier is justified for Level A flight software and indefensible for an internal dashboard. The criterion choice *is* a budget decision; treat "let's require MC/DC" the way you'd treat "let's multiply the test budget for this module by 8," because that's what you said.

---

## Regulated and Safety-Critical Contexts

For most software the criterion is your call. In a few domains it is dictated by a standard, the level scales with how badly the software can hurt someone, and the *evidence* — not just the percentage — is audited. Knowing where these lines fall is professional table stakes even if you never work in the domain, because they're the canonical justification for MC/DC.

**DO-178C — airborne software (avionics).** Software is assigned a **Design Assurance Level (DAL)** A through E by the severity of a failure: **Level A** = catastrophic (failure may cause loss of the aircraft); E = no safety effect. The structural coverage objective scales with level:

- **Level A: MC/DC required** (plus decision and statement coverage).
- **Level B: decision (branch) coverage** required (plus statement).
- **Level C: statement coverage** required.
- **Levels D / E:** no structural coverage objective.

Crucially, DO-178C structural coverage is a *requirements-based* exercise: you write tests **from the requirements**, run them, and then measure structural coverage to find code the requirements-based tests *didn't* exercise. Uncovered code is a finding that must be explained — it's either dead code (must be removed), deactivated code (must be justified), or a requirements/test gap (must be closed). You do not "write tests to hit the lines"; coverage is the *check* that your requirements-based testing was complete.

**ISO 26262 — automotive functional safety.** Risk is classified as an **ASIL** (Automotive Safety Integrity Level) QM/A/B/C/D, derived from severity × exposure × controllability; **ASIL D** is the most stringent (e.g., steering, braking). Part 6 *recommends* structural coverage metrics with strength scaling by ASIL — statement coverage is recommended at lower ASILs, **branch coverage** rises to *highly recommended* in the middle, and **MC/DC** is *highly recommended at ASIL D* for unit-level testing. ISO 26262 uses "recommended / highly recommended" rather than hard mandates, but a "highly recommended" method you *skip* must be justified to an assessor, which in practice means you do it.

**IEC 62304 — medical device software.** Classifies software into safety **Class A / B / C** by the harm a failure could cause (A: no injury possible; C: death or serious injury possible). The standard is lighter on prescribing a *specific* structural-coverage metric than DO-178C, but Class C software demands rigorous unit-level verification, and auditors (and the FDA's expectations around it) routinely look for structural coverage evidence commensurate with the class — branch coverage at minimum for the higher classes, with MC/DC appearing where the device's risk analysis drives it.

**What the audit actually looks like.** In all three regimes the percentage is the *least* interesting artifact. The auditor wants the chain: requirement → test case → execution evidence → structural-coverage result → explanation for anything uncovered. They want to see that you used a *qualified* coverage tool (an unqualified tool's output isn't trusted evidence — tool qualification is itself a deliverable), that your MC/DC was measured with the correct (masking vs unique-cause) definition, and that every uncovered branch has a written disposition. "We're at 100% MC/DC" with no traceability is *not* compliance; "we're at 96% with a documented, reviewed justification for the remaining 4%" frequently is.

> **The professional reality:** in regulated work the criterion is an input from a standard, not an output of a debate, and the *evidence and traceability* are the deliverable — the number is just one line of it. Outside those domains, citing DO-178C to justify MC/DC on your web backend is cargo-culting the rigor without the risk that earns it. Borrow the *discipline* (requirements-based tests, documented dispositions); don't borrow the *criterion* unless you've borrowed the consequences too.

---

## Instrumentation Overhead at Fleet Scale

Richer criteria cost more than test-writing labor — they cost *build and runtime* to measure, and that cost is invisible on one developer's laptop and very visible across a fleet's CI. This is why mature orgs don't run their richest coverage instrumentation on every build.

Where the overhead comes from:

- **Line/statement instrumentation** is the cheapest: a counter (or a bit) per line/block. Source-based coverage (LLVM `-fprofile-instr-generate`, Go's `-cover`) and bytecode instrumentation (JaCoCo) all add per-block bookkeeping. Typical runtime slowdown is meaningful but tolerable — often tens of percent.
- **Branch/decision instrumentation** adds counters at each decision's outcomes, increasing both the instrumentation density and the data volume. More counters means more cache pressure and more profile data to merge.
- **Condition/MC/DC instrumentation** is the heaviest: it must record *each condition's* value and the *combination* that occurred, not just which branch was taken. That's dramatically more data and more per-evaluation work — measurable multi-x slowdowns in hot code — which is one practical reason MC/DC lives in dedicated qualification runs, not the inner dev loop.
- **Path tracing** (recording actual execution paths) is the most expensive of all and is generally not done as routine coverage at all — the data volume is prohibitive.

The second, often-larger cost is **concurrency**. Coverage counters are shared mutable state. Go makes this explicit: `-covermode=set` (did this line run, a non-atomic bit) is cheap but loses count accuracy and isn't safe for concurrent counting; `-covermode=count` counts executions; `-covermode=atomic` makes the counters atomic so they're correct under parallelism — and atomic increments on a hot, shared counter can *serialize* a path that was previously lock-free, distorting both performance and, in pathological cases, the behavior you're testing. The same tension exists in any instrumented runtime: the act of measuring perturbs timing.

The fleet-scale consequences, and the standard mitigations:

- **Don't instrument every build.** Run plain (uninstrumented) builds for the fast feedback loop and the artifacts you ship; run coverage in a *separate* job. The instrumented binary is not the binary you deploy.
- **Don't run the richest criterion continuously.** Branch coverage on every PR is reasonable; MC/DC's heavy instrumentation belongs in a periodic or release-gated qualification run, not on each commit.
- **Beware coverage perturbing the system under test.** Instrumentation slows execution and (for atomic counters) changes contention, which can *mask* races that the uninstrumented binary hits — a covered-but-still-buggy concurrency path. Coverage of concurrent code is a known blind spot (see [05 — What Coverage Does *Not* Tell You](../05-what-coverage-does-not-tell-you/)).
- **Budget the merge cost.** Parallel test shards each produce a coverage profile; merging them is real wall-clock and storage. At fleet scale the *aggregation* pipeline is a cost center of its own.

> **The professional discipline:** instrumentation is a measurement apparatus with a cost proportional to the criterion's richness, and you don't leave the expensive apparatus running on the production line. Line/branch on the PR for fast signal; MC/DC and anything heavier in a dedicated, less-frequent run; never ship the instrumented binary. And remember the Heisenberg edge — the richer the instrumentation, the more it can distort the timing of the very concurrency bugs you'd hope to catch.

---

## Deciding "Good Enough" Per Risk Tier

"What coverage criterion is good enough?" has no global answer, and the search for one is the root of most coverage dysfunction. The answer is *per code, by blast radius*. The professional move is to tier your codebase by what failure costs and apply a different criterion (and a different number) to each tier.

A concrete tiering that travels well:

| Risk tier | Examples | Criterion to **enforce** | Why |
|---|---|---|---|
| **Critical / money / safety** | Payment authorization, balance mutation, auth/permission checks, ledger, anything irreversible | **Branch**, high bar (≥90%) on the diff; consider condition coverage on the gnarly booleans; MC/DC *only* if a regulator says so | A missed error branch here is a financial or security incident; the cost of a test is trivial next to the cost of the bug |
| **Core product logic** | Domain services, business rules, public API handlers | **Branch**, solid bar (≥80%) on the diff | The default. Branch catches the error-path gaps that matter most |
| **Supporting / glue** | Internal tools, admin panels, batch jobs with humans in the loop | **Line**, modest bar, or branch-best-effort | Failure is recoverable and observed; spend the test budget elsewhere |
| **Generated / vendored / trivial** | Generated clients, DTOs, getters, `String()` methods | **Excluded** from the metric entirely | Covering these inflates the number and tests the generator, not your logic (see [05](../05-what-coverage-does-not-tell-you/)) |

Two principles make tiering work rather than become bureaucracy:

1. **The criterion follows the blast radius, not the team's preference.** A payment path owned by a "move fast" team still gets the high branch bar; an internal tool owned by a careful team still gets the modest one. Tie the tier to the code's consequence, ideally encoded by path/package so it's not relitigated per PR.

2. **Exclusions are a first-class part of the policy, not cheating.** Deliberately *not* covering generated and trivial code makes the remaining number *mean something* — it concentrates the metric on code where a gap is a real risk. (The line between principled exclusion and gaming-the-number — `# pragma: no cover` on a hard branch — is the subject of [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/professional.md); the test is *intent*: excluding generated code is honest, excluding a branch you couldn't be bothered to test is not.)

> **The principle:** "good enough" is a property of *each piece of code's risk*, not of the repository or the org. Branch coverage with a high bar where a bug costs money or safety; branch with a normal bar on core logic; line or best-effort on glue; excluded on generated/trivial. One global threshold is the symptom of *not* having made this decision — it over-tests the trivial and under-tests the dangerous simultaneously.

---

## The Path-Coverage Trap on Business Code

A specific, recurring failure mode deserves its own section because senior-ish engineers walk into it precisely *because* they understand the subsumption hierarchy: they reason "branch subsumes line, path subsumes branch, therefore path coverage is the rigorous goal," and set out to cover paths on ordinary business code.

This is a trap for three compounding reasons:

- **Path count is exponential and often infinite.** A function with `k` independent binary decisions has up to `2^k` paths; introduce a loop and the path count is unbounded (each iteration count is a distinct path). "100% path coverage" on a function with a loop and a few conditionals is not a stretch goal — it's mathematically unachievable. Chasing it is chasing an asymptote.

- **Most paths are infeasible or meaningless.** Many of the `2^k` combinations can't actually occur — conditions are correlated (`if user == null` then later `user.name` is unreachable on that path), inputs are constrained, invariants forbid combinations. You burn enormous effort enumerating and trying to cover paths that no real input produces. The work is not just large; much of it is *wasted on impossibilities*.

- **It crowds out assertion quality.** Every hour spent contorting inputs to hit an obscure path combination is an hour not spent on whether the tests *assert the right thing*. Coverage of a path with a weak assertion is worse than fewer paths with strong oracles — and path-chasing structurally pushes you toward the former (see [05 — covered ≠ tested](../05-what-coverage-does-not-tell-you/)).

The resolution is not to abandon path *thinking* — reasoning about which combinations of conditions matter is excellent design and review practice, and tools that surface *interesting* paths (or branch-pair coverage as a pragmatic middle ground) can help. The resolution is to **never make path coverage a hard gate on business code**. Where path-level rigor genuinely matters — a safety-critical decision with a few tightly-coupled conditions — that's exactly the place MC/DC's `n+1` *engineered* cases apply, giving you most of path coverage's defect-detection on the decision without the combinatorial blowup. MC/DC is, in effect, the disciplined answer to "I want path-like rigor but I can't afford `2^n`."

> **The professional resolution:** path coverage is a *thinking tool*, not a *target*. The subsumption hierarchy says path is strongest, but "strongest criterion" and "right criterion to enforce" are different questions. For business code the right enforced criterion is branch; for the rare decision that warrants more, the answer is MC/DC's engineered cases, not brute-force path enumeration. Anyone proposing a path-coverage gate on a service is optimizing the lattice diagram, not the risk.

---

## Wiring Criterion Choice Into the Gate Policy

The criterion decision is inert until it's encoded in the gate, and the gate is where criterion choice meets diff coverage, the ratchet, and the politics of blocking merges. This section is a preview of [04 — Coverage in CI & Diffs](../04-coverage-in-ci-and-diffs/professional.md) and [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/professional.md); here the focus is specifically *how the criterion you chose flows into the policy.*

The connective tissue:

- **Gate on the diff, with the criterion you chose.** Project-wide coverage as a hard gate punishes new code for old debt and invites gaming; **patch/diff coverage** — "the lines *you changed* must hit the bar" — is the enforceable unit. The criterion still matters: a diff-branch-coverage gate is meaningfully stronger than a diff-line-coverage gate, because it forces the new code's *error paths* to be tested, not just executed. State the criterion in the gate, not just the percentage: "85% **branch** coverage on the diff," not "85% coverage."

- **Make the tier drive the threshold.** Encode the per-tier criterion/number in config (Codecov/SonarCloud per-path rules, CODEOWNERS-adjacent path config) so the payment package's diff is held to high branch coverage and the internal tool's to a modest line bar — automatically, without per-PR argument. The tiering from the previous section is only real if the gate enforces it per path.

- **Ratchet, don't cliff.** For existing codebases, the project-level number should be a *non-decreasing ratchet* (it may only go up), while the *diff* gate does the day-to-day enforcement. This lets you raise the criterion's rigor over time (line → branch) without a flag-day rewrite.

- **Keep the heavy criterion out of the blocking path.** Branch coverage on the diff can block a PR because it's cheap to measure. MC/DC's heavy instrumentation should *not* be on the per-PR blocking path for most orgs; it belongs in a periodic/release qualification gate. Don't make every developer wait on the most expensive measurement.

- **Beware the criterion-shaped gaming.** A line-coverage gate is trivially satisfied by assertion-free tests that *execute* code; a branch gate is harder to game but still vulnerable to `pragma: no cover` on the inconvenient branch. The criterion choice raises the gaming floor but doesn't eliminate it — which is why [06](../06-coverage-as-signal-not-target/professional.md) treats coverage as a signal whose *misuse as a target* is the core risk. Mutation coverage (see [02](../02-mutation-coverage/)) is the answer when you need to know the *tests* are real, not just the lines covered.

> **The professional reality:** "we have a coverage gate" is underspecified until you name the *criterion*, the *scope* (diff vs project), and the *tier-to-threshold mapping*. The criterion you chose for risk reasons only bites if the gate enforces *that* criterion on the *diff* per *tier*. A line-coverage project-wide gate — the most common setup — is simultaneously the easiest to game and the weakest signal; choosing branch-on-diff-by-tier is the upgrade that makes the gate mean something.

---

## War Stories

**The team that mandated MC/DC everywhere and ground to a halt.** A platform group, impressed by a safety-critical team's rigor, made *MC/DC* the org-wide required criterion — including for ordinary backend services. The effect was immediate and brutal: writing the `n+1` independence cases for every boolean in every service consumed a multiple of the original test budget, PRs stalled for days under the test-design load, and engineers — unable to meet MC/DC honestly on glue code — started restructuring perfectly clear booleans into nested `if`s *just to reduce condition counts*, making the code worse to satisfy the metric. Velocity cratered; the rigor bought nothing on code where a bug was a recoverable internal annoyance. The fix was to *tier*: MC/DC was scoped to a tiny set of genuinely critical modules, branch became the default, and the org-wide MC/DC mandate was scrapped. The lesson: the strongest criterion applied everywhere is not "extra safe," it's a self-inflicted denial-of-service on engineering, and it actively corrupts code as people game it.

**The branch-coverage gap that shipped a prod incident.** A service had a comfortable **92% line coverage** and a green gate, and everyone trusted it. A payment-refund handler had an `if (gateway.declined()) { rollbackAndAlert(); }` whose body — the *failure* path — was never executed by any test; the happy path covered the surrounding lines, so *line* coverage read fine and the branch was invisible because the gate measured lines, not branches. In production a downstream gateway started declining, the untested `rollbackAndAlert()` had a null-dereference bug, refunds silently failed to roll back, and the ledger drifted before anyone noticed. The post-incident finding was exact: the gate's *criterion* was wrong, not its *number* — line coverage structurally cannot see an untaken branch, and the most dangerous code (the error path) is exactly the code happy-path tests skip. They switched the payment package to a high *branch*-coverage diff gate; the same class of gap now blocks merge.

**The avionics-style audit.** A team building Level A flight-control software hit 100% statement and 100% decision coverage and considered themselves done — then the certification review (DO-178C) opened with the auditor ignoring the percentages entirely and asking for the *traceability*: show the requirement, the test derived from it, the execution evidence, the **MC/DC** result for each multi-condition decision, and the written disposition for anything uncovered. Two problems surfaced. First, several decisions hit 100% *decision* coverage but not *MC/DC* — both outcomes of the whole decision were taken, but no test demonstrated that one particular condition *independently* changed the outcome, so a stuck condition could have hidden there undetected. Second, a handful of covered lines turned out to be *deactivated code* with no requirement behind them — covered, but unjustified, which is itself a finding. The lesson: in a certified context the criterion (MC/DC) and the *evidence chain* are the product; a high percentage with the wrong criterion and no traceability is not partial compliance, it's non-compliance with a nice-looking number.

**The instrumentation that hid the race.** A concurrency-heavy service ran its integration suite under coverage with Go's `-covermode=atomic`. The suite was green and the concurrent code showed as covered, so a known-flaky intermittent failure was assumed fixed. It wasn't — the atomic coverage counters had added just enough synchronization to *serialize* the contended path and mask the race that the uninstrumented production binary still hit. The bug resurfaced in prod under load. The lesson: coverage of concurrent code is a measurement that can *change* the thing being measured; "covered" said nothing about whether the race was gone, and the instrumented binary's timing was not the deployed binary's timing.

---

## Decision Frameworks

**Which criterion should I *require* on this code? Ask, in order:**
- Is this code's failure *catastrophic to people* and is it under a safety standard (DO-178C/ISO 26262/IEC 62304)? → the standard dictates it (often **MC/DC** at the top level); do what it says, with traceability.
- Is failure a *money or security* incident (payments, auth, ledger)? → **branch**, high bar; condition coverage on the gnarly booleans; MC/DC only if regulation also applies.
- Is this *core product logic*? → **branch**, normal bar. This is the default for most code.
- Is this *internal/glue/recoverable*? → **line** or branch-best-effort, modest bar.
- Is this *generated/vendored/trivial*? → **exclude** it from the metric.

**Should I require MC/DC here? Require it only if ALL of:**
- A safety/regulatory standard mandates it for this code's assurance level, **or** the decision is genuinely safety-critical with tightly-coupled conditions; **and**
- You can afford the ~5–10× test-design multiplier on this module; **and**
- You can produce the traceability/evidence (if regulated) or the independence cases (if not). Otherwise: **branch**, not MC/DC.

**Tempted by path coverage? Ask:**
- Is this business code with loops/many conditions? → **No** path gate — it's infeasible and wasteful; use branch, and MC/DC for the rare critical decision.

**Where does the criterion get measured? Ask:**
- Is it cheap (line/branch)? → on every PR, on the **diff**, per-tier threshold.
- Is it heavy (MC/DC/path tracing)? → in a periodic/release qualification run, *not* the per-PR blocking path; and never ship the instrumented binary.

**Is my gate actually enforcing my decision? Check:**
- Does the gate name the **criterion** (branch, not just "coverage"), scope to the **diff**, and map **tier → threshold** per path? If it's a single global line-coverage number, you haven't encoded the decision.

---

## Mental Models

- **The criterion is a dial on a cost/assurance curve; you set it by the cost of being wrong.** Line for "is it executed," branch as the enforced default, MC/DC only where a regulator or a coroner is implied, path essentially never as a gate. Picking the dial is the engineering act.

- **Moving the required criterion up a rung is roughly *multiplicative* test work, not additive.** Branch is ~2–3× line; MC/DC is ~5–10× branch on the affected code. "Let's require MC/DC" *means* "let's multiply this module's test budget by ~8" — say the second sentence when you say the first.

- **The most dangerous code is the code happy-path tests skip — which is exactly what line coverage can't see.** Error paths, guards, empty-`else`s. Branch coverage exists specifically to force them. A green *line* gate over an untested error branch is the canonical prod-incident setup.

- **In regulated work the criterion is an input and the *evidence* is the deliverable.** DO-178C/ISO 26262 dictate the criterion by assurance level; the auditor cares about requirement→test→evidence→disposition traceability, not the percentage. A high number with the wrong criterion and no traceability is non-compliance.

- **"Strongest criterion" ≠ "right criterion to enforce."** The subsumption hierarchy ranks detection power; the enforcement decision ranks *value per cost on this code*. Path is strongest and almost never the right gate. MC/DC is the disciplined stand-in for path-like rigor where it's actually warranted.

- **Measuring coverage perturbs the system — most dangerously for concurrency.** Richer instrumentation is heavier and (atomic counters) changes contention, which can mask the very races you hoped to catch. The instrumented binary is not the deployed binary.

---

## Common Mistakes

1. **Taking the tool's default criterion as the decision.** Most coverage tools report *line* by default and call it "coverage." Letting that default be your policy means you're enforcing the weakest criterion by accident — and branches (the error paths) are invisible. Choose the criterion deliberately; turn on branch reporting explicitly.

2. **One global threshold for the whole repo.** A single number over-tests trivial code and under-tests the payment path simultaneously. Tier by blast radius; map tier → criterion → threshold per path.

3. **Mandating MC/DC where no safety/regulatory case justifies it.** It's a ~5–10× multiplier that buys nothing on recoverable internal code and *corrupts* code as engineers restructure booleans to game it. Reserve MC/DC for the assurance levels that earn it.

4. **Chasing path coverage on business code.** It's exponential, often infeasible, mostly spent on impossible paths, and it crowds out assertion quality. Use branch; use MC/DC for the rare tightly-coupled critical decision. Never make path a gate.

5. **Running the richest instrumentation on every build.** MC/DC/heavy instrumentation slows builds, distorts concurrency, and bloats the merge pipeline. Keep line/branch on the PR; put MC/DC in a periodic/release run; never ship the instrumented binary.

6. **Gating on project coverage instead of the diff.** Project-wide hard gates punish new code for old debt and invite gaming. Gate the *diff* with the chosen criterion; ratchet the project number upward over time.

7. **Citing a high percentage as compliance in a regulated context.** Without the requirement→test→evidence→disposition chain and the *correct* criterion (and a qualified tool), the number is not evidence. Auditors check traceability, not headline coverage.

8. **Trusting "covered" on concurrent code.** Coverage instrumentation changes timing and can mask races. A covered concurrent path is not a *correct* one — coverage is structurally blind here.

---

## Test Yourself

1. Your org wants "one coverage rule." Explain why a single global threshold is the wrong answer, and describe what you'd put in its place.
2. A service has 92% *line* coverage and a green gate, yet ships an incident on an untested error path. Explain precisely how that's possible and which criterion change prevents the next one.
3. Order line, branch, condition, MC/DC, and path by the *test-writing cost* to reach high coverage, and give the rough multiplier for MC/DC over branch. Where does that cost actually go for MC/DC?
4. Under DO-178C, what structural coverage criterion is required at Level A vs Level B vs Level C? In that regime, is coverage how you *write* tests or how you *check* them?
5. A teammate proposes a path-coverage gate on the billing service "because path subsumes branch." Give three reasons it's a trap and the criterion you'd use instead for the genuinely tricky decisions.
6. Why don't mature orgs run MC/DC instrumentation on every commit? Give both the build-cost and the concurrency reasons, and say where MC/DC measurement *should* live.
7. You're encoding your criterion decision into CI. Name the three things the gate must specify beyond a percentage for it to actually enforce your decision.

<details>
<summary>Answers</summary>

1. A global threshold applies the *same* criterion and number to code with wildly different blast radius — it **over-tests** trivial/generated code (inflating the number, testing nothing real) and **under-tests** the payment path (a bug there is an incident) at the same time, and it invites gaming. Replace it with **risk tiering**: critical/money code gets high *branch* coverage (MC/DC only if regulated), core logic gets normal branch, glue gets line/best-effort, generated/trivial is *excluded* — enforced **on the diff, per path**.
2. **Line coverage is structurally blind to an untaken branch.** The happy-path test executed the lines *around* an `if (error) { handle(); }`, so line coverage read high, but the *failure* branch body was never run — and the error path is exactly where the bug lived. Line coverage can be 100% with one side of every decision untested. **Switch the gate's criterion to branch** (on the diff), which forces both outcomes of each decision to be exercised.
3. From cheapest to most expensive: **line < branch (~2–3× line) < condition (~3–5×) < MC/DC (~5–10× branch) < path (exponential/infeasible).** MC/DC's cost is not the `n+1` *count* — it's that each case must be *engineered* to demonstrate one condition's *independent* effect (holding others fixed), and in regulated work *traced to a requirement and reviewed*. Tooling tells you whether you hit MC/DC; it does not write the vectors.
4. **Level A → MC/DC** (plus decision + statement); **Level B → decision/branch** (plus statement); **Level C → statement**; D/E → none. In DO-178C, coverage is how you *check* tests, not write them: you write **requirements-based** tests, then measure structural coverage to find code the requirements-based tests missed — uncovered code is a finding (dead code, deactivated code, or a requirements/test gap) that must be dispositioned.
5. (a) **Path count is exponential and unbounded with loops** — "100% path" on a function with a loop is mathematically unachievable. (b) **Most paths are infeasible** (correlated conditions, invariants) — huge effort wasted on combinations that can't occur. (c) **It crowds out assertion quality** — hours contorting inputs to hit paths aren't spent on whether tests assert the right thing. Use **branch** as the gate; for genuinely tightly-coupled critical decisions, use **MC/DC's engineered `n+1` cases**, which give path-like rigor on the decision without `2^n`.
6. **Build cost:** MC/DC instrumentation records each condition's value and the combination taken — far more per-evaluation work and data than line/branch, with multi-x slowdowns and a heavier merge pipeline. **Concurrency:** heavy/atomic instrumentation changes timing and contention, which can *mask* the races you're trying to catch (the instrumented binary isn't the deployed one). MC/DC measurement should live in a **periodic/release qualification run**, not the per-PR blocking path.
7. The gate must specify: (a) the **criterion** — "branch," not just "coverage" (a line gate is the weakest and most gameable); (b) the **scope** — the **diff/patch**, not project-wide (so new code is held to the bar without punishing old debt or inviting gaming); and (c) the **tier → threshold mapping per path** (so the payment package gets high branch coverage and the internal tool a modest bar automatically).

</details>

---

## Cheat Sheet

```
CRITERION → WHEN TO REQUIRE IT
  line     "is it executed at all?"      → floor / baseline everywhere
  branch   error/guard/empty-else paths  → THE default to ENFORCE
  MC/DC    each condition independent     → ONLY where regulation/safety demands
  path     all path combinations          → NEVER a gate (thinking tool only)

COST MULTIPLIER (test-writing labor, code fixed)
  line   1x      branch ~2-3x      condition ~3-5x
  MC/DC  ~5-10x over branch        path  exponential / infeasible
  "require MC/DC" == "multiply this module's test budget by ~8"

REGULATED MANDATES
  DO-178C  Level A → MC/DC | B → decision | C → statement | D/E → none
  ISO26262 ASIL D → MC/DC highly recommended (unit) | branch mid | stmt low
  IEC62304 Class C → rigorous unit verification; coverage evidence by class
  AUDIT cares about: requirement→test→evidence→disposition + QUALIFIED tool
        NOT the headline %

INSTRUMENTATION AT SCALE
  don't instrument every build  → coverage in a SEPARATE job
  don't run MC/DC continuously  → periodic/release qualification run
  never ship the instrumented binary
  Go: -covermode=set(cheap,bit) / count / atomic(safe under parallelism)
  atomic counters can MASK races → "covered" ≠ "race-free"

RISK TIERING (criterion follows blast radius, not team preference)
  money/safety  → branch high bar (≥90% diff); MC/DC iff regulated
  core logic    → branch normal bar (≥80% diff)
  glue/internal → line / best-effort
  generated/trivial → EXCLUDE from the metric

GATE MUST SPECIFY (else it doesn't enforce your decision)
  criterion (branch, not "coverage") + scope (DIFF) + tier→threshold per path
  ratchet project % upward; keep heavy criterion off the per-PR blocking path
```

---

## Summary

- **Criterion selection is a risk decision, not a tooling default.** Line answers "is it executed," branch is the **sane default to enforce**, MC/DC is **specialist equipment for regulated/safety-critical code only**, and full path coverage is essentially **never** a gate. Set the dial by the cost of the code being wrong.
- **Each rung up the criterion is roughly *multiplicative* test work**: branch ~2–3× line, MC/DC ~5–10× branch — and MC/DC's cost is the *engineered, traceable* independence cases, not the `n+1` count. "Require MC/DC" means "multiply this module's test budget by ~8."
- **A few domains take the choice away from you.** DO-178C (MC/DC at Level A, decision at B, statement at C), ISO 26262 (MC/DC highly recommended at ASIL D), and IEC 62304 (rigor by class) *dictate* the criterion by how badly the software can hurt someone — and the **audit is about the evidence chain (requirement→test→evidence→disposition) and a qualified tool, not the percentage.**
- **Richer criteria cost build time and perturb the system.** Don't instrument every build, keep MC/DC's heavy instrumentation in a periodic/release run, never ship the instrumented binary, and remember that atomic coverage counters can *mask* the concurrency bugs you're hunting.
- **"Good enough" is per code, by blast radius** — branch with a high bar on money/safety code, normal branch on core logic, line/best-effort on glue, *excluded* on generated/trivial. One global threshold is the symptom of *not* having made this decision.
- **The decision is inert until the gate encodes it**: name the **criterion** (branch, not "coverage"), scope to the **diff**, and map **tier → threshold per path** — see [04 — Coverage in CI & Diffs](../04-coverage-in-ci-and-diffs/professional.md) and the signal-not-target framing in [06](../06-coverage-as-signal-not-target/professional.md).

You can now choose, price, and enforce a coverage criterion as a risk decision across a fleet — and recognize the rare contexts where a regulator chooses for you. The remaining tier — [interview.md](interview.md) — consolidates the whole topic into the questions that probe whether someone actually understands criteria, cost, and gating.

---

## Further Reading

- *Software Engineering at Google* (Winters, Manshreck, Wright) — the coverage chapter, especially **why Google does not enforce a global coverage threshold** — the canonical argument against the one-number mistake.
- *TestCoverage* — Martin Fowler (martinfowler.com) — the short, authoritative essay on coverage as a diagnostic for *finding untested code*, not a target.
- **DO-178C** and its supplement **DO-330** (tool qualification) — the avionics structural-coverage objectives by DAL and what tool qualification as evidence actually requires.
- **ISO 26262 Part 6** — structural coverage metrics (statement, branch, MC/DC) recommended by ASIL for unit testing in automotive functional safety.
- **IEC 62304** — medical device software lifecycle; safety classes A/B/C and the verification rigor expected per class.
- *A Practical Tutorial on Modified Condition/Decision Coverage* (Hayhurst, Veerhusen, Chilenski, Rierson — NASA/TM-2001-210876) — the standard, readable explanation of MC/DC and how to derive its test cases.

---

## Related Topics

- [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/professional.md) — Goodhart's law, gaming the criterion, why the chosen criterion is a signal whose misuse as a target is the real risk.
- [04 — Coverage in CI & Diffs](../04-coverage-in-ci-and-diffs/professional.md) — diff/patch coverage, the ratchet, per-path thresholds, and the merge-blocking politics that the criterion choice flows into.
- [02 — Mutation Coverage](../02-mutation-coverage/) — when you need to know the *tests* are real and not just the lines covered — the honest signal that no structural criterion provides.
- [05 — What Coverage Does *Not* Tell You](../05-what-coverage-does-not-tell-you/) — covered ≠ tested, the concurrency blind spot instrumentation can *worsen*, and what to exclude.
- [Quality Gates](../../quality-gates/) — the broader gate-policy discipline that the per-tier criterion threshold plugs into.
