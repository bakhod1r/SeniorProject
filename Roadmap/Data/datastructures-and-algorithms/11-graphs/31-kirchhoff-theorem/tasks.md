# Kirchhoff's Theorem — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a problem statement, constraints, hints, and a reference solution in all three languages.
> Build a brute-force spanning-tree enumerator early — it is your oracle for every counting task. Known checks: triangle = 3, `K_4` = 16, `K_5` = 125, `K_n` = `n^(n−2)`.

---

## Beginner Tasks (5)

### Task 1 — Build the Laplacian and verify zero row sums

**Problem.** Given `n` and an undirected edge list, build the Laplacian `L = D − A` and confirm every row sums to 0.

**Constraints.** `1 ≤ n ≤ 200`, simple graph, `0 ≤ m ≤ n(n−1)/2`. Ignore self-loops.

**Hint.** Per edge `(u,v)`, `u≠v`: `L[u][u]++, L[v][v]++, L[u][v]--, L[v][u]--`. Then check `sum(row) == 0`.

#### Go
```go
package main

import "fmt"

func laplacian(n int, edges [][2]int) [][]int {
	L := make([][]int, n)
	for i := range L {
		L[i] = make([]int, n)
	}
	for _, e := range edges {
		u, v := e[0], e[1]
		if u == v {
			continue
		}
		L[u][u]++
		L[v][v]++
		L[u][v]--
		L[v][u]--
	}
	return L
}

func main() {
	L := laplacian(3, [][2]int{{0, 1}, {1, 2}, {0, 2}})
	for _, row := range L {
		s := 0
		for _, x := range row {
			s += x
		}
		fmt.Println(row, "sum =", s)
	}
}
```

#### Java
```java
public class Task1 {
    static int[][] laplacian(int n, int[][] edges) {
        int[][] L = new int[n][n];
        for (int[] e : edges) {
            int u = e[0], v = e[1];
            if (u == v) continue;
            L[u][u]++; L[v][v]++; L[u][v]--; L[v][u]--;
        }
        return L;
    }
    public static void main(String[] args) {
        int[][] L = laplacian(3, new int[][]{{0,1},{1,2},{0,2}});
        for (int[] row : L) {
            int s = 0; for (int x : row) s += x;
            System.out.println(java.util.Arrays.toString(row) + " sum = " + s);
        }
    }
}
```

#### Python
```python
def laplacian(n, edges):
    L = [[0] * n for _ in range(n)]
    for u, v in edges:
        if u == v:
            continue
        L[u][u] += 1; L[v][v] += 1
        L[u][v] -= 1; L[v][u] -= 1
    return L


for row in laplacian(3, [(0, 1), (1, 2), (0, 2)]):
    print(row, "sum =", sum(row))
```

---

### Task 2 — Count spanning trees of a small graph (float determinant)

**Problem.** Count the spanning trees of an undirected graph using the reduced-Laplacian determinant (float arithmetic, round at the end).

**Constraints.** `1 ≤ n ≤ 12`. Answer fits in `int64`.

**Hint.** Delete the last row/column, run Gaussian elimination with partial pivoting, multiply pivots, round the absolute value.

#### Go
```go
package main

import (
	"fmt"
	"math"
)

func count(n int, edges [][2]int) int64 {
	L := make([][]float64, n)
	for i := range L {
		L[i] = make([]float64, n)
	}
	for _, e := range edges {
		if e[0] == e[1] {
			continue
		}
		L[e[0]][e[0]]++
		L[e[1]][e[1]]++
		L[e[0]][e[1]]--
		L[e[1]][e[0]]--
	}
	m := n - 1
	A := make([][]float64, m)
	for i := 0; i < m; i++ {
		A[i] = append([]float64(nil), L[i][:m]...)
	}
	det := 1.0
	for i := 0; i < m; i++ {
		p := i
		for r := i + 1; r < m; r++ {
			if math.Abs(A[r][i]) > math.Abs(A[p][i]) {
				p = r
			}
		}
		if A[p][i] == 0 {
			return 0
		}
		if p != i {
			A[i], A[p] = A[p], A[i]
			det = -det
		}
		det *= A[i][i]
		for r := i + 1; r < m; r++ {
			f := A[r][i] / A[i][i]
			for c := i; c < m; c++ {
				A[r][c] -= f * A[i][c]
			}
		}
	}
	return int64(math.Abs(det) + 0.5)
}

func main() {
	fmt.Println(count(5, complete(5))) // 125
}

func complete(k int) [][2]int {
	var e [][2]int
	for i := 0; i < k; i++ {
		for j := i + 1; j < k; j++ {
			e = append(e, [2]int{i, j})
		}
	}
	return e
}
```

#### Java
```java
public class Task2 {
    static long count(int n, int[][] edges) {
        double[][] L = new double[n][n];
        for (int[] e : edges) {
            if (e[0] == e[1]) continue;
            L[e[0]][e[0]]++; L[e[1]][e[1]]++;
            L[e[0]][e[1]]--; L[e[1]][e[0]]--;
        }
        int m = n - 1;
        double[][] A = new double[m][m];
        for (int i = 0; i < m; i++)
            for (int j = 0; j < m; j++) A[i][j] = L[i][j];
        double det = 1.0;
        for (int i = 0; i < m; i++) {
            int p = i;
            for (int r = i + 1; r < m; r++)
                if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
            if (A[p][i] == 0) return 0;
            if (p != i) { double[] t = A[i]; A[i] = A[p]; A[p] = t; det = -det; }
            det *= A[i][i];
            for (int r = i + 1; r < m; r++) {
                double f = A[r][i] / A[i][i];
                for (int c = i; c < m; c++) A[r][c] -= f * A[i][c];
            }
        }
        return Math.round(Math.abs(det));
    }
    static int[][] complete(int k) {
        java.util.List<int[]> e = new java.util.ArrayList<>();
        for (int i = 0; i < k; i++) for (int j = i + 1; j < k; j++) e.add(new int[]{i, j});
        return e.toArray(new int[0][]);
    }
    public static void main(String[] args) { System.out.println(count(5, complete(5))); } // 125
}
```

#### Python
```python
def count(n, edges):
    L = [[0.0] * n for _ in range(n)]
    for u, v in edges:
        if u == v:
            continue
        L[u][u] += 1; L[v][v] += 1
        L[u][v] -= 1; L[v][u] -= 1
    m = n - 1
    A = [row[:m] for row in L[:m]]
    det = 1.0
    for i in range(m):
        p = max(range(i, m), key=lambda r: abs(A[r][i]))
        if A[p][i] == 0:
            return 0
        if p != i:
            A[i], A[p] = A[p], A[i]; det = -det
        det *= A[i][i]
        for r in range(i + 1, m):
            f = A[r][i] / A[i][i]
            for c in range(i, m):
                A[r][c] -= f * A[i][c]
    return round(abs(det))


complete = lambda k: [(i, j) for i in range(k) for j in range(i + 1, k)]
print(count(5, complete(5)))  # 125
```

---

### Task 3 — Brute-force oracle: enumerate spanning trees

**Problem.** Count spanning trees by enumerating all `(n−1)`-edge subsets and testing each with union-find. Use this to validate Task 2.

**Constraints.** `1 ≤ n ≤ 8`, `m ≤ 15` (enumeration is exponential).

**Hint.** For each subset of size `n−1`, union the endpoints; it is a tree iff no edge closes a cycle and all `n−1` unions succeed.

#### Go
```go
package main

import "fmt"

func brute(n int, edges [][2]int) int64 {
	m := len(edges)
	var cnt int64
	var rec func(start, picked int, par []int)
	find := func(par []int, x int) int {
		for par[x] != x {
			par[x] = par[par[x]]
			x = par[x]
		}
		return x
	}
	rec = func(start, picked int, par []int) {
		if picked == n-1 {
			cnt++
			return
		}
		for i := start; i < m; i++ {
			np := append([]int(nil), par...)
			ru, rv := find(np, edges[i][0]), find(np, edges[i][1])
			if ru != rv {
				np[ru] = rv
				rec(i+1, picked+1, np)
			}
		}
	}
	base := make([]int, n)
	for i := range base {
		base[i] = i
	}
	rec(0, 0, base)
	return cnt
}

func main() {
	fmt.Println(brute(4, [][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 0}, {0, 2}})) // 8
}
```

#### Java
```java
import java.util.*;
public class Task3 {
    static long cnt;
    static int[][] edges; static int n;
    static int find(int[] p, int x) { while (p[x] != x) { p[x] = p[p[x]]; x = p[x]; } return x; }
    static void rec(int start, int picked, int[] par) {
        if (picked == n - 1) { cnt++; return; }
        for (int i = start; i < edges.length; i++) {
            int[] np = par.clone();
            int ru = find(np, edges[i][0]), rv = find(np, edges[i][1]);
            if (ru != rv) { np[ru] = rv; rec(i + 1, picked + 1, np); }
        }
    }
    static long brute(int nn, int[][] e) {
        n = nn; edges = e; cnt = 0;
        int[] base = new int[n];
        for (int i = 0; i < n; i++) base[i] = i;
        rec(0, 0, base);
        return cnt;
    }
    public static void main(String[] args) {
        System.out.println(brute(4, new int[][]{{0,1},{1,2},{2,3},{3,0},{0,2}})); // 8
    }
}
```

#### Python
```python
from itertools import combinations

def brute(n, edges):
    cnt = 0
    for comb in combinations(range(len(edges)), n - 1):
        par = list(range(n))
        def find(x):
            while par[x] != x:
                par[x] = par[par[x]]; x = par[x]
            return x
        ok = True
        for idx in comb:
            u, v = edges[idx]
            ru, rv = find(u), find(v)
            if ru == rv:
                ok = False; break
            par[ru] = rv
        if ok:
            cnt += 1
    return cnt


print(brute(4, [(0,1),(1,2),(2,3),(3,0),(0,2)]))  # 8
```

---

### Task 4 — Spanning trees of a cycle and a path

**Problem.** Without running a determinant, predict and then verify with code: how many spanning trees does the cycle `C_n` have? The path `P_n`?

**Constraints.** `3 ≤ n ≤ 50`.

**Hint.** A cycle `C_n` has exactly `n` spanning trees (drop any one of its `n` edges). A path has exactly `1`. Verify with your Task 2 `count`.

#### Go
```go
package main

import "fmt"

func cycle(n int) [][2]int {
	var e [][2]int
	for i := 0; i < n; i++ {
		e = append(e, [2]int{i, (i + 1) % n})
	}
	return e
}

func path(n int) [][2]int {
	var e [][2]int
	for i := 0; i+1 < n; i++ {
		e = append(e, [2]int{i, i + 1})
	}
	return e
}

func main() {
	for n := 3; n <= 6; n++ {
		fmt.Printf("C_%d = %d (expect %d), P_%d = %d (expect 1)\n",
			n, count(n, cycle(n)), n, n, count(n, path(n)))
	}
}
// reuse count + complete from Task 2
```

#### Java
```java
public class Task4 {
    static int[][] cycle(int n) {
        int[][] e = new int[n][2];
        for (int i = 0; i < n; i++) { e[i][0] = i; e[i][1] = (i + 1) % n; }
        return e;
    }
    static int[][] path(int n) {
        int[][] e = new int[n - 1][2];
        for (int i = 0; i + 1 < n; i++) { e[i][0] = i; e[i][1] = i + 1; }
        return e;
    }
    public static void main(String[] args) {
        for (int n = 3; n <= 6; n++)
            System.out.printf("C_%d = %d (expect %d), P_%d = %d (expect 1)%n",
                n, Task2.count(n, cycle(n)), n, n, Task2.count(n, path(n)));
    }
}
```

#### Python
```python
def cycle(n): return [(i, (i + 1) % n) for i in range(n)]
def path(n):  return [(i, i + 1) for i in range(n - 1)]

for n in range(3, 7):
    print(f"C_{n} = {count(n, cycle(n))} (expect {n}), "
          f"P_{n} = {count(n, path(n))} (expect 1)")
# reuse count from Task 2
```

---

### Task 5 — Handle self-loops and multi-edges correctly

**Problem.** Confirm that adding a self-loop does not change the count, but adding a parallel edge does.

**Constraints.** `2 ≤ n ≤ 10`.

**Hint.** Triangle = 3. Add a self-loop at vertex 0 → still 3. Add a second parallel edge `0–1` → count rises (now 5: trees using either copy of `0–1` plus one other edge, plus the `1–2,0–2` tree).

#### Go
```go
package main

import "fmt"

func main() {
	tri := [][2]int{{0, 1}, {1, 2}, {0, 2}}
	fmt.Println("triangle:", count(3, tri)) // 3

	withLoop := append([][2]int{{0, 0}}, tri...)
	fmt.Println("with self-loop:", count(3, withLoop)) // 3

	withParallel := append([][2]int{{0, 1}}, tri...)
	fmt.Println("with parallel 0-1:", count(3, withParallel)) // 5
}
// reuse count from Task 2
```

#### Java
```java
public class Task5 {
    public static void main(String[] args) {
        int[][] tri = {{0,1},{1,2},{0,2}};
        System.out.println("triangle: " + Task2.count(3, tri));                       // 3
        System.out.println("self-loop: " + Task2.count(3, new int[][]{{0,0},{0,1},{1,2},{0,2}})); // 3
        System.out.println("parallel: " + Task2.count(3, new int[][]{{0,1},{0,1},{1,2},{0,2}}));  // 5
    }
}
```

#### Python
```python
tri = [(0, 1), (1, 2), (0, 2)]
print("triangle:", count(3, tri))                              # 3
print("self-loop:", count(3, [(0, 0)] + tri))                  # 3
print("parallel:", count(3, [(0, 1), (0, 1), (1, 2), (0, 2)])) # 5
# reuse count from Task 2
```

---

## Intermediate Tasks (5)

### Task 6 — Spanning trees mod 1e9+7

**Problem.** Count spanning trees modulo `1,000,000,007` for graphs whose true count overflows `int64`.

**Constraints.** `1 ≤ n ≤ 500`. Use modular Gaussian elimination with Fermat inverse.

**Hint.** Division mod p is multiplication by `pow(b, p−2, p)`. Normalize negatives with `(x % MOD + MOD) % MOD`.

#### Go
```go
package main

import "fmt"

const MOD = 1_000_000_007

func pw(a, b int64) int64 {
	a %= MOD
	r := int64(1)
	for b > 0 {
		if b&1 == 1 {
			r = r * a % MOD
		}
		a = a * a % MOD
		b >>= 1
	}
	return r
}

func countMod(n int, edges [][2]int) int64 {
	L := make([][]int64, n)
	for i := range L {
		L[i] = make([]int64, n)
	}
	for _, e := range edges {
		if e[0] == e[1] {
			continue
		}
		L[e[0]][e[0]]++
		L[e[1]][e[1]]++
		L[e[0]][e[1]] = (L[e[0]][e[1]] - 1 + MOD) % MOD
		L[e[1]][e[0]] = (L[e[1]][e[0]] - 1 + MOD) % MOD
	}
	m := n - 1
	A := make([][]int64, m)
	for i := 0; i < m; i++ {
		A[i] = append([]int64(nil), L[i][:m]...)
	}
	det := int64(1)
	for i := 0; i < m; i++ {
		p := i
		for p < m && A[p][i] == 0 {
			p++
		}
		if p == m {
			return 0
		}
		if p != i {
			A[i], A[p] = A[p], A[i]
			det = (MOD - det) % MOD
		}
		det = det * A[i][i] % MOD
		iv := pw(A[i][i], MOD-2)
		for r := i + 1; r < m; r++ {
			f := A[r][i] * iv % MOD
			for c := i; c < m; c++ {
				A[r][c] = (A[r][c] - f*A[i][c]%MOD + MOD) % MOD
			}
		}
	}
	return det
}

func main() {
	fmt.Println(countMod(50, complete(50))) // 50^48 mod p
}
```

#### Java
```java
public class Task6 {
    static final long MOD = 1_000_000_007L;
    static long pw(long a, long b) {
        a %= MOD; long r = 1;
        while (b > 0) { if ((b & 1) == 1) r = r * a % MOD; a = a * a % MOD; b >>= 1; }
        return r;
    }
    static long countMod(int n, int[][] edges) {
        long[][] L = new long[n][n];
        for (int[] e : edges) {
            if (e[0] == e[1]) continue;
            L[e[0]][e[0]]++; L[e[1]][e[1]]++;
            L[e[0]][e[1]] = (L[e[0]][e[1]] - 1 + MOD) % MOD;
            L[e[1]][e[0]] = (L[e[1]][e[0]] - 1 + MOD) % MOD;
        }
        int m = n - 1;
        long[][] A = new long[m][m];
        for (int i = 0; i < m; i++)
            for (int j = 0; j < m; j++) A[i][j] = ((L[i][j] % MOD) + MOD) % MOD;
        long det = 1;
        for (int i = 0; i < m; i++) {
            int p = i;
            while (p < m && A[p][i] == 0) p++;
            if (p == m) return 0;
            if (p != i) { long[] t = A[i]; A[i] = A[p]; A[p] = t; det = (MOD - det) % MOD; }
            det = det * A[i][i] % MOD;
            long iv = pw(A[i][i], MOD - 2);
            for (int r = i + 1; r < m; r++) {
                long f = A[r][i] * iv % MOD;
                for (int c = i; c < m; c++)
                    A[r][c] = (A[r][c] - f * A[i][c] % MOD + MOD) % MOD;
            }
        }
        return det;
    }
    public static void main(String[] args) { System.out.println(countMod(50, Task2.complete(50))); }
}
```

#### Python
```python
MOD = 1_000_000_007

def count_mod(n, edges):
    L = [[0] * n for _ in range(n)]
    for u, v in edges:
        if u == v:
            continue
        L[u][u] += 1; L[v][v] += 1
        L[u][v] = (L[u][v] - 1) % MOD
        L[v][u] = (L[v][u] - 1) % MOD
    m = n - 1
    A = [[L[i][j] % MOD for j in range(m)] for i in range(m)]
    det = 1
    for i in range(m):
        p = i
        while p < m and A[p][i] == 0:
            p += 1
        if p == m:
            return 0
        if p != i:
            A[i], A[p] = A[p], A[i]; det = (-det) % MOD
        det = det * A[i][i] % MOD
        iv = pow(A[i][i], MOD - 2, MOD)
        for r in range(i + 1, m):
            f = A[r][i] * iv % MOD
            for c in range(i, m):
                A[r][c] = (A[r][c] - f * A[i][c]) % MOD
    return det


print(count_mod(50, complete(50)))  # 50^48 mod p
assert count_mod(50, complete(50)) == pow(50, 48, MOD)
```

---

### Task 7 — Exact big-integer count (Bareiss)

**Problem.** Compute the exact (possibly hundred-digit) spanning-tree count using the fraction-free Bareiss algorithm with big integers.

**Constraints.** `1 ≤ n ≤ 100`. Output the full integer.

**Hint.** `M[i][j] = (M[k][k]·M[i][j] − M[i][k]·M[k][j]) / prev` with exact division; `prev` starts at 1 and becomes the previous pivot.

#### Go
```go
package main

import (
	"fmt"
	"math/big"
)

func bareiss(n int, edges [][2]int) *big.Int {
	L := make([][]*big.Int, n)
	for i := range L {
		L[i] = make([]*big.Int, n)
		for j := range L[i] {
			L[i][j] = big.NewInt(0)
		}
	}
	one := big.NewInt(1)
	for _, e := range edges {
		if e[0] == e[1] {
			continue
		}
		L[e[0]][e[0]].Add(L[e[0]][e[0]], one)
		L[e[1]][e[1]].Add(L[e[1]][e[1]], one)
		L[e[0]][e[1]].Sub(L[e[0]][e[1]], one)
		L[e[1]][e[0]].Sub(L[e[1]][e[0]], one)
	}
	m := n - 1
	A := make([][]*big.Int, m)
	for i := 0; i < m; i++ {
		A[i] = make([]*big.Int, m)
		for j := 0; j < m; j++ {
			A[i][j] = new(big.Int).Set(L[i][j])
		}
	}
	sign := big.NewInt(1)
	prev := big.NewInt(1)
	for k := 0; k < m-1; k++ {
		if A[k][k].Sign() == 0 {
			sw := -1
			for i := k + 1; i < m; i++ {
				if A[i][k].Sign() != 0 {
					sw = i
					break
				}
			}
			if sw == -1 {
				return big.NewInt(0)
			}
			A[k], A[sw] = A[sw], A[k]
			sign.Neg(sign)
		}
		for i := k + 1; i < m; i++ {
			for j := k + 1; j < m; j++ {
				t := new(big.Int).Mul(A[i][j], A[k][k])
				t.Sub(t, new(big.Int).Mul(A[i][k], A[k][j]))
				t.Quo(t, prev)
				A[i][j] = t
			}
		}
		prev = A[k][k]
	}
	return new(big.Int).Abs(new(big.Int).Mul(sign, A[m-1][m-1]))
}

func main() {
	fmt.Println(bareiss(20, complete(20))) // 20^18
}
```

#### Java
```java
import java.math.BigInteger;
public class Task7 {
    static BigInteger bareiss(int n, int[][] edges) {
        BigInteger[][] L = new BigInteger[n][n];
        for (BigInteger[] r : L) java.util.Arrays.fill(r, BigInteger.ZERO);
        for (int[] e : edges) {
            if (e[0] == e[1]) continue;
            L[e[0]][e[0]] = L[e[0]][e[0]].add(BigInteger.ONE);
            L[e[1]][e[1]] = L[e[1]][e[1]].add(BigInteger.ONE);
            L[e[0]][e[1]] = L[e[0]][e[1]].subtract(BigInteger.ONE);
            L[e[1]][e[0]] = L[e[1]][e[0]].subtract(BigInteger.ONE);
        }
        int m = n - 1;
        BigInteger[][] A = new BigInteger[m][m];
        for (int i = 0; i < m; i++)
            for (int j = 0; j < m; j++) A[i][j] = L[i][j];
        BigInteger sign = BigInteger.ONE, prev = BigInteger.ONE;
        for (int k = 0; k < m - 1; k++) {
            if (A[k][k].signum() == 0) {
                int sw = -1;
                for (int i = k + 1; i < m; i++) if (A[i][k].signum() != 0) { sw = i; break; }
                if (sw == -1) return BigInteger.ZERO;
                BigInteger[] t = A[k]; A[k] = A[sw]; A[sw] = t; sign = sign.negate();
            }
            for (int i = k + 1; i < m; i++)
                for (int j = k + 1; j < m; j++)
                    A[i][j] = A[i][j].multiply(A[k][k])
                                     .subtract(A[i][k].multiply(A[k][j])).divide(prev);
            prev = A[k][k];
        }
        return sign.multiply(A[m - 1][m - 1]).abs();
    }
    public static void main(String[] args) { System.out.println(bareiss(20, Task2.complete(20))); }
}
```

#### Python
```python
def bareiss(n, edges):
    L = [[0] * n for _ in range(n)]
    for u, v in edges:
        if u == v:
            continue
        L[u][u] += 1; L[v][v] += 1
        L[u][v] -= 1; L[v][u] -= 1
    m = n - 1
    A = [row[:m] for row in L[:m]]
    sign, prev = 1, 1
    for k in range(m - 1):
        if A[k][k] == 0:
            sw = next((i for i in range(k + 1, m) if A[i][k] != 0), -1)
            if sw == -1:
                return 0
            A[k], A[sw] = A[sw], A[k]; sign = -sign
        for i in range(k + 1, m):
            for j in range(k + 1, m):
                A[i][j] = (A[i][j] * A[k][k] - A[i][k] * A[k][j]) // prev
        prev = A[k][k]
    return abs(sign * A[m - 1][m - 1])


print(bareiss(20, complete(20)))  # 20**18
assert bareiss(20, complete(20)) == 20 ** 18
```

---

### Task 8 — Weighted spanning-tree sum

**Problem.** Given weighted edges, compute `Σ_T ∏_{e∈T} w(e)` over all spanning trees using the weighted Laplacian (exact rationals/integers).

**Constraints.** `1 ≤ n ≤ 60`, integer weights `1 ≤ w ≤ 1000`.

**Hint.** `L[i][i] += w`, `L[i][j] -= w`. For integer weights and integer answer, Bareiss with big integers stays exact.

#### Go
```go
package main

import (
	"fmt"
	"math/big"
)

func weighted(n int, we [][3]int) *big.Int {
	L := make([][]*big.Int, n)
	for i := range L {
		L[i] = make([]*big.Int, n)
		for j := range L[i] {
			L[i][j] = big.NewInt(0)
		}
	}
	for _, e := range we {
		u, v, w := e[0], e[1], int64(e[2])
		if u == v {
			continue
		}
		bw := big.NewInt(w)
		L[u][u].Add(L[u][u], bw)
		L[v][v].Add(L[v][v], bw)
		L[u][v].Sub(L[u][v], bw)
		L[v][u].Sub(L[v][u], bw)
	}
	// Bareiss as in Task 7
	m := n - 1
	A := make([][]*big.Int, m)
	for i := 0; i < m; i++ {
		A[i] = make([]*big.Int, m)
		for j := 0; j < m; j++ {
			A[i][j] = new(big.Int).Set(L[i][j])
		}
	}
	sign, prev := big.NewInt(1), big.NewInt(1)
	for k := 0; k < m-1; k++ {
		if A[k][k].Sign() == 0 {
			sw := -1
			for i := k + 1; i < m; i++ {
				if A[i][k].Sign() != 0 {
					sw = i
					break
				}
			}
			if sw == -1 {
				return big.NewInt(0)
			}
			A[k], A[sw] = A[sw], A[k]
			sign.Neg(sign)
		}
		for i := k + 1; i < m; i++ {
			for j := k + 1; j < m; j++ {
				t := new(big.Int).Mul(A[i][j], A[k][k])
				t.Sub(t, new(big.Int).Mul(A[i][k], A[k][j]))
				t.Quo(t, prev)
				A[i][j] = t
			}
		}
		prev = A[k][k]
	}
	return new(big.Int).Abs(new(big.Int).Mul(sign, A[m-1][m-1]))
}

func main() {
	fmt.Println(weighted(3, [][3]int{{0, 1, 2}, {1, 2, 3}, {0, 2, 5}})) // ab+bc+ca = 31
}
```

#### Java
```java
import java.math.BigInteger;
public class Task8 {
    static BigInteger weighted(int n, int[][] we) {
        BigInteger[][] L = new BigInteger[n][n];
        for (BigInteger[] r : L) java.util.Arrays.fill(r, BigInteger.ZERO);
        for (int[] e : we) {
            int u = e[0], v = e[1];
            if (u == v) continue;
            BigInteger w = BigInteger.valueOf(e[2]);
            L[u][u] = L[u][u].add(w); L[v][v] = L[v][v].add(w);
            L[u][v] = L[u][v].subtract(w); L[v][u] = L[v][u].subtract(w);
        }
        int m = n - 1;
        BigInteger[][] A = new BigInteger[m][m];
        for (int i = 0; i < m; i++) for (int j = 0; j < m; j++) A[i][j] = L[i][j];
        BigInteger sign = BigInteger.ONE, prev = BigInteger.ONE;
        for (int k = 0; k < m - 1; k++) {
            if (A[k][k].signum() == 0) {
                int sw = -1;
                for (int i = k + 1; i < m; i++) if (A[i][k].signum() != 0) { sw = i; break; }
                if (sw == -1) return BigInteger.ZERO;
                BigInteger[] t = A[k]; A[k] = A[sw]; A[sw] = t; sign = sign.negate();
            }
            for (int i = k + 1; i < m; i++)
                for (int j = k + 1; j < m; j++)
                    A[i][j] = A[i][j].multiply(A[k][k])
                                     .subtract(A[i][k].multiply(A[k][j])).divide(prev);
            prev = A[k][k];
        }
        return sign.multiply(A[m - 1][m - 1]).abs();
    }
    public static void main(String[] args) {
        System.out.println(weighted(3, new int[][]{{0,1,2},{1,2,3},{0,2,5}})); // 31
    }
}
```

#### Python
```python
def weighted(n, wedges):
    L = [[0] * n for _ in range(n)]
    for u, v, w in wedges:
        if u == v:
            continue
        L[u][u] += w; L[v][v] += w
        L[u][v] -= w; L[v][u] -= w
    m = n - 1
    A = [row[:m] for row in L[:m]]
    sign, prev = 1, 1
    for k in range(m - 1):
        if A[k][k] == 0:
            sw = next((i for i in range(k + 1, m) if A[i][k] != 0), -1)
            if sw == -1:
                return 0
            A[k], A[sw] = A[sw], A[k]; sign = -sign
        for i in range(k + 1, m):
            for j in range(k + 1, m):
                A[i][j] = (A[i][j] * A[k][k] - A[i][k] * A[k][j]) // prev
        prev = A[k][k]
    return abs(sign * A[m - 1][m - 1])


print(weighted(3, [(0, 1, 2), (1, 2, 3), (0, 2, 5)]))  # 31
```

---

### Task 9 — Count arborescences rooted at every vertex

**Problem.** Given a digraph, compute the number of arborescences oriented toward each root `r = 0..n−1` (Tutte). Print all `n` counts.

**Constraints.** `1 ≤ n ≤ 60`.

**Hint.** Out-degree on the diagonal, `−(#arcs i→j)` off-diagonal; delete row/col `r`; determinant. The answer can differ per root.

#### Go
```go
package main

import "fmt"

func arb(n int, arcs [][2]int, root int) int64 {
	L := make([][]float64, n)
	for i := range L {
		L[i] = make([]float64, n)
	}
	for _, a := range arcs {
		if a[0] == a[1] {
			continue
		}
		L[a[0]][a[0]]++
		L[a[0]][a[1]]--
	}
	var idx []int
	for i := 0; i < n; i++ {
		if i != root {
			idx = append(idx, i)
		}
	}
	m := len(idx)
	A := make([][]float64, m)
	for i := 0; i < m; i++ {
		A[i] = make([]float64, m)
		for j := 0; j < m; j++ {
			A[i][j] = L[idx[i]][idx[j]]
		}
	}
	det := 1.0
	for i := 0; i < m; i++ {
		p := i
		for r := i + 1; r < m; r++ {
			if abs(A[r][i]) > abs(A[p][i]) {
				p = r
			}
		}
		if A[p][i] == 0 {
			return 0
		}
		if p != i {
			A[i], A[p] = A[p], A[i]
			det = -det
		}
		det *= A[i][i]
		for r := i + 1; r < m; r++ {
			f := A[r][i] / A[i][i]
			for c := i; c < m; c++ {
				A[r][c] -= f * A[i][c]
			}
		}
	}
	if det < 0 {
		det = -det
	}
	return int64(det + 0.5)
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

func main() {
	arcs := [][2]int{{0, 1}, {1, 0}, {1, 2}, {2, 1}, {0, 2}, {2, 0}}
	for r := 0; r < 3; r++ {
		fmt.Printf("root %d -> %d\n", r, arb(3, arcs, r)) // each 3
	}
}
```

#### Java
```java
public class Task9 {
    static long arb(int n, int[][] arcs, int root) {
        double[][] L = new double[n][n];
        for (int[] a : arcs) { if (a[0] == a[1]) continue; L[a[0]][a[0]]++; L[a[0]][a[1]]--; }
        int[] idx = new int[n - 1];
        for (int i = 0, k = 0; i < n; i++) if (i != root) idx[k++] = i;
        int m = n - 1;
        double[][] A = new double[m][m];
        for (int i = 0; i < m; i++)
            for (int j = 0; j < m; j++) A[i][j] = L[idx[i]][idx[j]];
        double det = 1.0;
        for (int i = 0; i < m; i++) {
            int p = i;
            for (int r = i + 1; r < m; r++)
                if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
            if (A[p][i] == 0) return 0;
            if (p != i) { double[] t = A[i]; A[i] = A[p]; A[p] = t; det = -det; }
            det *= A[i][i];
            for (int r = i + 1; r < m; r++) {
                double f = A[r][i] / A[i][i];
                for (int c = i; c < m; c++) A[r][c] -= f * A[i][c];
            }
        }
        return Math.round(Math.abs(det));
    }
    public static void main(String[] args) {
        int[][] arcs = {{0,1},{1,0},{1,2},{2,1},{0,2},{2,0}};
        for (int r = 0; r < 3; r++) System.out.printf("root %d -> %d%n", r, arb(3, arcs, r));
    }
}
```

#### Python
```python
def arb(n, arcs, root):
    L = [[0.0] * n for _ in range(n)]
    for u, v in arcs:
        if u == v:
            continue
        L[u][u] += 1; L[u][v] -= 1
    idx = [i for i in range(n) if i != root]
    m = len(idx)
    A = [[L[idx[i]][idx[j]] for j in range(m)] for i in range(m)]
    det = 1.0
    for i in range(m):
        p = max(range(i, m), key=lambda r: abs(A[r][i]))
        if A[p][i] == 0:
            return 0
        if p != i:
            A[i], A[p] = A[p], A[i]; det = -det
        det *= A[i][i]
        for r in range(i + 1, m):
            f = A[r][i] / A[i][i]
            for c in range(i, m):
                A[r][c] -= f * A[i][c]
    return round(abs(det))


arcs = [(0,1),(1,0),(1,2),(2,1),(0,2),(2,0)]
for r in range(3):
    print(f"root {r} -> {arb(3, arcs, r)}")  # each 3
```

---

### Task 10 — Complete bipartite graph K_{a,b}

**Problem.** Verify the closed form `τ(K_{a,b}) = a^{b−1} · b^{a−1}` against your determinant for small `a, b`.

**Constraints.** `1 ≤ a, b ≤ 6`.

**Hint.** Build all `a·b` cross edges, count with `count`, compare to `a^{b−1}·b^{a−1}`.

#### Go
```go
package main

import "fmt"

func kab(a, b int) (int, [][2]int) {
	n := a + b
	var e [][2]int
	for i := 0; i < a; i++ {
		for j := 0; j < b; j++ {
			e = append(e, [2]int{i, a + j})
		}
	}
	return n, e
}

func pow(b, e int) int64 {
	r := int64(1)
	for ; e > 0; e-- {
		r *= int64(b)
	}
	return r
}

func main() {
	for a := 1; a <= 4; a++ {
		for b := 1; b <= 4; b++ {
			n, e := kab(a, b)
			got := count(n, e)
			want := pow(a, b-1) * pow(b, a-1)
			fmt.Printf("K_{%d,%d}: got %d want %d\n", a, b, got, want)
		}
	}
}
// reuse count from Task 2
```

#### Java
```java
public class Task10 {
    static int[][] kab(int a, int b) {
        java.util.List<int[]> e = new java.util.ArrayList<>();
        for (int i = 0; i < a; i++)
            for (int j = 0; j < b; j++) e.add(new int[]{i, a + j});
        return e.toArray(new int[0][]);
    }
    static long pow(int b, int e) { long r = 1; while (e-- > 0) r *= b; return r; }
    public static void main(String[] args) {
        for (int a = 1; a <= 4; a++)
            for (int b = 1; b <= 4; b++) {
                long got = Task2.count(a + b, kab(a, b));
                long want = pow(a, b - 1) * pow(b, a - 1);
                System.out.printf("K_{%d,%d}: got %d want %d%n", a, b, got, want);
            }
    }
}
```

#### Python
```python
def kab(a, b):
    e = [(i, a + j) for i in range(a) for j in range(b)]
    return a + b, e

for a in range(1, 5):
    for b in range(1, 5):
        n, e = kab(a, b)
        got = count(n, e)
        want = a ** (b - 1) * b ** (a - 1)
        print(f"K_{{{a},{b}}}: got {got} want {want}")
        assert got == want
# reuse count from Task 2
```

---

## Advanced Tasks (5)

### Task 11 — Multi-prime CRT for the exact huge count

**Problem.** Compute the exact spanning-tree count by combining `det mod p_k` over several primes via CRT, then verify against Bareiss.

**Constraints.** `1 ≤ n ≤ 80`. Use 3–5 primes near `1e9`.

**Hint.** `x ≡ r_k (mod p_k)`; combine incrementally: keep `(x, M)` and merge with each `(r_k, p_k)` using the inverse of `M mod p_k`.

#### Python (reference; Go/Java mirror the same CRT loop)
```python
PRIMES = [1_000_000_007, 998_244_353, 1_000_000_009]

def det_mod(M, p):
    m = len(M); A = [[x % p for x in row] for row in M]; det = 1
    for i in range(m):
        q = i
        while q < m and A[q][i] == 0: q += 1
        if q == m: return 0
        if q != i: A[i], A[q] = A[q], A[i]; det = (-det) % p
        det = det * A[i][i] % p
        iv = pow(A[i][i], p - 2, p)
        for r in range(i + 1, m):
            f = A[r][i] * iv % p
            for c in range(i, m):
                A[r][c] = (A[r][c] - f * A[i][c]) % p
    return det

def reduced_laplacian(n, edges):
    L = [[0] * n for _ in range(n)]
    for u, v in edges:
        if u == v: continue
        L[u][u] += 1; L[v][v] += 1; L[u][v] -= 1; L[v][u] -= 1
    m = n - 1
    return [row[:m] for row in L[:m]]

def crt(residues, primes):
    x, M = 0, 1
    for r, p in zip(residues, primes):
        # solve x' = x + M*t ≡ r (mod p)
        t = (r - x) % p * pow(M % p, p - 2, p) % p
        x += M * t
        M *= p
    return x % M

def count_crt(n, edges):
    M = reduced_laplacian(n, edges)
    res = [det_mod(M, p) for p in PRIMES]
    return crt(res, PRIMES)


k20 = complete(20)
print(count_crt(20, k20))            # 20**18
assert count_crt(20, k20) == 20 ** 18
```

#### Go
```go
// crtCount: build reduced Laplacian, det mod each prime, CRT-combine with math/big.
// (det mod p reuses Task 6's logic; CRT uses big.Int for the modulus product.)
// Verify crtCount(20, complete(20)) == 20^18.
```

#### Java
```java
// crtCount: same structure — det mod each prime (Task 6), then BigInteger CRT.
// Verify crtCount(20, complete(20)).equals(BigInteger.valueOf(20).pow(18)).
```

---

### Task 12 — Effective resistance via the Laplacian pseudoinverse

**Problem.** For a graph with unit-resistance edges, compute the effective resistance `R(s,t)` between two given nodes.

**Constraints.** `2 ≤ n ≤ 200`. Use `R(s,t) = L⁺[s][s] + L⁺[t][t] − 2L⁺[s][t]` (pseudoinverse) or, equivalently, solve `L x = e_s − e_t` after grounding one node.

**Hint.** Ground node `n−1` (delete its row/col), solve the reduced system for the unit current `s→t`, then `R = x_s − x_t`. A series of two unit resistors gives `R = 2`; a triangle of unit resistors between two nodes gives `2/3`.

#### Python
```python
from fractions import Fraction

def effective_resistance(n, edges, s, t):
    L = [[Fraction(0)] * n for _ in range(n)]
    for u, v in edges:
        if u == v: continue
        L[u][u] += 1; L[v][v] += 1; L[u][v] -= 1; L[v][u] -= 1
    ground = n - 1
    idx = [i for i in range(n) if i != ground]
    m = len(idx)
    pos = {v: i for i, v in enumerate(idx)}
    A = [[L[idx[i]][idx[j]] for j in range(m)] for i in range(m)]
    b = [Fraction(0)] * m
    if s != ground: b[pos[s]] += 1
    if t != ground: b[pos[t]] -= 1
    # solve A x = b exactly
    for i in range(m):
        p = next(r for r in range(i, m) if A[r][i] != 0)
        A[i], A[p] = A[p], A[i]; b[i], b[p] = b[p], b[i]
        inv = A[i][i]
        for r in range(m):
            if r != i and A[r][i] != 0:
                f = A[r][i] / inv
                for c in range(i, m):
                    A[r][c] -= f * A[i][c]
                b[r] -= f * b[i]
    x = [b[i] / A[i][i] for i in range(m)]
    xs = x[pos[s]] if s != ground else Fraction(0)
    xt = x[pos[t]] if t != ground else Fraction(0)
    return xs - xt


print(effective_resistance(3, [(0, 1), (1, 2)], 0, 2))          # series: 2
print(effective_resistance(3, [(0, 1), (1, 2), (0, 2)], 0, 1))  # triangle: 2/3
```

#### Go / Java
```text
// Mirror the Python: exact Fraction (use math/big.Rat in Go, a rational class in Java),
// ground node n-1, solve L_reduced x = e_s - e_t by Gauss-Jordan, return x_s - x_t.
// Checks: series of two unit resistors -> 2; unit triangle between adjacent nodes -> 2/3.
```

---

### Task 13 — Spanning trees through a fixed edge (contraction)

**Problem.** Count spanning trees that **must include** a given edge `e = (u,v)`. Equivalently, contract `e` (merge `u` and `v`) and count spanning trees of the contracted graph.

**Constraints.** `2 ≤ n ≤ 100`.

**Hint.** Trees through `e` = `τ(G / e)` (contraction). Trees avoiding `e` = `τ(G − e)` (deletion). Deletion–contraction: `τ(G) = τ(G − e) + τ(G / e)`. Use this as a check.

#### Python
```python
def contract(n, edges, ce):
    """Merge endpoints of edges[ce] -> graph on n-1 vertices."""
    u, v = edges[ce]
    a, b = min(u, v), max(u, v)
    def relabel(x):
        if x == b: return a
        return x - 1 if x > b else x
    ne = []
    for i, (x, y) in enumerate(edges):
        if i == ce: continue
        nx, ny = relabel(x), relabel(y)
        if nx != ny:
            ne.append((nx, ny))
        # self-loops (nx==ny) dropped
    return n - 1, ne

def trees_through_edge(n, edges, ce):
    nn, ne = contract(n, edges, ce)
    return count(nn, ne)


# K4: total 16. Each edge lies in 16 * (n-1)/m_edges? Check via deletion-contraction.
k4 = complete(4)
through = trees_through_edge(4, k4, 0)
# avoid edge 0 = K4 minus that edge
avoid = count(4, [e for i, e in enumerate(k4) if i != 0])
print("through:", through, "avoid:", avoid, "sum:", through + avoid)  # 8 + 8 = 16
```

#### Go / Java
```text
// Same plan: contract the chosen edge (merge endpoints, relabel, drop resulting self-loops,
// keep parallels), then count on n-1 vertices. Verify deletion-contraction:
//   trees_through(e) + trees_avoiding(e) == total tau(G).
```

---

### Task 14 — Random graph reliability sanity (count vs sampling)

**Problem.** For a random connected graph, compute `τ(G)` exactly (Bareiss) and confirm a Monte-Carlo estimate of the spanning-tree count ratio between two graphs differing by one edge.

**Constraints.** `5 ≤ n ≤ 12` so the exact count is checkable; do not enumerate for larger `n`.

**Hint.** Adding an edge can only increase (or keep) the spanning-tree count. Verify `τ(G + e) ≥ τ(G)` and that `τ(G + e) − τ(G)` equals `τ((G + e) / e)` (trees through the new edge).

#### Python
```python
import random

def random_connected(n, extra):
    edges = [(i, i + 1) for i in range(n - 1)]      # a path -> connected
    pool = [(i, j) for i in range(n) for j in range(i + 1, n) if (i, j) not in edges]
    random.shuffle(pool)
    edges += pool[:extra]
    return edges

def check(n):
    edges = random_connected(n, 3)
    base = count(n, edges)
    # add one more edge not present
    present = set(edges)
    cand = [(i, j) for i in range(n) for j in range(i + 1, n) if (i, j) not in present]
    if not cand:
        return
    e = cand[0]
    plus = count(n, edges + [e])
    assert plus >= base, (base, plus)
    # difference = trees through the new edge = tau((G+e)/e)
    ci = len(edges)           # index of the new edge in edges+[e]
    through = trees_through_edge(n, edges + [e], ci)
    assert plus - base == through, (plus - base, through)
    print(f"n={n}: tau(G)={base}, tau(G+e)={plus}, through={through} OK")

for n in range(5, 11):
    check(n)
```

#### Go / Java
```text
// Build a random connected graph (start from a path, add random extra edges),
// compute tau exactly with Bareiss, add one edge, assert tau(G+e) >= tau(G), and
// assert the increase equals trees_through_edge (contraction). Mirror the Python.
```

---

### Task 15 — Spanning trees of a grid graph

**Problem.** Count spanning trees of the `r × c` grid graph (vertices on a lattice, edges between orthogonal neighbors). Verify small cases against the determinant; compare to the known closed form for `2 × n` grids.

**Constraints.** `1 ≤ r, c ≤ 6` for the determinant; `r·c ≤ 36`.

**Hint.** `2 × n` grid spanning trees follow the recurrence `a_n = 4·a_{n−1} − a_{n−2}` with `a_1 = 1, a_2 = 4` (so `4, 15, 56, …`). The determinant must agree.

#### Python
```python
def grid(r, c):
    idx = lambda i, j: i * c + j
    e = []
    for i in range(r):
        for j in range(c):
            if j + 1 < c: e.append((idx(i, j), idx(i, j + 1)))
            if i + 1 < r: e.append((idx(i, j), idx(i + 1, j)))
    return r * c, e

def two_by_n(n):
    a = [0, 1, 4]
    for k in range(3, n + 1):
        a.append(4 * a[k - 1] - a[k - 2])
    return a[n]

for c in range(1, 6):
    n, e = grid(2, c)
    got = count(n, e)
    want = two_by_n(c)
    print(f"2x{c} grid: got {got} want {want}")
    assert got == want

n, e = grid(3, 3)
print("3x3 grid:", count(n, e))   # 192
```

#### Go
```go
package main

import "fmt"

func grid(r, c int) (int, [][2]int) {
	idx := func(i, j int) int { return i*c + j }
	var e [][2]int
	for i := 0; i < r; i++ {
		for j := 0; j < c; j++ {
			if j+1 < c {
				e = append(e, [2]int{idx(i, j), idx(i, j+1)})
			}
			if i+1 < r {
				e = append(e, [2]int{idx(i, j), idx(i+1, j)})
			}
		}
	}
	return r * c, e
}

func main() {
	for c := 1; c <= 5; c++ {
		n, e := grid(2, c)
		fmt.Printf("2x%d grid: %d\n", c, count(n, e)) // 1,4,15,56,209
	}
	n, e := grid(3, 3)
	fmt.Println("3x3 grid:", count(n, e)) // 192
}
// reuse count from Task 2
```

#### Java
```java
public class Task15 {
    static Object[] grid(int r, int c) {
        java.util.List<int[]> e = new java.util.ArrayList<>();
        for (int i = 0; i < r; i++)
            for (int j = 0; j < c; j++) {
                if (j + 1 < c) e.add(new int[]{i * c + j, i * c + j + 1});
                if (i + 1 < r) e.add(new int[]{i * c + j, (i + 1) * c + j});
            }
        return new Object[]{r * c, e.toArray(new int[0][])};
    }
    public static void main(String[] args) {
        for (int c = 1; c <= 5; c++) {
            Object[] g = grid(2, c);
            System.out.printf("2x%d grid: %d%n", c, Task2.count((int) g[0], (int[][]) g[1]));
        }
        Object[] g = grid(3, 3);
        System.out.println("3x3 grid: " + Task2.count((int) g[0], (int[][]) g[1])); // 192
    }
}
```

---

## Benchmark Task — Float vs Modular vs Bareiss

**Problem.** Generate complete graphs `K_n` for `n = 50, 100, 200`. Time three implementations: float determinant, modular determinant, and Bareiss big-int. Report which is fastest and which is *correct*.

**Expected findings.**
- Float is fastest but **wrong** for `n ≥ ~15` (precision loss) — it prints a number close to the truth's magnitude but with garbage trailing digits.
- Modular is fast and **exact mod p**; the right default when "mod p" is acceptable.
- Bareiss is **exact (full integer)** but slowest due to growing big integers; use it (or CRT) only when the true integer is required.

#### Python
```python
import time

def bench(n):
    e = complete(n)
    for name, fn in [("modular", lambda: count_mod(n, e)),
                     ("bareiss", lambda: bareiss(n, e))]:
        t0 = time.perf_counter()
        val = fn()
        dt = time.perf_counter() - t0
        digits = len(str(val))
        print(f"K_{n:<4} {name:<8} {dt*1000:8.1f} ms  ({digits} digits)")

for n in (50, 100, 200):
    bench(n)
# reuse count_mod (Task 6) and bareiss (Task 7)
```

#### Go / Java
```text
// Time countMod (Task 6) and bareiss (Task 7) on complete(50/100/200).
// Go: time.Now()/time.Since. Java: System.nanoTime().
// Observe: modular ~ constant-factor faster; Bareiss grows superlinearly per op
// as big integers lengthen. Both EXACT; the float path (Task 2) is fast but inexact at scale.
```

**Evaluation criteria.**
- Correctness: modular result equals `pow(n, n-2, MOD)`; Bareiss equals `n**(n-2)`.
- Performance: report wall-clock for each `n`; explain the float trap.
- Discussion: when would you pick CRT (Task 11) over Bareiss? (Answer: large `n` where parallelism and bounded per-prime memory win.)
