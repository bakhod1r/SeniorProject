# Control Structures — Specification

> **Official / Authoritative Reference**
> Source: [Böhm & Jacopini (1966) "Flow Diagrams, Turing Machines and Languages with Only Two Formation Rules"](https://doi.org/10.1145/355588.365230) — Communications of the ACM, 9(5):366–371;
> [Dijkstra (1968) "Go To Statement Considered Harmful"](https://doi.org/10.1145/362929.362947) — Comm. ACM, 11(3):147–148;
> [CLRS 4th ed.](https://mitpress.mit.edu/9780262046305/) — §2–3 (algorithmic control flow);
> [Python Language Reference §8 — Compound Statements](https://docs.python.org/3/reference/compound_stmts.html)

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
| Formal Name     | Control Structures / Control Flow Statements                                        |
| Theorem         | Böhm-Jacopini Theorem (1966) — also called the "structured program theorem"         |
| Primary Source  | Böhm, C. & Jacopini, G. (1966). CACM 9(5), pp. 366–371.                            |
| Advocate        | Dijkstra, E.W. (1968). "Go To Statement Considered Harmful." CACM 11(3), pp. 147–148|
| Standard        | ISO/IEC 9899 (C), Java Language Specification §14, Python Language Reference §8    |

The **Böhm-Jacopini theorem** states:
> Any algorithm expressible as a flowchart can be expressed using only three control structures: **sequence**, **selection**, and **iteration**.

This forms the theoretical foundation of **structured programming**.

---

## 2. Formal Definition / Grammar

### 2.1 Formal Operational Semantics

Using **small-step operational semantics** (SOS notation, Plotkin style):

Let:
- `S` = statement
- `B` = boolean expression
- `E` = expression
- `σ` = program state (mapping from variable names to values)
- `⟨S, σ⟩ → σ'` = "Statement S in state σ reduces to state σ'"

**Sequence:**
```
⟨S₁, σ⟩ → σ'     ⟨S₂, σ'⟩ → σ''
──────────────────────────────────── [SEQ]
    ⟨S₁; S₂, σ⟩ → σ''
```

**Selection (if-then-else):**
```
B(σ) = true     ⟨S₁, σ⟩ → σ'
───────────────────────────────── [IF-TRUE]
  ⟨if B then S₁ else S₂, σ⟩ → σ'

B(σ) = false     ⟨S₂, σ⟩ → σ'
───────────────────────────────── [IF-FALSE]
  ⟨if B then S₁ else S₂, σ⟩ → σ'
```

**Iteration (while):**
```
B(σ) = false
─────────────────────────── [WHILE-FALSE]
⟨while B do S, σ⟩ → σ

B(σ) = true    ⟨S, σ⟩ → σ'    ⟨while B do S, σ'⟩ → σ''
─────────────────────────────────────────────────────────── [WHILE-TRUE]
              ⟨while B do S, σ⟩ → σ''
```

### 2.2 Python Grammar (Official — §8)

```peg
compound_stmt:
    | if_stmt
    | while_stmt
    | for_stmt
    | try_stmt
    | with_stmt
    | match_stmt
    | funcdef
    | classdef

if_stmt:
    | 'if' named_expr ':' block ('elif' named_expr ':' block)* ['else' ':' block]

while_stmt:
    | 'while' named_expr ':' block ['else' ':' block]

for_stmt:
    | 'for' star_targets 'in' star_expressions ':' [TYPE_COMMENT] block ['else' ':' block]

break_stmt:    'break'
continue_stmt: 'continue'
return_stmt:   'return' [star_expressions]
```

### 2.3 Abstract Syntax (EBNF)

```ebnf
statement    = simple_stmt | compound_stmt ;
compound_stmt = if_stmt | while_stmt | for_stmt | switch_stmt ;

if_stmt      = "if" "(" boolean_expr ")" block
               { "elseif" "(" boolean_expr ")" block }
               [ "else" block ] ;

while_stmt   = "while" "(" boolean_expr ")" block ;

for_stmt     = "for" "(" init ";" boolean_expr ";" update ")" block ;

do_while     = "do" block "while" "(" boolean_expr ")" ";" ;

switch_stmt  = "switch" "(" expr ")" "{"
               { "case" value ":" { statement } }
               [ "default" ":" { statement } ]
               "}" ;

block        = "{" { statement } "}" ;
```

---

## 3. Core Rules & Constraints

### 3.1 The Three Primitives (Böhm-Jacopini)

| Primitive    | Symbol        | Informal Meaning                         | Formal Meaning                          |
|--------------|---------------|------------------------------------------|-----------------------------------------|
| **Sequence** | S₁ ; S₂       | Do S₁, then do S₂                        | Execute S₁ to completion, then S₂       |
| **Selection**| if B then S₁ else S₂ | Choose S₁ or S₂ based on B        | Evaluate B; execute exactly one branch  |
| **Iteration**| while B do S  | Repeat S while B is true                 | Re-evaluate B before each S execution  |

**Completeness statement (Böhm-Jacopini 1966):**
> Any partial recursive function — and thus any computable function — can be implemented using only these three structures.

**Implication**: `goto`, `break`, `continue`, `return` (early), `throw/catch` are **syntactic conveniences**, not logical necessities. All are replaceable by the three primitives.

### 3.2 Structured vs Unstructured Programming

**Unstructured** (pre-1968): Uses `GOTO` to jump to arbitrary labels.

```basic
10 INPUT X
20 IF X > 0 THEN GOTO 50
30 PRINT "NEGATIVE"
40 GOTO 60
50 PRINT "POSITIVE"
60 END
```

**Structured** (post-Dijkstra): Uses only control structures.

```python
x = int(input())
if x > 0:
    print("POSITIVE")
else:
    print("NEGATIVE")
```

### 3.3 Termination

- **Sequence**: Always terminates if S₁ and S₂ terminate.
- **Selection**: Always terminates if the chosen branch terminates.
- **Iteration**: May **not terminate** (infinite loop). Termination requires a **decreasing function** (variant) — a non-negative integer expression that strictly decreases each iteration.

**Termination proof by variant**: Find `f(σ) ∈ ℕ` such that:
1. `B(σ) = true → f(σ) ≥ 1` (loop runs only when variant is positive)
2. After each iteration of S: `f(σ') < f(σ)` (variant strictly decreases)

Then the loop terminates in at most `f(σ₀)` iterations.

---

## 4. Type / Category Rules

### 4.1 Taxonomy of Control Structures

```
Control Structures
├── Sequential
│   └── Statement sequence (S₁; S₂; ...; Sₙ)
├── Conditional (Selection)
│   ├── if-then
│   ├── if-then-else
│   ├── if-elif-else (multi-way)
│   └── switch / match (multi-way, pattern-based)
├── Iterative (Repetition)
│   ├── while (pre-test)
│   ├── do-while (post-test)
│   ├── for (counter-controlled)
│   └── for-each / range-for (iterator-based)
└── Transfer of Control
    ├── break (exit loop)
    ├── continue (skip to next iteration)
    ├── return (exit function)
    └── goto (unconditional jump — unstructured)
```

### 4.2 Loop Classification

| Loop Type    | Test Position | Minimum Iterations | Syntax (Python/C)            |
|--------------|---------------|--------------------|------------------------------|
| `while`      | Pre-test      | 0                  | `while B: S`                 |
| `do-while`   | Post-test     | 1                  | `do S while B` (C/Java)      |
| `for` (C)    | Pre-test      | 0                  | `for(init; B; update) S`     |
| `for-each`   | Pre-test      | 0                  | `for x in iterable: S`       |
| `repeat-until`| Post-test    | 1                  | `repeat S until B` (Pascal)  |

**Equivalence**: All loop forms are reducible to `while`:

```
// do-while equivalence:
S;
while B do S;

// for equivalence:
init;
while B do { S; update; }

// for-each equivalence (using iterator):
it = iter(collection);
while it.has_next() do { x = it.next(); S; }
```

---

## 5. Behavioral Specification

### 5.1 Sequence

```python
# Formal: ⟨S₁; S₂, σ⟩ executes S₁ first, then S₂
x = 5       # S₁: assign 5 to x
y = x + 3   # S₂: compute x+3, assign to y
# State after: {x: 5, y: 8}
# S₂ cannot start before S₁ completes
```

**Key property**: Sequential composition is **associative**:
```
(S₁; S₂); S₃  ≡  S₁; (S₂; S₃)
```

### 5.2 Selection

**Short-circuit evaluation** — boolean expressions in conditions use short-circuit evaluation:
- `A and B`: if A is `false`, B is not evaluated
- `A or B`: if A is `true`, B is not evaluated

```python
# Safe: right side not evaluated if x is None
if x is not None and x.value > 0:
    process(x)
```

**Dangling else problem** (resolved by nearest-unmatched rule):
```c
// In C/Java, 'else' binds to nearest unmatched 'if':
if (a)
    if (b) S1;
    else S2;   // This else belongs to "if (b)", NOT "if (a)"

// Equivalent explicit form:
if (a) {
    if (b) S1;
    else S2;
}
```

### 5.3 Iteration

**Loop invariant** (formal correctness):

For `while B do S`:
- Let `I` be a predicate (the invariant)
- **Initialization**: `I(σ₀)` holds before the loop
- **Maintenance**: `I(σ) ∧ B(σ) → I(σ')` where `⟨S, σ⟩ → σ'`
- **Termination**: `I(σ) ∧ ¬B(σ) → PostCondition(σ)`

**Example: Sum of 1..n**

```python
def sum_to_n(n):
    # Precondition: n >= 0
    total = 0      # Initialize
    i = 1
    # Invariant: total = 0 + 1 + 2 + ... + (i-1) = i*(i-1)/2
    while i <= n:
        total += i  # Maintain: total becomes 1+2+...+i
        i += 1
    # Termination: i = n+1, so total = n*(n+1)/2
    return total    # Postcondition: total = n*(n+1)/2
```

### 5.4 Break and Continue Semantics

**`break`**: Immediately exits the innermost enclosing loop.
```
while B:
    if C: break    # Exits loop, skips remaining iterations
    S
```
Equivalent without break (using flag):
```
exit = False
while B and not exit:
    if C: exit = True
    else: S
```

**`continue`**: Skips remaining statements in current iteration; jumps to loop condition check.
```
for x in collection:
    if C: continue  # Skip to next iteration
    S
```
Equivalent without continue:
```
for x in collection:
    if not C:
        S
```

---

## 6. Defined vs Undefined Behavior

| Situation                              | Status      | Notes                                                    |
|----------------------------------------|-------------|----------------------------------------------------------|
| `if True: S1 else: S2`                 | Defined     | S1 always executes                                       |
| `if False: S1 else: S2`                | Defined     | S2 always executes                                       |
| `while True:` without `break`          | Defined     | Infinite loop; intentional in some contexts (event loops)|
| Modifying loop variable inside `for`   | Lang-specific| Python: iteration continues over original sequence      |
| `break` outside loop                   | Syntax error | Python/Java/C all reject this                           |
| `continue` outside loop                | Syntax error | Same                                                    |
| Integer overflow in loop counter       | Impl-defined | C: UB for signed; Python: arbitrary precision           |
| Division by zero in loop body          | Runtime error| ZeroDivisionError (Python), ArithmeticException (Java)  |
| Empty loop body                        | Defined     | Legal; loop iterates but does nothing                    |
| Nested loops > 1000 levels             | Impl-defined | Stack depth / compiler limit varies                     |

---

## 7. Edge Cases

### 7.1 Empty Ranges

```python
for i in range(0):   # Never executes; range(0) is empty
    print(i)

for i in range(5, 3): # Never executes; start > stop with default step
    print(i)
```

### 7.2 Mutation During Iteration

```python
# DANGEROUS: modifying list while iterating
lst = [1, 2, 3, 4]
for x in lst:
    if x == 2:
        lst.remove(x)   # Skips element 3!
# Result: [1, 3, 4] — NOT [1, 3, 4] but misses items

# SAFE: iterate over a copy
for x in lst[:]:
    if x == 2:
        lst.remove(x)
```

### 7.3 Nested Loop Variable Shadowing

```python
for i in range(3):
    for i in range(2):  # Shadows outer 'i'
        print(i)
# Outer 'i' is overwritten; behavior may be unexpected
```

### 7.4 Off-by-One Errors

Classic fencepost error:

```python
# WRONG: n iterations but i goes 0..n-1, range should be range(n)
for i in range(1, n):   # Only n-1 iterations!
    process(A[i])

# CORRECT:
for i in range(n):      # n iterations: i = 0, 1, ..., n-1
    process(A[i])

# CLRS 1-based (n iterations):
for i in range(1, n+1): # i = 1, 2, ..., n
    process(A[i-1])     # Convert to 0-based for Python array
```

### 7.5 Short-Circuit in Loops

```python
while i < n and A[i] != target:  # If i >= n, A[i] is NOT evaluated
    i += 1                        # Prevents IndexError
```

---

## 8. Version / Evolution History

| Year | Event                                                                                   |
|------|-----------------------------------------------------------------------------------------|
| 1945 | Konrad Zuse's Plankalkül — first formal language with conditional and loop constructs   |
| 1957 | FORTRAN — first compiled language; uses `IF`, `DO` loops and `GOTO`                   |
| 1958 | ALGOL 58 — introduces block structure; inspires structured programming                 |
| 1960 | ALGOL 60 — `if-then-else`, `for`, `while`; formal syntax definition                  |
| 1966 | **Böhm-Jacopini theorem** published — proves goto is unnecessary                       |
| 1968 | **Dijkstra "Go To Statement Considered Harmful"** — triggers structured programming movement |
| 1969 | Hoare Logic published — formal correctness proofs using pre/post conditions            |
| 1972 | C language — structured control flow; `goto` retained but discouraged                 |
| 1974 | Knuth "Structured Programming with go to Statements" — nuanced view; some gotos valid  |
| 1983 | C++ inherits C control structures; adds `try-catch`                                    |
| 1991 | Python 1.0 — `for-in` over sequences; `while`, `if-elif-else`                         |
| 1995 | Java — no `goto` keyword (reserved but unused); `break/continue` with labels          |
| 2006 | Python 2.5 — `try-except-else-finally` fully defined                                  |
| 2020 | Python 3.10 — `match-case` structural pattern matching (PEP 634)                      |

---

## 9. Implementation Notes

### 9.1 Machine Code Mapping

| Control Structure    | Machine Code Pattern                        | Assembly Instruction    |
|----------------------|---------------------------------------------|-------------------------|
| Sequence             | Sequential instructions                     | MOV, ADD, etc.          |
| if-then-else         | Conditional jump + code blocks              | CMP + JE/JNE/JGT/etc.  |
| while                | Back-edge jump + condition check at top     | CMP + JGT (exit) + JMP  |
| for                  | Init + condition + body + increment + jump  | Same as while           |
| break                | Unconditional jump past loop exit label     | JMP (exit_label)        |
| continue             | Unconditional jump to loop condition        | JMP (condition_label)   |
| switch/match         | Jump table or binary search                 | JMP table[i]            |

### 9.2 Flowchart Symbols (ISO 5807)

| Symbol      | Shape           | Represents              |
|-------------|-----------------|-------------------------|
| Rectangle   | □               | Process / Statement     |
| Diamond     | ◇               | Decision (condition)    |
| Rounded rect| ⬭              | Start / End             |
| Parallelogram| ▱             | Input / Output          |
| Arrow       | →               | Flow of control         |

**Flowchart for while loop:**
```
         ┌──────────────┐
         │  Start       │
         └──────┬───────┘
                ↓
         ┌──────────────┐
    ┌────►  B true?      │
    │    └──┬───────┬───┘
    │     Yes       No
    │       ↓       ↓
    │   ┌───────┐  End
    │   │  S    │
    │   └───┬───┘
    └────────┘
```

### 9.3 Complexity Impact of Control Structures

| Pattern                               | Time Complexity | Notes                              |
|---------------------------------------|-----------------|------------------------------------|
| Simple sequence of n ops              | O(n)            | Linear in statements               |
| if-else with O(f(n)) branches         | O(f(n))         | Max of branch complexities         |
| while with O(g(n)) iterations, O(h(n)) body | O(g(n)·h(n)) | Product of iterations and body |
| Nested loops (k levels, n each)       | O(nᵏ)           | Exponential in nesting depth       |
| Loop with halving condition           | O(log n)        | E.g., binary search                |

```python
# O(n²) — nested loops:
for i in range(n):          # n iterations
    for j in range(n):      # n iterations
        process(A[i][j])    # O(1) work

# O(n log n) — outer linear, inner logarithmic:
for i in range(n):          # n iterations
    j = 1
    while j < n:            # log n iterations
        process(j)
        j *= 2
```

### 9.4 Python `else` on Loops

Python's unique `for-else` and `while-else` constructs:

```python
# The 'else' clause runs if the loop completed without 'break'
for x in sequence:
    if condition(x):
        result = x
        break
else:
    # Runs only if loop did NOT break (i.e., condition was never true)
    result = None

# Equivalent structure:
found = False
for x in sequence:
    if condition(x):
        result = x
        found = True
        break
if not found:
    result = None
```

---

## 10. Compliance Checklist

- [ ] Sequence: statements execute in written order; no parallelism assumed
- [ ] Selection: all branches are explicitly handled (consider `else` for exhaustive matching)
- [ ] Iteration: loop termination is proven or argued (variant function exists)
- [ ] Loop invariant is stated for all non-trivial loops
- [ ] No unreachable code (dead code after `return`, `break`, or always-false condition)
- [ ] No infinite loops without explicit intent (event loops must be documented)
- [ ] Nested loop variables use distinct names to avoid shadowing
- [ ] Off-by-one errors checked: loop bounds `range(n)` vs `range(1, n+1)` vs `range(n-1)`
- [ ] `break` and `continue` used only inside loops
- [ ] Short-circuit evaluation used defensively for null-check guards
- [ ] Mutation of data structure during iteration avoided (or explicitly handled)
- [ ] `switch`/`match` includes `default`/`case _` branch

---

## 11. Official Examples

### 11.1 Python — Complete Control Flow Examples

```python
# 1. SEQUENCE
a = 10
b = 20
c = a + b          # Sequentially after assignments

# 2. SELECTION — if-elif-else
def classify_grade(score):
    """Classify a score into a letter grade."""
    if score >= 90:
        return 'A'
    elif score >= 80:
        return 'B'
    elif score >= 70:
        return 'C'
    elif score >= 60:
        return 'D'
    else:
        return 'F'

# 3. ITERATION — while with invariant
def gcd(a, b):
    """
    Euclidean GCD algorithm.
    Precondition: a >= 0, b >= 0, not both zero
    Loop invariant: gcd(a, b) = gcd(original_a, original_b)
    Termination: b strictly decreases each iteration
    """
    while b != 0:
        a, b = b, a % b   # Sequence within loop body
    return a

# 4. ITERATION — for with range
def factorial(n):
    """
    Iterative factorial.
    Loop invariant: result = (i-1)! at start of iteration i
    """
    result = 1
    for i in range(2, n + 1):   # i = 2 to n
        result *= i
    return result

# 5. NESTED LOOPS — matrix multiplication
def matrix_multiply(A, B):
    """
    Multiply n×n matrices A and B.
    Time: O(n³), Space: O(n²)
    """
    n = len(A)
    C = [[0] * n for _ in range(n)]
    for i in range(n):           # Row of A
        for j in range(n):       # Column of B
            for k in range(n):   # Dot product
                C[i][j] += A[i][k] * B[k][j]
    return C
```

### 11.2 Java — Control Structures

```java
// Selection: switch-case (Java 14+ enhanced switch)
public String dayType(int day) {
    return switch (day) {
        case 1, 7 -> "Weekend";
        case 2, 3, 4, 5, 6 -> "Weekday";
        default -> throw new IllegalArgumentException("Invalid day: " + day);
    };
}

// Iteration: do-while (post-test — guaranteed at least one execution)
public int readPositive(Scanner scanner) {
    int value;
    do {
        System.out.print("Enter a positive number: ");
        value = scanner.nextInt();
    } while (value <= 0);
    return value;
}

// Nested loop with labeled break
outer:
for (int i = 0; i < n; i++) {
    for (int j = 0; j < n; j++) {
        if (A[i][j] == target) {
            System.out.printf("Found at (%d, %d)%n", i, j);
            break outer;   // Exits both loops
        }
    }
}
```

### 11.3 CLRS-Style Pseudocode — Linear Search

```
LINEAR-SEARCH(A, n, x)
// Precondition: A has n elements
// Postcondition: returns index i such that A[i] = x, or NIL
1  for i = 1 to n
2      if A[i] == x
3          return i
4  return NIL

// Loop invariant: at start of iteration i,
// x does not appear in A[1..i-1]
// Time: O(n) worst case, O(1) best case
```

---

## 12. Related Topics

| Topic                   | Relationship                                                      | Location                    |
|-------------------------|-------------------------------------------------------------------|-----------------------------|
| Language Syntax         | Control structures are defined by the grammar's compound_stmt    | `../01-language-syntax/`    |
| Pseudocode              | CLRS pseudocode uses these three primitives directly             | `../02-pseudo-code/`        |
| Functions               | Function body is a sequence; return is a control transfer        | `../04-functions/`          |
| Loop Invariants         | Formal proofs of loop correctness                                | CLRS §2.1                   |
| Recursion               | Alternative to iteration; always interconvertible               | `../04-functions/`          |
| Boolean Algebra         | Conditions in selection and iteration                            | CLRS Appendix A             |
| Sorting Algorithms      | Demonstrate all three control structures                         | CLRS §2, §6–8               |
| Complexity Analysis     | Loop structure determines time complexity class                  | CLRS §3; bigocheatsheet.com |
| Compilers               | Control structures compile to conditional jumps and back-edges   | Aho et al. "Dragon Book" §8 |
| Structured Programming  | Paradigm built on these three primitives                        | Dijkstra (1968)             |
