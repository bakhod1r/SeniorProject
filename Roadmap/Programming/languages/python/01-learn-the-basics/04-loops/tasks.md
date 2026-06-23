# Python Loops — Practice Tasks

---

## Junior Tasks (3-4)

### Task 1: Sum of Digits

Write a function that takes a positive integer and returns the sum of its digits using a loop.

**Input:** `12345`
**Expected Output:** `15`

<details>
<summary>Hint</summary>
Use modulo (<code>%</code>) to get the last digit, and integer division (<code>//</code>) to remove it.
</details>

<details>
<summary>Solution</summary>

```python
def sum_of_digits(n: int) -> int:
    """Return the sum of digits of a positive integer."""
    total = 0
    while n > 0:
        total += n % 10
        n //= 10
    return total

# Alternative using for loop and string conversion
def sum_of_digits_v2(n: int) -> int:
    return sum(int(digit) for digit in str(n))

# Tests
assert sum_of_digits(12345) == 15
assert sum_of_digits(0) == 0
assert sum_of_digits(9) == 9
assert sum_of_digits(100) == 1
print("All tests passed!")
```
</details>

---

### Task 2: Reverse a String

Write a function that reverses a string using a `for` loop (do not use slicing `[::-1]`).

**Input:** `"hello"`
**Expected Output:** `"olleh"`

<details>
<summary>Hint</summary>
Build a new string by prepending each character, or append to a list and join.
</details>

<details>
<summary>Solution</summary>

```python
def reverse_string(s: str) -> str:
    """Reverse a string using a loop."""
    chars = []
    for char in s:
        chars.insert(0, char)
    return "".join(chars)

# More efficient version (append + reverse)
def reverse_string_v2(s: str) -> str:
    chars = list(s)
    left, right = 0, len(chars) - 1
    while left < right:
        chars[left], chars[right] = chars[right], chars[left]
        left += 1
        right -= 1
    return "".join(chars)

# Tests
assert reverse_string("hello") == "olleh"
assert reverse_string("") == ""
assert reverse_string("a") == "a"
assert reverse_string("abcde") == "edcba"
print("All tests passed!")
```
</details>

---

### Task 3: Find Common Elements

Write a function that takes two lists and returns a list of elements that appear in both (without using sets).

**Input:** `[1, 2, 3, 4]`, `[3, 4, 5, 6]`
**Expected Output:** `[3, 4]`

<details>
<summary>Hint</summary>
Use a nested loop or a loop with <code>in</code> operator.
</details>

<details>
<summary>Solution</summary>

```python
def common_elements(list1: list, list2: list) -> list:
    """Find elements common to both lists."""
    result = []
    for item in list1:
        if item in list2 and item not in result:
            result.append(item)
    return result

# Tests
assert common_elements([1, 2, 3, 4], [3, 4, 5, 6]) == [3, 4]
assert common_elements([1, 2], [3, 4]) == []
assert common_elements([], [1, 2]) == []
assert common_elements([1, 1, 2], [1, 3]) == [1]
print("All tests passed!")
```
</details>

---

### Task 4: Multiplication Table

Write a function that prints a multiplication table of size `n x n` using nested loops, formatted with fixed-width columns.

**Input:** `n = 4`
**Expected Output:**
```
   1   2   3   4
   2   4   6   8
   3   6   9  12
   4   8  12  16
```

<details>
<summary>Solution</summary>

```python
def multiplication_table(n: int) -> None:
    """Print an n x n multiplication table."""
    for i in range(1, n + 1):
        for j in range(1, n + 1):
            print(f"{i * j:4}", end="")
        print()

multiplication_table(4)

# Version that returns a 2D list
def multiplication_table_list(n: int) -> list[list[int]]:
    return [[i * j for j in range(1, n + 1)] for i in range(1, n + 1)]

# Tests
result = multiplication_table_list(3)
assert result == [[1, 2, 3], [2, 4, 6], [3, 6, 9]]
print("All tests passed!")
```
</details>

---

## Middle Tasks (2-3)

### Task 1: Flatten Nested Lists

Write a generator function that flattens arbitrarily nested lists.

**Input:** `[1, [2, [3, 4], 5], [6, 7]]`
**Expected Output:** `[1, 2, 3, 4, 5, 6, 7]`

**Requirements:**
- Must be a generator (use `yield`)
- Handle any depth of nesting
- Strings should NOT be flattened into characters

<details>
<summary>Hint</summary>
Use recursion with <code>yield from</code>. Check if an item is iterable using <code>isinstance(item, (list, tuple))</code>.
</details>

<details>
<summary>Solution</summary>

```python
from typing import Any, Generator
from collections.abc import Iterable

def flatten(nested: Any) -> Generator[Any, None, None]:
    """Recursively flatten nested iterables (except strings/bytes)."""
    if isinstance(nested, (str, bytes)):
        yield nested
        return

    if isinstance(nested, Iterable):
        for item in nested:
            yield from flatten(item)
    else:
        yield nested

# Tests
assert list(flatten([1, [2, [3, 4], 5], [6, 7]])) == [1, 2, 3, 4, 5, 6, 7]
assert list(flatten([1, 2, 3])) == [1, 2, 3]
assert list(flatten([])) == []
assert list(flatten([[[1]], [[2]]])) == [1, 2]
assert list(flatten(["hello", ["world"]])) == ["hello", "world"]
assert list(flatten([1, (2, 3), {4, 5}])) == [1, 2, 3, 4, 5]  # order of set may vary
print("All tests passed!")
```
</details>

---

### Task 2: Implement `groupby` from Scratch

Write a function that groups elements of an iterable by a key function (similar to `itertools.groupby` but groups ALL matching elements, not just consecutive ones).

**Input:** `[("a", 1), ("b", 2), ("a", 3), ("b", 4)]` with `key=lambda x: x[0]`
**Expected Output:** `{"a": [("a", 1), ("a", 3)], "b": [("b", 2), ("b", 4)]}`

<details>
<summary>Hint</summary>
Use a <code>defaultdict(list)</code> and loop through the items.
</details>

<details>
<summary>Solution</summary>

```python
from typing import Callable, TypeVar, Iterable, Hashable
from collections import defaultdict

T = TypeVar("T")
K = TypeVar("K", bound=Hashable)

def group_by(
    items: Iterable[T],
    key: Callable[[T], K],
) -> dict[K, list[T]]:
    """Group items by key function."""
    groups: dict[K, list[T]] = defaultdict(list)
    for item in items:
        groups[key(item)].append(item)
    return dict(groups)

# Tests
data = [("a", 1), ("b", 2), ("a", 3), ("b", 4)]
result = group_by(data, key=lambda x: x[0])
assert result == {"a": [("a", 1), ("a", 3)], "b": [("b", 2), ("b", 4)]}

words = ["hello", "hi", "world", "wide", "hey"]
by_first_letter = group_by(words, key=lambda w: w[0])
assert by_first_letter == {"h": ["hello", "hi", "hey"], "w": ["world", "wide"]}

numbers = [1, 2, 3, 4, 5, 6]
by_parity = group_by(numbers, key=lambda n: "even" if n % 2 == 0 else "odd")
assert by_parity == {"odd": [1, 3, 5], "even": [2, 4, 6]}

print("All tests passed!")
```
</details>

---

### Task 3: Batch Processor with Error Handling

Write a function that processes items in batches, continues on individual failures, and returns a report with successes, failures, and error details.

**Requirements:**
- Process items in configurable batch sizes
- If one item fails, continue with the rest
- Return a structured result with counts and error details
- Use type hints

<details>
<summary>Solution</summary>

```python
from dataclasses import dataclass, field
from typing import List, Callable, TypeVar, Any

T = TypeVar("T")
R = TypeVar("R")

@dataclass
class BatchResult:
    total: int = 0
    successes: int = 0
    failures: int = 0
    results: List[Any] = field(default_factory=list)
    errors: List[dict] = field(default_factory=list)

def process_in_batches(
    items: List[T],
    processor: Callable[[T], R],
    batch_size: int = 100,
) -> BatchResult:
    """Process items in batches with error resilience."""
    report = BatchResult(total=len(items))

    for batch_start in range(0, len(items), batch_size):
        batch = items[batch_start:batch_start + batch_size]

        for i, item in enumerate(batch):
            index = batch_start + i
            try:
                result = processor(item)
                report.results.append(result)
                report.successes += 1
            except Exception as e:
                report.failures += 1
                report.errors.append({
                    "index": index,
                    "item": repr(item),
                    "error": str(e),
                    "type": type(e).__name__,
                })

    return report

# Tests
def risky_processor(x: int) -> float:
    if x == 0:
        raise ZeroDivisionError("cannot divide by zero")
    if x < 0:
        raise ValueError("negative number")
    return 100 / x

items = [5, 10, 0, -1, 20, 0, 15]
report = process_in_batches(items, risky_processor, batch_size=3)

assert report.total == 7
assert report.successes == 4
assert report.failures == 3
assert len(report.errors) == 3
assert report.errors[0]["type"] == "ZeroDivisionError"
assert report.errors[1]["type"] == "ValueError"
print(f"Processed: {report.successes}/{report.total} succeeded")
print(f"Errors: {report.errors}")
print("All tests passed!")
```
</details>

---

## Senior Tasks (2-3)

### Task 1: Async Rate-Limited Web Scraper

Build an async generator that fetches URLs with rate limiting and concurrency control.

**Requirements:**
- Use `asyncio` and `aiohttp`
- Limit to N concurrent requests
- Rate limit to M requests per second
- Yield results as they complete
- Handle timeouts and errors gracefully

<details>
<summary>Solution</summary>

```python
import asyncio
import time
from typing import AsyncGenerator, NamedTuple
from dataclasses import dataclass

# Note: requires `pip install aiohttp`

@dataclass
class FetchResult:
    url: str
    status: int
    body: str
    elapsed: float
    error: str | None = None

async def rate_limited_fetcher(
    urls: list[str],
    max_concurrent: int = 10,
    max_per_second: float = 5.0,
    timeout_seconds: float = 30.0,
) -> AsyncGenerator[FetchResult, None]:
    """Fetch URLs with rate limiting and concurrency control."""
    import aiohttp

    semaphore = asyncio.Semaphore(max_concurrent)
    interval = 1.0 / max_per_second
    last_request_time = 0.0
    lock = asyncio.Lock()

    async def fetch_one(
        session: aiohttp.ClientSession,
        url: str,
    ) -> FetchResult:
        nonlocal last_request_time

        # Rate limiting
        async with lock:
            now = time.monotonic()
            wait = interval - (now - last_request_time)
            if wait > 0:
                await asyncio.sleep(wait)
            last_request_time = time.monotonic()

        # Concurrency limiting
        async with semaphore:
            start = time.perf_counter()
            try:
                async with session.get(
                    url,
                    timeout=aiohttp.ClientTimeout(total=timeout_seconds),
                ) as resp:
                    body = await resp.text()
                    return FetchResult(
                        url=url,
                        status=resp.status,
                        body=body,
                        elapsed=time.perf_counter() - start,
                    )
            except Exception as e:
                return FetchResult(
                    url=url,
                    status=0,
                    body="",
                    elapsed=time.perf_counter() - start,
                    error=f"{type(e).__name__}: {e}",
                )

    async with aiohttp.ClientSession() as session:
        tasks = [
            asyncio.create_task(fetch_one(session, url))
            for url in urls
        ]
        for coro in asyncio.as_completed(tasks):
            result = await coro
            yield result

# Usage example (uncomment to run):
# async def main():
#     urls = [f"https://httpbin.org/get?id={i}" for i in range(20)]
#     async for result in rate_limited_fetcher(urls, max_concurrent=5, max_per_second=2):
#         if result.error:
#             print(f"FAIL {result.url}: {result.error}")
#         else:
#             print(f"OK {result.url}: {result.status} in {result.elapsed:.2f}s")
#
# asyncio.run(main())
```
</details>

---

### Task 2: Custom Iterator with Lookahead

Implement a `PeekableIterator` that wraps any iterator and allows peeking at the next value without consuming it.

**Requirements:**
- `peek()` returns the next value without advancing
- `__next__()` works normally
- Support `prepend()` to push a value back
- Handle `StopIteration` correctly for `peek()`
- Thread-safe (bonus)

<details>
<summary>Solution</summary>

```python
from typing import TypeVar, Iterator, Generic, Optional
from collections import deque
import threading

T = TypeVar("T")
_SENTINEL = object()

class PeekableIterator(Generic[T]):
    """Iterator wrapper that supports peeking and prepending."""

    def __init__(self, iterator: Iterator[T]) -> None:
        self._iterator = iterator
        self._buffer: deque[T] = deque()
        self._exhausted = False
        self._lock = threading.Lock()

    def __iter__(self) -> "PeekableIterator[T]":
        return self

    def __next__(self) -> T:
        with self._lock:
            if self._buffer:
                return self._buffer.popleft()
            if self._exhausted:
                raise StopIteration
            try:
                return next(self._iterator)
            except StopIteration:
                self._exhausted = True
                raise

    def peek(self, default: T = _SENTINEL) -> T:  # type: ignore
        """Return the next value without consuming it."""
        with self._lock:
            if self._buffer:
                return self._buffer[0]
            if self._exhausted:
                if default is not _SENTINEL:
                    return default
                raise StopIteration
            try:
                value = next(self._iterator)
                self._buffer.append(value)
                return value
            except StopIteration:
                self._exhausted = True
                if default is not _SENTINEL:
                    return default
                raise

    def prepend(self, *values: T) -> None:
        """Push values back to be yielded next."""
        with self._lock:
            self._buffer.extendleft(reversed(values))
            self._exhausted = False

    def has_next(self) -> bool:
        """Check if there are more values without consuming."""
        try:
            self.peek()
            return True
        except StopIteration:
            return False

    def __bool__(self) -> bool:
        return self.has_next()

# Tests
# Basic usage
it = PeekableIterator(iter([1, 2, 3]))
assert it.peek() == 1
assert it.peek() == 1  # peek doesn't consume
assert next(it) == 1
assert next(it) == 2
assert it.peek() == 3
assert next(it) == 3
assert not it.has_next()

# Prepend
it = PeekableIterator(iter([3, 4]))
it.prepend(1, 2)
assert list(it) == [1, 2, 3, 4]

# Default on peek
it = PeekableIterator(iter([]))
assert it.peek(default=42) == 42

# With generator
def gen():
    yield from range(5)

it = PeekableIterator(gen())
while it:
    val = next(it)
    if it.has_next() and it.peek() == val + 1:
        pass  # consecutive values

print("All tests passed!")
```
</details>

---

### Task 3: Generator-Based State Machine

Implement a state machine using generators, where each state is a generator that yields the next state transition.

<details>
<summary>Solution</summary>

```python
from typing import Generator, Callable, Any
from enum import Enum, auto
from dataclasses import dataclass

class State(Enum):
    IDLE = auto()
    PROCESSING = auto()
    WAITING = auto()
    ERROR = auto()
    DONE = auto()

@dataclass
class Event:
    type: str
    data: Any = None

class StateMachine:
    """Generator-based state machine."""

    def __init__(self) -> None:
        self.current_state = State.IDLE
        self.context: dict = {}
        self._handlers: dict[State, Callable] = {
            State.IDLE: self._idle,
            State.PROCESSING: self._processing,
            State.WAITING: self._waiting,
            State.ERROR: self._error,
        }

    def _idle(self) -> Generator[State, Event, None]:
        """IDLE state handler."""
        while True:
            event = yield State.IDLE
            if event.type == "start":
                self.context["task"] = event.data
                return State.PROCESSING
            elif event.type == "shutdown":
                return State.DONE

    def _processing(self) -> Generator[State, Event, None]:
        """PROCESSING state handler."""
        task = self.context.get("task", "unknown")
        print(f"Processing: {task}")

        event = yield State.PROCESSING
        if event.type == "complete":
            self.context["result"] = event.data
            return State.DONE
        elif event.type == "wait":
            return State.WAITING
        elif event.type == "error":
            self.context["error"] = event.data
            return State.ERROR

    def _waiting(self) -> Generator[State, Event, None]:
        """WAITING state handler."""
        event = yield State.WAITING
        if event.type == "resume":
            return State.PROCESSING
        elif event.type == "timeout":
            self.context["error"] = "Operation timed out"
            return State.ERROR

    def _error(self) -> Generator[State, Event, None]:
        """ERROR state handler."""
        print(f"Error: {self.context.get('error', 'unknown')}")
        event = yield State.ERROR
        if event.type == "retry":
            return State.PROCESSING
        elif event.type == "abort":
            return State.DONE

    def run(self, events: list[Event]) -> list[State]:
        """Execute state machine with a sequence of events."""
        history: list[State] = [self.current_state]

        handler_gen = self._handlers[self.current_state]()
        next(handler_gen)  # Prime the generator

        for event in events:
            try:
                handler_gen.send(event)
                # If send didn't raise StopIteration, state stayed the same
            except StopIteration as e:
                # Generator returned the next state
                next_state = e.value
                if next_state == State.DONE:
                    self.current_state = State.DONE
                    history.append(State.DONE)
                    break

                self.current_state = next_state
                history.append(next_state)

                # Start new state handler
                if next_state in self._handlers:
                    handler_gen = self._handlers[next_state]()
                    next(handler_gen)  # Prime

        return history

# Tests
sm = StateMachine()
events = [
    Event("start", "process_data"),
    Event("wait"),
    Event("resume"),
    Event("complete", {"status": "ok"}),
]
history = sm.run(events)
print(f"State history: {[s.name for s in history]}")
# [IDLE, PROCESSING, WAITING, PROCESSING, DONE]

assert history[0] == State.IDLE
assert history[-1] == State.DONE
assert State.WAITING in history

# Error recovery test
sm2 = StateMachine()
events2 = [
    Event("start", "risky_task"),
    Event("error", "connection failed"),
    Event("retry"),
    Event("complete", "success"),
]
history2 = sm2.run(events2)
print(f"State history: {[s.name for s in history2]}")
assert State.ERROR in history2

print("All tests passed!")
```
</details>

---

## Questions (5-10)

1. **What is the time complexity of iterating over a `range(n)` vs a `list(range(n))`?** Both are O(n) for iteration, but `list(range(n))` uses O(n) memory while `range(n)` uses O(1).

2. **Can you modify a set while iterating over it?** No — you'll get `RuntimeError: Set changed size during iteration`. Use a copy: `for item in set(original):`.

3. **What does `itertools.tee()` do and what is its memory tradeoff?** It creates independent iterators from one source, but buffers items consumed by one and not the other — potentially O(n) memory.

4. **Why should you avoid `for i in range(len(list))` in Python?** It's unpythonic. Use `for item in list:` (direct) or `for i, item in enumerate(list):` (with index).

5. **What happens if a generator raises an exception inside `yield`?** The exception propagates to the caller. The generator is left in a suspended state and can be resumed with `next()` if the exception was caught by the caller. Actually, after an unhandled exception the generator cannot be resumed — `gi_frame` becomes `None`.

6. **How do you create an infinite iterator?** Use `itertools.count()`, `itertools.cycle()`, or a generator with `while True: yield value`.

7. **What is the `__length_hint__` method?** An optional method on iterators that returns an estimated length, used by `list()` and other constructors to pre-allocate memory. Not guaranteed to be accurate.

8. **Can list comprehensions have multiple `for` clauses?** Yes: `[x*y for x in range(3) for y in range(3)]` is equivalent to nested loops (outer first).

9. **What is the difference between `map(func, iterable)` and `[func(x) for x in iterable]`?** `map()` returns a lazy iterator; list comprehension returns a list. For simple functions, `map()` with a built-in C function (like `str.upper`) can be faster.

10. **Why is string concatenation in a loop O(n^2)?** Each `+=` creates a new string, copying all previous characters. Use `"".join(parts)` for O(n) performance.

---

## Mini Projects (1+)

### Mini Project: Log Analyzer

Build a command-line log analyzer that reads log files and produces statistics.

**Requirements:**
1. Read log files line by line using a generator (support large files)
2. Parse each line to extract: timestamp, level (INFO/WARN/ERROR), message
3. Group log entries by level
4. Find the top 5 most frequent error messages
5. Calculate errors per hour
6. Output a summary report

**Bonus:**
- Support multiple log files via `itertools.chain()`
- Add `--filter-level` and `--since` command-line arguments
- Support gzipped log files

<details>
<summary>Solution</summary>

```python
#!/usr/bin/env python3
"""Log file analyzer using generator pipelines."""

import re
import gzip
import sys
from collections import Counter, defaultdict
from datetime import datetime
from typing import Generator, Iterable, NamedTuple
from pathlib import Path
import itertools
import argparse

class LogEntry(NamedTuple):
    timestamp: datetime
    level: str
    message: str
    raw: str

# --- Generator Pipeline Stages ---

def read_lines(path: str) -> Generator[str, None, None]:
    """Read lines from a file (supports .gz)."""
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt") as f:
        yield from f

def parse_log_entries(lines: Iterable[str]) -> Generator[LogEntry, None, None]:
    """Parse log lines into LogEntry objects."""
    pattern = re.compile(
        r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+"
        r"(DEBUG|INFO|WARN|WARNING|ERROR|CRITICAL)\s+"
        r"(.+)"
    )
    for line in lines:
        line = line.strip()
        match = pattern.match(line)
        if match:
            ts = datetime.strptime(match.group(1), "%Y-%m-%d %H:%M:%S")
            yield LogEntry(
                timestamp=ts,
                level=match.group(2),
                message=match.group(3),
                raw=line,
            )

def filter_level(
    entries: Iterable[LogEntry],
    levels: set[str],
) -> Generator[LogEntry, None, None]:
    """Filter entries by log level."""
    for entry in entries:
        if entry.level in levels:
            yield entry

def filter_since(
    entries: Iterable[LogEntry],
    since: datetime,
) -> Generator[LogEntry, None, None]:
    """Filter entries after a given timestamp."""
    for entry in entries:
        if entry.timestamp >= since:
            yield entry

# --- Analysis ---

def analyze(entries: Iterable[LogEntry]) -> dict:
    """Analyze log entries and produce statistics."""
    level_counts: Counter = Counter()
    error_messages: Counter = Counter()
    errors_per_hour: defaultdict = defaultdict(int)
    total = 0

    for entry in entries:
        total += 1
        level_counts[entry.level] += 1

        if entry.level in ("ERROR", "CRITICAL"):
            error_messages[entry.message] += 1
            hour_key = entry.timestamp.strftime("%Y-%m-%d %H:00")
            errors_per_hour[hour_key] += 1

    return {
        "total_entries": total,
        "by_level": dict(level_counts),
        "top_errors": error_messages.most_common(5),
        "errors_per_hour": dict(sorted(errors_per_hour.items())),
    }

def print_report(stats: dict) -> None:
    """Print analysis report."""
    print("=" * 60)
    print("LOG ANALYSIS REPORT")
    print("=" * 60)
    print(f"\nTotal entries analyzed: {stats['total_entries']}")

    print("\n--- Entries by Level ---")
    for level, count in sorted(stats["by_level"].items()):
        pct = 100 * count / max(stats["total_entries"], 1)
        bar = "#" * int(pct / 2)
        print(f"  {level:10s} {count:6d} ({pct:5.1f}%) {bar}")

    print("\n--- Top 5 Error Messages ---")
    for i, (msg, count) in enumerate(stats["top_errors"], 1):
        print(f"  {i}. [{count}x] {msg[:80]}")

    print("\n--- Errors Per Hour ---")
    for hour, count in stats["errors_per_hour"].items():
        bar = "#" * count
        print(f"  {hour}: {count:4d} {bar}")

# --- Main ---

def main():
    parser = argparse.ArgumentParser(description="Log file analyzer")
    parser.add_argument("files", nargs="+", help="Log files to analyze")
    parser.add_argument("--level", nargs="*", help="Filter by level(s)")
    parser.add_argument("--since", help="Filter entries since (YYYY-MM-DD)")
    args = parser.parse_args()

    # Chain multiple files
    all_lines = itertools.chain.from_iterable(
        read_lines(f) for f in args.files
    )

    # Parse
    entries = parse_log_entries(all_lines)

    # Apply filters
    if args.level:
        entries = filter_level(entries, set(args.level))
    if args.since:
        since_dt = datetime.strptime(args.since, "%Y-%m-%d")
        entries = filter_since(entries, since_dt)

    # Analyze and report
    stats = analyze(entries)
    print_report(stats)

if __name__ == "__main__":
    # Demo with sample data
    sample_logs = [
        "2024-01-15 10:00:01 INFO User login successful",
        "2024-01-15 10:00:02 INFO Processing request",
        "2024-01-15 10:00:03 ERROR Database connection timeout",
        "2024-01-15 10:00:04 WARN High memory usage",
        "2024-01-15 10:00:05 ERROR Database connection timeout",
        "2024-01-15 11:00:01 INFO Request completed",
        "2024-01-15 11:00:02 ERROR Null pointer exception",
        "2024-01-15 11:00:03 ERROR Database connection timeout",
        "2024-01-15 12:00:01 INFO Scheduled job started",
        "2024-01-15 12:00:02 CRITICAL Out of memory",
    ]

    entries = parse_log_entries(iter(sample_logs))
    stats = analyze(entries)
    print_report(stats)
```
</details>

---

## Challenge (1)

### Challenge: Implement a Lazy DataFrame

Build a simplified lazy DataFrame that uses generator pipelines for all operations. Operations should be deferred until the data is consumed.

**Requirements:**
1. `LazyFrame.from_csv(path)` — read CSV lazily
2. `.filter(predicate)` — filter rows
3. `.select(*columns)` — select columns
4. `.map_column(col, func)` — transform a column
5. `.sort_by(col)` — sort (this forces materialization)
6. `.limit(n)` — take first n rows
7. `.collect()` — materialize into a list of dicts
8. `.to_csv(path)` — write results lazily

All operations except `sort_by` and `collect` should be lazy (deferred). The pipeline should handle files larger than memory.

<details>
<summary>Solution</summary>

```python
"""Lazy DataFrame implementation using generator pipelines."""
import csv
import itertools
from typing import (
    Callable, Generator, Iterable, Any, TypeVar, Optional,
)
from pathlib import Path
from io import StringIO

Row = dict[str, str]
T = TypeVar("T")

class LazyFrame:
    """A lazy DataFrame backed by generator pipelines."""

    def __init__(self, source: Callable[[], Generator[Row, None, None]]) -> None:
        # Store a factory function that creates the generator
        # This allows re-iteration
        self._source_factory = source

    def _iter(self) -> Generator[Row, None, None]:
        yield from self._source_factory()

    @classmethod
    def from_csv(cls, path: str) -> "LazyFrame":
        """Read a CSV file lazily."""
        def source() -> Generator[Row, None, None]:
            with open(path, newline="") as f:
                reader = csv.DictReader(f)
                yield from reader
        return cls(source)

    @classmethod
    def from_records(cls, records: list[Row]) -> "LazyFrame":
        """Create from a list of dicts (for testing)."""
        def source() -> Generator[Row, None, None]:
            yield from records
        return cls(source)

    def filter(self, predicate: Callable[[Row], bool]) -> "LazyFrame":
        """Filter rows lazily."""
        parent = self._source_factory
        def source() -> Generator[Row, None, None]:
            for row in parent():
                if predicate(row):
                    yield row
        return LazyFrame(source)

    def select(self, *columns: str) -> "LazyFrame":
        """Select specific columns lazily."""
        parent = self._source_factory
        def source() -> Generator[Row, None, None]:
            for row in parent():
                yield {col: row[col] for col in columns if col in row}
        return LazyFrame(source)

    def map_column(self, col: str, func: Callable[[str], str]) -> "LazyFrame":
        """Transform a column lazily."""
        parent = self._source_factory
        def source() -> Generator[Row, None, None]:
            for row in parent():
                new_row = dict(row)
                if col in new_row:
                    new_row[col] = func(new_row[col])
                yield new_row
        return LazyFrame(source)

    def limit(self, n: int) -> "LazyFrame":
        """Take first n rows lazily."""
        parent = self._source_factory
        def source() -> Generator[Row, None, None]:
            yield from itertools.islice(parent(), n)
        return LazyFrame(source)

    def sort_by(self, col: str, reverse: bool = False) -> "LazyFrame":
        """Sort by column (materializes data)."""
        parent = self._source_factory
        def source() -> Generator[Row, None, None]:
            rows = sorted(parent(), key=lambda r: r.get(col, ""), reverse=reverse)
            yield from rows
        return LazyFrame(source)

    def collect(self) -> list[Row]:
        """Materialize the pipeline into a list of dicts."""
        return list(self._iter())

    def to_csv(self, path: str) -> int:
        """Write results to CSV lazily. Returns number of rows written."""
        count = 0
        first_row = True
        with open(path, "w", newline="") as f:
            writer: Optional[csv.DictWriter] = None
            for row in self._iter():
                if first_row:
                    writer = csv.DictWriter(f, fieldnames=list(row.keys()))
                    writer.writeheader()
                    first_row = False
                writer.writerow(row)  # type: ignore
                count += 1
        return count

    def __repr__(self) -> str:
        return f"LazyFrame(pending)"

# --- Tests ---
records = [
    {"name": "Alice", "age": "30", "city": "NYC"},
    {"name": "Bob", "age": "25", "city": "LA"},
    {"name": "Charlie", "age": "35", "city": "NYC"},
    {"name": "Diana", "age": "28", "city": "Chicago"},
    {"name": "Eve", "age": "32", "city": "NYC"},
]

# Test chained operations
result = (
    LazyFrame.from_records(records)
    .filter(lambda r: r["city"] == "NYC")
    .map_column("age", lambda a: str(int(a) + 1))
    .select("name", "age")
    .collect()
)

assert len(result) == 3
assert result[0] == {"name": "Alice", "age": "31"}
assert result[1] == {"name": "Charlie", "age": "36"}

# Test limit
result = LazyFrame.from_records(records).limit(2).collect()
assert len(result) == 2

# Test sort
result = (
    LazyFrame.from_records(records)
    .sort_by("age")
    .select("name", "age")
    .collect()
)
assert result[0]["name"] == "Bob"  # youngest

# Test re-iteration
lf = LazyFrame.from_records(records).filter(lambda r: r["city"] == "NYC")
assert len(lf.collect()) == 3
assert len(lf.collect()) == 3  # Can iterate again!

print("All tests passed!")
```
</details>
