---
layout: default
title: Property-Based Testing — Middle
parent: Property-Based Testing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/16-property-based-testing/middle/
---

# Property-Based Testing — Middle

[← Back](../)

This page assumes you have written basic properties with `pgregory.net/rapid`
and understand the round-trip / idempotency / permutation patterns. We
now go deeper:

- Custom generators for your domain types.
- Combinators: `Map`, `Custom`, `OneOf`, `Filter`, `SampledFrom`.
- Round-trip testing of JSON, gob, protobuf.
- Monotonicity and other algebraic properties.
- Bias toward edge cases.
- A short look at `leanovate/gopter` as an alternative library.

## 1. Custom generators with `rapid.Custom`

To test a function that takes a `User`, you need a generator that
produces `User` values. The simplest construction is `rapid.Custom`:

```go
type User struct {
    ID     int
    Name   string
    Email  string
    Active bool
    Tags   []string
}

var genUser = rapid.Custom(func(t *rapid.T) User {
    return User{
        ID:     rapid.IntRange(1, 1<<30).Draw(t, "ID"),
        Name:   rapid.StringN(1, 50, -1).Draw(t, "Name"),
        Email:  rapid.StringMatching(`[a-z]+@[a-z]+\.[a-z]+`).Draw(t, "Email"),
        Active: rapid.Bool().Draw(t, "Active"),
        Tags:   rapid.SliceOfN(rapid.String(), 0, 10).Draw(t, "Tags"),
    }
})
```

Then use it like any other generator:

```go
rapid.Check(t, func(t *rapid.T) {
    u := genUser.Draw(t, "u")
    // property body
})
```

Key points:

- Each `Draw` call inside `Custom` consumes randomness independently.
- Labels (`"ID"`, `"Name"`, ...) appear in failure reports — choose them
  to be informative.
- Custom generators participate in shrinking automatically; rapid replays
  the underlying byte stream and shrinks each `Draw`.

## 2. `rapid.Map` — projecting a generator

If you already have a generator for `A` and a function `A -> B`, you can
build a generator for `B` with `rapid.Map`:

```go
genEvenInt := rapid.Map(rapid.Int(), func(x int) int {
    if x%2 != 0 { x++ }
    return x
})
```

`Map` is great for derived types: pick a base, transform.

## 3. `rapid.OneOf` — sum types and biased distributions

When values can be one of several variants:

```go
type Event interface{ event() }
type Click struct{ X, Y int }
type Key   struct{ Code rune }
func (Click) event() {}
func (Key) event()   {}

var genEvent = rapid.OneOf(
    rapid.Custom(func(t *rapid.T) Event {
        return Click{
            X: rapid.IntRange(0, 1920).Draw(t, "X"),
            Y: rapid.IntRange(0, 1080).Draw(t, "Y"),
        }
    }),
    rapid.Custom(func(t *rapid.T) Event {
        return Key{Code: rapid.Rune().Draw(t, "Code")}
    }),
)
```

`OneOf` picks uniformly at random. To bias, repeat a generator:

```go
// Click is twice as likely as Key.
var genEvent = rapid.OneOf(genClick, genClick, genKey)
```

## 4. `rapid.Filter` — restricting outputs

`Filter` drops values that fail a predicate. It is occasionally needed,
but **prefer to construct the values directly** because filtering can
discard so many candidates that rapid gives up.

```go
// Bad: most random strings are not valid emails.
gen := rapid.Filter(rapid.String(), isEmail)

// Good: build the value to satisfy the predicate.
gen := rapid.StringMatching(`[a-z]+@[a-z]+\.[a-z]+`)
```

Rule of thumb: filtering should accept at least 80% of values; otherwise
construct or `Map`.

## 5. `rapid.SampledFrom` — picking from a set

When the domain is a fixed list (HTTP method, enum, country code):

```go
var genMethod = rapid.SampledFrom([]string{"GET", "POST", "PUT", "DELETE"})
```

Use this instead of `OneOf(Just(...), Just(...), ...)`.

## 6. Round-trip: JSON

A common pattern: marshal then unmarshal, compare with original.

```go
func TestUserJSONRoundTrip(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        u := genUser.Draw(t, "u")
        b, err := json.Marshal(u)
        if err != nil { t.Fatal(err) }
        var got User
        if err := json.Unmarshal(b, &got); err != nil { t.Fatal(err) }
        if !reflect.DeepEqual(u, got) {
            t.Fatalf("round-trip mismatch:\n in: %+v\nout: %+v", u, got)
        }
    })
}
```

Common pitfalls:

- **`time.Time`** — JSON marshals with monotonic clock stripped. Compare
  with `time.Equal` or normalise before encoding.
- **`map` ordering** — JSON marshal sorts keys, so `Unmarshal(Marshal(m))`
  gives a map with the same entries. But comparing maps with
  `reflect.DeepEqual` is order-independent, so this works.
- **`int` vs `float64`** — `json.Unmarshal` decodes numbers into
  `float64` by default for `interface{}` targets. Use concrete types.
- **NaN / Inf floats** — JSON encoders error on them. Filter or clamp.

## 7. Round-trip: gob

```go
rapid.Check(t, func(t *rapid.T) {
    u := genUser.Draw(t, "u")
    var buf bytes.Buffer
    enc := gob.NewEncoder(&buf)
    if err := enc.Encode(u); err != nil { t.Fatal(err) }
    var got User
    if err := gob.NewDecoder(&buf).Decode(&got); err != nil { t.Fatal(err) }
    if !reflect.DeepEqual(u, got) {
        t.Fatalf("gob round-trip mismatch:\n in: %+v\nout: %+v", u, got)
    }
})
```

Gob preserves Go types (including `map` and `slice`) more faithfully than
JSON. The property body is structurally identical.

## 8. Round-trip: protobuf

```go
rapid.Check(t, func(t *rapid.T) {
    msg := genUserProto.Draw(t, "msg")
    b, err := proto.Marshal(msg)
    if err != nil { t.Fatal(err) }
    got := &pb.User{}
    if err := proto.Unmarshal(b, got); err != nil { t.Fatal(err) }
    if !proto.Equal(msg, got) {
        t.Fatalf("proto round-trip mismatch")
    }
})
```

Use `proto.Equal` rather than `reflect.DeepEqual`; protobuf messages
contain internal cache fields that DeepEqual will trip over.

## 9. Round-trip: URL encoding

```go
rapid.Check(t, func(t *rapid.T) {
    s := rapid.String().Draw(t, "s")
    out, err := url.QueryUnescape(url.QueryEscape(s))
    if err != nil { t.Fatal(err) }
    if out != s {
        t.Fatalf("URL escape round-trip failed for %q -> %q", s, out)
    }
})
```

Any codec is a target.

## 10. Round-trip: base64

```go
rapid.Check(t, func(t *rapid.T) {
    b := rapid.SliceOf(rapid.Byte()).Draw(t, "b")
    enc := base64.StdEncoding.EncodeToString(b)
    dec, err := base64.StdEncoding.DecodeString(enc)
    if err != nil { t.Fatal(err) }
    if !bytes.Equal(dec, b) {
        t.Fatalf("base64 round-trip mismatch")
    }
})
```

## 11. Monotonicity

A function `f` is monotonic if `a <= b ⇒ f(a) <= f(b)`. Useful when
testing rate limiters, percentile estimators, scoring functions, and
threshold predicates.

```go
rapid.Check(t, func(t *rapid.T) {
    a := rapid.IntRange(0, 1<<30).Draw(t, "a")
    b := rapid.IntRange(0, 1<<30).Draw(t, "b")
    if a > b { a, b = b, a }
    if Score(a) > Score(b) {
        t.Fatalf("monotonicity violated: a=%d b=%d score(a)=%d score(b)=%d",
            a, b, Score(a), Score(b))
    }
})
```

## 12. Algebraic laws

Many functions obey familiar algebraic laws. PBT is the cheapest way to
encode them.

| Law             | Statement                                |
|-----------------|------------------------------------------|
| Associativity   | `f(f(a, b), c) == f(a, f(b, c))`         |
| Commutativity   | `f(a, b) == f(b, a)`                     |
| Identity        | `f(a, e) == a` and `f(e, a) == a`        |
| Inverse         | `f(a, inv(a)) == e`                      |
| Distributivity  | `f(a, g(b, c)) == g(f(a, b), f(a, c))`   |
| Absorption      | `f(a, g(a, b)) == a`                     |

Use them to test things like merge functions, monoids, set operations,
graph compositions.

## 13. Equivalence to a reference

Refactoring an algorithm? Keep the old version under a renamed name and
PBT them against each other:

```go
func TestFastSqrtMatchesNaive(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        x := rapid.Float64Range(0, 1e10).Draw(t, "x")
        fast := FastSqrt(x)
        naive := math.Sqrt(x)
        if math.Abs(fast-naive) > 1e-6 {
            t.Fatalf("disagree on %g: fast=%g naive=%g", x, fast, naive)
        }
    })
}
```

When the new version is stable, you can delete the old one. The property
gave you confidence that you replicated semantics exactly.

## 14. Biasing toward edge cases

Random ints rarely land on `0`, `math.MaxInt`, or `math.MinInt`. Bias
your generator:

```go
var genEdgyInt = rapid.OneOf(
    rapid.Just(0),
    rapid.Just(1),
    rapid.Just(-1),
    rapid.Just(math.MaxInt),
    rapid.Just(math.MinInt),
    rapid.Int(),
)
```

`OneOf` picks uniformly across its arguments, so each of the five
constants and the general `Int()` has 1/6 probability. For your code,
that is far better edge coverage than naive `rapid.Int()`.

## 15. Generators for time

`time.Time` is tricky because of monotonic clock and locations:

```go
var genTime = rapid.Custom(func(t *rapid.T) time.Time {
    sec := rapid.Int64Range(0, 1<<32).Draw(t, "sec")
    nsec := rapid.Int64Range(0, 999_999_999).Draw(t, "nsec")
    return time.Unix(sec, nsec).UTC()
})
```

Always normalise to UTC and strip monotonic by calling `.Round(0)` if
your round-trip preserves wall but not monotonic.

## 16. Generators for slices with constraints

For a slice with no duplicates:

```go
genUniqueInts := rapid.Custom(func(t *rapid.T) []int {
    n := rapid.IntRange(0, 50).Draw(t, "n")
    seen := map[int]struct{}{}
    out := []int{}
    for len(out) < n {
        v := rapid.Int().Draw(t, "v")
        if _, ok := seen[v]; ok { continue }
        seen[v] = struct{}{}
        out = append(out, v)
    }
    return out
})
```

For a sorted slice:

```go
genSortedInts := rapid.Custom(func(t *rapid.T) []int {
    xs := rapid.SliceOf(rapid.Int()).Draw(t, "xs")
    sort.Ints(xs)
    return xs
})
```

For a slice paired with an index inside it:

```go
type SliceAndIndex struct {
    Xs []int
    I  int
}

var genSliceAndIndex = rapid.Custom(func(t *rapid.T) SliceAndIndex {
    xs := rapid.SliceOfN(rapid.Int(), 1, 100).Draw(t, "xs")
    i := rapid.IntRange(0, len(xs)-1).Draw(t, "i")
    return SliceAndIndex{Xs: xs, I: i}
})
```

This pattern — generating a value plus a valid sub-position — is
extremely common.

## 17. Properties for parsers

A parser turns text into a structured value. Two great properties:

### 17.1 Print-parse round-trip

```go
rapid.Check(t, func(t *rapid.T) {
    ast := genAST.Draw(t, "ast")
    text := Print(ast)
    parsed, err := Parse(text)
    if err != nil { t.Fatalf("Parse(%q) error: %v", text, err) }
    if !reflect.DeepEqual(parsed, ast) {
        t.Fatalf("round-trip mismatch:\n in: %+v\nout: %+v", ast, parsed)
    }
})
```

### 17.2 Parse-print round-trip (idempotency of canonical form)

```go
rapid.Check(t, func(t *rapid.T) {
    s := genValidProgramText.Draw(t, "s")
    ast1, err := Parse(s)
    if err != nil { return }
    text := Print(ast1)
    ast2, err := Parse(text)
    if err != nil { t.Fatalf("re-parse failed: %v", err) }
    if !reflect.DeepEqual(ast1, ast2) {
        t.Fatalf("parse-print-parse mismatch")
    }
})
```

Parsers and printers tend to drift apart over time. These two properties
catch every divergence.

## 18. Property for an idempotent normaliser

```go
func TestNormalizeEmailIdempotent(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        s := rapid.String().Draw(t, "s")
        once := NormalizeEmail(s)
        twice := NormalizeEmail(once)
        if once != twice {
            t.Fatalf("not idempotent: %q -> %q -> %q", s, once, twice)
        }
    })
}
```

Combine with a positive property:

```go
func TestNormalizeEmailLowercases(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        s := rapid.String().Draw(t, "s")
        out := NormalizeEmail(s)
        if out != strings.ToLower(out) {
            t.Fatalf("not lowercased: %q -> %q", s, out)
        }
    })
}
```

## 19. `leanovate/gopter` — alternative library

`gopter` predates rapid and uses a different API style. It is still
maintained and you may encounter it in older codebases.

```go
import (
    "github.com/leanovate/gopter"
    "github.com/leanovate/gopter/gen"
    "github.com/leanovate/gopter/prop"
)

func TestReverseGopter(t *testing.T) {
    params := gopter.DefaultTestParameters()
    params.MinSuccessfulTests = 200
    properties := gopter.NewProperties(params)
    properties.Property("reverse twice is identity", prop.ForAll(
        func(xs []int) bool {
            return reflect.DeepEqual(Reverse(Reverse(xs)), xs)
        },
        gen.SliceOf(gen.Int()),
    ))
    properties.TestingRun(t)
}
```

Differences from rapid:

- More verbose: separate `parameters`, `properties`, registration.
- Generators in `gopter/gen` rather than via combinators.
- Shrinking works but is less integrated.
- For new code, rapid is generally preferred. Use gopter when you
  inherit a project that already depends on it.

## 20. Generators with relationships between fields

When two fields depend on each other (e.g. a slice and a valid index, a
range `[lo, hi]`):

```go
type Range struct{ Lo, Hi int }

var genRange = rapid.Custom(func(t *rapid.T) Range {
    lo := rapid.IntRange(-100, 100).Draw(t, "lo")
    hi := rapid.IntRange(lo, 200).Draw(t, "hi")
    return Range{Lo: lo, Hi: hi}
})
```

Note we draw `hi` **after** `lo` and use `lo` as the lower bound. This
guarantees the invariant `lo <= hi` by construction. Filtering would also
work but waste draws.

## 21. Property: total ordering invariants

When testing a comparator `Less(a, b) bool`, check:

- **Irreflexivity**: `!Less(a, a)`.
- **Antisymmetry**: `Less(a, b) ⇒ !Less(b, a)`.
- **Transitivity**: `Less(a, b) && Less(b, c) ⇒ Less(a, c)`.

```go
rapid.Check(t, func(t *rapid.T) {
    a := genItem.Draw(t, "a")
    b := genItem.Draw(t, "b")
    c := genItem.Draw(t, "c")
    if Less(a, a) { t.Fatal("not irreflexive") }
    if Less(a, b) && Less(b, a) { t.Fatal("not antisymmetric") }
    if Less(a, b) && Less(b, c) && !Less(a, c) {
        t.Fatal("not transitive")
    }
})
```

Sort algorithms assume a total order; a broken `Less` will produce silent
incorrect output. PBT pins this assumption.

## 22. Generators for trees (recursive)

Generate a recursive type by combining a base case with a recursive case
weighted to terminate:

```go
type Tree struct {
    Value int
    Left  *Tree
    Right *Tree
}

var genTree = rapid.Custom(genTreeImpl)

func genTreeImpl(t *rapid.T) *Tree {
    if rapid.IntRange(0, 4).Draw(t, "leaf") == 0 {
        return nil
    }
    return &Tree{
        Value: rapid.Int().Draw(t, "v"),
        Left:  genTreeImpl(t),
        Right: genTreeImpl(t),
    }
}
```

The probability of returning `nil` (1/5) controls expected tree size. Too
low ⇒ trees blow up; too high ⇒ trees are tiny. Tune to your taste.

For more controlled depth, pass a `depth int` parameter and decrement.

## 23. Property: insertion preserves BST invariant

```go
func TestBSTInsertPreservesOrder(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        xs := rapid.SliceOf(rapid.Int()).Draw(t, "xs")
        var root *Node
        for _, v := range xs { root = bstInsert(root, v) }
        inorder := []int{}
        var walk func(*Node)
        walk = func(n *Node) {
            if n == nil { return }
            walk(n.Left)
            inorder = append(inorder, n.Value)
            walk(n.Right)
        }
        walk(root)
        for i := 1; i < len(inorder); i++ {
            if inorder[i-1] > inorder[i] {
                t.Fatalf("BST in-order not sorted")
            }
        }
    })
}
```

## 24. When the property body needs setup

If the property depends on a fresh database, server, or temp directory,
do **expensive setup once** outside the property:

```go
func TestRepoSaveLoadRoundTrip(t *testing.T) {
    db := openInMemoryDB(t)
    repo := NewRepo(db)
    rapid.Check(t, func(t *rapid.T) {
        u := genUser.Draw(t, "u")
        if err := repo.Save(u); err != nil { t.Fatal(err) }
        got, err := repo.Load(u.ID)
        if err != nil { t.Fatal(err) }
        if !reflect.DeepEqual(u, got) {
            t.Fatalf("mismatch")
        }
    })
}
```

If state leaks between iterations, use `t.Cleanup` inside the property
body to reset.

## 25. Avoiding flaky properties

Common causes of flakes:

- Wall clock dependency: don't use `time.Now()` inside the property.
- Map iteration order leaking into output.
- Concurrent goroutines without sync.
- `math/rand` without an explicit seed.
- Network or file IO without isolation.

If you find a flake, pin the seed (`-rapid.seed=N`) and debug. Until the
property is deterministic, it adds noise rather than confidence.

## 26. Property: HTTP handler responds correctly

For a handler that returns the input JSON unchanged after some processing:

```go
func TestEchoHandler(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        msg := genMessage.Draw(t, "msg")
        body, _ := json.Marshal(msg)
        req := httptest.NewRequest("POST", "/echo", bytes.NewReader(body))
        w := httptest.NewRecorder()
        echoHandler(w, req)
        if w.Code != 200 {
            t.Fatalf("status %d", w.Code)
        }
        var got Message
        if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
            t.Fatal(err)
        }
        if !reflect.DeepEqual(msg, got) {
            t.Fatalf("response mismatch")
        }
    })
}
```

## 27. Property for a state machine (lightweight)

For a simple FSM, you can run random transitions and assert invariants
without full `rapid.StateMachine`:

```go
rapid.Check(t, func(t *rapid.T) {
    events := rapid.SliceOf(rapid.SampledFrom([]string{
        "login", "logout", "click", "purchase",
    })).Draw(t, "events")
    sm := NewSessionFSM()
    for _, e := range events {
        sm.Apply(e)
        if sm.LoggedIn() && !sm.HasUser() {
            t.Fatalf("logged in without user")
        }
    }
})
```

For richer scenarios with concurrent commands and shrinking of the action
sequence, the senior page covers `rapid.StateMachine`.

## 28. Two properties is the minimum

A single property rarely specifies a function. For nearly every function
you should write at least two:

- A **positive** property (what the output is).
- A **negative** property (what the output is not, or invariants
  preserved).

Example for `Dedup(xs []int) []int`:

- Positive: output is in the same order as first occurrences in input.
- Negative: output has no duplicates.

Together they pin the contract; either alone permits broken
implementations.

## 29. Property: idempotent in time

Some operations are idempotent **only** if applied in the same context.
`Truncate` for floats, `RoundToEvenHour` for time:

```go
rapid.Check(t, func(t *rapid.T) {
    tm := genTime.Draw(t, "tm")
    once := RoundToEvenHour(tm)
    twice := RoundToEvenHour(once)
    if !once.Equal(twice) {
        t.Fatalf("not idempotent: %v -> %v -> %v", tm, once, twice)
    }
})
```

Use `.Equal` for time, not `==`.

## 30. Generators that depend on previous draws

`rapid` makes generators *imperative* — they execute Go code and may use
values from earlier `Draw` calls. This is powerful for invariant-heavy
generators.

```go
type GraphInput struct {
    NumNodes int
    Edges    [][2]int
}

var genGraph = rapid.Custom(func(t *rapid.T) GraphInput {
    n := rapid.IntRange(1, 20).Draw(t, "n")
    m := rapid.IntRange(0, n*(n-1)/2).Draw(t, "m")
    edges := make([][2]int, m)
    for i := range edges {
        a := rapid.IntRange(0, n-1).Draw(t, "a")
        b := rapid.IntRange(0, n-1).Draw(t, "b")
        edges[i] = [2]int{a, b}
    }
    return GraphInput{NumNodes: n, Edges: edges}
})
```

Every edge endpoint is guaranteed to be a valid node id. No filtering,
no rejection sampling.

## 31. Property: graph algorithm matches reference

```go
func TestDijkstraMatchesBFSForUnitWeights(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        g := genGraph.Draw(t, "g")
        src := rapid.IntRange(0, g.NumNodes-1).Draw(t, "src")
        bfsDist := bfs(g, src)
        dijDist := dijkstra(g, src, unitWeights(g))
        for i, d := range bfsDist {
            if dijDist[i] != d {
                t.Fatalf("disagree at node %d: bfs=%d dij=%d",
                    i, d, dijDist[i])
            }
        }
    })
}
```

BFS on unit-weight graphs is a known correct reference for Dijkstra; PBT
lets you generate many topologies cheaply.

## 32. Property: set operations

For a set type with `Union`, `Intersect`, `Diff`:

```go
rapid.Check(t, func(t *rapid.T) {
    a := genSet.Draw(t, "a")
    b := genSet.Draw(t, "b")

    // Commutative
    if !a.Union(b).Equal(b.Union(a)) {
        t.Fatal("Union not commutative")
    }
    if !a.Intersect(b).Equal(b.Intersect(a)) {
        t.Fatal("Intersect not commutative")
    }

    // De Morgan
    universe := a.Union(b)
    lhs := universe.Diff(a.Union(b))
    rhs := universe.Diff(a).Intersect(universe.Diff(b))
    if !lhs.Equal(rhs) {
        t.Fatal("De Morgan failed")
    }
})
```

A handful of property lines validate years of textbook algebra.

## 33. Property: cache layer matches direct DB

If you have a caching layer in front of a database, the property is:
"any read after any write returns the value that the database would
return."

```go
rapid.Check(t, func(t *rapid.T) {
    ops := genOps.Draw(t, "ops") // sequence of Get/Set/Del
    db := newFakeDB()
    cache := NewCache(db)
    for _, op := range ops {
        switch op.kind {
        case "set":
            cache.Set(op.key, op.value)
        case "get":
            got := cache.Get(op.key)
            want := db.Get(op.key)
            if got != want {
                t.Fatalf("divergence at op %v: got %v want %v",
                    op, got, want)
            }
        }
    }
})
```

This is a precursor to model-based testing (covered at the senior level
with `rapid.StateMachine`). The pattern: model = trusted reference,
system = unit under test, assert equivalence after each operation.

## 34. JSON: handling `omitempty`

If your struct uses `omitempty`, the round-trip property can fail
spuriously:

```go
type User struct {
    Name string `json:"name,omitempty"`
    Age  int    `json:"age,omitempty"`
}
// Marshal({Name:"", Age:0}) => "{}" => Unmarshal => {Name:"", Age:0} OK
// Marshal({Name:"", Age:5}) => "{\"age\":5}" => Unmarshal => {Name:"", Age:5} OK
```

`omitempty` is mostly transparent for the round-trip, but watch for:

- `time.Time{}` is **not** considered empty by encoding/json; if you have
  `time.Time` fields they survive.
- `[]string{}` vs `nil` round-trips differ: nil marshals as `null`, empty
  slice marshals as `[]`. Decide which is canonical in your generator.

```go
var genUser = rapid.Custom(func(t *rapid.T) User {
    return User{
        Name: rapid.String().Draw(t, "Name"),
        // Either always nil or always non-nil for round-trip stability:
        Tags: rapid.SliceOfN(rapid.String(), 0, 10).Draw(t, "Tags"),
    }
})
```

## 35. Decimal arithmetic

Floats are non-associative. If you switch to a `decimal.Decimal` library
to fix this, PBT confirms:

```go
import "github.com/shopspring/decimal"

rapid.Check(t, func(t *rapid.T) {
    a := genDecimal.Draw(t, "a")
    b := genDecimal.Draw(t, "b")
    c := genDecimal.Draw(t, "c")
    lhs := a.Add(b).Add(c)
    rhs := a.Add(b.Add(c))
    if !lhs.Equal(rhs) {
        t.Fatalf("decimal addition not associative: %s %s %s", a, b, c)
    }
})
```

This kind of property is hard to write with example-based tests because
the failing input is hard to find by hand.

## 36. Properties that involve side effects

If the unit under test has side effects (writes to a logger, increments
a counter), make those observable and assert them:

```go
rapid.Check(t, func(t *rapid.T) {
    msgs := rapid.SliceOf(rapid.String()).Draw(t, "msgs")
    sink := &bytes.Buffer{}
    logger := NewLogger(sink)
    for _, m := range msgs {
        logger.Info(m)
    }
    out := sink.String()
    for _, m := range msgs {
        if !strings.Contains(out, m) {
            t.Fatalf("message %q not in log output", m)
        }
    }
})
```

Side-effect properties are weaker than pure-function properties but still
useful.

## 37. Generators for unicode

UTF-8 is full of surprises. `rapid.String()` produces all valid UTF-8
including combining marks, surrogates, RTL characters, and zero-width
characters. Most string-handling code is wrong on at least one of these.

```go
rapid.Check(t, func(t *rapid.T) {
    s := rapid.String().Draw(t, "s")
    if utf8.RuneCountInString(s) > len(s) {
        t.Fatalf("rune count exceeds byte count")
    }
})
```

To restrict to ASCII for simpler cases:

```go
var genASCII = rapid.StringOf(rapid.RuneFrom([]rune("abcdefghijklmnopqrstuvwxyz0123456789")))
```

## 38. Custom equality

For types with internal state that should not affect equality (e.g.
unexported caches), provide an explicit comparator:

```go
type Set struct {
    items map[int]struct{}
}

func (a *Set) Equal(b *Set) bool {
    if len(a.items) != len(b.items) { return false }
    for k := range a.items {
        if _, ok := b.items[k]; !ok { return false }
    }
    return true
}
```

Then use `Equal` rather than `reflect.DeepEqual` in your properties.

## 39. Property: parsing rejects invalid input

For a parser, you should test both:

- Valid input parses without error.
- Invalid input returns an error (and does not panic).

```go
rapid.Check(t, func(t *rapid.T) {
    s := genValidProgram.Draw(t, "s")
    if _, err := Parse(s); err != nil {
        t.Fatalf("Parse(%q) failed: %v", s, err)
    }
})

rapid.Check(t, func(t *rapid.T) {
    s := genInvalidProgram.Draw(t, "s") // garbage
    func() {
        defer func() {
            if r := recover(); r != nil {
                t.Fatalf("Parse panicked on %q: %v", s, r)
            }
        }()
        _, _ = Parse(s)
    }()
})
```

The "does not panic" property is your friend on hostile input.

## 40. Property: API authentication

For an auth middleware:

```go
rapid.Check(t, func(t *rapid.T) {
    user := genUser.Draw(t, "user")
    token := SignToken(user, secret)
    parsed, err := ParseToken(token, secret)
    if err != nil { t.Fatalf("valid token rejected: %v", err) }
    if parsed.ID != user.ID { t.Fatal("ID mismatch") }
})

rapid.Check(t, func(t *rapid.T) {
    token := rapid.String().Draw(t, "token")
    if _, err := ParseToken(token, secret); err == nil {
        // most random strings should NOT parse as valid tokens
        t.Logf("random string parsed as token: %q", token)
    }
})
```

The second is an "always fail" property — most random strings should not
look like signed JWTs.

## 41. Property: encoder is canonical

A canonical encoder produces a unique byte string for each value.
Round-trip catches mismatch, but for protocol implementations you also
want **byte equality**:

```go
rapid.Check(t, func(t *rapid.T) {
    v := genValue.Draw(t, "v")
    a, _ := canonicalEncode(v)
    b, _ := canonicalEncode(v)
    if !bytes.Equal(a, b) {
        t.Fatal("encoder not deterministic")
    }
})
```

## 42. Tips for debugging a flaky property

1. Run with `-rapid.seed=N -rapid.checks=1` to replay exactly.
2. Add `t.Logf("input: %+v", input)` to confirm the same input is being
   used.
3. If the failure is intermittent **with the same seed**, your unit
   under test is non-deterministic (clock, map order, goroutines).
4. Strip side effects (replace `time.Now()` with an injected clock,
   sort map keys, serialise goroutines for testing).
5. Once deterministic, return to PBT.

## 43. Library comparison cheat sheet

| Feature                | testing/quick | rapid | gopter |
|------------------------|---------------|-------|--------|
| In stdlib              | yes           | no    | no     |
| Shrinking              | no            | yes   | yes    |
| Generics               | n/a           | yes   | no     |
| State machines         | no            | yes   | yes    |
| Generator combinators  | minimal       | rich  | rich   |
| Reproducible seeds     | partial       | yes   | yes    |
| Modern community use   | low           | high  | medium |

For new code, pick rapid. For existing gopter codebases, keep gopter
unless you migrate.

## 44. Mini-exercise: a date-range library

You maintain a `DateRange{Start, End time.Time}` type with `Contains`,
`Overlaps`, `Merge`. Properties:

- `Contains(t)` for `t == Start` and `t == End`.
- `Overlaps` is commutative.
- `Merge(a, b)` returns the smallest range containing both.
- For overlapping ranges, `Merge(a, b).Contains` is true for every point
  in `a` or `b`.

Try writing these properties. The generator must produce `Start <= End`
by construction.

## 45. Property: rate limiter

A token-bucket rate limiter with capacity `C` and refill rate `R`:

```go
rapid.Check(t, func(t *rapid.T) {
    rl := NewRateLimiter(10, 1.0) // 10 tokens, 1 per second
    requests := rapid.IntRange(0, 50).Draw(t, "n")
    allowed := 0
    for i := 0; i < requests; i++ {
        if rl.Allow() {
            allowed++
        }
    }
    if allowed > 10 {
        t.Fatalf("allowed %d requests, capacity is 10", allowed)
    }
})
```

A stronger property uses an injected clock to test refill behaviour:

```go
rapid.Check(t, func(t *rapid.T) {
    clk := &fakeClock{t: time.Now()}
    rl := NewRateLimiterWithClock(10, 1.0, clk)
    // ... advance clock, observe allowed pattern ...
})
```

## 46. Generators for protocol messages

If you generate Protobuf or Thrift messages, build a `rapid.Custom`
generator per message type. Use `rapid.OneOf` for `oneof` fields:

```go
var genCommand = rapid.OneOf(
    rapid.Map(genCreateCmd, func(c *pb.CreateCmd) *pb.Command {
        return &pb.Command{Kind: &pb.Command_Create{Create: c}}
    }),
    rapid.Map(genDeleteCmd, func(c *pb.DeleteCmd) *pb.Command {
        return &pb.Command{Kind: &pb.Command_Delete{Delete: c}}
    }),
)
```

This is essential for fuzzing wire formats and verifying round-trip on
both sides of an RPC.

## 47. Combining `Map` and `Custom`

For a value `Range{Lo, Hi}` you can either build it imperatively with
`Custom` (drawing two values), or with `Map` on a pair:

```go
// With Custom (sequential draws can refer to each other)
var genRange1 = rapid.Custom(func(t *rapid.T) Range {
    lo := rapid.IntRange(-100, 100).Draw(t, "lo")
    hi := rapid.IntRange(lo, 200).Draw(t, "hi")
    return Range{Lo: lo, Hi: hi}
})

// With Map (cannot enforce the constraint without filter)
var genRange2 = rapid.Map(
    rapid.Custom(func(t *rapid.T) [2]int {
        return [2]int{
            rapid.IntRange(-100, 100).Draw(t, "a"),
            rapid.IntRange(-100, 200).Draw(t, "b"),
        }
    }),
    func(p [2]int) Range {
        if p[0] > p[1] { p[0], p[1] = p[1], p[0] }
        return Range{Lo: p[0], Hi: p[1]}
    },
)
```

Prefer `Custom` when later fields depend on earlier ones. Prefer `Map`
for stateless projections.

## 48. Property: parsers handle whitespace

Whitespace insensitivity is a common parser property:

```go
rapid.Check(t, func(t *rapid.T) {
    src := genProgram.Draw(t, "src")
    extra := genWhitespace.Draw(t, "extra")
    a, err1 := Parse(src)
    b, err2 := Parse(extra + src + extra)
    if (err1 == nil) != (err2 == nil) {
        t.Fatal("whitespace changed error status")
    }
    if err1 == nil && !reflect.DeepEqual(a, b) {
        t.Fatalf("whitespace changed AST")
    }
})
```

## 49. Property: case-insensitive parser

```go
rapid.Check(t, func(t *rapid.T) {
    src := genProgram.Draw(t, "src")
    upper := strings.ToUpper(src)
    a, err1 := Parse(src)
    b, err2 := Parse(upper)
    if err1 == nil && err2 == nil && !reflect.DeepEqual(a, b) {
        t.Fatal("case sensitivity leaked")
    }
})
```

(Skip this property if your language is case-sensitive — `strings.ToUpper`
would change identifier names.)

## 50. Generators that share state across draws

Sometimes you need to ensure that two `Draw` calls produce *related*
values. The trick is to draw a base value, then derive the second:

```go
type Pair struct{ X, Y int }

var genPairCloseTogether = rapid.Custom(func(t *rapid.T) Pair {
    x := rapid.Int().Draw(t, "x")
    delta := rapid.IntRange(-10, 10).Draw(t, "delta")
    return Pair{X: x, Y: x + delta}
})
```

This is useful when testing functions that are sensitive to the magnitude
of difference between inputs — e.g. floating-point comparisons.

## 51. Property: streaming codec preserves chunk boundaries

For a codec that processes data in chunks (gzip, base64, JSON arrays):

```go
rapid.Check(t, func(t *rapid.T) {
    full := rapid.SliceOf(rapid.Byte()).Draw(t, "full")
    splits := rapid.SliceOfN(
        rapid.IntRange(1, len(full)+1),
        0, 10,
    ).Draw(t, "splits")
    sort.Ints(splits)

    var encStreaming bytes.Buffer
    w := newStreamingEncoder(&encStreaming)
    last := 0
    for _, s := range splits {
        if s > len(full) { s = len(full) }
        w.Write(full[last:s])
        last = s
    }
    w.Write(full[last:])
    w.Close()

    encWhole := encodeWhole(full)

    if !bytes.Equal(encStreaming.Bytes(), encWhole) {
        t.Fatal("streaming and whole-buffer encoders disagree")
    }
})
```

This catches chunk-boundary bugs in streaming implementations.

## 52. Working with `t.Helper`

If you factor out a helper that calls `t.Fatal`, mark it with `t.Helper`
so the line number in the failure report points to the caller:

```go
func assertSorted(t *testing.T, xs []int) {
    t.Helper()
    for i := 1; i < len(xs); i++ {
        if xs[i-1] > xs[i] {
            t.Fatalf("not sorted at index %d: %v", i, xs)
        }
    }
}
```

Use `*rapid.T` the same way — it embeds `*testing.T`.

## 53. Property: regex engine round-trip

If you implement a small regex engine, a useful property is "literal
substrings of length 1 always match in their own positions":

```go
rapid.Check(t, func(t *rapid.T) {
    s := rapid.StringMatching(`[a-z]{1,20}`).Draw(t, "s")
    if len(s) == 0 { return }
    i := rapid.IntRange(0, len(s)-1).Draw(t, "i")
    re := MustCompile(string(s[i]))
    if !re.MatchString(s) {
        t.Fatalf("regex %q should match %q", string(s[i]), s)
    }
})
```

More elaborate: pick a substring and assert the regex with that exact
substring matches the original.

## 54. Recap

- Build domain-type generators with `rapid.Custom`, `rapid.Map`,
  `rapid.OneOf`, `rapid.SampledFrom`.
- Round-trip every codec you own: JSON, gob, protobuf, base64, URL.
- Replace example tests with monotonicity and algebraic laws where the
  function is mathematical.
- Bias generators toward edge cases — uniform random misses them.
- For sum types and recursive types, build the structure explicitly.
- For interrelated fields, draw later fields conditional on earlier ones.

Continue to **senior** for stateful PBT with `rapid.StateMachine`,
shrinking strategy, custom integrations with fuzz, and gopter's command
API.
