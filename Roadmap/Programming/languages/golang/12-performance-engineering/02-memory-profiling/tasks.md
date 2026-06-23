# Memory Profiling in Go — Hands-on Tasks

Work through these in order. Each task has explicit acceptance criteria. Use Go 1.22+; later versions are fine.

---

## Task 1: Your first heap profile

Write a small program that allocates and retains 1,000 slices of 1 KiB each, then captures a heap profile to a file.

**Acceptance criteria**
- [ ] You call `runtime.GC()` immediately before `pprof.WriteHeapProfile`.
- [ ] `go tool pprof -top heap.pb.gz` shows your allocation site near the top.
- [ ] You open the same file with `go tool pprof -http=:8080 heap.pb.gz` and locate the site in the flame graph.
- [ ] You can describe in one sentence why `runtime.GC()` was called before profiling.

---

## Task 2: `inuse_*` vs `alloc_*`

Modify the program from Task 1 so it allocates and **discards** 10,000 slices of 1 KiB each (no retention).

**Acceptance criteria**
- [ ] `pprof -inuse_space` shows little to no contribution from your allocation site.
- [ ] `pprof -alloc_space` shows the full 10 MiB allocated through your site.
- [ ] You write a one-paragraph explanation of what each metric measures.
- [ ] You repeat with `inuse_objects` and `alloc_objects` and confirm both views.

---

## Task 3: Profile from an HTTP server

Take any small Go web server (or write one) and add `import _ "net/http/pprof"` plus a goroutine listening on `127.0.0.1:6060`.

**Acceptance criteria**
- [ ] `curl http://localhost:6060/debug/pprof/heap > heap.pb.gz` produces a non-empty profile.
- [ ] `go tool pprof http://localhost:6060/debug/pprof/heap` opens the interactive shell.
- [ ] You repeat with `?gc=1` and observe a slightly smaller `inuse_space` total.
- [ ] You verify the port is bound to localhost (`netstat -an | grep 6060`) and not exposed publicly.

---

## Task 4: Benchmark with `-benchmem`

Write a benchmark for a function that builds a string via `+=`:

```go
func BenchmarkConcat(b *testing.B) {
    parts := []string{"alpha", "beta", "gamma", "delta", "epsilon"}
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        var s string
        for _, p := range parts {
            s += p
        }
        _ = s
    }
}
```

**Acceptance criteria**
- [ ] `go test -bench=. -benchmem` reports `B/op` and `allocs/op`.
- [ ] You rewrite the body using `strings.Builder` with `Grow` and confirm `allocs/op` drops.
- [ ] You run both versions with `-count=10`, capture the output, and run `benchstat baseline.txt new.txt`.
- [ ] You can explain why the `+=` version allocates per concat.

---

## Task 5: Subslice retention leak

Write a function `func header(path string) []byte` that reads a file and returns `raw[:100]`.

**Acceptance criteria**
- [ ] Write a benchmark that calls `header` 100 times on a 10 MiB file. Profile with `-memprofile`.
- [ ] `pprof -inuse_space` shows ~1 GiB retained via `os.ReadFile`'s allocation site.
- [ ] Change `header` to `slices.Clone(raw[:100])` and confirm `inuse_space` stays flat across iterations.
- [ ] Add a one-line comment in the code explaining the cause.

---

## Task 6: Diff two profiles

Run a program that allocates a fixed working set, then capture two heap profiles 30 seconds apart with no changes to the workload in between.

**Acceptance criteria**
- [ ] `go tool pprof -base p1.pb.gz -http=:8080 p2.pb.gz` opens cleanly.
- [ ] The diff `top` view is near-empty (the working set didn't grow).
- [ ] You then induce a slow leak (a global slice you `append` to in a goroutine), take two more profiles, and the diff *clearly* identifies the leaky site.
- [ ] You write a short note explaining when you would prefer a diff over a single profile.

---

## Task 7: Lower `MemProfileRate` for a test

Pick a function that allocates many small (<512 B) objects. Profile it once with the default `MemProfileRate` and once with `runtime.MemProfileRate = 1`.

**Acceptance criteria**
- [ ] The default-rate profile under-reports your function's allocation count.
- [ ] With `MemProfileRate = 1`, the count matches `runtime.MemStats.Mallocs` deltas.
- [ ] You confirm via `go test -memprofile=mem.out -memprofilerate=1`.
- [ ] You write one sentence explaining why this setting must not be left on in production.

---

## Task 8: Spot the interface boxing

Construct a snippet where a hot loop calls a function that takes `any`:

```go
type Counter struct{ n int }
func report(v any) { _ = v }

for i := 0; i < 1_000_000; i++ {
    report(Counter{n: i})
}
```

**Acceptance criteria**
- [ ] A heap profile shows `runtime.convT*` (the boxing helper) at the top of `alloc_objects`.
- [ ] You confirm via `go build -gcflags="-m"` that the conversion escapes.
- [ ] You rewrite `report` to accept `Counter` directly, or to be generic, and the profile no longer shows boxing.
- [ ] You bench both versions with `-benchmem` and compare `allocs/op`.

---

## Task 9: Sync.Pool that helps (and one that doesn't)

Build two HTTP handlers: one allocates a 4 KiB scratch buffer per request, one uses `sync.Pool`. Drive both with `hey -n 100000 -c 100`.

**Acceptance criteria**
- [ ] The pooled version's `pprof -alloc_objects` profile shows roughly 10× fewer allocations at the buffer site.
- [ ] Change the workload to allocate a 64 MiB buffer per request and observe that the pool now retains 64 MiB per slot indefinitely.
- [ ] Add a cap-based discard in `defer Put` (`if buf.Cap() < 64<<10 { ... }`) and verify residency drops.
- [ ] Write a paragraph on when pooling helps and when it hurts.

---

## Task 10: Continuous heap profiling at home

Set up a local Pyroscope (or Parca) server with their official Docker image. Wire the agent into a Go program of yours.

**Acceptance criteria**
- [ ] The Pyroscope UI shows your application's heap profile updating over time.
- [ ] You can pull a flame graph for "the last 10 minutes" and "the last 5 minutes".
- [ ] You change the workload mid-run (e.g., increase request rate) and see the change reflected in the per-window flame graphs.
- [ ] You take a diff between two windows in the UI and identify what grew.

---

## Task 11: Spot the goroutine-driven heap leak

Spawn 1,000 goroutines that each capture a 1 MiB slice in a closure and block forever on a channel send.

**Acceptance criteria**
- [ ] `runtime.NumGoroutine()` reports >1,000.
- [ ] `/debug/pprof/goroutine?debug=2` shows them stuck on the channel send.
- [ ] `pprof -inuse_space` shows ~1 GiB retained, with the stack pointing into your goroutine's closure.
- [ ] You fix with a `context.Context` and confirm both goroutine count and live heap return to baseline.

---

## Task 12: Capture an allocation regression in CI

Write a benchmark for a small allocation-sensitive function in your own code. Establish a baseline.

**Acceptance criteria**
- [ ] You can run `go test -bench=BenchmarkX -benchmem -count=10 > baseline.txt`.
- [ ] You introduce a deliberate regression (e.g., add an extra `fmt.Sprintf`) and rerun, capture `new.txt`.
- [ ] `benchstat baseline.txt new.txt` reports a statistically significant `alloc/op` delta.
- [ ] You write a shell snippet that fails (exit nonzero) when `alloc/op` delta exceeds 10% with p < 0.05.

---

## Stretch — Task 13: Allocation-free hot path

Pick a small kernel (parse a binary header, walk a tree, render a tiny template). Optimize it to zero allocations per call.

**Acceptance criteria**
- [ ] `-benchmem` reports `0 B/op` and `0 allocs/op`.
- [ ] You verify with `-gcflags="-m"` that nothing escapes.
- [ ] You document each technique used (preallocated output slice, value receivers, generics instead of `interface{}`, etc.) with a one-line note.
- [ ] You add a CI check that fails if `allocs/op` rises above zero.

---

## Submission

Each task should produce:

1. A short writeup (5–15 lines) of what you observed.
2. The code you ran or modified.
3. The profile output or flame-graph screenshot that backs your conclusions.

The point is not to "complete" the tasks but to internalize the workflow: capture → diff → interpret → fix → verify. Doing them in order builds the muscle memory you need for a real incident.
