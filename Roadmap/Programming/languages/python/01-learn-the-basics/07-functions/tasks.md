# Python Functions & Builtin Functions — Tasks & Practice

## Table of Contents

1. [Junior Tasks (3-4)](#junior-tasks)
2. [Middle Tasks (2-3)](#middle-tasks)
3. [Senior Tasks (2-3)](#senior-tasks)
4. [Questions (5-10)](#questions)
5. [Mini Projects (1+)](#mini-projects)
6. [Challenge](#challenge)

---

## Junior Tasks

### Task 1: Temperature Converter

Create a set of functions to convert temperatures between Celsius, Fahrenheit, and Kelvin.

**Requirements:**
- `celsius_to_fahrenheit(c)` — returns F
- `fahrenheit_to_celsius(f)` — returns C
- `celsius_to_kelvin(c)` — returns K
- `kelvin_to_celsius(k)` — returns C
- A unified `convert(value, from_unit, to_unit)` function
- Handle invalid units with a clear error message

```python
# Formulas:
# F = C * 9/5 + 32
# C = (F - 32) * 5/9
# K = C + 273.15
# C = K - 273.15
```

<details>
<summary><strong>Solution</strong></summary>

```python
def celsius_to_fahrenheit(c):
    """Convert Celsius to Fahrenheit"""
    return c * 9 / 5 + 32

def fahrenheit_to_celsius(f):
    """Convert Fahrenheit to Celsius"""
    return (f - 32) * 5 / 9

def celsius_to_kelvin(c):
    """Convert Celsius to Kelvin"""
    return c + 273.15

def kelvin_to_celsius(k):
    """Convert Kelvin to Celsius"""
    return k - 273.15

def convert(value, from_unit, to_unit):
    """
    Convert temperature between units.
    Supported units: 'C', 'F', 'K'
    """
    from_unit = from_unit.upper()
    to_unit = to_unit.upper()

    valid_units = {'C', 'F', 'K'}
    if from_unit not in valid_units or to_unit not in valid_units:
        raise ValueError(f"Invalid unit. Supported: {valid_units}")

    if from_unit == to_unit:
        return value

    # Convert to Celsius first (as intermediate)
    if from_unit == 'C':
        celsius = value
    elif from_unit == 'F':
        celsius = fahrenheit_to_celsius(value)
    else:  # K
        celsius = kelvin_to_celsius(value)

    # Convert from Celsius to target
    if to_unit == 'C':
        return celsius
    elif to_unit == 'F':
        return celsius_to_fahrenheit(celsius)
    else:  # K
        return celsius_to_kelvin(celsius)

# Tests
print("=== Individual Functions ===")
print(f"100°C -> {celsius_to_fahrenheit(100)}°F")     # 212.0
print(f"212°F -> {fahrenheit_to_celsius(212)}°C")      # 100.0
print(f"0°C -> {celsius_to_kelvin(0)}K")               # 273.15
print(f"273.15K -> {kelvin_to_celsius(273.15)}°C")     # 0.0

print("\n=== Unified Convert ===")
print(f"100°C -> F: {convert(100, 'C', 'F')}")         # 212.0
print(f"32°F -> K: {convert(32, 'F', 'K')}")           # 273.15
print(f"373.15K -> F: {convert(373.15, 'K', 'F')}")    # 212.0
print(f"0°C -> C: {convert(0, 'C', 'C')}")             # 0

# Error handling
try:
    convert(100, 'C', 'X')
except ValueError as e:
    print(f"\nError: {e}")
```

</details>

---

### Task 2: List Statistics Calculator

Create functions that compute statistics on a list of numbers **without using any external libraries**.

**Requirements:**
- `mean(numbers)` — average
- `median(numbers)` — middle value
- `mode(numbers)` — most frequent value(s)
- `std_dev(numbers)` — standard deviation
- `summary(numbers)` — returns a dict with all stats

<details>
<summary><strong>Solution</strong></summary>

```python
def mean(numbers):
    """Calculate the arithmetic mean"""
    if not numbers:
        raise ValueError("Cannot compute mean of empty list")
    return sum(numbers) / len(numbers)

def median(numbers):
    """Calculate the median"""
    if not numbers:
        raise ValueError("Cannot compute median of empty list")
    sorted_nums = sorted(numbers)
    n = len(sorted_nums)
    mid = n // 2
    if n % 2 == 0:
        return (sorted_nums[mid - 1] + sorted_nums[mid]) / 2
    return sorted_nums[mid]

def mode(numbers):
    """Calculate the mode (most frequent values)"""
    if not numbers:
        raise ValueError("Cannot compute mode of empty list")
    freq = {}
    for num in numbers:
        freq[num] = freq.get(num, 0) + 1
    max_count = max(freq.values())
    modes = [num for num, count in freq.items() if count == max_count]
    return modes if len(modes) > 1 else modes[0]

def std_dev(numbers):
    """Calculate the population standard deviation"""
    if not numbers:
        raise ValueError("Cannot compute std_dev of empty list")
    avg = mean(numbers)
    variance = sum((x - avg) ** 2 for x in numbers) / len(numbers)
    return variance ** 0.5

def summary(numbers):
    """Return a dictionary with all statistics"""
    return {
        "count": len(numbers),
        "min": min(numbers),
        "max": max(numbers),
        "mean": round(mean(numbers), 4),
        "median": median(numbers),
        "mode": mode(numbers),
        "std_dev": round(std_dev(numbers), 4),
        "sum": sum(numbers),
    }

# Tests
data = [4, 8, 6, 5, 3, 7, 8, 9, 2, 8]

print("=== Individual Functions ===")
print(f"Data: {data}")
print(f"Mean:    {mean(data)}")
print(f"Median:  {median(data)}")
print(f"Mode:    {mode(data)}")
print(f"Std Dev: {std_dev(data):.4f}")

print("\n=== Summary ===")
stats = summary(data)
for key, value in stats.items():
    print(f"  {key:10s}: {value}")

# Edge cases
print("\n=== Edge Cases ===")
print(f"Single element: {summary([5])}")
print(f"Two elements: {summary([1, 2])}")
print(f"All same: mode={mode([7, 7, 7, 7])}")
print(f"Multi-modal: mode={mode([1, 1, 2, 2, 3])}")

try:
    mean([])
except ValueError as e:
    print(f"Empty list: {e}")
```

</details>

---

### Task 3: String Toolkit

Build a collection of string utility functions using **only builtin functions and methods** (no imports).

**Requirements:**
- `is_palindrome(s)` — check if string is a palindrome (ignore case/spaces)
- `count_vowels(s)` — count vowels
- `title_case(s)` — convert to title case manually (don't use `.title()`)
- `truncate(s, max_len, suffix="...")` — truncate with suffix
- `word_frequency(s)` — return dict of word counts

<details>
<summary><strong>Solution</strong></summary>

```python
def is_palindrome(s):
    """Check if string is a palindrome (ignoring case and spaces)"""
    cleaned = ''.join(c.lower() for c in s if c.isalnum())
    return cleaned == cleaned[::-1]

def count_vowels(s):
    """Count vowels in a string"""
    vowels = set('aeiouAEIOU')
    return sum(1 for c in s if c in vowels)

def title_case(s):
    """Convert to title case without using .title()"""
    words = s.split()
    result = []
    for word in words:
        if word:
            result.append(word[0].upper() + word[1:].lower())
    return ' '.join(result)

def truncate(s, max_len, suffix="..."):
    """Truncate string to max_len including suffix"""
    if len(s) <= max_len:
        return s
    return s[:max_len - len(suffix)] + suffix

def word_frequency(s):
    """Count word frequencies (case-insensitive)"""
    words = s.lower().split()
    # Remove punctuation from each word
    cleaned_words = []
    for word in words:
        cleaned = ''.join(c for c in word if c.isalnum())
        if cleaned:
            cleaned_words.append(cleaned)

    freq = {}
    for word in cleaned_words:
        freq[word] = freq.get(word, 0) + 1
    return dict(sorted(freq.items(), key=lambda x: -x[1]))

# Tests
print("=== is_palindrome ===")
for s in ["racecar", "A man a plan a canal Panama", "hello", "Was it a car or a cat I saw"]:
    print(f"  '{s}' -> {is_palindrome(s)}")

print("\n=== count_vowels ===")
for s in ["Hello World", "rhythm", "aeiou"]:
    print(f"  '{s}' -> {count_vowels(s)}")

print("\n=== title_case ===")
for s in ["hello world", "the QUICK brown FOX", "python programming"]:
    print(f"  '{s}' -> '{title_case(s)}'")

print("\n=== truncate ===")
long_text = "This is a very long string that needs to be truncated"
for length in [20, 30, 100]:
    print(f"  max={length}: '{truncate(long_text, length)}'")
print(f"  custom suffix: '{truncate(long_text, 25, suffix=' [...]')}'")

print("\n=== word_frequency ===")
text = "the cat sat on the mat the cat ate the rat"
freq = word_frequency(text)
for word, count in freq.items():
    print(f"  {word}: {count}")
```

</details>

---

### Task 4: Builtin Functions Mastery

Use Python builtin functions to solve each task in **one line**.

```python
# Complete each function using ONLY builtin functions (no imports)
# Each solution should be a single expression

# 1. Flatten a list of lists
nested = [[1, 2], [3, 4], [5, 6]]
# Expected: [1, 2, 3, 4, 5, 6]

# 2. Find the longest string in a list
words = ["python", "java", "javascript", "go", "rust"]
# Expected: "javascript"

# 3. Check if all numbers are positive
numbers = [1, 5, 3, 8, 2]
# Expected: True

# 4. Zip names and scores, filter passing (>=60), return names only
names = ["Alice", "Bob", "Charlie", "Diana"]
scores = [85, 42, 91, 58]
# Expected: ["Alice", "Charlie"]

# 5. Create a dict from two lists
keys = ["a", "b", "c"]
values = [1, 2, 3]
# Expected: {"a": 1, "b": 2, "c": 3}

# 6. Get unique elements preserving order
items = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5]
# Expected: [3, 1, 4, 5, 9, 2, 6]

# 7. Transpose a matrix (list of lists)
matrix = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
# Expected: [[1, 4, 7], [2, 5, 8], [3, 6, 9]]

# 8. Find second largest number
nums = [10, 5, 8, 20, 15]
# Expected: 15
```

<details>
<summary><strong>Solution</strong></summary>

```python
# 1. Flatten a list of lists
nested = [[1, 2], [3, 4], [5, 6]]
flat = [x for sublist in nested for x in sublist]
# or: list(sum(nested, []))  — but less efficient
print(f"1. Flatten: {flat}")

# 2. Find the longest string
words = ["python", "java", "javascript", "go", "rust"]
longest = max(words, key=len)
print(f"2. Longest: {longest}")

# 3. Check if all numbers are positive
numbers = [1, 5, 3, 8, 2]
all_positive = all(n > 0 for n in numbers)
print(f"3. All positive: {all_positive}")

# 4. Filter passing students
names = ["Alice", "Bob", "Charlie", "Diana"]
scores = [85, 42, 91, 58]
passing = [name for name, score in zip(names, scores) if score >= 60]
print(f"4. Passing: {passing}")

# 5. Create dict from two lists
keys = ["a", "b", "c"]
values = [1, 2, 3]
d = dict(zip(keys, values))
print(f"5. Dict: {d}")

# 6. Unique elements preserving order
items = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5]
unique = list(dict.fromkeys(items))
print(f"6. Unique: {unique}")

# 7. Transpose a matrix
matrix = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
transposed = list(map(list, zip(*matrix)))
print(f"7. Transposed: {transposed}")

# 8. Second largest
nums = [10, 5, 8, 20, 15]
second = sorted(set(nums))[-2]
print(f"8. Second largest: {second}")
```

</details>

---

## Middle Tasks

### Task 1: Decorator Collection

Implement the following decorators from scratch:

1. `@timer` — logs execution time
2. `@retry(max_attempts, delay)` — retries on exception
3. `@validate_types(**type_map)` — validates argument types
4. `@memoize` — caches results (handle unhashable args gracefully)
5. `@rate_limit(calls, period)` — limits function calls per time period

<details>
<summary><strong>Solution</strong></summary>

```python
import functools
import time
import json

# 1. Timer decorator
def timer(func):
    """Log execution time of a function"""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        result = func(*args, **kwargs)
        elapsed = time.perf_counter() - start
        print(f"[TIMER] {func.__name__} took {elapsed:.6f}s")
        return result
    return wrapper

# 2. Retry decorator with arguments
def retry(max_attempts=3, delay=1.0, exceptions=(Exception,)):
    """Retry a function on failure"""
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_error = None
            for attempt in range(1, max_attempts + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_error = e
                    if attempt < max_attempts:
                        print(f"[RETRY] {func.__name__} attempt {attempt}/{max_attempts} "
                              f"failed: {e}. Retrying in {delay}s...")
                        time.sleep(delay)
                    else:
                        print(f"[RETRY] {func.__name__} failed after {max_attempts} attempts")
            raise last_error
        return wrapper
    return decorator

# 3. Type validation decorator
def validate_types(**type_map):
    """Validate argument types at runtime"""
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            import inspect
            sig = inspect.signature(func)
            bound = sig.bind(*args, **kwargs)
            bound.apply_defaults()

            for param_name, expected_type in type_map.items():
                if param_name in bound.arguments:
                    value = bound.arguments[param_name]
                    if not isinstance(value, expected_type):
                        raise TypeError(
                            f"Argument '{param_name}' expected {expected_type.__name__}, "
                            f"got {type(value).__name__}: {value!r}"
                        )
            return func(*args, **kwargs)
        return wrapper
    return decorator

# 4. Memoize decorator (handles unhashable args)
def memoize(func):
    """Cache function results, handles unhashable args gracefully"""
    cache = {}

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        # Try to create a hashable key
        try:
            key = (args, tuple(sorted(kwargs.items())))
            hash(key)  # Test if hashable
        except TypeError:
            # Unhashable args — fall back to JSON key or skip cache
            try:
                key = json.dumps((args, kwargs), sort_keys=True, default=str)
            except (TypeError, ValueError):
                # Cannot cache — just call the function
                return func(*args, **kwargs)

        if key not in cache:
            cache[key] = func(*args, **kwargs)
        return cache[key]

    wrapper.cache = cache
    wrapper.cache_clear = lambda: cache.clear()
    return wrapper

# 5. Rate limit decorator
def rate_limit(calls=5, period=60.0):
    """Limit function to N calls per time period (seconds)"""
    def decorator(func):
        call_times = []

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            now = time.time()
            # Remove old entries
            while call_times and call_times[0] < now - period:
                call_times.pop(0)

            if len(call_times) >= calls:
                wait_time = call_times[0] + period - now
                raise RuntimeError(
                    f"Rate limit exceeded for {func.__name__}. "
                    f"Max {calls} calls per {period}s. "
                    f"Try again in {wait_time:.1f}s"
                )

            call_times.append(now)
            return func(*args, **kwargs)

        wrapper.reset = lambda: call_times.clear()
        return wrapper
    return decorator


# ===== TESTS =====

# Test @timer
@timer
def slow_function():
    time.sleep(0.05)
    return "done"

print("=== @timer ===")
slow_function()

# Test @retry
print("\n=== @retry ===")
call_count = 0

@retry(max_attempts=3, delay=0.1, exceptions=(ValueError,))
def flaky_function():
    global call_count
    call_count += 1
    if call_count < 3:
        raise ValueError("Not ready yet!")
    return "success!"

call_count = 0
print(flaky_function())

# Test @validate_types
print("\n=== @validate_types ===")

@validate_types(name=str, age=int)
def create_user(name, age):
    return {"name": name, "age": age}

print(create_user("Alice", 30))
try:
    create_user("Bob", "thirty")
except TypeError as e:
    print(f"Type error: {e}")

# Test @memoize
print("\n=== @memoize ===")

@memoize
def expensive_calculation(n):
    print(f"  Computing for n={n}...")
    time.sleep(0.01)
    return n ** 2

print(expensive_calculation(5))   # Computes
print(expensive_calculation(5))   # Cached
print(expensive_calculation(10))  # Computes
print(f"Cache size: {len(expensive_calculation.cache)}")

# Test with unhashable args
@memoize
def process_list(data):
    print(f"  Processing list...")
    return sum(data)

print(process_list([1, 2, 3]))  # Lists are unhashable, but our memoize handles it
print(process_list([1, 2, 3]))  # Cached via JSON key

# Test @rate_limit
print("\n=== @rate_limit ===")

@rate_limit(calls=3, period=1.0)
def api_call(endpoint):
    return f"Response from {endpoint}"

for i in range(3):
    print(api_call(f"/api/{i}"))

try:
    api_call("/api/extra")  # Should fail
except RuntimeError as e:
    print(f"Rate limited: {e}")
```

</details>

---

### Task 2: Functional Pipeline Builder

Build a `Pipeline` class that chains functions together, supports branching, error handling, and lazy evaluation.

**Requirements:**
- `Pipeline.pipe(func)` — add a transformation step
- `Pipeline.filter(func)` — filter items
- `Pipeline.branch(condition, if_true, if_false)` — conditional paths
- `Pipeline.catch(handler)` — error handling
- `Pipeline.execute(data)` — run the pipeline
- Support both single values and iterables

<details>
<summary><strong>Solution</strong></summary>

```python
from typing import Callable, Any, Iterable, Optional

class PipelineError(Exception):
    """Custom exception for pipeline failures"""
    def __init__(self, stage, original_error, value):
        self.stage = stage
        self.original_error = original_error
        self.value = value
        super().__init__(f"Pipeline failed at stage '{stage}': {original_error}")

class Pipeline:
    """A composable, lazy function pipeline"""

    def __init__(self):
        self._steps = []

    def pipe(self, func: Callable, name: str = None) -> 'Pipeline':
        """Add a transformation step"""
        self._steps.append(('pipe', func, name or func.__name__))
        return self

    def filter(self, predicate: Callable, name: str = None) -> 'Pipeline':
        """Add a filter step (for iterables)"""
        self._steps.append(('filter', predicate, name or predicate.__name__))
        return self

    def branch(self, condition: Callable,
               if_true: Callable, if_false: Callable,
               name: str = "branch") -> 'Pipeline':
        """Conditional transformation"""
        self._steps.append(('branch', (condition, if_true, if_false), name))
        return self

    def catch(self, handler: Callable, name: str = "error_handler") -> 'Pipeline':
        """Add error handling for the previous step"""
        self._steps.append(('catch', handler, name))
        return self

    def tap(self, func: Callable, name: str = "tap") -> 'Pipeline':
        """Execute a side effect without modifying the value"""
        self._steps.append(('tap', func, name))
        return self

    def execute(self, data: Any) -> Any:
        """Execute the pipeline on data"""
        result = data
        error_handler = None

        for step_type, func, name in self._steps:
            try:
                if step_type == 'pipe':
                    if isinstance(result, (list, tuple)):
                        result = type(result)(func(item) for item in result)
                    else:
                        result = func(result)

                elif step_type == 'filter':
                    if isinstance(result, (list, tuple)):
                        result = type(result)(item for item in result if func(item))
                    else:
                        if not func(result):
                            return None  # Filtered out

                elif step_type == 'branch':
                    condition, if_true, if_false = func
                    if isinstance(result, (list, tuple)):
                        result = type(result)(
                            if_true(item) if condition(item) else if_false(item)
                            for item in result
                        )
                    else:
                        if condition(result):
                            result = if_true(result)
                        else:
                            result = if_false(result)

                elif step_type == 'tap':
                    func(result)  # Side effect only

                elif step_type == 'catch':
                    error_handler = func
                    continue

            except Exception as e:
                if error_handler:
                    result = error_handler(e, result)
                    error_handler = None
                else:
                    raise PipelineError(name, e, result)

        return result

    def execute_each(self, data: Iterable) -> list:
        """Execute the pipeline on each item individually"""
        return [self.execute(item) for item in data]

    def __repr__(self):
        steps = " -> ".join(name for _, _, name in self._steps)
        return f"Pipeline({steps})"


# ===== TESTS =====

# Basic pipeline
print("=== Basic Pipeline ===")
result = (
    Pipeline()
    .pipe(lambda x: x.strip())
    .pipe(lambda x: x.lower())
    .pipe(lambda x: x.replace(" ", "_"))
    .execute("  Hello World  ")
)
print(f"Result: {result}")  # hello_world

# Pipeline with list
print("\n=== List Pipeline ===")
numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
result = (
    Pipeline()
    .pipe(lambda x: x * 2)
    .filter(lambda x: x > 5)
    .pipe(lambda x: x + 100)
    .execute(numbers)
)
print(f"Result: {result}")  # [106, 108, 110, 112, 114, 116, 118, 120]

# Pipeline with branching
print("\n=== Branching Pipeline ===")
data = [1, -2, 3, -4, 5, -6]
result = (
    Pipeline()
    .branch(
        condition=lambda x: x > 0,
        if_true=lambda x: x ** 2,
        if_false=lambda x: abs(x)
    )
    .pipe(lambda x: f"val={x}")
    .execute(data)
)
print(f"Result: {result}")

# Pipeline with error handling
print("\n=== Error Handling Pipeline ===")
result = (
    Pipeline()
    .pipe(lambda x: int(x), name="parse_int")
    .catch(lambda e, val: 0)  # Default to 0 on parse error
    .pipe(lambda x: x * 10)
    .execute("not_a_number")
)
print(f"Result: {result}")  # 0 (error caught, defaulted)

# Pipeline with tap (debugging)
print("\n=== Tap Pipeline ===")
result = (
    Pipeline()
    .pipe(lambda x: x ** 2)
    .tap(lambda x: print(f"  [DEBUG] After square: {x}"))
    .pipe(lambda x: x + 10)
    .tap(lambda x: print(f"  [DEBUG] After add 10: {x}"))
    .execute(5)
)
print(f"Result: {result}")

# Pipeline representation
p = (
    Pipeline()
    .pipe(str.strip, "strip")
    .pipe(str.lower, "lower")
    .filter(lambda x: len(x) > 0, "non_empty")
)
print(f"\n{repr(p)}")
```

</details>

---

### Task 3: Builtin-Powered Data Processor

Process a dataset using **only builtin functions** (no imports except for test data generation). Solve each requirement using builtins like `map`, `filter`, `zip`, `sorted`, `enumerate`, `any`, `all`, `min`, `max`, `sum`, `reversed`, etc.

<details>
<summary><strong>Solution</strong></summary>

```python
# Sample dataset
students = [
    {"name": "Alice", "grades": [90, 85, 92, 88], "age": 20},
    {"name": "Bob", "grades": [75, 60, 70, 65], "age": 22},
    {"name": "Charlie", "grades": [95, 98, 100, 97], "age": 19},
    {"name": "Diana", "grades": [50, 45, 55, 60], "age": 21},
    {"name": "Eve", "grades": [80, 85, 75, 90], "age": 20},
    {"name": "Frank", "grades": [88, 92, 85, 90], "age": 23},
]

# 1. Calculate average grade for each student using map
averages = list(map(lambda s: {**s, "avg": sum(s["grades"]) / len(s["grades"])}, students))
print("=== 1. Averages ===")
for s in averages:
    print(f"  {s['name']}: {s['avg']:.1f}")

# 2. Filter students with average >= 80
honor_roll = list(filter(lambda s: s["avg"] >= 80, averages))
print(f"\n=== 2. Honor Roll ===")
print(f"  {list(map(lambda s: s['name'], honor_roll))}")

# 3. Sort by average (descending)
ranked = sorted(averages, key=lambda s: s["avg"], reverse=True)
print(f"\n=== 3. Ranked ===")
for rank, s in enumerate(ranked, 1):
    print(f"  #{rank} {s['name']}: {s['avg']:.1f}")

# 4. Check if ALL students passed (avg >= 50)
all_passed = all(map(lambda s: s["avg"] >= 50, averages))
print(f"\n=== 4. All passed: {all_passed} ===")

# 5. Check if ANY student got a perfect score (100) in any subject
any_perfect = any(any(g == 100 for g in s["grades"]) for s in students)
print(f"\n=== 5. Any perfect score: {any_perfect} ===")

# 6. Pair students by rank (1st with last, 2nd with 2nd-to-last, etc.)
names_ranked = list(map(lambda s: s["name"], ranked))
pairs = list(zip(names_ranked, reversed(names_ranked)))
print(f"\n=== 6. Study Pairs ===")
for strong, needs_help in pairs[:len(pairs)//2]:
    print(f"  {strong} tutors {needs_help}")

# 7. Class statistics
all_grades = [g for s in students for g in s["grades"]]
print(f"\n=== 7. Class Statistics ===")
print(f"  Highest grade: {max(all_grades)}")
print(f"  Lowest grade:  {min(all_grades)}")
print(f"  Total grades:  {len(all_grades)}")
print(f"  Class average: {sum(all_grades) / len(all_grades):.1f}")

# 8. Create a grade distribution using builtins
grade_letters = list(map(
    lambda g: 'A' if g >= 90 else 'B' if g >= 80 else 'C' if g >= 70 else 'D' if g >= 60 else 'F',
    all_grades
))
distribution = {letter: grade_letters.count(letter) for letter in sorted(set(grade_letters))}
print(f"\n=== 8. Grade Distribution ===")
for letter, count in distribution.items():
    bar = '#' * count
    print(f"  {letter}: {bar} ({count})")

# 9. Find the student with the most consistent grades (lowest std dev)
def variance(grades):
    avg = sum(grades) / len(grades)
    return sum((g - avg) ** 2 for g in grades) / len(grades)

most_consistent = min(students, key=lambda s: variance(s["grades"]))
print(f"\n=== 9. Most Consistent: {most_consistent['name']} ===")
print(f"  Grades: {most_consistent['grades']}")

# 10. Create a formatted report using only builtins
print(f"\n=== 10. Final Report ===")
header = f"{'Name':<12} {'Avg':>6} {'Min':>4} {'Max':>4} {'Grade':>6}"
print(f"  {header}")
print(f"  {'-' * len(header)}")
for s in ranked:
    avg = s["avg"]
    letter = 'A' if avg >= 90 else 'B' if avg >= 80 else 'C' if avg >= 70 else 'D' if avg >= 60 else 'F'
    print(f"  {s['name']:<12} {avg:>6.1f} {min(s['grades']):>4} {max(s['grades']):>4} {letter:>6}")
```

</details>

---

## Senior Tasks

### Task 1: Dependency Injection Container

Build a lightweight dependency injection container using functions, closures, and decorators.

**Requirements:**
- Register services (singletons and transient)
- Automatic constructor injection based on type hints
- Scoped lifetimes
- Circular dependency detection

<details>
<summary><strong>Solution</strong></summary>

```python
import inspect
import functools
from typing import Any, Callable, Dict, Optional, Type, TypeVar, get_type_hints

T = TypeVar('T')

class CircularDependencyError(Exception):
    pass

class ServiceNotFoundError(Exception):
    pass

class DIContainer:
    """Lightweight Dependency Injection Container"""

    SINGLETON = "singleton"
    TRANSIENT = "transient"
    SCOPED = "scoped"

    def __init__(self, parent: Optional['DIContainer'] = None):
        self._registry: Dict[type, dict] = {}
        self._singletons: Dict[type, Any] = {}
        self._scoped_instances: Dict[type, Any] = {}
        self._resolving: set = set()  # For circular dependency detection
        self._parent = parent

    def register(self, interface: type, implementation: type = None,
                 lifetime: str = TRANSIENT, factory: Callable = None):
        """Register a service"""
        if implementation is None and factory is None:
            implementation = interface

        self._registry[interface] = {
            "implementation": implementation,
            "lifetime": lifetime,
            "factory": factory,
        }
        return self

    def singleton(self, interface: type, implementation: type = None):
        """Shorthand for singleton registration"""
        return self.register(interface, implementation, lifetime=self.SINGLETON)

    def transient(self, interface: type, implementation: type = None):
        """Shorthand for transient registration"""
        return self.register(interface, implementation, lifetime=self.TRANSIENT)

    def resolve(self, interface: type) -> Any:
        """Resolve a service, injecting dependencies automatically"""
        # Check for circular dependencies
        if interface in self._resolving:
            chain = " -> ".join(t.__name__ for t in self._resolving)
            raise CircularDependencyError(
                f"Circular dependency detected: {chain} -> {interface.__name__}"
            )

        # Look up registration
        reg = self._registry.get(interface)
        if reg is None:
            if self._parent:
                return self._parent.resolve(interface)
            raise ServiceNotFoundError(f"No registration for {interface.__name__}")

        lifetime = reg["lifetime"]

        # Check caches
        if lifetime == self.SINGLETON and interface in self._singletons:
            return self._singletons[interface]
        if lifetime == self.SCOPED and interface in self._scoped_instances:
            return self._scoped_instances[interface]

        # Resolve
        self._resolving.add(interface)
        try:
            if reg["factory"]:
                instance = reg["factory"](self)
            else:
                instance = self._create_instance(reg["implementation"])
        finally:
            self._resolving.discard(interface)

        # Cache if needed
        if lifetime == self.SINGLETON:
            self._singletons[interface] = instance
        elif lifetime == self.SCOPED:
            self._scoped_instances[interface] = instance

        return instance

    def _create_instance(self, cls: type) -> Any:
        """Create an instance with automatic constructor injection"""
        try:
            hints = get_type_hints(cls.__init__)
        except Exception:
            hints = {}

        sig = inspect.signature(cls.__init__)
        kwargs = {}

        for name, param in sig.parameters.items():
            if name == 'self':
                continue

            # Get type from hints
            param_type = hints.get(name)
            if param_type and param_type in self._registry:
                kwargs[name] = self.resolve(param_type)
            elif param.default is not inspect.Parameter.empty:
                kwargs[name] = param.default
            else:
                raise ServiceNotFoundError(
                    f"Cannot resolve parameter '{name}' of type "
                    f"'{param_type}' for {cls.__name__}"
                )

        return cls(**kwargs)

    def create_scope(self) -> 'DIContainer':
        """Create a child scope"""
        child = DIContainer(parent=self)
        child._registry = {**self._registry}
        child._singletons = self._singletons  # Shared!
        return child

    # Decorator interface
    def injectable(self, lifetime: str = TRANSIENT):
        """Decorator to auto-register a class"""
        def decorator(cls):
            self.register(cls, cls, lifetime)
            return cls
        return decorator


# ===== USAGE DEMO =====

# Define interfaces (using abstract-like classes)
class Logger:
    def log(self, msg: str): ...

class Database:
    def query(self, sql: str): ...

class UserRepository:
    def find(self, user_id: int): ...

# Implementations
class ConsoleLogger(Logger):
    def __init__(self):
        self.logs = []

    def log(self, msg: str):
        self.logs.append(msg)
        print(f"  [LOG] {msg}")

class PostgresDB(Database):
    def __init__(self, logger: Logger):
        self.logger = logger

    def query(self, sql: str):
        self.logger.log(f"Executing: {sql}")
        return [{"id": 1, "name": "Alice"}]

class UserRepo(UserRepository):
    def __init__(self, db: Database, logger: Logger):
        self.db = db
        self.logger = logger

    def find(self, user_id: int):
        self.logger.log(f"Finding user {user_id}")
        return self.db.query(f"SELECT * FROM users WHERE id = {user_id}")

class UserService:
    def __init__(self, repo: UserRepository, logger: Logger):
        self.repo = repo
        self.logger = logger

    def get_user(self, user_id: int):
        self.logger.log(f"UserService.get_user({user_id})")
        return self.repo.find(user_id)

# Configure container
container = DIContainer()
container.singleton(Logger, ConsoleLogger)
container.singleton(Database, PostgresDB)
container.transient(UserRepository, UserRepo)
container.transient(UserService)

# Resolve with automatic injection
print("=== Resolving UserService ===")
service = container.resolve(UserService)
result = service.get_user(1)
print(f"Result: {result}")

# Singleton verification
print("\n=== Singleton Test ===")
logger1 = container.resolve(Logger)
logger2 = container.resolve(Logger)
print(f"Same logger instance: {logger1 is logger2}")  # True

# Scoped lifetime
print("\n=== Scoped Lifetime ===")
container.register(UserRepository, UserRepo, lifetime=DIContainer.SCOPED)

scope1 = container.create_scope()
scope2 = container.create_scope()

repo_1a = scope1.resolve(UserRepository)
repo_1b = scope1.resolve(UserRepository)
repo_2 = scope2.resolve(UserRepository)

print(f"Same scope, same instance: {repo_1a is repo_1b}")    # True
print(f"Different scope, different: {repo_1a is not repo_2}")  # True

# Circular dependency detection
print("\n=== Circular Dependency Detection ===")

class ServiceA:
    def __init__(self, b: 'ServiceB'): self.b = b

class ServiceB:
    def __init__(self, a: ServiceA): self.a = a

circular_container = DIContainer()
circular_container.transient(ServiceA)
circular_container.transient(ServiceB)

try:
    circular_container.resolve(ServiceA)
except CircularDependencyError as e:
    print(f"Caught: {e}")
```

</details>

---

### Task 2: Function-Based State Machine

Build a state machine where each state is a function, transitions are defined declaratively, and the machine supports guards, actions, and history.

<details>
<summary><strong>Solution</strong></summary>

```python
import functools
from typing import Callable, Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from enum import Enum, auto

@dataclass
class Transition:
    event: str
    source: str
    target: str
    guard: Optional[Callable] = None
    action: Optional[Callable] = None

@dataclass
class StateConfig:
    on_enter: Optional[Callable] = None
    on_exit: Optional[Callable] = None

class StateMachine:
    """Function-based state machine with guards, actions, and history"""

    def __init__(self, initial_state: str):
        self._current_state = initial_state
        self._transitions: List[Transition] = []
        self._states: Dict[str, StateConfig] = {}
        self._history: List[Tuple[str, str, str]] = []  # (from, event, to)
        self._context: Dict[str, Any] = {}
        self._listeners: Dict[str, List[Callable]] = {}

    @property
    def state(self) -> str:
        return self._current_state

    @property
    def context(self) -> dict:
        return self._context

    def add_state(self, name: str, on_enter: Callable = None,
                  on_exit: Callable = None) -> 'StateMachine':
        """Register a state with optional enter/exit callbacks"""
        self._states[name] = StateConfig(on_enter=on_enter, on_exit=on_exit)
        return self

    def add_transition(self, event: str, source: str, target: str,
                       guard: Callable = None, action: Callable = None) -> 'StateMachine':
        """Add a transition"""
        self._transitions.append(Transition(event, source, target, guard, action))
        return self

    def on(self, event_name: str, listener: Callable) -> 'StateMachine':
        """Add an event listener"""
        self._listeners.setdefault(event_name, []).append(listener)
        return self

    def send(self, event: str, **payload) -> bool:
        """Send an event to the state machine"""
        matching = [
            t for t in self._transitions
            if t.event == event and t.source == self._current_state
        ]

        if not matching:
            print(f"  No transition for event '{event}' in state '{self._current_state}'")
            return False

        for transition in matching:
            # Check guard
            if transition.guard and not transition.guard(self._context, payload):
                continue

            old_state = self._current_state

            # Exit current state
            if old_state in self._states and self._states[old_state].on_exit:
                self._states[old_state].on_exit(self._context)

            # Execute transition action
            if transition.action:
                transition.action(self._context, payload)

            # Update state
            self._current_state = transition.target
            self._history.append((old_state, event, transition.target))

            # Enter new state
            if transition.target in self._states and self._states[transition.target].on_enter:
                self._states[transition.target].on_enter(self._context)

            # Notify listeners
            for listener in self._listeners.get('transition', []):
                listener(old_state, event, transition.target, self._context)

            return True

        print(f"  All guards failed for event '{event}'")
        return False

    def get_available_events(self) -> List[str]:
        """Get events available in current state"""
        return list(set(
            t.event for t in self._transitions
            if t.source == self._current_state
        ))

    def get_history(self) -> List[Tuple[str, str, str]]:
        """Get transition history"""
        return list(self._history)

    def visualize(self):
        """Print a text visualization of the state machine"""
        print(f"\n  Current: [{self._current_state}]")
        print(f"  Available events: {self.get_available_events()}")
        print(f"  History ({len(self._history)} transitions):")
        for old, event, new in self._history[-5:]:
            print(f"    {old} --({event})--> {new}")


# ===== DEMO: Order Processing State Machine =====

print("=== Order Processing State Machine ===\n")

sm = StateMachine("pending")

# Define states with enter/exit callbacks
sm.add_state("pending",
    on_enter=lambda ctx: print(f"  [ENTER pending] Order created"),
)
sm.add_state("confirmed",
    on_enter=lambda ctx: print(f"  [ENTER confirmed] Order confirmed, total=${ctx.get('total', 0)}"),
    on_exit=lambda ctx: print(f"  [EXIT confirmed] Preparing to process..."),
)
sm.add_state("processing",
    on_enter=lambda ctx: print(f"  [ENTER processing] Starting fulfillment"),
)
sm.add_state("shipped",
    on_enter=lambda ctx: print(f"  [ENTER shipped] Tracking: {ctx.get('tracking', 'N/A')}"),
)
sm.add_state("delivered",
    on_enter=lambda ctx: print(f"  [ENTER delivered] Order complete!"),
)
sm.add_state("cancelled",
    on_enter=lambda ctx: print(f"  [ENTER cancelled] Reason: {ctx.get('cancel_reason', 'N/A')}"),
)

# Define transitions with guards and actions
sm.add_transition("confirm", "pending", "confirmed",
    guard=lambda ctx, p: p.get("total", 0) > 0,
    action=lambda ctx, p: ctx.update({"total": p["total"], "items": p.get("items", [])}),
)

sm.add_transition("cancel", "pending", "cancelled",
    action=lambda ctx, p: ctx.update({"cancel_reason": p.get("reason", "Customer request")}),
)

sm.add_transition("cancel", "confirmed", "cancelled",
    action=lambda ctx, p: ctx.update({"cancel_reason": p.get("reason", "Customer request")}),
)

sm.add_transition("process", "confirmed", "processing",
    guard=lambda ctx, p: ctx.get("total", 0) > 0,
)

sm.add_transition("ship", "processing", "shipped",
    action=lambda ctx, p: ctx.update({"tracking": p.get("tracking", "TRK-000")}),
)

sm.add_transition("deliver", "shipped", "delivered")

# Add a listener
sm.on("transition", lambda old, event, new, ctx:
    print(f"  >> Transition: {old} --({event})--> {new}"))

# Run the state machine
print("--- Creating order ---")
sm.context.update({"order_id": "ORD-001"})

print(f"\nState: {sm.state}")
print(f"Available: {sm.get_available_events()}")

print("\n--- Confirming order ---")
sm.send("confirm", total=99.99, items=["Widget", "Gadget"])

print("\n--- Processing order ---")
sm.send("process")

print("\n--- Shipping order ---")
sm.send("ship", tracking="TRK-12345")

print("\n--- Delivering order ---")
sm.send("deliver")

# Try invalid transition
print("\n--- Try to ship delivered order ---")
sm.send("ship")

# Visualize
sm.visualize()

# Test guard failure
print("\n\n=== Guard Failure Test ===")
sm2 = StateMachine("pending")
sm2.add_transition("confirm", "pending", "confirmed",
    guard=lambda ctx, p: p.get("total", 0) > 0)

sm2.send("confirm", total=0)  # Guard fails
print(f"Still in: {sm2.state}")  # Still pending

sm2.send("confirm", total=50)  # Guard passes
print(f"Now in: {sm2.state}")   # confirmed
```

</details>

---

### Task 3: Async-Compatible Function Composition Library

Build a function composition library that works with both sync and async functions.

<details>
<summary><strong>Solution</strong></summary>

```python
import asyncio
import functools
import inspect
import time
from typing import Callable, Any, TypeVar

T = TypeVar('T')

def is_async(func: Callable) -> bool:
    """Check if a function is async"""
    return inspect.iscoroutinefunction(func)

class Compose:
    """Compose sync and async functions seamlessly"""

    def __init__(self, *funcs: Callable):
        self._funcs = list(funcs)
        self._has_async = any(is_async(f) for f in funcs)

    def then(self, func: Callable) -> 'Compose':
        """Add a function to the composition chain"""
        new = Compose(*self._funcs, func)
        return new

    def __call__(self, *args, **kwargs):
        if self._has_async:
            return self._call_async(*args, **kwargs)
        return self._call_sync(*args, **kwargs)

    def _call_sync(self, *args, **kwargs):
        result = self._funcs[0](*args, **kwargs)
        for func in self._funcs[1:]:
            result = func(result)
        return result

    async def _call_async(self, *args, **kwargs):
        func = self._funcs[0]
        if is_async(func):
            result = await func(*args, **kwargs)
        else:
            result = func(*args, **kwargs)

        for func in self._funcs[1:]:
            if is_async(func):
                result = await func(result)
            else:
                result = func(result)
        return result


def compose(*funcs: Callable) -> Compose:
    """Create a function composition"""
    return Compose(*funcs)


def pipe(value, *funcs: Callable):
    """Pipe a value through a series of functions (sync only)"""
    for func in funcs:
        value = func(value)
    return value


async def pipe_async(value, *funcs: Callable):
    """Pipe a value through sync/async functions"""
    for func in funcs:
        if is_async(func):
            value = await func(value)
        else:
            value = func(value)
    return value


# Higher-order function utilities
def partial_right(func: Callable, *right_args, **right_kwargs) -> Callable:
    """Like functools.partial, but fixes rightmost arguments"""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        merged_kwargs = {**right_kwargs, **kwargs}
        return func(*args, *right_args, **merged_kwargs)
    return wrapper


def flip(func: Callable) -> Callable:
    """Reverse the argument order of a function"""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        return func(*reversed(args), **kwargs)
    return wrapper


def curry(func: Callable) -> Callable:
    """Auto-curry a function"""
    sig = inspect.signature(func)
    n_params = len([
        p for p in sig.parameters.values()
        if p.default is inspect.Parameter.empty
        and p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)
    ])

    @functools.wraps(func)
    def curried(*args):
        if len(args) >= n_params:
            return func(*args)
        return lambda *more_args: curried(*args, *more_args)

    return curried


# ===== TESTS =====

# Sync composition
print("=== Sync Composition ===")
double = lambda x: x * 2
add_one = lambda x: x + 1
square = lambda x: x ** 2
to_string = lambda x: f"Result: {x}"

transform = compose(double, add_one, square, to_string)
print(transform(3))  # double(3)=6, add_one(6)=7, square(7)=49, to_string(49)="Result: 49"

# Method chaining with .then()
result = (
    compose(str.strip)
    .then(str.lower)
    .then(lambda s: s.replace(" ", "-"))
    .then(lambda s: f"/{s}")
)("  Hello World  ")
print(result)  # /hello-world

# Pipe
print(f"\nPipe: {pipe(5, double, add_one, square)}")  # 121

# Curry
print("\n=== Curry ===")

@curry
def add(a, b, c):
    return a + b + c

print(add(1)(2)(3))      # 6
print(add(1, 2)(3))      # 6
print(add(1)(2, 3))      # 6
print(add(1, 2, 3))      # 6

add_10 = add(10)
add_10_20 = add_10(20)
print(add_10_20(30))     # 60

# Flip
print("\n=== Flip ===")
def divide(a, b):
    return a / b

flipped_divide = flip(divide)
print(f"divide(10, 2) = {divide(10, 2)}")
print(f"flipped(10, 2) = {flipped_divide(10, 2)}")

# Async composition
print("\n=== Async Composition ===")

async def fetch_data(url):
    """Simulate async data fetch"""
    await asyncio.sleep(0.01)
    return {"url": url, "data": [1, 2, 3, 4, 5]}

async def process_async(data):
    """Simulate async processing"""
    await asyncio.sleep(0.01)
    data["data"] = [x * 2 for x in data["data"]]
    return data

def format_result(data):
    """Sync formatting"""
    return f"Fetched {data['url']}: {data['data']}"

async def main():
    # Mix sync and async in composition
    pipeline = compose(fetch_data, process_async, format_result)
    result = await pipeline("https://api.example.com")
    print(result)

    # Async pipe
    result2 = await pipe_async(
        "https://api.example.com",
        fetch_data,
        process_async,
        format_result,
    )
    print(result2)

asyncio.run(main())

# Practical example: data validation pipeline
print("\n=== Validation Pipeline ===")

def strip_and_lower(s):
    return s.strip().lower()

def validate_length(s):
    if len(s) < 3:
        raise ValueError(f"Too short: '{s}'")
    if len(s) > 50:
        raise ValueError(f"Too long: '{s}'")
    return s

def validate_chars(s):
    if not all(c.isalnum() or c in '-_' for c in s):
        raise ValueError(f"Invalid characters in '{s}'")
    return s

def normalize(s):
    return s.replace(' ', '-')

validate_username = compose(strip_and_lower, normalize, validate_length, validate_chars)

for test in ["  Alice  ", "AB", "valid-user_name", "invalid user!@#"]:
    try:
        result = validate_username(test)
        print(f"  '{test}' -> '{result}' (valid)")
    except ValueError as e:
        print(f"  '{test}' -> ERROR: {e}")
```

</details>

---

## Questions

### Q1: What is the output?

```python
def make_funcs():
    funcs = []
    for i in range(4):
        def f():
            return i
        funcs.append(f)
    return funcs

for fn in make_funcs():
    print(fn(), end=" ")
```

<details>
<summary><strong>Answer</strong></summary>

```
3 3 3 3
```

All closures share the same variable `i`, which has value `3` after the loop ends. This is the **late binding closure** problem. Fix with `lambda i=i: i` or `functools.partial`.

</details>

---

### Q2: What is the output?

```python
def f(a, b=[], c={}):
    b.append(a)
    c[a] = len(b)
    return b, c

print(f(1))
print(f(2))
print(f(3))
```

<details>
<summary><strong>Answer</strong></summary>

```
([1], {1: 1})
([1, 2], {1: 1, 2: 2})
([1, 2, 3], {1: 1, 2: 2, 3: 3})
```

Both `b` and `c` are mutable defaults — they are shared across all calls. The list grows and the dict accumulates entries.

</details>

---

### Q3: What is the output?

```python
x = 10

def outer():
    x = 20
    def inner():
        print(x)
    inner()
    x = 30
    inner()

outer()
print(x)
```

<details>
<summary><strong>Answer</strong></summary>

```
20
30
10
```

`inner()` accesses `x` from the enclosing scope via a closure. The first call sees `x=20`, then `x` is reassigned to `30`, and the second call sees `x=30`. The global `x=10` is unaffected.

</details>

---

### Q4: What is the output?

```python
def decorator_a(func):
    print("A applied")
    def wrapper(*args):
        print("A before")
        result = func(*args)
        print("A after")
        return result
    return wrapper

def decorator_b(func):
    print("B applied")
    def wrapper(*args):
        print("B before")
        result = func(*args)
        print("B after")
        return result
    return wrapper

@decorator_a
@decorator_b
def greet(name):
    print(f"Hello, {name}")

print("---")
greet("World")
```

<details>
<summary><strong>Answer</strong></summary>

```
B applied
A applied
---
A before
B before
Hello, World
B after
A after
```

Decorators are applied bottom-up (`@decorator_b` first, then `@decorator_a` wraps the result). But when called, the outer wrapper (`A`) executes first, then calls `B`'s wrapper, which calls the original function.

</details>

---

### Q5: What is the output?

```python
funcs = [lambda x: x + i for i in range(3)]
print([f(10) for f in funcs])
```

<details>
<summary><strong>Answer</strong></summary>

```
[12, 12, 12]
```

Same late-binding issue. All lambdas share the loop variable `i`, which is `2` after the loop. Fix: `lambda x, i=i: x + i`.

</details>

---

### Q6: What happens?

```python
def f(x):
    if x > 0:
        return x

result = f(-5)
print(result)
print(type(result))
```

<details>
<summary><strong>Answer</strong></summary>

```
None
<class 'NoneType'>
```

When a function reaches the end without hitting a `return` statement, it implicitly returns `None`.

</details>

---

### Q7: True or False — `len` is faster than a custom Python function that does the same thing?

<details>
<summary><strong>Answer</strong></summary>

**True.** `len()` is implemented in C and dispatches to the object's `__len__` slot directly. A Python function has additional overhead from frame creation, bytecode execution, etc.

```python
import timeit

data = list(range(1000))

def my_len(seq):
    count = 0
    for _ in seq:
        count += 1
    return count

t_builtin = timeit.timeit(lambda: len(data), number=100_000)
t_custom = timeit.timeit(lambda: my_len(data), number=100_000)
print(f"len():   {t_builtin:.4f}s")
print(f"my_len(): {t_custom:.4f}s")
print(f"Builtin is {t_custom/t_builtin:.0f}x faster")
```

</details>

---

### Q8: What is the output?

```python
def outer():
    funcs = []
    for i in range(3):
        def f(x, n=i):
            return x + n
        funcs.append(f)
    return funcs

a, b, c = outer()
print(a(10), b(10), c(10))
```

<details>
<summary><strong>Answer</strong></summary>

```
10 11 12
```

By using `n=i` as a default argument, the current value of `i` is captured at function definition time. This is the standard fix for the late-binding closure problem.

</details>

---

### Q9: Can you use `*args` and a positional-only parameter together?

<details>
<summary><strong>Answer</strong></summary>

Yes! Positional-only parameters (using `/`) can be combined with `*args`.

```python
def func(a, b, /, *args):
    print(f"a={a}, b={b}, args={args}")

func(1, 2, 3, 4, 5)  # a=1, b=2, args=(3, 4, 5)

# But you can't pass a, b as keyword arguments:
try:
    func(a=1, b=2)
except TypeError as e:
    print(f"Error: {e}")
```

</details>

---

### Q10: What does `globals()['my_func']()` do?

<details>
<summary><strong>Answer</strong></summary>

It looks up `my_func` in the global namespace dictionary and calls it. Functions are stored as regular objects in the global namespace.

```python
def my_func():
    return "Hello from globals!"

# These are equivalent:
print(my_func())
print(globals()['my_func']())

# You can even create functions dynamically this way:
exec("def dynamic_func(): return 42")
print(globals()['dynamic_func']())  # 42

# But this is generally considered bad practice — prefer explicit references
```

</details>

---

## Mini Projects

### Mini Project: CLI Calculator with Plugin System

Build a command-line calculator that supports plugins (custom operations).

**Requirements:**
- Basic operations: `+`, `-`, `*`, `/`, `**`, `%`
- Plugin system: users can register custom operations as functions
- History tracking
- Variable storage (`let x = 5`)
- Chain operations (`5 | double | add 3`)
- Undo last operation

<details>
<summary><strong>Solution</strong></summary>

```python
import operator
import math
from typing import Callable, Dict, List, Optional, Tuple

class Calculator:
    """Extensible CLI calculator with plugin support"""

    def __init__(self):
        # Built-in binary operations
        self._binary_ops: Dict[str, Callable] = {
            '+': operator.add,
            '-': operator.sub,
            '*': operator.mul,
            '/': operator.truediv,
            '//': operator.floordiv,
            '**': operator.pow,
            '%': operator.mod,
        }

        # Built-in unary operations (plugins can add more)
        self._unary_ops: Dict[str, Callable] = {
            'neg': operator.neg,
            'abs': abs,
            'sqrt': math.sqrt,
            'sin': math.sin,
            'cos': math.cos,
            'log': math.log,
            'round': round,
            'int': int,
            'float': float,
        }

        # Parameterized operations (take one extra argument)
        self._param_ops: Dict[str, Callable] = {
            'add': operator.add,
            'sub': operator.sub,
            'mul': operator.mul,
            'div': operator.truediv,
            'pow': operator.pow,
            'mod': operator.mod,
        }

        self._variables: Dict[str, float] = {
            'pi': math.pi,
            'e': math.e,
            'tau': math.tau,
        }

        self._history: List[Tuple[str, float]] = []
        self._last_result: Optional[float] = None

    def register_unary(self, name: str, func: Callable):
        """Register a custom unary operation (plugin)"""
        self._unary_ops[name] = func
        print(f"  Registered unary operation: {name}")

    def register_param(self, name: str, func: Callable):
        """Register a custom parameterized operation"""
        self._param_ops[name] = func
        print(f"  Registered parameterized operation: {name}")

    def evaluate(self, expression: str) -> Optional[float]:
        """Evaluate an expression"""
        expression = expression.strip()

        if not expression:
            return self._last_result

        # Handle variable assignment: let x = 5
        if expression.startswith('let '):
            return self._handle_assignment(expression)

        # Handle pipe chain: 5 | double | add 3
        if '|' in expression:
            return self._handle_pipe(expression)

        # Handle binary expression: 5 + 3
        return self._handle_expression(expression)

    def _handle_assignment(self, expr: str) -> float:
        """Handle: let x = <expression>"""
        parts = expr[4:].split('=', 1)
        if len(parts) != 2:
            raise ValueError("Assignment syntax: let <name> = <expression>")

        name = parts[0].strip()
        value = self.evaluate(parts[1].strip())
        self._variables[name] = value
        print(f"  {name} = {value}")
        return value

    def _handle_pipe(self, expr: str) -> float:
        """Handle: <value> | <op1> | <op2> <arg> | ..."""
        parts = [p.strip() for p in expr.split('|')]

        # First part is the initial value
        result = self._resolve_value(parts[0])

        # Apply each operation
        for part in parts[1:]:
            tokens = part.split()
            op_name = tokens[0]

            if op_name in self._unary_ops:
                result = self._unary_ops[op_name](result)
            elif op_name in self._param_ops and len(tokens) == 2:
                arg = self._resolve_value(tokens[1])
                result = self._param_ops[op_name](result, arg)
            else:
                raise ValueError(f"Unknown operation: {op_name}")

        self._record(expr, result)
        return result

    def _handle_expression(self, expr: str) -> float:
        """Handle: <value> <op> <value> or <unary_op> <value>"""
        tokens = expr.split()

        if len(tokens) == 1:
            result = self._resolve_value(tokens[0])
            self._record(expr, result)
            return result

        if len(tokens) == 2:
            # Unary operation
            op_name, val_str = tokens
            if op_name in self._unary_ops:
                val = self._resolve_value(val_str)
                result = self._unary_ops[op_name](val)
                self._record(expr, result)
                return result

        if len(tokens) == 3:
            # Binary operation
            left_str, op, right_str = tokens
            if op in self._binary_ops:
                left = self._resolve_value(left_str)
                right = self._resolve_value(right_str)
                result = self._binary_ops[op](left, right)
                self._record(expr, result)
                return result

        raise ValueError(f"Cannot parse: {expr}")

    def _resolve_value(self, token: str) -> float:
        """Resolve a token to a numeric value"""
        if token == '_' and self._last_result is not None:
            return self._last_result
        if token in self._variables:
            return self._variables[token]
        try:
            return float(token)
        except ValueError:
            raise ValueError(f"Unknown value: {token}")

    def _record(self, expr: str, result: float):
        """Record to history"""
        self._history.append((expr, result))
        self._last_result = result

    def undo(self) -> Optional[float]:
        """Undo last operation"""
        if not self._history:
            print("  Nothing to undo")
            return None

        removed = self._history.pop()
        self._last_result = self._history[-1][1] if self._history else None
        print(f"  Undid: {removed[0]} = {removed[1]}")
        return self._last_result

    def show_history(self):
        """Show calculation history"""
        print("  === History ===")
        for i, (expr, result) in enumerate(self._history, 1):
            print(f"  {i:3d}. {expr} = {result}")

    def show_variables(self):
        """Show stored variables"""
        print("  === Variables ===")
        for name, value in sorted(self._variables.items()):
            print(f"  {name} = {value}")


# ===== DEMO =====

calc = Calculator()

# Register custom plugins
print("=== Registering Plugins ===")
calc.register_unary("double", lambda x: x * 2)
calc.register_unary("triple", lambda x: x * 3)
calc.register_unary("square", lambda x: x ** 2)
calc.register_unary("celsius_to_f", lambda c: c * 9/5 + 32)
calc.register_param("clamp", lambda x, max_val: min(x, max_val))

# Basic operations
print("\n=== Basic Operations ===")
for expr in ["5 + 3", "10 * 4", "2 ** 10", "100 / 3", "17 % 5"]:
    result = calc.evaluate(expr)
    print(f"  {expr} = {result}")

# Unary operations
print("\n=== Unary Operations ===")
for expr in ["sqrt 144", "abs -42", "sin 0", "double 21"]:
    result = calc.evaluate(expr)
    print(f"  {expr} = {result}")

# Pipe chains
print("\n=== Pipe Chains ===")
for expr in [
    "5 | double | add 10",
    "100 | sqrt | round",
    "3 | square | double | add 1",
    "37 | celsius_to_f",
]:
    result = calc.evaluate(expr)
    print(f"  {expr} = {result}")

# Variables
print("\n=== Variables ===")
calc.evaluate("let radius = 5")
calc.evaluate("let area = 78.54")
calc.show_variables()

# Using _ for last result
print("\n=== Using Last Result (_) ===")
calc.evaluate("10 + 20")
result = calc.evaluate("_ * 2")
print(f"  (10+20)*2 = {result}")

# Undo
print("\n=== Undo ===")
calc.undo()

# History
calc.show_history()
```

</details>

---

## Challenge

### Challenge: Build a Python Function Profiler & Analyzer

Build a comprehensive function analysis tool that:

1. **Static Analysis:** Inspects function signature, defaults, annotations, closure variables, and bytecode complexity
2. **Dynamic Profiling:** Times execution, tracks call count, memory usage, and argument patterns
3. **Comparison Mode:** Compare two implementations of the same function
4. **Report Generation:** Output a formatted analysis report

**Constraints:**
- Only use the standard library
- Must work with sync functions, async functions, generators, and class methods
- Must be usable both as a decorator and as a context manager

<details>
<summary><strong>Solution</strong></summary>

```python
import dis
import functools
import inspect
import sys
import time
import tracemalloc
from collections import defaultdict
from contextlib import contextmanager
from dataclasses import dataclass, field
from io import StringIO
from typing import Any, Callable, Dict, List, Optional, Tuple

@dataclass
class CallRecord:
    args: tuple
    kwargs: dict
    result: Any
    duration_ns: int
    memory_peak: int  # bytes
    timestamp: float

@dataclass
class FunctionProfile:
    name: str
    qualname: str
    module: str
    total_calls: int = 0
    total_time_ns: int = 0
    min_time_ns: int = 0
    max_time_ns: int = 0
    total_memory_peak: int = 0
    calls: List[CallRecord] = field(default_factory=list)
    errors: List[Tuple[str, Exception]] = field(default_factory=list)

class FunctionAnalyzer:
    """Comprehensive function analysis and profiling tool"""

    def __init__(self, track_args: bool = True, max_calls: int = 1000):
        self._profiles: Dict[str, FunctionProfile] = {}
        self._track_args = track_args
        self._max_calls = max_calls

    # --- Static Analysis ---

    def analyze_static(self, func: Callable) -> dict:
        """Perform static analysis on a function"""
        code = None
        if hasattr(func, '__code__'):
            code = func.__code__
        elif hasattr(func, '__wrapped__') and hasattr(func.__wrapped__, '__code__'):
            code = func.__wrapped__.__code__

        analysis = {
            "name": getattr(func, '__name__', str(func)),
            "qualname": getattr(func, '__qualname__', 'N/A'),
            "module": getattr(func, '__module__', 'N/A'),
            "docstring": inspect.getdoc(func) or "(none)",
            "is_async": inspect.iscoroutinefunction(func),
            "is_generator": inspect.isgeneratorfunction(func),
            "is_lambda": getattr(func, '__name__', '') == '<lambda>',
        }

        # Signature analysis
        try:
            sig = inspect.signature(func)
            params = {}
            for name, param in sig.parameters.items():
                params[name] = {
                    "kind": param.kind.name,
                    "has_default": param.default is not inspect.Parameter.empty,
                    "default": param.default if param.default is not inspect.Parameter.empty else None,
                    "has_annotation": param.annotation is not inspect.Parameter.empty,
                    "annotation": str(param.annotation) if param.annotation is not inspect.Parameter.empty else None,
                }
            analysis["parameters"] = params
            analysis["return_annotation"] = (
                str(sig.return_annotation)
                if sig.return_annotation is not inspect.Signature.empty
                else None
            )
        except (ValueError, TypeError):
            analysis["parameters"] = {}
            analysis["return_annotation"] = None

        # Closure analysis
        closure = getattr(func, '__closure__', None)
        if closure:
            free_vars = code.co_freevars if code else ()
            analysis["closure"] = {
                "num_cells": len(closure),
                "free_vars": list(free_vars),
                "cell_contents": [],
            }
            for i, cell in enumerate(closure):
                try:
                    val = cell.cell_contents
                    analysis["closure"]["cell_contents"].append(
                        f"{free_vars[i] if i < len(free_vars) else '?'} = {val!r}"
                    )
                except ValueError:
                    analysis["closure"]["cell_contents"].append(f"{free_vars[i]} = <empty>")
        else:
            analysis["closure"] = None

        # Bytecode analysis
        if code:
            instructions = list(dis.get_instructions(func))
            analysis["bytecode"] = {
                "num_instructions": len(instructions),
                "co_stacksize": code.co_stacksize,
                "co_nlocals": code.co_nlocals,
                "co_flags": code.co_flags,
                "num_constants": len(code.co_consts),
                "num_names": len(code.co_names),
                "has_varargs": bool(code.co_flags & 0x04),
                "has_varkw": bool(code.co_flags & 0x08),
                "is_generator_flag": bool(code.co_flags & 0x20),
                "is_coroutine_flag": bool(code.co_flags & 0x80),
                "call_count": sum(1 for i in instructions if 'CALL' in i.opname),
                "branch_count": sum(1 for i in instructions
                                    if i.opname in ('POP_JUMP_IF_TRUE', 'POP_JUMP_IF_FALSE',
                                                     'JUMP_IF_TRUE_OR_POP', 'JUMP_IF_FALSE_OR_POP',
                                                     'POP_JUMP_IF_NONE', 'POP_JUMP_IF_NOT_NONE')),
                "load_global_count": sum(1 for i in instructions if i.opname == 'LOAD_GLOBAL'),
                "load_fast_count": sum(1 for i in instructions if i.opname == 'LOAD_FAST'),
            }

            # Complexity estimate (rough cyclomatic-like)
            bc = analysis["bytecode"]
            analysis["complexity_estimate"] = 1 + bc["branch_count"]
        else:
            analysis["bytecode"] = None
            analysis["complexity_estimate"] = None

        return analysis

    # --- Dynamic Profiling ---

    def profile(self, func: Callable = None, name: str = None):
        """Decorator to profile a function"""
        def decorator(fn):
            profile_name = name or fn.__qualname__

            if profile_name not in self._profiles:
                self._profiles[profile_name] = FunctionProfile(
                    name=fn.__name__,
                    qualname=fn.__qualname__,
                    module=getattr(fn, '__module__', 'N/A'),
                )

            @functools.wraps(fn)
            def wrapper(*args, **kwargs):
                profile = self._profiles[profile_name]

                tracemalloc.start()
                start = time.perf_counter_ns()

                try:
                    result = fn(*args, **kwargs)
                    duration = time.perf_counter_ns() - start
                    _, peak = tracemalloc.get_traced_memory()
                    tracemalloc.stop()

                    record = CallRecord(
                        args=args if self._track_args else (),
                        kwargs=kwargs if self._track_args else {},
                        result=result,
                        duration_ns=duration,
                        memory_peak=peak,
                        timestamp=time.time(),
                    )

                    profile.total_calls += 1
                    profile.total_time_ns += duration
                    profile.total_memory_peak = max(profile.total_memory_peak, peak)

                    if profile.total_calls == 1:
                        profile.min_time_ns = duration
                        profile.max_time_ns = duration
                    else:
                        profile.min_time_ns = min(profile.min_time_ns, duration)
                        profile.max_time_ns = max(profile.max_time_ns, duration)

                    if len(profile.calls) < self._max_calls:
                        profile.calls.append(record)

                    return result

                except Exception as e:
                    tracemalloc.stop()
                    profile.errors.append((type(e).__name__, e))
                    raise

            return wrapper

        if func is not None:
            return decorator(func)
        return decorator

    # --- Context Manager ---

    @contextmanager
    def measure(self, label: str = "block"):
        """Context manager for profiling a code block"""
        tracemalloc.start()
        start = time.perf_counter_ns()

        yield

        duration = time.perf_counter_ns() - start
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()

        print(f"  [{label}] Duration: {duration/1_000_000:.3f}ms, Peak memory: {peak/1024:.1f}KB")

    # --- Comparison ---

    def compare(self, func_a: Callable, func_b: Callable,
                test_inputs: list, iterations: int = 100) -> dict:
        """Compare two function implementations"""
        results = {"a": {"name": func_a.__name__, "times": [], "results": []},
                   "b": {"name": func_b.__name__, "times": [], "results": []}}

        for inputs in test_inputs:
            args, kwargs = inputs if isinstance(inputs, tuple) else ((inputs,), {})

            # Benchmark A
            times_a = []
            for _ in range(iterations):
                start = time.perf_counter_ns()
                result_a = func_a(*args, **kwargs)
                times_a.append(time.perf_counter_ns() - start)
            results["a"]["times"].append(sum(times_a) / len(times_a))
            results["a"]["results"].append(result_a)

            # Benchmark B
            times_b = []
            for _ in range(iterations):
                start = time.perf_counter_ns()
                result_b = func_b(*args, **kwargs)
                times_b.append(time.perf_counter_ns() - start)
            results["b"]["times"].append(sum(times_b) / len(times_b))
            results["b"]["results"].append(result_b)

        # Summary
        avg_a = sum(results["a"]["times"]) / len(results["a"]["times"])
        avg_b = sum(results["b"]["times"]) / len(results["b"]["times"])

        results["summary"] = {
            "avg_time_a_ns": avg_a,
            "avg_time_b_ns": avg_b,
            "speedup": avg_a / avg_b if avg_b > 0 else float('inf'),
            "winner": results["a"]["name"] if avg_a < avg_b else results["b"]["name"],
            "results_match": results["a"]["results"] == results["b"]["results"],
        }

        return results

    # --- Report Generation ---

    def report(self, func: Callable = None) -> str:
        """Generate a formatted analysis report"""
        lines = []

        def add(s=""): lines.append(s)
        def sep(): add("=" * 70)

        targets = {}
        if func:
            name = func.__qualname__
            targets[name] = func
        else:
            for name, profile in self._profiles.items():
                targets[name] = None

        for name, fn in targets.items():
            sep()
            add(f"  FUNCTION ANALYSIS REPORT: {name}")
            sep()

            # Static analysis (if function available)
            if fn:
                static = self.analyze_static(fn)
                add(f"\n  --- Static Analysis ---")
                add(f"  Type: {'async ' if static['is_async'] else ''}"
                    f"{'generator ' if static['is_generator'] else ''}"
                    f"{'lambda' if static['is_lambda'] else 'function'}")
                add(f"  Module: {static['module']}")
                add(f"  Docstring: {static['docstring'][:80]}")

                if static['parameters']:
                    add(f"\n  Parameters:")
                    for pname, pinfo in static['parameters'].items():
                        default = f" = {pinfo['default']!r}" if pinfo['has_default'] else ""
                        annot = f": {pinfo['annotation']}" if pinfo['has_annotation'] else ""
                        add(f"    {pname}{annot}{default}  ({pinfo['kind']})")

                if static['closure']:
                    add(f"\n  Closure: {static['closure']['num_cells']} cells")
                    for c in static['closure']['cell_contents']:
                        add(f"    {c}")

                if static['bytecode']:
                    bc = static['bytecode']
                    add(f"\n  Bytecode Metrics:")
                    add(f"    Instructions: {bc['num_instructions']}")
                    add(f"    Stack size:   {bc['co_stacksize']}")
                    add(f"    Local vars:   {bc['co_nlocals']}")
                    add(f"    Calls:        {bc['call_count']}")
                    add(f"    Branches:     {bc['branch_count']}")
                    add(f"    LOAD_GLOBAL:  {bc['load_global_count']}")
                    add(f"    LOAD_FAST:    {bc['load_fast_count']}")
                    add(f"  Complexity estimate: {static['complexity_estimate']}")

            # Dynamic profiling data
            if name in self._profiles:
                profile = self._profiles[name]
                add(f"\n  --- Dynamic Profile ---")
                add(f"  Total calls:    {profile.total_calls}")

                if profile.total_calls > 0:
                    avg_ns = profile.total_time_ns / profile.total_calls
                    add(f"  Total time:     {profile.total_time_ns / 1_000_000:.3f}ms")
                    add(f"  Avg time:       {avg_ns / 1_000_000:.6f}ms ({avg_ns:.0f}ns)")
                    add(f"  Min time:       {profile.min_time_ns / 1_000_000:.6f}ms")
                    add(f"  Max time:       {profile.max_time_ns / 1_000_000:.6f}ms")
                    add(f"  Peak memory:    {profile.total_memory_peak / 1024:.1f}KB")

                if profile.errors:
                    add(f"\n  Errors ({len(profile.errors)}):")
                    for err_type, err in profile.errors[:5]:
                        add(f"    {err_type}: {err}")

            add("")

        return "\n".join(lines)


# ===== DEMO =====

analyzer = FunctionAnalyzer()

# Profile some functions
@analyzer.profile
def fibonacci_recursive(n):
    """Calculate nth Fibonacci number recursively"""
    if n <= 1:
        return n
    return fibonacci_recursive(n - 1) + fibonacci_recursive(n - 2)

@analyzer.profile
def fibonacci_iterative(n):
    """Calculate nth Fibonacci number iteratively"""
    if n <= 1:
        return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b

# Run profiled functions
print("=== Running Profiled Functions ===")
for i in range(20):
    fibonacci_recursive(15)
    fibonacci_iterative(15)

# Static analysis
print("\n=== Static Analysis: fibonacci_iterative ===")
static = analyzer.analyze_static(fibonacci_iterative)
for key, value in static.items():
    if key not in ('bytecode',):
        print(f"  {key}: {value}")

# Comparison
print("\n=== Comparison ===")
comparison = analyzer.compare(
    fibonacci_recursive.__wrapped__,  # unwrap the profiler
    fibonacci_iterative.__wrapped__,
    test_inputs=[5, 10, 15, 20],
    iterations=50,
)
s = comparison["summary"]
print(f"  Winner: {s['winner']}")
print(f"  Speedup: {s['speedup']:.1f}x")
print(f"  Results match: {s['results_match']}")

# Context manager usage
print("\n=== Context Manager ===")
with analyzer.measure("list comprehension"):
    result = [x**2 for x in range(10000)]

with analyzer.measure("map"):
    result = list(map(lambda x: x**2, range(10000)))

# Generate report
print(analyzer.report(fibonacci_iterative))

# Analyze a closure
def make_adder(n):
    def adder(x):
        return x + n
    return adder

add_5 = make_adder(5)
print("\n=== Closure Analysis ===")
static = analyzer.analyze_static(add_5)
print(f"  Closure: {static['closure']}")
```

</details>
