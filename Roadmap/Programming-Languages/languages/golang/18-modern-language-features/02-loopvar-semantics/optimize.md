# Loop Variable Semantics (Go 1.22) — Optimization

> Honest framing first: the Go 1.22 loopvar change is *not* a performance feature, and for the vast majority of loops it has zero performance impact — escape analysis keeps non-capturing loop variables in reused stack/register storage, so the generated code is byte-identical to pre-1.22. What is genuinely worth "optimizing" here is twofold: (1) the small set of loops that capture the variable and therefore allocate per iteration, where the question is whether the allocation belongs in the hot path at all; and (2) the *migration workflow* — how you find affected loops, validate them, and adopt the change without churn. Most of the wins below are about avoiding capture in hot paths and running an efficient migration, not about the language change itself.
>
> Each entry states the problem, shows a "before" and "after", and the realistic gain. The closing sections cover measurement and when the right move is to do nothing.

---

## Optimization 1 — Don't capture the loop variable in a hot path

**Problem:** Under 1.22, capturing the loop variable in an escaping closure allocates one variable per iteration. In a hot loop that runs millions of times, those allocations add GC pressure — the same cost the old `v := v` idiom had, now automatic and easy to introduce accidentally.

**Before:**
```go
for _, item := range items { // millions of items
    pool.Submit(func() { process(item) }) // captures item → heap alloc per iter
}
```
Each iteration heap-allocates `item` because the closure escapes into the pool.

**After:**
```go
for _, item := range items {
    pool.Submit(makeTask(item)) // pass by value; no capture of the loop var
}

func makeTask(it Item) func() { return func() { process(it) } }
```
Or pass directly as an argument where the API allows:
```go
for _, item := range items {
    item := item            // only if you must build a closure inline
    _ = item
}
```

**Expected gain:** Eliminates one allocation per iteration in the hot path. On a million-item loop that is a million fewer heap objects and the GC work they imply — often a measurable drop in allocation rate and pause time. Confirm with `-gcflags=-m` (the `moved to heap` line disappears) and a heap profile.

---

## Optimization 2 — Prefer pass-by-argument for goroutines in tight loops

**Problem:** `go func() { use(v) }()` captures `v` and allocates per iteration when it escapes. In a fan-out over a large slice, that allocation rides alongside the goroutine cost.

**Before:**
```go
for _, conn := range conns {
    go func() { handle(conn) }() // capture → per-iteration alloc
}
```

**After:**
```go
for _, conn := range conns {
    go handle(conn) // arguments are copied at the go statement; no capture
}
```
When you need a wrapper:
```go
for _, conn := range conns {
    go func(c Conn) { handle(c) }(conn) // copy via parameter, no loop-var capture
}
```

**Expected gain:** Removes the per-iteration loop-variable allocation. The goroutine still costs what a goroutine costs, but you stop paying an extra heap object per spawn. For high-throughput dispatch loops this trims allocation rate noticeably.

---

## Optimization 3 — Verify non-capturing loops are still zero-cost

**Problem:** Teams sometimes fear that "fresh variable per iteration" means "allocation per iteration" everywhere and pre-emptively rewrite clean loops, adding complexity for no gain.

**Before (defensive rewrite, unnecessary):**
```go
var v int
for idx := 0; idx < len(xs); idx++ {
    v = xs[idx]      // hand-hoisted "to avoid per-iteration variable"
    sum += v
}
```

**After (the natural loop — equally fast):**
```go
for _, v := range xs {
    sum += v         // v does not escape → reused storage, zero cost
}
```

**Expected gain:** No runtime difference — both compile to the same code — but the second is simpler and idiomatic. The real "optimization" is *not* wasting effort defending against a cost that doesn't exist. Prove it: `go build -gcflags=-S` produces identical assembly for the inner loop under both 1.21 and 1.22.

---

## Optimization 4 — Use `-d=loopvar=2` to scope a migration precisely

**Problem:** A migration that audits *every* loop in a large codebase is slow and noisy. Most loops are unaffected (they don't capture), so reviewing them all wastes time.

**Before:** A human reads every loop in the repo looking for capture, or runs a broad grep that over-matches.

**After:**
```bash
go build -gcflags=all=-d=loopvar=2 ./... 2>&1 | grep loopvar > affected-loops.txt
```
The compiler reports only loops whose captured-variable behavior actually changes. The output is the exact, minimal set to review and cover with tests.

**Expected gain:** Turns "audit thousands of loops" into "review the dozens that matter." On a large service this is the difference between a multi-day manual sweep and a focused afternoon.

---

## Optimization 5 — Drop redundant `v := v` after migration (cosmetic, but real)

**Problem:** A codebase that migrated to `go 1.22` still carries hundreds of `v := v` shadows. They add no value, confuse new readers ("why is this here?"), and slightly bloat the source.

**Before:**
```go
for _, tc := range cases {
    tc := tc                 // redundant under go 1.22
    t.Run(tc.name, func(t *testing.T) { t.Parallel(); run(tc) })
}
```

**After:**
```go
for _, tc := range cases {
    t.Run(tc.name, func(t *testing.T) { t.Parallel(); run(tc) })
}
```
Apply with a scripted rewrite, reviewed as a separate cosmetic PR:
```bash
# find candidate shadows for manual review
grep -rEn '^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*) := \1[[:space:]]*$' --include=*.go .
```

**Expected gain:** Cleaner code, lower cognitive load, no behavior change (identical allocation profile). The gain is maintainability, not runtime. **Caveat:** never remove the shadow in files that still build under a < 1.22 directive — there it is load-bearing.

---

## Optimization 6 — Remove obsolete loop-capture linters from CI

**Problem:** After migrating to `go 1.22`, CI still runs `exportloopref`, `scopelint`, or similar loop-capture linters. They scan every file, add wall-clock time, and (if not directive-aware) flag now-correct code, failing builds for the wrong reason.

**Before:**
```yaml
linters:
  enable: [exportloopref, scopelint, ...]
```

**After:**
```yaml
linters:
  disable: [exportloopref, scopelint]
# rely on go vet's directive-aware loopclosure instead
```

**Expected gain:** Shorter lint runs and zero false positives on 1.22 code. `go vet`'s `loopclosure` is version-aware and stays silent on correct 1.22 loops while still catching genuine bugs in any remaining < 1.22 packages.

---

## Optimization 7 — Bump the directive to *fix* latent concurrency bugs, not just to modernize

**Problem:** A service on `go 1.20` has subtle, intermittent bugs in its goroutine-spawning loops that nobody has root-caused — wrong item processed, occasional duplicated work. These are the classic capture bug.

**Before:** Engineers chase the symptom with retries, logging, and defensive copies scattered through the code.

**After:**
```
// go.mod
go 1.22
```
Run the test suite (especially concurrency and table-driven tests). Many of the intermittent bugs simply disappear because the loop variable is now per-iteration.

**Expected gain:** A class of heisenbugs is eliminated by a one-line change — a correctness "optimization" that also removes the scattered defensive code (a follow-up cleanup). Validate with `-d=loopvar=2` to see which loops changed and ensure they have test coverage.

---

## Optimization 8 — Keep the directive bump and cleanup as separate commits

**Problem:** A single mega-PR that bumps the directive *and* strips `v := v` *and* removes linters is hard to review and impossible to bisect if something regresses. Review latency and risk both rise.

**Before:** One PR: "migrate to go 1.22" touching `go.mod`, hundreds of loop bodies, and CI config.

**After:**
```
PR 1: bump go.mod 1.20 → 1.22 only; run full test suite      (behavior change)
PR 2: remove redundant v := v shadows                        (cosmetic)
PR 3: drop obsolete loop-capture linters from CI             (tooling)
```

**Expected gain:** Faster, more accurate review; the behavior change is isolated and bisectable; cosmetic diffs don't obscure the one commit that actually changes semantics. If a regression surfaces, `git bisect` lands on PR 1 directly.

---

## Optimization 9 — Avoid capture entirely with `range`-over-integer for counted loops

**Problem:** A counted loop that builds closures captures the index and allocates per iteration when escaping.

**Before:**
```go
for i := 0; i < n; i++ {
    cbs = append(cbs, func() { record(i) }) // captures i
}
```

**After (when you can avoid capture):**
```go
for i := range n {            // go 1.22 range-over-integer; i is per-iteration
    cbs = append(cbs, makeCB(i)) // pass i by value into a constructor
}
func makeCB(i int) func() { return func() { record(i) } }
```

**Expected gain:** The allocation moves from "per-iteration loop variable on the heap" to "the closure you were going to allocate anyway," and the loop variable itself can stay in a register. `range n` is also clearer for counted loops. Net: one fewer escaping object per iteration when structured this way.

---

## Optimization 10 — Snapshot data, not just the index, to avoid live re-reads

**Problem:** Capturing the (now correctly per-iteration) *index* but reading shared mutable data through it at call time can force the data structure to stay alive and be read late — sometimes with the wrong value, sometimes pinning memory.

**Before:**
```go
for i := range bigSlice {
    later = append(later, func() T { return bigSlice[i] }) // pins bigSlice; reads late
}
```

**After:**
```go
for _, v := range bigSlice {
    v := v // (1.22: implicit) snapshot the value
    later = append(later, func() T { return v })
}
```
Now each closure captures a small value, and `bigSlice` can be collected once the loop is done (if nothing else references it).

**Expected gain:** Smaller captured footprint per closure and the chance for the large backing array to be garbage-collected sooner. In long-lived closure collections this can materially reduce retained heap.

---

## Optimization 11 — Don't restructure hot loops out of fear of the change

**Problem:** A misreading of the change leads to "optimizations" that hurt: converting clean `range` loops to index loops, adding `sync.Pool` for loop variables, or hoisting variables in ways that defeat the compiler.

**Before:**
```go
// "optimized" to avoid per-iteration variables — actually no faster, less clear
buf := make([]byte, 0, 64)
for idx := 0; idx < len(records); idx++ {
    buf = buf[:0]
    encode(buf, records[idx])
}
```

**After (trust the compiler):**
```go
for _, r := range records {
    encode(r)   // r doesn't escape → zero per-iteration cost
}
```

**Expected gain:** None lost, clarity gained. The point is to *not* pay an engineering cost chasing a phantom runtime cost. Measure before optimizing: if `-gcflags=-m` shows no escape, there is nothing to optimize.

---

## Optimization 12 — Make hot-path captures explicit and reviewable

**Problem:** When a hot loop genuinely needs a closure that captures per-iteration data, the allocation is unavoidable — but it should be *visible* and *justified*, not buried.

**Before:** A hot loop quietly captures the loop variable; nobody notices the allocation in review.

**After:** Make the capture explicit and add a benchmark guarding it:
```go
for _, job := range jobs {
    job := job // explicit: yes, we intend a per-iteration capture here
    sched.Add(func() { run(job) })
}
```
```go
func BenchmarkSchedule(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ { schedule(jobs) }
}
```

**Expected gain:** The allocation is documented and tracked by `-benchmem`. If someone later turns the loop into a million-iteration hot path, the benchmark's `allocs/op` makes the cost obvious before it ships.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. For loopvar-related work the useful signals are:

```bash
# Does this loop's variable escape (and thus allocate per iteration)?
go build -gcflags=-m ./... 2>&1 | grep 'moved to heap'

# Is the generated code for a non-capturing loop unchanged across directives?
go build -gcflags=-S ./pkg 2>&1 > before.s   # with go 1.21 directive
# bump go.mod to 1.22, rebuild:
go build -gcflags=-S ./pkg 2>&1 > after.s
diff before.s after.s                         # expect no diff for non-capturing loops

# Allocation cost of a capturing loop:
go test -bench=. -benchmem ./...              # watch allocs/op and B/op

# Enumerate every loop whose behavior changes under the new semantics:
go build -gcflags=all=-d=loopvar=2 ./... 2>&1 | grep loopvar

# Migration validation: run the suite under both directives and diff results.
go test ./...                                 # before and after the bump
```

Track two metrics specifically: allocations per operation in hot loops that capture (the only place the change has runtime cost), and migration review time / regression rate (the workflow cost). A "loopvar optimization" that moves neither is not worth doing.

---

## When NOT to Optimize

The loopvar change is, for almost all code, a no-op at runtime. Resist the urge to "optimize" around it.

- **Non-capturing loops:** leave them alone. They compile to identical code; there is nothing to gain.
- **Cold paths that capture:** a per-iteration allocation in a loop that runs a handful of times is irrelevant. Don't add `makeTask`/`makeCB` indirection for a loop that runs at startup.
- **Readability over micro-allocation:** if eliminating a capture means contorting the code, and the loop is not hot, keep the readable version. Per-iteration allocations are cheap individually.
- **Pre-migration codebases:** don't strip `v := v` or remove loop-capture linters until the module is fully on `go 1.22`; doing so early reintroduces the bug.

Optimize the loopvar dimension only when a profile shows the capture allocation matters, or when a migration's workflow cost (review noise, false-positive linters, mega-PRs) is slowing the team. Otherwise the best move is to bump the directive, delete the obsolete workarounds, and spend the effort elsewhere.

---

## Summary

The Go 1.22 loopvar change has no runtime cost for the loops that dominate real programs: non-capturing loop variables stay in reused storage and generate identical code. The only place it costs anything is a loop that *captures* the variable in an escaping closure — and there the cost is exactly what the old `v := v` idiom paid, one allocation per iteration. So the real optimizations are narrow: keep captures out of hot paths (pass by value, use constructors, prefer `go f(x)`), snapshot values rather than indices to shrink and free retained memory, and *don't* defensively restructure clean loops against a phantom cost. The larger wins are in the migration workflow: use `-d=loopvar=2` to scope the change to the loops that matter, isolate the directive bump from cleanup, drop redundant `v := v` and obsolete loop-capture linters once fully migrated, and treat a directive bump as a way to *eliminate* a class of latent concurrency bugs. Measure with `-gcflags=-m`, `-benchmem`, and an assembly diff before changing anything — and most of the time, the correct optimization is to bump the directive and move on.
