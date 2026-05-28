# Big-Theta Notation -- Specification and References

## Table of Contents

1. [Formal Specification](#formal-specification)
2. [Historical Context](#historical-context)
3. [Canonical Definitions](#canonical-definitions)
4. [Relationship Between Notations](#relationship-between-notations)
5. [Standard Complexity Classes](#standard-complexity-classes)
6. [Theorems and Properties](#theorems-and-properties)
7. [Common Algorithm Theta Bounds](#common-algorithm-theta-bounds)
8. [Master Theorem Reference](#master-theorem-reference)
9. [Textbook References](#textbook-references)
10. [Online Resources](#online-resources)
11. [Related Topics](#related-topics)

---

## Formal Specification

### Definition (Big-Theta)

Let f : N -> R+ and g : N -> R+ be functions from natural numbers to positive
reals. We say:

```
f(n) = Theta(g(n))
```

if and only if there exist positive constants c1, c2, and n0 such that:

```
0 <= c1 * g(n) <= f(n) <= c2 * g(n)    for all n >= n0
```

Equivalently, Theta(g(n)) denotes the set of functions:

```
Theta(g(n)) = { f(n) : there exist c1 > 0, c2 > 0, n0 > 0 such that
                0 <= c1 * g(n) <= f(n) <= c2 * g(n) for all n >= n0 }
```

### Equivalent Formulation via O and Omega

```
f(n) = Theta(g(n))  <=>  f(n) = O(g(n)) AND f(n) = Omega(g(n))
```

### Limit Formulation

If the limit exists:

```
f(n) = Theta(g(n))  <=>  0 < lim_{n->inf} f(n)/g(n) < infinity
```

---

## Historical Context

- **Paul Bachmann (1894)**: Introduced O-notation in "Die Analytische Zahlentheorie."
- **Edmund Landau (1909)**: Popularized O-notation; it became known as Landau notation.
- **Donald Knuth (1976)**: Proposed the use of Theta-notation in his letter
  "Big Omicron and Big Omega and Big Theta" published in SIGACT News. Knuth
  argued that the common use of O when Theta was meant led to confusion, and
  that the community needed a notation for tight bounds.
- **Cormen, Leiserson, Rivest, Stein (CLRS)**: The "Introduction to Algorithms"
  textbook formalized and popularized the use of all three notations (O, Omega,
  Theta) as standard in computer science education.

### Knuth's Original Motivation

Knuth observed that many authors wrote "the running time is O(n log n)" when
they actually meant "the running time is Theta(n log n)." He proposed Theta
specifically to distinguish between upper bounds and tight bounds, writing:

> "For all the applications I have seen so far in computer science, a stronger
> requirement [...] is much more appropriate."

---

## Canonical Definitions

### Big-O (Upper Bound)

```
f(n) = O(g(n))  <=>  there exist c > 0, n0 > 0 such that
                      f(n) <= c * g(n) for all n >= n0
```

### Big-Omega (Lower Bound)

```
f(n) = Omega(g(n))  <=>  there exist c > 0, n0 > 0 such that
                          f(n) >= c * g(n) for all n >= n0
```

### Big-Theta (Tight Bound)

```
f(n) = Theta(g(n))  <=>  f(n) = O(g(n)) AND f(n) = Omega(g(n))
```

### Little-o (Strict Upper Bound)

```
f(n) = o(g(n))  <=>  lim_{n->inf} f(n)/g(n) = 0
```

### Little-omega (Strict Lower Bound)

```
f(n) = omega(g(n))  <=>  lim_{n->inf} f(n)/g(n) = infinity
```

---

## Relationship Between Notations

```
f(n) = Theta(g(n))  =>  f(n) = O(g(n))       (Theta implies O)
f(n) = Theta(g(n))  =>  f(n) = Omega(g(n))   (Theta implies Omega)
f(n) = o(g(n))      =>  f(n) = O(g(n))       (little-o implies O)
f(n) = o(g(n))      =>  f(n) != Theta(g(n))  (little-o excludes Theta)
```

### Analogy to Real Number Comparisons

| Notation      | Number Analogy | Meaning            |
|---------------|----------------|--------------------|
| f = O(g)      | a <= b         | f is at most g     |
| f = Omega(g)  | a >= b         | f is at least g    |
| f = Theta(g)  | a = b          | f equals g (rate)  |
| f = o(g)      | a < b          | f is strictly less |
| f = omega(g)  | a > b          | f is strictly more |

---

## Standard Complexity Classes

### Ordered by Growth Rate

| Class           | Name                | Example Algorithm               |
|-----------------|---------------------|---------------------------------|
| Theta(1)        | Constant            | Array index access              |
| Theta(log n)    | Logarithmic         | Binary search (worst)           |
| Theta(sqrt(n))  | Square root         | Trial division primality        |
| Theta(n)        | Linear              | Linear search (worst)           |
| Theta(n log n)  | Linearithmic        | Merge sort (all cases)          |
| Theta(n^2)      | Quadratic           | Selection sort (all cases)      |
| Theta(n^3)      | Cubic               | Naive matrix multiplication     |
| Theta(2^n)      | Exponential         | Subset enumeration              |
| Theta(n!)       | Factorial           | Permutation enumeration         |

### Growth Rate Comparison

For n = 1,000,000:

| Theta Class     | Operations             | If 1 op = 1 ns           |
|-----------------|------------------------|---------------------------|
| Theta(1)        | 1                      | 1 nanosecond              |
| Theta(log n)    | ~20                    | 20 nanoseconds            |
| Theta(n)        | 1,000,000              | 1 millisecond             |
| Theta(n log n)  | ~20,000,000            | 20 milliseconds           |
| Theta(n^2)      | 1,000,000,000,000      | ~17 minutes               |
| Theta(n^3)      | 10^18                  | ~31.7 years               |
| Theta(2^n)      | 10^301030              | Longer than the universe  |

---

## Theorems and Properties

### Theorem 1: Equivalence

f(n) = Theta(g(n)) if and only if f(n) = O(g(n)) and f(n) = Omega(g(n)).

### Theorem 2: Reflexivity

f(n) = Theta(f(n)) for any asymptotically nonnegative function f.

### Theorem 3: Symmetry

f(n) = Theta(g(n)) if and only if g(n) = Theta(f(n)).

### Theorem 4: Transitivity

If f(n) = Theta(g(n)) and g(n) = Theta(h(n)), then f(n) = Theta(h(n)).

### Theorem 5: Transpose Symmetry

f(n) = O(g(n)) if and only if g(n) = Omega(f(n)).

### Theorem 6: Polynomial Rule

For p(n) = sum_{i=0}^{k} a_i * n^i where a_k > 0:
p(n) = Theta(n^k).

### Theorem 7: Limit Rule

If lim_{n->inf} f(n)/g(n) = L:
- L = 0 implies f(n) = o(g(n)) [not Theta]
- 0 < L < infinity implies f(n) = Theta(g(n))
- L = infinity implies f(n) = omega(g(n)) [not Theta]

### Theorem 8: Sum Rule

If f1 = Theta(g1) and f2 = Theta(g2), then:
f1 + f2 = Theta(max(g1, g2)).

### Theorem 9: Product Rule

If f1 = Theta(g1) and f2 = Theta(g2), then:
f1 * f2 = Theta(g1 * g2).

### Theorem 10: Logarithm Equivalence

For any constants a, b > 1:
log_a(n) = Theta(log_b(n)).

All logarithmic bases are equivalent in Theta notation.

---

## Common Algorithm Theta Bounds

### Sorting Algorithms

| Algorithm       | Best Case        | Average Case     | Worst Case       | Space     |
|-----------------|------------------|------------------|------------------|-----------|
| Merge Sort      | Theta(n log n)   | Theta(n log n)   | Theta(n log n)   | Theta(n)  |
| Heap Sort       | Theta(n log n)   | Theta(n log n)   | Theta(n log n)   | Theta(1)  |
| Quick Sort      | Theta(n log n)   | Theta(n log n)   | Theta(n^2)       | Theta(log n)|
| Insertion Sort  | Theta(n)         | Theta(n^2)       | Theta(n^2)       | Theta(1)  |
| Selection Sort  | Theta(n^2)       | Theta(n^2)       | Theta(n^2)       | Theta(1)  |
| Bubble Sort     | Theta(n)         | Theta(n^2)       | Theta(n^2)       | Theta(1)  |
| Counting Sort   | Theta(n + k)     | Theta(n + k)     | Theta(n + k)     | Theta(k)  |
| Radix Sort      | Theta(d*(n+k))   | Theta(d*(n+k))   | Theta(d*(n+k))   | Theta(n+k)|

### Search Algorithms

| Algorithm       | Best Case    | Average Case   | Worst Case     |
|-----------------|--------------|----------------|----------------|
| Linear Search   | Theta(1)     | Theta(n)       | Theta(n)       |
| Binary Search   | Theta(1)     | Theta(log n)   | Theta(log n)   |
| Hash Lookup     | Theta(1)     | Theta(1)       | Theta(n)       |
| BST Search      | Theta(1)     | Theta(log n)   | Theta(n)       |

### Graph Algorithms

| Algorithm       | Time Complexity         | Space            |
|-----------------|-------------------------|------------------|
| BFS             | Theta(V + E)            | Theta(V)         |
| DFS             | Theta(V + E)            | Theta(V)         |
| Dijkstra        | Theta((V + E) log V)    | Theta(V)         |
| Floyd-Warshall  | Theta(V^3)              | Theta(V^2)       |
| Kruskal         | Theta(E log E)          | Theta(V)         |
| Prim            | Theta(E log V)          | Theta(V)         |

### Data Structure Operations

| Structure       | Insert          | Search          | Delete          |
|-----------------|-----------------|-----------------|-----------------|
| Array           | Theta(n)        | Theta(n)        | Theta(n)        |
| Sorted Array    | Theta(n)        | Theta(log n)    | Theta(n)        |
| Linked List     | Theta(1)        | Theta(n)        | Theta(n)        |
| Hash Table      | Theta(1) avg    | Theta(1) avg    | Theta(1) avg    |
| BST (balanced)  | Theta(log n)    | Theta(log n)    | Theta(log n)    |
| Heap            | Theta(log n)    | Theta(n)        | Theta(log n)    |

---

## Master Theorem Reference

For recurrences of the form T(n) = aT(n/b) + f(n) where a >= 1, b > 1:

Let c_crit = log_b(a).

**Case 1**: If f(n) = O(n^(c_crit - epsilon)) for some epsilon > 0:
```
T(n) = Theta(n^c_crit)
```

**Case 2**: If f(n) = Theta(n^c_crit * log^k(n)) for some k >= 0:
```
T(n) = Theta(n^c_crit * log^(k+1)(n))
```

**Case 3**: If f(n) = Omega(n^(c_crit + epsilon)) for some epsilon > 0, and
a * f(n/b) <= delta * f(n) for some delta < 1 and sufficiently large n:
```
T(n) = Theta(f(n))
```

---

## Textbook References

### Primary Sources

1. **Cormen, T.H., Leiserson, C.E., Rivest, R.L., Stein, C.**
   *Introduction to Algorithms* (4th Edition), MIT Press, 2022.
   - Chapter 3: "Growth of Functions" -- definitive treatment of O, Omega, Theta.
   - Sections 3.1 and 3.2 for formal definitions and examples.

2. **Knuth, D.E.**
   "Big Omicron and Big Omega and Big Theta."
   *SIGACT News*, 8(2):18-24, 1976.
   - The seminal paper proposing Theta notation.

3. **Knuth, D.E.**
   *The Art of Computer Programming, Volume 1: Fundamental Algorithms*
   (3rd Edition), Addison-Wesley, 1997.
   - Section 1.2.11.1: "The O-notation" -- historical development.

4. **Sedgewick, R. and Wayne, K.**
   *Algorithms* (4th Edition), Addison-Wesley, 2011.
   - Chapter 1.4: "Analysis of Algorithms" -- practical approach.

5. **Skiena, S.S.**
   *The Algorithm Design Manual* (3rd Edition), Springer, 2020.
   - Chapter 2: "Algorithm Analysis" -- accessible treatment.

### Secondary Sources

6. **Sipser, M.**
   *Introduction to the Theory of Computation* (3rd Edition), Cengage, 2012.
   - Chapter 7: "Time Complexity" -- formal treatment in TCS context.

7. **Dasgupta, S., Papadimitriou, C., Vazirani, U.**
   *Algorithms*, McGraw-Hill, 2006.
   - Chapter 0.3: "Big-O notation" -- concise and clear.

8. **Aho, A.V., Hopcroft, J.E., Ullman, J.D.**
   *The Design and Analysis of Computer Algorithms*, Addison-Wesley, 1974.
   - Classic textbook that helped establish notation standards.

9. **Levitin, A.**
   *Introduction to the Design and Analysis of Algorithms*
   (3rd Edition), Pearson, 2011.
   - Chapter 2: "Fundamentals of the Analysis of Algorithm Efficiency."

10. **Goodrich, M.T. and Tamassia, R.**
    *Data Structures and Algorithms in Java* (6th Edition), Wiley, 2014.
    - Chapter 4: "Algorithm Analysis" -- Java-oriented examples.

---

## Online Resources

### Courses and Lectures

- **MIT OCW 6.006**: Introduction to Algorithms
  https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/
  Lecture 1 covers asymptotic notation including Theta.

- **Stanford CS161**: Design and Analysis of Algorithms
  https://web.stanford.edu/class/cs161/
  Covers asymptotic analysis with proofs.

### Interactive Tools

- **Big-O Cheat Sheet**: https://www.bigocheatsheet.com/
  Visual reference for common algorithm complexities.

- **VisuAlgo**: https://visualgo.net/
  Animated visualizations of algorithms with complexity analysis.

### Documentation

- **Wikipedia: Big O notation**
  https://en.wikipedia.org/wiki/Big_O_notation
  Comprehensive overview including formal definitions.

- **Wikipedia: Master theorem**
  https://en.wikipedia.org/wiki/Master_theorem_(analysis_of_algorithms)
  Reference for recurrence solving.

---

## Related Topics

### Prerequisite Knowledge

- Big-O Notation (upper bounds)
- Big-Omega Notation (lower bounds)
- Mathematical induction
- Limits and L'Hopital's rule
- Recurrence relations

### Next Topics

- Amortized analysis
- Average-case analysis
- Probabilistic analysis
- Space complexity analysis
- NP-completeness theory

### Cross-References in This Roadmap

- `01-big-o-notation/` -- Big-O (upper bound) -- prerequisite
- `03-big-omega-notation/` -- Big-Omega (lower bound) -- closely related
- `../05-common-complexities/` -- Standard complexity classes
- `../06-recurrence-relations/` -- Solving recurrences for Theta bounds
- `../../05-basic-data-structures/` -- Data structure operation complexities

---

*This specification serves as a comprehensive reference for Big-Theta notation.*
