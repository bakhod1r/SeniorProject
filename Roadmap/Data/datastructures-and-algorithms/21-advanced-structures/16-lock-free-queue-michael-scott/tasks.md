# Michael-Scott Lock-Free Queue — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**. Go uses `sync/atomic` (`atomic.Pointer[T]`); Java uses `AtomicReference`; Python is conceptual under the GIL (use a lock to emulate CAS, or `queue.Queue` where noted). Test every solution with empty, single-element, and concurrent multi-producer/multi-consumer cases.

---

## Beginner Tasks

**Task 1:** Implement a Michael-Scott queue from scratch with `enqueue(v)` and `dequeue() -> (value, ok)`. Include the **sentinel node**, atomic `head`/`tail`, the two-step tail update, and the helping step. Do not free nodes (leak is acceptable here).

#### Go

```go
package main

import "sync/atomic"

type node struct {
	value int
	next  atomic.Pointer[node]
}

type MSQueue struct {
	head atomic.Pointer[node]
	tail atomic.Pointer[node]
}

func New() *MSQueue {
	// TODO: create dummy node, store into head and tail
	return nil
}

func (q *MSQueue) Enqueue(v int) {
	// TODO: link CAS, then advance-tail CAS, with help
}

func (q *MSQueue) Dequeue() (int, bool) {
	// TODO: read next.value, advance head, handle empty + lagging tail
	return 0, false
}

func main() {
	// TODO: enqueue a few values, dequeue them, print
}
```

#### Java

```java
import java.util.concurrent.atomic.AtomicReference;

public class Task1<T> {
    static final class Node<T> {
        final T value;
        final AtomicReference<Node<T>> next = new AtomicReference<>(null);
        Node(T v) { value = v; }
    }
    private final AtomicReference<Node<T>> head, tail;

    public Task1() {
        // TODO: dummy node into head and tail
        head = null; tail = null;
    }

    public void enqueue(T v) { /* TODO */ }
    public T dequeue() { /* TODO */ return null; }

    public static void main(String[] args) {
        // TODO
    }
}
```

#### Python

```python
import threading

class _Node:
    __slots__ = ("value", "next")
    def __init__(self, v=None):
        self.value, self.next = v, None

class MSQueue:
    def __init__(self):
        self._lk = threading.Lock()
        # TODO: dummy into head and tail

    def enqueue(self, v):
        ...  # TODO

    def dequeue(self):
        ...  # TODO

if __name__ == "__main__":
    pass  # TODO
```

- **Constraints:** O(1) enqueue/dequeue; head/tail never null; empty returns `(0, false)` / `null` / `None`.
- **Expected Output:** values come out in FIFO order; an extra dequeue on empty reports empty.
- **Evaluation:** correct sentinel handling, both enqueue CASes present, helping step present.

**Task 2:** Add a `Peek() -> (value, ok)` that returns the front value **without** removing it. It must read `head.next.value` and not mutate any pointer. Provide starter code in all 3 languages.
- Constraints: must be safe to call concurrently with enqueue/dequeue; no CAS.

**Task 3:** Add an `IsEmpty() -> bool` using the invariant `head == tail && head.next == null`. Show that under concurrency it may be momentarily wrong (a "snapshot" answer) and explain why that is acceptable.
- Constraints: no locks; document the racy-but-safe semantics in a comment.

**Task 4:** Write a single-threaded correctness test that enqueues `[1,2,3,4,5]`, then dequeues all and asserts the order is exactly `1,2,3,4,5`, then asserts one more dequeue reports empty. Provide the test in all 3 languages.
- Constraints: use plain assertions; no test framework required.

**Task 5:** Convert your queue from `int` to a **generic** payload (Go generics / Java `<T>` / Python any-object). Re-run Task 4 with strings.
- Constraints: keep the sentinel's value as the type's zero/null; do not special-case it.

---

## Intermediate Tasks

**Task 6:** Write a concurrent stress test: spawn **P=4 producers** and **C=4 consumers**. Each producer enqueues `per=50000` integers encoded as `producer*per + i`. Consumers drain until producers finish and the queue is empty. Assert `consumed == produced` and that, per producer, dequeued sequence numbers are strictly increasing (per-producer FIFO). Provide in all 3 languages.
- Constraints: a clean shutdown handshake (producers signal done, consumers drain remainder).

**Task 7:** Add **exponential backoff with jitter** in both retry loops: after each failed CAS, spin/yield for a randomized, growing interval, capped at a maximum. Measure throughput with and without backoff at 8 producers.
- Constraints: use `Thread.onSpinWait()` (Java), `runtime.Gosched()` (Go), `time.sleep` (Python conceptual).

**Task 8:** Implement an approximate `Size()` by maintaining a separate `atomic` counter that enqueue increments and successful dequeue decrements. Demonstrate it can briefly disagree with reality under concurrency, and explain why an exact O(1) size is incompatible with the lock-free design.
- Constraints: counter updates must be atomic; do not lock the queue.

**Task 9:** Build a **blocking wrapper**: `Take()` blocks (park/condition-wait or spin-then-sleep) when the queue is empty and wakes on the next enqueue; `Put()` simply enqueues and signals. Compare its CPU usage on an empty queue against a busy-spin consumer.
- Constraints: avoid lost-wakeups; document your signaling.

**Task 10:** Construct an **ABA demonstration** (in a language where you can reuse addresses — do this conceptually in Go/Java by modeling a manual free-list, or describe it precisely if the GC prevents it). Show how a tagged/stamped pointer (`AtomicStampedReference` in Java) detects the reuse that a plain pointer CAS misses.
- Constraints: include the version-counter bump; explain why plain CAS fails.

---

## Advanced Tasks

**Task 11:** Add **hazard-pointer-based reclamation** so removed nodes can be safely freed (or returned to a pool) without use-after-free. Each thread publishes the pointer it is about to dereference; retired nodes are freed only when absent from all hazard slots. Provide in all 3 languages (Python conceptual). Cross-reference [`20-hazard-pointers`](../20-hazard-pointers/).
- Constraints: publish-then-validate ordering (a fence between publishing a hazard and re-checking the pointer is still in the structure); bounded retire-list size before a scan.

**Task 12:** Implement **epoch-based reclamation** as an alternative to Task 11: a global epoch, per-thread pinning, and freeing only after a grace period. Show that a thread that stalls inside a critical section causes the retire list to grow unbounded (the EBR weakness). Cross-reference [`19-rcu`](../19-rcu/).
- Constraints: three-epoch retire buckets; document the grace-period condition.

**Task 13:** Implement the **two-lock queue** (Michael-Scott's blocking companion: a `headLock` and a `tailLock`). Benchmark it against your lock-free MS-queue at 1, 2, 4, 8 producer threads and report the crossover point where one beats the other.
- Constraints: enqueuers take only `tailLock`, dequeuers only `headLock`; reclamation is trivial here — exploit that.

**Task 14:** Implement a **bounded ring-buffer queue** (a minimal Disruptor-style MPMC) using CAS on a 64-bit sequence number per slot. Producers claim a slot, consumers release it; `enqueue` fails or blocks when full. Compare allocation count and throughput against the unbounded MS-queue. Cross-reference senior.md.
- Constraints: power-of-two capacity, mask instead of modulo; **pad** the producer and consumer cursors onto separate cache lines.

**Task 15:** Add **cache-line padding** to your MS-queue so `head` and `tail` never share a line, and measure the false-sharing effect: benchmark padded vs unpadded at 8 threads on a machine with ≥4 cores. Report the throughput delta. Use Go struct padding, Java `@Contended` (`-XX:-RestrictContended`), and note Python cannot control this.
- Constraints: verify the fields land on distinct 64-byte lines; report Mops/s for both layouts.

---

## Benchmark Task

> Compare enqueue/dequeue throughput across all 3 languages as the number of concurrent producers grows. Expect per-op cost to *rise* with thread count due to contention on the head/tail cache lines — the key lesson of this topic.

#### Go

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

func main() {
	for _, producers := range []int{1, 2, 4, 8} {
		q := New() // from Task 1
		const per = 1_000_000
		var wg sync.WaitGroup
		start := time.Now()
		for p := 0; p < producers; p++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for i := 0; i < per; i++ {
					q.Enqueue(i)
				}
			}()
		}
		wg.Wait()
		secs := time.Since(start).Seconds()
		fmt.Printf("producers=%d: %.2f Mops/s\n",
			producers, float64(producers*per)/secs/1e6)
	}
}
```

#### Java

```java
import java.util.concurrent.ConcurrentLinkedQueue;

public class Benchmark {
    public static void main(String[] args) throws InterruptedException {
        for (int producers : new int[]{1, 2, 4, 8}) {
            var q = new ConcurrentLinkedQueue<Integer>();
            int per = 1_000_000;
            Thread[] ts = new Thread[producers];
            long start = System.nanoTime();
            for (int p = 0; p < producers; p++) {
                ts[p] = new Thread(() -> { for (int i = 0; i < per; i++) q.offer(i); });
                ts[p].start();
            }
            for (Thread t : ts) t.join();
            double secs = (System.nanoTime() - start) / 1e9;
            System.out.printf("producers=%d: %.2f Mops/s%n",
                producers, producers * per / secs / 1e6);
        }
    }
}
```

#### Python

```python
# Under the GIL, threads do not run Python bytecode in parallel; this
# benchmark measures queue.Queue (the right tool in CPython). For real
# parallel throughput use multiprocessing.Queue across processes.
import queue, threading, time

for producers in (1, 2, 4, 8):
    q = queue.Queue()
    per = 200_000

    def work():
        for i in range(per):
            q.put(i)

    threads = [threading.Thread(target=work) for _ in range(producers)]
    t0 = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    dt = time.perf_counter() - t0
    print(f"producers={producers}: {producers*per/dt/1e6:.2f} Mops/s")
```

**What to report:** a table of Mops/s vs producer count for each language. Note where throughput plateaus or declines, and connect it to cache-line contention on `head`/`tail`. Re-run the Go/Java versions with cache-line padding (Task 15) and report the improvement.
