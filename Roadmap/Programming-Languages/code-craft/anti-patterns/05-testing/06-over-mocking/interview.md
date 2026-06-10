# Over-Mocking — Interview Questions

> **Category:** [Testing Anti-Patterns](../README.md) → **Over-Mocking** — *mocking so much that the test verifies the mocks, not the behavior.*

---

This file is **interview preparation** across all levels. Questions run from "what is a stub" through the mockist/classicist debate and consumer-driven contracts. Each answer is what a strong candidate would say out loud — concise, correct, and showing judgment, not just recall.

> **How to use this file:** cover the answer, say yours aloud, then compare. The signal an interviewer is listening for is whether you can *decide* — pick the right double for a collaborator and justify it — not whether you can recite the taxonomy.

---

## Table of Contents

1. [Fundamentals & Taxonomy](#fundamentals--taxonomy)
2. [State vs Interaction Testing](#state-vs-interaction-testing)
3. [What to Mock — and What Not To](#what-to-mock--and-what-not-to)
4. [Classicist vs Mockist](#classicist-vs-mockist)
5. [Design Feedback & False Confidence](#design-feedback--false-confidence)
6. [Contract Tests & Scenarios](#contract-tests--scenarios)

---

## Fundamentals & Taxonomy

**Q1. What is over-mocking, in one sentence?**

> Replacing so many collaborators with mocks (or verifying so many interactions) that the test asserts on *which methods were called* instead of *what the code actually did* — producing tests that stay green when the real behavior is broken and break when you refactor.

**Q2. Name the five kinds of test double and distinguish them.**

> **Dummy** — a placeholder passed to satisfy a signature, never actually used. **Stub** — returns canned answers to feed input into the test; you don't assert on it. **Spy** — a stub that also records how it was called, so you can inspect calls afterward. **Mock** — pre-programmed with expectations; the test fails if those interactions don't occur. **Fake** — a working but simplified implementation (e.g. an in-memory repository) you assert state on. The umbrella term for all five is *test double*.

**Q3. What's the difference between a stub and a mock?**

> A stub *provides input* — it answers questions with canned values and you never assert on it. A mock *verifies interactions* — it carries an expectation and fails the test if the expected call doesn't happen. The over-mocking smell is using a mock (with `verify`) where a stub was all you needed: you've turned an incidental implementation call into a test requirement.

**Q4. What's the difference between a mock and a fake?**

> A mock asserts on the *call* (`verify(repo).save(x)`). A fake is a real, working in-memory implementation, so you assert on the *resulting state* (`repo.findById(id)` returns the saved value). For stateful collaborators the fake is usually better: it survives refactoring because it doesn't care *how* the state was reached, only that the outcome is correct.

**Q5. Is a spy a mock?**

> Not quite — a spy is a *recording stub*. It captures calls and arguments, and you assert on the recorded data *after* the action (state-style), rather than pre-declaring expectations that fail mid-run (mock-style). Spies are often a more robust way to check an interaction than a strict mock, because they don't enforce ordering or "no other calls" unless you ask.

**Q6. Why is calling everything a "mock" itself a problem?**

> Imprecise language drives imprecise tooling. If every double is "a mock," you reach for `mock()` reflexively even when a stub, fake, or real object was correct — which is the road into over-mocking. Naming the double precisely forces you to pick the *least powerful* tool that does the job.

---

## State vs Interaction Testing

**Q7. Define state testing and interaction testing.**

> State testing asserts on the observable result — a return value or the final state of the system ("after deposit, balance == 150"). Interaction testing asserts on which calls were made to collaborators ("`save` was called once with this order"). State tests verify behavior and survive refactors; interaction tests verify the call protocol and are coupled to implementation.

**Q8. Which should you prefer by default, and why?**

> State testing, by default. It checks what the code actually accomplished, so it catches real bugs and doesn't break when you refactor the internals. Interaction testing is for the minority of cases where there *is* no observable state — the effect leaves the system (an event, an email) with no local trace to read back.

**Q9. A test ends with only `verify(repo).save(any())`. What's wrong with it?**

> It asserts that `save` was *called*, not that anything correct was saved, nor that saving worked. If the production logic computed the wrong value — or `save` itself is broken — the test still passes. It also breaks if you ever rename or restructure `save` without changing behavior. It's checking calls, not behavior.

**Q10. How do you make that assertion meaningful?**

> Either pin the argument (`verify(repo).save(argThat(o -> o.total() == 150))`) so wrong data is caught, or — better for stateful collaborators — use a fake and assert on the state read back (`repo.findById(id).total() == 150`), which also survives refactoring of *how* the save happens.

**Q11. How can you tell if a test is over-mocked with one quick check?**

> Delete a line of the production logic (e.g. the line that actually mutates state) and rerun. If no test goes red, the tests are asserting on calls, not behavior — they're over-mocked. A behavior test would fail the moment the logic changed.

---

## What to Mock — and What Not To

**Q12. What's the single question that decides whether to mock a collaborator?**

> "Is it a true architectural boundary?" — network, clock/randomness, an external service you own an interface for, the filesystem. Boundaries get doubles. Everything in the core — domain logic, value objects, pure calculations — runs for real, because exercising it is the whole point of the test.

**Q13. Why shouldn't you mock value objects?**

> A value object (`Money`, `Date`, `Order`) is pure data and behavior with no I/O and no boundary to isolate. Mocking it replaces real arithmetic and comparisons with canned answers, deleting the exact logic the test should verify. You construct value objects for real.

**Q14. Explain "don't mock what you don't own."**

> Don't write mocks for third-party types (SDK clients, DB drivers, framework classes). A mock of code you don't control encodes *your guess* about its contract; if the real thing behaves differently, your test passes against a fiction, and it couples your suite to their API surface. Instead, define a narrow interface *you* own, wrap the third party in a thin adapter, mock *your* interface in unit tests, and integration-test the adapter against the real dependency.

**Q15. You depend on a `UserRepository`. Mock it or fake it?**

> Fake it. A repository is stateful (save then get), and a mock has no memory — you'd script every return and could only assert calls. A fake holds real state, so the test can save, act, and read the result back, asserting on the actual outcome and surviving refactors. Write the fake once and reuse it across the suite.

**Q16. Should you verify a call to a getter / query method?**

> No. Queries have no side effects, so there's nothing to verify — `verify(repo).findById(id)` asserts an implementation detail with no behavioral meaning. Stub the query to feed input; only verify *commands* whose sole observable effect is the call itself.

**Q17. How do you isolate the clock or randomness without over-mocking?**

> Inject them as collaborators and stub a fixed value (`clock.now() → fixed timestamp`, `rng → seeded`). That's a legitimate boundary — non-determinism is exactly what you isolate — and it's a stub feeding input, not a mock verifying interactions. Better still, pass `now` as a parameter to a pure function so there's no clock dependency at all.

**Q18. What's a deep stub chain and why is it a smell?**

> A mock of a navigation path: `when(a.getB().getC().doD())...`. To write it you had to freeze the entire chain, so any change to how the data is reached breaks the test. It's a symptom of train-wreck coupling (Law of Demeter violation). The fix is in production code: pass the needed value directly, or have the object answer the question itself — then no chain mock is needed.

---

## Classicist vs Mockist

**Q19. What's the difference between the classicist and mockist schools?**

> Classicist (Detroit): use real collaborators wherever practical, substitute doubles only at awkward boundaries, and assert on final *state*; tests are *sociable* (exercise a cluster of real objects). Mockist (London): mock each collaborator role and assert on *interactions*; tests are *solitary* (isolate one object). Classicist favors refactor-safety; mockist favors sharp failure localization and design pressure.

**Q20. What are the failure modes of each?**

> Classicist: coarser failure localization (a red test could implicate several real objects) and sometimes awkward setup of large object graphs. Mockist: coupling to the interaction protocol, so refactors break tests even when behavior is unchanged — and, when applied carelessly, it slides straight into over-mocking.

**Q21. Is the London/mockist school the same as over-mocking?**

> No — that's a common misconception. The London school as Freeman & Pryce describe it has strict guardrails: mock *roles* not objects, never mock value objects, never mock what you don't own, mock only at the boundaries of your own code. Over-mocking is *degenerate* mockism that ignores those rules — mocking concrete classes, values, and queries, and verifying every call. Most "mockist tests are brittle" complaints are really about bad mockist tests.

**Q22. Where do you personally land?**

> Pragmatic, per-seam. Classicist by default for the domain core — real objects, state assertions, large pure units are fine and durable. Disciplined mockist at the few boundaries where the call is the only observable effect (outbound ports, notifiers). I choose based on what's observable, not by allegiance, and I treat degenerate mockism as something to catch in review.

**Q23. How does the mockist school claim to improve *design*?**

> By forcing you, outside-in, to articulate the role each collaborator plays before it exists — "what do I need to ask this thing?" That pressure surfaces small, focused interfaces and a tell-don't-ask style. The risk is that the same pressure, unchecked, mocks things that didn't need an interface, feeding over-abstraction.

---

## Design Feedback & False Confidence

**Q24. A teammate says a service is "impossible to test without ten mocks." What's your read?**

> That's a design smell, not a testing problem. Ten mocks means ten dependencies — a class with too many responsibilities, or I/O tangled into its logic. The fix is in the production code: split the class, push I/O to the edges, depend on narrow interfaces. Writing the ten mocks would just cement the bad design behind a fragile test.

**Q25. Roughly, how many mocks *should* a unit test need?**

> About as many as the unit has true boundaries — usually zero to two. A pure domain function needs none. A use-case service typically needs a fake repo and maybe a stubbed clock. If the number climbs, treat it as a readout of how many boundaries the unit touches, and reduce the boundaries, not the mock-writing effort.

**Q26. What is false confidence in this context?**

> Mocks freeze a snapshot of how a dependency behaves. When reality drifts — the real `save` breaks, or an external API adds a new state — the mock keeps returning the old scripted answer, so the test stays green while production is broken. The suite doesn't just fail to catch the bug; it actively hides it. That's the most expensive failure mode because you discover it in production.

**Q27. Give a concrete drift example.**

> You stub a payment client's `charge()` to return `"succeeded"`. Later the provider adds async settlement, and real charges return `"pending"` first. Your code assumes `"succeeded"` means captured and ships goods on unsettled payments. Every unit test is green because the mock never learned about `"pending"`. Only an integration or consumer-driven contract test against the real provider catches it.

**Q28. How do over-mocking and over-abstraction reinforce each other?**

> Every speculative interface (a port with one real implementation, added "for flexibility") is a mock magnet — it exists to be substituted, so tests substitute it, adding interaction coupling without testing real behavior. The cure for both is one move: delete abstractions that exist only to be mocked, and assert on behavior with real objects.

**Q29. How does over-mocking relate to fragile tests?**

> They're two faces of the same root. Asserting on the call protocol couples the test to *how* the code works, so any refactor that changes the internal conversation breaks the test though behavior is unchanged — that *is* a fragile test. Reduce over-mocking (assert outcomes, mock only boundaries) and fragility drops with it.

---

## Contract Tests & Scenarios

**Q30. What's a contract test and how does it relate to mocking?**

> A contract test verifies that a real implementation honors the behavioral promises your double assumes. In-process: write the port's expectations once and run them against both the fake and the real adapter, so the fake can't drift. Cross-service: a consumer-driven contract records what your mock assumes about another team's API and has *them* verify it against their real service in their pipeline. Contract tests are what make "mock at the boundary" honest rather than a frozen guess.

**Q31. When is a mock of an external service acceptable?**

> Only when a higher-fidelity test covers the same seam — an integration test against a sandbox/testcontainer, or a consumer-driven contract the provider verifies. A mocked external boundary with no such backstop is an unbacked promise: it's the textbook false-confidence configuration. The mock is fine for speed; the missing backstop is the bug.

**Q32. Name a case where verifying an interaction is genuinely the *right* test.**

> An outbound, side-effect-only collaborator: "when an order ships, publish a `ShipmentRequested` event." The event leaves the system with no local state to read back, so the only observable behavior *is* the publish call. You verify it — but you verify the *arguments* (the payload), not just that some call happened, and you prefer a recording fake/spy over a strict mock so you don't over-specify ordering.

**Q33. You're testing `OrderService.place(order)` that validates, prices, persists, and emails a confirmation. How do you set up the doubles?**

> Use the real `Order` and pricing logic (value objects / pure logic — no doubles). Fake the repository so I can assert the order was persisted with the correct total by reading it back. Stub the clock if timestamps matter. The mailer is a side-effect-only outbound port, so verify `send` was called with the right recipient and template — ideally via a recording fake. Then a separate integration test covers the real DB and SMTP adapters.

**Q34. Your colleague mocks the `java.time.Clock` *and* the `HashMap` your code uses internally. What do you say in review?**

> Mocking the clock is fine — it's a real boundary (non-determinism). Mocking the internal `HashMap` is over-mocking: it's an implementation detail and a type you don't own, with no boundary to isolate. The map should run for real so the test verifies actual behavior; if anything, the fact that we *can* reach in and mock internal collaborators suggests the unit is exposing too much.

**Q35. How would you refactor a class so its core needs no mocks at all?**

> Apply functional core / imperative shell. Extract the decision-making into pure functions that take data in and return data (or a description of what to do) out — no I/O. Test that core with real values and zero doubles. Leave a thin imperative shell that performs the I/O the core decided on, and cover that with a handful of integration tests. The logic worth testing thoroughly no longer touches boundaries, so the need to mock evaporates.

**Q36. Final: summarize your rule for mocking in one sentence.**

> Assert on what's observable, double only at real boundaries you own an interface for, never mock value objects or what you don't own, and never let a boundary double stand without a higher-fidelity (integration or contract) test behind it.

---

## Related Topics

- [`junior.md`](junior.md) — what over-mocking looks like; state vs interaction.
- [`middle.md`](middle.md) — when to mock vs fake; don't-mock-what-you-don't-own.
- [`senior.md`](senior.md) — design-smell reading; functional core; contract tests.
- [`professional.md`](professional.md) — the full mockist/classicist debate; the taxonomy; false-confidence economics.
- [`tasks.md`](tasks.md) and [`find-bug.md`](find-bug.md) — practice the same judgment hands-on.
- [Fragile Tests](../01-fragile-tests/interview.md) — the closely related anti-pattern.
- The `mocking-strategies`, `dependency-injection`, and `integration-testing` skills.
