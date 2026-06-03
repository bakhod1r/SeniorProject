# Memoization vs Tabulation — Senior Level

> The recurrence is rarely what fails in production. What fails is the *implementation strategy*: a memoized solver that overflows the stack at depth `10^6`, a cache that grows without bound and triggers an OOM, a table sized for a state space that no longer fits in memory, or a DP whose answers can't be reconstructed because someone applied a rolling array too aggressively. Senior work on DP is about choosing top-down vs bottom-up as an *engineering* decision and instrumenting it so failures are observable, bounded, and testable.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Stack Overflow on Deep Memoization](#2-stack-overflow-on-deep-memoization)
3. [Cache Lifetime, Eviction, and Memory Budgeting](#3-cache-lifetime-eviction-and-memory-budgeting)
4. [Iterative Deepening and Hybrid Strategies](#4-iterative-deepening-and-hybrid-strategies)
5. [Choosing a Style Under Production Constraints](#5-choosing-a-style-under-production-constraints)
6. [Numerical and Modular Correctness](#6-numerical-and-modular-correctness)
7. [Cache Data-Structure Selection](#7-cache-data-structure-selection)
8. [Profiling and Benchmarking the Two Styles](#8-profiling-and-benchmarking-the-two-styles)
9. [Code Examples](#9-code-examples)
10. [Observability and Testing](#10-observability-and-testing)
11. [Failure Modes](#11-failure-modes)
11b. [A Production Decision Walkthrough](#11b-a-production-decision-walkthrough)
12. [Summary](#12-summary)

---

## 1. Introduction

At senior level the question is no longer "memoize or tabulate?" as a stylistic preference but "which strategy survives the operational envelope of this service?" The same recurrence — say climbing stairs or grid paths — behaves completely differently depending on the input scale and the runtime:

1. **Depth-bound regime.** `n` reaches `10^5`–`10^7`. A memoized recursion has depth ≈ `n` and will overflow the call stack on most runtimes long before correctness is in question. Tabulation is mandatory, or memoization must be made iterative (explicit stack / converted to bottom-up).
2. **Memory-bound regime.** The state space is large (`R·C·k` or a bitmask dimension). The full table won't fit; you need rolling arrays, on-disk tables, or a memoization cache with eviction that exploits sparsity.
3. **Latency/throughput regime.** The DP runs millions of times per second inside a hot loop (a parser, a router, a pricing engine). Function-call and hash overhead of memoization is unacceptable; you tabulate with a flat array and reuse the buffer across calls.

All three share one engine — *evaluate each subproblem once* — but the senior decisions are: bound the stack, bound the cache, keep arithmetic exact, and verify the result when the input is too big to brute-force. This document treats those in production terms.

---

## 2. Stack Overflow on Deep Memoization

### 2.1 The depth ceiling is real and platform-specific

Memoization's recursion depth equals the longest path in the subproblem DAG — for a linear recurrence like Fibonacci or climbing stairs, that is `Θ(n)`. Default limits:

- **Python:** `sys.setrecursionlimit` defaults to ~1000; even raised, the C stack underneath caps you around `10^4`–`10^5` frames before a hard segfault.
- **Java:** default thread stack ~512KB–1MB → roughly `10^4`–`2×10^4` frames depending on frame size; throws `StackOverflowError`.
- **Go:** goroutine stacks grow dynamically (up to ~1GB), so Go tolerates much deeper recursion, but you can still exhaust it and the panic is unrecoverable in the usual case.

A memoized `fib(10^6)` overflows on Python and Java. The recurrence is fine; the *strategy* is wrong for the scale.

### 2.2 Three fixes, in order of preference

1. **Tabulate.** The cleanest fix: a bottom-up loop has no recursion and depth zero. For any linear-chain recurrence this is trivial and is the production default.
2. **Iterative memoization with an explicit stack.** When the recursion structure is irregular and you still want laziness, simulate the call stack on the heap. You keep top-down's "only-reachable-states" benefit without the call-stack ceiling.
3. **Raise the limit / grow the stack** — a stopgap, not a fix. Raising `setrecursionlimit` or running on a thread with a bigger stack buys a constant factor; it does not change the linear depth growth and will fail at larger `n`.

### 2.3 Warming the cache to flatten depth

A subtle trick: if you *must* keep a memoized API but want to avoid deep recursion, pre-populate the cache iteratively from the base cases upward (a bottom-up warm-up). Then the top-level call finds everything cached at depth 1. This is tabulation wearing a memoization interface — and it is often the right answer when a library exposes a recursive signature but is called with large arguments.

---

## 3. Cache Lifetime, Eviction, and Memory Budgeting

### 3.1 The unbounded-cache failure

A memo cache that lives across many independent queries grows monotonically. In a long-running service this is a slow memory leak: every distinct state ever seen stays resident. Symptoms are rising RSS and eventual OOM. Two disciplines:

- **Scope the cache per request/call** when subproblems don't transfer between queries. Create it, use it, drop it. (For pure functions this is the safe default.)
- **Bound it with an eviction policy** when reuse across queries is valuable.

### 3.2 Eviction policies and why DP is tricky

LRU/LFU caches are the usual tools (`functools.lru_cache(maxsize=N)`, Guava `Cache`, an LRU map). But DP has a hazard plain caches don't: **evicting a subproblem that a still-pending recursion depends on forces recomputation mid-flight**, which can blow up cost or even depth. For a single top-down evaluation, *never* evict states on the active dependency path. Bounded eviction is safe only for the *cross-query* cache, not the *within-evaluation* memo.

Practical rule: use two tiers — an unbounded per-evaluation memo (lives for one `solve()` call) and an optional bounded cross-query cache (`maxsize`, LRU) seeded from completed evaluations.

### 3.3 Memory budgeting against the state count

Budget before you run. With `S` states each storing a `b`-byte value, the table needs `S·b` bytes plus map overhead (hash maps add ~50–100% in many runtimes). If `S·b` exceeds your budget:

- Apply **rolling arrays / dimension reduction** (tabulation only): grid `O(R·C) → O(C)`.
- Switch to **memoization** if the *reachable* states are far fewer than `S`.
- **Stream** the table to disk if you only ever need a sliding window and the path.
- **Recompute instead of store** for cheap transitions when memory is the harder constraint than CPU.

Quantify: a `10^4 × 10^4` grid is `10^8` cells × 8 bytes = 800MB as a full `int64` table — over budget on most boxes. Rolled to one row it is `10^4 × 8` = 80KB. The rolling array is not an optimization here; it is the difference between running and crashing.

---

## 4. Iterative Deepening and Hybrid Strategies

### 4.1 Iterative deepening for unknown depth

When the answer lies at an unknown shallow depth in a deep/infinite search but you want memoization's laziness without committing unbounded stack, **iterative deepening** runs depth-limited searches with growing limits. In a DP context this matters for game-tree / minimax-style recurrences where the state space is enormous but good answers appear early. You memoize within each depth bound and reuse across bounds (transposition table). The exponential cost of re-searching shallow layers is dominated by the last, deepest layer, so the overhead is a constant factor.

### 4.2 Bottom-up over a topologically sorted reachable set

A hybrid that captures the best of both: first do a cheap top-down *discovery* pass (DFS) to enumerate the reachable states and their dependency edges, **without** computing values (so it can be made iterative to avoid stack issues), then evaluate bottom-up in topological order over exactly that reachable set. You get tabulation's flat evaluation and rolling-friendly order, but only over reachable states (memoization's sparsity advantage).

### 4.3 Meet-in-the-middle as a state-reduction hybrid

When a single DP dimension is too large but splits cleanly, computing two half-size DPs and combining them trades an `O(2^n)` state space for `O(2^{n/2})`. This is a state-design decision layered on top of the memo/table choice and frequently the only way to fit the table in memory.

---

## 5. Choosing a Style Under Production Constraints

| Constraint | Prefer | Rationale |
|------------|--------|-----------|
| `n` deep (≥10^5), linear chain | **Tabulation** | No stack ceiling |
| Sparse reachable states (≪ total) | **Memoization** (per-call) | Skips unreachable states |
| Hot loop, microsecond budget | **Tabulation + reused buffer** | No call/hash overhead |
| Tight memory, scalar answer | **Tabulation + rolling array** | `O(states) → O(window)` |
| Need to reconstruct the path | **Tabulation, full table** (or parent pointers) | Rolling loses history |
| Irregular recurrence, prototyping | **Memoization** | Mirrors the math, fast to write |
| Cross-query reuse valuable | **Bounded LRU cache** atop top-down | Amortizes repeated queries |
| Unbounded/unknown depth search | **Iterative deepening + transposition table** | Bounds stack and memory |

The decision is rarely aesthetic. Pin it to the dominant constraint — depth, memory, latency, or path reconstruction — and document why.

---

## 6. Numerical and Modular Correctness

DP values overflow quietly. Climbing-stairs counts and grid-path counts grow combinatorially; `grid(40,40)` already exceeds 64-bit range. Senior discipline:

- **Take results mod a prime** (`10^9+7`) when the problem asks for a count modulo — reduce after every `+`/`×` in the transition so no intermediate overflows.
- **Use 64-bit accumulators** even when the modulus fits in 32 bits, because the product before reduction needs the width.
- **Beware language `%` semantics** — in Go/Java `%` can return negative for negative operands; for DP over `(min,+)`/subtractive transitions, normalize with `((x % m) + m) % m`.
- **Avoid floating point for exact counts.** A `double` Fibonacci loses precision past `fib(79)`; counts must stay integer or modular.
- **Sentinel for "unreachable"** in optimization DPs must be the semiring identity (`+∞` for min, `−∞` for max) and must not silently participate in arithmetic that overflows (clamp before adding to avoid `INT_MAX + w` wraparound).

---

## 7. Cache Data-Structure Selection

The "cache" in memoization is not a single thing; the choice has order-of-magnitude consequences.

### 7.1 Decision matrix

| State shape | Best cache | Why |
|-------------|-----------|-----|
| Dense small integer (`0..n`) | Flat array / slice | True `O(1)`, no hashing, cache-line friendly |
| Two small integers (`r,c`) | 2D array, or 1D with `r*C+c` | Index arithmetic beats tuple hashing |
| Sparse / large integer domain | Hash map | Only stores reached states |
| Tuple with a set/bitmask dimension | Hash map keyed by packed bitmask | Pack the set into an integer to hash cheaply |
| Strings / variable-length keys | Hash map with a precomputed key, or interned ids | Avoid rehashing the same long key |

The recurring rule: **if the state injects into a contiguous integer range, use an array.** Hashing is for when the reachable set is sparse relative to the domain — precisely memoization's sweet spot.

### 7.2 Sentinel values vs presence flags

An array cache needs a way to say "not yet computed." Two approaches:

- **Out-of-range sentinel** (`-1` for non-negative answers): one array, one comparison. Fastest, but only works when a value is reserved.
- **Parallel `seen[]` boolean** (or a `visited` bitset): correct for *any* value domain, costs a second array. Required when `0` or negative numbers are legitimate answers and no sentinel is free.

A classic bug: using `0` as "uncomputed" for a DP whose legitimate answer can be `0` (e.g. min-cost where some path costs `0`), causing endless recomputation or wrong reuse. Use an explicit `seen[]` flag in that case.

### 7.3 Key packing

For a multi-dimensional state, packing the key into a single integer is both faster and less error-prone than a tuple/object key:

```
key = ((r * C) + c) * (K + 1) + coins      // for state (r, c, coins)
```

Packing must be **injective** over the actual ranges — overflow or a too-small radix silently collides distinct states (the cache-key-collision failure mode). Always verify `max packed key < type max` and that each factor exceeds its dimension's range.

---

## 8. Profiling and Benchmarking the Two Styles

Asymptotically the two styles tie; the decision is driven by measured constants and resource ceilings, so benchmark, don't guess.

### 8.1 What to measure

- **Wall-clock per call** at representative `n` — captures call-frame + hash overhead of memoization vs array indexing of tabulation.
- **Peak RSS** — captures cache growth and table size; the differentiator in the memory-bound regime.
- **Allocation rate / GC pressure** — recursive memoization that boxes keys (e.g. Java `Integer`, Python tuples) allocates per call and stresses the collector; flat-array tabulation allocates once.
- **Recursion depth high-water mark** — proximity to the stack ceiling; a hard ceiling, not a gradient.

### 8.2 Typical findings (Fibonacci-class, dense `O(n)` DP)

On the same correct recurrence, expect roughly:

- Tabulation with two rolling variables: fastest, `O(1)` memory, zero allocations in the loop.
- Tabulation with a full array: marginally slower (memory writes), `O(n)` memory.
- Array-backed memoization: ~1.5–3× slower than tabulation (call frames), `O(n)` memory + `O(n)` stack — overflows past the depth ceiling.
- Hash-map-backed memoization: ~3–10× slower (hashing + boxing), highest memory, same depth risk.

The asymptotics are identical; the spread is entirely constants and ceilings. This is why "convert validated memoization to tabulation in the hot path" is standard senior guidance — and why you confirm the win with a benchmark rather than assuming it.

### 8.3 Micro-benchmark hygiene

- Warm up the JIT (Java) / interpreter caches before timing; discard the first iterations.
- Clear any module-level cache between runs so you measure a cold computation, not a lookup.
- Pin `n` large enough that the DP dominates harness overhead, but below the memoization depth ceiling so both styles can be compared fairly.
- Measure memory at steady state, not peak transient, unless transient peak is what causes your OOM.

---

## 9. Code Examples

### 9.1 Iterative (stack-safe) memoization

Top-down laziness without the call-stack ceiling, demonstrated on grid paths. We simulate recursion with an explicit work stack and a "post" phase that combines children once they are computed.

#### Go

```go
package main

import "fmt"

type cell struct{ r, c int }

// Iterative top-down: explicit stack avoids deep call recursion.
func gridIterMemo(R, C int) int64 {
	cache := make(map[cell]int64)
	type frame struct {
		s     cell
		phase int // 0 = expand, 1 = combine
	}
	start := cell{R - 1, C - 1}
	stack := []frame{{start, 0}}
	for len(stack) > 0 {
		f := stack[len(stack)-1]
		s := f.s
		if s.r == 0 && s.c == 0 {
			cache[s] = 1
			stack = stack[:len(stack)-1]
			continue
		}
		if _, done := cache[s]; done {
			stack = stack[:len(stack)-1]
			continue
		}
		up := cell{s.r - 1, s.c}
		left := cell{s.r, s.c - 1}
		if f.phase == 0 {
			stack[len(stack)-1].phase = 1 // revisit to combine
			if s.c > 0 {
				if _, ok := cache[left]; !ok {
					stack = append(stack, frame{left, 0})
				}
			}
			if s.r > 0 {
				if _, ok := cache[up]; !ok {
					stack = append(stack, frame{up, 0})
				}
			}
		} else {
			var v int64
			if s.r > 0 {
				v += cache[up]
			}
			if s.c > 0 {
				v += cache[left]
			}
			cache[s] = v
			stack = stack[:len(stack)-1]
		}
	}
	return cache[start]
}

func main() { fmt.Println(gridIterMemo(3, 3)) } // 6
```

#### Java

```java
import java.util.*;

public class GridIter {
    static long gridIterMemo(int R, int C) {
        Map<Long, Long> cache = new HashMap<>();
        Deque<long[]> stack = new ArrayDeque<>(); // {r, c, phase}
        long start = key(R - 1, C - 1, C);
        stack.push(new long[]{R - 1, C - 1, 0});
        while (!stack.isEmpty()) {
            long[] f = stack.peek();
            int r = (int) f[0], c = (int) f[1];
            long k = key(r, c, C);
            if (r == 0 && c == 0) { cache.put(k, 1L); stack.pop(); continue; }
            if (cache.containsKey(k)) { stack.pop(); continue; }
            if (f[2] == 0) {
                f[2] = 1;
                if (c > 0 && !cache.containsKey(key(r, c - 1, C)))
                    stack.push(new long[]{r, c - 1, 0});
                if (r > 0 && !cache.containsKey(key(r - 1, c, C)))
                    stack.push(new long[]{r - 1, c, 0});
            } else {
                long v = 0;
                if (r > 0) v += cache.get(key(r - 1, c, C));
                if (c > 0) v += cache.get(key(r, c - 1, C));
                cache.put(k, v);
                stack.pop();
            }
        }
        return cache.get(start);
    }
    static long key(int r, int c, int C) { return (long) r * C + c; }
    public static void main(String[] a) { System.out.println(gridIterMemo(3, 3)); } // 6
}
```

#### Python

```python
def grid_iter_memo(R, C):
    cache = {}
    # stack holds (r, c, phase); phase 0 expands, phase 1 combines
    stack = [(R - 1, C - 1, 0)]
    while stack:
        r, c, phase = stack[-1]
        if (r, c) == (0, 0):
            cache[(r, c)] = 1
            stack.pop()
            continue
        if (r, c) in cache:
            stack.pop()
            continue
        if phase == 0:
            stack[-1] = (r, c, 1)
            if c > 0 and (r, c - 1) not in cache:
                stack.append((r, c - 1, 0))
            if r > 0 and (r - 1, c) not in cache:
                stack.append((r - 1, c, 0))
        else:
            v = 0
            if r > 0:
                v += cache[(r - 1, c)]
            if c > 0:
                v += cache[(r, c - 1)]
            cache[(r, c)] = v
            stack.pop()
    return cache[(R - 1, C - 1)]


if __name__ == "__main__":
    print(grid_iter_memo(3, 3))  # 6
```

### 9.1b Platform-specific deep-recursion controls

When you must keep a recursive memo at moderate-but-deep `n`, each runtime offers a knob — all stopgaps, none changing the linear depth growth.

#### Go

```go
// Go goroutine stacks grow automatically (up to a large cap), so deep
// recursion often "just works" — but you can run the recursion on a
// goroutine with a generous initial stack and recover from a stack panic
// is NOT possible; the only real fix is to convert to iterative.
// Prefer tabulation; below is the warm-up trick (bottom-up fill behind a
// recursive-looking API).
func warmFib(n int) []int64 {
	dp := make([]int64, n+1)
	if n >= 1 {
		dp[1] = 1
	}
	for i := 2; i <= n; i++ {
		dp[i] = dp[i-1] + dp[i-2] // cache fully warmed bottom-up
	}
	return dp // a later "recursive" call finds everything precomputed
}
```

#### Java

```java
// Run the deep recursion on a thread with an enlarged stack (e.g. 64 MB).
// Stopgap only: linear depth still loses eventually.
static long deepMemo(int n) throws InterruptedException {
    final long[] result = new long[1];
    Thread t = new Thread(null, () -> {
        result[0] = fib(n, new java.util.HashMap<>());
    }, "deep", 64L * 1024 * 1024);   // 64 MB stack
    t.start();
    t.join();
    return result[0];
}
static long fib(int n, java.util.Map<Integer,Long> c) {
    if (n < 2) return n;
    Long v = c.get(n); if (v != null) return v;
    long r = fib(n-1,c) + fib(n-2,c); c.put(n, r); return r;
}
```

#### Python

```python
import sys

# Raise the Python-level limit; the C stack underneath still caps you,
# so this only buys a constant factor. Tabulate for truly large n.
def deep_memo(n):
    sys.setrecursionlimit(max(1000, n + 50))
    cache = {}
    def fib(k):
        if k < 2:
            return k
        if k in cache:
            return cache[k]
        cache[k] = fib(k - 1) + fib(k - 2)
        return cache[k]
    return fib(n)
```

The honest takeaway in all three: these knobs delay the overflow but do not remove it. Production code that must scale converts to tabulation (Section 2.2) or iterative memoization (Section 9.1).

### 9.2 Bounded cross-query cache (LRU) for repeated Fibonacci-style queries

#### Python

```python
from functools import lru_cache

# Bounded so the process memory cannot grow without limit across queries.
@lru_cache(maxsize=100_000)
def fib(n):
    # WARNING: still O(n) recursion depth — only safe for moderate n.
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

# For large n, ship the iterative version and keep the cache for hot keys.
def fib_iter(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```

---

### 9.3 Path reconstruction with bounded memory

A frequent production requirement: return the *witness* (the actual sequence of choices), not just the optimal value — but the full `Θ(R·C)` table won't fit. Three strategies, in increasing sophistication:

1. **Store parent pointers** alongside the value. Same `Θ(states)` memory as the full table, but often cheaper per cell (one direction byte vs a wide value). Backtrack from the target.
2. **Hirschberg's divide-and-conquer reconstruction.** For sequence-alignment-style DPs, compute the optimal value with a rolling array in `O(C)` space, then recurse on halves to recover the path in `O(R·C)` time and `O(C)` space total — trading a constant time factor for an order-of-magnitude memory reduction. This is the canonical "rolling array but I still need the path" answer.
3. **Recompute on demand.** Keep only the value (rolling array); when the path is requested, recompute segments lazily. Viable when path requests are rare relative to value queries.

The senior point: a rolling array does *not* unconditionally forbid reconstruction — it forbids *naive* backtracking. Hirschberg shows the reconstruction can be recovered at `O(C)` space with a clever schedule, which is exactly the kind of trade-off a production memory budget forces.

### 9.4 When to keep both implementations in the codebase

It is sometimes correct to ship *both* a memoized and a tabulated solver:

- The memoized one is the **readable reference / oracle** used in tests (Section 10.2) and on small inputs where its clarity aids debugging.
- The tabulated one is the **production path** for large or deep inputs.
- A feature flag or input-size threshold routes between them; a continuous equivalence assertion (in tests or a canary) guarantees they never diverge.

This is the operational embodiment of Theorem 6.1 (the two compute the same function): you exploit the equivalence both as a correctness check and as a performance switch.

---

## 10. Observability and Testing

### 10.1 Metrics that catch DP regressions

- **Cache hit ratio.** `hits / (hits + misses)`. A sudden drop means the state key changed (more states, less overlap) — often a correctness or performance regression. Instrument the memo wrapper to count both.
- **Distinct-states gauge.** Track `len(cache)` at the end of each evaluation. It is your live `|States|` measurement; an unexpected jump signals state-design drift.
- **Recursion-depth high-water mark.** For memoized solvers, record max depth reached; alert before it nears the platform ceiling.
- **Table memory.** Emit the allocated table size; a config change that bumps `k` can silently 10× memory.

### 10.2 Testing strategy

- **Equivalence test:** assert memoization and tabulation return identical results on a randomized suite of small inputs. They are two implementations of the same function; any divergence is a bug in one.
- **Brute-force oracle:** for counting DPs, a naive exponential enumerator on tiny inputs is the ground truth.
- **Property tests:** monotonicity (more stairs ⇒ at least as many ways), boundary identities (`grid(1,C)=1`, `fib(0)=0`), and the modular invariant (answer < `p`).
- **Determinism:** clear any module-level cache between test cases so stale state doesn't leak — a frequent cause of flaky DP tests.
- **Stress depth:** a test at the largest supported `n` that asserts the *tabulated* path does not overflow and the *memoized* path either succeeds or fails fast with a clear error (not a segfault).

---

## 11. Failure Modes

| Failure | Trigger | Detection | Mitigation |
|---------|---------|-----------|------------|
| Stack overflow | Memoized recursion at deep `n` | Crash / `StackOverflowError` | Tabulate or iterative-memo |
| OOM from unbounded cache | Long-lived cross-query memo | Rising RSS, distinct-states gauge | Per-call scope or LRU `maxsize` |
| Silent integer overflow | Combinatorial counts exceed 64-bit | Negative/garbage answers | Mod `p` or big integers |
| Stale cache between queries | Shared mutable cache | Flaky, query-order-dependent results | Scope per request; clear in tests |
| Wrong rolling-array direction | Dimension reduced, loop reversed | Off-by-one wrong counts | Match iteration to dependency window |
| Lost path reconstruction | Rolled away the table | Can't answer "which path" | Keep full table or parent pointers |
| Re-search cost in IDDFS | No transposition table | Latency spikes | Persist memo across depth bounds |
| Eviction mid-evaluation | LRU evicts active dependency | Recompute storms, depth growth | Never evict within one evaluation |
| Cache-key collision | Incomplete state in key | Wrong but plausible answers | Include every state parameter |

---

### 11.1 Quick triage table for incidents

| Symptom in prod | Likely root cause | First check | Fix |
|-----------------|-------------------|-------------|-----|
| Intermittent crash on large inputs | Memo stack overflow | depth high-water metric | Tabulate / iterative memo |
| Slowly rising RSS over days | Unbounded cross-query cache | distinct-states gauge | Scope per call or LRU |
| Correct on small, wrong on big | Integer overflow | values vs 2^63 | mod `p` or big ints |
| Flaky, order-dependent results | Shared mutable cache | run isolation | Per-request cache; clear in tests |
| Right value, missing route | Rolling array discarded path | reconstruction request path | Hirschberg / parent pointers |
| Latency spike under load | No parallelism / re-search | CPU profile | Anti-diagonal parallel fill / transposition table |

Keep this table in the runbook; every row maps a metric to a fix already covered above.

---

## 11b. A Production Decision Walkthrough

Concrete scenario: a routing service evaluates a grid-path-style DP (`dp[r][c] = cost[r][c] + min(dp[r-1][c], dp[r][c-1])`) on tiles up to `20000 × 20000`, at ~500 requests/second, and must return the chosen route for ~5% of requests.

1. **Depth.** A memoized solver has depth up to `R + C − 2 ≈ 40000` — overflows Java/Python stacks. **Decision: tabulate.**
2. **Memory.** A full `int32` table is `20000² × 4 ≈ 1.6 GB` — exceeds the per-request budget. A rolling row is `20000 × 4 = 80 KB`. **Decision: rolling row for the value.**
3. **Reconstruction.** 5% of requests need the route, which a rolling row alone can't reconstruct. **Decision: Hirschberg-style** `O(C)`-space reconstruction for those requests (Section 9.3), accepting a ~2× time factor on that 5%.
4. **Throughput.** 500 rps × `O(R·C)` = `2 × 10^11` cell-ops/sec naively — too much. **Decision: anti-diagonal parallelism** (states with equal `r+c` are independent) across cores, plus a per-worker reused buffer to avoid allocation churn.
5. **Correctness gate.** A memoized reference (small grids) and a brute-force oracle (tiny grids) run in CI as the equivalence test; production emits the distinct-states/row-memory metrics from Section 10.1.

Notice every decision is pinned to a *constraint* — depth, memory, reconstruction, throughput, correctness — not to a preference. That is the senior method: the recurrence is fixed; the engineering is choosing and instrumenting the evaluation strategy.

---

## 12. Summary

The recurrence is the easy part; the strategy is where production breaks. **Memoization** buys laziness and sparsity but pays in call-stack depth (overflow at large `n`) and unbounded cache growth (OOM in services). **Tabulation** buys flat iteration (no stack ceiling), tight constants, and natural rolling-array space reduction, at the cost of computing every in-range state and losing path history when dimensions are rolled away. Senior practice: choose the style from the dominant constraint (depth, memory, latency, reconstruction), bound the stack (tabulate or iterate the recursion explicitly), bound the cache (per-call scope or LRU, never evicting active dependencies), keep arithmetic exact (mod `p`, 64-bit accumulators, careful `%` sign handling), and instrument hit ratio, distinct-states, depth, and table memory so regressions surface as metrics rather than incidents. Validate by asserting the two styles agree against a brute-force oracle on small inputs.

---

## Further Reading

- *Introduction to Algorithms* (CLRS) — Chapter 15, plus the discussion of reconstructing optimal solutions with parent pointers.
- *Programming Pearls* (Bentley) — column on space–time trade-offs and table sizing.
- `functools.lru_cache` source and Guava `CacheBuilder` docs — bounded-cache semantics and eviction.
- Sibling `13-dynamic-programming` topics on knapsack and digit DP — large state spaces and dimension reduction in practice.
- Russell & Norvig, *AIMA* — iterative deepening and transposition tables for game-tree DP.
- `19-number-theory/10-matrix-exponentiation` — collapsing linear-recurrence DP to `O(log n)` to sidestep depth entirely.
