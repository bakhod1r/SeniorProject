# Optimization Workflow — Tasks

These tasks are practical exercises in the workflow itself. Each one is a small project: build a benchmark, profile the code, identify the hotspot, apply a change, prove the result. Goal is the *process* — most tasks will only ship 5–50 lines of changed code, but each will involve `benchstat`, `pprof`, or both.

For each task, deliver:

1. The benchmark file you wrote.
2. The baseline `benchstat` output.
3. The post-change `benchstat` output, with `p` value.
4. A one-paragraph commit message explaining what changed and why.

---

## Task 1 — Optimize a slow string builder

Given the following function:

```go
func Greeting(names []string) string {
    s := "Hello, "
    for i, n := range names {
        if i > 0 { s += ", " }
        s += n
    }
    return s + "!"
}
```

Write `BenchmarkGreeting` with three input sizes (10, 100, 1000 names). Capture baseline. Apply one optimization. Re-measure. Target: ≥ 10× improvement on the 1000-name case, with allocs/op below 4.

Acceptance: `benchstat` shows statistically significant improvement on all three sizes.

---

## Task 2 — Pre-allocate a result slice

Given the following function, which doubles every value in a slice and returns a new slice:

```go
func Double(xs []int) []int {
    var out []int
    for _, x := range xs {
        out = append(out, x*2)
    }
    return out
}
```

Write a benchmark over sizes 100, 10_000, 1_000_000. Identify how many allocations happen at each size (hint: it grows logarithmically, not constantly). Apply pre-sizing. Re-measure.

Acceptance: post-change `allocs/op` is exactly 1, regardless of size.

---

## Task 3 — CPU profile a real function

Pick any function in your codebase (or write one that computes Fibonacci recursively up to n=35). Wrap it in a benchmark with `-cpuprofile=cpu.out`. Open the profile with `go tool pprof`, run `top10`, `list`, and `web`. Write a short note describing what the profile told you and which line is the hottest.

Acceptance: a paragraph identifying the hot line, with a screenshot or copy-paste of the relevant `pprof` output.

---

## Task 4 — Heap profile a leak

Write a program that intentionally leaks: a goroutine appends to a package-level slice every 100 ms, forever. Run it for 30 seconds with `net/http/pprof` enabled. Capture two heap profiles 20 seconds apart. Use `pprof -base old.pb.gz new.pb.gz` to diff. Identify the leak.

Acceptance: the diffed profile clearly shows the leaking allocation site.

---

## Task 5 — Reduce GC pressure

Given a JSON-encoding HTTP handler:

```go
func handle(w http.ResponseWriter, r *http.Request) {
    msg := buildResponse()
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(msg)
}
```

Run a load test with `wrk` or `vegeta` for 60 seconds at 1000 RPS. Capture `GODEBUG=gctrace=1` output. Apply two changes that reduce GC pressure (suggestion: pool the encoder, pre-allocate a buffer). Re-run the load test.

Acceptance: GC CPU fraction reduces by at least 30%, with no latency regression on p99.

---

## Task 6 — Replace `fmt.Sprintf` in a hot path

Find any code that does `fmt.Sprintf("%d", x)` or `fmt.Sprintf("%s%s", a, b)` in a function that's called many times. Benchmark it. Replace with `strconv.Itoa` or a `strings.Builder`. Re-benchmark.

Acceptance: at least 3× improvement, with `p < 0.05`.

---

## Task 7 — Identify and fix a `sync.Pool` mistake

Read this code:

```go
var pool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func handle(w http.ResponseWriter, r *http.Request) {
    buf := pool.Get().(*bytes.Buffer)
    defer pool.Put(buf)
    _, _ = io.Copy(buf, r.Body)
    process(buf.Bytes())
}
```

What is wrong with this code? (Hint: there are two bugs.) Fix both. Write a benchmark that demonstrates the wins of pooling correctly.

Acceptance: identify both bugs in writing; benchmark shows allocations drop and no incorrect data leaks between requests.

---

## Task 8 — Bisect a performance regression

Take a git history with at least 20 commits. Write a benchmark for some function. Use `git bisect run` with a script that runs the benchmark and exits non-zero if `ns/op` exceeds a threshold. Identify the commit that caused the regression.

Acceptance: a working bisect script and a successful identification of the offending commit (manufactured for the exercise if needed).

---

## Task 9 — Set up a CI benchmark gate

Add a job to your CI configuration that:

1. Runs `go test -bench=. -count=10 -benchmem` on the PR branch and on main.
2. Compares using `benchstat`.
3. Fails the build if any benchmark regresses more than 5% with `p < 0.05`.

Acceptance: a manufactured PR with a deliberate regression fails the gate; an unrelated change passes it.

---

## Task 10 — Apply PGO to a real binary

Pick any non-trivial binary in your project (or a sample HTTP server). Build it normally. Run it under representative load for 60 seconds, capturing a CPU profile. Save the profile as `default.pgo` next to `main.go`. Rebuild with `go build -pgo=auto`. Compare a 60-second load test against the non-PGO version.

Acceptance: measured CPU or latency improvement of at least 2%, with `benchstat` or load-test output showing the delta and `p < 0.05`.

---

## Task 11 — Diagnose a contention bottleneck

Write or find a program with deliberate lock contention: 100 goroutines incrementing a single counter behind a `sync.Mutex`. Benchmark its throughput. Capture a mutex profile (`runtime.SetMutexProfileFraction(1)` then `pprof -mutex`). Replace the mutex with `sync/atomic`. Re-benchmark.

Acceptance: throughput improvement of 5× or more on a multi-core machine, with `benchstat` confirmation.

---

## Task 12 — Find the hidden allocation

Write `BenchmarkParse` for the following function:

```go
func Parse(input string) []string {
    parts := strings.Split(input, ",")
    out := make([]string, 0, len(parts))
    for _, p := range parts {
        if t := strings.TrimSpace(p); t != "" {
            out = append(out, t)
        }
    }
    return out
}
```

Find every allocation. Run with `-gcflags="-m=2"` and `pprof -alloc_objects`. Apply one or more reductions. Document each remaining allocation as either necessary or accepted.

Acceptance: total `allocs/op` falls by at least half. Remaining allocations are listed with one-line justifications.

---

## Task 13 — Write a `PERFORMANCE.md` for a real service

Pick a service you've worked on. Write a `PERFORMANCE.md` containing:

- SLO (latency target, throughput target, achievement window).
- Decomposition of the SLO across components.
- Known hotspots — one paragraph per hot function and why it's shaped as it is.
- A list of "do not change without re-running benchmark X" rules.
- A runbook for RSS climbing, GC CPU high, and goroutine leak.

Acceptance: a document at least 100 lines long with all five sections filled in for a real or representative service. Hand it to a teammate; if they can act on it without asking you questions, the document is done.

---

## Summary

These thirteen tasks cover the core practical skills: writing benchmarks, reading profiles, applying targeted optimizations, gating regressions in CI, applying PGO, diagnosing contention, and documenting work for future maintainers. After completing all of them, you have done one full pass of every step in the optimization workflow — the same steps that, repeated and refined, become the daily practice of performance engineering in Go.

---

## Further reading
- `testing.B` reference: https://pkg.go.dev/testing#hdr-Benchmarks
- `benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
- Russ Cox, PGO in Go 1.21: https://go.dev/blog/pgo
- Damian Gryski, go-perfbook: https://github.com/dgryski/go-perfbook
