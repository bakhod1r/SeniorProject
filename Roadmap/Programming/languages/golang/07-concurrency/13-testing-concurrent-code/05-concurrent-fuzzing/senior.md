# Concurrent Fuzzing — Senior Level

> Focus: property-based testing with `pgregory.net/rapid` and `gopter`, state-machine fuzzing for concurrent systems, CI-scale fuzzing infrastructure, fuzz target design as a discipline.

At senior level you treat fuzzing as one tool inside a wider testing discipline that includes property-based testing, model-based testing, and chaos engineering. You also design fuzz targets for systems where the input is *not* a simple byte slice — distributed systems, state machines, protocols. This page is about those harder cases.

## Table of Contents

1. [Native fuzzing vs property-based testing](#native-fuzzing-vs-property-based-testing)
2. [The `pgregory.net/rapid` library](#the-pgregorynetrapid-library)
3. [`rapid`'s state machine testing](#rapids-state-machine-testing)
4. [`gopter` — the historical alternative](#gopter--the-historical-alternative)
5. [Fuzz target design for state machines](#fuzz-target-design-for-state-machines)
6. [Linearisability checking](#linearisability-checking)
7. [Concurrent invariants at scale](#concurrent-invariants-at-scale)
8. [CI infrastructure for sustained fuzzing](#ci-infrastructure-for-sustained-fuzzing)
9. [Sharding and parallelism](#sharding-and-parallelism)
10. [Triage workflow at team scale](#triage-workflow-at-team-scale)
11. [Anti-patterns at senior level](#anti-patterns-at-senior-level)
12. [Summary](#summary)

---

## Native fuzzing vs property-based testing

The Go standard library's fuzzer and property-based libraries solve overlapping problems with different trade-offs.

| Aspect | `testing.F` (native) | `pgregory.net/rapid` |
|--------|----------------------|----------------------|
| Input types | `[]byte`, `string`, primitives | Any type via combinators |
| Mutation | Coverage-guided (libFuzzer-style) | Random with shrinkers |
| Persistence | Corpus on disk, committed reproducers | None by default — failures repro via seed |
| Concurrency support | Bare metal — you write the harness | First-class state-machine API |
| Shrinking | Built-in minimisation | Rich shrinkers per generator |
| Performance | Very fast (no reflection) | Slower per iteration (reflection) |
| Best for | Parser/decoder bugs, byte-level inputs | Structured invariants, state machines |

The right answer is "use both." Native fuzzing for high-throughput input-driven exploration, property-based for structured invariants where the input is naturally a sequence of typed operations.

### When to choose which

- Input is bytes from the network or a file → native fuzzer.
- Input is a sequence of method calls on a Go API → property-based library or hand-rolled state machine.
- You want corpus-based regression coverage → native fuzzer.
- You want rich shrinking on a complex input → property-based library.
- You need both coverage guidance and structured input → native fuzzer with a decoder; the decoder is your "generator."

---

## The `pgregory.net/rapid` library

`pgregory.net/rapid` (typically imported as `rapid`) is the modern Go property-based testing library. It is well-maintained, has rich shrinkers, and integrates with the `testing` package.

### Basic usage

```go
import (
    "testing"
    "pgregory.net/rapid"
)

func TestReverse(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        s := rapid.String().Draw(t, "input")
        r := Reverse(Reverse(s))
        if r != s {
            t.Fatalf("not idempotent: %q -> %q", s, r)
        }
    })
}
```

`rapid.Check` runs the property repeatedly. `rapid.String()` is a generator. `Draw(t, label)` pulls one value. On failure, `rapid` shrinks the input toward minimality automatically. The label is used in shrinking traces.

### Generators are composable

```go
type point struct{ X, Y int }

func genPoint() *rapid.Generator[point] {
    return rapid.Custom(func(t *rapid.T) point {
        return point{
            X: rapid.IntRange(-100, 100).Draw(t, "x"),
            Y: rapid.IntRange(-100, 100).Draw(t, "y"),
        }
    })
}
```

Compare with native fuzzing: to fuzz `point` values you would encode them as bytes and write a decoder. `rapid` builds the generator directly from typed combinators.

### Drawing inside a property

```go
rapid.Check(t, func(t *rapid.T) {
    n := rapid.IntRange(1, 100).Draw(t, "n")
    s := rapid.SliceOfN(rapid.Int(), n, n).Draw(t, "s")
    sort.Ints(s)
    if !sort.IntsAreSorted(s) {
        t.Fatal("sort failed")
    }
})
```

Use `rapid` when the value space is naturally typed and structured. Use the native fuzzer when it is naturally bytes.

### Hybrid: `rapid` inside a fuzz function

A pattern worth knowing — `rapid.Check` works on `*rapid.T`, which can be obtained from a `*testing.T`. You can drive `rapid` from inside a `f.Fuzz` body:

```go
func FuzzWithRapid(f *testing.F) {
    f.Add(int64(42))
    f.Fuzz(func(t *testing.T, seed int64) {
        rapid.Check(t, func(rt *rapid.T) {
            n := rapid.IntRange(0, 1000).Draw(rt, "n")
            doSomething(seed, n)
        })
    })
}
```

The native fuzzer mutates `seed`. `rapid` uses `seed` to generate structured operations. You get coverage-guided exploration *of seeds* and shrinkable structured inputs per seed. The trade-off: per-iteration overhead is higher; debugging is more complex.

---

## `rapid`'s state machine testing

The killer feature of `rapid` for concurrent code is built-in state machine testing.

### Pattern

```go
import (
    "testing"
    "pgregory.net/rapid"
)

type queueMachine struct {
    q     *ConcurrentQueue
    model []int
}

func (m *queueMachine) Push(t *rapid.T) {
    v := rapid.Int().Draw(t, "v")
    m.q.Push(v)
    m.model = append(m.model, v)
}

func (m *queueMachine) Pop(t *rapid.T) {
    if len(m.model) == 0 {
        return
    }
    got, ok := m.q.Pop()
    if !ok {
        t.Fatalf("expected pop ok, got !ok")
    }
    expected := m.model[0]
    m.model = m.model[1:]
    if got != expected {
        t.Fatalf("expected %d, got %d", expected, got)
    }
}

func (m *queueMachine) Check(t *rapid.T) {
    if got := m.q.Len(); got != len(m.model) {
        t.Fatalf("len: model=%d, q=%d", len(m.model), got)
    }
}

func TestQueueMachine(t *testing.T) {
    rapid.Check(t, func(t *rapid.T) {
        m := &queueMachine{q: NewQueue()}
        t.Repeat(rapid.StateMachineActions(m))
    })
}
```

`rapid` discovers all methods on the machine struct. Each iteration of the inner loop picks a method by reflection and runs it. After each action it calls `Check` if defined. On failure it shrinks the action sequence to the minimum that reproduces.

This works wonderfully for sequential testing. For concurrent testing the standard idiom is to drive operations across goroutines from the action sequence:

```go
func TestQueueConcurrent(t *testing.T) {
    rapid.Check(t, func(rt *rapid.T) {
        actions := rapid.SliceOf(genAction()).Draw(rt, "actions")
        q := NewQueue()
        var wg sync.WaitGroup
        for _, a := range actions {
            wg.Add(1)
            go func(a action) {
                defer wg.Done()
                a.run(q)
            }(a)
        }
        wg.Wait()
        if q.Len() < 0 {
            rt.Fatal("negative length")
        }
    })
}
```

Combine with `-race`. The library's shrinker reduces the action list while preserving the failure.

---

## `gopter` — the historical alternative

`github.com/leanovate/gopter` is the older property-based testing library, modelled after Scala's ScalaCheck and Haskell's QuickCheck. It is still maintained but `rapid` is the modern choice.

### Why mention `gopter`

- Older codebases use it. You will encounter it.
- Its API is closer to QuickCheck — useful if your team comes from Haskell or Scala.
- It has a different shrinking algorithm and explicit `Property` values.

### Example

```go
import (
    "testing"
    "github.com/leanovate/gopter"
    "github.com/leanovate/gopter/gen"
    "github.com/leanovate/gopter/prop"
)

func TestReverseGopter(t *testing.T) {
    params := gopter.DefaultTestParameters()
    properties := gopter.NewProperties(params)
    properties.Property("reverse is its own inverse", prop.ForAll(
        func(s string) bool {
            return Reverse(Reverse(s)) == s
        },
        gen.AlphaString(),
    ))
    properties.TestingRun(t)
}
```

For new code, prefer `rapid`. The combinators are nicer, the shrinkers are richer, and the state-machine API is built-in.

---

## Fuzz target design for state machines

The hardest fuzz targets are state machines: TCP-like protocols, database engines, consensus state, custom RPC servers. The input is not bytes but *a sequence of operations*. The invariant is not "no panic" but "outcomes are consistent with a sequential specification."

### The Three-Layer Pattern

1. **Generator layer.** Produces a sequence of operations. For native fuzzing, decode from `[]byte`. For `rapid`, use a typed generator.
2. **Execution layer.** Runs the operations against the system under test, possibly concurrently.
3. **Model layer.** A reference implementation of the state machine's semantics. Either sequential (for linearisability checks) or relaxed (for eventual-consistency systems).

```go
type opKind int
const (
    opSet opKind = iota
    opGet
    opDel
)

type op struct {
    kind opKind
    key  string
    val  int
}

// Generator layer
func decodeOps(data []byte) []op { /* ... */ }

// Model layer (sequential reference)
type model struct{ m map[string]int }
func (m *model) apply(o op) (int, bool) {
    switch o.kind {
    case opSet:
        m.m[o.key] = o.val
        return o.val, true
    case opGet:
        v, ok := m.m[o.key]
        return v, ok
    case opDel:
        delete(m.m, o.key)
        return 0, true
    }
    return 0, false
}

// Execution layer
func FuzzKVConcurrent(f *testing.F) {
    f.Add([]byte{0x01, 'a', 0x05, 0x02, 'a'})
    f.Fuzz(func(t *testing.T, data []byte) {
        ops := decodeOps(data)
        if len(ops) == 0 {
            t.Skip()
        }
        kv := NewKV()
        var wg sync.WaitGroup
        for _, o := range ops {
            wg.Add(1)
            go func(o op) {
                defer wg.Done()
                switch o.kind {
                case opSet: kv.Set(o.key, o.val)
                case opGet: kv.Get(o.key)
                case opDel: kv.Del(o.key)
                }
            }(o)
        }
        wg.Wait()
        // Sequential invariants on terminal state
        m := &model{m: map[string]int{}}
        for _, o := range ops {
            m.apply(o)
        }
        // ... what to assert here is hard; see linearisability
    })
}
```

The final assertion is the tricky bit. Under concurrent execution there is no single "correct" final state for arbitrary interleavings, only a set of states corresponding to legal serial orders. This is where linearisability checking comes in.

---

## Linearisability checking

A history of concurrent operations is **linearisable** if there exists a sequential ordering of the operations such that:

1. Each operation appears to take effect instantaneously at a point between its start and end.
2. The sequential order is consistent with each operation's real-time order: if op A finished before op B started, A precedes B in the ordering.

Checking linearisability is NP-hard in general but tractable for short histories. The `anishathalye/porcupine` library implements Wing-Gong linearisability checking for Go.

### Sketch with porcupine

```go
import "github.com/anishathalye/porcupine"

type kvInput struct {
    op    string
    key   string
    val   int
}
type kvOutput struct {
    val int
    ok  bool
}

var kvModel = porcupine.Model{
    Init: func() any { return map[string]int{} },
    Step: func(state, in, out any) (bool, any) {
        s := state.(map[string]int)
        i := in.(kvInput)
        o := out.(kvOutput)
        switch i.op {
        case "set":
            ns := copyMap(s)
            ns[i.key] = i.val
            return true, ns
        case "get":
            v, ok := s[i.key]
            return v == o.val && ok == o.ok, s
        }
        return false, s
    },
}

func recordOp(history *[]porcupine.Operation, in kvInput, out kvOutput, start, end int64) {
    *history = append(*history, porcupine.Operation{
        ClientId: 0,
        Input:    in,
        Output:   out,
        Call:     start,
        Return:   end,
    })
}
```

After running operations concurrently and recording timestamps, you feed the history to `porcupine.CheckOperations(kvModel, history)`. It returns `true` if linearisable. Couple this with native fuzzing or `rapid`: the fuzzer generates operation sequences, the checker proves or disproves linearisability for each one.

Linearisability checking is slow (exponential worst-case) but bug reports are gold: "this exact 5-operation history has no legal serialisation, so your KV store is not linearisable."

---

## Concurrent invariants at scale

Beyond the simple invariants of the middle page (counter conservation, no leaks, no deadlock), senior fuzzing exercises:

- **Sequential consistency.** Weaker than linearisability, stronger than eventual. All ops appear in *some* total order, but not necessarily respecting real time.
- **Causality.** If op B observed the effect of op A in one process, B must observe A in every process.
- **Monotonic reads / writes.** Per-client, observed values do not regress.
- **Read-your-writes.** A client's own writes are visible to its subsequent reads.
- **Atomic visibility of compound ops.** No client sees half of a multi-key transaction.

Each invariant corresponds to a checker. Each checker can be combined with native fuzzing or `rapid` generation.

### Probabilistic invariants

Some properties hold "with high probability under fair scheduling." Example: under contention, `sync.Mutex` should not starve any goroutine for more than O(N) acquisitions. You cannot prove starvation freedom by fuzzing, but you can detect cases where it is grossly violated. Treat probabilistic invariants as smoke tests, not proofs.

### Composability

Invariants are composable. An operation history can be checked for linearisability *and* leak detection *and* deadlock freedom. Run all checks per fuzz iteration; report any violation.

---

## CI infrastructure for sustained fuzzing

At senior level you design fuzzing infrastructure that runs continuously.

### Three tiers

**Tier 1 — Per-PR (~5 min):** Run seed corpus + saved reproducers under `-race`. Catches regressions on every change.

**Tier 2 — Nightly per-target (~10 min each, in parallel):** Active fuzzing. New failures open issues automatically.

**Tier 3 — Continuous (dedicated machines):** A pool of always-running fuzz workers per target. Findings page on-call. This is the OSS-Fuzz model. Worth it for security-critical code; overkill for most teams.

### Integrating with OSS-Fuzz

For OSS Go projects, Google's OSS-Fuzz runs your fuzz targets on its infrastructure for free. You write a small `.clusterfuzzlite/` or OSS-Fuzz build script:

```dockerfile
FROM gcr.io/oss-fuzz-base/base-builder-go
RUN git clone https://github.com/your-org/your-project
WORKDIR your-project
COPY build.sh $SRC/
```

```bash
# build.sh
compile_native_go_fuzzer github.com/your-org/your-project/parser FuzzParse fuzz_parse
```

OSS-Fuzz runs the fuzzer 24/7, reports new failures via issues, and verifies your fixes. Suitable for high-stakes code: cryptography, parsers in widely-deployed software, network protocols.

### Reproducible builds

CI fuzz workers must use a pinned Go version and pinned dependencies. A new Go release can change basic-block layout, which invalidates parts of the generated corpus. Pin and update deliberately.

---

## Sharding and parallelism

A single `go test -fuzz` runs `GOMAXPROCS` workers per process. To use more parallelism, shard at the *target* level:

- One CI job per fuzz target.
- Multiple CI jobs for the *same* target, each with a different starting seed corpus subset.

The native fuzzer does not support corpus partitioning natively, so the shard split is "informally" by which seeds you load:

```go
func FuzzParseShard0(f *testing.F) {
    loadSeeds(f, "testdata/samples/shard0/*.bin")
    f.Fuzz(/* same body as FuzzParseShard1 */)
}
```

Cumbersome but effective: each shard explores from different starting points. Coverage feedback within each worker process is independent. The union of coverage across shards is what you want.

A simpler approach: cache the *combined* generated corpus across shards by uploading at end of each run and downloading at the start of the next. This amortises discovery across shards over time.

---

## Triage workflow at team scale

When you have N fuzz targets running nightly, expect failures regularly. Triage discipline matters.

### Issue template

```
Title: [fuzz] FuzzParse failure: panic in lexer
Body:
- Target: FuzzParse
- Package: github.com/org/proj/parser
- First seen: 2026-05-11 nightly run
- Reproducer: testdata/fuzz/FuzzParse/<hash>
- Stack trace: <paste>
- Hypothesised cause: <fill in after debug>
```

### Triage states

1. **New.** Just discovered. Reproducer committed. Owner assigned.
2. **Reproduced locally.** Engineer ran `go test -run=FuzzParse/<hash>` and saw the failure.
3. **Diagnosed.** Root cause identified.
4. **Fixed.** PR open with fix + the reproducer.
5. **Verified.** Fix merged; nightly green for N consecutive runs.

### Flaky failures

A fuzz failure that does not reproduce locally is a sign of non-determinism in the target. Common causes:

- `time.Now()` in the system under test or the test harness.
- Unseeded `rand`.
- Goroutine scheduling differences between systems.
- File-system or network I/O during fuzzing (which should not happen but sometimes does).

Treat a flaky fuzz failure as a higher-priority bug than a deterministic one: it points at a hidden source of non-determinism that obscures all future fuzzing.

---

## Anti-patterns at senior level

### Anti-pattern: One mega fuzz target

A `FuzzEverything` that decodes the input into "what subsystem to test" and dispatches. Sounds elegant; in practice the coverage signal is muddled, shrinking is harder, and triage is awkward. Prefer many small targets.

### Anti-pattern: Pure-random generators with no shrinker

If you write a custom generator without shrinking, every failure is a 500-byte mess to debug. Either use library generators (which shrink for free) or invest in a shrinker.

### Anti-pattern: Linearisability check on every iteration when not needed

Linearisability checking is slow. For a queue that you already know is sequentially consistent, simpler invariants suffice. Save linearisability for the cases where weak ordering is the actual concern.

### Anti-pattern: Letting the corpus rot

A 2-year-old `testdata/fuzz/FuzzXxx/` with 200 entries, half of which exercise paths that no longer exist. Periodically audit and delete obsolete entries. Replace with smaller, more meaningful seeds.

### Anti-pattern: Fuzzing without `-race` on concurrent code

A senior engineer never makes this mistake. Documented here so reviewers know to call it out.

### Anti-pattern: Trusting the fuzzer to fail

Fuzzing finds bugs only when invariants are tight. A target that only asserts "no panic" will miss every silent-incorrect-output bug. Tighten invariants.

---

## Summary

Senior-level concurrent fuzzing pairs the native fuzzer with property-based libraries (`rapid` being the modern choice). The native fuzzer excels at byte-driven input exploration; `rapid` excels at structured operation generation with rich shrinking. For state machines and concurrent data structures, both can drive operations across goroutines under `-race`. The hardest invariant — linearisability — has dedicated checkers (`porcupine`). At infrastructure scale, you build a three-tier CI (per-PR seeds, nightly active, continuous OSS-Fuzz-style for the most critical code) and a triage workflow that turns every nightly failure into a permanent regression test. The discipline is: write tight invariants, prefer many small targets to one big one, never ship concurrent code without a fuzz target under `-race`, and treat flaky fuzz failures as the highest-priority bug class because they obscure all future fuzzing.
