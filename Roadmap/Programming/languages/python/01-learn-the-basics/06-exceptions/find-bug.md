# Python Exceptions -- Find the Bug

> Find and fix the bug in each code snippet. Each exercise has a difficulty level and a hidden solution.

---

## Easy (3 Bugs)

### Bug 1: Bare Except Catches Everything

```python
import sys

def shutdown_server():
    """Gracefully shut down the server."""
    try:
        print("Shutting down...")
        sys.exit(0)
    except:
        print("Caught an error, continuing...")

shutdown_server()
print("Server is still running!")  # This should NOT print
```

<details>
<summary>Hint</summary>
Bare <code>except</code> catches <code>SystemExit</code>, which inherits from <code>BaseException</code>, not <code>Exception</code>.
</details>

<details>
<summary>Solution</summary>

**Bug:** Bare `except` catches `SystemExit`, preventing the program from exiting. `sys.exit()` raises `SystemExit`, which inherits from `BaseException`.

```python
import sys

def shutdown_server():
    """Gracefully shut down the server."""
    try:
        print("Shutting down...")
        sys.exit(0)
    except Exception:  # FIX: only catch Exception, not BaseException
        print("Caught an error, continuing...")

# shutdown_server()  # Would actually exit now

# Demonstration without actually exiting:
try:
    sys.exit(0)
except SystemExit:
    print("SystemExit was raised (caught for demo)")

print("Bare except would have swallowed SystemExit!")
```
</details>

---

### Bug 2: Swallowed Exception Hides Real Error

```python
def get_user_data(user_id: int) -> dict:
    """Fetch user data from the database."""
    users = {1: {"name": "Alice", "age": 30}}
    try:
        user = users[user_id]
        return {"name": user["name"], "age": user["agee"]}  # typo: "agee"
    except Exception:
        return {"error": "User not found"}

# Test
result = get_user_data(1)
print(result)  # Expected: {"name": "Alice", "age": 30}
              # Actual: {"error": "User not found"} -- but user EXISTS!
```

<details>
<summary>Hint</summary>
The broad <code>except Exception</code> catches the <code>KeyError</code> from the typo <code>"agee"</code>, hiding a programming bug behind a misleading error message.
</details>

<details>
<summary>Solution</summary>

**Bug:** The typo `"agee"` raises `KeyError`, but the broad `except Exception` catches it and returns a misleading "User not found" message.

```python
def get_user_data(user_id: int) -> dict:
    """Fetch user data from the database."""
    users = {1: {"name": "Alice", "age": 30}}
    try:
        user = users[user_id]
    except KeyError:  # FIX: only catch the specific exception
        return {"error": "User not found"}

    # Access fields outside try/except so typos are NOT caught
    return {"name": user["name"], "age": user["age"]}  # FIX: "agee" -> "age"


# Tests
assert get_user_data(1) == {"name": "Alice", "age": 30}
assert get_user_data(999) == {"error": "User not found"}
print("All tests passed!")
```
</details>

---

### Bug 3: Wrong Exception Type

```python
def parse_config(config_str: str) -> dict:
    """Parse a 'key=value' config string."""
    result = {}
    for line in config_str.strip().split("\n"):
        try:
            key, value = line.split("=")
            result[key.strip()] = value.strip()
        except TypeError:  # Wrong exception type!
            print(f"Skipping invalid line: {line}")
    return result

config = """
host=localhost
port=8080
invalid_line_without_equals
debug=true
"""

print(parse_config(config))
# Crashes with ValueError, not TypeError!
```

<details>
<summary>Hint</summary>
<code>str.split("=")</code> with unpacking raises <code>ValueError</code> (not enough values to unpack), not <code>TypeError</code>.
</details>

<details>
<summary>Solution</summary>

**Bug:** `line.split("=")` produces a list with one element for lines without `=`, and unpacking raises `ValueError`, not `TypeError`.

```python
def parse_config(config_str: str) -> dict:
    """Parse a 'key=value' config string."""
    result = {}
    for line in config_str.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            key, value = line.split("=", 1)  # FIX: maxsplit=1 for values containing =
            result[key.strip()] = value.strip()
        except ValueError:  # FIX: correct exception type
            print(f"Skipping invalid line: {line}")
    return result


config = """
host=localhost
port=8080
invalid_line_without_equals
debug=true
"""

result = parse_config(config)
assert result == {"host": "localhost", "port": "8080", "debug": "true"}
print("All tests passed!")
```
</details>

---

## Medium (4 Bugs)

### Bug 4: Finally Overwrites Return Value

```python
def read_number(text: str) -> int | str:
    """Parse a number from text, with cleanup."""
    try:
        return int(text)
    except ValueError:
        return "invalid"
    finally:
        return 0  # "cleanup"

# Test
print(read_number("42"))       # Expected: 42, Actual: 0
print(read_number("hello"))    # Expected: "invalid", Actual: 0
```

<details>
<summary>Hint</summary>
A <code>return</code> in <code>finally</code> always executes and overwrites any return from <code>try</code> or <code>except</code>.
</details>

<details>
<summary>Solution</summary>

**Bug:** The `return 0` in `finally` always executes, overwriting whatever was returned in `try` or `except`. The `finally` block should only be used for cleanup, never for returning values.

```python
def read_number(text: str) -> int | str:
    """Parse a number from text, with cleanup."""
    try:
        result = int(text)
    except ValueError:
        result = "invalid"
    finally:
        print("Cleanup done")  # FIX: use finally for cleanup only, not return
    return result  # FIX: return outside finally


# Tests
assert read_number("42") == 42
assert read_number("hello") == "invalid"
print("All tests passed!")
```
</details>

---

### Bug 5: Exception in Exception Handler

```python
import logging

def process_file(path: str) -> str:
    """Process a file with error logging."""
    try:
        with open(path) as f:
            return f.read()
    except FileNotFoundError as e:
        # Try to log to a file that also doesn't exist
        with open("/nonexistent/dir/error.log", "a") as log:
            log.write(f"Error: {e}\n")
        return "Error logged"

# Test
result = process_file("missing.txt")
print(result)  # Crashes with ANOTHER FileNotFoundError from the log file!
```

<details>
<summary>Hint</summary>
The error handler itself can raise an exception. If writing to the log file fails, the new exception replaces the original one.
</details>

<details>
<summary>Solution</summary>

**Bug:** The `except` block tries to open a log file that doesn't exist, raising a second `FileNotFoundError` that replaces the original error.

```python
import logging

def process_file(path: str) -> str:
    """Process a file with error logging."""
    try:
        with open(path) as f:
            return f.read()
    except FileNotFoundError as e:
        # FIX: use a safe logging mechanism, handle logging errors too
        try:
            logging.error(f"File not found: {path} -- {e}")
        except Exception:
            pass  # Logging failure should not mask the original error
        return f"Error: file '{path}' not found"


# Tests
result = process_file("missing.txt")
assert "not found" in result
print("All tests passed!")
```
</details>

---

### Bug 6: Lost Exception Context with raise from

```python
def fetch_from_api(url: str) -> dict:
    """Fetch data from an API."""
    raise ConnectionError(f"Cannot connect to {url}")

def get_user_profile(user_id: int) -> dict:
    """Get user profile from API."""
    try:
        return fetch_from_api(f"https://api.example.com/users/{user_id}")
    except ConnectionError:
        raise RuntimeError("Failed to load user profile")
        # Original ConnectionError context is implicit, not explicit!

try:
    get_user_profile(1)
except RuntimeError as e:
    print(f"Error: {e}")
    print(f"Cause: {e.__cause__}")       # None -- no explicit cause!
    print(f"Context: {e.__context__}")    # ConnectionError -- but implicit
```

<details>
<summary>Hint</summary>
Without <code>from</code>, the original exception is set as <code>__context__</code> (implicit). Use <code>raise ... from e</code> to set <code>__cause__</code> (explicit chain).
</details>

<details>
<summary>Solution</summary>

**Bug:** Without `from`, the exception chain is implicit (`__context__`). Use `raise ... from original` to make the cause explicit (`__cause__`), which produces clearer tracebacks.

```python
def fetch_from_api(url: str) -> dict:
    """Fetch data from an API."""
    raise ConnectionError(f"Cannot connect to {url}")

def get_user_profile(user_id: int) -> dict:
    """Get user profile from API."""
    try:
        return fetch_from_api(f"https://api.example.com/users/{user_id}")
    except ConnectionError as e:
        raise RuntimeError("Failed to load user profile") from e  # FIX: explicit chain


try:
    get_user_profile(1)
except RuntimeError as e:
    assert e.__cause__ is not None  # Now has an explicit cause
    assert isinstance(e.__cause__, ConnectionError)
    print(f"Error: {e}")
    print(f"Cause: {e.__cause__}")

print("All tests passed!")
```
</details>

---

### Bug 7: Catching Exception in Generator Silently

```python
def safe_numbers(data: list[str]):
    """Generate valid numbers, skip invalid ones."""
    for item in data:
        try:
            yield int(item)
        except ValueError:
            pass  # silently skip

def total(data: list[str]) -> int:
    """Sum all valid numbers."""
    gen = safe_numbers(data)
    try:
        return sum(gen)
    except ValueError:
        return 0  # This never triggers because generator swallows errors

# The bug is subtle: what if a StopIteration is raised inside the generator?
def tricky_generator():
    """Generator that accidentally raises StopIteration."""
    values = iter([1, 2, 3])
    while True:
        try:
            yield next(values)  # Raises StopIteration when exhausted
        except ValueError:
            pass
        # StopIteration from next() is NOT caught by except ValueError
        # But since Python 3.7, StopIteration inside a generator becomes RuntimeError!

result = list(tricky_generator())
print(result)  # RuntimeError: generator raised StopIteration
```

<details>
<summary>Hint</summary>
Since Python 3.7 (PEP 479), <code>StopIteration</code> propagating out of a generator is converted to <code>RuntimeError</code>. Use a sentinel or catch <code>StopIteration</code> explicitly.
</details>

<details>
<summary>Solution</summary>

**Bug:** `next(values)` raises `StopIteration` when the iterator is exhausted. Since Python 3.7, `StopIteration` inside a generator is converted to `RuntimeError`.

```python
def tricky_generator():
    """Generator that properly handles iterator exhaustion."""
    values = iter([1, 2, 3])
    while True:
        try:
            value = next(values)
        except StopIteration:  # FIX: explicitly catch StopIteration
            return  # Properly end the generator
        yield value

# Alternative fix using sentinel:
def tricky_generator_v2():
    """Generator using sentinel pattern."""
    values = iter([1, 2, 3])
    sentinel = object()
    while (value := next(values, sentinel)) is not sentinel:
        yield value


result1 = list(tricky_generator())
result2 = list(tricky_generator_v2())
assert result1 == [1, 2, 3]
assert result2 == [1, 2, 3]
print("All tests passed!")
```
</details>

---

## Hard (3 Bugs)

### Bug 8: Exception in `__del__` During Garbage Collection

```python
class ResourceHolder:
    """Holds a resource and cleans up on deletion."""
    instances = []

    def __init__(self, name: str):
        self.name = name
        self.file = open(f"/tmp/resource_{name}.tmp", "w")
        ResourceHolder.instances.append(self)

    def __del__(self):
        # BUG: During interpreter shutdown, globals may already be None
        print(f"Cleaning up {self.name}")
        self.file.close()
        ResourceHolder.instances.remove(self)  # May fail during GC!

# Create objects
r1 = ResourceHolder("test1")
r2 = ResourceHolder("test2")
del r1
del r2
# During interpreter shutdown: 'ResourceHolder' or 'print' may be None!
# This causes: TypeError: 'NoneType' object is not callable
```

<details>
<summary>Hint</summary>
<code>__del__</code> is unreliable: global variables may be <code>None</code> during interpreter shutdown. Use context managers or <code>atexit</code> instead.
</details>

<details>
<summary>Solution</summary>

**Bug:** `__del__` is unreliable -- during garbage collection or interpreter shutdown, global references (`print`, class variables) may already be `None`. This causes `TypeError` or `AttributeError`.

```python
import atexit
import os
import weakref


class ResourceHolder:
    """Holds a resource with safe cleanup using weakref finalizer."""
    _instances: list = []

    def __init__(self, name: str):
        self.name = name
        self._path = f"/tmp/resource_{name}.tmp"
        self.file = open(self._path, "w")
        ResourceHolder._instances.append(self)

        # FIX: Use weakref.finalize for guaranteed cleanup
        self._finalizer = weakref.finalize(
            self, ResourceHolder._cleanup, self.file, self._path, name
        )

    @staticmethod
    def _cleanup(file, path, name):
        """Static cleanup function that doesn't depend on the object."""
        try:
            if not file.closed:
                file.close()
            if os.path.exists(path):
                os.unlink(path)
        except Exception:
            pass  # Best-effort cleanup during shutdown


# Test
r1 = ResourceHolder("test1")
r2 = ResourceHolder("test2")
r1.file.write("data")
assert not r1.file.closed
del r1  # Triggers weakref finalizer safely
# Temp file is cleaned up
assert not os.path.exists("/tmp/resource_test1.tmp")

r2._finalizer()  # Can also call explicitly
assert r2.file.closed
print("All tests passed!")
```
</details>

---

### Bug 9: Exception Masking in Context Manager

```python
class DatabaseConnection:
    """Context manager for database connections."""
    def __init__(self, url: str, fail_on_close: bool = False):
        self.url = url
        self.fail_on_close = fail_on_close

    def __enter__(self):
        print(f"Connected to {self.url}")
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.fail_on_close:
            raise ConnectionError("Failed to close connection!")
        # BUG: The exception from __exit__ replaces the original exception!
        print("Connection closed")
        return False

    def query(self, sql: str):
        raise RuntimeError(f"Query failed: {sql}")


# Test
try:
    with DatabaseConnection("localhost", fail_on_close=True) as db:
        db.query("SELECT * FROM users")
except ConnectionError as e:
    # We see ConnectionError, but the REAL error was RuntimeError!
    print(f"Caught: {e}")
    print(f"Original RuntimeError is LOST!")
```

<details>
<summary>Hint</summary>
If <code>__exit__</code> raises an exception, it replaces the original exception from the <code>with</code> block. You need to chain them explicitly.
</details>

<details>
<summary>Solution</summary>

**Bug:** When `__exit__` raises an exception, it replaces the original exception from the `with` block. The original `RuntimeError` is lost, and only the `ConnectionError` from cleanup is seen.

```python
class DatabaseConnection:
    """Context manager with safe exception handling in __exit__."""
    def __init__(self, url: str, fail_on_close: bool = False):
        self.url = url
        self.fail_on_close = fail_on_close

    def __enter__(self):
        print(f"Connected to {self.url}")
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            if self.fail_on_close:
                raise ConnectionError("Failed to close connection!")
            print("Connection closed")
        except ConnectionError as close_error:
            if exc_val is not None:
                # FIX: Chain the cleanup error to the original exception
                # so neither is lost
                exc_val.add_note(f"Additionally, cleanup failed: {close_error}")
                # Or for Python < 3.11, use __context__:
                # close_error.__context__ = exc_val
            else:
                raise  # No original exception, so the close error IS the problem
        return False  # Do not suppress the original exception

    def query(self, sql: str):
        raise RuntimeError(f"Query failed: {sql}")


# Test
try:
    with DatabaseConnection("localhost", fail_on_close=True) as db:
        db.query("SELECT * FROM users")
except RuntimeError as e:
    # FIX: Now we see the ORIGINAL RuntimeError
    print(f"Caught original: {e}")
    assert "Query failed" in str(e)
    notes = getattr(e, "__notes__", [])
    assert any("cleanup failed" in n for n in notes)

print("All tests passed!")
```
</details>

---

### Bug 10: Async Exception Safety -- Generator Cleanup

```python
def database_cursor(query: str):
    """Generator that simulates a database cursor."""
    print(f"Opening cursor for: {query}")
    connection = {"status": "open"}
    try:
        for i in range(1000):
            if i == 5:
                raise ValueError(f"Bad data at row {i}")
            yield {"row": i, "data": f"value_{i}"}
    except GeneratorExit:
        # GeneratorExit is sent when generator is garbage collected
        # BUG: Cannot yield inside GeneratorExit handler!
        yield {"status": "cleanup"}  # RuntimeError!
        connection["status"] = "closed"
    finally:
        connection["status"] = "closed"
        print(f"Cursor closed. Connection: {connection['status']}")


# Test 1: Normal iteration then abandon
gen = database_cursor("SELECT *")
for row in gen:
    if row["row"] >= 2:
        break  # Triggers GeneratorExit -> RuntimeError!

print("Done")
```

<details>
<summary>Hint</summary>
You cannot <code>yield</code> inside a <code>GeneratorExit</code> handler. <code>GeneratorExit</code> signals the generator to clean up and stop, so yielding during cleanup raises <code>RuntimeError</code>.
</details>

<details>
<summary>Solution</summary>

**Bug:** Yielding inside a `GeneratorExit` handler raises `RuntimeError`. When a generator is closed (via `break`, `del`, or `gc`), Python sends `GeneratorExit`. The generator must NOT yield during cleanup.

```python
def database_cursor(query: str):
    """Generator that simulates a database cursor with proper cleanup."""
    print(f"Opening cursor for: {query}")
    connection = {"status": "open"}
    try:
        for i in range(1000):
            if i == 5:
                raise ValueError(f"Bad data at row {i}")
            yield {"row": i, "data": f"value_{i}"}
    except GeneratorExit:
        # FIX: Do cleanup but NEVER yield here
        connection["status"] = "closed"
        print(f"GeneratorExit: cursor cleaned up. Connection: {connection['status']}")
        return  # Must return, not yield
    finally:
        # finally also runs on GeneratorExit -- safe for cleanup
        if connection["status"] != "closed":
            connection["status"] = "closed"
        print(f"Finally: Connection {connection['status']}")


# Test 1: Break early (triggers GeneratorExit)
gen = database_cursor("SELECT *")
rows = []
for row in gen:
    rows.append(row)
    if row["row"] >= 2:
        break

assert len(rows) == 3  # rows 0, 1, 2
assert rows[-1]["row"] == 2

# Test 2: Exhaust until ValueError
gen2 = database_cursor("SELECT *")
collected = []
try:
    for row in gen2:
        collected.append(row)
except ValueError as e:
    assert "Bad data at row 5" in str(e)

assert len(collected) == 5  # rows 0-4

print("All tests passed!")
```
</details>

---

## Score Card

| # | Difficulty | Topic | Fixed? |
|---|:----------:|-------|:------:|
| 1 | Easy | Bare except catches SystemExit | [ ] |
| 2 | Easy | Swallowed exception hides real error | [ ] |
| 3 | Easy | Wrong exception type (ValueError vs TypeError) | [ ] |
| 4 | Medium | Finally block overwrites return value | [ ] |
| 5 | Medium | Exception in exception handler | [ ] |
| 6 | Medium | Lost exception context (missing `from`) | [ ] |
| 7 | Medium | StopIteration in generator (PEP 479) | [ ] |
| 8 | Hard | Exception in `__del__` during GC | [ ] |
| 9 | Hard | Exception masking in `__exit__` | [ ] |
| 10 | Hard | Yielding during GeneratorExit | [ ] |

**Total fixed: ___ / 10**
