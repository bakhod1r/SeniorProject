# Python Exceptions -- Optimization Exercises

> Optimize each slow exception handling pattern. Measure the improvement with `timeit`.

---

## Score Card

| # | Difficulty | Topic | Type | Optimized? | Speedup |
|---|:----------:|-------|:----:|:----------:|:-------:|
| 1 | Easy | EAFP vs LBYL for dict access | CPU | [ ] | ___x |
| 2 | Easy | EAFP vs LBYL for type conversion | CPU | [ ] | ___x |
| 3 | Easy | Avoid exception for control flow | CPU | [ ] | ___x |
| 4 | Medium | Custom exception with __slots__ | Memory | [ ] | ___x |
| 5 | Medium | Pre-validation vs try/except in hot loop | CPU | [ ] | ___x |
| 6 | Medium | Context manager vs manual try/finally | CPU | [ ] | ___x |
| 7 | Medium | Exception cost: shallow vs deep stack | CPU | [ ] | ___x |
| 8 | Hard | Batch error collection vs individual try | CPU | [ ] | ___x |
| 9 | Hard | Pattern matching vs exception chain | CPU | [ ] | ___x |
| 10 | Hard | Zero-cost try vs if-check when exceptions are rare | CPU | [ ] | ___x |

**Total optimized: ___ / 10**

---

## Exercise 1: EAFP vs LBYL for Dict Access

**Difficulty:** Easy

```python
import timeit

# SLOW: LBYL (Look Before You Leap) -- check before access
def get_value_lbyl(data: dict, key: str, default=None):
    """Check if key exists before accessing."""
    if key in data:
        return data[key]
    return default


data = {f"key_{i}": i for i in range(1000)}

# Test with existing keys (common case)
slow_time = timeit.timeit(
    lambda: [get_value_lbyl(data, f"key_{i}") for i in range(1000)],
    number=1000
)
print(f"Slow (LBYL, key exists): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

When the key almost always exists, EAFP (`try/except KeyError`) avoids the double lookup (`in` + `[]`). But when keys are frequently missing, LBYL is faster because raising exceptions is expensive.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import timeit

data = {f"key_{i}": i for i in range(1000)}

# SLOW: LBYL -- double lookup (check + access)
def get_value_lbyl(data, key, default=None):
    if key in data:
        return data[key]
    return default

# FAST: EAFP -- single lookup when key exists (common case)
def get_value_eafp(data, key, default=None):
    try:
        return data[key]
    except KeyError:
        return default

# FASTEST: dict.get() -- built-in C implementation
def get_value_builtin(data, key, default=None):
    return data.get(key, default)

# Benchmark: keys mostly exist (999 out of 1000 exist)
keys = [f"key_{i}" for i in range(1000)]

lbyl_time = timeit.timeit(lambda: [get_value_lbyl(data, k) for k in keys], number=1000)
eafp_time = timeit.timeit(lambda: [get_value_eafp(data, k) for k in keys], number=1000)
builtin_time = timeit.timeit(lambda: [get_value_builtin(data, k) for k in keys], number=1000)

print(f"LBYL (if/in):     {lbyl_time:.4f}s")
print(f"EAFP (try/except): {eafp_time:.4f}s")
print(f"dict.get():        {builtin_time:.4f}s")
print(f"Speedup (EAFP vs LBYL): {lbyl_time / eafp_time:.1f}x")
print(f"Speedup (get vs LBYL):  {lbyl_time / builtin_time:.1f}x")
# dict.get() is typically fastest; EAFP beats LBYL when keys mostly exist
```

**Why it's faster:** LBYL performs two hash lookups (`key in data` + `data[key]`), while EAFP and `dict.get()` perform only one. The `try` block has zero overhead in CPython 3.11+ (zero-cost exceptions), so when exceptions are rare, EAFP is nearly as fast as `dict.get()`.

</details>

---

## Exercise 2: EAFP vs LBYL for Type Conversion

**Difficulty:** Easy

```python
import timeit

# SLOW: LBYL -- check with regex before converting
import re

def safe_int_lbyl(value: str) -> int | None:
    """Check if string is numeric before converting."""
    if re.match(r'^-?\d+$', value):
        return int(value)
    return None


data = [str(i) for i in range(10000)]  # All valid integers

slow_time = timeit.timeit(lambda: [safe_int_lbyl(x) for x in data], number=100)
print(f"Slow (regex check): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

Regex validation before <code>int()</code> is redundant when the input is almost always valid. <code>try/except ValueError</code> skips the regex overhead entirely.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import timeit
import re

def safe_int_lbyl(value: str) -> int | None:
    if re.match(r'^-?\d+$', value):
        return int(value)
    return None

# FAST: EAFP -- just try it
def safe_int_eafp(value: str) -> int | None:
    try:
        return int(value)
    except (ValueError, TypeError):
        return None

# FASTER: LBYL with str methods (no regex)
def safe_int_isdigit(value: str) -> int | None:
    stripped = value.lstrip('-')
    if stripped.isdigit():
        return int(value)
    return None

data_valid = [str(i) for i in range(10000)]
data_mixed = [str(i) if i % 2 == 0 else "abc" for i in range(10000)]

# Benchmark: all valid
lbyl_time = timeit.timeit(lambda: [safe_int_lbyl(x) for x in data_valid], number=100)
eafp_time = timeit.timeit(lambda: [safe_int_eafp(x) for x in data_valid], number=100)
isdigit_time = timeit.timeit(lambda: [safe_int_isdigit(x) for x in data_valid], number=100)

print("=== All valid inputs ===")
print(f"LBYL (regex):    {lbyl_time:.4f}s")
print(f"EAFP (try):      {eafp_time:.4f}s")
print(f"LBYL (isdigit):  {isdigit_time:.4f}s")
print(f"Speedup (EAFP vs regex): {lbyl_time / eafp_time:.1f}x")

# Benchmark: 50% invalid
lbyl_mixed = timeit.timeit(lambda: [safe_int_lbyl(x) for x in data_mixed], number=100)
eafp_mixed = timeit.timeit(lambda: [safe_int_eafp(x) for x in data_mixed], number=100)

print("\n=== 50% invalid inputs ===")
print(f"LBYL (regex): {lbyl_mixed:.4f}s")
print(f"EAFP (try):   {eafp_mixed:.4f}s")
# When many inputs are invalid, EAFP becomes slower due to exception overhead
```

**Why it's faster:** Regex compilation and matching is expensive. `try/except` with `int()` has zero try-block overhead (Python 3.11+) and `int()` is a fast C function. When inputs are mostly valid, EAFP avoids the validation overhead entirely.

</details>

---

## Exercise 3: Avoid Exception for Control Flow

**Difficulty:** Easy

```python
import timeit

# SLOW: Using exception for control flow
def find_item_exception(items: list, target) -> int:
    """Find item index using exception for 'not found'."""
    try:
        return items.index(target)
    except ValueError:
        return -1


items = list(range(10000))

# Searching for items that DON'T exist (worst case for exception approach)
slow_time = timeit.timeit(
    lambda: [find_item_exception(items, -i) for i in range(100)],
    number=1000
)
print(f"Slow (exception for not-found): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

When "not found" is a common case (not exceptional), using a conditional check or a set for O(1) lookup is much faster than catching <code>ValueError</code>.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import timeit

items = list(range(10000))
items_set = set(items)

# SLOW: Exception for common "not found" case
def find_exception(items, target):
    try:
        return items.index(target)
    except ValueError:
        return -1

# FAST: Use set for existence check + index only when found
def find_set_check(items, items_set, target):
    if target in items_set:
        return items.index(target)
    return -1

# FASTEST: Build an index dict for O(1) lookup
items_index = {v: i for i, v in enumerate(items)}
def find_dict_lookup(items_index, target):
    return items_index.get(target, -1)

# Benchmark: targets that DON'T exist
missing_targets = [-i for i in range(100)]

exc_time = timeit.timeit(
    lambda: [find_exception(items, t) for t in missing_targets], number=1000
)
set_time = timeit.timeit(
    lambda: [find_set_check(items, items_set, t) for t in missing_targets], number=1000
)
dict_time = timeit.timeit(
    lambda: [find_dict_lookup(items_index, t) for t in missing_targets], number=1000
)

print(f"Exception:    {exc_time:.4f}s")
print(f"Set check:    {set_time:.4f}s")
print(f"Dict lookup:  {dict_time:.4f}s")
print(f"Speedup (set vs exc):  {exc_time / set_time:.1f}x")
print(f"Speedup (dict vs exc): {exc_time / dict_time:.1f}x")
```

**Why it's faster:** Raising an exception creates a traceback object, unwinds the stack, and performs costly C-level operations. When "not found" is common (not exceptional), a hash-based check (`set`/`dict`) avoids this overhead entirely and runs in O(1) instead of O(n).

</details>

---

## Exercise 4: Custom Exception with `__slots__`

**Difficulty:** Medium

```python
import timeit
import sys

# SLOW: Custom exception with __dict__ (default)
class AppError(Exception):
    def __init__(self, code: str, message: str, details: dict):
        self.code = code
        self.message = message
        self.details = details
        super().__init__(message)


errors = []
for i in range(100_000):
    errors.append(AppError("ERR_001", f"Error {i}", {"index": i}))

print(f"Memory per error (with __dict__): ~{sys.getsizeof(errors[0]) + sys.getsizeof(errors[0].__dict__)} bytes")
```

<details>
<summary>Hint</summary>

Exception instances with <code>__dict__</code> use more memory. Using <code>__slots__</code> eliminates the per-instance dict and reduces memory usage.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import timeit
import sys

# SLOW: Exception with __dict__
class AppErrorSlow(Exception):
    def __init__(self, code, message, details):
        self.code = code
        self.message = message
        self.details = details
        super().__init__(message)

# FAST: Exception with __slots__
class AppErrorFast(Exception):
    __slots__ = ("code", "message", "details")
    def __init__(self, code, message, details):
        self.code = code
        self.message = message
        self.details = details
        super().__init__(message)

# Memory comparison
slow_errors = [AppErrorSlow("E", f"msg_{i}", {"i": i}) for i in range(10000)]
fast_errors = [AppErrorFast("E", f"msg_{i}", {"i": i}) for i in range(10000)]

slow_size = sum(sys.getsizeof(e) + sys.getsizeof(e.__dict__) for e in slow_errors[:100]) / 100
fast_size = sum(sys.getsizeof(e) for e in fast_errors[:100]) / 100

print(f"Avg size (with __dict__): {slow_size:.0f} bytes")
print(f"Avg size (with __slots__): {fast_size:.0f} bytes")
print(f"Memory savings: {(1 - fast_size / slow_size) * 100:.0f}%")

# Speed comparison: creation
slow_time = timeit.timeit(
    lambda: AppErrorSlow("E", "msg", {"k": "v"}), number=1_000_000
)
fast_time = timeit.timeit(
    lambda: AppErrorFast("E", "msg", {"k": "v"}), number=1_000_000
)

print(f"\nCreation (dict):   {slow_time:.4f}s")
print(f"Creation (slots):  {fast_time:.4f}s")
print(f"Speedup: {slow_time / fast_time:.1f}x")
# __slots__ avoids creating a __dict__ per instance
```

**Why it's faster:** Each `__dict__` is a separate hash table object (~100 bytes minimum). `__slots__` stores attributes as a compact C struct, saving both memory allocation time and per-instance memory overhead.

</details>

---

## Exercise 5: Pre-validation vs try/except in Hot Loop

**Difficulty:** Medium

```python
import timeit

# SLOW: try/except inside a hot loop with frequent exceptions
def process_records_exception(records: list[dict]) -> list[float]:
    """Process records, converting 'value' field to float."""
    results = []
    for record in records:
        try:
            results.append(float(record["value"]))
        except (KeyError, ValueError, TypeError):
            results.append(0.0)
    return results


# 30% of records are bad
records = []
for i in range(10000):
    if i % 3 == 0:
        records.append({"value": "not_a_number"})
    elif i % 7 == 0:
        records.append({})  # Missing key
    else:
        records.append({"value": str(i * 1.5)})

slow_time = timeit.timeit(lambda: process_records_exception(records), number=100)
print(f"Slow (try/except in loop): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

When a significant percentage of iterations raise exceptions, pre-validating is faster. Filter or check before the expensive operation.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import timeit

records = []
for i in range(10000):
    if i % 3 == 0:
        records.append({"value": "not_a_number"})
    elif i % 7 == 0:
        records.append({})
    else:
        records.append({"value": str(i * 1.5)})

# SLOW: try/except on every record
def process_exception(records):
    results = []
    for r in records:
        try:
            results.append(float(r["value"]))
        except (KeyError, ValueError, TypeError):
            results.append(0.0)
    return results

# FAST: Pre-validate before conversion
def process_prevalidate(records):
    results = []
    for r in records:
        val = r.get("value")
        if val is not None:
            try:
                results.append(float(val))
            except (ValueError, TypeError):
                results.append(0.0)
        else:
            results.append(0.0)
    return results

# FASTEST: Separate good from bad, batch process
def process_batch(records):
    results = [0.0] * len(records)
    for i, r in enumerate(records):
        val = r.get("value")
        if val is not None and isinstance(val, str) and val.replace('.', '', 1).replace('-', '', 1).isdigit():
            results[i] = float(val)
    return results

exc_time = timeit.timeit(lambda: process_exception(records), number=100)
pre_time = timeit.timeit(lambda: process_prevalidate(records), number=100)
batch_time = timeit.timeit(lambda: process_batch(records), number=100)

# Verify correctness
assert process_exception(records) == process_prevalidate(records)

print(f"try/except:     {exc_time:.4f}s")
print(f"Pre-validate:   {pre_time:.4f}s")
print(f"Batch validate: {batch_time:.4f}s")
print(f"Speedup (pre vs exc):   {exc_time / pre_time:.1f}x")
print(f"Speedup (batch vs exc): {exc_time / batch_time:.1f}x")
```

**Why it's faster:** Each exception raise creates a traceback object and unwinds the stack. When 30%+ of iterations raise exceptions, the cumulative cost is significant. Pre-validation with `dict.get()` and `isinstance()` avoids exception overhead for the common failure cases.

</details>

---

## Exercise 6: Context Manager vs Manual try/finally

**Difficulty:** Medium

```python
import timeit

# SLOW: Manual try/finally for resource management
class Resource:
    def __init__(self):
        self.data = []
    def acquire(self):
        self.data.append(1)
    def release(self):
        self.data.pop()

def use_manual():
    """Manual try/finally resource management."""
    r = Resource()
    r.acquire()
    try:
        return sum(r.data)
    finally:
        r.release()


slow_time = timeit.timeit(use_manual, number=1_000_000)
print(f"Slow (try/finally): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

<code>contextlib.contextmanager</code> with a generator is often faster than a class-based context manager because it avoids <code>__enter__</code>/<code>__exit__</code> method lookup overhead.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import timeit
from contextlib import contextmanager

class Resource:
    def __init__(self):
        self.data = []
    def acquire(self):
        self.data.append(1)
    def release(self):
        self.data.pop()

# SLOW: Manual try/finally
def use_manual():
    r = Resource()
    r.acquire()
    try:
        return sum(r.data)
    finally:
        r.release()

# Class-based context manager
class ResourceCM:
    def __init__(self):
        self.resource = Resource()
    def __enter__(self):
        self.resource.acquire()
        return self.resource
    def __exit__(self, *args):
        self.resource.release()
        return False

def use_class_cm():
    with ResourceCM() as r:
        return sum(r.data)

# Generator-based context manager (often fastest)
@contextmanager
def managed_resource():
    r = Resource()
    r.acquire()
    try:
        yield r
    finally:
        r.release()

def use_gen_cm():
    with managed_resource() as r:
        return sum(r.data)

manual_time = timeit.timeit(use_manual, number=1_000_000)
class_time = timeit.timeit(use_class_cm, number=1_000_000)
gen_time = timeit.timeit(use_gen_cm, number=1_000_000)

print(f"Manual try/finally:  {manual_time:.4f}s")
print(f"Class-based CM:      {class_time:.4f}s")
print(f"Generator-based CM:  {gen_time:.4f}s")
print(f"Speedup (class vs manual): {manual_time / class_time:.2f}x")
print(f"Speedup (gen vs manual):   {manual_time / gen_time:.2f}x")
```

**Why it's faster:** Manual `try/finally` is actually the raw baseline. Class-based context managers add `__enter__`/`__exit__` dispatch overhead. However, the real benefit of context managers is correctness (guaranteed cleanup) and readability, not raw speed. In practice, the overhead is negligible compared to actual I/O operations.

</details>

---

## Exercise 7: Exception Cost -- Shallow vs Deep Stack

**Difficulty:** Medium

```python
import timeit

# SLOW: Raising exception deep in the call stack
def level_4():
    raise ValueError("deep error")

def level_3():
    return level_4()

def level_2():
    return level_3()

def level_1():
    return level_2()

def catch_deep():
    try:
        level_1()
    except ValueError:
        pass


slow_time = timeit.timeit(catch_deep, number=500_000)
print(f"Slow (4-level deep exception): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

Exception cost scales with stack depth because Python must build a traceback object that references every frame. Shallower stacks produce cheaper exceptions.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import timeit

# Deep stack (4 levels)
def deep_4():
    raise ValueError("deep")
def deep_3():
    return deep_4()
def deep_2():
    return deep_3()
def deep_1():
    return deep_2()

def catch_deep():
    try:
        deep_1()
    except ValueError:
        pass

# Shallow stack (1 level)
def shallow():
    raise ValueError("shallow")

def catch_shallow():
    try:
        shallow()
    except ValueError:
        pass

# No exception (return error value instead)
def no_exception():
    return None, "error"

def catch_none():
    result, error = no_exception()
    if error:
        pass

# Very deep stack (10 levels)
def d10(): raise ValueError("very deep")
def d9(): return d10()
def d8(): return d9()
def d7(): return d8()
def d6(): return d7()
def d5(): return d6()
def d4(): return d5()
def d3(): return d4()
def d2(): return d3()
def d1(): return d2()

def catch_very_deep():
    try:
        d1()
    except ValueError:
        pass

deep_time = timeit.timeit(catch_deep, number=500_000)
shallow_time = timeit.timeit(catch_shallow, number=500_000)
none_time = timeit.timeit(catch_none, number=500_000)
vdeep_time = timeit.timeit(catch_very_deep, number=500_000)

print(f"No exception (return):   {none_time:.4f}s")
print(f"Shallow (1 level):       {shallow_time:.4f}s")
print(f"Deep (4 levels):         {deep_time:.4f}s")
print(f"Very deep (10 levels):   {vdeep_time:.4f}s")
print(f"\nCost per stack level: ~{(vdeep_time - shallow_time) / 9 * 1_000_000 / 500_000:.2f}us")
print(f"Speedup (return vs shallow): {shallow_time / none_time:.1f}x")
print(f"Speedup (shallow vs deep):   {deep_time / shallow_time:.1f}x")
```

**Why it's faster:** When Python raises an exception, it creates a `traceback` object that chains a new frame for every level of the call stack. Deeper stacks mean more frame objects, more memory allocation, and more pointer chasing. Returning error values avoids traceback creation entirely.

</details>

---

## Exercise 8: Batch Error Collection vs Individual try/except

**Difficulty:** Hard

```python
import timeit

# SLOW: Individual try/except for each item
def validate_individually(items: list[str]) -> tuple[list[int], list[str]]:
    """Validate items one by one with try/except."""
    valid = []
    errors = []
    for item in items:
        try:
            valid.append(int(item))
        except ValueError:
            errors.append(f"Invalid: {item}")
    return valid, errors


# 20% invalid
items = [str(i) if i % 5 != 0 else f"bad_{i}" for i in range(50000)]

slow_time = timeit.timeit(lambda: validate_individually(items), number=50)
print(f"Slow (individual try/except): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

Separate the data into valid and invalid groups FIRST using a cheap check, then batch-process each group without exceptions.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import timeit

items = [str(i) if i % 5 != 0 else f"bad_{i}" for i in range(50000)]

# SLOW: try/except per item
def validate_individually(items):
    valid, errors = [], []
    for item in items:
        try:
            valid.append(int(item))
        except ValueError:
            errors.append(f"Invalid: {item}")
    return valid, errors

# FAST: Partition first, then batch convert
def validate_batch(items):
    valid_strs = []
    errors = []
    for item in items:
        # Cheap check: is it all digits (possibly with leading minus)?
        stripped = item.lstrip('-')
        if stripped.isdigit() and stripped:
            valid_strs.append(item)
        else:
            errors.append(f"Invalid: {item}")
    valid = list(map(int, valid_strs))
    return valid, errors

# FASTEST: Use filter + map with minimal overhead
def validate_filter(items):
    def is_int_str(s):
        stripped = s.lstrip('-')
        return stripped.isdigit() and len(stripped) > 0

    valid_strs = list(filter(is_int_str, items))
    invalid_strs = [f"Invalid: {s}" for s in items if not is_int_str(s)]
    return list(map(int, valid_strs)), invalid_strs

# Verify correctness
r1 = validate_individually(items)
r2 = validate_batch(items)
assert r1[0] == r2[0]
assert len(r1[1]) == len(r2[1])

ind_time = timeit.timeit(lambda: validate_individually(items), number=50)
batch_time = timeit.timeit(lambda: validate_batch(items), number=50)
filter_time = timeit.timeit(lambda: validate_filter(items), number=50)

print(f"Individual try/except: {ind_time:.4f}s")
print(f"Batch (partition):     {batch_time:.4f}s")
print(f"Filter + map:          {filter_time:.4f}s")
print(f"Speedup (batch vs ind): {ind_time / batch_time:.1f}x")
```

**Why it's faster:** Raising 10,000 exceptions (20% of 50,000) creates 10,000 traceback objects. Partitioning with a string check is O(1) per item with no object creation overhead. `map(int, ...)` is also faster than calling `int()` in a Python loop because it dispatches from C.

</details>

---

## Exercise 9: Pattern Matching vs Exception Chain for Error Dispatch

**Difficulty:** Hard

```python
import timeit

# SLOW: Exception-based dispatch
class NotFoundError(Exception): pass
class AuthError(Exception): pass
class ValidationError(Exception): pass

def handle_error_exception(error_code: int) -> str:
    """Dispatch error handling using exceptions."""
    try:
        if error_code == 404:
            raise NotFoundError()
        elif error_code == 401:
            raise AuthError()
        elif error_code == 422:
            raise ValidationError()
        else:
            raise Exception("Unknown")
    except NotFoundError:
        return "Not Found"
    except AuthError:
        return "Unauthorized"
    except ValidationError:
        return "Validation Failed"
    except Exception:
        return "Unknown Error"


codes = [404, 401, 422, 500] * 2500

slow_time = timeit.timeit(lambda: [handle_error_exception(c) for c in codes], number=100)
print(f"Slow (exception dispatch): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

Using exceptions for flow control (raise + catch) is expensive. Use a dictionary lookup or <code>match/case</code> (Python 3.10+) for dispatch instead.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import timeit
import sys

class NotFoundError(Exception): pass
class AuthError(Exception): pass
class ValidationError(Exception): pass

# SLOW: Exception-based dispatch
def handle_exception(code):
    try:
        if code == 404: raise NotFoundError()
        elif code == 401: raise AuthError()
        elif code == 422: raise ValidationError()
        else: raise Exception("Unknown")
    except NotFoundError: return "Not Found"
    except AuthError: return "Unauthorized"
    except ValidationError: return "Validation Failed"
    except Exception: return "Unknown Error"

# FAST: Dict-based dispatch
ERROR_MAP = {
    404: "Not Found",
    401: "Unauthorized",
    422: "Validation Failed",
}

def handle_dict(code):
    return ERROR_MAP.get(code, "Unknown Error")

# FAST: match/case dispatch (Python 3.10+)
def handle_match(code):
    match code:
        case 404: return "Not Found"
        case 401: return "Unauthorized"
        case 422: return "Validation Failed"
        case _: return "Unknown Error"

# FAST: if/elif chain (no exception)
def handle_ifelif(code):
    if code == 404: return "Not Found"
    elif code == 401: return "Unauthorized"
    elif code == 422: return "Validation Failed"
    else: return "Unknown Error"

codes = [404, 401, 422, 500] * 2500

exc_time = timeit.timeit(lambda: [handle_exception(c) for c in codes], number=100)
dict_time = timeit.timeit(lambda: [handle_dict(c) for c in codes], number=100)
ifelif_time = timeit.timeit(lambda: [handle_ifelif(c) for c in codes], number=100)

print(f"Exception dispatch: {exc_time:.4f}s")
print(f"Dict lookup:        {dict_time:.4f}s")
print(f"if/elif:            {ifelif_time:.4f}s")
print(f"Speedup (dict vs exc):    {exc_time / dict_time:.1f}x")
print(f"Speedup (if/elif vs exc): {exc_time / ifelif_time:.1f}x")

if sys.version_info >= (3, 10):
    match_time = timeit.timeit(lambda: [handle_match(c) for c in codes], number=100)
    print(f"match/case:         {match_time:.4f}s")
    print(f"Speedup (match vs exc):   {exc_time / match_time:.1f}x")
```

**Why it's faster:** Each exception raise/catch cycle involves: creating an exception object, creating a traceback object, stack unwinding, and exception type matching. A dictionary lookup is O(1) with a single hash computation. For 10,000 dispatches, this saves creating 10,000 exception and traceback objects.

</details>

---

## Exercise 10: Zero-Cost try vs if-Check When Exceptions Are Rare

**Difficulty:** Hard

```python
import timeit

# Setup: accessing a list with bounds checking
data = list(range(100))

# SLOW: Always check bounds before access
def sum_with_check(data: list, indices: list[int]) -> int:
    """Sum values at given indices, checking bounds first."""
    total = 0
    for i in indices:
        if 0 <= i < len(data):
            total += data[i]
    return total


# Indices where 99.9% are valid
valid_indices = list(range(100)) * 100  # 10,000 valid indices

slow_time = timeit.timeit(lambda: sum_with_check(data, valid_indices), number=1000)
print(f"Slow (bounds check): {slow_time:.4f}s")
```

<details>
<summary>Hint</summary>

In Python 3.11+, entering a <code>try</code> block has zero cost. When exceptions are extremely rare, <code>try/except</code> is faster than checking a condition on every iteration because it eliminates the branch entirely from the hot path.

</details>

<details>
<summary>Optimized Solution</summary>

```python
import timeit

data = list(range(100))

# SLOW: Always bounds-check
def sum_with_check(data, indices):
    total = 0
    for i in indices:
        if 0 <= i < len(data):
            total += data[i]
    return total

# FAST: EAFP -- try/except with zero-cost try (Python 3.11+)
def sum_with_try(data, indices):
    total = 0
    for i in indices:
        try:
            total += data[i]
        except IndexError:
            pass
    return total

# FASTEST: Single try around the whole loop (when you can abort on error)
def sum_with_outer_try(data, indices):
    total = 0
    try:
        for i in indices:
            total += data[i]
    except IndexError:
        pass  # Stop on first bad index
    return total

# 100% valid indices
valid_indices = list(range(100)) * 100

# 0.1% invalid indices
mostly_valid = list(range(100)) * 100
mostly_valid[5000] = 999  # One bad index

check_time = timeit.timeit(lambda: sum_with_check(data, valid_indices), number=1000)
try_time = timeit.timeit(lambda: sum_with_try(data, valid_indices), number=1000)
outer_time = timeit.timeit(lambda: sum_with_outer_try(data, valid_indices), number=1000)

print("=== 100% valid indices ===")
print(f"Bounds check:     {check_time:.4f}s")
print(f"try/except inner: {try_time:.4f}s")
print(f"try/except outer: {outer_time:.4f}s")
print(f"Speedup (try vs check): {check_time / try_time:.2f}x")
print(f"Speedup (outer vs check): {check_time / outer_time:.2f}x")

# Now test with some invalid indices
check_mixed = timeit.timeit(lambda: sum_with_check(data, mostly_valid), number=1000)
try_mixed = timeit.timeit(lambda: sum_with_try(data, mostly_valid), number=1000)

print("\n=== 0.1% invalid indices ===")
print(f"Bounds check:     {check_mixed:.4f}s")
print(f"try/except inner: {try_mixed:.4f}s")
print(f"Speedup: {check_mixed / try_mixed:.2f}x")
```

**Why it's faster:** Since Python 3.11, the `try` statement uses a "zero-cost" implementation -- entering a `try` block adds zero bytecode instructions. The cost is only paid when an exception actually occurs. The bounds check (`0 <= i < len(data)`) requires two comparisons and a `len()` call on every iteration, which adds up over 10,000 iterations. When exceptions are rare (< 1%), EAFP with `try/except` eliminates this per-iteration overhead.

</details>
