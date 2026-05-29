# Deque — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python** (in that order).
> Time complexity and space complexity must be stated in your solution.

---

## Beginner Tasks

### Task 1 — Reverse a string using a deque

Given a string, return its reverse. Use a deque (push every char to the back, then pop from the back into a result). Do not use `reverse()` builtins.

#### Go

```go
package main

import "fmt"

func reverseString(s string) string {
    runes := []rune(s)
    // Use the slice as a deque with two indices.
    i, j := 0, len(runes)-1
    for i < j {
        runes[i], runes[j] = runes[j], runes[i]
        i++
        j--
    }
    return string(runes)
}

func main() {
    fmt.Println(reverseString("deque")) // "euqed"
}
```

#### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;

public class Task1 {
    public static String reverseString(String s) {
        Deque<Character> dq = new ArrayDeque<>();
        for (char c : s.toCharArray()) dq.offerLast(c);
        StringBuilder sb = new StringBuilder(s.length());
        while (!dq.isEmpty()) sb.append(dq.pollLast());
        return sb.toString();
    }
    public static void main(String[] args) {
        System.out.println(reverseString("deque")); // "euqed"
    }
}
```

#### Python

```python
from collections import deque

def reverse_string(s: str) -> str:
    dq: deque[str] = deque(s)
    return "".join(dq.pop() for _ in range(len(dq)))

if __name__ == "__main__":
    print(reverse_string("deque"))  # "euqed"
```

**Complexity:** O(n) time, O(n) space.

---

### Task 2 — Check if a string is a palindrome

Use a deque. Push each character to the back. Then compare popFront with popBack until the deque has at most one element. Ignore case and non-alphanumeric characters.

#### Go

```go
package main

import (
    "fmt"
    "unicode"
)

func isPalindrome(s string) bool {
    runes := []rune{}
    for _, r := range s {
        if unicode.IsLetter(r) || unicode.IsDigit(r) {
            runes = append(runes, unicode.ToLower(r))
        }
    }
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

func main() {
    fmt.Println(isPalindrome("A man, a plan, a canal: Panama")) // true
}
```

#### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;

public class Task2 {
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
    public static void main(String[] args) {
        System.out.println(isPalindrome("A man, a plan, a canal: Panama")); // true
    }
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

if __name__ == "__main__":
    print(is_palindrome("A man, a plan, a canal: Panama"))  # True
```

**Complexity:** O(n) time, O(n) space.

---

### Task 3 — Recent N visited URLs

Implement a class that remembers the last N URLs a user visited. When adding the (N+1)-th URL, the oldest is dropped. Use a deque with maxlen semantics.

#### Go

```go
package main

import "fmt"

type RecentURLs struct {
    buf   []string
    head  int
    size  int
    cap   int
}

func NewRecentURLs(n int) *RecentURLs {
    return &RecentURLs{buf: make([]string, n), cap: n}
}

func (r *RecentURLs) Visit(url string) {
    if r.size < r.cap {
        r.buf[(r.head+r.size)%r.cap] = url
        r.size++
        return
    }
    // Full: overwrite oldest (at head) and advance.
    r.buf[r.head] = url
    r.head = (r.head + 1) % r.cap
}

func (r *RecentURLs) List() []string {
    out := make([]string, r.size)
    for i := 0; i < r.size; i++ {
        out[i] = r.buf[(r.head+i)%r.cap]
    }
    return out
}

func main() {
    r := NewRecentURLs(3)
    for _, u := range []string{"a.com", "b.com", "c.com", "d.com"} {
        r.Visit(u)
    }
    fmt.Println(r.List()) // [b.com c.com d.com]
}
```

#### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.ArrayList;

public class RecentURLs {
    private final Deque<String> dq = new ArrayDeque<>();
    private final int cap;

    public RecentURLs(int cap) { this.cap = cap; }

    public void visit(String url) {
        if (dq.size() == cap) dq.pollFirst();
        dq.offerLast(url);
    }

    public List<String> list() {
        return new ArrayList<>(dq);
    }

    public static void main(String[] args) {
        RecentURLs r = new RecentURLs(3);
        for (String u : List.of("a.com", "b.com", "c.com", "d.com")) r.visit(u);
        System.out.println(r.list()); // [b.com, c.com, d.com]
    }
}
```

#### Python

```python
from collections import deque

class RecentURLs:
    def __init__(self, n: int):
        self._dq: deque[str] = deque(maxlen=n)
    def visit(self, url: str) -> None:
        self._dq.append(url)
    def list(self) -> list[str]:
        return list(self._dq)

if __name__ == "__main__":
    r = RecentURLs(3)
    for u in ["a.com", "b.com", "c.com", "d.com"]:
        r.visit(u)
    print(r.list())  # ['b.com', 'c.com', 'd.com']
```

**Complexity:** O(1) per visit, O(N) for list snapshot. Space O(N).

---

### Task 4 — Stack and queue both backed by one deque

Write a class that supports both `push`/`pop` (stack semantics — same end) and `enqueue`/`dequeue` (queue semantics — opposite ends), all using a single deque. Demonstrate that order of operations matters.

#### Go

```go
package main

import (
    "container/list"
    "fmt"
)

type Hybrid struct {
    dq *list.List
}

func NewHybrid() *Hybrid { return &Hybrid{dq: list.New()} }

func (h *Hybrid) Push(x int)     { h.dq.PushBack(x) }
func (h *Hybrid) Pop() int       { return h.dq.Remove(h.dq.Back()).(int) }
func (h *Hybrid) Enqueue(x int)  { h.dq.PushBack(x) }
func (h *Hybrid) Dequeue() int   { return h.dq.Remove(h.dq.Front()).(int) }

func main() {
    h := NewHybrid()
    h.Push(1); h.Push(2); h.Push(3)
    fmt.Println(h.Pop())     // 3 (stack)
    fmt.Println(h.Dequeue()) // 1 (queue)
}
```

#### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;

public class Hybrid {
    private final Deque<Integer> dq = new ArrayDeque<>();
    public void push(int x)    { dq.offerLast(x); }
    public int pop()           { return dq.pollLast(); }
    public void enqueue(int x) { dq.offerLast(x); }
    public int dequeue()       { return dq.pollFirst(); }

    public static void main(String[] args) {
        Hybrid h = new Hybrid();
        h.push(1); h.push(2); h.push(3);
        System.out.println(h.pop());     // 3
        System.out.println(h.dequeue()); // 1
    }
}
```

#### Python

```python
from collections import deque

class Hybrid:
    def __init__(self):
        self._dq: deque[int] = deque()
    def push(self, x):    self._dq.append(x)
    def pop(self):        return self._dq.pop()
    def enqueue(self, x): self._dq.append(x)
    def dequeue(self):    return self._dq.popleft()

if __name__ == "__main__":
    h = Hybrid()
    for x in [1, 2, 3]: h.push(x)
    print(h.pop())      # 3
    print(h.dequeue())  # 1
```

**Complexity:** O(1) per operation. Lesson: mixing semantics on the same instance is legal but rarely useful — choose one role.

---

### Task 5 — Find first non-repeating character in a stream

Given a stream of characters, after each new character print the first non-repeating character so far (or `_` if none exist). Use a deque to track candidates and a counter map.

#### Go

```go
package main

import "fmt"

func firstNonRepeating(stream string) []byte {
    count := [128]int{}
    var dq []byte
    result := make([]byte, 0, len(stream))
    for i := 0; i < len(stream); i++ {
        c := stream[i]
        count[c]++
        dq = append(dq, c)
        for len(dq) > 0 && count[dq[0]] > 1 {
            dq = dq[1:]
        }
        if len(dq) == 0 {
            result = append(result, '_')
        } else {
            result = append(result, dq[0])
        }
    }
    return result
}

func main() {
    fmt.Println(string(firstNonRepeating("aabc"))) // "a_bb"  (actually "a_bb" -> a then _ then b then b)
}
```

#### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;

public class Task5 {
    public static String firstNonRepeating(String stream) {
        int[] count = new int[128];
        Deque<Character> dq = new ArrayDeque<>();
        StringBuilder sb = new StringBuilder();
        for (char c : stream.toCharArray()) {
            count[c]++;
            dq.offerLast(c);
            while (!dq.isEmpty() && count[dq.peekFirst()] > 1) {
                dq.pollFirst();
            }
            sb.append(dq.isEmpty() ? '_' : dq.peekFirst());
        }
        return sb.toString();
    }
    public static void main(String[] args) {
        System.out.println(firstNonRepeating("aabc")); // "a_bb"
    }
}
```

#### Python

```python
from collections import deque

def first_non_repeating(stream: str) -> str:
    count = {}
    dq: deque[str] = deque()
    out: list[str] = []
    for c in stream:
        count[c] = count.get(c, 0) + 1
        dq.append(c)
        while dq and count[dq[0]] > 1:
            dq.popleft()
        out.append(dq[0] if dq else "_")
    return "".join(out)

if __name__ == "__main__":
    print(first_non_repeating("aabc"))  # "a_bb"
```

**Complexity:** O(n) total time (each char enters and leaves the deque at most once). O(n) space.

---

## Intermediate Tasks

### Task 6 — Sliding window first negative number

Given an array of integers and a window size K, for each window print the first negative number, or 0 if none.

**Approach.** Deque of indices of negatives. On a new window, pop expired indices from the front; before extending, push back indices of negative elements.

#### Go

```go
package main

import "fmt"

func firstNegativeInWindow(arr []int, k int) []int {
    var dq []int
    result := []int{}
    for i, v := range arr {
        if v < 0 {
            dq = append(dq, i)
        }
        // Expire indices outside window.
        for len(dq) > 0 && dq[0] <= i-k {
            dq = dq[1:]
        }
        if i >= k-1 {
            if len(dq) > 0 {
                result = append(result, arr[dq[0]])
            } else {
                result = append(result, 0)
            }
        }
    }
    return result
}

func main() {
    fmt.Println(firstNegativeInWindow([]int{12, -1, -7, 8, -15, 30, 16, 28}, 3))
    // [-1 -1 -7 -15 -15 0]
}
```

#### Java

```java
import java.util.ArrayDeque;
import java.util.Deque;

public class Task6 {
    public static int[] firstNegativeInWindow(int[] arr, int k) {
        Deque<Integer> dq = new ArrayDeque<>();
        int[] result = new int[arr.length - k + 1];
        int r = 0;
        for (int i = 0; i < arr.length; i++) {
            if (arr[i] < 0) dq.offerLast(i);
            while (!dq.isEmpty() && dq.peekFirst() <= i - k) dq.pollFirst();
            if (i >= k - 1) {
                result[r++] = dq.isEmpty() ? 0 : arr[dq.peekFirst()];
            }
        }
        return result;
    }
}
```

#### Python

```python
from collections import deque

def first_negative_in_window(arr: list[int], k: int) -> list[int]:
    dq: deque[int] = deque()
    out: list[int] = []
    for i, v in enumerate(arr):
        if v < 0:
            dq.append(i)
        while dq and dq[0] <= i - k:
            dq.popleft()
        if i >= k - 1:
            out.append(arr[dq[0]] if dq else 0)
    return out
```

**Complexity:** O(n) time, O(k) space.

---

### Task 7 — Bounded MRU cache (no LRU)

Build an MRU (Most-Recently-Used) cache: on get-or-insert, if the key is present and you would push out, the most-recently-used entry is evicted. Use a deque to track usage order.

#### Go

```go
package main

import "fmt"

type MRU struct {
    cap   int
    order []string         // back = most-recent
    data  map[string]int
}

func NewMRU(cap int) *MRU {
    return &MRU{cap: cap, data: map[string]int{}}
}

func (m *MRU) Put(key string, val int) {
    if _, ok := m.data[key]; ok {
        m.data[key] = val
        m.touch(key)
        return
    }
    if len(m.order) == m.cap {
        // Evict MOST recent (back).
        evict := m.order[len(m.order)-1]
        m.order = m.order[:len(m.order)-1]
        delete(m.data, evict)
    }
    m.data[key] = val
    m.order = append(m.order, key)
}

func (m *MRU) touch(key string) {
    for i, k := range m.order {
        if k == key {
            m.order = append(m.order[:i], m.order[i+1:]...)
            break
        }
    }
    m.order = append(m.order, key)
}

func main() {
    c := NewMRU(2)
    c.Put("a", 1)
    c.Put("b", 2)
    c.Put("c", 3) // evicts "b" (most recent), keeps "a"
    fmt.Println(c.data) // map[a:1 c:3]
}
```

#### Java

```java
import java.util.*;

public class MRU {
    private final int cap;
    private final Deque<String> order = new ArrayDeque<>();
    private final Map<String, Integer> data = new HashMap<>();

    public MRU(int cap) { this.cap = cap; }

    public void put(String key, int val) {
        if (data.containsKey(key)) {
            order.remove(key);
            order.offerLast(key);
            data.put(key, val);
            return;
        }
        if (order.size() == cap) {
            String evict = order.pollLast();
            data.remove(evict);
        }
        order.offerLast(key);
        data.put(key, val);
    }

    public Integer get(String key) {
        if (!data.containsKey(key)) return null;
        order.remove(key);
        order.offerLast(key);
        return data.get(key);
    }
}
```

#### Python

```python
from collections import deque

class MRU:
    def __init__(self, cap: int):
        self._cap = cap
        self._order: deque[str] = deque()  # rightmost = MRU
        self._data: dict[str, int] = {}

    def put(self, key: str, val: int) -> None:
        if key in self._data:
            self._order.remove(key)
            self._order.append(key)
            self._data[key] = val
            return
        if len(self._order) == self._cap:
            evict = self._order.pop()  # MRU
            del self._data[evict]
        self._order.append(key)
        self._data[key] = val

    def get(self, key: str):
        if key not in self._data:
            return None
        self._order.remove(key)
        self._order.append(key)
        return self._data[key]
```

**Complexity:** put / get O(n) due to `remove(key)` linear scan. Production code uses a doubly-linked list with hash-map lookup for O(1).

---

### Task 8 — Implement deque using two queues

Inverse of the interview challenge. Given only an ADT for FIFO queues, implement a deque.

#### Go

```go
package main

import "fmt"

type DequeOfQueues struct {
    q1, q2 []int
}

func (d *DequeOfQueues) PushBack(x int)  { d.q1 = append(d.q1, x) }
func (d *DequeOfQueues) PushFront(x int) {
    d.q2 = append(d.q2, x)
    for _, v := range d.q1 { d.q2 = append(d.q2, v) }
    d.q1 = d.q2
    d.q2 = nil
}
func (d *DequeOfQueues) PopFront() int   { v := d.q1[0]; d.q1 = d.q1[1:]; return v }
func (d *DequeOfQueues) PopBack() int    {
    for len(d.q1) > 1 { d.q2 = append(d.q2, d.q1[0]); d.q1 = d.q1[1:] }
    v := d.q1[0]; d.q1 = d.q2; d.q2 = nil
    return v
}

func main() {
    d := &DequeOfQueues{}
    d.PushBack(1); d.PushBack(2); d.PushFront(0)
    fmt.Println(d.PopFront()) // 0
    fmt.Println(d.PopBack())  // 2
}
```

(Java and Python translations follow the same shape.)

**Complexity:** O(n) per pushFront and popBack; O(1) per pushBack and popFront. A "costly enqueue" deque. Cannot achieve O(1) all four with only one queue underneath without the rotation trick.

---

### Task 9 — Detect first repeating element using a deque

Read integers one at a time. As soon as you encounter a duplicate of an earlier value, return it.

#### Python (representative)

```python
from collections import deque

def first_repeat(stream: list[int]) -> int | None:
    seen: set[int] = set()
    order: deque[int] = deque()
    for v in stream:
        if v in seen:
            return v
        seen.add(v)
        order.append(v)
    return None
```

(Go and Java translations omitted for brevity — same shape.)

**Complexity:** O(n) time, O(n) space.

---

### Task 10 — Reverse first K elements of a queue

Given a queue (FIFO) and an integer K, reverse the order of the first K elements while keeping the rest in their original order.

**Approach.** Pop K from the front into a stack (deque used as stack). Then push back from the stack onto the queue. Finally rotate the queue by `len - K` to move the original tail back to its place.

#### Python

```python
from collections import deque

def reverse_first_k(q: deque[int], k: int) -> deque[int]:
    if k > len(q):
        raise ValueError("k > queue length")
    stack: list[int] = []
    for _ in range(k):
        stack.append(q.popleft())
    while stack:
        q.append(stack.pop())
    # Rotate so that originally remaining elements are at the front again.
    for _ in range(len(q) - k):
        q.append(q.popleft())
    return q

if __name__ == "__main__":
    print(reverse_first_k(deque([1, 2, 3, 4, 5]), 3))  # deque([3, 2, 1, 4, 5])
```

**Complexity:** O(n) time, O(k) space.

---

## Advanced Tasks

### Task 11 — Implement a thread-safe bounded deque in Go

Build a `BoundedDeque[T]` with `PushBack` returning `ErrFull`, `PopFront` blocking with timeout, and `Stats()` for observability.

(Solution: see `senior.md` "Code Examples" section — `BoundedDeque` and `PopFrontTimeout`.)

**Test cases to write:**
- 1 producer + 1 consumer at equal rate.
- 1 producer + 1 consumer with consumer slower — should fill, then `ErrFull`.
- N producers + 1 consumer.
- Concurrent `Stats()` during heavy load — must never panic.

---

### Task 12 — Chase-Lev work-stealing deque (single-producer multi-consumer)

Implement a work-stealing deque where one owner thread pushes/pops at the bottom, and any number of thieves can steal from the top. Use CAS on `top`.

#### Java skeleton

```java
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReferenceArray;

public class ChaseLevDeque<T> {
    private final AtomicLong top    = new AtomicLong(0);
    private volatile long bottom    = 0;
    private final AtomicReferenceArray<T> array;
    private final int mask;

    public ChaseLevDeque(int capacityPow2) {
        this.array = new AtomicReferenceArray<>(capacityPow2);
        this.mask  = capacityPow2 - 1;
    }

    public void pushBottom(T x) {
        long b = bottom;
        array.set((int)(b & mask), x);
        bottom = b + 1;
    }

    public T popBottom() {
        long b = bottom - 1;
        bottom = b;
        long t = top.get();
        if (t > b) { bottom = b + 1; return null; }
        T x = array.get((int)(b & mask));
        if (t < b) return x;
        if (!top.compareAndSet(t, t + 1)) x = null;
        bottom = b + 1;
        return x;
    }

    public T steal() {
        long t = top.get();
        long b = bottom;
        if (t >= b) return null;
        T x = array.get((int)(t & mask));
        if (!top.compareAndSet(t, t + 1)) return null; // aborted
        return x;
    }
}
```

(Fixed-capacity for simplicity; production uses resizing arrays.)

**Test cases:**
- Single thread: push n, pop n — verify all values returned in LIFO order.
- One owner + multiple thieves: push 1M tasks, verify count of `popBottom` + sum of `steal` = 1M and no value returned twice.

**Complexity:** O(1) amortised per local op, O(1) per steal.

---

### Task 13 — Sliding window maximum (interview classic)

Given an array of integers and a window size K, return the maximum value in each window. Use a monotonic deque.

This is canonical content of topic **14-monotonic-queue**. Use it here as a deque application:

#### Python

```python
from collections import deque

def sliding_max(arr: list[int], k: int) -> list[int]:
    dq: deque[int] = deque()  # stores indices, values strictly decreasing
    out: list[int] = []
    for i, v in enumerate(arr):
        while dq and dq[0] <= i - k:
            dq.popleft()                  # drop expired
        while dq and arr[dq[-1]] < v:
            dq.pop()                      # drop dominated
        dq.append(i)
        if i >= k - 1:
            out.append(arr[dq[0]])
    return out

if __name__ == "__main__":
    print(sliding_max([1, 3, -1, -3, 5, 3, 6, 7], 3))
    # [3, 3, 5, 5, 6, 7]
```

(Go and Java analogous — see topic 14 for the deep dive.)

**Complexity:** O(n) total time. Each index enters and leaves the deque at most once.

---

### Task 14 — 0-1 BFS on a graph using a deque

Given a graph where edges have weight 0 or 1, find shortest distances from a source. Use a deque: weight-0 edges push to the front; weight-1 edges push to the back. Pop from the front.

This is canonical graph content (topic 11). Use here as a deque application:

#### Python

```python
from collections import deque

INF = float("inf")

def zero_one_bfs(graph: dict[int, list[tuple[int, int]]], source: int, n: int) -> list[float]:
    """graph[u] = list of (v, weight), weight in {0, 1}."""
    dist = [INF] * n
    dist[source] = 0
    dq: deque[int] = deque([source])
    while dq:
        u = dq.popleft()
        for v, w in graph.get(u, []):
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                if w == 0:
                    dq.appendleft(v)
                else:
                    dq.append(v)
    return dist
```

**Complexity:** O(V + E). Each vertex is added at most twice. The deque is the reason 0-1 BFS beats Dijkstra by a log factor on 0-1 graphs.

---

### Task 15 — Persistent (functional) deque with O(1) operations

Implement a persistent deque where every operation returns a new version, and old versions remain accessible. Use **two stacks with lazy rebalance**, returning structurally-shared instances.

This is a deep task — full Kaplan-Tarjan is out of scope. Aim for the simpler **amortised** persistent deque (Okasaki) using two banker's queues back-to-back.

#### Python sketch

```python
from dataclasses import dataclass
from typing import Generic, TypeVar

T = TypeVar("T")

@dataclass(frozen=True)
class PersistentDeque(Generic[T]):
    front: tuple[T, ...]
    back: tuple[T, ...]
    # Conceptual order: front (left-to-right) + reversed(back)

    def push_front(self, x: T) -> "PersistentDeque[T]":
        return PersistentDeque(front=(x,) + self.front, back=self.back)

    def push_back(self, x: T) -> "PersistentDeque[T]":
        return PersistentDeque(front=self.front, back=(x,) + self.back)

    def pop_front(self) -> tuple[T, "PersistentDeque[T]"]:
        if not self.front:
            if not self.back:
                raise IndexError("empty")
            return self.back[-1], PersistentDeque(front=tuple(reversed(self.back[:-1])), back=())
        return self.front[0], PersistentDeque(front=self.front[1:], back=self.back)

    def pop_back(self) -> tuple[T, "PersistentDeque[T]"]:
        if not self.back:
            if not self.front:
                raise IndexError("empty")
            return self.front[-1], PersistentDeque(front=(), back=tuple(reversed(self.front[:-1])))
        return self.back[0], PersistentDeque(front=self.front, back=self.back[1:])
```

(Go and Java translations are straightforward but verbose because they lack persistent collection libraries by default.)

**Complexity:** O(1) per operation in the common case, O(n) on the rebalance. Amortised O(1) with the "credit on each push" argument. Each prior version is still accessible.

**Test case:** push 1, 2, 3 to back, save the version; pop front from the saved version twice; original three-element version must still work.

---

## Benchmark Task

Compare your ring buffer, `LinkedList`-based deque, and the language's built-in deque on a mixed workload of 1M operations alternating `pushBack`, `pushFront`, `popFront`, `popBack`. Record mean and p99 latency per operation.

> See `middle.md` "Performance Comparison" section for ready-to-run benchmark code in all three languages. Run it. Expect ring buffer to be ~5-10x faster than the doubly-linked variant.

**Reporting format:**

| Impl                       | Mean ns/op | P99 ns/op | Memory (MB) |
| -------------------------- | ---------- | --------- | ----------- |
| Ring buffer (yours)        |            |           |             |
| Built-in (deque/ArrayDeque)|            |           |             |
| LinkedList                 |            |           |             |

Submit results, hardware spec (CPU model, cache sizes), and a one-paragraph analysis of which implementation won and why.
