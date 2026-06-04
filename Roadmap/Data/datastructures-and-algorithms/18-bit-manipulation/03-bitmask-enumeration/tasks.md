# Bitmask Enumeration (Iterating Over Sets as Integers) — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise spec and starter code in all three languages. Implement the enumeration logic and validate against the evaluation criteria.
> **Always test against a brute-force oracle on small inputs** — e.g. for submasks, compare to `{ t : t & mask == t }`.

---

## Beginner Tasks (5)

### Task 1 — Enumerate all subsets and their sums

**Problem.** Given `n` and an array `value[0..n-1]`, print, for every subset, its mask (in binary, `n` digits) and the sum of selected values, in increasing order of mask.

**Input / Output spec.**
- Read `n`, then `n` integers.
- Print `2^n` lines: `mask_binary sum`.

**Constraints.** `1 ≤ n ≤ 18`, `0 ≤ value[i] ≤ 10^6`.

**Hint.** `for mask in 0..(1<<n)-1`; test bit `i` with `mask & (1<<i)`.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var n int
	fmt.Scan(&n)
	value := make([]int, n)
	for i := range value {
		fmt.Scan(&value[i])
	}
	// TODO: loop all 2^n masks, compute sum, print "%0*b %d"
	_ = value
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task1 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] value = new int[n];
        for (int i = 0; i < n; i++) value[i] = sc.nextInt();
        // TODO: loop all 2^n masks, compute sum, print binary mask + sum
    }
}
```

**Starter — Python.**
```python
def main():
    n = int(input())
    value = list(map(int, input().split()))
    # TODO: loop all 2^n masks, compute sum, print f"{mask:0{n}b} {total}"


if __name__ == "__main__":
    main()
```

**Evaluation.** Exactly `2^n` lines; mask `0` first with sum `0`; mask `(1<<n)-1` last with the total.

---

### Task 2 — Count set bits of every mask

**Problem.** For `n`, print `popcount(mask)` for every `mask` in `0..2^n-1`, one per line.

**Input / Output spec.** Read `n`. Print `2^n` integers.

**Constraints.** `1 ≤ n ≤ 16`.

**Hint.** Use the DP `pc[mask] = pc[mask>>1] + (mask & 1)` or a built-in.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var n int
	fmt.Scan(&n)
	// TODO: pc[mask] = pc[mask>>1] + (mask & 1); print each
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task2 {
    public static void main(String[] args) {
        int n = new Scanner(System.in).nextInt();
        // TODO: build popcount table and print
    }
}
```

**Starter — Python.**
```python
def main():
    n = int(input())
    # TODO: pc[mask] = pc[mask>>1] + (mask & 1)


if __name__ == "__main__":
    main()
```

**Evaluation.** `pc[0]=0`, `pc[(1<<n)-1]=n`; values match `bin(mask).count("1")`.

---

### Task 3 — Set operations on two masks

**Problem.** Read `n`, `a`, `b` (two masks). Print their union, intersection, difference `a\b`, symmetric difference, and the complement of `a` within `n` bits, each as an `n`-digit binary string.

**Input / Output spec.** Read `n a b`. Print 5 binary strings.

**Constraints.** `1 ≤ n ≤ 20`, `0 ≤ a, b < 2^n`.

**Hint.** Complement is `a ^ ((1<<n)-1)`, **not** `~a`.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var n, a, b int
	fmt.Scan(&n, &a, &b)
	full := (1 << n) - 1
	// TODO: print a|b, a&b, a&^b, a^b, a^full as n-bit binary
	_ = full
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task3 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), a = sc.nextInt(), b = sc.nextInt();
        int full = (1 << n) - 1;
        // TODO: print union, intersection, diff, symdiff, complement
    }
}
```

**Starter — Python.**
```python
def main():
    n, a, b = map(int, input().split())
    full = (1 << n) - 1
    # TODO: print a|b, a&b, a & ~b, a^b, a^full as n-bit binary


if __name__ == "__main__":
    main()
```

**Evaluation.** Complement uses `^ full`; difference `a & ~b` masked to `n` bits matches `a & (full ^ b)`.

---

### Task 4 — Iterate set bits with lowbit

**Problem.** Given a mask, print the indices of its set bits in increasing order, using the lowbit loop `m & -m` / `m &= m - 1`.

**Input / Output spec.** Read `mask`. Print the set-bit indices space-separated (empty line if none).

**Constraints.** `0 ≤ mask < 2^31`.

**Hint.** Index of `m & -m` is the trailing-zero count.

**Starter — Go.**
```go
package main

import (
	"fmt"
	"math/bits"
)

func main() {
	var mask int
	fmt.Scan(&mask)
	m := uint(mask)
	for m != 0 {
		i := bits.TrailingZeros(m)
		fmt.Print(i, " ")
		m &= m - 1
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task4 {
    public static void main(String[] args) {
        int mask = new Scanner(System.in).nextInt();
        // TODO: while m != 0: print Integer.numberOfTrailingZeros(m); m &= m-1
    }
}
```

**Starter — Python.**
```python
def main():
    mask = int(input())
    m = mask
    out = []
    while m:
        out.append((m & -m).bit_length() - 1)
        m &= m - 1
    print(*out)


if __name__ == "__main__":
    main()
```

**Evaluation.** Output equals `[i for i in range(31) if mask & (1<<i)]`; loop runs `popcount` times.

---

### Task 5 — Enumerate submasks of a mask

**Problem.** Given a mask, print all its submasks (including `0`) in **decreasing** order, each as binary.

**Input / Output spec.** Read `mask`. Print `2^popcount(mask)` lines.

**Constraints.** `0 ≤ mask < 2^20`.

**Hint.** `s = mask; loop { print s; if s==0 break; s = (s-1)&mask; }`.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var mask int
	fmt.Scan(&mask)
	for s := mask; ; s = (s - 1) & mask {
		fmt.Printf("%b\n", s)
		if s == 0 {
			break
		}
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task5 {
    public static void main(String[] args) {
        int mask = new Scanner(System.in).nextInt();
        // TODO: for (s=mask;;s=(s-1)&mask) { print; if(s==0) break; }
    }
}
```

**Starter — Python.**
```python
def main():
    mask = int(input())
    s = mask
    while True:
        print(bin(s)[2:])
        if s == 0:
            break
        s = (s - 1) & mask


if __name__ == "__main__":
    main()
```

**Evaluation.** Exactly `2^popcount(mask)` lines, strictly decreasing, last line `0`; equals the sorted-descending filter `{t : t & mask == t}`.

---

## Intermediate Tasks (4)

### Task 6 — Maximum subset sum under a budget

**Problem.** Given `value[0..n-1]` and budget `B`, find the maximum subset sum `≤ B`.

**Input / Output spec.** Read `n B`, then `n` integers. Print the best sum.

**Constraints.** `1 ≤ n ≤ 22`, `0 ≤ value[i] ≤ 10^9`, `0 ≤ B ≤ 10^18`.

**Hint.** Enumerate all `2^n` masks; accumulate the sum with a lowbit loop; track the best `≤ B`.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var n int
	var B int64
	fmt.Scan(&n, &B)
	value := make([]int64, n)
	for i := range value {
		fmt.Scan(&value[i])
	}
	// TODO: enumerate masks, sum selected, keep best <= B
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task6 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long B = sc.nextLong();
        long[] value = new long[n];
        for (int i = 0; i < n; i++) value[i] = sc.nextLong();
        // TODO: enumerate masks, keep best sum <= B
    }
}
```

**Starter — Python.**
```python
def main():
    n, B = map(int, input().split())
    value = list(map(int, input().split()))
    # TODO: best sum <= B over all 2^n masks


if __name__ == "__main__":
    main()
```

**Evaluation.** Matches a brute-force check for `n ≤ 18`; uses 64-bit accumulation.

---

### Task 7 — Minimum partition difference

**Problem.** Split `value[0..n-1]` into two groups to minimize `|sumA − sumB|`.

**Input / Output spec.** Read `n`, then `n` integers. Print the minimum difference.

**Constraints.** `1 ≤ n ≤ 22`, `0 ≤ value[i] ≤ 10^7`.

**Hint.** For each mask, group-A sum is `a`; difference is `|total − 2a|`.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var n int
	fmt.Scan(&n)
	value := make([]int64, n)
	var total int64
	for i := range value {
		fmt.Scan(&value[i])
		total += value[i]
	}
	// TODO: minimize abs(total - 2*a) over all masks
	_ = total
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task7 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long[] value = new long[n];
        long total = 0;
        for (int i = 0; i < n; i++) { value[i] = sc.nextLong(); total += value[i]; }
        // TODO: minimize abs(total - 2*a)
    }
}
```

**Starter — Python.**
```python
def main():
    n = int(input())
    value = list(map(int, input().split()))
    total = sum(value)
    # TODO: minimize abs(total - 2*a) over all masks


if __name__ == "__main__":
    main()
```

**Evaluation.** Result is `0` for a balanced multiset; matches brute force for small `n`.

---

### Task 8 — Count submask pairs (verify 3^n)

**Problem.** For a given `n`, count the number of pairs `(mask, submask)` with `submask ⊆ mask` by iterating submasks of every mask, and confirm it equals `3^n`.

**Input / Output spec.** Read `n`. Print the count and `3^n`.

**Constraints.** `0 ≤ n ≤ 16`.

**Hint.** Outer loop over masks, inner submask loop; total should equal `3^n`.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var n int
	fmt.Scan(&n)
	total := 0
	for mask := 0; mask < (1 << n); mask++ {
		for s := mask; ; s = (s - 1) & mask {
			total++
			if s == 0 {
				break
			}
		}
	}
	p3 := 1
	for i := 0; i < n; i++ {
		p3 *= 3
	}
	fmt.Println(total, p3)
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task8 {
    public static void main(String[] args) {
        int n = new Scanner(System.in).nextInt();
        long total = 0;
        for (int mask = 0; mask < (1 << n); mask++)
            for (int s = mask; ; s = (s - 1) & mask) {
                total++;
                if (s == 0) break;
            }
        long p3 = 1;
        for (int i = 0; i < n; i++) p3 *= 3;
        System.out.println(total + " " + p3);
    }
}
```

**Starter — Python.**
```python
def main():
    n = int(input())
    total = 0
    for mask in range(1 << n):
        s = mask
        while True:
            total += 1
            if s == 0:
                break
            s = (s - 1) & mask
    print(total, 3 ** n)


if __name__ == "__main__":
    main()
```

**Evaluation.** `total == 3^n` for all tested `n`.

---

### Task 9 — Enumerate supersets of a mask

**Problem.** Given `n` and `mask`, print every superset of `mask` within `n` bits, in increasing order, as `n`-digit binary.

**Input / Output spec.** Read `n mask`. Print `2^(n-popcount(mask))` lines.

**Constraints.** `1 ≤ n ≤ 18`, `mask < 2^n`.

**Hint.** `s = mask; loop { print; if s==full break; s = (s+1)|mask; }`.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var n, mask int
	fmt.Scan(&n, &mask)
	full := (1 << n) - 1
	for s := mask; ; s = (s + 1) | mask {
		fmt.Printf("%0*b\n", n, s)
		if s == full {
			break
		}
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task9 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), mask = sc.nextInt(), full = (1 << n) - 1;
        // TODO: for (s=mask;;s=(s+1)|mask) { print; if(s==full) break; }
    }
}
```

**Starter — Python.**
```python
def main():
    n, mask = map(int, input().split())
    full = (1 << n) - 1
    s = mask
    while True:
        print(f"{s:0{n}b}")
        if s == full:
            break
        s = (s + 1) | mask


if __name__ == "__main__":
    main()
```

**Evaluation.** Exactly `2^(n-popcount(mask))` lines; each `s` satisfies `s & mask == mask`.

---

## Advanced Tasks (3)

### Task 10 — Subset-sum DP via submasks (set partition into k equal groups, small k)

**Problem.** Given `value[0..n-1]` and `k`, decide whether the multiset can be partitioned into `k` groups of equal sum. Use bitmask DP where `dp[mask]` tracks reachable states, transitioning by adding submasks that form one valid group. (Submask enumeration drives the transition.)

**Input / Output spec.** Read `n k`, then `n` integers. Print `YES` or `NO`.

**Constraints.** `1 ≤ k ≤ n ≤ 16`, total divisible by `k` required.

**Hint.** `dp[mask]` = remainder of the current partial group's sum; transition by trying each unused element or close a group. Submask enumeration helps when grouping whole submasks. Validate against brute force for `n ≤ 12`.

**Starter — Go.**
```go
package main

import "fmt"

func canPartitionK(value []int, k int) bool {
	n := len(value)
	total := 0
	for _, v := range value {
		total += v
	}
	if total%k != 0 {
		return false
	}
	target := total / k
	// TODO: bitmask DP over used-element masks; submask grouping
	_ = n
	_ = target
	return false
}

func main() {
	var n, k int
	fmt.Scan(&n, &k)
	v := make([]int, n)
	for i := range v {
		fmt.Scan(&v[i])
	}
	if canPartitionK(v, k) {
		fmt.Println("YES")
	} else {
		fmt.Println("NO")
	}
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task10 {
    static boolean canPartitionK(int[] value, int k) {
        int n = value.length, total = 0;
        for (int v : value) total += v;
        if (total % k != 0) return false;
        int target = total / k;
        // TODO: bitmask DP; submask grouping
        return false;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), k = sc.nextInt();
        int[] v = new int[n];
        for (int i = 0; i < n; i++) v[i] = sc.nextInt();
        System.out.println(canPartitionK(v, k) ? "YES" : "NO");
    }
}
```

**Starter — Python.**
```python
def can_partition_k(value, k):
    total = sum(value)
    if total % k != 0:
        return False
    target = total // k
    n = len(value)
    # TODO: bitmask DP over used masks; submask grouping
    return False


def main():
    n, k = map(int, input().split())
    v = list(map(int, input().split()))
    print("YES" if can_partition_k(v, k) else "NO")


if __name__ == "__main__":
    main()
```

**Evaluation.** Matches brute-force recursion for `n ≤ 12`; rejects when `total % k != 0`. (See sibling `13/06-bitmask-dp` for the full DP technique.)

---

### Task 11 — Minimum set cover by submask DP

**Problem.** Given a universe of `m` elements (`m ≤ 16`) and a list of sets (each a bitmask over the universe), find the minimum number of sets whose union is the full universe.

**Input / Output spec.** Read `m`, then the number of sets `S` and each set as a list of element indices. Print the minimum count, or `-1` if impossible.

**Constraints.** `1 ≤ m ≤ 16`, `1 ≤ S ≤ 100`.

**Hint.** `dp[covered]` = min sets to reach `covered`; transition `dp[covered | set_j]`. Enumerating submasks of the *uncovered* part can drive an alternative formulation. Validate against BFS over `2^m` states.

**Starter — Go.**
```go
package main

import "fmt"

func main() {
	var m, S int
	fmt.Scan(&m, &S)
	sets := make([]int, S)
	for j := 0; j < S; j++ {
		var c int
		fmt.Scan(&c)
		mask := 0
		for ; c > 0; c-- {
			var x int
			fmt.Scan(&x)
			mask |= 1 << x
		}
		sets[j] = mask
	}
	// TODO: dp[covered] = min sets; BFS/DP over 2^m
	_ = sets
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task11 {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int m = sc.nextInt(), S = sc.nextInt();
        int[] sets = new int[S];
        for (int j = 0; j < S; j++) {
            int c = sc.nextInt(), mask = 0;
            for (int t = 0; t < c; t++) mask |= 1 << sc.nextInt();
            sets[j] = mask;
        }
        // TODO: dp over 2^m covered states; print min count or -1
    }
}
```

**Starter — Python.**
```python
def main():
    m = int(input())
    S = int(input())
    sets = []
    for _ in range(S):
        parts = list(map(int, input().split()))
        c, idxs = parts[0], parts[1:]
        mask = 0
        for x in idxs:
            mask |= 1 << x
        sets.append(mask)
    # TODO: dp[covered] = min sets; over 2^m states


if __name__ == "__main__":
    main()
```

**Evaluation.** `full = (1<<m)-1`; `dp[full]` is the answer; `-1` if unreachable. Matches BFS over masks.

---

### Task 12 — Sum over all submasks (SOS DP) vs naive 3^n

**Problem.** Given an array `f[0..2^n-1]`, compute `g[mask] = Σ_{s ⊆ mask} f[s]` for every mask. Implement both the naive `O(3^n)` submask loop and the SOS DP `O(n·2^n)`, and assert they agree.

**Input / Output spec.** Read `n`, then `2^n` integers `f`. Print `g` for all masks (space-separated).

**Constraints.** `1 ≤ n ≤ 18`.

**Hint.** Naive: for each mask, sum `f[s]` over submasks. SOS: `for i in 0..n-1: for mask: if mask & (1<<i): g[mask] += g[mask ^ (1<<i)]` starting from `g = f`.

**Starter — Go.**
```go
package main

import "fmt"

func sos(f []int64, n int) []int64 {
	g := make([]int64, len(f))
	copy(g, f)
	for i := 0; i < n; i++ {
		for mask := 0; mask < (1 << n); mask++ {
			if mask&(1<<i) != 0 {
				g[mask] += g[mask^(1<<i)]
			}
		}
	}
	return g
}

func main() {
	var n int
	fmt.Scan(&n)
	f := make([]int64, 1<<n)
	for i := range f {
		fmt.Scan(&f[i])
	}
	g := sos(f, n)
	for i, v := range g {
		if i > 0 {
			fmt.Print(" ")
		}
		fmt.Print(v)
	}
	fmt.Println()
}
```

**Starter — Java.**
```java
import java.util.*;

public class Task12 {
    static long[] sos(long[] f, int n) {
        long[] g = f.clone();
        for (int i = 0; i < n; i++)
            for (int mask = 0; mask < (1 << n); mask++)
                if ((mask & (1 << i)) != 0) g[mask] += g[mask ^ (1 << i)];
        return g;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long[] f = new long[1 << n];
        for (int i = 0; i < f.length; i++) f[i] = sc.nextLong();
        long[] g = sos(f, n);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < g.length; i++) {
            if (i > 0) sb.append(' ');
            sb.append(g[i]);
        }
        System.out.println(sb);
    }
}
```

**Starter — Python.**
```python
def sos(f, n):
    g = f[:]
    for i in range(n):
        for mask in range(1 << n):
            if mask & (1 << i):
                g[mask] += g[mask ^ (1 << i)]
    return g


def naive(f, n):
    g = [0] * (1 << n)
    for mask in range(1 << n):
        s = mask
        while True:
            g[mask] += f[s]
            if s == 0:
                break
            s = (s - 1) & mask
    return g


def main():
    n = int(input())
    f = list(map(int, input().split()))
    g = sos(f, n)
    assert g == naive(f, n)
    print(*g)


if __name__ == "__main__":
    main()
```

**Evaluation.** SOS and naive outputs must match for all masks; SOS runs in `O(n·2^n)` versus naive `O(3^n)`.

---

## How to Practice

1. Solve every task in all three languages; keep the brute-force oracle alongside the fast version.
2. For each enumeration, assert the expected count (`2^n`, `2^popcount`, `3^n`, `2^(n-popcount)`).
3. Test boundaries: `n = 0`, `mask = 0`, `mask = (1<<n)-1`.
4. Confirm complement uses `^ ((1<<n)-1)`, and that the submask loop handles `0`.
5. Profile Task 12 to feel `O(3^n)` vs `O(n·2^n)` at `n = 16, 18`.
