# N-Barrier — Optimize

This file moves from "correct barrier" to "fast barrier." The first rule, as always, is: measure before you change anything. Most barrier "optimisations" are pointless because the barrier is not the bottleneck — the *work between barriers* is.

## Table of Contents
1. [Measure First](#measure-first)
2. [Where the Time Actually Goes](#where-the-time-actually-goes)
3. [Coarsen the Phases](#coarsen-the-phases)
4. [Eliminate Per-Trip Allocation](#eliminate-per-trip-allocation)
5. [Reduce the Thundering Herd](#reduce-the-thundering-herd)
6. [Channel vs Cond Cost](#channel-vs-cond-cost)
7. [Tree and Dissemination Barriers](#tree-and-dissemination-barriers)
8. [Straggler Mitigation](#straggler-mitigation)
9. [Cache-Line Awareness](#cache-line-awareness)
10. [Benchmarking Pitfalls](#benchmarking-pitfalls)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)

---

## Measure First

A barrier benchmark measures *trip latency*: how long from "the slowest party arrives" to "everyone is released," plus the synchronisation overhead. Isolate the barrier from the work:

```go
func BenchmarkBarrierTrip(b *testing.B) {
    const n = 16
    bar := NewCyclic(n)
    var start sync.WaitGroup
    start.Add(1)
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            start.Wait()
            for j := 0; j < b.N; j++ {
                bar.Wait() // pure barrier cost, no work between trips
            }
        }()
    }
    b.ResetTimer()
    start.Done()
    wg.Wait()
}
```

Run: `go test -bench BarrierTrip -benchmem -cpuprofile cpu.out`. The reported ns/op is *per-trip-per-goroutine*; multiply mentally by N for whole-cohort cost intuition. Profile with `go tool pprof cpu.out` and look for `lockSlow` / `notifyListWait`.

---

## Where the Time Actually Goes

Illustrative numbers (synthetic, single machine, your hardware differs). Pure trip cost, no inter-trip work:

| N parties | Centralised `Cond` (ns/trip) | Channel barrier (ns/trip) | Dissemination (ns/trip) |
|-----------|------------------------------|---------------------------|--------------------------|
| 2 | 180 | 240 | 300 |
| 4 | 320 | 410 | 470 |
| 16 | 1,500 | 1,800 | 900 |
| 64 | 9,200 | 10,500 | 1,900 |
| 256 | 71,000 | 80,000 | 3,400 |

Read this carefully: at small N the centralised barrier *wins* (no per-round bookkeeping). The cost is dominated by lock contention and the broadcast wakeup storm, which is why it explodes at high N while the dissemination barrier stays nearly flat. **If your N ≤ 16, stop here — the centralised barrier is the right choice and further "optimisation" is noise.**

---

## Coarsen the Phases

The biggest real-world win is rarely the barrier code; it is *barriering less often*. If each phase does 500 ns of work and the trip costs 1,500 ns, you spend 75% of wall time synchronising.

**Before** (fine phases):
```go
for _, item := range myShard { // 1 item per phase
    process(item)
    b.Wait()
}
```

**After** (coarse phases):
```go
for _, batch := range myBatches { // many items per phase
    for _, item := range batch {
        process(item)
    }
    b.Wait()
}
```

| Phase grain | Items/phase | Trips | Barrier overhead share |
|-------------|-------------|-------|------------------------|
| Fine | 1 | 1,000,000 | ~75% |
| Coarse (1k) | 1,000 | 1,000 | ~0.1% |

Same total work, 1000x fewer trips. This single change usually dwarfs every micro-optimisation below.

---

## Eliminate Per-Trip Allocation

The channel-based barrier allocates a fresh `chan struct{}` every trip (`make(chan struct{})`). At high trip rates that is GC pressure.

**Before** (channel barrier): 1 alloc/trip.

```go
// each trip
close(b.gate)
b.gate = make(chan struct{}) // allocation
```

**After**: use the `Cond`/generation barrier (zero allocs/trip) or the sense-reversing barrier. Verify with `-benchmem`:

| Barrier | allocs/op | B/op |
|---------|-----------|------|
| Channel (fresh gate) | 1 | 96 |
| `Cond` + generation | 0 | 0 |
| Sense-reversing | 0 | 0 |

If you need `select`-based cancellation (the reason to use a channel barrier), keep the channel form but accept the allocation, or pool the gate channels. Do not pool prematurely — measure that GC is actually the problem first.

---

## Reduce the Thundering Herd

When the Nth party calls `Broadcast()`, all N-1 sleepers wake and immediately contend for the same mutex to re-check the predicate. At high N this serialises everyone through one lock twice (once to arrive, once to re-check on wake).

Mitigations, in increasing complexity:

1. **Keep N small** (split into sub-cohorts; barrier each sub-cohort, then a small cross-cohort barrier — this *is* a tree barrier).
2. **Move to a log-depth barrier** (next sections) so no single lock sees all N.
3. **Sense-reversing barrier** reduces the *re-check* cost: the predicate is a single boolean compare rather than a count comparison, but it still funnels through one lock — it helps constant factors, not asymptotics.

You cannot fix O(N) contention with a faster lock; you fix it by not having all N touch one lock.

---

## Channel vs Cond Cost

A `Cond.Broadcast()` walks an internal notify list and marks each waiter runnable. `close(chan)` marks all blocked receivers runnable. They are comparable; the channel form adds an allocation per trip (the new gate) and a tiny extra cost for the `select` machinery if you use one. The `Cond` form wins on raw speed and zero allocation; the channel form wins on composability (you can `select { case <-gate: case <-ctx.Done(): }`).

Decision: **default to `Cond` + generation for speed; switch to the channel barrier only when you need `select`-based cancellation and the per-trip allocation is acceptable** (it usually is below ~100k trips/sec).

---

## Tree and Dissemination Barriers

These trade code complexity for O(log N) contention.

**Tree (combining) barrier.** Parties are leaves; each signals its parent only after its children arrived. Arrival climbs the tree (depth `log N`), release descends it. No node ever has more than its children contending on it — contention is bounded by the fan-out (typically 2), independent of N.

**Dissemination barrier.** No shared counter at all. `ceil(log2 N)` rounds; in round `r`, party `i` signals `(i+2^r) mod N` and waits on `(i-2^r) mod N` via a *private* per-(party, round) flag. Because each flag has exactly one writer and one reader, there is zero lock contention — only point-to-point wakeups.

```go
// Dissemination round flag: one writer (partner), one reader (self).
type flag struct {
    ch chan struct{} // or an atomic + futex-like wait; chan is simplest in Go
}
```

These shine at N ≥ 32 (see the table). Below that, their per-round overhead loses to the centralised barrier. They are also harder to make reusable correctly (each round's flag must reset per trip — use a parity/sense bit per round). Only adopt them with a benchmark that proves the centralised barrier is your bottleneck.

---

## Straggler Mitigation

A barrier runs at the speed of its slowest party *every trip*. If party 3 always takes 2x longer, you waste half the cohort's time waiting. This is an *algorithmic* optimisation, not a barrier-code one:

- **Balance the shards.** Give the slow party less work. If load is data-dependent, size shards by estimated cost, not by count.
- **Work-stealing within a phase.** Idle parties steal from busy ones *before* the barrier, so they arrive together. (Now the barrier is cheap because everyone arrives at once.)
- **Overlap where the algorithm allows.** Some computations let a party start the *next* phase's independent work while waiting — but that breaks strict lockstep, so only if correctness permits.

Profiling the *per-party arrival time distribution* (instrument arrival timestamps) tells you whether you have a straggler problem at all. If arrivals are tightly clustered, the barrier is fine and balancing buys nothing.

---

## Cache-Line Awareness

In a centralised barrier the shared `count`/`generation` words are written by every party — they ping-pong between cores (false/true sharing on that cache line). For very hot barriers:

- Keep `count`, `generation`, and the mutex on the **same** cache line (they are accessed together under the lock anyway).
- In a *dissemination* barrier, ensure each party's per-round flags are **padded** to separate cache lines so a party's spin/wait does not invalidate a neighbour's flag line:

```go
type paddedFlag struct {
    ready uint32
    _     [60]byte // pad to 64-byte cache line
}
```

This matters only for spin-based or atomic barriers at high core counts. For a `Cond` barrier the goroutines actually park (no spinning), so cache-line contention on the count is bounded by trip frequency, not by busy-waiting.

---

## Benchmarking Pitfalls

- **Measuring the work, not the barrier.** Put *no* work between trips to isolate barrier cost; then add work to measure the overhead *share*.
- **`b.N` confusion.** With N goroutines each doing `b.N` trips, the reported ns/op is per-goroutine-per-trip. Be explicit in your interpretation.
- **GOMAXPROCS=1.** Barriers behave totally differently with real parallelism. Always bench with `GOMAXPROCS ≥ N` (or at least > 1).
- **Not pinning N.** Using `runtime.NumCPU()` makes results unreproducible across machines. Fix N per benchmark case.
- **Ignoring the start barrier.** Without a `start.Wait()` to release all parties together, early goroutines do trips before late ones spawn, skewing the first samples. Use a start gate (see the BenchmarkBarrierTrip skeleton).
- **No `-race` correctness pass.** A fast-but-wrong barrier is worthless. Always run the correctness suite under `-race` before trusting a benchmark.
- **Forgetting the straggler.** A microbenchmark with identical work per party hides straggler cost that dominates real workloads. Add jittered work to a realistic bench.

---

## Cheat Sheet

```text
1. Coarsen phases first        -> usually the only optimisation that matters
2. N <= 16                     -> centralised Cond barrier, zero allocs, done
3. Need select/cancel          -> channel barrier (accept 1 alloc/trip)
4. N >= 32, proven bottleneck  -> tree or dissemination barrier (O(log N))
5. Straggler-bound             -> balance shards / work-steal, not barrier code
6. Hot spin barrier            -> pad flags to cache lines
ALWAYS: bench with GOMAXPROCS >= N, fixed N, start gate; correctness under -race
```

| Symptom in profile | Cause | Fix |
|--------------------|-------|-----|
| time in `lockSlow` | central lock contention | log-depth barrier or coarser phases |
| 1 alloc/op in `-benchmem` | channel barrier gate | use Cond+generation |
| high `wait_seconds` p99 | straggler | balance shards |
| flat trips/sec, low CPU | phases too fine | coarsen |

---

## Summary

Optimising a barrier is mostly about *not* relying on barrier micro-tuning. The dominant win is coarsening phases so you trip far less often. After that, pick the design by N: the centralised `Cond` + generation barrier is fastest and allocation-free up to ~16 parties; beyond ~32 a tree or dissemination barrier removes the O(N) thundering-herd contention and stays nearly flat. The channel barrier costs one allocation per trip and is worth it only when you need `select`-based cancellation. And remember the algorithmic ceiling: a barrier can never run faster than its slowest party, so a straggler is fixed by balancing work, not by faster synchronisation primitives. Benchmark with real parallelism, a fixed N, a start gate, and a correctness pass under `-race`.
