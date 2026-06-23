# Optimization Workflow — Middle

## 1. The loop in detail

The five-step loop introduced at the junior level is correct but skeletal. At the middle level we expand each step into the concrete artifacts that experienced engineers produce.

| Step | Artifact | Verified by |
|------|----------|-------------|
| Goal | Written target with numbers and context | A line in the ticket: "p99 ≤ 30 ms at 500 RPS" |
| Baseline | Saved benchmark output, profile file, or production query | A committed `bench/baseline.txt` or a saved pprof |
| Hotspot | A specific function name plus a percentage | "`render.encode` is 38% of CPU and 42% of allocations" |
| Hypothesis | One-sentence theory naming a technique | "Pre-allocating the byte buffer should reduce allocs by half" |
| Verification | `benchstat` diff, or canary comparison | `p < 0.05` and the hotspot dropped out of `top10` |

Each artifact is something you can show another engineer. If you can't show it, the step didn't happen.

---

## 2. Where the data actually lives

A middle-level engineer learns to gather the right data from the right place for the question being asked.

| Question | Best data source |
|----------|------------------|
| Which function is slow? | CPU profile from production (real workload mix) |
| Which line within that function? | `pprof -list` or `pprof -web` |
| Which allocation is responsible for GC pressure? | Heap profile in `-alloc_objects` mode |
| Is this lock the bottleneck? | Mutex / block profile |
| Did the optimization help? | Microbenchmark + `benchstat` |
| Is the system meeting its SLO? | Metrics from the load balancer or APM |
| Is goroutine count growing without bound? | `runtime.NumGoroutine()` time series |

The two most common mistakes: using a microbenchmark to answer a system question, and using a system metric to compare two implementations of a function.

---

## 3. CPU vs. memory vs. contention vs. I/O

A workload's bottleneck almost always reduces to one of these four resources. The diagnostic pattern:

| Bottleneck | CPU usage | Latency under load | Diagnostic |
|------------|-----------|---------------------|------------|
| **CPU-bound** | At or near 100% on saturated cores | Scales linearly with load | CPU profile shows hot functions |
| **Memory / GC-bound** | High, but `GC CPU fraction` > 20% | Variable; long-tail GC pauses | `GODEBUG=gctrace=1`, heap profile |
| **Contention-bound** | Low (cores idle) at high RPS | Latency jumps at low concurrency | Mutex profile shows wait time |
| **I/O-bound** | Low | Latency dominated by wait time | `runtime/trace` shows blocking on syscall |

Run a small experiment: scale request concurrency. If latency stays flat as you add concurrency but CPU stays low, you're contention-bound or I/O-bound, not CPU-bound. If latency rises linearly with concurrency and CPU is pegged, you're CPU-bound. The shape of the curve tells you which tool to reach for next.

---

## 4. Choosing benchmark vs. trace prod

This is the most common decision at this level, and most engineers get it backward.

| Situation | Reach for |
|-----------|-----------|
| You have a candidate optimization and want to know if it helps | Microbenchmark |
| You don't yet know which function is slow | Production profile |
| The problem only appears under realistic load mix | Production profile |
| The problem is reproducible with a fixed input | Microbenchmark |
| You're comparing five implementations of a parser | Microbenchmark |
| The slowness is tied to specific tenants or request shapes | Production profile (with labels) |

Rule of thumb: **profile production to find the hotspot, then benchmark to optimize it**. Going the other way — benchmarking a function you guessed was slow — wastes engineering hours.

---

## 5. Walking a CPU profile

```bash
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
```

```
(pprof) top
(pprof) top -cum
(pprof) list myFunc
(pprof) web
(pprof) traces
(pprof) peek myFunc
```

| Command | What it shows |
|---------|---------------|
| `top` | Flat: time spent in this function only |
| `top -cum` | Cumulative: time spent in this function and its callees |
| `list <fn>` | Annotated source code with per-line CPU |
| `web` | SVG/HTML flame graph in your browser |
| `traces` | Sampled stack traces |
| `peek <fn>` | Callers and callees of a function |

Read `top -cum` first to see "where does the program spend its time at a high level", then `top` to see "which leaf functions are actually working". Flame graphs are excellent for presentations and overview; the text views are faster for sustained analysis.

---

## 6. The benchmark you actually need

Beyond `for i := 0; i < b.N; i++ { fn() }`, several patterns are essential.

```go
// Allocations + time, the default for "is this allocating?"
func BenchmarkEncode(b *testing.B) {
    enc := newEncoder()
    msg := newMessage()
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = enc.Encode(msg)
    }
}

// Parallel: tests scaling with GOMAXPROCS
func BenchmarkEncodeParallel(b *testing.B) {
    msg := newMessage()
    b.ReportAllocs()
    b.RunParallel(func(pb *testing.PB) {
        enc := newEncoder()    // per-goroutine
        for pb.Next() {
            _ = enc.Encode(msg)
        }
    })
}

// Table-driven: compare implementations or input sizes
func BenchmarkHash(b *testing.B) {
    sizes := []int{16, 256, 4096, 65536}
    for _, n := range sizes {
        b.Run(fmt.Sprintf("size=%d", n), func(b *testing.B) {
            data := make([]byte, n)
            b.SetBytes(int64(n))
            b.ResetTimer()
            for i := 0; i < b.N; i++ {
                _ = hash(data)
            }
        })
    }
}
```

`b.SetBytes(n)` reports `MB/s` for throughput-oriented work — invaluable when comparing implementations of streaming code.

---

## 7. Reading benchstat output

```
$ benchstat old.txt new.txt
name       old time/op    new time/op    delta
Encode-8     412ns ± 2%     298ns ± 1%   -27.67%  (p=0.000 n=10+10)

name       old alloc/op   new alloc/op   delta
Encode-8      256B ± 0%      128B ± 0%   -50.00%  (p=0.000 n=10+10)

name       old allocs/op  new allocs/op  delta
Encode-8      3.00 ± 0%      1.00 ± 0%   -66.67%  (p=0.000 n=10+10)
```

The `p` value is the Mann-Whitney U test. `p=0.000` means "the chance the difference is noise is essentially zero". `p > 0.05` means the change is not detectable — even a 10% delta number with `p=0.2` is not a real improvement.

The `± 2%` after each number is the spread across the 10 runs. A noisy benchmark (spread > 5%) should be re-run with `-count=20` or fixed by removing variability (background jobs, frequency scaling, thermal throttling).

---

## 8. Allocations are a CPU cost

Newcomers often think allocations only matter for memory pressure. They are also a major CPU cost, through two channels:

1. The allocator itself runs code on every call.
2. The garbage collector runs proportional to allocation rate.

For a CPU-bound service, dropping allocs/op from 12 to 3 may improve throughput by 15%, even if total memory usage barely changes. That's because GC CPU drops from (say) 18% to 5%, and that 13% flows directly to the application.

Always include `-benchmem` in your benchmark runs. Track allocs as a first-class metric, not a side note.

---

## 9. The hotspot has dependencies

When you find that function X is 40% of CPU, ask the next question: *why is X being called so much?* Often the win is not in optimizing X but in calling X less often.

Example. A profile shows `json.Marshal` is 35% of CPU. The naive fix is "find a faster JSON library." The better fix is often:

| Question | Possible fix |
|----------|--------------|
| Is the same value being marshaled repeatedly? | Cache the marshaled bytes |
| Is half the marshaled payload thrown away? | Use a smaller struct |
| Is this on a path that doesn't need JSON? | Use a different serializer |
| Is this called per-element where it could be per-batch? | Marshal the whole slice once |

The fastest function is the one that doesn't run. Always check whether the bottleneck function can be called less often before trying to speed it up.

---

## 10. The hierarchy applied

When the hot function is identified, you have a menu of optimizations. Work the menu top down.

| Level | Concrete questions for `myFunc` |
|-------|--------------------------------|
| Algorithm | Is the asymptotic complexity wrong? Linear scan instead of map? |
| Data structure | Is a slice better than a map here? Sorted insert versus sort-then-scan? |
| Implementation | Are we doing the same work twice? Calling a thing on every iteration that's invariant? |
| Compiler / runtime | Is the function inline-able? Does it allocate where it could not? |
| Micro-opt | Branch hints, SIMD, hand-unroll |

Only descend if the upper level either (a) is already optimal or (b) you've measured that it isn't the cost.

---

## 11. Reading flame graphs more carefully

A flame graph reads top-down (call depth) and is sorted alphabetically left-to-right, not by time. The *width* of each box is the sample count.

Patterns worth recognizing:

- **Tall, narrow stacks**: deep call chains, classic of recursion or middleware. Investigate whether the depth itself is the cost.
- **Wide, shallow plateaus**: hot loops. Inspect the function and its loop body.
- **A wide GC tower**: see lots of `runtime.gcBgMarkWorker` or `runtime.scanobject`? You have allocation pressure, not CPU work.
- **A wide `runtime.mallocgc`**: same — allocations are the bottleneck.
- **A wide `runtime.futex` / `runtime.sysmon` / `runtime.notetsleep`**: contention or scheduling, not pure CPU.

The flame graph is best at telling you *which family of cost* dominates. Use it for triage; use `pprof -list` for the actual line.

---

## 12. The "trade-offs" conversation

Every middle-level optimization decision is also a trade-off decision. Document them explicitly.

| Choice | Cost | Benefit |
|--------|------|---------|
| Add an LRU cache | Memory, complexity, staleness | Latency, throughput |
| Pre-allocate a large pool | RSS at startup | Lower per-request variance |
| Use `sync.Pool` | Code complexity, retention quirks | Reduced GC pressure |
| Use `unsafe.String`/`unsafe.Slice` | Risk if memory is mutated | Skip one copy |
| Inline a helper | Code duplication | Lets escape analysis stack-allocate |
| Batch operations | Higher per-call latency | Higher throughput |

A change without a documented trade-off is suspicious. Either the trade-off exists and you didn't notice, or the change is too small to matter.

---

## 13. When to stop iterating

The discipline isn't only knowing how to optimize; it's knowing when to stop. Practical signals:

| Signal | Action |
|--------|--------|
| The next candidate is < 5% improvement | Stop on this hotspot; find the next |
| You're chasing benchmark variance, not real wins | Stop and improve the benchmark harness |
| The optimization makes the code substantially harder to read | Strongly consider reverting |
| You've met the goal with > 20% margin | Stop |
| Your changes have started reducing readability without measurable gain | Stop and revert the last change |

Knowing when to stop comes from honesty about the data. If `benchstat` says `p=0.18`, the win you're seeing is in your head, not the program.

---

## 14. The change log entry

A middle-level engineer writes a commit message that future-you, or your replacement, can act on:

```
render: pre-allocate output buffer in Encode

The buffer was growing 4 times per call because we appended without
hinting capacity. The output of `pprof -alloc_objects` showed Encode
at 38% of all allocations.

Before:                After:
  412ns ± 2%             298ns ± 1%   -27.7%
  256B  ± 0%             128B  ± 0%   -50.0%
    3 allocs              1 alloc

benchstat p=0.000, n=10+10.

We chose to leave the buffer initial capacity at 512 instead of the
worst-case 8192 because the median message is 300 bytes and the
worst case is rare. Worst case still works correctly via append.
```

Numbers, technique, trade-off. Three short paragraphs that pay back five times over the next year.

---

## 15. Summary

At the middle level, the loop is unchanged but each step has substance: artifacts you save, profiles you read, benchmark patterns you know by heart. Your toolset is `pprof`, `benchstat`, the standard library benchmark patterns, and the four bottleneck categories. The two skills that separate middle from junior: choosing the right data source for the question, and stopping when the goal is met instead of chasing 1% wins.

---

## Further reading
- `pprof` user guide: https://github.com/google/pprof/blob/main/doc/README.md
- `runtime/trace`: https://pkg.go.dev/runtime/trace
- Dave Cheney, Five things that make Go fast: https://dave.cheney.net/2014/06/07/five-things-that-make-go-fast
- Damian Gryski, go-perfbook: https://github.com/dgryski/go-perfbook
