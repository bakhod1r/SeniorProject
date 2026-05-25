# Memory Profiling in Go — Interview Questions

A set of conceptual and practical questions you should be able to answer fluently if you claim to know Go memory profiling. Each has a one-paragraph model answer plus the trap to avoid.

---

## Q1. What's the difference between `inuse_space` and `alloc_space`?

**Answer.** `inuse_space` is the bytes currently live on the heap, attributed to the call sites that allocated them. It drops when objects die. `alloc_space` is the cumulative bytes ever allocated by each call site since process start; it only grows.

**Use case split.** `inuse_space` for **leak hunting** (find what's still alive). `alloc_space` for **GC pressure** (find what's churning the allocator).

**Trap.** Confusing the two and concluding "the profile shows 2 GiB but my program is using 100 MiB" — that's almost always an `alloc_*` profile mistaken for `inuse_*`.

---

## Q2. What does `runtime.MemProfileRate` control?

**Answer.** It's the average number of bytes between recorded allocations. Default is 524,288 (512 KiB). The runtime decides whether to sample an allocation by drawing from a geometric distribution with this mean. `MemProfileRate = 1` records every allocation (high overhead); `MemProfileRate = 0` disables profiling entirely.

**Trap.** Thinking sampling is "every Nth allocation". It's not — it's a geometric distribution, so a 1 MiB object is almost always sampled while a 64-byte one is sampled ~0.01% of the time.

---

## Q3. Why doesn't my profile match `runtime.MemStats.HeapAlloc`?

**Answer.** Three reasons typically: (a) you might be looking at `alloc_*` (cumulative) when you wanted `inuse_*`; (b) the profile is sampled, so the totals are an estimate scaled from a small number of recorded samples; (c) you didn't pass `?gc=1` or call `runtime.GC()` before profiling, so the profile includes unswept garbage.

**Trap.** Assuming pprof is wrong. It's an estimator; expect ±10% on small numbers. Trust `MemStats` for absolute size, trust pprof for the per-call-site distribution.

---

## Q4. When would you set `MemProfileRate = 1`?

**Answer.** In tests and microbenchmarks where you need every allocation visible — especially when you suspect very small allocations are being missed by the default sampling. Use `go test -memprofilerate=1` rather than setting it in code. Never set this in production: the per-allocation stack walk overhead becomes significant.

**Trap.** Setting it in a long-running service to "get better data" — you'll see CPU usage rise visibly and the runtime's per-allocation table can grow into hundreds of MB.

---

## Q5. How do you diff two heap profiles?

**Answer.**

```bash
go tool pprof -base before.pb.gz after.pb.gz
(pprof) top
```

or for the web UI:

```bash
go tool pprof -base before.pb.gz -http=:8080 after.pb.gz
```

The `top` view shows positive deltas for sites that grew and negative for sites that shrank.

**Use case.** Leak hunting (compare profiles 30 minutes apart), regression detection (old release vs. new), optimization verification.

**Trap.** Diffing profiles taken with different `MemProfileRate` values — the per-sample scale doesn't match, and the deltas become meaningless.

---

## Q6. What HTTP endpoints does `net/http/pprof` register?

**Answer.** `/debug/pprof/` (index), `/debug/pprof/heap`, `/debug/pprof/allocs`, `/debug/pprof/goroutine`, `/debug/pprof/block`, `/debug/pprof/mutex`, `/debug/pprof/profile?seconds=N` (CPU), `/debug/pprof/trace?seconds=N`. The `heap` endpoint accepts `?gc=1` to force a GC first, and `?debug=1` or `?debug=2` for text formats.

**Trap.** Importing `_ "net/http/pprof"` registers these on `http.DefaultServeMux`. If your service uses the default mux for the public listener, you've just exposed pprof on the public internet. Use a dedicated mux on a dedicated, bound-to-localhost port.

---

## Q7. What is a flame graph and how do you read it?

**Answer.** A flame graph stacks call frames vertically (caller on bottom, callee on top) and sizes each frame's width by its share of the metric. Wider = more samples. The leaves (top) are the actual allocators; the root (bottom) is where work originated. Hovering shows the full stack and metric.

**Reading rule.** A wide leaf is a function that directly allocates a lot. A wide bottom frame with thin children is an entry point with diffuse allocation. Click to zoom into subtrees; switch metric (top-left dropdown) to compare `inuse_space` vs `alloc_objects`.

**Trap.** Comparing flame graphs by "height" — depth doesn't indicate cost, only call chain length.

---

## Q8. What's the difference between `flat` and `cum` in `pprof top`?

**Answer.** `flat` is what the function allocated **directly**, not counting its callees. `cum` is the cumulative total, including everything its callees allocated. A function with high `cum` and low `flat` is a "manager" — the real allocators are in its children. Sort by both.

**Trap.** Sorting only by `flat` and missing the real hot path because it goes through a wrapper function.

---

## Q9. How do you tell apart a heap leak from RSS not being released?

**Answer.** A heap leak is when `runtime.MemStats.HeapAlloc` rises over time. RSS-not-released is when `HeapAlloc` is stable but the process RSS reported by the OS is high. The latter is caused by Linux's `MADV_FREE` behavior — the runtime tells the kernel the pages are reclaimable, but the kernel doesn't reclaim them until under memory pressure, so RSS reads as high.

**Action.** For a real leak, fix the code. For retained RSS, either accept it (cosmetic), call `debug.FreeOSMemory()`, or set `GODEBUG=madvdontneed=1`. In containers with `GOMEMLIMIT`, neither is usually needed.

---

## Q10. Why does GC CPU matter, and which metric reflects it?

**Answer.** GC marking work is roughly proportional to the number of live objects (not bytes). If `GCCPUFraction` exceeds 15–20%, the GC is doing too much work. The profile metric that reflects this is `alloc_objects` — switch to it whenever you suspect GC pressure rather than total memory usage.

**Trap.** Looking at `alloc_space` and concluding "I allocate too many bytes" when the actual problem is "I allocate too many small objects". Different fixes (arena vs pool vs preallocation).

---

## Q11. How do you profile a benchmark?

**Answer.**

```bash
go test -bench=BenchmarkX -benchmem -memprofile=mem.out -memprofilerate=1 ./pkg
go tool pprof -http=:8080 mem.out
```

`-benchmem` prints exact `B/op` and `allocs/op` (from `MemStats` deltas). `-memprofile` writes a sampled profile. `-memprofilerate=1` makes the profile exact for the benchmark run.

**Trap.** Trusting `B/op` for a flame-graph distribution — `B/op` is a single aggregate number; the profile has the per-line breakdown.

---

## Q12. What is `pprof.Labels` and when do you use it?

**Answer.** A way to attach key/value pairs to all allocations made within a region:

```go
labels := pprof.Labels("endpoint", "/api/orders")
pprof.Do(ctx, labels, func(ctx context.Context) { /* ... */ })
```

The continuous profiler can then filter by label — "show me allocations for `/api/orders` only", or split a flame graph by label. This is how trace-to-profile linkage works in Datadog, Pyroscope, etc.

**Trap.** Putting high-cardinality labels (like user IDs or trace IDs as raw strings) into pprof labels — the in-memory label table grows unbounded.

---

## Q13. How does the heap profile differ from a heap dump?

**Answer.** A **heap profile** is sampled, attributes bytes to call sites, and is cheap to take. A **heap dump** is a full snapshot of every object in the heap with their references — far more expensive, far more detailed. Go has no first-class heap dump tool today (`runtime/debug.WriteHeapDump` exists but is unsupported and undocumented for general use). When you need "who holds this object?" the answer in practice is: capture a `goroutine` profile and read the stack traces; if that doesn't reveal it, instrument the code.

**Trap.** Looking for `jhat`/`jmap`-equivalent tooling in Go and being disappointed. The pprof-based approach is intentionally different.

---

## Q14. What's wrong with this code, from a memory-profiling perspective?

```go
func handle(req *Request) {
    raw, _ := io.ReadAll(req.Body)
    save(raw[:100])
}
```

**Answer.** `raw[:100]` retains the entire backing array. If `req.Body` was a multi-MB upload, the 100-byte slice keeps the whole thing alive in `save`'s data structures. The profile shows `inuse_space` for `save` much larger than expected because of the retained tail.

**Fix.** `save(slices.Clone(raw[:100]))` or copy explicitly. This is the canonical Go memory bug.

---

## Q15. What does `runtime.GC()` before profiling accomplish?

**Answer.** It forces a full collection so the profile reflects only objects that survived. Without it, the profile counts garbage waiting to be swept, which inflates `inuse_*` and obscures real retention. The cost is two STW pauses. The HTTP equivalent is `/debug/pprof/heap?gc=1`.

**Trap.** Forgetting this in test code and chasing a "leak" that's just unswept garbage.

---

## Q16. Walk me through diagnosing "memory grew from 200 MB to 2 GB overnight".

**Answer.**
1. Capture `/debug/pprof/heap?gc=1` immediately.
2. If a baseline from earlier exists, diff: `go tool pprof -base baseline.pb.gz current.pb.gz`. Otherwise, capture a second profile after a few minutes and diff those two.
3. Look at the top growers by `inuse_space`. Switch to `inuse_objects` to confirm the shape (many small vs few big).
4. Cross-check with `runtime.MemStats` for absolute numbers, and the `goroutine` profile in case a goroutine leak is upstream of the heap growth.
5. Identify the function or package responsible from the diff.
6. Reproduce locally with synthetic load; write a regression benchmark.
7. Apply the fix; verify with a fresh diff after deploy.

**Trap.** Skipping step 4 — many "heap leaks" are actually goroutine leaks where the goroutine retains the heap.

---

## Q17. What does `-base` do with two profiles taken with different `MemProfileRate`?

**Answer.** It produces nonsense. The per-sample scaling factor differs between the two, so subtraction mixes incompatible units. Always ensure both profiles were taken with the same rate.

**Practical note.** This is one reason `MemProfileRate` is treated as a constant for the life of a service. Set it once, leave it alone, or you lose the ability to diff.

---

## Q18. How is `sync.Pool` related to memory profiling?

**Answer.** A correctly-used `sync.Pool` reduces `alloc_objects` for the pooled type dramatically — often 10× or more — because the same backing object is reused across many calls. In the profile, the original allocation site shrinks; the `New` function's call site appears with the few times pool was empty. An incorrectly-used pool (forgetting to `Reset`, keeping oversized values) can *increase* `inuse_space` because the pooled objects accumulate growth.

**Trap.** Reaching for pools before profiling. They have real overhead when cold, and they make the code more complex; only apply where the profile justifies it.

---

## Q19. What's the relationship between escape analysis and the heap profile?

**Answer.** A heap profile only shows **heap** allocations. Stack allocations are invisible. Escape analysis (`go build -gcflags="-m"`) tells you which variables escaped to the heap and why. The two tools work together: the profile picks the hot allocation site, and the escape report explains the reason. Sometimes the fix is purely about preventing the escape (return value instead of pointer, avoid interface boxing).

**Trap.** Trying to "tune" a function that doesn't actually allocate on the heap — escape analysis says it stays on the stack, and the profile never showed it for that reason.

---

## Q20. What is continuous profiling and what does it buy you?

**Answer.** Continuous profiling means scraping `/debug/pprof/heap` (and CPU, allocs, goroutine) on a low cadence — say every 10–15 seconds — and persisting the profiles in a TSDB-like store (Pyroscope, Parca, Datadog Profiler). The benefit: at any point in time, you can ask "what did the heap look like in production five minutes ago?" without needing to re-run an incident. Diffs across arbitrary windows become trivial. The overhead at default `MemProfileRate` is well under 1% CPU.

**Trap.** Treating continuous profiling as a separate problem from ad-hoc profiling. It's the same data with persistent storage; the same techniques apply.

---

## Summary

If you can answer these 20 questions without hesitating, you can do most of the work a senior Go engineer is expected to do around memory diagnosis. The patterns are small in number — sampling math, the four metrics, diffs, escape analysis pairing, the common bugs — and they recur. Practice by capturing profiles of your own code and forcing yourself to articulate which metric you'd choose and why.

---

## Further reading
- Diagnostics in Go: https://go.dev/doc/diagnostics
- pprof docs: https://github.com/google/pprof/blob/main/doc/README.md
- Go profiler notes: https://github.com/DataDog/go-profiler-notes
