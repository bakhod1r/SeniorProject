# Concurrent Hash Map — Interview Preparation

> Tiered Q&A (Junior → Middle → Senior → Professional), 50 questions with model-answer focus, plus a rapid-fire round, red-flag guide, and two full coding challenges — a **sharded / striped concurrent map** and a lock-free counter variant — in Go, Java, and Python.
>
> Cross-links: [hash tables](../../05-basic-data-structures/05-hash-tables/), [CAS](../15-cas/), [RCU](../19-rcu/).
>
> **How to use this page:** answer out loud, then check against the model focus. For the coding challenge, implement all three languages and run the Go version with `-race`. The interviewer cares most about whether your *compound* operations are atomic and whether you can articulate the read:write-ratio trade-off.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Rapid-Fire Round](#rapid-fire-round)
6. [Coding Challenge — Sharded Concurrent Map](#coding-challenge)

---

## Junior Questions

> Focus: definitions, why plain maps break, the coarse-lock fix, and the built-in concurrent map per language. If you can explain Q2 and Q8 clearly, you're past the junior bar.

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is a concurrent hash map? | A hash map safe for simultaneous use by many threads/goroutines; same average O(1) ops, but operations don't corrupt each other. |
| 2 | Why is a plain hash map unsafe under concurrency? | Each op is many steps (hash, walk chain, write, bump size, maybe resize). Interleaving corrupts chains, loses updates, or crashes (Go: `fatal error: concurrent map writes`). |
| 3 | What's the simplest way to make a map thread-safe? | Wrap it in one mutex; every op locks/unlocks. Correct but serial. |
| 4 | What is a race condition vs a data race? | Race condition: result depends on timing. Data race: two threads access same memory, ≥1 writes, no synchronization — undefined behavior. |
| 5 | What does an `RWMutex` give you over a `Mutex`? | Many concurrent readers OR one exclusive writer. Great for read-mostly maps. |
| 6 | Why is `m[k]++` dangerous across threads? | It's read-modify-write (3 steps). Two threads can both read the old value → one increment lost. |
| 7 | How do you safely increment a counter in a map? | Hold one lock across the whole `++`, or use an atomic method (`merge` in Java). |
| 8 | What's wrong with `if !m.has(k) { m.put(k,v) }` concurrently? | Check-then-act race: another thread inserts `k` in the gap. Use `putIfAbsent`/`LoadOrStore`. |
| 9 | Name the concurrent map in Go, Java, Python. | Go: `sync.Map` (or `map`+mutex / sharded). Java: `ConcurrentHashMap`. Python: `dict` (single ops atomic under GIL) + `Lock` for compound. |
| 10 | Does making a map concurrent change its Big-O? | No — still average O(1) per op. It changes *throughput* under many threads, not asymptotic complexity. |
| 11 | Can `ConcurrentHashMap` store `null` keys/values? | No. `null` can't distinguish "absent" from "present-but-null" in a lock-free read. |
| 12 | What does Go's `-race` flag do? | Runs the race detector; flags data races (including concurrent map access) at runtime during tests. |

**Deeper sample answers**

**Q2 — Why unsafe?** "A `put` computes a bucket, walks/edits a chain, increments size, and may trigger a resize that reallocates the whole table. None of that is atomic. If two goroutines run it interleaved, one can overwrite the other's `next` pointer (dropping entries or creating a cycle that makes reads spin forever), or both read size=10 and write 11 (a lost update). Go's runtime actively detects concurrent map writes and crashes the program to stop the corruption."

**Q1 — What is it?** "A hash map that's safe for simultaneous use by many threads or goroutines. It keeps the same average O(1) get/put/delete, but its operations are designed so that concurrent calls don't corrupt the buckets, the size counter, or an in-progress resize. Every major language ships one: Go's `sync.Map` (or a sharded map), Java's `ConcurrentHashMap`, and in Python a `dict` whose single operations are atomic under the GIL but whose compound operations need a `Lock`."

**Q8 — check-then-act:** "`has` and `put` are each individually safe, but the window between them is not. Thread A checks (absent), thread B inserts `k`, thread A inserts `k` — overwriting B. The fix is a single atomic operation that does the check and the insert under one lock: `LoadOrStore` (Go), `putIfAbsent` (Java)."

**Q6 — `m[k]++`:** "It expands to: read the current value, add one, write it back. Two threads can both read the same old value before either writes, so one increment is lost. Worse, in Go it's also a data race on the map's internals, which the runtime may turn into a crash. The fix is to make the whole read-add-write happen under one lock, or use a built-in atomic like Java's `merge(k, 1, Integer::sum)`."

**Q10 — Big-O unchanged:** "Each operation is still average O(1) — the hash, bucket lookup, and chain step don't get asymptotically slower because of threads. What concurrency affects is *throughput*: ops per second across all threads. A single global lock keeps O(1) per op but serializes everything, so adding cores buys nothing. Finer-grained designs keep O(1) per op *and* let throughput scale with cores."

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 13 | Why doesn't a single global lock scale? | Amdahl's Law: one serial gate ⇒ throughput flat regardless of cores; threads queue, cache line bounces. |
| 14 | What is lock striping? | N locks; key `k` uses `locks[hash(k)%N]`. Disjoint keys proceed in parallel. |
| 15 | How did Java 7 `ConcurrentHashMap` work? | Array of `Segment`s (default 16), each a small table with its own `ReentrantLock`; `get` lock-free via volatile reads. |
| 16 | How does Java 8 `ConcurrentHashMap` differ? | No segments. Per-bucket granularity: CAS to install into an empty bucket (lock-free), `synchronized` on the first node otherwise; tree-bins for long chains. |
| 17 | What are tree-bins and why? | When a bucket chain exceeds 8 (and table ≥64), convert it to a red-black tree → O(log n) worst case instead of O(n); defends against hash-flooding DoS. |
| 18 | What is sharding and how does it relate to striping? | Same idea, different layer: sharding splits the *maps* (each its own lock+table); striping shares one table but splits the *locks*. |
| 19 | Why is `get()` lock-free in CHM? | Node `val`/`next` are `volatile`; a reader does acquire loads and sees a consistent value with no lock. |
| 20 | What is "the size problem"? | One shared size counter is touched by every writer → the most-contended cache line. Solved by striping the counter (LongAdder). |
| 21 | What does `LongAdder` do? | Spreads increments across per-thread `CounterCell`s (padded to avoid false sharing); `sum()` adds them — fast writes, approximate read. |
| 22 | `ConcurrentHashMap` vs `Collections.synchronizedMap`? | CHM: per-bucket locks, parallel reads/writes, weak iterator, atomic compound ops, no nulls. synchronizedMap: one lock, serialized, allows nulls, manual locking to iterate. |
| 23 | When is `sync.Map` the right Go choice? | Read-mostly / write-once-then-read keys (e.g. caches of stable entries). For balanced read/write, a sharded `map`+`RWMutex` is usually faster. |
| 24 | How do you pick the shard count? | Power of two ≥ peak concurrent writers (16–256); power-of-two enables `hash & (N-1)`. Too many slows `size()`. |
| 25 | Why is `size()` only approximate on a concurrent map? | It reads striped cells / shards without a global barrier; mutations linearize between sub-reads, so the sum matches no single instant. |

**Deeper sample answers**

**Q16 — Java 8 design:** "Java 8 dropped segments. The table is one flat array. On `put`: if the bucket is empty, a single CAS installs the node — completely lock-free, retried on failure. If occupied, `synchronized` on the bucket's first node, then walk the chain or tree. So contention is per-bucket (thousands of locks) instead of per-segment (16). `get` stays lock-free via volatile reads. Long chains treeify to red-black trees for O(log n) worst case."

**Q20 — size problem:** "You can partition buckets perfectly and still funnel every insert through one `size++`, making it the single hottest cache line — worse than any bucket. The fix is a striped counter: each thread CASes its own padded cell; `size()` sums them. The trade-off is that the count is now approximate/weakly-consistent, which is fine."

**Q13 — why one lock fails:** "Amdahl's Law: if every operation must pass through one serial gate, the serial fraction is essentially 100%, so adding cores gives no speedup. Concretely, threads queue on the lock, the OS parks them (microsecond context switches that dwarf the O(1) map work), and the lock word plus the size field bounce between core caches. Throughput flattens at about one effective thread. Partition the lock — striping, sharding, or per-bucket CAS — and disjoint keys stop contending."

**Q22 — CHM vs synchronizedMap:** "`synchronizedMap` wraps a `HashMap` so every method takes one shared lock — all reads and writes serialize, and you must manually hold that lock for the entire duration of any iteration or you get a `ConcurrentModificationException`. `ConcurrentHashMap` locks per bucket, so reads are lock-free and writes to different buckets run in parallel; its iterator is weakly consistent (never throws); it offers atomic compound ops like `merge` and `computeIfAbsent`; and it forbids null keys/values. Use CHM unless you specifically need nulls and have negligible contention."

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 26 | How do you choose a map design for a 99%-read route table? | RCU or COW: wait-free, store-free reads; writers pay copy/grace period. Reads dominate, so optimize them to ~zero cost. |
| 27 | What is a split-ordered list? | Shalev–Shavit lock-free map: one sorted lock-free list (bit-reversed-hash order) + bucket pointers; resize only adds bucket pointers, moves no data. |
| 28 | Why bit-reversed hash ordering? | Doubling the table splits each bucket; bit-reversal guarantees the split point already exists in the list, so a new bucket pointer inserts in O(1) without moving nodes. |
| 29 | Explain RCU in one paragraph. | Readers run store-free, lock-free critical sections; writers copy a node, publish via atomic pointer swap, and defer freeing the old version until a grace period (all readers gone). |
| 30 | Why are RCU reads so cheap? | They perform no shared writes → no cache-coherence traffic → scale linearly with cores. Cost moves to writers (grace period) and memory (stale versions). |
| 31 | How does concurrent resize avoid stop-the-world? | Cooperative incremental transfer: doubling table, threads help move stride-sized chunks; transferred buckets get a `ForwardingNode` redirecting to the new table. Redis: dual-table incremental rehash. |
| 32 | What is a `ForwardingNode`? | A marker placed at a transferred bucket's head pointing at the new table; readers/writers hitting it are redirected — so no key is lost mid-resize. |
| 33 | What is false sharing and how does it hurt a concurrent map? | Two unrelated hot fields on one 64-byte cache line bounce between cores. Striped locks/counters must be padded (`@Contended`) or striping is useless. |
| 34 | How does NUMA affect a concurrent map? | Remote-socket memory is slower; buckets allocated on one socket but hit from another cause cross-socket coherence. Mitigate with per-NUMA-node sharding + local allocation. |
| 35 | When is copy-on-write a good map design? | Read-mostly, rare writes, small/medium size: wait-free reads, O(n) writes (O(log n) with HAMT/persistent structures). Config/feature-flag/route maps. |
| 36 | How do you prevent a thundering herd on a cache miss? | Atomic load-through (`computeIfAbsent`) or single-flight so only one thread loads a missing key; others wait for its result. |
| 37 | How does a lock-free map free deleted nodes safely? | Safe memory reclamation: hazard pointers or epoch-based reclamation (RCU). On JVM/Go the GC handles it (frees only when unreachable). |

**Deeper sample answers**

**Q31 — concurrent resize:** "A stop-the-world rehash pauses for O(n) — fatal for tail latency. Production maps move incrementally: Java 8 CHM doubles the table and transfers buckets in stride-sized chunks, conscripting any thread that touches the map during resize to help move a chunk first. Each moved bucket's old slot becomes a `ForwardingNode` pointing to the new table, so concurrent reads/writes are redirected and never miss a transferred key. Redis keeps two hash tables and migrates a few buckets per command, checking both during the migration."

**Q27/28 — split-ordered list:** "Shalev and Shavit's lock-free hash map keeps *all* keys in a single lock-free sorted linked list, ordered by the *bit-reversed* hash. The bucket array is just an array of shortcut pointers into that list. Resizing doesn't move any data — it only adds more bucket pointers that subdivide existing buckets. Bit-reversal is the trick: when the table doubles, each bucket splits in two, and bit-reversed ordering guarantees the split point already exists as a position in the list, so the new bucket pointer inserts in O(1). The catch is safe memory reclamation — hazard pointers or epochs — since there's no GC in the original C setting."

**Q33 — false sharing:** "Two unrelated hot fields that happen to share a 64-byte cache line cause that line to ping-pong between cores even though the threads touch different fields. For a concurrent map this kills striping: if all your stripe locks or counter cells sit in one array packed together, they share lines and striping gains nothing. The fix is padding each hot field to its own cache line — Java's `@Contended`, or manual padding fields in Go. `LongAdder`'s cells are `@Contended` for exactly this reason."

---

## Professional Questions

> Focus: prove, don't assert. Linearization points, happens-before, invariants, progress classes, and impossibility results. Expect to defend a design against a skeptical reviewer.

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 38 | Define linearizability. | Each op appears atomic at one point between call and return; ordering by those points yields a legal sequential history consistent with real-time order. Compositional. |
| 39 | Where is the linearization point of a lock-free `remove`? | At the **logical mark** CAS (setting the deleted bit on `next`), not the physical unlink (which may be deferred or done by a helper). |
| 40 | Prove the split-ordered list is lock-free. | Every failed CAS on a `next` word implies another thread's CAS on that word succeeded → some thread always makes progress → lock-free (not wait-free; a thread may retry unboundedly). |
| 41 | State the invariants that make cooperative resize correct. | Single-mover (claiming CAS), redirect (ForwardingNode forwards all ops), key-conservation (each key findable in exactly one of old/new table at all times). |
| 42 | Why does an exact linearizable `size()` cost as much as serializing mutations? | An exact count needs a consistent cut across all shards/cells; without a global barrier, inserts linearize between sub-reads so the sum matches no instant → must serialize. |
| 43 | Quantify RCU read-side cost vs an RWMutex reader. | RWMutex reader writes a shared reader-count → one bouncing cache line caps throughput at ~1/t_coh. RCU reader does no shared store → scales ~C/t_trav. Speedup ≈ C·(t_coh/t_trav). |
| 44 | What memory-model guarantee makes published nodes safe to read? | Release/acquire: writer fully builds the node then store-releases the pointer; a reader that acquire-loads the pointer sees all prior writes — never a half-built node (CHM uses `volatile`). |
| 45 | Why do JVM/Go lock-free maps not need hazard pointers? | The GC is a safe reclaimer: it frees a node only when unreachable, exactly the use-after-free safety condition. C/C++/Rust must use hazard pointers or epochs. |

**Deeper sample answers**

**Q40 — lock-freedom proof:** "Lock-freedom requires that in any infinite execution, infinitely many operations complete. In the split-ordered list, an operation either succeeds its CAS (and finishes) or fails. A CAS on `pred.next` fails only because another thread's CAS on the same word succeeded since this thread last read it. So every failed CAS is paired with a successful one by another thread — a completed unit of progress. The system therefore cannot have all threads loop forever with none completing; some thread always advances. That's lock-free. It's not wait-free because one unlucky thread might lose every race and retry without bound."

**Q42 — exact size:** "An exact, linearizable size must equal (#insert − #delete) linearization points before some instant τ. If `size()` reads shard/cell counts without blocking mutators, two inserts can linearize between the reads of two shards, so the returned sum corresponds to no single τ — that violates linearizability. To be exact you must take a consistent cut, i.e. a barrier over every shard, which is global serialization. Hence production maps deliberately return an approximate striped sum."

**Q43 — RCU read cost:** "An RWMutex reader increments a shared reader-count — a single atomic write to one cache line that every reader touches, so that line bounces between cores and caps read throughput at roughly one-over-coherence-latency. An RCU reader does *no* shared write at all; on a non-preemptible kernel build `rcu_read_lock` compiles to nothing. With no shared store there's no coherence invalidation from reads, so reads scale linearly with cores — roughly cores-over-traversal-time. The speedup over an RWMutex on the read side is about cores times the ratio of coherence latency to traversal time, which is large for small structures with many cores. The cost moves to writers, who pay a grace period, and to memory, which holds stale versions until reclamation."

**Q44 — memory model:** "The writer fully builds the node, then publishes it with a release store (a `volatile` write or a CAS). A reader that observes the published pointer via an acquire load is guaranteed to see every write the writer made before the release — so it never sees a half-constructed node with a garbage `next`. Without this release/acquire pairing, the CPU or compiler may reorder the field writes after the pointer write, and a lock-free reader observes a torn node. This is why CHM marks node fields `volatile`; on weakly ordered hardware like ARM it's a correctness requirement, not an optimization."

**Q45 — no hazard pointers on JVM:** "Safe memory reclamation means never freeing a node while a reader still holds a pointer to it. In C/C++/Rust a lock-free map must track that explicitly with hazard pointers (each thread publishes the pointers it's about to dereference; a node is freed only if no hazard slot references it) or epoch-based reclamation. On the JVM and in Go, the garbage collector already guarantees a node is collected only when unreachable — which is exactly the SMR safety condition — so those maps need no hazard pointers. The cost moves into GC pressure instead."

**Q41 — resize invariants:** "Three. *Single-mover*: a claiming CAS on the bucket's state means at most one thread transfers a given bucket, so no torn or double transfer. *Redirect*: once a bucket's old slot holds a `ForwardingNode`, every op on a key hashing there follows the forward into the new table. *Key-conservation*: at every instant each key is findable in exactly one place — in the old table if its bucket is unmoved, in the new table (via the forward) if moved. Together these guarantee no read misses a present key and no write lands in an abandoned bucket."

---

## Mixed Scenario Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 46 | A teammate writes `if (map.get(k) == null) map.put(k, load(k));` in a hot cache. What breaks and how do you fix it? | Check-then-act race + thundering herd: many threads see null and all call `load`. Fix: `computeIfAbsent(k, this::load)` (atomic, loads once). |
| 47 | Your sharded counter map is correct but slow at 32 threads. First thing you check? | False sharing: are shard structs/counter cells padded to 64 B? Then shard skew (hot key), then `Total()` being called in a loop. |
| 48 | Why might switching from x86 to ARM servers surface a new concurrency bug in a hand-rolled lock-free map? | ARM's weaker memory ordering exposes missing release/acquire barriers that x86 TSO accidentally masked → torn node reads. |
| 49 | Reads are 99.99% of traffic and the route table changes a few times an hour. Design? | Copy-on-write / immutable snapshot behind an atomic reference: wait-free reads, O(n) writes are fine at that rate. |
| 50 | When would you *not* use `ConcurrentHashMap` on the JVM? | Need null keys/values (use `synchronizedMap`); need a strictly consistent snapshot/iteration; or single-threaded code (plain `HashMap` is faster). |

**Deeper sample answers**

**Q46 — the cache anti-pattern:** "Two bugs in one line. First, check-then-act: between `get` returning null and `put`, another thread can insert `k`, and this thread overwrites it. Second, the thundering herd: under a cold cache, dozens of threads all see null for the same hot key and all run the expensive `load`, hammering the backend. `computeIfAbsent(k, this::load)` fixes both — it's atomic per key and runs the loader at most once. Caveat: the loader holds the bin lock, so for a *slow* loader prefer loading outside and `putIfAbsent`, or a cache library like Caffeine that coalesces loads without holding bin locks."

**Q48 — ARM vs x86:** "x86 has Total Store Order — it won't reorder a store ahead of an earlier store, which accidentally preserves the 'build node, then publish pointer' ordering even if you forgot the barrier. ARM and POWER are weakly ordered: the publish store can become visible before the node's field writes, so a lock-free reader on ARM can observe the pointer but stale/garbage fields. The bug was always present; x86 just hid it. The fix is explicit release/acquire (or `volatile` in Java, `sync/atomic` in Go), which the built-in concurrent maps already use."

---

## Rapid-Fire Round

- **Q:** Most-contended cache line in a naive concurrent map? **A:** The single `size` counter.
- **Q:** CHM treeify threshold? **A:** Chain > 8 and table ≥ 64.
- **Q:** Go's read-optimized built-in concurrent map? **A:** `sync.Map`.
- **Q:** Atomic get-or-insert in Go? **A:** `LoadOrStore`.
- **Q:** Atomic load-through in Java? **A:** `computeIfAbsent`.
- **Q:** Does the GIL make `d[k] += 1` atomic? **A:** No (read-modify-write).
- **Q:** Reclamation scheme used by the Linux kernel hash table? **A:** RCU.
- **Q:** One-word reason RWMutex reads don't scale infinitely? **A:** Shared reader-count cache line.
- **Q:** Strongest read progress guarantee, achievable by COW/RCU? **A:** Wait-free.
- **Q:** What redirects ops during CHM resize? **A:** `ForwardingNode`.
- **Q:** ABA problem in one line? **A:** CAS sees value equality, not identity — a freed+reused address fools it.
- **Q:** Why no hazard pointers needed on the JVM? **A:** GC frees only unreachable nodes, satisfying the safety condition.
- **Q:** Linearization point of a lock-free insert? **A:** The successful CAS that installs the node.
- **Q:** Fail-fast vs weakly consistent iterator? **A:** Fail-fast throws CME; weakly consistent never throws and sees a moving target.
- **Q:** Power-of-two shard count lets you replace `%` with what? **A:** `hash & (N-1)`.
- **Q:** One reason RWMutex reads still don't scale perfectly? **A:** Reader-count is a shared write → bouncing cache line.
- **Q:** CAS's consensus number, and why it matters? **A:** ∞ — it can coordinate any number of threads, which atomic registers (consensus number 1) cannot, so lock-free contested inserts require it.
- **Q:** What does `@Contended` (Java) do? **A:** Pads a field to its own cache line to prevent false sharing.
- **Q:** Why does Go's `sync.Map` excel at stable keys? **A:** Stable keys live in its lock-free `read` map; churny writes force locking the `dirty` map and promotions.
- **Q:** Treeify untreeify thresholds? **A:** Treeify at chain > 8 (table ≥ 64); untreeify at ≤ 6.

---

## Red Flags Interviewers Watch For

These are the answers that quietly fail a concurrency interview:

| Red flag | What it signals | What to say instead |
|----------|-----------------|---------------------|
| "I'll just use a `HashMap`, it's fine" | Doesn't grasp data races | "A plain map corrupts/crashes under concurrent writes; I need CHM / a lock." |
| "Add a lock around each line" | Confuses statement-atomicity with operation-atomicity | "Hold one lock across the whole read-modify-write." |
| "`size()` gives the exact count" | Misses the count problem | "It's an approximate striped sum; exact needs a global barrier." |
| "Python doesn't need locks, there's a GIL" | Half-true → bugs | "Single ops are atomic; `+=` and check-then-set still need a lock." |
| "Lock-free is always faster" | Cargo-culting | "Lock-free helps under contention; under low contention a mutex can win." |
| "Just read without a lock for speed" | Memory-model blind spot | "Reads need volatile/atomic publication or they can tear on ARM." |
| "More shards is always better" | Ignores memory + size cost | "Shards ≈ peak writers; too many wastes memory and slows `size()`." |

The meta-signal interviewers want: you reason about **operation-level atomicity, the read:write ratio, and the cost model**, not just "is there a lock somewhere."

---

## Complexity Quick Reference

| Operation | Avg | Worst (chain) | Worst (tree-bin) | Sync cost |
|-----------|-----|---------------|------------------|-----------|
| `get` | O(1) | O(n) | O(log n) | lock-free |
| `put` (empty bucket) | O(1) | O(1) | O(1) | 1 CAS |
| `put` (populated) | O(1) | O(n) | O(log n) | sync(head) |
| `remove` | O(1) | O(n) | O(log n) | sync(head) |
| resize (total) | O(n) | O(n) | O(n) | cooperative |
| `size()` | O(#cells) | O(#cells) | O(#cells) | striped, approx |

Memorize this table — the "sync cost" column is what distinguishes a candidate who understands concurrent maps from one who only knows plain hash-map Big-O.

> **One-liner to anchor the whole topic:** "Concurrency doesn't change a hash map's Big-O; it changes its *throughput*, and the entire design space is about partitioning the lock (striping, sharding, per-bucket CAS) so disjoint keys never contend — while making reads pay as close to nothing as possible (lock-free, RCU, or COW) for read-mostly workloads."

---

## Coding Challenge — Sharded Concurrent Map

> **Problem.** Implement a **thread-safe sharded (lock-striped) concurrent map** `ConcurrentCounter` with these operations, all safe under heavy concurrency:
> - `Inc(key)` — atomically increment the counter for `key`.
> - `Get(key)` — return the current count (0 if absent).
> - `Total()` — return the sum of all counters (a best-effort snapshot is acceptable).
>
> **Requirements.** Use `N = 32` shards, each a `(lock, map)` pair, routing keys by hash. `Inc` must be a correct atomic read-modify-write within its shard. Disjoint-shard operations must run in parallel. Demonstrate with many threads each incrementing and assert the total equals the number of increments.

### Go

```go
package main

import (
	"fmt"
	"hash/fnv"
	"sync"
)

const shards = 32 // power of two

type bucket struct {
	mu sync.Mutex
	m  map[string]int64
}

type ConcurrentCounter struct {
	b [shards]*bucket
}

func New() *ConcurrentCounter {
	c := &ConcurrentCounter{}
	for i := range c.b {
		c.b[i] = &bucket{m: make(map[string]int64)}
	}
	return c
}

func (c *ConcurrentCounter) shard(key string) *bucket {
	h := fnv.New32a()
	h.Write([]byte(key))
	return c.b[h.Sum32()&(shards-1)] // hash & (N-1)
}

func (c *ConcurrentCounter) Inc(key string) {
	b := c.shard(key)
	b.mu.Lock()
	b.m[key]++ // atomic RMW within the shard lock
	b.mu.Unlock()
}

func (c *ConcurrentCounter) Get(key string) int64 {
	b := c.shard(key)
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.m[key]
}

func (c *ConcurrentCounter) Total() int64 {
	var total int64
	for _, b := range c.b { // best-effort snapshot across shards
		b.mu.Lock()
		for _, v := range b.m {
			total += v
		}
		b.mu.Unlock()
	}
	return total
}

func main() {
	c := New()
	const threads, per = 16, 10000
	var wg sync.WaitGroup
	for t := 0; t < threads; t++ {
		wg.Add(1)
		go func(t int) {
			defer wg.Done()
			for i := 0; i < per; i++ {
				c.Inc(fmt.Sprintf("k-%d", i%100)) // 100 distinct keys
			}
		}(t)
	}
	wg.Wait()
	fmt.Println("total =", c.Total()) // 16 * 10000 = 160000
}
```

### Java

```java
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public class ConcurrentCounter {
    private static final int SHARDS = 32; // power of two
    private final Object[] locks = new Object[SHARDS];
    @SuppressWarnings("unchecked")
    private final Map<String, Long>[] maps = new HashMap[SHARDS];

    public ConcurrentCounter() {
        for (int i = 0; i < SHARDS; i++) {
            locks[i] = new Object();
            maps[i] = new HashMap<>();
        }
    }

    private int idx(String key) {
        // spread bits; mask to power-of-two range
        int h = key.hashCode();
        h ^= (h >>> 16);
        return h & (SHARDS - 1);
    }

    public void inc(String key) {
        int i = idx(key);
        synchronized (locks[i]) {                 // per-shard lock
            maps[i].merge(key, 1L, Long::sum);    // atomic RMW within shard
        }
    }

    public long get(String key) {
        int i = idx(key);
        synchronized (locks[i]) {
            return maps[i].getOrDefault(key, 0L);
        }
    }

    public long total() {
        long sum = 0;
        for (int i = 0; i < SHARDS; i++) {
            synchronized (locks[i]) {
                for (long v : maps[i].values()) sum += v;
            }
        }
        return sum; // best-effort snapshot
    }

    public static void main(String[] args) throws InterruptedException {
        ConcurrentCounter c = new ConcurrentCounter();
        int threads = 16, per = 10_000;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        for (int t = 0; t < threads; t++) {
            pool.submit(() -> {
                for (int i = 0; i < per; i++) c.inc("k-" + (i % 100));
            });
        }
        pool.shutdown();
        pool.awaitTermination(1, TimeUnit.MINUTES);
        System.out.println("total = " + c.total()); // 160000
    }
}
```

### Python

```python
import threading

SHARDS = 32  # power of two

class ConcurrentCounter:
    def __init__(self):
        self._locks = [threading.Lock() for _ in range(SHARDS)]
        self._maps = [dict() for _ in range(SHARDS)]

    def _idx(self, key):
        return (hash(key) & 0x7FFFFFFF) & (SHARDS - 1)

    def inc(self, key):
        i = self._idx(key)
        with self._locks[i]:                       # per-shard lock
            self._maps[i][key] = self._maps[i].get(key, 0) + 1  # atomic RMW

    def get(self, key):
        i = self._idx(key)
        with self._locks[i]:
            return self._maps[i].get(key, 0)

    def total(self):
        s = 0
        for lock, m in zip(self._locks, self._maps):  # best-effort snapshot
            with lock:
                s += sum(m.values())
        return s

if __name__ == "__main__":
    c = ConcurrentCounter()
    threads, per = 16, 10_000
    def work():
        for i in range(per):
            c.inc(f"k-{i % 100}")
    ts = [threading.Thread(target=work) for _ in range(threads)]
    for t in ts: t.start()
    for t in ts: t.join()
    print("total =", c.total())  # 160000
```

**Discussion points an interviewer will probe:**
- *Why per-shard locks instead of one lock?* Disjoint keys hit different shards → parallel `Inc`.
- *Is `Total()` linearizable?* No — it's a best-effort snapshot; an exact count would need a global barrier (see professional Q42).
- *How would you make `Get`/`Inc` lock-free?* Replace `map+lock` shards with `ConcurrentHashMap` + `merge`, or atomic CAS per cell.
- *What about false sharing?* Pad shard structs to a cache line so adjacent shard locks don't bounce.
- *How would you grow it?* Per-shard incremental resize at load > 0.75, consulting both tables during migration (tasks 11–12).

### Follow-up: make it lock-free with the built-in concurrent map

Interviewers often ask for a second iteration that removes explicit locks by delegating to the language's concurrent map and its atomic counter primitive.

#### Go (built-in atomics + sync.Map)

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

// Lock-free-ish: each key maps to a *int64 counter we bump with atomic.AddInt64.
type LFCounter struct{ m sync.Map } // key -> *int64

func (c *LFCounter) Inc(key string) {
	v, _ := c.m.LoadOrStore(key, new(int64)) // atomic get-or-insert of the cell
	atomic.AddInt64(v.(*int64), 1)            // lock-free increment
}
func (c *LFCounter) Get(key string) int64 {
	if v, ok := c.m.Load(key); ok {
		return atomic.LoadInt64(v.(*int64))
	}
	return 0
}

func main() {
	c := &LFCounter{}
	var wg sync.WaitGroup
	for t := 0; t < 16; t++ {
		wg.Add(1)
		go func() { defer wg.Done(); for i := 0; i < 10000; i++ { c.Inc("k") } }()
	}
	wg.Wait()
	fmt.Println(c.Get("k")) // 160000
}
```

#### Java (ConcurrentHashMap + LongAdder)

```java
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.LongAdder;

public class LFCounter {
    private final ConcurrentHashMap<String, LongAdder> m = new ConcurrentHashMap<>();
    public void inc(String key) {
        m.computeIfAbsent(key, k -> new LongAdder()).increment(); // striped, lock-free
    }
    public long get(String key) {
        LongAdder a = m.get(key);
        return a == null ? 0 : a.sum();
    }
}
```

#### Python (note: GIL serializes, but the pattern is the same)

```python
import threading
from collections import defaultdict

class LFCounter:
    # Under the GIL, dict ops are atomic but += is not; still need a lock per key
    # OR use a single lock — true lock-freedom isn't available in CPython.
    def __init__(self):
        self._d = defaultdict(int)
        self._lock = threading.Lock()
    def inc(self, key):
        with self._lock:
            self._d[key] += 1
    def get(self, key):
        return self._d.get(key, 0)
```

**Why the second version scales better:** the striped per-key counter (`LongAdder`, atomic `int64`) eliminates the shard lock entirely on the increment path and spreads contention across cells, while `computeIfAbsent`/`LoadOrStore` make the get-or-insert atomic. The Python note is honest: CPython's GIL caps true parallel speedup, so the "lock-free" framing is JVM/Go-specific — in CPython a single lock is the pragmatic answer until free-threaded builds mature.

### How to extend this in a follow-up

If the interviewer keeps going, the natural next asks are:
- **Add `Total()` that's a consistent snapshot** — force the discussion to §42's impossibility (you must serialize, so explain why best-effort is the right call).
- **Bound memory with eviction** — introduce per-shard LRU and discuss keeping the policy off the read path.
- **Make it resize** — per-shard incremental rehash consulting both tables, with a forwarding marker (tasks 11–12).
- **Defend against hash flooding** — seeded hash + treeify long chains.

Each extension maps directly to a section in `middle.md`/`senior.md`/`professional.md`, so you can speak to the trade-offs with confidence rather than improvising.

---

**Next step:** [`tasks.md`](./tasks.md) — graded hands-on tasks (beginner → advanced) in Go, Java, and Python.
