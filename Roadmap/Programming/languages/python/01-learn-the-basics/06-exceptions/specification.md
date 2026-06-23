# Python Exceptions — Language Specification

## 1. Spec Reference

- **Primary source:** Python Language Reference, §8.4 — The `try` statement
  https://docs.python.org/3/reference/compound_stmts.html#the-try-statement
- **§7.8 — `raise` statement:**
  https://docs.python.org/3/reference/simple_stmts.html#the-raise-statement
- **Built-in exceptions:**
  https://docs.python.org/3/library/exceptions.html
- **Exception groups and `except*` (PEP 654):**
  https://docs.python.org/3/library/exceptions.html#exception-groups
- **Python 3.12 standard:** All rules here apply to CPython 3.12 unless otherwise noted.

---

## 2. Formal Grammar (EBNF)

### 2.1 `try` Statement
```
try_stmt     ::= try1_stmt | try2_stmt | try3_stmt
try1_stmt    ::= "try" ":" suite
                 ("except" [expression ["as" identifier]] ":" suite)+
                 ["else" ":" suite]
                 ["finally" ":" suite]
try2_stmt    ::= "try" ":" suite "finally" ":" suite
try3_stmt    ::= "try" ":" suite
                 ("except" "*" expression ["as" identifier] ":" suite)+
                 ["else" ":" suite]
                 ["finally" ":" suite]
```

### 2.2 `raise` Statement
```
raise_stmt ::= "raise" [expression ["from" expression]]
```

### 2.3 Exception Expression
```
except_clause ::= "except" [expression ["as" identifier]]
                | "except" "*" expression ["as" identifier]
```
- `"except" expression`: matches an exception type or a tuple of types.
- `"except" "*" expression`: matches an `ExceptionGroup` (Python 3.11+).

---

## 3. Core Rules and Constraints

### 3.1 Exception Hierarchy
All built-in exceptions inherit from `BaseException`. The hierarchy:
```
BaseException
├── SystemExit
├── KeyboardInterrupt
├── GeneratorExit
└── Exception
    ├── ArithmeticError
    │   ├── FloatingPointError
    │   ├── OverflowError
    │   └── ZeroDivisionError
    ├── AttributeError
    ├── BufferError
    ├── EOFError
    ├── ImportError
    │   └── ModuleNotFoundError
    ├── LookupError
    │   ├── IndexError
    │   └── KeyError
    ├── MemoryError
    ├── NameError
    │   └── UnboundLocalError
    ├── OSError (alias: EnvironmentError, IOError)
    │   ├── BlockingIOError
    │   ├── ChildProcessError
    │   ├── ConnectionError
    │   │   ├── BrokenPipeError
    │   │   ├── ConnectionAbortedError
    │   │   ├── ConnectionRefusedError
    │   │   └── ConnectionResetError
    │   ├── FileExistsError
    │   ├── FileNotFoundError
    │   ├── InterruptedError
    │   ├── IsADirectoryError
    │   ├── NotADirectoryError
    │   ├── PermissionError
    │   ├── ProcessLookupError
    │   └── TimeoutError
    ├── ReferenceError
    ├── RuntimeError
    │   ├── NotImplementedError
    │   └── RecursionError
    ├── StopIteration
    ├── StopAsyncIteration
    ├── SyntaxError
    │   └── IndentationError
    │       └── TabError
    ├── SystemError
    ├── TypeError
    ├── ValueError
    │   └── UnicodeError
    │       ├── UnicodeDecodeError
    │       ├── UnicodeEncodeError
    │       └── UnicodeTranslateError
    └── Warning
        ├── DeprecationWarning
        ├── PendingDeprecationWarning
        ├── RuntimeWarning
        ├── SyntaxWarning
        ├── UserWarning
        ├── FutureWarning
        ├── ImportWarning
        ├── UnicodeWarning
        ├── BytesWarning
        └── ResourceWarning
```

### 3.2 `try`/`except` Matching Rules
- `except ExcType` matches if the raised exception **is an instance of** `ExcType` (using `isinstance`).
- `except (Type1, Type2)` matches if the exception is an instance of any type in the tuple.
- `except` (bare, without type) matches **any** exception — equivalent to `except BaseException`.
- Clauses are tried in **order**; only the first matching clause executes.
- After the `except` block, execution continues with the statement after the `try` block (unless the `except` itself raises).

### 3.3 `else` Clause
- Executes only if the `try` block completed **without** raising an exception.
- Does not execute if a `break`, `continue`, or `return` exits the `try` block.
- Useful for code that should only run when no exception occurred.

### 3.4 `finally` Clause
- **Always** executes: whether an exception was raised, caught, uncaught, or no exception at all.
- Executes even when `break`, `continue`, or `return` exits the `try` or `except` block.
- If `finally` contains `return`, `break`, or raises an exception, the original exception is **silently discarded**.
- Use case: cleanup (close files, release locks, disconnect).

### 3.5 `raise` Statement Rules
- `raise ExceptionType()` — raise a new instance.
- `raise ExceptionType` — Python 3 automatically calls `ExceptionType()` (no-arg constructor).
- `raise` (bare) — re-raises the currently active exception; raises `RuntimeError` if no active exception.
- `raise exc from cause` — sets `__cause__` (explicit chaining); implicitly sets `__suppress_context__ = True`.
- `raise exc from None` — suppresses exception context display.

### 3.6 Exception Chaining
- **Implicit chaining:** When an exception is raised inside an `except` block, `__context__` is set to the original exception. Both are displayed.
- **Explicit chaining:** `raise B from A` sets `B.__cause__ = A` and `B.__suppress_context__ = True`. The display shows "The above exception was the direct cause."
- `raise exc from None` sets `__cause__ = None` and `__suppress_context__ = True`, suppressing context.

### 3.7 `as` Binding in `except`
- `except ExcType as name` binds `name` to the exception instance within the `except` block.
- After the `except` block exits, `name` is **deleted** from the local namespace (to prevent reference cycles).

---

## 4. Type Rules (Dunder Methods and Protocols)

### 4.1 Exception Protocol
```python
# BaseException attributes (always available):
exception.args          # tuple of constructor arguments
exception.__traceback__ # traceback object or None
exception.__context__   # implicitly chained exception (or None)
exception.__cause__     # explicitly chained exception (or None)
exception.__suppress_context__  # True if 'from' was used (or from None)
exception.__notes__     # list of note strings (Python 3.11+, PEP 678)
```

### 4.2 Custom Exception Protocol
```python
class MyError(Exception):
    def __init__(self, message: str, code: int = 0):
        super().__init__(message)
        self.code = code

    def __str__(self) -> str:
        return f"[{self.code}] {super().__str__()}"
```

### 4.3 `__enter__` / `__exit__` (Context Manager Protocol)
```python
object.__enter__(self)  -> value    # called by 'with'; result bound by 'as'
object.__exit__(self, exc_type, exc_val, exc_tb) -> bool | None
# If __exit__ returns a truthy value, the exception is suppressed.
# Called even if no exception occurred (exc_type=None).
```

### 4.4 Exception Group Protocol (Python 3.11+)
```python
ExceptionGroup(message: str, exceptions: Sequence[Exception])
BaseExceptionGroup(message: str, exceptions: Sequence[BaseException])

# Methods:
eg.exceptions   # tuple of contained exceptions
eg.subgroup(predicate)   # returns new group with matching exceptions
eg.split(predicate)      # returns (matching_group, rest_group)
eg.derive(exceptions)    # returns new group with same message but new exceptions
```

---

## 5. Behavioral Specification

### 5.1 Exception Propagation
1. An exception is raised (by `raise` or by the interpreter).
2. Python unwinds the call stack, looking for a matching `except` clause.
3. For each frame: if a `try`/`except` has a matching clause, execute it.
4. `finally` blocks execute as the stack unwinds.
5. If no handler is found, the exception propagates to the top-level and the interpreter prints a traceback and exits.

### 5.2 `try`/`except`/`else`/`finally` Execution Order
1. Execute `try` body.
2. If exception: find matching `except` clause, execute it. Then run `finally`. Done.
3. If no exception: run `else` (if present). Then run `finally`. Done.
4. `finally` always runs — it is the last thing before control leaves the `try` statement.

### 5.3 Re-raise Semantics
- `raise` (bare) re-raises the currently active exception with the **original** traceback.
- This is preferred over `raise exc` (which creates a new traceback entry).

### 5.4 `except*` (ExceptionGroup Handling, Python 3.11+)
- `except* TypeError as eg:` catches all `TypeError` instances from an `ExceptionGroup`.
- Multiple `except*` clauses can match different exception types from the same group.
- Cannot mix `except` and `except*` in the same `try` statement.
- `raise` inside `except*` wraps the exception in a new `ExceptionGroup`.

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined
- `except` clauses are tried in order; only the first match executes.
- `finally` always executes; its `return`/`raise` overrides any pending exception.
- `as name` variable is deleted after the `except` block.
- `raise` with no argument in no active exception context → `RuntimeError`.
- `isinstance(exc, ExcType)` is used for matching; inheritance is respected.

### 6.2 Undefined / Implementation-Defined
- **Traceback object format:** `tb_lineno`, `tb_frame` attributes are CPython-specific. The spec defines `__traceback__` exists but not its internal structure.
- **Order of exception printing in chained exceptions:** CPython prints most recent last; the display format is not formally specified.
- **`sys.exc_info()` behavior with nested exceptions:** defined per-frame in CPython, may differ in other implementations.

---

## 7. Edge Cases from the Spec (CPython-Specific Notes)

### 7.1 `finally` Suppresses Exceptions
```python
def risky():
    try:
        raise ValueError("original")
    finally:
        return 42   # silently discards the ValueError!

result = risky()
print(result)   # 42 — ValueError was swallowed
```

### 7.2 `as` Variable Deleted After `except`
```python
try:
    raise ValueError("test")
except ValueError as e:
    print(e)   # test
# print(e)    # NameError: name 'e' is not defined

# Workaround if you need e after the block:
try:
    raise ValueError("test")
except ValueError as e:
    err = e
print(err)   # test  — safe because 'err' is not auto-deleted
```

### 7.3 Bare `except` Catches `KeyboardInterrupt`
```python
# AVOID: bare except catches KeyboardInterrupt, SystemExit, etc.
try:
    ...
except:
    pass   # BAD: catches ctrl+c, sys.exit(), etc.

# PREFER:
try:
    ...
except Exception:
    pass   # catches only non-system exceptions
```

### 7.4 Exception Chaining
```python
def fetch_user(user_id):
    try:
        data = {}
        return data[user_id]
    except KeyError as e:
        raise ValueError(f"User {user_id!r} not found") from e

try:
    fetch_user("alice")
except ValueError as e:
    print(e)                # User 'alice' not found
    print(e.__cause__)      # 'alice'   (KeyError)
    print(e.__context__)    # same as __cause__ here
```

### 7.5 Suppress Context With `from None`
```python
try:
    raise ValueError("internal error")
except ValueError:
    raise RuntimeError("public error") from None
# The traceback shows only RuntimeError; internal ValueError is hidden
```

### 7.6 `add_note()` (Python 3.11+, PEP 678)
```python
try:
    x = int("abc")
except ValueError as e:
    e.add_note("Input must be a decimal integer string")
    raise
```

### 7.7 ExceptionGroup and `except*` (Python 3.11+)
```python
try:
    raise ExceptionGroup("multiple errors", [
        ValueError("bad value"),
        TypeError("wrong type"),
        KeyError("missing key"),
    ])
except* ValueError as eg:
    print(f"Caught ValueErrors: {eg.exceptions}")
except* TypeError as eg:
    print(f"Caught TypeErrors: {eg.exceptions}")
# KeyError propagates as a new ExceptionGroup
```

---

## 8. Version History (PEPs and Python Versions)

| Feature | PEP | Version |
|---------|-----|---------|
| `try`/`except`/`finally` combined | — | Python 2.5 |
| `except ExcType as name` syntax | — | Python 3.0 |
| `raise from` (exception chaining) | PEP 3134 | Python 3.0 |
| `OSError` unified (`IOError`, `EnvironmentError`) | PEP 3151 | Python 3.3 |
| `__context__` and `__cause__` | PEP 3134 | Python 3.0 |
| `suppress` context manager | — | Python 3.4 |
| `__traceback__` attribute | — | Python 3.0 |
| `StopIteration` → `RuntimeError` in generators | PEP 479 | Python 3.7 |
| `BaseExceptionGroup` / `ExceptionGroup` | PEP 654 | Python 3.11 |
| `except*` syntax | PEP 654 | Python 3.11 |
| `Exception.add_note()` | PEP 678 | Python 3.11 |
| `__notes__` attribute | PEP 678 | Python 3.11 |

---

## 9. Implementation-Specific Behavior

### 9.1 CPython Traceback Objects
- `traceback` module provides `format_exc()`, `print_exc()`, `TracebackException`.
- `sys.last_traceback` stores the last unhandled exception's traceback.
- CPython's `traceback.TracebackException` gives structured access to frames, lines, and chains.

### 9.2 CPython `sys.exc_info()`
- Returns `(type, value, traceback)` for the currently handled exception.
- Returns `(None, None, None)` when no exception is active.
- Per-frame: each generator frame has its own "current exception."
- Deprecated in favor of accessing `sys.exception()` (Python 3.12+).

### 9.3 `sys.exception()` (Python 3.12+)
- `sys.exception()` returns the current exception object (or `None`).
- Preferred over `sys.exc_info()[1]`.

### 9.4 PyPy
- Exception handling in PyPy is optimized by the JIT; rare exceptions have lower overhead than in CPython.
- Traceback format is compatible with CPython's `traceback` module.

---

## 10. Spec Compliance Checklist

- [ ] `except` catches subtypes due to `isinstance` matching
- [ ] `except` clauses ordered from specific to general
- [ ] Bare `except:` (without type) avoided; use `except Exception:` instead
- [ ] `as name` variable understood to be deleted after `except` block
- [ ] `finally` understood to always execute (and to suppress exceptions if it `return`s)
- [ ] Exception chaining (`raise from`) used for wrapping
- [ ] `raise from None` used to suppress internal exception context
- [ ] Custom exceptions inherit from `Exception` (not directly from `BaseException`)
- [ ] `add_note()` used for annotation (Python 3.11+) where applicable
- [ ] `except*` used with `ExceptionGroup` (Python 3.11+)
- [ ] `SystemExit`, `KeyboardInterrupt`, `GeneratorExit` not silently caught

---

## 11. Official Examples (Runnable Python 3.10+)

```python
import sys
from contextlib import suppress

# ----------------------------------------------------------------
# 1. Basic try / except
# ----------------------------------------------------------------
try:
    result = 10 / 0
except ZeroDivisionError as e:
    print(f"Caught: {e}")   # Caught: division by zero


# ----------------------------------------------------------------
# 2. Multiple except clauses
# ----------------------------------------------------------------
def parse_int(s):
    try:
        return int(s)
    except ValueError:
        print(f"Not a valid integer: {s!r}")
    except TypeError:
        print(f"Expected str, got {type(s).__name__}")
    return None

print(parse_int("42"))    # 42
print(parse_int("abc"))   # Not a valid integer: 'abc'
print(parse_int(None))    # Expected str, got NoneType


# ----------------------------------------------------------------
# 3. except with tuple of types
# ----------------------------------------------------------------
def safe_lookup(d, key):
    try:
        return d[key]
    except (KeyError, TypeError) as e:
        print(f"Lookup failed: {e}")
        return None

safe_lookup({"a": 1}, "b")   # Lookup failed: 'b'
safe_lookup(None, "key")      # Lookup failed: 'NoneType' object is not subscriptable


# ----------------------------------------------------------------
# 4. try / except / else / finally
# ----------------------------------------------------------------
def read_file(path):
    f = None
    try:
        f = open(path)
        data = f.read()
    except FileNotFoundError:
        print(f"File not found: {path}")
        data = None
    else:
        print(f"Successfully read {len(data)} bytes")
    finally:
        if f:
            f.close()
            print("File closed")
    return data


# ----------------------------------------------------------------
# 5. raise with custom exception
# ----------------------------------------------------------------
class ValidationError(ValueError):
    def __init__(self, field: str, message: str):
        super().__init__(f"Validation error on '{field}': {message}")
        self.field = field

def validate_age(age):
    if not isinstance(age, int):
        raise TypeError(f"age must be int, got {type(age).__name__}")
    if age < 0 or age > 150:
        raise ValidationError("age", f"{age} is out of range [0, 150]")
    return age

try:
    validate_age(-5)
except ValidationError as e:
    print(e)       # Validation error on 'age': -5 is out of range [0, 150]
    print(e.field) # age


# ----------------------------------------------------------------
# 6. Exception chaining
# ----------------------------------------------------------------
class DatabaseError(Exception):
    pass

def get_user(user_id: int):
    try:
        users = {}
        return users[user_id]
    except KeyError as e:
        raise DatabaseError(f"User {user_id} not found") from e

try:
    get_user(42)
except DatabaseError as e:
    print(e)              # User 42 not found
    print(e.__cause__)    # 42  (KeyError)


# ----------------------------------------------------------------
# 7. raise from None (suppress context)
# ----------------------------------------------------------------
def public_api(x):
    try:
        return 1 / x
    except ZeroDivisionError:
        raise ValueError("x must not be zero") from None

try:
    public_api(0)
except ValueError as e:
    print(e)                  # x must not be zero
    print(e.__cause__)        # None  (suppressed)
    print(e.__context__)      # ZeroDivisionError (still set)
    print(e.__suppress_context__)  # True


# ----------------------------------------------------------------
# 8. bare raise (re-raise)
# ----------------------------------------------------------------
def process(data):
    try:
        return int(data)
    except ValueError:
        print("Logging error...")
        raise   # re-raise preserves original traceback


# ----------------------------------------------------------------
# 9. contextlib.suppress
# ----------------------------------------------------------------
with suppress(FileNotFoundError):
    open("/nonexistent/file.txt")
print("Continued after suppressed exception")


# ----------------------------------------------------------------
# 10. add_note (Python 3.11+)
# ----------------------------------------------------------------
try:
    raise ValueError("connection failed")
except ValueError as e:
    e.add_note("Check that the server is running")
    e.add_note("Verify the port number is correct")
    raise
# The notes appear in the traceback output


# ----------------------------------------------------------------
# 11. ExceptionGroup (Python 3.11+)
# ----------------------------------------------------------------
def run_all(tasks):
    errors = []
    results = []
    for task in tasks:
        try:
            results.append(task())
        except Exception as e:
            errors.append(e)
    if errors:
        raise ExceptionGroup("task failures", errors)
    return results

try:
    def bad1(): raise ValueError("v1")
    def bad2(): raise TypeError("t1")
    def good(): return 42

    run_all([bad1, bad2, good])
except* ValueError as eg:
    print(f"ValueErrors: {[str(e) for e in eg.exceptions]}")
except* TypeError as eg:
    print(f"TypeErrors: {[str(e) for e in eg.exceptions]}")


# ----------------------------------------------------------------
# 12. sys.exception() (Python 3.12+)
# ----------------------------------------------------------------
try:
    raise RuntimeError("test")
except RuntimeError:
    exc = sys.exception()
    print(f"Active exception: {exc}")   # Active exception: test
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| §8.4 | `try` statement | https://docs.python.org/3/reference/compound_stmts.html#the-try-statement |
| §7.8 | `raise` statement | https://docs.python.org/3/reference/simple_stmts.html#the-raise-statement |
| §8.5 | `with` statement | https://docs.python.org/3/reference/compound_stmts.html#the-with-statement |
| §3.3.9 | `__enter__`/`__exit__` | https://docs.python.org/3/reference/datamodel.html#context-managers |
| Built-in exceptions | Full hierarchy | https://docs.python.org/3/library/exceptions.html |
| `contextlib` | Context manager utilities | https://docs.python.org/3/library/contextlib.html |
| `traceback` | Traceback formatting | https://docs.python.org/3/library/traceback.html |
| `sys.exc_info` | Current exception | https://docs.python.org/3/library/sys.html#sys.exc_info |
| `sys.exception` | Current exception (3.12+) | https://docs.python.org/3/library/sys.html#sys.exception |
| PEP 3134 | Exception chaining | https://peps.python.org/pep-3134/ |
| PEP 3151 | OSError hierarchy | https://peps.python.org/pep-3151/ |
| PEP 654 | ExceptionGroup / except* | https://peps.python.org/pep-0654/ |
| PEP 678 | Exception notes | https://peps.python.org/pep-0678/ |
