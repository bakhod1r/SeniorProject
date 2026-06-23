# Memory Profiling in Go — Senior

## 1. What sampling actually means

A Go heap profile is **not** a list of every allocation. It is a list of allocations the runtime decided to record, drawn from a geometric distribution with mean `runtime.MemProfileRate` bytes. The profile then **scales each recorded sample back up** so the reported totals approximate the unsampled truth.

The result is unbiased *in expectation* but noisy in any single run. Concretely:

| Allocation size | Probability of being sampled (rate = 512 KiB) | Effect on profile |
|-----------------|-----------------------------------------------|-------------------|
| 1 MiB | ~86% | Almost always represented; numbers accurate |
| 64 KiB | ~12% | Recorded sometimes; representation noisy |
| 1 KiB | ~0.2% | Mostly invisible per individual allocation |
| 16 B | ~0.003% | Effectively missing unless extremely frequent |

A million 16-byte allocations are still likely to show up in aggregate (because in aggregate they total 16 MB, and 16 MB / 512 KiB ≈ 32 samples — enough to be visible). One million such allocations spread across a thousand call sites is *not* — each site only gets ~0.03 samples on average, so the profile becomes essentially blind.

Internalize this: **the profile sees bytes, not events.** A site allocating few large objects looks identical to a site allocating many small ones of the same total size, except the latter may be under-represented.

---

## 2. Why sampled and not exact

Recording every allocation has measurable cost: a write to the per-allocation record table, a stack walk (~tens of nanoseconds), an atomic counter bump. For a server allocating 10 M times per second, exact recording would burn 10–30% of CPU on profiling overhead alone.

Sampling with a 512 KiB mean reduces this by ~5 orders of magnitude. The runtime walks the stack on average once per 512 KiB, instead of once per object. The result is *cheap enough to leave on in production* — which is the entire point. Continuous profiling exists because sampling is cheap.

The catch is variance. To halve the variance of a per-site number, you need 4× the samples — which usually means either lowering `MemProfileRate` (more CPU) or sampling over a longer window (which won't help if the program isn't steady-state).

---

## 3. The math: how the scale-up works

When the runtime decides to record an allocation of size `s`, it stores the actual `s` in the sample. At report time, pprof multiplies each sample's count by the **scaling factor**:

```
scale(s) = 1 / (1 - exp(-s / MemProfileRate))
```

This compensates for the bias toward sampling large objects. The intuition: a 1 MiB object is sampled almost always, so its weight is ~1. A 64 KiB object is sampled ~12% of the time, so its weight is ~8 — each recorded 64 KiB sample stands in for ~8 actual allocations at that site.

Result: the reported bytes are an unbiased estimator of total bytes allocated. The reported **object counts** are also unbiased (each sample is scaled to represent the right number of allocations).

If you want to verify this in code, the runtime exposes `runtime.MemProfile([]MemProfileRecord, true)` which returns the raw, unscaled samples — useful for unusual analyses but rarely needed.

---

## 4. `MemProfileRate` trade-offs

| Value | Per-allocation overhead | Sample size per second at 1 GB/s alloc rate | When to use |
|-------|-------------------------|---------------------------------------------|-------------|
| `0` | 0 | 0 | Production where profiling is forbidden |
| `512 * 1024` (default) | Negligible | ~2,000 | Production |
| `64 * 1024` | Small | ~16,000 | Local debugging, staging |
| `4096` | Moderate | ~256,000 | Microbenchmarks |
| `1` | Substantial (every alloc walks the stack) | All | Tests where exactness matters |

Set it **at startup** before significant allocation occurs. Changing it mid-run is legal but produces inconsistent records (samples taken at the old rate are scaled at the new rate, so totals get distorted).

```go
import "runtime"

func init() {
    runtime.MemProfileRate = 4096   // 128× more samples than default
}
```

For tests, `go test -memprofilerate=1` is more convenient than setting it in code.

---

## 5. Profile bias to recognize

Even with the scaling correction, three biases remain.

**Bias toward live, large, long-lived allocations in `inuse_*`.** An object that died before the profile was captured contributes zero; an object still alive at profile time contributes its full bytes. Captured at the wrong moment, a profile can miss massive churn entirely. Mitigation: capture multiple times during the workload and compare.

**Bias against unsampled small allocations.** A function that allocates ten million 8-byte structs at a site that gets no sample contribution is *invisible*. Mitigation: lower `MemProfileRate` if you suspect this.

**Bias toward the leaf of the stack.** The recorded stack is the moment of allocation — the function that called `mallocgc`. If the same site allocates from multiple callers, the profile aggregates them at the leaf. Use `peek` or `tree` to disaggregate.

---

## 6. Reconciling `inuse_*` against `MemStats`

A senior should be able to explain the gap between these three numbers without flinching:

| Source | What it shows |
|--------|---------------|
| `runtime.MemStats.HeapAlloc` | Exact live heap bytes at read time |
| `runtime.MemStats.TotalAlloc` | Exact cumulative heap bytes since process start |
| `pprof -inuse_space` total | Estimate of live heap bytes via samples |
| `pprof -alloc_space` total | Estimate of cumulative heap bytes via samples |

If `HeapAlloc` and `pprof -inuse_space` disagree by more than ~10%, the sample count is too low. Lower `MemProfileRate` for the next capture, or take a longer-running sample.

If `pprof -alloc_space` total is enormous and `HeapAlloc` is small, that's *normal* — you allocate fast, the GC reclaims fast. The two metrics are measuring different things.

If they agree perfectly, you might be running `MemProfileRate=1`, which is great for accuracy and terrible for production overhead.

---

## 7. The "GC happened mid-profile" problem

`pprof.WriteHeapProfile` does **not** force a GC by default. Without one, the profile contains "garbage that hasn't been swept yet" alongside truly live objects. The `inuse_*` numbers will appear inflated.

```go
runtime.GC()
runtime.GC()                     // second GC sweeps remnants from the first
pprof.WriteHeapProfile(f)
```

Two GCs in a row is a paranoid pattern that ensures the profile reflects only objects that survived a full cycle. For HTTP capture, the equivalent is `/debug/pprof/heap?gc=1`.

The trade-off is that you've now paused the program for two STW windows. In production, prefer fewer profiles with `gc=1` over many without — the data is cleaner and the operational cost is similar.

---

## 8. Integration with escape analysis

`-gcflags="-m"` and `pprof` are complementary: the profile picks **where**, the escape report explains **why**.

Workflow for an allocation hotspot:

1. Profile points at `pkg/parser.parseHeader`.
2. `go build -gcflags="-m -m" ./pkg/parser` reveals the lines that escape.
3. Read the reasons: "leaking param `h`", "moved to heap: `tmp`", "[]byte literal does not escape".
4. Modify the code to keep the variable on the stack (pass by value, accept output param, drop interface conversion).
5. Re-profile; the site should drop or vanish.

Sample output to learn to read:

```
./parser.go:32:13: parseHeader h does not escape
./parser.go:35:14: make([]byte, sz) escapes to heap
./parser.go:38:9: &tmp escapes to heap
./parser.go:38:9: moved to heap: tmp
```

Each line is one allocation reason. Senior engineers can spot a "moved to heap" by reading the source without compiling — but they still re-check with `-gcflags=-m` because the analyzer is the source of truth.

---

## 9. When `alloc_objects` matters more than `alloc_space`

GC marking time is proportional to **object count**, not byte total. If your GC CPU is the problem:

```
(pprof) sample_index=alloc_objects
(pprof) top -cum
```

A site that allocates 10 KB by way of 10 million 1-byte allocations costs the GC orders of magnitude more than one allocating 1 GB as a single slice. The first is the kind of bug you fix by switching to a `[]byte` pool or arena; the second is a non-bug.

Practical rule: if `runtime.GCCPUFraction` exceeds 15% but the heap is small, switch to `alloc_objects` first. The big-bytes site that `alloc_space` shows you may not be the one causing the GC pain.

---

## 10. Heap leaks vs RSS not-released

These two are different problems with different symptoms, and a senior must keep them straight.

| Symptom | Diagnosis | Tool |
|---------|-----------|------|
| `HeapAlloc` rises over time | Real heap leak | `pprof -base` diff |
| `HeapAlloc` stable, `HeapInuse` rises | Fragmentation in spans | Less common; check `HeapSys` |
| `HeapAlloc` stable, RSS rises | Pages not yet returned to OS | Check `HeapReleased`, `madvdontneed` |
| `HeapAlloc` falls after GC, RSS does not | `MADV_FREE` lazy reclaim | Either ignore or `debug.FreeOSMemory` |

The profile shows you Go-runtime accounting. RSS is what the kernel reports. They diverge whenever the runtime is holding mapped pages it hasn't returned. On Linux with `MADV_FREE` (default since Go 1.12), they routinely diverge for tens of minutes after a workload peak.

If a profile says everything is fine but the on-call dashboard says RSS is climbing, look at `HeapReleased` and `Sys` from `MemStats` before assuming pprof is lying.

---

## 11. Differential profiles at scale

A single diff is useful. A **time series of diffs** is transformative. The recipe:

1. Scrape `/debug/pprof/heap?gc=1` every N minutes (10–15 is typical).
2. Persist as `heap-<timestamp>.pb.gz`.
3. For each pair of adjacent profiles, compute and store the diff totals per call site.
4. Plot the top growers over time.

This is what Pyroscope, Parca, and Datadog Profiler do, and it's tractable to build yourself for a single service. The output: a flame graph that shows what *grew* in the last hour, instead of what's biggest now. Leaks become obvious because the same site grows on every successive diff.

---

## 12. Profile bloat and noise

Real profiles often contain stacks like:

```
runtime.mallocgc
runtime.makeslice
encoding/json.(*decodeState).literalStore
encoding/json.(*decodeState).objectInterface
encoding/json.(*decodeState).value
... 40 more frames ...
```

Two senior-level tricks to make this readable:

**`granularity=lines`.** Aggregates by source line, so two callers of the same function appear as distinct entries when they hit different lines.

**Focus and ignore.** `(pprof) focus=myapp` only shows stacks that include a frame matching `myapp`. `(pprof) ignore=runtime` drops runtime frames from the output. Combine them: `focus=myapp; ignore=runtime.mallocgc`.

These don't change the data, only the view. Use them to cut through stdlib noise when hunting your own bugs.

---

## 13. Summary

A Go heap profile is a sampled, scaled estimate — cheap, statistically unbiased, and noisy on individual sites. `MemProfileRate` controls the trade-off between fidelity and overhead; 512 KiB is the production default. The four metrics (`inuse_objects/space`, `alloc_objects/space`) answer different questions: leaks, GC pressure, and the per-site distribution of each. Pair pprof with `-gcflags="-m"` to go from *where* to *why*, and pair it with `runtime.MemStats` whenever absolute numbers matter. Differential profiles, not single snapshots, are how leaks get caught in real services.

---

## Further reading
- pprof reading guide: https://github.com/google/pprof/blob/main/doc/README.md
- Heap profiling internals (Felix Geisendörfer): https://github.com/DataDog/go-profiler-notes/blob/main/heap.md
- `runtime.MemProfile` source: https://github.com/golang/go/blob/master/src/runtime/mprof.go
- Escape analysis crash course: https://github.com/golang/go/blob/master/src/cmd/compile/internal/escape/escape.go
