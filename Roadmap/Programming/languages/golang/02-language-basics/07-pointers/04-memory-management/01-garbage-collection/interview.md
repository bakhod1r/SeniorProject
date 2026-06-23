# Go Garbage Collection — Interview Questions

## Junior

**Q1: Does Go have a garbage collector?**

**Answer**: Yes. Go uses a concurrent, tri-color, mark-sweep, non-generational, non-moving garbage collector. You don't free memory manually.

---

**Q2: What's `GOGC`?**

**Answer**: Env var controlling GC trigger frequency. Default 100 means GC runs when heap reaches 2× live size.

```bash
GOGC=200 ./prog  # less GC, more memory
GOGC=50  ./prog  # more GC, less memory
```

---

**Q3: How long are GC pauses?**

**Answer**: Modern Go (1.14+) typically <1 ms. STW phases bookend the cycle; concurrent phases run alongside user code.

---

**Q4: Should I call `runtime.GC()`?**

**Answer**: Almost never. The runtime decides when to run GC. Manual calls add CPU overhead without benefit. Exceptions: deterministic tests.

---

**Q5: What's `GOMEMLIMIT`?**

**Answer**: Soft memory cap (Go 1.19+). GC runs more aggressively as heap approaches the limit. Helps prevent OOM in containers.

---

## Middle

**Q6: Explain tri-color marking.**

**Answer**:
- White: not visited.
- Grey: visited but children not yet processed.
- Black: visited and children processed.

Mark phase: roots → grey. Process grey: examine children, mark them grey, mark self black. Repeat until no grey. White = unreachable.

---

**Q7: What's the hybrid write barrier?**

**Answer**: Combination of Yuasa (deletion) and Dijkstra (insertion) barriers. Eliminates need for STW stack rescan. Each pointer mutation in heap memory triggers `runtime.gcWriteBarrier`.

---

**Q8: How does mark assist work?**

**Answer**: When a goroutine allocates, it accumulates "GC debt". If debt exceeds threshold, the goroutine helps with marking before continuing its allocation. Bounds heap overshoot during spikes.

---

**Q9: What's the GC pacer's goal?**

**Answer**: Keep CPU usage at ~25% of one logical CPU while meeting the heap target. Adjusts trigger ratio dynamically based on observed allocation rate and mark cost.

---

**Q10: How do I reduce GC overhead in a hot service?**

**Answer**:
1. Reduce allocation rate (`sync.Pool`, pre-allocate).
2. Reduce pointer density (`[]T` over `[]*T`).
3. Raise GOGC (less frequent GC).
4. Set GOMEMLIMIT to bound max heap.
5. Profile with `pprof -alloc_space`.

---

## Senior

**Q11: Walk through the GC phases.**

**Answer**:
1. Sweep termination (STW): finish prior cycle.
2. Mark setup (STW): enable write barriers, scan roots.
3. Concurrent mark: process grey, run barriers.
4. Mark termination (STW): drain workbufs, disable barriers.
5. Concurrent sweep: free unreached.

STW phases ~µs-ms; concurrent phases ~ms-seconds depending on heap size.

---

**Q12: Why does Go's GC scan stacks?**

**Answer**: Stacks contain pointer fields (locals, params). The GC follows these as roots. Each goroutine's stack scanned once per cycle (avoids stack rescan thanks to hybrid write barrier).

---

**Q13: Explain the pacer's PI controller.**

**Answer**: Proportional-Integral controller adjusting trigger ratio. Tracks actual GC CPU usage vs target (25%). Proportional component reacts to current error; integral component handles accumulated offset over time. Adapts to changing allocation patterns.

---

**Q14: What's the difference between `runtime.GC()` and `debug.FreeOSMemory()`?**

**Answer**:
- `runtime.GC()`: forces a GC cycle. Reclaims unreachable heap memory, but doesn't return pages to OS.
- `debug.FreeOSMemory()`: same plus aggressively scavenge — returns unused heap pages to the OS.

Use `FreeOSMemory` rarely; can hurt performance.

---

**Q15: Why doesn't Go have a generational GC?**

**Answer**: Go's design favors simplicity and concurrent operation. Generational GC adds complexity (write barriers between generations, copy operations). Go's escape analysis pushes short-lived allocations to the stack, reducing the benefit of a young generation.

Newer experiments (Green Tea GC) explore alternative approaches.

---

## Scenario

**Q16: Heap grows over hours; OOM. Where to look?**

**Answer**:
1. `pprof` heap profile: identify retained objects.
2. `pprof` goroutine profile: detect goroutine leaks.
3. Look for sub-slice memory pinning.
4. Check for maps that don't shrink after deletes.
5. Long-lived caches without bounds.

---

**Q17: Pause times exceed our 50 ms SLO. How to fix?**

**Answer**:
1. Profile: identify allocation hot spots.
2. Reduce pointer density (`[]T` over `[]*T`).
3. Use `sync.Pool` for hot reuse.
4. Raise GOGC to reduce GC frequency (trade memory for less CPU + lower frequency).
5. Set GOMEMLIMIT.
6. Reduce goroutine count (each adds stack scan time).
7. Use latest Go version (GC improves each release).

---

## FAQ

**Why is Go's GC concurrent but C/C++ have manual memory management?**

C/C++ favor explicit control. Go favors simplicity and safety. Concurrent GC achieves low pause times while preserving memory safety.

---

**Can I tune the GC to use less memory?**

Yes:
- Lower GOGC (more frequent, less memory).
- Set GOMEMLIMIT.
- Reduce allocation rate.

But trades CPU for memory.

---

**What's the cost of a GC cycle?**

CPU: ~5-10% of total program CPU in typical workloads.
Pauses: <1 ms STW typical.
Memory: ~2× live heap headroom (with default GOGC).

---

**Where's the GC documented in detail?**

[Go GC Guide](https://go.dev/doc/gc-guide).
