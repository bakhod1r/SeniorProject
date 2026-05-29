# Binary Heap — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with starter code in all three languages. Fill in the heap logic and validate against the evaluation criteria.

---

## Beginner Tasks (5)

### Task 1 — Implement push/pop for an int min-heap from scratch

**Problem.** Build a min-heap backed by a dynamic array. Implement `push(x)` and `pop()` without using any standard library heap utilities. After every operation, the array must satisfy the min-heap property: for every index `i > 0`, `a[(i-1)/2] <= a[i]`.

**Input / Output spec.**
- A sequence of operations: `push x` or `pop`.
- For each `pop`, print the removed minimum on its own line.

**Constraints.**
- `1 <= total operations <= 10^6`.
- Values fit in a signed 32-bit integer.
- Time per operation: `O(log n)`.

**Hint.** Sift-up on insertion, sift-down on removal. Swap with the last element before shrinking the array.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

type MinHeap struct {
	data []int
}

func (h *MinHeap) Push(x int) {
	// TODO: append, then sift-up from len-1
}

func (h *MinHeap) Pop() int {
	// TODO: swap root with last, shrink, sift-down from 0, return removed
	return 0
}

func (h *MinHeap) siftUp(i int)   { /* TODO */ }
func (h *MinHeap) siftDown(i int) { /* TODO */ }

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	h := &MinHeap{}
	var op string
	for {
		if _, err := fmt.Fscan(in, &op); err != nil {
			return
		}
		switch op {
		case "push":
			var x int
			fmt.Fscan(in, &x)
			h.Push(x)
		case "pop":
			fmt.Fprintln(out, h.Pop())
		}
	}
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task1 {
    static int[] data = new int[16];
    static int size = 0;

    static void push(int x) {
        // TODO: grow if needed, place at index size, sift-up
    }

    static int pop() {
        // TODO: take root, move last to root, sift-down, return removed
        return 0;
    }

    static void siftUp(int i)   { /* TODO */ }
    static void siftDown(int i) { /* TODO */ }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) {
            StringTokenizer st = new StringTokenizer(line);
            String op = st.nextToken();
            if (op.equals("push")) push(Integer.parseInt(st.nextToken()));
            else sb.append(pop()).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
import sys

class MinHeap:
    def __init__(self):
        self.data = []

    def push(self, x: int) -> None:
        # TODO: append, sift-up
        pass

    def pop(self) -> int:
        # TODO: swap root with last, pop last, sift-down, return removed
        return 0

    def _sift_up(self, i: int) -> None:   ...
    def _sift_down(self, i: int) -> None: ...


def main() -> None:
    h = MinHeap()
    out = []
    for line in sys.stdin:
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "push":
            h.push(int(parts[1]))
        else:
            out.append(str(h.pop()))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `push` and `pop` run in `O(log n)`.
- No standard library heap used.
- The heap property holds after every operation (assert it in tests).
- Handles `pop` from empty as a defined error (panic, exception, sentinel — pick one and document it).

---

### Task 2 — Convert a min-heap to a max-heap in place

**Problem.** You are given an array that already satisfies the min-heap property. Rebuild it in place so that it satisfies the max-heap property. You may not allocate a new array of size `n`.

**Input / Output spec.**
- Input: integer `n`, then `n` integers forming a valid min-heap.
- Output: the array rearranged as a valid max-heap, space-separated.

**Constraints.**
- `1 <= n <= 10^6`.
- Extra memory: `O(1)` beyond the input array.
- Total time: `O(n)`.

**Hint.** Run Floyd's heapify with a max-heap sift-down from `n/2 - 1` down to `0`. The min-heap structure is irrelevant — heapify treats the array as raw.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func minToMax(a []int) {
	// TODO: for i := len(a)/2 - 1; i >= 0; i-- { siftDownMax(a, i, len(a)) }
}

func siftDownMax(a []int, i, n int) { /* TODO */ }

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	a := make([]int, n)
	for i := range a {
		fmt.Fscan(in, &a[i])
	}
	minToMax(a)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for i, v := range a {
		if i > 0 {
			out.WriteByte(' ')
		}
		fmt.Fprint(out, v)
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task2 {
    static void minToMax(int[] a) {
        // TODO: heapify with max sift-down, last non-leaf to root
    }

    static void siftDownMax(int[] a, int i, int n) { /* TODO */ }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] a = new int[n];
        for (int i = 0; i < n; i++) a[i] = sc.nextInt();
        minToMax(a);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            if (i > 0) sb.append(' ');
            sb.append(a[i]);
        }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import sys
from typing import List


def min_to_max(a: List[int]) -> None:
    n = len(a)
    # TODO: for i in range(n // 2 - 1, -1, -1): _sift_down_max(a, i, n)


def _sift_down_max(a: List[int], i: int, n: int) -> None:
    # TODO
    pass


def main() -> None:
    data = sys.stdin.read().split()
    n = int(data[0])
    a = list(map(int, data[1:1 + n]))
    min_to_max(a)
    sys.stdout.write(" ".join(map(str, a)))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Total runtime is `O(n)`, not `O(n log n)`.
- No auxiliary array of size `n`.
- Final array passes a max-heap validator.

---

### Task 3 — Verify if a given array is a valid heap

**Problem.** Given an array and a flag `kind` (`"min"` or `"max"`), report whether it satisfies the corresponding binary-heap property under array-of-tree indexing.

**Input / Output spec.**
- Input: `kind`, then `n`, then `n` integers.
- Output: `true` or `false`.

**Constraints.**
- `1 <= n <= 10^6`.
- Single pass, `O(n)` time, `O(1)` extra memory.

**Hint.** Check children of indices `0..n/2 - 1` only. Children are at `2i+1` and `2i+2` if they exist.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

func isHeap(a []int, kind string) bool {
	// TODO: loop i = 0..n/2 - 1, compare with present children
	return false
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var kind string
	var n int
	fmt.Fscan(in, &kind, &n)
	a := make([]int, n)
	for i := range a {
		fmt.Fscan(in, &a[i])
	}
	fmt.Println(isHeap(a, kind))
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task3 {
    static boolean isHeap(int[] a, String kind) {
        // TODO
        return false;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String kind = sc.next();
        int n = sc.nextInt();
        int[] a = new int[n];
        for (int i = 0; i < n; i++) a[i] = sc.nextInt();
        System.out.println(isHeap(a, kind));
    }
}
```

**Starter — Python.**
```python
import sys
from typing import List


def is_heap(a: List[int], kind: str) -> bool:
    # TODO
    return False


def main() -> None:
    data = sys.stdin.read().split()
    kind = data[0]
    n = int(data[1])
    a = list(map(int, data[2:2 + n]))
    print(str(is_heap(a, kind)).lower())


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Correctly handles `n = 0` and `n = 1` (trivially a heap).
- Single linear pass.
- Returns at the first violation — no full scan when a violation is found early.

---

### Task 4 — Replace the root with a new value and restore heap order

**Problem.** Implement a `replaceRoot(x)` operation on a min-heap: overwrite the value at index 0 with `x`, then restore the heap property. Compare it against the naive `pop` + `push` baseline. Both should yield the same final array, but `replaceRoot` performs only one sift-down.

**Input / Output spec.**
- Input: `n`, the heap array, then `m` and `m` replacement values.
- Output: the heap state after all replacements, space-separated.

**Constraints.**
- `1 <= n, m <= 10^5`.
- Each `replaceRoot` must run in a single `O(log n)` sift-down.

**Hint.** No sift-up is needed — the new root only ever moves downward in the tree.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

type MinHeap struct{ data []int }

func (h *MinHeap) ReplaceRoot(x int) {
	if len(h.data) == 0 {
		h.data = append(h.data, x)
		return
	}
	h.data[0] = x
	// TODO: sift-down from 0
}

func (h *MinHeap) siftDown(i int) { /* TODO */ }

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	h := &MinHeap{data: make([]int, n)}
	for i := range h.data {
		fmt.Fscan(in, &h.data[i])
	}
	var m int
	fmt.Fscan(in, &m)
	for ; m > 0; m-- {
		var x int
		fmt.Fscan(in, &x)
		h.ReplaceRoot(x)
	}
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for i, v := range h.data {
		if i > 0 {
			out.WriteByte(' ')
		}
		fmt.Fprint(out, v)
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task4 {
    static int[] data;
    static int size;

    static void replaceRoot(int x) {
        if (size == 0) { data[size++] = x; return; }
        data[0] = x;
        // TODO: sift-down
    }

    static void siftDown(int i) { /* TODO */ }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        data = new int[n + 1];
        for (int i = 0; i < n; i++) data[i] = sc.nextInt();
        size = n;
        int m = sc.nextInt();
        for (int i = 0; i < m; i++) replaceRoot(sc.nextInt());
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < size; i++) {
            if (i > 0) sb.append(' ');
            sb.append(data[i]);
        }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import sys
from typing import List


class MinHeap:
    def __init__(self, data: List[int]):
        self.data = data

    def replace_root(self, x: int) -> None:
        if not self.data:
            self.data.append(x)
            return
        self.data[0] = x
        # TODO: sift-down from 0

    def _sift_down(self, i: int) -> None:
        # TODO
        pass


def main() -> None:
    tokens = sys.stdin.read().split()
    p = 0
    n = int(tokens[p]); p += 1
    data = list(map(int, tokens[p:p + n])); p += n
    m = int(tokens[p]); p += 1
    h = MinHeap(data)
    for x in map(int, tokens[p:p + m]):
        h.replace_root(x)
    sys.stdout.write(" ".join(map(str, h.data)))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Exactly one sift-down per replacement, no separate sift-up.
- Verified against a reference `pop` + `push` implementation.
- Constant extra memory.

---

### Task 5 — k-th smallest element via a max-heap of size k

**Problem.** Given an unsorted array `a` and an integer `k`, return the `k`-th smallest element. You must use a bounded max-heap of size at most `k`.

**Input / Output spec.**
- Input: `n`, `k`, then `n` integers.
- Output: the `k`-th smallest value.

**Constraints.**
- `1 <= k <= n <= 10^6`.
- Time: `O(n log k)`.
- Memory: `O(k)`.

**Hint.** Push the first `k` elements into a max-heap. For every later element `x`, if `x < heap.peek()` then replace the root with `x` and sift down. The root at the end is the `k`-th smallest.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"container/heap"
	"fmt"
	"os"
)

type maxHeap []int

func (h maxHeap) Len() int            { return len(h) }
func (h maxHeap) Less(i, j int) bool  { return h[i] > h[j] }
func (h maxHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *maxHeap) Push(x any)         { *h = append(*h, x.(int)) }
func (h *maxHeap) Pop() any           { n := len(*h); v := (*h)[n-1]; *h = (*h)[:n-1]; return v }

func kthSmallest(a []int, k int) int {
	// TODO: maintain bounded max-heap of size k
	return 0
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, k int
	fmt.Fscan(in, &n, &k)
	a := make([]int, n)
	for i := range a {
		fmt.Fscan(in, &a[i])
	}
	fmt.Println(kthSmallest(a, k))
	_ = heap.Init
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task5 {
    static int kthSmallest(int[] a, int k) {
        // TODO: PriorityQueue with Comparator.reverseOrder()
        return 0;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int k = sc.nextInt();
        int[] a = new int[n];
        for (int i = 0; i < n; i++) a[i] = sc.nextInt();
        System.out.println(kthSmallest(a, k));
    }
}
```

**Starter — Python.**
```python
import heapq
import sys
from typing import List


def kth_smallest(a: List[int], k: int) -> int:
    # TODO: bounded max-heap using negated values
    return 0


def main() -> None:
    data = sys.stdin.read().split()
    n, k = int(data[0]), int(data[1])
    a = list(map(int, data[2:2 + n]))
    print(kth_smallest(a, k))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Memory usage proportional to `k`, not `n`.
- Correct for `k = 1` (the minimum) and `k = n` (the maximum).
- Beats a full `O(n log n)` sort on benchmarks for `k << n`.

---

## Intermediate Tasks (5)

### Task 6 — Merge `K` sorted arrays using a min-heap of pointers

**Problem.** Given `K` sorted ascending arrays, merge them into one sorted array. Use a min-heap whose entries are `(value, arrayIndex, indexInArray)` so the heap always exposes the next global minimum.

**Input / Output spec.**
- Input: `K`, then for each `i` the length `n_i` followed by the `n_i` sorted values.
- Output: the merged sorted sequence, space-separated.

**Constraints.**
- `1 <= K <= 10^4`, total elements `N <= 10^6`.
- Time: `O(N log K)`.
- Memory beyond input/output: `O(K)`.

**Hint.** Seed the heap with the first element of each array. On every pop, push the next element from the same array (if any).

**Starter — Go.**
```go
package main

import (
	"bufio"
	"container/heap"
	"fmt"
	"os"
)

type node struct{ val, arr, idx int }
type minH []node

func (h minH) Len() int            { return len(h) }
func (h minH) Less(i, j int) bool  { return h[i].val < h[j].val }
func (h minH) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *minH) Push(x any)         { *h = append(*h, x.(node)) }
func (h *minH) Pop() any           { n := len(*h); v := (*h)[n-1]; *h = (*h)[:n-1]; return v }

func mergeK(arrs [][]int) []int {
	// TODO: heap-of-pointers merge
	return nil
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var k int
	fmt.Fscan(in, &k)
	arrs := make([][]int, k)
	for i := 0; i < k; i++ {
		var n int
		fmt.Fscan(in, &n)
		arrs[i] = make([]int, n)
		for j := range arrs[i] {
			fmt.Fscan(in, &arrs[i][j])
		}
	}
	res := mergeK(arrs)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for i, v := range res {
		if i > 0 {
			out.WriteByte(' ')
		}
		fmt.Fprint(out, v)
	}
	_ = heap.Init
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task6 {
    record Node(int val, int arr, int idx) {}

    static int[] mergeK(int[][] arrs) {
        // TODO: PriorityQueue<Node> by val
        return new int[0];
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int k = sc.nextInt();
        int[][] arrs = new int[k][];
        for (int i = 0; i < k; i++) {
            int n = sc.nextInt();
            arrs[i] = new int[n];
            for (int j = 0; j < n; j++) arrs[i][j] = sc.nextInt();
        }
        int[] res = mergeK(arrs);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < res.length; i++) {
            if (i > 0) sb.append(' ');
            sb.append(res[i]);
        }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import heapq
import sys
from typing import List


def merge_k(arrs: List[List[int]]) -> List[int]:
    # TODO: heap entries are (value, array_idx, in_array_idx)
    return []


def main() -> None:
    data = iter(sys.stdin.read().split())
    k = int(next(data))
    arrs: List[List[int]] = []
    for _ in range(k):
        n = int(next(data))
        arrs.append([int(next(data)) for _ in range(n)])
    sys.stdout.write(" ".join(map(str, merge_k(arrs))))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Heap size never exceeds `K`.
- Stable on duplicate values (use the array index as the tiebreaker).
- Correct on `K = 1` and on arrays of mixed lengths.

---

### Task 7 — Sort an almost-sorted array (each element at most `k` away)

**Problem.** Given an array where every element is at most `k` index positions away from its sorted position, sort it. Use a min-heap of size `k + 1`.

**Input / Output spec.**
- Input: `n`, `k`, then `n` integers.
- Output: sorted array, space-separated.

**Constraints.**
- `0 <= k < n <= 10^6`.
- Time: `O(n log k)`.
- Memory beyond input: `O(k)`.

**Hint.** Push the first `k + 1` elements into the heap. Then for every subsequent element, pop the minimum and push the new element.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"container/heap"
	"fmt"
	"os"
)

type minIntH []int

func (h minIntH) Len() int            { return len(h) }
func (h minIntH) Less(i, j int) bool  { return h[i] < h[j] }
func (h minIntH) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *minIntH) Push(x any)         { *h = append(*h, x.(int)) }
func (h *minIntH) Pop() any           { n := len(*h); v := (*h)[n-1]; *h = (*h)[:n-1]; return v }

func sortK(a []int, k int) []int {
	// TODO
	return nil
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, k int
	fmt.Fscan(in, &n, &k)
	a := make([]int, n)
	for i := range a {
		fmt.Fscan(in, &a[i])
	}
	res := sortK(a, k)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for i, v := range res {
		if i > 0 {
			out.WriteByte(' ')
		}
		fmt.Fprint(out, v)
	}
	_ = heap.Init
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task7 {
    static int[] sortK(int[] a, int k) {
        // TODO
        return new int[0];
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int k = sc.nextInt();
        int[] a = new int[n];
        for (int i = 0; i < n; i++) a[i] = sc.nextInt();
        int[] res = sortK(a, k);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < res.length; i++) {
            if (i > 0) sb.append(' ');
            sb.append(res[i]);
        }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import heapq
import sys
from typing import List


def sort_k(a: List[int], k: int) -> List[int]:
    # TODO
    return []


def main() -> None:
    data = sys.stdin.read().split()
    n, k = int(data[0]), int(data[1])
    a = list(map(int, data[2:2 + n]))
    sys.stdout.write(" ".join(map(str, sort_k(a, k))))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Output is fully sorted.
- Heap size stays at most `k + 1`.
- Works correctly for `k = 0` (already sorted) and `k = n - 1` (effectively unsorted).

---

### Task 8 — Connect ropes for minimum cost

**Problem.** You have `n` ropes of given lengths. Connecting two ropes of length `x` and `y` costs `x + y` and yields one rope of length `x + y`. Connect them all into a single rope so that the total cost is minimized. Return that cost.

**Input / Output spec.**
- Input: `n`, then `n` rope lengths.
- Output: total minimum cost.

**Constraints.**
- `1 <= n <= 10^6`.
- Lengths fit in 32 bits, but the total cost can need 64-bit.
- Time: `O(n log n)`.

**Hint.** Use a min-heap. Repeatedly pop the two smallest ropes, push their sum, accumulate the sum into the total.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"container/heap"
	"fmt"
	"os"
)

type minH64 []int64

func (h minH64) Len() int            { return len(h) }
func (h minH64) Less(i, j int) bool  { return h[i] < h[j] }
func (h minH64) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *minH64) Push(x any)         { *h = append(*h, x.(int64)) }
func (h *minH64) Pop() any           { n := len(*h); v := (*h)[n-1]; *h = (*h)[:n-1]; return v }

func connectRopes(lengths []int64) int64 {
	// TODO
	return 0
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	lengths := make([]int64, n)
	for i := range lengths {
		fmt.Fscan(in, &lengths[i])
	}
	fmt.Println(connectRopes(lengths))
	_ = heap.Init
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task8 {
    static long connectRopes(long[] lengths) {
        // TODO: PriorityQueue<Long>
        return 0L;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long[] lengths = new long[n];
        for (int i = 0; i < n; i++) lengths[i] = sc.nextLong();
        System.out.println(connectRopes(lengths));
    }
}
```

**Starter — Python.**
```python
import heapq
import sys
from typing import List


def connect_ropes(lengths: List[int]) -> int:
    # TODO
    return 0


def main() -> None:
    data = sys.stdin.read().split()
    n = int(data[0])
    lengths = list(map(int, data[1:1 + n]))
    print(connect_ropes(lengths))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Returns 0 for `n <= 1`.
- Uses 64-bit accumulation to avoid overflow.
- Optimal cost matches the Huffman-style lower bound.

---

### Task 9 — Top-k frequent elements

**Problem.** Given an array `a` and an integer `k`, return the `k` values with the highest frequencies. Order among the returned `k` is unspecified, but the set must be correct.

**Input / Output spec.**
- Input: `n`, `k`, then `n` integers.
- Output: `k` distinct values, space-separated.

**Constraints.**
- `1 <= k <= |distinct(a)| <= n <= 10^6`.
- Time: `O(n + d log k)` where `d = |distinct(a)|`.

**Hint.** Count frequencies in a hash map, then push `(count, value)` pairs into a min-heap bounded at size `k`. Whatever remains is the top-k by frequency.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"container/heap"
	"fmt"
	"os"
)

type freq struct{ count, val int }
type minFreq []freq

func (h minFreq) Len() int            { return len(h) }
func (h minFreq) Less(i, j int) bool  { return h[i].count < h[j].count }
func (h minFreq) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *minFreq) Push(x any)         { *h = append(*h, x.(freq)) }
func (h *minFreq) Pop() any           { n := len(*h); v := (*h)[n-1]; *h = (*h)[:n-1]; return v }

func topK(a []int, k int) []int {
	// TODO
	return nil
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, k int
	fmt.Fscan(in, &n, &k)
	a := make([]int, n)
	for i := range a {
		fmt.Fscan(in, &a[i])
	}
	res := topK(a, k)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for i, v := range res {
		if i > 0 {
			out.WriteByte(' ')
		}
		fmt.Fprint(out, v)
	}
	_ = heap.Init
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task9 {
    static int[] topK(int[] a, int k) {
        // TODO: HashMap counts, PriorityQueue<int[]> min-by-count, cap at k
        return new int[0];
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int k = sc.nextInt();
        int[] a = new int[n];
        for (int i = 0; i < n; i++) a[i] = sc.nextInt();
        int[] res = topK(a, k);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < res.length; i++) {
            if (i > 0) sb.append(' ');
            sb.append(res[i]);
        }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import heapq
import sys
from collections import Counter
from typing import List


def top_k(a: List[int], k: int) -> List[int]:
    # TODO: Counter + bounded heap of (count, value)
    return []


def main() -> None:
    data = sys.stdin.read().split()
    n, k = int(data[0]), int(data[1])
    a = list(map(int, data[2:2 + n]))
    sys.stdout.write(" ".join(map(str, top_k(a, k))))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Result has exactly `k` distinct values.
- Frequencies of returned values are `>=` frequencies of all excluded values.
- Heap is bounded by `k`, not by the number of distinct values.

---

### Task 10 — Sliding window maximum (max-heap with stale-entry skipping)

**Problem.** Given an array `a` and a window size `w`, output the maximum of every window of size `w`. Implement it with a max-heap that stores `(value, index)` pairs and skips entries whose index has fallen out of the window.

**Input / Output spec.**
- Input: `n`, `w`, then `n` integers.
- Output: `n - w + 1` maxima, space-separated.

**Constraints.**
- `1 <= w <= n <= 10^6`.
- Amortized time: `O(n log n)`.

**Hint.** Push every new element. Before reading the max, repeatedly pop the top while its stored index is `< i - w + 1`.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"container/heap"
	"fmt"
	"os"
)

type entry struct{ val, idx int }
type maxH []entry

func (h maxH) Len() int            { return len(h) }
func (h maxH) Less(i, j int) bool  { return h[i].val > h[j].val }
func (h maxH) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *maxH) Push(x any)         { *h = append(*h, x.(entry)) }
func (h *maxH) Pop() any           { n := len(*h); v := (*h)[n-1]; *h = (*h)[:n-1]; return v }

func windowMax(a []int, w int) []int {
	// TODO: push as we go, skip stale tops before reading
	return nil
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, w int
	fmt.Fscan(in, &n, &w)
	a := make([]int, n)
	for i := range a {
		fmt.Fscan(in, &a[i])
	}
	res := windowMax(a, w)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for i, v := range res {
		if i > 0 {
			out.WriteByte(' ')
		}
		fmt.Fprint(out, v)
	}
	_ = heap.Init
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task10 {
    static int[] windowMax(int[] a, int w) {
        // TODO: PriorityQueue<int[]{value, index}> max-by-value
        return new int[0];
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int w = sc.nextInt();
        int[] a = new int[n];
        for (int i = 0; i < n; i++) a[i] = sc.nextInt();
        int[] res = windowMax(a, w);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < res.length; i++) {
            if (i > 0) sb.append(' ');
            sb.append(res[i]);
        }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
import heapq
import sys
from typing import List


def window_max(a: List[int], w: int) -> List[int]:
    # TODO: heap of (-value, index); pop stale before reading
    return []


def main() -> None:
    data = sys.stdin.read().split()
    n, w = int(data[0]), int(data[1])
    a = list(map(int, data[2:2 + n]))
    sys.stdout.write(" ".join(map(str, window_max(a, w))))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Output length equals `n - w + 1`.
- Results match a brute `O(n*w)` reference on random small inputs.
- Stale entries are discarded lazily, not eagerly deleted.

---

## Advanced Tasks (5)

### Task 11 — Indexed binary heap with `decreaseKey`

**Problem.** Implement an indexed min-heap that exposes:
- `insert(id, key)` — add an entry with external identifier `id`.
- `peek()` — return the `(id, key)` with the smallest key.
- `extractMin()` — remove and return it.
- `decreaseKey(id, newKey)` — lower the key of an entry by external id in `O(log n)`.
- `contains(id)` — `O(1)` lookup.

Maintain two arrays: `heap` (positions to ids) and `pos` (id to heap index). Every swap during sift updates both arrays so `pos` stays consistent.

**Input / Output spec.**
- Operations: `insert id key`, `extract`, `decrease id newKey`, `peek`.
- Output: one line per `extract` / `peek` containing `id key`.

**Constraints.**
- Identifiers are integers in `[0, n)`, with `n <= 10^6`.
- Each operation: `O(log n)`.

**Hint.** `decreaseKey` only needs sift-up. Allocate `pos` once; mark missing ids with `-1`.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"os"
)

type IndexedHeap struct {
	heap []int  // heap[i] = id at position i
	pos  []int  // pos[id] = position of id, or -1
	key  []int64
}

func NewIndexedHeap(n int) *IndexedHeap {
	pos := make([]int, n)
	for i := range pos {
		pos[i] = -1
	}
	return &IndexedHeap{pos: pos, key: make([]int64, n)}
}

func (h *IndexedHeap) Contains(id int) bool { return h.pos[id] != -1 }
func (h *IndexedHeap) Insert(id int, k int64) { /* TODO */ }
func (h *IndexedHeap) Peek() (int, int64)     { /* TODO */ return 0, 0 }
func (h *IndexedHeap) ExtractMin() (int, int64) { /* TODO */ return 0, 0 }
func (h *IndexedHeap) DecreaseKey(id int, k int64) { /* TODO */ }
func (h *IndexedHeap) siftUp(i int)             { /* TODO */ }
func (h *IndexedHeap) siftDown(i int)           { /* TODO */ }

func main() {
	in := bufio.NewReader(os.Stdin)
	var n int
	fmt.Fscan(in, &n)
	h := NewIndexedHeap(n)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var op string
	for {
		if _, err := fmt.Fscan(in, &op); err != nil {
			return
		}
		switch op {
		case "insert":
			var id int
			var k int64
			fmt.Fscan(in, &id, &k)
			h.Insert(id, k)
		case "extract":
			id, k := h.ExtractMin()
			fmt.Fprintf(out, "%d %d\n", id, k)
		case "decrease":
			var id int
			var k int64
			fmt.Fscan(in, &id, &k)
			h.DecreaseKey(id, k)
		case "peek":
			id, k := h.Peek()
			fmt.Fprintf(out, "%d %d\n", id, k)
		}
	}
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task11 {
    static int[] heap;
    static int[] pos;
    static long[] key;
    static int size;

    static void init(int n) {
        heap = new int[n + 1];
        pos = new int[n];
        Arrays.fill(pos, -1);
        key = new long[n];
        size = 0;
    }

    static boolean contains(int id)                  { return pos[id] != -1; }
    static void insert(int id, long k)               { /* TODO */ }
    static long[] peek()                              { /* TODO returns {id, key} */ return new long[]{0, 0}; }
    static long[] extractMin()                        { /* TODO */ return new long[]{0, 0}; }
    static void decreaseKey(int id, long k)           { /* TODO */ }
    static void siftUp(int i)                         { /* TODO */ }
    static void siftDown(int i)                       { /* TODO */ }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringBuilder sb = new StringBuilder();
        StreamTokenizer tok = new StreamTokenizer(br);
        tok.nextToken(); init((int) tok.nval);
        tok.wordChars('a', 'z');
        while (tok.nextToken() != StreamTokenizer.TT_EOF) {
            String op = tok.sval;
            if (op == null) continue;
            switch (op) {
                case "insert" -> {
                    tok.nextToken(); int id = (int) tok.nval;
                    tok.nextToken(); long k = (long) tok.nval;
                    insert(id, k);
                }
                case "extract" -> {
                    long[] r = extractMin();
                    sb.append(r[0]).append(' ').append(r[1]).append('\n');
                }
                case "decrease" -> {
                    tok.nextToken(); int id = (int) tok.nval;
                    tok.nextToken(); long k = (long) tok.nval;
                    decreaseKey(id, k);
                }
                case "peek" -> {
                    long[] r = peek();
                    sb.append(r[0]).append(' ').append(r[1]).append('\n');
                }
            }
        }
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
import sys
from typing import List, Tuple


class IndexedHeap:
    def __init__(self, n: int):
        self.heap: List[int] = []
        self.pos: List[int] = [-1] * n
        self.key: List[int] = [0] * n

    def contains(self, id_: int) -> bool: return self.pos[id_] != -1
    def insert(self, id_: int, k: int) -> None: ...
    def peek(self) -> Tuple[int, int]: ...
    def extract_min(self) -> Tuple[int, int]: ...
    def decrease_key(self, id_: int, k: int) -> None: ...
    def _sift_up(self, i: int) -> None: ...
    def _sift_down(self, i: int) -> None: ...


def main() -> None:
    tokens = iter(sys.stdin.read().split())
    n = int(next(tokens))
    h = IndexedHeap(n)
    out = []
    for op in tokens:
        if op == "insert":
            h.insert(int(next(tokens)), int(next(tokens)))
        elif op == "extract":
            id_, k = h.extract_min()
            out.append(f"{id_} {k}")
        elif op == "decrease":
            h.decrease_key(int(next(tokens)), int(next(tokens)))
        elif op == "peek":
            id_, k = h.peek()
            out.append(f"{id_} {k}")
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- `pos[heap[i]] == i` holds after every operation.
- `decreaseKey` rejects increases (define behavior: ignore or panic — be explicit).
- All operations run in `O(log n)`; `contains` runs in `O(1)`.

---

### Task 12 — Dijkstra's shortest path using the indexed heap

**Problem.** Reuse the indexed heap from Task 11 to implement Dijkstra's algorithm on a directed weighted graph with non-negative edge weights. Return the shortest distance from a source `s` to all other vertices, or `infinity` for unreachable ones.

**Input / Output spec.**
- Input: `n`, `m`, `s`, then `m` lines `u v w` (edge from `u` to `v` with non-negative weight `w`).
- Output: `n` lines: distance from `s` to each vertex, or the string `INF`.

**Constraints.**
- `1 <= n <= 10^5`, `0 <= m <= 5 * 10^5`.
- `0 <= w <= 10^9`.
- Time: `O((n + m) log n)`.

**Hint.** Initialize all distances to `+infinity`, set `dist[s] = 0`, insert `s` with key 0. On every extracted vertex `u`, relax outgoing edges via `decreaseKey` if the candidate is smaller; if a neighbor is not yet in the heap, `insert` it.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"fmt"
	"math"
	"os"
)

type Edge struct {
	to int
	w  int64
}

// Assume IndexedHeap from Task 11 lives in the same package.

func dijkstra(n int, adj [][]Edge, s int) []int64 {
	dist := make([]int64, n)
	for i := range dist {
		dist[i] = math.MaxInt64
	}
	dist[s] = 0
	// TODO: indexed heap loop
	return dist
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var n, m, s int
	fmt.Fscan(in, &n, &m, &s)
	adj := make([][]Edge, n)
	for i := 0; i < m; i++ {
		var u, v int
		var w int64
		fmt.Fscan(in, &u, &v, &w)
		adj[u] = append(adj[u], Edge{v, w})
	}
	dist := dijkstra(n, adj, s)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for _, d := range dist {
		if d == math.MaxInt64 {
			fmt.Fprintln(out, "INF")
		} else {
			fmt.Fprintln(out, d)
		}
	}
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task12 {
    static long[] dijkstra(int n, List<long[]>[] adj, int s) {
        long[] dist = new long[n];
        Arrays.fill(dist, Long.MAX_VALUE);
        dist[s] = 0L;
        // TODO: use indexed heap (Task 11)
        return dist;
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer tok = new StreamTokenizer(br);
        tok.nextToken(); int n = (int) tok.nval;
        tok.nextToken(); int m = (int) tok.nval;
        tok.nextToken(); int s = (int) tok.nval;
        List<long[]>[] adj = new List[n];
        for (int i = 0; i < n; i++) adj[i] = new ArrayList<>();
        for (int i = 0; i < m; i++) {
            tok.nextToken(); int u = (int) tok.nval;
            tok.nextToken(); int v = (int) tok.nval;
            tok.nextToken(); long w = (long) tok.nval;
            adj[u].add(new long[]{v, w});
        }
        long[] dist = dijkstra(n, adj, s);
        StringBuilder sb = new StringBuilder();
        for (long d : dist) sb.append(d == Long.MAX_VALUE ? "INF" : Long.toString(d)).append('\n');
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
import sys
from typing import List, Tuple

INF = float("inf")


def dijkstra(n: int, adj: List[List[Tuple[int, int]]], s: int) -> List[float]:
    dist: List[float] = [INF] * n
    dist[s] = 0
    # TODO: reuse IndexedHeap from Task 11
    return dist


def main() -> None:
    data = iter(sys.stdin.read().split())
    n, m, s = int(next(data)), int(next(data)), int(next(data))
    adj: List[List[Tuple[int, int]]] = [[] for _ in range(n)]
    for _ in range(m):
        u, v, w = int(next(data)), int(next(data)), int(next(data))
        adj[u].append((v, w))
    out = []
    for d in dijkstra(n, adj, s):
        out.append("INF" if d == INF else str(int(d)))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Each vertex is extracted at most once.
- Uses `decreaseKey` (no "lazy deletion" with duplicate entries).
- Matches a `O(V^2)` reference on small graphs and runs within budget on large sparse graphs.

---

### Task 13 — Median of a data stream (two-heap pattern)

**Problem.** Read a stream of integers. After each new value, output the running median. Use a max-heap `lo` for the lower half and a min-heap `hi` for the upper half, keeping `|lo| - |hi|` in `{0, 1}`.

**Input / Output spec.**
- Input: one integer per line.
- Output: one line per input — the running median (as `int` if odd count, average otherwise).

**Constraints.**
- Up to `10^6` values.
- Each insertion `O(log n)`.

**Hint.** Push into `lo` first; then move `lo.top()` to `hi`; if `hi` outgrew `lo`, move one back. Median is `lo.top()` when sizes differ, or the average of both tops otherwise.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"container/heap"
	"fmt"
	"os"
)

type maxIntH []int

func (h maxIntH) Len() int            { return len(h) }
func (h maxIntH) Less(i, j int) bool  { return h[i] > h[j] }
func (h maxIntH) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *maxIntH) Push(x any)         { *h = append(*h, x.(int)) }
func (h *maxIntH) Pop() any           { n := len(*h); v := (*h)[n-1]; *h = (*h)[:n-1]; return v }

type minIntH2 []int

func (h minIntH2) Len() int            { return len(h) }
func (h minIntH2) Less(i, j int) bool  { return h[i] < h[j] }
func (h minIntH2) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *minIntH2) Push(x any)         { *h = append(*h, x.(int)) }
func (h *minIntH2) Pop() any           { n := len(*h); v := (*h)[n-1]; *h = (*h)[:n-1]; return v }

type MedianFinder struct {
	lo *maxIntH
	hi *minIntH2
}

func (m *MedianFinder) Add(x int) {
	// TODO
}

func (m *MedianFinder) Median() float64 {
	// TODO
	return 0
}

func main() {
	in := bufio.NewReader(os.Stdin)
	mf := &MedianFinder{lo: &maxIntH{}, hi: &minIntH2{}}
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var x int
	for {
		if _, err := fmt.Fscan(in, &x); err != nil {
			return
		}
		mf.Add(x)
		fmt.Fprintln(out, mf.Median())
	}
	_ = heap.Init
}
```

**Starter — Java.**
```java
import java.util.*;
import java.io.*;

public class Task13 {
    static PriorityQueue<Integer> lo = new PriorityQueue<>(Comparator.reverseOrder());
    static PriorityQueue<Integer> hi = new PriorityQueue<>();

    static void add(int x) {
        // TODO
    }

    static double median() {
        // TODO
        return 0.0;
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) {
            if (line.isBlank()) continue;
            add(Integer.parseInt(line.trim()));
            sb.append(median()).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
import heapq
import sys


class MedianFinder:
    def __init__(self):
        self.lo = []  # max-heap via negation
        self.hi = []  # min-heap

    def add(self, x: int) -> None:
        # TODO
        pass

    def median(self) -> float:
        # TODO
        return 0.0


def main() -> None:
    mf = MedianFinder()
    out = []
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        mf.add(int(line))
        out.append(repr(mf.median()))
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Each `add` runs in `O(log n)`, each `median` in `O(1)`.
- Size invariant `|lo| - |hi| in {0, 1}` holds after every `add`.
- Matches a sorting-based reference on every prefix.

---

### Task 14 — Smallest range covering elements from `K` lists

**Problem.** Given `K` sorted ascending lists, find the smallest range `[lo, hi]` such that at least one element from each list lies in the range. If multiple ranges are smallest by `hi - lo`, return the one with the smallest `lo`.

**Input / Output spec.**
- Input: `K`, then for each `i` the length `n_i` followed by sorted values.
- Output: `lo hi` on one line.

**Constraints.**
- `1 <= K <= 10^4`, total elements `N <= 10^6`.
- Time: `O(N log K)`.

**Hint.** Push the first element of each list into a min-heap. Track `currentMax`. At every step, candidate range is `(heap.top(), currentMax)`. Pop the smallest and advance that list; if the list is exhausted, stop. Update `currentMax` with each pushed value.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"container/heap"
	"fmt"
	"os"
)

type rNode struct{ val, arr, idx int }
type rMin []rNode

func (h rMin) Len() int            { return len(h) }
func (h rMin) Less(i, j int) bool  { return h[i].val < h[j].val }
func (h rMin) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *rMin) Push(x any)         { *h = append(*h, x.(rNode)) }
func (h *rMin) Pop() any           { n := len(*h); v := (*h)[n-1]; *h = (*h)[:n-1]; return v }

func smallestRange(lists [][]int) (int, int) {
	// TODO
	return 0, 0
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var k int
	fmt.Fscan(in, &k)
	lists := make([][]int, k)
	for i := 0; i < k; i++ {
		var n int
		fmt.Fscan(in, &n)
		lists[i] = make([]int, n)
		for j := range lists[i] {
			fmt.Fscan(in, &lists[i][j])
		}
	}
	lo, hi := smallestRange(lists)
	fmt.Println(lo, hi)
	_ = heap.Init
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task14 {
    static int[] smallestRange(int[][] lists) {
        // TODO
        return new int[]{0, 0};
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int k = sc.nextInt();
        int[][] lists = new int[k][];
        for (int i = 0; i < k; i++) {
            int n = sc.nextInt();
            lists[i] = new int[n];
            for (int j = 0; j < n; j++) lists[i][j] = sc.nextInt();
        }
        int[] r = smallestRange(lists);
        System.out.println(r[0] + " " + r[1]);
    }
}
```

**Starter — Python.**
```python
import heapq
import sys
from typing import List, Tuple


def smallest_range(lists: List[List[int]]) -> Tuple[int, int]:
    # TODO
    return (0, 0)


def main() -> None:
    data = iter(sys.stdin.read().split())
    k = int(next(data))
    lists: List[List[int]] = []
    for _ in range(k):
        n = int(next(data))
        lists.append([int(next(data)) for _ in range(n)])
    lo, hi = smallest_range(lists)
    print(lo, hi)


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Loop terminates when any list is exhausted.
- Tracks `(hi - lo)` correctly with tiebreaking on `lo`.
- Matches a brute reference on small inputs (`K <= 3`, total `<= 50`).

---

### Task 15 — Construct a Huffman tree from character frequencies

**Problem.** Given a frequency table over a finite alphabet, build a Huffman tree by repeatedly merging the two least frequent nodes. Then walk the tree to emit a `char -> code` table.

**Input / Output spec.**
- Input: `m`, then `m` lines `char freq`.
- Output: each line `char code`, sorted by char.

**Constraints.**
- `1 <= m <= 10^5`.
- `1 <= freq <= 10^9`.
- Time: `O(m log m)`.

**Hint.** Use a min-heap whose entries are `(freq, sequence, node)` so equal-frequency nodes break ties by insertion order (deterministic codes). Build the tree, then DFS to assign codes.

**Starter — Go.**
```go
package main

import (
	"bufio"
	"container/heap"
	"fmt"
	"os"
	"sort"
)

type HNode struct {
	freq        int64
	seq         int
	char        rune
	left, right *HNode
}

type hMin []*HNode

func (h hMin) Len() int { return len(h) }
func (h hMin) Less(i, j int) bool {
	if h[i].freq != h[j].freq {
		return h[i].freq < h[j].freq
	}
	return h[i].seq < h[j].seq
}
func (h hMin) Swap(i, j int)    { h[i], h[j] = h[j], h[i] }
func (h *hMin) Push(x any)      { *h = append(*h, x.(*HNode)) }
func (h *hMin) Pop() any        { n := len(*h); v := (*h)[n-1]; *h = (*h)[:n-1]; return v }

func buildHuffman(freqs map[rune]int64) map[rune]string {
	// TODO: build tree, DFS to codes
	return nil
}

func main() {
	in := bufio.NewReader(os.Stdin)
	var m int
	fmt.Fscan(in, &m)
	freqs := make(map[rune]int64, m)
	for i := 0; i < m; i++ {
		var c string
		var f int64
		fmt.Fscan(in, &c, &f)
		freqs[rune(c[0])] = f
	}
	codes := buildHuffman(freqs)
	chars := make([]rune, 0, len(codes))
	for c := range codes {
		chars = append(chars, c)
	}
	sort.Slice(chars, func(i, j int) bool { return chars[i] < chars[j] })
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	for _, c := range chars {
		fmt.Fprintf(out, "%c %s\n", c, codes[c])
	}
	_ = heap.Init
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task15 {
    static class Node {
        long freq;
        int seq;
        char ch;
        Node left, right;
    }

    static Map<Character, String> buildHuffman(Map<Character, Long> freqs) {
        // TODO: PriorityQueue ordered by (freq, seq), DFS for codes
        return new TreeMap<>();
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int m = sc.nextInt();
        Map<Character, Long> freqs = new HashMap<>();
        for (int i = 0; i < m; i++) {
            String ch = sc.next();
            long f = sc.nextLong();
            freqs.put(ch.charAt(0), f);
        }
        Map<Character, String> codes = new TreeMap<>(buildHuffman(freqs));
        StringBuilder sb = new StringBuilder();
        for (var e : codes.entrySet()) {
            sb.append(e.getKey()).append(' ').append(e.getValue()).append('\n');
        }
        System.out.print(sb);
    }
}
```

**Starter — Python.**
```python
import heapq
import sys
from itertools import count
from typing import Dict, Optional


class Node:
    __slots__ = ("freq", "ch", "left", "right")

    def __init__(self, freq: int, ch: Optional[str] = None,
                 left: "Optional[Node]" = None, right: "Optional[Node]" = None):
        self.freq = freq
        self.ch = ch
        self.left = left
        self.right = right


def build_huffman(freqs: Dict[str, int]) -> Dict[str, str]:
    # TODO: heap entries (freq, seq, node) to keep tie-breaking deterministic
    return {}


def main() -> None:
    data = sys.stdin.read().split()
    m = int(data[0])
    freqs: Dict[str, int] = {}
    p = 1
    for _ in range(m):
        ch = data[p]; f = int(data[p + 1]); p += 2
        freqs[ch] = f
    codes = build_huffman(freqs)
    out = []
    for ch in sorted(codes):
        out.append(f"{ch} {codes[ch]}")
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- No two codes share a prefix (prefix-free property).
- Average code length is within rounding of the entropy lower bound on stress inputs.
- Handles a single-symbol alphabet (assign a one-character code such as `"0"`).

---

## Benchmark Task

### Task B — Full benchmark across Go, Java, Python

**Problem.** For each language, write a self-contained benchmark that measures three heap workloads on a min-heap of `int64`:

- **(a)** `n` random pushes followed by `n` pops.
- **(b)** Build a heap from `n` random values in one `heapify` (`O(n)`), then pop all `n`.
- **(c)** Sort the same `n` random values using the language's standard library `sort`.

Run each workload for `n ∈ {10^4, 10^5, 10^6}`. Repeat each measurement 5 times and report the mean wall-clock time in milliseconds. Use the same seed across languages so the input distribution is identical.

**Input / Output spec.**
- No stdin input. Output a fixed table to stdout:

```text
n         a_push_pop_ms    b_heapify_pop_ms    c_stdlib_sort_ms
10000     ...              ...                 ...
100000    ...              ...                 ...
1000000   ...              ...                 ...
```

**Constraints.**
- Seed: `42`.
- Random distribution: uniform `int64` in `[0, 2^31)`.
- Time only the workload, not the random generation.

**Starter — Go.**
```go
package main

import (
	"container/heap"
	"fmt"
	"math/rand"
	"sort"
	"time"
)

type intHeap []int64

func (h intHeap) Len() int            { return len(h) }
func (h intHeap) Less(i, j int) bool  { return h[i] < h[j] }
func (h intHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *intHeap) Push(x any)         { *h = append(*h, x.(int64)) }
func (h *intHeap) Pop() any           { n := len(*h); v := (*h)[n-1]; *h = (*h)[:n-1]; return v }

func genData(n int, seed int64) []int64 {
	r := rand.New(rand.NewSource(seed))
	a := make([]int64, n)
	for i := range a {
		a[i] = r.Int63n(1 << 31)
	}
	return a
}

func benchPushPop(data []int64) time.Duration {
	// TODO: time push of all, then pop all
	return 0
}

func benchHeapifyPop(data []int64) time.Duration {
	// TODO: copy, heap.Init, then pop all
	_ = heap.Init
	return 0
}

func benchSort(data []int64) time.Duration {
	// TODO: copy, sort.Slice, time only sort
	_ = sort.Slice
	return 0
}

func meanMs(d []time.Duration) float64 {
	var s int64
	for _, x := range d {
		s += x.Milliseconds()
	}
	return float64(s) / float64(len(d))
}

func main() {
	sizes := []int{10000, 100000, 1000000}
	fmt.Println("n         a_push_pop_ms    b_heapify_pop_ms    c_stdlib_sort_ms")
	for _, n := range sizes {
		data := genData(n, 42)
		var ra, rb, rc []time.Duration
		for i := 0; i < 5; i++ {
			ra = append(ra, benchPushPop(append([]int64(nil), data...)))
			rb = append(rb, benchHeapifyPop(append([]int64(nil), data...)))
			rc = append(rc, benchSort(append([]int64(nil), data...)))
		}
		fmt.Printf("%-9d %-16.2f %-19.2f %-16.2f\n", n, meanMs(ra), meanMs(rb), meanMs(rc))
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class TaskB {
    static long[] genData(int n, long seed) {
        Random r = new Random(seed);
        long[] a = new long[n];
        for (int i = 0; i < n; i++) a[i] = r.nextInt(Integer.MAX_VALUE);
        return a;
    }

    static long benchPushPop(long[] data) {
        // TODO: PriorityQueue<Long> push then poll, return nanos
        return 0L;
    }

    static long benchHeapifyPop(long[] data) {
        // TODO: PriorityQueue ctor with Collection (linear heapify), then poll all
        return 0L;
    }

    static long benchSort(long[] data) {
        // TODO: Arrays.sort(copy), return nanos
        return 0L;
    }

    static double meanMs(long[] ns) {
        long s = 0;
        for (long x : ns) s += x;
        return (s / 1_000_000.0) / ns.length;
    }

    public static void main(String[] args) {
        int[] sizes = {10_000, 100_000, 1_000_000};
        System.out.println("n         a_push_pop_ms    b_heapify_pop_ms    c_stdlib_sort_ms");
        for (int n : sizes) {
            long[] data = genData(n, 42L);
            long[] ra = new long[5], rb = new long[5], rc = new long[5];
            for (int i = 0; i < 5; i++) {
                ra[i] = benchPushPop(data.clone());
                rb[i] = benchHeapifyPop(data.clone());
                rc[i] = benchSort(data.clone());
            }
            System.out.printf("%-9d %-16.2f %-19.2f %-16.2f%n", n, meanMs(ra), meanMs(rb), meanMs(rc));
        }
    }
}
```

**Starter — Python.**
```python
import heapq
import random
import time
from typing import List


def gen_data(n: int, seed: int) -> List[int]:
    r = random.Random(seed)
    return [r.randrange(1 << 31) for _ in range(n)]


def bench_push_pop(data: List[int]) -> float:
    # TODO: time heappush all, then heappop all
    return 0.0


def bench_heapify_pop(data: List[int]) -> float:
    # TODO: copy, heapify (O(n)), then heappop all
    return 0.0


def bench_sort(data: List[int]) -> float:
    # TODO: copy, sorted(...) or list.sort(); time only the sort
    return 0.0


def mean_ms(samples: List[float]) -> float:
    return sum(samples) / len(samples) * 1000.0


def main() -> None:
    sizes = [10_000, 100_000, 1_000_000]
    print("n         a_push_pop_ms    b_heapify_pop_ms    c_stdlib_sort_ms")
    for n in sizes:
        data = gen_data(n, 42)
        ra, rb, rc = [], [], []
        for _ in range(5):
            ra.append(bench_push_pop(list(data)))
            rb.append(bench_heapify_pop(list(data)))
            rc.append(bench_sort(list(data)))
        print(f"{n:<9d} {mean_ms(ra):<16.2f} {mean_ms(rb):<19.2f} {mean_ms(rc):<16.2f}")


if __name__ == "__main__":
    main()
```

**Evaluation criteria.**
- Same seed produces the same input across languages.
- Workload (b) consistently beats (a) — heapify is `O(n)`, repeated push is `O(n log n)`.
- Workload (c) is close to (b) for large `n` because both pay `O(n log n)` total, but the constant factor of stdlib sort is typically smaller.
- Report includes mean across at least 5 runs and does not time the data generation or array clone.
- Writeup: a short note on which language showed the widest gap between (a) and (b), and why.
