# Basic Syntax — Practical Tasks

## Junior Tasks

### Task 1: Interactive Profile Card

**Type:** Code

**Goal:** Practice `input()`, `print()`, f-strings, and basic operators

**Starter code:**

```python
# profile_card.py
# TODO: Ask the user for their name, age, city, and favorite language
# TODO: Print a formatted profile card

def main():
    # 1. Get user input
    # 2. Calculate birth year (approximate)
    # 3. Print a formatted card

    pass


if __name__ == "__main__":
    main()
```

**Expected output:**
```
╔══════════════════════════╗
║     PROFILE CARD         ║
╠══════════════════════════╣
║ Name:     Alice          ║
║ Age:      25             ║
║ City:     New York       ║
║ Language: Python         ║
║ Born:     ~2001          ║
╚══════════════════════════╝
```

**Evaluation criteria:**
- [ ] Uses `input()` for all 4 fields
- [ ] Uses f-strings for formatting
- [ ] Calculates approximate birth year using current year
- [ ] Follows PEP 8 naming conventions

<details>
<summary>Solution</summary>

```python
from datetime import datetime


def main():
    name = input("Enter your name: ")
    age = int(input("Enter your age: "))
    city = input("Enter your city: ")
    language = input("Enter your favorite programming language: ")

    birth_year = datetime.now().year - age

    print("╔══════════════════════════╗")
    print("║     PROFILE CARD         ║")
    print("╠══════════════════════════╣")
    print(f"║ Name:     {name:<15}║")
    print(f"║ Age:      {age:<15}║")
    print(f"║ City:     {city:<15}║")
    print(f"║ Language: {language:<15}║")
    print(f"║ Born:     ~{birth_year:<14}║")
    print("╚══════════════════════════╝")


if __name__ == "__main__":
    main()
```
</details>

---

### Task 2: Unit Converter

**Type:** Code

**Goal:** Practice variables, operators, and multiple assignment

**Starter code:**

```python
# converter.py
# TODO: Create a unit converter that handles:
# - Kilometers ↔ Miles (1 km = 0.621371 miles)
# - Celsius ↔ Fahrenheit (F = C * 9/5 + 32)
# - Kilograms ↔ Pounds (1 kg = 2.20462 lbs)

def main():
    pass


if __name__ == "__main__":
    main()
```

**Expected output:**
```
=== Unit Converter ===
1. Kilometers to Miles
2. Miles to Kilometers
3. Celsius to Fahrenheit
4. Fahrenheit to Celsius
5. Kilograms to Pounds
6. Pounds to Kilograms

Choose option (1-6): 3
Enter value: 100
100.0°C = 212.0°F
```

**Evaluation criteria:**
- [ ] All 6 conversions work correctly
- [ ] Uses constants for conversion factors (`KM_TO_MILES = 0.621371`)
- [ ] Handles float input properly
- [ ] Uses f-strings with formatting (`.2f`)

<details>
<summary>Solution</summary>

```python
KM_TO_MILES = 0.621371
KG_TO_LBS = 2.20462


def km_to_miles(km: float) -> float:
    return km * KM_TO_MILES


def miles_to_km(miles: float) -> float:
    return miles / KM_TO_MILES


def celsius_to_fahrenheit(c: float) -> float:
    return c * 9 / 5 + 32


def fahrenheit_to_celsius(f: float) -> float:
    return (f - 32) * 5 / 9


def kg_to_lbs(kg: float) -> float:
    return kg * KG_TO_LBS


def lbs_to_kg(lbs: float) -> float:
    return lbs / KG_TO_LBS


def main():
    print("=== Unit Converter ===")
    print("1. Kilometers to Miles")
    print("2. Miles to Kilometers")
    print("3. Celsius to Fahrenheit")
    print("4. Fahrenheit to Celsius")
    print("5. Kilograms to Pounds")
    print("6. Pounds to Kilograms")
    print()

    choice = int(input("Choose option (1-6): "))
    value = float(input("Enter value: "))

    converters = {
        1: ("km", "miles", km_to_miles),
        2: ("miles", "km", miles_to_km),
        3: ("°C", "°F", celsius_to_fahrenheit),
        4: ("°F", "°C", fahrenheit_to_celsius),
        5: ("kg", "lbs", kg_to_lbs),
        6: ("lbs", "kg", lbs_to_kg),
    }

    if choice in converters:
        from_unit, to_unit, func = converters[choice]
        result = func(value)
        print(f"{value}{from_unit} = {result:.2f}{to_unit}")
    else:
        print("Invalid choice!")


if __name__ == "__main__":
    main()
```
</details>

---

### Task 3: Python Syntax Quiz Generator

**Type:** Code

**Goal:** Practice comments, docstrings, and code organization

**Starter code:**

```python
# quiz.py
# TODO: Create a simple quiz about Python syntax
# - Define at least 5 questions with answers
# - Track score
# - Print results at the end

def main():
    pass


if __name__ == "__main__":
    main()
```

**Evaluation criteria:**
- [ ] At least 5 questions about Python syntax
- [ ] Uses docstrings for functions
- [ ] Tracks and displays score
- [ ] Follows PEP 8 conventions

<details>
<summary>Solution</summary>

```python
def ask_question(question: str, options: list, correct: int) -> bool:
    """Ask a multiple-choice question and return True if answered correctly.

    Args:
        question: The question text
        options: List of answer options
        correct: Index of the correct answer (0-based)

    Returns:
        True if the user answered correctly
    """
    print(f"\n{question}")
    for i, option in enumerate(options):
        print(f"  {i + 1}) {option}")

    try:
        answer = int(input("Your answer (number): ")) - 1
    except ValueError:
        print("Invalid input!")
        return False

    if answer == correct:
        print("Correct!")
        return True
    else:
        print(f"Wrong! The correct answer was: {options[correct]}")
        return False


def main():
    """Run a Python syntax quiz."""
    questions = [
        {
            "q": "What does Python use to define code blocks?",
            "opts": ["Curly braces {}", "Parentheses ()", "Indentation", "Semicolons"],
            "ans": 2,
        },
        {
            "q": "What does input() return?",
            "opts": ["int", "float", "str", "bytes"],
            "ans": 2,
        },
        {
            "q": "Which is the floor division operator?",
            "opts": ["/", "//", "%", "**"],
            "ans": 1,
        },
        {
            "q": "What naming convention do Python functions use?",
            "opts": ["camelCase", "PascalCase", "snake_case", "kebab-case"],
            "ans": 2,
        },
        {
            "q": "What starts a comment in Python?",
            "opts": ["//", "#", "/*", "--"],
            "ans": 1,
        },
    ]

    score = 0
    total = len(questions)

    print("=== Python Syntax Quiz ===")
    for item in questions:
        if ask_question(item["q"], item["opts"], item["ans"]):
            score += 1

    print(f"\n=== Results ===")
    print(f"Score: {score}/{total} ({score / total * 100:.0f}%)")

    if score == total:
        print("Perfect score!")
    elif score >= total * 0.7:
        print("Great job!")
    else:
        print("Keep studying!")


if __name__ == "__main__":
    main()
```
</details>

---

### Task 4: Syntax Diagram Generator

**Type:** Design

**Goal:** Create a visual representation of Python's basic syntax rules

**Deliverable:** Draw a flowchart (on paper or using mermaid) showing:
1. How Python decides if a line is a comment, statement, or blank line
2. How indentation levels create nested blocks
3. How `if __name__ == "__main__":` works

---

## Middle Tasks

### Task 5: Expression Evaluator with Walrus Operator

**Type:** Code

**Requirements:**
- [ ] Build a simple math expression evaluator (supports `+`, `-`, `*`, `/`)
- [ ] Use the walrus operator (`:=`) for input validation
- [ ] Use pattern matching (`match/case`) for operator dispatch (Python 3.10+)
- [ ] Add type hints to all functions

```python
# evaluator.py
# TODO: Implement a simple expression evaluator
# Example: "5 + 3" → 8.0, "10 / 3" → 3.333

def main():
    pass


if __name__ == "__main__":
    main()
```

<details>
<summary>Solution</summary>

```python
import re


def parse_expression(expr: str) -> tuple[float, str, float] | None:
    """Parse a simple math expression into (left, operator, right).

    Args:
        expr: String like "5 + 3" or "10.5 / 2"

    Returns:
        Tuple of (left_number, operator, right_number) or None if invalid
    """
    pattern = r"^\s*(-?\d+\.?\d*)\s*([+\-*/])\s*(-?\d+\.?\d*)\s*$"
    if match := re.match(pattern, expr):
        left = float(match.group(1))
        op = match.group(2)
        right = float(match.group(3))
        return left, op, right
    return None


def evaluate(left: float, op: str, right: float) -> float:
    """Evaluate a binary math operation.

    Args:
        left: Left operand
        op: Operator (+, -, *, /)
        right: Right operand

    Returns:
        Result of the operation

    Raises:
        ZeroDivisionError: If dividing by zero
        ValueError: If operator is unknown
    """
    match op:
        case "+":
            return left + right
        case "-":
            return left - right
        case "*":
            return left * right
        case "/":
            if right == 0:
                raise ZeroDivisionError("Cannot divide by zero")
            return left / right
        case _:
            raise ValueError(f"Unknown operator: {op}")


def main() -> None:
    """Run the expression evaluator in a loop."""
    print("=== Expression Evaluator ===")
    print("Enter expressions like '5 + 3' or 'quit' to exit\n")

    while (expr := input(">>> ")) != "quit":
        if parsed := parse_expression(expr):
            left, op, right = parsed
            try:
                result = evaluate(left, op, right)
                print(f"  = {result}")
            except (ZeroDivisionError, ValueError) as e:
                print(f"  Error: {e}")
        else:
            print("  Invalid expression. Use format: number operator number")


if __name__ == "__main__":
    main()
```
</details>

---

### Task 6: Code Style Analyzer

**Type:** Code

**Requirements:**
- [ ] Read a Python file and check for common style issues
- [ ] Check: line length > 79, tabs vs spaces, trailing whitespace, missing docstrings
- [ ] Report issues with line numbers
- [ ] Use context managers for file handling
- [ ] Write pytest tests for the analyzer

<details>
<summary>Solution</summary>

```python
from dataclasses import dataclass
from pathlib import Path


@dataclass
class StyleIssue:
    line_number: int
    column: int
    code: str
    message: str


def analyze_file(filepath: str | Path) -> list[StyleIssue]:
    """Analyze a Python file for common style issues.

    Args:
        filepath: Path to the Python file

    Returns:
        List of StyleIssue objects
    """
    issues: list[StyleIssue] = []
    filepath = Path(filepath)

    with open(filepath, "r", encoding="utf-8") as f:
        lines = f.readlines()

    for i, line in enumerate(lines, start=1):
        # Check line length
        if len(line.rstrip("\n")) > 79:
            issues.append(StyleIssue(i, 80, "E501", f"Line too long ({len(line.rstrip())} > 79)"))

        # Check for tabs
        if "\t" in line:
            col = line.index("\t") + 1
            issues.append(StyleIssue(i, col, "W191", "Indentation contains tabs"))

        # Check trailing whitespace
        stripped = line.rstrip("\n")
        if stripped != stripped.rstrip():
            issues.append(StyleIssue(i, len(stripped.rstrip()) + 1, "W291", "Trailing whitespace"))

    # Check for module docstring
    content = "".join(lines)
    if not content.lstrip().startswith(('"""', "'''")):
        if not content.lstrip().startswith("#"):
            issues.append(StyleIssue(1, 1, "D100", "Missing module docstring"))

    return issues


def main() -> None:
    import sys

    if len(sys.argv) < 2:
        print("Usage: python analyzer.py <file.py>")
        sys.exit(1)

    filepath = sys.argv[1]
    issues = analyze_file(filepath)

    if not issues:
        print(f"{filepath}: All checks passed!")
    else:
        for issue in issues:
            print(f"{filepath}:{issue.line_number}:{issue.column}: {issue.code} {issue.message}")
        print(f"\nTotal issues: {len(issues)}")


if __name__ == "__main__":
    main()
```
</details>

---

### Task 7: Dictionary Dispatch Refactoring

**Type:** Code

**Requirements:**
- [ ] Refactor a long `if/elif/else` chain into dictionary dispatch
- [ ] Add plugin registration using `__init_subclass__`
- [ ] Add type hints throughout
- [ ] Write tests for all dispatch paths

---

## Senior Tasks

### Task 8: Custom Python REPL

**Type:** Code

**Requirements:**
- [ ] Build a simplified Python REPL (Read-Eval-Print Loop)
- [ ] Support: variable assignment, arithmetic, `print()`, history
- [ ] Use `ast.parse()` and `compile()` to safely evaluate expressions
- [ ] Add command history with up/down navigation
- [ ] Profile with `cProfile` and optimize hot paths
- [ ] Document GIL implications if adding threading

<details>
<summary>Solution Skeleton</summary>

```python
import ast
import traceback
from typing import Any


class SimpleREPL:
    """A simplified Python REPL with history and safe evaluation."""

    def __init__(self):
        self._namespace: dict[str, Any] = {}
        self._history: list[str] = []

    def evaluate(self, source: str) -> Any | None:
        """Safely evaluate a Python expression or statement.

        Uses ast.parse to validate syntax before execution.
        """
        self._history.append(source)

        try:
            # Try as expression first
            tree = ast.parse(source, mode="eval")
            code = compile(tree, "<repl>", "eval")
            return eval(code, {"__builtins__": __builtins__}, self._namespace)
        except SyntaxError:
            pass

        try:
            # Try as statement
            tree = ast.parse(source, mode="exec")
            code = compile(tree, "<repl>", "exec")
            exec(code, {"__builtins__": __builtins__}, self._namespace)
            return None
        except SyntaxError as e:
            raise SyntaxError(f"Invalid syntax: {e}")

    def run(self) -> None:
        """Run the REPL loop."""
        print("Simple Python REPL (type 'exit' to quit)")
        while True:
            try:
                source = input(">>> ")
                if source.strip() == "exit":
                    break
                if source.strip() == "":
                    continue
                result = self.evaluate(source)
                if result is not None:
                    print(repr(result))
            except KeyboardInterrupt:
                print("\nKeyboardInterrupt")
            except Exception as e:
                traceback.print_exc()


if __name__ == "__main__":
    repl = SimpleREPL()
    repl.run()
```
</details>

---

### Task 9: Bytecode Analyzer Tool

**Type:** Code

**Requirements:**
- [ ] Build a tool that analyzes Python functions and reports performance metrics
- [ ] Count bytecode instructions by type (LOAD_FAST, LOAD_GLOBAL, etc.)
- [ ] Estimate relative performance based on instruction mix
- [ ] Suggest optimizations (e.g., "bind global X to local variable")
- [ ] Support analyzing entire modules

---

## Questions

### 1. Why does Python use indentation instead of braces?

**Answer:** Guido van Rossum designed Python to be **readable first**. Research showed that programmers indent code for readability anyway — Python simply makes it mandatory. This eliminates "brace wars" and ensures all Python code looks structurally similar, reducing cognitive load when reading unfamiliar code.

### 2. What is the difference between `is` and `==`?

**Answer:** `==` compares **values** (calls `__eq__`). `is` compares **identity** (same object in memory, i.e., same `id()`). Use `is` only for singletons: `None`, `True`, `False`.

### 3. Why are f-strings faster than `.format()`?

**Answer:** f-strings are compiled to `FORMAT_VALUE` + `BUILD_STRING` bytecode at compile time. `.format()` parses the format string at runtime, does dictionary lookups for named arguments, and has method call overhead.

### 4. What happens when you write `a, b = b, a`?

**Answer:** Python creates a temporary tuple `(b, a)` on the stack, then unpacks it. At the bytecode level, CPython uses `ROT_TWO` for a stack-level swap — no actual tuple object is created for the two-variable case.

### 5. Why is `x += 1` not thread-safe?

**Answer:** It compiles to 4 bytecode instructions (LOAD, LOAD_CONST, BINARY_ADD, STORE). The GIL can release between any two instructions, allowing another thread to read/modify `x` concurrently.

### 6. What is the walrus operator and when should you avoid it?

**Answer:** `:=` assigns and returns a value in one expression. Avoid it when the assignment is simple and adding `:=` reduces readability. Best used in `while` loops and comprehension filters.

### 7. How does CPython's small integer cache work?

**Answer:** CPython pre-allocates integers from -5 to 256 at startup. All references to these values point to the same pre-allocated objects, saving memory and making `is` comparisons work for small integers.

---

## Mini Projects

### Project 1: Python Style Guide Enforcer

**Goal:** Build a command-line tool that checks Python files against a custom style guide.

**Requirements:**
- [ ] Parse command-line arguments with `argparse`
- [ ] Check PEP 8 rules: line length, naming conventions, indentation
- [ ] Support configuration via `pyproject.toml`
- [ ] Output results in different formats (text, JSON)
- [ ] pytest tests with >80% coverage
- [ ] Type hints throughout
- [ ] README with setup and usage

**Difficulty:** Middle
**Estimated time:** 6-8 hours

---

## Challenge

### The Syntax Optimizer

**Problem:** Given a Python function as a string, analyze its bytecode and suggest concrete optimizations. Your tool should:

1. Parse the function with `ast.parse()`
2. Compile and disassemble with `dis`
3. Identify:
   - Global variables used in loops (suggest local binding)
   - String concatenation in loops (suggest `join`)
   - List appends in loops (suggest comprehension)
4. Output a report with estimated speedup

**Constraints:**
- Must complete analysis under 100ms for a 100-line function
- Memory usage under 50MB
- Only use standard library (no external packages)

**Scoring:**
- Correctness: 50% — all suggestions must be valid
- Performance (timeit): 30% — analysis must be fast
- Code quality (ruff/mypy): 20% — clean, typed code

**Starter code:**

```python
import ast
import dis
from dataclasses import dataclass


@dataclass
class Suggestion:
    line: int
    current: str
    suggested: str
    estimated_speedup: str


def analyze_function(source: str) -> list[Suggestion]:
    """Analyze a Python function and suggest optimizations."""
    # TODO: Implement
    pass
```
