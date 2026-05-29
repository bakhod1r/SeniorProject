# Deque (Double-Ended Queue) — Junior Level

## Table of Contents

1. [Introduction](#introduction)
2. [What Is a Deque?](#what-is-a-deque)
3. [Deque vs Stack vs Queue](#deque-vs-stack-vs-queue)
4. [Real-World Analogies](#real-world-analogies)
5. [Core Operations](#core-operations)
6. [Complexity Summary](#complexity-summary)
7. [Underlying Implementations](#underlying-implementations)
8. [Full Implementation — Circular Array Deque](#full-implementation--circular-array-deque)
   - [Go](#go-implementation)
   - [Java](#java-implementation)
   - [Python](#python-implementation)
9. [Why a Ring Buffer?](#why-a-ring-buffer)
10. [Growth Strategy](#growth-strategy)
11. [Front and Back Conventions](#front-and-back-conventions)
12. [Built-In Deques in Each Language](#built-in-deques-in-each-language)
13. [Where Deques Show Up](#where-deques-show-up)
14. [Common Mistakes](#common-mistakes)
15. [Visual Animation](#visual-animation)
16. [Summary](#summary)

---

## Introduction

A **deque** (pronounced "deck", short for **double-ended queue**) is a linear collection that supports amortized O(1) insertion and removal at **both ends**. It is the most general of the three basic linear ADTs:

- A **stack** allows push/pop at one end (LIFO).
- A **queue** allows push at one end and pop at the other (FIFO).
- A **deque** allows push and pop at **both** ends.

Anything you can do with a stack or a queue, you can do with a deque. That flexibility makes the deque the right pick when an algorithm needs to look at, add to, or trim **either end** of a sequence — sliding windows, undo/redo histories, work-stealing schedulers, palindrome checks, and 0-1 BFS all lean on this property.

This page assumes you already know basic queues and stacks. We covered FIFO queue internals in **03-queues** and LIFO stack internals in **04-stacks** — go read those first if you have not. Here we focus on what makes a deque distinct: both ends, both directions, and the ring buffer that makes it fast.

---

## What Is a Deque?

A deque is a sequence with four primary mutation operations:

```
                front                       back
                  |                           |
                  v                           v
   pushFront --> [ A ][ B ][ C ][ D ][ E ] <-- pushBack
   popFront  <-- [ A ][ B ][ C ][ D ][ E ] --> popBack
```

You can:
- **Add** elements at the front (`pushFront`).
- **Add** elements at the back (`pushBack`).
- **Remove** elements from the front (`popFront`).
- **Remove** elements from the back (`popBack`).
- **Peek** at either end without removing (`peekFront`, `peekBack`).
- Ask for **size** and **isEmpty**.

All of these must run in O(1) amortized time for an implementation to count as a proper deque. Random access (`get(i)`) is optional — some implementations support it in O(1), others in O(n).

---

## Deque vs Stack vs Queue

| ADT       | Insert       | Remove       | Order     | Use Case                          |
| --------- | ------------ | ------------ | --------- | --------------------------------- |
| **Stack** | One end      | Same end     | LIFO      | Function calls, undo, parsing     |
| **Queue** | One end      | Opposite end | FIFO      | Task scheduling, BFS, buffers     |
| **Deque** | Either end   | Either end   | Flexible  | Sliding windows, undo+redo, both  |

A deque is a **superset**. Restrict it to `pushBack` + `popBack` and it is a stack. Restrict it to `pushBack` + `popFront` and it is a queue. Real production code often picks a deque even when only stack or queue semantics are needed — because the implementation (Java's `ArrayDeque`, Python's `collections.deque`) is usually faster than a dedicated stack or queue class.

---

## Real-World Analogies

### 1. Subway car with doors on both ends

A subway car has doors at the front and the back. Passengers can board or exit from **either** end. The crowd in the middle stays put, but the people at the ends are the only ones who can move in or out. That is exactly a deque.

### 2. Deck of cards dealt from top or bottom

A magician deals cards from the top of the deck (standard) but can also deal from the bottom (a flourish). The deck supports operations on both ends. Sliding a new card under the deck is `pushFront`; dealing from the top is `popBack`.

### 3. Browser tab history

Press the back arrow and the page count grows on one side; press forward and it grows on the other. A bounded history that drops the oldest entry when full needs `pushBack` + `popFront` — both ends.

### 4. Bouncer at a busy club entrance

VIPs jump to the front of the line; ordinary guests join the back; the bouncer admits from the front; security ejects troublemakers from anywhere. The line is a deque (plus random removal, which would push us into a doubly-linked list).

### 5. Sliding window across a stream

A window of the last K stock prices: as a new price arrives, it joins the back; the oldest price leaves the front. The window's set of values is a deque.

> Where the analogies break: real-world queues let people enter or leave the middle. A deque does **not** — only the two ends are O(1). Touching the middle is O(n) or unsupported.

---

## Core Operations

| Operation    | Description                              | Returns        |
| ------------ | ---------------------------------------- | -------------- |
| `pushFront`  | Insert element at the front              | nothing        |
| `pushBack`   | Insert element at the back               | nothing        |
| `popFront`   | Remove and return the front element      | the element    |
| `popBack`    | Remove and return the back element       | the element    |
| `peekFront`  | Read the front element without removing  | the element    |
| `peekBack`   | Read the back element without removing   | the element    |
| `size`       | Number of elements currently stored      | integer        |
| `isEmpty`    | True if no elements                      | boolean        |
| `clear`      | Remove all elements                      | nothing        |
| `iterate`    | Walk front-to-back (or back-to-front)    | iterator       |

Optional but common:
- `pushFrontAll(collection)` — bulk insert at the front.
- `rotate(k)` — shift elements by k positions (Python's `collections.deque.rotate`).
- `maxlen` — bounded deque that automatically drops the opposite end when full.

---

## Complexity Summary

| Operation       | Circular Array       | Doubly-Linked List | Block-List (chunks) |
| --------------- | -------------------- | ------------------ | ------------------- |
| `pushFront`     | O(1) amortized       | O(1) worst         | O(1) amortized      |
| `pushBack`      | O(1) amortized       | O(1) worst         | O(1) amortized      |
| `popFront`      | O(1)                 | O(1)               | O(1)                |
| `popBack`       | O(1)                 | O(1)               | O(1)                |
| `peekFront`     | O(1)                 | O(1)               | O(1)                |
| `peekBack`      | O(1)                 | O(1)               | O(1)                |
| Random access   | O(1)                 | O(n)               | O(1)                |
| Memory per item | low (one slot)       | high (3 pointers)  | low (chunked array) |
| Cache locality  | excellent            | poor               | very good           |
| Iterator stable across growth | no       | yes                | yes (Python/C++ std::deque) |

---

## Underlying Implementations

Three approaches dominate.

### 1. Circular array (ring buffer)

A dynamic array plus two indices: `head` (front) and `tail` (back), with arithmetic done modulo the array length. This is what Java's `ArrayDeque` uses. Excellent cache behavior, compact memory, amortized O(1) growth — the price is that resize is O(n) when it happens.

### 2. Doubly-linked list

Each node holds `prev` and `next` pointers; the deque keeps `head` and `tail` references. Every push and pop is truly O(1) (no resize). The price is three machine words per element and dreadful cache locality. Java's `LinkedList` implements `Deque` this way.

### 3. Block-list (chunked array)

A sequence of fixed-size arrays connected by a small index. Each block has good locality; growing the deque allocates a new block instead of reallocating the whole thing. This is what Python's `collections.deque` and C++'s `std::deque` use. Best of both worlds for most workloads.

We will implement the circular array because it is the most pedagogically valuable — you see how head, tail, modular arithmetic, and growth all interact.

---

## Full Implementation — Circular Array Deque

We will build a deque of integers backed by a `[]int` ring. Invariants we must preserve:

- `head` is the index of the front element (when non-empty).
- `tail` is the index **just past** the back element. (Some textbooks store `tail` at the back element itself — we use "one past" to make the empty/full check easy.)
- `size` counts elements explicitly. We do **not** rely on `head == tail` to detect empty, because that also marks "exactly full" — easier to track size separately.
- When the array is full and we need to add, we grow to double the capacity and re-lay the elements starting at index 0.

### Go Implementation

```go
package deque

import "fmt"

// IntDeque is a deque of int values backed by a circular array.
//
// Invariants:
//   - cap(buf) is a power of two (not strictly required, but simplifies bit-mask indexing).
//   - head is the index of the front element when size > 0.
//   - When size == 0, head may point anywhere.
//   - buf[(head + i) % cap(buf)] is the i-th element from the front.
type IntDeque struct {
	buf  []int
	head int
	size int
}

// New creates an empty deque with the given initial capacity (rounded up to at least 8).
func New(capacity int) *IntDeque {
	if capacity < 8 {
		capacity = 8
	}
	return &IntDeque{buf: make([]int, capacity)}
}

// Size returns the number of elements stored.
func (d *IntDeque) Size() int { return d.size }

// IsEmpty reports whether the deque has no elements.
func (d *IntDeque) IsEmpty() bool { return d.size == 0 }

// PushBack appends x to the back. Amortized O(1).
func (d *IntDeque) PushBack(x int) {
	if d.size == len(d.buf) {
		d.grow()
	}
	tail := (d.head + d.size) % len(d.buf)
	d.buf[tail] = x
	d.size++
}

// PushFront prepends x to the front. Amortized O(1).
func (d *IntDeque) PushFront(x int) {
	if d.size == len(d.buf) {
		d.grow()
	}
	// Move head one slot backwards, wrapping if needed.
	d.head = (d.head - 1 + len(d.buf)) % len(d.buf)
	d.buf[d.head] = x
	d.size++
}

// PopFront removes and returns the front element. Panics if empty.
func (d *IntDeque) PopFront() int {
	if d.size == 0 {
		panic("PopFront on empty deque")
	}
	x := d.buf[d.head]
	d.buf[d.head] = 0 // help GC if storing pointers; harmless for int
	d.head = (d.head + 1) % len(d.buf)
	d.size--
	return x
}

// PopBack removes and returns the back element. Panics if empty.
func (d *IntDeque) PopBack() int {
	if d.size == 0 {
		panic("PopBack on empty deque")
	}
	tail := (d.head + d.size - 1) % len(d.buf)
	x := d.buf[tail]
	d.buf[tail] = 0
	d.size--
	return x
}

// PeekFront returns the front element without removing it.
func (d *IntDeque) PeekFront() int {
	if d.size == 0 {
		panic("PeekFront on empty deque")
	}
	return d.buf[d.head]
}

// PeekBack returns the back element without removing it.
func (d *IntDeque) PeekBack() int {
	if d.size == 0 {
		panic("PeekBack on empty deque")
	}
	tail := (d.head + d.size - 1) % len(d.buf)
	return d.buf[tail]
}

// grow doubles the capacity and re-lays elements starting at index 0.
// This is the amortization step — O(n) but only once every n/2 pushes.
func (d *IntDeque) grow() {
	newBuf := make([]int, len(d.buf)*2)
	for i := 0; i < d.size; i++ {
		newBuf[i] = d.buf[(d.head+i)%len(d.buf)]
	}
	d.buf = newBuf
	d.head = 0
}

// String renders the deque front-to-back for debugging.
func (d *IntDeque) String() string {
	s := "["
	for i := 0; i < d.size; i++ {
		if i > 0 {
			s += " "
		}
		s += fmt.Sprintf("%d", d.buf[(d.head+i)%len(d.buf)])
	}
	return s + "]"
}

// Example:
// func main() {
//     d := deque.New(4)
//     d.PushBack(1)
//     d.PushBack(2)
//     d.PushFront(0)   // [0 1 2]
//     d.PushBack(3)    // [0 1 2 3]
//     fmt.Println(d.PopFront()) // 0
//     fmt.Println(d.PopBack())  // 3
//     fmt.Println(d)            // [1 2]
// }
```

### Java Implementation

```java
import java.util.NoSuchElementException;

/**
 * Deque of int values backed by a circular array.
 *
 * Invariants:
 *   - head is the index of the front element when size > 0.
 *   - buf[(head + i) mod buf.length] is the i-th element from the front.
 *   - size is tracked explicitly so empty/full are unambiguous.
 */
public class IntDeque {

    private int[] buf;
    private int head;
    private int size;

    public IntDeque() { this(8); }

    public IntDeque(int initialCapacity) {
        if (initialCapacity < 8) initialCapacity = 8;
        this.buf = new int[initialCapacity];
        this.head = 0;
        this.size = 0;
    }

    public int size() { return size; }
    public boolean isEmpty() { return size == 0; }

    /** Amortized O(1). */
    public void pushBack(int x) {
        if (size == buf.length) grow();
        int tail = (head + size) % buf.length;
        buf[tail] = x;
        size++;
    }

    /** Amortized O(1). */
    public void pushFront(int x) {
        if (size == buf.length) grow();
        head = (head - 1 + buf.length) % buf.length;
        buf[head] = x;
        size++;
    }

    public int popFront() {
        if (size == 0) throw new NoSuchElementException("popFront on empty deque");
        int x = buf[head];
        head = (head + 1) % buf.length;
        size--;
        return x;
    }

    public int popBack() {
        if (size == 0) throw new NoSuchElementException("popBack on empty deque");
        int tail = (head + size - 1) % buf.length;
        int x = buf[tail];
        size--;
        return x;
    }

    public int peekFront() {
        if (size == 0) throw new NoSuchElementException("peekFront on empty deque");
        return buf[head];
    }

    public int peekBack() {
        if (size == 0) throw new NoSuchElementException("peekBack on empty deque");
        return buf[(head + size - 1) % buf.length];
    }

    /** Double capacity, re-laying elements starting at index 0. O(n). */
    private void grow() {
        int[] newBuf = new int[buf.length * 2];
        for (int i = 0; i < size; i++) {
            newBuf[i] = buf[(head + i) % buf.length];
        }
        buf = newBuf;
        head = 0;
    }

    @Override
    public String toString() {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < size; i++) {
            if (i > 0) sb.append(" ");
            sb.append(buf[(head + i) % buf.length]);
        }
        return sb.append("]").toString();
    }

    // public static void main(String[] args) {
    //     IntDeque d = new IntDeque(4);
    //     d.pushBack(1);
    //     d.pushBack(2);
    //     d.pushFront(0);    // [0 1 2]
    //     d.pushBack(3);     // [0 1 2 3]
    //     System.out.println(d.popFront()); // 0
    //     System.out.println(d.popBack());  // 3
    //     System.out.println(d);            // [1 2]
    // }
}
```

### Python Implementation

```python
"""Circular-array deque of integers.

This is for teaching. In real Python code, just use collections.deque.
"""


class IntDeque:
    """Deque of int values backed by a ring buffer.

    Invariants:
        head is the index of the front element when size > 0.
        buf[(head + i) % len(buf)] is the i-th element from the front.
        size is tracked explicitly so empty and full do not collide.
    """

    __slots__ = ("_buf", "_head", "_size")

    def __init__(self, capacity: int = 8) -> None:
        if capacity < 8:
            capacity = 8
        self._buf: list[int] = [0] * capacity
        self._head = 0
        self._size = 0

    def __len__(self) -> int:
        return self._size

    def is_empty(self) -> bool:
        return self._size == 0

    # ----- push -----
    def push_back(self, x: int) -> None:
        if self._size == len(self._buf):
            self._grow()
        tail = (self._head + self._size) % len(self._buf)
        self._buf[tail] = x
        self._size += 1

    def push_front(self, x: int) -> None:
        if self._size == len(self._buf):
            self._grow()
        self._head = (self._head - 1) % len(self._buf)
        self._buf[self._head] = x
        self._size += 1

    # ----- pop -----
    def pop_front(self) -> int:
        if self._size == 0:
            raise IndexError("pop_front from empty deque")
        x = self._buf[self._head]
        self._head = (self._head + 1) % len(self._buf)
        self._size -= 1
        return x

    def pop_back(self) -> int:
        if self._size == 0:
            raise IndexError("pop_back from empty deque")
        tail = (self._head + self._size - 1) % len(self._buf)
        x = self._buf[tail]
        self._size -= 1
        return x

    # ----- peek -----
    def peek_front(self) -> int:
        if self._size == 0:
            raise IndexError("peek_front on empty deque")
        return self._buf[self._head]

    def peek_back(self) -> int:
        if self._size == 0:
            raise IndexError("peek_back on empty deque")
        return self._buf[(self._head + self._size - 1) % len(self._buf)]

    # ----- growth -----
    def _grow(self) -> None:
        """Double capacity, re-laying elements starting at index 0. O(n)."""
        new_buf = [0] * (len(self._buf) * 2)
        for i in range(self._size):
            new_buf[i] = self._buf[(self._head + i) % len(self._buf)]
        self._buf = new_buf
        self._head = 0

    def __repr__(self) -> str:
        items = [self._buf[(self._head + i) % len(self._buf)] for i in range(self._size)]
        return f"IntDeque({items})"


# Example:
# if __name__ == "__main__":
#     d = IntDeque(4)
#     d.push_back(1)
#     d.push_back(2)
#     d.push_front(0)     # [0, 1, 2]
#     d.push_back(3)      # [0, 1, 2, 3]
#     print(d.pop_front()) # 0
#     print(d.pop_back())  # 3
#     print(d)             # IntDeque([1, 2])
```

---

## Why a Ring Buffer?

If you tried to implement a deque with a plain growing array, you would have a problem at the **front**. Pushing to the back is easy — append. Popping from the front means shifting every other element left by one slot — O(n) per operation, useless for a deque.

The ring buffer fixes this by **never shifting**. Instead of moving the data, we move the index. When `head` is at index 5 and we call `popFront`, we just bump `head` to index 6. When we call `pushFront`, we move `head` to index 4 (or wrap around to `len(buf) - 1` if we are at 0). The data sits still; only the bookkeeping moves.

```
Layout after several operations (cap=8, head=5, size=4):

buf[0] = b
buf[1] = c
buf[2] = .  (unused)
buf[3] = .  (unused)
buf[4] = .  (unused)
buf[5] = x      <-- head, front
buf[6] = y
buf[7] = a
        ^
       (a wraps around to b at index 0)

Logical order: x, y, a, b, c
```

The cost of this trick is the modular arithmetic in every index calculation. Modern CPUs do this in a single cycle; the cache locality of contiguous memory more than pays for it.

---

## Growth Strategy

Every amortized-O(1) data structure pays for cheap operations with a rare expensive one. For our deque, the expensive operation is **grow**.

When `size == cap(buf)`, the next push must allocate a new buffer. We:

1. Allocate a new buffer of `2 * len(buf)` slots.
2. Copy elements `[head, head+1, ..., head+size-1]` (with wraparound) into positions `[0, 1, ..., size-1]` of the new buffer.
3. Set `head = 0`. The old buffer is garbage collected.

This is O(size). But because we double, the next grow is far away — the next `size` elements all push in O(1). Amortized cost stays O(1). (We prove this rigorously in **professional.md** with the banker's method.)

A common bug: copying with a single `memcpy` is wrong because the elements may wrap. You either copy in two segments (`[head..end]` then `[0..tail]`) or use a per-element loop with `% len(buf)` like we did above. The loop is simpler and the JIT/Go compiler vectorises it for primitives.

---

## Front and Back Conventions

Conventions across the major languages differ in a way that catches everyone at least once:

| Language / API                  | Add to front       | Add to back         | Remove front   | Remove back   |
| ------------------------------- | ------------------ | ------------------- | -------------- | ------------- |
| Java `Deque` interface          | `addFirst` / `offerFirst` | `addLast` / `offerLast` | `pollFirst` | `pollLast`    |
| Java legacy `Stack`             | `push` (top = end) | n/a                 | `pop`          | n/a           |
| Python `collections.deque`      | `appendleft`       | `append`            | `popleft`      | `pop`         |
| Go `container/list`             | `PushFront`        | `PushBack`          | `Remove(Front())` | `Remove(Back())` |
| C++ `std::deque`                | `push_front`       | `push_back`         | `pop_front`    | `pop_back`    |

When you switch languages mid-project, double-check which end `push` defaults to. In Python, `deque.pop()` (no `left`) takes from the **back**, matching list semantics. In Java `Stack`, `push` adds at the top — but `Stack` extends `Vector` and the "top" is the end of the array, so `Stack.push` corresponds to `ArrayDeque.addLast`.

---

## Built-In Deques in Each Language

You should almost never roll your own in production. Here is what to reach for:

### Go

The standard library has **no built-in deque type**. Two options:

```go
// 1. container/list — doubly-linked list, supports Front/Back operations.
import "container/list"
l := list.New()
l.PushBack(1)
l.PushFront(0)
front := l.Front().Value.(int)
l.Remove(l.Front())

// 2. A slice with explicit indices (what we implemented above).
// For most workloads, the ring-buffer approach beats container/list because
// it avoids per-node allocation and gives much better cache behavior.
```

For high-throughput code you write the ring buffer or pull in a community package like `github.com/gammazero/deque`.

### Java

`ArrayDeque<E>` is the standard choice. Backed by a circular array. **Faster than `Stack` and `LinkedList`** for both stack and queue use cases. The official recommendation:

```java
import java.util.ArrayDeque;
import java.util.Deque;

Deque<Integer> d = new ArrayDeque<>();
d.addFirst(0);
d.addLast(1);
d.addLast(2);
int front = d.peekFirst();     // 0
int back  = d.peekLast();      // 2
int removed = d.pollFirst();   // 0, deque now [1, 2]

// As a stack — preferred over java.util.Stack:
d.push(99);    // == addFirst(99)
d.pop();       // == pollFirst()

// As a queue — preferred over LinkedList:
d.offer(42);   // == offerLast(42)
d.poll();      // == pollFirst()
```

`LinkedList` also implements `Deque` (doubly-linked). Pick it only if you need stable iterators across mutation or O(1) insertion in the middle via `ListIterator`.

### Python

`collections.deque` is the standard choice. Block-list internals (chunks of ~64 elements). Supports:

```python
from collections import deque

# Basic deque.
d = deque([1, 2, 3])
d.appendleft(0)        # deque([0, 1, 2, 3])
d.append(4)            # deque([0, 1, 2, 3, 4])
d.popleft()            # 0
d.pop()                # 4

# Bounded deque — drops the opposite end when capacity is exceeded.
recent = deque(maxlen=3)
for x in [1, 2, 3, 4, 5]:
    recent.append(x)
# recent is deque([3, 4, 5], maxlen=3)

# Rotate: shift elements by k. O(k).
r = deque([1, 2, 3, 4, 5])
r.rotate(2)            # deque([4, 5, 1, 2, 3])
r.rotate(-1)           # deque([5, 1, 2, 3, 4])
```

`list` is **not** a good substitute. `list.pop(0)` and `list.insert(0, x)` are both O(n) because they shift every element.

---

## Where Deques Show Up

Even at the junior level, you will run into deques in these situations:

| Use case                          | Why deque?                                                |
| --------------------------------- | --------------------------------------------------------- |
| **Sliding window maximum/min**    | Need to push at one end and pop from the other (see 14-monotonic-queue) |
| **Undo/redo**                     | Two stacks share state — easier as one deque              |
| **Browser history**               | Back/forward navigation maps to popFront/popBack          |
| **Recent items list (bounded)**   | `deque(maxlen=N)` discards the oldest automatically       |
| **Palindrome check**              | Compare popFront with popBack until empty                 |
| **0-1 BFS on graphs**             | Weight-0 edges push to front, weight-1 edges to back      |
| **Producer/consumer with priority** | Urgent items pushFront, normal items pushBack            |
| **Work-stealing schedulers**      | Owner pops one end; thieves pop the other (Chase-Lev)     |

For algorithm-specific patterns — sliding-window max with a monotonic deque, 0-1 BFS, sliding-window aggregates — see topics **11-sliding-window** and **14-monotonic-queue**. This page is about the data structure itself.

---

## Common Mistakes

| Mistake                                                | Why it bites                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| Using `list` instead of `collections.deque` in Python  | `pop(0)` and `insert(0, x)` are O(n), not O(1)                |
| Detecting empty with `head == tail` and no size field  | When the buffer is exactly full, `head == tail` is also true. Ambiguous. |
| Forgetting `+ len(buf)` before `% len(buf)` when going backwards | In languages where `%` returns negative numbers (Java, Go, C++), `head - 1` can land at -1 |
| Mixing stack and queue conventions on the same instance | `push` + `pop` is LIFO; mixing in `pollFirst` breaks ordering invariants downstream |
| Reading `peekFront` from an empty deque                | Returns garbage in some implementations, `null` in others, throws in others |
| Iterating while pushing                                | Many deque implementations (Java `ArrayDeque`) throw `ConcurrentModificationException` |
| Assuming O(1) random access                            | Only ring-buffer and block-list deques support it; linked-list deques are O(n) |
| Sharing one deque across goroutines/threads without a lock | Built-in deques are not thread-safe; see senior.md           |

---

## Visual Animation

> See [`animation.html`](./animation.html) for an interactive ring-buffer deque visualization.
>
> The animation shows:
> - Buckets arranged in a ring with current `head` and `tail` markers
> - `pushFront`, `pushBack`, `popFront`, `popBack` buttons
> - Wraparound highlighted when an operation crosses index 0
> - Resize animation when the buffer doubles
> - Live size and capacity counters
> - Operation log
> - Big-O table for every operation

---

## Summary

| Concept              | Key Point                                                       |
| -------------------- | --------------------------------------------------------------- |
| **Deque**            | Double-ended queue — push/pop at both ends in amortized O(1)    |
| **Generalization**   | Strictly more powerful than a stack or a queue                  |
| **Ring buffer impl** | Array + head index + modular arithmetic; what `ArrayDeque` uses |
| **Doubly-linked impl** | Three pointers per element; what `LinkedList` uses            |
| **Block-list impl**  | Chunked arrays; what Python's `deque` and C++'s `std::deque` use |
| **No growth without doubling** | Geometric growth is what keeps amortized cost O(1)    |
| **Front/back naming** | Varies across languages — read the docs every time             |
| **Built-ins to prefer** | Java: `ArrayDeque`. Python: `collections.deque`. Go: hand-rolled ring or `container/list`. |

Master the ring-buffer implementation. Once you can write `pushBack`, `popFront`, `grow`, and the modular index arithmetic from memory, you understand the deque. From there, monotonic deques (topic 14), work-stealing queues (senior), and 0-1 BFS (graphs) are all just patterns layered on top of these four operations.
