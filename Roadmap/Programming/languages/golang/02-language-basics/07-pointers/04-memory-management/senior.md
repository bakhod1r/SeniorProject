# Go Memory Management — Senior Level

## 1. Overview

Senior-level mastery: precise reasoning about the allocator, the GC pacer, write barriers, scavenging, and production patterns for memory-efficient Go services.

---

## 2. Advanced Semantics

### 2.1 Allocator Architecture

Go's allocator is layered:
- **mcache** (per-P): tiny allocator + size class freelists.
- **mcentral** (per size class, shared): refills mcache.
- **mheap**: arena management, OS interaction.

Small allocations (≤32 KB) go through mcache → mcentral → mheap as needed.
Large allocations (>32 KB) go directly to mheap.

### 2.2 Size Classes

~70 size classes from 8 B to 32 KB. Each allocation rounds up to the nearest class. Internal fragmentation: typically 10-20% overhead.

### 2.3 GC Pacer

The pacer decides WHEN to start GC and HOW MUCH CPU to spend. Goal: keep heap close to target while staying within CPU budget.

Inputs:
- Allocation rate.
- Mark cost per byte.
- GC CPU target (~25% of one CPU).

Output: heap target for next cycle.

`GOGC` env var sets the growth target (default 100%): GC runs when heap reaches `1 + GOGC/100` × live heap.

### 2.4 Write Barriers Detail

During concurrent marking, every pointer mutation in heap memory needs a write barrier:
```go
heapObj.field = newPtr
```

Compiler emits:
```asm
MOVQ newPtr, AX
MOVQ AX, offset(heapObj_reg)
CALL runtime.gcWriteBarrier  ; only if GC is in mark phase
```

Conditional check: if GC is inactive, the call is essentially a no-op (`writeBarrier.enabled` is false).

### 2.5 Scavenging

Returns unused heap pages to the OS. Background goroutine + occasional opportunistic scavenging during GC.

Aggressive scavenging reduces RSS but may slow allocation (need to re-fault pages).

### 2.6 Memory Limit (Go 1.19+)

`GOMEMLIMIT` env var (and `runtime/debug.SetMemoryLimit`) sets a soft memory limit. GC runs more aggressively as the limit approaches; can avoid OOM.

```bash
GOMEMLIMIT=4GiB ./service
```

---

## 3. Production Patterns

### 3.1 Allocation Profiling

```bash
go test -bench=. -benchmem -memprofile=mem.out
go tool pprof -alloc_space mem.out
```

Identify top allocation sites. Optimize the largest ones first.

### 3.2 Heap Profiling in Production

```go
import _ "net/http/pprof"

go func() {
    http.ListenAndServe("localhost:6060", nil)
}()
```

Then:
```bash
go tool pprof http://localhost:6060/debug/pprof/heap
```

Live heap profile.

### 3.3 sync.Pool Discipline

```go
var pool = sync.Pool{New: func() any { return new(Buffer) }}

func use() {
    b := pool.Get().(*Buffer)
    defer func() {
        b.Reset() // CRITICAL: clear before returning
        pool.Put(b)
    }()
    // ... use b ...
}
```

Always `Reset` before returning to avoid data leaks across pool consumers.

### 3.4 Avoiding Large Stack Growth

Goroutine stacks copy on growth. For very deep recursion or large stack-allocated buffers, the copy cost adds up.

For deep recursion: convert to iterative loop.
For large buffers: heap-allocate explicitly.

### 3.5 Memory Limit Mode

```go
import "runtime/debug"

func main() {
    debug.SetMemoryLimit(int64(8 * 1024 * 1024 * 1024)) // 8 GiB
    // GC runs more aggressively as heap approaches 8 GiB
    // Helps prevent OOM in containerized environments
}
```

Pair with container memory limits.

---

## 4. Concurrency Considerations

### 4.1 Allocator Per-P

Per-CPU caches (mcache) avoid contention for small allocations. Each P (logical processor) has its own cache.

For large allocations, mheap mutex is contended.

### 4.2 GC Affects All Goroutines

GC's mark phase is concurrent but write barriers cost CPU on all goroutines. Mark termination is brief STW for all.

### 4.3 Memory Model

Go's memory model defines visibility of writes across goroutines. Synchronization primitives (mutex, channel, atomic) establish happens-before.

Without synchronization, concurrent reads/writes to shared memory are races.

---

## 5. Memory and GC Interactions

### 5.1 Pointer Density Cost

Each pointer in a heap object = GC root. For 1M pointer-typed objects:
- Mark cost: ~10 ns per object.
- Total: 10 ms per GC cycle.

For latency-sensitive services, pointer density is critical.

### 5.2 Heap Fragmentation

Long-running services may accumulate fragmentation. Periodic profiling helps; explicit `runtime.GC()` + `debug.FreeOSMemory()` can reclaim.

### 5.3 OS Memory vs Heap

Process RSS may be larger than `runtime.MemStats.HeapAlloc` because:
- Allocator holds reservations.
- Stacks consume memory.
- Other Go runtime overhead.

Use `ms.Sys` for total memory the runtime obtained from OS.

---

## 6. Production Incidents

### 6.1 Sub-Slice Memory Leak

Large slice → small subslice → indefinite retention. Service heap grew over hours; OOM.

Fix: copy out small portions explicitly.

### 6.2 sync.Pool Cross-Contamination

Pool reused buffers without zeroing. Sensitive data leaked to next request.

Fix: `Reset()` in defer before `Put`.

### 6.3 Goroutine Leak Pinning Memory

Long-running goroutine captured per-request data; never exited. Memory grew linearly with request count.

Fix: cancellation context.

### 6.4 Map Doesn't Shrink After Bulk Delete

A cache map peaked at 10M entries, dropped to 1k. Bucket array stayed at 10M-bucket size.

Fix: periodically rebuild the map.

---

## 7. Best Practices

1. Trust GC defaults; profile before optimizing.
2. Use sync.Pool for measured hot paths.
3. Pre-allocate slice/map sizes.
4. Reduce pointer density.
5. Set GOMEMLIMIT in container deployments.
6. Monitor `runtime.MemStats` in production.
7. Avoid sub-slice pinning for large arrays.
8. Cancel long-running goroutines.

---

## 8. Reading the Compiler Output

```bash
go build -gcflags="-m=2"           # escape decisions
GODEBUG=gctrace=1 ./prog            # GC trace
GODEBUG=allocfreetrace=1 ./prog     # very verbose
```

`GODEBUG=gctrace=1` output:
```
gc 1 @0.052s 0%: 0.018+1.4+0.018 ms clock, 0.072+0.41/0.55/0.34+0.072 ms cpu, 4->4->0 MB, 5 MB goal, 0 MB stacks, 0 MB globals, 8 P
```

Decoded: GC #1, started at 0.052s, 0% overhead, mark/term times, cpu, heap size, target.

---

## 9. Self-Assessment Checklist

- [ ] I understand the allocator architecture
- [ ] I know how the GC pacer works
- [ ] I can read GODEBUG=gctrace=1 output
- [ ] I use sync.Pool with Reset discipline
- [ ] I monitor MemStats in production
- [ ] I set GOMEMLIMIT for containers
- [ ] I avoid sub-slice memory pinning
- [ ] I cancel long-running goroutines

---

## 10. Summary

Go's memory management is sophisticated: layered allocator, concurrent GC with adaptive pacer, write barriers for correctness. Trust defaults for normal code; profile and optimize hot paths. Use sync.Pool, pre-allocation, and reduced pointer density. Set GOMEMLIMIT in containers.

---

## 11. Further Reading

- [GC Guide](https://go.dev/doc/gc-guide)
- [`runtime/debug.SetMemoryLimit`](https://pkg.go.dev/runtime/debug#SetMemoryLimit)
- [Pacer design doc](https://go.googlesource.com/proposal/+/master/design/44167-gc-pacer-redesign.md)
- 2.7.4.1 Garbage Collection (next)
