---
layout: default
title: Property-Based Testing — Tasks
parent: Property-Based Testing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/16-property-based-testing/tasks/
---

# Property-Based Testing — Tasks

[← Back](../)

Hands-on exercises. Each task gives a unit under test and asks you to write
properties. Use `pgregory.net/rapid` unless otherwise noted.

## Task 1 — sort

Write at least four properties for `sort.Ints`:

1. Output is sorted.
2. Output has the same length as input.
3. Output is a permutation of input (multiset equality).
4. Idempotency: sorting twice equals sorting once.

Hint: build a multiset by counting elements in a `map[int]int`.

```go
func TestSortInts(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        in := rapid.SliceOf(rapid.Int()).Draw(t, "in")
        cp := append([]int(nil), in...)
        sort.Ints(cp)
        // properties go here
    })
}
```

## Task 2 — JSON round-trip

For your domain type:

```go
type User struct {
    ID    int
    Name  string
    Email string
    Tags  []string
}
```

Write a custom generator and check `decode(encode(u)) == u`.

Hint:

```go
genUser := rapid.Custom(func(t *rapid.T) User {
    return User{
        ID:    rapid.Int().Draw(t, "id"),
        Name:  rapid.String().Draw(t, "name"),
        Email: rapid.StringMatching(`[a-z]+@[a-z]+\.[a-z]+`).Draw(t, "email"),
        Tags:  rapid.SliceOf(rapid.String()).Draw(t, "tags"),
    }
})
```

## Task 3 — base64

Property: `base64.StdEncoding.DecodeString(base64.StdEncoding.EncodeToString(b))`
returns the original `b`.

Compare with `bytes.Equal`. Also verify that the encoded form contains only
characters from the base64 alphabet.

## Task 4 — set union

If `Union(a, b)` returns the merged set:

- `Union(a, b) = Union(b, a)` (commutativity)
- `Union(Union(a, b), c) = Union(a, Union(b, c))` (associativity)
- `Union(a, {}) = a` (identity)
- `Union(a, a) = a` (idempotency)

Write all four.

## Task 5 — LRU cache state machine

Use `rapid.Run` with this model:

```go
type CacheModel struct {
    cap   int
    cache *LRU
    model map[string]string
    order []string // insertion order, evict from front
}
func (m *CacheModel) Init(t *rapid.T) { ... }
func (m *CacheModel) Get(t *rapid.T) { ... }
func (m *CacheModel) Set(t *rapid.T) { ... }
func (m *CacheModel) Check(t *rapid.T) {
    // size <= cap, every model key returns the model value
}
```

Run with `rapid.Run[*CacheModel]()(t)`.

## Task 6 — parser round-trip

For a small expression language (`expr = num | expr "+" expr`), write:

- `Parse(Print(ast)) == ast`
- `Print(Parse(s)) == s` (only if your printer is canonical)

PBT will find every printer/parser asymmetry.

## Task 7 — `testing/quick` only

Without using rapid, write a property with `testing/quick` that
`strings.ToUpper(strings.ToLower(s)) == strings.ToUpper(s)` (idempotency
after lower).

Note the lack of shrinking; on failure print the input length.

## Task 8 — monotonicity

If `f(x) = math.Sqrt(x)` for `x >= 0`, check `a < b ⇒ f(a) <= f(b)` over
`IntRange(0, 1<<30)`.

## Task 9 — fuzz + PBT hybrid

Write a single fuzz target that:

1. Takes raw bytes.
2. Decodes them as a sequence of `(op, key, value)` triples.
3. Runs them against your map implementation.
4. Asserts model equivalence.

This is PBT-style property fed by libFuzzer-style input mutation.

## Task 10 — counter-example replay

Force a failure on Task 1 by introducing a buggy sort:

```go
func badSort(xs []int) []int {
    out := append([]int(nil), xs...)
    if len(out) > 0 { out[0] = 0 } // bug
    sort.Ints(out)
    return out
}
```

Run with `-rapid.checks=10000`. Note the seed. Re-run with that seed and
confirm you get the same minimal counter-example.

## Task 11 — choose your generator distribution

Write a generator that produces `int` values with the following bias:

- 30% of the time: edge values (0, -1, max, min).
- 70% of the time: uniform in `[-1000, 1000]`.

Use `rapid.OneOf`. Compare coverage against a naive `rapid.Int()` on a
property that has different behaviour at edges.

## Task 12 — when not to use PBT

For each of the following, decide PBT or example-based:

- Tax calculator with 5 brackets.
- HTTP middleware that authenticates a request.
- A library implementing AVL trees.
- A function that returns `"hello, " + name`.

Justify your answer in 2-3 sentences each.

## Task 13 — string builder round-trip

For a custom string builder that joins parts with a delimiter:

```go
func Join(parts []string, delim string) string
func Split(s, delim string) []string
```

Write the property `Split(Join(parts, ","), ",") == parts`. Watch for the
case where `parts` contains the delimiter — your implementation must
escape it or the round-trip will fail. Use PBT to discover the case.

## Task 14 — `time.Duration` arithmetic

Write properties for `time.Duration` arithmetic:

- `a + (b + c) == (a + b) + c` (overflow aware — bound the values to
  prevent wrap).
- `a + 0 == a`.
- `a + (-a) == 0` (subject to overflow).

Use `rapid.Int64Range(-1e15, 1e15)` to bound and avoid overflow.

## Task 15 — model-based test for a counter

Build a `rapid.StateMachine` test for a counter with `Inc`, `Dec`, and
`Reset`. Model state is a single `int`. Verify that `Value()` always
equals the model's tracked value after every operation.

This is the simplest possible state-machine test; do it once before
tackling the LRU in Task 5.

## Task 16 — finding a real edge case

Write the property `Abs(x) >= 0` for `int`. Run it with rapid. Observe
the failure for `math.MinInt`. Confirm the seed reproduces. Explain the
bug in one sentence.

This task exists to **make you feel** what PBT does that examples
cannot: it found an edge case for free, without you thinking about it.

## Task 17 — shrinking demonstration

Inject a deliberate bug into a sort: if `xs[0] > xs[1]`, swap and
return. Run a permutation property. Note the shrunk counter-example.
Confirm it is the smallest input that triggers the bug (likely
`[1, 0]`).

Try the same with `testing/quick`: the failure will be much larger and
harder to interpret.

## Task 18 — write your own generator for emails

Build a generator that produces strings matching a valid email RFC
subset:

- Local part: 1-32 characters from `[a-zA-Z0-9._-]`.
- `@`.
- Domain: 1-32 characters from `[a-zA-Z0-9-]`, dot, 2-6 letter TLD.

Use it to test an email validator. Property: every generated email is
accepted by the validator. Then add a second generator that produces
*invalid* emails (e.g. missing `@`) and check the validator rejects
them.

## Task 19 — graph reachability oracle

Implement Dijkstra's algorithm. Also implement BFS (only valid for
unit-weight graphs). For random unit-weight graphs, write the property
`Dijkstra(g, src) == BFS(g, src)`.

This is the oracle pattern: BFS is the slow, obviously correct
reference; Dijkstra is the fast implementation. PBT catches any
divergence.

## Task 20 — write a counter-example into the failfile

Force a known failure. Note the seed and `-rapid.failfile` path printed
in the output. Commit that file to your repo. Re-run with
`-rapid.failfile=PATH` and confirm the same failing input is replayed
first. Fix the bug. The failfile becomes a permanent regression test.

## Task 21 — generators that respect domain invariants

Write a generator for `Triangle{A, B, C int}` where `A + B > C`,
`B + C > A`, `A + C > B` (the triangle inequality). Bonus: do it
without using `Filter`.

Hint: draw two sides, then draw the third in the range `[|a-b|+1, a+b-1]`.

## Task 22 — refactor under PBT protection

Take a small utility function in your codebase (e.g. a string
normaliser). Write a property describing its current behaviour. Refactor
the implementation. The property should remain green throughout — that
is your confidence that you preserved semantics.

## Task 23 — mutation kill rate

For your strongest property, manually inject a small bug (off-by-one,
wrong comparison). Confirm PBT catches it. Try a more subtle bug
(swap two variables of the same type). Does PBT still catch it?
If not, what additional property would?

## Task 24 — testing/quick first, then rapid

Write the same property twice — first using `testing/quick`, then with
`pgregory.net/rapid`. Compare:

- API ergonomics.
- Failure message readability.
- Time to identify the minimal counter-example.

Document which you would use for new code and why.

## Task 25 — properties for a permission system

Suppose you have:

```go
type Permission int
const (
    Read Permission = 1 << iota
    Write
    Admin
)
func (p Permission) Has(q Permission) bool
func (p Permission) Grant(q Permission) Permission
func (p Permission) Revoke(q Permission) Permission
```

Write properties:

- `Grant` is commutative.
- After `Revoke(q)`, `Has(q)` is false.
- `Grant(p, q).Has(q)` is true.
- `Revoke(Grant(p, q), q) == p` when `!p.Has(q)`.

These four properties pin the algebra. Notice how PBT makes you state
laws explicitly rather than enumerating cases.

## Task 26 — write a generator coverage report

For your property, add `rapid.Label(t, ...)` calls categorising the
inputs (empty, small, large, contains duplicates, all-zero, etc.).
Run with `-rapid.v`. Examine the histogram. Tune the generator until
every label fires at least 5% of the time.

This task exists to make you feel the importance of generator coverage.

## Task 27 — convert an example test to a property

Pick an example test in your repo. Identify the underlying invariant.
Replace it (keeping the example as a regression case) with a property.
Run with `-rapid.checks=10000`. Did the property find anything the
example missed? Document what you learned.
