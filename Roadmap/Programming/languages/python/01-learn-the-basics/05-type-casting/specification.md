# Python Type Casting — Language Specification

## 1. Spec Reference

- **Primary source:** Python Language Reference, §3.2 — The standard type hierarchy
  https://docs.python.org/3/reference/datamodel.html#the-standard-type-hierarchy
- **Built-in functions (`int`, `float`, `str`, etc.):**
  https://docs.python.org/3/library/functions.html
- **Numeric tower (PEP 3141):**
  https://docs.python.org/3/library/numbers.html
- **`__int__`, `__float__`, `__index__`, `__trunc__` protocols:**
  https://docs.python.org/3/reference/datamodel.html#emulating-numeric-types
- **Python 3.12 standard:** All rules here apply to CPython 3.12 unless otherwise noted.

---

## 2. Formal Grammar (EBNF)

Python has no special cast syntax; type conversion is performed through **constructor calls** and **built-in functions**. The grammar for a call expression covers all type conversions:

```
call             ::= primary "(" [argument_list [","] | comprehension] ")"
argument_list    ::= positional_arguments ["," starred_and_keywords]
                     ["," keywords_arguments]
                   | starred_and_keywords ["," keywords_arguments]
                   | keywords_arguments
positional_args  ::= assignment_expression ("," assignment_expression)*
```

### 2.1 Built-in Conversion Functions
```
int_call    ::= "int" "(" [x [, base]] ")"
float_call  ::= "float" "(" [x] ")"
complex_call::= "complex" "(" [real [, imag]] ")"
str_call    ::= "str" "(" [object [, encoding [, errors]]] ")"
bytes_call  ::= "bytes" "(" [source [, encoding [, errors]]] ")"
bool_call   ::= "bool" "(" [x] ")"
list_call   ::= "list" "(" [iterable] ")"
tuple_call  ::= "tuple" "(" [iterable] ")"
set_call    ::= "set" "(" [iterable] ")"
frozenset_call ::= "frozenset" "(" [iterable] ")"
dict_call   ::= "dict" "(" [mapping_or_iterable] ")" | "dict" "(" **kwargs ")"
```

---

## 3. Core Rules and Constraints

### 3.1 Explicit vs Implicit Conversion
- Python is **strongly typed**: it does NOT perform silent coercion between unrelated types.
- `"5" + 3` raises `TypeError` — unlike JavaScript or Perl.
- **Implicit numeric widening** is the exception: `int` + `float` → `float`; `float` + `complex` → `complex`.
  This follows the numeric tower (PEP 3141): `bool <: int <: float <: complex`.
- All other conversions must be **explicit**.

### 3.2 `int()` Conversion Rules
- `int(x)` where `x` is a number: truncates toward zero (same as `math.trunc()`).
- `int(x, base)` where `x` is `str`/`bytes`/`bytearray`: parses the string in the given base.
- Valid bases: 0 (auto-detect from prefix) or 2–36.
- Base 0 interprets `0b`, `0o`, `0x` prefixes; no prefix means decimal.
- `int` does not accept `float`-formatted strings like `"3.14"` — raises `ValueError`.
- Calls `x.__int__()` if defined; falls back to `x.__index__()`, then `x.__trunc__()`.
- Since Python 3.11, converting a very large string to int can be limited by `sys.set_int_max_str_digits()`.

### 3.3 `float()` Conversion Rules
- `float(x)` accepts numeric types or string representations.
- Strings: `"3.14"`, `"1e5"`, `"inf"`, `"-Inf"`, `"nan"` (case-insensitive).
- `float` does not accept non-numeric strings — raises `ValueError`.
- Calls `x.__float__()` if defined; falls back to `x.__index__()`.

### 3.4 `str()` Conversion Rules
- `str(obj)` calls `obj.__str__()`.
- If `__str__` is not defined (or returns `NotImplemented`), falls back to `obj.__repr__()`.
- `str(bytes_obj)` without encoding gives `"b'...'"` — not decoded.
- `str(bytes_obj, encoding)` calls `bytes_obj.decode(encoding)`.

### 3.5 `bytes()` Conversion Rules
- `bytes(int)`: creates a zero-filled bytes object of that length.
- `bytes(iterable)`: each element must be in [0, 255].
- `bytes(str, encoding)`: encodes string to bytes.
- `bytes(bytes_like)`: copies the bytes-like object.

### 3.6 `bool()` Conversion Rules
- Calls `x.__bool__()`; if not defined, calls `x.__len__()`.
- Returns `True` or `False`.
- Zero, empty sequences/mappings/sets, and `None` are falsy; everything else is truthy.

### 3.7 Container Conversion
- `list(iter)`, `tuple(iter)`, `set(iter)`, `frozenset(iter)`: consume the iterable.
- Duplicate handling: `set`/`frozenset` deduplicate using `__hash__` and `__eq__`.
- Order: `list` and `tuple` preserve iteration order; `set` is unordered.

---

## 4. Type Rules (Dunder Methods and Protocols)

### 4.1 Numeric Conversion Protocol
```python
object.__int__(self)     -> int      # called by int()
object.__float__(self)   -> float    # called by float()
object.__complex__(self) -> complex  # called by complex()
object.__index__(self)   -> int
# __index__ must return an exact int (not a subclass).
# Used by: int(), bin(), oct(), hex(), operator.index(), slicing.
# If defined, the object can be used wherever an integer index is needed.
object.__trunc__(self)   -> int      # called by math.trunc(); fallback for int()
object.__floor__(self)   -> int      # called by math.floor()
object.__ceil__(self)    -> int      # called by math.ceil()
```

### 4.2 String Conversion Protocol
```python
object.__str__(self)     -> str   # called by str(), print(), f-strings (with __format__)
object.__repr__(self)    -> str   # called by repr(); used as fallback by str()
object.__format__(self, format_spec: str) -> str
# Called by format() and f-string format specifications.
# If format_spec is empty, behaves like str(self).
object.__bytes__(self)   -> bytes  # called by bytes()
```

### 4.3 `__index__` vs `__int__`
- `__index__` guarantees **lossless** integer conversion (the object represents an integer exactly).
- `__int__` may truncate or round (e.g., `float.__int__` truncates).
- Slicing, `bin()`, `oct()`, `hex()` require `__index__`, not `__int__`.

### 4.4 Implicit Numeric Promotion Rules
```
bool   → int   → float   → complex

int + float   → float (int is promoted)
float + complex → complex (float is promoted)
int + complex → complex (int is promoted)
```
These follow the numeric coercion rules in the `numbers` abstract base class hierarchy.

---

## 5. Behavioral Specification

### 5.1 `int()` Behavior Table
| Input | Result | Notes |
|-------|--------|-------|
| `int(3)` | `3` | identity-like |
| `int(3.7)` | `3` | truncates toward zero |
| `int(-3.7)` | `-3` | toward zero |
| `int(True)` | `1` | bool is int |
| `int("42")` | `42` | decimal string |
| `int("0b1010", 0)` | `10` | auto-detect base |
| `int("ff", 16)` | `255` | hex |
| `int("3.14")` | `ValueError` | |
| `int("")` | `ValueError` | |
| `int(None)` | `TypeError` | |

### 5.2 `float()` Behavior Table
| Input | Result | Notes |
|-------|--------|-------|
| `float(3)` | `3.0` | int → float |
| `float("3.14")` | `3.14` | |
| `float("inf")` | `inf` | case-insensitive |
| `float("nan")` | `nan` | |
| `float(True)` | `1.0` | |
| `float("abc")` | `ValueError` | |
| `float(None)` | `TypeError` | |

### 5.3 `str()` Behavior Table
| Input | Result | Notes |
|-------|--------|-------|
| `str(42)` | `"42"` | |
| `str(3.14)` | `"3.14"` | |
| `str(True)` | `"True"` | |
| `str(None)` | `"None"` | |
| `str([1,2])` | `"[1, 2]"` | calls __repr__ on elements |
| `str(b"hi")` | `"b'hi'"` | NOT decoded |
| `str(b"hi", "utf-8")` | `"hi"` | decoded |

### 5.4 `repr()` vs `str()`
- `repr()` should return an unambiguous, ideally Python-parseable representation.
- `str()` should return a human-readable representation.
- For built-in types, `repr()` wraps strings in quotes; `str()` does not.
- `eval(repr(obj)) == obj` is a design goal, not a guarantee.

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined
- `int(float_val)` always truncates toward zero (not floor, not round).
- `bool(x)` always returns `True` or `False`, never other values.
- `float("nan") != float("nan")` is `True` (IEEE 754).
- Constructors (`list`, `tuple`, etc.) fully consume the passed iterator.
- `int(str_val, base=0)` respects `0b`, `0o`, `0x` prefixes.

### 6.2 Undefined / Implementation-Defined
- **`repr()` output format:** For user-defined classes without `__repr__`, CPython gives `<ClassName object at 0x...>`. The hex address is implementation-defined.
- **`float` string representation:** Since Python 3.1, `repr(float)` gives the shortest round-trip string; the exact output depends on the C library's `dtoa` implementation.
- **Large int-to-str conversion time:** Converting very large integers (millions of digits) to strings is O(n^2) in CPython (improved in 3.11 with better algorithms). The string conversion limit (`sys.set_int_max_str_digits()`) defaults to 4300.

---

## 7. Edge Cases from the Spec (CPython-Specific Notes)

### 7.1 `int()` Truncates Toward Zero (Not Floor)
```python
print(int(3.9))    # 3   (not 4)
print(int(-3.9))   # -3  (not -4)
# Compare with math.floor:
import math
print(math.floor(-3.9))   # -4
print(math.trunc(-3.9))   # -3  (same as int())
```

### 7.2 String to int With Base
```python
print(int("0b1010", 0))   # 10  (base 0 = auto)
print(int("0o17", 0))     # 15
print(int("0xFF", 0))     # 255
print(int("FF", 16))      # 255
print(int("77", 8))       # 63
print(int("11", 2))       # 3
# Underscore separators allowed (Python 3.6+):
print(int("1_000_000"))   # 1000000
```

### 7.3 `bool` Subclass of `int`
```python
print(int(True))          # 1
print(int(False))         # 0
print(True + True)        # 2
print(str(True))          # "True"  (not "1")
print(repr(True))         # "True"
```

### 7.4 `bytes()` From Integer vs From Iterable
```python
print(bytes(5))             # b'\x00\x00\x00\x00\x00'  — 5 zero bytes
print(bytes([65, 66, 67]))  # b'ABC'
print(bytes("hello", "utf-8"))  # b'hello'

# TRAP: bytes("hello") WITHOUT encoding raises TypeError
try:
    bytes("hello")
except TypeError as e:
    print(e)   # string argument without an encoding
```

### 7.5 `__index__` for Custom Integers
```python
class Meter:
    def __init__(self, value: int):
        self._value = value

    def __index__(self) -> int:
        return self._value

m = Meter(3)
data = [10, 20, 30, 40, 50]
print(data[m])        # 40   — __index__ used for subscript
print(bin(m))         # 0b11 — __index__ used by bin()
print(hex(m))         # 0x3
```

### 7.6 Large Integer String Conversion Limit (Python 3.11+)
```python
import sys
print(sys.get_int_max_str_digits())   # 4300 by default

# Override (for trusted data only):
sys.set_int_max_str_digits(10000)
big = 10 ** 5000
s = str(big)   # now allowed
print(len(s))  # 5001
```

### 7.7 `format()` vs `str()` vs `repr()`
```python
pi = 3.14159265358979
print(str(pi))          # 3.14159265358979
print(repr(pi))         # 3.14159265358979
print(format(pi, ".2f"))  # 3.14
print(f"{pi:.4e}")        # 3.1416e+00
```

---

## 8. Version History (PEPs and Python Versions)

| Feature | PEP | Version |
|---------|-----|---------|
| `int`/`float`/`str` as constructors | — | Python 2.2 |
| `bool` type | PEP 285 | Python 2.3 |
| Unification of int/long | PEP 237 | Python 2.2 |
| Removal of `long` type | PEP 3141 | Python 3.0 |
| Numeric tower ABCs (`numbers`) | PEP 3141 | Python 3.0 |
| `__index__` protocol | PEP 357 | Python 2.5 |
| `float` shortest repr (round-trip) | — | Python 3.1 |
| `int` underscores in `int()` parsing | PEP 515 | Python 3.6 |
| `int` string conversion limit | — | Python 3.11 |
| `int.__or__` for union types | PEP 604 | Python 3.10 |

---

## 9. Implementation-Specific Behavior

### 9.1 CPython `int` → `str` Algorithm
- CPython 3.10 and earlier: O(n^2) algorithm for large integers.
- CPython 3.11: improved to O(n * log(n)) using divide-and-conquer.
- Default limit of 4300 digits protects against denial-of-service via large conversions.

### 9.2 CPython `float` Representation
- `float.__repr__` uses David Gay's `dtoa` C library to produce the shortest round-trip decimal.
- `repr(0.1)` is `"0.1"` in Python 3.1+ (was `"0.10000000000000001"` in Python 2).

### 9.3 CPython `str()` and Unicode
- CPython `str` uses PEP 393 flexible string representation.
- `str(bytes_obj)` (without encoding) returns the Python literal representation, not decoded content.

### 9.4 PyPy
- PyPy uses similar conversion semantics but may differ in `id()` and exact `repr()` for floats in edge cases.
- Large integer conversion performance may differ from CPython.

---

## 10. Spec Compliance Checklist

- [ ] `int()` understood to truncate toward zero (not floor)
- [ ] `int(str)` base parameter used correctly (0 = auto-detect)
- [ ] `float("nan")` not compared with `==`; use `math.isnan()`
- [ ] `str(bytes_obj)` without encoding does NOT decode — gives `b'...'` repr
- [ ] `bytes(str)` requires explicit encoding argument
- [ ] `bool` is subclass of `int`; arithmetic with `True`/`False` is legal
- [ ] `__index__` implemented for objects used as integer indices
- [ ] `__float__` vs `__int__` vs `__index__` semantic differences understood
- [ ] Large int-to-str conversion: default limit of 4300 digits (Python 3.11+)
- [ ] Implicit promotion: `int + float → float`, `float + complex → complex`

---

## 11. Official Examples (Runnable Python 3.10+)

```python
import math
import sys

# ----------------------------------------------------------------
# 1. int() — various inputs
# ----------------------------------------------------------------
print(int(3.9))        # 3    (truncate toward zero)
print(int(-3.9))       # -3   (truncate toward zero, not floor)
print(int("42"))       # 42
print(int("0xFF", 16)) # 255
print(int("0b1010", 0)) # 10
print(int(True))       # 1


# ----------------------------------------------------------------
# 2. float() — various inputs
# ----------------------------------------------------------------
print(float(3))         # 3.0
print(float("3.14"))    # 3.14
print(float("1e10"))    # 10000000000.0
print(float("inf"))     # inf
print(float("-INF"))    # -inf  (case-insensitive)
print(float("nan"))     # nan


# ----------------------------------------------------------------
# 3. str() — various inputs
# ----------------------------------------------------------------
print(str(42))           # "42"
print(str(3.14))         # "3.14"
print(str(True))         # "True"
print(str(None))         # "None"
print(str([1, 2, 3]))    # "[1, 2, 3]"
print(str(b"hello"))     # "b'hello'"  (NOT decoded!)
print(str(b"hello", "utf-8"))  # "hello"  (decoded)


# ----------------------------------------------------------------
# 4. bool() — truth value testing
# ----------------------------------------------------------------
for val in [0, 0.0, "", [], {}, None, False, "x", [0], 1]:
    print(f"bool({repr(val)}) = {bool(val)}")


# ----------------------------------------------------------------
# 5. bytes() — three forms
# ----------------------------------------------------------------
print(bytes(5))               # b'\x00\x00\x00\x00\x00'
print(bytes([72, 101, 108]))  # b'Hel'
print(bytes("hello", "utf-8")) # b'hello'


# ----------------------------------------------------------------
# 6. Container conversions
# ----------------------------------------------------------------
t = (1, 2, 3)
lst = list(t)           # tuple → list
tpl = tuple(lst)        # list → tuple
s   = set(lst)          # list → set (unique, unordered)
fs  = frozenset([1,2,3,2,1])   # deduplicated, immutable

print(lst)    # [1, 2, 3]
print(s)      # {1, 2, 3}
print(fs)     # frozenset({1, 2, 3})


# ----------------------------------------------------------------
# 7. dict() from pairs or keyword args
# ----------------------------------------------------------------
d1 = dict([("a", 1), ("b", 2)])
d2 = dict(a=1, b=2)
d3 = dict({"a": 1}, b=2)
print(d1 == d2 == d3)   # True


# ----------------------------------------------------------------
# 8. Implicit numeric promotion
# ----------------------------------------------------------------
result = 5 + 2.0          # int + float → float
print(type(result))       # <class 'float'>

result2 = 2.0 + (1+0j)   # float + complex → complex
print(type(result2))      # <class 'complex'>


# ----------------------------------------------------------------
# 9. Custom __index__ for slice/index usage
# ----------------------------------------------------------------
class MyInt:
    def __init__(self, n):
        self._n = n
    def __index__(self):
        return self._n

m = MyInt(2)
data = [10, 20, 30, 40]
print(data[m])          # 30
print(data[m:])         # [30, 40]
print(bin(m))           # 0b10


# ----------------------------------------------------------------
# 10. __int__ vs __trunc__ vs math functions
# ----------------------------------------------------------------
class Approx:
    def __init__(self, v):
        self.v = v
    def __int__(self):
        return int(self.v)
    def __float__(self):
        return float(self.v)
    def __trunc__(self):
        return math.trunc(self.v)
    def __floor__(self):
        return math.floor(self.v)
    def __ceil__(self):
        return math.ceil(self.v)

a = Approx(3.7)
print(int(a))          # 3
print(float(a))        # 3.7
print(math.trunc(a))   # 3
print(math.floor(a))   # 3
print(math.ceil(a))    # 4


# ----------------------------------------------------------------
# 11. format() with format spec
# ----------------------------------------------------------------
n = 255
print(format(n, "d"))    # 255   (decimal)
print(format(n, "x"))    # ff    (hex lowercase)
print(format(n, "X"))    # FF    (hex uppercase)
print(format(n, "o"))    # 377   (octal)
print(format(n, "b"))    # 11111111 (binary)
print(format(3.14159, ".3f"))  # 3.142


# ----------------------------------------------------------------
# 12. Large int string conversion limit (Python 3.11+)
# ----------------------------------------------------------------
print(f"Default limit: {sys.get_int_max_str_digits()}")  # 4300

# Convert within limit:
n = 10 ** 100
print(str(n)[:20], "...")   # first 20 chars
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| §3.2 | Standard type hierarchy | https://docs.python.org/3/reference/datamodel.html#the-standard-type-hierarchy |
| §3.3.8 | Emulating numeric types | https://docs.python.org/3/reference/datamodel.html#emulating-numeric-types |
| `int()` | Built-in function | https://docs.python.org/3/library/functions.html#int |
| `float()` | Built-in function | https://docs.python.org/3/library/functions.html#float |
| `str()` | Built-in function | https://docs.python.org/3/library/functions.html#str |
| `bool()` | Built-in function | https://docs.python.org/3/library/functions.html#bool |
| `bytes()` | Built-in function | https://docs.python.org/3/library/functions.html#bytes |
| `numbers` | Numeric ABCs | https://docs.python.org/3/library/numbers.html |
| `math.trunc` | Truncate to int | https://docs.python.org/3/library/math.html#math.trunc |
| PEP 3141 | Numeric tower | https://peps.python.org/pep-3141/ |
| PEP 357 | `__index__` protocol | https://peps.python.org/pep-0357/ |
| PEP 285 | `bool` type | https://peps.python.org/pep-0285/ |
