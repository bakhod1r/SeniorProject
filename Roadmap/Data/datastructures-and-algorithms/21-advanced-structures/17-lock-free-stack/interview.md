# Treiber Lock-Free Stack — Interview Preparation

> **Coverage:** 48 tiered questions (Junior → Middle → Senior → Professional) with answer focus, followed by a full coding challenge — implement a Treiber stack `push`/`pop` in Go, Java, and Python.

This guide assumes you have read [junior.md](./junior.md), [middle.md](./middle.md), [senior.md](./senior.md), and [professional.md](./professional.md). Each question lists the **answer focus** an interviewer is listening for. Treat them as oral-exam prompts: say the keyword, then justify it.

---

## Table of Contents

1. [Junior Questions (1–12)](#junior)
2. [Middle Questions (13–24)](#middle)
3. [Senior Questions (25–36)](#senior)
4. [Professional Questions (37–48)](#professional)
5. [Coding Challenge — Treiber Stack in 3 Languages](#challenge)
6. [Follow-up Extensions](#followups)

---

<a name="junior"></a>
## 1. Junior Questions (1–12)

| # | Question | Expected Answer Focus |
|---|---|---|
| 1 | What is a Treiber stack? | A lock-free LIFO stack: singly linked list + atomic `head` pointer, modified by CAS retry loops (Treiber, 1986). |
| 2 | What is the data representation? | Heap nodes `{value, next}` linked top-to-bottom; one **atomic** `head` pointer (nil when empty). No size counter, no array. |
| 3 | What does CAS do? | `CAS(addr, expected, new)` atomically sets `*addr=new` iff `*addr==expected`; returns success/failure as one indivisible instruction. |
| 4 | Walk through `push`. | Alloc node; loop: read `old=head`; set `new.next=old`; `CAS(head, old, new)`; retry on failure. |
| 5 | Walk through `pop`. | Loop: read `old=head`; if nil return empty; `next=old.next`; `CAS(head, old, next)`; return `old.value`; retry on failure. |
| 6 | Why a loop instead of a single write? | Concurrent ops race; a plain write loses updates. CAS publishes only if nothing changed; loser retries with fresh `head`. |
| 7 | What is the time complexity per op? | O(1) on the uncontended path (one CAS); amortized O(1), but no worst-case bound on retries. |
| 8 | Why is it called "lock-free"? | No mutex; a stalled thread never blocks others. The *system* always makes progress. |
| 9 | What happens on an empty pop? | Detect `head==nil` inside the loop and return a "no value" signal (`ok=false`/`null`/`None`), never dereference nil. |
| 10 | Why allocate the push node before the loop? | Allocation is the costly part; on retry only re-link `next`, don't re-allocate. |
| 11 | Treiber stack vs a mutex-guarded stack — one-line difference? | Treiber swaps the lock for an atomic CAS that retries; lock-free vs blocking. |
| 12 | Where is `head.next` read in `pop` — before or after the CAS? | **Before** the CAS, into a local. Reading after the CAS risks use-after-unlink/free and races. |

---

<a name="middle"></a>
## 2. Middle Questions (13–24)

| # | Question | Expected Answer Focus |
|---|---|---|
| 13 | What is the ABA problem? | `head` goes A→B→A; a stale CAS sees the same pointer bits and succeeds wrongly, though the stack changed underneath. |
| 14 | Walk an ABA interleaving on `pop`. | T1 reads old=A, next=B, stalls; T2 pops A,B, frees them, pushes a recycled node at A's address; T1's CAS(A,B) wrongly succeeds, installing freed B. |
| 15 | Why doesn't ABA bite Go/Java code? | A tracing GC won't recycle a node while a thread holds a reference, so the address can't return to A while observed. |
| 16 | When *does* ABA bite a GC language? | When you deliberately recycle nodes (object pool/free list) to dodge GC pressure — reuse re-opens ABA. |
| 17 | How do tagged pointers fix ABA? | CAS the pair `(ptr, tag)`; bump `tag` on every success. A returned pointer carries a newer tag, so the stale CAS fails. |
| 18 | What hardware support do tagged pointers need? | Double-width CAS (x86 `CMPXCHG16B`), or pointer-packing the tag into unused high bits + plain 64-bit CAS. |
| 19 | What is the residual flaw of tagged pointers? | Tag **wraparound** — a small (e.g., 16-bit) tag can return to a prior value; 64-bit tags make this astronomically unlikely. |
| 20 | Do tagged pointers solve safe `free`? | No — they stop a *stale CAS*, not a thread that already loaded a pointer and is about to dereference a freed node. Need reclamation too. |
| 21 | Why doesn't the Treiber stack scale? | Single `head` cache line; under many cores it ping-pongs (MESI invalidations) and retries storm — throughput can fall as cores rise. |
| 22 | What is exponential backoff and why use it? | After a failed CAS, wait a randomized, doubling (capped) interval; thins collisions, raises aggregate throughput under contention. |
| 23 | Treiber stack vs MS-queue — when each? | Stack = LIFO (pools, free lists). MS-queue = FIFO (producer/consumer). Choose by required ordering. |
| 24 | Is lock-free always faster than a lock? | No. Lock-free means *progress-guaranteed*; under heavy contention a Treiber stack can be slower than a good mutex. |

---

<a name="senior"></a>
## 3. Senior Questions (25–36)

| # | Question | Expected Answer Focus |
|---|---|---|
| 25 | Where are Treiber stacks used in production? | Object/connection pools, allocator free lists, per-thread caches, work-stealing deques, retired-node lists — the lock-free **release** primitive. |
| 26 | Why LIFO for a free list? | The most-recently-freed object is hottest in cache; reusing it (LIFO) maximizes locality. |
| 27 | What is the elimination-backoff stack? | Under contention, a `push` and `pop` rendezvous in an elimination array and exchange a value directly — neither touches `head`. |
| 28 | Why does elimination scale? | High contention means many push/pop pairs in flight; they cancel off the hot path, so contention *fuels* throughput instead of capping it. |
| 29 | Is the elimination stack still linearizable? | Yes — a push-then-immediate-pop is a valid stack history (net no-op on state), so the pair linearizes adjacently. |
| 30 | How do you size the elimination array? | ~proportional to contending threads; too small re-creates a hotspot, too large means partners rarely meet; often adaptive. |
| 31 | What is the safe-memory-reclamation problem? | When can you `free` a popped node, given another thread may have loaded its pointer and be about to dereference it? |
| 32 | Explain hazard pointers. | Each thread publishes pointers it's dereferencing into hazard slots; before freeing, scan all slots — defer if any thread hazards the node. |
| 33 | Explain epoch/RCU reclamation. | Threads run in epochs; a retired node is freed only once every thread advances past its retirement epoch. Cheap reads. |
| 34 | Hazard pointers vs epochs — trade-offs? | HP: bounded memory, robust to stalls, costlier reads. Epoch/RCU: very cheap reads, but a stalled thread blocks all reclamation (unbounded limbo). |
| 35 | Do tags replace reclamation? | No — tags handle ABA, reclamation handles use-after-free. Often you need both; hazard pointers happen to solve both. |
| 36 | What is a work-stealing deque and how does it relate? | Per-worker deque; owner uses the LIFO (Treiber-shaped) end, thieves steal FIFO from the far end (Chase–Lev), splitting contention. |

---

<a name="professional"></a>
## 4. Professional Questions (37–48)

| # | Question | Expected Answer Focus |
|---|---|---|
| 37 | State linearizability. | Every op appears to take effect instantaneously at one point between invocation and response, yielding a legal sequential history that respects real-time order. |
| 38 | Give the linearization points for the Treiber stack. | push: successful `head` CAS; non-empty pop: successful `head` CAS; empty pop: the read returning nil. |
| 39 | Prove the Treiber stack is lock-free. | If all CASes fail forever, each failure implies some other CAS *succeeded* (head changed), which completes an op — contradiction. So some op always completes. |
| 40 | Prove it is **not** wait-free. | An adversary can make one thread's CAS fail every time (another thread wins just before it) — infinite steps, never completes. |
| 41 | Formally, what premise does ABA break? | That representation-equality (same pointer bits at the CAS) implies abstract-state-equality. Unsafe reuse severs this. |
| 42 | Why do tagged pointers restore the proof? | A strictly monotonic tag means a successful CAS implies no successful update happened in between — restoring the `pop` proof's premise. |
| 43 | Are bounded tags provably correct? | Only practically — finite tags wrap after 2^w updates; 64-bit makes it negligible, but it's not unconditional like unbounded tags/hazard pointers. |
| 44 | How do you linearize an eliminated push/pop pair? | Adjacently at the rendezvous instant: push immediately before pop is a net no-op on the stack and respects both ops' intervals. |
| 45 | What is the consensus number of CAS, and why does it matter? | ∞ — CAS solves wait-free consensus for any thread count, so a wait-free stack is *possible*; Treiber is lock-free by choice, not limitation. |
| 46 | What memory-ordering does publication need? | The push's `next` write must happen-before publication: a **release** CAS / acquire load pair, and a `final` value field for safe init visibility (Java). |
| 47 | Why does hazard-pointer publication need a store-load barrier? | Without it, the re-validation read of `head` can reorder before the hazard-slot store, making protection unsound. |
| 48 | Place the Treiber stack in the progress hierarchy. | wait-free ⊃ **lock-free (Treiber)** ⊃ obstruction-free ⊃ blocking; strictly lock-free, witnessed by the not-wait-free adversary. |

---

<a name="challenge"></a>
## 5. Coding Challenge — Treiber Stack in 3 Languages

> **Task.** Implement a thread-safe lock-free Treiber stack supporting `push(v)` and `pop()` (returning a value + an "ok" flag for empty). Demonstrate correctness under concurrent access: spawn `T` threads each doing `N` pushes then `N` pops, and assert the multiset of all popped values equals the multiset of all pushed values (no lost, no duplicated, no resurrected values).
>
> **Constraints.** Lock-free `push`/`pop` (CAS loop, no mutex on the hot path). O(1) amortized per op. Handle empty pop. Rely on the runtime GC for reclamation.

#### Go

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

type node[T any] struct {
	value T
	next  *node[T]
}

type TreiberStack[T any] struct {
	head atomic.Pointer[node[T]]
}

func (s *TreiberStack[T]) Push(v T) {
	n := &node[T]{value: v}
	for {
		old := s.head.Load()
		n.next = old
		if s.head.CompareAndSwap(old, n) {
			return
		}
	}
}

func (s *TreiberStack[T]) Pop() (v T, ok bool) {
	for {
		old := s.head.Load()
		if old == nil {
			return v, false
		}
		if s.head.CompareAndSwap(old, old.next) {
			return old.value, true
		}
	}
}

func main() {
	const T, N = 8, 10000
	s := &TreiberStack[int]{}

	// Phase 1: concurrent pushes. Each thread pushes its tagged ids.
	var wg sync.WaitGroup
	for t := 0; t < T; t++ {
		wg.Add(1)
		go func(t int) {
			defer wg.Done()
			for i := 0; i < N; i++ {
				s.Push(t*N + i)
			}
		}(t)
	}
	wg.Wait()

	// Phase 2: concurrent pops; collect counts.
	var mu sync.Mutex
	seen := make(map[int]int)
	for t := 0; t < T; t++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				v, ok := s.Pop()
				if !ok {
					return
				}
				mu.Lock()
				seen[v]++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	// Verify: every pushed value popped exactly once.
	ok := len(seen) == T*N
	for _, c := range seen {
		if c != 1 {
			ok = false
		}
	}
	fmt.Printf("popped %d distinct values, integrity=%v\n", len(seen), ok)
}
```

#### Java

```java
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

public class TreiberStack<T> {

    private static final class Node<T> {
        final T value;
        Node<T> next;
        Node(T v) { value = v; }
    }

    private final AtomicReference<Node<T>> head = new AtomicReference<>();

    public void push(T v) {
        Node<T> n = new Node<>(v), old;
        do {
            old = head.get();
            n.next = old;
        } while (!head.compareAndSet(old, n));
    }

    /** Returns null when empty. */
    public T pop() {
        Node<T> old, next;
        do {
            old = head.get();
            if (old == null) return null;
            next = old.next;
        } while (!head.compareAndSet(old, next));
        return old.value;
    }

    public static void main(String[] args) throws InterruptedException {
        final int T = 8, N = 10_000;
        TreiberStack<Integer> s = new TreiberStack<>();

        Thread[] pushers = new Thread[T];
        for (int t = 0; t < T; t++) {
            final int tt = t;
            pushers[t] = new Thread(() -> {
                for (int i = 0; i < N; i++) s.push(tt * N + i);
            });
            pushers[t].start();
        }
        for (Thread p : pushers) p.join();

        ConcurrentHashMap<Integer, Integer> seen = new ConcurrentHashMap<>();
        Thread[] poppers = new Thread[T];
        for (int t = 0; t < T; t++) {
            poppers[t] = new Thread(() -> {
                Integer v;
                while ((v = s.pop()) != null) seen.merge(v, 1, Integer::sum);
            });
            poppers[t].start();
        }
        for (Thread p : poppers) p.join();

        AtomicInteger bad = new AtomicInteger();
        seen.forEach((k, c) -> { if (c != 1) bad.incrementAndGet(); });
        boolean ok = seen.size() == T * N && bad.get() == 0;
        System.out.printf("popped %d distinct values, integrity=%b%n", seen.size(), ok);
    }
}
```

#### Python

```python
# CPython's GIL serializes bytecode and exposes no hardware CAS, so a true
# lock-free stack gives no parallelism here. We provide a conceptual CAS
# (simulated with a lock) to mirror the algorithm, plus the production note.
import threading
from collections import Counter


class _Node:
    __slots__ = ("value", "next")

    def __init__(self, value):
        self.value = value
        self.next = None


class TreiberStack:
    def __init__(self):
        self._head = None
        self._cas_lock = threading.Lock()

    def _cas_head(self, expected, new):
        with self._cas_lock:          # simulate one atomic CAS instruction
            if self._head is expected:
                self._head = new
                return True
            return False

    def push(self, value):
        n = _Node(value)
        while True:
            old = self._head
            n.next = old
            if self._cas_head(old, n):
                return

    def pop(self):
        while True:
            old = self._head
            if old is None:
                return None, False
            if self._cas_head(old, old.next):
                return old.value, True


if __name__ == "__main__":
    T, N = 8, 2000
    s = TreiberStack()

    def pusher(t):
        for i in range(N):
            s.push(t * N + i)

    threads = [threading.Thread(target=pusher, args=(t,)) for t in range(T)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()

    seen = Counter()
    seen_lock = threading.Lock()

    def popper():
        while True:
            v, ok = s.pop()
            if not ok:
                return
            with seen_lock:
                seen[v] += 1

    poppers = [threading.Thread(target=popper) for _ in range(T)]
    for th in poppers:
        th.start()
    for th in poppers:
        th.join()

    integrity = len(seen) == T * N and all(c == 1 for c in seen.values())
    print(f"popped {len(seen)} distinct values, integrity={integrity}")
    # Production Python: just use queue.LifoQueue() for a thread-safe stack.
```

**Expected output (all three):** `popped 80000 distinct values, integrity=true` (Python uses N=2000 → 16000), confirming no value was lost, duplicated, or resurrected under concurrency.

---

<a name="followups"></a>
## 6. Follow-up Extensions

Interviewers commonly extend the challenge. Be ready to:

1. **Add ABA protection** — convert `head` to a `(ptr, tag)` pair (`AtomicStampedReference` in Java) and bump the tag on every success; explain why GC code didn't need it.
2. **Add exponential backoff** — sleep a capped, randomized, doubling interval after a failed CAS; show it lowers retry rate under contention.
3. **Add elimination** — sketch the elimination array and the push/pop rendezvous; argue it stays linearizable.
4. **Reclaim without GC** — describe hazard-pointer-protected `pop` (publish, re-validate, retire) and when you'd choose epochs instead.
5. **Prove correctness** — give the linearization points and the lock-freedom contradiction argument from [professional.md](./professional.md).
6. **Bound the stack / add size** — discuss why a naive shared size counter is a second hotspot and how to approximate size without one.

---

## 7. Rapid-Fire Concept Drills

Practice giving these as one-breath answers.

- **"CAS in one sentence?"** Atomically set a location to a new value only if it still holds the expected one; report success.
- **"Why is `head` atomic and nothing else?"** It is the only field two threads mutate concurrently; nodes are immutable after publication.
- **"What does a failed CAS tell you?"** Someone else's CAS succeeded in your read–CAS window; re-read and recompute.
- **"Lock-free vs wait-free in one line?"** Lock-free: *some* op always completes. Wait-free: *every* op completes in bounded steps.
- **"ABA in one line?"** Same pointer bits, different node — a stale CAS succeeds wrongly after a free+reuse.
- **"Tag fix in one line?"** CAS `(ptr, version)` and bump the version every success, so recycled pointers carry fresh versions.
- **"Why doesn't a GC see ABA?"** It won't recycle a node any thread still references.
- **"Elimination in one line?"** A concurrent push and pop hand off a value directly and skip `head` entirely.
- **"Why LIFO for free lists?"** The most-recently-freed object is the hottest in cache.
- **"Hazard pointers vs epochs?"** Hazard: bounded memory, robust, costlier reads. Epoch: cheap reads, but a stalled thread blocks reclamation.

---

## 8. Common Wrong Answers (and the Correction)

Interviewers probe for these misconceptions. Know the correction cold.

| Wrong answer | Why it's wrong | Correct framing |
|---|---|---|
| "Lock-free means faster than locks." | Under high contention a Treiber stack can be *slower* (ping-pong, retries). | Lock-free guarantees *progress under preemption*, not speed. |
| "Tags fix use-after-free." | Tags only stop a *stale CAS*; a thread can still dereference a freed node it already loaded. | Tags fix ABA; you also need a reclamation scheme (HP/epoch/GC). |
| "Go/Java code has ABA too." | A tracing GC pins referenced nodes, so the address can't recycle while observed. | GC hides ABA — until you recycle nodes yourself in a pool. |
| "Just add `atomic size++`." | The counter becomes a *second* contended hotspot, often worse than `head`. | Avoid exact shared counts; shard or approximate. |
| "Read `old.next` after the CAS." | By then `old` may be unlinked/freed — race / UAF. | Read `next` into a local *before* the CAS. |
| "Treiber stack is wait-free." | One thread's CAS can fail unboundedly while others win. | It is lock-free, strictly *not* wait-free. |
| "Elimination breaks LIFO semantics." | A push-then-immediate-pop is a valid stack history. | Elimination is linearizable; the pair is a net no-op. |
| "Sharding keeps strict LIFO." | Pops from a different shard miss the globally-last push. | Sharding trades strict LIFO for scaling; fine for pools. |

---

## 9. Whiteboard Warm-Ups

Short derivations an interviewer may ask you to do live.

**Warm-up A — Show two concurrent pushes never lose a value.**
Each push completes via a *successful* `CAS(head, old, n)`, which fires only when `head == old`. Two pushes cannot both succeed against the same `old`: the first to commit changes `head`, so the second's CAS sees `head != old` and fails, forcing a re-read of the *new* head and a re-link. Thus both nodes end up in the chain, ordered by commit time. No value is lost.

**Warm-up B — Give the smallest ABA trace.**
`head → A → B`. T1: read old=A, next=B, stall. T2: pop A (free A), pop B (free B), push X reusing A's address → `head → A*`. T1: `CAS(head, A, B)` matches bits → succeeds → `head → B` (freed). Three T2 operations are the minimum to recycle A's address and present the A→B→A pattern.

**Warm-up C — Why the empty-pop LP is the nil-read, not the invocation.**
Only the witnessed `head == nil` instant is guaranteed to coincide with an actually-empty abstract stack; at invocation the stack may still be non-empty. Linearizing at the nil-read makes the "returns ⊥ ⇒ stack was empty then" argument sound.

**Warm-up D — Argue lock-freedom in 3 sentences.**
Suppose no operation ever completes after some point. Then every CAS fails forever; but a CAS fails only because another CAS *succeeded* (changed `head`), and a successful CAS completes its operation. Contradiction — so some operation always completes; the system makes progress.

---

## 10. System-Design Style Prompts

These are open-ended; the interviewer wants structured reasoning, not a single fact.

**Prompt 1 — "Design a high-throughput connection pool."**
Lead with: per-thread cache in front of a shared lock-free free list (Treiber stack). Justify LIFO (hottest connection is warmest). Discuss bounding (cap + spill to a creator), validation on acquire (drop stale connections), and reclamation (GC handles it on the JVM; tags if you recycle node wrappers). Mention sharding per NUMA node if multi-socket. Close on observability: pool hit rate, acquire latency p99, and shared-stack CAS retry rate.

**Prompt 2 — "Your lock-free stack's memory keeps growing in production. Diagnose."**
First rule out a logical leak (more pushes than pops). Then suspect reclamation backlog: a thread parked inside an epoch critical section or holding a hazard pointer prevents frees, so limbo/retired lists balloon. Fix: bound critical-section duration, add a watchdog, and prefer hazard pointers for bounded held-back memory. Note this is an *availability* bug, not a perf knob.

**Prompt 3 — "When would you NOT use a Treiber stack?"**
When you need FIFO (use an MS-queue), when contention is low and simplicity wins (use a mutex + slice), when you need exact size/iteration/multi-op atomicity (lock-based is easier), or when contention is extreme and strict LIFO is unnecessary (shard it, or it isn't even a stack you want).

**Prompt 4 — "Make it scale to 64 cores."**
Front it with per-thread caches (removes most shared traffic), then if strict LIFO isn't needed, shard the shared tier; if it is needed, deploy elimination-backoff so concurrent push/pop pairs cancel off the hot path. Add capped exponential backoff regardless. Pad `head`/shard-heads to a cache line to avoid false sharing. Validate with a scaling benchmark, expecting the plain version to flatten/regress and the tuned version to climb.

**Prompt 5 — "Port the JVM stack to C++. What breaks?"**
ABA reappears (no GC pinning nodes) and use-after-free becomes possible. Add a versioned head (DWCAS or `AtomicStampedReference`-equivalent) for ABA *and* a reclamation scheme (hazard pointers for bounded memory and robustness, or epochs for cheap read-heavy paths) for safe `free`. Get the memory ordering right: release on the publishing CAS, acquire on the load, a store-load fence in hazard-pointer publication.

---

## 11. Extended Coding Challenge — Bounded Treiber Stack

> **Task.** Extend the Treiber stack with a `capacity`. `push` returns `false` when full; `pop` returns the empty signal when empty. Avoid a single exact shared counter as the only mechanism — discuss the trade-off — but a correct (if contended) atomic counter is acceptable for the interview.

#### Go

```go
package main

import (
	"fmt"
	"sync/atomic"
)

type bnode struct {
	value int
	next  *bnode
}

type BoundedStack struct {
	head atomic.Pointer[bnode]
	size atomic.Int64 // approximate under heavy contention; exact here
	cap  int64
}

func (s *BoundedStack) Push(v int) bool {
	if s.size.Load() >= s.cap { // fast reject (racy but cheap)
		return false
	}
	n := &bnode{value: v}
	for {
		old := s.head.Load()
		n.next = old
		if s.head.CompareAndSwap(old, n) {
			s.size.Add(1)
			return true
		}
	}
}

func (s *BoundedStack) Pop() (int, bool) {
	for {
		old := s.head.Load()
		if old == nil {
			return 0, false
		}
		if s.head.CompareAndSwap(old, old.next) {
			s.size.Add(-1)
			return old.value, true
		}
	}
}

func main() {
	s := &BoundedStack{cap: 2}
	fmt.Println(s.Push(1), s.Push(2), s.Push(3)) // true true false
	v, _ := s.Pop()
	fmt.Println("popped", v, "now push:", s.Push(9)) // popped 2 ... true
}
```

#### Java

```java
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicLong;

public class BoundedStack<T> {
    private static final class Node<T> { final T v; Node<T> next; Node(T v){this.v=v;} }
    private final AtomicReference<Node<T>> head = new AtomicReference<>();
    private final AtomicLong size = new AtomicLong();
    private final long cap;
    public BoundedStack(long cap){ this.cap = cap; }

    public boolean push(T v) {
        if (size.get() >= cap) return false;       // cheap, racy fast-reject
        Node<T> n = new Node<>(v), old;
        do { old = head.get(); n.next = old; } while (!head.compareAndSet(old, n));
        size.incrementAndGet();
        return true;
    }
    public T pop() {
        Node<T> old, nx;
        do { old = head.get(); if (old == null) return null; nx = old.next; }
        while (!head.compareAndSet(old, nx));
        size.decrementAndGet();
        return old.v;
    }
    public static void main(String[] a) {
        BoundedStack<Integer> s = new BoundedStack<>(2);
        System.out.println(s.push(1) + " " + s.push(2) + " " + s.push(3)); // true true false
        System.out.println("popped " + s.pop() + ", push9=" + s.push(9));
    }
}
```

#### Python

```python
import threading


class _Node:
    __slots__ = ("v", "next")
    def __init__(self, v): self.v, self.next = v, None


class BoundedStack:
    """Conceptual: GIL + simulated CAS. Production: queue.LifoQueue(maxsize=cap)."""
    def __init__(self, cap):
        self._head = None
        self._size = 0
        self._cap = cap
        self._lock = threading.Lock()

    def push(self, v):
        with self._lock:
            if self._size >= self._cap:
                return False
            n = _Node(v); n.next = self._head
            self._head = n; self._size += 1
            return True

    def pop(self):
        with self._lock:
            if self._head is None:
                return None, False
            old = self._head; self._head = old.next; self._size -= 1
            return old.v, True


if __name__ == "__main__":
    s = BoundedStack(2)
    print(s.push(1), s.push(2), s.push(3))  # True True False
    v, _ = s.pop()
    print("popped", v, "push9=", s.push(9))
```

**Discussion point for the interviewer:** the shared `size` counter is a *second* contended atomic that can bottleneck before `head` does. For order-agnostic pools, prefer a *sharded* or *per-thread approximate* count and treat the bound as soft; exact bounds require paying the counter contention. The racy fast-reject (`size >= cap` before the CAS loop) is a deliberate optimization — it may transiently over/under-admit by a few elements, acceptable for a soft bound.
