# Amortized Analysis — Professional Level

## Table of Contents

1. [What This Tier Is About](#what-this-tier-is-about)
2. [The Tail-Latency Problem: Amortized O(1) Is a Throughput Claim, Not a Latency One](#the-tail-latency-problem)
3. [Resize Spikes in Real Hash Maps](#resize-spikes-in-real-hash-maps)
4. [Adversarial Amortization: When the Average Is an Attack Surface](#adversarial-amortization)
5. [Garbage Collection as De-amortization](#garbage-collection-as-de-amortization)
6. [Why Amortized Bounds Are Fragile Under Concurrency](#why-amortized-bounds-are-fragile-under-concurrency)
7. [Real-Time Engineering: Global and Lazy Rebuilding](#real-time-engineering-global-and-lazy-rebuilding)
8. [Amortization Under Persistence in Production](#amortization-under-persistence-in-production)
9. [Production Reference: An Incrementally-Resizing Hash Map in Go](#production-reference)
10. [Why the Migration Budget Keeps the Old Table Draining in Time](#why-the-migration-budget-drains-in-time)
11. [Observing Resize Latency: Histograms and p99](#observing-resize-latency)
12. [Decision Framework](#decision-framework)
13. [Research Pointers](#research-pointers)
14. [Key Takeaways](#key-takeaways)

---

## What This Tier Is About

Junior through senior establish the machinery: the aggregate, accounting (banker's), and potential (physicist's) methods, the canonical structures (dynamic array, Fibonacci heap, splay tree, union-find), and the senior-defining insight that amortized bounds break under persistence ([`./senior.md`](./senior.md)). This tier assumes all of it and asks one question: **what happens when an amortized data structure meets a production system that measures latency at the 99th percentile, runs under concurrency, and is targeted by adversaries?**

The answer is uncomfortable. The textbook bound — "O(1) amortized push" — is *correct* and *useless* for the engineer holding a 10 ms p99 SLO, because amortization is a statement about the *sum* over a sequence, and a p99 SLO is a statement about the *worst few* operations in that sequence. These two views are not just different; they are in tension. The entire professional skill is knowing when the amortized view is the right one, when it is a lie, and what to build instead.

This file is organized around the places amortization meets production and the places it breaks: tail latency, concurrent resizes, garbage collection, real-time de-amortization, and persistence. It ends with a Go reference for an incrementally-resizing hash map that converts an O(1)-amortized / O(n)-worst-case insert into a true O(1)-worst-case insert, plus how to observe the difference.

---

## The Tail-Latency Problem

Consider a dynamic array or open-addressed hash map with geometric growth. The bound is O(1) amortized per insert. Decompose what an insert actually costs:

- The **typical** insert: O(1) — a write and a counter bump.
- The **resize** insert: O(n) — allocate a table of double the size, rehash and copy every live element.

Over `n` inserts there are `log₂ n` resizes, and the total copy work is `< 2n`, so the *average* is O(1). But the *distribution* is bimodal and the expensive mode lands on specific operations. If your service does one map insert per request, then roughly `log₂ n` requests out of `n` are O(n) — and those are precisely the requests that define your tail.

```text
1,000,000 inserts into a doubling table:
  mean cost per insert      ≈ 3 units        (amortized O(1) — the throughput story)
  resizes                   ≈ 20             (at sizes 1,2,4,...,524288,1048576)
  cost of the LAST resize   ≈ 1,048,576      (one insert pays to move a million entries)

If each request triggers one insert, the request that lands on the final
resize is ~350,000x slower than the median. That is your p99.9999 — and
under sustained load with many concurrent maps, it surfaces far more often
than "one in a million" intuition suggests.
```

This is the core professional pitfall: **amortized O(1) tells you about cumulative cost and says nothing about the latency of any individual operation.** For batch jobs, build tools, and offline pipelines — where you care about total wall-clock — the amortized view is exactly right. For a latency-sensitive service measured at p99/p999, the resize spike is a recurring micro-outage. Tail latency compounds in fan-out architectures: a request that touches 100 backends has its latency set by the *slowest* of the 100, so even a 1-in-1000 spike per backend hits ~10% of requests. See [`../01-time-vs-space-complexity/professional.md`](../01-time-vs-space-complexity/professional.md) on memory-hierarchy and trade-off framing.

---

## Resize Spikes in Real Hash Maps

Production runtimes know this, and the mature ones *de-amortize* their hash maps to bound worst-case per-operation work. Three concrete designs:

### Go maps — incremental evacuation

Go's built-in `map` grows by allocating a new bucket array (roughly double) and then **evacuating** old buckets to it incrementally. The map keeps both `buckets` (new) and `oldbuckets` (old). It does **not** copy everything at growth time. Instead, each subsequent `mapassign`/`mapdelete` evacuates a small, bounded number of old buckets (`growWork` typically migrates the bucket being touched plus one more). Reads consult `oldbuckets` when a key has not yet been evacuated. The growth is "finished" only once every old bucket has been drained by ordinary traffic.

The effect: no single `m[k] = v` pays the full O(n) copy. The copy cost is smeared across the inserts that follow the growth trigger — classic de-amortization, built into the runtime precisely because a runtime cannot afford an unbounded stall inside a single map write. (Go also distinguishes *growing bigger* from *same-size growth* to clean out tombstones from heavy deletion.)

### Java HashMap — the un-de-amortized baseline

`java.util.HashMap.resize()` is the opposite design: when `size > capacity * loadFactor` (default 0.75), it allocates a table of double the capacity and **rehashes every entry in one synchronous call**, inside the very `put` that crossed the threshold. That `put` is O(n). Java accepts the spike because `HashMap` is single-threaded-by-contract and tuned for throughput, not tail latency. The standard mitigations are *avoidance*, not de-amortization: pre-size with `new HashMap<>(expectedSize / 0.75 + 1)` so the resize never fires on the hot path. The lesson: a well-known, widely-deployed structure can be wholly un-de-amortized — the resize spike is real and the only defense is to never trigger it during a latency-critical phase.

### Redis — incremental rehashing with two tables

Redis's `dict` is the textbook production de-amortization. It holds **two hash tables**, `ht[0]` and `ht[1]`. On growth it allocates `ht[1]` and sets a `rehashidx` cursor to 0. Thereafter:

- Every `dictAdd`/`dictFind`/`dictDelete` performs `dictRehashStep` — migrating **one** bucket (a small bounded amount) from `ht[0]` to `ht[1]` and advancing `rehashidx`.
- A background, time-boxed `dictRehashMilliseconds` (driven by the server cron) migrates more when the server is otherwise idle.
- **Lookups during rehash check both tables**; new writes go only to `ht[1]`. When `rehashidx` reaches the end, `ht[0]` is freed and the tables swap.

No single command ever blocks on a full table copy, which is non-negotiable for a single-threaded server whose entire latency profile depends on never stalling the event loop. Redis even *pauses* rehashing while a `fork()`-based BGSAVE child is alive, to preserve copy-on-write page sharing — a production constraint that pure amortized analysis never sees.

**The common thread:** all three runtimes that care about per-operation latency (Go, Redis) bound the worst case by spreading the copy over many operations; the one that does not (Java `HashMap`) tells you to pre-size. De-amortization is the engineering answer to the tail-latency problem.

---

## Adversarial Amortization

Amortized analysis carries a premise so quiet it is easy to miss: **the operation sequence is fixed in advance and chosen without knowledge of the structure's internal state.** Production adversaries violate this directly, and an amortized bound offers no protection against an attacker who can *steer the sequence toward the expensive operation on demand.*

### Collision flooding (algorithmic-complexity DoS)

A separate-chaining or open-addressed hash table is O(1) amortized *only if keys spread across buckets.* If an attacker knows the hash function and can submit keys that all land in one bucket, every insert and lookup degrades to O(n), and the structure's amortized bound is meaningless — `n` requests become Θ(n²) work. This is not theoretical: the 2011 "hash DoS" disclosures (28C3) broke the default string hashes of PHP, Python, Ruby, Java, and others, letting a few kilobytes of crafted POST keys peg a server's CPU. The amortized average assumed a benign key distribution; the adversary simply supplied a malign one.

The defense is **seeded / keyed hashing** — a per-process (ideally per-map) random seed mixed into the hash, so the attacker cannot predict which keys collide. Go's `maphash` and the runtime's seeded map hash, Python's `PYTHONHASHSEED`, and SipHash (Aumasson–Bernstein) as a fast keyed PRF are the standard responses. The seed restores the *expected* O(1) the amortized argument relied on by denying the adversary control over the bucket distribution.

### Reactive triggering of the expensive operation

A subtler attack targets the resize itself. If an attacker can drive a map to exactly the size that triggers a rehash and then hold it oscillating across the threshold — insert to grow, delete to shrink, insert to grow — they can force a full O(n) rehash on a large fraction of operations, defeating the geometric-growth amortization that assumed resizes are *rare.* The mitigation is **hysteresis**: never shrink at the same load factor you grow at (e.g., grow at 0.75, shrink only below 0.1), so no operation sequence can pin the structure on the resize boundary. The same de-amortized two-table design above also helps, because it bounds the per-op cost even when a resize *is* triggered.

The professional rule: **whenever an adversary can choose the operation sequence reactively, treat the amortized average as unreachable** and reason about the worst case the attacker can manufacture. Amortization is a tool for trusted, fixed sequences; the open internet is neither.

---

## Garbage Collection as De-amortization

Garbage collection is the largest-scale amortization in most production systems, and the history of GC *is* the history of de-amortizing it.

**Stop-the-world (STW) tracing** is the fully-amortized design: allocation is O(1) and cheap, and the cost of reclamation is deferred and paid in one big batch when the heap fills. Amortized over all allocations the per-allocation GC cost is small — but it is paid as a single STW pause that scales with live-set size. That pause is exactly the resize spike, writ large: O(1) amortized allocation, O(heap) worst-case latency on the allocation that triggers the collection.

**Incremental and concurrent collectors de-amortize the pause** by interleaving collection work with the mutator (Go's concurrent mark-and-sweep, the JVM's G1/ZGC/Shenandoah, generational/incremental schemes generally). They trade total throughput (concurrent GC does *more* total work) for bounded pause time — the same trade as an incremental hash resize.

The credit mechanism is concrete and worth naming: **write barriers are the "potential" of a concurrent collector.** When the mutator runs concurrently with the marker, it can mutate pointers the collector has already scanned, threatening to hide a live object (the lost-object / tricolor-invariant problem). A write barrier intercepts each pointer write and records the affected object (greying it) so the collector revisits it. Each barrier is a small, bounded cost paid *per mutation* — the cheap operations pre-paying so the expensive operation (collection) never has to stop the world to re-scan everything. In amortized-analysis terms: the write barrier is the per-operation credit deposited to fund incremental marking, and the bound it buys is a worst-case pause, not just a good average. ZGC and Shenandoah push this further with *load barriers* and colored pointers to bound pauses into the sub-millisecond range largely independent of heap size — de-amortization taken to its limit.

---

## Why Amortized Bounds Are Fragile Under Concurrency

Amortized analysis assumes a single thread executing a sequence. Concurrency violates two of its premises at once, and the failures are characteristic.

### The cost concentrates on one unlucky thread

In a sequential program the O(n) resize is at least paid by the thread that "deserves" it — the one whose insert crossed the threshold. Under concurrency, that thread typically does the resize **while holding a lock that every other thread needs.** The cost is no longer amortized across operations; it is *concentrated on one thread and propagated to all waiters*. Ten threads doing O(1) inserts can all stall for O(n) because one of them is mid-resize behind a held lock. The amortized average is technically intact across the operation count, but the *latency* experienced by the blocked threads is the full O(n) — the average has become irrelevant to every observer.

### The standard countermeasures

- **Striped / segmented resizing.** Partition the table into independently-locked stripes (the old `ConcurrentHashMap` design, `ConcurrentHashMap` Java 7 segments). A resize locks and rebuilds one stripe at a time, so a writer to another stripe is unaffected. Bounds the blast radius but not the per-stripe spike.
- **Cooperative incremental resize.** Java 8's `ConcurrentHashMap` lets multiple threads *help* transfer buckets concurrently (`transferIndex`, `ForwardingNode` sentinels mark migrated bins). A thread that finds a `ForwardingNode` follows it to the new table and pitches in on the transfer rather than blocking. The O(n) work is parallelized *and* de-amortized across the threads that happen to touch the map during growth.
- **RCU (Read-Copy-Update).** Readers never block and never lock; writers build a new version and atomically publish it, reclaiming the old version only after a grace period during which all pre-existing readers have departed. Reclamation cost is amortized into the grace-period machinery rather than charged to any reader. Ubiquitous in the Linux kernel for read-mostly structures.
- **Lock-free resizable hash tables — split-ordered lists (Shalev–Shavit).** The elegant answer to "how do you resize without ever moving an element." Keys are kept in a single lock-free linked list ordered by the **bit-reversal** of their hash. The bucket array holds *pointers into* this list (dummy sentinel nodes). Growing the table does **not** rehash or move any item; it merely lazily initializes new sentinel pointers that split existing buckets. Because no element ever moves, there is no O(n) migration to amortize at all — the resize spike is *designed out* rather than spread out. This is the gold standard, and it is genuinely intricate.

The trade-off is always the same: lock-free and incremental designs eliminate the spike at a real cost in implementation complexity, memory overhead, and constant factors. For a read-mostly cache, `sync.Map` / striping may be plenty; for a hard latency SLO under write contention, split-ordered lists or cooperative resize earn their complexity. Reach for the simplest design the SLO permits — not the cleverest one available.

---

## Real-Time Engineering: Global and Lazy Rebuilding

When per-operation latency is *contractually* bounded — hard real-time (avionics, motor control, audio DSP), or a strict p999 SLO — amortized structures are simply **forbidden**, regardless of how good their average is. You must use worst-case structures, which means systematically converting amortized designs into worst-case ones. The classical theory of this conversion is **de-amortization by rebuilding.**

### Global rebuilding (Overmars)

Overmars's *global rebuilding* (1983) is the general recipe. The idea: when a structure degrades (too many lazy deletions, or it needs to grow), instead of rebuilding it in one O(n) burst, **build the new copy incrementally in the background while the old copy still serves requests**, then switch over. Concretely you maintain:

- a *working* structure answering current queries, and
- a *shadow* structure being rebuilt a few steps at a time on every operation.

You schedule the rebuild so it *finishes before the working structure becomes unusable* — i.e., the per-operation increment of rebuild work is sized so the shadow is ready in time. Updates that arrive mid-rebuild are buffered and replayed onto the shadow. The payoff: every operation does O(1) (or O(log n)) *worst-case* work, with no global rebuild ever visible to a single operation. The incremental array growth and Redis two-table rehash above are both instances of this pattern.

### Lazy rebuilding (Okasaki)

Okasaki generalized and simplified Overmars's idea into **lazy rebuilding**, where lazy evaluation itself does the scheduling. Rather than manually copying `k` elements per operation, you express the expensive rebuild as a *lazy suspension* and force a bounded number of steps per operation. The structure's invariant guarantees the suspension is fully forced before its result is needed. This is the same machinery that makes Okasaki's *real-time queues* (Hood–Melville) and *real-time deques* worst-case O(1): the queue-reversal is a lazy stream advanced incrementally, so no `dequeue` ever pays the full reversal. Lazy rebuilding is the bridge between the persistence story (below) and the real-time story — the suspension that de-amortizes is the same suspension that survives persistence.

**The cost you pay** to de-amortize: extra memory (you hold two copies during a transition), higher constant factors, and more code. You pay it *only* for the cases where the tail is the product.

---

## Amortization Under Persistence in Production

Covered in depth at [`./senior.md`](./senior.md); the production-facing summary:

Persistent / immutable data structures are now mainstream — Clojure's vectors and maps (HAMT + structural sharing), Scala's immutable collections, Immutable.js, Rust's `im` crate, and the copy-on-write trees inside databases (LMDB, CouchDB, Datomic). Their amortized bounds rely on **lazy evaluation with memoization**: the expensive operation is suspended as a thunk and, once forced, memoized so that any other version sharing that thunk pays O(1) on re-access rather than re-running the O(n) work. Without memoization, a persistent structure lets an adversary re-run the expensive operation once per saved reference, collapsing the amortized bound (a real algorithmic-complexity attack surface). Okasaki's **banker's method with debits** is the accounting that makes this rigorous: debits are deferred costs attached to suspensions, discharged a bounded number per operation, and a suspension may not be forced until its debits are paid. In production terms: if you adopt an immutable structure, verify it uses lazy + memoized rebuilding (or is worst-case by construction); a *strict* immutable structure may silently lose its amortized bound under sharing.

---

## Production Reference

An incrementally-resizing hash map in Go, modeled on the Redis two-table approach: it bounds the per-operation work so that **no single `Put` ever pays the full O(n) rehash**. The trade is the same as every de-amortization — extra memory during a migration and higher constant factors — in exchange for a true worst-case-per-operation guarantee.

```go
// Package incmap implements a separate-chaining hash map whose growth is
// de-amortized: a resize never copies the whole table inside one Put.
// Instead each mutating operation migrates a bounded number of buckets
// from the old table to the new one. Worst-case work per Put is O(1)
// (amortized over a constant migration budget), not O(n).
package incmap

const (
	loadFactor    = 6   // grow when avg chain length exceeds this
	migrateBudget = 2   // buckets evacuated per mutating op (bounds per-op work)
)

type entry struct {
	key  string
	val  int
	next *entry
}

type Map struct {
	cur     []*entry // primary table
	old     []*entry // non-nil only while a migration is in progress
	rehashIdx int    // next old-bucket index to evacuate; -1 when not migrating
	count   int
}

func New() *Map {
	return &Map{cur: make([]*entry, 8), rehashIdx: -1}
}

func hash(k string) uint64 {
	// FNV-1a; in production use maphash with a per-map seed to resist
	// collision-based DoS (an adversarial amortization attack).
	var h uint64 = 1469598103934665603
	for i := 0; i < len(k); i++ {
		h ^= uint64(k[i])
		h *= 1099511628211
	}
	return h
}

func (m *Map) migrating() bool { return m.rehashIdx >= 0 }

// migrateStep evacuates up to migrateBudget old buckets into cur.
// This is the de-amortization: bounded, constant work per call.
func (m *Map) migrateStep() {
	if !m.migrating() {
		return
	}
	for n := 0; n < migrateBudget && m.rehashIdx < len(m.old); n++ {
		for e := m.old[m.rehashIdx]; e != nil; {
			next := e.next
			i := hash(e.key) & uint64(len(m.cur)-1)
			e.next = m.cur[i]
			m.cur[i] = e
			e = next
		}
		m.old[m.rehashIdx] = nil
		m.rehashIdx++
	}
	if m.rehashIdx >= len(m.old) { // migration complete
		m.old = nil
		m.rehashIdx = -1
	}
}

// startGrow allocates a doubled table and begins (but does not finish)
// the migration. The O(n) copy is deferred to future migrateStep calls.
func (m *Map) startGrow() {
	m.old = m.cur
	m.cur = make([]*entry, len(m.old)*2)
	m.rehashIdx = 0
}

func (m *Map) Put(key string, val int) {
	m.migrateStep() // pay down a bounded slice of any pending migration

	h := hash(key)
	if m.migrating() { // update in place if the key still lives in old
		oi := h & uint64(len(m.old)-1)
		for e := m.old[oi]; e != nil; e = e.next {
			if e.key == key {
				e.val = val
				return
			}
		}
	}
	ci := h & uint64(len(m.cur)-1)
	for e := m.cur[ci]; e != nil; e = e.next {
		if e.key == key {
			e.val = val
			return
		}
	}
	m.cur[ci] = &entry{key: key, val: val, next: m.cur[ci]}
	m.count++

	// Trigger growth only when not already migrating, so at most one
	// old table exists at a time and per-op work stays bounded.
	if !m.migrating() && m.count > loadFactor*len(m.cur) {
		m.startGrow()
	}
}

func (m *Map) Get(key string) (int, bool) {
	h := hash(key)
	if m.migrating() { // a not-yet-evacuated key still lives in old
		oi := h & uint64(len(m.old)-1)
		for e := m.old[oi]; e != nil; e = e.next {
			if e.key == key {
				return e.val, true
			}
		}
	}
	ci := h & uint64(len(m.cur)-1)
	for e := m.cur[ci]; e != nil; e = e.next {
		if e.key == key {
			return e.val, true
		}
	}
	return 0, false
}
```

### Worst-case-per-op analysis

- **`Put` work** = `migrateStep` (≤ `migrateBudget` buckets, each a bounded chain under the load-factor invariant) + two chain scans + one insert. With chains kept O(1) by the load factor and `migrateBudget` constant, **each `Put` is O(1) worst-case**, not merely amortized. The O(n) total rehash still happens — but smeared across the ≥ `len(old)/migrateBudget` operations that follow a growth.
- **Invariant that makes it safe:** growth is started only when `!migrating()`, so at most one `old` table exists at a time. This guarantees a migration *completes* before the next one *starts*, which requires `migrateBudget` large enough that the old table drains before `cur` itself needs to grow. With geometric doubling and a constant budget, this holds because the new table has twice the buckets and thus tolerates many inserts before its own threshold.
- **Reads during migration cost ≤ 2 lookups** (old then cur), still O(1).
- **Memory:** up to ~1.5× the table arrays live simultaneously during a migration — the de-amortization tax.
- **Not shown, but required for production:** thread-safety (this is single-threaded; a concurrent version needs the striping/cooperative-transfer machinery above) and a `maphash`-style seeded hash so an adversary cannot force every key into one chain and resurrect an O(n) operation that way.

---

## Observing Resize Latency

You cannot manage what you do not measure, and **the resize spike is invisible to a mean.** A map averaging 50 ns/op with a 5 ms resize spike every million ops has an unchanged mean and a destroyed p99.99. Observability for amortized structures must be latency-distribution-aware:

- **Record per-operation latency into a histogram, never an average.** Use a log-linear bucketed histogram (HdrHistogram, Prometheus native histograms, or DataDog/OpenTelemetry distributions). These preserve the tail at bounded memory, so you can read p50, p99, p999, and p9999 directly. A plain mean (or even mean ± stddev) will hide the spike by construction.
- **Watch p99/p999/max, not p50.** The resize lives in the top fraction of a percent. If you only chart median and mean you will conclude the structure is "fast" right up until a tail-sensitive caller pages you.
- **In Go, benchmark with the distribution exposed.** `go test -bench` reports an average ns/op, which *hides exactly the spike you care about*. Instead, time each operation and feed it to a histogram:

```go
func BenchmarkPutLatency(b *testing.B) {
	m := New()
	h := hdrhistogram.New(1, 1_000_000_000, 3) // 1ns..1s, 3 sig figs
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		t0 := time.Now()
		m.Put(strconv.Itoa(i), i)
		h.RecordValue(time.Since(t0).Nanoseconds())
	}
	b.StopTimer()
	b.ReportMetric(float64(h.ValueAtQuantile(99)), "p99-ns")
	b.ReportMetric(float64(h.ValueAtQuantile(99.9)), "p999-ns")
	b.ReportMetric(float64(h.ValueAtQuantile(100)), "max-ns")
}
```

Run this against a naive doubling map and against the incremental map above: the means will be similar, but the naive map's `max-ns` and `p999-ns` will show the resize cliff (rising with `b.N`), while the incremental map's tail stays flat. **That flat tail is the entire reason de-amortization exists, and the histogram is the only instrument that shows it.** In production, emit these percentiles continuously and alert on the tail, never the average.

---

## Decision Framework

| Situation | Reason about… | Build… |
|---|---|---|
| Batch / offline / build tool, throughput-bound | Amortized total cost | Simplest doubling structure; the spike is invisible and irrelevant |
| Latency SLO at p50 only, generous tail | Amortized, watch p99 | Doubling is usually fine; pre-size to dodge the worst spike |
| Strict p99/p999 SLO, fan-out architecture | **Worst-case per op** | Incremental / de-amortized resize (Redis two-table style) |
| Hard real-time (avionics, audio, control) | **Worst-case per op** | Global/lazy rebuilding; amortized structures forbidden outright |
| Concurrent, write-contended, latency-sensitive | Worst-case under a held lock | Cooperative incremental resize or lock-free split-ordered lists |
| Read-mostly concurrent | Reader cost; reclamation | RCU / striping; resize cost hidden from readers |
| Persistent / immutable, possibly adversarial | Amortized **under sharing** | Verify lazy + memoized (Okasaki debits); else de-amortize |
| Adversary can choose the operation sequence | Amortized average is unreachable | Seeded hashing + worst-case structure |

The meta-rule: **classify the workload before trusting the bound.** "O(1) amortized" is a contract about a sequence executed once, sequentially, by a non-adversarial caller who cares about totals. Production routinely violates every clause. When it does, de-amortize — and pay the constant-factor and memory tax knowingly, only where the tail is the product.

---

## Research Pointers

- **Overmars, M. H. (1983). *The Design of Dynamic Data Structures.*** LNCS 156. The global-rebuilding technique for converting amortized structures to worst-case — the theoretical root of incremental resize.
- **Okasaki, C. (1998). *Purely Functional Data Structures.*** Cambridge Univ. Press. Lazy rebuilding, real-time queues/deques, the banker's-method-with-debits that makes amortization survive persistence (Ch. 5–8).
- **Shalev, O., & Shavit, N. (2006). "Split-Ordered Lists: Lock-Free Extensible Hash Tables."** *JACM* 53(3). Resize without ever moving an element — the spike designed out, not spread out.
- **Tarjan, R. E. (1985). "Amortized Computational Complexity."** *SIAM J. Algebraic Discrete Methods* 6(2). The paper that named the field; the banker's and potential framings used throughout.
- **Herlihy, M., & Shavit, N. (2008). *The Art of Multiprocessor Programming.*** Concurrent hash tables, striped and lock-free resizing, the concurrency failure modes of amortized bounds.
- **Dijkstra et al. / Wilson, P. (1992). "Uniprocessor Garbage Collection Techniques."** Incremental and concurrent GC, the tricolor invariant, and write barriers as the credit mechanism of de-amortized collection.
- **Redis source — `src/dict.c`** (`dictRehash`, `dictRehashStep`, `_dictRehashStep`). The canonical, readable production de-amortization of a hash table.

---

## Key Takeaways

1. **Amortized O(1) is a throughput claim, not a latency one.** It bounds the sum over a sequence and says nothing about any single operation — which may be O(n). The p99 SLO measures exactly the operation the average hides.
2. **Resize and rehash spikes are real and recurring**, and they compound in fan-out architectures where the slowest backend sets request latency. The spike is invisible to a mean.
3. **Mature runtimes de-amortize their hash maps** (Go incremental evacuation, Redis two-table incremental rehash) to bound per-op work; Java `HashMap` does not and tells you to pre-size instead.
4. **GC is amortization at scale.** STW collectors fully amortize (great average, terrible pause); incremental/concurrent collectors de-amortize the pause, with **write barriers as the per-mutation credit** that funds incremental marking.
5. **Concurrency makes amortized bounds fragile:** the O(n) cost concentrates on one thread, often behind a held lock, and propagates to all waiters. Countermeasures — striped/cooperative resize, RCU, lock-free split-ordered lists — eliminate the spike at a cost in complexity.
6. **For hard real-time or strict tail SLOs, amortized is forbidden.** Use global rebuilding (Overmars) or lazy rebuilding (Okasaki) to convert to true worst-case per op, paying in memory and constants.
7. **Under persistence, verify the bound survives sharing** (lazy + memoized, Okasaki debits); a strict immutable structure can silently lose it.
8. **Measure the tail, never the mean.** Histograms (HdrHistogram / native Prometheus) and p99/p999/max are the only instruments that reveal whether your de-amortization actually worked.

---

> **See also:** [`./senior.md`](./senior.md) for the three methods, splay/Fibonacci/union-find, and persistence in depth · [`../01-time-vs-space-complexity/professional.md`](../01-time-vs-space-complexity/professional.md) for formal models and time-space trade-offs · [`./middle.md`](./middle.md) for the aggregate/accounting/potential mechanics.
