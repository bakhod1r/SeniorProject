# Stack -- Standard Library Specification

This document covers the standard library stack implementations in Go, Java, and Python: their APIs, performance characteristics, internal mechanics, and best practices.

---

## Table of Contents

1. [Go: Slice as Stack](#go-slice-as-stack)
2. [Java: Stack, ArrayDeque, and Deque Interface](#java-stack-arraydeque-and-deque-interface)
3. [Python: list as Stack](#python-list-as-stack)
4. [Comparison Table](#comparison-table)
5. [Best Practices](#best-practices)

---

## Go: Slice as Stack

Go has no dedicated stack type. The idiomatic approach is to use a **slice** (`[]T`) as a stack.

### API Pattern

```go
// Declare
var stack []int

// Push
stack = append(stack, value)

// Pop
top := stack[len(stack)-1]
stack = stack[:len(stack)-1]

// Peek
top := stack[len(stack)-1]

// IsEmpty
isEmpty := len(stack) == 0

// Size
size := len(stack)
```

### Internal Mechanics

Go slices are backed by a dynamically resizable array. Key details:

| Property          | Value                                           |
| ----------------- | ----------------------------------------------- |
| Initial capacity  | 0 (or specified via `make([]T, 0, cap)`)        |
| Growth strategy   | ~2x for small slices, ~1.25x for large slices   |
| Shrinking         | Manual (slice does NOT auto-shrink)              |
| Memory layout     | Contiguous array + (pointer, length, capacity)   |

### Growth Behavior

```go
s := []int{}
// cap: 0 -> 1 -> 2 -> 4 -> 8 -> 16 -> 32 -> ...
for i := 0; i < 100; i++ {
    s = append(s, i)
    fmt.Printf("len=%d cap=%d\n", len(s), cap(s))
}
```

### Memory Considerations

**Slice does not release memory on pop.** When you do `stack = stack[:len(stack)-1]`, the underlying array retains its capacity. The "popped" element is still in memory (though inaccessible via the slice).

To release memory for large stacks that shrink significantly:

```go
// Manual shrink if utilization is low
if len(stack) > 0 && len(stack) < cap(stack)/4 {
    newStack := make([]int, len(stack))
    copy(newStack, stack)
    stack = newStack
}
```

### Pre-allocation

If you know the approximate size, pre-allocate to avoid repeated growth:

```go
stack := make([]int, 0, 1000) // capacity 1000, length 0
```

### Thread Safety

Go slices are **NOT thread-safe**. For concurrent access, wrap with a `sync.Mutex`:

```go
type SafeStack struct {
    mu   sync.Mutex
    data []int
}

func (s *SafeStack) Push(val int) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.data = append(s.data, val)
}

func (s *SafeStack) Pop() (int, bool) {
    s.mu.Lock()
    defer s.mu.Unlock()
    if len(s.data) == 0 {
        return 0, false
    }
    top := s.data[len(s.data)-1]
    s.data = s.data[:len(s.data)-1]
    return top, true
}
```

---

## Java: Stack, ArrayDeque, and Deque Interface

Java has multiple stack-capable classes. The recommended one is `ArrayDeque`.

### java.util.Stack (Legacy -- Do NOT Use)

`Stack` extends `Vector`, which is synchronized on every operation. This makes it slow for single-threaded use and poorly designed for concurrent use.

```java
Stack<Integer> stack = new Stack<>();
stack.push(1);
int top = stack.pop();
int peek = stack.peek();
boolean empty = stack.isEmpty();
int size = stack.size();
```

**Why avoid it:**
- Inherits from `Vector` (synchronized, slow).
- Allows `get(index)` and `insertElementAt()` -- breaks stack abstraction.
- `Iterator` traverses bottom-to-top, which is confusing for a stack.

### java.util.ArrayDeque (Recommended)

`ArrayDeque` is a resizable circular array implementing the `Deque` interface. It is the best general-purpose stack in Java.

```java
Deque<Integer> stack = new ArrayDeque<>();

// Push
stack.push(value);       // adds to front (acts as top)

// Pop
int top = stack.pop();   // removes from front

// Peek
int top = stack.peek();  // reads front without removing

// IsEmpty
boolean empty = stack.isEmpty();

// Size
int size = stack.size();
```

### Internal Mechanics

| Property          | Value                                        |
| ----------------- | -------------------------------------------- |
| Initial capacity  | 16 (default) or specified in constructor     |
| Growth strategy   | Doubles when full                            |
| Memory layout     | Circular array with head and tail indices    |
| Null elements     | NOT allowed (throws NullPointerException)    |

### Deque Interface Methods (Stack Usage)

| Stack Operation | Deque Method   | Throws on failure | Returns null on failure |
| --------------- | -------------- | ----------------- | ----------------------- |
| Push            | `push(e)`      | Yes               | --                      |
| Pop             | `pop()`        | Yes               | `poll()`                |
| Peek            | `peek()`       | No (returns null) | `peekFirst()`           |
| Push            | `offerFirst(e)`| No (returns bool) | --                      |

### LinkedList as Stack (Not Recommended)

`LinkedList` also implements `Deque` but has higher overhead per element (node objects + pointers).

```java
Deque<Integer> stack = new LinkedList<>(); // works but slower
```

### Thread-Safe Options

| Class                      | Thread Safety       | Notes                          |
| -------------------------- | ------------------- | ------------------------------ |
| `Stack` (legacy)           | Synchronized        | Slow, legacy                   |
| `ArrayDeque`               | NOT thread-safe     | Best single-threaded           |
| `ConcurrentLinkedDeque`    | Lock-free           | Best concurrent                |
| `Collections.synchronizedDeque` | Wrapper       | External synchronization       |

```java
// Concurrent stack
Deque<Integer> stack = new ConcurrentLinkedDeque<>();
stack.push(1);
int top = stack.pop();
```

---

## Python: list as Stack

Python's built-in `list` is the standard stack implementation.

### API

```python
stack = []

# Push
stack.append(value)

# Pop
top = stack.pop()         # raises IndexError if empty

# Peek
top = stack[-1]           # raises IndexError if empty

# IsEmpty
is_empty = len(stack) == 0
# or: is_empty = not stack

# Size
size = len(stack)
```

### Internal Mechanics

| Property          | Value                                                |
| ----------------- | ---------------------------------------------------- |
| Type              | Dynamic array (C array of PyObject pointers)         |
| Initial capacity  | 0 (grows as needed)                                  |
| Growth strategy   | ~1.125x + constant (see `list_resize` in CPython)    |
| Memory layout     | Contiguous array of pointers to PyObject              |

### Growth Formula (CPython)

From CPython source (`Objects/listobject.c`):

```c
new_allocated = ((size_t)newsize + (newsize >> 3) + 6) & ~(size_t)3;
```

This grows by approximately 12.5% plus a small constant, which is more conservative than Go or Java's doubling strategy.

### Performance of append/pop

| Operation       | Average | Worst Case | Notes                       |
| --------------- | ------- | ---------- | --------------------------- |
| `append(x)`     | O(1)    | O(n)       | Amortized O(1); resize      |
| `pop()`         | O(1)    | O(1)       | No resize on pop            |
| `pop(0)`        | O(n)    | O(n)       | DO NOT USE for stack         |
| `stack[-1]`     | O(1)    | O(1)       | Direct index access          |

**Important:** `pop(0)` shifts all elements and is O(n). For FIFO behavior, use `collections.deque`.

### collections.deque as Stack

`deque` can also serve as a stack with O(1) append/pop on both ends. However, for pure stack usage, `list` is slightly faster due to simpler memory layout.

```python
from collections import deque

stack = deque()
stack.append(1)      # push
top = stack.pop()    # pop
top = stack[-1]      # peek
```

### Thread Safety

Python's GIL makes individual `list.append()` and `list.pop()` operations thread-safe at the bytecode level. However, compound operations (check-then-act) are NOT atomic:

```python
# NOT thread-safe compound operation:
if stack:           # another thread could pop between these
    stack.pop()     # two bytecode operations

# Use a lock for compound operations:
import threading
lock = threading.Lock()

with lock:
    if stack:
        stack.pop()
```

For truly concurrent stacks, use `queue.LifoQueue`:

```python
from queue import LifoQueue

stack = LifoQueue()
stack.put(1)          # push (thread-safe, blocking)
top = stack.get()     # pop (thread-safe, blocking)
empty = stack.empty()
```

### typing and Type Hints

```python
from typing import List

stack: List[int] = []
# or in Python 3.9+:
stack: list[int] = []
```

---

## Comparison Table

| Feature              | Go (slice)        | Java (ArrayDeque)     | Python (list)         |
| -------------------- | ----------------- | --------------------- | --------------------- |
| Dedicated type       | No                | Yes (Deque interface) | No                    |
| Push                 | `append(s, v)`    | `push(v)`             | `append(v)`           |
| Pop                  | Manual slice      | `pop()`               | `pop()`               |
| Peek                 | `s[len(s)-1]`     | `peek()`              | `s[-1]`               |
| IsEmpty              | `len(s) == 0`     | `isEmpty()`           | `not s`               |
| Null/nil elements    | Allowed           | NOT allowed           | Allowed (None)        |
| Auto-shrink          | No                | No                    | No                    |
| Thread-safe          | No                | No                    | GIL-protected*        |
| Growth factor        | ~2x then ~1.25x   | 2x                    | ~1.125x               |
| Initial capacity     | 0                 | 16                    | 0                     |
| Generic              | Yes (Go 1.18+)    | Yes                   | Yes (dynamic typing)  |

*Individual operations only; compound check-then-act is not safe.

---

## Best Practices

### Go

1. Use `[]T` slices -- do not import external stack libraries for simple cases.
2. Pre-allocate with `make([]T, 0, expectedSize)` when the size is known.
3. For concurrent access, use `sync.Mutex` or a channel-based approach.
4. Be aware that popped elements are retained in memory until the slice is reallocated.

### Java

1. **Never use `java.util.Stack`**. Use `ArrayDeque` instead.
2. Program to the `Deque` interface for flexibility.
3. Use `ConcurrentLinkedDeque` for concurrent scenarios.
4. Remember that `ArrayDeque` does not allow null elements.

### Python

1. Use `list` for single-threaded stacks -- it is the fastest option.
2. Use `collections.deque` if you also need efficient front operations.
3. Use `queue.LifoQueue` for thread-safe, blocking stack behavior.
4. Never use `list.pop(0)` for stack operations -- it is O(n).
5. Catch `IndexError` on pop/peek of empty stacks, or check `if stack:` first.
