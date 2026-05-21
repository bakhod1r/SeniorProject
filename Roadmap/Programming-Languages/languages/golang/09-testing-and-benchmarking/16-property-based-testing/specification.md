---
layout: default
title: Property-Based Testing — Specification
parent: Property-Based Testing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/16-property-based-testing/specification/
---

# Property-Based Testing — Specification

[← Back](../)

Formal-style description of the APIs and semantics that matter when writing
property-based tests in Go.

## 1. testing/quick

Stdlib package. Single file (`src/testing/quick/quick.go`). Predates fuzz
and rapid.

### 1.1 Core functions

```go
func Check(f any, config *Config) error
func CheckEqual(f, g any, config *Config) error
```

- `f` is a function returning a `bool` (true means property holds) or
  taking inputs that match `f` via reflection.
- Returns a non-nil `*CheckError` when a counter-example is found.
- `CheckEqual` checks that `f` and `g` agree for all inputs.

### 1.2 Config

```go
type Config struct {
    MaxCount      int
    MaxCountScale float64
    Rand          *rand.Rand
    Values        func([]reflect.Value, *rand.Rand)
}
```

- `MaxCount` defaults to 100.
- `Rand` lets you pin the source for reproducibility.
- `Values` allows fully custom argument generation.

### 1.3 Generator interface

```go
type Generator interface {
    Generate(rand *rand.Rand, size int) reflect.Value
}
```

Custom types implement this to participate in random generation. Without
it, `quick` uses `reflect.Zero` of the type, which is rarely useful.

### 1.4 Limitations

- **No shrinking.** A failure reports the raw random arguments.
- No bias toward edge values; uniform sampling over `int`, `string`, etc.
- Hard to write generators for sum types or recursive structures.

## 2. pgregory.net/rapid

External library (`go get pgregory.net/rapid`). MIT licensed. Author Petr
Gregor. Distinguishing features: integrated shrinker, state machine
support, deterministic seeds.

### 2.1 Entry points

```go
func Check(t TB, prop func(*T))
func MakeCheck(prop func(*T)) func(TB)
```

- `Check` runs the property `Config.Checks` times (default 100).
- The property body draws values from generators using `g.Draw(t, label)`.

### 2.2 Generator interface

```go
type Generator[V any] interface {
    Draw(t *T, label string) V
}
```

Note: rapid uses generics since v1.0.0. Pre-generics versions returned
`interface{}`.

### 2.3 Built-in generators

| Function                          | Result                          |
|-----------------------------------|---------------------------------|
| `rapid.Int()`                     | `int` over full range           |
| `rapid.IntRange(lo, hi int)`      | `int` in `[lo, hi]`             |
| `rapid.Float64()`                 | `float64` including subnormals  |
| `rapid.Bool()`                    | random bool                     |
| `rapid.String()`                  | UTF-8 string                    |
| `rapid.StringN(min, max, max)`    | bounded string                  |
| `rapid.StringMatching(regex)`     | string matching regex           |
| `rapid.SliceOf(g)`                | slice with random length        |
| `rapid.SliceOfN(g, min, max)`     | slice with bounded length       |
| `rapid.MapOf(kg, vg)`             | map                             |
| `rapid.OneOf(g1, g2, ...)`        | union                           |
| `rapid.Just(v)`                   | constant                        |

### 2.4 Combinators

```go
rapid.Map(gen, func(x A) B { ... })           // project
rapid.Custom(func(t *rapid.T) T { ... })       // build from drawn parts
rapid.Filter(gen, func(x A) bool { ... })      // reject some (use sparingly)
```

`Filter` can cause "too many discarded" failures if its predicate is rare.

### 2.5 Shrinking semantics

When a property fails, rapid replays the property with progressively
"smaller" choices recorded in the byte stream that drove generation. The
algorithm is integrated, not type-specific — every generator shrinks
because it ultimately consumes random bytes.

The minimal failing input is reported, plus a seed (`rapid.failfile=...`)
to replay exactly.

### 2.6 State machines

```go
type StateMachine struct {
    // user-defined fields
}
func (sm *StateMachine) Init(t *rapid.T)
func (sm *StateMachine) Check(t *rapid.T)
// methods that take *rapid.T are "actions"
rapid.Run[*StateMachine]()(t)
```

`rapid.Run` generates a sequence of actions, calls them, runs `Check`
between each, and shrinks failing sequences.

### 2.7 Flags

```
-rapid.checks N        number of property runs (default 100)
-rapid.steps N         number of state-machine actions per check
-rapid.seed N          seed the PRNG
-rapid.failfile PATH   replay a recorded failure
-rapid.shrinktime D    max time to spend shrinking
-rapid.v               verbose
```

## 3. leanovate/gopter

Older library. Different idioms (Java-style builders). Still maintained.

### 3.1 Core

```go
parameters := gopter.DefaultTestParameters()
properties := gopter.NewProperties(parameters)
properties.Property("reverse twice is identity", prop.ForAll(
    func(xs []int) bool { return equal(Reverse(Reverse(xs)), xs) },
    gen.SliceOf(gen.Int()),
))
properties.TestingRun(t)
```

### 3.2 Generators

`gopter/gen` package — `gen.Int`, `gen.AlphaString`, `gen.SliceOf`, etc.
Shrinking available via `gopter/prop.ForAll` integrated with `gen.*`.

### 3.3 Commands (stateful)

`gopter/commands` provides a model-based testing API similar in spirit to
ScalaCheck's `Commands`.

## 4. Common properties (formal)

| Name           | Property                                  |
|----------------|-------------------------------------------|
| Idempotency    | `f(f(x)) = f(x)`                          |
| Round-trip     | `dec(enc(x)) = x`                         |
| Identity       | `f(x, e) = x` and `f(e, x) = x`           |
| Associativity  | `f(f(a,b),c) = f(a,f(b,c))`               |
| Commutativity  | `f(a,b) = f(b,a)`                         |
| Monotonicity   | `a <= b ⇒ f(a) <= f(b)`                   |
| Permutation    | `multiset(out) = multiset(in)`            |
| Sortedness     | `∀ i : out[i] <= out[i+1]`                |
| Oracle         | `fast(x) = naive(x)`                      |

## 5. Interaction with `go test -fuzz`

Fuzz operates on `[]byte` (or registered concrete corpus seeds). PBT
operates on **typed generators**. A pragmatic split:

- Fuzz the byte-level boundary (HTTP body parser, decoder).
- PBT the typed core (sort, set ops, AST transformations).

You can combine: a fuzz target that interprets bytes as a serialised
command sequence, then runs a state-machine model.

## 6. Determinism rules

A property must depend only on values drawn from `*rapid.T` (or arguments
passed to `quick.Check`). It must not read wall time, environment
variables, or unseeded `rand` — otherwise the seed cannot replay failures.

## 7. Pre-conditions and discards

A property may discard an input as irrelevant by returning early or
calling `t.Skip()`. Both rapid and gopter track the discard rate. If
discards exceed a threshold (rapid default ~75%), the test fails with
"too many discards" — indicating the generator is too broad for the
predicate.

```go
rapid.Check(t, func(t *rapid.T) {
    n := rapid.Int().Draw(t, "n")
    if n == 0 {
        t.Skip("zero is not interesting")
    }
    // property body uses n != 0
})
```

Skips are weaker than `Filter`: skips still cost a generation, while
`Filter` rejects and re-draws.

## 8. The `rapid.T` type

`*rapid.T` embeds `*testing.T`, so all standard testing methods work:
`Fatalf`, `Logf`, `Helper`, `Cleanup`. Additional methods:

```go
func (t *T) Repeat(actions map[string]func(*T)) // for state machines
func (t *T) Logf(format string, args ...any)
func (t *T) Skip(args ...any)
```

`rapid.Label(t, name, condition)` marks a category and lets you analyse
coverage with `-rapid.v`.

## 9. Comparison: rapid vs gopter API

| Concept                | rapid                       | gopter                              |
|------------------------|-----------------------------|-------------------------------------|
| Entry point            | `rapid.Check(t, prop)`      | `properties.TestingRun(t)`          |
| Property body          | inline `func(*rapid.T)`     | `prop.ForAll(fn, gen1, gen2, ...)`  |
| Generator              | `rapid.Int()`               | `gen.Int()`                         |
| Range                  | `rapid.IntRange(lo, hi)`    | `gen.IntRange(lo, hi)`              |
| Map                    | `rapid.Map(g, fn)`          | `gen.Map(fn)(g)`                    |
| Custom                 | `rapid.Custom(fn)`          | manual `gen.NewGenerator`           |
| State machine          | `rapid.StateMachine`        | `commands.ProtoCommands`            |
| Shrinking              | built into draw bytes       | per-generator shrinker              |

rapid is more imperative; gopter is more declarative (closer to
ScalaCheck).

## 10. Reproducibility model

rapid's reproducibility model: a single 64-bit seed determines the
entire run, including all draws and the shrinking trajectory. Two runs
with the same seed and the same code produce identical results.

This breaks if:

- The code under test reads wall time, env, or unseeded random.
- Map iteration order leaks into output.
- Concurrent goroutines change the test's observable behaviour.

Pin the seed in CI logs. When a failure occurs, attach the seed to the
ticket. Always replayable, always reducible.

## 11. State machine formal model

A `rapid.StateMachine` action is a method on a struct that takes a
`*rapid.T`. The state machine driver:

1. Constructs an instance of the struct.
2. Calls `Init(t)`.
3. Repeatedly:
   - Picks a random action method.
   - Calls it with `t`.
   - Calls `Check(t)`.
4. On failure, shrinks the sequence of action choices and per-action
   parameter draws.

Action methods may return early (precondition not met). The driver does
not retry skipped actions; it just continues.

The shrinker preserves the *order* of actions while reducing both their
count and their parameter values.

## 12. Comparing with `go test -fuzz`

Native fuzz has different semantics:

- Input is `[]byte` (or registered seed values).
- Coverage-guided mutation (libFuzzer / Go's fuzzer).
- Persistent corpus stored in `testdata/fuzz/`.
- No shrinking of *structure* — only minimisation of byte length.

A composite pattern:

```go
func FuzzCmdStream(f *testing.F) {
    f.Fuzz(func(t *testing.T, data []byte) {
        cmds := decodeCmds(data) // bytes -> structured ops
        sys := NewSys()
        model := NewModel()
        for _, c := range cmds {
            applyTo(sys, c)
            applyTo(model, c)
            if !equiv(sys, model) {
                t.Fatal("divergence")
            }
        }
    })
}
```

This is fuzz feeding a state machine — best of both worlds.

## 13. Naming conventions

By community convention, property tests follow names that read like
specifications:

- `Test<Type>_<Property>` — e.g. `TestSort_IsSorted`.
- `TestProperty_<Predicate>` — e.g. `TestProperty_RoundTrip`.

State-machine tests follow `Test<Type>_StateMachine`.

Stick to a convention in your codebase. Grep-ability matters when you
have hundreds of properties.

## 14. Version compatibility

`pgregory.net/rapid` follows semver. The 1.x line introduced generics
and is the version you should use. Older code may use pre-generics
APIs returning `interface{}`; the conversion is mechanical but worth
budget for in a migration.

`testing/quick` has been stable since Go 1.0. New code rarely uses it,
but legacy code may.

`leanovate/gopter` follows its own versioning; check the README for the
current major.

## 15. References

- `pgregory.net/rapid` — primary library.
- `testing/quick` — stdlib, in `pkg/testing/quick`.
- `github.com/leanovate/gopter` — alternative library.
- Hughes & Claessen, *QuickCheck*, ICFP 2000 — the original paper.
