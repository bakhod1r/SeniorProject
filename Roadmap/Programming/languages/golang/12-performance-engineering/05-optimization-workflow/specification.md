# Optimization Workflow — Specification

> **Focus:** The disciplined process by which a Go program is made faster — from setting a target, through measurement, change, and verification, to documentation and regression prevention.
>
> **Sources:**
> - Go diagnostics guide: https://go.dev/doc/diagnostics
> - `testing` package: https://pkg.go.dev/testing
> - `runtime/pprof`: https://pkg.go.dev/runtime/pprof
> - `golang.org/x/perf/cmd/benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
> - PGO documentation: https://go.dev/doc/pgo

---

## 1. The optimization loop

Performance work in Go follows a fixed five-step cycle. Skipping any step is the most common reason changes fail to land.

| Step | Question answered | Primary tool |
|------|-------------------|--------------|
| **1. Set a goal** | "What number must change, by how much?" | SLOs, benchmark targets |
| **2. Measure baseline** | "Where does time and memory go today?" | `pprof`, `benchstat`, `go test -bench` |
| **3. Identify hotspot** | "Which 1-3 functions account for the cost?" | Flame graph, `top` in pprof |
| **4. Apply one change** | "Hypothesis: change X reduces cost Y." | Code edit + targeted test |
| **5. Re-measure, decide** | "Did the change move the right number?" | `benchstat`, production canary |

Step 4 is the only step that touches code. Steps 1, 2, 3, and 5 are all measurement. A typical optimization spends 80% of its hours in measurement and 20% writing the fix.

---

## 2. Goals: what to measure

Performance has no single number. Pick the goal that matches the workload before you start.

| Goal | Definition | Typical target |
|------|-----------|----------------|
| **Latency p50** | Median request time | "fast enough" feel |
| **Latency p99** | 99th percentile | SLA / SLO target |
| **Throughput (RPS)** | Sustained requests per second | Capacity planning |
| **Allocations/op** | Bytes or count allocated per unit of work | GC pressure |
| **CPU per request** | CPU-seconds consumed per request | Cost per unit of traffic |
| **Memory ceiling (RSS)** | Peak resident memory | Container limit |
| **Time-to-first-byte (TTFB)** | First-byte latency | UX-sensitive endpoints |

"Make it faster" is not a goal. "Reduce p99 of `/checkout` from 250 ms to 100 ms at 500 RPS" is a goal.

---

## 3. The hierarchy of optimizations

Optimizations vary by leverage. Always start at the top of this table; only descend when the upper levels have been exhausted or measured to be irrelevant.

| Level | Example | Typical win |
|-------|---------|-------------|
| **Algorithm** | O(n²) → O(n log n) | 10×–1000× |
| **Data structure** | Linked list → contiguous slice, map → array | 2×–50× |
| **Implementation** | Avoid double work, batch, cache | 1.5×–10× |
| **Compiler / runtime** | PGO, inlining, escape | 1.05×–1.3× |
| **Micro-optimization** | Loop unroll, bit twiddle, SIMD | 1.01×–1.5× |

A 10× algorithmic win dwarfs every micro-optimization stacked together. Reaching for `unsafe` before checking the complexity is a category error.

---

## 4. Bottleneck categories

Every slow Go program is bottlenecked on at least one of these four resources. The diagnostic is different for each.

| Bottleneck | Symptom | Primary profile |
|------------|---------|-----------------|
| **CPU** | High CPU usage, latency scales with load | `pprof -cpu` |
| **Memory / GC** | High GC CPU fraction, growing RSS, long pauses | `pprof -alloc_objects`, `gctrace` |
| **Contention** | CPU underutilized at high load, scheduling stalls | `pprof -mutex`, `pprof -block`, `runtime/trace` |
| **I/O** | Low CPU, wait time dominates | `runtime/trace`, syscall traces, OS metrics |

The first job of measurement is to put the workload into one of these buckets. The tools and techniques diverge sharply after that.

---

## 5. Tools matrix

| Stage | Tool | Use it for |
|-------|------|-----------|
| Benchmark | `go test -bench=. -benchmem` | Microbenchmarks per function |
| Compare | `benchstat old.txt new.txt` | Statistical significance of change |
| CPU profile | `go tool pprof http://host/debug/pprof/profile?seconds=30` | Where time is spent |
| Heap profile | `go tool pprof http://host/debug/pprof/heap` | What is allocated and retained |
| Allocation profile | `go tool pprof http://host/debug/pprof/allocs` | Cumulative allocation sites |
| Contention | `go tool pprof http://host/debug/pprof/mutex`, `block` | Lock waits, channel blocks |
| Goroutines | `go tool pprof http://host/debug/pprof/goroutine` | Goroutine leaks, blocked goroutines |
| Trace | `go tool trace trace.out` | Per-goroutine timeline, scheduler events |
| PGO | `go build -pgo=auto` | Apply a real-workload profile back to the compiler |
| GC trace | `GODEBUG=gctrace=1` | One line per GC cycle |
| Escape analysis | `go build -gcflags="-m=2"` | Heap vs. stack decisions |

---

## 6. Benchmark vs. production profile

The two sources of data answer different questions.

| Property | Microbenchmark | Production profile |
|----------|----------------|--------------------|
| Reproducibility | High | Low |
| Realism | Low | High |
| Cost to capture | Seconds | Hours of careful ops work |
| Best for | Comparing implementations of one function | Finding the hot function in a system |
| Worst for | Whole-system performance | Comparing two implementations |

A correct workflow uses both: production profile to find the function, microbenchmark to compare candidate implementations of that function.

---

## 7. The 90/10 rule

A working hypothesis confirmed in almost every Go service: roughly 90% of CPU and allocations happen in 10% of functions. The empirical version, after a CPU profile:

```
(pprof) top10
Showing nodes accounting for 14.5s, 87.4% of 16.6s total
```

The top 10 entries account for 87% of CPU. This is the rule, not the exception. The corollary: optimizing the bottom 90% of functions is almost always wasted effort.

Find the 10% first. Then choose where in that 10% to invest.

---

## 8. The "change one thing" rule

Each iteration of the loop changes exactly one identifiable thing. Two changes in one commit make it impossible to attribute the result.

| Anti-pattern | Why it fails |
|--------------|--------------|
| Squashed cleanup + perf change | If perf doesn't improve, you can't tell which sub-change was the problem |
| Renaming during optimization | Diff is unreviewable; reverting becomes manual |
| Multi-function refactor with "and I also pre-allocated this slice" | The pre-allocation is the change worth measuring; everything else hides it |

The discipline: one PR per measurable change, with before/after numbers in the description.

---

## 9. When to stop

Optimization yields diminishing returns. The decision rule:

| Signal | Action |
|--------|--------|
| Next candidate change is < 5% improvement | Stop; the engineering cost exceeds the benefit |
| Last change took longer than the time saved per day | Stop |
| Hot path no longer appears in `top10` | Stop; move to the next hotspot |
| Code is now harder to read than before | Strongly consider reverting |
| You're measuring noise, not signal (benchstat `p > 0.05`) | Stop and rebench at higher `-count` |

Knowing when to stop is the senior skill; juniors over-optimize, seniors leave the field having declared the work done.

---

## 10. Documenting the result

Every landed optimization must answer four questions in the commit message or attached doc:

1. **What was the goal?** (e.g., "reduce p99 of `/render` from 80 ms to 30 ms")
2. **What was the baseline?** (numbers, benchmark name, `benchstat` output)
3. **What changed?** (one-line description of the technique)
4. **What was the result?** (post-change numbers and statistical significance)

A two-line code change with a five-paragraph rationale is normal in this discipline. The reader six months from now needs to know why a clear loop became a clever loop.

---

## 11. Regression prevention

Optimizations regress silently. The mechanisms to prevent that:

| Mechanism | Where it lives |
|-----------|----------------|
| Benchmark in CI | `go test -bench=. -count=10` per PR, compared with `benchstat` |
| Allocation budget assertion | `b.ReportAllocs()` + diff against committed baseline |
| Performance SLO + canary | Block deploys whose p99 worsens > X% |
| Production "steady-state probe" | Synthetic load, snapshot metrics weekly |
| Locked-in benchmark | A benchmark whose name encodes the optimization, e.g., `BenchmarkRender_NoAlloc` |

If a change passed once and you have no test that re-asserts the property, the change is one refactor away from being undone.

---

## 12. Trade-offs

Optimization is rarely free. Common axes:

| Trade | A side | B side |
|-------|--------|--------|
| Latency vs. throughput | Lower per-request work, higher RPS | Batching, higher RPS at higher tail latency |
| Memory vs. CPU | Cache → faster but uses more memory | Recompute → cheaper memory, more CPU |
| Speed vs. clarity | Inlined, hand-vectorized | Simple, readable, slower |
| Speed vs. correctness | `unsafe`, missing bounds check | Safe, slightly slower |
| Build time vs. runtime | PGO, `-buildmode=pie`, generics | Faster build, less optimization |

A "win" that ignores the cost on the other axis is not a win.

---

## 13. PGO in the workflow

Profile-Guided Optimization (Go 1.21+) is a step in the workflow, not a magic switch.

1. Build a profilable binary.
2. Run it under representative production load for 30–120 seconds.
3. Save the resulting CPU profile as `default.pgo` alongside `main.go`.
4. Rebuild with `go build -pgo=auto`.

Typical wins: 2–10% CPU. The profile must be representative — a profile captured during cold start or a stress test produces a worse binary than no PGO at all. Re-collect monthly or after major workload changes.

See [11-pgo](../../11-advanced-topics/11-pgo/) for the deep dive.

---

## 14. Non-goals

- **Beating C.** Go's runtime, GC, and goroutine scheduler impose costs that no amount of optimization erases.
- **Universal zero-allocation.** A whole service with zero allocations is a non-goal; zero-allocation hot kernels are a reasonable one.
- **Static "speed-up multipliers".** No language flag, profiler trick, or knob gives consistent N% wins across programs.
- **Optimizing before correctness.** A wrong answer faster is still wrong.

---

## 15. Related references

- `pprof` user guide: https://github.com/google/pprof/blob/main/doc/README.md
- `benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
- Brendan Gregg on flame graphs: https://www.brendangregg.com/flamegraphs.html
- Go execution tracer: https://pkg.go.dev/runtime/trace
- Damian Gryski high-performance Go: https://github.com/dgryski/go-perfbook
