# LFU Cache — Mathematical Foundations and Complexity Theory

## Table of Contents

1. [Formal Model and Notation](#formal-model-and-notation)
2. [The LFU Invariants](#the-lfu-invariants)
3. [Proof of O(1) for Every Operation](#proof-of-o1-for-every-operation)
4. [The minFreq Monotonicity Lemma](#the-minfreq-monotonicity-lemma)
5. [The Independent Reference Model](#the-independent-reference-model)
6. [LFU Optimality on Stationary Skewed Workloads](#lfu-optimality-on-stationary-skewed-workloads)
7. [LFU vs LRU: When Each Wins](#lfu-vs-lru-when-each-wins)
8. [Competitive Analysis and the Non-Optimality of Pure LFU](#competitive-analysis-and-the-non-optimality-of-pure-lfu)
9. [Formal Analysis of the Aging Problem](#formal-analysis-of-the-aging-problem)
10. [Decay as Exponential Forgetting](#decay-as-exponential-forgetting)
11. [Morris Counter Error Bounds](#morris-counter-error-bounds)
12. [TinyLFU Admission Theory](#tinylfu-admission-theory)
13. [Comparison of Theoretical Guarantees](#comparison-of-theoretical-guarantees)
14. [Notation and Definitions Reference](#notation-and-definitions-reference)
15. [Summary](#summary)

---

## Formal Model and Notation

```text
Definition (LFU cache). An LFU cache of capacity k is a tuple
  C = (U, k, S, freq, rec)  where
    U          = universe of keys
    k in N      = capacity (max resident keys)
    S subset U  = resident set, |S| <= k
    freq: S -> N>0   = access count of each resident key
    rec:  S -> N      = recency stamp (last-access tick) of each resident key

On a request to key x (a get or put):
  - HIT  (x in S):  freq(x) <- freq(x) + 1;  rec(x) <- now
  - MISS (x not in S):
        if |S| = k:  evict v = argmin over S of (freq, rec)  [lexicographic]
        S <- S ∪ {x};  freq(x) <- 1;  rec(x) <- now

Eviction victim:
  v = argmin_{u in S} (freq(u), rec(u))          (ties: smaller rec = older)
```

The lexicographic `(freq, rec)` ordering encodes "least frequent, then least recently used among ties." The O(1) data structure (key map + frequency map of recency-ordered DLLs + `minFreq`) realizes this argmin without search.

We write `n = |S|` for the number of resident keys, `f_min = min_{u in S} freq(u)` for the current minimum frequency, and `B_f` for the **frequency bucket** = `{u in S : freq(u) = f}`, stored as a doubly linked list ordered by `rec` (front = largest rec = most recent).

The state and its transitions, viewed formally:

```mermaid
flowchart TD
    Req[Request key x] --> Hit{x in S?}
    Hit -->|yes| Inc["freq(x)++, rec(x)=now<br/>promote: B_f to B_{f+1}"]
    Hit -->|no, |S|<k| Ins["S = S ∪ {x}<br/>freq(x)=1, minFreq=1"]
    Hit -->|no, |S|=k| Ev["evict argmin (freq,rec)<br/>= back of B_minFreq"]
    Ev --> Ins
    Inc --> Inv["invariants I1,I2,I3 restored"]
    Ins --> Inv
```

---

## The LFU Invariants

The implementation maintains three invariants after every completed operation. All correctness rests on them.

```text
(I1) Bucket partition.  The buckets {B_f : f >= 1, B_f != empty} partition S:
       every resident key is in exactly one bucket, namely B_{freq(key)}.

(I2) Per-bucket recency order.  Within each B_f, nodes are ordered
       front -> back by strictly decreasing rec. Hence back(B_f) is the
       least-recently-used key among those of frequency f.

(I3) minFreq correctness at eviction.  Immediately before any eviction,
       minFreq = f_min = min{ f : B_f != empty }.
```

**Why these suffice.** The eviction victim is `argmin (freq, rec)`. By (I3) the smallest non-empty frequency is `minFreq`, so the victim has `freq = minFreq`, i.e. it lies in `B_{minFreq}`. By (I2), among keys of that frequency the least recently used is `back(B_{minFreq})`. Therefore `back(B_{minFreq})` is exactly the lexicographic argmin. Evicting it satisfies the policy. ∎

---

## Proof of O(1) for Every Operation

We prove each operation performs a constant number of hash-map operations and pointer rewires. Hash-map operations are O(1) expected (amortized, under simple uniform hashing / standard table doubling); the DLL operations are O(1) worst-case.

### get(x)

```text
get(x):
  1. look up x in keyMap                       -- 1 hash op
  2. if absent: return -1                       -- O(1)
  3. promote(node)                              -- see below
  4. return node.value                          -- O(1)
```

### promote(node) — the only frequency increment

```text
promote(node):
  f = node.freq
  remove node from B_f                          -- 4 pointer writes (DLL unlink)
  if B_f became empty:
      delete freqMap[f]                          -- 1 hash op
      if minFreq == f: minFreq = f + 1           -- O(1)
  node.freq = f + 1                              -- O(1)
  if freqMap[f+1] absent: create empty DLL       -- 1 hash op
  pushFront(B_{f+1}, node)                        -- 4 pointer writes
```

Every line is O(1): bounded hash operations plus a bounded number of pointer assignments. No loop, no scan. **promote is O(1).** Therefore **get is O(1).**

### put(x, v)

```text
put(x, v):
  if capacity == 0: return                       -- O(1)
  if x in keyMap:                                 -- 1 hash op
      node.value = v; promote(node); return       -- O(1)
  if n == capacity:                               -- eviction
      victim = popBack(B_{minFreq})                -- DLL pop: 4 pointer writes
      delete keyMap[victim.key]                    -- 1 hash op
  create node(x,v,freq=1)                          -- O(1)
  keyMap[x] = node                                 -- 1 hash op
  pushFront(B_1, node)                             -- 4 pointer writes
  minFreq = 1                                      -- O(1)
```

The eviction reads `B_{minFreq}` directly — no search — because of (I3). Insertion sets `minFreq = 1` unconditionally (justified by the Monotonicity Lemma below). Bounded work throughout. **put is O(1) (expected, amortized over hash table resizes).** ∎

**Space.** The key map holds ≤ k entries; the union of all buckets holds ≤ k nodes (I1); each non-empty bucket is one DLL object. So total space is **Θ(k) = Θ(capacity)**, independent of |U|.

---

## The minFreq Monotonicity Lemma

This lemma is the linchpin: it shows `minFreq` is maintained correctly with O(1) updates and no search.

```text
Lemma (minFreq maintenance). Maintaining the rules
    (R1) on insert of a new key: set minFreq <- 1;
    (R2) on promote of a node from frequency f, if B_f becomes empty
         and minFreq == f: set minFreq <- f + 1;
preserves invariant (I3) — minFreq = f_min at every eviction point.

Proof.
  Evictions occur only inside put, immediately before an insert.
  Consider the value of minFreq just before such an eviction.

  Case A (the last structural change was an insert, R1).
    R1 set minFreq = 1, and that insert created a key with freq = 1,
    so B_1 != empty and f_min = 1 = minFreq. (I3) holds.

  Case B (the last change was a promote from f, R2 fired).
    The promoted node moved into B_{f+1}, so B_{f+1} != empty, and B_f
    became empty with minFreq updated to f+1. No bucket below f+1 became
    non-empty during a promote (promote only moves a node UP by one and
    creates no smaller bucket). Thus f_min = f+1 = minFreq. (I3) holds.

  Case C (a promote from f occurred but R2 did NOT fire).
    Then either B_f is still non-empty (f_min unchanged, minFreq unchanged,
    still = f_min), or minFreq != f (so emptying B_f does not affect the
    minimum). Either way minFreq still equals f_min.

  In all cases minFreq = f_min at the next eviction. By induction over the
  operation sequence, (I3) holds whenever an eviction reads minFreq. ∎
```

The key structural facts: **promote raises a frequency by exactly 1** (so the minimum can only rise by 1, never jump), and **insert always reintroduces frequency 1** (so the minimum collapses to 1). The minimum therefore moves in unit steps or resets — never requiring a search over buckets. This is precisely why LFU achieves O(1) where a frequency-min-heap would cost O(log n) per access.

---

## The Independent Reference Model

To reason about *which* policy gives the best hit ratio, we use the standard analytic workload model.

```text
Independent Reference Model (IRM). Each request draws a key independently
from a fixed distribution p = (p_1, p_2, ..., p_m), where p_i = Pr[request = key i],
sum p_i = 1. Requests are i.i.d. (no temporal correlation).

A common instance is the Zipf distribution:
    p_i proportional to 1 / i^s,    rank i = 1..m,  skew s > 0.
Web, CDN, and DB workloads are empirically near-Zipfian with s in [0.6, 1.0].
```

Under the IRM, the *optimal* fixed cache (maximizing steady-state hit ratio) is the set of the **k most probable keys** — the top-k by `p_i`. Call this `OPT_k`. Its hit ratio is `H* = sum_{i in top-k} p_i`. The question for each online policy is: *does it converge to caching OPT_k?*

---

## LFU Optimality on Stationary Skewed Workloads

```text
Theorem (LFU is asymptotically optimal under the IRM).
Under the Independent Reference Model with a fixed distribution p, as the
number of requests t -> infinity, an (exact, non-decaying) LFU cache of
capacity k holds the top-k most probable keys with probability -> 1, and its
hit ratio converges to the optimal H* = sum_{i in top-k} p_i.

Proof sketch.
  Let N_i(t) = number of requests to key i in the first t requests.
  By the strong law of large numbers, N_i(t)/t -> p_i almost surely.
  Hence for any two keys i, j with p_i > p_j, there exists T such that for
  all t > T, N_i(t) > N_j(t) almost surely (their frequency ranks order by p).

  LFU evicts the resident key of smallest count. Once counts reflect the true
  ranking (t > T), any resident key outside the top-k has a smaller count than
  every top-k key, so it is the eviction target whenever a top-k key faults in.
  Thus the resident set converges to the top-k keys, achieving H*. ∎
```

**Interpretation.** On a **stationary** (unchanging distribution), **skewed** workload — exactly the IRM/Zipf setting — exact LFU is the *gold standard*: it provably learns and holds the optimal cache contents. This is the precise sense in which "LFU is best when frequency is what matters." The hidden assumption is **stationarity**: the distribution `p` must not change. When it does, the very property that gives optimality here (long memory of counts) becomes the aging problem.

LRU, by contrast, does **not** converge to OPT_k under the IRM; it caches recently-referenced keys, which under i.i.d. sampling are not necessarily the most probable. LRU's IRM hit ratio is strictly below LFU's on skewed `p` (it can be computed via the Che approximation / characteristic-time method, but is always ≤ H* and strictly < for non-degenerate skew).

---

## LFU vs LRU: When Each Wins

We can state the trade-off as a theorem about workload regimes.

```text
Regime 1 — Stationary skewed (IRM/Zipf, fixed p):
    LFU -> H* (optimal).  LRU -> H_LRU < H*.    LFU strictly better.

Regime 2 — Non-stationary (p shifts at change-points):
    Exact LFU is anchored by stale counts; after a shift it can take
    Omega(accumulated old count) requests to evict a formerly-hot key.
    LRU adapts within O(k) requests of the shift.   LRU better.

Regime 3 — Looping / sequential scan over a working set larger than k:
    LRU suffers Belady-anomaly-free but pessimal behavior (every access a
    miss for loop length > k). LFU treats scan keys as freq-1 and protects
    a high-frequency hot subset.   LFU better (scan-resistant).
```

The dividing line is **stationarity vs change**. LFU wins when the popularity distribution is stable (and rewards remembering it); LRU wins when it shifts (and rewards forgetting). Practical policies (decaying LFU, W-TinyLFU, ARC, 2Q) aim to be good in *all three* regimes by combining a frequency estimate with a recency mechanism — see the [senior level](./senior.md) and [ARC/2Q](../22-arc-2q-cache/professional.md).

---

## Competitive Analysis and the Non-Optimality of Pure LFU

Competitive analysis (worst-case, adversarial, no distributional assumption) is *unkind* to LFU.

```text
Definitions. For request sequence sigma, let f_A(sigma) = page faults of online
policy A, f_OPT(sigma) = faults of the offline optimum (Belady's MIN). A is
c-competitive if f_A(sigma) <= c * f_OPT(sigma) + b for all sigma.

Fact. Deterministic LRU and FIFO are k-competitive, and k is optimal for any
deterministic online paging policy (lower bound by the standard adversary).

Claim. Pure (non-decaying) LFU is NOT c-competitive for any constant c
independent of the sequence length; an adversary can force LFU into an
unbounded competitive ratio.

Adversary construction.
  Phase 1: request key A m times (m huge). Now freq(A) = m.
  Phase 2: with capacity k, repeatedly request a cyclic working set
           {B_1,...,B_k} that fits exactly if A is evicted. But A's count m
           dominates every B_j's growing count for the first ~m rounds, so LFU
           keeps A and thrashes one slot among the B_j's, faulting on nearly
           every Phase-2 request. OPT evicts A immediately and serves Phase 2
           with few faults. The ratio grows with m, unbounded. ∎
```

This is the aging problem expressed as a competitive lower bound: **stale counts have no bound on how long they mislead LFU.** It is the theoretical reason pure LFU is never deployed and why decay (bounded memory) is mandatory — a decayed LFU caps `m`'s influence and restores a bounded ratio. Note the contrast: LFU is *optimal* under the IRM (Regime 1) yet *arbitrarily bad* in the adversarial model — a textbook gap between average-case and worst-case analysis.

---

## Formal Analysis of the Aging Problem

```text
Setup. A key x receives F accesses during [0, t0], then zero accesses after t0.
With exact, non-decaying LFU, freq(x) = F + (init) for all time > t0.

Claim. x is evicted only after some other resident key accumulates count > F.
For a key y with arrival rate lambda_y (accesses/sec) after t0, y reaches count
F at expected time approximately F / lambda_y after t0.

Consequence. The "dead weight" duration D(x) during which the cold key x squats
a cache slot satisfies
    D(x) ≈ (F - c_y) / lambda_max
where lambda_max is the rate of the fastest-growing competitor and c_y its count
at t0. D(x) grows LINEARLY in the historical peak count F.
```

So the harm from a stale key is **proportional to how popular it once was** — the most-popular-ever keys are the worst polluters, and they persist longest. This quantifies why pure LFU's hit ratio decays steadily on non-stationary traces: each regime change strands its previous champions, and they each occupy a slot for a duration linear in their historical peak.

---

## Amortized and Aggregate Cost Accounting

A skeptic might worry that the `freqMap` grows or that emptying buckets costs more than O(1) amortized. We discharge that concern with an aggregate argument and a potential function.

```text
Aggregate method. Over any sequence of t operations on an LFU cache:
  - Each get/put performs O(1) hash ops and O(1) pointer rewires (shown above).
  - A bucket B_f is CREATED at most once per promotion or insert into it, and
    DESTROYED at most once when it empties. Each create/destroy is O(1).
  - The number of bucket creations <= number of promotions + inserts <= 2t.
  - Total work = O(t). Amortized per op = O(1).

Potential method. Define Phi(D) = (number of non-empty buckets) >= 0.
  - Insert: may create bucket 1 (Phi += 1); actual O(1); amortized O(1).
  - Promote from f: destroys B_f if it empties (Phi -= 1), creates B_{f+1} if new
    (Phi += 1). Net change in Phi in {-1, 0, +1}; actual O(1); amortized O(1).
  - Evict: removes a node, possibly destroys B_{minFreq} (Phi -= 1); amortized O(1).
  Since Phi >= 0 and Phi(D_0) = 0, sum of actual costs <= sum of amortized = O(t).
```

The potential never funds a hidden super-constant operation because every individual step touches a bounded number of buckets. There is no resize-style amortization hiding an O(n) worst case in the bucket machinery — the only amortization is the standard hash-table doubling underneath `keyMap`/`freqMap`.

---

## Worked Competitive Example on a Concrete Sequence

To make the unbounded ratio of [the previous section](#competitive-analysis-and-the-non-optimality-of-pure-lfu) tangible, trace a small instance.

```text
Capacity k = 2. Universe {A, B, C}. Sequence:
    A A A A   B C B C B C B C ...   (the BC loop repeats r times)

Phase 1 (A A A A): A enters (freq 1), promoted to freq 4. B not yet seen.
Phase 2 (B C B C ...):
  - First B: cache {A(4)}, room -> insert B(1). Cache {A(4), B(1)}.
  - First C: full. minFreq=1 bucket = {B}. Evict B. Insert C(1). Cache {A(4), C(1)}.
  - Next B: full. minFreq=1 bucket = {C}. Evict C. Insert B(1). Cache {A(4), B(1)}.
  - ... A (freq 4) is NEVER the minimum, so the second slot thrashes B<->C.
  Every Phase-2 request after the first is a MISS: 2r - 1 faults.

OFFLINE MIN on the same sequence:
  - Evict A right after Phase 1 (A is never requested again).
  - Keep {B, C} resident through the entire loop: 0 faults in the steady loop.
  Faults ≈ 3 (A, B, C compulsory) + 0 loop faults.

Ratio f_LFU / f_MIN ≈ (2r - 1 + const) / const  ->  unbounded as r -> infinity.
```

The single stale key `A` (freq 4) poisons one of the two slots forever, forcing the other slot to thrash. A decaying LFU halving every `tau` accesses would drop `A`'s effective count below `B`/`C`'s within `O(log 4)` decay periods, after which `A` is evicted and the loop runs fault-free — restoring a bounded ratio. This is the formal payoff of decay.

---

## Cost-Aware and Weighted Generalizations

Real caches (especially CDNs) weight eviction by object **size** and **fetch cost**, generalizing "least frequent" to "least valuable per byte."

```text
GreedyDual-Size-Frequency (GDSF). Each object x has a priority
    H(x) = clock + frequency(x) * cost(x) / size(x)
where `clock` is a running offset set to the H-value of the last evicted object
(an aging mechanism). Evict the object with minimum H(x). On access, recompute
H(x) with the incremented frequency. The `clock` term ages stale objects: an
object's H stays fixed while it is idle, so the global clock eventually surpasses
it, making it evictable — decay by another name.

Objective. GDSF approximately maximizes the cost hit ratio
    sum over hits of cost(x)
subject to sum of resident size(x) <= capacity (a fractional-knapsack flavor).
Plain frequency LFU is the special case cost = size = 1.
```

The `clock` offset is the elegant trick: it folds aging into the priority itself, so GDSF is simultaneously frequency-aware, size/cost-aware, and self-aging — which is why frequency-derived policies dominate production CDN eviction. (See [cdn-design] and [GreedyDual literature](#further-reading).)

---

## LFU-K and LRFU: Blending Frequency with Recency

Two influential generalizations interpolate between LFU and LRU on a tunable dial.

```text
LFU-K / LRU-K (O'Neil et al.). Track the time of the K-th-most-recent access to
each key (the "backward K-distance"). Evict the key whose K-th-to-last reference
is oldest. K = 1 recovers LRU; larger K weights frequency more (a key must have
been accessed K times recently to be protected). LRU-2 is a celebrated DB buffer
policy: scan-resistant yet adaptive, because a single scan touch does not build
the required K-history.

LRFU (Least Recently/Frequently Used). Assign each key a Combined Recency and
Frequency value
    CRF(x) = sum over past accesses i of  (1/lambda)^{ (t_now - t_i) }   , lambda in [0,1]
a weighted sum where recent accesses count more (exponential recency decay).
  - lambda -> 0: weights collapse so only the most recent access matters -> LRU.
  - lambda -> 1: all accesses count equally -> LFU.
Evict the key with minimum CRF. The exponential weighting is, again, DECAY: it is
exactly the multiplicative forgetting of the earlier section applied per-access.
```

Both frameworks confirm the recurring theme: **the useful operating point lives between pure LFU and pure LRU**, reached by attaching a recency-decay weight to frequency. W-TinyLFU (senior level) achieves the same blend with a frequency sketch plus an LRU window and an adaptive mixing knob, rather than a fixed `K` or `lambda`.

---

## Decay as Exponential Forgetting

Decay converts the *unbounded* memory above into a *bounded* (exponentially fading) memory, restoring adaptivity.

```text
Model (multiplicative decay). Let counts be halved every tau seconds (or every
N accesses). A burst of F accesses at time t0 contributes, at time t0 + m*tau,
an effective count of approximately F / 2^m.

Forgetting time. The contribution of an old burst drops below the count of a key
with steady rate lambda after
    m such that F / 2^m < lambda * tau
    => m > log2( F / (lambda * tau) )
    => forgetting time ≈ tau * log2( F / (lambda * tau) ).
```

The forgetting time grows only **logarithmically** in the historical peak `F`, versus the **linear** dead-weight duration of non-decaying LFU. That exponential-to-logarithmic improvement is the entire benefit of decay: a once-hot key is forgiven in `O(log F)` decay periods rather than persisting for `O(F)` accesses. Reset-on-N (halving the whole sketch after N additions, as TinyLFU does) is exactly this multiplicative decay applied to an approximate counter, giving the sketch a sliding-window-like fading memory with O(1) amortized cost.

---

## Morris Counter Error Bounds

Approximate LFU replaces an exact count with a Morris counter to save space; we bound the error it introduces.

```text
Morris counter. State c; estimate of true count n is X = 2^c - 1 (base-2 variant).
Increment rule: on each event, c <- c + 1 with probability 2^{-c}.

Unbiasedness.  E[X_n] = n   (exact in expectation; classic Morris result).

Variance.      Var[X_n] = n(n-1)/2.   So relative standard deviation
               sd(X_n)/n -> 1/sqrt(2) ≈ 0.707 for base 2.

Tunable base a > 1 (generalized Morris). Estimate X = (a^c - 1)/(a - 1).
               Var[X_n] = (a - 1)/2 * n(n-1).
               => relative error shrinks as a -> 1, at the cost of more bits.

Space. To count up to n, the counter c reaches ~ log_a n, needing
               O(log log n) bits  (vs log n bits for an exact counter).
```

**Implication for eviction.** Eviction needs only the *ranking* of frequencies, not exact values. Morris counters preserve ranking with high probability whenever true frequencies differ by more than the noise (relative error ≈ `1/sqrt(2)` for base 2, smaller for `a` near 1). Redis's `lfu-log-factor` is precisely the knob that sets the effective base `a`: a larger factor ⇒ slower growth ⇒ wider dynamic range ⇒ coarser steps; a smaller factor ⇒ finer resolution among low-frequency keys. The 8-bit cap with logarithmic growth lets one byte distinguish frequencies spanning many orders of magnitude — sufficient for hot/cold ranking, which is all eviction requires.

---

## TinyLFU Admission Theory

TinyLFU replaces "evict the global min" with "admit the candidate iff it beats the victim." We formalize why this is sound and near-optimal in space.

```text
Setup. A frequency sketch ~f estimates true frequency f using a Count-Min
sketch with w counters per row and d rows (hash functions), under reset-on-N
aging. Count-Min gives a ONE-SIDED error:
    ~f(x) >= f(x)   always (never underestimates), and
    Pr[ ~f(x) > f(x) + eps * N ] <= e^{-d}     when w >= e/eps,
where N is the total number of counted accesses in the current epoch.

Admission rule. Admit candidate cand over resident victim vic iff
    ~f(cand) >= ~f(vic).

Soundness (near-correct admission). Because Count-Min overestimates by at most
eps*N w.h.p., the admission decision agrees with the EXACT-frequency decision
whenever |f(cand) - f(vic)| > eps*N. Only near-ties (within the sketch's error
band) can be misjudged, and a misjudged near-tie costs at most the difference
in their true frequencies — negligible for eviction quality.

Space. d rows of w = e/eps counters of b bits each: O((e/eps) * d * b) bits TOTAL,
independent of the number of distinct keys. With 4-bit counters and small d,w
this is ~10 bits PER CACHE ENTRY — orders of magnitude below exact per-key counts.
```

```text
Aging correctness (reset-on-N). Halving every counter after N additions bounds
the epoch's counted accesses, so the eps*N error term stays bounded and the
sketch reflects RECENT frequency. Effective memory is a soft window of ~N
accesses, fusing frequency with coarse recency — this is what makes TinyLFU
both frequency-aware (Regime 1) and adaptive to shift (Regime 2).
```

The doorkeeper Bloom filter (cleared each epoch) absorbs the long tail of **singletons**: a first sighting only sets a Bloom bit, so unique keys never enter the Count-Min sketch, keeping the `eps*N` error budget for keys that actually recur. Combined with the W-TinyLFU admission window (which gives bursty newcomers a probation period), the policy achieves hit ratios within a small additive gap of the offline optimum across standard traces — empirically dominating LRU, LFU, ARC, and 2Q — at ~10 bits/entry. See [Count-Min Sketch](../08-count-min-sketch/professional.md) and [Bloom filter](../02-bloom-filter/professional.md) for the underlying error theory.

---

## Comparison of Theoretical Guarantees

| Policy | Competitive ratio | IRM hit ratio | Space/entry | Adapts to shift | Scan-resistant |
|--------|-------------------|---------------|-------------|-----------------|----------------|
| Offline MIN (Bélády) | 1 (optimal) | — (clairvoyant) | — | — | — |
| LRU | k (optimal det.) | < H* | DLL ptrs | Yes | No |
| FIFO | k | < H* | queue | Partly | No |
| **Exact LFU** | **unbounded** | **H\* (optimal)** | freq+ptrs | **No (aging)** | Yes |
| Decaying LFU | bounded (with decay) | ≈ H* | freq+time | Yes | Yes |
| Morris/Redis LFU | bounded | ≈ H* (sampled) | ~3 bytes | Yes | Yes |
| TinyLFU | — (admission filter) | near-OPT | ~10 bits | Yes | Yes |
| W-TinyLFU | — | **near-OPT (best empirical)** | ~10 bits + window | **Yes (adaptive)** | Yes |
| ARC / 2Q | bounded | near-OPT | 2 lists | Yes | Yes |

The two extremes of LFU are striking: **exact LFU is hit-ratio-optimal under the IRM yet has an unbounded competitive ratio**. Resolving that contradiction — keeping IRM optimality while bounding adversarial harm — is exactly what decay (bounded memory) and admission filtering (frequency-gated entry) accomplish.

---

## Notation and Definitions Reference

| Symbol | Meaning |
|--------|---------|
| `k` | Cache capacity |
| `S`, `n = |S|` | Resident set and its size |
| `freq(x)`, `rec(x)` | Access count and last-access tick of key `x` |
| `B_f` | Frequency bucket: resident keys with `freq = f` (recency-ordered DLL) |
| `f_min`, `minFreq` | Minimum non-empty frequency / its cached value |
| `p_i`, `s` | Request probability of key `i`; Zipf skew exponent |
| `OPT_k`, `H*` | Top-k by probability; its hit ratio `sum_{top-k} p_i` |
| `~f`, `eps`, `N` | Count-Min estimate, error parameter, epoch access count |
| `c`, `X`, `a` | Morris counter state, its estimate, generalized base |
| `tau` | Decay period (time or accesses between halvings) |

---

## Summary

- The O(1) LFU data structure realizes the exact policy `argmin (freq, rec)` via three invariants: **bucket partition (I1)**, **per-bucket recency order (I2)**, and **minFreq correctness (I3)**.
- Every operation is **O(1)** (expected, amortized over hash resizes); the linchpin is the **minFreq Monotonicity Lemma** — the minimum frequency only resets to 1 on insert or rises by exactly 1 on a promotion, never requiring a search. Space is **Θ(capacity)**.
- Under the **Independent Reference Model** with a fixed skewed distribution, **exact LFU is asymptotically optimal**: it converges to caching the top-k keys and achieves the optimal hit ratio `H*`. This is the formal meaning of "LFU is best when frequency matters."
- In the **competitive (adversarial)** model, pure non-decaying LFU has an **unbounded** competitive ratio — the formal aging problem. The dead-weight duration of a stale key grows **linearly** in its historical peak count.
- **Decay** converts unbounded memory into exponentially-fading memory: forgetting time drops from `O(F)` to `O(log F)`, restoring adaptivity while preserving near-IRM-optimality.
- **Morris counters** give unbiased frequency estimates with relative error `≈ 1/sqrt(2)` (base 2) using `O(log log n)` bits — enough to rank hot vs cold, which is all eviction needs.
- **TinyLFU** admission is sound up to the Count-Min `eps*N` error band, uses ~10 bits/entry independent of key count, and (as W-TinyLFU) achieves near-optimal, shift-adaptive, scan-resistant hit ratios — the best general-purpose policy.

This completes the LFU progression: from counting uses (junior), to the O(1) bucket design and aging (middle), to Redis/CDN/Caffeine systems (senior), to the formal optimality, complexity, and approximation theory here.

## Further Reading

- Cao & Irani, *Cost-Aware WWW Proxy Caching Algorithms* (GreedyDual-Size) — size/cost-aware frequency eviction.
- Einziger, Friedman & Manes, *TinyLFU: A Highly Efficient Cache Admission Policy* (2017) — the admission framework and W-TinyLFU.
- Morris, *Counting Large Numbers of Events in Small Registers* (CACM 1978) — the approximate counter.
- Megiddo & Modha, *ARC: A Self-Tuning, Low Overhead Replacement Cache* (2003) — the recency+frequency baseline; see [ARC/2Q](../22-arc-2q-cache/professional.md).
- O'Neil, O'Neil & Weikum, *The LRU-K Page Replacement Algorithm* (1993) — frequency via K-th-to-last reference.
- Sleator & Tarjan, *Amortized Efficiency of List Update and Paging Rules* (1985) — competitive analysis of paging.
- Redis source `evict.c` (`LFULogIncr`, `LFUDecrAndReturn`) — the production Morris-style counter.

**Cross-references:** [LFU senior](./senior.md) · [LRU professional](../01-lru-cache/professional.md) · [ARC/2Q professional](../22-arc-2q-cache/professional.md) · [Count-Min Sketch](../08-count-min-sketch/professional.md) · [Bloom filter](../02-bloom-filter/professional.md)
