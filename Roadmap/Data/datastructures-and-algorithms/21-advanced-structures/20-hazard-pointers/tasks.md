# Hazard Pointers — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.
> Go: atomic pointers + per-thread hazard slots. Java: `AtomicReferenceArray`.
> Python: conceptual model (GIL serializes, but keep the exact step sequence).

## Beginner Tasks

**Task 1: Implement a single hazard slot with protect/clear.**
Build a `HazardSlot` type with `protect(loadFn)` (publish + validate + retry) and
`clear()`. Demonstrate protecting a pointer read from a shared atomic head.

#### Go

```go
package main

import "sync/atomic"

type Node struct{ value int; next *Node }

type HazardSlot struct{ /* TODO: atomic.Pointer[Node] */ }

func (h *HazardSlot) Protect(load func() *Node) *Node {
	// TODO: read, publish, validate, retry
	return nil
}
func (h *HazardSlot) Clear() { /* TODO */ }

func main() {
	var head atomic.Pointer[Node]
	head.Store(&Node{value: 7})
	// TODO: protect, print value, clear
}
```

#### Java

```java
import java.util.concurrent.atomic.*;

public class Task1 {
    static class Node { int value; Node next; Node(int v){value=v;} }
    // TODO: HazardSlot using AtomicReference<Node>
    public static void main(String[] args) {
        AtomicReference<Node> head = new AtomicReference<>(new Node(7));
        // TODO: protect, print, clear
    }
}
```

#### Python

```python
class Node:
    def __init__(self, value, nxt=None):
        self.value, self.next = value, nxt

class HazardSlot:
    def __init__(self): self._ptr = None
    def protect(self, load):
        # TODO: read, publish, validate, retry
        pass
    def clear(self): self._ptr = None

if __name__ == "__main__":
    head = Node(7)
    # TODO: protect, print, clear
```

- **Constraints:** the validate re-read must be present; handle a null load.
- **Expected Output:** the protected value, then a cleared slot.
- **Evaluation:** correct protect/validate/clear sequence.

**Task 2: Implement a retire list and a scan.**
Maintain a `retired []*Node` and a `scan(slots)` that frees (record value of)
nodes absent from all slots and keeps the rest. Provide starter code in all 3
languages.
- Constraints: scan must keep nodes present in any slot; build a protected set.

**Task 3: Detect a use-after-free without hazard pointers.**
Write a tiny Treiber-stack `pop` that frees immediately (no HP). Construct a
two-thread interleaving (or simulated step trace) where one thread reads a node's
`next` after the other freed it. Print the trace showing the bug.
- Constraints: demonstrate the danger window explicitly.

**Task 4: Add a hazard pointer to fix Task 3.**
Take the buggy pop and insert protect → validate → clear so the bug disappears.
Show the same interleaving now reads live memory.
- Constraints: only the HP additions may change; the bug must be gone.

**Task 5: Count protected vs reclaimable nodes.**
Given a set of hazard slots and a retire list, write a function returning
`(pinnedCount, freeableCount)`. Provide starter code in all 3 languages.
- Constraints: O(R + H·K) using a set for the protected addresses.

## Intermediate Tasks

**Task 6: Full Treiber stack with hazard-pointer pop.**
Implement `Push`, `Pop(slot)` (protect/validate/CAS/clear/retire), `retire`, and
`scan`. Verify pushing 1..5 and popping all yields 5..1 with no use-after-free.
Provide starter code in all 3 languages.
- Constraints: K = 1; retire instead of free.

**Task 7: Threshold-based reclamation.**
Add a retire threshold of `2·H·K`; trigger `scan` only when the retire list
crosses it. Log each scan and how many nodes it freed.
- Constraints: show amortization — most retires do not scan.

**Task 8: Michael–Scott queue dequeue with 2 slots.**
Implement a lock-free MS queue `dequeue` that protects both `head` and `head.next`
(K = 2), then retires the dummy. Verify FIFO order.
- Constraints: both slots used; validate after each protect.

**Task 9: O(1) membership scan.**
Replace a linear scan (O(R·H·K)) with one that builds a hash/identity set of
protected pointers (O(R + H·K)). Benchmark both on R = 10⁵, H·K = 64.
- Constraints: report the speedup.

**Task 10: Slot acquire/release pool.**
Implement a domain that hands out hazard slots from a reusable pool: `acquire()`
returns a free slot index, `release(i)` clears and returns it. Show two threads
reusing slots.
- Constraints: a released slot's pointer must be null before reuse.

## Advanced Tasks

**Task 11: Concurrent stress test.**
Run N producer and M consumer goroutines/threads on the hazard-pointer stack for
1e6 operations; assert no value is freed while any slot references it and the
multiset of pushed == popped. Provide starter code in all 3 languages.
- Constraints: use a race detector (`go test -race`) where available.

**Task 12: Bounded-memory assertion.**
Instrument the domain to track max retired-but-unfreed nodes during Task 11.
Assert it never exceeds `H·K + H·R`. Plot or log the high-water mark.
- Constraints: empirically confirm the Θ(H²·K) bound.

**Task 13: Hazard pointers vs reference counting.**
Implement the same stack with (a) hazard pointers and (b) per-node atomic
reference counts. Benchmark pop throughput and peak memory under 8 threads.
- Constraints: report read-cost vs memory trade-off.

**Task 14: Async background reclaimer.**
Move `scan` to a dedicated background thread signaled when pending memory crosses
a cap; fall back to inline scan under back-pressure. Show foreground latency drops.
- Constraints: foreground threads must never block on scan in the common case.

**Task 15: Detect a missing fence.**
Construct a model (or relaxed-atomics build) where the publish/validate pair has
**no** StoreLoad fence and show the protection can be violated (validate reordered
before publish). Then add the fence and show it is fixed.
- Constraints: explain why the fence restores safety, referencing the proof.

## Benchmark Task

> Compare protect/validate hot-path cost across all 3 languages.

#### Go

```go
package main

import (
	"fmt"
	"sync/atomic"
	"time"
)

type Node struct{ value int; next *Node }

func main() {
	var head atomic.Pointer[Node]
	head.Store(&Node{value: 1})
	var hp atomic.Pointer[Node]
	sizes := []int{1000, 10000, 100000, 1000000}
	for _, n := range sizes {
		start := time.Now()
		for i := 0; i < n; i++ {
			p := head.Load()
			hp.Store(p)
			_ = head.Load() == p // validate
			hp.Store(nil)
		}
		fmt.Printf("iters=%8d: %.3f ns/op\n",
			n, float64(time.Since(start).Nanoseconds())/float64(n))
	}
}
```

#### Java

```java
import java.util.concurrent.atomic.AtomicReference;

public class Benchmark {
    public static void main(String[] args) {
        AtomicReference<Object> head = new AtomicReference<>(new Object());
        AtomicReference<Object> hp = new AtomicReference<>();
        int[] sizes = {1_000, 10_000, 100_000, 1_000_000};
        for (int n : sizes) {
            long start = System.nanoTime();
            for (int i = 0; i < n; i++) {
                Object p = head.get();
                hp.set(p);
                boolean ok = head.get() == p; // validate
                hp.set(null);
            }
            long elapsed = System.nanoTime() - start;
            System.out.printf("iters=%8d: %.3f ns/op%n", n, elapsed / (double) n);
        }
    }
}
```

#### Python

```python
import timeit

class Box:
    __slots__ = ("p",)

head = Box(); head.p = object()
hp = Box(); hp.p = None
sizes = [1_000, 10_000, 100_000]
for n in sizes:
    def work():
        p = head.p
        hp.p = p
        _ = head.p is p   # validate
        hp.p = None
    t = timeit.timeit(work, number=n)
    print(f"iters={n:>8}: {t/n*1e9:.1f} ns/op")
```
