# Memory Management in Depth — Senior

## 1. The runtime in one mental model

Hold these facts as a single picture:

- **`P` is the scheduling unit.** It owns an `mcache`, so the small-object fast path is lock-free per CPU.
- **The heap is a virtual region** (typically 256 TiB reserved on amd64), grown by mapping arenas (64 MiB on Linux/64-bit).
- **The collector is concurrent and non-moving.** It never compacts; it relies on size classes to keep fragmentation bounded.
- **The pacer is feedback-controlled.** It adjusts mark-assist debt and worker count to land near the heap target by the time live work is done.
- **The OS-return mechanism is asynchronous.** Idle pages are returned with `MADV_FREE` (lazy) or `MADV_DONTNEED` (immediate); reported RSS lags behind `HeapReleased`.

If you internalize those five points, almost every "weird" memory observation becomes predictable.

---

## 2. Pacer math, demystified

Let `H` be the live heap at the end of cycle *n-1*. The pacer picks a target for cycle *n*:

```
target = max(H × (1 + GOGC/100), minHeap)
```

It then sets a *trigger* (when to start marking) earlier than the target so that, given the current allocation rate `r` and mark rate `m`, marking finishes just as the heap reaches `target`.

If allocation outpaces marking, the runtime forces user goroutines to do **mark assist** — for every `k` bytes you allocate, you must mark `c` bytes. That assist debt is invisible until you read traces and notice that your goroutines spent time in `runtime.gcAssistAlloc1`.

Two practical levers:

- **Raise `GOGC`** (or set `debug.SetGCPercent`) to widen the headroom and cut total GC CPU at the cost of higher RSS.
- **Set `GOMEMLIMIT`** to bound RSS. The pacer will then GC more aggressively, possibly continuously, when you push toward the cap. Programs that thrash near the limit need fewer allocations, not a higher limit.

---

## 3. `GOMEMLIMIT` — when to use it, when not to

`GOMEMLIMIT` (Go 1.19+) is a soft cap on the total memory the runtime accounts for (heap + stacks + goroutines + GC metadata + a few smaller buckets).

| Scenario | Use `GOMEMLIMIT`? |
|----------|-------------------|
| Containerized app with a hard cgroup limit | **Yes** — set to ~90% of the cgroup limit to avoid OOMKill |
| Bursty workload with idle heap retained | Yes — bounds steady-state RSS |
| GC-CPU starved batch job | No — let `GOGC` rise instead |
| You can't tell if you're allocation-bound or memory-bound | Measure first |

The combination `GOGC=off` + `GOMEMLIMIT=X` is a sentinel: the GC never runs by ratio, only when memory pressure approaches `X`. Useful for spiky allocation patterns where you want all the headroom up to a hard ceiling.

---

## 4. Stack copying and pointer rewriting

When a goroutine's stack must grow, the runtime:

1. Allocates a new contiguous stack of the next size up.
2. Walks every frame using DWARF-like metadata baked in by the compiler.
3. For each on-stack pointer, computes the offset into the old stack and writes the new address.
4. Updates every `g.sched` / `g.stk*` field and resumes.

The "no permanent escape to the stack" rule is enforced because of step 3: if you stored a stack address into a goroutine-external location (heap, global, channel), there'd be nothing to rewrite. The escape analyzer prevents this at compile time; you can't sneak around it.

Pathological case: a small recursive function that grows to a few MiB triggers many copies. Each copy is O(stack size). If you see this in a profile, restructure or pre-grow with `runtime/debug.SetMaxStack` only after you've ruled out the algorithm.

---

## 5. Write barriers, hybrid

Go's barrier is **hybrid**: deletion (Yuasa) + insertion (Dijkstra). On a pointer store `*slot = ptr` during marking:

- The previously stored pointer (`*slot` before write) is shaded grey (deletion barrier).
- The newly stored pointer (`ptr`) is shaded grey (insertion barrier).

This permits **stack scanning without rescans** — once a stack is scanned, the barrier alone is enough to maintain the invariant. Practically, this kept STW pauses sub-millisecond after Go 1.8.

You see the barrier in benchmarks as a small per-pointer-store overhead during the mark phase. It is not optional.

---

## 6. Finalizers, the trap

```go
runtime.SetFinalizer(obj, func(o *Obj) { o.Close() })
```

What seniors learn the hard way:

- **Finalizers run after the object becomes unreachable**, in a separate goroutine, in unspecified order.
- They **resurrect** the object for one more cycle so the finalizer can read its fields. This delays reclamation.
- They are **not guaranteed to run** before program exit. Never depend on them for visible side effects.
- Cycles among finalizer-bearing objects are **never collected**. Two objects with finalizers pointing at each other live forever.
- You cannot `SetFinalizer` twice on the same object (panics) or finalize a value receiver of a method.

For Go 1.24+ prefer `runtime.AddCleanup`: multiple cleanups per object, no resurrection, no keep-alive — far less footgun-shaped. Existing finalizer code should migrate.

---

## 7. `runtime.KeepAlive`, the underused friend

```go
buf := allocateCBuffer()
defer C.free(unsafe.Pointer(buf))

_, err := C.write(fd, buf, len)
runtime.KeepAlive(buf)        // ensure buf isn't reclaimed before write() returns
```

Without `KeepAlive`, the compiler can decide that `buf`'s last *Go* use is the `C.write` call's argument evaluation, and a concurrent GC could collect the object before the C function returns. `KeepAlive` extends the lifetime to that program point. Required whenever you pass a Go-managed allocation to C and the C side may use it after the call returns control to Go.

(The 1.24 cleanup API does **not** keep the object alive, which is part of what makes it safer than finalizers — but it also means you still need `KeepAlive` at C boundaries.)

---

## 8. `sync.Pool` semantics

```go
var bufPool = sync.Pool{
    New: func() any { return make([]byte, 0, 4096) },
}

b := bufPool.Get().([]byte)[:0]
defer bufPool.Put(b)
```

What seniors must remember:

- **Pool contents are evicted on GC.** It's a hint, not a cache.
- **Per-P storage with theft.** Each P has its own pool slice; Get from another P only on miss.
- **Don't put oversized values back.** A 1 MiB buffer in a pool keeps that memory permanently warm; better to drop it if growth exceeds a threshold.
- **Pools cost zero only on the hot path.** Cold pools are pure overhead.

Use `sync.Pool` for high-frequency, short-lived, similarly-sized allocations (HTTP request scratch buffers, JSON encoders). Don't reach for it before measuring.

---

## 9. `MADV_FREE` vs `MADV_DONTNEED`

On Linux, the runtime decides how to give pages back to the OS:

| Mode | Behavior | RSS effect |
|------|----------|------------|
| `MADV_FREE` (default since Go 1.12 on Linux ≥ 4.5) | Pages are eligible for reclaim **under memory pressure**, but still counted as RSS until then | RSS appears flat after `debug.FreeOSMemory()` |
| `MADV_DONTNEED` | Pages immediately unmapped; faulted back in zeroed on next touch | RSS drops immediately, but next touch incurs a page fault |

For dashboards: a "memory leak" that's just retained idle pages is one set of metrics; a real leak is another. `GODEBUG=madvdontneed=1` forces the older eager-return behavior and is what you set in cgroup-bounded containers when you'd rather pay the page-fault cost than report inflated RSS.

---

## 10. Reading a GC trace line

```
gc 23 @4.821s 6%: 0.040+1.8+0.014 ms clock, 0.32+0.10/3.5/9.2+0.11 ms cpu, 76→81→48 MB, 81 MB goal, 8 P
```

| Field | Meaning |
|-------|---------|
| `gc 23` | 23rd cycle since start |
| `@4.821s` | Time since process start |
| `6%` | Fraction of CPU spent in GC so far |
| `0.040+1.8+0.014 ms clock` | STW sweep term + concurrent mark + STW mark term, wall clock |
| `0.32+0.10/3.5/9.2+0.11 ms cpu` | Same phases, CPU time across all cores |
| `76→81→48 MB` | Heap size: at sweep start → at mark end → live |
| `81 MB goal` | Pacer's target |
| `8 P` | GOMAXPROCS during this cycle |

If the final live (48 MB above) is dropping but the goal (81) keeps rising, you've got an allocation burst that hasn't propagated yet. If `GCCPUFraction` climbs above ~25%, you're allocation-bound — fix the code, not the knobs.

---

## 11. Goroutine cost accounting

Each goroutine costs:

- ~2 KiB initial stack (often grows).
- ~200 B in the `g` struct and scheduler bookkeeping.
- Whatever the closure or function captured.
- Any object it transitively retains.

A million idle goroutines is ~2 GiB just in stacks. Goroutine *leaks* are usually heap leaks in disguise: the goroutine holds a closure that retains a slice that retains the rest of the request.

```go
import _ "net/http/pprof"
// then: go tool pprof http://localhost:6060/debug/pprof/goroutine
```

Compare counts over time. Steady growth is the leak signal.

---

## 12. `debug.FreeOSMemory()`, the last-resort button

```go
import "runtime/debug"

debug.FreeOSMemory()
```

Forces a GC and asks the runtime to return idle pages to the OS *now*. Useful in batch programs after a known peak (e.g., right after ingesting a big file), or in long-lived services right before going idle. **Not** a substitute for sane allocation patterns and **not** a regular maintenance routine — it's a hammer.

---

## 13. Summary

The Go memory system is a TCMalloc-derived allocator wrapped by a concurrent, non-moving, tri-color GC, paced against `GOGC` and bounded by `GOMEMLIMIT`. Knowing where the costs live — the write barrier during marking, the assist tax during allocation, the stack copy on growth, the `MADV_FREE` lag in RSS — turns "mysterious" behavior into a checklist. Reach for `runtime/metrics`, `pprof`, and `gctrace` before the knobs, and only reach for finalizers, `runtime.GC()`, or `FreeOSMemory()` when the alternative is worse.

---

## Further reading
- Pacer redesign (1.18): https://github.com/golang/proposal/blob/master/design/44167-gc-pacer-redesign.md
- `GOMEMLIMIT` proposal: https://github.com/golang/proposal/blob/master/design/48409-soft-memory-limit.md
- Hybrid write barrier (1.8): https://github.com/golang/proposal/blob/master/design/17503-eliminate-rescan.md
- `runtime.AddCleanup` (1.24): https://pkg.go.dev/runtime#AddCleanup
