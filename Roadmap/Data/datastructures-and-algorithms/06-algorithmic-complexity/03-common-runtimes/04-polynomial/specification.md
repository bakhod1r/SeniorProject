# Polynomial Time O(n^2), O(n^3) -- Specification and References

## Table of Contents

1. [Formal Definitions](#formal-definitions)
2. [Asymptotic Notation Standards](#asymptotic-notation-standards)
3. [Algorithm Specifications](#algorithm-specifications)
4. [Language Standard Library References](#language-standard-library-references)
5. [Academic References](#academic-references)
6. [Textbook References](#textbook-references)
7. [Online Resources](#online-resources)
8. [Complexity Zoo](#complexity-zoo)

---

## Formal Definitions

### Big-O (Upper Bound)

A function f(n) is O(g(n)) if there exist positive constants c and n0 such that:

```
f(n) <= c * g(n)  for all n >= n0
```

### Big-Omega (Lower Bound)

A function f(n) is Omega(g(n)) if there exist positive constants c and n0 such that:

```
f(n) >= c * g(n)  for all n >= n0
```

### Big-Theta (Tight Bound)

A function f(n) is Theta(g(n)) if f(n) is both O(g(n)) and Omega(g(n)):

```
c1 * g(n) <= f(n) <= c2 * g(n)  for all n >= n0
```

### Polynomial Time Class P

The complexity class P consists of all decision problems decidable by a
deterministic Turing machine in time O(n^k) for some constant k >= 0.

Formal definition:
```
P = Union over k=0,1,2,... of DTIME(n^k)
```

where DTIME(f(n)) is the class of problems decidable in O(f(n)) time on a
deterministic Turing machine.

---

## Asymptotic Notation Standards

### IEEE/ACM Standards

The asymptotic notation used in algorithm analysis follows conventions established
in:

- **Knuth, D. E.** "Big Omicron and Big Omega and Big Theta." *SIGACT News*,
  Vol. 8, No. 2, 1976, pp. 18-24.

Key conventions:
- O(f(n)) denotes an upper bound
- Omega(f(n)) denotes a lower bound
- Theta(f(n)) denotes a tight bound
- o(f(n)) denotes a strict upper bound (not tight)
- omega(f(n)) denotes a strict lower bound (not tight)

### Common Polynomial Growth Rates

| Notation  | Name       | Typical Source                              |
|-----------|------------|---------------------------------------------|
| O(n^2)    | Quadratic  | Two nested loops, simple comparison sorts   |
| O(n^2 log n) | -      | Quadratic with logarithmic inner work       |
| O(n^2.807)| -          | Strassen matrix multiplication              |
| O(n^3)    | Cubic      | Three nested loops, naive matrix multiply   |
| O(n^3 / log n) | -    | Improved Floyd-Warshall variants            |
| O(n^omega) | -         | Optimal matrix multiplication (omega < 2.373)|

---

## Algorithm Specifications

### Bubble Sort

- **Inventor:** Attributed to various, formalized in 1956
- **Reference:** Knuth, D. E. *The Art of Computer Programming, Vol. 3: Sorting
  and Searching.* Section 5.2.2.
- **Time:** O(n^2) average and worst, O(n) best (with early termination)
- **Space:** O(1)
- **Stable:** Yes
- **In-place:** Yes

### Selection Sort

- **Reference:** Knuth, D. E. *The Art of Computer Programming, Vol. 3.* Section 5.2.3.
- **Time:** Theta(n^2) all cases
- **Space:** O(1)
- **Stable:** No (standard implementation)
- **Swaps:** Theta(n) -- minimum among comparison sorts

### Insertion Sort

- **Reference:** Knuth, D. E. *The Art of Computer Programming, Vol. 3.* Section 5.2.1.
- **Time:** O(n^2) worst, O(n) best
- **Space:** O(1)
- **Stable:** Yes
- **Adaptive:** Yes
- **Online:** Yes
- **Used in practice:** As subroutine in TimSort (Python, Java), pdqsort (Go, Rust)

### Floyd-Warshall Algorithm

- **Authors:** Robert Floyd (1962), Stephen Warshall (1962)
- **Reference:**
  - Floyd, R. W. "Algorithm 97: Shortest path." *Communications of the ACM*,
    Vol. 5, No. 6, 1962, p. 345.
  - Warshall, S. "A theorem on boolean matrices." *Journal of the ACM*,
    Vol. 9, No. 1, 1962, pp. 11-12.
- **Time:** Theta(V^3)
- **Space:** Theta(V^2)
- **Purpose:** All-pairs shortest paths
- **Handles negative weights:** Yes (no negative cycles)

### Strassen Matrix Multiplication

- **Author:** Volker Strassen (1969)
- **Reference:** Strassen, V. "Gaussian elimination is not optimal."
  *Numerische Mathematik*, Vol. 13, 1969, pp. 354-356.
- **Time:** O(n^log2(7)) = O(n^2.807)
- **Space:** O(n^2)
- **Practical crossover:** n > 64-128 (implementation dependent)

### Coppersmith-Winograd Algorithm

- **Authors:** Don Coppersmith and Shmuel Winograd (1990)
- **Reference:** Coppersmith, D. and Winograd, S. "Matrix multiplication via
  arithmetic progressions." *Journal of Symbolic Computation*, Vol. 9, No. 3,
  1990, pp. 251-280.
- **Time:** O(n^2.376)
- **Note:** Galactic algorithm -- crossover point is astronomically large.
  Not used in practice.

### Current Best Matrix Multiplication

- **Authors:** Ran Duan, Hongxun Wu, Renfei Zhou (2024)
- **Reference:** "Faster Matrix Multiplication via Asymmetric Hashing."
  *FOCS 2024.*
- **Time:** O(n^2.371552)

---

## Language Standard Library References

### Go

- **sort.Ints / sort.Slice:** Uses pdqsort (pattern-defeating quicksort),
  which is O(n log n) average and worst case. Falls back to heapsort for
  worst-case guarantee. Uses insertion sort for small partitions.
  - Source: `src/sort/sort.go` in Go standard library
  - Documentation: https://pkg.go.dev/sort

### Java

- **Arrays.sort (primitives):** Uses Dual-Pivot Quicksort (since Java 7),
  which is O(n log n) average, O(n^2) worst. Uses insertion sort for small arrays.
  - Reference: Yaroslavskiy, V. "Dual-Pivot Quicksort." 2009.
  - Documentation: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Arrays.html

- **Arrays.sort (objects):** Uses TimSort, which is O(n log n) worst case.
  Stable sort based on merge sort with insertion sort for small runs.
  - Reference: Peters, T. "TimSort." Python source code, 2002.
  - Documentation: same as above

### Python

- **sorted() / list.sort():** Uses TimSort, O(n log n) worst case.
  - Reference: https://docs.python.org/3/howto/sorting.html
  - CPython implementation: `Objects/listobject.c`
  - TimSort description: https://github.com/python/cpython/blob/main/Objects/listsort.txt

---

## Academic References

### Foundational Papers

1. **Cook, S. A.** "The complexity of theorem-proving procedures."
   *Proceedings of the 3rd Annual ACM Symposium on Theory of Computing*, 1971,
   pp. 151-158.
   - Introduced NP-completeness and the P vs NP question.

2. **Karp, R. M.** "Reducibility among combinatorial problems."
   *Complexity of Computer Computations*, 1972, pp. 85-103.
   - 21 NP-complete problems, establishing the theory of NP-completeness.

3. **Ben-Or, M.** "Lower bounds for algebraic computation trees."
   *Proceedings of the 15th Annual ACM Symposium on Theory of Computing*, 1983,
   pp. 80-86.
   - Proved Omega(n log n) lower bound for element distinctness.

### Fine-Grained Complexity

4. **Williams, R.** "Hardness of easy problems: Basing hardness on popular
   conjectures such as the Strong Exponential Time Hypothesis." *IPEC 2015.*
   - Survey of SETH-based lower bounds.

5. **Vassilevska Williams, V.** "On some fine-grained questions in algorithms
   and complexity." *Proceedings of ICM*, 2018.
   - Comprehensive survey of fine-grained complexity theory.

6. **Backurs, A. and Indyk, P.** "Edit distance cannot be computed in strongly
   subquadratic time (unless SETH is false)." *STOC 2015.*
   - Proved conditional quadratic lower bound for edit distance.

### 3SUM and Related Problems

7. **Gajentaan, A. and Overmars, M. H.** "On a class of O(n^2) problems in
   computational geometry." *Computational Geometry*, Vol. 5, No. 3, 1995,
   pp. 165-185.
   - Established 3SUM-hardness framework.

8. **Gronlund, A. and Pettie, S.** "Threesomes, degenerates, and love
   triangles." *FOCS 2014.*
   - First subquadratic algorithm for 3SUM: O(n^2 / (log n / log log n)^(2/3)).

---

## Textbook References

### Primary Textbooks

1. **Cormen, T. H., Leiserson, C. E., Rivest, R. L., and Stein, C.**
   *Introduction to Algorithms* (4th Edition). MIT Press, 2022.
   - Chapter 2: Insertion sort analysis
   - Chapter 7: Quicksort
   - Chapter 8: Sorting lower bounds
   - Chapter 24: All-pairs shortest paths (Floyd-Warshall)
   - Chapter 4: Strassen's algorithm

2. **Sedgewick, R. and Wayne, K.**
   *Algorithms* (4th Edition). Addison-Wesley, 2011.
   - Chapter 2: Elementary sorts (selection, insertion, shell)
   - Chapter 2.3: Quicksort

3. **Kleinberg, J. and Tardos, E.**
   *Algorithm Design*. Pearson, 2005.
   - Chapter 5: Divide and conquer (closest pair, counting inversions)
   - Chapter 8: NP and computational intractability

4. **Knuth, D. E.**
   *The Art of Computer Programming, Volume 3: Sorting and Searching* (2nd Edition).
   Addison-Wesley, 1998.
   - Definitive reference for sorting algorithms and their analysis.

5. **Sipser, M.**
   *Introduction to the Theory of Computation* (3rd Edition). Cengage Learning, 2012.
   - Chapter 7: Time complexity (P, NP, NP-completeness)

---

## Online Resources

### Algorithm Visualization

- **VisuAlgo:** https://visualgo.net/en/sorting
  - Interactive visualizations of sorting algorithms including bubble, selection,
    and insertion sort.

- **Sorting Algorithms Animations:** https://www.toptal.com/developers/sorting-algorithms
  - Side-by-side comparison of sorting algorithms.

### Complexity References

- **Big-O Cheat Sheet:** https://www.bigocheatsheet.com/
  - Quick reference for algorithm complexities.

- **Complexity Zoo:** https://complexityzoo.net/
  - Comprehensive catalog of complexity classes including P, NP, and the
    polynomial hierarchy.

### Practice Platforms

- **LeetCode:** https://leetcode.com/
  - Problems tagged "Two Pointers," "Sorting," "Matrix" for polynomial time practice.
  - Key problems: #1 Two Sum, #15 3Sum, #53 Maximum Subarray, #215 Kth Largest.

- **Codeforces:** https://codeforces.com/
  - Competitive programming problems with strict time limits that require
    understanding polynomial time boundaries.

---

## Complexity Zoo

### Relevant Complexity Classes

| Class     | Definition                                           |
|-----------|------------------------------------------------------|
| P         | Decidable in polynomial time                         |
| NP        | Verifiable in polynomial time                        |
| coNP      | Complement of NP                                     |
| BPP       | Bounded-error probabilistic polynomial time          |
| ZPP       | Zero-error probabilistic polynomial time             |
| RP        | Randomized polynomial time (one-sided error)         |
| NC        | Efficiently parallelizable (polylog depth circuits)  |
| PSPACE    | Decidable in polynomial space                        |

### Known Relationships

```
NC  subset  P  subset  NP  subset  PSPACE  subset  EXPTIME
                  |
               subset
                  |
                coNP  subset  PSPACE
```

Whether any of these containments are strict (except NC subset PSPACE and
P subset EXPTIME) is unknown.
