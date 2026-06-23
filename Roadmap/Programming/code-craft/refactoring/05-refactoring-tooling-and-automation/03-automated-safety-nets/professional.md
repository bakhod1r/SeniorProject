# Automated Safety Nets for Refactoring — Professional

> **Source:** Michael Feathers, *Working Effectively with Legacy Code*; Martin Fowler, *Refactoring* (2nd ed.)

At the professional level the net is **infrastructure for a whole team**, not a personal habit. The concerns shift: how do CI gates enforce the net without becoming a bottleneck; why coverage-as-a-target corrupts the net (Goodhart); how to afford mutation testing at repo scale; how flaky tests destroy the net's authority; and which tools and team practices keep the net trusted over years.

---

## 1. CI gates — making the net mandatory

A net only protects refactoring if it **runs automatically and blocks merges when red.** That is the CI gate. The professional questions are *which* layers gate, and *how hard*.

A sane tiering of gates by cost and signal:

| Gate | Runs on | Blocks merge? | Why |
|------|---------|---------------|-----|
| Compile + type check | every push | Yes | Cheapest net; never let red types merge |
| Fast unit + characterization | every push | Yes | The inner-loop net; must always be green |
| Integration + contract | every push (or pre-merge) | Yes | Boundary net; the compiler can't cover it |
| Mutation testing (incremental) | changed files | Soft (report / threshold on diff) | Expensive; gate the *new* code's net quality |
| Full mutation, exhaustive properties | nightly | No (alert) | Too slow to gate; audits net strength over time |

Two professional rules:

- **Gate the layers you can afford to run on every push; schedule the rest.** Gating a 40-minute mutation run per PR will get the gate disabled within a week. Gate cheap, schedule rich.
- **A gate that is routinely overridden is not a gate.** If people merge red because the net is flaky or slow, the gate has zero authority. Authority comes from the net being *fast and trustworthy*, not from policy.

## 2. Coverage as a signal, not a goal — Goodhart's law

> "When a measure becomes a target, it ceases to be a good measure." — Goodhart's law.

Coverage is a useful **signal**: a module at 5% coverage almost certainly has a thin net; a sudden coverage *drop* in a PR is worth a look. But the moment you set "≥ 90% coverage" as a **merge gate**, engineers optimize the number, not the net — and the cheapest way to raise coverage is **assertion-free tests that execute lines without checking anything**:

```java
@Test
void coversTheBranch() {
    new PricingEngine().price(order);   // line executed, nothing asserted
}
```

Coverage rises, the net does not. You have manufactured a **false net**: green, high-coverage, and unable to catch a single regression. This is Goodhart in action — the metric improved while the thing it was supposed to measure got worse (more tests to maintain, no more protection).

Professional stance:

- **Use coverage as a signal and a guardrail, not a target.** Flag *drops* and *uncovered new code* in review; don't mandate an absolute percentage.
- **Measure net *quality* with mutation score, not coverage**, where you actually care (critical modules). Mutation score cannot be gamed by assertion-free tests — an assertion-free test kills no mutants.
- **Read tests in review.** No coverage tool detects weak assertions; a human reviewer does. "This test runs the method but asserts nothing meaningful" is a review comment, and it's the one that matters.

## 3. Affording mutation testing at scale

Mutation testing's cost is roughly `mutants × suite_runtime` — naively, hours on a large repo. You make it affordable by **scoping**, not by abandoning it:

- **Incremental / diff-scoped (PIT `--withHistory`, Stryker `--incremental`, `--since`):** mutate only code changed in the PR. Gates the net quality of *new* code at PR-acceptable cost.
- **Targeted before a big refactor:** run mutation on the *specific module* you're about to restructure, once, to find net holes before you cut. (See senior level.) This is the highest-value use.
- **Nightly on critical packages:** payments, auth, pricing — the modules where a silent regression is expensive. Track mutation score as a trend; investigate regressions.
- **Tune the mutators:** the default mutator set generates many low-value mutants (e.g., equivalent mutants that *can't* be killed because they don't change behavior). A curated set cuts runtime and noise.

> **When NOT to:** do not put a full-repo mutation run in the per-commit gate, and do not chase 100% mutation score — the last few percent are often **equivalent mutants** (mutations that produce behaviorally identical code, impossible to kill) and you'll waste days. Mutation score is a trend and a tool for finding holes, not a vanity 100%.

## 4. Flaky tests — the net's worst enemy

A **flaky test** fails sometimes without any code change (timing, ordering, shared state, network). Flakiness is uniquely corrosive to a *safety net* because the net's entire value is **trust**: a red bar must mean "you broke behavior." Once a red bar sometimes means "the test is just flaky," engineers do the rational thing — they **re-run until green and stop reading failures.** At that point the net is decorative. A genuine regression sails through because the failure looks like noise.

Professional flaky-test discipline:

- **Quarantine, don't ignore.** Move a flaky test out of the gating suite into a non-gating quarantine *immediately*, file a ticket, and fix the determinism. Never leave a flaky test in the gate "for now" — it erodes the gate's authority every day it's there.
- **Track flake rate as a first-class metric.** Re-run-to-green tooling (e.g., flaky-test detection in CI) should *surface* flakes, not silently hide them.
- **Fix the root cause:** order-dependent tests (hidden shared state), real clocks (inject a fake clock), real sleeps (use awaitility/polling), test pollution (reset state). A flaky test is usually a *design* defect in the test, and the fix makes it a better net.
- **Budget zero tolerance in gating tests.** The gating suite must be deterministic, or it cannot gate.

## 5. Tooling reference

| Layer | Java / JVM | JS / TS | .NET | Python |
|-------|-----------|---------|------|--------|
| Approval / golden master | ApprovalTests-Java | jest snapshots, Verify, ApprovalTests.js | Verify, ApprovalTests.Net | pytest snapshots (syrupy), approvaltests |
| Contract tests | Pact-JVM, Spring Cloud Contract | Pact-JS | PactNet | pact-python |
| Property-based | jqwik, QuickTheories | fast-check | FsCheck | Hypothesis |
| Mutation testing | **PIT (pitest)** | **Stryker** | Stryker.NET | mutmut, cosmic-ray |
| Coverage (signal) | JaCoCo | Istanbul/nyc | Coverlet | coverage.py |

Notes that matter in practice:
- **PIT** integrates with Maven/Gradle/Surefire and supports incremental/`withHistory` runs — essential for affordability.
- **Stryker** has a dashboard and incremental mode; wire it to `--since` to mutate only the diff in CI.
- **Pact** needs a **broker** to share consumer expectations with providers across teams; that broker is part of your net infrastructure, not an afterthought.
- **ApprovalTests** wants a configured diff tool and a clear approve workflow, or the team will rubber-stamp; treat `.approved` files as reviewed artifacts in version control.

## 6. Team practices that keep the net trusted

- **Approved snapshots are reviewed code.** A change to a `.approved` file is a behavior-change claim; review the diff like production code. Block blanket `jest -u` / mass-approve in review.
- **Net before bold move, as a norm.** The team standard for refactoring legacy code is: characterize first, measure with mutation if the stakes are high, *then* refactor. Make "where's the net?" a normal review question on refactoring PRs.
- **Mutation score on critical paths, coverage as a guardrail elsewhere.** Don't impose mutation testing repo-wide; impose it where regressions are expensive.
- **Zero flaky tests in the gate.** Quarantine on sight; the gate's authority is the asset.
- **Speed budget for the inner loop.** Treat inner-loop test latency as a tracked metric; when it crosses the threshold where people stop running tests per change, it's a defect to fix, not a fact to accept.
- **Delete dead net.** Over-pinning and brittle snapshots that block legitimate refactorings should be *removed*, not endured. A net that blocks good refactoring has failed at its purpose. (Related: [Code Smells: Dispensables](../../01-code-smells/04-dispensables/junior.md).)

## 7. When NOT to — professional edition

- **Don't gate on absolute coverage %** — Goodhart turns it into assertion-free tests.
- **Don't gate on full-repo mutation** — schedule it; gate incrementally if at all.
- **Don't tolerate a flaky test in the gate** — it converts every real failure into ignorable noise.
- **Don't let `.approved`/snapshot updates skip review** — that's how the net silently records bugs as correct.
- **Don't build net infrastructure (broker, mutation pipeline) before you have the cheap layers** — get fast unit + characterization + CI green first; richness on top of an absent base is theater.

## Next

- [Interview questions](interview.md) — characterization vs unit test, why mutation testing, coverage-as-goal, golden master.
- Related: [Large-Scale Automated Migrations](../04-large-scale-automated-migrations/junior.md) — the richest-net scenario where all of this comes together.
