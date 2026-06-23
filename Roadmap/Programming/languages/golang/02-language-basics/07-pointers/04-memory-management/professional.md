# Go Memory Management — Professional / Internals Level

## 1. Overview

This document covers internals: the allocator's layered design (mcache/mcentral/mheap), size class table, page allocator, treap-based free-page management, write barrier implementation, scavenger, GC pacer formulas, and assembly-level details.

---

## 2. Allocator Architecture

```
┌─────────────────────────────────────┐
│    User code: new, make, &T{}        │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│  runtime.mallocgc (per-allocation)   │
└────────────────┬────────────────────┘
                 │
        ┌────────┴────────┐
        │ size <= 32 KB?  │
        └─┬──────────────┬┘
          │ yes          │ no
          ▼              ▼
   ┌──────────┐    ┌────────────┐
   │ mcache   │    │ mheap.alloc│
   │ per-P    │    │ direct page│
   └────┬─────┘    └─────┬──────┘
        │                │
        ▼                │
   ┌──────────┐          │
   │ mcentral │          │
   │ shared   │          │
   └────┬─────┘          │
        │                │
        ▼                ▼
   ┌──────────────────────┐
   │       mheap          │
   │  arena management     │
   └──────────────────────┘
```

---

## 3. Size Classes

`runtime/sizeclasses.go` defines ~70 size classes from 8 B to 32 KB. Each class has:
- Object size (rounded up).
- # objects per page (8 KB).
- Tail waste percentage.

Allocation rounds up to the nearest class. Internal fragmentation: 10-20% on average.

---

## 4. mcache (Per-P)

Each P (logical processor) has an mcache: per-size-class freelists of objects, plus the tiny allocator (16 B). Allocations from mcache are lock-free.

When mcache exhausts a size class, it refills from mcentral (acquires lock).

---

## 5. mcentral (Shared)

Per-size-class shared allocator. Manages partial spans (free objects available) and full spans (all allocated).

When mcentral runs out, it requests a new span from mheap.

---

## 6. mheap

Manages the entire heap: spans (1+ pages), the page allocator, OS interaction.

Page allocator: bitmap + radix tree for finding free pages. Returns pages to OS via `madvise(MADV_DONTNEED)` (or `VirtualFree` on Windows).

---

## 7. The GC Pacer

Goal: keep GC CPU usage at ~25% of one CPU while meeting the heap target.

Formula (simplified):
```
trigger_ratio = 1 + GOGC/100
heap_goal = live_heap * trigger_ratio
```

GC starts when allocated heap reaches `heap_goal`.

The pacer adjusts the trigger ratio dynamically based on observed mark cost vs allocation rate, aiming to:
- Keep CPU within budget.
- Stay below `heap_goal`.

Go 1.18+ pacer redesign improved adaptiveness for spiky allocation patterns.

---

## 8. Write Barriers

When `writeBarrier.enabled` is true (during marking), pointer mutations call:
```asm
runtime.gcWriteBarrier
```

Implementation enqueues the source/destination pointers in a per-P buffer. The GC drains buffers during marking.

For non-pointer writes (int, etc.), no barrier needed.

The compiler emits the barrier conditionally:
```asm
MOVQ writeBarrier(SB), AX
TESTL AX, AX
JZ skip
CALL runtime.gcWriteBarrier
skip:
MOVQ newValue, offset(targetReg)
```

---

## 9. Scavenger

Background goroutine that returns unused heap pages to the OS.

Trigger: when scavenged pages < target.

Mechanism: walks the page allocator's free list, calls OS-specific "return memory" syscall (`madvise` on Linux).

`debug.FreeOSMemory()` triggers explicit scavenging.

---

## 10. Stack Management

Each goroutine has a stack. Initial size: 2 KiB (Go 1.4+).

Growth: when prologue's stackguard check fails, calls `runtime.morestack`. The runtime allocates a 2× stack, copies live data, adjusts pointers via stack maps, resumes execution.

Shrinking: stacks may shrink at GC time when unused.

Max stack: 1 GiB (default), settable via `debug.SetMaxStack`.

---

## 11. Memory Limit Implementation

`debug.SetMemoryLimit(n)`:
- Sets `runtime.gcController.memoryLimit = n`.
- The GC pacer treats this as a hard constraint.
- As heap approaches limit, GC runs more aggressively.
- May significantly impact CPU.
- Soft limit: allocations may still exceed if allocator can't free fast enough.

---

## 12. Allocator Microbenchmark

```go
package main

import "testing"

func BenchmarkAlloc(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = new(int)
    }
}

func BenchmarkAllocLarge(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = new([1024]int)
    }
}
```

Typical:
- `new(int)`: ~5-10 ns/op (small, mcache hit).
- `new([1024]int)` (8 KB): ~30-50 ns/op (might miss mcache).
- `make([]byte, 1<<20)` (1 MB): ~10 µs/op (mheap, OS page request).

---

## 13. GC Trace Output

```bash
GODEBUG=gctrace=1 ./prog
```

Format:
```
gc N @T s P%: A+B+C ms clock, A+B/C/D+E ms cpu, F->G->H MB, I MB goal, J MB stacks, K MB globals, L P
```

- N: GC cycle number
- T: time since program start
- P%: % of total CPU spent in GC
- A+B+C ms clock: stop-the-world setup + concurrent mark + STW termination
- F->G->H MB: heap size at start, peak, end
- I MB goal: target heap

Use to verify GC behavior in production.

---

## 14. Allocation Trace

```bash
GODEBUG=allocfreetrace=1 ./prog
```

Logs every allocation/free with stack trace. EXTREMELY verbose; use for debugging only.

---

## 15. PGO and Memory

PGO (Go 1.21+) can:
- Inline hot allocation sites, sometimes eliminating them.
- Devirtualize interface calls; avoid boxing allocations.

For allocation-heavy services, PGO may save 5-10%.

---

## 16. Reading Generated Code

```bash
go build -gcflags="-S" 2>asm.txt
grep -A 5 "runtime.newobject" asm.txt
grep -A 5 "runtime.gcWriteBarrier" asm.txt
```

Identify allocation sites and write-barrier emissions.

---

## 17. Self-Assessment Checklist

- [ ] I know mcache/mcentral/mheap roles
- [ ] I understand size classes
- [ ] I can read `GODEBUG=gctrace=1` output
- [ ] I know write barrier mechanics
- [ ] I understand pacer goals
- [ ] I can profile allocations and GC
- [ ] I use SetMemoryLimit appropriately

---

## 18. References

- [Allocator source](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/runtime/malloc.go)
- [Size classes](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/runtime/sizeclasses.go)
- [GC source](https://cs.opensource.google/go/go/+/refs/tags/go1.22:src/runtime/mgc.go)
- [Pacer redesign proposal](https://go.googlesource.com/proposal/+/master/design/44167-gc-pacer-redesign.md)
- [Memory limit proposal](https://go.googlesource.com/proposal/+/master/design/48409-soft-memory-limit.md)
- 2.7.4.1 Garbage Collection
