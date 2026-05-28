# How to Calculate Complexity? -- Specification & References

## Table of Contents

1. [Formal Notation Definitions](#formal-notation-definitions)
2. [Asymptotic Notation Rules](#asymptotic-notation-rules)
3. [Master Theorem -- Formal Statement](#master-theorem-formal-statement)
4. [Akra-Bazzi Theorem -- Formal Statement](#akra-bazzi-theorem-formal-statement)
5. [Profiling Tool References](#profiling-tool-references)
   - [Go Profiling](#go-profiling)
   - [Java Profiling](#java-profiling)
   - [Python Profiling](#python-profiling)
6. [Benchmarking Tool References](#benchmarking-tool-references)
7. [Textbook References](#textbook-references)
8. [Standards and Conventions](#standards-and-conventions)

---

## Formal Notation Definitions

### Big-O (Upper Bound)

```
f(n) = O(g(n)) iff there exist positive constants c and n0 such that
0 <= f(n) <= c * g(n) for all n >= n0
```

Interpretation: f grows **no faster than** g, up to a constant factor.

Source: CLRS (Cormen, Leiserson, Rivest, Stein), Chapter 3.1

### Big-Omega (Lower Bound)

```
f(n) = Omega(g(n)) iff there exist positive constants c and n0 such that
0 <= c * g(n) <= f(n) for all n >= n0
```

Interpretation: f grows **at least as fast as** g, up to a constant factor.

### Big-Theta (Tight Bound)

```
f(n) = Theta(g(n)) iff there exist positive constants c1, c2, and n0 such that
0 <= c1 * g(n) <= f(n) <= c2 * g(n) for all n >= n0
```

Interpretation: f grows **at the same rate as** g, up to constant factors.

Equivalently: f(n) = Theta(g(n)) iff f(n) = O(g(n)) AND f(n) = Omega(g(n)).

### Little-o (Strict Upper Bound)

```
f(n) = o(g(n)) iff for every positive constant c > 0, there exists n0 such that
0 <= f(n) < c * g(n) for all n >= n0
```

Equivalently: lim(n->inf) f(n)/g(n) = 0.

Interpretation: f grows **strictly slower than** g. Example: n = o(n^2) but n is NOT o(n).

### Little-omega (Strict Lower Bound)

```
f(n) = omega(g(n)) iff for every positive constant c > 0, there exists n0 such that
0 <= c * g(n) < f(n) for all n >= n0
```

Equivalently: lim(n->inf) f(n)/g(n) = infinity.

---

## Asymptotic Notation Rules

### Transitivity

```
f(n) = O(g(n)) and g(n) = O(h(n))  =>  f(n) = O(h(n))
```

Same for Omega, Theta, o, omega.

### Reflexivity

```
f(n) = O(f(n))
f(n) = Omega(f(n))
f(n) = Theta(f(n))
```

### Symmetry

```
f(n) = Theta(g(n))  iff  g(n) = Theta(f(n))
```

### Transpose Symmetry

```
f(n) = O(g(n))  iff  g(n) = Omega(f(n))
f(n) = o(g(n))  iff  g(n) = omega(f(n))
```

### Sum Rule

```
O(f(n)) + O(g(n)) = O(max(f(n), g(n)))
```

Example: O(n^2) + O(n) = O(n^2)

### Product Rule

```
O(f(n)) * O(g(n)) = O(f(n) * g(n))
```

Example: O(n) * O(log n) = O(n log n)

### Common Simplifications

| Expression | Simplification | Rule |
|---|---|---|
| O(c * f(n)) | O(f(n)) | Drop multiplicative constants |
| O(f(n) + c) | O(f(n)) | Drop additive constants |
| O(f(n) + g(n)) | O(max(f(n), g(n))) | Sum rule |
| O(log_a(n)) | O(log n) | All logarithm bases equivalent |
| O(n^a) vs O(n^b) for a < b | O(n^a) is subset of O(n^b) | Polynomial ordering |

### Growth Rate Hierarchy

```
O(1) < O(log log n) < O(log n) < O(sqrt(n)) < O(n) < O(n log n)
     < O(n^2) < O(n^3) < O(2^n) < O(n!) < O(n^n)
```

---

## Master Theorem -- Formal Statement

**Theorem** (CLRS, Theorem 4.1): Let a >= 1 and b > 1 be constants, let f(n) be a function, and let T(n) be defined by the recurrence:

```
T(n) = aT(n/b) + f(n)
```

where n/b means either floor(n/b) or ceil(n/b). Then:

1. If f(n) = O(n^(log_b(a) - epsilon)) for some epsilon > 0, then T(n) = Theta(n^(log_b(a))).

2. If f(n) = Theta(n^(log_b(a))), then T(n) = Theta(n^(log_b(a)) * log n).

3. If f(n) = Omega(n^(log_b(a) + epsilon)) for some epsilon > 0, AND if a*f(n/b) <= c*f(n) for some c < 1 and sufficiently large n (regularity condition), then T(n) = Theta(f(n)).

**Gaps**: The Master Theorem has gaps. It does not cover cases where f(n) is between polynomial bounds (e.g., f(n) = n * log n when log_b(a) = 1). For these, use the extended Master Theorem or Akra-Bazzi.

Source: CLRS Chapter 4.5

---

## Akra-Bazzi Theorem -- Formal Statement

**Theorem** (Akra & Bazzi, 1998): Consider the recurrence:

```
T(n) = sum_{i=1}^{k} a_i * T(b_i * n + h_i(n)) + g(n)
```

for n large enough, where:
- a_i > 0 for all i
- 0 < b_i < 1 for all i
- |h_i(n)| = O(n / log^2 n)
- g(n) is bounded by a polynomial

Let p be the unique real number satisfying:

```
sum_{i=1}^{k} a_i * b_i^p = 1
```

Then:

```
T(n) = Theta( n^p * (1 + integral_1^n  g(u) / u^(p+1) du) )
```

**Advantages over the Master Theorem**:
- Handles unequal subproblem sizes (different b_i values)
- Handles additive terms in the argument (h_i(n))
- No gaps in coverage

Source: Akra, M.; Bazzi, L. (1998). "On the solution of linear recurrence equations." Computational Optimization and Applications, 10(2), 195-210.

---

## Profiling Tool References

### Go Profiling

**Package**: `runtime/pprof` and `net/http/pprof`

**Official documentation**:
- https://pkg.go.dev/runtime/pprof
- https://pkg.go.dev/net/http/pprof
- Blog: https://go.dev/blog/pprof

**Profile types**:
| Profile | Description | Flag/Endpoint |
|---|---|---|
| CPU | Where CPU time is spent | `/debug/pprof/profile` |
| Heap | Memory allocation | `/debug/pprof/heap` |
| Goroutine | Stack traces of all goroutines | `/debug/pprof/goroutine` |
| Block | Where goroutines block | `/debug/pprof/block` |
| Mutex | Mutex contention | `/debug/pprof/mutex` |
| Trace | Execution trace | `/debug/pprof/trace` |

**CLI tool**: `go tool pprof`

### Java Profiling

**Java Flight Recorder (JFR)**:
- Built into JDK 11+
- Official: https://docs.oracle.com/en/java/javase/17/docs/specs/man/jfr.html
- Low overhead (<2% typically)

**Java Microbenchmark Harness (JMH)**:
- https://github.com/openjdk/jmh
- Official benchmark framework for the JVM
- Handles JIT warmup, dead code elimination, constant folding

**async-profiler**:
- https://github.com/async-profiler/async-profiler
- Sampling profiler for JVM: CPU, allocations, locks
- Low overhead, no safepoint bias

### Python Profiling

**cProfile** (built-in):
- https://docs.python.org/3/library/profile.html
- Deterministic profiler, records every function call
- Overhead: moderate (slows program 2-5x)

**timeit** (built-in):
- https://docs.python.org/3/library/timeit.html
- Microbenchmark module, disables GC by default

**py-spy**:
- https://github.com/benfred/py-spy
- Sampling profiler, no code modification needed
- Works on running processes

**scalene**:
- https://github.com/plasma-umass/scalene
- CPU + memory profiler for Python
- Distinguishes Python vs C time

---

## Benchmarking Tool References

### Go: testing.B

```
Documentation: https://pkg.go.dev/testing#B
Run: go test -bench=. -benchmem -count=5
Flags:
  -bench <regexp>    Run benchmarks matching regexp
  -benchtime <d>     Run each benchmark for duration d (default 1s)
  -benchmem          Print memory allocation statistics
  -count <n>         Run each benchmark n times
  -cpu <list>        Set GOMAXPROCS for benchmarks
```

### Java: JMH

```
Documentation: https://github.com/openjdk/jmh/tree/master/jmh-samples
Annotations:
  @Benchmark          Mark a method as benchmark
  @BenchmarkMode      AverageTime, Throughput, SampleTime, SingleShotTime
  @OutputTimeUnit     ns, us, ms, s
  @Warmup             Warmup iterations
  @Measurement        Measurement iterations
  @Fork               Number of JVM forks
  @State              Shared state scope
  @Param              Parameterized input
```

### Python: timeit

```
Documentation: https://docs.python.org/3/library/timeit.html
CLI: python -m timeit "expression"
API:
  timeit.timeit(stmt, setup, number)    Time a statement
  timeit.repeat(stmt, setup, number, repeat)  Repeat timing
  timeit.Timer(stmt, setup)             Reusable timer object
```

---

## Textbook References

### Primary References

1. **CLRS** -- Cormen, T.H., Leiserson, C.E., Rivest, R.L., Stein, C. *Introduction to Algorithms*, 4th Edition, MIT Press, 2022.
   - Chapter 3: Growth of Functions (Big-O, Omega, Theta definitions)
   - Chapter 4: Divide-and-Conquer (Master Theorem, recurrences)
   - Chapter 17: Amortized Analysis

2. **Knuth** -- Knuth, D.E. *The Art of Computer Programming*, Volumes 1-3, Addison-Wesley.
   - Volume 1, Chapter 1.2.11: Asymptotic Representations
   - Volume 3: Sorting and Searching

3. **Sedgewick & Wayne** -- Sedgewick, R., Wayne, K. *Algorithms*, 4th Edition, Addison-Wesley, 2011.
   - Chapter 1.4: Analysis of Algorithms

### Supplementary References

4. **Skiena** -- Skiena, S.S. *The Algorithm Design Manual*, 3rd Edition, Springer, 2020.
   - Chapter 2: Algorithm Analysis

5. **Akra & Bazzi** -- Akra, M., Bazzi, L. "On the solution of linear recurrence equations." *Computational Optimization and Applications*, 10(2):195-210, 1998.

6. **Leighton** -- Leighton, T. "Notes on Better Master Theorems for Divide-and-Conquer Recurrences." MIT, 1996. (Extended Master Theorem including the Akra-Bazzi generalization.)

---

## Standards and Conventions

### Notation Conventions Used in This Course

| Symbol | Meaning |
|---|---|
| n | Primary input size |
| m | Secondary input size (when two inputs) |
| V | Number of vertices in a graph |
| E | Number of edges in a graph |
| k | Window size, number of groups, or value range |
| h | Height of a tree |
| d | Degree of a polynomial or node |
| T(n) | Running time function |
| S(n) | Space usage function |

### When to Use Each Notation

| Notation | Use When |
|---|---|
| O(f(n)) | Stating an upper bound ("this algorithm runs in at most...") |
| Omega(f(n)) | Stating a lower bound ("any algorithm for this problem needs at least...") |
| Theta(f(n)) | Stating a tight bound ("this algorithm runs in exactly... up to constants") |
| o(f(n)) | Stating a strict upper bound ("this grows strictly slower than...") |

### Common Mistakes to Avoid

1. Saying "the complexity IS O(n^2)" when you mean "the complexity is Theta(n^2)". O(n^2) is also technically O(n^3). Be precise about whether you mean upper bound or tight bound.

2. Using O-notation inside arithmetic: "O(n) + O(n) = O(2n) = O(n)" is correct but informal. Formally, O-notation refers to sets of functions.

3. Confusing worst-case with average-case. Always state which case you are analyzing. Quicksort is Theta(n^2) worst-case but Theta(n log n) average-case.

4. Assuming hash table operations are always O(1). They are O(1) **amortized and expected**. Worst case with many collisions is O(n).

5. Ignoring the cost of language-specific operations like string concatenation, list slicing, or garbage collection pauses.
