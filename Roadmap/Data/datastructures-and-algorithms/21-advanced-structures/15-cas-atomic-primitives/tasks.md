# CAS and Atomic Primitives — Practice Tasks

> Solve every task in **Go**, **Java**, and **Python**. In Go use `sync/atomic`; in Java use `java.util.concurrent.atomic` / `VarHandle`; in Python note the **GIL** and use locks or `multiprocessing` (true lock-free CAS is unavailable in pure Python — simulate the loop with a lock and say so). For each task: state the expected output, then verify it is correct under many threads/processes.

---

## Beginner Tasks

**Task 1 — Reproduce the lost-update bug.**
Spawn 4 threads that each do `counter++` (a *plain* int, no synchronization) one million times. Print the final value across several runs and observe it is reliably less than 4,000,000.
- Constraints: no atomics, no locks — the point is to *see* the race.
- Expected Output: a wrong, non-deterministic number (< 4,000,000) on Go/Java; on Python it may *look* right due to the GIL — explain why that's luck, not correctness.
- Evaluation: you can articulate that `++` is read-modify-write and interleaving loses updates.

```go
// Go starter
package main
func main() {
	var counter int
	// 4 goroutines, each counter++ 1_000_000 times, then print counter
}
```

```java
// Java starter
public class Task1 {
    static int counter = 0;
    public static void main(String[] a) throws InterruptedException {
        // 4 threads, each counter++ 1_000_000 times, then print
    }
}
```

```python
# Python starter
import threading
counter = 0
def task():
    global counter
    # counter += 1, 1_000_000 times
if __name__ == "__main__":
    pass  # spawn 4 threads, join, print counter
```

**Task 2 — Fix it with fetch-add.**
Replace the plain int with an atomic and use the fetch-add API (`Add` / `incrementAndGet` / `multiprocessing.Value`+lock). Confirm the result is *always* exactly 4,000,000.
- Constraints: use the single-instruction add, not a CAS loop.
- Expected Output: `4000000` every run.

**Task 3 — Implement increment with an explicit CAS loop.**
Write `casInc()` that loops: load `old`, compute `old+1`, CAS; retry on failure. Drive it from 4 threads × 250,000 increments and verify `1,000,000`.
- Constraints: must re-read `old` *inside* the loop.
- Expected Output: `1000000`.

**Task 4 — Atomic boolean flag.**
Implement a one-shot "done" flag: many worker threads run until a separate thread sets the flag with an atomic store; workers read it with an atomic load and stop. No torn reads, no busy mutex.
- Expected Output: all workers stop promptly after the flag flips.

**Task 5 — Atomic exchange.**
Use `Swap` / `getAndSet` to atomically replace a shared value and return the previous one. Have two threads alternately swap in their IDs and log the value each one displaced; show no value is lost or duplicated.
- Expected Output: a clean handoff log; every swapped-out value accounted for once.

---

## Intermediate Tasks

**Task 6 — Atomic maximum via CAS.**
Implement `atomicMax(addr, candidate)` that keeps the largest value ever offered, using a CAS loop (fetch-add can't do this). Feed it random values from many threads; verify the final value equals the true global maximum.
- Constraints: short-circuit when `candidate <= old`.
- Expected Output: the maximum of all offered values.

**Task 7 — test-and-set spinlock.**
Build a spinlock from one atomic flag: acquire by CAS-ing 0→1 (spin on failure with a pause hint), release by storing 0. Protect a shared counter with it and verify correctness under 8 threads.
- Constraints: keep the critical section tiny; add `onSpinWait`/`Gosched`/yield.
- Expected Output: correct counter total; note this is pointless in Python under the GIL (use `threading.Lock`).

**Task 8 — Treiber stack (push + pop).**
Implement a lock-free stack with CAS on the `top` pointer. Run concurrent pushers and poppers; assert the multiset of popped values equals the multiset pushed.
- Constraints: link `n.next` before the CAS; loop on failure.
- Expected Output: no lost or duplicated elements.

**Task 9 — Demonstrate ABA.**
Construct an ABA scenario on a pointer-CAS stack (use a controlled interleaving / injected pause) where a naive pop's CAS succeeds wrongly. Then re-run with a **tagged/versioned** pointer (`AtomicStampedReference` in Java; packed ptr+tag in Go) and show the tag bump prevents the bad CAS.
- Expected Output: corruption visible in the naive version; correct behavior with tags.

**Task 10 — Striped counter vs single atomic.**
Implement (a) a single atomic counter and (b) a striped counter (one padded cell per thread/CPU, summed on read). Increment heavily from many threads; print both totals (equal) and the time taken (striped should win under contention).
- Constraints: pad stripes to 64 bytes to avoid false sharing.
- Expected Output: equal totals; striped is faster under high thread counts.

---

## Advanced Tasks

**Task 11 — Michael–Scott lock-free queue.**
Implement an MS queue with a sentinel node, CAS-based enqueue (two-step: CAS `tail.next`, then swing `tail`), and the **helping** rule (swing a lagging tail you observe). Verify FIFO order and no lost items under concurrent producers/consumers.
- Constraints: handle the lagging-tail case; loop on every CAS.
- Expected Output: items dequeued in correct relative order, none lost.

**Task 12 — Exponential backoff with jitter.**
Add jittered exponential backoff to a contended CAS loop (counter or stack). Measure CAS-retry counts and throughput with and without backoff under 32+ threads.
- Expected Output: lower retry counts and higher throughput with backoff under heavy contention.

**Task 13 — Expose and fix false sharing.**
Place two atomics on the same cache line, hammer each from a different thread, and measure throughput. Then pad them onto separate lines and measure again.
- Constraints: use 64-byte padding / `@Contended` / `alignas`.
- Expected Output: a large throughput jump after padding (often 2–10×).

**Task 14 — Wait-free 2-process consensus from CAS.**
Implement `decide(myVal)` using a single `CAS(C, ⊥, myVal)`: the first to succeed fixes the decision; others read `C`. Verify both processes/threads agree and the decided value was proposed.
- Expected Output: identical decision in all participants; validity holds.

**Task 15 — Acquire/release publication test.**
Build the classic publish pattern: thread A writes a data object then publishes a pointer; thread B reads the pointer then the data. First show it with a *relaxed*-style publish (where the language allows) and reason about why it could observe partial initialization on weak hardware; then fix it with release/acquire (or Go's seq_cst atomics) so B always sees fully-initialized data.
- Expected Output: with correct ordering, B never reads a partially-initialized object.

---

## Benchmark Task

> Compare counter throughput across all 3 languages and across approaches: plain (buggy, for reference), single atomic fetch-add, CAS loop, and striped. Sweep thread counts {1, 2, 4, 8, 16, 32} and plot/print ops-per-second. Identify the **contention cliff** where a single hot atomic stops scaling, and confirm the striped version scales past it.

### Go

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

func benchAtomic(threads, iters int) time.Duration {
	var c atomic.Int64
	var wg sync.WaitGroup
	start := time.Now()
	for i := 0; i < threads; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); for j := 0; j < iters; j++ { c.Add(1) } }()
	}
	wg.Wait()
	return time.Since(start)
}

func main() {
	for _, t := range []int{1, 2, 4, 8, 16, 32} {
		d := benchAtomic(t, 1_000_000)
		fmt.Printf("threads=%2d single-atomic: %v\n", t, d)
		// TODO: add CAS-loop and striped variants; compare the curves.
	}
}
```

### Java

```java
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.LongAdder;

public class Benchmark {
    static long timeMs(Runnable r) {
        long t = System.nanoTime(); r.run(); return (System.nanoTime() - t) / 1_000_000;
    }
    public static void main(String[] args) throws InterruptedException {
        int[] threads = {1, 2, 4, 8, 16, 32};
        for (int n : threads) {
            AtomicLong atomic = new AtomicLong();
            LongAdder adder = new LongAdder();
            // Run n threads x 1_000_000 incrementAndGet vs adder.increment;
            // print ms for each. LongAdder should stay flat as n grows.
            System.out.printf("threads=%2d ...%n", n);
        }
    }
}
```

### Python

```python
import multiprocessing as mp
import time

# Threads can't run Python in parallel (GIL): measure multiprocessing.
# A single shared mp.Value (locked) = the contended "hot" case;
# private per-process accumulators summed at the end = the striped case.
def hot_worker(value, lock, iters):
    for _ in range(iters):
        with lock:
            value.value += 1

def striped_worker(idx, ret, iters):
    c = 0
    for _ in range(iters):
        c += 1
    ret[idx] = c

if __name__ == "__main__":
    for n in (1, 2, 4, 8):
        v = mp.Value('q', 0); lk = mp.Lock()
        start = time.time()
        ps = [mp.Process(target=hot_worker, args=(v, lk, 200_000)) for _ in range(n)]
        for p in ps: p.start()
        for p in ps: p.join()
        print(f"procs={n:>2} hot-locked: {time.time()-start:.3f}s")
        # TODO: run the striped variant and compare; expect striped to scale.
```

**Deliverable:** a short write-up of where each approach's curve bends, which scales, and *why* (cache-line contention, GIL, wait-free vs lock-free).
