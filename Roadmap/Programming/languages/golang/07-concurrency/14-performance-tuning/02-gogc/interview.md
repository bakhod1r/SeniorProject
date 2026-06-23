# GOGC and GOMEMLIMIT — Interview Questions

Questions range from junior screening to staff-level deep dives. Each entry has the question, a short reference answer, and the level it usually targets.

---

## Basics

### Q1. What does `GOGC=100` mean?

**Level:** Junior.

**Answer.** It means GC starts when the heap has grown to 100% above the live size measured at the previous GC — i.e., the heap has doubled. With live=200 MiB and `GOGC=100`, the next GC fires when the heap reaches ~400 MiB.

---

### Q2. What is `GOMEMLIMIT` and when was it added?

**Level:** Junior.

**Answer.** A soft memory limit, in bytes, that the Go runtime tries to stay below by collecting more aggressively. It was added in Go 1.19. It is "soft" — the runtime never refuses allocations to honour it, only changes GC behaviour.

---

### Q3. How are `GOGC` and `GOMEMLIMIT` combined?

**Level:** Junior / Middle.

**Answer.** Each cycle the pacer computes two candidate heap goals: one from `GOGC` (`live × (1+GOGC/100)`), one from `GOMEMLIMIT` (a function of the limit and current overhead). The actual goal is the minimum of the two.

---

### Q4. Should I ever set `GOGC=off`?

**Level:** Junior / Middle.

**Answer.** Rarely. Legitimate uses: short-lived CLI tools where GC overhead is wasted, or debugging allocation patterns. For long-running services it is a memory leak waiting to happen and will OOM.

---

### Q5. What happens if I never set `GOMEMLIMIT` in a container?

**Level:** Junior.

**Answer.** The Go runtime is unaware of the container's memory limit. The heap can grow until the kernel OOM-kills the process. `GOMEMLIMIT` ≈ 90% of the container limit is the standard recommendation.

---

## GC Mechanics

### Q6. Walk through a Go GC cycle.

**Level:** Middle.

**Answer.** Four phases: (1) sweep termination — brief STW to finish previous cycle's sweep and start new cycle, (2) concurrent mark with write barrier active — goroutines run, allocations may incur assist debits, (3) mark termination — brief STW to finalise, (4) concurrent sweep — lazy, paid for by the allocator as it touches spans.

---

### Q7. What is the write barrier and why does Go need one?

**Level:** Middle / Senior.

**Answer.** A small piece of code injected at pointer writes during the mark phase. Concurrent mark risks missing newly-reachable objects if the mutator creates a pointer from an already-scanned (black) object to an unscanned (white) object. The write barrier "shades" affected objects grey so they get visited, preserving the tri-colour invariant.

---

### Q8. What is GC assist?

**Level:** Middle / Senior.

**Answer.** A mechanism that forces fast-allocating goroutines to do mark work themselves, so allocation cannot outpace collection. Each allocation during mark incurs a debit; when a goroutine's debit exceeds its credit, it is parked and made to scan objects until the debt is repaid.

---

### Q9. Why are Go GC pauses so short?

**Level:** Middle.

**Answer.** Most of the work (marking and sweeping) is concurrent with the application. Only two short STW phases remain — sweep termination and mark termination — both designed to take well under a millisecond in healthy programs. The hybrid write barrier (Go 1.8) reduced STW2 significantly by removing the need for a global stack rescan.

---

### Q10. Is Go's GC generational?

**Level:** Middle / Senior.

**Answer.** No. Go uses a non-generational, non-moving, concurrent tri-colour mark-and-sweep collector. The Go team has analysed generational designs and concluded the trade-off (write barrier always on, no compaction) does not pay off given escape analysis already handles most short-lived objects on the stack.

---

## Tuning

### Q11. How do you tune a Go service for throughput?

**Level:** Middle.

**Answer.** Raise `GOGC` (200, 500, even higher) so the heap grows more between collections and total GC CPU drops. Leave `GOMEMLIMIT` unset if memory is cheap. Confirm via `gctrace` that GC CPU fraction is now low. Reducing allocations is still the primary lever.

---

### Q12. How do you tune for latency?

**Level:** Middle.

**Answer.** Focus on reducing allocations first — fewer objects mean shorter mark phases and less GC assist on request paths. Leave `GOGC` at default. Set `GOMEMLIMIT` to bound peak memory but well above the working set so death spiral is unlikely. Use `sync.Pool` for hot buffers.

---

### Q13. What's the recipe for a Go service in a containerised environment?

**Level:** Middle.

**Answer.** Set `GOMEMLIMIT` to ~90% of the container's memory limit. Leave `GOGC` at the default unless evidence says otherwise. The margin covers stacks, runtime overhead, and cgo memory the soft limit does not strictly include.

---

### Q14. Why can `GOMEMLIMIT` cause CPU spikes?

**Level:** Middle / Senior.

**Answer.** If the limit is below the live working set, the pacer brings the trigger forward, GC fires constantly trying to reclaim memory that is genuinely needed, and the runtime spends up to 50% of CPU on GC before the cap kicks in. The fix is to raise the limit or reduce the working set.

---

### Q15. What is the 50% CPU cap?

**Level:** Senior.

**Answer.** A safeguard introduced in Go 1.19. Even if respecting `GOMEMLIMIT` would require more, the runtime refuses to spend more than ~50% of CPU on GC. It accepts memory overshoot rather than make the program unresponsive. Visible signature: `gctrace` lines with `P%` glued at ~50% across cycles.

---

## Tools and Observability

### Q16. How do you observe GC behaviour?

**Level:** Junior / Middle.

**Answer.** `GODEBUG=gctrace=1` for a one-line-per-cycle log. `runtime.ReadMemStats` for ad-hoc inspection. `runtime/metrics` for stable, low-overhead metrics (preferred in new code). `pprof --heap`, `--alloc_objects`, `--alloc_space` for allocation profiling.

---

### Q17. Read this gctrace line: `gc 12 @1.234s 3%: 0.018+0.42+0.01 ms clock, ... 96->100->48 MB, 100 MB goal`.

**Level:** Middle.

**Answer.** 12th GC cycle, started 1.234 s after program start. Total GC CPU since start is 3%. Wall-clock: STW1 18 µs, concurrent mark 420 µs, STW2 10 µs. Heap was 96 MB at start, 100 MB at mark termination, 48 MB live at end of cycle. Next GC target: 100 MB.

---

### Q18. What does `HeapInuse - HeapAlloc` represent?

**Level:** Senior.

**Answer.** The fragmentation footprint inside in-use spans. `HeapInuse` is bytes in spans currently allocated to objects; `HeapAlloc` is bytes in live objects. The difference is freed-but-not-coalesced fragments within those spans.

---

### Q19. When should you call `runtime.GC()`?

**Level:** Junior / Middle.

**Answer.** Almost never in production. Acceptable in tests and benchmarks for a known baseline, and occasionally before a known idle period to release memory promptly. Never in a per-request path — it is synchronous and blocks.

---

### Q20. What does `runtime/metrics:/cpu/classes/gc/mark/assist:cpu-seconds` tell you?

**Level:** Senior.

**Answer.** Cumulative CPU time spent in GC assist — work charged to user goroutines because dedicated mark workers could not keep up. A growing assist share signals allocation pressure that is leaking into request latency.

---

## Architecture

### Q21. How does `sync.Pool` interact with GC?

**Level:** Senior.

**Answer.** Each GC cycle, the main pool moves to a victim cache and the new main pool starts empty. The victim cache survives one more cycle, then is dropped. Effective lifetime of a pooled item is at most one full GC cycle. Pooling does not hide leaks but does reduce allocation pressure for items reused rapidly.

---

### Q22. Why does `sync.Pool` use per-P sharding?

**Level:** Senior.

**Answer.** To avoid contention on `Get`/`Put`. Each P has its own local pool; the fast path needs no locks. Stealing across Ps happens only when the local is empty. The cost is that you cannot use `sync.Pool` as a hand-off between specific goroutines.

---

### Q23. How does escape analysis affect GC pressure?

**Level:** Senior.

**Answer.** Values that do not escape stay on the goroutine stack and are reclaimed automatically at function return — zero GC cost. Values that escape are allocated on the heap and counted toward live heap, scanned each cycle, and eventually swept. Reducing escapes is one of the most effective ways to reduce GC pressure.

---

### Q24. You have a service with high tail latency. GC is suspected. How do you confirm?

**Level:** Senior.

**Answer.** Run with `GODEBUG=gctrace=1` and correlate STW pauses with the slow requests by timestamp. Inspect `runtime/metrics:/cpu/classes/gc/mark/assist:cpu-seconds` to see if assist time is significant. Use `pprof --alloc_objects` to identify allocation hot spots. Look for goroutines that allocate heavily in the same path as slow requests.

---

### Q25. The pacer's behaviour changed between Go 1.18 and 1.19. What changed?

**Level:** Senior / Staff.

**Answer.** Go 1.19 redesigned the pacer to incorporate `GOMEMLIMIT` as a first-class control. The trigger-ratio learner was replaced with a more predictive model. Stack scan time is now accounted for in goal calculations. A 50% CPU cap was added to prevent death spirals. Cycle-to-cycle variance dropped.

---

## Deep Dives

### Q26. Walk through what happens when a goroutine calls `make([]byte, 8192)` during the mark phase.

**Level:** Senior / Staff.

**Answer.** The allocation comes from the P's local mcache (size-class 8192). The goroutine accrues an assist debit proportional to 8192 bytes × current `assistWorkPerByte`. If its credit covers the debit, the call completes. If not, the goroutine is parked into the mark queue and scans objects until the debit is repaid. During scanning, if it encounters pointers, the write barrier (already active during mark) ensures new pointers are shaded.

---

### Q27. Why does the runtime not just read the cgroup memory limit automatically?

**Level:** Senior / Staff.

**Answer.** The cgroup limit is OS-specific (Linux only, varies between cgroup v1 and v2, may be misconfigured). The Go runtime aims to be portable. Letting operators set `GOMEMLIMIT` explicitly via env var ensures the value is intentional. Some projects use third-party libraries (`go.uber.org/automemlimit`) to bridge this gap.

---

### Q28. What's the difference between `Sys` and RSS as reported by the OS?

**Level:** Senior.

**Answer.** `Sys` is bytes the Go runtime has obtained from the OS via `mmap`. RSS is what the kernel considers actually resident in physical memory. `Sys` can exceed RSS (memory paged out or mapped-but-not-touched) or be less than RSS (memory the runtime returned but the kernel still considers resident). `GOMEMLIMIT` controls `Sys`-adjacent measurements, not RSS.

---

### Q29. When would you set `GOGC=off` with `GOMEMLIMIT`?

**Level:** Staff.

**Answer.** A "GC only when forced" pattern. Useful for workloads where: (a) the working set is stable and well-known, (b) latency is dominated by allocation rather than GC, and (c) memory pressure is the meaningful constraint. Risky — needs careful measurement and bursty-load testing. Document heavily.

---

### Q30. Design a load-shedding mechanism that uses GC metrics.

**Level:** Staff.

**Answer.** Periodically sample `runtime/metrics:/cpu/classes/gc/total:cpu-seconds` (or a derivative — fraction of recent CPU). If it exceeds a threshold (e.g., 30%), start returning HTTP 503 to new requests until the metric drops. Combine with admission control that limits concurrent in-flight requests. The goal: avoid death spiral by shedding load before the runtime hits its 50% cap.

---

## Behavioural

### Q31. Tell me about a time you tuned GC in production.

**Level:** Senior+.

**Hint.** Look for: structured approach (measure first, profile, then tune), correct vocabulary (GOGC/GOMEMLIMIT/pacer/assist), recognising that allocation reduction beats tuning, and a real outcome with numbers.

---

### Q32. You raise `GOGC` from 100 to 300. What measurements do you check after?

**Level:** Senior.

**Answer.** GC frequency (lower), GC CPU fraction (lower), peak heap and RSS (higher), tail latency (likely lower because fewer mark cycles), and `GOMEMLIMIT` headroom (less). Confirm no OOMs. Look for `gctrace` "P%" trending down.

---

### Q33. A teammate proposes `runtime.GC()` after each batch in a stream processor. How do you respond?

**Level:** Senior.

**Answer.** Push back. `runtime.GC()` is synchronous and blocks the calling goroutine. It defeats the concurrent collector. If memory smoothing is desired, set `GOMEMLIMIT` instead — the runtime will collect at the right time. If RSS reclamation is needed at known idle moments, `debug.FreeOSMemory()` is the heavier hammer for those rare cases.

---

### Q34. Your service uses `GOGC=off` and `GOMEMLIMIT=2GiB`. The on-call sees memory at exactly 2 GiB and CPU at 80%. What's happening?

**Level:** Staff.

**Answer.** Live data has approached or exceeded `GOMEMLIMIT`. With GC otherwise disabled, the runtime is collecting purely from memory pressure. CPU is climbing because each collection finds little to free. The 50% cap should keep CPU below 50%; 80% suggests something else is also using CPU. Diagnosis: profile to confirm GC share is at the cap, then either reduce working set or raise the limit.

---

### Q35. How do you decide whether GC is your bottleneck?

**Level:** Senior.

**Answer.** Run `pprof` and look at CPU samples: if more than ~10–15% are in `runtime.gcBgMarkWorker`, `runtime.gcAssistAlloc`, or `runtime.scanobject`, GC is meaningful. Check `runtime.MemStats.GCCPUFraction`. Confirm with `gctrace` that cycles are frequent or assist times are high. Cross-reference with the workload's tail latency — short GC pauses but heavy assist time can still hurt P99.

---
