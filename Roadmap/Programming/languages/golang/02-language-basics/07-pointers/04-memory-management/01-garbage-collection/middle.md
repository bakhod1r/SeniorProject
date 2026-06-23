# Go Garbage Collection — Middle Level

## 1. Introduction

At the middle level, you understand the tri-color algorithm, mark-sweep phases, write barriers, and patterns to reduce GC overhead.

---

## 2. Prerequisites
- Junior-level GC
- Pointers (2.7.x)

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| Tri-color | Algorithm using white/grey/black object marking |
| Workbuf | Per-P queue of grey objects awaiting processing |
| Pacer | Algorithm deciding GC start/stop |
| GOGC | Trigger ratio (default 100) |
| GOMEMLIMIT | Soft memory cap (Go 1.19+) |
| Mark assist | User goroutine helping with marking |
| Heap target | GC's goal heap size |

---

## 4. Core Concepts

### 4.1 Tri-Color Algorithm

- **White**: not yet visited.
- **Grey**: visited but children not yet processed.
- **Black**: visited and children processed.

Mark phase:
1. Roots → grey.
2. Process grey: examine pointers; mark targets grey; mark self black.
3. Repeat until no grey objects.
4. White objects = unreachable, sweep them.

### 4.2 Phases

1. **Sweep termination** (STW): finish prior cycle's sweep.
2. **Mark setup** (STW): enable write barriers, scan roots.
3. **Concurrent mark**: process grey objects, run barriers on mutations.
4. **Mark termination** (STW): drain workbufs, disable barriers.
5. **Concurrent sweep**: free unreached objects.

STW phases ~µs to ms. Concurrent phases ~ms to seconds depending on heap size.

### 4.3 Write Barriers

To maintain correctness during concurrent marking, every pointer mutation in heap memory:
```go
heapObj.field = newPtr
```
Triggers `runtime.gcWriteBarrier`, which records the mutation for later processing.

Cost: ~2 cycles when GC inactive (just a check); more during marking.

### 4.4 Mark Assist

If a goroutine allocates faster than the GC can mark, the goroutine helps with marking before completing its allocation. This bounds heap overshoot.

You'll see `mark/assist` time in `gctrace` output.

### 4.5 Pacer

Decides when to start GC and how aggressively. Goal: keep CPU usage at ~25% while meeting heap target.

GOGC=100 means "trigger when heap reaches 2× live size".

GOMEMLIMIT=N means "stay under N bytes; GC harder as approaching".

### 4.6 Sweep

Concurrent. Walks heap spans, marks unreached objects as free.

For small spans, very fast. Total sweep cost proportional to heap size, but spread across time.

---

## 5. Real-World Analogies

**Janitors in a busy office**: cleaners (GC) work alongside employees (user code). Brief moments where everyone steps out (STW) to organize.

---

## 6. Mental Models

### Model 1 — GC Cost
```
GC cost = mark cost + sweep cost
mark cost ∝ heap size × pointer density
sweep cost ∝ heap size
```

To reduce cost:
- Fewer live objects.
- Fewer pointers per object.
- Lower allocation rate.

### Model 2 — Pacer

```
Trigger GC when:
    allocated_bytes_since_last_GC ≥ trigger_threshold
    
trigger_threshold = live_heap × (GOGC / 100)
```

---

## 7. Pros & Cons

### Pros
- Concurrent → minimal pauses
- No manual memory management
- Tunable

### Cons
- CPU overhead
- Heap headroom (~2× live data)
- Tuning required for special workloads

---

## 8. Use Cases

1. Trust GC for normal code.
2. Profile + tune for high-throughput services.
3. Set GOMEMLIMIT in containers.
4. Use sync.Pool for hot allocations.
5. Reduce pointer density for low-pause services.

---

## 9. Code Examples

### Example 1 — `gctrace` Analysis
```bash
GODEBUG=gctrace=1 ./prog 2>gc.log
```

Output:
```
gc 1 @0.052s 0%: 0.018+1.4+0.018 ms clock, 0.072+0.41/0.55/0.34+0.072 ms cpu, 4->4->0 MB, 5 MB goal, 0 MB stacks, 0 MB globals, 8 P
```

Decode:
- `gc 1`: cycle number.
- `@0.052s`: time since program start.
- `0%`: GC CPU usage.
- `0.018+1.4+0.018 ms clock`: STW setup + concurrent mark + STW term.
- `4->4->0 MB`: heap at start, peak, end.
- `5 MB goal`: target.
- `8 P`: # logical processors.

### Example 2 — Tune GOGC
```bash
GOGC=200 ./prog  # less GC, more memory
GOGC=50  ./prog  # more GC, less memory
```

Higher = trade memory for CPU. Lower = trade CPU for memory.

### Example 3 — Memory Limit
```go
import "runtime/debug"
debug.SetMemoryLimit(int64(1 << 30)) // 1 GiB soft cap
```

GC runs more aggressively as heap approaches.

### Example 4 — Force Cycle (Rarely)
```go
import "runtime"
runtime.GC()
runtime.GC() // sometimes called twice for completeness
```

### Example 5 — `sync.Pool` to Reduce Allocations
```go
var pool = sync.Pool{New: func() any { return new(Buffer) }}

b := pool.Get().(*Buffer)
defer func() { b.Reset(); pool.Put(b) }()
```

### Example 6 — Pre-Allocate
```go
items := make([]Item, 0, expectedCount)
```

### Example 7 — Reduce Pointers
```go
// Before: GC scans 1M pointers
items := []*Item{...}

// After: GC scans 1 backing array
items := []Item{...}
```

---

## 10. Coding Patterns

### Pattern 1 — Pool
```go
var pool = sync.Pool{...}
```

### Pattern 2 — Memory Limit
```go
debug.SetMemoryLimit(N)
```

### Pattern 3 — Pre-Allocate
```go
make([]T, 0, n)
```

### Pattern 4 — Reduce Pointer Density
```go
[]T over []*T when ownership is exclusive
```

---

## 11. Clean Code Guidelines

1. Trust GC defaults for normal code.
2. Profile before tuning.
3. Use sync.Pool when measured.
4. Set GOMEMLIMIT in containers.
5. Reduce pointer density for low-pause services.

---

## 12. Product Use / Feature Example

**A request handler with bounded GC overhead**:

```go
func main() {
    debug.SetMemoryLimit(int64(0.95 * float64(containerLimit)))
    
    // Periodic GC stats
    go monitorGC()
    
    serve()
}

func monitorGC() {
    for range time.Tick(30 * time.Second) {
        var ms runtime.MemStats
        runtime.ReadMemStats(&ms)
        recentPause := ms.PauseNs[(ms.NumGC+255)%256]
        if recentPause > 10_000_000 { // 10 ms
            log.Warn("GC pause exceeded threshold:", recentPause)
        }
    }
}
```

---

## 13. Error Handling

GC errors are operational:
- OOM: fatal panic. Set GOMEMLIMIT to detect approaching limit.
- Stack overflow: fatal. Avoid deep recursion.

Not catchable as Go errors.

---

## 14. Security Considerations

1. Sensitive data wiped explicitly (not relying on GC).
2. `sync.Pool` with crypto material zeroed before Put.

---

## 15. Performance Tips

1. Profile.
2. Pre-allocate.
3. sync.Pool.
4. Reduce pointer density.
5. Tune GOGC.
6. Set GOMEMLIMIT.

---

## 16. Metrics & Analytics

Track:
- HeapAlloc, HeapInuse, HeapSys.
- NumGC, GCSys, NextGC.
- PauseNs (recent pauses).
- NumGoroutine (leak detection).

---

## 17. Best Practices

1. Trust GC defaults.
2. Profile production for hotspots.
3. Use sync.Pool measured.
4. Pre-allocate sizes.
5. Reduce pointer density.
6. Monitor MemStats and PauseNs.

---

## 18. Edge Cases & Pitfalls

### Pitfall 1 — `runtime.GC()` Doesn't Free OS Memory
GC frees heap; OS pages may stay reserved. Use `debug.FreeOSMemory()` for explicit return.

### Pitfall 2 — Mark Assist During Spikes
Sudden allocation spikes may pause goroutines briefly for mark assist.

### Pitfall 3 — `sync.Pool` Drained at GC
Pool entries may be reclaimed. Don't rely for state retention.

### Pitfall 4 — GOMEMLIMIT Too Low
Aggressive GC; CPU use spikes; throughput drops.

---

## 19. Common Mistakes

| Mistake | Fix |
|---------|-----|
| Manual GC calls | Trust runtime |
| `GOGC=off` in production | Never; OOM eventually |
| Ignoring GOMEMLIMIT in container | Set it |
| Pool without Reset | Always reset before Put |

---

## 20. Common Misconceptions

**1**: "Setting GOGC=off improves performance."
**Truth**: Eventually OOM.

**2**: "GC pauses block all goroutines for seconds."
**Truth**: Modern Go: <1 ms typical.

**3**: "Concurrent GC means zero overhead."
**Truth**: Mark cost + write barriers add ~5-10% CPU.

**4**: "More memory means GC is slower."
**Truth**: More memory means GC runs less often (with same GOGC); each cycle scans more, but total CPU may go down.

---

## 21. Tricky Points

1. Pacer adapts to allocation rate.
2. Mark assist can briefly pause user goroutines.
3. `sync.Pool` is opportunistic — entries may vanish.
4. STW phases bookend each cycle.
5. GOMEMLIMIT is a SOFT cap.

---

## 22. Test

```go
import "runtime"
import "testing"

func TestPauseTime(t *testing.T) {
    var ms runtime.MemStats
    runtime.GC()
    runtime.ReadMemStats(&ms)
    recentPause := ms.PauseNs[(ms.NumGC+255)%256]
    if recentPause > 100_000_000 { // 100 ms
        t.Errorf("excessive pause: %dns", recentPause)
    }
}
```

---

## 23. Tricky Questions

**Q1**: What's the typical GC pause in modern Go?
**A**: <1 ms for STW phases.

**Q2**: How do I reduce GC CPU overhead?
**A**: Reduce allocation rate (pool, pre-alloc), reduce pointer density, raise GOGC.

---

## 24. Cheat Sheet

```bash
GOGC=100  # default
GOMEMLIMIT=4GiB
GODEBUG=gctrace=1 ./prog
```

```go
runtime.GC()
debug.SetGCPercent(200)
debug.SetMemoryLimit(N)
debug.FreeOSMemory()
runtime.ReadMemStats(&ms)
```

---

## 25. Self-Assessment Checklist

- [ ] I understand tri-color algorithm
- [ ] I know GC phases
- [ ] I can read gctrace output
- [ ] I tune GOGC for my workload
- [ ] I set GOMEMLIMIT in containers
- [ ] I monitor PauseNs in production

---

## 26. Summary

Tri-color concurrent mark-sweep GC. Brief STW pauses bookend concurrent phases. Tune via GOGC and GOMEMLIMIT. Reduce overhead by reducing allocation rate and pointer density. Profile with pprof and gctrace.

---

## 27. What You Can Build

- Latency-sensitive services
- Memory-bounded containers
- High-throughput pipelines

---

## 28. Further Reading

- [GC Guide](https://go.dev/doc/gc-guide)
- [Pacer redesign](https://go.googlesource.com/proposal/+/master/design/44167-gc-pacer-redesign.md)

---

## 29. Related Topics

- 2.7.4 Memory Management
- pprof profiling

---

## 30. Diagrams & Visual Aids

### Tri-color marking

```
Roots →   ●●●● (grey)
            │
            ▼
Process grey:
    examine pointer fields
    mark targets grey
    mark self black

White (not visited) → garbage at end
```
