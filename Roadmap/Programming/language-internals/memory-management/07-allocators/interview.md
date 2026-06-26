# Allocators — Interview Questions

> **Topic:** [Allocators](README.md)

A bank of interview questions on memory allocators, from fundamentals through production tuning and design. Each question pairs the prompt with an answer at the depth a strong candidate would actually give — concrete, honest about trade-offs, and grounded in real systems (glibc, jemalloc, tcmalloc, mimalloc, the Linux slab/buddy allocators).

## Table of Contents

- [Conceptual](#conceptual)
- [Tool-Specific](#tool-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**What is a memory allocator actually doing, and why don't we just call the OS for every allocation?**

A memory allocator turns the *coarse* memory the OS hands out — whole pages via `mmap`/`sbrk`/`VirtualAlloc`, typically 4 KiB at a time — into the *fine-grained* blocks a program asks for through `malloc`/`new`. We don't call the OS per allocation because a system call costs hundreds of nanoseconds to microseconds (mode switch, kernel work, TLB effects), versus a few nanoseconds for a well-designed `malloc` that just pops a free list. The allocator buys memory wholesale from the kernel occasionally and retails it in small pieces, amortizing the expensive syscalls. It also tracks what's in use so `free` can recycle memory, and fights fragmentation so the heap stays usable over time.

## Question 2

**When you call `free(ptr)`, you don't pass a size. How does the allocator know how much to free?**

It stored the size itself. Most general-purpose allocators place a small **header** (boundary tag) immediately *before* the memory they return to you; that header records the chunk's size and status flags. On `free`, the allocator subtracts the header offset from your pointer, reads the size, and proceeds. This is why `malloc(1)` may consume 24+ bytes — the header plus alignment rounding. Allocators that *don't* use per-object headers (pool/slab allocators) instead derive the size from *where* the pointer lives — the page or slab a pointer belongs to is dedicated to one size class, so the size is implicit.

## Question 3

**Explain internal vs. external fragmentation.**

Internal fragmentation is wasted space *inside* an allocation you were given — padding from size-class rounding, alignment, or headers. Ask for 40 bytes, get a 48-byte size class, 8 bytes wasted. External fragmentation is free memory *outside* allocations that's unusable because it's scattered into pieces too small to satisfy a request — you might have 1 MB free total but no contiguous 100 KB block. Size-class/segregated allocators trade a little internal fragmentation (rounding) to largely eliminate per-class external fragmentation. Coalescing adjacent free chunks is the classic defense against external fragmentation in a general-purpose heap.

## Question 4

**What are coalescing and splitting, and why does each matter?**

**Splitting** happens on allocation: a large free chunk is cut into the piece you requested plus a smaller leftover free chunk, so the remainder isn't wasted. **Coalescing** happens on free: a newly freed chunk is merged with any adjacent free neighbors into one larger chunk. Without coalescing, a workload that allocates and frees different sizes shreds the heap into ever-smaller free fragments until large requests can't be satisfied — external fragmentation. Boundary tags (a size copy at both ends of a chunk) plus a `PREV_INUSE` flag let the allocator inspect physical neighbors in O(1) to decide whether to merge.

## Question 5

**Compare first-fit, best-fit, and next-fit placement.**

First-fit takes the first free chunk large enough — fast, tends to leave big chunks toward the end but pollutes the front with small leftovers. Best-fit takes the smallest chunk that fits — minimizes immediate leftover but a naive scan is O(n) and it creates many tiny unusable slivers. Next-fit is first-fit that resumes the search where it last stopped — it spreads allocations around and, counterintuitively, usually fragments *worse* and hurts cache locality. In practice modern allocators don't linearly scan at all; they use **segregated free lists** per size class, which approximates best-fit at O(1) cost.

## Question 6

**Describe the buddy allocator.**

The buddy system manages memory in power-of-two-sized blocks. To satisfy a request, it finds the smallest power-of-two block ≥ the request; if only larger blocks are free, it repeatedly **splits** one in half, each half being the other's "buddy." On free, if a block's buddy is also free, they **merge** back, recursively up. Buddies' addresses differ in exactly one bit, so finding a buddy is a single XOR — split/merge are cheap. The cost is internal fragmentation: a 33 KiB request rounds to a 64 KiB block. Linux uses a buddy allocator for *physical pages* and layers the slab allocator on top for kernel objects.

## Question 7

**What's a slab/pool allocator and when would you use one?**

A slab (or pool, or object cache) allocator serves objects of *one fixed size*. It pre-carves a slab of memory into equal slots and threads a free list through the empty ones; allocate and free are O(1) list pop/push, there's no per-object header (size is implicit), and there's zero fragmentation as long as every object is that size. The Linux kernel's slab/slub allocator is the canonical example — it keeps caches per object type (`inode_cache`, `kmalloc-64`), so allocating an inode is a free-list pop, and freed objects stay cache-hot. Use one whenever you allocate many objects of the same type at high churn: packets, AST nodes, connection structs, particles.

## Tool-Specific

## Question 8

**Walk through how glibc's malloc (ptmalloc) is structured.**

glibc derives from Doug Lea's dlmalloc. Free chunks live in **bins**: *fast bins* (small, singly linked LIFO, freed without immediate coalescing for speed), *small bins* (exact-size doubly linked lists), *large bins* (size ranges, sorted, approximate best-fit), and an *unsorted bin* that temporarily holds recently freed/split chunks and gets sorted lazily on the next `malloc`. The unallocated tail is the **top chunk** (wilderness), grown via `sbrk`/`mmap`. For thread scalability glibc uses **multiple arenas** (each with its own lock, count ~`8×nproc`) plus a small per-thread **tcache**. Requests above the `mmap` threshold (~128 KiB) bypass bins and get their own `mmap`/`munmap` region.

## Question 9

**jemalloc vs. tcmalloc vs. mimalloc — what distinguishes them?**

All three share the modern template — per-thread caches over sharded arenas over the OS — but differ in emphasis. **jemalloc** (FreeBSD, Meta, historically Rust) centers on minimizing fragmentation and blowup, with explicit decay-based purging and rich `MALLOC_CONF`/`mallctl` introspection. **tcmalloc** (Google) emphasizes per-thread *and* per-CPU (`rseq`) caches with central free lists and a page heap, tuned for huge multithreaded server fleets. **mimalloc** (Microsoft) uses **free-list sharding per page** — each page owns a free list keyed by the allocating thread — making local frees lock-free and remote (cross-thread) frees a single atomic push, which gives excellent locality and unusually compact, predictable metadata. There's no universal winner; the right choice is workload-specific and decided by measuring RSS and tail latency.

## Question 10

**How would you tell whether a service's growing memory is a leak or fragmentation?**

Compare what the program *holds* against its *RSS*. Pull `allocated` from allocator stats (jemalloc `stats.allocated` via `mallctl`, or tcmalloc's properties) and compare to `VmRSS` in `/proc/<pid>/status`. If `allocated` itself climbs without bound, it's a real **leak** — objects never freed; find the missing free with a sampled heap profile (`jeprof`, pprof) that shows live bytes per allocation site only growing. If `allocated` is stable but RSS sits far above it, it's **fragmentation or unpurged pages** — fixed by tuning decay, capping arenas, or segregating lifetimes, not by finding a missing free. The two have opposite remedies, so making this distinction first is essential.

## Question 11

**What is `MALLOC_ARENA_MAX` and why does it matter in containers?**

It caps the number of arenas glibc creates. The default is roughly `8 × nproc`, sized to the *host* CPU count — but glibc reads the host, not the cgroup limit. On a 96-core host, a container restricted to 2 CPUs can still spawn dozens of arenas, each retaining its own freed memory, inflating RSS several-fold for no benefit. Setting `MALLOC_ARENA_MAX=2` (matching the CPU quota) is one of the highest-ROI fixes for "my container uses way too much memory." jemalloc's equivalent is `narenas` in `MALLOC_CONF`.

## Question 12

**How do languages let you choose or replace the allocator?**

C++ lets you override global `operator new`/`delete`, but the cleaner tool is `std::pmr` — polymorphic memory resources like `monotonic_buffer_resource` (an arena) or `unsynchronized_pool_resource`, passed to `std::pmr::vector`/`string` for *per-container* allocation strategy. Rust implements the `GlobalAlloc` trait and registers it with `#[global_allocator]` to swap the whole process allocator (e.g. `jemallocator`, `mimalloc`); the unstable `Allocator` trait adds per-collection allocators via `Vec::new_in`. Go bakes a tcmalloc-derived allocator into its runtime (per-P **mcache** → **mcentral** → **mheap**) that you don't replace but should understand. Zig has *no* global allocator: functions take an `Allocator` parameter, making the choice explicit and visible at every call site.

## Tricky / Trap

## Question 13

**A service freed a big batch of memory but RSS in `top` didn't drop. Is that a leak?**

Not necessarily — and usually not. Allocators don't return freed pages to the OS immediately. They use **decay**: pages freed by the program are kept (dirty/muzzy) and purged only after an idle interval, to avoid thrashing if you reallocate. And with `MADV_FREE` (the lazy reclaim hint), the kernel leaves pages mapped and only reclaims them *under memory pressure*, so RSS can stay high until something else needs the RAM — even though the memory is effectively available. Before declaring a leak, check the allocator's own `resident`/`retained` stats and whether decay timers (`dirty_decay_ms`) or `MADV_FREE` explain it. The fix, if RSS must drop, is to tune decay or force a purge — not to hunt a nonexistent missing free.

## Question 14

**Can you `free()` a pointer that was allocated by a different allocator (say, an arena, or jemalloc when the program uses glibc `free`)?**

No — that's heap corruption. Each allocator maintains its own metadata and free-list invariants; passing a pointer to a `free` that didn't create it makes it misread headers it never wrote. Arena/bump allocators don't even *have* per-object free, so calling `free` on an arena pointer is doubly wrong. The classic real-world version is a shared library statically linked against one allocator returning a pointer the main program frees with another. The rule: a pointer must be released by the *same allocator* (and the same `malloc`/`free` pairing) that produced it, and you must keep the allocator consistent across shared-library boundaries.

## Question 15

**Your bump allocator is fast, but RSS for a request stays high long after the request finished. Why might that happen?**

Because a bump/arena allocator frees *nothing* until you reset the whole region — so a *single* long-lived object allocated into a request-scoped arena pins the *entire* arena, preventing reset (or keeping it alive if something still references that object). This is the lifetime-mixing trap: short-lived and long-lived objects sharing one arena means the longest lifetime dominates. The fix is to **segregate by lifetime**: long-lived objects go to the general heap (or a longer-lived arena), and only truly request-scoped data goes in the request arena, which then resets cleanly. The same pinning effect appears in size-class allocators when one live object keeps a whole run/page resident.

## Design

## Question 16

**Design a memory allocator for a game engine that allocates per frame and needs predictable, low latency.**

The core idea is to match allocators to lifetime patterns rather than using one general-purpose heap. (1) **Frame arena:** a bump allocator reset at the end of every frame for all transient per-frame data (command buffers, scratch math, culling results) — allocation is a pointer increment, the whole thing resets in O(1), no fragmentation, perfect cache locality, and crucially *no allocation latency spikes* mid-frame. (2) **Object pools** per hot fixed-size type (particles, entities, components) so spawning/despawning is an O(1) free-list op with zero churn and zero fragmentation. (3) A **general-purpose allocator** (or a long-lived arena) for persistent assets that outlive frames — segregated from frame memory so they never pin it. (4) Back all of these with a few large `mmap`/`VirtualAlloc` regions reserved at startup to avoid syscalls during gameplay. Key trade-offs: arenas/pools give determinism and speed but require disciplined lifetime separation; you give up the convenience of "free anything anytime" in exchange for never hitting a general-allocator slow path or GC pause during a frame. I'd also pre-touch (commit) the regions to avoid first-access page faults stuttering early frames, and add debug-build guard pages / pool-overflow checks since the production allocators here skip the safety the general heap provides.

## Question 17

**How would you make a multithreaded allocator scale across many cores?**

The binding constraint is lock contention on shared structures, not fit search, so the design pushes the common path off the lock entirely. (1) **Per-thread (or per-CPU) caches:** each thread keeps a small private free list per size class; `malloc`/`free` hit it with zero synchronization, and only refill/flush to shared structure in *batches* to amortize the lock. (2) **Multiple arenas:** partition the heap into N independent, separately locked sub-heaps and map threads to arenas (round-robin or per-CPU), cutting contention ~N-fold. (3) Solve the **remote-free** problem deliberately — when thread A allocates and thread B frees, route the object back toward the owner cheaply; mimalloc does this with per-page sharded free lists where a foreign free is one atomic push drained later by the owner. Get this wrong and you get **blowup**, where memory grows with thread count. (4) Mind **false sharing** — keep per-thread metadata on separate cache lines. The trade-off is more memory in flight (every thread caches some free objects) in exchange for near-linear throughput scaling; you tune cache and arena sizes to bound that extra RSS.
