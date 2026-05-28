# Queue -- Language Specifications and Official Documentation

This document summarizes how queues are formally specified in Go, Java, and Python, with references to official documentation and key implementation details.

## Table of Contents

- [Go: Channels and container/list](#go-channels-and-containerlist)
  - [Go Channels](#go-channels)
  - [Channel Operations](#channel-operations)
  - [container/list as Queue](#containerlist-as-queue)
  - [container/heap for Priority Queue](#containerheap-for-priority-queue)
- [Java: Queue Interface and Implementations](#java-queue-interface-and-implementations)
  - [java.util.Queue Interface](#javautilqueue-interface)
  - [java.util.Deque Interface](#javautildeque-interface)
  - [Key Implementations](#key-implementations)
  - [java.util.concurrent Queue Classes](#javautilconcurrent-queue-classes)
  - [Method Summary Table](#method-summary-table)
- [Python: queue Module and collections.deque](#python-queue-module-and-collectionsdeque)
  - [collections.deque](#collectionsdeque)
  - [queue.Queue (Thread-Safe)](#queuequeue-thread-safe)
  - [queue.PriorityQueue](#queuepriorityqueue)
  - [multiprocessing.Queue](#multiprocessingqueue)
  - [asyncio.Queue](#asyncioqueue)
- [Cross-Language Comparison Table](#cross-language-comparison-table)

---

## Go: Channels and container/list

**Official documentation:**
- Go specification -- Channels: https://go.dev/ref/spec#Channel_types
- Go specification -- Send/Receive: https://go.dev/ref/spec#Send_statements
- container/list: https://pkg.go.dev/container/list
- container/heap: https://pkg.go.dev/container/heap

Go does not have a dedicated `Queue` type in the standard library. Queues are implemented using channels (for concurrent use), slices (for simple use), or `container/list` (for linked-list-based queues).

### Go Channels

A channel is a typed conduit for sending and receiving values between goroutines. Buffered channels behave as bounded FIFO queues.

```
ChannelType = ( "chan" | "chan" "<-" | "<-" "chan" ) ElementType .
```

```go
ch := make(chan int)      // unbuffered channel (synchronous)
ch := make(chan int, 100) // buffered channel with capacity 100 (queue)
```

Key properties:
- Buffered channels hold up to `cap(ch)` elements in FIFO order
- `ch <- val` blocks if the buffer is full (back-pressure)
- `val := <-ch` blocks if the buffer is empty
- Closing a channel (`close(ch)`) signals that no more values will be sent
- A `for val := range ch` loop receives until the channel is closed

### Channel Operations

| Operation         | Syntax           | Blocks When         | Returns               |
| ----------------- | ---------------- | ------------------- | --------------------- |
| Send              | `ch <- val`      | Buffer full          | --                    |
| Receive           | `val := <-ch`    | Buffer empty         | Value + ok bool       |
| Close             | `close(ch)`      | --                   | --                    |
| Length             | `len(ch)`        | --                   | Number of queued items|
| Capacity           | `cap(ch)`        | --                   | Buffer size           |
| Select (non-block)| `select { case ch <- val: ... default: ... }` | Never | -- |

```go
// Buffered channel as a queue
ch := make(chan string, 5)

ch <- "first"   // enqueue
ch <- "second"  // enqueue
ch <- "third"   // enqueue

fmt.Println(<-ch) // dequeue: "first"
fmt.Println(<-ch) // dequeue: "second"
fmt.Println(len(ch)) // 1 (one item remaining)
```

### container/list as Queue

`container/list` implements a doubly-linked list that can serve as a queue or deque.

```go
import "container/list"

q := list.New()

// Enqueue
q.PushBack(10)
q.PushBack(20)
q.PushBack(30)

// Dequeue
front := q.Front()
val := q.Remove(front).(int) // 10

// Peek
peek := q.Front().Value.(int) // 20

// Size
size := q.Len() // 2
```

Key methods:
| Method              | Description                         | Time  |
| ------------------- | ----------------------------------- | ----- |
| `PushBack(v)`       | Add to rear (enqueue)               | O(1)  |
| `PushFront(v)`      | Add to front (deque operation)      | O(1)  |
| `Front()`           | Get front element                   | O(1)  |
| `Back()`            | Get rear element                    | O(1)  |
| `Remove(e)`         | Remove element                      | O(1)  |
| `Len()`             | Number of elements                  | O(1)  |

### container/heap for Priority Queue

`container/heap` provides heap operations on any type that implements `heap.Interface`.

```go
type Interface interface {
    sort.Interface       // Len, Less, Swap
    Push(x interface{})
    Pop() interface{}
}
```

```go
heap.Init(h)      // establish heap invariant -- O(n)
heap.Push(h, val) // add element -- O(log n)
heap.Pop(h)       // remove and return min/max -- O(log n)
heap.Fix(h, i)    // re-establish heap after element i changed -- O(log n)
heap.Remove(h, i) // remove element at index i -- O(log n)
```

---

## Java: Queue Interface and Implementations

**Official documentation:**
- java.util.Queue: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Queue.html
- java.util.Deque: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Deque.html
- java.util.ArrayDeque: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/ArrayDeque.html
- java.util.PriorityQueue: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/PriorityQueue.html
- java.util.concurrent: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/package-summary.html

### java.util.Queue Interface

```java
public interface Queue<E> extends Collection<E> {
    boolean add(E e);        // insert, throws on failure
    boolean offer(E e);      // insert, returns false on failure
    E remove();              // remove head, throws if empty
    E poll();                // remove head, returns null if empty
    E element();             // peek head, throws if empty
    E peek();                // peek head, returns null if empty
}
```

Two types of methods:
| Operation | Throws Exception | Returns Special Value |
| --------- | ---------------- | --------------------- |
| Insert    | `add(e)`         | `offer(e)`            |
| Remove    | `remove()`       | `poll()`              |
| Examine   | `element()`      | `peek()`              |

### java.util.Deque Interface

Extends `Queue` with double-ended operations:

```java
public interface Deque<E> extends Queue<E> {
    void addFirst(E e);       E removeFirst();    E peekFirst();
    void addLast(E e);        E removeLast();     E peekLast();
    boolean offerFirst(E e);  E pollFirst();
    boolean offerLast(E e);   E pollLast();

    // Stack operations
    void push(E e);           // equivalent to addFirst
    E pop();                  // equivalent to removeFirst
}
```

### Key Implementations

| Class               | Backed By               | Bounded | Thread-Safe | Notes                          |
| ------------------- | ----------------------- | ------- | ----------- | ------------------------------ |
| `ArrayDeque`        | Resizable circular array | No     | No          | Fastest general-purpose queue  |
| `LinkedList`        | Doubly-linked list       | No     | No          | Implements Queue + Deque + List|
| `PriorityQueue`     | Binary heap (array)      | No     | No          | Natural/comparator ordering    |
| `ArrayBlockingQueue`| Fixed circular array     | Yes    | Yes         | Fair optional                  |
| `LinkedBlockingQueue`| Linked nodes            | Optional| Yes        | Higher throughput than ABQ     |
| `PriorityBlockingQueue`| Binary heap           | No     | Yes         | Thread-safe priority queue     |
| `ConcurrentLinkedQueue`| Lock-free linked list  | No     | Yes         | Non-blocking, Michael-Scott    |
| `DelayQueue`        | PriorityQueue            | No     | Yes         | Elements available after delay |
| `SynchronousQueue`  | None (direct handoff)    | Zero   | Yes         | Producer blocks until consumer |

**Best practices:**
- Use `ArrayDeque` as default queue/deque (fastest, lowest memory)
- Never use `LinkedList` as a queue (poor cache locality, high memory overhead per node)
- Use `ArrayBlockingQueue` for bounded producer-consumer
- Use `ConcurrentLinkedQueue` for non-blocking concurrent access

### java.util.concurrent Queue Classes

```java
// BlockingQueue methods (extend Queue)
void put(E e) throws InterruptedException;     // blocks if full
E take() throws InterruptedException;          // blocks if empty
boolean offer(E e, long timeout, TimeUnit unit); // blocks with timeout
E poll(long timeout, TimeUnit unit);           // blocks with timeout
int remainingCapacity();                        // available slots
int drainTo(Collection<? super E> c);          // bulk remove
```

### Method Summary Table

| Operation              | ArrayDeque    | PriorityQueue | ArrayBlockingQueue |
| ---------------------- | ------------- | ------------- | ------------------ |
| Add to rear            | `offerLast()` O(1) | `offer()` O(log n) | `put()` O(1) blocks |
| Remove from front      | `pollFirst()` O(1) | `poll()` O(log n)  | `take()` O(1) blocks |
| Peek front             | `peekFirst()` O(1) | `peek()` O(1)      | `peek()` O(1)       |
| Size                   | `size()` O(1)     | `size()` O(1)      | `size()` O(1)       |
| Contains               | `contains()` O(n) | `contains()` O(n)  | `contains()` O(n)   |

---

## Python: queue Module and collections.deque

**Official documentation:**
- collections.deque: https://docs.python.org/3/library/collections.html#collections.deque
- queue module: https://docs.python.org/3/library/queue.html
- multiprocessing.Queue: https://docs.python.org/3/library/multiprocessing.html#multiprocessing.Queue
- asyncio.Queue: https://docs.python.org/3/library/asyncio-queue.html

### collections.deque

`collections.deque` is a double-ended queue implemented as a doubly-linked list of fixed-size blocks (each block holds 64 items in CPython). It provides O(1) append and pop from both ends.

```python
from collections import deque

# Constructor
d = deque()                  # empty deque
d = deque([1, 2, 3])        # from iterable
d = deque(maxlen=100)       # bounded deque (oldest dropped when full)
```

Key methods:

| Method              | Description                        | Time  |
| ------------------- | ---------------------------------- | ----- |
| `append(x)`         | Add to right (rear)                | O(1)  |
| `appendleft(x)`     | Add to left (front)                | O(1)  |
| `pop()`             | Remove from right (rear)           | O(1)  |
| `popleft()`         | Remove from left (front)           | O(1)  |
| `extend(iterable)`  | Add multiple to right              | O(k)  |
| `extendleft(iterable)` | Add multiple to left (reversed) | O(k) |
| `rotate(n)`         | Rotate n steps right (neg = left)  | O(k)  |
| `clear()`           | Remove all elements                | O(n)  |
| `count(x)`          | Count occurrences of x             | O(n)  |
| `index(x)`          | Find first occurrence of x         | O(n)  |
| `reverse()`         | Reverse in place                   | O(n)  |
| `copy()`            | Shallow copy                       | O(n)  |
| `maxlen`            | Maximum size (None if unbounded)   | O(1)  |

```python
# Use as queue (FIFO)
q = deque()
q.append(1)    # enqueue
q.append(2)
q.popleft()    # dequeue -> 1

# Use as stack (LIFO)
s = deque()
s.append(1)    # push
s.append(2)
s.pop()        # pop -> 2

# Bounded deque (sliding window)
d = deque(maxlen=3)
d.append(1)  # [1]
d.append(2)  # [1, 2]
d.append(3)  # [1, 2, 3]
d.append(4)  # [2, 3, 4] -- 1 is dropped
```

**CPython implementation details:**
- Internal structure: doubly-linked list of blocks, each block is a C array of 64 `PyObject*` pointers
- Accessing by index `d[i]` is O(1) amortized (direct block calculation), but slower than list indexing
- `deque` is thread-safe for single append/pop operations in CPython (due to GIL), but not for compound operations
- Memory: approximately 8 bytes per element overhead (pointer in block)

### queue.Queue (Thread-Safe)

`queue.Queue` is a thread-safe FIFO queue for producer-consumer patterns. It uses `collections.deque` internally, protected by a mutex and condition variables.

```python
import queue

q = queue.Queue(maxsize=0)  # 0 = unlimited

# Methods
q.put(item, block=True, timeout=None)   # enqueue, blocks if full
q.get(block=True, timeout=None)         # dequeue, blocks if empty
q.put_nowait(item)                      # non-blocking put (raises Full)
q.get_nowait()                          # non-blocking get (raises Empty)
q.qsize()                               # approximate size
q.empty()                               # approximate emptiness check
q.full()                                # approximate fullness check
q.task_done()                           # signal that a get() item is processed
q.join()                                # block until all items are processed
```

| Method         | Description                               | Blocks    |
| -------------- | ----------------------------------------- | --------- |
| `put(item)`    | Add item, block if full                   | Yes       |
| `get()`        | Remove and return item, block if empty    | Yes       |
| `put_nowait()` | Add item, raise `queue.Full` if full      | No        |
| `get_nowait()` | Remove item, raise `queue.Empty` if empty | No        |
| `task_done()`  | Mark a previously enqueued task as done   | No        |
| `join()`       | Wait until all tasks are done             | Yes       |

### queue.PriorityQueue

Thread-safe priority queue. Lowest-valued entry is retrieved first.

```python
import queue

pq = queue.PriorityQueue()
pq.put((2, "low"))
pq.put((1, "high"))
pq.put((3, "lowest"))

print(pq.get())  # (1, "high")
print(pq.get())  # (2, "low")
```

Internally uses `heapq`. Entries should be tuples `(priority, data)` where priority is comparable.

### multiprocessing.Queue

For multi-process communication. Uses pipes and serialization (pickle) internally.

```python
from multiprocessing import Process, Queue

def worker(q):
    q.put("result from worker")

q = Queue()
p = Process(target=worker, args=(q,))
p.start()
print(q.get())  # "result from worker"
p.join()
```

| Feature           | queue.Queue          | multiprocessing.Queue    |
| ----------------- | -------------------- | ------------------------ |
| Use case          | Threading            | Multiprocessing          |
| Serialization     | None (shared memory) | pickle                   |
| Performance       | Fast                 | Slower (IPC overhead)    |
| `task_done/join`  | Yes                  | No (use JoinableQueue)   |

### asyncio.Queue

For async/await coroutine-based concurrency. Not thread-safe -- designed for single-threaded async code.

```python
import asyncio

async def main():
    q = asyncio.Queue(maxsize=10)

    await q.put("hello")
    item = await q.get()
    print(item)  # "hello"

asyncio.run(main())
```

---

## Cross-Language Comparison Table

| Feature                 | Go                          | Java                         | Python                        |
| ----------------------- | --------------------------- | ---------------------------- | ----------------------------- |
| Basic queue             | Slice or `container/list`   | `ArrayDeque`                 | `collections.deque`           |
| Thread-safe queue       | `chan T` (buffered)         | `ArrayBlockingQueue`         | `queue.Queue`                 |
| Lock-free queue         | Channel (runtime-managed)   | `ConcurrentLinkedQueue`      | N/A (GIL provides atomicity)  |
| Priority queue          | `container/heap`            | `PriorityQueue`              | `heapq` or `queue.PriorityQueue` |
| Deque                   | `container/list`            | `ArrayDeque`                 | `collections.deque`           |
| Bounded queue           | `make(chan T, n)`           | `ArrayBlockingQueue(n)`      | `queue.Queue(maxsize=n)`      |
| Multi-process queue     | N/A (channels across goroutines) | N/A (threads share memory) | `multiprocessing.Queue`  |
| Async queue             | Channels (native)           | `CompletableFuture` chains   | `asyncio.Queue`               |
| Built-in FIFO type      | No (use channels/slices)    | Yes (`Queue` interface)      | Yes (`collections.deque`)     |
| Default recommendation  | `chan` for concurrency, slice for local | `ArrayDeque`         | `collections.deque`           |
