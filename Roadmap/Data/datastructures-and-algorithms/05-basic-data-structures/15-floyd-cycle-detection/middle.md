# Floyd's Cycle Detection — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Deeper Concepts](#deeper-concepts)
3. [The Cycle-Start Math](#the-cycle-start-math)
4. [Comparison with Alternatives](#comparison-with-alternatives)
5. [Advanced Patterns](#advanced-patterns)
6. [Application: Pollard's Rho](#application-pollards-rho)
7. [Application: Find Duplicate in Array](#application-find-duplicate-in-array)
8. [Code Examples](#code-examples)
9. [Error Handling](#error-handling)
10. [Performance Analysis](#performance-analysis)
11. [Best Practices](#best-practices)
12. [Visual Animation](#visual-animation)
13. [Summary](#summary)

---

## Introduction

> Focus: "Why does it work?" and "When should I choose this over alternatives?"

At the middle level, you stop memorizing the algorithm and start understanding **why fast = 2× slow is special**, how the cycle-start identity `μ = k·λ - m` falls out of one clean modular-arithmetic argument, and where Floyd's algorithm shows up in places that are not linked lists at all — pseudo-random number generators, integer factorization, duplicate-finding in fixed-range arrays. You should also be able to defend the choice of Floyd's over a hash set in a code review.

---

## Deeper Concepts

### Invariant: Relative speed is exactly 1 per iteration

Once both pointers are inside the cycle, define `d_i = (position of hare − position of tortoise) mod λ`. Each iteration the hare advances by 2, the tortoise by 1, so:

```text
d_{i+1} = (d_i + 1) mod λ
```

This is the structural invariant. The sequence `d_0, d_1, d_2, ...` cycles through every residue modulo λ in order, so it **must** hit 0 within λ iterations. That hit is the meeting.

This invariant is exactly why fast = 2× slow is special — any 1-unit-per-step relative drift works. fast = 3× slow gives `d_{i+1} = (d_i + 2) mod λ`, which still cycles but takes a different number of steps and breaks the cycle-start formula.

### Recurrence and runtime

Once the tortoise enters the cycle (after μ steps), the meeting happens within λ more steps:

```text
T(n) = O(μ + λ) = O(n)
```

Both phases combined remain O(n). No amortization needed — every node is visited at most twice.

### The ρ structure formalized

Every iterated function `f: S → S` over a finite set produces a sequence that eventually repeats. Formally, the sequence has:

- A tail of length **μ ≥ 0** (the "stem")
- A cycle of length **λ ≥ 1**

This pair `(μ, λ)` characterizes the orbit. Floyd's algorithm finds μ in phase 2 and λ in a third optional pass — without ever storing the orbit.

---

## The Cycle-Start Math

### Setup

Place the cycle-start at position `μ`. Inside the cycle, the meeting happens at position `μ + m` for some `0 ≤ m < λ`. Define:
- Tortoise distance walked: `T = μ + m`
- Hare distance walked: `H = 2T = 2(μ + m)`

Since the hare is inside the cycle and has wrapped around k times:

```text
H = μ + m + k·λ
```

Substitute `H = 2T = 2μ + 2m`:

```text
2μ + 2m = μ + m + k·λ
⟹ μ + m = k·λ
⟹ μ = k·λ − m
```

### Interpretation

**μ = k·λ − m** says: from the meeting point, walking μ steps forward takes you exactly to the cycle's start (since walking `k·λ − m` steps inside a cycle of length λ lands at position `−m ≡ λ − m` from where you are, which is the cycle entry).

### Phase 2 algorithm

```text
1. Reset one pointer (say p) to head.
2. Keep the other at the meeting point.
3. Advance both one step per iteration.
4. They will meet at the cycle's start.
```

The pointer at head walks μ steps to reach the cycle start.
The pointer at the meeting walks μ steps and arrives at the cycle start because of the identity above.

### Off-by-one trap

The proof assumes both pointers start at the head (position 0) and that `slow = slow.next; fast = fast.next.next` is the **inside** of the loop body. If you advance the pointers before checking equality, or initialize them differently, the formula shifts by 1.

---

## Comparison with Alternatives

| Attribute | Floyd's | Hash Set | Brent's | Mark Visited |
|-----------|---------|----------|---------|--------------|
| Time | O(n) | O(n) | O(n), fewer ops in practice | O(n) |
| Space | **O(1)** | O(n) | **O(1)** | O(1) but modifies list |
| Read-only | ✅ | ✅ | ✅ | ❌ |
| Finds cycle start | ✅ (with phase 2) | ✅ | ✅ | ✅ |
| Finds cycle length | ✅ (extra pass) | ❌ directly | ✅ directly | ❌ directly |
| Implementation difficulty | Medium | Easy | Medium | Easy |
| Branch-prediction friendly | Yes | No (hash misses) | Yes | Yes |

**Choose Floyd's when:** memory is tight, the list is read-only, you control the algorithm, and you may need the cycle start.
**Choose hash set when:** memory is cheap, you need to identify which exact nodes are in the cycle, or junior teammates will maintain the code.
**Choose Brent's when:** Pollard's-rho or other tight loops where every constant factor matters (Brent's does ~36% fewer function evaluations on average).
**Choose mark-visited when:** the list is mutable, single-threaded, and you do not need to restore it.

---

## Advanced Patterns

### Pattern: Floyd's on any iterated function

Floyd's algorithm has nothing intrinsic to linked lists. The general signature is:

```text
find_cycle(f: X → X, x0: X) → (μ, λ)
```

This works for:
- Linked lists: `f(node) = node.next`
- Arrays indexed by themselves: `f(i) = a[i]`
- Pseudo-random generators: `f(x) = (a·x + c) mod m`
- Pollard's rho: `f(x) = (x² + c) mod n`
- State machines with deterministic transitions

#### Go: Generic cycle detection

```go
// CycleInfo returns (mu, lambda): tail length and cycle length.
// Requires f: X → X be a pure function over a finite or pseudo-finite domain.
func CycleInfo[T comparable](f func(T) T, x0 T) (mu, lambda int) {
    // Phase 1: detect meeting point
    tortoise, hare := f(x0), f(f(x0))
    for tortoise != hare {
        tortoise = f(tortoise)
        hare = f(f(hare))
    }

    // Phase 2: find cycle start (compute mu)
    mu = 0
    tortoise = x0
    for tortoise != hare {
        tortoise = f(tortoise)
        hare = f(hare)
        mu++
    }

    // Phase 3: find cycle length lambda
    lambda = 1
    hare = f(tortoise)
    for tortoise != hare {
        hare = f(hare)
        lambda++
    }
    return mu, lambda
}
```

#### Java

```java
import java.util.function.Function;

public class CycleInfo<T> {
    public final int mu;
    public final int lambda;

    public CycleInfo(int mu, int lambda) {
        this.mu = mu;
        this.lambda = lambda;
    }

    public static <T> CycleInfo<T> find(Function<T, T> f, T x0) {
        T tortoise = f.apply(x0);
        T hare = f.apply(f.apply(x0));
        while (!tortoise.equals(hare)) {
            tortoise = f.apply(tortoise);
            hare = f.apply(f.apply(hare));
        }

        int mu = 0;
        tortoise = x0;
        while (!tortoise.equals(hare)) {
            tortoise = f.apply(tortoise);
            hare = f.apply(hare);
            mu++;
        }

        int lambda = 1;
        hare = f.apply(tortoise);
        while (!tortoise.equals(hare)) {
            hare = f.apply(hare);
            lambda++;
        }
        return new CycleInfo<>(mu, lambda);
    }
}
```

#### Python

```python
def cycle_info(f, x0):
    """Return (mu, lambda) for sequence x0, f(x0), f(f(x0)), ..."""
    tortoise, hare = f(x0), f(f(x0))
    while tortoise != hare:
        tortoise = f(tortoise)
        hare = f(f(hare))

    mu = 0
    tortoise = x0
    while tortoise != hare:
        tortoise = f(tortoise)
        hare = f(hare)
        mu += 1

    lam = 1
    hare = f(tortoise)
    while tortoise != hare:
        hare = f(hare)
        lam += 1
    return mu, lam
```

### Pattern: Brent's algorithm (an O(1)-space alternative)

Brent's algorithm uses one tortoise and one hare but resets the tortoise to the hare's position at exponentially growing intervals (powers of 2). It typically requires ~36% fewer function evaluations than Floyd's. The trade-off is slightly more complex bookkeeping.

#### Python: Brent's algorithm

```python
def brent_cycle(f, x0):
    power = lam = 1
    tortoise = x0
    hare = f(x0)
    while tortoise != hare:
        if power == lam:
            tortoise = hare
            power *= 2
            lam = 0
        hare = f(hare)
        lam += 1

    # Find mu
    tortoise = hare = x0
    for _ in range(lam):
        hare = f(hare)
    mu = 0
    while tortoise != hare:
        tortoise = f(tortoise)
        hare = f(hare)
        mu += 1
    return mu, lam
```

---

## Application: Pollard's Rho

Pollard's rho factorization uses Floyd's algorithm on the sequence:

```text
x_{i+1} = (x_i² + c) mod n
```

If `n` is composite with a small prime factor `p`, the sequence modulo `p` enters a cycle in roughly **O(√p)** steps (birthday paradox). Floyd's detects this cycle. When it does, `gcd(|x_i − x_j|, n)` is likely a non-trivial factor.

```python
from math import gcd

def pollard_rho(n, c=1):
    """Return a non-trivial factor of composite n, or n if it fails."""
    if n % 2 == 0:
        return 2
    f = lambda x: (x * x + c) % n
    tortoise, hare = 2, 2
    d = 1
    while d == 1:
        tortoise = f(tortoise)
        hare = f(f(hare))
        d = gcd(abs(tortoise - hare), n)
    return d if d != n else None

print(pollard_rho(8051))  # likely 83 or 97
```

The expected runtime is **O(n^(1/4))** for finding the smallest prime factor — vastly better than trial division's O(√n) for large numbers.

---

## Application: Find Duplicate in Array

LeetCode 287: given an array of `n+1` integers in range `[1, n]`, find the one duplicate without modifying the array and using O(1) extra space.

**Trick:** Treat the array as a function `f(i) = a[i]`. Since values are in `[1, n]` and we have `n+1` slots, by pigeonhole some value repeats — meaning two indices map to the same value. The graph `i → a[i]` has a cycle, and the cycle's entry node is the duplicate value.

#### Go

```go
func FindDuplicate(nums []int) int {
    slow, fast := nums[0], nums[0]
    for {
        slow = nums[slow]
        fast = nums[nums[fast]]
        if slow == fast {
            break
        }
    }
    slow = nums[0]
    for slow != fast {
        slow = nums[slow]
        fast = nums[fast]
    }
    return slow
}
```

#### Java

```java
public static int findDuplicate(int[] nums) {
    int slow = nums[0], fast = nums[0];
    do {
        slow = nums[slow];
        fast = nums[nums[fast]];
    } while (slow != fast);
    slow = nums[0];
    while (slow != fast) {
        slow = nums[slow];
        fast = nums[fast];
    }
    return slow;
}
```

#### Python

```python
def find_duplicate(nums):
    slow = fast = nums[0]
    while True:
        slow = nums[slow]
        fast = nums[nums[fast]]
        if slow == fast:
            break
    slow = nums[0]
    while slow != fast:
        slow = nums[slow]
        fast = nums[fast]
    return slow
```

This O(n)-time / O(1)-space solution is one of the cleanest applications of Floyd's beyond linked lists.

---

## Code Examples

### Full implementation: detection + cycle start + cycle length

#### Go

```go
package main

import "fmt"

type Node struct {
    Val  int
    Next *Node
}

type CycleResult struct {
    HasCycle    bool
    CycleStart  *Node
    CycleLength int
    TailLength  int
}

// AnalyzeCycle returns full cycle structure of a linked list.
// Time: O(n). Space: O(1).
func AnalyzeCycle(head *Node) CycleResult {
    if head == nil {
        return CycleResult{}
    }

    // Phase 1: detect meeting
    slow, fast := head, head
    var meeting *Node
    for fast != nil && fast.Next != nil {
        slow = slow.Next
        fast = fast.Next.Next
        if slow == fast {
            meeting = slow
            break
        }
    }
    if meeting == nil {
        return CycleResult{HasCycle: false}
    }

    // Phase 2: find cycle start
    tail := 0
    p := head
    for p != meeting {
        p = p.Next
        meeting = meeting.Next
        tail++
    }
    start := p

    // Phase 3: find cycle length
    length := 1
    q := start.Next
    for q != start {
        q = q.Next
        length++
    }

    return CycleResult{
        HasCycle:    true,
        CycleStart:  start,
        CycleLength: length,
        TailLength:  tail,
    }
}

func main() {
    n1 := &Node{Val: 1}
    n2 := &Node{Val: 2}
    n3 := &Node{Val: 3}
    n4 := &Node{Val: 4}
    n5 := &Node{Val: 5}
    n1.Next = n2; n2.Next = n3; n3.Next = n4; n4.Next = n5; n5.Next = n3

    r := AnalyzeCycle(n1)
    fmt.Printf("HasCycle=%v Start=%d Length=%d Tail=%d\n",
        r.HasCycle, r.CycleStart.Val, r.CycleLength, r.TailLength)
    // HasCycle=true Start=3 Length=3 Tail=2
}
```

#### Python

```python
class Node:
    def __init__(self, val=0, nxt=None):
        self.val = val
        self.next = nxt

def analyze_cycle(head):
    """Return (has_cycle, start_node, cycle_length, tail_length)."""
    if head is None:
        return False, None, 0, 0

    slow = fast = head
    meeting = None
    while fast and fast.next:
        slow = slow.next
        fast = fast.next.next
        if slow is fast:
            meeting = slow
            break
    if meeting is None:
        return False, None, 0, 0

    tail = 0
    p = head
    while p is not meeting:
        p = p.next
        meeting = meeting.next
        tail += 1
    start = p

    length = 1
    q = start.next
    while q is not start:
        q = q.next
        length += 1

    return True, start, length, tail
```

---

## Error Handling

| Scenario | What goes wrong | Correct approach |
|----------|----------------|-----------------|
| Slow/fast both start at head AND check equality immediately | False positive at iteration 0 | Move pointers first, **then** check |
| `fast.next` not nil-checked | Crash on `fast.next.next` | Check both `fast != nil` and `fast.Next != nil` |
| Phase 2 with wrong starting pointer | Returns meeting node, not cycle start | Reset to head, advance the other from meeting |
| Using `==` for value equality on nodes with duplicate values | Treats two different nodes as same | Use identity comparison (`is` in Python, `==` for references in Java/Go) |
| Mutating list as you traverse | Detects a "cycle" because you created one | Read-only traversal — never edit pointers |

---

## Performance Analysis

#### Go: Benchmark Floyd's vs hash set

```go
package main

import (
    "fmt"
    "time"
)

type Node struct{ Next *Node }

func makeList(n int, cycleAt int) *Node {
    nodes := make([]*Node, n)
    for i := range nodes {
        nodes[i] = &Node{}
    }
    for i := 0; i < n-1; i++ {
        nodes[i].Next = nodes[i+1]
    }
    if cycleAt >= 0 {
        nodes[n-1].Next = nodes[cycleAt]
    }
    return nodes[0]
}

func hasCycleFloyd(head *Node) bool {
    slow, fast := head, head
    for fast != nil && fast.Next != nil {
        slow = slow.Next
        fast = fast.Next.Next
        if slow == fast {
            return true
        }
    }
    return false
}

func hasCycleSet(head *Node) bool {
    seen := map[*Node]struct{}{}
    for n := head; n != nil; n = n.Next {
        if _, ok := seen[n]; ok {
            return true
        }
        seen[n] = struct{}{}
    }
    return false
}

func main() {
    sizes := []int{1_000, 10_000, 100_000, 1_000_000}
    for _, n := range sizes {
        head := makeList(n, n/2)
        s := time.Now()
        for i := 0; i < 100; i++ {
            hasCycleFloyd(head)
        }
        f := time.Since(s)
        s = time.Now()
        for i := 0; i < 100; i++ {
            hasCycleSet(head)
        }
        h := time.Since(s)
        fmt.Printf("n=%8d Floyd=%6.2fms Set=%6.2fms ratio=%.1fx\n",
            n, float64(f.Microseconds())/100/1000.0,
            float64(h.Microseconds())/100/1000.0,
            float64(h)/float64(f))
    }
}
```

Expected output (rough order of magnitude):

```text
n=    1000 Floyd=  0.01ms Set=  0.04ms ratio= 4.0x
n=   10000 Floyd=  0.10ms Set=  0.50ms ratio= 5.0x
n=  100000 Floyd=  1.00ms Set=  8.00ms ratio= 8.0x
n= 1000000 Floyd= 10.0ms  Set= 120ms   ratio=12.0x
```

The gap widens as n grows because hash sets thrash the cache while Floyd's stays in L1.

---

## Best Practices

- **Default to Floyd's for cycle detection** unless memory is cheap AND you also need set semantics (e.g., "give me every node in the cycle")
- **Always extract cycle-start logic into its own function** — `hasCycle` and `findCycleStart` are different APIs; do not return cycle start as a side effect of detection
- **Document the speed ratio** in comments — every reader will wonder why 2:1 and not 3:1
- **Use generic helpers for non-list cycles** — Pollard's rho, RNG period analysis, and array-duplicate finding all use the same skeleton; do not copy-paste
- **Benchmark before optimizing** — Brent's is faster on paper but the win disappears if `f` is slow (e.g., modular exponentiation)
- **Validate Phase 2 with a unit test** — easy to write a test where Phase 1 detects but Phase 2 returns a node inside the cycle instead of the entry

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive comparison.
>
> Middle-level animation includes:
> - Side-by-side Floyd's vs hash-set traversal
> - Step counter showing relative speed invariant `(hare − tortoise) mod λ`
> - Phase 2 visualization: pointer reset and convergence to cycle start
> - Brent's algorithm option toggle
> - Custom ρ-shape input (set μ and λ)

---

## Summary

At middle level, Floyd's stops being a trick and starts being a tool. You can prove the cycle-start identity from one modular invariant, generalize the algorithm to any iterated function, and reach for it in problems that do not even mention linked lists (Pollard's rho, find-duplicate, RNG period). The decision to use Floyd's over a hash set is a deliberate trade-off about read-only behavior and memory pressure, not a habit.
