# Linear Time O(n) — Specification

## Table of Contents

1. [Formal Definition](#formal-definition)
2. [Mathematical Properties](#mathematical-properties)
3. [Standard Linear-Time Operations by Data Structure](#standard-linear-time-operations)
   - [Arrays / Slices](#arrays-slices)
   - [Linked Lists](#linked-lists)
   - [Hash Tables](#hash-tables)
   - [Strings](#strings)
   - [Stacks and Queues](#stacks-and-queues)
4. [Standard Library Operations — Go](#standard-library-go)
5. [Standard Library Operations — Java](#standard-library-java)
6. [Standard Library Operations — Python](#standard-library-python)
7. [Language Comparison Table](#language-comparison-table)
8. [Linear-Time Sorting Algorithms](#linear-time-sorting-algorithms)
9. [Linear-Time Selection Algorithms](#linear-time-selection-algorithms)
10. [Amortized Linear Time](#amortized-linear-time)
11. [Space Complexity Pairings](#space-complexity-pairings)
12. [Formal Proofs Reference](#formal-proofs-reference)
13. [References](#references)

---

## Formal Definition

**Definition (Big-O):** A function f(n) is O(n) if there exist positive constants c and n_0 such that:

```
f(n) <= c * n    for all n >= n_0
```

**Definition (Big-Theta):** A function f(n) is Theta(n) if there exist positive constants c_1, c_2, and n_0 such that:

```
c_1 * n <= f(n) <= c_2 * n    for all n >= n_0
```

**Definition (Big-Omega):** A function f(n) is Omega(n) if there exist positive constants c and n_0 such that:

```
f(n) >= c * n    for all n >= n_0
```

**Characterization:** An algorithm is linear-time if and only if it performs at most a constant amount of work per input element, with total work bounded by c * n for some constant c.

---

## Mathematical Properties

| Property | Statement |
|----------|-----------|
| Constant factor | O(c * n) = O(n) for any constant c > 0 |
| Addition | O(n) + O(n) = O(n) |
| Scalar multiplication | c * O(n) = O(n) |
| Composition | If f is O(n) and g is O(1), then f(g(x)) is O(n) |
| Sum rule | O(n) + O(m) = O(n + m) |
| Product rule | O(n) * O(1) = O(n) |
| Transitivity | If f = O(n) and n = O(h), then f = O(h) |
| Limit definition | If lim(n->inf) f(n)/n = c (finite, nonzero), then f = Theta(n) |

**Functions that are O(n):**
- 5n + 3
- n - 100
- 0.001n
- n + sqrt(n)
- n + log(n)

**Functions that are NOT O(n):**
- n * log(n)
- n^1.001
- n^2
- 2^n

---

## Standard Linear-Time Operations

### Arrays / Slices

| Operation | Time | Notes |
|-----------|------|-------|
| Traverse all elements | O(n) | Single loop |
| Copy array | O(n) | Element-by-element |
| Fill with value | O(n) | Assign to each position |
| Find element (unsorted) | O(n) | Linear search |
| Find max / min | O(n) | Single pass |
| Compute sum / product | O(n) | Accumulator pattern |
| Reverse | O(n) | Two-pointer swap |
| Prefix sum computation | O(n) | Running total |
| Filter elements | O(n) | One pass + output |
| Map / transform | O(n) | Apply function to each |
| Merge two sorted arrays | O(n + m) | Two-pointer merge |
| Counting sort | O(n + k) | k = value range |
| Partition (Dutch flag) | O(n) | Three-way partition |

### Linked Lists

| Operation | Time | Notes |
|-----------|------|-------|
| Traverse | O(n) | Follow next pointers |
| Find element | O(n) | Sequential scan |
| Find length | O(n) | Count nodes |
| Reverse | O(n) | Pointer reversal |
| Detect cycle (Floyd's) | O(n) | Fast/slow pointers |
| Find middle node | O(n) | Fast/slow pointers |
| Merge two sorted lists | O(n + m) | Pointer manipulation |
| Copy list | O(n) | Create new nodes |

### Hash Tables

| Operation | Amortized | Worst Case | Notes |
|-----------|-----------|------------|-------|
| Build from n elements | O(n) | O(n^2) | Amortized O(1) per insert |
| Iterate all entries | O(n) | O(n) | Visit each bucket |
| Copy | O(n) | O(n) | Clone all entries |
| Check equality of two | O(n) | O(n) | Compare all key-value pairs |

### Strings

| Operation | Time | Notes |
|-----------|------|-------|
| Length computation | O(1) or O(n) | Language-dependent |
| Concatenation (n chars) | O(n) | Copy characters |
| Substring search (naive) | O(n * m) | Not linear; use KMP for O(n + m) |
| KMP pattern matching | O(n + m) | Linear with preprocessing |
| Rabin-Karp matching | O(n + m) avg | Rolling hash |
| Character frequency count | O(n) | Single pass with array |
| Reverse string | O(n) | Character swap |
| Anagram check | O(n) | Frequency counting |

### Stacks and Queues

| Operation | Time | Notes |
|-----------|------|-------|
| Process n elements | O(n) | Each push/pop is O(1) |
| Monotonic stack construction | O(n) | Each element pushed/popped once |
| BFS (adjacency list) | O(V + E) | Linear in graph size |

---

## Standard Library — Go

| Function / Method | Package | Time | Input |
|-------------------|---------|------|-------|
| `copy(dst, src)` | builtin | O(n) | slices |
| `append(slice, elems...)` | builtin | O(n) amortized | slice + elements |
| `len(slice)` | builtin | O(1) | slice header |
| `for range slice` | language | O(n) | iteration |
| `strings.Contains(s, sub)` | strings | O(n) | string search |
| `strings.Count(s, sub)` | strings | O(n) | substring counting |
| `strings.Replace(s, old, new, -1)` | strings | O(n) | string replacement |
| `strings.Join(parts, sep)` | strings | O(n) | concatenation |
| `bytes.Equal(a, b)` | bytes | O(n) | byte comparison |
| `sort.Ints(arr)` | sort | O(n log n) | NOT linear |
| `slices.Contains(s, v)` | slices | O(n) | linear search |

---

## Standard Library — Java

| Method | Class | Time | Notes |
|--------|-------|------|-------|
| `Arrays.copyOf(arr, n)` | Arrays | O(n) | array copy |
| `Arrays.fill(arr, val)` | Arrays | O(n) | fill array |
| `Arrays.equals(a, b)` | Arrays | O(n) | element-wise comparison |
| `System.arraycopy(src, 0, dst, 0, n)` | System | O(n) | native copy |
| `ArrayList.addAll(collection)` | ArrayList | O(n) | bulk add |
| `ArrayList.contains(obj)` | ArrayList | O(n) | linear search |
| `ArrayList.indexOf(obj)` | ArrayList | O(n) | linear search |
| `Collections.reverse(list)` | Collections | O(n) | in-place reverse |
| `Collections.frequency(coll, obj)` | Collections | O(n) | count occurrences |
| `String.toCharArray()` | String | O(n) | copy to array |
| `String.contains(sub)` | String | O(n*m) worst | naive search |
| `StringBuilder.toString()` | StringBuilder | O(n) | build string |
| `HashMap.putAll(map)` | HashMap | O(n) | bulk insert |
| `HashMap.values()` iteration | HashMap | O(n) | traverse entries |

---

## Standard Library — Python

| Function / Method | Module | Time | Notes |
|-------------------|--------|------|-------|
| `list(iterable)` | builtin | O(n) | copy/convert to list |
| `list.copy()` | builtin | O(n) | shallow copy |
| `list.extend(iterable)` | builtin | O(k) | append k elements |
| `list.reverse()` | builtin | O(n) | in-place reverse |
| `list.count(x)` | builtin | O(n) | count occurrences |
| `x in list` | builtin | O(n) | linear search |
| `list.index(x)` | builtin | O(n) | find first index |
| `sum(iterable)` | builtin | O(n) | sum all elements |
| `min(iterable)` | builtin | O(n) | find minimum |
| `max(iterable)` | builtin | O(n) | find maximum |
| `any(iterable)` | builtin | O(n) | short-circuit OR |
| `all(iterable)` | builtin | O(n) | short-circuit AND |
| `len(list)` | builtin | O(1) | stored attribute |
| `enumerate(iterable)` | builtin | O(n) | lazy iteration |
| `zip(iter1, iter2)` | builtin | O(n) | lazy parallel iteration |
| `map(func, iterable)` | builtin | O(n) | lazy transformation |
| `filter(func, iterable)` | builtin | O(n) | lazy filtering |
| `"".join(iterable)` | str | O(n) | string concatenation |
| `str.count(sub)` | str | O(n) | substring counting |
| `str.replace(old, new)` | str | O(n) | string replacement |
| `set(iterable)` | builtin | O(n) | build hash set |
| `dict.update(other)` | builtin | O(n) | merge dictionaries |
| `collections.Counter(iterable)` | collections | O(n) | frequency counting |

---

## Language Comparison Table

| Operation | Go | Java | Python |
|-----------|-----|------|--------|
| Array copy | `copy(dst, src)` O(n) | `Arrays.copyOf` O(n) | `list.copy()` O(n) |
| Linear search | `for range` + compare | `indexOf` O(n) | `x in list` O(n) |
| Find max | Manual loop O(n) | `Collections.max` O(n) | `max()` O(n) |
| Sum | Manual loop O(n) | `IntStream.sum` O(n) | `sum()` O(n) |
| Reverse | Manual swap O(n) | `Collections.reverse` O(n) | `list.reverse()` O(n) |
| Join strings | `strings.Join` O(n) | `String.join` O(n) | `"".join()` O(n) |
| Build hash set | `map[T]bool` O(n) | `new HashSet<>` O(n) | `set()` O(n) |
| Frequency count | Manual `map` O(n) | Manual `HashMap` O(n) | `Counter()` O(n) |

---

## Linear-Time Sorting Algorithms

| Algorithm | Time | Space | Stable | Requirements |
|-----------|------|-------|--------|-------------|
| Counting Sort | O(n + k) | O(k) | Yes | Integer keys in [0, k] |
| Radix Sort (LSD) | O(d(n + k)) | O(n + k) | Yes | Fixed-width keys, d digits, base k |
| Radix Sort (MSD) | O(d(n + k)) | O(n + k) | Yes | Same as LSD |
| Bucket Sort | O(n) expected | O(n) | Yes | Uniform distribution in [0, 1) |
| Pigeonhole Sort | O(n + k) | O(k) | Yes | Integer keys, small range k |

**Note:** These achieve O(n) only under specific input constraints. General comparison-based sorting has a proven Omega(n log n) lower bound.

---

## Linear-Time Selection Algorithms

| Algorithm | Time (Worst) | Time (Avg) | Space | Notes |
|-----------|-------------|------------|-------|-------|
| Median of Medians (BFPRT) | O(n) | O(n) | O(log n) | Deterministic; groups of 5 |
| Quickselect | O(n^2) | O(n) | O(1) | Randomized; Hoare's partition |
| Introselect | O(n) | O(n) | O(log n) | Hybrid: quickselect + BFPRT fallback |

---

## Amortized Linear Time

Some operations are not O(n) for a single call but achieve O(n) total over n operations:

| Operation | Single Call | n Calls Total | Amortized per Call |
|-----------|------------|---------------|-------------------|
| Dynamic array append | O(1) amortized | O(n) total | O(1) |
| Hash table insert | O(1) amortized | O(n) total | O(1) |
| Splay tree access | O(n) worst | O(n log n) total | O(log n) |
| Union-Find (with rank + path compression) | O(alpha(n)) | O(n * alpha(n)) | ~O(1) |

---

## Space Complexity Pairings

Common space complexities paired with O(n) time algorithms:

| Time | Space | Example |
|------|-------|---------|
| O(n) | O(1) | Find max, Kadane's, Boyer-Moore voting |
| O(n) | O(k) | Counting sort (k = value range) |
| O(n) | O(n) | Hash-based two sum, counting with hash map |
| O(n) | O(log n) | Median of medians (recursive stack) |

---

## Formal Proofs Reference

### Lower bound: Finding minimum requires n-1 comparisons

**Theorem:** Any comparison-based algorithm that finds the minimum of n elements must make at least n - 1 comparisons.

**Proof:** Model the algorithm as a tournament. Each comparison eliminates at most one candidate. With n candidates, n - 1 eliminations are needed.

### Lower bound: Linear search on unsorted data is Omega(n)

**Theorem:** Any algorithm that determines whether a target exists in an unsorted array must examine Omega(n) elements in the worst case.

**Proof (adversary):** Until the algorithm has examined all n positions, the adversary can place the target in an unexamined position (or ensure it is absent if the algorithm has not found it).

### Lower bound: Comparison-based sorting is Omega(n log n)

**Theorem:** Any comparison-based sorting algorithm requires Omega(n log n) comparisons in the worst case.

**Proof:** Decision tree has n! leaves; height >= log2(n!) = Omega(n log n) by Stirling's approximation.

---

## References

- Cormen, T. H., Leiserson, C. E., Rivest, R. L., & Stein, C. (2009). *Introduction to Algorithms* (3rd ed.). MIT Press.
- Go Standard Library Documentation: https://pkg.go.dev/std
- Java SE API Documentation: https://docs.oracle.com/en/java/javase/17/docs/api/
- Python Standard Library Documentation: https://docs.python.org/3/library/
- Blum, M., Floyd, R. W., Pratt, V., Rivest, R. L., & Tarjan, R. E. (1973). "Time Bounds for Selection."
