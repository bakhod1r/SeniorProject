# Go Memory Management — Interview Questions

## Junior

**Q1: How does Go manage memory?**

**Answer**: Automatically. The compiler allocates (stack/heap based on escape analysis); the GC reclaims unreferenced heap memory.

**Q2: What's the difference between stack and heap?**

**Answer**:
- Stack: per-goroutine, freed at function return, fast.
- Heap: shared, GC'd, slower.

Compiler decides per variable (escape analysis).

**Q3: What does `new` do?**

**Answer**: Allocates a zero-initialized value, returns a pointer:
```go
p := new(int) // *int → 0
```

**Q4: What does `make` do?**

**Answer**: Allocates and initializes slices, maps, channels:
```go
s := make([]int, 5, 10)
m := make(map[string]int)
c := make(chan int, 10)
```

For other types, use `new` or `&T{...}`.

**Q5: When does the GC run?**

**Answer**: Automatically based on allocation rate. The default `GOGC=100` triggers GC when heap size doubles.

---

## Middle

**Q6: What is escape analysis?**

**Answer**: Compile-time analysis to determine whether a variable can stay on the stack or must go on the heap. Verify with `go build -gcflags="-m"`.

**Q7: How does `sync.Pool` reduce GC pressure?**

**Answer**: Pools reusable objects. Reduces allocation rate; fewer GC cycles. Reset before returning to avoid data leaks.

**Q8: What's GOGC?**

**Answer**: Env var controlling GC aggressiveness. Default 100 means GC runs when heap doubles. Higher = less GC, more memory. Lower = more GC, less memory.

**Q9: Why might `[]Item` be better than `[]*Item` for high throughput?**

**Answer**: Fewer GC roots, contiguous memory (cache-friendly), single allocation. For owned data, prefer values.

**Q10: What's `GOMEMLIMIT`?**

**Answer**: Soft memory limit (Go 1.19+). GC runs more aggressively as the limit approaches; helps prevent OOM in containers.

---

## Senior

**Q11: Walk through the Go allocator.**

**Answer**: Layered:
- mcache (per-P, fast).
- mcentral (per size class, shared).
- mheap (page allocator, OS interaction).

Small allocs (≤32 KB) go through mcache → mcentral → mheap as needed. Large allocs go directly to mheap.

**Q12: Explain the GC pacer.**

**Answer**: Decides when to run GC and how aggressively. Goal: keep CPU usage at ~25% while staying within heap target.

Inputs: allocation rate, mark cost. Output: trigger ratio.

**Q13: How do write barriers work?**

**Answer**: During concurrent marking, every pointer write in heap memory calls `runtime.gcWriteBarrier` to record the change. Required for GC correctness.

Cost: ~2 cycles (no-op when GC inactive).

**Q14: Why doesn't a map shrink after `delete`?**

**Answer**: The bucket array doesn't shrink automatically. To reclaim, create a new map and copy entries.

**Q15: What's the cost of pointer density in a hot data structure?**

**Answer**: Each pointer field is a GC root. For 1M objects with 10 pointer fields each = 10M roots. GC scan time scales linearly.

For high throughput, prefer value fields when ownership is exclusive.

---

## Scenario

**Q16: Heap grows over hours; eventually OOM. Where to look?**

**Answer**:
1. Profile: `pprof http://...:6060/debug/pprof/heap`.
2. Check for goroutine leaks: `pprof goroutine`.
3. Look for sub-slice memory pinning.
4. Check map shrinkage issues.
5. Review long-lived caches.

**Q17: GC pauses are too long for our SLO. What do you try?**

**Answer**:
1. Reduce pointer density (`[]T` over `[]*T`).
2. Use `sync.Pool` to reduce alloc rate.
3. Tune GOGC higher (less frequent, but higher memory).
4. Set GOMEMLIMIT (Go 1.19+) to control max RSS.
5. Profile with `gctrace` and `pprof`.

---

## FAQ

**Should I call `runtime.GC()`?**

Almost never. The runtime decides. Exceptions: tests that need deterministic timing, before sensitive measurements.

**Why is my program's RSS larger than HeapAlloc?**

RSS includes heap + stacks + allocator reservations + Go runtime overhead. Use `MemStats.Sys` for total runtime memory.

**Can I disable GC?**

`GOGC=off` disables. NEVER do this in production; eventually OOM.

**Where's the memory model documented?**

https://go.dev/ref/mem.
