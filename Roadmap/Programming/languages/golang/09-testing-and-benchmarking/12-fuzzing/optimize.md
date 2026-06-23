---
layout: default
title: Fuzzing — Optimize
parent: Native Fuzzing
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/12-fuzzing/optimize/
---

# Fuzzing — Optimize

[← Back](../)

This page is about getting *more bugs per CPU-minute* out of a Go native fuzz target. Fuzzing is an embarrassingly parallel search problem with a long tail; the optimizations below either widen the search front, reduce wasted cycles, or improve the signal the fuzzer uses to prioritize inputs.

## 1. Budget the time you have

A fuzz run has three timing dimensions:

| Flag | Default | What it controls |
|------|---------|------------------|
| `-fuzztime` | unlimited | Total wall time for the fuzz mode |
| `-fuzzminimizetime` | 1m | Per-failure shrinking budget |
| `-timeout` | 10m | Per-input timeout (an input that runs longer is treated as a hang) |

A reasonable PR pipeline:

```
go test -run=^$ -fuzz=FuzzParseURL -fuzztime=2m -fuzzminimizetime=10s ./...
```

A nightly pipeline:

```
go test -run=^$ -fuzz=FuzzParseURL -fuzztime=4h -fuzzminimizetime=2m ./...
```

The PR run is a smoke check that the fuzz target compiles and replays the saved corpus quickly. The nightly run is the real search. Splitting the budget this way avoids the trap of "we fuzz on every PR for ten minutes and never find anything," which gives a false sense of coverage.

## 2. Parallelism: where the CPU goes

`go test` defaults `-parallel` to `GOMAXPROCS`. Inside the fuzz engine, parallel workers run the fuzz body on independent inputs from independent goroutines, sharing only the coverage map. On a 16-vCPU CI runner with `-parallel=16` you will see roughly 16× the inputs-per-second of a serial run, minus contention on the coverage map and minus any locking inside the fuzz body itself.

Practical guidance:

- Do not artificially cap `-parallel` below the number of available cores in a fuzz job — there is no other work to share with.
- Avoid `t.Parallel()` inside the fuzz body. The engine already parallelizes across inputs; `t.Parallel()` inside one input is at best a no-op and at worst confuses the runner.
- If your fuzz target uses a global mutex (a shared cache, a logger), the fuzz body will serialize across workers. Refactor to per-call state.

## 3. Make the fuzz body fast

A target running 1000 inputs/second discovers ten times more bugs than a target running 100 inputs/second over the same wall time. Profile the fuzz body itself.

```go
func FuzzExpensive(f *testing.F) {
    f.Fuzz(func(t *testing.T, b []byte) {
        // Avoid one-time setup here — hoist it.
        _ = Parse(b)
    })
}
```

Hoist setup out of the fuzz body:

```go
var schema = mustLoadSchema()

func FuzzCheap(f *testing.F) {
    f.Fuzz(func(t *testing.T, b []byte) {
        _ = schema.Validate(b)
    })
}
```

Reuse buffers via `sync.Pool` if the fuzz body allocates large temporary slices. Be careful: pooled buffers must be reset, or you reintroduce the hidden-shared-state class of bugs you read about in `find-bug.md`.

## 4. Pick seeds that maximize early coverage

A good seed corpus dramatically reduces time-to-first-bug because the mutator starts in interesting regions of input space.

Strategies:

- **Real production samples**: capture a few representative inputs from logs (sanitized) and `f.Add` them. These hit deep code paths immediately.
- **Boundary values**: include empty input, single-byte input, the maximum size your code claims to support, and inputs that hit each branch of your top-level dispatcher.
- **Known good and known bad**: include at least one input that successfully parses end-to-end and one that fails early. This gives the mutator both "valid-shaped" and "almost-valid" starting points to splice.
- **Diverse formats**: if your parser accepts JSON, YAML, and TOML, seed all three.

## 5. Reuse the GOCACHE corpus

The fuzz engine maintains a working corpus under `$GOCACHE/fuzz/<pkg>/FuzzXxx/`. This corpus persists across runs *on the same machine*. On a long-lived CI runner you can warm this corpus and avoid rediscovering the same coverage on every run.

Two strategies:

- **Persistent runner with cache mount**: in GitHub Actions, mount `~/.cache/go-build` as a cache key keyed on the fuzz target hash. Subsequent runs start where the last one ended.
- **Promote-to-repo workflow**: periodically (weekly), run a long fuzz session, then check the corpus diff. Notable inputs that survived minimization are committed to `testdata/fuzz/FuzzXxx/`, which makes them part of every developer's local test suite.

Without one of these, every CI fuzz run starts from scratch and most of the budget is spent rediscovering shape.

## 6. Read the coverage signal

The fuzz engine prints periodic status lines such as:

```
fuzz: elapsed: 3m0s, execs: 1240118 (6889/sec), new interesting: 142 (total: 1342)
```

What to read:

- **execs/sec** tells you how fast the body is. If this is below a few thousand per second, profile the body — you are leaving cycles on the floor.
- **new interesting** is the rate of new corpus entries. Falling to zero means the mutator has saturated. Either widen the seeds, add a dictionary, or accept that more time will not help.
- **total interesting** is your working corpus size. A steadily growing number is good; a flat number for hours is a sign of saturation.

## 7. Dictionary inputs (workaround)

Native Go fuzz does not yet have a first-class dictionary flag the way libFuzzer does. The equivalent is to seed the corpus with magic tokens:

```go
func FuzzHTTPRequest(f *testing.F) {
    for _, m := range []string{"GET", "POST", "DELETE", "OPTIONS", "PATCH"} {
        f.Add([]byte(m + " / HTTP/1.1\r\nHost: x\r\n\r\n"))
    }
    f.Fuzz(func(t *testing.T, b []byte) {
        _, _ = http.ReadRequest(bufio.NewReader(bytes.NewReader(b)))
    })
}
```

The mutator preserves byte sequences from seed inputs across mutations, so seeding with magic tokens functions as a poor-man's dictionary.

## 8. Avoid expensive failure paths

If your code under test panics with a stack trace that walks a deep call graph, each failure costs the engine many milliseconds. If you expect a lot of failures during exploration, consider catching panics inside the fuzz body, recording them, and continuing — but only if your goal is to enumerate distinct crash sites, not to fail fast.

For the normal case (find one bug, fix it) leave panics propagating: the engine handles them efficiently and saves the input.

## 9. Minimization tuning

Default `-fuzzminimizetime=1m` is fine for human use. In CI consider:

- `-fuzzminimizetime=0` to skip minimization entirely — the saved input is whatever caused the crash, possibly large. Good for "fail fast and let me reproduce locally."
- `-fuzzminimizetime=10s` is a fair compromise.
- `-fuzzminimizetime=5m` for a once-a-week nightly run that produces nicer, smaller saved inputs.

## 10. Splitting one fuzz target into many

If your parser has multiple entry points (`ParseHeader`, `ParseBody`, `ParseFooter`), do not fuzz the umbrella `Parse` only. Add a separate `FuzzHeader`, `FuzzBody`, `FuzzFooter`. Why:

- Each smaller target has a tighter input space, so the mutator concentrates.
- Failures localize to one component, which speeds triage.
- You can budget time per target by criticality.

The cost is a little duplication in test scaffolding, which is acceptable.

## 11. CI: split fuzz from unit tests

Run fuzz in a separate job that does not block PR merge unless it finds a *new* failure. Reasons:

- Fuzz is non-deterministic; failing the build on a flaky finding is bad UX.
- Long fuzz runs in the critical path slow developer feedback.
- You want a separate budget for "fuzz time" you can scale up nightly.

The two-job pattern:

```yaml
unit-test:
  steps:
    - run: go test ./...           # includes seed corpus replay, ~seconds
fuzz:
  needs: unit-test
  if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
  steps:
    - run: go test -run=^$ -fuzz=FuzzParse -fuzztime=4h ./...
```

## 12. Corpus hygiene

Over time `testdata/fuzz/FuzzXxx/` accumulates entries. Some are duplicates after a refactor (the same input no longer triggers anything). To keep the directory healthy:

- Periodically run `go test ./...` and observe runtime. If the seed corpus phase takes more than a few seconds, it has grown too large.
- Manually remove entries that are no longer associated with a known regression. Keep one entry per fixed bug, labelled in the filename if you adopt a naming convention.
- Do not delete entries blindly — they are your regression net.

## 13. Combining `-race` with `-fuzz`

`go test -race -fuzz=FuzzXxx` finds data races inside the fuzz body and the system under test. The overhead is significant — roughly 5–10× slower per input. Recommendation: include a `-race` fuzz job in the nightly pipeline but not on PRs.

## 14. Memory budget

Fuzz bodies that allocate large amounts of memory per input can OOM the CI runner. If your parser accepts a length-prefixed payload, the mutator will eventually generate a "10 GB allocation requested" input. Defenses:

- Cap allocations inside the parser (every parser of untrusted input must do this anyway).
- Set `GOMEMLIMIT` for the fuzz job to a reasonable fraction of the runner's RAM.
- Use `t.Skip()` early for obviously oversized inputs in the fuzz body. This is a stopgap; the real fix is bounding inside the parser.

## 15. Profile the fuzz body

Yes, you can profile it. Run a short fuzz session with `-cpuprofile`:

```
go test -run=^$ -fuzz=FuzzParse -fuzztime=30s -cpuprofile=cpu.prof ./mypkg
```

The resulting profile shows where time is spent across mutator, coverage instrumentation, and the body itself. If the body dominates, the body is your optimization target. If instrumentation dominates, your code is already very tight and further fuzzing-side tuning has limited returns.

## 16. Summary checklist

When you are asked to "make this fuzz target faster" by your team lead, work through the checklist:

1. Time the seed corpus replay — should be milliseconds.
2. Measure `execs/sec` for the fuzz run — target several thousand per second for a small parser.
3. Confirm `-parallel` equals available cores.
4. Inspect seed corpus for diversity.
5. Profile the body and remove any per-input allocations or I/O.
6. Persist GOCACHE on CI between runs.
7. Split umbrella targets into per-entry-point targets.
8. Run the actual fuzz session for an *order of magnitude* longer than you think you need.

The last point is worth dwelling on. Native fuzzing is a search problem with a heavy-tailed distribution of time-to-bug. Many bugs that take ten minutes are followed by bugs that take ten hours. The cheapest optimization is usually "fuzz longer," not "fuzz faster."

[← Back](../)
