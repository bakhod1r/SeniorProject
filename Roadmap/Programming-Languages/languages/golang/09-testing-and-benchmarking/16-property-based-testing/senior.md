---
layout: default
title: Property-Based Testing — Senior
parent: Property-Based Testing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/16-property-based-testing/senior/
---

# Property-Based Testing — Senior

[← Back](../)

At the senior level you treat PBT as a design tool, not just a test
technique. Properties become the executable form of the spec; the test
suite documents what the function promises. This page covers:

- Stateful (model-based) testing with `rapid.StateMachine`.
- Shrinking strategy and how to make shrinkers produce useful
  counter-examples.
- Combining PBT with native fuzzing for byte-level inputs.
- `leanovate/gopter` commands API for stateful PBT.
- Property design patterns from industry experience.
- Where PBT does **not** help, and why.

## 1. Why stateful PBT?

A pure-function property looks like:

> For any input `xs`, `f(xs)` satisfies P(xs, f(xs)).

A stateful system has hidden state that evolves. Testing it requires
generating a **sequence of operations** and asserting that after each
operation the system matches a **model** — a simpler, obviously-correct
reference.

This is also called **model-based testing** or **command testing**. The
classic motivation: you cannot define `f(xs)` for a database, but you
can define what a `Map[string,string]` model looks like and assert your
database matches it after every command.

## 2. `rapid.StateMachine` API

`rapid` exposes stateful PBT through a struct with methods:

```go
type CacheModel struct {
    cap   int
    sys   *MyCache              // unit under test
    model map[string]string     // simple reference
    order []string              // helps model evictions
}

// Init is called once at the start of each test.
func (m *CacheModel) Init(t *rapid.T) {
    m.cap = rapid.IntRange(1, 10).Draw(t, "cap")
    m.sys = NewMyCache(m.cap)
    m.model = map[string]string{}
    m.order = nil
}

// Actions are methods with the signature `func(t *rapid.T)`. They
// represent operations that can be performed against the system.
func (m *CacheModel) Set(t *rapid.T) {
    k := rapid.SampledFrom([]string{"a", "b", "c", "d"}).Draw(t, "k")
    v := rapid.String().Draw(t, "v")
    m.sys.Set(k, v)
    // update model
    if _, ok := m.model[k]; !ok {
        if len(m.order) == m.cap {
            evict := m.order[0]
            m.order = m.order[1:]
            delete(m.model, evict)
        }
        m.order = append(m.order, k)
    }
    m.model[k] = v
}

func (m *CacheModel) Get(t *rapid.T) {
    k := rapid.SampledFrom([]string{"a", "b", "c", "d"}).Draw(t, "k")
    got, ok := m.sys.Get(k)
    want, wantOK := m.model[k]
    if ok != wantOK {
        t.Fatalf("Get(%q): ok=%v want=%v", k, ok, wantOK)
    }
    if ok && got != want {
        t.Fatalf("Get(%q): got %q want %q", k, got, want)
    }
}

// Check is called between actions and at the end. Use it for invariants.
func (m *CacheModel) Check(t *rapid.T) {
    if m.sys.Len() > m.cap {
        t.Fatalf("size %d exceeds cap %d", m.sys.Len(), m.cap)
    }
}

// Run with:
func TestCacheStateful(t *testing.T) {
    rapid.Check(t, rapid.StateMachine[*CacheModel])
}
```

Note: depending on the `rapid` version, the exact invocation may be
`rapid.Run[*CacheModel]()(t)` or the embedded helper above. Always check
the current docs.

## 3. What `StateMachine` does internally

1. Calls `Init`.
2. Picks one of your action methods at random.
3. Calls it.
4. Calls `Check`.
5. Repeats `-rapid.steps` times (default 100).
6. On failure, shrinks the **sequence of actions** and the parameters
   inside each action.

The shrinker is the killer feature: a sequence of 87 random ops gets
reduced to "Set x then Set x then Get x" — exactly the minimal pattern
that triggers the bug.

## 4. Designing the model

The model is a simple, obviously-correct implementation. For:

- An LRU cache: a `map` plus an ordered list.
- A queue: a `[]T`.
- A counter: an `int`.
- A SQL table: a `map[primary-key]row`.

The model should be **much simpler** than the system. If the model is as
complex as the system, you have not gained any oracle.

## 5. Limiting state space

Random keys and values blow up the state space. Constrain:

- Use a small key alphabet (`SampledFrom([]string{"a","b","c","d"})`).
- Use small value sizes.
- Bound the number of steps.

A useful heuristic: small enough that any two operations have a high
chance of touching the same key. Otherwise the cache eviction logic
(or any state-dependent behaviour) never fires.

## 6. Pre-conditions on actions

Sometimes an action only makes sense if state is in a certain shape.
Inside the action, you can return early:

```go
func (m *CacheModel) Delete(t *rapid.T) {
    if len(m.model) == 0 {
        return // skip: nothing to delete
    }
    k := rapid.SampledFrom(keysOf(m.model)).Draw(t, "k")
    m.sys.Delete(k)
    delete(m.model, k)
}
```

Skipping leaves the random choice unused but is safer than panicking on
empty state.

## 7. Property: round-trip after random transformations

A higher-order property: any sequence of `Add` and `Remove` returns the
set to a state equivalent to the multiset of net adds.

```go
rapid.Check(t, func(t *rapid.T) {
    type op struct{ kind, key string }
    ops := rapid.SliceOf(rapid.Custom(func(t *rapid.T) op {
        return op{
            kind: rapid.SampledFrom([]string{"add", "remove"}).Draw(t, "kind"),
            key:  rapid.SampledFrom([]string{"a","b","c"}).Draw(t, "key"),
        }
    })).Draw(t, "ops")

    s := NewSet()
    counts := map[string]int{}
    for _, o := range ops {
        if o.kind == "add" {
            s.Add(o.key); counts[o.key]++
        } else if counts[o.key] > 0 {
            s.Remove(o.key); counts[o.key]--
        }
    }
    for k, c := range counts {
        if c > 0 != s.Has(k) {
            t.Fatalf("key %q: counts=%d Has=%v", k, c, s.Has(k))
        }
    }
})
```

## 8. Shrinking in depth

When a property fails on `[]int{4, -7, 2, 0, 99}`, rapid does not try
to remove arbitrary elements. Instead, it replays the property with
progressively shorter byte streams driving generation, and progressively
"smaller" choices within each draw.

Practical implications:

- Generators that always draw a fixed number of values shrink poorly.
  Prefer `SliceOf` over manually drawing N times.
- `Filter` interrupts shrinking — the shrinker may skip past valid
  reductions. Prefer `Custom` or `Map`.
- Custom generators that allocate or short-circuit can confuse the
  shrinker. Keep them pure.

If a shrunk counter-example is still confusingly large, your generator
is generating "atomic" units (e.g. a 100-rune string is treated as one
unit). Split it into smaller draws.

## 9. The "size" parameter

Some generators have implicit size bounds (slice length, string length).
For shrinking quality:

- Use `rapid.SliceOf(g)` for unbounded slices; rapid will choose a
  reasonable length and shrink it.
- Use `rapid.SliceOfN(g, lo, hi)` when you have hard bounds.
- Avoid generating "huge" inputs unless your test specifically needs
  them; large inputs shrink slowly.

## 10. Combining PBT with `go test -fuzz`

Native fuzz operates on `[]byte`. A clean integration is to interpret
the bytes as a deterministic input to your property:

```go
func FuzzMyParser(f *testing.F) {
    f.Add([]byte("seed input"))
    f.Fuzz(func(t *testing.T, data []byte) {
        ast, err := Parse(data)
        if err != nil { return } // parser errors are expected
        // Property: the parsed AST round-trips.
        printed := Print(ast)
        again, err := Parse([]byte(printed))
        if err != nil { t.Fatalf("re-parse failed: %v", err) }
        if !reflect.DeepEqual(ast, again) {
            t.Fatalf("round-trip mismatch")
        }
    })
}
```

This is **fuzz feeding a property**. The fuzzer mutates raw bytes to
find inputs your parser accepts; the property asserts a meaningful
invariant about those inputs.

The same applies to state machines: feed the fuzzer a sequence of bytes,
decode them as commands, and run them as a state-machine test. This
gives you libFuzzer's coverage-guided mutation **on top of** PBT's
structured invariants.

## 11. Shrinking action sequences

`rapid.StateMachine` shrinks not just individual parameter values but
also:

- The **length** of the action sequence.
- The **choice** of action at each position.

So a failing sequence of [Set, Get, Set, Delete, Get, ..., Set] may
shrink to [Set, Get]. The minimal counter-example often reveals the
exact pattern of operations needed to expose the bug.

This is enormously valuable. A flat fuzz that just panics tells you
"some sequence of these bytes crashes me" — useful, but not
illuminating. A shrunken state-machine failure tells you "Set followed
by Get on the same key fails" — actionable.

## 12. `leanovate/gopter` commands API

If you work in a codebase using gopter, the equivalent of
`rapid.StateMachine` is `commands.Commands`:

```go
import (
    "github.com/leanovate/gopter"
    "github.com/leanovate/gopter/commands"
    "github.com/leanovate/gopter/gen"
)

var counterCommands = &commands.ProtoCommands{
    NewSystemUnderTestFunc: func(initialState commands.State) commands.SystemUnderTest {
        return NewCounter()
    },
    InitialStateGen: gen.Const(0),
    GenCommandFunc: func(state commands.State) gopter.Gen {
        return gen.OneGenOf(
            gen.Const(IncCommand),
            gen.Const(DecCommand),
        )
    },
}
```

It is more verbose than `rapid.StateMachine`. The mental model is
identical: a model state, a system under test, randomly chosen
commands, post-condition assertions.

## 13. Design pattern: read-after-write

A wide-applicability property:

> Any read of key K after the most recent write to K returns the value
> from that write (until the next write or delete).

Encodes the basic guarantee of caches, KV stores, file systems.

```go
type ReadAfterWriteModel struct {
    last map[string]string
    sys  *Store
}
```

After every `Write(k, v)`: `last[k] = v`. After every `Delete(k)`:
`delete(last, k)`. After every `Read(k)`: assert system value equals
`last[k]` (or empty if absent).

## 14. Design pattern: idempotent operations under concurrency

If `Apply(op)` is supposed to be idempotent, run the same op twice and
assert state equality:

```go
rapid.Check(t, func(t *rapid.T) {
    op := genOp.Draw(t, "op")
    a := newState()
    a.Apply(op)
    snapshot := a.Snapshot()
    a.Apply(op)
    if !reflect.DeepEqual(snapshot, a.Snapshot()) {
        t.Fatal("operation not idempotent")
    }
})
```

This is a key property of webhook handlers, distributed transactions,
and eventual-consistency layers.

## 15. Design pattern: consistency at every step

A state machine with invariants `Inv(state)`:

```go
func (m *Model) Check(t *rapid.T) {
    if !Inv(m.sys.State()) {
        t.Fatalf("invariant violated: %+v", m.sys.State())
    }
}
```

This is checked between every action. Counter-examples become "minimum
sequence of actions to break the invariant".

## 16. Mutation testing as a PBT companion

Mutation testing tools (`gremlins`, `go-mutesting`) inject small bugs
into your code and verify that the test suite fails. A property that
fails mutations is robust; one that passes mutations is suspect.

PBT and mutation testing are complementary:

- PBT generates random inputs against fixed code.
- Mutation testing generates random code bugs against fixed inputs.

Run both. A property suite that passes mutations is signalling weakness:
either the properties are trivial, the generators are too narrow, or
the assertions are too loose.

## 17. Property: dataflow correctness

For a pipeline `f(g(h(x)))`:

```go
rapid.Check(t, func(t *rapid.T) {
    x := genInput.Draw(t, "x")
    pipeline := f(g(h(x)))
    intermediates := struct{ h, gh, fgh Result }{
        h:   h(x),
        gh:  g(h(x)),
        fgh: f(g(h(x))),
    }
    if !reflect.DeepEqual(pipeline, intermediates.fgh) {
        t.Fatal("pipeline result diverged from step-by-step")
    }
})
```

Tests that the pipeline is associative-by-composition — useful when
optimising stream-processing code.

## 18. When PBT does not help

PBT shines for **structured invariants**. It is much weaker for:

- **Visual layout / UI rendering** — no formal property.
- **Cryptographic correctness** — properties are obvious (encrypt then
  decrypt) but the bug surface is subtle; you need formal review and
  test vectors, not PBT alone.
- **Performance** — PBT can run benchmarks but the statistical model is
  different; use `testing.B` and `benchstat`.
- **Security properties under adversarial input** — better tested with
  fuzz and code review.

Knowing when **not** to reach for PBT is a senior skill.

## 19. Property: parser is total over allowed alphabet

A "total" property: for any input in the alphabet, `Parse` returns a
result (possibly an error) without panicking.

```go
rapid.Check(t, func(t *rapid.T) {
    s := rapid.StringOf(rapid.RuneFrom(allowedRunes)).Draw(t, "s")
    func() {
        defer func() {
            if r := recover(); r != nil {
                t.Fatalf("Parse panicked: %v", r)
            }
        }()
        _, _ = Parse(s)
    }()
})
```

This is a "no panic" property — weak but invaluable.

## 20. Property: error path produces useful errors

Beyond "no panic", check that errors are well-formed:

```go
rapid.Check(t, func(t *rapid.T) {
    s := genGarbage.Draw(t, "s")
    _, err := Parse(s)
    if err == nil { return }
    if err.Error() == "" {
        t.Fatal("error has empty message")
    }
    var pe *ParseError
    if !errors.As(err, &pe) {
        t.Fatalf("error is not a *ParseError: %T", err)
    }
    if pe.Position < 0 || pe.Position > len(s) {
        t.Fatalf("error position %d out of range", pe.Position)
    }
})
```

User-facing error messages are part of the API.

## 21. Coverage instrumentation under PBT

`go test -cover -run=TestPropertyFoo` instruments the property run.
Watch which branches you hit. If a critical branch never fires, the
generator is wrong; widen it. PBT + coverage is a powerful pair for
finding dead code paths.

## 22. Concurrency-aware PBT

For concurrent code, you can run actions in parallel and check
**linearizability**: the observed history can be totalised into a
sequential one consistent with the model.

This is the territory of Jepsen and Knossos. `rapid.StateMachine` is
sequential by default; for true concurrency testing, generate threads
of actions and run a checker. Such testing is hard but invaluable for
KV stores and locks.

## 23. Long-running soak tests

A property loop run for hours catches rare combinations that 100-step
runs miss. Set up a nightly CI job:

```yaml
nightly-pbt:
  runs-on: ubuntu-latest
  steps:
    - run: go test -run=TestPropertyAll -rapid.checks=100000 -rapid.steps=500 -timeout=2h
```

Failures become PRs that add the failing seed to the regression file.
Soak tests are how `etcd`, `cockroachdb`, and `tidb` find their gnarliest
bugs.

## 24. Tracking property coverage

Beyond Go coverage, you can label what kinds of inputs your property
exercised:

```go
rapid.Check(t, func(t *rapid.T) {
    xs := rapid.SliceOf(rapid.Int()).Draw(t, "xs")
    rapid.Label(t, "empty", len(xs) == 0)
    rapid.Label(t, "singleton", len(xs) == 1)
    rapid.Label(t, "long", len(xs) > 50)
    // ...
})
```

With `-rapid.v`, the label histogram appears. If "empty" never fires you
have a generator gap; add `OneOf(Just([]int{}), ...)`.

## 25. Property: refactor preserves observable behaviour

A senior trick when refactoring a critical function:

```go
//go:build !refactor

func TestRefactorEquivalence(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        x := genInput.Draw(t, "x")
        oldRes := oldImpl(x)
        newRes := newImpl(x)
        if !reflect.DeepEqual(oldRes, newRes) {
            t.Fatalf("disagree on %+v", x)
        }
    })
}
```

Run this for the duration of the refactor. Delete `oldImpl` only after
PBT (and integration tests) are green.

## 26. Property: invariants across migrations

For a database migration that changes schema:

```go
rapid.Check(t, func(t *rapid.T) {
    rows := genRows.Draw(t, "rows")
    db1 := newDBOldSchema(rows)
    db2 := migrate(db1)
    // Property: every row visible in db1 is visible in db2.
    for _, r := range db1.All() {
        if !db2.Has(r.ID) {
            t.Fatalf("row %v missing after migration", r)
        }
    }
})
```

Migrations are a classic source of one-off bugs. PBT generates many
shapes of "before" state and pins the contract that "after" preserves
information.

## 27. Property: protocol replay

For an event-sourced system:

```go
rapid.Check(t, func(t *rapid.T) {
    events := genEventLog.Draw(t, "events")
    s := NewState()
    for _, e := range events { s.Apply(e) }
    snap := s.Snapshot()
    s2 := NewState()
    for _, e := range events { s2.Apply(e) }
    if !reflect.DeepEqual(snap, s2.Snapshot()) {
        t.Fatal("event replay non-deterministic")
    }
})
```

Determinism of replay is the cornerstone of event sourcing. PBT catches
non-determinism that integration tests miss.

## 28. Working at the limit: what makes a "good" PBT suite?

Indicators of a mature PBT setup:

- Every codec has a round-trip property.
- Every algorithmic data structure has a state-machine model.
- A nightly CI job runs each property for 10k+ iterations.
- Failed seeds are committed and replayed forever.
- Coverage of generators is measured (rapid labels) and reviewed.
- Refactors include "equivalence to old impl" PBT, deleted on merge.

A team that operates at this level catches bugs **before** they hit
production; the value of PBT is highest in this regime.

## 29. Common senior mistakes

- **Trivially-true assertions** — `len(out) >= 0`. Fix: review each
  property; mutation testing flags these.
- **Overly broad filters** — burn generation budget. Fix: build the
  value to satisfy the predicate.
- **Model that mirrors the system** — no oracle. Fix: make the model
  simpler than the system.
- **Properties that depend on system clock** — flaky. Fix: inject a
  clock interface.
- **Massive inputs that shrink slowly** — bound the generator.
- **Action sequences with no shared keys** — eviction logic never
  fires. Fix: small alphabet.

## 30. Where PBT meets formal methods

Properties are statements about all inputs. So are theorems. The
difference: PBT *tests* properties on random inputs; formal verification
*proves* them.

For ultra-critical code (consensus, encryption, kernel data structures)
teams use both: PBT for fast feedback during dev, TLA+/Coq for
mathematical certainty before deployment. PBT findings often inform
the model; the model in turn informs new properties.

## 31. Recap

- Stateful PBT with `rapid.StateMachine` tests systems with hidden
  state by comparing them against a simple model.
- The shrinker reduces failing action sequences to minimal patterns.
- Combine PBT with native fuzz to get coverage-guided generation plus
  structured invariants.
- Soak tests over thousands of iterations expose rare bugs.
- A mature PBT setup includes round-trip properties, state-machine
  models, failed-seed regression files, and generator coverage tracking.
- Know when to reach for examples, fuzz, or formal methods instead.

Continue to **professional** for CI integration, seed management, and
operational practice.

## 32. Worked stateful example: ring buffer

A bounded ring buffer with `Push`, `Pop`, and `Len`. The model is a
plain slice with explicit length tracking.

```go
type RingBufferModel struct {
    cap   int
    sys   *RingBuffer[int]
    model []int
}

func (m *RingBufferModel) Init(t *rapid.T) {
    m.cap = rapid.IntRange(1, 16).Draw(t, "cap")
    m.sys = NewRingBuffer[int](m.cap)
    m.model = nil
}

func (m *RingBufferModel) Push(t *rapid.T) {
    v := rapid.IntRange(0, 1000).Draw(t, "v")
    sysOK := m.sys.Push(v)
    modelOK := len(m.model) < m.cap
    if sysOK != modelOK {
        t.Fatalf("Push(%d): sysOK=%v modelOK=%v", v, sysOK, modelOK)
    }
    if modelOK {
        m.model = append(m.model, v)
    }
}

func (m *RingBufferModel) Pop(t *rapid.T) {
    got, sysOK := m.sys.Pop()
    if len(m.model) == 0 {
        if sysOK { t.Fatalf("Pop on empty returned ok") }
        return
    }
    want := m.model[0]
    m.model = m.model[1:]
    if !sysOK || got != want {
        t.Fatalf("Pop: got (%d, %v) want (%d, true)", got, sysOK, want)
    }
}

func (m *RingBufferModel) Check(t *rapid.T) {
    if m.sys.Len() != len(m.model) {
        t.Fatalf("Len mismatch: sys=%d model=%d", m.sys.Len(), len(m.model))
    }
}
```

Run with `rapid.Check(t, rapid.StateMachine[*RingBufferModel])`. The
shrunken counter-example from this property usually fits in 3-4 actions
and points exactly at the bug.

## 33. Worked stateful example: an in-memory transaction

Model a tiny KV store with explicit transactions.

```go
type TxnModel struct {
    sys     *KVStore
    model   map[string]string // committed
    pending map[string]string // staged
    inTxn   bool
}

func (m *TxnModel) Init(t *rapid.T) { /* ... */ }

func (m *TxnModel) Begin(t *rapid.T) {
    if m.inTxn { return }
    m.sys.Begin()
    m.pending = map[string]string{}
    m.inTxn = true
}

func (m *TxnModel) Set(t *rapid.T) {
    k := rapid.SampledFrom([]string{"a","b","c"}).Draw(t, "k")
    v := rapid.String().Draw(t, "v")
    m.sys.Set(k, v)
    if m.inTxn { m.pending[k] = v } else { m.model[k] = v }
}

func (m *TxnModel) Commit(t *rapid.T) {
    if !m.inTxn { return }
    m.sys.Commit()
    for k, v := range m.pending { m.model[k] = v }
    m.pending = nil
    m.inTxn = false
}

func (m *TxnModel) Rollback(t *rapid.T) {
    if !m.inTxn { return }
    m.sys.Rollback()
    m.pending = nil
    m.inTxn = false
}

func (m *TxnModel) Get(t *rapid.T) {
    k := rapid.SampledFrom([]string{"a","b","c"}).Draw(t, "k")
    var want string
    if m.inTxn {
        if v, ok := m.pending[k]; ok { want = v } else { want = m.model[k] }
    } else {
        want = m.model[k]
    }
    got := m.sys.Get(k)
    if got != want {
        t.Fatalf("Get(%q): got %q want %q (inTxn=%v)", k, got, want, m.inTxn)
    }
}
```

This property has caught real-world bugs in transaction isolation, dirty
reads, and incorrect rollback in production databases. The pattern is
universally applicable.

## 34. Property: linearisable history

A formal property for concurrent KV stores. Out of scope for everyday
use, but worth knowing about: the trace of concurrent operations must
correspond to *some* sequential history that is consistent with the
operations' real-time order. Libraries like `porcupine` (jepsen-go)
check this from a recorded trace.

## 35. Designing properties for a public API

When you publish a library, every property is also documentation. A
well-named property test communicates the contract better than prose
because it is executable.

Pattern: name the property after the law it encodes.

```go
func TestSet_AddTwiceIsAddOnce(t *testing.T) { ... }
func TestSet_UnionIsCommutative(t *testing.T) { ... }
func TestSet_UnionWithEmptyIsIdentity(t *testing.T) { ... }
func TestSet_DiffWithSelfIsEmpty(t *testing.T) { ... }
```

A new contributor reading these test names learns the API's algebraic
shape immediately.

## 36. Properties for streaming protocols

A streaming protocol receives input over time. The property is: for
any partitioning of the input stream, the protocol produces the same
output as if the entire input had been received at once.

```go
rapid.Check(t, func(t *rapid.T) {
    full := rapid.SliceOf(rapid.Byte()).Draw(t, "full")
    parts := splitAtRandomBoundaries(t, full)

    p1 := NewParser()
    for _, p := range parts {
        p1.Feed(p)
    }
    out1 := p1.Result()

    p2 := NewParser()
    p2.Feed(full)
    out2 := p2.Result()

    if !reflect.DeepEqual(out1, out2) {
        t.Fatalf("streaming != batch: parts=%v", parts)
    }
})
```

This catches buffer-boundary bugs that are virtually impossible to find
with example tests.

## 37. Property: pagination invariants

For a paginated API:

```go
rapid.Check(t, func(t *rapid.T) {
    items := genItems.Draw(t, "items")
    pageSize := rapid.IntRange(1, 20).Draw(t, "pageSize")
    api := NewAPI(items)

    var collected []Item
    cursor := ""
    for {
        page, next := api.List(cursor, pageSize)
        if len(page) > pageSize {
            t.Fatalf("page exceeded size: %d > %d", len(page), pageSize)
        }
        collected = append(collected, page...)
        if next == "" { break }
        cursor = next
    }

    if !sameMultiset(collected, items) {
        t.Fatal("pagination lost or duplicated items")
    }
})
```

Three invariants in one property: page size respected, no duplicates,
no missing items.

## 38. Property: ID generation

If your system generates IDs (UUIDs, snowflakes, etc.):

```go
rapid.Check(t, func(t *rapid.T) {
    n := rapid.IntRange(2, 1000).Draw(t, "n")
    seen := map[string]struct{}{}
    for i := 0; i < n; i++ {
        id := GenerateID()
        if _, ok := seen[id]; ok {
            t.Fatalf("duplicate id at %d: %q", i, id)
        }
        seen[id] = struct{}{}
    }
})
```

This is a probabilistic property — uniqueness is not strictly absolute
for random IDs but should be overwhelmingly likely. A test that catches
duplicates in a few hundred ids signals a real bug (e.g. seed reuse).

## 39. Property: cryptographic hash collisions are improbable

Not a strict property, but: collisions among 1000 random inputs should
be exceedingly rare for a strong hash.

```go
rapid.Check(t, func(t *rapid.T) {
    inputs := rapid.SliceOfN(rapid.String(), 100, 100).Draw(t, "inputs")
    seen := map[uint64]string{}
    for _, s := range inputs {
        h := SHA256Hash(s)
        h64 := binary.BigEndian.Uint64(h[:8])
        if prev, ok := seen[h64]; ok && prev != s {
            t.Fatalf("high collision rate suspicious: %q and %q", s, prev)
        }
        seen[h64] = s
    }
})
```

Useful as a sanity check on custom hash functions.

## 40. Generators for protocol fuzzing

Build a generator that produces a sequence of valid protocol commands
plus occasional malformed ones:

```go
var genCommand = rapid.OneOf(
    rapid.Map(genValidCmd, func(c ValidCmd) []byte {
        return c.Encode()
    }),
    rapid.SliceOf(rapid.Byte()), // garbage
)
```

Now feed sequences to your server. The valid ones exercise normal paths;
the garbage exercises error handling. This is a poor-man's protocol
fuzzer that costs ten lines.

## 41. Property: zero-value behaviour

Go's zero values are everywhere. Test that your type handles them:

```go
rapid.Check(t, func(t *rapid.T) {
    // Whatever input, ensure the type's zero value behaves sanely.
    var s Stack[int]
    if s.Len() != 0 {
        t.Fatal("zero Stack.Len() should be 0")
    }
    if _, ok := s.Pop(); ok {
        t.Fatal("zero Stack.Pop() should not succeed")
    }
})
```

This is example-based dressed as a property, but it tracks alongside the
PBT suite for completeness.

## 42. The "no surprising allocation" property

For low-allocation code paths, you can assert that allocations stay
within a budget:

```go
rapid.Check(t, func(t *rapid.T) {
    in := genWork.Draw(t, "in")
    var m1, m2 runtime.MemStats
    runtime.GC()
    runtime.ReadMemStats(&m1)
    _ = Process(in)
    runtime.ReadMemStats(&m2)
    allocated := m2.Mallocs - m1.Mallocs
    if allocated > 5 {
        t.Fatalf("Process(%v) allocated %d times, want <=5", in, allocated)
    }
})
```

This is borderline — `testing.AllocsPerRun` is more accurate. But PBT
gives you many input shapes; combine with `runtime.GC()` for clean
measurements.

## 43. Property: serialiser preserves canonical form

If your serialiser is supposed to be canonical (same value → same bytes):

```go
rapid.Check(t, func(t *rapid.T) {
    a := genUser.Draw(t, "a")
    b := genUser.Draw(t, "b")
    if reflect.DeepEqual(a, b) {
        if !bytes.Equal(canon(a), canon(b)) {
            t.Fatal("equal values → different bytes")
        }
    } else {
        if bytes.Equal(canon(a), canon(b)) {
            t.Fatal("different values → equal bytes (hash collision?)")
        }
    }
})
```

The second branch is again probabilistic (canonical forms can collide
in theory), but in practice such collisions are due to bugs.

## 44. Property: respect of explicit invariants

Code often documents an invariant in a comment. Turn it into a property:

```go
// Invariant: after construction, the list is sorted by Score.
```

becomes:

```go
rapid.Check(t, func(t *rapid.T) {
    inputs := genInputs.Draw(t, "inputs")
    l := Construct(inputs)
    for i := 1; i < len(l); i++ {
        if l[i-1].Score > l[i].Score {
            t.Fatal("invariant: sorted by Score")
        }
    }
})
```

Comments rot. Properties do not.

## 45. Generators for graphs that satisfy a constraint

For a DAG:

```go
var genDAG = rapid.Custom(func(t *rapid.T) Graph {
    n := rapid.IntRange(1, 20).Draw(t, "n")
    g := Graph{N: n}
    for i := 0; i < n; i++ {
        // Only allow edges to lower-numbered nodes — guarantees DAG.
        for j := 0; j < i; j++ {
            if rapid.Bool().Draw(t, "edge") {
                g.Edges = append(g.Edges, [2]int{i, j})
            }
        }
    }
    return g
})
```

Constructing inputs that satisfy structural constraints is preferable to
filtering.

## 46. Property: topological sort is consistent

```go
rapid.Check(t, func(t *rapid.T) {
    g := genDAG.Draw(t, "g")
    order := TopoSort(g)
    pos := map[int]int{}
    for i, v := range order { pos[v] = i }
    for _, e := range g.Edges {
        if pos[e[0]] >= pos[e[1]] {
            t.Fatalf("edge %v violates topo order", e)
        }
    }
})
```

The property formally captures what "topological order" means — for any
edge `(u, v)`, `u` appears before `v` in the output.

## 47. Property: cancellation semantics

For a function that accepts `context.Context`:

```go
rapid.Check(t, func(t *rapid.T) {
    work := genWork.Draw(t, "work")
    cancelAfter := rapid.IntRange(0, 100).Draw(t, "cancelAfter")
    ctx, cancel := context.WithCancel(context.Background())
    go func() {
        time.Sleep(time.Duration(cancelAfter) * time.Microsecond)
        cancel()
    }()
    _, err := DoWork(ctx, work)
    if err != nil && !errors.Is(err, context.Canceled) {
        t.Fatalf("expected nil or Canceled, got %v", err)
    }
})
```

Properties: either the work completes successfully, or it returns
`context.Canceled`. No other error is acceptable.

## 48. Property: HTTP status code consistency

For an API:

```go
rapid.Check(t, func(t *rapid.T) {
    body := genRequestBody.Draw(t, "body")
    w := httptest.NewRecorder()
    r := httptest.NewRequest("POST", "/api", bytes.NewReader(body))
    Handler(w, r)
    switch w.Code {
    case 200, 201:
        // ok
    case 400, 422:
        // body should explain
        if w.Body.Len() == 0 {
            t.Fatal("error status with empty body")
        }
    case 500:
        t.Fatalf("server error for input: %s", body)
    default:
        t.Fatalf("unexpected status %d", w.Code)
    }
})
```

The property: 500s should never occur on synthetic but well-formed
input.

## 49. Property: Markov chain reversibility

For a transformation `T` with inverse `Tinv`, applied many times:

```go
rapid.Check(t, func(t *rapid.T) {
    x := genState.Draw(t, "x")
    n := rapid.IntRange(0, 50).Draw(t, "n")
    y := x
    for i := 0; i < n; i++ { y = T(y) }
    for i := 0; i < n; i++ { y = Tinv(y) }
    if !reflect.DeepEqual(x, y) {
        t.Fatalf("T applied %d times is not invertible", n)
    }
})
```

Invertibility properties are crucial for codecs and reversible
computations.

## 50. Generators with depth budget

When generating recursive structures, budget depth to avoid blow-up:

```go
func genTreeDepth(depth int) *rapid.Generator[*Tree] {
    return rapid.Custom(func(t *rapid.T) *Tree {
        if depth == 0 || rapid.IntRange(0, 4).Draw(t, "leaf") == 0 {
            return &Tree{Value: rapid.Int().Draw(t, "v")}
        }
        return &Tree{
            Value: rapid.Int().Draw(t, "v"),
            Left:  genTreeDepth(depth - 1).Draw(t, "L"),
            Right: genTreeDepth(depth - 1).Draw(t, "R"),
        }
    })
}

var genTree = genTreeDepth(8)
```

Bounded depth keeps test time predictable.

## 51. Property: AVL rotations preserve in-order

Balanced trees (AVL, red-black) have invariants that hold across
rotations. The fundamental property of any rotation is that it preserves
the in-order traversal:

```go
rapid.Check(t, func(t *rapid.T) {
    tree := genBST.Draw(t, "tree")
    before := inorder(tree)
    after := inorder(rotateLeft(tree))
    if !reflect.DeepEqual(before, after) {
        t.Fatal("rotate changed in-order")
    }
})
```

Combine with a separate property for the balance factor.

## 52. Generators as documentation

A generator file is the most precise possible documentation of "valid
input shape". Reviewers should treat changes to a generator with the
same scrutiny as changes to a public type:

```go
// valid_email.go
var genValidEmail = rapid.Custom(func(t *rapid.T) string {
    local := rapid.StringMatching(`[a-z0-9._-]{1,32}`).Draw(t, "local")
    domain := rapid.StringMatching(`[a-z0-9-]{1,32}\.[a-z]{2,6}`).Draw(t, "domain")
    return local + "@" + domain
})
```

Every time you tighten or loosen the generator, you are amending the
spec.

## 53. Property: integration with structured logging

A property for code that emits structured logs:

```go
rapid.Check(t, func(t *rapid.T) {
    event := genEvent.Draw(t, "event")
    buf := &bytes.Buffer{}
    log := slog.New(slog.NewJSONHandler(buf, nil))
    Process(log, event)

    var record map[string]any
    if err := json.Unmarshal(buf.Bytes(), &record); err != nil {
        t.Fatalf("log line is not valid JSON: %v", err)
    }
    if _, ok := record["msg"]; !ok {
        t.Fatal("log record missing msg")
    }
    if _, ok := record["event_id"]; !ok {
        t.Fatal("log record missing event_id")
    }
})
```

Catches "log message has unprintable bytes" bugs and missing fields.

## 54. Property: invariants in concurrent counters

For a counter intended to be safe under concurrent use:

```go
rapid.Check(t, func(t *rapid.T) {
    nGoroutines := rapid.IntRange(2, 8).Draw(t, "g")
    nIncs := rapid.IntRange(100, 1000).Draw(t, "n")
    c := NewCounter()
    var wg sync.WaitGroup
    for i := 0; i < nGoroutines; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < nIncs; j++ {
                c.Inc()
            }
        }()
    }
    wg.Wait()
    if got, want := c.Value(), int64(nGoroutines*nIncs); got != want {
        t.Fatalf("counter got %d want %d", got, want)
    }
})
```

Run with `-race` to catch the kind of bugs the property cannot directly
detect (data races without a lost-update outcome).

## 55. Property: bounded queue under back-pressure

```go
rapid.Check(t, func(t *rapid.T) {
    cap := rapid.IntRange(1, 16).Draw(t, "cap")
    pattern := genProducerConsumerPattern.Draw(t, "p")
    q := NewBoundedQueue[int](cap)
    var produced, consumed int
    for _, step := range pattern {
        if step.Produce {
            if q.TryPush(step.Val) { produced++ }
        } else {
            if _, ok := q.TryPop(); ok { consumed++ }
        }
    }
    if q.Len() != produced - consumed {
        t.Fatalf("Len mismatch: produced-consumed=%d sys=%d",
            produced-consumed, q.Len())
    }
    if q.Len() > cap {
        t.Fatal("Len exceeded cap")
    }
})
```

The pattern can include arbitrary interleavings; the property holds for
all of them.

## 56. PBT as a debugging tool

Sometimes you encounter a bug in production and have only a vague
description. PBT can reproduce it: write a property that asserts the
expected behaviour, run with many seeds, and let the shrinker hand you
the minimal failing case.

Workflow:

1. Read the bug description; identify the suspected unit under test.
2. Write the simplest property that should hold.
3. Run `go test -rapid.checks=10000`.
4. If it fails, examine the shrunk counter-example.
5. Fix the bug; add the seed to the failfile.

This is faster than instrumenting production traces in many cases. PBT
becomes your local Jepsen.

## 57. Strengthening properties incrementally

Start with a weak property (e.g. "no panic") and strengthen as you gain
confidence:

1. **No panic / no error**: function returns without crashing.
2. **Type invariants**: output has expected size, shape, type.
3. **Reference equivalence**: matches a slow oracle.
4. **Algebraic laws**: associativity, commutativity, identity.
5. **State machine**: matches a model across all operations.

Each layer narrows the contract further. The strongest layer is usually
enough; layers 1-3 catch infrastructure problems while you build up.

## 58. Limits of `rapid.Custom` in practice

`rapid.Custom` is great, but be aware:

- It allocates fresh memory each draw. For very large structs, that
  pressure adds up.
- The shrinker runs the same function with shorter byte streams; if
  your `Custom` short-circuits early (e.g. `if rapid.Bool().Draw {
  return base }`), shrinking may step through many no-op runs.
- Mutually recursive types need separate generators or `Lazy`.

For most code these are not concerns. Profile if PBT is the bottleneck.

## 59. Property: composition of HTTP middlewares

A middleware chain is associative:

```go
rapid.Check(t, func(t *rapid.T) {
    mwList := rapid.SliceOfN(genMiddleware, 0, 5).Draw(t, "mw")
    final := genHandler.Draw(t, "h")
    // Two ways to compose:
    a := chain(mwList, final)
    b := chainStepByStep(mwList, final)
    req := genRequest.Draw(t, "req")
    wA := httptest.NewRecorder()
    wB := httptest.NewRecorder()
    a.ServeHTTP(wA, req)
    b.ServeHTTP(wB, req)
    if wA.Code != wB.Code || wA.Body.String() != wB.Body.String() {
        t.Fatal("middleware composition diverged")
    }
})
```

Associativity of chaining is sometimes broken when middlewares share
state via closures. PBT finds the divergence in seconds.

## 60. Property: schema migration determinism

For a migration `migrate(state_old) -> state_new`, run it twice:

```go
rapid.Check(t, func(t *rapid.T) {
    s0 := genOldState.Draw(t, "s0")
    a := migrate(deepCopy(s0))
    b := migrate(deepCopy(s0))
    if !reflect.DeepEqual(a, b) {
        t.Fatal("migration not deterministic")
    }
})
```

Non-determinism in migrations causes catastrophic divergence in
multi-replica setups. PBT catches it before it reaches production.

## 61. Property: replay safety

If your system has an "apply event" function, replay should produce the
same state regardless of how events arrived:

```go
rapid.Check(t, func(t *rapid.T) {
    events := genEvents.Draw(t, "events")
    // Apply all at once.
    s1 := NewState()
    for _, e := range events { s1.Apply(e) }
    // Apply with reshuffled commutative subgroups.
    reshuffled := commutativeReshuffle(events)
    s2 := NewState()
    for _, e := range reshuffled { s2.Apply(e) }
    if !reflect.DeepEqual(s1.Snapshot(), s2.Snapshot()) {
        t.Fatal("reshuffle changed state — broken commutativity")
    }
})
```

## 62. Property: configuration round-trip

For a system whose config is YAML/TOML/JSON:

```go
rapid.Check(t, func(t *rapid.T) {
    cfg := genConfig.Draw(t, "cfg")
    enc, err := MarshalConfig(cfg)
    if err != nil { t.Fatal(err) }
    parsed, err := ParseConfig(enc)
    if err != nil { t.Fatal(err) }
    if !reflect.DeepEqual(cfg, parsed) {
        t.Fatal("config round-trip broken")
    }
})
```

Configuration codecs frequently regress when defaults change; PBT keeps
them honest.

## 63. Property: idempotent re-entry

For a process that resumes after restart (job queue worker, migration):

```go
rapid.Check(t, func(t *rapid.T) {
    state := genCheckpoint.Draw(t, "state")
    final1 := runToCompletion(state)
    // Simulate crash + resume.
    mid := runToHalf(state)
    final2 := runToCompletion(mid)
    if !reflect.DeepEqual(final1, final2) {
        t.Fatal("crash+resume diverged from clean run")
    }
})
```

This is the property that distinguishes a robust resumable worker from
a fragile one.

## 64. Closing thoughts

PBT is the most under-used tool in mainstream Go testing. A 20-line
property regularly finds bugs that 2000 lines of example tests would
miss. The senior skill is not writing more properties — it is knowing
**which** properties capture the essence of your spec.

When in doubt, ask: "what is true for every valid input?" If you can
write that down, you have a property.
