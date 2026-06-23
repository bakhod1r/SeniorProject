# Concurrent Fuzzing — Optimisation

> Making the fuzzer fast. Reducing per-iteration cost, tuning `-fuzztime`, sharding across CI, managing corpora at scale, and keeping `-race` overhead in check.

## Table of Contents

1. [Why fuzzer speed matters](#why-fuzzer-speed-matters)
2. [Measuring iteration rate](#measuring-iteration-rate)
3. [Reducing per-iteration cost](#reducing-per-iteration-cost)
4. [Allocation reduction](#allocation-reduction)
5. [Goroutine overhead in the harness](#goroutine-overhead-in-the-harness)
6. [Reducing `-race` overhead](#reducing--race-overhead)
7. [Tuning `-fuzztime` and `-fuzzminimizetime`](#tuning--fuzztime-and--fuzzminimizetime)
8. [Sharding across CI](#sharding-across-ci)
9. [Corpus management at scale](#corpus-management-at-scale)
10. [Seed selection](#seed-selection)
11. [Sample optimisation case study](#sample-optimisation-case-study)
12. [Summary](#summary)

---

## Why fuzzer speed matters

A fuzzer that runs at 100,000 iterations/sec is ~100× more likely to find a rare bug in a fixed time window than one that runs at 1,000 iter/sec. The cost of optimising a fuzz target pays off in every subsequent run, every developer's local fuzz session, and every CI invocation.

Faster iteration rate means:

- Bugs find each other faster.
- CI budgets can be smaller for the same coverage.
- Developers will actually run fuzz tests locally because they finish in seconds.

The goal is not to make the fuzz target "fast" in the sense of complete-test-suite optimisation. It is to make *each iteration* cheap enough that mutation can explore a million inputs in minutes.

---

## Measuring iteration rate

The fuzzer prints its progress periodically:

```
fuzz: elapsed: 30s, execs: 312345 (10412/sec), new interesting: 27 (total: 53)
```

`execs/sec` is the per-process iteration rate. With `-parallel=8`, the total throughput is roughly 8× this number.

### Baseline: what is "fast enough"?

- 100,000+ iter/sec per worker: ideal. Pure Go, no allocations, no goroutines.
- 10,000–100,000 iter/sec: good. Light parsing, some allocations.
- 1,000–10,000 iter/sec: acceptable for concurrent harnesses with goroutines.
- < 1,000 iter/sec: investigate. Likely heavy allocation, network, or mutex contention.

With `-race`, divide by 5–10.

### Profiling a fuzz target

`go test` does not expose `-cpuprofile` cleanly during fuzzing because of the multi-process model. Instead, profile a *single-input replay* of a representative seed:

```go
func TestProfileFuzzBody(t *testing.T) {
    f, _ := os.Create("cpu.prof")
    defer f.Close()
    pprof.StartCPUProfile(f)
    defer pprof.StopCPUProfile()
    raw := []byte("...") // a representative input
    for i := 0; i < 10000; i++ {
        fuzzBody(raw) // same code your f.Fuzz callback runs
    }
}
```

Then `go tool pprof cpu.prof`. The hot spots are the same hot spots the fuzzer faces.

---

## Reducing per-iteration cost

The most common per-iteration cost categories:

1. Allocation.
2. Goroutine spawn.
3. `sync.Pool` misuse.
4. `string([]byte)` conversion.
5. `fmt.Sprintf` in hot paths.
6. Logging (anything writing to stderr).

### Allocation

Each `make`, each `append` past capacity, each `string([]byte)`, each interface boxing, costs. The fuzzer runs each cost a million times. Minimise.

```go
// BAD: allocates per iteration
f.Fuzz(func(t *testing.T, data []byte) {
    s := string(data)
    parts := strings.Split(s, ",")
    _ = parts
})

// BETTER: avoid string conversion
f.Fuzz(func(t *testing.T, data []byte) {
    parsePartsBytes(data) // operate on []byte directly
})
```

### Goroutine spawn

A fuzz harness that spawns 4 goroutines per iteration may pay 1–4 microseconds per iteration just on goroutine creation. For a target that should run at 100k/sec, that is the whole budget.

Two strategies:

- **Pre-spawned worker pool.** Construct N worker goroutines once. Each iteration sends a small task through a buffered channel. Workers run until the fuzz session ends.
- **Reduce goroutine count per iteration.** 4 goroutines find most concurrent bugs; 32 are usually overkill.

### Worker-pool pattern

```go
var workerPool struct {
    once sync.Once
    in   chan func()
    done chan struct{}
}

func ensureWorkerPool(n int) {
    workerPool.once.Do(func() {
        workerPool.in = make(chan func(), n)
        for i := 0; i < n; i++ {
            go func() {
                for fn := range workerPool.in {
                    fn()
                    workerPool.done <- struct{}{}
                }
            }()
        }
    })
}

f.Fuzz(func(t *testing.T, data []byte) {
    ensureWorkerPool(4)
    ops := decode(data)
    for _, op := range ops {
        op := op
        workerPool.in <- func() { runOp(op) }
    }
    for range ops {
        <-workerPool.done
    }
})
```

Trade-off: the pool persists state across iterations. You must ensure each iteration constructs the SUT fresh and never relies on the pool's state.

### String / byte conversions

Go's `string([]byte)` and `[]byte(string)` allocate. The compiler optimises some cases (e.g. `m[string(b)]` for map lookup), but most cases allocate. Audit hot loops.

---

## Allocation reduction

A fuzz body that allocates 10 bytes per iteration at 100,000 iter/sec is 1 MB/sec of garbage. The GC keeps up, but the fuzzer slows. Aim for zero allocations per iteration where feasible.

### Use `sync.Pool` carefully

```go
var bufferPool = sync.Pool{
    New: func() any { return make([]byte, 0, 256) },
}

f.Fuzz(func(t *testing.T, data []byte) {
    buf := bufferPool.Get().([]byte)
    defer func() {
        bufferPool.Put(buf[:0])
    }()
    _ = doSomething(buf, data)
})
```

Caveat: `sync.Pool` is not free. For very short-lived buffers, on-stack allocation may be faster. Benchmark.

### Reuse slices

Within an iteration, reuse a single slice for all operation lists:

```go
var ops []op // declared at package level; reset each iteration
f.Fuzz(func(t *testing.T, data []byte) {
    ops = ops[:0]
    ops = decodeOpsInto(data, ops)
    // ...
})
```

This is one of the few exceptions to "no cross-iteration state." The slice is *capacity-only* shared; the length is reset.

### Avoid `fmt.Sprintf` in fuzz bodies

`fmt.Sprintf` allocates and parses format strings. In a fuzz body that runs a million times per minute, this is wasted CPU. Use `strconv.AppendInt`, `bytes.Buffer`, or a hand-rolled formatter.

---

## Goroutine overhead in the harness

Spawning a goroutine costs ~1 microsecond on modern hardware. Joining via `sync.WaitGroup` costs another. For a fuzz harness that spawns 4 goroutines per iteration, the floor is ~5 microseconds, or 200,000 iter/sec — before any actual work.

### Strategies

- **Pre-spawned worker pool** (see above).
- **Single-goroutine harness for sequential property checking.** If the SUT is sequential, you do not need goroutines at all.
- **`errgroup.Group`** for cleaner cancellation but same cost as raw goroutines.
- **`sync.WaitGroup` reused.** Constructing a new `WaitGroup` per iteration costs little; reusing one across iterations is fine if you reset before each.

### Avoid `time.Sleep` in fuzz harnesses

Even a 1 ms `Sleep` caps iteration rate at 1000/sec — five orders of magnitude below ideal. Use channels, `WaitGroup`, or pre-known synchronisation, never `Sleep` for "let things settle."

---

## Reducing `-race` overhead

The race detector slows execution 5–15×. For fuzzing, this is usually worth it. But you can keep the overhead manageable.

### Strategy 1: Two-phase fuzzing

Run two separate fuzz jobs:

1. `-fuzz=FuzzXxx -fuzztime=5m` (no `-race`). High iteration rate, finds panics and invariant violations across many inputs.
2. `-fuzz=FuzzXxx -fuzztime=5m -race`. Lower rate, finds races on whatever inputs the race-build can mutate to.

Both share the persistent corpus, so the no-race job's discoveries seed the race job.

### Strategy 2: Shorter iteration budget under `-race`

Under `-race`, each iteration costs more. Reduce per-iteration work:

- Spawn fewer goroutines (2–4 instead of 8–16).
- Run fewer operations per iteration (16 instead of 32).
- Use smaller input bound caps.

The race detector still catches races on smaller inputs; it just runs many more of them.

### Strategy 3: Avoid `-race` in tight loops

If your fuzz function spawns thousands of goroutines per iteration, even one iteration may take seconds under `-race`. Cap the loop:

```go
n := int(data[0])
if n > 8 {
    n = 8
}
```

8 goroutines is enough to find most concurrency bugs; 800 just slows the detector.

### Strategy 4: Memory bound checks

`-race` uses ~5–10× more memory than the base build. Workers may OOM. Set process limits and adjust `-parallel` downward if needed.

---

## Tuning `-fuzztime` and `-fuzzminimizetime`

### `-fuzztime`

| Setting | When to use |
|---------|-------------|
| `10s`   | Smoke test before pushing |
| `30s`   | Quick local exploration |
| `5m`    | Reasonable per-PR check |
| `10m`   | Nightly CI per target |
| `1h`    | Pre-release validation |
| `24h`   | Critical security code |
| (unlimited) | OSS-Fuzz-style continuous fuzzing |

For most teams, `10m` per nightly target is the sweet spot: long enough to discover meaningful coverage, short enough that the CI matrix completes before morning.

### `-fuzzminimizetime`

Minimisation budget. The default `60s` is reasonable. Increase to `5m` if your inputs are large and minimisation matters; decrease to `10s` if you do not care about minimal reproducers and want to maximise mutation time.

`-fuzzminimizetime=0x` disables minimisation entirely — useful when triaging known issues where the input shape is already understood.

### Iteration-count vs duration

```
-fuzztime=10000x
```

Equal-budget across runs. Useful for benchmarking iteration rate across changes. Use `10000x` to compare "before and after my fuzz target change."

---

## Sharding across CI

A single `go test -fuzz` runs `GOMAXPROCS` workers. To use more parallelism, shard at the CI level.

### Shard by target

One CI job per fuzz target. Easy and effective. Each job runs `go test -fuzz=FuzzXxx -fuzztime=10m -race`. The matrix runs in parallel.

### Shard by seed subset

If a single target has thousands of seeds, split them across multiple CI jobs. Each job loads a subset:

```go
func FuzzParseShard(f *testing.F) {
    shard := os.Getenv("FUZZ_SHARD")
    patterns := map[string]string{
        "a": "testdata/samples/[abc]*.bin",
        "b": "testdata/samples/[def]*.bin",
        "c": "testdata/samples/[ghi]*.bin",
    }
    matches, _ := filepath.Glob(patterns[shard])
    for _, p := range matches {
        b, _ := os.ReadFile(p)
        f.Add(b)
    }
    f.Fuzz(/* ... */)
}
```

Each CI matrix entry sets `FUZZ_SHARD=a`, `b`, or `c`. Discovery is independent per shard, but they share the committed corpus.

### Combine corpora at end

After each shard runs, archive its generated corpus. A periodic merge job downloads all shards' corpora and uploads a combined corpus as the seed for future runs.

```yaml
- run: go test -run=^$ -fuzz=^FuzzXxx$ -fuzztime=10m -fuzzcachedir=$HOME/corpus -race
- uses: actions/upload-artifact@v4
  with:
    name: corpus-${{ matrix.shard }}
    path: $HOME/corpus
```

---

## Corpus management at scale

A successful fuzzing program generates large corpora. Manage them deliberately.

### Generated corpus

- Cleared with `go clean -fuzzcache`. Useful when:
  - Upgrading Go.
  - The corpus has grown to gigabytes.
  - Internal coverage instrumentation has changed.
- Per-package, per-target. Use `-fuzzcachedir` to share across CI runs.

### Committed reproducers

- Stored under `<package>/testdata/fuzz/FuzzXxx/`.
- Each file represents a once-found-failure that the team has fixed.
- Periodically audit: if a reproducer covers a code path that no longer exists, delete it.

### Curated samples

- Stored under `<package>/testdata/samples/` (your convention).
- Real-world inputs to bootstrap the seed corpus.
- Refresh periodically. Strip PII and sensitive data.

### Size targets

- `testdata/fuzz/FuzzXxx/`: typically < 100 entries per target. Each entry should map to a fixed bug.
- `testdata/samples/`: 100–1000 entries. Curated, representative.
- `$GOCACHE/fuzz/...`: bounded by `go clean -fuzzcache` and CI cache eviction. Can reach gigabytes.

---

## Seed selection

The seed corpus is the fuzzer's launchpad. A good seed reaches deep coverage; a bad one wastes mutation budget.

### Selection criteria

- **Diversity.** Cover as many distinct code paths as possible. Use coverage reports to verify.
- **Minimality.** Smaller seeds mutate faster and produce smaller reproducers.
- **Realism.** Real-world inputs explore code that random bytes would not.
- **Boundary cases.** Empty input, single byte, maximum length, all-zero, all-0xff.

### Selecting from a corpus

When you have 10,000 candidate seeds but `f.Add` can hold only a few hundred efficiently, prune:

1. Run all 10,000 with coverage instrumentation enabled.
2. Greedy-select: pick the input that covers the most unseen edges; repeat until all edges are covered.
3. The minimal covering set is your seed corpus.

This is a manual coverage-minimisation pass. The native fuzzer does not provide it; tools like `dvyukov/go-fuzz-corpus` and OSS-Fuzz infrastructure do.

### Seeding from production

A pipeline that captures (sanitised) production inputs and feeds them to `testdata/samples/` is the gold standard. Each new release has fresh corpora; coverage tracks real usage patterns.

---

## Sample optimisation case study

### Baseline target

```go
func FuzzParseRequest(f *testing.F) {
    f.Add([]byte("GET / HTTP/1.1\r\nHost: x\r\n\r\n"))
    f.Fuzz(func(t *testing.T, data []byte) {
        req, err := ParseRequest(data)
        if err != nil {
            return
        }
        out := req.Format()
        req2, err := ParseRequest([]byte(out))
        if err != nil {
            t.Fatal(err)
        }
        if !reflect.DeepEqual(req, req2) {
            t.Fatal("round-trip")
        }
    })
}
```

Initial measurement: 3,200 iter/sec under `-race`. Profile shows:

- `string([]byte)` conversion in `out := req.Format()` — 22% of time.
- `reflect.DeepEqual` — 14% of time.
- Repeated `regexp.Compile` inside `ParseRequest` — 19% of time.

### Optimisations applied

1. Cache the regex at package level: `var headerRE = regexp.MustCompile(...)`. Eliminates 19%.
2. Replace `reflect.DeepEqual` with a custom equality function specialised for the `Request` type. Saves 12%.
3. Have `Format` write to a reusable `bytes.Buffer` instead of returning a string. Saves 18%.

### Result

Iteration rate: 9,800 iter/sec under `-race`. 3× speedup. Same coverage, same invariants, same corpus.

### Takeaway

Profiling identifies the easy wins. Most fuzz targets have at least one 2–3× speedup available within an hour of work.

---

## Summary

Optimising fuzz targets is engineering work with high payoff. The cost is paid once; the benefit accrues forever. Aim for at least 10,000 iter/sec under `-race`; pursue 100,000+ when feasible. Reduce allocations, use worker pools instead of per-iteration goroutine spawn, cap loop bounds derived from input, and profile representative replays to find the hot spots. Tune `-fuzztime` to a budget that fits CI windows. Shard fuzz targets across CI jobs for near-linear speedup. Curate seed corpora deliberately. Manage `$GOCACHE/fuzz/` with periodic cleans. The discipline pays for itself the first time the fuzzer finds a race in seconds instead of hours.
