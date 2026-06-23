# Concurrent Fuzzing — Middle Level

> Focus: corpus engineering, **concurrent invariants**, stress-replaying fuzz-found inputs, integrating `-fuzz -race` into local and CI workflows.

By the time you reach middle level you can write a `FuzzXxx` target in your sleep. The skill that separates middle from junior is *what* you fuzz and *how* you keep the fuzzer earning its keep over weeks and months. This page is about engineering practice around fuzzing concurrent code.

## Table of Contents

1. [Beyond the seed corpus](#beyond-the-seed-corpus)
2. [Concurrent invariants](#concurrent-invariants)
3. [Stress-replaying fuzz-found inputs](#stress-replaying-fuzz-found-inputs)
4. [Fuzz target architecture for concurrent code](#fuzz-target-architecture-for-concurrent-code)
5. [Encoding operation sequences in `[]byte`](#encoding-operation-sequences-in-byte)
6. [Workflow: local fuzzing in practice](#workflow-local-fuzzing-in-practice)
7. [Workflow: CI integration](#workflow-ci-integration)
8. [Reading and triaging failures](#reading-and-triaging-failures)
9. [Corpus hygiene](#corpus-hygiene)
10. [Combining with `t.Parallel()`](#combining-with-tparallel)
11. [Common middle-level pitfalls](#common-middle-level-pitfalls)
12. [Self-assessment](#self-assessment)

---

## Beyond the seed corpus

Junior-level fuzzing uses a handful of `f.Add` calls. Middle-level fuzzing curates a corpus.

### Sources of seeds

- **Real production samples.** Strip PII, anonymise, drop into `testdata/samples/`. Load them at fuzz-target start.
- **Examples from documentation.** Every code example in your README is a seed candidate.
- **Failures from manual QA.** Every malformed request a tester pasted into a bug ticket.
- **Outputs from other fuzzers.** AFL, libFuzzer, OSS-Fuzz find inputs that the native fuzzer can use.
- **The generated corpus from a previous run.** Save `$GOCACHE/fuzz/<pkg>/<target>/` somewhere durable.

### Loading external seeds

```go
func FuzzParse(f *testing.F) {
    matches, _ := filepath.Glob("testdata/samples/*.bin")
    for _, p := range matches {
        b, err := os.ReadFile(p)
        if err != nil {
            f.Fatal(err)
        }
        f.Add(b)
    }
    f.Fuzz(func(t *testing.T, data []byte) {
        _, _ = Parse(data)
    })
}
```

A few hundred curated seeds make the difference between "fuzzer wanders for hours" and "fuzzer finds the bug in 30 seconds." Coverage-guided mutation builds on what is given.

### Seeding with structured inputs

If your code consumes structured input, generate seeds programmatically:

```go
func FuzzAST(f *testing.F) {
    for _, expr := range []string{"1+2", "(a)", "fn(x,y)"} {
        f.Add([]byte(expr))
    }
    for n := 0; n < 32; n++ {
        f.Add(randomExpr(n))
    }
    f.Fuzz(func(t *testing.T, data []byte) {
        _, _ = ParseExpr(data)
    })
}
```

The fuzzer mutates these prosaic inputs into pathological ones much faster than it would discover the prosaic ones from scratch.

---

## Concurrent invariants

The most important concept at middle level. A **concurrent invariant** is a property of a concurrent program that must hold under any interleaving the scheduler can produce. Fuzzing is the technique for discovering inputs that, combined with the scheduler's freedom, violate the invariant.

### Categories of concurrent invariants

**Linearisability of single-key operations.** For a concurrent map, every `Get` should observe the value written by the most recent (in real time) preceding `Set`. Hard to test directly without a model. The relaxed version: after all writes complete, `Get(k)` should return the value of the last `Set(k)` for *some* serialisation of the writes.

**Conservation laws.** A counter incremented `N` times and decremented `M` times must read `N - M`. A buffer pool with `Get` and `Put` must conserve total items. A token bucket must conserve tokens minus issuances minus expirations.

**Bounded operations.** A semaphore should never permit more than `N` simultaneous holders. A worker pool should never spawn more than `MaxWorkers` goroutines.

**Monotonic progress.** A version counter should never go backwards. A "latest seen value" should never decrease (modulo wrap-around).

**No leaks.** After the system has been quiesced, no goroutines should remain (compare with `runtime.NumGoroutine` before and after). No channel should be open. No memory should be retained.

**No deadlock.** Every operation should complete within a timeout. Easy to check: wrap the fuzz body in a `select` with `time.After`.

**No data race.** Implicit. `-race` checks this for you. The fuzz function just has to make the rare interleavings happen.

### A concurrent invariant as code

```go
func FuzzCounterConservation(f *testing.F) {
    f.Add(uint64(0xabcdef))
    f.Fuzz(func(t *testing.T, ops uint64) {
        c := &Counter{}
        var wg sync.WaitGroup
        var expected int64
        for i := 0; i < 32; i++ {
            op := (ops >> i) & 1
            wg.Add(1)
            if op == 1 {
                expected++
                go func() { defer wg.Done(); c.Inc() }()
            } else {
                expected--
                go func() { defer wg.Done(); c.Dec() }()
            }
        }
        wg.Wait()
        if got := int64(c.Value()); got != expected {
            t.Fatalf("conservation: expected %d, got %d", expected, got)
        }
    })
}
```

The invariant is "final counter equals net operations." The fuzzer mutates the operation sequence. With `-race`, you also catch any unsynchronised access. Without `-race`, you still catch logic bugs (lost-update races that happen to manifest as visible inconsistencies).

### Linearisable history checking

For sophisticated invariants you record an operation history and check linearisability post-hoc:

```go
type event struct {
    op    string
    arg   any
    res   any
    start time.Time
    end   time.Time
}

var events []event
var mu sync.Mutex

record := func(e event) {
    mu.Lock()
    defer mu.Unlock()
    events = append(events, e)
}
```

After the workload completes, you feed `events` to a checker (manual or via `porcupine` or `pgregory.net/rapid/statemachine`) that searches for a serial order consistent with each operation's real-time start/end window. This is heavier than simple invariants but catches subtle ordering bugs.

---

## Stress-replaying fuzz-found inputs

The fuzzer reports a failing input. You fix the bug. Now you want a fast regression test that does not depend on `-fuzz` running. The pattern is **stress replay**.

### The pattern

```go
func TestRegression_FuzzCounterConservation_2024_06_03(t *testing.T) {
    if testing.Short() {
        t.Skip("stress test")
    }
    const ops uint64 = 0xdeadbeefcafebabe
    for i := 0; i < 10_000; i++ {
        c := &Counter{}
        var wg sync.WaitGroup
        var expected int64
        for j := 0; j < 32; j++ {
            op := (ops >> j) & 1
            wg.Add(1)
            if op == 1 {
                expected++
                go func() { defer wg.Done(); c.Inc() }()
            } else {
                expected--
                go func() { defer wg.Done(); c.Dec() }()
            }
        }
        wg.Wait()
        if got := int64(c.Value()); got != expected {
            t.Fatalf("iter %d: expected %d, got %d", i, expected, got)
        }
    }
}
```

Run with `-race`. The "rare" interleaving that the fuzzer happened upon becomes near-certain across 10,000 iterations. Once the fix is committed, this regression test guards it.

### Two regression mechanisms, not one

1. **The fuzz framework's mechanism.** The minimised reproducer is committed under `testdata/fuzz/FuzzXxx/<hash>`. `go test ./...` re-runs it on every change.
2. **The stress-replay test.** Adds confidence that the fix removes the race under many interleavings, not just the one the fuzzer hit.

Use both. The fuzz reproducer is automatic; the stress test makes the failure pop reliably in any developer's local run.

### Tuning stress iterations

How many iterations? Empirical answer: enough that the bug, if reintroduced, fails *every* CI run. For typical races on a busy CI runner, 1000–10,000 iterations under `-race` is sufficient. Wrap in `if testing.Short() { t.Skip() }` so that `go test -short` skips them — keep the unit-test loop fast.

---

## Fuzz target architecture for concurrent code

A fuzz target for concurrent code has four parts:

1. **Seed inputs.** Real-world byte sequences plus a few hand-written ones.
2. **A decoder.** Turns the fuzz `[]byte` into a list of operations (or a structured input).
3. **A harness.** Constructs the system under test fresh, spawns goroutines to apply operations, waits for completion.
4. **Invariant checks.** Post-conditions on the system.

```go
func FuzzQueueConcurrent(f *testing.F) {
    // 1. Seed inputs
    f.Add([]byte{0x01, 0x02, 0x03, 0x04})
    f.Add(bytes.Repeat([]byte{0x01}, 32))

    f.Fuzz(func(t *testing.T, data []byte) {
        // 2. Decode
        ops, args := decodeQueueOps(data)
        if len(ops) == 0 {
            t.Skip()
        }
        // 3. Harness
        q := NewQueue()
        var wg sync.WaitGroup
        const workers = 4
        for w := 0; w < workers; w++ {
            wg.Add(1)
            go func(slice []byte, slice2 []int) {
                defer wg.Done()
                for i, op := range slice {
                    switch op {
                    case 'P':
                        q.Push(slice2[i])
                    case 'p':
                        q.Pop()
                    }
                }
            }(slicePart(ops, w, workers), slicePart(args, w, workers))
        }
        wg.Wait()
        // 4. Invariant
        if q.Len() < 0 {
            t.Fatalf("queue length went negative: %d", q.Len())
        }
    })
}
```

### Workers from input

A subtle question: how many goroutines should the harness spawn? Hard-coded works for most cases. Driving it from the input gives the fuzzer one more dimension to explore but adds variance:

```go
n := int(data[0])%4 + 2 // 2..5 workers
```

### Avoiding "fuzz the harness, not the code"

If the harness has a bug, the fuzzer finds the *harness* bug rather than the code bug. Keep the harness boring: a fixed worker count, a simple decoder, plain `sync.WaitGroup` coordination. The interesting thing being tested is the *code*, not the test setup.

---

## Encoding operation sequences in `[]byte`

The fuzz API supports only basic types. To fuzz a stream of operations, you encode them in `[]byte` and decode inside the fuzz function. A good encoding is **dense** (most bytes mean something), **total** (no panic on any input), and **diverse** (small changes to the bytes produce meaningfully different op sequences).

### Encoding template

```go
type op struct {
    kind byte
    key  string
    val  int
}

func decode(data []byte) []op {
    var out []op
    for len(data) >= 1 {
        b := data[0]
        data = data[1:]
        kind := b & 0x03           // 4 op kinds
        keyLen := int((b >> 2) & 0x07) // 0..7 key length
        if len(data) < keyLen+1 {
            return out
        }
        key := string(data[:keyLen])
        data = data[keyLen:]
        val := int(int8(data[0]))
        data = data[1:]
        out = append(out, op{kind: kind, key: key, val: val})
    }
    return out
}
```

Every byte advances the decoder. There is no path that consumes zero bytes (which would loop forever). Truncated tails are silently dropped.

### Pitfall: the decoder must not panic

If `decode` panics on any input, the fuzzer reports the decoder bug, not your system. Test the decoder itself with a quick fuzz target that just decodes and discards.

### Pitfall: too sparse an encoding

If the fuzzer must hit specific magic bytes to reach an interesting op, it wastes effort discovering them. Make every value of every byte meaningful.

---

## Workflow: local fuzzing in practice

A developer-friendly local workflow looks like this.

```
# Step 1: Run the seed corpus quickly.
go test ./pkg/parser

# Step 2: Run with the race detector.
go test -race ./pkg/parser

# Step 3: Active fuzz for a minute.
go test -run=^$ -fuzz=FuzzParse -fuzztime=60s -race ./pkg/parser

# Step 4: Inspect any failures.
ls pkg/parser/testdata/fuzz/FuzzParse/

# Step 5: Re-run the specific reproducer.
go test -run=FuzzParse/a3f7e1 ./pkg/parser
```

The third step is the heart of it. A minute of fuzzing per touched parser before pushing catches most regressions before they reach CI.

### A makefile target

```make
fuzz-quick:
	go test -run=^$$ -fuzz=FuzzParse  -fuzztime=30s -race ./pkg/parser
	go test -run=^$$ -fuzz=FuzzDecode -fuzztime=30s -race ./pkg/decoder

fuzz-long:
	go test -run=^$$ -fuzz=FuzzParse  -fuzztime=10m -race ./pkg/parser
	go test -run=^$$ -fuzz=FuzzDecode -fuzztime=10m -race ./pkg/decoder
```

`make fuzz-quick` before pushing. `make fuzz-long` overnight on a workstation.

### IDE integration

GoLand and VS Code's Go extension expose "Run Fuzz Target" gutter actions. They launch `go test -fuzz` for the selected function with a short `-fuzztime`. Use them for ad-hoc exploration.

---

## Workflow: CI integration

The fuzzer earns its keep when it runs continuously. The seed corpus protects against regressions on every PR; the active fuzzing surfaces new bugs.

### Two CI jobs

**Per-PR (fast):** Run only the seed corpus. `go test -race ./...` is enough — it executes every `FuzzXxx` against committed seeds and saved reproducers. Budget: under 10 minutes total.

**Nightly (slow):** Active fuzzing. One job per fuzz target, each `-fuzztime=10m -race`. The matrix runs in parallel.

```yaml
# .github/workflows/fuzz-nightly.yml (sketch)
jobs:
  fuzz:
    strategy:
      matrix:
        target:
          - { pkg: ./pkg/parser, fn: FuzzParse }
          - { pkg: ./pkg/decoder, fn: FuzzDecode }
          - { pkg: ./pkg/queue, fn: FuzzQueueConcurrent }
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - run: go test -run=^$ -fuzz=^${{ matrix.target.fn }}$ -fuzztime=10m -race ${{ matrix.target.pkg }}
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: fuzz-failure-${{ matrix.target.fn }}
          path: ${{ matrix.target.pkg }}/testdata/fuzz/
```

When a nightly job fails, the failure artifact contains the new reproducer. Open a PR that adds it to `testdata/fuzz/`, write the fix, and merge.

### Caching the generated corpus

The generated corpus lives in `$GOCACHE`. CI runners start fresh each run, so they begin with no generated corpus. Two strategies:

1. **Accept the cost.** Each nightly job rebuilds coverage from scratch. Wastes a few minutes but is simple.
2. **Cache `$GOCACHE/fuzz/`.** Upload as an artifact at job end, download at job start. Faster iteration, more complex.

For typical projects, option 1 is fine.

---

## Reading and triaging failures

A fuzz failure prints a stack trace, the offending input as `go test fuzz v1` text, and the path to the saved reproducer file. Triage in three steps:

### Step 1: Reproduce locally

```
go test -run=FuzzParse/<hash> ./pkg/parser
```

If this fails, you have a deterministic reproducer. Move on.

If it does *not* fail, the bug depends on non-determinism (time, RNG, scheduler). Fix that first: remove time dependencies, seed RNGs, run with `-race -count=100` to wash out the variance. A non-reproducible reproducer is useless.

### Step 2: Understand the input

The reproducer is text:

```
go test fuzz v1
[]byte("\x00\x01\x02\x03\x04\x05\x06\x07")
```

Decode it manually using the same logic your fuzz function uses. What operations does it produce? Which goroutines run them? Which lines of code are reached?

For a fuzz that found a race, the race report tells you the two stacks. The reproducer tells you the input. Read both.

### Step 3: Write a focused test

Often the minimised reproducer is still bigger than necessary. Strip it down to the smallest set of operations that reproduces the bug. Promote that to a regular `TestXxx`. Now you have a fast, focused regression test plus the fuzz corpus seed.

---

## Corpus hygiene

The corpus grows. Periodically prune.

### Generated corpus

```
go clean -fuzzcache
```

Clears `$GOCACHE/fuzz/`. Next fuzz run starts cold. Useful when:

- Coverage instrumentation changed across Go versions.
- Your code's basic-block layout changed dramatically (after a refactor).
- The corpus has grown to gigabytes.

### Committed corpus

`testdata/fuzz/FuzzXxx/` should hold only:

- Failing inputs the fuzzer found.
- Hand-curated regression seeds for known historical bugs.

If `testdata/fuzz/FuzzXxx/` grows past a few dozen files, audit it. Many entries reproduce the same bug. Delete duplicates after each is verified to map to a fix.

### Sample directory

`testdata/samples/` (or similar — your choice) holds production-derived seeds. Refresh periodically. Strip sensitive fields. Run a lint pass to confirm no PII or keys leaked in.

---

## Combining with `t.Parallel()`

`t.Parallel()` on the inner `*testing.T` inside a fuzz function tells the test runner this iteration can run in parallel with sibling iterations *within the same worker process*. The fuzzer already parallelises across worker processes. Adding `t.Parallel()` rarely helps and can hurt by sharing CPU.

```go
f.Fuzz(func(t *testing.T, data []byte) {
    t.Parallel() // usually NOT needed inside a fuzz body
    // ...
})
```

When *might* it help? If your fuzz body has long blocking I/O (against a local fake), `t.Parallel()` lets multiple fuzz inputs run while one waits. For CPU-bound or pure-Go fuzz bodies, leave it off.

`t.Parallel()` on a separate `TestXxx` that *replays* fuzz-found inputs is a different story — there it does what you expect.

---

## Common middle-level pitfalls

### Pitfall: cross-iteration state

The fuzz function is called many times. Anything captured by closure is shared:

```go
f.Fuzz(func(t *testing.T, data []byte) {
    // BAD: 'logs' grows across iterations and corrupts results
    logs = append(logs, string(data))
})
```

Reset state inside the fuzz function, or construct it fresh each call.

### Pitfall: non-deterministic invariant

```go
f.Fuzz(func(t *testing.T, data []byte) {
    s := New()
    go s.Run()
    s.Submit(data)
    if !s.Has(data) {  // race: depends on scheduler!
        t.Fatal("submit lost")
    }
})
```

The check happens before `Run` may have processed the submission. Wait deterministically (channel, `WaitGroup`) before asserting.

### Pitfall: assuming the seed runs first

The fuzzer runs seeds in order on startup, but during mutation phase the order is whatever the mutator picks. Do not depend on `f.Add` order.

### Pitfall: too-broad invariants

```go
if !reflect.DeepEqual(out1, out2) {
    t.Fatal("mismatch")
}
```

If `out1` and `out2` legitimately differ — for example, one is a sorted view of a map — every fuzz iteration fails. Express invariants precisely.

### Pitfall: panicking from inside spawned goroutines

A panic in a goroutine started by the fuzz function kills the worker process. The fuzz framework will recover, but the report can be confusing. Either `recover` inside each spawned goroutine, or propagate the panic to the fuzz body explicitly.

### Pitfall: forgetting `-run=^$`

```
go test -fuzz=FuzzParse -fuzztime=1m ./pkg/parser
```

This first runs all `TestXxx` in `./pkg/parser`, *then* starts fuzzing. If unit tests are slow, you wait. Add `-run=^$` to skip them.

### Pitfall: `t.Skip()` flooding logs

If 99% of your inputs trigger `t.Skip()`, the fuzzer wastes effort. Tighten the decoder so more inputs are interesting, or move the skip condition into the decoder so it returns "no operations" without invoking `t.Skip`.

---

## Self-assessment

At middle level you should be able to:

- Write a fuzz target for a concurrent data structure with a meaningful invariant.
- Load real-world seeds from `testdata/samples/`.
- Encode operation sequences into `[]byte` and decode them deterministically.
- Turn a fuzz-found failure into both a committed reproducer and a stress-replay test.
- Configure a nightly CI job that fuzzes each target for ten minutes with `-race`.
- Distinguish a fuzzer bug (in the decoder or harness) from a real bug.
- Argue for or against `t.Parallel()` in a fuzz body for a given workload.
- Explain what a concurrent invariant is to a junior teammate.

---

## Summary

Middle-level concurrent fuzzing is about engineering practice. The basic API does not change — you still use `f.Add` and `f.Fuzz` — but you wrap it in a workflow: seed from real data, encode operation sequences, write meaningful concurrent invariants, replay every failure as a stress test, run a nightly CI matrix, and curate the corpus over time. The race detector is non-negotiable for concurrent fuzz targets. The discipline is what makes the difference between a fuzz target that catches one bug and abandoned, versus one that protects a piece of code for years.
