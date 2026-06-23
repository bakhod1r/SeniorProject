# Variables and Data Types — Practice Tasks

---

## Task 1: Type Explorer (Junior)

**Difficulty:** Easy
**Estimated time:** 15 minutes

Write a function `explore_type(value)` that takes any value and returns a dictionary with the following information:
- `"value"`: the value itself
- `"type"`: the type name as a string
- `"id"`: the memory address
- `"is_mutable"`: True if the type is mutable (list, dict, set, bytearray)
- `"is_falsy"`: True if `bool(value)` is False
- `"size"`: the size in bytes (`sys.getsizeof`)

```python
import sys


def explore_type(value) -> dict:
    # Your code here
    pass


# Tests
if __name__ == "__main__":
    test_cases = [42, 3.14, "hello", True, None, [], {}, (1, 2), {1, 2}]
    for val in test_cases:
        result = explore_type(val)
        print(f"{str(val):15} -> type={result['type']:10} "
              f"mutable={result['is_mutable']!s:5} "
              f"falsy={result['is_falsy']!s:5} "
              f"size={result['size']} bytes")
```

<details>
<summary>Solution</summary>

```python
import sys

MUTABLE_TYPES = (list, dict, set, bytearray)


def explore_type(value) -> dict:
    return {
        "value": value,
        "type": type(value).__name__,
        "id": id(value),
        "is_mutable": isinstance(value, MUTABLE_TYPES),
        "is_falsy": not bool(value),
        "size": sys.getsizeof(value),
    }


if __name__ == "__main__":
    test_cases = [42, 3.14, "hello", True, None, [], {}, (1, 2), {1, 2}]
    for val in test_cases:
        result = explore_type(val)
        print(f"{str(val):15} -> type={result['type']:10} "
              f"mutable={result['is_mutable']!s:5} "
              f"falsy={result['is_falsy']!s:5} "
              f"size={result['size']} bytes")
```

</details>

---

## Task 2: Variable Swap Challenge (Junior)

**Difficulty:** Easy
**Estimated time:** 10 minutes

Implement three different ways to swap two variables without using a temporary variable (besides Python's tuple swap). Verify each method works.

```python
def swap_arithmetic(a: int, b: int) -> tuple[int, int]:
    """Swap using arithmetic operations."""
    # Your code here
    pass


def swap_xor(a: int, b: int) -> tuple[int, int]:
    """Swap using XOR bitwise operation."""
    # Your code here
    pass


def swap_pythonic(a, b):
    """Swap using Python's tuple unpacking."""
    # Your code here
    pass


# Tests
if __name__ == "__main__":
    assert swap_arithmetic(5, 10) == (10, 5)
    assert swap_arithmetic(-3, 7) == (7, -3)

    assert swap_xor(5, 10) == (10, 5)
    assert swap_xor(0, 255) == (255, 0)

    assert swap_pythonic("hello", "world") == ("world", "hello")
    assert swap_pythonic(5, 10) == (10, 5)

    print("All swap tests passed!")
```

<details>
<summary>Solution</summary>

```python
def swap_arithmetic(a: int, b: int) -> tuple[int, int]:
    a = a + b
    b = a - b
    a = a - b
    return a, b


def swap_xor(a: int, b: int) -> tuple[int, int]:
    a = a ^ b
    b = a ^ b
    a = a ^ b
    return a, b


def swap_pythonic(a, b):
    a, b = b, a
    return a, b
```

</details>

---

## Task 3: Type Validator Decorator (Middle)

**Difficulty:** Medium
**Estimated time:** 30 minutes

Create a decorator `@validate_types` that checks function argument types at runtime using the function's type hints.

```python
import functools
import inspect
from typing import get_type_hints


def validate_types(func):
    """Decorator that validates argument types at runtime based on type hints."""
    # Your code here
    pass


# Tests
@validate_types
def add(a: int, b: int) -> int:
    return a + b


@validate_types
def greet(name: str, times: int = 1) -> str:
    return (f"Hello, {name}! ") * times


@validate_types
def process(data: list, flag: bool = False) -> dict:
    return {"data": data, "flag": flag}


if __name__ == "__main__":
    # Should work
    print(add(1, 2))           # 3
    print(greet("Alice"))      # "Hello, Alice! "
    print(greet("Bob", 3))     # "Hello, Bob! Hello, Bob! Hello, Bob! "
    print(process([1, 2, 3]))  # {"data": [1, 2, 3], "flag": False}

    # Should raise TypeError
    for args, kwargs in [
        ((1, "2"), {}),           # add: b should be int
        ((42,), {}),              # greet: name should be str
        (("hi", "3"), {}),        # greet: times should be int
    ]:
        try:
            if len(args) == 2 and isinstance(args[0], int):
                add(*args, **kwargs)
            elif isinstance(args[0], int):
                greet(*args, **kwargs)
            else:
                greet(*args, **kwargs)
            print(f"FAIL: Should have raised TypeError for args={args}")
        except TypeError as e:
            print(f"OK: TypeError raised: {e}")

    print("\nAll tests passed!")
```

<details>
<summary>Solution</summary>

```python
import functools
import inspect
from typing import get_type_hints


def validate_types(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        hints = get_type_hints(func)
        sig = inspect.signature(func)
        bound = sig.bind(*args, **kwargs)
        bound.apply_defaults()

        for param_name, value in bound.arguments.items():
            if param_name in hints and param_name != "return":
                expected = hints[param_name]
                if not isinstance(value, expected):
                    raise TypeError(
                        f"Argument '{param_name}' expected {expected.__name__}, "
                        f"got {type(value).__name__} ({value!r})"
                    )

        result = func(*args, **kwargs)

        if "return" in hints:
            expected_return = hints["return"]
            if not isinstance(result, expected_return):
                raise TypeError(
                    f"Return value expected {expected_return.__name__}, "
                    f"got {type(result).__name__}"
                )

        return result

    return wrapper
```

</details>

---

## Task 4: Immutable Config Builder (Middle)

**Difficulty:** Medium
**Estimated time:** 25 minutes

Create an immutable configuration class using `@dataclass(frozen=True)` with:
- Nested configuration (DatabaseConfig inside AppConfig)
- Validation in `__post_init__`
- A `from_dict` class method
- A `to_dict` method
- Environment variable loading

```python
from dataclasses import dataclass, field, asdict
from typing import ClassVar
import os


@dataclass(frozen=True)
class DatabaseConfig:
    """Immutable database configuration."""
    # Your code here
    pass


@dataclass(frozen=True)
class AppConfig:
    """Immutable application configuration."""
    # Your code here
    pass


# Tests
if __name__ == "__main__":
    # Test 1: Default config
    config = AppConfig()
    print(f"Default: {config}")

    # Test 2: Custom config
    db = DatabaseConfig(host="db.example.com", port=5433, name="production")
    config = AppConfig(debug=False, db=db, secret_key="super-secret")
    print(f"Custom: {config}")

    # Test 3: Immutability
    try:
        config.debug = True
        print("FAIL: Should have raised FrozenInstanceError")
    except AttributeError:
        print("OK: Config is immutable")

    # Test 4: Validation
    try:
        DatabaseConfig(port=99999)
        print("FAIL: Should have raised ValueError for invalid port")
    except ValueError as e:
        print(f"OK: Validation works: {e}")

    # Test 5: from_dict
    data = {"debug": True, "secret_key": "key123", "db": {"host": "remote", "port": 5432}}
    config = AppConfig.from_dict(data)
    print(f"From dict: {config}")

    # Test 6: to_dict
    d = config.to_dict()
    print(f"To dict: {d}")
    assert isinstance(d, dict)
    assert isinstance(d["db"], dict)

    print("\nAll config tests passed!")
```

<details>
<summary>Solution</summary>

```python
from dataclasses import dataclass, field, asdict
from typing import ClassVar
import os


@dataclass(frozen=True)
class DatabaseConfig:
    host: str = "localhost"
    port: int = 5432
    name: str = "mydb"
    pool_size: int = 10

    def __post_init__(self) -> None:
        if not 1 <= self.port <= 65535:
            raise ValueError(f"Port must be 1-65535, got {self.port}")
        if self.pool_size < 1:
            raise ValueError(f"pool_size must be >= 1, got {self.pool_size}")
        if not self.host:
            raise ValueError("host cannot be empty")

    @classmethod
    def from_dict(cls, data: dict) -> "DatabaseConfig":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class AppConfig:
    debug: bool = False
    db: DatabaseConfig = field(default_factory=DatabaseConfig)
    secret_key: str = ""
    app_name: str = "MyApp"

    def __post_init__(self) -> None:
        if not self.debug and not self.secret_key:
            raise ValueError("secret_key is required in production mode")

    @classmethod
    def from_dict(cls, data: dict) -> "AppConfig":
        db_data = data.pop("db", {})
        db = DatabaseConfig.from_dict(db_data) if db_data else DatabaseConfig()
        return cls(db=db, **{k: v for k, v in data.items() if k in cls.__dataclass_fields__})

    @classmethod
    def from_env(cls) -> "AppConfig":
        return cls(
            debug=os.getenv("DEBUG", "false").lower() == "true",
            secret_key=os.getenv("SECRET_KEY", "dev-key"),
            app_name=os.getenv("APP_NAME", "MyApp"),
            db=DatabaseConfig(
                host=os.getenv("DB_HOST", "localhost"),
                port=int(os.getenv("DB_PORT", "5432")),
                name=os.getenv("DB_NAME", "mydb"),
            ),
        )

    def to_dict(self) -> dict:
        return asdict(self)
```

</details>

---

## Task 5: Reference Tracker (Middle)

**Difficulty:** Medium
**Estimated time:** 20 minutes

Write a class `RefTracker` that tracks how many references exist to a given object and logs when references are created or destroyed.

```python
import sys
import weakref


class RefTracker:
    """Track references to an object."""
    # Your code here
    pass


# Tests
if __name__ == "__main__":
    class MyObj:
        def __init__(self, name):
            self.name = name
        def __repr__(self):
            return f"MyObj({self.name!r})"

    tracker = RefTracker()

    obj = MyObj("test")
    tracker.track(obj, "obj")

    alias = obj
    tracker.track(alias, "alias")

    print(f"References to obj: {tracker.ref_count('obj')}")

    container = [obj]
    tracker.track(container, "container")

    print(f"References to obj after container: {tracker.ref_count('obj')}")

    del alias
    print(f"References to obj after del alias: {tracker.ref_count('obj')}")

    tracker.report()
```

<details>
<summary>Solution</summary>

```python
import sys
import weakref


class RefTracker:
    def __init__(self):
        self._tracked: dict[str, object] = {}
        self._initial_counts: dict[str, int] = {}

    def track(self, obj: object, name: str) -> None:
        self._tracked[name] = obj
        count = sys.getrefcount(obj) - 1  # -1 for getrefcount arg
        self._initial_counts[name] = count
        print(f"[TRACK] '{name}' = {obj!r}, refcount = {count}")

    def ref_count(self, name: str) -> int:
        if name not in self._tracked:
            raise KeyError(f"'{name}' is not tracked")
        obj = self._tracked[name]
        return sys.getrefcount(obj) - 1  # -1 for getrefcount arg

    def report(self) -> None:
        print("\n=== Reference Report ===")
        for name, obj in self._tracked.items():
            current = sys.getrefcount(obj) - 1
            initial = self._initial_counts[name]
            delta = current - initial
            sign = "+" if delta > 0 else ""
            print(f"  {name:15}: refcount={current} (initial={initial}, delta={sign}{delta})")
```

</details>

---

## Task 6: Scope Inspector (Senior)

**Difficulty:** Hard
**Estimated time:** 30 minutes

Write a decorator `@inspect_scope` that prints the local, enclosing, and global variables accessed by a function when it is called.

```python
import dis
import types
from typing import Callable, Any


def inspect_scope(func: Callable) -> Callable:
    """Decorator that prints scope information when the function is called."""
    # Your code here
    pass


# Tests
x = "global_x"
y = "global_y"


def make_adder(n: int):
    @inspect_scope
    def adder(a: int) -> int:
        return a + n + len(x)  # uses local (a), enclosing (n), global (x), builtin (len)
    return adder


add5 = make_adder(5)
result = add5(10)
print(f"Result: {result}")
```

<details>
<summary>Solution</summary>

```python
import dis
import types
import functools
from typing import Callable, Any


def inspect_scope(func: Callable) -> Callable:
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        code = func.__code__

        print(f"\n=== Scope Analysis: {func.__qualname__} ===")
        print(f"  Local variables:    {list(code.co_varnames)}")
        print(f"  Free variables:     {list(code.co_freevars)}")  # Enclosing scope
        print(f"  Global names used:  {list(code.co_names)}")

        # Classify bytecode operations
        load_ops = {"LOAD_FAST": [], "LOAD_GLOBAL": [], "LOAD_DEREF": []}
        for instr in dis.get_instructions(code):
            if instr.opname in load_ops:
                load_ops[instr.opname].append(instr.argval)

        print(f"  LOAD_FAST (local):     {load_ops['LOAD_FAST']}")
        print(f"  LOAD_GLOBAL (global):  {load_ops['LOAD_GLOBAL']}")
        print(f"  LOAD_DEREF (closure):  {load_ops['LOAD_DEREF']}")

        result = func(*args, **kwargs)
        print(f"  Return value: {result}")
        return result

    return wrapper
```

</details>

---

## Task 7: Memory-Efficient Record Store (Senior)

**Difficulty:** Hard
**Estimated time:** 40 minutes

Implement a `RecordStore` that stores millions of records memory-efficiently using `__slots__` and a custom `Record` class. Compare memory usage with a dict-based approach.

```python
import sys
import tracemalloc
from dataclasses import dataclass


class Record:
    """Memory-efficient record using __slots__."""
    __slots__ = ("id", "name", "value", "active")

    def __init__(self, id: int, name: str, value: float, active: bool = True):
        self.id = id
        self.name = name
        self.value = value
        self.active = active

    def __repr__(self) -> str:
        return f"Record(id={self.id}, name={self.name!r}, value={self.value}, active={self.active})"


class RecordStore:
    """Store for memory-efficient records with indexing."""
    # Your code here: implement add, get_by_id, find_by_name, count, memory_usage
    pass


def benchmark_memory(n: int = 100_000) -> None:
    """Compare memory usage: dict vs Record with __slots__."""
    # Your code here
    pass


# Tests
if __name__ == "__main__":
    store = RecordStore()

    # Add records
    for i in range(10):
        store.add(Record(i, f"item_{i}", i * 1.5))

    # Query
    print(store.get_by_id(5))
    print(store.find_by_name("item_3"))
    print(f"Count: {store.count()}")

    # Benchmark
    benchmark_memory(100_000)
```

<details>
<summary>Solution</summary>

```python
import sys
import tracemalloc
from dataclasses import dataclass


class Record:
    __slots__ = ("id", "name", "value", "active")

    def __init__(self, id: int, name: str, value: float, active: bool = True):
        self.id = id
        self.name = name
        self.value = value
        self.active = active

    def __repr__(self) -> str:
        return f"Record(id={self.id}, name={self.name!r}, value={self.value}, active={self.active})"


class RecordStore:
    def __init__(self) -> None:
        self._records: list[Record] = []
        self._id_index: dict[int, Record] = {}
        self._name_index: dict[str, list[Record]] = {}

    def add(self, record: Record) -> None:
        self._records.append(record)
        self._id_index[record.id] = record
        self._name_index.setdefault(record.name, []).append(record)

    def get_by_id(self, record_id: int) -> Record | None:
        return self._id_index.get(record_id)

    def find_by_name(self, name: str) -> list[Record]:
        return self._name_index.get(name, [])

    def count(self) -> int:
        return len(self._records)

    def memory_usage(self) -> int:
        total = sys.getsizeof(self._records)
        total += sys.getsizeof(self._id_index)
        total += sys.getsizeof(self._name_index)
        for r in self._records:
            total += sys.getsizeof(r)
        return total


def benchmark_memory(n: int = 100_000) -> None:
    # Dict-based
    tracemalloc.start()
    dict_records = [
        {"id": i, "name": f"item_{i}", "value": i * 1.5, "active": True}
        for i in range(n)
    ]
    dict_mem, _ = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    # Slots-based
    tracemalloc.start()
    slot_records = [
        Record(i, f"item_{i}", i * 1.5)
        for i in range(n)
    ]
    slot_mem, _ = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    print(f"\n=== Memory Benchmark ({n:,} records) ===")
    print(f"  Dict-based:  {dict_mem / 1024 / 1024:.2f} MB")
    print(f"  Slots-based: {slot_mem / 1024 / 1024:.2f} MB")
    print(f"  Savings:     {(1 - slot_mem / dict_mem) * 100:.1f}%")

    del dict_records, slot_records


if __name__ == "__main__":
    store = RecordStore()
    for i in range(10):
        store.add(Record(i, f"item_{i}", i * 1.5))

    print(store.get_by_id(5))
    print(store.find_by_name("item_3"))
    print(f"Count: {store.count()}")

    benchmark_memory(100_000)
```

</details>

---

## Task 8: Custom Deep Copy with Cycle Detection (Senior)

**Difficulty:** Hard
**Estimated time:** 35 minutes

Implement a `deep_copy` function that handles circular references (like `copy.deepcopy` does).

```python
def deep_copy(obj, _memo=None):
    """
    Deep copy that handles:
    - Immutable types (int, float, str, bool, None, tuple of immutables)
    - list, dict, set, tuple (with mutable elements)
    - Circular references (using a memo dict keyed by id)
    """
    # Your code here
    pass


# Tests
if __name__ == "__main__":
    # Test 1: Simple types
    assert deep_copy(42) == 42
    assert deep_copy("hello") == "hello"
    assert deep_copy(None) is None

    # Test 2: Nested structures
    original = {"a": [1, 2, [3, 4]], "b": {"c": 5}}
    copied = deep_copy(original)
    assert copied == original
    assert copied is not original
    assert copied["a"][2] is not original["a"][2]

    # Test 3: Circular reference
    a = [1, 2]
    a.append(a)  # a[2] is a itself
    copied_a = deep_copy(a)
    assert copied_a[0] == 1
    assert copied_a[1] == 2
    assert copied_a[2] is copied_a  # Circular reference preserved in copy
    assert copied_a is not a         # But it's a different object

    # Test 4: Shared references
    shared = [1, 2]
    original = [shared, shared]
    copied = deep_copy(original)
    assert copied[0] is copied[1]    # Shared reference preserved
    assert copied[0] is not shared   # But different from original

    print("All deep copy tests passed!")
```

<details>
<summary>Solution</summary>

```python
def deep_copy(obj, _memo=None):
    if _memo is None:
        _memo = {}

    obj_id = id(obj)
    if obj_id in _memo:
        return _memo[obj_id]

    # Immutable atoms — return as-is
    if isinstance(obj, (int, float, str, bool, bytes, type(None))):
        return obj

    # List
    if isinstance(obj, list):
        new_list = []
        _memo[obj_id] = new_list  # Register before recursing (handles cycles)
        new_list.extend(deep_copy(item, _memo) for item in obj)
        return new_list

    # Dict
    if isinstance(obj, dict):
        new_dict = {}
        _memo[obj_id] = new_dict
        for k, v in obj.items():
            new_dict[deep_copy(k, _memo)] = deep_copy(v, _memo)
        return new_dict

    # Set
    if isinstance(obj, set):
        new_set = set()
        _memo[obj_id] = new_set
        for item in obj:
            new_set.add(deep_copy(item, _memo))
        return new_set

    # Tuple (may contain mutable elements)
    if isinstance(obj, tuple):
        # Must handle tuple specially — can't pre-register because tuples are immutable
        copied_items = tuple(deep_copy(item, _memo) for item in obj)
        _memo[obj_id] = copied_items
        return copied_items

    raise TypeError(f"Cannot deep copy {type(obj).__name__}")
```

</details>

---

## Task 9: Bytecode Analyzer (Professional)

**Difficulty:** Expert
**Estimated time:** 40 minutes

Write a function that analyzes a Python function's bytecode and reports:
- Number and types of LOAD operations (LOAD_FAST, LOAD_GLOBAL, LOAD_CONST, LOAD_DEREF)
- Variable access patterns (how many times each variable is loaded/stored)
- Potential optimizations (e.g., global access in a loop that could be localized)

```python
import dis
from collections import Counter, defaultdict
from typing import Any


def analyze_bytecode(func) -> dict[str, Any]:
    """Analyze bytecode of a function and return detailed report."""
    # Your code here
    pass


# Tests
GLOBAL_LIST = [1, 2, 3]

def sample_function(x: int, y: int) -> int:
    """Sample function with various access patterns."""
    total = 0
    for i in range(x):
        total += i * y
        if total > 100:
            total = len(GLOBAL_LIST)
    return total


if __name__ == "__main__":
    report = analyze_bytecode(sample_function)
    print("=== Bytecode Analysis ===")
    print(f"Function: {report['name']}")
    print(f"\nLoad operations:")
    for op, count in report["load_counts"].items():
        print(f"  {op}: {count}")
    print(f"\nVariable access frequency:")
    for var, count in report["variable_access"].most_common():
        print(f"  {var}: {count} accesses")
    if report["optimizations"]:
        print(f"\nSuggested optimizations:")
        for opt in report["optimizations"]:
            print(f"  - {opt}")
```

<details>
<summary>Solution</summary>

```python
import dis
from collections import Counter, defaultdict
from typing import Any


def analyze_bytecode(func) -> dict[str, Any]:
    code = func.__code__
    instructions = list(dis.get_instructions(code))

    load_counts = Counter()
    store_counts = Counter()
    variable_access = Counter()
    load_globals_in_loops = []

    in_loop = False
    loop_depth = 0

    for i, instr in enumerate(instructions):
        # Track loop boundaries
        if instr.opname in ("FOR_ITER", "SETUP_LOOP"):
            in_loop = True
            loop_depth += 1
        if instr.opname in ("JUMP_BACKWARD", "JUMP_ABSOLUTE") and loop_depth > 0:
            pass  # Still in loop

        # Count loads
        if instr.opname.startswith("LOAD_"):
            load_counts[instr.opname] += 1
            if instr.argval is not None:
                variable_access[f"{instr.opname}:{instr.argval}"] += 1

            # Detect global access that might be in a loop
            if instr.opname == "LOAD_GLOBAL" and in_loop:
                load_globals_in_loops.append(instr.argval)

        # Count stores
        if instr.opname.startswith("STORE_"):
            store_counts[instr.opname] += 1
            if instr.argval is not None:
                variable_access[f"{instr.opname}:{instr.argval}"] += 1

    # Generate optimization suggestions
    optimizations = []
    for name in set(load_globals_in_loops):
        optimizations.append(
            f"'{name}' is accessed as LOAD_GLOBAL inside a loop. "
            f"Consider assigning to a local variable before the loop for faster access."
        )

    if load_counts.get("LOAD_GLOBAL", 0) > 5:
        optimizations.append(
            "High number of global accesses. Consider localizing frequently used globals."
        )

    return {
        "name": code.co_name,
        "load_counts": dict(load_counts),
        "store_counts": dict(store_counts),
        "variable_access": variable_access,
        "total_instructions": len(instructions),
        "locals": list(code.co_varnames),
        "constants": list(code.co_consts),
        "optimizations": optimizations,
    }
```

</details>

---

## Task 10: Interning Benchmark Suite (Professional)

**Difficulty:** Expert
**Estimated time:** 30 minutes

Create a comprehensive benchmark that measures the performance impact of string interning on dictionary lookups with large datasets.

```python
import sys
import timeit
from typing import Any


def benchmark_interning(n_keys: int = 100_000, n_lookups: int = 1_000_000) -> dict[str, float]:
    """
    Benchmark dict lookups with and without string interning.
    Returns timing results.
    """
    # Your code here
    pass


if __name__ == "__main__":
    results = benchmark_interning()
    print("=== Interning Benchmark ===")
    for label, time_sec in results.items():
        print(f"  {label:40s}: {time_sec:.4f}s")
```

<details>
<summary>Solution</summary>

```python
import sys
import timeit
import random
from typing import Any


def benchmark_interning(n_keys: int = 100_000, n_lookups: int = 1_000_000) -> dict[str, float]:
    results = {}

    # Generate keys
    raw_keys = [f"key_{i}_with_some_extra_text" for i in range(n_keys)]
    interned_keys = [sys.intern(k) for k in raw_keys]

    # Build dicts
    dict_raw = {k: i for i, k in enumerate(raw_keys)}
    dict_interned = {sys.intern(k): i for i, k in enumerate(raw_keys)}

    # Generate lookup keys (non-interned — built dynamically)
    lookup_indices = [random.randint(0, n_keys - 1) for _ in range(n_lookups)]

    # Benchmark 1: Non-interned key lookup
    dynamic_keys = [f"key_{i}_with_some_extra_text" for i in lookup_indices]
    t = timeit.timeit(
        lambda: [dict_raw[k] for k in dynamic_keys],
        number=1,
    )
    results["Non-interned keys, non-interned dict"] = t

    # Benchmark 2: Interned key lookup on non-interned dict
    intern_lookup_keys = [sys.intern(f"key_{i}_with_some_extra_text") for i in lookup_indices]
    t = timeit.timeit(
        lambda: [dict_raw[k] for k in intern_lookup_keys],
        number=1,
    )
    results["Interned keys, non-interned dict"] = t

    # Benchmark 3: Interned key lookup on interned dict
    t = timeit.timeit(
        lambda: [dict_interned[k] for k in intern_lookup_keys],
        number=1,
    )
    results["Interned keys, interned dict"] = t

    # Memory comparison
    raw_mem = sum(sys.getsizeof(k) for k in raw_keys)
    interned_mem = sum(sys.getsizeof(k) for k in interned_keys)
    results["Memory: raw keys (MB)"] = raw_mem / 1024 / 1024
    results["Memory: interned keys (MB)"] = interned_mem / 1024 / 1024

    return results


if __name__ == "__main__":
    results = benchmark_interning()
    print("=== Interning Benchmark ===")
    for label, value in results.items():
        if "Memory" in label:
            print(f"  {label:45s}: {value:.2f}")
        else:
            print(f"  {label:45s}: {value:.4f}s")
```

</details>
