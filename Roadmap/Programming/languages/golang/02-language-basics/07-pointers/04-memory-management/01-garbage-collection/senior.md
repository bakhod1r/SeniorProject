# Go Garbage Collection — Senior Level

## 1. Overview

Senior-level mastery: precise reasoning about pacer dynamics, mark assist, hybrid write barrier, scavenging, and production tuning for low-latency or high-throughput services.

---

## 2. Advanced Semantics

### 2.1 Hybrid Write Barrier (Go 1.8+)

Go's write barrier combines elements of Yuasa's deletion barrier and Dijkstra's insertion barrier.

For `slot = ptr`:
1. Shade the OLD value of `slot` (deletion barrier).
2. Shade `ptr` if the goroutine's stack is grey (insertion-like).

This eliminates the need for a stack rescan during mark termination, reducing STW time.

### 2.2 Mark Assist

When a goroutine allocates, it accumulates "GC debt" proportional to bytes allocated. If debt exceeds a threshold, the goroutine helps with marking before continuing.

Implementation: each allocation checks `g.gcAssistBytes`. When negative, helps mark before returning.

### 2.3 Pacer Implementation (Go 1.18+ Redesign)

The new pacer uses PI (proportional-integral) control to track CPU usage and adjust trigger ratio dynamically.

Goal: keep GC CPU at 25% of one logical CPU.

For sudden allocation spikes, mark assist provides bounded heap overshoot.

### 2.4 Scavenger

Background scavenger goroutine returns unused heap pages to the OS via `madvise(MADV_DONTNEED)` (Linux) or equivalent.

Default behavior: scavenge slowly to avoid re-faulting pages. With GOMEMLIMIT, scavenger more aggressive when approaching limit.

### 2.5 Span Lifecycle

Heap is organized into spans (1+ pages). Each span:
- Allocated for one size class.
- Tracked by mheap.
- After all objects free, span returned to mcentral or mheap.
- Pages may be returned to OS via scavenger.

---

## 3. Production Patterns

### 3.1 Tuning for Latency-Sensitive Services

Goals: minimize pause times.

Approaches:
1. **Reduce pointer density**: each pointer is a mark-time cost.
2. **`sync.Pool`**: reduces allocation rate; fewer GC cycles.
3. **Pre-allocate**: avoid mid-cycle allocations.
4. **GOGC higher** (e.g., 200): less frequent GC, but more memory.
5. **GOMEMLIMIT**: bound max heap.

### 3.2 Tuning for Throughput

Goals: maximize requests/sec.

Approaches:
1. **GOGC higher**: less GC CPU.
2. **More memory available**: GOMEMLIMIT permits growth.
3. **Reduce per-request allocations**.

### 3.3 Container Deployment

Always set GOMEMLIMIT to ~95% of container memory. Prevents OOM-killer surprises.

```yaml
# Kubernetes
env:
  - name: GOMEMLIMIT
    value: "1900MiB"  # for 2 GiB container
```

### 3.4 Heap Growth Pattern Analysis

```bash
GODEBUG=gctrace=1 ./service > gc.log
# Parse heap before/after each GC
# Steady state: similar before/after
# Growing leak: end > start trends upward
```

### 3.5 Identifying Allocation Hotspots

```bash
go test -benchmem -memprofile=mem.out -bench=.
go tool pprof -alloc_space mem.out
top  # top allocators
```

Optimize the largest first.

---

## 4. Concurrency Considerations

### 4.1 Mark Assist Affects All Goroutines

During GC mark phase, all allocating goroutines pay mark assist tax. High-allocation goroutines get throttled more.

### 4.2 Write Barriers Are Per-Goroutine

Each goroutine has its own write barrier buffer. Drained by GC workers.

### 4.3 STW Synchronization

STW phases require all goroutines to reach safepoints. Tight loops without function calls may delay STW. Asynchronous preemption (Go 1.14+) handles this via signals.

---

## 5. Memory and GC Interactions

### 5.1 Heap Sizing
- `HeapAlloc`: live heap.
- `NextGC`: target for next cycle.
- `HeapSys`: total memory the runtime acquired from OS for the heap.
- `HeapInuse`: bytes actually in use (including metadata).

### 5.2 RSS vs Heap

RSS may be larger than HeapAlloc because:
- Allocator reserves more than current use.
- Stacks consume memory.
- Other runtime overhead.

`MemStats.Sys` is total runtime-acquired memory.

### 5.3 Soft Memory Limit (Go 1.19+)

`GOMEMLIMIT=N`:
- The pacer treats N as a hard target.
- As `MemStats.Sys` approaches N, GC runs harder.
- May significantly increase CPU.
- If physically impossible (live > N), may OOM despite limit.

---

## 6. Production Incidents

### 6.1 OOM in Container Without GOMEMLIMIT

Service heap grew slowly; container OOM-killed when RSS exceeded limit. GC didn't react until too late.

Fix: set GOMEMLIMIT to 95% of container limit. GC reacts before OOM.

### 6.2 Long Pauses Due to Stack Scan

Goroutine count grew to 1M; stack scan during STW exceeded 50 ms.

Fix: investigate goroutine leak. Most cases have a small steady-state count.

### 6.3 Mark Assist Throttling High-Allocation Service

Service with very high allocation rate had unpredictable latency. Mark assist throttled allocating goroutines.

Fix: reduce allocation rate via sync.Pool, pre-allocation. Latency stabilized.

### 6.4 GC Trash from Sub-Slice Pinning

Service held large buffers via sub-slice references. Heap grew to 10 GB; GC ran constantly.

Fix: defensive copy small portions; release big buffers.

---

## 7. Best Practices

1. Set GOMEMLIMIT in containers.
2. Profile production for hot allocators.
3. Reduce pointer density for latency.
4. sync.Pool for hot reuse.
5. Pre-allocate sizes.
6. Monitor MemStats and PauseNs.
7. Log GODEBUG=gctrace=1 in lower environments.
8. Avoid sub-slice memory pinning.
9. Cancel long-running goroutines.

---

## 8. Reading the GC Trace

```
gc 1 @0.052s 0%: 0.018+1.4+0.018 ms clock, 0.072+0.41/0.55/0.34+0.072 ms cpu, 4->4->0 MB, 5 MB goal, 0 MB stacks, 0 MB globals, 8 P
```

- `gc 1`: cycle number.
- `@0.052s`: time since program start.
- `0%`: % of program time spent in GC so far.
- `0.018+1.4+0.018 ms clock`: mark setup STW + concurrent mark + mark term STW.
- `0.072+0.41/0.55/0.34+0.072 ms cpu`: CPU times for each phase.
- `4->4->0 MB`: heap at start of cycle, peak, end after sweep.
- `5 MB goal`: target heap.
- `0 MB stacks, 0 MB globals`: roots.
- `8 P`: # logical processors.

---

## 9. Self-Assessment Checklist

- [ ] I know hybrid write barrier rationale
- [ ] I understand mark assist throttling
- [ ] I can read GC trace output
- [ ] I tune GOMEMLIMIT for containers
- [ ] I monitor pause times in production
- [ ] I diagnose allocation hot spots
- [ ] I avoid pointer density in hot data

---

## 10. Summary

Senior-level GC tuning is about understanding the pacer, mark assist, write barriers, and production allocation patterns. Use GOMEMLIMIT in containers. Profile and reduce hot allocations. Reduce pointer density for latency-sensitive services.

---

## 11. Further Reading

- [Hybrid write barrier](https://github.com/golang/proposal/blob/master/design/17503-eliminate-rescan.md)
- [Pacer redesign](https://go.googlesource.com/proposal/+/master/design/44167-gc-pacer-redesign.md)
- [Memory limit](https://go.googlesource.com/proposal/+/master/design/48409-soft-memory-limit.md)
- [GC Guide](https://go.dev/doc/gc-guide)
