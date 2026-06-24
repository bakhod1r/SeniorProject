# Algorithms & Data Structures

> Senior-level coding-screen and complexity-reasoning questions for a Go backend engineer, mixing conceptual depth with classic problems solved idiomatically in Go.

**77 questions** across **22 topics** · Level: senior

## Topics

- [Arrays & Strings](#arrays-strings) (4)
- [Hash Maps & Sets](#hash-maps-sets) (4)
- [Stacks & Queues](#stacks-queues) (3)
- [Linked Lists](#linked-lists) (3)
- [Trees](#trees) (5)
- [Heaps & Priority Queues](#heaps-priority-queues) (2)
- [Graphs](#graphs) (3)
- [Recursion & Backtracking](#recursion-backtracking) (3)
- [Dynamic Programming](#dynamic-programming) (4)
- [Sorting & Searching](#sorting-searching) (3)
- [Complexity Analysis](#complexity-analysis) (2)
- [Advanced Graph Algorithms](#advanced-graph-algorithms) (6)
- [Advanced Dynamic Programming](#advanced-dynamic-programming) (8)
- [Intervals & Greedy Scheduling](#intervals-greedy-scheduling) (3)
- [Heaps, Two-Heaps & Selection](#heaps-two-heaps-selection) (3)
- [Tries & String Matching](#tries-string-matching) (4)
- [Range Queries](#range-queries) (2)
- [Greedy Classics](#greedy-classics) (3)
- [Math & Bit Manipulation](#math-bit-manipulation) (3)
- [Data-Structure Design](#data-structure-design) (4)
- [Concurrency-Flavored DSA (Go)](#concurrency-flavored-dsa-go) (3)
- [Sampling & Streaming Selection](#sampling-streaming-selection) (2)

---

## Arrays & Strings

#### 1. Explain the two-pointer technique and when it beats a hash map. Solve: given a sorted array, return indices of two numbers summing to a target.

*Difficulty:* 🟢 warm-up  ·  *Tags:* `two-pointers`, `arrays`, `search`

Two pointers exploit ordering: place one pointer at each end and move them inward based on whether the current sum is too large or too small. Because each step eliminates one candidate, it runs in O(n) time and O(1) space, versus a hash map's O(n) space. It beats a hash map when the input is already sorted (or sorting is cheap relative to the rest of the work) and you want constant extra memory. Edge cases: empty/one-element array (no pair), duplicates (still works), and integer overflow on sum for large int values — in Go use `int` (64-bit on most platforms) or check bounds. The pointers never cross, so termination is guaranteed.

**Key points**
- Requires sorted input; O(n) time, O(1) space
- Move left up to increase sum, right down to decrease
- Hash-map alternative is O(n) space but works unsorted
- Watch for overflow and crossing pointers


```go
func twoSumSorted(nums []int, target int) (int, int) {
	i, j := 0, len(nums)-1
	for i < j {
		sum := nums[i] + nums[j]
		switch {
		case sum == target:
			return i, j
		case sum < target:
			i++
		default:
			j--
		}
	}
	return -1, -1
}
```

**Follow-ups**
- How would you return all unique pairs (3Sum-style dedup)?
- What changes if the array is not sorted and you cannot mutate it?

---

#### 2. Find the length of the longest substring without repeating characters. Walk through the sliding-window invariant.

*Difficulty:* 🟡 medium  ·  *Tags:* `sliding-window`, `strings`, `hash-map`

Maintain a window [left, right] containing only distinct characters. Expand `right` one character at a time; when the incoming character already exists in the window, shrink from the left until the duplicate is removed. Track the last-seen index of each byte/rune so you can jump `left` directly instead of stepping. Invariant: at every iteration the window holds no duplicates, so the max window size seen is the answer. Time O(n) (each index enters and leaves the window once), space O(k) where k is the alphabet size. Edge cases: empty string (0), all-same characters (1), and Unicode — iterate over runes if multi-byte characters matter rather than bytes.

**Key points**
- Window invariant: no duplicate chars inside
- Store last index to jump left, not step it
- O(n) time, O(min(n, alphabet)) space
- Bytes vs runes for Unicode correctness


```go
func lengthOfLongestSubstring(s string) int {
	last := make(map[byte]int)
	best, left := 0, 0
	for right := 0; right < len(s); right++ {
		c := s[right]
		if idx, ok := last[c]; ok && idx >= left {
			left = idx + 1
		}
		last[c] = right
		if w := right - left + 1; w > best {
			best = w
		}
	}
	return best
}
```

**Follow-ups**
- Generalize to at most K distinct characters.
- How do you handle full Unicode grapheme clusters?

---

#### 3. Explain prefix sums and how they turn range-sum queries into O(1). Then handle updates — when do you switch to a Fenwick tree?

*Difficulty:* 🟡 medium  ·  *Tags:* `prefix-sum`, `fenwick-tree`, `range-queries`

A prefix-sum array `P` where `P[i] = a[0]+...+a[i-1]` lets any range sum `[l, r)` be computed as `P[r] - P[l]` in O(1) after O(n) precompute and O(n) space. This is ideal for a static array with many queries. The moment you need point updates interleaved with range queries, a flat prefix array costs O(n) per update (you rebuild the suffix). A Fenwick/Binary Indexed Tree gives O(log n) for both update and prefix query with O(n) space; a segment tree does the same and also supports range updates with lazy propagation. Edge cases: off-by-one on inclusive vs exclusive bounds, and overflow for large sums (use int64). For 2D, extend to a prefix matrix with inclusion-exclusion.

**Key points**
- P[r]-P[l] gives range sum in O(1) on static data
- Updates break flat prefix sums (O(n) each)
- Fenwick tree: O(log n) update + query
- Segment tree adds lazy range updates; watch overflow


```go
type Fenwick struct{ t []int }

func NewFenwick(n int) *Fenwick { return &Fenwick{t: make([]int, n+1)} }

func (f *Fenwick) Add(i, delta int) { // 1-indexed
	for ; i < len(f.t); i += i & -i {
		f.t[i] += delta
	}
}

func (f *Fenwick) PrefixSum(i int) int {
	s := 0
	for ; i > 0; i -= i & -i {
		s += f.t[i]
	}
	return s
}

func (f *Fenwick) RangeSum(l, r int) int { return f.PrefixSum(r) - f.PrefixSum(l-1) }
```

**Follow-ups**
- Extend the Fenwick tree to support range updates.
- When would a segment tree be the better choice?

---

#### 4. Given an array of integers and a target, find the minimum-length contiguous subarray with sum >= target. Why does the variable-size sliding window work here but not for arrays with negatives?

*Difficulty:* 🟡 medium  ·  *Tags:* `sliding-window`, `arrays`, `monotonic-deque`

With non-negative values, growing the window monotonically increases the sum and shrinking decreases it, so a two-pointer window is correct: expand `right` until the sum reaches the target, then shrink `left` to find the minimal valid window, recording the best length. O(n) time, O(1) space. The monotonicity assumption breaks with negatives: shrinking the window might *increase* the sum, so you can no longer greedily contract. For arrays with negatives you fall back to prefix sums plus a monotonic deque (for 'sum >= target' shortest subarray) achieving O(n), or a sorted structure for O(n log n). Edge cases: no subarray qualifies (return 0), single element equal to target, and overflow on the running sum.

**Key points**
- Window correctness relies on non-negativity (monotonic sum)
- Expand to reach target, contract to minimize
- Negatives require prefix sums + monotonic deque
- Return 0 when no window qualifies


```go
func minSubArrayLen(target int, nums []int) int {
	best := len(nums) + 1
	sum, left := 0, 0
	for right, v := range nums {
		sum += v
		for sum >= target {
			if w := right - left + 1; w < best {
				best = w
			}
			sum -= nums[left]
			left++
		}
	}
	if best == len(nums)+1 {
		return 0
	}
	return best
}
```

**Follow-ups**
- How would you solve it with negatives present?
- What if you needed the subarray itself, not just its length?

---

## Hash Maps & Sets

#### 5. Solve classic Two Sum (unsorted) in one pass. Explain why a single map suffices and discuss Go map performance characteristics.

*Difficulty:* 🟢 warm-up  ·  *Tags:* `hash-map`, `two-sum`, `arrays`

Iterate once, and for each value `v` check whether `target - v` was already seen; if so you have your pair, otherwise record `v -> index`. One pass works because the complement of any second element of a valid pair must have appeared earlier. O(n) time, O(n) space. In Go, `map[int]int` lookups are amortized O(1) but carry constant-factor overhead (hashing, bucket chasing, possible growth/rehash). For hot paths, pre-sizing with `make(map[K]V, n)` avoids incremental rehashing. Edge cases: duplicate values that form the pair (handled because we check before inserting), and no solution (return sentinel). For huge n, map memory and GC pressure can dominate — sometimes sorting + two pointers is faster despite higher asymptotic cost.

**Key points**
- Check complement before inserting to handle dupes
- O(n)/O(n); single map suffices in one pass
- Pre-size maps with make(map, n) to cut rehashing
- Map constant factors can lose to sort+two-pointers


```go
func twoSum(nums []int, target int) (int, int) {
	seen := make(map[int]int, len(nums))
	for i, v := range nums {
		if j, ok := seen[target-v]; ok {
			return j, i
		}
		seen[v] = i
	}
	return -1, -1
}
```

**Follow-ups**
- How do you return all pairs, including duplicates?
- When is sorting + two pointers preferable to a map here?

---

#### 6. Group anagrams together. Compare the sorted-key approach vs a frequency-count key, and discuss the tradeoff.

*Difficulty:* 🟡 medium  ·  *Tags:* `hash-map`, `strings`, `anagrams`

Two canonicalization strategies map anagrams to the same key. (1) Sort each string's characters: key is O(k log k) per word, simple and readable. (2) Count character frequencies into a fixed 26-slot (or 256) signature: O(k) per word, faster for long strings but requires building a stable key (e.g. a string of counts). Total time is O(n*k log k) or O(n*k); space O(n*k). In Go, the frequency key is built by formatting a [26]int into a string so it's comparable as a map key. Edge cases: empty strings (group together), Unicode (26-slot fails — use a rune frequency map), and case sensitivity. The frequency approach scales better as word length grows; sorting wins on brevity for short tokens.

**Key points**
- Sorted key: O(k log k); count key: O(k) per word
- Build a comparable key from the frequency array
- Unicode breaks the fixed-26 assumption
- Frequency scales better for long strings


```go
func groupAnagrams(strs []string) [][]string {
	groups := make(map[[26]int][]string)
	for _, s := range strs {
		var key [26]int
		for i := 0; i < len(s); i++ {
			key[s[i]-'a']++
		}
		groups[key] = append(groups[key], s)
	}
	out := make([][]string, 0, len(groups))
	for _, g := range groups {
		out = append(out, g)
	}
	return out
}
```

**Follow-ups**
- How do you support arbitrary Unicode input?
- Could you stream this over a billion words that don't fit in memory?

---

#### 7. Design an LRU cache with O(1) get and put. Implement it in Go using a map plus a doubly linked list, and explain the invariants.

*Difficulty:* 🟠 hard  ·  *Tags:* `lru-cache`, `hash-map`, `linked-list`, `design`

An LRU cache needs O(1) lookup (a hash map keyed by the cache key) and O(1) recency reordering (a doubly linked list where the front is most-recently-used and the back is the eviction candidate). The map stores key -> *node so we can splice a node to the front in constant time on access; on insertion past capacity we evict the tail. Sentinel head/tail nodes remove edge-case branching for empty-list and boundary operations. Invariants: map size equals list length; every map value points to a live list node; the tail's prev is always the least-recently-used real node. Edge cases: updating an existing key (move to front, overwrite value, no eviction), capacity of zero, and concurrent access — this structure is not goroutine-safe, so wrap with a sync.Mutex or shard for production. Go's container/list provides this, but a hand-rolled version avoids interface{} boxing.

**Key points**
- Map for O(1) lookup + doubly linked list for O(1) reorder
- Front = MRU, back = eviction target
- Sentinel head/tail eliminate nil-edge branches
- Not thread-safe: add a mutex or shard for concurrency


```go
type node struct {
	key, val   int
	prev, next *node
}

type LRUCache struct {
	cap        int
	m          map[int]*node
	head, tail *node // sentinels
}

func Constructor(capacity int) LRUCache {
	h, t := &node{}, &node{}
	h.next, t.prev = t, h
	return LRUCache{cap: capacity, m: make(map[int]*node, capacity), head: h, tail: t}
}

func (c *LRUCache) remove(n *node) {
	n.prev.next = n.next
	n.next.prev = n.prev
}

func (c *LRUCache) pushFront(n *node) {
	n.prev, n.next = c.head, c.head.next
	c.head.next.prev = n
	c.head.next = n
}

func (c *LRUCache) Get(key int) int {
	n, ok := c.m[key]
	if !ok {
		return -1
	}
	c.remove(n)
	c.pushFront(n)
	return n.val
}

func (c *LRUCache) Put(key, value int) {
	if n, ok := c.m[key]; ok {
		n.val = value
		c.remove(n)
		c.pushFront(n)
		return
	}
	if len(c.m) == c.cap {
		lru := c.tail.prev
		c.remove(lru)
		delete(c.m, lru.key)
	}
	n := &node{key: key, val: value}
	c.pushFront(n)
	c.m[key] = n
}
```

**Follow-ups**
- Make it thread-safe with minimal contention — sharding vs a single mutex?
- How would you extend this to LFU, or to a TTL-based eviction?

---

#### 8. How would you deduplicate a 100 GB stream of records that doesn't fit in memory? Discuss exact vs probabilistic approaches.

*Difficulty:* 🔴 staff  ·  *Tags:* `hash-set`, `dedup`, `bloom-filter`, `system-design`

Exact dedup needs to remember every key seen, which a single machine's RAM can't hold at 100 GB. Options: (1) External sort then linear scan removing adjacent duplicates — O(n log n) IO-bound, exact, but expensive. (2) Disk-backed hashing: partition by hash(key) % B into B files small enough to fit, dedup each shard in memory — exact, embarrassingly parallel, and the standard MapReduce shuffle. (3) Probabilistic: a Bloom or Cuckoo filter gives O(1) membership with a tunable false-positive rate and tiny memory; you accept that a small fraction of duplicates slip through (or vice versa for Cuckoo with deletes). The choice is a correctness-vs-cost tradeoff: use partitioned exact dedup when correctness is mandatory, a Bloom filter as a cheap pre-filter to skip definite-new records before an exact check. Watch hot keys causing skewed partitions and pick a good hash to spread load.

**Key points**
- Partition by hash into RAM-sized shards (MapReduce shuffle)
- External sort + linear scan is exact but IO-heavy
- Bloom/Cuckoo filters trade exactness for tiny memory
- Mind partition skew from hot keys

**Follow-ups**
- Size a Bloom filter for 10B keys at 0.1% false positives.
- How do deletions change your structure choice?

---

## Stacks & Queues

#### 9. Solve Next Greater Element using a monotonic stack. Explain the amortized O(n) argument.

*Difficulty:* 🟡 medium  ·  *Tags:* `monotonic-stack`, `stack`, `arrays`

Keep a stack of indices whose next-greater element hasn't been found yet, maintaining a decreasing-value invariant. For each new element, pop every stacked index whose value is smaller — the current element is their answer — then push the current index. Each index is pushed once and popped at most once, so despite the inner while loop the total work is O(n) amortized, with O(n) space. Edge cases: elements with no greater element to the right (default to -1), duplicates (decide strict vs non-strict greater), and circular arrays (iterate 2n with modulo indexing). The monotonic-stack pattern generalizes to next-smaller, previous-greater, stock-span, and largest-rectangle-in-histogram by flipping the comparison and what you record.

**Key points**
- Stack holds indices awaiting their next-greater element
- Decreasing-value invariant; pop when current is larger
- Each index pushed/popped once -> amortized O(n)
- Generalizes to histogram, stock-span, circular arrays


```go
func nextGreaterElements(nums []int) []int {
	n := len(nums)
	res := make([]int, n)
	for i := range res {
		res[i] = -1
	}
	stack := make([]int, 0, n) // indices, decreasing values
	for i, v := range nums {
		for len(stack) > 0 && nums[stack[len(stack)-1]] < v {
			top := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			res[top] = v
		}
		stack = append(stack, i)
	}
	return res
}
```

**Follow-ups**
- Adapt this for a circular array.
- How does the same pattern solve largest rectangle in a histogram?

---

#### 10. Design a min-stack: push, pop, top, and getMin all in O(1). Compare the auxiliary-stack vs encoded-value approaches.

*Difficulty:* 🟡 medium  ·  *Tags:* `stack`, `min-stack`, `design`

The minimum can change on every push/pop, so you must track historical minima. (1) Auxiliary stack: alongside the main stack, push the running minimum (min of incoming value and current top of the aux stack) on every push, and pop both together. Clean and O(n) extra space. A space optimization only pushes to the aux stack when a new value is <= current min. (2) Encoded single stack: store deltas relative to the current min (`value - min`); a negative delta signals a min change and lets you recover the previous min on pop, using O(1) extra space but trickier and prone to overflow with large ints. All operations are O(1). Edge cases: pop/top on empty (panic or return error), equal minimums (use <= so duplicates pop correctly), and overflow in the encoded variant.

**Key points**
- Track historical minima, not just the current one
- Aux-stack approach: simple, O(n) extra space
- Delta-encoding: O(1) extra space, overflow-prone
- Use <= so duplicate minimums are handled on pop


```go
type MinStack struct {
	data []int
	mins []int
}

func NewMinStack() *MinStack { return &MinStack{} }

func (s *MinStack) Push(x int) {
	s.data = append(s.data, x)
	if len(s.mins) == 0 || x <= s.mins[len(s.mins)-1] {
		s.mins = append(s.mins, x)
	} else {
		s.mins = append(s.mins, s.mins[len(s.mins)-1])
	}
}

func (s *MinStack) Pop() {
	s.data = s.data[:len(s.data)-1]
	s.mins = s.mins[:len(s.mins)-1]
}

func (s *MinStack) Top() int { return s.data[len(s.data)-1] }

func (s *MinStack) GetMin() int { return s.mins[len(s.mins)-1] }
```

**Follow-ups**
- Reduce the auxiliary space to push only on min changes.
- Extend to a min-queue supporting getMin in O(1) amortized.

---

#### 11. Implement a queue using two stacks. What are the amortized complexities and why?

*Difficulty:* 🟡 medium  ·  *Tags:* `queue`, `stack`, `amortized`, `design`

Use an `in` stack for enqueues and an `out` stack for dequeues. Enqueue pushes onto `in` in O(1). Dequeue pops from `out`; if `out` is empty, transfer everything from `in` to `out` (reversing order so the oldest element surfaces) then pop. Each element is moved between stacks at most once over its lifetime, so although a single dequeue can cost O(n), the amortized cost per operation is O(1). Space is O(n). Edge cases: dequeue/peek on an empty queue (signal underflow), and peek must also trigger the transfer. This pattern shows up when you can only use LIFO primitives (e.g. layering a FIFO over a stack-based API). The mirror trick — two queues for a stack — exists but is less efficient (O(n) per push or pop).

**Key points**
- in-stack for enqueue, out-stack for dequeue
- Lazy transfer only when out is empty
- Amortized O(1) — each element moves at most once
- Single dequeue can spike to O(n) worst case


```go
type Queue struct {
	in, out []int
}

func (q *Queue) Enqueue(x int) { q.in = append(q.in, x) }

func (q *Queue) transfer() {
	if len(q.out) == 0 {
		for len(q.in) > 0 {
			q.out = append(q.out, q.in[len(q.in)-1])
			q.in = q.in[:len(q.in)-1]
		}
	}
}

func (q *Queue) Dequeue() (int, bool) {
	q.transfer()
	if len(q.out) == 0 {
		return 0, false
	}
	x := q.out[len(q.out)-1]
	q.out = q.out[:len(q.out)-1]
	return x, true
}
```

**Follow-ups**
- Why is implementing a stack with two queues less efficient?
- How would you make this concurrent-safe with minimal locking?

---

## Linked Lists

#### 12. Reverse a singly linked list iteratively and recursively. Discuss the space tradeoff.

*Difficulty:* 🟢 warm-up  ·  *Tags:* `linked-list`, `reversal`, `pointers`

Iterative reversal walks the list once, re-pointing each node's `next` to its predecessor using three pointers (prev, curr, next). O(n) time, O(1) space — the senior default. The recursive version reverses the tail then fixes the link, also O(n) time but O(n) stack space, which risks a stack overflow on very long lists (Go has growable goroutine stacks but they're not infinite). Edge cases: empty list and single node (return as-is), and preserving the original head as the new tail. The pointer-rewiring discipline here is the foundation for harder problems (reverse in k-groups, palindrome check, reorder list), so being fluent and bug-free matters more than cleverness.

**Key points**
- Iterative: 3 pointers, O(n) time, O(1) space
- Recursive: O(n) stack, risk of overflow on long lists
- Handle empty and single-node lists
- Foundational for k-group reverse, palindrome, reorder


```go
type ListNode struct {
	Val  int
	Next *ListNode
}

func reverseList(head *ListNode) *ListNode {
	var prev *ListNode
	for head != nil {
		next := head.Next
		head.Next = prev
		prev = head
		head = next
	}
	return prev
}
```

**Follow-ups**
- Reverse only nodes between positions m and n.
- Reverse the list in groups of k.

---

#### 13. Detect a cycle in a linked list and return the node where it begins. Explain Floyd's algorithm and why the meeting-point math works.

*Difficulty:* 🟡 medium  ·  *Tags:* `linked-list`, `floyd`, `two-pointers`, `cycle-detection`

Floyd's tortoise-and-hare advances a slow pointer by one and a fast pointer by two. If there's a cycle, fast eventually laps slow and they meet inside the loop; if fast hits nil there's no cycle. To find the cycle entry, reset one pointer to the head and advance both one step at a time — they meet at the entry. The math: let the distance to the loop start be `a`, the meeting point be `b` into the loop of length `c`. When they meet, slow has gone `a+b`, fast `a+b+kc`, and fast moved twice as far, giving `a = (k-1)c + (c-b)`, i.e. the head-to-entry distance equals the meeting-point-to-entry distance modulo the loop length. O(n) time, O(1) space — beating a hash-set's O(n) space. Edge cases: empty list, single node with/without self-loop, and a cycle covering the whole list.

**Key points**
- Slow x1, fast x2; meet inside the loop if one exists
- Reset to head, step both by one to find entry
- a = (k-1)c + (c-b) justifies the entry reset
- O(n) time, O(1) space vs hash-set O(n) space


```go
func detectCycle(head *ListNode) *ListNode {
	slow, fast := head, head
	for fast != nil && fast.Next != nil {
		slow = slow.Next
		fast = fast.Next.Next
		if slow == fast {
			p := head
			for p != slow {
				p = p.Next
				slow = slow.Next
			}
			return p
		}
	}
	return nil
}
```

**Follow-ups**
- Return the length of the cycle.
- How does this generalize to finding a duplicate number in an array?

---

#### 14. Merge k sorted linked lists. Compare the min-heap approach with divide-and-conquer pairwise merging.

*Difficulty:* 🟠 hard  ·  *Tags:* `linked-list`, `heap`, `divide-and-conquer`, `merge`

Two efficient approaches both achieve O(N log k) where N is total nodes and k is list count. (1) Min-heap: push the head of each list, repeatedly pop the smallest and push its successor. Heap size stays k, so each of N pops/pushes costs O(log k). Go's container/heap fits perfectly. (2) Divide-and-conquer: pairwise-merge lists (merge two sorted lists is O(n)), halving the count each round over log k rounds, same total but O(1) extra space (vs O(k) for the heap) and no heap overhead — often faster in practice. The naive 'merge one at a time' is O(Nk). Edge cases: empty input, lists containing nil, and a single list. Heap shines when k is large or lists stream in; D&C shines for fixed k in memory.

**Key points**
- Both O(N log k); naive sequential merge is O(Nk)
- Heap: size k, O(log k) per node via container/heap
- Divide-and-conquer: O(1) extra space, less overhead
- Handle nil lists and single-list inputs


```go
import "container/heap"

type nodeHeap []*ListNode

func (h nodeHeap) Len() int            { return len(h) }
func (h nodeHeap) Less(i, j int) bool  { return h[i].Val < h[j].Val }
func (h nodeHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *nodeHeap) Push(x interface{}) { *h = append(*h, x.(*ListNode)) }
func (h *nodeHeap) Pop() interface{} {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[:n-1]
	return x
}

func mergeKLists(lists []*ListNode) *ListNode {
	h := &nodeHeap{}
	for _, l := range lists {
		if l != nil {
			heap.Push(h, l)
		}
	}
	dummy := &ListNode{}
	tail := dummy
	for h.Len() > 0 {
		n := heap.Pop(h).(*ListNode)
		tail.Next = n
		tail = n
		if n.Next != nil {
			heap.Push(h, n.Next)
		}
	}
	return dummy.Next
}
```

**Follow-ups**
- Implement the divide-and-conquer version and compare benchmarks.
- How would you merge k sorted streams that don't fit in memory?

---

## Trees

#### 15. Produce a binary tree level-order traversal. Contrast BFS with a queue against DFS with depth tracking.

*Difficulty:* 🟢 warm-up  ·  *Tags:* `tree`, `bfs`, `traversal`

Level order is naturally BFS: enqueue the root, then for each level dequeue exactly the current level's count of nodes, collect their values, and enqueue their children. Tracking the per-level size lets you group output into rows. O(n) time, O(w) space where w is the max width (up to n/2 for a balanced tree). DFS can also produce level order if you pass the depth down and append to `result[depth]`, using O(h) recursion stack — better space when the tree is wide but deep recursion risks overflow on a skewed tree. Edge cases: empty tree (return empty), single node, and severely unbalanced trees where BFS width vs DFS depth tradeoffs flip. BFS is the idiomatic choice and extends to zigzag, right-side-view, and level averages.

**Key points**
- BFS: dequeue exactly level-size nodes per row
- Space O(w) for BFS vs O(h) for DFS
- DFS needs depth-indexed result buckets
- Extends to zigzag, right-view, level averages


```go
type TreeNode struct {
	Val         int
	Left, Right *TreeNode
}

func levelOrder(root *TreeNode) [][]int {
	if root == nil {
		return nil
	}
	var res [][]int
	queue := []*TreeNode{root}
	for len(queue) > 0 {
		n := len(queue)
		level := make([]int, 0, n)
		for i := 0; i < n; i++ {
			node := queue[0]
			queue = queue[1:]
			level = append(level, node.Val)
			if node.Left != nil {
				queue = append(queue, node.Left)
			}
			if node.Right != nil {
				queue = append(queue, node.Right)
			}
		}
		res = append(res, level)
	}
	return res
}
```

**Follow-ups**
- Produce a zigzag (boustrophedon) level order.
- Return the right-side view of the tree.

---

#### 16. Validate whether a binary tree is a valid BST. Explain why checking left.val < node.val < right.val locally is wrong.

*Difficulty:* 🟡 medium  ·  *Tags:* `tree`, `bst`, `dfs`, `validation`

A common bug is only comparing each node to its immediate children — that misses violations deeper in the tree (a value valid for its parent can break an ancestor's constraint). The correct approach threads a valid (low, high) range down the recursion: the left subtree must be < node and the right subtree > node, narrowing the bounds as you descend. Equivalently, an in-order traversal of a BST yields strictly increasing values, so you can validate by checking each in-order successor exceeds the previous. Both are O(n) time; recursion uses O(h) stack, in-order can be O(1) extra with Morris traversal. Edge cases: duplicate values (decide strict vs allowing equal), single node (valid), and integer bounds — using pointer/nil sentinels avoids the MinInt/MaxInt boundary trap that breaks on extreme node values.

**Key points**
- Local parent-child checks miss ancestor violations
- Thread a (low, high) bound down the recursion
- In-order traversal must be strictly increasing
- Use nil bounds to avoid MinInt/MaxInt edge bugs


```go
func isValidBST(root *TreeNode) bool {
	var check func(n *TreeNode, low, high *int) bool
	check = func(n *TreeNode, low, high *int) bool {
		if n == nil {
			return true
		}
		if low != nil && n.Val <= *low {
			return false
		}
		if high != nil && n.Val >= *high {
			return false
		}
		return check(n.Left, low, &n.Val) && check(n.Right, &n.Val, high)
	}
	return check(root, nil, nil)
}
```

**Follow-ups**
- Modify it to allow duplicate keys in the right subtree.
- Recover a BST where exactly two nodes were swapped.

---

#### 17. Find the lowest common ancestor of two nodes — first in a general binary tree, then optimize for a BST.

*Difficulty:* 🟡 medium  ·  *Tags:* `tree`, `bst`, `lca`, `recursion`

General binary tree: recurse; if the current node is one of the targets, return it; otherwise recurse left and right. If both sides return non-nil, the current node is the LCA (the split point); if only one side does, propagate it up. O(n) time, O(h) stack. For a BST you exploit ordering: from the root, if both targets are smaller go left, if both larger go right, otherwise the current node is the split point and thus the LCA — O(h) time, O(1) iterative space. Edge cases: one node being an ancestor of the other (it is the LCA), nodes not present in the tree (the general version may return a false positive, so validate presence if needed), and the root itself being the LCA. The BST optimization is the senior signal: recognize structure and drop from O(n) to O(h).

**Key points**
- General tree: split point where both subtrees return a target
- BST: walk down comparing values, O(h) time, O(1) space
- Ancestor-of-each-other case returns the ancestor itself
- Validate node presence if it isn't guaranteed


```go
func lowestCommonAncestorBST(root, p, q *TreeNode) *TreeNode {
	for root != nil {
		switch {
		case p.Val < root.Val && q.Val < root.Val:
			root = root.Left
		case p.Val > root.Val && q.Val > root.Val:
			root = root.Right
		default:
			return root
		}
	}
	return nil
}
```

**Follow-ups**
- Solve LCA when nodes carry parent pointers.
- How do you answer many LCA queries offline (Tarjan / binary lifting)?

---

#### 18. Serialize and deserialize a binary tree. What format choices matter and how do you handle nulls?

*Difficulty:* 🟠 hard  ·  *Tags:* `tree`, `serialization`, `dfs`, `design`

Pick a traversal that uniquely reconstructs the tree. Pre-order with explicit null markers works for any binary tree: emit each value, and a sentinel (e.g. '#') for nil children. Deserialization consumes tokens in the same pre-order, recursively building left then right, stopping at sentinels. Both directions are O(n) time and O(n) space. Level-order/BFS serialization is also common (LeetCode style). Without null markers you'd need two traversals (e.g. in-order + pre-order) and they fail with duplicate values. Format concerns: a clear delimiter, escaping if values can contain it, and compactness (BFS can omit trailing nulls). Edge cases: empty tree (serialize to a single sentinel), single node, and very deep trees (recursion depth — consider an explicit stack). This question probes parsing discipline and unambiguous encoding, not cleverness.

**Key points**
- Pre-order + null sentinels uniquely reconstructs any tree
- Deserialize consumes the same token stream recursively
- Two-traversal encodings break on duplicate values
- Choose delimiters/escaping; handle empty and deep trees


```go
import (
	"strconv"
	"strings"
)

func serialize(root *TreeNode) string {
	var sb strings.Builder
	var dfs func(n *TreeNode)
	dfs = func(n *TreeNode) {
		if n == nil {
			sb.WriteString("#,")
			return
		}
		sb.WriteString(strconv.Itoa(n.Val))
		sb.WriteByte(',')
		dfs(n.Left)
		dfs(n.Right)
	}
	dfs(root)
	return sb.String()
}

func deserialize(data string) *TreeNode {
	tokens := strings.Split(strings.TrimSuffix(data, ","), ",")
	i := 0
	var build func() *TreeNode
	build = func() *TreeNode {
		tok := tokens[i]
		i++
		if tok == "#" {
			return nil
		}
		v, _ := strconv.Atoi(tok)
		n := &TreeNode{Val: v}
		n.Left = build()
		n.Right = build()
		return n
	}
	return build()
}
```

**Follow-ups**
- Make the format robust to negative numbers and large values.
- Switch to a BFS encoding that omits trailing nulls.

---

#### 19. Implement a trie (prefix tree) supporting insert, search, and startsWith. Where do tries win over hash maps in real backends?

*Difficulty:* 🟡 medium  ·  *Tags:* `trie`, `tree`, `strings`, `prefix`

A trie stores strings character-by-character along paths from the root; each node holds child links and an `isEnd` flag. Insert/search/startsWith are O(L) in the key length L, independent of how many keys are stored — a hash map is also ~O(L) to hash but can't answer prefix queries. Tries win for prefix-heavy workloads: autocomplete, longest-prefix-match in IP routing, dictionary/spellcheck, and ordered iteration of keys sharing a prefix. The cost is memory: a 26-child array per node wastes space on sparse alphabets, so production tries use maps, compressed/Patricia tries, or ternary search trees. Edge cases: empty string keys, distinguishing 'word exists' from 'prefix exists' (the isEnd flag), and case/Unicode normalization. For backend systems the prefix and ordered-range capabilities are the real differentiator.

**Key points**
- O(L) ops independent of key count; supports prefix queries
- Beats maps for autocomplete, routing, ordered prefixes
- Memory-heavy: use maps, Patricia, or ternary tries
- isEnd flag separates whole-word from prefix matches


```go
type Trie struct {
	children [26]*Trie
	isEnd    bool
}

func NewTrie() *Trie { return &Trie{} }

func (t *Trie) Insert(word string) {
	node := t
	for i := 0; i < len(word); i++ {
		c := word[i] - 'a'
		if node.children[c] == nil {
			node.children[c] = &Trie{}
		}
		node = node.children[c]
	}
	node.isEnd = true
}

func (t *Trie) find(word string) *Trie {
	node := t
	for i := 0; i < len(word); i++ {
		c := word[i] - 'a'
		if node.children[c] == nil {
			return nil
		}
		node = node.children[c]
	}
	return node
}

func (t *Trie) Search(word string) bool {
	n := t.find(word)
	return n != nil && n.isEnd
}

func (t *Trie) StartsWith(prefix string) bool {
	return t.find(prefix) != nil
}
```

**Follow-ups**
- Add wildcard '.' matching for any character.
- How would you compress a sparse trie for memory savings?

---

## Heaps & Priority Queues

#### 20. Find the top K frequent elements. Compare a min-heap of size K against quickselect, and show idiomatic container/heap use in Go.

*Difficulty:* 🟡 medium  ·  *Tags:* `heap`, `top-k`, `quickselect`, `container/heap`

Count frequencies in a map (O(n)). Then either (1) maintain a min-heap of size K over (value, count): push each entry, and when the heap exceeds K pop the smallest — total O(n log K), great when K << n and for streaming; or (2) quickselect on the distinct entries to partition the top K around the K-th frequency, O(n) average but O(n^2) worst case and it mutates a slice. Bucket sort by frequency is O(n) when counts are bounded by n. In Go, container/heap requires implementing heap.Interface (Len/Less/Swap/Push/Pop); the min-heap variant keeps memory at O(K). Edge cases: ties at the K-th frequency (problem-defined), K >= number of distinct elements, and empty input. Senior framing: pick the heap for streaming/large n with small K, quickselect for one-shot in-memory.

**Key points**
- Min-heap of size K: O(n log K), ideal for streaming
- Quickselect: O(n) average, O(n^2) worst, mutates slice
- Bucket sort by frequency: O(n) when counts bounded
- container/heap needs Len/Less/Swap/Push/Pop


```go
import "container/heap"

type pair struct {
	val, count int
}

type minHeap []pair

func (h minHeap) Len() int            { return len(h) }
func (h minHeap) Less(i, j int) bool  { return h[i].count < h[j].count }
func (h minHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *minHeap) Push(x interface{}) { *h = append(*h, x.(pair)) }
func (h *minHeap) Pop() interface{} {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[:n-1]
	return x
}

func topKFrequent(nums []int, k int) []int {
	freq := make(map[int]int)
	for _, v := range nums {
		freq[v]++
	}
	h := &minHeap{}
	for v, c := range freq {
		heap.Push(h, pair{v, c})
		if h.Len() > k {
			heap.Pop(h)
		}
	}
	res := make([]int, h.Len())
	for i := len(res) - 1; i >= 0; i-- {
		res[i] = heap.Pop(h).(pair).val
	}
	return res
}
```

**Follow-ups**
- Make it work as a streaming top-K with bounded memory.
- When is bucket sort by frequency the best choice?

---

#### 21. Design a data structure that returns the median of a stream of numbers. Explain the two-heap balance invariant.

*Difficulty:* 🟠 hard  ·  *Tags:* `heap`, `median`, `streaming`, `design`

Maintain two heaps: a max-heap `lo` for the smaller half and a min-heap `hi` for the larger half. Invariant: every element in `lo` <= every element in `hi`, and their sizes differ by at most one. On insert, push to the appropriate heap then rebalance by moving the top across if sizes diverge. The median is the top of the larger heap, or the average of both tops when sizes are equal. addNum is O(log n); findMedian is O(1). Go has only a min-heap primitive, so the max-heap is a min-heap on negated values (or a Less that inverts). Edge cases: the very first element, even vs odd counts, and integer overflow when averaging two large tops (compute as lo+(hi-lo)/2 or use float). For windowed/streaming-with-removal medians you'd switch to an indexed structure or a balanced BST / order-statistic tree.

**Key points**
- Max-heap (low half) + min-heap (high half)
- Balance: |size(lo) - size(hi)| <= 1, lo.max <= hi.min
- addNum O(log n), findMedian O(1)
- Go max-heap = min-heap on negated values


```go
import "container/heap"

type intHeap struct {
	data []int
	max  bool
}

func (h intHeap) Len() int { return len(h.data) }
func (h intHeap) Less(i, j int) bool {
	if h.max {
		return h.data[i] > h.data[j]
	}
	return h.data[i] < h.data[j]
}
func (h intHeap) Swap(i, j int)       { h.data[i], h.data[j] = h.data[j], h.data[i] }
func (h *intHeap) Push(x interface{}) { h.data = append(h.data, x.(int)) }
func (h *intHeap) Pop() interface{} {
	n := len(h.data)
	x := h.data[n-1]
	h.data = h.data[:n-1]
	return x
}

type MedianFinder struct {
	lo, hi *intHeap // lo is max-heap, hi is min-heap
}

func NewMedianFinder() *MedianFinder {
	return &MedianFinder{lo: &intHeap{max: true}, hi: &intHeap{}}
}

func (m *MedianFinder) AddNum(num int) {
	heap.Push(m.lo, num)
	heap.Push(m.hi, heap.Pop(m.lo))
	if m.hi.Len() > m.lo.Len() {
		heap.Push(m.lo, heap.Pop(m.hi))
	}
}

func (m *MedianFinder) FindMedian() float64 {
	if m.lo.Len() > m.hi.Len() {
		return float64(m.lo.data[0])
	}
	return (float64(m.lo.data[0]) + float64(m.hi.data[0])) / 2
}
```

**Follow-ups**
- Support a sliding-window median (with removals).
- What if 99% of values fall in a known small range?

---

## Graphs

#### 22. Implement topological sort for a DAG. Compare Kahn's algorithm with DFS-based ordering and explain cycle detection.

*Difficulty:* 🟡 medium  ·  *Tags:* `graph`, `topological-sort`, `bfs`, `dfs`, `cycle-detection`

Topological sort linearizes a DAG so every edge points forward. Kahn's algorithm (BFS): compute in-degrees, enqueue all zero-in-degree nodes, repeatedly dequeue a node, append it to the order, and decrement neighbors' in-degrees, enqueuing any that hit zero. If the output count is less than the node count, a cycle exists. DFS approach: post-order DFS pushing nodes onto a stack after exploring descendants, then reverse; detect cycles via a three-color (white/gray/black) marking — encountering a gray node means a back edge, i.e. a cycle. Both are O(V+E) time and space. Edge cases: disconnected components (Kahn handles naturally), self-loops (immediate cycle), and multiple valid orderings. This underpins build systems, task scheduling, and dependency resolution — frame it as 'compile order' or 'package install order' to show applied judgment.

**Key points**
- Kahn: in-degree BFS; short output => cycle
- DFS: reverse post-order + gray-node back-edge detection
- Both O(V+E); multiple valid orders possible
- Applies to build/task scheduling and dep resolution


```go
func topoSort(numNodes int, edges [][]int) ([]int, bool) {
	adj := make([][]int, numNodes)
	indeg := make([]int, numNodes)
	for _, e := range edges { // e = [from, to]
		adj[e[0]] = append(adj[e[0]], e[1])
		indeg[e[1]]++
	}
	queue := make([]int, 0)
	for v := 0; v < numNodes; v++ {
		if indeg[v] == 0 {
			queue = append(queue, v)
		}
	}
	order := make([]int, 0, numNodes)
	for len(queue) > 0 {
		v := queue[0]
		queue = queue[1:]
		order = append(order, v)
		for _, w := range adj[v] {
			indeg[w]--
			if indeg[w] == 0 {
				queue = append(queue, w)
			}
		}
	}
	return order, len(order) == numNodes // false => cycle
}
```

**Follow-ups**
- Return the actual cycle when one exists.
- How would you produce the lexicographically smallest topological order?

---

#### 23. Implement Dijkstra's shortest path with a priority queue. Why does it fail on negative edges, and what do you use instead?

*Difficulty:* 🟠 hard  ·  *Tags:* `graph`, `dijkstra`, `shortest-path`, `heap`

Dijkstra greedily finalizes the closest unvisited node. Push the source with distance 0 into a min-heap keyed by distance; repeatedly pop the smallest, and relax its outgoing edges (if dist[u]+w < dist[v], update and push). Using a binary heap gives O((V+E) log V). The greedy correctness relies on non-negative edges: once a node is popped its distance is final because no later path can be shorter. Negative edges break this — a cheaper path may arrive after a node is finalized — so use Bellman-Ford (O(VE), also detects negative cycles) or, for all-pairs, Floyd-Warshall (O(V^3)). With negative edges but no negative cycles and many queries, Johnson's algorithm reweights then runs Dijkstra. Edge cases: unreachable nodes (distance stays infinity), the lazy-deletion pattern (skip stale heap entries), and overflow in distance sums. Mention a Fibonacci heap reduces to O(E + V log V) in theory.

**Key points**
- Greedy finalization needs non-negative edges
- Binary-heap Dijkstra: O((V+E) log V)
- Negatives -> Bellman-Ford (O(VE), detects neg cycles)
- Skip stale heap entries; guard distance overflow


```go
import "container/heap"

type edge struct{ to, w int }
type item struct{ node, dist int }
type pq []item

func (p pq) Len() int            { return len(p) }
func (p pq) Less(i, j int) bool  { return p[i].dist < p[j].dist }
func (p pq) Swap(i, j int)       { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x interface{}) { *p = append(*p, x.(item)) }
func (p *pq) Pop() interface{} {
	old := *p
	n := len(old)
	x := old[n-1]
	*p = old[:n-1]
	return x
}

func dijkstra(adj [][]edge, src int) []int {
	const inf = int(1e18)
	dist := make([]int, len(adj))
	for i := range dist {
		dist[i] = inf
	}
	dist[src] = 0
	h := &pq{{src, 0}}
	for h.Len() > 0 {
		cur := heap.Pop(h).(item)
		if cur.dist > dist[cur.node] {
			continue // stale entry
		}
		for _, e := range adj[cur.node] {
			if nd := cur.dist + e.w; nd < dist[e.to] {
				dist[e.to] = nd
				heap.Push(h, item{e.to, nd})
			}
		}
	}
	return dist
}
```

**Follow-ups**
- Reconstruct the actual shortest path, not just distances.
- How does A* improve on Dijkstra for a single target?

---

#### 24. Implement union-find with path compression and union by rank. Use it to count connected components and detect a cycle in an undirected graph.

*Difficulty:* 🟡 medium  ·  *Tags:* `graph`, `union-find`, `connected-components`, `cycle-detection`

Union-find (disjoint set union) tracks a partition of elements. `find` follows parent pointers to the set root, and path compression flattens the chain by re-pointing nodes directly to the root. `union` links two roots, attaching the shorter tree under the taller via union by rank (or size). Together these give near-constant amortized O(alpha(n)) per operation, where alpha is the inverse Ackermann function — effectively a small constant. Connected components: start a counter at n and decrement on each successful union (two previously separate roots merged). Cycle detection in an undirected graph: if an edge's endpoints already share a root, adding it creates a cycle. Edge cases: self-loops (immediate cycle), parallel edges, and 1-indexed vs 0-indexed nodes. DSU shines for incremental connectivity, Kruskal's MST, and equivalence-class problems where BFS/DFS would re-scan repeatedly.

**Key points**
- Path compression + union by rank => ~O(alpha(n))
- Components = n minus successful unions
- Undirected cycle: edge endpoints already share a root
- Ideal for Kruskal MST and incremental connectivity


```go
type DSU struct {
	parent, rank []int
	count        int
}

func NewDSU(n int) *DSU {
	p := make([]int, n)
	for i := range p {
		p[i] = i
	}
	return &DSU{parent: p, rank: make([]int, n), count: n}
}

func (d *DSU) Find(x int) int {
	for d.parent[x] != x {
		d.parent[x] = d.parent[d.parent[x]] // path compression
		x = d.parent[x]
	}
	return x
}

// Union returns false if x and y were already connected (=> cycle).
func (d *DSU) Union(x, y int) bool {
	rx, ry := d.Find(x), d.Find(y)
	if rx == ry {
		return false
	}
	if d.rank[rx] < d.rank[ry] {
		rx, ry = ry, rx
	}
	d.parent[ry] = rx
	if d.rank[rx] == d.rank[ry] {
		d.rank[rx]++
	}
	d.count--
	return true
}
```

**Follow-ups**
- Use this DSU to implement Kruskal's MST.
- How would you support union-find with rollback (undo)?

---

## Recursion & Backtracking

#### 25. Generate all permutations of a distinct-element slice. Explain the backtracking template and the complexity.

*Difficulty:* 🟡 medium  ·  *Tags:* `backtracking`, `recursion`, `permutations`

Backtracking builds candidates incrementally and abandons a path the moment it can't lead to a valid full solution. For permutations, swap each unused element into the current position, recurse, then swap back (the undo step that defines backtracking). There are n! permutations and each takes O(n) to copy out, so total time is O(n * n!) — inherently exponential because the output itself is. Recursion depth is O(n), plus O(n!) for storing results. The in-place swap variant avoids an explicit 'used' set. Edge cases: empty input (one empty permutation), single element, and duplicate elements — for those, sort first and skip a value equal to its predecessor at the same recursion level to avoid duplicate permutations. The same template (choose, explore, un-choose) drives combinations, subsets, and N-queens.

**Key points**
- Choose / explore / un-choose template
- n! results, O(n*n!) total time, O(n) depth
- In-place swap avoids a used-set
- Duplicates: sort + skip equal sibling at same level


```go
func permute(nums []int) [][]int {
	var res [][]int
	var backtrack func(start int)
	backtrack = func(start int) {
		if start == len(nums) {
			perm := make([]int, len(nums))
			copy(perm, nums)
			res = append(res, perm)
			return
		}
		for i := start; i < len(nums); i++ {
			nums[start], nums[i] = nums[i], nums[start]
			backtrack(start + 1)
			nums[start], nums[i] = nums[i], nums[start]
		}
	}
	backtrack(0)
	return res
}
```

**Follow-ups**
- Handle duplicate elements without producing repeats.
- Generate the k-th permutation directly without listing all.

---

#### 26. Generate all subsets (the power set) and all combinations of size k. How do the two templates differ?

*Difficulty:* 🟡 medium  ·  *Tags:* `backtracking`, `recursion`, `subsets`, `combinations`

Subsets: at each index decide to include the element or not, or iterate a `start` index appending the running prefix at every node — there are 2^n subsets, so O(n * 2^n) time. Combinations of size k constrain the choice: only descend while there's room to still reach size k, and prune when remaining elements can't fill the slots (a powerful early cutoff). There are C(n, k) combinations. Both reuse the choose/explore/un-choose backtracking skeleton; the difference is the base case (subsets record at every node, combinations only at size k) and the pruning condition. Edge cases: empty set (the empty subset is always included), k = 0 or k = n, and duplicates (sort and skip equal siblings to dedup). The pruning `i <= n-(k-len(path))` materially cuts combination work and is the senior detail worth surfacing.

**Key points**
- Subsets: 2^n results, record at every node
- Combinations: stop at size k, prune impossible branches
- Prune with i <= n-(k-len(path)) for big speedups
- Sort + skip equal siblings to handle duplicates


```go
func combine(n, k int) [][]int {
	var res [][]int
	path := make([]int, 0, k)
	var backtrack func(start int)
	backtrack = func(start int) {
		if len(path) == k {
			c := make([]int, k)
			copy(c, path)
			res = append(res, c)
			return
		}
		// prune: need k-len(path) more, stop when not enough remain
		for i := start; i <= n-(k-len(path))+1; i++ {
			path = append(path, i)
			backtrack(i + 1)
			path = path[:len(path)-1]
		}
	}
	backtrack(1)
	return res
}
```

**Follow-ups**
- Produce the power set with duplicate elements (subsets II).
- Find combinations summing to a target with reuse allowed.

---

#### 27. Solve the N-Queens problem and count valid placements. What pruning makes it tractable and what's the complexity?

*Difficulty:* 🟠 hard  ·  *Tags:* `backtracking`, `recursion`, `n-queens`, `constraint-satisfaction`

Place one queen per row, trying each column and recursing to the next row. The key to tractability is O(1) conflict checks using three boolean/bitset sets: occupied columns, occupied '/' diagonals (row+col), and occupied '\\' diagonals (row-col, offset to stay non-negative). Mark on placement, recurse, unmark on backtrack. This prunes entire branches the instant a queen would be attacked, collapsing a naive O(n^n) search toward the actual O(n!) upper bound (still exponential, but n=12 or so is fast). Using bitmasks instead of sets makes each level a few bit operations and is the fast production form. Edge cases: n=0 or 1 (trivial), n=2 and n=3 (no solutions), and symmetry (you can halve work by fixing the first queen to the left half and mirroring). This is the canonical constraint-satisfaction backtracking interview problem.

**Key points**
- One queen per row + column/diagonal occupancy sets
- O(1) conflict checks prune branches early
- Roughly O(n!) with pruning vs naive O(n^n)
- Bitmasks make it fast; symmetry halves the work


```go
func totalNQueens(n int) int {
	count := 0
	cols := make([]bool, n)
	diag1 := make([]bool, 2*n) // row+col
	diag2 := make([]bool, 2*n) // row-col+n
	var place func(row int)
	place = func(row int) {
		if row == n {
			count++
			return
		}
		for col := 0; col < n; col++ {
			d1, d2 := row+col, row-col+n
			if cols[col] || diag1[d1] || diag2[d2] {
				continue
			}
			cols[col], diag1[d1], diag2[d2] = true, true, true
			place(row + 1)
			cols[col], diag1[d1], diag2[d2] = false, false, false
		}
	}
	place(0)
	return count
}
```

**Follow-ups**
- Rewrite the conflict checks with bitmasks for speed.
- Exploit symmetry to roughly halve the search.

---

## Dynamic Programming

#### 28. Solve coin change (minimum coins for an amount). Walk through the DP recurrence, base cases, and complexity.

*Difficulty:* 🟡 medium  ·  *Tags:* `dynamic-programming`, `coin-change`, `knapsack`

Define dp[a] = the fewest coins to make amount a. Base case dp[0] = 0; initialize the rest to infinity (a sentinel like amount+1). Transition: for each amount a, dp[a] = min over coins c <= a of dp[a-c] + 1. This unbounded-knapsack-style ordering (iterate amounts outward, coins inner) allows reusing each coin unlimited times. Time O(amount * len(coins)), space O(amount). If dp[amount] is still infinity, the amount is unreachable (return -1). Edge cases: amount 0 (answer 0), no coins, and a coin larger than the amount (skipped by the c<=a guard). A greedy 'largest coin first' is wrong for arbitrary denominations (e.g. coins {1,3,4}, amount 6 -> greedy gives 4+1+1=3, DP gives 3+3=2). Contrast with counting the number of ways, which swaps the loop order to avoid counting permutations.

**Key points**
- dp[a] = min(dp[a-c]+1); dp[0]=0, rest = infinity
- O(amount * coins) time, O(amount) space
- Unreachable => stays infinity => return -1
- Greedy fails for arbitrary denominations


```go
func coinChange(coins []int, amount int) int {
	const inf = 1 << 30
	dp := make([]int, amount+1)
	for i := 1; i <= amount; i++ {
		dp[i] = inf
	}
	for a := 1; a <= amount; a++ {
		for _, c := range coins {
			if c <= a && dp[a-c]+1 < dp[a] {
				dp[a] = dp[a-c] + 1
			}
		}
	}
	if dp[amount] >= inf {
		return -1
	}
	return dp[amount]
}
```

**Follow-ups**
- Count the number of distinct ways to make the amount.
- Reconstruct which coins were used.

---

#### 29. Solve 0/1 knapsack. Explain the 2D DP, then the rolling-array optimization and why the inner loop must go backward.

*Difficulty:* 🟠 hard  ·  *Tags:* `dynamic-programming`, `knapsack`, `space-optimization`

0/1 knapsack: maximize value with a weight capacity W, each item usable at most once. dp[i][w] = best value using the first i items within capacity w; transition is dp[i][w] = max(dp[i-1][w], dp[i-1][w-wt[i]] + val[i]) — skip or take item i. O(nW) time and space. The rolling-array optimization keeps a single 1D dp[w] and iterates w from W down to wt[i]: descending order ensures dp[w-wt[i]] still refers to the previous item's value (not the current item's), preserving the 'at most once' constraint. Iterating ascending would allow reusing an item (that's exactly the unbounded-knapsack/coin-change variant). This drops space to O(W). Edge cases: zero capacity, items heavier than W (never fit), and the pseudo-polynomial nature — O(nW) is exponential in the bit-length of W, so huge capacities need meet-in-the-middle or approximation.

**Key points**
- dp[w] = max(dp[w], dp[w-wt]+val): take or skip
- 1D rolling array drops space to O(W)
- Iterate w downward to forbid item reuse
- Pseudo-polynomial: O(nW) exponential in bits of W


```go
func knapsack01(weights, values []int, W int) int {
	dp := make([]int, W+1)
	for i := range weights {
		for w := W; w >= weights[i]; w-- { // backward => 0/1
			if cand := dp[w-weights[i]] + values[i]; cand > dp[w] {
				dp[w] = cand
			}
		}
	}
	return dp[W]
}
```

**Follow-ups**
- Change one line to make it unbounded knapsack.
- Reconstruct the chosen items from the DP table.

---

#### 30. Compute the longest common subsequence length and edit distance. How are the recurrences related?

*Difficulty:* 🟠 hard  ·  *Tags:* `dynamic-programming`, `lcs`, `edit-distance`, `strings`

Both are 2D DP over two string prefixes. LCS: dp[i][j] = length of the LCS of a[:i], b[:j]; if a[i-1]==b[j-1] then dp[i][j]=dp[i-1][j-1]+1, else max(dp[i-1][j], dp[i][j-1]). Edit distance (Levenshtein) computes min insert/delete/replace operations: dp[i][j] = dp[i-1][j-1] if characters match, else 1 + min(dp[i-1][j] delete, dp[i][j-1] insert, dp[i-1][j-1] replace), with base cases dp[i][0]=i and dp[0][j]=j. They're duals: both align two sequences character by character, one maximizing matches, the other minimizing edits. Time O(m*n), space O(m*n) reducible to O(min(m,n)) with a rolling row. Edge cases: empty strings, identical strings, and Unicode (iterate runes). For reconstructing the alignment you need the full table or Hirschberg's O(min) space backtrace. These power diff tools, spell-checkers, and bioinformatics alignment.

**Key points**
- Both 2D DP over prefixes, O(m*n) time
- LCS maximizes matches; edit distance minimizes ops
- Rolling row reduces space to O(min(m,n))
- Full table or Hirschberg needed to reconstruct alignment


```go
func editDistance(a, b string) int {
	m, n := len(a), len(b)
	dp := make([]int, n+1)
	for j := 0; j <= n; j++ {
		dp[j] = j
	}
	for i := 1; i <= m; i++ {
		prev := dp[0] // dp[i-1][j-1]
		dp[0] = i
		for j := 1; j <= n; j++ {
			tmp := dp[j]
			if a[i-1] == b[j-1] {
				dp[j] = prev
			} else {
				dp[j] = 1 + min(prev, min(dp[j], dp[j-1]))
			}
			prev = tmp
		}
	}
	return dp[n]
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
```

**Follow-ups**
- Reconstruct the actual edit operations.
- Compute LCS in O(min) space with Hirschberg's algorithm.

---

#### 31. Find the length of the longest increasing subsequence. Give the O(n^2) DP, then the O(n log n) patience-sorting solution.

*Difficulty:* 🟠 hard  ·  *Tags:* `dynamic-programming`, `lis`, `binary-search`, `patience-sorting`

O(n^2) DP: dp[i] = LIS length ending at index i = 1 + max(dp[j]) over all j < i with nums[j] < nums[i]; the answer is the maximum dp value. The O(n log n) approach uses patience sorting: maintain `tails`, where tails[k] is the smallest possible tail of an increasing subsequence of length k+1. For each value, binary-search the first tail >= it and replace it (or append if it's larger than all tails). The length of `tails` is the LIS length. Note tails is not itself a valid subsequence — only its length is meaningful; reconstructing the actual sequence needs predecessor tracking. Time O(n log n), space O(n). Use sort.SearchInts for the binary search. Edge cases: empty array (0), all-decreasing (1), and strictly vs non-decreasing (use a lower-bound vs upper-bound search). The patience-sorting insight is the senior differentiator.

**Key points**
- O(n^2): dp[i] = 1 + max(dp[j]) for nums[j] < nums[i]
- O(n log n): tails[k] = smallest tail of length k+1
- tails length is the answer; not a real subsequence
- lower vs upper bound toggles strict/non-strict


```go
import "sort"

func lengthOfLIS(nums []int) int {
	tails := make([]int, 0, len(nums))
	for _, v := range nums {
		i := sort.SearchInts(tails, v) // first tail >= v
		if i == len(tails) {
			tails = append(tails, v)
		} else {
			tails[i] = v
		}
	}
	return len(tails)
}
```

**Follow-ups**
- Reconstruct one actual longest increasing subsequence.
- Count the number of distinct LIS of maximum length.

---

## Sorting & Searching

#### 32. Compare quicksort and mergesort across time, space, stability, and cache behavior. When would you pick each?

*Difficulty:* 🟡 medium  ·  *Tags:* `sorting`, `quicksort`, `mergesort`, `complexity`

Quicksort: O(n log n) average but O(n^2) worst case (mitigated by randomized or median-of-three pivots, or introsort's heapsort fallback). It sorts in place (O(log n) stack for recursion), is cache-friendly due to sequential partitioning, and is not stable. Mergesort: guaranteed O(n log n) worst case, stable, and parallelizes cleanly, but needs O(n) extra space (less cache-friendly for arrays). Picks: quicksort for in-memory arrays where average speed and low memory matter and stability is irrelevant; mergesort when you need stability (sorting by a secondary key), worst-case guarantees, linked lists (O(1) extra space, no random access penalty), or external/streaming sorts over data that doesn't fit in RAM. Go's sort.Sort uses a pattern-defeating introsort variant; sort.Stable uses a stable in-place merge. Edge cases: already-sorted input (bad for naive quicksort pivots), many duplicates (three-way partitioning helps), and tiny arrays (insertion sort cutoff).

**Key points**
- Quicksort: in-place, cache-friendly, O(n^2) worst, unstable
- Mergesort: stable, O(n log n) guaranteed, O(n) space
- Mergesort wins for linked lists and external sorts
- Go: sort.Sort = introsort, sort.Stable = stable merge

**Follow-ups**
- How does introsort defend against the O(n^2) worst case?
- Why is mergesort the natural choice for linked lists?

---

#### 33. Explain 'binary search on the answer' and solve: given piles of bananas and h hours, find the minimum eating speed (Koko eating bananas).

*Difficulty:* 🟠 hard  ·  *Tags:* `binary-search`, `search`, `monotonic-predicate`

When the answer lies in a monotonic range — a predicate is false below some threshold and true at and above it — you can binary-search the answer space instead of the data. Define feasible(speed) = can Koko finish within h hours at this speed; it's monotone (faster speed never makes it harder). Binary-search speed in [1, max(pile)]: compute the hours needed at the mid speed (sum of ceil(pile/mid)), and move the boundary toward the smallest feasible speed. Time O(n log(maxPile)) — the log factor over the value range, not the array length. This pattern solves 'minimize the maximum', 'maximize the minimum', capacity-to-ship, and split-array problems. Edge cases: ensure the search bounds bracket the true answer, use ceiling division correctly ((pile+speed-1)/speed), and watch overflow when summing hours. The hard part is recognizing the monotone predicate, not the binary search itself.

**Key points**
- Search the answer space when a predicate is monotone
- feasible(speed): hours = sum of ceil(pile/speed) <= h
- O(n log(value range)), not O(n log n)
- Use ceiling division; bracket bounds; guard overflow


```go
func minEatingSpeed(piles []int, h int) int {
	hi := 0
	for _, p := range piles {
		if p > hi {
			hi = p
		}
	}
	feasible := func(speed int) bool {
		hours := 0
		for _, p := range piles {
			hours += (p + speed - 1) / speed // ceil
		}
		return hours <= h
	}
	lo := 1
	for lo < hi {
		mid := lo + (hi-lo)/2
		if feasible(mid) {
			hi = mid
		} else {
			lo = mid + 1
		}
	}
	return lo
}
```

**Follow-ups**
- Solve 'capacity to ship packages within D days' with the same template.
- Split an array into k subarrays minimizing the largest sum.

---

#### 34. How do you use sort.Search and sort.Slice in Go? Why is sort.Slice slower than sort.Sort, and what does Go 1.21's slices.Sort change?

*Difficulty:* 🟡 medium  ·  *Tags:* `sorting`, `go-stdlib`, `sort.Search`, `generics`, `reflection`

sort.Slice(s, less) sorts a slice given a less-func, convenient because you skip implementing sort.Interface — but it relies on reflection (reflect.Swapper) to swap elements generically, which adds per-swap overhead and prevents inlining, making it measurably slower than a concrete sort.Sort implementation whose Swap is statically typed. sort.Search(n, f) does a generic binary search returning the smallest index in [0,n) where f is true (f must be monotone false->true), useful for lower-bound queries on sorted data; sort.SearchInts is the typed convenience form. Go 1.21's generics-based slices.Sort and slices.SortFunc avoid reflection entirely, are type-specialized at compile time, and are both faster than sort.Slice and the modern idiom; slices.BinarySearch replaces sort.Search for typed slices. Senior framing: in hot paths prefer slices.Sort/SortFunc (1.21+) or a concrete sort.Interface over sort.Slice; reserve sort.Slice for cold paths where clarity beats microseconds.

**Key points**
- sort.Slice uses reflection (reflect.Swapper) => slower swaps
- sort.Sort with typed Swap avoids reflection overhead
- sort.Search: monotone false->true lower-bound binary search
- Go 1.21 slices.Sort/SortFunc are generic, faster, idiomatic


```go
import (
	"sort"
	"slices" // Go 1.21+
)

type Person struct {
	Name string
	Age  int
}

func demo(people []Person) {
	// Reflection-based, convenient but slower:
	sort.Slice(people, func(i, j int) bool { return people[i].Age < people[j].Age })

	// Go 1.21+ generic, type-specialized, faster:
	slices.SortFunc(people, func(a, b Person) int { return a.Age - b.Age })

	// Lower-bound search on a sorted []int:
	nums := []int{1, 3, 5, 7, 9}
	i := sort.Search(len(nums), func(i int) bool { return nums[i] >= 5 }) // -> 2
	_ = i

	// Generic binary search (Go 1.21+):
	idx, found := slices.BinarySearch(nums, 7) // idx=3, found=true
	_, _ = idx, found
}
```

**Follow-ups**
- Benchmark sort.Slice vs slices.SortFunc and explain the gap.
- When is implementing sort.Interface still worth the boilerplate?

---

## Complexity Analysis

#### 35. Explain amortized analysis using Go's slice append. Why is appending O(1) amortized despite occasional O(n) reallocations?

*Difficulty:* 🟡 medium  ·  *Tags:* `complexity`, `amortized`, `go-slices`, `append`

append grows a slice's backing array when capacity is exceeded by allocating a larger array (Go roughly doubles for small slices, then grows ~1.25x for large ones) and copying existing elements — a single O(n) operation. But growth is geometric, so reallocations get exponentially rarer: across n appends the total copy work is n + n/2 + n/4 + ... < 2n, i.e. O(n) total, giving O(1) amortized per append. Three analysis methods formalize this: aggregate (total cost / operations), accounting (each cheap append prepays for a future copy), and potential (a potential function smooths the spikes). The senior nuance: amortized is not worst-case — any single append can still stall for O(n), which matters for latency-sensitive paths; pre-size with make([]T, 0, n) to avoid the spikes entirely. Also note that growing reallocates, so old pointers/sub-slices into the array can become stale or alias unexpectedly.

**Key points**
- Geometric growth => total copy work is O(n) over n appends
- Amortized O(1) != worst-case O(1); single append can be O(n)
- Aggregate/accounting/potential methods formalize it
- Pre-size with make(_, 0, n) to avoid latency spikes

**Follow-ups**
- Why does Go switch from 2x to ~1.25x growth for large slices?
- How can append's reallocation cause an aliasing bug?

---

#### 36. Contrast worst-case, average-case, and amortized complexity. Give an example where they differ sharply and why the distinction matters in production.

*Difficulty:* 🟠 hard  ·  *Tags:* `complexity`, `worst-case`, `amortized`, `average-case`, `tail-latency`

Worst-case bounds the slowest any single operation can be; average-case is the expected cost over a distribution of inputs; amortized is the guaranteed average cost over a sequence of operations (no probability involved). They can diverge wildly. Hash-map lookup: O(1) average and amortized, but O(n) worst-case if every key collides — exploitable via hash-flooding DoS, which is why Go randomizes its map seed. Quicksort: O(n log n) average, O(n^2) worst (adversarial input). Dynamic-array append: O(1) amortized, O(n) single-op worst-case. The distinction matters because production cares about tail latency (p99/p999), not the mean: an amortized-O(1) structure with occasional O(n) spikes can blow an SLA even though its average is fine. For latency-critical or adversarial settings, prefer structures with strong worst-case bounds (balanced trees over hash tables, deamortized/incremental resizing) rather than relying on averages.

**Key points**
- Worst = slowest single op; average = expected over inputs
- Amortized = guaranteed average over a sequence (no probability)
- Hash map: O(1) avg/amortized, O(n) worst (hash-flooding DoS)
- Tail latency/SLA care about worst-case, not the mean

**Follow-ups**
- How does Go defend its maps against hash-flooding attacks?
- When would you deamortize a data structure to bound tail latency?

---

## Advanced Graph Algorithms

#### 37. When does Bellman-Ford beat Dijkstra, and how does it detect negative cycles? Implement it.

*Difficulty:* 🟠 hard  ·  *Tags:* `graphs`, `shortest-path`, `bellman-ford`, `negative-cycle`

Dijkstra assumes non-negative edge weights because its greedy 'settle the closest unsettled node' invariant breaks when a later, cheaper path can appear through a negative edge. Bellman-Ford handles negative edges by relaxing every edge V-1 times: after k passes, all shortest paths using at most k edges are correct, and any simple path has at most V-1 edges. A V-th pass that still relaxes some edge proves a negative cycle is reachable. Complexity O(V*E) time, O(V) space — much slower than Dijkstra's O((V+E)log V), so use it only when negative weights exist (e.g., arbitrage, profit/cost graphs). Edge cases: disconnected nodes stay at +inf; watch overflow when adding inf+weight (guard with a 'reached' check); negative cycle detection only flags cycles reachable from the source. Follow-up that turns it into a scale question: at internet scale (currency arbitrage across thousands of pairs) you'd shard the graph or use Johnson's algorithm to reweight and run Dijkstra per source.

**Key points**
- Handles negative edges; Dijkstra cannot
- Relax all edges V-1 times; V-th relaxation => negative cycle
- O(V*E) time, O(V) space
- Guard against inf+weight overflow


```go
func bellmanFord(n int, edges [][3]int, src int) ([]int, bool) {
	const inf = int(1e18)
	dist := make([]int, n)
	for i := range dist {
		dist[i] = inf
	}
	dist[src] = 0
	for i := 0; i < n-1; i++ {
		changed := false
		for _, e := range edges {
			u, v, w := e[0], e[1], e[2]
			if dist[u] != inf && dist[u]+w < dist[v] {
				dist[v] = dist[u] + w
				changed = true
			}
		}
		if !changed {
			break
		}
	}
	for _, e := range edges { // V-th pass
		u, v, w := e[0], e[1], e[2]
		if dist[u] != inf && dist[u]+w < dist[v] {
			return dist, true // negative cycle
		}
	}
	return dist, false
}
```

**Follow-ups**
- How does Johnson's algorithm combine Bellman-Ford and Dijkstra for all-pairs?
- How would you report WHICH nodes lie on a negative cycle?

---

#### 38. Explain Floyd-Warshall for all-pairs shortest paths and its DP intuition. When do you prefer it over running Dijkstra V times?

*Difficulty:* 🟠 hard  ·  *Tags:* `graphs`, `all-pairs`, `floyd-warshall`, `dynamic-programming`

Floyd-Warshall is a DP over an intermediate-vertex set: dist[i][j] using only vertices {0..k} as intermediates is min(old, dist[i][k]+dist[k][j]). The k loop must be the outermost so that when you use k as an intermediate, dist[i][k] and dist[k][j] already account for intermediates < k. It is O(V^3) time, O(V^2) space, handles negative edges (but not negative cycles — a negative dist[i][i] flags one), and is dead simple to code. Prefer it on dense graphs (E ~ V^2) or when V is small (a few hundred) and you genuinely need all pairs, because V runs of Dijkstra with a binary heap is O(V*(V+E)log V) which only wins on sparse graphs. Edge cases: initialize diagonal to 0 and missing edges to a large sentinel (not math.MaxInt — adding two of them overflows; use ~1e18/4 or guard). Scale follow-up: for millions of nodes neither works; you'd precompute landmarks (ALT) or use contraction hierarchies.

**Key points**
- DP over intermediate vertices; k is outermost loop
- O(V^3) time, O(V^2) space
- Negative dist[i][i] => negative cycle
- Wins on dense/small graphs vs V*Dijkstra


```go
func floydWarshall(dist [][]int) [][]int {
	n := len(dist)
	for k := 0; k < n; k++ {
		for i := 0; i < n; i++ {
			if dist[i][k] == inf {
				continue
			}
			for j := 0; j < n; j++ {
				if dist[k][j] != inf && dist[i][k]+dist[k][j] < dist[i][j] {
					dist[i][j] = dist[i][k] + dist[k][j]
				}
			}
		}
	}
	return dist
}

// inf is a sentinel like int(1e18) chosen so inf+inf does not overflow.
```

**Follow-ups**
- How do you reconstruct the actual paths, not just distances?
- How would you parallelize the triple loop?

---

#### 39. Compare Kruskal and Prim for minimum spanning trees. Implement Kruskal with union-find.

*Difficulty:* 🟠 hard  ·  *Tags:* `graphs`, `mst`, `kruskal`, `prim`, `union-find`, `greedy`

Both find an MST via the cut property (the lightest edge crossing any cut is safe). Kruskal sorts all edges and greedily adds the next-lightest edge that does not form a cycle, using union-find to test connectivity — O(E log E) dominated by the sort, and it works naturally on edge lists and disconnected forests. Prim grows a single tree from a seed, repeatedly pulling the cheapest edge leaving the tree via a min-heap keyed by vertex — O(E log V) with a binary heap, better on dense graphs where E ~ V^2 (or O(E + V log V) with a Fibonacci heap). Choose Kruskal when the graph is sparse or given as an edge list; choose Prim when dense or adjacency-list with a heap. Edge cases: parallel edges and self-loops (skip self-loops), and graphs that aren't connected (Kruskal yields a minimum spanning forest). Scale follow-up: distributed MST (Boruvka's algorithm) parallelizes well because each component picks its cheapest outgoing edge independently per round.

**Key points**
- Cut property underpins both greedy strategies
- Kruskal: sort edges + union-find, O(E log E)
- Prim: grow tree with min-heap, O(E log V), better dense
- Boruvka parallelizes for distributed MST


```go
type DSU struct{ parent, rank []int }

func NewDSU(n int) *DSU {
	p := make([]int, n)
	for i := range p {
		p[i] = i
	}
	return &DSU{parent: p, rank: make([]int, n)}
}

func (d *DSU) Find(x int) int {
	for d.parent[x] != x {
		d.parent[x] = d.parent[d.parent[x]] // path halving
		x = d.parent[x]
	}
	return x
}

func (d *DSU) Union(a, b int) bool {
	ra, rb := d.Find(a), d.Find(b)
	if ra == rb {
		return false
	}
	if d.rank[ra] < d.rank[rb] {
		ra, rb = rb, ra
	}
	d.parent[rb] = ra
	if d.rank[ra] == d.rank[rb] {
		d.rank[ra]++
	}
	return true
}

func kruskal(n int, edges [][3]int) (int, [][3]int) {
	sort.Slice(edges, func(i, j int) bool { return edges[i][2] < edges[j][2] })
	dsu := NewDSU(n)
	total := 0
	var mst [][3]int
	for _, e := range edges {
		if dsu.Union(e[0], e[1]) {
			total += e[2]
			mst = append(mst, e)
		}
	}
	return total, mst
}
```

**Follow-ups**
- How would you find the MST after a single edge weight decreases?
- What is a second-best MST and how do you compute it?

---

#### 40. What are strongly connected components and how does Tarjan's (or Kosaraju's) algorithm find them in linear time?

*Difficulty:* 🟠 hard  ·  *Tags:* `graphs`, `scc`, `tarjan`, `kosaraju`, `dfs`

An SCC is a maximal set of vertices where every pair is mutually reachable. Kosaraju runs two DFS passes: first on G recording finish order, then on the transpose G^T popping vertices in reverse finish order — each tree in the second pass is one SCC. Tarjan does it in a single DFS using a discovery index `disc` and a `low` value (lowest disc reachable via tree/back edges plus on-stack cross edges); when a vertex's low equals its disc it is the root of an SCC, and you pop the explicit stack down to it. Both are O(V+E). Tarjan is usually preferred (one pass, no transpose), Kosaraju is easier to explain. The condensation (collapse each SCC to a node) is a DAG, which is why SCCs matter: cycle detection, 2-SAT, dataflow, and dependency resolution all reduce to condensing then topologically processing. Edge cases: single-node SCCs, self-loops, and recursion depth on huge graphs (use an explicit stack to avoid blowing the goroutine stack). Scale follow-up: incremental SCC maintenance under edge insertions is a research-grade problem; in practice you recompute or use online algorithms.

**Key points**
- SCC = maximal mutually-reachable vertex set
- Kosaraju: DFS + transpose + reverse finish order
- Tarjan: single DFS with disc/low and a stack
- Condensation is a DAG => enables 2-SAT, dep resolution


```go
func tarjanSCC(graph [][]int) [][]int {
	n := len(graph)
	disc := make([]int, n)
	low := make([]int, n)
	onStack := make([]bool, n)
	for i := range disc {
		disc[i] = -1
	}
	var stack []int
	idx := 0
	var sccs [][]int
	var dfs func(u int)
	dfs = func(u int) {
		disc[u], low[u] = idx, idx
		idx++
		stack = append(stack, u)
		onStack[u] = true
		for _, v := range graph[u] {
			if disc[v] == -1 {
				dfs(v)
				low[u] = min(low[u], low[v])
			} else if onStack[v] {
				low[u] = min(low[u], disc[v])
			}
		}
		if low[u] == disc[u] {
			var comp []int
			for {
				w := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				onStack[w] = false
				comp = append(comp, w)
				if w == u {
					break
				}
			}
			sccs = append(sccs, comp)
		}
	}
	for i := 0; i < n; i++ {
		if disc[i] == -1 {
			dfs(i)
		}
	}
	return sccs
}
```

**Follow-ups**
- How do SCCs let you solve 2-SAT in linear time?
- Why is the condensation graph guaranteed acyclic?

---

#### 41. How do you check if a graph is bipartite, and what does that have to do with 2-coloring and odd cycles?

*Difficulty:* 🟡 medium  ·  *Tags:* `graphs`, `bipartite`, `bfs`, `coloring`

A graph is bipartite iff you can 2-color it so no edge joins same-colored vertices, which is equivalent to containing no odd-length cycle. Run BFS/DFS from each unvisited vertex, coloring the start 0 and alternating colors across edges; if you ever reach an already-colored neighbor with the SAME color, an odd cycle exists and the graph is not bipartite. O(V+E) time, O(V) space. Handle disconnected graphs by looping over all vertices. Edge cases: isolated vertices (trivially colorable), self-loops (instantly non-bipartite), and directed graphs (bipartiteness is about the underlying undirected structure). This generalizes to matching problems: bipartite graphs admit maximum matching via Hopcroft-Karp in O(E*sqrt(V)). Scale follow-up: 'is this user-item interaction graph bipartite?' becomes a recommendation-system framing where you exploit the two-sided structure.

**Key points**
- Bipartite iff 2-colorable iff no odd cycle
- BFS/DFS alternate colors; conflict => not bipartite
- O(V+E); loop all vertices for disconnected graphs
- Enables bipartite matching (Hopcroft-Karp)


```go
func isBipartite(graph [][]int) bool {
	color := make([]int, len(graph)) // 0 = uncolored, 1/-1 colors
	for s := range graph {
		if color[s] != 0 {
			continue
		}
		color[s] = 1
		queue := []int{s}
		for len(queue) > 0 {
			u := queue[0]
			queue = queue[1:]
			for _, v := range graph[u] {
				if color[v] == 0 {
					color[v] = -color[u]
					queue = append(queue, v)
				} else if color[v] == color[u] {
					return false
				}
			}
		}
	}
	return true
}
```

**Follow-ups**
- How does maximum bipartite matching relate (Konig's theorem)?
- How would you 2-color incrementally as edges arrive?

---

#### 42. Implement Dijkstra with Go's container/heap. Why a lazy-deletion heap instead of decrease-key?

*Difficulty:* 🟠 hard  ·  *Tags:* `graphs`, `dijkstra`, `shortest-path`, `heap`, `golang`

Dijkstra settles vertices in increasing distance order using a min-priority-queue of (vertex, tentative distance). Go's standard library has no decrease-key, so the idiomatic approach is lazy deletion: push a new (vertex, newDist) entry whenever you relax, and when you pop an entry whose stored distance is stale (greater than the best known) you skip it. This keeps the heap simple at the cost of up to O(E) heap entries, giving O(E log E) = O(E log V) time, O(V+E) space. Implement heap.Interface (Len/Less/Swap/Push/Pop) on a slice of items. Edge cases: unreachable nodes stay at infinity, zero-weight edges are fine, negative edges are NOT (use Bellman-Ford). A decrease-key heap caps entries at V but needs an index map and more bookkeeping; lazy deletion is simpler and usually fast enough. Scale follow-up: for road networks you switch to A* with a heuristic, or contraction hierarchies for millions of queries.

**Key points**
- Min-heap of (dist, node); settle in increasing dist
- No decrease-key in Go => lazy deletion of stale entries
- O(E log V) time, O(V+E) space
- Skip popped entries whose dist > best known


```go
type item struct {
	node, dist int
}
type pq []item

func (p pq) Len() int            { return len(p) }
func (p pq) Less(i, j int) bool  { return p[i].dist < p[j].dist }
func (p pq) Swap(i, j int)       { p[i], p[j] = p[j], p[i] }
func (p *pq) Push(x any)         { *p = append(*p, x.(item)) }
func (p *pq) Pop() any {
	old := *p
	n := len(old)
	it := old[n-1]
	*p = old[:n-1]
	return it
}

func dijkstra(graph [][][2]int, src int) []int { // graph[u] = list of {v, w}
	dist := make([]int, len(graph))
	for i := range dist {
		dist[i] = math.MaxInt
	}
	dist[src] = 0
	h := &pq{{src, 0}}
	for h.Len() > 0 {
		cur := heap.Pop(h).(item)
		if cur.dist > dist[cur.node] {
			continue // stale
		}
		for _, e := range graph[cur.node] {
			v, w := e[0], e[1]
			if nd := cur.dist + w; nd < dist[v] {
				dist[v] = nd
				heap.Push(h, item{v, nd})
			}
		}
	}
	return dist
}
```

**Follow-ups**
- How does A* extend this with an admissible heuristic?
- When would a decrease-key (indexed) heap actually pay off?

---

## Advanced Dynamic Programming

#### 43. Contrast 0/1 and unbounded knapsack. Why does the inner loop direction change?

*Difficulty:* 🟠 hard  ·  *Tags:* `dp`, `knapsack`, `optimization`

Both maximize value under a weight budget W. With a 1D dp array dp[c] = best value at capacity c: for 0/1 knapsack (each item used at most once) you iterate capacity DOWNWARD so that dp[c-w] still refers to the state BEFORE the current item was considered — iterating upward would let one item be reused. For unbounded knapsack (unlimited copies) you iterate capacity UPWARD precisely because you WANT dp[c-w] to already include the current item. Both are O(n*W) time; 0/1 is O(W) space after the 1D rolling trick, unbounded likewise. The key insight: loop direction encodes whether a state may have already consumed the current item. Edge cases: W=0, zero-weight items (unbounded knapsack with a zero-weight positive-value item is unbounded/ill-posed), and that O(n*W) is pseudo-polynomial — exponential in the bit-length of W. Scale follow-up: when W is huge, switch to meet-in-the-middle or approximation (FPTAS), since knapsack is NP-hard.

**Key points**
- 0/1: iterate capacity downward (item used once)
- Unbounded: iterate capacity upward (item reusable)
- O(n*W) time, O(W) space with 1D rolling array
- Pseudo-polynomial; NP-hard => FPTAS for large W


```go
func knapsack01(weights, values []int, W int) int {
	dp := make([]int, W+1)
	for i := range weights {
		for c := W; c >= weights[i]; c-- { // downward
			if v := dp[c-weights[i]] + values[i]; v > dp[c] {
				dp[c] = v
			}
		}
	}
	return dp[W]
}

func knapsackUnbounded(weights, values []int, W int) int {
	dp := make([]int, W+1)
	for i := range weights {
		for c := weights[i]; c <= W; c++ { // upward
			if v := dp[c-weights[i]] + values[i]; v > dp[c] {
				dp[c] = v
			}
		}
	}
	return dp[W]
}
```

**Follow-ups**
- How does bounded knapsack (k copies) decompose into 0/1 via binary splitting?
- Why is the FPTAS allowed for knapsack but not for general NP-hard problems?

---

#### 44. Explain interval / matrix-chain DP. Solve matrix-chain multiplication order.

*Difficulty:* 🟠 hard  ·  *Tags:* `dp`, `interval-dp`, `matrix-chain`

Interval DP computes an optimum over a range [i, j] by choosing a split point k and combining the optimal sub-intervals [i, k] and [k+1, j], plus a merge cost. Matrix-chain multiplication is the canonical example: given dimensions, find the parenthesization minimizing scalar multiplications. dp[i][j] = min over k of dp[i][k] + dp[k+1][j] + p[i-1]*p[k]*p[j], filling by increasing chain length so sub-intervals are ready. O(n^3) time, O(n^2) space. The structure (fill by length, try every split) recurs in optimal BST, polygon triangulation, burst balloons, and palindrome partitioning. Edge cases: single matrix has cost 0, and dimension compatibility is assumed. Knuth's optimization can drop some interval DPs to O(n^2) when the quadrangle inequality holds. Scale follow-up: this models query-plan join ordering in databases, where the same O(n^3) DP (or heuristics for large n) chooses join order.

**Key points**
- dp[i][j] = min over split k of left + right + merge cost
- Fill by increasing interval length
- O(n^3) time, O(n^2) space
- Same shape: optimal BST, burst balloons, join ordering


```go
func matrixChainOrder(p []int) int { // p has n+1 dimensions for n matrices
	n := len(p) - 1
	dp := make([][]int, n)
	for i := range dp {
		dp[i] = make([]int, n)
	}
	for length := 2; length <= n; length++ {
		for i := 0; i+length-1 < n; i++ {
			j := i + length - 1
			dp[i][j] = math.MaxInt
			for k := i; k < j; k++ {
				cost := dp[i][k] + dp[k+1][j] + p[i]*p[k+1]*p[j+1]
				if cost < dp[i][j] {
					dp[i][j] = cost
				}
			}
		}
	}
	return dp[0][n-1]
}
```

**Follow-ups**
- How would you reconstruct the optimal parenthesization?
- When does Knuth's optimization apply to drop it to O(n^2)?

---

#### 45. What is bitmask DP and how does it solve the Traveling Salesman Problem exactly?

*Difficulty:* 🟠 hard  ·  *Tags:* `dp`, `bitmask`, `tsp`, `held-karp`

Bitmask DP encodes a subset of up to ~20 elements as the bits of an integer, making 'which items are used' an O(1) array index. Held-Karp solves exact TSP: dp[mask][i] = min cost to start at 0, visit exactly the set `mask`, and end at city i. Transition: dp[mask|1<<j][j] = min(dp[mask][i] + dist[i][j]) for j not in mask. Answer is min over i of dp[full][i] + dist[i][0]. Complexity O(2^n * n^2) time, O(2^n * n) space — exponential but vastly better than O(n!) brute force; practical to n ~ 18-20. Edge cases: ensure the start bit is set in the base case, and unreachable transitions stay at infinity. Bitmask DP also powers assignment problems, set cover, and 'minimum cost to cover all' tasks. Scale follow-up: beyond ~20 nodes TSP needs heuristics (Christofides, Lin-Kernighan) or ILP solvers; the exact DP is only a baseline.

**Key points**
- Subset-as-int gives O(1) state indexing
- Held-Karp: dp[mask][end]; O(2^n * n^2) time
- O(2^n * n) space; practical to n ~ 20
- Beats O(n!); larger n needs heuristics/ILP


```go
func tsp(dist [][]int) int {
	n := len(dist)
	full := 1<<n - 1
	dp := make([][]int, 1<<n)
	for m := range dp {
		dp[m] = make([]int, n)
		for i := range dp[m] {
			dp[m][i] = math.MaxInt / 2
		}
	}
	dp[1][0] = 0 // start at city 0
	for mask := 1; mask <= full; mask++ {
		for i := 0; i < n; i++ {
			if dp[mask][i] == math.MaxInt/2 || mask&(1<<i) == 0 {
				continue
			}
			for j := 0; j < n; j++ {
				if mask&(1<<j) != 0 {
					continue
				}
				nm := mask | 1<<j
				if c := dp[mask][i] + dist[i][j]; c < dp[nm][j] {
					dp[nm][j] = c
				}
			}
		}
	}
	best := math.MaxInt
	for i := 1; i < n; i++ {
		if c := dp[full][i] + dist[i][0]; c < best {
			best = c
		}
	}
	return best
}
```

**Follow-ups**
- How would you recover the actual tour order?
- How does bitmask DP solve minimum-cost assignment?

---

#### 46. Solve Longest Increasing Subsequence in O(n log n) and explain why the 'tails' array works.

*Difficulty:* 🟠 hard  ·  *Tags:* `dp`, `lis`, `binary-search`, `patience-sorting`

Maintain `tails`, where tails[k] is the smallest possible tail of an increasing subsequence of length k+1 seen so far. For each x, binary-search the first tails element >= x (strict LIS) and overwrite it; if x exceeds all tails, append it. The length of `tails` is the LIS length. tails is always sorted, so binary search is valid — that's the crux. The values in tails are NOT a valid subsequence themselves (it's a frontier), but its LENGTH is correct; to reconstruct the actual subsequence you keep predecessor indices. O(n log n) time, O(n) space, versus the naive O(n^2) DP. Edge cases: empty input (0), all-equal elements (strict LIS = 1; use the >= bound), and non-decreasing variant uses upper-bound instead. Scale follow-up: patience-sorting framing connects LIS to deck-of-cards solitaire and to longest chain problems (envelopes, Russian dolls) that sort then LIS.

**Key points**
- tails[k] = smallest tail of an LIS of length k+1
- Binary search lower-bound to place each element
- tails stays sorted; its length = LIS length
- O(n log n); reconstruct via predecessor indices


```go
func lengthOfLIS(nums []int) int {
	tails := []int{}
	for _, x := range nums {
		lo, hi := 0, len(tails)
		for lo < hi {
			mid := (lo + hi) / 2
			if tails[mid] < x {
				lo = mid + 1
			} else {
				hi = mid
			}
		}
		if lo == len(tails) {
			tails = append(tails, x)
		} else {
			tails[lo] = x
		}
	}
	return len(tails)
}
```

**Follow-ups**
- How do you reconstruct one actual longest increasing subsequence?
- How does the Russian-doll-envelopes problem reduce to LIS?

---

#### 47. Solve Word Break (can a string be segmented into dictionary words?) and discuss the DP vs memoized-recursion trade-off.

*Difficulty:* 🟡 medium  ·  *Tags:* `dp`, `strings`, `word-break`, `trie`

dp[i] = true if s[:i] can be segmented. Base dp[0]=true; for each i, dp[i] is true if some j<i has dp[j] true and s[j:i] is in the dictionary. O(n^2) substring checks times the cost of the set lookup (hash the words, or use a trie to walk characters and avoid building substrings). O(n^2) time, O(n) space plus dictionary. Bottom-up DP and top-down memoized recursion are equivalent here; memoization is more intuitive for the 'return all sentences' variant (Word Break II) but you must cache to avoid the exponential blowup on inputs like 'aaaa...a' + 'b'. Edge cases: empty string (vacuously true), words longer than the remaining suffix, and repeated dictionary lookups. Scale follow-up: for a massive dictionary build an Aho-Corasick automaton so you find all word matches ending at each position in linear time, turning the inner loop into edge-following.

**Key points**
- dp[i] true if dp[j] true and s[j:i] in dict
- O(n^2) time, O(n) space + dict set
- Trie/Aho-Corasick avoids substring allocation
- Memoize Word Break II to avoid exponential blowup


```go
func wordBreak(s string, words []string) bool {
	dict := make(map[string]bool, len(words))
	maxLen := 0
	for _, w := range words {
		dict[w] = true
		if len(w) > maxLen {
			maxLen = len(w)
		}
	}
	dp := make([]bool, len(s)+1)
	dp[0] = true
	for i := 1; i <= len(s); i++ {
		for j := i - 1; j >= 0 && i-j <= maxLen; j-- {
			if dp[j] && dict[s[j:i]] {
				dp[i] = true
				break
			}
		}
	}
	return dp[len(s)]
}
```

**Follow-ups**
- How do you return every possible segmentation (Word Break II) efficiently?
- How does a trie change the inner-loop complexity?

---

#### 48. Solve subset-sum / partition into two equal-sum halves with a bitset, and state when it is tractable.

*Difficulty:* 🟡 medium  ·  *Tags:* `dp`, `subset-sum`, `partition`, `bitset`

Partition into two equal-sum subsets is feasible only if the total is even; then it reduces to subset-sum for target = total/2. The classic DP is a boolean dp[c] = 'some subset sums to c', updated like 0/1 knapsack with the capacity loop going downward. A Go-idiomatic speedup uses a big.Int as a bitset: bits |= bits << num sets, in one shifted OR, every reachable sum that includes num — turning the inner loop into machine-word-parallel work, roughly O(n * sum / 64). O(n*sum) time, O(sum) space; pseudo-polynomial, so it's tractable only when the target sum is modest. Edge cases: odd total (immediately false), zeros (don't change reachability), and a single element equal to the target. Scale follow-up: subset-sum is NP-complete; for large sums you use meet-in-the-middle (O(2^(n/2))) or approximation, and the bitset trick is the practical workhorse for moderate sums.

**Key points**
- Partition possible only if total is even; target = total/2
- dp[c] boolean, downward capacity loop (0/1 style)
- big.Int bitset: bits |= bits<<num, ~64x parallel
- Pseudo-polynomial; meet-in-the-middle for large sums


```go
func canPartition(nums []int) bool {
	total := 0
	for _, n := range nums {
		total += n
	}
	if total%2 != 0 {
		return false
	}
	target := total / 2
	bits := big.NewInt(1) // bit 0 set: sum 0 reachable
	for _, n := range nums {
		shifted := new(big.Int).Lsh(bits, uint(n))
		bits.Or(bits, shifted)
	}
	return bits.Bit(target) == 1
}
```

**Follow-ups**
- How does meet-in-the-middle bring subset-sum to O(2^(n/2))?
- How would you also return the actual partition, not just feasibility?

---

#### 49. Explain edit distance (Levenshtein) and its common variants. Implement it with O(min(m,n)) space.

*Difficulty:* 🟠 hard  ·  *Tags:* `dp`, `edit-distance`, `strings`, `lcs`

Edit distance is the minimum insert/delete/substitute operations to turn s into t. dp[i][j] = cost for s[:i] -> t[:j]: if characters match, inherit dp[i-1][j-1]; otherwise 1 + min(delete dp[i-1][j], insert dp[i][j-1], substitute dp[i-1][j-1]). O(m*n) time. Since each row only depends on the previous row, you can keep two rows (or one with a saved diagonal) for O(min(m,n)) space. Variants: Longest Common Subsequence (only insert/delete, no substitute), Damerau-Levenshtein (adds adjacent transposition for typo correction), and weighted/affine-gap costs for bioinformatics alignment (Needleman-Wunsch / Smith-Waterman). Edge cases: empty strings (distance = length of the other), and Unicode (compare runes, not bytes). Scale follow-up: for fuzzy search over millions of strings you don't run full DP per candidate — you use a BK-tree, a trie with bounded-distance pruning, or precomputed n-gram/LSH indexes, and only run edit distance on a shortlist.

**Key points**
- match => diagonal; else 1 + min(del, ins, sub)
- O(m*n) time, O(min(m,n)) space with rolling rows
- Variants: LCS, Damerau (transposition), affine gaps
- Fuzzy search at scale: BK-tree / trie pruning, not raw DP


```go
func editDistance(s, t string) int {
	if len(s) < len(t) {
		s, t = t, s
	}
	prev := make([]int, len(t)+1)
	for j := range prev {
		prev[j] = j
	}
	cur := make([]int, len(t)+1)
	for i := 1; i <= len(s); i++ {
		cur[0] = i
		for j := 1; j <= len(t); j++ {
			if s[i-1] == t[j-1] {
				cur[j] = prev[j-1]
			} else {
				cur[j] = 1 + min(prev[j], min(cur[j-1], prev[j-1]))
			}
		}
		prev, cur = cur, prev
	}
	return prev[len(t)]
}
```

**Follow-ups**
- How does Damerau-Levenshtein add transposition correctly?
- How would you index millions of strings for fuzzy lookup?

---

#### 50. What is DP on trees? Solve 'maximum independent set' (house robber on a tree) with a post-order DFS.

*Difficulty:* 🟠 hard  ·  *Tags:* `dp`, `trees`, `dfs`, `independent-set`

Tree DP computes, for each node, an answer that depends only on its children's answers, gathered in a single post-order DFS — there are no overlapping subproblems across siblings, so memoization isn't even needed, just the recursion. For maximum-weight independent set you return two values per node: best when the node is INCLUDED (its value + sum of children-excluded) and best when EXCLUDED (sum of each child's max(included, excluded)). The root's max of the two is the answer. O(n) time and O(h) recursion-stack space. The 'two states per node, combine children' pattern generalizes to tree diameter, distributing coins, binary-tree cameras, and counting paths. Edge cases: empty tree (0), single node (its weight), and very deep/skewed trees that can overflow the stack (rewrite with an explicit stack or increase limits). Scale follow-up: on a forest you sum per-tree answers; on a general graph the independent-set problem is NP-hard — the tree structure is exactly what makes it linear.

**Key points**
- Post-order DFS; node answer from children answers
- Return (included, excluded) pair per node
- O(n) time, O(h) stack space
- Tree structure makes NP-hard ind. set linear


```go
type TreeNode struct {
	Val         int
	Children    []*TreeNode
}

func maxIndependentSet(root *TreeNode) int {
	var dfs func(n *TreeNode) (incl, excl int)
	dfs = func(n *TreeNode) (int, int) {
		if n == nil {
			return 0, 0
		}
		incl, excl := n.Val, 0
		for _, c := range n.Children {
			ci, ce := dfs(c)
			incl += ce          // if we take n, children must be excluded
			excl += max(ci, ce) // else children free to choose
		}
		return incl, excl
	}
	i, e := dfs(root)
	return max(i, e)
}
```

**Follow-ups**
- How do you compute the tree diameter in the same single pass?
- Why does rooting an unrooted tree at an arbitrary node not change the answer?

---

## Intervals & Greedy Scheduling

#### 51. Merge overlapping intervals and insert a new interval. What invariant makes the sort-then-sweep correct?

*Difficulty:* 🟡 medium  ·  *Tags:* `intervals`, `sorting`, `greedy`, `sweep-line`

Merge intervals: sort by start, then sweep — keep the last merged interval and, for each next interval, either extend its end (if it starts <= current end) or push it as a new block. Correctness rests on the invariant that once sorted by start, any interval that overlaps a given one must come immediately after and start within the running end, so a single pass suffices. O(n log n) time (sort dominates), O(n) output. Insert interval into an already-sorted, non-overlapping list is O(n): copy intervals ending before the new one, merge all that overlap by expanding the new interval's bounds, then copy the rest — no re-sort needed. Edge cases: empty input, touching intervals (decide whether [1,2] and [2,3] merge — usually yes), and single-point intervals. Scale follow-up: for streaming intervals or a calendar with millions of events you switch to an interval tree or a sweep with a balanced BST / segment tree so inserts and overlap queries are O(log n).

**Key points**
- Sort by start; overlap iff next.start <= cur.end
- Merge in one sweep, O(n log n)
- Insert into sorted list is O(n), no re-sort
- Interval tree for dynamic/streaming queries


```go
func merge(intervals [][2]int) [][2]int {
	sort.Slice(intervals, func(i, j int) bool { return intervals[i][0] < intervals[j][0] })
	res := [][2]int{}
	for _, iv := range intervals {
		if n := len(res); n > 0 && iv[0] <= res[n-1][1] {
			if iv[1] > res[n-1][1] {
				res[n-1][1] = iv[1]
			}
		} else {
			res = append(res, iv)
		}
	}
	return res
}
```

**Follow-ups**
- How would you support dynamic insert + overlap query in O(log n)?
- How do you compute the total covered length of all intervals?

---

#### 52. Meeting Rooms II: find the minimum number of rooms needed. Show both the heap and the sweep-line solutions.

*Difficulty:* 🟡 medium  ·  *Tags:* `intervals`, `heap`, `sweep-line`, `scheduling`

You need the peak number of simultaneously-active meetings. Heap solution: sort meetings by start, keep a min-heap of end times; for each meeting pop all ended meetings (end <= start), then push this meeting's end — the max heap size reached is the answer. O(n log n) time, O(n) space. Sweep-line (chronological events) solution: create +1 events at starts and -1 at ends, sort all 2n events (ties: process end before start so a meeting ending exactly when another starts reuses the room), and track the running max of the prefix sum. Same O(n log n). Edge cases: empty list (0), zero-length meetings, and the start==end tie-break that decides whether back-to-back meetings share a room. Scale follow-up: this is exactly resource/capacity allocation; at scale (cloud scheduler, connection pool sizing) you model it as the maximum overlap of intervals, and the sweep generalizes to weighted capacities and to predicting peak concurrency.

**Key points**
- Answer = peak simultaneous meetings
- Heap of end times; max heap size = rooms
- Sweep: +1/-1 events, running prefix-sum max
- Tie-break end-before-start for back-to-back reuse


```go
func minMeetingRooms(intervals [][2]int) int {
	n := len(intervals)
	starts := make([]int, n)
	ends := make([]int, n)
	for i, iv := range intervals {
		starts[i], ends[i] = iv[0], iv[1]
	}
	sort.Ints(starts)
	sort.Ints(ends)
	rooms, maxRooms, j := 0, 0, 0
	for i := 0; i < n; i++ {
		for j < n && ends[j] <= starts[i] {
			rooms--
			j++
		}
		rooms++
		if rooms > maxRooms {
			maxRooms = rooms
		}
	}
	return maxRooms
}
```

**Follow-ups**
- How do you also return WHICH meeting goes in which room?
- How does this change if rooms have capacities/weights?

---

#### 53. Interval scheduling maximization (activity selection): pick the most non-overlapping intervals. Prove the greedy choice.

*Difficulty:* 🟡 medium  ·  *Tags:* `intervals`, `greedy`, `scheduling`, `exchange-argument`

To maximize the count of mutually non-overlapping intervals, sort by EARLIEST FINISH time and greedily take each interval whose start is >= the last taken finish. The exchange argument: any optimal solution's first interval can be swapped for the earliest-finishing one without reducing the count (it frees up at least as much room for the rest), and induction extends this — so the greedy is optimal. O(n log n) time (sort), O(1) extra. Contrast: sorting by earliest START or shortest duration both fail with counterexamples; the finish-time order is what's provably correct. Edge cases: ties in finish time, intervals that just touch (decide inclusivity), and empty input. Scale follow-up: the weighted version (maximize total value, not count) is NOT solvable greedily — it needs DP with binary search over finish times (weighted interval scheduling, O(n log n)), a common 'why doesn't greedy work here?' interview pivot.

**Key points**
- Sort by earliest finish, take if start >= last finish
- Exchange argument proves greedy optimality
- Earliest-start / shortest-duration orderings fail
- Weighted version needs DP + binary search, not greedy


```go
func maxNonOverlapping(intervals [][2]int) int {
	sort.Slice(intervals, func(i, j int) bool { return intervals[i][1] < intervals[j][1] })
	count, lastEnd := 0, math.MinInt
	for _, iv := range intervals {
		if iv[0] >= lastEnd {
			count++
			lastEnd = iv[1]
		}
	}
	return count
}
```

**Follow-ups**
- How do you solve the weighted version with DP?
- What is the minimum number of intervals to remove to make the rest non-overlapping?

---

## Heaps, Two-Heaps & Selection

#### 54. Design a data structure that returns the running median of a stream. Why two heaps?

*Difficulty:* 🟠 hard  ·  *Tags:* `heap`, `two-heaps`, `median`, `streaming`

Keep a max-heap for the lower half and a min-heap for the upper half, balanced so their sizes differ by at most one. The median is the top of the larger heap (odd count) or the average of both tops (even count). Insert: push to one heap, move its top to the other to maintain ordering (every element in `lo` <= every element in `hi`), then rebalance sizes. Two heaps give O(log n) insert and O(1) median — far better than re-sorting (O(n log n)) or keeping a sorted slice with O(n) insert. O(n) space. Edge cases: first element, repeated values (heaps handle dupes), and even vs odd count for the average (watch integer overflow when averaging two large ints — use the (a+b)/2 with care or float). Scale follow-up: for sliding-window median you add lazy deletion to both heaps (or use an order-statistics tree); for approximate medians at massive scale you use t-digest or the P-square algorithm to bound memory.

**Key points**
- Max-heap (low half) + min-heap (high half), balanced
- Median = larger heap's top or average of tops
- O(log n) insert, O(1) query
- Sliding-window median needs lazy deletion / OST


```go
type MedianFinder struct {
	lo *maxHeap // lower half (max-heap)
	hi *minHeap // upper half (min-heap)
}

func (m *MedianFinder) Add(num int) {
	heap.Push(m.lo, num)
	heap.Push(m.hi, heap.Pop(m.lo)) // largest of lo -> hi (keeps order)
	if m.hi.Len() > m.lo.Len() {
		heap.Push(m.lo, heap.Pop(m.hi)) // rebalance
	}
}

func (m *MedianFinder) Median() float64 {
	if m.lo.Len() > m.hi.Len() {
		return float64(m.lo.Peek())
	}
	return (float64(m.lo.Peek()) + float64(m.hi.Peek())) / 2
}
```

**Follow-ups**
- How do you adapt this to a sliding window of size k?
- How would you approximate the median over a billion values with bounded memory?

---

#### 55. Sliding-window maximum: find the max of every window of size k in O(n). Why a monotonic deque?

*Difficulty:* 🟠 hard  ·  *Tags:* `heap`, `monotonic-deque`, `sliding-window`, `streaming`

Use a deque holding INDICES whose values are in decreasing order. For each new index: pop from the back while the back's value <= the incoming value (those can never be the max while this larger, newer element is around), push the new index, then pop from the front if it has slid out of the window (index <= i-k). The front is always the current window's maximum. Each index is pushed and popped at most once, so total work is O(n), with O(k) deque space — beating the O(n log k) heap-with-lazy-deletion approach and the O(nk) brute force. Edge cases: k=1 (each element is its own max), k=n (single window), and storing indices (not values) so you can detect expiry. Scale follow-up: this monotonic-deque trick is the core of many sliding-window-extrema problems (constrained subsequence sum, jump-game variants) and of streaming analytics where you need windowed min/max without re-scanning.

**Key points**
- Deque of indices, values decreasing
- Pop back if <= incoming; pop front if out of window
- Front = window max; O(n) total, O(k) space
- Beats heap O(n log k) and brute O(nk)


```go
func maxSlidingWindow(nums []int, k int) []int {
	dq := []int{} // indices, values decreasing
	res := make([]int, 0, len(nums)-k+1)
	for i, x := range nums {
		for len(dq) > 0 && nums[dq[len(dq)-1]] <= x {
			dq = dq[:len(dq)-1]
		}
		dq = append(dq, i)
		if dq[0] <= i-k {
			dq = dq[1:]
		}
		if i >= k-1 {
			res = append(res, nums[dq[0]])
		}
	}
	return res
}
```

**Follow-ups**
- How do you get the window minimum at the same time?
- How does this generalize to the constrained-subsequence-sum DP?

---

#### 56. Kth largest element: when do you use a size-k heap and when quickselect? Implement quickselect.

*Difficulty:* 🟠 hard  ·  *Tags:* `heap`, `quickselect`, `selection`, `top-k`

Two standard answers. A size-k MIN-heap streams through the data keeping the k largest seen; it's O(n log k) time, O(k) space, and is the right call for streaming data or when you need the top-k (not just the kth) or k << n with limited memory. Quickselect partitions around a pivot (Lomuto/Hoare) and recurses only into the side containing the kth position — O(n) average time, O(1) extra space, but O(n^2) worst case if pivots are adversarial; randomizing the pivot (or median-of-medians for a guaranteed O(n)) fixes that. Quickselect mutates the array and isn't stable, so prefer the heap when input is read-only or streamed. Edge cases: k out of range, duplicates (partitioning still works), and recursion depth (convert to a loop). Scale follow-up: top-k across a distributed dataset uses per-shard local heaps merged at a coordinator, or count-min-sketch / Misra-Gries for approximate heavy hitters when exactness isn't required.

**Key points**
- Size-k min-heap: O(n log k), streaming/top-k friendly
- Quickselect: O(n) avg, O(1) space, mutates array
- Randomize pivot to avoid O(n^2); median-of-medians for guarantee
- Distributed top-k: per-shard heaps merged at coordinator


```go
func quickSelect(nums []int, k int) int { // kth largest (1-indexed)
	target := len(nums) - k // index in sorted ascending order
	lo, hi := 0, len(nums)-1
	for lo < hi {
		p := partition(nums, lo, hi)
		switch {
		case p == target:
			return nums[p]
		case p < target:
			lo = p + 1
		default:
			hi = p - 1
		}
	}
	return nums[lo]
}

func partition(a []int, lo, hi int) int {
	rand.Seed(time.Now().UnixNano())
	pi := lo + rand.Intn(hi-lo+1)
	a[pi], a[hi] = a[hi], a[pi] // random pivot to hi
	pivot := a[hi]
	i := lo
	for j := lo; j < hi; j++ {
		if a[j] < pivot {
			a[i], a[j] = a[j], a[i]
			i++
		}
	}
	a[i], a[hi] = a[hi], a[i]
	return i
}
```

**Follow-ups**
- Why does median-of-medians guarantee O(n) worst case?
- How would you find approximate heavy hitters in one pass?

---

## Tries & String Matching

#### 57. Implement a trie (prefix tree) with insert/search/startsWith. What does it buy you over a hash set?

*Difficulty:* 🟡 medium  ·  *Tags:* `trie`, `strings`, `prefix-tree`

A trie stores strings character-by-character along paths from the root, with a flag marking the end of a complete word. insert/search/startsWith are all O(L) in the word length L, independent of how many words are stored — a hash set gives O(L) average lookup too, but cannot answer PREFIX queries (autocomplete, 'how many words start with...') without scanning everything. Tries also share common prefixes, saving memory on dense dictionaries, and give deterministic worst case (no hash collisions). The cost is pointer-chasing and per-node overhead (a 26-way array vs a map trades speed for space). Edge cases: empty string (mark root as a word), case sensitivity, and the alphabet size (use a map for Unicode, a fixed array for a-z). Scale follow-up: for huge dictionaries you compress to a radix/Patricia trie (collapse single-child chains) or a DAWG (merge shared suffixes) — both standard for spell-checkers, IP routing tables, and autocomplete services.

**Key points**
- O(L) insert/search/prefix, L = word length
- Prefix queries are the win over a hash set
- Shares prefixes; array (a-z) vs map (Unicode) node trade-off
- Compress to radix trie / DAWG at scale


```go
type Trie struct {
	children [26]*Trie
	isWord   bool
}

func (t *Trie) Insert(word string) {
	node := t
	for i := 0; i < len(word); i++ {
		c := word[i] - 'a'
		if node.children[c] == nil {
			node.children[c] = &Trie{}
		}
		node = node.children[c]
	}
	node.isWord = true
}

func (t *Trie) find(s string) *Trie {
	node := t
	for i := 0; i < len(s); i++ {
		node = node.children[s[i]-'a']
		if node == nil {
			return nil
		}
	}
	return node
}

func (t *Trie) Search(word string) bool { n := t.find(word); return n != nil && n.isWord }
func (t *Trie) StartsWith(p string) bool { return t.find(p) != nil }
```

**Follow-ups**
- How would you support wildcard '.' matching any character (search variant)?
- How does a radix/Patricia trie compress chains and why does it help?

---

#### 58. Word Search II: find all dictionary words on a board. Why combine a trie with backtracking?

*Difficulty:* 🟠 hard  ·  *Tags:* `trie`, `backtracking`, `strings`, `dfs`, `grid`

Build a trie from the dictionary, then DFS from every board cell, descending the trie one character per step. The trie is what makes it tractable: instead of searching each word independently (O(W * board)), you walk all words simultaneously and PRUNE the moment the current path isn't a trie prefix, so dead branches die immediately. Mark cells visited during a path and unmark on backtrack; when you hit a trie node flagged as a word, collect it (and unflag or dedupe to avoid duplicates). Complexity ~O(cells * 4 * 3^(L-1)) with L the max word length, dominated by the branching but heavily cut by trie pruning. Edge cases: reusing a cell within one word (forbidden — track visited), duplicate words in output (dedupe via a set or by clearing the word flag), and very long words. Scale follow-up: store words at trie leaves and remove them once found to shrink the search space; for enormous boards/dictionaries you'd parallelize DFS roots across goroutines since each starting cell is independent.

**Key points**
- Trie lets all words be searched in one DFS
- Prune as soon as path is not a valid prefix
- Mark/unmark visited cells; dedupe found words
- Independent start cells parallelize across goroutines


```go
func findWords(board [][]byte, words []string) []string {
	root := &Trie{}
	for _, w := range words {
		root.Insert(w)
	}
	var res []string
	var dfs func(r, c int, node *Trie, path []byte)
	dfs = func(r, c int, node *Trie, path []byte) {
		if r < 0 || c < 0 || r >= len(board) || c >= len(board[0]) || board[r][c] == '#' {
			return
		}
		ch := board[r][c]
		nxt := node.children[ch-'a']
		if nxt == nil {
			return
		}
		path = append(path, ch)
		if nxt.isWord {
			res = append(res, string(path))
			nxt.isWord = false // dedupe
		}
		board[r][c] = '#'
		dfs(r+1, c, nxt, path)
		dfs(r-1, c, nxt, path)
		dfs(r, c+1, nxt, path)
		dfs(r, c-1, nxt, path)
		board[r][c] = ch
	}
	for r := range board {
		for c := range board[r] {
			dfs(r, c, root, nil)
		}
	}
	return res
}
```

**Follow-ups**
- How would you prune trie leaves after finding a word to speed later searches?
- How do you parallelize the per-cell DFS safely in Go?

---

#### 59. Explain KMP and the prefix (failure) function. Why does it give O(n+m) substring search?

*Difficulty:* 🟠 hard  ·  *Tags:* `strings`, `kmp`, `pattern-matching`, `prefix-function`

Naive substring search re-examines characters after a mismatch, costing O(n*m). KMP precomputes a failure function pi[i] = length of the longest proper prefix of the pattern that is also a suffix of pattern[:i+1]. On a mismatch at pattern position j, instead of restarting you jump j back to pi[j-1], reusing the fact that those characters already matched — the text pointer never moves backward. Building pi is O(m); the scan is O(n); total O(n+m) time, O(m) space. The prefix function is itself a reusable tool: it finds all occurrences, computes the smallest repeating unit of a string (n - pi[n-1] when it divides n), and underlies the Z-algorithm. Edge cases: empty pattern (matches at 0), pattern longer than text, and overlapping matches (KMP finds them). Scale follow-up: for many patterns at once use Aho-Corasick (KMP generalized to a trie of patterns); for a fixed pattern queried over many texts, KMP's prefix table is precomputed once and reused.

**Key points**
- pi[i] = longest proper prefix that is also a suffix
- On mismatch jump to pi[j-1]; text pointer never retreats
- O(n+m) time, O(m) space
- Prefix function also finds smallest period; Aho-Corasick for many patterns


```go
func kmpSearch(text, pat string) []int {
	if len(pat) == 0 {
		return []int{0}
	}
	pi := make([]int, len(pat))
	for i, k := 1, 0; i < len(pat); i++ {
		for k > 0 && pat[i] != pat[k] {
			k = pi[k-1]
		}
		if pat[i] == pat[k] {
			k++
		}
		pi[i] = k
	}
	var res []int
	for i, k := 0, 0; i < len(text); i++ {
		for k > 0 && text[i] != pat[k] {
			k = pi[k-1]
		}
		if text[i] == pat[k] {
			k++
		}
		if k == len(pat) {
			res = append(res, i-k+1)
			k = pi[k-1]
		}
	}
	return res
}
```

**Follow-ups**
- How does the prefix function reveal a string's smallest repeating period?
- How does Aho-Corasick extend KMP to many patterns?

---

#### 60. Explain Rabin-Karp rolling hashing. When does it win, and how do you avoid the collision/overflow traps?

*Difficulty:* 🟡 medium  ·  *Tags:* `strings`, `rabin-karp`, `rolling-hash`, `pattern-matching`

Rabin-Karp hashes the pattern and each length-m window of the text; a rolling hash updates the window hash in O(1) by removing the leaving character's contribution and adding the entering one, so the scan is O(n+m) on average. On a hash match you must verify character-by-character to rule out a false positive — worst case O(n*m) if hashes collide constantly, mitigated by a good base and a large prime modulus (and ideally double hashing). It shines for MULTIPLE pattern search (hash all patterns of the same length, look up each window in a set) and for 2D pattern matching, where KMP doesn't generalize as cleanly. Traps: integer overflow (do all arithmetic mod a prime, and in Go keep products in int64), negative values after subtracting the leading term (add modulus back), and choosing a modulus large enough to keep collisions rare. Scale follow-up: rolling hashes power content-defined chunking (rsync, dedup, Git's delta), plagiarism detection (k-gram fingerprinting / winnowing), and Bloom-filter-style membership over substrings.

**Key points**
- Rolling hash updates window in O(1); O(n+m) average
- Verify on hash match to handle collisions
- Best for multi-pattern and 2D matching
- Mod by a large prime; guard overflow and negatives


```go
func rabinKarp(text, pat string) []int {
	n, m := len(text), len(pat)
	if m == 0 || m > n {
		return nil
	}
	const base, mod = 256, 1_000_000_007
	var patHash, winHash, pow int64 = 0, 0, 1
	for i := 0; i < m; i++ {
		patHash = (patHash*base + int64(pat[i])) % mod
		winHash = (winHash*base + int64(text[i])) % mod
		if i > 0 {
			pow = pow * base % mod
		}
	}
	var res []int
	for i := 0; i+m <= n; i++ {
		if patHash == winHash && text[i:i+m] == pat {
			res = append(res, i)
		}
		if i+m < n {
			winHash = (winHash - int64(text[i])*pow%mod + mod) % mod
			winHash = (winHash*base + int64(text[i+m])) % mod
		}
	}
	return res
}
```

**Follow-ups**
- How does double hashing reduce false positives?
- How is content-defined chunking (rsync/dedup) built on rolling hashes?

---

## Range Queries

#### 61. Explain 2D prefix sums and how inclusion-exclusion answers submatrix sums in O(1).

*Difficulty:* 🟡 medium  ·  *Tags:* `range-queries`, `prefix-sum`, `2d`, `inclusion-exclusion`

Build P where P[i][j] = sum of the rectangle from (0,0) to (i-1,j-1). Then the sum of any submatrix (r1,c1)..(r2,c2) inclusive is P[r2+1][c2+1] - P[r1][c2+1] - P[r2+1][c1] + P[r1][c1] — inclusion-exclusion: subtract the strip above and the strip to the left, then add back the top-left corner that was subtracted twice. Precompute is O(R*C), each query O(1), space O(R*C). This is the static-data workhorse for image integrals (Viola-Jones face detection's 'integral image'), heatmap range sums, and 2D analytics. Edge cases: the +1 padding row/column to avoid boundary branching, and overflow (use int64 for large grids). The moment you need point UPDATES interleaved with submatrix queries, switch to a 2D Fenwick tree (O(log R * log C) per op) or a 2D segment tree. Scale follow-up: for sparse or streaming 2D data you'd use a k-d tree / quadtree, or summed-area tiles maintained incrementally rather than a dense prefix matrix.

**Key points**
- P[i][j] = sum of rectangle (0,0)..(i-1,j-1)
- Query = inclusion-exclusion of four corners, O(1)
- O(R*C) precompute; pad with a zero row/col
- Updates => 2D Fenwick/segment tree


```go
func buildPrefix2D(m [][]int) [][]int {
	R, C := len(m), len(m[0])
	P := make([][]int, R+1)
	for i := range P {
		P[i] = make([]int, C+1)
	}
	for i := 1; i <= R; i++ {
		for j := 1; j <= C; j++ {
			P[i][j] = m[i-1][j-1] + P[i-1][j] + P[i][j-1] - P[i-1][j-1]
		}
	}
	return P
}

func submatrixSum(P [][]int, r1, c1, r2, c2 int) int { // inclusive
	return P[r2+1][c2+1] - P[r1][c2+1] - P[r2+1][c1] + P[r1][c1]
}
```

**Follow-ups**
- How would you support point updates with a 2D Fenwick tree?
- How does the integral image accelerate Haar-feature face detection?

---

#### 62. Build a segment tree for range-sum (or range-min) with point updates, and explain the lazy-propagation idea for range updates.

*Difficulty:* 🟠 hard  ·  *Tags:* `range-queries`, `segment-tree`, `lazy-propagation`

A segment tree stores aggregates over array ranges in a balanced binary tree: each leaf is one element, each internal node combines its two children (sum, min, max, gcd — any associative monoid). Point update walks one root-to-leaf path updating O(log n) nodes; a range query recurses, returning a node's stored value whole when its range is fully inside the query and pruning ranges fully outside — O(log n). Build is O(n), space O(n) (4n in an array layout). For RANGE updates (e.g., add x to [l,r]) you add lazy propagation: store a pending delta on a node, apply it to the node's aggregate immediately, and push it down to children only when you next descend through that node — keeping range update and range query both O(log n). Edge cases: 1-indexing vs 0, the 4n sizing for the array form, and combining the lazy tag correctly (sum scales by range length, min/max just shift). Scale follow-up: segment trees generalize to 2D, to persistent versions (query historical states in O(log n)), and to segment-tree-beats for complex range operations; for purely additive prefix queries a Fenwick tree is smaller and faster.

**Key points**
- Each node aggregates a range via an associative op
- Point update O(log n); range query prunes inside/outside
- Lazy propagation: defer range updates, push down on descent
- Persistent / 2D / Fenwick variants by need


```go
type SegTree struct {
	n    int
	tree []int
}

func NewSegTree(a []int) *SegTree {
	n := len(a)
	st := &SegTree{n: n, tree: make([]int, 2*n)}
	copy(st.tree[n:], a) // leaves
	for i := n - 1; i > 0; i-- {
		st.tree[i] = st.tree[2*i] + st.tree[2*i+1]
	}
	return st
}

func (st *SegTree) Update(i, val int) { // point assign
	i += st.n
	st.tree[i] = val
	for i >>= 1; i > 0; i >>= 1 {
		st.tree[i] = st.tree[2*i] + st.tree[2*i+1]
	}
}

func (st *SegTree) Query(l, r int) int { // sum over [l, r)
	res := 0
	for l, r = l+st.n, r+st.n; l < r; l, r = l>>1, r>>1 {
		if l&1 == 1 {
			res += st.tree[l]
			l++
		}
		if r&1 == 1 {
			r--
			res += st.tree[r]
		}
	}
	return res
}
```

**Follow-ups**
- Sketch the lazy-propagation code for range-add + range-sum.
- When is a Fenwick tree preferable to a segment tree?

---

## Greedy Classics

#### 63. Jump Game I and II: can you reach the end, and the minimum jumps to do so? Why is greedy optimal?

*Difficulty:* 🟡 medium  ·  *Tags:* `greedy`, `arrays`, `jump-game`, `bfs`

Jump Game I (reachability): track the farthest index reachable so far; sweep left to right, and if the current index ever exceeds that reach you're stuck — else if reach covers the last index, return true. O(n) time, O(1) space; greedy works because reach is monotonic and you only care whether the gap is ever crossable. Jump Game II (minimum jumps): a BFS-by-levels in disguise — maintain the current jump's farthest boundary `curEnd` and the farthest reachable `farthest`; when i hits curEnd you must take a jump, so increment the count and extend curEnd to farthest. O(n) time, O(1) space. Greedy is optimal because each 'level' is the set of indices reachable in k jumps, and you always extend to the maximal frontier. Edge cases: single element (0 jumps), a 0 that blocks progress, and reaching exactly the last index. Scale follow-up: with weighted/variable jump costs it becomes a shortest-path/DP problem; the clean greedy only holds for the unit-cost reachability framing.

**Key points**
- Game I: track farthest reach; fail if i > reach
- Game II: BFS levels via curEnd/farthest, count on boundary
- Both O(n) time, O(1) space
- Weighted jumps break greedy => DP/shortest path


```go
func jump(nums []int) int { // minimum jumps to reach last index
	jumps, curEnd, farthest := 0, 0, 0
	for i := 0; i < len(nums)-1; i++ {
		if i+nums[i] > farthest {
			farthest = i + nums[i]
		}
		if i == curEnd { // must jump now
			jumps++
			curEnd = farthest
		}
	}
	return jumps
}
```

**Follow-ups**
- How would you also return the actual sequence of jump indices?
- What changes if each jump has a distinct cost?

---

#### 64. Gas Station: find the starting index to complete the circuit, or -1. Prove the single-pass greedy.

*Difficulty:* 🟡 medium  ·  *Tags:* `greedy`, `arrays`, `gas-station`

Compute diff[i] = gas[i] - cost[i]. If the total sum of diffs is negative, no solution exists (you can't generate more gas than you burn). Otherwise a unique valid start exists, and it's found in one pass: track a running tank; whenever the tank goes negative at station i, no start in [candidate..i] can work (each prefix start only has less or equal cumulative gas), so reset the candidate to i+1 and zero the tank. The key lemma: if the journey from s fails first at i, then no station between s and i can be a valid start either. O(n) time, O(1) space — no need to simulate every start (which would be O(n^2)). Edge cases: total negative (-1), single station, and exactly-zero total (start works). Scale follow-up: this 'reset on negative prefix' idea is the same skeleton as Kadane's maximum-subarray and as detecting the optimal restart point in streaming balance problems.

**Key points**
- Feasible iff total(gas) >= total(cost)
- Reset start to i+1 whenever running tank < 0
- Lemma: a failing prefix rules out all its starts
- O(n) time, O(1) space; cousin of Kadane


```go
func canCompleteCircuit(gas, cost []int) int {
	total, tank, start := 0, 0, 0
	for i := range gas {
		d := gas[i] - cost[i]
		total += d
		tank += d
		if tank < 0 {
			start = i + 1
			tank = 0
		}
	}
	if total < 0 {
		return -1
	}
	return start
}
```

**Follow-ups**
- Why is the valid start unique when the total is non-negative?
- How does this connect to Kadane's algorithm?

---

#### 65. Task Scheduler: minimum time to run tasks with a cooldown n between identical tasks. Derive the formula.

*Difficulty:* 🟡 medium  ·  *Tags:* `greedy`, `scheduling`, `task-scheduler`, `heap`

With a cooldown of n between identical tasks, the bottleneck is the most frequent task. Let maxFreq be its count and `numMax` the number of tasks sharing that max frequency. The most frequent task forces (maxFreq-1) full frames of size (n+1), each frame fillable by other distinct tasks or idle slots, plus a final partial frame holding the `numMax` max-frequency tasks: answer = max(len(tasks), (maxFreq-1)*(n+1) + numMax). The max(...) with len(tasks) handles the case where there are so many distinct tasks that no idling is ever needed (the frames overflow). O(T) time to count frequencies, O(1) space (26 letters). Edge cases: n=0 (answer is just len(tasks)), all tasks distinct, and a single dominant task. The greedy insight is 'always schedule the most frequent remaining task that's off cooldown', which a max-heap simulation also realizes but the closed form is O(T). Scale follow-up: this models CPU/job scheduling with anti-affinity constraints; with heterogeneous cooldowns or priorities it becomes a heap-driven simulation or a constraint problem.

**Key points**
- Bottleneck = most frequent task and its cooldown frames
- ans = max(len(tasks), (maxFreq-1)*(n+1) + numMax)
- max with len handles 'too many distinct tasks' case
- O(T) time, O(1) space (fixed alphabet)


```go
func leastInterval(tasks []byte, n int) int {
	var count [26]int
	for _, t := range tasks {
		count[t-'A']++
	}
	maxFreq, numMax := 0, 0
	for _, c := range count {
		if c > maxFreq {
			maxFreq, numMax = c, 1
		} else if c == maxFreq {
			numMax++
		}
	}
	frames := (maxFreq-1)*(n+1) + numMax
	if frames < len(tasks) {
		return len(tasks)
	}
	return frames
}
```

**Follow-ups**
- How would a max-heap simulation produce the actual schedule?
- What changes with per-task distinct cooldowns?

---

## Math & Bit Manipulation

#### 66. Compute GCD/LCM (Euclid) and fast modular exponentiation. Why are both logarithmic?

*Difficulty:* 🟡 medium  ·  *Tags:* `math`, `gcd`, `modular-arithmetic`, `fast-power`

Euclid's algorithm: gcd(a,b) = gcd(b, a mod b) until b is 0. It's O(log min(a,b)) because each two steps at least halve the larger value (a mod b < a/2 when b <= a/2, and otherwise a mod b = a - b shrinks it). LCM follows as a/gcd(a,b)*b — divide before multiplying to avoid overflow. Fast (binary) exponentiation computes base^exp mod m by squaring: square the base each step and multiply into the result when the current exponent bit is 1, so it runs in O(log exp) multiplications instead of O(exp). Keep products in int64 and reduce mod m every step to avoid overflow. Edge cases: gcd(0,0) is conventionally 0, negative inputs (take absolute values), exp=0 (result 1), and modulus 1 (everything 0). Scale follow-up: modular exponentiation is the heart of RSA/Diffie-Hellman and Fermat/Miller-Rabin primality; the extended Euclidean algorithm additionally yields modular inverses for those cryptographic and combinatorial (nCr mod p) computations.

**Key points**
- gcd(a,b)=gcd(b, a mod b); O(log min(a,b))
- lcm = a/gcd*b (divide first to avoid overflow)
- Fast power: square-and-multiply, O(log exp)
- Foundation of RSA, primality tests, modular inverse


```go
func gcd(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func lcm(a, b int) int { return a / gcd(a, b) * b }

func powMod(base, exp, mod int64) int64 {
	result := int64(1)
	base %= mod
	for exp > 0 {
		if exp&1 == 1 {
			result = result * base % mod
		}
		base = base * base % mod
		exp >>= 1
	}
	return result
}
```

**Follow-ups**
- How does the extended Euclidean algorithm yield a modular inverse?
- How does fast exponentiation enable Fermat/Miller-Rabin primality?

---

#### 67. Implement the Sieve of Eratosthenes. What's its complexity, and when do you reach for a segmented sieve?

*Difficulty:* 🟡 medium  ·  *Tags:* `math`, `sieve`, `primes`, `number-theory`

Mark multiples of each prime starting from p*p (smaller multiples were already marked by smaller primes) up to n. The total work is n*sum(1/p over primes p <= n) = O(n log log n) time, O(n) space (a bitset cuts space 8x). Starting at p*p and only sieving p up to sqrt(n) are the two key optimizations. It's the go-to for 'all primes up to n' or precomputing smallest-prime-factor for fast factorization. When n is too large to hold a length-n array (e.g., primes in [10^12, 10^12 + 10^6]), use a SEGMENTED sieve: sieve the base primes up to sqrt(high) once, then sieve each window [lo, hi) of manageable size using those base primes — O((hi-lo) log log hi) per segment with O(sqrt(high)) base storage. Edge cases: n < 2 (no primes), even numbers, and off-by-one on the inclusive bound. Scale follow-up: for counting primes (not listing) you switch to Meissel-Mertens / Lucy_Hedgehog methods, and for primality of a single huge number you use Miller-Rabin instead of any sieve.

**Key points**
- Sieve multiples from p*p; p up to sqrt(n)
- O(n log log n) time, O(n) space (bitset 8x smaller)
- Segmented sieve for ranges too big to fit in memory
- Single huge number => Miller-Rabin, not a sieve


```go
func sieve(n int) []int {
	if n < 2 {
		return nil
	}
	isComposite := make([]bool, n+1)
	var primes []int
	for p := 2; p <= n; p++ {
		if !isComposite[p] {
			primes = append(primes, p)
			for m := p * p; m <= n; m += p {
				isComposite[m] = true
			}
		}
	}
	return primes
}
```

**Follow-ups**
- How does a linear (Euler) sieve mark each composite exactly once?
- How would you list primes in [10^12, 10^12+10^6]?

---

#### 68. Bit tricks grab-bag: count set bits, find the single number via XOR, and enumerate all subsets of a bitmask. Explain each.

*Difficulty:* 🟡 medium  ·  *Tags:* `bit-manipulation`, `xor`, `subsets`, `popcount`

Count set bits: Brian Kernighan's `n &= n-1` clears the lowest set bit each iteration, so it loops popcount(n) times rather than 32/64 — or just use math/bits.OnesCount. Single number: XOR is associative, commutative, and self-inverse (x^x=0, x^0=x), so XOR-ing all elements cancels the pairs and leaves the unique one in O(n) time, O(1) space; the 'two singles' variant splits by a differing bit, and 'every element thrice except one' uses bit-count mod 3. Subset enumeration: `for sub := mask; sub > 0; sub = (sub-1) & mask` walks every submask of `mask` in O(3^k) total across all masks (each of k bits is in/out/absent) — the standard trick for subset-DP and SOS. Edge cases: the empty submask (handle 0 separately if needed), and Go's typed shifts/unsigned for the high bit. Scale follow-up: these underpin bitmask DP (TSP, assignment), Bloom filters, roaring bitmaps for compressed set operations, and SIMD popcount in analytics engines.

**Key points**
- n &= n-1 clears lowest set bit (Kernighan popcount)
- XOR cancels pairs => single number in O(1) space
- sub = (sub-1) & mask enumerates submasks, O(3^k) overall
- Foundations of bitmask DP, Bloom filters, roaring bitmaps


```go
func countBits(n uint) int {
	c := 0
	for n != 0 {
		n &= n - 1
		c++
	}
	return c
}

func singleNumber(nums []int) int {
	x := 0
	for _, v := range nums {
		x ^= v
	}
	return x
}

func subsets(mask int) []int {
	var res []int
	for sub := mask; ; sub = (sub - 1) & mask {
		res = append(res, sub)
		if sub == 0 {
			break
		}
	}
	return res
}
```

**Follow-ups**
- How do you find the two unique numbers when every other appears twice?
- How does sum-over-subsets (SOS) DP build on submask enumeration?

---

## Data-Structure Design

#### 69. Design an LFU cache with O(1) get and put. How does it differ from LRU, and what makes O(1) hard?

*Difficulty:* 🟠 hard  ·  *Tags:* `design`, `lfu-cache`, `hash-map`, `linked-list`

LFU evicts the LEAST FREQUENTLY used key, breaking ties by least-recently-used among the minimum frequency. The challenge is keeping eviction O(1) when frequencies change on every access. The standard design: a map key->node (value, freq), a map freq->doubly-linked-list of keys at that frequency (ordered by recency), and a `minFreq` counter. On access, move the node from its freq list to freq+1's list (creating it if needed); if the old list was at minFreq and is now empty, increment minFreq. On insert past capacity, evict the LRU node from the minFreq list. Every operation is O(1) amortized because list splices and map ops are constant. Compared to LRU (just one recency list), LFU needs the frequency dimension plus the minFreq bookkeeping. Edge cases: capacity 0 (no-op), updating an existing key's value (still bumps freq), and ties at min frequency. Scale follow-up: exact LFU rarely survives at scale — real systems use TinyLFU / W-TinyLFU (Caffeine, Ristretto) with a count-min sketch to approximate frequency in bounded memory and an admission policy, plus aging so old hot keys decay.

**Key points**
- Evict least-frequent, LRU tie-break
- Maps: key->node and freq->DLL; track minFreq
- On access move node to freq+1; bump minFreq when min list empties
- Real scale uses approximate W-TinyLFU (count-min sketch)


```go
type lfuNode struct {
	key, val, freq int
	prev, next     *lfuNode
}

type LFUCache struct {
	cap, size, minFreq int
	nodes              map[int]*lfuNode
	freqList           map[int]*dll // freq -> doubly linked list (head=MRU)
}

func (c *LFUCache) Get(key int) (int, bool) {
	n, ok := c.nodes[key]
	if !ok {
		return 0, false
	}
	c.bump(n)
	return n.val, true
}

func (c *LFUCache) bump(n *lfuNode) {
	c.freqList[n.freq].remove(n)
	if n.freq == c.minFreq && c.freqList[n.freq].empty() {
		c.minFreq++
	}
	n.freq++
	if c.freqList[n.freq] == nil {
		c.freqList[n.freq] = newDLL()
	}
	c.freqList[n.freq].pushFront(n)
}

func (c *LFUCache) Put(key, val int) {
	if c.cap == 0 {
		return
	}
	if n, ok := c.nodes[key]; ok {
		n.val = val
		c.bump(n)
		return
	}
	if c.size == c.cap {
		victim := c.freqList[c.minFreq].popBack()
		delete(c.nodes, victim.key)
		c.size--
	}
	n := &lfuNode{key: key, val: val, freq: 1}
	c.nodes[key] = n
	if c.freqList[1] == nil {
		c.freqList[1] = newDLL()
	}
	c.freqList[1].pushFront(n)
	c.minFreq = 1
	c.size++
}
```

**Follow-ups**
- How does W-TinyLFU approximate frequency with bounded memory?
- How would you add TTL expiry alongside frequency eviction?

---

#### 70. Implement a Min-Stack: push/pop/top/getMin all in O(1). Show the two standard encodings.

*Difficulty:* 🟡 medium  ·  *Tags:* `design`, `min-stack`, `stack`, `monotonic`

A Min-Stack returns the minimum of all current elements in O(1) alongside normal stack ops. Approach 1: a second stack of running minima — push min(x, currentMin) in lockstep so the auxiliary top is always the current minimum; pop both together. O(n) extra space, dead simple. Approach 2: store each element as a delta from the min at push time, keeping the min in a single variable; on push of x, if x < min store (x - min) as a marker that the min changed and update min; on pop, if the stored value is negative restore the previous min. This uses O(1) extra space but needs care with overflow (deltas can exceed int range) — usually not worth the cleverness. Both give O(1) for all four operations. Edge cases: pop/top/getMin on an empty stack (define behavior), duplicate minima (the paired-stack version handles them naturally), and overflow in the delta encoding. Scale follow-up: the same 'carry an auxiliary aggregate' idea extends to a min-queue (via two min-stacks) and to monotonic-stack problems like largest-rectangle and stock-span.

**Key points**
- Aux stack of running minima: O(1) ops, O(n) space
- Delta-encoding trick: O(1) space but overflow risk
- Both keep push/pop/top/getMin O(1)
- Generalizes to min-queue via two min-stacks


```go
type MinStack struct {
	stack []int
	mins  []int // running minimum, parallel to stack
}

func (s *MinStack) Push(x int) {
	s.stack = append(s.stack, x)
	if len(s.mins) == 0 || x < s.mins[len(s.mins)-1] {
		s.mins = append(s.mins, x)
	} else {
		s.mins = append(s.mins, s.mins[len(s.mins)-1])
	}
}

func (s *MinStack) Pop() {
	s.stack = s.stack[:len(s.stack)-1]
	s.mins = s.mins[:len(s.mins)-1]
}

func (s *MinStack) Top() int    { return s.stack[len(s.stack)-1] }
func (s *MinStack) GetMin() int { return s.mins[len(s.mins)-1] }
```

**Follow-ups**
- How do you build a min-QUEUE from two min-stacks?
- How does the delta-encoding avoid the auxiliary stack, and what's the catch?

---

#### 71. Design a structure supporting insert, delete, and getRandom all in average O(1).

*Difficulty:* 🟠 hard  ·  *Tags:* `design`, `hash-map`, `array`, `randomization`

Combine a slice (dynamic array) with a map from value to its index in the slice. insert appends to the slice and records its index in the map. delete is the trick: to avoid an O(n) shift, swap the target with the LAST element, update the moved element's index in the map, then truncate the slice and remove the key — O(1). getRandom returns slice[rand.Intn(len)] in O(1) with uniform probability because the slice is contiguous. All three are average O(1) (map ops amortized). Edge cases: deleting the last element (swap with self is fine but guard the index update order), deleting a missing key (return false), and getRandom on an empty structure. The insight is that an array gives O(1) uniform random and O(1) append, and the swap-with-last makes deletion O(1) at the cost of not preserving order. Scale follow-up: the duplicate-allowing variant (RandomizedCollection) stores a set of indices per value; and for weighted random sampling you'd switch to a Fenwick tree / alias method, while distributed uniform sampling over a sharded set uses reservoir sampling.

**Key points**
- Slice + map(value->index)
- Delete = swap with last, fix index, truncate: O(1)
- getRandom = slice[rand index], uniform O(1)
- Weighted sampling => Fenwick/alias method


```go
type RandomizedSet struct {
	vals []int
	idx  map[int]int // value -> position in vals
}

func NewRandomizedSet() *RandomizedSet {
	return &RandomizedSet{idx: make(map[int]int)}
}

func (s *RandomizedSet) Insert(v int) bool {
	if _, ok := s.idx[v]; ok {
		return false
	}
	s.idx[v] = len(s.vals)
	s.vals = append(s.vals, v)
	return true
}

func (s *RandomizedSet) Remove(v int) bool {
	i, ok := s.idx[v]
	if !ok {
		return false
	}
	last := len(s.vals) - 1
	s.vals[i] = s.vals[last]
	s.idx[s.vals[i]] = i
	s.vals = s.vals[:last]
	delete(s.idx, v)
	return true
}

func (s *RandomizedSet) GetRandom() int { return s.vals[rand.Intn(len(s.vals))] }
```

**Follow-ups**
- How do you allow duplicates (RandomizedCollection)?
- How would you support weighted random selection?

---

#### 72. Implement a token-bucket rate limiter. Contrast it with sliding-window and leaky-bucket approaches.

*Difficulty:* 🟠 hard  ·  *Tags:* `design`, `rate-limiter`, `token-bucket`, `concurrency`

A token bucket holds up to `capacity` tokens refilled at `rate` tokens/sec; each request consumes a token, and runs only if one is available — this permits short bursts (up to capacity) while bounding the long-run average. The lazy refill trick avoids a background timer: on each request compute elapsed time since last refill, add elapsed*rate tokens (capped at capacity), then try to take one. Thread-safety in Go needs a mutex (or atomics) around the token count. Contrast: a fixed-window counter is simplest but allows 2x bursts at window edges; a sliding-window log is precise but stores every timestamp (memory heavy); a sliding-window counter approximates it cheaply; a leaky bucket smooths output to a constant drain rate (no bursts) — token bucket allows bursts, leaky bucket does not, which is the classic interview distinction. Edge cases: clock skew/monotonic time (use time.Now() monotonic reading), fractional tokens, and concurrent requests racing on the count. Scale follow-up: distributed rate limiting moves the bucket to Redis (atomic Lua script) so all app instances share one limit, trading a network hop for global correctness; sticky-routing or local-token leasing reduce that hop.

**Key points**
- Token bucket: capacity + refill rate, allows bursts
- Lazy refill by elapsed*rate, capped, no timer needed
- Leaky bucket smooths (no burst); sliding-window log precise but heavy
- Distributed limit => Redis atomic script (shared bucket)


```go
type TokenBucket struct {
	mu         sync.Mutex
	capacity   float64
	tokens     float64
	rate       float64 // tokens per second
	lastRefill time.Time
}

func NewTokenBucket(capacity, rate float64) *TokenBucket {
	return &TokenBucket{capacity: capacity, tokens: capacity, rate: rate, lastRefill: time.Now()}
}

func (b *TokenBucket) Allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now()
	elapsed := now.Sub(b.lastRefill).Seconds()
	b.tokens = math.Min(b.capacity, b.tokens+elapsed*b.rate)
	b.lastRefill = now
	if b.tokens >= 1 {
		b.tokens--
		return true
	}
	return false
}
```

**Follow-ups**
- How would you make this correct across many app servers?
- When is a leaky bucket the right choice over a token bucket?

---

## Concurrency-Flavored DSA (Go)

#### 73. Implement a bounded blocking queue in Go. Channel-based vs condition-variable: when each?

*Difficulty:* 🟠 hard  ·  *Tags:* `concurrency`, `golang`, `blocking-queue`, `channels`

A bounded blocking queue blocks producers when full and consumers when empty. In Go the idiomatic implementation is just a buffered channel: `make(chan T, capacity)` — send blocks at capacity, receive blocks when empty, and the runtime handles all the wakeups; close the channel to signal completion and range over it to drain. This is the right default: simple, race-free, and composable with select for timeouts/cancellation via context. The condition-variable version (sync.Mutex + two sync.Cond, notEmpty and notFull) is what you'd write in a channel-less language; reach for it only when you need behavior channels don't give cleanly — e.g., bulk drain of all elements at once, peeking, priority ordering, or dynamic capacity. Always loop on the condition (`for len == 0 { cond.Wait() }`) to handle spurious-style wakeups and multiple waiters. Edge cases: shutdown/close semantics (sending on a closed channel panics), draining remaining items after close, and avoiding lost wakeups (signal while holding the lock). Scale follow-up: this is the backbone of worker pools and backpressure; at scale you bound the queue to apply backpressure upstream rather than buffering unboundedly (which just moves the OOM), and you add metrics on queue depth to detect saturation.

**Key points**
- Buffered channel = idiomatic bounded blocking queue
- select adds timeout/cancellation; close signals done
- sync.Cond version for bulk drain/peek/priority needs
- Always loop on the wait condition; bounded => backpressure


```go
// Channel-based (idiomatic).
type BlockingQueue[T any] struct{ ch chan T }

func NewBlockingQueue[T any](capacity int) *BlockingQueue[T] {
	return &BlockingQueue[T]{ch: make(chan T, capacity)}
}

func (q *BlockingQueue[T]) Put(v T)        { q.ch <- v }          // blocks if full
func (q *BlockingQueue[T]) Take() T         { return <-q.ch }      // blocks if empty
func (q *BlockingQueue[T]) Close()          { close(q.ch) }

// With cancellation:
func (q *BlockingQueue[T]) PutCtx(ctx context.Context, v T) error {
	select {
	case q.ch <- v:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

**Follow-ups**
- How would you implement Drain() that atomically removes all items?
- Why does an unbounded queue just move the failure mode?

---

#### 74. Write a parallel merge sort with goroutines. How do you avoid spawning too many, and when does it actually help?

*Difficulty:* 🟠 hard  ·  *Tags:* `concurrency`, `golang`, `merge-sort`, `parallelism`, `divide-and-conquer`

Parallel merge sort recurses on the two halves concurrently, then merges. The naive version spawns a goroutine per recursion level, which explodes for large n and oversubscribes the scheduler. The fix is a threshold: below some size (or below a remaining-depth budget tied to GOMAXPROCS) fall back to sequential sort, so you only parallelize the top few levels where the work per goroutine is large. Use a sync.WaitGroup (or split one half into a goroutine and run the other inline) to join. Complexity stays O(n log n) work; the span (critical path) drops to O(n) due to the sequential merge, giving up to O(log n) speedup, bounded by cores and by the memory-bandwidth-bound merge. It only helps when n is large and the comparison/move cost is non-trivial — for small or cheap-to-compare data the goroutine and synchronization overhead dominates and a plain sort.Slice wins. Edge cases: false sharing on adjacent slice writes, and not mutating overlapping ranges concurrently. Scale follow-up: beyond one machine you move to external/distributed merge sort (sort runs that fit in RAM, then k-way merge), the same divide-and-conquer shape MapReduce uses.

**Key points**
- Recurse halves concurrently, then merge
- Threshold to sequential below a size/depth to cap goroutines
- O(n log n) work, ~O(n) span => up to O(log n) speedup
- Only wins for large n; external merge sort at machine scale


```go
func parallelMergeSort(a []int, depth int) {
	if len(a) <= 2048 || depth <= 0 {
		sort.Ints(a) // sequential fallback
		return
	}
	mid := len(a) / 2
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		parallelMergeSort(a[:mid], depth-1)
	}()
	parallelMergeSort(a[mid:], depth-1) // run other half inline
	wg.Wait()
	merge(a, mid)
}

func merge(a []int, mid int) {
	left := append([]int(nil), a[:mid]...)
	right := a[mid:]
	i, j, k := 0, 0, 0
	for i < len(left) && j < len(right) {
		if left[i] <= right[j] {
			a[k] = left[i]
			i++
		} else {
			a[k] = right[j]
			j++
		}
		k++
	}
	for i < len(left) {
		a[k] = left[i]
		i, k = i+1, k+1
	}
}
```

**Follow-ups**
- How would you parallelize the merge step itself?
- How does external merge sort handle data larger than RAM?

---

#### 75. Make an LRU cache concurrency-safe in Go. Why is a single mutex often the right answer, and when isn't it?

*Difficulty:* 🟠 hard  ·  *Tags:* `concurrency`, `golang`, `lru-cache`, `mutex`, `sharding`

A single-threaded LRU is a map + doubly-linked list (move-to-front on access, evict from the back). Making it concurrency-safe: the simplest correct option wraps every Get/Put in one sync.Mutex — and crucially Get must take the WRITE lock too, because reading promotes the node to front (a mutation of the list), so a RWMutex buys little unless you separate lookup from promotion. A single mutex is right when the critical section is tiny (a map lookup and a few pointer splices) and contention is moderate; it's simple and correct, which beats clever-but-buggy. It becomes the bottleneck under heavy concurrent load on few keys; then you shard the cache by key hash into N independent locked LRUs (striped locking) to cut contention ~N-fold, accepting per-shard (not global) LRU accuracy. Edge cases: the read-promotes-write subtlety, consistent ordering to avoid deadlock if you ever hold two shard locks, and not leaking the eviction callback under the lock. Scale follow-up: high-end designs (Ristretto, Caffeine) decouple reads from the eviction policy using lock-free ring buffers that batch access records and apply them asynchronously, so reads are nearly lock-free while the policy stays approximate but cheap.

**Key points**
- map + DLL; Get promotes => needs the WRITE lock
- Single mutex: simple, correct, fine for tiny critical sections
- Shard by key hash (striped locks) to cut contention
- Lock-free read buffers (Ristretto/Caffeine) at extreme scale


```go
type LRUCache struct {
	mu       sync.Mutex
	capacity int
	cache    map[int]*list.Element
	ll       *list.List // front = most recently used
}

type entry struct{ key, value int }

func (c *LRUCache) Get(key int) (int, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.cache[key]; ok {
		c.ll.MoveToFront(el) // mutation => write lock required
		return el.Value.(*entry).value, true
	}
	return 0, false
}

func (c *LRUCache) Put(key, value int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.cache[key]; ok {
		el.Value.(*entry).value = value
		c.ll.MoveToFront(el)
		return
	}
	if c.ll.Len() == c.capacity {
		oldest := c.ll.Back()
		c.ll.Remove(oldest)
		delete(c.cache, oldest.Value.(*entry).key)
	}
	c.cache[key] = c.ll.PushFront(&entry{key, value})
}
```

**Follow-ups**
- How does sharding by key hash trade global accuracy for throughput?
- How do lock-free read buffers keep reads fast in Ristretto?

---

## Sampling & Streaming Selection

#### 76. Reservoir sampling: pick k items uniformly from a stream of unknown length in one pass. Prove uniformity.

*Difficulty:* 🟠 hard  ·  *Tags:* `sampling`, `reservoir`, `streaming`, `randomization`

Keep the first k items as the reservoir. For the i-th item (i > k, 1-indexed), keep it with probability k/i; if kept, evict a uniformly random reservoir slot. Inductive proof for k=1: item i is chosen with prob 1/i, and a previously-chosen item j survives with prob (1/j) * product over t>j of (1 - 1/t) = (1/j)*(j/i) = 1/i, so every item ends with probability 1/i — uniform. The k>1 case generalizes the same way. One pass, O(n) time, O(k) space, and you never need to know n in advance — that's the whole point versus shuffling (which needs all n in memory). Edge cases: streams shorter than k (return all), and using a good RNG (rand.Intn(i)). Scale follow-up: weighted reservoir sampling uses the A-Res / exponential-jump (A-ExpJ) algorithm with per-item keys; distributed reservoir sampling samples per shard then merges with size-weighted recombination; and for sliding-window or time-decayed sampling you use specialized variants since plain reservoir assumes a fixed, append-only stream.

**Key points**
- Keep first k; item i replaces a random slot w.p. k/i
- Induction shows every item ends at probability k/n
- One pass, O(k) space, n need not be known
- Weighted (A-ExpJ) and distributed variants exist


```go
func reservoirSample(stream <-chan int, k int) []int {
	res := make([]int, 0, k)
	i := 0
	for v := range stream {
		i++
		if len(res) < k {
			res = append(res, v)
		} else if j := rand.Intn(i); j < k {
			res[j] = v // replace a uniformly random slot
		}
	}
	return res
}
```

**Follow-ups**
- How does weighted reservoir sampling (A-ExpJ) assign keys?
- How would you sample uniformly over only the last N items (sliding window)?

---

#### 77. Boyer-Moore majority vote: find an element appearing more than n/2 times in O(1) space. Why does the cancellation work, and how do you extend it to n/3?

*Difficulty:* 🟡 medium  ·  *Tags:* `streaming`, `boyer-moore`, `majority-vote`, `misra-gries`

Maintain a candidate and a counter. For each element: if the counter is 0 adopt the element as the candidate; if it equals the candidate increment, else decrement. The intuition is pairwise cancellation — each non-majority element can cancel at most one majority occurrence, and since the majority appears more than n/2 times, it cannot be fully cancelled and survives as the candidate. O(n) time, O(1) space, single pass. CRUCIAL caveat: this only guarantees correctness if a majority is known to exist; otherwise you must do a second pass to verify the candidate's count exceeds n/2. The n/3 variant (elements appearing more than n/3 times — at most two of them) tracks TWO candidates and two counters with the same cancel logic, then verifies both in a second pass; it generalizes to n/k with k-1 candidates. Edge cases: empty input, no true majority (verification fails), and ties. Scale follow-up: this is the deterministic special case of the Misra-Gries heavy-hitters sketch, which with k-1 counters finds all items exceeding n/k frequency in one pass — the streaming primitive behind 'top trending' and DDoS heavy-hitter detection, alongside count-min sketch for approximate counts.

**Key points**
- Candidate + counter; cancel opposites, adopt when counter 0
- Majority survives because it can't be fully cancelled
- Verify in a second pass if existence isn't guaranteed
- n/3 => two candidates; generalizes to Misra-Gries n/k


```go
func majorityElement(nums []int) int {
	candidate, count := 0, 0
	for _, v := range nums {
		if count == 0 {
			candidate = v
		}
		if v == candidate {
			count++
		} else {
			count--
		}
	}
	// Verify if a majority is not guaranteed to exist:
	count = 0
	for _, v := range nums {
		if v == candidate {
			count++
		}
	}
	if count > len(nums)/2 {
		return candidate
	}
	return -1 // no majority
}
```

**Follow-ups**
- Write the n/3 variant with two candidates and its verification.
- How does Misra-Gries generalize this to find all items above n/k?

---
