# Queue -- Find the Bug Exercises

Each exercise contains buggy code. Find the bug, explain what goes wrong, and fix it.

## Table of Contents

- [Bug 1: Wrong Dequeue Order (Go)](#bug-1-wrong-dequeue-order-go)
- [Bug 2: Circular Queue Wraparound Missing (Java)](#bug-2-circular-queue-wraparound-missing-java)
- [Bug 3: Using list.pop(0) in a Loop (Python)](#bug-3-using-listpop0-in-a-loop-python)
- [Bug 4: Missing Empty Check Before Peek (Go)](#bug-4-missing-empty-check-before-peek-go)
- [Bug 5: Rear Not Reset on Last Dequeue (Java)](#bug-5-rear-not-reset-on-last-dequeue-java)
- [Bug 6: BFS Visited Check Too Late (Python)](#bug-6-bfs-visited-check-too-late-python)
- [Bug 7: Circular Queue Full/Empty Confusion (Go)](#bug-7-circular-queue-fullempty-confusion-go)
- [Bug 8: Priority Queue Wrong Comparator (Java)](#bug-8-priority-queue-wrong-comparator-java)
- [Bug 9: Deque Rotate Direction Error (Python)](#bug-9-deque-rotate-direction-error-python)
- [Bug 10: Two-Stack Queue Transfer Bug (Go)](#bug-10-two-stack-queue-transfer-bug-go)
- [Bug 11: Producer-Consumer Deadlock (Java)](#bug-11-producer-consumer-deadlock-java)
- [Bug 12: Queue Size Not Updated (Python)](#bug-12-queue-size-not-updated-python)
- [Bug 13: Monotonic Queue Off-by-One (Go)](#bug-13-monotonic-queue-off-by-one-go)

---

## Bug 1: Wrong Dequeue Order (Go)

### Buggy Code

```go
package main

import "fmt"

type Queue struct {
	data []int
}

func (q *Queue) Enqueue(val int) {
	q.data = append(q.data, val)
}

func (q *Queue) Dequeue() int {
	// Remove from the rear (like a stack)
	val := q.data[len(q.data)-1]
	q.data = q.data[:len(q.data)-1]
	return val
}

func main() {
	q := &Queue{}
	q.Enqueue(1)
	q.Enqueue(2)
	q.Enqueue(3)
	fmt.Println(q.Dequeue()) // Expected: 1, Got: 3
	fmt.Println(q.Dequeue()) // Expected: 2, Got: 2
}
```

### What Goes Wrong

The `Dequeue` method removes from the **rear** of the slice (like stack pop), not the front. This gives LIFO order instead of FIFO.

### Fixed Code

```go
func (q *Queue) Dequeue() int {
	val := q.data[0]
	q.data = q.data[1:]
	return val
}
```

---

## Bug 2: Circular Queue Wraparound Missing (Java)

### Buggy Code

```java
public class CircularQueue {
    private int[] data;
    private int front = 0, rear = -1, size = 0, capacity;

    public CircularQueue(int capacity) {
        this.capacity = capacity;
        this.data = new int[capacity];
    }

    public void enqueue(int val) {
        if (size == capacity) throw new RuntimeException("Full");
        rear++;  // BUG: no wraparound
        data[rear] = val;
        size++;
    }

    public int dequeue() {
        if (size == 0) throw new RuntimeException("Empty");
        int val = data[front];
        front++;  // BUG: no wraparound
        size--;
        return val;
    }
}
```

### What Goes Wrong

After `rear` reaches `capacity - 1` and some elements have been dequeued, the next `enqueue` increments `rear` past the array bound, causing `ArrayIndexOutOfBoundsException`. The front has the same issue.

### Fixed Code

```java
public void enqueue(int val) {
    if (size == capacity) throw new RuntimeException("Full");
    rear = (rear + 1) % capacity;  // wraparound
    data[rear] = val;
    size++;
}

public int dequeue() {
    if (size == 0) throw new RuntimeException("Empty");
    int val = data[front];
    front = (front + 1) % capacity;  // wraparound
    size--;
    return val;
}
```

---

## Bug 3: Using list.pop(0) in a Loop (Python)

### Buggy Code

```python
def process_queue(items):
    """Process all items in FIFO order."""
    queue = list(items)  # e.g., 1,000,000 items
    results = []
    while queue:
        item = queue.pop(0)  # BUG: O(n) per call
        results.append(item * 2)
    return results
```

### What Goes Wrong

`list.pop(0)` is O(n) because it shifts all remaining elements one position left. For n items, the total complexity is O(n^2). With 1,000,000 items, this takes minutes instead of milliseconds.

### Fixed Code

```python
from collections import deque

def process_queue(items):
    queue = deque(items)
    results = []
    while queue:
        item = queue.popleft()  # O(1)
        results.append(item * 2)
    return results
```

---

## Bug 4: Missing Empty Check Before Peek (Go)

### Buggy Code

```go
package main

import "fmt"

type Queue struct {
	data []int
}

func (q *Queue) Enqueue(val int) {
	q.data = append(q.data, val)
}

func (q *Queue) Peek() int {
	return q.data[0]  // BUG: panics if data is empty
}

func main() {
	q := &Queue{}
	fmt.Println(q.Peek())  // panic: runtime error: index out of range [0] with length 0
}
```

### What Goes Wrong

Calling `Peek()` on an empty queue causes a panic because `q.data[0]` accesses index 0 of an empty slice.

### Fixed Code

```go
func (q *Queue) Peek() (int, error) {
	if len(q.data) == 0 {
		return 0, errors.New("queue is empty")
	}
	return q.data[0], nil
}
```

---

## Bug 5: Rear Not Reset on Last Dequeue (Java)

### Buggy Code

```java
public class LinkedQueue {
    private static class Node {
        int val;
        Node next;
        Node(int val) { this.val = val; }
    }

    private Node front, rear;
    private int size;

    public void enqueue(int val) {
        Node n = new Node(val);
        if (rear != null) rear.next = n;
        rear = n;
        if (front == null) front = n;
        size++;
    }

    public int dequeue() {
        int val = front.val;
        front = front.next;
        // BUG: rear still points to the removed node when queue becomes empty
        size--;
        return val;
    }
}
```

### What Goes Wrong

When the last element is dequeued, `front` becomes `null` but `rear` still points to the old (now removed) node. The next `enqueue` sets `rear.next = n`, which links from a dead node. The new element is enqueued but `front` is never updated because `front == null` only triggers when `rear` was also `null`.

Actually the condition `if (front == null) front = n` does fire, but `rear.next = n` adds to the dead node first. The state is inconsistent.

### Fixed Code

```java
public int dequeue() {
    int val = front.val;
    front = front.next;
    if (front == null) {
        rear = null;  // reset rear when queue becomes empty
    }
    size--;
    return val;
}
```

---

## Bug 6: BFS Visited Check Too Late (Python)

### Buggy Code

```python
from collections import deque

def bfs(graph, start):
    visited = set()
    queue = deque([start])
    order = []

    while queue:
        node = queue.popleft()
        if node in visited:  # BUG: checking too late
            continue
        visited.add(node)
        order.append(node)

        for neighbor in graph.get(node, []):
            queue.append(neighbor)  # BUG: may add same node multiple times

    return order
```

### What Goes Wrong

The visited check happens at dequeue time, not enqueue time. This means the same node can be enqueued multiple times by different parents. For a dense graph, the queue grows much larger than necessary (up to O(E) instead of O(V)), wasting time and memory.

### Fixed Code

```python
def bfs(graph, start):
    visited = {start}  # mark visited at enqueue time
    queue = deque([start])
    order = []

    while queue:
        node = queue.popleft()
        order.append(node)

        for neighbor in graph.get(node, []):
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)

    return order
```

---

## Bug 7: Circular Queue Full/Empty Confusion (Go)

### Buggy Code

```go
type CircularQueue struct {
	data     []int
	front    int
	rear     int
	capacity int
}

func NewCircularQueue(cap int) *CircularQueue {
	return &CircularQueue{
		data:     make([]int, cap),
		front:    0,
		rear:     0,
		capacity: cap,
	}
}

func (q *CircularQueue) IsEmpty() bool {
	return q.front == q.rear  // BUG: same condition for full!
}

func (q *CircularQueue) IsFull() bool {
	return q.front == q.rear  // BUG: identical to IsEmpty
}
```

### What Goes Wrong

When using only `front` and `rear` pointers without a `size` counter, an empty queue (`front == rear`) and a full queue (`front == rear` after wrapping) have the same condition. This makes it impossible to distinguish empty from full.

### Fixed Code (Option A: track size)

```go
type CircularQueue struct {
	data     []int
	front    int
	rear     int
	size     int
	capacity int
}

func (q *CircularQueue) IsEmpty() bool { return q.size == 0 }
func (q *CircularQueue) IsFull() bool  { return q.size == q.capacity }
```

### Fixed Code (Option B: sacrifice one slot)

```go
func (q *CircularQueue) IsEmpty() bool {
	return q.front == q.rear
}

func (q *CircularQueue) IsFull() bool {
	return (q.rear+1)%q.capacity == q.front  // one slot always empty
}
```

---

## Bug 8: Priority Queue Wrong Comparator (Java)

### Buggy Code

```java
import java.util.PriorityQueue;

public class TaskScheduler {
    record Task(String name, int priority) {}

    public static void main(String[] args) {
        // Want highest priority first (max-heap)
        PriorityQueue<Task> pq = new PriorityQueue<>(
            (a, b) -> a.priority - b.priority  // BUG: this is min-heap
        );

        pq.offer(new Task("Low", 1));
        pq.offer(new Task("High", 10));
        pq.offer(new Task("Medium", 5));

        System.out.println(pq.poll().name());  // Expected: "High", Got: "Low"
    }
}
```

### What Goes Wrong

`a.priority - b.priority` sorts in ascending order (min-heap). The task with the lowest priority number is dequeued first. For a max-heap, the comparator must be reversed.

### Fixed Code

```java
PriorityQueue<Task> pq = new PriorityQueue<>(
    (a, b) -> b.priority - a.priority  // max-heap: higher priority first
);
```

---

## Bug 9: Deque Rotate Direction Error (Python)

### Buggy Code

```python
from collections import deque

def josephus(names, k):
    """Eliminate every k-th person in a circle."""
    dq = deque(names)
    while len(dq) > 1:
        dq.rotate(k - 1)  # BUG: wrong direction
        dq.popleft()       # eliminate the k-th person
    return dq[0]

# Expected: count forward (clockwise)
# With names=["A","B","C","D","E"], k=2:
# Should eliminate B, D, A, E -> survivor C
print(josephus(["A", "B", "C", "D", "E"], 2))
# Got wrong answer because rotation is in the wrong direction
```

### What Goes Wrong

`deque.rotate(n)` with positive n rotates **right** (moves elements from the right end to the left). To simulate counting **forward** (left to right), we need negative rotation: `rotate(-(k-1))` moves elements from the left to the right, effectively advancing the "current position" forward.

### Fixed Code

```python
def josephus(names, k):
    dq = deque(names)
    while len(dq) > 1:
        dq.rotate(-(k - 1))  # rotate left: advance forward
        dq.popleft()
    return dq[0]
```

---

## Bug 10: Two-Stack Queue Transfer Bug (Go)

### Buggy Code

```go
type StackQueue struct {
	inbox  []int
	outbox []int
}

func (q *StackQueue) Enqueue(val int) {
	q.inbox = append(q.inbox, val)
}

func (q *StackQueue) Dequeue() int {
	// BUG: always transfers, even when outbox is not empty
	for len(q.inbox) > 0 {
		top := q.inbox[len(q.inbox)-1]
		q.inbox = q.inbox[:len(q.inbox)-1]
		q.outbox = append(q.outbox, top)
	}
	val := q.outbox[len(q.outbox)-1]
	q.outbox = q.outbox[:len(q.outbox)-1]
	return val
}
```

### What Goes Wrong

The transfer happens every time `Dequeue` is called, not just when the outbox is empty. If the outbox has elements `[3, 2, 1]` (top=1) and the inbox has `[4, 5]`, the transfer pushes 5 then 4 onto the outbox, making it `[3, 2, 1, 5, 4]`. Now dequeue returns 4 instead of 1. The FIFO order is broken.

### Fixed Code

```go
func (q *StackQueue) Dequeue() int {
	if len(q.outbox) == 0 {  // only transfer when outbox is empty
		for len(q.inbox) > 0 {
			top := q.inbox[len(q.inbox)-1]
			q.inbox = q.inbox[:len(q.inbox)-1]
			q.outbox = append(q.outbox, top)
		}
	}
	val := q.outbox[len(q.outbox)-1]
	q.outbox = q.outbox[:len(q.outbox)-1]
	return val
}
```

---

## Bug 11: Producer-Consumer Deadlock (Java)

### Buggy Code

```java
import java.util.concurrent.*;

public class ProducerConsumer {
    public static void main(String[] args) throws InterruptedException {
        BlockingQueue<Integer> queue = new ArrayBlockingQueue<>(5);

        Thread producer = new Thread(() -> {
            for (int i = 0; i < 10; i++) {
                try {
                    queue.put(i);  // blocks if full
                } catch (InterruptedException e) { return; }
            }
            // BUG: no signal to consumer that production is done
        });

        Thread consumer = new Thread(() -> {
            while (true) {
                try {
                    int val = queue.take();  // blocks forever after producer is done
                    System.out.println("Got: " + val);
                } catch (InterruptedException e) { return; }
            }
        });

        producer.start();
        consumer.start();
        producer.join();
        consumer.join();  // BUG: hangs forever -- consumer never exits
    }
}
```

### What Goes Wrong

The producer finishes after sending 10 items, but the consumer has no way to know. It calls `queue.take()` which blocks indefinitely waiting for the next item. The program never terminates.

### Fixed Code

```java
Thread producer = new Thread(() -> {
    try {
        for (int i = 0; i < 10; i++) {
            queue.put(i);
        }
        queue.put(-1);  // sentinel value signals end
    } catch (InterruptedException e) { return; }
});

Thread consumer = new Thread(() -> {
    try {
        while (true) {
            int val = queue.take();
            if (val == -1) break;  // received termination signal
            System.out.println("Got: " + val);
        }
    } catch (InterruptedException e) { return; }
});
```

---

## Bug 12: Queue Size Not Updated (Python)

### Buggy Code

```python
class Queue:
    def __init__(self):
        self._data = []
        self._size = 0

    def enqueue(self, val):
        self._data.append(val)
        self._size += 1

    def dequeue(self):
        if self.is_empty():
            raise IndexError("empty")
        val = self._data.pop(0)
        # BUG: forgot to decrement self._size
        return val

    def is_empty(self):
        return self._size == 0

    def size(self):
        return self._size

q = Queue()
q.enqueue(1)
q.enqueue(2)
q.dequeue()
print(q.size())     # Expected: 1, Got: 2
print(q.is_empty()) # Expected: False, Got: False (correct by accident)
q.dequeue()
print(q.size())     # Expected: 0, Got: 2
print(q.is_empty()) # Expected: True, Got: False -- BUG!
```

### What Goes Wrong

The `dequeue` method removes an element from `_data` but never decrements `_size`. The `_size` counter becomes incorrect after the first dequeue. Later, `is_empty()` returns `False` even when the queue is truly empty, and further dequeues raise `IndexError` (from `pop(0)` on an empty list, bypassing the `is_empty` guard next time -- actually it would not bypass since `_size` is still 2).

Actually after 2 dequeues, `_data` is empty but `_size` is 2. A third `dequeue` call: `is_empty()` returns `False` (since `_size == 2`), then `_data.pop(0)` raises `IndexError` -- unexpected crash.

### Fixed Code

```python
def dequeue(self):
    if self.is_empty():
        raise IndexError("empty")
    val = self._data.pop(0)
    self._size -= 1  # decrement size
    return val
```

---

## Bug 13: Monotonic Queue Off-by-One (Go)

### Buggy Code

```go
func maxSlidingWindow(nums []int, k int) []int {
	deque := []int{}
	result := []int{}

	for i := 0; i < len(nums); i++ {
		// Remove out-of-window indices
		if len(deque) > 0 && deque[0] < i-k {  // BUG: should be <= i-k
			deque = deque[1:]
		}
		for len(deque) > 0 && nums[deque[len(deque)-1]] <= nums[i] {
			deque = deque[:len(deque)-1]
		}
		deque = append(deque, i)

		if i >= k-1 {
			result = append(result, nums[deque[0]])
		}
	}
	return result
}
```

### What Goes Wrong

The condition `deque[0] < i-k` should be `deque[0] <= i-k`. When `deque[0] == i-k`, the index is exactly one position outside the window (the window covers indices `[i-k+1, i]`). Using `<` instead of `<=` keeps an out-of-window element, causing incorrect maximum values.

For example, with `k=3` and `i=3`, the window is `[1, 2, 3]`. Index 0 (`i-k = 0`) is outside the window. With `<`, index 0 is not removed (since `0 < 0` is false).

### Fixed Code

```go
if len(deque) > 0 && deque[0] <= i-k {
	deque = deque[1:]
}
```
