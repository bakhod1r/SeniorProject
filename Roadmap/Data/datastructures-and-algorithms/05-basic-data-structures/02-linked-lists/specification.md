# Linked Lists -- Standard Library Specification

## Overview

This document covers the linked list implementations provided by the standard libraries of Go, Java, and Python. Each section describes the API, internal implementation details, performance characteristics, and common usage patterns.

---

## Go: `container/list`

### Package

```go
import "container/list"
```

### Description

`container/list` implements a **doubly linked list**. The zero value is an empty list ready to use. It uses sentinel nodes internally (a root element that connects the front and back).

### Key Types

```go
type List struct {
    // contains filtered or unexported fields
}

type Element struct {
    Value interface{} // stored value; any type
    // contains filtered or unexported fields (next, prev, list)
}
```

### Constructor

```go
func New() *List
```

Returns an initialized, empty list.

### Core Methods

| Method                              | Description                                | Time    |
|-------------------------------------|--------------------------------------------|---------|
| `l.PushFront(v) *Element`          | Insert v at the front, return new element  | O(1)    |
| `l.PushBack(v) *Element`           | Insert v at the back, return new element   | O(1)    |
| `l.InsertBefore(v, mark) *Element` | Insert v before element mark               | O(1)    |
| `l.InsertAfter(v, mark) *Element`  | Insert v after element mark                | O(1)    |
| `l.Remove(e) interface{}`          | Remove element e from the list             | O(1)    |
| `l.MoveToFront(e)`                 | Move element e to the front                | O(1)    |
| `l.MoveToBack(e)`                  | Move element e to the back                 | O(1)    |
| `l.MoveBefore(e, mark)`            | Move element e before mark                 | O(1)    |
| `l.MoveAfter(e, mark)`             | Move element e after mark                  | O(1)    |
| `l.Front() *Element`               | Return the first element (nil if empty)    | O(1)    |
| `l.Back() *Element`                | Return the last element (nil if empty)     | O(1)    |
| `l.Len() int`                      | Return the number of elements              | O(1)    |
| `l.Init() *List`                   | Clear the list                             | O(1)*   |

*`Init` lazily clears by resetting the root sentinel.

### Element Navigation

```go
e.Next() *Element  // next element or nil
e.Prev() *Element  // previous element or nil
```

### Usage Example

```go
package main

import (
    "container/list"
    "fmt"
)

func main() {
    l := list.New()

    // Insert elements
    l.PushBack(1)
    l.PushBack(2)
    l.PushBack(3)
    e := l.PushFront(0)

    // Traverse forward
    for curr := l.Front(); curr != nil; curr = curr.Next() {
        fmt.Printf("%v ", curr.Value)
    }
    // Output: 0 1 2 3

    // Remove an element
    l.Remove(e) // removes 0

    // Move to front (useful for LRU cache)
    back := l.Back()
    l.MoveToFront(back) // moves 3 to front

    fmt.Println()
    for curr := l.Front(); curr != nil; curr = curr.Next() {
        fmt.Printf("%v ", curr.Value)
    }
    // Output: 3 1 2
}
```

### Internal Implementation

- Uses a **circular doubly linked list** with a sentinel root element.
- The root's `next` is the first element; root's `prev` is the last element.
- `Remove` checks that the element belongs to this list before removing.
- `Value` is `interface{}` -- no generics (pre-Go 1.18 design). Type assertion required when reading values.

### Caveats

- Not type-safe: `Value` is `interface{}`, so runtime type assertions are needed.
- Not concurrent-safe: no built-in synchronization. Use `sync.Mutex` if needed.
- No search method: you must traverse manually.
- Each element is a separate heap allocation (GC overhead for large lists).

---

## Java: `java.util.LinkedList`

### Package

```java
import java.util.LinkedList;
```

### Description

`java.util.LinkedList` implements a **doubly linked list**. It implements both `List` and `Deque` interfaces, making it usable as a list, stack, or queue.

### Class Signature

```java
public class LinkedList<E>
    extends AbstractSequentialList<E>
    implements List<E>, Deque<E>, Cloneable, Serializable
```

### Constructors

```java
LinkedList()           // empty list
LinkedList(Collection<? extends E> c)  // from a collection
```

### Core Methods (List interface)

| Method                        | Description                               | Time    |
|-------------------------------|-------------------------------------------|---------|
| `add(E e)`                   | Append to end                              | O(1)    |
| `add(int index, E e)`        | Insert at index                            | O(n)*   |
| `get(int index)`             | Get element at index                       | O(n)*   |
| `set(int index, E e)`        | Replace element at index                   | O(n)*   |
| `remove(int index)`          | Remove element at index                    | O(n)*   |
| `remove(Object o)`           | Remove first occurrence of o               | O(n)    |
| `contains(Object o)`         | Check if list contains o                   | O(n)    |
| `indexOf(Object o)`          | First index of o, or -1                    | O(n)    |
| `size()`                     | Number of elements                         | O(1)    |
| `isEmpty()`                  | Check if empty                             | O(1)    |
| `clear()`                    | Remove all elements                        | O(n)    |
| `toArray()`                  | Convert to Object array                    | O(n)    |

*Index-based operations are O(n) because they require traversal. The implementation optimizes by starting from the closer end (front or back).

### Deque Methods

| Method              | Description                    | Time |
|---------------------|--------------------------------|------|
| `addFirst(E e)`    | Insert at head                  | O(1) |
| `addLast(E e)`     | Insert at tail                  | O(1) |
| `removeFirst()`    | Remove and return head          | O(1) |
| `removeLast()`     | Remove and return tail          | O(1) |
| `getFirst()`       | Return head (no remove)         | O(1) |
| `getLast()`        | Return tail (no remove)         | O(1) |
| `peekFirst()`      | Return head or null             | O(1) |
| `peekLast()`       | Return tail or null             | O(1) |
| `offerFirst(E e)`  | Insert at head, return true     | O(1) |
| `offerLast(E e)`   | Insert at tail, return true     | O(1) |
| `pollFirst()`      | Remove head, return it or null  | O(1) |
| `pollLast()`       | Remove tail, return it or null  | O(1) |

### Stack Methods

| Method          | Description                   | Time |
|-----------------|-------------------------------|------|
| `push(E e)`    | Push onto stack (addFirst)     | O(1) |
| `pop()`        | Pop from stack (removeFirst)   | O(1) |
| `peek()`       | Peek at top (peekFirst)        | O(1) |

### Usage Example

```java
import java.util.LinkedList;

public class Demo {
    public static void main(String[] args) {
        LinkedList<String> list = new LinkedList<>();

        // As a list
        list.add("B");
        list.addFirst("A");
        list.addLast("C");
        System.out.println(list);  // [A, B, C]

        // As a deque/queue
        list.offerLast("D");
        String first = list.pollFirst();
        System.out.println(first);  // A
        System.out.println(list);   // [B, C, D]

        // As a stack
        list.push("X");
        System.out.println(list.pop());  // X

        // Iteration
        for (String s : list) {
            System.out.print(s + " ");
        }
        // Output: B C D

        // ListIterator for bidirectional traversal
        var it = list.listIterator();
        while (it.hasNext()) {
            System.out.print(it.next() + " ");
        }
        while (it.hasPrevious()) {
            System.out.print(it.previous() + " ");
        }
    }
}
```

### Internal Implementation

- Each node stores `item`, `next`, and `prev` pointers.
- Maintains `first` and `last` node references plus a `size` counter.
- Index-based access optimizes: if `index < size/2`, traverse from front; else from back.
- `ListIterator` allows O(1) insertion and removal at the iterator's position.

### When NOT to Use `LinkedList`

Java's `ArrayList` is almost always a better choice:

| Operation             | LinkedList | ArrayList    |
|-----------------------|-----------|--------------|
| get(index)            | O(n)      | O(1)         |
| add(end)              | O(1)      | O(1) amortized |
| add(index)            | O(n)*     | O(n)         |
| Iterator.remove()     | O(1)      | O(n)         |
| Memory per element    | ~40 bytes | ~4 bytes     |

*LinkedList's `add(index)` is O(n) for finding the position, but O(1) for the actual insertion. In practice, ArrayList's memory locality makes it faster for most workloads.

Use `LinkedList` only when:
- You need constant-time insertion/removal via an iterator.
- You use it as a `Deque` (though `ArrayDeque` is usually better).

---

## Python: `collections.deque`

### Module

```python
from collections import deque
```

### Description

Python does not have a dedicated linked list in the standard library. `collections.deque` (double-ended queue) is the closest equivalent. Internally, it is implemented as a **doubly linked list of fixed-size blocks** (an unrolled linked list), providing O(1) operations at both ends.

### Constructor

```python
deque()                    # empty deque
deque(iterable)            # from iterable
deque(iterable, maxlen=n)  # bounded deque (auto-evicts from opposite end)
```

### Core Methods

| Method                    | Description                                | Time    |
|---------------------------|--------------------------------------------|---------|
| `d.append(x)`            | Add x to the right end                     | O(1)    |
| `d.appendleft(x)`        | Add x to the left end                      | O(1)    |
| `d.pop()`                | Remove and return from right end           | O(1)    |
| `d.popleft()`            | Remove and return from left end            | O(1)    |
| `d.extend(iterable)`     | Extend right end with iterable             | O(k)    |
| `d.extendleft(iterable)` | Extend left end (reverses order)           | O(k)    |
| `d.rotate(n)`            | Rotate n steps to the right                | O(n)    |
| `d.clear()`              | Remove all elements                        | O(n)    |
| `d.count(x)`             | Count occurrences of x                     | O(n)    |
| `d.index(x)`             | First index of x                           | O(n)    |
| `d.remove(x)`            | Remove first occurrence of x               | O(n)    |
| `d.reverse()`            | Reverse in place                           | O(n)    |
| `d.copy()`               | Shallow copy                               | O(n)    |
| `len(d)`                 | Number of elements                         | O(1)    |
| `d[i]`                   | Access by index                            | O(n)*   |
| `d.maxlen`               | Maximum size (None if unbounded)           | O(1)    |

*Index access is O(1) for ends, O(n) for middle positions.

### Usage Example

```python
from collections import deque

# Basic usage
d = deque([1, 2, 3])
d.appendleft(0)
d.append(4)
print(list(d))  # [0, 1, 2, 3, 4]

# As a queue (FIFO)
queue = deque()
queue.append("first")
queue.append("second")
print(queue.popleft())  # "first"

# As a stack (LIFO)
stack = deque()
stack.append("first")
stack.append("second")
print(stack.pop())  # "second"

# Bounded deque (sliding window)
window = deque(maxlen=3)
for i in range(5):
    window.append(i)
    print(list(window))
# [0]
# [0, 1]
# [0, 1, 2]
# [1, 2, 3]  -- 0 is auto-evicted
# [2, 3, 4]  -- 1 is auto-evicted

# Rotation
d = deque([1, 2, 3, 4, 5])
d.rotate(2)
print(list(d))  # [4, 5, 1, 2, 3]
d.rotate(-2)
print(list(d))  # [1, 2, 3, 4, 5]
```

### Internal Implementation (CPython)

- Implemented as a **doubly linked list of fixed-size blocks** (each block holds 64 elements in CPython).
- This is an **unrolled linked list** -- combining linked list flexibility with array cache efficiency.
- The left and right indices track which slots in the first and last blocks are occupied.
- This design gives O(1) amortized append/pop at both ends while maintaining good cache locality for iteration.

### `deque` vs `list` Performance

| Operation             | deque   | list            |
|-----------------------|---------|-----------------|
| append (right)        | O(1)    | O(1) amortized  |
| appendleft (left)     | O(1)    | O(n)            |
| pop (right)           | O(1)    | O(1)            |
| popleft (left)        | O(1)    | O(n)            |
| Random access [i]     | O(n)    | O(1)            |
| Insert in middle      | O(n)    | O(n)            |
| Iteration             | O(n)    | O(n)            |
| Memory per element    | ~8 bytes + overhead/64 | ~8 bytes |

### Thread Safety

`deque.append()` and `deque.popleft()` are **thread-safe** in CPython due to the GIL. This makes `deque` suitable as a simple producer-consumer queue without explicit locking. However, compound operations (check-then-act) are not atomic and still require synchronization.

### `maxlen` for Bounded Buffers

```python
# Keep only the last 1000 log entries
log_buffer = deque(maxlen=1000)
for line in stream:
    log_buffer.append(line)
    # Oldest entries are auto-evicted when capacity is exceeded
```

This is the idiomatic way to implement a fixed-size sliding window in Python.

---

## Cross-Language Comparison

| Feature                    | Go `container/list`      | Java `LinkedList`         | Python `deque`            |
|----------------------------|--------------------------|---------------------------|---------------------------|
| Type                       | Doubly linked list       | Doubly linked list        | Unrolled doubly linked    |
| Type safety                | No (`interface{}`)       | Yes (generics)            | No (any type)             |
| Thread safe                | No                       | No (use `Collections.synchronizedList`) | Partially (GIL)     |
| Implements                 | N/A                      | List, Deque, Queue        | Sequence-like             |
| Index access               | Manual traversal         | O(n) with optimization    | O(n) for middle           |
| Direct node manipulation   | Yes (Element pointers)   | Via ListIterator          | No                        |
| Bounded variant            | No                       | No                        | Yes (`maxlen`)            |
| Best use case              | LRU cache, custom orders | Iterator-based removal    | Queue, sliding window     |
