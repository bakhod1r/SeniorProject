# Binary Trie & XOR Linear Basis — Practice Tasks

> **One-line summary:** Graded exercises (Beginner / Intermediate / Advanced) on both XOR structures — each with a problem statement, I/O spec, constraints, hints, and starter code in Go, Java, and Python. Build up from a single trie insert/query to constrained max-XOR and the full basis operation set.

---

## How to Use These Tasks

Work top to bottom. Beginner tasks build the trie and basis primitives; Intermediate tasks combine them into the canonical problems; Advanced tasks add constraints (counting, deletion, value/index limits, k-th). For every task, first write an `O(n²)` or `O(2^n)` brute-force oracle and compare on random small inputs — that habit catches almost every bug. Use a bit-width `B` just large enough for the stated value bound.

---

## Beginner Tasks

### Task 1 — Insert and query a single trie

**Problem.** Build an MSB-first binary trie over a list of numbers, then answer one query: the maximum XOR of a given `x` against all inserted numbers.
**Input.** Line 1: `n` numbers. Line 2: query `x`.
**Output.** The maximum `x ^ y` over inserted `y`.
**Constraints.** `1 ≤ n ≤ 10^4`, `0 ≤ values < 2^20`.
**Hints.**
- Use `B = 20`.
- Walk down preferring child `1 - bit` of `x`; bank `1 << i` when you take it.

#### Go
```go
package main

import "fmt"

const B = 20

func main() {
	var n int
	fmt.Scan(&n)
	nums := make([]int, n)
	for i := range nums {
		fmt.Scan(&nums[i])
	}
	var x int
	fmt.Scan(&x)
	// TODO: build trie, return max x^y
	_ = x
	fmt.Println(0)
}
```

#### Java
```java
import java.util.*;
public class Task1 {
    static final int B = 20;
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] nums = new int[n];
        for (int i = 0; i < n; i++) nums[i] = sc.nextInt();
        int x = sc.nextInt();
        // TODO: build trie, return max x^y
        System.out.println(0);
    }
}
```

#### Python
```python
import sys

B = 20


def main():
    data = sys.stdin.read().split()
    n = int(data[0])
    nums = list(map(int, data[1:1 + n]))
    x = int(data[1 + n])
    # TODO: build trie, return max x^y
    print(0)


if __name__ == "__main__":
    main()
```

### Task 2 — Maximum XOR pair in an array

**Problem.** Return `max(nums[i] ^ nums[j])` over `i < j`.
**Input.** `n` then `n` integers.
**Output.** One integer.
**Constraints.** `2 ≤ n ≤ 2·10^5`, `0 ≤ values < 2^30`.
**Hints.**
- Insert `nums[0]`, then for each later element query before inserting it.
- `B = 30`.

#### Go
```go
package main

import "fmt"

func maxXorPair(nums []int) int {
	// TODO
	return 0
}

func main() {
	var n int
	fmt.Scan(&n)
	a := make([]int, n)
	for i := range a {
		fmt.Scan(&a[i])
	}
	fmt.Println(maxXorPair(a))
}
```

#### Java
```java
import java.util.*;
public class Task2 {
    static int maxXorPair(int[] nums) { return 0; /* TODO */ }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] a = new int[n];
        for (int i = 0; i < n; i++) a[i] = sc.nextInt();
        System.out.println(maxXorPair(a));
    }
}
```

#### Python
```python
import sys


def max_xor_pair(nums):
    # TODO
    return 0


def main():
    data = sys.stdin.read().split()
    n = int(data[0])
    a = list(map(int, data[1:1 + n]))
    print(max_xor_pair(a))


if __name__ == "__main__":
    main()
```

### Task 3 — Build a linear basis and report its rank

**Problem.** Insert numbers into an XOR linear basis and print the rank (number of independent vectors).
**Input.** `n` then `n` integers.
**Output.** The rank.
**Constraints.** `1 ≤ n ≤ 10^5`, `0 ≤ values < 2^30`.
**Hints.**
- `add` returns true when a new pivot is installed; count those.
- A value reducing to `0` is dependent.

#### Go
```go
package main

import "fmt"

func main() {
	const B = 30
	var n int
	fmt.Scan(&n)
	basis := make([]int, B)
	rank := 0
	for ; n > 0; n-- {
		var x int
		fmt.Scan(&x)
		// TODO: reduce x; if a pivot is empty, install and rank++
		_ = basis
	}
	fmt.Println(rank)
}
```

#### Java
```java
import java.util.*;
public class Task3 {
    public static void main(String[] args) {
        final int B = 30;
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long[] basis = new long[B];
        int rank = 0;
        for (int t = 0; t < n; t++) {
            long x = sc.nextLong();
            // TODO: reduce x; install pivot and rank++ when slot empty
        }
        System.out.println(rank);
    }
}
```

#### Python
```python
import sys


def main():
    B = 30
    data = sys.stdin.read().split()
    n = int(data[0])
    basis = [0] * B
    rank = 0
    for x in map(int, data[1:1 + n]):
        # TODO: reduce x; install pivot and rank += 1 when slot empty
        pass
    print(rank)


if __name__ == "__main__":
    main()
```

### Task 4 — Maximum subset XOR via basis

**Problem.** Print the maximum XOR obtainable from any subset.
**Input.** `n` then `n` integers.
**Output.** One integer.
**Constraints.** `1 ≤ n ≤ 10^5`, `0 ≤ values < 2^30`.
**Hints.**
- Build the basis, then greedily XOR pivots high→low when they increase the result.

#### Go
```go
package main

import "fmt"

func main() {
	var n int
	fmt.Scan(&n)
	a := make([]int, n)
	for i := range a {
		fmt.Scan(&a[i])
	}
	// TODO: build basis, greedy max
	fmt.Println(0)
}
```

#### Java
```java
import java.util.*;
public class Task4 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long[] a = new long[n];
        for (int i = 0; i < n; i++) a[i] = sc.nextLong();
        // TODO: build basis, greedy max
        System.out.println(0);
    }
}
```

#### Python
```python
import sys


def main():
    data = sys.stdin.read().split()
    n = int(data[0])
    a = list(map(int, data[1:1 + n]))
    # TODO: build basis, greedy max
    print(0)


if __name__ == "__main__":
    main()
```

### Task 5 — Minimum XOR of a query against a set

**Problem.** Given a set of numbers and a query `x`, return the minimum `x ^ y`.
**Input.** `n` numbers then `x`.
**Output.** One integer.
**Constraints.** `1 ≤ n ≤ 10^4`, `0 ≤ values < 2^20`.
**Hints.**
- Same trie, but take the *same*-bit child when present (forces XOR bit 0).

#### Go
```go
package main

import "fmt"

func main() {
	// TODO: build trie; min-XOR walk takes same-bit child when present
	fmt.Println(0)
}
```

#### Java
```java
public class Task5 {
    public static void main(String[] args) {
        // TODO: min-XOR walk prefers same-bit child
        System.out.println(0);
    }
}
```

#### Python
```python
def main():
    # TODO: min-XOR walk prefers same-bit child
    print(0)


if __name__ == "__main__":
    main()
```

---

## Intermediate Tasks

### Task 6 — Count pairs with XOR < k

**Problem.** Count unordered pairs `(i, j)` with `nums[i] ^ nums[j] < k`.
**Input.** `n`, `k`, then `n` integers.
**Output.** One integer (use 64-bit).
**Constraints.** `1 ≤ n ≤ 10^5`, `0 ≤ values, k < 2^20`.
**Hints.**
- Trie with subtree counts; route by `k`'s bits.
- When `k`'s bit is 1, add the whole same-bit (XOR-bit-0) subtree and descend the other.

#### Go
```go
package main

import "fmt"

func countPairsXorLess(nums []int, k int) int64 {
	// TODO: trie + counts + routing
	return 0
}

func main() {
	var n, k int
	fmt.Scan(&n, &k)
	a := make([]int, n)
	for i := range a {
		fmt.Scan(&a[i])
	}
	fmt.Println(countPairsXorLess(a, k))
}
```

#### Java
```java
import java.util.*;
public class Task6 {
    static long solve(int[] a, int k) { return 0; /* TODO */ }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), k = sc.nextInt();
        int[] a = new int[n];
        for (int i = 0; i < n; i++) a[i] = sc.nextInt();
        System.out.println(solve(a, k));
    }
}
```

#### Python
```python
import sys


def count_pairs_xor_less(nums, k):
    # TODO: trie + counts + routing
    return 0


def main():
    data = sys.stdin.read().split()
    n, k = int(data[0]), int(data[1])
    a = list(map(int, data[2:2 + n]))
    print(count_pairs_xor_less(a, k))


if __name__ == "__main__":
    main()
```

### Task 7 — Maximum XOR subarray (prefix-XOR + trie)

**Problem.** Find the maximum XOR over all contiguous subarrays.
**Input.** `n` then `n` integers.
**Output.** One integer.
**Constraints.** `1 ≤ n ≤ 2·10^5`, `0 ≤ values < 2^20`.
**Hints.**
- Build prefix-XOR `P` with `P[0] = 0`; `xor(l..r) = P[r+1] ^ P[l]`.
- Max XOR subarray = max XOR pair over `P` (insert `P[0]` first).

#### Go
```go
package main

import "fmt"

func maxXorSubarray(a []int) int {
	// TODO: prefix XOR + trie of prefixes
	return 0
}

func main() {
	var n int
	fmt.Scan(&n)
	a := make([]int, n)
	for i := range a {
		fmt.Scan(&a[i])
	}
	fmt.Println(maxXorSubarray(a))
}
```

#### Java
```java
import java.util.*;
public class Task7 {
    static int maxXorSubarray(int[] a) { return 0; /* TODO */ }
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] a = new int[n];
        for (int i = 0; i < n; i++) a[i] = sc.nextInt();
        System.out.println(maxXorSubarray(a));
    }
}
```

#### Python
```python
import sys


def max_xor_subarray(a):
    # TODO: prefix XOR + trie of prefixes
    return 0


def main():
    data = sys.stdin.read().split()
    n = int(data[0])
    a = list(map(int, data[1:1 + n]))
    print(max_xor_subarray(a))


if __name__ == "__main__":
    main()
```

### Task 8 — Distinct subset XOR count

**Problem.** Print the number of distinct values obtainable as a subset XOR (including 0).
**Input.** `n` then `n` integers.
**Output.** One integer (`2^rank`; may be large — print as integer).
**Constraints.** `1 ≤ n ≤ 10^5`, `0 ≤ values < 2^30`.
**Hints.**
- Build the basis; answer is `1 << rank`.

#### Go
```go
package main

import "fmt"

func main() {
	// TODO: basis, print 1<<rank
	fmt.Println(1)
}
```

#### Java
```java
public class Task8 {
    public static void main(String[] args) {
        // TODO: basis, print 1L<<rank
        System.out.println(1);
    }
}
```

#### Python
```python
def main():
    # TODO: basis, print 1 << rank
    print(1)


if __name__ == "__main__":
    main()
```

### Task 9 — Is a value representable?

**Problem.** Build a basis, then answer `q` queries: is `v` a subset XOR? Print `YES`/`NO`.
**Input.** `n`, `n` numbers, `q`, then `q` query values.
**Output.** `q` lines of `YES`/`NO`.
**Constraints.** `1 ≤ n, q ≤ 10^5`, `0 ≤ values < 2^30`.
**Hints.**
- Reduce `v` by the basis; representable iff it reaches `0`.

#### Go
```go
package main

import "fmt"

func main() {
	// TODO: basis; reduce each query, YES if reaches 0
	fmt.Println("NO")
}
```

#### Java
```java
public class Task9 {
    public static void main(String[] args) {
        // TODO: basis; reduce each query
        System.out.println("NO");
    }
}
```

#### Python
```python
def main():
    # TODO: basis; reduce each query
    print("NO")


if __name__ == "__main__":
    main()
```

### Task 10 — Deletion-capable max-XOR multiset

**Problem.** Process operations: `+ v` (insert), `- v` (erase one), `? x` (max `x ^ y` over current multiset, or `-1` if empty).
**Input.** `q` operations.
**Output.** One line per `?` query.
**Constraints.** `1 ≤ q ≤ 2·10^5`, `0 ≤ values < 2^30`.
**Hints.**
- Trie with subtree counts; a child exists for the walk only if `cnt > 0`.

#### Go
```go
package main

import "fmt"

func main() {
	// TODO: trie with counts; honor cnt>0 in walk
	_ = fmt.Sprint
}
```

#### Java
```java
public class Task10 {
    public static void main(String[] args) {
        // TODO: trie with counts; honor cnt>0 in walk
    }
}
```

#### Python
```python
def main():
    # TODO: trie with counts; honor cnt>0 in walk
    pass


if __name__ == "__main__":
    main()
```

---

## Advanced Tasks

### Task 11 — Maximum XOR with value constraint (offline)

**Problem.** For each query `(x, m)`, return `max(x ^ a)` over array elements `a ≤ m`, or `-1` if none.
**Input.** `n`, `n` numbers, `q`, then `q` pairs `x m`.
**Output.** `q` integers in original query order.
**Constraints.** `1 ≤ n, q ≤ 10^5`, `0 ≤ values < 2^30`.
**Hints.**
- Sort array and queries by `m`; sweep with a monotone insertion pointer.

#### Go
```go
package main

import "fmt"

func main() {
	// TODO: offline sort; insert a<=m before answering
	_ = fmt.Sprint
}
```

#### Java
```java
public class Task11 {
    public static void main(String[] args) {
        // TODO: offline sort + monotone insertion pointer
    }
}
```

#### Python
```python
def main():
    # TODO: offline sort + monotone insertion pointer
    pass


if __name__ == "__main__":
    main()
```

### Task 12 — k-th smallest subset XOR

**Problem.** Given `nums` and `k` (1-indexed over distinct subset XORs including 0), return the k-th smallest, or `-1` if out of range.
**Input.** `n`, `n` numbers, then `k`.
**Output.** One integer.
**Constraints.** `1 ≤ n ≤ 10^5`, `0 ≤ values < 2^30`, `1 ≤ k`.
**Hints.**
- Reduce basis to RREF; list pivots low→high; read bits of `k-1`.

#### Go
```go
package main

import "fmt"

func main() {
	// TODO: basis -> RREF -> read bits of k-1
	fmt.Println(-1)
}
```

#### Java
```java
public class Task12 {
    public static void main(String[] args) {
        // TODO: basis -> RREF -> read bits of k-1
        System.out.println(-1);
    }
}
```

#### Python
```python
def main():
    # TODO: basis -> RREF -> read bits of k-1
    print(-1)


if __name__ == "__main__":
    main()
```

### Task 13 — Range subset-XOR maximum (segment tree of bases)

**Problem.** Answer `q` queries `(l, r)`: maximum subset XOR using `a[l..r]`.
**Input.** `n`, `n` numbers, `q`, then `q` pairs `l r` (0-indexed, inclusive).
**Output.** `q` integers.
**Constraints.** `1 ≤ n, q ≤ 2·10^4`, `0 ≤ values < 2^30`.
**Hints.**
- Build a segment tree where each node stores its segment's basis; query merges `O(log n)` bases.
- Merge = insert each nonzero vector of one basis into the other.

#### Go
```go
package main

import "fmt"

func main() {
	// TODO: segment tree of bases; merge on query
	_ = fmt.Sprint
}
```

#### Java
```java
public class Task13 {
    public static void main(String[] args) {
        // TODO: segment tree of bases; merge on query
    }
}
```

#### Python
```python
def main():
    # TODO: segment tree of bases; merge on query
    pass


if __name__ == "__main__":
    main()
```

### Task 14 — Range max XOR pair (persistent trie)

**Problem.** Answer `q` queries `(l, r, x)`: maximum `x ^ a[i]` for `i ∈ [l, r]`.
**Input.** `n`, `n` numbers, `q`, then `q` triples `l r x`.
**Output.** `q` integers.
**Constraints.** `1 ≤ n, q ≤ 10^5`, `0 ≤ values < 2^30`.
**Hints.**
- Persistent trie: `root[i]` over the prefix; query walk uses `cnt_{r+1} - cnt_l` to decide if a child exists in the range.

#### Go
```go
package main

import "fmt"

func main() {
	// TODO: persistent trie with version-difference counts
	_ = fmt.Sprint
}
```

#### Java
```java
public class Task14 {
    public static void main(String[] args) {
        // TODO: persistent trie with version-difference counts
    }
}
```

#### Python
```python
def main():
    # TODO: persistent trie with version-difference counts
    pass


if __name__ == "__main__":
    main()
```

### Task 15 — Choose the right tool

**Problem.** Given a problem statement on standard input describing an XOR query, output `TRIE` or `BASIS` for which structure fits, plus a one-word reason: `PAIR`, `SUBSET`, `DELETE`, `COUNT`, `KTH`, or `RANGE`.
**Input.** A short keyword line (e.g. `max xor of any subset`).
**Output.** Two tokens.
**Constraints.** Keyword-driven; this is a design exercise.
**Hints.**
- "pair"/"two elements"/"delete" → TRIE; "subset"/"k-th"/"distinct"/"representable" → BASIS.

#### Go
```go
package main

import "fmt"

func main() {
	// TODO: classify by keywords
	fmt.Println("TRIE", "PAIR")
}
```

#### Java
```java
public class Task15 {
    public static void main(String[] args) {
        // TODO: classify by keywords
        System.out.println("TRIE PAIR");
    }
}
```

#### Python
```python
def main():
    # TODO: classify by keywords
    print("TRIE", "PAIR")


if __name__ == "__main__":
    main()
```

---

## Benchmark Task

### Task B — Trie vs basis crossover for max-XOR queries

**Problem.** On the same random dataset, measure (a) max XOR pair via trie and (b) max subset XOR via basis. Report both answers and their wall-clock times for `n ∈ {10^3, 10^4, 10^5}`. Observe that the basis uses `O(B)` memory while the trie grows `O(n·B)`, and that the two answers differ (subset ≥ pair).
**Input.** A seed and a list of sizes.
**Output.** A small table: size, pair-max, subset-max, trie-time, basis-time, trie-nodes.
**Hints.**
- Reuse the implementations from `interview.md`.
- Verify on tiny `n` against `O(n²)` and `O(2^n)` oracles before timing.
- Expect subset-max ≥ pair-max always; equality only in degenerate cases.

---

## General Guidance for All Tasks

- Choose `B` from the value bound; assert no value has a bit at or above `B`.
- For tries, prefer an array-pooled node layout with `0` as both root and null sentinel (real nodes start at index 1).
- For counting/deletion, store subtree counts from the start.
- For basis k-th/representable, remember the empty subset contributes value `0`.
- Always test against a brute-force oracle on random small inputs with a fixed seed before submitting.
- Use 64-bit integers for shifts and counts when `B ≥ 32` or pair counts can exceed `2^31`.
