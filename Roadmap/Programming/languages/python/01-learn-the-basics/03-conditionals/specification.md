# Python Conditionals — Language Specification

## 1. Spec Reference

- **Primary source:** Python Language Reference, §8.1 — The `if` statement
  https://docs.python.org/3/reference/compound_stmts.html#the-if-statement
- **Boolean operations:** §6.12 — https://docs.python.org/3/reference/expressions.html#boolean-operations
- **Comparisons:** §6.10 — https://docs.python.org/3/reference/expressions.html#comparisons
- **`match` statement (structural pattern matching):** §8.6
  https://docs.python.org/3/reference/compound_stmts.html#the-match-statement
- **Python 3.12 standard:** All rules here apply to CPython 3.12 unless otherwise noted.

---

## 2. Formal Grammar (EBNF)

### 2.1 `if` Statement
```
if_stmt   ::= "if" assignment_expression ":" suite
              ("elif" assignment_expression ":" suite)*
              ["else" ":" suite]
suite     ::= stmt_list NEWLINE | NEWLINE INDENT statement+ DEDENT
stmt_list ::= simple_stmt (";" simple_stmt)* [";"]
```

### 2.2 Conditional Expression (Ternary)
```
conditional_expression ::= or_test ["if" or_test "else" expression]
expression             ::= conditional_expression | lambda_expr
```

### 2.3 Boolean Operations
```
or_test  ::= and_test | or_test "or" and_test
and_test ::= not_test | and_test "and" not_test
not_test ::= comparison | "not" not_test
```

### 2.4 Comparisons
```
comparison    ::= or_expr (comp_operator or_expr)*
comp_operator ::= "<" | ">" | "==" | ">=" | "<=" | "!="
                | "is" ["not"] | ["not"] "in"
```

### 2.5 Structural Pattern Matching (Python 3.10+)
```
match_stmt   ::= "match" subject_expr ":" NEWLINE INDENT case_block+ DEDENT
case_block   ::= "case" patterns [guard] ":" block
patterns     ::= open_sequence_pattern | pattern
pattern      ::= as_pattern | or_pattern
as_pattern   ::= or_pattern "as" capture_pattern
or_pattern   ::= "|".closed_pattern+
guard        ::= "if" named_expression
```

#### 2.5.1 Pattern Types
```
capture_pattern        ::= !("_") NAME
wildcard_pattern       ::= "_"
value_pattern          ::= attr ("." attr)*
literal_pattern        ::= signed_number | complex_number | strings | "None" | "True" | "False"
group_pattern          ::= "(" pattern ")"
sequence_pattern       ::= "[" [maybe_sequence_pattern] "]" | "(" [open_sequence_pattern] ")"
mapping_pattern        ::= "{" [items_pattern] "}"
class_pattern          ::= name_or_attr "(" [pattern_arguments ","?] ")"
```

---

## 3. Core Rules and Constraints

### 3.1 `if`/`elif`/`else` Semantics
- `if` evaluates its condition; if truthy, executes its suite and skips all `elif`/`else` branches.
- `elif` is evaluated only if all preceding `if`/`elif` conditions were falsy.
- `else` executes only if all preceding conditions were falsy.
- Any number of `elif` clauses are allowed (including zero).
- At most one `else` clause; it must be last.

### 3.2 Truth Value Testing
Per §4.1 of the data model, any object can be tested for truth. An object is **falsy** if:
- It defines `__bool__` and that returns `False`
- It defines `__len__` and that returns `0` (and `__bool__` is not defined)

Objects that are falsy by default:
- `None`
- `False`
- Numeric zero: `0`, `0.0`, `0j`, `Decimal(0)`, `Fraction(0, 1)`
- Empty sequences and collections: `""`, `b""`, `()`, `[]`, `{}`, `set()`, `range(0)`
- Objects whose `__bool__` returns `False`

Everything else is **truthy**.

### 3.3 Short-Circuit Evaluation
- `x and y`: evaluates `y` only if `x` is truthy; returns `x` if `x` is falsy, otherwise returns `y`.
- `x or y`: evaluates `y` only if `x` is falsy; returns `x` if `x` is truthy, otherwise returns `y`.
- `not x`: always evaluates `x`; returns `True` if `x` is falsy, `False` if truthy.
- These operators return the **actual value** of the last-evaluated operand, not necessarily a `bool`.

### 3.4 Comparison Chaining
- Comparisons may be chained: `a < b < c` is equivalent to `(a < b) and (b < c)`.
- Each operand is evaluated exactly once (a key property for expressions with side effects).
- The spec defines this for any number of chained operators.

### 3.5 Conditional Expression (Ternary Operator)
- Syntax: `value_if_true if condition else value_if_false`
- `condition` is evaluated first; if truthy, `value_if_true` is evaluated and returned; otherwise `value_if_false`.
- Only one branch is evaluated (lazy).

### 3.6 `match` Statement Rules (PEP 634)
- `match` is a **soft keyword**: valid as an identifier outside a `match` statement.
- `case` is a **soft keyword**: valid as an identifier outside a `case` block.
- At least one `case` block is required.
- The wildcard pattern `_` always matches and never binds.
- A `case _:` clause functions as a default/fallthrough equivalent.
- No fall-through between cases (unlike C `switch`).
- Capture patterns bind new variables in the enclosing scope.
- OR patterns (`p1 | p2`) must bind the same set of variables.

---

## 4. Type Rules (Dunder Methods and Protocols)

### 4.1 Truth Value Protocol
```python
object.__bool__(self) -> bool
# Called by bool() and conditional expressions.
# If not defined, __len__ is tried.
# If neither defined, the object is always truthy.

object.__len__(self) -> int
# If __bool__ is absent, a non-zero __len__ makes the object truthy.
```

### 4.2 Comparison Protocol
```python
object.__lt__(self, other) -> bool | NotImplemented
object.__le__(self, other) -> bool | NotImplemented
object.__eq__(self, other) -> bool | NotImplemented
object.__ne__(self, other) -> bool | NotImplemented
object.__gt__(self, other) -> bool | NotImplemented
object.__ge__(self, other) -> bool | NotImplemented
```
If the left operand returns `NotImplemented`, the reflected method of the right operand is tried.

### 4.3 `in` / `not in` Protocol
```python
object.__contains__(self, item) -> bool
# Used by 'item in container'.
# If not defined, Python falls back to iterating over the object.
```

### 4.4 Structural Pattern Matching Protocol
```python
# Class patterns call __match_args__ to determine positional argument mapping:
cls.__match_args__ = ("attr1", "attr2", ...)

# Example:
class Point:
    __match_args__ = ("x", "y")
    def __init__(self, x, y):
        self.x = x
        self.y = y
```

---

## 5. Behavioral Specification

### 5.1 `if` Statement Execution
1. Evaluate the expression in the `if` clause.
2. If truthy, execute the `if` suite; the statement terminates.
3. Otherwise, for each `elif` clause in order: evaluate its expression; if truthy, execute its suite and terminate.
4. If no clause executed and an `else` clause exists, execute the `else` suite.

### 5.2 `and` / `or` Return Values
`and` and `or` return one of their operands, not necessarily `True` or `False`:
```python
x = None or "default"   # x = "default"
y = "value" or "default"  # y = "value"
z = 0 and "unreachable"   # z = 0
```

### 5.3 Conditional Expression Evaluation Order
```python
result = true_val if cond else false_val
```
1. Evaluate `cond`.
2. If truthy: evaluate and return `true_val`.
3. If falsy: evaluate and return `false_val`.

### 5.4 `match` Statement Execution (PEP 634)
1. Evaluate the subject expression once.
2. Try each `case` pattern in order.
3. For the first matching pattern:
   a. Bind any capture variables.
   b. Evaluate the guard (`if` clause) if present; if falsy, continue to next case.
   c. Execute the associated block.
   d. No fall-through to subsequent cases.
4. If no case matches, no action is taken (no error).

### 5.5 Pattern Matching Semantics
| Pattern | Matches when | Side effects |
|---------|-------------|--------------|
| Literal `42`, `"x"` | Subject equals literal (using `==`) | None |
| `None`, `True`, `False` | Subject `is` the singleton | None |
| Capture `name` | Always | Binds `name` to subject |
| Wildcard `_` | Always | None |
| Class `Point(x, y)` | `isinstance(subj, Point)` and attrs match | Binds `x`, `y` |
| Sequence `[a, b]` | Subject is a sequence of length 2 | Binds `a`, `b` |
| Mapping `{"key": v}` | Subject has key "key" | Binds `v` |
| OR `p1 \| p2` | Either pattern matches | Binds same set |
| AS `p as name` | `p` matches | Binds `name` to subject |
| Star `[a, *rest]` | Sequence with at least 1 element | Binds `a`, `rest` |

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined
- `not None` is `True` — fully defined.
- `0 == False` is `True`; `1 == True` is `True` (bool subclasses int).
- Chained comparisons evaluate each operand exactly once.
- `and` / `or` short-circuit: right operand not evaluated if not needed.
- `is` / `is not` never call `__eq__`; identity only.
- `None is None` is always `True` (singleton).

### 6.2 Undefined / Implementation-Defined
- The order in which `or`-patterns in `match` are tried is left-to-right (defined by PEP 634).
- `__eq__` returning `NotImplemented` fallback order is defined, but chained `==` across many custom types can have complex resolution.
- Whether a custom `__bool__` that returns non-bool is coerced: it is — `bool()` wraps the result.

---

## 7. Edge Cases from the Spec (CPython-Specific Notes)

### 7.1 Empty Containers Are Falsy
```python
print(bool([]))       # False
print(bool({}))       # False
print(bool(set()))    # False
print(bool(""))       # False
print(bool(0))        # False
print(bool(0.0))      # False
print(bool(None))     # False
```

### 7.2 Non-Bool Return from `and` / `or`
```python
result = [] or {}     # result = {}  ([] is falsy, returns {})
result = [1] or {}    # result = [1] (truthy, returns first truthy)
result = 0 or False or None or "found"  # result = "found"
```

### 7.3 `is` vs `==` with Literals
```python
# For None, True, False: 'is' is correct
x = None
if x is None: print("none")      # correct

# For other types: use ==
a = "hello"
b = "hello"
print(a is b)    # True in CPython (string interning) — NOT reliable
print(a == b)    # True — reliable
```

### 7.4 Walrus Operator in Conditions (PEP 572)
```python
import re
text = "Version: 3.12.0"
if m := re.search(r"\d+\.\d+\.\d+", text):
    print(f"Found version: {m.group()}")   # Found version: 3.12.0

# Walrus in while loop
data = [1, 2, 3, 4, 5]
while chunk := data[:2]:
    print(chunk)
    del data[:2]
```

### 7.5 `match` With Guard
```python
def classify(point):
    match point:
        case (x, y) if x == y:
            return "diagonal"
        case (x, y) if x > 0 and y > 0:
            return "first quadrant"
        case _:
            return "other"
```

### 7.6 Truthy `numpy` Arrays Raise `ValueError`
CPython raises `ValueError` for `numpy.ndarray` in boolean context (because `__bool__` raises it for multi-element arrays). This is correct per the protocol — `__bool__` can raise any exception.

### 7.7 Chained Comparison With Side Effects
```python
count = 0
def check(n):
    global count
    count += 1
    return n

# Each operand evaluated once:
result = check(1) < check(2) < check(3)
print(count)    # 3  — each called exactly once
```

---

## 8. Version History (PEPs and Python Versions)

| Feature | PEP | Version |
|---------|-----|---------|
| `if`/`elif`/`else` | — | Python 1.0 |
| `x if cond else y` conditional expression | PEP 308 | Python 2.5 |
| `is` / `is not` operators | — | Python 2.1 |
| `not in` operator | — | Python 2.0 |
| Walrus operator `:=` in conditions | PEP 572 | Python 3.8 |
| Structural pattern matching `match`/`case` | PEP 634 | Python 3.10 |
| Soft keywords `match`, `case`, `type` | PEP 634, 695 | Python 3.10, 3.12 |
| OR patterns `p1 \| p2` in match | PEP 634 | Python 3.10 |
| `__match_args__` protocol | PEP 634 | Python 3.10 |

---

## 9. Implementation-Specific Behavior

### 9.1 CPython Short-Circuit Optimization
- CPython generates `JUMP_IF_FALSE_OR_POP` and `JUMP_IF_TRUE_OR_POP` bytecodes for `and`/`or`.
- The right operand is only evaluated if the jump is not taken.

### 9.2 `match` Statement Bytecode (CPython 3.10+)
- `match` is compiled to a series of pattern-specific bytecode instructions.
- Literal patterns compile to equality checks (`==`) except for `None`/`True`/`False` which use identity.
- Class patterns generate `isinstance` checks followed by attribute loads.

### 9.3 PyPy
- JIT compilation treats `if`/`elif`/`else` chains efficiently.
- Short-circuit evaluation follows the same semantics.
- `match` support was added alongside CPython 3.10 compatibility.

---

## 10. Spec Compliance Checklist

- [ ] `if`/`elif`/`else` uses correct indentation
- [ ] Truth testing relies on `__bool__` / `__len__` protocol, not explicit `== True`
- [ ] `is` / `is not` used only for `None`, `True`, `False` identity checks
- [ ] `==` used for value equality
- [ ] `and` / `or` return values understood (not necessarily `bool`)
- [ ] Walrus operator (`:=`) scope understood
- [ ] `match` patterns do not fall through between cases
- [ ] OR patterns in `match` bind the same set of variables
- [ ] `__match_args__` defined for positional class patterns
- [ ] Guards (`if`) in `case` clauses correctly used
- [ ] Chained comparisons evaluate operands exactly once

---

## 11. Official Examples (Runnable Python 3.10+)

```python
# ----------------------------------------------------------------
# 1. Basic if / elif / else
# ----------------------------------------------------------------
def grade(score: int) -> str:
    if score >= 90:
        return "A"
    elif score >= 80:
        return "B"
    elif score >= 70:
        return "C"
    elif score >= 60:
        return "D"
    else:
        return "F"

print(grade(95))   # A
print(grade(73))   # C
print(grade(45))   # F


# ----------------------------------------------------------------
# 2. Truth value testing
# ----------------------------------------------------------------
values = [0, "", [], None, False, 0.0, set(), {}, "hello", [1], True]
for v in values:
    print(f"{repr(v):15} -> {bool(v)}")


# ----------------------------------------------------------------
# 3. Short-circuit evaluation
# ----------------------------------------------------------------
def side_effect(name, val):
    print(f"  evaluating {name}")
    return val

print("and short-circuit:")
result = side_effect("left", False) and side_effect("right", True)
# Only "left" is printed; right is NOT evaluated

print("or short-circuit:")
result = side_effect("left", True) or side_effect("right", False)
# Only "left" is printed


# ----------------------------------------------------------------
# 4. and/or return values (not necessarily bool)
# ----------------------------------------------------------------
x = None
y = x or "default"
print(y)          # "default"

name = "Alice"
greeting = name and f"Hello, {name}!"
print(greeting)   # "Hello, Alice!"

empty = []
result = empty or [1, 2, 3]
print(result)     # [1, 2, 3]


# ----------------------------------------------------------------
# 5. Conditional expression (ternary)
# ----------------------------------------------------------------
n = 7
label = "odd" if n % 2 != 0 else "even"
print(label)   # odd

# Nested ternary (works but prefer if/elif for readability)
category = "low" if n < 5 else ("high" if n > 10 else "medium")
print(category)   # medium


# ----------------------------------------------------------------
# 6. Chained comparisons
# ----------------------------------------------------------------
x = 5
print(1 < x < 10)    # True
print(0 <= x <= 5)   # True
print(x == 5 == 5)   # True

# Each middle operand evaluated once:
import random
# 0 <= random.randint(0,10) <= 10  (randint called once)


# ----------------------------------------------------------------
# 7. Walrus operator in conditions (PEP 572)
# ----------------------------------------------------------------
import re
text = "order_id: 12345"
if (m := re.search(r"\d+", text)) is not None:
    print(f"Found ID: {m.group()}")   # Found ID: 12345


# ----------------------------------------------------------------
# 8. Structural pattern matching (PEP 634, Python 3.10+)
# ----------------------------------------------------------------
class Point:
    __match_args__ = ("x", "y")
    def __init__(self, x, y):
        self.x = x
        self.y = y

def describe_point(point):
    match point:
        case Point(0, 0):
            return "Origin"
        case Point(x, 0):
            return f"On x-axis at {x}"
        case Point(0, y):
            return f"On y-axis at {y}"
        case Point(x, y) if x == y:
            return f"On diagonal at {x}"
        case Point(x, y):
            return f"Point({x}, {y})"
        case _:
            return "Not a point"

print(describe_point(Point(0, 0)))   # Origin
print(describe_point(Point(3, 0)))   # On x-axis at 3
print(describe_point(Point(4, 4)))   # On diagonal at 4
print(describe_point(Point(1, 2)))   # Point(1, 2)


# ----------------------------------------------------------------
# 9. match with sequence patterns
# ----------------------------------------------------------------
def http_action(request):
    match request:
        case {"method": "GET", "url": url}:
            return f"GET {url}"
        case {"method": "POST", "url": url, "body": body}:
            return f"POST {url} with body"
        case {"method": method}:
            return f"Unknown method: {method}"
        case _:
            return "Invalid request"

print(http_action({"method": "GET", "url": "/home"}))
print(http_action({"method": "DELETE", "url": "/res"}))


# ----------------------------------------------------------------
# 10. match with OR patterns
# ----------------------------------------------------------------
def classify_status(code: int) -> str:
    match code:
        case 200 | 201 | 202:
            return "success"
        case 301 | 302:
            return "redirect"
        case 400 | 401 | 403 | 404:
            return "client error"
        case 500 | 502 | 503:
            return "server error"
        case _:
            return "unknown"

print(classify_status(201))   # success
print(classify_status(404))   # client error
print(classify_status(503))   # server error
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| §6.10 | Comparisons | https://docs.python.org/3/reference/expressions.html#comparisons |
| §6.11 | Boolean operations | https://docs.python.org/3/reference/expressions.html#boolean-operations |
| §6.12 | Conditional expressions | https://docs.python.org/3/reference/expressions.html#conditional-expressions |
| §8.1 | The `if` statement | https://docs.python.org/3/reference/compound_stmts.html#the-if-statement |
| §8.6 | The `match` statement | https://docs.python.org/3/reference/compound_stmts.html#the-match-statement |
| §3.3.1 | Truth value testing | https://docs.python.org/3/reference/datamodel.html#truth-value-testing |
| §4.2.2 | Name resolution (scoping) | https://docs.python.org/3/reference/executionmodel.html#resolution-of-names |
| PEP 308 | Conditional expression | https://peps.python.org/pep-0308/ |
| PEP 572 | Walrus operator | https://peps.python.org/pep-0572/ |
| PEP 634 | Pattern matching | https://peps.python.org/pep-0634/ |
| PEP 635 | Pattern matching motivation | https://peps.python.org/pep-0635/ |
| PEP 636 | Pattern matching tutorial | https://peps.python.org/pep-0636/ |
