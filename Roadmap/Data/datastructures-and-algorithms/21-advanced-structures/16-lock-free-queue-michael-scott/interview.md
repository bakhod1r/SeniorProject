# Michael-Scott Lock-Free Queue — Interview Preparation

> Tiered Q&A across four levels (Junior → Middle → Senior → Professional), followed by a full **coding challenge** implemented in Go, Java, and Python. Use this after reading `junior.md` through `professional.md`.

The MS-queue is a favorite in systems and concurrency interviews precisely because it forces you to reason about CAS, progress guarantees, and memory reclamation — topics that separate "I've used a concurrent queue" from "I understand one." Below are 46 questions with focused answers.

---

## Table of Contents

1. [Junior Questions (1–12)](#junior-questions)
2. [Middle Questions (13–25)](#middle-questions)
3. [Senior Questions (26–37)](#senior-questions)
4. [Professional Questions (38–46)](#professional-questions)
5. [Coding Challenge (3 Languages)](#coding-challenge)

---

<a name="junior-questions"></a>
## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is the Michael-Scott queue? | A lock-free FIFO queue using a singly linked list with atomic head/tail and CAS for enqueue/dequeue. |
| 2 | What does "lock-free" mean here? | A progress guarantee: the system always advances; some operation always completes even if threads stall. No mutex. |
| 3 | Why a singly linked list and not an array? | Unbounded growth, O(1) end operations, and only the two ends are mutated, which localizes contention. |
| 4 | What is the sentinel/dummy node and why is it there? | A valueless node always at the front so head/tail are never null and the empty case needs no special branch. |
| 5 | Where is the front element's value stored? | In `head.next`, not in `head`. The node `head` points to is the dummy. |
| 6 | What is CAS? | Compare-And-Swap: atomically set a word to `new` only if it equals `expected`; returns success/failure. |
| 7 | How does enqueue work, step by step? | Build a node; CAS-link it after the last node (`tail.next: null→n`); then CAS-advance `tail` to it. |
| 8 | How does dequeue work? | Read `head.next.value`; CAS-advance `head` to `head.next`; return the value. |
| 9 | How do you know the queue is empty? | `head == tail` and `head.next == null`. |
| 10 | What is a retry loop and why is it needed? | A `for{}` that re-reads state and re-attempts the CAS after a failure (someone else moved first). |
| 11 | Is enqueue O(1)? | Yes per successful op (bounded reads + 1–2 CAS); contention may add constant-factor retries. |
| 12 | Name one real implementation. | Java's `java.util.concurrent.ConcurrentLinkedQueue` is an MS-queue. |

**Answer notes (selected):**

- **Q5 deep-dive:** A classic bug is returning `head.value`. The dummy carries no payload; the real front lives one node later. After a dequeue, the node you advanced *to* becomes the new dummy.
- **Q7 deep-dive:** Two CASes because hardware CAS edits one word, but enqueue must change two (`last.next` and `tail`). The gap between them is the "lagging tail."
- **Q10 deep-dive:** Emphasize that a failed CAS is *not* an error condition — it is the normal, expected signal that another thread won the race. The loop simply re-reads and retries with fresh values. There is no exception, no rollback, no cleanup.

**Whiteboard walk-through (junior).** A strong junior candidate can draw the three states of enqueue on a whiteboard without prompting:

```text
(1) before:   head→[∅]→[a]→null          tail→[a]
(2) linked:   head→[∅]→[a]→[b]→null      tail→[a]   ← tail LAGS here
(3) advanced: head→[∅]→[a]→[b]→null      tail→[b]
```

State (2) is the whole subtlety: the node is in the list (reachable from head) but tail still points behind it. If asked "is `b` in the queue in state (2)?", the answer is **yes** — it became part of the queue the instant the link CAS succeeded, regardless of where `tail` points.

---

<a name="middle-questions"></a>
## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 13 | Why does enqueue need two CASes? | CAS is single-word; linking the node and advancing tail are two separate words. |
| 14 | What is the "lagging tail"? | Between the two enqueue CASes, `tail` points one node behind the true last node. |
| 15 | What is the helping mechanism? | Any thread seeing `tail.next != null` must CAS-advance tail before its own op. |
| 16 | Why is helping required for lock-freedom (not just speed)? | If only the enqueuer could advance tail, a stalled enqueuer would block all others — that's blocking. |
| 17 | What is the ABA problem? | CAS compares by value; an address freed and reused (A→B→A) fools CAS into "nothing changed." |
| 18 | Give an ABA scenario in dequeue. | T1 reads head=A, pauses; A is dequeued+freed, address reused as A'; T1's CAS(head,A,B) wrongly succeeds. |
| 19 | How did the original paper avoid ABA? | Tagged pointers — a version counter packed beside each pointer, bumped on every change. |
| 20 | Why don't Java/Go GC versions hit ABA-by-reuse? | The GC won't recycle an address while any reference (even a stale local) points to it. |
| 21 | Why can't you just `free` a node after dequeue? | Another thread may still hold/deref a pointer into it (use-after-free). |
| 22 | Name two safe-reclamation techniques. | Hazard pointers; epoch-based reclamation / RCU. |
| 23 | MS-queue vs two-lock queue? | Two-lock uses a head lock + tail lock (enqueuers/dequeuers don't contend) but blocks on a stalled holder; reclamation is trivial. |
| 24 | MS-queue vs single-lock blocking queue? | Blocking is simplest, serializes everything, and offers built-in back-pressure; MS-queue is lock-free and parallel. |
| 25 | What invariant bounds the tail lag? | Tail lags by at most one node; one help step always restores it. |

**Answer notes (selected):**

- **Q16:** The interviewer wants you to connect *mechanism* (helping) to *property* (lock-freedom). State: "A thread descheduled between its two CASes must not be able to stall the system; allowing any thread to finish its tail-advance guarantees system progress."
- **Q21–22:** The cleanest framing: "Reclamation is an agreement problem — when can I prove no thread references X? Hazard pointers answer it by publishing; epochs by grace periods."

**Common follow-ups (middle):**

- *"Why read `next.value` before the head CAS, not after?"* After the CAS, the node may already be removed and (in unmanaged code) freed or reused; reading its value then is a use-after-free. Read first, CAS second.
- *"In Java, can two enqueuers both succeed their link CAS on the same node?"* No — `compareAndSet(null, n)` on `last.next` succeeds for exactly one thread because the field leaves `null` once (single-assignment invariant). The loser sees a non-null `next` and retries.
- *"What's the difference between the lock-free MS-queue and the two-lock queue in the *same* 1996 paper?"* Same authors, same paper presents both: the lock-free one (CAS, no locks) and a simpler two-lock blocking one (separate head and tail mutexes). The two-lock version is recommended when lock-freedom isn't required because it's easier and reclamation is trivial.

---

<a name="senior-questions"></a>
## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 26 | What actually limits MS-queue throughput? | Cache-coherence traffic on the head/tail lines, not Big-O; contended lines ping-pong between cores. |
| 27 | What is false sharing and how does it hurt here? | head and tail on one cache line → each head CAS invalidates tail copies. Fix: pad to separate lines. |
| 28 | When would you choose the LMAX Disruptor instead? | Fixed capacity, no per-item allocation, sequential memory, max throughput; accepts back-pressure when full. |
| 29 | Bounded vs unbounded — trade-offs? | Unbounded never blocks producers but risks OOM; bounded gives memory safety + back-pressure. |
| 30 | How do hazard pointers reclaim memory? | Threads publish in-use pointers; retired nodes freed only if not currently hazarded. Bounded memory. |
| 31 | How does epoch/RCU reclamation work and what's its weakness? | Free after a grace period (all threads advanced epoch); a stalled reader stalls reclamation → growth. |
| 32 | How do you reduce contention besides backoff? | Sharding into K queues, flat combining, work-stealing per-worker queues. |
| 33 | How do you implement size()? | You don't get O(1) accurate size; maintain a separate approximate atomic counter. |
| 34 | What backoff would you add and where? | Exponential backoff with jitter after repeated CAS failure (`onSpinWait`/`Gosched`/PAUSE). |
| 35 | Where do MS-queues appear in production? | Thread pools, actor mailboxes, async loggers, event loops, GC work lists. |
| 36 | Consumer spinning on empty queue — problem and fix? | Wastes CPU/energy; after a few spins, park/condition-wait — or use a blocking queue. |
| 37 | Why might throughput *drop* as you add threads? | Contention collapse: more cores fighting one cache line → coherence misses dominate. |

**Answer notes (selected):**

- **Q26/Q37:** Senior signal is naming the mechanism: MESI exclusive-state acquisition per CAS forces line invalidation; under N writers the line bounces, so per-op latency grows with N.
- **Q30 vs Q31:** Be ready to state the trade-off crisply — hazard pointers: bounded memory, per-deref fence; epochs: cheap reads, unbounded if a reader stalls.

**System-design extension (senior).** Interviewers often pivot from the queue to a *system*: "Design the work queue for a thread pool serving 1M tasks/sec." Strong answer structure:

1. **Start with the requirement:** must not block submitters; bursty load; bounded memory budget.
2. **Pick the structure:** per-worker queues with **work stealing** (not one global MS-queue) to avoid a single contended cache line; a global MS-queue or Disruptor as the submission buffer.
3. **Reclamation:** GC if on JVM/Go; otherwise hazard pointers for bounded memory.
4. **Back-pressure:** since MS-queue is unbounded, add an explicit bounded staging buffer or a Disruptor so a slow consumer can't OOM the process.
5. **Observability:** approximate depth via atomic counters, CAS-retry rate, consumer idle spins.

The point the interviewer is testing: you know a single lock-free queue is rarely the *whole* answer at scale — sharding and back-pressure matter more than the micro-algorithm.

---

<a name="professional-questions"></a>
## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 38 | What correctness condition does the MS-queue satisfy? | Linearizability: each op appears atomic at a single point between invoke and response, consistent with real-time order and the sequential FIFO spec. |
| 39 | What is the linearization point of enqueue? | The successful `CAS(last.next, null, n)` link — the element is in the queue from that instant. |
| 40 | What is the LP of a successful dequeue? | The successful `CAS(head, h, next)`; the value was read before and frozen by single-assignment. |
| 41 | What is the LP of an empty dequeue? | The atomic read observing `head == tail` and `head.next == null` (queue empty at that instant). |
| 42 | Prove the MS-queue is lock-free (sketch). | Any retry is caused by another thread's successful state-advancing CAS (a completed op or tail/head advance); so some op always completes → system-wide progress. |
| 43 | Is it wait-free? Why or why not? | No: an unlucky thread can fail CAS forever while others progress; no per-op step bound. |
| 44 | Place it in the progress hierarchy. | Obstruction-free ⊋ lock-free (MS-queue here) ⊋ wait-free; it's lock-free, not wait-free. |
| 45 | State the safe-memory-reclamation problem formally. | free(x) safe ⇔ no process holds or will deref a pointer to x thereafter; an agreement problem over held pointers. |
| 46 | Do tagged pointers fully solve reclamation? | No — they defeat ABA's CAS confusion but not use-after-free; you still need hazard pointers/epochs. |

**Answer notes (selected):**

- **Q42:** The crisp argument: enumerate the three CAS sites (link, tail-advance, head-advance). A failed link or head CAS implies someone else's *succeeded* (= a completed op). Tail-advance failures are bounded bookkeeping that can't recur without an intervening link success. Hence infinitely many ops complete.
- **Q44:** Mention CAS has consensus number ∞, so a wait-free queue is *possible* (Kogan–Petrank, via a per-thread announce/help array); the MS-queue trades that for simplicity.

---

<a name="coding-challenge"></a>
## Coding Challenge (3 Languages)

### Challenge: Implement a lock-free MPMC queue and verify FIFO under concurrency

> Implement a Michael-Scott queue with `enqueue(v)` and `dequeue() -> (value, ok)`. Then write a test: spawn P producers each enqueuing a disjoint, monotonically increasing range of integers, and C consumers draining concurrently. Verify (1) the total count consumed equals total produced, and (2) **per producer**, the values you dequeued that originated from that producer come out in increasing order (per-producer FIFO is guaranteed; global interleaving is not). Use the two-step tail with helping. (For unmanaged correctness you'd add hazard pointers; here rely on GC / GIL.)

**Why per-producer FIFO?** A single producer's enqueues linearize in program order, and dequeues remove in head order, so values from one producer appear in the order that producer enqueued them — even though items from different producers interleave arbitrarily.

#### Go

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

type node struct {
	value int
	next  atomic.Pointer[node]
}

type MSQueue struct {
	head atomic.Pointer[node]
	tail atomic.Pointer[node]
}

func New() *MSQueue {
	d := &node{}
	q := &MSQueue{}
	q.head.Store(d)
	q.tail.Store(d)
	return q
}

func (q *MSQueue) Enqueue(v int) {
	n := &node{value: v}
	for {
		t := q.tail.Load()
		next := t.next.Load()
		if t == q.tail.Load() {
			if next == nil {
				if t.next.CompareAndSwap(nil, n) {
					q.tail.CompareAndSwap(t, n)
					return
				}
			} else {
				q.tail.CompareAndSwap(t, next) // help
			}
		}
	}
}

func (q *MSQueue) Dequeue() (int, bool) {
	for {
		h := q.head.Load()
		t := q.tail.Load()
		next := h.next.Load()
		if h == q.head.Load() {
			if h == t {
				if next == nil {
					return 0, false
				}
				q.tail.CompareAndSwap(t, next) // help
			} else {
				v := next.value
				if q.head.CompareAndSwap(h, next) {
					return v, true
				}
			}
		}
	}
}

func main() {
	q := New()
	const P, C, per = 4, 4, 50000
	encode := func(p, i int) int { return p*per + i } // recover producer = v/per

	var wg sync.WaitGroup
	for p := 0; p < P; p++ {
		wg.Add(1)
		go func(p int) {
			defer wg.Done()
			for i := 0; i < per; i++ {
				q.Enqueue(encode(p, i))
			}
		}(p)
	}

	var consumed int64
	last := make([]int, P) // last seen per producer, guarded by per-consumer locals
	var mu sync.Mutex
	for c := 0; c < P; c++ {
		last[c] = -1
	}
	done := make(chan struct{})
	var cwg sync.WaitGroup
	for c := 0; c < C; c++ {
		cwg.Add(1)
		go func() {
			defer cwg.Done()
			for {
				v, ok := q.Dequeue()
				if ok {
					atomic.AddInt64(&consumed, 1)
					producer, seq := v/per, v%per
					mu.Lock()
					if seq <= last[producer] && last[producer] != -1 {
						fmt.Println("FIFO VIOLATION for producer", producer)
					}
					last[producer] = seq
					mu.Unlock()
				} else {
					select {
					case <-done:
						if _, ok := q.Dequeue(); !ok {
							return
						}
					default:
					}
				}
			}
		}()
	}
	wg.Wait()
	close(done)
	cwg.Wait()
	fmt.Printf("produced=%d consumed=%d\n", P*per, consumed)
}
```

#### Java

```java
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.*;

public class MSQueueChallenge<T> {
    static final class Node<T> {
        final T value;
        final AtomicReference<Node<T>> next = new AtomicReference<>(null);
        Node(T v) { value = v; }
    }
    private final AtomicReference<Node<T>> head, tail;

    public MSQueueChallenge() {
        Node<T> d = new Node<>(null);
        head = new AtomicReference<>(d);
        tail = new AtomicReference<>(d);
    }

    public void enqueue(T v) {
        Node<T> n = new Node<>(v);
        while (true) {
            Node<T> t = tail.get(), next = t.next.get();
            if (t == tail.get()) {
                if (next == null) {
                    if (t.next.compareAndSet(null, n)) { tail.compareAndSet(t, n); return; }
                } else tail.compareAndSet(t, next); // help
            }
        }
    }

    public T dequeue() {
        while (true) {
            Node<T> h = head.get(), t = tail.get(), next = h.next.get();
            if (h == head.get()) {
                if (h == t) {
                    if (next == null) return null;
                    tail.compareAndSet(t, next); // help
                } else {
                    T v = next.value;
                    if (head.compareAndSet(h, next)) return v;
                }
            }
        }
    }

    public static void main(String[] a) throws Exception {
        final int P = 4, C = 4, per = 50_000;
        MSQueueChallenge<Integer> q = new MSQueueChallenge<>();
        AtomicLong consumed = new AtomicLong();
        int[] last = new int[P];
        java.util.Arrays.fill(last, -1);

        ExecutorService pool = Executors.newFixedThreadPool(P + C);
        CountDownLatch prodDone = new CountDownLatch(P);
        for (int p = 0; p < P; p++) {
            final int pid = p;
            pool.execute(() -> {
                for (int i = 0; i < per; i++) q.enqueue(pid * per + i);
                prodDone.countDown();
            });
        }
        var stop = new java.util.concurrent.atomic.AtomicBoolean(false);
        CountDownLatch consDone = new CountDownLatch(C);
        for (int c = 0; c < C; c++) {
            pool.execute(() -> {
                while (!stop.get() || true) {
                    Integer v = q.dequeue();
                    if (v != null) {
                        consumed.incrementAndGet();
                        int prod = v / per, seq = v % per;
                        synchronized (last) {
                            if (last[prod] != -1 && seq <= last[prod])
                                System.out.println("FIFO VIOLATION " + prod);
                            last[prod] = seq;
                        }
                    } else if (stop.get()) break;
                }
                consDone.countDown();
            });
        }
        prodDone.await();
        stop.set(true);
        consDone.await();
        pool.shutdown();
        System.out.println("produced=" + (P * per) + " consumed=" + consumed.get());
    }
}
```

#### Python

```python
# CPython's GIL serializes bytecode, so there's no true parallel CAS contention;
# the MS-queue below is correct but offers no speedup over queue.Queue. It is
# shown to mirror the Go/Java structure. For real parallelism use processes.
import threading

class _Node:
    __slots__ = ("value", "next")
    def __init__(self, v=None):
        self.value, self.next = v, None

class MSQueue:
    def __init__(self):
        d = _Node()
        self._head = d
        self._tail = d
        self._lk = threading.Lock()  # emulates atomic CAS

    def _cas(self, holder, attr, exp, new):
        with self._lk:
            if getattr(holder, attr) is exp:
                setattr(holder, attr, new)
                return True
            return False

    def enqueue(self, v):
        n = _Node(v)
        while True:
            t = self._tail
            nxt = t.next
            if t is self._tail:
                if nxt is None:
                    if self._cas(t, "next", None, n):
                        self._cas(self, "_tail", t, n)
                        return
                else:
                    self._cas(self, "_tail", t, nxt)

    def dequeue(self):
        while True:
            h = self._head
            t = self._tail
            nxt = h.next
            if h is self._head:
                if h is t:
                    if nxt is None:
                        return None
                    self._cas(self, "_tail", t, nxt)
                else:
                    v = nxt.value
                    if self._cas(self, "_head", h, nxt):
                        return v


def main():
    P, C, per = 4, 4, 20_000
    q = MSQueue()
    consumed = [0]
    clock = threading.Lock()
    last = [-1] * P
    stop = threading.Event()

    def produce(pid):
        for i in range(per):
            q.enqueue(pid * per + i)

    def consume():
        while not stop.is_set() or True:
            v = q.dequeue()
            if v is None:
                if stop.is_set():
                    return
                continue
            with clock:
                consumed[0] += 1
                prod, seq = divmod(v, per)
                if last[prod] != -1 and seq <= last[prod]:
                    print("FIFO VIOLATION", prod)
                last[prod] = seq

    prods = [threading.Thread(target=produce, args=(p,)) for p in range(P)]
    cons = [threading.Thread(target=consume) for _ in range(C)]
    for t in prods + cons:
        t.start()
    for t in prods:
        t.join()
    stop.set()
    for t in cons:
        t.join()
    print(f"produced={P*per} consumed={consumed[0]}")


if __name__ == "__main__":
    main()
```

**Expected output (all three):** `produced=N consumed=N` with **no** "FIFO VIOLATION" line. The per-producer monotonicity check is the real test: it proves each producer's items leave in order, which is what FIFO guarantees in an MPMC setting.

**Follow-up the interviewer may ask:** "Now make it safe to `free` nodes in C." Answer: add **hazard pointers** — publish `head`/`next` before dereferencing, retire instead of free, and free only nodes absent from all hazard slots (cross-link [`20-hazard-pointers`](../20-hazard-pointers/)).

---

## Rapid-Fire Round (one-liners to drill)

| Prompt | Crisp answer |
|--------|--------------|
| Front value is in… | `head.next`, not `head`. |
| Empty condition | `head == tail && head.next == null`. |
| Enqueue CAS count | Two: link, then advance tail. |
| Dequeue CAS count | One: advance head. |
| Who advances a lagging tail? | Any thread that observes it (helping). |
| LP of enqueue | The successful link CAS (`last.next: null→n`). |
| LP of dequeue | The successful head-advance CAS. |
| Progress class | Lock-free (not wait-free). |
| ABA cause | CAS compares by value; freed address reused. |
| ABA fix in the paper | Tagged/versioned pointers. |
| Why Java is ABA-safe | GC won't reuse an address with live references. |
| Reclamation options | GC, hazard pointers, epochs/RCU. |
| Real bottleneck | Cache-coherence ping-pong on head/tail lines. |
| False-sharing fix | Pad head/tail to separate cache lines. |
| Bounded alternative | LMAX Disruptor ring buffer. |
| `ConcurrentLinkedQueue` is… | An MS-queue. |
| Accurate O(1) size? | No — approximate counter only. |
| Simpler blocking sibling | The two-lock queue (same 1996 paper). |

## Mistakes That Tank an Interview

1. **Returning `head.value`** instead of `head.next.value` — instantly signals you don't understand the sentinel.
2. **Claiming it's wait-free** — it's lock-free; conflating the two is a red flag for a senior/staff role.
3. **Saying GC "solves" reclamation universally** — true for managed runtimes only; in C/C++/Rust-unsafe you must name hazard pointers or epochs.
4. **Forgetting the helping step** — without it the algorithm is not lock-free, and many candidates omit it.
5. **Treating CAS failure as an error** — it's the normal retry signal; there's no rollback.
6. **Proposing a lock "just for size()"** — reintroduces the blocking you removed; use an approximate counter.

## How to Structure a 45-Minute MS-Queue Interview

1. **(5 min)** Define a lock-free FIFO; draw the linked list with dummy, head, tail.
2. **(10 min)** Code enqueue and dequeue with the retry loops; explain the two-step tail.
3. **(10 min)** Explain helping and *why* it gives lock-freedom (progress under a stalled thread).
4. **(10 min)** ABA and reclamation: scenario, then hazard pointers vs epochs vs GC.
5. **(5 min)** Scale it: contention, false sharing, when to choose a Disruptor instead.
6. **(5 min)** If time: sketch the linearization points and the lock-freedom argument.

## Bonus Scenario Questions (whiteboard-style)

**B1 — "Trace this interleaving."** Two threads call `enqueue` on an empty queue concurrently; both read `tail = dummy` and both attempt the link CAS. Walk through which succeeds, what the loser observes, and the final list. *Answer:* exactly one link CAS succeeds (the field leaves `null` once); the loser's CAS sees a non-null `next`, fails, loops, re-reads the new tail, and links after the winner's node. Final list: `dummy → winner → loser`, tail at loser.

**B2 — "A dequeuer and an enqueuer race on a one-element queue."** Show that the dequeuer reading `head.next.value` before its CAS, combined with the enqueuer's link, never returns a torn value. *Answer:* the value is in a node whose `value` field is single-assigned at construction and never mutated; the dequeuer reads it, and its CAS on `head` either succeeds (correct value) or fails and retries — it never returns a value from a node it did not successfully advance past.

**B3 — "Where would you add a memory fence and why?"** *Answer:* between writing the new node's `value` and publishing it via the link CAS (release), and between loading the node pointer and reading its `value` (acquire). Without the release/acquire pair a weakly-ordered CPU (ARM/POWER) could let a consumer see the linked node before its initialized value.

**B4 — "Your profiler shows enqueue throughput drops from 1 to 8 threads. Diagnose."** *Answer:* contention on the `tail` cache line — every enqueuer CASes the same word, forcing exclusive-state acquisition and line invalidation across cores (coherence ping-pong). Mitigations: exponential backoff, shard into multiple queues, or move to per-producer queues with work stealing; verify head/tail aren't falsely sharing a line.

**B5 — "Make `dequeue` block until an item is available instead of returning empty."** *Answer:* wrap it: spin a few times, then park on a condition/`LockSupport.park`, and have `enqueue` signal/unpark. Beware lost wakeups (check the predicate after waking). Note this reintroduces blocking *on emptiness* but not on the data-structure invariant — a fair trade for consumer CPU savings.
