# Python Sets — Language Specification

## 1. Spec Reference

- **Primary source:** Python Language Reference, §3.2 — Set types
  https://docs.python.org/3/reference/datamodel.html#set-types
- **Built-in set types:** https://docs.python.org/3/library/stdtypes.html#set-types-set-frozenset
- **Set display grammar:** §6.2.7
  https://docs.python.org/3/reference/expressions.html#set-displays
- **Python 3.12 standard:** All rules here apply to CPython 3.12 unless otherwise noted.

---

## 2. Formal Grammar (EBNF)

### 2.1 Set Display
```
set_display    ::= "{" (starred_list | comprehension) "}"
starred_list   ::= starred_item ("," starred_item)* [","]
starred_item   ::= assignment_expression | "*" or_expr
comprehension  ::= assignment_expression comp_for
```
Note: `{}` is an empty **dict**, not an empty set. Use `set()` for an empty set.

### 2.2 Frozenset Construction
```
frozenset_call ::= "frozenset" "(" [iterable] ")"
```
There is no literal syntax for `frozenset`; it is always constructed via the constructor.

### 2.3 Set Operations (Operator Grammar)
```
set_expr ::= set_expr "|" set_expr   # union
           | set_expr "&" set_expr   # intersection
           | set_expr "-" set_expr   # difference
           | set_expr "^" set_expr   # symmetric difference
           | "~" set_expr            # not valid for set (bitwise not is for int)
```

---

## 3. Core Rules and Constraints

### 3.1 Set Characteristics
- **Unordered:** no guaranteed order (CPython 3.7+ dicts are ordered, but sets are NOT).
- **No duplicates:** each element appears at most once; duplicates are silently ignored.
- **Mutable (set):** elements can be added and removed.
- **Immutable (frozenset):** once created, cannot be changed; is hashable.
- **Elements must be hashable:** each element must define `__hash__` and `__eq__`.
- A `list`, `dict`, or `set` cannot be a set element (unhashable).
- A `frozenset` CAN be a set element (hashable).

### 3.2 Empty Set
- `set()` creates an empty set.
- `{}` creates an empty **dict** — a common mistake.
- `frozenset()` creates an empty frozenset.

### 3.3 Membership Test Complexity
- `x in s` for a set is O(1) average case (hash lookup).
- `x in lst` for a list is O(n).

### 3.4 Set Identity and Equality
- `s1 == s2`: True if both sets have the same elements (regardless of order).
- `s1 is s2`: True only if both variables reference the same object.
- `set("abc") == set("cba")` is `True`.

### 3.5 Subset and Superset Relations
- `s1 <= s2`: `s1` is a subset of `s2` (`s1.issubset(s2)`).
- `s1 < s2`: `s1` is a proper subset (subset and not equal).
- `s1 >= s2`: `s1` is a superset of `s2`.
- `s1 > s2`: `s1` is a proper superset.

### 3.6 `frozenset` vs `set`
| Property | `set` | `frozenset` |
|----------|-------|-------------|
| Mutable | Yes | No |
| Hashable | No | Yes (if all elements hashable) |
| Can be dict key | No | Yes |
| Can be set element | No | Yes |
| Literal syntax | `{1, 2}` | None (use `frozenset(...)`) |

---

## 4. Type Rules (Dunder Methods and Protocols)

### 4.1 Set Protocol (both `set` and `frozenset`)
```python
object.__contains__(self, item) -> bool   # x in s; O(1) average
object.__iter__(self)           -> iterator  # for x in s
object.__len__(self)            -> int    # len(s)
```

### 4.2 Set Operator Dunders
```python
# These accept ANY iterable for methods, but operators require set/frozenset:
object.__or__(self, other)     -> set   # s | other
object.__and__(self, other)    -> set   # s & other
object.__sub__(self, other)    -> set   # s - other
object.__xor__(self, other)    -> set   # s ^ other
object.__ior__(self, other)    -> self  # s |= other  (in-place union, set only)
object.__iand__(self, other)   -> self  # s &= other  (in-place intersection)
object.__isub__(self, other)   -> self  # s -= other  (in-place difference)
object.__ixor__(self, other)   -> self  # s ^= other  (in-place sym diff)
# Reflected operators:
object.__ror__, __rand__, __rsub__, __rxor__
```

### 4.3 Comparison Protocol
```python
object.__eq__(self, other)     -> bool  # s1 == s2  (same elements)
object.__ne__(self, other)     -> bool  # s1 != s2
object.__le__(self, other)     -> bool  # s1 <= s2  (subset)
object.__lt__(self, other)     -> bool  # s1 < s2   (proper subset)
object.__ge__(self, other)     -> bool  # s1 >= s2  (superset)
object.__gt__(self, other)     -> bool  # s1 > s2   (proper superset)
```
Note: `<` and `>` for sets do NOT mean "less than/greater than by size" — they mean strict subset/superset.

### 4.4 Hash Protocol (frozenset only)
```python
frozenset.__hash__(self) -> int
# set.__hash__ is explicitly set to None (unhashable).
```

---

## 5. Behavioral Specification

### 5.1 `set()` Constructor
- `set()` → empty set.
- `set(iterable)` → set of unique hashable elements from the iterable.
- Duplicate elements are silently dropped.
- Raises `TypeError` if any element is unhashable.

### 5.2 `set` Methods (Full Spec)
| Method | Description | Modifies `s`? |
|--------|-------------|--------------|
| `add(elem)` | Add `elem` to set; no-op if present | Yes |
| `remove(elem)` | Remove `elem`; raises `KeyError` if absent | Yes |
| `discard(elem)` | Remove `elem` if present; no-op if absent | Yes |
| `pop()` | Remove and return an arbitrary element; `KeyError` if empty | Yes |
| `clear()` | Remove all elements | Yes |
| `update(*others)` | Add all elements from all iterables | Yes |
| `intersection_update(*others)` | Keep only elements present in all | Yes |
| `difference_update(*others)` | Remove elements found in any other | Yes |
| `symmetric_difference_update(other)` | Keep elements in exactly one | Yes |
| `copy()` | Return shallow copy of the set | No |
| `union(*others)` | New set with elements from all | No |
| `intersection(*others)` | New set with elements common to all | No |
| `difference(*others)` | New set with elements not in others | No |
| `symmetric_difference(other)` | New set with elements in exactly one | No |
| `issubset(other)` | True if all elements in `other` | No |
| `issuperset(other)` | True if `other`'s elements all in self | No |
| `isdisjoint(other)` | True if no common elements | No |

### 5.3 Operator vs Method Behavior
- Operators (`|`, `&`, `-`, `^`) require both operands to be `set` or `frozenset`.
- Methods (`union()`, `intersection()`, etc.) accept **any iterable** as the argument.
- `s.union([1, 2, 3])` is valid; `s | [1, 2, 3]` raises `TypeError`.

### 5.4 Set Comprehension
- `{expr for x in iterable if condition}` creates a new set.
- Variables are local to the comprehension (Python 3).
- `{}` is dict display; `{x for x in ...}` is a set comprehension.

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined
- `x in s` is O(1) average (hash table lookup).
- `add`, `discard`, `remove` are O(1) average.
- `pop()` returns an **arbitrary** element — the spec does not define which one.
- `set()` deduplicates using `__hash__` and `__eq__`.
- Two objects that compare equal must have equal hash values; if `a == b` then `hash(a) == hash(b)`.
- Iteration order of sets is not guaranteed.

### 6.2 Undefined / Implementation-Defined
- **Iteration order:** The spec explicitly states sets are unordered. CPython's internal hash table determines traversal order, which may appear consistent but MUST NOT be relied upon.
- **Which element `pop()` removes:** arbitrary. CPython removes based on hash table internals.
- **Set growth:** CPython's set uses an open-addressing hash table with 2/3 load factor. Growth triggers rehashing. The exact sizes are implementation-defined.

---

## 7. Edge Cases from the Spec (CPython-Specific Notes)

### 7.1 `{}` is a dict, Not a Set
```python
x = {}
print(type(x))    # <class 'dict'>  — NOT a set!

y = set()
print(type(y))    # <class 'set'>
```

### 7.2 Unhashable Elements Raise TypeError
```python
try:
    s = {[1, 2], 3}   # list is unhashable
except TypeError as e:
    print(e)   # unhashable type: 'list'

try:
    s = {1, 2}
    s.add([3, 4])
except TypeError as e:
    print(e)   # unhashable type: 'list'
```

### 7.3 `remove` vs `discard`
```python
s = {1, 2, 3}
s.remove(2)    # OK
try:
    s.remove(99)   # raises KeyError
except KeyError:
    print("not found")

s.discard(99)  # no exception — silent no-op
print(s)       # {1, 3}
```

### 7.4 Set Operators Require Set Operands; Methods Accept Iterables
```python
s = {1, 2, 3}
# Operator requires set:
try:
    result = s | [4, 5]   # TypeError!
except TypeError as e:
    print(e)

# Method accepts iterable:
result = s.union([4, 5])
print(result)   # {1, 2, 3, 4, 5}
```

### 7.5 `frozenset` as Dict Key and Set Element
```python
fs = frozenset([1, 2, 3])
d = {fs: "value"}
print(d[frozenset([1, 2, 3])])   # "value"

s = {frozenset([1, 2]), frozenset([3, 4])}
print(s)   # {frozenset({1, 2}), frozenset({3, 4})}
```

### 7.6 Set Comprehension vs Dict Comprehension
```python
# Set comprehension:
s = {x**2 for x in range(5)}
print(type(s))   # <class 'set'>
print(s)         # {0, 1, 4, 9, 16}

# Dict comprehension:
d = {x: x**2 for x in range(5)}
print(type(d))   # <class 'dict'>
```

### 7.7 Integer and Boolean Deduplication
```python
# True == 1 and False == 0 with same hash values
s = {True, 1, False, 0}
print(s)    # {False, True}  — deduplicated since True==1 and False==0
print(len(s))  # 2

# This can be surprising:
s = {1, True}
print(len(s))   # 1  — only one element!
```

---

## 8. Version History (PEPs and Python Versions)

| Feature | PEP | Version |
|---------|-----|---------|
| `set` and `frozenset` built-ins | PEP 218 | Python 2.4 |
| Set literals `{1, 2, 3}` | — | Python 2.7 / 3.0 |
| Set comprehensions `{x for x in ...}` | — | Python 2.7 / 3.0 |
| `{1, 2} | {3, 4}` operator overloading | — | Python 2.4 |
| `*` unpacking in set literals | PEP 448 | Python 3.5 |
| `set[int]` generic subscript | PEP 585 | Python 3.9 |
| `frozenset[int]` subscript | PEP 585 | Python 3.9 |

---

## 9. Implementation-Specific Behavior

### 9.1 CPython Hash Table
- CPython `set` uses open-addressing with quadratic probing.
- Initial table size: 8 slots; grows when load factor exceeds 2/3.
- Hash is computed using Python's `hash()` function on each element.
- PYTHONHASHSEED randomizes hash values for `str`, `bytes`, `datetime` — affects set iteration order between processes.

### 9.2 CPython Iteration Order
- Although sets are officially unordered, CPython's traversal follows hash table slot order.
- This order is consistent within one process run but differs between runs (due to hash randomization).
- Do not write code that depends on set iteration order.

### 9.3 CPython `set` Memory
- Empty set: `sys.getsizeof(set())` = 216 bytes (CPython 3.12).
- Each element: 8 bytes for pointer + hash storage overhead.

### 9.4 PyPy
- PyPy may use a different internal set representation (e.g., strategy-based: int-set, string-set).
- Iteration order differs from CPython.
- Performance characteristics are similar for typical use.

---

## 10. Spec Compliance Checklist

- [ ] Empty set created with `set()`, not `{}`
- [ ] All elements must be hashable (`__hash__` and `__eq__` required)
- [ ] `remove()` raises `KeyError` for absent elements; `discard()` is silent
- [ ] `pop()` returns an arbitrary element (non-deterministic)
- [ ] Set operators (`|`, `&`, `-`, `^`) require set/frozenset operands
- [ ] Set methods (`union()`, `intersection()`) accept any iterable
- [ ] `frozenset` is hashable; can be used as dict key or set element
- [ ] `set.__hash__` is `None`; `set` objects are not hashable
- [ ] Iteration order is unspecified; code must not rely on it
- [ ] `True == 1` and `False == 0` deduplication in sets understood

---

## 11. Official Examples (Runnable Python 3.10+)

```python
# ----------------------------------------------------------------
# 1. Set creation
# ----------------------------------------------------------------
s1 = {1, 2, 3, 4, 5}
s2 = set([3, 4, 5, 6, 7])
s3 = set("hello")              # {'h', 'e', 'l', 'o'}  — deduplicated
empty = set()
frozen = frozenset([1, 2, 3])

print(type({}))    # <class 'dict'>  — NOT a set!
print(type(set()))  # <class 'set'>
print(s3)           # {'h', 'e', 'l', 'o'} (or any order)


# ----------------------------------------------------------------
# 2. Membership test O(1) vs list O(n)
# ----------------------------------------------------------------
large_set  = set(range(1_000_000))
large_list = list(range(1_000_000))

print(999_999 in large_set)    # True  — O(1) hash lookup
print(999_999 in large_list)   # True  — O(n) linear scan


# ----------------------------------------------------------------
# 3. Set operations
# ----------------------------------------------------------------
a = {1, 2, 3, 4, 5}
b = {3, 4, 5, 6, 7}

print(a | b)   # union:               {1, 2, 3, 4, 5, 6, 7}
print(a & b)   # intersection:        {3, 4, 5}
print(a - b)   # difference (a-b):    {1, 2}
print(b - a)   # difference (b-a):    {6, 7}
print(a ^ b)   # symmetric difference:{1, 2, 6, 7}


# ----------------------------------------------------------------
# 4. Method vs operator (iterable vs set)
# ----------------------------------------------------------------
s = {1, 2, 3}
print(s.union([4, 5, 6]))              # {1, 2, 3, 4, 5, 6}
print(s.intersection(range(2, 5)))     # {2, 3}
print(s.difference(range(1, 3)))       # {3}

# Operators require set type:
try:
    print(s | [4, 5])
except TypeError as e:
    print(e)   # unsupported operand type(s) for |: 'set' and 'list'


# ----------------------------------------------------------------
# 5. Mutation methods
# ----------------------------------------------------------------
s = {1, 2, 3}
s.add(4)         # {1, 2, 3, 4}
s.discard(10)    # no-op (10 not in s)
s.remove(2)      # {1, 3, 4}
try:
    s.remove(99)
except KeyError:
    print("KeyError: 99 not in set")

s.update([5, 6, 7])   # {1, 3, 4, 5, 6, 7}
print(s)


# ----------------------------------------------------------------
# 6. In-place operators
# ----------------------------------------------------------------
s = {1, 2, 3}
s |= {4, 5}     # s = s | {4, 5}
s &= {2, 3, 4} # s = s & {2, 3, 4}
print(s)   # {2, 3, 4}


# ----------------------------------------------------------------
# 7. Subset / superset relations
# ----------------------------------------------------------------
a = {1, 2, 3}
b = {1, 2, 3, 4, 5}
print(a <= b)            # True  (a is subset of b)
print(a < b)             # True  (a is proper subset)
print(b >= a)            # True  (b is superset)
print(a.issubset(b))     # True
print(b.issuperset(a))   # True
print(a.isdisjoint({6, 7, 8}))  # True


# ----------------------------------------------------------------
# 8. Set comprehension
# ----------------------------------------------------------------
evens   = {x for x in range(20) if x % 2 == 0}
squares = {x**2 for x in range(-5, 6)}
print(evens)    # {0, 2, 4, 6, 8, 10, 12, 14, 16, 18}
print(squares)  # {0, 1, 4, 9, 16, 25}


# ----------------------------------------------------------------
# 9. frozenset as dict key
# ----------------------------------------------------------------
# Use case: represent a pair of items regardless of order
graph_edges = {
    frozenset({"A", "B"}): 5,
    frozenset({"B", "C"}): 3,
    frozenset({"A", "C"}): 7,
}
print(graph_edges[frozenset({"B", "A"})])   # 5 (same as frozenset({"A","B"}))


# ----------------------------------------------------------------
# 10. True/False deduplication
# ----------------------------------------------------------------
s = {0, False, 1, True, 2}
print(s)      # {0, 1, 2}  — True==1, False==0
print(len(s)) # 3


# ----------------------------------------------------------------
# 11. * unpacking in set literals (PEP 448)
# ----------------------------------------------------------------
s1 = {1, 2, 3}
s2 = {4, 5, 6}
combined = {*s1, *s2, 7}
print(combined)   # {1, 2, 3, 4, 5, 6, 7}


# ----------------------------------------------------------------
# 12. Practical: deduplication preserving some structure
# ----------------------------------------------------------------
words = ["apple", "banana", "apple", "cherry", "banana", "date"]
unique = set(words)
print(unique)   # {'apple', 'banana', 'cherry', 'date'} (unordered)

# If order matters (Python 3.7+ dict preserves insertion order):
seen = set()
unique_ordered = [w for w in words if not (w in seen or seen.add(w))]
print(unique_ordered)   # ['apple', 'banana', 'cherry', 'date'] (ordered)
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| §3.2 | Set types | https://docs.python.org/3/reference/datamodel.html#set-types |
| §6.2.7 | Set displays | https://docs.python.org/3/reference/expressions.html#set-displays |
| `set` | Built-in set type | https://docs.python.org/3/library/stdtypes.html#set-types-set-frozenset |
| `frozenset` | Built-in frozenset | https://docs.python.org/3/library/stdtypes.html#frozenset |
| `hash()` | Built-in hash function | https://docs.python.org/3/library/functions.html#hash |
| `__hash__` | Hash protocol | https://docs.python.org/3/reference/datamodel.html#object.__hash__ |
| PEP 218 | Adding a built-in set type | https://peps.python.org/pep-0218/ |
| PEP 448 | Unpacking generalizations | https://peps.python.org/pep-0448/ |
| PEP 585 | `set[T]` generic syntax | https://peps.python.org/pep-0585/ |
