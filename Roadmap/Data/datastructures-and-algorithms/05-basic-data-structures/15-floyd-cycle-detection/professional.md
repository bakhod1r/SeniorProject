# Floyd's Cycle Detection -- Mathematical Foundations

## Table of Contents

1. [Formal Definition](#formal-definition)
2. [Correctness Proof -- Detection Phase](#correctness-proof----detection-phase)
3. [Correctness Proof -- Cycle-Start Identity](#correctness-proof----cycle-start-identity)
4. [Tightness of the Bound](#tightness-of-the-bound)
5. [Why fast = 2x slow is Essentially Unique](#why-fast--2x-slow-is-essentially-unique)
6. [Expected Runtime for Pollard's Rho via the Birthday Paradox](#expected-runtime-for-pollards-rho-via-the-birthday-paradox)
7. [Comparison with Brent's Algorithm](#comparison-with-brents-algorithm)
8. [Information-Theoretic Lower Bounds](#information-theoretic-lower-bounds)
9. [Cache-Oblivious Analysis](#cache-oblivious-analysis)
10. [Reduction Sketches](#reduction-sketches)
11. [Summary](#summary)

---

## Formal Definition

Let `f : S -> S` be a function over a finite or pseudo-finite set `S` and `x_0 in S` a starting point. Define the trajectory:

```text
x_0, x_1 = f(x_0), x_2 = f(x_1), ..., x_i = f^i(x_0), ...
```

Because `S` is finite, the sequence is eventually periodic. Formally:

```text
There exist unique integers mu >= 0 and lambda >= 1 such that:
  x_i = x_j  iff  i, j >= mu and i = j (mod lambda).
```

`mu` is the **tail length** (number of pre-periodic elements). `lambda` is the **cycle length** (the period of the orbit once inside the cycle). The pair `(mu, lambda)` characterizes the trajectory.

**Floyd's algorithm** (1967, attributed by Knuth) computes a pair `(p, q)` with `p = q` and both inside the cycle, using only constant auxiliary storage. The algorithm has three phases:

```text
PHASE 1 -- detection:
    tortoise <- f(x_0)
    hare     <- f(f(x_0))
    while tortoise != hare:
        tortoise <- f(tortoise)
        hare     <- f(f(hare))
    # invariant: tortoise = hare = some point p inside the cycle

PHASE 2 -- find cycle entry (compute mu):
    mu <- 0
    tortoise <- x_0
    while tortoise != hare:
        tortoise <- f(tortoise)
        hare     <- f(hare)
        mu <- mu + 1
    # invariant: tortoise = hare = cycle entry; mu = tail length

PHASE 3 -- find cycle length (compute lambda):
    lambda <- 1
    hare <- f(tortoise)
    while tortoise != hare:
        hare <- f(hare)
        lambda <- lambda + 1
    # invariant: hare = tortoise after one full lap; lambda = cycle length
```

All three phases together run in `O(mu + lambda)` time using `O(1)` extra storage.

---

## Correctness Proof -- Detection Phase

**Claim.** If `f` has a trajectory of tail length `mu` and cycle length `lambda` from `x_0`, then within at most `mu + lambda` iterations of Phase 1, the loop terminates with `tortoise = hare`.

**Proof.** Define position functions:

```text
pos_tortoise(i) = i
pos_hare(i)     = 2i
```

(After iteration `i`, tortoise is at `x_i`, hare is at `x_{2i}`.)

For the two to coincide we need `i = 2i (mod lambda)` -- equivalently `i = 0 (mod lambda)` -- **and** both `i` and `2i` must be at least `mu` (otherwise they are still in the tail and pointer equality is by index, not by cycle position).

Pick `i = lambda * ceil(mu / lambda)`. Then `i >= mu` and `i` is a multiple of `lambda`, so:

- `pos_tortoise(i) = i >= mu`, inside the cycle, at offset `0 (mod lambda)` from the entry.
- `pos_hare(i) = 2i >= 2mu >= mu`, inside the cycle, at offset `0 (mod lambda)` from the entry.

Both pointers are at the same cycle offset, hence at the same node. Termination occurs no later than iteration `lambda * ceil(mu / lambda) <= mu + lambda`.

**Termination bound.** The detection loop runs at most `mu + lambda - 1` iterations beyond the initial assignment. Total work: `O(mu + lambda) = O(n)` where `n = mu + lambda` is the orbit size.

**Q.E.D.**

---

## Correctness Proof -- Cycle-Start Identity

**Claim.** Let `p` be the meeting point of tortoise and hare in Phase 1, found after some number of iterations `T`. Then `p` lies inside the cycle at offset `m` from the cycle entry, where `m` satisfies:

```text
mu = k * lambda - m   for some integer k >= 1
```

equivalently:

```text
mu + m = k * lambda    (mu + m is a multiple of lambda)
```

**Proof.** After `T` iterations, the tortoise has walked `T` steps and the hare has walked `2T` steps. Both are at position `p` inside the cycle:

```text
T   = mu + m            (tortoise: walked tail + m around cycle)
2T  = mu + m + k*lambda (hare: walked tail + m + k full laps)
```

Subtracting:

```text
T = k * lambda
mu + m = k * lambda
mu = k * lambda - m                                          (*)
```

**Phase 2 algorithm correctness.** Reset one pointer to `x_0` and walk both pointers one step at a time. After `mu` steps:

- The reset pointer has walked `mu` and arrived at the cycle entry (by definition of `mu`).
- The other pointer started at `p` (offset `m` inside cycle). After `mu` steps it is at offset `m + mu (mod lambda) = m + (k * lambda - m) (mod lambda) = 0`, i.e. at the cycle entry.

Both pointers meet at the cycle entry. The walk takes exactly `mu` steps, which the algorithm counts to recover `mu`.

**Q.E.D.**

The identity `(*)` is the load-bearing mathematical fact of Floyd's algorithm. Every variation (Brent's, distributed token-passing, persistent-functional implementations) preserves it.

---

## Tightness of the Bound

**Claim.** No algorithm using `o(mu + lambda)` time can decide whether a sequence has a cycle in the iterated-function model.

**Proof sketch (decision-tree lower bound).** An adversary can produce a sequence of length `n = mu + lambda - 1` with no cycle by setting `f(x_{n-1}) = halt` (a distinguished "off the end" element). Any algorithm that has not visited `x_{n-1}` cannot distinguish this from a sequence where `f(x_{n-1}) = x_{mu}` (creating a cycle). To rule one out, the algorithm must touch position `n - 1`, which requires `n - 1 = mu + lambda - 2` function evaluations.

Floyd's runs in `mu + lambda` evaluations -- optimal up to a constant factor of 2 (it makes one `f` call for tortoise plus two for hare per iteration, so total f-evaluations is `~3T = 3(mu + lambda)`, but the question count is still `Theta(mu + lambda)`).

**Constant-factor analysis.** Brent's algorithm achieves a tighter constant: empirically ~36% fewer `f`-evaluations on uniform inputs. The asymptotic class is the same.

---

## Why fast = 2x slow is Essentially Unique

Consider the family of speed ratios `(1, k)` for integer `k >= 2`. The relative-offset invariant becomes:

```text
d_{i+1} = (d_i + (k - 1)) mod lambda
```

The offset cycles through every residue mod `gcd(k - 1, lambda)`. For the detection to be guaranteed in `O(lambda)` iterations on every `lambda`, we need `gcd(k - 1, lambda) = 1` for all `lambda`, which requires `k - 1 = 1`, i.e. `k = 2`.

**Specific cases.**

| Ratio `(1, k)` | Termination | Cycle-start formula |
|----------------|-------------|---------------------|
| `(1, 2)` | Guaranteed in `<= mu + lambda` | `mu = k * lambda - m` -- clean |
| `(1, 3)` | Only if `gcd(2, lambda) = 1`, i.e. odd `lambda` | `2T = T + k*lambda` => `T = k*lambda`; `mu + m = (k - some) * lambda` -- messier |
| `(1, k)` general | Only if `gcd(k - 1, lambda) = 1` | Requires solving `(k - 1) * mu = (k * something) * lambda - (k - 1) * m` -- depends on `k` |

The choice `k = 2` is the smallest ratio that guarantees detection on **every** cycle length while giving a clean cycle-start identity. Any other ratio either fails on some cycle lengths (composite `k - 1` and matching `lambda`) or yields a more complicated formula.

This is the formal answer to "why fast = 2 x slow and not 3 x slow?" The mathematical literature sometimes calls 2:1 the **minimum-coprime ratio**.

---

## Expected Runtime for Pollard's Rho via the Birthday Paradox

Pollard's rho applies Floyd's to:

```text
f(x) = (x^2 + c) mod n
```

where `n = p * q` is the composite to be factored and `p` is the (unknown) smallest prime factor. The key observation is that modulo `p`, the sequence behaves heuristically like a random walk on the residue set `{0, 1, ..., p - 1}`.

**Claim.** The expected number of steps before the sequence enters a cycle modulo `p` is `O(sqrt(p))`.

**Birthday-paradox argument.** A uniformly random function `g : {1, ..., p} -> {1, ..., p}` has, on a uniformly random orbit:

```text
E[mu + lambda] = sqrt(pi * p / 2) + O(1) = Theta(sqrt(p))
```

The argument: after `k` steps, the probability that no two `x_i` are equal modulo `p` is approximately

```text
prod_{i=0..k-1} (1 - i/p) ~= exp(-k(k-1) / (2p))
```

which drops below `1/2` when `k = Theta(sqrt(p))`. After that many steps the orbit revisits some residue, completing a cycle modulo `p`.

**Floyd's detects this cycle**, so Pollard's rho finds the factor in expected `O(sqrt(p))` `f`-evaluations. The total work is `O(sqrt(p) * cost(f))`, with `cost(f) = O(log^2 n)` for modular multiplication. Hence:

```text
E[runtime of Pollard's rho] = O(sqrt(p) * log^2 n) = O(n^{1/4} * log^2 n)
```

This is **much** better than trial division's `O(sqrt(n) * log n)` for large `n`. The breakthrough -- Floyd's-cycle-detection turning a heuristic random-walk argument into a sub-exponential factoring algorithm -- is why Floyd's appears in cryptanalysis textbooks.

**Caveat.** The "uniformly random function" assumption is heuristic; `f(x) = x^2 + c` is not actually random. Empirically the constant in `O(sqrt(p))` is small and the heuristic holds, but no polynomial-time deterministic algorithm matching this bound is known.

---

## Comparison with Brent's Algorithm

Brent's algorithm (1980) achieves the same asymptotic bound `O(mu + lambda)` with a smaller constant factor.

**Brent's idea.** Instead of running tortoise and hare in lockstep, run a single pointer (the "hare"). At intervals of `1, 2, 4, 8, ...` steps, snapshot the hare's position into the "tortoise." If at any point the hare equals the tortoise, a cycle is detected.

```text
power <- 1
lambda <- 1
tortoise <- x_0
hare <- f(x_0)
while tortoise != hare:
    if power == lambda:
        tortoise <- hare
        power <- 2 * power
        lambda <- 0
    hare <- f(hare)
    lambda <- lambda + 1
# lambda = cycle length directly
```

**Why it is faster.** Floyd's makes 3 `f`-calls per iteration (1 for tortoise, 2 for hare). Brent's makes 1 `f`-call per iteration. The total number of iterations is similar, so total `f`-calls is roughly `(2/3) * Floyd's`.

**Quantitative comparison.** On uniformly distributed function-iteration cycles:

| Algorithm | f-calls until detection | Constant in O(mu + lambda) |
|-----------|------------------------|----------------------------|
| Floyd's | `~3 * (mu + lambda)` | 3 |
| Brent's | `~1.98 * (mu + lambda)` | 1.98 |

Brent's saves ~36% on `f`-calls, which matters in Pollard's rho where each `f`-call is a 64-bit modular multiplication. In cryptanalysis libraries (GMP, OpenSSL's prime-finding) Brent's is the default.

**Trade-offs.** Brent's directly outputs `lambda` (no Phase 3 needed) but requires a separate pass to find `mu`. The cycle-start identity is the same: `mu = k * lambda - m`.

For non-cryptographic applications (workflow validation, replication monitoring), Floyd's is preferred because it is shorter, easier to audit, and the constant factor does not matter.

---

## Information-Theoretic Lower Bounds

**Question.** What is the minimum number of `f`-evaluations needed to detect a cycle?

**Lower bound (adversarial).** Suppose an oracle hides whether the sequence has a cycle. An algorithm that performs `T` `f`-evaluations cannot detect a cycle whose length is greater than `T`. So to detect any cycle the algorithm must perform at least `mu + 1` evaluations (otherwise the cycle could lie beyond what was inspected).

**Upper bound (Floyd's).** `~3(mu + lambda)`.

**Gap.** Brent's tightens the constant to `~1.98`. A natural question: is there an algorithm achieving `mu + lambda + o(mu + lambda)` evaluations? The answer is **no for comparison-based algorithms**: every cycle-detection algorithm in this model must, in the worst case, perform `Omega(mu + lambda)` evaluations.

**Memory lower bound.** Any algorithm using `O(1)` words of memory cannot detect cycles asymptotically faster than `O(mu + lambda)` -- otherwise we could compress the trajectory below its Kolmogorov complexity, which is impossible. Floyd's and Brent's are both optimal in this regime up to constants.

Allowing more memory: with `O(log n)` words, Cuckoo-hashing-based detection achieves `O(mu + lambda)` expected with very low constants. With `O(n)` words, hash-set detection is optimal at `mu + lambda + o(1)`.

The senior point: Floyd's is the unique tradeoff at the `O(1)`-memory frontier. Brent's improves the constant. Hash sets improve the constant further at the cost of `O(n)` memory.

---

## Cache-Oblivious Analysis

Floyd's reads pointers in trajectory order. In the external-memory model with block size `B`:

```text
I/Os for Floyd's = O((mu + lambda) / B)  if the trajectory is contiguous
                 = O(mu + lambda)         if the trajectory is scattered
```

**Contiguous case.** If the iterated-function data is laid out so that consecutive `x_i` values are in the same cache block (e.g. a contiguous array with `f(i) = i + 1`), Floyd's enjoys full streaming I/O performance. This is the regime where Floyd's beats hash-set detection by orders of magnitude on real hardware -- the hash set thrashes every block while Floyd's stays in L1.

**Scattered case.** For arbitrary pointer chains (linked lists with malloc-allocated nodes), each `f`-call is a cache miss. Floyd's makes 3 `f`-calls per iteration. The wall-clock cost is dominated by cache misses, not arithmetic.

For Pollard's rho the `f`-calls are arithmetic (no memory dereference), so cache behavior is irrelevant and Brent's constant-factor saving is observable in practice.

**Prefetching.** Modern hardware prefetchers can speculate on contiguous arrays but fail on linked lists. Manual prefetch hints (`__builtin_prefetch` in GCC, `_mm_prefetch` in Intel) reduce Floyd's latency by ~30% on linked-list inputs when the cycle is far from cache.

---

## Reduction Sketches

Floyd's algorithm appears as a primitive inside several higher-level reductions.

### Reduction: Find Duplicate Number (LeetCode 287) to Cycle Detection

Given an array `a[0..n]` with values in `[1, n]`, the function `f(i) = a[i]` has a fixed point cycle whose entry is the duplicate. Formally:

```text
By pigeonhole, since |range| = n and |domain| = n + 1, some i,j have a[i] = a[j].
f(i) = a[i] = a[j] = f(j) for i != j -- two indices map to the same image.
Treat the graph (i -> a[i]) as a functional graph. It has a cycle (because n+1 nodes,
n values, so the underlying directed graph has at least one repeated edge target).
The cycle's entry is the duplicate value.
```

Floyd's runs in `O(n)` time, `O(1)` space. The original array is read-only.

### Reduction: PRNG Period Verification

For a generator `next_state(x)`, the period is `lambda`. Floyd's phase 3 measures `lambda` directly in `O(lambda)` time. For regulator-grade audits this is the canonical method.

### Reduction: GC Cycle Pre-Check

Given a candidate root `r`, walk the "next reference" chain. If Floyd's reports a cycle, schedule a full cycle-collection; otherwise, refcounting suffices. The pre-check reduces cycle-collection frequency by an order of magnitude on heap-typical workloads.

---

## Persistent Floyd's

A **persistent** implementation preserves every intermediate state of the algorithm for later querying. Useful for debugging: "what was the tortoise pointing at after iteration 1000?"

**Construction.** Replace mutable pointers with append-only iteration-state records:

```text
state_i = { tortoise: x_i, hare: x_{2i}, iteration: i }
```

Store the full sequence `state_0, state_1, ...` in an array. Memory: `O(mu + lambda)`. Query: `O(1)` indexed access.

For production debugging, store only a sampled subset (every `1000`th iteration) and replay between samples. Memory `O((mu + lambda) / k)` for sample rate `k`.

---

## Summary

Floyd's cycle detection admits a tight `O(mu + lambda)`-time / `O(1)`-space bound. Correctness rests on two facts:

1. **Detection** -- the relative-offset invariant `d_{i+1} = (d_i + 1) mod lambda` cycles through every residue and must hit zero within `lambda` iterations.
2. **Cycle-start identity** -- after meeting at offset `m`, the equation `mu = k*lambda - m` lets a second pass starting from `x_0` recover `mu` in exactly `mu` more iterations.

The choice of `fast = 2 * slow` is essentially unique among small-integer ratios: it is the smallest `k` for which `gcd(k - 1, lambda) = 1` regardless of `lambda`.

Brent's algorithm improves the constant factor (~36% fewer `f`-calls) by snapshotting the tortoise at exponentially-growing intervals; this matters in Pollard's rho where each `f`-call is a costly modular multiplication.

Pollard's rho applied to integer factorization runs in expected `O(n^{1/4})` time via the birthday-paradox argument, dramatically better than trial division for large composites. The combination of Floyd's cycle-detection and the birthday paradox -- two of the most elegant ideas in algorithm design -- is the entire content of one of the most-cited number-theoretic algorithms of the 20th century.

The algorithm is asymptotically optimal among `O(1)`-memory cycle detectors. Improvements require either more memory (hash-set, `O(n)`) or weaker guarantees (probabilistic, false positives).
