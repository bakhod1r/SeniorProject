# Paging and Caching Theory — Practice Tasks

> Coding tasks are solved in **one** language (**Go** or **Python**) with the full reference solution; a short snippet in the other language is provided where it clarifies the port. Where marked **[coding]**, implement the paging policy, implement **Belady's offline optimum (LFD)**, replay the request trace, **count faults**, and **measure the competitive ratio** against OPT.
> **[proof]** / **[analysis]** tasks need no code: prove a competitive bound (via a phase/marking argument, an exchange argument, or Yao's principle), with a clean, complete derivation. Model derivations are provided so you can grade yourself.

In **paging** a cache (fast memory) holds at most `k` pages; a request to a page either **hits** (the page is resident — free) or **misses / faults** (cost `1`: bring the page in, and if the cache is full, **evict** a resident page to make room). An **online** paging algorithm must commit to each eviction the instant a miss occurs, without seeing future requests. The **offline optimum** OPT sees the whole trace in advance; Belady's **LFD** (Longest-Forward-Distance: on a miss, evict the resident page whose next use is farthest in the future) is **provably** that optimum.

The classical results you will implement and prove:

- **LRU**, **FIFO**, and **FWF** (Flush-When-Full) are each exactly **`k`-competitive**, and `k` is optimal for *deterministic* paging — no deterministic online algorithm beats `k`.
- **LFD** (Belady) is the **offline optimum**: it minimizes faults over every trace.
- The randomized **MARKER** algorithm is `2H_k`-competitive against an oblivious adversary (`H_k = 1 + 1/2 + … + 1/k ≈ ln k`); the optimal randomized ratio is `H_k`, an exponential improvement over the deterministic `k`.
- **Resource augmentation:** LRU with cache size `k` is `k/(k − h + 1)`-competitive against an OPT restricted to a smaller cache `h ≤ k`. Give the online algorithm a little more memory and the ratio collapses toward `1`.
- **Learning-augmented caching:** a (possibly noisy) next-arrival predictor lets you *approximate* Belady; combined with marking it stays **consistent** (→ OPT as the predictor sharpens) and **robust** (≤ `O(log k)` even when the predictor is adversarial).

The recurring discipline for every coding task is the same as for competitive analysis and amortized work: **implement the online algorithm, implement Belady's LFD optimum, replay traces (including adversarial ones), count faults, and measure the ratio.** The acceptance test is always *"the measured fault ratio respects the proven bound across every tested trace."* A paging heuristic whose ratio you cannot bound is just a guess; a bound you never replay against LFD is just a hope.

**Related practice:**
- [Competitive Analysis tasks](../01-competitive-analysis/tasks.md) — the `c`-competitive framework, adversary models, Yao's principle, and the paging lower bound this topic sharpens.
- [LRU Cache tasks](../../21-advanced-structures/01-lru-cache/tasks.md) — the `O(1)` hash-map + doubly-linked-list implementation of LRU that the policies here drive.

**This topic's notes:** [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md)

A note on the models and quantities used throughout:
- **Fault (miss).** A request to a non-resident page; cost `1`. A **hit** is free. The total cost of an algorithm on a trace is its fault count.
- **`k`-phase / marking.** A *phase* is a maximal run of requests touching exactly `k` distinct pages; the next distinct page starts a new phase. A *marking* algorithm marks a page on access and, on a fault, only ever evicts an *unmarked* page (unmarking everything when all `k` are marked). LRU and FWF are marking; FIFO is not.
- **Adversary models.** A *deterministic* online algorithm faces an adversary who knows its code and builds the worst trace. A *randomized* algorithm against an *oblivious* adversary (which fixes the trace before seeing the coins) is `c`-competitive if `E[ALG(σ)] ≤ c · OPT(σ) + α`.
- **`H_k`.** The `k`-th harmonic number `H_k = Σ_{i=1}^{k} 1/i`. `H_k ≈ ln k + γ`, where `γ ≈ 0.577`. This is the randomized paging constant.

---

## Beginner Tasks

### Task 1 — Implement LRU, FIFO, FWF, and Belady's LFD; replay a shared trace **[coding]**

`[easy]` Implement the four paging policies on a single shared trace and tabulate the fault count of each. **LRU** evicts the least-recently-used resident page; **FIFO** evicts the oldest-loaded page; **FWF** (Flush-When-Full) evicts *everything* on a miss into a full cache; **LFD** (Belady) evicts the resident page whose next use is farthest in the future (the offline optimum).

Run all four on the same trace, print the fault counts, and confirm **LFD faults no more than any other policy** — it is the optimum.

#### Python

```python
def lfd_faults(trace, k):
    """Belady's optimum: on a miss with full cache, evict the page used farthest ahead."""
    cache, faults = set(), 0
    for i, p in enumerate(trace):
        if p in cache:
            continue
        faults += 1
        if len(cache) < k:
            cache.add(p)
        else:
            def next_use(page):
                for j in range(i + 1, len(trace)):
                    if trace[j] == page:
                        return j
                return float("inf")          # never used again -> evict first
            victim = max(cache, key=next_use)
            cache.discard(victim)
            cache.add(p)
    return faults

def lru_faults(trace, k):
    cache, last, faults = set(), {}, 0
    for t, p in enumerate(trace):
        if p in cache:
            last[p] = t
            continue
        faults += 1
        if len(cache) >= k:
            victim = min(cache, key=lambda x: last[x])
            cache.discard(victim)
        cache.add(p)
        last[p] = t
    return faults

def fifo_faults(trace, k):
    from collections import deque
    cache, order, faults = set(), deque(), 0
    for p in trace:
        if p in cache:
            continue
        faults += 1
        if len(cache) >= k:
            cache.discard(order.popleft())
        cache.add(p)
        order.append(p)
    return faults

def fwf_faults(trace, k):
    cache, faults = set(), 0
    for p in trace:
        if p in cache:
            continue
        faults += 1
        if len(cache) >= k:
            cache.clear()                    # flush the whole cache
        cache.add(p)
    return faults

if __name__ == "__main__":
    trace = [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5]
    k = 3
    opt = lfd_faults(trace, k)
    results = {
        "LRU":  lru_faults(trace, k),
        "FIFO": fifo_faults(trace, k),
        "FWF":  fwf_faults(trace, k),
        "LFD":  opt,
    }
    for name, f in results.items():
        print(f"{name:>4}: faults={f:2d}  ratio vs LFD={f / opt:.2f}")
    assert all(f >= opt for f in results.values()), "LFD must be the minimum"
    print("OK: LFD is the optimum (no policy faults fewer)")
```

#### Go (core)

```go
func lfdFaults(trace []int, k int) int {
	cache, faults := map[int]bool{}, 0
	for i, p := range trace {
		if cache[p] {
			continue
		}
		faults++
		if len(cache) < k {
			cache[p] = true
			continue
		}
		victim, farthest := -1, -1
		for page := range cache {
			next := len(trace) // +inf sentinel
			for j := i + 1; j < len(trace); j++ {
				if trace[j] == page {
					next = j
					break
				}
			}
			if next > farthest {
				farthest, victim = next, page
			}
		}
		delete(cache, victim)
		cache[p] = true
	}
	return faults
}
```

- **Constraints:** All four policies run on the *same* trace and the same `k`. Cache size `k ≥ 1`. The LFD scan for "next use" is `O(n)` per fault here (`O(n²)` overall) — keep traces in the low thousands. A page "never used again" has next-use `+∞` and is the preferred LFD victim.
- **Hint:** A *fault* (miss) costs `1`; a *hit* is free. LFD is optimal because evicting the farthest-future page postpones the next fault on that page as long as possible. The only freedom on a miss is *which* page to evict — LFD makes the choice that a clairvoyant would.
- **Acceptance test:** Every policy's fault count is `≥ LFD`'s on every trace; LFD is the minimum. The four counts print cleanly with their ratio to OPT.

---

### Task 2 — The adversarial cyclic trace: LRU faults every step, OPT once per `k` **[coding + analysis]**

`[easy]` The worst input for LRU (and FIFO) cycles `k + 1` distinct pages forever: `0, 1, …, k, 0, 1, …, k, …`. Because LRU evicts exactly the page that is about to be requested next, it faults on **every** request. LFD, evicting the page used *farthest* ahead, faults only about **once per `k`** requests.

Build this trace, replay LRU and LFD, and show the ratio `LRU/OPT` climbs toward `k`.

#### Python

```python
def cyclic_trace(k, rounds):
    """k+1 distinct pages cycled; the canonical k-competitive worst case."""
    pages = list(range(k + 1))
    return pages * rounds

if __name__ == "__main__":
    for k in (3, 5, 8, 16):
        trace = cyclic_trace(k, rounds=400)
        lru = lru_faults(trace, k)            # from Task 1
        opt = lfd_faults(trace, k)
        print(f"k={k:2d}  LRU faults={lru:5d}  LFD faults={opt:4d}  "
              f"ratio={lru / opt:.2f}  (-> k={k})")
        assert lru <= k * opt + k             # never exceeds k*OPT (+ startup slack)
```

- **Analysis to write:** On the trace `0,1,…,k,0,1,…`, after the cache warms up LRU holds the `k` *most recently used* pages, which are exactly the `k` pages **other than** the one just about to be requested. So every request is a miss; over `N` requests LRU faults `N` times. LFD, on each fault, evicts the page whose next use is farthest — which discards a page not needed for the next `k − 1` steps, so LFD faults only once every `k` requests, about `N/k` times. Hence `LRU/OPT → k`. FIFO behaves identically on this cyclic input.
- **Constraints:** Use exactly `k + 1` distinct pages — one more than the cache holds. Fewer than `k + 1` distinct pages and LRU eventually stops faulting (everything fits); more pages weakens the per-step guarantee. Report the ratio for several `k`.
- **Acceptance test:** `LRU/OPT` rises with `k` and approaches `k` as `rounds` grows; the bound `LRU ≤ k·OPT + O(k)` holds for every `k`. This witnesses that the `k`-competitive bound is *tight*.

---

### Task 3 — Belady's anomaly: FIFO faults *more* with a bigger cache **[coding]**

`[easy]` Intuition says more cache means fewer faults. For **FIFO** this is false: there exist traces where enlarging the cache from `k` to `k + 1` *increases* the fault count. This is **Belady's anomaly**. The classic witness trace is `1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5`.

Replay FIFO at `k = 3` and `k = 4` on the witness trace and show `faults(k=4) > faults(k=3)`. Then show **LRU** — a *stack algorithm* — never exhibits the anomaly: its fault count is monotone non-increasing in `k`.

#### Python

```python
def fifo_anomaly_demo():
    trace = [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5]
    f3, f4 = fifo_faults(trace, 3), fifo_faults(trace, 4)
    print(f"FIFO  k=3 faults={f3}   k=4 faults={f4}   anomaly={f4 > f3}")
    assert f4 > f3, "Belady's anomaly must appear for FIFO on this trace"
    return trace

def lru_is_monotone(trace, kmax):
    """LRU is a stack algorithm: faults are non-increasing in k."""
    faults = [lru_faults(trace, k) for k in range(1, kmax + 1)]
    monotone = all(faults[i] >= faults[i + 1] for i in range(len(faults) - 1))
    print("LRU faults by k:", {k + 1: f for k, f in enumerate(faults)})
    print("monotone non-increasing:", monotone)
    assert monotone
    return faults

if __name__ == "__main__":
    trace = fifo_anomaly_demo()
    # LRU never gets worse with more cache, on this or any trace.
    lru_is_monotone(trace, kmax=6)
    import random
    random.seed(11)
    for _ in range(2000):
        rnd = [random.randint(0, 6) for _ in range(40)]
        f = [lru_faults(rnd, k) for k in range(1, 7)]
        assert all(f[i] >= f[i + 1] for i in range(len(f) - 1)), "LRU must be monotone"
    print("OK: LRU monotone over 2000 random traces; FIFO anomalous on the witness")
```

- **Constraints:** Use the exact witness trace `1,2,3,4,1,2,5,1,2,3,4,5` for the FIFO anomaly. For the LRU monotonicity check, fuzz many random traces — a single example is not a proof, but a wide fuzz that *never* breaks monotonicity is strong evidence of the stack property.
- **Hint:** A **stack algorithm** satisfies the *inclusion property*: at every step, the set of pages a cache of size `k` would hold is a **subset** of what a cache of size `k + 1` would hold. LRU (and LFD) have this property — so a bigger cache can only turn faults into hits, never the reverse. FIFO lacks it: eviction order depends on *load time*, which the cache size perturbs, so a bigger cache can evict a soon-needed page.
- **Acceptance test:** FIFO faults strictly more at `k = 4` than at `k = 3` on the witness; LRU's fault count is non-increasing in `k` on the witness and across thousands of random traces. The anomaly is real for FIFO and absent for LRU.

---

### Task 4 — Phase decomposition: count `k`-phases and bound OPT below **[coding]**

`[easy]` The **`k`-phase decomposition** is the workhorse of every paging proof. Partition a trace into phases, where a phase is a maximal run of requests touching exactly `k` **distinct** pages; the request introducing the `(k+1)`-th distinct page starts the next phase. Two facts make the bounds work:

1. Any **marking** algorithm (LRU, FWF) faults **at most `k` times per phase**.
2. OPT faults **at least once per phase** after the first — so `OPT ≥ (#phases − 1)`.

Implement the phase splitter, count phases, and verify both inequalities empirically against LRU and LFD.

#### Python

```python
def phase_decomposition(trace, k):
    """Split into maximal runs of exactly k distinct pages."""
    phases, cur, seen = [], [], set()
    for p in trace:
        if p not in seen and len(seen) == k:    # (k+1)-th distinct page -> new phase
            phases.append(cur)
            cur, seen = [], set()
        cur.append(p)
        seen.add(p)
    if cur:
        phases.append(cur)
    return phases

if __name__ == "__main__":
    import random
    random.seed(2)
    for k in (3, 5, 8):
        trace = [random.randint(0, 2 * k) for _ in range(3000)]
        phases = phase_decomposition(trace, k)
        lru = lru_faults(trace, k)
        opt = lfd_faults(trace, k)
        print(f"k={k}  phases={len(phases)}  LRU={lru}  LFD={opt}")
        # (1) LRU faults at most k per phase.
        assert lru <= k * len(phases)
        # (2) OPT faults at least once per phase after the first.
        assert opt >= len(phases) - 1
        # Combining: LRU <= k * (OPT + 1)  ->  k-competitive (up to additive k).
        assert lru <= k * (opt + 1)
        print(f"   LRU <= k*phases = {k*len(phases)};  "
              f"OPT >= phases-1 = {len(phases)-1};  LRU <= k*(OPT+1) OK")
```

- **Constraints:** A phase is *maximal* — extend it until a `(k+1)`-th distinct page forces a split. The first phase may fault up to `k` times under OPT too (cold cache), which is why the OPT lower bound is `#phases − 1`, not `#phases`. Verify *both* inequalities, not just one.
- **Hint:** Why "at least once per phase after the first": a phase together with the *first request of the next phase* touches `k + 1` distinct pages, which cannot all fit in OPT's size-`k` cache, so OPT faults at least once on those `k + 1` pages. Charging that fault to the phase gives `OPT ≥ #phases − 1`. The two inequalities multiply to the `k`-competitive bound — this is exactly Task 5's proof made concrete.
- **Acceptance test:** Phases partition the trace; LRU's faults `≤ k · #phases`; LFD's faults `≥ #phases − 1`; therefore `LRU ≤ k·(OPT + 1)` on every tested trace. The empirical scaffold for the `k`-competitiveness proof is in place.

---

## Intermediate Tasks

### Task 5 — Prove LRU is `k`-competitive via the phase / marking argument **[proof]**

`[medium]` Write a complete proof that LRU is `k`-competitive: `LRU(σ) ≤ k · OPT(σ) + k` for every trace `σ`. Then state why `k` is the best any *deterministic* algorithm can achieve.

> **No code.** Use this as the grading model.

**Model proof — upper bound (`k`-competitiveness).**

Partition `σ` into **`k`-phases**: phase `1` begins at the first request; a phase is the maximal run of requests covering exactly `k` distinct pages; the request introducing the `(k+1)`-th distinct page opens the next phase. Let `P` be the number of phases.

*LRU faults at most `k` per phase.* Fix a phase and let `p₁, …, p_k` be its `k` distinct pages in order of first appearance within the phase. LRU is a **marking** algorithm: once a page is requested inside the phase, LRU will not evict it for the remainder of the phase, because to evict `x` LRU would need `k` *other* pages more recently used than `x`, and the phase contains only `k` distinct pages total. Hence each of the `k` distinct pages faults at most once within the phase, giving at most `k` faults per phase. Across `P` phases:

```
LRU(σ) ≤ k · P.
```

*OPT faults at least once per phase after the first.* Consider phase `i ≥ 2` together with the **first request of phase `i+1`** (or the last request of phase `i`, by the standard "look at the `k+1`-th page" argument). The pages of phase `i` are `k` distinct pages, and at the start of phase `i` OPT holds at most the `k − 1` *non-first* pages plus carryover — formally, phase `i` plus the first request of phase `i + 1` together reference `k + 1` distinct pages, which cannot all be resident in OPT's size-`k` cache simultaneously, so OPT faults at least once on this window. Charging that fault to phase `i`, every phase except the first forces at least one OPT fault:

```
OPT(σ) ≥ P − 1.
```

*Combine.* `LRU(σ) ≤ k·P = k·(P − 1) + k ≤ k·OPT(σ) + k`. Therefore LRU is `k`-competitive (with additive constant `k`). ∎

**Model proof — lower bound (`k` is optimal for deterministic paging).**

Let `A` be any deterministic online paging algorithm with cache size `k`. Use a universe of `k + 1` pages. The adversary simulates `A` and always requests the **unique page `A` does not currently hold** (such a page exists since `A` holds only `k` of the `k + 1`). Then `A` faults on **every** request: over `N` requests, `A(σ) = N`.

OPT, knowing the whole trace, on each of its faults evicts the page requested **farthest in the future** (Belady). Among the `k` resident pages, the one used farthest ahead is not requested for at least the next `k − 1` steps, so each OPT fault is followed by at least `k − 1` hits: OPT faults at most `⌈N/k⌉` times, `OPT(σ) ≤ N/k + 1`. Hence

```
A(σ) / OPT(σ) ≥ N / (N/k + 1) → k   as N → ∞.
```

No deterministic algorithm beats `k`; LRU (and FIFO, FWF) attain it. ∎

- **Constraints:** Both halves required: (1) the marking argument giving `LRU ≤ k·P` and the `(k+1)`-page-window argument giving `OPT ≥ P − 1`; (2) the `k + 1`-page adversary forcing every deterministic algorithm to ratio `≥ k`. Explain *why* LRU is marking (no eviction of a page touched this phase).
- **Acceptance test:** The proof produces `LRU(σ) ≤ k·OPT(σ) + k` via phases, and the simulate-the-algorithm adversary on `k + 1` pages forcing ratio `→ k`, concluding deterministic optimality at `k`.

---

### Task 6 — Prove LFD (Belady) is the offline optimum via an exchange argument **[proof]**

`[medium]` Prove that LFD (evict the page whose next use is farthest in the future) minimizes the number of faults over *every* trace — no offline algorithm faults fewer.

> **No code.** Model derivation follows.

**Model derivation — exchange argument.**

Let `OPT` be *any* optimal offline algorithm and `LFD` be the longest-forward-distance algorithm. We transform `OPT` into `LFD` one eviction at a time without ever increasing the fault count, proving `LFD` is also optimal.

Run both from the same start. Let `i` be the **first** step at which `LFD` and `OPT` differ in their eviction. At this fault both must evict (the cache is full and the requested page is absent). Say `LFD` evicts page `f` (the one used farthest in the future) while `OPT` evicts a different page `g`. By LFD's rule, the next use of `f` is **no earlier** than the next use of `g`.

Build a new algorithm `OPT'` that agrees with `OPT` everywhere except it evicts `f` (not `g`) at step `i`, then mimics `OPT`'s *behavior* afterward, fixing up the one discrepancy: after step `i`, `OPT'`'s cache differs from `OPT`'s in exactly one slot — `OPT'` holds `g` where `OPT` holds `f`. We show `OPT'` faults no more than `OPT` up to the moment the caches re-synchronize:

- The next time page `g` is requested: since `next(f) ≥ next(g)`, page `g` is requested *before or at the same time as* `f`. `OPT` (holding `g`) hits; `OPT'` (not holding `g`) would fault — but at that fault `OPT'` evicts `f` (which it still holds and which is needed no sooner), bringing in `g`. Now both caches hold the same set again, and `OPT'` has incurred **at most one extra** fault here, which is **paid for** by the fault `OPT` will incur when `f` is next requested (where `OPT'` now holds `f` and hits). The two discrepancies cancel.

So `OPT'(σ) ≤ OPT(σ)`, and `OPT'` agrees with `LFD` on one more step than `OPT` did. Repeating the exchange resolves every disagreement in increasing order of step index, yielding `LFD(σ) ≤ OPT(σ)`. Since `OPT` was optimal, `LFD` is optimal too. ∎

- **Constraints:** Define the first disagreement step, state LFD's invariant `next(f) ≥ next(g)`, construct the swapped algorithm `OPT'`, and show the at-most-one extra fault is cancelled by the later fault on `f`. Conclude by induction on the number of disagreements.
- **Acceptance test:** The answer exhibits a fault-preserving exchange that makes any optimal `OPT` agree with `LFD` one step further, and inducts to `LFD ≤ OPT`. The crucial inequality `next(f) ≥ next(g)` and the discrepancy-cancellation must both appear.

---

### Task 7 — A marking-algorithm checker; verify LRU and FWF are marking, FIFO is not **[coding]**

`[medium]` A **marking** algorithm processes each `k`-phase by *marking* a page on access and, on a fault, evicting only an **unmarked** resident page (when all `k` resident pages are marked, the phase ends and all marks clear). Marking algorithms are automatically `k`-competitive (Task 5's upper bound applies verbatim).

Implement a **checker** that, given a policy's eviction decisions, verifies the marking property: *no eviction ever removes a page that was accessed earlier in the current phase.* Run it on LRU, FWF, and FIFO and confirm LRU and FWF pass while FIFO can fail.

#### Python

```python
def is_marking(policy_evictions, trace, k):
    """policy_evictions(trace, k) -> list of (step, evicted_page).
    Returns True iff no evicted page was accessed earlier in the same phase."""
    # Assign each step a phase id (maximal runs of k distinct pages).
    step_phase, distinct, pid = [], set(), 0
    for p in trace:
        if p not in distinct and len(distinct) == k:
            distinct, pid = set(), pid + 1       # (k+1)-th distinct page -> new phase
        distinct.add(p)
        step_phase.append(pid)
    # For each step, snapshot the pages already accessed in its phase BEFORE this access.
    accessed = {}                                # phase id -> set of accessed pages
    seen_before = []
    for i, p in enumerate(trace):
        s = accessed.setdefault(step_phase[i], set())
        seen_before.append(set(s))               # "marked" pages as of this step
        s.add(p)
    # A marking algorithm never evicts a page already accessed this phase.
    for step, victim in policy_evictions(trace, k):
        if victim in seen_before[step]:
            return False
    return True

def lru_evictions(trace, k):
    cache, last, ev = set(), {}, []
    for t, p in enumerate(trace):
        if p in cache:
            last[p] = t; continue
        if len(cache) >= k:
            victim = min(cache, key=lambda x: last[x])
            cache.discard(victim); ev.append((t, victim))
        cache.add(p); last[p] = t
    return ev

def fwf_evictions(trace, k):
    cache, ev = set(), []
    for t, p in enumerate(trace):
        if p in cache: continue
        if len(cache) >= k:
            for v in list(cache):
                ev.append((t, v))                 # flush all -> all evicted "at" this step
            cache.clear()
        cache.add(p)
    return ev

def fifo_evictions(trace, k):
    from collections import deque
    cache, order, ev = set(), deque(), []
    for t, p in enumerate(trace):
        if p in cache: continue
        if len(cache) >= k:
            v = order.popleft(); cache.discard(v); ev.append((t, v))
        cache.add(p); order.append(p)
    return ev

if __name__ == "__main__":
    import random
    random.seed(4)
    k = 3
    lru_ok = fwf_ok = True
    fifo_fail = False
    for _ in range(3000):
        trace = [random.randint(0, 2 * k) for _ in range(60)]
        lru_ok &= is_marking(lru_evictions, trace, k)
        fwf_ok &= is_marking(fwf_evictions, trace, k)
        if not is_marking(fifo_evictions, trace, k):
            fifo_fail = True
    print(f"LRU marking: {lru_ok}   FWF marking: {fwf_ok}   FIFO ever non-marking: {fifo_fail}")
    assert lru_ok and fwf_ok and fifo_fail
```

- **Constraints:** The checker must define "marked" as *accessed earlier in the current phase* and flag any eviction of such a page. FWF evicts everything on a full-cache miss — model that as evicting all resident pages "at" that step, which is consistent with marking because a flush only happens when all `k` are marked (phase boundary). FIFO ignores marks (it evicts by load order), so it can evict a page touched this phase.
- **Hint:** Marking is a *property of eviction decisions relative to the phase structure*, not of the algorithm's internal bookkeeping. LRU never evicts a this-phase page because evicting `x` requires `k` more-recently-used pages, impossible inside a `k`-distinct phase. FWF only evicts at phase boundaries. FIFO's victim is the oldest-*loaded*, which may well have been re-accessed this phase.
- **Acceptance test:** LRU and FWF pass the marking check on every random trace; FIFO fails on at least some. This certifies the two `k`-competitive marking algorithms and isolates FIFO as `k`-competitive *by a different (FIFO-specific) argument*, not by marking.

---

### Task 8 — LRU vs OPT on locality vs adversarial traces: ratio `≪ k` vs `→ k` **[coding]**

`[medium]` The `k`-competitive bound is a *worst case*. On realistic traces with **locality of reference** (Zipfian popularity, temporal bursts), LRU's measured ratio sits far below `k`. Only the adversarial cyclic trace drives it to `k`. Build a harness that contrasts the two regimes.

#### Python

```python
import random

def zipf_trace(n_pages, length, s=1.1, seed=0):
    """Skewed popularity: page i drawn with prob ~ 1/i^s (locality in popularity)."""
    rng = random.Random(seed)
    weights = [1.0 / (i + 1) ** s for i in range(n_pages)]
    total = sum(weights)
    probs = [w / total for w in weights]
    return rng.choices(range(n_pages), weights=probs, k=length)

def bursty_trace(n_pages, length, seed=0):
    """Temporal locality: short runs that revisit a small working set."""
    rng = random.Random(seed)
    out = []
    while len(out) < length:
        ws = rng.sample(range(n_pages), rng.randint(2, 5))   # working set
        for _ in range(rng.randint(5, 25)):
            out.append(rng.choice(ws))
    return out[:length]

if __name__ == "__main__":
    for k in (4, 8, 16):
        n_pages = 4 * k
        zipf = zipf_trace(n_pages, 5000, seed=1)
        burst = bursty_trace(n_pages, 5000, seed=1)
        adv = cyclic_trace(k, rounds=5000 // (k + 1))        # from Task 2
        print(f"\nk={k}  (bound = {k})")
        for name, trace in (("zipf", zipf), ("bursty", burst), ("adversarial", adv)):
            lru = lru_faults(trace, k)
            opt = lfd_faults(trace, k)
            ratio = lru / opt
            print(f"  {name:>12}: LRU/OPT={ratio:.2f}   "
                  f"({'<<k' if ratio < 0.5 * k else '->k'})")
            assert ratio <= k + 1e-6
```

- **Constraints:** All traces share the same `k`; only the access pattern changes. The Zipf and bursty traces must exhibit genuine locality (a small hot working set). Keep the LFD `O(n²)` cost in mind — cap lengths in the low thousands. The measured ratio must stay `≤ k` on *every* trace (the bound is universal).
- **Hint:** Locality is exactly what LRU is designed to exploit: a re-accessed hot page is recently used, so LRU keeps it. The Zipf/bursty ratios land near `1`–`2`; only the cyclic adversary, which references a working set *one larger* than the cache and in the worst possible order, reaches `k`. This is the empirical face of "competitive ratio is a `∀`-statement."
- **Acceptance test:** On Zipf and bursty traces `LRU/OPT` is far below `k` (often `< 2`); on the adversarial trace it approaches `k`. Every ratio respects the proven `≤ k` bound. The gap motivates randomization and predictions (Advanced tasks).

---

## Advanced Tasks

### Task 9 — The randomized MARKER algorithm: Monte-Carlo ratio ≈ `2H_k` **[coding]**

`[hard]` **MARKER** is the canonical randomized marking algorithm, `2H_k`-competitive against an oblivious adversary (`H_k = Σ_{i=1}^k 1/i ≈ ln k`) — an exponential improvement over the deterministic `k`. It runs in phases: every page starts a phase **unmarked**; on access a page is **marked**; on a fault, evict a **uniformly random unmarked** resident page; when all `k` are marked, the phase ends and all marks clear.

Implement MARKER, replay it against the adversarial trace (the oblivious adversary's worst case), Monte-Carlo estimate its expected fault ratio, and confirm it lands near `2H_k` and **far below** the deterministic `k`.

#### Python

```python
import random

def marker_faults(trace, k, rng):
    """Randomized marking: on a fault, evict a uniformly random UNMARKED page.
    Marks clear when all k resident pages are marked (phase boundary)."""
    cache = {}                      # page -> marked (bool)
    faults = 0
    for p in trace:
        if p in cache:
            cache[p] = True         # mark on access
            continue
        faults += 1
        if len(cache) >= k:
            # If every resident page is marked, the phase ends: clear all marks first.
            if all(cache.values()):
                for q in cache:
                    cache[q] = False
            unmarked = [q for q, m in cache.items() if not m]
            victim = rng.choice(unmarked)
            del cache[victim]
        cache[p] = True             # the incoming page is marked
    return faults

def harmonic(k):
    return sum(1.0 / i for i in range(1, k + 1))

if __name__ == "__main__":
    print(f"{'k':>3} {'E[MARKER]/OPT':>15} {'2H_k':>8} {'H_k':>7} {'k':>5}")
    for k in (4, 8, 16, 32):
        trace = cyclic_trace(k, rounds=300)          # oblivious-adversary worst case
        opt = lfd_faults(trace, k)
        trials = 400
        total = 0.0
        for t in range(trials):
            rng = random.Random(1000 + t)
            total += marker_faults(trace, k, rng) / opt
        est = total / trials
        print(f"{k:>3} {est:>15.3f} {2*harmonic(k):>8.3f} "
              f"{harmonic(k):>7.3f} {k:>5}")
        # MARKER beats the deterministic k and respects its 2H_k guarantee (+ slack).
        assert est <= 2 * harmonic(k) + 1.0
        assert est < k                                # exponential improvement
```

#### Go (core eviction)

```go
func markerEvict(cache map[int]bool, rng *rand.Rand) int {
	allMarked := true
	for _, m := range cache {
		if !m {
			allMarked = false
			break
		}
	}
	if allMarked { // phase boundary: clear marks
		for q := range cache {
			cache[q] = false
		}
	}
	unmarked := []int{}
	for q, m := range cache {
		if !m {
			unmarked = append(unmarked, q)
		}
	}
	return unmarked[rng.Intn(len(unmarked))] // uniform random unmarked victim
}
```

- **Constraints:** The adversary is **oblivious** — it fixes the trace (the cyclic worst case) *before* MARKER's coins are flipped; you must never let the adversary peek at the random victim choices. Average over enough independent seeds that the estimate is stable to ~2 decimals. The incoming page is marked on arrival; marks clear exactly at phase boundaries.
- **Hint:** The `2H_k` bound comes from charging, per phase, an expected `H_k` faults on the "clean" (new) pages plus an expected `≤ H_k − 1` on the "stale" (old, re-requested) pages whose random eviction occasionally guesses wrong. The optimal randomized variant (Equitable / partitioning MARKER) achieves exactly `H_k`; plain MARKER achieves `2H_k`. Either way the ratio is `Θ(log k)`, dwarfing the deterministic `k` — try `k = 32`: `2H_k ≈ 8` versus `k = 32`.
- **Acceptance test:** The Monte-Carlo expected ratio sits near `2H_k` (between `H_k` and `2H_k`) and is dramatically below `k` for large `k`. Randomization plus an oblivious adversary buys an exponential reduction in the worst-case multiplier.

---

### Task 10 — Resource augmentation: LRU with cache `k` vs OPT with cache `h ≤ k` **[coding]**

`[hard]` **Resource augmentation** gives the online algorithm *more cache* than OPT and asks how the ratio improves. The classical bound: **LRU with cache size `k` is `k/(k − h + 1)`-competitive against an OPT restricted to cache size `h ≤ k`.** A little extra memory collapses the ratio: at `h = k` it is `k` (the unaugmented case); at `h = k/2 + 1` it is about `2`; as `h → 1` it degrades back toward `k`.

Implement LRU with cache `k` and LFD with cache `h`, replay the adversarial trace (now built over `k + 1` pages to stress both), and confirm the measured ratio respects `k/(k − h + 1)`.

#### Python

```python
def lru_faults_size(trace, k):     return lru_faults(trace, k)     # from Task 1
def lfd_faults_size(trace, h):     return lfd_faults(trace, h)     # OPT with cache h

def resource_augmentation_bound(k, h):
    return k / (k - h + 1)

if __name__ == "__main__":
    k = 16
    print(f"LRU cache k={k}  vs  OPT cache h  (bound = k/(k-h+1))")
    print(f"{'h':>3} {'LRU/OPT_h':>11} {'k/(k-h+1)':>11} {'ok':>4}")
    # Adversarial over k+1 pages stresses LRU's full cache.
    trace = cyclic_trace(k, rounds=600)            # k+1 distinct pages
    for h in (k, 3 * k // 4, k // 2 + 1, k // 4 + 1, 2):
        lru = lru_faults_size(trace, k)
        opt_h = lfd_faults_size(trace, h)
        ratio = lru / opt_h
        bound = resource_augmentation_bound(k, h)
        ok = ratio <= bound + 1e-6
        print(f"{h:>3} {ratio:>11.3f} {bound:>11.3f} {str(ok):>5}")
        assert ok, f"ratio {ratio} exceeded bound {bound} at h={h}"
    print("\nMore online cache (k fixed) vs smaller OPT cache h -> ratio k/(k-h+1).")
```

- **Constraints:** OPT's cache size `h` must be `≤ k`. The online LRU keeps the full `k`; only OPT is shrunk to `h` — that is the resource-augmentation asymmetry. Build the adversarial trace over `k + 1` distinct pages so LRU's larger cache is genuinely exercised. The measured ratio must never exceed `k/(k − h + 1)`.
- **Hint:** The proof reruns Task 5's phase argument with a twist: in a phase of `k` distinct pages, LRU faults at most `k` times, while OPT-with-`h` faults at least `k − h + 1` times (it can hold only `h`, so at least `k − h + 1` of the `k` phase-pages miss). Dividing gives `k/(k − h + 1)`. The practical lesson behind every production cache: provisioning even modest extra capacity over the "optimal working set" buys a large drop in miss ratio — the theoretical justification for over-provisioning caches.
- **Acceptance test:** For each `h ≤ k`, `LRU(k)/OPT(h) ≤ k/(k − h + 1)`. The ratio shrinks toward `1`–`2` as `h` drops moderately below `k` (more relative augmentation) and approaches `k` only when `h = k`. Augmentation provably tames the competitive ratio.

---

### Task 11 — Learning-augmented caching: predictive Belady, consistency vs robustness **[coding]**

`[hard]` A **learning-augmented** cache receives, for each requested page, a *prediction* `r̂(p)` of its **next arrival time** and uses it to *approximate Belady* (evict the page with the largest predicted next arrival). With perfect predictions this **is** LFD; with noisy predictions it degrades gracefully. We want:

- **Consistency:** ratio `→ 1` as the predictor sharpens (noise `→ 0`), recovering OPT.
- **Robustness:** even with an adversarial predictor, ratio stays `≤ O(log k)` (or `k`) — never worse than a prediction-free baseline.

A clean design: **PredictiveMarker** — run the marking algorithm, but among unmarked pages evict the one whose *predicted* next arrival is farthest. Marking caps the damage of a bad predictor at the marking bound; the predictor steers evictions toward Belady when it is good. Implement it, sweep predictor noise, and plot consistency against robustness.

#### Python

```python
import random

def true_next_arrival(trace):
    """For each position, the index of the next occurrence of that page (+inf if none)."""
    nxt = [float("inf")] * len(trace)
    seen = {}
    for i in range(len(trace) - 1, -1, -1):
        p = trace[i]
        nxt[i] = seen.get(p, float("inf"))
        seen[p] = i
    return nxt

def predictive_marker_faults(trace, k, noise, rng):
    """Marking + Belady-by-prediction. `noise` multiplies a log-normal error onto
    the true next-arrival distance, so noise=0 -> perfect (=LFD), large noise -> garbage."""
    nxt = true_next_arrival(trace)
    # Predicted next-arrival distance from position i for the page at i.
    def predicted_distance(i):
        d = nxt[i] - i if nxt[i] != float("inf") else 10 ** 9
        if noise <= 0:
            return d
        return d * rng.lognormvariate(0.0, noise)      # multiplicative error
    pred_dist = {}                                      # page -> latest predicted distance
    cache = {}                                          # page -> marked
    faults = 0
    for i, p in enumerate(trace):
        pred_dist[p] = predicted_distance(i)
        if p in cache:
            cache[p] = True
            continue
        faults += 1
        if len(cache) >= k:
            if all(cache.values()):
                for q in cache:
                    cache[q] = False                   # phase boundary
            unmarked = [q for q, m in cache.items() if not m]
            # Belady-by-prediction among unmarked: evict the farthest predicted arrival.
            victim = max(unmarked, key=lambda q: pred_dist.get(q, 10 ** 9))
            del cache[victim]
        cache[p] = True
    return faults

if __name__ == "__main__":
    from math import log
    k = 8
    trace = []
    rng0 = random.Random(7)
    # Mixed trace: locality + occasional cycling to give OPT and LRU room to differ.
    for _ in range(400):
        ws = rng0.sample(range(2 * k), rng0.randint(2, k + 2))
        for _ in range(rng0.randint(3, 15)):
            trace.append(rng0.choice(ws))
    opt = lfd_faults(trace, k)
    lru = lru_faults(trace, k)
    Hk = sum(1.0 / i for i in range(1, k + 1))
    print(f"k={k}  OPT={opt}  LRU={lru}  LRU/OPT={lru/opt:.2f}  bound k={k}")
    print(f"{'noise':>6} {'PM/OPT':>8} {'note':>28}")
    for noise in (0.0, 0.1, 0.3, 0.7, 1.5, 3.0):
        trials = 200 if noise > 0 else 1
        total = 0.0
        for t in range(trials):
            rng = random.Random(2000 + t)
            total += predictive_marker_faults(trace, k, noise, rng) / opt
        ratio = total / trials
        tag = ("consistent (->OPT)" if noise <= 0.1
               else "robust (<= O(log k))" if ratio <= 2 * Hk else "degrading")
        print(f"{noise:>6.1f} {ratio:>8.3f}   {tag:>28}")
        # Robustness: marking caps the ratio at the marking bound regardless of noise.
        assert ratio <= k + 1e-6
    print(f"\nConsistency: noise->0 gives ratio->1 (=Belady).  "
          f"Robustness: any noise stays <= k (marking floor); good noise <= 2H_k={2*Hk:.2f}.")
```

- **Constraints:** With `noise = 0` the predictor returns the true next-arrival distance, so PredictiveMarker *is* Belady-among-unmarked and the ratio must approach `1`. As noise grows the predictions become useless, but the **marking wrapper guarantees the ratio never exceeds the marking bound `k`** (and, with the randomized unmarked-eviction variant, `≤ 2H_k`). Sweep noise from `0` upward and average over seeds for noisy settings.
- **Hint:** This is the **consistency–robustness trade-off** of algorithms-with-predictions, applied to caching (Lykouris–Vassilvitskii). Pure "trust the predictor" (predictive Belady with no marking) is `1`-consistent but **unboundedly** non-robust — a single adversarial prediction can evict a hot page forever. Wrapping the predictor in *marking* sacrifices nothing when predictions are perfect (Belady never evicts a marked page either) yet **caps** the worst case at the prediction-free bound. That is the whole point: pay for the predictor's upside, insure against its downside.
- **Acceptance test:** Ratio `→ 1` as noise `→ 0` (consistency, recovering OPT); ratio stays `≤ k` for *every* noise level (robustness via marking), and near `2H_k` while predictions retain signal. The two properties hold simultaneously — the empirical Pareto win of combining a predictor with a marking floor.

---

### Task 12 — Construct the adversary; explain why randomization and augmentation escape it **[analysis]**

`[hard]` The cleanest way to *lower-bound* a deterministic paging algorithm is to build, mechanically, the trace that maximizes faults relative to OPT. Because the algorithm is deterministic, the adversary can **simulate** it and always request the page the algorithm is least prepared for. Write the general "construct-the-adversary" recipe and apply it to paging, then explain precisely why randomization (MARKER) and resource augmentation defeat it.

> **No code.** Model derivation follows.

**Model — the general recipe.**

A deterministic online paging algorithm `A` with cache `k` is a *fixed function* from request history to eviction. With a universe of `k + 1` pages, `A` always holds exactly `k` of them, so **exactly one page is absent**. The adversary:

1. Simulate `A` on the prefix built so far; read off the unique page `A` does not currently hold.
2. Request **that** page. `A` must fault and evict; whatever it evicts becomes the next target.
3. Repeat for `N` requests.

`A` faults on **every** request: `A(σ) = N`. Belady's OPT, in contrast, evicts the page used farthest in the future on each of its faults, so each OPT fault is followed by `≥ k − 1` hits, giving `OPT(σ) ≤ N/k + 1`. Hence `A(σ)/OPT(σ) → k`. The information asymmetry — the adversary has *seen* `A`'s next move by simulation, while `A` has not seen the future — is what makes deterministic paging exactly `k`-competitive and not better.

**Why randomization (MARKER) escapes it.** Against a *randomized* `A` the adversary must commit to the trace **before** the coins are flipped (oblivious model). It can no longer "request the page `A` does not hold," because *which* page is absent is now a random variable: MARKER evicts a **uniformly random unmarked** page, so the adversary cannot aim. The best the oblivious adversary can do on `k + 1` pages forces only an *expected* `Θ(H_k)` faults per phase versus OPT's `1`, giving the `Θ(log k)` randomized ratio. Step 2 of the recipe — "target the absent page" — fails because the target is unpredictable.

**Why resource augmentation escapes it.** Give the online algorithm cache `k` while OPT is held to `h < k`. The adversary can still force the online LRU to fault every step using `k + 1` pages — but now *OPT itself*, restricted to `h`, faults far more often: in each `k`-distinct phase OPT-with-`h` misses at least `k − h + 1` times. The denominator grows, so the ratio drops from `k` to `k/(k − h + 1)`. The adversary's construction is unchanged; the *benchmark got weaker*, which is exactly what augmentation buys.

**Why predictions escape it (partially).** A perfect next-arrival predictor lets the online algorithm *replay Belady*, so the adversary's simulate-and-target attack collapses: the algorithm evicts the farthest-future page just like OPT, ratio `→ 1` (consistency). But an adversary controlling the *predictor* can feed lies; marking caps the resulting damage at `k`, so the recipe regains only the prediction-free bound, never worse (robustness). The adversary can hurt the predictor but cannot push past the marking floor.

- **Constraints:** State the three-step simulate-then-attack recipe on `k + 1` pages, derive `A/OPT → k`, then explain — for *each* of randomization, resource augmentation, and predictions — precisely which step of the recipe fails and what bound results (`Θ(H_k)`, `k/(k − h + 1)`, and `1`-consistent / `k`-robust respectively).
- **Acceptance test:** The answer states the adversary recipe and the `k` ratio, then correctly attributes MARKER's `Θ(log k)` escape to the oblivious adversary's inability to target a random victim, augmentation's `k/(k − h + 1)` to the weakened OPT benchmark, and predictions' consistency/robustness to replaying Belady with a marking safety net.

---

## Synthesis Task

> Tie the thread together: implement the online policy and Belady's OPT, replay traces (including the adversary), count faults, prove the bound, and locate paging on the deterministic-vs-randomized-vs-augmented-vs-predictive map.

`[capstone]` Carry **paging** through the full online-algorithms arc — online policy, offline LFD optimum, adversary, proof, randomized improvement, resource augmentation, and the prediction-augmented frontier.

1. **Policies + OPT [coding].** Implement LRU/FIFO/FWF and Belady's LFD (Task 1). Replay a shared trace; confirm LFD is the minimum and tabulate ratios.

2. **Adversary [coding].** Build the cyclic `k + 1`-page trace (Task 2); show LRU faults every step while LFD faults `~1` per `k`, driving `LRU/OPT → k`.

3. **Deterministic optimality [proof].** Prove `LRU ≤ k·OPT + k` via phases/marking and prove LFD optimal via the exchange argument (Tasks 5–6); state the matching `k + 1`-page lower bound.

4. **Randomized improvement [coding].** Run MARKER (Task 9), Monte-Carlo the expected ratio near `2H_k`, and explain via the oblivious adversary why `Θ(log k)` is the randomized floor (Task 12).

5. **Augmentation + predictions [coding].** Sweep OPT's cache `h ≤ k` and confirm `k/(k − h + 1)` (Task 10); run PredictiveMarker (Task 11) and report consistency (`→ 1`) and robustness (`≤ k`).

Reference harness in **Python** (combines the pieces):

```python
import random

def opt_belady(trace, k):  return lfd_faults(trace, k)          # Task 1
def det_worst(k):
    trace = cyclic_trace(k, rounds=500)                          # Task 2
    return lru_faults(trace, k) / opt_belady(trace, k)
def rand_worst(k, trials=300):
    trace = cyclic_trace(k, rounds=300)
    opt = opt_belady(trace, k)
    return sum(marker_faults(trace, k, random.Random(t)) / opt
               for t in range(trials)) / trials                  # Task 9

if __name__ == "__main__":
    Hk = lambda k: sum(1.0 / i for i in range(1, k + 1))
    for k in (8, 16, 32):
        det = det_worst(k)
        rnd = rand_worst(k)
        aug = k / (k - (k // 2 + 1) + 1)                          # h = k/2+1
        print(f"k={k:3d}  deterministic≈{det:.2f} (=k={k})  "
              f"randomized≈{rnd:.2f} (floor H_k={Hk(k):.2f}, MARKER 2H_k={2*Hk(k):.2f})  "
              f"augmented(h=k/2+1)={aug:.2f}")
        assert det <= k + 1.0
        assert rnd <= 2 * Hk(k) + 1.0
```

- **Proof answer:** LRU is `k`-competitive (phase/marking upper bound) and `k` is optimal for deterministic paging (`k + 1`-page simulate-and-target adversary). LFD is the offline optimum (exchange argument). MARKER lowers the *expected* ratio to `Θ(H_k)` because the oblivious adversary cannot target a uniformly random victim. Augmentation lowers it to `k/(k − h + 1)` by weakening OPT's cache; predictions reach `1`-consistency while marking guarantees `k`-robustness.
- **Acceptance test:** Deterministic worst ratio `≈ k` (attained on the cyclic trace); randomized worst expected ratio near `2H_k ≪ k`; augmented ratio matches `k/(k − h + 1)`; PredictiveMarker is consistent and robust. The proofs close the deterministic upper and lower bounds and Belady's optimality. The write-up places paging on the online map among the deterministic `k`, the randomized `Θ(log k)`, the augmented `k/(k − h + 1)`, and the predictive consistency–robustness frontier. This mirrors the whole craft — **implement the policy, build the adversary, prove the ratio, measure faults against Belady's OPT, and pin down where randomization, augmentation, and predictions move the floor**.

---

## Where to go next

- Revisit the `c`-competitive framework, adversary models, and Yao's principle that underpin every bound here in the [competitive-analysis tasks](../01-competitive-analysis/tasks.md).
- Build the `O(1)`-per-operation LRU (hash map + doubly-linked list) that these policies drive in the [LRU-cache tasks](../../21-advanced-structures/01-lru-cache/tasks.md).
- For the conceptual treatment of `k`-competitiveness, Belady's optimum, marking and randomized MARKER, resource augmentation, and learning-augmented caching, read this topic's [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) notes.
