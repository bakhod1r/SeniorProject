# Memory Management in Depth — Middle

## 1. The allocator hierarchy

Every heap allocation in Go travels through three levels, designed to keep the fast path lock-free:

```
goroutine → P.mcache  (no lock, per-P)
              ↓ miss
            mcentral  (mutex, per size class)
              ↓ miss
            mheap     (mutex, page heap)
              ↓ miss
            mmap from the OS
```

- `mcache` is attached to the `P` (processor) the goroutine is running on. Tiny allocations hit only this.
- `mcentral` is a global pool of partially used spans for a size class. When `mcache` runs out of objects in a class, it refills from `mcentral`.
- `mheap` manages the address space in 8 KiB pages. Large allocations (≥ 32 KiB) go straight here.

A "span" is a contiguous run of pages dedicated to one size class. Each free object inside a span is the same size, which removes the need for per-object metadata.

---

## 2. Size classes

Small allocations are rounded up to one of ~67 fixed sizes (8, 16, 24, 32, 48, … up to 32 KiB). The full table lives in `runtime/sizeclasses.go`.

Implication: `struct{a int64; b int64; c byte}` requests 17 bytes, but it gets a 24-byte slot (24-byte class). That's 7 bytes of internal fragmentation per object. Multiplied across millions of objects, layout choices matter.

```go
type bad struct {
    a int64
    b int64
    c byte    // 17 bytes → 24-byte class (waste 7 B)
}

type good struct {
    a int64
    b int64    // 16 bytes → 16-byte class (no waste)
}
```

---

## 3. Tiny allocator

Allocations smaller than 16 bytes that contain no pointers get packed into a shared 16-byte block by the **tiny allocator**, amortizing the per-object cost. This is why `*int` (8 bytes, pointer-containing) costs more than a `byte` of the same logical size.

Practical consequence: prefer value types over `*int` when storing small scalars.

---

## 4. Where the GC pacer comes in

The runtime decides *when* to start a GC cycle using the **pacer**:

```
trigger_heap = live_heap × (1 + GOGC/100)
```

With the default `GOGC=100`, GC kicks in when the heap has grown to **2× the live set** seen at the end of the last cycle.

Other inputs the pacer considers:

- `GOMEMLIMIT`: an upper bound on total runtime memory. If set, the pacer will GC *more often* to stay under it.
- The expected CPU cost of the next cycle relative to allocation rate.

```go
import "runtime/debug"

prev := debug.SetGCPercent(200)        // less frequent GC, more memory
debug.SetMemoryLimit(2 << 30)          // 2 GiB soft cap
```

`SetGCPercent(-1)` disables GC entirely. Useful for short batch programs, dangerous for everything else.

---

## 5. The mark-and-sweep cycle, slightly less abstracted

A GC cycle has four phases:

1. **Sweep termination** (STW, microseconds): finish any in-progress sweeping from the previous cycle.
2. **Concurrent marking**: GC workers walk the object graph from roots, painting reachable objects black. Your code is running, so a **write barrier** intercepts pointer stores to keep the graph consistent.
3. **Mark termination** (STW, sub-millisecond): finalize the mark.
4. **Concurrent sweeping**: reclaim the spans that contained no live objects, lazily, as allocations need them.

The write barrier is the price of concurrent collection: every pointer store costs a little extra during the mark phase. That's invisible most of the time but can show up under microbenchmarks.

---

## 6. Tri-color invariant in one paragraph

Objects are conceptually white (unmarked), grey (queued for scan), or black (scanned, all children queued). The invariant: a black object must never point directly to a white object. The write barrier preserves this when your code mutates pointers during the mark phase.

---

## 7. Stack growth, in practice

A goroutine begins life with a 2 KiB stack. When a function would overflow it, the runtime:

1. Allocates a stack 2× larger.
2. Copies all frames over.
3. Walks the old stack and rewrites every pointer to point into the new one.
4. Resumes the goroutine.

Two consequences you should internalize:

- **You can never escape pointers to stack variables** out of a goroutine — they'd dangle after the copy. The compiler enforces this by promoting them to the heap.
- **Deeply recursive functions can cause many growths**, and each growth is real work. Iterative versions or pre-sized stacks help.

The stack shrinks during GC if its used size drops below ¼ of the allocated size.

---

## 8. Heap leaks

Go has a GC, but you can absolutely "leak" by holding references you no longer need. The most common shapes:

| Pattern | Why it leaks |
|---------|--------------|
| Global maps that only grow | No eviction policy |
| Goroutines blocked on channels nobody sends to | Goroutine, its stack, and everything it references stay live |
| Cached `*Request` or `*Context` from middleware | Pins the entire request graph |
| Slices of structs containing pointers, kept long-term | One struct can pin large object graphs |
| `time.Ticker` not stopped | Internal goroutine + closure references |

Leak detection tools: `pprof` heap profile (`go tool pprof http://.../debug/pprof/heap`) and `runtime.NumGoroutine()` over time.

---

## 9. `runtime.MemStats` you should know

```go
var m runtime.MemStats
runtime.ReadMemStats(&m)
```

| Field | What it tells you |
|-------|-------------------|
| `HeapAlloc` | Live heap bytes right now |
| `HeapInuse` | Bytes in spans currently used (≥ `HeapAlloc` due to size-class rounding) |
| `HeapIdle` | Bytes in idle spans the runtime is holding for reuse |
| `HeapReleased` | Bytes returned to the OS |
| `NumGC` | Cycles completed since start |
| `PauseTotalNs` | Cumulative STW nanoseconds |
| `GCCPUFraction` | Fraction of program CPU spent in GC since start |

`ReadMemStats` briefly stops-the-world. For high-frequency reads, use `runtime/metrics`.

---

## 10. `runtime/metrics` (preferred over MemStats for monitoring)

```go
import "runtime/metrics"

samples := []metrics.Sample{
    {Name: "/gc/heap/live:bytes"},
    {Name: "/gc/cycles/automatic:gc-cycles"},
    {Name: "/sched/goroutines:goroutines"},
}
metrics.Read(samples)

for _, s := range samples {
    fmt.Println(s.Name, s.Value)
}
```

This API is stable, versioned, named (no opaque struct fields), and does not stop the world. Use it for exporters and dashboards.

---

## 11. Allocator-friendly code patterns

| Pattern | Win |
|---------|-----|
| Preallocate with `make([]T, 0, knownCap)` | Avoids reallocation + copy as the slice grows |
| Reuse buffers via `sync.Pool` | Reduces allocation rate |
| Pass structs by value when they fit in 1–2 cache lines | Avoids heap escape via `*T` |
| Use `bytes.Buffer` / `strings.Builder` instead of `+=` | One backing array vs many |
| Avoid `interface{}` for hot small values | Boxing forces a heap allocation |
| Group related fields, order by alignment | Smaller struct → smaller class → less waste |

`sync.Pool` is not a cache; the GC can drain it at any time. Don't rely on what's inside.

---

## 12. Tooling cheat sheet

| Tool | What it shows |
|------|---------------|
| `go build -gcflags="-m"` | Escape decisions for each allocation |
| `GODEBUG=gctrace=1` | One line per GC cycle to stderr |
| `GODEBUG=allocfreetrace=1` | Stack of every alloc/free (very noisy) |
| `go test -benchmem` | Allocs and bytes per op |
| `go tool pprof http://.../debug/pprof/heap` | In-use and alloc objects/bytes |
| `go tool pprof -alloc_objects` | Cumulative allocations, not just live |

---

## 13. Summary

Heap allocations climb a three-level hierarchy (`mcache` → `mcentral` → `mheap`) that's organized by size class. The GC is concurrent, mark-and-sweep, tri-color, non-generational, non-moving, and paced by the `GOGC`/`GOMEMLIMIT` knobs. Your job is to keep allocation rate sane, avoid leaking references, and choose data layouts that pack into the existing size classes. Reach for `runtime/metrics` and `pprof` long before you reach for `runtime.GC()`.

---

## Further reading
- Go GC guide: https://go.dev/doc/gc-guide
- `runtime/metrics`: https://pkg.go.dev/runtime/metrics
- TCMalloc design (the inspiration): https://google.github.io/tcmalloc/design.html
