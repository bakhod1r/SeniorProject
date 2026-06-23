# Memory Management in Depth — Interview

Realistic interview questions on Go memory management, ordered from common warm-ups to deep dives. Each answer is what a strong candidate would say, not the textbook minimum.

---

## Q1. Where does a Go variable live — stack or heap?

The compiler decides via **escape analysis** at build time. A variable stays on the goroutine's stack if its lifetime is provably bounded by the function frame. It escapes to the heap if a reference to it can outlive the frame — typically because it's returned, stored in a global or another heap object, captured by a closure that escapes, sent on a channel, or converted to an interface whose backing type is larger than a word.

You can ask the compiler to explain its choices with `go build -gcflags="-m"`.

---

## Q2. What does the Go garbage collector look like in one sentence?

A concurrent, non-generational, non-compacting, tri-color mark-and-sweep collector with a hybrid (deletion + insertion) write barrier, paced by a heap-growth ratio (`GOGC`) and optionally bounded by a soft memory limit (`GOMEMLIMIT`).

---

## Q3. What does `GOGC` do?

`GOGC` controls the heap-growth trigger ratio. With `GOGC=100` (default), the GC starts a new cycle when the live heap reaches `2× the live set at the end of the previous cycle`. Higher values mean less frequent GC (more memory, less CPU); lower values mean more frequent GC (less memory, more CPU). `GOGC=off` disables it entirely, which is usually only sensible for short batch programs.

---

## Q4. How is `GOMEMLIMIT` different from `GOGC`?

`GOGC` is a *ratio*: GC when heap doubles. `GOMEMLIMIT` is an *absolute soft cap* on total runtime memory. They cooperate: GC fires whichever condition is hit first. In container deployments you usually leave `GOGC=100` and set `GOMEMLIMIT` to ~90% of the cgroup memory limit so the runtime GCs aggressively to avoid OOMKill instead of allowing it.

---

## Q5. Explain the tri-color invariant.

During concurrent marking, objects are conceptually white (unreached), grey (reached but children not yet scanned), or black (reached, all children queued). The invariant is: a black object must never directly reference a white object. The **write barrier** maintains this by intercepting pointer writes during marking and ensuring overwritten and newly stored pointers are shaded grey. The barrier costs a small amount per pointer store, paid only during the mark phase.

---

## Q6. What's a "write barrier" and when does it run?

A write barrier is a compiler-inserted snippet that runs on pointer assignments during the GC's mark phase. Go uses a *hybrid* barrier (Yuasa deletion + Dijkstra insertion): both the overwritten pointer and the newly stored pointer get shaded grey. This is what allows stacks to be scanned only once per cycle without a rescan-at-mark-termination pause.

Outside the mark phase, pointer stores are bare moves with no barrier.

---

## Q7. What are the STW pauses in a Go GC cycle?

There are two short stop-the-world pauses per cycle:

1. **Sweep termination**, at the start of the cycle, to finish any leftover sweeping from the previous cycle.
2. **Mark termination**, at the end of marking, to flush write barrier buffers and transition into sweeping.

Both are typically well under a millisecond on a healthy service. The bulk of work (marking and sweeping) is concurrent with user code.

---

## Q8. Why is the Go GC not generational?

Generational GCs exploit the "weak generational hypothesis" — most objects die young — and require either a moving collector or remembered sets that the write barrier maintains. Go made deliberate trade-offs: a non-moving collector (so pointers can be passed to C, the `unsafe` package works straightforwardly, and barriers stay cheap), with the pacer keeping cycles inexpensive. The Go team has discussed generational designs; as of now, the simpler model with aggressive concurrent marking has been judged sufficient.

---

## Q9. What's the cost of an allocation in Go?

- A small (< 32 KiB) allocation hits the per-P `mcache`, lock-free, and is on the order of tens of nanoseconds.
- It may miss into `mcentral` (lock-protected) or `mheap` (lock-protected) — those are still fast but rarer.
- The *real* cost is GC pressure: more allocations mean more frequent collection cycles. The right model is "allocation has a cost per allocation *and* per byte that you pay later, at GC".

Zero-allocation hot paths are common in standard library kernels (encoders, parsers) and worth pursuing on hot code. They're not a sensible goal for whole services.

---

## Q10. What's a "size class" and why do they exist?

A size class is one of ~67 fixed small-object sizes (8, 16, 24, 32, 48, …). When you allocate an object < 32 KiB, the runtime rounds up to the nearest class. Each class has its own per-P cache (`mcache`) and global pool (`mcentral`), so allocation in the common case is just popping from a list without touching object metadata or locks. The trade-off is internal fragmentation — a 17-byte allocation pays for 24 bytes.

---

## Q11. What's `sync.Pool` good for, and what's it not?

Good for high-frequency, short-lived, similarly-sized allocations on concurrent paths — HTTP request scratch buffers, JSON encoders, regex-friendly state. It's per-P internally, so it scales.

Not a cache: the GC can drain the pool at any time. Not for long-lived objects: just allocate them once. Not for unbounded-size objects: you'll inflate the pool memory permanently. Always `Reset` before `Put`, and consider dropping oversized values.

---

## Q12. What's the difference between `runtime.SetFinalizer` and `runtime.AddCleanup`?

`SetFinalizer` registers a finalizer that runs after the object becomes unreachable; it **resurrects** the object for one more GC cycle so the finalizer can see its fields. One finalizer per object. Cycles among finalizer-bearing objects are never collected.

`AddCleanup` (Go 1.24+) is the modern replacement: multiple cleanups per object, no resurrection, no keep-alive of the object, tolerates cycles. Use it for new code. Existing finalizers should migrate as you touch the code.

---

## Q13. What does `runtime.KeepAlive` do, and when would you use it?

It tells the compiler to consider its argument live up to the call point, preventing earlier collection. The common scenario is at cgo boundaries: you allocate a buffer in Go, pass it to a C function, and the C function uses it asynchronously. Without `KeepAlive`, the compiler might decide the Go-side reference is dead after argument evaluation, and a concurrent GC could collect the buffer mid-C-call. `KeepAlive(buf)` after the C call closes that window.

---

## Q14. A goroutine is blocked forever on a channel. What memory does it cost?

At minimum:

- Its `g` struct (~200 B).
- Its stack (currently allocated size, often 4–8 KiB after a few growths).
- Everything reachable from the stack: captured closure data, request structs, slices, maps — the entire transitive graph.

That's why goroutine leaks are usually heap leaks in disguise. Watching `runtime.NumGoroutine()` over time is one of the cheapest early-warning signals.

---

## Q15. How would you find a memory leak in production?

1. Confirm RSS *and* `HeapAlloc` are both growing. RSS alone often means retained idle pages — cosmetic.
2. Watch `runtime.NumGoroutine()` over time. Monotonic growth → goroutine leak.
3. Capture two heap profiles 30 minutes apart under similar load. Diff with `pprof -base`.
4. Look at the top growing allocation sites; they'll point at a function with a retained reference.
5. Common culprits: maps that only grow, slice sub-references holding huge backing arrays, time.Ticker not stopped, time.After in long-lived selects (pre-1.23), package-level caches, finalizer cycles.

---

## Q16. Why doesn't the Go runtime release memory back to the OS faster?

On Linux it uses `MADV_FREE` by default: kernel can reclaim the pages under memory pressure but reports them as RSS until then. This trades reported RSS for fewer page faults on bursty workloads — if the program needs the pages again before pressure arrives, it pays nothing. You can force eager return with `GODEBUG=madvdontneed=1` or, programmatically, `debug.FreeOSMemory()`.

---

## Q17. Can you take a pointer to a stack variable and pass it to another goroutine?

If escape analysis can see the pointer is sent on a channel, stored in a global, or otherwise leaks, it will move the variable to the heap. You won't get a dangling pointer — you'll get a heap allocation instead. The compiler is conservative: in doubt, it heaps.

---

## Q18. What's stack growth and when does it happen?

Each goroutine starts with a 2 KiB stack. On a deep call, the runtime detects the overflow at a function prologue check, allocates a new contiguous stack 2× larger, copies all frames over, and rewrites every on-stack pointer. The goroutine resumes seamlessly. The stack also shrinks during GC if used size drops below ¼ of allocated size.

The implication: you can never escape a stack pointer externally — the address changes on growth.

---

## Q19. What's the cost of an `interface{}` value?

An `interface{}` is two words: a `*itab` (type info) and a `unsafe.Pointer` (data). For values smaller than a word, the runtime may store them inline; for anything larger, the data is heap-allocated and the pointer points into the heap. Hot paths that frequently convert values to `interface{}` accumulate small heap allocations from `runtime.convT*`. Generics avoid this where applicable.

---

## Q20. Bonus — what would you change in Go's memory system?

This is an open-ended discussion question. Strong answers acknowledge real trade-offs: generational GC (would help long-running services, costs barrier complexity and Go's "pointer to C memory" promise), compacting GC (helps fragmentation, breaks unsafe + cgo), region/arena allocation (the [`arena`](https://pkg.go.dev/arena) proposal was put on hold; opens unsafety footguns), shrinking maps (currently impractical without compaction), better per-goroutine memory accounting.

The point of this question is to see whether you understand *why* Go's memory system is shaped the way it is — not to invent something.

---

## Cheat sheet for the interview

- Stack vs heap: compiler decides via escape analysis.
- GC: concurrent, tri-color, hybrid barrier, non-generational, non-moving.
- Pacer: `GOGC` (ratio) + `GOMEMLIMIT` (cap).
- Two STW pauses per cycle, both submillisecond.
- `sync.Pool`: per-P, evicted on GC, not a cache.
- `SetFinalizer` is dangerous; `AddCleanup` (1.24+) is the modern path.
- Reading the runtime: `runtime/metrics` (preferred), `runtime.MemStats` (legacy), `gctrace=1` (cheap, qualitative).
- Common leaks: maps, goroutines, sub-slice retention, captured closures.

---

## Further reading
- Go GC guide: https://go.dev/doc/gc-guide
- Talk: "Getting to Go" by Rick Hudson: https://blog.golang.org/ismmkeynote
- `runtime` source: https://github.com/golang/go/tree/master/src/runtime
