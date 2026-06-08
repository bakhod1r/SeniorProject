# RCU (Read-Copy-Update) — Interview Questions

> **Audience:** Engineers preparing for systems / concurrency interviews where RCU, safe memory reclamation, read-mostly synchronization, or the Linux kernel come up. Prerequisite: `junior.md` and `middle.md`; `senior.md`/`professional.md` for the hardest tier.

This file has **50 tiered questions with answers** (Junior → Middle → Senior → Professional) followed by a **coding challenge**: a read-mostly config/list with RCU-style pointer swap, implemented in Go, Java, and Python.

---

## Table of Contents

1. [Junior Questions (1–14)](#junior)
2. [Middle Questions (15–28)](#middle)
3. [Senior Questions (29–38)](#senior)
4. [Professional Questions (39–45)](#professional)
5. [Rapid-Fire Round (46–50)](#rapid)
6. [Design / Scenario Discussions](#scenarios)
7. [Coding Challenge — RCU-Style Read-Mostly Config/List](#challenge)
8. [Interview Tips](#tips)

---

<a name="junior"></a>
## Junior Questions (1–14)

**Q1. What does RCU stand for, and what is the one-sentence summary?**
Read-Copy-Update: a synchronization mechanism for read-mostly data where readers run lock-free in critical sections while writers copy the data, modify the copy, atomically swap a pointer to publish it, and free the old version only after a grace period.

**Q2. Why is an RCU reader so cheap?**
A reader does just one atomic pointer load (subscribe) and traverses an immutable version. It takes no lock, performs no atomic read-modify-write, and writes no shared state — so on mainstream hardware the read path is essentially a plain load with no cache-line contention.

**Q3. What are the three steps the name "Read-Copy-Update" describes?**
Read (readers traverse the current version lock-free), Copy (a writer copies the data before changing it), Update (the writer publishes the modified copy by swapping a pointer, then reclaims the old version after a grace period).

**Q4. What is a grace period?**
The interval a writer waits, after publishing a new version, until every reader that could have referenced the old version has finished its read-side critical section. After it elapses, the old version is safe to free.

**Q5. Why must the writer wait a grace period before freeing the old version?**
A reader that subscribed before the swap may still be dereferencing the old version. Freeing it immediately would cause a use-after-free. The grace period guarantees all such readers have exited.

**Q6. What does "publish" mean in RCU?**
The writer's atomic store of the new pointer into the shared location, done with release ordering so the new block's fully-initialized contents are visible to any reader that loads the new pointer.

**Q7. What does "subscribe" mean?**
The reader's atomic load of the shared pointer (with consume/acquire ordering) to obtain the current version, which it then reads consistently for the rest of its critical section.

**Q8. What is copy-on-write and how does RCU use it?**
COW means copying data before modifying it so readers of the original are undisturbed. An RCU writer copies the current version, modifies the copy, and publishes the copy — never mutating a published version in place.

**Q9. Can two RCU readers block each other?**
No. Readers take no lock and write nothing shared, so they run fully in parallel and never block each other or a writer.

**Q10. If a reader subscribes just before a writer publishes a new version, what does the reader see?**
The old version it subscribed to, for the entire duration of its critical section. This staleness is by design and is safe; a fresh read later will see the new version.

**Q11. Is RCU good for write-heavy data? Why or why not?**
No. Each write copies data and incurs grace-period cost; if writes dominate, that overhead outweighs the read savings. RCU is for read-mostly data.

**Q12. In a garbage-collected language like Go or Java, what plays the role of the grace period and reclaim step?**
The garbage collector. It won't reclaim the old version while any reader still references it, and frees it once no reader does — exactly an RCU grace period plus reclamation, automatically.

**Q13. What is the cardinal rule about a published version?**
Never mutate it in place. A published version is shared by concurrent readers and must be treated as immutable; to change it, copy and publish a new version.

**Q14. Name a real system that uses RCU heavily.**
The Linux kernel — for the directory-entry cache (path lookups), routing/forwarding tables, device and module lists, and many other read-mostly structures.

**Q14b. In one phrase, what is the trade RCU makes?**
Cheap reads for more expensive writes (plus some transient extra memory while old and new versions coexist).

**Q14c. Why must a writer copy the data instead of editing it directly?**
Because readers are concurrently traversing the current version with no lock. Editing it in place would corrupt their view (a data race). Copying leaves the original untouched for its readers and exposes the change only via the published new version.

---

<a name="middle"></a>
## Middle Questions (15–28)

**Q15. What is a quiescent state?**
A point at which a CPU or thread is provably not inside any RCU read-side critical section (e.g., a context switch, return to user space, or idle in classic kernel RCU). A grace period ends when every CPU has passed through one after the unpublish.

**Q16. Why does the read side need no instrumentation in classic kernel RCU?**
Because classic read-side sections disable preemption and cannot block, any context switch is a guarantee that the previous code left its section. The scheduler's existing context switches double as quiescent-state reports, so readers report nothing.

**Q17. Explain the memory-ordering hazard if publish/subscribe used a plain (non-atomic) pointer.**
The CPU/compiler could make the pointer store visible before the field initializations, so a reader loads the new pointer but reads uninitialized garbage. Publish must be a release store and subscribe a consume/acquire load to prevent this.

**Q18. Why does subscribe only need "consume" rather than full "acquire" ordering?**
The reader only dereferences the pointer it just loaded, and that dereference is address-dependent on the load. Hardware honors address dependencies, so dependency (consume) ordering suffices — and on mainstream CPUs it compiles to a plain load, which is why reads are free.

**Q19. Compare RCU readers to reader-writer-lock readers.**
An rwlock reader must atomically increment/decrement a shared reader count (two atomics writing a shared cache line). An RCU reader does a plain pointer load with no shared write — so RCU readers scale linearly while rwlock readers contend on the counter's cache line.

**Q20. Why does an rwlock's reader counter become a bottleneck under heavy read load?**
Every reader writes the shared counter, invalidating it in other cores' caches (cache-line ping-pong). Even though reads "don't conflict" logically, they serialize at the coherence level. RCU avoids this by never writing shared state on the read path.

**Q21. How do you insert a node into an RCU-protected linked list?**
Set the new node's `next` to point at the rest of the list while it's still private, then publish with a release store that splices it in (`rcu_assign_pointer(P->next, N)`). Readers see either the old list or the new list with N fully linked — never a dangling N.

**Q22. How do you delete a node, and why does delete need a grace period but insert does not?**
Unpublish the node (splice it out with a release store), wait a grace period, then free it. Insert only adds reachability so no memory is freed (no grace period needed); delete removes a node a reader may still hold, so it must wait before freeing.

**Q23. Compare RCU to a seqlock.**
A seqlock reader snapshots a sequence counter, reads, re-checks the counter, and **retries** if a writer interfered; it's for small value-type data and can starve under busy writers. RCU readers never retry, safely follow pointers to dynamically allocated nodes, and don't starve. Seqlock for tiny value data, RCU for pointer-linked read-mostly structures.

**Q24. What is the difference between `synchronize_rcu` and `call_rcu`?**
`synchronize_rcu` blocks the writer for one grace period, then returns (simple, prompt reclamation). `call_rcu` registers a callback to free the old version after the next grace period and returns immediately (non-blocking, batched reclamation) — but callbacks can backlog.

**Q25. What's the memory cost of RCU during a grace period?**
Old and new versions coexist. With `synchronize_rcu` at most one old version is outstanding; with `call_rcu` many can pile up, bounded by write rate × grace-period length — a memory spike under write bursts.

**Q26. Why must writers be serialized separately in RCU?**
RCU protects readers and reclamation, not writer-vs-writer races. Two concurrent copy-modify-publish writers can lose an update (one publish overwrites the other). Serialize writers with a mutex or a CAS loop.

**Q27. What is structural sharing and why does it matter for RCU writers?**
Instead of copying an entire large structure, the writer copies only the nodes on the path to the change and re-points the rest at existing immutable subtrees. This makes the copy O(log n) instead of O(n) and keeps the reclaimed old portion small.

**Q27b. Must every interior pointer in a traversal be loaded specially?**
Yes — each followed pointer (e.g., `node->next`) must be a dependency-ordered load (`rcu_dereference`), not a plain read, so the reader sees a fully initialized successor on weakly ordered hardware. Forgetting this on an interior pointer is a subtle, architecture-specific bug.

**Q27c. Why does an RCU read scale linearly with cores while an rwlock read does not?**
An RCU read writes nothing shared, so the data's cache lines stay in shared (read-only) state across all cores — no invalidation traffic. An rwlock reader writes the shared reader counter, invalidating that line in every other core's cache (ping-pong), which serializes readers at the coherence level and saturates as cores increase.

**Q28. Give the decision checklist for using RCU.**
Use RCU if: data is read far more than written, readers tolerate a one-version-stale view, the data is pointer-linked or snapshot-able, and you can afford old+new memory during grace periods. Otherwise prefer a lock (or a seqlock for small value data).

**Q28b. Do RCU read-side sections nest, and what ends the section?**
Yes — they nest, with the runtime counting depth. The *outermost* `rcu_read_unlock` ends the section (reaches a potential quiescent state). This lets you compose RCU-protected helpers freely; a common bug is assuming an inner unlock ends the section and using the reference afterward.

**Q28c. How is RCU like MVCC?**
Both give readers a consistent snapshot taken at the start of their "transaction" (read-side section), while writers create new versions instead of mutating in place. The grace period is RCU's old-version garbage collection, analogous to a database's VACUUM cleaning up row versions no snapshot still needs. RCU is essentially "MVCC for an in-memory pointer-linked structure," providing snapshot isolation per section.

---

<a name="senior"></a>
## Senior Questions (29–38)

**Q29. Why is a routing/forwarding table an archetypal RCU workload?**
It's consulted per packet (millions of reads/sec across cores) and updated rarely (route changes). RCU gives free, wait-free per-packet lookups; updates publish a new (structurally shared) table and reclaim the old after a grace period. A single stale forward during a microsecond grace period is harmless.

**Q30. How does `call_rcu` amortize reclamation cost?**
One grace period flushes many queued callbacks at once. The grace-period detection cost (observing all CPUs quiescent) is paid once and shared across all pending reclamations, so per-object overhead approaches zero.

**Q31. What is the danger of `call_rcu` and how is it mitigated?**
If writers queue callbacks faster than grace periods complete, callback lists grow unbounded and memory balloons (possible OOM). Mitigations: rate-limit writes, switch to `synchronize_rcu` past a backlog threshold (back-pressure), use expedited grace periods, and monitor callback depth. `rcu_barrier()` flushes pending callbacks at teardown.

**Q32. Why do the RCU flavors (classic, preemptible, SRCU) exist?**
Different read environments need different quiescent-state definitions. Classic: non-preemptible, free reads, no blocking. Preemptible: read-side sections can be preempted for real-time latency. SRCU: read-side sections may sleep, with per-domain state to bound the blast radius of a long-sleeping reader.

**Q33. When must you use SRCU instead of classic RCU?**
When a read-side critical section legitimately needs to sleep (I/O, take a mutex, page fault). Classic/preemptible RCU forbid sleeping in a section (it would stall grace periods); SRCU permits it via per-CPU index counters and per-domain grace periods.

**Q34. What is userspace RCU (liburcu) and how does QSBR achieve free reads?**
liburcu brings RCU to applications. QSBR (Quiescent-State-Based Reclamation) makes `rcu_read_lock/unlock` no-ops; the application explicitly calls `rcu_quiescent_state()` at natural points (e.g., top of an event loop) to announce quiescence — giving truly free reads in exchange for app cooperation.

**Q35. Describe the RCU memory-vs-latency trade-off in one breath.**
Writers pay copy cost, grace-period latency, and transient old+new memory (plus GC pressure in managed languages) so that readers run free and scale linearly across cores. The more read-dominated the workload, the bigger the net win.

**Q36. What happened with the dcache and RCU, and what's the lesson?**
Path lookup once took a global `dcache_lock` per path component — a multicore bottleneck. RCU-walk made the read side lock-free, with a rare locked fallback for tricky cases, yielding order-of-magnitude scaling gains. Lesson: RCU's biggest wins come from removing a global lock on a per-operation read path.

**Q37. A user reports that just after a config push, a few requests still see old flags. Bug or feature?**
Feature — RCU working as designed. In-flight requests that subscribed before the push finish on the old immutable config; only requests starting after the push see the new one. The staleness contract must be documented so correct behavior isn't mistaken for a bug.

**Q38. Why is blocking inside a classic read-side section dangerous?**
The grace period can't end until the reader exits its section (no quiescent state inside it). A blocked reader stalls grace-period completion indefinitely (RCU stall), delaying all reclamation. Move blocking work outside the section or use SRCU.

**Q38b. What is RCU priority boosting and why is it needed?**
In preemptible/real-time RCU, a low-priority reader can be preempted while holding up a grace period that a higher-priority task is waiting on (`synchronize_rcu`). Priority boosting temporarily raises the stuck reader's priority so it gets scheduled, exits its section, and lets the grace period complete — bounding grace-period latency in real-time kernels.

**Q38c. Why does RCU pair naturally with immutable / persistent data structures?**
Immutable structures give you the "never mutate a published version" property for free, and structural sharing lets a writer produce a new version by copying only the changed path (O(log n)) while readers of the old version keep a fully consistent snapshot. RCU then supplies the missing piece: safe *reclamation* of the superseded nodes once no reader holds them.

---

<a name="professional"></a>
## Professional Questions (39–45)

**Q39. State and justify the grace-period safety theorem.**
If an object is unpublished at `t_remove` and freed no earlier than the end of the grace period started at `t_remove`, no reader dereferences it after the free. Justification: a read-side section contains no quiescent state, so once every CPU is observed quiescent after `t_remove`, every pre-existing reader (whose section was open before `t_remove`) has provably exited by the grace period's end — its exit time is upper-bounded by the reclamation point. New readers (entering after `t_remove`) can't reach the unpublished object. So no live reader holds it at free time.

**Q40. State the exact memory-ordering requirements for publish, subscribe, and reclaim.**
Publish: release store, so field initializations happen-before the pointer store and are visible to any thread observing it. Subscribe: dependency/consume ordering, so dependent field reads observe memory at least as recent as the publishing release (free on mainstream hardware via address dependencies). Reclaim: the grace-period machinery carries full barriers so all readers' accesses happen-before the free.

**Q41. What was the DEC Alpha problem and what does it teach?**
Alpha could return a stale dependent-load value even when the pointer load saw the new pointer, because split caches could satisfy the dependent load from a bank that hadn't seen the field update — violating dependency ordering. The fix was a read-dependency barrier in `rcu_dereference` (a no-op everywhere but Alpha). Lesson: dependency ordering is "free" only because virtually all hardware honors address dependencies; it's a hardware guarantee, not automatic.

**Q42. Compare RCU and hazard pointers as SMR schemes.**
RCU readers announce nothing per-object and reclamation waits for a grace period (memory time-bounded, can backlog; reads free — no store, no fence). Hazard pointers publish each held pointer into a per-thread slot with a store+fence, and writers free as soon as no hazard names the object (memory count-bounded/deterministic; reads cost a fence). RCU trades memory for read speed; HP trades read speed for memory determinism. Bound memory ⇒ HP; bound read cost ⇒ RCU.

**Q43. Is an RCU-protected read-mostly structure linearizable? Explain the staleness.**
Yes, provided each logically atomic update is one release publish (single pointer), writers are serialized (publishes totally ordered), and readers subscribe once per view. A write linearizes at its publish; a read linearizes at its subscribe load (within its invocation–response interval). The "staleness" — not observing a write that completed in wall-clock time after the subscribe — is not a violation; linearizability only requires each op's point lie in its interval, not wall-clock-latest observation. Multi-step reads stay linearizable only if each logical update is a single publish (e.g., swap a top-level aggregate pointer).

**Q44. How does RCU interact with the ABA problem when composed with CAS writers?**
RCU/EBR sidesteps classic ABA: a reclaimed pointer's memory cannot be reused until after a grace period, so a reader in a critical section can't observe a recycled address mid-section. This makes RCU/epoch reclamation a natural partner for CAS-based lock-free writers, which read `old`, build `new`, and `CAS(ptr, old, new)`, reclaiming the replaced `old` via grace period.

**Q45. A reader needs to keep using an object after its read-side section ends. How?**
Pure RCU forbids this (the reference would dangle after the next grace period). Inside the section, `rcu_dereference` the object and then atomically acquire a reference count guarded against drop-to-zero (`refcount_inc_not_zero`); if it succeeds, the object is pinned independent of RCU and can be used after `rcu_read_unlock`, then released with `put_ref`. This composes RCU's cheap lookup with refcount's long-lived pinning.

**Q45b. Why is "sleep a fixed time instead of synchronize_rcu" wrong?**
A wall-clock sleep establishes no happens-before edge, so the writer may not have observed a reader's final writes (store buffers/caches) even if real time has passed — a memory-model race. It also can't bound reader duration: a reader descheduled by a page fault or VM pause can exceed any fixed sleep, causing use-after-free. A grace period is a *logical* condition (all pre-existing readers observed quiescent, with barriers), not a *temporal* one.

**Q45c. State RCU's reclamation safety as a happens-before contract.**
`synchronize_rcu` partitions all read-side sections into "before me" and "after me" with no overlap: for every access in a section that started before the grace period, that access happens-before `synchronize_rcu` returns. So in `unpublish; synchronize_rcu(); free`, every reader access to the old object happens-before the free — the definition of no use-after-free, as a happens-before chain. This requires barriers inside the grace-period machinery, which is why only the real primitive (not a sleep or bare counter) is sound.

---

<a name="rapid"></a>
## Rapid-Fire Round (46–50)

**Q46. One line: when does delete need a grace period but insert does not?**
Delete frees memory a reader might hold (needs a grace period); insert only adds reachability and frees nothing (no grace period).

**Q47. One line: why does RCU/epoch reclamation neutralize the ABA problem?**
A reclaimed pointer's memory can't be reused until after a grace period, so a reader in a section can never observe a recycled address mid-traversal.

**Q48. One line: what is the single design rule that keeps a multi-step RCU read linearizable?**
Commit each logically atomic update with one release publish (swap a single top-level aggregate pointer), so readers subscribe once and see one coherent version.

**Q49. One line: in a managed language, what is the catch with "the GC is the grace period"?**
It is correct and automatic, but the reclamation cost reappears as GC pressure — a high write rate creates garbage that the collector must keep pace with.

**Q50. One line: state the RCU vs hazard-pointers decision rule.**
Bound memory ⇒ hazard pointers (count-bounded, fence per read); bound read cost ⇒ RCU (free reads, time-bounded memory that can backlog).

**Q50b. One line: name the four irreducible invariants of correct RCU.**
Immutability after publish; single release publish per logical update with serialized writers; dependency-ordered subscribe on every followed pointer; free only after a grace period (a happens-before condition, not a timer).

**Q50c. One line: where does delete's grace period requirement come from formally?**
A reader that subscribed before the unpublish may still hold the node; the grace period upper-bounds every such reader's exit time, so freeing after it cannot race a live reader.

**Q50d. One line: why is an RCU reader "wait-free"?**
It executes a bounded number of steps (subscribe + traverse) with no lock, no CAS retry, and no spin, and cannot be blocked by any other thread.

**Bonus — a tricky one interviewers like:** *"If readers never announce themselves, how can the writer possibly know when it's safe to free?"*
The writer doesn't track readers at all. It relies on the property that a read-side section contains no quiescent state, so once every CPU has passed through a quiescent state after the unpublish, every pre-existing reader has provably exited. The writer waits for that condition (the grace period) — a conservative, reader-free proof of safety.

---

<a name="scenarios"></a>
## Design / Scenario Discussions

These are open-ended prompts an interviewer might use to probe depth. Each gives a model answer outline.

### S1. "Design a feature-flag service read by every request handler, updated on deploy."

Model answer: Hold the entire flag set as **one immutable snapshot** behind an atomic pointer (`atomic.Pointer` / `AtomicReference`). Request handlers `Read()` once at the start of handling — a single lock-free pointer load — and read flags off the immutable snapshot for the whole request (consistent view). A deploy/push **builds a new immutable snapshot and swaps the pointer** (one publish, release ordering); writers serialize on a mutex. In-flight requests finish on their subscribed snapshot; new requests pick up the new one. The GC reclaims the old snapshot once no handler references it (the grace period). Call out the **staleness contract** explicitly (in-flight requests use the snapshot they started with) and note this beats an `RWMutex` because reads never touch a shared lock, so it scales linearly across cores at millions of req/s. Mention coalescing rapid pushes to limit GC churn.

### S2. "Your `call_rcu`-based deletes cause OOM during a traffic spike. Diagnose and fix."

Model answer: The deletion rate exceeded the grace-period completion rate, so callback lists grew unbounded (retired-but-unreclaimed objects piled up) — `w · T_gp` outran the memory budget. Diagnose by monitoring **callback backlog / outstanding-version count**. Fixes: rate-limit deletions; apply **back-pressure** by switching to synchronous `synchronize_rcu` above a backlog threshold (so writers self-throttle); use **expedited grace periods** to drain faster; add a writer **kill switch** for incidents. Root principle: `call_rcu` decouples writers from reclamation, including from reality — you must bound the write rate or the backlog.

### S3. "A reader needs to keep using an object after its lookup. RCU alone won't allow it. What do you do?"

Model answer: Pure RCU references are valid only inside the read-side section. Use the **lookup-then-pin** idiom: inside the section, `rcu_dereference` the object and atomically `refcount_inc_not_zero` (guarding against a concurrent drop-to-zero by a deleting writer). On success, the object is pinned by the refcount independent of RCU, so you can use it after `rcu_read_unlock`; release with `put` later, which triggers reclamation when the count hits zero. This composes RCU's cheap lookup with refcount's long-lived pinning — the standard kernel idiom.

### S4. "Why not just use a sharded set of locks instead of RCU for a read-mostly map?"

Model answer: Sharded/striped locks reduce *write* contention and help balanced workloads, but **readers still take a lock per shard** — an atomic op and a potentially contended cache line on every read. For a read-mostly map at high core counts, that reader-side atomic is the bottleneck RCU eliminates entirely (reads are a plain load, no shared write). Sharded locks win when writes are frequent enough that RCU's per-write copy + grace-period cost dominates; RCU wins when reads dominate and you want them to be free. The decision is the read:write ratio and core count (the break-even ratio falls as cores rise).

### S5. "How would you make an RCU-protected structure both read-mostly-fast and memory-bounded under write bursts?"

Model answer: Pure RCU is time-bounded in memory (can backlog), so under adversarial write bursts add a bound: (a) **structural sharing** so each retired version is small; (b) a **backlog cap** that switches to synchronous reclamation (back-pressure) past a threshold; or (c) a **hybrid with hazard pointers / refcounts** for the specific objects that must be count-bounded. If hard memory determinism is the top requirement, consider hazard pointers instead (count-bounded by design) and accept the per-read fence. State the trade explicitly: RCU trades memory for read speed; HP trades read speed for memory determinism.

### S6. "Walk me through what breaks if you free the old version one instruction after publishing."

Model answer: Construct the interleaving. Reader R does `rcu_read_lock(); p = load(gPtr) = old` before the writer publishes. Writer does `store(gPtr, new); free(old)`. Now R, still in its section, dereferences `p` (= freed `old`) → **use-after-free**: a read of reclaimed memory, which may be reused/zeroed/reallocated, causing a crash or silent corruption. The fix is the grace period between publish and free: `store(gPtr,new); synchronize_rcu(); free(old)`. `synchronize_rcu` blocks until R (and every other pre-existing reader) has exited its section — provable because a read-side section contains no quiescent state, so once every CPU is quiescent after the unpublish, R has finished. Emphasize: the bug is timing-dependent and won't show in single-threaded tests; you need concurrent stress under a sanitizer to catch it.

### S7. "How does RCU keep a multi-step traversal consistent while a writer mutates the structure?"

Model answer: The reader subscribes once to a version (or, for a linked structure, the writer makes each logical update a single release publish of one pointer). Because published versions are immutable and the transition is atomic, a traversal either fully precedes or fully follows the publish at its linearization point — it never splices two half-versions. For a list, insert publishes a fully-linked node (set `new.next` before splicing) and delete unpublishes then reclaims after a grace period, so a reader mid-traversal either skips or fully passes through the affected node, always over consistent memory. The discipline: one release publish per logical update; subscribe once; `rcu_dereference` every followed pointer.

---

<a name="challenge"></a>
## Coding Challenge — RCU-Style Read-Mostly Config/List

**Problem.** Implement a thread-safe **read-mostly registry** holding an immutable list of handler names plus a config value, with:

- `Read()` / `snapshot()` — a **lock-free** reader returning a consistent immutable snapshot (the RCU subscribe).
- `Add(name)` — a writer that **copies** the current list, appends `name`, and **publishes** the new immutable snapshot via an atomic pointer swap (RCU update). Writers are serialized.
- `SetLimit(n)` — a writer that publishes a snapshot with an updated config field.

Requirements: readers never lock; the published snapshot is never mutated; writers serialize among themselves; old snapshots are reclaimed by the runtime GC (the grace period) once unreferenced. Demonstrate that a reader holding an old snapshot sees a consistent old view after a concurrent write.

### Go

```go
package registry

import (
	"sync"
	"sync/atomic"
)

// Snapshot is IMMUTABLE once published.
type Snapshot struct {
	Handlers []string // never mutated after publish
	Limit    int
}

type Registry struct {
	cur     atomic.Pointer[Snapshot]
	writeMu sync.Mutex // serialize writers
}

func New() *Registry {
	r := &Registry{}
	r.cur.Store(&Snapshot{Handlers: []string{}, Limit: 100}) // publish v1
	return r
}

// Read: RCU subscribe — one atomic load, no lock. Returned snapshot is immutable.
func (r *Registry) Read() *Snapshot {
	return r.cur.Load()
}

// Add: RCU update — copy-on-write + atomic publish.
func (r *Registry) Add(name string) {
	r.writeMu.Lock()
	defer r.writeMu.Unlock()

	old := r.cur.Load()
	// COPY the handlers slice (never mutate the published one).
	next := &Snapshot{
		Handlers: make([]string, len(old.Handlers), len(old.Handlers)+1),
		Limit:    old.Limit,
	}
	copy(next.Handlers, old.Handlers)
	next.Handlers = append(next.Handlers, name)
	r.cur.Store(next) // PUBLISH (release)
	// old snapshot reclaimed by GC after last reader drops it == grace period.
}

// SetLimit: RCU update on the config field.
func (r *Registry) SetLimit(n int) {
	r.writeMu.Lock()
	defer r.writeMu.Unlock()
	old := r.cur.Load()
	next := &Snapshot{Handlers: old.Handlers, Limit: n} // share immutable handlers
	r.cur.Store(next)
}
```

Demonstration:

```go
r := New()
r.Add("auth")
snap := r.Read()        // reader subscribes: {Handlers:[auth], Limit:100}
r.Add("metrics")        // concurrent writer publishes a new snapshot
// snap still sees [auth] / 100 — consistent old view (RCU staleness, by design)
_ = snap.Handlers       // == ["auth"], unaffected by the concurrent Add
latest := r.Read()      // == ["auth","metrics"]
_ = latest
```

### Java

```java
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

final class Snapshot {                 // immutable
    final List<String> handlers;
    final int limit;
    Snapshot(List<String> handlers, int limit) {
        this.handlers = List.copyOf(handlers); // unmodifiable
        this.limit = limit;
    }
    Snapshot withHandler(String name) {        // COPY-ON-WRITE
        List<String> next = new ArrayList<>(handlers);
        next.add(name);
        return new Snapshot(next, limit);
    }
    Snapshot withLimit(int n) {
        return new Snapshot(handlers, n);       // share immutable handlers
    }
}

public final class Registry {
    private final AtomicReference<Snapshot> cur;
    private final Object writeLock = new Object();

    public Registry() {
        cur = new AtomicReference<>(new Snapshot(List.of(), 100)); // publish v1
    }

    /** RCU subscribe: one acquire read, no lock. */
    public Snapshot read() {
        return cur.get();
    }

    /** RCU update: copy-on-write + atomic publish. GC = grace period. */
    public void add(String name) {
        synchronized (writeLock) {
            cur.set(cur.get().withHandler(name)); // COPY + PUBLISH
        }
    }

    public void setLimit(int n) {
        synchronized (writeLock) {
            cur.set(cur.get().withLimit(n));
        }
    }
}
```

Demonstration:

```java
Registry r = new Registry();
r.add("auth");
Snapshot snap = r.read();   // {handlers:[auth], limit:100}
r.add("metrics");           // concurrent publish
// snap.handlers still == [auth]; snap.limit == 100 (consistent old view)
List<String> latest = r.read().handlers; // == [auth, metrics]
```

### Python

```python
import threading
from dataclasses import dataclass, replace
from typing import Tuple

@dataclass(frozen=True)        # immutable snapshot
class Snapshot:
    handlers: Tuple[str, ...]  # tuple => immutable
    limit: int

class Registry:
    def __init__(self) -> None:
        self._cur = Snapshot(handlers=(), limit=100)  # publish v1
        self._write_lock = threading.Lock()           # serialize writers

    def read(self) -> Snapshot:
        # RCU subscribe: grab the current immutable snapshot (atomic name load
        # under the GIL). Safe to use without locking.
        return self._cur

    def add(self, name: str) -> None:
        with self._write_lock:                         # serialize writers
            old = self._cur
            new = replace(old, handlers=old.handlers + (name,))  # COPY + modify
            self._cur = new                            # PUBLISH (atomic rebind)

    def set_limit(self, n: int) -> None:
        with self._write_lock:
            self._cur = replace(self._cur, limit=n)
```

Demonstration:

```python
r = Registry()
r.add("auth")
snap = r.read()        # Snapshot(handlers=('auth',), limit=100)
r.add("metrics")       # concurrent publish
assert snap.handlers == ("auth",)     # old view stays consistent
assert r.read().handlers == ("auth", "metrics")
```

**Note (Python):** under the GIL there's no multicore read scaling, but the pattern is the clearest correct way to expose read-mostly state to threads without reader locks. For genuine parallel RCU use Go, Java, or C with liburcu.

**Complexity.** `Read` is O(1) overhead (one pointer load), lock-free. `Add`/`SetLimit` are O(size of the copied portion) plus an atomic publish, serialized among writers. Old snapshots are reclaimed by the GC once unreferenced (the grace period).

### Follow-ups the interviewer may ask

**F1. "Make the writers lock-free."** Replace the writer mutex with a CAS loop: read `old`, build `next = transform(old)`, `CompareAndSwap(ptr, old, next)`; on failure, reload `old` and retry. This makes writers lock-free (some writer always progresses) while readers stay wait-free. Note the retry handles concurrent publishes without losing updates — and that RCU's deferred reuse neutralizes ABA, so the CAS is safe.

**F2. "What if the handler list is huge and writes are frequent?"** Whole-list copy-on-write is O(n) per write — too expensive. Switch to structural sharing (copy only the changed chain/path and share the rest) or a per-bucket RCU map so each write copies O(chain) instead of O(n). If writes truly dominate, reconsider RCU entirely and use sharded locks.

**F3. "How do you bound memory under a write burst?"** In a GC language, ensure heap headroom and a low-pause collector; coalesce rapid writes into fewer publishes. In an unmanaged/`call_rcu` setting, cap the reclamation backlog and apply back-pressure (fall back to synchronous reclamation) past a threshold.

**F4. "Prove a reader never sees a torn snapshot."** Each published snapshot is immutable and is installed with a single atomic release store. A reader's single atomic acquire load returns exactly one snapshot pointer; it then reads only that immutable object. There is no interleaving that yields a mix of two snapshots, because no snapshot is ever mutated and the pointer transition is atomic.

**F5. "How would you unit-test this for concurrency bugs?"** Run N reader threads asserting a snapshot invariant (e.g., handlers non-null, limit positive) in a tight loop while M writer threads publish, for a fixed duration, under the race detector (Go `-race`, TSan). Add a determinism check: after all writes, the final snapshot must contain every added handler (no lost updates). Single-threaded tests cannot catch RCU bugs; the concurrent stress + sanitizer is essential.

### Why this challenge tests the right things

The challenge forces the candidate to demonstrate the four pillars: **immutability** (the snapshot type is frozen), the **subscribe/publish** mechanic (atomic load/store), **writer serialization** (the mutex or CAS loop), and **deferred reclamation** (naming the GC as the grace period). A candidate who implements all four and can articulate the staleness contract and the use-after-free reasoning has shown genuine RCU understanding rather than API recall.

---

<a name="tips"></a>
## Interview Tips

- **Lead with the read/write asymmetry.** "Readers are free; writers pay" is the thesis of RCU — say it early.
- **Always mention the grace period when asked about freeing memory.** The use-after-free risk and its fix (wait until pre-existing readers exit) is the most-tested idea.
- **Distinguish publish (release) from subscribe (consume/acquire)** out loud — and note subscribe is free on mainstream hardware due to address dependencies. It signals depth.
- **Name the staleness contract explicitly.** "A reader sees its subscribed version, possibly one update behind; that's by design and is linearizable" preempts the "isn't that a bug?" follow-up.
- **Contrast with rwlock and hazard pointers** when asked "why not just X?" — rwlock readers contend on a counter; hazard pointers bound memory but cost a fence per read.
- **For the coding challenge, stress immutability and writer serialization.** State that the published snapshot is never mutated and that RCU does not serialize writers for you.
- **In GC languages, point out the GC is the grace period.** It shows you understand the mechanism, not just the API.
- **Draw the timeline.** For any "is this safe?" question, sketch reader subscribe → writer publish → grace period → free, and point to where the guarantee comes from. Interviewers reward a clear diagram over hand-waving.
- **Know the one-pointer limitation.** If asked to update two related things atomically, immediately say "funnel them through a single aggregate pointer so one publish commits both" — it signals you understand the linearizability boundary.
- **Quantify when pushed.** "Reads scale linearly with cores because there's no shared write; an rwlock's reader counter ping-pongs across cores and saturates" is the kind of concrete, mechanism-level answer that separates senior candidates.

### A 30-second framing you can open with

> "RCU is for read-mostly data. Readers are wait-free — one atomic pointer load, no lock, no shared write — so they scale linearly across cores. Writers pay instead: they copy the data, modify the copy, atomically swap the pointer to publish (release ordering), then wait a grace period — until every pre-existing reader has finished — before freeing the old version, so no reader ever sees freed memory. In a GC language the garbage collector is the grace period. The trade is cheap reads for more expensive writes and some transient extra memory; it's a cornerstone of the Linux kernel for routing tables, the dcache, and read-mostly config."

If you can say that fluently and then defend each clause, you have demonstrated mastery of the topic.

### Cross-topic connections to mention

Showing how RCU relates to neighboring concepts signals breadth:

- **CAS / atomic primitives (`15-cas-atomic-primitives`)** — the atomic store under "publish" and the basis for lock-free writers; RCU's deferred reuse neutralizes ABA.
- **Hazard pointers (`20-hazard-pointers`)** — the alternative safe-memory-reclamation scheme; the RCU-vs-HP memory/read trade is a favorite senior question.
- **Concurrent hash map (`18-concurrent-hash-map`)** — a canonical RCU-protected structure (lock-free lookups, publish-on-resize).
- **Persistent/immutable trees (`11-persistent-segment-tree`)** — structural sharing makes RCU writers cheap; RCU supplies the safe reclamation those structures need under concurrent readers.
- **Seqlock and reader-writer locks** — the read-mostly alternatives RCU is most often compared against.

### A final self-check before the interview

Can you, without notes: (1) draw the subscribe → publish → grace period → reclaim timeline; (2) explain why a read-side section containing no quiescent state makes the grace period sufficient; (3) state publish = release / subscribe = consume and why subscribe is free on real hardware; (4) give the RCU-vs-rwlock and RCU-vs-hazard-pointer trade-offs; and (5) write the coding challenge in your strongest language with immutable snapshots and writer serialization? If yes, you are ready.

Continue with `tasks.md` for hands-on RCU implementation exercises.
