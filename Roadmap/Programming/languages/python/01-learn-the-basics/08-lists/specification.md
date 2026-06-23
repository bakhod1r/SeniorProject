# Python Lists — Language Specification

## 1. Spec Reference

- **Primary source:** Python Language Reference, §3.2 — Mutable Sequences
  https://docs.python.org/3/reference/datamodel.html#mutable-sequence-types
- **Built-in list type:** https://docs.python.org/3/library/stdtypes.html#list
- **Sequence operations:** https://docs.python.org/3/library/stdtypes.html#sequence-types-list-tuple-range
- **List display (comprehension) grammar:** §6.2.5
  https://docs.python.org/3/reference/expressions.html#list-displays
- **Python 3.12 standard:** All rules here apply to CPython 3.12 unless otherwise noted.

---

## 2. Formal Grammar (EBNF)

### 2.1 List Display (Literal)
```
list_display ::= "[" [starred_list | comprehension] "]"
starred_list ::= starred_item ("," starred_item)* [","]
starred_item ::= assignment_expression | "*" or_expr
comprehension ::= assignment_expression comp_for
comp_for      ::= ["async"] "for" target_list "in" or_test [comp_iter]
comp_iter     ::= comp_for | comp_if
comp_if       ::= "if" or_test [comp_iter]
```

### 2.2 Subscription and Slicing
```
subscription ::= primary "[" expression_list "]"
slicing      ::= primary "[" slice_list "]"
slice_list   ::= slice_item ("," slice_item)* [","]
slice_item   ::= expression | proper_slice
proper_slice ::= [lower_bound] ":" [upper_bound] [":" [stride]]
lower_bound  ::= expression
upper_bound  ::= expression
stride       ::= expression
```

### 2.3 Augmented Assignment (in-place extend)
```
augmented_assign ::= target "+=" expression_list
```

---

## 3. Core Rules and Constraints

### 3.1 list Characteristics
- **Ordered:** elements maintain insertion order.
- **Mutable:** elements can be added, removed, or replaced in-place.
- **Heterogeneous:** elements may be of any type; a list may contain mixed types.
- **Dynamic:** no fixed size; grows and shrinks automatically.
- **Zero-indexed:** first element at index `0`; last at index `len(lst) - 1`.
- Supports negative indexing: `lst[-1]` is equivalent to `lst[len(lst) - 1]`.

### 3.2 Index Rules
- Valid index range: `-(len(lst)) <= i < len(lst)`.
- Index out of range raises `IndexError`.
- Negative indexing: `-1` is last, `-2` is second-to-last, etc.
- Assigning to an out-of-range index raises `IndexError`.

### 3.3 Slice Rules
- Slice `lst[i:j]` returns a **new list** containing elements `lst[i], lst[i+1], ..., lst[j-1]`.
- If `i >= j`, returns an empty list.
- Out-of-range slice indices are silently clamped to `[0, len(lst)]`.
- Slice assignment `lst[i:j] = iterable` replaces the slice with the elements of the iterable; lengths need not match.
- `del lst[i:j]` removes the slice.
- Stride slicing: `lst[::2]` (every other element), `lst[::-1]` (reversed copy).

### 3.4 Mutation During Iteration
- Modifying a list during iteration over it produces undefined behavior (may skip elements, repeat elements, or raise `IndexError`).
- Safe approaches: iterate over a copy (`lst[:]`) or accumulate changes and apply after.

### 3.5 Equality and Identity
- `lst1 == lst2`: True if all elements compare equal in order and lengths are equal (recursive comparison).
- `lst1 is lst2`: True only if both variables reference the exact same list object.
- `lst.copy()` or `lst[:]` creates a **shallow copy** — nested mutable objects are shared.

### 3.6 Sorting Stability
- `list.sort()` and `sorted()` use **Timsort**, which is a stable sort algorithm.
- Stability: equal elements maintain their original relative order.
- Guaranteed since Python 2.2.

---

## 4. Type Rules (Dunder Methods and Protocols)

### 4.1 Sequence Protocol
```python
object.__len__(self)           -> int         # len(lst)
object.__getitem__(self, key)  -> value       # lst[i], lst[i:j]
object.__setitem__(self, key, value)          # lst[i] = v, lst[i:j] = iterable
object.__delitem__(self, key)                 # del lst[i], del lst[i:j]
object.__iter__(self)          -> iterator    # iter(lst), for x in lst
object.__reversed__(self)      -> iterator    # reversed(lst)
object.__contains__(self, item) -> bool       # x in lst
```

### 4.2 Concatenation and Repetition
```python
object.__add__(self, other)    -> list   # lst1 + lst2 (returns new list)
object.__iadd__(self, other)   -> self   # lst += iterable (in-place extend)
object.__mul__(self, n)        -> list   # lst * n
object.__rmul__(self, n)       -> list   # n * lst
object.__imul__(self, n)       -> self   # lst *= n
```

### 4.3 Comparison Protocol
```python
# Lists compare lexicographically using element __lt__, __eq__, etc.
object.__lt__(self, other)    # [1, 2] < [1, 3]
object.__le__(self, other)
object.__eq__(self, other)
object.__ne__(self, other)
object.__gt__(self, other)
object.__ge__(self, other)
```

### 4.4 `sort` Key Protocol
```python
# key callable: key(element) -> comparable value
lst.sort(key=None, reverse=False)
# key: a callable applied to each element before comparison
# Uses __lt__ of the key values for comparison
```

---

## 5. Behavioral Specification

### 5.1 `list()` Constructor
- `list()` → empty list.
- `list(iterable)` → list containing all elements of the iterable, in iteration order.
- `list(lst)` → shallow copy.

### 5.2 `list` Methods (Full Spec)
| Method | Spec | Complexity |
|--------|------|-----------|
| `append(x)` | Adds `x` to end; equivalent to `lst[len(lst):] = [x]` | O(1) amortized |
| `extend(iterable)` | Appends all items of iterable; equivalent to `lst[len(lst):] = iterable` | O(k) |
| `insert(i, x)` | Insert `x` before index `i`; `i >= len` appends | O(n) |
| `remove(x)` | Removes first occurrence of `x`; raises `ValueError` if not present | O(n) |
| `pop([i])` | Removes and returns item at index `i` (default `-1`) | O(1) end, O(n) middle |
| `clear()` | Removes all items; equivalent to `del lst[:]` | O(1) |
| `index(x[, start[, stop]])` | Returns index of first `x`; raises `ValueError` if absent | O(n) |
| `count(x)` | Returns number of occurrences of `x` | O(n) |
| `sort(*, key=None, reverse=False)` | Sorts in-place; stable (Timsort) | O(n log n) |
| `reverse()` | Reverses in-place | O(n) |
| `copy()` | Returns shallow copy | O(n) |

### 5.3 `+` vs `extend` vs `+=`
- `lst1 + lst2` → returns a **new** list; neither is modified.
- `lst.extend(iterable)` → modifies `lst` in-place; returns `None`.
- `lst += iterable` → calls `__iadd__`; modifies `lst` in-place; rebinds variable to `lst`.
- `lst * n` → returns a new list with `lst` repeated `n` times; elements are **not copied** (shallow).

### 5.4 Comprehension Scoping
- List comprehensions in Python 3 create a local scope for iteration variables.
- The comprehension variable does not leak into the enclosing scope.
- Walrus operator (`:=`) inside a comprehension binds in the **enclosing** scope.

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined
- `append`, `extend`, `pop()` (last element) are O(1) amortized.
- `sort()` is stable; equal elements keep original order.
- Slice assignment with mismatched length is valid: `[1,2,3][1:2] = [10, 20, 30]` → `[1, 10, 20, 30, 3]`.
- `list * 0` → `[]`.
- `list * n` for negative `n` → `[]`.
- `in` operator uses `__eq__` for comparison, iterates from left.

### 6.2 Undefined / Implementation-Defined
- **Growth factor:** CPython's list growth factor is approximately 1.125× (over-allocates to amortize appends). The exact factor is implementation-defined.
- **Memory layout:** `list` stores an array of pointers (PyObject*) in CPython; the internal array may be larger than `len()`.
- **Mutation during iteration:** the behavior is not defined by the spec; it produces surprising results in CPython.

---

## 7. Edge Cases from the Spec (CPython-Specific Notes)

### 7.1 Shallow vs Deep Copy
```python
original = [[1, 2], [3, 4]]
shallow  = original.copy()
import copy
deep     = copy.deepcopy(original)

shallow[0].append(99)   # modifies original[0] too!
print(original)          # [[1, 2, 99], [3, 4]]

deep[0].append(99)       # original unaffected
```

### 7.2 `list * n` Shares References
```python
inner = [0]
matrix = [inner] * 3     # three references to the SAME inner list
matrix[0].append(1)
print(matrix)   # [[0, 1], [0, 1], [0, 1]]

# Fix: use a comprehension
matrix2 = [[0] for _ in range(3)]
matrix2[0].append(1)
print(matrix2)   # [[0, 1], [0], [0]]
```

### 7.3 `sort()` vs `sorted()`
```python
lst = [3, 1, 4, 1, 5]
sorted_copy = sorted(lst)   # returns NEW list; original unchanged
lst.sort()                   # modifies in-place; returns None
print(lst)          # [1, 1, 3, 4, 5]
print(sorted_copy)  # [1, 1, 3, 4, 5]

# Custom key
words = ["banana", "apple", "cherry"]
words.sort(key=len)    # sort by length
print(words)   # ['apple', 'banana', 'cherry']
```

### 7.4 Slice Assignment
```python
lst = [1, 2, 3, 4, 5]
lst[1:3] = [20, 30, 40]   # replace 2 items with 3
print(lst)   # [1, 20, 30, 40, 4, 5]

lst[1:4] = []   # delete items
print(lst)      # [1, 4, 5]

lst[1:1] = [10, 11, 12]   # insert without replacing
print(lst)      # [1, 10, 11, 12, 4, 5]
```

### 7.5 `remove()` Raises ValueError
```python
lst = [1, 2, 3]
try:
    lst.remove(99)
except ValueError as e:
    print(e)   # list.remove(x): x not in list
```

### 7.6 `pop()` from Empty List
```python
lst = []
try:
    lst.pop()
except IndexError as e:
    print(e)   # pop from empty list
```

### 7.7 `index()` with start/stop
```python
lst = [1, 2, 3, 2, 1]
print(lst.index(2))        # 1   — first occurrence
print(lst.index(2, 2))     # 3   — first from index 2
print(lst.index(2, 2, 4))  # 3   — first in slice [2:4]
# lst.index(2, 4)          # ValueError: not in slice
```

---

## 8. Version History (PEPs and Python Versions)

| Feature | PEP | Version |
|---------|-----|---------|
| `list` built-in | — | Python 1.0 |
| List comprehensions | — | Python 2.0 |
| `list.sort()` stability guaranteed (Timsort) | — | Python 2.2 |
| Generator expressions (alternative to comprehensions) | PEP 289 | Python 2.4 |
| `sorted()` built-in function | — | Python 2.4 |
| `key=` argument for sort (replaces `cmp=`) | PEP 3100 | Python 3.0 |
| `list.clear()` | — | Python 3.3 |
| `list.copy()` | — | Python 3.3 |
| Comprehension local scoping (Python 3) | — | Python 3.0 |
| `*` unpacking in list literals | PEP 448 | Python 3.5 |
| Walrus operator in comprehensions | PEP 572 | Python 3.8 |

---

## 9. Implementation-Specific Behavior

### 9.1 CPython list Growth Algorithm
- CPython over-allocates list storage to make `append()` amortized O(1).
- Growth formula (approximate): `new_size = old_size + old_size // 8 + (3 or 6)`.
- `sys.getsizeof([])` is 56 bytes (CPython 3.12 on 64-bit); each element adds 8 bytes (pointer).

### 9.2 Timsort
- Hybrid merge sort + insertion sort.
- Best case: O(n) for already-sorted data (detects "runs").
- Worst/average: O(n log n).
- Space: O(n).
- Used for both `list.sort()` and `sorted()` in CPython.

### 9.3 CPython `list.__contains__`
- Linear scan using `__eq__`.
- Short-circuits on first match.

### 9.4 PyPy
- PyPy stores lists using strategy-based optimization: a list of all integers uses a compact int array, not an array of Python objects. This saves memory and improves cache performance.
- `sys.getsizeof()` behavior differs from CPython.

---

## 10. Spec Compliance Checklist

- [ ] `list.sort()` returns `None`; use `sorted()` for a new sorted list
- [ ] `list * n` creates shallow copies of elements (shared references)
- [ ] Slice assignment with different-length iterable is valid
- [ ] `remove()` raises `ValueError` if element not found
- [ ] `pop()` raises `IndexError` on empty list
- [ ] Shallow copy: `lst.copy()` or `lst[:]`; use `copy.deepcopy()` for nested structures
- [ ] Modification during iteration leads to undefined behavior; use a copy
- [ ] Comprehension iteration variables are local (Python 3)
- [ ] `+=` on a list modifies in-place and rebinds the name
- [ ] `lst1 + lst2` returns a new list; does not modify either operand

---

## 11. Official Examples (Runnable Python 3.10+)

```python
import copy

# ----------------------------------------------------------------
# 1. Creating lists
# ----------------------------------------------------------------
empty   = []
numbers = [1, 2, 3, 4, 5]
mixed   = [1, "two", 3.0, [4, 5], None]
from_range = list(range(1, 11))
from_str   = list("hello")
print(from_range)  # [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
print(from_str)    # ['h', 'e', 'l', 'l', 'o']


# ----------------------------------------------------------------
# 2. Indexing and slicing
# ----------------------------------------------------------------
lst = [10, 20, 30, 40, 50]
print(lst[0])       # 10
print(lst[-1])      # 50
print(lst[1:4])     # [20, 30, 40]
print(lst[::-1])    # [50, 40, 30, 20, 10]
print(lst[::2])     # [10, 30, 50]


# ----------------------------------------------------------------
# 3. Mutation methods
# ----------------------------------------------------------------
lst = [1, 2, 3]
lst.append(4)         # [1, 2, 3, 4]
lst.extend([5, 6])    # [1, 2, 3, 4, 5, 6]
lst.insert(0, 0)      # [0, 1, 2, 3, 4, 5, 6]
lst.remove(3)         # [0, 1, 2, 4, 5, 6]
popped = lst.pop()    # popped=6, lst=[0, 1, 2, 4, 5]
print(lst)
print(lst.index(4))   # 3
print(lst.count(1))   # 1
lst.reverse()         # [5, 4, 2, 1, 0]
print(lst)


# ----------------------------------------------------------------
# 4. Sorting
# ----------------------------------------------------------------
data = [3, 1, 4, 1, 5, 9, 2, 6]
print(sorted(data))          # new list, original unchanged
data.sort()                  # in-place
print(data)                  # [1, 1, 2, 3, 4, 5, 6, 9]

# Custom sort key
words = ["banana", "apple", "kiwi", "cherry"]
words.sort(key=lambda w: (len(w), w))
print(words)   # ['kiwi', 'apple', 'banana', 'cherry']


# ----------------------------------------------------------------
# 5. List comprehensions
# ----------------------------------------------------------------
squares    = [x**2 for x in range(10)]
evens      = [x for x in range(20) if x % 2 == 0]
flat       = [x for row in [[1,2],[3,4],[5,6]] for x in row]
words_up   = [w.upper() for w in ["hello", "world"]]

print(squares[:5])  # [0, 1, 4, 9, 16]
print(flat)         # [1, 2, 3, 4, 5, 6]


# ----------------------------------------------------------------
# 6. Slice assignment
# ----------------------------------------------------------------
lst = [1, 2, 3, 4, 5]
lst[1:3] = [20, 30, 40]   # replace 2 items with 3
print(lst)                 # [1, 20, 30, 40, 4, 5]
lst[2:5] = []              # delete
print(lst)                 # [1, 20, 5]
lst[1:1] = [10, 11]        # insert before index 1
print(lst)                 # [1, 10, 11, 20, 5]


# ----------------------------------------------------------------
# 7. Shallow copy trap
# ----------------------------------------------------------------
a = [[1, 2], [3, 4]]
b = a.copy()          # shallow
b[0].append(99)       # modifies a[0] too
print(a)              # [[1, 2, 99], [3, 4]]

c = copy.deepcopy(a)
c[0].append(100)
print(a)              # [[1, 2, 99], [3, 4]]  — unchanged


# ----------------------------------------------------------------
# 8. list * n shallow copy trap
# ----------------------------------------------------------------
matrix = [[0] * 3 for _ in range(3)]   # CORRECT: 3 independent rows
matrix[0][0] = 1
print(matrix)   # [[1, 0, 0], [0, 0, 0], [0, 0, 0]]

wrong = [[0] * 3] * 3   # WRONG: 3 references to same row
wrong[0][0] = 1
print(wrong)    # [[1, 0, 0], [1, 0, 0], [1, 0, 0]]


# ----------------------------------------------------------------
# 9. Unpacking in list literals (PEP 448)
# ----------------------------------------------------------------
a = [1, 2, 3]
b = [4, 5, 6]
combined = [*a, *b]
print(combined)    # [1, 2, 3, 4, 5, 6]


# ----------------------------------------------------------------
# 10. Walrus operator in comprehension (binds in enclosing scope)
# ----------------------------------------------------------------
total = 0
processed = [total := total + x for x in range(1, 6)]
print(processed)   # [1, 3, 6, 10, 15]
print(total)       # 15  — visible in enclosing scope


# ----------------------------------------------------------------
# 11. enumerate and zip with lists
# ----------------------------------------------------------------
names  = ["Alice", "Bob", "Carol"]
scores = [95, 87, 92]

ranking = sorted(zip(scores, names), reverse=True)
for rank, (score, name) in enumerate(ranking, 1):
    print(f"{rank}. {name}: {score}")
# 1. Alice: 95
# 2. Carol: 92
# 3. Bob: 87
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| §3.2 | Mutable sequence types | https://docs.python.org/3/reference/datamodel.html#mutable-sequence-types |
| §6.2.5 | List displays | https://docs.python.org/3/reference/expressions.html#list-displays |
| `list` | Built-in list methods | https://docs.python.org/3/library/stdtypes.html#list |
| Sequence types | Common operations | https://docs.python.org/3/library/stdtypes.html#sequence-types-list-tuple-range |
| `copy` module | Shallow/deep copy | https://docs.python.org/3/library/copy.html |
| `functools.cmp_to_key` | Legacy cmp conversion | https://docs.python.org/3/library/functools.html#functools.cmp_to_key |
| `sorted()` | Built-in sort | https://docs.python.org/3/library/functions.html#sorted |
| PEP 289 | Generator expressions | https://peps.python.org/pep-0289/ |
| PEP 448 | Unpacking generalizations | https://peps.python.org/pep-0448/ |
| PEP 572 | Walrus operator | https://peps.python.org/pep-0572/ |
