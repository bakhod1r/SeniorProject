# Pseudocode — Specification

> **Official / Authoritative Reference**
> Source: [Cormen, Leiserson, Rivest, Stein — "Introduction to Algorithms" (CLRS), 4th ed.](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — §Chapter 2, Appendix A;
> [Knuth — "The Art of Computer Programming" (TAOCP) Vol. 1](https://www-cs-faculty.stanford.edu/~knuth/taocp.html) — §1.1;
> [NIST DADS — Pseudocode](https://xlinux.nist.gov/dads/HTML/pseudocode.html)

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

| Attribute       | Value                                                                              |
|-----------------|------------------------------------------------------------------------------------|
| Formal Name     | Pseudocode (informal algorithmic notation)                                         |
| Primary Source  | CLRS 4th ed. — Ch. 2 "Getting Started", Ch. 3 "Characterizing Running Times"       |
| Secondary       | Knuth TAOCP Vol. 1, §1.1 — MIX assembly pseudocode                                |
| NIST Definition | "A compact and informal high-level description of an algorithm"                    |
| Purpose         | Communicate algorithms clearly, independent of any programming language syntax     |

Pseudocode is not a formal language; it uses a **controlled natural language** with mathematical and programming constructs. The goal is **clarity and precision**, not executability.

---

## 2. Formal Definition / Grammar

### 2.1 CLRS Pseudocode Conventions (4th Edition)

CLRS (Introduction to Algorithms) defines a pseudocode dialect used consistently throughout the book. These are the authoritative conventions as stated in Chapter 2:

**Indentation**
> "We use indentation to indicate block structure. For example, the body of the **for** loop that begins on line 2 consists of lines 3–8, and the body of the **while** loop that begins on line 5 consists of lines 6–7." — CLRS §2.1

**Assignment**
- `x = y` — assignment (not equality test)
- `x == y` — equality comparison
- `x ≠ y` — inequality (also written `x != y` in ASCII contexts)

**Comments**
- `// This is a comment` — single-line comment extending to end of line

**Nil / Null**
- `NIL` — represents null pointer or absence of value (equivalent to `None` in Python, `null` in Java)

**Array Indexing (1-based by default in CLRS)**
- `A[1 .. n]` — array A with elements indexed 1 through n
- `A[i]` — element at index i
- `A.length` — number of elements in array A
- `A[i .. j]` — subarray from index i to j, inclusive

**Attribute Access**
- `x.key` — attribute `key` of object `x`
- `x.left`, `x.right`, `x.parent` — tree node attributes

**Comparison Operators**
- `<`, `>`, `≤`, `≥`, `==`, `≠`

**Logical Operators**
- `and`, `or`, `not` — short-circuit evaluation (same as most languages)

**Arithmetic**
- Standard: `+`, `-`, `*`, `/`
- Integer division: `⌊x/y⌋` (floor), `⌈x/y⌉` (ceiling)
- Modulo: `x mod y`
- Exponentiation: `xʸ` or `x^y`

**Boolean Values**
- `TRUE`, `FALSE`

### 2.2 CLRS Loop Notation

```
for i = 1 to n
    [body]

for i = n downto 1
    [body]

while condition
    [body]

repeat
    [body]
until condition
```

### 2.3 CLRS Procedure / Function Definition

```
PROCEDURE-NAME(param1, param2, ..., paramk)
1  [body line 1]
2  [body line 2]
3  return value
```

- Procedure names are in SMALL-CAPS
- Parameters are listed; no type declarations
- `return` exits with a value
- Multiple return values are allowed: `return a, b`
- Global variables are accessible unless otherwise stated

### 2.4 Error / Special Cases

```
error "message"       // raise an error condition
// no explicit exception handling in basic CLRS pseudocode
```

---

## 3. Core Rules & Constraints

### 3.1 Structural Rules

| Rule                         | Description                                                              |
|------------------------------|--------------------------------------------------------------------------|
| Indentation = Block Structure| No braces; indentation level determines scope                            |
| Line Numbers                 | Optional but conventional in CLRS for referencing within analysis        |
| 1-Based Arrays               | CLRS uses 1-based indexing by default; state clearly if 0-based          |
| No Type Declarations         | Variables are untyped; types inferred from context                       |
| No I/O                       | Input/output described in prose, not pseudocode syntax                   |
| Procedure Names CAPS         | All-caps or Small-Caps names identify procedure definitions              |

### 3.2 Loop Invariants

A **loop invariant** is a condition that holds:
1. **Initialization**: before the first iteration
2. **Maintenance**: if true before iteration i, it remains true after
3. **Termination**: when the loop ends, provides a useful property for proving correctness

CLRS states (§2.1):
> "Loop invariants help us understand why an algorithm is correct. When the loop terminates, the invariant gives us a useful property that helps show that the algorithm is correct."

**Invariant for Insertion Sort (CLRS §2.1):**
> At the start of each iteration of the **for** loop, the subarray A[1..j-1] consists of the elements originally in A[1..j-1] but in sorted order.

### 3.3 Preconditions and Postconditions

- **Precondition**: What must be true *before* the algorithm executes
- **Postcondition**: What is guaranteed *after* the algorithm executes

These are stated in prose or mathematical notation adjacent to the pseudocode.

---

## 4. Type / Category Rules

### 4.1 Statement Categories

| Category    | Syntax Form                            | Semantics                                |
|-------------|----------------------------------------|------------------------------------------|
| Assignment  | `x = expr`                             | Evaluate expr, store in x                |
| Conditional | `if cond \| elseif \| else`             | Branch based on boolean condition        |
| For loop    | `for i = a to b`                       | Iterate with counter                     |
| While loop  | `while cond`                           | Repeat while condition is true           |
| Repeat-until| `repeat ... until cond`                | Execute at least once; check at end      |
| Return      | `return expr`                          | Exit procedure with value                |
| Call        | `PROCEDURE-NAME(args)`                 | Invoke procedure; result may be assigned |
| Error       | `error "msg"`                          | Raise an error; algorithm halts          |
| Comment     | `// text`                              | Documentation; ignored in execution      |

### 4.2 Data Type Conventions (Implicit)

| Value Kind       | Notation Example         | Notes                              |
|------------------|--------------------------|------------------------------------|
| Integer          | `n`, `i`, `j`, `k`       | Standard integer arithmetic        |
| Real number      | `x`, `y`                 | Float/real arithmetic              |
| Boolean          | `TRUE`, `FALSE`          | Result of comparison operators     |
| Array            | `A[1..n]`                | 1-indexed unless stated otherwise  |
| Linked list node | `x.key`, `x.next`        | Object with named attributes       |
| NIL              | `NIL`                    | Null pointer / absence of value    |
| Infinity         | `∞`, `−∞`               | Used in graph algorithms, sorting  |

---

## 5. Behavioral Specification

### 5.1 Parameter Passing

CLRS uses **pass-by-value** for primitive types and effectively **pass-by-reference** for arrays and objects (consistent with most high-level languages):

> "When we pass an array to a procedure, we pass a pointer to the array's first element. Attributes of objects are passed by reference in the same way." — CLRS Ch. 10 (Data Structures)

### 5.2 Recursion in CLRS Pseudocode

Recursive procedures call themselves by name:

```
MERGE-SORT(A, p, r)
1  if p ≥ r
2      return
3  q = ⌊(p + r) / 2⌋
4  MERGE-SORT(A, p, q)
5  MERGE-SORT(A, q + 1, r)
6  MERGE(A, p, q, r)
```

### 5.3 Call Stack Semantics

Each procedure call creates a new **activation record** (stack frame) containing:
- Local variables
- Parameters (passed by value for primitives)
- Return address

The call stack is **LIFO** (Last In, First Out). Stack depth equals the recursion depth.

**Stack depth for MERGE-SORT on n elements:**
```
T(n) = O(log n)   [recursion depth]
Space = O(log n)  [stack frames]
```

### 5.4 Knuth's MIX Pseudocode (TAOCP)

Knuth uses a different style — a hypothetical assembly language called **MIX**:
- Registers: rA (accumulator), rX (extension), rI1-rI6 (indices), rJ (jump)
- Mix instruction format: `OPCODE ADDR,I(F)`
- Modern editions use MMIX (64-bit RISC variant)

For high-level descriptions, Knuth uses structured pseudocode similar to CLRS but with step labels:
```
Algorithm S (Sequential search).
  S1. [Initialize.] Set i ← 1.
  S2. [Compare.] If Ki = K, go to step S4.
  S3. [Advance.] Increase i by 1; if i ≤ n, go to S2.
  S4. [Found.] ...
```

---

## 6. Defined vs Undefined Behavior

| Situation                        | Status      | Handling                                          |
|----------------------------------|-------------|---------------------------------------------------|
| Accessing A[i] with valid i      | Defined     | Returns A[i]                                      |
| Accessing A[0] (1-based arrays)  | Undefined   | Out-of-bounds; behavior not specified             |
| Division by zero                 | Undefined   | Pseudocode does not specify; real code raises error|
| Integer overflow                 | Impl-defined| Assumed ideal integers unless stated otherwise    |
| Calling with wrong arg count     | Undefined   | Not checked; assumed correct by convention        |
| NIL dereference (x.key when NIL) | Undefined   | Error; caller must check for NIL first            |
| Infinite loop                    | Defined     | Algorithm does not terminate; correctness proof required |

---

## 7. Edge Cases

### 7.1 Empty Input

Most CLRS algorithms handle empty arrays via the loop invariant:
- `for i = 1 to 0` — loop body never executes; consistent with n=0 case
- Always verify: does the algorithm return a meaningful result for n=0?

### 7.2 Single-Element Input

- Sorting algorithms: trivially sorted; should return immediately
- Search algorithms: should check the single element before returning NIL

### 7.3 All-Equal Elements

- Comparison-based sorts must handle duplicate keys
- Stability: equal elements maintain original relative order

### 7.4 Numeric Precision

- Pseudocode assumes exact arithmetic
- Real implementation must handle floating-point precision issues
- State explicitly: "Assume all values are integers" or "values are real numbers"

---

## 8. Version / Evolution History

| Year | Source / Version                  | Contribution                                                    |
|------|-----------------------------------|-----------------------------------------------------------------|
| 1968 | Knuth TAOCP Vol. 1 (1st ed.)      | First systematic use of algorithmic pseudocode in textbooks     |
| 1969 | Dijkstra "Structured Programming" | Introduced structured pseudocode with named blocks              |
| 1973 | Aho, Hopcroft, Ullman             | Pseudocode for automata/algorithms; influenced CLRS style       |
| 1990 | CLRS 1st edition                  | Established the dominant pseudocode standard for DSA education  |
| 2001 | CLRS 2nd edition                  | Refined conventions; added object notation (x.field)           |
| 2009 | CLRS 3rd edition                  | Added dynamic programming, greedy, graph chapters              |
| 2022 | CLRS 4th edition                  | Updated pseudocode; added linear programming, online algorithms |

---

## 9. Implementation Notes

### 9.1 Translating CLRS Pseudocode to Python

Key differences to handle:

| CLRS Pseudocode          | Python Equivalent          | Note                                  |
|--------------------------|----------------------------|---------------------------------------|
| `A[1..n]` (1-based)      | `A[0..n-1]` (0-based)      | Subtract 1 from all indices           |
| `A.length`               | `len(A)`                   | Built-in function                     |
| `NIL`                    | `None`                     | Python null value                     |
| `for i = 1 to n`         | `for i in range(1, n+1)`   | Python range is exclusive             |
| `for i = n downto 1`     | `for i in range(n, 0, -1)` | Python range with step -1             |
| `⌊x/y⌋`                 | `x // y`                   | Python floor division                 |
| `⌈x/y⌉`                 | `-((-x) // y)` or `math.ceil(x/y)` | Python ceiling division    |
| `x mod y`                | `x % y`                    | Python modulo                         |
| `TRUE`, `FALSE`          | `True`, `False`            | Python capitalization                 |
| `error "msg"`            | `raise ValueError("msg")`  | Python exception                      |
| `∞`                      | `float('inf')`             | Python positive infinity              |

### 9.2 BubbleSort — CLRS-Style Pseudocode to Python

**CLRS-style pseudocode:**

```
BUBBLE-SORT(A, n)
1  for i = 1 to n - 1
2      for j = n downto i + 1
3          if A[j] < A[j - 1]
4              exchange A[j] with A[j - 1]
```

**Python translation:**

```python
def bubble_sort(A):
    """
    Sorts array A in-place using bubble sort.
    Precondition:  A is a list of comparable elements
    Postcondition: A is sorted in non-decreasing order
    Time:  O(n^2) — worst and average case
    Space: O(1)   — in-place
    """
    n = len(A)
    for i in range(n - 1):           # i = 0 to n-2 (CLRS: 1 to n-1)
        for j in range(n - 1, i, -1): # j = n-1 downto i+1 (CLRS: n downto i+1)
            if A[j] < A[j - 1]:
                A[j], A[j - 1] = A[j - 1], A[j]  # exchange

    # Loop invariant: After iteration i, A[0..i] contains the i+1
    # smallest elements in sorted order.
```

**Java translation:**

```java
// CLRS BubbleSort — Java (0-based indexing)
public static void bubbleSort(int[] A) {
    int n = A.length;
    for (int i = 0; i < n - 1; i++) {          // i = 1 to n-1 (0-based: 0 to n-2)
        for (int j = n - 1; j > i; j--) {       // j = n downto i+1
            if (A[j] < A[j - 1]) {
                int temp = A[j];
                A[j] = A[j - 1];
                A[j - 1] = temp;               // exchange A[j] with A[j-1]
            }
        }
    }
}
```

### 9.3 Complexity Documentation in Pseudocode

Following CLRS style, always document:

```
ALGORITHM-NAME(params)
// Precondition: [what must hold before execution]
// Postcondition: [what holds after execution]
// Time complexity: O(?) — [case specification]
// Space complexity: O(?) — [auxiliary space]
```

---

## 10. Compliance Checklist

- [ ] Procedure names are in CAPS or Small-Caps
- [ ] Indentation used consistently for block structure
- [ ] `=` used for assignment, `==` for comparison
- [ ] Array indexing basis (0 or 1) is explicitly stated
- [ ] `NIL` used for null values
- [ ] Loop type chosen appropriately (for/while/repeat-until)
- [ ] Loop invariant stated for all loops in correctness proofs
- [ ] Preconditions and postconditions documented
- [ ] Time and space complexity stated
- [ ] Comments use `//` notation
- [ ] Arithmetic uses mathematical notation (⌊⌋, ⌈⌉, mod)
- [ ] Algorithm terminates for all valid inputs (termination argument)

---

## 11. Official Examples

### 11.1 Insertion Sort (CLRS §2.1)

```
INSERTION-SORT(A, n)
1  for i = 2 to n
2      key = A[i]
3      // Insert A[i] into the sorted subarray A[1 : i-1].
4      j = i - 1
5      while j > 0 and A[j] > key
6          A[j + 1] = A[j]
7          j = j - 1
8      A[j + 1] = key
```

**Loop invariant**: At the start of each iteration of the **for** loop, the subarray A[1..i-1] consists of the elements originally in A[1..i-1], but in sorted order.

**Python (0-based):**

```python
def insertion_sort(A):
    n = len(A)
    for i in range(1, n):          # i = 2 to n (1-based) → 1 to n-1 (0-based)
        key = A[i]
        j = i - 1
        while j >= 0 and A[j] > key:
            A[j + 1] = A[j]
            j -= 1
        A[j + 1] = key
    return A
```

### 11.2 Binary Search (CLRS §2.3, exercise)

```
BINARY-SEARCH(A, n, x)
1  low = 1
2  high = n
3  while low ≤ high
4      mid = ⌊(low + high) / 2⌋
5      if x == A[mid]
6          return mid
7      elseif x > A[mid]
8          low = mid + 1
9      else high = mid - 1
10 return NIL
```

**Time complexity**: O(log n)
**Space complexity**: O(1)

### 11.3 Merge Sort (CLRS §2.3)

```
MERGE-SORT(A, p, r)
1  if p ≥ r                           // zero or one element?
2      return
3  q = ⌊(p + r) / 2⌋                 // midpoint
4  MERGE-SORT(A, p, q)                // sort left half
5  MERGE-SORT(A, q + 1, r)            // sort right half
6  MERGE(A, p, q, r)                  // merge sorted halves

MERGE(A, p, q, r)
1  nL = q - p + 1                     // length of A[p..q]
2  nR = r - q                         // length of A[q+1..r]
3  let L[1..nL] and R[1..nR] be new arrays
4  for i = 1 to nL
5      L[i] = A[p + i - 1]
6  for j = 1 to nR
7      R[j] = A[q + j]
8  i = 1
9  j = 1
10 k = p
11 while i ≤ nL and j ≤ nR
12     if L[i] ≤ R[j]
13         A[k] = L[i]
14         i = i + 1
15     else A[k] = R[j]
16         j = j + 1
17     k = k + 1
18 while i ≤ nL
19     A[k] = L[i]
20     i = i + 1
21     k = k + 1
22 while j ≤ nR
23     A[k] = R[j]
24     j = j + 1
25     k = k + 1
```

**Recurrence**: T(n) = 2T(n/2) + Θ(n)
**Solution by Master Theorem**: T(n) = Θ(n log n)

### 11.4 Heap Operations (CLRS §6)

```
MAX-HEAPIFY(A, i)
1  l = LEFT(i)
2  r = RIGHT(i)
3  if l ≤ A.heap-size and A[l] > A[i]
4      largest = l
5  else largest = i
6  if r ≤ A.heap-size and A[r] > A[largest]
7      largest = r
8  if largest ≠ i
9      exchange A[i] with A[largest]
10     MAX-HEAPIFY(A, largest)

LEFT(i)   return 2i
RIGHT(i)  return 2i + 1
PARENT(i) return ⌊i / 2⌋
```

---

## 12. Related Topics

| Topic                    | Relationship                                                     | Location                     |
|--------------------------|------------------------------------------------------------------|------------------------------|
| Language Syntax          | Pseudocode has informal syntax inspired by formal grammars       | `../01-language-syntax/`     |
| Control Structures       | Pseudocode uses sequence, selection, iteration as primitives     | `../03-control-structures/`  |
| Functions / Recursion    | Procedure definition and recursion are core pseudocode constructs| `../04-functions/`           |
| Loop Invariants          | Formal correctness proofs for loops                             | CLRS §2.1                    |
| Big-O Complexity         | Complexity analysis accompanies all CLRS pseudocode              | CLRS §3; bigocheatsheet.com  |
| Sorting Algorithms       | Primary application of CLRS pseudocode conventions              | CLRS §2, §6, §7, §8          |
| Dynamic Programming      | CLRS pseudocode for DP problems (memoization tables)            | CLRS §14–15                  |
| Graph Algorithms         | BFS, DFS, Dijkstra in CLRS pseudocode                           | CLRS §20–24                  |
