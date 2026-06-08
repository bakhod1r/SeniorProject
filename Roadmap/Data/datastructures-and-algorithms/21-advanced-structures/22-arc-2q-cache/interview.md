# ARC and 2Q Adaptive Caches — Interview Preparation

> Questions are grouped Junior → Middle → Senior → Professional. Each row has a concise model answer. A full from-scratch coding challenge (implement 2Q **or** ARC) follows in Go, Java, and Python.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Rapid-Fire One-Liners](#rapid-fire-one-liners)
6. [Coding Challenge](#coding-challenge)

---

## Junior Questions

| # | Question | Model Answer |
|---|----------|--------------|
| 1 | What problem do 2Q and ARC solve that LRU does not? | **Cache pollution from scans / one-hit-wonders.** A one-time sweep over many items evicts LRU's whole hot set; 2Q and ARC are *scan-resistant* — they keep the proven hot set intact during a scan. |
| 2 | What is a "scan" and why does it hurt LRU? | A long, one-time pass over many items never reused soon (e.g., a full-table report). LRU treats each freshly-touched scan item as "most recent" and evicts the genuinely hot items, then never gets hits on the scan items either. |
| 3 | State the one-sentence idea behind 2Q. | Separate items **seen once** from items **seen 2+ times**, and make a new item *earn* its place in the protected area by being accessed a **second** time. |
| 4 | What are 2Q's two queues and how is each managed? | **A1** holds first-time keys and is **FIFO**; **Am** holds proven keys and is **LRU**. The back of each is the eviction point. |
| 5 | When does a key move from A1 to Am? | On its **second** access: if a key already in A1 is accessed again, it is **promoted** — removed from A1, inserted at the front of Am. |
| 6 | Why is A1 a FIFO and not an LRU? | Because re-access should *promote* a key (to Am), not merely refresh it within A1. FIFO ensures a one-time item simply ages out of A1 without lingering. |
| 7 | Walk a scan through 2Q — what happens to the hot set? | Each scan item is new → goes to A1; never accessed twice → never promoted → falls off A1's FIFO tail. Am (the hot set) is never touched. |
| 8 | What is the time complexity of `get`/`put` in 2Q and ARC? | **O(1) average** for both — same as LRU — via a hash map from key to list node plus constant pointer moves. |
| 9 | What two data structures make these caches O(1)? | A **hash map** (find any key in O(1)) plus **doubly linked lists** (unlink/move/evict in O(1)); the map stores key → node. |
| 10 | In one line, how does ARC differ from 2Q? | ARC adds **ghost lists** (records of recently evicted keys) and a **self-tuning parameter `p`**, so it adjusts its recency/frequency split automatically instead of using a fixed one. |
| 11 | What is a "ghost" entry? | A record of a recently **evicted** key that stores the **key/metadata only, not the value** — cheap memory used to detect eviction mistakes. |
| 12 | Give a real system that uses ARC. | **ZFS** (its in-RAM read cache literally called "the ARC"); also NetApp WAFL. |
| 13 | What is "temporal locality" and why does LRU rely on it? | The assumption that recently used items are used again soon. LRU evicts the least-recently-used item *because* it bets that item is least likely to be needed — true often, false during scans. |
| 14 | What is a "one-hit wonder" and which policy resists it? | A key accessed exactly once. 2Q and ARC resist it because it never earns promotion to the protected area; LRU does not. |
| 15 | Does a `get` on an existing key count as "using" it? | Yes. A read promotes/reorders the key just like a write — in 2Q a second `get` promotes A1→Am; in ARC a hit moves the key to T2's MRU. |

---

## Middle Questions

| # | Question | Model Answer |
|---|----------|--------------|
| 1 | Name ARC's four lists and what each holds. | **T1** = cached keys seen once (recency); **T2** = cached keys seen 2+ (frequency); **B1** = ghosts evicted from T1; **B2** = ghosts evicted from T2. T1/T2 hold data; B1/B2 hold keys only. |
| 2 | What does the parameter `p` represent? | The **target size of T1** — the recency budget. `c - p` is the frequency budget (T2). `p ∈ [0, c]`. |
| 3 | How does a ghost hit move `p`? | A hit in **B1** → "evicted recency too soon" → **increase `p`**. A hit in **B2** → "evicted frequency too soon" → **decrease `p`**. `p` only moves on **ghost** hits, never real hits. |
| 4 | Why are the `p` adjustment deltas adaptive (not fixed +1)? | `delta = max(1, |B_other| / |B_this|)`. Pressure on the opposite side amplifies the correction; pressure on the same side damps it. This negative feedback prevents oscillation/thrash. |
| 5 | Which list does a key enter on a true miss? Why? | **T1** (MRU). A first sighting is only recency evidence; it must be re-requested to earn T2. |
| 6 | On a real cache hit (in T1 or T2), where does the key go? | To the **MRU of T2** — any second-or-later access is frequency evidence. |
| 7 | What does the REPLACE subroutine decide? | *Which list to evict from.* Evict from **T1** if `|T1| > p` (T1 over its target), else from **T2**. The evicted key becomes a ghost in B1 or B2. |
| 8 | Why is ARC scan-resistant? | Scan items are new → enter T1, never reach T2 (never re-accessed). REPLACE keeps draining the over-full T1, so T2 (hot set) is never evicted. |
| 9 | How big can ARC's total directory get? | **Up to `2c`** keys: `c` cached values (T1+T2) plus up to `c` value-less ghosts (B1+B2). Invariant: `|T1|+|T2|+|B1|+|B2| ≤ 2c`. |
| 10 | ARC vs LFU — when pick which? | **LFU** when popularity is *stable* and frequency predicts reuse (e.g., a CDN of viral assets). **ARC** when the workload is *mixed and shifting* (reuse + scans + moving hotspots) — ARC adapts; LFU suffers from stale counts after popularity shifts. See [LFU](../21-lfu-cache/middle.md). |
| 11 | What configuration does ARC need? | **Only a size.** No A1/Am split, no aging knob — that absence of tuning is the whole point. |
| 12 | Does ARC eventually behave like LRU or LFU? | It interpolates: on a pure-recency workload `p → c` and it behaves LRU-like; on a pure-frequency workload `p → 0` and it protects hot keys LFU-like. |
| 13 | What happens if a "scan" item is actually re-requested later? | It is found in **B1** → Case II ghost hit → `p` increases and the key is loaded into T2. ARC's scan resistance is not blind; it corrects when it was wrong. |
| 14 | Why must ghost lists store keys only? | To stay cheap. If they stored values, memory would roughly double and the self-tuning would cost as much as just having a bigger cache. |
| 15 | What does the REPLACE tie-breaker `key in B2 and |T1| == p` do? | When the incoming key proved itself frequent (it was in B2) and T1 is exactly at target, it biases REPLACE to evict from **T1**, protecting the frequency side the incoming key belongs to. |
| 16 | Why does ARC move a Case-II/III key into T2, not T1? | A ghost hit means the key was seen before *and* is being seen again — that is a second-or-later access, which is frequency evidence, so it belongs in T2. |
| 17 | If you set `p = c` permanently, what is ARC? | Essentially LRU on T1 (all recency, no protected frequency region). If `p = 0` permanently, it favors the frequency list T2. ARC floats between these. |
| 18 | How does ARC avoid LFU's "stale counts" problem? | It encodes frequency *structurally* (in vs out of T2) plus LRU position, not as a numeric count, so a once-hot key still ages out by position — no count to go stale or overflow. |

---

## Senior Questions

| # | Question | Model Answer |
|---|----------|--------------|
| 1 | Does PostgreSQL use ARC? | **No.** It uses **clock-sweep** (approximate LRU with a per-buffer `usage_count` and a rotating hand), plus **buffer-ring** strategies for scan resistance. It once shipped an ARC-style manager and **removed it over the patent**. |
| 2 | Why did PostgreSQL avoid ARC? | (1) **Patent** — ARC is IBM US 6,996,676; PostgreSQL is BSD and avoids patented algorithms. (2) **Concurrency** — clock-sweep needs one counter + one shared hand, far easier to scale than four reorderable lists + shared `p`. |
| 3 | How does ZFS map onto textbook ARC? | T1→**MRU**, T2→**MFU**, B1→MRU-ghost, B2→MFU-ghost, `p`→**`arc_p`**. ZFS also adds **L2ARC** (SSD victim cache) and **dynamic total sizing** between `arc_min`/`arc_max`. |
| 4 | What is L2ARC? | A second-level cache on fast SSD/NVMe fed by pages evicted from the in-RAM ARC, so a RAM miss can still hit on SSD before going to disk. It is scan-aware so floods don't pollute the SSD tier. |
| 5 | How does InnoDB get scan resistance without ARC? | **Midpoint-insertion LRU**: new pages enter the *old* sublist (≈3/8); a page is only promoted to the *young* sublist if re-accessed after `innodb_old_blocks_time`. Same "earn promotion on a second access" idea as 2Q. |
| 6 | Name two unpatented alternatives to ARC and their angle. | **LIRS** (ranks by reuse distance; strong scan resistance) and **CLOCK-Pro** (LIRS reimplemented on a CLOCK ring → adaptive *and* concurrency-friendly). |
| 7 | What is W-TinyLFU and where is it used? | A window-LRU + SLRU main region with admission gated by a **Count-Min Sketch** frequency estimate. Used in **Caffeine** (Java) and **Ristretto** (Go); ARC-class hit ratio with tiny metadata and great concurrency — today's common default for app caches. |
| 8 | How do you make ARC scale across cores? | **Shard** (stripe keys into N independent ARCs, each with its own lock and `p`) for app caches; for kernel/DB scale prefer **clock/bit-based** policies where a hit just flips a reference bit (lock-light). |
| 9 | Downside of sharding ARC? | Each shard tunes `p` independently, so global adaptivity is approximate, and a hot shard can imbalance. It trades a little adaptation accuracy for near-linear read concurrency. |
| 10 | When does ARC's hit-ratio advantage over LRU actually materialize? | On **mixed workloads** — steady reuse interleaved with scans/maintenance and shifting hotspots. On pure-locality workloads with no scans, ARC ≈ LRU, so LRU's simplicity may win. |
| 11 | What ARC metrics would you alert on in production? | `hit_ratio` (drop → investigate), `arc_p` (pinned at 0/c → one-sided workload), `mru/mfu_ghost_hits` (spike → mid-adaptation), `cache_size` vs budget (ZFS memory starvation), `ghost_directory_bytes` (keys too big). |
| 12 | A classic ZFS ARC incident? | **Memory starvation** — ARC grows to consume RAM the applications need. Fix: lower `arc_max`; monitor cache size vs system free memory. |
| 13 | Is the ARC patent still a constraint today? | US utility patents last ~20 years from filing; the 2002 filing has effectively expired (~2022–2023). The constraint is now largely historical, but it shaped a generation of designs (PostgreSQL, many OSS caches). |
| 14 | One-sentence framing of the whole family. | 2Q, ARC, ZFS MRU/MFU, InnoDB midpoint LRU, and PostgreSQL buffer rings are **the same idea** — protect the proven hot set from one-time scans — implemented with different machinery chosen per system's concurrency and licensing constraints. |
| 15 | A 5-point hit-ratio gain — why might it matter enormously? | When a miss costs ~100,000× a hit (disk vs RAM), latency is miss-dominated; going from 90% to 95% hit ratio can roughly *halve* average latency. In the miss-dominated regime, hit ratio is almost the only lever. |
| 16 | Why is ARC node-local in a distributed cache? | Each node runs its own ARC over the slice of keys it owns; there is no global `p`. A 100-node fleet is 100 independent adapters, not one big adapter — fine, but aggregate behavior is the sum of local adaptations. |
| 17 | What happens to ARC's adaptation across a restart? | Ghost lists and `p` are in-memory, so a restart wipes adaptation state and the cache re-learns from cold. Mitigate with a warm-up window or access-log replay. |
| 18 | Buffer ring (PostgreSQL) vs 2Q — same goal? | Yes: both prevent a scan from evicting the shared hot set. The ring confines a scan to a few buffers; 2Q keeps scan keys out of the protected Am. Different mechanism, same scan-resistance goal. |

---

## Professional Questions

| # | Question | Model Answer |
|---|----------|--------------|
| 1 | Is ARC better than LRU in competitive ratio? | **No — provably not.** Both are `c`-competitive, and **no deterministic online paging policy beats `c`** (adversary requests the one page not cached). ARC's win is on *realistic* workloads, not the adversarial worst case. |
| 2 | Prove no deterministic online policy beats `c`-competitive. | Use `c+1` pages; adversary always requests the page **not** in the online cache → online faults every step. OPT (clairvoyant) evicts the farthest-future page → faults ≤ once per `c`. Ratio → `c`. |
| 3 | Sketch the proof that LRU is `c`-competitive. | **Phase partition**: split the request stream into maximal runs of ≤ `c` distinct pages. LRU faults ≤ `c` per phase; OPT faults ≥ 1 per phase boundary (`c+1` distinct pages over a phase + next request vs `c` slots). Sum → `cost_LRU ≤ c·cost_OPT + O(1)`. |
| 4 | State the scan-resistance theorem for ARC. | For a **pure scan** (distinct pages referenced exactly once), every page is a Case IV miss → enters T1, never T2. REPLACE evicts from T1 while `|T1| > p`, so **T2 is never touched** — the pre-scan hot set survives. |
| 5 | Why is ARC's adaptation well-defined? | Deltas use `max(1, |B_other| / |B_this|)`; a ghost hit implies the relevant ghost list is non-empty so the denominator ≥ 1 (no divide-by-zero), and `p` is clamped to `[0, c]`. |
| 6 | What can you actually *prove* about `p` (vs not)? | **Provable:** `p ∈ [0, c]`, moves toward the side faulting on recently-evicted pages, and damps to avoid oscillation (bounded directional tracking). **Not claimed:** convergence to a global optimum — that's online and time-varying; ARC's near-optimality is empirical. |
| 7 | State ARC's key invariants. | `|T1|+|T2| ≤ c`; `|T1|+|B1| ≤ c`; total `≤ 2c`; lists pairwise disjoint; ghosts empty while data not full; `p ∈ [0, c]`. |
| 8 | Exact ghost-list memory overhead vs LRU? | `≤ c·(k + h)` bytes (`k`=key bytes, `h`=per-entry bookkeeping), i.e. `≈ k/v` of the data footprint. ~**0.2%** for 8-byte keys on 4 KiB blocks; up to ~50% when `v ≈ k` (mitigate by **hashing keys** to fixed tokens). |
| 9 | Is ARC a stack algorithm (Bélády-anomaly-free)? | **Not in general.** Adaptivity couples `p` to the size history, so the clean inclusion property `Contents_c ⊆ Contents_{c+1}` that LRU enjoys does not transfer. Empirically ARC shows no anomaly, but the one-line proof LRU has does not apply. |
| 10 | Why is every ARC operation O(1) worst case (no amortization)? | Hash directory → O(1) membership; doubly linked lists → O(1) unlink/push/tail-read; REPLACE and `p`-update are constant work. No heap is needed because all ordering is by **list position**, never a numeric key (unlike naive LFU's O(log c)). |
| 11 | Relate 2Q and ARC formally. | Simplified 2Q = ARC with `p` **pinned** at the fixed A1 size and adaptation off. Full 2Q's `A1out` ≈ `B1`. ARC generalizes by adding `B2` **and** making the split `p` adaptive via B1-vs-B2 feedback. |
| 12 | Why is competitive analysis "the wrong tool" for separating LRU and ARC? | Because it is worst-case/adversarial and *all* sensible deterministic policies hit the same `c` lower bound. The separation between LRU and ARC is **distributional** (real, non-adversarial, scan-prone traces), invisible to competitive analysis. |
| 13 | What's the anti-thrash argument for `p`? | A B1 hit's step is `max(1, |B2|/|B1|)`: a large *same-side* ghost list (`|B1|`) shrinks the step (diminishing response), while a large *opposite-side* (`|B2|`) enlarges it (correct faster under joint pressure). This negative feedback gives bounded, convergent tracking. |
| 14 | How much can ARC beat LRU — bounded or unbounded? | **Worst case:** zero (adversary makes both fault every step). **Scan model:** unbounded — with a hot set reused R times between scans, LRU's extra faults grow without bound while ARC avoids them. **Real traces:** a few to tens of points, near OPT. |
| 15 | Why does ARC need no heap while LFU often does? | ARC orders by **list position** only; "frequent" is the structural fact "is in T2," not a number to compare. Nothing to sort → no heap → O(1) worst case. LFU compares numeric counts → priority queue (or the bucket trick). |
| 16 | Construct a workload where ARC vastly beats LRU. | Hot set `H` of size `c-1` reused `R` times, interleaved with scans of length `s ≫ c`. LRU evicts `H` on every scan (≈`R·#scans·|H|` extra faults); ARC keeps `H` in T2 untouched (≈0 extra faults). |
| 17 | Is ARC's `p` proven to converge to the optimum? | No. Provable: `p ∈ [0,c]`, directional correctness, damping (no runaway). The *optimum* is online and time-varying; near-optimality is empirical, not a theorem. |
| 18 | State the exact directory bound and why it matters. | `|T1|+|T2|+|B1|+|B2| ≤ 2c`. It caps ghost memory at `c` value-less entries, making the self-tuning overhead provably bounded (≈`k/v` of data). |

---

## System Design Discussion Prompts

These are open-ended prompts an interviewer expands into a conversation. Each row gives the angle a strong answer takes.

| # | Prompt | Strong-answer angle |
|---|--------|---------------------|
| 1 | "Design the read cache for a new storage engine." | Start with the workload: OLTP locality + analytics scans → you need scan resistance. Propose ARC/2Q/W-TinyLFU; justify by concurrency (clock/bit-based if many cores), memory (ghost cost vs value size), and licensing. Add an L2 SSD victim tier if the working set exceeds RAM. |
| 2 | "Your LRU cache's hit ratio tanks every night at 2 AM. Diagnose." | A nightly **batch/scan** (backup, ETL, `VACUUM`) floods LRU and evicts the daytime hot set; the morning then starts cold. Fix: scan-resistant policy (ARC/2Q) or confine the batch to a buffer ring / `SELECT ... ` with a bounded scan strategy. |
| 3 | "Pick a cache library for a Java service." | **Caffeine** (W-TinyLFU): ARC-class hit ratio, tiny metadata, excellent concurrency, unpatented, actively maintained. Mention ARC as the conceptual ancestor and why you would *not* hand-roll it. |
| 4 | "Pick one for a Go service." | **Ristretto** (W-TinyLFU) for high-concurrency; `hashicorp/golang-lru` (2Q variant available) for simpler needs. Same reasoning: sketch-gated admission beats hand-rolled ARC on concurrency. |
| 5 | "How would you make ARC thread-safe?" | Shard into N independent ARCs (each its own lock + `p`) for app caches; or move to a bit/clock policy where a hit just flips a reference bit and the heavy list maintenance is batched/deferred (the Caffeine approach). A single global lock is the wrong answer. |
| 6 | "How do you A/B test a new eviction policy in prod?" | Replay real traces offline first (trace-driven hit-ratio curves vs capacity). Then shadow/dark-launch on a fraction of nodes, compare hit ratio and p99 latency, watch backend load. Adaptive policies must be evaluated on *mixed* traces, not synthetic uniform ones. |
| 7 | "ARC uses twice the directory of LRU — is that a problem?" | Only if values are small relative to keys. For 8 KiB pages keyed by 8-byte ids, ghosts are ~0.6% overhead — free. For tiny values keyed by long strings, hash the keys for the ghost directory or bound ghost size. Quantify before worrying. |

---

## Common Misconceptions to Correct

| Misconception | Correction |
|---------------|------------|
| "ARC has a better competitive ratio than LRU." | No — both are `c`-competitive, and no deterministic policy beats `c`. ARC wins on *real* workloads, not worst case. |
| "Ghost lists cache extra data." | Ghosts store **keys only**; there is no value. A ghost hit still hits the backend. |
| "`p` is set by the operator." | `p` is fully self-tuned by ghost hits. ARC takes only a *size*. |
| "2Q and ARC are the same." | 2Q has a *fixed* split; ARC adds a second ghost list and makes the split *adaptive*. |
| "A ghost hit reduces backend load." | It does not — it triggers a load *and* adjusts `p` for the future. |
| "PostgreSQL uses ARC." | It uses clock-sweep; it removed ARC over the patent. |
| "LFU is always more scan-resistant than ARC." | LFU resists scans via counts but suffers stale counts on popularity shifts; ARC adapts. |
| "More cache always helps ARC monotonically (stack property)." | Empirically yes, but ARC is not provably a stack algorithm — adaptivity couples behavior to size history. |

---

## Rapid-Fire One-Liners

| Prompt | Answer |
|--------|--------|
| A1 order? | FIFO |
| Am order? | LRU |
| Promotion trigger? | second access |
| ARC's adaptive dial? | `p` (target size of T1) |
| B1 hit → ? | `p` up (favor recency) |
| B2 hit → ? | `p` down (favor frequency) |
| Ghosts store? | keys only, no values |
| Directory bound? | `2c` |
| ARC config knobs? | size only |
| ARC competitive ratio? | `c` (same as LRU) |
| ARC beats LRU worst-case? | no (provably) |
| Patent? | IBM US 6,996,676 |
| PostgreSQL policy? | clock-sweep |
| Flagship ARC user? | ZFS |
| Modern unpatented rival? | W-TinyLFU |

---

## Coding Challenge

> **Implement a simplified 2Q cache** with `get(key)` and `put(key, value)`. (A from-scratch ARC variant is sketched in the comments at the end of each solution for the stretch version.)
>
> **Rules:**
> - `A1` (first-time keys) is a **FIFO**; `Am` (proven keys) is an **LRU**.
> - A key already in `A1` that is accessed again is **promoted** to the front of `Am`.
> - On overflow, evict the **oldest** of A1 (FIFO) or the **LRU** of Am.
> - Both operations must be **O(1)**. Use a hash map + doubly linked lists (do not rely on language-ordered maps for the stretch goal).
>
> **Test scenario** (A1 cap = 2, Am cap = 2):
> ```
> put(1,"a"); put(2,"b"); get(1) -> "a" (1 promoted to Am)
> put(3,"c"); put(4,"d")  -> A1 overflow evicts 2 (FIFO)
> get(3) -> "c" (3 promoted to Am)
> get(2) -> miss
> get(1) -> "a"; get(3) -> "c" (both in Am)
> ```

### Go

```go
package main

import "fmt"

type node struct {
	key, val   int
	prev, next *node
}

// dlist is a doubly linked list with sentinel head/tail.
type dlist struct {
	head, tail *node
	size       int
}

func newList() *dlist {
	h, t := &node{}, &node{}
	h.next, t.prev = t, h
	return &dlist{head: h, tail: t}
}
func (l *dlist) pushFront(n *node) {
	n.prev, n.next = l.head, l.head.next
	l.head.next.prev, l.head.next = n, n
	l.size++
}
func (l *dlist) remove(n *node) {
	n.prev.next, n.next.prev = n.next, n.prev
	l.size--
}
func (l *dlist) back() *node { return l.tail.prev } // LRU / oldest

type TwoQ struct {
	a1Cap, amCap int
	a1, am       *dlist
	a1m, amm     map[int]*node
}

func NewTwoQ(a1Cap, amCap int) *TwoQ {
	return &TwoQ{a1Cap, amCap, newList(), newList(),
		map[int]*node{}, map[int]*node{}}
}

func (c *TwoQ) Get(key int) (int, bool) {
	if n, ok := c.amm[key]; ok { // hit in Am -> LRU touch
		c.am.remove(n)
		c.am.pushFront(n)
		return n.val, true
	}
	if n, ok := c.a1m[key]; ok { // hit in A1 -> PROMOTE to Am
		c.a1.remove(n)
		delete(c.a1m, key)
		c.am.pushFront(n)
		c.amm[key] = n
		c.evictAm()
		return n.val, true
	}
	return 0, false
}

func (c *TwoQ) Put(key, val int) {
	if n, ok := c.amm[key]; ok {
		n.val = val
		c.am.remove(n)
		c.am.pushFront(n)
		return
	}
	if n, ok := c.a1m[key]; ok {
		n.val = val
		c.a1.remove(n)
		delete(c.a1m, key)
		c.am.pushFront(n)
		c.amm[key] = n
		c.evictAm()
		return
	}
	n := &node{key: key, val: val}
	c.a1.pushFront(n)
	c.a1m[key] = n
	if c.a1.size > c.a1Cap { // FIFO evict oldest
		old := c.a1.back()
		c.a1.remove(old)
		delete(c.a1m, old.key)
	}
}

func (c *TwoQ) evictAm() {
	if c.am.size > c.amCap { // LRU evict
		lru := c.am.back()
		c.am.remove(lru)
		delete(c.amm, lru.key)
	}
}

func main() {
	c := NewTwoQ(2, 2)
	c.Put(1, 'a')
	c.Put(2, 'b')
	v, _ := c.Get(1) // promote 1
	fmt.Printf("get(1)=%c\n", v)
	c.Put(3, 'c')
	c.Put(4, 'd') // A1 overflow evicts 2
	c.Get(3)      // promote 3
	if _, ok := c.Get(2); !ok {
		fmt.Println("get(2)=miss")
	}
	v1, _ := c.Get(1)
	v3, _ := c.Get(3)
	fmt.Printf("get(1)=%c get(3)=%c\n", v1, v3)
}

// Stretch (ARC): add b1/b2 ghost lists (key-only) and an int p.
// On a miss whose key is in b1 -> p=min(p+max(1,|b2|/|b1|),cap); load into Am.
// In b2 -> p=max(p-max(1,|b1|/|b2|),0); load into Am. Evict from A1/T1 when its
// size exceeds p, else from Am/T2, demoting the victim's key into the matching ghost.
```

### Java

```java
import java.util.HashMap;
import java.util.Map;

public class TwoQCache {
    static class Node { int key, val; Node prev, next; Node(int k,int v){key=k;val=v;} Node(){} }

    static class DList {
        final Node head = new Node(), tail = new Node();
        int size = 0;
        DList(){ head.next = tail; tail.prev = head; }
        void pushFront(Node n){ n.prev=head; n.next=head.next; head.next.prev=n; head.next=n; size++; }
        void remove(Node n){ n.prev.next=n.next; n.next.prev=n.prev; size--; }
        Node back(){ return tail.prev; } // LRU / oldest
    }

    private final int a1Cap, amCap;
    private final DList a1 = new DList(), am = new DList();
    private final Map<Integer,Node> a1m = new HashMap<>(), amm = new HashMap<>();

    public TwoQCache(int a1Cap, int amCap){ this.a1Cap=a1Cap; this.amCap=amCap; }

    public Integer get(int key){
        Node n = amm.get(key);
        if (n != null){ am.remove(n); am.pushFront(n); return n.val; } // LRU touch
        n = a1m.get(key);
        if (n != null){                                                // PROMOTE
            a1.remove(n); a1m.remove(key);
            am.pushFront(n); amm.put(key, n);
            evictAm();
            return n.val;
        }
        return null; // miss
    }

    public void put(int key, int val){
        Node n = amm.get(key);
        if (n != null){ n.val=val; am.remove(n); am.pushFront(n); return; }
        n = a1m.get(key);
        if (n != null){
            n.val=val; a1.remove(n); a1m.remove(key);
            am.pushFront(n); amm.put(key,n); evictAm(); return;
        }
        n = new Node(key, val);
        a1.pushFront(n); a1m.put(key, n);
        if (a1.size > a1Cap){ Node old = a1.back(); a1.remove(old); a1m.remove(old.key); }
    }

    private void evictAm(){
        if (am.size > amCap){ Node lru = am.back(); am.remove(lru); amm.remove(lru.key); }
    }

    public static void main(String[] args){
        TwoQCache c = new TwoQCache(2,2);
        c.put(1,'a'); c.put(2,'b');
        System.out.println("get(1)="+(char)(int)c.get(1)); // promote 1
        c.put(3,'c'); c.put(4,'d');                        // A1 overflow evicts 2
        c.get(3);                                          // promote 3
        System.out.println("get(2)=" + (c.get(2)==null ? "miss" : c.get(2)));
        System.out.println("get(1)="+(char)(int)c.get(1)+" get(3)="+(char)(int)c.get(3));
    }
}
```

### Python

```python
class Node:
    __slots__ = ("key", "val", "prev", "next")
    def __init__(self, key=0, val=0):
        self.key, self.val, self.prev, self.next = key, val, None, None


class DList:
    """Doubly linked list with sentinel head/tail."""
    def __init__(self):
        self.head, self.tail = Node(), Node()
        self.head.next, self.tail.prev = self.tail, self.head
        self.size = 0

    def push_front(self, n):
        n.prev, n.next = self.head, self.head.next
        self.head.next.prev = n
        self.head.next = n
        self.size += 1

    def remove(self, n):
        n.prev.next, n.next.prev = n.next, n.prev
        self.size -= 1

    def back(self):           # LRU / oldest
        return self.tail.prev


class TwoQCache:
    def __init__(self, a1_cap, am_cap):
        self.a1_cap, self.am_cap = a1_cap, am_cap
        self.a1, self.am = DList(), DList()
        self.a1m, self.amm = {}, {}

    def get(self, key):
        if key in self.amm:                       # hit in Am -> LRU touch
            n = self.amm[key]
            self.am.remove(n); self.am.push_front(n)
            return n.val
        if key in self.a1m:                       # hit in A1 -> PROMOTE
            n = self.a1m.pop(key)
            self.a1.remove(n)
            self.am.push_front(n); self.amm[key] = n
            self._evict_am()
            return n.val
        return None                               # miss

    def put(self, key, val):
        if key in self.amm:
            n = self.amm[key]; n.val = val
            self.am.remove(n); self.am.push_front(n); return
        if key in self.a1m:
            n = self.a1m.pop(key); n.val = val
            self.a1.remove(n)
            self.am.push_front(n); self.amm[key] = n
            self._evict_am(); return
        n = Node(key, val)
        self.a1.push_front(n); self.a1m[key] = n
        if self.a1.size > self.a1_cap:            # FIFO evict oldest
            old = self.a1.back()
            self.a1.remove(old); del self.a1m[old.key]

    def _evict_am(self):
        if self.am.size > self.am_cap:            # LRU evict
            lru = self.am.back()
            self.am.remove(lru); del self.amm[lru.key]


if __name__ == "__main__":
    c = TwoQCache(2, 2)
    c.put(1, "a"); c.put(2, "b")
    print("get(1)=", c.get(1))   # promote 1
    c.put(3, "c"); c.put(4, "d") # A1 overflow evicts 2
    c.get(3)                     # promote 3
    print("get(2)=", c.get(2) or "miss")
    print("get(1)=", c.get(1), "get(3)=", c.get(3))

# Stretch (ARC): add b1/b2 (key-only dicts) and int p. On a miss in b1:
#   p = min(p + max(1, len(b2)//max(1,len(b1))), cap); load into T2.
# In b2: p = max(p - max(1, len(b1)//max(1,len(b2))), 0); load into T2.
# REPLACE evicts from T1 when len(T1) > p (key -> b1), else from T2 (key -> b2).
```

**Complexity of all three:** `get` and `put` are **O(1)** (hash lookup + constant pointer surgery). Space is **O(a1Cap + amCap)** for 2Q, or **O(2c)** directory for the ARC stretch (data + ghost keys).

---

## Whiteboard Checklist

When you implement 2Q or ARC live, walk the interviewer through these decisions explicitly — they are exactly what graders look for:

1. **State the two structures.** "Hash map for O(1) lookup + doubly linked lists for O(1) reorder/evict; the map stores key → node."
2. **Use sentinel head/tail nodes.** They kill the empty-list and last-node edge cases. Say so before coding.
3. **A1 is FIFO, Am/T2 is LRU.** Call this out — mixing them up is the most common bug.
4. **Promotion is on the *second* access.** Show the case split: in Am/T2 → touch; in A1/T1 → promote; new → insert into the recency area.
5. **Delete on eviction from *both* the list map and the value store.** Forgetting this leaks memory and returns stale nodes.
6. **For ARC, ghosts hold keys only.** Drop the value when demoting to B1/B2.
7. **For ARC, adjust `p` only on ghost hits, clamp to `[0,c]`, guard the divide with `max(1,...)`.**
8. **Test the scan.** Pre-prove a hot set, run a scan, assert the hot set survives — this is the property the whole topic exists for.

## Self-Test Trace (do this before the interview)

Run this stream through your 2Q (A1 cap 2, Am cap 2) on paper and confirm the final state:

```
put(10); put(20); get(10); put(30); put(40); get(30); get(20); get(10); get(30)
```

Expected reasoning:
- `put(10),put(20)` → A1 = [20,10]
- `get(10)` → promote 10 → Am = [10], A1 = [20]
- `put(30)` → A1 = [30,20]
- `put(40)` → A1 overflows → evict 20 (FIFO) → A1 = [40,30]
- `get(30)` → promote 30 → Am = [30,10], A1 = [40]
- `get(20)` → **miss** (evicted)
- `get(10)` → hit in Am → Am = [10,30]
- `get(30)` → hit in Am → Am = [30,10]

If your implementation produces a different final `Am`/`A1`, the bug is almost always (a) A1 managed as LRU instead of FIFO, or (b) promotion on the wrong access. Fix those first.

## What Interviewers Probe After You Finish

| Follow-up | What they want to hear |
|-----------|------------------------|
| "Make it thread-safe." | Shard with per-shard locks; or a bit/clock policy with deferred maintenance — not one global lock. |
| "Now make it ARC." | Add B1/B2 (key-only) and `p`; ghost hits in B1↑p, B2↓p; REPLACE evicts T1 if `|T1|>p` else T2. |
| "What's the memory overhead?" | Up to `c` extra value-less ghost keys (directory ≤ `2c`); ≈`k/v` of data — negligible for big values. |
| "Why O(1) and not O(log n)?" | Ordering is by list position, not a numeric count — no heap needed (contrast LFU). |
| "Prove it beats LRU." | Not in worst case (both `c`-competitive); it wins on scan-prone real workloads — construct the hot-set-plus-scan trace. |
| "Which real library would you actually use?" | Caffeine (Java) / Ristretto (Go) — W-TinyLFU; or `hashicorp/golang-lru`'s 2Q. Hand-rolling ARC in prod is rarely worth it. |
| "Why didn't PostgreSQL use ARC?" | Patent (IBM US 6,996,676) + concurrency; it uses clock-sweep plus buffer rings instead. |

## Pitfall Quick-Reference

A condensed list of the bugs that fail candidates on this problem:

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| A1 as LRU | one-time bursts pollute the cache | A1 must be **FIFO** |
| Promote on first access | scan items reach the protected area | promote only on the **second** access |
| Value left in store after eviction | memory leak, stale reads | delete from list-map **and** value store |
| Ghosts store values (ARC) | memory roughly doubles | ghosts hold **keys only** |
| `p` moved on a real hit | adaptation drifts wrongly | move `p` **only** on ghost hits (Cases II/III) |
| `p` unclamped or divide-by-zero | crash / out-of-range target | clamp to `[0,c]`; `max(1, ...)` denominator |
| Key in two lists at once | size accounting corrupts eviction | remove from old list **before** inserting elsewhere |
| Singly linked list | O(n) unlink | use a **doubly** linked list |

## Final Talking Points

If you have time at the end, leave the interviewer with the three sentences that prove depth:

1. "2Q and ARC fix LRU's scan pollution by making a new key *earn* promotion on its second access."
2. "ARC goes further with ghost lists that let it *measure its own eviction mistakes* and retune the recency/frequency split `p` with no configuration."
3. "It can't beat LRU in the adversarial competitive ratio — nothing can — but on real, scan-prone workloads it gets much closer to optimal, which is why ZFS and storage engines use it."
