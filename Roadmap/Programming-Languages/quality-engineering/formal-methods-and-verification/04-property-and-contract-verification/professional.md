# Property & Contract Verification — Professional Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → Property & Contract Verification
> *The senior page taught you to write a property and a contract. This page is about deciding which of your ten thousand functions deserve one, how to keep a property suite green in CI without it becoming a flaky-failure machine, and when to spend three engineer-months proving a 400-line parser correct instead of fuzzing it for an afternoon. This is the rung of formal methods most teams should actually fund — and the rung most teams botch by writing properties that prove nothing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Property-Based Testing as a Program, Not a Trick](#core-concept-1--property-based-testing-as-a-program-not-a-trick)
5. [Core Concept 2 — Writing Good Properties (the Oracle Problem)](#core-concept-2--writing-good-properties-the-oracle-problem)
6. [Core Concept 3 — Making PBT Reliable in CI](#core-concept-3--making-pbt-reliable-in-ci)
7. [Core Concept 4 — Coverage-Guided PBT and the Fuzzing Convergence](#core-concept-4--coverage-guided-pbt-and-the-fuzzing-convergence)
8. [Core Concept 5 — Contracts in Production](#core-concept-5--contracts-in-production)
9. [Core Concept 6 — Deductive Verification Where It Earns Its Keep](#core-concept-6--deductive-verification-where-it-earns-its-keep)
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

> Focus: **Running property and contract verification as an organizational program — matching the rung of rigor to the risk of the code, and avoiding the trap of "we have property tests" that prove nothing.**

The senior page framed the techniques. At the professional level the questions change shape. They show up as: "we have 4,000 property tests, why did a round-trip bug still ship?"; "the PBT suite failed once last Tuesday with a counterexample nobody can reproduce — is it a real bug or a seed artifact?"; "marketing wants the new serializer in two weeks, do we fuzz it or prove it?"; "a CVE class keeps recurring in our parser — can we make it *impossible* instead of catching it?"

The defining judgment of this tier is **rung selection**. There is a ladder — example test, property test, runtime contract, model-based PBT, deductive proof — and each rung costs roughly an order of magnitude more than the one below it and applies to roughly an order of magnitude less of your code. Property-based testing and contracts are the sweet spot: cheap, broadly applicable, and shockingly under-adopted. Deductive proof (Dafny, SPARK, Frama-C, Verus) is expensive and narrow — you verify a *small core* and test the rest. Getting this allocation right is worth more than mastery of any single tool, and getting it wrong is how teams either ship bugs they thought they'd ruled out or burn a quarter proving something that didn't need it.

This page is the pragmatic layer: the program, the failure modes, and the economics.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — what a property is, generators and shrinking, design by contract (pre/post/invariants), the basics of SMT-backed deductive verification.
- **Required:** You've written and maintained an automated test suite in CI and dealt with a flaky test.
- **Helpful:** You've owned an API or a library other teams depend on, where "correct" had to mean *every input*, not the ones you thought of.
- **Helpful:** You've been on the receiving end of a recurring CVE class (parser, deserializer, memory bug) and felt the limits of "add a test for that case."

---

## Glossary

- **Property** — a claim that holds for *all* inputs satisfying some precondition (e.g., `decode(encode(x)) == x`), checked by generating many `x`. Contrast with an example test (one fixed input/output pair).
- **Oracle** — the thing that decides whether output is correct. The *test oracle problem* is that for many functions the only obvious oracle is the function itself, which proves nothing.
- **Model / reference oracle** — a simpler, obviously-correct implementation (or a spec) you compare against — the strongest oracle when you can afford one.
- **Shrinking** — after a failure, automatically reducing the counterexample to the minimal input that still fails. *Deterministic* shrinking yields the same minimal case every run.
- **Stateful / model-based PBT** — generating *sequences of operations* against a system and checking each result against a model of expected state (catches order-dependent bugs).
- **`target()` / coverage-guided PBT** — steering generation toward inputs that maximize a metric (a value to grow, or code coverage) so the search reaches deep states a uniform generator never would.
- **Contract** — an executable pre/postcondition or invariant (`requires`, `ensures`, `assert`) attached to code; checkable at runtime or provable statically.
- **Deductive verification** — proving, via an SMT solver, that code satisfies its contract on *all* inputs (Dafny, SPARK, Frama-C, Verus). Output is a proof, not a sample.
- **Ghost code / lemma** — specification-only constructs (not compiled) that help the solver: an invariant, an inductive lemma, a `forall` hint that turns a timeout into a proof.
- **Regression corpus** — the saved set of past counterexamples, replayed on every run so a fixed bug stays fixed.

---

## Core Concept 1 — Property-Based Testing as a Program, Not a Trick

Most teams "try" PBT on one function, like it, and never scale it. Running it as a *program* means knowing **where it pays off most** and concentrating effort there rather than sprinkling one property per module. PBT's return is wildly uneven across code shapes; the ROI lives in four patterns.

**1. Round-trip / encode-decode pairs (the highest-ROI property in existence).** Anything with a `serialize`/`deserialize`, `encode`/`decode`, `marshal`/`unmarshal`, `compress`/`decompress`, or `parse`/`print` pair has a free, strong property: the round trip is the identity.

```python
from hypothesis import given, strategies as st

@given(st.binary())
def test_decode_encode_roundtrip(blob):
    # decode then re-encode must reproduce the bytes (canonical form)
    assert encode(decode(blob)) == decode_then_recanonicalize(blob)

@given(my_message_strategy())          # structured generator for your type
def test_encode_decode_roundtrip(msg):
    assert decode(encode(msg)) == msg   # the identity law
```

This single property has found data-corruption bugs in protobuf wrappers, JSON serializers, time formatters, and binary protocols across the industry — bugs example tests miss because the corrupting input is one nobody would think to write by hand (an empty map, a NaN, a surrogate-pair string, an integer at the type boundary).

**2. Data structures and algorithms — invariants and a model.** A balanced tree has an invariant (heights differ by ≤ 1; in-order traversal is sorted). A sort has a model (`sorted(xs)` is a permutation of `xs` and is ordered). A custom container can be compared against the language's built-in one operation-for-operation.

**3. Algebraic laws and a reference implementation.** If your code claims to be associative, commutative, idempotent, a monoid, or a faster version of a known-correct slow function, those are properties: `fast(x) == slow(x)`, `merge(merge(a,b),c) == merge(a,merge(b,c))`. The reference implementation is the gold-standard oracle.

**4. State machines and stateful APIs — model-based PBT.** This is the underused powerhouse. Generate *sequences* of API calls (a cache's `get/put/evict`, a connection pool's `acquire/release`, a parser's incremental `feed`), run them against the real system, and check each result against a simple in-memory **model** of what the state *should* be. Order-dependent bugs — the LRU that evicts the wrong entry only after a specific interleaving — surface here and essentially nowhere else.

> **The program-level move:** audit your codebase for these four shapes and put properties there *first*. A parser, a serializer, a custom data structure, and a stateful resource manager will repay PBT many times over; a thin CRUD handler that just forwards to the database mostly won't. Don't measure PBT adoption by "number of property tests" — measure it by "fraction of round-trips, invariants, and stateful APIs that have one."

---

## Core Concept 2 — Writing Good Properties (the Oracle Problem)

This is the hard part, the part that separates a PBT program that finds real bugs from one that's green theater. **A weak or tautological property passes forever while bugs ship.** The skill is choosing an *oracle* — the thing that decides correctness — that is independent of the code under test.

The oracle hierarchy, strongest to weakest:

| Oracle | Strength | When available |
|---|---|---|
| **Reference / model implementation** | Strongest — `f(x) == ref(x)` pins behavior exactly | You have a slow-but-correct version, or a built-in to compare to |
| **Round-trip / inverse** | Very strong — `decode(encode(x)) == x` | Any encode/decode, parse/print, compress pair |
| **Algebraic law** | Strong — associativity, idempotence, monoid laws | Code that claims a mathematical structure |
| **Metamorphic relation** | Medium — relate *two* runs: `sort(xs)` and `sort(reverse(xs))` agree | No absolute oracle, but transformations have known effects |
| **Invariant** | Medium — output always well-formed (tree balanced, sum preserved) | Any structure with a representation invariant |
| **"Doesn't crash" / smoke** | Weakest — only finds panics and sanitizer trips | Last resort; pair with sanitizers to make it bite |

The classic failure is **restating the implementation as the property**:

```python
# TAUTOLOGY — proves nothing. If discount() is wrong, this is wrong the same way.
@given(st.floats(0, 1000), st.floats(0, 1))
def test_discount(price, rate):
    assert discount(price, rate) == price - price * rate   # ← same formula as the code

# REAL property — an independent relation the code must satisfy regardless of formula
@given(st.floats(0, 1000), st.floats(0, 1))
def test_discount_is_bounded_and_monotone(price, rate):
    d = discount(price, rate)
    assert 0 <= d <= price                 # never negative, never more than price
    assert discount(price, 0) == price     # zero discount is a no-op
    assert discount(price, 1) == 0         # full discount is free
```

The metamorphic technique deserves emphasis because it rescues you when there is **no oracle at all** (the situation for most business logic and most ML). You can't say what `f(x)` *should* be, but you can say how `f` should respond to a *change* in input: re-encoding a re-sized image then resizing should match resizing once; searching for "cat" should return a superset of searching for "black cat"; adding an item then removing it should restore state. Two related runs and a known relation between them is a valid oracle even when a direct one is impossible.

> **The principle:** a good property is one that *can fail for a reason independent of how the code is written*. Before committing a property, ask: "if I rewrote the implementation with a subtly different bug, would this property catch it?" If the answer is no — if the property mirrors the code's own logic — it is decoration, and decoration that shows green is worse than no test because it manufactures false confidence.

---

## Core Concept 3 — Making PBT Reliable in CI

Naïvely wired, PBT is a flaky-test generator: it explores new inputs every run, so it can fail on a build that "passed yesterday" with a counterexample that's gone by the time you look. A *program* makes randomness an asset, not a liability. Five disciplines:

**1. Seeds and reproducibility.** A counterexample is worthless if you can't reproduce it. Hypothesis persists its failing examples in a local database (`.hypothesis/`) and replays them; Go's fuzzer writes the crashing input to `testdata/fuzz/`. Pin or record the seed so a CI failure is reproducible on a laptop. The non-negotiable: **every PBT failure must come with a concrete, replayable input**, surfaced in the CI log, not just "property X failed."

**2. Deterministic shrinking.** When a property fails, the framework should shrink the input to a minimal case and produce *the same* minimal case every time. A 4 KB random blob that fails is a mystery; the shrunk `b"\x00"` (empty map) or `[0, -0.0]` (signed-zero) is a bug report. Confirm your framework's shrinking is deterministic; non-deterministic shrinking turns triage into archaeology.

**3. Example budgets — fast PR runs, deep nightly runs.** PBT cost scales with examples. Run a *small* budget on every PR for fast feedback (Hypothesis defaults to 100 examples; keep it tight), and a *large* budget (tens of thousands, or a wall-clock-bounded fuzz) nightly or on a schedule. The PR run guards against regressions; the deep run hunts for new bugs without blocking developers.

```python
from hypothesis import settings, HealthCheck

# Fast profile for PRs; deep profile for nightly. Select via env/CLI.
settings.register_profile("ci",    max_examples=100,   deadline=200)
settings.register_profile("nightly", max_examples=20_000, deadline=None,
                          suppress_health_check=[HealthCheck.too_slow])
```

```bash
# Go: short budget in unit CI, long fuzz on a schedule
go test ./...                         # runs the seed corpus only — fast, deterministic
go test -fuzz=FuzzParse -fuzztime=30m # nightly deep run; new crashes land in testdata/fuzz/
```

**4. A regression corpus of past counterexamples.** Every counterexample you fix becomes a permanent fixture. Hypothesis does this automatically via its example database; Go's `testdata/fuzz/` corpus is committed to the repo and replayed by the normal `go test`. Commit these. A fixed bug that isn't in the corpus is a bug that can silently return.

**5. The flaky-failing-example workflow.** When the nightly deep run finds a counterexample: (a) the framework saves it; (b) you reproduce it locally from the saved example — *not* by re-running the random search; (c) you add the shrunk case as an explicit regression test; (d) you fix the code; (e) the corpus keeps it fixed forever. Treat a new counterexample as a found bug with a free repro, never as "flaky, re-run the job."

> **The reliability stance:** a property suite that fails non-reproducibly will be disabled by the team within a month — and they'll be right to. The discipline that makes PBT trustworthy in CI is exactly the discipline that makes it valuable: every failure is a saved, shrunk, replayable input that goes into a committed corpus. Get that loop right and PBT stops being "flaky" and becomes the suite that catches what example tests can't. See [Testing → Flaky Tests](../../testing/) for the general reliability playbook this specializes.

---

## Core Concept 4 — Coverage-Guided PBT and the Fuzzing Convergence

Uniform random generation has a blind spot: it rarely reaches *deep* states. If a bug only triggers after a queue fills, a cache evicts, or a parser enters an error-recovery path, a generator that picks inputs uniformly may take astronomically long to stumble into it. Two converging techniques fix this.

**`target()` — steer toward interesting inputs.** Hypothesis's `target()` lets you tell the engine "maximize this number," and it biases generation toward inputs that grow it. Want to reach a full buffer? Target the buffer's length. Want pathological hash collisions? Target the longest bucket chain.

```python
from hypothesis import given, target, strategies as st

@given(st.lists(st.integers()))
def test_cache_under_pressure(ops):
    cache = LRUCache(capacity=8)
    for op in ops:
        cache.put(op % 16, op)
    target(cache.eviction_count(), label="evictions")  # push toward heavy eviction
    assert cache.invariants_hold()                       # bug hides in deep evicted states
```

**Coverage-guided generation — the fuzzing convergence.** Modern fuzzers (libFuzzer, AFL++) instrument the binary and keep inputs that hit *new code paths*, evolving a corpus that reaches deep states automatically. PBT and fuzzing have converged into the same activity from two directions:

- **Go's native fuzzing** (`go test -fuzz`) is coverage-guided fuzzing with PBT ergonomics — you write a `f.Fuzz(func(t, b []byte){...})` that looks like a property, and the runtime does coverage-guided mutation under it.
- **Hypothesis + `atheris`** bridges Python PBT to Google's coverage-guided fuzzer, so your Hypothesis strategies feed a coverage-driven search.
- The mental model is one ladder: *example test → property test (random) → property test (coverage-guided) → fuzzing*. Same "for all inputs" goal; increasing search sophistication.

The practical upshot: for input-parsing code (the highest-bug-density code in most systems), write the property *and* run it under a coverage-guided engine on a schedule. The property defines correctness; the coverage guidance finds the inputs that break it. Pair this with the sanitizers in [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) — a fuzzer plus ASan/UBSan turns "doesn't crash" from a weak oracle into a strong one, because the sanitizer makes latent memory and UB bugs *crash loudly* on the inputs the fuzzer finds.

> **The convergence in one line:** PBT and fuzzing are the same idea — "try many inputs, check a property" — differing only in how cleverly they choose inputs. Use `target()` and coverage guidance to reach the deep states uniform random never will, and let sanitizers be the oracle when you have nothing better.

---

## Core Concept 5 — Contracts in Production

Contracts (executable pre/postconditions and invariants) are the other half of this rung, and the strategic question is **which contracts run in production and which only in debug**. This is a real performance-vs-safety decision, not a style preference.

The taxonomy that matters:

| Contract class | Cost | Strategy |
|---|---|---|
| **Cheap & catastrophic-if-violated** | O(1), negligible | **Always on**, even in prod — null checks, bounds on external input, "this invariant being false means data corruption" |
| **Expensive but important** | O(n) or worse | **Debug/test only** — "the whole list is sorted," "no duplicates across the map"; too costly per-call in prod |
| **Cross-trust-boundary** | varies | **Always on at the boundary** — validate everything entering from the network/user; this is security, not just correctness |
| **Internal post-conditions** | varies | **Debug/test**, sampled or off in prod hot paths |

The **DoS / perf trade-off** is the trap. An expensive invariant checked on every call is a self-inflicted denial-of-service: a contract that walks an entire collection turns an O(1) operation into O(n), and under load that's an outage you caused. The disciplined pattern is *graduated enforcement*: cheap invariants always on; expensive ones gated behind a build flag or sampling; boundary validation always on because the alternative is a security hole.

```go
// Always on: cheap, and violation means corruption or attack.
func (b *Buffer) WriteAt(p []byte, off int64) (int, error) {
    if off < 0 || off > b.size {              // boundary check, O(1), keep in prod
        return 0, fmt.Errorf("offset %d out of range [0,%d]", off, b.size)
    }
    ...
}

// Debug only: O(n) invariant, far too expensive to run per-call in production.
func (t *RBTree) checkInvariants() {
    if !debugAssertions {                     // compiled out / flag-gated in prod
        return
    }
    assertBlackHeightEqual(t.root)            // walks the tree — fine in tests, fatal in a hot path
}
```

The second strategic value of contracts is as **living, checkable API documentation**. A `requires balance >= amount` on a withdraw method *is* the documentation of the precondition, and unlike a doc comment it cannot drift from the code, because it's executed (and in a verified language, proved). When a caller violates it, they get a precise failure at the boundary instead of a corrupted state three calls later. Contracts that are checked are documentation that can't lie.

> **The production stance:** default expensive invariants to *off* in production and *on* in test/CI, keep cheap boundary checks *always on*, and treat the always-on set as a security control. The failure mode is bimodal: too few contracts and you debug corruption far from its cause; too many expensive ones and you've built a DoS into your hot path. See [Dynamic Analysis → Runtime Assertion & Contract Checking](../../dynamic-analysis-and-sanitizers/) for the runtime-enforcement machinery and the sampling strategies that make always-on affordable.

---

## Core Concept 6 — Deductive Verification Where It Earns Its Keep

Deductive verification — proving with an SMT solver that code meets its contract on *all* inputs (Dafny, SPARK/Ada, Frama-C, Verus) — is the expensive top of this rung. The professional skill is not *how* to drive Dafny; it's **knowing the narrow places where a proof beats a million fuzz iterations**, and refusing it everywhere else.

It earns its keep where these align:
- **The cost of a bug is catastrophic** — a crypto routine, a bootloader, a flight-control law, a kernel memory allocator. A single bug is a CVE, a recall, or a crash.
- **The code is small and stable** — hundreds, not millions, of lines; the *core*, not the whole product. Proof cost scales superlinearly with size and churn.
- **The property is precise** — "this AES implementation is constant-time and matches the spec," "this parser never reads out of bounds," "this ring buffer never overflows." Fuzzy properties ("the UX is good") can't be proved.
- **A class of bugs recurs** — if memory-safety or arithmetic-overflow CVEs keep appearing in one component, proving their *absence* eliminates the whole class, not one instance.

The **"verify the core, test the rest"** strategy is the entire economic argument. You do *not* verify your application. You carve out a small, high-value kernel — the crypto primitive, the parser's bounds logic, the consensus state machine's safety property — prove *that*, and use PBT and example tests for everything around it. AWS's provable-security work follows exactly this: Dafny and the s2n-TLS / crypto verification efforts target the security-critical core, not the entire codebase. SPARK/Ada is used this way in aerospace and rail (flight software, signaling) — a verified subset for the safety-critical kernel, conventional engineering for the rest.

The **real cost** is what stalls efforts, and you must budget for it honestly:
- **Annotation burden** — you write the contracts, loop invariants, and often ghost code; the annotations can exceed the executable code several-fold.
- **Solver flakiness and timeouts** — the SMT solver may prove a goal today and time out tomorrow after an unrelated change ("proof instability"). You manage this with lemmas, `assert` hints, and triggers that guide the solver.
- **Expertise** — it needs people who think in invariants and can debug a failed proof. This is a real hiring/training cost, not a tool you `apt install`.
- **Maintenance under change** — every code change must keep the proof green. A verified component has a *higher* change cost forever, which is exactly why you want it small and stable.

> **The economic case, stated plainly:** PBT and contracts are cheap and apply to most of your code; deductive proof is expensive and applies to a sliver. Match the rung to the risk. Reach for a proof only when the bug cost is catastrophic, the code is small and stable, and the property is precise — then prove a *small core* and test the rest. A team that tries to verify everything ships nothing; a team that verifies the right 400 lines eliminates a CVE class for good. See [05 — Proof Assistants & Dependent Types](../05-proof-assistants-and-dependent-types/professional.md) for the rung above this (arbitrary theorems, full functional correctness) and [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/professional.md) for the full ROI calculus.

---

## War Stories

**The serializer round-trip that found the data-corruption bug.** A service had thorough example tests for its custom binary serializer — every field type, nested messages, edge values someone thought of. A single Hypothesis property, `decode(encode(msg)) == msg`, failed within seconds on a message containing an *empty* map. The encoder wrote a length prefix of zero and then, due to an off-by-one in the reader, the decoder consumed one byte too many, silently corrupting the *next* field. No human had written a test with an empty map mid-message. The bug had been live in production, intermittently corrupting records whenever a particular optional map was empty. One round-trip property, three lines, caught what dozens of hand-written cases missed — because it generated the input nobody would think to write.

**The model-based PBT that caught the LRU eviction bug.** A cache passed every example test: put, get, hit, miss, eviction-when-full all worked. A stateful (model-based) property generated random sequences of `get`/`put` and compared the real cache against a trivial dictionary-plus-list model. After a few hundred sequences it produced a minimal counterexample: a specific interleaving where a `get` (which should mark an entry as recently used) failed to update recency, so the *wrong* entry was evicted on the next `put`. The bug only manifested when a get on the least-recently-used key was immediately followed by a put — an order no example test had encoded. The shrunk sequence was four operations long and pasted straight into a regression test. Order-dependent bugs live almost exclusively in this technique.

**The Dafny-verified routine that eliminated a CVE class.** A team owned a parser that had produced a steady trickle of out-of-bounds-read CVEs over two years — each fixed reactively, each followed by another. Rather than fuzz forever, they rewrote the ~500-line bounds-and-length core in a verified style (Dafny-generated, with `requires`/`ensures` proving every index access in range for all inputs). The proof effort took weeks and a painful fight with annotations, but the *class* of bug — out-of-bounds read in that component — became provably impossible, not merely untested. The surrounding glue stayed conventional. This is "verify the core, test the rest" in one anecdote: weeks of proof on 500 lines retired a recurring CVE category that years of patching hadn't.

**The team that wrote tautological properties and shipped bugs anyway.** A team proudly reported "2,000 property tests, all green" — and kept shipping calculation bugs. Review revealed the properties restated the implementation: the test for `computeFee` asserted the fee equalled the same arithmetic the function used. When the formula was wrong, the property was wrong identically and passed. The fix wasn't more properties; it was *independent oracles* — bounds (`0 <= fee <= cap`), monotonicity (more usage never costs less), and a comparison against a deliberately-different reference implementation. Green property tests had manufactured confidence while proving nothing. The lesson: a property that mirrors the code is decoration, and decoration that shows green is worse than no test.

**The deductive proof that stalled on solver timeouts.** An effort to verify a concurrent ring buffer hit a wall: the SMT solver proved most goals but timed out on the wrap-around case, and worse, the timeouts were *unstable* — a goal proved on Monday failed Wednesday after an unrelated edit. The effort nearly got cancelled as "the tooling doesn't work." It was rescued by adding explicit **lemmas and ghost variables**: a ghost counter making the wrap-around invariant inductive, and `assert` hints that told the solver which facts to use. With the invariant made explicit, the solver proved the goal in seconds and stayed stable. The lesson: solver timeouts in deductive verification are usually a *missing invariant or lemma*, not a tool failure — the human supplies the insight, the solver checks it.

---

## Decision Frameworks

**Which rung of rigor? Pick by risk and code shape:**

| Situation | Rung | Why |
|---|---|---|
| Specific known cases, regression pins | **Example test** | Cheap, exact, documents the case. Always have these. |
| A round-trip, invariant, algebraic law, or reference impl exists | **Property test (PBT)** | Highest ROI; finds inputs you'd never write by hand |
| A stateful API where order matters (cache, pool, parser) | **Model-based PBT** | Only practical way to find order-dependent bugs |
| Input-parsing / untrusted bytes | **Coverage-guided PBT / fuzzing + sanitizers** | Reaches deep states; sanitizers make crashes the oracle |
| A precondition callers keep violating | **Runtime contract (always-on at boundary)** | Fails at the cause, not three calls later; doubles as docs |
| Small, stable, catastrophic-if-wrong core (crypto, bounds, safety) | **Deductive proof (Dafny/SPARK/Frama-C/Verus)** | Eliminates a *class* of bugs; only justified for the sliver |
| Arbitrary theorems / full functional correctness | **Proof assistant** | The rung above — see [05](../05-proof-assistants-and-dependent-types/professional.md) |

**Where PBT pays off, by code shape:**

| Code shape | PBT value | The property |
|---|---|---|
| Serializer / parser / codec | ★★★★★ | `decode(encode(x)) == x` round-trip |
| Custom data structure | ★★★★★ | Representation invariant + compare to built-in |
| Algorithm with a slow reference | ★★★★★ | `fast(x) == slow(x)` |
| Stateful resource (cache/pool/FSM) | ★★★★★ | Model-based: op sequence vs model |
| Math / financial calc | ★★★★ | Bounds, monotonicity, metamorphic (no direct oracle) |
| Business logic with no clear oracle | ★★★ | Metamorphic relations between runs |
| Thin CRUD / glue forwarding to a DB | ★ | Little to assert beyond "doesn't crash" |

**What to formally verify (the small core):**

| Verify (small, stable, catastrophic) | Don't verify (large, churning, low-stakes) |
|---|---|
| Crypto primitive (constant-time, matches spec) | The web handler around it |
| Parser bounds / length logic | The feature using the parsed data |
| Consensus / replication safety property | The admin UI |
| Allocator / ring-buffer memory safety | The logging glue |
| A recurring-CVE component's core invariant | Everything that changes weekly |

**Runtime contract checking — always-on vs debug-only:**

| Contract | Always on (prod) | Debug/test only |
|---|---|---|
| Cheap boundary / null / range check on external input | ✅ (security + correctness) | |
| O(n) "whole collection sorted / no dupes" invariant | | ✅ (DoS risk in prod hot path) |
| Cross-trust-boundary validation | ✅ (non-negotiable) | |
| Internal postcondition on a hot path | sample only | ✅ |

**Good vs weak property checklist:**

| A good property… | A weak/tautological property… |
|---|---|
| Uses an *independent* oracle (reference, round-trip, law) | Restates the implementation's own formula |
| Can fail if the code has a *different* bug | Fails only if the spec-and-code agree wrongly |
| Asserts a relation (bounds, monotonicity, inverse) | Asserts equality to the code's own computation |
| Shrinks to a minimal, pasteable counterexample | Has no meaningful shrink (it never fails) |
| Reaches deep states (targeted/coverage-guided) | Only ever exercises shallow, uniform inputs |

---

## Mental Models

- **Climb the ladder; pay per rung.** Example test → property → contract → model-based PBT → deductive proof. Each rung costs ~10× more and applies to ~10× less code. Spend where the risk is, not uniformly.

- **PBT and fuzzing are the same idea.** "Try many inputs, check a property" — differing only in how cleverly inputs are chosen (uniform → targeted → coverage-guided). Treat Go fuzzing and Hypothesis as points on one continuum.

- **The oracle is the whole game.** A property is only as strong as the thing deciding correctness. A reference implementation or a round-trip is a strong oracle; restating the code is no oracle at all.

- **A green property that mirrors the code is worse than no test.** It manufactures confidence while proving nothing. Always ask: "would this catch a *different* bug?"

- **Verify the core, test the rest.** Proof is for the small, stable, catastrophic kernel. The 400 lines that, if wrong, are a CVE — not the 400,000 around them.

- **Solver timeouts are missing insight, not broken tools.** When deductive verification stalls, the fix is almost always a lemma, a ghost variable, or an explicit invariant the human supplies and the solver checks.

- **A contract that's checked is documentation that can't lie.** `requires`/`ensures` is the precondition, executed (or proved), so it can't drift from the code the way a comment does.

---

## Common Mistakes

1. **Tautological properties.** Restating the implementation as the assertion. It passes forever while the bug ships. Use an *independent* oracle — reference impl, round-trip, algebraic law, or bounds/monotonicity — and ask whether the property would catch a *different* bug.

2. **Sprinkling PBT uniformly.** One property per module misses the point. Concentrate on the four high-ROI shapes — round-trips, invariants, reference comparisons, stateful APIs — and don't bother forcing PBT onto thin glue code.

3. **Letting PBT be flaky.** Non-reproducible failures get the suite disabled. Persist seeds/examples, ensure deterministic shrinking, and turn every counterexample into a committed regression case. A PBT failure is a found bug with a free repro, never "re-run the job."

4. **Same example budget everywhere.** A 20,000-example run on every PR is too slow; 100 examples nightly wastes the deep run. Small fast budget on PRs, large deep budget on a schedule.

5. **Never reaching deep states.** Uniform generation rarely fills the buffer or triggers eviction. Use `target()` / coverage-guided fuzzing to steer toward the deep states where the interesting bugs live.

6. **Expensive contracts always-on in production.** An O(n) invariant on a hot path is a self-inflicted DoS. Default expensive invariants to debug/test; keep only cheap boundary checks always-on (those are also your security control).

7. **Trying to formally verify everything.** Deductive proof's cost scales superlinearly with size and churn. Verify a small, stable core; test the rest. A team that proves the whole product ships nothing.

8. **Reading a solver timeout as "the tool doesn't work."** It almost always means a missing invariant or lemma. Supply ghost code and `assert` hints; the human provides the insight, the solver checks it.

---

## Test Yourself

1. Your team has 2,000 green property tests and still ships calculation bugs. What's the most likely cause, and how do you fix it without writing more tests?
2. Name the four code shapes where PBT has the highest ROI, and give the canonical property for each.
3. A nightly PBT run fails with a counterexample, but the same job passes when re-run. Is this "flaky"? Describe the correct workflow from failure to permanent fix.
4. You're parsing untrusted bytes and want to find the inputs that reach deep error-recovery paths. What two techniques steer generation there, and what makes "doesn't crash" a *strong* oracle in this setting?
5. You have an O(n) "the whole list stays sorted" invariant. Should it run in production? What's the risk if it does, and what's the general rule for always-on vs debug contracts?
6. When does deductive verification (Dafny/SPARK/Frama-C) actually earn its cost? Give the three conditions that must align and the strategy that follows.
7. A Dafny proof keeps timing out on one case, and the timeout is unstable across unrelated edits. What is this usually *not*, and what's the fix?

<details>
<summary>Answers</summary>

1. The properties are almost certainly **tautological** — they restate the implementation's own formula, so when the formula is wrong the property is wrong identically and passes. The fix is *independent oracles*, not more tests: assert bounds (`0 <= fee <= cap`), monotonicity (more usage never costs less), and comparison against a deliberately-different **reference implementation**. The test is "would this property catch a *different* bug?" — if no, it's decoration.
2. **(a) Serializers/parsers/codecs** → round-trip `decode(encode(x)) == x`. **(b) Custom data structures** → representation invariant + compare to the built-in. **(c) Algorithms with a slow reference** → `fast(x) == slow(x)`. **(d) Stateful APIs (cache/pool/FSM)** → model-based: random op sequence vs a simple model of expected state.
3. It is **not** flaky — it's a found bug with a free repro. Workflow: (a) the framework saved/shrank the failing input; (b) reproduce it locally *from the saved example*, not by re-running the random search; (c) add the shrunk case as an explicit regression test / commit it to the corpus (`testdata/fuzz/`, `.hypothesis/`); (d) fix the code; (e) the committed corpus keeps it fixed forever.
4. **`target()`** (steer generation to maximize a metric, e.g. error-path depth or buffer fullness) and **coverage-guided fuzzing** (libFuzzer/AFL++/Go fuzzing keep inputs that hit new code paths). "Doesn't crash" becomes a *strong* oracle when paired with **sanitizers** (ASan/UBSan): they make latent memory and undefined-behavior bugs crash loudly on the inputs the fuzzer finds, so the absence of a crash means more.
5. **No — keep it debug/test only.** An O(n) invariant checked per call turns O(1) operations into O(n) and becomes a self-inflicted **DoS** under load. General rule: cheap boundary/null/range checks on external input stay **always-on** (they're also security controls); **expensive** invariants are gated behind a build flag or sampling and run in test/CI.
6. Three conditions must align: **(a)** the bug cost is catastrophic (crypto, kernel, flight control, a CVE class); **(b)** the code is small and stable (hundreds of lines, the core, low churn); **(c)** the property is precise (constant-time, never out of bounds, never overflows). Strategy: **"verify the core, test the rest"** — prove the small kernel, use PBT/example tests for everything else.
7. It is usually **not** a tool failure or "the tooling doesn't work." It's a **missing invariant or lemma** (proof instability from an under-specified goal). Fix by adding **ghost code, an explicit inductive invariant, and `assert`/trigger hints** that tell the solver which facts to use — the human supplies the insight, the solver checks it, and the proof becomes fast and stable.

</details>

---

## Cheat Sheet

```
THE RUNG LADDER (cost ~10x per step, applies to ~10x less code)
  example test  →  property test  →  contract  →  model-based PBT  →  deductive proof
  cheap/broad   ───────────────────────────────────────────────►   expensive/narrow

PBT HIGH-ROI SHAPES + THEIR PROPERTY
  serializer/codec      decode(encode(x)) == x        (round-trip)
  data structure        invariant + compare to built-in
  algo w/ slow ref      fast(x) == slow(x)
  stateful API          model-based: op sequence vs model
  no oracle             metamorphic: relate two runs

GOOD PROPERTY TEST
  use an INDEPENDENT oracle (ref impl / round-trip / law / bounds)
  must catch a DIFFERENT bug, not restate the code  ← the tautology trap

PBT IN CI (or the team disables it)
  persist seeds/examples; deterministic shrinking
  PR run: small budget (Hypothesis ~100; go test = seed corpus only)
  nightly: deep run (max_examples=20k; go test -fuzz -fuzztime=30m)
  every counterexample → committed regression corpus (testdata/fuzz, .hypothesis)
  a PBT failure = a found bug with a free repro, NEVER "re-run the job"

REACH DEEP STATES
  target(metric)           Hypothesis: steer toward interesting inputs
  coverage-guided fuzzing  libFuzzer / AFL++ / go test -fuzz / Hypothesis+atheris
  + sanitizers (ASan/UBSan) → "doesn't crash" becomes a STRONG oracle

CONTRACTS: always-on vs debug
  cheap boundary/null/range on external input   ALWAYS ON (also security)
  O(n) "whole collection" invariant             DEBUG/TEST (prod = self-DoS)
  cross-trust-boundary validation               ALWAYS ON (non-negotiable)

DEDUCTIVE PROOF — only when ALL hold
  bug cost catastrophic + code small & stable + property precise
  strategy: VERIFY THE CORE, TEST THE REST  (AWS Dafny/s2n, SPARK in aero/rail)
  timeout? → missing invariant/lemma; add ghost code + assert hints, not blame
```

---

## Summary

- **Run property and contract verification as a program, and match the rung to the risk.** There's a ladder — example test → property → contract → model-based PBT → deductive proof — where each rung costs roughly 10× more and applies to roughly 10× less code. PBT and contracts are the under-adopted sweet spot; deductive proof is the expensive sliver.
- **Concentrate PBT on the four high-ROI shapes:** round-trips (`decode(encode(x)) == x`), data-structure invariants, reference-implementation comparisons (`fast == slow`), and **model-based** testing of stateful APIs — where order-dependent bugs live and example tests can't reach.
- **The oracle is the whole game.** A property is only as strong as the independent thing deciding correctness. Tautological properties that restate the implementation pass forever while bugs ship — green decoration is worse than no test. Use reference impls, round-trips, algebraic laws, metamorphic relations, or bounds.
- **Make PBT reliable or it gets deleted:** persist seeds, deterministic shrinking, small PR budgets vs deep nightly runs, and a *committed regression corpus* of past counterexamples. Every failure is a found bug with a free, shrunk repro — never "flaky, re-run."
- **PBT and fuzzing converge.** Use `target()` and coverage-guided fuzzing (Go's native fuzzer, Hypothesis + atheris) to reach deep states, and pair with sanitizers so "doesn't crash" becomes a strong oracle. See [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/).
- **Contracts are a production decision:** cheap boundary checks always-on (they're security too), expensive invariants debug/test-only (always-on is a self-DoS). A checked contract is documentation that can't drift.
- **Deductive verification earns its keep only when bug cost is catastrophic, code is small and stable, and the property is precise** — then **verify the core, test the rest** (AWS's Dafny/s2n-TLS work; SPARK/Ada in aerospace and rail). Solver timeouts are missing invariants, not broken tools.

This is the rung of formal methods most teams should fund first. The next tier — [interview.md](interview.md) — consolidates the topic into the questions that probe whether someone can actually pick the right rung and write a property that finds bugs.

---

## Further Reading

- John Hughes — *"QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs"* and the talk **"QuickCheck Testing for Fun and Profit"** — the origin of PBT and, crucially, the discipline of *good* properties and shrinking.
- [Hypothesis documentation](https://hypothesis.readthedocs.io/) — the practical reference for strategies, `target()`, the example database, settings profiles, and stateful (model-based) testing.
- [Go fuzzing documentation](https://go.dev/security/fuzz/) — native coverage-guided fuzzing with PBT ergonomics; the seed corpus and `testdata/fuzz/` regression workflow.
- K. Rustan M. Leino — *Program Proofs* and the [Dafny](https://dafny.org/) materials — the accessible on-ramp to deductive verification, contracts, ghost code, and lemmas.
- [SPARK/Ada case studies (AdaCore)](https://www.adacore.com/sparkpro) — verified subsets in aerospace, rail, and security; the "verify a critical core" model in industry.
- AWS Provable Security — the [s2n-TLS](https://github.com/aws/s2n-tls) verification work and AWS's use of Dafny and automated reasoning — picking a small, high-value target and proving it.
- Bertrand Meyer — *Object-Oriented Software Construction* (design by contract) — the canonical treatment of pre/postconditions and invariants as part of the design.
- For interview-style consolidation of this material, see [interview.md](interview.md).

---

## Related Topics

- [01 — Formal Specification](../01-formal-specification/professional.md) — the spec is the oracle a property or contract checks against; weak spec, weak verification.
- [05 — Proof Assistants & Dependent Types](../05-proof-assistants-and-dependent-types/professional.md) — the rung above deductive proof: arbitrary theorems and full functional correctness (Coq/Rocq, Lean, Isabelle).
- [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/professional.md) — the full ROI calculus behind "match the rung to the risk."
- [Testing](../../testing/) — where property-based, contract, mutation, and fuzz testing live as everyday practice; the reliability playbook for flaky suites.
- [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) — runtime assertion/contract checking and the ASan/UBSan that make fuzzing's "doesn't crash" a strong oracle.
