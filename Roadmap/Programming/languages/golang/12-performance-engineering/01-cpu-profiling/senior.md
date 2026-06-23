# CPU Profiling in Go — Senior

## 1. The profiler in one mental model

Internalize these five facts and the rest follows:

- **CPU profiling is statistical sampling**, not instrumentation. The runtime does not count calls; it counts *being on CPU when the timer fires*.
- **Samples are taken per-thread via `SIGPROF`**. The OS kernel times the program in CPU time (user + system), not wall time. A sleeping goroutine contributes zero samples.
- **The sampling period defines the resolution.** Default 10 ms; a 2 ms function may never be sampled, while a 100 ms function appears reliably.
- **Stack walking happens in the signal handler.** It uses compile-time frame metadata; inlined frames are visible only if the compiler chose to emit inline trees.
- **Profile bias is real.** Functions that run with `SIGPROF` masked (parts of the runtime, cgo) under-sample. Treat the bottom of the call graph cautiously.

A profile is a statistical estimator of "fraction of CPU time spent in function F". With N samples and true fraction p, the standard error is roughly `sqrt(p(1-p)/N)`. Below 1000 samples, anything under 5% is noise.

---

## 2. The signal path, in detail

```
setitimer(ITIMER_PROF, 10ms)
  → kernel timer fires
  → SIGPROF delivered to one thread (round-robin)
  → sigprofHandler installs a stub on the goroutine's stack
  → on return, sigprof walks the stack and writes to a per-M buffer
  → background goroutine drains buffers, writes pprof protobuf
```

Practical consequences:

- The handler runs on whichever goroutine was active. If thread T was blocked in a syscall, the syscall site (not the goroutine that issued it) is sampled — except Go reroutes those samples back to the goroutine, so you see your Go-level stack.
- Threads not currently running do not receive `SIGPROF` for that tick. At GOMAXPROCS=8 and 100 Hz, you get up to 800 samples/sec total — but only when CPUs are saturated.
- Calling `runtime.LockOSThread` or doing heavy syscalls slightly biases the profile because of how the kernel chooses targets.

---

## 3. Sampling rate, mathematically

Default: 100 Hz, period = 10,000,000 ns.

`runtime.SetCPUProfileRate(hz)` sets a new period of `1e9 / hz` ns. The kernel's `setitimer` resolution is typically 1 ms on Linux, so rates above 1000 Hz are clamped.

| Rate | Samples per CPU-second | Use case |
|------|------------------------|----------|
| 100 Hz | 100 | Default — production-safe |
| 250 Hz | 250 | Short benchmarks where 100 Hz gives < 1000 total |
| 500 Hz | 500 | Microbenchmarks |
| 1000 Hz | 1000 | Maximum useful — overhead climbs into single-digit % |

Raising the rate does **not** improve accuracy proportionally because the overhead also rises. Above 500 Hz the profile starts to skew its own observations. If a function takes 100 µs and you sample at 1000 Hz, the chance of catching it remains low — instead, run the workload longer.

---

## 4. The pprof protobuf, in practice

A CPU profile decodes to roughly:

```
Profile {
  sample_type[0] = { type: "samples", unit: "count" }
  sample_type[1] = { type: "cpu",     unit: "nanoseconds" }
  period         = 10_000_000           // 10 ms in ns
  period_type    = { type: "cpu", unit: "nanoseconds" }

  sample[i] = {
    value: [count, count * period]      // count is always 1 for individual samples
    location_id: [...]                  // call stack, leaf-first
    label: { "endpoint": ["/api/v1"] }
  }
}
```

Reading raw profile data is occasionally useful:

```bash
go tool pprof -raw cpu.pprof | head -100
```

Or programmatically:

```go
import "github.com/google/pprof/profile"

f, _ := os.Open("cpu.pprof")
p, _ := profile.Parse(f)
for _, s := range p.Sample {
    // s.Value[0] = sample count, s.Value[1] = CPU ns
    // s.Location[0] is the leaf frame
}
```

When the standard tooling cannot answer a question (custom aggregation, attribution to OpenTelemetry trace IDs), parse the profile yourself.

---

## 5. Inlining and what you see in the profile

The Go compiler aggressively inlines small functions. By default, inlined callees do **not** appear as separate frames in the profile — their cost is attributed to the caller. That's confusing when you `list` a function and see weight on a line that does nothing but call a helper.

Disable inlining for analysis:

```bash
go build -gcflags="all=-l" .
```

`-l` disables inlining; `-N -l` also disables optimization. Use `-l` alone for profiling — `-N` changes the code's actual behavior.

A more selective trick: `//go:noinline` on the function you're profiling.

```go
//go:noinline
func hotMath(x, y int) int { ... }
```

Now the profile shows `hotMath` as its own frame. Remove the directive when you're done — inlining is usually a performance win.

---

## 6. The ABI and the "missing" frames

Go's call ABI (ABIInternal as of 1.17+) uses registers for parameters. Frames are still well-formed, but small leaf functions can be tail-merged or scheduled in ways that put the leaf's work in the caller's address range. Practical effect: the profile sometimes attributes a few percent of time to a line that looks innocent.

Verify with the assembly:

```
(pprof) disasm hotMath
```

If you see your function's body inlined into another function, your `list` output is lying about which line owned the cost. Trust `disasm` over `list` when you suspect inlining.

---

## 7. Self-time vs total-time: choosing a metric

Three independent questions every profile session asks:

- "Which function does the most actual work?" — sort by **flat**.
- "Which subsystem is most expensive end-to-end?" — sort by **cum**.
- "Where would a small change have the biggest impact?" — look at functions with high flat *and* few callers (point of leverage).

The third is the senior-level question. A leaf with 10% flat called by 100 different callers needs a fix at the leaf. The same leaf called from one place is best fixed at the caller. The graph view tells you which one you're looking at.

---

## 8. The shape of common bottlenecks

| Profile shape | Meaning |
|---------------|---------|
| One tall narrow flame | A serial computation; algorithmic optimization |
| Wide base of `runtime.gcBgMarkWorker` and `runtime.gcAssistAlloc1` | GC saturated by allocation rate |
| Wide base of `runtime.futex` / `runtime.semasleep` | Lock contention; check mutex profile |
| Wide base of `syscall.Syscall6` | Heavy kernel I/O; batch, mmap, or async |
| Many narrow flames spread evenly | No single hotspot; look at allocation or algorithm holistically |
| Most time in `runtime.findrunnable` | Program is idle; you captured nothing |
| Sharp spike from `runtime.convT*` | Boxing into interfaces in a hot loop |

A profile that looks like "uniform noise everywhere" is usually one of: (a) the workload is too small to dominate setup costs; (b) you're profiling the wrong thing; (c) you've already exhausted the easy wins and need an algorithmic step change.

---

## 9. The labels mechanism, deeply

```go
labels := pprof.Labels("tenant", tenantID, "shard", strconv.Itoa(shardID))
pprof.Do(ctx, labels, func(ctx context.Context) {
    runQuery(ctx)
})
```

Implementation: `pprof.Do` sets the goroutine's label map via `runtime.setProfLabel`. The signal handler reads that pointer and copies it into the sample's tag set.

Important details:

- **Labels do not propagate across `go` statements** unless the goroutine reads them from a `context.Context` it received. Pass `ctx` to every goroutine that should inherit the labels.
- **Cardinality matters.** Each unique combination of label values multiplies the profile size. Use bounded label values (`endpoint`, `method`, `status_class`), not unbounded ones (`request_id`, `user_id`).
- **CPU labels are independent of OpenTelemetry baggage.** They exist only in the profile.

Use case: "which tenant is consuming 30% of our CPU?" Tag with `tenant_id` and look at `(pprof) tags tenant_id` to see the distribution.

---

## 10. Combining profiles with traces

A CPU profile says *where* CPU went. A trace says *when* things happened. Together they explain *why* a particular request was slow.

```go
import "runtime/trace"

f, _ := os.Create("trace.out")
trace.Start(f)
// ... workload ...
trace.Stop()
```

```bash
go tool trace trace.out
```

The trace viewer shows per-goroutine timelines, GC pauses, syscall blocks, and channel sends. If a CPU profile is suspicious — "I see 50% CPU in `runtime.gcBgMarkWorker`" — the trace tells you whether that's distributed evenly (allocation-bound) or concentrated in spikes (one big burst).

Rule of thumb: profile first, trace when the profile raises a question it can't answer.

---

## 11. Profile drift across Go versions

| Version | Notable change |
|---------|----------------|
| 1.17 | Register-based ABI; some leaf frames merged differently |
| 1.18 | Generics; type parameters expand into multiple instantiations, each shown separately |
| 1.20 | New PGO (profile-guided optimization) using the same profile format |
| 1.21 | Improved inline-frame attribution in profiles |
| 1.22 | PGO devirtualization based on profiles |
| 1.24 | Refined signal handler for fewer false leaves |

When comparing profiles across major versions, treat function-name differences cautiously: a renamed runtime helper looks like a regression but isn't.

---

## 12. PGO: turning profiles into faster binaries

Since Go 1.20, the compiler can read a CPU profile and use it to guide inlining and devirtualization.

```bash
# Capture a representative production profile
curl -o default.pgo http://prod-host:6060/debug/pprof/profile?seconds=60

# Drop it next to main.go (the compiler picks it up automatically)
go build -pgo=auto ./cmd/server
```

Typical wins: 2–14% on real services. PGO is most effective when:

- The profile is captured from realistic load (synthetic benchmarks waste the optimization).
- The hot paths are stable across builds.
- The hot paths include indirect calls (interface methods, function values) — those benefit most from devirtualization.

Update the PGO file periodically; stale profiles can mis-guide the compiler.

---

## 13. Summary

A senior reads a CPU profile knowing it is a statistical sample taken via `SIGPROF`, with a fixed 10 ms resolution, biased by the signal-masking patterns of the runtime, and missing all off-CPU time. They understand the difference between flat and cumulative, watch for inlining-driven attribution errors, use labels to slice multi-tenant workloads, combine profiles with traces when the profile is silent, and apply diff (`-base`) comparisons before claiming a win. Once the mental model is sound, the actual commands (`top`, `list`, `web`) are a small surface — most of the skill is in interpretation.

---

## Further reading
- pprof profile.proto: https://github.com/google/pprof/blob/main/proto/profile.proto
- "Profile-guided optimization in Go 1.21": https://go.dev/blog/pgo
- `runtime/pprof` source: https://github.com/golang/go/tree/master/src/runtime/pprof
- Brendan Gregg, "Systems Performance" (chapter on profiling)
