# Time vs Space Complexity — Specification

> **Official Documentation Reference**
>
> Source: Language standard libraries and algorithm analysis references

---

## Table of Contents

1. Docs Reference
2. API / Configuration Reference
3. Core Concepts & Rules
4. Schema / Parameters Reference
5. Behavioral Specification
6. Edge Cases from Official Docs
7. Version & Compatibility Matrix
8. Official Examples
9. Compliance & Best Practices Checklist
10. Related Documentation

---

## 1. Docs Reference

| Property | Value |
|----------|-------|
| **Go — testing/benchmark** | [testing package](https://pkg.go.dev/testing#hdr-Benchmarks) |
| **Java — JMH** | [OpenJDK JMH](https://openjdk.org/projects/code-tools/jmh/) |
| **Python — timeit** | [timeit module](https://docs.python.org/3/library/timeit.html) |
| **Python — sys** | [sys.getsizeof](https://docs.python.org/3/library/sys.html#sys.getsizeof) |
| **CLRS Reference** | *Introduction to Algorithms*, 4th Edition — Chapters 2-4 |

---

## 2. API / Configuration Reference

### Go: `testing.B` (Benchmark)

| Method | Description |
|--------|-------------|
| `b.N` | Number of iterations the benchmark should run |
| `b.ResetTimer()` | Reset the timer after setup |
| `b.ReportAllocs()` | Report memory allocations |
| `b.StartTimer()` / `b.StopTimer()` | Manual timer control |

```go
func BenchmarkMyAlgo(b *testing.B) {
    data := setup()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        myAlgo(data)
    }
}
// Run: go test -bench=. -benchmem
```

### Java: JMH Annotations

| Annotation | Description |
|-----------|-------------|
| `@Benchmark` | Marks a method as a benchmark |
| `@BenchmarkMode(Mode.AverageTime)` | Measures average execution time |
| `@OutputTimeUnit(TimeUnit.NANOSECONDS)` | Output time unit |
| `@State(Scope.Thread)` | State object lifecycle |
| `@Warmup(iterations = 5)` | Warmup iterations before measuring |

```java
@Benchmark
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
public void benchmarkMyAlgo(MyState state) {
    myAlgo(state.data);
}
```

### Python: `timeit` Module

| Function | Description |
|----------|-------------|
| `timeit.timeit(stmt, number=1000000)` | Time execution of statement |
| `timeit.repeat(stmt, repeat=5, number=1000000)` | Repeat timing for reliability |
| `timeit.default_timer()` | High-resolution timer |

```python
import timeit
t = timeit.timeit(lambda: my_algo(data), number=1000)
print(f"{t/1000*1000:.3f} ms per call")
```

### Python: `sys.getsizeof()`

| Function | Description |
|----------|-------------|
| `sys.getsizeof(obj)` | Returns size of object in bytes (shallow) |
| `tracemalloc.start()` | Start tracing memory allocations |
| `tracemalloc.get_traced_memory()` | Get current and peak memory usage |

```python
import sys
import tracemalloc

tracemalloc.start()
data = list(range(100000))
current, peak = tracemalloc.get_traced_memory()
print(f"Current: {current/1024:.1f} KB, Peak: {peak/1024:.1f} KB")
tracemalloc.stop()
```

---

## 3. Core Concepts & Rules

### Rule 1: Big-O Describes Growth Rate, Not Actual Time

> *CLRS Chapter 3: "Asymptotic notation characterizes functions according to how fast they grow."*

Big-O notation drops constants and lower-order terms. O(2n) = O(n). O(n² + n) = O(n²). This means Big-O is useful for comparing algorithms at large n, but for small n, actual measured time may differ from Big-O predictions.

```python
# O(n) with large constant can be slower than O(n²) for small n
def algo_a(arr):  # O(n) with constant factor 1000
    for _ in range(1000):
        for x in arr: pass

def algo_b(arr):  # O(n²) but small constant
    for i in range(len(arr)):
        for j in range(i+1, len(arr)): pass

# For n < 1000, algo_b may be faster despite worse Big-O
```

### Rule 2: Space Complexity Includes Stack Space

> *CLRS: "We shall generally regard a recursive algorithm that uses space s(n) in addition to the space for the recursion stack as using space s(n)."*

Note: Some references count stack space separately. The convention used here counts **all** memory used, including the call stack. Always clarify which convention you're using.

```go
// O(n) space due to recursion, even though no explicit allocation
func dfs(node *Node) {
    if node == nil { return }
    dfs(node.Left)
    dfs(node.Right)
}
```

### Rule 3: Amortized ≠ Average Case

> *CLRS Chapter 17: "Amortized analysis guarantees the average performance of each operation in the worst case."*

Amortized analysis guarantees the total cost over a sequence of operations in the **worst case**. Average-case analysis assumes a probability distribution over inputs. They are different concepts:

| Analysis | Over what? | Guarantees |
|----------|-----------|------------|
| Worst-case | Single worst input | Every input |
| Average-case | Random inputs | Expected behavior |
| Amortized | Sequence of operations | Worst-case total |

---

## 4. Schema / Parameters Reference

### Complexity Classes Reference

| Class | Growth | Example Operations | Typical Algorithms |
|-------|--------|-------------------|-------------------|
| O(1) | Constant | Array index, hash lookup | Direct access |
| O(log n) | Logarithmic | Halving search space | Binary search |
| O(n) | Linear | Single scan | Linear search, counting |
| O(n log n) | Linearithmic | Divide + merge | Merge sort, heap sort |
| O(n²) | Quadratic | Nested iteration | Bubble sort, selection sort |
| O(n³) | Cubic | Triple nesting | Matrix multiply, Floyd-Warshall |
| O(2ⁿ) | Exponential | All subsets | Subset enumeration |
| O(n!) | Factorial | All permutations | Brute-force TSP |

### Maximum Feasible Input Size (per 1 second)

| Complexity | Max n (approximate) |
|-----------|-------------------|
| O(n!) | 11-12 |
| O(2ⁿ) | 20-25 |
| O(n³) | 500 |
| O(n²) | 5,000-10,000 |
| O(n log n) | 1,000,000 |
| O(n) | 10,000,000-100,000,000 |
| O(log n) | Virtually unlimited |
| O(1) | Unlimited |

---

## 5. Behavioral Specification

### Normal Operation

Time and space complexity describe the **asymptotic** behavior of algorithms. For a correct complexity analysis:

1. Identify the input size parameter(s): n, V+E, n×m, etc.
2. Count basic operations (comparisons, assignments, arithmetic)
3. Express count as a function of input size
4. Drop constants and lower-order terms
5. Express in Big-O (upper bound), Big-Θ (tight bound), or Big-Ω (lower bound)

### Documented Limitations

| Limitation | Details | Workaround |
|------------|---------|------------|
| Big-O hides constants | O(n) with constant 10⁶ is slow | Profile with actual benchmarks |
| Assumes uniform cost model | Cache misses, branch prediction not modeled | Use cache-oblivious analysis for I/O |
| Ignores hardware effects | SIMD, parallelism, pipelining not captured | Benchmark on target hardware |
| Worst-case may be rare | Quicksort O(n²) worst case almost never occurs | Use randomized analysis |

### Error / Failure Conditions

| Error | Condition | Official Resolution |
|-------|-----------|---------------------|
| Stack overflow | Recursion depth > stack limit | Convert to iterative or increase stack |
| Out of memory | Space complexity exceeds available RAM | Use streaming/external memory algorithms |
| Timeout (TLE) | Time complexity too high for input size | Choose algorithm with lower complexity class |
| Integer overflow | Intermediate calculations exceed type range | Use larger types or safe arithmetic |

---

## 6. Edge Cases from Official Docs

| Edge Case | Official Behavior | Reference |
|-----------|-------------------|-----------|
| Empty input (n=0) | Most algorithms should handle gracefully — O(1) work | CLRS convention |
| n=1 | Single element — many algorithms are trivially O(1) | All sorting algorithms |
| Already sorted input | Best case for insertion sort O(n), worst for naive quicksort O(n²) | CLRS Ch. 7 |
| All identical elements | Affects duplicate detection, sorting stability | Language sort guarantees |
| Very large n (>10⁹) | O(n) may be too slow; need O(√n) or O(log n) | Competitive programming guides |
| Negative numbers | May affect hash functions, modular arithmetic | Language-specific hash behavior |

---

## 7. Version & Compatibility Matrix

### Go

| Version | Change | Notes |
|---------|--------|-------|
| Go 1.18+ | Generics | Generic data structures possible; no performance difference |
| Go 1.21+ | `slices` package | `slices.Sort()` — pattern-defeating quicksort, O(n log n) guaranteed |

### Java

| Version | Change | Notes |
|---------|--------|-------|
| Java 8 | HashMap tree bins | Worst-case per-bucket: O(n) → O(log n) when > 8 entries |
| Java 11 | `Arrays.sort()` improved | Dual-pivot quicksort for primitives; TimSort for objects |
| Java 17+ | Records, sealed classes | No performance impact on algorithms |

### Python

| Version | Change | Notes |
|---------|--------|-------|
| Python 3.7+ | dict preserves insertion order | Guaranteed by spec (was implementation detail in 3.6) |
| Python 3.10+ | `match` statement | Pattern matching — no complexity impact |
| Python 3.11+ | CPython 10-60% faster | Adaptive interpreter; same Big-O, better constants |

---

## 8. Official Examples

### Example 1: Go Benchmark

> Source: [Go testing package](https://pkg.go.dev/testing)

```go
package main

import "testing"

func BenchmarkLinearSearch(b *testing.B) {
    arr := make([]int, 10000)
    for i := range arr { arr[i] = i }
    b.ResetTimer()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        linearSearch(arr, 9999)
    }
}

func linearSearch(arr []int, target int) int {
    for i, v := range arr {
        if v == target { return i }
    }
    return -1
}
```

**Run:** `go test -bench=BenchmarkLinearSearch -benchmem`

### Example 2: Python timeit

> Source: [Python timeit docs](https://docs.python.org/3/library/timeit.html)

```python
import timeit

def linear_search(arr, target):
    for i, v in enumerate(arr):
        if v == target:
            return i
    return -1

arr = list(range(10000))

# Measure time for 1000 runs
t = timeit.timeit(lambda: linear_search(arr, 9999), number=1000)
print(f"Average: {t/1000*1000:.3f} ms per call")
```

### Example 3: Python tracemalloc

> Source: [Python tracemalloc docs](https://docs.python.org/3/library/tracemalloc.html)

```python
import tracemalloc

tracemalloc.start()

# O(n) space allocation
data = [i ** 2 for i in range(100000)]

current, peak = tracemalloc.get_traced_memory()
print(f"Current: {current / 1024:.1f} KB")
print(f"Peak: {peak / 1024:.1f} KB")

tracemalloc.stop()
```

---

## 9. Compliance & Best Practices Checklist

- [ ] Algorithm complexity is documented in comments (time AND space)
- [ ] Worst-case, average-case, and amortized costs are distinguished
- [ ] Stack space from recursion is counted in space analysis
- [ ] Benchmarks use proper tools (Go: `testing.B`, Java: JMH, Python: `timeit`)
- [ ] Memory measurements use language-appropriate tools
- [ ] Edge cases (n=0, n=1, large n) are tested
- [ ] Trade-off decisions are documented with justification
- [ ] Constants and cache effects are considered for performance-critical code

---

## 10. Related Documentation

| Topic | Doc Section | URL |
|-------|-------------|-----|
| Big-O Notation | Asymptotic Notation | [CLRS Ch. 3](https://mitpress.mit.edu/9780262046305/) |
| Go Performance | testing/benchmark | [pkg.go.dev/testing](https://pkg.go.dev/testing) |
| Go Profiling | runtime/pprof | [pkg.go.dev/runtime/pprof](https://pkg.go.dev/runtime/pprof) |
| Java Collections Complexity | java.util package | [Java Collections Docs](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/package-summary.html) |
| Java JMH | Microbenchmarking | [OpenJDK JMH](https://openjdk.org/projects/code-tools/jmh/) |
| Python timeit | Timing module | [docs.python.org/3/library/timeit](https://docs.python.org/3/library/timeit.html) |
| Python tracemalloc | Memory tracing | [docs.python.org/3/library/tracemalloc](https://docs.python.org/3/library/tracemalloc.html) |
| Python sys.getsizeof | Object size | [docs.python.org/3/library/sys](https://docs.python.org/3/library/sys.html) |

---

> **Content Rules for `specification.md`:**
> - Always link directly to the relevant doc section (not just the homepage)
> - Use official examples from the documentation when available
> - Note breaking changes and deprecated features between versions
> - Include official security / safety recommendations
> - Minimum 2 Core Rules, 3 Parameters, 3 Edge Cases, 2 Official Examples
