# Conditionals — Practice Tasks

> **Hands-on coding tasks to master Python conditionals.**
> Each task has a clear objective, starter code, and a detailed solution.

---

## How to Use

1. Read the task description carefully
2. Try to solve it **without** looking at the solution
3. Test your solution with the provided test cases
4. Compare with the reference solution and learn alternative approaches

### Difficulty Levels

| Level | Description |
|:-----:|:-----------|
| 🟢 | **Easy** — Basic if/elif/else, simple comparisons |
| 🟡 | **Medium** — Nested conditions, logical operators, ternary |
| 🔴 | **Hard** — match-case, walrus operator, design patterns |

---

## Task 1: Age Group Classifier 🟢

**Objective:** Write a function that classifies a person's age into groups.

**Requirements:**
- 0-2: "infant"
- 3-12: "child"
- 13-17: "teenager"
- 18-64: "adult"
- 65+: "senior"
- Negative ages should raise `ValueError`

```python
def classify_age(age: int) -> str:
    """Classify age into a group."""
    # YOUR CODE HERE
    pass


# Test cases
assert classify_age(0) == "infant"
assert classify_age(2) == "infant"
assert classify_age(3) == "child"
assert classify_age(12) == "child"
assert classify_age(13) == "teenager"
assert classify_age(17) == "teenager"
assert classify_age(18) == "adult"
assert classify_age(64) == "adult"
assert classify_age(65) == "senior"
assert classify_age(100) == "senior"

try:
    classify_age(-1)
    assert False, "Should have raised ValueError"
except ValueError:
    pass

print("All tests passed!")
```

<details>
<summary>Solution</summary>

```python
def classify_age(age: int) -> str:
    """Classify age into a group."""
    if age < 0:
        raise ValueError(f"Age cannot be negative: {age}")
    if age <= 2:
        return "infant"
    if age <= 12:
        return "child"
    if age <= 17:
        return "teenager"
    if age <= 64:
        return "adult"
    return "senior"
```

**Key points:**
- Guard clause for invalid input first
- No need for `elif` when each branch returns — early returns make the code flat
- Boundary values (0, 2, 3, 12, etc.) are explicitly tested

</details>

---

## Task 2: Password Strength Checker 🟢

**Objective:** Write a function that evaluates password strength.

**Requirements:**
- Return "weak" if length < 8
- Return "medium" if length >= 8 but missing uppercase, lowercase, or digit
- Return "strong" if length >= 8, has uppercase, lowercase, digit, and special character
- Return "good" for everything else (length >= 8, has uppercase, lowercase, and digit but no special char)

```python
def check_password_strength(password: str) -> str:
    """Evaluate password strength."""
    # YOUR CODE HERE
    pass


# Test cases
assert check_password_strength("abc") == "weak"
assert check_password_strength("abcdefgh") == "medium"  # no uppercase/digit
assert check_password_strength("Abcdefg1") == "good"     # no special char
assert check_password_strength("Abcdef1!") == "strong"   # has everything
assert check_password_strength("ABCDEFGH") == "medium"   # no lowercase/digit
assert check_password_strength("12345678") == "medium"   # no letters
assert check_password_strength("") == "weak"

print("All tests passed!")
```

<details>
<summary>Solution</summary>

```python
def check_password_strength(password: str) -> str:
    """Evaluate password strength."""
    if len(password) < 8:
        return "weak"

    has_upper = any(c.isupper() for c in password)
    has_lower = any(c.islower() for c in password)
    has_digit = any(c.isdigit() for c in password)
    has_special = any(not c.isalnum() for c in password)

    if has_upper and has_lower and has_digit and has_special:
        return "strong"
    if has_upper and has_lower and has_digit:
        return "good"
    return "medium"
```

**Key points:**
- Extract complex conditions into named booleans for readability
- Use `any()` with generator expressions for efficient character scanning
- Check the most specific condition (strong) first, then less specific

</details>

---

## Task 3: BMI Calculator with Advice 🟢

**Objective:** Calculate BMI and provide health advice.

**Requirements:**
- BMI = weight (kg) / height (m)^2
- < 18.5: "Underweight"
- 18.5-24.9: "Normal weight"
- 25.0-29.9: "Overweight"
- >= 30.0: "Obese"
- Validate inputs: weight > 0, height > 0

```python
def calculate_bmi(weight_kg: float, height_m: float) -> tuple[float, str]:
    """Calculate BMI and return (bmi_value, category)."""
    # YOUR CODE HERE
    pass


# Test cases
bmi, cat = calculate_bmi(70, 1.75)
assert 22.0 < bmi < 23.0 and cat == "Normal weight"

bmi, cat = calculate_bmi(50, 1.75)
assert cat == "Underweight"

bmi, cat = calculate_bmi(85, 1.70)
assert cat == "Overweight"

bmi, cat = calculate_bmi(110, 1.70)
assert cat == "Obese"

try:
    calculate_bmi(-70, 1.75)
    assert False, "Should have raised ValueError"
except ValueError:
    pass

try:
    calculate_bmi(70, 0)
    assert False, "Should have raised ValueError"
except ValueError:
    pass

print("All tests passed!")
```

<details>
<summary>Solution</summary>

```python
def calculate_bmi(weight_kg: float, height_m: float) -> tuple[float, str]:
    """Calculate BMI and return (bmi_value, category)."""
    if weight_kg <= 0:
        raise ValueError(f"Weight must be positive: {weight_kg}")
    if height_m <= 0:
        raise ValueError(f"Height must be positive: {height_m}")

    bmi = weight_kg / (height_m ** 2)

    if bmi < 18.5:
        category = "Underweight"
    elif bmi < 25.0:
        category = "Normal weight"
    elif bmi < 30.0:
        category = "Overweight"
    else:
        category = "Obese"

    return round(bmi, 1), category
```

</details>

---

## Task 4: Rock Paper Scissors Game 🟡

**Objective:** Implement Rock Paper Scissors with input validation.

**Requirements:**
- Accept "rock", "paper", or "scissors" (case-insensitive)
- Return "win", "lose", or "draw" from player's perspective
- Raise `ValueError` for invalid input

```python
import random

def play_rps(player_choice: str) -> tuple[str, str, str]:
    """
    Play Rock Paper Scissors.
    Returns: (player_choice, computer_choice, result)
    """
    # YOUR CODE HERE
    pass


# Test the function deterministically
def test_rps():
    # Test all combinations
    rules = {
        ("rock", "scissors"): "win",
        ("rock", "paper"): "lose",
        ("rock", "rock"): "draw",
        ("paper", "rock"): "win",
        ("paper", "scissors"): "lose",
        ("paper", "paper"): "draw",
        ("scissors", "paper"): "win",
        ("scissors", "rock"): "lose",
        ("scissors", "scissors"): "draw",
    }

    for (player, computer), expected in rules.items():
        _, _, result = play_rps_fixed(player, computer)
        assert result == expected, f"{player} vs {computer}: expected {expected}, got {result}"

    # Test case insensitivity
    play_rps("ROCK")
    play_rps("Rock")

    # Test invalid input
    try:
        play_rps("gun")
        assert False, "Should have raised ValueError"
    except ValueError:
        pass

    print("All tests passed!")


def play_rps_fixed(player_choice: str, computer_choice: str) -> tuple[str, str, str]:
    """Deterministic version for testing."""
    # YOUR CODE HERE (same logic, but with fixed computer choice)
    pass


test_rps()
```

<details>
<summary>Solution</summary>

```python
import random

VALID_CHOICES = {"rock", "paper", "scissors"}
WINS = {
    ("rock", "scissors"),
    ("paper", "rock"),
    ("scissors", "paper"),
}


def play_rps(player_choice: str) -> tuple[str, str, str]:
    """Play Rock Paper Scissors against the computer."""
    player = player_choice.lower().strip()
    if player not in VALID_CHOICES:
        raise ValueError(f"Invalid choice: {player_choice}. Choose: rock, paper, or scissors")

    computer = random.choice(list(VALID_CHOICES))
    return player, computer, _determine_result(player, computer)


def play_rps_fixed(player_choice: str, computer_choice: str) -> tuple[str, str, str]:
    """Deterministic version for testing."""
    player = player_choice.lower().strip()
    computer = computer_choice.lower().strip()
    if player not in VALID_CHOICES or computer not in VALID_CHOICES:
        raise ValueError(f"Invalid choice")
    return player, computer, _determine_result(player, computer)


def _determine_result(player: str, computer: str) -> str:
    """Determine game result from player's perspective."""
    if player == computer:
        return "draw"
    if (player, computer) in WINS:
        return "win"
    return "lose"
```

**Key points:**
- Use a set for valid choices and win conditions — cleaner than if-elif
- Normalize input (lowercase, strip) before comparison
- Separate the result logic into a pure function for testability

</details>

---

## Task 5: Ticket Price Calculator 🟡

**Objective:** Calculate ticket prices based on multiple conditions.

**Requirements:**
- Base price: $20
- Children (< 12): 50% off
- Seniors (>= 65): 40% off
- Students (any age with student=True): 30% off
- Weekend (is_weekend=True): 25% surcharge (applied after discounts)
- Holiday (is_holiday=True): 50% surcharge (applied after discounts)
- If both weekend and holiday, only apply the larger surcharge (holiday)
- Return the final price rounded to 2 decimal places

```python
def calculate_ticket_price(
    age: int,
    is_student: bool = False,
    is_weekend: bool = False,
    is_holiday: bool = False,
) -> float:
    """Calculate ticket price based on age and conditions."""
    # YOUR CODE HERE
    pass


# Test cases
assert calculate_ticket_price(25) == 20.00                    # base price
assert calculate_ticket_price(10) == 10.00                    # child 50% off
assert calculate_ticket_price(70) == 12.00                    # senior 40% off
assert calculate_ticket_price(20, is_student=True) == 14.00   # student 30% off
assert calculate_ticket_price(25, is_weekend=True) == 25.00   # 20 + 25% = 25
assert calculate_ticket_price(25, is_holiday=True) == 30.00   # 20 + 50% = 30
assert calculate_ticket_price(25, is_weekend=True, is_holiday=True) == 30.00  # max surcharge
assert calculate_ticket_price(10, is_weekend=True) == 12.50   # child + weekend
assert calculate_ticket_price(70, is_holiday=True) == 18.00   # senior + holiday

print("All tests passed!")
```

<details>
<summary>Solution</summary>

```python
def calculate_ticket_price(
    age: int,
    is_student: bool = False,
    is_weekend: bool = False,
    is_holiday: bool = False,
) -> float:
    """Calculate ticket price based on age and conditions."""
    BASE_PRICE = 20.00

    # Step 1: Determine discount
    if age < 12:
        discount = 0.50
    elif age >= 65:
        discount = 0.40
    elif is_student:
        discount = 0.30
    else:
        discount = 0.00

    # Step 2: Apply discount
    price = BASE_PRICE * (1 - discount)

    # Step 3: Determine surcharge (take the larger one)
    if is_holiday:
        surcharge = 0.50
    elif is_weekend:
        surcharge = 0.25
    else:
        surcharge = 0.00

    # Step 4: Apply surcharge
    price *= (1 + surcharge)

    return round(price, 2)
```

**Key points:**
- Separate discount and surcharge logic into clear steps
- Use the largest surcharge (holiday > weekend) by checking holiday first
- Round at the end to avoid floating-point accumulation errors

</details>

---

## Task 6: Command Parser with match-case 🔴

**Objective:** Parse and execute text commands using `match-case` (Python 3.10+).

**Requirements:**
- Parse commands like: "add 5 3", "multiply 4 6", "greet Alice", "quit"
- Support: add, subtract, multiply, divide, greet, quit
- Handle division by zero
- Return appropriate responses as strings

```python
def parse_command(command: str) -> str:
    """Parse and execute a text command."""
    # YOUR CODE HERE
    pass


# Test cases
assert parse_command("add 5 3") == "Result: 8.0"
assert parse_command("subtract 10 4") == "Result: 6.0"
assert parse_command("multiply 3 7") == "Result: 21.0"
assert parse_command("divide 10 3") == "Result: 3.3333333333333335"
assert parse_command("divide 10 0") == "Error: Division by zero"
assert parse_command("greet Alice") == "Hello, Alice!"
assert parse_command("quit") == "Goodbye!"
assert parse_command("unknown") == "Unknown command: unknown"
assert parse_command("add 5") == "Error: 'add' requires 2 arguments"
assert parse_command("") == "Error: Empty command"

print("All tests passed!")
```

<details>
<summary>Solution</summary>

```python
def parse_command(command: str) -> str:
    """Parse and execute a text command using match-case."""
    parts = command.strip().split()

    match parts:
        case []:
            return "Error: Empty command"

        case ["quit"]:
            return "Goodbye!"

        case ["greet", name]:
            return f"Hello, {name}!"

        case ["greet"]:
            return "Error: 'greet' requires a name"

        case [("add" | "subtract" | "multiply" | "divide") as op, a, b]:
            try:
                x, y = float(a), float(b)
            except ValueError:
                return f"Error: Invalid numbers: {a}, {b}"

            match op:
                case "add":
                    return f"Result: {x + y}"
                case "subtract":
                    return f"Result: {x - y}"
                case "multiply":
                    return f"Result: {x * y}"
                case "divide":
                    if y == 0:
                        return "Error: Division by zero"
                    return f"Result: {x / y}"

        case [("add" | "subtract" | "multiply" | "divide") as op, *_]:
            return f"Error: '{op}' requires 2 arguments"

        case _:
            return f"Unknown command: {command.strip()}"
```

**Key points:**
- `match-case` elegantly handles different command structures
- OR patterns (`"add" | "subtract"`) reduce duplication
- Sequence patterns with `*_` catch wrong argument counts
- Nested match for arithmetic operations

</details>

---

## Task 7: Traffic Light State Machine 🟡

**Objective:** Implement a traffic light that cycles through states with rules.

**Requirements:**
- States: red, green, yellow
- Transitions: red -> green -> yellow -> red
- Emergency mode: any state -> flashing_red
- From flashing_red, manual reset goes to red
- Invalid transitions raise `ValueError`

```python
class TrafficLight:
    VALID_TRANSITIONS = {
        "red": {"green"},
        "green": {"yellow"},
        "yellow": {"red"},
        "flashing_red": {"red"},
    }

    def __init__(self):
        self.state = "red"
        self.history: list[str] = ["red"]

    def transition(self, new_state: str) -> str:
        """Transition to a new state. Returns description of the transition."""
        # YOUR CODE HERE
        pass

    def emergency(self) -> str:
        """Enter emergency mode (flashing_red)."""
        # YOUR CODE HERE
        pass

    def next(self) -> str:
        """Automatically advance to the next state in the cycle."""
        # YOUR CODE HERE
        pass


# Test cases
light = TrafficLight()
assert light.state == "red"

result = light.next()
assert light.state == "green"

result = light.next()
assert light.state == "yellow"

result = light.next()
assert light.state == "red"

# Emergency
light.emergency()
assert light.state == "flashing_red"

light.transition("red")
assert light.state == "red"

# Invalid transition
try:
    light.transition("yellow")  # Can't go from red to yellow
    assert False, "Should have raised ValueError"
except ValueError:
    pass

assert len(light.history) == 7  # red, green, yellow, red, flashing_red, red

print("All tests passed!")
```

<details>
<summary>Solution</summary>

```python
class TrafficLight:
    VALID_TRANSITIONS = {
        "red": {"green"},
        "green": {"yellow"},
        "yellow": {"red"},
        "flashing_red": {"red"},
    }

    CYCLE = {"red": "green", "green": "yellow", "yellow": "red"}

    def __init__(self):
        self.state = "red"
        self.history: list[str] = ["red"]

    def transition(self, new_state: str) -> str:
        """Transition to a new state. Returns description of the transition."""
        valid_next_states = self.VALID_TRANSITIONS.get(self.state, set())
        if new_state not in valid_next_states:
            raise ValueError(
                f"Invalid transition: {self.state} -> {new_state}. "
                f"Valid: {valid_next_states}"
            )
        old_state = self.state
        self.state = new_state
        self.history.append(new_state)
        return f"{old_state} -> {new_state}"

    def emergency(self) -> str:
        """Enter emergency mode (flashing_red)."""
        old_state = self.state
        self.state = "flashing_red"
        self.history.append("flashing_red")
        return f"EMERGENCY: {old_state} -> flashing_red"

    def next(self) -> str:
        """Automatically advance to the next state in the cycle."""
        if self.state not in self.CYCLE:
            raise ValueError(f"Cannot auto-advance from {self.state}")
        next_state = self.CYCLE[self.state]
        return self.transition(next_state)
```

**Key points:**
- Dictionary-based state machine — transitions are data, not code
- Separate `emergency()` bypasses normal validation
- History tracking for debugging
- `next()` delegates to `transition()` for validation

</details>

---

## Task 8: Expression Evaluator 🔴

**Objective:** Build a simple expression evaluator using conditional logic.

**Requirements:**
- Evaluate simple math expressions: "5 + 3", "10 * 2", "15 / 3"
- Support: +, -, *, /, ** (power), % (modulo)
- Support parentheses for grouping (bonus)
- Handle errors gracefully

```python
def evaluate(expression: str) -> float:
    """
    Evaluate a simple math expression.
    Supports: +, -, *, /, **, %
    """
    # YOUR CODE HERE
    pass


# Test cases
assert evaluate("5 + 3") == 8.0
assert evaluate("10 - 4") == 6.0
assert evaluate("3 * 7") == 21.0
assert evaluate("15 / 4") == 3.75
assert evaluate("2 ** 3") == 8.0
assert evaluate("10 % 3") == 1.0
assert evaluate("  5  +  3  ") == 8.0  # handles whitespace

try:
    evaluate("10 / 0")
    assert False, "Should have raised ValueError"
except ValueError:
    pass

try:
    evaluate("5 @ 3")
    assert False, "Should have raised ValueError"
except ValueError:
    pass

print("All tests passed!")
```

<details>
<summary>Solution</summary>

```python
import operator

OPERATORS: dict[str, callable] = {
    "+": operator.add,
    "-": operator.sub,
    "*": operator.mul,
    "/": operator.truediv,
    "**": operator.pow,
    "%": operator.mod,
}


def evaluate(expression: str) -> float:
    """Evaluate a simple math expression."""
    expr = expression.strip()
    if not expr:
        raise ValueError("Empty expression")

    # Try to find a two-character operator first (**)
    for op_str in sorted(OPERATORS.keys(), key=len, reverse=True):
        if op_str in expr:
            # Find the operator position (not at the start for negative numbers)
            idx = expr.find(op_str, 1 if len(op_str) == 1 else 0)
            if idx > 0:
                left = expr[:idx].strip()
                right = expr[idx + len(op_str):].strip()

                if not left or not right:
                    continue

                try:
                    left_val = float(left)
                    right_val = float(right)
                except ValueError:
                    continue

                if op_str == "/" and right_val == 0:
                    raise ValueError("Division by zero")

                return float(OPERATORS[op_str](left_val, right_val))

    raise ValueError(f"Invalid expression: {expression}")
```

**Alternative approach using match-case:**

```python
def evaluate_v2(expression: str) -> float:
    """Evaluate using match-case and regex."""
    import re

    expr = expression.strip()
    # Match: number operator number
    pattern = r"^\s*(-?\d+\.?\d*)\s*(\+|-|\*\*|\*|/|%)\s*(-?\d+\.?\d*)\s*$"

    match re.match(pattern, expr):
        case None:
            raise ValueError(f"Invalid expression: {expression}")
        case m:
            left, op, right = float(m.group(1)), m.group(2), float(m.group(3))

    match op:
        case "/" if right == 0:
            raise ValueError("Division by zero")
        case op if op in OPERATORS:
            return float(OPERATORS[op](left, right))
        case _:
            raise ValueError(f"Unknown operator: {op}")
```

</details>

---

## Task 9: JSON Schema Validator 🔴

**Objective:** Build a simple JSON schema validator using conditional logic.

```python
from typing import Any


def validate(data: Any, schema: dict) -> list[str]:
    """
    Validate data against a simple schema.
    Schema format:
    {
        "type": "object",
        "properties": {
            "name": {"type": "string", "required": True},
            "age": {"type": "integer", "min": 0, "max": 150},
            "email": {"type": "string", "pattern": "@"},
        }
    }
    Returns list of error messages (empty = valid).
    """
    # YOUR CODE HERE
    pass


# Test cases
schema = {
    "type": "object",
    "properties": {
        "name": {"type": "string", "required": True},
        "age": {"type": "integer", "min": 0, "max": 150},
        "email": {"type": "string"},
        "active": {"type": "boolean"},
    }
}

# Valid data
errors = validate({"name": "Alice", "age": 30, "email": "alice@example.com", "active": True}, schema)
assert errors == [], f"Expected no errors, got: {errors}"

# Missing required field
errors = validate({"age": 30}, schema)
assert any("name" in e and "required" in e for e in errors)

# Wrong type
errors = validate({"name": 123, "age": 30}, schema)
assert any("name" in e and "type" in e.lower() for e in errors)

# Out of range
errors = validate({"name": "Bob", "age": -5}, schema)
assert any("age" in e and "min" in e.lower() for e in errors)

errors = validate({"name": "Bob", "age": 200}, schema)
assert any("age" in e and "max" in e.lower() for e in errors)

print("All tests passed!")
```

<details>
<summary>Solution</summary>

```python
from typing import Any

TYPE_MAP = {
    "string": str,
    "integer": int,
    "float": (int, float),
    "boolean": bool,
    "list": list,
    "object": dict,
}


def validate(data: Any, schema: dict) -> list[str]:
    """Validate data against a simple schema."""
    errors: list[str] = []

    # Check top-level type
    expected_type = schema.get("type")
    if expected_type == "object" and not isinstance(data, dict):
        return [f"Expected object, got {type(data).__name__}"]

    if expected_type != "object":
        return _validate_value("root", data, schema)

    # Validate properties
    properties = schema.get("properties", {})

    for prop_name, prop_schema in properties.items():
        is_required = prop_schema.get("required", False)

        if prop_name not in data:
            if is_required:
                errors.append(f"'{prop_name}' is required but missing")
            continue

        value = data[prop_name]
        errors.extend(_validate_value(prop_name, value, prop_schema))

    return errors


def _validate_value(name: str, value: Any, schema: dict) -> list[str]:
    """Validate a single value against its schema."""
    errors: list[str] = []
    expected_type = schema.get("type")

    if expected_type:
        python_type = TYPE_MAP.get(expected_type)
        if python_type and not isinstance(value, python_type):
            # Special case: bool is subclass of int
            if expected_type == "integer" and isinstance(value, bool):
                errors.append(f"'{name}': expected type {expected_type}, got boolean")
                return errors
            errors.append(f"'{name}': expected type {expected_type}, got {type(value).__name__}")
            return errors  # Don't check further constraints if type is wrong

    if "min" in schema and isinstance(value, (int, float)):
        if value < schema["min"]:
            errors.append(f"'{name}': value {value} is below min {schema['min']}")

    if "max" in schema and isinstance(value, (int, float)):
        if value > schema["max"]:
            errors.append(f"'{name}': value {value} is above max {schema['max']}")

    if "pattern" in schema and isinstance(value, str):
        if schema["pattern"] not in value:
            errors.append(f"'{name}': value does not contain pattern '{schema['pattern']}'")

    return errors
```

</details>

---

## Task 10: Mini Calculator REPL 🟡

**Objective:** Build an interactive calculator that processes commands in a loop.

```python
def calculator_repl():
    """
    Interactive calculator REPL.
    Commands:
    - "5 + 3" — arithmetic expression
    - "history" — show calculation history
    - "clear" — clear history
    - "last" — show last result
    - "help" — show available commands
    - "quit" / "exit" — exit the REPL
    """
    history: list[tuple[str, float]] = []
    last_result: float | None = None

    print("Calculator REPL (type 'help' for commands, 'quit' to exit)")

    while True:
        try:
            user_input = input(">>> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not user_input:
            continue

        match user_input.lower():
            case "quit" | "exit":
                print("Goodbye!")
                break
            case "help":
                print("Commands: <expr>, history, clear, last, help, quit")
            case "history":
                if not history:
                    print("No history yet")
                else:
                    for i, (expr, result) in enumerate(history, 1):
                        print(f"  {i}. {expr} = {result}")
            case "clear":
                history.clear()
                last_result = None
                print("History cleared")
            case "last":
                if last_result is not None:
                    print(f"Last result: {last_result}")
                else:
                    print("No previous result")
            case _:
                try:
                    result = evaluate_expression(user_input)
                    print(f"= {result}")
                    history.append((user_input, result))
                    last_result = result
                except ValueError as e:
                    print(f"Error: {e}")


def evaluate_expression(expr: str) -> float:
    """Evaluate a simple arithmetic expression safely."""
    import operator

    ops = {
        "+": operator.add,
        "-": operator.sub,
        "*": operator.mul,
        "/": operator.truediv,
    }

    for op_str in ops:
        if op_str in expr[1:]:  # Skip first char (might be negative sign)
            idx = expr.index(op_str, 1)
            left = expr[:idx].strip()
            right = expr[idx + 1:].strip()
            try:
                left_val = float(left)
                right_val = float(right)
            except ValueError:
                raise ValueError(f"Invalid numbers in: {expr}")
            if op_str == "/" and right_val == 0:
                raise ValueError("Division by zero")
            return ops[op_str](left_val, right_val)

    # Maybe it's just a number
    try:
        return float(expr)
    except ValueError:
        raise ValueError(f"Cannot evaluate: {expr}")


if __name__ == "__main__":
    calculator_repl()
```

<details>
<summary>Note</summary>

This task is designed to be run interactively. The `match-case` statement handles different commands cleanly, and the REPL pattern (Read-Eval-Print Loop) is a common application of conditional logic.

**Key points:**
- `match-case` with OR patterns handles "quit" | "exit"
- History tracking uses a list of tuples
- Error handling wraps the expression evaluation
- `EOFError` and `KeyboardInterrupt` handle Ctrl+D and Ctrl+C

</details>

---

## Summary

| Task | Difficulty | Key Concepts |
|------|-----------|--------------|
| Age Group Classifier | 🟢 | if-elif, guard clauses, boundary values |
| Password Strength | 🟢 | Named booleans, any(), multiple conditions |
| BMI Calculator | 🟢 | Validation, elif chains, float formatting |
| Rock Paper Scissors | 🟡 | Set-based logic, normalization, separation of concerns |
| Ticket Price | 🟡 | Multi-step conditions, surcharge/discount logic |
| Command Parser | 🔴 | match-case, OR patterns, sequence patterns |
| Traffic Light | 🟡 | State machine, dictionary-based transitions |
| Expression Evaluator | 🔴 | Operator dispatch, error handling, regex |
| JSON Validator | 🔴 | Recursive validation, type mapping |
| Calculator REPL | 🟡 | Interactive loop, match-case, history |
