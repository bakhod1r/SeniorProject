# Unit Testing — Interview Level

> **Roadmap:** [Testing](../README.md) → Unit Testing
>
> *A question bank that separates engineers who write tests from engineers who understand them.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [What Makes a Good Test](#what-makes-a-good-test)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **answering unit-testing questions the way a senior engineer reasons — naming the trade-off, not reciting a definition.**

Interviewers rarely care whether you can spell AAA. They probe whether you understand *why* a test exists, what makes one valuable versus actively harmful, and how you'd reason about a suite under real-world pressure (migrations, flakiness, mocking debates). The strongest answers name the **trade-off** and the **principle** behind a choice, then give a concrete example.

Each entry below is **Q** (the question) / *what's really being tested* / **A** (a model answer you can adapt).

---

## Prerequisites

- The full ladder: junior (AAA, naming), middle (classical vs mockist, behavior-not-impl), senior (four pillars, smells), professional (suite health).
- Be ready to write a small test live in your strongest language.
- Know the vocabulary of [Test Doubles](../10-test-doubles-mocks-fakes/) and [Mutation Testing](../07-mutation-testing/).

---

## Fundamentals

**Q: What makes a test a *unit* test, specifically?**
*Tests whether you know the operational definition, not a vibe.*
**A:** Three properties: it tests a small piece of behavior in **isolation**, it runs in **milliseconds**, and it's **deterministic**. Operationally, that means no real database, network, filesystem, system clock, sleep, or thread-scheduling dependence — anything that makes it slow or non-repeatable disqualifies it. It's the fast, wide base of the pyramid. I'd add: "unit" refers to a unit of *behavior*, not necessarily a single class.

**Q: Why not just write end-to-end tests that cover everything?**
*Tests pyramid reasoning.*
**A:** E2E tests are slow, flaky, and expensive, and they don't localize failures — when one breaks you don't know which of fifty components is at fault. Unit tests are fast enough to run on every save, deterministic, and point straight at the broken logic. You still need a thin layer of E2E for critical user flows, but inverting the pyramid into an "ice-cream cone" gives you a suite nobody trusts or runs. Put tests where the risk is: logic in units, wiring in integration, key journeys in a little E2E.

**Q: What's the difference between a unit test and an integration test?**
*Boundary clarity.*
**A:** A unit test exercises logic in isolation with no out-of-process dependency. An integration test deliberately includes a real external dependency — a database, a message broker, a real HTTP call — to verify the wiring between your code and the outside world. Units catch logic bugs cheaply; integration catches the bugs that live *between* units, which unit tests structurally cannot see.

---

## Technique

**Q: Walk me through how you'd structure a single test.**
*Tests AAA fluency and discipline.*
**A:** Arrange-Act-Assert. Arrange the inputs and the system under test; Act by calling the one method under test; Assert on the result. I keep a blank line between phases so the structure is visible, keep the Act to a single call, and aim for one logical reason to fail. The name reads as a specification — `method_scenario_expectedResult` — so a failure is self-explanatory without opening the body.

**Q: You have a function with 12 input variations. How do you test it?**
*Tests parameterization.*
**A:** A parameterized / table-driven test, not 12 copy-pasted functions. In Go, a table of structs iterated with `t.Run(name, ...)` so each row is a named subtest; in Python, `@pytest.mark.parametrize`; in JUnit 5, `@ParameterizedTest` with `@CsvSource` or `@MethodSource`. The cases become a readable spec and adding the 13th is a one-line diff. Caveat: only when cases differ in *data*. If they differ in setup or logic, separate tests are clearer than a table full of conditional fields.

**Q: How do you test code that calls `time.Now()` or generates random numbers?**
*Tests determinism and testable design.*
**A:** I don't test it as written — I make it testable by **injecting** the clock and the RNG. Pass a `func() time.Time` (or a `Clock` interface) and a seeded random source as parameters or constructor dependencies. Then the test controls them and the result is deterministic. Reaching for the global clock inside logic makes the code untestable and any test of it flaky by construction. If something genuinely can't be made deterministic, it doesn't belong in the unit layer.

**Q: How do you test a private method?**
*Tests the behavior-not-implementation principle — this is a trap.*
**A:** I don't test it directly. I test it **through the public API** that uses it. A private method exists to serve public behavior, so the public tests exercise it. If a private method is so complex it feels like it needs its own test, that's a design signal — it probably wants to be extracted into its own unit with its own public surface. Testing privates (via reflection or `@VisibleForTesting`) couples the test to implementation and makes it brittle.

---

## What Makes a Good Test

**Q: What are the four pillars of a good unit test?**
*Tests whether you have a rigorous framework or just opinions.*
**A:** Khorikov's four: **protection against regressions** (would it catch a real bug — measured honestly by mutation score), **resistance to refactoring** (does it stay green on a behavior-preserving change), **fast feedback** (runs in ms), and **maintainability** (readable, few external deps). Value is roughly protection × resistance, weighed against the cost of speed and maintainability. The important part: they're in tension — you can't max all of them.

**Q: If you can't maximize all four, which do you protect first?**
*Tests depth — this separates good from great.*
**A:** Resistance to refactoring is non-negotiable, because a brittle test produces **false positives** — it fails when the code is correct. One false positive costs you a debugging session; at scale, false positives train the team to ignore red, which kills trust in the entire suite and stops refactoring. So I fix resistance first by testing observable behavior, then trade protection against speed by choosing the test's scope and its place in the pyramid. A false positive is more expensive than a false negative because it taxes every future change, not just once.

**Q: A teammate has 95% coverage and says the code is "well tested." Your response?**
*Tests the coverage-vs-protection distinction.*
**A:** Coverage tells you a line *ran*, not that a bug in it would be *caught*. You can have 95% coverage with assertions that check almost nothing — I've seen 95% coverage with a 40% mutation score. I'd run mutation testing to see what fraction of injected faults the suite actually catches; that's the honest protection metric. Coverage is useful as a floor and a gap-finder (what's totally untested), dangerous as a headline target because it gets Goodharted into assertion-free tests.

**Q: Give me an example of a test that's coupled to implementation, and fix it.**
*Tests that you can recognize and repair brittleness concretely.*
**A:** A test that mocks an in-process collaborator and asserts `verify(repo).save(); verifyNoMoreInteractions(repo)` is coupled — it pins *how* the SUT works, so it breaks when you reorder or rename internal calls even though behavior is unchanged. The fix is to use a real or in-memory fake repo and assert on the **outcome**: after the operation, the repo *contains* the expected record, and the method *returns* the expected result. Now it only fails when behavior actually breaks. The general rule: assert output and resulting state, not internal call sequences.

---

## Scenarios

**Q: You're migrating 200 services to a new HTTP framework. Behavior is identical, but 4,000 unit tests turn red. What happened and what do you do?**
*Tests the economics of over-specified tests.*
**A:** Those tests were over-specified — they asserted on internal call shapes (mock interactions) that the migration legitimately changed, even though behavior didn't. That's the cost of mockist, implementation-coupled tests: cheap to write, ruinous to migrate past. Going forward I'd audit the blast radius for heavy mock usage and `verifyNoMoreInteractions` *before* a migration and refactor those to behavior-based assertions while the code still works — paying down the test debt first so the migration sees a resilient suite. The deeper lesson: a test's real cost is realized on change, not on write.

**Q: A test passes locally but fails ~1 in 20 runs in CI. How do you handle it?**
*Tests flakiness discipline.*
**A:** A flake is a trust problem, not a minor bug — one untracked flake teaches people to ignore red across the whole suite. So first, **quarantine** it out of the gating path immediately so it can't block the build, and assign an owner with a deadline. Then root-cause: the usual suspects are a real clock or RNG leaking in, test interdependence/shared mutable state, async timing with `sleep`-and-hope, or order dependence. Fix the determinism or delete the test. Never leave a flake failing the build untracked, and never just add a retry that masks a real race.

**Q: Your unit suite has grown to 25 minutes and people have stopped running it locally. What do you do?**
*Tests suite-health-at-scale thinking.*
**A:** Speed is the unit suite's whole point, so I treat this as a reliability incident. Profile the slowest tests — a "unit" over ~50 ms almost always hides I/O (a real DB driver, HTTP client, or `sleep`); mock or remove it, and add a per-test runtime budget enforced in CI. Then parallelize independent tests (which requires they actually be independent), add test selection so a diff only runs affected tests, and cache passing results by input hash. Full suite on merge, targeted suite on every change. I'd also delete brittle, zero-protection tests — a smaller, faster, trusted suite beats a large slow one.

**Q: When is mocking the *right* choice, and when is it a smell?**
*Tests the classical/mockist judgment.*
**A:** Mock **unmanaged, out-of-process dependencies you don't own** — a payment gateway, an email service — where the interaction itself is the observable contract and you can't use the real thing in a fast test. Mocking is a smell when applied to **owned, in-process collaborators**: it couples the test to implementation, makes refactoring painful, and can hide wiring bugs because the canned responses paper over the real integration. My default is classical — real in-process collaborators or in-memory fakes, mock only the unmanaged edges — which keeps resistance to refactoring high.

---

## Rapid-Fire

**Q: One logical assertion per test — literally one `assert`?**
**A:** No — one *reason to fail*. Checking all fields of one returned object is one logical assertion across several lines.

**Q: Classical vs mockist in one line each?**
**A:** Classical: a unit is a unit of behavior, real collaborators, assert on state. Mockist: a unit is one class, mock all collaborators, assert on interactions.

**Q: What's a "mystery guest"?**
**A:** A test that depends on external data it doesn't show — a fixture file, a shared DB row, an env var. Make inputs explicit and local.

**Q: What's assertion roulette?**
**A:** Many unrelated assertions with no messages, so a failure doesn't say which check broke.

**Q: Functional core, imperative shell — why?**
**A:** Put decision logic in pure functions (trivially, exhaustively unit-testable) and keep a thin I/O shell that needs only a couple of integration tests.

**Q: State verification vs interaction verification — default?**
**A:** Prefer state. Use interaction only when the interaction *is* the observable behavior (e.g. "an email was sent").

**Q: Should tests survive a refactor?**
**A:** Yes — a behavior-preserving change must keep them green. If it doesn't, the test was coupled to implementation.

**Q: Honest measure of test quality?**
**A:** Mutation score, not coverage.

**Q: Is deleting a passing test ever right?**
**A:** Yes — if it's brittle and contributes nothing to mutation score, it's a net liability.

**Q: First thing you do with a flaky test?**
**A:** Quarantine it out of the gating path, assign an owner, then root-cause.

---

## Red Flags / Green Flags

**Red flags (in a candidate's answers):**
- Defines "unit test" only as "tests a function" — no isolation/speed/determinism.
- Thinks more mocking is always better; mocks owned in-process collaborators reflexively.
- Treats coverage % as the goal; never mentions mutation testing.
- Tests private methods via reflection and sees no problem.
- Can't explain why a brittle test is worse than no test.
- "Just add a retry" as the answer to flakiness.
- Says "everything should be a unit test," even glue code.

**Green flags:**
- Names the four pillars and the tension between them; protects resistance first.
- Distinguishes false positives from false negatives and explains the scale cost.
- Defaults to classical; reserves mocks for unmanaged out-of-process deps.
- Reaches for mutation score when asked about test quality.
- Talks about *deleting* low-value tests, not just adding.
- Treats flakiness as a trust problem with a quarantine playbook.
- Connects the test ratio to where the risk lives.

---

## Cheat Sheet

```text
DEFINITION   isolated · ms-fast · deterministic · no I/O/clock/net/disk

FOUR PILLARS regression-protection · resistance-to-refactoring ·
             fast-feedback · maintainability
             → resistance is NON-NEGOTIABLE; fix it first

KEY LINES
  "Coverage says it ran; mutation score says a bug would be caught."
  "A false positive taxes every future change; a false negative costs once."
  "A unit is a unit of behavior, not a class."
  "Test through the public API; assert on outcome, not internal calls."
  "Mock unmanaged out-of-process deps; mocking owned collaborators is a smell."
  "A flaky test is a trust problem — quarantine, own, fix."
  "A test's real cost is paid on change, not on write."

TRAPS        private-method test (→ test via public API)
             95% coverage = well tested (→ mutation score)
             more mocks = better (→ classical default)
```

---

## Summary

Interview-level unit testing is about **reasoning, not recitation**. Define a unit test by its three properties (isolated, ms-fast, deterministic) and place it as the base of the pyramid. Anchor quality judgments in the **four pillars**, and be ready to say which you protect first and *why* — resistance to refactoring, because false positives destroy trust at scale. Distinguish **coverage from protection** (reach for mutation score), default to the **classical** school while reserving mocks for unmanaged out-of-process dependencies, and always **test behavior through the public API** so tests survive a refactor. On scenarios — migrations, flakiness, slow suites — name the underlying principle (over-specification is debt, flakiness is a trust leak, speed is the unit layer's purpose) and give a concrete, decisive plan. The candidates who stand out talk about deleting tests, measuring with mutation score, and protecting the suite's trust as carefully as its coverage.

---

## Further Reading

- Vladimir Khorikov, *Unit Testing: Principles, Practices, and Patterns* — the four pillars, interview-ready.
- Martin Fowler, "Mocks Aren't Stubs" — the classical/mockist framing.
- *Software Engineering at Google*, testing chapters — scale, flakiness, test sizes.
- The `unit-testing-patterns`, `mocking-strategies`, and `test-driven-development` skills.

---

## Related Topics

- [Test Strategy & the Pyramid](../01-test-strategy-and-the-pyramid/) — the ratio and placement questions.
- [Test Doubles, Mocks & Fakes](../10-test-doubles-mocks-fakes/) — the mocking-debate vocabulary.
- [Mutation Testing](../07-mutation-testing/) — the protection metric interviewers love.
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/) — the flakiness scenario playbook.
- [Code Coverage](../../code-coverage/) — coverage as a floor, not a target.
- **Start over:** [Unit Testing — Junior Level](junior.md).
