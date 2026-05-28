# Queue -- Optimization Exercises

Each exercise starts with a correct but slow implementation. Your goal is to optimize it for better time complexity, space complexity, or practical performance.

## Table of Contents

- [Exercise 1: Queue Dequeue -- O(n) to O(1)](#exercise-1-queue-dequeue-on-to-o1)
- [Exercise 2: Sliding Window Maximum -- O(n*k) to O(n)](#exercise-2-sliding-window-maximum-onk-to-on)
- [Exercise 3: BFS Shortest Path -- Reduce Queue Size](#exercise-3-bfs-shortest-path-reduce-queue-size)
- [Exercise 4: Moving Average -- O(n) to O(1) per Query](#exercise-4-moving-average-on-to-o1-per-query)
- [Exercise 5: Task Scheduler -- O(n*m) to O(n)](#exercise-5-task-scheduler-onm-to-on)
- [Exercise 6: First Non-Repeating -- O(n^2) to O(n)](#exercise-6-first-non-repeating-on2-to-on)
- [Exercise 7: Priority Queue -- O(n) Extract to O(log n)](#exercise-7-priority-queue-on-extract-to-olog-n)
- [Exercise 8: Queue Memory Leak -- Fix Unbounded Growth](#exercise-8-queue-memory-leak-fix-unbounded-growth)
- [Exercise 9: Multi-Queue Merge -- O(n*k) to O(n*log k)](#exercise-9-multi-queue-merge-onk-to-onlog-k)
- [Exercise 10: Rate Limiter -- O(n) Cleanup to O(1) Amortized](#exercise-10-rate-limiter-on-cleanup-to-o1-amortized)
- [Exercise 11: BFS on Matrix -- Reduce Allocations](#exercise-11-bfs-on-matrix-reduce-allocations)
- [Exercise 12: Circular Buffer -- Branching to Branchless](#exercise-12-circular-buffer-branching-to-branchless)

---

## Exercise 1: Queue Dequeue -- O(n) to O(1)

### Slow Version

```go
// O(n) dequeue: shifting all elements left
type SlowQueue struct {
	data []int
}

func (q *SlowQueue) Enqueue(val int) {
	q.data = append(q.data, val)
}

func (q *SlowQueue) Dequeue() int {
	val := q.data[0]
	// O(n): copy all elements one position left
	copy(q.data, q.data[1:])
	q.data = q.data[:len(q.data)-1]
	return val
}
```

### Optimized Version

```go
// O(1) amortized dequeue using a circular buffer
type FastQueue struct {
	data          []int
	front, size   int
	capacity      int
}

func NewFastQueue(cap int) *FastQueue {
	return &FastQueue{data: make([]int, cap), capacity: cap}
}

func (q *FastQueue) Enqueue(val int) {
	if q.size == q.capacity {
		q.resize(q.capacity * 2)
	}
	rear := (q.front + q.size) % q.capacity
	q.data[rear] = val
	q.size++
}

func (q *FastQueue) Dequeue() int {
	val := q.data[q.front]
	q.front = (q.front + 1) % q.capacity
	q.size--
	return val
}

func (q *FastQueue) resize(newCap int) {
	newData := make([]int, newCap)
	for i := 0; i < q.size; i++ {
		newData[i] = q.data[(q.front+i)%q.capacity]
	}
	q.data = newData
	q.front = 0
	q.capacity = newCap
}
```

**Why it is faster:** The circular buffer avoids shifting elements. Dequeue simply advances the front pointer with modulo arithmetic. No memory copies needed.

---

## Exercise 2: Sliding Window Maximum -- O(n*k) to O(n)

### Slow Version

```java
// O(n*k): scan each window for maximum
public static int[] maxSlidingWindow(int[] nums, int k) {
    int[] result = new int[nums.length - k + 1];
    for (int i = 0; i <= nums.length - k; i++) {
        int max = nums[i];
        for (int j = i + 1; j < i + k; j++) {
            max = Math.max(max, nums[j]);
        }
        result[i] = max;
    }
    return result;
}
```

### Optimized Version

```java
// O(n): monotonic deque -- each element is added/removed at most once
public static int[] maxSlidingWindow(int[] nums, int k) {
    Deque<Integer> dq = new ArrayDeque<>();  // stores indices
    int[] result = new int[nums.length - k + 1];
    int idx = 0;

    for (int i = 0; i < nums.length; i++) {
        if (!dq.isEmpty() && dq.peekFirst() <= i - k) {
            dq.pollFirst();
        }
        while (!dq.isEmpty() && nums[dq.peekLast()] <= nums[i]) {
            dq.pollLast();
        }
        dq.offerLast(i);
        if (i >= k - 1) {
            result[idx++] = nums[dq.peekFirst()];
        }
    }
    return result;
}
```

**Why it is faster:** Each element enters and leaves the deque at most once, giving O(n) total instead of O(n*k). The deque maintains a decreasing order so the front is always the current maximum.

---

## Exercise 3: BFS Shortest Path -- Reduce Queue Size

### Slow Version

```python
from collections import deque

def shortest_path(grid, start, end):
    """BFS on grid -- marks visited at dequeue time."""
    rows, cols = len(grid), len(grid[0])
    queue = deque([(start[0], start[1], 0)])  # (row, col, dist)
    visited = set()

    while queue:
        r, c, dist = queue.popleft()
        if (r, c) in visited:
            continue
        visited.add((r, c))
        if (r, c) == end:
            return dist
        for dr, dc in [(0,1),(0,-1),(1,0),(-1,0)]:
            nr, nc = r+dr, c+dc
            if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] == 0:
                queue.append((nr, nc, dist+1))
    return -1
```

### Optimized Version

```python
from collections import deque

def shortest_path(grid, start, end):
    """BFS on grid -- marks visited at enqueue time."""
    rows, cols = len(grid), len(grid[0])
    queue = deque([(start[0], start[1], 0)])
    visited = {(start[0], start[1])}  # mark visited immediately

    while queue:
        r, c, dist = queue.popleft()
        if (r, c) == end:
            return dist
        for dr, dc in [(0,1),(0,-1),(1,0),(-1,0)]:
            nr, nc = r+dr, c+dc
            if (0 <= nr < rows and 0 <= nc < cols
                    and grid[nr][nc] == 0 and (nr, nc) not in visited):
                visited.add((nr, nc))  # mark before enqueue
                queue.append((nr, nc, dist+1))
    return -1
```

**Why it is faster:** Marking visited at enqueue time prevents the same cell from being enqueued by multiple neighbors. The queue stays at most O(perimeter) instead of O(edges), reducing both memory and time.

---

## Exercise 4: Moving Average -- O(n) to O(1) per Query

### Slow Version

```go
// O(n) per query: recompute sum from scratch
type MovingAverage struct {
	window []float64
	size   int
}

func (ma *MovingAverage) Next(val float64) float64 {
	ma.window = append(ma.window, val)
	if len(ma.window) > ma.size {
		ma.window = ma.window[1:]
	}
	sum := 0.0
	for _, v := range ma.window {
		sum += v
	}
	return sum / float64(len(ma.window))
}
```

### Optimized Version

```go
// O(1) per query: maintain running sum with circular buffer
type MovingAverage struct {
	data  []float64
	size  int
	count int
	idx   int
	sum   float64
}

func NewMovingAverage(size int) *MovingAverage {
	return &MovingAverage{data: make([]float64, size), size: size}
}

func (ma *MovingAverage) Next(val float64) float64 {
	if ma.count >= ma.size {
		ma.sum -= ma.data[ma.idx] // subtract outgoing value
	}
	ma.data[ma.idx] = val
	ma.sum += val
	ma.idx = (ma.idx + 1) % ma.size
	if ma.count < ma.size {
		ma.count++
	}
	return ma.sum / float64(ma.count)
}
```

**Why it is faster:** Instead of summing the entire window each time, we maintain a running sum. When a new value enters, we subtract the oldest value (about to be overwritten in the circular buffer) and add the new value. O(1) per query.

---

## Exercise 5: Task Scheduler -- O(n*m) to O(n)

### Slow Version

```java
// O(n * m): simulate each time slot
public int leastInterval(char[] tasks, int n) {
    Map<Character, Integer> freq = new HashMap<>();
    for (char t : tasks) freq.merge(t, 1, Integer::sum);

    int time = 0;
    while (!freq.isEmpty()) {
        List<Map.Entry<Character, Integer>> sorted = new ArrayList<>(freq.entrySet());
        sorted.sort((a, b) -> b.getValue() - a.getValue());

        int cycle = n + 1;
        int executed = 0;
        for (var entry : sorted) {
            if (cycle <= 0) break;
            entry.setValue(entry.getValue() - 1);
            if (entry.getValue() == 0) freq.remove(entry.getKey());
            executed++;
            cycle--;
        }
        time += freq.isEmpty() ? executed : n + 1;
    }
    return time;
}
```

### Optimized Version

```java
// O(n): math formula based on max frequency
public int leastInterval(char[] tasks, int n) {
    int[] freq = new int[26];
    for (char t : tasks) freq[t - 'A']++;
    int maxFreq = 0, maxCount = 0;
    for (int f : freq) {
        if (f > maxFreq) { maxFreq = f; maxCount = 1; }
        else if (f == maxFreq) maxCount++;
    }
    int intervals = (maxFreq - 1) * (n + 1) + maxCount;
    return Math.max(intervals, tasks.length);
}
```

**Why it is faster:** Instead of simulating each time slot, we use a formula. The minimum time is determined by the most frequent task and the cooldown period. One pass to count frequencies, then O(1) computation.

---

## Exercise 6: First Non-Repeating -- O(n^2) to O(n)

### Slow Version

```python
# O(n^2): for each position, scan all previous characters
def first_non_repeating(stream):
    result = []
    for i in range(len(stream)):
        found = '#'
        for j in range(i + 1):
            count = stream[:i+1].count(stream[j])
            if count == 1:
                found = stream[j]
                break
        result.append(found)
    return result
```

### Optimized Version

```python
from collections import deque

def first_non_repeating(stream):
    freq = {}
    queue = deque()  # candidates for non-repeating
    result = []

    for ch in stream:
        freq[ch] = freq.get(ch, 0) + 1
        queue.append(ch)
        # Remove characters that are now repeating
        while queue and freq[queue[0]] > 1:
            queue.popleft()
        result.append(queue[0] if queue else '#')

    return result
```

**Why it is faster:** The queue tracks non-repeating candidates. Each character enters and leaves the queue at most once, giving O(n) total. The frequency map provides O(1) lookups.

---

## Exercise 7: Priority Queue -- O(n) Extract to O(log n)

### Slow Version

```go
// O(n) extract: linear scan for minimum
type SlowPQ struct {
	data []int
}

func (pq *SlowPQ) Insert(val int) {
	pq.data = append(pq.data, val) // O(1)
}

func (pq *SlowPQ) ExtractMin() int {
	minIdx := 0
	for i := 1; i < len(pq.data); i++ {
		if pq.data[i] < pq.data[minIdx] {
			minIdx = i
		}
	}
	min := pq.data[minIdx]
	pq.data[minIdx] = pq.data[len(pq.data)-1]
	pq.data = pq.data[:len(pq.data)-1]
	return min
}
```

### Optimized Version

```go
// O(log n) extract: binary heap
type MinHeap struct {
	data []int
}

func (h *MinHeap) Insert(val int) {
	h.data = append(h.data, val)
	i := len(h.data) - 1
	for i > 0 {
		parent := (i - 1) / 2
		if h.data[parent] <= h.data[i] { break }
		h.data[parent], h.data[i] = h.data[i], h.data[parent]
		i = parent
	}
}

func (h *MinHeap) ExtractMin() int {
	min := h.data[0]
	h.data[0] = h.data[len(h.data)-1]
	h.data = h.data[:len(h.data)-1]
	i, n := 0, len(h.data)
	for {
		smallest, left, right := i, 2*i+1, 2*i+2
		if left < n && h.data[left] < h.data[smallest] { smallest = left }
		if right < n && h.data[right] < h.data[smallest] { smallest = right }
		if smallest == i { break }
		h.data[i], h.data[smallest] = h.data[smallest], h.data[i]
		i = smallest
	}
	return min
}
```

**Why it is faster:** A binary heap maintains the min at the root. Insert sifts up in O(log n). Extract replaces the root with the last element and sifts down in O(log n). Both are much faster than O(n) linear scan.

---

## Exercise 8: Queue Memory Leak -- Fix Unbounded Growth

### Slow Version (Memory Leak)

```java
// Memory leak: dequeued elements are never freed
public class LeakyQueue {
    private Object[] data = new Object[16];
    private int front = 0, rear = 0;

    public void enqueue(Object val) {
        if (rear == data.length) {
            data = Arrays.copyOf(data, data.length * 2);
        }
        data[rear++] = val;
    }

    public Object dequeue() {
        return data[front++];  // old reference stays in array!
    }
}
```

### Optimized Version

```java
// Fixed: null out dequeued slots + use circular buffer
public class FixedQueue {
    private Object[] data;
    private int front = 0, size = 0, capacity;

    public FixedQueue(int cap) {
        this.capacity = cap;
        this.data = new Object[cap];
    }

    public void enqueue(Object val) {
        if (size == capacity) resize(capacity * 2);
        data[(front + size) % capacity] = val;
        size++;
    }

    public Object dequeue() {
        Object val = data[front];
        data[front] = null;  // null out for GC
        front = (front + 1) % capacity;
        size--;
        return val;
    }

    private void resize(int newCap) {
        Object[] newData = new Object[newCap];
        for (int i = 0; i < size; i++)
            newData[i] = data[(front + i) % capacity];
        data = newData;
        front = 0;
        capacity = newCap;
    }
}
```

**Why it is better:** The leaky version never reuses slots at the front and never nulls out references. The array grows unboundedly even if only a few elements exist. The fixed version uses a circular buffer (constant memory for fixed throughput) and nulls out dequeued slots so the GC can reclaim objects.

---

## Exercise 9: Multi-Queue Merge -- O(n*k) to O(n*log k)

### Slow Version

```python
# O(n*k): find minimum across k queues each time
def merge_k_queues(queues):
    result = []
    while any(queues):
        min_val = float('inf')
        min_idx = -1
        for i, q in enumerate(queues):
            if q and q[0] < min_val:
                min_val = q[0]
                min_idx = i
        result.append(queues[min_idx].popleft())
    return result
```

### Optimized Version

```python
import heapq
from collections import deque

def merge_k_queues(queues):
    # O(n * log k): use a min-heap to track the smallest front
    heap = []
    for i, q in enumerate(queues):
        if q:
            heapq.heappush(heap, (q[0], i))

    result = []
    while heap:
        val, idx = heapq.heappop(heap)
        queues[idx].popleft()
        result.append(val)
        if queues[idx]:
            heapq.heappush(heap, (queues[idx][0], idx))

    return result
```

**Why it is faster:** Instead of scanning all k queues to find the minimum (O(k) per extraction), we use a min-heap of size k. Each extraction and insertion takes O(log k). Total: O(n * log k) instead of O(n * k).

---

## Exercise 10: Rate Limiter -- O(n) Cleanup to O(1) Amortized

### Slow Version

```go
// O(n) per check: stores all timestamps, cleans up linearly
type SlowLimiter struct {
	timestamps []int64
	window     int64 // window in milliseconds
	limit      int
}

func (l *SlowLimiter) Allow(now int64) bool {
	// Remove old timestamps -- O(n) scan
	newTs := []int64{}
	for _, ts := range l.timestamps {
		if now-ts < l.window {
			newTs = append(newTs, ts)
		}
	}
	l.timestamps = newTs

	if len(l.timestamps) < l.limit {
		l.timestamps = append(l.timestamps, now)
		return true
	}
	return false
}
```

### Optimized Version

```go
// O(1) amortized: use a circular buffer, timestamps are naturally ordered
type FastLimiter struct {
	timestamps []int64
	capacity   int
	idx        int
	count      int
	window     int64
}

func NewFastLimiter(limit int, window int64) *FastLimiter {
	return &FastLimiter{
		timestamps: make([]int64, limit),
		capacity:   limit,
		window:     window,
	}
}

func (l *FastLimiter) Allow(now int64) bool {
	if l.count < l.capacity {
		l.timestamps[l.idx] = now
		l.idx = (l.idx + 1) % l.capacity
		l.count++
		return true
	}
	// Check oldest timestamp (it is at current idx in circular buffer)
	oldest := l.timestamps[l.idx]
	if now-oldest >= l.window {
		l.timestamps[l.idx] = now
		l.idx = (l.idx + 1) % l.capacity
		return true
	}
	return false
}
```

**Why it is faster:** The slow version scans and rebuilds the timestamp list every call. The optimized version uses a circular buffer of size `limit`. Since timestamps are added in order, the oldest is always at the current write position. One comparison determines whether to allow -- O(1).

---

## Exercise 11: BFS on Matrix -- Reduce Allocations

### Slow Version

```java
// High allocation: creates a new int[] for each cell in the queue
public int bfsDistance(int[][] grid, int[] start, int[] end) {
    int rows = grid.length, cols = grid[0].length;
    boolean[][] visited = new boolean[rows][cols];
    Queue<int[]> queue = new LinkedList<>();
    queue.offer(new int[]{start[0], start[1], 0});  // each enqueue allocates
    visited[start[0]][start[1]] = true;

    while (!queue.isEmpty()) {
        int[] cell = queue.poll();
        if (cell[0] == end[0] && cell[1] == end[1]) return cell[2];
        for (int[] d : new int[][]{{0,1},{0,-1},{1,0},{-1,0}}) {
            int nr = cell[0]+d[0], nc = cell[1]+d[1];
            if (nr>=0 && nr<rows && nc>=0 && nc<cols && !visited[nr][nc] && grid[nr][nc]==0) {
                visited[nr][nc] = true;
                queue.offer(new int[]{nr, nc, cell[2]+1});
            }
        }
    }
    return -1;
}
```

### Optimized Version

```java
// Low allocation: use a distance matrix instead of storing distance in queue
public int bfsDistance(int[][] grid, int[] start, int[] end) {
    int rows = grid.length, cols = grid[0].length;
    int[][] dist = new int[rows][cols];
    for (int[] row : dist) Arrays.fill(row, -1);
    dist[start[0]][start[1]] = 0;

    // Encode (r, c) as single int to avoid array allocation
    ArrayDeque<Integer> queue = new ArrayDeque<>();
    queue.offer(start[0] * cols + start[1]);

    int[][] dirs = {{0,1},{0,-1},{1,0},{-1,0}};
    while (!queue.isEmpty()) {
        int encoded = queue.poll();
        int r = encoded / cols, c = encoded % cols;
        if (r == end[0] && c == end[1]) return dist[r][c];
        for (int[] d : dirs) {
            int nr = r+d[0], nc = c+d[1];
            if (nr>=0 && nr<rows && nc>=0 && nc<cols && dist[nr][nc]==-1 && grid[nr][nc]==0) {
                dist[nr][nc] = dist[r][c] + 1;
                queue.offer(nr * cols + nc);
            }
        }
    }
    return -1;
}
```

**Why it is faster:** (1) Distances are stored in a matrix, not per-queue-entry. (2) Cell coordinates are encoded as a single integer (`row * cols + col`), eliminating per-cell array allocation. (3) `ArrayDeque` is used instead of `LinkedList` for better cache locality. These changes reduce GC pressure significantly.

---

## Exercise 12: Circular Buffer -- Branching to Branchless

### Slow Version

```python
class CircularBuffer:
    def __init__(self, capacity):
        self._data = [0] * capacity
        self._head = 0
        self._cap = capacity

    def advance(self):
        # Branch: if-else for wraparound
        if self._head == self._cap - 1:
            self._head = 0
        else:
            self._head += 1
```

### Optimized Version

```python
class CircularBuffer:
    def __init__(self, capacity):
        self._data = [0] * capacity
        self._head = 0
        self._cap = capacity
        # Ensure capacity is power of 2 for bitmask
        assert capacity & (capacity - 1) == 0, "capacity must be power of 2"
        self._mask = capacity - 1

    def advance(self):
        # Branchless: bitmask instead of modulo or if-else
        self._head = (self._head + 1) & self._mask
```

**Why it is faster:** When the capacity is a power of 2, the modulo operation `% capacity` can be replaced with a bitwise AND `& (capacity - 1)`. This is branchless (no if-else, no division) and executes in a single CPU cycle. For tight loops processing millions of items (audio buffers, network packets), this makes a measurable difference.

**Note:** The modulo version `(head + 1) % cap` also works and is branchless on modern CPUs, but the bitmask is still faster because integer division (which modulo uses internally) is more expensive than bitwise AND.
