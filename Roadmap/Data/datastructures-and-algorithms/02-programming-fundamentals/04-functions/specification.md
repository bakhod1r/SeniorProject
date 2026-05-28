# Functions and Procedures — Specification

> **Official / Authoritative Reference**
> Source: [Church (1936) "An Unsolvable Problem of Elementary Number Theory"](https://doi.org/10.2307/2371045) — Lambda Calculus;
> [CLRS 4th ed.](https://mitpress.mit.edu/9780262046305/) — §2.1 (Insertion Sort), §4.3 (Recursion Tree Method);
> [Python Language Reference §8.7 — Function Definitions](https://docs.python.org/3/reference/compound_stmts.html#function-definitions);
> [NIST DADS — Procedure](https://xlinux.nist.gov/dads/HTML/procedure.html), [Recursion](https://xlinux.nist.gov/dads/HTML/recursion.html)

---

## Table of Contents

1. [Reference](#1-reference)
2. [Formal Definition / Grammar](#2-formal-definition-grammar)
3. [Core Rules & Constraints](#3-core-rules-constraints)
4. [Type / Category Rules](#4-type-category-rules)
5. [Behavioral Specification](#5-behavioral-specification)
6. [Defined vs Undefined Behavior](#6-defined-vs-undefined-behavior)
7. [Edge Cases](#7-edge-cases)
8. [Version / Evolution History](#8-version-evolution-history)
9. [Implementation Notes](#9-implementation-notes)
10. [Compliance Checklist](#10-compliance-checklist)
11. [Official Examples](#11-official-examples)
12. [Related Topics](#12-related-topics)

---

## 1. Reference

| Attribute       | Value                                                                               |
|-----------------|-------------------------------------------------------------------------------------|
| Formal Name     | Function / Procedure / Subroutine                                                   |
| Mathematical    | Lambda Calculus (Church, 1936); Partial Recursive Functions (Kleene, 1936)         |
| Primary Source  | CLRS Ch. 2–4 (procedures, recursion, divide-and-conquer)                            |
| Python Source   | https://docs.python.org/3/reference/compound_stmts.html#function-definitions       |
| NIST DADS       | https://xlinux.nist.gov/dads/HTML/procedure.html                                    |

**NIST DADS definition:**
> "A procedure is a sequence of instructions for performing a computation." — NIST DADS

In formal computer science, a **function** (or **procedure**) is an abstraction that encapsulates a computation, taking zero or more inputs (**parameters**) and returning zero or more outputs (**return values**).

---

## 2. Formal Definition / Grammar

### 2.1 Lambda Calculus (Church, 1936)

Lambda calculus is the theoretical foundation for all functional abstractions in programming languages.

**Syntax** (BNF):
```
<expr> ::= <var>              -- Variable: x, y, z, ...
         | λ<var>.<expr>      -- Abstraction: λx.e (function with parameter x, body e)
         | <expr> <expr>      -- Application: (f e) (apply f to argument e)
```

**Three reduction rules:**

1. **Alpha equivalence** (α-equivalence):
   - `λx.e` ≡ `λy.e[y/x]` — renaming bound variables preserves meaning
   - Example: `λx.x+1` ≡ `λy.y+1`

2. **Beta reduction** (β-reduction) — function application:
   - `(λx.e₁) e₂` → `e₁[e₂/x]` — substitute e₂ for free occurrences of x in e₁
   - Example: `(λx.x*2) 5` → `5*2` → `10`

3. **Eta reduction** (η-reduction):
   - `λx.(f x)` → `f` — if x does not appear free in f
   - Example: `λx.(add 1 x)` → `add 1` (partial application)

**Church-Turing thesis**: Lambda calculus is equivalent in computational power to Turing machines. Any computable function can be expressed in lambda calculus.

### 2.2 Python Function Grammar (Official — §8.7)

```peg
funcdef:
    | decorators 'def' NAME '(' [params] ')' ['->' expression] ':' [func_type_comment] block

params:
    | parameters

parameters:
    | slash_no_default param_no_default* param_with_default* [star_etc]
    | slash_with_default param_with_default* [star_etc]
    | param_no_default+ param_with_default* [star_etc]
    | param_with_default+ [star_etc]
    | star_etc

star_etc:
    | '*' param_no_default param_maybe_default* [kwds]
    | '*' param_no_default param_maybe_default*
    | '*' ',' param_maybe_default+ [kwds]
    | kwds

kwds: '**' param_no_default
```

### 2.3 Mathematical Function Definition

A function `f : A → B` maps each element of domain A to exactly one element of codomain B.

- **Total function**: defined for all inputs in domain A
- **Partial function**: defined for some inputs; undefined for others (may not terminate)
- **Pure function**: output depends only on input; no side effects
- **Impure function**: may read/modify global state, perform I/O

**Formal specification with pre/post conditions (Hoare logic):**
```
{P(x)} f(x) {Q(x, result)}
```
- `P(x)` — precondition: what must hold before calling f(x)
- `Q(x, result)` — postcondition: what holds after f(x) returns `result`

**Example:**
```
{n ≥ 0}  factorial(n)  {result = n!}
```

---

## 3. Core Rules & Constraints

### 3.1 Function Components

| Component         | Description                                                                 |
|-------------------|-----------------------------------------------------------------------------|
| **Name**          | Identifier by which function is called                                      |
| **Parameters**    | Named inputs; define the function's interface                               |
| **Body**          | Sequence of statements that implement the computation                       |
| **Return value**  | Result(s) sent back to caller; may be `void`/`None` for procedures          |
| **Scope**         | Local variables visible only within function body                           |
| **Activation record** | Stack frame created at call time; holds locals, params, return address  |

### 3.2 Parameter Passing Modes

| Mode               | Definition                                                    | Languages        |
|--------------------|---------------------------------------------------------------|------------------|
| **By value**       | Copy of argument passed; callee has its own copy             | C, Java (primitives), Python (immutables) |
| **By reference**   | Memory address passed; callee can modify caller's variable   | C++ `&`, C# `ref`, Pascal `var` |
| **By sharing**     | Reference to object passed; callee can modify object's state | Python (mutable objects), Java (objects) |
| **By name**        | Argument expression re-evaluated on each use in callee       | ALGOL 60, Haskell (lazy) |
| **By need (lazy)** | Like by-name but memoized after first evaluation             | Haskell            |

**Python's model (pass-by-object-reference / pass-by-sharing):**

```python
def modify(lst, num):
    lst.append(4)     # Modifies original list (by sharing)
    num = num + 10    # Does NOT modify original int (integers are immutable)

my_list = [1, 2, 3]
my_num = 5
modify(my_list, my_num)
print(my_list)  # [1, 2, 3, 4]  — list was mutated
print(my_num)   # 5             — int was not changed
```

### 3.3 Scope Rules

| Scope Type        | Description                                          | Example                  |
|-------------------|------------------------------------------------------|--------------------------|
| **Local**         | Variables defined inside function; inaccessible outside | `x` in `def f(): x = 1` |
| **Global**        | Variables defined at module level                    | `x = 1` at top of file   |
| **Enclosing**     | Variables in outer function (closures)               | `nonlocal x` in Python   |
| **Built-in**      | Language-defined names                               | `len`, `range`, `print`  |

**Python LEGB rule**: Local → Enclosing → Global → Built-in

---

## 4. Type / Category Rules

### 4.1 Taxonomy of Functions

```
Functions / Procedures
├── By Return Value
│   ├── Function — returns a value (mathematical sense)
│   └── Procedure — returns nothing (void); side effects only
│
├── By Recursion
│   ├── Non-recursive — calls only other functions, never itself
│   ├── Direct recursive — f() calls f() directly
│   ├── Mutual recursive — f() calls g(), g() calls f()
│   └── Tail recursive — recursive call is the last operation
│
├── By Order
│   ├── First-order — operates on data values
│   └── Higher-order — takes/returns functions as values
│
├── By Side Effects
│   ├── Pure — deterministic, no side effects
│   └── Impure — has side effects (I/O, global state, mutation)
│
└── By Arity
    ├── Nullary (0 parameters)
    ├── Unary (1 parameter)
    ├── Binary (2 parameters)
    ├── Ternary (3 parameters)
    └── n-ary / variadic
```

### 4.2 Higher-Order Functions

A function is **first-class** if it can be:
- Assigned to a variable
- Passed as an argument
- Returned from another function
- Stored in a data structure

```python
# Functions as first-class objects in Python
def apply_twice(f, x):
    """Higher-order: takes function f as argument."""
    return f(f(x))

double = lambda x: x * 2
print(apply_twice(double, 3))   # double(double(3)) = double(6) = 12

# Map: applies f to each element
result = list(map(lambda x: x**2, [1, 2, 3, 4]))  # [1, 4, 9, 16]

# Filter: keeps elements where f is True
evens = list(filter(lambda x: x % 2 == 0, range(10)))  # [0, 2, 4, 6, 8]

# Reduce: fold over sequence
from functools import reduce
product = reduce(lambda a, b: a * b, [1, 2, 3, 4, 5])  # 120
```

---

## 5. Behavioral Specification

### 5.1 Recursion — Formal Structure

**CLRS definition (§4):**
> "A recursive algorithm is one that calls itself on smaller instances of the same problem. Every recursive algorithm has: (1) a base case (or cases) that can be solved without recursion, and (2) a recursive case that reduces the problem toward the base case."

**Structure of any recursive function:**

```
RECURSIVE-FUNCTION(problem)
1  if problem is a base case
2      solve directly and return
3  else
4      reduce problem to smaller subproblem(s)
5      call RECURSIVE-FUNCTION(subproblem)
6      combine results and return
```

**Recurrence relation**: The time complexity T(n) of a recursive function satisfies:
```
T(n) = a·T(n/b) + f(n)

where:
  a = number of recursive subproblems
  b = factor by which problem size decreases
  f(n) = cost of work done outside recursive calls
```

Solved by the **Master Theorem** (CLRS §4.5):

| Condition                    | Solution      | Example                         |
|------------------------------|---------------|---------------------------------|
| f(n) = O(nˡᵒᵍᵇᵃ⁻ᵉ)           | Θ(nˡᵒᵍᵇᵃ)    | Binary tree traversal           |
| f(n) = Θ(nˡᵒᵍᵇᵃ)             | Θ(nˡᵒᵍᵇᵃ log n)| Merge Sort: T(n) = 2T(n/2)+Θ(n)|
| f(n) = Ω(nˡᵒᵍᵇᵃ⁺ᵉ)           | Θ(f(n))       | Binary Search: T(n) = T(n/2)+Θ(1)|

### 5.2 The Call Stack

The **call stack** (execution stack) is a LIFO stack of **activation records** (stack frames).

**Activation record contains:**
1. Return address (where to resume in caller)
2. Arguments / parameters passed to callee
3. Local variables of the callee
4. Saved registers (implementation-dependent)
5. Previous frame pointer (to restore caller's frame)

**Call stack mechanics:**

```
Main()
│
├─ Calls factorial(4)
│  │   Stack: [factorial(4)]
│  ├─ Calls factorial(3)
│  │  │   Stack: [factorial(4), factorial(3)]
│  │  ├─ Calls factorial(2)
│  │  │  │   Stack: [factorial(4), factorial(3), factorial(2)]
│  │  │  ├─ Calls factorial(1)
│  │  │  │  │   Stack: [factorial(4), factorial(3), factorial(2), factorial(1)]
│  │  │  │  └─ Returns 1  (base case)
│  │  │  └─ Returns 2·1 = 2
│  │  └─ Returns 3·2 = 6
│  └─ Returns 4·6 = 24
└─ Result: 24
```

**Stack depth**: For `factorial(n)`, recursion depth = n. Each frame uses O(1) space, so total space = O(n).

### 5.3 Tail Recursion

**Definition**: A recursive call is **tail-recursive** if it is the **last operation** performed before returning.

```python
# NOT tail-recursive: multiplication after recursive call
def factorial(n):
    if n == 0:
        return 1
    return n * factorial(n - 1)   # multiply happens AFTER return from recursion

# TAIL-RECURSIVE: accumulator carries the result
def factorial_tail(n, acc=1):
    if n == 0:
        return acc
    return factorial_tail(n - 1, n * acc)   # recursive call IS the last operation
```

**Tail Call Optimization (TCO)**: If a language implements TCO, tail-recursive calls reuse the current stack frame instead of pushing a new one. This converts O(n) stack space to O(1).

- **Supports TCO**: Scheme (required), Scala, Haskell, Swift, Kotlin
- **Does NOT support TCO**: Python (by design, PEP 3113), Java (JVM limitation), JavaScript V8 (partially)

### 5.4 Memoization

**Definition**: Cache the result of a pure function call indexed by its arguments. If called again with the same arguments, return the cached result without recomputation.

**Time-space tradeoff**: Reduces redundant computation from exponential to polynomial.

```python
# Naive Fibonacci — exponential time T(n) = T(n-1) + T(n-2) + O(1) → O(2ⁿ)
def fib_naive(n):
    if n <= 1:
        return n
    return fib_naive(n - 1) + fib_naive(n - 2)

# Memoized Fibonacci — O(n) time, O(n) space
def fib_memo(n, cache={}):
    if n in cache:
        return cache[n]           # O(1) lookup
    if n <= 1:
        return n
    result = fib_memo(n-1, cache) + fib_memo(n-2, cache)
    cache[n] = result             # Store result
    return result

# Python standard library: functools.lru_cache
from functools import lru_cache

@lru_cache(maxsize=None)
def fib(n):
    if n <= 1:
        return n
    return fib(n-1) + fib(n-2)
```

**Number of unique subproblems** for `fib(n)`: n+1 (values 0 through n).

---

## 6. Defined vs Undefined Behavior

| Situation                            | Status       | Notes                                                      |
|--------------------------------------|--------------|------------------------------------------------------------|
| Calling function with correct arity  | Defined      | Normal operation                                           |
| Missing required argument (Python)   | TypeError    | Runtime error                                              |
| Extra positional arg (Python)        | TypeError    | Rejected at call site                                      |
| Recursion without base case          | Undefined    | Stack overflow (RecursionError in Python)                  |
| Stack overflow (RecursionError)      | Defined      | Python raises RecursionError at depth limit (~1000)        |
| Returning no value (Python)          | Defined      | Returns `None` implicitly                                  |
| Modifying mutable default argument   | Defined*     | Shared across calls — classic Python gotcha               |
| Calling before definition (Python)   | NameError    | Name lookup fails at call time if not yet defined          |
| Tail call in Python                  | Not optimized| New frame always pushed; no TCO in CPython                 |
| Division by zero in function body    | Defined      | ZeroDivisionError raised, propagates to caller             |

---

## 7. Edge Cases

### 7.1 Mutable Default Arguments (Python Gotcha)

```python
# WRONG: default list is created ONCE, shared across all calls
def append_to(element, lst=[]):
    lst.append(element)
    return lst

print(append_to(1))  # [1]
print(append_to(2))  # [1, 2] — unexpected! lst persists between calls

# CORRECT: use None as sentinel, create new list each call
def append_to(element, lst=None):
    if lst is None:
        lst = []
    lst.append(element)
    return lst
```

### 7.2 Recursion Depth Limit

```python
import sys
print(sys.getrecursionlimit())  # Default: 1000 in CPython

# For deep recursion, increase limit (risky — may crash Python):
sys.setrecursionlimit(10000)

# Better: convert recursive to iterative using explicit stack
def factorial_iterative(n):
    result = 1
    for i in range(2, n + 1):
        result *= i
    return result
```

### 7.3 Infinite Recursion

```python
# Every path must reach a base case:
def bad_recursion(n):
    if n == 0:
        return 0
    return bad_recursion(n + 1)  # n grows away from base case!
    # RecursionError for any n > 0

# Correct: ensure n approaches base case
def good_recursion(n):
    if n == 0:
        return 0
    return good_recursion(n - 1)  # n decreases toward 0
```

### 7.4 Mutual Recursion

```python
# Requires both functions to be defined before either is called
def is_even(n):
    if n == 0:
        return True
    return is_odd(n - 1)

def is_odd(n):
    if n == 0:
        return False
    return is_even(n - 1)

# is_even(4) → is_odd(3) → is_even(2) → is_odd(1) → is_even(0) → True
# Recursion depth: O(n) — could use O(1) with n % 2 == 0
```

### 7.5 Closures and Captured Variables

```python
def make_adder(n):
    """Returns a function that adds n to its argument."""
    def adder(x):
        return x + n    # 'n' is captured from enclosing scope
    return adder

add5 = make_adder(5)
print(add5(3))   # 8 — closure retains reference to n=5

# Gotcha: late binding in loops
funcs = [lambda x: x + i for i in range(3)]
print([f(0) for f in funcs])  # [2, 2, 2] — all capture same 'i' (= 2 at end of loop)

# Fix: use default argument to bind at creation time
funcs = [lambda x, i=i: x + i for i in range(3)]
print([f(0) for f in funcs])  # [0, 1, 2]
```

---

## 8. Version / Evolution History

| Year | Event                                                                                    |
|------|------------------------------------------------------------------------------------------|
| 1936 | Church — Lambda Calculus; Kleene — μ-recursive functions; Turing — Turing Machines      |
| 1945 | Zuse's Plankalkül — first language with user-defined procedures                         |
| 1949 | Wheeler & Wilkes — concept of closed subroutine on EDSAC                                |
| 1957 | FORTRAN subroutines — `FUNCTION` and `SUBROUTINE` statements                            |
| 1960 | ALGOL 60 — call-by-value and call-by-name; lexical scoping; recursive procedures        |
| 1965 | LISP — first practical language with first-class functions and closures                  |
| 1967 | Simula — methods as procedures of objects (first OOP language)                          |
| 1975 | Scheme — tail call optimization; first class functions; minimal syntax                  |
| 1977 | ML — polymorphic type inference; pattern-matching functions                             |
| 1983 | C++ — function overloading; inline functions; default parameters                        |
| 1986 | Haskell — pure functional; lazy evaluation; type classes                                |
| 1991 | Python — first-class functions; `lambda`; `map`/`filter`/`reduce`                       |
| 2001 | Python 2.2 — generators (`yield`); iterator protocol                                    |
| 2004 | Python 2.4 — `functools.partial`; `@decorator` syntax                                  |
| 2008 | Python 3.0 — `nonlocal`; annotations; keyword-only arguments                            |
| 2012 | Python 3.2 — `functools.lru_cache`                                                      |
| 2015 | Python 3.5 — type hints (PEP 484); `async def` / `await`                               |
| 2022 | Python 3.11 — faster function calls via specializing adaptive interpreter               |

---

## 9. Implementation Notes

### 9.1 Iterative vs Recursive — Tradeoff

| Aspect           | Recursive                         | Iterative                          |
|------------------|-----------------------------------|------------------------------------|
| Readability      | Often clearer for recursive problems | Often clearer for sequential problems |
| Space            | O(depth) stack frames             | O(1) with explicit stack if needed |
| Time             | Same asymptotic order (usually)   | Lower constant factor (no frame push/pop) |
| Stack overflow   | Risk for deep recursion           | No risk                            |
| Tail call opt.   | O(1) space if TCO available       | N/A                                |

### 9.2 Converting Recursion to Iteration (Explicit Stack)

```python
# Recursive DFS
def dfs_recursive(graph, node, visited=None):
    if visited is None:
        visited = set()
    visited.add(node)
    for neighbor in graph[node]:
        if neighbor not in visited:
            dfs_recursive(graph, neighbor, visited)
    return visited

# Iterative DFS — equivalent, using explicit stack
def dfs_iterative(graph, start):
    visited = set()
    stack = [start]
    while stack:
        node = stack.pop()          # LIFO — mimics call stack
        if node not in visited:
            visited.add(node)
            for neighbor in graph[node]:
                if neighbor not in visited:
                    stack.append(neighbor)
    return visited
```

### 9.3 Complexity of Recursive Algorithms

```python
# T(n) = T(n-1) + O(1) → O(n)  [linear recursion]
def sum_recursive(A, n):
    if n == 0:
        return 0
    return A[n-1] + sum_recursive(A, n-1)

# T(n) = 2T(n/2) + O(n) → O(n log n)  [divide and conquer]
def merge_sort(A):
    if len(A) <= 1:
        return A
    mid = len(A) // 2
    left = merge_sort(A[:mid])
    right = merge_sort(A[mid:])
    return merge(left, right)

# T(n) = 2T(n-1) + O(1) → O(2ⁿ)  [exponential — avoid!]
def bad_fib(n):
    if n <= 1:
        return n
    return bad_fib(n-1) + bad_fib(n-2)   # 2 recursive calls, depth n
```

### 9.4 Python Function Features

```python
# Default parameters
def greet(name, greeting="Hello"):
    return f"{greeting}, {name}!"

# *args — variable positional arguments
def sum_all(*args):
    return sum(args)

# **kwargs — variable keyword arguments
def print_info(**kwargs):
    for key, value in kwargs.items():
        print(f"{key}: {value}")

# Type annotations (PEP 484)
def factorial(n: int) -> int:
    if n == 0:
        return 1
    return n * factorial(n - 1)

# Generator function (lazy evaluation)
def fibonacci_gen():
    a, b = 0, 1
    while True:
        yield a
        a, b = b, a + b

# Lambda (anonymous function)
square = lambda x: x ** 2
print(square(5))  # 25
```

---

## 10. Compliance Checklist

- [ ] Function has a single, well-defined purpose (SRP)
- [ ] Preconditions and postconditions are documented
- [ ] Every recursive function has at least one base case
- [ ] Recursive function provably terminates (variant function decreases)
- [ ] No mutable default arguments (use `None` sentinel instead)
- [ ] Parameters named descriptively
- [ ] Function length is reasonable (ideally ≤ 20 lines for a single responsibility)
- [ ] Return type is consistent (always returns same type or `None`)
- [ ] Side effects are documented or avoided (pure functions preferred)
- [ ] Higher-order functions use descriptive parameter names (`func`, `predicate`, `key`)
- [ ] Tail recursion used where deep recursion is needed (or converted to iterative)
- [ ] Memoization applied for overlapping subproblems
- [ ] Type annotations provided for public APIs (Python 3.5+)

---

## 11. Official Examples

### 11.1 Recursive Factorial (CLRS §2 — mathematical induction proof)

**Pseudocode:**
```
FACTORIAL(n)
// Precondition: n >= 0, n is integer
// Postcondition: returns n!
1  if n == 0
2      return 1          // Base case: 0! = 1
3  else
4      return n * FACTORIAL(n - 1)   // Recursive case
```

**Python:**
```python
def factorial(n: int) -> int:
    """
    Computes n! recursively.
    Time:  O(n) — n recursive calls
    Space: O(n) — n stack frames
    """
    if n == 0:           # Base case
        return 1
    return n * factorial(n - 1)  # Recursive case
```

**Java:**
```java
public static long factorial(int n) {
    if (n == 0) return 1L;             // Base case
    return (long) n * factorial(n - 1); // Recursive case
}
```

### 11.2 Binary Search — Recursive and Iterative (CLRS §2.3)

```
BINARY-SEARCH-RECURSIVE(A, low, high, x)
// Precondition: A[low..high] is sorted in non-decreasing order
// Postcondition: returns index i s.t. A[i] = x, or NIL
1  if low > high
2      return NIL
3  mid = ⌊(low + high) / 2⌋
4  if A[mid] == x
5      return mid
6  elseif A[mid] < x
7      return BINARY-SEARCH-RECURSIVE(A, mid + 1, high, x)
8  else
9      return BINARY-SEARCH-RECURSIVE(A, low, mid - 1, x)
```

```python
def binary_search(A: list, x) -> int:
    """
    Recursive binary search.
    Precondition:  A is sorted in non-decreasing order
    Postcondition: Returns index i where A[i] == x, or -1
    Time:  O(log n) — T(n) = T(n/2) + O(1)
    Space: O(log n) — recursion depth
    """
    def search(low, high):
        if low > high:
            return -1
        mid = (low + high) // 2
        if A[mid] == x:
            return mid
        elif A[mid] < x:
            return search(mid + 1, high)
        else:
            return search(low, mid - 1)

    return search(0, len(A) - 1)
```

### 11.3 Merge Sort — Divide and Conquer (CLRS §2.3)

```python
def merge_sort(A: list) -> list:
    """
    Divide-and-conquer sort.
    Precondition:  A is a list of comparable elements
    Postcondition: Returns a new list with elements in non-decreasing order
    Time:  T(n) = 2T(n/2) + Θ(n) = Θ(n log n)  [Master Theorem, Case 2]
    Space: O(n)   — auxiliary arrays for merge
    """
    if len(A) <= 1:
        return A                    # Base case

    mid = len(A) // 2               # Divide
    left = merge_sort(A[:mid])      # Conquer left
    right = merge_sort(A[mid:])     # Conquer right
    return merge(left, right)       # Combine

def merge(left: list, right: list) -> list:
    result = []
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            result.append(left[i]); i += 1
        else:
            result.append(right[j]); j += 1
    result.extend(left[i:])
    result.extend(right[j:])
    return result
```

### 11.4 Tower of Hanoi — Classic Recursion

```
HANOI(n, source, auxiliary, destination)
// Move n disks from source to destination using auxiliary
1  if n == 1
2      print "Move disk 1 from" source "to" destination
3      return
4  HANOI(n - 1, source, destination, auxiliary)
5  print "Move disk" n "from" source "to" destination
6  HANOI(n - 1, auxiliary, source, destination)
```

**Recurrence**: T(n) = 2T(n-1) + 1 → T(n) = 2ⁿ - 1 = O(2ⁿ)

```python
def hanoi(n: int, source: str, auxiliary: str, destination: str) -> None:
    """
    Tower of Hanoi with n disks.
    Time: O(2ⁿ) — minimum 2ⁿ-1 moves required
    """
    if n == 1:
        print(f"Move disk 1 from {source} to {destination}")
        return
    hanoi(n - 1, source, destination, auxiliary)
    print(f"Move disk {n} from {source} to {destination}")
    hanoi(n - 1, auxiliary, source, destination)
```

---

## 12. Related Topics

| Topic                    | Relationship                                                       | Location                     |
|--------------------------|--------------------------------------------------------------------|------------------------------|
| Control Structures       | Function body uses sequences, selection, iteration                 | `../03-control-structures/`  |
| OOP Basics               | Methods are functions bound to objects/classes                     | `../05-oop-basics/`          |
| Pseudocode               | CLRS pseudocode for procedure definitions                          | `../02-pseudo-code/`         |
| Stack Data Structure     | Implements call stack; used in iterative recursion                 | CLRS §10.1                   |
| Recursion & Recurrences  | CLRS Master Theorem; recursive complexity analysis                 | CLRS §4                      |
| Dynamic Programming      | Memoization + recursion; overlapping subproblems                  | CLRS §14–15                  |
| Divide and Conquer       | Recursive paradigm: divide, conquer, combine                      | CLRS §4                      |
| Lambda Calculus          | Theoretical foundation for all functional abstractions            | Church (1936)                |
| Type Systems             | Function signatures with parameter and return types               | Python `typing`, Java types  |
| Big-O Complexity         | Analyzing recursive functions via recurrence relations            | bigocheatsheet.com           |
