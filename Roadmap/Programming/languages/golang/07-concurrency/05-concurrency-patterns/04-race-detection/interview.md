# Race Detection — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes. Topics span the Go memory model, the `-race` flag, ThreadSanitizer internals, atomics, and CI integration.

---

## Junior

### Q1. What is a data race?

**Model answer.** A data race is the situation where two goroutines access the same memory location, at least one of the accesses is a write, and there is no happens-before relationship between them. The Go memory model declares the result undefined: the program may produce the right answer, the wrong answer, panic, or corrupt memory.

Three ingredients are required:
1. Two or more goroutines.
2. The same memory address.
3. At least one writer, with no synchronisation edge between the accesses.

**Common wrong answers.**
- "A race is when two goroutines run at the same time." (Wall-clock simultaneity is irrelevant; ordering is the issue.)
- "A race is a logic bug." (That is a *race condition*, not a *data race*.)

**Follow-up.** *Why is the result undefined and not just "the last write wins"?* — Because the compiler and CPU are free to reorder loads and stores across unsynchronised regions. There is no defined "last write."

---

### Q2. How do you enable Go's race detector?

**Model answer.** Pass `-race` to any of the three top-level commands:

```bash
go run -race main.go
go test -race ./...
go build -race -o app ./cmd/app
```

The compiler instruments every memory access; the runtime watches for unsynchronised access pairs and prints a report.

**Common wrong answers.**
- "Set `GORACE=1`." (`GORACE` configures the detector once it is enabled, not a switch.)
- "Import `runtime/race`." (The flag does the work; the package only exposes manual annotation hooks.)

**Follow-up.** *What is the runtime cost?* — Roughly 5x to 10x CPU and 2x to 3x memory.

---

### Q3. What is the difference between a data race and a race condition?

**Model answer.** A *data race* is a memory-level bug: two unsynchronised accesses to the same address with at least one writer. A *race condition* is a logic-level bug: program correctness depends on goroutine timing.

You can have one without the other:
- A correctly-locked check-then-act sequence has no data race but still has a race condition (the value can change between check and act).
- A pure data race on a counter is also a race condition (final value depends on interleaving), but the categories are conceptually distinct.

The race detector finds *data races*. Race conditions need careful logic review and stress tests.

**Follow-up.** *Give an example of a race condition without a data race.* — Two goroutines both call `if cache.Has(k) { cache.Delete(k) }` under separate Lock/Unlock pairs. No data race, but both may delete the same key (one of them deleting nothing).

---

### Q4. What output does the race detector produce?

**Model answer.** When `-race` finds a race, it prints to stderr a structured report:

```
==================
WARNING: DATA RACE
Read at 0x... by goroutine 7:
  main.worker()
      main.go:42 +0x...
Previous write at 0x... by goroutine 6:
  main.worker()
      main.go:42 +0x...

Goroutine 7 (running) created at:
  main.main()
      main.go:30 +0x...
Goroutine 6 (finished) created at:
  main.main()
      main.go:30 +0x...
==================
```

Five things to read: the address (same on both sides), the *new* access kind and stack, the *previous* access kind and stack, the goroutine creation stacks, and the goroutine ids.

**Follow-up.** *How do you make the test process exit non-zero on a race?* — `GORACE="halt_on_error=1 exitcode=66" go test -race ./...`.

---

### Q5. Why is `time.Sleep` not a fix for a race?

**Model answer.** `time.Sleep` introduces a wall-clock delay. The Go memory model defines synchronisation in terms of *happens-before edges* — created by channels, mutexes, atomics, sync.Once, WaitGroup, and goroutine start. Wall-clock time is not on that list. Two unsynchronised accesses are still a race even if you put a `Sleep(1*time.Second)` between them. The race may not fire today, but the compiler and CPU are not obliged to honour the delay; the bug remains.

**Common wrong answers.**
- "Sleep gives the other goroutine time to finish." (It does not establish ordering — only *probability* of one ordering.)

**Follow-up.** *What is the actual fix?* — Add a real edge: a channel receive, a `wg.Wait`, a mutex Lock/Unlock pair, or an atomic with proper Load/Store.

---

### Q6. What is the captured loop variable bug?

**Model answer.** In Go versions before 1.22, the loop variable in `for i := 0; i < n; i++` is a single variable shared by all iterations. If a goroutine captures it, every goroutine sees the same address — and the writes to `i` made by the loop race with the reads inside the goroutines.

```go
for i := 0; i < 5; i++ {
    go func() { fmt.Println(i) }() // race + same value printed
}
```

Two fixes:
1. Shadow per iteration: `i := i` immediately inside the loop body.
2. Pass as a parameter: `go func(i int) { ... }(i)`.

In Go 1.22+, `for i := 0; ...` and `for _, v := range ...` create a fresh variable per iteration by default, eliminating the bug.

**Follow-up.** *Does the shadow fix the race or just the logic?* — Both. The shadow makes a new variable per iteration, so the goroutine reads its own copy and the loop never overwrites it.

---

## Middle

### Q7. List five happens-before edges in Go.

**Model answer.** Any of the following pairs:

- A channel send happens-before the matching receive completes.
- A channel close happens-before any receive that observes the close.
- `mu.Unlock()` happens-before the next `mu.Lock()` returns.
- `wg.Done()` happens-before the matching `wg.Wait()` returns.
- `once.Do(f)` happens-before any later `once.Do` returns.
- An `atomic.Store` happens-before any `atomic.Load` that observes the stored value.
- Code before `go f()` happens-before `f` runs.
- Package init happens-before `main` starts.

These are the *only* tools the language provides for cross-goroutine memory visibility.

**Follow-up.** *Does goroutine end happen-before code after the `go f()` call site?* — No. The starter goroutine has no automatic edge from a child's exit. You need `wg.Wait`, a channel receive, or a `Done` signal.

---

### Q8. How does the race detector work under the hood?

**Model answer.** The Go race detector is built on **ThreadSanitizer (TSan)**, originally from Google. The pipeline:

1. The compiler, with `-race`, replaces every memory load and store with a call into the runtime (`__tsan_read1`, `__tsan_write8`, etc.) carrying the address and access size.
2. The runtime maintains a **vector clock** for each goroutine — a vector of integer counters, one per goroutine. Synchronisation events (mutex unlock, channel send, atomic store, sync.Once, WaitGroup) merge or advance clocks.
3. For each memory address, the runtime keeps a short history (typically 4 entries) of recent accesses with their vector clocks.
4. On each access, the runtime compares against the history. If a different goroutine touched the address and its clock is not ordered before the current clock, that is a race — print the report.

Implications: no sampling (every access is checked), CPU cost is per-access (5-10x overhead), memory cost grows with goroutines (cap ~8128).

**Follow-up.** *Why is the goroutine cap ~8128?* — Vector clocks of size N for M goroutines are O(N*M) memory, which the runtime bounds with a hard cap.

---

### Q9. When are atomics enough, and when do you still need a mutex?

**Model answer.** Atomics suffice when the operation touches a single memory cell that fits in one of the supported widths (32 or 64 bits, or a pointer):

- A single counter: `atomic.AddInt64(&n, 1)`.
- A boolean flag: `atomic.StoreBool` or `atomic.Bool`.
- A pointer-swap to publish a new immutable struct: `atomic.Pointer[T]`.

Mutexes are needed when:
- You update multiple fields and the reader must see all of them as one snapshot.
- The "operation" is multi-step (read len, allocate, copy, store) — like `append`.
- You hold invariants that span more than one variable.

Atomics are *atomic per operation*, not per logical unit. Two atomic ops on different fields are not a transaction.

**Follow-up.** *Is `atomic.Value` a substitute for atomic.Pointer[T]?* — `atomic.Value` predates generics; it boxes into an `interface{}` and is type-checked at runtime. `atomic.Pointer[T]` is type-safe, lower overhead, and preferred since Go 1.19.

---

### Q10. What guarantees does `sync.Once` provide?

**Model answer.** `once.Do(f)`:

1. Calls `f` exactly once, even under concurrent invocations.
2. All later calls to `Do` (with any function) block until the first `f` returns.
3. The completion of `f` happens-before the return of any later `Do` call. So writes inside `f` are visible to any goroutine that observes `Do` returning.

This is the canonical lazy-initialisation primitive. Naïve double-checked locking is broken in Go because the unsynchronised "fast path" read can see a partially-constructed object; `sync.Once` fixes this by making the fast path itself synchronised.

**Follow-up.** *What if `f` panics inside `once.Do`?* — `Once` marks itself done. Subsequent calls do nothing — they will not retry. If retry-on-panic is needed, use a custom primitive or `sync/atomic`-based protocol.

---

### Q11. Can the race detector produce a false positive?

**Model answer.** Almost never in practice. The detector reports a race only when it has both stack traces and an unordered clock pair — that is, when two memory accesses really do lack a happens-before edge. A genuine false positive would require a bug in the detector itself.

It *can* over-report by counting one bug as several (each address is reported once, but related bugs hit multiple addresses).

What it does *not* see: races inside cgo, races bypassed by `unsafe` arithmetic, and races in goroutines beyond the ~8128 cap.

**Follow-up.** *So if `-race` says no race, is my code race-free?* — No. False *negatives* are common. The detector only reports what it observes during the run; an unexercised path can hide an arbitrary race.

---

### Q12. Why is `-race` not used in production?

**Model answer.** The instrumentation imposes:

- 5x to 10x CPU slowdown (every memory access becomes a function call).
- 2x to 3x memory overhead (vector clocks plus access history per address).
- A cap of ~8128 tracked goroutines, beyond which detection becomes unreliable.

Production traffic latency budgets and machine costs make this prohibitive. `-race` is for development, CI, and stress-test environments. The release binary is built without it.

Some teams run a `-race`-enabled canary on a small fraction of production traffic for high-stakes services. That is rare and intentional.

**Follow-up.** *Would `-race` slow the runtime in unrelated ways, like GC?* — Indirectly. The extra memory pressure increases GC frequency.

---

## Senior

### Q13. Explain the Go memory model in one minute.

**Model answer.** The Go memory model defines, for a multi-goroutine program, which writes are guaranteed visible to which reads. It does so via a partial order called *happens-before*. If write `W` happens-before read `R`, then `R` is guaranteed to see `W` (or a later write to the same location). Without such an edge, `R` may see any value the location has held — including a partially-published one.

Edges come from synchronisation primitives only: channels, mutexes, sync.Once, sync.WaitGroup, sync/atomic, goroutine start, package init. Nothing else creates an edge. The compiler and CPU are free to reorder operations within a goroutine as long as the happens-before relations to the outside world are preserved.

A program with two unsynchronised accesses (one a write) to the same address has a *data race*. The memory model declares its behaviour undefined.

**Follow-up.** *Is sequential consistency provided?* — Go's atomic operations provide sequential consistency. Other operations only provide the edges listed; ordering between unrelated synchronisation events is not guaranteed.

---

### Q14. How does a race in a captured loop variable manifest in TSan?

**Model answer.** TSan sees two access streams to the address of `i`:

- The *write* stream from the main goroutine: every iteration of the for-loop writes to `i`.
- The *read* stream from each spawned goroutine: each `fmt.Println(i)` reads `i`.

The vector clocks of the main goroutine and each child goroutine fork at `go func()` and never re-merge (no `wg.Wait`, no channel). So the writes by main are unordered with the reads by children. TSan reports:

```
WARNING: DATA RACE
Read at 0x... by goroutine 7:
  main.main.func1()
      main.go:11 +0x...
Previous write at 0x... by goroutine 1:
  main.main()
      main.go:10 +0x...
```

The two stacks point at lines `i` is read and written. The fix (shadow `i := i` or Go 1.22 semantics) creates a *new* address per iteration, breaking the shared-address pattern entirely.

**Follow-up.** *Does Go 1.22 semantics fix all loop-variable races?* — It fixes the per-iteration aliasing. It does not magically synchronise access to other captured variables.

---

### Q15. What is `atomic.Pointer[T]` and when do you use it?

**Model answer.** `atomic.Pointer[T]` is a generic, type-safe atomic pointer (Go 1.19+). It exposes `Load`, `Store`, `Swap`, `CompareAndSwap`. The pointer-swap is single-word and lock-free.

Canonical use: copy-on-write configuration.

```go
var cfg atomic.Pointer[Config]

func Get() *Config       { return cfg.Load() }
func Set(c *Config)      { cfg.Store(c) }
```

Hot-path readers do an atomic load. Writers prepare a complete new immutable struct and `Store` it. Readers always see a fully-constructed snapshot — no torn reads, no half-built data.

Critical: the pointed-to struct must be **immutable** after Store. If a writer mutates a Config that readers may already hold, that is a race.

**Follow-up.** *How does this compare to RWMutex around the config struct?* — `atomic.Pointer` has zero contention on read (single load) and one CAS on write. `RWMutex.RLock` is many cache-line bounces under read load. For high-fanout config reads, `atomic.Pointer` wins.

---

### Q16. How would you stress-test for races that `-race` misses?

**Model answer.** The detector misses races whose two accesses never coincide in a single run. Strategies:

1. **`-count=N`**: re-run the same test N times, with N typically 100 or 1000.
2. **Stress harness**: spawn many goroutines, each in tight loops, exercising the same shared state. Run for a wall-clock budget.
3. **Vary scheduling**: `GOMAXPROCS=1`, `GOMAXPROCS=2`, `GOMAXPROCS=N` — different schedulings exercise different interleavings.
4. **Inject sleeps and yields**: a small `time.Sleep(0)` or `runtime.Gosched()` between operations changes interleavings (useful for tests, never as a "fix").
5. **`go test -race -timeout=10m -count=1000 -run=TestRacy`**.

The detector cannot prove absence; you can only raise the probability of catching infrequent races by running more.

**Follow-up.** *Can a logic race ever be caught by `-race`?* — No. Pure logic races (e.g., check-then-act with proper locking inside) have no unsynchronised memory access. Catching them needs property-based or model-checking tools, not `-race`.

---

### Q17. Compare `sync.Map` to `map + sync.RWMutex`.

**Model answer.** `sync.Map` is a concurrent map optimised for two specific patterns:

1. Each key is written once and then read many times.
2. Multiple goroutines read, write, and overwrite disjoint sets of keys.

For these workloads, `sync.Map` uses a read-mostly fast path with no locks (a `read` map of immutable atomic-loaded entries) and falls back to a `dirty` map under a Mutex for writes. The fast path scales near-linearly with cores.

For workloads outside those patterns — frequent overlapping writes, small key set, ranging often — `map + sync.RWMutex` is usually faster *and* simpler. `sync.Map`'s API is also weaker: no length, no compile-time key type checking, range under load gives a snapshot.

Rule of thumb: start with `map + Mutex`. Switch to `sync.Map` only after a benchmark proves it.

**Follow-up.** *Why isn't `sync.Map` always faster?* — Its internal duplication (read map + dirty map) costs memory and write-path complexity. The read-mostly fast path only pays off if reads truly dominate.

---

### Q18. What can the race detector NOT detect?

**Model answer.** Several categories:

1. **Logic races (race conditions without data races).** Properly locked check-then-act.
2. **Cgo memory accesses.** TSan does not instrument C code.
3. **`unsafe` pointer arithmetic that reaches a different address than the compiler thinks.**
4. **Deadlocks.** Different tool: `runtime.SetBlockProfileRate` or `goleak`.
5. **Goroutine leaks.** Use `goleak`.
6. **Code paths not exercised by the test.** A race that never fires in the test is invisible.
7. **Races across the goroutine cap (~8128).**
8. **Memory model violations that happen to produce the same value.** If a race always observes the same value, it is still a race; the detector may catch it through its instrumentation, but the program would not visibly misbehave.

The detector is necessary, not sufficient.

**Follow-up.** *Is there a deadlock detector?* — Not built into `-race`. The runtime panics on full deadlock (all goroutines blocked); partial deadlocks (one goroutine forever blocked) need `goleak` or pprof.

---

## Staff

### Q19. How would you integrate `-race` into a CI pipeline?

**Model answer.** A minimum two-stage layout:

1. **Fast tests**: `go test ./...` — runs in seconds, on every push.
2. **Race tests**: `go test -race ./...` — runs in tens of seconds to minutes, on every PR and main commit.

Hardening:

- `GORACE="halt_on_error=1 exitcode=66"` — first race fails the job.
- `-count=10` for concurrency-heavy packages.
- Required check (branch protection) so PRs cannot merge with red `-race`.
- Cache the Go module download and build cache so race-instrumented builds reuse work.
- A nightly job: `go test -race -count=200 -timeout=30m ./flaky/...` for known-flaky packages.

GitHub Actions:

```yaml
- run: go test -race ./...
  env:
    GORACE: "halt_on_error=1 exitcode=66"
```

GitLab CI:

```yaml
race:
  script:
    - go test -race ./...
  variables:
    GORACE: "halt_on_error=1 exitcode=66"
```

**Follow-up.** *Why `halt_on_error` and not collect all races?* — Collecting all is useful for triage; halting is faster and cheaper for gate purposes. Many teams have two jobs: one halts (fast), one continues (full triage on failure).

---

### Q20. Explain reordering and how synchronisation prevents it.

**Model answer.** Modern compilers and CPUs reorder operations for performance:

- The compiler may reorder source-level statements as long as single-threaded semantics are preserved.
- The CPU may execute instructions out of order, with store buffers that delay writes from becoming visible to other cores.
- Each core has caches; an updated value in core A's cache may not appear in core B's cache for many cycles.

A goroutine running on core A might assign `a = 1; b = 2`. From core B's perspective, the assignments may appear in *either* order — `b == 2 && a == 0` is observable.

Synchronisation primitives establish *memory barriers*:

- `mu.Unlock()` includes a release barrier: every prior write in this goroutine is published before Unlock returns.
- `mu.Lock()` includes an acquire barrier: every later read in this goroutine sees writes published by the previous Unlock.
- Channel send/receive embed similar release/acquire pairs.
- `atomic.Store` is release; `atomic.Load` is acquire. Together they provide sequential consistency in Go's memory model.

Without these barriers, the compiler and CPU are free to reorder, and a race becomes observable.

**Follow-up.** *Does Go expose explicit memory barriers?* — Not directly; you express them through atomics and sync primitives. There is no `runtime.MemoryBarrier()`.

---

### Q21. Describe a performance-critical situation where you would *not* run `-race` in CI.

**Model answer.** Rare but real:

- A test suite that takes 30 minutes on `-race` and only minutes without — the `-race` job is run nightly instead of per PR.
- A package whose only goroutines are managed by a battle-tested upstream library you trust, and where `-race` slows builds enough to hurt feedback loops.
- Generated code (protobuf, sqlc) — sometimes excluded with build tags.

Even then: do not skip `-race` entirely. Skip it on the *fast lane* and run a daily/weekly comprehensive `-race` job. Any race report from the slow lane becomes the next morning's first task.

The default position is "always `-race` in CI." Departing from that should be deliberate, documented, and reversed when feasible.

**Follow-up.** *Would you ship a `-race` build to a real production user?* — Almost never. Some teams enable a `-race` canary on a small percentage of traffic for a critical service for a fixed window — accepting the latency hit to surface a hard-to-reproduce bug.

---

### Q22. What happens if a goroutine started before `runtime.GOMAXPROCS(1)` was set is reading a variable while a goroutine started after writes it?

**Model answer.** `GOMAXPROCS` controls the number of OS threads executing Go code; it does not affect the memory model. Goroutines on `GOMAXPROCS=1` are still preempted at safe points (function calls, allocations, `runtime.Gosched`), and the scheduler may interleave them arbitrarily.

A data race exists if and only if the two accesses lack a happens-before edge — independent of `GOMAXPROCS`. With `GOMAXPROCS=1`:

- The race is harder to *observe* because there is no true parallelism.
- The race detector still finds it because the instrumentation records vector clocks regardless of physical cores.
- The compiler can still reorder accesses in either goroutine, so even on a single core the program behaviour is undefined.

So `GOMAXPROCS=1` is not a fix for races. It can mask symptoms; it cannot remove the bug.

**Follow-up.** *Is it true that the runtime guarantees no race on `GOMAXPROCS=1`?* — No. That myth comes from C single-threaded environments. Go's compiler can reorder; even on one core, races corrupt invariants.

---

### Q23. Compare `atomic.Value` with `atomic.Pointer[T]`.

**Model answer.**

| Property | `atomic.Value` | `atomic.Pointer[T]` |
|----------|----------------|---------------------|
| Generics | No (boxes via interface{}) | Yes (typed) |
| Type stability | First Store records the dynamic type; later Stores must match (panic otherwise) | Compile-time enforced |
| Allocation | Each Store may allocate (interface boxing) | None (one word) |
| Performance | Slower (interface dispatch + boxing) | Faster (single word atomic) |
| API | Load, Store, Swap, CompareAndSwap | Load, Store, Swap, CompareAndSwap |
| Available since | Go 1.4 | Go 1.19 |

For new code, prefer `atomic.Pointer[T]`. Use `atomic.Value` only for backward compatibility or when the type really must vary at runtime (which usually indicates a design problem).

**Follow-up.** *Does atomic.Pointer help if the underlying struct is mutated?* — No. The atomic semantics apply only to the pointer itself. The pointed-to struct must be immutable (or otherwise synchronised) for the pattern to be race-free.

---

### Q24. Two atomic operations on the same variable, in two goroutines — is that always race-free?

**Model answer.** Yes for the *atomicity* of the value: no torn reads or writes. But "race-free" depends on the protocol:

- An `atomic.Add` followed by an `atomic.Load` from another goroutine is race-free — the Store happens-before the Load (when the Load observes the new value).
- An `atomic.Add` and a non-atomic read of the same variable *is* a race. Mixing atomic and non-atomic accesses on the same address is undefined.
- Two atomic ops on *different* variables provide no happens-before for unrelated state. If goroutine A does `atomic.Store(&a, 1); atomic.Store(&b, 2)`, goroutine B doing `if atomic.Load(&b) == 2 { x := atomic.Load(&a) }` is guaranteed to see `a == 1` only because Go atomics are sequentially consistent — but in C++ this would require explicit memory ordering.

So: atomic ops on the *same* variable are race-free; mixing atomic and non-atomic on the same variable is a race; multi-variable invariants need a mutex or careful protocol.

**Follow-up.** *What if I do `atomic.LoadInt64(&x)` and `x = 5` (non-atomic write)?* — That is a race. The detector reports it.

---

### Q25. Walk through what happens when a pointer to a slice is shared without synchronisation.

**Model answer.** A slice is a struct of three words: pointer to the array, length, capacity. Sharing a slice across goroutines without synchronisation has *two* race surfaces:

1. **The slice header** (the three words). Reading length while another goroutine assigns a new slice to the variable is a race on the header.
2. **The underlying array elements.** Two goroutines mutating different indices of the array is *also* a race if they share the same backing array (even though they touch different addresses, the slice header is shared).

`append` is the worst offender: it reads len/cap, may reallocate, may write into the existing array. Concurrent appends are a multi-word race.

Race-free patterns:
- One writer goroutine, others read after a `wg.Wait` — establishes the edge.
- Per-goroutine local slices, merged at the end via channel.
- Mutex around all slice operations.
- Replace the slice with a channel (build the slice from received values).

**Follow-up.** *Is `append` to a non-shared slice safe?* — Yes; the bug is *sharing* the slice. A function-local slice is fine. The bug appears the moment two goroutines see the same slice header.

---

### Q26. How does `sync.Once` provide its happens-before guarantee?

**Model answer.** `sync.Once` is implemented (conceptually) as:

```go
type Once struct {
    done atomic.Uint32
    m    sync.Mutex
}

func (o *Once) Do(f func()) {
    if o.done.Load() == 0 {
        o.doSlow(f)
    }
}

func (o *Once) doSlow(f func()) {
    o.m.Lock()
    defer o.m.Unlock()
    if o.done.Load() == 0 {
        defer o.done.Store(1)
        f()
    }
}
```

The happens-before chain:

1. The first goroutine acquires `m`, runs `f`, then `Store(1)` on `done` (release), then `Unlock()` (release).
2. Any later goroutine on the fast path runs `Load() == 1` (acquire). The Go memory model guarantees the Store-Release happens-before the matching Load-Acquire, which in turn happens-before everything after the Load.
3. Therefore writes inside `f` are visible to every later caller of `Do`.

This is why naïve double-checked locking is broken — the fast-path read of `done` without `atomic.Load` is unsynchronised, so the writes in `f` are not guaranteed visible.

**Follow-up.** *Could you build `Once` from just a mutex?* — Yes, but the fast path would always Lock, costing contention. The atomic-then-mutex pattern is the lock-free fast path.

---

### Q27. Suppose `-race` reports a race in a third-party library. What do you do?

**Model answer.** Triage in this order:

1. **Read the report fully.** Both stacks. Confirm both addresses match. Check the goroutines were really started by the library code.
2. **Reproduce on the library's main branch.** Maybe it is fixed already.
3. **Search the library's issue tracker** for the reported file/line.
4. **Minimal repro.** Strip your code to the smallest program that triggers the race.
5. **File an issue** with the minimal repro and the race report. Be specific.
6. **Workarounds while waiting.** Wrap the call site in your own mutex; use a fork; pin to an older version; switch libraries.
7. **Do not silently suppress the race**: the runtime offers no per-line ignore. Suppression at the bug's level (forking or replacing the library) is the only honest option.

A race in a dependency is your race once it ships in your binary.

**Follow-up.** *Is there a `// nolint:race` to silence one report?* — No. The detector has no per-line suppression. There is `runtime.RaceDisable()` for advanced cases, but using it to hide bugs is malpractice.

---

## Quick-Fire Round

### Q28. Fastest way to fix a counter race?
`atomic.AddInt64`, or wrap `mu.Lock()/mu.Unlock()` around the increment. Atomic if you only need the count; mutex if other invariants are involved.

### Q29. Is `map` safe for concurrent reads with no writes?
Yes. Concurrent reads only are safe. The moment any goroutine writes, all access must be synchronised.

### Q30. Does `wg.Done` create a happens-before edge?
Yes. `Done` happens-before any `Wait` that returns after observing the matching counter decrement. So after `wg.Wait`, all writes from goroutines that called `Done` are visible.

### Q31. Can you race on a string?
On the string header (pointer + length): yes, if the variable holding the string is written from one goroutine and read from another. The string body is immutable, so no race on the bytes themselves.

### Q32. Does `defer` create a happens-before edge?
No. `defer` only schedules a call at return time. It is not a synchronisation primitive. Use a mutex if you need ordering.

### Q33. Is `chan int` send happens-before the receive's *return*?
Yes. The send completes (and its prior writes are published) before the corresponding receive returns the value.

### Q34. What is the smallest reproducer for a counter race?
```go
var c int
go func() { c++ }()
c++
```
Run with `go run -race main.go`.

### Q35. After `close(ch)`, is reading on the channel race-free?
Yes. Receivers observe `close` via a value-and-ok or zero-value return. The close happens-before those receives. Sending after close panics — that is a programming error, not a race.

---

## Summary

A senior Go engineer should be able to define a data race precisely, distinguish it from a race condition, name eight happens-before edges, explain TSan internals, decide between mutex/atomic/channel for any given scenario, integrate `-race` into CI, and triage races in third-party code. The race detector is a vector-clock-based instrument with overhead but near-zero false positives — and it is *the* baseline gate for any production Go service.
