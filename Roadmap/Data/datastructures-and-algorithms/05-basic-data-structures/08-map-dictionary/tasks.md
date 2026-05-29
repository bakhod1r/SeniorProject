# Map / Dictionary — Practice Tasks

> All tasks must be solved in **Go**, **Java**, and **Python**.

---

## Beginner Tasks

### Task 1 — Word Frequency Counter

Read a string, return a Map of word -> count.

#### Go

```go
package main

import (
	"fmt"
	"strings"
)

func wordCount(s string) map[string]int {
	out := map[string]int{}
	for _, w := range strings.Fields(strings.ToLower(s)) {
		out[w]++
	}
	return out
}

func main() {
	fmt.Println(wordCount("the cat sat on the mat"))
	// map[cat:1 mat:1 on:1 sat:1 the:2]
}
```

#### Java

```java
import java.util.HashMap;
import java.util.Map;

public class Task1 {
    public static Map<String, Integer> wordCount(String s) {
        Map<String, Integer> out = new HashMap<>();
        for (String w : s.toLowerCase().split("\\s+")) {
            out.merge(w, 1, Integer::sum);
        }
        return out;
    }

    public static void main(String[] args) {
        System.out.println(wordCount("the cat sat on the mat"));
    }
}
```

#### Python

```python
from collections import Counter

def word_count(s: str) -> dict[str, int]:
    return dict(Counter(s.lower().split()))

if __name__ == "__main__":
    print(word_count("the cat sat on the mat"))
```

---

### Task 2 — First Non-Repeating Character

Given a string, return the first character that appears exactly once.

#### Go

```go
package main

import "fmt"

func firstUnique(s string) (byte, bool) {
	cnt := map[byte]int{}
	for i := 0; i < len(s); i++ {
		cnt[s[i]]++
	}
	for i := 0; i < len(s); i++ {
		if cnt[s[i]] == 1 {
			return s[i], true
		}
	}
	return 0, false
}

func main() {
	if c, ok := firstUnique("leetcode"); ok {
		fmt.Printf("%c\n", c) // l
	}
}
```

#### Java

```java
import java.util.LinkedHashMap;
import java.util.Map;

public class Task2 {
    public static Character firstUnique(String s) {
        Map<Character, Integer> cnt = new LinkedHashMap<>();
        for (char c : s.toCharArray()) cnt.merge(c, 1, Integer::sum);
        for (var e : cnt.entrySet()) if (e.getValue() == 1) return e.getKey();
        return null;
    }

    public static void main(String[] args) {
        System.out.println(firstUnique("leetcode")); // l
    }
}
```

#### Python

```python
from collections import Counter

def first_unique(s: str) -> str | None:
    cnt = Counter(s)
    for c in s:
        if cnt[c] == 1:
            return c
    return None

print(first_unique("leetcode"))  # l
```

---

### Task 3 — Group Anagrams

Given a list of strings, group anagrams together.

#### Go

```go
package main

import (
	"fmt"
	"sort"
	"strings"
)

func groupAnagrams(words []string) map[string][]string {
	groups := map[string][]string{}
	for _, w := range words {
		b := []byte(strings.ToLower(w))
		sort.Slice(b, func(i, j int) bool { return b[i] < b[j] })
		key := string(b)
		groups[key] = append(groups[key], w)
	}
	return groups
}

func main() {
	fmt.Println(groupAnagrams([]string{"eat", "tea", "tan", "ate", "nat", "bat"}))
}
```

#### Java

```java
import java.util.*;

public class Task3 {
    public static Map<String, List<String>> groupAnagrams(List<String> words) {
        Map<String, List<String>> out = new HashMap<>();
        for (String w : words) {
            char[] arr = w.toLowerCase().toCharArray();
            Arrays.sort(arr);
            out.computeIfAbsent(new String(arr), k -> new ArrayList<>()).add(w);
        }
        return out;
    }

    public static void main(String[] args) {
        System.out.println(groupAnagrams(List.of("eat","tea","tan","ate","nat","bat")));
    }
}
```

#### Python

```python
from collections import defaultdict

def group_anagrams(words: list[str]) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = defaultdict(list)
    for w in words:
        groups["".join(sorted(w.lower()))].append(w)
    return dict(groups)

print(group_anagrams(["eat","tea","tan","ate","nat","bat"]))
```

---

### Task 4 — Two-Sum (Using a Map)

Given `nums` and a target, return indices of two numbers that add to target.

#### Go

```go
package main

import "fmt"

func twoSum(nums []int, target int) (int, int, bool) {
	seen := map[int]int{}
	for i, n := range nums {
		if j, ok := seen[target-n]; ok {
			return j, i, true
		}
		seen[n] = i
	}
	return 0, 0, false
}

func main() {
	i, j, _ := twoSum([]int{2, 7, 11, 15}, 9)
	fmt.Println(i, j) // 0 1
}
```

#### Java

```java
import java.util.HashMap;
import java.util.Map;

public class Task4 {
    public static int[] twoSum(int[] nums, int target) {
        Map<Integer, Integer> seen = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            Integer j = seen.get(target - nums[i]);
            if (j != null) return new int[]{j, i};
            seen.put(nums[i], i);
        }
        return new int[]{-1, -1};
    }

    public static void main(String[] args) {
        int[] r = twoSum(new int[]{2,7,11,15}, 9);
        System.out.println(r[0] + " " + r[1]);
    }
}
```

#### Python

```python
def two_sum(nums: list[int], target: int) -> tuple[int, int] | None:
    seen: dict[int, int] = {}
    for i, n in enumerate(nums):
        if (j := seen.get(target - n)) is not None:
            return j, i
        seen[n] = i
    return None

print(two_sum([2, 7, 11, 15], 9))
```

---

### Task 5 — Map Inversion (Value-to-Keys Multimap)

Given a Map<K, V>, build a Map<V, List<K>>.

#### Go

```go
package main

import "fmt"

func invert(m map[string]int) map[int][]string {
	out := map[int][]string{}
	for k, v := range m {
		out[v] = append(out[v], k)
	}
	return out
}

func main() {
	fmt.Println(invert(map[string]int{"a": 1, "b": 2, "c": 1}))
	// map[1:[a c] 2:[b]] (order may vary)
}
```

#### Java

```java
import java.util.*;

public class Task5 {
    public static Map<Integer, List<String>> invert(Map<String, Integer> m) {
        Map<Integer, List<String>> out = new HashMap<>();
        m.forEach((k, v) -> out.computeIfAbsent(v, x -> new ArrayList<>()).add(k));
        return out;
    }

    public static void main(String[] args) {
        System.out.println(invert(Map.of("a",1,"b",2,"c",1)));
    }
}
```

#### Python

```python
from collections import defaultdict

def invert(m: dict) -> dict:
    out: dict = defaultdict(list)
    for k, v in m.items():
        out[v].append(k)
    return dict(out)

print(invert({"a": 1, "b": 2, "c": 1}))
```

---

## Intermediate Tasks

### Task 6 — LRU Cache (Capacity N)

Implement a cache with O(1) get/put and LRU eviction at capacity.

#### Go

```go
package main

import (
	"container/list"
	"fmt"
)

type entry struct{ k, v int }

type LRU struct {
	cap int
	ll  *list.List
	m   map[int]*list.Element
}

func New(cap int) *LRU {
	return &LRU{cap: cap, ll: list.New(), m: map[int]*list.Element{}}
}

func (c *LRU) Get(k int) (int, bool) {
	if el, ok := c.m[k]; ok {
		c.ll.MoveToFront(el)
		return el.Value.(*entry).v, true
	}
	return 0, false
}

func (c *LRU) Put(k, v int) {
	if el, ok := c.m[k]; ok {
		el.Value.(*entry).v = v
		c.ll.MoveToFront(el)
		return
	}
	if c.ll.Len() == c.cap {
		oldest := c.ll.Back()
		delete(c.m, oldest.Value.(*entry).k)
		c.ll.Remove(oldest)
	}
	c.m[k] = c.ll.PushFront(&entry{k, v})
}

func main() {
	c := New(2)
	c.Put(1, 1); c.Put(2, 2)
	fmt.Println(c.Get(1)) // 1 true
	c.Put(3, 3)            // evicts 2
	fmt.Println(c.Get(2)) // 0 false
}
```

#### Java

```java
import java.util.LinkedHashMap;
import java.util.Map;

public class LRU<K, V> extends LinkedHashMap<K, V> {
    private final int cap;
    public LRU(int cap) {
        super(cap, 0.75f, true);  // accessOrder = true
        this.cap = cap;
    }
    @Override
    protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
        return size() > cap;
    }

    public static void main(String[] args) {
        LRU<Integer, Integer> c = new LRU<>(2);
        c.put(1, 1); c.put(2, 2);
        System.out.println(c.get(1)); // 1
        c.put(3, 3);
        System.out.println(c.get(2)); // null
    }
}
```

#### Python

```python
from collections import OrderedDict

class LRU:
    def __init__(self, cap: int):
        self.cap = cap
        self.d: OrderedDict[int, int] = OrderedDict()

    def get(self, k: int) -> int | None:
        if k not in self.d: return None
        self.d.move_to_end(k)
        return self.d[k]

    def put(self, k: int, v: int) -> None:
        if k in self.d:
            self.d.move_to_end(k)
        elif len(self.d) == self.cap:
            self.d.popitem(last=False)
        self.d[k] = v

c = LRU(2)
c.put(1, 1); c.put(2, 2)
print(c.get(1))   # 1
c.put(3, 3)
print(c.get(2))   # None
```

---

### Task 7 — Top-K Frequent Elements

Given an integer array, return the K most frequent values.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

func topK(nums []int, k int) []int {
	cnt := map[int]int{}
	for _, n := range nums { cnt[n]++ }
	keys := make([]int, 0, len(cnt))
	for k := range cnt { keys = append(keys, k) }
	sort.Slice(keys, func(i, j int) bool { return cnt[keys[i]] > cnt[keys[j]] })
	return keys[:k]
}

func main() { fmt.Println(topK([]int{1,1,1,2,2,3}, 2)) } // [1 2]
```

#### Java

```java
import java.util.*;

public class Task7 {
    public static List<Integer> topK(int[] nums, int k) {
        Map<Integer, Integer> cnt = new HashMap<>();
        for (int n : nums) cnt.merge(n, 1, Integer::sum);
        return cnt.entrySet().stream()
            .sorted((a, b) -> b.getValue() - a.getValue())
            .limit(k).map(Map.Entry::getKey).toList();
    }
    public static void main(String[] args) {
        System.out.println(topK(new int[]{1,1,1,2,2,3}, 2));
    }
}
```

#### Python

```python
from collections import Counter

def top_k(nums: list[int], k: int) -> list[int]:
    return [n for n, _ in Counter(nums).most_common(k)]

print(top_k([1,1,1,2,2,3], 2))   # [1, 2]
```

---

### Task 8 — Time-Based Key-Value Store

Support `set(k, v, ts)` and `get(k, ts)` returning the latest value with timestamp ≤ ts.

#### Go

```go
package main

import (
	"fmt"
	"sort"
)

type entry struct{ ts int; v string }

type TimeMap struct{ m map[string][]entry }

func New() *TimeMap { return &TimeMap{m: map[string][]entry{}} }

func (t *TimeMap) Set(k, v string, ts int) {
	t.m[k] = append(t.m[k], entry{ts, v})
}

func (t *TimeMap) Get(k string, ts int) string {
	arr := t.m[k]
	i := sort.Search(len(arr), func(i int) bool { return arr[i].ts > ts })
	if i == 0 { return "" }
	return arr[i-1].v
}

func main() {
	tm := New()
	tm.Set("foo", "bar", 1)
	fmt.Println(tm.Get("foo", 1))  // bar
	tm.Set("foo", "bar2", 4)
	fmt.Println(tm.Get("foo", 5))  // bar2
}
```

#### Java

```java
import java.util.*;

public class Task8 {
    Map<String, TreeMap<Integer, String>> m = new HashMap<>();

    public void set(String k, String v, int ts) {
        m.computeIfAbsent(k, x -> new TreeMap<>()).put(ts, v);
    }

    public String get(String k, int ts) {
        TreeMap<Integer, String> tm = m.get(k);
        if (tm == null) return "";
        Map.Entry<Integer, String> e = tm.floorEntry(ts);
        return e == null ? "" : e.getValue();
    }

    public static void main(String[] args) {
        Task8 t = new Task8();
        t.set("foo", "bar", 1);
        System.out.println(t.get("foo", 1));   // bar
        t.set("foo", "bar2", 4);
        System.out.println(t.get("foo", 5));   // bar2
    }
}
```

#### Python

```python
from collections import defaultdict
from bisect import bisect_right

class TimeMap:
    def __init__(self):
        self.m: dict[str, list[tuple[int, str]]] = defaultdict(list)

    def set(self, k: str, v: str, ts: int) -> None:
        self.m[k].append((ts, v))   # assume ts is monotonically increasing per spec

    def get(self, k: str, ts: int) -> str:
        arr = self.m.get(k, [])
        i = bisect_right(arr, (ts, chr(0x10FFFF)))
        return arr[i-1][1] if i else ""

tm = TimeMap()
tm.set("foo", "bar", 1)
print(tm.get("foo", 1))   # bar
tm.set("foo", "bar2", 4)
print(tm.get("foo", 5))   # bar2
```

---

### Task 9 — Subarrays with Sum K (Prefix-Sum Map)

Count contiguous subarrays whose sum equals K.

#### Go

```go
package main

import "fmt"

func subarraySum(nums []int, k int) int {
	prefix := map[int]int{0: 1}
	sum, count := 0, 0
	for _, n := range nums {
		sum += n
		count += prefix[sum-k]
		prefix[sum]++
	}
	return count
}

func main() { fmt.Println(subarraySum([]int{1,1,1}, 2)) } // 2
```

#### Java

```java
import java.util.HashMap;
import java.util.Map;

public class Task9 {
    public static int subarraySum(int[] nums, int k) {
        Map<Integer, Integer> pre = new HashMap<>();
        pre.put(0, 1);
        int sum = 0, count = 0;
        for (int n : nums) {
            sum += n;
            count += pre.getOrDefault(sum - k, 0);
            pre.merge(sum, 1, Integer::sum);
        }
        return count;
    }
    public static void main(String[] args) {
        System.out.println(subarraySum(new int[]{1,1,1}, 2));  // 2
    }
}
```

#### Python

```python
from collections import defaultdict

def subarray_sum(nums: list[int], k: int) -> int:
    pre: dict[int, int] = defaultdict(int)
    pre[0] = 1
    s = count = 0
    for n in nums:
        s += n
        count += pre.get(s - k, 0)
        pre[s] += 1
    return count

print(subarray_sum([1, 1, 1], 2))  # 2
```

---

### Task 10 — Multimap (Map of List)

Implement `add(k, v)`, `getAll(k)`, `remove(k, v)`.

#### Go

```go
package main

import "fmt"

type Multimap struct{ m map[string][]string }

func New() *Multimap { return &Multimap{m: map[string][]string{}} }
func (mm *Multimap) Add(k, v string) { mm.m[k] = append(mm.m[k], v) }
func (mm *Multimap) GetAll(k string) []string { return mm.m[k] }
func (mm *Multimap) Remove(k, v string) {
	arr := mm.m[k]
	for i, x := range arr {
		if x == v {
			mm.m[k] = append(arr[:i], arr[i+1:]...)
			return
		}
	}
}

func main() {
	mm := New()
	mm.Add("fruit", "apple"); mm.Add("fruit", "banana")
	fmt.Println(mm.GetAll("fruit")) // [apple banana]
}
```

#### Java

```java
import java.util.*;

public class Multimap<K, V> {
    private final Map<K, List<V>> m = new HashMap<>();
    public void add(K k, V v) { m.computeIfAbsent(k, x -> new ArrayList<>()).add(v); }
    public List<V> getAll(K k) { return m.getOrDefault(k, List.of()); }
    public boolean remove(K k, V v) {
        List<V> arr = m.get(k);
        return arr != null && arr.remove(v);
    }

    public static void main(String[] args) {
        Multimap<String, String> mm = new Multimap<>();
        mm.add("fruit", "apple"); mm.add("fruit", "banana");
        System.out.println(mm.getAll("fruit"));
    }
}
```

#### Python

```python
from collections import defaultdict

class Multimap:
    def __init__(self):
        self.m: dict = defaultdict(list)
    def add(self, k, v): self.m[k].append(v)
    def get_all(self, k): return list(self.m.get(k, []))
    def remove(self, k, v):
        if k in self.m and v in self.m[k]: self.m[k].remove(v)

mm = Multimap()
mm.add("fruit", "apple"); mm.add("fruit", "banana")
print(mm.get_all("fruit"))
```

---

## Advanced Tasks

### Task 11 — LFU Cache

Implement a cache with capacity N and Least-Frequently-Used eviction. O(1) get/put.

> Hint: two Maps + ordered groups. Keep a `freq -> doubly-linked-list-of-keys`, and a `key -> (value, freq, list-node)`. Plus a `minFreq` counter.

Provide your solution in **Go**, **Java**, and **Python**. Tests: capacity 2, sequence put(1,1)/put(2,2)/get(1)/put(3,3) should evict 2; then get(2) returns absent, get(3) returns 3.

---

### Task 12 — Insertion-Ordered Map from Scratch

Implement `OrderedMap` in Go (without using a slice scan for lookup): backing = `map[K]*list.Element` + `container/list`. Operations: `Put`, `Get`, `Delete`, `Keys()` (in insertion order), all O(1) average.

Reference: Java has `LinkedHashMap` built in; Python's dict already does it. The Go implementation is the educational one — write it. Provide Java and Python "reference" implementations using built-ins.

---

### Task 13 — Concurrent Counter Map

Implement a thread-safe `Map<String, Int64>` supporting `Increment(k)` and `Get(k)`. Use lock striping (16 stripes). Benchmark vs a single-lock implementation under 8 goroutines/threads each doing 1M increments on random keys.

Provide Go, Java (`ConcurrentHashMap` with `merge`), and Python (`threading.Lock` + dict, or `collections.Counter` with lock).

---

### Task 14 — Range-Query Map

Build a Map that supports `Put(k, v)`, `Get(k)`, AND `Range(lo, hi)` returning all entries with `lo <= key <= hi` in sorted order.

- Java: use `TreeMap` and `subMap`.
- Python: use `sortedcontainers.SortedDict`.
- Go: implement on top of `[]struct{k, v}` sorted by k, or use a 3rd-party btree. Implement both Put (binary search insert) and Range (binary search + walk).

Test: Put 1, 3, 5, 7, 9. Range(3, 7) -> [(3,...), (5,...), (7,...)].

---

### Task 15 — Persistent Immutable Map (Path-Copy)

Implement a tiny persistent map using a binary search tree with path-copying updates. `Put` returns a new map; old map is unchanged. Use string keys, int values.

- Provide implementations in Go (struct with pointer children), Java (immutable class), Python (frozen dataclass).
- Verify: `m1 = empty.Put("a", 1)`; `m2 = m1.Put("b", 2)`; `m1.Get("b")` returns absent; `m2.Get("a")` returns 1.
- Bonus: measure memory overhead by inserting 1000 keys vs cloning a regular map 1000 times.

---

## Benchmark Task — Compare Three Map Backings

> Insert N integers (N = 10^4, 10^5, 10^6), then perform N random lookups. Measure write time and read time. Compare three implementations in your language: hash-backed, tree-backed (or sorted-array), insertion-ordered.

### Go

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

func main() {
	for _, n := range []int{10_000, 100_000, 1_000_000} {
		m := make(map[int]int, n)
		t0 := time.Now()
		for i := 0; i < n; i++ {
			m[i] = i
		}
		write := time.Since(t0)

		t0 = time.Now()
		for i := 0; i < n; i++ {
			_ = m[rand.Intn(n)]
		}
		read := time.Since(t0)

		fmt.Printf("n=%d  write=%v  read=%v\n", n, write, read)
	}
}
```

### Java

```java
import java.util.*;

public class Bench {
    public static void main(String[] args) {
        for (int n : new int[]{10_000, 100_000, 1_000_000}) {
            for (Map<Integer, Integer> m : List.of(
                    new HashMap<Integer, Integer>(),
                    new TreeMap<Integer, Integer>(),
                    new LinkedHashMap<Integer, Integer>())) {
                long t0 = System.nanoTime();
                for (int i = 0; i < n; i++) m.put(i, i);
                long write = System.nanoTime() - t0;

                Random rnd = new Random(0);
                t0 = System.nanoTime();
                for (int i = 0; i < n; i++) m.get(rnd.nextInt(n));
                long read = System.nanoTime() - t0;

                System.out.printf("%-20s n=%d  write=%dms  read=%dms%n",
                    m.getClass().getSimpleName(), n,
                    write/1_000_000, read/1_000_000);
            }
        }
    }
}
```

### Python

```python
import time, random
from collections import OrderedDict
try:
    from sortedcontainers import SortedDict
except ImportError:
    SortedDict = None

for n in [10_000, 100_000, 1_000_000]:
    backings = [("dict", dict()), ("OrderedDict", OrderedDict())]
    if SortedDict and n <= 100_000:
        backings.append(("SortedDict", SortedDict()))
    for name, m in backings:
        t0 = time.perf_counter()
        for i in range(n): m[i] = i
        write = (time.perf_counter() - t0) * 1000

        random.seed(0)
        t0 = time.perf_counter()
        for _ in range(n): _ = m[random.randint(0, n - 1)]
        read = (time.perf_counter() - t0) * 1000

        print(f"{name:<12} n={n:<8} write={write:7.1f}ms read={read:7.1f}ms")
```

**Expected pattern:** Hash-backed is fastest at all sizes. Tree-backed grows ~log n per op (visible at large n). Insertion-ordered is slightly slower than plain hash due to extra linked-list pointers.

---

## Evaluation Criteria

- **Correctness**: handles empty maps, missing keys, duplicate inserts, edge values
- **Big-O**: state expected average and worst case per operation
- **Idiomatic API**: uses language-appropriate helpers (`merge`, `computeIfAbsent`, `defaultdict`, comma-ok)
- **Tests**: at least 3 unit tests per task (empty, one-element, normal, edge)
- **Cross-language consistency**: same algorithm, same complexity, same observable output
