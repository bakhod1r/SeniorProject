# CAS and Atomic Primitives — Interview Preparation

> Tiered questions (Junior → Middle → Senior → Professional) with answer focus, followed by a full coding challenge — a **lock-free counter** and a **Treiber-stack push via CAS** — in Go, Java, and Python. Aim to *explain the CAS loop out loud* while you code; interviewers grade reasoning about correctness and ordering as much as the code.

## Table of Contents

1. [Junior Questions](#junior)
2. [Middle Questions](#middle)
3. [Senior Questions](#senior)
4. [Professional Questions](#professional)
5. [Rapid-Fire Round](#rapid)
6. [Scenario / Design Questions](#scenario)
7. [Coding Challenge — Lock-Free Counter + Treiber Push](#challenge)
8. [Bonus Challenge — Atomic Max via CAS (Go/Java/Python)](#bonus)
9. [Whiteboard Trace Exercise](#trace)
10. [Follow-up Discussion Points](#followups)
11. [Self-Assessment Checklist](#checklist)

---

<a name="junior"></a>
## 1. Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What does "atomic" mean? | Indivisible read-modify-write; no thread observes an intermediate state or interleaves. |
| 2 | Why is `counter++` unsafe across threads? | It's read→add→write (3 steps); interleaving causes **lost updates**. |
| 3 | What does CAS do? | `CAS(addr, expected, new)` writes `new` only if `addr == expected`, atomically, and reports success/failure. |
| 4 | Write the CAS loop in words. | read `old` → compute `desired = f(old)` → CAS; if it fails (value changed), retry. |
| 5 | Difference between fetch-add and CAS? | fetch-add does `+= delta` in one hardware op; CAS lets you install any value-dependent result via a loop. |
| 6 | When prefer fetch-add over a CAS loop? | When the update is a pure add — simpler and faster (and wait-free). |
| 7 | What is `exchange` / `swap`? | Unconditionally store new, return old. CAS without the compare. |
| 8 | Why must you re-read `old` *inside* the loop? | Each retry must use fresh data; reading once outside reuses stale `old` and livelocks/fails. |
| 9 | Does Python's `+=` on a global int need protection? | Yes — the GIL narrows the window but doesn't guarantee atomicity of `+=`; use a lock or `multiprocessing.Value`. |
| 10 | Atomic load vs a mutex for reading a flag? | Atomic load is cheaper and sufficient for a single word; no need for a lock. |
| 11 | What is `test-and-set` used for? | Building a spinlock: set a flag to 1 and check its old value to learn if you acquired it. |
| 12 | Does CAS block a thread? | No — on failure it returns immediately; the thread retries. No sleeping/context switch. |
| 13 | What's the final value if 3 threads each CAS-increment a counter starting at 0, 1000 times? | 3000 — CAS guarantees no lost updates regardless of interleaving. |

**Model answer (Q2 + Q3):** "`counter++` compiles to load, add, store. Two threads can both load 41, both store 42 — one increment is lost. CAS fixes this: I read 41, compute 42, then CAS(addr, 41, 42) which writes 42 *only if* addr is still 41. If another thread already moved it to 42, my CAS fails, I re-read 42, compute 43, and retry. No update is ever lost."

---

<a name="middle"></a>
## 2. Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What is the ABA problem? | A value goes A→B→A; CAS sees "still A" and succeeds wrongly, missing that the world changed. |
| 2 | Why are integer counters immune to ABA? | The value carries no hidden identity; "5 again" means the same thing — increment still correct. |
| 3 | Name three ABA fixes. | Tagged/versioned pointer (bump a counter), hazard pointers, double-width CAS. |
| 4 | What does `AtomicStampedReference` give you? | A (reference, int stamp) pair CAS'd together; the stamp bump defeats ABA. |
| 5 | Explain acquire vs release ordering. | release on a store publishes prior writes; acquire on a load makes them visible after — forming happens-before. |
| 6 | What's wrong with `relaxed` for publishing a pointer to an init'd object? | No ordering between the field write and the pointer publish; a reader may see the pointer before the data (esp. on ARM). |
| 7 | How do you build a spinlock from an atomic? | CAS flag 0→1 to acquire (acquire order), store 0 to release (release order), spin with a pause hint. |
| 8 | fetch-add is *wait-free*; a CAS loop is only *lock-free* — why? | fetch-add finishes in bounded steps always; a CAS loop's unlucky thread can retry unboundedly while others succeed. |
| 9 | Why does a single hot `AtomicLong` scale poorly? | All threads contend one cache line; updates serialize. Use a striped `LongAdder`. |
| 10 | When is a CAS-based approach worse than a mutex? | Multi-variable invariants, long sections — CAS guards one word and composes poorly. |
| 11 | What does the GIL mean for Python atomics? | One thread runs bytecode at a time; `+=` still spans bytecodes so it's not guaranteed atomic — use locks or `multiprocessing`. |
| 12 | Why pair release with acquire and not use both as release? | Release publishes on the writer; acquire consumes on the reader — the edge only forms when a release is *read by* an acquire. |

**Model answer (Q1):** "ABA: thread T1 reads pointer A and pauses. Others pop A, pop B, and re-push A reusing the same address. T1 resumes and CAS(top, A, B) succeeds because top *is* A again — but A.next is no longer B; B was freed. The structure corrupts. The fix is to make the value never repeat: attach a version counter and CAS (pointer, version) together, e.g. `AtomicStampedReference`."

---

<a name="senior"></a>
## 3. Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Walk through a Treiber stack push and pop and where ABA strikes. | push installs a fresh node (safe); pop's CAS on top is ABA-prone; needs tag/HP or GC. |
| 2 | What is the "helping" pattern in the Michael–Scott queue? | A thread completes another's half-done op (swing a lagging tail) → keeps the structure lock-free. |
| 3 | How does exponential backoff with jitter help a contended CAS loop? | De-synchronizes contenders, cuts cache-line thrash; jitter avoids lock-step collisions. |
| 4 | What is false sharing and how do you fix it? | Independent atomics on one 64-byte line invalidate each other; pad each to its own line. |
| 5 | Why does code work on x86 but corrupt on ARM? | x86 TSO rarely reorders; ARM is weak — missing acquire/release fences surface there. |
| 6 | Compare Go's and Java's memory models for atomics. | Go: seq_cst only (simple, no knobs). Java: `AtomicX` = seq_cst, `VarHandle` exposes acquire/release/opaque. |
| 7 | What is safe memory reclamation and why is it hard lock-free? | Can't free a node a stalled thread may still read; needs hazard pointers/EBR/RCU (or a GC). |
| 8 | When would you choose a Disruptor/ring buffer over a lock-free linked queue? | Pre-allocated array, no per-node alloc, padded sequence counters; lower latency, no GC churn. |
| 9 | What's the elimination optimization on a stack? | Colliding push/pop cancel via a side array, bypassing the contended top → near-linear scaling. |
| 10 | What metric warns you of an impending contention cliff? | Rising CAS-retry rate (and `perf c2c` HITM events); instrument and alert on it. |
| 11 | How does NUMA change your striping strategy? | Home each stripe's line near its writers; pin threads; NUMA-aware alloc so writes stay local. |
| 12 | What is flat combining and when does it beat lock-free CAS? | One combiner applies all pending ops under one lock; wins by keeping the structure hot in one cache vs bouncing. |
| 13 | How do you safely roll out a lock-free replacement for a mutex? | Library first, property/linearizability tests, ARM in CI, canary/shadow, feature-flag rollback. |

**Model answer (Q4):** "Cache coherence works per 64-byte line. If two atomics that different threads update share a line, every write to one invalidates the other in the other core's L1 — they ping-pong as if one variable. Padding each hot atomic to its own line (8 bytes + 56 bytes pad, or `@Contended` in Java) removes the coupling. A striped counter only scales if its stripes are padded."

---

<a name="professional"></a>
## 4. Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | Define linearizability. | Each op takes effect at one linearization point between invoke/respond; the point-order is a legal sequential history respecting real-time order. |
| 2 | Why is linearizability composable but sequential consistency not? | Linearizability is *local*: object-wise linearizable ⇒ whole-system linearizable. SC isn't local. |
| 3 | State the progress hierarchy formally. | wait-free (bounded steps, every process) ⊃ lock-free (some process progresses) ⊃ obstruction-free (progress in isolation) ⊃ blocking. |
| 4 | What is a consensus number? | Max #processes for which an object solves wait-free consensus; a hard measure of synchronization power. |
| 5 | Consensus numbers of register, queue, CAS? | Register = 1, queue/stack/test-and-set/fetch-add = 2, CAS/LL-SC = ∞. |
| 6 | Why is CAS "universal"? | Consensus number ∞ ⇒ Herlihy's universal construction implements any sequential object wait-free using CAS. |
| 7 | Sketch 2-process (or n-process) consensus from CAS. | `CAS(C, ⊥, myVal)`; winner's value is the decision, losers read `C`. Wait-free for any n. |
| 8 | LL/SC vs CAS — key difference? | LL/SC fails on *any* intervening write (ABA-immune) but allows spurious failures; CAS compares values only. |
| 9 | What is the DRF-SC guarantee? | A data-race-free program (proper acquire/release) behaves as if sequentially consistent. |
| 10 | Define happens-before in the axiomatic model. | Transitive closure of sequenced-before ∪ synchronizes-with; release→acquire via reads-from creates the sw edge. |
| 11 | Why do registers have consensus number 1? | Bivalency/critical-state argument: a write hidden by a solo run can't create a mutually-visible irrevocable decision. |
| 12 | State the wait-free space/step cost of the universal construction. | O(n) space and O(n) steps per op (helping replays all n pending ops) — a proof, not a practical impl. |
| 13 | What is the fast-path/slow-path pattern for wait-freedom? | Cheap lock-free CAS attempts, then fall to a wait-free helping path only after starvation — pays the O(n) tax rarely. |

**Model answer (Q6):** "Herlihy showed that solving wait-free consensus among n processes is equivalent to implementing arbitrary shared objects wait-free for n processes. CAS has consensus number ∞ — the first process whose CAS on a ⊥ cell succeeds fixes the decision, for any n. So CAS can drive the universal construction: agree on a total order of operations via consensus, append to a shared log, and have every process replay it (helping) to get its response — yielding a wait-free, linearizable implementation of *any* sequential object. That's why hardware ships CAS."

---

<a name="rapid"></a>
## 5. Rapid-Fire Round

| Prompt | Answer |
|---|---|
| Go atomic add API | `atomic.Int64.Add` |
| Java +1 atomic | `AtomicLong.incrementAndGet()` |
| Java ABA-safe ref | `AtomicStampedReference` |
| Java fine ordering API | `VarHandle` (`getAcquire`/`setRelease`) |
| Java scalable counter | `LongAdder` |
| x86 CAS instruction | `LOCK CMPXCHG` |
| ARM CAS mechanism | `LDXR`/`STXR` (LL/SC) |
| Spin hint (Java) | `Thread.onSpinWait()` |
| Cache line size (typical) | 64 bytes |
| CAS consensus number | ∞ |
| fetch-add progress class | wait-free |
| CAS-loop progress class | lock-free |
| Publish data through a flag | release store + acquire load |
| Python true-parallel option | `multiprocessing` (GIL blocks threads) |
| Exchange/swap returns | the old value |
| test-and-set builds | a spinlock |
| Helping pattern upgrades | lock-free → wait-free |
| Treiber stack progress | lock-free (not wait-free) |
| Disruptor avoids | allocation + false sharing |
| LL/SC immune to | the ABA problem |

---

<a name="scenario"></a>
## 6. Scenario / Design Questions

These are open-ended; interviewers want a structured discussion, not a single right answer.

**S1. "We have a global request counter that's now the hottest line in our service — QPS dropped after we added it. Diagnose and fix."**
Lead with: a single atomic counter serializes on one cache line; every core's increment invalidates it elsewhere (cache-line ping-pong), worse across NUMA sockets. Fix: **stripe** it — per-core/per-thread padded cells (`LongAdder` in Java, padded `[N]atomic.Int64` in Go), summed on read. Confirm by measuring throughput vs thread count before/after, and watch `perf c2c` HITM events. Mention that if exact real-time reads aren't needed, an approximate periodically-summed counter is even cheaper.

**S2. "Design a lock-free bounded MPMC queue for a low-latency trading path."**
Reach for a **ring buffer / Disruptor**: pre-allocated array (no per-node alloc, no GC churn), producers `fetch-add` a claim sequence, consumers track a published cursor; pad all sequence counters to their own cache lines to kill false sharing. Discuss backpressure when full, the publish cursor with release/acquire ordering, and why array-based beats linked-node for tail latency (no pointer chasing, no allocation).

**S3. "Your lock-free stack passes all tests but corrupts data once a week in production. What's your hypothesis?"**
Two leading suspects: (1) **ABA** — a rare interleaving where `top` cycles to the same node; fix with a tagged pointer / hazard pointers (and note GC prevents the *crash* but not the *logical* corruption). (2) A **memory-ordering** bug invisible on x86 but exposed on ARM hosts in the fleet; fix with proper release/acquire and add ARM to CI. Emphasize: instrument the **CAS-retry rate** and add jcstress/`-race` property tests.

**S4. "When would you deliberately choose a mutex over a lock-free design?"**
When the critical section spans multiple variables (compound invariant a single CAS can't cover), when the section is long, when contention is low (a mutex is then just as fast and far simpler), or when correctness/maintainability matters more than the last few hundred nanoseconds. "Make it correct and simple first; go lock-free only when profiling proves the lock is the bottleneck."

**S5. "Explain to a junior why `x++` is unsafe but `atomic.Add(&x,1)` is safe, in one minute."**
`x++` is read-add-write — three steps two threads can interleave, losing an update. `atomic.Add` performs the same read-add-write as one indivisible hardware instruction (`LOCK XADD`), so no interleaving is possible and no increment is lost.

---

<a name="challenge"></a>
## 7. Coding Challenge — Lock-Free Counter + Treiber Push

> **Task.** Implement (a) a thread-safe counter using an **explicit CAS loop** (not fetch-add — show you understand the loop), and (b) `push` for a **Treiber stack** using CAS. Both must be correct under concurrent access.

### Go

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

// (a) Lock-free counter via explicit CAS loop.
type Counter struct{ v atomic.Int64 }

func (c *Counter) Inc() {
	for {
		old := c.v.Load()                    // read
		if c.v.CompareAndSwap(old, old+1) {  // compute + CAS
			return
		}
		// CAS failed -> someone else incremented; retry
	}
}
func (c *Counter) Get() int64 { return c.v.Load() }

// (b) Treiber stack push via CAS.
type node struct {
	val  int
	next *node
}
type Stack struct{ top atomic.Pointer[node] }

func (s *Stack) Push(v int) {
	n := &node{val: v}
	for {
		t := s.top.Load()        // read current top
		n.next = t               // point new node at it
		if s.top.CompareAndSwap(t, n) { // publish atomically
			return
		}
		// top changed -> retry
	}
}
func (s *Stack) Pop() (int, bool) {
	for {
		t := s.top.Load()
		if t == nil {
			return 0, false
		}
		if s.top.CompareAndSwap(t, t.next) {
			return t.val, true
		}
	}
}

func main() {
	var c Counter
	var s Stack
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for j := 0; j < 100_000; j++ {
				c.Inc()
			}
			s.Push(id)
		}(i)
	}
	wg.Wait()
	fmt.Println("counter =", c.Get()) // 800000
	cnt := 0
	for {
		if _, ok := s.Pop(); !ok {
			break
		}
		cnt++
	}
	fmt.Println("pushed items popped =", cnt) // 8
}
```

### Java

```java
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

public class Challenge {

    // (a) Lock-free counter via explicit CAS loop.
    static final class Counter {
        private final AtomicLong v = new AtomicLong(0);
        void inc() {
            while (true) {
                long old = v.get();                  // read
                if (v.compareAndSet(old, old + 1))   // compute + CAS
                    return;
                // retry on failure
            }
        }
        long get() { return v.get(); }
    }

    // (b) Treiber stack push via CAS.
    static final class Stack<T> {
        static final class Node<T> { final T val; Node<T> next; Node(T v){val=v;} }
        private final AtomicReference<Node<T>> top = new AtomicReference<>(null);
        void push(T v) {
            Node<T> n = new Node<>(v);
            while (true) {
                Node<T> t = top.get();        // read
                n.next = t;                   // link
                if (top.compareAndSet(t, n))  // publish
                    return;
            }
        }
        T pop() {
            while (true) {
                Node<T> t = top.get();
                if (t == null) return null;
                if (top.compareAndSet(t, t.next)) return t.val;
            }
        }
    }

    public static void main(String[] args) throws InterruptedException {
        Counter c = new Counter();
        Stack<Integer> s = new Stack<>();
        Thread[] ts = new Thread[8];
        for (int i = 0; i < 8; i++) {
            final int id = i;
            ts[i] = new Thread(() -> {
                for (int j = 0; j < 100_000; j++) c.inc();
                s.push(id);
            });
            ts[i].start();
        }
        for (Thread t : ts) t.join();
        System.out.println("counter = " + c.get()); // 800000
        int cnt = 0;
        while (s.pop() != null) cnt++;
        System.out.println("pushed items popped = " + cnt); // 8
    }
}
```

### Python

```python
import threading

# Python has no lock-free CAS; the GIL serializes bytecode. We implement the
# SAME CAS-LOOP STRUCTURE but make the compare-and-set atomic with a lock,
# which is what real Python code does. The loop is identical to Go/Java.

class _Cas:
    """A cell with an atomic compare_and_set (lock-backed)."""
    def __init__(self, value=None):
        self._v = value
        self._g = threading.Lock()
    def load(self):
        with self._g:
            return self._v
    def cas(self, expected, new):
        with self._g:
            if self._v is expected or self._v == expected:
                self._v = new
                return True
            return False

# (a) Counter via explicit CAS loop.
class Counter:
    def __init__(self):
        self._cell = _Cas(0)
    def inc(self):
        while True:
            old = self._cell.load()            # read
            if self._cell.cas(old, old + 1):   # compute + CAS
                return
    def get(self):
        return self._cell.load()

# (b) Treiber stack push via CAS. Nodes are (value, next) tuples.
class Stack:
    def __init__(self):
        self._top = _Cas(None)
    def push(self, v):
        while True:
            t = self._top.load()               # read top
            n = (v, t)                          # link new node
            if self._top.cas(t, n):             # publish
                return
    def pop(self):
        while True:
            t = self._top.load()
            if t is None:
                return None
            value, nxt = t
            if self._top.cas(t, nxt):
                return value

if __name__ == "__main__":
    c, s = Counter(), Stack()
    def work(idx):
        for _ in range(50_000):
            c.inc()
        s.push(idx)
    threads = [threading.Thread(target=work, args=(i,)) for i in range(8)]
    for t in threads: t.start()
    for t in threads: t.join()
    print("counter =", c.get())                # 400000
    cnt = 0
    while s.pop() is not None:
        cnt += 1
    print("pushed items popped =", cnt)         # 8
```

**Grading rubric:**
- Read happens *inside* the loop (correctness) — must-have.
- CAS used, not a plain store — must-have.
- Push links `n.next = t` *before* the CAS — must-have.
- Mentions ABA on pop and that GC (Go/Java) or a tag protects it — strong signal.
- Notes Python's GIL / lock substitution — strong signal.

---

<a name="bonus"></a>
## 8. Bonus Challenge — Atomic Max via CAS (Go/Java/Python)

> **Task.** Maintain the maximum value ever offered by concurrent threads. This *cannot* be done with fetch-add — the new value depends on the old in a non-additive way — so it is the canonical "you really need a CAS loop" exercise. Short-circuit when the candidate can't beat the current max.

### Go

```go
import "sync/atomic"

func AtomicMax(addr *atomic.Int64, candidate int64) {
	for {
		old := addr.Load()
		if candidate <= old {
			return // current max already wins; no CAS needed
		}
		if addr.CompareAndSwap(old, candidate) {
			return
		}
		// lost the race; re-read and re-check
	}
}
```

### Java

```java
import java.util.concurrent.atomic.AtomicLong;

static void atomicMax(AtomicLong addr, long candidate) {
    while (true) {
        long old = addr.get();
        if (candidate <= old) return;
        if (addr.compareAndSet(old, candidate)) return;
    }
}
// JDK shortcut for this exact pattern:
//   addr.accumulateAndGet(candidate, Math::max);
```

### Python

```python
# Lock-backed CAS cell (Python has no hardware CAS). Loop is identical to Go/Java.
import threading

class Cell:
    def __init__(self, v=0):
        self._v = v
        self._g = threading.Lock()
    def load(self):
        with self._g:
            return self._v
    def cas(self, expected, new):
        with self._g:
            if self._v == expected:
                self._v = new
                return True
            return False

def atomic_max(cell, candidate):
    while True:
        old = cell.load()
        if candidate <= old:
            return
        if cell.cas(old, candidate):
            return
```

**Why fetch-add fails here:** fetch-add can only add a fixed delta; "keep the larger of old and candidate" is a value-dependent decision, so you must read, decide, and conditionally install via CAS. The short-circuit (`candidate <= old`) avoids needless CAS traffic when the candidate loses.

---

<a name="trace"></a>
## 9. Whiteboard Trace Exercise

> Interviewers love asking you to *trace* an interleaving. Practice this one out loud. Shared `counter = 9`. Threads A and B each run one CAS-loop increment. Fill in the table for the interleaving A-read, B-read, A-compute, B-compute, A-CAS, B-CAS.

| Step | Actor | Action | A.old | B.old | shared | Result |
|---|---|---|---|---|---|---|
| 1 | A | read | 9 | – | 9 | — |
| 2 | B | read | 9 | 9 | 9 | — |
| 3 | A | compute 9+1 | 9 | 9 | 9 | desired=10 |
| 4 | B | compute 9+1 | 9 | 9 | 9 | desired=10 |
| 5 | A | CAS(9→10) | 9 | 9 | **10** | **success** |
| 6 | B | CAS(9→10) | 9 | 9 | 10 | **fail** (shared≠9) |
| 7 | B | re-read | 9 | **10** | 10 | fresh read |
| 8 | B | compute 10+1 | 9 | 10 | 10 | desired=11 |
| 9 | B | CAS(10→11) | 9 | 10 | **11** | **success** |

Final: `counter = 11`. Both increments counted; B retried once. Expected talking point: **the failed CAS at step 6 is what prevents the lost update** — B re-reads instead of blindly writing 10.

---

<a name="followups"></a>
## 10. Follow-up Discussion Points

- "Make the counter wait-free." → switch to `fetch-add` / `incrementAndGet`; explain wait-free vs lock-free.
- "Now it's the hottest line in the system." → stripe it (`LongAdder` / padded cells), discuss false sharing.
- "Make pop ABA-safe without a GC." → tagged pointer / hazard pointers / DCAS.
- "Prove your stack is correct." → linearization points at the successful CAS; lock-free progress argument.
- "Why might this corrupt on ARM but not x86?" → weak vs TSO memory model; need acquire/release (Go gives seq_cst free; Java via `VarHandle`).
- "Add backoff." → exponential backoff with jitter + `onSpinWait`/`Gosched`.
- "Make it wait-free, not just lock-free." → fast-path/slow-path with helping (Kogan–Petrank); explain the O(n) wait-free tax.
- "How would you test this?" → jcstress (JVM), `go test -race`, randomized linearizability checking against a sequential model; CI on ARM.

---

<a name="checklist"></a>
## 11. Self-Assessment Checklist

Tick these before claiming you "know CAS." If any are shaky, revisit the linked level file.

- [ ] I can explain why `counter++` loses updates (3-step RMW). — *junior*
- [ ] I can write the CAS loop from memory and explain why the read is *inside* the loop. — *junior*
- [ ] I know when to use fetch-add vs a CAS loop, and that fetch-add is wait-free. — *junior/middle*
- [ ] I can describe the ABA problem and name three fixes (tag, hazard pointers, DCAS). — *middle*
- [ ] I can explain release/acquire and the happens-before edge they create. — *middle*
- [ ] I can build a correct spinlock and say why the ordering matters. — *middle*
- [ ] I can trace a Treiber stack push/pop and point out where ABA strikes. — *senior*
- [ ] I can explain false sharing and fix it with cache-line padding. — *senior*
- [ ] I know why x86 code may break on ARM (TSO vs weak memory). — *senior*
- [ ] I can state the progress hierarchy (wait/lock/obstruction-free) precisely. — *professional*
- [ ] I can explain consensus number and why CAS = ∞ (universality). — *professional*
- [ ] I can argue Treiber-stack linearizability via linearization points. — *professional*

---

**Next step:** [tasks.md](./tasks.md) — graded hands-on tasks (beginner → advanced) plus a contention benchmark across Go, Java, and Python.
