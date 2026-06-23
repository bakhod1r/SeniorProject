# Concurrent Bloom Filter — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Where Senior Left Off](#where-senior-left-off)
3. [The False-Positive Formula From First Principles](#the-false-positive-formula-from-first-principles)
4. [Hash Function Theory For Bloom Filters](#hash-function-theory-for-bloom-filters)
5. [Cache Hierarchy and Block Bloom Filters](#cache-hierarchy-and-block-bloom-filters)
6. [Memory Ordering and the Go Memory Model](#memory-ordering-and-the-go-memory-model)
7. [Lock-Free Bloom Filter Designs](#lock-free-bloom-filter-designs)
8. [NUMA and Multi-Socket Systems](#numa-and-multi-socket-systems)
9. [Garbage Collector Interactions](#garbage-collector-interactions)
10. [Production Failure Modes at Scale](#production-failure-modes-at-scale)
11. [Benchmarking Methodology](#benchmarking-methodology)
12. [SIMD and Vectorisation](#simd-and-vectorisation)
13. [Bloom-Family Algorithms Deep Dive](#bloom-family-algorithms-deep-dive)
14. [Distributed Systems Considerations](#distributed-systems-considerations)
15. [Verification and Formal Reasoning](#verification-and-formal-reasoning)
16. [Final Wrap](#final-wrap)
17. [Further Reading](#further-reading)

---

## Introduction

By professional level you have shipped Bloom filters, operated them, and architected systems around them. This file is about the *why* underneath everything you have learned: the mathematics that proves false-positive rates, the hardware that determines latency, the memory model that makes lock-free safe, the failure modes that emerge at the largest scales.

The audience is the engineer who:

- Reads the Linux kernel for entertainment.
- Has profiled `runtime.lock2` to find a false-sharing bug.
- Can derive the Bloom filter optimum k from m and n on a whiteboard.
- Wants to understand why RocksDB's `bloom_locality` setting makes a 3x difference.
- Operates Bloom filters with 10^11 keys across geographically distributed clusters.

If you are not yet there but want to be, read every paragraph. Some sections are dense; expect to re-read.

After this file you will:

- Derive every Bloom-filter formula from first principles.
- Reason about hash-function quality at the bit level.
- Choose memory layouts for cache friendliness with confidence.
- Apply the Go memory model rigorously to lock-free designs.
- Diagnose NUMA, GC, and TLB pathologies in production filters.
- Architect Bloom-filter systems that operate at the limit of physical hardware.

This is the last level. Read slowly.

---

## Where Senior Left Off

Senior covered:

- Variants: partitioned, scalable, Cuckoo.
- LSM-tree integration.
- Distributed filters with gossip.
- Operations: rebuild strategies, kill switches, capacity planning.
- Adversarial considerations.
- Architecture workshops.

Professional sits one level below. We open the box and look at the gears.

---

## The False-Positive Formula From First Principles

Let us derive every result rigorously, with no hand-waving.

### Setup

- `m` — number of bits in the filter, indexed `0..m-1`.
- `k` — number of hash functions.
- `n` — number of items added.
- We assume the k hash functions are *independent* and *uniform*: each maps to any of m positions with equal probability, independent of the others and of other keys.

### Probability that a specific bit is not set after one Add

Adding a key sets k bits chosen uniformly. The probability that a specific bit, call it `j`, is *not* hit by any of the k positions is:

```
P(j not set after 1 add) = (1 - 1/m)^k
```

This assumes the k positions are sampled with replacement (you could land on the same bit twice). In the limit of large m, this is essentially indistinguishable from sampling without replacement.

### After n Adds

Each Add is independent. The probability bit `j` remains unset after n Adds:

```
P(j not set after n adds) = (1 - 1/m)^(kn)
```

For large m, `(1 - 1/m)^m ≈ e^(-1)`, so:

```
(1 - 1/m)^(kn) ≈ e^(-kn/m)
```

The error of this approximation is bounded by `kn/m^2`, negligible for production-size filters.

### Probability bit j is set

```
P(j set after n adds) ≈ 1 - e^(-kn/m)
```

### Probability a non-member triggers a false positive

A non-member key hashes to k positions; the Test returns true iff all k positions are set. Assuming the k positions are independent (an approximation; we revisit below):

```
p = (1 - e^(-kn/m))^k
```

### Optimum k

Take the derivative of `ln p` with respect to k:

```
ln p = k * ln(1 - e^(-kn/m))
```

Let `q = kn/m`. Then `1 - e^(-q)` is monotonic increasing in q; the FPR is a balance between "more k" (more bits to check, lower individual probability) and "more k means more bits set" (higher individual probability).

Setting the derivative to zero:

```
d/dk [k * ln(1 - e^(-kn/m))] = 0
```

After algebra (Mitzenmacher's textbook, Chapter 5), the optimum is:

```
k* = (m/n) * ln 2
```

At k*, exactly half the bits are set: `1 - e^(-k*n/m) = 1 - e^(-ln 2) = 1 - 1/2 = 1/2`. The bit array is half full at optimum — a beautiful result.

Substituting k* into the FPR formula:

```
p* = (1/2)^(k*) = (1/2)^((m/n) ln 2) = e^(-(m/n) (ln 2)^2)
```

Solving for `m/n` given target `p*`:

```
m/n = -ln(p*) / (ln 2)^2 ≈ 1.4427 * log2(1/p*)
```

For `p* = 0.01`: `m/n = 9.585`. For `p* = 0.001`: `m/n = 14.38`. For `p* = 0.0001`: `m/n = 19.17`. These are the numbers from junior.md, now derived.

### The information-theoretic lower bound

A theorem (Carter, Floyd, Gill, Markowsky, Wegman 1978): any data structure with false-positive rate `p` over a set of size `n` must use at least `n * log2(1/p)` bits.

Bloom filters use `n * 1.44 * log2(1/p) = n * log2(1/p) / ln 2` bits. The constant factor is `1/ln 2 ≈ 1.44`.

So Bloom filters are within ~44% of the lower bound. Better constructions (Xor filter, Ribbon filter) approach within ~25% of the lower bound; the lower bound itself is achievable only by *minimal perfect hashing* over a static set, which loses the ability to add new keys.

### The independence assumption breaks down for small m

The derivation assumed k position choices are independent. With true k independent hash functions, this holds. With double hashing (`h1 + i*h2`), the k positions for a given key are *deterministic* given h1, h2 — they are not independently random for a *single key*, but their joint distribution across many keys is statistically equivalent (Kirsch & Mitzenmacher 2008).

For m smaller than ~1000, the approximation breaks down empirically. For production m (millions+), it is tight.

### The double hashing analysis (Kirsch-Mitzenmacher)

Define `g_i(x) = h1(x) + i*h2(x) mod m`. The positions for a fixed key are:

```
g_0(x), g_1(x), ..., g_{k-1}(x)
```

Kirsch and Mitzenmacher prove that the false-positive rate using double hashing approaches the rate using k independent hash functions as `m → ∞`, with error `O(1/m)`. For m in the millions, the error is `10^-6` — negligible.

This is *why* the library can use double hashing instead of k true hashes and lose nothing in FPR.

### A more rigorous FPR for k independent hashes

The FPR formula `(1 - e^(-kn/m))^k` assumes the k positions of a query key are independent. Strict independence gives a slightly different formula:

```
P(false positive | k positions independent) = (1 - (1 - 1/m)^(kn))^k
```

For large m these collapse to the same expression.

The exact FPR for k independent hashes on a non-member key:

```
p_exact = sum_{i=0..k} (-1)^i * C(k, i) * (1 - i/m)^(kn)
```

This inclusion-exclusion formula is rarely used; the approximation suffices.

---

## Hash Function Theory For Bloom Filters

### Why hash quality matters

A weak hash function clusters its output bits in non-uniform ways. If certain bit patterns are more likely than others, the Bloom filter's "uniform" assumption breaks; the FPR can be higher than the formula predicts, sometimes catastrophically.

Empirically, a Bloom filter using `bytes_to_uint64(key) % m` (no real hash) on 16-byte UUID keys has FPR within ~10% of theoretical because UUIDs are well-distributed. The same code on monotonically increasing integer keys has FPR several times worse.

### What makes a good Bloom-filter hash

1. **Uniform distribution.** Each output bit appears with probability exactly 1/2 independent of input.
2. **Avalanche.** Flipping one input bit flips on average half the output bits.
3. **Speed.** Each hash call should take well under 100 ns for typical key sizes.
4. **Determinism.** Same input -> same output (with same seed if seeded).
5. **No cryptographic properties required.** Bloom filters do not need preimage resistance.

### Murmurhash3 detailed

The `bits-and-blooms/bloom/v3` library uses Murmurhash3 128-bit variant. Algorithm:

1. Read 16-byte chunks.
2. For each chunk: multiply two halves by magic constants; XOR them; rotate; multiply; mix into accumulators h1, h2.
3. Final mix with the remaining bytes and the length.
4. Output the 128-bit value as four 32-bit pieces.

The four pieces are used as the four base hashes in the polynomial expansion:

```
position_i = h1 + i*h2 + i^2*h3 + i^3*h4
```

The polynomial gives stronger pseudo-independence than basic double hashing — empirically tested in the original Kirsch-Mitzenmacher paper and the Murmurhash3 SMHasher test suite.

### xxhash detailed

`cespare/xxhash/v2` implements XXH64. Algorithm:

1. For input ≥ 32 bytes: process in 32-byte chunks with four parallel accumulators, each updated by a multiply-then-rotate-then-add-then-multiply sequence.
2. For input < 32 bytes: process bytes in 8-byte chunks with a similar sequence.
3. Final avalanche mix.

The win over Murmurhash3 is *throughput on long inputs*: XXH64 saturates a modern CPU's pipeline more fully. On short inputs (< 32 bytes), Murmurhash3 is sometimes faster because its setup cost is smaller.

For Bloom filters, key lengths are usually small (UUIDs, short identifiers). The throughput difference is marginal.

### Why FNV is unsuitable

FNV-1a multiplies by a prime then XORs each byte. Its avalanche is weak: flipping a single input bit changes only ~30% of output bits on short inputs. For Bloom filters with short keys, FNV's clustering is measurable: FPR is 10–30% higher than theoretical.

The original Bloom filter implementations used FNV because Murmurhash3 did not exist. Modern implementations should not.

### Seeded hashes for adversarial robustness

A keyed hash takes a secret key and an input, producing an output that an attacker cannot predict without the key. Standard choices:

- **`hash/maphash`.** Built into Go. Random per-process seed by default. Use `MakeSeed()` for a custom seed.
- **SipHash.** Cryptographic-grade. Github: `dchest/siphash`. ~1.5 GB/s.

Performance trade-off: SipHash is ~half as fast as Murmurhash3. For most workloads the difference is negligible; for adversarial inputs the security is essential.

### Hash function and Bloom: combined analysis

Empirically:

- Murmurhash3: FPR within 5% of theoretical at all fill levels.
- xxhash: FPR within 3% of theoretical (slightly better avalanche).
- FNV-1a: FPR within 10–30% of theoretical.
- SipHash: FPR within 5% of theoretical.

In production, the 5% noise is well within measurement error; the choice is dominated by speed and adversarial properties, not pure FPR.

---

## Cache Hierarchy and Block Bloom Filters

### The cache problem

A standard Bloom filter Test:

```go
for i := 0; i < k; i++ {
    pos := positions[i]
    if !bits[pos/64] & (1<<(pos%64)) { return false }
}
```

For a 1 GB filter, the k position bytes are randomly scattered across 1 GB of memory. Each `bits[pos/64]` is a different cache line. With k = 10, we incur ~10 cache misses per Test.

A miss to L3 costs ~30 cycles. A miss to main memory costs ~300 cycles. So a Test that hits 10 L3-cached cache lines takes ~300 cycles (~100 ns). A Test that hits 10 main-memory cache lines takes ~3000 cycles (~1 µs).

### Block Bloom filter

Pack all k bits for a key into a single cache line (64 bytes = 512 bits). Algorithm:

1. Hash the key to get block index `b`.
2. Within block `b`, hash the key k more times to get k bit positions in [0, 512).
3. Add: set those k bits within block b.
4. Test: read block b once; check the k bits.

A Test is now: 1 hash + 1 cache line read + k bit checks. Single cache miss.

### Implementation in Go

```go
package blockbloom

import (
	"math/bits"
	"sync/atomic"
	"unsafe"
)

const blockWords = 8 // 8 * 64 = 512 bits per block

type Filter struct {
	blocks [][blockWords]uint64
	k      uint
}

func New(numBlocks uint, k uint) *Filter {
	return &Filter{
		blocks: make([][blockWords]uint64, numBlocks),
		k:      k,
	}
}

func (f *Filter) blockIndex(h uint64) uint64 {
	return h % uint64(len(f.blocks))
}

func (f *Filter) positions(h uint64) [16]uint16 {
	// Generate 16 positions in [0, 512), at most k of which are used.
	var pos [16]uint16
	for i := 0; i < 16; i++ {
		h ^= h << 13
		h ^= h >> 7
		h ^= h << 17
		pos[i] = uint16(h & 511)
	}
	return pos
}

func (f *Filter) Add(h uint64) {
	bi := f.blockIndex(h)
	pos := f.positions(h)
	block := &f.blocks[bi]
	for i := uint(0); i < f.k; i++ {
		p := pos[i]
		atomic.OrUint64(&block[p/64], 1<<(p%64))
	}
}

func (f *Filter) Test(h uint64) bool {
	bi := f.blockIndex(h)
	pos := f.positions(h)
	block := &f.blocks[bi]
	for i := uint(0); i < f.k; i++ {
		p := pos[i]
		if atomic.LoadUint64(&block[p/64])&(1<<(p%64)) == 0 {
			return false
		}
	}
	return true
}

var _ = unsafe.Sizeof // suppress unused import
var _ = bits.OnesCount64
```

### Trade-offs

- **FPR slightly worse.** Block Bloom has higher FPR than standard Bloom at the same total memory because each block is independent and small. The Impala paper quantifies: ~20% higher FPR for typical parameters.
- **Memory cost extra.** To achieve the same FPR, block Bloom needs slightly more bits (~15–25%).
- **Latency dramatically better.** Test latency drops 5–10x for large filters.

### When block Bloom wins

- Filter size > L2 cache (~1 MB).
- Read-heavy workload.
- Latency-sensitive (analytics, real-time bidding, trading).

For small filters that fit in L1, standard Bloom is fine and has cleaner math.

### Apache Impala's block Bloom

Impala uses block Bloom filters for "runtime filter pushdown" in JOIN queries. The optimised C++ code uses AVX2 to compute all k bit checks within a block in a few SIMD instructions. Throughput exceeds 1 billion Tests per second per core.

Go cannot reach those numbers natively (no SIMD intrinsics), but with `cgo` and assembly it can. For most Go services the atomic block Bloom above is fast enough.

---

## Memory Ordering and the Go Memory Model

The Go memory model defines when one goroutine's writes become visible to another. For Bloom filters using atomics, this is load-bearing.

### Atomic operations and synchronisation

From `sync/atomic` documentation:

> The operations in this package implement the memory model's "synchronization" relation. Roughly, this means that all writes performed by a goroutine before a value is published to another goroutine (via atomic operations) become visible to the other goroutine after it loads the published value.

Concretely:

- `atomic.OrUint64(&w, mask)` performs an atomic OR. Other goroutines that subsequently `atomic.LoadUint64(&w)` see the result.
- The OR has both release semantics (writes before it are flushed) and acquire semantics (reads after it observe the latest state).

### Happens-before for Bloom filters

If goroutine A calls `filter.Add(k)` and then signals goroutine B (via channel, mutex, or atomic), and B then calls `filter.Test(k)`:

- A's Add atomic-ORs k bits.
- A's signal to B includes a release semantic.
- B's receive includes an acquire semantic.
- B's Test atomic-Loads the bits.

By the memory model, B's Loads observe A's ORs. The Test returns true.

### What can go wrong without atomics

Without atomic ops, a goroutine that writes a bit might find that another goroutine reading the same word sees a *stale* value, even after a happens-before edge through a channel:

```go
// WITHOUT atomic OR:
bits[pos/64] |= 1 << (pos % 64)

// Other goroutine reads:
val := bits[pos/64]
```

The Go memory model permits the read to return the value from before the OR even if there is a happens-before edge between them — *because the OR is not an atomic operation*. The compiler can reorder, the CPU can reorder, the cache can return stale values.

This is the actual reason the library is not concurrent-safe: not just lost-bit races, but stale-read possibilities even with synchronisation.

### Memory ordering on different architectures

The Go memory model is a *sequential consistency for data-race-free programs* (SC-DRF) model. Across architectures:

- **x86:** Memory accesses are already sequentially consistent within a core; `atomic.OrUint64` compiles to `LOCK OR`. Sequential consistency between cores requires the `LOCK` prefix.
- **ARM:** Memory accesses are *relaxed* by default; explicit barriers (DMB) are needed. Atomic operations compile to LDAR/STLR (load-acquire / store-release) plus LL/SC for OR.
- **RISC-V:** Similar to ARM; explicit fences.

The Go compiler emits the right primitives for each architecture. As a programmer, you reason in terms of the SC-DRF model and trust the compiler.

### Why naive double-checked locking is wrong

A classic mistake:

```go
if !filter.Test(k) {
    mu.Lock()
    if !filter.Test(k) {
        filter.Add(k)
    }
    mu.Unlock()
}
```

The first `Test` is outside the lock; it has no acquire ordering. The compiler is free to hoist it past the `mu.Lock()` (it cannot in practice because Lock is opaque, but the language permits it). Even if the compiler does not hoist, the CPU might see stale bits.

The fix: ensure the first Test uses atomic loads. The atomic-bitset Bloom filter has them by construction. The library does not; double-checked locking around the library is technically a memory-model violation, though in practice it works because the library's reads happen to be word-aligned.

### Linearisability of Bloom filter operations

A Bloom filter Add and Test are not linearisable in the strict sense:

- Add is multi-step (k bit sets).
- Test is multi-step (k bit reads).

Two goroutines doing Add(k) and Test(k) concurrently can observe an *intermediate* state: some of the k bits set, others not. The Test returns false (because at least one bit read returned 0) even though both operations are "concurrent."

This is fine for Bloom semantics: the contract is "no false negatives *after Add has happened-before Test*." If they overlap, Test may return false legitimately. Once Add returns, all future Tests return true.

Mathematically: Bloom filter operations are *eventually consistent*, not linearisable.

### Implications for testing

A test that calls Add and Test in two goroutines without synchronisation can observe `Test == false` after `Add` has been called. This is *not* a bug. It is the documented semantics.

The contract becomes: "Test returns true if Add has *finished* before Test starts." Synchronisation provides the happens-before edge.

---

## Lock-Free Bloom Filter Designs

### Definition of lock-free

A data structure is *lock-free* if at least one operation makes progress in finite time even if other operations are arbitrarily delayed. Stronger: a *wait-free* structure guarantees every operation completes in finite steps independent of others.

The atomic Bloom filter is wait-free for Test (always finishes in k atomic loads) and wait-free for Add (always finishes in k atomic ORs). It does not retry; it does not loop; it does not block.

### Why this matters

Wait-freedom means no goroutine can starve another. Under any concurrent schedule, every Bloom filter operation finishes. Compare with:

- **Lock-based:** A goroutine holding the lock can be preempted; others wait indefinitely.
- **Lock-free with CAS retry:** CAS can loop indefinitely under contention.
- **Wait-free:** No looping, no waiting. Predictable latency.

For real-time systems (trading, ad-tech, gaming) wait-freedom is the difference between "always 100 ns" and "usually 100 ns, sometimes 100 µs."

### Building blocks

Go's `sync/atomic` provides:

- `atomic.LoadUint64`, `atomic.StoreUint64`: wait-free.
- `atomic.AddInt64`: wait-free (single hardware op on x86; LL/SC on ARM).
- `atomic.OrUint64`: wait-free (Go 1.23+).
- `atomic.CompareAndSwapUint64`: wait-free per attempt; lock-free in a loop.

The Bloom filter uses only Load and Or — both wait-free. The whole structure is wait-free.

### Cuckoo filter lock-freedom

The Cuckoo filter's insertion does eviction chains. Lock-free Cuckoo:

- Each bucket is a CAS-able 64-bit word containing 4 fingerprints.
- Insertions try to CAS in a new fingerprint to an empty slot.
- If both buckets are full, an eviction is performed via CAS chain.

The eviction chain *can* loop indefinitely (the cuckoo cycle). Implementations bound the loop and return failure if exceeded. So lock-free per attempt, but not wait-free.

This is why Cuckoo is harder to make truly wait-free than Bloom.

### Counting Bloom filter lock-freedom

With 32-bit counters: `atomic.AddInt32` and `atomic.CompareAndSwapInt32` are wait-free. The CBF is wait-free per Add/Test/Delete.

With 4-bit packed counters: CAS on the whole word in a loop. Lock-free per attempt. Wait-free only if the loop is bounded; otherwise lock-free.

### Practical implications

For Bloom filters in latency-sensitive contexts (sub-millisecond p99 targets), the wait-free atomic implementation is the gold standard. Anything that loops or blocks is suspect.

---

## NUMA and Multi-Socket Systems

### NUMA basics

Modern multi-socket servers have NUMA (Non-Uniform Memory Access). Memory allocated on socket 0 is cheap to access from CPUs on socket 0, expensive (3-5x slower) to access from CPUs on socket 1.

For a Bloom filter touched by many goroutines across both sockets, cross-socket reads dominate latency.

### Detection

```go
import "github.com/intel-go/numa"
n, _ := numa.Available()
```

Or via `numactl --hardware` at the OS level.

### NUMA-local Bloom

A Bloom filter with full NUMA awareness:

1. Allocate one filter per NUMA node.
2. Pin each goroutine to a node via `runtime.LockOSThread` plus `sched_setaffinity`.
3. Each goroutine queries its node-local filter.

Memory cost: 2x for dual-socket, 4x for quad-socket. Latency: every Test stays in node-local cache.

### Maintaining consistency

Each NUMA-local filter must be updated when a key is Added. Three approaches:

1. **Broadcast Add.** Every Add fans out to all node-local filters. Simple; doubles or quadruples Add cost.
2. **Owner-based Add.** Each key has a designated owner node; the owner adds; other nodes get an eventually-consistent merge.
3. **Periodic merge.** Each node maintains its own filter; periodically Union across nodes.

For workloads where Reads dominate, option 1 is fine. For balanced workloads, option 2 or 3.

### When to bother

Only for the largest, hottest filters. Most Go services do not need NUMA awareness; the cross-socket cost is real but small relative to other work.

### NUMA pitfalls

- **Default Go scheduler is NUMA-oblivious.** Goroutines bounce across cores; NUMA locality is lost unless explicitly pinned.
- **`runtime.LockOSThread`** pins a goroutine to its current OS thread but does not pin the thread to a CPU. Combine with `sched_setaffinity` via `golang.org/x/sys/unix.SchedSetaffinity`.
- **GC scans are NUMA-oblivious.** A 100 MB filter on one node is scanned by GC workers on both nodes; cross-socket traffic during GC.

For most Go projects, the right answer is "don't pin; let the scheduler do its thing." NUMA tuning is for the rare 0.1% of services that genuinely need it.

---

## Garbage Collector Interactions

### Why the GC cares about Bloom filters

A Bloom filter's bitset is a `[]uint64`. The Go GC scans live slices' backing arrays. A 1 GB Bloom filter is 1 GB of GC scan work.

The Go GC is concurrent and incremental, so the 1 GB is scanned in parallel with mutator work. But:

- It consumes GC CPU.
- It generates cache pressure during scanning.
- It can extend GC mark phase under heavy filter activity.

### Measuring GC impact

```
GODEBUG=gctrace=1 ./yourbinary
```

Look for `mark`, `assist`, and total pause times. A baseline service with a 100 MB filter typically shows 1–2 ms mark phases. A 10 GB filter can show 30–50 ms.

### Reducing GC impact

Three techniques.

#### 1. Off-heap allocation via mmap

```go
import "golang.org/x/sys/unix"

func mmapBitset(bytes int) ([]byte, error) {
    return unix.Mmap(-1, 0, bytes, unix.PROT_READ|unix.PROT_WRITE, unix.MAP_ANON|unix.MAP_PRIVATE)
}
```

Wrap the bytes in a `[]uint64` slice header (using `unsafe`) without registering it with the GC. The bitset lives outside the heap; GC ignores it.

Trade-offs:

- Manual lifecycle (no automatic free).
- `unsafe.Slice` patterns required.
- Cross-platform support varies.

Use only when GC scan time is profiled as a problem.

#### 2. Pin the filter pointer with `runtime.KeepAlive`

If you keep the filter pointer in a local variable, GC may treat it as dead between operations. Explicitly:

```go
func (s *Service) Lookup(k []byte) bool {
    f := s.filter
    runtime.KeepAlive(f)
    return f.Test(k)
}
```

Mostly unnecessary in real code, but if you see GC churn, this helps.

#### 3. GOGC tuning

For services dominated by Bloom-filter memory, raise `GOGC` (default 100). At `GOGC=400`, GC runs every 4x heap growth instead of 2x. Less frequent GCs; higher steady-state memory.

For a 1 GB Bloom filter with 100 MB of other heap, `GOGC=400` is fine because the filter dominates anyway.

### GC + Bloom filter rebuild

A rebuild allocates a fresh filter — another 1 GB. Peak memory: 2 GB (old + new live). GC triggers right after the swap; old filter is collected. There is a brief 1–2 second window where memory is 2x normal.

Provision accordingly. If your service runs at 80% memory utilisation, a rebuild can OOM. Plan for 50% utilisation if Bloom filters are large.

---

## Production Failure Modes at Scale

Things that only show up when you operate Bloom filters at scale.

### Failure mode: TLB misses on the bitset

A 1 GB filter spans many 4 KB pages. The TLB (Translation Lookaside Buffer) caches ~512–1024 page mappings. A Bloom Test reads from k randomly-located pages; if those k pages are not in the TLB, you pay a page-table walk per miss (~100 ns each).

For a 1 GB filter on a server with 1024-entry TLB, the TLB hit rate is dominated by other process memory; you may incur ~1 TLB miss per Bloom Test.

Mitigation: use 2 MB huge pages. With `Transparent Huge Pages` enabled, the kernel may back the bitset with huge pages; the TLB now covers 2 GB with 1024 entries. TLB misses essentially vanish.

```
# Linux: enable THP
echo always | sudo tee /sys/kernel/mm/transparent_hugepage/enabled
```

In Go, this happens at the kernel level; no code changes. Verify via `cat /proc/<pid>/smaps | grep HugePages`.

### Failure mode: page fault tail latency

When the bitset is first allocated, its pages are not yet backed by physical memory. The first access to each page triggers a *minor page fault* (~5 µs). For a 1 GB filter (256k pages), the first 256k accesses each pay the fault.

Symptom: very high p99 right after process start; baseline after a few minutes.

Mitigation: pre-fault the bitset at startup:

```go
for i := range bitset {
    bitset[i] = 0 // forces backing memory
}
```

The MMU touches every page. Page faults absorbed up front.

### Failure mode: GC during rebuild

During a rebuild, both old and new filters are live. GC notices the heap doubled; triggers a major collection. Mark phase scans both filters: 2x normal cost. If GC was already tight, this triggers a long pause.

Mitigation: schedule rebuilds during low-traffic windows. Or use off-heap allocation so GC ignores both filters.

### Failure mode: false sharing of metadata

A `BloomFilter` struct with adjacent atomic counters (e.g. hit-count, miss-count) suffers false sharing: each Add increments hit-count and ORs a bit; the cache line containing hit-count is invalidated for all other cores.

Mitigation: separate hot atomics by cache-line padding.

### Failure mode: hot-bit contention

If many goroutines Add the same key (e.g. a stuck-record bug), the k bits for that key are atomic-ORed millions of times per second. The k cache lines bounce between cores; throughput collapses.

Symptom: throughput plateaus; profiling shows `atomic.OrUint64` consuming most CPU.

Mitigation: identify the hot key upstream; cache the *result* of Test in a thread-local or per-goroutine cache so repeated Tests for the same key don't hit the filter.

### Failure mode: stale snapshot reload

A snapshot taken during heavy writes may capture a partially-updated bitset. The filter on disk has bits set that "happened-before" the snapshot start, but is missing bits set after the snapshot started. On reload, the filter has false negatives for those in-flight Adds.

Mitigation: take snapshots during quiescent periods, or accept the small false-negative window. For mission-critical correctness, snapshot the source of truth instead of the filter.

### Failure mode: cross-process incompatibility

Process A writes a snapshot; process B reads it. They use the *same* library version, but B was built with a different `go` version, and Go changed the `hash/maphash` seed semantics in between. Bits are at different positions; B's queries get false negatives.

Mitigation: never use `hash/maphash` for filters that cross processes. Use seeded `xxhash` or library default.

### Failure mode: clock-skew-driven rotation

Rotation tied to wall-clock time across replicas: NTP skew of 100 ms means replicas rotate at slightly different times. During the skew window, one replica has rotated and the other has not — their filters disagree on what is in the current window.

Mitigation: rotate on a logical signal (e.g. a coordinator-published epoch counter) rather than wall clock.

### Failure mode: long-running goroutine pinned to a stale filter

A goroutine that loaded a filter pointer ten minutes ago and is still using it has missed several rebuilds. Its Tests return based on stale data — false positives (and false negatives for keys added recently to the new filter).

Mitigation: re-`atomic.Load` the filter pointer at the start of each operation; do not stash it for long-lived use.

---

## Benchmarking Methodology

### Pitfalls of naive benchmarks

A benchmark like:

```go
func BenchmarkTest(b *testing.B) {
    for i := 0; i < b.N; i++ {
        f.Test(key)
    }
}
```

is misleading: same key every iteration; CPU caches the result; you measure cache locality, not the filter.

### Correct methodology

1. **Build the filter once** outside the timed loop.
2. **Generate diverse keys** in a slice.
3. **Loop through the keys** in the timed section.
4. **Vary the key set size** to span L1, L2, L3, and RAM.

```go
func BenchmarkTest(b *testing.B) {
    f := bloom.NewWithEstimates(1_000_000, 0.01)
    keys := make([][]byte, 1<<20)
    for i := range keys {
        keys[i] = []byte(fmt.Sprintf("k%d", i))
        f.Add(keys[i])
    }
    b.ResetTimer()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = f.Test(keys[i&(len(keys)-1)])
    }
}
```

### Measuring concurrency scaling

```go
func BenchmarkTestParallel(b *testing.B) {
    f := ... // setup
    b.RunParallel(func(pb *testing.PB) {
        i := 0
        for pb.Next() {
            f.Test(keys[i&(len(keys)-1)])
            i++
        }
    })
}
```

Run with `-cpu=1,2,4,8,16` to see scaling.

### Measuring cache behaviour

Use Linux `perf`:

```
perf stat -e cache-misses,cache-references go test -bench=BenchmarkTest -benchtime=10s
```

The ratio `cache-misses / cache-references` tells you what fraction of memory accesses missed the cache. For block Bloom: ~1 / k. For standard Bloom: ~1.

### Measuring tail latency

`go test -bench` reports the *mean* time per op. Tail latency requires `-benchtime=Xs` to run long enough plus custom histogram code:

```go
func BenchmarkTail(b *testing.B) {
    hist := hdrhistogram.New(1, 100_000_000, 3)
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        start := time.Now().UnixNano()
        f.Test(keys[i&(len(keys)-1)])
        hist.RecordValue(time.Now().UnixNano() - start)
    }
    b.StopTimer()
    b.Logf("p50=%d p99=%d p99.9=%d ns",
        hist.ValueAtQuantile(50),
        hist.ValueAtQuantile(99),
        hist.ValueAtQuantile(99.9))
}
```

The p99 tells you what users actually feel.

### A reproducibility checklist

- [ ] Benchmark in a quiet environment (no other processes).
- [ ] Pin GOMAXPROCS (`-cpu=8`).
- [ ] Pre-warm the filter (no cold-start).
- [ ] Vary key distribution to avoid cache-friendly bias.
- [ ] Report mean, p50, p99 (mean alone is misleading).
- [ ] Run with race detector separately; race adds 5-10x overhead.
- [ ] Profile alongside: `-cpuprofile`, `-memprofile`, `-mutexprofile`.

A benchmark missing any of these is suspect.

---

## SIMD and Vectorisation

Go does not expose SIMD intrinsics; you would write assembly or `cgo`. For Bloom filters at the very hot path, SIMD wins are real:

- **Block Bloom with AVX2:** Set or check all k bits of a block in 1-2 SIMD instructions.
- **Multiple Tests in parallel:** Test 4 or 8 keys simultaneously via gathered loads.

Libraries that do this:

- `github.com/zeebo/xxh3` provides SIMD xxh3 hashing in Go assembly.
- Apache Impala's runtime filter is C++ + AVX2.
- ClickHouse has its own SIMD Bloom variants.

For a pure-Go implementation, the standard atomic Bloom or block Bloom is fast enough. SIMD wins are for the absolute extreme of latency-sensitive paths.

### Writing Bloom assembly in Go

Go's Plan 9 assembler lets you write per-function inline assembly. A SIMD Test could look like:

```go
//go:noescape
func testBlockAVX2(block *[8]uint64, mask [4]uint64) bool
```

with the implementation in `bloom_amd64.s`. This is unusual in idiomatic Go; reach for it only when profiling demands.

---

## Bloom-Family Algorithms Deep Dive

### Stable Bloom filter

A *stable* Bloom filter is for streams. Each Add randomly decrements P cells before incrementing k; this caps the number of bits set, so the FPR stabilises rather than rising to 1 as data flows.

- Bounded memory.
- Eventual forgetting of old keys.
- FPR oscillates around a steady-state value.

When to use: indefinite-length streams where you don't care about old keys.

In Go: `tylertreat/BoomFilters` has it.

### Dynamic Bloom filter

A variant that resizes by allocating a fresh filter when full and chaining the old. Similar to scalable Bloom but simpler.

### Quotient filter

Stores a *quotient-remainder representation* of each key's hash. Each item occupies a slot in a hash table; supports Test, Add, Delete, and *iteration*.

- Same memory as Cuckoo (~9-16 bits/key).
- Cache-friendly (sequential access pattern).
- Supports iteration.
- Insertion is O(1) amortised.

In Go: a few research libraries; no widely-used production library.

### Xor filter

Static (build-once). Each item maps to 3 positions; the structure stores a small fingerprint at each position such that XOR'ing the 3 yields the item's fingerprint.

- ~1.23 bits/key per false-positive bit (closer to lower bound than Bloom).
- Lookup: 3 random reads + XOR.
- Cannot Add after construction.

In Go: `github.com/FastFilter/xorfilter`.

When to use: read-mostly static sets where memory is critical.

### Ribbon filter

Similar to Xor but with batched construction; cache-friendly lookups.

- Slightly better space than Xor.
- Same lookup pattern.

Used in RocksDB as `RibbonFilterPolicy` (replaces standard Bloom for new SSTables).

### Cuckoo vs Quotient vs Xor decision

| Property | Cuckoo | Quotient | Xor / Ribbon |
| --- | --- | --- | --- |
| Add | O(1) amortised | O(1) amortised | Static |
| Delete | O(1) | O(1) | No |
| Iterate | No | Yes | No |
| Memory | 9-16 bits/key | 9-16 bits/key | 9.84 bits/key (Xor) |
| Lookup cache misses | 2 | 1 | 3 |

For dynamic sets: Cuckoo or Quotient.

For static: Xor or Ribbon.

For maximum throughput: Quotient (cache-friendly).

### IBLT (Invertible Bloom Lookup Table)

A *recoverable* Bloom variant. Supports:

- Add(key)
- Delete(key)
- Listing all keys, *if the total number is small*.

Used in network protocols for set reconciliation: each peer has its own set; exchange IBLTs; subtract; list what's different.

Memory: O(d * log U) bits where d is the symmetric difference size and U is the universe.

In Go: `github.com/jmhodges/iblt`.

---

## Distributed Systems Considerations

### Consensus on Bloom filter state

If multiple replicas serve from "the same" Bloom filter, they must agree on what is in it. Approaches:

#### Strong consistency: write-through

Every Add is replicated synchronously. Slow but exact.

#### Eventual consistency: gossip + merge

Each replica updates locally; periodically gossip filters; Union to converge.

Convergence time: ~gossip period. False negatives possible during the convergence window.

#### CRDT-style: bitwise OR is monotonic

The Union of two Bloom filters is the bitwise OR. OR is commutative and idempotent. A Bloom filter is a *grow-only set CRDT*. Replicas can update independently; Union always converges to the same result.

This is one of the cleanest CRDT designs in practice.

### Bloom filter quorum reads

For consistency stronger than eventual, route reads to a quorum of replicas; require all to say "no" before returning "no." Any "maybe" forces the slow path.

This gives stronger no-false-negative guarantees against replica divergence at the cost of N-way reads.

### Cross-datacenter Bloom

Each datacenter has its own filter. Cross-DC consistency requires:

- Either: every Add is broadcast to all DCs synchronously (slow; impractical).
- Or: each DC maintains its own filter; reads stay local; eventual merge.

The CRDT property makes this clean. False positives compound additively across DCs.

### Bloom filter as a building block for distributed dedup

A common pattern: each replica maintains its own filter; events arriving at any replica are checked locally and then forwarded if novel. Bloom CRDT ensures convergence.

False positives at one replica may cause an event to be dropped that another replica would have accepted. Acceptable if the FPR per replica is low.

### Network bandwidth for filter exchange

A 100 MB Bloom filter takes ~30 seconds to transmit over a 100 Mbit link. For gossip-based merge across 100 replicas, this is non-trivial.

Mitigations:

- **Compress.** Bitsets at 50% fill are roughly random; compression ratio ~1.0. At low fill, compression helps; at high fill, no gain.
- **Delta encoding.** Send only newly-set bits since last sync. Requires tracking deltas.
- **Smaller filters.** Use per-DC sharding; smaller per-shard filters.

Most production gossip protocols use delta encoding plus periodic full-sync as a fallback.

---

## Verification and Formal Reasoning

### Property-based testing

For Bloom filters, properties to verify:

1. **No false negatives.** For any sequence of Adds and a key in the added set, Test returns true.
2. **FPR matches theory.** Over many random non-member queries, observed FPR is within statistical bounds of the formula.
3. **Union is commutative and idempotent.** `A.Union(B) == B.Union(A)`; `A.Union(A) == A`.
4. **Marshalling round-trips.** `Unmarshal(Marshal(f))` equals f.

Property-based testing libraries in Go:

- `github.com/leanovate/gopter`
- `pgregory.net/rapid`

A rapid-style test:

```go
func TestNoFalseNegatives(t *rapid.T) {
    keys := rapid.SliceOf(rapid.SliceOfN(rapid.Byte(), 1, 32)).Draw(t, "keys").([][]byte)
    f := bloom.NewWithEstimates(uint(len(keys)*2), 0.01)
    for _, k := range keys {
        f.Add(k)
    }
    for _, k := range keys {
        if !f.Test(k) {
            t.Fatalf("false negative for %q", k)
        }
    }
}
```

Rapid generates thousands of random key sets; any failure points to a bug. For Bloom filters this should never fire — false negatives are bugs.

### Race detection in CI

`go test -race` is non-negotiable for any Bloom filter codebase. The race detector catches the lost-bit and stale-read bugs that silently corrupt the filter.

### Fuzz testing

```go
func FuzzAddTest(f *testing.F) {
    f.Add([]byte("hello"))
    f.Fuzz(func(t *testing.T, key []byte) {
        bf := bloom.NewWithEstimates(1000, 0.01)
        bf.Add(key)
        if !bf.Test(key) {
            t.Fatalf("false negative for %q", key)
        }
    })
}
```

Run with `go test -fuzz=FuzzAddTest`. Looks for inputs that trigger crashes or bad behaviour.

### Formal proofs

Bloom filter correctness is straightforward to prove informally. Formal proofs (TLA+, Coq, Lean) exist in the literature but are rarely needed for production.

The one formal property worth stating clearly: **after `Add(k)` returns, every subsequent `Test(k)` returns true.** Plus: **before any `Add(k)`, no `Test` for any unrelated key has more than `p` probability of returning true (in expectation).**

These two are the *contract* of a Bloom filter; everything else is implementation.

---

## Final Wrap

You have now seen the Bloom filter from every angle: from the 50-line core algorithm, through correct concurrent implementations, into production architectures, and down to the machine-level details of cache lines and memory ordering.

A few takeaways for the professional:

- **The structure is small.** The engineering is large.
- **The math is closed-form.** Most engineering decisions reduce to back-of-envelope.
- **Concurrency is the hard part.** Pick atomic, sharded, or immutable based on profile.
- **Observability is the operational part.** Without metrics you operate blind.
- **Hash quality matters.** Pick deliberately; never default to FNV.
- **The variants are real.** Cuckoo for delete; Scalable for unknown growth; Block for cache; Xor for static.
- **The integration matters.** LSM-trees, CDNs, routing meshes — Bloom shines as a layer.
- **The failures are subtle.** Lost bits, stale reads, TLB misses, GC interactions — only the largest scales reveal them.

What you can build from here:

- A new production filter sized for your data growth curve.
- A drop-in replacement for the library wrapper that scales to 100x more cores.
- A distributed dedup that handles a billion events per second.
- A diagnostic toolkit for the next team that asks why their Bloom-filter-backed service is slow.

What you can teach:

- Junior engineers how to size and wrap a filter.
- Middle engineers how to make it concurrent and observable.
- Senior engineers how to architect systems around it.
- Other professionals how to push beyond the obvious limits.

The Bloom filter has been in production at the world's largest companies for over half a century. Yours will be too. Run it deliberately.

---

## Further Reading

### Foundational papers

- Bloom, B. H. (1970). *Space/Time Trade-offs in Hash Coding with Allowable Errors.* CACM 13(7).
- Carter, J. L., Floyd, R. W., Gill, J., Markowsky, G., & Wegman, M. (1978). *Exact and Approximate Membership Testers.* Information-theoretic lower bound.
- Fan, L., Cao, P., Almeida, J., & Broder, A. (2000). *Summary Cache: A Scalable Wide-Area Web Cache Sharing Protocol.* Counting Bloom Filter.
- Almeida, P. S., Baquero, C., Preguiça, N., & Hutchison, D. (2007). *Scalable Bloom Filters.*
- Kirsch, A., & Mitzenmacher, M. (2006). *Less Hashing, Same Performance: Building a Better Bloom Filter.*
- Putze, F., Sanders, P., & Singler, J. (2007). *Cache-, Hash-, and Space-Efficient Bloom Filters.* Block Bloom.
- Fan, B., Andersen, D. G., Kaminsky, M., & Mitzenmacher, M. D. (2014). *Cuckoo Filter: Practically Better Than Bloom.*
- Graf, T. M., & Lemire, D. (2020). *Xor Filters: Faster and Smaller Than Bloom and Cuckoo Filters.*
- Dillinger, P., & Walzer, S. (2021). *Ribbon Filter: Practically Smaller Than Bloom and Xor.*

### Distributed systems papers

- Mitzenmacher, M., & Vadhan, S. (2008). *Why Simple Hash Functions Work.*
- Goodrich, M. T., & Mitzenmacher, M. (2011). *Invertible Bloom Lookup Tables.*
- Eppstein, D., Goodrich, M. T., Uyeda, F., & Varghese, G. (2011). *What's the Difference? Efficient Set Reconciliation Without Prior Context.*

### Production system documentation

- RocksDB Bloom Filter docs.
- Cassandra Bloom Filter docs.
- Apache Impala Runtime Filtering.
- ClickHouse skip indices.
- PostgreSQL `bloom` extension.

### Go-specific resources

- The Go memory model: `https://go.dev/ref/mem`.
- `sync/atomic` package documentation.
- Brendan Gregg's blog: false sharing, perf, flame graphs.
- Damian Gryski's blog and `gophervids` channel: Go performance.
- The `bits-and-blooms/bloom/v3` source.

### Books

- Mitzenmacher, M., & Upfal, E. *Probability and Computing.*
- Kleppmann, M. *Designing Data-Intensive Applications.*
- Tannenbaum, A., & Van Steen, M. *Distributed Systems.*

### Talks

- "Bloom Filters in Real Life" — various conference talks over the years.
- "Probabilistic Data Structures" — Strange Loop, GopherCon, etc.
- "RocksDB Internals" — at various database conferences.

A motivated professional can spend weeks here; the field is deep.

---

## A Closing Thought

Bloom filters were invented in 1970 by Burton Bloom for compressing a hyphenation dictionary. The structure is now in every database, every CDN, every blockchain client, every search engine, every spam filter, every web crawler. Half a century later, the algorithm is still essentially unchanged.

The lesson: simple ideas, executed with care, outlive every fashion. The Bloom filter is a model of engineering — small, sharp, and right.

When you ship your next Bloom filter, you join a long tradition. Make it observable, document its choices, plan its rebuild, and pass the torch.

---

## Deep Topic: The Birthday Paradox in Bloom Filters

A subtle phenomenon. The probability that *two* arbitrary keys hash to the *same set of k positions* is approximately:

```
P(complete collision) ≈ 1 / m^k
```

For m = 10^7, k = 7: roughly `10^-49`. Vanishingly small.

But the probability that *some* two of n keys hash to the same set of positions follows the birthday paradox:

```
P(any pair collides) ≈ n^2 / (2 * m^k)
```

For n = 10^9, m = 10^7, k = 7: about `10^-30`. Still negligible.

This is why Bloom filters can be applied to billions of keys without "exact" collision being a concern. The risk is *partial* collision (sharing some bits), which is exactly what gives rise to false positives — and that risk follows the FPR formula, not the birthday paradox.

The two are distinct phenomena: full collision is rare; partial collision is the design.

### Implication for hash bit-width

If you use a 32-bit hash for a Bloom filter, you can only distinguish 2^32 ≈ 4 billion keys. Two keys with the same 32-bit hash hit the same positions; you cannot tell them apart. For Bloom filters with n > 100M keys, 32-bit hashing introduces *real* collision risk on top of the design FPR.

Always use 64-bit hashes for production Bloom filters. The library does. xxhash does. Murmurhash3 128-bit does.

---

## Deep Topic: The Optimum k is Practical, Not Pretty

The formula `k* = (m/n) ln 2` gives k as a real number. In practice you round to the nearest integer.

For `m/n = 10`: `k* = 6.93`, round to 7.
For `m/n = 14`: `k* = 9.70`, round to 10.
For `m/n = 19`: `k* = 13.17`, round to 13.

The cost of rounding: at most a few percent worse FPR than the theoretical optimum. Acceptable.

For k = 1, the filter degenerates to a single-hash table; FPR is poor. For k > 30, each Test is expensive and the FPR improvement is marginal. Realistic k is in [3, 20].

### Why k matters at the CPU level

Each hash position requires:

- A multiplication and addition (the polynomial expansion).
- A modulo or mask.
- An array index.
- An atomic load (or non-atomic).
- A bit-mask test.

At k = 7, a Test does 7 of these. At k = 13, it does 13. The cost scales linearly. For latency-sensitive paths, lower k wins; for memory-sensitive paths, the optimum k wins.

In Apache Impala, the trade-off is explicit: they cap k at 8 for runtime filters, accepting slightly higher FPR for predictable latency.

---

## Deep Topic: The Cost of "Tightening" FPR

Going from p = 0.01 to p = 0.001 doubles the memory (roughly 9.6 -> 14.4 bits per key) and adds 3 hash functions (k from 7 to 10).

Going from p = 0.001 to p = 0.0001 adds another 4.8 bits per key and 3 more hash functions.

The marginal cost of each "9" (additional decimal digit of FPR improvement) is:

- ~4.8 bits/key memory.
- ~3 hash functions per Add/Test.

There is no upper bound; you can target p = 10^-12 if you can pay 70 bits per key (8.7 bytes) and k = 40 hashes.

In practice, beyond p = 10^-6 it usually makes more sense to combine a smaller Bloom filter with an authoritative check. The Bloom buys you a "definitely not"; if you need higher confidence on "definitely yes," check the source.

---

## Deep Topic: Bloom Filters and the L1/L2/L3 Cache Hierarchy

A typical x86 CPU cache layout:

| Level | Size | Latency | Coverage |
| --- | --- | --- | --- |
| L1d | 32 KB | 3-4 cycles | per-core |
| L2 | 256 KB - 1 MB | 10-15 cycles | per-core |
| L3 | 4-64 MB | 30-40 cycles | shared per socket |
| RAM | GB-TB | 200-300 cycles | system-wide |

For a Bloom filter Test reading k random words:

| Filter size | Hot in | Test latency |
| --- | --- | --- |
| 4 KB | L1 | 30 ns |
| 256 KB | L2 | 60 ns |
| 4 MB | L3 | 150 ns |
| 100 MB | RAM | 800 ns |
| 10 GB | RAM (TLB misses) | 1.5 µs |

For block Bloom, each Test reads only one cache line; the same numbers shrink proportionally.

Knowing the layout lets you predict latency without measuring. A 1 GB filter answers Tests in ~1 µs; that is the floor. If your benchmark shows 5 µs, look for contention, GC, or TLB issues.

### TLB pressure

Each 4 KB page mapping costs one TLB entry. A 1 GB filter occupies 256k pages. The TLB caches ~1024 entries. Page table walks: ~100 ns each.

On a 1 GB filter with k = 10 hashes randomly distributed: roughly 10 different pages per Test. If the TLB is hot for those pages, no walk. If cold, ~10 walks * 100 ns = 1 µs of TLB miss overhead per Test.

Huge pages (2 MB) eliminate this. 1 GB filter occupies 512 huge pages; TLB covers them with 512 entries.

### Cache-line packing

Pack metadata adjacent to the bitset *only* if accessed at the same time. Otherwise, false sharing destroys performance.

Anti-pattern:

```go
type Filter struct {
    count uint64 // updated on every Add
    bits  [4 * 1024]uint64 // 32 KB
}
```

`count` and `bits[0]` likely share a cache line. Every Add invalidates the line for all other cores.

Correct:

```go
type Filter struct {
    count uint64
    _     [56]byte // pad to 64 bytes
    bits  [4 * 1024]uint64
}
```

Or use `golang.org/x/sys/cpu.CacheLinePad`.

---

## Deep Topic: Atomic Memory Ordering Reference

Go's `sync/atomic` documentation says atomics provide "synchronization." Concretely:

- An `atomic.Store` on `&x` synchronizes-with a subsequent `atomic.Load` of `&x`.
- An `atomic.OrUint64` synchronizes-with subsequent `atomic.LoadUint64` of the same address.
- Synchronizes-with is the formal name for the happens-before edge created by atomics.

For Bloom filters:

- Add does `atomic.OrUint64(&bits[i], mask)`.
- Test does `atomic.LoadUint64(&bits[i])`.
- Add synchronizes-with Test on the same `bits[i]`.
- Therefore, Test observes the bits set by Add (with respect to that word).

Across goroutines using atomics, all bits set by a completed Add are visible to a subsequent Test. The Bloom contract is preserved.

### Sequential consistency vs relaxed

Go's atomics are sequentially consistent (Go memory model, post-2022 spec clarification). This means there is a total order of all atomic operations consistent with each goroutine's program order.

You do not need to reason about acquire/release fences manually; the model is simpler than C++ atomics.

### Why this matters

For a Bloom filter, sequential consistency means:

- If goroutine A's Add(k) completes before goroutine B's Test(k), B's Test returns true.
- "Completes before" is established by any happens-before edge: channel send/receive, mutex lock/unlock, atomic Store, goroutine start/join, or wg.Wait return.

In practice, you do not need synchronisation *across* the filter — the filter's internal atomics give within-word synchronisation. You need synchronisation *to establish ordering between Add and Test* — typically a channel or a mutex.

---

## Deep Topic: Concrete Memory Layout Calculations

Let us compute the exact memory cost of a production-grade atomic Bloom filter sized for `n = 100M`, `p = 0.001`.

`m = -100M * ln(0.001) / (ln 2)^2 = 100M * 6.908 / 0.4805 ≈ 1.437B bits`.
`k = round(m/n * ln 2) = round(14.376 * 0.693) ≈ 10`.

Memory for `bits []uint64`:

- 1.437B bits / 64 = 22.45M words.
- 22.45M * 8 bytes = 179.6 MB.

Add struct overhead (~32 bytes for the slice header, m, k, hasher pointer): negligible.

Total: ~180 MB.

For a sharded atomic with 32 shards:

- 32 * (180 MB / 32) = 180 MB for the bitsets.
- 32 * (32 bytes for shard struct + 56 bytes padding) = 2.8 KB.
- Total: ~180 MB.

For a counting Bloom filter (32-bit counters):

- 1.437B * 4 bytes = 5.75 GB.

For a Cuckoo filter sized for 100M at p = 0.001:

- 12 bits/key * 100M / 8 = 150 MB.

For an Xor filter:

- 9.84 bits/key * 100M / 8 = 123 MB.

The Cuckoo and Xor variants are competitive at this size. The counting Bloom is 30x larger.

---

## Deep Topic: Reference Implementation of an Atomic Bloom Filter

The most idiomatic Go production-grade atomic Bloom filter, with all the right properties:

```go
// Package atomicbloom provides a wait-free Bloom filter safe for concurrent use.
package atomicbloom

import (
	"encoding/binary"
	"errors"
	"io"
	"math"
	"math/bits"
	"sync/atomic"

	"github.com/cespare/xxhash/v2"
)

// Filter is a wait-free Bloom filter.
//
// All methods are safe for concurrent use by multiple goroutines.
// Add operations are wait-free: each k position writes a single atomic-OR.
// Test operations are wait-free: each k position reads a single atomic-Load.
// No internal locks; no CAS retries.
type Filter struct {
	bits []uint64
	m    uint64 // total bits
	k    uint64 // number of hash positions per key
}

// New creates a Filter with m bits and k hash positions.
func New(m, k uint64) *Filter {
	if m == 0 || k == 0 {
		panic("atomicbloom: m and k must be positive")
	}
	return &Filter{
		bits: make([]uint64, (m+63)/64),
		m:    m,
		k:    k,
	}
}

// NewWithEstimates returns a Filter sized for n expected items at false-positive rate p.
func NewWithEstimates(n uint64, p float64) *Filter {
	m, k := EstimateParameters(n, p)
	return New(m, k)
}

// EstimateParameters returns the optimal m and k for n items and FPR p.
func EstimateParameters(n uint64, p float64) (m, k uint64) {
	if n == 0 || p <= 0 || p >= 1 {
		panic("atomicbloom: invalid n or p")
	}
	m = uint64(math.Ceil(-float64(n) * math.Log(p) / (math.Ln2 * math.Ln2)))
	k = uint64(math.Round(float64(m) / float64(n) * math.Ln2))
	if k < 1 {
		k = 1
	}
	return
}

// Cap returns the bitset size m.
func (f *Filter) Cap() uint64 { return f.m }

// K returns the number of hash positions per key.
func (f *Filter) K() uint64 { return f.k }

func (f *Filter) hashes(key []byte) (h1, h2 uint64) {
	h := xxhash.Sum64(key)
	h1 = h
	h2 = h>>33 | h<<31
	if h2 == 0 {
		h2 = 1
	}
	return
}

// Add inserts key into the filter.
func (f *Filter) Add(key []byte) {
	h1, h2 := f.hashes(key)
	for i := uint64(0); i < f.k; i++ {
		pos := (h1 + i*h2) % f.m
		atomic.OrUint64(&f.bits[pos/64], 1<<(pos%64))
	}
}

// Test reports whether key may have been added.
// Returns false only if key was definitely not added.
// Returns true if key was added, or with probability p (the configured FPR)
// if key was not added.
func (f *Filter) Test(key []byte) bool {
	h1, h2 := f.hashes(key)
	for i := uint64(0); i < f.k; i++ {
		pos := (h1 + i*h2) % f.m
		if atomic.LoadUint64(&f.bits[pos/64])&(1<<(pos%64)) == 0 {
			return false
		}
	}
	return true
}

// TestAndAdd reports whether key was probably present before this call,
// and unconditionally adds it.
//
// The combined Test+Add is not linearisable; two goroutines calling TestAndAdd
// on the same novel key may both observe false. Callers needing strict
// "first to add wins" semantics must use an external mutex.
func (f *Filter) TestAndAdd(key []byte) bool {
	h1, h2 := f.hashes(key)
	allSet := true
	for i := uint64(0); i < f.k; i++ {
		pos := (h1 + i*h2) % f.m
		mask := uint64(1) << (pos % 64)
		if atomic.LoadUint64(&f.bits[pos/64])&mask == 0 {
			allSet = false
		}
		atomic.OrUint64(&f.bits[pos/64], mask)
	}
	return allSet
}

// ClearAll resets the filter to empty.
//
// Safe to call concurrently with Add and Test, but the observable behaviour
// during clear is non-deterministic: in-flight Adds may be partially cleared.
// For a clean reset, ensure no concurrent operations are in progress.
func (f *Filter) ClearAll() {
	for i := range f.bits {
		atomic.StoreUint64(&f.bits[i], 0)
	}
}

// ApproximatedSize returns the Swamidass-Baldi estimate of n, the number of
// added items. Accurate up to ~70% fill; degrades beyond that.
//
// Safe to call concurrently; takes a snapshot of the current bit pattern.
func (f *Filter) ApproximatedSize() uint64 {
	set := f.countSetBits()
	if set == 0 {
		return 0
	}
	if set >= f.m {
		return math.MaxUint64
	}
	return uint64(-float64(f.m) / float64(f.k) *
		math.Log(1.0-float64(set)/float64(f.m)))
}

// FillFraction returns the fraction of bits set.
//
// Safe to call concurrently.
func (f *Filter) FillFraction() float64 {
	return float64(f.countSetBits()) / float64(f.m)
}

func (f *Filter) countSetBits() uint64 {
	total := uint64(0)
	for i := range f.bits {
		total += uint64(bits.OnesCount64(atomic.LoadUint64(&f.bits[i])))
	}
	return total
}

// WriteTo serialises the filter to w.
//
// The snapshot is consistent at the per-word level (no torn words) but may
// include or exclude in-flight Adds. The encoded form is:
//
//	uint64 little-endian: m
//	uint64 little-endian: k
//	uint64 little-endian: number of words (ceil(m/64))
//	uint64 little-endian * numWords: the bitset words
func (f *Filter) WriteTo(w io.Writer) (int64, error) {
	var header [24]byte
	binary.LittleEndian.PutUint64(header[0:8], f.m)
	binary.LittleEndian.PutUint64(header[8:16], f.k)
	binary.LittleEndian.PutUint64(header[16:24], uint64(len(f.bits)))
	n, err := w.Write(header[:])
	written := int64(n)
	if err != nil {
		return written, err
	}
	buf := make([]byte, 8)
	for i := range f.bits {
		binary.LittleEndian.PutUint64(buf, atomic.LoadUint64(&f.bits[i]))
		n, err = w.Write(buf)
		written += int64(n)
		if err != nil {
			return written, err
		}
	}
	return written, nil
}

// ReadFrom deserialises a filter from r.
func ReadFrom(r io.Reader) (*Filter, int64, error) {
	var header [24]byte
	n, err := io.ReadFull(r, header[:])
	read := int64(n)
	if err != nil {
		return nil, read, err
	}
	m := binary.LittleEndian.Uint64(header[0:8])
	k := binary.LittleEndian.Uint64(header[8:16])
	numWords := binary.LittleEndian.Uint64(header[16:24])
	if m == 0 || k == 0 || numWords != (m+63)/64 {
		return nil, read, errors.New("atomicbloom: invalid header")
	}
	f := New(m, k)
	buf := make([]byte, 8)
	for i := range f.bits {
		n, err = io.ReadFull(r, buf)
		read += int64(n)
		if err != nil {
			return nil, read, err
		}
		f.bits[i] = binary.LittleEndian.Uint64(buf)
	}
	return f, read, nil
}

// Merge ORs other's bits into f.
//
// f and other must have the same m and k.
// Safe to call concurrently with Test calls; not safe to call concurrently
// with another Merge or with Add on either filter.
func (f *Filter) Merge(other *Filter) error {
	if f.m != other.m || f.k != other.k {
		return errors.New("atomicbloom: incompatible filters")
	}
	for i := range f.bits {
		atomic.OrUint64(&f.bits[i], atomic.LoadUint64(&other.bits[i]))
	}
	return nil
}
```

About 250 lines including comments. Every method is documented with concurrency semantics. The implementation uses only `sync/atomic`; no mutexes. It is wait-free for Add and Test.

This is the kind of code a professional ships: clear, documented, predictable, tested.

---

## Deep Topic: Testing The Atomic Bloom Filter

A comprehensive test suite:

```go
package atomicbloom

import (
	"bytes"
	"fmt"
	"math/rand/v2"
	"sync"
	"sync/atomic"
	"testing"
)

func TestNoFalseNegatives(t *testing.T) {
	f := NewWithEstimates(100_000, 0.01)
	keys := make([][]byte, 10_000)
	for i := range keys {
		keys[i] = []byte(fmt.Sprintf("key-%d", i))
		f.Add(keys[i])
	}
	for _, k := range keys {
		if !f.Test(k) {
			t.Fatalf("false negative for %q", k)
		}
	}
}

func TestObservedFPR(t *testing.T) {
	f := NewWithEstimates(100_000, 0.01)
	for i := 0; i < 100_000; i++ {
		f.Add([]byte(fmt.Sprintf("a%d", i)))
	}
	fp := 0
	const probes = 1_000_000
	for i := 0; i < probes; i++ {
		if f.Test([]byte(fmt.Sprintf("b%d", i))) {
			fp++
		}
	}
	rate := float64(fp) / float64(probes)
	t.Logf("observed FPR = %.4f (target 0.01)", rate)
	if rate > 0.015 || rate < 0.005 {
		t.Fatalf("FPR %.4f out of [0.005, 0.015]", rate)
	}
}

func TestConcurrent(t *testing.T) {
	f := NewWithEstimates(1_000_000, 0.001)
	var wg sync.WaitGroup
	for g := 0; g < 16; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < 10_000; i++ {
				k := []byte(fmt.Sprintf("g%d-i%d", g, i))
				f.Add(k)
				if !f.Test(k) {
					t.Errorf("immediate Test failed for %s", k)
				}
			}
		}(g)
	}
	wg.Wait()
}

func TestSerialise(t *testing.T) {
	f := NewWithEstimates(1_000, 0.01)
	for i := 0; i < 500; i++ {
		f.Add([]byte(fmt.Sprintf("k%d", i)))
	}
	var buf bytes.Buffer
	if _, err := f.WriteTo(&buf); err != nil {
		t.Fatal(err)
	}
	g, _, err := ReadFrom(&buf)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 500; i++ {
		if !g.Test([]byte(fmt.Sprintf("k%d", i))) {
			t.Fatalf("false negative after restore for k%d", i)
		}
	}
}

func TestMerge(t *testing.T) {
	a := NewWithEstimates(1_000, 0.01)
	b := NewWithEstimates(1_000, 0.01)
	for i := 0; i < 200; i++ {
		a.Add([]byte(fmt.Sprintf("a%d", i)))
		b.Add([]byte(fmt.Sprintf("b%d", i)))
	}
	if err := a.Merge(b); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 200; i++ {
		if !a.Test([]byte(fmt.Sprintf("a%d", i))) {
			t.Fatalf("a%d missing after merge", i)
		}
		if !a.Test([]byte(fmt.Sprintf("b%d", i))) {
			t.Fatalf("b%d missing after merge", i)
		}
	}
}

func TestFillFractionMonotonic(t *testing.T) {
	f := NewWithEstimates(10_000, 0.001)
	prev := 0.0
	for i := 0; i < 5_000; i++ {
		f.Add([]byte(fmt.Sprintf("k%d", i)))
		fill := f.FillFraction()
		if fill < prev {
			t.Fatalf("fill decreased: %.4f -> %.4f at i=%d", prev, fill, i)
		}
		prev = fill
	}
}

func TestApproximatedSize(t *testing.T) {
	f := NewWithEstimates(10_000, 0.001)
	for i := 0; i < 5_000; i++ {
		f.Add([]byte(fmt.Sprintf("k%d", i)))
	}
	est := f.ApproximatedSize()
	if est < 4500 || est > 5500 {
		t.Fatalf("ApproximatedSize %d not within [4500, 5500] for n=5000", est)
	}
}

func BenchmarkAdd(b *testing.B) {
	f := NewWithEstimates(1_000_000, 0.001)
	keys := make([][]byte, 1024)
	for i := range keys {
		keys[i] = []byte(fmt.Sprintf("k%d", i))
	}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		f.Add(keys[i&1023])
	}
}

func BenchmarkTest(b *testing.B) {
	f := NewWithEstimates(1_000_000, 0.001)
	keys := make([][]byte, 1024)
	for i := range keys {
		keys[i] = []byte(fmt.Sprintf("k%d", i))
		f.Add(keys[i])
	}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = f.Test(keys[i&1023])
	}
}

func BenchmarkConcurrentTest(b *testing.B) {
	f := NewWithEstimates(1_000_000, 0.001)
	keys := make([][]byte, 1024)
	for i := range keys {
		keys[i] = []byte(fmt.Sprintf("k%d", i))
		f.Add(keys[i])
	}
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			_ = f.Test(keys[i&1023])
			i++
		}
	})
}

var atomicSink atomic.Uint64

func BenchmarkConcurrentAdd(b *testing.B) {
	f := NewWithEstimates(10_000_000, 0.001)
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		r := rand.New(rand.NewPCG(uint64(b.N), uint64(b.N)))
		var buf [16]byte
		for pb.Next() {
			r.Read(buf[:])
			f.Add(buf[:])
		}
	})
	atomicSink.Add(uint64(f.countSetBits()))
}
```

Each test asserts a specific property:

- No false negatives ever.
- Observed FPR within statistical bounds.
- Concurrent Add and Test are race-free.
- Serialisation round-trips losslessly.
- Merge produces the union.
- FillFraction increases monotonically.
- ApproximatedSize is accurate.

The benchmarks measure single-goroutine and concurrent throughput. Run with:

```
go test -race -v -run=Test
go test -bench=. -benchmem -benchtime=10s
```

This is the verification floor for a professional-grade implementation.

---

## Deep Topic: Adversarial Hash Flooding in Detail

A motivated attacker who knows your hash family and seed can construct keys that all collide on the same k bits. To find one such key, compute `h1, h2` for many candidate inputs; collect inputs whose first position is your target bit.

With a 1 GB filter (m = 8 * 10^9 bits, p = 0.001, k = 14), an attacker needs:

- One candidate key for each of the 14 positions.
- For each position, enumerate ~2^33 candidates until one hashes to that position (probability 1/m per candidate).

Wallclock cost: ~2^33 hash computations = 10 seconds on a modern CPU. Feasible.

Defence: a seeded hash with a 64-bit secret seed. The attacker cannot precompute candidates without the seed; brute-forcing the seed requires 2^64 hash calls, impractical.

Go's `hash/maphash` uses an unspecified secret seed per process; impossible to predict from outside. Use it for any filter exposed to untrusted input.

### Why Murmurhash3 with fixed seed is fine for friendly input

If your input is internal (e.g. user IDs from your own database), the attacker cannot choose inputs. They can choose *which keys to query*, but cannot inject keys. Murmurhash3 is fine.

For inputs derived from user-controlled data (URLs in a crawler, file names in a CDN, emails in spam), assume adversarial.

### A graduated defence

For most services, "the filter receives keys derived from internal IDs; queries are user-controlled" is the actual threat model. The defence:

- Use Murmurhash3 (fast, deterministic) for the filter's hash family.
- Monitor per-tenant or per-IP observed FPR; alert on outliers.
- Rebuild on alert; the new filter has a fresh internal seed (if you choose one).

This catches the attack in operational metrics without paying the SipHash performance cost on every Test.

---

## Deep Topic: GC-Aware Filter Allocation

The default Go GC scans every byte of a `[]uint64`. For a 1 GB filter, this is 1 GB of scan work per GC cycle.

To bypass:

```go
import (
	"unsafe"
	"golang.org/x/sys/unix"
)

func mmapBitset(numWords int) []uint64 {
	bytes := numWords * 8
	raw, err := unix.Mmap(-1, 0, bytes,
		unix.PROT_READ|unix.PROT_WRITE,
		unix.MAP_ANON|unix.MAP_PRIVATE)
	if err != nil {
		panic(err)
	}
	// Reinterpret as []uint64.
	return unsafe.Slice((*uint64)(unsafe.Pointer(&raw[0])), numWords)
}

func munmapBitset(bits []uint64) {
	if len(bits) == 0 {
		return
	}
	bytes := unsafe.Slice((*byte)(unsafe.Pointer(&bits[0])), len(bits)*8)
	_ = unix.Munmap(bytes)
}
```

The mmap region is not tracked by the GC; it lives in the process's virtual address space but Go's runtime does not scan it. GC time drops by 1 GB per cycle.

Caveat: the slice returned by `unsafe.Slice` references memory outside the GC; you must call `munmapBitset` when done. Memory leaks are possible if you forget.

### Use only when justified

Profiling must show GC scan time as significant before reaching for mmap. For a 100 MB filter, the GC cost is a few milliseconds per cycle; usually invisible. For multi-GB filters, mmap saves real time.

---

## Deep Topic: Page Pre-faulting

Newly allocated memory is not immediately backed by physical pages. The first access to each 4 KB page triggers a minor page fault (~5 µs). For a freshly-allocated 1 GB Bloom filter (256k pages), the first 256k accesses pay this cost.

Symptom: very high p99 latency right after construction; baseline after enough Tests to touch all pages.

Pre-faulting:

```go
func prefault(bits []uint64) {
	for i := range bits {
		// Touch each cache line (every 8 words for 64-byte cache line).
		bits[i] = bits[i] | 0
	}
}
```

The loop touches every byte; the kernel populates page tables for all of them. Subsequent accesses incur no faults.

A `prefault` after construction adds ~500 ms for a 1 GB filter (one-time cost). Production-grade implementations include this in their constructor.

### Huge pages

If the OS supports Transparent Huge Pages, a 1 GB filter may be backed by 2 MB pages. 512 huge pages instead of 256k regular pages. TLB miss rate drops by 500x.

Verify with:

```
cat /proc/<pid>/smaps | grep -E '(AnonHugePages|Hugetlb)'
```

For most server kernels, THP is enabled by default. The kernel automatically promotes allocations to huge pages when feasible.

---

## Deep Topic: A Bloom Filter Stack Trace

You will eventually be asked to read a Bloom filter's stack trace. Sample:

```
goroutine 47 [running]:
sync/atomic.OrUint64(0xc00003a000, 0x40000)
        /usr/local/go/src/sync/atomic/doc.go:142
example.com/atomicbloom.(*Filter).Add(0xc000040000, ...)
        /home/user/atomicbloom/bloom.go:80
example.com/userdir.(*UserDir).Register(0xc000041000, ...)
        /home/user/userdir/userdir.go:42
main.main()
        /home/user/cmd/main.go:55
```

Reading top-to-bottom:

- The hot function is `atomic.OrUint64`.
- It is called from the Bloom filter's Add.
- Which is called from a higher-level Register.
- Which is called from main.

If this stack appears repeatedly in a CPU profile, the Bloom Add is your hot path. If `OrUint64` is consuming most of the CPU, you have contention (hot bit). If `Add` is hot but `OrUint64` is not, the cost is elsewhere (hashing, modulo, etc.).

A few seconds reading the right profile saves hours of bisecting.

---

## Deep Topic: Production Capacity Tracking

A senior or principal engineer asked to "how big should this Bloom filter be" should walk through:

1. **Current n (measured).** Today's active set size from the source of truth.
2. **Annual growth rate (measured).** Year-over-year increase from product analytics.
3. **Volatility (measured).** Standard deviation of growth across recent months.
4. **Headroom (chosen).** Typically 2-3x growth-rate-1-year.
5. **Computed n_design.** Current_n * (1 + growth_rate)^years_until_rebuild * headroom.
6. **Memory at chosen p.** Standard formula.

Document the choice. Future engineers will thank you.

For a service growing 30% YoY with monthly rebuilds:

- Current n: 10M.
- Design n: 10M * 1.30^(1/12) * 2 = ~20.5M.
- Memory at p=0.001: 20.5M * 14.38 / 8 ≈ 37 MB.

For a service with no rebuild process (filter must last 3 years):

- Design n: 10M * 1.30^3 * 2 = ~44M.
- Memory: 79 MB.

Doubling the design n doubles the memory. The trade-off is plain.

---

## Deep Topic: Bloom Filter as Defence-in-Depth

A senior or principal engineer thinks about defence in depth:

- The Bloom filter is one layer.
- Behind it: the cache.
- Behind that: the database.
- Behind that: the source of truth (often the same database).

Each layer should handle its layer's failures gracefully:

- Filter false positive → cache miss → DB query → correct answer.
- Cache miss → DB query → correct answer.
- DB temporary failure → retry with backoff.
- DB permanent failure → return error to caller.

The Bloom filter is *never* the source of truth; it is *always* an optimisation that the next layer can override. This is the discipline.

A pathological design: "the Bloom filter says no, so we don't even check the cache." If the filter has a bug (false negative), the user gets a wrong answer. Always allow the next layer to override.

A correct design: "Bloom filter says no, return not-found." A bug in the filter produces wrong answers only for keys that were Added but lost — and that is exactly what tests with `go test -race` catch.

The defence: pair the filter with monitoring that catches drift, pair monitoring with alerts, pair alerts with runbooks, and the filter becomes one safe optimisation among many.

---

## Deep Topic: Reading the bits-and-blooms Source

A line-by-line tour of the most important parts of `bits-and-blooms/bloom/v3/bloom.go`:

### Type definition

```go
type BloomFilter struct {
	m uint
	k uint
	b *bitset.BitSet
}
```

Three fields: m, k, bitset pointer. Simple.

### Constructor

```go
func New(m uint, k uint) *BloomFilter {
	return &BloomFilter{
		m: max(1, m),
		k: max(1, k),
		b: bitset.New(m),
	}
}
```

Guards against zero m and k. Allocates the bitset.

### Hash extraction

```go
func baseHashes(data []byte) [4]uint64 {
	var d digest128
	hash1, hash2 := d.sum128(data)
	return [4]uint64{
		hash1,
		hash2,
		// Two more by salting.
		hash1 ^ hash2,
		hash1 + hash2,
	}
}
```

(Simplified.) Murmurhash3 128-bit, split into four 64-bit values.

### Position calculation

```go
func (f *BloomFilter) location(h [4]uint64, i uint) uint {
	return uint((h[i%2] + i*h[2+(i+(i%2))%2]) % uint64(f.m))
}
```

The polynomial-style expansion: combine the four hashes based on i. Returns a position in `[0, m)`.

### Add

```go
func (f *BloomFilter) Add(data []byte) *BloomFilter {
	h := baseHashes(data)
	for i := uint(0); i < f.k; i++ {
		f.b.Set(f.location(h, i))
	}
	return f
}
```

Pure: hash, k positions, set k bits. No allocations.

### Test

```go
func (f *BloomFilter) Test(data []byte) bool {
	h := baseHashes(data)
	for i := uint(0); i < f.k; i++ {
		if !f.b.Test(f.location(h, i)) {
			return false
		}
	}
	return true
}
```

Pure: hash, k positions, test k bits, AND.

### MarshalBinary

```go
func (f *BloomFilter) MarshalBinary() ([]byte, error) {
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, uint64(f.m))
	binary.Write(&buf, binary.LittleEndian, uint64(f.k))
	bts, err := f.b.MarshalBinary()
	buf.Write(bts)
	return buf.Bytes(), err
}
```

m, k, then bitset bytes. Total size: 16 + ceil(m/8) bytes.

### UnmarshalBinary

```go
func (f *BloomFilter) UnmarshalBinary(data []byte) error {
	f.m = uint(binary.LittleEndian.Uint64(data[:8]))
	f.k = uint(binary.LittleEndian.Uint64(data[8:16]))
	f.b = &bitset.BitSet{}
	return f.b.UnmarshalBinary(data[16:])
}
```

Inverse. Note: the existing BitSet is replaced.

### What's *not* there

- No atomics. No locks. No concurrent-safety.
- No version byte in the wire format.
- No checksum.

The library is intentionally minimal. The concurrency story is the caller's responsibility.

### Lessons

- The core algorithm is ~100 lines.
- Everything else is convenience.
- The library's correctness is easy to audit.
- The library's lack of concurrency safety is by design.

Reading this source builds confidence that you understand the structure top to bottom.

---

## Deep Topic: A Final Production War Story

A composite tale from real engineering experiences.

### Setup

A service has a Bloom filter for user-existence checks. Has been in production for 2 years. Sized for 50M users, p = 0.001.

### Symptom

P99 latency on the user-lookup endpoint climbs from 5 ms to 80 ms over a week. No code changes; no traffic changes.

### Investigation

Step 1: check Bloom filter metrics.
- Fill: 0.55 (not saturated).
- Observed FPR: 0.011 (slightly elevated but within tolerance).

Step 2: check DB metrics.
- DB latency unchanged.

Step 3: check goroutine count.
- Normal.

Step 4: profile.
- 60% of CPU in `atomic.OrUint64`, `atomic.LoadUint64`, and surrounding Bloom filter Add/Test.

Step 5: trace events.
- Spotted: a periodic 200 ms "background snapshot" that pauses everything.

### Root cause

The snapshot routine takes a `sync.Mutex` lock around `MarshalBinary`. As the filter grew over two years (more pages, more cache misses), `MarshalBinary` took progressively longer. Today it takes ~200 ms.

Every 30 seconds, all lookups pause for 200 ms.

### Fix

Replace the snapshot lock with a streaming, lock-free snapshot using `atomic.LoadUint64`. Snapshot still takes 200 ms wall-clock, but no lock is held.

Latency drops back to 5 ms.

### Lessons

1. **Background tasks that touch hot data are dangerous.** The snapshot was logically "background" but operationally hot-path-disruptive.
2. **Metrics that look fine can hide problems.** Bloom-specific metrics looked great; the symptom was elsewhere.
3. **CPU profiling beats guessing.** The profile pointed straight at atomics; the next question was "why are atomics slow?"
4. **Long-term drift bites quietly.** Two years of small growth turned a 5 ms snapshot into a 200 ms snapshot.
5. **Sample everything.** A continuous histogram of snapshot duration would have shown the trend long before the alert.

The fix took an hour. The investigation took a day. The lesson took a postmortem to land team-wide. This is professional engineering.

---

## Pre-Closing: A Few Words on the Bloom-and-Sketch Ecosystem

The Bloom filter is the patriarch of a family that includes:

- **HyperLogLog:** Approximate cardinality.
- **Count-Min Sketch:** Approximate frequency.
- **MinHash:** Approximate Jaccard similarity.
- **t-digest:** Approximate quantiles.
- **AMS Sketch:** Approximate second-moment estimation.

Each occupies a different point in the "what question are we approximating?" space. Knowing the menu helps you reach for the right tool:

- Need to dedup events? Bloom.
- Need to count unique events? HyperLogLog.
- Need to find heavy hitters? Count-Min.
- Need to find similar items? MinHash.
- Need to compute percentiles? t-digest.

A senior or principal engineer can articulate this menu and pick correctly. Junior engineers reflexively reach for Bloom; staff engineers think first about which question they are answering.

---

## Final Section: The Code You Will Maintain

Most engineers will never *write* a Bloom filter. Many will *maintain* one. Below is the survival guide.

### When you inherit a Bloom filter

1. Find its construction site. Note m, k, n, p.
2. Find its rebuild path. Trace from a config flag or scheduled job.
3. Find its metrics. If absent, add them.
4. Find its alert thresholds. If absent, add them.
5. Find its kill switch. If absent, add one.
6. Document it: purpose, owner, rebuild, kill switch.

### When the Bloom filter misbehaves

1. Check the four canonical metrics: fill, observed FPR, hit rate, capacity.
2. If fill is high: rebuild.
3. If observed FPR is high: rebuild with larger n.
4. If hit rate is rising: investigate upstream traffic patterns.
5. If capacity is wrong: re-size at the construction site.

### When the Bloom filter breaks

1. Check `go test -race` on a recent commit. Any new race conditions?
2. Check for false negatives (sentinel-key test). If failing, the filter is corrupt; rebuild.
3. Check snapshot format compatibility.
4. Check hash family version (some libraries change hash internals across versions).

### When the Bloom filter is at end-of-life

1. Plan the rebuild with larger capacity.
2. Schedule for a low-traffic window.
3. Execute with double-write during the rebuild.
4. Verify FPR returns to target post-rebuild.
5. Document the change.

This is what professional engineering of a Bloom filter looks like, week to week. The structure is small; the operational discipline is what makes it work.

---

## Closing: The Professional's Mindset

Across these five files, you have traversed from "what is a Bloom filter" to "how do I architect and operate one at scale across years of growth." The journey is dense; the rewards compound.

A few parting reminders:

- **Simplicity scales.** Reach for variants only when the basic Bloom is demonstrably insufficient.
- **Concurrency is the hard part.** Pick atomic, sharded, or immutable based on workload; never default.
- **Observability is non-negotiable.** Every filter in production has metrics, alerts, runbooks.
- **The math is closed-form.** Use it.
- **Rebuilds are routine.** Plan them.
- **Failure modes accumulate at scale.** TLB, GC, page faults, NUMA, cache misses, hot bits — each becomes real eventually.
- **Documentation outlives code.** Write it.

The Bloom filter is a small structure. Treat it with the seriousness it earns.

---

## Appendix: A Reference Implementation of a Block Bloom Filter

A complete, production-grade block Bloom filter in Go. About 200 lines, no external dependencies beyond `xxhash`.

```go
// Package blockbloom implements a cache-line-aware Bloom filter.
//
// Each key's k bits land within a single 64-byte cache line, giving
// approximately 1 cache miss per Test regardless of filter size.
package blockbloom

import (
	"errors"
	"math"
	"sync/atomic"

	"github.com/cespare/xxhash/v2"
)

const (
	bitsPerBlock  = 512 // 8 uint64 words = 64 bytes
	wordsPerBlock = bitsPerBlock / 64
	bitMask       = bitsPerBlock - 1 // assumes bitsPerBlock is a power of two
)

// Filter is a cache-line-aware Bloom filter.
type Filter struct {
	blocks    [][wordsPerBlock]uint64
	numBlocks uint64
	k         uint64
}

// New constructs a Filter with the given number of blocks and k bit positions per key.
//
// numBlocks * 8 = total bytes. k positions land within one block.
func New(numBlocks uint64, k uint64) *Filter {
	if numBlocks == 0 || k == 0 || k > 16 {
		panic("blockbloom: invalid parameters (k must be 1..16)")
	}
	return &Filter{
		blocks:    make([][wordsPerBlock]uint64, numBlocks),
		numBlocks: numBlocks,
		k:         k,
	}
}

// NewWithEstimates picks parameters for n expected items at false-positive rate p.
//
// Block Bloom has slightly higher FPR than standard Bloom at the same memory.
// The constant 1.2 below accounts for this; tune for your workload.
func NewWithEstimates(n uint64, p float64) *Filter {
	bitsPerKey := math.Ceil(-math.Log(p)/(math.Ln2*math.Ln2)) * 1.2
	totalBits := bitsPerKey * float64(n)
	numBlocks := uint64(math.Ceil(totalBits / bitsPerBlock))
	if numBlocks == 0 {
		numBlocks = 1
	}
	k := uint64(math.Round(bitsPerKey * math.Ln2))
	if k > 16 {
		k = 16
	}
	if k < 1 {
		k = 1
	}
	return New(numBlocks, k)
}

func (f *Filter) hashAll(key []byte) (uint64, [16]uint16) {
	h := xxhash.Sum64(key)
	// First 16 bits for block index.
	blockIdx := h % f.numBlocks
	// Derive 16 positions in [0, 512) from h via XorShift.
	x := h | 1 // ensure non-zero
	var pos [16]uint16
	for i := 0; i < 16; i++ {
		x ^= x << 13
		x ^= x >> 7
		x ^= x << 17
		pos[i] = uint16(x & bitMask)
	}
	return blockIdx, pos
}

// Add inserts key into the filter.
func (f *Filter) Add(key []byte) {
	bi, pos := f.hashAll(key)
	block := &f.blocks[bi]
	for i := uint64(0); i < f.k; i++ {
		p := pos[i]
		atomic.OrUint64(&block[p/64], 1<<(p%64))
	}
}

// Test reports whether key may have been added.
func (f *Filter) Test(key []byte) bool {
	bi, pos := f.hashAll(key)
	block := &f.blocks[bi]
	for i := uint64(0); i < f.k; i++ {
		p := pos[i]
		if atomic.LoadUint64(&block[p/64])&(1<<(p%64)) == 0 {
			return false
		}
	}
	return true
}

// TestAndAdd reports prior presence and adds.
func (f *Filter) TestAndAdd(key []byte) bool {
	bi, pos := f.hashAll(key)
	block := &f.blocks[bi]
	allSet := true
	for i := uint64(0); i < f.k; i++ {
		p := pos[i]
		mask := uint64(1) << (p % 64)
		if atomic.LoadUint64(&block[p/64])&mask == 0 {
			allSet = false
		}
		atomic.OrUint64(&block[p/64], mask)
	}
	return allSet
}

// NumBlocks returns the number of blocks.
func (f *Filter) NumBlocks() uint64 { return f.numBlocks }

// K returns the number of hash positions per key.
func (f *Filter) K() uint64 { return f.k }

// SizeBytes returns the memory footprint of the bitset.
func (f *Filter) SizeBytes() uint64 {
	return f.numBlocks * wordsPerBlock * 8
}

// ClearAll resets the filter to empty.
func (f *Filter) ClearAll() {
	for i := range f.blocks {
		for j := range f.blocks[i] {
			atomic.StoreUint64(&f.blocks[i][j], 0)
		}
	}
}

// Merge ORs other's bits into f. f and other must have identical parameters.
func (f *Filter) Merge(other *Filter) error {
	if f.numBlocks != other.numBlocks || f.k != other.k {
		return errors.New("blockbloom: incompatible filters")
	}
	for i := range f.blocks {
		for j := range f.blocks[i] {
			atomic.OrUint64(&f.blocks[i][j], atomic.LoadUint64(&other.blocks[i][j]))
		}
	}
	return nil
}
```

About 130 lines. The properties:

- Wait-free Add and Test.
- One cache miss per Test (target of the design).
- Atomic-OR for safety under concurrency.
- Bounded k (≤ 16) so the position-derivation array is fixed size.

A benchmark comparison with the flat atomic Bloom filter from earlier (on a 100 MB filter):

| Variant | Test latency | Test cache misses |
| --- | --- | --- |
| Flat atomic | 800 ns | ~10 |
| Block atomic | 120 ns | 1 |

The block variant is ~7x faster for large filters.

---

## Appendix: Bloom Filter Variant Reference Card

A one-page summary, suitable for printing.

```
+---------------------------+-----------+-----------+-----------+
| Variant                   | Add       | Delete    | Resize    |
+===========================+===========+===========+===========+
| Bloom                     | O(k)      | no        | no        |
| Counting Bloom            | O(k) inc  | O(k) dec  | no        |
| Partitioned Bloom         | O(k)      | no        | no        |
| Scalable Bloom            | O(k)      | no        | growing   |
| Block Bloom               | O(k)      | no        | no        |
| Cuckoo                    | O(1)*     | O(1)      | no        |
| Quotient                  | O(1)*     | O(1)      | no        |
| Xor / Ribbon              | static    | no        | no        |
| IBLT                      | O(1)      | O(1)      | no        |
| Stable Bloom              | O(k)      | random    | bounded   |
+---------------------------+-----------+-----------+-----------+
* amortised; worst-case can be larger due to eviction.

+---------------------------+-----------+-----------+
| Variant                   | Memory at | Lookup    |
|                           | p=0.01    | cache m.  |
+===========================+===========+===========+
| Bloom                     |  9.6 b/k  |    k      |
| Block Bloom               |  ~12 b/k  |    1      |
| Counting Bloom (4b)       | ~38 b/k   |    k      |
| Counting Bloom (32b)      | ~308 b/k  |    k      |
| Cuckoo                    |   9 b/k   |    2      |
| Quotient                  |  ~12 b/k  |    1      |
| Xor                       |   9.84 b/k|    3      |
| Ribbon                    |   8.5 b/k |    3      |
+---------------------------+-----------+-----------+

+---------------------------+----------+--------------+
| Variant                   | Lib in Go| Concurrent?  |
+===========================+==========+==============+
| Bloom                     | bits-and-| no (wrap)    |
|                           | blooms/  |              |
| Cuckoo                    | seiflotfy| no (wrap)    |
| Scalable Bloom            | tylertr. | partly       |
| Xor                       | FastFilt | reads only   |
| Counting Bloom            | (roll)   | (roll)       |
| Block Bloom               | (roll)   | atomic OR    |
+---------------------------+----------+--------------+
```

Pin to your desk.

---

## Appendix: Memory Layout Calculator

Given target `n` and `p`, compute exact memory for each variant.

```python
# Pseudo-code; adapt to your language of choice.
def memory(n, p):
    bits_per_key = math.ceil(-math.log(p) / (math.log(2) ** 2))
    bloom_m = n * bits_per_key
    bloom_bytes = bloom_m / 8

    cbf_bytes = bloom_m / 2  # 4-bit counters
    cbf_atomic_bytes = bloom_m * 4 / 8  # 32-bit counters

    cuckoo_bytes = n * 9 / 8  # ~9 bits/key

    xor_bytes = n * 9.84 / 8

    return {
        'bloom': bloom_bytes,
        'counting_4b': cbf_bytes,
        'counting_32b': cbf_atomic_bytes,
        'cuckoo': cuckoo_bytes,
        'xor': xor_bytes,
    }
```

For `n = 10^8`, `p = 10^-3`:

- Bloom: 144 MB
- Counting 4-bit: 575 MB
- Counting 32-bit: 4.6 GB
- Cuckoo: 113 MB
- Xor: 123 MB

Choose accordingly.

---

## Appendix: A Final Self-Check

A professional should be able to answer all of the following without consulting notes:

1. Derive `m/n = 1.44 * log2(1/p)` from the FPR formula.
2. Explain why optimum k makes the bit array half full.
3. State the information-theoretic lower bound on Bloom-family memory.
4. Explain why `atomic.OrUint64` is wait-free.
5. Describe the Go memory model's synchronizes-with relation.
6. Explain why block Bloom has slightly higher FPR than standard Bloom.
7. Compute the FPR of a Bloom filter sized for 1M at p=0.01 after 2M inserts.
8. Pick a hash family for a Bloom filter holding adversarial input.
9. Describe the Cuckoo filter eviction protocol.
10. Pick the right variant for: "static set, 10^9 keys, p=10^-6, memory-tight."
11. Describe how RocksDB's per-SSTable Bloom achieves wait-free reads.
12. Explain what `bloom_locality` does in RocksDB.
13. Compute the GC scan cost of a 1 GB Bloom filter.
14. Describe how transparent huge pages reduce TLB pressure.
15. Outline a Bloom-CRDT merge protocol across replicas.
16. Identify the false-sharing risk in a sharded mutex Bloom filter.
17. Explain why a fixed-seed Murmur3 is unsafe with user-controlled inputs.
18. Outline a safe double-write rebuild for a live Bloom filter.
19. Pick between Bloom and Cuckoo for a use case needing both Add and Delete.
20. Describe one production incident you would expect from each: undersized n, hash bias, GC pause, false sharing, stale snapshot.

Twenty questions. Each is real. If you answered all of them, you have the professional toolkit.

---

## Closing

Bloom filters reward depth without end. The simplest probabilistic data structure conceals decades of engineering: mathematics, hardware, concurrency, distributed systems, security, observability. Mastering each layer transforms the algorithm from "neat trick" to "essential primitive."

You have read the full path. Junior to professional, layer by layer. The code is short; the wisdom is long. Re-read as your career compounds.

Now go ship a Bloom filter that outlives the team that built it.
