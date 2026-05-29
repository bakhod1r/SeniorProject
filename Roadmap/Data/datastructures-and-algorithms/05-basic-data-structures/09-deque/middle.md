# Deque — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Choosing an Implementation](#choosing-an-implementation)
3. [Circular Array vs Doubly-Linked List vs Block-List](#circular-array-vs-doubly-linked-list-vs-block-list)
4. [Deque as Stack and Queue](#deque-as-stack-and-queue)
5. [ArrayDeque vs LinkedList in the JVM](#arraydeque-vs-linkedlist-in-the-jvm)
6. [Block-List Internals — Python and C++](#block-list-internals--python-and-c)
7. [Sliding-Window Pattern](#sliding-window-pattern)
8. [Undo / Redo Pattern](#undo--redo-pattern)
9. [Bounded Deques and Eviction](#bounded-deques-and-eviction)
10. [Iterator Invalidation](#iterator-invalidation)
11. [Memory Layout and the Cost of Pointers](#memory-layout-and-the-cost-of-pointers)
12. [Code Examples](#code-examples)
13. [Performance Comparison](#performance-comparison)
14. [Best Practices](#best-practices)
15. [Summary](#summary)

---

## Introduction

At the junior level we wrote a ring-buffer deque and surveyed the language built-ins. At the middle level we ask harder questions: **which implementation should I pick, and when does it actually matter?** A naive answer ("just use `ArrayDeque`") is fine for 90% of code, but you will hit cases where the right choice is `LinkedList`, where `collections.deque` is the wrong tool, or where you have to write your own because none of the built-ins fit.

This page also covers the two algorithmic patterns where deques earn their keep — sliding windows and undo/redo — and the language-specific performance tradeoffs that come up in interviews and real reviews.

---

## Choosing an Implementation

The decision tree:

```
Is the structure shared across threads?
 yes -> ConcurrentLinkedDeque / LinkedBlockingDeque  (see senior.md)
 no  -> continue

Do you need stable iterators across mutation?
 yes -> doubly-linked list  (Java LinkedList, C++ std::list)
 no  -> continue

Do you need O(1) random access?
 yes -> ring buffer or block-list  (Java ArrayDeque, Python deque, C++ std::deque)
 no  -> continue

Is the workload "lots of small operations at both ends"?
 yes -> ring buffer  (best cache behavior)
 no  -> any will do — default to whatever the language idiom is
```

In practice you almost always land on the ring buffer or the block-list. The doubly-linked list wins only when you need either thread-safe iteration (the JDK's `ConcurrentLinkedDeque`) or O(1) splice operations on the middle of the deque (rare).

---

## Circular Array vs Doubly-Linked List vs Block-List

A more detailed comparison:

| Attribute                | Ring buffer (ArrayDeque)   | Doubly-linked list (LinkedList) | Block-list (collections.deque, std::deque) |
| ------------------------ | -------------------------- | ------------------------------- | ------------------------------------------ |
| Memory per element       | 4-8 bytes (just the slot)  | ~32-48 bytes (3 pointers + payload + header) | ~8 bytes (block slot + amortised block overhead) |
| Cache behavior           | Excellent — contiguous     | Awful — every node is a cold load | Very good — locality within blocks       |
| `pushBack` worst case    | O(n) on resize             | O(1)                            | O(blockSize) on new block, ~O(1) amortised |
| `pushBack` amortised     | O(1)                       | O(1)                            | O(1)                                       |
| Random access `get(i)`   | O(1)                       | O(n)                            | O(1) via block index                       |
| Iterator stability       | Invalidated on resize      | Stable as long as node not removed | Stable                                    |
| Memory overhead at idle  | Up to 2x size              | Tight                           | One partially-used block per end           |
| Implementation effort    | Medium (modular arithmetic) | Low                            | High                                       |
| Allocations per push     | 0 except on resize         | 1 per push                      | 0 except when crossing a block boundary    |
| Production examples      | Java `ArrayDeque`          | Java `LinkedList`               | Python `collections.deque`, C++ `std::deque` |

Three takeaways:

1. **Per-element memory overhead** is the underrated factor. A deque of one million ints is ~4-8 MB as a ring buffer, ~32-48 MB as a `LinkedList`. The linked version may not even fit where the ring buffer does.
2. **Cache behavior dominates runtime.** A ring buffer can be 5-10x faster than a linked list at the same algorithmic complexity, simply because pointer chasing wastes hundreds of cycles waiting for L2/L3 loads.
3. **Allocation pressure matters in GC'd languages.** Every `LinkedList.add` produces garbage. At high throughput this shows up as GC pauses.

---

## Deque as Stack and Queue

A common middle-level confusion: when should I use `Deque` instead of a dedicated `Stack` or `Queue` type?

**Java's official guidance:** "Deque interface should be used in preference to the legacy Stack class." `Stack` extends `Vector`, which is synchronized — every operation pays for a lock you do not need. `ArrayDeque` is unsynchronized and much faster.

```java
// Worse — legacy.
Stack<Integer> s = new Stack<>();
s.push(1);
s.push(2);
int top = s.pop();

// Better.
Deque<Integer> s = new ArrayDeque<>();
s.push(1);       // == addFirst(1)
s.push(2);
int top = s.pop(); // == removeFirst()
```

For queues, both `LinkedList` and `ArrayDeque` implement `Queue`. `ArrayDeque` wins on throughput. `LinkedList` wins only if you also need `List` operations like `get(i)` (still O(n)) or `ListIterator.add`.

**Python convention:** use `collections.deque` for stacks too. `list.append` + `list.pop` is fine for stacks because both are O(1) amortised, but `deque` is comparable in speed and gives you `appendleft`/`popleft` for free.

**Go convention:** the language has no built-in stack, queue, or deque. A slice with `append` and `s[1:]` is the idiomatic stack and queue. For a real deque, you write the ring buffer.

---

## ArrayDeque vs LinkedList in the JVM

This is a question that comes up in every Java interview. The answer is `ArrayDeque` for almost everything, but let us be precise about why.

**Throughput benchmark (JMH-style, sketched):**

| Operation               | `ArrayDeque` (ns) | `LinkedList` (ns) |
| ----------------------- | ----------------- | ----------------- |
| `offerLast` (100k ops)  | ~5                | ~25               |
| `pollFirst` (100k ops)  | ~3                | ~15               |
| `iterator().next()`     | ~2                | ~12               |
| Random `get(i)`         | n/a               | O(n)              |

The ratio is roughly 4-5x in `ArrayDeque`'s favor on common workloads. The reasons:

- **No per-node allocation.** `LinkedList.add` allocates a `Node` object every time. `ArrayDeque.offer` writes to an existing slot.
- **No write barriers.** Object allocation triggers card-marking and other GC bookkeeping. Primitive array writes do not.
- **Cache locality.** A `LinkedList` traversal touches one cache line per element. An `ArrayDeque` traversal touches one cache line per 8-16 elements (depending on object size).

**When `LinkedList` actually wins:**

1. You need O(1) `ListIterator.add` in the middle. `ArrayDeque` is O(n) for any middle insertion because it has no list interface at all.
2. You need stable iterators across structural modification through a single thread (rare).
3. You have a very predictable maximum size and the upfront array allocation matters more than per-node allocation. Almost never the case.

**Sizing tip:** `ArrayDeque`'s default initial capacity is 16. If you know you will push thousands of items, construct with an explicit larger capacity to skip a few resizes:

```java
Deque<Long> d = new ArrayDeque<>(1024);
```

---

## Block-List Internals — Python and C++

Python's `collections.deque` and C++'s `std::deque` both use a **block-list** structure. The data is stored in fixed-size arrays (blocks); a small index array points to the blocks.

```
Python deque (CPython, simplified):

      [block 0]   [block 1]   [block 2]   [block 3]
       |    |     |    |      |    |      |    |
       v    v     v    v      v    v      v    v
       . . . a    b c d e     f g h i     j k . .
              ^                              ^
            leftindex                      rightindex
```

- Each block holds ~64 elements (CPython, tunable at build time).
- The deque maintains pointers to the leftmost and rightmost blocks, plus indices within those blocks.
- `appendleft` writes to `leftblock[leftindex - 1]`. If `leftindex == 0`, allocate a new block to the left.
- `pop` works analogously on the right.

**Advantages over a ring buffer:**

- **No global resize.** Adding 10 million elements never triggers an O(n) copy. The deque just allocates more blocks. Worst-case latency is bounded by the block size.
- **Stable element addresses.** A reference to an element stays valid until that element is removed, even as the deque grows. C++ guarantees this and Python's reference semantics make it free.
- **Splicing is cheap.** Block-lists can concatenate without moving data — just relink the index.

**Disadvantages:**

- More complex to implement.
- Slightly worse random-access constant (two indirections instead of one).
- More memory overhead per element when the deque is mostly empty (a block must be allocated even for one element).

In CPython, the deque object is in `Modules/_collectionsmodule.c`. The block size is `#define BLOCKLEN 64`. Reading the source is genuinely instructive.

---

## Sliding-Window Pattern

A deque is the natural fit for **any sliding-window state** that requires you to remove elements falling off one end and add new ones at the other.

The simplest example: track the **last K** values in a stream.

### Go

```go
package window

// LastK keeps the most recent K values seen by Add.
// Backed by a fixed-capacity ring deque.
type LastK struct {
    buf  []int
    head int
    size int
    k    int
}

func NewLastK(k int) *LastK {
    return &LastK{buf: make([]int, k), k: k}
}

func (w *LastK) Add(x int) {
    if w.size < w.k {
        tail := (w.head + w.size) % w.k
        w.buf[tail] = x
        w.size++
        return
    }
    // Full: overwrite the front (oldest) and advance head.
    w.buf[w.head] = x
    w.head = (w.head + 1) % w.k
}

func (w *LastK) Snapshot() []int {
    out := make([]int, w.size)
    for i := 0; i < w.size; i++ {
        out[i] = w.buf[(w.head+i)%w.k]
    }
    return out
}
```

### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.ArrayList;

public class LastK {
    private final Deque<Integer> dq = new ArrayDeque<>();
    private final int k;

    public LastK(int k) { this.k = k; }

    public void add(int x) {
        if (dq.size() == k) dq.pollFirst();
        dq.offerLast(x);
    }

    public List<Integer> snapshot() {
        return new ArrayList<>(dq);
    }
}
```

### Python

```python
from collections import deque

class LastK:
    """Most recent k values, O(1) per insert."""

    def __init__(self, k: int):
        # maxlen handles the eviction automatically.
        self._buf: deque[int] = deque(maxlen=k)

    def add(self, x: int) -> None:
        self._buf.append(x)

    def snapshot(self) -> list[int]:
        return list(self._buf)
```

For a more advanced pattern — sliding window **maximum** with a monotonic deque — see topic **14-monotonic-queue**. That is the canonical interview problem and it relies on these same primitives (pushBack new candidates, popFront expired candidates, popBack dominated candidates).

---

## Undo / Redo Pattern

A classic deque application. Two strategies dominate:

**Strategy A — One deque per direction.** An `undoStack` and a `redoStack`, both used as stacks. Every user action pushes onto `undoStack` and clears `redoStack`. Undo pops from `undoStack` and pushes onto `redoStack`. Redo does the reverse. Simple and bullet-proof.

**Strategy B — Single deque with a cursor.** One deque holds the linear history. A cursor index marks "current". Undo moves the cursor back; redo moves it forward. A new action truncates from the cursor to the end.

Strategy A is what almost every text editor does. Bounded undo (drop oldest action after N actions) is trivial:

### Go

```go
package undo

type Action interface {
    Apply()
    Revert()
}

type History struct {
    undo []Action
    redo []Action
    max  int
}

func New(maxActions int) *History {
    return &History{max: maxActions}
}

func (h *History) Do(a Action) {
    a.Apply()
    h.undo = append(h.undo, a)
    if len(h.undo) > h.max {
        h.undo = h.undo[1:] // drop oldest
    }
    h.redo = nil // new action invalidates redo history
}

func (h *History) Undo() bool {
    if len(h.undo) == 0 {
        return false
    }
    a := h.undo[len(h.undo)-1]
    h.undo = h.undo[:len(h.undo)-1]
    a.Revert()
    h.redo = append(h.redo, a)
    return true
}

func (h *History) Redo() bool {
    if len(h.redo) == 0 {
        return false
    }
    a := h.redo[len(h.redo)-1]
    h.redo = h.redo[:len(h.redo)-1]
    a.Apply()
    h.undo = append(h.undo, a)
    return true
}
```

### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;

public class History {
    public interface Action {
        void apply();
        void revert();
    }

    private final Deque<Action> undo = new ArrayDeque<>();
    private final Deque<Action> redo = new ArrayDeque<>();
    private final int max;

    public History(int max) { this.max = max; }

    public void doAction(Action a) {
        a.apply();
        undo.push(a);
        if (undo.size() > max) undo.pollLast(); // drop oldest
        redo.clear();
    }

    public boolean undo() {
        Action a = undo.pollFirst();
        if (a == null) return false;
        a.revert();
        redo.push(a);
        return true;
    }

    public boolean redo() {
        Action a = redo.pollFirst();
        if (a == null) return false;
        a.apply();
        undo.push(a);
        return true;
    }
}
```

### Python

```python
from collections import deque
from typing import Protocol

class Action(Protocol):
    def apply(self) -> None: ...
    def revert(self) -> None: ...

class History:
    def __init__(self, max_actions: int = 100):
        self._undo: deque[Action] = deque(maxlen=max_actions)
        self._redo: list[Action] = []

    def do(self, a: Action) -> None:
        a.apply()
        self._undo.append(a)  # maxlen drops oldest automatically
        self._redo.clear()

    def undo(self) -> bool:
        if not self._undo:
            return False
        a = self._undo.pop()
        a.revert()
        self._redo.append(a)
        return True

    def redo(self) -> bool:
        if not self._redo:
            return False
        a = self._redo.pop()
        a.apply()
        self._undo.append(a)
        return True
```

The bounded undo deque (Strategy A with `maxlen`) is one of the few cases where the dropping happens at the **front** while we push at the **back** — exactly what a deque is for. With a plain stack you would have to manually shift elements every time you trim the oldest entry, which is O(n).

---

## Bounded Deques and Eviction

Python's `deque(maxlen=N)` and several Java patterns implement **bounded deques** that automatically evict from the opposite end when the size limit is reached.

| Behavior                                | Python `deque(maxlen=N)` | Java `LinkedBlockingDeque(N)` |
| --------------------------------------- | ------------------------ | ----------------------------- |
| `push` when full                        | Drops opposite end       | Blocks until space available  |
| `tryPush` (non-blocking) when full      | n/a — always drops       | Returns false immediately     |
| Reverse end after eviction              | New element fits         | n/a                           |
| Use case                                | Recent-N caches, logs    | Producer-consumer with cap    |

`maxlen` semantics:

```python
>>> from collections import deque
>>> d = deque([1, 2, 3], maxlen=3)
>>> d.append(4)        # drops 1, deque is now [2, 3, 4]
>>> d.appendleft(0)    # drops 4, deque is now [0, 2, 3]
```

Notice that pushing to one end evicts from the other. This makes the bounded deque ideal for "last N items" queries: insertion order is preserved, the oldest is gone, and inserting either end never blocks or fails.

---

## Iterator Invalidation

Mutation during iteration is a classic source of subtle bugs. The rules differ across implementations:

| Implementation                | Iterator on mutation                                  |
| ----------------------------- | ----------------------------------------------------- |
| Java `ArrayDeque`             | `ConcurrentModificationException` on next `next()`    |
| Java `LinkedList`             | Same — fail-fast iterator                             |
| Java `ConcurrentLinkedDeque`  | Weakly consistent — may see new elements, may not, never throws |
| Python `collections.deque`    | `RuntimeError: deque mutated during iteration`        |
| Python `list`                 | Silently skips or repeats elements (no exception)     |
| C++ `std::deque`              | Iterators invalidated on insert/erase except at ends  |

The safe pattern when you need to remove items based on a predicate:

```python
# WRONG — mutates during iteration
for x in dq:
    if cond(x):
        dq.remove(x)

# RIGHT — collect, then mutate
to_remove = [x for x in dq if cond(x)]
for x in to_remove:
    dq.remove(x)

# Or — replace the deque
dq = deque(x for x in dq if not cond(x))
```

In Java, `Iterator.remove()` is the supported way; calling it after `next()` removes the element you just visited, and the iterator stays valid.

---

## Memory Layout and the Cost of Pointers

A small but striking thought experiment. Consider one million int32 elements.

- **`int[]` ring buffer:** 4 bytes per element + maybe 30% slack from doubling = ~5.2 MB.
- **`LinkedList<Integer>` in JVM:** each node has `prev`, `next`, `item` (3 references) plus a 16-byte object header. Add a boxed `Integer` (16 bytes header + 4 bytes value, often 16 bytes total). On a 64-bit VM with compressed oops: ~40 bytes per node + ~16 bytes per `Integer` = ~56 bytes per element = ~56 MB.

That is an **11x memory overhead**. Real workloads that look fine in a test crash with `OutOfMemoryError` in production for exactly this reason. The implementation choice ripples into your capacity plan.

For Go, a `container/list.Element` has similar overhead. A slice-based ring buffer is ~10x more memory-efficient than a `container/list` of `int` for one million elements.

---

## Code Examples

### Generic deque interface in Java

A reusable abstraction layer over `ArrayDeque` and `LinkedList`:

```java
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.LinkedList;

public class DequeFactory {

    public enum Backend { ARRAY, LINKED }

    /**
     * Picks a backing implementation based on the workload.
     * High-throughput, no-middle-insertion -> ARRAY.
     * Stable iterators or middle insertion  -> LINKED.
     */
    public static <T> Deque<T> create(Backend b, int expectedSize) {
        return switch (b) {
            case ARRAY  -> new ArrayDeque<>(Math.max(16, expectedSize));
            case LINKED -> new LinkedList<>();
        };
    }
}
```

### Deque-based palindrome check in all three languages

A textbook deque application. Push every char to the back; then repeatedly compare popFront with popBack.

#### Go

```go
import "unicode"

func IsPalindrome(s string) bool {
    runes := make([]rune, 0, len(s))
    for _, r := range s {
        if unicode.IsLetter(r) || unicode.IsDigit(r) {
            runes = append(runes, unicode.ToLower(r))
        }
    }
    // Use the slice itself as a deque with two indices.
    i, j := 0, len(runes)-1
    for i < j {
        if runes[i] != runes[j] {
            return false
        }
        i++
        j--
    }
    return true
}
```

#### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;

public static boolean isPalindrome(String s) {
    Deque<Character> dq = new ArrayDeque<>();
    for (char c : s.toCharArray()) {
        if (Character.isLetterOrDigit(c)) {
            dq.offerLast(Character.toLowerCase(c));
        }
    }
    while (dq.size() > 1) {
        if (!dq.pollFirst().equals(dq.pollLast())) return false;
    }
    return true;
}
```

#### Python

```python
from collections import deque

def is_palindrome(s: str) -> bool:
    dq: deque[str] = deque(c.lower() for c in s if c.isalnum())
    while len(dq) > 1:
        if dq.popleft() != dq.pop():
            return False
    return True
```

Note: the Go version uses two indices instead of an actual deque because Go has no built-in. The two-pointer approach on a slice is equivalent and idiomatic.

---

## Performance Comparison

To compare implementations empirically, run a million mixed pushFront/pushBack/popFront/popBack operations and time each.

### Go

```go
package main

import (
    "container/list"
    "fmt"
    "time"
)

func benchmark() {
    const N = 1_000_000

    // Ring buffer (our IntDeque from junior.md).
    start := time.Now()
    d := New(64)
    for i := 0; i < N; i++ {
        if i%2 == 0 {
            d.PushBack(i)
        } else {
            d.PushFront(i)
        }
    }
    for !d.IsEmpty() {
        if d.Size()%2 == 0 {
            d.PopFront()
        } else {
            d.PopBack()
        }
    }
    fmt.Printf("Ring buffer: %v\n", time.Since(start))

    // container/list — doubly-linked.
    start = time.Now()
    l := list.New()
    for i := 0; i < N; i++ {
        if i%2 == 0 {
            l.PushBack(i)
        } else {
            l.PushFront(i)
        }
    }
    for l.Len() > 0 {
        if l.Len()%2 == 0 {
            l.Remove(l.Front())
        } else {
            l.Remove(l.Back())
        }
    }
    fmt.Printf("container/list: %v\n", time.Since(start))
}
```

### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.LinkedList;

public class Bench {
    static final int N = 1_000_000;

    public static void main(String[] args) {
        Deque<Integer> arr = new ArrayDeque<>(64);
        long t0 = System.nanoTime();
        for (int i = 0; i < N; i++) {
            if ((i & 1) == 0) arr.offerLast(i);
            else arr.offerFirst(i);
        }
        while (!arr.isEmpty()) {
            if ((arr.size() & 1) == 0) arr.pollFirst();
            else arr.pollLast();
        }
        System.out.printf("ArrayDeque: %.2f ms%n", (System.nanoTime() - t0) / 1e6);

        Deque<Integer> lnk = new LinkedList<>();
        t0 = System.nanoTime();
        for (int i = 0; i < N; i++) {
            if ((i & 1) == 0) lnk.offerLast(i);
            else lnk.offerFirst(i);
        }
        while (!lnk.isEmpty()) {
            if ((lnk.size() & 1) == 0) lnk.pollFirst();
            else lnk.pollLast();
        }
        System.out.printf("LinkedList: %.2f ms%n", (System.nanoTime() - t0) / 1e6);
    }
}
```

### Python

```python
import time
from collections import deque

N = 1_000_000

# collections.deque — block-list.
dq = deque()
t0 = time.perf_counter()
for i in range(N):
    if i & 1 == 0:
        dq.append(i)
    else:
        dq.appendleft(i)
while dq:
    if len(dq) & 1 == 0:
        dq.popleft()
    else:
        dq.pop()
print(f"collections.deque: {(time.perf_counter() - t0)*1000:.2f} ms")

# list — wrong tool for this job. Demonstrates why.
lst: list[int] = []
t0 = time.perf_counter()
# We only go to N=10_000 here because list.insert(0, ...) is O(n) — full N would take hours.
for i in range(10_000):
    if i & 1 == 0:
        lst.append(i)
    else:
        lst.insert(0, i)
while lst:
    if len(lst) & 1 == 0:
        lst.pop(0)
    else:
        lst.pop()
print(f"list (only 10k!): {(time.perf_counter() - t0)*1000:.2f} ms")
```

Typical results on a modern laptop:

| Impl                          | N=1M mixed ops |
| ----------------------------- | -------------- |
| Go ring buffer                | ~15-25 ms      |
| Go `container/list`           | ~80-150 ms     |
| Java `ArrayDeque`             | ~30-60 ms      |
| Java `LinkedList`             | ~250-450 ms    |
| Python `collections.deque`    | ~80-150 ms     |
| Python `list` (10k only!)     | ~300-500 ms    |

The pattern is consistent: ring buffer / block-list beats linked list by 5-10x, and Python `list` for deque operations is in a different (much worse) league entirely.

---

## Best Practices

1. **Default to the array-backed deque.** Java: `ArrayDeque`. Python: `collections.deque`. Go: roll a ring buffer or use a maintained package. Reach for `LinkedList` only with a specific reason.
2. **Pre-size when possible.** `new ArrayDeque<>(expectedSize)` skips early resizes. Free win.
3. **Never use `list` as a deque in Python.** `list.pop(0)` and `list.insert(0, x)` are O(n).
4. **Never use `Stack` in Java.** It is synchronized and `Vector`-based. `ArrayDeque` is faster and more idiomatic.
5. **Use `maxlen` for bounded recent-N queries.** `deque(maxlen=N)` is cleaner than checking the size every time.
6. **Document the convention.** When passing deques between functions, comment which end is "front" — across languages this is a 50/50 guess.
7. **For thread safety**, use `ConcurrentLinkedDeque` (Java) or wrap with a lock (Go, Python). See senior.md.
8. **Profile before optimising.** A `LinkedList`-backed deque is fast enough for code that runs 100 times a request. Only optimise the hot path.

---

## Summary

| Aspect                         | Middle-level takeaway                                              |
| ------------------------------ | ------------------------------------------------------------------ |
| **Default implementation**     | Array-backed (ring buffer or block-list) — never doubly-linked unless required |
| **Stack/Queue replacement**    | Use the deque type in preference to legacy `Stack` / `LinkedList`  |
| **Sliding-window state**       | Deque is the canonical container — see 11-sliding-window           |
| **Undo/Redo**                  | Two deques (undo + redo) beats one bounded deque + cursor          |
| **Bounded deques**             | Python's `maxlen` is the cleanest API; Java needs `LinkedBlockingDeque` |
| **Iterator invalidation**      | Always use the language's official iterator-removal pattern        |
| **Memory overhead**            | Linked deques are 5-10x larger than ring-buffer deques — matters at scale |
| **Choice of implementation**   | Workload-driven — measure before defending a choice                |

By this level you should not just write deques but choose between implementations from first principles. Move to senior.md for the concurrent and system-design view.
