# Binomial Heap — Practice Tasks

> All tasks must be solved in Go, Java, and Python.

A binomial heap is a forest of binomial trees obeying the min-heap order, with at most one tree of each order. The trees in the root list correspond bit-for-bit to the binary representation of `n`. Meld is the heap analogue of binary addition, which gives `O(log n)` worst-case for insert, extract-min, decrease-key, and meld.

These tasks build a working binomial heap from scratch, then push it into realistic settings: Dijkstra with handles, functional persistence, skew variants, and head-to-head benchmarks against binary and pairing heaps.

---

## Beginner Tasks (5)

### Task 1 — Insert and find-min

**Problem.** Implement `insert(x)` and `findMin()` for a binomial heap. Internally, `insert` creates a one-node tree of order 0 and melds it with the existing root list. `findMin` walks the root list once and returns the smallest root.

**I/O spec.**
- Input: a sequence of `INSERT v` and `MIN` lines.
- Output: for each `MIN`, print the current minimum, or `EMPTY` if the heap is empty.

**Constraints.** `1 <= ops <= 10^5`, values fit in `int64`.

**Hint.** Keep the root list as a singly linked list sorted by tree order (ascending). Meld is then a single linear pass, just like adding two binary numbers.

**Go starter.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

type node struct {
	key         int64
	order       int
	child, sib  *node
}

type BinHeap struct {
	head *node // smallest order first
}

func (h *BinHeap) Insert(x int64) {
	// TODO: wrap x in a node and meld with h
}

func (h *BinHeap) FindMin() (int64, bool) {
	// TODO: scan root list
	return 0, false
}

func meld(a, b *node) *node {
	// TODO: merge two root lists like binary addition
	return nil
}

func main() {
	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	h := &BinHeap{}
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	for sc.Scan() {
		var op string
		var v int64
		fmt.Sscan(sc.Text(), &op, &v)
		switch op {
		case "INSERT":
			h.Insert(v)
		case "MIN":
			if m, ok := h.FindMin(); ok {
				fmt.Fprintln(w, m)
			} else {
				fmt.Fprintln(w, "EMPTY")
			}
		}
	}
}
```

**Java starter.**
```java
import java.util.*;
import java.io.*;

public class BinHeap {
    static class Node {
        long key;
        int order;
        Node child, sibling;
        Node(long k) { key = k; }
    }

    Node head;

    void insert(long x) {
        // TODO
    }

    Long findMin() {
        // TODO
        return null;
    }

    static Node meld(Node a, Node b) {
        // TODO
        return null;
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        BinHeap h = new BinHeap();
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) {
            String[] p = line.split(" ");
            if (p[0].equals("INSERT")) h.insert(Long.parseLong(p[1]));
            else {
                Long m = h.findMin();
                sb.append(m == null ? "EMPTY" : m).append('\n');
            }
        }
        System.out.print(sb);
    }
}
```

**Python starter.**
```python
import sys

class Node:
    __slots__ = ("key", "order", "child", "sib")
    def __init__(self, key):
        self.key = key
        self.order = 0
        self.child = None
        self.sib = None

class BinHeap:
    def __init__(self):
        self.head = None

    def insert(self, x):
        # TODO
        pass

    def find_min(self):
        # TODO
        return None

def meld(a, b):
    # TODO
    return None

def main():
    h = BinHeap()
    out = []
    for line in sys.stdin:
        p = line.split()
        if p[0] == "INSERT":
            h.insert(int(p[1]))
        else:
            m = h.find_min()
            out.append("EMPTY" if m is None else str(m))
    sys.stdout.write("\n".join(out))

main()
```

**Evaluation criteria.**
- Correct minimum after every operation.
- Root list always sorted by order, no duplicates of the same order.
- `insert` amortised `O(1)`, `findMin` worst-case `O(log n)`.

---

### Task 2 — popcount invariant

**Problem.** After every operation, count the number of trees in the root list and verify it equals `popcount(n)` where `n` is the current size. Failing this check should abort the program with the offending op index.

**I/O spec.**
- Input: mixed `INSERT v` and `EXTRACT` operations.
- Output: `OK` if every step satisfies the invariant, otherwise `FAIL <op_index>`.

**Constraints.** `n` grows up to `10^6`.

**Hint.** Maintain a running `size` counter. After every public method, walk the root list and compare to `bits.OnesCount64(uint64(size))` / `Long.bitCount(size)` / `bin(n).count('1')`.

**Go starter.**
```go
import "math/bits"

func (h *BinHeap) checkInvariant(n int) bool {
	count := 0
	for x := h.head; x != nil; x = x.sib {
		count++
	}
	return count == bits.OnesCount(uint(n))
}
```

**Java starter.**
```java
boolean check(int n) {
    int c = 0;
    for (Node x = head; x != null; x = x.sibling) c++;
    return c == Integer.bitCount(n);
}
```

**Python starter.**
```python
def check(h, n):
    c, x = 0, h.head
    while x:
        c += 1
        x = x.sib
    return c == bin(n).count("1")
```

**Evaluation criteria.**
- Invariant holds for any input sequence.
- Test must include a 100 000-op random trace.

---

### Task 3 — meld(h1, h2)

**Problem.** Implement `meld` as a public, non-destructive operation: given two heaps, return a fresh heap containing all their elements. After meld, both inputs become empty.

**I/O spec.**
- Input: two whitespace-separated lists of integers on two lines, then `Q` queries `MIN`.
- Output: `Q` minima after meld.

**Constraints.** Lists up to `10^5` items each.

**Hint.** Meld is two steps: (1) merge the two root lists ordered by tree order, (2) walk it once and link any pair of equal-order trees the same way binary addition carries.

**Go starter.**
```go
func (h *BinHeap) Meld(other *BinHeap) {
	h.head = meld(h.head, other.head)
	other.head = nil
}

func link(a, b *node) *node {
	if a.key > b.key {
		a, b = b, a
	}
	b.sib = a.child
	a.child = b
	a.order++
	return a
}
```

**Java starter.**
```java
void meld(BinHeap other) {
    head = meld(head, other.head);
    other.head = null;
}

static Node link(Node a, Node b) {
    if (a.key > b.key) { Node t = a; a = b; b = t; }
    b.sibling = a.child;
    a.child = b;
    a.order++;
    return a;
}
```

**Python starter.**
```python
def meld_heaps(h1, h2):
    h1.head = meld(h1.head, h2.head)
    h2.head = None

def link(a, b):
    if a.key > b.key:
        a, b = b, a
    b.sib = a.child
    a.child = b
    a.order += 1
    return a
```

**Evaluation criteria.**
- Result heap satisfies the popcount invariant.
- Both inputs are empty after the call.
- `O(log n)` time.

---

### Task 4 — extract-min via detach + reverse + meld

**Problem.** Implement `extractMin()`. Steps: (1) find the root with min key, (2) unlink it from the root list, (3) reverse the order of its children so they form a valid ascending-order root list, (4) meld with the remaining heap.

**I/O spec.**
- Input: operations `INSERT v` and `POP`.
- Output: each `POP` prints the extracted minimum or `EMPTY`.

**Constraints.** `1 <= ops <= 10^6`.

**Hint.** The children of an order-`k` tree are themselves trees of orders `k-1, k-2, ..., 0` in *that* order; reversing gives the ascending root-list format meld expects.

**Go starter.**
```go
func (h *BinHeap) ExtractMin() (int64, bool) {
	if h.head == nil {
		return 0, false
	}
	// TODO: find min root, detach, reverse children, meld
	return 0, true
}
```

**Java starter.**
```java
Long extractMin() {
    if (head == null) return null;
    // TODO
    return 0L;
}
```

**Python starter.**
```python
def extract_min(self):
    if self.head is None:
        return None
    # TODO
    return 0
```

**Evaluation criteria.**
- Produces the same sorted order as `sort` on the inserted multiset.
- Popcount invariant holds after every extract.
- `O(log n)` time.

---

### Task 5 — print heap structure

**Problem.** Implement `print(out)` that writes each binomial tree in the root list on its own block: order header, then a depth-first indented listing of its nodes.

**I/O spec.**
- Input: a list of `INSERT v` then `PRINT`.
- Output: text dump.

**Constraints.** `n <= 1024`.

**Hint.** Use two spaces per depth level. Example for trees of order 2 and 0 with keys 1, 3, 4, 7 and 9:

```text
B2 root=1
  3
    7
  4
B0 root=9
```

**Go starter.**
```go
func (h *BinHeap) Print(w io.Writer) {
	for t := h.head; t != nil; t = t.sib {
		fmt.Fprintf(w, "B%d root=%d\n", t.order, t.key)
		// TODO: dfs t.child with depth=1
	}
}
```

**Java starter.**
```java
void print(PrintWriter w) {
    for (Node t = head; t != null; t = t.sibling) {
        w.printf("B%d root=%d%n", t.order, t.key);
        // TODO: dfs
    }
}
```

**Python starter.**
```python
def print_heap(self, out):
    t = self.head
    while t:
        out.write(f"B{t.order} root={t.key}\n")
        # TODO: dfs t.child
        t = t.sib
```

**Evaluation criteria.**
- Output is deterministic for the same input sequence.
- Tree shapes match the binomial recursion `B_k = B_{k-1} link B_{k-1}`.

---

## Intermediate Tasks (5)

### Task 6 — Build from array in O(n)

**Problem.** Given `arr` of length `n`, build a binomial heap by repeated `insert`. Prove and measure that the total work is `O(n)` amortised, not `O(n log n)`.

**I/O spec.**
- Input: line 1 has `n`, line 2 has `n` integers.
- Output: heap size, popcount, and total link operations performed.

**Constraints.** `n` up to `10^7`.

**Hint.** Insert is amortised `O(1)`: each insert costs the number of trailing 1-bits in `n` before the insert, and summed over `n` inserts that is `2n - popcount(n)`.

**Go starter.**
```go
func Build(arr []int64) (*BinHeap, int) {
	h := &BinHeap{}
	links := 0
	for _, v := range arr {
		// TODO: insert v, counting link calls
	}
	return h, links
}
```

**Java starter.**
```java
static int linkCount;

static BinHeap build(long[] arr) {
    BinHeap h = new BinHeap();
    linkCount = 0;
    for (long v : arr) {
        // TODO
    }
    return h;
}
```

**Python starter.**
```python
def build(arr):
    h = BinHeap()
    links = [0]
    for v in arr:
        # TODO
        pass
    return h, links[0]
```

**Evaluation criteria.**
- Empirical link count `<= 2n`.
- Wall time grows linearly with `n` across at least three sample sizes.

---

### Task 7 — K-way merge with meld

**Problem.** Given `k` sorted streams, output the merged sorted sequence. Use one binomial heap per stream, then meld them down to one and repeatedly extract-min.

**I/O spec.**
- Input: `k`, then `k` lines each a sorted list.
- Output: the merged sequence.

**Constraints.** Total items `N <= 10^6`, `k <= 10^4`.

**Hint.** For pure k-way merge a per-element heap of size `k` is enough. Use this task to compare two designs: one heap-of-heads (size `k`) versus one heap-per-stream melded then drained.

**Go starter.**
```go
func KWayMerge(streams [][]int64) []int64 {
	h := &BinHeap{}
	for _, s := range streams {
		sh := &BinHeap{}
		for _, v := range s {
			sh.Insert(v)
		}
		h.Meld(sh)
	}
	out := make([]int64, 0)
	for {
		v, ok := h.ExtractMin()
		if !ok {
			break
		}
		out = append(out, v)
	}
	return out
}
```

**Java starter.**
```java
static long[] kWayMerge(long[][] streams) {
    BinHeap h = new BinHeap();
    for (long[] s : streams) {
        BinHeap sh = new BinHeap();
        for (long v : s) sh.insert(v);
        h.meld(sh);
    }
    // TODO: drain into result
    return new long[0];
}
```

**Python starter.**
```python
def k_way_merge(streams):
    h = BinHeap()
    for s in streams:
        sh = BinHeap()
        for v in s:
            sh.insert(v)
        meld_heaps(h, sh)
    out = []
    while True:
        v = h.extract_min()
        if v is None:
            break
        out.append(v)
    return out
```

**Evaluation criteria.**
- Output is sorted and contains every input element once.
- For `N = 10^6, k = 10^4`, completes in a few seconds in compiled languages.

---

### Task 8 — decrease-key via sift-up

**Problem.** Implement `decreaseKey(handle, newKey)`. Given a node handle whose current key is replaced by `newKey <= oldKey`, restore heap order by sifting the node upward in its tree, swapping keys (and payloads) with the parent.

**I/O spec.**
- Input: operations `INSERT v` returning a handle id, `DECREASE id newKey`, `MIN`.
- Output: minima after each `MIN`.

**Constraints.** `1 <= ops <= 10^5`.

**Hint.** Nodes need a `parent` pointer to sift up. Either add one when linking, or do a DFS from the root once per decrease (slower but simpler).

**Go starter.**
```go
type node struct {
	key                 int64
	order               int
	child, sib, parent  *node
}

func (h *BinHeap) DecreaseKey(n *node, newKey int64) {
	if newKey > n.key {
		panic("new key is larger")
	}
	n.key = newKey
	// TODO: sift up swapping with parent
}
```

**Java starter.**
```java
void decreaseKey(Node n, long newKey) {
    if (newKey > n.key) throw new IllegalArgumentException();
    n.key = newKey;
    // TODO
}
```

**Python starter.**
```python
def decrease_key(self, n, new_key):
    if new_key > n.key:
        raise ValueError
    n.key = new_key
    # TODO: walk parent pointers
```

**Evaluation criteria.**
- Heap order restored after every call.
- `O(log n)` time per decrease.

---

### Task 9 — delete via decrease-key to −∞

**Problem.** Implement `delete(handle)` by first decreasing the node's key to negative infinity and then calling `extractMin`.

**I/O spec.**
- Input: ops `INSERT v` (returns id), `DELETE id`, `MIN`.
- Output: minima.

**Constraints.** `1 <= ops <= 10^5`.

**Hint.** Use the smallest representable value of your key type as `-inf`. Re-use task 4's `extractMin` directly.

**Go starter.**
```go
func (h *BinHeap) Delete(n *node) {
	h.DecreaseKey(n, math.MinInt64)
	h.ExtractMin()
}
```

**Java starter.**
```java
void delete(Node n) {
    decreaseKey(n, Long.MIN_VALUE);
    extractMin();
}
```

**Python starter.**
```python
def delete(self, n):
    self.decrease_key(n, float("-inf"))
    self.extract_min()
```

**Evaluation criteria.**
- Deleted element never returned by future `findMin`.
- Heap size decreases by 1 per call.

---

### Task 10 — Cached min-pointer for O(1) find-min

**Problem.** Maintain a `minPtr` that always points to the root with the smallest key. Update it inside `insert`, `meld`, and `extractMin` so `findMin` returns in `O(1)`.

**I/O spec.**
- Input: mixed `INSERT v` and `MIN`. The `MIN` queries dominate.
- Output: minima.

**Constraints.** `MIN` queries up to `10^7`.

**Hint.** `insert`: compare with the inserted value. `meld`: compare the two cached pointers. `extractMin`: rescan the root list once after the operation completes.

**Go starter.**
```go
type BinHeap struct {
	head, minPtr *node
}

func (h *BinHeap) Insert(x int64) {
	// TODO: update minPtr
}
```

**Java starter.**
```java
class BinHeap {
    Node head, minPtr;
    // TODO
}
```

**Python starter.**
```python
class BinHeap:
    def __init__(self):
        self.head = None
        self.min_ptr = None
```

**Evaluation criteria.**
- Benchmark with 90% `MIN` workload runs noticeably faster than task 1's implementation.
- All previous invariants still hold.

---

## Advanced Tasks (5)

### Task 11 — Indexed binomial heap for Dijkstra

**Problem.** Implement `IndexedBinomialHeap[K]` that maps each unique key (graph vertex) to a node handle so `decreaseKey(vertex, newDist)` runs in `O(log n)` without a linear search. Use it as Dijkstra's priority queue on a directed weighted graph.

**I/O spec.**
- Input: `V E source`, then `E` lines `u v w`.
- Output: `V` shortest distances or `INF`.

**Constraints.** `V <= 10^5`, `E <= 5 * 10^5`, weights non-negative.

**Hint.** Store `handle[v] = *node`. When you sift up by swapping payloads, also update the handle map. Decide once and document whether you swap payloads or rewire pointers — swapping payloads is simpler.

**Go starter.**
```go
type IndexedBH struct {
	head, minPtr *node
	handle       map[int]*node
}

func Dijkstra(V int, adj [][]Edge, src int) []int64 {
	dist := make([]int64, V)
	// TODO
	return dist
}
```

**Java starter.**
```java
class IndexedBH<K extends Comparable<K>> {
    Map<K, Node> handle = new HashMap<>();
    // TODO
}
```

**Python starter.**
```python
class IndexedBH:
    def __init__(self):
        self.handle = {}
        self.head = None
        self.min_ptr = None
```

**Evaluation criteria.**
- Matches `dijkstra` from a reference (e.g. `container/heap` in Go) for 20 random graphs.
- Each `decreaseKey` is `O(log V)` confirmed by a counter.

---

### Task 12 — Benchmark vs binary heap on Dijkstra

**Problem.** Run Dijkstra with both an indexed binomial heap and a binary heap with lazy deletions, on the same random graphs of `V = 10^4, E = 5 * 10^4`. Report wall time, instructions per edge, and number of `decreaseKey` calls.

**I/O spec.**
- Input: seed and `(V, E)`.
- Output: a CSV row `impl,V,E,seed,ms,decreaseKeyCalls`.

**Constraints.** At least 10 seeds per `(V, E)`; report median.

**Hint.** Use the same RNG seed for graph generation across implementations. Warm up the JIT on Java (run twice, report the second run).

**Go starter.**
```go
func Bench(seed int64, V, E int) (ms float64, calls int) {
	// TODO
	return 0, 0
}
```

**Java starter.**
```java
static double[] bench(long seed, int V, int E) {
    // returns {ms, decreaseKeyCalls}
    return new double[2];
}
```

**Python starter.**
```python
def bench(seed, V, E):
    # returns (ms, decrease_key_calls)
    return 0.0, 0
```

**Evaluation criteria.**
- Binary heap usually wins on dense graphs; binomial heap stays competitive on sparse ones.
- A short results table in the writeup with the median row per implementation.

---

### Task 13 — Purely functional binomial heap

**Problem.** Implement a binomial heap with no mutation: every operation returns a new heap value, sharing subtrees with the old one. Link reuses the smaller-root subtree without modifying it.

**I/O spec.**
- Input: a script of operations on a *family* of heaps (e.g. version IDs).
- Output: results of `MIN i` on any past version `i`.

**Constraints.** Up to `10^4` versions.

**Hint.** Represent the root list as an immutable linked list of immutable tree records. Linking allocates one new tree node whose children list begins with the other root, prepended to the old children list.

**Go starter.**
```go
type pnode struct {
	key      int64
	order    int
	children *pnode // singly linked siblings via .next
	next     *pnode
}

func PInsert(h *pnode, k int64) *pnode {
	// TODO: returns new head
	return nil
}
```

**Java starter.**
```java
record PNode(long key, int order, PNode children, PNode next) {}

static PNode pInsert(PNode h, long k) {
    // TODO
    return null;
}
```

**Python starter.**
```python
from collections import namedtuple
PNode = namedtuple("PNode", "key order children next")

def p_insert(h, k):
    # TODO
    return None
```

**Evaluation criteria.**
- Old versions remain queryable and unchanged.
- Memory usage grows by `O(log n)` per update, not `O(n)`.

---

### Task 14 — Skew binomial heap (Brodal-Okasaki)

**Problem.** Implement a skew binomial heap with `O(1)` worst-case insert. Trees may now have a small list of *extra* roots besides the standard binomial structure; a "skew link" handles ranks `r, r, r`.

**I/O spec.**
- Input: `INSERT v`, `MIN`, `POP`.
- Output: minima.

**Constraints.** `10^6` operations.

**Hint.** Maintain the root list in the canonical Okasaki form: either the first two trees have equal rank (do a skew link on insert) or they don't (do a simple cons). See Okasaki, "Purely Functional Data Structures", chapter 9.

**Go starter.**
```go
type sknode struct {
	key   int64
	rank  int
	roots []int64 // extra skew roots
	kids  []*sknode
}

func SkInsert(h []*sknode, k int64) []*sknode {
	// TODO
	return nil
}
```

**Java starter.**
```java
class SkNode {
    long key;
    int rank;
    long[] roots;
    SkNode[] kids;
}
```

**Python starter.**
```python
class SkNode:
    __slots__ = ("key", "rank", "roots", "kids")
    def __init__(self, key, rank, roots, kids):
        self.key, self.rank, self.roots, self.kids = key, rank, roots, kids
```

**Evaluation criteria.**
- Single-insert wall time independent of `n` (graph or table).
- Total time for `n` inserts then `n` pops matches binomial heap within 20%.

---

### Task 15 — Binomial heap inside a leftist k-way meld benchmark

**Problem.** Compare three implementations of "merge `k` priority queues into one and drain": (a) binomial heap with `meld`, (b) leftist heap with `meld`, (c) binary heap of heaps. Use binomial heap as the sub-component for option (a).

**I/O spec.**
- Input: `k` and total `N`.
- Output: CSV `impl,k,N,ms,melds,linkOps`.

**Constraints.** `k <= 10^4`, `N <= 10^7`.

**Hint.** Leftist heaps meld in `O(log n)` per call but the constant is higher than binomial linking. Binary-heap-of-heaps approach is `O(N log k)` overall and surprisingly hard to beat in practice.

**Go starter.**
```go
type Impl int
const (
	IBinomial Impl = iota
	ILeftist
	IBinHeapOfHeaps
)

func BenchMeld(impl Impl, k, N int) Result {
	// TODO
	return Result{}
}
```

**Java starter.**
```java
enum Impl { BINOMIAL, LEFTIST, BIN_HEAP_OF_HEAPS }

static Result benchMeld(Impl impl, int k, int N) {
    return new Result();
}
```

**Python starter.**
```python
def bench_meld(impl, k, N):
    # impl in {"binomial", "leftist", "heap_of_heaps"}
    return {"ms": 0.0, "melds": 0, "link_ops": 0}
```

**Evaluation criteria.**
- All three implementations produce identical sorted outputs.
- Results table identifies the winner per `(k, N)` regime and explains why.

---

## Benchmark Task

**Problem.** Run the canonical "push n then pop n" workload on three heap implementations — binomial, binary, pairing — in all three languages, for `n in {10^4, 10^5, 10^6}`. Produce one CSV with columns `lang,impl,n,push_ms,pop_ms,total_ms,peak_bytes` and a short writeup.

**Methodology.**
1. Generate inputs with a fixed 64-bit RNG seed shared across all runs.
2. Discard the first run per `(lang, impl, n)` (warm-up); take the median of 5 subsequent runs.
3. Measure `push_ms`, `pop_ms`, `total_ms` separately. Use a monotonic clock.
4. Measure `peak_bytes` via `runtime.ReadMemStats` (Go), `MemoryMXBean` (Java), `tracemalloc` (Python).
5. Disable GC during the timed section if the language allows it; report whether you did.

**Expected qualitative results.**

```text
lang   impl       push   pop    notes
Go     binary     fast   fast   contiguous slice, cache-friendly
Go     binomial   ok     slow   pointer chasing in extract-min
Go     pairing    fast   ok     2-pass merge during extract
Java   ...
Python ...
```

**I/O spec.**
- Output: a single CSV file `bench.csv` and a `bench.md` table.

**Constraints.** Total wall time per language under 5 minutes on a modern laptop.

**Evaluation criteria.**
- CSV is reproducible from the same seed.
- Conclusions reference the measured numbers, not folklore.
- A paragraph explaining which heap you would pick for: a Dijkstra implementation, a discrete-event simulator, a streaming top-k.
