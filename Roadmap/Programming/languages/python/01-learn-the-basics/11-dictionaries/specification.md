# Python Dictionaries — Language Specification

## 1. Spec Reference

- **Primary source:** Python Language Reference, §3.2 — Mapping types
  https://docs.python.org/3/reference/datamodel.html#mapping-types
- **Built-in dict type:** https://docs.python.org/3/library/stdtypes.html#mapping-types-dict
- **Dict display grammar:** §6.2.6
  https://docs.python.org/3/reference/expressions.html#dictionary-displays
- **`collections.OrderedDict`, `defaultdict`, `ChainMap`, `Counter`:**
  https://docs.python.org/3/library/collections.html
- **`typing.TypedDict`:** https://docs.python.org/3/library/typing.html#typing.TypedDict
- **Python 3.12 standard:** All rules here apply to CPython 3.12 unless otherwise noted.

---

## 2. Formal Grammar (EBNF)

### 2.1 Dictionary Display (Literal)
```
dict_display      ::= "{" [key_datum_list | dict_comprehension] "}"
key_datum_list    ::= key_datum ("," key_datum)* [","]
key_datum         ::= expression ":" expression
                    | "**" or_expr
dict_comprehension::= expression ":" expression comp_for
```

### 2.2 Subscription (Key Lookup and Assignment)
```
subscription ::= primary "[" expression_list "]"
# For dict: key lookup → d[key]
# For dict: key assignment → d[key] = value
# For dict: key deletion → del d[key]
```

### 2.3 Dict Merge Operators (Python 3.9+, PEP 584)
```
merge_expr   ::= dict_expr "|" dict_expr   # returns new dict
update_expr  ::= dict_expr "|=" dict_expr  # in-place update (augmented assignment)
```

---

## 3. Core Rules and Constraints

### 3.1 Dictionary Characteristics
- **Ordered:** Since Python 3.7, dicts preserve insertion order (was implementation detail in 3.6, guaranteed in 3.7).
- **Mutable:** key-value pairs can be added, updated, or deleted.
- **Keys must be hashable:** keys must define `__hash__` and `__eq__`.
- **Values can be any object:** no restriction on value types.
- **Keys are unique:** duplicate key assignment overwrites the previous value.
- **No duplicate keys in a literal:** `{"a": 1, "a": 2}` is valid syntax; the second value wins.

### 3.2 Key Lookup
- `d[key]` raises `KeyError` if `key` is not present.
- `d.get(key)` returns `None` if not present (no exception).
- `d.get(key, default)` returns `default` if not present.
- Lookup uses `hash(key)` then `key.__eq__` for collision resolution.

### 3.3 Insertion Order (Python 3.7+)
- `dict` is ordered by insertion order.
- When iterating with `for k in d`, `d.keys()`, `d.values()`, `d.items()` — order is insertion order.
- Updating an existing key does **not** change its position; deletion and re-insertion moves it to the end.

### 3.4 Key Equality and Hashability
- Two keys are considered equal if `hash(k1) == hash(k2)` and `k1 == k2`.
- `1` and `True` are equal (`True == 1`, `hash(True) == hash(1) == 1`); they are the same key.
- `1.0` and `1` are equal (`1.0 == 1`, `hash(1.0) == hash(1)`); same key.
- `list`, `set`, `dict` cannot be keys (unhashable). `tuple` and `frozenset` can be keys (if all elements are hashable).

### 3.5 Dict Merging (Python 3.9+)
- `d1 | d2` creates a new dict; for duplicate keys, `d2` values win.
- `d1 |= d2` updates `d1` in-place; for duplicate keys, `d2` values win.
- Before Python 3.9: use `{**d1, **d2}` or `d1.update(d2)`.

### 3.6 Iteration During Mutation
- Adding or removing keys during iteration over a dict raises `RuntimeError` in CPython 3.3+.
- Modifying the **value** of an existing key during iteration is safe.

---

## 4. Type Rules (Dunder Methods and Protocols)

### 4.1 Mapping Protocol
```python
object.__getitem__(self, key) -> value
# Called by d[key]. Raises KeyError if key absent.

object.__setitem__(self, key, value)
# Called by d[key] = value.

object.__delitem__(self, key)
# Called by del d[key]. Raises KeyError if absent.

object.__iter__(self) -> iterator
# Iterates over keys.

object.__len__(self)  -> int
# Number of key-value pairs.

object.__contains__(self, key) -> bool
# Called by 'key in d'. Default falls back to __iter__.
```

### 4.2 `collections.abc.Mapping` Abstract Base
```python
# Inheriting from Mapping requires only: __getitem__, __iter__, __len__
# Provides default implementations of: get, __contains__, keys, items, values, __eq__, __ne__

# Inheriting from MutableMapping additionally requires: __setitem__, __delitem__
# Provides: pop, popitem, clear, update, setdefault
```

### 4.3 Merge Protocol Dunders
```python
object.__or__(self, other)   -> dict   # d1 | d2 (Python 3.9+)
object.__ior__(self, other)  -> self   # d1 |= d2
object.__ror__(self, other)  -> dict   # other | d1 (reflected)
```

### 4.4 `__missing__` Protocol
```python
object.__missing__(self, key) -> value
# Called by dict.__getitem__ if key is not found.
# Used by collections.defaultdict.
```

---

## 5. Behavioral Specification

### 5.1 `dict()` Constructor
- `dict()` → empty dict.
- `dict(**kwargs)` → dict from keyword arguments.
- `dict(mapping)` → dict from any mapping.
- `dict(iterable)` → dict from iterable of `(key, value)` pairs.
- `dict(mapping, **kwargs)` → combines mapping and keyword args; kwargs override.

### 5.2 `dict` Methods (Full Spec)
| Method | Description | Returns |
|--------|-------------|---------|
| `d[key]` | Get value; `KeyError` if absent | value |
| `d[key] = val` | Set/update value | — |
| `del d[key]` | Delete key; `KeyError` if absent | — |
| `key in d` | Membership test (O(1)) | `bool` |
| `key not in d` | Non-membership test | `bool` |
| `d.get(key[, default])` | Get value or default (no exception) | value or default |
| `d.setdefault(key[, default])` | Get value; insert default if missing | value |
| `d.pop(key[, default])` | Remove and return; `KeyError` if no default | value |
| `d.popitem()` | Remove and return last inserted (LIFO); `KeyError` if empty | `(key, value)` |
| `d.update([other[, **kwargs]])` | Update from mapping/iterable/kwargs | `None` |
| `d.clear()` | Remove all items | `None` |
| `d.copy()` | Shallow copy | `dict` |
| `d.keys()` | View of keys | `dict_keys` |
| `d.values()` | View of values | `dict_values` |
| `d.items()` | View of `(key, value)` pairs | `dict_items` |

### 5.3 View Objects (dict_keys, dict_values, dict_items)
- Views are **dynamic**: they reflect changes to the dict.
- `dict_keys` and `dict_items` support set operations (`|`, `&`, `-`, `^`) if values are hashable.
- `dict_keys` supports `in` test in O(1).
- Views can be iterated but not indexed.
- Mutating the dict during iteration of a view raises `RuntimeError`.

### 5.4 `setdefault` vs `get` vs `d[key]`
```python
# d.get(key, default): read-only; does not modify dict
val = d.get("x", 0)

# d.setdefault(key, default): inserts if missing; modifies dict
val = d.setdefault("x", 0)

# d[key]: raises KeyError if missing
val = d["x"]
```

### 5.5 `defaultdict` (`collections.defaultdict`)
- Subclass of `dict`; defines `__missing__` to call the `default_factory`.
- `defaultdict(list)` — missing key returns `[]` and inserts it.
- `defaultdict(int)` — missing key returns `0`.
- `default_factory` is called with no arguments.

### 5.6 `**` Unpacking in Dict Literals
- `{**d1, **d2, "extra": val}` creates a new dict.
- For duplicate keys, the **last** occurrence wins.
- Available since Python 3.5 (PEP 448).

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined
- `d[key]` raises `KeyError` for absent keys.
- `del d[key]` raises `KeyError` for absent keys.
- Insertion order preserved since Python 3.7 (spec guarantee).
- `d.popitem()` removes the **last inserted** item (LIFO since Python 3.7).
- `True` and `1` are the same key; `False` and `0` are the same key.
- Merging with `|` or `update`: last-writer-wins for duplicate keys.
- Views reflect the current state of the dict dynamically.

### 6.2 Undefined / Implementation-Defined
- **Exact `id()` of dict internals:** implementation-defined.
- **Hash collision strategy:** CPython uses open addressing with pseudo-random probing. The exact probing sequence is not specified.
- **Dict resizing threshold:** CPython resizes when load factor exceeds 2/3. The growth factor and exact table sizes are implementation details.
- **`d.keys()` vs `d.values()` consistency under concurrent modification:** not defined for multithreaded use without the GIL.

---

## 7. Edge Cases from the Spec (CPython-Specific Notes)

### 7.1 `True`/`1`/`1.0` Are the Same Key
```python
d = {}
d[1] = "one"
d[True] = "true"     # overwrites d[1]!
d[1.0] = "float one" # overwrites d[True]!

print(d)       # {1: 'float one'}
print(len(d))  # 1
print(d[True]) # 'float one'
print(d[1.0])  # 'float one'
```

### 7.2 Dict Comprehension Duplicate Keys
```python
# Last value wins for duplicate keys in comprehension:
d = {k % 3: k for k in range(9)}
print(d)   # {0: 6, 1: 7, 2: 8}  — last assignment wins
```

### 7.3 `RuntimeError` on Mutation During Iteration
```python
d = {"a": 1, "b": 2, "c": 3}
try:
    for k in d:
        del d[k]   # RuntimeError!
except RuntimeError as e:
    print(e)   # dictionary changed size during iteration

# Safe: iterate over a copy
for k in list(d.keys()):
    del d[k]
print(d)   # {}
```

### 7.4 `setdefault` for Grouping
```python
data = [("Alice", 90), ("Bob", 85), ("Alice", 95), ("Bob", 88)]
groups = {}
for name, score in data:
    groups.setdefault(name, []).append(score)
print(groups)
# {'Alice': [90, 95], 'Bob': [85, 88]}

# Equivalent with defaultdict:
from collections import defaultdict
groups2 = defaultdict(list)
for name, score in data:
    groups2[name].append(score)
print(dict(groups2))
```

### 7.5 `popitem()` LIFO Order (Python 3.7+)
```python
d = {"a": 1, "b": 2, "c": 3}
print(d.popitem())   # ('c', 3)  — last inserted
print(d.popitem())   # ('b', 2)
print(d.popitem())   # ('a', 1)
```

### 7.6 Dict View Set Operations
```python
d1 = {"a": 1, "b": 2, "c": 3}
d2 = {"b": 20, "c": 30, "d": 40}

common_keys = d1.keys() & d2.keys()
print(common_keys)   # {'b', 'c'}

only_d1 = d1.keys() - d2.keys()
print(only_d1)   # {'a'}

# items() supports set ops only if values are hashable:
common_items = d1.items() & d2.items()
print(common_items)   # set() — no item is identical in both
```

### 7.7 `|` Merge Operator (Python 3.9+)
```python
defaults = {"color": "blue", "size": "medium", "weight": 1.0}
overrides = {"color": "red", "material": "steel"}

config = defaults | overrides
print(config)
# {'color': 'red', 'size': 'medium', 'weight': 1.0, 'material': 'steel'}

# In-place:
defaults |= overrides
print(defaults)
# Same result; defaults modified in-place
```

---

## 8. Version History (PEPs and Python Versions)

| Feature | PEP | Version |
|---------|-----|---------|
| `dict` built-in | — | Python 1.0 |
| `dict.keys()`, `values()`, `items()` returning views (not lists) | PEP 3106 | Python 3.0 |
| Dict comprehensions `{k: v for ...}` | PEP 274 | Python 2.7 / 3.0 |
| `**` unpacking in dict literals and calls | PEP 448 | Python 3.5 |
| `typing.TypedDict` | PEP 589 | Python 3.8 |
| Insertion-order preservation as language spec guarantee | — | Python 3.7 |
| CPython 3.6 ordered dict (implementation detail) | — | Python 3.6 |
| `dict | dict` merge operator | PEP 584 | Python 3.9 |
| `dict |= dict` in-place merge | PEP 584 | Python 3.9 |
| `dict[K, V]` subscript in type hints | PEP 585 | Python 3.9 |
| `typing.TypedDict` with `Required`/`NotRequired` | PEP 655 | Python 3.11 |

---

## 9. Implementation-Specific Behavior

### 9.1 CPython dict Compact Representation
- Since CPython 3.6, `dict` uses a compact representation: a sparse index array + a dense array of entries.
- This reduces memory usage compared to the pre-3.6 open-addressing table.
- Insertion order is maintained by the dense entries array.

### 9.2 CPython dict Memory
- Empty dict: `sys.getsizeof({})` = 64 bytes (CPython 3.12 on 64-bit).
- Each entry: ~50 bytes (key pointer + value pointer + hash).

### 9.3 CPython Resizing
- `dict` resizes (doubles) when more than 2/3 of the index array is used.
- Resize triggers rehashing of all entries.
- Deletion does not immediately shrink the dict; only resize does.

### 9.4 PyPy
- PyPy has a similar ordered dict implementation.
- May differ in memory usage and exact resize thresholds.
- `sys.getsizeof()` results differ from CPython.

### 9.5 `collections.OrderedDict` vs `dict`
- In Python 3.7+, `dict` preserves insertion order, making `OrderedDict` redundant for most uses.
- `OrderedDict` still has `move_to_end(key, last=True)` and supports comparison that considers order.
- Two `OrderedDict`s with same items in different order are NOT equal; two `dict`s are.

---

## 10. Spec Compliance Checklist

- [ ] `d[key]` raises `KeyError`; use `d.get(key)` for safe access
- [ ] Keys must be hashable; `list`, `set`, `dict` cannot be keys
- [ ] `True`, `1`, and `1.0` are the same key (hash equality)
- [ ] Insertion order preserved (Python 3.7+); do not rely on order in Python 3.6-
- [ ] Mutation during iteration raises `RuntimeError`; iterate over a copy
- [ ] `popitem()` is LIFO since Python 3.7
- [ ] Dict views are dynamic (reflect current state)
- [ ] `|` operator requires both operands to be `dict` (Python 3.9+)
- [ ] `.update()` accepts any mapping or iterable of pairs
- [ ] `**` unpacking: last key wins for duplicates
- [ ] `TypedDict` annotations not enforced at runtime

---

## 11. Official Examples (Runnable Python 3.10+)

```python
from collections import defaultdict, Counter, ChainMap, OrderedDict
from typing import TypedDict

# ----------------------------------------------------------------
# 1. Creating dicts
# ----------------------------------------------------------------
d1 = {"name": "Alice", "age": 30}
d2 = dict(name="Bob", age=25)
d3 = dict([("x", 1), ("y", 2)])
d4 = {k: k**2 for k in range(5)}

print(d1)   # {'name': 'Alice', 'age': 30}
print(d4)   # {0: 0, 1: 1, 2: 4, 3: 9, 4: 16}


# ----------------------------------------------------------------
# 2. Access patterns
# ----------------------------------------------------------------
d = {"a": 1, "b": 2}
print(d["a"])              # 1
print(d.get("c"))          # None
print(d.get("c", 0))       # 0
print(d.setdefault("c", 0)) # inserts "c": 0, returns 0
print(d)                   # {'a': 1, 'b': 2, 'c': 0}


# ----------------------------------------------------------------
# 3. Mutation
# ----------------------------------------------------------------
d = {"a": 1}
d["b"] = 2        # add
d["a"] = 10       # update
del d["b"]        # delete
print(d)           # {'a': 10}

d.update({"b": 20, "c": 30})
print(d)           # {'a': 10, 'b': 20, 'c': 30}

val = d.pop("b")
print(val, d)      # 20 {'a': 10, 'c': 30}

last = d.popitem() # LIFO: ('c', 30)
print(last, d)     # ('c', 30) {'a': 10}


# ----------------------------------------------------------------
# 4. dict views
# ----------------------------------------------------------------
d = {"x": 1, "y": 2, "z": 3}
keys   = d.keys()
values = d.values()
items  = d.items()

d["w"] = 4   # views update dynamically
print(list(keys))    # ['x', 'y', 'z', 'w']
print(list(values))  # [1, 2, 3, 4]

for k, v in items:
    print(f"{k}={v}", end=" ")   # x=1 y=2 z=3 w=4
print()


# ----------------------------------------------------------------
# 5. Key membership
# ----------------------------------------------------------------
d = {"a": 1, "b": 2}
print("a" in d)         # True   (O(1))
print("c" not in d)     # True
print("a" in d.keys())  # True   (equivalent)
print(1 in d.values())  # True   (O(n))


# ----------------------------------------------------------------
# 6. ** unpacking (PEP 448)
# ----------------------------------------------------------------
defaults = {"debug": False, "timeout": 30}
overrides = {"timeout": 60, "verbose": True}
config = {**defaults, **overrides}
print(config)   # {'debug': False, 'timeout': 60, 'verbose': True}


# ----------------------------------------------------------------
# 7. | merge operator (Python 3.9+, PEP 584)
# ----------------------------------------------------------------
base = {"a": 1, "b": 2}
patch = {"b": 20, "c": 30}
merged = base | patch
print(merged)   # {'a': 1, 'b': 20, 'c': 30}

base |= patch   # in-place
print(base)     # {'a': 1, 'b': 20, 'c': 30}


# ----------------------------------------------------------------
# 8. defaultdict
# ----------------------------------------------------------------
word_count = defaultdict(int)
for word in "the quick brown fox jumps over the lazy dog".split():
    word_count[word] += 1
print(dict(word_count))

grouped = defaultdict(list)
data = [("math", 90), ("eng", 85), ("math", 92), ("eng", 88)]
for subject, score in data:
    grouped[subject].append(score)
print(dict(grouped))   # {'math': [90, 92], 'eng': [85, 88]}


# ----------------------------------------------------------------
# 9. Counter
# ----------------------------------------------------------------
from collections import Counter
text = "mississippi"
c = Counter(text)
print(c)                        # Counter({'s': 4, 'i': 4, 'p': 2, 'm': 1})
print(c.most_common(2))         # [('s', 4), ('i', 4)]
print(c["s"])                   # 4
print(c["z"])                   # 0 (no KeyError for Counter!)


# ----------------------------------------------------------------
# 10. True/1/1.0 same key
# ----------------------------------------------------------------
d = {1: "one"}
d[True] = "True"    # overwrites d[1]
d[1.0]  = "1.0"    # overwrites again
print(d)            # {1: '1.0'}
print(len(d))       # 1


# ----------------------------------------------------------------
# 11. TypedDict (Python 3.8+)
# ----------------------------------------------------------------
class Movie(TypedDict):
    title: str
    year: int
    rating: float

# TypedDict is for static type checking only; runtime is just a dict:
m: Movie = {"title": "Inception", "year": 2010, "rating": 8.8}
print(m["title"])           # Inception
print(isinstance(m, dict))  # True


# ----------------------------------------------------------------
# 12. ChainMap (lookup through multiple dicts)
# ----------------------------------------------------------------
defaults = {"color": "blue", "user": "guest"}
environ  = {"user": "alice"}
config   = ChainMap(environ, defaults)
print(config["user"])    # alice  (environ wins)
print(config["color"])   # blue   (from defaults)
print(list(config.keys()))  # ['user', 'color']
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| §3.2 | Mapping types | https://docs.python.org/3/reference/datamodel.html#mapping-types |
| §6.2.6 | Dictionary displays | https://docs.python.org/3/reference/expressions.html#dictionary-displays |
| §3.3.7 | `__missing__` | https://docs.python.org/3/reference/datamodel.html#object.__missing__ |
| `dict` | Built-in dict type | https://docs.python.org/3/library/stdtypes.html#mapping-types-dict |
| `collections` | OrderedDict, defaultdict | https://docs.python.org/3/library/collections.html |
| `collections.abc` | MutableMapping ABC | https://docs.python.org/3/library/collections.abc.html |
| `typing.TypedDict` | Typed dict | https://docs.python.org/3/library/typing.html#typing.TypedDict |
| PEP 274 | Dict comprehensions | https://peps.python.org/pep-0274/ |
| PEP 448 | Unpacking generalizations | https://peps.python.org/pep-0448/ |
| PEP 584 | Dict merge operators `\|` | https://peps.python.org/pep-0584/ |
| PEP 585 | `dict[K, V]` subscript | https://peps.python.org/pep-0585/ |
| PEP 589 | `TypedDict` | https://peps.python.org/pep-0589/ |
| PEP 655 | `Required`/`NotRequired` in TypedDict | https://peps.python.org/pep-0655/ |
| PEP 3106 | Views for dict methods | https://peps.python.org/pep-3106/ |
