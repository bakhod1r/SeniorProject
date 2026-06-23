# Python Exceptions — Interview Questions

---

## Junior Level (5-7 Questions)

### Q1. What is the difference between `except Exception` and bare `except:`?

<details>
<summary>Answer</summary>

**Bare `except:`** catches ALL exceptions, including `SystemExit`, `KeyboardInterrupt`, and `GeneratorExit` (which inherit from `BaseException`, not `Exception`).

**`except Exception:`** catches only "normal" exceptions — it does NOT catch `SystemExit`, `KeyboardInterrupt`, or `GeneratorExit`.

```python
# ❌ Bare except — user can't Ctrl+C to stop the program
try:
    while True:
        data = input("Enter data: ")
except:
    pass  # Catches KeyboardInterrupt — program never stops!

# ✅ except Exception — KeyboardInterrupt still works
try:
    while True:
        data = input("Enter data: ")
except Exception as e:
    print(f"Error: {e}")
```

**Rule:** Never use bare `except:` in production code.
</details>

### Q2. What is the purpose of the `else` clause in try/except?

<details>
<summary>Answer</summary>

The `else` block runs only when NO exception was raised in the `try` block. It separates "success" code from "error-prone" code:

```python
try:
    value = int(user_input)
except ValueError:
    print("Invalid number")
else:
    # Only runs if int() succeeded
    print(f"You entered: {value}")
    save_to_database(value)
```

**Benefits:**
- Keeps the try block small (only code that might raise)
- Makes it clear which code runs on success vs failure
- Code in `else` is NOT protected by the except — bugs there will propagate normally
</details>

### Q3. What does this code output?

```python
def f():
    try:
        return "try"
    finally:
        return "finally"

print(f())
```

<details>
<summary>Answer</summary>

Output: `finally`

The `finally` block's return statement overrides the `try` block's return. This is a common pitfall — **never use `return` in `finally` blocks**.

The `finally` block always executes, even when `try` contains a `return`. Since `finally` also returns, it replaces the value from `try`.
</details>

### Q4. How do you create a custom exception?

<details>
<summary>Answer</summary>

Inherit from `Exception` (not `BaseException`):

```python
class InsufficientFundsError(Exception):
    """Raised when account balance is too low."""
    def __init__(self, balance: float, amount: float):
        self.balance = balance
        self.amount = amount
        super().__init__(
            f"Cannot withdraw ${amount:.2f}, balance is ${balance:.2f}"
        )

# Usage
try:
    if amount > balance:
        raise InsufficientFundsError(balance=100.0, amount=250.0)
except InsufficientFundsError as e:
    print(e)            # Cannot withdraw $250.00, balance is $100.00
    print(e.balance)    # 100.0
    print(e.amount)     # 250.0
```

**Best practices:**
- Always inherit from `Exception`, not `BaseException`
- Name ends with `Error`
- Include relevant data as attributes
- Call `super().__init__()` with a human-readable message
</details>

### Q5. What is the difference between `raise` and `raise e`?

<details>
<summary>Answer</summary>

```python
try:
    risky()
except ValueError as e:
    raise     # ✅ Re-raises with original traceback preserved
    raise e   # ❌ Creates a NEW traceback starting from this line
```

- **`raise`** (bare) re-raises the current exception with its original traceback intact
- **`raise e`** raises `e` as a new exception, creating a new traceback from the current location

**Always use bare `raise`** when re-raising — it preserves the full call chain.
</details>

### Q6. Can you catch multiple exception types in one `except` clause?

<details>
<summary>Answer</summary>

Yes, use a tuple:

```python
try:
    process(data)
except (ValueError, TypeError, KeyError) as e:
    print(f"Data error: {e}")
```

**Common mistake:**
```python
# ❌ SyntaxError in Python 3
except ValueError, TypeError:  # This is Python 2 syntax!

# ✅ Correct
except (ValueError, TypeError):
```
</details>

### Q7. Why should you NOT use `assert` for input validation?

<details>
<summary>Answer</summary>

`assert` statements are removed when Python runs with `-O` (optimize) flag:

```python
# ❌ Dangerous — assert is removed in production!
def withdraw(amount):
    assert amount > 0, "Amount must be positive"
    # With python -O, this check is GONE

# ✅ Safe — always runs
def withdraw(amount):
    if amount <= 0:
        raise ValueError("Amount must be positive")
```

`assert` is a debugging tool for catching developer mistakes during development. It should never be used for:
- User input validation
- Security checks
- Business rule enforcement
</details>

---

## Middle Level (4-6 Questions)

### Q1. Explain exception chaining: `raise X from Y` vs implicit chaining.

<details>
<summary>Answer</summary>

**Explicit chaining (`raise X from Y`):**
- Sets `X.__cause__ = Y`
- Sets `X.__suppress_context__ = True`
- Traceback shows: "The above exception was the direct cause of the following exception"

**Implicit chaining (exception in except block):**
- Sets `X.__context__ = Y` automatically
- Traceback shows: "During handling of the above exception, another exception occurred"

```python
# Explicit chaining
try:
    data = json.loads(raw_text)
except json.JSONDecodeError as e:
    raise ConfigError("Invalid config format") from e
    # ConfigError.__cause__ = JSONDecodeError

# Implicit chaining
try:
    data = json.loads(raw_text)
except json.JSONDecodeError:
    raise ConfigError("Invalid config format")
    # ConfigError.__context__ = JSONDecodeError (automatic)

# Suppress chain
try:
    data = json.loads(raw_text)
except json.JSONDecodeError:
    raise ConfigError("Invalid config") from None
    # No chain shown in traceback
```

**When to use each:**
- `from e` — when the new exception directly wraps the original (most common)
- Implicit — rarely intentional; usually means you forgot `from e`
- `from None` — when internal details should be hidden from the user
</details>

### Q2. What is EAFP vs LBYL? When is each faster?

<details>
<summary>Answer</summary>

**EAFP** (Easier to Ask Forgiveness than Permission): Try the operation, handle the failure.
**LBYL** (Look Before You Leap): Check the condition before the operation.

```python
# EAFP
try:
    value = data[key]
except KeyError:
    value = default

# LBYL
if key in data:
    value = data[key]
else:
    value = default
```

**Performance characteristics:**
| Scenario | EAFP | LBYL |
|----------|------|------|
| Key exists (common) | ~45ns (no exception overhead) | ~55ns (two lookups: `in` + `[]`) |
| Key missing (rare) | ~350ns (exception creation) | ~35ns (one lookup: `in`) |

**Rules of thumb:**
- EAFP is faster when success is common (no wasted check)
- LBYL is faster when failure is common (avoids exception overhead)
- EAFP is safer for race conditions (file might be deleted between check and open)
- Use `dict.get()` when available — it beats both
</details>

### Q3. How does `contextlib.suppress()` work? Write a simplified implementation.

<details>
<summary>Answer</summary>

```python
from contextlib import contextmanager

# Simplified implementation
class suppress:
    def __init__(self, *exceptions):
        self._exceptions = exceptions

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        # Return True to suppress the exception
        if exc_type is not None:
            return issubclass(exc_type, self._exceptions)
        return False

# Usage
with suppress(FileNotFoundError, PermissionError):
    os.remove("temp.txt")  # No error if file missing or no permission
```

**Key insight:** When `__exit__` returns `True`, the exception is suppressed. When it returns `False` (or `None`), the exception propagates normally.
</details>

### Q4. What's the output and why?

```python
class A(Exception): pass
class B(A): pass
class C(B): pass

for cls in [A, B, C]:
    try:
        raise cls()
    except C:
        print("C", end=" ")
    except B:
        print("B", end=" ")
    except A:
        print("A", end=" ")
```

<details>
<summary>Answer</summary>

Output: `A B C`

- `raise A()` → caught by `except A` (no match for C or B, since A is not a subclass of either)
- `raise B()` → caught by `except B` (B is not a subclass of C, but matches B)
- `raise C()` → caught by `except C` (first match wins)

**Key point:** `except` uses `issubclass()` for matching. Subclasses match parent except clauses, but parent exceptions do NOT match child except clauses. This is why you must order `except` from most specific to most general.
</details>

### Q5. How do `ExceptionGroup` and `except*` work (Python 3.11+)?

<details>
<summary>Answer</summary>

`ExceptionGroup` wraps multiple exceptions that occurred concurrently:

```python
# Creating
eg = ExceptionGroup("errors", [
    ValueError("bad value"),
    TypeError("bad type"),
    ValueError("another bad value"),
])

# except* selectively handles sub-exceptions
try:
    raise eg
except* ValueError as matched:
    # matched is an ExceptionGroup containing only ValueErrors
    print(f"ValueErrors: {len(matched.exceptions)}")  # 2
except* TypeError as matched:
    print(f"TypeErrors: {len(matched.exceptions)}")    # 1
```

**How it works internally:**
1. `except* ValueError` calls `eg.split(ValueError)`
2. `split()` returns `(matching_group, rest_group)`
3. The matching group is bound to the variable
4. The rest is passed to the next `except*` clause
5. Any unmatched exceptions are re-raised automatically

**Important rules:**
- Cannot mix `except` and `except*` in the same try
- Cannot use bare `except*` — must specify a type
- `except*` can match the same exception group multiple times
</details>

### Q6. What happens when an exception is raised in `__del__`?

<details>
<summary>Answer</summary>

Python **ignores** exceptions in `__del__` methods. It prints a warning to stderr but does not propagate the exception:

```python
class Leaky:
    def __del__(self):
        raise ValueError("cleanup failed!")

obj = Leaky()
del obj
# Output: Exception ignored in: <function Leaky.__del__ at 0x...>
# Traceback (most recent call last): ...
# ValueError: cleanup failed!

print("Program continues normally")  # This DOES execute
```

**Why:** `__del__` is called by the garbage collector, often at unpredictable times. Allowing exceptions to propagate would make the program's control flow non-deterministic.

**Solution:** Use context managers (`__enter__`/`__exit__`) or explicit `close()` methods for cleanup.
</details>

---

## Senior Level (4-6 Questions)

### Q1. Design an exception hierarchy for a payment processing system.

<details>
<summary>Answer</summary>

```python
class PaymentError(Exception):
    """Base exception for payment system."""
    def __init__(self, message: str, transaction_id: str | None = None):
        super().__init__(message)
        self.transaction_id = transaction_id

# Validation errors (client's fault — 4xx)
class PaymentValidationError(PaymentError): pass
class InvalidCardError(PaymentValidationError): pass
class ExpiredCardError(PaymentValidationError): pass
class InsufficientFundsError(PaymentValidationError):
    def __init__(self, balance: float, amount: float, **kwargs):
        super().__init__(f"Balance {balance} < {amount}", **kwargs)
        self.balance = balance
        self.amount = amount

# Processing errors (system's fault — 5xx)
class PaymentProcessingError(PaymentError): pass
class GatewayTimeoutError(PaymentProcessingError): pass
class GatewayConnectionError(PaymentProcessingError): pass
class FraudDetectedError(PaymentProcessingError): pass

# Usage in middleware
@app.exception_handler(PaymentValidationError)
async def handle_validation(request, exc):
    return JSONResponse(status_code=400, content={"error": str(exc)})

@app.exception_handler(PaymentProcessingError)
async def handle_processing(request, exc):
    logger.error("Payment processing failed: %s", exc, exc_info=True)
    return JSONResponse(status_code=502, content={"error": "Payment gateway unavailable"})
```

**Design principles:**
1. One base class for the entire subsystem (`PaymentError`)
2. Split by responsibility: validation (client fault) vs processing (system fault)
3. Carry domain-specific data (transaction_id, balance, amount)
4. Map to HTTP status codes at the API boundary
</details>

### Q2. How does CPython's zero-cost exception handling work (3.11+)?

<details>
<summary>Answer</summary>

Before 3.11, `try` blocks had runtime setup cost — `SETUP_FINALLY` pushed an entry onto the frame's block stack. In 3.11+:

1. **Compile time:** The compiler generates an **exception table** stored in `code.co_exceptiontable`
2. **No runtime setup:** Entering a `try` block generates NO bytecode instructions
3. **On exception:** CPython binary-searches the exception table using the current bytecode offset
4. **Result:** `try` blocks are literally zero-cost when no exception is raised

```python
import dis

def example():
    try:
        x = 1
    except ValueError:
        x = 2

dis.dis(example)
# Notice: NO SETUP_FINALLY instruction
# ExceptionTable at the end maps offset ranges to handlers
```

**Impact:** In tight loops, wrapping code in `try/except` no longer has any measurable overhead. The cost only occurs when an exception is actually raised.
</details>

### Q3. How would you implement a circuit breaker pattern with exceptions?

<details>
<summary>Answer</summary>

See the full implementation in senior.md. Key points for interviews:

```python
class CircuitBreaker:
    """Three states: CLOSED (normal), OPEN (failing), HALF_OPEN (testing)."""

    def __init__(self, failure_threshold=5, recovery_timeout=30):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failure_count = 0
        self.last_failure_time = 0
        self.state = "CLOSED"
        self._lock = threading.Lock()  # Thread safety!

    def execute(self, func, *args, **kwargs):
        if self.state == "OPEN":
            if time.monotonic() - self.last_failure_time > self.recovery_timeout:
                self.state = "HALF_OPEN"
            else:
                raise CircuitOpenError("Circuit is open")

        try:
            result = func(*args, **kwargs)
            self._on_success()
            return result
        except Exception as e:
            self._on_failure()
            raise

    def _on_success(self):
        with self._lock:
            self.failure_count = 0
            self.state = "CLOSED"

    def _on_failure(self):
        with self._lock:
            self.failure_count += 1
            self.last_failure_time = time.monotonic()
            if self.failure_count >= self.failure_threshold:
                self.state = "OPEN"
```

**Interview talking points:**
- Thread safety (Lock for shared state)
- Three states with transitions
- Recovery timeout for HALF_OPEN
- Configurable threshold
- Works as a decorator
</details>

### Q4. What are the performance implications of exceptions in hot paths?

<details>
<summary>Answer</summary>

**Entering a try block:** Nearly zero cost (3.11+), ~2ns overhead (pre-3.11)

**Raising an exception:** ~350-500ns due to:
1. Creating the exception object (~50ns)
2. Creating the traceback chain (~100-200ns per frame)
3. Stack unwinding (~50-100ns per frame)
4. Exception matching via `issubclass()` (~20ns)

**In hot paths (millions of iterations):**

```python
# ❌ 50% failure rate → ~4.5s for 10M iterations
for item in ten_million_items:
    try:
        result = int(item)  # raises ValueError for ~50% of items
    except ValueError:
        result = 0

# ✅ Pre-validate → ~1.2s for 10M iterations
for item in ten_million_items:
    result = int(item) if item.isdigit() else 0
```

**Rules:**
- If exception rate < 1%, use EAFP (try/except) — negligible overhead
- If exception rate > 10%, use LBYL (pre-validation) — significant savings
- Profile before optimizing — `cProfile` or `py-spy` will show if exceptions are the bottleneck
</details>

### Q5. How do you test exception handling comprehensively?

<details>
<summary>Answer</summary>

```python
import pytest

class TestUserService:
    # 1. Test the exception is raised
    def test_invalid_id_raises(self, service):
        with pytest.raises(ValidationError, match="positive"):
            service.get_user(-1)

    # 2. Test exception attributes
    def test_not_found_carries_id(self, service):
        with pytest.raises(NotFoundError) as exc_info:
            service.get_user(99999)
        assert exc_info.value.resource == "User"
        assert exc_info.value.identifier == 99999

    # 3. Test exception chaining
    def test_db_error_is_chained(self, service, mock_db):
        mock_db.find.side_effect = DatabaseError("timeout")
        with pytest.raises(ServiceError) as exc_info:
            service.get_user(1)
        assert isinstance(exc_info.value.__cause__, DatabaseError)

    # 4. Test exception does NOT leak
    @pytest.mark.parametrize("bad_input", [None, "", -1, 2**64])
    def test_only_raises_domain_errors(self, service, bad_input):
        with pytest.raises(AppError):  # Base class — catches all domain errors
            service.get_user(bad_input)

    # 5. Test retry behavior
    def test_retries_on_transient_error(self, service, mock_db):
        mock_db.find.side_effect = [TimeoutError(), TimeoutError(), {"id": 1}]
        result = service.get_user(1)
        assert result["id"] == 1
        assert mock_db.find.call_count == 3

    # 6. Test cleanup on exception
    def test_connection_closed_on_error(self, service, mock_conn):
        mock_conn.query.side_effect = DatabaseError("bad query")
        with pytest.raises(ServiceError):
            service.get_user(1)
        mock_conn.close.assert_called_once()
```
</details>

### Q6. Explain the exception variable deletion in Python 3.

<details>
<summary>Answer</summary>

In Python 3, the `except` variable is **deleted** after the except block exits:

```python
try:
    raise ValueError("test")
except ValueError as e:
    saved = e  # Save it if you need it later

# print(e)  → NameError: name 'e' is not defined
print(saved)  # Works fine
```

**Why?** To prevent reference cycles:
- The exception has a `__traceback__` attribute
- The traceback references the frame
- The frame's locals include the exception variable `e`
- This creates a cycle: `e → traceback → frame → locals → e`

**Implementation:** The compiler transforms the except block into:

```python
except ValueError as e:
    try:
        # your code
    finally:
        del e  # Explicit deletion to break the cycle
```

This is why the variable disappears — it is explicitly deleted by a `finally` clause inserted by the compiler.
</details>

---

## Scenario-Based Questions (3-5)

### Scenario 1: Microservice Error Handling

**You are building a FastAPI microservice that calls three external APIs. How would you design the error handling?**

<details>
<summary>Answer</summary>

```python
# 1. Define exception hierarchy
class ExternalServiceError(Exception):
    def __init__(self, service: str, message: str, retry_after: int | None = None):
        super().__init__(f"{service}: {message}")
        self.service = service
        self.retry_after = retry_after

class ServiceTimeoutError(ExternalServiceError): pass
class ServiceUnavailableError(ExternalServiceError): pass
class ServiceAuthError(ExternalServiceError): pass

# 2. Wrapper with retry + circuit breaker per service
class ServiceClient:
    def __init__(self, name: str, base_url: str):
        self.name = name
        self.circuit = CircuitBreaker(failure_threshold=5)

    async def call(self, endpoint: str, **kwargs) -> dict:
        try:
            return await self.circuit.execute(
                self._make_request, endpoint, **kwargs
            )
        except httpx.TimeoutException as e:
            raise ServiceTimeoutError(self.name, str(e)) from e
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                raise ServiceAuthError(self.name, "Authentication failed") from e
            if e.response.status_code >= 500:
                raise ServiceUnavailableError(self.name, str(e)) from e
            raise

# 3. Aggregate errors with ExceptionGroup
async def process_order(order: dict) -> dict:
    async with asyncio.TaskGroup() as tg:
        inventory = tg.create_task(inventory_client.call("/check", item=order["item"]))
        payment = tg.create_task(payment_client.call("/charge", amount=order["total"]))
        shipping = tg.create_task(shipping_client.call("/rate", address=order["address"]))
    # If any fail, TaskGroup raises ExceptionGroup

# 4. FastAPI exception handler
@app.exception_handler(ExternalServiceError)
async def handle_service_error(request, exc):
    headers = {}
    if exc.retry_after:
        headers["Retry-After"] = str(exc.retry_after)
    return JSONResponse(
        status_code=502,
        content={"error": f"Upstream service '{exc.service}' failed"},
        headers=headers,
    )
```
</details>

### Scenario 2: Data Pipeline Error Recovery

**You are processing 1 million records from a CSV file. Some records may have invalid data. How do you handle errors without stopping the entire pipeline?**

<details>
<summary>Answer</summary>

```python
import csv
import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

@dataclass
class PipelineResult:
    processed: int = 0
    failed: int = 0
    errors: list[tuple[int, str, str]] = field(default_factory=list)
    max_errors: int = 100  # Store at most 100 error details

    def record_error(self, row_num: int, row: str, error: str):
        self.failed += 1
        if len(self.errors) < self.max_errors:
            self.errors.append((row_num, row[:200], error))

    @property
    def error_rate(self) -> float:
        total = self.processed + self.failed
        return self.failed / total if total > 0 else 0.0


def process_csv(filepath: str, error_threshold: float = 0.1) -> PipelineResult:
    """Process CSV with error threshold — abort if too many errors."""
    result = PipelineResult()

    with open(filepath, "r") as f:
        reader = csv.DictReader(f)
        for row_num, row in enumerate(reader, 1):
            try:
                record = validate_and_transform(row)
                save(record)
                result.processed += 1
            except (ValueError, KeyError, TypeError) as e:
                result.record_error(row_num, str(row), str(e))
                logger.warning("Row %d failed: %s", row_num, e)
            except Exception as e:
                # Unexpected error — log and continue cautiously
                result.record_error(row_num, str(row), f"UNEXPECTED: {e}")
                logger.exception("Unexpected error at row %d", row_num)

            # Check error threshold every 1000 rows
            if row_num % 1000 == 0 and result.error_rate > error_threshold:
                raise PipelineAbortError(
                    f"Error rate {result.error_rate:.1%} exceeds threshold "
                    f"{error_threshold:.1%} at row {row_num}",
                    result=result,
                )

    return result
```
</details>

### Scenario 3: Legacy Code Migration

**You are migrating a codebase that uses return codes for errors to exceptions. What is your strategy?**

<details>
<summary>Answer</summary>

**Phased approach:**

```python
# Phase 1: Adapter layer — translate return codes to exceptions
def legacy_process(data):
    """Legacy function returns (result, error_code)."""
    result, code = _legacy_c_binding(data)
    if code == 0:
        return result
    elif code == 1:
        raise ValueError(f"Invalid data: {data}")
    elif code == 2:
        raise ConnectionError("Backend unavailable")
    elif code == 3:
        raise TimeoutError("Operation timed out")
    else:
        raise RuntimeError(f"Unknown error code: {code}")

# Phase 2: Define domain exceptions
class ProcessingError(Exception): ...
class InvalidDataError(ProcessingError): ...
class BackendError(ProcessingError): ...

# Phase 3: Wrap legacy calls with domain exceptions
def process(data: dict) -> dict:
    try:
        return legacy_process(data)
    except ValueError as e:
        raise InvalidDataError(str(e)) from e
    except (ConnectionError, TimeoutError) as e:
        raise BackendError(str(e)) from e

# Phase 4: New code uses domain exceptions natively
class OrderService:
    def create_order(self, order: dict) -> dict:
        if not order.get("items"):
            raise InvalidDataError("Order must have items")
        # ... pure exception-based error handling
```

**Key principles:**
- Never change both error strategy and business logic at the same time
- Adapter layer at the boundary between old and new code
- Preserve error semantics during translation
- Test both old return-code paths and new exception paths
</details>

### Scenario 4: Async Exception Handling

**How do you handle exceptions in asyncio tasks that run concurrently?**

<details>
<summary>Answer</summary>

```python
import asyncio
import logging

logger = logging.getLogger(__name__)

# Approach 1: TaskGroup (Python 3.11+) — recommended
async def fetch_all_v1(urls: list[str]) -> list[dict]:
    try:
        async with asyncio.TaskGroup() as tg:
            tasks = [tg.create_task(fetch(url)) for url in urls]
        return [t.result() for t in tasks]
    except* ConnectionError as eg:
        failed = [str(e) for e in eg.exceptions]
        logger.error("Connection failures: %s", failed)
        raise ServiceError(f"{len(failed)} connections failed") from eg

# Approach 2: gather with return_exceptions (pre-3.11)
async def fetch_all_v2(urls: list[str]) -> list[dict]:
    results = await asyncio.gather(
        *[fetch(url) for url in urls],
        return_exceptions=True,
    )
    successes = []
    failures = []
    for url, result in zip(urls, results):
        if isinstance(result, Exception):
            failures.append((url, result))
        else:
            successes.append(result)

    if failures:
        logger.error("Failed URLs: %s", [(u, str(e)) for u, e in failures])

    return successes

# Approach 3: Individual task error handling
async def fetch_all_v3(urls: list[str]) -> list[dict]:
    async def safe_fetch(url: str) -> dict | None:
        try:
            return await fetch(url)
        except Exception as e:
            logger.error("Failed to fetch %s: %s", url, e)
            return None

    results = await asyncio.gather(*[safe_fetch(url) for url in urls])
    return [r for r in results if r is not None]
```
</details>

---

## FAQ

### Q: Should I always use try/except instead of if/else?

**A:** No. Use try/except (EAFP) when the operation is likely to succeed and failure is exceptional. Use if/else (LBYL) when failure is common or when checking is cheap. Use built-in methods (`dict.get()`, `getattr(obj, attr, default)`) when available.

### Q: Is it okay to catch `Exception`?

**A:** At the outermost level (e.g., API middleware, main loop), catching `Exception` is acceptable as a safety net — but always log the full traceback. Inside business logic, always catch specific exceptions.

### Q: Should custom exceptions inherit from `Exception` or `BaseException`?

**A:** Always inherit from `Exception`. `BaseException` is for system-level exceptions (`SystemExit`, `KeyboardInterrupt`, `GeneratorExit`) that should not normally be caught by application code.

### Q: How do I decide between raising an exception and returning None/Optional?

**A:** Raise an exception when the error is truly exceptional and the caller must handle it. Return `None`/`Optional` when "not found" is a normal, expected outcome (e.g., `dict.get()`, database lookups).

### Q: Is exception handling slower than error codes?

**A:** On the happy path, exception handling is equal or faster (zero-cost try in 3.11+). On the error path, exceptions are ~10-25x slower than return values due to traceback creation. For most applications, this does not matter — optimize only when profiling shows it.
