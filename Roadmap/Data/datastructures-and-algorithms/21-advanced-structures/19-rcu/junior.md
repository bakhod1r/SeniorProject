# RCU (Read-Copy-Update) — Junior Level

> **Read time: ~35 minutes** · **Audience:** Engineers who know pointers, atomic operations at a basic level, and the idea of "many threads reading shared data" and want to learn the single most important synchronization pattern for read-mostly data: near-zero-cost reads.

**RCU** — short for **Read-Copy-Update** — is a synchronization mechanism designed for data that is **read far more often than it is written**. Its defining property is that **readers pay almost nothing**: a reader does not take a lock, does not perform an atomic compare-and-swap, and on many systems does not even execute a single expensive memory barrier on the fast path. Readers simply *read*. Writers, on the other hand, do the heavy lifting: instead of modifying shared data in place, a writer **copies** the data, modifies the **copy**, and then **atomically swaps a single pointer** so that new readers see the new version. The old version is freed only **later**, after the system is certain that no reader is still looking at it — a wait called the **grace period**.

The name spells out the three steps:

- **Read** — readers traverse the data structure inside a lightweight "read-side critical section" with no locks.
- **Copy** — a writer copies the node or structure it wants to change.
- **Update** — the writer publishes the modified copy by swapping a pointer, then reclaims the old copy after a grace period.

RCU was developed in the late 1990s (the term and the kernel implementation are due to **Paul McKenney** and colleagues; the underlying idea has roots in work by **Hennessy, Jagannathan, and others** on "passive serialization"). It is one of the most heavily used synchronization mechanisms in the **Linux kernel**, where it protects routing tables, the directory-entry cache (`dcache`), module lists, network device lists, and thousands of other read-mostly structures. There are also production-grade **userspace RCU** libraries (liburcu) used in high-performance servers and trading systems.

This document teaches RCU **from the ground up**: what the read-copy-update pattern is, why a single atomic pointer swap is enough to publish a new version safely, what a grace period means and why we must wait for one before freeing memory, and a small **copy-on-write (COW)** example you can run in your head. By the end you should be able to explain to a colleague why an RCU reader is so cheap and what the writer pays in exchange.

---

## Table of Contents

1. [Introduction — The Read-Mostly Problem](#introduction)
2. [Prerequisites — Pointers, Atomics, and Memory Ordering Basics](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts — Read, Copy, Update, Reclaim](#core-concepts)
5. [Big-O Summary](#big-o-summary)
6. [Real-World Analogies](#analogies)
7. [Pros and Cons vs Locking](#pros-and-cons)
8. [Step-by-Step Walkthrough — Updating a Config Pointer](#walkthrough)
9. [Code Examples — Go, Java, Python](#code-examples)
10. [Coding Patterns — Publish, Subscribe, Swap](#patterns)
11. [Error Handling — Use-After-Free and the Grace Period](#errors)
12. [Performance Tips](#performance-tips)
13. [Best Practices](#best-practices)
14. [Edge Cases](#edge-cases)
15. [Common Mistakes](#common-mistakes)
16. [Cheat Sheet](#cheat-sheet)
17. [Visual Animation Reference](#animation)
18. [Summary](#summary)
19. [Further Reading](#further-reading)

---

<a name="introduction"></a>
## 1. Introduction — The Read-Mostly Problem

Imagine a configuration object shared by every request handler in a web server: feature flags, routing rules, rate limits. Thousands of threads read this config millions of times per second. Once an hour, an administrator updates it. This is a **read-mostly** workload: reads vastly outnumber writes.

How do we make concurrent access safe? The textbook answer is a **lock**.

### Option 1 — A mutex (mutual exclusion lock)

Every reader and every writer grabs the same lock. This is correct but catastrophic for performance: on the read-mostly config, millions of readers per second now serialize on a single lock. Even if reads never conflict with each other, the lock forces them to take turns. Throughput collapses and the lock's cache line bounces between CPU cores (cache-line "ping-pong").

### Option 2 — A reader-writer lock (rwlock)

A reader-writer lock lets many readers proceed in parallel and only blocks when a writer is active. Better — but **readers still write shared state**. To register as a reader, each reader must increment a shared reader-count (an atomic operation) on entry and decrement it on exit. That atomic touches a shared cache line, so even though readers don't block each other logically, they still contend on the lock's internal counter. Under heavy read load on many cores, that counter becomes a bottleneck. A read is supposed to be cheap; with an rwlock it costs at least two atomic operations plus cache-coherence traffic.

### Option 3 — RCU

RCU asks a sharper question: *what if readers wrote nothing at all?* What if a reader could grab the current version of the data and traverse it with **no atomic operation, no lock, no shared writes** — just an ordinary pointer read?

The catch is the writer. If readers never announce themselves, how does a writer know when it is safe to free old data that a reader might still be using? RCU's answer is the **grace period**: the writer publishes the new version (one atomic pointer swap), then **waits until every reader that could possibly have seen the old version has finished**. Only then does it free the old version. Readers that start *after* the swap see the new data; readers that started *before* the swap keep using the old data safely until they finish.

The result: **reads are nearly free**, writes are more expensive (they copy data and wait for a grace period), and the data structure is always consistent for every reader. For a workload that is 99.99% reads, this is an enormous win.

RCU is not magic and not universal. It shines for read-mostly data where a slightly stale read is acceptable for the duration of one operation, and where writers can tolerate doing extra work. It is the wrong tool for write-heavy data or for cases where every reader must see the absolute latest write instantly. The rest of this document makes those trade-offs precise.

---

<a name="prerequisites"></a>
## 2. Prerequisites — Pointers, Atomics, and Memory Ordering Basics

You need three background ideas.

### 2.1 A shared pointer to immutable data

The core RCU data layout is **one pointer** that points at a block of data. The data block itself is treated as **immutable** once published — nobody modifies it in place. To "change" the data, a writer builds a brand-new block and swaps the pointer to point at the new block. Readers always dereference the pointer once and then read the block it found.

```
        gPtr  ──────────►  [ version 1 of data ]   (immutable once published)
```

A writer who wants version 2 does **not** edit version 1. It allocates a fresh block, fills it, and swaps:

```
        gPtr  ──────────►  [ version 2 of data ]
                           [ version 1 ]  ← old, still readable by in-flight readers
```

### 2.2 Atomic pointer load and store

A pointer-sized value can be read and written **atomically** on all modern CPUs: a reader never sees a "half-updated" pointer (e.g., the high bytes of the new value and the low bytes of the old). RCU relies on this. The publish step is a single atomic store of the new pointer; the subscribe step is a single atomic load.

In Go this is `atomic.Pointer[T]` or `atomic.Value`. In Java it is `AtomicReference<T>` or a `volatile` field. In C/the kernel it is `rcu_assign_pointer` (store with a release barrier) and `rcu_dereference` (load with the matching acquire/consume semantics).

### 2.3 Memory ordering — publish with "release", subscribe with "acquire"

This is the one subtle part, and the junior takeaway is small: **the order of writes matters**. When a writer fills in the new block and *then* publishes the pointer, the CPU and compiler must not reorder those operations so that the pointer becomes visible *before* the block's contents are. The fix is a **release** store on publish and a matching **acquire** (or "consume") load on subscribe. You do not need to implement these barriers yourself — the language primitives (`atomic.Pointer.Store`, `AtomicReference.set`, `rcu_assign_pointer`) include the correct ordering. Just remember the slogan: **fill the block first, then publish the pointer; load the pointer first, then read the block.** The senior and professional documents make the memory-ordering rules exact.

---

<a name="glossary"></a>
## 3. Glossary

| Term | Definition |
|---|---|
| **RCU (Read-Copy-Update)** | A synchronization mechanism for read-mostly data: readers run lock-free in read-side critical sections; writers copy-modify-publish and defer reclamation until a grace period passes. |
| **Read-side critical section** | The region of code where a reader is "inside" RCU, holding a reference to the current version. Delimited by `rcu_read_lock()` / `rcu_read_unlock()` (which despite the name take **no lock** — they mark the section). |
| **Publish** | The writer's atomic store of the new pointer, done with **release** ordering so the new block's contents are visible before the pointer. |
| **Subscribe** | The reader's atomic load of the pointer, done with **acquire/consume** ordering so the block it points to is read consistently. |
| **Grace period** | The interval the writer waits after publishing, until every reader that *could* have been referencing the old version has finished its read-side critical section. After it elapses, the old version is safe to free. |
| **Quiescent state** | A point at which a CPU/thread is provably **not** inside any RCU read-side critical section (e.g., a context switch in the classic kernel flavor). A grace period ends when every CPU has passed through at least one quiescent state. |
| **`synchronize_rcu()`** | A blocking call that waits for one full grace period, then returns. Used for synchronous reclamation. |
| **`call_rcu(cb)`** | Registers a callback to run *after* the next grace period, without blocking the writer. Used for asynchronous deferred reclamation. |
| **Copy-on-write (COW)** | The technique of copying data before modifying it so readers of the original are never disturbed. RCU writers use COW for the data they change. |
| **Reclaim** | Freeing (or reusing) the memory of an old version, done only after its grace period. |
| **Reader** | A thread executing inside a read-side critical section. Cheap: one pointer load, no lock, no store. |
| **Writer** | A thread performing copy + publish + grace-period-wait + reclaim. Expensive relative to a reader; writers usually still serialize among themselves with a normal lock. |
| **Stale read** | A reader that subscribed just before a publish keeps using the old version for the rest of its critical section. This is *by design* and is safe. |

---

<a name="core-concepts"></a>
## 4. Core Concepts — Read, Copy, Update, Reclaim

### 4.1 The reader's job: subscribe and traverse

A reader does exactly three things:

1. **Enter** the read-side critical section (`rcu_read_lock()` — a marker, not a lock).
2. **Subscribe**: load the global pointer once into a local variable. From now on the reader uses *that local copy*. Even if a writer swaps the global pointer a nanosecond later, this reader keeps reading the version it already grabbed.
3. **Traverse / read** the data through the local pointer, then **exit** (`rcu_read_unlock()`).

```
rcu_read_lock()
p := load(gPtr)        // subscribe — one atomic load
use p.field ...        // traverse the version p points at
rcu_read_unlock()
```

No lock is acquired. No shared counter is incremented (in the classic flavor). The reader cannot block a writer and cannot be blocked by one. That is why RCU reads are "nearly free."

### 4.2 The writer's job: copy, modify, publish

A writer who wants to change the data:

1. **Copy** the current version into a fresh block (copy-on-write).
2. **Modify** the copy — the original is untouched, so concurrent readers are undisturbed.
3. **Publish**: atomically store the pointer to the new block into `gPtr` (release ordering). New readers now subscribe to the new version.
4. **Wait** for a grace period (`synchronize_rcu()` or via `call_rcu`).
5. **Reclaim**: free the old block.

```
old := load(gPtr)
new := copy(old)
modify(new)
store(gPtr, new)       // publish — release ordering
synchronize_rcu()      // wait until all pre-existing readers finish
free(old)              // reclaim — now provably safe
```

### 4.3 Why the grace period guarantees safety

The grace period is the heart of RCU. After the writer publishes `new`, two kinds of readers exist:

- **New readers**, who subscribe *after* the publish. They load `new`. They never touch `old`.
- **Old readers**, who subscribed *before* the publish. They are still using `old`. We must not free `old` while any of them is alive.

The writer cannot see the old readers directly (they announce nothing). But it can wait for a **grace period**: a span guaranteed to be long enough that **every** pre-existing reader has exited its read-side critical section. The rule that makes this work: **a reader may not hold an RCU reference across a quiescent state.** In the classic kernel flavor, a quiescent state is a context switch, a return to user space, or an idle loop — moments when a CPU is definitely not inside a read-side critical section. Once every CPU has passed through at least one quiescent state *after* the publish, no pre-existing reader can still be holding `old`. The grace period is over; `free(old)` is safe.

```mermaid
sequenceDiagram
    participant R1 as Reader 1 (old)
    participant W as Writer
    participant R2 as Reader 2 (new)
    R1->>R1: rcu_read_lock(); p=load(gPtr)=old
    W->>W: new=copy(old); modify(new)
    W->>W: store(gPtr,new)  (publish)
    R2->>R2: rcu_read_lock(); p=load(gPtr)=new
    Note over R1: still reading old — safe
    W->>W: synchronize_rcu() begins (grace period)
    R1->>R1: rcu_read_unlock()  (quiescent)
    R2->>R2: rcu_read_unlock()
    Note over W: every pre-existing reader has finished
    W->>W: free(old)  (reclaim)
```

### 4.4 The minimal COW example

Picture a global config pointer. The config holds two fields. A writer wants to flip a feature flag.

```
Start:  gCfg ──► { flagA: true,  flagB: false }   (version 1)

Reader X enters, subscribes: pX = gCfg  (sees version 1)

Writer:
  new = copy(*gCfg)            // { flagA:true, flagB:false }
  new.flagB = true            // modify the copy
  gCfg = &new                 // publish version 2
  // now: gCfg ──► { flagA:true, flagB:true }
  synchronize_rcu()           // wait for X (and any other v1 reader) to finish
  free(version 1)

Reader X (still in its section): reads pX → sees flagB:false  (the version it subscribed to)
Reader Y enters now: pY = gCfg → sees version 2 (flagB:true)
```

Reader X observing the *old* value of `flagB` is not a bug. It subscribed to version 1 and uses version 1 consistently for the whole critical section. The next time X enters a fresh read-side section, it will subscribe again and see version 2. The only guarantee RCU makes is: each reader sees a **single, consistent, immutable version** for the duration of one critical section, and no reader ever sees freed memory.

---

<a name="big-o-summary"></a>
## 5. Big-O Summary

| Operation | Time | Notes |
|---|---|---|
| Reader: enter + subscribe + exit | **O(1)**, ~constant, no atomic store on fast path | One pointer load; in classic flavor `rcu_read_lock/unlock` compile to nearly nothing |
| Reader: traverse a structure of size k | O(k) for the traversal itself | The RCU overhead is O(1); the data-structure cost is separate |
| Writer: copy | O(size of copied data) | COW cost; for a whole array/map this is O(n) |
| Writer: publish | O(1) | One atomic pointer store |
| Writer: grace-period wait (`synchronize_rcu`) | latency = up to one grace period (microseconds to milliseconds); CPU cost amortized | Blocking; `call_rcu` makes it asynchronous |
| Writer: reclaim | O(size freed) | Deferred until after the grace period |
| Memory overhead | up to one extra copy live during a grace period | Old + new versions coexist until reclamation |

The headline: **reader cost is O(1) and contention-free**; the price is paid by writers (copy + grace period) and by transient extra memory (old and new versions coexist briefly).

---

<a name="analogies"></a>
## 6. Real-World Analogies

### 6.1 The library book and the photocopier

Readers in a library are reading the current edition of a reference book. The librarian wants to correct a page. Instead of ripping the page out while people read it (which would crash a reader mid-sentence), the librarian **photocopies** the book, fixes the page on the copy, and places the corrected edition on the "current" shelf. People who started reading the old edition finish their session with it; new visitors pick up the corrected edition. Only after the librarian is sure **nobody is still reading the old edition** does she recycle it. The "wait until nobody is reading the old one" is the grace period. The photocopy is copy-on-write. The "current shelf" is the published pointer.

### 6.2 Swapping a billboard

A roadside billboard shows an ad. To change it, the crew prints a whole new poster, then in one quick motion swaps the visible panel. Drivers who already glanced at the old ad keep that image in their heads; drivers who look after the swap see the new ad. Nobody ever sees a half-pasted poster, because the swap is atomic (one panel flip). The old poster is thrown away only after the swap — and you would wait a moment to be sure no photographer is still mid-shot of the old one.

### 6.3 A restaurant menu reprint

The kitchen reprints the menu when prices change. Servers carrying the old menu finish taking their current table's order with it (consistent for that table). New tables get the new menu. The host swaps the stack of menus at the door — one action. Old menus are shredded only after the last server holding one has returned it.

### 6.4 Editing a shared Google Doc by versioned snapshot (conceptual)

Imagine a document system where each "reader" gets an immutable snapshot at the moment they open it, and an editor produces a new snapshot rather than mutating the open one. Readers see a stable view; the editor's change becomes visible to *future* opens. The old snapshot is garbage-collected once no open session references it. That garbage-collection-after-no-references is exactly grace-period-based reclamation.

---

<a name="pros-and-cons"></a>
## 7. Pros and Cons vs Locking

### Pros of RCU

- **Near-zero read cost.** No lock, no atomic store, no contention on the read path. Reads scale linearly with cores.
- **Readers never block writers and writers never block readers.** A writer can publish while a thousand readers traverse; nobody waits.
- **No reader-side cache-line ping-pong.** Readers don't write shared state, so the data's cache lines stay shared (read-only) across cores.
- **Deterministic reader latency.** A reader can't be delayed by a writer holding a lock.
- **Great for read-mostly structures.** Routing tables, config, module lists, caches — the kernel's bread and butter.

### Cons of RCU

- **Writers are more expensive.** Copy-on-write allocates and copies; the grace period adds latency before memory can be reclaimed.
- **Memory overhead.** Old and new versions coexist during the grace period; bursty writes can pile up several versions awaiting reclamation.
- **Readers can be stale.** A reader sees the version it subscribed to, not necessarily the absolute latest. Acceptable for many cases, wrong for others.
- **Not for write-heavy data.** If writes dominate, the copy + grace-period cost dwarfs any read savings; use a lock.
- **Harder to reason about.** Memory ordering (publish/subscribe), grace-period correctness, and "no reference across a quiescent state" are subtle. Easy to introduce use-after-free if reclamation is done too early.
- **No multi-pointer atomicity for free.** RCU publishes one pointer atomically. Coordinated updates to several pointers need extra design (often a single top-level pointer to an immutable aggregate).

### When to use which

| Need | Use |
|---|---|
| Read-mostly, occasional writes, stale-for-one-op reads OK | **RCU** |
| Balanced read/write, simple correctness | Mutex |
| Many readers but readers must register, moderate writes | Reader-writer lock |
| Lock-free single-pointer update with reclamation per-pointer | Hazard pointers (see topic 20) or RCU |
| Read a consistent snapshot of a small struct, retry on writer | Seqlock |
| Write-heavy shared structure | Fine-grained locks or sharding |

---

<a name="walkthrough"></a>
## 8. Step-by-Step Walkthrough — Updating a Config Pointer

We maintain a global pointer `gCfg` to an immutable `Config{MaxConn, Banner}`. Readers read fields; a writer changes `MaxConn` from 100 to 200.

### 8.1 Initial state

```
gCfg ──► Config{ MaxConn:100, Banner:"hello" }   (version V1)
```

### 8.2 Reader A subscribes

```
Reader A: rcu_read_lock()
          pA = load(gCfg)          // pA → V1
          read pA.MaxConn → 100
          (still inside the section, about to read pA.Banner)
```

### 8.3 Writer copies and publishes

```
Writer:   old = load(gCfg)         // old → V1
          new = Config{ MaxConn:100, Banner:"hello" }  // copy of V1
          new.MaxConn = 200        // modify the copy → V2
          store(gCfg, &new)        // PUBLISH (release): gCfg → V2
```

State now:

```
gCfg ──► Config{ MaxConn:200, Banner:"hello" }   (V2)
V1 still exists in memory; Reader A's pA still points at it.
```

### 8.4 Reader B subscribes after publish

```
Reader B: rcu_read_lock()
          pB = load(gCfg)          // pB → V2 (subscribed to new version)
          read pB.MaxConn → 200
          rcu_read_unlock()
```

Reader B sees 200. Reader A, still in its section, will read `pA.Banner` from V1 — consistent with the `MaxConn:100` it already read. A *single* reader never sees a torn mix of V1 and V2.

### 8.5 Writer waits for the grace period

```
Writer:   synchronize_rcu()        // block until every pre-existing reader (incl. A) exits
```

The grace period cannot end until Reader A calls `rcu_read_unlock()` (a quiescent state for A's CPU). Suppose A finishes:

```
Reader A: read pA.Banner → "hello"
          rcu_read_unlock()        // A is now quiescent
```

### 8.6 Reclaim

```
Writer:   (grace period ends — no reader references V1)
          free(V1)                 // safe; no use-after-free possible
```

Total: readers did one pointer load each and never blocked. The writer did one copy, one atomic store, one grace-period wait, one free. The config was always consistent for every reader, and V1 was freed only when provably unreferenced.

---

<a name="code-examples"></a>
## 9. Code Examples — Go, Java, Python

We model the **RCU pattern** in each language. The key mechanic is a **single atomic pointer to an immutable snapshot**, swapped by writers (copy-on-write) and read lock-free by readers. Go and the JVM are **garbage-collected**, so the GC plays the role of the grace period and reclaim step automatically — we will be explicit about where the grace period "lives." A real C/kernel implementation must manage the grace period and reclamation by hand (see `senior.md`).

### 9.1 Go — `atomic.Pointer` pointer-swap

```go
package rcu

import (
	"sync"
	"sync/atomic"
)

// Config is treated as IMMUTABLE once published. Writers never mutate a
// published Config; they build a new one and swap the pointer.
type Config struct {
	MaxConn int
	Banner  string
}

// RCUConfig holds the current immutable Config behind an atomic pointer.
type RCUConfig struct {
	ptr     atomic.Pointer[Config] // the published pointer (subscribe/publish here)
	writeMu sync.Mutex             // serializes writers among themselves
}

func New(initial *Config) *RCUConfig {
	r := &RCUConfig{}
	r.ptr.Store(initial) // publish version 1
	return r
}

// Read is the reader fast path: subscribe (one atomic load) and use the
// snapshot. No lock, no store. The returned *Config is immutable.
func (r *RCUConfig) Read() *Config {
	return r.ptr.Load() // subscribe — release/acquire handled by atomic.Pointer
}

// Update is the writer: copy-on-write, modify the copy, publish the swap.
// In Go the garbage collector reclaims the old version once no reader holds
// a reference — that is the grace period, performed automatically.
func (r *RCUConfig) Update(mutate func(c *Config)) {
	r.writeMu.Lock()
	defer r.writeMu.Unlock()

	old := r.ptr.Load()
	cp := *old   // COPY the current version (copy-on-write)
	mutate(&cp)  // MODIFY the copy; the old version is untouched
	r.ptr.Store(&cp) // PUBLISH the new version (atomic swap, release ordering)
	// No explicit free: Go's GC reclaims `old` after the last reader drops it.
}
```

Usage:

```go
rc := New(&Config{MaxConn: 100, Banner: "hello"})

// Reader (cheap, lock-free):
cfg := rc.Read()
_ = cfg.MaxConn

// Writer (copy-modify-publish):
rc.Update(func(c *Config) { c.MaxConn = 200 })
```

The reader never locks. The writer serializes only against *other writers* (via `writeMu`), not against readers. The crucial invariant: a published `*Config` is never mutated, so a reader holding it is always safe.

### 9.2 Java — `AtomicReference` + copy-on-write

```java
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

// Immutable snapshot: all fields final; "modifying" means producing a new one.
final class Config {
    final int maxConn;
    final String banner;
    Config(int maxConn, String banner) {
        this.maxConn = maxConn;
        this.banner = banner;
    }
    Config copy() { return new Config(this.maxConn, this.banner); }
}

public final class RcuConfig {
    // The published pointer. AtomicReference gives us atomic publish/subscribe
    // with the required release/acquire memory ordering.
    private final AtomicReference<Config> ref;
    private final Object writeLock = new Object(); // serializes writers

    public RcuConfig(Config initial) {
        this.ref = new AtomicReference<>(initial); // publish v1
    }

    /** Reader fast path: subscribe with one volatile-style read. No lock. */
    public Config read() {
        return ref.get(); // returns an immutable snapshot
    }

    /** Writer: copy-on-write + atomic publish. The JVM GC is the grace period. */
    public void update(Consumer<Config> mutate) {
        synchronized (writeLock) {
            Config old = ref.get();
            // Build a NEW config from the old one. Because Config is immutable,
            // we copy the fields and apply changes to a mutable builder-like copy.
            MutableConfig draft = new MutableConfig(old);
            mutate.accept(draft.toImmutableView()); // (illustrative; see note)
            ref.set(draft.freeze());                // PUBLISH the swap
            // GC reclaims `old` once no reader references it = grace period.
        }
    }
}
```

A cleaner idiomatic Java form replaces the `mutate` callback with explicit copy-and-set methods, since `Config` is immutable:

```java
public void setMaxConn(int newMax) {
    synchronized (writeLock) {
        Config old = ref.get();
        Config next = new Config(newMax, old.banner); // COPY + modify
        ref.set(next);                                // PUBLISH
    }
}
```

Readers call `read()` with zero locking; writers serialize on `writeLock` and publish via `ref.set`. The garbage collector reclaims the superseded `Config` after the last reader stops referencing it — exactly an RCU grace period, delivered for free by the runtime.

### 9.3 Python — note on the GIL and atomic rebinding

Python's reference implementation (CPython) has a **Global Interpreter Lock (GIL)** that serializes bytecode execution, so true parallel readers/writers across threads do not run simultaneously the way they do in Go/Java. However, the **RCU *pattern*** still applies and is useful: rebinding a single attribute or module-level name is atomic at the bytecode level, and readers that grab a reference to an immutable snapshot are safe even if a writer rebinds the name afterward.

```python
import threading
from dataclasses import dataclass, replace

@dataclass(frozen=True)        # frozen => immutable snapshot
class Config:
    max_conn: int
    banner: str

class RcuConfig:
    def __init__(self, initial: Config) -> None:
        self._cfg = initial    # the "published pointer" (a name binding)
        self._write_lock = threading.Lock()  # serializes writers

    def read(self) -> Config:
        # Subscribe: grab the current snapshot. Attribute load is atomic enough
        # under the GIL; the returned Config is immutable, so it is safe to use.
        return self._cfg

    def update(self, **changes) -> None:
        # Copy-on-write: dataclasses.replace builds a NEW frozen Config.
        with self._write_lock:
            old = self._cfg
            new = replace(old, **changes)  # COPY + modify
            self._cfg = new                # PUBLISH (atomic name rebinding)
            # Old Config is reclaimed by CPython refcounting once no reader holds it.
```

Usage:

```python
rc = RcuConfig(Config(max_conn=100, banner="hello"))
cfg = rc.read()          # reader: snapshot
rc.update(max_conn=200)  # writer: copy-modify-publish
# cfg still sees max_conn=100 (its subscribed snapshot); a fresh read() sees 200.
```

**Note:** because of the GIL, Python does not get RCU's multicore read-scaling benefit. Use this pattern for *correctness and clarity* (immutable snapshots, no reader locks), not raw parallelism. For genuine parallel RCU you want Go, Java, C with liburcu, or the kernel.

---

<a name="patterns"></a>
## 10. Coding Patterns — Publish, Subscribe, Swap

The whole mechanism reduces to four idioms. Memorize them.

```
SUBSCRIBE (reader):
    p = atomic_load(gPtr)        // acquire/consume ordering
    use *p ...                   // p is immutable; safe for the whole section

PUBLISH (writer):
    atomic_store(gPtr, newPtr)   // release ordering: fill newPtr BEFORE this store

COPY-ON-WRITE (writer):
    new = copy(*old); modify(new)  // never mutate a published version in place

RECLAIM (writer):
    wait_grace_period(); free(old) // synchronize_rcu() / call_rcu / GC
```

Two slogans capture the ordering rules:

- **Writer:** *fill the block, then publish the pointer.* (release)
- **Reader:** *load the pointer, then read the block.* (acquire/consume)

And the cardinal rule of reclamation: **never free a version until a grace period has elapsed since it was unpublished.**

---

<a name="errors"></a>
## 11. Error Handling — Use-After-Free and the Grace Period

### 11.1 Freeing too early (use-after-free)

The classic RCU bug:

```
store(gPtr, new)   // publish
free(old)          // BUG: a reader subscribed before the publish may still hold old
```

A pre-existing reader still dereferences `old` → **use-after-free**, a memory-corruption / crash bug. The fix is the grace period:

```
store(gPtr, new)
synchronize_rcu()  // wait until all pre-existing readers finish
free(old)          // now safe
```

In garbage-collected languages (Go, Java, Python) the runtime *is* the grace period — you do not call `free` and the GC won't reclaim `old` while a reader still references it. This is why the RCU pattern is so natural in managed languages.

### 11.2 Mutating a published version

```
p = load(gPtr)
p.field = x        // BUG: a published version is shared and immutable
```

This races every concurrent reader of `p`. **Never** mutate after publish. Always copy first.

### 11.3 Holding a reference across the section boundary

```
rcu_read_lock()
p = load(gPtr)
rcu_read_unlock()
use *p             // BUG: outside the section, the grace period may have freed p
```

A reference obtained inside a read-side section is only valid *inside* it (in the unmanaged case). Using it after `rcu_read_unlock()` can hit freed memory. Keep all dereferences inside the section, or copy out the scalar values you need.

### 11.4 Forgetting writer-vs-writer serialization

RCU protects readers; it does **not** serialize concurrent writers. Two writers doing copy-modify-publish simultaneously can lose an update (one's publish overwrites the other's). Serialize writers with a normal lock, or use a CAS loop (see topic 15, `15-cas-atomic-primitives`).

### 11.5 Missing the release/acquire ordering

Using a plain (non-atomic, non-volatile) pointer for publish/subscribe lets the CPU/compiler reorder the block-fill after the pointer store, so a reader can load the new pointer but see a half-initialized block. Always publish/subscribe through an atomic with the right ordering.

---

<a name="performance-tips"></a>
## 12. Performance Tips

1. **Keep read-side sections short.** A grace period can't end until all readers exit; long sections delay reclamation and let old versions pile up.
2. **Don't block or sleep inside a classic read-side section.** In the kernel's classic flavor, that would stall the grace period indefinitely. (Preemptible/SRCU flavors relax this — see `senior.md`.)
3. **Batch writes.** Each write costs a copy + grace period. Coalesce many small changes into one publish when possible.
4. **Use `call_rcu` instead of `synchronize_rcu`** when the writer should not block; the callback frees the old version asynchronously after the next grace period (kernel/liburcu).
5. **Copy only what changes.** For a large structure, share the unchanged sub-parts and copy only the path to the modified node (structural sharing), so the copy is O(log n) instead of O(n).
6. **Avoid RCU for write-heavy data.** The copy + grace-period overhead dominates; a lock or sharding is better.
7. **In GC languages, beware allocation churn.** Frequent writes create garbage; ensure the GC can keep up, and reuse immutable sub-objects.

---

<a name="best-practices"></a>
## 13. Best Practices

- **Treat every published version as immutable.** This single rule prevents the majority of RCU bugs.
- **Publish with release, subscribe with acquire/consume.** Use the language's atomic pointer primitive; never roll your own with a plain pointer.
- **Serialize writers** with a mutex or CAS loop; RCU does not do this for you.
- **Defer reclamation** behind a grace period (`synchronize_rcu`, `call_rcu`, or GC). Never free immediately after publish.
- **Keep read-side sections short and non-blocking** (classic flavor).
- **Document the staleness contract**: callers must accept that a snapshot may be one update behind.
- **Prefer a single top-level pointer** to an immutable aggregate so one atomic store publishes a coordinated change.
- **Test with a reader that loops reading while a writer hammers updates**, under a sanitizer (ASan/race detector) to catch use-after-free and torn reads.

---

<a name="edge-cases"></a>
## 14. Edge Cases

| Case | Behavior |
|---|---|
| Reader subscribes exactly as writer publishes | Reader sees either old or new — both are complete, consistent versions. Never a torn mix. |
| Multiple writers race | Without a writer lock, updates can be lost. Serialize writers. |
| No readers active when writer publishes | Grace period is still required in general, but may end almost immediately (every CPU already quiescent). |
| Burst of writes during a long read | Several old versions accumulate awaiting reclamation; memory spikes until the grace period(s) pass. |
| Reader holds reference very long | Delays the grace period; in the kernel this can stall reclamation and is flagged ("RCU stall"). |
| Empty / null current version | A reader must handle `load(gPtr) == nil`; publish a sentinel empty version rather than leaving null if possible. |
| Single-threaded program | RCU degenerates to "copy, swap, free immediately" — correct but unnecessary; just mutate in place. |

---

<a name="common-mistakes"></a>
## 15. Common Mistakes

1. **Freeing the old version immediately after publish.** Use-after-free. Wait a grace period.
2. **Mutating a published version in place.** Races readers. Copy first (COW).
3. **Using a plain pointer for publish/subscribe.** Missing memory ordering → readers see half-built data.
4. **Letting two writers update concurrently without a lock.** Lost updates.
5. **Using a reference after `rcu_read_unlock()`** (unmanaged case). Use-after-free.
6. **Blocking/sleeping inside a classic read-side section.** Stalls grace periods.
7. **Applying RCU to write-heavy data.** The copy + grace-period cost makes it slower than a lock.
8. **Assuming readers see the latest write instantly.** They see their subscribed snapshot; staleness is by design.
9. **Copying the entire structure when only a leaf changed.** Wasteful; use structural sharing.
10. **Forgetting that one atomic store publishes only one pointer.** Multi-pointer atomic updates need a single aggregate pointer.

---

<a name="cheat-sheet"></a>
## 16. Cheat Sheet

```
READER (cheap, lock-free)
    rcu_read_lock()                 # marker, not a lock
    p = atomic_load(gPtr)           # SUBSCRIBE (acquire)
    use *p ...                      # p is an immutable, consistent version
    rcu_read_unlock()               # exit; never use p afterward (unmanaged)

WRITER (copy-modify-publish-reclaim)
    lock(writeMu)                   # serialize writers
    old = atomic_load(gPtr)
    new = copy(*old); modify(new)   # COPY-ON-WRITE
    atomic_store(gPtr, new)         # PUBLISH (release): fill new BEFORE this
    unlock(writeMu)
    synchronize_rcu()               # GRACE PERIOD: wait for pre-existing readers
    free(old)                       # RECLAIM (or let GC do it)

RULES
    publish = release   |   subscribe = acquire/consume
    never mutate a published version
    never free before a grace period
    serialize writers yourself

COMPLEXITY
    reader: O(1) overhead, no atomic store on fast path
    writer: O(copy) + grace-period latency
    memory: old + new coexist during the grace period
```

---

<a name="animation"></a>
## 17. Visual Animation Reference

See `animation.html` in this folder. It shows a global pointer to the **current version** of a small list/config, with several **readers** traversing the version they subscribed to. When you trigger an **update**, the animation shows the writer **copying** the structure, **modifying** the copy, and **atomically swapping** the pointer (publish). Readers that subscribed before the swap keep traversing the **old** version (highlighted), while new readers pick up the **new** version. Then a **grace period** timer elapses; once every pre-existing reader has finished, the old version is **reclaimed** (freed). An info panel, a state table, and a log narrate each step, making the publish → grace-period → reclaim rhythm visible.

Watching a reader safely finish on the old version *while* the new version is already live is the fastest way to internalize why RCU reads are cheap and why the grace period is mandatory.

---

<a name="summary"></a>
## 18. Summary

- **RCU (Read-Copy-Update)** synchronizes read-mostly data with **near-zero read-side cost**: readers do one atomic pointer load, no lock, no shared store.
- Writers follow **read-copy-update**: copy the data, modify the copy, **publish** by atomically swapping a single pointer (release ordering), then **wait a grace period** and **reclaim** the old version.
- A **grace period** is the wait until every pre-existing reader has left its read-side critical section (passed a **quiescent state**). It guarantees no reader sees freed memory.
- The reader/writer split: **readers are cheap and never block; writers pay** with copy cost, grace-period latency, and transient extra memory (old + new versions coexist).
- **Publish = release, subscribe = acquire/consume.** Fill the block before publishing the pointer; load the pointer before reading the block.
- In **garbage-collected languages (Go, Java, Python)** the runtime provides the grace period and reclamation automatically — making the RCU *pattern* (atomic pointer to an immutable snapshot, COW writers) easy and safe.
- Use RCU for **read-mostly** structures (config, routing tables, lists/maps); avoid it for **write-heavy** data. It is a cornerstone of the Linux kernel.

**Next step:** continue with [`middle.md`](./middle.md) to learn *why* readers are cheap in depth — grace periods and quiescent states, the publish (release) / subscribe (acquire) protocol, and a head-to-head comparison with reader-writer locks.

---

<a name="further-reading"></a>
## 19. Further Reading

- **McKenney, P. E.** *What is RCU, Fundamentally?* (LWN.net three-part series). The canonical gentle introduction.
- **McKenney, P. E.** *Is Parallel Programming Hard, And, If So, What Can You Do About It?* — the "Deferred Processing" chapter is the definitive RCU treatment (free PDF).
- **Linux kernel documentation** — `Documentation/RCU/` (whatisRCU, rcu, checklist). Authoritative and practical.
- **liburcu** (Userspace RCU library, Desnoyers et al.) — docs and API for RCU outside the kernel.
- **Desnoyers, M., McKenney, P. E., et al.** *User-Level Implementations of Read-Copy Update*, IEEE TPDS 2012. The userspace-RCU paper.
- Cross-links in this roadmap: `15-cas-atomic-primitives` (the atomic store underneath publish), `18-concurrent-hash-map` (RCU-protected maps), `20-hazard-pointers` (the alternative reclamation scheme RCU is most often compared with).
- Continue with `middle.md` for grace periods, quiescent states, and the rwlock comparison.
