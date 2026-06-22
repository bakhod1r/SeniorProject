# Property-Based Testing — Senior Level

> **Roadmap:** [Testing](../README.md) → Property-Based Testing

*Stateful/model-based PBT finds the ordering bugs no single-call property can. Add determinism, seed discipline, and the judgment of where PBT actually earns its keep.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Stateful / model-based testing](#core-concept-1--stateful--model-based-testing)
5. [Core Concept 2 — A worked stateful model in Hypothesis](#core-concept-2--a-worked-stateful-model-in-hypothesis)
6. [Core Concept 3 — Determinism, seeds, and reproducibility](#core-concept-3--determinism-seeds-and-reproducibility)
7. [Core Concept 4 — PBT without flakiness in CI](#core-concept-4--pbt-without-flakiness-in-ci)
8. [Core Concept 5 — Regression: pinning a counterexample](#core-concept-5--regression-pinning-a-counterexample)
9. [Core Concept 6 — The tool landscape by ecosystem](#core-concept-6--the-tool-landscape-by-ecosystem)
10. [Core Concept 7 — Where PBT pays off, and where it doesn't](#core-concept-7--where-pbt-pays-off-and-where-it-doesnt)
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

> Focus: **stateful/model-based PBT, the determinism and seed discipline that keeps randomized tests trustworthy, and the engineering judgment of where to spend PBT effort.**

Single-call properties (round-trip, invariant) catch a lot, but the gnarliest bugs are *sequence* bugs: this operation, then that one, then a third, leaves the system in an impossible state. Stateful/model-based PBT generates *programs* — random sequences of operations — and checks the system against a model after each step. This is where PBT finds the concurrency, ordering, and lifecycle bugs that destroy production systems and that no human writes a test for. This level also tackles the elephant in the room for senior engineers: randomized tests and CI flakiness, and how to get the bug-finding power of PBT without a red build that nobody trusts.

---

## Prerequisites

- Middle level: property patterns, generators, integrated shrinking.
- Experience with stateful systems (caches, queues, connection pools, parsers with internal state).
- Familiarity with your CI's flakiness controls (see `../12-flaky-tests-and-reliability/`).

---

## Glossary

| Term | Meaning |
|------|---------|
| **Stateful / model-based testing** | Generate random sequences of operations; check the system against a simplified model after each. |
| **Command / rule** | One generated operation (e.g., `push(3)`, `pop()`). |
| **Model** | A simple, obviously-correct mirror of the system's expected state. |
| **Precondition** | A guard saying when a command is valid in the current state. |
| **Postcondition** | The check run after a command, comparing system to model. |
| **Seed** | The value that determines which inputs are generated; replay it to reproduce. |
| **Database (Hypothesis)** | The local store of previously-failing examples, replayed first each run. |
| **Coverage-guided fuzzing** | Mutation + coverage feedback to explore inputs; lives in dynamic-analysis (not PBT). |

---

## Core Concept 1 — Stateful / model-based testing

The idea: instead of testing one call, you let the framework generate a **sequence** of operations against a real system *and* against a simple **model** of that system, then assert they agree at every step.

- **Model** — a trivially correct mirror. For a stack, the model is a Python list. For a key-value store, a dict. The model is allowed to be slow or naive; it just has to be *obviously right*.
- **Commands** — the operations the framework can choose from (`put`, `get`, `delete`, `flush`).
- **Preconditions** — when a command is legal (can't `pop` an empty stack).
- **Postconditions** — after running a command on the real system, assert the result matches what the model predicts.

The framework generates a random program — say `put(a,1); put(b,2); delete(a); get(a); flush()` — runs it against both, and reports any divergence. Then it **shrinks the program**: it deletes operations and simplifies arguments until it has the shortest sequence that still triggers the divergence. A 40-operation failure shrinks to "`put(x); delete(x); get(x)` returns the old value" — a precise reproduction of a lifecycle bug.

This technique has found real bugs in databases, distributed systems, and file systems where single-call testing found nothing. It is the highest-leverage form of PBT for stateful code.

---

## Core Concept 2 — A worked stateful model in Hypothesis

Hypothesis's `RuleBasedStateMachine` generates and shrinks operation sequences for you:

```python
from hypothesis.stateful import RuleBasedStateMachine, rule, precondition, invariant
from hypothesis import strategies as st

class BoundedQueueModel(RuleBasedStateMachine):
    """Test a real BoundedQueue (capacity 3) against a plain list model."""

    def __init__(self):
        super().__init__()
        self.system = BoundedQueue(capacity=3)   # system under test
        self.model = []                          # the obvious-correct model

    @rule(value=st.integers())
    @precondition(lambda self: len(self.model) < 3)
    def enqueue(self, value):
        self.system.enqueue(value)
        self.model.append(value)

    @rule()
    @precondition(lambda self: len(self.model) > 0)
    def dequeue(self):
        assert self.system.dequeue() == self.model.pop(0)   # FIFO must agree

    @invariant()
    def size_matches(self):
        assert self.system.size() == len(self.model)

    @invariant()
    def never_exceeds_capacity(self):
        assert self.system.size() <= 3

TestBoundedQueue = BoundedQueueModel.TestCase
```

Hypothesis will weave together enqueues and dequeues in every order, check the FIFO contract and the invariants after each, and if it finds a divergence, hand you the minimal failing sequence. jqwik offers the same via `@StateMachine`/`Action` classes; fast-check via `fc.commands([...])` with `fc.modelRun`. The pattern is identical across ecosystems: **system + model + commands + invariants**.

---

## Core Concept 3 — Determinism, seeds, and reproducibility

PBT is randomized, but it must be *reproducible*. Every framework derives all its inputs from a **seed** — one number. Same seed ⇒ same inputs ⇒ same pass/fail. Reproducibility hinges on three rules:

1. **The framework reports the seed on failure.** Hypothesis prints a `@reproduce_failure` decorator or the failing example itself; fast-check prints `seed` and `path`; jqwik prints the random seed. Capture it from the CI log.
2. **Replay the exact failure locally.** fast-check: `fc.assert(prop, { seed: 1234, path: "5:2" })`. Hypothesis: paste the printed `@reproduce_failure(...)` decorator above the test, or rely on its example **database** (`.hypothesis/`), which automatically replays the last failure first.
3. **The property itself must be deterministic.** If your property reads the wall clock, a global RNG, network, or filesystem ordering, the *same input* can pass once and fail next time — and now the seed doesn't reproduce anything. Inject the clock, seed any internal randomness, and avoid order-dependent reads. A non-reproducible PBT failure is almost always a non-deterministic *property*, not a framework quirk.

```python
# Make the property deterministic: pass time in, don't read it inside.
@given(st.datetimes(), st.integers(min_value=0, max_value=10_000))
def test_token_expiry(issued_at, ttl_seconds):
    token = make_token(issued_at, ttl_seconds)
    assert not token.is_expired(at=issued_at)                       # fresh
    assert token.is_expired(at=issued_at + timedelta(seconds=ttl_seconds + 1))
```

---

## Core Concept 4 — PBT without flakiness in CI

The legitimate fear: "random tests = random red builds." Manage it deliberately.

**Two valid strategies, pick one per suite:**

- **Fixed seed in CI (deterministic mode).** Pin the seed so every CI run executes the *same* inputs. Builds are reproducible; a failure is a real failure, never noise. Cost: you stop discovering *new* inputs in CI — the property only ever sees one fixed sample set. Good for the merge-gating suite where determinism matters most.
- **Random seed + report it (exploratory mode).** Let CI roam new inputs every run for maximum bug-finding, but ensure the framework prints the seed on failure so any red build is reproducible. Cost: a green PR can go red later when CI rolls a new seed onto a latent bug — which is *correct* (the bug was always there) but surprises teams. Best run on a nightly/scheduled job, not as a blocking PR gate.

A common mature setup: **deterministic, bounded PBT on the PR gate** (fixed seed, modest example count) + **exploratory PBT nightly** (random seed, high example count, longer deadlines). New bugs surface in the nightly with a reproducible seed; the PR gate stays stable.

**Other controls:** cap per-example time (`deadline` in Hypothesis) so a slow generated input doesn't cause timeout flakiness; set a sensible `max_examples` (more in nightly, fewer on the gate); keep the `.hypothesis/` example database **out** of CI caches if you want CI runs independent, or **in** a persistent cache if you want CI to remember and re-check past failures. The key principle: *a PBT failure must always be reproducible from information in the build log.* If it isn't, fix the property's determinism before touching seeds. See `../12-flaky-tests-and-reliability/`.

---

## Core Concept 5 — Regression: pinning a counterexample

When PBT finds a bug, the discovered counterexample is gold — but a future random run might not hit it again. Promote it to a **permanent example test** so it's checked on every run, deterministically, forever:

```python
from hypothesis import given, example, strategies as st

@given(st.lists(st.integers()))
@example([0, 0])                      # the shrunk counterexample PBT found
@example([-1, 2_147_483_648])         # an overflow case it found later
def test_sort_is_ordered(xs):
    result = my_sort(xs)
    assert all(result[i] <= result[i+1] for i in range(len(result)-1))
```

`@example(...)` forces that exact input to run *in addition to* generated ones (jqwik: `@Example` / a seeded data point; fast-check: add an explicit unit test). Now the regression is locked in regardless of seed, and the property keeps hunting for *new* bugs. This is the standard discipline: **find with PBT, pin with `@example`.** Hypothesis's example database does this automatically for the *last* failure, but `@example` makes it explicit, reviewable, and durable in source control.

---

## Core Concept 6 — The tool landscape by ecosystem

| Ecosystem | Tool | Entry points | Notes |
|-----------|------|--------------|-------|
| Python | **Hypothesis** | `@given`, `strategies as st`, `@example`, `RuleBasedStateMachine` | The reference implementation; best-in-class shrinking, example DB, stateful. |
| Java/JVM | **jqwik** | `@Property`, `@ForAll`, `Arbitraries`, `@Provide`, state machines | JUnit 5 platform; integrated shrinking. |
| JS/TS | **fast-check** | `fc.property`, `fc.assert`, arbitraries, `fc.commands` | Mature shrinking; `seed`/`path` replay; model-based via commands. |
| Rust | **proptest**, **quickcheck** | `proptest!` macro / `Arbitrary` trait | `proptest` has integrated shrinking + a persistence file; `quickcheck` is the classic port. |
| Go | **gopter**; **`testing.F`** (native fuzzing) | gopter generators/commands; `f.Fuzz` | Go's native `go test -fuzz` is **coverage-guided fuzzing**, adjacent but distinct (below). |

**Where coverage-guided fuzzing fits.** Fuzzing (libFuzzer, AFL, Go's native fuzzer, Atheris) also generates many inputs, but its engine is *mutation + coverage feedback* aimed at crashes/hangs/sanitizer trips, usually on byte/string inputs. PBT is *property-driven*, checks rich logical invariants, and emphasizes shrinking to a clean counterexample. They overlap (Hypothesis can run in a fuzzing mode; Go blurs the line) but serve different goals. **Fuzzing is covered in `../../dynamic-analysis-and-sanitizers/` — don't duplicate it here.** The senior heuristic: structured logical invariants → PBT; "does any byte sequence crash the parser?" → fuzzing; and a parser deserves *both*.

---

## Core Concept 7 — Where PBT pays off, and where it doesn't

**High ROI (write PBT first):**

- **Parsers, serializers, codecs** — round-trip is free money; the input space is exactly where humans miss cases.
- **Data structures** — heaps, trees, ring buffers, LRU caches; oracle and stateful testing shine.
- **Encoding / financial / date-time logic** — rounding, overflow, time zones, money; clear invariants, catastrophic bugs.
- **Anything with an algebra** — sets, intervals, CRDTs; commutativity/associativity/idempotence are testable laws.
- **State machines / protocols** — stateful PBT finds ordering and lifecycle bugs nothing else does.

**Poor fit (don't force it):**

- **Thin glue / CRUD with no logic** — the only property is "it calls the dependency," which a mock-based unit test states more clearly.
- **Code with no statable invariant** — if you can't articulate a rule, PBT degenerates into a slow, vague example test.
- **Heavily side-effecting code without a clean model** — building the model costs more than it returns; reach for integration tests.
- **UI rendering / look-and-feel** — snapshot/approval testing (`../08-snapshot-and-approval-testing/`) fits better.

The judgment: PBT's cost is the *skill of finding properties* and slightly slower tests; its payoff is finding the bug class you'd never enumerate. Spend it where invariants are clear and bugs are expensive.

---

## Real-World Examples

- **A connection pool.** Stateful PBT generates acquire/release/timeout sequences; invariant: leased + idle == total, never over capacity, no double-lease. Finds the "release twice" and "leak on exception" bugs.
- **A JSON/Protobuf codec.** Round-trip across a recursive generator finds the unicode, deep-nesting, and integer-boundary losses; the failure pins as an `@example`.
- **An interval/calendar library.** Metamorphic + invariants on overlap/merge; stateful add/remove sequences catch the "merge leaves a gap" bug.
- **A CRDT.** Commutativity and convergence are *the* correctness laws; PBT is essentially the spec.

---

## Mental Models

- **Stateful PBT generates programs, not values.** The counterexample is a minimal *script* that breaks your system.
- **Determinism first, seeds second.** If a failure won't reproduce, the property is non-deterministic — fix that before blaming randomness.
- **Find with PBT, pin with `@example`.** Every discovered bug becomes a permanent, seed-independent regression.
- **PBT and fuzzing are cousins, not twins.** Logical invariants vs. crash-hunting; a parser wants both.

---

## Common Mistakes

- **Non-deterministic properties.** Reading the clock/RNG/network inside the property makes failures irreproducible and seeds useless.
- **Random seed on the blocking PR gate with no plan for the surprise red build.** Use fixed seed on the gate, random seed nightly.
- **Skipping the model in stateful tests.** Asserting ad-hoc facts after each command misses divergences; a real model catches them.
- **Letting a discovered counterexample evaporate.** If you don't pin it with `@example`, the next seed may never find it again.
- **Forcing PBT onto glue code.** No invariant ⇒ no value; use the right test type.
- **Confusing PBT with fuzzing and writing both in the wrong section** — keep coverage-guided fuzzing in dynamic-analysis.

---

## Test Yourself

1. Describe the four pieces of a stateful/model-based test and what each contributes.
2. A PBT failure won't reproduce from the reported seed. What's the most likely cause and fix?
3. Contrast fixed-seed and random-seed CI strategies; when do you use each?
4. How do you turn a discovered counterexample into a durable regression?
5. Give one system where PBT is high ROI and one where it's a poor fit, with reasons.
6. How does coverage-guided fuzzing differ from PBT, and where is it documented?

---

## Cheat Sheet

```python
# Stateful (Hypothesis)
class M(RuleBasedStateMachine):
    @rule(x=st.integers()) ...        # generated commands
    @precondition(lambda self: ...)   # legality guard
    @invariant() ...                   # checked after every step

# Determinism + reproducibility
# - inject clock/RNG; never read them inside the property
# - on failure: capture the seed from the log
# - fast-check: fc.assert(p, {seed, path}) ; Hypothesis: @reproduce_failure / .hypothesis DB

# CI strategy
# PR gate     -> fixed seed, modest max_examples (stable, reproducible)
# nightly     -> random seed, high max_examples  (exploratory, reproducible via reported seed)

# Regression: find with PBT, pin with @example(<shrunk counterexample>)
```

---

## Summary

Stateful/model-based PBT generates random *sequences* of operations and checks the system against a simple model, finding ordering and lifecycle bugs that single-call properties miss — and it shrinks the failing program to a minimal script. Reproducibility rests on seeds *and* on deterministic properties; if a failure won't replay, fix the property's determinism first. Run deterministic (fixed-seed) PBT on the merge gate and exploratory (random-seed, reported) PBT nightly to get bug-finding power without flaky gates. Always pin discovered counterexamples with `@example`. PBT pays off most on parsers, data structures, codecs, and protocols with clear invariants; it's a poor fit for invariant-free glue. The professional level covers PBT as specification, org-wide adoption, and combining it with mutation testing.

---

## Further Reading

- John Hughes, "Testing the Hard Stuff and Staying Sane" (QuviQ / Erlang QuickCheck) — the stateful-PBT classic.
- Hypothesis docs — "Stateful testing" and "Reproducing failures."
- fast-check docs — "Model based testing" and "Replay a failure."
- The `property-based-testing` skill (stateful patterns and seed discipline).

---

## Related Topics

- [Property-Based Testing — Middle](./middle.md) — property patterns, generators, shrinking.
- [Property-Based Testing — Professional](./professional.md) — PBT as spec, adoption, ROI.
- [Flaky Tests and Reliability](../12-flaky-tests-and-reliability/) — keeping randomized tests deterministic.
- [Dynamic Analysis and Sanitizers](../../dynamic-analysis-and-sanitizers/) — coverage-guided fuzzing.
- [Mutation Testing](../07-mutation-testing/) — validating that your properties actually catch bugs.
