# Red-Black Tree — Interview Problems

> **Audience:** Engineers preparing for SDE/SDE-II/senior interviews where balanced-BST problems come up — Google, Meta, Apple, Amazon, Microsoft, Stripe, Bloomberg. Prerequisite: `junior.md`.

The bar for "red-black tree" interview problems is rarely "implement the full thing from scratch in 45 minutes". More often it is:
- Use a `TreeMap` / `TreeSet` / `std::map` to solve a problem that requires ordered queries.
- Implement insert/delete/lookup on a tree where the interviewer hand-waves the recolor cases.
- Reason about invariants and prove correctness of a small modification.
- Build an augmented variant (order statistics, range sum, interval merge).

This file walks through 10 problems with Go, Java, and Python solutions, increasing in difficulty. Time and space complexity called out for each.

---

## Table of Contents

1. [Implement RB Insert (the classic)](#p1)
2. [Implement RB Delete (the hard one)](#p2)
3. [Verify Red-Black Properties (debug helper)](#p3)
4. [LC 220 — Contains Nearby Almost Duplicate (TreeSet sliding window)](#p4)
5. [LC 729 — My Calendar I (TreeMap floor/ceiling)](#p5)
6. [LC 218 — The Skyline Problem (TreeMap multiset)](#p6)
7. [SortedMap interface backed by RB](#p7)
8. [Build RB from Sorted Array in O(n)](#p8)
9. [RB with Custom Comparator (case-insensitive strings)](#p9)
10. [LC 732 — My Calendar III (TreeMap with difference array)](#p10)

---

<a name="p1"></a>
## 1. Implement RB Insert (the classic)

**Problem.** Implement insertion into a red-black tree with parent pointers and a NIL sentinel.

**Approach.** Standard BST insert with the new node colored RED, then walk up and apply the 6-case fixup until properties 2 and 4 are restored. Full code lives in `junior.md` section 11. The interview is usually asking you to:
1. Talk through the 3 cases (uncle red, uncle black + zig-zag, uncle black + zig-zig) before writing code.
2. Write rotations correctly (the most error-prone part).
3. Remember to color the root black at the end.

**Time:** O(log n) overall; ≤ 2 rotations; recolorings amortized O(1).
**Space:** O(1) extra.

**Talking-points checklist:**
- "I will use a single shared NIL sentinel to avoid null checks."
- "New nodes are colored red to preserve black-height (property 5)."
- "If the parent is black, no fixup needed."
- "Otherwise we branch on the uncle's color."
- "After the loop, root.color = BLACK."

---

<a name="p2"></a>
## 2. Implement RB Delete (the hard one)

**Problem.** Implement deletion. Most interviewers will not make you write the full 90-line CLRS delete; they want you to *describe* it correctly and write maybe one of the cases.

**The structure of delete:**

1. **Locate the node to delete (`z`).** Standard BST find — O(log n).
2. **Splice out the right node.** If `z` has fewer than 2 children, replace `z` with its (possibly NIL) child `x`. If `z` has 2 children, find its successor `y = minimum(z.right)`, splice `y` out (it has at most a right child), then replace `z` with `y`.
3. **Track `y_original_color`.** The color of the node that "vanishes" (either `z` or the successor `y`).
4. **If `y_original_color == BLACK`,** the splice removed a black node, decreasing the black-height of one subtree by 1. Call `deleteFixup(x)` on the child that replaced it.

The fixup propagates a notion of "extra black" up the tree until it can be absorbed. Four cases on the sibling `w` of `x`:

- **Case 1 — `w` red.** Rotate `w` up, recolor; now `w`'s new sibling is black. Falls through to Case 2/3/4.
- **Case 2 — `w` black, both `w`'s children black.** Recolor `w` red, push extra black to parent, continue up.
- **Case 3 — `w` black, `w.left` red, `w.right` black.** Rotate around `w` to make Case 4.
- **Case 4 — `w` black, `w.right` red.** Rotate around parent of `x`, recolor, **done** — the extra black is absorbed.

```go
func (t *Tree) Delete(key int) {
    z := t.search(key)
    if z == t.nil_ { return }
    y, yOrigColor := z, z.color
    var x *Node
    if z.left == t.nil_ {
        x = z.right
        t.transplant(z, z.right)
    } else if z.right == t.nil_ {
        x = z.left
        t.transplant(z, z.left)
    } else {
        y = t.minimum(z.right)
        yOrigColor = y.color
        x = y.right
        if y.parent == z {
            x.parent = y
        } else {
            t.transplant(y, y.right)
            y.right = z.right
            y.right.parent = y
        }
        t.transplant(z, y)
        y.left = z.left
        y.left.parent = y
        y.color = z.color
    }
    if yOrigColor == black {
        t.deleteFixup(x)
    }
}

func (t *Tree) transplant(u, v *Node) {
    switch {
    case u.parent == t.nil_:
        t.root = v
    case u == u.parent.left:
        u.parent.left = v
    default:
        u.parent.right = v
    }
    v.parent = u.parent
}

func (t *Tree) deleteFixup(x *Node) {
    for x != t.root && x.color == black {
        if x == x.parent.left {
            w := x.parent.right
            if w.color == red { // Case 1
                w.color = black
                x.parent.color = red
                t.leftRotate(x.parent)
                w = x.parent.right
            }
            if w.left.color == black && w.right.color == black { // Case 2
                w.color = red
                x = x.parent
            } else {
                if w.right.color == black { // Case 3
                    w.left.color = black
                    w.color = red
                    t.rightRotate(w)
                    w = x.parent.right
                }
                w.color = x.parent.color // Case 4
                x.parent.color = black
                w.right.color = black
                t.leftRotate(x.parent)
                x = t.root
            }
        } else {
            // mirror cases (omitted for brevity, same logic with left/right swapped)
        }
    }
    x.color = black
}
```

**Time:** O(log n), ≤ 3 rotations.
**Space:** O(1).

The full Java/Python versions are in `tasks.md` task 4.

---

<a name="p3"></a>
## 3. Verify Red-Black Properties (debug helper)

**Problem.** Write a function that returns true iff a given tree satisfies all 5 red-black properties.

**Approach.** Recursive walk that returns the black-height of each subtree and verifies:
- Every node is colored.
- Root is black.
- No red node has a red child.
- Every leaf path has the same black count.

```python
def validate(tree):
    if tree.root is tree.NIL:
        return True
    if tree.root.color != BLACK:                    # property 2
        return False
    def check(node):
        """Returns black-height of subtree rooted at node, or -1 if invalid."""
        if node is tree.NIL:
            return 1                                 # NIL counts as 1 black
        if node.color == RED:
            if node.left.color == RED or node.right.color == RED:
                return -1                            # property 4 violated
        left_bh = check(node.left)
        right_bh = check(node.right)
        if left_bh == -1 or right_bh == -1:
            return -1
        if left_bh != right_bh:                      # property 5 violated
            return -1
        return left_bh + (0 if node.color == RED else 1)
    return check(tree.root) != -1
```

**Time:** O(n). **Space:** O(log n) recursion.

Run this in every test and you will catch RB tree bugs on the first iteration.

---

<a name="p4"></a>
## 4. LC 220 — Contains Nearby Almost Duplicate

**Problem.** Given an integer array `nums`, return true if there exist two indices `i, j` such that `|nums[i] - nums[j]| <= valueDiff` and `|i - j| <= indexDiff`.

**Approach.** Maintain a sliding window of the last `indexDiff` elements in a `TreeSet`. For each new `nums[i]`, query the floor/ceiling: is there any value in `[nums[i] - valueDiff, nums[i] + valueDiff]`?

**Java:**
```java
public boolean containsNearbyAlmostDuplicate(int[] nums, int indexDiff, int valueDiff) {
    TreeSet<Long> window = new TreeSet<>();
    for (int i = 0; i < nums.length; i++) {
        Long ceiling = window.ceiling((long) nums[i] - valueDiff);
        if (ceiling != null && ceiling <= (long) nums[i] + valueDiff) {
            return true;
        }
        window.add((long) nums[i]);
        if (i >= indexDiff) {
            window.remove((long) nums[i - indexDiff]);
        }
    }
    return false;
}
```

**Python (using `SortedList` from `sortedcontainers`):**
```python
from sortedcontainers import SortedList
def containsNearbyAlmostDuplicate(nums, indexDiff, valueDiff):
    window = SortedList()
    for i, x in enumerate(nums):
        idx = window.bisect_left(x - valueDiff)
        if idx < len(window) and window[idx] <= x + valueDiff:
            return True
        window.add(x)
        if i >= indexDiff:
            window.remove(nums[i - indexDiff])
    return False
```

**Go (no TreeMap in stdlib; use a third-party `treemap` or implement):**
```go
import "github.com/emirpasic/gods/maps/treemap"

func containsNearbyAlmostDuplicate(nums []int, indexDiff, valueDiff int) bool {
    tm := treemap.NewWithIntComparator()
    for i, x := range nums {
        if k, _ := tm.Ceiling(x - valueDiff); k != nil && k.(int) <= x+valueDiff {
            return true
        }
        tm.Put(x, true)
        if i >= indexDiff {
            tm.Remove(nums[i-indexDiff])
        }
    }
    return false
}
```

**Time:** O(n log min(n, indexDiff)). **Space:** O(min(n, indexDiff)).

The `TreeSet.ceiling(x - valueDiff)` is the key trick: it returns the smallest element ≥ `x - valueDiff`. If that element is also ≤ `x + valueDiff`, we have a near-duplicate.

---

<a name="p5"></a>
## 5. LC 729 — My Calendar I (TreeMap floor/ceiling)

**Problem.** Implement `book(start, end)` that returns true if the half-open interval `[start, end)` does not overlap any previously booked interval, and false otherwise.

**Approach.** Use a `TreeMap<Integer, Integer>` mapping `start → end`. For a new `[s, e)`:
- The interval to the left (`floorEntry(s)`) must end at or before `s`.
- The interval to the right (`ceilingEntry(s)`) must start at or after `e`.

If both checks pass, insert. Both queries are O(log n).

**Java:**
```java
class MyCalendar {
    private final TreeMap<Integer, Integer> calendar = new TreeMap<>();
    public boolean book(int start, int end) {
        Map.Entry<Integer, Integer> prev = calendar.floorEntry(start);
        Map.Entry<Integer, Integer> next = calendar.ceilingEntry(start);
        if ((prev == null || prev.getValue() <= start) &&
            (next == null || end <= next.getKey())) {
            calendar.put(start, end);
            return true;
        }
        return false;
    }
}
```

**Python:**
```python
from sortedcontainers import SortedDict
class MyCalendar:
    def __init__(self):
        self.calendar = SortedDict()
    def book(self, start, end):
        idx = self.calendar.bisect_right(start)   # index of first key > start
        if idx > 0:
            prev_start, prev_end = self.calendar.peekitem(idx - 1)
            if prev_end > start:
                return False
        if idx < len(self.calendar):
            next_start, _ = self.calendar.peekitem(idx)
            if end > next_start:
                return False
        self.calendar[start] = end
        return True
```

**Time:** O(log n) per `book`. **Space:** O(n) for the calendar.

---

<a name="p6"></a>
## 6. LC 218 — The Skyline Problem (TreeMap multiset)

**Problem.** Given buildings as `[left, right, height]`, return the skyline's key points (every transition in height).

**Approach.** Sweep over building edges sorted by x. Maintain a multiset of active heights. For each event, add or remove the building's height. After processing all events at a given x, query the max active height; if it differs from the previous max, emit a key point.

A `TreeMap<Integer, Integer>` from `height → count` serves as a multiset that gives O(log n) max via `lastKey()`.

**Java:**
```java
public List<List<Integer>> getSkyline(int[][] buildings) {
    List<int[]> events = new ArrayList<>();
    for (int[] b : buildings) {
        events.add(new int[]{b[0], b[2], +1});    // start
        events.add(new int[]{b[1], b[2], -1});    // end
    }
    // Sort: by x; if same x, starts before ends; among starts, taller first; among ends, shorter first.
    events.sort((a, b) -> a[0] != b[0] ? a[0] - b[0]
                       : (b[2] - a[2]) != 0 ? (b[2] - a[2])  // +1 before -1
                       : a[2] == 1 ? b[1] - a[1] : a[1] - b[1]);
    TreeMap<Integer, Integer> heights = new TreeMap<>();
    heights.put(0, 1);                              // ground level
    List<List<Integer>> result = new ArrayList<>();
    int prev = 0;
    for (int[] e : events) {
        if (e[2] == +1) {
            heights.merge(e[1], 1, Integer::sum);
        } else {
            if (heights.get(e[1]) == 1) heights.remove(e[1]);
            else                        heights.merge(e[1], -1, Integer::sum);
        }
        int cur = heights.lastKey();
        if (cur != prev) {
            result.add(List.of(e[0], cur));
            prev = cur;
        }
    }
    return result;
}
```

**Time:** O(n log n). **Space:** O(n).

The `TreeMap`'s `lastKey()` is the maximum, O(log n). `merge` either inserts or increments the count.

---

<a name="p7"></a>
## 7. SortedMap Interface Backed by RB

**Problem.** Implement an interface providing `put`, `get`, `remove`, `firstKey`, `lastKey`, `ceilingKey`, `floorKey`, `higherKey`, `lowerKey`, `subMap(from, to)`. Back it with a red-black tree.

**Approach.** Most of the operations are simple BST queries; the interesting ones are the four directional queries:

- `ceilingKey(k)` — smallest key ≥ `k`. Walk down; if `node.key >= k`, candidate, go left; else go right.
- `floorKey(k)` — largest key ≤ `k`. Mirror.
- `higherKey(k)` — smallest key > `k`. Same as ceiling but strict.
- `lowerKey(k)` — largest key < `k`. Same as floor but strict.

**Python:**
```python
def ceiling_key(self, k):
    x, candidate = self.root, None
    while x is not self.NIL:
        if x.key >= k:
            candidate = x
            x = x.left
        else:
            x = x.right
    return candidate.key if candidate else None

def floor_key(self, k):
    x, candidate = self.root, None
    while x is not self.NIL:
        if x.key <= k:
            candidate = x
            x = x.right
        else:
            x = x.left
    return candidate.key if candidate else None
```

`subMap(from, to)` returns a lazy view; iteration walks from `ceilingKey(from)` to `lowerKey(to)` using the in-order successor function.

**Time:** O(log n) per query, O(log n) initial + O(k) for `subMap` iteration of `k` elements.

---

<a name="p8"></a>
## 8. Build RB from Sorted Array in O(n)

**Problem.** Given a sorted array of `n` elements, build a valid red-black tree in O(n) time.

**Approach.** Insert one-by-one is O(n log n). To do it in O(n), recursively build the *perfectly balanced* BST first (medians as roots, like building a sorted-array-to-BST), then color the tree: all internal nodes black, except the bottom level which becomes red. The result satisfies all RB properties.

**Python:**
```python
def build_from_sorted(self, arr):
    n = len(arr)
    if n == 0:
        return
    height = (n + 1).bit_length() - 1  # floor(log2(n+1))
    full_leaf_level = (1 << height) - 1
    leaf_count = n - full_leaf_level  # number of nodes on the partial bottom level

    def build(lo, hi, depth):
        if lo > hi:
            return self.NIL
        mid = (lo + hi) // 2
        node = Node(arr[mid], BLACK)
        node.left = build(lo, mid - 1, depth + 1)
        node.right = build(mid + 1, hi, depth + 1)
        if node.left is not self.NIL: node.left.parent = node
        if node.right is not self.NIL: node.right.parent = node
        # Color partial bottom level red
        if depth == height and node.left is self.NIL and node.right is self.NIL:
            node.color = RED
        return node

    self.root = build(0, n - 1, 0)
    self.root.parent = self.NIL
    self.root.color = BLACK
```

**Time:** O(n). **Space:** O(log n) recursion.

This is how `TreeMap`'s `buildFromSorted` method (used by `TreeMap(SortedMap m)` constructor and deserialization) achieves linear-time construction. The actual JDK code is more elaborate to handle the depth-coloring correctly with arbitrary `n` — see `TreeMap.computeRedLevel`.

---

<a name="p9"></a>
## 9. RB with Custom Comparator (case-insensitive strings)

**Problem.** Implement an RB tree that uses a user-supplied comparator. Demonstrate by storing strings case-insensitively.

**Approach.** Replace every `<` and `>` with calls to `comparator.compare(a, b)`. The structural logic is unchanged; only the BST comparison swaps in the user function.

**Go:**
```go
type Tree[K any] struct {
    root *Node[K]
    nil_ *Node[K]
    less func(a, b K) bool
}

func New[K any](less func(a, b K) bool) *Tree[K] {
    sentinel := &Node[K]{color: black}
    return &Tree[K]{root: sentinel, nil_: sentinel, less: less}
}

func (t *Tree[K]) Insert(key K) {
    // ... standard BST descent but using t.less(key, x.key) instead of < ...
}

// Usage:
tree := New[string](func(a, b string) bool {
    return strings.ToLower(a) < strings.ToLower(b)
})
tree.Insert("Banana")
tree.Insert("apple")      // ordered before Banana
tree.Insert("BANANA")     // equal to Banana under this comparator
```

**Java's TreeMap supports this natively:**
```java
TreeMap<String, Integer> map = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
map.put("Banana", 1);
map.put("BANANA", 2);     // overwrites — both compare equal
```

**Watch out:** the comparator must define a **total order**: trichotomy (exactly one of `<`, `=`, `>` for every pair), transitivity, and consistency with `equals` (or you may get surprising behavior in `containsKey`).

---

<a name="p10"></a>
## 10. LC 732 — My Calendar III (TreeMap with Difference Array)

**Problem.** Implement `book(start, end)` that returns the maximum *overlap depth* of any point in time across all bookings made so far.

**Approach.** Maintain a `TreeMap<Integer, Integer>` representing a difference array: at every `start` add 1, at every `end` subtract 1. The max depth is the maximum prefix sum, which can be computed by walking the map in order each call (O(n) per call) or maintained incrementally with a more elaborate segment tree.

**Java:**
```java
class MyCalendarThree {
    private final TreeMap<Integer, Integer> delta = new TreeMap<>();
    public int book(int start, int end) {
        delta.merge(start, 1, Integer::sum);
        delta.merge(end, -1, Integer::sum);
        int max = 0, active = 0;
        for (int d : delta.values()) {
            active += d;
            if (active > max) max = active;
        }
        return max;
    }
}
```

**Time:** O(n) per `book` (n = number of bookings so far). Total O(n²) for `n` bookings — passes the LeetCode constraints (n ≤ 400).

A segment-tree-with-lazy-propagation solution achieves O(log V) per call where V is the value range, but is significantly more code.

**Time:** O(n) per call. **Space:** O(n).

---

## Talking Points When Asked "Why Red-Black?"

When an interviewer asks "why did you use a TreeMap here?" or "why not a HashMap?", reach for:

1. **"I need ordered queries."** Floor, ceiling, predecessor, successor — none of which a hash table supports.
2. **"I need sorted iteration."** In-order traversal is O(n); `HashMap.keySet().stream().sorted()` is O(n log n).
3. **"I need range queries."** `subMap(from, to)` is O(log n) start + O(k) iterate.
4. **"I want predictable worst-case latency."** RB has no resize stalls. Important for scheduler-like code or latency-sensitive paths.
5. **"My keys don't hash well."** Strings with adversarial structure, or floating-point keys near collision regions, may pathologically degrade a hash table.

When the answer is "I need O(1) exact-match lookup and nothing else", reach for the hash table.

---

## Summary

The interview-relevant skills for red-black trees split cleanly:
- **Implementation skill:** can you write the insert, the delete, and the validation function. Tested by ~20 % of interviewers.
- **API skill:** can you use `TreeMap` / `TreeSet` / `std::map` to solve range-query and ordered-iteration problems. Tested by ~80 % of interviewers.
- **Reasoning skill:** can you explain the 5 properties, the height bound, and why RB is preferred over AVL. Tested by senior+ interviews.

Practice the API problems on LeetCode tagged "TreeMap" / "Ordered Set" / "TreeSet" until floor/ceiling/lastKey calls are second nature.
