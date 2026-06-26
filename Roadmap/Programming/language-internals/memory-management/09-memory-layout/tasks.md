# Memory Layout — Hands-On Tasks
> **Topic:** [Memory Layout](README.md)

These tasks turn the theory into muscle memory. You will *measure* layout, not just read about it: print sizes and offsets, reorder for size, reproduce and fix false sharing, and convert AoS→SoA with a stopwatch. Pick any mainstream language (C, Go, and Rust are ideal because layout is observable); a Linux box with `perf` and `pahole` unlocks the advanced tasks.

> **Discipline for every task:** before you run, *predict* the number. Write down the size, offset, or speedup you expect. Then measure. The gap between prediction and reality is where the learning is.

---

## Table of Contents
- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Prove `sizeof` ≠ sum of fields
Declare `struct Mixed { char a; int b; char c; double d; short e; };` (or the equivalent in your language). By hand, on paper, compute: (a) the sum of the field sizes, and (b) the actual `sizeof`, accounting for padding and trailing padding. Then print the real size and the offset of every field.

**Self-check:**
- [ ] I computed the expected size by hand *before* running.
- [ ] My hand-computed offsets match the printed offsets exactly.
- [ ] I can point to each padding gap and say which field's alignment caused it.
- [ ] I can explain why there is trailing padding at the end.

<details><summary>Hint</summary>
C: `printf("%zu\n", offsetof(struct Mixed, b));`. Go: `unsafe.Offsetof(Mixed{}.B)`. Rust: use `#[repr(C)]` and `std::mem::offset_of!`. Walk offsets left to right: each field jumps to the next multiple of its alignment.
</details>

### Task 2 — Reorder to shrink
Take the struct from Task 1 and reorder its fields **largest-alignment-first**. Predict the new size, then measure. Report the bytes saved and the percentage.

**Self-check:**
- [ ] The reordered struct is smaller (or you can explain why it isn't).
- [ ] I predicted the new size correctly before measuring.
- [ ] The behavior of any code using the struct is unchanged.

<details><summary>Hint</summary>
Order: `double d; int b; short e; char a; char c;`. The two `char`s and the `short` now share gaps instead of each forcing fresh padding.
</details>

### Task 3 — Watch packing change the size
Define the Task 1 struct twice: once normally, once with `#pragma pack(1)` / `__attribute__((packed))` / `#[repr(packed)]`. Print both sizes. Then try to take the *address* of an inner field of the packed version and note any compiler warning.

**Self-check:**
- [ ] The packed size equals the exact sum of field sizes (zero padding).
- [ ] I observed the compiler warn (or refuse) on taking a pointer to a packed field.
- [ ] I can state on which architectures reading that misaligned field by pointer would crash.

<details><summary>Hint</summary>
GCC/Clang warn `taking address of packed member ... may result in an unaligned pointer value`. Rust outright errors on `&packed.field` in safe code. Read packed fields by *value*.
</details>

---

## Core

### Task 4 — Reproduce false sharing
Two threads, each incrementing its own `uint64`/atomic, 100M+ times. Layout A: both counters adjacent in one struct (same cache line). Layout B: each counter padded to its own 64-byte line. Time both. Report the speedup of B over A on your multi-core machine.

**Self-check:**
- [ ] Layout B is meaningfully faster than Layout A (often 3–10×).
- [ ] I confirmed both threads ran on different cores (pin them if unsure).
- [ ] I can explain why A is slow even though the threads never touch each other's counter.
- [ ] Increasing thread count makes A's problem *worse*, not better.

<details><summary>Hint</summary>
Go: `_ [56]byte` padding after the `uint64`. C: `alignas(64)`. Rust: `crossbeam_utils::CachePadded`. Pin with `taskset -c 0,1` (Linux) so the OS doesn't co-schedule the threads onto one core and hide the effect.
</details>

### Task 5 — Hot/cold split a fat struct
Build a struct with ~24 bytes of "hot" fields and ~200 bytes of "cold" fields (a name buffer, an error string, timestamps). Create an array of 1M of them and write a loop that sums only the hot fields. Now split: keep hot fields inline, move cold fields behind a pointer. Time the hot-only scan before and after.

**Self-check:**
- [ ] The split version's hot scan is faster (fewer cache lines touched).
- [ ] I can compute how many structs fit per 64-byte line before vs. after.
- [ ] The cold data is still reachable on the rare path.
- [ ] I understand the trade-off: an extra indirection/allocation on the cold path.

<details><summary>Hint</summary>
Before the split, the struct spans ~4 cache lines, so the hot scan drags ~200 bytes of cold junk through cache per element. After, the hot struct is ~32 bytes (2 per line) and the cold pointer is followed only when needed.
</details>

### Task 6 — AoS → SoA conversion with timing
Particle struct: `{x, y, z, vx, vy, vz: float; color: u32}`. Allocate 10M. Implement a physics step `pos += vel` over all particles in **AoS**, then in **SoA**. Time both. Report the speedup and explain it in terms of cache-line utilization and SIMD.

**Self-check:**
- [ ] SoA is faster for the bulk physics step.
- [ ] I can compute the useful-bytes-per-cache-line ratio for each layout.
- [ ] I can articulate why SoA enables SIMD here and AoS resists it.
- [ ] I can name a workload where AoS would instead win (single-record access).

<details><summary>Hint</summary>
In AoS, consecutive `x` values are `sizeof(Particle)` (28→32) bytes apart — a strided/gather access SIMD hates, and each loaded line carries `vx..color` the position pass may not need. In SoA, `x[]` is dense floats: 16 per line, all used, and the loop vectorizes to one AVX add per 8 lanes.
</details>

### Task 7 — Pointer chasing vs. flat array
Build a singly linked list of 10M integers and a flat array/slice of the same 10M integers (in the *same* values). Sum each. Time both. To make the list maximally hostile, allocate its nodes in *shuffled* order so they're scattered across the heap.

**Self-check:**
- [ ] The flat array is dramatically faster (often 10×+).
- [ ] Shuffling the node allocation order made the list even slower.
- [ ] I can explain why the list can't be prefetched (dependent loads).
- [ ] Both have identical Big-O, yet wildly different wall-clock — and I can say why.

<details><summary>Hint</summary>
Allocate nodes into a vector, shuffle, then link them in shuffled order so `next` jumps randomly across the heap. The CPU can't compute `next->next`'s address until `next` loads, so it stalls ~200 cycles per hop with nothing to prefetch.
</details>

---

## Advanced

### Task 8 — Read your struct's true layout with `pahole`
Compile a C/Go/Rust program (with `-g`) containing your Task 5 fat struct. Run `pahole -C YourStruct ./binary`. Identify every hole, every cache-line boundary crossed, and the size-vs-sum gap. Then run `pahole --reorganize` and compare its suggestion to your own reordering from Task 2.

**Self-check:**
- [ ] `pahole` output matches the offsets I measured manually.
- [ ] I located each `/* XXX N bytes hole */` and named the field that caused it.
- [ ] I found where the 64-byte cache-line boundaries fall in the struct.
- [ ] `pahole --reorganize`'s suggestion matches (or beats) my hand-reorder.

<details><summary>Hint</summary>
`pahole` needs DWARF debug info (`-g`, unstripped). For Go, build normally (Go embeds DWARF by default) and target the type by name. The `/* --- cacheline 1 boundary --- */` comments show line crossings; a field straddling one costs two fills to read.
</details>

### Task 9 — Pinpoint false sharing with `perf c2c`
Take the unpadded (slow) version from Task 4. Run `perf c2c record -- ./bench` then `perf c2c report --stdio`. Find the cache line with the highest **remote HITM**, identify the two byte offsets stored by two different CPUs, and map them back to your fields. Then run the padded version and confirm the HITM collapsed.

**Self-check:**
- [ ] I found the single contended cache line in the c2c report.
- [ ] I identified the two offending offsets and the CPUs writing them.
- [ ] I mapped those offsets to fields (cross-referenced with `pahole`).
- [ ] The padded version shows the HITM count dropping toward zero.

<details><summary>Hint</summary>
Look for the "Shared Data Cache Line Table" and the per-line "Cacheline" breakdown. High **Rmt HITM** = remote hit-on-modified = two cores fighting. If samples are sparse, lengthen the run or raise the sampling frequency. Pin threads so the contention is real and reproducible.
</details>

### Task 10 — Attribute the cost with hardware counters
For your Task 7 (pointer chasing vs. flat array), run each under `perf stat -e instructions,cycles,LLC-loads,LLC-load-misses,cycle_activity.stalls_l3_miss`. Compute MPKI for each. Show that the linked list is **latency-bound** (high memory-stall cycles, low IPC) while the flat array is not.

**Self-check:**
- [ ] The linked list has far higher `cycle_activity.stalls_l3_miss`.
- [ ] The linked list has much lower IPC (instructions/cycles).
- [ ] I computed MPKI for both and the list's is much higher.
- [ ] I can explain why raw miss *count* alone wouldn't prove the cost — stall cycles do.

<details><summary>Hint</summary>
MPKI = `LLC-load-misses / instructions * 1000`. The list is latency-bound because each load *depends on* the previous one; the core idles waiting. The array's misses are hidden by prefetch and out-of-order execution, so its stall cycles stay low even at similar raw miss counts.
</details>

### Task 11 — Confirm vectorization actually happened
Take your Task 6 SoA physics step. Compile with the vectorization report on (`clang -Rpass=loop-vectorize` or `gcc -fopt-info-vec`). Confirm the loop vectorized and at what width. Then deliberately break it (add a data-dependent branch inside the loop, or alias the arrays) and watch the compiler refuse — and the speed regress.

**Self-check:**
- [ ] I saw a "vectorized loop (width: N)" remark for the clean SoA loop.
- [ ] I confirmed the AoS version did *not* vectorize (or vectorized worse).
- [ ] I made the compiler emit a "loop not vectorized" remark on purpose.
- [ ] The de-vectorized version was measurably slower, proving SIMD was the win.

<details><summary>Hint</summary>
Common vectorization blockers: pointer aliasing the compiler can't disprove (use `restrict` in C), a branch inside the loop body, non-contiguous/strided access (exactly what AoS imposes), or a loop-carried dependency. Inspect the disassembly for `vaddps`/`vmovups` to confirm vector instructions.
</details>

---

## Capstone

### Task 12 — Optimize a realistic "entity" workload end-to-end
You're given (or you build) a simulation: 5M entities, each with `position`, `velocity`, `health`, `team_id`, a 64-byte `name`, and a 128-byte `debug_log`. Two hot systems run every tick: **movement** (`position += velocity`) and **combat** (reads `health`, `team_id`, writes `health`). A rare system renders one selected entity (needs all fields). Optimize the layout and measure every step.

Deliverables:
1. **Baseline:** naive AoS struct, all fields inline. Run `pahole` on it; record its size, holes, and cache-lines. Time both hot systems.
2. **Reorder:** apply largest-first ordering; re-`pahole`; show holes shrank; re-time.
3. **Hot/cold split:** move `name` and `debug_log` behind a pointer; re-time the hot systems.
4. **SoA transform:** convert the hot fields to struct-of-arrays (`position[]`, `velocity[]`, `health[]`, `team_id[]`); re-time. Confirm vectorization of movement.
5. **Counter proof:** run the SoA hot systems under `perf stat`; show LLC misses and memory-stall cycles dropped versus baseline.
6. **Parallelize + check false sharing:** run movement across N threads partitioned by entity range; run `perf c2c` to verify partition boundaries don't false-share (align partitions to cache lines if they do).

**Self-check:**
- [ ] Each transformation produced a measured improvement (or I explained why one didn't).
- [ ] `pahole` confirms the reorder closed holes; size dropped.
- [ ] The hot-only scan sped up after the hot/cold split.
- [ ] SoA movement vectorized (confirmed via vectorization remark + disassembly).
- [ ] `perf stat` shows lower LLC misses and `stalls_l3_miss` for SoA vs. baseline.
- [ ] `perf c2c` shows no significant remote HITM after parallelizing (no false sharing at partition edges).
- [ ] I kept a before/after table of size, time, MPKI, and stall cycles for every step.

<details><summary>Hint (methodology)</summary>
Change one thing at a time and re-measure the *named counter* you expect to move — that's the professional discipline. Predictions: reorder cuts size/holes (pahole); hot/cold split cuts cache-lines-per-scan (fewer LLC misses on the hot pass); SoA raises line utilization toward 1.0 and enables SIMD (IPC up); parallel partitioning can introduce false sharing only at the boundary entities — pad/align partition starts to 64 bytes if `perf c2c` shows HITM there. The rendering path staying slow is *fine* — it's rare; don't pessimize the hot paths to speed it up.
</details>

<details><summary>Solution sketch</summary>
The winning design is SoA for the hot fields (`position[]`, `velocity[]`, `health[]`, `team_id[]`) with cold fields (`name`, `debug_log`) in a parallel cold array or behind a per-entity pointer reached only by the render path. Movement becomes a dense, vectorizable sweep over `position[]`/`velocity[]`; combat over `health[]`/`team_id[]`. Parallelize by contiguous entity ranges; because each thread owns a disjoint contiguous slice, false sharing only risks the few boundary cache lines — align each thread's start index so partitions begin on a cache-line boundary. Expected end state vs. naive AoS: smaller working set per hot pass, LLC misses and memory-stall cycles down substantially, movement vectorized, and near-linear thread scaling confirmed by a clean `perf c2c`.
</details>

---

## Self-Assessment

Rate yourself honestly. You have mastered this topic when you can:

- [ ] **Predict** a struct's size and field offsets by hand, then confirm with code and `pahole`.
- [ ] Reorder fields to minimize padding and explain *why* largest-first works.
- [ ] Explain packing's trade-off precisely — including why a pointer to a packed field is UB and where misaligned reads crash.
- [ ] Reproduce false sharing, fix it with cache-line padding, and **prove** the fix with `perf c2c` remote-HITM counts.
- [ ] Choose AoS vs. SoA from the access pattern and quantify the difference in cache-line utilization and SIMD.
- [ ] Explain why pointer chasing is cache-hostile (dependent loads, no prefetch) and convert hot structures to flat/index-based form.
- [ ] Distinguish **latency-bound** from **bandwidth-bound** memory problems using `cycle_activity.stalls_l3_miss` and IPC, and pick the right fix.
- [ ] Describe managed-runtime object-header overhead (JVM mark word + klass pointer, compressed-oops cliff, Go's lack of headers) and its layout consequences.
- [ ] Run an optimization the professional way: change one thing, predict a named counter, measure it, and confirm end-to-end on wall-clock.

If you can check every box — especially the ones requiring you to *prove it with a tool* — you understand memory layout at the level that separates engineers who guess from engineers who measure.
