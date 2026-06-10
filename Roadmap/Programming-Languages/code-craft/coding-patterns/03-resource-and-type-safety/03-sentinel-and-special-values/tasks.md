# Sentinel & Special Values — Practice Tasks

> **Category:** [Resource & Type-Safety Patterns](../README.md) — drills for choosing, naming, and replacing sentinels.

10 practice tasks with full Go, Java, and Python solutions.

---

## Table of Contents

1. [Task 1: Out-of-Domain Sentinel Search](#task-1-out-of-domain-sentinel-search)
2. [Task 2: Map Lookup That Distinguishes Absent from Zero](#task-2-map-lookup-that-distinguishes-absent-from-zero)
3. [Task 3: Replace an Overloaded `0`](#task-3-replace-an-overloaded-0)
4. [Task 4: A Unique `_MISSING` Sentinel](#task-4-a-unique-_missing-sentinel)
5. [Task 5: Sentinel Errors with `errors.Is`](#task-5-sentinel-errors-with-errorsis)
6. [Task 6: Null Object Instead of `null`](#task-6-null-object-instead-of-null)
7. [Task 7: NaN-Safe Aggregation](#task-7-nan-safe-aggregation)
8. [Task 8: Sentinel Node in a Linked List](#task-8-sentinel-node-in-a-linked-list)
9. [Task 9: Return Empty, Not `null`](#task-9-return-empty-not-null)
10. [Task 10: Sentinel-Search Bounds-Check Elision](#task-10-sentinel-search-bounds-check-elision)

---

## Task 1: Out-of-Domain Sentinel Search

**Goal:** Implement `indexOf` returning `-1` when absent — a *good* sentinel.

### Go
```go
func indexOf(xs []int, target int) int {
    for i, x := range xs {
        if x == target { return i }
    }
    return -1 // out of the index domain
}
```

### Java
```java
static int indexOf(int[] xs, int target) {
    for (int i = 0; i < xs.length; i++)
        if (xs[i] == target) return i;
    return -1;
}
```

### Python
```python
def index_of(xs, target):
    for i, x in enumerate(xs):
        if x == target:
            return i
    return -1
```

---

## Task 2: Map Lookup That Distinguishes Absent from Zero

**Goal:** `0` is a legal value, so use the comma-ok / containsKey / `None` channel.

### Go
```go
func lookup(m map[string]int, k string) (int, bool) {
    v, ok := m[k]
    return v, ok
}
```

### Java
```java
static Optional<Integer> lookup(Map<String,Integer> m, String k) {
    return m.containsKey(k) ? Optional.of(m.get(k)) : Optional.empty();
}
```

### Python
```python
def lookup(m: dict, k):
    return (m[k], True) if k in m else (0, False)
```

---

## Task 3: Replace an Overloaded `0`

**Goal:** `read_temp` must not return `0.0` for "no reading".

### Python
```python
from typing import Optional

def read_temp(sensor) -> Optional[float]:
    """None = no reading; any float (incl. 0.0) is real."""
    return sensor.value() if sensor.ready() else None

t = read_temp(sensor)
record(t) if t is not None else skip()
```

### Java
```java
static OptionalDouble readTemp(Sensor s) {
    return s.ready() ? OptionalDouble.of(s.value()) : OptionalDouble.empty();
}
```

### Go
```go
func readTemp(s *Sensor) (float64, bool) {
    if !s.Ready() { return 0, false }
    return s.Value(), true
}
```

---

## Task 4: A Unique `_MISSING` Sentinel

**Goal:** Allow `None` to be a legitimate argument value.

### Python
```python
_MISSING = object()

def get(config: dict, key, default=_MISSING):
    if key in config:
        return config[key]
    if default is _MISSING:
        raise KeyError(key)
    return default

get({"x": None}, "x")              # None (present)
get({}, "x", default=None)         # None (absent, defaulted)
```

### Java (equivalent: overloads, not a sentinel object)
```java
// Java solves this with overloading instead of a sentinel object.
V get(Map<String,V> m, String k)           { /* throws if absent */ }
V get(Map<String,V> m, String k, V dflt)    { return m.getOrDefault(k, dflt); }
```

### Go (equivalent: comma-ok)
```go
func get(m map[string]any, k string) (any, bool) { v, ok := m[k]; return v, ok }
```

---

## Task 5: Sentinel Errors with `errors.Is`

### Go
```go
var ErrNotFound = errors.New("not found")

func find(m map[string]int, k string) (int, error) {
    if v, ok := m[k]; ok { return v, nil }
    return 0, fmt.Errorf("find %q: %w", k, ErrNotFound)
}

func main() {
    _, err := find(map[string]int{}, "x")
    fmt.Println(errors.Is(err, ErrNotFound)) // true, even though wrapped
}
```

### Java (typed exception is the analogue)
```java
final class NotFoundException extends RuntimeException {}
static int find(Map<String,Integer> m, String k) {
    Integer v = m.get(k);
    if (v == null) throw new NotFoundException();
    return v;
}
```

### Python
```python
class NotFound(Exception): ...
def find(m, k):
    if k in m: return m[k]
    raise NotFound(k)
```

---

## Task 6: Null Object Instead of `null`

**Goal:** Callers never null-check the logger.

### Java
```java
interface Logger { void log(String m); }
final class NoopLogger implements Logger {
    static final Logger INSTANCE = new NoopLogger();
    public void log(String m) { }
}
Logger logger = enabled ? new FileLogger() : NoopLogger.INSTANCE;
logger.log("start"); // always safe
```

### Go
```go
type Logger interface{ Log(string) }
type noopLogger struct{}
func (noopLogger) Log(string) {}
var Noop Logger = noopLogger{}
```

### Python
```python
class NoopLogger:
    def log(self, msg): pass
logger = FileLogger() if enabled else NoopLogger()
logger.log("start")
```

See [Null Object](../../01-control-flow/03-null-object/junior.md).

---

## Task 7: NaN-Safe Aggregation

**Goal:** Exclude `NaN` from a mean instead of letting it poison the result.

### Python
```python
import math
def mean(xs):
    clean = [x for x in xs if not math.isnan(x)]
    return sum(clean) / len(clean) if clean else None
```

### Java
```java
static OptionalDouble mean(double[] xs) {
    return Arrays.stream(xs).filter(x -> !Double.isNaN(x)).average();
}
```

### Go
```go
func mean(xs []float64) (float64, bool) {
    sum, n := 0.0, 0
    for _, x := range xs {
        if math.IsNaN(x) { continue }
        sum += x; n++
    }
    if n == 0 { return 0, false }
    return sum / float64(n), true
}
```

---

## Task 8: Sentinel Node in a Linked List

**Goal:** Dummy head removes the "is this the first node?" branch on insert.

### Java
```java
final class LinkedList {
    private final Node head = new Node(0); // sentinel: holds no client data
    void insertFront(int v) {
        Node n = new Node(v);
        n.next = head.next;
        head.next = n;          // no `head == null` special case
    }
    static final class Node { int val; Node next; Node(int v){ val = v; } }
}
```

### Python
```python
class LinkedList:
    def __init__(self):
        self.head = Node(None)       # sentinel
    def insert_front(self, v):
        n = Node(v)
        n.next = self.head.next
        self.head.next = n
class Node:
    def __init__(self, v): self.val = v; self.next = None
```

### Go
```go
type node struct{ val int; next *node }
type list struct{ head *node } // head is a sentinel
func newList() *list { return &list{head: &node{}} }
func (l *list) insertFront(v int) {
    l.head.next = &node{val: v, next: l.head.next}
}
```

---

## Task 9: Return Empty, Not `null`

### Java
```java
List<Order> orders(String userId) {
    List<Order> r = db.query(userId);
    return r != null ? r : List.of();   // never null
}
```

### Go
```go
func orders(userID string) []Order {
    r := db.Query(userID)
    return r // nil slice is iterable in Go; len()==0; range is safe
}
```

### Python
```python
def orders(user_id) -> list:
    return db.query(user_id) or []
```

---

## Task 10: Sentinel-Search Bounds-Check Elision

**Goal:** Plant the key so the inner loop drops its bounds test.

### Java
```java
static int findSentinel(int[] a, int n, int key) {
    int last = a[n - 1];
    a[n - 1] = key;             // sentinel guarantees the loop terminates
    int i = 0;
    while (a[i] != key) i++;    // no i < n check
    a[n - 1] = last;
    return (i < n - 1 || last == key) ? i : -1;
}
```

### Go
```go
func findSentinel(a []int, key int) int {
    n := len(a)
    last := a[n-1]; a[n-1] = key
    i := 0
    for a[i] != key { i++ }
    a[n-1] = last
    if i < n-1 || last == key { return i }
    return -1
}
```

### Python
```python
# Pythonic note: CPython's list scan is already C-level; this is illustrative.
def find_sentinel(a, key):
    n = len(a)
    last = a[n-1]; a[n-1] = key
    i = 0
    while a[i] != key: i += 1
    a[n-1] = last
    return i if (i < n-1 or last == key) else -1
```

> **Caveat:** mutates the array — unusable on read-only/shared data. On modern CPUs the gain is small; benchmark before using.

---

## Practice Tips

1. **Apply the collision test first** — could a real value equal your sentinel?
2. **Prefer `(value, ok)` / `Optional`** whenever the zero value is legal.
3. **Compare sentinel errors with `errors.Is`**, never `==`.
4. **Return empty collections, not `null`.**
5. **Treat `NaN` explicitly** — filter or reject; never let it flow into aggregates.

---

[← Interview](interview.md) · [Resource & Type-Safety](../README.md) · [Roadmap](../../../README.md) · **Next:** [Find-Bug](find-bug.md)
