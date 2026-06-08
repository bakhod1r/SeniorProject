# RCU (Read-Copy-Update) — Tasks

> **Audience:** Anyone who has read at least `junior.md` and `middle.md`. Tasks are grouped into three tiers — **Foundational (1–5)**, **Intermediate (6–10)**, and **Advanced (11–15)** — building from a basic pointer-swap registry up to grace-period reasoning, structural sharing, and reclamation-scheme comparison. Reference solutions or detailed hints are given in Go, Java, or Python (whichever is most idiomatic; translations are mechanical).

---

## Foundational Tasks (1–5)

### Task 1 — RCU-style config pointer swap

**Goal.** Implement an `RCUConfig` holding an immutable `Config{MaxConn, Banner}` behind an atomic pointer. Provide `Read()` (lock-free subscribe) and `Update(mutate)` (copy-on-write + publish). Writers serialize on a mutex.

**Acceptance.** A reader that calls `Read()` and stores the snapshot, then a concurrent `Update`, must show the old snapshot unchanged and a fresh `Read()` showing the new value.

**Go reference solution:**
```go
type Config struct {
	MaxConn int
	Banner  string
}
type RCUConfig struct {
	ptr     atomic.Pointer[Config]
	writeMu sync.Mutex
}
func New(c *Config) *RCUConfig { r := &RCUConfig{}; r.ptr.Store(c); return r }
func (r *RCUConfig) Read() *Config { return r.ptr.Load() }            // subscribe
func (r *RCUConfig) Update(mut func(*Config)) {
	r.writeMu.Lock(); defer r.writeMu.Unlock()
	cp := *r.ptr.Load() // COPY
	mut(&cp)            // MODIFY copy
	r.ptr.Store(&cp)    // PUBLISH
}
```

**Test idea.** `s := r.Read(); r.Update(func(c *Config){c.MaxConn=200}); assert s.MaxConn == oldValue && r.Read().MaxConn == 200`.

---

### Task 2 — Verify immutability is required

**Goal.** Demonstrate the bug from violating immutability. Write a *broken* version where `Update` mutates the published config in place (`r.Read().MaxConn = x`) and a *correct* COW version. Run many readers concurrently with writers under the race detector (Go `-race`, Java with a stress loop) and observe the broken version reported as a data race.

**Acceptance.** The broken version triggers a race report (or visibly inconsistent reads); the COW version does not.

**Hint.** The fix is: never write through a pointer returned by `Read()`; always build a fresh `Config` and `Store` it.

---

### Task 3 — RCU-protected read-mostly list (append + snapshot)

**Goal.** Implement a list registry: `Snapshot()` returns the current immutable `[]string`; `Append(s)` copies, appends, and publishes. Confirm a snapshot taken before an append never reflects the append.

**Python reference solution:**
```python
import threading
class RcuList:
    def __init__(self):
        self._items = ()          # immutable tuple
        self._lock = threading.Lock()
    def snapshot(self):           # subscribe
        return self._items
    def append(self, s):          # copy + publish
        with self._lock:
            self._items = self._items + (s,)

lst = RcuList()
lst.append("a")
snap = lst.snapshot()             # ('a',)
lst.append("b")
assert snap == ("a",)             # old view consistent
assert lst.snapshot() == ("a", "b")
```

---

### Task 4 — Show the use-after-free bug in an unmanaged model

**Goal.** In pseudocode (or C-like comments), write the *wrong* reclamation: `store(gPtr,new); free(old)` immediately after publish. Explain, step by step, the interleaving where a pre-existing reader dereferences `old` after the `free` and corrupts memory. Then write the *correct* version with `synchronize_rcu()` between publish and free, and explain why the bug is gone.

**Acceptance.** Your explanation must reference (a) a reader that subscribed before the publish, (b) the missing grace period, and (c) the guarantee `synchronize_rcu` provides (all pre-existing readers have exited).

**Hint.** Use a timeline: Reader loads `old` → Writer publishes `new` → Writer frees `old` → Reader dereferences freed `old`. The grace period forces the writer to wait until the reader's `rcu_read_unlock`.

---

### Task 5 — Reader/writer stress test

**Goal.** Spawn N reader goroutines/threads that loop calling `Read()` and validating an invariant on the snapshot (e.g., `Banner` is always one of the legal published values and never empty/torn), while M writer threads loop publishing new configs. Run for a fixed duration with the race detector on.

**Acceptance.** Zero races; every reader always observes a complete, legal snapshot (never a half-updated mix of two configs).

**Go hint:**
```go
for i := 0; i < N; i++ {
	go func() {
		for time.Now().Before(deadline) {
			c := r.Read()
			if c.Banner == "" { panic("torn read") } // must never fire
		}
	}()
}
```

---

## Intermediate Tasks (6–10)

### Task 6 — RCU linked list: insert and delete

**Goal.** Implement a singly linked list of immutable nodes with RCU semantics: `Insert(after, value)` publishes a fully-linked node; `Delete(value)` unpublishes the node, then (in a GC language) drops the reference so the runtime reclaims it. Readers traverse via atomic `next` loads.

**Acceptance.** A reader mid-traversal that already passed the predecessor of a deleted node still completes its traversal consistently (it may still see the deleted node's `next` chain into the live list). New readers skip the deleted node.

**Hint.** Insert order: set `new.next` first (private), then publish `pred.next = new`. Delete: publish `pred.next = victim.next`, then drop the reference (GC = grace period).

---

### Task 7 — Lock-free writers via CAS

**Goal.** Replace the writer mutex with a CAS retry loop: `for { old = load(ptr); new = copy+modify(old); if CAS(ptr, old, new) { break } }`. Make `Add` and `SetLimit` lock-free among writers.

**Acceptance.** Under M concurrent writers each adding a distinct item, the final snapshot must contain **all** M items (no lost updates) — proving the CAS loop retries correctly on contention.

**Go reference (sketch):**
```go
func (r *Registry) Add(name string) {
	for {
		old := r.cur.Load()
		next := &Snapshot{Handlers: append(append([]string{}, old.Handlers...), name), Limit: old.Limit}
		if r.cur.CompareAndSwap(old, next) {
			return
		}
		// CAS failed: another writer published; retry with fresh old.
	}
}
```

**Note.** Cross-link `15-cas-atomic-primitives` for CAS details and ABA discussion.

---

### Task 8 — Structural sharing on a tree

**Goal.** Implement an immutable binary search tree with an RCU `Insert` that copies **only the path from root to the new leaf** and shares all untouched subtrees, then publishes the new root. Measure how many nodes are copied per insert (should be O(height), not O(n)).

**Acceptance.** For a tree of n nodes, an insert allocates O(log n) new nodes on average (the path), and the old root remains a valid, fully consistent tree for readers who subscribed to it.

**Hint.** `insert(node, k)` returns a new node whose changed child is the recursively-rebuilt subtree and whose other child is the *same shared pointer* as the original. Publish by swapping the single root pointer.

---

### Task 9 — Model a grace period explicitly

**Goal.** Without a real scheduler, simulate grace-period reasoning. Maintain a set of "active readers," each holding a version id. A writer that unpublishes version `v` records `v` as "retired at epoch E." Implement `try_reclaim()` that frees a retired version only once **no active reader holds it** (your stand-in for "all pre-existing readers passed a quiescent state").

**Acceptance.** `try_reclaim` must never free a version still referenced by an active reader; it must eventually free it once the last such reader "exits" (releases its version id).

**Hint.** This is epoch-based reclamation in miniature: readers pin a version on entry and unpin on exit; reclamation waits for unpins. Compare your logic to `call_rcu`'s deferred callback.

---

### Task 10 — RCU vs RWMutex benchmark

**Goal.** Implement the same read-mostly config two ways: (a) RCU pointer swap, (b) `sync.RWMutex`/`ReentrantReadWriteLock` guarding a mutable config. Benchmark with a 99:1 read:write ratio across many goroutines/threads (e.g., 8, 16, 32, 64). Plot reads/sec vs core count.

**Acceptance.** RCU read throughput scales roughly linearly with cores; the rwlock version flattens as the reader-count cache line contends. Document the crossover and the measured ratio.

**Go hint.**
```go
func BenchmarkRCURead(b *testing.B) {
	r := New(&Config{MaxConn: 100, Banner: "x"})
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() { _ = r.Read().MaxConn }
	})
}
// Compare against a RWMutex-guarded read that does mu.RLock()/RUnlock().
```

---

## Advanced Tasks (11–15)

### Task 11 — call_rcu-style deferred batched reclamation

**Goal.** Build a deferred-reclamation queue: writers enqueue retired versions with `callRcu(version, freeFn)`; a background "grace-period" worker periodically (after all simulated readers have cycled through a quiescent state) flushes the queue, invoking each `freeFn`. Show that one grace period flushes **many** queued items in a batch.

**Acceptance.** With a burst of K retirements during one grace period, all K `freeFn`s run together when the period ends — demonstrating amortization. Add a backlog cap that applies back-pressure (block the writer) when the queue exceeds a threshold, modeling the OOM defense from `senior.md`.

---

### Task 12 — Multi-pointer atomic update via aggregate

**Goal.** Suppose a logical update must change two related fields atomically from a reader's view (e.g., delete handler X **and** lower the limit, indivisibly). Show that two separate publishes let a reader observe an intermediate state, then fix it by funneling both changes through a **single** immutable aggregate snapshot published once.

**Acceptance.** With the two-publish version, a stress test catches at least one reader seeing "X deleted but limit not yet lowered" (or vice versa). With the single-aggregate version, no reader ever sees an intermediate — proving the single-publish linearizability discipline from `professional.md` §5.

---

### Task 13 — Refcount escape from a read-side section

**Goal.** Implement "look up cheaply, then hold": inside the read-side section, subscribe to an object and atomically acquire a reference count guarded against drop-to-zero (`incNotZero`); on success, the object is pinned and usable after the section ends; release it later with `put`. Show that a concurrent delete + reclaim does not free the object while a refcount is held.

**Acceptance.** A reader that pins an object via refcount can safely use it after `rcu_read_unlock`, even though a writer deleted and tried to reclaim it; reclamation happens only when the refcount reaches zero.

**Hint.** Cross-link `professional.md` §7 and `20-hazard-pointers`. The pattern: `rcu_read_lock(); p = deref(ptr); ok = p.incNotZero(); rcu_read_unlock(); if ok { use p; p.put() }`.

---

### Task 14 — RCU-protected hash map with resize

**Goal.** Implement a read-mostly hash map where readers look up lock-free and a resize publishes a **new bucket array** (rehashed) and reclaims the old one after a grace period (GC drop). Readers mid-lookup on the old array complete consistently; new lookups use the new array.

**Acceptance.** During a resize under concurrent reads, every reader returns correct results (no missing/duplicated entries from its consistent snapshot), and the old bucket array is reclaimed only after readers finish.

**Note.** Cross-link `18-concurrent-hash-map`. The whole-table swap is the simplest correct design; production maps use incremental/striped resize for memory, but the single-publish version is the clearest RCU illustration.

---

### Task 15 — RCU vs hazard pointers comparison report

**Goal.** Implement the *same* lock-free stack/queue node-reclamation problem two ways: (a) epoch/RCU-style deferred reclamation, (b) hazard pointers (each reader publishes its in-use node pointer + fence; writers scan before freeing). Measure read-path cost and peak unreclaimed memory under a write-heavy burst.

**Acceptance.** Your report shows RCU/epoch with cheaper reads (no per-read fence) but higher/peakier unreclaimed memory under bursts; hazard pointers with bounded memory but a per-dereference fence cost. Conclude with the decision rule: bound memory ⇒ hazard pointers; bound read cost ⇒ RCU.

**Note.** This is the capstone tying together `professional.md` §4 and `20-hazard-pointers`. Document concrete numbers from your runs.

---

## Wrap-up

After completing these fifteen tasks you should have:

- Implemented the core **RCU pointer-swap** (subscribe / copy-on-write / publish) and proven immutability and writer-serialization are mandatory.
- Reasoned through **use-after-free** and the **grace period** that prevents it, including a hand-built epoch/`call_rcu` model.
- Built RCU **lists, trees (structural sharing), and hash maps**, with CAS-based lock-free writers.
- Measured **why RCU reads scale** versus an rwlock, and where the writer/memory costs appear.
- Compared RCU against **hazard pointers** on principled grounds and applied the single-publish discipline that keeps read-mostly structures **linearizable**.

That covers the full operational and conceptual range of RCU. Revisit `senior.md` for kernel/userspace context and `professional.md` for the formal guarantees.
