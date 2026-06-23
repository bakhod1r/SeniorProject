# Python Loops — Language Specification

## 1. Spec Reference

- **Primary source:** Python Language Reference, §8.3 — The `for` statement
  https://docs.python.org/3/reference/compound_stmts.html#the-for-statement
- **§8.2 — The `while` statement**
  https://docs.python.org/3/reference/compound_stmts.html#the-while-statement
- **§7.9 — `break` statement:** https://docs.python.org/3/reference/simple_stmts.html#the-break-statement
- **§7.10 — `continue` statement:** https://docs.python.org/3/reference/simple_stmts.html#the-continue-statement
- **Iterator protocol:** §3.4.2 — https://docs.python.org/3/reference/datamodel.html#object.__iter__
- **Generator expressions:** §6.2.8 — https://docs.python.org/3/reference/expressions.html#generator-expressions
- **Python 3.12 standard:** All rules here apply to CPython 3.12 unless otherwise noted.

---

## 2. Formal Grammar (EBNF)

### 2.1 `while` Statement
```
while_stmt ::= "while" assignment_expression ":" suite
               ["else" ":" suite]
```

### 2.2 `for` Statement
```
for_stmt   ::= "for" target_list "in" starred_list ":" suite
               ["else" ":" suite]
```

### 2.3 `break` Statement
```
break_stmt ::= "break"
```

### 2.4 `continue` Statement
```
continue_stmt ::= "continue"
```

### 2.5 Generator Expression (inline iteration)
```
generator_expression ::= "(" expression comp_for ")"
comp_for             ::= ["async"] "for" target_list "in" or_test [comp_iter]
comp_iter            ::= comp_for | comp_if
comp_if              ::= "if" or_test [comp_iter]
```

### 2.6 Comprehensions
```
list_display        ::= "[" [starred_list | comprehension] "]"
set_display         ::= "{" (starred_list | comprehension) "}"
dict_display        ::= "{" [key_datum_list | dict_comprehension] "}"
dict_comprehension  ::= expression ":" expression comp_for
comprehension       ::= assignment_expression comp_for
```

---

## 3. Core Rules and Constraints

### 3.1 `for` Loop Semantics
- The iterable expression is evaluated **once** before the loop begins.
- Each iteration calls `__next__()` on the iterator; `StopIteration` ends the loop.
- Modifying a mutable sequence during iteration over it is **undefined behavior** (see §6).
- The loop variable(s) remain bound after the loop; they hold the value from the last iteration.
- If the iterable is empty, the `for` body is not executed and the `else` clause (if present) runs.

### 3.2 `while` Loop Semantics
- Condition is evaluated before each iteration.
- If condition is falsy on first check, the body is never executed.
- The `else` clause executes after the loop exits normally (condition became falsy).
- The `else` clause does **not** execute if the loop exits via `break`.

### 3.3 `else` Clause on Loops
- Both `for` and `while` support an `else` clause.
- The `else` clause runs if the loop completed without `break` being executed.
- Useful for "search" patterns: execute `else` when the searched item was not found.
- `continue` does not suppress the `else` clause.

### 3.4 `break` Statement
- Immediately exits the innermost `for` or `while` loop.
- The loop's `else` clause is **skipped** when `break` exits the loop.
- Can only appear inside a loop; `break` outside a loop is a `SyntaxError`.
- `break` in a `try` block: `finally` clause still executes before the loop is exited.

### 3.5 `continue` Statement
- Skips the rest of the current iteration and continues with the next.
- For `for` loops: advances the iterator.
- For `while` loops: re-evaluates the condition.
- The `else` clause is unaffected by `continue`.
- Can only appear inside a loop; `continue` outside a loop is a `SyntaxError`.

### 3.6 Loop Variable Scope
- Loop variables in `for` loops are **not** scoped to the loop; they persist in the enclosing scope.
- In comprehensions (Python 3), the iteration variable is **local** to the comprehension.
- `for i in range(3): pass` — `i` is bound to `2` after the loop.

### 3.7 Nested Loops
- `break` and `continue` only affect the **innermost** enclosing loop.
- To break out of multiple nested loops, use a flag variable, a function with `return`, or `for...else` patterns.

---

## 4. Type Rules (Dunder Methods and Protocols)

### 4.1 Iterator Protocol
```python
# An iterable defines:
object.__iter__(self) -> iterator
# Returns an iterator object.

# An iterator defines:
object.__iter__(self) -> self        # iterators must return themselves
object.__next__(self) -> value
# Returns next value or raises StopIteration when exhausted.
```

### 4.2 `for` Loop Protocol Steps
1. Call `iter(obj)` → calls `obj.__iter__()` → returns an iterator `it`.
2. Repeatedly call `next(it)` → calls `it.__next__()`.
3. When `StopIteration` is raised, the loop terminates normally.

### 4.3 `__reversed__` Protocol
```python
object.__reversed__(self) -> iterator
# Called by reversed(); if not defined, reversed() falls back to
# using __len__ and __getitem__ with decreasing indices.
```

### 4.4 Async Iteration Protocol (PEP 492)
```python
object.__aiter__(self) -> async_iterator
object.__anext__(self) -> coroutine  # raises StopAsyncIteration when done
# Used by 'async for' loops in async functions.
```

### 4.5 Generator Protocol
```python
# A generator function contains 'yield'; calling it returns a generator object.
# Generator objects implement the iterator protocol automatically.
generator.__next__()   # equivalent to next(generator)
generator.send(value)  # sends value to yield expression
generator.throw(type)  # raises exception at the yield point
generator.close()      # raises GeneratorExit at the yield point
```

---

## 5. Behavioral Specification

### 5.1 `for` Loop Execution Steps
1. Evaluate the iterable expression → `iter_obj`.
2. Call `iter(iter_obj)` to get iterator `it`.
3. **Start of each iteration:** call `next(it)`.
   - If `StopIteration`: exit loop, run `else` (if present), done.
   - Otherwise: bind the returned value to the target(s), execute loop body.
4. After loop body: go to step 3.
5. `break` encountered: exit immediately, skip `else`.
6. `continue` encountered: go to step 3 immediately.

### 5.2 `while` Loop Execution Steps
1. Evaluate condition.
2. If falsy: run `else` (if present), done.
3. Execute loop body.
4. `break` encountered: exit immediately, skip `else`.
5. `continue` encountered: go to step 1.
6. Otherwise: go to step 1.

### 5.3 Comprehension Scoping (Python 3)
- List, set, dict comprehensions and generator expressions are compiled as nested functions.
- The iteration variable is **local** to the comprehension scope.
- The outermost iterable expression is evaluated in the enclosing scope; inner iterables are evaluated inside.

```python
x = 10
squares = [x**2 for x in range(5)]  # x in comprehension is local
print(x)      # 10 — unchanged (Python 3 behavior)
```

### 5.4 `range` Object
- `range(stop)`, `range(start, stop)`, `range(start, stop, step)`.
- `range` objects are **lazy** — they do not create a list.
- Support `len()`, indexing, slicing, membership test (`in`), and `reversed()`.
- Step may be negative; step of 0 raises `ValueError`.

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined
- `StopIteration` signals iterator exhaustion; it is caught by `for` loops and generator machinery.
- Loop variable binds the **last** value after normal loop completion.
- `else` on a loop runs if and only if `break` was not executed.
- `continue` does not affect `else`.
- `break` inside `try`/`finally` still executes `finally`.

### 6.2 Undefined / Implementation-Defined
- **Mutating a list during iteration:** CPython iterates by integer index. Adding elements may repeat them; removing elements may skip them. The spec does not define behavior for mutation during iteration.
- **Dictionary iteration order:** Since Python 3.7, `dict` preserves insertion order (CPython implementation detail promoted to spec). Mutating a dict during iteration raises `RuntimeError` in CPython 3.3+.
- **Generator `StopIteration` propagation:** Since Python 3.7 (PEP 479), `StopIteration` raised inside a generator is converted to `RuntimeError`. This was a breaking change.

---

## 7. Edge Cases from the Spec (CPython-Specific Notes)

### 7.1 Loop Variable Persists After Loop
```python
for i in range(5):
    pass
print(i)   # 4 — i is bound to last value

for x in []:
    pass
# print(x)   # NameError if x was not previously defined — loop body never ran
```

### 7.2 Modifying a List During Iteration
```python
data = [1, 2, 3, 4, 5]
for item in data:
    if item == 2:
        data.remove(item)   # DANGER: may skip element 3
print(data)   # [1, 3, 4, 5]  — but skipped 3 during iteration

# Safe approach: iterate over a copy
for item in data[:]:
    ...
```

### 7.3 `else` Clause for Search Pattern
```python
def find_prime(lst):
    for n in lst:
        for d in range(2, n):
            if n % d == 0:
                break
        else:
            return n   # only reached if no 'break' in inner loop
    return None

print(find_prime([4, 6, 7, 10]))   # 7
```

### 7.4 `StopIteration` in Generators (PEP 479)
```python
# Python 3.7+: StopIteration inside generator becomes RuntimeError
def bad_gen():
    yield 1
    raise StopIteration   # This becomes RuntimeError in Python 3.7+

import sys
gen = bad_gen()
next(gen)  # 1
try:
    next(gen)
except RuntimeError as e:
    print(f"RuntimeError: {e}")
```

### 7.5 Generator Lazy Evaluation
```python
def counter(start=0):
    n = start
    while True:
        yield n
        n += 1

gen = counter()
print(next(gen))   # 0
print(next(gen))   # 1
print(next(gen))   # 2
```

### 7.6 Comprehension vs Loop Variable Scope
```python
# Python 3: comprehension variable is local
result = [i * 2 for i in range(5)]
# 'i' is NOT accessible here (NameError if not previously defined)

# Python 2 LEGACY (not Python 3): was accessible — known as "variable leakage"
```

### 7.7 `break` with `finally`
```python
for i in range(3):
    try:
        if i == 1:
            break
    finally:
        print(f"finally: {i}")
# Output:
# finally: 0
# finally: 1   <- finally still runs even when break exits loop
```

---

## 8. Version History (PEPs and Python Versions)

| Feature | PEP | Version |
|---------|-----|---------|
| `for`/`while`/`break`/`continue` | — | Python 1.0 |
| `else` clause on loops | — | Python 1.0 |
| Generator functions (`yield`) | PEP 255 | Python 2.2 |
| Generator expressions | PEP 289 | Python 2.4 |
| Comprehension scoping (local variables) | — | Python 3.0 |
| `yield from` | PEP 380 | Python 3.3 |
| `async for` | PEP 492 | Python 3.5 |
| `StopIteration` → `RuntimeError` in generators | PEP 479 | Python 3.7 |
| `dict` insertion-order guarantee (in spec) | — | Python 3.7 |
| `walrus` in comprehensions | PEP 572 | Python 3.8 |
| `zip(..., strict=True)` | PEP 618 | Python 3.10 |
| `itertools.pairwise` | — | Python 3.10 |
| `itertools.batched` | — | Python 3.12 |

---

## 9. Implementation-Specific Behavior

### 9.1 CPython `for` Loop Bytecode
- CPython generates `GET_ITER` (calls `__iter__`) then `FOR_ITER` (calls `__next__` and jumps on `StopIteration`).
- `FOR_ITER` is a tightly optimized bytecode instruction.
- Internal list iteration uses `listiterobject` which accesses the underlying array directly (no Python-level `__next__` call overhead).

### 9.2 CPython `range` Optimization
- `range` objects have a C-level iterator that generates values on demand without Python object allocation per iteration.
- `for i in range(n)` is significantly faster than `for i in list(range(n))`.

### 9.3 Generator Frame Suspension
- CPython stores generator state in a frame object; `yield` suspends the frame.
- Each `next()` call resumes the frame from the last yield point.
- Generator frames consume memory until the generator is exhausted or garbage collected.

### 9.4 PyPy
- JIT-compiled loops achieve near-C speed for numeric-heavy loops.
- Loop unrolling and trace compilation are performed automatically.
- `range` iteration benefits most from JIT warm-up.

---

## 10. Spec Compliance Checklist

- [ ] `for` loop does not modify the iterable during iteration
- [ ] `break` and `continue` only inside loops (no `SyntaxError`)
- [ ] `else` on loops understood: runs only when no `break`
- [ ] Iterator protocol: `__iter__` returns self, `__next__` raises `StopIteration`
- [ ] Comprehension variables understood as local (Python 3)
- [ ] `StopIteration` in generators raises `RuntimeError` (Python 3.7+, PEP 479)
- [ ] `dict` iteration considers that mutations raise `RuntimeError`
- [ ] `finally` runs even when `break` exits a `try` block inside a loop
- [ ] Loop variable is accessible after loop (holds last value)
- [ ] `async for` used only inside `async def` functions

---

## 11. Official Examples (Runnable Python 3.10+)

```python
# ----------------------------------------------------------------
# 1. Basic for loop with range
# ----------------------------------------------------------------
for i in range(5):
    print(i, end=" ")   # 0 1 2 3 4
print()


# ----------------------------------------------------------------
# 2. for loop over sequence
# ----------------------------------------------------------------
fruits = ["apple", "banana", "cherry"]
for fruit in fruits:
    print(fruit)


# ----------------------------------------------------------------
# 3. for loop with enumerate
# ----------------------------------------------------------------
for idx, fruit in enumerate(fruits, start=1):
    print(f"{idx}. {fruit}")
# 1. apple
# 2. banana
# 3. cherry


# ----------------------------------------------------------------
# 4. while loop
# ----------------------------------------------------------------
n = 1
while n < 32:
    n *= 2
print(n)   # 32


# ----------------------------------------------------------------
# 5. while with else
# ----------------------------------------------------------------
x = 10
while x > 0:
    x -= 3
else:
    print(f"Loop done, x = {x}")   # x = -2


# ----------------------------------------------------------------
# 6. break — exit early
# ----------------------------------------------------------------
for i in range(10):
    if i == 5:
        break
    print(i, end=" ")   # 0 1 2 3 4
print()


# ----------------------------------------------------------------
# 7. continue — skip iteration
# ----------------------------------------------------------------
for i in range(10):
    if i % 2 == 0:
        continue
    print(i, end=" ")   # 1 3 5 7 9
print()


# ----------------------------------------------------------------
# 8. for...else search pattern
# ----------------------------------------------------------------
def find_in(lst, target):
    for item in lst:
        if item == target:
            print(f"Found: {target}")
            break
    else:
        print(f"Not found: {target}")

find_in([1, 2, 3], 2)    # Found: 2
find_in([1, 2, 3], 9)    # Not found: 9


# ----------------------------------------------------------------
# 9. Nested loops with break (only inner loop)
# ----------------------------------------------------------------
for i in range(3):
    for j in range(3):
        if j == 1:
            break
    print(f"i={i}, j={j}")   # j=1 for each i


# ----------------------------------------------------------------
# 10. Generator function
# ----------------------------------------------------------------
def fibonacci():
    a, b = 0, 1
    while True:
        yield a
        a, b = b, a + b

fib = fibonacci()
print([next(fib) for _ in range(10)])
# [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]


# ----------------------------------------------------------------
# 11. Comprehensions (all create local scope for variables)
# ----------------------------------------------------------------
squares = [x**2 for x in range(10)]
evens   = [x for x in range(20) if x % 2 == 0]
pairs   = [(x, y) for x in range(3) for y in range(3) if x != y]
sq_set  = {x**2 for x in range(-5, 6)}
sq_dict = {x: x**2 for x in range(5)}

print(squares[:5])   # [0, 1, 4, 9, 16]
print(sq_dict)       # {0: 0, 1: 1, 2: 4, 3: 9, 4: 16}


# ----------------------------------------------------------------
# 12. zip (Python 3.10+ strict=True)
# ----------------------------------------------------------------
names = ["Alice", "Bob", "Carol"]
scores = [95, 87, 92]
for name, score in zip(names, scores, strict=True):
    print(f"{name}: {score}")


# ----------------------------------------------------------------
# 13. zip and enumerate together
# ----------------------------------------------------------------
pairs_indexed = list(enumerate(zip(names, scores), start=1))
print(pairs_indexed)
# [(1, ('Alice', 95)), (2, ('Bob', 87)), (3, ('Carol', 92))]


# ----------------------------------------------------------------
# 14. iter() with sentinel (two-argument form)
# ----------------------------------------------------------------
import io
stream = io.StringIO("line1\nline2\nSTOP\nline3\n")
for line in iter(stream.readline, "STOP\n"):
    print(repr(line))   # 'line1\n', 'line2\n'


# ----------------------------------------------------------------
# 15. walrus in while loop
# ----------------------------------------------------------------
import re
text = "abc123def456ghi789"
pos = 0
while m := re.search(r"\d+", text[pos:]):
    print(m.group())
    pos += m.end()
# 123
# 456
# 789
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| §8.2 | `while` statement | https://docs.python.org/3/reference/compound_stmts.html#the-while-statement |
| §8.3 | `for` statement | https://docs.python.org/3/reference/compound_stmts.html#the-for-statement |
| §7.9 | `break` statement | https://docs.python.org/3/reference/simple_stmts.html#the-break-statement |
| §7.10 | `continue` statement | https://docs.python.org/3/reference/simple_stmts.html#the-continue-statement |
| §3.4.2 | `__iter__` protocol | https://docs.python.org/3/reference/datamodel.html#object.__iter__ |
| §6.2.8 | Generator expressions | https://docs.python.org/3/reference/expressions.html#generator-expressions |
| §6.2.9 | Yield expressions | https://docs.python.org/3/reference/expressions.html#yield-expressions |
| `range` | Built-in range object | https://docs.python.org/3/library/stdtypes.html#range |
| `itertools` | Iterator building blocks | https://docs.python.org/3/library/itertools.html |
| PEP 255 | Generator functions | https://peps.python.org/pep-0255/ |
| PEP 289 | Generator expressions | https://peps.python.org/pep-0289/ |
| PEP 479 | StopIteration in generators | https://peps.python.org/pep-0479/ |
| PEP 492 | Async for / async with | https://peps.python.org/pep-0492/ |
| PEP 572 | Walrus operator | https://peps.python.org/pep-0572/ |
