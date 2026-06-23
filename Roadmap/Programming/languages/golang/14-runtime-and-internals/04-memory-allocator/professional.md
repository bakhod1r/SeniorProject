# Memory Allocator — Professional

> Focus: the actual code. The Go allocator is TCMalloc reimagined for a managed runtime with stack-growing goroutines, write barriers, and a tri-color GC sharing every byte. The hard parts are not "small / large / huge" buckets. They are: how does `mallocgc` decide between three fundamentally different code paths in two dozen instructions, why is the size-class table neither power-of-two nor uniform, what does the radix tree do that the old treap could not, and why does the scavenger care more about huge pages than about returning memory. This document walks the source — `runtime/malloc.go`, `mcache.go`, `mcentral.go`, `mheap.go`, `mpagealloc.go`, `sizeclasses.go`, `mbitmap.go`, `mgcscavenge.go` — at go1.22+. Snippets are abbreviated and lightly reformatted for readability; line numbers drift between minor releases. Read the file, not the excerpt.

---

## 1. `mallocgc` — the canonical entry

Every heap allocation in Go funnels through `mallocgc` in `runtime/malloc.go`. The compiler lowers `new(T)`, `make([]T, n)`, escaped composite literals, and closure captures to `runtime.newobject` / `runtime.makeslice`, which call `mallocgc`. The function is ~400 lines; the structural skeleton is small.

```go
// from runtime/malloc.go, simplified
func mallocgc(size uintptr, typ *_type, needzero bool) unsafe.Pointer {
    if size == 0 {
        return unsafe.Pointer(&zerobase)
    }
    // gcAssistAlloc may run before the allocation if we're behind on GC work
    assistG := deductAssistCredit(size)

    mp := acquirem()
    mp.mallocing = 1                       // forbid preemption mid-allocation
    c := getMCache(mp)                     // current P's mcache
    noscan := typ == nil || !typ.PtrBytes  // scalar-only types skip pointer scan

    var x unsafe.Pointer
    var elemsize uintptr

    if size <= maxSmallSize-mallocHeaderSize {  // 32 KB cutoff
        if noscan && size < maxTinySize {       // 16-byte cutoff
            // ---------- TINY PATH ----------
            off := c.tinyoffset
            // align up: 8 if size>=8, 4 if size>=4, 2 if size>=2
            if size&7 == 0 { off = alignUp(off, 8) } else
            if size&3 == 0 { off = alignUp(off, 4) } else
            if size&1 == 0 { off = alignUp(off, 2) }
            if off+size <= maxTinySize && c.tiny != 0 {
                x = unsafe.Pointer(c.tiny + off)
                c.tinyoffset = off + size
                c.tinyAllocs++
                mp.mallocing = 0; releasem(mp)
                return x
            }
            // tiny block exhausted: get a fresh 16-byte block from class 2
            span := c.alloc[tinySpanClass]
            v := nextFreeFast(span)
            if v == 0 { v, span, _ = c.nextFree(tinySpanClass) }
            x = unsafe.Pointer(v)
            (*[2]uint64)(x)[0] = 0; (*[2]uint64)(x)[1] = 0  // zero
            c.tiny = uintptr(x); c.tinyoffset = size
            elemsize = maxTinySize

        } else {
            // ---------- SMALL PATH ----------
            var sizeclass uint8
            if size <= smallSizeMax-8 {
                sizeclass = size_to_class8[divRoundUp(size, smallSizeDiv)]
            } else {
                sizeclass = size_to_class128[divRoundUp(size-smallSizeMax, largeSizeDiv)]
            }
            spc := makeSpanClass(sizeclass, noscan)
            span := c.alloc[spc]
            v := nextFreeFast(span)
            if v == 0 { v, span, _ = c.nextFree(spc) }
            x = unsafe.Pointer(v)
            elemsize = uintptr(class_to_size[sizeclass])
            if needzero && span.needzero != 0 { memclrNoHeapPointers(x, elemsize) }
        }
    } else {
        // ---------- LARGE PATH ----------
        span := c.allocLarge(size, noscan)   // direct to mheap; no per-P cache
        span.freeindex = 1
        span.allocCount = 1
        span.largeType = typ
        x = unsafe.Pointer(span.base())
        elemsize = span.elemsize
    }

    if !noscan { heapSetType(uintptr(x), elemsize, typ, span) }

    // GC accounting + sampling
    c.scanAlloc += scanAlloc
    c.nextSample -= int64(size)
    if c.nextSample < 0 { profilealloc(mp, x, size) }
    mp.mallocing = 0; releasem(mp)

    if assistG != nil { assistG.gcAssistBytes -= int64(size) }
    if rate := MemProfileRate; rate > 0 && size < uintptr(rate) && size < c.nextSample {
        // sampled
    }
    return x
}
```

Five things to internalise here:

1. **Three paths, not one.** Tiny (`size < 16` and `noscan`), small (`size ≤ 32 KB`), large (`size > 32 KB`). The cutoffs are tuned constants in `runtime/sizeclasses.go`, not configurable.
2. **Preemption is forbidden during the allocation** — `mp.mallocing = 1`. The allocator manipulates per-P state (`mcache`) and must finish before the goroutine migrates to another P.
3. **`noscan` is a first-class property.** Pointer-free objects use separate spans (no GC scanning), enabling the tiny path and halving heap-bitmap work for scalar-heavy code.
4. **GC assist runs before alloc, not after.** `deductAssistCredit` may pause the mutator to do mark work proportional to the allocation, so a high-rate allocator helps pay GC's bill.
5. **Sampling happens on the slow path.** `c.nextSample` is decremented every allocation; when it crosses zero, `profilealloc` records a stack for the heap profile. Cost is amortized.

---

## 2. The tiny allocator

Go programs allocate enormous numbers of small noscan objects: string headers, interface tables backing small ints, ephemeral byte slices from `[]byte(s)`, `int64` boxed for `any`. Most are 8–16 bytes. Giving each its own 16-byte span slot wastes half the bitmap and doubles GC scan cost. The tiny allocator packs multiple noscan objects into a single 16-byte slot.

```go
// from runtime/mcache.go, conceptually
type mcache struct {
    // ...
    tiny       uintptr  // base of current tiny block, or 0
    tinyoffset uintptr  // bytes used in current tiny block
    tinyAllocs uintptr  // total tiny allocations (for profiling)
    alloc      [numSpanClasses]*mspan
    // ...
}
```

Packing rules — all enforced by `mallocgc`:

- **noscan only.** A pointer-bearing object cannot share a 16-byte slot with another because the heap bitmap is one bit per word; mixed scan/noscan would corrupt mark state.
- **Size < 16 bytes.**
- **Alignment to natural boundary.** Sizes ≥ 8 round to 8-byte alignment, ≥ 4 to 4-byte, ≥ 2 to 2-byte. A `byte` (1) takes 1 byte; a `[3]byte` takes 3 bytes; a `[5]byte` takes 5 bytes starting at the next 4-byte boundary.

Diagram of a tiny block mid-life:

```
tiny block (16 B from a class-2 span slot)
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|s1|s1|s1|s1|s2|s2|s2|s2|s2|s2|s2|s2|.. .. .. ..|
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
 ^---4B---^     ^------8B------^   ^-- 4B free --^
 string hdr     int64 boxed         tinyoffset = 12
 (escaped)      (any)
```

When a new request would overflow the block, the existing block is "dropped" — left in the span; the slot is not reclaimed until GC frees the parent slot. The next allocation gets a fresh 16-byte slot from `c.alloc[tinySpanClass]`. The dropped tail wastes memory but avoids per-tiny-allocation bookkeeping.

This optimisation matters more than it looks. On real Go services, **the tiny allocator absorbs 20–40% of heap allocation calls.** Disabling it (a debug exercise) tanks throughput by 5–15% on JSON-heavy and interface-heavy workloads.

---

## 3. Small-object path: `nextFreeFast` → `nextFree` → `refill`

For 16 B ≤ size ≤ 32 KB, the allocator picks a *size class* (§8), reads the corresponding `*mspan` from `mcache.alloc[spc]`, and asks the span for a free slot. Three tiers of fallback:

```go
// from runtime/malloc.go, simplified
func nextFreeFast(s *mspan) gclinkptr {
    theBit := sys.TrailingZeros64(s.allocCache)   // first free slot in cache
    if theBit < 64 {
        result := s.freeindex + uint16(theBit)
        if result < s.nelems {
            freeidx := result + 1
            if freeidx%64 != 0 || freeidx == s.nelems {
                s.allocCache >>= uint(theBit + 1)
                s.freeindex = freeidx
                s.allocCount++
                return gclinkptr(uintptr(result)*s.elemsize + s.base())
            }
        }
    }
    return 0  // fall through to nextFree
}
```

`allocCache` is a **64-bit lookahead bitmap** mirroring the next 64 slots of `allocBits` starting from `freeindex`. Bit set = free. `TrailingZeros64` finds the next free slot in ~1 ns. When the cache empties or `freeindex` crosses a 64-slot boundary, the slow path runs:

```go
// from runtime/mcache.go, simplified
func (c *mcache) nextFree(spc spanClass) (v gclinkptr, s *mspan, shouldhelpgc bool) {
    s = c.alloc[spc]
    freeIndex := s.nextFreeIndex()
    if freeIndex == s.nelems {
        // span is full; refill from mcentral
        c.refill(spc)
        shouldhelpgc = true
        s = c.alloc[spc]
        freeIndex = s.nextFreeIndex()
    }
    v = gclinkptr(uintptr(freeIndex)*s.elemsize + s.base())
    s.allocCount++
    return
}
```

`nextFreeIndex` scans `allocBits` 64 bits at a time and refreshes `allocCache`. When the entire span is full (`freeIndex == s.nelems`), `c.refill(spc)` swaps in a fresh span:

```go
// from runtime/mcache.go, simplified
func (c *mcache) refill(spc spanClass) {
    s := c.alloc[spc]
    if s != &emptymspan {
        // return the now-full span to mcentral
        atomic.Store(&s.sweepgen, mheap_.sweepgen)
        mheap_.central[spc].mcentral.uncacheSpan(s)
    }
    s = mheap_.central[spc].mcentral.cacheSpan()
    if s == nil { throw("out of memory") }
    c.alloc[spc] = s
}
```

The full span goes back to `mcentral`; a span with free slots takes its place. The mutator does no locking on the fast path: the `mcache` is per-P and only one goroutine runs on a P at a time. Locking happens only at refill, which the prefetched 64-slot cache makes rare.

---

## 4. `mcentral.cacheSpan` — partial, full, swept

One `mcentral` exists per `(size class, scan/noscan)` pair — ~140 instances. Each owns a span population for that class, partitioned by sweep state:

```go
// from runtime/mcentral.go, simplified
type mcentral struct {
    spanclass spanClass
    partial   [2]spanSet  // spans with free objects (one per sweepgen parity)
    full      [2]spanSet  // spans with no free objects
}
```

The double-buffered `[2]spanSet` is the sweep generation toggle: spans in `partial[1-sg]` were swept in the previous cycle; spans in `partial[sg]` are freshly swept. When the GC cycle flips, the roles reverse.

```go
// from runtime/mcentral.go, simplified
func (c *mcentral) cacheSpan() *mspan {
    sg := mheap_.sweepgen

    // 1. Try partial, freshly-swept spans (no sweep needed).
    if s := c.partialSwept(sg).pop(); s != nil {
        return s
    }
    // 2. Try partial, unswept spans. Sweep, then use.
    for {
        s := c.partialUnswept(sg).pop()
        if s == nil { break }
        if atomic.Load(&s.sweepgen) == sg-2 &&
            atomic.Cas(&s.sweepgen, sg-2, sg-1) {
            s.sweep(true)         // reclaim dead objects
            return s
        }
    }
    // 3. Try full, unswept spans. Sweep may free objects.
    for {
        s := c.fullUnswept(sg).pop()
        if s == nil { break }
        if atomic.Cas(&s.sweepgen, sg-2, sg-1) {
            s.sweep(true)
            if uint16(s.allocCount) != s.nelems {
                return s          // sweep found free slots
            }
            c.fullSwept(sg).push(s)
        }
    }
    // 4. Nothing reusable; ask mheap for a fresh span.
    s := c.grow()
    return s
}

func (c *mcentral) grow() *mspan {
    npages := uintptr(class_to_allocnpages[c.spanclass.sizeclass()])
    size := uintptr(class_to_size[c.spanclass.sizeclass()])
    s := mheap_.alloc(npages, c.spanclass)
    s.limit = s.base() + size*uintptr(s.nelems)
    return s
}
```

Three subtleties:

1. **No global lock on the central.** `spanSet` is a lock-free MPSC queue (see `runtime/mspanset.go`). Multiple Ps refilling the same class don't serialise.
2. **Lazy sweeping is the central's job.** When the GC cycle ends, spans aren't immediately walked for dead objects; they sit unswept. The next `cacheSpan` that finds them does the sweep on the spot. This amortises sweep cost across mutator allocations — "pay as you go." The background sweeper (`bgsweep`) handles spans that never get re-cached.
3. **A full-unswept span may yield free slots.** A span marked "full" at the start of the cycle had every slot allocated. By the time we examine it, GC may have marked many of those dead. The sweep reveals the freed slots; the span moves back to partial.

If steps 1-3 fail, `c.grow()` calls into `mheap_.alloc`, allocating a fresh contiguous span from the page allocator (§5).

---

## 5. `mheap.alloc` → page allocator (`pageAlloc`)

`mheap` owns the heap: a global pool of pages (8 KB each on most architectures). Spans are runs of contiguous pages backed by a `mspan` metadata object.

```go
// from runtime/mheap.go, simplified
func (h *mheap) alloc(npages uintptr, spanclass spanClass) *mspan {
    var s *mspan
    systemstack(func() {
        if h.sweepdone == 0 {
            h.reclaim(npages)        // ensure we've swept at least npages of garbage
        }
        s = h.allocSpan(npages, spanAllocHeap, spanclass)
    })
    return s
}

func (h *mheap) allocSpan(npages uintptr, typ spanAllocType, spc spanClass) *mspan {
    // 1. Fast path: per-P page cache (small allocations).
    pp := getg().m.p.ptr()
    if !typ.manual() && pp != nil && npages < pageCachePages/4 {
        c := &pp.pcache
        base, scav := c.alloc(npages)
        if base != 0 { /* got it from the per-P cache */ }
    }

    // 2. Slow path: lock the heap, allocate from radix tree.
    lock(&h.lock)
    if base == 0 {
        base, scav = h.pages.alloc(npages)
        if base == 0 {
            // 3. Slowest: grow the heap from the OS.
            if !h.grow(npages) { throw("out of memory") }
            base, scav = h.pages.alloc(npages)
        }
    }
    unlock(&h.lock)

    s := h.tryAllocMSpan()
    h.initSpan(s, typ, spc, base, npages)
    return s
}
```

Three layers of caching, each lock-free until necessary:

1. **`p.pcache`** — a per-P 64-bit "page cache" bitmap covering ~512 KB of heap. Allocations < 16 pages can grab from here with no global lock.
2. **`h.pages` (`pageAlloc`)** — the radix tree (§5.1). Locked, but the lock is fine-grained and the tree itself allows lock-free reads of summary nodes.
3. **`h.grow(npages)` → `sysAlloc`** — ask the OS via `mmap` for a new arena.

### 5.1 The radix tree (`pageAlloc`)

Before go1.14, `mheap` used a treap of free regions. The treap was simple but slow: every alloc/free was an O(log N) tree operation under the heap lock, and N grew with heap size. Austin Clements's [page-allocator redesign](https://github.com/golang/proposal/blob/master/design/35112-scaling-the-page-allocator.md) replaced it with a **radix tree of bitmap summaries**, giving constant-time allocations for typical sizes and far better contention behaviour.

```
heap addr space (48-bit on x86_64)
+-------------------------------------------------+
|                                                 |
|   /-------- pageAlloc tree (5 levels) --------\ |
|   level 0:   one summary per 16 TB             |
|   level 1:   one summary per 64 GB             |
|   level 2:   one summary per 256 MB            |
|   level 3:   one summary per 1 MB              |
|   level 4:   one summary per 4 KB chunk        |
|       \-- 8 pages per chunk = 1 pallocBits     |
|                                                 |
|   chunks[]:   bitmaps of allocated pages       |
|   summary[L]: roll-up of children's pallocSum  |
|                                                 |
+-------------------------------------------------+
```

Each level summarises the level below into a `pallocSum`: a 64-bit value with three fields packed in — `start`, `max`, `end` — the longest free run at the start of the region, the longest run anywhere in the region, the longest run at the end. To find a free run of N pages, walk down from the root, choosing children whose `max ≥ N` (or whose `end + sibling.start ≥ N` for runs spanning the boundary). Allocation is O(levels) = constant (5 levels).

```go
// from runtime/mpagealloc.go, conceptually
type pageAlloc struct {
    summary [summaryLevels][]pallocSum  // [0]: 1 entry; [4]: many
    chunks  [1 << pallocChunksL1Bits]*[1 << pallocChunksL2Bits]pallocData
    searchAddr offAddr                  // hint: start search here next time
    scav struct { /* scavenger state */ }
    inUse addrRanges                    // committed regions of address space
}

type pallocSum uint64  // start:21 | max:21 | end:21 | flag:1

type pallocData struct {
    pallocBits                  // bitmap: 1 bit per page, 1=alloced
    scavenged pageBits          // bitmap: 1 bit per page, 1=returned-to-OS
}

func (p *pageAlloc) alloc(npages uintptr) (addr uintptr, scav uintptr) {
    // 1. Start at searchAddr; find the first chunk whose summary fits npages.
    addr, searchAddr := p.find(npages)
    if addr == 0 {
        if !p.grow(npages) { return 0, 0 }
        addr, searchAddr = p.find(npages)
    }
    // 2. Mark the pages allocated in the chunk's pallocBits.
    scav = p.allocRange(addr, npages)
    // 3. Update summaries up the tree.
    p.update(addr, npages, true, true)
    p.searchAddr = searchAddr
    return
}
```

`searchAddr` is a hint, not a guarantee — the allocator skips forward past known-full chunks rather than rescanning from the start every time.

Two operational consequences:

- **Bursts of allocation are cheap.** A workload allocating 1 GB of small objects updates ~100 summaries instead of doing 100 000 treap operations.
- **Fragmentation is visible.** `pallocSum.max` shows the longest free run. A heap with many `max = 1` chunks (one-page holes scattered everywhere) won't satisfy a 100-page request even with 50% free; this triggers an arena grow.

---

## 6. Arenas and `sysAlloc`

The heap is laid out as a sequence of **arenas**. On 64-bit Linux/amd64, each arena is **64 MB** (`heapArenaBytes`). Arena boundaries are aligned for fast metadata lookup: given a pointer, `arenaIdx(p) = (p - arenaBaseOffset) / heapArenaBytes` yields an index into `mheap_.arenas`.

```go
// from runtime/mheap.go, simplified
type mheap struct {
    arenas      [1 << arenaL1Bits]*[1 << arenaL2Bits]*heapArena
    arenaHints  *arenaHint   // linked list of preferred grow addresses
    // ...
}

type heapArena struct {
    spans       [pagesPerArena]*mspan       // page index -> owning span
    pageInUse   [pagesPerArena / 8]uint8    // bitmap
    pageMarks   [pagesPerArena / 8]uint8    // bitmap
    pageSpecials [pagesPerArena / 8]uint8
    bitmap      [heapArenaBitmapWords]uintptr  // heap pointer bitmap (§7)
    zeroedBase  uintptr
}

type arenaHint struct {
    addr uintptr
    down bool          // grow downward (rare; ARM64)
    next *arenaHint
}
```

`arenaHints` is a linked list of preferred grow addresses. On startup, the runtime seeds it with a handful of high addresses (away from typical mmap traffic from C libraries and from typical stack regions). When the heap needs to grow, `sysAlloc` tries the first hint:

```go
// from runtime/malloc.go, simplified
func (h *mheap) sysAlloc(n uintptr) (v unsafe.Pointer, size uintptr) {
    n = alignUp(n, heapArenaBytes)
    for h.arenaHints != nil {
        hint := h.arenaHints
        p := hint.addr
        v = sysReserve(unsafe.Pointer(p), n)  // mmap PROT_NONE
        if v != nil && uintptr(v) == p {
            hint.addr += n                     // success; advance hint
            break
        }
        h.arenaHints = hint.next               // hint failed; try next
    }
    if v == nil {
        // Hint exhausted; let the OS pick. Address must still satisfy alignment.
        v, size = sysReserveAligned(nil, n, heapArenaBytes)
    }
    sysMap(v, size, &gcController.heapReleased)  // PROT_READ|PROT_WRITE, MAP_FIXED
    sysUsed(v, size, size)
    return
}
```

Three OS-level details that production engineers will eventually care about:

- **`sysReserve` is `mmap` with `PROT_NONE`** — reserves address space without backing pages. This is why a Go process's RSS is often much smaller than its `VIRT` size.
- **`sysMap` upgrades to `PROT_READ|PROT_WRITE`** — at this point the OS commits pages on first touch (typical Linux behaviour). Containers with overcommit disabled (`vm.overcommit_memory=2`) can fail this step even though the reserve succeeded.
- **`MADV_HUGEPAGE`** is requested on `sysHugePage` for arenas. The scavenger (§10) interacts with transparent huge pages in subtle ways — releasing a single 4 KB page from a 2 MB THP region forces the OS to split, costing more than it saves.

---

## 7. `mbitmap.go` — the heap bitmap

Garbage collection needs to know which words in the heap are pointers. The historical encoding was **2 bits per word**: one "pointer/scalar" bit and one "scanned/morestack" bit. Since go1.22, the encoding for *small* objects has been simplified to **1 bit per word** in the heap arena's `bitmap` field, and *large* objects (> 32 KB) carry their type descriptor inline via `mspan.largeType` (`malloc.go` `mallocHeaderSize`).

```go
// from runtime/mbitmap.go, simplified
type heapBits struct {
    addr  uintptr
    bits  uintptr   // current word of bitmap data
    valid uintptr   // # of valid bits in bits
    mask  uintptr
}

// heapBitsForAddr returns a heapBits cursor over the bitmap for [addr, addr+size).
func heapBitsForAddr(addr, size uintptr) heapBits {
    ai := arenaIndex(addr)
    ha := mheap_.arenas[ai.l1()][ai.l2()]
    // bitOffset: which word in arena (each bitmap entry covers 64 words / 512 B)
    wordsToBit := (addr - ha.zeroedBase) / goarch.PtrSize
    bitsIdx := wordsToBit / ptrBits
    return heapBits{
        addr:  addr,
        bits:  ha.bitmap[bitsIdx] >> (wordsToBit % ptrBits),
        valid: ptrBits - wordsToBit%ptrBits,
    }
}

// nextFast returns the address of the next pointer word, or 0 if none in this word.
func (h *heapBits) nextFast() (uintptr, heapBits) {
    if h.bits == 0 { return 0, h }
    i := sys.TrailingZeros64(uint64(h.bits))
    addr := h.addr + uintptr(i)*goarch.PtrSize
    h.bits >>= uint(i + 1)
    h.addr = addr + goarch.PtrSize
    h.valid -= uintptr(i + 1)
    return addr, *h
}
```

The bitmap is 1/64 the size of the heap on 64-bit platforms (1 bit per 8-byte word). For a 4 GB heap, the bitmap is 64 MB — small enough to fit in L3 on modern CPUs, which is why mark-phase pointer enumeration is so fast.

GC's mark loop walks the bitmap rather than the object: for each set bit, dereference the pointer at that address, mark the target, push to the work queue. No reflection, no type information, no per-object metadata access on the hot path.

Diagram of one arena's bitmap coverage:

```
heapArena (64 MB = 8192 pages = 8 388 608 words)
    |
    +-- bitmap: 1 048 576 bytes = 1 048 576 * 8 = 8 388 608 bits
    |   one bit per word; 1 = pointer, 0 = scalar
    |
    +-- spans[8192]: one *mspan per page (for address -> span lookup)
    +-- pageInUse[1024]: 1 bit per page; 1 = in a span
    +-- pageMarks[1024]: 1 bit per page; 1 = touched this GC cycle
```

For tiny-block packing, the bitmap is conservative: a 16-byte block hosting two 8-byte noscan objects has both bits clear. A 16-byte block hosting a pointer at offset 8 has bit 1 set. This is why mixed scan/noscan packing is forbidden — the bitmap has no notion of "first object ends here."

---

## 8. `sizeclasses.go` — the size-class table

`runtime/sizeclasses.go` is auto-generated by `runtime/mksizeclasses.go` and contains the canonical table. There are **68 size classes** (class 0 reserved for the large path); each class defines the slot size, the number of pages per span, and the resulting object count.

```go
// from runtime/sizeclasses.go (generated)
// class  bytes/obj  bytes/span  objects  tail waste  max waste
//     1          8        8192     1024           0     87.50%
//     2         16        8192      512           0     43.75%
//     3         24        8192      341           8     29.24%
//     4         32        8192      256           0     21.88%
//     5         48        8192      170          32     31.52%
//     ...
//    16        288        8192       28         128     21.74%
//    ...
//    32       1792       16384        9         256     16.67%
//    ...
//    65      28672       57344        2           0      4.66%
//    66      32768       32768        1           0     12.50%
//    67      32768       32768        1           0     12.50%

var class_to_size = [_NumSizeClasses]uint16{
    0, 8, 16, 24, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208, 224, 240, 256, 288, 320, ...
}
var class_to_allocnpages = [_NumSizeClasses]uint8{
    0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, ...
}
// size_to_class8 maps (size+7)/8 to a class (for sizes ≤ 1024)
// size_to_class128 maps ((size-1024)+127)/128 to a class (for 1024 < size ≤ 32768)
```

Five rows worth knowing:

| Class | Bytes/obj | Bytes/span | Objects | Why this size |
|---|---|---|---|---|
| 1 | 8 | 8192 | 1024 | Smallest noscan (most ints) |
| 2 | 16 | 8192 | 512 | Tiny-allocator target; string header |
| 5 | 48 | 8192 | 170 | `string` + small `[]byte` headers |
| 16 | 288 | 8192 | 28 | Sweet spot for `bytes.Buffer` initial alloc |
| 31 | 1408 | 16384 | 11 | Typical small JSON payload |
| 66 | 32768 | 32768 | 1 | One slot per span; boundary with large path |

**Why not power-of-two?** Power-of-two classes (8, 16, 32, 64, 128, ...) are simpler to compute and what TCMalloc started with. They have terrible internal fragmentation in the small-to-medium range: a 33-byte object rounds up to 64 (48% waste); a 65-byte object rounds up to 128 (49% waste). Go's table is hand-tuned to **bound max-waste at ~12.5%** on most classes and ~25% on a few outliers. The generator script (`mksizeclasses.go`) optimises the table by:

1. Enumerating candidate class sizes.
2. For each, computing the integer object count that fits in `k` pages (for k = 1, 2, 4, 8).
3. Choosing the page count that minimises *tail waste* (bytes left over after `n` objects).
4. Bounding *max waste* by inserting intermediate classes where the gap is too large.

Result: a non-uniform table where small classes step by 8 (8, 16, 24, 32), medium classes step by 16 and 32 (240, 256, 288), and large classes have non-trivial spans (class 31 uses 2 pages, class 65 uses 7 pages).

```
size_to_class lookup (size = 100 bytes):
    size > 8 and ≤ 1024 → use size_to_class8
    index = (100 + 7) / 8 = 13
    size_to_class8[13] = 9    (class 9 = 112 bytes/obj)
    
    a 100-byte object lives in a class-9 span:
    +-----------+-----------+-----------+ ... +-----------+
    | obj 0     | obj 1     | obj 2     | ... | obj 72    |
    | 112 B     | 112 B     | 112 B     |     | 112 B     |
    +-----------+-----------+-----------+ ... +-----------+
    span: 8192 B = 1 page; objects: 73 (last 8 B = tail waste)
```

---

## 9. `mspan` layout

`mspan` is the per-span metadata, allocated separately from the span's pages (in a dedicated fixed-size allocator inside `mheap`).

```go
// from runtime/mheap.go, simplified
type mspan struct {
    next *mspan
    prev *mspan

    startAddr  uintptr      // base address of the span's pages
    npages     uintptr      // length in pages
    
    manualFreeList gclinkptr // for manually-managed spans (stacks)
    
    freeindex  uint16       // next slot to consider for allocation
    nelems     uint16       // total slots in this span
    
    allocCache uint64       // 64-bit lookahead bitmap (§3)
    allocBits  *gcBits      // bitmap: 1 = allocated
    gcmarkBits *gcBits      // bitmap: 1 = marked during this GC cycle
    
    sweepgen   uint32       // sweep generation (compared with mheap.sweepgen)
    
    spanclass  spanClass    // class + noscan bit
    state      mSpanStateBox
    needzero   uint8
    
    elemsize   uintptr      // bytes per object (= class_to_size[spanclass])
    limit      uintptr      // startAddr + elemsize*nelems
    
    allocCount uint16
    
    largeType  *_type       // for large objects only (§7)
}
```

Diagram of a small-object span (class 9, 1 page):

```
mspan metadata (heap, fixed-size alloc)
+-----------------------+
| startAddr   = 0x1000  |
| npages      = 1       |
| nelems      = 73      |
| freeindex   = 18      |  <- next slot to try
| allocCache  = 0xFFF.. |  <- 64-bit lookahead from slot 18
| allocBits   --------> | --+
| gcmarkBits  --------> | --|--+
| elemsize    = 112     |   |  |
+-----------------------+   |  |
                            v  v
span pages (8 KB, slots 0..72)         allocBits     gcmarkBits
0x1000  +--------+ <- slot 0           +----------+   +----------+
        | obj 0  |                     | 1 (used) |   | 1 (mark) |
0x1070  +--------+ <- slot 1           | 1        |   | 0 (dead) |
        | obj 1  |                     | ...      |   | ...      |
        ...                            +----------+   +----------+
0x1d90  +--------+ <- slot 72
        | obj 72 |
        +--------+
0x1e00  | tail   |  8 B unused
        +--------+
```

**Why two bitmaps?** Allocation flips bits in `allocBits`; GC flips bits in `gcmarkBits`. At sweep time, the difference is the set of dead objects. Then `allocBits := gcmarkBits` (atomically swap pointers), `gcmarkBits` is reset to zero for the next cycle, and the dead slots are reclaimed.

`freeindex` is a **hint**: the allocator never considers slots `< freeindex` (they're known-allocated). After sweep, `freeindex` is reset to 0 to expose newly-freed slots.

---

## 10. Returning memory to the OS — the scavenger

Free memory in the page allocator is not free to the OS — it's reserved virtual address space backed by committed physical pages. The **scavenger** (`runtime/mgcscavenge.go`) tells the kernel to reclaim physical pages without disturbing the address space.

```go
// from runtime/mgcscavenge.go, conceptually
func sysUnused(v unsafe.Pointer, n uintptr) {
    // Linux: MADV_DONTNEED — pages may be reclaimed; access re-faults to zero.
    //       (MADV_FREE is faster but obscures RSS metrics; Go uses DONTNEED by default.)
    // Darwin: MADV_FREE_REUSABLE
    // Windows: VirtualFree(MEM_DECOMMIT)
    // BSD: MADV_FREE
    madvise(v, n, _MADV_DONTNEED)
}
```

Two scavenger modes:

### 10.1 Background scavenger (since go1.13)

A dedicated goroutine (`scavenger.g`) runs at low priority. Each iteration:

```go
// from runtime/mgcscavenge.go, conceptually
func bgscavenge(c chan int) {
    scavenger.init()
    for {
        released := scavenger.run()         // scavenge up to a budget of pages
        if released == 0 {
            scavenger.park()                // sleep until heap grows again
            continue
        }
        scavenger.sleep(scaledSleepTime)    // pace ourselves to the target rate
    }
}
```

The scavenger walks `pageAlloc`'s `pallocSum` summaries to find chunks containing free, un-scavenged pages, then calls `sysUnused` on those pages. The rate is governed by a **memory pacer** (`gcController.memoryLimit`, settable via `GOMEMLIMIT` since go1.19) and a target return time: the scavenger aims to return memory faster when the heap shrinks, slower when it's stable.

### 10.2 Synchronous scavenge on memory pressure

When `gcController.heapGoal` is being approached and there's known free memory above the goal, the GC may call `scavenger.run` synchronously to release pages before triggering a heap grow. This avoids the "I have 500 MB free but I need to ask the OS for another 64 MB arena" pathology.

### 10.3 The cost model

`madvise(MADV_DONTNEED)` is not free:

- **Per-page TLB shootdown.** Every page returned forces an IPI to peer cores to invalidate their TLBs. On a 64-core machine, this can dominate.
- **Refault cost.** When the memory is reused, every page faults back in, zeroed by the kernel. Allocation latency spikes for the first few cycles after a heavy scavenge.
- **Huge page interaction.** If the heap is backed by 2 MB transparent huge pages, releasing a single 4 KB page forces the kernel to *split* the huge page into 4 KB pages, wasting the THP optimisation. Go marks heap regions `MADV_NOHUGEPAGE` after scavenging to avoid this oscillation.

The Go team has tuned the scavenger heavily over five releases. The current default behaviour is conservative — return memory slowly to avoid TLB storms — and `GOMEMLIMIT` is the right knob for "I have N bytes total; stay under that or die trying."

---

## 11. Allocation accounting and write barriers

`gcController` (`runtime/mgcpacer.go`) tracks heap growth to decide when to start the next GC cycle. The accounting is split across hot and cold paths to keep `mallocgc` fast:

```go
// from runtime/malloc.go, simplified — the relevant lines inside mallocgc
c.scanAlloc += scanAlloc          // bytes that will need scanning
c.nextSample -= int64(size)        // sampler countdown
// per-P stat, flushed to global atomically at safe points

// from runtime/mcache.go, periodically
func (c *mcache) releaseAll() {
    for i := range c.alloc {
        s := c.alloc[i]
        if s != &emptymspan {
            mheap_.central[i].mcentral.uncacheSpan(s)
            c.alloc[i] = &emptymspan
        }
    }
    // flush per-P stats to gcController
    atomic.Xadd64(&gcController.totalAlloc, int64(c.totalAlloc))
    atomic.Xadd64(&gcController.totalAllocCount, int64(c.totalAllocCount))
    c.totalAlloc = 0
    c.totalAllocCount = 0
    c.scanAlloc = 0
}
```

`gcController.totalAlloc` is the **lifetime byte counter** — the value `runtime.ReadMemStats.TotalAlloc` returns. It's monotonic and per-P-aggregated at flush time, not at every allocation; the hot path touches per-P state only.

**Write barrier integration.** During GC's concurrent mark phase, every pointer write executes the *write barrier* (`runtime/mwbbuf.go` and `runtime/mbarrier.go`). The barrier records the *new* pointer value (Dijkstra-style insertion barrier with hybrid Yuasa-style deletion barrier since go1.8) so the marker doesn't lose track of newly-reachable objects. Allocation itself does **not** invoke the barrier — newly-allocated objects are by definition unreachable from old objects until a pointer is written. The barrier fires on the *write*, not the *allocation*.

Operational consequence: a GC cycle with high write rate (a lot of pointer mutation) pays write-barrier cost on every store; a cycle with high alloc rate but low mutation (build a big slice, hand it off, build another) is cheaper. This is why "preallocate and reuse" is a real performance win — fewer pointer writes after construction, not just fewer allocations.

---

## 12. A specific commit: replacing the treap with the radix tree

The most consequential allocator change of the last decade was the **page allocator rewrite for go1.14** (CL 190622, "runtime: use new page allocator", by Michael Knyszek, design by Austin Clements). Worth reading in full.

**Pre-1.14: the treap.** `mheap.free` was a treap (tree + heap) keyed by span size: each node stored a contiguous free span; the tree was balanced by random priority. To allocate N pages, the runtime walked the treap to find the smallest free span ≥ N pages, removed it, and (if larger) re-inserted the remainder. Every alloc and free was O(log N) under the global `mheap` lock. As heaps grew past a few GB and core counts grew past 16, the heap lock became a measurable bottleneck — visible as time spent in `runtime.lock` on flame graphs of allocation-heavy services.

**Post-1.14: the radix tree.** The replacement (described in §5.1) uses bitmap chunks rolled up via `pallocSum` summaries:

- **Allocation is O(levels) = O(log of address space)**, but with tiny constants: each level lookup is a few instructions.
- **The per-P page cache** (`pcache`, 64 bits = up to 64 pages = 512 KB) absorbs the common case of small allocations with no heap lock at all.
- **Scavenging integrates with the same data structure** — the scavenger walks summaries to find candidate regions rather than maintaining a parallel structure.

The CL added ~3000 lines to `runtime/mpagealloc*.go` and removed the treap. The release notes for 1.14 mention the change in two sentences; the underlying impact was measurable on every allocation-heavy benchmark. The post-1.14 trend continued: 1.16 added the per-P page cache; 1.18 tuned the scavenger; 1.19 introduced `GOMEMLIMIT` to give operators direct control over the pacer.

A second worth-reading change: **per-P scavenge work (go1.13/1.14)**. Pre-1.13 scavenging happened in `bgsweep` and contended with sweep work. CL 142960 ("runtime: scavenge in the background") split scavenging into its own goroutine, paced by the memory pacer rather than the GC pacer. The result was a real reduction in tail latency for steady-state services — the GC no longer paid scavenge cost during mark assists.

---

## 13. Reading order for the source

Reading the runtime cold is a multi-day exercise. A practical order:

1. **`runtime/HACKING.md`** — the runtime team's own reference. Start here.
2. **`runtime/sizeclasses.go`** — read the generated table top-to-bottom. Five minutes; calibrates every later discussion.
3. **`runtime/mksizeclasses.go`** — the generator. Reading the algorithm is the best way to understand *why* the table looks like it does.
4. **`runtime/malloc.go`** — `mallocgc` top to bottom. Focus on the three paths.
5. **`runtime/mcache.go`** — `nextFree`, `refill`. Short, mechanical.
6. **`runtime/mspan.go`** — the `mspan` type and `nextFreeIndex`.
7. **`runtime/mcentral.go`** — `cacheSpan` and the partial/full lists.
8. **`runtime/mheap.go`** — `alloc`, `allocSpan`, arena management.
9. **`runtime/mpagealloc.go`** — the radix tree. Read alongside Austin Clements's proposal (linked below).
10. **`runtime/mbitmap.go`** — heap bitmap encoding. Note the 2024 redesign for go1.22.
11. **`runtime/mgcscavenge.go`** — the scavenger, last because it depends on everything above.

For each file, run the in-tree benchmarks (`go test -bench=. runtime`) and read the test cases — they're often more illustrative than docs.

---

## 14. Closing principles

1. **Three paths, one entry.** `mallocgc` is the single funnel. Tiny path packs noscan-sub-16-byte; small path uses size-classed spans; large path goes direct to the page allocator. The branch is the first instruction of allocation, not the last.

2. **Per-P caching makes the fast path lock-free.** The `mcache` holds one span per `(class, scan)` pair; the page allocator caches at the per-P level too. Global locks are taken only at refill, sweep, and arena grow.

3. **Size classes are hand-tuned, not power-of-two.** The 68-class table minimises tail and max waste; the generator script chooses page counts to pack object sizes efficiently. Internalise the bound: max waste is ~12.5% on most classes.

4. **The radix tree replaced the treap for a reason.** Allocations are constant-time at the page level; summaries roll up free regions for efficient large-span searches; scavenging shares the data structure. The pre-1.14 treap was the bottleneck nobody talked about until it wasn't.

5. **Spans carry two bitmaps.** `allocBits` for the allocator, `gcmarkBits` for GC. At sweep, the difference is the freed set. Per-span `allocCache` is a 64-bit lookahead for ~1 ns slot acquisition.

6. **Heap bitmap = 1 bit per word.** GC walks the bitmap, not the objects. A 4 GB heap has a 64 MB bitmap that fits in L3; that's the reason mark scans run at memory-bandwidth speeds.

7. **Tiny allocator absorbs the small-noscan firehose.** 20–40% of allocations in real services are sub-16-byte noscan objects from interfaces, strings, and ephemeral byte slices. The tiny allocator packs them into shared 16-byte slots and halves the bitmap footprint.

8. **The scavenger is a cost model, not a feature.** Returning memory to the OS costs TLB shootdowns and refaults; not returning costs RSS. The pacer balances both, and `GOMEMLIMIT` is the production knob. Don't tune individual flags; set a memory budget and trust the pacer.

9. **Write barriers fire on writes, not allocations.** Allocation does not touch the GC barrier path. This is why preallocation patterns matter even when total bytes are constant — fewer post-construction pointer writes mean less mark work.

10. **The accounting is amortised.** Per-P counters are aggregated to global stats at flush points (typically span-cache exchange). `runtime.ReadMemStats` is a stop-the-world operation precisely because the per-P state has to be reconciled.

The allocator is the most-touched code in any Go program — every `new`, `make`, escape, closure capture, and channel send routes through it. Understanding the three paths, the radix tree, the size-class table, and the scavenger turns "GC is slow" from a complaint into a diagnosable engineering problem. The code is approachable; the design is opinionated; the trade-offs are explicit. Read it.

---

## Further reading

- Sanjay Ghemawat & Paul Menage, *TCMalloc: Thread-Caching Malloc* — the design Go's allocator is descended from
- Austin Clements, [*Scaling the Go page allocator*](https://github.com/golang/proposal/blob/master/design/35112-scaling-the-page-allocator.md) — the 1.14 radix tree proposal
- Michael Knyszek, [*Smarter Scavenging*](https://github.com/golang/proposal/blob/master/design/30333-smarter-scavenging.md) — the background scavenger design (1.13/1.14)
- Michael Knyszek, [*Soft Memory Limit*](https://github.com/golang/proposal/blob/master/design/48409-soft-memory-limit.md) — the `GOMEMLIMIT` proposal (1.19)
- `runtime/HACKING.md` — the in-tree runtime developer's guide
- `runtime/mksizeclasses.go` — the size-class table generator; read for the algorithm
- Rick Hudson, [*Getting to Go: The Journey of Go's Garbage Collector*](https://go.dev/blog/ismmkeynote) — context for the allocator/GC contract
- Austin Clements, *Eliminating Stack Rescanning* — the hybrid write barrier design (relevant to §11)
- Dmitry Vyukov, *Go scheduler: Implementing language with lightweight concurrency* — for understanding the P/M/G model the mcache rides on
- Bryan Boreham, *Allocator design in Go* — practical service-tuning talks (GopherCon)
- Felix Geisendörfer, *The Busy Developer's Guide to Go Profiling, Tracing and Observability* — `pprof -alloc_objects` / `-alloc_space` workflows
