# Factorial Time O(n!) -- Optimization Exercises

## Table of Contents

1. Exercise 1: TSP from O(n!) to O(2^n * n^2) with DP
2. Exercise 2: Reduce Permutation Search with Pruning
3. Exercise 3: Assignment Problem -- Hungarian Algorithm
4. Exercise 4: Scheduling -- Smith's Rule vs Brute Force
5. Exercise 5: Permanent via Ryser's Formula
6. Exercise 6: TSP Approximation via MST
7. Exercise 7: Eliminate Rotational Symmetry in TSP
8. Exercise 8: Memoize Subproblems in Permutation Search
9. Exercise 9: Replace Full Permutations with Partial
10. Exercise 10: Use Greedy + Local Search Instead of Brute Force
11. Exercise 11: Color-Coding for Path Finding
12. Exercise 12: Inclusion-Exclusion for Derangement Counting

---

## Exercise 1: TSP from O(n!) to O(2^n * n^2) with DP

### Problem

Brute-force TSP tries all (n-1)! routes. Reduce to O(2^n * n^2) using Held-Karp
dynamic programming.

### Key Insight

We only need to know **which cities have been visited** and **where we currently are**,
not the exact order. This reduces the state space from n! (permutations) to
2^n * n (subsets x current city).

### Slow Version -- O(n!)

```python
from itertools import permutations

def tsp_brute(dist):
    n = len(dist)
    best = float("inf")
    for perm in permutations(range(1, n)):
        cost = dist[0][perm[0]]
        for i in range(len(perm) - 1):
            cost += dist[perm[i]][perm[i + 1]]
        cost += dist[perm[-1]][0]
        best = min(best, cost)
    return best
```

### Optimized Version -- O(2^n * n^2)

```python
def tsp_held_karp(dist):
    n = len(dist)
    INF = float("inf")
    # dp[mask][i] = min cost to visit cities in mask, ending at city i
    dp = [[INF] * n for _ in range(1 << n)]
    dp[1][0] = 0  # start at city 0, only city 0 visited

    for mask in range(1 << n):
        for u in range(n):
            if dp[mask][u] == INF:
                continue
            if not (mask & (1 << u)):
                continue
            for v in range(n):
                if mask & (1 << v):
                    continue
                new_mask = mask | (1 << v)
                new_cost = dp[mask][u] + dist[u][v]
                if new_cost < dp[new_mask][v]:
                    dp[new_mask][v] = new_cost

    full_mask = (1 << n) - 1
    return min(dp[full_mask][i] + dist[i][0] for i in range(1, n))
```

### Go Implementation

```go
package main

import (
    "fmt"
    "math"
)

func tspHeldKarp(dist [][]float64) float64 {
    n := len(dist)
    size := 1 << n
    dp := make([][]float64, size)
    for i := range dp {
        dp[i] = make([]float64, n)
        for j := range dp[i] {
            dp[i][j] = math.Inf(1)
        }
    }
    dp[1][0] = 0

    for mask := 0; mask < size; mask++ {
        for u := 0; u < n; u++ {
            if dp[mask][u] == math.Inf(1) || mask&(1<<u) == 0 {
                continue
            }
            for v := 0; v < n; v++ {
                if mask&(1<<v) != 0 {
                    continue
                }
                newMask := mask | (1 << v)
                newCost := dp[mask][u] + dist[u][v]
                if newCost < dp[newMask][v] {
                    dp[newMask][v] = newCost
                }
            }
        }
    }

    fullMask := size - 1
    best := math.Inf(1)
    for i := 1; i < n; i++ {
        cost := dp[fullMask][i] + dist[i][0]
        if cost < best {
            best = cost
        }
    }
    return best
}

func main() {
    dist := [][]float64{
        {0, 10, 15, 20},
        {10, 0, 35, 25},
        {15, 35, 0, 30},
        {20, 25, 30, 0},
    }
    fmt.Printf("Held-Karp optimal: %.1f\n", tspHeldKarp(dist))
}
```

### Java Implementation

```java
import java.util.Arrays;

public class HeldKarp {
    public static double solve(double[][] dist) {
        int n = dist.length;
        int size = 1 << n;
        double[][] dp = new double[size][n];
        for (double[] row : dp) Arrays.fill(row, Double.MAX_VALUE);
        dp[1][0] = 0;

        for (int mask = 0; mask < size; mask++) {
            for (int u = 0; u < n; u++) {
                if (dp[mask][u] == Double.MAX_VALUE) continue;
                if ((mask & (1 << u)) == 0) continue;
                for (int v = 0; v < n; v++) {
                    if ((mask & (1 << v)) != 0) continue;
                    int newMask = mask | (1 << v);
                    double newCost = dp[mask][u] + dist[u][v];
                    dp[newMask][v] = Math.min(dp[newMask][v], newCost);
                }
            }
        }

        int full = size - 1;
        double best = Double.MAX_VALUE;
        for (int i = 1; i < n; i++) {
            best = Math.min(best, dp[full][i] + dist[i][0]);
        }
        return best;
    }
}
```

### Speedup Comparison

| n  | O(n!) operations | O(2^n * n^2) operations | Speedup       |
|----|------------------|------------------------|---------------|
| 10 | 3,628,800        | 102,400                | 35x           |
| 15 | 1.31 x 10^12     | 7,372,800              | 177,000x      |
| 20 | 2.43 x 10^18     | 419,430,400            | 5.8 billion x |

---

## Exercise 2: Reduce Permutation Search with Pruning

### Problem

Given n items with values and weights, find the ordering that maximizes value where each
subsequent item must be lighter than the previous. Brute force: O(n!). With pruning, far fewer nodes.

### Slow Version

```python
from itertools import permutations

def best_ordering_brute(items):
    """items = [(value, weight), ...]"""
    best = 0
    for perm in permutations(range(len(items))):
        valid = True
        total_value = 0
        for k in range(len(perm)):
            if k > 0 and items[perm[k]][1] >= items[perm[k-1]][1]:
                valid = False
                break
            total_value += items[perm[k]][0]
        if valid:
            best = max(best, total_value)
    return best
```

### Optimized Version (Pruning)

```python
def best_ordering_pruned(items):
    n = len(items)
    best = [0]
    used = [False] * n

    def backtrack(last_weight, current_value, depth):
        best[0] = max(best[0], current_value)
        if depth == n:
            return
        for i in range(n):
            if not used[i] and items[i][1] < last_weight:
                # Pruning: upper bound check
                remaining_value = sum(
                    items[j][0] for j in range(n)
                    if not used[j] and j != i
                )
                if current_value + items[i][0] + remaining_value <= best[0]:
                    continue  # Prune: can't beat current best
                used[i] = True
                backtrack(items[i][1], current_value + items[i][0], depth + 1)
                used[i] = False

    backtrack(float("inf"), 0, 0)
    return best[0]
```

---

## Exercise 3: Assignment Problem -- Hungarian Algorithm

### Problem

Assign n workers to n tasks minimizing total cost. Brute force: O(n!).
Hungarian algorithm: O(n^3).

### Slow Version -- O(n!)

```python
from itertools import permutations

def assignment_brute(cost):
    n = len(cost)
    best = float("inf")
    for perm in permutations(range(n)):
        total = sum(cost[i][perm[i]] for i in range(n))
        best = min(best, total)
    return best
```

### Optimized Version -- O(n^3) Hungarian Algorithm

```python
def hungarian(cost):
    """Simplified Hungarian algorithm for square cost matrix."""
    n = len(cost)
    u = [0] * (n + 1)
    v = [0] * (n + 1)
    p = [0] * (n + 1)
    way = [0] * (n + 1)

    for i in range(1, n + 1):
        p[0] = i
        j0 = 0
        minv = [float("inf")] * (n + 1)
        used = [False] * (n + 1)

        while True:
            used[j0] = True
            i0 = p[j0]
            delta = float("inf")
            j1 = 0
            for j in range(1, n + 1):
                if not used[j]:
                    cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
                    if cur < minv[j]:
                        minv[j] = cur
                        way[j] = j0
                    if minv[j] < delta:
                        delta = minv[j]
                        j1 = j
            for j in range(n + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break

        while j0:
            p[j0] = p[way[j0]]
            j0 = way[j0]

    assignment = [0] * n
    for j in range(1, n + 1):
        if p[j] != 0:
            assignment[p[j] - 1] = j - 1

    total = sum(cost[i][assignment[i]] for i in range(n))
    return total, assignment

# Test
cost = [
    [9, 2, 7, 8],
    [6, 4, 3, 7],
    [5, 8, 1, 8],
    [7, 6, 9, 4],
]
print(f"Brute: {assignment_brute(cost)}")
total, assign = hungarian(cost)
print(f"Hungarian: {total}, assignment: {assign}")
```

---

## Exercise 4: Scheduling -- Smith's Rule vs Brute Force

### Problem

Minimize total weighted completion time for single-machine scheduling.
Brute force: O(n!). Smith's rule: O(n log n).

### Slow Version

```python
from itertools import permutations

def schedule_brute(jobs):
    best = float("inf")
    for perm in permutations(range(len(jobs))):
        time = cost = 0
        for idx in perm:
            time += jobs[idx][0]
            cost += time * jobs[idx][1]
        best = min(best, cost)
    return best
```

### Optimized Version -- O(n log n)

```python
def schedule_smith(jobs):
    """Sort by processing_time / weight ratio (WSPT rule)."""
    n = len(jobs)
    order = sorted(range(n), key=lambda i: jobs[i][0] / jobs[i][1])
    time = cost = 0
    for idx in order:
        time += jobs[idx][0]
        cost += time * jobs[idx][1]
    return cost, order

jobs = [(3, 4), (1, 3), (2, 5), (4, 2), (1, 1)]
print(f"Brute: {schedule_brute(jobs)}")
cost, order = schedule_smith(jobs)
print(f"Smith: {cost}, order: {order}")
```

---

## Exercise 5: Permanent via Ryser's Formula

### Problem

Compute the permanent of an n x n matrix. Brute force: O(n! * n).
Ryser's formula: O(2^n * n).

### Slow Version

```python
from itertools import permutations

def permanent_brute(matrix):
    n = len(matrix)
    total = 0
    for perm in permutations(range(n)):
        product = 1
        for i in range(n):
            product *= matrix[i][perm[i]]
        total += product
    return total
```

### Optimized Version

```python
def permanent_ryser(matrix):
    n = len(matrix)
    # Precompute column sums for all subsets using Gray code
    result = 0
    sign = (-1) ** n
    for subset in range(1 << n):
        bits = bin(subset).count("1")
        s = (-1) ** (n - bits)
        product = 1
        for i in range(n):
            row_sum = 0
            for j in range(n):
                if subset & (1 << j):
                    row_sum += matrix[i][j]
            product *= row_sum
        result += s * product
    return result * sign

# Test
matrix = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
print(f"Brute: {permanent_brute(matrix)}")
print(f"Ryser: {permanent_ryser(matrix)}")
```

---

## Exercise 6: TSP Approximation via MST

### Problem

Approximate TSP within factor 2 using MST. O(n^2) instead of O(n!).

### Slow Version

Brute-force TSP (see Exercise 1).

### Optimized Version

```python
def tsp_mst_approx(dist):
    n = len(dist)
    # Prim's MST
    in_mst = [False] * n
    key = [float("inf")] * n
    parent = [-1] * n
    key[0] = 0

    for _ in range(n):
        u = min((i for i in range(n) if not in_mst[i]), key=lambda i: key[i])
        in_mst[u] = True
        for v in range(n):
            if not in_mst[v] and dist[u][v] < key[v]:
                key[v] = dist[u][v]
                parent[v] = u

    # Build MST adjacency
    adj = [[] for _ in range(n)]
    for v in range(1, n):
        adj[parent[v]].append(v)
        adj[v].append(parent[v])

    # DFS preorder
    visited = [False] * n
    tour = []
    def dfs(u):
        visited[u] = True
        tour.append(u)
        for v in adj[u]:
            if not visited[v]:
                dfs(v)
    dfs(0)

    cost = sum(dist[tour[i]][tour[i+1]] for i in range(n-1)) + dist[tour[-1]][tour[0]]
    return cost, tour
```

---

## Exercise 7: Eliminate Rotational Symmetry in TSP

### Problem

Circular TSP has n equivalent rotations for each route. Fix one city to reduce from n!
to (n-1)!. For undirected graphs, also exploit reflection symmetry to halve to (n-1)!/2.

### Slow Version (Counts Rotations)

```python
from itertools import permutations

def tsp_with_rotations(dist):
    """Tries all n! orderings -- wasteful."""
    n = len(dist)
    best = float("inf")
    count = 0
    for perm in permutations(range(n)):
        count += 1
        cost = sum(dist[perm[i]][perm[(i+1)%n]] for i in range(n))
        best = min(best, cost)
    return best, count
```

### Optimized Version (No Rotations)

```python
from itertools import permutations

def tsp_no_rotations(dist):
    """Fix city 0 as start. Tries (n-1)! orderings."""
    n = len(dist)
    best = float("inf")
    count = 0
    for perm in permutations(range(1, n)):
        count += 1
        route = (0,) + perm
        cost = sum(dist[route[i]][route[(i+1)%n]] for i in range(n))
        best = min(best, cost)
    return best, count

# For n=8: first version does 40320 iterations, second does 5040 (8x faster)
```

### Further: Exploit Reflection Symmetry

```python
from itertools import permutations

def tsp_no_symmetry(dist):
    """Fix city 0 and only consider permutations where city 1 comes before
    the last city (breaks reflection symmetry). Tries (n-1)!/2 orderings."""
    n = len(dist)
    best = float("inf")
    count = 0
    for perm in permutations(range(1, n)):
        # Only consider if first element < last element (breaks reflections)
        if perm[0] > perm[-1]:
            continue
        count += 1
        route = (0,) + perm
        cost = sum(dist[route[i]][route[(i+1)%n]] for i in range(n))
        best = min(best, cost)
    return best, count

# For n=8: now only 2520 iterations (16x faster than naive)
```

---

## Exercise 8: Memoize Subproblems in Permutation Search

### Problem

When searching permutations for optimization, many subproblems are repeated. Use
bitmask DP to memoize.

### Slow Version

```python
def max_score_brute(nums1, nums2):
    """Match each element of nums1 to a unique element of nums2 to maximize
    sum of nums1[i] * nums2[match[i]]. Brute force: O(n!)."""
    from itertools import permutations
    best = 0
    for perm in permutations(range(len(nums2))):
        score = sum(nums1[i] * nums2[perm[i]] for i in range(len(nums1)))
        best = max(best, score)
    return best
```

### Optimized Version -- O(2^n * n)

```python
def max_score_dp(nums1, nums2):
    """Bitmask DP. dp[mask] = max score using elements of nums2 indicated by mask,
    matched to the first popcount(mask) elements of nums1."""
    n = len(nums1)
    dp = [0] * (1 << n)

    for mask in range(1 << n):
        k = bin(mask).count("1")  # number of elements matched so far
        if k >= n:
            continue
        for j in range(n):
            if mask & (1 << j):
                continue
            new_mask = mask | (1 << j)
            dp[new_mask] = max(dp[new_mask], dp[mask] + nums1[k] * nums2[j])

    return dp[(1 << n) - 1]
```

---

## Exercise 9: Replace Full Permutations with Partial

### Problem

If you only need to choose and arrange k items from n (where k << n), use P(n,k) = n!/(n-k)!
instead of generating all n! permutations.

### Slow Version

```python
from itertools import permutations

def best_k_arrangement_brute(items, k):
    """Try all n! permutations, take first k. O(n!)."""
    best = 0
    for perm in permutations(items):
        score = sum(perm[:k])
        best = max(best, score)
    return best
```

### Optimized Version

```python
from itertools import permutations

def best_k_arrangement(items, k):
    """Only generate k-permutations. O(P(n,k)) = O(n!/(n-k)!)."""
    best = 0
    for perm in permutations(items, k):
        score = sum(perm)
        best = max(best, score)
    return best

# For n=10, k=3: brute does 3,628,800 perms; optimized does 720.
# 5000x speedup just by not generating unneeded elements.
```

Even better: for this specific problem, just sort and take top k: O(n log n).

---

## Exercise 10: Use Greedy + Local Search Instead of Brute Force

### Problem

For TSP with n cities, combine nearest-neighbor construction with 2-opt improvement
instead of brute-force.

### Slow Version

O(n!) brute force (see Exercise 1).

### Optimized Version

```python
def tsp_greedy_2opt(dist):
    n = len(dist)

    # Phase 1: Nearest neighbor O(n^2)
    visited = [False] * n
    route = [0]
    visited[0] = True
    for _ in range(n - 1):
        last = route[-1]
        best_next = min(
            (j for j in range(n) if not visited[j]),
            key=lambda j: dist[last][j]
        )
        route.append(best_next)
        visited[best_next] = True

    # Phase 2: 2-opt improvement O(n^2) per iteration
    improved = True
    while improved:
        improved = False
        for i in range(1, n - 1):
            for j in range(i + 1, n):
                d_old = dist[route[i-1]][route[i]] + dist[route[j]][route[(j+1)%n]]
                d_new = dist[route[i-1]][route[j]] + dist[route[i]][route[(j+1)%n]]
                if d_new < d_old:
                    route[i:j+1] = reversed(route[i:j+1])
                    improved = True

    cost = sum(dist[route[i]][route[(i+1)%n]] for i in range(n))
    return cost, route
```

---

## Exercise 11: Color-Coding for Path Finding

### Problem

Find if a simple path of length k exists in a graph. Brute force tries all k!
orderings of k vertices. Color-coding reduces to O(2^k * m).

### Slow Version

```python
from itertools import permutations

def has_path_brute(adj, k, n):
    """Check if a simple path of length k exists. O(n^k * k!)."""
    from itertools import combinations
    for nodes in combinations(range(n), k):
        for perm in permutations(nodes):
            valid = all(perm[i+1] in adj[perm[i]] for i in range(k-1))
            if valid:
                return True, list(perm)
    return False, []
```

### Optimized Version

```python
import random

def has_path_color_coding(adj, k, n, trials=50):
    """Color-coding: O(2^k * m * trials). Randomized."""
    for _ in range(trials):
        color = [random.randint(0, k-1) for _ in range(n)]
        # dp[mask][v] = can we reach v using colors in mask?
        dp = [[False] * n for _ in range(1 << k)]
        for v in range(n):
            dp[1 << color[v]][v] = True

        for mask in range(1, 1 << k):
            for v in range(n):
                if not dp[mask][v]:
                    continue
                for u in adj[v]:
                    c = color[u]
                    if not (mask & (1 << c)):
                        dp[mask | (1 << c)][u] = True

        full = (1 << k) - 1
        if any(dp[full][v] for v in range(n)):
            return True
    return False
```

---

## Exercise 12: Inclusion-Exclusion for Derangement Counting

### Problem

Count derangements. Brute force generates all n! permutations and checks each.
Inclusion-exclusion gives O(n) formula.

### Slow Version

```python
from itertools import permutations

def count_derangements_brute(n):
    count = 0
    for perm in permutations(range(n)):
        if all(perm[i] != i for i in range(n)):
            count += 1
    return count
```

### Optimized Version -- O(n)

```python
def count_derangements_formula(n):
    """D(n) = n! * sum_{i=0}^{n} (-1)^i / i!"""
    import math
    total = 0
    for i in range(n + 1):
        total += ((-1) ** i) * math.factorial(n) // math.factorial(i)
    return total

# Or using the recurrence D(n) = (n-1)(D(n-1) + D(n-2)):
def count_derangements_dp(n):
    if n == 0:
        return 1
    if n == 1:
        return 0
    a, b = 1, 0  # D(0), D(1)
    for i in range(2, n + 1):
        a, b = b, (i - 1) * (b + a)
    return b

# Verify
for n in range(1, 12):
    brute = count_derangements_brute(n)
    fast = count_derangements_dp(n)
    assert brute == fast, f"Mismatch at n={n}"
    print(f"D({n}) = {fast}")
```

---

## Summary of Optimization Strategies

| Technique                | From       | To                | Applicable When                          |
|--------------------------|-----------|-------------------|------------------------------------------|
| Bitmask DP (Held-Karp)   | O(n!)     | O(2^n * n^2)      | Optimal substructure over subsets        |
| Pruning / Branch & Bound | O(n!)     | O(n!) worst, much less average | Good bounds available      |
| Hungarian algorithm       | O(n!)     | O(n^3)            | Bipartite assignment structure           |
| Greedy (Smith's rule)    | O(n!)     | O(n log n)        | Problem has greedy-optimal property      |
| Ryser's formula          | O(n! * n) | O(2^n * n)        | Computing permanent                      |
| MST approximation        | O(n!)     | O(n^2)            | Metric TSP (triangle inequality)         |
| Symmetry breaking        | O(n!)     | O((n-1)!/2)       | Circular/symmetric problems              |
| Partial permutations     | O(n!)     | O(n^k)            | Only k items needed from n               |
| Greedy + local search    | O(n!)     | O(n^2) - O(n^3)   | Near-optimal sufficient                  |
| Color-coding             | O(n^k*k!) | O(2^k * m)        | Finding paths in graphs                  |
| Inclusion-exclusion      | O(n!)     | O(n) or O(2^n)    | Counting with restrictions               |
