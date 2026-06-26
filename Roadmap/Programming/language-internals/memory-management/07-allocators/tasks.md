# Allocators — Hands-On Tasks

> **Topic:** [Allocators](README.md)

A progression of hands-on exercises that move from observing the system allocator, to building your own (bump, pool, free-list), to tuning and profiling a production allocator. Build in any systems language (C, C++, Rust, or Zig); the prompts are language-agnostic where possible. Work top to bottom — later tasks assume the muscle memory of earlier ones.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Measure allocation overhead

Write a program that calls `malloc(n)` for `n` in `{1, 8, 16, 17, 32, 100, 1000}` and, using `malloc_usable_size` (glibc) or your allocator's equivalent, prints requested vs. actually-usable bytes. Then allocate one million 1-byte blocks and measure the process RSS before and after.

**Self-check:**
- [ ] I can explain why `malloc(1)` uses far more than 1 byte.
- [ ] I can point to the size-class boundaries from my numbers (where usable size jumps).
- [ ] I can estimate per-object overhead from the million-allocation RSS delta.

<details><summary>Hint</summary>Compare `malloc_usable_size(p)` to your requested `n`. The jumps reveal the allocator's size classes; the gap at each request is internal fragmentation. RSS / 1,000,000 gives bytes per tiny object including header + minimum chunk.</details>

### Task 2 — Time syscalls vs. allocator calls

Benchmark (a) one million `malloc(64)`/`free` pairs, against (b) one million `mmap(64)`/`munmap` pairs. Report the per-operation time of each.

**Self-check:**
- [ ] I measured both and the ratio is large (often 100×+).
- [ ] I can explain *why* `malloc` is so much faster (no mode switch; pops a thread-cache/free-list).
- [ ] I understand what `malloc` does on the rare occasion it *must* call the OS.

<details><summary>Hint</summary>Use a monotonic clock around the loops. The point isn't a precise number — it's the order-of-magnitude gap that justifies the allocator's existence.</details>

### Task 3 — Provoke external fragmentation

Allocate 100,000 small blocks, then free every *other* one. Now try to allocate a block larger than the freed gaps. Observe success/failure and inspect RSS — lots of memory is "free" but unusable contiguously.

**Self-check:**
- [ ] I can describe the heap layout that makes the large allocation hard.
- [ ] I can distinguish this (external fragmentation) from internal fragmentation.
- [ ] I noted whether coalescing in my allocator rescued the situation or not.

---

## Core

### Task 4 — Build a bump (arena) allocator

Implement an arena over a fixed backing buffer: `arena_init`, `arena_alloc(size)` (pointer increment with alignment), and `arena_reset`. Deliberately provide **no** per-object free. Allocate a few hundred mixed-size objects, use them, then reset and reuse the arena.

**Self-check:**
- [ ] `arena_alloc` is a handful of instructions (offset, align, bounds-check, return).
- [ ] Alignment is correct — every returned pointer satisfies the strictest type's alignment.
- [ ] `arena_reset` reclaims everything in O(1) and the region is fully reusable afterward.
- [ ] I handle the exhaustion case (return NULL / error) gracefully.

<details><summary>Hint</summary>`offset = align_up(offset, 16); if (offset + size > cap) return NULL; p = base + offset; offset += size;`. The whole appeal is that there's nothing else. `align_up(n,a) = (n + (a-1)) & ~(a-1)` for power-of-two `a`.</details>

<details><summary>Solution sketch</summary>Keep `base`, `cap`, `off`. Allocate from `base + align_up(off, 16)`, advance `off`. Reset sets `off = 0`. No headers, no free list, no coalescing — that's the point. Back it with one big `malloc`/`mmap`.</details>

### Task 5 — Build a fixed-size pool allocator

Carve a backing buffer into N equal blocks and thread a singly linked free list through the *empty* blocks (store the `next` pointer inside each free block). Implement O(1) `pool_alloc` (pop) and `pool_free` (push). Require `block_size >= sizeof(pointer)`.

**Self-check:**
- [ ] Alloc and free are both O(1) with no search.
- [ ] There is zero per-object metadata overhead.
- [ ] I assert/enforce `block_size >= sizeof(void*)`.
- [ ] Freeing then re-allocating returns a usable block (the free list round-trips).

<details><summary>Hint</summary>A free block's first bytes hold the `next` link; an allocated block's bytes hold user data. The free list lives *inside* the pool — no separate metadata array needed.</details>

<details><summary>Solution sketch</summary>On init, walk the buffer pushing each block onto `free_list`. `pool_alloc`: `n = free_list; free_list = n->next; return n;`. `pool_free`: `n->next = free_list; free_list = n;`. Test by exhausting the pool, freeing all, and re-exhausting.</details>

### Task 6 — Build a free-list allocator with coalescing

Implement a general-purpose allocator over a backing region using chunk headers (size + in-use flag) and **boundary tags** so you can find physical neighbors. Support `my_malloc`/`my_free` with first-fit placement, **splitting** on allocation, and **coalescing** of adjacent free chunks on free.

**Self-check:**
- [ ] `my_free` correctly merges with a free *previous* and/or *next* neighbor.
- [ ] Splitting leaves a valid free remainder chunk (and doesn't split when the remainder is too small).
- [ ] After many mixed alloc/free cycles, the free space coalesces back into large chunks (no permanent shredding).
- [ ] Boundary tags let me find the previous chunk's size in O(1).

<details><summary>Hint</summary>Store the size in both a header and a footer of each chunk. Use the lowest bit of the size word as an in-use flag (sizes are aligned, so that bit is free). To coalesce backward, read the previous chunk's footer just before your header.</details>

<details><summary>Solution sketch</summary>Chunk = `[header: size|flag][payload...][footer: size|flag]`. `my_malloc`: first-fit scan, split if remainder ≥ min-chunk. `my_free`: clear in-use; if next chunk free, merge (extend size, rewrite footer); if previous chunk (via its footer) free, merge backward similarly. Validate with the Task 3 fragmentation test — coalescing should now let the large allocation succeed.</details>

### Task 7 — Compare placement strategies

Take your Task 6 allocator and implement first-fit, best-fit, and next-fit as a switchable policy. Run a realistic mixed workload (varied sizes, random free order) and measure peak RSS / fragmentation and allocation time for each.

**Self-check:**
- [ ] I measured both speed and fragmentation, not just one.
- [ ] My results show the classic trade-offs (best-fit lower fragmentation but slower; next-fit often fragments more).
- [ ] I can explain why a real allocator uses segregated lists instead of any of these linear scans.

---

## Advanced

### Task 8 — Add size classes / segregated free lists

Extend your allocator with multiple free lists, one per size class, rounding requests up to the nearest class. Make alloc/free O(1) list operations instead of an O(n) scan. Measure the speedup vs. Task 6 and quantify the internal fragmentation you introduced.

**Self-check:**
- [ ] Allocation is now a class lookup + list pop, not a scan.
- [ ] I can state my worst-case internal fragmentation as a percentage of a class's spacing.
- [ ] I handle large/oversized requests that don't fit any class (fall back to a general path or `mmap`).

<details><summary>Hint</summary>Choose class spacing that bounds waste (e.g., classes spaced so the largest request mapped to a class wastes ≤ ~12–25%). Index by computing the class from the size with a small table or bit trick.</details>

### Task 9 — Swap and benchmark a production allocator

Take a real allocation-heavy program (or write a multithreaded one). Run it under glibc, then jemalloc, then tcmalloc or mimalloc (via `LD_PRELOAD` or `#[global_allocator]`). Measure throughput *and* steady-state RSS over time for each.

**Self-check:**
- [ ] I changed *only* the allocator between runs (same binary/workload).
- [ ] I reported RSS-over-time, not just ops/sec — and saw they can disagree.
- [ ] I can explain at least one result in terms of arenas / thread caches / decay.

<details><summary>Hint</summary>`LD_PRELOAD=/usr/lib/libjemalloc.so ./prog`. For a fair RSS comparison, run long enough to reach steady state and sample `/proc/<pid>/status` `VmRSS` periodically. A loop that allocates and immediately frees one size lives in the thread cache and reveals nothing — use a representative size/lifetime mix.</details>

### Task 10 — Diagnose: leak vs. fragmentation

Build (or take) a service that exhibits rising RSS. Using allocator stats (`mallctl` `stats.allocated` vs `stats.resident` for jemalloc, or `/proc/<pid>/status` VmRSS vs. your own live-bytes counter), determine whether the cause is a leak or fragmentation, and prove it.

**Self-check:**
- [ ] I compared *bytes the program holds* against *RSS* explicitly.
- [ ] I reached a defensible conclusion (leak → `allocated` climbs; fragmentation → big `allocated`/RSS gap).
- [ ] If fragmentation, I tried a fix (tune `dirty_decay_ms` / cap arenas / segregate lifetimes) and verified RSS moved.

<details><summary>Hint</summary>Refresh jemalloc counters with the `epoch` `mallctl` before reading `stats.*`. A leak shows `allocated` itself growing forever; fragmentation shows `allocated` stable but `resident` much higher.</details>

### Task 11 — Profile with jeprof / pprof

Run a program under jemalloc with `MALLOC_CONF="prof:true,prof_active:true,lg_prof_sample:19"`, dump a heap profile, and render it with `jeprof --text` and `--pdf`. Identify the top allocation sites by live bytes.

**Self-check:**
- [ ] I produced a heap profile and can read the call-graph / top-N sites.
- [ ] I can distinguish a growing-live-bytes site (leak suspect) from a high-churn-but-stable site.
- [ ] I understand what `lg_prof_sample` controls and why coarse sampling is fine in production.

---

## Capstone

### Task 12 — A complete allocator subsystem for a request-scoped server

Build a small server (or simulation) that handles many "requests," each of which allocates a burst of short-lived objects plus occasionally creates a long-lived cached object. Design and implement a layered allocation strategy:

1. A **per-request arena** (Task 4) for all transient request data, reset at request end.
2. An **object pool** (Task 5) for one hot fixed-size type with high churn.
3. The **general allocator** (system or your Task 6/8) for long-lived cached objects, deliberately *segregated* from request memory so they never pin it.
4. All backed by a few large OS regions reserved up front.

Then load-test it: measure throughput, p99 allocation latency, and RSS over time. Demonstrate the lifetime-segregation win by *intentionally breaking it* (put a long-lived object in the request arena) and showing RSS climb.

**Self-check:**
- [ ] Per-request allocation never touches the general allocator's slow path (verify with stats/counters).
- [ ] Resetting the arena is O(1) and fully reclaims request memory.
- [ ] The pool eliminates churn for its type (free-list pop/push only).
- [ ] I reproduced the **lifetime-mixing pitfall**: a long-lived object in the request arena pins it and RSS grows; segregating fixes it.
- [ ] I reported throughput, p99 latency, *and* steady-state RSS — and can explain each in terms of the allocator design.
- [ ] I considered the safety I gave up vs. the general allocator (no per-object free, no hardening) and added debug-build guards (guard pages / pool-overflow checks).

<details><summary>Hint</summary>Wire allocator stats into your metrics so "did request work avoid the general heap?" is observable, not assumed. The capstone's real lesson is in the *broken* run: mixing lifetimes in one arena is one of the most common production fragmentation causes, and seeing your own RSS climb makes it stick.</details>

---

## Self-Assessment

You have mastered this topic when you can:

- [ ] Explain, end to end, how `malloc(24)` is satisfied without a syscall, and what happens on the rare path that *does* hit the OS.
- [ ] Implement from scratch a bump allocator, a pool allocator, and a free-list allocator with splitting and boundary-tag coalescing.
- [ ] Articulate the trade-offs of first/best/next-fit and why segregated free lists supersede them.
- [ ] Describe the modern allocator template (per-thread caches → sharded arenas → OS) and how jemalloc, tcmalloc, and mimalloc differ within it.
- [ ] Diagnose rising RSS as leak vs. fragmentation using allocator stats, and apply the correct (opposite) fix for each.
- [ ] Tune real allocators via `MALLOC_CONF` / `MALLOC_ARENA_MAX` / decay timers and verify the RSS/latency curve actually moved.
- [ ] Read a `jeprof`/pprof heap profile to find leaks and churn hot spots.
- [ ] Choose and deploy the right allocator strategy per lifetime pattern in a real system, and reason about the safety and hardening you trade away.
