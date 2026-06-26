# Object Pinning & Movable Heaps — Hands-On Tasks

> **Topic:** [Object Pinning & Movable Heaps](README.md)

These tasks build from observing that a heap moves, through using each runtime's pinning mechanism correctly, to diagnosing and fixing the fragmentation and lifetime hazards that pinning causes at scale. Pick the runtime you're most comfortable with for the warm-ups; the capstone is best done in whichever of .NET / Go / JVM you can profile.

Work the self-checks honestly — for pinning, "it ran without crashing once" is not evidence of correctness, because the GC may simply not have moved anything during your test.

---

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Catch the heap moving an object

Demonstrate that an object's address is not stable. In .NET, capture the address of an object two ways at two times across a forced GC; in Go, observe that taking `uintptr(unsafe.Pointer(&x))` before and after `runtime.GC()` plus allocation pressure can change (or reason precisely about why it might not in a given build).

**Self-check:**

- [ ] I produced (or explained, with the runtime's docs) a case where the raw address changes across a collection
- [ ] I can state why a managed *reference* to the same object stays valid even when the address changes
- [ ] I did not conclude "addresses are stable" just because one run didn't move the object

<details>
<summary>Hint</summary>

A single object rarely moves on demand; you usually need allocation pressure (promote it, fill a generation) plus `GC.Collect()` / `runtime.GC()` to provoke compaction or promotion. The point isn't a guaranteed move every run — it's understanding that the runtime is *allowed* to move it.

</details>

### Task 2 — Pin with the scoped mechanism

Pin a buffer for the duration of one synchronous native (or simulated native) call using the lexically scoped tool: .NET `fixed`, or Go `runtime.Pinner` with `defer Unpin`. Pass the stable pointer to a function that records the address, and confirm the address is what you expect.

**Self-check:**

- [ ] The pin is released deterministically at the end of the scope
- [ ] I used `defer Unpin` / the `fixed` block rather than an open-ended handle
- [ ] I can explain what "the pin is released" means to the collector

<details>
<summary>Hint</summary>

.NET: `fixed (byte* p = buffer) { Native(p, buffer.Length); }`. Go: `var pinner runtime.Pinner; defer pinner.Unpin(); pinner.Pin(&buf[0])`.

</details>

### Task 3 — Reason about reference vs. address vs. identity

Write down, for your chosen runtime, three concrete operations: one that relies on reference validity, one that captures a raw address, and one that relies on identity (identity hash or reference equality). Annotate which survive a relocation and which don't.

**Self-check:**

- [ ] I correctly classified each operation as move-safe or move-unsafe
- [ ] I noted that identity is preserved without depending on the raw address
- [ ] I identified the address capture as the only move-unsafe one

---

## Core

### Task 4 — Async pin done wrong, then right (.NET) / retained pointer (Go)

**.NET path:** Write a method that pins a buffer with `GCHandle.Pinned` across an `await` of a slow operation, then rewrite it to (a) use a POH-allocated buffer (`GC.AllocateArray<byte>(n, pinned: true)`) and (b) use a `Memory<T>`-based async API. Compare the pin lifetimes.

**Go path:** Write a cgo call where C (simulate with a global) retains a Go pointer after the call returns, observe/reason about why that's illegal even with a pin during the call, then fix it by allocating in C or using a long-lived registry.

**Self-check:**

- [ ] I can articulate why the first version's pin lifetime is tied to control flow, not the OS operation
- [ ] The fixed version either never pins the general heap or pins only for the OS operation's duration
- [ ] (Go) I understand that pinning during a call does not authorize C to retain the pointer afterward

<details>
<summary>Hint</summary>

The .NET smell is `GCHandle.Alloc(buf, Pinned)` followed by `await`. The duration of that pin is now the duration of the slowest peer. POH or `Memory<T>` async APIs decouple pin lifetime from your `await`.

</details>

### Task 5 — JNI: critical region vs. copy (or simulate the trade-off)

If you can run JNI: implement the same array-processing native function twice — once with `GetPrimitiveArrayCritical`/`Release` and once with `GetByteArrayElements`/`ReleaseByteArrayElements` — and note `isCopy`. If you can't run JNI, write a precise design memo: for a (a) tight CPU-bound loop and (b) a function that does blocking I/O, which API is correct and why.

**Self-check:**

- [ ] I correctly chose the critical-region API only for the non-blocking, no-JNI-call case
- [ ] I chose `Get…ArrayElements` (may copy) for the blocking case and explained the critical-region restrictions
- [ ] I can state what happens to other threads while one thread sits in a critical region

<details>
<summary>Hint</summary>

The critical-region rules: no blocking, no other JNI calls, no allocation, no Java callbacks. Violating them risks stalling every thread because the VM commonly disables GC during a critical region.

</details>

### Task 6 — Pin a pointer *inside* a struct passed to C (Go)

Construct a Go struct containing a Go pointer field and pass it to a (simulated or real) C function. Trigger the `cgocheck` violation, then fix it by pinning the inner pointer with `runtime.Pinner` before the call.

**Self-check:**

- [ ] I reproduced (or precisely explained) the "cgo argument has Go pointer to Go pointer" condition
- [ ] I fixed it by pinning the inner pointer, not by changing the call site
- [ ] I understand that cgo legality depends on the whole reachable pointer graph

<details>
<summary>Hint</summary>

`GODEBUG=cgocheck=1` is the default. Pin both the struct and its inner pointer if C dereferences either across a move window: `pinner.Pin(&body[0]); pinner.Pin(req)`.

</details>

---

## Advanced

### Task 7 — Visualize pinning-induced fragmentation

Allocate many objects, pin a scattered subset for their lifetime, force collections, and observe fragmentation. In .NET, use a GC trace (`dotnet-trace` with the GC provider) or `dotnet-gcdump` to see pinned objects and the holes around them; compare against the same workload using POH-allocated pinned buffers.

**Self-check:**

- [ ] I observed (or measured) higher fragmentation / GC frequency with scattered pins vs. POH
- [ ] I can explain the "rocks in the river" model of why survivors fragment around pins
- [ ] The POH variant kept the general heap's fragmentation low

<details>
<summary>Hint</summary>

Scatter the pins (pin every Nth long-lived object across generations) to maximize holes; that's the pathological case POH was built to eliminate.

</details>

### Task 8 — Detect a pin leak

Write code that leaks pins: a `GCHandle.Pinned` freed only on the happy path (skip `Free` on an exception), or a `runtime.Pinner` whose `Unpin` is never called (missing `defer`). Then add diagnostics — a handle/pinner census, rising RSS with stable live-object count, or GC fragmentation trending up — that would catch it in production. Finally, fix ownership so release is guaranteed.

**Self-check:**

- [ ] My leak demonstrably keeps objects immovable and alive that should be collectable
- [ ] I added a signal that distinguishes a pin leak from ordinary memory growth
- [ ] The fix guarantees release on every path (`using`/`SafeHandle`/`defer`/`finally`)

<details>
<summary>Hint</summary>

A leaked pin is a double bug: the object never gets collected *and* it permanently obstructs compaction. The diagnostic tell is RSS or fragmentation rising while the live-object count is flat.

</details>

### Task 9 — Replace pinning with off-heap memory

Take a workload that pins an on-heap buffer for long-lived sharing with native code and re-implement it with off-heap memory: a JVM `DirectByteBuffer`, or .NET native memory (`Marshal.AllocHGlobal` / a custom `MemoryManager<T>`). Show that native code can hold the address indefinitely with no pin and no copy, and account for the new manual-lifetime responsibility.

**Self-check:**

- [ ] The native side holds a stable address with zero pinning of the managed heap
- [ ] I correctly handle deallocation (off-heap memory isn't reclaimed by the GC for you)
- [ ] I can explain when off-heap beats POH/pinning and when it doesn't

<details>
<summary>Hint</summary>

Off-heap allocation is more expensive than on-heap, so pool the buffers. The win is that the GC never has to know about them at all.

</details>

---

## Capstone

### Task 10 — Build and harden a zero-copy I/O buffer pool

Implement a small buffer pool for a high-throughput I/O path on a compacting-GC runtime (.NET, Go, or JVM) and prove it doesn't degrade the collector under load.

Requirements:

- Buffers must be safely usable by native/kernel code via a stable address (real or simulated DMA / async I/O).
- Buffers must **not** fragment the general heap: use POH (`pinned: true`), off-heap (`DirectByteBuffer` / native), or a tightly scoped runtime-managed pin per operation — justify your choice.
- Pin/lifetime must track the OS operation, not your control flow; release must be guaranteed on every path.
- Run a load test with many concurrent operations including some slow ones (to provoke pin amplification) and measure GC frequency, pause time, and fragmentation against a naive `GCHandle.Pinned`-across-`await` (or equivalent) baseline.
- For any long-lived *identity* the native side needs, pass a handle/index, not a raw address.

**Self-check:**

- [ ] My pool keeps interop buffers off the movable general heap (or pins only per-OS-operation)
- [ ] Release is guaranteed even under exceptions/panics and on the slow-client path
- [ ] My load test shows lower fragmentation / GC frequency / pause time than the naive baseline
- [ ] I used handles (not addresses) wherever the native side needed identity rather than a buffer
- [ ] I can defend every pinning decision in terms of fragmentation and pin lifetime

<details>
<summary>Hint</summary>

The naive baseline (pin across an unbounded `await`, thousands of concurrent slow peers) is your foil — design the pool so that pin lifetime is bounded by the kernel operation and the pinned regions are segregated or off-heap. The measurable win is in the GC, not the happy-path throughput.

</details>

---

## Self-Assessment

You have mastered this topic if you can:

- [ ] Explain why compacting/copying/generational collectors move live objects, and how the runtime keeps managed references valid across moves.
- [ ] Distinguish reference validity, address stability, and identity, and say which a movable heap guarantees.
- [ ] Use each runtime's pinning mechanism correctly: .NET `fixed` / `GCHandle.Pinned` / `Memory<T>.Pin` / POH; Go cgo rules + `runtime.Pinner`; JNI `Get…Critical` / `Get…ArrayElements` / `DirectByteBuffer`.
- [ ] Explain why pinning fragments a compacting heap and inflates pause time and frequency, and why POH / off-heap fixes it.
- [ ] Recognize and fix the production failure modes: pin amplification across async boundaries, leaked pins, retained C pointers, broken cgo struct legality, and JNI critical-region stalls.
- [ ] State clearly why Rust's `Pin<P>` is an unrelated, compile-time concept for self-referential types, not GC relocation.
- [ ] Default to: pin briefly and locally, segregate or go off-heap for long-lived sharing, guarantee release on every path, and prefer stable handles over raw addresses for identity.
