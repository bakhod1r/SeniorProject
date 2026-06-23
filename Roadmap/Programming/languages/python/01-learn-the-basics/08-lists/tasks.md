# Python Lists — Practical Tasks

## Table of Contents

1. [Junior Tasks](#junior-tasks)
2. [Middle Tasks](#middle-tasks)
3. [Senior Tasks](#senior-tasks)
4. [Questions](#questions)
5. [Mini Projects](#mini-projects)
6. [Challenge](#challenge)

---

## Junior Tasks

### Task 1: List Statistics Calculator

**Type:** Code

**Goal:** Practice basic list operations: iteration, built-in functions, and list methods.

**Starter code:**

```python
def list_stats(numbers: list[int]) -> dict:
    """
    Calculate statistics for a list of integers.

    Return a dictionary with keys:
    - "count": number of elements
    - "sum": sum of all elements
    - "min": minimum value
    - "max": maximum value
    - "average": arithmetic mean (float)
    - "sorted": list sorted ascending
    - "reversed": list sorted descending
    - "unique_count": number of unique values

    Do NOT use numpy or statistics module.
    """
    # TODO: Implement this
    pass


if __name__ == "__main__":
    data = [5, 3, 8, 1, 9, 2, 7, 4, 6, 3, 5, 8]
    result = list_stats(data)
    for key, value in result.items():
        print(f"{key}: {value}")
```

**Expected output:**
```
count: 12
sum: 61
min: 1
max: 9
average: 5.083333333333333
sorted: [1, 2, 3, 3, 4, 5, 5, 6, 7, 8, 8, 9]
reversed: [9, 8, 8, 7, 6, 5, 5, 4, 3, 3, 2, 1]
unique_count: 9
```

**Evaluation criteria:**
- [ ] Code runs without errors
- [ ] All 8 statistics are correct
- [ ] Original list is not modified
- [ ] Handles empty list gracefully

<details>
<summary>Solution</summary>

```python
def list_stats(numbers: list[int]) -> dict:
    if not numbers:
        return {
            "count": 0, "sum": 0, "min": None, "max": None,
            "average": 0.0, "sorted": [], "reversed": [], "unique_count": 0,
        }

    return {
        "count": len(numbers),
        "sum": sum(numbers),
        "min": min(numbers),
        "max": max(numbers),
        "average": sum(numbers) / len(numbers),
        "sorted": sorted(numbers),
        "reversed": sorted(numbers, reverse=True),
        "unique_count": len(set(numbers)),
    }
```

</details>

---

### Task 2: List Manipulation Toolkit

**Type:** Code

**Goal:** Practice list methods: append, insert, remove, pop, index, count, reverse.

**Starter code:**

```python
def list_toolkit():
    """
    Perform the following operations step by step:

    1. Create a list: [10, 20, 30, 40, 50]
    2. Append 60 to the end
    3. Insert 15 at index 1
    4. Remove the value 30
    5. Pop the last element (store it)
    6. Find the index of 40
    7. Count how many times 20 appears
    8. Reverse the list in place
    9. Return the final list and the popped value as a tuple
    """
    # TODO: Implement step by step
    pass


if __name__ == "__main__":
    result, popped = list_toolkit()
    print(f"Final list: {result}")
    print(f"Popped value: {popped}")
```

**Expected output:**
```
Final list: [50, 40, 20, 15, 10]
Popped value: 60
```

**Evaluation criteria:**
- [ ] Each step performed correctly in order
- [ ] Returns both final list and popped value
- [ ] Uses appropriate list methods (not manual implementation)

<details>
<summary>Solution</summary>

```python
def list_toolkit():
    lst = [10, 20, 30, 40, 50]
    lst.append(60)
    lst.insert(1, 15)
    lst.remove(30)
    popped = lst.pop()
    idx = lst.index(40)
    count = lst.count(20)
    lst.reverse()
    return lst, popped
```

</details>

---

### Task 3: Matrix Transpose

**Type:** Code

**Goal:** Practice nested lists and list comprehensions.

**Starter code:**

```python
def transpose(matrix: list[list[int]]) -> list[list[int]]:
    """
    Transpose a matrix (swap rows and columns).

    Input:  [[1, 2, 3],
             [4, 5, 6]]

    Output: [[1, 4],
             [2, 5],
             [3, 6]]

    Use list comprehension or zip.
    """
    # TODO: Implement this
    pass


if __name__ == "__main__":
    m = [[1, 2, 3], [4, 5, 6]]
    result = transpose(m)
    for row in result:
        print(row)
```

**Expected output:**
```
[1, 4]
[2, 5]
[3, 6]
```

**Evaluation criteria:**
- [ ] Correct transposition
- [ ] Works for any rectangular matrix
- [ ] Uses Pythonic approach (comprehension or zip)

<details>
<summary>Solution</summary>

```python
def transpose(matrix: list[list[int]]) -> list[list[int]]:
    return [list(row) for row in zip(*matrix)]
```

</details>

---

### Task 4: Shopping Cart

**Type:** Design + Code

**Goal:** Practice list operations in a practical context.

**Starter code:**

```python
class ShoppingCart:
    """
    Implement a shopping cart with these methods:
    - add_item(name: str, price: float, qty: int) — add an item
    - remove_item(name: str) — remove first matching item
    - get_total() -> float — sum of all (price * qty)
    - get_items() -> list[dict] — list of items
    - get_most_expensive() -> dict — item with highest price
    - apply_discount(percent: float) — reduce all prices by percent
    """

    def __init__(self):
        self.items: list[dict] = []

    # TODO: Implement all methods


if __name__ == "__main__":
    cart = ShoppingCart()
    cart.add_item("Laptop", 999.99, 1)
    cart.add_item("Mouse", 29.99, 2)
    cart.add_item("Keyboard", 79.99, 1)

    print(f"Total: ${cart.get_total():.2f}")
    print(f"Most expensive: {cart.get_most_expensive()['name']}")

    cart.remove_item("Mouse")
    print(f"After removing mouse: ${cart.get_total():.2f}")

    cart.apply_discount(10)
    print(f"After 10% discount: ${cart.get_total():.2f}")
```

**Evaluation criteria:**
- [ ] All methods work correctly
- [ ] Handles edge cases (empty cart, item not found)
- [ ] Clean, readable code

<details>
<summary>Solution</summary>

```python
class ShoppingCart:
    def __init__(self):
        self.items: list[dict] = []

    def add_item(self, name: str, price: float, qty: int) -> None:
        self.items.append({"name": name, "price": price, "qty": qty})

    def remove_item(self, name: str) -> None:
        for i, item in enumerate(self.items):
            if item["name"] == name:
                self.items.pop(i)
                return
        raise ValueError(f"{name} not in cart")

    def get_total(self) -> float:
        return sum(item["price"] * item["qty"] for item in self.items)

    def get_items(self) -> list[dict]:
        return self.items.copy()

    def get_most_expensive(self) -> dict:
        if not self.items:
            raise ValueError("Cart is empty")
        return max(self.items, key=lambda x: x["price"])

    def apply_discount(self, percent: float) -> None:
        factor = 1 - percent / 100
        for item in self.items:
            item["price"] *= factor
```

</details>

---

## Middle Tasks

### Task 1: Custom Sorted Collection

**Type:** Code

**Goal:** Implement a list wrapper that maintains sorted order with bisect.

**Requirements:**
- [ ] Implement `add(item)` — insert in sorted position
- [ ] Implement `remove(item)` — remove first occurrence
- [ ] Implement `__contains__` — O(log n) search
- [ ] Implement `range_query(lo, hi)` — return items in range
- [ ] Write pytest tests (at least 5 test cases)
- [ ] Add type hints throughout

```python
import bisect
from typing import TypeVar, Generic, Optional

T = TypeVar("T")


class SortedCollection(Generic[T]):
    """
    A list that maintains sorted order at all times.
    Uses bisect for O(log n) search.
    """

    def __init__(self) -> None:
        self._data: list[T] = []

    # TODO: Implement all methods


# Tests
def test_sorted_collection():
    sc = SortedCollection()
    # TODO: Write tests
    pass
```

<details>
<summary>Solution</summary>

```python
import bisect
from typing import TypeVar, Generic

T = TypeVar("T")


class SortedCollection(Generic[T]):
    def __init__(self) -> None:
        self._data: list[T] = []

    def add(self, item: T) -> None:
        bisect.insort(self._data, item)

    def remove(self, item: T) -> None:
        idx = bisect.bisect_left(self._data, item)
        if idx < len(self._data) and self._data[idx] == item:
            del self._data[idx]
        else:
            raise ValueError(f"{item} not found")

    def __contains__(self, item: T) -> bool:
        idx = bisect.bisect_left(self._data, item)
        return idx < len(self._data) and self._data[idx] == item

    def range_query(self, lo: T, hi: T) -> list[T]:
        left = bisect.bisect_left(self._data, lo)
        right = bisect.bisect_right(self._data, hi)
        return self._data[left:right]

    def __len__(self) -> int:
        return len(self._data)

    def __repr__(self) -> str:
        return f"SortedCollection({self._data})"


def test_sorted_collection():
    sc = SortedCollection()
    for val in [5, 2, 8, 1, 9, 3]:
        sc.add(val)
    assert list(sc._data) == [1, 2, 3, 5, 8, 9]
    assert 5 in sc
    assert 4 not in sc
    assert sc.range_query(2, 5) == [2, 3, 5]
    sc.remove(3)
    assert 3 not in sc
    assert len(sc) == 5
    print("All tests passed!")

test_sorted_collection()
```

</details>

---

### Task 2: Data Pipeline with List Transformations

**Type:** Code

**Goal:** Build a functional-style data pipeline using list operations.

**Requirements:**
- [ ] Chain multiple transformations (filter, map, reduce)
- [ ] Handle errors gracefully (skip invalid items)
- [ ] Use type hints and docstrings
- [ ] Include timeit benchmarks comparing pipeline vs loop approach

```python
from typing import Callable, TypeVar

T = TypeVar("T")
R = TypeVar("R")


class ListPipeline:
    """
    Chainable list transformation pipeline.

    Usage:
        result = (
            ListPipeline([1, 2, 3, 4, 5])
            .filter(lambda x: x > 2)
            .map(lambda x: x * 10)
            .sort(reverse=True)
            .execute()
        )
    """

    def __init__(self, data: list):
        self._data = data
        self._operations: list[Callable] = []

    # TODO: Implement filter, map, sort, take, skip, unique, execute


if __name__ == "__main__":
    data = [5, 3, 8, 1, 9, 2, 7, 4, 6, 3, 5, 8, None, "invalid", 10]

    result = (
        ListPipeline(data)
        .filter(lambda x: isinstance(x, int))
        .filter(lambda x: x > 3)
        .map(lambda x: x * 2)
        .unique()
        .sort()
        .execute()
    )
    print(result)  # [8, 10, 12, 14, 16, 18, 20]
```

<details>
<summary>Solution</summary>

```python
from typing import Callable


class ListPipeline:
    def __init__(self, data: list):
        self._data = list(data)
        self._operations: list[Callable] = []

    def filter(self, fn: Callable) -> "ListPipeline":
        self._operations.append(lambda data: [x for x in data if fn(x)])
        return self

    def map(self, fn: Callable) -> "ListPipeline":
        self._operations.append(lambda data: [fn(x) for x in data])
        return self

    def sort(self, reverse: bool = False) -> "ListPipeline":
        self._operations.append(lambda data: sorted(data, reverse=reverse))
        return self

    def take(self, n: int) -> "ListPipeline":
        self._operations.append(lambda data: data[:n])
        return self

    def skip(self, n: int) -> "ListPipeline":
        self._operations.append(lambda data: data[n:])
        return self

    def unique(self) -> "ListPipeline":
        self._operations.append(lambda data: list(dict.fromkeys(data)))
        return self

    def execute(self) -> list:
        result = self._data
        for op in self._operations:
            result = op(result)
        return result
```

</details>

---

### Task 3: Thread-Safe List with Logging

**Type:** Code

**Goal:** Implement a thread-safe list wrapper.

**Requirements:**
- [ ] Use `threading.RLock` for thread safety
- [ ] Log all modifications with timestamps
- [ ] Implement `snapshot()` for safe iteration
- [ ] Write a test with 4 concurrent threads

```python
import threading
import logging
from typing import Any

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)


class ThreadSafeList:
    """Thread-safe list with operation logging."""

    def __init__(self) -> None:
        self._data: list[Any] = []
        self._lock = threading.RLock()

    # TODO: Implement append, pop, snapshot, __len__, __getitem__
```

<details>
<summary>Solution</summary>

```python
import threading
import logging
from typing import Any

logging.basicConfig(level=logging.DEBUG, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)


class ThreadSafeList:
    def __init__(self) -> None:
        self._data: list[Any] = []
        self._lock = threading.RLock()

    def append(self, item: Any) -> None:
        with self._lock:
            self._data.append(item)
            logger.debug(f"Appended {item}, len={len(self._data)}")

    def pop(self, index: int = -1) -> Any:
        with self._lock:
            item = self._data.pop(index)
            logger.debug(f"Popped {item} at {index}, len={len(self._data)}")
            return item

    def snapshot(self) -> list[Any]:
        with self._lock:
            return self._data.copy()

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)

    def __getitem__(self, index: int) -> Any:
        with self._lock:
            return self._data[index]


def test_concurrent():
    tsl = ThreadSafeList()

    def worker(worker_id: int, count: int):
        for i in range(count):
            tsl.append(f"w{worker_id}-{i}")

    threads = [threading.Thread(target=worker, args=(i, 100)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(tsl) == 400
    print(f"Final length: {len(tsl)} (expected 400)")

test_concurrent()
```

</details>

---

## Senior Tasks

### Task 1: High-Performance Batch Processor

**Type:** Code

**Goal:** Build a batch processing system that handles millions of items efficiently.

**Requirements:**
- [ ] Process items in configurable batch sizes
- [ ] Support async processing with `asyncio`
- [ ] Implement backpressure (limit concurrent batches)
- [ ] Profile with `cProfile` and report memory usage with `tracemalloc`
- [ ] Benchmark with `timeit` against naive approach

```python
import asyncio
from typing import TypeVar, Callable, AsyncIterator

T = TypeVar("T")
R = TypeVar("R")


class BatchProcessor:
    """
    Process large lists in batches with async support.

    Features:
    - Configurable batch size
    - Backpressure via semaphore
    - Progress reporting
    - Error handling per batch
    """

    # TODO: Implement
    pass
```

<details>
<summary>Solution</summary>

```python
import asyncio
import tracemalloc
from typing import TypeVar, Callable, Any

T = TypeVar("T")


class BatchProcessor:
    def __init__(
        self,
        batch_size: int = 1000,
        max_concurrent: int = 5,
    ) -> None:
        self.batch_size = batch_size
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.processed = 0
        self.errors = 0

    def _chunk(self, data: list[T]) -> list[list[T]]:
        return [
            data[i:i + self.batch_size]
            for i in range(0, len(data), self.batch_size)
        ]

    async def process(
        self,
        data: list[T],
        handler: Callable[[list[T]], Any],
    ) -> list[Any]:
        batches = self._chunk(data)
        tasks = [self._process_batch(batch, handler, i) for i, batch in enumerate(batches)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        successes = [r for r in results if not isinstance(r, Exception)]
        errors = [r for r in results if isinstance(r, Exception)]
        self.errors = len(errors)
        return successes

    async def _process_batch(
        self,
        batch: list[T],
        handler: Callable,
        batch_idx: int,
    ) -> Any:
        async with self.semaphore:
            try:
                result = handler(batch)
                self.processed += len(batch)
                return result
            except Exception as e:
                print(f"Batch {batch_idx} failed: {e}")
                raise


async def main():
    tracemalloc.start()

    data = list(range(100_000))
    processor = BatchProcessor(batch_size=10_000, max_concurrent=3)

    results = await processor.process(
        data,
        handler=lambda batch: sum(x * 2 for x in batch),
    )

    current, peak = tracemalloc.get_traced_memory()
    print(f"Processed: {processor.processed}")
    print(f"Results: {len(results)} batches")
    print(f"Memory: current={current/1024:.1f}KB, peak={peak/1024:.1f}KB")
    tracemalloc.stop()


asyncio.run(main())
```

</details>

---

### Task 2: Memory-Efficient Large List Processing

**Type:** Code

**Goal:** Process a dataset too large to fit in memory using generators and chunking.

**Requirements:**
- [ ] Read data lazily from a file (do not load entire file)
- [ ] Process in chunks with configurable chunk size
- [ ] Track memory usage with `tracemalloc`
- [ ] Compare memory: naive list vs generator approach
- [ ] Handle malformed data gracefully

```python
import tracemalloc
from pathlib import Path


def generate_test_data(path: Path, n: int = 1_000_000) -> None:
    """Generate a test file with n lines of integers."""
    with open(path, "w") as f:
        for i in range(n):
            f.write(f"{i}\n")


def process_naive(path: Path) -> int:
    """Load all data into a list, then process. (Memory-hungry)"""
    # TODO: Implement
    pass


def process_chunked(path: Path, chunk_size: int = 10_000) -> int:
    """Process data in chunks using generators. (Memory-efficient)"""
    # TODO: Implement
    pass


if __name__ == "__main__":
    test_file = Path("/tmp/test_large.txt")
    generate_test_data(test_file)

    # Compare approaches
    tracemalloc.start()
    result = process_naive(test_file)
    _, peak_naive = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    tracemalloc.start()
    result = process_chunked(test_file)
    _, peak_chunked = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    print(f"Naive peak:   {peak_naive / 1024 / 1024:.2f} MB")
    print(f"Chunked peak: {peak_chunked / 1024 / 1024:.2f} MB")
```

<details>
<summary>Solution</summary>

```python
import tracemalloc
from pathlib import Path


def generate_test_data(path: Path, n: int = 1_000_000) -> None:
    with open(path, "w") as f:
        for i in range(n):
            f.write(f"{i}\n")


def process_naive(path: Path) -> int:
    with open(path) as f:
        data = [int(line.strip()) for line in f]
    return sum(x * 2 for x in data if x % 2 == 0)


def process_chunked(path: Path, chunk_size: int = 10_000) -> int:
    total = 0
    chunk = []
    with open(path) as f:
        for line in f:
            try:
                chunk.append(int(line.strip()))
            except ValueError:
                continue
            if len(chunk) >= chunk_size:
                total += sum(x * 2 for x in chunk if x % 2 == 0)
                chunk = []
    if chunk:
        total += sum(x * 2 for x in chunk if x % 2 == 0)
    return total


if __name__ == "__main__":
    test_file = Path("/tmp/test_large.txt")
    generate_test_data(test_file)

    tracemalloc.start()
    r1 = process_naive(test_file)
    _, peak_naive = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    tracemalloc.start()
    r2 = process_chunked(test_file)
    _, peak_chunked = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    assert r1 == r2
    print(f"Naive peak:   {peak_naive / 1024 / 1024:.2f} MB")
    print(f"Chunked peak: {peak_chunked / 1024 / 1024:.2f} MB")
```

</details>

---

### Task 3: Custom List Implementation

**Type:** Code

**Goal:** Implement a list-like class from scratch using a raw array.

**Requirements:**
- [ ] Implement dynamic array with over-allocation (growth factor 1.5x)
- [ ] Support `append`, `pop`, `insert`, `__getitem__`, `__setitem__`, `__len__`
- [ ] Implement `__iter__` and `__repr__`
- [ ] Benchmark against built-in list

```python
class DynamicArray:
    """
    A simplified implementation of Python's list using ctypes arrays.
    """

    # TODO: Implement
    pass
```

<details>
<summary>Solution</summary>

```python
import ctypes


class DynamicArray:
    def __init__(self):
        self._size = 0
        self._capacity = 4
        self._array = self._make_array(self._capacity)

    def _make_array(self, capacity: int):
        return (capacity * ctypes.py_object)()

    def _resize(self, new_capacity: int) -> None:
        new_array = self._make_array(new_capacity)
        for i in range(self._size):
            new_array[i] = self._array[i]
        self._array = new_array
        self._capacity = new_capacity

    def append(self, item) -> None:
        if self._size == self._capacity:
            self._resize(int(self._capacity * 1.5) + 1)
        self._array[self._size] = item
        self._size += 1

    def pop(self, index: int = -1):
        if self._size == 0:
            raise IndexError("pop from empty array")
        if index < 0:
            index += self._size
        if index < 0 or index >= self._size:
            raise IndexError("index out of range")
        item = self._array[index]
        for i in range(index, self._size - 1):
            self._array[i] = self._array[i + 1]
        self._size -= 1
        return item

    def insert(self, index: int, item) -> None:
        if index < 0:
            index += self._size
        index = max(0, min(index, self._size))
        if self._size == self._capacity:
            self._resize(int(self._capacity * 1.5) + 1)
        for i in range(self._size, index, -1):
            self._array[i] = self._array[i - 1]
        self._array[index] = item
        self._size += 1

    def __getitem__(self, index: int):
        if index < 0:
            index += self._size
        if index < 0 or index >= self._size:
            raise IndexError("index out of range")
        return self._array[index]

    def __setitem__(self, index: int, value) -> None:
        if index < 0:
            index += self._size
        if index < 0 or index >= self._size:
            raise IndexError("index out of range")
        self._array[index] = value

    def __len__(self) -> int:
        return self._size

    def __iter__(self):
        for i in range(self._size):
            yield self._array[i]

    def __repr__(self) -> str:
        items = [str(self._array[i]) for i in range(self._size)]
        return f"DynamicArray([{', '.join(items)}])"


# Test
da = DynamicArray()
for i in range(10):
    da.append(i)
print(da)          # DynamicArray([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
print(len(da))     # 10
print(da[5])       # 5
da.pop()
print(da)          # DynamicArray([0, 1, 2, 3, 4, 5, 6, 7, 8])
da.insert(0, -1)
print(da)          # DynamicArray([-1, 0, 1, 2, 3, 4, 5, 6, 7, 8])
```

</details>

---

## Questions

### 1. What is the difference between `del list[i]` and `list.pop(i)` and `list.remove(x)`?

**Answer:**
- `del list[i]` — removes the element at index `i`, returns nothing, raises `IndexError` if invalid
- `list.pop(i)` — removes and **returns** the element at index `i`, raises `IndexError` if invalid
- `list.remove(x)` — removes the **first occurrence** of value `x`, raises `ValueError` if not found

All three are O(n) except `pop()` with no argument (or last index) which is O(1).

---

### 2. How does `list * n` behave differently for mutable vs immutable elements?

**Answer:**
`list * n` replicates **references**. For immutable objects (int, str, tuple), this is safe because you can't modify the object in place. For mutable objects (list, dict), all copies point to the same object:

```python
# Safe — integers are immutable
row = [0] * 5
row[0] = 1
print(row)  # [1, 0, 0, 0, 0]

# Dangerous — inner lists are mutable
grid = [[0] * 5] * 3
grid[0][0] = 1
print(grid)  # [[1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0]]
```

---

### 3. When should you use `collections.deque` instead of a list?

**Answer:**
When you need efficient operations on both ends: `deque.appendleft()` and `deque.popleft()` are O(1), while `list.insert(0, x)` and `list.pop(0)` are O(n). Use deque for queues, sliding windows, and BFS algorithms.

---

### 4. What is the difference between `a += [1]` and `a = a + [1]` when `a` is a list?

**Answer:**
- `a += [1]` calls `list.__iadd__`, which extends `a` **in place**. Other references to the same list object see the change.
- `a = a + [1]` calls `list.__add__`, which creates a **new list** and rebinds `a`. Other references are unaffected.

---

### 5. How do you sort a list of dictionaries by multiple keys?

**Answer:**
Use a tuple as the sort key:

```python
data = [
    {"name": "Alice", "age": 30},
    {"name": "Bob", "age": 25},
    {"name": "Charlie", "age": 30},
]

# Sort by age ascending, then name ascending
data.sort(key=lambda x: (x["age"], x["name"]))
```

For descending on numeric fields, use negative: `key=lambda x: (-x["age"], x["name"])`.

---

### 6. What happens when you iterate over a list and modify it at the same time?

**Answer:**
Python does not raise an error but the behavior is unpredictable. The iterator uses an index counter, so inserting/deleting elements causes it to skip or repeat items. Solution: iterate over a copy or build a new list.

---

### 7. What is the memory overhead of a Python list compared to a tuple?

**Answer:**
Lists have an `allocated` field (8 bytes) and may over-allocate the pointer array. Tuples store exactly `ob_size` pointers with no over-allocation. For a 3-element sequence: `sys.getsizeof([1,2,3])` is ~88 bytes vs `sys.getsizeof((1,2,3))` is ~64 bytes.

---

## Mini Projects

### Project 1: CSV Data Analyzer

**Goal:** Build a command-line tool that reads CSV files into lists and performs analysis.

**Requirements:**
- [ ] Read CSV into `list[list[str]]`
- [ ] Support column selection, filtering, and sorting
- [ ] Calculate statistics (count, sum, avg, min, max) for numeric columns
- [ ] Output results as formatted table
- [ ] Handle large files efficiently (chunk reading)
- [ ] pytest tests with >80% coverage
- [ ] Type hints throughout

**Difficulty:** Middle
**Estimated time:** 3-4 hours

---

## Challenge

### Implement a Merge Sort that Beats Python's Built-in Sort for Specific Data Patterns

**Problem:** Implement a bottom-up merge sort optimized for nearly-sorted data. Your implementation should detect pre-existing sorted runs and merge them efficiently (similar to Timsort's approach).

**Constraints:**
- Must complete sorting of 100,000 elements under 500ms
- Must be stable (preserve order of equal elements)
- No C extensions beyond stdlib
- Memory usage under 50 MB

**Starter code:**

```python
import timeit
import random


def adaptive_merge_sort(data: list) -> list:
    """
    Sort a list using an adaptive merge sort that detects natural runs.

    Returns a new sorted list (does not modify input).
    """
    # TODO: Implement
    pass


# Benchmark
def benchmark():
    n = 100_000

    # Test case 1: Nearly sorted
    data1 = list(range(n))
    for _ in range(n // 100):
        i, j = random.randint(0, n-1), random.randint(0, n-1)
        data1[i], data1[j] = data1[j], data1[i]

    # Test case 2: Random
    data2 = [random.randint(0, n) for _ in range(n)]

    for name, data in [("Nearly sorted", data1), ("Random", data2)]:
        t_builtin = timeit.timeit(lambda: sorted(data), number=10)
        t_custom = timeit.timeit(lambda: adaptive_merge_sort(data), number=10)
        print(f"{name}: builtin={t_builtin:.4f}s, custom={t_custom:.4f}s, "
              f"ratio={t_custom/t_builtin:.2f}x")


benchmark()
```

**Scoring:**
- Correctness: 50%
- Performance relative to `sorted()`: 30%
- Code quality (ruff/mypy clean): 20%
