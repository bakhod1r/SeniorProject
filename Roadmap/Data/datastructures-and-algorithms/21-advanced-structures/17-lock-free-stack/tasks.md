# Treiber Lock-Free Stack — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python** (in that order).
> Go: use `sync/atomic`. Java: use `AtomicReference` / `AtomicStampedReference`.
> Python: GIL means no true parallelism and no hardware CAS — write the
> **conceptual** version (simulate CAS with a lock) and note the production
> alternative (`queue.LifoQueue`). Verify each concurrent task with an
> **integrity check**: the multiset of popped values equals the multiset of
> pushed values.

---

## Beginner Tasks

**Task 1 — Implement a Treiber stack from scratch.**
Build `push(v)` and `pop() -> (value, ok)` as CAS retry loops over an atomic `head`. No mutex on the hot path. Handle empty pop.

#### Go

```go
package main

import "sync/atomic"

type node[T any] struct {
	value T
	next  *node[T]
}

type TreiberStack[T any] struct {
	head atomic.Pointer[node[T]]
}

func (s *TreiberStack[T]) Push(v T) {
	// TODO: CAS loop
}

func (s *TreiberStack[T]) Pop() (v T, ok bool) {
	// TODO: CAS loop; return (zero,false) when empty
	return
}

func main() {
	// TODO: push a few values, pop them, print in LIFO order
}
```

#### Java

```java
import java.util.concurrent.atomic.AtomicReference;

public class Task1<T> {
    private static final class Node<T> { final T value; Node<T> next; Node(T v){value=v;} }
    private final AtomicReference<Node<T>> head = new AtomicReference<>();

    public void push(T v) { /* TODO: CAS loop */ }
    public T pop()        { /* TODO: CAS loop; null when empty */ return null; }

    public static void main(String[] args) {
        // TODO: push, pop, print LIFO order
    }
}
```

#### Python

```python
import threading


class _Node:
    __slots__ = ("value", "next")
    def __init__(self, value):
        self.value, self.next = value, None


class TreiberStack:
    def __init__(self):
        self._head = None
        self._lock = threading.Lock()  # simulated CAS

    def _cas(self, expected, new):
        # TODO: atomic compare-and-set of self._head
        ...

    def push(self, value):
        ...  # TODO

    def pop(self):
        ...  # TODO: return (value, ok)


if __name__ == "__main__":
    pass  # TODO
```

- **Constraints:** O(1) amortized per op; no lost updates.
- **Expected Output:** values pop in reverse push order (single thread).
- **Evaluation:** correctness, empty-pop handling, CAS-only head mutation.

**Task 2 — Add `peek()` and `isEmpty()`.**
`peek()` returns the top value without removing it; `isEmpty()` reports emptiness. Both must be a single atomic load of `head` — no CAS, no lock. Discuss in a comment why `peek` is inherently racy (the top may change the instant after you read it).

**Task 3 — LIFO ordering test (single thread).**
Push `1..10`, pop all, and assert you get `10,9,...,1`. Add the assertion in code in all three languages.

**Task 4 — Concurrent integrity test.**
Spawn `T=8` pusher threads (each pushes `N` uniquely-tagged values) and, after they finish, `T` popper threads that drain the stack. Assert the multiset of popped values equals the multiset pushed (no lost/duplicated values). Use a concurrent map / lock-guarded counter to tally.

**Task 5 — Count CAS retries.**
Instrument `push` and `pop` to increment an atomic counter on every *failed* CAS. Run the concurrent test from Task 4 and print total retries and retries-per-op. Observe how the number rises with thread count.

---

## Intermediate Tasks

**Task 6 — Tagged (versioned) stack to defeat ABA.**
Replace `head` with a `(ptr, tag)` pair; bump `tag` on every successful CAS.
Go: CAS an atomic pointer to an immutable `{head, tag}` snapshot.
Java: use `AtomicStampedReference`.
Python: keep `(head, tag)` and simulate a pair-CAS under the lock.
Write a comment explaining why a GC runtime did not strictly need this, and what wraparound risk a small tag carries.

**Task 7 — Demonstrate ABA with a recycling pool.**
Build a node **free list** (itself a Treiber stack) that `pop` pushes nodes onto for reuse. With two threads, construct the A→B→A interleaving (use sleeps/barriers to force the schedule) and show the *untagged* stack corrupts while the *tagged* version (Task 6) stays correct. Print an integrity check for both.

**Task 8 — Exponential backoff.**
After a failed CAS, wait a randomized interval bounded by `backoff`, doubling `backoff` each failure up to a cap. Re-run the Task 5 retry benchmark with and without backoff at `T = 2,4,8,16,32` and tabulate retries-per-op and wall-clock. Show backoff lowers retries under high contention.

**Task 9 — Bounded stack.**
Add a capacity limit: `push` returns `false` (or raises) when the stack already holds `capacity` elements. Maintain the count **without** a single shared `atomic size` hotspot if you can (hint: discuss why an exact concurrent count is itself a contention bottleneck; an approximate or per-thread sharded count is acceptable). Justify your design in a comment.

**Task 10 — `pushAll` / `popAll` batch operations.**
Implement `pushAll(vals)` that links a chain of new nodes and splices the whole chain onto `head` with a **single** CAS (point the chain's tail at `old`, CAS `head` to the chain's head). Implement `popAll()` that detaches the entire list with one CAS (`CAS(head, old, nil)`) and returns the values. Explain why batch ops reduce contention versus per-element CAS.

---

## Advanced Tasks

**Task 11 — Elimination-backoff stack.**
Layer an elimination array on the Treiber stack. On a failed `head` CAS, a `push` publishes its value in a random slot and waits briefly; a `pop` checks a random slot for an offered value and consumes it (rendezvous). Fall back to the `head` CAS on timeout. Benchmark throughput vs the plain stack at `T = 1,2,4,8,16,32,64` and show the elimination version scales where the plain one flattens or regresses. Provide starter code in all three languages (Python: structural/conceptual only).

**Task 12 — Hazard-pointer-protected pop.**
Implement a per-thread hazard slot. In `pop`: publish `old` into the hazard slot, **re-validate** `head == old` after publishing, then CAS. On success, *retire* `old` to a per-thread retired list; periodically scan all hazard slots and free any retired node not currently hazarded. (In Go/Java, "free" can be simulated by returning the node to a pool.) Demonstrate that no retired node is freed while hazarded.

**Task 13 — Epoch-based reclamation.**
Implement a global epoch counter and per-thread epoch announcements. `enter()`/`exit()` bracket each operation; retired nodes are stashed in per-epoch limbo buckets; advance the epoch and free the bucket two epochs old once all active threads have caught up. Compare its read-path cost and memory-held-back behavior with the hazard-pointer version from Task 12.

**Task 14 — Work-stealing deque (Chase–Lev sketch).**
Implement a single-owner, multiple-thief deque: the owner `pushBottom`/`popBottom` (LIFO, mostly plain stores with a single CAS on the one-element boundary), thieves `steal` (popTop, always CAS). Run a fan-out/fan-in workload across `W` workers and report steal counts and load balance. Relate the owner's end to the Treiber stack.

**Task 15 — Linearizability stress checker.**
Write a randomized concurrent tester: many threads perform random push/pop, each recording `(op, value, start_ts, end_ts)`. After the run, search for *some* sequential stack history consistent with the recorded real-time intervals (a small linearizability monitor, e.g., a brute-force or greedy matcher for short traces). Report whether a valid linearization was found. Use it to catch a deliberately-broken variant (e.g., a stack with a plain write instead of CAS).

---

## Benchmark Task

> Compare push+pop throughput across all 3 languages and across thread counts.
> Each thread does `opsPerThread` iterations of `push` then `pop`. Report ns/op.
> Expect ns/op to **rise** past the core count for the plain Treiber stack
> (single-`head` cache-line ping-pong) and to **flatten** with backoff/elimination.

#### Go

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

type node struct{ value int; next *node }
type Stack struct{ head atomic.Pointer[node] }

func (s *Stack) Push(v int) {
	n := &node{value: v}
	for { old := s.head.Load(); n.next = old; if s.head.CompareAndSwap(old, n) { return } }
}
func (s *Stack) Pop() (int, bool) {
	for {
		old := s.head.Load()
		if old == nil { return 0, false }
		if s.head.CompareAndSwap(old, old.next) { return old.value, true }
	}
}

func main() {
	for _, threads := range []int{1, 2, 4, 8, 16, 32} {
		s := &Stack{}
		const ops = 200_000
		var wg sync.WaitGroup
		start := time.Now()
		for t := 0; t < threads; t++ {
			wg.Add(1)
			go func() { defer wg.Done(); for i := 0; i < ops; i++ { s.Push(i); s.Pop() } }()
		}
		wg.Wait()
		total := threads * ops * 2
		fmt.Printf("threads=%3d %.1f ns/op\n", threads, float64(time.Since(start).Nanoseconds())/float64(total))
	}
}
```

#### Java

```java
import java.util.concurrent.atomic.AtomicReference;

public class Benchmark {
    static final class Node { final int v; Node next; Node(int v){this.v=v;} }
    static final class Stack {
        final AtomicReference<Node> head = new AtomicReference<>();
        void push(int v){ Node n=new Node(v),o; do{ o=head.get(); n.next=o; } while(!head.compareAndSet(o,n)); }
        Integer pop(){ Node o,nx; do{ o=head.get(); if(o==null) return null; nx=o.next; } while(!head.compareAndSet(o,nx)); return o.v; }
    }
    public static void main(String[] a) throws InterruptedException {
        for (int threads : new int[]{1,2,4,8,16,32}) {
            Stack s = new Stack();
            final int ops = 200_000;
            Thread[] ts = new Thread[threads];
            long start = System.nanoTime();
            for (int t=0;t<threads;t++){ ts[t]=new Thread(()->{ for(int i=0;i<ops;i++){ s.push(i); s.pop(); } }); ts[t].start(); }
            for (Thread t: ts) t.join();
            long total = (long)threads*ops*2;
            System.out.printf("threads=%3d %.1f ns/op%n", threads, (System.nanoTime()-start)/(double)total);
        }
    }
}
```

#### Python

```python
# GIL serializes bytecode: this measures contention on the simulated CAS lock,
# NOT real parallel scaling. Production Python: use queue.LifoQueue.
import threading, time


class _Node:
    __slots__ = ("v", "next")
    def __init__(self, v): self.v, self.next = v, None


class Stack:
    def __init__(self):
        self._head = None
        self._lock = threading.Lock()

    def push(self, v):
        n = _Node(v)
        while True:
            with self._lock:
                n.next = self._head
                self._head = n
                return

    def pop(self):
        while True:
            with self._lock:
                if self._head is None:
                    return None
                old = self._head
                self._head = old.next
                return old.v


for threads in (1, 2, 4, 8):
    s = Stack()
    ops = 50_000

    def work():
        for i in range(ops):
            s.push(i); s.pop()

    ts = [threading.Thread(target=work) for _ in range(threads)]
    start = time.perf_counter()
    for t in ts: t.start()
    for t in ts: t.join()
    total = threads * ops * 2
    print(f"threads={threads:>3} {(time.perf_counter()-start)/total*1e9:.1f} ns/op")
```
