# Factorial Time O(n!) -- Specification and References

## Table of Contents

1. [Formal Definition](#formal-definition)
2. [Mathematical Properties](#mathematical-properties)
3. [Complexity Class Relationships](#complexity-class-relationships)
4. [Canonical Problems](#canonical-problems)
5. [Key Algorithms and Their Complexities](#key-algorithms-and-their-complexities)
6. [References](#references)
7. [Further Reading](#further-reading)

---

## Formal Definition

### Big-O Definition

A function f(n) is O(n!) if there exist positive constants c and n0 such that:

```
f(n) <= c * n!   for all n >= n0
```

### Factorial Definition

For a non-negative integer n:

```
n! = product from k=1 to n of k = 1 * 2 * 3 * ... * n
0! = 1  (by convention)
```

### Stirling's Approximation

```
n! = sqrt(2 * pi * n) * (n/e)^n * (1 + O(1/n))
```

Full asymptotic series:

```
n! ~ sqrt(2*pi*n) * (n/e)^n * (1 + 1/(12n) + 1/(288n^2) - 139/(51840n^3) + ...)
```

### Logarithmic Form

```
ln(n!) = n*ln(n) - n + 0.5*ln(2*pi*n) + O(1/n)
log2(n!) = n*log2(n) - n*log2(e) + 0.5*log2(2*pi*n) + O(1/n)
         = Theta(n * log(n))
```

---

## Mathematical Properties

### Recurrence

```
n! = n * (n-1)!,  with 0! = 1
```

### Gamma Function Extension

```
Gamma(n+1) = n!  for non-negative integers n
Gamma(z) = integral_0^inf t^(z-1) * e^(-t) dt  for Re(z) > 0
```

### Bounds

```
(n/e)^n <= n! <= n^n                    (elementary bounds)
sqrt(2*pi*n) * (n/e)^n <= n! <= e * sqrt(n) * (n/e)^n  (tighter bounds)
```

### Growth Rate Comparisons

For sufficiently large n:

```
n^k << 2^n << n! << n^n << 2^(n^2)     (for any fixed k)
```

Where << means "grows asymptotically slower than."

### Divisibility

- n! is divisible by all primes p <= n (Legendre's formula gives the exact power).
- The prime factorization of n! is: n! = product over primes p <= n of p^(sum_{i=1}^{inf} floor(n/p^i)).

---

## Complexity Class Relationships

### Class Hierarchy

```
P  ⊆  NP  ⊆  PH  ⊆  P^(#P)  ⊆  PSPACE  ⊆  EXPTIME
```

### Where Factorial Algorithms Fit

- Problems requiring enumeration of all n! permutations are solvable in O(n!) time and
  O(n) space (using backtracking with space reuse), placing them in **PSPACE**.

- Many O(n!) brute-force problems can be reduced to O(2^n * poly(n)) via dynamic
  programming over subsets, which is still in **EXPTIME** but significantly faster.

- The class **#P** captures counting problems over permutations (e.g., permanent).

### Key Complexity Results

| Result                  | Statement                                    | Year |
|------------------------|----------------------------------------------|------|
| Valiant                | Permanent is #P-complete                     | 1979 |
| Toda                   | PH ⊆ P^(#P)                                 | 1991 |
| Held-Karp              | TSP in O(2^n * n^2) via DP                   | 1962 |
| Christofides           | 3/2-approximation for metric TSP             | 1976 |
| Jerrum-Sinclair-Vigoda | FPRAS for permanent of non-negative matrices  | 2004 |
| Karlin-Klein-Gharan    | (3/2 - epsilon)-approximation for metric TSP  | 2021 |

---

## Canonical Problems

### 1. Permutation Generation

- **Input**: n distinct elements.
- **Output**: all n! permutations.
- **Brute force**: O(n! * n) time, O(n! * n) space.
- **Best known**: O(n!) time with O(1) amortized work per permutation (Heap's algorithm).

### 2. Traveling Salesman Problem (TSP)

- **Input**: n cities with pairwise distances.
- **Output**: minimum-cost Hamiltonian cycle.
- **Brute force**: O(n!) time.
- **Best exact**: O(2^n * n^2) time, O(2^n * n) space (Held-Karp).
- **Best approximation** (metric): 3/2-approximation in O(n^3) (Christofides).
- **NP-hard** for the decision version; #P-hard for counting Hamiltonian cycles.

### 3. Permanent of a Matrix

- **Input**: n x n matrix.
- **Output**: sum over all permutations of product of selected entries.
- **Brute force**: O(n! * n) time.
- **Best exact**: O(2^n * n) time (Ryser's formula).
- **Best approximate**: FPRAS for non-negative matrices (Jerrum-Sinclair-Vigoda).
- **#P-complete** (Valiant).

### 4. Assignment Problem

- **Input**: n x n cost matrix.
- **Output**: minimum-cost perfect matching in complete bipartite graph.
- **Brute force**: O(n!) time.
- **Best exact**: O(n^3) (Hungarian algorithm / Kuhn-Munkres).
- **In P** -- despite n! possible assignments, polynomial structure exists.

### 5. Job Scheduling (Single Machine, Weighted Completion Time)

- **Input**: n jobs with processing times and weights.
- **Output**: ordering minimizing total weighted completion time.
- **Brute force**: O(n!) time.
- **Optimal**: O(n log n) via Smith's rule (WSPT).
- **In P** for single machine; NP-hard for multiple machines.

### 6. Derangements

- **Input**: integer n.
- **Output**: count of permutations with no fixed points.
- **Brute force**: O(n! * n) time (generate all, filter).
- **Optimal**: O(n) via recurrence D(n) = (n-1)(D(n-1) + D(n-2)).
- **Closed form**: D(n) = n! * sum_{i=0}^{n} (-1)^i / i!

---

## Key Algorithms and Their Complexities

| Algorithm                        | Time Complexity    | Space        | Problem              |
|----------------------------------|-------------------|--------------|----------------------|
| Simple recursive permutation     | O(n! * n)         | O(n)         | Permutation gen.     |
| Heap's algorithm                 | O(n!)             | O(n)         | Permutation gen.     |
| Next permutation                 | O(n) per call     | O(1)         | Lexicographic perm.  |
| Steinhaus-Johnson-Trotter        | O(n!)             | O(n)         | Permutation gen.     |
| TSP brute force                  | O(n!)             | O(n)         | TSP                  |
| Held-Karp DP                     | O(2^n * n^2)      | O(2^n * n)   | TSP                  |
| Branch and bound (TSP)           | O(n!) worst case  | O(n)         | TSP                  |
| Nearest neighbor heuristic       | O(n^2)            | O(n)         | TSP (approx.)        |
| 2-opt improvement                | O(n^2) per iter.  | O(n)         | TSP (local search)   |
| Christofides' algorithm          | O(n^3)            | O(n^2)       | Metric TSP (1.5x)    |
| Hungarian algorithm              | O(n^3)            | O(n^2)       | Assignment           |
| Ryser's formula                  | O(2^n * n)        | O(n)         | Permanent            |
| Smith's WSPT rule                | O(n log n)        | O(n)         | Scheduling           |
| NEH heuristic                    | O(n^2 * m)        | O(n * m)     | Flow shop sched.     |

---

## References

### Textbooks

1. **Cormen, T.H., Leiserson, C.E., Rivest, R.L., Stein, C.** (2009).
   *Introduction to Algorithms* (3rd ed.). MIT Press.
   - Chapter 34: NP-Completeness (TSP, Hamiltonian cycle)
   - Chapter 8.1: Lower bounds for sorting (counting argument)

2. **Sedgewick, R., Wayne, K.** (2011).
   *Algorithms* (4th ed.). Addison-Wesley.
   - Section 2.1: Elementary sorts and permutation generation

3. **Kleinberg, J., Tardos, E.** (2005).
   *Algorithm Design*. Pearson.
   - Chapter 8: NP and Computational Intractability
   - Chapter 11: Approximation Algorithms

4. **Papadimitriou, C.H., Steiglitz, K.** (1982).
   *Combinatorial Optimization: Algorithms and Complexity*. Dover.
   - Chapters on TSP, assignment problem, branch and bound

5. **Arora, S., Barak, B.** (2009).
   *Computational Complexity: A Modern Approach*. Cambridge University Press.
   - Chapter 17: Counting complexity (#P)

6. **Sipser, M.** (2012).
   *Introduction to the Theory of Computation* (3rd ed.). Cengage Learning.
   - Chapter 7: Time Complexity; Chapter 8: Space Complexity

### Key Papers

7. **Heap, B.R.** (1963). "Permutations by Interchanges."
   *The Computer Journal*, 6(3), 293-298.
   - Original description of Heap's algorithm.

8. **Held, M., Karp, R.M.** (1962). "A Dynamic Programming Approach to
   Sequencing Problems." *Journal of the Society for Industrial and Applied
   Mathematics*, 10(1), 196-210.
   - The Held-Karp algorithm for TSP in O(2^n * n^2).

9. **Valiant, L.G.** (1979). "The Complexity of Computing the Permanent."
   *Theoretical Computer Science*, 8(2), 189-201.
   - Proof that the permanent is #P-complete.

10. **Toda, S.** (1991). "PP is as Hard as the Polynomial-Time Hierarchy."
    *SIAM Journal on Computing*, 20(5), 865-877.
    - Toda's theorem: PH ⊆ P^(#P).

11. **Christofides, N.** (1976). "Worst-Case Analysis of a New Heuristic for
    the Travelling Salesman Problem." Report 388, Graduate School of
    Industrial Administration, CMU.
    - The 3/2-approximation algorithm for metric TSP.

12. **Jerrum, M., Sinclair, A., Vigoda, E.** (2004). "A Polynomial-Time
    Approximation Algorithm for the Permanent of a Matrix with Nonnegative
    Entries." *Journal of the ACM*, 51(4), 671-697.
    - FPRAS for the permanent.

13. **Karlin, A.R., Klein, N., Oveis Gharan, S.** (2021). "A (Slightly)
    Improved Approximation Algorithm for Metric TSP."
    *Proceedings of the 53rd ACM STOC*, 32-45.
    - First improvement over Christofides' ratio in 45 years.

14. **Alon, N., Yuster, R., Zwick, U.** (1995). "Color-Coding."
    *Journal of the ACM*, 42(4), 844-856.
    - Color-coding technique for finding paths and cycles.

15. **Nawaz, M., Enscore, E.E., Ham, I.** (1983). "A Heuristic Algorithm for
    the m-Machine, n-Job Flow-Shop Sequencing Problem."
    *Omega*, 11(1), 91-95.
    - The NEH heuristic for flow shop scheduling.

### Online Resources

16. **OEIS A000142** -- Factorial numbers.
    https://oeis.org/A000142

17. **OEIS A000166** -- Derangement numbers (subfactorials).
    https://oeis.org/A000166

18. **Wikipedia: Stirling's approximation.**
    https://en.wikipedia.org/wiki/Stirling%27s_approximation

19. **Wikipedia: Travelling salesman problem.**
    https://en.wikipedia.org/wiki/Travelling_salesman_problem

20. **Concorde TSP Solver.**
    http://www.math.uwaterloo.ca/tsp/concorde.html

---

## Further Reading

### For Practitioners

- **Applegate, D.L., Bixby, R.E., Chvatal, V., Cook, W.J.** (2006).
  *The Traveling Salesman Problem: A Computational Study*. Princeton University Press.
  - The definitive practical guide to solving TSP instances.

- **Toth, P., Vigo, D.** (2014). *Vehicle Routing: Problems, Methods, and
  Applications* (2nd ed.). SIAM.
  - Comprehensive treatment of practical routing problems.

### For Theoreticians

- **Barvinok, A.** (2016). *Combinatorics and Complexity of Partition Functions*.
  Springer.
  - Covers the permanent and related counting problems.

- **Wigderson, A.** (2019). *Mathematics and Computation*. Princeton University Press.
  - Broad overview of computational complexity including counting complexity.

### LeetCode Practice Problems

| Problem | Title                      | Difficulty | Relevance                    |
|---------|----------------------------|------------|------------------------------|
| 31      | Next Permutation           | Medium     | O(n) per permutation step    |
| 46      | Permutations               | Medium     | O(n!) generation             |
| 47      | Permutations II            | Medium     | O(n!/k!) with duplicates     |
| 60      | Permutation Sequence       | Hard       | k-th permutation in O(n^2)   |
| 784     | Letter Case Permutation    | Medium     | Subset-style permutations    |
| 943     | Find the Shortest Superstring | Hard    | TSP variant                  |
| 996     | Number of Squareful Arrays | Hard       | Constrained permutations     |
