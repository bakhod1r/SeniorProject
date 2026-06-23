# Go Garbage Collection — Professional / Internals Level

## 1. Overview

This document covers GC internals: tri-color algorithm implementation, mark workers, hybrid write barrier emission, span processing during sweep, scavenger details, and the pacer's PI controller.

---

## 2. The Tri-Color Algorithm in Detail

```
COLORS:
  white: not yet marked
  grey:  marked but children not yet processed
  black: marked and children processed

INVARIANT:
  No black object points to a white object directly
  (otherwise we'd lose track of reachability)
```

Mark phase:
1. Root scan: mark roots grey.
2. Drain grey work queue:
   For each grey object G:
     For each pointer P in G:
       If *P is white, mark grey.
     Mark G black.
3. When queue empty, marking done.

White objects = unreachable, sweep them.

---

## 3. Mark Workers

Per-P background goroutines (`runtime.gcBgMarkWorker`) drain the grey work queue.

Three modes:
- **Dedicated**: drains until cycle complete. Used when CPU available.
- **Fractional**: drains for a fraction of CPU time.
- **Idle**: drains during otherwise idle time.

The pacer chooses mode based on CPU budget.

---

## 4. Hybrid Write Barrier (Yuasa + Dijkstra)

For `slot = ptr`:

```asm
; Pseudo-code
if writeBarrier.enabled {
    shade(*slot)        // deletion barrier (Yuasa)
    if currentG_stack_grey {
        shade(ptr)      // insertion barrier (Dijkstra-like)
    }
}
*slot = ptr
```

`shade(p)` marks p grey if it was white.

Benefits:
- Stack rescan during STW termination is unnecessary.
- STW phases reduced from O(stacks) to O(1).

---

## 5. Mark Termination

After concurrent mark completes:
1. STW: stop all goroutines.
2. Drain any remaining grey work.
3. Disable write barriers.
4. Compute heap size for next cycle's pacer.

Typically <1 ms.

---

## 6. Sweep

After mark, the sweep phase iterates spans. Concurrent — runs alongside user code.

For each span:
- Walk its objects.
- Mark unreached as free.
- Update freelists.

Per-allocation lazy sweep: when `mcache` runs low on a size class, the next request triggers sweep of one span before allocation.

---

## 7. Scavenger

Background goroutine (`runtime.bgscavenge`) returns unused heap pages to OS.

Default: aims to scavenge to `GOMEMLIMIT × 0.95` if set, otherwise based on heap residency.

Mechanism:
- Walk page allocator's free list.
- Coalesce free pages.
- Call `madvise(MADV_DONTNEED)` (Linux) on free pages.

`debug.FreeOSMemory()` triggers explicit scavenge.

---

## 8. Pacer PI Controller (Go 1.18+)

The new pacer uses a Proportional-Integral (PI) controller to track desired CPU usage:

```
error = actual_cpu_use - target_cpu_use (25%)
trigger_ratio = trigger_ratio_prev + Kp * error + Ki * integral(error dt)
```

Adjusts trigger ratio dynamically based on observed allocation rate and mark cost.

For sudden spikes, mark assist provides immediate throttling without waiting for the next cycle.

---

## 9. Memory Limit Implementation

`GOMEMLIMIT=N`:
- Sets `runtime.gcController.memoryLimit`.
- Pacer treats N as a hard target.
- Trigger ratio decreases as `MemStats.Sys` approaches N.
- Scavenger more aggressive.

Soft limit: not enforced if live memory > N (no choice).

---

## 10. Stack Scanning

During mark:
- Each goroutine's stack is scanned.
- Stack maps (emitted by compiler) tell GC which slots are pointers.
- Goroutines preempted at safepoints; stack scanned by mark workers.

Hybrid write barrier eliminates the need for STW stack rescan.

---

## 11. GODEBUG Knobs

| Var | Effect |
|-----|--------|
| `gctrace=1` | Print one line per GC |
| `gctrace=2` | More detail |
| `gccheckmark=1` | Verify mark correctness (slow) |
| `allocfreetrace=1` | Trace every alloc/free (very slow) |
| `madvdontneed=1` | Use MADV_DONTNEED (default on Linux 4.5+) |
| `scavtrace=1` | Trace scavenger |

---

## 12. Reading Source Code

Key files:
- `src/runtime/mgc.go`: top-level GC controller.
- `src/runtime/mgcmark.go`: mark phase.
- `src/runtime/mgcsweep.go`: sweep phase.
- `src/runtime/mgcpacer.go`: pacer logic.
- `src/runtime/mwbbuf.go`: write barrier buffer.
- `src/runtime/mgcscavenge.go`: scavenger.

---

## 13. PGO Interactions

PGO can:
- Inline allocation sites that don't escape, eliminating allocations.
- Devirtualize interface calls, reducing boxing.

Typical savings: 5-10% reduction in allocations.

---

## 14. Alternative GC Modes (Limited)

Go does not provide pluggable GC. The standard mark-sweep concurrent GC is the only option.

`debug.SetGCPercent(-1)` disables GC entirely. Useful only for short-lived benchmarks; production = OOM.

---

## 15. Self-Assessment Checklist

- [ ] I understand tri-color marking and the invariant
- [ ] I know hybrid write barrier rationale
- [ ] I can read GC source files
- [ ] I understand pacer PI control
- [ ] I know mark assist throttling
- [ ] I can use GODEBUG knobs for diagnostics
- [ ] I understand scavenger mechanics

---

## 16. Summary

Go's GC is concurrent tri-color mark-sweep with hybrid write barriers. Mark workers drain grey queues; mark assist throttles allocators; pacer PI-controls trigger ratio. Scavenger returns pages to OS. GOMEMLIMIT bounds heap. STW phases <1 ms typically.

---

## 17. References

- [GC source](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/runtime/mgc.go)
- [Hybrid write barrier proposal](https://github.com/golang/proposal/blob/master/design/17503-eliminate-rescan.md)
- [Pacer redesign proposal](https://go.googlesource.com/proposal/+/master/design/44167-gc-pacer-redesign.md)
- [Memory limit proposal](https://go.googlesource.com/proposal/+/master/design/48409-soft-memory-limit.md)
- [GC Guide](https://go.dev/doc/gc-guide)
