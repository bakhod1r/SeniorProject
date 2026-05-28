# Go GC Source — Interview

## 1. How to use this file

GC questions surface at every Go interview from intern-screen to staff-architect, but the level of resolution changes dramatically. Junior loops are checking that you know Go has a GC and you don't call `runtime.GC()` from your handlers. Middle loops want the tri-color invariant, write barriers, and the GC phases named correctly. Senior loops want pacer behaviour, mark assist, `sync.Pool` trade-offs, and the ability to diagnose a real latency spike from a `gctrace` line. Staff loops want comparisons with the JVM, history of the algorithm (1.5/1.8/1.19 milestones), and an honest opinion on what you'd change. This file is organized in that order — top to bottom on first pass, skim on revision. Read the linked `runtime/mgc*.go` files at least once before any senior interview; even five minutes of source-skimming changes how you talk about the topic.

The trap throughout: GC is one of the most-mythologized parts of Go. Most candidates repeat half-remembered claims ("Go's GC is generational", "STW is gone in modern Go", "the write barrier is for thread safety") that an interviewer with `runtime/mgc.go` open will pick apart. Be precise; if you don't know, say so.

---

## 2. Junior questions (Q1–Q5)

### Q1. Does Go have a garbage collector? What kind?

**A:** Yes. Go has a concurrent, tri-color, mark-and-sweep, non-generational, non-compacting collector that runs concurrently with the application goroutines, with two very short stop-the-world (STW) phases per cycle.

That sentence has six adjectives and each one matters. **Concurrent**: the marker runs alongside your code, not instead of it. **Tri-color**: objects are colored white (not yet seen), grey (seen, children not yet scanned), black (seen and scanned); the algorithm terminates when the grey set is empty. **Mark-and-sweep**: phase one finds live objects, phase two reclaims everything else. **Non-generational**: there's no young/old separation — every reachable object is scanned every cycle. **Non-compacting**: live objects stay where they are; the allocator handles fragmentation through size-classed spans rather than moving objects around. **STW phases are short**: typically tens of microseconds to a low single-digit millisecond, with most of the GC work done concurrently. The source for all of this lives in `runtime/mgc.go`, `runtime/mgcmark.go`, and `runtime/mgcsweep.go`.

---

### Q2. What is a GC pause and why should I care?

**A:** A GC pause is any time the application is stopped so the runtime can do bookkeeping that can't be done while goroutines are mutating memory; in modern Go this is two tiny STW windows per cycle (mark start, mark termination), each typically well under a millisecond.

You care because pause time shows up directly in your p99 latency. A 1ms pause on a 10ms p99 endpoint is a 10% tail tax; a 5ms pause on the same endpoint is catastrophic. Modern Go (1.5+) traded throughput for shorter pauses on purpose — the team's published target since 1.5 was sub-10ms pauses, and since 1.8 it's typically sub-1ms in practice. If you measure GC pauses in Go and see anything in the tens of milliseconds, something is wrong (huge stacks, broken pacer, allocator under siege). The two STW phases are:

1. **Mark start** — flush per-P caches, enable write barriers, snapshot the root set.
2. **Mark termination** — finish remaining grey objects, disable write barriers, prepare sweep.

Everything else — root scanning, heap marking, sweeping — happens concurrently while your code runs.

---

### Q3. What is `GOGC` and what does it actually control?

**A:** `GOGC` is the GC pacing knob: it sets the target heap growth between GC cycles as a percentage. The default `GOGC=100` means "trigger the next GC when the heap has grown by 100% (doubled) since the previous live size".

So if the live heap after a GC is 100 MB, the next GC starts when the heap reaches around 200 MB (the pacer triggers slightly earlier to finish in time). `GOGC=200` doubles the headroom (GCs run half as often, heap is roughly 50% larger), `GOGC=50` halves it (GCs run more often, heap stays leaner), `GOGC=off` disables the GC entirely (only useful for short batch jobs). The implementation lives in `runtime/mgcpacer.go`; the pacer computes the trigger based on the live heap size from the previous cycle and the `GOGC` ratio.

```go
// runtime/mgcpacer.go — simplified
// triggerHeap = liveHeap + liveHeap * GOGC/100
```

The knob is the *only* mainstream throughput-vs-memory dial Go exposes for the GC. Most production code leaves `GOGC` at 100; tuning it is a last resort when you've already optimized allocations.

---

### Q4. Should I call `runtime.GC()` in my program?

**A:** Almost never. `runtime.GC()` forces a synchronous GC cycle — your goroutine blocks until the entire cycle completes, and any per-P caches are flushed. In normal request-handling code, this destroys latency far more than it helps.

Legitimate uses are narrow: (a) before taking a heap profile so you don't measure garbage; (b) after a large one-shot data load to release the temporary structures before serving traffic; (c) in benchmarks to normalize between iterations. In all of these, the program is *not* serving live traffic when `runtime.GC()` runs. If you're tempted to call it inside a handler because "GC is hurting latency", the correct response is to reduce allocations, tune `GOGC`, set `GOMEMLIMIT`, or use `sync.Pool` — not to manually trigger more GCs.

```go
// Bad — destroys latency, doesn't help anything
func Handler(w http.ResponseWriter, r *http.Request) {
    defer runtime.GC() // never do this
    ...
}

// Acceptable — one-shot startup cleanup
func main() {
    loadLargeIndex()      // allocates a lot of temporary garbage
    runtime.GC()          // reclaim before serving
    http.ListenAndServe(...)
}
```

---

### Q5. Where do I look in the Go source tree if I want to read about the GC?

**A:** `src/runtime/mgc.go` is the entry point; everything else is a satellite.

Walk the tree once and you'll know where to dig next time:

- **`runtime/mgc.go`** — top-level GC orchestration, the cycle state machine, mark start/termination.
- **`runtime/mgcmark.go`** — root scanning, heap object scanning, the mark-assist path.
- **`runtime/mgcsweep.go`** — concurrent sweeping of spans.
- **`runtime/mgcpacer.go`** — the pacer that decides when to start the next GC and how hard mark workers should run.
- **`runtime/mgcwork.go`** — the work queue (work buffers, write barrier buffer drainage).
- **`runtime/mwbbuf.go`** and **`runtime/mbarrier.go`** — the write barrier implementation.
- **`runtime/mfinal.go`** — finalizers.
- **`runtime/malloc.go`** and **`runtime/mheap.go`** — the allocator side that interacts with the GC.

The whole GC is on the order of 10k lines spread across these files. The comments at the top of `mgc.go` are unusually good — read them once before any senior interview.

---

## 3. Middle questions (Q6–Q13)

### Q6. Explain tri-color mark-and-sweep.

**A:** Tri-color is the abstraction the GC uses to track which objects have been visited during mark. Every object is colored white (unreached), grey (reached but children not yet scanned), or black (reached and fully scanned).

The mark phase starts by greying the root set (goroutine stacks, globals, finalizer queue, registers). Then mark workers repeatedly pick a grey object, scan its pointer fields, grey any white objects they point to, and turn the current object black. The algorithm terminates when there are no grey objects left — at that point every reachable object is black and every unreachable object is still white. Sweep reclaims everything still white.

The crucial invariant (the **tri-color invariant**) is: *no black object may point directly to a white object*. Concurrent collection violates this constantly — the mutator (application code) writes pointers all the time — so the write barrier exists to restore the invariant after every pointer write that could break it. Without the invariant, a live object could be left white and freed; with it, correctness is guaranteed.

The colors aren't literal bits stored on objects. Black is "in a scanned span", grey is "queued in the work buffers", white is "not yet visited". Implementation lives in `runtime/mgcmark.go` and `runtime/mgcwork.go`.

---

### Q7. What is the write barrier and why does Go need one?

**A:** The write barrier is a small piece of code inserted by the compiler at every pointer-write site, executed during GC, that records the write so the marker can re-examine the target. It exists because concurrent marking and concurrent mutation would otherwise lose live objects.

Concrete scenario without a barrier: marker has scanned object A (black) and not yet scanned object B (white). The mutator writes A.next = B. Now A is black and points to a white B — the tri-color invariant is broken. When mark terminates and the white set gets swept, B is freed despite being reachable through A. Disaster.

The barrier prevents this. In Go (since 1.8) the active barrier is the **Yuasa-style deletion barrier** combined with a **Dijkstra-style insertion barrier** — the hybrid is called the **hybrid write barrier**. Mechanically, every pointer write `*slot = ptr` becomes:

```
// Pseudocode of the hybrid write barrier
shade(*slot)   // shade the old value (deletion barrier)
shade(ptr)     // shade the new value (insertion barrier)
*slot = ptr    // do the actual write
```

`shade(x)` means: if x is white, grey it (queue it for marking). The combination lets Go avoid the expensive "rescan stacks during STW" step that pure Dijkstra requires — stacks can stay black throughout the cycle. Implementation: `runtime/mbarrier.go` (`writebarrierptr` family) and `runtime/mwbbuf.go` (the buffered fast path).

The write barrier is **not** about thread safety or atomic writes; it's about GC correctness. Confusing the two is a common interview tell.

---

### Q8. Name the GC phases in order.

**A:** Off → sweep termination (STW) → mark setup (STW) → concurrent mark → mark termination (STW) → concurrent sweep → off.

Drilling in:

1. **Sweep termination (STW, very short).** Finish any pending sweep work from the previous cycle so the next mark has a clean slate.
2. **Mark setup (STW, very short).** Enable the write barrier, prepare per-P workbuf state, snapshot the root pointer set conceptually.
3. **Concurrent mark.** Mark workers and assists scan roots and the heap, greying and then blackening objects until the work queue is empty. Most of the cycle is here.
4. **Mark termination (STW).** Drain any remaining work, complete root rescanning that couldn't be done concurrently, disable the write barrier, finalize state for sweep.
5. **Concurrent sweep.** Spans are swept lazily as the allocator asks for them, or by background sweep workers. Sweep can overlap the next cycle's allocation.

`runtime/mgc.go` has a state machine called `gcphase` with constants `_GCoff`, `_GCmark`, `_GCmarktermination`. Read the constants and the transition functions (`gcStart`, `gcMarkDone`) to see the actual order.

---

### Q9. What is `GOMEMLIMIT` and how is it different from `GOGC`?

**A:** `GOMEMLIMIT` (introduced in Go 1.19) is a *soft* memory limit. The GC tries to keep total Go-managed memory under this limit by triggering cycles more aggressively as you approach it; it's complementary to `GOGC`, not a replacement.

`GOGC` controls a *ratio*: GC runs when the heap doubles (or whatever ratio you pick). The problem with a pure ratio: if your live heap is large and stable but you allocate slowly, you can drift over the container memory limit and OOM-kill before the next GC fires. `GOMEMLIMIT` solves this by saying "regardless of the ratio, never grow past this absolute number"; as the heap approaches the limit, the pacer accelerates and runs mark workers continuously.

```bash
# Container has 1 GiB; leave a safety margin for stacks, OS, mmaps.
GOMEMLIMIT=900MiB GOGC=100 ./myserver
```

The "soft" qualifier matters: the runtime never refuses to allocate. If you genuinely need more memory than the limit, allocation continues and the runtime keeps spending CPU on GC trying to bring usage down. This is the **soft-cap thrash** failure mode — covered in the staff section.

A common pattern in production: set `GOMEMLIMIT` to about 90% of the container memory limit and leave `GOGC=100`. If your workload is allocation-light and live-set-heavy, this prevents OOMs without hurting throughput. The pacer logic lives in `runtime/mgcpacer.go` (look for `memoryLimit` and `heapLive`).

---

### Q10. What is `runtime.KeepAlive` and when do you need it?

**A:** `runtime.KeepAlive(x)` is a no-op that the compiler treats as "x is still in use at this point, do not let the GC collect it before here". It exists for the narrow case where a value is logically alive but the compiler can't prove it because the last reference is hidden — typically through unsafe pointers or cgo handles.

The classic case is cgo: you pass a Go pointer's address (or a converted handle) into a C function, the C side holds it for the duration of the call, but Go's escape analysis sees no Go-side reference after the call begins. Without `KeepAlive`, the GC could free the Go object mid-cgo-call.

```go
func writeToFile(f *os.File, data []byte) error {
    _, err := C.write(C.int(f.Fd()), unsafe.Pointer(&data[0]), C.size_t(len(data)))
    runtime.KeepAlive(data) // data must live until C.write returns
    return err
}
```

`KeepAlive` does not allocate, does not block, does not slow anything down — it's purely a hint to the optimizer. If you're not using cgo, unsafe pointers, or `runtime.SetFinalizer`, you almost certainly don't need it. If you are, missing it is a memory-corruption bug, not a GC bug.

---

### Q11. Why isn't Go's GC generational?

**A:** Because generational GC assumes the *generational hypothesis* — most objects die young, and a cheap young-generation collection catches most garbage. That hypothesis holds for most Java workloads (lots of small temporaries from method-local objects), but Go has two structural reasons it's weaker.

First, Go's escape analysis already moves short-lived objects to the **stack**, where they're free to allocate and reclaim. Stack allocation handles a huge fraction of what would be young-generation garbage in Java. By the time an object reaches the heap, the generational hypothesis is already partially defeated — it survived escape analysis, which means it's likely longer-lived than average.

Second, generational collectors need a **write barrier or remembered set** to track inter-generational pointers (old → young), and the cost compounds with the rest of Go's GC infrastructure. Go's team measured the trade-off (there's been internal experimentation, including the abandoned "ROC" — Request Oriented Collector) and concluded the engineering cost outweighed the benefit for Go workloads.

The honest answer in an interview: it's a design choice based on Go's allocation patterns, not an oversight. The team has revisited it (search "Go GC generational" and read the issue threads); the current consensus is that other optimizations — pacing, mark assist, `GOMEMLIMIT` — produce more value per engineering hour than going generational.

---

### Q12. What is STW and how long does it last?

**A:** STW (stop-the-world) is a phase where every goroutine is paused — the scheduler stops dispatching G's onto P's and waits for all in-flight code to reach a safe point. In modern Go's GC there are two STW windows per cycle: mark start and mark termination, each typically tens of microseconds to a few hundred microseconds.

The runtime invokes `stopTheWorld(reason)` (in `runtime/proc.go`), which sets a `preempt` flag on every G and waits until each P confirms it has parked. Goroutines are preempted at function call edges (and, since 1.14, asynchronously via signal-based preemption) so STW doesn't wait on the longest-running goroutine. After all P's are parked, the runtime does its STW work, then calls `startTheWorld` to resume.

What the GC actually does during each STW window:

- **Mark start:** flush per-P write barrier buffers, enable the write barrier globally, switch `gcphase` to `_GCmark`. Microseconds.
- **Mark termination:** drain remaining work, complete the few things that can't be done concurrently (e.g., rescanning a goroutine that was running during mark), disable the write barrier, prepare for sweep. Microseconds to low milliseconds.

If your STW exceeds a few hundred microseconds, the usual culprits are huge goroutine stacks that take a long time to scan in mark termination, or `runtime.GC()` calls from application code. `GODEBUG=gctrace=1` reports STW durations explicitly — read them per cycle when investigating.

---

### Q13. How does `GODEBUG=gctrace=1` help you understand GC?

**A:** It prints one line per GC cycle to stderr describing the phases, durations, heap sizes, and CPU costs. It's the cheapest, fastest, no-instrumentation way to see what the GC is doing in production or in a benchmark.

A trace line looks like:

```
gc 14 @2.345s 3%: 0.012+1.5+0.018 ms clock, 0.097+0.32/1.4/0.0+0.14 ms cpu, 64->67->33 MB, 65 MB goal, 0 MB stacks, 0 MB globals, 8 P
```

Decoded:

- `gc 14` — cycle number 14 since process start.
- `@2.345s` — time since program start.
- `3%` — share of CPU spent in GC across the program's lifetime.
- `0.012+1.5+0.018 ms clock` — wall-clock time in mark start STW, concurrent mark, and mark termination STW. Two short STWs and a longer concurrent middle.
- `0.097+0.32/1.4/0.0+0.14 ms cpu` — CPU time across all P's for the three phases (with mutator-assist, dedicated, idle worker breakdown for the middle phase).
- `64->67->33 MB` — heap size at GC start → at GC end → live after sweep.
- `65 MB goal` — what the pacer was aiming for.
- `8 P` — number of P's during the cycle.

What you learn from it: pause times directly (the two STW numbers), whether the pacer's goal is tracking reality (heap end vs goal), whether you're allocating faster than the GC can clean up (heap-end keeps creeping up cycle over cycle), and how much CPU is going to GC overall (the leading `%`). Combined with `GODEBUG=gcpacertrace=1` (pacer-internal detail) and `GODEBUG=schedtrace=1000` (scheduler), it's enough to diagnose most GC pathologies without a profiler.

---

## 4. Senior questions (Q14–Q21)

### Q14. Walk me through the lifecycle of a goroutine's allocation under GC.

**A:** From `new(T)` to reclamation, the path goes through the allocator, the mark phase, and the sweeper.

1. **Allocation request.** Goroutine G calls `new(T)` or `make([]T, n)`; the compiler routes the call to `runtime.mallocgc(size, typ, needzero)` in `runtime/malloc.go`. If the object is < 32 KB it's allocated from the goroutine's P-local **mcache** (a per-P collection of size-classed spans); the small-object path is lock-free and very fast. Tiny (< 16 byte) non-pointer objects are batched into a tiny block to reduce per-object overhead.
2. **Slow path.** If mcache runs out of space in the relevant size class, it refills from the **mcentral** (a central, per-size-class span pool). If mcentral has nothing, it asks the **mheap** (the global heap arena), which carves a new span out of arena memory mmap'd from the OS.
3. **Mark.** Once GC starts, the object's color depends on its position. If it's reachable from a root (a goroutine stack pointer, a global, a heap object), it'll be greyed and then blackened. While the mutator allocates during mark, **freshly allocated objects are blackened immediately** (they couldn't be in the previous live set and we don't want to chase them) — see `runtime/mgc.go`'s allocation-during-mark logic.
4. **Mark assist.** If G allocates faster than the dedicated mark workers can keep up, G is forced into **assist mode** — it pauses its own work and runs mark code for a few microseconds to "pay" for its allocation. This is the mechanism that prevents the heap from running away from the marker.
5. **Sweep.** After mark termination, the span the object lives in is marked for sweeping. Sweep is lazy — it happens when the allocator next requests a span of that size class, or when background sweep workers get to it. The bitmap on the span records which slots are free; the sweeper updates it and returns the span to mcentral/mheap as appropriate.
6. **Reclamation.** Once the span is fully free, the heap can either reuse it for a different size class or return the underlying memory to the OS via `madvise(MADV_DONTNEED)` (or `MADV_FREE` on newer kernels). The scavenger (`runtime/mgcscavenge.go`) handles the OS return path.

The whole cycle — allocate, scan, sweep, scavenge — is what "the GC" really is. Most candidates know mark and sweep but stop there; the allocator and scavenger are equally important to behaviour you'll see in production.

---

### Q15. What is mark assist and when does it bite?

**A:** Mark assist is the mechanism by which allocating goroutines are forced to do GC work proportional to their allocation rate. It's how the pacer keeps the marker from falling behind a high-allocation workload.

The math: the pacer estimates how much marking work remains (`scanWork`) and how much heap growth remains until the cycle should finish. From these it computes an **assist ratio** — bytes of mark work required per byte allocated. When a goroutine calls `mallocgc` during the mark phase, the runtime debits an assist credit; if the credit goes negative, the goroutine is required to do `scanWork` worth of marking before its `mallocgc` returns.

```
// runtime/mgcmark.go — gcAssistAlloc
// If we don't have enough credit, do enough scan work
// to pay back our debt before returning the allocation.
```

When it bites:

- **Allocation-heavy hot path.** A handler that allocates aggressively during a GC cycle will spend microseconds in assist on many of those allocations. The latency tax shows up as occasional p99 outliers that correlate with the cycle.
- **Slow background workers + sudden allocation spike.** If a workload usually allocates slowly, then suddenly spikes (a big batch request, a large response body), the assist ratio jumps and every allocating goroutine pays disproportionately.
- **Misconfigured `GOGC`.** A very low `GOGC` (say, 20) means GC cycles are short but frequent; allocation always overlaps with mark, so assist is always on. Throughput drops.

You see assist time in `gctrace`'s CPU breakdown (the `0.32/1.4/0.0` triple is mutator-assist / dedicated / idle worker times). High mutator-assist relative to dedicated means the workload is forcing the marker to keep up via the application, not via the dedicated workers — a smell.

Fixes: reduce allocations (the actual cure), use `sync.Pool` for hot allocation paths, raise `GOGC` to give the pacer more headroom, set `GOMEMLIMIT` to give an absolute ceiling.

---

### Q16. How would you diagnose "p99 latency spike during GC"?

**A:** Walk three diagnostic layers — `gctrace` first, profile second, source-level fix third.

**Layer 1: `GODEBUG=gctrace=1`.** Run with the flag in a load test and capture stdout/stderr. Look at:
- The STW durations (first and third numbers in the `clock` triple). If they're tens of milliseconds, mark termination is your problem — probably huge goroutine stacks (look for thousands of long-lived goroutines).
- The mutator-assist CPU fraction (first number in the CPU breakdown). If it's a large share of total CPU, allocation rate is outpacing the marker; you need fewer allocations.
- Heap-end vs goal. If end consistently exceeds goal, the pacer is being beaten and the heap is overshooting. Either allocation is bursty (pacer can't keep up) or scan rate is too slow.
- Frequency of cycles. If cycles are happening every few hundred milliseconds, `GOGC` is too low or `GOMEMLIMIT` is squeezing you.

**Layer 2: pprof.** Run `go tool pprof -alloc_objects` against a heap profile to find the hot allocation sites; run `-inuse_space` to find what's resident. The 80/20 rule is real — usually one or two call sites are responsible for the bulk of allocations. Examples: `fmt.Sprintf` in a hot loop, `[]byte(string)` conversions, JSON encoding without buffer reuse, time.Now() in a tight loop allocating a `time.Time`.

**Layer 3: targeted fixes.** Reduce or pool allocations on the hot sites identified.
- Replace `fmt.Sprintf` with `strconv.AppendInt`/`strings.Builder`.
- Pool byte slices used as buffers with `sync.Pool`.
- Pre-size maps and slices with `make(map[K]V, n)` to avoid repeated grows.
- Move objects to the stack by avoiding accidental escapes (`go build -gcflags="-m"` to see what escapes).

If after all that you still see GC-correlated spikes, the workload may genuinely require sub-millisecond tail latency that's incompatible with GC at all — at which point you're looking at off-heap data structures, lock-free queues, and an architecture conversation, not a tuning conversation. But that's rare; 95% of "GC latency" problems are allocation rate problems hiding behind GC blame.

---

### Q17. Explain the pacer's job.

**A:** The pacer decides *when to start* the next GC cycle and *how much CPU* to give the mark workers, with the goal of finishing the cycle just before the heap reaches the `GOGC`/`GOMEMLIMIT` trigger.

Two competing pressures:
- Start the cycle too early → wasted CPU on GC, lower throughput.
- Start too late → mark misses its window, heap overshoots the target, mark assist kicks in hard and tail latency spikes.

The pacer (`runtime/mgcpacer.go`) is a feedback loop. After each cycle it observes how much scan work the cycle required and how much heap growth happened, computes a **scan rate** (bytes scanned per ns of CPU), and uses that to project when to start the next cycle so the mark finishes at the target heap size. Inputs:

- **`heapLive`** — currently allocated bytes.
- **`heapGoal`** — target heap size at next GC end (driven by `GOGC` and `GOMEMLIMIT`).
- **`scanWorkExpected`** — bytes of scan work expected this cycle, based on previous cycle's measurement.
- **`assistWorkPerByte`** — work each allocating goroutine must do per allocated byte to keep mark on track.

Outputs:
- The trigger heap size for starting the next cycle.
- The CPU share for dedicated mark workers (target: ~25% of GOMAXPROCS during mark).
- The assist ratio applied to allocating goroutines.

In Go 1.18 the pacer was rewritten ([proposal #44167](https://github.com/golang/go/issues/44167)) to be more stable under workload variability — older versions sometimes oscillated, starting GCs too early on one cycle and too late on the next. The 1.18+ pacer uses a smoothed estimate of scan rate and explicitly accounts for the assist contribution from mutators.

Read `runtime/mgcpacer.go` for the equations; they're commented and not as scary as they look. Key function: `(*gcControllerState).revise`.

---

### Q18. How does the write barrier interact with the compiler — show where it's inserted.

**A:** The compiler inserts a write barrier at every pointer assignment that could violate the tri-color invariant during GC. The Go compiler emits a call to `runtime.gcWriteBarrier` (or, on the fast path, a direct inlined write barrier buffer entry) before the actual store.

Source-level example:

```go
type Node struct{ Next *Node }

func link(a, b *Node) {
    a.Next = b  // pointer write — barrier inserted by compiler
}
```

What the compiler actually emits (simplified, for amd64):

```
// pseudo-assembly
CMP runtime.writeBarrier.enabled, $0
JZ  store_only                  // fast path: no GC in progress
MOV b, R8
MOV a.Next, R9
CALL runtime.gcWriteBarrier     // record both old and new pointer
store_only:
MOV b, a.Next                   // do the actual store
```

The `writeBarrier.enabled` flag is set by the runtime when entering mark setup and cleared at mark termination — outside of mark, the barrier is a single load-compare-branch, ~1ns. During mark, the barrier shades both the old value (`a.Next` before the write) and the new value (`b`), implementing the hybrid Yuasa+Dijkstra discipline. The buffer-based fast path (`runtime/mwbbuf.go`) batches these into per-P buffers that are flushed in bulk; the slow path calls `runtime.gcWriteBarrier` and shades synchronously.

The compiler is conservative — it inserts barriers at *every* pointer write, including writes to local variables that escape. Stack writes (locals that don't escape) don't need barriers because stacks are scanned during mark termination (or kept black via the hybrid barrier's deletion half). The compiler decides write-barrier insertion in `cmd/compile/internal/ssa/writebarrier.go` — a worthwhile read if you want to see the exact pattern matching.

Worth knowing: `//go:nowritebarrier` and `//go:nowritebarrierrec` are compiler directives that assert a function (or its callees) must not emit any write barriers. They're used in the runtime itself to prove that low-level code doesn't accidentally recurse into the barrier during sensitive moments. You'll never use them in application code.

---

### Q19. Why is Go's GC non-compacting and what are the consequences?

**A:** Non-compacting means the GC leaves live objects where they are; it never moves them to defragment the heap. The choice is deliberate: moving objects requires fixing up every pointer to them (root pointers, heap pointers, register values) which is expensive and hard to do concurrently.

Consequences:

- **Pointer stability.** A `*Foo` is the same address forever (until freed). Code that takes pointers, stores them in cgo calls, or uses `unsafe.Pointer` doesn't have to worry about a pointer becoming stale. This is huge for cgo interop and for the `unsafe` ecosystem.
- **Fragmentation handled at the allocator, not the GC.** The size-class system (`runtime/sizeclasses.go`) gives each span a fixed object size; small allocations of the same size class slot into the same spans, so internal fragmentation within a class is bounded. External fragmentation across classes is handled by mheap's span management; in practice, well-behaved workloads don't fragment badly.
- **No "long GC pause for compaction"** as you'd see in some JVM collectors. Pauses are bounded by what mark termination has to do, not by how much memory needs moving.
- **Worst-case heap waste is bounded but real.** A workload that allocates many short-lived 24-byte structs, then many short-lived 25-byte structs, will leave 24-byte spans mostly empty until the allocator reuses them or returns them. The scavenger eventually gives them back to the OS via `MADV_DONTNEED`/`MADV_FREE`, but RSS can stay high until that happens.

If you ever read "Go's GC has high RSS overhead" in a blog post, this is what they mean — and it's a real cost. `GOMEMLIMIT` plus aggressive scavenging (improved continuously across 1.16-1.21) mostly mitigates it for container workloads.

---

### Q20. When should you use `sync.Pool`?

**A:** When you have a *short-lived, allocation-heavy* object that you re-create on a hot path and the per-object work isn't dominant. `sync.Pool` lets you reuse the underlying allocation, eliminating GC pressure from that site.

The canonical use case: a per-request buffer.

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func handle(w http.ResponseWriter, r *http.Request) {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)

    // use buf for the duration of the request
    json.NewEncoder(buf).Encode(response)
    w.Write(buf.Bytes())
}
```

What you must know:

- **The pool can drop objects at any GC cycle.** `Get` may return a brand-new `New()` object even if you just `Put` one. Don't assume reuse; design for it being a hint, not a guarantee. (`runtime/mgc.go` calls `sync_runtime_poolCleanup` per cycle, which drains the per-P pool victim caches.)
- **Per-P caching.** Pool is internally per-P with a victim cache, so `Get` and `Put` from the same goroutine are nearly free. Cross-P borrowing is more expensive but still cheap.
- **You must Reset.** Pool returns whatever state the previous user left; if you forget to `buf.Reset()` you'll get data from another request. This is a real source of cross-request data leaks in production.
- **Don't pool objects with finalizers** or anything where the GC's reclamation semantics matter; pooling fights the GC's lifecycle assumptions.

When *not* to use it:
- One-shot allocations (use the stack via small-struct returns).
- Long-lived objects (caching is a different problem; pool isn't a cache).
- Pointers held longer than the immediate scope (you'll race with another goroutine pulling them out of the pool).

---

### Q21. How do finalizers work and when do you NOT want one?

**A:** A finalizer is a function the GC calls just before reclaiming an object. You register one with `runtime.SetFinalizer(obj, fn)`; when the GC finds `obj` unreachable, instead of freeing it immediately, it puts it on a queue, a dedicated goroutine pops it, calls `fn(obj)`, and the *next* GC cycle reclaims the object.

```go
type File struct{ fd int }

func NewFile(fd int) *File {
    f := &File{fd: fd}
    runtime.SetFinalizer(f, func(f *File) {
        syscall.Close(f.fd) // safety net if Close wasn't called
    })
    return f
}
```

The finalizer machinery lives in `runtime/mfinal.go`. Key constraints:

- **Resurrects the object for one cycle.** A finalizable object survives the first GC that finds it unreachable; only the second cycle reclaims it. Heap retention is doubled for finalizable objects.
- **No ordering guarantee.** If A and B are both finalizable and unreachable, finalizer order is unspecified.
- **No execution guarantee at shutdown.** Process exit doesn't run pending finalizers. If you rely on finalizers for cleanup, the cleanup may never happen.
- **Cycles are unfinalizable.** A finalizable object that's part of a reference cycle won't run its finalizer (the runtime can't decide which one in the cycle to call first).
- **Finalizer goroutine is single-threaded.** A slow finalizer blocks all subsequent finalizers behind it.

When NOT to use one:

- **For resource cleanup that has a deterministic close pattern.** Files, sockets, DB connections — just close them. The finalizer is at best a safety net, at worst a license to forget. Idiomatic Go uses `defer f.Close()`, not finalizers.
- **For sensitive resources.** Zeroing secrets in memory shouldn't depend on a non-guaranteed callback.
- **For correctness-critical work.** Anything where "this might run, eventually, in some order" is unacceptable.

Where finalizers genuinely earn their keep: cgo handle cleanup (`runtime.SetFinalizer` on a wrapper struct that holds a C pointer, so the C side gets freed if the Go side leaks), and `runtime.AddCleanup` in Go 1.24+ (cleaner API for the same use case). Outside of cgo wrappers, you almost never want one.

---

## 5. Staff/Architect questions (Q22–Q26)

### Q22. Compare Go's GC with the JVM's G1 and ZGC.

**A:** Different priorities, different trade-offs. Frame the comparison along five axes: concurrency, generations, compaction, pause goals, throughput.

| Axis | Go GC (post-1.8) | G1 (JVM default since 9) | ZGC (JVM, low-latency) |
|------|------------------|--------------------------|------------------------|
| **Concurrency** | Concurrent mark, concurrent sweep, two short STWs per cycle | Concurrent mark, STW evacuation (compaction) | Fully concurrent including evacuation |
| **Generational?** | No | Yes (region-based, weakly generational) | Optionally generational (since JDK 21) |
| **Compacting?** | No | Yes — copies live objects during evacuation | Yes — concurrent relocation via colored pointers |
| **Pause goal** | Sub-millisecond, achieved typically | <200ms by default, tunable to ~10ms | <1ms across heap sizes up to TB |
| **Throughput** | Optimized for predictability, ~5% CPU on GC typical | Higher throughput than ZGC, predictable pauses | Lower throughput than G1, much lower pauses |
| **Memory overhead** | Modest; bounded by `GOMEMLIMIT` and `GOGC` | Heap regions add overhead, ~5–15% | Colored pointers add per-pointer overhead, ~15% |
| **Tuning surface** | Two knobs (`GOGC`, `GOMEMLIMIT`) + `GOMAXPROCS` | Dozens of flags | Several flags, less than G1 |

What Go gives up that the JVM has:
- Compaction (so no defragmentation; Go relies on size classes).
- Generational behaviour (so every cycle scans the full live heap).
- Hand-tuning depth (Go's simplicity is intentional; you can't dial it the way you can tune G1).

What Go gets in return:
- Drastically simpler operational model. Two knobs that most people don't touch.
- Predictable behaviour across workloads; less "we found a JVM flag that fixed it" lore.
- Lower memory overhead per object (no per-object generational header, no card table).

ZGC and Shenandoah show that JVM-style GC can match Go's pause profile, but only via colored pointers and load barriers — heavier than Go's write barrier and at higher memory cost. Go's bet is that for the workloads Go serves (network services, CLIs, build tools), the trade-off — no compaction, no generations, simple knobs, sub-ms pauses — is the right shape.

Staff move: name what Go's GC *can't do* honestly. If your workload has a 100 GB live heap and you can't tolerate scanning all of it every cycle, Go is the wrong tool. Use ZGC. The Go team won't tell you otherwise.

---

### Q23. If you were designing a new GC for Go, what would you change first?

**A:** Honest answer depends on your priorities; the strongest interview answer commits to one direction and defends it.

A defensible position: **invest in selective generationality without a full generational rewrite.** The argument:

1. Go already pays for a write barrier; piggybacking a card-table-style remembered set on it is a known optimization (G1, Shenandoah, others do it).
2. Stack allocation already drains most young-generation candidates, so a young generation in Go would target a smaller fraction than in Java — but for some workloads (HTTP services with large response objects that allocate temporary maps and slices), it would still help.
3. The team's `ROC` experiment in 2017 explored this and was abandoned for engineering complexity. With a decade more compiler and runtime maturity, the cost-benefit may have shifted.

The risk: generational GC adds operational complexity (more tuning surface, more failure modes) and Go's "simple knobs" promise is part of its value. The case for the change has to clear that high bar.

Alternative answers, equally defensible:

- **Better scavenger / OS interaction.** Pull memory back from the OS faster so containerized Go processes don't sit on stale RSS. Continuous improvement here through 1.16–1.21; could go further with explicit hugepage support.
- **Region-based allocation for known-lifetime objects.** Compiler-driven; let the compiler hint to the allocator that some allocations have a known scope (request-bounded) and place them in regions that can be bulk-freed. Avoids generational complexity; targets the same workloads.
- **Concurrent stack scanning.** Eliminate or shorten mark-termination STW further by scanning goroutine stacks concurrently. Hard because of barrier interactions; would push pauses into the tens-of-microseconds range.

The interviewer is checking: can you describe a real change, name its costs, name its alternatives, and commit to one? "I'd just make it generational" without explaining the cost-benefit is the junior answer; "Here are three options, here's the one I'd pick first, here's the risk" is the staff answer.

---

### Q24. Walk through the 1.5 / 1.8 / 1.19 GC milestones and what each changed.

**A:** Three landmark releases.

**Go 1.5 (August 2015) — concurrent collector.** Before 1.5, Go's GC was a stop-the-world parallel mark-and-sweep with pauses in the hundreds of milliseconds for heaps in the gigabytes. 1.5 introduced the concurrent collector — mark runs alongside the mutator, sweep runs concurrently or lazily, and STW is reduced to two short windows. The pacer was introduced to decide when to start cycles. Public target: pauses under 10ms for typical heaps; achieved in practice. This was the release that made Go viable for low-latency services.

**Go 1.8 (February 2017) — hybrid write barrier.** Pre-1.8, mark termination included rescanning goroutine stacks under STW, which was the dominant pause cost for programs with many goroutines (a service with 100k goroutines could see tens of milliseconds in mark termination). 1.8 introduced the **hybrid write barrier** (Yuasa deletion barrier + Dijkstra insertion barrier) which allowed stacks to stay black throughout the cycle — no rescan needed. Public pauses dropped to typically under 1ms regardless of goroutine count. Austin Clements' design doc on the hybrid barrier is required reading.

**Go 1.19 (August 2022) — soft memory limit (`GOMEMLIMIT`).** Until 1.19, Go's GC was purely ratio-driven (`GOGC`), which meant a slow-allocating, large-live-heap workload could exceed a container memory limit and OOM-kill before the next cycle. 1.19 introduced `GOMEMLIMIT` as a soft cap: as the heap approaches the limit, the pacer accelerates to keep usage below it. This was the release that made Go robust under container memory limits.

Other releases worth knowing:
- **1.4** — last release with the old non-concurrent GC; the contrast is what makes 1.5 dramatic.
- **1.10** — sweep made faster and more concurrent.
- **1.14** — asynchronous preemption via signals, which made STW more responsive (a long loop without function calls can now be preempted at signal granularity, not just at function entries).
- **1.18** — pacer rewrite for better stability under variable workloads.
- **1.21** — better scavenger behaviour, more aggressive OS memory return.
- **1.24** — `runtime.AddCleanup`, a saner API than `SetFinalizer`.

If an interviewer asks about a specific version, anchor your answer in the *problem each release solved* — pauses (1.5), stack rescans (1.8), container OOMs (1.19). That framing shows you understand the design trajectory, not just the release notes.

---

### Q25. Describe a real GC pathology you've encountered.

**A:** The strongest answers come from real experience, but the pattern of the answer matters more than the specific story. Use this shape: symptom → diagnostic → root cause → fix → lesson.

Example pathology: **"GC thrash under `GOMEMLIMIT`-induced soft cap."**

- **Symptom.** A service running with `GOMEMLIMIT=2GiB` started showing p99 latency spikes from 50ms to 800ms, CPU usage climbed from 30% to 90%, but the binary wasn't OOM-killed.
- **Diagnostic.** `GODEBUG=gctrace=1` showed GC cycles every 50ms (vs the usual 5-second cadence), heap-end consistently at ~1.95 GiB (just under the limit), mutator-assist CPU dominating the cycle breakdown. The pacer was running mark workers full-tilt to keep the heap under `GOMEMLIMIT`, and assists were forcing application goroutines into mark work on every allocation.
- **Root cause.** A code change introduced a per-request cache that grew unbounded — the live set crept from 1 GiB to 1.9 GiB over hours. `GOMEMLIMIT` did its job (no OOM) but at the cost of effectively continuous GC.
- **Fix.** Two changes: (a) bound the cache size with an LRU; (b) `GOMEMLIMIT` was raised to 3 GiB on the container with a corresponding memory limit bump while the cache fix rolled out.
- **Lesson.** `GOMEMLIMIT` is a safety net, not a tuning parameter. If you're hitting it, the heap is genuinely too big — fix the program, don't keep raising the limit. The "soft" semantics means you'll burn CPU rather than crash, which is often worse than crashing because it's silent.

Other real-world pathologies worth knowing:

- **Map memory not returning to OS.** A workload allocated a giant `map[string]X`, drained it, and RSS stayed high because Go map buckets don't shrink. Symptom: monitor shows growth without explanation; pprof `inuse_space` shows the map small but heap large. Fix: rebuild the map periodically (`m = make(map[string]X, expectedSize)`).
- **Huge goroutine stacks.** A program with stacks growing to 8 MB each (deep recursion through user functions) caused mark-termination STW to climb past 50ms. Symptom: STW dominating the GC clock numbers. Fix: refactor the recursion to iteration; the stack growth was the actual bug, GC just exposed it.
- **`sync.Pool` misuse.** A handler put objects into `sync.Pool` without resetting; cross-request state leaked, *and* the pool didn't actually reduce allocations because objects were drained every GC cycle. Symptom: alloc-objects pprof showed the pool not helping. Fix: reset on `Get`, not on `Put` (resetting on `Put` is fine too as long as it's done); audit pool usage.

Whatever story you tell, name the metric you watched, the tool you reached for, the source-code or doc reference that explained the behaviour, and the trade-off you made when fixing it. Generic answers ("we had a GC problem and tuned `GOGC`") are weak; specific answers ("STW was 80ms because of 50k goroutines with 4MB stacks; we refactored the recursion and STW dropped to 200µs") are strong.

---

### Q26. How does `GOMEMLIMIT` work and what are its failure modes?

**A:** `GOMEMLIMIT` sets a *soft* ceiling on total Go-managed memory: heap, stacks, runtime metadata, mmap'd arenas. The pacer factors it into the heap goal — as live heap approaches the limit, the trigger for the next cycle is pulled in (the pacer aims to fit the next cycle's working set under the limit). The implementation lives in `runtime/mgcpacer.go`; look for `memoryLimit` and `setGCPercent`.

How it works step by step:

1. **At startup** (or via `debug.SetMemoryLimit`), the runtime records the limit.
2. **At each cycle**, the pacer computes two candidate triggers: the `GOGC`-based one (live × (1 + GOGC/100)) and the `GOMEMLIMIT`-based one (limit minus a safety margin for stacks and metadata). It picks whichever is smaller.
3. **As the heap grows toward the limit**, the trigger moves closer to current live size, so cycles happen more often.
4. **If the heap is genuinely growing past the limit**, the pacer keeps GCing aggressively but never refuses an allocation. The runtime will allocate beyond the limit if pressed — it's *soft*.

Failure modes:

- **Soft-cap thrash.** The textbook failure. Live heap is genuinely larger than the limit allows; the pacer runs GC continuously trying to bring it down; CPU is dominated by GC and mutator-assist; throughput collapses but the process doesn't crash. You see this as ~80–95% CPU with low business throughput and `gctrace` showing cycles every few hundred milliseconds. Diagnosis: `gctrace` cycle frequency, mutator-assist share. Cure: raise the limit (the program genuinely needs more memory) or shrink the working set (cache size, batch size, in-memory dataset).
- **Bad interaction with `GOGC=off`.** If you set `GOGC=off` and `GOMEMLIMIT`, the limit becomes the only trigger. This is sometimes useful (batch workloads that allocate hard, then idle), but it's surprising — folks expect `off` to mean "no GC" and instead get GCs triggered solely by memory pressure.
- **Underestimating non-heap memory.** `GOMEMLIMIT` covers Go-managed memory only. Cgo allocations, mmap'd files outside the Go heap, and OS-level overheads aren't counted. A container with a 2 GiB limit and `GOMEMLIMIT=1.9GiB` can still OOM if cgo allocates 200 MB.
- **No effect if you allocate fast enough.** The pacer's response is bounded by how fast it can mark. If you allocate faster than the marker can scan, you'll overshoot the limit anyway — the pacer can only triage, not stop allocation.

Operational recipe: in containerized deployments, set `GOMEMLIMIT` to roughly 80–90% of the container memory limit (`memory.max` in cgroup v2). Leave `GOGC=100`. Monitor RSS, `go_memstats_heap_inuse_bytes`, and `gctrace` cycle frequency. If cycle frequency climbs above one per second sustained, the program needs attention — usually a leak or an oversized in-memory cache.

---

## 6. What NOT to say

These are confident-sounding statements an interviewer will pick apart immediately. Avoid all of them.

- **"Go's GC is generational."** It isn't. There's no young/old generation, no card table, no minor/major distinction. Most short-lived objects are caught by escape analysis before they ever reach the GC, but that's not a generation — it's stack allocation.
- **"STW is gone in modern Go."** It isn't. There are still two STW windows per cycle (mark start, mark termination). They're short — typically tens to hundreds of microseconds — but they exist and they show up in `gctrace`. Saying "STW is gone" suggests you've never read a `gctrace` line.
- **"The write barrier is for thread safety."** It isn't. The write barrier exists to maintain the tri-color invariant during concurrent marking. It has nothing to do with atomicity, race conditions, or mutex semantics. Thread safety for pointer writes is the mutator's job (with mutexes, channels, atomics); the barrier is purely a GC-correctness mechanism.
- **"`runtime.GC()` improves latency."** It doesn't. It forces a synchronous GC, which destroys whatever request is calling it. It can be useful before profiling or after a one-shot data load, but never in a request-handling path.
- **"Go's GC compacts the heap."** It doesn't. Live objects stay where they are; fragmentation is managed by the size-class allocator, not by moving objects. Saying it compacts will get you asked "where does the compaction phase live in the source?" and there's no good answer because it doesn't exist.
- **"`GOGC=50` halves GC pauses."** No. `GOGC=50` makes GC run *more often* (lower headroom before the next cycle), which usually *increases* total CPU spent on GC and may not affect individual pause durations at all. Pauses are bounded by STW work, not by cycle frequency.
- **"`sync.Pool` is a cache."** It isn't. The pool can drop objects at any GC cycle; you cannot rely on `Get` returning a previously `Put` object. Use a pool to reduce *allocation rate*, not to *retain state*.
- **"Finalizers always run."** They don't. Process exit doesn't drain pending finalizers; cycles never finalize; ordering is unspecified; the finalizer goroutine is single-threaded. Treat finalizers as a backstop, never as a guarantee.
- **"Go's GC doesn't have any knobs."** It has two: `GOGC` and `GOMEMLIMIT`. Pretending there's none, or claiming there are dozens like the JVM, both signal lack of familiarity.
- **"`KeepAlive` extends an object's lifetime."** Not exactly — it tells the compiler the object is logically used up to that point, so escape analysis and the GC can't reclaim it before then. It's a constraint on the optimizer, not a runtime lifetime extension.

---

## 7. 5-minute prep checklist

If you have five minutes before the interview, lock these phrases into your head:

- **Algorithm:** concurrent, tri-color, mark-and-sweep, non-generational, non-compacting.
- **STW windows:** two per cycle (mark start, mark termination); typically microseconds.
- **Write barrier:** hybrid Yuasa + Dijkstra, maintains the tri-color invariant; inserted by the compiler at every pointer write; ~1ns when GC is off.
- **Phases:** off → sweep termination (STW) → mark setup (STW) → concurrent mark → mark termination (STW) → concurrent sweep → off.
- **Pacer:** decides when to start the next cycle and how hard to run mark workers; lives in `runtime/mgcpacer.go`; rewritten in 1.18.
- **Knobs:** `GOGC` (heap-growth ratio, default 100) and `GOMEMLIMIT` (soft cap, since 1.19). `GOGC=off` to disable.
- **Mark assist:** allocating goroutines pay for the marker's work proportional to their allocation rate during mark.
- **Diagnostics:** `GODEBUG=gctrace=1` for one line per cycle; pprof for allocation hot paths.
- **Milestones:** 1.5 concurrent collector, 1.8 hybrid write barrier (stacks stay black), 1.19 `GOMEMLIMIT`.
- **Files to name:** `runtime/mgc.go`, `runtime/mgcmark.go`, `runtime/mgcsweep.go`, `runtime/mgcpacer.go`, `runtime/mbarrier.go`, `runtime/mwbbuf.go`, `runtime/mfinal.go`.
- **Don't say:** generational, STW is gone, write barrier is for thread safety, GC compacts, `sync.Pool` is a cache, finalizers always run.

If you can deliver those phrases without hesitation when the topic comes up, you'll be in the top quartile of interview candidates on this subject — most Go programmers, including ones with five years of experience, can't.

---

## 8. Further reading

- **`runtime/mgc.go` source**: <https://cs.opensource.google/go/go/+/refs/heads/master:src/runtime/mgc.go> — the GC's top-level orchestration; the header comment is one of the best primers in the codebase.
- **`runtime/mgcpacer.go` source**: <https://cs.opensource.google/go/go/+/refs/heads/master:src/runtime/mgcpacer.go> — the pacer; read alongside [proposal #44167](https://github.com/golang/go/issues/44167) for the 1.18 rewrite rationale.
- **Austin Clements: "Go 1.5 concurrent garbage collector pacing"**: <https://golang.org/s/go15gcpacing> — the original design doc; explains why the pacer exists and the equations it solves.
- **Austin Clements: "Eliminate STW stack re-scanning"**: <https://golang.org/s/go15gcpacing> (linked from 1.8 release notes) — the hybrid write barrier design; required reading for senior interviews.
- **`GOMEMLIMIT` proposal**: <https://github.com/golang/go/issues/48409> — the design discussion for the soft memory limit, including the alternatives considered.
- **"Go GC: Prioritizing low latency and simplicity"**: <https://go.dev/blog/go15gc> — the 1.5 release blog post; the framing of "low latency, simplicity" still drives every GC decision a decade later.
- **Damian Gryski, "go-perfbook" GC chapter**: <https://github.com/dgryski/go-perfbook> — practitioner's notes on GC behaviour, allocation reduction, and pprof workflow.
- **Rhys Hiltner, "An Introduction to the Go Memory Model"**: <https://research.swtch.com/gomm> — adjacent but essential; understanding the memory model clarifies why the write barrier exists where it does.
