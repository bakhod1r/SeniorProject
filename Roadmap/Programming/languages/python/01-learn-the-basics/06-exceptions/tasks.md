# Python Exceptions -- Practice Tasks

---

## Junior Tasks (4)

### Task 1: Safe Division

Write a function that divides two numbers and handles `ZeroDivisionError`. Return the result or an error message string.

**Input:** `10, 0` -> **Output:** `"Error: division by zero"`
**Input:** `10, 3` -> **Output:** `3.3333333333333335`

<details>
<summary>Hint</summary>
Wrap the division in a <code>try/except ZeroDivisionError</code> block.
</details>

<details>
<summary>Solution</summary>

```python
def safe_divide(a: float, b: float) -> float | str:
    """Divide a by b, returning an error message if b is zero."""
    try:
        return a / b
    except ZeroDivisionError:
        return "Error: division by zero"


# Tests
assert safe_divide(10, 2) == 5.0
assert safe_divide(10, 0) == "Error: division by zero"
assert safe_divide(-6, 3) == -2.0
assert abs(safe_divide(10, 3) - 3.333333) < 0.001
assert safe_divide(0, 5) == 0.0
print("All tests passed!")
```
</details>

---

### Task 2: Safe Integer Parser

Write a function that converts a string to an integer. If the string is not a valid integer, return a default value.

**Input:** `"42", 0` -> **Output:** `42`
**Input:** `"hello", -1` -> **Output:** `-1`

<details>
<summary>Hint</summary>
Use <code>try/except ValueError</code> and return the default in the except block.
</details>

<details>
<summary>Solution</summary>

```python
def safe_int(value: str, default: int = 0) -> int:
    """Convert string to int, returning default if conversion fails."""
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


# Tests
assert safe_int("42") == 42
assert safe_int("hello", -1) == -1
assert safe_int("3.14") == 0  # int() can't parse float strings
assert safe_int("") == 0
assert safe_int(None, 99) == 99
assert safe_int("  100  ") == 100
print("All tests passed!")
```
</details>

---

### Task 3: File Reader with Cleanup

Write a function that reads the contents of a file and always prints "Done" when finished, whether or not an error occurred. Use `try/except/finally`.

**Input:** `"existing_file.txt"` -> **Output:** file contents
**Input:** `"nonexistent.txt"` -> **Output:** `"Error: file not found"`

<details>
<summary>Hint</summary>
Use <code>finally</code> to ensure cleanup code always runs, regardless of whether an exception occurred.
</details>

<details>
<summary>Solution</summary>

```python
import tempfile
import os


def read_file_safe(filepath: str) -> str:
    """Read a file's contents with proper error handling and cleanup."""
    result = ""
    try:
        with open(filepath, "r") as f:
            result = f.read()
    except FileNotFoundError:
        result = "Error: file not found"
    except PermissionError:
        result = "Error: permission denied"
    finally:
        print("Done")
    return result


# Tests
# Create a temp file for testing
with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as tmp:
    tmp.write("Hello, World!")
    tmp_path = tmp.name

assert read_file_safe(tmp_path) == "Hello, World!"
assert read_file_safe("/nonexistent/path.txt") == "Error: file not found"

os.unlink(tmp_path)
print("All tests passed!")
```
</details>

---

### Task 4: Multiple Exception Types

Write a function that accesses a dictionary key, converts the value to an integer, and divides 100 by that integer. Handle `KeyError`, `ValueError`, and `ZeroDivisionError` separately with specific messages.

**Input:** `{"x": "5"}, "x"` -> **Output:** `20.0`
**Input:** `{"x": "0"}, "x"` -> **Output:** `"Error: division by zero"`

<details>
<summary>Hint</summary>
Chain multiple <code>except</code> clauses to handle different error types with unique messages.
</details>

<details>
<summary>Solution</summary>

```python
def dict_divide(data: dict, key: str) -> float | str:
    """Get a value from dict, convert to int, divide 100 by it."""
    try:
        value = data[key]
        number = int(value)
        return 100 / number
    except KeyError:
        return f"Error: key '{key}' not found"
    except ValueError:
        return f"Error: '{data[key]}' is not a valid integer"
    except ZeroDivisionError:
        return "Error: division by zero"


# Tests
assert dict_divide({"x": "5"}, "x") == 20.0
assert dict_divide({"x": "0"}, "x") == "Error: division by zero"
assert dict_divide({"x": "abc"}, "x") == "Error: 'abc' is not a valid integer"
assert dict_divide({}, "x") == "Error: key 'x' not found"
assert dict_divide({"x": "10"}, "x") == 10.0
print("All tests passed!")
```
</details>

---

## Middle Tasks (3)

### Task 5: Custom Exception Hierarchy

Create a custom exception hierarchy for a banking system: `BankError` (base), `InsufficientFundsError`, `AccountLockedError`, `InvalidAmountError`. Implement a `BankAccount` class that uses them.

<details>
<summary>Hint</summary>
Custom exceptions should inherit from <code>Exception</code> (or a common base). Store context data as attributes.
</details>

<details>
<summary>Solution</summary>

```python
class BankError(Exception):
    """Base exception for banking operations."""
    pass


class InsufficientFundsError(BankError):
    """Raised when account balance is too low."""
    def __init__(self, balance: float, amount: float):
        self.balance = balance
        self.amount = amount
        super().__init__(
            f"Cannot withdraw ${amount:.2f}: only ${balance:.2f} available"
        )


class AccountLockedError(BankError):
    """Raised when account is locked."""
    def __init__(self, account_id: str):
        self.account_id = account_id
        super().__init__(f"Account '{account_id}' is locked")


class InvalidAmountError(BankError):
    """Raised when amount is invalid (negative or zero)."""
    def __init__(self, amount: float):
        self.amount = amount
        super().__init__(f"Invalid amount: ${amount:.2f}")


class BankAccount:
    def __init__(self, account_id: str, balance: float = 0.0):
        self.account_id = account_id
        self.balance = balance
        self.locked = False

    def withdraw(self, amount: float) -> float:
        if self.locked:
            raise AccountLockedError(self.account_id)
        if amount <= 0:
            raise InvalidAmountError(amount)
        if amount > self.balance:
            raise InsufficientFundsError(self.balance, amount)
        self.balance -= amount
        return self.balance

    def deposit(self, amount: float) -> float:
        if self.locked:
            raise AccountLockedError(self.account_id)
        if amount <= 0:
            raise InvalidAmountError(amount)
        self.balance += amount
        return self.balance


# Tests
account = BankAccount("ACC-001", 100.0)

# Normal operations
assert account.deposit(50.0) == 150.0
assert account.withdraw(30.0) == 120.0

# InsufficientFundsError
try:
    account.withdraw(500.0)
    assert False, "Should have raised InsufficientFundsError"
except InsufficientFundsError as e:
    assert e.balance == 120.0
    assert e.amount == 500.0

# InvalidAmountError
try:
    account.deposit(-10)
    assert False, "Should have raised InvalidAmountError"
except InvalidAmountError as e:
    assert e.amount == -10

# AccountLockedError
account.locked = True
try:
    account.withdraw(10)
    assert False, "Should have raised AccountLockedError"
except AccountLockedError as e:
    assert e.account_id == "ACC-001"

# Catch all bank errors with base class
account2 = BankAccount("ACC-002", 0)
account2.locked = True
try:
    account2.withdraw(10)
except BankError:
    pass  # Catches any bank-related error

print("All tests passed!")
```
</details>

---

### Task 6: Retry Decorator

Write a decorator that retries a function up to `n` times if it raises a specified exception. After all retries are exhausted, re-raise the last exception.

<details>
<summary>Hint</summary>
Use a loop inside the wrapper; catch the target exception and re-raise after the loop ends.
</details>

<details>
<summary>Solution</summary>

```python
import functools
import random
from typing import Type


def retry(
    max_retries: int = 3,
    exceptions: tuple[Type[Exception], ...] = (Exception,),
    delay: float = 0.0,
):
    """Decorator that retries a function on specified exceptions."""
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            for attempt in range(1, max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    print(f"  Attempt {attempt}/{max_retries} failed: {e}")
            raise last_exception
        return wrapper
    return decorator


# Test: simulate flaky function
call_count = 0

@retry(max_retries=5, exceptions=(ConnectionError,))
def flaky_api_call():
    """Simulates an API that fails randomly."""
    global call_count
    call_count += 1
    if call_count < 3:
        raise ConnectionError(f"Timeout (attempt {call_count})")
    return {"status": "ok", "data": [1, 2, 3]}


result = flaky_api_call()
assert result == {"status": "ok", "data": [1, 2, 3]}
assert call_count >= 3

# Test: exhausts all retries
@retry(max_retries=2, exceptions=(ValueError,))
def always_fails():
    raise ValueError("always broken")

try:
    always_fails()
    assert False, "Should have raised ValueError"
except ValueError as e:
    assert "always broken" in str(e)

# Test: non-matching exception is NOT retried
@retry(max_retries=3, exceptions=(ValueError,))
def raises_type_error():
    raise TypeError("wrong type")

try:
    raises_type_error()
    assert False, "Should have raised TypeError"
except TypeError:
    pass  # TypeError is not in the retry list, so it propagates immediately

print("All tests passed!")
```
</details>

---

### Task 7: Exception-Safe Resource Manager

Write a class that manages multiple resources (files, connections). If any resource fails to initialize, all previously opened resources must be cleaned up. Implement using `__enter__` and `__exit__`.

<details>
<summary>Hint</summary>
Track opened resources in a list; if one fails, iterate backwards closing everything.
</details>

<details>
<summary>Solution</summary>

```python
from contextlib import contextmanager


class Resource:
    """Simulates a resource that can fail on open or close."""
    def __init__(self, name: str, fail_on_open: bool = False):
        self.name = name
        self.fail_on_open = fail_on_open
        self.is_open = False

    def open(self):
        if self.fail_on_open:
            raise ConnectionError(f"Failed to open '{self.name}'")
        self.is_open = True
        print(f"  Opened: {self.name}")

    def close(self):
        if self.is_open:
            self.is_open = False
            print(f"  Closed: {self.name}")


class MultiResourceManager:
    """Manage multiple resources with safe cleanup."""

    def __init__(self, *resources: Resource):
        self.resources = resources
        self._opened: list[Resource] = []

    def __enter__(self):
        for resource in self.resources:
            try:
                resource.open()
                self._opened.append(resource)
            except Exception:
                # Clean up all previously opened resources
                self._cleanup()
                raise
        return self._opened

    def __exit__(self, exc_type, exc_val, exc_tb):
        self._cleanup()
        return False  # Do not suppress exceptions

    def _cleanup(self):
        """Close all opened resources in reverse order."""
        while self._opened:
            resource = self._opened.pop()
            try:
                resource.close()
            except Exception as e:
                print(f"  Warning: error closing {resource.name}: {e}")


# Test 1: All resources open successfully
r1, r2, r3 = Resource("DB"), Resource("Cache"), Resource("Queue")
with MultiResourceManager(r1, r2, r3) as resources:
    assert len(resources) == 3
    assert all(r.is_open for r in resources)
# After context, all should be closed
assert not r1.is_open and not r2.is_open and not r3.is_open

# Test 2: Third resource fails -> first two are cleaned up
r4 = Resource("DB2")
r5 = Resource("Cache2")
r6 = Resource("BadQueue", fail_on_open=True)

try:
    with MultiResourceManager(r4, r5, r6) as resources:
        assert False, "Should have raised ConnectionError"
except ConnectionError:
    pass

assert not r4.is_open, "DB2 should be cleaned up"
assert not r5.is_open, "Cache2 should be cleaned up"
assert not r6.is_open, "BadQueue was never opened"

print("All tests passed!")
```
</details>

---

## Senior Tasks (3)

### Task 8: Exception Groups (Python 3.11+)

Build an async-like batch processor that collects multiple exceptions from parallel tasks and raises them as an `ExceptionGroup`. Handle different exception types from the group using `except*`.

<details>
<summary>Solution</summary>

```python
import sys

# Requires Python 3.11+
if sys.version_info < (3, 11):
    print("ExceptionGroup requires Python 3.11+. Skipping test.")
else:
    exec('''
class ValidationError(Exception):
    """Validation failure with field info."""
    def __init__(self, field: str, message: str):
        self.field = field
        super().__init__(f"{field}: {message}")


class NetworkError(Exception):
    """Network-related failure."""
    def __init__(self, url: str, status: int):
        self.url = url
        self.status = status
        super().__init__(f"HTTP {status} from {url}")


def batch_process(tasks: list[dict]) -> list:
    """Process tasks, collecting all errors into an ExceptionGroup."""
    results = []
    errors = []

    for task in tasks:
        try:
            if task.get("type") == "validate":
                if not task.get("value"):
                    raise ValidationError(task["field"], "cannot be empty")
                results.append(f"validated: {task['field']}")

            elif task.get("type") == "fetch":
                if task.get("fail"):
                    raise NetworkError(task["url"], 500)
                results.append(f"fetched: {task['url']}")

            else:
                raise TypeError(f"Unknown task type: {task.get('type')}")

        except Exception as e:
            errors.append(e)

    if errors:
        raise ExceptionGroup("Batch processing failed", errors)

    return results


# Test
tasks = [
    {"type": "validate", "field": "name", "value": "Alice"},
    {"type": "validate", "field": "email", "value": ""},     # fails
    {"type": "fetch", "url": "https://api.example.com", "fail": True},  # fails
    {"type": "validate", "field": "age", "value": "30"},
    {"type": "unknown"},  # fails
]

validation_errors = []
network_errors = []
other_errors = []

try:
    batch_process(tasks)
except* ValidationError as eg:
    validation_errors = eg.exceptions
except* NetworkError as eg:
    network_errors = eg.exceptions
except* TypeError as eg:
    other_errors = eg.exceptions

assert len(validation_errors) == 1
assert validation_errors[0].field == "email"
assert len(network_errors) == 1
assert network_errors[0].status == 500
assert len(other_errors) == 1
print("All tests passed!")
    ''')
```
</details>

---

### Task 9: Robust Plugin System with Exception Isolation

Build a plugin system where each plugin runs in isolation. A failing plugin must not crash others. Collect errors with full tracebacks, support exception chaining, and provide a summary report.

<details>
<summary>Solution</summary>

```python
import traceback
from typing import Any, Callable, Protocol
from dataclasses import dataclass, field


class Plugin(Protocol):
    name: str
    def execute(self, context: dict) -> Any: ...


@dataclass
class PluginError:
    plugin_name: str
    exception: Exception
    traceback_str: str
    chained_from: str | None = None


@dataclass
class PluginResult:
    successes: dict[str, Any] = field(default_factory=dict)
    failures: list[PluginError] = field(default_factory=list)

    @property
    def summary(self) -> str:
        lines = [
            f"Plugin Execution Report",
            f"  Succeeded: {len(self.successes)}",
            f"  Failed:    {len(self.failures)}",
        ]
        for err in self.failures:
            lines.append(f"\n  [{err.plugin_name}] {type(err.exception).__name__}: {err.exception}")
            if err.chained_from:
                lines.append(f"    Caused by: {err.chained_from}")
        return "\n".join(lines)


class PluginRunner:
    def __init__(self):
        self._plugins: list[Any] = []

    def register(self, plugin):
        self._plugins.append(plugin)

    def run_all(self, context: dict) -> PluginResult:
        result = PluginResult()

        for plugin in self._plugins:
            try:
                output = plugin.execute(context)
                result.successes[plugin.name] = output
            except Exception as e:
                chained = None
                if e.__cause__:
                    chained = f"{type(e.__cause__).__name__}: {e.__cause__}"
                elif e.__context__ and not e.__suppress_context__:
                    chained = f"{type(e.__context__).__name__}: {e.__context__}"

                result.failures.append(PluginError(
                    plugin_name=plugin.name,
                    exception=e,
                    traceback_str=traceback.format_exc(),
                    chained_from=chained,
                ))

        return result


# --- Test Plugins ---

class GoodPlugin:
    name = "greeter"
    def execute(self, context: dict) -> str:
        return f"Hello, {context.get('user', 'World')}!"


class BadPlugin:
    name = "crasher"
    def execute(self, context: dict):
        try:
            int("not_a_number")
        except ValueError as original:
            raise RuntimeError("Plugin crashed during data parsing") from original


class AnotherGoodPlugin:
    name = "counter"
    def execute(self, context: dict) -> int:
        return len(context)


class SubtleBugPlugin:
    name = "divider"
    def execute(self, context: dict):
        return 100 / context.get("divisor", 0)


# Run
runner = PluginRunner()
runner.register(GoodPlugin())
runner.register(BadPlugin())
runner.register(AnotherGoodPlugin())
runner.register(SubtleBugPlugin())

result = runner.run_all({"user": "Alice", "divisor": 0})

print(result.summary)

assert "greeter" in result.successes
assert result.successes["greeter"] == "Hello, Alice!"
assert "counter" in result.successes
assert len(result.failures) == 2

# Check exception chaining
crasher_error = [f for f in result.failures if f.plugin_name == "crasher"][0]
assert crasher_error.chained_from is not None
assert "ValueError" in crasher_error.chained_from

print("\nAll tests passed!")
```
</details>

---

### Task 10: Structured Error Handling Middleware

Build an error handling middleware stack for a web-like framework. Each middleware layer can catch, transform, log, or re-raise exceptions. Support exception notes (Python 3.11+), custom error codes, and serialization to JSON.

<details>
<summary>Solution</summary>

```python
import json
import traceback
from typing import Any, Callable
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class AppError:
    """Structured application error."""
    code: str
    message: str
    status: int = 500
    details: dict = field(default_factory=dict)
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    cause: str | None = None

    def to_json(self) -> str:
        return json.dumps({
            "error": {
                "code": self.code,
                "message": self.message,
                "status": self.status,
                "details": self.details,
                "timestamp": self.timestamp,
                "cause": self.cause,
            }
        }, indent=2)


class AppException(Exception):
    """Exception that carries a structured AppError."""
    def __init__(self, error: AppError):
        self.error = error
        super().__init__(error.message)


# --- Middleware Stack ---

class ErrorMiddleware:
    """Base middleware class."""
    def __init__(self, next_handler: Callable | None = None):
        self.next_handler = next_handler

    def handle(self, request: dict) -> dict:
        if self.next_handler:
            return self.next_handler(request)
        return {"status": 200, "body": "OK"}


class ValidationMiddleware(ErrorMiddleware):
    """Catches ValueError and converts to structured AppError."""
    def handle(self, request: dict) -> dict:
        try:
            return super().handle(request)
        except ValueError as e:
            raise AppException(AppError(
                code="VALIDATION_ERROR",
                message=str(e),
                status=400,
                details={"request": request},
                cause=f"{type(e).__name__}: {e}",
            )) from e


class AuthMiddleware(ErrorMiddleware):
    """Catches PermissionError and converts to structured AppError."""
    def handle(self, request: dict) -> dict:
        try:
            return super().handle(request)
        except PermissionError as e:
            raise AppException(AppError(
                code="AUTH_ERROR",
                message="Authentication required",
                status=401,
                cause=f"{type(e).__name__}: {e}",
            )) from e


class CatchAllMiddleware(ErrorMiddleware):
    """Top-level middleware that catches all unhandled exceptions."""
    def handle(self, request: dict) -> dict:
        try:
            return super().handle(request)
        except AppException as e:
            return {
                "status": e.error.status,
                "body": e.error.to_json(),
            }
        except Exception as e:
            error = AppError(
                code="INTERNAL_ERROR",
                message="An unexpected error occurred",
                status=500,
                cause=traceback.format_exc(),
            )
            return {
                "status": 500,
                "body": error.to_json(),
            }


def build_middleware_stack(handler: Callable) -> CatchAllMiddleware:
    """Build middleware stack: CatchAll -> Auth -> Validation -> handler."""
    validation = ValidationMiddleware(handler)
    auth = AuthMiddleware(validation.handle)
    catch_all = CatchAllMiddleware(auth.handle)
    return catch_all


# --- Test ---

def app_handler(request: dict) -> dict:
    """Simulated app endpoint."""
    action = request.get("action")
    if action == "validate_fail":
        raise ValueError("Field 'email' is required")
    if action == "auth_fail":
        raise PermissionError("Invalid token")
    if action == "crash":
        raise RuntimeError("Database connection lost")
    return {"status": 200, "body": json.dumps({"message": "success"})}


stack = build_middleware_stack(app_handler)

# Test 1: Success
response = stack.handle({"action": "ok"})
assert response["status"] == 200

# Test 2: Validation error
response = stack.handle({"action": "validate_fail"})
assert response["status"] == 400
body = json.loads(response["body"])
assert body["error"]["code"] == "VALIDATION_ERROR"

# Test 3: Auth error
response = stack.handle({"action": "auth_fail"})
assert response["status"] == 401
body = json.loads(response["body"])
assert body["error"]["code"] == "AUTH_ERROR"

# Test 4: Unhandled error
response = stack.handle({"action": "crash"})
assert response["status"] == 500
body = json.loads(response["body"])
assert body["error"]["code"] == "INTERNAL_ERROR"

print("All tests passed!")
```
</details>

---

## Questions (10)

1. **What is the difference between `except Exception` and bare `except`?** Bare `except` catches everything including `SystemExit`, `KeyboardInterrupt`, and `GeneratorExit`, which inherit from `BaseException` but not `Exception`. Always use `except Exception` unless you have a specific reason to catch `BaseException` subclasses.

2. **What is exception chaining and when should you use `raise ... from ...`?** When you catch one exception and raise another, Python automatically sets `__context__`. Using `raise NewError() from original_error` explicitly sets `__cause__`, making the chain intentional. Use `raise ... from None` to suppress the implicit chain.

3. **What happens if an exception is raised inside a `finally` block?** It replaces the original exception. If both `try` and `finally` raise, only the `finally` exception propagates. The original exception is lost unless you explicitly save it.

4. **What is the EAFP (Easier to Ask Forgiveness than Permission) principle?** EAFP means trying an operation and catching exceptions if it fails, rather than checking preconditions (LBYL -- Look Before You Leap). EAFP is considered more Pythonic and is often faster when the common case succeeds.

5. **How do `__enter__` and `__exit__` work with exception handling?** `__exit__` receives `(exc_type, exc_val, exc_tb)`. If it returns `True`, the exception is suppressed. If it returns `False` or `None`, the exception propagates. This is how context managers handle cleanup and optional exception suppression.

6. **What are exception notes (`add_note`) introduced in Python 3.11?** You can add extra context to exceptions using `exc.add_note("extra info")`. Notes are stored in `__notes__` and displayed after the traceback, useful for adding context as exceptions propagate through layers.

7. **What is `ExceptionGroup` and `except*` (Python 3.11+)?** `ExceptionGroup` bundles multiple exceptions together for concurrent/async scenarios. `except*` lets you handle different types from the group independently -- each `except*` clause receives a sub-group of matching exceptions.

8. **Why should you avoid catching exceptions too broadly?** Broad catches (`except Exception`) hide bugs by silently catching unexpected errors like `AttributeError` or `TypeError` that indicate programming mistakes. Catch specific exceptions and let unexpected ones propagate to be discovered during development.

9. **What is the performance cost of try/except when no exception occurs?** Nearly zero. CPython uses a zero-cost exception model (since 3.11) -- entering a `try` block costs nothing. The cost is only paid when an exception is actually raised (stack unwinding, traceback creation).

10. **Can you re-raise an exception without losing the original traceback?** Yes, use bare `raise` inside an `except` block. Using `raise e` creates a new traceback from the current line. Always use `raise` (not `raise e`) to preserve the original traceback.

---

## Mini Projects (2)

### Mini Project 1: Validation Framework

Build a validation framework that collects all validation errors (instead of stopping at the first one) and reports them together.

**Requirements:**
1. Define validators as functions that raise `ValidationError`
2. A `Validator` class that runs all validators and collects errors
3. Support field-level and cross-field validation
4. Produce a structured error report

<details>
<summary>Solution</summary>

```python
from dataclasses import dataclass, field
from typing import Any, Callable


class ValidationError(Exception):
    """Single validation failure."""
    def __init__(self, field: str, message: str, code: str = "invalid"):
        self.field = field
        self.code = code
        super().__init__(f"[{field}] {message}")


@dataclass
class ValidationReport:
    errors: list[ValidationError] = field(default_factory=list)

    @property
    def is_valid(self) -> bool:
        return len(self.errors) == 0

    def errors_for(self, field_name: str) -> list[ValidationError]:
        return [e for e in self.errors if e.field == field_name]

    def summary(self) -> str:
        if self.is_valid:
            return "Validation passed."
        lines = [f"Validation failed ({len(self.errors)} error(s)):"]
        for err in self.errors:
            lines.append(f"  [{err.field}] ({err.code}) {err}")
        return "\n".join(lines)


class Validator:
    def __init__(self):
        self._field_validators: list[tuple[str, Callable]] = []
        self._cross_validators: list[Callable] = []

    def add_field_rule(self, field_name: str, rule: Callable[[Any], None]):
        """Add a rule for a single field. Rule should raise ValidationError."""
        self._field_validators.append((field_name, rule))

    def add_cross_rule(self, rule: Callable[[dict], None]):
        """Add a cross-field rule."""
        self._cross_validators.append(rule)

    def validate(self, data: dict) -> ValidationReport:
        report = ValidationReport()

        for field_name, rule in self._field_validators:
            try:
                rule(data.get(field_name))
            except ValidationError as e:
                report.errors.append(e)

        # Only run cross-field validators if field-level is clean
        for rule in self._cross_validators:
            try:
                rule(data)
            except ValidationError as e:
                report.errors.append(e)

        return report


# --- Built-in rules ---

def required(field_name: str):
    def check(value):
        if value is None or (isinstance(value, str) and not value.strip()):
            raise ValidationError(field_name, "is required", "required")
    return check


def min_length(field_name: str, length: int):
    def check(value):
        if value is not None and len(str(value)) < length:
            raise ValidationError(
                field_name, f"must be at least {length} characters", "min_length"
            )
    return check


def in_range(field_name: str, low: int, high: int):
    def check(value):
        if value is not None and not (low <= value <= high):
            raise ValidationError(
                field_name, f"must be between {low} and {high}", "range"
            )
    return check


def passwords_match(data: dict):
    if data.get("password") != data.get("confirm_password"):
        raise ValidationError("confirm_password", "passwords do not match", "mismatch")


# --- Test ---

v = Validator()
v.add_field_rule("username", required("username"))
v.add_field_rule("username", min_length("username", 3))
v.add_field_rule("email", required("email"))
v.add_field_rule("age", in_range("age", 18, 120))
v.add_cross_rule(passwords_match)

# Valid data
report = v.validate({
    "username": "alice",
    "email": "alice@example.com",
    "age": 25,
    "password": "secret123",
    "confirm_password": "secret123",
})
assert report.is_valid

# Invalid data
report = v.validate({
    "username": "ab",
    "email": "",
    "age": 15,
    "password": "secret",
    "confirm_password": "different",
})
assert not report.is_valid
assert len(report.errors_for("username")) >= 1
assert len(report.errors_for("email")) >= 1
assert len(report.errors_for("age")) >= 1
assert len(report.errors_for("confirm_password")) >= 1
print(report.summary())
print("\nAll tests passed!")
```
</details>

---

### Mini Project 2: Circuit Breaker Pattern

Implement the Circuit Breaker pattern: a wrapper that tracks failures and "opens" (stops calling the function) after too many consecutive failures, then allows a test call after a timeout.

**Requirements:**
1. Three states: `CLOSED` (normal), `OPEN` (blocking), `HALF_OPEN` (testing)
2. Configurable failure threshold and recovery timeout
3. Raise `CircuitOpenError` when the circuit is open
4. Automatically transition to `HALF_OPEN` after timeout

<details>
<summary>Solution</summary>

```python
import time
from enum import Enum
from typing import Callable, Any


class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitOpenError(Exception):
    """Raised when the circuit breaker is open."""
    def __init__(self, failures: int, retry_after: float):
        self.failures = failures
        self.retry_after = retry_after
        super().__init__(
            f"Circuit is OPEN after {failures} failures. "
            f"Retry after {retry_after:.1f}s"
        )


class CircuitBreaker:
    def __init__(
        self,
        failure_threshold: int = 3,
        recovery_timeout: float = 5.0,
        expected_exceptions: tuple = (Exception,),
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.expected_exceptions = expected_exceptions

        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._last_failure_time: float | None = None

    @property
    def state(self) -> CircuitState:
        if self._state == CircuitState.OPEN:
            if (time.monotonic() - self._last_failure_time) >= self.recovery_timeout:
                self._state = CircuitState.HALF_OPEN
        return self._state

    def call(self, func: Callable, *args, **kwargs) -> Any:
        current_state = self.state

        if current_state == CircuitState.OPEN:
            retry_after = self.recovery_timeout - (
                time.monotonic() - self._last_failure_time
            )
            raise CircuitOpenError(self._failure_count, max(0, retry_after))

        try:
            result = func(*args, **kwargs)
        except self.expected_exceptions as e:
            self._record_failure()
            raise
        else:
            self._record_success()
            return result

    def _record_failure(self):
        self._failure_count += 1
        self._last_failure_time = time.monotonic()
        if self._failure_count >= self.failure_threshold:
            self._state = CircuitState.OPEN

    def _record_success(self):
        self._failure_count = 0
        self._state = CircuitState.CLOSED


# --- Test ---

call_log = []

def unreliable_service(should_fail: bool = False):
    call_log.append("called")
    if should_fail:
        raise ConnectionError("Service unavailable")
    return "OK"


cb = CircuitBreaker(failure_threshold=3, recovery_timeout=0.5)

# Normal operation
assert cb.call(unreliable_service) == "OK"
assert cb.state == CircuitState.CLOSED

# Build up failures
for i in range(3):
    try:
        cb.call(unreliable_service, should_fail=True)
    except ConnectionError:
        pass

assert cb.state == CircuitState.OPEN

# Circuit is open -- calls are blocked
try:
    cb.call(unreliable_service)
    assert False, "Should have raised CircuitOpenError"
except CircuitOpenError as e:
    assert e.failures == 3

# Wait for recovery timeout
time.sleep(0.6)
assert cb.state == CircuitState.HALF_OPEN

# Successful call resets the circuit
assert cb.call(unreliable_service) == "OK"
assert cb.state == CircuitState.CLOSED

print(f"Total service calls: {len(call_log)}")
print("All tests passed!")
```
</details>

---

## Challenge (1)

### Challenge: Build an Exception-Safe Async Task Scheduler

Build a task scheduler that can run tasks with dependencies, handle failures gracefully (cancel dependent tasks), support retries, and produce a detailed execution report with full exception context.

**Requirements:**
1. Tasks are defined with names, callables, dependencies, and retry policies
2. A task only runs when all its dependencies have succeeded
3. If a task fails, all tasks that depend on it are cancelled with a clear reason
4. Support configurable retry count per task
5. Produce a final report showing: succeeded, failed (with traceback), cancelled (with reason), and total time
6. Use exception chaining to link cancellation reasons to root causes

<details>
<summary>Solution</summary>

```python
import time
import traceback
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable


class TaskStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskCancelled(Exception):
    """Raised when a task is cancelled due to dependency failure."""
    def __init__(self, task_name: str, reason: str):
        self.task_name = task_name
        super().__init__(f"Task '{task_name}' cancelled: {reason}")


@dataclass
class TaskResult:
    status: TaskStatus
    result: Any = None
    error: Exception | None = None
    traceback_str: str = ""
    cancel_reason: str = ""
    attempts: int = 0
    duration: float = 0.0


@dataclass
class Task:
    name: str
    func: Callable
    dependencies: list[str] = field(default_factory=list)
    max_retries: int = 1
    args: tuple = ()
    kwargs: dict = field(default_factory=dict)


@dataclass
class SchedulerReport:
    results: dict[str, TaskResult] = field(default_factory=dict)
    total_time: float = 0.0

    def summary(self) -> str:
        succeeded = [n for n, r in self.results.items() if r.status == TaskStatus.SUCCESS]
        failed = [n for n, r in self.results.items() if r.status == TaskStatus.FAILED]
        cancelled = [n for n, r in self.results.items() if r.status == TaskStatus.CANCELLED]

        lines = [
            "=" * 50,
            "TASK SCHEDULER REPORT",
            "=" * 50,
            f"Total time: {self.total_time:.3f}s",
            f"Succeeded:  {len(succeeded)} {succeeded}",
            f"Failed:     {len(failed)} {failed}",
            f"Cancelled:  {len(cancelled)} {cancelled}",
            "-" * 50,
        ]

        for name in failed:
            r = self.results[name]
            lines.append(f"\nFAILED: {name} (after {r.attempts} attempt(s))")
            lines.append(f"  Error: {r.error}")
            lines.append(f"  Traceback:\n    {r.traceback_str.strip()}")

        for name in cancelled:
            r = self.results[name]
            lines.append(f"\nCANCELLED: {name}")
            lines.append(f"  Reason: {r.cancel_reason}")

        lines.append("=" * 50)
        return "\n".join(lines)


class TaskScheduler:
    def __init__(self):
        self._tasks: dict[str, Task] = {}

    def add_task(self, task: Task):
        self._tasks[task.name] = task

    def _get_execution_order(self) -> list[str]:
        """Topological sort of tasks based on dependencies."""
        visited = set()
        order = []
        visiting = set()

        def visit(name: str):
            if name in visiting:
                raise ValueError(f"Circular dependency detected: {name}")
            if name in visited:
                return
            visiting.add(name)
            task = self._tasks[name]
            for dep in task.dependencies:
                if dep not in self._tasks:
                    raise ValueError(f"Unknown dependency: '{dep}' for task '{name}'")
                visit(dep)
            visiting.remove(name)
            visited.add(name)
            order.append(name)

        for name in self._tasks:
            visit(name)

        return order

    def run(self) -> SchedulerReport:
        report = SchedulerReport()
        start_time = time.monotonic()

        try:
            execution_order = self._get_execution_order()
        except ValueError as e:
            # If we can't even sort, report single error
            report.total_time = time.monotonic() - start_time
            return report

        failed_tasks: set[str] = set()

        for task_name in execution_order:
            task = self._tasks[task_name]

            # Check if any dependency has failed
            failed_deps = [d for d in task.dependencies if d in failed_tasks]
            if failed_deps:
                failed_tasks.add(task_name)
                dep_errors = "; ".join(
                    f"'{d}' -> {report.results[d].error or report.results[d].cancel_reason}"
                    for d in failed_deps
                )
                report.results[task_name] = TaskResult(
                    status=TaskStatus.CANCELLED,
                    cancel_reason=f"Dependencies failed: {dep_errors}",
                )
                continue

            # Run with retries
            task_start = time.monotonic()
            last_error = None
            tb_str = ""

            for attempt in range(1, task.max_retries + 1):
                try:
                    result = task.func(*task.args, **task.kwargs)
                    report.results[task_name] = TaskResult(
                        status=TaskStatus.SUCCESS,
                        result=result,
                        attempts=attempt,
                        duration=time.monotonic() - task_start,
                    )
                    break
                except Exception as e:
                    last_error = e
                    tb_str = traceback.format_exc()
            else:
                # All retries exhausted
                failed_tasks.add(task_name)
                report.results[task_name] = TaskResult(
                    status=TaskStatus.FAILED,
                    error=last_error,
                    traceback_str=tb_str,
                    attempts=task.max_retries,
                    duration=time.monotonic() - task_start,
                )

        report.total_time = time.monotonic() - start_time
        return report


# --- Test ---

def fetch_data():
    return {"users": ["Alice", "Bob"]}

def process_data():
    raise ConnectionError("Database timeout")

def generate_report():
    return "report.pdf"

def send_email():
    return "email sent"

def cleanup():
    return "cleaned up"


scheduler = TaskScheduler()
scheduler.add_task(Task("fetch", fetch_data))
scheduler.add_task(Task("process", process_data, dependencies=["fetch"], max_retries=2))
scheduler.add_task(Task("report", generate_report, dependencies=["process"]))
scheduler.add_task(Task("email", send_email, dependencies=["report"]))
scheduler.add_task(Task("cleanup", cleanup))

report = scheduler.run()
print(report.summary())

# Assertions
assert report.results["fetch"].status == TaskStatus.SUCCESS
assert report.results["process"].status == TaskStatus.FAILED
assert report.results["process"].attempts == 2
assert report.results["report"].status == TaskStatus.CANCELLED
assert report.results["email"].status == TaskStatus.CANCELLED
assert report.results["cleanup"].status == TaskStatus.SUCCESS

print("\nAll tests passed!")
```
</details>
