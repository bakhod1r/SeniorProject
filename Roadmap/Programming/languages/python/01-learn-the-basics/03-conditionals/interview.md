# Conditionals — Interview Prep

> **Comprehensive interview preparation for Python conditionals across all levels.**
> Each question includes the expected answer, follow-up questions, and what the interviewer is really testing.

---

## How to Use

1. Read each question and try to answer it **before** looking at the solution
2. Practice explaining answers **out loud** — interviewers evaluate communication skills
3. Pay attention to the **"What they're really testing"** sections
4. Use the difficulty levels to match your target position

### Difficulty Levels

| Level | Target Position | Topics |
|:-----:|:---------------|:-------|
| 🟢 | Junior | Basic if/elif/else, truthy/falsy, comparison operators |
| 🟡 | Middle | Short-circuit, walrus operator, match-case, design patterns |
| 🔴 | Senior | Cyclomatic complexity, refactoring, architecture decisions |
| ⚫ | Professional | CPython bytecode, `__bool__` protocol, compiler optimizations |

---

## Junior Questions 🟢

### Q1: What is the difference between `==` and `is` in Python?

<details>
<summary>Answer</summary>

`==` checks **value equality** — it calls the `__eq__` method and compares whether two objects have the same value.

`is` checks **identity** — it compares whether two variables point to the **same object in memory** (same `id()`).

```python
a = [1, 2, 3]
b = [1, 2, 3]
print(a == b)  # True — same values
print(a is b)  # False — different objects

c = None
print(c is None)  # True — None is a singleton
```

**Best practice:** Use `is` only for `None`, `True`, `False`. Use `==` for everything else.

**What they're really testing:** Understanding of Python's object model and reference semantics.

</details>

**Follow-up:** Why does `a = 256; b = 256; a is b` return `True`, but `a = 257; b = 257; a is b` may return `False`?

<details>
<summary>Follow-up Answer</summary>

CPython caches small integers from -5 to 256 (called the "small integer pool"). These objects are singletons — all variables with the value 256 point to the same object. For 257, CPython creates separate objects, so `is` returns `False` (behavior may vary between REPL and scripts due to compiler optimizations).

</details>

---

### Q2: What are truthy and falsy values in Python? List all falsy values.

<details>
<summary>Answer</summary>

In Python, every object has a boolean value. **Falsy** values evaluate to `False` in a boolean context:

| Falsy Value | Type |
|-------------|------|
| `False` | bool |
| `None` | NoneType |
| `0` | int |
| `0.0` | float |
| `0j` | complex |
| `""` | str (empty) |
| `[]` | list (empty) |
| `()` | tuple (empty) |
| `{}` | dict (empty) |
| `set()` | set (empty) |
| `frozenset()` | frozenset (empty) |
| `range(0)` | range (empty) |
| `b""` | bytes (empty) |
| `bytearray(b"")` | bytearray (empty) |

Everything else is **truthy**.

```python
# Pythonic way to check for empty collections:
items = []
if not items:
    print("List is empty")  # Preferred over: if len(items) == 0
```

**What they're really testing:** Whether you write Pythonic code using truthy/falsy checks instead of explicit comparisons.

</details>

---

### Q3: What does this code print and why?

```python
x = 5
if x > 3:
    print("A")
if x > 4:
    print("B")
if x > 5:
    print("C")
```

<details>
<summary>Answer</summary>

Output:
```
A
B
```

Each `if` is **independent** — they are not connected by `elif`. All three conditions are evaluated separately:
- `5 > 3` is True → prints "A"
- `5 > 4` is True → prints "B"
- `5 > 5` is False → skips "C"

If the intent was mutually exclusive branches, `elif` should be used instead.

**What they're really testing:** Understanding the difference between `if-if-if` (independent) and `if-elif-elif` (mutually exclusive).

</details>

---

### Q4: Write a function that takes a year and returns whether it's a leap year.

<details>
<summary>Answer</summary>

```python
def is_leap_year(year: int) -> bool:
    """
    A year is a leap year if:
    - Divisible by 4 AND
    - NOT divisible by 100, UNLESS also divisible by 400
    """
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


# Test cases
assert is_leap_year(2000) == True   # divisible by 400
assert is_leap_year(1900) == False  # divisible by 100 but not 400
assert is_leap_year(2024) == True   # divisible by 4 but not 100
assert is_leap_year(2023) == False  # not divisible by 4
print("All tests passed!")
```

**What they're really testing:** Ability to translate business rules into clean conditional logic.

</details>

---

### Q5: What is a ternary expression in Python? When should you use it?

<details>
<summary>Answer</summary>

The ternary expression (conditional expression) is a one-line `if-else`:

```python
result = value_if_true if condition else value_if_false
```

Example:
```python
age = 20
status = "adult" if age >= 18 else "minor"
```

**When to use:**
- Simple assignments with two options
- Inside f-strings: `f"{'even' if x % 2 == 0 else 'odd'}"`
- As function arguments: `print("yes" if ok else "no")`

**When NOT to use:**
- Nested ternaries: `a if x else b if y else c` — hard to read
- When the expressions are complex — use full `if-else` instead

**What they're really testing:** Code readability judgment — knowing when concise code helps vs hurts.

</details>

---

## Middle Questions 🟡

### Q6: Explain short-circuit evaluation. How do `and` and `or` actually work in Python?

<details>
<summary>Answer</summary>

Python's `and` and `or` operators don't return `True`/`False` — they return one of their **operands**:

**`and`:** Returns the first falsy value, or the last value if all are truthy.
```python
print(1 and 2 and 3)    # 3 (all truthy, returns last)
print(1 and 0 and 3)    # 0 (first falsy)
print([] and "hello")   # [] (first falsy)
```

**`or`:** Returns the first truthy value, or the last value if all are falsy.
```python
print(0 or "" or 42)    # 42 (first truthy)
print(0 or "" or None)  # None (all falsy, returns last)
```

**Short-circuit:** Evaluation stops as soon as the result is determined:
- `and` stops at the first falsy value
- `or` stops at the first truthy value

```python
# Safe navigation pattern:
user and user.get("name") and user["name"].upper()
# If user is None, the rest is never evaluated
```

**What they're really testing:** Deep understanding of Python's evaluation model and ability to use it for clean code patterns.

</details>

---

### Q7: What is the walrus operator? Give a practical example.

<details>
<summary>Answer</summary>

The walrus operator `:=` (PEP 572, Python 3.8+) assigns a value to a variable **as part of an expression**:

```python
# Without walrus — repeated computation
data = fetch_data()
if data:
    process(data)

# With walrus — assign and test in one step
if data := fetch_data():
    process(data)
```

**Practical examples:**

```python
# 1. While loop with assignment
while chunk := file.read(8192):
    process(chunk)

# 2. List comprehension with reuse
results = [y for x in data if (y := expensive(x)) > threshold]

# 3. Regex matching
import re
if match := re.search(r"\d+", text):
    number = int(match.group())
```

**When NOT to use:**
- Simple assignments: `x := 5` is less readable than `x = 5`
- When it makes the line too complex

**What they're really testing:** Awareness of modern Python features and judgment about readability trade-offs.

</details>

---

### Q8: How would you replace a long if-elif chain with a cleaner pattern?

<details>
<summary>Answer</summary>

Three main approaches:

**1. Dictionary dispatch (for value-to-action mapping):**
```python
# Instead of:
if command == "start":
    start()
elif command == "stop":
    stop()
elif command == "restart":
    restart()

# Use dictionary dispatch:
actions = {"start": start, "stop": stop, "restart": restart}
handler = actions.get(command)
if handler:
    handler()
```

**2. match-case (Python 3.10+, for structural matching):**
```python
match event:
    case {"type": "click", "x": x, "y": y}:
        handle_click(x, y)
    case {"type": "keypress", "key": key}:
        handle_key(key)
```

**3. Strategy pattern (for OOP contexts):**
```python
class PricingStrategy(Protocol):
    def calculate(self, price: float) -> float: ...

strategies: dict[str, PricingStrategy] = {
    "regular": RegularPricing(),
    "premium": PremiumPricing(),
}
```

**What they're really testing:** Software design skills — knowing multiple solutions and choosing the right one.

</details>

---

### Q9: What does this code print?

```python
def f(x=[]):
    if x:
        x.append(len(x))
    else:
        x.append(0)
    return x

print(f())
print(f())
print(f([10]))
print(f())
```

<details>
<summary>Answer</summary>

```
[0]
[0, 1]
[10, 1]
[0, 1, 2]
```

**Explanation:**
- `f()` — first call: `x=[]` (default), falsy, appends 0 → `[0]`
- `f()` — second call: `x=[0]` (same default object!), truthy, appends `len([0])=1` → `[0, 1]`
- `f([10])` — explicit list: truthy, appends `len([10])=1` → `[10, 1]` (separate object)
- `f()` — third call with default: `x=[0, 1]` (still the same default), truthy, appends 2 → `[0, 1, 2]`

The bug is the **mutable default argument** — the list is created once at function definition time and shared across all calls that use the default.

**What they're really testing:** Understanding of mutable default arguments and how conditional logic interacts with them.

</details>

---

### Q10: Explain `match-case` in Python 3.10+. How is it different from a switch statement?

<details>
<summary>Answer</summary>

Python's `match-case` is **structural pattern matching** — much more powerful than a traditional switch:

**1. Value matching (like switch):**
```python
match status:
    case 200:
        return "OK"
    case 404:
        return "Not Found"
```

**2. Structural destructuring (unique to Python):**
```python
match point:
    case (0, 0):
        return "origin"
    case (x, 0):
        return f"x-axis at {x}"
    case (x, y):
        return f"({x}, {y})"
```

**3. Class pattern matching:**
```python
match event:
    case ClickEvent(x=x, y=y):
        handle_click(x, y)
```

**4. Guards (extra conditions):**
```python
match number:
    case n if n < 0:
        return "negative"
```

**Key differences from switch:**
- No fall-through (no `break` needed)
- Supports destructuring and type checking
- Variable capture (names in patterns become variables)
- Wildcard `_` as default case

**What they're really testing:** Knowledge of modern Python and understanding of pattern matching concepts.

</details>

---

## Senior Questions 🔴

### Q11: How would you reduce the cyclomatic complexity of a function with 15+ conditional branches?

<details>
<summary>Answer</summary>

**Step-by-step approach:**

1. **Identify the branching type:**
   - Value-based → dictionary dispatch
   - Type-based → polymorphism / singledispatch
   - Rule-based → rule engine / table-driven design

2. **Apply guard clauses** for validation:
```python
# Before: nested
def process(data):
    if data:
        if data.is_valid:
            if data.has_permission:
                # actual logic at 4 levels deep
                ...

# After: guard clauses
def process(data):
    if not data:
        raise ValueError("No data")
    if not data.is_valid:
        raise ValidationError("Invalid")
    if not data.has_permission:
        raise PermissionError("Denied")
    # actual logic at top level
```

3. **Extract complex conditions** into named functions:
```python
def is_eligible_for_discount(user, cart):
    return user.is_premium and cart.total > 100 and not cart.has_coupon
```

4. **Use the Strategy pattern** for behavior variation:
```python
# Register handlers instead of if-elif
handlers: dict[str, Handler] = {}

def register(event_type):
    def decorator(cls):
        handlers[event_type] = cls()
        return cls
    return decorator

@register("signup")
class SignupHandler: ...
```

**Metrics:** Keep cyclomatic complexity below 10 per function. Use `radon cc -s` to measure.

**What they're really testing:** Architectural thinking and refactoring skills.

</details>

---

### Q12: Design a feature flag system that supports gradual rollout, A/B testing, and kill switches.

<details>
<summary>Answer</summary>

```python
import hashlib
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class FlagState(Enum):
    OFF = "off"
    ON = "on"
    GRADUAL = "gradual"


@dataclass
class FeatureFlag:
    name: str
    state: FlagState = FlagState.OFF
    rollout_pct: int = 0
    allowed_users: set[str] = field(default_factory=set)
    blocked_users: set[str] = field(default_factory=set)

    def is_enabled_for(self, user_id: str, context: Optional[dict] = None) -> bool:
        # Kill switch
        if self.state == FlagState.OFF:
            return False

        # Block list takes priority
        if user_id in self.blocked_users:
            return False

        # Allow list
        if user_id in self.allowed_users:
            return True

        # Full rollout
        if self.state == FlagState.ON:
            return True

        # Gradual rollout (deterministic hash)
        if self.state == FlagState.GRADUAL:
            hash_input = f"{self.name}:{user_id}".encode()
            bucket = int(hashlib.sha256(hash_input).hexdigest(), 16) % 100
            return bucket < self.rollout_pct

        return False


@dataclass
class FlagManager:
    _flags: dict[str, FeatureFlag] = field(default_factory=dict)

    def register(self, flag: FeatureFlag) -> None:
        self._flags[flag.name] = flag

    def is_enabled(self, flag_name: str, user_id: str) -> bool:
        flag = self._flags.get(flag_name)
        if flag is None:
            return False  # Unknown flags are off by default
        return flag.is_enabled_for(user_id)


def main():
    manager = FlagManager()
    manager.register(FeatureFlag(
        name="new_checkout",
        state=FlagState.GRADUAL,
        rollout_pct=25,
        allowed_users={"beta_tester_1"},
        blocked_users={"problem_user"},
    ))

    test_users = [f"user_{i}" for i in range(100)]
    enabled = sum(1 for u in test_users if manager.is_enabled("new_checkout", u))
    print(f"Enabled for ~{enabled}% of users (target: 25%)")
    print(f"Beta tester: {manager.is_enabled('new_checkout', 'beta_tester_1')}")
    print(f"Blocked user: {manager.is_enabled('new_checkout', 'problem_user')}")


if __name__ == "__main__":
    main()
```

**What they're really testing:** System design thinking and handling of complex conditional business logic.

</details>

---

### Q13: What is the problem with this code? How would you fix it?

```python
def get_discount(user_type, amount, is_holiday, has_coupon, is_first_purchase):
    if user_type == "premium" and amount > 100 and is_holiday:
        if has_coupon:
            return 0.30
        return 0.20
    elif user_type == "premium" and amount > 100:
        if has_coupon:
            return 0.25
        return 0.15
    elif user_type == "premium":
        return 0.10
    elif amount > 100 and is_holiday:
        if has_coupon and is_first_purchase:
            return 0.20
        elif has_coupon:
            return 0.15
        return 0.10
    elif amount > 100:
        if has_coupon:
            return 0.10
        return 0.05
    elif is_first_purchase:
        return 0.05
    return 0.0
```

<details>
<summary>Answer</summary>

**Problems:**
1. Cyclomatic complexity is very high (~14 paths)
2. Adding a new user type or condition requires modifying deeply nested logic
3. Testing requires covering all branch combinations
4. Business rules are encoded in code structure, not data

**Fix — table-driven approach:**

```python
from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class DiscountRule:
    name: str
    condition: Callable[..., bool]
    discount: float


def build_rules() -> list[DiscountRule]:
    return [
        DiscountRule("premium_holiday_coupon",
            lambda u, a, h, c, f: u == "premium" and a > 100 and h and c, 0.30),
        DiscountRule("premium_holiday",
            lambda u, a, h, c, f: u == "premium" and a > 100 and h, 0.20),
        DiscountRule("premium_high_coupon",
            lambda u, a, h, c, f: u == "premium" and a > 100 and c, 0.25),
        DiscountRule("premium_high",
            lambda u, a, h, c, f: u == "premium" and a > 100, 0.15),
        DiscountRule("premium_base",
            lambda u, a, h, c, f: u == "premium", 0.10),
        DiscountRule("holiday_first_coupon",
            lambda u, a, h, c, f: a > 100 and h and c and f, 0.20),
        DiscountRule("holiday_coupon",
            lambda u, a, h, c, f: a > 100 and h and c, 0.15),
        DiscountRule("holiday_high",
            lambda u, a, h, c, f: a > 100 and h, 0.10),
        DiscountRule("high_coupon",
            lambda u, a, h, c, f: a > 100 and c, 0.10),
        DiscountRule("high_value",
            lambda u, a, h, c, f: a > 100, 0.05),
        DiscountRule("first_purchase",
            lambda u, a, h, c, f: f, 0.05),
    ]

RULES = build_rules()

def get_discount(user_type, amount, is_holiday, has_coupon, is_first_purchase):
    for rule in RULES:
        if rule.condition(user_type, amount, is_holiday, has_coupon, is_first_purchase):
            return rule.discount
    return 0.0
```

**Benefits:** Rules are data, easily tested individually, and new rules can be added without modifying logic.

**What they're really testing:** Refactoring skills and ability to identify code smells.

</details>

---

## Professional Questions ⚫

### Q14: What bytecode does CPython generate for `a and b`? How does short-circuit work at the bytecode level?

<details>
<summary>Answer</summary>

```python
import dis

def and_expr(a, b):
    return a and b

dis.dis(and_expr)
```

Bytecode:
```
  LOAD_FAST    a
  COPY         1        # duplicate 'a' on the stack
  POP_JUMP_IF_FALSE  L1  # if 'a' is falsy, jump to L1
  POP_TOP              # discard the copy of 'a'
  LOAD_FAST    b       # load 'b'
L1:
  RETURN_VALUE          # return whatever is on top of stack
```

**How it works:**
1. Load `a` and make a copy
2. If `a` is falsy → jump to return (returns `a`)
3. If `a` is truthy → discard the copy, load `b`, return `b`

The key insight is that `and` returns an **operand**, not a boolean. The `POP_JUMP_IF_FALSE` instruction internally calls `PyObject_IsTrue()`.

**What they're really testing:** Understanding of CPython internals and ability to reason at the bytecode level.

</details>

---

### Q15: How does CPython implement `PyObject_IsTrue()`? What is the lookup order?

<details>
<summary>Answer</summary>

`PyObject_IsTrue()` in `Objects/object.c` follows this order:

1. **Identity check with `Py_True`** → return 1 (fastest path)
2. **Identity check with `Py_False`** → return 0
3. **Identity check with `Py_None`** → return 0
4. **`nb_bool` (C slot for `__bool__`)** → call and return result
5. **`mp_length` (C slot for `__len__`)** → return 0 if length is 0, else 1
6. **Default** → return 1 (object is truthy)

```c
// Simplified from CPython source
int PyObject_IsTrue(PyObject *v) {
    if (v == Py_True) return 1;
    if (v == Py_False) return 0;
    if (v == Py_None) return 0;

    if (Py_TYPE(v)->tp_as_number && Py_TYPE(v)->tp_as_number->nb_bool) {
        return (*Py_TYPE(v)->tp_as_number->nb_bool)(v);
    }

    if (Py_TYPE(v)->tp_as_mapping && Py_TYPE(v)->tp_as_mapping->mp_length) {
        Py_ssize_t len = (*Py_TYPE(v)->tp_as_mapping->mp_length)(v);
        return len != 0;
    }

    return 1;  // default truthy
}
```

**Important detail:** `__bool__` takes priority over `__len__`. If both are defined, only `__bool__` is called.

**What they're really testing:** CPython source code familiarity and understanding of the object protocol.

</details>

---

### Q16: Why can't `match-case` use a simple hash table for string patterns?

<details>
<summary>Answer</summary>

Because the subject being matched could have a **custom `__eq__`** method that doesn't follow hash semantics. Pattern matching in Python uses `==` comparison, which:

1. May not be consistent with `__hash__` (objects can define `__eq__` without `__hash__`)
2. May have side effects
3. May return non-boolean values (though this would be unusual)

Additionally:
- **Capture patterns** (`case x:`) bind the subject to a new variable — they always match
- **OR patterns** (`case "a" | "b":`) need sequential evaluation
- **Guards** (`case x if x > 0:`) require runtime evaluation
- **Class patterns** need `isinstance` checks plus attribute access

CPython compiles `match-case` to sequential `COMPARE_OP ==` checks, similar to `if-elif`. The compiler does not attempt to build a jump table or hash table.

**Future optimization:** The compiler could theoretically detect pure-literal patterns and generate a hash lookup, but this is not implemented as of CPython 3.12.

**What they're really testing:** Understanding of language design trade-offs and compiler implementation constraints.

</details>

---

## Coding Challenges

### Challenge 1: FizzBuzz Without if-elif-else 🟡

Write FizzBuzz (1-100) without using `if`, `elif`, or `else`.

<details>
<summary>Solution</summary>

```python
# Solution 1: Dictionary mapping
def fizzbuzz_dict():
    for i in range(1, 101):
        output = {
            (True, True): "FizzBuzz",
            (True, False): "Fizz",
            (False, True): "Buzz",
            (False, False): str(i),
        }[(i % 3 == 0, i % 5 == 0)]
        print(output)


# Solution 2: Short-circuit with or
def fizzbuzz_or():
    for i in range(1, 101):
        print(
            "Fizz" * (i % 3 == 0) + "Buzz" * (i % 5 == 0)
            or str(i)
        )


# Solution 3: match-case (Python 3.10+)
def fizzbuzz_match():
    for i in range(1, 101):
        match (i % 3, i % 5):
            case (0, 0): print("FizzBuzz")
            case (0, _): print("Fizz")
            case (_, 0): print("Buzz")
            case _: print(i)


if __name__ == "__main__":
    fizzbuzz_or()
```

</details>

---

### Challenge 2: Implement a Type-Safe Configuration Parser 🔴

Parse configuration values with type validation, defaults, and error messages — all using clean conditional patterns.

<details>
<summary>Solution</summary>

```python
from typing import Any, TypeVar, Type, Optional, get_type_hints
from dataclasses import dataclass, fields

T = TypeVar("T")


class ConfigError(Exception):
    def __init__(self, field_name: str, message: str):
        super().__init__(f"Config error for '{field_name}': {message}")
        self.field_name = field_name


@dataclass
class AppConfig:
    host: str = "localhost"
    port: int = 8080
    debug: bool = False
    workers: int = 4
    log_level: str = "INFO"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AppConfig":
        hints = get_type_hints(cls)
        defaults = {f.name: f.default for f in fields(cls)}
        kwargs = {}

        for field_name, field_type in hints.items():
            raw_value = data.get(field_name)

            match (raw_value, field_type):
                case (None, _):
                    kwargs[field_name] = defaults[field_name]
                case (str() as v, t) if t is int:
                    try:
                        kwargs[field_name] = int(v)
                    except ValueError:
                        raise ConfigError(field_name, f"Cannot convert '{v}' to int")
                case (str() as v, t) if t is bool:
                    kwargs[field_name] = v.lower() in ("true", "1", "yes")
                case (v, t) if isinstance(v, t):
                    kwargs[field_name] = v
                case (v, t):
                    raise ConfigError(field_name, f"Expected {t.__name__}, got {type(v).__name__}")

        return cls(**kwargs)


def main():
    # From environment-like dict (all strings)
    config = AppConfig.from_dict({
        "host": "0.0.0.0",
        "port": "9090",
        "debug": "true",
        "workers": "8",
    })
    print(f"Host: {config.host}")
    print(f"Port: {config.port} (type: {type(config.port).__name__})")
    print(f"Debug: {config.debug}")
    print(f"Workers: {config.workers}")
    print(f"Log level: {config.log_level} (default)")

    # Error handling
    try:
        AppConfig.from_dict({"port": "not_a_number"})
    except ConfigError as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    main()
```

</details>

---

### Challenge 3: Implement Exhaustive Enum Handling ⚫

Write a decorator that ensures all enum values are handled in a function's match-case or dictionary dispatch.

<details>
<summary>Solution</summary>

```python
from enum import Enum
from typing import Callable, TypeVar
from functools import wraps
import inspect

T = TypeVar("T")


class ExhaustivenessError(Exception):
    """Raised when not all enum values are handled."""
    pass


def exhaustive_enum_check(enum_class: type[Enum]):
    """Decorator that verifies all enum values are handled at definition time."""
    def decorator(func: Callable) -> Callable:
        # Inspect the function source for enum member references
        source = inspect.getsource(func)
        missing = []
        for member in enum_class:
            # Check if the member is referenced (simple heuristic)
            if member.name not in source and f'"{member.value}"' not in source:
                missing.append(member)

        if missing:
            raise ExhaustivenessError(
                f"Function '{func.__name__}' does not handle: "
                f"{[m.name for m in missing]}"
            )

        @wraps(func)
        def wrapper(*args, **kwargs):
            return func(*args, **kwargs)
        return wrapper
    return decorator


class HttpMethod(Enum):
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    DELETE = "DELETE"
    PATCH = "PATCH"


@exhaustive_enum_check(HttpMethod)
def handle_request(method: HttpMethod) -> str:
    match method:
        case HttpMethod.GET:
            return "Reading resource"
        case HttpMethod.POST:
            return "Creating resource"
        case HttpMethod.PUT:
            return "Updating resource"
        case HttpMethod.DELETE:
            return "Deleting resource"
        case HttpMethod.PATCH:
            return "Patching resource"


def main():
    for method in HttpMethod:
        print(f"{method.value}: {handle_request(method)}")

    # This would fail at definition time:
    # @exhaustive_enum_check(HttpMethod)
    # def bad_handler(method: HttpMethod) -> str:
    #     match method:
    #         case HttpMethod.GET: return "get"
    #         # Missing POST, PUT, DELETE, PATCH!


if __name__ == "__main__":
    main()
```

</details>

---

## Behavioral Questions

### Q17: "Tell me about a time you refactored complex conditional logic."

<details>
<summary>Framework for answering</summary>

Use the **STAR method:**

**Situation:** "We had a pricing module with 200+ lines of nested if-elif logic handling 15 different customer tiers, promotional rules, and geographic pricing."

**Task:** "Adding a new promotional rule required touching 5+ branches and took 3 days including testing. Bug rate was high — 2-3 pricing bugs per sprint."

**Action:** "I refactored to a table-driven rule engine:
1. Extracted each pricing rule into a dataclass with `condition` and `result` fields
2. Rules were stored in a priority-ordered list
3. Added comprehensive tests for each rule independently
4. Created an admin interface to add/modify rules without code changes"

**Result:** "New rules could be added in 30 minutes. Bug rate dropped to near-zero. The system handled 50+ rules cleanly. Code review time for pricing changes went from 2 hours to 15 minutes."

</details>

---

## Quick Reference: What Interviewers Look For

| Level | They Want to See | Red Flags |
|:-----:|:----------------|:----------|
| 🟢 Junior | Correct syntax, understanding of truthy/falsy | Using `==` to check `None`, deep nesting |
| 🟡 Middle | Clean patterns, walrus operator, match-case awareness | Overusing `elif`, not knowing short-circuit behavior |
| 🔴 Senior | Architecture decisions, complexity awareness, refactoring skills | No mention of testing, ignoring cyclomatic complexity |
| ⚫ Professional | Bytecode knowledge, CPython internals, performance reasoning | Premature optimization, inability to explain trade-offs |
