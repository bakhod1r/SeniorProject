# Mutex and Block Profiling — Tasks

Hands-on exercises. Each builds intuition for one aspect of contention profiling. Do them in order; each is small (15–45 min). Write the code, capture the profile, read it, and reason about what you see.

---

## Task 1: Enable and capture both profiles

Write a program with 8 goroutines each incrementing a shared counter behind a `sync.Mutex` 100 000 times. Enable both profiles with `SetMutexProfileFraction(1)` and `SetBlockProfileRate(1)`. After the work completes, write `mutex.pb.gz` and `block.pb.gz` files. Open both with `go tool pprof` and confirm the top stacks point at your goroutine body.

**Goal.** Get the mechanics right: enabling, capturing, opening, reading `top` and `list`.

---

## Task 2: Mutex vs. block profile attribution

Modify Task 1: keep 8 goroutines, but have only **one** of them hold the lock for 100 ms after acquiring it (simulate work with `time.Sleep` while holding the lock — yes, intentionally bad). The other 7 do 1 μs of work each.

Capture both profiles. Note where the top of each points: the mutex profile should blame the slow holder; the block profile should blame the 7 fast goroutines waiting.

**Goal.** Observe the attribution difference firsthand.

---

## Task 3: Sample rate sensitivity

Run Task 1 three times, varying only the block profile rate:

```go
runtime.SetBlockProfileRate(1)       // every event
runtime.SetBlockProfileRate(10_000)  // ~10 μs threshold
runtime.SetBlockProfileRate(1_000_000) // ~1 ms threshold
```

Compare the resulting profiles. How does the recorded total delay change? Which rate is appropriate for production?

**Goal.** Internalise that rate is a noise/cost dial, not an on/off switch.

---

## Task 4: Shrink a critical section

Start with this:

```go
func (s *Store) Get(k string) Value {
    s.mu.Lock()
    defer s.mu.Unlock()
    v := s.cache[k]
    time.Sleep(2 * time.Millisecond) // simulated CPU work
    return v
}
```

Run with 32 concurrent goroutines hitting `Get` for 5 seconds. Capture the mutex profile. Then refactor so the "work" runs **outside** the lock; recapture. Diff with `pprof -base before.pb.gz after.pb.gz` and read the negative numbers.

**Goal.** Use the diff workflow to verify a fix.

---

## Task 5: `Mutex` → `RWMutex` for read-heavy

Build a cache protected by `sync.Mutex` with 32 readers and 1 occasional writer. Capture profiles. Switch to `sync.RWMutex` (readers `RLock`, writer `Lock`). Capture again. Diff. Confirm reader contention drops.

Then make the writer take 100 ms to do its work. Observe how the read profile spikes during writes — writer-preference in action.

**Goal.** Feel both the win and the trade-off of `RWMutex`.

---

## Task 6: Sharding

Implement two versions of a thread-safe `map[string]int`:

1. Single `sync.Mutex` around `map[string]int`.
2. 32 shards, each with its own `sync.Mutex` and inner map.

Benchmark both with 64 goroutines doing mixed Get/Put. Capture the mutex profiles. Read the contention totals; you should see ~16–32× reduction.

**Goal.** Practical sharding pattern; appreciate how `mod shard_count` distributes load.

---

## Task 7: Replace counter mutex with `atomic.Int64`

Take the counter from Task 1. Replace `sync.Mutex` + `int64` with `atomic.Int64`. Benchmark with 64 goroutines for 5 seconds. Capture mutex and CPU profiles. The mutex profile should be empty; the CPU profile should be slightly larger (atomic cost).

**Goal.** When to drop locks entirely; how the trade shows up in profiles.

---

## Task 8: Channel back-pressure

```go
out := make(chan int) // unbuffered
go func() {
    for v := range out {
        time.Sleep(5 * time.Millisecond)
        _ = v
    }
}()
for i := 0; i < 10000; i++ {
    out <- i
}
```

Run with the block profile on (`rate=1`). The producer should be the top of the block profile.

Now change the channel to `make(chan int, 1024)`. Recapture. Then run 8 consumer goroutines instead of 1. Recapture again. Note how the block profile shifts each time.

**Goal.** Channel waits are real; sizing them matters.

---

## Task 9: Continuous profiling diff

Start a long-running version of any of the above. Capture `/debug/pprof/mutex` every 30 seconds for five minutes via a script. Pick two snapshots from different times; diff them with `pprof -base`.

Vary something between captures (e.g., halve the number of goroutines partway through). The diff should reflect the change.

**Goal.** Build the muscle memory of capture-diff-interpret cycles.

---

## Task 10: Copy-on-write with `atomic.Pointer`

Implement a feature-flag store with two APIs: `Get(name string) bool` and `Reload(map[string]bool)`. Use `atomic.Pointer[map[string]bool]` so `Get` never locks.

Benchmark: 100 readers, occasional `Reload`. Mutex profile should be empty. Then implement a `sync.RWMutex` variant; benchmark and profile that. Compare allocation rate, throughput, and contention.

**Goal.** See CoW as a contention eliminator; understand the memory cost.

---

## Task 11: Diagnose a contention bug

You're given a program (write it yourself or take from `find-bug.md` Bug 10 — the thundering-herd cache miss). Capture both profiles. Without reading the source first, identify the bug type purely from the profile shape.

Then read the source and confirm. Apply a fix (e.g., `singleflight.Group`). Verify with a diff.

**Goal.** Practise reading profiles to drive diagnosis.

---

## Task 12: Profile a real service

If you have access to a service you own: enable both profiles at production-safe rates (`100`, `10000`). Wait an hour. Capture profiles. Read the top.

If the top is something you don't recognise (a third-party library, the standard library), `list` it. Document what you find. Decide whether the contention is worth fixing or healthy.

**Goal.** Translate the lab skills to a real codebase. This is where the muscle actually builds.

---

## Task 13: Build a contention-regression test

Write a Go benchmark (`func BenchmarkHot(b *testing.B)`) that exercises a known hot path of yours. Inside the benchmark, enable both profiles at `rate=1` and write the resulting profiles to files. In CI, store these as baseline artefacts.

For the next PR, regenerate and run a `pprof -base` diff. Fail the build if the delta exceeds 20%. Iterate until the workflow is reliable.

**Goal.** Make contention a tracked metric, not a thing you remember to check.

---

## 14. Summary

Contention profiling is a craft, not a doc-read. The exercises above progress from mechanics (Tasks 1–3), through fixes (Tasks 4–7), to channels and CoW (Tasks 8, 10), and finally to operational practice (Tasks 11–13). After completing them, you should be able to capture a profile, read it, propose a fix, verify the fix, and operationalise the workflow without re-deriving anything from scratch.

---

## Further reading
- `runtime/pprof` examples: https://pkg.go.dev/runtime/pprof#example-package
- Practical Go profiling tutorial: https://go.dev/blog/pprof
- `benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
