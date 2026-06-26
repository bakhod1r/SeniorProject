# Object Pinning & Movable Heaps — Professional Level

> **Topic:** [Object Pinning & Movable Heaps](README.md)
> **Focus:** Production FFI integration, the fragmentation and pause-time hazards of pinning at scale, and the war stories that teach you where pins go wrong.

---

## Table of Contents

- [Introduction](#introduction)
- [Core Concepts](#core-concepts)
  - [The DMA / async-IO buffer: the canonical driver](#the-dma--async-io-buffer-the-canonical-driver)
  - [Why pinning fragments a compacting heap](#why-pinning-fragments-a-compacting-heap)
  - [Pinning and pause time](#pinning-and-pause-time)
- [FFI Integration In Practice](#ffi-integration-in-practice)
  - [.NET: pinning across async I/O](#net-pinning-across-async-io)
  - [Go: cgo, runtime.Pinner, and struct graphs](#go-cgo-runtimepinner-and-struct-graphs)
  - [JVM: critical regions, copies, and off-heap](#jvm-critical-regions-copies-and-off-heap)
- [War Stories](#war-stories)
- [Diagnosing Pinning Problems](#diagnosing-pinning-problems)
- [Pros & Cons](#pros--cons)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

At the senior tier, pinning is a clean contract: tell the collector "don't move this," hand the address across the boundary, release. In production, the contract leaks. A pin that was supposed to last microseconds spans an `await` that blocks on a slow network. A high-throughput service pins thousands of receive buffers simultaneously and watches its compacting heap turn into Swiss cheese. A cgo caller passes a Go struct that *looks* pointer-free but isn't after someone adds a field. This tier is about those failure modes — what they look like in a profiler, why they happen, and the integration patterns that keep them from happening.

The unifying theme: **pinning's cost is not paid at the pin site; it's paid by the next collection.** That temporal disconnect is what makes pinning bugs subtle. The code that pins runs fast and looks correct. The garbage collector, minutes later and on another thread, pays the bill in fragmentation and pause time.

---

## Core Concepts

### The DMA / async-IO buffer: the canonical driver

Almost every legitimate pin traces back to one scenario: **a buffer whose address is held by something outside the managed runtime for a span of real time.**

- **DMA (Direct Memory Access).** A NIC, NVMe controller, or GPU is handed a physical/virtual address and programmed to read or write that memory *itself*, asynchronously, without the CPU. The device has no notion of a managed heap. If the GC relocates the buffer after the descriptor is programmed but before the device finishes, the device scribbles into the wrong place. The buffer must stay put for the entire DMA transaction.
- **Asynchronous I/O.** `ReadFile`/`WriteFile` with `OVERLAPPED`, `io_uring`, POSIX AIO, or a `recv` that the kernel completes later — the kernel keeps the user buffer address and writes into it when data arrives. The managed call returns immediately; the buffer must remain at its address until completion, which can be arbitrarily far in the future.
- **Synchronous syscalls that block.** Even a plain blocking `read(2)` holds your buffer address inside the kernel for the duration of the call. On runtimes that can GC while a thread is parked in a syscall, the buffer needs protection.

The lifetime of the pin equals the lifetime of the *external reference to the address*, which is dictated by hardware and the kernel, not by your code's control flow. That is why long pins are so easy to create accidentally: the duration is set by an I/O completion you don't directly observe.

### Why pinning fragments a compacting heap

A compacting collector's job is to slide live objects toward one end of a region, squeezing out the gaps left by dead objects, so the free space coalesces into one contiguous block. A pinned object is a rock the river must flow around.

```
Before compaction (P = pinned, x = live, . = dead):
[ x x . . P x . x . . x P . x ]

What compaction WANTS (slide everything left):
[ x x x x x x x . . . . . . . ]   <- one big free block

What compaction GETS with pins fixed in place:
[ x x x x P . . . x x P . . . ]   <- free space split by the pins
            ^hole              ^hole
```

The pinned objects cannot move, so survivors pile up against them and the reclaimed space is broken into fragments straddling each pin. Two consequences:

1. **External fragmentation returns** — the very thing compaction exists to prevent. Large allocations can fail while plenty of total free space exists, scattered around pinned objects.
2. **The collector does more work** — it must detect pins, plan around them, and often abandon the simple "slide everything left" pass for a more expensive constrained layout.

This is precisely why .NET introduced the **Pinned Object Heap**: move all the rocks out of the river. Objects allocated with `GC.AllocateArray<T>(n, pinned: true)` live in a separate non-compacting segment, so the general heap compacts freely and the pins do their damage in a region that wasn't going to compact anyway.

### Pinning and pause time

Stop-the-world compaction time scales with the work the collector must do. Pins inflate it in two ways:

- **Planning overhead.** Constrained compaction (lay out survivors around immovable objects) is more expensive than unconstrained sliding.
- **Reduced effectiveness → more frequent GCs.** Fragmentation means each GC reclaims less usable contiguous space, so the allocator hits the next threshold sooner, so GCs run more often. More frequent GCs means more total pause time, even if each pause is similar.

On the JVM, a JNI **critical region** can be worse than a slow GC: while a thread holds a `GetPrimitiveArrayCritical` region, the VM commonly **disables GC entirely**. If another thread then needs to allocate and the heap is full, it blocks until the critical region ends. A single slow critical region (someone did blocking I/O inside it) can therefore stall *every* application thread — a latency cliff that looks like a full-heap stall but is actually one misbehaving native call.

---

## FFI Integration In Practice

### .NET: pinning across async I/O

The dangerous pattern is pinning that must survive an asynchronous completion. With `GCHandle.Pinned`, *you* own the lifetime, and it is easy to span an `await`:

```csharp
// HAZARD: pin held across an async boundary of unbounded duration
var h = GCHandle.Alloc(buffer, GCHandleType.Pinned);
try {
    await socket.ReceiveAsync(h.AddrOfPinnedObject(), buffer.Length); // could block for seconds
} finally {
    h.Free();
}
```

If thousands of connections do this concurrently, you have thousands of simultaneous pins scattered across the heap for as long as the slowest peer takes to send data. The production-grade fixes:

- **Allocate the buffer in the POH once, reuse it.** A buffer that lives in the Pinned Object Heap for its whole life never obstructs the general heap, and you stop paying per-operation pinning:

  ```csharp
  // Allocated immovable for life; no per-op GCHandle churn, no general-heap holes.
  byte[] buffer = GC.AllocateArray<byte>(8192, pinned: true);
  Span<byte> span = buffer;                // usable as a normal array too
  ```

- **Prefer `Memory<T>`-based async APIs.** `Socket.ReceiveAsync(Memory<byte>, ...)` and `Stream.ReadAsync(Memory<byte>, ...)` internally pin via `MemoryHandle` only for as long as the underlying OS operation needs, and integrate with `IMemoryOwner<T>`/`MemoryPool<T>` so buffers come from a pool rather than fresh allocations. This is the idiomatic modern path: you express intent ("read into this memory") and the runtime manages pinning.
- **Use a buffer pool of POH/native buffers.** `ArrayPool<T>` reduces allocation churn but does not pin; pairing a pool with POH allocation (or native memory) gives you reuse *and* immovability.

### Go: cgo, runtime.Pinner, and struct graphs

The cgo rules bite hardest with *graphs of pointers*. A flat `[]byte` is easy; a struct containing pointers is where teams get burned:

```go
type Request struct {
    Body    *byte   // Go pointer INSIDE a struct passed to C
    BodyLen C.size_t
}

func send(body []byte) {
    var pinner runtime.Pinner
    defer pinner.Unpin()

    req := &Request{Body: &body[0], BodyLen: C.size_t(len(body))}
    pinner.Pin(&body[0]) // pin the INNER pointer so the struct is legal to pass
    pinner.Pin(req)      // and the struct itself if C dereferences it after a move window

    C.process((*C.Request)(unsafe.Pointer(req)))
}
```

Key production realities:

- **`Unpin` releases everything on that `Pinner` at once.** The `defer pinner.Unpin()` pattern is the safe default — one cleanup covers all pins, and it runs even on panic.
- **The rules are enforced at runtime in race/cgocheck builds.** `GODEBUG=cgocheck=1` (default) catches "Go pointer to Go pointer" violations *if the pointer is reachable at the moment C is called*; `cgocheck=2` is more thorough but slower. A violation panics with `cgo argument has Go pointer to Go pointer` — the runtime is telling you to pin.
- **C must not retain.** If a C library stashes your pointer in a global for later use, pinning during the call is not enough — the moment the call returns, `Unpin` will run and the pointer becomes movable/collectable. For "C keeps it" lifetimes, allocate in C (`C.malloc`) or use a registry of pinned objects with a longer-lived `Pinner` whose `Unpin` is tied to the native object's destruction.
- **`uintptr` launders away GC tracking.** Converting through `uintptr` and back is the classic way to defeat both pinning and reachability — the GC does not see a `uintptr` as a pointer. The `unsafe.Pointer` rules exist precisely to keep the conversion atomic; pinning does not save you if you've already stored a `uintptr`.

### JVM: critical regions, copies, and off-heap

The decision tree for JNI array access in production:

- **Short, CPU-bound, no JNI calls, no blocking** → `GetPrimitiveArrayCritical`. Fast (often a true pin, no copy), but the critical-region rules are non-negotiable: no allocation, no blocking, no other JNI calls, no callbacks into Java. Keep it to a tight loop over the array and `Release` immediately.
- **Anything that might block or call back** → `Get<Type>ArrayElements`. May copy (check `isCopy`), but carries no critical-region restrictions, so it's safe to do I/O. Choose the right `Release` mode: `0` to write back and free, `JNI_ABORT` to discard (no write-back — important when you only read).
- **Long-lived sharing, high throughput** → **`DirectByteBuffer`** / off-heap. Allocate with `ByteBuffer.allocateDirect`, get the address via `GetDirectBufferAddress`, and the native side can hold it indefinitely with zero copies and zero pinning, because it was never on the Java heap. The cost is manual lifetime management (direct buffers are reclaimed only when their cleaner runs or via explicit unmapping), and allocation is more expensive than on-heap — so pool them.

The strategic JVM stance: **do not pin the managed heap for anything that lives long or might block. Copy for brief reads, go off-heap for sustained sharing.**

---

## War Stories

- **The async pin that spanned a slow client.** A .NET gateway pinned receive buffers with `GCHandle.Pinned` across `ReceiveAsync`. Under normal load, fine. Then a wave of slow mobile clients held connections open; thousands of pins persisted for seconds each, scattered across gen0/gen2. Gen2 fragmentation ballooned, large-object allocations began failing, and gen2 GCs ran constantly. Fix: move buffers to the POH (one immovable allocation per connection, pooled) and adopt `Memory<T>`-based async APIs. Fragmentation and gen2 frequency dropped to baseline.

- **The JNI critical region that blocked the world.** A native image codec used `GetPrimitiveArrayCritical` to get the pixel array, then — inside the critical region — called back into Java to log progress and occasionally did a file read. With GC disabled during the region, any other thread that needed to allocate while the codec did its slow I/O stalled. Tail latency spiked to seconds under load. Fix: copy the pixels out with `GetByteArrayElements` (or use a `DirectByteBuffer`), do all the slow work outside any critical region.

- **The cgo struct that grew a pointer.** A Go service passed a config struct to a C library; originally all scalar fields, perfectly legal. A later commit added a `*Logger` field for convenience. Tests passed (the pointer happened to be nil or the GC didn't move during tests). In production under GC pressure, `cgocheck` panicked: `cgo argument has Go pointer to Go pointer`. Fix: pin the inner pointer with `runtime.Pinner`, and add a code-review rule that any struct crossing cgo is reviewed for embedded pointers. The deeper lesson: cgo legality is a property of the *whole reachable graph*, and it can be broken by a field added far from the call site.

- **The leaked GCHandle.** A library allocated a `GCHandle.Pinned` for an interop callback context and freed it in a `Dispose` that an exception path skipped. Each leaked handle pinned ~64 KB forever. Over weeks the process accumulated thousands of immovable, never-collected objects; the heap couldn't compact around them and working set crept until OOM. Fix: `SafeHandle`-style ownership so `Free` is guaranteed, plus a periodic `GCHandle` census in diagnostics.

---

## Diagnosing Pinning Problems

- **.NET:** ETW/EventPipe GC events expose pinned-object counts and fragmentation per generation. `dotnet-trace` with the GC provider, or `dotnet-gcdump` + a heap viewer, shows pinned objects and the holes around them. A rising `% Time in GC` together with gen2 fragmentation and frequent gen2 collections is the signature. `GCHandle` counts climbing without bound point to leaked pins.
- **JVM:** Async-profiler or JFR will show threads parked in JNI; correlating allocation stalls with critical-region duration exposes the "GC disabled while a thread is in a critical region" pattern. `-Xlog:gc*` reveals fragmentation-driven GC frequency. Direct-buffer leaks show up as growing off-heap/native memory with stable Java-heap usage (watch `BufferPoolMXBean`).
- **Go:** `cgocheck` panics name the violation directly. For pin pressure, there's no first-class metric, so instrument your own `Pinner` usage; a `Pinner` that is never `Unpin`'d (missing `defer`) is a pin leak that keeps objects immovable and alive. The Go heap profile plus rising RSS without a matching live-object count can indicate pinned-but-unreachable accumulation.

---

## Pros & Cons

- **Pro — zero-copy interop.** For high-throughput I/O and DMA, pinning (or off-heap) avoids per-operation copies that would otherwise dominate CPU and cache footprint.
- **Pro — correctness across the boundary.** It is the only safe way to hand a managed buffer's address to code the GC can't see.
- **Con — deferred, non-local cost.** The price is paid by later collections as fragmentation and pause time, far from the pin site, making it hard to attribute.
- **Con — easy to overextend.** Async boundaries, blocking syscalls, and retained C pointers all silently lengthen pin lifetimes. Long or numerous pins are corrosive.
- **Con — leak-prone.** A pin is a strong root plus an immovability flag; leaking it is a double bug (memory leak + permanent heap obstruction).

---

## Best Practices

- **Make pin lifetime equal to the OS operation, not your control flow.** Prefer runtime-managed pinning (`Memory<T>` async APIs, scoped `Pinner`) so the pin tracks the actual external reference, not an `await` you happened to write.
- **For sustained sharing, get off the movable heap.** POH (`pinned: true`), `DirectByteBuffer`, or native (`C.malloc`/`Marshal.AllocHGlobal`) memory. Pool these buffers; off-heap allocation is more expensive than on-heap.
- **Guarantee unpin on every path.** `using` / `defer Unpin` / `finally` / `SafeHandle`. Never free a pin only on the happy path.
- **Keep JNI critical regions microscopic.** No blocking, no JNI calls, no Java callbacks, no allocation. If you can't guarantee that, copy instead.
- **Review the full pointer graph at cgo boundaries.** A struct is only as legal as its most deeply nested embedded Go pointer. Pin inner pointers; treat new pointer fields as cgo-breaking changes.
- **Pass handles, not addresses, for long-lived identity.** A normal (non-pinned) `GCHandle` or an index into a managed table gives stable identity across the boundary without forbidding relocation.
- **Instrument pins.** Track handle/pinner counts and GC fragmentation so a slow leak or a pin-amplification regression is visible before it OOMs.

---

## Edge Cases & Pitfalls

- **Pin amplification under concurrency.** A pin held across `await`/blocking I/O multiplied by thousands of concurrent operations equals thousands of long-lived heap obstructions. This is the single most common production pinning failure.
- **Critical-region GC disablement deadlock.** Slow work inside a JNI critical region stalls every thread that needs to allocate. Looks like a full GC stall; is actually one bad native call.
- **Silently broken cgo legality.** Adding a pointer field to a struct that crosses cgo breaks the call without changing the call site. Caught only at runtime under GC pressure.
- **Retained C pointers.** Pinning during a call doesn't help if C keeps the pointer after return. Use C-allocated memory or a long-lived registry for "C keeps it" lifetimes.
- **`uintptr` / address snapshots.** An address captured while pinned is invalid after unpin; a `uintptr` is invisible to the GC and keeps nothing alive or stable.
- **Leaked pins as compounding debt.** Every leaked pin permanently obstructs compaction *and* leaks the object. The damage accumulates and degrades the whole heap, not just one allocation.
- **Empty-buffer pinning.** Pinning a zero-length array yields a null pointer in .NET; native code expecting a non-null base + zero length may fault.

---

## Summary

In production, pinning's cost is temporal and non-local: the pin site runs fast and correct, while the next garbage collection pays in fragmentation and pause time. The canonical legitimate pin is a DMA or async-I/O buffer whose address is held by hardware or the kernel for a span of real time you don't directly control — which is exactly why pins so easily become long and numerous. Fragmentation arises because pinned objects are rocks a compacting collector must flow around, splitting reclaimed space and forcing constrained, more expensive layout; the JVM's critical regions go further and can stall every thread by disabling GC. The durable production patterns are the same across runtimes: keep pins as short as the OS operation, move sustained sharing off the movable heap (POH, `DirectByteBuffer`, native memory) and pool it, guarantee unpin on every path, review the entire pointer graph at FFI boundaries, and prefer stable handles to raw addresses for long-lived identity. The war stories all rhyme — an async pin that spanned a slow peer, a critical region that blocked the world, a struct that quietly grew a pointer, a handle that leaked — and they all reduce to the same discipline: pin briefly, locally, and with guaranteed release, or don't pin at all.
