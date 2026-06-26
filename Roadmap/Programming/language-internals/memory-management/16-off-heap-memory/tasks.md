# Off-heap / Native Memory — Hands-On Tasks

> **Topic:** [Off-heap / Native Memory](README.md)

These tasks move from observing the heap/off-heap boundary, through allocating and freeing native memory yourself, to deliberately *creating and then diagnosing* a native leak — the skill that separates people who've read about off-heap memory from people who've debugged it at 3 a.m. Use whichever runtime you're strongest in (JVM, Go, Rust, .NET); the concepts transfer, and where a task is JVM-specific it's noted.

---

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — See the boundary with your own eyes

Write a program that allocates 512 MiB *on* the heap (a big array/slice), prints its RSS and reported heap usage, then allocates 512 MiB *off* the heap (`ByteBuffer.allocateDirect` / `unix.Mmap` / `NativeMemory.Alloc`) and prints both again.

**Self-check:**
- [ ] RSS grew by ~512 MiB for the off-heap allocation.
- [ ] The runtime's *heap* metric did **not** grow for the off-heap allocation.
- [ ] I can state in one sentence why the heap metric ignored the off-heap allocation.

<details><summary>Hint</summary>
JVM: read `VmRSS` from `/proc/self/status` (or `ps -o rss`) and used heap from `ManagementFactory.getMemoryMXBean().getHeapMemoryUsage()`. Touch every page (write a byte per 4 KiB) so the OS actually makes it resident — lazy allocation won't show in RSS until you touch it.
</details>

### Task 2 — Allocate and explicitly free native memory

Allocate 256 MiB off-heap, write a recognizable pattern (e.g. `0xAB`) to the first and last byte, read them back, then **free it explicitly** and confirm RSS drops.

**Self-check:**
- [ ] First and last byte read back the value I wrote (bounds are correct).
- [ ] I freed it with the explicit call for my runtime (not by waiting for GC).
- [ ] RSS dropped after freeing (allowing for allocator retention — see Task 8).

<details><summary>Hint</summary>
JVM: use Panama — `try (Arena a = Arena.ofConfined()) { MemorySegment s = a.allocate(256L<<20); ... }` and observe the drop after the block. Go: `unix.Munmap`. Rust: let the `MmapMut`/`Vec` drop. .NET: `NativeMemory.Free`.
</details>

### Task 3 — Prove `allocateDirect` is NOT freed deterministically (JVM)

Allocate many `ByteBuffer.allocateDirect(64 MiB)` buffers in a loop, dropping each reference immediately, **without** calling `System.gc()`. Watch direct-buffer usage via `BufferPoolMXBean` (the `direct` pool). Then call `System.gc()` and watch it (eventually) drop.

**Self-check:**
- [ ] Direct usage climbed even though I held no references to the buffers.
- [ ] It only dropped after a GC ran (Cleaners fired).
- [ ] I can explain why this is "the worst of both worlds."

<details><summary>Hint</summary>
`ManagementFactory.getPlatformMXBeans(BufferPoolMXBean.class)`, find the one named `direct`, read `getMemoryUsed()`. Set `-XX:MaxDirectMemorySize=2g` so the JVM forces a GC at the cap instead of growing forever — observe that behavior too.
</details>

---

## Core

### Task 4 — Read a file via mmap (zero-copy)

Memory-map a file (create a few-hundred-MB one first) read-only and compute a checksum (sum of bytes, or count occurrences of a byte) by indexing the mapped region directly — **no `read()` calls**. Compare against the same computation done with normal buffered reads.

**Self-check:**
- [ ] My results match the buffered-read version (the mapping is correct).
- [ ] I made zero explicit read syscalls in the mmap version (verify with `strace -e read` / `dtruss`).
- [ ] I unmapped the region when done.

<details><summary>Hint</summary>
JVM: `FileChannel.map(MapMode.READ_ONLY, 0, size)`. Go: `unix.Mmap(int(f.Fd()), 0, size, PROT_READ, MAP_SHARED)` then index the slice. The first touch of each page faults it in from disk — that's the lazy paging from the theory pages happening for real.
</details>

### Task 5 — Watch lazy paging happen

Map a file larger than your free RAM (or use `madvise`/`MADV_DONTNEED` to evict). Touch one page near the start and one near the end, and observe RSS grow by roughly one page per touch — not by the file size. Then scan the whole file and watch RSS climb toward the working-set size.

**Self-check:**
- [ ] After touching two pages, RSS grew by ~2 pages (8 KiB), not by the file size.
- [ ] After a full scan, RSS reflects the resident working set.
- [ ] I can explain why mapping a 100 GiB file doesn't immediately use 100 GiB of RAM.

<details><summary>Hint</summary>
Compare the `Rss` field for the mapping in `/proc/self/smaps` before and after each touch. A `madvise(MADV_SEQUENTIAL)` before the full scan triggers read-ahead — note any throughput difference.
</details>

### Task 6 — Packed off-heap records (no object headers)

Store 10 million records of `{ int id; long timestamp; int score }` two ways: (a) as 10M heap objects, (b) as a single off-heap region with a 16-byte stride, reading fields in place. Compare memory footprint (RSS) and the GC behavior (pause time / cycle count) of the two.

**Self-check:**
- [ ] The off-heap version uses noticeably less memory (no per-object header, no padding overhead).
- [ ] The off-heap version causes far less GC activity for the same data.
- [ ] My in-place field reads return the same values I wrote.

<details><summary>Hint</summary>
JVM object header is 12–16 bytes; 10M objects waste 120–160 MB before any field data. Off-heap: `segment.get(JAVA_INT, index*16)`, `segment.get(JAVA_LONG, index*16+4)`, etc. Mind alignment — you may want padding or unaligned access.
</details>

---

## Advanced

### Task 7 — Build a native leak, then find it with NMT (JVM)

Deliberately leak: allocate direct buffers (or `Unsafe`/native memory) and stash them in a static collection so they're never freed. Run with `-XX:NativeMemoryTracking=summary`. Take a baseline, let the leak grow, then `summary.diff` to identify the growing bucket. Confirm the heap dashboard stays healthy throughout.

**Self-check:**
- [ ] RSS grew steadily while used heap stayed flat.
- [ ] `jcmd <pid> VM.native_memory summary.diff` shows the growth in the expected bucket (Internal/Other).
- [ ] A heap dump taken mid-leak does **not** reveal the leaked native bytes.

<details><summary>Hint</summary>
`jcmd <pid> VM.native_memory baseline` early, then `jcmd <pid> VM.native_memory summary.diff` later. NMT adds 5–10% overhead — fine for a diagnostic run. The point is to feel how invisible this leak is to normal tools.
</details>

### Task 8 — Distinguish a leak from allocator retention

Write a loop that allocates and *frees* large native blocks repeatedly. Observe that RSS rises and then plateaus high without falling, even though you free everything. Then re-run with `MALLOC_ARENA_MAX=2` (or under jemalloc) and observe the difference.

**Self-check:**
- [ ] Despite freeing everything, RSS did not return to baseline (glibc retention).
- [ ] `MALLOC_ARENA_MAX=2` or jemalloc changed the retention behavior.
- [ ] I can articulate why "high RSS" is not always "a leak."

<details><summary>Hint</summary>
glibc `malloc` keeps per-thread arenas at their high-water mark rather than returning memory to the OS. This is the trap that sends people chasing phantom leaks — internalize the difference between unbounded growth (leak) and a plateau (retention).
</details>

### Task 9 — Container OOM with a healthy heap

Run your service from Task 7 in a container with a memory limit set *equal to* `-Xmx` (JVM) or `GOMEMLIMIT` (Go). Watch the kernel OOM-kill it (exit 137) while the heap/heap-limit was never breached. Then re-run with the limit budgeted as heap + off-heap + headroom and confirm it survives.

**Self-check:**
- [ ] The first run was killed with exit code 137 and produced **no** `OutOfMemoryError` / panic and no heap dump.
- [ ] `dmesg` / the container runtime logs show an OOM kill against RSS.
- [ ] With a proper RSS-based budget, the process no longer dies (or dies cleanly at the managed cap).

<details><summary>Hint</summary>
`docker run -m 2g ... -Xmx2g` is the booby trap. Check `dmesg | grep -i oom` or `kubectl describe pod` for `OOMKilled`. The lesson: budget the *process*, not the heap.
</details>

---

## Capstone

### Task 10 — A minimal off-heap key→bytes store with leak-proof ownership

Build a small off-heap store: fixed-size slots in one or more native regions, a method to put a byte payload, a method to get it back, and explicit, deterministic freeing of all regions on `close()`. Then add observability (a metric for total off-heap bytes), and finally write a test that *fails* if the store leaks native memory across its lifecycle.

**Requirements:**
- All payload bytes live off-heap; only the index/metadata may be on-heap.
- Freeing is deterministic (arena/region close or explicit free) — no reliance on GC/Cleaner for the bulk data.
- Out-of-bounds access is rejected safely (don't crash the process).
- Expose a live "off-heap bytes in use" gauge.
- A test allocates, uses, and closes the store, then asserts native usage returned to baseline.

**Self-check:**
- [ ] Putting and getting payloads round-trips correctly.
- [ ] After `close()`, my off-heap gauge returns to zero and RSS drops (modulo allocator retention).
- [ ] An out-of-range index produces a safe error, not a SIGSEGV.
- [ ] My leak test would catch a missing free (verify by temporarily removing the free and watching it fail).
- [ ] I can explain my ownership/lifetime model in two sentences.

<details><summary>Hint (design)</summary>
JVM: back the store with a single `Arena` (or a list of segments owned by one arena); `close()` closes the arena and frees everything at once — bulk freeing is both faster and harder to leak than per-slot frees. Use `MemorySegment` bounds checks for the safe-access requirement. Go/Rust/.NET: own the `mmap`/allocation in one struct whose `Close`/`Drop`/`Dispose` frees it, and gate index access against the region size yourself.
</details>

<details><summary>Sparse solution sketch (JVM)</summary>

```java
final class OffHeapStore implements AutoCloseable {
    private final Arena arena = Arena.ofShared();
    private final MemorySegment region;
    private final int slotSize, slots;
    private final AtomicLong inUse = new AtomicLong();

    OffHeapStore(int slots, int slotSize) {
        this.slots = slots; this.slotSize = slotSize;
        this.region = arena.allocate((long) slots * slotSize);
    }
    void put(int slot, byte[] data) {
        if (slot < 0 || slot >= slots) throw new IndexOutOfBoundsException();
        if (data.length > slotSize) throw new IllegalArgumentException();
        MemorySegment.copy(data, 0, region, ValueLayout.JAVA_BYTE,
                           (long) slot * slotSize, data.length);
        inUse.addAndGet(data.length);                 // gauge source
    }
    byte[] get(int slot, int len) {
        if (slot < 0 || slot >= slots) throw new IndexOutOfBoundsException();
        byte[] out = new byte[len];
        MemorySegment.copy(region, ValueLayout.JAVA_BYTE,
                           (long) slot * slotSize, out, 0, len);
        return out;
    }
    long offHeapBytes() { return region.byteSize(); } // for the metric
    @Override public void close() { arena.close(); }  // deterministic free of ALL slots
}
```

The leak test allocates an `OffHeapStore`, exercises it, calls `close()`, then asserts `BufferPoolMXBean`/NMT native usage (or RSS, with tolerance) returned to baseline. Remove the `close()` and the test must fail — that's the whole point.
</details>

---

## Self-Assessment

You're ready to move on when you can:

- [ ] Explain, with RSS numbers you've personally observed, why off-heap memory is invisible to the heap metric and to `-Xmx`/`GOMEMLIMIT`.
- [ ] Allocate and **deterministically** free native memory in your runtime, and say why deterministic freeing beats Cleaner/GC-driven freeing.
- [ ] Demonstrate lazy paging on an mmap'd file and explain why mapping a file larger than RAM is fine.
- [ ] Reproduce a native leak, confirm a heap dump can't see it, and locate the growing bucket with NMT (or `pmap`/jemalloc for native-library leaks).
- [ ] Distinguish a real unbounded leak from glibc allocator retention.
- [ ] Reproduce a container OOM kill (exit 137) caused by off-heap growth with a healthy heap, and fix it by budgeting the process against RSS.
- [ ] Design an off-heap store with singular, explicit ownership and a test that fails on a leak.
