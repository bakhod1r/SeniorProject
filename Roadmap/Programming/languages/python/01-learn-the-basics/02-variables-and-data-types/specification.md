# Python Variables and Data Types — Language Specification

## 1. Spec Reference

- **Primary source:** Python Language Reference, Chapter 3 — Data Model
  https://docs.python.org/3/reference/datamodel.html
- **Standard type hierarchy:** https://docs.python.org/3/reference/datamodel.html#the-standard-type-hierarchy
- **Built-in types:** https://docs.python.org/3/library/stdtypes.html
- **`typing` module:** https://docs.python.org/3/library/typing.html
- **Python 3.12 standard:** All rules here apply to CPython 3.12 unless otherwise noted.

---

## 2. Formal Grammar (EBNF)

### 2.1 Assignment Statements
```
assignment_stmt  ::= (target_list "=")+ (starred_expression | yield_expression)
target_list      ::= target ("," target)* [","]
target           ::= identifier
                   | "(" [target_list] ")"
                   | "[" [target_list] "]"
                   | attributeref
                   | subscription
                   | slicing
                   | "*" target
augmented_assign ::= target augop (expression_list | yield_expression)
augop            ::= "+=" | "-=" | "*=" | "/=" | "//=" | "%=" | "**="
                   | "&=" | "|=" | "^=" | ">>=" | "<<=" | "@="
annotated_assign ::= augtarget ":" expression ["=" (expression | yield)]
```

### 2.2 Typed Assignment (PEP 526)
```
annotated_assign ::= augtarget ":" expression ["=" (expression_list | yield_expression)]
```

### 2.3 Type Alias (Python 3.12, PEP 695)
```
type_alias ::= "type" NAME [type_params] "=" expression
type_params ::= "[" type_param ("," type_param)* "]"
type_param  ::= NAME [bound] | "*" NAME | "**" NAME
bound       ::= ":" expression
```

---

## 3. Core Rules and Constraints

### 3.1 Variable Binding
- Python variables are **names bound to objects**, not typed storage locations.
- A name binding is created by assignment, `for`, `with`, `import`, function parameters, `class` and `def` statements, and comprehension variables.
- Rebinding a name to a new object does **not** modify the old object.
- Deleting a name (`del name`) removes the binding; it does not destroy the object if other references exist.

### 3.2 No Declaration Required
- Variables do not require explicit declaration.
- Using an unbound name raises `NameError` at runtime.
- Annotated assignments (`x: int`) create an annotation entry in `__annotations__` but do **not** necessarily bind the name.

### 3.3 Type Annotations are Not Enforced at Runtime
- Type hints (PEP 484, PEP 526) are metadata only; they are stored in `__annotations__` but the runtime does not enforce them.
- Static type checkers (mypy, pyright, pytype) use annotations offline.
- `from __future__ import annotations` (PEP 563) makes all annotations lazy strings; `get_type_hints()` resolves them.

### 3.4 Identity vs Equality vs Mutability
- **Identity:** `is` / `is not` — same object in memory (`id()`)
- **Equality:** `==` / `!=` — calls `__eq__`
- **Mutable** objects (list, dict, set, bytearray) can be changed in-place; bindings to them see the change.
- **Immutable** objects (int, float, complex, str, bytes, tuple, frozenset) cannot be changed; operations return new objects.

### 3.5 Standard Type Hierarchy (from §3.2 of Python Reference)
```
None
NotImplemented
Ellipsis (...)
numbers.Number
  numbers.Integral   (int, bool)
  numbers.Real       (float)
  numbers.Complex    (complex)
Sequences
  Immutable: str, bytes, tuple
  Mutable:   list, bytearray
Set types
  Mutable:   set
  Immutable: frozenset
Mappings:    dict
Callable:    functions, methods, classes
Modules
Classes
Instances
I/O objects
```

---

## 4. Type Rules (Dunder Methods and Protocols)

### 4.1 Numeric Type Protocol
```python
# Arithmetic dunders (binary operations return NotImplemented if not supported)
__add__(self, other)       # self + other
__radd__(self, other)      # other + self (reflected)
__iadd__(self, other)      # self += other (in-place; returns self)
__sub__, __rsub__, __isub__
__mul__, __rmul__, __imul__
__truediv__, __rtruediv__, __itruediv__    # /
__floordiv__, __rfloordiv__, __ifloordiv__ # //
__mod__, __rmod__, __imod__               # %
__pow__, __rpow__, __ipow__               # **
__matmul__, __rmatmul__, __imatmul__      # @
__neg__(self)        # unary -
__pos__(self)        # unary +
__abs__(self)        # abs()
__invert__(self)     # ~
__round__(self[, n]) # round()
__trunc__(self)      # math.trunc()
__floor__(self)      # math.floor()
__ceil__(self)       # math.ceil()
```

### 4.2 Comparison Protocol
```python
__lt__(self, other)  # <
__le__(self, other)  # <=
__eq__(self, other)  # ==  (default: identity)
__ne__(self, other)  # !=  (default: not __eq__)
__gt__(self, other)  # >
__ge__(self, other)  # >=
```
If `__eq__` is defined and `__hash__` is not, `__hash__` is implicitly set to `None`, making the object unhashable.

### 4.3 Conversion Protocol
```python
__int__(self)    -> int
__float__(self)  -> float
__complex__(self)-> complex
__index__(self)  -> int    # used by slices and bin()/oct()/hex()
__str__(self)    -> str
__repr__(self)   -> str
__bool__(self)   -> bool
__bytes__(self)  -> bytes
```

### 4.4 Type Annotation Dunders
```python
# PEP 604 — X | Y union type
type.__or__(cls, other)  # int | str -> Union[int, str]
```

---

## 5. Behavioral Specification

### 5.1 int
- **Arbitrary precision:** Python `int` has no fixed size. CPython stores digits in base 2^30 internally.
- `bool` is a subclass of `int`: `True == 1`, `False == 0`.
- Integer literals: decimal, binary (`0b`), octal (`0o`), hexadecimal (`0x`).
- Conversion: `int("42")`, `int("0xff", 16)`, `int(3.7)` (truncates toward zero).
- Small integer cache: CPython caches [-5, 256]; `is` may return `True` for these.

### 5.2 float
- Implemented as IEEE 754 double-precision (64-bit), typically `C double`.
- Range: approximately ±1.8 × 10^308; precision: ~15–17 significant decimal digits.
- Special values: `float('inf')`, `float('-inf')`, `float('nan')`.
- `float('nan') != float('nan')` is `True` (IEEE 754 rule).
- `sys.float_info` exposes implementation details.

### 5.3 complex
- Stored as a pair of `float` (real, imaginary).
- Literal: `3+4j`, `0J`, `1.5e2j`.
- `complex.real`, `complex.imag` attributes.
- `abs(z)` returns the modulus.

### 5.4 str
- Sequence of Unicode code points (Python 3 str is always Unicode).
- **Immutable**; operations return new strings.
- Supports `+` (concatenation), `*` (repetition), `in`, indexing, slicing.
- Interning: CPython may intern short strings; do not rely on `is` for string equality.
- `len(s)` returns the number of code points, **not** bytes.

### 5.5 bytes and bytearray
- `bytes`: immutable sequence of integers in [0, 255].
- `bytearray`: mutable version of `bytes`.
- Literal: `b"hello"`, `b'\x41\x42'`.
- `len()` returns byte count.
- Encoding/decoding: `"text".encode("utf-8")` → `bytes`; `b"text".decode("utf-8")` → `str`.

### 5.6 NoneType
- Exactly one instance: `None`.
- `None is None` is always `True`.
- Used as a default return value for functions with no `return` statement.
- Common use: sentinel/null value in parameters.

### 5.7 bool
- `True` and `False` are the only two instances of `bool`.
- `bool` is a subclass of `int`: `isinstance(True, int)` is `True`.
- `int(True) == 1`, `int(False) == 0`.
- Arithmetic with booleans is legal: `True + True == 2`.

### 5.8 Augmented Assignment Semantics
For immutable types: `x += 1` is equivalent to `x = x + 1` (rebind).
For mutable types that implement `__iadd__`: `x += y` calls `x.__iadd__(y)` and rebinds `x` to the result (which is `x` itself for mutable types like `list`).

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined
- `type(obj)` always returns the exact type of `obj`.
- `isinstance(obj, cls)` follows MRO; handles `Union` types in Python 3.10+.
- `id(obj)` returns a unique integer for simultaneously live objects.
- Integer operations never overflow — Python `int` is arbitrary precision.
- `float` arithmetic follows IEEE 754 except for signaling NaNs (not supported in Python).

### 6.2 Undefined / Implementation-Defined
- **String interning:** Whether two `str` literals with the same value are the same object is an implementation detail. CPython interns identifier-like strings.
- **`id()` after deallocation:** Once an object is deallocated, its `id()` may be reused for a new object.
- **Numeric coercion order:** For mixed-type operations, the coercion order (int → float → complex) is defined, but the exact result may vary for edge cases involving `NotImplemented`.
- **Memory layout of `float`:** Python `float` maps to C `double`, but the exact bit representation of NaN payloads is not specified.

---

## 7. Edge Cases from the Spec (CPython-Specific Notes)

### 7.1 Integer Identity vs Equality
```python
a = 256
b = 256
print(a is b)   # True  (CPython small int cache: [-5, 256])

a = 257
b = 257
print(a is b)   # False in general (may be True in same code object)
```
The spec does NOT guarantee `a is b` for any integer value; `==` must be used.

### 7.2 float NaN
```python
nan = float('nan')
print(nan == nan)   # False  (IEEE 754)
print(nan != nan)   # True
import math
print(math.isnan(nan))   # True  (use this to check for NaN)
```

### 7.3 bool Arithmetic
```python
print(True + True)    # 2
print(True * 10)      # 10
print(False + 1)      # 1
print(isinstance(True, int))   # True
```

### 7.4 Annotated Assignment Without Value
```python
x: int          # annotates x but does NOT bind x
# print(x)     # NameError: name 'x' is not defined

class Foo:
    x: int      # adds 'x' to Foo.__annotations__ but does not create attribute
```

### 7.5 None Comparison
```python
# Correct: use 'is' for None checks
if value is None:
    ...
if value is not None:
    ...

# Incorrect: '==' can be overridden by __eq__
if value == None:   # works but not idiomatic or safe
    ...
```

### 7.6 Mutable Default Arguments
```python
# TRAP: default argument is evaluated once at function definition time
def append_to(item, lst=[]):
    lst.append(item)
    return lst

print(append_to(1))   # [1]
print(append_to(2))   # [1, 2]  — same list object!

# Correct pattern:
def append_to_safe(item, lst=None):
    if lst is None:
        lst = []
    lst.append(item)
    return lst
```

### 7.7 Chained Comparisons
```python
# In Python, 1 < x < 10 is equivalent to (1 < x) and (x < 10)
# Each operand is evaluated only once
x = 5
print(1 < x < 10)   # True

# But be careful:
print(1 < 3 > 2)    # True   (1 < 3) and (3 > 2)
```

### 7.8 Type Aliases (Python 3.12 PEP 695)
```python
type Vector = list[float]       # creates a TypeAliasType object
type Matrix[T] = list[list[T]]  # generic type alias
```

---

## 8. Version History (PEPs and Python Versions)

| Feature | PEP | Version |
|---------|-----|---------|
| `int` unlimited precision (always) | — | Python 1 |
| `str` always Unicode | PEP 3137 | Python 3.0 |
| `bytes` / `bytearray` | PEP 3137 | Python 3.0 |
| `print` function | PEP 3105 | Python 3.0 |
| Variable annotations | PEP 526 | Python 3.6 |
| f-strings | PEP 498 | Python 3.6 |
| `typing.Final` | PEP 591 | Python 3.8 |
| `typing.Literal` | PEP 586 | Python 3.8 |
| `typing.TypedDict` | PEP 589 | Python 3.8 |
| `int | str` union syntax | PEP 604 | Python 3.10 |
| `isinstance()` with `X | Y` | PEP 604 | Python 3.10 |
| `type` statement for aliases | PEP 695 | Python 3.12 |
| Lazy annotation evaluation | PEP 563 | Python 3.10 (opt-in), deferred |
| `typing.Self` | PEP 673 | Python 3.11 |
| `typing.Never` / `NoReturn` | PEP 673 | Python 3.11 |

---

## 9. Implementation-Specific Behavior

### 9.1 CPython Integer Representation
- CPython stores small integers [-5, 256] as pre-allocated singletons.
- Large integers stored as arrays of 30-bit digits in base 2^30.
- `sys.getsizeof(int)` grows with magnitude: 28 bytes for small int, ~32+ for large.

### 9.2 CPython float
- `float` maps directly to C `double` (IEEE 754 double precision).
- `sys.float_info.epsilon` ≈ 2.22e-16.
- `repr(float)` (since Python 3.1) uses the shortest decimal representation that round-trips.

### 9.3 CPython str Flexible Representation (PEP 393)
- CPython 3.3+ uses a "flexible string representation": Latin-1 (1 byte/char), UCS-2 (2 bytes/char), or UCS-4 (4 bytes/char) depending on the highest Unicode code point.
- `sys.getsizeof("a")` is 50 bytes (CPython 3.12), but varies by content.

### 9.4 PyPy
- PyPy stores integers as machine words when possible; falls back to arbitrary precision.
- `id()` values are different from CPython; the small int cache concept does not apply.

---

## 10. Spec Compliance Checklist

- [ ] Equality (`==`) used for value comparison, not `is`
- [ ] `is` / `is not` used only for `None`, `True`, `False` checks
- [ ] Mutable default arguments avoided (use `None` sentinel)
- [ ] Type annotations understood as metadata, not enforced at runtime
- [ ] `float` NaN compared with `math.isnan()`, not `==`
- [ ] `bool` understood as subclass of `int`
- [ ] Annotated-only variables (`x: int`) recognized as not binding the name
- [ ] Chained comparisons (`1 < x < 10`) used correctly
- [ ] Augmented assignment (`+=`) understood for both mutable and immutable types
- [ ] `None` check uses `is None`, not `== None`

---

## 11. Official Examples (Runnable Python 3.10+)

```python
# ----------------------------------------------------------------
# 1. Basic variable binding and rebinding
# ----------------------------------------------------------------
x = 42
print(type(x))    # <class 'int'>
x = "hello"       # rebinding — x now points to a str object
print(type(x))    # <class 'str'>


# ----------------------------------------------------------------
# 2. Standard numeric types
# ----------------------------------------------------------------
i = 1_000_000          # int with underscore separator (PEP 515)
f = 3.14_159           # float
c = 2 + 3j             # complex
b = True               # bool (subclass of int)

print(isinstance(b, int))   # True
print(int(b))               # 1
print(f * 2)                # 6.28318


# ----------------------------------------------------------------
# 3. Integer arbitrary precision
# ----------------------------------------------------------------
big = 2 ** 100
print(big)          # 1267650600228229401496703205376
print(type(big))    # <class 'int'>


# ----------------------------------------------------------------
# 4. float IEEE 754 edge cases
# ----------------------------------------------------------------
inf = float('inf')
nan = float('nan')
print(inf > 1e308)           # True
print(nan == nan)            # False  (IEEE 754)
import math
print(math.isnan(nan))       # True
print(math.isinf(inf))       # True


# ----------------------------------------------------------------
# 5. str: immutable, Unicode
# ----------------------------------------------------------------
s = "Hello, \u4e16\u754c"    # Unicode code points
print(s)                      # Hello, 世界
print(len(s))                 # 8  (code points, not bytes)
print(s.encode("utf-8"))      # b'Hello, \xe4\xb8\x96\xe7\x95\x8c'


# ----------------------------------------------------------------
# 6. bytes vs bytearray
# ----------------------------------------------------------------
b_imm = b"\x41\x42\x43"    # bytes (immutable)
b_mut = bytearray(b_imm)    # bytearray (mutable)
b_mut[0] = 0x61             # change 'A' to 'a'
print(b_mut)                # bytearray(b'aBC')
print(b_imm)                # b'ABC'  — unchanged


# ----------------------------------------------------------------
# 7. Type annotation (PEP 526) — metadata only
# ----------------------------------------------------------------
name: str = "Alice"
age: int               # annotated but NOT bound
scores: list[float] = [9.5, 8.0, 7.5]

print(__annotations__)   # shows annotations in module scope


# ----------------------------------------------------------------
# 8. Union type syntax (PEP 604, Python 3.10+)
# ----------------------------------------------------------------
def stringify(value: int | float | None) -> str:
    if value is None:
        return "nothing"
    return str(value)

print(stringify(42))     # "42"
print(stringify(3.14))   # "3.14"
print(stringify(None))   # "nothing"


# ----------------------------------------------------------------
# 9. isinstance with union types (Python 3.10+)
# ----------------------------------------------------------------
val = 42
print(isinstance(val, int | float))   # True


# ----------------------------------------------------------------
# 10. Type alias with 'type' statement (Python 3.12, PEP 695)
# ----------------------------------------------------------------
type Point = tuple[float, float]
type Matrix[T] = list[list[T]]

# At runtime:
print(type(Point))    # <class 'typing.TypeAliasType'>
print(Point.__value__)  # tuple[float, float]


# ----------------------------------------------------------------
# 11. Augmented assignment: mutable vs immutable
# ----------------------------------------------------------------
# Immutable: rebind
n = 10
original_id = id(n)
n += 1
print(id(n) == original_id)   # False — new int object

# Mutable: in-place
lst = [1, 2, 3]
original_id = id(lst)
lst += [4, 5]   # calls __iadd__
print(id(lst) == original_id)   # True — same list object


# ----------------------------------------------------------------
# 12. None as sentinel
# ----------------------------------------------------------------
def connect(host: str, port: int | None = None) -> str:
    if port is None:
        port = 443
    return f"{host}:{port}"

print(connect("example.com"))        # example.com:443
print(connect("example.com", 8080))  # example.com:8080
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| §3.1 | Objects, values, types | https://docs.python.org/3/reference/datamodel.html#objects-values-and-types |
| §3.2 | Standard type hierarchy | https://docs.python.org/3/reference/datamodel.html#the-standard-type-hierarchy |
| §4.2.2 | Resolution of names (scoping) | https://docs.python.org/3/reference/executionmodel.html#resolution-of-names |
| §7.2 | Assignment statements | https://docs.python.org/3/reference/simple_stmts.html#assignment-statements |
| §7.3 | Augmented assignment | https://docs.python.org/3/reference/simple_stmts.html#augmented-assignment-statements |
| §7.6 | Annotated assignment | https://docs.python.org/3/reference/simple_stmts.html#annotated-assignment-statements |
| Built-in types | Numeric, sequence, mapping | https://docs.python.org/3/library/stdtypes.html |
| `sys.float_info` | Float implementation | https://docs.python.org/3/library/sys.html#sys.float_info |
| PEP 484 | Type hints | https://peps.python.org/pep-0484/ |
| PEP 526 | Variable annotations | https://peps.python.org/pep-0526/ |
| PEP 604 | `X | Y` union syntax | https://peps.python.org/pep-0604/ |
| PEP 695 | Type parameter syntax | https://peps.python.org/pep-0695/ |
