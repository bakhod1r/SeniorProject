---
layout: default
title: Property-Based Testing — Interview
parent: Property-Based Testing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/16-property-based-testing/interview/
---

# Property-Based Testing — Interview

[← Back](../)

Interview-style questions and answers about property-based testing (PBT) in Go.

## Q1. What is property-based testing?

PBT is a testing technique where you describe **invariants** (general properties)
that should hold for **any valid input**, and a library generates many random
inputs to check those properties. It contrasts with example-based testing where
you write specific input/output pairs by hand.

Properties answer: "what is always true?" rather than "what is true for x=3?".

## Q2. PBT vs example-based testing — when to use each?

Example-based wins for:

- Discrete business rules ("tax on 100 USD in CA = 8.25 USD").
- Regression tests pinned to a specific bug.
- Cases where the expected output cannot be expressed as a property.

PBT wins for:

- Codecs, parsers, serializers — round-trip is a natural property.
- Data structures — invariants like "sorted output", "balanced tree".
- Pure functions with algebraic laws (associativity, commutativity, identity).
- Idempotent operations.

In practice, use both. Examples document intent. Properties exhaust corners.

## Q3. PBT vs fuzzing in Go — what is the difference?

Native `go test -fuzz` mutates raw bytes (or registered seed values) to crash
the function. It is great at finding panics, hangs, and data corruption when
parsing untrusted input.

PBT (rapid, gopter) generates **structured, typed values** matching your
domain (e.g. a `User{Name: ..., Age: ...}`). It checks a logical property,
not just absence of panic.

They are complementary. Fuzz the byte boundary; PBT the structured types
beyond it.

## Q4. What is shrinking?

When a property fails, a PBT library tries to find a **minimal counter-example**:
the smallest, simplest input that still triggers the failure. Instead of
reporting "failed on `[7, 3, 99, 4, -1, 50]`" the library reports
"failed on `[-1, 0]`". Shrinking saves hours of debugging.

`testing/quick` does **not** shrink. `rapid` and `gopter` do.

## Q5. Name common properties.

- **Idempotency**: `f(f(x)) == f(x)` (sort, normalize, trim).
- **Round-trip**: `decode(encode(x)) == x` (JSON, base64, gob).
- **Commutativity**: `f(a, b) == f(b, a)` (set union, addition).
- **Associativity**: `f(f(a,b),c) == f(a,f(b,c))` (concat, addition).
- **Identity**: `f(x, id) == x` (multiply by 1, append empty slice).
- **Monotonicity**: `x <= y` implies `f(x) <= f(y)`.
- **Invariant preservation**: input has property P ⇒ output has property P.
- **Equivalence to a reference**: `fast(x) == naive(x)`.

## Q6. How do you reproduce a failure?

`rapid` prints a seed on failure. Re-run with `-rapid.seed=<value>` or
`-rapid.failfile=<path>` to replay the exact input. `testing/quick` exposes
`Config.Rand` so you can pin the source.

Always log the seed in CI so flakes can be replayed.

## Q7. What is stateful (model-based) PBT?

Instead of testing a pure function, you generate **a random sequence of
operations** against a system (e.g. an LRU cache) and a simplified model.
After each operation you assert the system matches the model.

`rapid.StateMachine` automates command generation and shrinking of the
sequence. It is excellent for queues, caches, ring buffers, and databases.

## Q8. Limitations of `testing/quick`?

- No shrinking.
- No support for generators of custom types without implementing
  `quick.Generator`.
- Hard to bias toward edge cases (empty, max int, NaN).
- Limited reporting (just dump the failing args).

Use it for quick one-liners on numeric or string-only properties; reach for
`rapid` for anything serious.

## Q9. When is PBT overkill?

- Tiny pure functions where 3 examples cover the entire input space.
- Code dominated by side effects you cannot mock cheaply.
- Business rules that are essentially lookup tables.
- One-off scripts.

The cost of PBT is mostly **writing the generator and the property**. If that
exceeds the cost of three good examples, skip PBT.

## Q10. How do you bias generators toward edge cases?

`rapid` provides `rapid.IntRange`, `rapid.StringMatching`, and combinators
like `rapid.OneOf` to mix generators. You can also wrap a generator with
`rapid.Map` to project values and `rapid.Custom` to compose them. Add
explicit edge values (0, -1, max, empty, very large) as one branch in a
`OneOf` so they are hit more often than uniform sampling alone would.

## Q11. How many runs is enough?

Default in rapid is 100 per property. For codecs and parsers raise to
1_000-10_000 in CI; keep dev runs short. Use `-rapid.checks=N` to override.

The right number is the smallest that catches regressions reliably within
your CI time budget.

## Q12. What is the relationship to QuickCheck?

QuickCheck is the original Haskell library that defined PBT. `rapid`,
`gopter`, Python's `hypothesis`, and Scala's `ScalaCheck` are all
descendants. The mental model — generators, shrinkers, properties — is
shared across all of them.

## Q13. How do you generate a slice plus a valid index inside it?

Draw the slice first, then draw an index conditional on its length:

```go
gen := rapid.Custom(func(t *rapid.T) (xs []int, i int) {
    xs = rapid.SliceOfN(rapid.Int(), 1, 100).Draw(t, "xs")
    i = rapid.IntRange(0, len(xs)-1).Draw(t, "i")
    return
})
```

The key insight: generator code is imperative Go, so later draws can
depend on earlier ones. This is more reliable than filtering.

## Q14. What is a "discard rate" and why does it matter?

When a generator produces values that the property must reject (via
filtering, skipping, or precondition checks), the PBT library counts
those as discards. A high discard rate means most generated inputs are
useless — wasted CPU and degraded shrinking quality.

`rapid` complains if the discard rate exceeds ~75%. Fix: construct the
value to satisfy the predicate rather than filter.

## Q15. How does rapid shrink?

rapid replays the property with progressively smaller byte streams
driving the generators. Each generator deterministically consumes bytes,
so reducing the byte stream reduces the value. This is type-agnostic —
every generator shrinks automatically.

For state machines, rapid also shrinks the *sequence of actions* (fewer
actions, simpler choices) before shrinking the per-action parameters.

## Q16. Can PBT find concurrency bugs?

It can find concurrency bugs through model-based testing: generate a
sequence of concurrent operations and assert linearizability. But this
is hard. For most teams, `-race` plus targeted property tests of
single-threaded invariants is enough.

True concurrency PBT is the territory of Jepsen, Knossos, and Porcupine.

## Q17. What is `rapid.Label` for?

It tags the current run with a category. With `-rapid.v`, rapid prints
a histogram. Used to confirm generator coverage:

```go
rapid.Label(t, "empty", len(xs) == 0)
rapid.Label(t, "duplicates", hasDuplicates(xs))
```

If a label never fires, your generator is too narrow.

## Q18. When would you use `gopter` instead of `rapid`?

When you inherit a codebase already using gopter. For new code, rapid
is preferred because of generics, integrated shrinker, and active
maintenance. Both are correct choices; consistency within a codebase
matters more than picking the "best".

## Q19. What is the smallest test you would write for `Reverse`?

```go
rapid.Check(t, func(t *rapid.T) {
    xs := rapid.SliceOf(rapid.Int()).Draw(t, "xs")
    if !reflect.DeepEqual(Reverse(Reverse(xs)), xs) {
        t.Fatal()
    }
})
```

One property, four lines. It catches off-by-one indexing, length bugs,
and aliasing bugs in one shot.

## Q20. Walk through a real PBT failure.

You write a property for a JSON marshaller. It fails after 47 runs.
rapid prints the minimal counter-example: `User{Name: " ", Age: 0}`.
You run with `-rapid.seed=...` locally and confirm.

Inspect the bug: your custom JSON marshaller drops NUL bytes from strings.
Fix: escape them as ` ` in the output.

Commit the seed under `testdata/rapid/TestUserJSON/seed-...txt`. Future
runs replay this seed first, ensuring the bug stays fixed.

## Q21. Compare PBT to mutation testing.

- **PBT**: generates random inputs, fixed code.
- **Mutation**: random code mutations, fixed inputs (your test suite).

They are orthogonal. Mutation testing validates your test suite —
including your properties. If a mutation survives, your tests are
incomplete. PBT validates your code against properties.

Use both. PBT writes the tests; mutation grades them.

## Q22. What makes a property "good"?

A good property:

- Is true for every valid input (no false positives).
- Is false for buggy implementations (no false negatives).
- Is cheap to evaluate (so 100+ runs are practical).
- Names a clear invariant in plain language.

A weak property like `len(out) >= 0` fails the second criterion: any
implementation passes. A flaky property fails the first.

## Q23. How do you bias rapid toward edge values?

```go
gen := rapid.OneOf(
    rapid.Just(0), rapid.Just(-1), rapid.Just(math.MaxInt),
    rapid.Int(),
)
```

The four edge values share 4/5 probability with general `Int()`.
For your code, that's far better edge coverage than uniform sampling.

## Q24. Can PBT replace integration tests?

No. PBT shines on **structured, pure** code. Integration tests verify
that real services wire together. Both are necessary.

A useful pattern: PBT individual components, integration test the
seams.

## Q25. What is your strategy for a flaky PBT test?

1. Pin the seed: `-rapid.seed=N -rapid.checks=1`.
2. If still flaky, the unit under test is non-deterministic — fix that.
3. If reproducible, debug from the minimal counter-example.
4. Add the seed to `testdata/rapid/` as a regression test.

Never disable a property without investigating. Disabled properties are
worse than missing ones because they imply false confidence.

## Q26. How do property tests change code design?

Functions written with PBT in mind are:

- More **pure**: side effects are pushed to the edges.
- More **composable**: properties test composition.
- Better **typed**: types document invariants.
- More **deterministic**: clock and randomness become explicit
  dependencies.

The discipline of writing properties often improves the design of the
code under test. This is a known phenomenon and a soft benefit of PBT.

## Q27. When is `testing/quick` enough?

When:

- You don't want an external dependency.
- The function is simple and you don't need custom generators.
- You can accept the lack of shrinking.

For internal tooling, scripts, or library code that wants zero deps,
`testing/quick` is fine. For production-grade test suites, prefer rapid.
