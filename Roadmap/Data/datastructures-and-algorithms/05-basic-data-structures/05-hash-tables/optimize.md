# Hash Table — Optimization Exercises

Each exercise presents working but inefficient code. Identify the performance issue and optimize it.

---

## Exercise 1: Repeated Lookups Instead of Single Pass (Python)

### Slow Version

```python
def count_pairs_with_sum(nums: list[int], target: int) -> int:
    """Count pairs (i, j) where i < j and nums[i] + nums[j] == target."""
    count = 0
    for i in range(len(nums)):
        for j in range(i + 1, len(nums)):
            if nums[i] + nums[j] == target:
                count += 1
    return count
```

**Problem**: O(n^2) brute force checks every pair.

### Optimized Version

```python
from collections import Counter

def count_pairs_with_sum(nums: list[int], target: int) -> int:
    """O(n) using a hash map to count complements seen so far."""
    seen = Counter()
    count = 0
    for num in nums:
        complement = target - num
        count += seen[complement]
        seen[num] += 1
    return count
```

**Improvement**: O(n^2) -> O(n). The hash map stores counts of numbers seen so far. For each number, we instantly know how many valid pairs it can form.

---

## Exercise 2: String Concatenation as Key (Go)

### Slow Version

```go
func groupByFirstLast(words []string) map[string][]string {
    groups := make(map[string][]string)
    for _, w := range words {
        // Allocates a new string every iteration
        key := string(w[0]) + "-" + string(w[len(w)-1])
        groups[key] = append(groups[key], w)
    }
    return groups
}
```

**Problem**: String concatenation allocates a new string on every iteration. For large inputs, this causes heavy GC pressure.

### Optimized Version

```go
func groupByFirstLast(words []string) map[[2]byte][]string {
    groups := make(map[[2]byte][]string)
    for _, w := range words {
        key := [2]byte{w[0], w[len(w)-1]}
        groups[key] = append(groups[key], w)
    }
    return groups
}
```

**Improvement**: Using a fixed-size array `[2]byte` as the key avoids all string allocation. For composite keys with a small fixed structure, arrays or structs are much faster than string concatenation.

---

## Exercise 3: HashMap with Expensive hashCode (Java)

### Slow Version

```java
public class Document {
    private final String content; // Could be megabytes

    public Document(String content) {
        this.content = content;
    }

    @Override
    public int hashCode() {
        // Recomputes hash of entire content every time!
        return content.hashCode();
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Document)) return false;
        return content.equals(((Document) o).content);
    }
}
```

**Problem**: `hashCode()` traverses the entire string (potentially megabytes) on every call. HashMap calls `hashCode()` on every `get()`, `put()`, and `containsKey()`.

### Optimized Version

```java
public class Document {
    private final String content;
    private int cachedHash; // Cache the hash code

    public Document(String content) {
        this.content = content;
    }

    @Override
    public int hashCode() {
        int h = cachedHash;
        if (h == 0 && content.length() > 0) {
            h = content.hashCode();
            cachedHash = h;
        }
        return h;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Document)) return false;
        Document d = (Document) o;
        // Short-circuit: if hashes differ, they are not equal.
        if (hashCode() != d.hashCode()) return false;
        return content.equals(d.content);
    }
}
```

**Improvement**: Hash code is computed once and cached. Subsequent lookups are O(1) instead of O(len). This is the same pattern Java's `String` class uses internally.

---

## Exercise 4: Using List Instead of Set for Membership (Python)

### Slow Version

```python
def find_common_elements(list_a: list[int], list_b: list[int]) -> list[int]:
    result = []
    for item in list_a:
        if item in list_b:  # O(n) linear scan!
            result.append(item)
    return result
```

**Problem**: `item in list_b` is O(n) for a list. Total: O(n * m).

### Optimized Version

```python
def find_common_elements(list_a: list[int], list_b: list[int]) -> list[int]:
    set_b = set(list_b)  # O(m) to build
    return [item for item in list_a if item in set_b]  # O(1) per lookup
```

**Improvement**: O(n * m) -> O(n + m). Converting to a set provides O(1) membership testing.

---

## Exercise 5: Rebuilding Map on Every Query (Go)

### Slow Version

```go
type UserService struct {
    users []User
}

func (s *UserService) FindByID(id int) *User {
    // Builds a map from scratch on every call!
    index := make(map[int]*User)
    for i := range s.users {
        index[s.users[i].ID] = &s.users[i]
    }
    return index[id]
}
```

**Problem**: The map is rebuilt on every query. If `FindByID` is called 1000 times for 1000 users, that is 1,000,000 operations instead of 1,000.

### Optimized Version

```go
type UserService struct {
    users   []User
    byID    map[int]*User
    indexed bool
}

func (s *UserService) buildIndex() {
    s.byID = make(map[int]*User, len(s.users))
    for i := range s.users {
        s.byID[s.users[i].ID] = &s.users[i]
    }
    s.indexed = true
}

func (s *UserService) FindByID(id int) *User {
    if !s.indexed {
        s.buildIndex()
    }
    return s.byID[id]
}

func (s *UserService) AddUser(u User) {
    s.users = append(s.users, u)
    if s.indexed {
        s.byID[u.ID] = &s.users[len(s.users)-1]
    }
}
```

**Improvement**: Build the index once, maintain it incrementally. Lookup goes from O(n) to O(1).

---

## Exercise 6: Excessive Resizing (Java)

### Slow Version

```java
// Starting with default capacity 16 and inserting 1 million entries.
HashMap<String, Integer> map = new HashMap<>();
for (int i = 0; i < 1_000_000; i++) {
    map.put("key-" + i, i);
}
```

**Problem**: HashMap starts at capacity 16 and resizes at load factor 0.75. It will resize at 12, 24, 48, 96, ..., roughly 20 times. Each resize rehashes all existing entries.

### Optimized Version

```java
// Pre-allocate capacity: n / loadFactor + 1
HashMap<String, Integer> map = new HashMap<>(1_333_334);
for (int i = 0; i < 1_000_000; i++) {
    map.put("key-" + i, i);
}
```

**Improvement**: A single allocation of the right size eliminates all resizes. For 1M entries with load factor 0.75, capacity should be `1_000_000 / 0.75 + 1 = 1_333_334`. This avoids 20+ rehash cycles.

---

## Exercise 7: Naive Deduplication (Python)

### Slow Version

```python
def deduplicate(items: list[str]) -> list[str]:
    result = []
    for item in items:
        if item not in result:  # O(n) scan of result list!
            result.append(item)
    return result
```

**Problem**: Checking `item not in result` is O(n) on a list. Total: O(n^2).

### Optimized Version

```python
def deduplicate(items: list[str]) -> list[str]:
    seen = set()
    result = []
    for item in items:
        if item not in seen:  # O(1) set lookup
            seen.add(item)
            result.append(item)
    return result
```

**Alternative** (preserves order, Python 3.7+):

```python
def deduplicate(items: list[str]) -> list[str]:
    return list(dict.fromkeys(items))
```

**Improvement**: O(n^2) -> O(n).

---

## Exercise 8: Map of Lists vs Multimap Pattern (Go)

### Slow Version

```go
func groupStudentsByGrade(students []Student) map[int][]Student {
    result := make(map[int][]Student)
    for _, s := range students {
        // Each append may allocate a new slice (amortized OK, but...)
        result[s.Grade] = append(result[s.Grade], s)
    }
    return result
}
```

**Problem**: While `append` is amortized O(1), the map access pattern causes repeated hashing and map writes. For large datasets, the map grows unpredictably.

### Optimized Version

```go
func groupStudentsByGrade(students []Student) map[int][]Student {
    // First pass: count entries per grade.
    counts := make(map[int]int)
    for _, s := range students {
        counts[s.Grade]++
    }

    // Pre-allocate slices.
    result := make(map[int][]Student, len(counts))
    for grade, count := range counts {
        result[grade] = make([]Student, 0, count)
    }

    // Second pass: fill pre-allocated slices.
    for _, s := range students {
        result[s.Grade] = append(result[s.Grade], s)
    }
    return result
}
```

**Improvement**: Pre-allocating slices eliminates all intermediate slice growths and reduces GC pressure. The two-pass approach uses ~2x iterations but ~0.5x allocations.

---

## Exercise 9: Checking Then Inserting (Java)

### Slow Version

```java
public void processEvent(String eventType) {
    if (!counters.containsKey(eventType)) {  // First lookup
        counters.put(eventType, 0);           // Second lookup
    }
    counters.put(eventType, counters.get(eventType) + 1); // Third + fourth lookup
}
```

**Problem**: Up to 4 hash lookups per call. Each `containsKey`, `put`, and `get` hashes the key and traverses the bucket.

### Optimized Version

```java
public void processEvent(String eventType) {
    counters.merge(eventType, 1, Integer::sum); // Single lookup!
}
```

**Improvement**: `merge()` does everything in one hash computation: if absent, insert 1; if present, add 1 to the existing value. 4 lookups -> 1 lookup.

Similarly in Go:

```go
// Slow: two lookups
if _, ok := m[key]; !ok {
    m[key] = 0
}
m[key]++

// Fast: single lookup (Go handles zero-value automatically)
m[key]++
```

---

## Exercise 10: Linear Scan for Max Value (Python)

### Slow Version

```python
def most_frequent_word(text: str) -> str:
    words = text.split()
    freq = {}
    for w in words:
        freq[w] = freq.get(w, 0) + 1

    # Find max by scanning all entries
    max_word = ""
    max_count = 0
    for word, count in freq.items():
        if count > max_count:
            max_count = count
            max_word = word
    return max_word
```

**Problem**: This is actually O(n) and correct, but we can simplify and potentially optimize with built-in functions.

### Optimized Version

```python
from collections import Counter

def most_frequent_word(text: str) -> str:
    return Counter(text.split()).most_common(1)[0][0]
```

**Improvement**: `Counter` is implemented in C (CPython) and `most_common()` uses `heapq.nlargest` for k < n, making it both faster and more readable.

---

## Exercise 11: Unnecessary Sorting for Top-K (Go)

### Slow Version

```go
func topKFrequent(nums []int, k int) []int {
    freq := make(map[int]int)
    for _, n := range nums {
        freq[n]++
    }

    // Convert to slice and sort — O(n log n)
    type pair struct{ val, count int }
    pairs := make([]pair, 0, len(freq))
    for val, count := range freq {
        pairs = append(pairs, pair{val, count})
    }
    sort.Slice(pairs, func(i, j int) bool {
        return pairs[i].count > pairs[j].count
    })

    result := make([]int, k)
    for i := 0; i < k; i++ {
        result[i] = pairs[i].val
    }
    return result
}
```

**Problem**: Sorting is O(n log n) when we only need the top k elements.

### Optimized Version (Bucket Sort)

```go
func topKFrequent(nums []int, k int) []int {
    freq := make(map[int]int)
    for _, n := range nums {
        freq[n]++
    }

    // Bucket sort: index = frequency, value = list of numbers
    maxFreq := 0
    for _, count := range freq {
        if count > maxFreq {
            maxFreq = count
        }
    }
    buckets := make([][]int, maxFreq+1)
    for val, count := range freq {
        buckets[count] = append(buckets[count], val)
    }

    // Collect top k from highest frequency bucket downward
    result := make([]int, 0, k)
    for i := maxFreq; i >= 0 && len(result) < k; i-- {
        result = append(result, buckets[i]...)
    }
    return result[:k]
}
```

**Improvement**: O(n log n) -> O(n) using bucket sort by frequency.

---

## Exercise 12: Rehash in Open Addressing After Many Deletes (Java)

### Slow Version

```java
// After 100,000 inserts and 90,000 deletes:
// Table has 10,000 live entries but 90,000 tombstones.
// Load factor based on live entries: 10,000/131,072 = 0.076
// Effective load based on (live + tombstones): 100,000/131,072 = 0.76
// Every lookup must probe through dense tombstone fields.
```

**Problem**: Tombstones occupy slots and extend probe sequences. The table reports low load factor (based on live entries) so it never resizes, but probing performance is terrible.

### Fix

Track tombstone count separately. Trigger a **rebuild** (compact/rehash) when `(live + tombstones) / capacity` exceeds a threshold:

```java
public void insert(String key, int value) {
    double effectiveLoad = (double)(size + tombstoneCount) / capacity;
    if (effectiveLoad > 0.6) {
        rebuild();  // Rehash: copies only live entries, dropping tombstones
    }
    // ... normal insert
}

private void rebuild() {
    String[] oldKeys = keys;
    int[] oldValues = values;
    int[] oldStates = states;
    int oldCapacity = capacity;

    // Keep same capacity (or grow if needed)
    keys = new String[capacity];
    values = new int[capacity];
    states = new int[capacity];
    size = 0;
    tombstoneCount = 0;

    for (int i = 0; i < oldCapacity; i++) {
        if (oldStates[i] == OCCUPIED) {
            insert(oldKeys[i], oldValues[i]);
        }
    }
}
```

**Improvement**: Periodic rebuild eliminates tombstone buildup and restores O(1) average probe length.

---

## Summary of Optimization Patterns

| Pattern | Before | After | Speedup |
|---------|--------|-------|---------|
| Hash lookup instead of linear scan | O(n) per query | O(1) per query | n x |
| Pre-allocate capacity | 20+ resizes | 0 resizes | 2-5x |
| Cache hash codes | O(k) per access | O(1) per access | k x |
| Set instead of list for membership | O(n) per check | O(1) per check | n x |
| Build index once | O(n) per query | O(1) per query | n x |
| merge/compute instead of get+put | 3-4 lookups | 1 lookup | 3-4x |
| Bucket sort for top-k | O(n log n) | O(n) | log n x |
| Struct/array keys vs string concat | Allocation per key | Zero allocation | 2-10x |
| Tombstone cleanup | O(tombstones) per probe | O(1) per probe | Variable |
