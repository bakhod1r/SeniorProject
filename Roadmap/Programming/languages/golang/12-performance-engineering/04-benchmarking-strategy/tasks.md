# Benchmarking Strategy — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.22+ (1.24+ for `b.Loop()` tasks).

---

## Task 1: Your first benchmark

Write `Sum(xs []int) int` and a benchmark for it on a slice of length 10.

**Acceptance criteria**
- [ ] `go test -bench=BenchmarkSum -run=^$ -benchmem` reports a finite `ns/op`.
- [ ] You can name `b.N`, `ns/op`, `B/op`, `allocs/op` and describe each in one sentence.
- [ ] You change the slice length to 1000 and observe `ns/op` rising roughly linearly.

---

## Task 2: Catch dead-code elimination

Write the benchmark:

```go
func BenchmarkAdd(b *testing.B) {
    for i := 0; i < b.N; i++ {
        1 + 2
    }
}
```

**Acceptance criteria**
- [ ] The reported `ns/op` is under 1 ns.
- [ ] You add a package-level `var sink int` and assign `sink = 1 + 2`. The new number is meaningfully larger.
- [ ] You disassemble the test binary (`go test -c && go tool objdump -s 'BenchmarkAdd'`) and confirm the addition appears in the inner loop only with the sink.
- [ ] You rewrite using `for b.Loop()` (Go 1.24+) and confirm the work also survives.

---

## Task 3: Compare two implementations with `benchstat`

Implement string concatenation two ways: with `+=` and with `strings.Builder` (preallocated with `Grow`).

**Acceptance criteria**
- [ ] You write `BenchmarkPlus` and `BenchmarkBuilder` over the same input.
- [ ] You run each with `-count=10 -run=^$` and save output to `plus.txt` and `builder.txt`.
- [ ] `benchstat plus.txt builder.txt` produces a comparison with a `p` value.
- [ ] You note in writing whether the delta is statistically significant (`p < 0.05`).

---

## Task 4: Sub-benchmarks for an input-size sweep

Pick a parser (e.g., `json.Unmarshal` into a small struct). Build inputs at sizes 16, 256, 4096, 65536 bytes.

**Acceptance criteria**
- [ ] One `BenchmarkParse` uses `b.Run` to produce four sub-benchmarks.
- [ ] Each calls `b.SetBytes(int64(n))` so output includes `MB/s`.
- [ ] You plot `ns/op` vs size on log-log paper (or in a spreadsheet) and identify the slope.
- [ ] You describe in one sentence what the slope tells you about per-call overhead vs per-byte cost.

---

## Task 5: Parallel benchmark for a shared map

Build two read-mostly maps protected differently: one `sync.RWMutex` around `map[string]int`, one `sync.Map`.

**Acceptance criteria**
- [ ] Each has a `BenchmarkXxx` using `b.RunParallel`.
- [ ] You run with `-cpu=1,2,4,8 -count=10` and observe how `ns/op` changes with concurrency.
- [ ] You report which scales better and at what `-cpu` value the difference becomes significant.
- [ ] You add a write workload (10% writes) and re-run; comment on how scaling changes.

---

## Task 6: Allocation regression budget

Pick a function on a hot path of any small service or library you wrote. Write a benchmark that exercises it with `b.ReportAllocs()`.

**Acceptance criteria**
- [ ] You record the current `allocs/op`.
- [ ] You add a `TestXxxAllocBudget` that calls `testing.Benchmark(BenchmarkXxx)` and `t.Fatal`s if `AllocsPerOp()` exceeds your budget.
- [ ] You deliberately introduce an extra allocation (e.g., a `fmt.Sprintf` in the hot path) and confirm the test fails.
- [ ] You revert and confirm the test passes again.

---

## Task 7: Profile-driven benchmark

Take a small Go service you've written. Generate a CPU profile under realistic load via `/debug/pprof/profile?seconds=30`.

**Acceptance criteria**
- [ ] You run `go tool pprof -top cpu.pprof` and identify the top 3 functions by flat time.
- [ ] For each, you write a benchmark that calls it with inputs shaped like the profile suggests.
- [ ] You collect baseline `-count=10` numbers for all three.
- [ ] You write a short paragraph (5–8 lines) explaining why these specific benchmarks were chosen.

---

## Task 8: Setup bias

Take the benchmark from Task 7 and deliberately introduce setup bias: move the input construction inside the `b.N` loop without `StopTimer`.

**Acceptance criteria**
- [ ] You measure the biased version and the corrected version side by side.
- [ ] You compute the ratio of biased / corrected `ns/op`.
- [ ] You write a comment in the file explaining what was being measured incorrectly.
- [ ] You verify with `-cpuprofile` that the bias was indeed in the setup code, not the function under test.

---

## Task 9: Statistical noise floor

On your normal development machine, run any one benchmark from Task 4 with `-count=30`.

**Acceptance criteria**
- [ ] You compute the coefficient of variation (σ/μ) across the 30 samples.
- [ ] You repeat after pinning the CPU governor to `performance` (Linux) or disabling background apps (macOS).
- [ ] You report the before/after CoV.
- [ ] You explain in one sentence what the smallest detectable improvement on your machine would be.

---

## Task 10: CI integration

Add a GitHub Actions (or GitLab CI) workflow that runs benchmarks on every PR and posts a `benchstat` diff as a comment.

**Acceptance criteria**
- [ ] The workflow checks out the base commit, runs `-bench=. -count=10 -benchmem -run=^$`, saves output.
- [ ] The workflow checks out the head commit, runs the same command, saves output.
- [ ] It runs `benchstat base.txt head.txt` and posts the result.
- [ ] A test PR demonstrates the comment showing up.
- [ ] You write a one-paragraph note about why a self-hosted runner is or isn't worth it for your project.

---

## Task 11: Branch predictor experiment

Write a benchmark that counts elements above 128 in a slice of 1024 ints.

**Acceptance criteria**
- [ ] Run with sorted input (0..1023), random input, and reverse-sorted input.
- [ ] Each run uses `-count=10`.
- [ ] You report the `ns/op` for all three.
- [ ] You explain the variation in one paragraph, referencing branch prediction.
- [ ] You note which input shape matches your production data.

---

## Task 12: PGO-aware benchmark

Build a small program, collect a CPU profile from one workload, and rebuild with `-pgo=profile.pprof`.

**Acceptance criteria**
- [ ] You benchmark a function from that program with and without PGO.
- [ ] You report the delta via `benchstat`.
- [ ] You explain in writing whether the gain matches Go's documented PGO range (2–14%) and why your number falls where it does.

---

## Stretch — Task 13: Zero-allocation kernel

Pick a small kernel (e.g., binary header parser, fixed-format log line writer, ring-buffer push). Drive it to 0 allocs/op.

**Acceptance criteria**
- [ ] Benchmark with `-benchmem` reports `0 allocs/op`.
- [ ] Each technique used (preallocated output buffer, byte-slice in/out, no interfaces, no `fmt.*`) has a comment explaining why.
- [ ] A `TestKernelAllocBudget` test enforces zero allocations in CI.
- [ ] You run `benchstat` against an "easy" version (e.g., the same kernel using `fmt.Sprintf`) and report the delta.

---

## Submission

Each task should produce:

1. A short writeup (5–15 lines) of what you observed.
2. The code you ran or modified.
3. The benchmark or `benchstat` output that backs your conclusions.

These artifacts are what turn "I ran `go test -bench`" into "I can defend a performance claim with data".
