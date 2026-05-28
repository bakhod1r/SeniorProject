# Hash Table — Find the Bug Exercises

Each exercise contains buggy code. Find the bug, explain why it is wrong, and provide the fix.

---

## Exercise 1: Mutable Key Disaster (Python)

```python
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __hash__(self):
        return hash((self.x, self.y))

    def __eq__(self, other):
        return self.x == other.x and self.y == other.y

# Usage
cache = {}
p = Point(1, 2)
cache[p] = "origin-ish"

# Later, someone modifies the point...
p.x = 99

print(cache[p])  # KeyError! But p is still in the dict!
```

**Bug**: The key `p` was mutated after insertion. The hash changed from `hash((1, 2))` to `hash((99, 2))`, but the entry is still stored in the bucket for the old hash. Looking up `p` now computes the new hash and searches the wrong bucket.

**Fix**: Make `Point` immutable. Use `__slots__` and prevent attribute assignment, or use a `namedtuple` / `@dataclass(frozen=True)`:

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Point:
    x: int
    y: int
```

---

## Exercise 2: Wrong Hash Function (Go)

```go
func (ht *HashTable) hash(key string) int {
    h := 0
    for _, ch := range key {
        h += int(ch)
    }
    return h % ht.capacity
}
```

**Bug**: This hash function simply sums character codes. Anagrams like `"abc"`, `"bca"`, `"cab"` all produce the same hash. This causes massive clustering for real-world data.

**Fix**: Use a polynomial rolling hash that accounts for character position:

```go
func (ht *HashTable) hash(key string) int {
    h := 0
    for _, ch := range key {
        h = h*31 + int(ch)
    }
    if h < 0 {
        h = -h
    }
    return h % ht.capacity
}
```

---

## Exercise 3: Equality Without Hash (Java)

```java
public class Student {
    String name;
    int id;

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Student)) return false;
        Student s = (Student) o;
        return id == s.id && name.equals(s.name);
    }
    // hashCode() is NOT overridden!
}

// Usage
HashMap<Student, String> grades = new HashMap<>();
Student s1 = new Student("Alice", 1);
grades.put(s1, "A");

Student s2 = new Student("Alice", 1);
System.out.println(grades.get(s2)); // null!
```

**Bug**: `equals()` is overridden but `hashCode()` is not. By default, `hashCode()` returns a value based on the object's memory address. `s1` and `s2` are equal by `equals()` but have different hash codes, so the lookup goes to the wrong bucket.

**Fix**: Always override `hashCode()` when you override `equals()`:

```java
@Override
public int hashCode() {
    return Objects.hash(name, id);
}
```

---

## Exercise 4: Delete Without Tombstone (Python)

```python
class OpenAddressTable:
    def __init__(self, capacity=8):
        self.keys = [None] * capacity
        self.values = [None] * capacity
        self.capacity = capacity

    def _hash(self, key):
        return hash(key) % self.capacity

    def insert(self, key, value):
        idx = self._hash(key)
        while self.keys[idx] is not None:
            if self.keys[idx] == key:
                self.values[idx] = value
                return
            idx = (idx + 1) % self.capacity
        self.keys[idx] = key
        self.values[idx] = value

    def delete(self, key):
        idx = self._hash(key)
        while self.keys[idx] is not None:
            if self.keys[idx] == key:
                self.keys[idx] = None      # BUG HERE
                self.values[idx] = None
                return True
            idx = (idx + 1) % self.capacity
        return False

    def search(self, key):
        idx = self._hash(key)
        while self.keys[idx] is not None:
            if self.keys[idx] == key:
                return self.values[idx]
            idx = (idx + 1) % self.capacity
        return None
```

**Bug**: Setting the slot to `None` on delete breaks the probe chain. If key A is at index 5 and key B (which hashed to 5 but probed to 6) is at index 6, deleting A sets index 5 to `None`. Now searching for B starts at 5, sees `None`, and stops — B is lost.

**Fix**: Use a tombstone sentinel:

```python
_DELETED = object()  # Unique sentinel

def delete(self, key):
    idx = self._hash(key)
    while self.keys[idx] is not None or self.keys[idx] is _DELETED:
        if self.keys[idx] == key:
            self.keys[idx] = _DELETED
            self.values[idx] = None
            return True
        idx = (idx + 1) % self.capacity
    return False

def search(self, key):
    idx = self._hash(key)
    while self.keys[idx] is not None or self.keys[idx] is _DELETED:
        if self.keys[idx] == key:
            return self.values[idx]
        idx = (idx + 1) % self.capacity
    return None
```

---

## Exercise 5: Rehash Loses Entries (Go)

```go
func (ht *HashTable) resize() {
    newCapacity := ht.capacity * 2
    newBuckets := make([]*Entry, newCapacity)

    for i := 0; i < ht.capacity; i++ {
        if ht.buckets[i] != nil {
            // BUG: reuses old index instead of rehashing
            newBuckets[i] = ht.buckets[i]
        }
    }

    ht.buckets = newBuckets
    ht.capacity = newCapacity
}
```

**Bug**: Entries are copied to the same index in the new (larger) array. Since the hash function uses `% capacity`, and capacity has changed, entries must be rehashed. With the old indices, lookups with the new capacity will compute different indices and miss the data.

**Fix**: Rehash every entry with the new capacity:

```go
func (ht *HashTable) resize() {
    oldBuckets := ht.buckets
    ht.capacity *= 2
    ht.buckets = make([]*Entry, ht.capacity)
    ht.size = 0

    for _, head := range oldBuckets {
        current := head
        for current != nil {
            ht.Insert(current.Key, current.Value)
            current = current.Next
        }
    }
}
```

---

## Exercise 6: Infinite Loop on Full Table (Java)

```java
public void insert(String key, int value) {
    int index = hash(key);
    while (keys[index] != null && !keys[index].equals(key)) {
        index = (index + 1) % capacity;
    }
    keys[index] = key;
    values[index] = value;
    size++;
}
```

**Bug**: If the table is completely full (all slots occupied with different keys), this loop runs forever — it never finds `null` and never matches the key.

Additionally, `size++` is called even on updates (when the key already exists), making the size count wrong.

**Fix**: Check load factor before insert, and do not increment size on update:

```java
public void insert(String key, int value) {
    if ((double)(size + 1) / capacity > 0.7) {
        resize();
    }

    int index = hash(key);
    while (keys[index] != null && !keys[index].equals(key)) {
        index = (index + 1) % capacity;
    }

    boolean isNew = (keys[index] == null);
    keys[index] = key;
    values[index] = value;
    if (isNew) size++;
}
```

---

## Exercise 7: Hash Code Overflow (Go)

```go
func hash(key string) int {
    h := 0
    for _, ch := range key {
        h = h*31 + int(ch)
    }
    return h % 16
}
```

**Bug**: For long strings, `h` can overflow and become negative. In Go, `%` on a negative number returns a negative result: `-5 % 16 = -5`. A negative index causes an out-of-bounds panic.

**Fix**: Ensure the result is non-negative:

```go
func hash(key string) int {
    h := 0
    for _, ch := range key {
        h = h*31 + int(ch)
    }
    index := h % 16
    if index < 0 {
        index += 16
    }
    return index
}
```

Or use unsigned arithmetic: `return int(uint(h) % uint(16))`.

---

## Exercise 8: Concurrent Map Access (Go)

```go
func main() {
    m := make(map[string]int)

    go func() {
        for i := 0; i < 1000; i++ {
            m[fmt.Sprintf("key-%d", i)] = i
        }
    }()

    go func() {
        for i := 0; i < 1000; i++ {
            _ = m[fmt.Sprintf("key-%d", i)]
        }
    }()

    time.Sleep(time.Second)
}
```

**Bug**: Go maps are NOT safe for concurrent access. Concurrent read and write (or write and write) causes a fatal runtime error: `concurrent map writes` or `concurrent map read and map write`.

**Fix**: Use `sync.Mutex`, `sync.RWMutex`, or `sync.Map`:

```go
func main() {
    var mu sync.RWMutex
    m := make(map[string]int)

    go func() {
        for i := 0; i < 1000; i++ {
            mu.Lock()
            m[fmt.Sprintf("key-%d", i)] = i
            mu.Unlock()
        }
    }()

    go func() {
        for i := 0; i < 1000; i++ {
            mu.RLock()
            _ = m[fmt.Sprintf("key-%d", i)]
            mu.RUnlock()
        }
    }()

    time.Sleep(time.Second)
}
```

---

## Exercise 9: Wrong Resize Threshold (Python)

```python
class HashTable:
    def __init__(self):
        self._capacity = 4
        self._buckets = [[] for _ in range(self._capacity)]
        self._size = 0

    def insert(self, key, value):
        index = hash(key) % self._capacity
        for i, (k, v) in enumerate(self._buckets[index]):
            if k == key:
                self._buckets[index][i] = (key, value)
                return
        self._buckets[index].append((key, value))
        self._size += 1

        # BUG: resize check is AFTER the insert
        if self._size / self._capacity > 2.0:
            self._resize()

    def _resize(self):
        old = self._buckets
        self._capacity *= 2
        self._buckets = [[] for _ in range(self._capacity)]
        self._size = 0
        for bucket in old:
            for key, value in bucket:
                self.insert(key, value)
```

**Bug**: The resize threshold is 2.0 — far too high. By the time load factor reaches 2.0, each bucket has an average of 2 entries and some will have many more. Performance will be poor long before resizing occurs.

Also, the resize only doubles the capacity. If you are already at load factor 2.0, after doubling you are at 1.0 — still high. You may immediately need another resize on the next few inserts.

**Fix**: Use a standard threshold of 0.75:

```python
if self._size / self._capacity > 0.75:
    self._resize()
```

---

## Exercise 10: Comparing Hashes Instead of Keys (Java)

```java
public Integer search(String key) {
    int index = hash(key);
    Entry current = buckets[index];

    while (current != null) {
        // BUG: comparing hash codes instead of keys
        if (hash(current.key) == hash(key)) {
            return current.value;
        }
        current = current.next;
    }
    return null;
}
```

**Bug**: Two different keys can produce the same hash code (that is the definition of a collision). Comparing hash codes instead of keys means the search may return the value for a different key that happens to share the same hash.

**Fix**: Compare the actual keys:

```java
while (current != null) {
    if (current.key.equals(key)) {
        return current.value;
    }
    current = current.next;
}
```

---

## Exercise 11: Lost Chain Entries on Prepend (Go)

```go
func (ht *HashTable) Insert(key string, value int) {
    index := ht.hash(key)

    newEntry := &Entry{Key: key, Value: value}
    // BUG: does not link to existing chain
    ht.buckets[index] = newEntry
    ht.size++
}
```

**Bug**: The new entry replaces the entire chain. All previously stored entries at that bucket are lost (memory leak and data loss).

**Fix**: Set the new entry's `Next` to the current head:

```go
func (ht *HashTable) Insert(key string, value int) {
    index := ht.hash(key)

    // Check for existing key first.
    current := ht.buckets[index]
    for current != nil {
        if current.Key == key {
            current.Value = value
            return
        }
        current = current.Next
    }

    newEntry := &Entry{Key: key, Value: value, Next: ht.buckets[index]}
    ht.buckets[index] = newEntry
    ht.size++
}
```

---

## Exercise 12: Identity Hash in Python (Python)

```python
class BadKey:
    def __init__(self, val):
        self.val = val

    def __eq__(self, other):
        return isinstance(other, BadKey) and self.val == other.val

    # No __hash__ defined!

d = {}
d[BadKey(1)] = "one"       # TypeError in Python 3!
```

**Bug**: In Python 3, if you define `__eq__` without `__hash__`, the class becomes unhashable (hash is set to `None`). This raises a `TypeError: unhashable type` when trying to use it as a dict key.

In Python 2 this was silently allowed (using `id()` as hash), which was worse because two equal objects could have different hashes.

**Fix**: Define `__hash__` consistently with `__eq__`:

```python
class GoodKey:
    def __init__(self, val):
        self.val = val

    def __eq__(self, other):
        return isinstance(other, GoodKey) and self.val == other.val

    def __hash__(self):
        return hash(self.val)
```

---

## Summary of Common Bug Categories

| Category | Root Cause | Prevention |
|----------|-----------|------------|
| Mutable keys | Hash changes after insertion | Use immutable types as keys |
| Missing hashCode/hash | equals() without hashCode() | Always override both together |
| No tombstones | Delete breaks probe chains | Use sentinel values in open addressing |
| Wrong rehash | Copy without rehashing | Always recompute hash with new capacity |
| Negative hash | Integer overflow | Use absolute value or unsigned arithmetic |
| Concurrent access | Race conditions on shared map | Use locks or concurrent data structures |
| Hash comparison | Comparing hashes, not keys | Always compare actual key values |
| Lost chain | Overwriting bucket head | Link new entry to existing chain |
| Bad threshold | Load factor too high/too low | Use standard 0.75 threshold |
| Size tracking | Incrementing on updates | Only increment for new insertions |
