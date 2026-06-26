# Off-heap / Native Memory — Interview Questions

> **Topic:** [Off-heap / Native Memory](README.md)

A bank of interview questions on off-heap and native memory, organized from fundamentals to system design. Each answer is written to the depth a strong candidate should reach — not just the headline, but the *why* and the trade-off.

---

## Table of Contents

- [Conceptual](#conceptual)
- [Tool-Specific](#tool-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What does "off-heap" mean, and why would a managed runtime ever leave its own GC heap?**

Off-heap (native, direct) memory is memory allocated directly from the OS — via `malloc`, `mmap`, or `VirtualAlloc` — rather than from the runtime's GC-managed heap. The GC neither scans, moves, nor reclaims it. Runtimes leave the heap for concrete reasons: to avoid GC pressure on huge long-lived datasets (a multi-GB cache off-heap adds zero scan time and zero pause time — the dominant JVM motivator); to share memory zero-copy with native code, FFI, DMA, or the kernel without pinning; to map files larger than RAM and get zero-copy IO; to get precise, deterministic lifetimes; to pack binary records without per-object header overhead; and to use inter-process shared memory.

## Question 2

**On the JVM, how is `ByteBuffer.allocateDirect` memory eventually freed?**

Not by any `close()` or `free()` — `ByteBuffer` has no such method. The allocation returns a tiny on-heap `DirectByteBuffer` wrapper holding the native address. A `Cleaner` registered on that wrapper frees the native memory *when the wrapper is garbage-collected*. So freeing is tied to GC of a tiny object, which is the worst of both worlds: it's manual memory, but reclaimed on the GC's unpredictable schedule. `-XX:MaxDirectMemorySize` provides a ceiling that, when hit, forces a GC and otherwise throws `OutOfMemoryError: Direct buffer memory`.

## Question 3

**Why does moving a large cache off-heap reduce GC pause times?**

GC pause cost scales with the size of the live object set the collector must trace. A 30 GiB on-heap cache means tens of millions of references the GC walks every cycle, and for generational/old-gen collections that's where the big pauses come from. Off-heap, that data is opaque bytes the GC never traces, so the live set shrinks to your genuinely short-lived working objects. Smaller live set → shorter pauses, and you can often run a smaller `-Xmx` too.

## Question 4

**What is a memory-mapped file, and how does lazy paging work?**

`mmap` (or `FileChannel.map` / `MapViewOfFile`) maps a file's bytes into your address space so you address the file like memory — no `read()` syscalls, no explicit buffers. Pages are loaded lazily: touching a byte whose page isn't resident triggers a page fault, and the kernel reads that 4 KiB page from disk into the page cache and maps it. This lets you work with files larger than RAM (the kernel pages the working set in and out) and gives zero-copy reads. `madvise` hints (SEQUENTIAL/RANDOM/WILLNEED) tune read-ahead.

## Question 5

**What is the difference between RSS and heap size, and why does it matter for off-heap?**

RSS (resident set size) is the physical memory the whole process occupies. The Java heap is only one contributor; RSS also includes metaspace, code cache, thread stacks, GC structures, direct buffers, mmap'd file pages, and native-library `malloc`. Off-heap memory shows up in RSS but *not* in heap metrics or `-Xmx`. This matters because the kernel/container enforces limits against RSS, so an off-heap leak grows RSS while the heap stays healthy — until you're OOM-killed with no `OutOfMemoryError`.

---

## Tool-Specific

## Question 6

**What is the modern, supported replacement for `Unsafe` and `allocateDirect`, and why prefer it?**

The Foreign Function & Memory API (Project Panama, `java.lang.foreign`, stable in Java 21+). You allocate from an `Arena` (the owner/lifetime) and get a `MemorySegment` (a bounded, bounds-checked view). `try (Arena arena = Arena.ofConfined())` frees all its segments *deterministically* on close. Prefer it because it replaces the Cleaner-driven unpredictability of `allocateDirect` and the total unsafety of `Unsafe` with scoped, deterministic, bounds-checked off-heap memory — and `Unsafe` is being removed.

## Question 7

**How do you diagnose a suspected native memory leak in a JVM?**

Top-down. First confirm it's native: compare used heap (GC logs / `jcmd GC.heap_info`) against RSS (`VmRSS`); a growing gap means native growth. Then enable Native Memory Tracking (`-XX:NativeMemoryTracking=summary`), take a `jcmd <pid> VM.native_memory baseline`, and later `summary.diff` to see which subsystem grew. Check `BufferPoolMXBean` for direct/mapped buffer totals. Use `pmap -X` / `/proc/<pid>/smaps` to find the big or numerous mappings. If the leak is below the JVM (in a JNI library or `malloc`), switch to jemalloc profiling (`MALLOC_CONF=prof:true` + `jeprof`) for the native call stack.

## Question 8

**How do off-heap allocations work in Go, Rust, and .NET?**

Go: `golang.org/x/sys/unix.Mmap` returns a `[]byte` the GC won't scan or free — you must `Munmap`. `GOMEMLIMIT` bounds the Go heap only, not your mmap. Rust: raw `std::alloc`, or `memmap2` for files; ownership/`Drop` makes freeing deterministic and the borrow checker catches use-after-free, making it the safest manual off-heap. .NET: `NativeMemory.Alloc`/`Free` (the modern, `malloc`-backed choice) or `Marshal.AllocHGlobal`/`FreeHGlobal` (classic), plus `MemoryMappedFile` for files — all outside the GC and outside any managed-heap limit.

## Question 9

**What does `-XX:MaxDirectMemorySize` do, and why set it explicitly?**

It caps total direct-buffer memory. When an `allocateDirect` would exceed it, the JVM forces a `System.gc()` to try to run pending Cleaners; if still over, it throws `OutOfMemoryError: Direct buffer memory`. Set it explicitly because the default is roughly `-Xmx`, which silently allows direct memory to nearly double your memory footprint and wrecks container budgeting. An explicit, smaller cap turns an unbounded native leak into a catchable, bounded JVM error.

---

## Tricky / Trap

## Question 10

**A service has a 2 GiB heap but 8 GiB RSS and gets OOM-killed. The heap dump shows nothing wrong. What's happening?**

The 6 GiB delta is off-heap/native memory the heap dump can't see: leaked direct buffers, mmap'd pages, thread stacks, or a JNI/`malloc` leak. The container OOM-killer enforces against RSS, so the process dies (exit 137) with no `OutOfMemoryError` and no useful heap dump. The fix is to stop looking at the heap, use NMT/`pmap`/jemalloc to find the growing native bucket, and budget the container against RSS rather than `-Xmx`.

## Question 11

**Why might a `DirectByteBuffer` leak get *worse* when you give the JVM a bigger heap?**

Direct-buffer native memory is freed by a Cleaner that runs only when the tiny wrapper is GC'd. A bigger heap means more room before the GC needs to run, so it runs less often, so Cleaners fire less often, so dead buffers' native memory sits unreclaimed longer. The "fix" of adding heap can therefore accelerate the off-heap growth. The real fix is deterministic freeing (`Arena`) or a `-XX:MaxDirectMemorySize` cap that forces GC under pressure.

## Question 12

**RSS plateaus high and never comes back down after you've freed native memory. Is this necessarily a leak?**

No. glibc `malloc` keeps per-thread arenas and tends to retain freed memory at its high-water mark rather than returning it to the OS, so RSS reflects peak usage, not current usage. Before chasing a "leak," confirm with the allocator: set `MALLOC_ARENA_MAX=2`, switch to jemalloc, or trigger a purge. Genuine leaks keep growing without bound; retention plateaus.

## Question 13

**`GOMEMLIMIT` is set to 4 GiB but the Go process is killed at 6 GiB. Why?**

`GOMEMLIMIT` is a soft limit on the Go *heap* and runtime-managed memory; it does not bound memory you obtained via `mmap` / `unix.Mmap` or through cgo/native libraries. Those mmap'd and native bytes count toward process RSS, which the container limit enforces. So off-heap growth sails right past `GOMEMLIMIT` and gets you OOM-killed — exactly analogous to off-heap escaping `-Xmx` on the JVM.

## Question 14

**You access a `MemorySegment` after its `Arena` is closed. What happens — and how does that compare to the raw `mmap` equivalent?**

Panama is safe: accessing a segment after its `Arena` closes throws `IllegalStateException` (the access is bounds- and liveness-checked). The raw equivalent — dereferencing a Go/C `mmap` slice after `Munmap`, or an `Unsafe` address after `freeMemory` — is undefined behavior: typically a SIGSEGV crash or silent memory corruption, with no protection. This safety-vs-rawness gap is exactly why Panama is preferred over `Unsafe`.

---

## Design

## Question 15

**Design the memory strategy for a 50 GiB read-mostly in-process cache on the JVM. Walk through the trade-offs.**

50 GiB on the managed heap would make GC pauses unacceptable, so the data belongs off-heap. Options: (a) off-heap with Panama `Arena`/`MemorySegment` and a read-in-place binary layout — best performance, zero GC pressure, but you hand-roll serialization and accessors; (b) a mmap-backed store (LMDB-style) so the OS page cache handles eviction and the working set, surviving restarts warm but yielding control over eviction and risking page-fault latency stalls; (c) an off-heap cache library (Ehcache/Chronicle/MapDB) to avoid hand-rolling. Keep keys/index on-heap (small, hot, needs fast lookups), values off-heap (large, GC-pressuring). Decide serialization: read-in-place to avoid re-introducing allocation churn. Budget the container as heap + 50 GiB off-heap + headroom, cap direct memory, and expose buffer-pool/NMT metrics so a leak is visible. The dominant trade-off is performance/control (manual off-heap) vs simplicity (mmap delegating to the kernel).

## Question 16

**How do you structure ownership of off-heap memory in a large codebase so it doesn't leak?**

Make ownership singular and explicit. Prefer arena/region scoping: allocate everything for a unit of work from one `Arena`, close it at the boundary, free in one shot — fast and impossible to forget an individual buffer. For hot reusable buffers, use an owner-pool with explicit return (or reference counting like Netty's `retain()/release()` with leak detection). Concentrate all native allocation and freeing in a small, well-tested set of components behind a safe API, and keep application code on the managed heap. Tie native lifetime to GC (auto-arena/Cleaner/finalizer) only as a last resort, never as the primary strategy — that's the unpredictability you were trying to escape.
