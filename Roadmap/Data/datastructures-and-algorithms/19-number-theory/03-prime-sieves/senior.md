# Prime Sieves — Senior / Production Level

> **Focus:** Shipping sieves in real systems — memory layout (bitset, odd-only, segmented for `n` beyond RAM), cache behavior and block sizing, parallel and multi-threaded sieving, the decision boundary between *sieve* vs *trial-divide* vs *Miller-Rabin* (topic `08`) vs *Pollard's rho* (topic `09`), how to test a sieve, and the failure modes that bite in production.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Memory: Bitset, Odd-Only, and Segmented for Huge n](#memory-bitset-odd-only-and-segmented-for-huge-n)
3. [Cache Behavior and Block Sizing](#cache-behavior-and-block-sizing)
4. [Parallel and Multi-Threaded Sieving](#parallel-and-multi-threaded-sieving)
5. [Sieve vs Trial-Divide vs Miller-Rabin vs Pollard](#sieve-vs-trial-divide-vs-miller-rabin-vs-pollard)
6. [Production Code](#production-code)
7. [Testing Strategy](#testing-strategy)
8. [Failure Modes](#failure-modes)
9. [Observability and Operational Concerns](#observability-and-operational-concerns)
10. [Best Practices](#best-practices)
11. [Summary](#summary)
12. [Further Reading](#further-reading)

---

## Introduction

A sieve that works on `n = 30` in a tutorial and a sieve that holds up under production constraints — bounded memory, tail latency, concurrency, correctness under fuzzing — are different artifacts. The algorithm is the same; the engineering is not. This file is about the second one.

The senior-level questions are:

- How big can `n` get before the boolean array no longer fits in RAM, and what do we do then?
- Why is a naive sieve memory-bandwidth-bound, and how does blocking turn it cache-bound (and 2–5× faster)?
- Can we parallelize? What parallelizes cleanly (segmented blocks) and what does not (the base sieve)?
- When should we *not* sieve at all — when is a single Miller-Rabin call (topic `08`) the right tool?
- How do we test something that produces millions of bits, where a single off-by-one corrupts one value among millions?

Get these right and your sieve is a dependable component; get them wrong and you ship a service that OOMs at `n = 2·10^9` or returns a wrong primality flag for one unlucky input out of ten million.

The recurring theme is that the sieve is **memory-dominated, not compute-dominated**. Every senior decision — bitset vs byte array, blocked vs monolithic, segmented vs whole, parallel-by-window vs parallel-by-prime — is fundamentally about *where the bytes live and how often they move*. The arithmetic (a single array write per cross-out) is trivial; the data movement is the cost. Internalize that lens and the rest of this file follows.

---

## Memory: Bitset, Odd-Only, and Segmented for Huge n

Memory is the first wall you hit. The arithmetic:

| Representation | Bytes per number | `n = 10^8` | `n = 10^9` | `n = 10^10` |
|----------------|------------------|-----------|-----------|------------|
| `bool[]` (1 byte) | 1 | 100 MB | 1 GB | 10 GB |
| bitset (1 bit) | 1/8 | 12.5 MB | 125 MB | 1.25 GB |
| odd-only bitset | 1/16 | 6.25 MB | 62.5 MB | 625 MB |
| mod-30 wheel bitset | ~1/30 (8/30 bits) | ~3.3 MB | ~33 MB | ~330 MB |

The progression is the standard escalation path. **Step 1: bitset** — store one bit per number, `bits[x>>6] & (1<<(x&63))`. **Step 2: odd-only** — drop even indices, value `2i+1` at bit `i`, halving again. **Step 3: wheel** — drop multiples of 2,3,5 for another ~1.85× saving.

When even an odd-only wheel bitset will not fit (`n ≥ ~10^{10}` on a commodity box), you stop holding the whole sieve at once and **segment**: sieve the base primes up to `√n` once (those *do* fit — `√(10^{10}) = 10^5`), then process `[2, n]` in windows of a few MB, discarding each window after you have consumed (counted, summed, streamed) its primes. Memory becomes `O(√n + window)`, independent of `n`. This is the only way to sieve genuinely huge ranges, and it is how prime-counting record computations are structured.

The trade-off: segmenting means you cannot do `O(1)` random primality lookups afterward (the bits are gone). If you need a persistent `isPrime[x]` oracle, you must keep the bitset; if you only need to *stream* primes once, segment and free.

---

## Cache Behavior and Block Sizing

A modern CPU does arithmetic far faster than it reads main memory. The naive sieve of `n = 10^9` touches a 125 MB bitset; for a small prime like `p = 2` the cross-out writes stride across the *entire* 125 MB array, which does not fit in any cache (L2 is ~1 MB, L3 ~32 MB). Every cross-out for small primes is a cache miss to DRAM. The sieve becomes **memory-bandwidth-bound**: the CPU stalls waiting for memory.

The fix is **cache blocking** (the segmented sieve applied for performance, not just memory). Divide `[2, n]` into blocks `B` sized to fit in L1/L2 (commonly 16–64 KB of bits, i.e. ~`10^5`–`5·10^5` numbers). For each block, iterate over *all* base primes and cross out their multiples *within that block*. Because the block stays resident in cache while you stride the primes, the only DRAM traffic is loading each block once. This typically yields a **2–5× speedup** on large `n`, and the effect grows with `n`.

Block-sizing guidance:

- Target a block that fits comfortably in **L2** (e.g. 32 KB of bits ≈ 256 K numbers, odd-only ≈ 512 K). Too small wastes per-block prime-loop overhead; too large spills to L3/DRAM.
- Precompute, for each base prime `p`, its *next cross-out offset* so you do not recompute `⌈L/p⌉·p` from scratch each block — carry the offset forward across blocks.
- Keep base primes (and their offsets) in a compact, sequentially-scanned array so that loop is itself cache-friendly.

Empirically, block sizing matters more than micro-optimizing the inner loop, because the bottleneck is memory traffic, not arithmetic.

---

### A note on SPF table width

The SPF table stores the smallest prime factor as an integer per number, so its width matters at scale. If `n ≤ 65521²` you might be tempted to pack SPF into 16 bits, but the smallest prime factor of a number near `n` can itself be large only up to `√n`; in fact `spf[x] ≤ √x ≤ √n`, so SPF values fit in the bit-width of `√n`. For `n = 10^8`, `√n = 10^4`, which fits in 16 bits — halving the SPF table from 400 MB (32-bit) to 200 MB (16-bit). This is a real, easily-missed saving: size the SPF integer type from `√n`, not from `n`.

### Quantifying the cache effect

Consider sieving `n = 10^9` with a 125 MB bitset. Crossing out multiples of `p = 2` writes to `5·10^8` positions spread across all 125 MB. With a typical L3 of 32 MB, only ~25% of the array is ever cache-resident; the remaining writes are L3 or DRAM misses. DRAM latency is ~60–100 ns versus ~1 ns for L1; even amortized by prefetching, the effective throughput is gated by memory bandwidth (tens of GB/s), not by the CPU's ability to issue writes. The arithmetic of one cross-out is trivial; the *memory move* is the cost.

Blocking inverts this. With a 32 KB block, the whole block is L1/L2-resident. You load it once from DRAM, then every base prime's cross-outs into that block hit cache. The DRAM traffic drops from "one access per cross-out" to "one stream of the array, once." Since the number of cross-outs (`n log log n`) far exceeds the array size (`n` bits), this is a large reduction in DRAM traffic — hence the measured 2–5× speedup. The larger `n` is relative to cache, the bigger the win.

## Parallel and Multi-Threaded Sieving

Sieving parallelizes well in its segmented form, poorly in its monolithic form.

- **What parallelizes:** the *windows* of a segmented sieve are independent. Compute base primes up to `√n` once (sequentially — it is cheap), then hand disjoint windows `[L₁,R₁], [L₂,R₂], …` to a thread pool. Each worker sieves its window against the shared, read-only base-prime array and reports its primes (or a partial count). This scales near-linearly with cores because there is no write sharing — each thread owns its window's bytes.
- **What does not parallelize cleanly:** the *base* sieve up to `√n` (small, leave it sequential) and any monolithic single-array sieve, where threads crossing out multiples of different primes would contend on the same cache lines (false sharing) and need synchronization. Do not try to parallelize the classic single-array Eratosthenes by prime; partition by *range* instead.

Practical pattern (map-reduce over windows):

1. Sequentially sieve base primes `≤ √n`.
2. Partition `[2, n]` into `W` windows.
3. `parallel for` each window: allocate a local bitset, cross out base-prime multiples, reduce to a local count/sum/list.
4. Combine the per-window reductions.

Pin threads to cores, give each thread its own freshly-allocated window buffer (avoid sharing buffers to prevent false sharing), and size windows so each fits in that core's private L2. NUMA: allocate each window's buffer on the node where its thread runs ("first-touch").

### Worked parallel pattern — Go (segment over goroutines)

```go
package main

import (
	"fmt"
	"math"
	"sync"
)

func basePrimesP(limit int) []int {
	isComp := make([]bool, limit+1)
	var ps []int
	for p := 2; p <= limit; p++ {
		if !isComp[p] {
			ps = append(ps, p)
			for m := p * p; m <= limit; m += p {
				isComp[m] = true
			}
		}
	}
	return ps
}

func countParallel(n, workers int) int64 {
	root := int(math.Sqrt(float64(n)))
	base := basePrimesP(root)
	chunk := (n - 1 + workers) / workers
	var total int64
	var mu sync.Mutex
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		lo := 2 + w*chunk
		hi := lo + chunk - 1
		if hi > n {
			hi = n
		}
		if lo > n {
			break
		}
		wg.Add(1)
		go func(lo, hi int) { // each goroutine owns its window buffer
			defer wg.Done()
			seg := make([]bool, hi-lo+1) // private buffer: no false sharing
			for _, p := range base {
				if p*p > hi {
					break
				}
				start := p * p
				if start < lo {
					start = ((lo + p - 1) / p) * p
				}
				for m := start; m <= hi; m += p {
					seg[m-lo] = true
				}
			}
			var c int64
			for i := range seg {
				if !seg[i] {
					c++
				}
			}
			mu.Lock()
			total += c
			mu.Unlock()
		}(lo, hi)
	}
	wg.Wait()
	return total
}

func main() {
	fmt.Println("π(10^7) =", countParallel(10_000_000, 4)) // 664579
}
```

Each goroutine allocates its own `seg` buffer, reads the shared read-only `base` slice, and contributes only a final count under a brief lock — the heavy sieving is fully parallel with no write sharing. This scales close to linearly until memory bandwidth saturates.

---

## Sieve vs Trial-Divide vs Miller-Rabin vs Pollard

Choosing the wrong tool is the most common senior-level mistake. The decision is about *how many* numbers and *how large*:

| Situation | Best tool | Why |
|-----------|-----------|-----|
| Primality/factors for **all** `x ≤ n`, `n` fits in RAM | **Sieve** (Eratosthenes or linear) | Amortizes one `O(n log log n)`/`O(n)` build over `O(1)` lookups |
| Factor/primality of **one** number `x`, `x` up to ~`10^{12}` | **Trial division** by primes up to `√x` | `O(√x)` is fine for a single moderate number |
| Primality of **one** number `x`, `x` up to `10^{18}`+ | **Miller-Rabin** (deterministic for `< 3.3·10^{24}` with fixed bases) — topic `08` | `O(k log³ x)`; no array needed |
| Factor **one** large `x` (e.g. `10^{18}`, hard semiprime) | **Pollard's rho** + Miller-Rabin — topic `09` | `~O(x^{1/4})` expected; trial division too slow |
| Many primality queries on numbers `≤ n` | Sieve once, query `O(1)` | Same as row 1 |
| Many primality queries on numbers `> n` (huge, scattered) | Miller-Rabin per query | Cannot sieve up to them |

The boundary in one sentence: **sieve for a dense range up to a RAM-fittable bound; switch to Miller-Rabin/Pollard for a single (or few) numbers too large to sieve.** A frequent anti-pattern is sieving up to `10^9` just to test one number near `10^9` — a single trial division or Miller-Rabin call is thousands of times cheaper and uses no memory. Conversely, calling Miller-Rabin in a tight loop over every `x ≤ 10^7` is far slower than one sieve.

---

## Production Code

### Cache-blocked segmented prime counter — Go

Counts primes up to `n` using base primes up to `√n` and a reusable block buffer (bounded memory, cache-friendly).

```go
package main

import (
	"fmt"
	"math"
)

// basePrimes returns all primes up to limit via a simple sieve.
func basePrimes(limit int) []int {
	isComp := make([]bool, limit+1)
	var ps []int
	for p := 2; p <= limit; p++ {
		if !isComp[p] {
			ps = append(ps, p)
			for m := p * p; m <= limit; m += p {
				isComp[m] = true
			}
		}
	}
	return ps
}

// countPrimes counts primes in [2, n] with a cache-blocked segmented sieve.
func countPrimes(n int) int64 {
	if n < 2 {
		return 0
	}
	root := int(math.Sqrt(float64(n)))
	base := basePrimes(root)
	const BLOCK = 1 << 18 // ~262144 numbers per block, fits in L2
	var count int64
	block := make([]bool, BLOCK)
	for low := 2; low <= n; low += BLOCK {
		high := low + BLOCK - 1
		if high > n {
			high = n
		}
		for i := range block {
			block[i] = false
		}
		for _, p := range base {
			if p*p > high {
				break
			}
			start := p * p
			if start < low {
				start = ((low + p - 1) / p) * p
			}
			for m := start; m <= high; m += p {
				block[m-low] = true
			}
		}
		for i := low; i <= high; i++ {
			if !block[i-low] {
				count++
			}
		}
	}
	return count
}

func main() {
	fmt.Println("π(10^6) =", countPrimes(1_000_000)) // 78498
	fmt.Println("π(10^7) =", countPrimes(10_000_000)) // 664579
}
```

### Bitset sieve (Java) — bounded-memory primality oracle

A `long[]`-backed bitset using `n/64` words. For `n = 10^9` this is ~125 MB; an odd-only variant halves it.

```java
public class BitsetSieve {
    private final long[] composite; // bit x set => x is composite
    private final int n;

    public BitsetSieve(int n) {
        this.n = n;
        composite = new long[(n >> 6) + 1];
        set(0); set(1); // 0 and 1 are not prime
        for (int p = 2; (long) p * p <= n; p++) {
            if (!get(p)) { // p is prime
                for (long m = (long) p * p; m <= n; m += p) {
                    set((int) m);
                }
            }
        }
    }

    private void set(int x)   { composite[x >> 6] |= 1L << (x & 63); }
    private boolean get(int x) { return (composite[x >> 6] & (1L << (x & 63))) != 0; }

    public boolean isPrime(int x) {
        if (x < 2 || x > n) throw new IllegalArgumentException("out of range: " + x);
        return !get(x);
    }

    public static void main(String[] args) {
        BitsetSieve s = new BitsetSieve(100_000_000);
        System.out.println(s.isPrime(99_999_989)); // true
        System.out.println(s.isPrime(99_999_990)); // false
    }
}
```

The `isPrime` guard *throws* on out-of-range input rather than silently returning a wrong answer — a deliberate production choice: callers must explicitly handle `x > n` (e.g. route to Miller-Rabin).

### Deterministic Miller-Rabin for one large number — Python (the "not a sieve" tool)

When the input is a single huge number, do *not* sieve. (Full treatment in topic `08`.)

```python
def is_prime(n):
    if n < 2:
        return False
    for p in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
        if n % p == 0:
            return n == p
    d, r = n - 1, 0
    while d % 2 == 0:
        d //= 2
        r += 1
    for a in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):  # deterministic < 3.3e24
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(r - 1):
            x = x * x % n
            if x == n - 1:
                break
        else:
            return False
    return True


if __name__ == "__main__":
    print(is_prime(1_000_000_000_000_000_003))  # True, no array allocated
```

---

## Testing Strategy

A sieve emits millions of bits; one corrupted bit is a real bug that example tests miss. Layer the defenses:

1. **Known small values.** Assert the prime list for `n = 30` equals `[2,3,5,7,11,13,17,19,23,29]`. Assert `isPrime` for `0,1,2` is `false,false,true`.
2. **`π(n)` reference values.** `π(10)=4`, `π(100)=25`, `π(1000)=168`, `π(10^4)=1229`, `π(10^5)=9592`, `π(10^6)=78498`, `π(10^7)=664579`. These pin down the count exactly.
3. **Cross-check against a second method.** For all `x ≤ 10^5`, assert `sieve.isPrime[x] == millerRabin(x)`. Two independent implementations agreeing is strong evidence.
4. **Property-based testing.** Random `x`: a sieved-prime should fail trial division by all smaller primes; a sieved-composite should have a factor the SPF chain reproduces (`product of factors == x`).
5. **Segmented vs whole-range parity.** For random `[L, R]` within a small bound, assert the segmented sieve's output equals filtering a full sieve.
6. **Multiplicative function spot-checks.** `φ(p) = p−1` for sampled primes; `μ(squarefree)∈{±1}`, `μ(non-squarefree)=0`; `Σ_{d|n} φ(d) == n` for sampled `n`.
7. **Boundary fuzz.** `n ∈ {0,1,2,3}`, `n` even/odd, `n` a perfect square (`√n` exact), `L=R`, `L=0`, `L=1`.

### Cross-check test harness — Python

A compact harness embodying defenses 2 and 3: it validates `π(n)` against references and cross-checks the sieve against Miller-Rabin over a dense range.

```python
PI_REF = {10: 4, 100: 25, 1000: 168, 10000: 1229, 100000: 9592, 1000000: 78498}


def test_sieve(sieve_fn, mr_fn):
    is_prime, primes = sieve_fn(1_000_000)
    # 1) reference pi(n)
    for n, expected in PI_REF.items():
        got = sum(1 for x in range(2, n + 1) if is_prime[x])
        assert got == expected, f"pi({n})={got}, expected {expected}"
    # 2) cross-check against Miller-Rabin on a dense prefix
    for x in range(2, 100_000):
        assert bool(is_prime[x]) == mr_fn(x), f"mismatch at {x}"
    # 3) every listed prime fails trial division by smaller primes
    for p in primes[:2000]:
        assert all(p % q for q in primes if q * q <= p and q < p), f"{p} not prime"
    print("all sieve tests passed")
```

Run this in CI; it catches off-by-ones, overflow corruption, and the odd-only index bugs that example-based tests miss, because it checks *every* value in a dense range against an independent oracle.

---

## Failure Modes

| Failure | Symptom | Root cause | Mitigation |
|---------|---------|------------|------------|
| OOM at large `n` | Process killed / allocation fails | `bool[]` of `n` bytes | Bitset + odd-only; segment if `n` huge |
| Wrong primality for one value | Rare incorrect result | Off-by-one in `≤ n`, `p*p` start, or odd-only index map | Reference `π(n)` + cross-check tests |
| `p*p` overflow | Negative/garbage bound, infinite or empty loop | 32-bit multiply for large `p` | 64-bit for `p*p`, `i*p`, `start` |
| Segmented sieve marks wrong cells | Primes missing/extra near window edges | Wrong `start` (used `2p`/`p` not `max(p²,⌈L/p⌉·p)`) | Carefully derive first in-window multiple; test parity |
| `0`/`1` reported prime in window | Edge values wrong when `L ≤ 1` | Forgot to clear them | Special-case `L==0`, `L==1` |
| Parallel sieve slower than serial | No speedup or regression | False sharing on shared buffer; oversized windows spilling cache | Per-thread buffers; size windows to L2; first-touch NUMA |
| Cache-bound throughput | Big-`n` sieve crawls | No blocking; striding full array | Cache-block into L2-sized windows |
| Non-squarefree `μ ≠ 0` | Möbius-based sums wrong | Missing `i%p==0 → μ=0` branch | Unit-test `μ` against direct factorization |

---

## Real-World Deployment Scenarios

### Scenario 1: a microservice that answers "is `x` prime?" for `x ≤ 10^8`

Build an **odd-only bitset** (`~6 MB`) once at startup; store it in a process-global, immutable structure. Each request is a single bit read, `O(1)`, sub-microsecond. Cap requests to `x ≤ 10^8`; for `x` above the cap, fall through to Miller-Rabin (topic `08`) so the service never says "out of range." This hybrid — sieve for the dense common case, Miller-Rabin for the long tail — is the standard production shape.

### Scenario 2: a batch job factoring 10^7 integers, each `≤ 10^9`

Precompute the **SPF table** once with the linear sieve (`~4 GB` as 32-bit ints for `10^9`, or use a 2-byte SPF for `n ≤ 65536²`... in practice cap `n` at `~2·10^8` where SPF fits in ~800 MB, or factor larger inputs by trial-dividing with sieved base primes up to `√x`). Each factorization is then `O(log x)`. If the SPF table will not fit, sieve only base primes up to `√(10^9) ≈ 31623` (a few KB) and trial-divide each input by those primes — `O(√x / ln √x)` per number, still fast and memory-trivial.

### Scenario 3: counting primes in `[10^12, 10^12 + 10^8]`

Cannot allocate `10^12` cells. Sieve base primes up to `√(10^12 + 10^8) ≈ 10^6` once (`~125 KB` bitset). Then process the `10^8`-wide window in cache-blocked chunks, counting survivors. Parallelize the chunks across cores. Memory stays at `O(√R + block)`, runtime scales with the window size, not with `R`.

## Anti-Patterns Checklist

| Anti-pattern | Why it hurts | Do instead |
|--------------|--------------|------------|
| Sieve up to `10^9` to test one number | 125 MB + seconds for one query | Miller-Rabin or single trial division |
| `boolean[]` (1 byte) for `n = 10^9` | 1 GB, OOM risk | Bitset, odd-only |
| Re-sieve inside the request handler | Repeated `O(n log log n)` per request | Build once, share immutable |
| Monolithic sieve, no blocking, large `n` | Memory-bandwidth-bound, slow | Cache-block into L2 windows |
| Parallelize by prime over one shared array | False sharing, contention | Parallelize by disjoint window |
| Allocate an `R`-sized array for `[L,R]` | OOM when `R` huge | Segmented sieve, window-sized array |
| Trust the sieve on one example only | Silent one-bit corruption | Reference `π(n)` + cross-check |

## Benchmarking Discipline

Before claiming a sieve optimization "works," measure it correctly:

- **Warm the cache and the JIT.** Discard the first run(s); measure steady-state. A cold JVM or cold page cache reports times dominated by warmup, not the algorithm.
- **Fix `n` and vary one knob at a time.** Compare byte-array vs bitset vs odd-only vs blocked at the *same* `n`, on the *same* machine, isolating the variable.
- **Report throughput, not just wall time.** "Numbers sieved per second" normalizes across `n` and makes cache-cliff effects visible (throughput drops sharply once the array exceeds L3).
- **Pin the CPU governor** to performance and disable turbo variability if you need stable numbers; otherwise report medians of many runs.
- **Validate the output every run.** A faster sieve that is wrong is worthless; assert `π(n)` matches the reference inside the benchmark so a "speedup" from skipped work is caught immediately.
- **Watch for memory-bandwidth saturation in parallel runs.** Beyond a few cores, a memory-bound sieve stops scaling because all cores share the same DRAM bus; more threads then add contention, not throughput.

The most common benchmarking mistake is comparing a blocked sieve to a monolithic one at a *small* `n` that fits in L3 — there the blocking shows no benefit, leading you to wrongly conclude it does not help. Always benchmark large-`n` (well beyond L3) to see the real effect.

## Observability and Operational Concerns

- **Log the sieve bound and memory footprint** at startup (`n`, bytes allocated, representation). A surprise `n` from config is a classic OOM trigger.
- **Bound the input.** Validate the requested `n`/`R` against a hard cap derived from available RAM *before* allocating. Reject or auto-segment beyond the cap rather than letting the allocator kill the process.
- **Build the sieve once, lazily, and cache it.** Re-sieving per request is a latency and CPU sink. Guard the shared sieve with a one-time initializer; treat it as immutable afterward (safe to share across threads read-only).
- **Track build time and `π(n)`** as metrics; a sudden change in either signals a config or correctness regression.
- **Warm up** the sieve before serving traffic if it gates request latency; the first build of a large sieve can take seconds.
- **Expose a health/readiness signal** that flips only after the sieve is built and published, so the orchestrator does not route traffic to a pod mid-construction.
- **Emit the representation in use** (byte / bitset / odd-only / segmented) so a regression that silently falls back to the memory-heavy path is visible in dashboards before it OOMs.

---

## Best Practices

- Default to an **odd-only bitset Eratosthenes** for raw primality at scale; switch to the **linear sieve** only when you need SPF or multiplicative functions.
- **Cache-block** any sieve over `n ≳ 10^7`; it is the single biggest performance lever and costs little code.
- **Segment** when the sieve would not fit in RAM, or when you only need to stream primes once and can discard the bits.
- **Parallelize by window**, never by prime; give each thread a private, first-touch-allocated buffer.
- Pick the tool by cardinality: **sieve a dense range**, **Miller-Rabin a single huge number** (topic `08`), **Pollard's rho to factor a single huge number** (topic `09`).
- Test against **reference `π(n)` values** and a **second independent primality method**; sieves fail silently on one value out of millions otherwise.
- Validate and cap the input bound before allocating; log the footprint; build once and share read-only.

---

## Capacity Planning Cheat Sheet

Before deploying, estimate memory and time from the bound `n`:

| Need | Memory formula | Time formula | Notes |
|------|----------------|--------------|-------|
| Primality oracle, bitset | `n/8` bytes | `~n·ln ln n` ops to build | odd-only halves memory |
| Primality oracle, odd-only bitset | `n/16` bytes | `~(n/2)·ln ln n` | recommended default |
| SPF table (factorization) | `n·sizeof(int)` | `O(n)` build | 32-bit SPF ⇒ 4n bytes; cap `n` accordingly |
| `φ`/`μ`/`τ`/`σ` arrays | `n·sizeof(int)` each | `O(n)` build | one pass computes all |
| Segmented (stream primes) | `O(√n + block)` | `O(n·ln ln n)` total | constant memory in `n` |
| Prime list storage | `~(n/ln n)·sizeof(int)` | — | far smaller than the sieve itself |

Worked example: a primality service for `n = 5·10^8`. Odd-only bitset ⇒ `5·10^8 / 16 ≈ 31 MB`. Build time on one core ≈ a few hundred ms. Comfortably fits a small container; build once at startup, share immutable.

## Decision Recap (the one table to remember)

```mermaid
graph TD
    A[Primality / factor request] --> B{How many numbers?}
    B -->|one| C{How large?}
    C -->|<= sqrt fits trial div| D[Trial division O(sqrt x)]
    C -->|huge, primality| E[Miller-Rabin — topic 08]
    C -->|huge, factor| F[Pollard rho — topic 09]
    B -->|many, dense range| G{Fits in RAM?}
    G -->|yes| H[Sieve once, O(1) queries]
    G -->|no| I[Segmented + cache blocks + parallel]
```

## Best Practices Recap and War Stories

A few hard-won field notes that turn "works on my machine" into "works at 2 a.m. under load":

- **The config-driven OOM.** A service read its sieve bound from a config file. A well-meaning ops change bumped it from `10^8` to `10^9`, the `boolean[]` allocation jumped from 100 MB to 1 GB, and the pod OOM-killed on startup in a crash loop. *Lesson:* validate and hard-cap the bound against available memory *before* allocating, and log the chosen footprint. A bitset would also have given 8× headroom.
- **The silent one-bit bug.** A hand-rolled odd-only sieve had an index off-by-one in the value↔index map for a single residue class. It returned the wrong primality for ~one number in a million. Example tests passed; a customer hit it months later. *Lesson:* cross-check against an independent primality method over a dense range, and assert reference `π(n)` values in CI.
- **The re-sieve-per-request.** A handler called `buildSieve(n)` inside the request path "for simplicity." Under load each request spent hundreds of ms rebuilding the same array, pegging CPU. *Lesson:* build once, memoize, share immutable. The sieve is read-only after construction and safe to share across threads without locks.
- **The non-blocked big sieve.** A reporting job sieved `2·10^9` without cache blocking and ran 4× slower than a blocked version on the same hardware — pure memory-bandwidth waste. *Lesson:* block any sieve over `~10^7` into L2-sized windows; it is a few lines and a large win.
- **The wrong tool.** A job tested primality of numbers near `10^{18}` by attempting to sieve up to them — instant OOM. *Lesson:* a single huge number is a Miller-Rabin job (topic `08`), never a sieve job.

These map one-to-one onto the failure-mode table; the table is the checklist, the stories are why each row exists.

## Thread-Safety and Lifecycle

The sieve has a clean concurrency story *if* you respect its lifecycle:

1. **Build phase** — single-threaded (or window-parallel with private buffers). Mutates the array. No readers allowed yet.
2. **Publish** — once built, store the array/bitset behind a memory barrier (e.g. a `sync.Once`-guarded global in Go, a `volatile`/`final` field in Java, a module-level constant in Python). After publication it is **immutable**.
3. **Serve phase** — many threads read concurrently. No locks needed because there are no writers. This is the data-race-free "immutable after construction" pattern.

The bug to avoid is letting a reader observe a half-built sieve (e.g. lazy init without proper synchronization), which can return wrong answers for the brief window during construction. Use the language's standard one-time-initialization primitive to make the publish a happens-before edge for all readers.

## Summary

In production, the sieve algorithm is easy; the engineering around memory and cache is where the wins and the bugs live. See [`middle.md`](./middle.md) for the linear-sieve and segmented-sieve algorithms this file operationalizes, and [`professional.md`](./professional.md) for the correctness and complexity proofs behind the variants.

 Use bitset + odd-only (+ wheel) to shrink memory 8–16×, and **segment** once the sieve outgrows RAM or when streaming primes once. **Cache-block** large sieves into L2-sized windows to escape memory-bandwidth-boundedness for a 2–5× speedup, and **parallelize by window** with per-thread buffers for near-linear scaling. Choose the right tool by cardinality and size: sieve a dense range up to a RAM-fittable bound, but reach for Miller-Rabin (topic `08`) for a single huge primality test and Pollard's rho (topic `09`) to factor a single huge number. Finally, *test relentlessly* against reference `π(n)` values and an independent primality oracle, because a sieve fails silently on one value among millions — and validate/cap the input bound before you allocate, or the OOM killer will validate it for you.

---

## Further Reading

- Kim Walisch, *primesieve* (open-source) — a state-of-the-art segmented, wheel-factorized, multi-threaded sieve; the reference implementation for these techniques.
- Tomás Oliveira e Silva — engineering notes on fast segmented sieves and prime-counting computations.
- cp-algorithms.com — "Sieve of Eratosthenes" (with the segmented and block variants).
- Sibling file [`middle.md`](./middle.md) — the linear, segmented, odd-only, and wheel algorithms.
- Sibling file [`professional.md`](./professional.md) — correctness and complexity proofs for every variant.
- Sibling topics `08-miller-rabin`, `09-pollard-rho` — the single-huge-number tools at this topic's boundary.
