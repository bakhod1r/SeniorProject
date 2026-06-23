# GC Source — Professional

> Focus: walking the actual Go 1.22+ source. Junior/middle/senior covered the concurrent tri-color story, the hybrid write barrier in concept, and the architecture of pacer + assist. This file opens `src/runtime/mgc.go`, `mgcmark.go`, `mgcpacer.go`, `mgcsweep.go`, `mbarrier.go`, `mfinal.go`, `mbitmap.go`, traces a cycle line by line, and shows where each abstraction lives in code. Source excerpts are paraphrased and trimmed; comments marked `// from runtime/mgc.go, simplified` are the truth-preserving shape, not byte-exact.

---

## 1. `gcphase` — the global that says "what is the GC doing right now"

`runtime/mgc.go` declares one of the most consequential globals in the runtime:

```go
// from runtime/mgc.go, simplified
const (
    _GCoff             = iota // GC not running; sweep in background, write barrier disabled
    _GCmark                   // GC marking roots and workbufs, write barrier ENABLED
    _GCmarktermination        // GC mark termination: allocate black, P's help mark
)

var gcphase uint32 // atomically read by every goroutine on the allocation slow path
```

Every goroutine reads `gcphase` indirectly through `writeBarrier.enabled` and through the per-P `gcAssistBytes` accounting. The phase is mutated only at STW points or via `atomic.Store` under a barrier. It transitions:

```
_GCoff  --gcStart-->  _GCmark  --gcMarkDone-->  _GCmarktermination
                                                          |
                                                          +--gcMarkTermination-->  _GCoff
```

There is no `_GCsweep` phase: sweep runs concurrently with `_GCoff`. Sweep is *between* GCs from the phase's point of view; it has its own state in `mheap_.sweepgen`.

The boolean `writeBarrier.enabled` is a cache of "is `gcphase == _GCmark || gcphase == _GCmarktermination`". The compiler emits a fast-path check on every pointer write; flipping `writeBarrier.enabled` is what makes the barrier "turn on" — and the flip itself happens during a STW window so no goroutine sees a partial state.

```go
// from runtime/mwbbuf.go, simplified — the inlined check the compiler emits
if writeBarrier.enabled {
    gcWriteBarrier(dst, src) // slow path: enqueues the pointer for mark
}
*dst = src // always run
```

Two crucial properties: (a) the barrier is *post-write* — Go writes the pointer *and* records it; the recording is what gets marked, not the write itself; (b) the check is one load plus a predicted-not-taken branch — ~1 ns on hot paths.

---

## 2. `gcStart(trigger gcTrigger)` — the orchestrator

`gcStart` in `mgc.go` is the entry point for every GC cycle. The function is about 200 lines; this is the spine:

```go
// from runtime/mgc.go, simplified — gcStart
func gcStart(trigger gcTrigger) {
    // (1) Cheap quick-reject: if another goroutine is already starting GC,
    //     or this trigger no longer applies, bail.
    mp := acquirem()
    if !trigger.test() || gcphase != _GCoff {
        releasem(mp); return
    }
    releasem(mp)

    // (2) Take the global GC lock. Only one cycle in flight.
    semacquire(&work.startSema)
    // re-check under the lock; another goroutine may have started GC
    if !trigger.test() || gcphase != _GCoff {
        semrelease(&work.startSema); return
    }

    // (3) Sweep any unswept spans from the previous cycle.
    //     The invariant "all spans swept before next mark" is enforced here.
    for gosweepone() != ^uintptr(0) {
        sweep.nbgsweep++
    }

    // (4) Start the world stop. Every P quiesces at a safepoint.
    systemstack(stopTheWorldWithSema)

    // (5) Per-P setup. Each P resets its workbuf, assist credit, scan state.
    //     This is where the *mark* pool gets primed.
    systemstack(func() {
        finishsweep_m()    // last sweeps under STW
        clearpools()        // drain sync.Pool, sched.deferpool, etc.
        work.cycles++
        gcController.startCycle(now, int(gomaxprocs), trigger)
        work.heap0 = gcController.heapLive.Load()
        work.pauseNS = 0
        work.mode = mode  // gcBackgroundMode normally
    })

    // (6) Enable the write barrier BEFORE starting the world.
    //     A goroutine that wakes up sees writeBarrier.enabled == true.
    setGCPhase(_GCmark)

    // (7) Prepare root scan jobs (globals, finalizers, stacks).
    gcMarkRootPrepare()

    // (8) Spin up dedicated mark workers per P, plus fractional workers.
    gcController.markWorkerMode = ... // dedicated or fractional
    gcBgMarkStartWorkers()

    // (9) Restart the world. Mark phase is now concurrent with the mutator.
    systemstack(func() {
        now = startTheWorldWithSema(true)
        work.pauseNS += now - work.pauseStart
        work.tMark = now
    })

    semrelease(&work.startSema)
}
```

Step (6) is the critical one. **The write barrier must be enabled inside the STW window**, before any goroutine resumes. If you flipped it after `startTheWorldWithSema`, a mutator could write a pointer that escapes marking — exactly the dropped-reference bug the barrier exists to prevent.

`stopTheWorldWithSema` lives in `proc.go`. It walks every P, sets `preemptoff`, and waits for each P to reach a safepoint (function-call entry where the compiler emitted a check). Async preemption (since Go 1.14) lets it interrupt loops that don't call functions, by sending `SIGURG` and rewriting the PC at the safepoint via signal handler.

`startTheWorldWithSema` releases each P, which then starts its mark worker via `gcBgMarkStartWorkers` and resumes scheduled goroutines.

---

## 3. `gcMarkRootPrepare` and `gcMarkRootJobs` — turning roots into work

Roots are everything reachable without traversing the heap: globals (BSS + data segments), the finalizer queue, goroutine stacks, internal runtime structures.

```go
// from runtime/mgcmark.go, simplified
func gcMarkRootPrepare() {
    // BSS + data segment roots, one job per ~256 KB shard
    nBlocks := func(bytes uintptr) int {
        return int((bytes + rootBlockBytes - 1) / rootBlockBytes)
    }
    work.nDataRoots = 0
    work.nBSSRoots = 0
    for _, datap := range activeModules() {
        work.nDataRoots += nBlocks(datap.edata - datap.data)
        work.nBSSRoots  += nBlocks(datap.ebss - datap.bss)
    }
    work.nSpanRoots = mheap_.sweepSpans[mheap_.sweepgen/2%2].numBlocks()
    work.nStackRoots = int(atomic.Loaduintptr(&allglen))
    work.markrootNext = 0
    work.markrootJobs = uint32(fixedRootCount + work.nDataRoots +
        work.nBSSRoots + work.nSpanRoots + work.nStackRoots)
}
```

`work.markrootJobs` is the total count of work items. Workers `atomic.Xadd(&work.markrootNext, 1)` to claim one. The schema:

```
job index range          → what it scans
[0, fixedRootCount)      → finalizers, miscellaneous
[fixed, +nDataRoots)     → 256 KB data-segment shards
[..., +nBSSRoots)        → 256 KB BSS-segment shards
[..., +nSpanRoots)       → span-cleanup roots (special objects)
[..., +nStackRoots)      → one goroutine stack per job
```

`markroot(gcw *gcWork, i uint32)` dispatches by index range:

```go
// from runtime/mgcmark.go, simplified
func markroot(gcw *gcWork, i uint32, flushBgCredit bool) int64 {
    baseFlushed := fixedRootCount
    baseData    := baseFlushed + uint32(fixedRootCount)
    baseBSS     := baseData + uint32(work.nDataRoots)
    baseSpans   := baseBSS + uint32(work.nBSSRoots)
    baseStacks  := baseSpans + uint32(work.nSpanRoots)

    switch {
    case baseData <= i && i < baseBSS:
        // Scan a 256 KB shard of a module's .data segment.
        for _, datap := range activeModules() {
            markrootBlock(datap.data, datap.edata-datap.data,
                datap.gcdatamask.bytedata, gcw, int(i-baseData))
        }
    case baseStacks <= i && i < baseStacks+uint32(work.nStackRoots):
        // Scan one goroutine's stack.
        gp := allgs[i-baseStacks]
        scanstack(gp, gcw)
    // ... (other cases)
    }
}
```

Why shards? A single 4 MB data segment scanned by one worker serializes the parallel mark phase. Sharding into ~256 KB jobs lets `GOMAXPROCS` workers pick up jobs independently.

Stack scanning is the most expensive root job: a goroutine with a 100 KB stack can take ~100 µs to scan. With `runtime.allgs` containing 100 k goroutines, total stack-scan work is in the tens of milliseconds. This is why stack scanning is *concurrent* with the mutator (since Go 1.5) — the goroutine itself can be paused per-frame, scanned, resumed.

---

## 4. `gcDrain` — the mark worker loop

`gcDrain` is the heart of the marker. Every mark worker (background or assist) drives it:

```go
// from runtime/mgcmark.go, simplified
func gcDrain(gcw *gcWork, flags gcDrainFlags) {
    gp := getg().m.curg
    preemptible    := flags & gcDrainUntilPreempt != 0
    flushBgCredit  := flags & gcDrainFlushBgCredit != 0
    idle           := flags & gcDrainIdle != 0

    initScanWork := gcw.heapScanWork

    // (a) Drain root marking jobs first. Cheap, well-defined work.
    for !(gp.preempt && preemptible) {
        job := atomic.Xadd(&work.markrootNext, +1) - 1
        if job >= work.markrootJobs {
            break
        }
        markroot(gcw, job, flushBgCredit)
        if check != nil && check() { goto done }
    }

    // (b) Drain heap work: pull grey objects, scan them, push referents.
    for !(gp.preempt && preemptible) {
        if work.full == 0 {
            gcw.balance() // donate spare workbufs to global pool
        }
        b := gcw.tryGetFast()
        if b == 0 {
            b = gcw.tryGet()
            if b == 0 {
                wbBufFlush() // flush write-barrier buffer into the queue
                b = gcw.tryGet()
            }
        }
        if b == 0 {
            break // no work left
        }
        scanobject(b, gcw)

        // Periodically check assist credit + preemption.
        if gcw.heapScanWork >= gcCreditSlack {
            gcController.heapScanWork.Add(gcw.heapScanWork)
            if flushBgCredit {
                gcFlushBgCredit(gcw.heapScanWork - initScanWork)
                initScanWork = 0
            }
            gcw.heapScanWork = 0
        }
    }

done:
    // Flush residual scan-work credit.
    if gcw.heapScanWork > 0 {
        gcController.heapScanWork.Add(gcw.heapScanWork)
        if flushBgCredit {
            gcFlushBgCredit(gcw.heapScanWork - initScanWork)
        }
        gcw.heapScanWork = 0
    }
}
```

`gcw.tryGet()` pulls a *workbuf* — a fixed-size (256 pointer) array of grey-object addresses — from the per-P cache. Each call to `scanobject(b, gcw)` is "scan one object pointed to by `b`, push its pointers as new grey work."

```go
// from runtime/mgcmark.go, simplified — scanobject is the actual scan
func scanobject(b uintptr, gcw *gcWork) {
    s := spanOfUnchecked(b)
    n := s.elemsize

    // Walk the object's pointer bitmap (computed from compiler metadata).
    hbits := heapBitsForAddr(b, n)
    var i uintptr
    for ; i < n; i += goarch.PtrSize {
        if !hbits.morePointers() { break }
        if hbits.isPointer() {
            obj := *(*uintptr)(unsafe.Pointer(b + i))
            if obj != 0 && obj-mheap_.arena_start < mheap_.arena_used {
                if obj, span, objIndex := findObject(obj, b, i); obj != 0 {
                    greyobject(obj, b, i, span, gcw, objIndex)
                }
            }
        }
        hbits = hbits.next()
    }
    gcw.bytesMarked += uint64(n)
    gcw.heapScanWork += int64(i)
}
```

`greyobject` is where colour comes from in source:

```go
// from runtime/mgcmark.go, simplified — greyobject IS the color transition
func greyobject(obj, base, off uintptr, span *mspan, gcw *gcWork, objIndex uintptr) {
    mbits := span.markBitsForIndex(objIndex)
    if mbits.isMarked() { return } // already grey or black; skip
    mbits.setMarked()
    span.markBitsForIndex(objIndex).setMarked()
    if span.spanclass.noscan() {
        gcw.bytesMarked += uint64(span.elemsize) // leaf; no children
        return
    }
    if !gcw.putFast(obj) { gcw.put(obj) } // push onto workbuf — now grey
}
```

The object becomes "grey" by being pushed onto a workbuf, "black" when popped and scanned. There is **no per-object color field** (§13). Membership in a workbuf is what makes it grey.

---

## 5. The write barrier — `runtime/mbarrier.go` and the hybrid

Go's barrier is the *Yuasa deletion + Dijkstra insertion* hybrid that landed in Go 1.8 (proposal `17503`). The compiler emits the fast path; the runtime owns the slow path.

```go
// from runtime/mwbbuf.go, simplified — gcWriteBarrier (assembly in real source)
//
// Conceptually: shade(*dst); shade(src); *dst = src.
//
// dst = destination pointer slot
// src = new pointer value being written
func gcWriteBarrier(dst *uintptr, src uintptr) {
    // (1) Stash the OLD value at *dst, and the NEW value src, into the
    //     per-P write-barrier buffer. Both must eventually be greyed.
    buf := getg().m.p.ptr().wbBuf
    buf.next[0] = *dst   // OLD value — Yuasa: shade what we are about to lose
    buf.next[1] = src    // NEW value — Dijkstra: shade what we are about to install
    buf.next = buf.next[2:]

    if buf.next == buf.end {
        wbBufFlush() // drain buffer into the mark queue
    }
}
```

Two greys per pointer write:

- **Yuasa (deletion barrier).** `*dst` is going away. If it was the *only* path to some white object, the mark phase would never reach that object. Shading `*dst` keeps the path alive for this cycle.
- **Dijkstra (insertion barrier).** `src` is being installed into a possibly-black object (`dst`'s container). A black object cannot be re-scanned; if `src` was white, it would be missed. Shading `src` makes it grey.

The hybrid lets Go skip *re-scanning stacks* at mark termination. The deletion half guarantees that anything reachable from a stack at any point during the cycle is reachable from a heap pointer at mark termination. This is the Go 1.8 innovation that cut STW pauses from ~1 ms to ~100 µs on big heaps.

The buffer is per-P, ~256 pointer slots. When full, `wbBufFlush` walks the buffer and calls `greyobject` for each. This batching is what makes the fast path one branch + two stores; cost is ~5 ns per pointer write when the buffer isn't full.

The compiler decides where to *omit* the barrier:

- Writes through pointers known to be on the current stack (compiler's escape analysis proves this).
- Writes inside the runtime under `getg().m.p.ptr().wbBuf.discard` mode (during STW transitions).
- Writes to fields the compiler proved non-pointer (numeric types, `noscan` types).

Source: `cmd/compile/internal/ssa/writebarrier.go` decides emission per-store. The runtime's barrier is purely the slow-path receiver.

---

## 6. Stack scanning — `scanstack` in `mgcmark.go`

Stack scanning is the most subtle root scan. The goroutine being scanned must not be writing to its own stack at the same time.

```go
// from runtime/mgcmark.go, simplified
func scanstack(gp *g, gcw *gcWork) {
    // (1) Pause the target goroutine. Cooperative — if gp is running on a P,
    //     send a preempt and wait for it to stop at a safepoint.
    //     Since 1.14, async preempt via SIGURG works if the goroutine is in a
    //     non-preemptible loop.
    if gp.gcscanvalid { return } // already scanned this cycle

    // (2) Iterate frames from the goroutine's current PC down to the bottom
    //     of the stack. Each frame's pointer-shaped slots are listed in the
    //     stackmap, compiled from FUNCDATA emitted by the compiler.
    var state stackScanState
    state.stack = gp.stack
    state.conservative = false
    scanframeworker := func(frame *stkframe, state *stackScanState) {
        scanframe(frame, state) // marks pointer slots in this frame
    }
    gentraceback(gp.sched.pc, gp.sched.sp, 0, gp, 0, nil, 0x7fffffff,
        scanframeworker, nil, 0)

    // (3) Scan deferred functions and panic objects on this g.
    tracebackdefers(gp, scanframeworker, nil)

    // (4) Mark this goroutine's stack as scanned for this cycle.
    gp.gcscanvalid = true
}
```

`scanframe` consults a *stackmap* — a bitmap, one bit per pointer-sized stack slot, indicating "this slot contains a pointer." The compiler emits these as `FUNCDATA` referenced by `PCDATA`-indexed tables (see `cmd/internal/obj/objfile.go`).

```
goroutine stack at scan time:

  high addresses
  +-----------------+   <- stack base
  | runtime.goexit  |
  +-----------------+
  | frame: main.f3  |   stackmap: 0 1 0 1 0  (slots at offsets +8 and +24 are pointers)
  | -- locals --    |
  +-----------------+
  | frame: main.f2  |
  +-----------------+
  | frame: main.f1  |   <- gp.sched.sp
  +-----------------+
  low addresses
```

For runtime-internal frames where the compiler couldn't produce an accurate stackmap (assembly, very old code), Go falls back to *conservative scanning* — treat every aligned word as a possible pointer. This is correct but pessimistic; conservative mark on a 1 MB stack is the difference between 1 ms and 10 ms scan time.

**Why no rescan?** Go 1.8 hybrid barrier means that any pointer that was on a stack and got written *anywhere* during the cycle is shaded by the deletion barrier. So at mark termination, the stack does not need to be re-scanned. Pre-1.8 had a re-scan STW step that scaled with goroutine count (`O(allgs * frames)`), explaining big-heap pauses in the 100 ms range.

---

## 7. Mark-assist — `gcAssistAlloc` and the `assistRatio`

Allocators must pay for the marking they cause. `gcAssistAlloc` in `mgcmark.go` is the "pay back" path.

```go
// from runtime/mgcmark.go, simplified
func gcAssistAlloc(gp *g) {
    // (1) Compute how many bytes of scan work this goroutine owes.
    //     gcAssistBytes is debt accumulated per allocation; negative = in debt.
    debtBytes := -gp.gcAssistBytes
    scanWork := int64(gcController.assistWorkPerByte.Load() * float64(debtBytes))

    // (2) First try stolen background credit.
    bgScanCredit := gcController.bgScanCredit.Load()
    if bgScanCredit > 0 {
        stolen := scanWork
        if stolen > bgScanCredit { stolen = bgScanCredit }
        gcController.bgScanCredit.Add(-stolen)
        scanWork -= stolen
        gp.gcAssistBytes += int64(float64(stolen) / gcController.assistWorkPerByte.Load())
        if scanWork == 0 { return }
    }

    // (3) Otherwise, do the work ourselves.
    systemstack(func() {
        gcAssistAlloc1(gp, scanWork)
    })
}

func gcAssistAlloc1(gp *g, scanWork int64) {
    // Acquire a gcWork buffer, drain UNTIL scanWork is paid, then return.
    gcw := &getg().m.p.ptr().gcw
    workDone := gcDrainN(gcw, scanWork) // returns when scanWork was done
    gp.gcAssistBytes += int64(float64(workDone) / gcController.assistWorkPerByte.Load())
}
```

The `assistWorkPerByte` field is the central pacing number. It's the answer to: "for every byte the mutator allocates, how many bytes of scan work must the assist do to keep up with garbage?" The pacer maintains this so that marking finishes before the heap reaches the next trigger.

```go
// from runtime/mgcpacer.go, simplified
//
// assistRatio = (scan work remaining) / (heap goal - heap live)
//
// If we have 1 GB of scan work to finish and the heap has 500 MB of allocation
// budget before the next trigger, every allocated byte must do 2 bytes of scan.
func (c *gcControllerState) revise() {
    heapLive := c.heapLive.Load()
    heapGoal := c.heapGoal.Load()
    scanWorkExpected := c.heapScanWork.Load()  // already-done
    scanWorkRemaining := max(int64(c.scanWork) - scanWorkExpected, 0)
    heapDistance := int64(heapGoal) - int64(heapLive)
    if heapDistance <= 0 { heapDistance = 1 } // already over goal; floor
    c.assistWorkPerByte.Store(float64(scanWorkRemaining) / float64(heapDistance))
    c.assistBytesPerWork.Store(float64(heapDistance) / float64(scanWorkRemaining))
}
```

`gcController.revise()` is called from many places: the heap-pacing path on every large alloc, the mark drain loop, the workbuf-balance step. The recomputation keeps assist sized so that GC finishes *just* before the trigger.

If the mutator allocates faster than the assist can keep up, `gcAssistAlloc` blocks the calling goroutine on the workbuf — that's how "GC pressure" surfaces as p99 spikes in user code.

---

## 8. The pacer — `gcController.endCycle` and Clements's redesign

`runtime/mgcpacer.go` houses `gcControllerState`. The pacer's job: after each cycle, compute next cycle's trigger and assist ratio.

```go
// from runtime/mgcpacer.go, simplified
func (c *gcControllerState) endCycle(now int64, procs int, userForced bool) {
    if userForced {
        c.lastHeapGoal = c.heapGoal.Load()
        c.triggerRatio = c.triggerRatio // no learning from forced
        return
    }

    // (1) Observe: how much CPU did we just use on GC?
    cpuTime := c.markStartTime - c.idleMarkTime  // CPU spent marking
    elapsed := now - c.markStartTime
    utilization := float64(cpuTime) / float64(elapsed*int64(procs))

    // (2) Compute the heap-growth ratio we just experienced.
    triggerError := float64(c.heapLive.Load()) / float64(c.heapGoal.Load()) - 1.0

    // (3) PI controller: nudge trigger ratio toward target utilization (25%).
    targetUtilization := gcGoalUtilization  // 0.30 since 1.18 pacer redesign
    triggerGain := 0.5
    triggerRatio := c.triggerRatio +
        triggerGain*(targetUtilization-utilization) -
        triggerError

    // (4) Clamp to safe range; persist for next cycle.
    if triggerRatio < 0.05 { triggerRatio = 0.05 }
    if triggerRatio > 0.95 { triggerRatio = 0.95 }
    c.triggerRatio = triggerRatio

    // (5) Compute next-cycle heap goal from GOGC + GOMEMLIMIT.
    c.commit(triggerRatio)
}
```

The real `commit` (post-1.18 redesign per Clements's proposal `44167`) is more elaborate:

- It honours `GOMEMLIMIT` — if the heap is approaching the user-set limit, the trigger is pulled in regardless of `GOGC`.
- It uses a *steady-state* mental model: assume next cycle's live set and CPU look like this one's, target 25–30% GC CPU.
- It separates the *trigger* (when GC starts) from the *goal* (when GC must finish), so that the assist ratio is bounded.

```go
// from runtime/mgcpacer.go, simplified commit
func (c *gcControllerState) commit(triggerRatio float64) {
    goal := uint64(float64(c.heapMarked) * (1 + float64(gcPercent)/100))
    if c.memoryLimit.Load() > 0 {
        memLimit := c.memoryLimit.Load()
        memLimitGoal := memLimit - c.mappedReady.Load() // available
        if memLimitGoal < goal { goal = memLimitGoal } // honour GOMEMLIMIT
    }
    trigger := uint64(float64(goal) * triggerRatio)
    c.trigger.Store(trigger)
    c.heapGoal.Store(goal)
}
```

`GOMEMLIMIT` (Go 1.19) changed pacing materially: instead of "GOGC=100 means GC at 2× live", the GC may run *more aggressively* (closer to live size) when within memory limit budget. This was the source change in `mgcpacer.go` Clements proposed in `48409`, hooked into `commit` so that the pacer respects an absolute ceiling rather than only a multiplier.

---

## 9. `gcMarkTermination` — back to STW, transition to `_GCoff`

When `gcDrain` workers find no more workbufs and the deletion-barrier buffer is empty, mark is *done*. `gcMarkDone()` confirms via a global drain check and transitions:

```go
// from runtime/mgc.go, simplified — gcMarkDone
func gcMarkDone() {
    // (1) Atomic decrement of nMarkers. The last worker triggers termination.
    work.nwait++
    if work.nwait < work.nproc { return }

    // (2) Re-STW. Brief — just long enough to flush per-P state.
    systemstack(stopTheWorldWithSema)

    // (3) Disable assists; flip phase.
    gcController.endCycle(now, int(gomaxprocs), work.userForced)
    setGCPhase(_GCmarktermination)

    // (4) Each P flushes its workbuf, write-barrier buffer, scan credit.
    systemstack(func() {
        for _, p := range allp {
            wbBufFlush1(p)         // drain WB buffer
            p.gcw.dispose()         // return workbufs to pool
        }
        gcMark(now)                 // final consolidation
        setGCPhase(_GCoff)          // ← write barrier OFF for next cycle
        gcSweep(work.mode)          // queue spans for concurrent sweep
    })

    // (5) Restart the world. Sweep runs in background.
    systemstack(func() {
        startTheWorldWithSema(true)
    })
}
```

The second STW is small — *just* the workbuf flushes. On a 100 GB heap, total mark termination pause is typically <100 µs because no scanning happens here, only consolidation. This is the major contributor to Go's "sub-millisecond pause" claim.

After `setGCPhase(_GCoff)`, the write barrier is disabled. Compiler-emitted fast paths see `writeBarrier.enabled == false` and skip the slow path entirely.

---

## 10. Sweep — `runtime/mgcsweep.go`

Sweep reclaims memory from spans whose mark bits are zero. It is fully concurrent with the mutator and runs in the background between cycles.

```go
// from runtime/mgcsweep.go, simplified
//
// sweepone reclaims a single span. Called from the background sweeper goroutine
// AND from mallocgc when allocating triggers proportional sweep work.
func sweepone() uintptr {
    sg := mheap_.sweepgen
    var s *mspan
    for {
        s = mheap_.sweepSpans[1-sg/2%2].pop()
        if s == nil { return ^uintptr(0) }
        if atomic.Cas(&s.sweepgen, sg-2, sg-1) { break } // claim
    }
    npages := s.sweep(false)
    return npages
}

func (s *mspan) sweep(preserve bool) uintptr {
    // (a) For each object in the span, check its mark bit.
    //     If unmarked (white) and previously allocated, free it.
    nfreed := uintptr(0)
    for i := uintptr(0); i < s.nelems; i++ {
        if !s.gcmarkBits.isMarked(i) && s.allocBits.isMarked(i) {
            // unmarked but allocated — garbage, reclaim
            nfreed++
        }
    }
    s.allocBits = s.gcmarkBits  // mark bits become next cycle's alloc bits
    s.gcmarkBits = newMarkBits(s.nelems)
    atomic.Store(&s.sweepgen, mheap_.sweepgen) // publish
    return s.npages
}
```

`mallocgc` (the allocator) calls `deductSweepCredit(npages, allocSize)` on every allocation. If sweep is behind, the allocating goroutine performs `sweepone()` itself — *proportional sweep*. This guarantees sweep finishes before the next mark phase starts.

```
mspan layout with mark bits:

  +-----------+--------------------------------+
  | mspan hdr | bytes of objects (nelems × sz) |
  +-----------+--------------------------------+
                    ↑
  +--------------+  | one bit per object: was it marked?
  | gcmarkBits   |  +-- this becomes allocBits at sweep
  +--------------+
  | allocBits    |  was this slot allocated last cycle?
  +--------------+
  | specialBits  |  finalizer, profile, weak ref?
  +--------------+

  After sweep: gcmarkBits → allocBits (so a "marked" object becomes
  "still allocated"; an "unmarked" object becomes "free").
```

`runtime.GC()` forces *full* sweep before returning by calling `sweep.start` and waiting on `mheap_.sweepDone`. Use it in tests to ensure determinism, never in production hot paths (it serializes the mutator with sweep completion).

---

## 11. Finalizers — `runtime/mfinal.go`

`runtime.SetFinalizer(obj, fn)` registers a function to call when `obj` becomes unreachable. The implementation is in `mfinal.go`.

```go
// from runtime/mfinal.go, simplified
func SetFinalizer(obj any, finalizer any) {
    e := efaceOf(&obj)
    etyp := e._type
    if etyp.Kind_&kindMask != kindPtr {
        throw("runtime.SetFinalizer: first argument is not a pointer")
    }

    base, _, _ := findObject(uintptr(e.data), 0, 0)
    if base == 0 {
        throw("runtime.SetFinalizer: pointer not in heap")
    }
    // (a) Verify the finalizer signature matches func(T) for the pointed-to type.
    f := efaceOf(&finalizer)
    fnType := f._type
    if fnType.Kind_&kindMask != kindFunc { throw("invalid finalizer type") }

    // (b) Add the finalizer to the per-span specials list.
    addspecial(unsafe.Pointer(uintptr(e.data)), &specialfinalizer{...})
}
```

During mark, an object with a finalizer is treated specially. If the *only* references to it are through the finalizer's "reachable when finalizer runs" clause, the GC:

1. Marks the object as reachable for *this* cycle (so it doesn't get swept).
2. Queues the finalizer for execution.
3. Removes the finalizer association.
4. The *next* cycle, with the finalizer gone, can collect the object.

This is why finalized objects are reclaimed two cycles late and why heavy finalizer use breaks back-pressure.

```go
// from runtime/mfinal.go, simplified — runfinq runs in a single dedicated goroutine
func runfinq() {
    for {
        for fb := finc; fb != nil; fb = fb.next {
            for i := uintptr(0); i < fb.cnt; i++ {
                f := &fb.fin[i]
                // Call f.fn(f.arg) — the registered finalizer function.
                reflectcall(f.fint, unsafe.Pointer(f.fn), unsafe.Pointer(&f.arg), uint32(f.nret), uint32(f.nret), uint32(f.nret), nil)
                f.fn = nil; f.arg = nil
            }
        }
        gopark(...) // wait for next batch
    }
}
```

**The "object must not be referenced from itself" rule.** A finalizer for `obj` that captures `obj` directly creates an infinite finalizer cycle — the finalizer keeps `obj` reachable, so it's queued every cycle, never collected. The runtime does not detect this; it's a documented contract violation. Pattern: use a separate `*ResourceHandle` struct that captures only the file descriptor / mmap pointer, not the wrapper.

`runtime.AddCleanup` (Go 1.24) is the modern replacement: stricter signature (`func()` with no capture of the object), no resurrection semantics, freed in a single cycle. Prefer it for new code.

---

## 12. The pointer bitmap — `mbitmap.go`

The compiler emits, per type, a pointer bitmap: one bit per word, "this word is a pointer." The runtime uses it during mark.

```go
// from runtime/mbitmap.go, simplified — heapBits navigates the bitmap
type heapBits struct {
    bitp  *uint8
    shift uint32
}

func heapBitsForAddr(addr, size uintptr) heapBits {
    arenaIdx := (addr - heapArenaBase) / heapArenaBytes
    arena := mheap_.arenas[arenaL1(arenaIdx)][arenaL2(arenaIdx)]
    bit := (addr - arena.zero) / goarch.PtrSize
    return heapBits{bitp: &arena.bitmap[bit/8], shift: uint32(bit % 8)}
}

func (h heapBits) isPointer() bool {
    return *h.bitp>>h.shift&1 != 0
}
```

A 1 GB heap has 128 MB of pointer bitmap (one bit per 8-byte word; arena bitmap is 1/64 of arena size). Mark walks the bitmap, not the words.

**`noscan` types.** Types containing no pointers (numeric, byte slices in some configurations, types tagged `runtime.spanClass.noscan()`) skip pointer scan entirely. The size-class system maintains separate span pools for `noscan` and `scan` objects, so a `[]byte` allocation never enters the marker. **Avoiding pointers in hot-path types is the biggest single GC win available to user code.** A `map[string]uint64` with 10 M entries costs the marker ~150 ms; a `map[uint64]uint64` costs ~30 ms because keys are `noscan`.

The bitmap is also why `unsafe.Pointer` arithmetic is dangerous: writes through `unsafe.Pointer` bypass the compiler's pointer-shape tracking, but the bitmap still expects pointer-shaped writes only at known offsets. If you store an integer through `unsafe.Pointer` into a slot the bitmap says is a pointer, the marker dereferences garbage — a classic "GC scrambled my heap" bug.

---

## 13. Object colour in source — there is no colour byte

The classic tri-color algorithm describes white / grey / black per-object state. Go's source has **no per-object colour field.** Where, then, is the state?

| State | How encoded in source |
|---|---|
| White | Mark bit unset *and* not on any workbuf. Default. |
| Grey  | On *some* workbuf (per-P `gcw.wbuf1`, `gcw.wbuf2`, global `work.full`). |
| Black | Mark bit set *and* not on any workbuf. Has been scanned. |

Implications:

- **Setting the mark bit is what makes an object grey-or-black**, depending on whether it's been pushed onto a workbuf.
- The transition grey → black is the moment `gcDrain` pops the object from a workbuf and calls `scanobject`; no field changes, just queue membership.
- **Black objects can become grey again via the deletion barrier** — a pointer write through a black object's slot pushes the old target onto the WB buffer, which flushes onto a workbuf. This is correct because the barrier protects against the missed-mark case.

This is why "is X marked?" is queried via `markBitsForIndex(idx).isMarked()` (mark bit), not "is X black?" — the runtime never asks the latter question. It only needs: have I scanned this? (mark bit set + workbuf empty after drain). The simplification halves memory overhead of the marker.

---

## 14. Source-change walkthrough — the Go 1.8 hybrid barrier landing

Pick one historical change: the introduction of the hybrid barrier in Go 1.8 (proposal `17503`, Austin Clements). Before 1.8:

```go
// pre-1.8 Dijkstra-only insertion barrier
func writebarrierptr(dst *uintptr, src uintptr) {
    shade(src)        // shade what's being installed
    *dst = src
}
```

The mark-termination phase had to *re-scan every goroutine stack* under STW, because stacks were "black" by default (not insertion-shaded) and could have lost references. On a service with 100 k goroutines, this rescan was ~50–100 ms of pause.

After 1.8, the source in `mwbbuf.go` became:

```go
// post-1.8 Yuasa+Dijkstra hybrid
func gcWriteBarrier(dst *uintptr, src uintptr) {
    buf := getg().m.p.ptr().wbBuf
    buf.next[0] = *dst   // NEW: also shade the OLD value (Yuasa)
    buf.next[1] = src    // shade the NEW value (Dijkstra)
    buf.next = buf.next[2:]
    if buf.next == buf.end { wbBufFlush() }
}
```

And `gcMarkTermination` lost the stack-rescan loop entirely. The hybrid invariant: *anything reachable from any stack at any point during the cycle is also reachable from a heap pointer at mark termination, via the deletion barrier's recording.* Stacks no longer need re-scan.

Visible source changes:

- `runtime/mwbbuf.go` introduced as a separate file to house the WB buffer.
- `runtime/mgcmark.go`'s `gcMarkTermination` dropped `for _, gp := range allgs { scanstack(gp, ...) }`.
- `runtime/mbarrier.go`'s `writebarrierptr` became a thin wrapper into `gcWriteBarrier`.
- A new contract was added: stacks are scanned exactly once per cycle, "permanently grey" until scanned, then black for the rest of the cycle.

Effect on observable GC: max STW pause on a 200 GB heap fell from ~50 ms (1.7) to <1 ms (1.8). This is the single biggest pause-time improvement in Go's history.

Other significant in-source changes worth reading:

- **Go 1.5 concurrent GC introduction** (Clements proposal `7581`): `runtime/mgc.go` split out from `runtime/malloc.go`; introduced `gcStart`, `gcMarkDone`, `gcMarkTermination`; mark phase moved off STW. Compare commits before/after `bc593eac4d`.
- **Go 1.12 sweep concurrency fix** (CL `134395`): `mgcsweep.go`'s sweep was made more parallel; the "background sweeper goroutine" became multiple workers.
- **Go 1.14 async preemption** (proposal `24543`): `runtime/preempt.go` introduced. Mark now preempts non-cooperative loops via signals. GC pauses became bounded even for goroutines without function calls.
- **Go 1.19 `GOMEMLIMIT`** (proposal `48409`): `mgcpacer.go`'s `commit` updated to honour an absolute memory ceiling, not just a multiplier of live heap.
- **Go 1.24 `runtime.AddCleanup`** (proposal `67535`): `mfinal.go` extended with a separate cleanup API that fixes finalizer resurrection and finalizer-cycle bugs.

---

## 15. ASCII diagrams

### 15.1 Work-queue layout

```
Per-P workbuf cache (in p.gcw):

  +------------------+
  |     wbuf1        |  active push/pop buffer (256 pointers)
  +------------------+
  |     wbuf2        |  backup; swapped with wbuf1 when full
  +------------------+

  When wbuf1 fills, it's published to the global queue:

  Global mark queue (work.full, work.empty — singly-linked stacks):

  full ─→ [buf]─→[buf]─→[buf]─→ nil       full buffers waiting for scan
  empty ─→ [buf]─→[buf]─→[buf]─→ nil       empty buffers for refill

  Steal protocol:
    1. drain wbuf1 (LIFO; cache-friendly)
    2. swap with wbuf2 if empty
    3. pop from global work.full (steal from peers)
    4. flush WB buffer; retry
    5. balance: donate spare buffers back to work.empty
```

### 15.2 `mspan` mark bitmap

```
One mspan, size-class 8 (32-byte objects), 128 objects per span:

  span memory:
    +---------+---------+---------+...+---------+    (128 × 32 bytes)
    | obj 0   | obj 1   | obj 2   |   | obj 127 |
    +---------+---------+---------+...+---------+

  mspan.gcmarkBits (16 bytes, 1 bit/obj):
    [ 1 0 1 1 0 0 1 0 | 1 1 1 0 0 0 0 1 | ... ]
      ↑     ↑
      obj 0 marked   obj 2 marked

  mspan.allocBits (16 bytes, 1 bit/obj):
    [ 1 1 1 1 1 0 1 0 | 1 1 1 0 0 0 1 1 | ... ]
      ↑
      obj 0 was allocated last cycle

  After sweep:
    gcmarkBits → allocBits (everything marked is still allocated)
    allocBits AND NOT gcmarkBits = freelist (newly free slots)
    new gcmarkBits = all zeros for next cycle
```

---

## 16. Reading order recommendation

If you've never opened the GC source, read in this order:

1. **`runtime/mgc.go` top of file** — comment block titled "Garbage collector". The clearest plain-English summary in the codebase.
2. **`runtime/mgcpacer.go` top of file** — Clements's design comment for the pacer; reads like a paper introduction.
3. **`gcStart`** in `mgc.go` — orchestration spine.
4. **`gcDrain`** in `mgcmark.go` — the actual mark loop.
5. **`scanobject` + `greyobject`** in `mgcmark.go` — what one scan step does.
6. **`scanstack`** in `mgcmark.go` — stack scanning subtleties.
7. **`gcAssistAlloc`** in `mgcmark.go` then **`revise`** in `mgcpacer.go` — assists + pacing together.
8. **`gcWriteBarrier`** in `mwbbuf.go` + **`wbBufFlush1`** — the WB fast path and drain.
9. **`gcMarkTermination`** in `mgc.go` — the closing STW.
10. **`mspan.sweep`** in `mgcsweep.go` — reclamation.
11. **`SetFinalizer` / `runfinq`** in `mfinal.go` — finalizer mechanics.
12. **`runtime/HACKING.md`** — runtime conventions (no allocation in marker, write-barrier coloring rules, systemstack usage).
13. **`runtime/mbitmap.go`** — bitmap layout, for when you need to understand a heap dump.

Each file is 1–3 k lines; the *comments* are the documentation. Read them first, code second.

---

## Further reading

- Austin Clements, *Proposal: Garbage collector pacer redesign* (go/issues/44167) — the 1.18+ pacer; reads like a textbook chapter.
- Austin Clements, *Proposal: Eliminate STW stack re-scanning* (go/issues/17503) — the 1.8 hybrid barrier.
- Austin Clements, *Proposal: Soft memory limit* (go/issues/48409) — the 1.19 `GOMEMLIMIT`.
- Austin Clements, *Proposal: Smaller pages for the garbage collector* (go/issues/8885) — predecessor design notes.
- Rick Hudson, "Getting to Go: The Journey of Go's Garbage Collector" (ISMM 2018 keynote) — narrative history of the GC from 1.0 to 1.10.
- Richard L. Hudson, Austin T. Clements, "Go's work-stealing scheduler" — companion to GC's marker scheduling.
- `runtime/HACKING.md` in the Go source tree — runtime conventions including "no allocation during marking" and the systemstack discipline.
- `runtime/mgc.go` top-of-file comment — the single best self-contained design summary.
- David F. Bacon et al., "A Unified Theory of Garbage Collection" — the formal framework Go's hybrid barrier sits within.
- Yuasa, "Real-time garbage collection on general-purpose machines" (1990) — origin of the deletion barrier half.
- Dijkstra et al., "On-the-fly garbage collection: an exercise in cooperation" (1978) — origin of the insertion barrier half.
- Eliot B. Moss, "Working with C++ smart pointers in a GC world" — historical context for why Go chose tri-color over reference counting.
- `go tool trace` documentation — observing in production what this file describes in source.
- `GODEBUG=gctrace=1` output format reference — every field maps to a variable in `mgcpacer.go`.
