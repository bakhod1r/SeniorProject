# CPU Profiling in Go — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.22+ (1.21+ for any PGO task).

---

## Task 1: First profile from a benchmark

Write a benchmark that calls a function summing 1,000,000 integers. Capture a CPU profile.

**Acceptance criteria**
- [ ] `go test -bench=. -cpuprofile=cpu.out -run=^$` produces `cpu.out`.
- [ ] `go tool pprof cpu.out` opens the interactive shell.
- [ ] `top` shows your sum function with `flat ≈ 100%`.
- [ ] You explain in one sentence why `flat ≈ cum` for this case.

---

## Task 2: Profile a running HTTP server

Build a tiny HTTP server with one handler that hashes the request body 1,000 times (use `crypto/sha256`). Import `_ "net/http/pprof"`.

**Acceptance criteria**
- [ ] You hit the server with `hey -n 1000 -c 10 http://localhost:8080/`.
- [ ] During the load, you capture `go tool pprof http://localhost:6060/debug/pprof/profile?seconds=10`.
- [ ] `top` shows `crypto/sha256` functions dominating.
- [ ] You launch `pprof -http=:8081 cpu.pprof` and view the flame graph.

---

## Task 3: Reading flat vs cumulative

Write a function `outer` that calls `middle` 1000 times. `middle` calls `leaf` 1000 times. `leaf` is a tight CPU loop. Profile.

**Acceptance criteria**
- [ ] `top` shows `leaf` with high flat and high cum.
- [ ] `top -cum` shows `outer` and `middle` at the top (high cum, low flat).
- [ ] You can articulate why the flat column is the right signal for optimization.

---

## Task 4: Diff two profiles

Take a benchmark with `strings.Builder` for string concatenation and write a "before" version using `s += part`. Capture both profiles.

**Acceptance criteria**
- [ ] `benchstat before.txt after.txt` reports a statistically significant ns/op improvement.
- [ ] `go tool pprof -http=:8080 -base=before.pprof after.pprof` shows the `+=` site as a red removal (negative delta).
- [ ] You verify no other functions changed by more than 5%.

---

## Task 5: Use pprof labels

Build an HTTP server with three endpoints (`/fast`, `/slow`, `/spike`). Wrap each handler with `pprof.Do` setting `endpoint` to the route.

**Acceptance criteria**
- [ ] Hit all three endpoints with mixed traffic, capture a 30s profile.
- [ ] `(pprof) tags endpoint` lists all three values.
- [ ] `pprof -tagfocus=endpoint=/slow cpu.pprof` shows only the slow handler's samples.
- [ ] You confirm in writing why labels are propagated across `go func()` only when you pass `ctx`.

---

## Task 6: Detect a "too many goroutines" pattern

Write a program that processes 100,000 items by spawning one goroutine per item.

**Acceptance criteria**
- [ ] The profile shows `runtime.schedule`, `runtime.findrunnable`, `runtime.newproc` taking more than 30%.
- [ ] You refactor to a fixed worker pool of 16 workers.
- [ ] The new profile shows the scheduler functions dropping below 5%, and the actual work appears.
- [ ] You record the speedup with `benchstat`.

---

## Task 7: Replace a hot regex

Write a function that uses `regexp.MustCompile` inside its body to validate strings, called in a loop.

**Acceptance criteria**
- [ ] The profile shows `regexp.Compile` or `regexp/syntax.Parse` at the top.
- [ ] You move compilation to a package-level `var`.
- [ ] The new profile shows the compile functions absent.
- [ ] `benchstat` shows >10× speedup.

---

## Task 8: An "empty profile" mystery

Capture a CPU profile from an HTTP server with zero load.

**Acceptance criteria**
- [ ] The profile is dominated by `runtime.findrunnable` / `runtime.mcall`.
- [ ] You explain in writing why the profile is "empty" — what the profiler captures and doesn't capture.
- [ ] You repeat the capture under load and confirm the runtime idle functions drop.

---

## Task 9: Profile bias and inlining

Write a tiny leaf function `add(a, b int) int { return a + b }` called from a hot loop. Profile twice: once normally, once with `go build -gcflags='all=-l'`.

**Acceptance criteria**
- [ ] Without `-l`, `add` is absent from the profile (inlined into the caller).
- [ ] With `-l`, `add` appears as a distinct frame.
- [ ] You explain in writing the trade-off (clarity vs realism) and why you would never ship with `-l`.

---

## Task 10: Mutex contention in a CPU profile

Build a service that has a single `sync.Mutex` protecting a `map[string]int`, then hit it with 100 concurrent readers.

**Acceptance criteria**
- [ ] The CPU profile shows `sync.(*Mutex).Lock` and `runtime.futex` together at >15%.
- [ ] You also capture the mutex profile (`SetMutexProfileFraction(1)`, then `/debug/pprof/mutex`) and confirm the cache lock is #1.
- [ ] You replace with an `atomic.Pointer[map[...]...]` COW pattern.
- [ ] The new CPU profile shows lock-related functions below 1%.

---

## Task 11: PGO build

Apply PGO to one of your services or benchmarks.

**Acceptance criteria**
- [ ] You capture a representative CPU profile (`default.pgo`).
- [ ] You build with `go build -pgo=auto`.
- [ ] You confirm PGO took effect with `go version -m bin/server | grep pgo`.
- [ ] You run the benchmark before and after PGO and report the speedup with `benchstat`.

---

## Task 12: Continuous profiling integration

Integrate Pyroscope or Parca (either OSS or cloud) into a sample service.

**Acceptance criteria**
- [ ] The service pushes CPU profiles to the backend every 10s.
- [ ] You set `version` and `endpoint` tags via `pprof.Do`.
- [ ] You deploy two versions of the service and view the flame-graph diff in the UI.
- [ ] You write a short note (5–10 lines) on the trade-offs of push vs pull profile collection.

---

## Stretch — Task 13: CPU regression CI gate

Set up a CI job (GitHub Actions, GitLab CI, or local script) that fails on benchmark regressions.

**Acceptance criteria**
- [ ] The job runs `go test -bench=. -count=10 -run=^$` on a representative package.
- [ ] It compares against a `main`-branch baseline using `benchstat`.
- [ ] It fails the build if any benchmark regresses by more than 5% (p < 0.05).
- [ ] You demonstrate the gate by intentionally introducing a regression and observing the build fail.

---

## Submission

Each task should produce:

1. A short writeup (5–15 lines) of what you observed.
2. The code you ran or modified.
3. The profile or benchmark output that backs your conclusions.

These artifacts are what turn "I read about CPU profiling" into "I can debug it in production".
