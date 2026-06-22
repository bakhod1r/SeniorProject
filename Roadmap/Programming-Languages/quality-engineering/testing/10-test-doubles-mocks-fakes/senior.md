# Test Doubles: Mocks & Fakes — Senior Level

> **Roadmap:** [Testing](../README.md) → Test Doubles: Mocks & Fakes
>
> *Most mock-heavy tests prove only that the code calls the methods the code calls. The senior skill is designing so you need almost none of them.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Over-Mocking Trap](#core-concept-1--the-over-mocking-trap)
5. [Core Concept 2 — Tautological Tests: Before and After](#core-concept-2--tautological-tests-before-and-after)
6. [Core Concept 3 — Don't Mock What You Don't Own](#core-concept-3--dont-mock-what-you-dont-own)
7. [Core Concept 4 — Wrap, Then Fake the Wrapper](#core-concept-4--wrap-then-fake-the-wrapper)
8. [Core Concept 5 — Design for Testability: Fewer Doubles by Construction](#core-concept-5--design-for-testability-fewer-doubles-by-construction)
9. [Core Concept 6 — When a Mock Is Genuinely the Right Tool](#core-concept-6--when-a-mock-is-genuinely-the-right-tool)
10. [Core Concept 7 — Tools by Ecosystem, and Their Default Pull](#core-concept-7--tools-by-ecosystem-and-their-default-pull)
11. [Real-World Examples](#real-world-examples)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **recognizing over-mocking as a design smell, applying "don't mock what you don't own," and architecting code so you need far fewer doubles in the first place.**

By now you know the taxonomy and the two verification styles. The senior shift is from *how to write a double* to *how to avoid needing one*. The biggest failure mode in real test suites isn't too few mocks — it's too many: tests so coupled to implementation that every refactor turns red while no behavior changed. These tests are **tautological** (they assert the code does what the code does) and **brittle** (they break for the wrong reasons), and they actively discourage the refactoring they were meant to enable.

This level dissects that trap, gives you the rules and design moves to escape it, and — crucially — pins down the cases where a mock genuinely *is* the right tool, so you don't overcorrect into never using one.

---

## Prerequisites

- State vs behavior verification and the Detroit/London schools ([middle.md](middle.md)).
- You can build a real fake behind an interface and run a shared contract suite against fake and real.
- Comfortable with ports-and-adapters / hexagonal architecture at a conceptual level.
- Familiar with refactoring under test (the `refactoring-techniques` skill).

---

## Glossary

| Term | Meaning |
|---|---|
| **Over-mocking** | Mocking so many collaborators that tests verify call structure rather than behavior. A design smell. |
| **Tautological test** | A test whose assertions restate the implementation — it can only pass if the code does exactly what it does. Proves nothing. |
| **Brittle test** | Breaks on internal change despite unchanged observable behavior. |
| **Don't mock what you don't own** | Rule: never double a third-party type directly; wrap it and fake your wrapper. |
| **Port / adapter** | A domain-owned interface (port) implemented by an infrastructure adapter — the seam where doubles belong. |
| **Functional core, imperative shell** | Pure logic (no I/O, trivially testable without doubles) wrapped by a thin I/O layer (tested with a few fakes). |
| **Interaction-as-contract** | A case where the *call itself* is the required behavior (e.g. "publish exactly one event"), legitimately warranting a mock. |

---

## Core Concept 1 — The Over-Mocking Trap

When you mock every collaborator, your test stops describing *behavior* and starts describing *the call graph*. Consider a `PriceCalculator` whose only real job is arithmetic, but whose test mocks everything it touches:

```python
def test_total_price():
    discounts = Mock(); taxes = Mock(); rounding = Mock()
    discounts.apply.return_value = 90
    taxes.apply.return_value = 99
    rounding.apply.return_value = 99
    calc = PriceCalculator(discounts, taxes, rounding)

    calc.total(100)

    discounts.apply.assert_called_once_with(100)
    taxes.apply.assert_called_once_with(90)
    rounding.apply.assert_called_once_with(99)
```

What does this verify? Only that `total` calls `discounts.apply`, then `taxes.apply`, then `rounding.apply`, in that order, with those arguments. It says **nothing** about whether the final price is correct — every return value was made up. If you reorder tax and discount (a real behavior change!) but keep the same call sequence, the test might still pass; if you refactor the *exact same result* into two steps instead of three, it fails. The test is **coupled to the implementation and decoupled from the behavior** — the worst possible combination. This is the over-mocking trap, and it's the central failure of mock-heavy suites.

---

## Core Concept 2 — Tautological Tests: Before and After

The fix is almost always to **replace mocks with real objects or fakes and assert on the result.**

**Before — tautological, mock-everything:**

```python
def test_register_user():
    repo = Mock(); hasher = Mock(); emailer = Mock()
    hasher.hash.return_value = "HASHED"
    svc = SignupService(repo, hasher, emailer)

    svc.register("ada@x.io", "pw")

    hasher.hash.assert_called_once_with("pw")
    repo.save.assert_called_once()                    # what got saved? unchecked
    emailer.send.assert_called_once()                 # to whom? unchecked
```

This passes whether or not the saved user is correct. Rename `hash` to `derive` and it breaks despite identical behavior.

**After — real value logic, fake repository, assert on state:**

```python
def test_register_persists_a_user_with_a_hashed_password():
    repo = InMemoryUserRepo()              # FAKE, real round-trip behavior
    svc = SignupService(repo, BcryptHasher(), spy_emailer := SpyEmailer())

    svc.register("ada@x.io", "pw")

    saved = repo.get_by_email("ada@x.io")  # assert on actual STATE
    assert saved is not None
    assert saved.password_hash != "pw"     # really hashed
    assert BcryptHasher().verify("pw", saved.password_hash)
    assert spy_emailer.sent_to == ["ada@x.io"]   # behavior only where it IS the contract
```

The "after" test checks what *actually matters*: a user with a correctly hashed password exists and a welcome email went to the right address. It survives renaming internal methods, reordering steps, and re-implementing the hasher — because it asserts on **observable outcomes**, not call structure. Note the deliberate split: state for persistence, behavior (spy) only for the email, which genuinely *is* a required side effect.

---

## Core Concept 3 — Don't Mock What You Don't Own

Steve Freeman and Nat Pryce's rule: **never create a double for a type you don't own** — a third-party SDK, a database driver, an HTTP client. Two reasons:

1. **You mock your *mental model* of the library, which is often wrong.** You stub `s3.PutObject` to return success, but you don't know it can throw `SlowDown`, partial-failure, or eventual-consistency surprises. Your test passes against your fantasy of the API; production meets the real one. The mock *lies* — and it lies confidently.
2. **You couple your tests to an interface you can't control.** When the vendor changes a signature, your hand-built mock silently keeps matching the *old* shape, so your green tests no longer reflect reality.

The honest verification that your code works against a real external service is **contract testing** ([05-contract-testing](../05-contract-testing/senior.md)) — recording or asserting the real request/response shape against the actual provider — not a mock you invented. Mocks tell you "given my assumptions, my code is consistent"; contract tests tell you "my assumptions match reality."

---

## Core Concept 4 — Wrap, Then Fake the Wrapper

If you don't mock the library, how do you keep its slowness and nondeterminism out of unit tests? You **wrap** it behind a thin interface *you* own (a port), and fake *that*.

```go
// A port YOU own — your domain's vocabulary, not the vendor's.
type FileStore interface {
    Put(key string, data []byte) error
    Get(key string) ([]byte, error)
}

// Adapter: the ONLY place the third-party SDK appears.
type s3Store struct{ client *s3.Client }
func (s *s3Store) Put(key string, data []byte) error { /* real SDK calls */ }

// Fake YOU own — safe to use everywhere in tests.
type memStore struct{ m map[string][]byte }
func (s *memStore) Put(key string, data []byte) error { s.m[key] = data; return nil }
func (s *memStore) Get(key string) ([]byte, error)    { return s.m[key], nil }
```

Now domain code depends on `FileStore`, unit tests inject `memStore`, and the *only* code that touches the real SDK is the tiny `s3Store` adapter — which you cover with a small set of **integration tests** against a real (or LocalStack) S3. You've localized the untrustworthy boundary to one thin, separately tested layer. This is the practical synthesis of "don't mock what you don't own" + ports-and-adapters.

---

## Core Concept 5 — Design for Testability: Fewer Doubles by Construction

The deepest senior move: **structure code so most of it needs no doubles at all.**

- **Functional core, imperative shell.** Push pure logic (calculations, decisions, transformations) into functions with no I/O. Pure functions need *zero* doubles — just inputs and outputs, state verification. Keep the I/O in a thin shell that you cover with a handful of fakes. Most over-mocked tests exist because business logic is tangled with I/O; separate them and the mocks evaporate.

```python
# Pure core — no doubles needed, ever.
def decide_renewal(subscription, now) -> Decision:
    if subscription.expires_at <= now:
        return Decision.RENEW
    return Decision.SKIP

# Thin shell — the only part that needs a fake clock / repo.
def run_renewals(repo, clock, gateway):
    for sub in repo.due():
        if decide_renewal(sub, clock.now()) is Decision.RENEW:
            gateway.charge(sub)
```

The interesting logic (`decide_renewal`) is tested with plain values. Only the orchestration touches the clock, repo, and gateway.

- **Ports and adapters.** Doubles belong at *architectural boundaries* (ports), and there should be few of them. If a class has eight collaborators all needing mocks, that's a design smell — it's doing too much (violates SRP; see the `solid-principles` skill).
- **Prefer values to collaborators.** A method that takes the data it needs as arguments needs no double; a method that reaches out to fetch that data does. Pass data in.

**A mock-heavy suite is feedback about your design, not just your tests.** When you find yourself needing many mocks, the fix is usually to refactor the production code, not to write better mocks.

---

## Core Concept 6 — When a Mock Is Genuinely the Right Tool

Overcorrecting into "never mock" is also wrong. A mock is the *correct* tool when **the interaction itself is the observable behavior — there is no state to assert.** The contract is "you must make this call."

Canonical cases:

- **"Must publish exactly one `OrderPlaced` event."** The event publication *is* the requirement; there's no resulting state in your unit to check. A spy/mock asserting one publish with the right payload is exactly right.
- **"Must not call the payment gateway when the cart is empty."** Verifying a call *didn't* happen is a behavior assertion with no state equivalent.
- **"Logs an audit record on every privileged action."** The side effect is the point.
- **Notifying / fire-and-forget side effects** where the SUT returns nothing meaningful.

```python
def test_empty_cart_does_not_charge():
    gateway = Mock()
    Checkout(gateway).submit(cart=EmptyCart())
    gateway.charge.assert_not_called()        # the absence of a call IS the contract
```

The test: *is the call genuinely the contract, or am I just unable to see the resulting state?* If there's state to assert, assert it. If the call truly is the deliverable, mock it — and assert the **payload and count**, not just that *something* was called.

---

## Core Concept 7 — Tools by Ecosystem, and Their Default Pull

Each tool nudges you toward a style; know the pull and resist when needed.

- **Mockito (Java).** `when(repo.find(7)).thenReturn(user)` for stubbing; `verify(emailer).send(msg)` for behavior. Powerful and ubiquitous — and *easy to overuse*. Prefer `when/thenReturn` (stub) and reserve `verify` for true interaction contracts.
- **gomock (Go).** Code-generated mocks with strict expectations (mockist by default — unmet expectations fail). Heavy; for most Go code a **hand-rolled fake/spy struct** or `testify`'s `mock.Mock` is lighter and clearer.
- **testify mock (Go).** `m.On("Find", 7).Return(user)` + `m.AssertExpectations(t)`. Convenient, but the same over-mocking risk.
- **unittest.mock (Python).** One `Mock`/`MagicMock` is stub, spy, and mock depending on use. `return_value` (stub), `assert_called_with` (spy/mock). Flexible; name them by role for clarity.
- **Jest / Sinon (JS/TS).** `jest.fn().mockReturnValue(...)` (stub), `expect(fn).toHaveBeenCalledWith(...)` (behavior); Sinon distinguishes `stub`/`spy`/`mock` explicitly — use that vocabulary.
- **mockall (Rust).** `#[automock]` generates a mock from a trait; expectations via `expect_find().returning(...)`. Trait-based, so it pairs naturally with ports.

The pattern across all of them: the framework makes *behavior verification* one line, so teams reach for it reflexively. Senior discipline is to lean on **stubbing + state assertions**, and use the `verify`/`AssertExpectations`/`toHaveBeenCalled` family only where the interaction is the contract.

---

## Real-World Examples

- **A green suite that broke on every refactor.** Diagnosis: 90% behavior verification over mocked collaborators. Fix: introduce fakes behind ports, switch to state assertions; refactors stopped reddening tests.
- **A mock that lied about S3.** Tests stubbed `PutObject` → success; production hit `SlowDown` throttling and lost data. Fix: thin S3 adapter + integration tests against LocalStack; unit tests use an in-memory `FileStore` fake.
- **Event-sourced service.** "Exactly one `OrderPlaced` emitted" is correctly a mock/spy assertion — there's no other observable outcome in the unit.
- **Untangling a god-service.** A class with seven mocked dependencies was split into a pure pricing core (no doubles) and a thin orchestrator (two fakes). Test count dropped, coverage of *behavior* rose.

---

## Mental Models

- **Mocks couple, fakes free.** Each `verify` ties a test to a line of implementation. Each fake lets that implementation change freely.
- **Many mocks = design smell.** If a test needs five mocks, the production code is doing five things. Fix the code.
- **Mock the boundary you own, fake nothing you don't.** Doubles live at ports; third-party types get wrapped, never mocked.
- **Pure core, no doubles.** Logic with no I/O needs no scaffolding. Maximize that surface; minimize the shell.
- **Behavior verification is a scalpel, not a hammer.** Reserve it for interaction-is-the-contract cases.

---

## Common Mistakes

- **Mocking everything "for isolation"** and ending up with tautological tests that survive nothing but a no-op.
- **Mocking third-party SDKs directly**, encoding a wrong mental model that production later violates.
- **Asserting `assert_called` with no payload check** — "something was called" is nearly worthless; check *what* and *how many times*.
- **Over-correcting to "never mock,"** then writing convoluted state checks for things that are genuinely interaction contracts (event publication).
- **Treating a mock-heavy suite as a test problem** when it's a *production-code* problem — too many collaborators, logic fused with I/O.
- **Letting a fake drift** from the real adapter; without a shared contract suite it green-lights broken code.

---

## Test Yourself

1. Explain why the mock-everything `PriceCalculator` test verifies nothing about correctness.
2. Refactor a mock-heavy `register()` test to use a fake repo and state assertions. What now survives a method rename?
3. State "don't mock what you don't own" and give the two reasons it matters. What's the real alternative?
4. Show the wrap-then-fake-the-wrapper pattern for a third-party SDK. Where do the real-SDK tests live?
5. Give three cases where a mock is genuinely correct. What do they have in common?
6. Your colleague's class needs six mocks. What does that tell you, and what do you change?

---

## Cheat Sheet

```
OVER-MOCKING SMELL
  mock all collaborators → test asserts CALL GRAPH, not behavior
  → tautological (passes iff code does what code does) + brittle (breaks on refactor)
  fix: real objects/fakes + assert on STATE/result

DON'T MOCK WHAT YOU DON'T OWN
  third-party SDK/driver/HTTP client → never double directly
  reasons: (1) you mock your WRONG mental model  (2) coupled to uncontrolled iface
  do instead: WRAP in a port you own → fake the wrapper → integration-test the adapter
  truth about external reality: CONTRACT TESTING, not mocks

DESIGN FOR FEWER DOUBLES
  functional core / imperative shell → pure logic needs ZERO doubles
  ports & adapters → doubles only at boundaries, and few of them
  pass DATA in, not collaborators to fetch it
  many mocks needed = SRP violation in production code

WHEN A MOCK IS RIGHT
  the call IS the observable behavior, no state to assert:
  "publish exactly one event" • "must NOT charge empty cart" • audit log
  → assert payload + count, not just 'called'
```

---

## Summary

The defining senior insight is that **over-mocking is a design smell, not a testing style**: a suite that mocks every collaborator verifies the call graph instead of behavior, producing **tautological** tests that prove nothing and **brittle** tests that break on every refactor. The cure is to replace mocks with **real objects and fakes** and assert on **state**. Two rules guard the boundary: **don't mock what you don't own** (you'd be encoding a wrong mental model of the library — wrap it in a port and fake the wrapper, verify the real seam with contract testing), and **prefer fakes to mocks**. Best of all, **design for testability** — functional core / imperative shell and ports-and-adapters — so most code needs no doubles at all; needing many mocks is feedback that the production code does too much. Yet mocks remain the *right* tool when the interaction genuinely *is* the contract (publish exactly one event, never charge an empty cart). The [professional level](professional.md) scales this to org guidance, migration cost, and teaching the taxonomy.

---

## Further Reading

- Freeman & Pryce — *Growing Object-Oriented Software, Guided by Tests* ("only mock types you own").
- Steve Freeman & Nat Pryce — *Mock Roles, Not Objects* (the original paper).
- Martin Fowler — *Mocks Aren't Stubs*; *Test Double* bliki entry.
- Vladimir Khorikov — *Unit Testing Principles, Practices, and Patterns* (the mock/state trade-off, deeply argued).
- The `mocking-strategies`, `dependency-injection`, `solid-principles`, and `refactoring-techniques` skills.

---

## Related Topics

- [Unit Testing — Senior](../02-unit-testing/senior.md) — test brittleness and the four pillars.
- [Integration Testing — Senior](../03-integration-testing/senior.md) — where adapters get verified for real.
- [Contract Testing — Senior](../05-contract-testing/senior.md) — the honest answer to external dependencies.
- [Test Doubles — Professional](professional.md) — org-wide mocking discipline and migration cost.
