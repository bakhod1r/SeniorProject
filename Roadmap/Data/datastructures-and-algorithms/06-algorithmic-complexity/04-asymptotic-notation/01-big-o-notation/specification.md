# Big-O Notation -- Specification and References

## Table of Contents

1. [Formal Specification](#formal-specification)
2. [Historical Background](#historical-background)
3. [Notation Summary](#notation-summary)
4. [Standard Complexity Classes](#standard-complexity-classes)
5. [Common Algorithm Complexities Reference](#common-algorithm-complexities-reference)
6. [Data Structure Operation Complexities](#data-structure-operation-complexities)
7. [Sorting Algorithm Complexities](#sorting-algorithm-complexities)
8. [Graph Algorithm Complexities](#graph-algorithm-complexities)
9. [Recurrence Relations Reference](#recurrence-relations-reference)
10. [Textbook References](#textbook-references)
11. [Online Resources](#online-resources)
12. [Academic Papers](#academic-papers)
13. [Related Topics](#related-topics)

---

## Formal Specification

### Big-O (Asymptotic Upper Bound)

```
f(n) = O(g(n)) iff exists c > 0, n0 > 0 such that:
    0 <= f(n) <= c * g(n)  for all n >= n0
```

### Big-Omega (Asymptotic Lower Bound)

```
f(n) = Omega(g(n)) iff exists c > 0, n0 > 0 such that:
    0 <= c * g(n) <= f(n)  for all n >= n0
```

### Big-Theta (Asymptotic Tight Bound)

```
f(n) = Theta(g(n)) iff exists c1 > 0, c2 > 0, n0 > 0 such that:
    0 <= c1 * g(n) <= f(n) <= c2 * g(n)  for all n >= n0
```

### Little-o (Strict Upper Bound)

```
f(n) = o(g(n)) iff for all c > 0, exists n0 > 0 such that:
    0 <= f(n) < c * g(n)  for all n >= n0

Equivalently: lim (n -> infinity) f(n) / g(n) = 0
```

### Little-omega (Strict Lower Bound)

```
f(n) = omega(g(n)) iff for all c > 0, exists n0 > 0 such that:
    0 <= c * g(n) < f(n)  for all n >= n0

Equivalently: lim (n -> infinity) f(n) / g(n) = infinity
```

---

## Historical Background

Big-O notation was introduced by the German mathematician **Paul Bachmann** in his 1894 book *Die Analytische Zahlentheorie* (Analytic Number Theory). It was further popularized by **Edmund Landau**, and the family of notations (O, Omega, Theta, o, omega) is sometimes called **Bachmann-Landau notation** or **Landau symbols**.

The notation was adopted into computer science through the work of **Donald Knuth**, who in his 1976 paper "Big Omicron and Big Omega and Big Theta" advocated for precise usage of all five asymptotic notations. Knuth's *The Art of Computer Programming* series established Big-O as the standard for algorithm analysis.

**Timeline:**
- 1894: Paul Bachmann introduces O notation
- 1909: Edmund Landau popularizes the notation in number theory
- 1965: Juris Hartmanis and Richard Stearns publish the Time Hierarchy Theorem
- 1968: Donald Knuth begins *The Art of Computer Programming*
- 1976: Knuth's paper formally defines O, Omega, and Theta for CS use
- 1990: Thomas Cormen, Charles Leiserson, Ronald Rivest publish *Introduction to Algorithms* (CLRS), cementing the notation in CS education

---

## Notation Summary

| Symbol      | Name          | Meaning                          | Analogy |
|-------------|---------------|----------------------------------|---------|
| O(g(n))     | Big-O         | Upper bound (at most)            | <=      |
| Omega(g(n)) | Big-Omega     | Lower bound (at least)           | >=      |
| Theta(g(n)) | Big-Theta     | Tight bound (exactly)            | ==      |
| o(g(n))     | Little-o      | Strict upper bound               | <       |
| omega(g(n)) | Little-omega  | Strict lower bound               | >       |

---

## Standard Complexity Classes

Listed from fastest to slowest growth:

| Class         | Name             | Example Algorithm                          |
|---------------|------------------|--------------------------------------------|
| O(1)          | Constant         | Array index access, hash table lookup      |
| O(log log n)  | Double logarithmic | Interpolation search (uniform data)      |
| O(log n)      | Logarithmic      | Binary search, balanced BST operations     |
| O(log^2 n)    | Polylogarithmic  | Some parallel algorithms                   |
| O(sqrt(n))    | Square root      | Trial division primality test              |
| O(n)          | Linear           | Linear search, single pass algorithms      |
| O(n log n)    | Linearithmic     | Merge sort, heap sort, FFT                 |
| O(n^2)        | Quadratic        | Bubble sort, insertion sort, naive matrix multiply |
| O(n^3)        | Cubic            | Floyd-Warshall, naive matrix multiply      |
| O(n^k)        | Polynomial       | General polynomial-time algorithms         |
| O(2^n)        | Exponential      | Subset enumeration, naive TSP              |
| O(n!)         | Factorial        | Permutation generation, brute-force TSP    |
| O(n^n)        | -                | Theoretical worst cases                    |

---

## Common Algorithm Complexities Reference

### Searching

| Algorithm          | Best Case | Average Case | Worst Case | Space   |
|--------------------|-----------|--------------|------------|---------|
| Linear Search      | O(1)      | O(n)         | O(n)       | O(1)    |
| Binary Search      | O(1)      | O(log n)     | O(log n)   | O(1)    |
| Hash Table Lookup  | O(1)      | O(1)         | O(n)       | O(n)    |
| BST Search         | O(1)      | O(log n)     | O(n)       | O(n)    |
| Balanced BST Search| O(1)      | O(log n)     | O(log n)   | O(n)    |

### String Matching

| Algorithm              | Preprocessing | Matching    | Space   |
|------------------------|---------------|-------------|---------|
| Naive                  | O(1)          | O(n * m)    | O(1)    |
| KMP                    | O(m)          | O(n)        | O(m)    |
| Rabin-Karp             | O(m)          | O(n) avg    | O(1)    |
| Boyer-Moore            | O(m + k)      | O(n/m) best | O(m + k)|

---

## Data Structure Operation Complexities

### Arrays and Lists

| Operation           | Array  | Dynamic Array (amortized) | Linked List | Skip List      |
|---------------------|--------|---------------------------|-------------|----------------|
| Access by index     | O(1)   | O(1)                      | O(n)        | O(n)           |
| Search              | O(n)   | O(n)                      | O(n)        | O(log n) avg   |
| Insert at beginning | O(n)   | O(n)                      | O(1)        | O(log n) avg   |
| Insert at end       | O(1)*  | O(1) amortized            | O(1)**      | O(log n) avg   |
| Delete              | O(n)   | O(n)                      | O(1)***     | O(log n) avg   |

\* If space available. \*\* With tail pointer. \*\*\* If node reference is given.

### Trees

| Operation    | BST (balanced) | BST (worst) | AVL Tree   | Red-Black Tree | B-Tree     |
|-------------|----------------|-------------|------------|----------------|------------|
| Search      | O(log n)       | O(n)        | O(log n)   | O(log n)       | O(log n)   |
| Insert      | O(log n)       | O(n)        | O(log n)   | O(log n)       | O(log n)   |
| Delete      | O(log n)       | O(n)        | O(log n)   | O(log n)       | O(log n)   |
| Min/Max     | O(log n)       | O(n)        | O(log n)   | O(log n)       | O(log n)   |

### Hash Tables

| Operation    | Average | Worst Case | Notes                               |
|-------------|---------|------------|--------------------------------------|
| Search      | O(1)    | O(n)       | Worst case with many collisions      |
| Insert      | O(1)    | O(n)       | Amortized O(1) with resizing         |
| Delete      | O(1)    | O(n)       | Worst case with many collisions      |

### Heaps

| Operation      | Binary Heap | Fibonacci Heap (amortized) |
|---------------|-------------|----------------------------|
| Find min/max  | O(1)        | O(1)                       |
| Insert        | O(log n)    | O(1)                       |
| Delete min/max| O(log n)    | O(log n)                   |
| Decrease key  | O(log n)    | O(1)                       |
| Merge         | O(n)        | O(1)                       |

---

## Sorting Algorithm Complexities

| Algorithm      | Best        | Average     | Worst       | Space    | Stable |
|----------------|-------------|-------------|-------------|----------|--------|
| Bubble Sort    | O(n)        | O(n^2)      | O(n^2)      | O(1)     | Yes    |
| Selection Sort | O(n^2)      | O(n^2)      | O(n^2)      | O(1)     | No     |
| Insertion Sort | O(n)        | O(n^2)      | O(n^2)      | O(1)     | Yes    |
| Merge Sort     | O(n log n)  | O(n log n)  | O(n log n)  | O(n)     | Yes    |
| Quick Sort     | O(n log n)  | O(n log n)  | O(n^2)      | O(log n) | No     |
| Heap Sort      | O(n log n)  | O(n log n)  | O(n log n)  | O(1)     | No     |
| Counting Sort  | O(n + k)    | O(n + k)    | O(n + k)    | O(k)     | Yes    |
| Radix Sort     | O(n * d)    | O(n * d)    | O(n * d)    | O(n + k) | Yes    |
| Bucket Sort    | O(n + k)    | O(n + k)    | O(n^2)      | O(n * k) | Yes    |
| Tim Sort       | O(n)        | O(n log n)  | O(n log n)  | O(n)     | Yes    |

---

## Graph Algorithm Complexities

| Algorithm                  | Time Complexity              | Space     | Notes                    |
|---------------------------|------------------------------|-----------|--------------------------|
| BFS                       | O(V + E)                     | O(V)      | Adjacency list           |
| DFS                       | O(V + E)                     | O(V)      | Adjacency list           |
| Dijkstra (binary heap)    | O((V + E) log V)             | O(V)      | Non-negative weights     |
| Dijkstra (Fibonacci heap) | O(V log V + E)               | O(V)      | Non-negative weights     |
| Bellman-Ford              | O(V * E)                     | O(V)      | Handles negative weights |
| Floyd-Warshall            | O(V^3)                       | O(V^2)    | All pairs shortest path  |
| Prim (binary heap)        | O((V + E) log V)             | O(V)      | MST                      |
| Kruskal                   | O(E log E)                   | O(V)      | MST with Union-Find      |
| Topological Sort          | O(V + E)                     | O(V)      | DAG only                 |
| Tarjan SCC                | O(V + E)                     | O(V)      | Strongly connected components |
| A* Search                 | O(E) to O(b^d)               | O(b^d)    | Depends on heuristic     |

---

## Recurrence Relations Reference

| Recurrence                  | Solution         | Example Algorithm      |
|-----------------------------|------------------|------------------------|
| T(n) = T(n-1) + O(1)       | O(n)             | Linear recursion       |
| T(n) = T(n-1) + O(n)       | O(n^2)           | Selection sort         |
| T(n) = T(n/2) + O(1)       | O(log n)         | Binary search          |
| T(n) = T(n/2) + O(n)       | O(n)             | Median of medians      |
| T(n) = 2T(n/2) + O(1)      | O(n)             | Tree traversal         |
| T(n) = 2T(n/2) + O(n)      | O(n log n)       | Merge sort             |
| T(n) = 2T(n/2) + O(n^2)    | O(n^2)           | -                      |
| T(n) = T(n-1) + T(n-2)     | O(2^n)           | Naive Fibonacci        |
| T(n) = 3T(n/3) + O(n)      | O(n log n)       | -                      |
| T(n) = 7T(n/2) + O(n^2)    | O(n^2.807)       | Strassen multiplication|
| T(n) = 3T(n/2) + O(n)      | O(n^1.585)       | Karatsuba multiplication|

---

## Textbook References

1. **Introduction to Algorithms (CLRS)** -- Thomas H. Cormen, Charles E. Leiserson, Ronald L. Rivest, Clifford Stein
   - Chapter 3: Growth of Functions (definitive treatment of asymptotic notation)
   - Chapter 4: Divide-and-Conquer (Master Theorem)
   - Chapter 17: Amortized Analysis
   - ISBN: 978-0262046305 (4th Edition, 2022)

2. **The Art of Computer Programming, Volume 1** -- Donald E. Knuth
   - Section 1.2.11: Asymptotic Representations
   - ISBN: 978-0201896831

3. **Algorithm Design Manual** -- Steven S. Skiena
   - Chapter 2: Algorithm Analysis
   - ISBN: 978-3030542559 (3rd Edition, 2020)

4. **Algorithms** -- Robert Sedgewick, Kevin Wayne
   - Chapter 1.4: Analysis of Algorithms
   - ISBN: 978-0321573513

5. **Concrete Mathematics** -- Ronald L. Graham, Donald E. Knuth, Oren Patashnik
   - Chapter 9: Asymptotic Analysis
   - ISBN: 978-0201558029

6. **Algorithms Illuminated** -- Tim Roughgarden
   - Part 1: The Basics (Big-O and algorithm analysis)
   - ISBN: 978-0999282908

---

## Online Resources

1. **Big-O Cheat Sheet** -- https://www.bigocheatsheet.com/
   Visual reference for common data structure and algorithm complexities.

2. **MIT OpenCourseWare 6.006** -- Introduction to Algorithms
   Lecture 1-3 cover asymptotic notation and algorithm analysis.
   https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/

3. **Khan Academy: Asymptotic Notation**
   Beginner-friendly explanations with interactive exercises.
   https://www.khanacademy.org/computing/computer-science/algorithms/asymptotic-notation/

4. **Visualgo** -- https://visualgo.net/
   Visual algorithm animations showing step-by-step operations.

5. **GeeksforGeeks: Analysis of Algorithms**
   https://www.geeksforgeeks.org/analysis-of-algorithms-set-1-asymptotic-analysis/

6. **Stanford CS161: Design and Analysis of Algorithms**
   Tim Roughgarden's course materials.
   https://web.stanford.edu/class/cs161/

---

## Academic Papers

1. **Bachmann, P.** (1894). *Die Analytische Zahlentheorie*. Leipzig: B.G. Teubner.
   - Original introduction of Big-O notation.

2. **Knuth, D.E.** (1976). "Big Omicron and Big Omega and Big Theta." *ACM SIGACT News*, 8(2), 18-24.
   - Formalized the use of O, Omega, and Theta in computer science.

3. **Hartmanis, J. and Stearns, R.E.** (1965). "On the Computational Complexity of Algorithms." *Transactions of the American Mathematical Society*, 117, 285-306.
   - Foundational paper on time complexity hierarchy.

4. **Tarjan, R.E.** (1985). "Amortized Computational Complexity." *SIAM Journal on Algebraic and Discrete Methods*, 6(2), 306-318.
   - Formal introduction of amortized analysis.

5. **Akra, M. and Bazzi, L.** (1998). "On the Solution of Linear Recurrence Equations." *Computational Optimization and Applications*, 10(2), 195-210.
   - Generalization of the Master Theorem (Akra-Bazzi method).

---

## Related Topics

- **06-algorithmic-complexity/01-time-complexity** -- Detailed time complexity analysis
- **06-algorithmic-complexity/02-space-complexity** -- Space complexity and memory analysis
- **06-algorithmic-complexity/03-analyzing-algorithms** -- Step-by-step algorithm analysis techniques
- **06-algorithmic-complexity/04-asymptotic-notation/02-big-omega-notation** -- Big-Omega lower bounds
- **06-algorithmic-complexity/04-asymptotic-notation/03-big-theta-notation** -- Big-Theta tight bounds
- **07-sorting-algorithms** -- Practical application of Big-O to sorting
- **08-searching-algorithms** -- Practical application of Big-O to searching
- **05-basic-data-structures** -- Data structure operation complexities
