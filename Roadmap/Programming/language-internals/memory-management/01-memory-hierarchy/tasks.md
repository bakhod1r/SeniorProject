# The Memory Hierarchy — Hands-On Tasks

> **Topic:** [The Memory Hierarchy](README.md)

---

These tasks make the hierarchy *visible*. You'll measure cache-line size, the latency cliff between cache levels, the cost of bad layout, false sharing, and (optionally) NUMA — all from your own machine. Use any of C, Go, Rust, or Java; examples below are language-neutral pseudocode plus `perf`. On Linux, install `linux-perf`; on macOS use Instruments / `dtrace` equivalents or run inside a Linux VM/container for the counter tasks.

A note on measuring honestly: warm up before timing, run several iterations and take the median, prevent the compiler from optimizing away the work (consume the result into a `volatile`/`sink`), pin frequency if you can, and make your test data **larger than L3** when you want to see DRAM effects.

---

## Warm-Up

### Task 1 — Build the latency table from memory

Without looking, write down approximate latencies for: register, L1, L2, L3, DRAM, NVMe SSD, LAN round-trip. Then write the *ratio* of each to a register access.

**Self-check:**
- [ ] My numbers are within an order of magnitude of: <1 ns, ~1 ns, ~4 ns, ~12–40 ns, ~60–100 ns, ~10–100 µs, ~0.1–1 ms.
- [ ] I can state why each level exists (fast+small+costly vs slow+big+cheap).
- [ ] I can explain the "if 1 cycle = 1 second" rescaling and why a disk trip feels like a day.

### Task 2 — Find your machine's cache and TLB sizes

Discover the real hierarchy on your hardware.

```bash
# Linux
lscpu | grep -i cache
getconf -a | grep -i cache
ls /sys/devices/system/cpu/cpu0/cache/index*/   # size, line_size, ways_of_associativity
```

**Self-check:**
- [ ] I recorded L1d, L2, L3 sizes and the **cache line size** (`coherency_line_size`, expect 64).
- [ ] I recorded the associativity (ways) of each level.
- [ ] I found whether my CPU is multi-socket / multi-NUMA-node (`numactl --hardware` or `lscpu | grep NUMA`).

---

## Core

### Task 3 — Measure the cache line size from software

Sum an array touching one element every `stride` elements; sweep `stride` from 1 to 64 and plot time per element.

```
for stride in {1,2,4,8,16,32,64}:
    t0 = now()
    for i in 0..N step stride: sink += a[i]
    record (stride, (now()-t0) / (N/stride))
```

**Self-check:**
- [ ] Time-per-element rises as stride grows, then **plateaus around stride = 16 four-byte ints (= 64 bytes)**.
- [ ] I can explain the plateau: past one element per line, each access already costs a whole line.
- [ ] My measured line size matches `coherency_line_size` from Task 2.

*Hint:* Keep the array well larger than L2 so you're not accidentally measuring L1 the whole time.

### Task 4 — Reveal the cache-level cliffs (the classic "cache size" benchmark)

For a range of working-set sizes `S` from 4 KB up to several × L3, repeatedly stride through `S` bytes (e.g. pointer-chase or fixed stride) and measure average access time.

```
for S in [4KB, 16KB, 64KB, 256KB, 1MB, 4MB, 16MB, 64MB, 256MB]:
    buf = array of size S, accessed in a way that revisits it many times
    measure average ns per access
```

**Self-check:**
- [ ] My plot shows **steps**: flat-and-fast while S fits L1, a jump at L2, another at L3, then a big jump to DRAM (~100 ns).
- [ ] The step boundaries line up with the L1/L2/L3 sizes from Task 2.
- [ ] I can identify which region is latency-bound vs bandwidth-bound.

*Hint:* A randomized pointer-chase within the buffer exposes latency cleanly (defeats prefetch); a linear stride shows the bandwidth-friendly case. Try both and compare.

### Task 5 — Row-major vs column-major (layout vs access pattern)

Sum an `N×N` matrix (`N` ~ 4096) both row-first and column-first.

**Self-check:**
- [ ] Same result, same number of additions, but column-first is **multiple× slower**.
- [ ] `perf stat -e cache-misses,LLC-load-misses ./app` shows far more misses for the slow version.
- [ ] I can explain it via cache-line utilization and prefetcher behavior.

### Task 6 — Confirm boundness with perf

Take the slow loop from Task 5 and attribute its time.

```bash
perf stat -e cycles,instructions,LLC-loads,LLC-load-misses,dTLB-load-misses ./app
perf record -e LLC-load-misses:pp ./app && perf report
```

**Self-check:**
- [ ] I computed IPC and saw it drop for the slow version.
- [ ] I converted `LLC-load-misses × ~100 ns` to time and compared to runtime (not just the ratio).
- [ ] `perf report` points at the inner loop as the miss hotspot.

---

## Advanced

### Task 7 — AoS vs SoA on a SIMD-shaped kernel

Implement a particle update (`pos += vel` for x,y,z) over ~10M particles, once as Array-of-Structures and once as Structure-of-Arrays. Time both; inspect generated assembly for vectorization.

**Self-check:**
- [ ] SoA is meaningfully faster (often 2–8×) for the field-wise update.
- [ ] The SoA inner loop vectorizes (look for `movups`/`vmovups`/`vfmadd`/`vaddps` over packed lanes) while AoS does not, or does so worse.
- [ ] `perf` shows SoA touches fewer lines / has higher useful bandwidth.
- [ ] I can name a workload where AoS would instead be the right choice (whole-record access).

### Task 8 — Reproduce and fix false sharing

Have `T` threads each increment its own counter in a shared array `long c[T]`, looping millions of times. Measure throughput vs `T`. Then pad each counter to 64 bytes and re-measure.

**Self-check:**
- [ ] Unpadded: throughput **fails to scale** (or worsens) past a few threads.
- [ ] `perf c2c` (Linux) flags a single contended 64-byte line and the writing functions.
- [ ] Padded version scales roughly linearly with cores.
- [ ] I can explain why coherence operates at line granularity, not variable granularity.

*Hint:* On Java use `@Contended` (+`-XX:-RestrictContended`); Rust `crossbeam::CachePadded`; Go a struct with a `[56]byte` pad after the `uint64`.

### Task 9 — TLB pressure and huge pages

Stride through a multi-GB buffer with a page-sized stride (touch one element per 4 KB) so the data cache barely matters but you exhaust the TLB. Measure, then back the buffer with huge pages and re-measure.

**Self-check:**
- [ ] `perf stat -e dTLB-load-misses,dtlb_load_misses.walk_active ./app` shows high TLB-walk activity for the 4 KB-page version.
- [ ] Huge pages (e.g. `madvise(MADV_HUGEPAGE)`, `mmap(MAP_HUGETLB)`, or `transparent_hugepage=always`) reduce TLB misses and runtime.
- [ ] I can explain why one 2 MB entry covers 512× the memory of a 4 KB entry.

### Task 10 — (If you have NUMA hardware) measure local vs remote memory

On a multi-socket box, allocate+first-touch a large buffer on node 0, then run a streaming kernel pinned to node 0 vs node 1.

```bash
numactl --cpunodebind=0 --membind=0 ./bench   # local
numactl --cpunodebind=1 --membind=0 ./bench   # remote: cores on node1, memory on node0
numastat -p $(pgrep bench)
```

**Self-check:**
- [ ] Remote runs are noticeably slower (~1.5–2× latency, lower bandwidth).
- [ ] `numastat` shows remote accesses for the cross-node case.
- [ ] I can describe the **first-touch** trap and how parallel initialization fixes it.

---

## Capstone

### Task 11 — Optimize a memory-bound kernel end-to-end and prove it

Pick a real-ish kernel (e.g. naive matrix multiply, or aggregation over a columnar dataset). Establish a baseline, then apply hierarchy-aware optimizations and document each step with measurements.

Required steps:
1. **Baseline** timing + `perf stat` + Top-Down (`toplev -l1`) to establish it's Memory/Backend-Bound.
2. **Roofline**: estimate arithmetic intensity (FLOPs ÷ bytes moved); state whether it's left (memory-bound) or right (compute-bound) of the ridge.
3. **Improve locality**: apply blocking/tiling so tiles fit L1/L2, and/or switch AoS→SoA. Re-measure.
4. **Address translation/NUMA** if relevant (huge pages, placement).
5. **Verify** the targeted TMA bucket actually shrank and report the speedup.

**Self-check:**
- [ ] I have a before/after table: runtime, IPC, LLC-load-misses, and (if used) DRAM-Bound %.
- [ ] My speedup is explained by a *named* mechanism (capacity-miss reduction, vectorization, fewer page walks, local placement), not luck.
- [ ] I confirmed the optimization moved the kernel along the roofline as predicted.
- [ ] I can articulate the remaining bottleneck and what the *next* fix would target.

*Hint for matmul:* the classic win is tiling — load an L1/L2-sized block of each matrix and reuse it O(tile) times, raising arithmetic intensity and converting capacity misses to hits. The FLOP count is unchanged; only bytes-from-DRAM drop.

---

## Self-Assessment

You understand the memory hierarchy at a working level if you can:

- [ ] State the levels and approximate latencies/bandwidths from memory, and justify why each exists.
- [ ] Predict, before running, whether a loop will be cache-friendly from its access pattern.
- [ ] Measure cache line size and the L1/L2/L3/DRAM cliffs empirically and match them to your hardware.
- [ ] Read `perf` output and convert misses to *time*, and use Top-Down to decide if memory is even the bottleneck.
- [ ] Diagnose and fix false sharing, TLB pressure, and NUMA misplacement.
- [ ] Choose AoS vs SoA (vs AoSoA) for a given hot loop and explain the trade-off.
- [ ] Apply blocking/tiling to turn capacity misses into hits and verify the result on a roofline.
- [ ] Explain why this topic underlies every later memory-management concept: allocation, GC, paging, and data-structure design all live or die by their interaction with this hierarchy.
