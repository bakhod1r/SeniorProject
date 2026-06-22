# Test Doubles: Mocks & Fakes — Interview Level

> **Roadmap:** [Testing](../README.md) → Test Doubles: Mocks & Fakes
>
> *Anyone can say "mock." This question bank separates engineers who know the five doubles cold from those who reach for `verify` reflexively.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [The Five Doubles](#the-five-doubles)
5. [Technique](#technique)
6. [Classical vs Mockist](#classical-vs-mockist)
7. [Scenarios](#scenarios)
8. [Rapid-Fire](#rapid-fire)
9. [Red Flags / Green Flags](#red-flags--green-flags)
10. [Cheat Sheet](#cheat-sheet)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

> Focus: **answering test-double questions the way a senior engineer reasons — precise vocabulary, the state-vs-behavior trade-off, and knowing when a mock is right vs a smell.**

Interviewers use this topic to probe judgment, not memorization. The weak signal is someone who calls every double a "mock" and reaches for `verify` by default. The strong signal is someone who names the five doubles precisely, defaults to state verification with fakes, can articulate *why* over-mocking is harmful, and names the narrow cases where a mock is genuinely correct.

Each entry is **Q** (the question) / *what's really being tested* / **A** (a model answer you can adapt).

---

## Prerequisites

- The full ladder: junior (the five doubles, first stub), middle (state vs behavior, Detroit/London, faking clock/HTTP), senior (over-mocking, don't-mock-what-you-don't-own), professional (org discipline, migration cost).
- Be ready to write a small stub *and* a fake live, in your strongest language.
- Know the neighboring topics: [Unit Testing](../02-unit-testing/), [Integration Testing](../03-integration-testing/), [Contract Testing](../05-contract-testing/).

---

## Fundamentals

**Q: Why do test doubles exist at all?**
*Tests whether you know the purpose or just the mechanics.*
**A:** To isolate the unit under test from collaborators that are **slow, nondeterministic, or hard to control** — databases, networks, the system clock, randomness, external APIs. The goal is **control and speed**, never "mocking for its own sake." If a real collaborator is already fast and deterministic (a pure value object, a formatter), use the real thing.

**Q: Define dummy, stub, spy, mock, and fake.**
*The crisp Meszaros taxonomy — the single most common knockout question.*
**A:**
- **Dummy** — passed only to fill a parameter; never actually used on the path under test.
- **Stub** — returns canned answers to calls; feeds inputs into the SUT. No assertions of its own.
- **Spy** — a stub that *also records* how it was called, for later inspection.
- **Mock** — pre-programmed with *expectations*; it *verifies* the interaction and fails if the call didn't happen as specified.
- **Fake** — a working lightweight implementation (in-memory DB/repo, a real algorithm with a shortcut).

The key split: stub/spy/fake support **state** verification; mock does **behavior** verification.

**Q: What's the difference between a stub and a mock, concretely?**
*The distinction most people blur.*
**A:** A **stub** supplies data and you assert on the *result* (state): "given this name, the greeting is correct." A **mock** has expectations set up front and asserts the *call happened* (behavior): "you must call `send` once with this email." Same object library can do both; the difference is what you assert. Default to stubs + state assertions; reach for mocks only when the call itself is the contract.

---

## The Five Doubles

**Q: Give a one-line code example of each double.**
*Can you actually use them, not just define them?*
**A (Python, `unittest.mock` + a hand-rolled fake):**
```python
dummy  = object()                              # passed, never used
stub   = Mock(); stub.get.return_value = "Ada" # canned answer
spy    = Mock(); ...; spy.send.assert_called() # stub + records calls
mock   = Mock(); mock.send.assert_called_once_with(msg)  # verifies expectation
class FakeRepo:                                # working in-memory impl
    def __init__(self): self.d = {}
    def save(self, u): self.d[u.id] = u
    def get(self, i):  return self.d.get(i)
```

**Q: When would you prefer a fake over a stub?**
*Depth on the most underused double.*
**A:** When the test makes a *sequence* of calls that must stay consistent — save then fetch then update. A stub answers one canned value per call and drifts out of sync; a fake is a real implementation (backed by a map) that stays internally consistent across the whole test. Fakes also enable state verification on near-real objects and scale across a whole test class. Google's testing guidance explicitly prefers fakes to mocks for this reason.

**Q: What's the difference between a spy and a mock?**
*Subtle but real.*
**A:** Both record interactions. A **spy** records silently and you assert at the *end* of the test (verification after the fact). A **mock** has expectations set *up front* and verifies itself — strict mocks fail immediately on an unexpected call. Spies tend to read more naturally and couple less tightly.

---

## Technique

**Q: How do you test "this token expires after one hour" without waiting an hour?**
*Faking the clock — a classic.*
**A:** Never `sleep`. Inject a `Clock` interface instead of calling `time.Now()` directly; in the test pass a fake clock you set to a fixed time, issue the token, then *advance* the fake clock by 61 minutes and assert the token is expired. Deterministic and instant. Same principle for any time-based logic.

**Q: How do you make a test involving randomness deterministic?**
*Faking nondeterminism.*
**A:** Inject the random source (or a seed) rather than calling a global `random()`. Pass a seeded RNG (`random.Random(42)`, an injected `rand.Source`) so "random" choices are reproducible — same result every run, and debuggable. The general rule: anything nondeterministic becomes an injected dependency.

**Q: How do you test code that calls an HTTP API, without hitting the network?**
*Faking HTTP — and the contract-testing follow-up.*
**A:** Stand up a fake HTTP server returning canned responses — Go's `httptest`, or WireMock in the JVM/JS world — and point your real client at it. This exercises your actual URL building, headers, and JSON decoding against controlled responses, which is far better than mocking your HTTP client object (that skips the serialization path where bugs live). Caveat: this still tests *your model* of the external API. The honest verification that you match the real provider is **contract testing**.

**Q: What makes dependency injection necessary for all this?**
*The enabler.*
**A:** You can only substitute a double if the collaborator is *passed in* rather than constructed inside the code. DI creates the *seam* where a double slots in. Code that does `self.db = PostgresDatabase()` in its constructor is untestable without a double; code that takes `db` as a parameter can receive a fake. Untestable code is usually a DI problem.

---

## Classical vs Mockist

**Q: Explain the classical (Detroit) vs mockist (London) schools.**
*Do you understand the schools or just the buzzwords?*
**A:** **Classical/Detroit** uses real objects wherever practical, doubles only *awkward* collaborators (slow/nondeterministic/side-effecting), prefers **fakes**, and verifies **state**. **Mockist/London** mocks *every* collaborator of the unit, verifies **interactions**, and uses that to drive design outside-in (you discover the interfaces a class needs by mocking them). Trade-off: London gives sharp failure localization and design pressure but produces more brittle tests; Detroit gives refactor-resilient tests with broader failure scope.

**Q: Which does the industry lean toward, and why?**
*Judgment, not dogma.*
**A:** The consensus leans **classical** for the resulting test suite, because mock-everything tests couple to implementation and break on every refactor. Two cross-cutting rules dominate: **"don't mock what you don't own"** and **"prefer fakes/real objects to mocks."** That said, London-style mocking is a great *design* tool during TDD. Most strong teams blend them: London thinking to discover interfaces, Detroit verification to keep the tests robust.

**Q: What does "don't mock what you don't own" mean, and what's the alternative?**
*The senior rule.*
**A:** Don't create a double for a third-party type (SDK, driver, HTTP client). Two reasons: you'd be mocking your *mental model* of the library, which is often wrong (you stub success; production hits throttling or partial failure), and you couple tests to an interface you can't control. Instead, **wrap** the library behind a port you own, **fake the wrapper** in unit tests, and cover the thin adapter with integration tests. The truth about the real external service comes from **contract testing**, not a mock you invented.

---

## Scenarios

**Q: A teammate's test mocks five collaborators and asserts each was called with specific arguments. What's your feedback?**
*The over-mocking diagnosis.*
**A:** It's likely a **tautological / change-detector test**: it verifies the call graph, not behavior. If the return values are all stubbed, it proves nothing about correctness, yet it'll break on any refactor that preserves behavior — coupled to implementation, decoupled from behavior. I'd ask: can we use a fake repo and assert on the *resulting state* instead? And five mocks suggests the class has too many responsibilities — a design smell worth a refactor (SRP). Keep a mock only for any genuine interaction contract (e.g. an event that must be published).

**Q: When is a mock genuinely the right tool?**
*Avoids the never-mock overcorrection.*
**A:** When the **interaction itself is the observable behavior** and there's no state to assert: "publish exactly one `OrderPlaced` event," "must *not* charge an empty cart" (asserting a call's absence), "emit an audit log on each privileged action," "retry exactly three times." In all of these the call *is* the deliverable. Even then, assert the **payload and count**, not just that something was called.

**Q: Your in-memory fake repo passes all unit tests, but production breaks on a duplicate key. What went wrong and how do you prevent it?**
*Fake fidelity.*
**A:** The fake **drifted** from reality — it didn't enforce the unique constraint the real DB does, so it green-lit broken code. A drifting fake is worse than a mock because it's a confident liar. Prevent it with a **shared contract test**: one behavioral suite run against *both* the fake and the real implementation (the real side in the integration tier against an ephemeral DB). If the fake doesn't enforce uniqueness, the suite catches the divergence.

**Q: You're scoping a migration from one database to another. How does mocking strategy affect the cost?**
*The professional-tier migration tax.*
**A:** If the old DB client was mocked directly across hundreds of unit tests, those mocks are welded to the old interface — you rewrite them all, and that often dominates the migration estimate. If instead the DB sat behind a port with a fake, you rewrite one adapter and its integration tests; the unit tests are untouched. I'd quantify it ("~4 of 6 weeks is rewriting brittle mocks") to justify investing in wrapping and fakes — it's a migration-enabling investment, not a nicety.

---

## Rapid-Fire

**Q: A double passed but never used?** — Dummy.
**Q: Returns canned answers?** — Stub.
**Q: Stub that records calls?** — Spy.
**Q: Verifies an expected interaction?** — Mock.
**Q: A working in-memory implementation?** — Fake.
**Q: Stubs support which verification?** — State.
**Q: Mocks do which verification?** — Behavior.
**Q: Which double is most refactor-resilient?** — Fake (with state assertions).
**Q: Never mock what you don't ____?** — Own.
**Q: Better than mocking an HTTP client object?** — `httptest`/WireMock against a fake server.
**Q: What makes substitution possible?** — Dependency injection (the seam).
**Q: Don't `sleep` in time tests — instead?** — Inject and advance a fake clock.
**Q: Reproducible randomness?** — Injected seeded RNG.
**Q: Mock-everything tests are called?** — Tautological / change-detector tests.
**Q: The honest answer to verifying an external API?** — Contract testing.
**Q: Tool — Java?** — Mockito. **Go?** — gomock / testify mock (or hand-rolled). **Python?** — `unittest.mock`. **JS?** — Jest / Sinon. **Rust?** — mockall.
**Q: Five doubles needed for one class signals?** — A design smell (too many responsibilities).
**Q: Assert just `called`, or `called_with` + count?** — Payload + count.

---

## Red Flags / Green Flags

**Red flags**
- Calls every double a "mock"; can't distinguish stub from mock.
- Reaches for `verify` / `assert_called` by default, asserting nothing about results.
- Mocks third-party SDKs directly and sees no problem.
- Thinks coverage from mock-heavy tests means safety.
- Either "always mock everything" or dogmatically "never mock" — no nuance.
- `sleep()`s in tests; reads the real clock/random in production code.

**Green flags**
- Names the five doubles precisely and uses the words correctly.
- Defaults to **state verification with fakes**; reserves mocks for interaction contracts.
- States "don't mock what you don't own" and offers wrapping + contract testing as the fix.
- Treats a mock-heavy suite as a *design* smell and a *migration* liability.
- Injects clock/randomness/HTTP for determinism without prompting.
- Knows the few cases a mock is genuinely right and asserts payload + count.

---

## Cheat Sheet

```
FIVE DOUBLES (Meszaros) — say them cold
  dummy → fills a slot, unused
  stub  → canned answers (feeds input)        ┐
  spy   → stub + records calls                ├ state verification (assert RESULT) ← default
  fake  → working in-memory impl              ┘
  mock  → pre-set expectations, verifies call   behavior verification (assert CALL) ← when call IS contract

SCHOOLS
  Detroit/classical: mock awkward boundaries only, prefer fakes, verify state   ← consensus lean
  London/mockist   : mock every collaborator, verify behavior, drives TDD
  rules: don't mock what you don't own • prefer fakes to mocks

OVER-MOCKING = SMELL
  mock-all → tautological/change-detector → brittle on refactor, proves nothing
  fix: real/fake + state assertion; >3 doubles = SRP problem

DETERMINISM (inject it)
  clock → fake clock you advance (never sleep) • random → seeded RNG
  HTTP → httptest/WireMock • external truth → CONTRACT TESTING

MOCK IS RIGHT WHEN
  interaction is the contract: publish one event • forbid a call • audit • retry-count
  → assert payload + count
```

---

## Summary

This topic rewards **precision and judgment**. Know Meszaros's five doubles cold — dummy, stub, spy, mock, fake — and the verification split: stub/spy/fake support **state** verification (assert the result), mock does **behavior** verification (assert the call). The dominant trade-off is brittleness: state-based tests survive refactors, behavior-based tests couple to implementation, so the consensus leans **classical/Detroit** — mock only awkward boundaries, **prefer fakes to mocks**, and **don't mock what you don't own** (wrap third-party libs, fake the wrapper, verify the seam with contract testing). The central smell is **over-mocking**: tautological change-detector tests that prove nothing and break on every refactor, often signaling a design problem. The mature position avoids both dogmas — it reserves mocks for the narrow cases where the **interaction is the contract** (publish exactly one event, never charge an empty cart) and even then asserts payload and count. Inject the clock, randomness, HTTP, and filesystem to make tests deterministic. Say the words correctly and your judgment shows.

---

## Further Reading

- Martin Fowler — *Mocks Aren't Stubs* (the canonical state-vs-behavior, Detroit-vs-London essay).
- Gerard Meszaros — *xUnit Test Patterns* (the taxonomy, defined).
- Freeman & Pryce — *Growing Object-Oriented Software, Guided by Tests*; *Mock Roles, Not Objects*.
- Vladimir Khorikov — *Unit Testing Principles, Practices, and Patterns*.
- Google — *Software Engineering at Google*, testing chapters (fakes at scale).
- The `mocking-strategies`, `dependency-injection`, and `unit-testing-patterns` skills.

---

## Related Topics

- [Unit Testing — Interview](../02-unit-testing/interview.md) — the broader testing question bank.
- [Integration Testing](../03-integration-testing/interview.md) — when real collaborators beat doubles.
- [Contract Testing](../05-contract-testing/interview.md) — the honest answer to external dependencies.
- [Test Doubles — Senior](senior.md) / [Professional](professional.md) — the depth behind these answers.
