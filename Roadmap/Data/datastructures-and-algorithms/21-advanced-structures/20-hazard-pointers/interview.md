# Hazard Pointers — Interview Preparation

This file contains 45 tiered questions with answer focus, followed by a full
coding challenge (protect + retire + scan for a Treiber-stack pop) in Go, Java,
and Python.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Rapid-Fire Round](#rapid-fire-round)
6. [Coding Challenge](#coding-challenge)
7. [Challenge Solutions](#challenge-solutions)

---

## Junior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 1 | What problem do hazard pointers solve? | Use-after-free / safe memory reclamation in lock-free structures |
| 2 | What is a use-after-free bug? | Dereferencing memory already freed; crash/corruption/exploit |
| 3 | What is a hazard pointer (one sentence)? | A per-thread slot publishing a pointer a thread is about to dereference |
| 4 | What are the two main steps a reader does? | Protect (publish) before dereference, then clear after |
| 5 | Why don't we just free a node immediately on removal? | Another thread may still hold a reference → use-after-free |
| 6 | What is a retire list? | Thread-local list of unlinked nodes waiting to be freed |
| 7 | What does "scan" mean here? | Read all hazard slots to find which retired nodes are still protected |
| 8 | When is a retired node actually freed? | When no hazard slot references it during a scan |
| 9 | What is the time complexity of protect? | O(1) amortized — a store, a fence, a re-read |
| 10 | Name one production user of hazard pointers. | folly, Concurrency Kit, or C++26 std::hazard_pointer |

**Sample full answers**

**Q1.** Lock-free structures unlink a node with a single CAS, but cannot know when
it is safe to `free` that node — another thread may still hold a raw pointer to
it. Hazard pointers let each thread publish the pointer it is about to dereference,
so a remover defers freeing until no slot references the node. They solve **safe
memory reclamation**.

**Q5.** In a lock-free stack there is a window between reading `head` and
dereferencing it. If a node is freed in that window, the reader touches freed
memory. Without locks there is nothing stopping the concurrent free, so we must
defer it via retire + scan instead.

**Q7.** A scan reads every hazard slot in the system to build the set of
currently-protected addresses. Then it walks the retire list and frees only nodes
**not** in that set; protected nodes stay on the list and are reconsidered on the
next scan. The scan is the bridge between "a node was removed" and "a node is
safe to free."

**Q8.** A retired node is freed during the first scan that finds **no** hazard
slot pointing at it. As long as any thread has published its address, freeing is
deferred. Once every such thread clears its slot, the next scan reclaims it.

---

## Middle Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 11 | Walk through the protect/validate retry loop. | Read src, publish, fence, re-read, retry on mismatch |
| 12 | Why is the validate re-read mandatory? | Node may be removed/retired between read and publish |
| 13 | Why is a memory fence needed between publish and validate? | Prevent reordering the validate before the publish |
| 14 | How do hazard pointers solve the ABA problem? | Pinned node can't be freed → can't be reallocated at same address |
| 15 | How is reclamation amortized to O(1)? | Threshold ≈ 2HK; each scan frees ~half the list |
| 16 | What sets the retire threshold? | ~(1+α)·H·K so a scan frees Ω(H·K) nodes |
| 17 | Hazard pointers vs reference counting? | External slots vs per-object refcount; bounded memory vs per-access atomics |
| 18 | How many slots does a Treiber stack pop need? | One (only `head`) |
| 19 | How many for a Michael–Scott queue dequeue? | Two (`head` and `head.next`) |
| 20 | What happens if a thread forgets to clear its slot? | Node pinned forever; reclamation stalls / leak |
| 21 | What is the danger window? | Between reading the shared pointer and publishing it |
| 22 | Can hazard pointers protect arbitrarily many nodes? | No — at most K simultaneously per thread |
| 23 | Why thread-local retire lists? | Avoid contention; merge globally only at exit |

**Sample full answers**

**Q12.** Between reading `head` and storing it into the slot, another thread may
pop and retire that node. If you skip validation you could publish a pointer to a
node that is about to be (or has been) freed. The re-read confirms the pointer is
still in the structure at publish time; on mismatch you retry. Without it the race
re-opens.

**Q14.** ABA's dangerous form comes from memory reuse: a node is freed and
reallocated at the same address, so a CAS matches the old bits but the object is
logically different. A hazard pointer **pins** the node — it cannot be freed while
protected, hence it cannot be reallocated, so the "A" you CAS on is genuinely the
same object. Pure counter ABA without reuse still needs tagged pointers, but for
pointer-based structures HP eliminates the common case.

**Q15.** Set the retire threshold to ~`2HK`. After any scan at most `HK` nodes
remain pinned, so a list of `2HK` has at least `HK` reclaimable; the O(HK) scan
frees Ω(HK) nodes. Cost per node = O(HK)/Ω(HK) = O(1) amortized.

---

## Senior Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 24 | Design a reclamation domain. | Slot table, per-thread retire lists, scan policy, lifecycle |
| 25 | How do you size scan frequency? | Proportional to retirement; too frequent thrashes, too rare spikes |
| 26 | Why are hazard pointers bounded but RCU isn't? | A stalled reader pins K slots, not unbounded retired history |
| 27 | How does a thread acquire/release a slot? | List of records, CAS active flag, reuse on release |
| 28 | How to share one domain across stack, queue, map? | Size K = max; type-erased retire with deleter |
| 29 | Sync vs async reclamation trade-off? | Inline latency spike vs background thread + more held memory |
| 30 | What metrics would you alert on? | Pending memory, scan p99, reclaimed-per-scan, slot high-water |
| 31 | How does scan stay efficient at scale? | Hash/sorted protected set → O(R + HK) not O(R·HK) |
| 32 | What if a thread crashes holding a slot? | Pinned node leaks; need dead-thread slot reclamation |
| 33 | How do hazard pointers interact with the allocator? | free returns memory; pinning blocks reuse, avoiding ABA |
| 34 | Where do hazard pointers fit vs epochs in a read-mostly cache? | Epochs/RCU cheaper reads; HP if memory must be bounded |

**Sample full answers**

**Q26.** RCU/EBR track *time* (grace periods/epochs): a reader that stalls
prevents the global epoch from advancing, so **every** object retired during the
stall stays pinned — unbounded. Hazard pointers track *objects*: a stalled reader
pins only the ≤K addresses in its slots. Hence the Θ(H·K) bound holds regardless
of stall duration.

**Q31.** A naive scan does O(H·K) work per retired node (linear search of slots) →
O(R·H·K). Build the protected set once into a hash set (or sort it), then each
membership test is O(1)/O(log) → scan is O(R + H·K). This is what keeps amortized
reclamation O(1).

**Q24.** A reclamation domain owns four things: (1) a **slot table** — a growable
list of hazard records, each with an atomic pointer and an `active` flag, handed
out to threads on `acquire` and reused on `release`; (2) **per-thread retire
lists** keyed to avoid contention; (3) a **scan policy** with a threshold ≈ 2·H·K
and an O(1) membership test; (4) **lifecycle** handling so a thread that exits
returns its slots and any node it pinned eventually frees. Operations are
type-erased: `retire(ptr, deleter)` lets one domain reclaim mixed types, so a
stack (K=1), a queue (K=2), and a map (K=3) can share it, sized to K=3.

**Q29.** Inline scanning makes the retiring thread pay the scan latency — a
periodic spike on the request path every R retires. A background reclaimer moves
that work to a dedicated thread so foreground latency stays flat, but the
producer can outrun it, so pending (held) memory rises. The standard compromise is
background reclamation with a **back-pressure cap**: if pending exceeds a limit,
the retiring thread does an inline scan, trading a rare latency spike for a hard
memory ceiling.

---

## Professional Questions

| # | Question | Expected Answer Focus |
|---|----------|-----------------------|
| 35 | State and prove the safety invariant. | free(n) never overlaps a dereference of protected n; protection lemma |
| 36 | What exact memory ordering does safety require? | StoreLoad fence ordering publish before validate; acquire scan loads |
| 37 | Prove the bounded-memory theorem. | ≤ H·K pinned + H·R pending = Θ(H²·K) |
| 38 | Prove amortized O(1) reclamation. | Threshold (1+α)HK + O(1) membership; potential argument |
| 39 | Why is the protocol lock-free, not wait-free? | Validate retry restarts only on a competing success → system progress |
| 40 | Formalize read-cost vs reclaim-latency vs M_max. | HP: nonzero c_read, bounded L_rec, M_max=K/stall; RCU: c_read≈0, M_max=∞ |
| 41 | Where can the safety proof fail in practice? | Relaxed store (no fence), K too small, double-retire, cross-domain |
| 42 | What is Hazard Eras / interval-based reclamation? | Hybrid: era stamps give RCU-like reads with HP-like bounds |
| 43 | Argue liveness (eventual free). | Slots eventually cleared → next scan frees n |

**Sample full answers**

**Q35.** Invariant: `free(n)` never executes while a process holds a
protected-and-validated pointer to `n`. Proof via the protection lemma: if
`Protect` returns `n` (publish at `t_pub`, validate re-reads `src == n` at `t_v`),
then any `Scan` able to free `n` must linearize after `t_pub`; with the StoreLoad
fence it observes `HP[slot] = n`, so `n ∈ prot` and is kept. If `n` had been
unlinked before `t_pub`, the validate would see `src ≠ n` and retry, so it never
returns a dangling `n`. Hence no free overlaps a dereference. ∎

**Q39.** The only loop is the protect/validate retry. It restarts only when the
validating re-read differs from the published value, which happens only because
some **other** process performed a successful modification — a system-wide step.
So whenever one process is forced to retry, another made progress: lock-free. It
is not wait-free because an individual process can be starved by a stream of
competing successes.

**Q37.** Partition retired-unfreed nodes into pinned and pending. Pinned: a node
survives a scan only if some slot holds it; there are exactly H·K slots and each
holds ≤ 1 node, so ≤ H·K pinned at any instant. Pending: each thread accumulates
≤ R nodes before being forced to scan, so ≤ H·R across H threads. Total ≤ H·K +
H·R; with R = Θ(H·K) that is Θ(H²·K), independent of execution length. The key
qualitative point: a thread stalled forever pins only its K slots, contributing K
— not the unbounded history that RCU would pin.

**Q41.** Four real-world failure points: (1) a **relaxed store** with no StoreLoad
fence lets the validate load reorder before the publish, so the scan can miss the
publish and free a live node; (2) **K too small** — the algorithm protects more
nodes than slots, leaving one dereference unguarded; (3) **double-retire** —
retiring the same node twice causes a double free on the next scan; (4)
**cross-domain retire** — retiring an object in domain A while domain B protects it
frees it early because A's scan never reads B's slots.

---

## Rapid-Fire Round

| # | Question | Answer |
|---|----------|--------|
| 44 | One word: what does a hazard slot prevent freeing of? | Protected nodes |
| 45 | True/false: hazard pointers need a fence on the reader path. | True (StoreLoad) |

Quick checks: protect = publish + validate; retire ≠ free; scan reads all slots;
threshold ≈ 2HK; memory bound Θ(H²·K); stalled reader pins only K nodes; solves
reclamation-ABA by preventing reuse.

---

## Coding Challenge

### Challenge: Treiber-stack `pop` with protect + retire + scan

> Implement a lock-free stack `pop` that uses a hazard pointer to safely read the
> top node's `next`, retires the popped node instead of freeing it, and exposes a
> `scan` that frees only retired nodes no slot references. Demonstrate the full
> protect → validate → CAS → clear → retire → scan cycle.
>
> Requirements:
> - `pop(slot)` returns the popped value (or empty) without use-after-free.
> - `retire(node)` defers reclamation.
> - `scan()` frees retired nodes absent from all hazard slots, keeps the rest.
> - Show that a node protected by another thread's slot is **kept** by scan.

Provide solutions in Go, Java, and Python.

---

## Challenge Solutions

### Go

```go
package main

import (
	"fmt"
	"sync/atomic"
)

type Node struct {
	value int
	next  *Node
}

type Stack struct {
	head atomic.Pointer[Node]
	// Hazard slots: one per thread index. Demo uses a fixed-size table.
	hazard []atomic.Pointer[Node]
	// Retire bookkeeping (single-domain demo; in real code, per-thread).
	retired []*Node
	freed   []int // values of nodes actually freed (for assertions)
}

func NewStack(threads int) *Stack {
	return &Stack{hazard: make([]atomic.Pointer[Node], threads)}
}

func (s *Stack) Push(v int) {
	n := &Node{value: v}
	for {
		old := s.head.Load()
		n.next = old
		if s.head.CompareAndSwap(old, n) {
			return
		}
	}
}

// Pop performs protect -> validate -> read next -> CAS -> clear -> retire.
func (s *Stack) Pop(slot int) (int, bool) {
	for {
		old := s.head.Load() // (1) read top
		if old == nil {
			return 0, false
		}
		s.hazard[slot].Store(old)        // (2) protect: publish
		if s.head.Load() != old {        // (3) validate
			continue //                     someone changed head; retry
		}
		next := old.next                 // (4) safe deref: old is pinned
		if s.head.CompareAndSwap(old, next) { // (5) unlink
			s.hazard[slot].Store(nil)    // (6) clear slot
			v := old.value
			s.retire(old)                // (7) defer free
			return v, true
		}
		// CAS failed -> retry; slot will be overwritten next iteration
	}
}

func (s *Stack) retire(n *Node) {
	s.retired = append(s.retired, n)
}

// Scan frees retired nodes not present in any hazard slot; keeps the rest.
func (s *Stack) Scan() {
	protected := make(map[*Node]struct{})
	for i := range s.hazard {
		if p := s.hazard[i].Load(); p != nil {
			protected[p] = struct{}{}
		}
	}
	keep := s.retired[:0]
	for _, n := range s.retired {
		if _, ok := protected[n]; ok {
			keep = append(keep, n) // pinned -> keep
		} else {
			s.freed = append(s.freed, n.value) // "free(n)"
		}
	}
	s.retired = keep
}

func main() {
	s := NewStack(2)
	s.Push(10)
	s.Push(20)
	s.Push(30)

	// Thread 1 pops 30, retiring it.
	v, _ := s.Pop(0)
	fmt.Println("popped:", v) // 30

	// Simulate thread 0 still protecting the retired node before scan.
	// (Re-pin the just-retired node to demonstrate "kept by scan".)
	s.hazard[1].Store(s.retired[0])
	s.Scan()
	fmt.Println("freed after scan #1:", s.freed)       // [] — pinned, kept
	fmt.Println("still retired:", len(s.retired))      // 1

	// Thread 1 finishes: clear its slot, scan again.
	s.hazard[1].Store(nil)
	s.Scan()
	fmt.Println("freed after scan #2:", s.freed)       // [30]
	fmt.Println("still retired:", len(s.retired))      // 0
}
```

### Java

```java
import java.util.*;
import java.util.concurrent.atomic.*;

public class HazardStack {
    static class Node {
        final int value; volatile Node next;
        Node(int v) { value = v; }
    }

    final AtomicReference<Node> head = new AtomicReference<>();
    final AtomicReferenceArray<Node> hazard; // one slot per thread index
    final List<Node> retired = new ArrayList<>();
    final List<Integer> freed = new ArrayList<>();

    HazardStack(int threads) { hazard = new AtomicReferenceArray<>(threads); }

    void push(int v) {
        Node n = new Node(v);
        while (true) {
            Node old = head.get();
            n.next = old;
            if (head.compareAndSet(old, n)) return;
        }
    }

    // protect -> validate -> read next -> CAS -> clear -> retire
    Integer pop(int slot) {
        while (true) {
            Node old = head.get();              // (1)
            if (old == null) return null;
            hazard.set(slot, old);              // (2) publish
            if (head.get() != old) continue;    // (3) validate
            Node next = old.next;               // (4) safe deref
            if (head.compareAndSet(old, next)) {// (5) unlink
                hazard.set(slot, null);         // (6) clear
                int v = old.value;
                retire(old);                    // (7) defer free
                return v;
            }
        }
    }

    void retire(Node n) { retired.add(n); }

    // free retired nodes absent from all slots; keep the rest
    void scan() {
        Set<Node> prot = Collections.newSetFromMap(new IdentityHashMap<>());
        for (int i = 0; i < hazard.length(); i++) {
            Node p = hazard.get(i);
            if (p != null) prot.add(p);
        }
        List<Node> keep = new ArrayList<>();
        for (Node n : retired) {
            if (prot.contains(n)) keep.add(n);  // pinned
            else freed.add(n.value);            // "free(n)"
        }
        retired.clear();
        retired.addAll(keep);
    }

    public static void main(String[] args) {
        HazardStack s = new HazardStack(2);
        s.push(10); s.push(20); s.push(30);

        Integer v = s.pop(0);
        System.out.println("popped: " + v);            // 30

        s.hazard.set(1, s.retired.get(0));              // another thread pins it
        s.scan();
        System.out.println("freed after scan #1: " + s.freed);   // []
        System.out.println("still retired: " + s.retired.size());// 1

        s.hazard.set(1, null);
        s.scan();
        System.out.println("freed after scan #2: " + s.freed);   // [30]
        System.out.println("still retired: " + s.retired.size());// 0
    }
}
```

### Python

```python
# Conceptual single-process model; the GIL serializes ops, but the
# protect/validate/clear/retire/scan SEQUENCE is exactly the real one.

class Node:
    __slots__ = ("value", "next")
    def __init__(self, value, nxt=None):
        self.value = value
        self.next = nxt

class HazardStack:
    def __init__(self, threads):
        self.head = None
        self.hazard = [None] * threads   # one slot per thread index
        self.retired = []
        self.freed = []

    def push(self, v):
        n = Node(v, self.head)
        self.head = n  # serialized by GIL == "CAS succeeded"

    def pop(self, slot):
        while True:
            old = self.head               # (1) read top
            if old is None:
                return None
            self.hazard[slot] = old       # (2) protect: publish
            if self.head is not old:      # (3) validate
                continue
            nxt = old.next                # (4) safe deref
            if self.head is old:          # (5) unlink (CAS)
                self.head = nxt
                self.hazard[slot] = None  # (6) clear
                self.retire(old)          # (7) defer free
                return old.value

    def retire(self, n):
        self.retired.append(n)

    def scan(self):
        protected = {id(p) for p in self.hazard if p is not None}
        keep = []
        for n in self.retired:
            if id(n) in protected:
                keep.append(n)            # pinned -> keep
            else:
                self.freed.append(n.value)  # "free(n)"
        self.retired = keep


if __name__ == "__main__":
    s = HazardStack(2)
    for v in (10, 20, 30):
        s.push(v)

    print("popped:", s.pop(0))                 # 30

    s.hazard[1] = s.retired[0]                  # another thread pins it
    s.scan()
    print("freed after scan #1:", s.freed)      # []
    print("still retired:", len(s.retired))     # 1

    s.hazard[1] = None
    s.scan()
    print("freed after scan #2:", s.freed)      # [30]
    print("still retired:", len(s.retired))     # 0
```

**Key points the interviewer is checking:**
- Protect happens **before** dereferencing `old.next`.
- The **validate** re-read appears and retries on mismatch.
- Removal calls **retire**, never `free`, inside `pop`.
- `scan` **keeps** nodes present in any slot and frees only the rest — the demo
  proves a pinned node survives scan #1 and is freed only after the slot clears.

---

## Follow-up Challenge: threshold-based reclamation

> Extend the solution so `retire` does **not** scan on every call. Instead, scan
> only when the retire list reaches a threshold `R = 2·H·K`. Show that most
> retires are O(1) and only every R-th retire pays the scan — the amortization.

The change is small but is exactly what an interviewer probes after the base
solution. Below is the Go delta; Java and Python mirror it.

#### Go

```go
const H, K = 2, 1
const threshold = 2 * H * K // = 4

func (s *Stack) retire(n *Node) {
	s.retired = append(s.retired, n)
	if len(s.retired) >= threshold { // amortize: scan only at threshold
		s.Scan()
	}
}
```

#### Java

```java
static final int H = 2, K = 1, THRESHOLD = 2 * H * K;

void retire(Node n) {
    retired.add(n);
    if (retired.size() >= THRESHOLD) scan(); // amortize
}
```

#### Python

```python
H, K = 2, 1
THRESHOLD = 2 * H * K

def retire(self, n):
    self.retired.append(n)
    if len(self.retired) >= THRESHOLD:   # amortize
        self.scan()
```

**Talking point:** with `threshold = 2HK`, each scan frees ≥ HK nodes, so the
O(HK) scan cost spreads to O(1) per freed node. Mention the memory consequence:
up to `H·threshold` nodes may sit pending — a bounded, budgetable ceiling.

**Common follow-up:** "What if a node is protected at every scan and the threshold
is reached repeatedly?" Answer: it stays on the list (pinned), but there are at
most `H·K` such pinned nodes total, so the list cannot grow without bound; the
amortization argument counts only the freed nodes.

---

## Whiteboard Pitfalls to Avoid

- Dereferencing `old.next` **before** the protect — the single most common bug.
- Dropping the validate re-read "because it usually passes."
- Calling `free`/`delete` inside `pop` instead of `retire`.
- Forgetting to clear the slot on the CAS-success path, pinning the node forever.
- Scanning on a linear search of slots (O(R·H·K)) instead of a set (O(R + H·K)).
- Claiming hazard pointers solve **all** ABA — they solve the reclamation-induced
  form; pure counter ABA still needs tagged pointers.

---

This completes the interview set: 45 tiered questions, a full protect/retire/scan
coding challenge for a Treiber stack, and a threshold-amortization follow-up — all
in Go, Java, and Python.
