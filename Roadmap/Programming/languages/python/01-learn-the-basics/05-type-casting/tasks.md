# Python Type Casting -- Practice Tasks

---

## Junior Tasks (4)

### Task 1: Temperature Converter

Write a function that reads a temperature as a string (e.g., `"98.6F"` or `"37C"`) and converts it to the other unit. Return the result as a formatted string.

**Input:** `"100C"` -> **Output:** `"212.0F"`
**Input:** `"32F"` -> **Output:** `"0.0C"`

<details>
<summary>Hint</summary>
Extract the last character for the unit, convert the rest to <code>float</code>, apply the formula.
</details>

<details>
<summary>Solution</summary>

```python
def convert_temperature(temp_str: str) -> str:
    """Convert temperature string between Celsius and Fahrenheit."""
    temp_str = temp_str.strip()
    unit = temp_str[-1].upper()
    value = float(temp_str[:-1])

    if unit == 'C':
        fahrenheit = value * 9 / 5 + 32
        return f"{fahrenheit:.1f}F"
    elif unit == 'F':
        celsius = (value - 32) * 5 / 9
        return f"{celsius:.1f}C"
    else:
        raise ValueError(f"Unknown unit: {unit}")


# Tests
assert convert_temperature("100C") == "212.0F"
assert convert_temperature("32F") == "0.0C"
assert convert_temperature("0C") == "32.0F"
assert convert_temperature("212F") == "100.0C"
assert convert_temperature("-40C") == "-40.0F"
assert convert_temperature("-40F") == "-40.0C"
print("All tests passed!")
```
</details>

---

### Task 2: Safe Calculator

Write a function that takes two string inputs and an operator string, converts them to numbers, and returns the result. Handle division by zero and invalid inputs.

**Input:** `"10"`, `"3"`, `"/"` -> **Output:** `3.3333333333333335`
**Input:** `"abc"`, `"3"`, `"+"` -> **Output:** `"Error: invalid input"`

<details>
<summary>Hint</summary>
Use <code>try/except</code> to catch <code>ValueError</code> during conversion and <code>ZeroDivisionError</code> for division.
</details>

<details>
<summary>Solution</summary>

```python
def safe_calc(a_str: str, b_str: str, op: str) -> float | str:
    """Perform arithmetic on string inputs with error handling."""
    try:
        a = float(a_str)
        b = float(b_str)
    except ValueError:
        return "Error: invalid input"

    ops = {
        '+': lambda x, y: x + y,
        '-': lambda x, y: x - y,
        '*': lambda x, y: x * y,
        '/': lambda x, y: x / y,
    }

    if op not in ops:
        return f"Error: unknown operator '{op}'"

    try:
        result = ops[op](a, b)
        # Return int if result is whole number
        return int(result) if result == int(result) else result
    except ZeroDivisionError:
        return "Error: division by zero"


# Tests
assert safe_calc("10", "3", "+") == 13
assert abs(safe_calc("10", "3", "/") - 3.333333) < 0.001
assert safe_calc("10", "0", "/") == "Error: division by zero"
assert safe_calc("abc", "3", "+") == "Error: invalid input"
assert safe_calc("10", "3", "^") == "Error: unknown operator '^'"
print("All tests passed!")
```
</details>

---

### Task 3: Number Base Converter

Write a function that converts a number from one base to another. Accept input as a string with the source base, and return a string in the target base.

**Input:** `"FF"`, base_from=16, base_to=2 -> **Output:** `"11111111"`
**Input:** `"1010"`, base_from=2, base_to=10 -> **Output:** `"10"`

<details>
<summary>Hint</summary>
Use <code>int(string, base)</code> to convert to decimal first, then use <code>bin()</code>, <code>hex()</code>, or <code>oct()</code>.
</details>

<details>
<summary>Solution</summary>

```python
def convert_base(value: str, base_from: int, base_to: int) -> str:
    """Convert a number string from one base to another."""
    # Convert to decimal (int)
    decimal_value = int(value, base_from)

    # Convert from decimal to target base
    if base_to == 2:
        return bin(decimal_value)[2:]  # Remove '0b' prefix
    elif base_to == 8:
        return oct(decimal_value)[2:]  # Remove '0o' prefix
    elif base_to == 10:
        return str(decimal_value)
    elif base_to == 16:
        return hex(decimal_value)[2:]  # Remove '0x' prefix
    else:
        # General base conversion
        if decimal_value == 0:
            return '0'
        digits = '0123456789abcdefghijklmnopqrstuvwxyz'
        result = []
        n = decimal_value
        while n > 0:
            result.append(digits[n % base_to])
            n //= base_to
        return ''.join(reversed(result))


# Tests
assert convert_base("FF", 16, 2) == "11111111"
assert convert_base("1010", 2, 10) == "10"
assert convert_base("255", 10, 16) == "ff"
assert convert_base("77", 8, 10) == "63"
assert convert_base("42", 10, 2) == "101010"
assert convert_base("100", 10, 36) == "2s"
print("All tests passed!")
```
</details>

---

### Task 4: Deduplicate and Sort

Write a function that takes a list of strings representing numbers, converts them to integers, removes duplicates, and returns a sorted list.

**Input:** `["3", "1", "2", "3", "1", "4"]` -> **Output:** `[1, 2, 3, 4]`

<details>
<summary>Hint</summary>
Use <code>map(int, ...)</code> then convert to <code>set</code> and back to <code>list</code>.
</details>

<details>
<summary>Solution</summary>

```python
def dedupe_sort(items: list[str]) -> list[int]:
    """Convert string list to sorted unique integers."""
    return sorted(set(map(int, items)))


# Alternative with error handling
def dedupe_sort_safe(items: list[str]) -> list[int]:
    """Convert string list to sorted unique integers, skipping invalid."""
    result = set()
    for item in items:
        try:
            result.add(int(item))
        except ValueError:
            continue
    return sorted(result)


# Tests
assert dedupe_sort(["3", "1", "2", "3", "1", "4"]) == [1, 2, 3, 4]
assert dedupe_sort(["10", "5", "10", "20", "5"]) == [5, 10, 20]
assert dedupe_sort(["1"]) == [1]
assert dedupe_sort_safe(["1", "bad", "2", "3"]) == [1, 2, 3]
print("All tests passed!")
```
</details>

---

## Middle Tasks (4)

### Task 5: CSV Row Parser

Write a function that takes a CSV header row and a data row (both as strings), and returns a dictionary with values cast to appropriate types (int, float, bool, or str).

**Input:** Header: `"name,age,score,active"`, Row: `"Alice,30,95.5,true"`
**Output:** `{"name": "Alice", "age": 30, "score": 95.5, "active": True}`

<details>
<summary>Hint</summary>
Try casting each value to <code>int</code>, then <code>float</code>, then <code>bool</code>, falling back to <code>str</code>.
</details>

<details>
<summary>Solution</summary>

```python
def smart_cast(value: str):
    """Cast a string to the most appropriate Python type."""
    value = value.strip()

    # Try bool
    if value.lower() in ('true', 'false'):
        return value.lower() == 'true'

    # Try int
    try:
        return int(value)
    except ValueError:
        pass

    # Try float
    try:
        return float(value)
    except ValueError:
        pass

    # Fallback to string
    return value


def parse_csv_row(header: str, row: str) -> dict:
    """Parse a CSV row into a typed dictionary."""
    keys = [k.strip() for k in header.split(',')]
    values = [smart_cast(v) for v in row.split(',')]
    return dict(zip(keys, values))


# Tests
result = parse_csv_row("name,age,score,active", "Alice,30,95.5,true")
assert result == {"name": "Alice", "age": 30, "score": 95.5, "active": True}
assert type(result["age"]) is int
assert type(result["score"]) is float
assert type(result["active"]) is bool

result2 = parse_csv_row("id,value,label", "1,3.14,hello")
assert result2 == {"id": 1, "value": 3.14, "label": "hello"}
print("All tests passed!")
```
</details>

---

### Task 6: Custom Money Class

Create a `Money` class that supports `int()`, `float()`, `str()`, `bool()`, and arithmetic with both `Money` and `int/float` operands.

<details>
<summary>Hint</summary>
Implement <code>__int__</code>, <code>__float__</code>, <code>__str__</code>, <code>__bool__</code>, <code>__add__</code>, <code>__radd__</code>.
</details>

<details>
<summary>Solution</summary>

```python
from __future__ import annotations


class Money:
    def __init__(self, amount: float | int | str, currency: str = "USD"):
        if isinstance(amount, str):
            amount = float(amount)
        self.amount = round(float(amount), 2)
        self.currency = currency

    def __int__(self) -> int:
        return int(self.amount)

    def __float__(self) -> float:
        return self.amount

    def __str__(self) -> str:
        return f"{self.currency} {self.amount:,.2f}"

    def __repr__(self) -> str:
        return f"Money({self.amount}, '{self.currency}')"

    def __bool__(self) -> bool:
        return self.amount != 0.0

    def __add__(self, other) -> Money:
        if isinstance(other, Money):
            if self.currency != other.currency:
                raise ValueError(f"Cannot add {self.currency} and {other.currency}")
            return Money(self.amount + other.amount, self.currency)
        if isinstance(other, (int, float)):
            return Money(self.amount + other, self.currency)
        return NotImplemented

    def __radd__(self, other) -> Money:
        return self.__add__(other)

    def __mul__(self, other) -> Money:
        if isinstance(other, (int, float)):
            return Money(self.amount * other, self.currency)
        return NotImplemented

    def __rmul__(self, other) -> Money:
        return self.__mul__(other)

    def __eq__(self, other) -> bool:
        if isinstance(other, Money):
            return self.amount == other.amount and self.currency == other.currency
        return NotImplemented

    def __hash__(self):
        return hash((self.amount, self.currency))


# Tests
m1 = Money(100.50)
m2 = Money("200.75")

assert int(m1) == 100
assert float(m1) == 100.50
assert str(m1) == "USD 100.50"
assert bool(m1) is True
assert bool(Money(0)) is False

m3 = m1 + m2
assert float(m3) == 301.25

m4 = m1 + 50
assert float(m4) == 150.50

m5 = 50 + m1  # __radd__
assert float(m5) == 150.50

m6 = m1 * 3
assert float(m6) == 301.50

print("All tests passed!")
```
</details>

---

### Task 7: Batch Type Converter with Error Report

Write a function that converts a list of dictionaries (all string values) according to a schema, and returns both the converted data and an error report.

<details>
<summary>Hint</summary>
Process each field according to the schema, catch exceptions, and collect errors separately.
</details>

<details>
<summary>Solution</summary>

```python
from typing import Any, Dict, List, Tuple


def batch_convert(
    records: List[Dict[str, str]],
    schema: Dict[str, type]
) -> Tuple[List[Dict[str, Any]], List[Dict[str, str]]]:
    """Convert records according to schema, returning (results, errors)."""
    results = []
    errors = []

    for i, record in enumerate(records):
        converted = {}
        for field, target_type in schema.items():
            raw = record.get(field, "")
            try:
                if target_type is bool:
                    converted[field] = raw.lower() in ('true', 'yes', '1')
                else:
                    converted[field] = target_type(raw)
            except (ValueError, TypeError) as e:
                errors.append({
                    "row": i,
                    "field": field,
                    "value": raw,
                    "error": str(e),
                })
                converted[field] = None
        results.append(converted)

    return results, errors


# Test
records = [
    {"name": "Alice", "age": "30", "salary": "75000.50", "active": "true"},
    {"name": "Bob", "age": "bad", "salary": "60000", "active": "false"},
    {"name": "Charlie", "age": "25", "salary": "", "active": "yes"},
]

schema = {"name": str, "age": int, "salary": float, "active": bool}
results, errors = batch_convert(records, schema)

print("Results:")
for r in results:
    print(f"  {r}")
print(f"\nErrors ({len(errors)}):")
for e in errors:
    print(f"  Row {e['row']}, field '{e['field']}': {e['error']}")

assert results[0]["age"] == 30
assert results[0]["active"] is True
assert results[1]["age"] is None  # Failed conversion
assert len(errors) == 2  # 'bad' and ''
print("All tests passed!")
```
</details>

---

### Task 8: ASCII Art Table

Write a function that takes a list of strings and displays their characters with their `ord()` values in a formatted table.

**Input:** `"AB"`
**Output:**
```
Char | Dec | Hex  | Oct  | Bin
A    |  65 | 0x41 | 0o101| 0b1000001
B    |  66 | 0x42 | 0o102| 0b1000010
```

<details>
<summary>Hint</summary>
Use <code>ord()</code>, <code>hex()</code>, <code>oct()</code>, <code>bin()</code> for each character.
</details>

<details>
<summary>Solution</summary>

```python
def char_table(text: str) -> str:
    """Create a table of character codes for each character in text."""
    header = f"{'Char':<6}| {'Dec':>5} | {'Hex':<6}| {'Oct':<6}| {'Bin':<10}"
    separator = "-" * len(header)
    lines = [header, separator]

    for ch in text:
        code = ord(ch)
        display_ch = ch if ch.isprintable() else f"\\x{code:02x}"
        lines.append(
            f"{display_ch:<6}| {code:>5} | {hex(code):<6}| {oct(code):<6}| {bin(code):<10}"
        )

    return "\n".join(lines)


# Test
print(char_table("Hello!"))
print()
print(char_table("0123"))
print()
print(char_table("ABC abc"))
```
</details>

---

## Senior Tasks (3)

### Task 9: Type-Safe Data Pipeline

Build a data pipeline class that:
1. Accepts a schema definition
2. Processes records through validation, coercion, and transformation stages
3. Supports custom converters
4. Produces typed output with error tracking

<details>
<summary>Solution</summary>

```python
from typing import Any, Callable, Dict, List, Optional, Type
from dataclasses import dataclass, field


@dataclass
class FieldSpec:
    target_type: Type
    required: bool = True
    default: Any = None
    validator: Optional[Callable[[Any], bool]] = None
    transformer: Optional[Callable[[Any], Any]] = None


@dataclass
class PipelineResult:
    records: List[Dict[str, Any]] = field(default_factory=list)
    errors: List[Dict[str, Any]] = field(default_factory=list)
    stats: Dict[str, int] = field(default_factory=lambda: {
        "total": 0, "success": 0, "failed": 0, "fields_coerced": 0
    })


class TypeSafePipeline:
    def __init__(self, schema: Dict[str, FieldSpec]):
        self.schema = schema
        self._custom_converters: Dict[type, Callable] = {}

    def register_converter(self, target_type: type, converter: Callable):
        self._custom_converters[target_type] = converter

    def _coerce(self, value: str, spec: FieldSpec) -> Any:
        if spec.target_type in self._custom_converters:
            return self._custom_converters[spec.target_type](value)
        if spec.target_type is bool:
            return value.lower() in ('true', 'yes', '1', 'on')
        return spec.target_type(value)

    def process(self, records: List[Dict[str, str]]) -> PipelineResult:
        result = PipelineResult()

        for i, record in enumerate(records):
            result.stats["total"] += 1
            converted = {}
            row_errors = []

            for field_name, spec in self.schema.items():
                raw = record.get(field_name, "")

                # Check required
                if not raw and spec.required:
                    row_errors.append({"field": field_name, "error": "required field is empty"})
                    converted[field_name] = spec.default
                    continue

                if not raw:
                    converted[field_name] = spec.default
                    continue

                # Coerce
                try:
                    value = self._coerce(raw, spec)
                    result.stats["fields_coerced"] += 1
                except (ValueError, TypeError) as e:
                    row_errors.append({"field": field_name, "error": str(e)})
                    converted[field_name] = spec.default
                    continue

                # Validate
                if spec.validator and not spec.validator(value):
                    row_errors.append({"field": field_name, "error": f"validation failed for {value}"})
                    converted[field_name] = spec.default
                    continue

                # Transform
                if spec.transformer:
                    value = spec.transformer(value)

                converted[field_name] = value

            if row_errors:
                result.stats["failed"] += 1
                result.errors.append({"row": i, "errors": row_errors})
            else:
                result.stats["success"] += 1

            result.records.append(converted)

        return result


# Test
schema = {
    "name": FieldSpec(str, transformer=lambda s: s.strip().title()),
    "age": FieldSpec(int, validator=lambda x: 0 < x < 150),
    "salary": FieldSpec(float, required=False, default=0.0),
    "active": FieldSpec(bool, default=False),
}

pipeline = TypeSafePipeline(schema)

records = [
    {"name": "  alice smith  ", "age": "30", "salary": "75000", "active": "true"},
    {"name": "bob", "age": "200", "salary": "60000", "active": "false"},
    {"name": "charlie", "age": "bad", "salary": "", "active": "yes"},
]

result = pipeline.process(records)
print("Records:")
for r in result.records:
    print(f"  {r}")
print(f"\nErrors: {result.errors}")
print(f"Stats: {result.stats}")
```
</details>

---

### Task 10: Hex Color Parser

Write a class `Color` that can be created from hex strings, RGB tuples, or CSS color names. It should support `int()`, `str()`, `tuple()` conversions.

<details>
<summary>Solution</summary>

```python
from __future__ import annotations


class Color:
    CSS_COLORS = {
        "red": (255, 0, 0), "green": (0, 128, 0), "blue": (0, 0, 255),
        "white": (255, 255, 255), "black": (0, 0, 0), "yellow": (255, 255, 0),
    }

    def __init__(self, r: int = 0, g: int = 0, b: int = 0):
        self.r = max(0, min(255, int(r)))
        self.g = max(0, min(255, int(g)))
        self.b = max(0, min(255, int(b)))

    @classmethod
    def from_hex(cls, hex_str: str) -> Color:
        hex_str = hex_str.lstrip('#')
        if len(hex_str) == 3:
            hex_str = ''.join(c * 2 for c in hex_str)
        return cls(
            int(hex_str[0:2], 16),
            int(hex_str[2:4], 16),
            int(hex_str[4:6], 16),
        )

    @classmethod
    def from_name(cls, name: str) -> Color:
        name = name.lower().strip()
        if name not in cls.CSS_COLORS:
            raise ValueError(f"Unknown color: {name}")
        r, g, b = cls.CSS_COLORS[name]
        return cls(r, g, b)

    def __int__(self) -> int:
        """Convert to 24-bit integer (0xRRGGBB)."""
        return (self.r << 16) | (self.g << 8) | self.b

    def __str__(self) -> str:
        return f"#{self.r:02x}{self.g:02x}{self.b:02x}"

    def __repr__(self) -> str:
        return f"Color({self.r}, {self.g}, {self.b})"

    def __iter__(self):
        """Support tuple(color) conversion."""
        yield self.r
        yield self.g
        yield self.b

    def __bool__(self) -> bool:
        return not (self.r == 0 and self.g == 0 and self.b == 0)

    def __eq__(self, other):
        if isinstance(other, Color):
            return (self.r, self.g, self.b) == (other.r, other.g, other.b)
        return NotImplemented

    def __hash__(self):
        return hash((self.r, self.g, self.b))


# Tests
c1 = Color.from_hex("#FF5733")
assert str(c1) == "#ff5733"
assert int(c1) == 0xFF5733
assert tuple(c1) == (255, 87, 51)
assert bool(c1) is True

c2 = Color.from_name("red")
assert tuple(c2) == (255, 0, 0)
assert str(c2) == "#ff0000"

c3 = Color.from_hex("#000")
assert bool(c3) is False

c4 = Color.from_hex("abc")
assert tuple(c4) == (170, 187, 204)

print("All tests passed!")
```
</details>

---

### Task 11: Protocol-Based Serializer

Build a serializer that uses `typing.Protocol` to detect what conversions an object supports and serialize it accordingly.

<details>
<summary>Solution</summary>

```python
from typing import Protocol, runtime_checkable, Any, Dict
import json


@runtime_checkable
class SupportsInt(Protocol):
    def __int__(self) -> int: ...

@runtime_checkable
class SupportsFloat(Protocol):
    def __float__(self) -> float: ...

@runtime_checkable
class SupportsStr(Protocol):
    def __str__(self) -> str: ...

@runtime_checkable
class SupportsIter(Protocol):
    def __iter__(self): ...


def smart_serialize(obj: Any) -> Any:
    """Serialize an object based on what protocols it supports."""
    # Primitives
    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj

    # Dict
    if isinstance(obj, dict):
        return {str(k): smart_serialize(v) for k, v in obj.items()}

    # Has __iter__ (list, tuple, set, generators)
    if isinstance(obj, SupportsIter) and not isinstance(obj, (str, bytes)):
        return [smart_serialize(item) for item in obj]

    # Custom objects: try protocols in order
    if isinstance(obj, SupportsFloat) and not isinstance(obj, SupportsInt):
        return float(obj)

    if isinstance(obj, SupportsInt):
        return int(obj)

    # Fallback to str
    return str(obj)


# Test with custom classes
class Temperature:
    def __init__(self, celsius):
        self.celsius = celsius
    def __float__(self):
        return float(self.celsius)
    def __str__(self):
        return f"{self.celsius}C"

class Counter:
    def __init__(self, count):
        self.count = count
    def __int__(self):
        return self.count

data = {
    "temp": Temperature(36.6),
    "count": Counter(42),
    "items": [1, "hello", Temperature(100)],
    "nested": {"key": Counter(7)},
}

serialized = smart_serialize(data)
json_str = json.dumps(serialized, indent=2)
print(json_str)

assert serialized["temp"] == 36.6
assert serialized["count"] == 42
assert serialized["items"][2] == 100.0
assert serialized["nested"]["key"] == 7
print("All tests passed!")
```
</details>

---

## Professional Task (1)

### Task 12: Bytecode-Optimized Type Casting

Analyze and benchmark different approaches to bulk type casting. Use `dis` to explain why some are faster.

<details>
<summary>Solution</summary>

```python
import dis
import timeit
import sys


def approach_1_comprehension(data: list[str]) -> list[int]:
    """List comprehension."""
    return [int(x) for x in data]


def approach_2_map(data: list[str]) -> list[int]:
    """map() function."""
    return list(map(int, data))


def approach_3_loop(data: list[str]) -> list[int]:
    """Explicit for loop with append."""
    result = []
    for x in data:
        result.append(int(x))
    return result


def approach_4_loop_local(data: list[str]) -> list[int]:
    """For loop with localized built-ins."""
    result = []
    _int = int           # Local reference to int
    _append = result.append  # Local reference to append
    for x in data:
        _append(_int(x))
    return result


# Show bytecode differences
print("=== Comprehension ===")
dis.dis(approach_1_comprehension)
print("\n=== map() ===")
dis.dis(approach_2_map)
print("\n=== Loop ===")
dis.dis(approach_3_loop)
print("\n=== Loop with locals ===")
dis.dis(approach_4_loop_local)

# Benchmark
data = [str(i) for i in range(200_000)]

print("\n=== Benchmarks ===")
for name, func in [
    ("Comprehension", approach_1_comprehension),
    ("map(int, ...)", approach_2_map),
    ("For loop", approach_3_loop),
    ("Loop + locals", approach_4_loop_local),
]:
    t = timeit.timeit(lambda: func(data), number=20)
    print(f"{name:<20s}: {t:.3f}s")

# Try numpy if available
try:
    import numpy as np
    t_np = timeit.timeit(lambda: np.array(data, dtype=np.int64), number=20)
    print(f"{'NumPy':<20s}: {t_np:.3f}s")
except ImportError:
    pass

print("\n=== Memory comparison ===")
result_list = approach_1_comprehension(data)
print(f"list[int] size: {sys.getsizeof(result_list):,} bytes "
      f"+ {sum(sys.getsizeof(x) for x in result_list[:100]) * len(result_list) // 100:,} bytes for objects")

try:
    import array
    result_array = array.array('l', result_list)
    print(f"array.array size: {sys.getsizeof(result_array):,} bytes (no per-object overhead)")
except Exception:
    pass
```
</details>
