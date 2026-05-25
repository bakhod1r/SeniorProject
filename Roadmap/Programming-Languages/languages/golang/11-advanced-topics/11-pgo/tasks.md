# Profile-Guided Optimization (PGO) — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.21+ (1.22+ recommended for the best PGO behavior).

---

## Task 1: Capture a CPU profile from a Go test

Write a small package with at least one CPU-bound benchmark. Capture a profile of the benchmark run.

**Acceptance criteria**
- [ ] You run `go test -run=^$ -bench=. -cpuprofile=cpu.pgo -benchtime=10s ./pkg/yours` successfully.
- [ ] You inspect with `go tool pprof -top cpu.pgo` and identify at least three functions in the top of the profile.
- [ ] You describe in one sentence why a `-benchtime=10s` capture gives more useful data than `-benchtime=1s`.

---

## Task 2: Build with PGO using `-pgo=auto`

Set up a `main` package and place the captured profile alongside it.

**Acceptance criteria**
- [ ] You create `cmd/myapp/main.go` containing the hot function from Task 1.
- [ ] You move the profile to `cmd/myapp/default.pgo`.
- [ ] `go build -pgo=auto ./cmd/myapp` succeeds.
- [ ] `go version -m ./myapp | grep pgo` shows the absolute path of `default.pgo` (not `off`).

---

## Task 3: Bench before/after PGO

Use the same benchmark from Task 1 and run it with and without PGO.

**Acceptance criteria**
- [ ] You run the bench with `-pgo=off` and `-pgo=auto`, each `-count=10 -benchtime=2s`.
- [ ] You use `benchstat baseline.txt pgo.txt` to compute the delta.
- [ ] The delta is statistically significant (`p < 0.05`) **or** you explain why your particular workload doesn't benefit (cgo, reflection, GC-bound, microbench).

---

## Task 4: Inspect inline decisions

Use `-gcflags='-m=2'` to compare inlining decisions between PGO and non-PGO builds.

**Acceptance criteria**
- [ ] You produce `off.txt` and `on.txt` from `go build -gcflags='-m=2' -pgo=off/auto`.
- [ ] You `diff` them and identify at least one function that PGO inlines but the non-PGO build does not.
- [ ] You explain why the compiler made that choice (which call site sample share crossed the budget).

---

## Task 5: Observe devirtualization in `objdump`

Write code with an interface call where one concrete type clearly dominates (e.g., 95 %+ of calls in the benchmark go through `*RedisCache` mock).

**Acceptance criteria**
- [ ] The interface call site exists in your hot path; the bench drives it heavily toward one concrete type.
- [ ] After a PGO build, `go tool objdump -s 'YourHandler'` shows a type-tag check followed by a direct call (rather than a single indirect call).
- [ ] You document the assembly snippet and label the type-check branch.
- [ ] The non-PGO build of the same code shows only the indirect call.

---

## Task 6: Build a profile-refresh script

Write a shell script that captures a profile from a running local server (using `net/http/pprof`) and validates it before overwriting `default.pgo`.

**Acceptance criteria**
- [ ] The script captures via `curl` from `localhost:6060/debug/pprof/profile?seconds=60`.
- [ ] It validates: file size > 10 KiB and `go tool pprof -top -nodecount=1` parses it.
- [ ] On failure, it leaves the existing `default.pgo` untouched.
- [ ] On success, it `mv`s the temp file into place.

---

## Task 7: A/B test PGO impact

Run two versions of the same binary side-by-side (e.g., on two ports) and drive load against both.

**Acceptance criteria**
- [ ] You build `myapp.no-pgo` and `myapp.pgo`.
- [ ] You drive identical synthetic load against each (e.g., `hey -n 100000 -c 50`).
- [ ] You measure throughput (req/s) and median/P99 latency for each.
- [ ] You write up the comparison in 5–10 lines: gain, statistical confidence, any surprises.

---

## Task 8: Merge multiple profiles

Capture three profiles (different times, different load shapes) and merge them.

**Acceptance criteria**
- [ ] You capture `p1.pgo`, `p2.pgo`, `p3.pgo` with at least 30-second windows each.
- [ ] You run `go tool pprof -proto p1.pgo p2.pgo p3.pgo > merged.pgo`.
- [ ] You verify the merged file is approximately the sum of sample counts of the three inputs.
- [ ] You use the merged profile for your next PGO build.

---

## Task 9: Identify a stale profile

Capture a profile, then refactor the code (rename two hot functions). Rebuild with the old profile.

**Acceptance criteria**
- [ ] You rename the functions and the profile is now stale.
- [ ] The PGO build emits a warning about stale samples.
- [ ] You quantify the fraction of stale samples (read the warning or use `go tool pprof -top` to inspect names and cross-reference with the source).
- [ ] You refresh the profile and confirm the warning disappears.

---

## Task 10: Set up CI with PGO

Add a CI job to a small Go project that builds with PGO and verifies via `go version -m`.

**Acceptance criteria**
- [ ] The CI YAML includes a step `go build -pgo=auto`.
- [ ] A subsequent step asserts `go version -m ./bin/app | grep -E 'build\s+-pgo=' | grep -v '=off'`.
- [ ] A failure case (delete `default.pgo`) causes the assertion to fail.

---

## Task 11: Continuous A/B benchmark in CI

Add a CI step that runs your benchmarks in both `-pgo=off` and `-pgo=auto` modes and outputs a `benchstat` diff.

**Acceptance criteria**
- [ ] Two `go test -bench` runs produce `bench-off.txt` and `bench-on.txt`.
- [ ] `benchstat` diff is generated and uploaded as a CI artifact.
- [ ] You include an example artifact (text file) showing a measurable delta.

---

## Task 12: PGO with cgo — observe the floor

Write a Go function that delegates 100 % of its work to a C function via cgo, and verify PGO does nothing useful.

**Acceptance criteria**
- [ ] You write a small cgo-using benchmark whose hot path is a cgo call.
- [ ] PGO build vs no-PGO shows a delta of < 1 % (within noise).
- [ ] You write a one-paragraph explanation referencing the fact that cgo time is C code, not Go code, and PGO only touches the Go side.

---

## Stretch — Task 13: Build a full continuous-profiling-to-PGO pipeline

Pick a continuous profiling tool (Pyroscope, Parca, or similar). Set it up against a local Go service. Build a tool that pulls the merged profile for the last hour and commits it as `default.pgo`.

**Acceptance criteria**
- [ ] You can run `make refresh-pgo` and it pulls a fresh profile.
- [ ] The pulled profile passes validation (`go tool pprof -top` works).
- [ ] You commit it to a sandbox repo and confirm subsequent `go build` uses it.
- [ ] You document the end-to-end flow in 10–20 lines for a teammate to reproduce.

---

## Submission

Each task should produce:

1. A short writeup (5–15 lines) of what you observed.
2. The code, configuration, or script you wrote.
3. The benchmark, profile, or build output that backs your conclusions.

These artifacts are what turn "I read about PGO" into "I can operate it in production."
