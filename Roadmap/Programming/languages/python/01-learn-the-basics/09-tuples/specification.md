# Python Tuples — Language Specification

## 1. Spec Reference

- **Primary source:** Python Language Reference, §3.2 — Immutable Sequences
  https://docs.python.org/3/reference/datamodel.html#immutable-sequence-types
- **Built-in tuple type:** https://docs.python.org/3/library/stdtypes.html#tuple
- **Tuple display grammar:** §6.2.3
  https://docs.python.org/3/reference/expressions.html#parenthesized-forms
- **`collections.namedtuple`:** https://docs.python.org/3/library/collections.html#collections.namedtuple
- **`typing.NamedTuple`:** https://docs.python.org/3/library/typing.html#typing.NamedTuple
- **Python 3.12 standard:** All rules here apply to CPython 3.12 unless otherwise noted.

---

## 2. Formal Grammar (EBNF)

### 2.1 Tuple Display
```
parenth_form      ::= "(" [starred_expression | (starred_expression ",")
                            [(starred_expression ",")* starred_expression [","]]] ")"
```

### 2.2 Key Syntax Rules
```
# A single-element tuple REQUIRES a trailing comma:
single_tuple  ::= "(" expression "," ")"
empty_tuple   ::= "(" ")"
multi_tuple   ::= "(" expression ("," expression)+ [","] ")"

# Without parentheses (implicit tuple in assignment, return, etc.):
tuple_expr    ::= expression ("," expression)+ [","]
```

### 2.3 Tuple Unpacking (Assignment)
```
target_list       ::= target ("," target)* [","]
starred_target    ::= "*" target
unpacking_assign  ::= target_list "=" expression
```

---

## 3. Core Rules and Constraints

### 3.1 Tuple Characteristics
- **Ordered:** elements maintain insertion order.
- **Immutable:** once created, elements cannot be added, removed, or replaced.
- **Heterogeneous:** elements may be of any type.
- **Hashable** if and only if all elements are hashable.
- Zero-indexed; supports negative indexing.
- Fixed size; no `append`, `extend`, or `remove` methods.

### 3.2 Immutability Semantics
- The tuple itself cannot be mutated: no item assignment, no `del`.
- If a tuple contains a mutable object (e.g., a list), that mutable object can be changed.
- `t = (1, [2, 3]); t[1].append(4)` is valid — the list is mutated, not the tuple.
- The tuple's hash depends on the hash of its elements; a tuple containing an unhashable element is itself unhashable.

### 3.3 Single-Element Tuple Syntax
- `(42,)` is a tuple; `(42)` is just the integer `42`.
- The trailing comma is **mandatory** for a single-element tuple.
- Empty tuple: `()` or `tuple()`.

### 3.4 Comma Creates a Tuple
- In Python, the comma operator creates a tuple, not parentheses.
- `a, b = 1, 2` — right side is a tuple `(1, 2)`.
- `return x, y` — returns tuple `(x, y)`.
- `a, = [1]` — unpacks one-element iterable into `a` (note the comma).

### 3.5 Unpacking Rules
- The number of targets must match the number of elements (unless starred target is present).
- Starred target `*name` collects remaining elements into a list (not a tuple).
- At most one starred target per unpacking.
- Nested unpacking is supported: `(a, b), c = (1, 2), 3`.

### 3.6 Hashability
- `tuple.__hash__` is defined only if all elements are hashable.
- Hash is computed from the hash of all elements using a combination formula.
- CPython: `tuple.__hash__` is resistant to hash collision attacks (same randomization as other types).

---

## 4. Type Rules (Dunder Methods and Protocols)

### 4.1 Immutable Sequence Protocol
```python
object.__len__(self)            -> int       # len(t)
object.__getitem__(self, key)   -> value     # t[i], t[i:j]
object.__iter__(self)           -> iterator  # iter(t), for x in t
object.__reversed__(self)       -> iterator  # reversed(t)
object.__contains__(self, item) -> bool      # x in t
```

### 4.2 Concatenation and Repetition (Read-Only)
```python
object.__add__(self, other)     -> tuple     # t1 + t2 (returns new tuple)
object.__mul__(self, n)         -> tuple     # t * n
object.__rmul__(self, n)        -> tuple     # n * t
```
Note: No `__iadd__` or `__imul__` for tuples (unlike lists); `t += (x,)` rebinds `t`.

### 4.3 Hash Protocol
```python
object.__hash__(self)           -> int
# Defined for tuples iff all elements are hashable.
# If any element is unhashable (e.g., list), __hash__ raises TypeError.
```

### 4.4 Comparison Protocol
```python
# Tuples compare lexicographically.
object.__lt__(self, other)
object.__le__(self, other)
object.__eq__(self, other)
object.__ne__(self, other)
object.__gt__(self, other)
object.__ge__(self, other)
```
Comparison is element-by-element; the first differing pair determines the result.

---

## 5. Behavioral Specification

### 5.1 `tuple()` Constructor
- `tuple()` → `()`
- `tuple(iterable)` → tuple containing all elements of the iterable, in iteration order.
- Consumes the iterable fully.

### 5.2 Tuple Methods (Only Two)
| Method | Description | Complexity |
|--------|-------------|-----------|
| `count(x)` | Returns number of occurrences of `x` | O(n) |
| `index(x[, start[, stop]])` | Returns index of first `x`; raises `ValueError` if absent | O(n) |

### 5.3 Tuple vs List Performance
- Tuples are slightly faster to create and iterate than lists (CPython).
- Tuples use less memory: no over-allocation; `sys.getsizeof((1,2,3))` < `sys.getsizeof([1,2,3])`.
- Tuples have `__hash__` (if all elements hashable); lists do not.
- Tuple literals may be folded into constants at compile time (CPython peephole optimizer).

### 5.4 Tuple Unpacking Semantics
1. Evaluate the right-hand side to get an iterable.
2. If the target is a plain tuple/list of names: check lengths match; bind each.
3. If a starred target is present: bind the starred name to a **list** of remaining items.
4. Nested targets are resolved recursively.

### 5.5 `namedtuple` and `typing.NamedTuple`
- `namedtuple` creates a tuple subclass with named fields.
- Fields are accessible by index (inherited from tuple) or by name (attribute access).
- `_make(iterable)`, `_asdict()`, `_replace(**kwargs)`, `_fields` class attribute.
- `typing.NamedTuple` adds type annotations and is preferred in modern code.

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined
- `t[i] = v` always raises `TypeError` — tuples are immutable.
- `del t[i]` always raises `TypeError`.
- `tuple() == ()` is `True`.
- `(1,) == (1,)` is `True`.
- `t * 0` → `()`.
- `t * n` for negative `n` → `()`.
- Lexicographic comparison: `(1, 2) < (1, 3)` is `True`.
- `hash((1, 2, 3))` is defined and stable within a process.

### 6.2 Undefined / Implementation-Defined
- **Exact hash value:** `hash((1, 2, 3))` is randomized per process (since Python 3.3 PYTHONHASHSEED randomization affects tuples through their elements).
- **CPython compile-time folding:** CPython may fold `(1, 2) + (3, 4)` into `(1, 2, 3, 4)` as a constant (peephole optimizer). This is not guaranteed.

---

## 7. Edge Cases from the Spec (CPython-Specific Notes)

### 7.1 Single-Element Tuple
```python
a = (42)   # int 42 — NOT a tuple
b = (42,)  # tuple with one element
c = 42,    # also a tuple!

print(type(a))   # <class 'int'>
print(type(b))   # <class 'tuple'>
print(type(c))   # <class 'tuple'>
```

### 7.2 Mutable Element in Tuple
```python
t = (1, [2, 3], 4)
t[1].append(5)     # valid! mutates the list inside the tuple
print(t)            # (1, [2, 3, 5], 4)

# But the tuple is still not hashable:
try:
    hash(t)
except TypeError as e:
    print(e)   # unhashable type: 'list'
```

### 7.3 Starred Unpacking Returns a list
```python
first, *rest = (1, 2, 3, 4, 5)
print(type(rest))   # <class 'list'>  — NOT a tuple!
print(rest)         # [2, 3, 4, 5]
```

### 7.4 Tuple += Rebinds the Variable
```python
t = (1, 2)
original_id = id(t)
t += (3,)          # creates a NEW tuple; rebinds t
print(id(t) == original_id)   # False
print(t)                       # (1, 2, 3)
```

### 7.5 Nested Unpacking
```python
(a, b), (c, d) = (1, 2), (3, 4)
print(a, b, c, d)   # 1 2 3 4

# In for loops:
pairs = [(1, 'a'), (2, 'b'), (3, 'c')]
for num, letter in pairs:
    print(f"{num}: {letter}")
```

### 7.6 Tuple Comprehension Does Not Exist
```python
# There is no tuple comprehension syntax.
# (x for x in range(5)) is a GENERATOR EXPRESSION, not a tuple.
gen = (x for x in range(5))
print(type(gen))   # <class 'generator'>

# To get a tuple from a comprehension:
t = tuple(x**2 for x in range(5))
print(t)   # (0, 1, 4, 9, 16)
```

### 7.7 `typing.NamedTuple` Example
```python
from typing import NamedTuple

class Point(NamedTuple):
    x: float
    y: float
    label: str = "point"

p = Point(1.0, 2.0)
print(p.x, p.y)         # 1.0 2.0
print(p._asdict())       # {'x': 1.0, 'y': 2.0, 'label': 'point'}
print(p._replace(x=5.0)) # Point(x=5.0, y=2.0, label='point')
print(p[0])              # 1.0  (still a tuple by index)
```

---

## 8. Version History (PEPs and Python Versions)

| Feature | PEP | Version |
|---------|-----|---------|
| `tuple` built-in | — | Python 1.0 |
| `collections.namedtuple` | — | Python 2.6 |
| Extended unpacking (`*rest`) | PEP 3132 | Python 3.0 |
| `typing.NamedTuple` | PEP 526 | Python 3.6 |
| `typing.NamedTuple` with class syntax | — | Python 3.6 |
| `namedtuple` `defaults=` parameter | — | Python 3.6.1 |
| `*` unpacking in tuple/list/set displays | PEP 448 | Python 3.5 |
| `tuple[int, str]` subscript (generic) | PEP 585 | Python 3.9 |
| `tuple[int, ...]` in typing | PEP 484 | Python 3.5 |

---

## 9. Implementation-Specific Behavior

### 9.1 CPython Memory Layout
- CPython stores tuple elements as a C array of `PyObject*` pointers.
- `sys.getsizeof(())` = 40 bytes; each additional element adds 8 bytes (64-bit).
- List: `sys.getsizeof([])` = 56 bytes + over-allocation.
- Tuple is always exactly the right size.

### 9.2 CPython Tuple Interning
- CPython interns the empty tuple `()` as a singleton.
- Small tuples (0-2 elements) may be cached in a "free list" for performance.
- `() is ()` is `True` in CPython (same object).
- `(1,) is (1,)` may be `True` or `False` depending on context (compile-time constant folding).

### 9.3 CPython Peephole Optimizer
- Tuple literals composed of constants are folded at compile time.
- `(1, 2, 3)` in a function body becomes a single `LOAD_CONST` instruction.
- `(1, 2) + (3, 4)` may be folded to `(1, 2, 3, 4)` at compile time.

### 9.4 PyPy
- PyPy uses similar tuple semantics but may differ in interning and free list behavior.
- Strategy-based storage: tuples of uniform type may use compact storage.

---

## 10. Spec Compliance Checklist

- [ ] Single-element tuple uses trailing comma: `(42,)` not `(42)`
- [ ] Immutability: `t[i] = v` raises `TypeError`; understood
- [ ] Mutable elements inside a tuple can still be mutated
- [ ] `hash(t)` requires all elements to be hashable
- [ ] Starred unpacking produces a `list`, not a `tuple`
- [ ] `t += (x,)` creates a new tuple and rebinds the variable
- [ ] `(x for x in ...)` is a generator, not a tuple comprehension
- [ ] `tuple(gen)` used to materialize a generator into a tuple
- [ ] `typing.NamedTuple` used for named field access with type annotations
- [ ] Lexicographic comparison semantics understood

---

## 11. Official Examples (Runnable Python 3.10+)

```python
from typing import NamedTuple
from collections import namedtuple

# ----------------------------------------------------------------
# 1. Tuple creation
# ----------------------------------------------------------------
empty  = ()
single = (42,)     # MUST have trailing comma
double = (1, 2)
mixed  = (1, "two", 3.0, [4, 5])
no_paren = 1, 2, 3   # implicit tuple

print(type(single))   # <class 'tuple'>
print(type((42)))     # <class 'int'>  — NOT a tuple!


# ----------------------------------------------------------------
# 2. Indexing and slicing (read-only)
# ----------------------------------------------------------------
t = (10, 20, 30, 40, 50)
print(t[0])       # 10
print(t[-1])      # 50
print(t[1:4])     # (20, 30, 40)
print(t[::-1])    # (50, 40, 30, 20, 10)

# Immutability:
try:
    t[0] = 99
except TypeError as e:
    print(e)   # 'tuple' object does not support item assignment


# ----------------------------------------------------------------
# 3. Unpacking
# ----------------------------------------------------------------
a, b, c = (1, 2, 3)
print(a, b, c)   # 1 2 3

first, *middle, last = (1, 2, 3, 4, 5)
print(first, middle, last)   # 1 [2, 3, 4] 5
print(type(middle))          # <class 'list'>

# Nested unpacking:
(x, y), z = (1, 2), 3
print(x, y, z)   # 1 2 3

# Swap:
a, b = b, a
print(a, b)   # 2 1


# ----------------------------------------------------------------
# 4. Tuple as dict key (hashable)
# ----------------------------------------------------------------
grid = {(0, 0): "origin", (1, 0): "right", (0, 1): "up"}
print(grid[(0, 0)])   # origin
print(grid[(1, 0)])   # right

# List as key would raise TypeError:
try:
    d = {[1, 2]: "value"}
except TypeError as e:
    print(e)   # unhashable type: 'list'


# ----------------------------------------------------------------
# 5. Tuple concatenation and repetition
# ----------------------------------------------------------------
t1 = (1, 2, 3)
t2 = (4, 5, 6)
print(t1 + t2)    # (1, 2, 3, 4, 5, 6)
print(t1 * 3)     # (1, 2, 3, 1, 2, 3, 1, 2, 3)

# += rebinds (does not mutate):
t = (1,)
original_id = id(t)
t += (2,)
print(t)                      # (1, 2)
print(id(t) == original_id)   # False


# ----------------------------------------------------------------
# 6. Tuple methods
# ----------------------------------------------------------------
t = (1, 2, 3, 2, 1, 2)
print(t.count(2))        # 3
print(t.index(3))        # 2
print(t.index(2, 3))     # 3  — first 2 from index 3 onward


# ----------------------------------------------------------------
# 7. Mutable element inside tuple
# ----------------------------------------------------------------
t = ([1, 2], [3, 4])
t[0].append(5)   # valid — mutates the list
print(t)          # ([1, 2, 5], [3, 4])

# Unhashable due to list element:
try:
    hash(t)
except TypeError as e:
    print(e)   # unhashable type: 'list'


# ----------------------------------------------------------------
# 8. Generator expression vs tuple
# ----------------------------------------------------------------
gen = (x**2 for x in range(5))   # generator, NOT tuple
print(type(gen))                   # <class 'generator'>

tpl = tuple(x**2 for x in range(5))   # materialize to tuple
print(tpl)   # (0, 1, 4, 9, 16)


# ----------------------------------------------------------------
# 9. collections.namedtuple
# ----------------------------------------------------------------
Point = namedtuple("Point", ["x", "y"])
p = Point(3, 4)
print(p.x, p.y)          # 3 4
print(p[0], p[1])         # 3 4  (index access still works)
print(p._asdict())        # {'x': 3, 'y': 4}
print(p._replace(x=10))   # Point(x=10, y=4)
print(Point._fields)      # ('x', 'y')


# ----------------------------------------------------------------
# 10. typing.NamedTuple with annotations and defaults
# ----------------------------------------------------------------
class Employee(NamedTuple):
    name: str
    department: str
    salary: float = 50_000.0

emp = Employee("Alice", "Engineering")
print(emp)                    # Employee(name='Alice', department='Engineering', salary=50000.0)
print(emp.name)               # Alice
print(emp._asdict())          # OrderedDict(...)
print(isinstance(emp, tuple)) # True


# ----------------------------------------------------------------
# 11. Lexicographic comparison
# ----------------------------------------------------------------
print((1, 2) < (1, 3))    # True
print((1, 2) < (2, 0))    # True
print((1, 2, 3) > (1, 2)) # True  (longer tuple is greater if prefix equal)
print((1, 2) == (1, 2))   # True
print((1, 2) != (1, 3))   # True


# ----------------------------------------------------------------
# 12. Tuple generic type hints (Python 3.9+)
# ----------------------------------------------------------------
def distance(p: tuple[float, float]) -> float:
    import math
    return math.sqrt(p[0]**2 + p[1]**2)

print(distance((3.0, 4.0)))   # 5.0

# Variable-length homogeneous tuple:
def sum_coords(coords: tuple[float, ...]) -> float:
    return sum(coords)

print(sum_coords((1.0, 2.0, 3.0)))  # 6.0
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| §3.2 | Immutable sequence types | https://docs.python.org/3/reference/datamodel.html#immutable-sequence-types |
| §6.2.3 | Parenthesized forms | https://docs.python.org/3/reference/expressions.html#parenthesized-forms |
| §7.2 | Assignment / unpacking | https://docs.python.org/3/reference/simple_stmts.html#assignment-statements |
| `tuple` | Built-in type | https://docs.python.org/3/library/stdtypes.html#tuple |
| Sequence operations | Common operations | https://docs.python.org/3/library/stdtypes.html#sequence-types-list-tuple-range |
| `collections.namedtuple` | Named tuple factory | https://docs.python.org/3/library/collections.html#collections.namedtuple |
| `typing.NamedTuple` | Typed named tuple | https://docs.python.org/3/library/typing.html#typing.NamedTuple |
| PEP 3132 | Extended unpacking (`*rest`) | https://peps.python.org/pep-3132/ |
| PEP 448 | Unpacking generalizations | https://peps.python.org/pep-0448/ |
| PEP 484 | Type hints for tuples | https://peps.python.org/pep-0484/ |
| PEP 526 | Variable annotations | https://peps.python.org/pep-0526/ |
| PEP 585 | `tuple[int, str]` subscript | https://peps.python.org/pep-0585/ |
