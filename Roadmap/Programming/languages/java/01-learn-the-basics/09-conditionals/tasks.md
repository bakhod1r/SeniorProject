# Java Conditionals — Practice Tasks

---

## Junior Tasks (4)

### Task 1: Number Classifier

**Difficulty:** Easy
**Estimated time:** 15 minutes

Write a program that classifies a number as positive, negative, or zero, and also reports whether it is even or odd.

**Requirements:**
- Use if-else to classify the number
- Use the ternary operator to determine even/odd
- Handle zero as a special case (zero is even)

**Starter code:**

```java
public class Main {
    public static void main(String[] args) {
        int number = -7;

        // TODO: Classify as positive, negative, or zero
        // TODO: Determine if even or odd using ternary operator
        // TODO: Print both results
    }
}
```

**Expected output:**
```
Number: -7
Sign: negative
Parity: odd
```

**Evaluation criteria:**
- [ ] Code compiles and runs
- [ ] Correctly handles positive, negative, and zero
- [ ] Uses ternary operator for even/odd
- [ ] Zero is classified as even

<details>
<summary>Solution</summary>

```java
public class Main {
    public static void main(String[] args) {
        int number = -7;

        // Classify sign
        String sign;
        if (number > 0) {
            sign = "positive";
        } else if (number < 0) {
            sign = "negative";
        } else {
            sign = "zero";
        }

        // Determine parity using ternary
        String parity = (number % 2 == 0) ? "even" : "odd";

        System.out.println("Number: " + number);
        System.out.println("Sign: " + sign);
        System.out.println("Parity: " + parity);
    }
}
```
</details>

---

### Task 2: Simple Calculator with Switch

**Difficulty:** Easy
**Estimated time:** 20 minutes

Build a simple calculator that performs one of four operations based on a character operator.

**Requirements:**
- Use `switch` to select the operation (+, -, *, /)
- Handle division by zero
- Handle invalid operators with `default`

**Starter code:**

```java
public class Main {
    public static void main(String[] args) {
        double a = 10.0;
        double b = 3.0;
        char operator = '/';

        // TODO: Use switch to perform the operation
        // TODO: Handle division by zero
        // TODO: Handle invalid operator
    }
}
```

**Expected output:**
```
10.0 / 3.0 = 3.3333333333333335
```

**Evaluation criteria:**
- [ ] All four operations work correctly
- [ ] Division by zero prints an error message
- [ ] Invalid operator prints an error message
- [ ] Uses `break` in each case (or switch expression)

<details>
<summary>Solution</summary>

```java
public class Main {
    public static void main(String[] args) {
        double a = 10.0;
        double b = 3.0;
        char operator = '/';

        switch (operator) {
            case '+':
                System.out.println(a + " + " + b + " = " + (a + b));
                break;
            case '-':
                System.out.println(a + " - " + b + " = " + (a - b));
                break;
            case '*':
                System.out.println(a + " * " + b + " = " + (a * b));
                break;
            case '/':
                if (b == 0) {
                    System.out.println("Error: division by zero");
                } else {
                    System.out.println(a + " / " + b + " = " + (a / b));
                }
                break;
            default:
                System.out.println("Error: unknown operator '" + operator + "'");
                break;
        }
    }
}
```
</details>

---

### Task 3: Grade Converter with Validation

**Difficulty:** Easy
**Estimated time:** 20 minutes

Convert a numeric score (0-100) to a letter grade with input validation.

**Requirements:**
- Validate that the score is between 0 and 100
- Use else-if chain for grade assignment (A: 90+, B: 80+, C: 70+, D: 60+, F: below 60)
- Print both the grade and a motivational message using ternary

**Starter code:**

```java
public class Main {
    public static void main(String[] args) {
        int score = 85;

        // TODO: Validate score range (0-100)
        // TODO: Convert to letter grade using else-if
        // TODO: Print motivational message using ternary
    }
}
```

**Expected output:**
```
Score: 85
Grade: B
Status: Passed
```

<details>
<summary>Solution</summary>

```java
public class Main {
    public static void main(String[] args) {
        int score = 85;

        // Validate
        if (score < 0 || score > 100) {
            System.out.println("Error: score must be between 0 and 100");
            return;
        }

        // Assign grade
        char grade;
        if (score >= 90) {
            grade = 'A';
        } else if (score >= 80) {
            grade = 'B';
        } else if (score >= 70) {
            grade = 'C';
        } else if (score >= 60) {
            grade = 'D';
        } else {
            grade = 'F';
        }

        // Motivational message using ternary
        String status = (grade != 'F') ? "Passed" : "Failed";

        System.out.println("Score: " + score);
        System.out.println("Grade: " + grade);
        System.out.println("Status: " + status);
    }
}
```
</details>

---

### Task 4: Leap Year Checker

**Difficulty:** Easy-Medium
**Estimated time:** 15 minutes

Write a program that determines if a given year is a leap year using nested conditionals.

**Rules:**
- A year is a leap year if divisible by 4
- BUT not if divisible by 100
- UNLESS also divisible by 400

**Starter code:**

```java
public class Main {
    public static void main(String[] args) {
        int year = 2024;

        // TODO: Determine if the year is a leap year
        // Use nested if or logical operators
    }
}
```

**Expected output:**
```
2024 is a leap year.
```

**Evaluation criteria:**
- [ ] Correctly identifies 2024 as leap year
- [ ] Correctly identifies 1900 as NOT a leap year
- [ ] Correctly identifies 2000 as a leap year
- [ ] Correctly identifies 2023 as NOT a leap year

<details>
<summary>Solution</summary>

```java
public class Main {
    public static void main(String[] args) {
        int[] years = {2024, 1900, 2000, 2023};

        for (int year : years) {
            boolean isLeap;

            // Approach 1: Nested if
            if (year % 4 == 0) {
                if (year % 100 == 0) {
                    isLeap = (year % 400 == 0);
                } else {
                    isLeap = true;
                }
            } else {
                isLeap = false;
            }

            // Approach 2: Single expression with logical operators
            // boolean isLeap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);

            String result = isLeap ? "is a leap year" : "is NOT a leap year";
            System.out.println(year + " " + result + ".");
        }
    }
}
```
</details>

---

## Middle Tasks (3)

### Task 5: Command Parser with Switch Expression

**Difficulty:** Medium
**Estimated time:** 30 minutes

Build a command parser that accepts string commands and returns structured results using switch expressions (Java 14+).

**Requirements:**
- Parse commands: `help`, `version`, `greet <name>`, `calc <a> <op> <b>`, `exit`
- Use switch expression with `yield` for complex cases
- Handle invalid commands gracefully

**Starter code:**

```java
public class Main {
    static String parseCommand(String input) {
        if (input == null || input.isBlank()) {
            return "Error: empty command";
        }

        String[] parts = input.trim().split("\\s+");
        String command = parts[0].toLowerCase();

        // TODO: Use switch expression to handle each command
        // TODO: Use yield for multi-line cases
        return "TODO";
    }

    public static void main(String[] args) {
        String[] commands = {
            "help",
            "version",
            "greet Alice",
            "calc 10 + 5",
            "calc 20 / 0",
            "unknown",
            ""
        };

        for (String cmd : commands) {
            System.out.printf("'%s' -> %s%n", cmd, parseCommand(cmd));
        }
    }
}
```

**Expected output:**
```
'help' -> Available commands: help, version, greet <name>, calc <a> <op> <b>, exit
'version' -> Version 1.0.0
'greet Alice' -> Hello, Alice!
'calc 10 + 5' -> Result: 15.0
'calc 20 / 0' -> Error: division by zero
'unknown' -> Error: unknown command 'unknown'
'' -> Error: empty command
```

<details>
<summary>Solution</summary>

```java
public class Main {
    static String parseCommand(String input) {
        if (input == null || input.isBlank()) {
            return "Error: empty command";
        }

        String[] parts = input.trim().split("\\s+");
        String command = parts[0].toLowerCase();

        return switch (command) {
            case "help" -> "Available commands: help, version, greet <name>, calc <a> <op> <b>, exit";
            case "version" -> "Version 1.0.0";
            case "exit" -> "Goodbye!";
            case "greet" -> {
                if (parts.length < 2) {
                    yield "Error: greet requires a name";
                }
                yield "Hello, " + parts[1] + "!";
            }
            case "calc" -> {
                if (parts.length < 4) {
                    yield "Error: calc requires <a> <op> <b>";
                }
                try {
                    double a = Double.parseDouble(parts[1]);
                    double b = Double.parseDouble(parts[3]);
                    String op = parts[2];

                    double result = switch (op) {
                        case "+" -> a + b;
                        case "-" -> a - b;
                        case "*" -> a * b;
                        case "/" -> {
                            if (b == 0) throw new ArithmeticException("division by zero");
                            yield a / b;
                        }
                        default -> throw new IllegalArgumentException("unknown operator: " + op);
                    };
                    yield "Result: " + result;
                } catch (NumberFormatException e) {
                    yield "Error: invalid number format";
                } catch (ArithmeticException e) {
                    yield "Error: " + e.getMessage();
                } catch (IllegalArgumentException e) {
                    yield "Error: " + e.getMessage();
                }
            }
            default -> "Error: unknown command '" + command + "'";
        };
    }

    public static void main(String[] args) {
        String[] commands = {
            "help", "version", "greet Alice",
            "calc 10 + 5", "calc 20 / 0", "unknown", ""
        };
        for (String cmd : commands) {
            System.out.printf("'%s' -> %s%n", cmd, parseCommand(cmd));
        }
    }
}
```
</details>

---

### Task 6: Pattern Matching Shape Calculator (Java 21+)

**Difficulty:** Medium
**Estimated time:** 30 minutes

Create a shape hierarchy using sealed interfaces and records, then use pattern matching switch to calculate area and perimeter.

**Requirements:**
- Define sealed interface `Shape` with `Circle`, `Rectangle`, `Triangle` records
- Use pattern matching switch with guarded patterns (`when`)
- Handle edge cases: negative dimensions, degenerate shapes (area = 0)

**Starter code:**

```java
public class Main {
    sealed interface Shape permits Circle, Rectangle, Triangle {}
    record Circle(double radius) implements Shape {}
    record Rectangle(double width, double height) implements Shape {}
    record Triangle(double a, double b, double c) implements Shape {}

    static String describe(Shape shape) {
        // TODO: Use pattern matching switch to calculate area and perimeter
        // TODO: Handle invalid shapes (negative dimensions, impossible triangles)
        return "TODO";
    }

    public static void main(String[] args) {
        Shape[] shapes = {
            new Circle(5),
            new Rectangle(4, 6),
            new Triangle(3, 4, 5),
            new Circle(-1),           // invalid
            new Triangle(1, 1, 100)   // impossible triangle
        };

        for (Shape s : shapes) {
            System.out.println(describe(s));
        }
    }
}
```

<details>
<summary>Solution</summary>

```java
public class Main {
    sealed interface Shape permits Circle, Rectangle, Triangle {}
    record Circle(double radius) implements Shape {}
    record Rectangle(double width, double height) implements Shape {}
    record Triangle(double a, double b, double c) implements Shape {}

    static boolean isValidTriangle(double a, double b, double c) {
        return a + b > c && a + c > b && b + c > a;
    }

    static String describe(Shape shape) {
        return switch (shape) {
            case Circle c when c.radius() <= 0 ->
                "Invalid circle: radius must be positive";
            case Circle c -> {
                double area = Math.PI * c.radius() * c.radius();
                double perimeter = 2 * Math.PI * c.radius();
                yield String.format("Circle: area=%.2f, perimeter=%.2f", area, perimeter);
            }
            case Rectangle r when r.width() <= 0 || r.height() <= 0 ->
                "Invalid rectangle: dimensions must be positive";
            case Rectangle r -> {
                double area = r.width() * r.height();
                double perimeter = 2 * (r.width() + r.height());
                yield String.format("Rectangle: area=%.2f, perimeter=%.2f", area, perimeter);
            }
            case Triangle t when t.a() <= 0 || t.b() <= 0 || t.c() <= 0 ->
                "Invalid triangle: sides must be positive";
            case Triangle t when !isValidTriangle(t.a(), t.b(), t.c()) ->
                "Invalid triangle: sides do not form a valid triangle";
            case Triangle t -> {
                double s = (t.a() + t.b() + t.c()) / 2;
                double area = Math.sqrt(s * (s - t.a()) * (s - t.b()) * (s - t.c()));
                double perimeter = t.a() + t.b() + t.c();
                yield String.format("Triangle: area=%.2f, perimeter=%.2f", area, perimeter);
            }
        };
    }

    public static void main(String[] args) {
        Shape[] shapes = {
            new Circle(5),
            new Rectangle(4, 6),
            new Triangle(3, 4, 5),
            new Circle(-1),
            new Triangle(1, 1, 100)
        };
        for (Shape s : shapes) {
            System.out.println(describe(s));
        }
    }
}
```
</details>

---

### Task 7: Specification Pattern Validator

**Difficulty:** Medium-Hard
**Estimated time:** 40 minutes

Build a composable validation framework using the Specification pattern.

**Requirements:**
- Create a `Validator<T>` functional interface with `and()`, `or()` composition
- Build validators for a `User` record: name not blank, age 18+, email contains @
- Return all validation errors (not just the first one)

**Starter code:**

```java
import java.util.*;
import java.util.function.Predicate;

public class Main {
    record User(String name, int age, String email) {}

    record ValidationError(String field, String message) {}

    // TODO: Create a validation framework
    // Each rule produces Optional<ValidationError>
    // Compose rules and collect all errors

    public static void main(String[] args) {
        User validUser = new User("Alice", 25, "alice@example.com");
        User invalidUser = new User("", 15, "not-an-email");

        // TODO: Validate both users and print results
    }
}
```

<details>
<summary>Solution</summary>

```java
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

public class Main {
    record User(String name, int age, String email) {}
    record ValidationError(String field, String message) {}

    @FunctionalInterface
    interface Validator<T> {
        Optional<ValidationError> validate(T input);

        default Validator<T> and(Validator<T> other) {
            return input -> {
                Optional<ValidationError> result = this.validate(input);
                return result.isPresent() ? result : other.validate(input);
            };
        }
    }

    static List<ValidationError> validateAll(User user, List<Validator<User>> validators) {
        return validators.stream()
            .map(v -> v.validate(user))
            .filter(Optional::isPresent)
            .map(Optional::get)
            .collect(Collectors.toList());
    }

    public static void main(String[] args) {
        List<Validator<User>> validators = List.of(
            user -> (user.name() == null || user.name().isBlank())
                ? Optional.of(new ValidationError("name", "must not be blank"))
                : Optional.empty(),
            user -> user.age() < 18
                ? Optional.of(new ValidationError("age", "must be 18 or older"))
                : Optional.empty(),
            user -> (user.email() == null || !user.email().contains("@"))
                ? Optional.of(new ValidationError("email", "must contain @"))
                : Optional.empty()
        );

        User validUser = new User("Alice", 25, "alice@example.com");
        User invalidUser = new User("", 15, "not-an-email");

        System.out.println("Valid user errors: " + validateAll(validUser, validators));
        System.out.println("Invalid user errors: " + validateAll(invalidUser, validators));
    }
}
```
</details>

---

## Senior Tasks (2)

### Task 8: State Machine with Transition Rules

**Difficulty:** Hard
**Estimated time:** 45 minutes

Implement a configurable state machine for order processing with transition validation.

**Requirements:**
- States: CREATED, PAID, SHIPPED, DELIVERED, CANCELLED, REFUNDED
- Transitions are defined as rules (from -> to with conditions)
- Invalid transitions throw exceptions
- Log all state transitions

**Starter code:**

```java
import java.util.*;

public class Main {
    enum State { CREATED, PAID, SHIPPED, DELIVERED, CANCELLED, REFUNDED }
    enum Event { PAY, SHIP, DELIVER, CANCEL, REFUND }

    // TODO: Implement a state machine with:
    // 1. Transition rules (which events are valid in which states)
    // 2. Transition logging
    // 3. Guard conditions (e.g., can only refund if amount > 0)

    public static void main(String[] args) {
        // TODO: Create a state machine and process events:
        // CREATED -> PAY -> SHIP -> DELIVER
        // CREATED -> CANCEL
        // PAID -> REFUND
    }
}
```

<details>
<summary>Solution</summary>

```java
import java.util.*;

public class Main {
    enum State { CREATED, PAID, SHIPPED, DELIVERED, CANCELLED, REFUNDED }
    enum Event { PAY, SHIP, DELIVER, CANCEL, REFUND }

    record Transition(State from, Event event, State to) {}

    static class StateMachine {
        private State current;
        private final Map<String, State> transitions = new HashMap<>();
        private final List<String> log = new ArrayList<>();

        StateMachine(State initial) {
            this.current = initial;
            log.add("Initial state: " + initial);
        }

        void addTransition(State from, Event event, State to) {
            transitions.put(from + ":" + event, to);
        }

        void fire(Event event) {
            String key = current + ":" + event;
            State next = transitions.get(key);
            if (next == null) {
                String msg = "Invalid transition: " + current + " + " + event;
                log.add("REJECTED: " + msg);
                throw new IllegalStateException(msg);
            }
            log.add(current + " --[" + event + "]--> " + next);
            current = next;
        }

        State getState() { return current; }
        List<String> getLog() { return Collections.unmodifiableList(log); }
    }

    public static void main(String[] args) {
        StateMachine sm = new StateMachine(State.CREATED);

        // Define transitions
        sm.addTransition(State.CREATED, Event.PAY, State.PAID);
        sm.addTransition(State.CREATED, Event.CANCEL, State.CANCELLED);
        sm.addTransition(State.PAID, Event.SHIP, State.SHIPPED);
        sm.addTransition(State.PAID, Event.REFUND, State.REFUNDED);
        sm.addTransition(State.PAID, Event.CANCEL, State.CANCELLED);
        sm.addTransition(State.SHIPPED, Event.DELIVER, State.DELIVERED);

        // Happy path: CREATED -> PAID -> SHIPPED -> DELIVERED
        sm.fire(Event.PAY);
        sm.fire(Event.SHIP);
        sm.fire(Event.DELIVER);

        System.out.println("=== Happy Path ===");
        sm.getLog().forEach(System.out::println);

        // Cancel path
        StateMachine sm2 = new StateMachine(State.CREATED);
        sm2.addTransition(State.CREATED, Event.CANCEL, State.CANCELLED);
        sm2.fire(Event.CANCEL);

        System.out.println("\n=== Cancel Path ===");
        sm2.getLog().forEach(System.out::println);

        // Invalid transition
        StateMachine sm3 = new StateMachine(State.CREATED);
        sm3.addTransition(State.CREATED, Event.PAY, State.PAID);
        try {
            sm3.fire(Event.SHIP); // invalid: can't ship from CREATED
        } catch (IllegalStateException e) {
            System.out.println("\n=== Invalid Transition ===");
            System.out.println("Caught: " + e.getMessage());
        }
        sm3.getLog().forEach(System.out::println);
    }
}
```
</details>

---

### Task 9: Rule Engine with Priority and Short-Circuit

**Difficulty:** Hard
**Estimated time:** 50 minutes

Build a mini rule engine that evaluates prioritized rules with short-circuit support.

**Requirements:**
- Rules have priority (lower number = higher priority)
- Rules can be "blocking" — if a blocking rule matches, stop evaluation
- Collect all matching non-blocking rules
- Use functional interfaces for rule conditions

<details>
<summary>Solution</summary>

```java
import java.util.*;
import java.util.function.Predicate;
import java.util.stream.Collectors;

public class Main {
    record Order(String customerId, double total, String country, int itemCount) {}

    record Rule(String name, int priority, boolean blocking, Predicate<Order> condition, String action) {}

    static List<String> evaluate(Order order, List<Rule> rules) {
        List<Rule> sorted = rules.stream()
            .sorted(Comparator.comparingInt(Rule::priority))
            .toList();

        List<String> actions = new ArrayList<>();
        for (Rule rule : sorted) {
            if (rule.condition().test(order)) {
                actions.add(rule.name() + ": " + rule.action());
                if (rule.blocking()) {
                    actions.add("[BLOCKED by " + rule.name() + " — remaining rules skipped]");
                    break;
                }
            }
        }
        return actions;
    }

    public static void main(String[] args) {
        List<Rule> rules = List.of(
            new Rule("Fraud check", 1, true,
                o -> o.total() > 10000 && o.itemCount() > 50,
                "BLOCK: suspected fraud"),
            new Rule("VIP discount", 2, false,
                o -> o.total() > 500, "Apply 10% discount"),
            new Rule("Free shipping", 3, false,
                o -> o.total() > 100, "Free shipping"),
            new Rule("EU tax", 4, false,
                o -> Set.of("DE", "FR", "NL").contains(o.country()),
                "Apply EU VAT"),
            new Rule("Blacklisted country", 1, true,
                o -> Set.of("XX", "YY").contains(o.country()),
                "REJECT: blacklisted country")
        );

        Order normalOrder = new Order("C1", 250, "DE", 3);
        Order bigOrder = new Order("C2", 15000, "US", 100);
        Order blockedOrder = new Order("C3", 50, "XX", 1);

        System.out.println("=== Normal Order ===");
        evaluate(normalOrder, rules).forEach(System.out::println);

        System.out.println("\n=== Suspicious Order ===");
        evaluate(bigOrder, rules).forEach(System.out::println);

        System.out.println("\n=== Blocked Country ===");
        evaluate(blockedOrder, rules).forEach(System.out::println);
    }
}
```
</details>

---

## Questions

### 1. Why does `switch` not support `long` in Java?

**Answer:**
The `switch` bytecode instructions (`tableswitch` and `lookupswitch`) operate on `int` values only. `long` values cannot fit in the 32-bit int instruction set. Supporting `long` would require new bytecode instructions or a different compilation strategy, which the JVM specification does not include.

---

### 2. What is the difference between `switch` statement and `switch` expression?

**Answer:**
A switch statement executes code blocks and does not return a value. A switch expression (Java 14+) returns a value, uses `->` syntax, has no fall-through, and must be exhaustive.

---

### 3. When should you replace if-else with polymorphism?

**Answer:**
When you have conditionals that check the type of an object to decide behavior, and the set of types is stable. If you find yourself writing `if (obj instanceof TypeA) { doA(); } else if (obj instanceof TypeB) { doB(); }`, consider moving `doA()` and `doB()` into `TypeA` and `TypeB` as overridden methods.

---

### 4. What is the Specification pattern and when should you use it?

**Answer:**
The Specification pattern encapsulates business rules as composable predicate objects. Use it when you have complex conditional rules that are combined with AND/OR logic and need to be independently testable and modifiable. It is overkill for simple if-else.

---

### 5. How does the JIT compiler optimize switch statements?

**Answer:**
The JIT can convert `lookupswitch` to `tableswitch` if the range is small enough, eliminate dead cases that are never taken (profile-guided), and inline the matching case body. For pattern matching switch, the JIT optimizes the `invokedynamic` bootstrap to direct type checks.

---

## Mini Projects

### Project 1: Interactive CLI Menu System

**Goal:** Build a command-line application with a multi-level menu system driven entirely by conditionals.

**Description:**
Build a personal finance tracker with a menu-driven CLI. The user navigates through menus and performs actions.

**Requirements:**
- [ ] Main menu: Add Income, Add Expense, View Summary, Exit
- [ ] Each submenu has its own switch-based logic
- [ ] Use switch expressions (Java 14+) for menu dispatch
- [ ] Validate all user input with guard clauses
- [ ] Store transactions in an `ArrayList`
- [ ] View Summary shows: total income, total expenses, balance

**Difficulty:** Junior-Middle
**Estimated time:** 2 hours

---

### Project 2: JSON-like Object Formatter with Pattern Matching

**Goal:** Build a formatter that converts different Java types to a JSON-like string representation using pattern matching switch.

**Description:**
Accept `Object` values and format them as JSON-like strings.

**Requirements:**
- [ ] Handle: `null`, `String`, `Integer`, `Double`, `Boolean`, `List`, `Map`
- [ ] Use pattern matching switch (Java 21+)
- [ ] Lists format as `[elem1, elem2, ...]`
- [ ] Maps format as `{key1: val1, key2: val2}`
- [ ] Handle nested structures recursively
- [ ] Write at least 5 test cases

**Difficulty:** Middle
**Estimated time:** 2 hours

---

## Challenge

### Conditional Logic Optimizer

**Problem:** Given a list of conditional rules as data (condition + action pairs), write a program that:
1. Evaluates rules in priority order
2. Supports AND/OR composition of conditions
3. Returns the first matching rule's action
4. Benchmarks: evaluate 1 million records against 100 rules in under 1 second

**Constraints:**
- No external libraries (only JDK)
- Must complete 1M evaluations in under 1000ms on a modern laptop
- Memory usage under 100 MB

**Scoring:**
- Correctness: 50%
- Performance (measured with `System.nanoTime()`): 30%
- Code quality and readability: 20%
