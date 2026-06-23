# Java Conditionals — Interview Questions

---

## Junior Level (5-7 Questions)

### Q1: What are the conditional statements available in Java?

<details>
<summary>Answer</summary>

Java provides the following conditional constructs:

1. **`if`** — executes a block if a condition is `true`
2. **`if-else`** — executes one block if `true`, another if `false`
3. **`if-else if-else`** — chains multiple conditions
4. **`switch`** — selects one of many code blocks based on a value
5. **`ternary operator (?:)`** — inline conditional expression

```java
public class Conditionals {
    public static void main(String[] args) {
        int score = 85;

        // if-else if-else
        if (score >= 90) {
            System.out.println("Grade: A");
        } else if (score >= 80) {
            System.out.println("Grade: B");
        } else {
            System.out.println("Grade: C");
        }

        // switch
        String day = "MON";
        switch (day) {
            case "MON": System.out.println("Monday"); break;
            case "TUE": System.out.println("Tuesday"); break;
            default: System.out.println("Other day");
        }

        // ternary
        String status = (score >= 60) ? "Pass" : "Fail";
        System.out.println("Status: " + status);
    }
}
```
</details>

### Q2: What is the difference between `==` and `.equals()` when used in conditions?

<details>
<summary>Answer</summary>

- `==` compares **references** (memory addresses) for objects, and **values** for primitives.
- `.equals()` compares the **content/value** of objects.

```java
public class EqualityDemo {
    public static void main(String[] args) {
        // Primitives — use ==
        int a = 5, b = 5;
        System.out.println(a == b); // true

        // Strings — use .equals()
        String s1 = new String("hello");
        String s2 = new String("hello");
        System.out.println(s1 == s2);      // false (different objects)
        System.out.println(s1.equals(s2)); // true  (same content)

        // String pool — tricky case
        String s3 = "hello";
        String s4 = "hello";
        System.out.println(s3 == s4); // true (same pool reference)
    }
}
```

Rule: Always use `.equals()` for object comparison in conditions. Using `==` for String comparison is a classic bug source.
</details>

### Q3: What happens if you omit the `break` statement in a `switch` case?

<details>
<summary>Answer</summary>

Without `break`, execution **falls through** to the next case, executing all subsequent case blocks until a `break` is encountered or the switch ends.

```java
public class FallThroughDemo {
    public static void main(String[] args) {
        int day = 2;
        switch (day) {
            case 1: System.out.println("Monday");
            case 2: System.out.println("Tuesday");    // matches here
            case 3: System.out.println("Wednesday");   // falls through
            case 4: System.out.println("Thursday");    // falls through
            default: System.out.println("Other");      // falls through
        }
        // Output:
        // Tuesday
        // Wednesday
        // Thursday
        // Other
    }
}
```

Fall-through is sometimes intentional to group cases:
```java
switch (month) {
    case 12: case 1: case 2:
        System.out.println("Winter");
        break;
    case 3: case 4: case 5:
        System.out.println("Spring");
        break;
}
```

This is one of the most common interview trap questions about switch statements.
</details>

### Q4: Can you use a `switch` statement with `String` values? What types does `switch` support?

<details>
<summary>Answer</summary>

Yes, `switch` supports `String` since **Java 7**.

```java
public class SwitchTypesDemo {
    enum Season { SPRING, SUMMER, FALL, WINTER }

    public static void main(String[] args) {
        // Switch on String (Java 7+)
        String command = "start";
        switch (command) {
            case "start":   System.out.println("Starting..."); break;
            case "stop":    System.out.println("Stopping..."); break;
            case "restart": System.out.println("Restarting..."); break;
            default:        System.out.println("Unknown command");
        }

        // Switch on enum (Java 5+)
        Season s = Season.SUMMER;
        switch (s) {
            case SUMMER: System.out.println("Hot"); break;
            case WINTER: System.out.println("Cold"); break;
            default:     System.out.println("Mild");
        }
    }
}
```

Supported types in `switch`:
- `byte`, `short`, `char`, `int` (and their wrappers: `Byte`, `Short`, `Character`, `Integer`)
- `String` (Java 7+)
- `enum` (Java 5+)

**Not supported:** `long`, `float`, `double`, `boolean`

Under the hood, the compiler uses `String.hashCode()` for the initial lookup and then `String.equals()` for verification (to handle hash collisions).
</details>

### Q5: What is the ternary operator? When should you use it vs `if-else`?

<details>
<summary>Answer</summary>

The ternary operator is a shorthand conditional expression: `condition ? valueIfTrue : valueIfFalse`.

```java
public class TernaryDemo {
    public static void main(String[] args) {
        int age = 20;

        // Ternary — good for simple assignments
        String status = (age >= 18) ? "Adult" : "Minor";
        System.out.println(status); // Adult

        int a = 10, b = 20;
        int max = (a > b) ? a : b;
        System.out.println("Max: " + max); // 20

        // Bad — nested ternary is hard to read
        int score = 85;
        // String grade = (score >= 90) ? "A" : (score >= 80) ? "B" : (score >= 70) ? "C" : "F";

        // Better — use if-else for multiple conditions
        String grade;
        if (score >= 90) grade = "A";
        else if (score >= 80) grade = "B";
        else if (score >= 70) grade = "C";
        else grade = "F";
        System.out.println("Grade: " + grade);
    }
}
```

**Use ternary when:** Simple value assignment with two outcomes.
**Use if-else when:** Logic is complex, has side effects, or requires more than two branches.
</details>

### Q6: What data types can be used as a condition in an `if` statement?

<details>
<summary>Answer</summary>

Only `boolean` and `Boolean` (auto-unboxed) can be used as conditions in Java.

```java
public class ConditionTypeDemo {
    public static void main(String[] args) {
        // Valid
        boolean flag = true;
        if (flag) System.out.println("flag is true");

        if (10 > 5) System.out.println("comparison returns boolean");

        Boolean wrapped = Boolean.TRUE;
        if (wrapped) System.out.println("auto-unboxed to boolean");

        // Invalid — unlike C/C++, Java does NOT treat integers as booleans
        // int x = 1;
        // if (x) { } // COMPILATION ERROR: incompatible types

        // Invalid — strings are not booleans
        // String s = "true";
        // if (s) { } // COMPILATION ERROR

        // Pitfall with Boolean wrapper
        Boolean nullFlag = null;
        // if (nullFlag) { } // NullPointerException at runtime!
    }
}
```

This is a key difference from C/C++/JavaScript where `0`, `null`, `""` are "falsy" values. Java requires an explicit boolean expression.
</details>

### Q7: What is short-circuit evaluation in Java conditionals?

<details>
<summary>Answer</summary>

Short-circuit evaluation means Java stops evaluating a logical expression as soon as the result is determined:

- `&&` (AND): If the left side is `false`, the right side is **not evaluated** (result is already `false`).
- `||` (OR): If the left side is `true`, the right side is **not evaluated** (result is already `true`).

```java
public class ShortCircuitDemo {
    public static void main(String[] args) {
        // Short-circuit prevents NullPointerException
        String name = null;
        if (name != null && name.length() > 5) {
            System.out.println("Long name");
        } else {
            System.out.println("Name is null or short");
        }

        // Without short-circuit (&), it would crash
        // if (name != null & name.length() > 5) { }
        // NullPointerException! Both sides always evaluated

        // Short-circuit with ||
        boolean cached = true;
        if (cached || expensiveDatabaseCall()) {
            System.out.println("Using cached value");
            // expensiveDatabaseCall() is never called
        }
    }

    static boolean expensiveDatabaseCall() {
        System.out.println("Database called!");
        return false;
    }
}
```

Non-short-circuit operators `&` and `|` always evaluate both sides. They are primarily used for bitwise operations on integers.
</details>

---

## Middle Level (4-6 Questions)

### Q1: What are switch expressions (Java 14+) and how do they differ from traditional switch statements?

<details>
<summary>Answer</summary>

Switch expressions (preview in Java 12-13, standard in Java 14) return a value, use arrow syntax (`->`), have no fall-through, and must be exhaustive.

```java
public class SwitchExpressionDemo {
    public static void main(String[] args) {
        int day = 3;

        // Traditional switch statement
        String name1;
        switch (day) {
            case 1: name1 = "Monday"; break;
            case 2: name1 = "Tuesday"; break;
            case 3: name1 = "Wednesday"; break;
            default: name1 = "Other"; break;
        }

        // Switch expression (Java 14+)
        String name2 = switch (day) {
            case 1 -> "Monday";
            case 2 -> "Tuesday";
            case 3 -> "Wednesday";
            default -> "Other";
        };

        System.out.println(name1 + " = " + name2); // Wednesday = Wednesday

        // Multiple labels and yield for blocks
        String dayType = switch (day) {
            case 1, 2, 3, 4, 5 -> "Weekday";
            case 6, 7 -> "Weekend";
            default -> {
                System.out.println("Invalid day");
                yield "Unknown"; // yield returns value from block
            }
        };
        System.out.println("Day type: " + dayType);
    }
}
```

| Feature | Switch Statement | Switch Expression |
|---------|:---------------:|:-----------------:|
| Returns value | No | Yes |
| Fall-through | Yes (needs `break`) | No |
| Exhaustive | No | Yes (compiler-checked) |
| Multiple labels | `case 1: case 2:` | `case 1, 2 ->` |
| Block body | `:` + `break` | `-> { yield value; }` |
</details>

### Q2: What is pattern matching for `instanceof` (Java 16+)? How does it improve conditional logic?

<details>
<summary>Answer</summary>

Pattern matching eliminates redundant casting after `instanceof` checks:

```java
public class PatternMatchingDemo {
    public static void main(String[] args) {
        Object obj = "Hello, World!";

        // Before Java 16 — verbose and repetitive
        if (obj instanceof String) {
            String s = (String) obj;  // explicit cast required
            System.out.println("Length: " + s.length());
        }

        // Java 16+ — pattern variable (s is already cast)
        if (obj instanceof String s) {
            System.out.println("Length: " + s.length());
        }

        // Works with logical operators
        if (obj instanceof String s && s.length() > 5) {
            System.out.println("Long string: " + s.toUpperCase());
        }

        // Negation pattern — flow scoping
        if (!(obj instanceof String s)) {
            System.out.println("Not a string");
            return;
        }
        // s IS in scope here due to flow scoping
        System.out.println("It is a string: " + s);
    }

    // Switch with pattern matching (Java 21)
    static String describe(Object obj) {
        return switch (obj) {
            case Integer i when i < 0 -> "Negative: " + i;
            case Integer i            -> "Integer: " + i;
            case String s             -> "String: " + s;
            case null                 -> "null";
            default                   -> "Unknown: " + obj.getClass().getSimpleName();
        };
    }
}
```

Key benefits:
- Eliminates redundant casts (reduces boilerplate)
- Prevents `ClassCastException` from mismatched casts
- Enables powerful switch pattern matching (Java 21)
</details>

### Q3: How do you handle `null` values safely in conditional logic? What patterns do you use?

<details>
<summary>Answer</summary>

Multiple strategies for null-safe conditionals:

```java
import java.util.Objects;
import java.util.Optional;

public class NullSafetyDemo {
    record Address(String city) {}
    record User(String name, Address address) {}

    public static void main(String[] args) {
        User user = new User("Alice", null);

        // 1. Null check first (traditional)
        if (user != null
                && user.address() != null
                && user.address().city() != null) {
            System.out.println(user.address().city().toUpperCase());
        }

        // 2. Optional chain (Java 8+)
        String city = Optional.ofNullable(user)
            .map(User::address)
            .map(Address::city)
            .map(String::toUpperCase)
            .orElse("Unknown");
        System.out.println("City: " + city);

        // 3. Objects.requireNonNull — fail-fast validation
        try {
            Objects.requireNonNull(user.address(), "address must not be null");
        } catch (NullPointerException e) {
            System.out.println("Caught: " + e.getMessage());
        }

        // 4. Yoda conditions — avoids NPE if variable is null
        String status = null;
        if ("ACTIVE".equals(status)) {
            System.out.println("Active");
        } else {
            System.out.println("Not active (status is null)");
        }

        // 5. Switch with null (Java 21+)
        // String result = switch (status) {
        //     case null    -> "null!";
        //     case "ACTIVE" -> "Active";
        //     default      -> "other";
        // };
    }
}
```

Best practice: Prefer `Optional` for return types, `requireNonNull` for parameters, and avoid returning `null` from methods whenever possible.
</details>

### Q4: Explain the difference between `if-else if` chains and `switch` in terms of performance and readability.

<details>
<summary>Answer</summary>

**Performance comparison:**

```java
public class IfVsSwitchDemo {
    // if-else — sequential evaluation: O(n) worst case
    static String classifyIfElse(int code) {
        if (code == 200) return "OK";
        else if (code == 301) return "Moved";
        else if (code == 404) return "Not Found";
        else if (code == 500) return "Server Error";
        else return "Unknown";
    }

    // switch — compiled to tableswitch or lookupswitch bytecode
    static String classifySwitch(int code) {
        return switch (code) {
            case 200 -> "OK";
            case 301 -> "Moved";
            case 404 -> "Not Found";
            case 500 -> "Server Error";
            default  -> "Unknown";
        };
    }

    public static void main(String[] args) {
        System.out.println(classifyIfElse(404)); // Not Found
        System.out.println(classifySwitch(404)); // Not Found
    }
}
```

| Bytecode | When Used | Performance |
|----------|-----------|-------------|
| `tableswitch` | Dense/consecutive values (1,2,3,4,5) | O(1) — direct jump table |
| `lookupswitch` | Sparse values (1, 100, 999) | O(log n) — binary search |
| `if-else` | Any condition type | O(n) — sequential checks |

**When to use `switch`:**
- Comparing one variable against multiple constant values
- Enum dispatching
- When you want exhaustiveness checking

**When to use `if-else`:**
- Range checks: `if (x > 0 && x < 100)`
- Different variables: `if (a > b && c < d)`
- Complex boolean logic
- Non-constant comparisons: `if (x.equals(dynamicValue))`
</details>

### Q5: What are guard patterns in switch (Java 21+)?

<details>
<summary>Answer</summary>

Guard patterns add a `when` clause to switch cases, allowing additional boolean conditions after a type pattern:

```java
public class GuardPatternDemo {
    static String classify(Object obj) {
        return switch (obj) {
            case Integer i when i < 0    -> "Negative integer: " + i;
            case Integer i when i == 0   -> "Zero";
            case Integer i               -> "Positive integer: " + i;
            case String s when s.isEmpty() -> "Empty string";
            case String s when s.length() > 10 -> "Long string: " + s.substring(0, 10) + "...";
            case String s                -> "String: " + s;
            case null                    -> "null";
            default                      -> "Other: " + obj.getClass().getSimpleName();
        };
    }

    public static void main(String[] args) {
        System.out.println(classify(-5));              // Negative integer: -5
        System.out.println(classify(0));               // Zero
        System.out.println(classify(42));              // Positive integer: 42
        System.out.println(classify(""));              // Empty string
        System.out.println(classify("Hello World!!!")); // Long string: Hello Worl...
        System.out.println(classify("Hi"));            // String: Hi
        System.out.println(classify(null));             // null
        System.out.println(classify(3.14));            // Other: Double
    }
}
```

**Order matters** — more specific guarded cases must come before general ones:
```java
// Correct: specific guard first
case Integer i when i < 0 -> "negative";
case Integer i             -> "non-negative";

// Compile error: unreachable pattern
// case Integer i             -> "any int";
// case Integer i when i < 0 -> "negative"; // never reached!
```

Guards replace chains of `instanceof` + nested `if` statements with clean, declarative logic.
</details>

### Q6: How does the JVM optimize conditional branches? What is branch prediction?

<details>
<summary>Answer</summary>

The JVM and CPU work together to optimize conditional branches:

**1. JIT Profile-Guided Optimization:**

```java
public class BranchOptimizationDemo {
    // If 99% of calls pass positive values, the JIT:
    // - Places "positive" as the fall-through path (no jump needed)
    // - Replaces "negative" with an uncommon trap
    static String classify(int x) {
        if (x > 0) return "positive";  // hot path — optimized
        return "negative or zero";     // cold path — uncommon trap
    }

    public static void main(String[] args) {
        // Warm up — JIT profiles the hot path
        for (int i = 1; i <= 100_000; i++) {
            classify(i);
        }
        System.out.println(classify(42));  // fast path
        System.out.println(classify(-1));  // triggers deoptimization
    }
}
```

**2. CPU Branch Prediction:**
- Modern CPUs predict which branch will be taken before the condition is evaluated
- A misprediction costs 10-20 CPU cycles (pipeline flush)
- Sorted data makes branch prediction much more effective

**3. Practical impact — sorted vs unsorted data:**
```java
int[] data = new int[100_000];
// Fill with random values 0-255

int sum = 0;
for (int val : data) {
    if (val >= 128) {  // branch prediction works well on sorted data
        sum += val;
    }
}
// Sorted: prediction accuracy ~100% (consistent pattern)
// Unsorted: prediction accuracy ~50% (random → many mispredictions)
// Sorted version can be 2-6x faster due to fewer pipeline stalls
```

**4. Branchless optimization:**
The JIT compiler may convert simple ternary expressions to `cmov` (conditional move) instructions, which have no branch and no misprediction penalty.
</details>

---

## Senior Level (4-6 Questions)

### Q1: How does the JVM compile `switch` statements to bytecode? Explain `tableswitch` vs `lookupswitch`.

<details>
<summary>Answer</summary>

The Java compiler chooses between two bytecode instructions based on the density of case values:

**`tableswitch` — dense cases (O(1) lookup):**
```java
// Consecutive values compile to tableswitch
static String denseSwitch(int x) {
    return switch (x) {
        case 0 -> "zero";
        case 1 -> "one";
        case 2 -> "two";
        case 3 -> "three";
        default -> "other";
    };
}
// Bytecode: tableswitch 0 to 3
//   0: goto Label0   (direct indexed jump table)
//   1: goto Label1
//   2: goto Label2
//   3: goto Label3
//   default: goto DefaultLabel
```

**`lookupswitch` — sparse cases (O(log n) binary search):**
```java
// Non-consecutive values compile to lookupswitch
static String sparseSwitch(int x) {
    return switch (x) {
        case 1   -> "a";
        case 100 -> "b";
        case 999 -> "c";
        default  -> "other";
    };
}
// Bytecode: lookupswitch 3
//   1:   goto Label0   (sorted key-offset pairs)
//   100: goto Label1
//   999: goto Label2
//   default: goto DefaultLabel
```

**Compiler decision heuristic:** if `(highValue - lowValue + 1) <= 2 * numberOfCases`, use `tableswitch`; otherwise use `lookupswitch`.

**String switch compilation — two-step process:**
1. `lookupswitch` on `str.hashCode()` to find candidate cases
2. `if` + `String.equals()` to verify (handles hash collisions)

**Enum switch compilation:**
Uses the enum's `ordinal()` (an `int`) to build a `tableswitch`. This is why enum switches are the fastest.

```bash
# Verify bytecode with javap
javac SwitchDemo.java
javap -c SwitchDemo.class
```

**JIT further optimizations:**
- May convert `lookupswitch` to `tableswitch` if profitable
- May convert to binary `if-else` tree for small case counts
- Inlines and devirtualizes based on profiling data
</details>

### Q2: How do sealed classes enable exhaustive `switch` expressions? What are the implications for API design?

<details>
<summary>Answer</summary>

Sealed classes (Java 17) restrict which classes can extend a type, enabling the compiler to verify exhaustiveness at compile time:

```java
public class SealedSwitchDemo {
    sealed interface Shape permits Circle, Rectangle, Triangle {}
    record Circle(double radius) implements Shape {}
    record Rectangle(double width, double height) implements Shape {}
    record Triangle(double a, double b, double c) implements Shape {}

    // No default needed — compiler knows all subtypes
    static double area(Shape shape) {
        return switch (shape) {
            case Circle c    -> Math.PI * c.radius() * c.radius();
            case Rectangle r -> r.width() * r.height();
            case Triangle t  -> {
                double s = (t.a() + t.b() + t.c()) / 2;
                yield Math.sqrt(s * (s - t.a()) * (s - t.b()) * (s - t.c()));
            }
        };
    }

    public static void main(String[] args) {
        System.out.printf("Circle area: %.2f%n", area(new Circle(5)));
        System.out.printf("Rect area: %.2f%n", area(new Rectangle(4, 6)));
        System.out.printf("Triangle area: %.2f%n", area(new Triangle(3, 4, 5)));
    }
}
```

**If you add a new permitted subtype (e.g., `Pentagon`), all switch expressions fail at compile time** — forcing you to handle the new case. This is much safer than `default` silently swallowing new types.

**API Design Implications:**

1. **Algebraic Data Types (ADTs):** Sealed classes bring sum types to Java:
   ```java
   sealed interface Result<T> permits Success, Failure {}
   record Success<T>(T value) implements Result<T> {}
   record Failure<T>(String error) implements Result<T> {}
   ```

2. **Visitor Pattern replacement:** Sealed + pattern matching eliminates the Visitor pattern boilerplate entirely.

3. **Library evolution risk:** Adding a permitted subtype is a **binary-incompatible** change. Existing compiled switch expressions will throw `IncompatibleClassChangeError` at runtime. Sealed hierarchies in public APIs must be evolved carefully.

4. **Module boundaries:** Permitted subtypes must be in the same module (or package if no modules), constraining physical architecture.
</details>

### Q3: How would you design a rule engine using modern Java conditionals? Compare approaches for extensibility and performance.

<details>
<summary>Answer</summary>

A rule engine evaluates conditions and executes actions. Three approaches with different trade-offs:

**1. If-else chain (simple, not extensible):**
```java
// Adding new rules requires modifying this method — violates Open/Closed Principle
double calculateDiscount(Order order) {
    if (order.getTotal() > 1000 && order.isVip()) return 0.20;
    else if (order.getTotal() > 500) return 0.10;
    else if (order.getItems().size() > 10) return 0.05;
    else return 0.0;
}
```

**2. Strategy Pattern + Chain of Responsibility:**
```java
import java.util.*;
import java.util.function.Function;

public class RuleEngineDemo {
    record Order(double total, int itemCount, boolean vip) {}

    @FunctionalInterface
    interface DiscountRule {
        Optional<Double> evaluate(Order order);
    }

    public static void main(String[] args) {
        List<DiscountRule> rules = List.of(
            order -> order.total() > 1000 && order.vip()
                ? Optional.of(0.20) : Optional.empty(),
            order -> order.total() > 500
                ? Optional.of(0.10) : Optional.empty(),
            order -> order.itemCount() > 10
                ? Optional.of(0.05) : Optional.empty()
        );

        Order order = new Order(750.0, 5, false);
        double discount = rules.stream()
            .map(rule -> rule.evaluate(order))
            .filter(Optional::isPresent)
            .map(Optional::get)
            .findFirst()
            .orElse(0.0);
        System.out.printf("Discount: %.0f%%%n", discount * 100); // 10%
    }
}
```

**3. Sealed classes + Pattern Matching (Java 21+):**
```java
sealed interface Rule permits ThresholdRule, VipRule, BulkRule {}
record ThresholdRule(double minTotal, double discount) implements Rule {}
record VipRule(double discount) implements Rule {}
record BulkRule(int minItems, double discount) implements Rule {}

double applyRule(Rule rule, Order order) {
    return switch (rule) {
        case ThresholdRule t when order.getTotal() >= t.minTotal() -> t.discount();
        case VipRule v when order.isVip() -> v.discount();
        case BulkRule b when order.getItems().size() >= b.minItems() -> b.discount();
        default -> 0.0;
    };
}
```

**Comparison:**

| Aspect | If-else | Strategy/Chain | Sealed + Pattern |
|--------|---------|---------------|------------------|
| Extensibility | Poor | Good (add to list) | Good (add record) |
| Type safety | Low | Medium | High (exhaustive switch) |
| Performance | Fast (JIT inlines) | Overhead (lambdas, streams) | Fast (JIT optimizes sealed) |
| Testability | Hard (monolithic) | Easy (isolated rules) | Easy (isolated records) |
| Compile-time safety | None | None | Exhaustiveness check |
</details>

### Q4: What are the performance implications of autoboxing and unboxing in conditional expressions?

<details>
<summary>Answer</summary>

Autoboxing in conditionals causes subtle bugs and performance issues:

**1. NullPointerException from unboxing:**
```java
public class AutoboxingPitfalls {
    public static void main(String[] args) {
        // NPE from Boolean unboxing
        Boolean flag = null;
        // if (flag) { } // NullPointerException! Unboxing null crashes

        // NPE from Integer unboxing
        Integer count = null;
        // if (count > 0) { } // NullPointerException!

        // 2. Ternary operator type coercion
        Integer a = null;
        int b = 5;
        // int result = true ? a : b; // NPE! Ternary forces unboxing of a
        // Both sides unbox to int because one operand is primitive int

        // 3. Unexpected identity behavior with Integer cache
        Integer x = 127, y = 127;
        System.out.println(x == y); // true (Integer cache: -128 to 127)

        Integer p = 128, q = 128;
        System.out.println(p == q); // false! Different objects beyond cache range

        // Always use .equals() for wrapper comparison
        System.out.println(p.equals(q)); // true

        // 4. Performance in tight loops
        long start = System.nanoTime();
        long sum = 0L; // primitive — fast
        for (int i = 0; i < 1_000_000; i++) {
            if (i % 2 == 0) {
                sum += i; // no boxing overhead
            }
        }
        long elapsed = System.nanoTime() - start;
        System.out.println("Primitive sum: " + sum + " in " + elapsed / 1_000_000 + "ms");

        // Using Long wrapper instead would be ~5x slower due to boxing on every += operation
    }
}
```

**5. Ternary return type widening:**
```java
int x = 1;
double y = 2.0;
var result = true ? x : y; // always double! (1.0, not 1)
// Ternary promotes to the wider numeric type
```

Best practice: Use primitives in conditionals and hot paths. If nullable wrappers are unavoidable, always null-check before comparison or unboxing.
</details>

### Q5: What is the difference between megamorphic dispatch and pattern matching switch for conditional logic? When does each perform better?

<details>
<summary>Answer</summary>

HotSpot C2 JIT optimizes call sites based on the number of observed types:

- **Monomorphic (1 type):** Inlined directly — fastest
- **Bimorphic (2 types):** Inline cache with type check — fast
- **Megamorphic (3+ types):** Virtual method table (vtable) lookup — slower

```java
public class DispatchDemo {
    interface Handler { String handle(); }
    static class TypeA implements Handler { public String handle() { return "A"; } }
    static class TypeB implements Handler { public String handle() { return "B"; } }
    static class TypeC implements Handler { public String handle() { return "C"; } }
    static class TypeD implements Handler { public String handle() { return "D"; } }

    // Polymorphic dispatch — becomes megamorphic with 3+ types
    static String polymorphicDispatch(Handler h) {
        return h.handle(); // vtable lookup when megamorphic
    }

    // Pattern matching — JIT can optimize sealed type switches
    sealed interface TypedHandler permits HandlerA, HandlerB, HandlerC, HandlerD {}
    record HandlerA() implements TypedHandler {}
    record HandlerB() implements TypedHandler {}
    record HandlerC() implements TypedHandler {}
    record HandlerD() implements TypedHandler {}

    static String patternSwitch(TypedHandler h) {
        return switch (h) {
            case HandlerA a -> "A";
            case HandlerB b -> "B";
            case HandlerC c -> "C";
            case HandlerD d -> "D";
        };
    }

    public static void main(String[] args) {
        // Megamorphic dispatch
        Handler[] handlers = { new TypeA(), new TypeB(), new TypeC(), new TypeD() };
        for (Handler h : handlers) {
            System.out.println("Poly: " + polymorphicDispatch(h));
        }

        // Pattern matching dispatch
        TypedHandler[] typed = { new HandlerA(), new HandlerB(), new HandlerC(), new HandlerD() };
        for (TypedHandler h : typed) {
            System.out.println("Pattern: " + patternSwitch(h));
        }
    }
}
```

**When polymorphism is better:**
- Adding new types frequently (Open/Closed Principle)
- Behavior belongs with the data (OOP)
- Few types at each call site (mono/bimorphic)

**When pattern matching switch is better:**
- Adding new operations frequently
- Types are stable (sealed hierarchy)
- Many types at a single call site (avoids megamorphic penalty)
- Need exhaustiveness checking at compile time
</details>

---

## Scenario-Based Questions (3-5)

### Scenario 1: A junior developer wrote a method that classifies HTTP status codes using a 40+ line `if-else` chain. The code is correct but unmaintainable. How would you refactor it?

<details>
<summary>Answer</summary>

Step-by-step refactoring approach:

**1. Identify the pattern — range-based classification:**
```java
// Before: 40+ conditions
if (code == 200) return "OK";
else if (code == 201) return "Created";
else if (code == 204) return "No Content";
// ... 37 more conditions
```

**2. Group by category using range checks:**
```java
String classifyRange(int code) {
    return switch (code / 100) {
        case 1 -> "Informational";
        case 2 -> "Success";
        case 3 -> "Redirection";
        case 4 -> "Client Error";
        case 5 -> "Server Error";
        default -> "Unknown";
    };
}
```

**3. Use an enum for specific codes:**
```java
import java.util.*;
import java.util.stream.Collectors;
import java.util.function.Function;

public class HttpStatusRefactored {
    enum HttpStatus {
        OK(200, "OK"),
        CREATED(201, "Created"),
        NO_CONTENT(204, "No Content"),
        BAD_REQUEST(400, "Bad Request"),
        NOT_FOUND(404, "Not Found"),
        INTERNAL_ERROR(500, "Internal Server Error");

        final int code;
        final String description;
        private static final Map<Integer, HttpStatus> BY_CODE =
            Arrays.stream(values())
                  .collect(Collectors.toMap(s -> s.code, Function.identity()));

        HttpStatus(int code, String description) {
            this.code = code;
            this.description = description;
        }

        static HttpStatus fromCode(int code) {
            return BY_CODE.get(code);
        }
    }

    public static void main(String[] args) {
        HttpStatus status = HttpStatus.fromCode(404);
        System.out.println(status != null ? status.description : "Unknown"); // Not Found
    }
}
```

**4. For varying business logic per code, use a strategy map:**
```java
Map<Integer, Consumer<Response>> handlers = Map.of(
    200, this::handleSuccess,
    404, this::handleNotFound,
    500, this::handleServerError
);
handlers.getOrDefault(statusCode, this::handleDefault).accept(response);
```

Key principles applied:
- Replace magic numbers with named constants (enum)
- Replace if-else chains with data structures (Map lookup is O(1))
- Open/Closed Principle — adding new codes requires only adding enum values
</details>

### Scenario 2: In production, you notice a `NullPointerException` occurring intermittently in a conditional block that has been working for months. The code looks correct. How do you diagnose and fix it?

<details>
<summary>Answer</summary>

**Systematic diagnosis approach:**

**1. Reproduce and identify the exact line:**
```java
// Suspect code — method chain where any link can return null
public String processOrder(Order order) {
    if (order.getCustomer().getAddress().getCity().equals("NYC")) {
        return applyNYCTax(order);
    }
    return applyDefaultTax(order);
}
```

**2. Identify all potential null sources in the chain:**
- `order` itself could be null
- `order.getCustomer()` could return null
- `getAddress()` could return null
- `getCity()` could return null

**3. Check what changed recently:**
- New data source or migration? (Some records may have null fields)
- New code path calling this method with incomplete data?
- External API returning unexpected nulls?

**4. Apply the fix:**
```java
import java.util.Optional;

public class NullDiagnosisDemo {
    record Address(String city) {}
    record Customer(Address address) {}
    record Order(Customer customer, double total) {}

    // Option A: Guard clauses with early return
    static String processOrderSafe(Order order) {
        if (order == null || order.customer() == null
                || order.customer().address() == null
                || order.customer().address().city() == null) {
            return "default tax";
        }
        if ("NYC".equals(order.customer().address().city())) {
            return "NYC tax applied";
        }
        return "default tax";
    }

    // Option B: Optional chain (cleaner)
    static String processOrderOptional(Order order) {
        boolean isNYC = Optional.ofNullable(order)
            .map(Order::customer)
            .map(Customer::address)
            .map(Address::city)
            .map("NYC"::equals)
            .orElse(false);
        return isNYC ? "NYC tax applied" : "default tax";
    }

    public static void main(String[] args) {
        // The intermittent case — customer has no address
        Order problematicOrder = new Order(new Customer(null), 100.0);
        System.out.println(processOrderSafe(problematicOrder));     // default tax
        System.out.println(processOrderOptional(problematicOrder)); // default tax
    }
}
```

**5. Prevent recurrence:**
- Add `@NonNull` / `@Nullable` annotations to domain objects
- Enable static analysis tools (SpotBugs, NullAway, Error Prone)
- Add unit tests with null inputs at every level of the chain
- Add validation at system boundaries (API input, database results)
</details>

### Scenario 3: Your team is debating whether to use polymorphism or `switch`/`instanceof` for handling 20+ different message types in a message processing system. What do you recommend?

<details>
<summary>Answer</summary>

**Analysis of both approaches:**

**Approach A: Polymorphism (OOP)**
```java
interface Message {
    void process(MessageContext ctx);
}
class EmailMessage implements Message {
    public void process(MessageContext ctx) { /* email logic */ }
}
class SmsMessage implements Message {
    public void process(MessageContext ctx) { /* SMS logic */ }
}
// 20+ classes, each with process()
```

**Approach B: Sealed + Pattern Matching (Data-oriented, Java 21+)**
```java
import java.util.*;

public class MessageRoutingDemo {
    sealed interface Message permits EmailMsg, SmsMsg, PushMsg {}
    record EmailMsg(String to, String body) implements Message {}
    record SmsMsg(String phone, String text) implements Message {}
    record PushMsg(String deviceId, String title) implements Message {}

    static void process(Message msg) {
        switch (msg) {
            case EmailMsg e -> System.out.println("Sending email to: " + e.to());
            case SmsMsg s   -> System.out.println("Sending SMS to: " + s.phone());
            case PushMsg p  -> System.out.println("Pushing to device: " + p.deviceId());
            // Compiler enforces all types are handled
        }
    }

    public static void main(String[] args) {
        List<Message> messages = List.of(
            new EmailMsg("alice@example.com", "Hello"),
            new SmsMsg("+1234567890", "Hi"),
            new PushMsg("device-abc", "Notification")
        );
        messages.forEach(MessageRoutingDemo::process);
    }
}
```

**Decision matrix:**

| Factor | Polymorphism | Sealed + Switch |
|--------|-------------|----------------|
| Adding new types | Easy (add class) | Must update all switches |
| Adding new operations | Must modify all classes | Easy (add new switch) |
| Data vs behavior | Behavior lives with data | Data and behavior separated |
| Testing | Test each class independently | Test each operation independently |
| Type discovery | Scattered across files | All types visible in sealed declaration |

**Recommendation for message processing:**

I recommend **Sealed + Switch** because:
1. Message types change rarely (protocol is stable), but operations change often (new processors, validators, loggers, metrics)
2. Cross-cutting concerns (logging, retry, metrics) are easier as centralized switch functions than scattered across 20+ classes
3. Serialization is simpler with records (data-focused)
4. Compile-time exhaustiveness catches missing handlers immediately

**Hybrid approach for very large systems:** Use a `Map<Class, Handler>` with auto-discovery (Spring `@Component`), combining extensibility of polymorphism with centralized routing.
</details>

### Scenario 4: A performance-sensitive trading application has a method with nested conditionals called millions of times per second. Profiling shows it is a hotspot. How do you optimize it?

<details>
<summary>Answer</summary>

**Systematic optimization approach:**

**1. Original code (nested conditionals):**
```java
double calculateFee(Trade trade) {
    if (trade.getType() == TradeType.EQUITY) {
        if (trade.getVolume() > 10_000) {
            if (trade.isInstitutional()) return trade.getValue() * 0.001;
            else return trade.getValue() * 0.002;
        } else {
            return trade.getValue() * 0.005;
        }
    } else if (trade.getType() == TradeType.OPTION) {
        if (trade.getVolume() > 100) return trade.getContracts() * 0.50;
        else return trade.getContracts() * 0.75;
    } else if (trade.getType() == TradeType.FUTURES) {
        return trade.getContracts() * 1.25;
    }
    return 0.0;
}
```

**2. Optimization A — Flatten with lookup table (eliminates all branches):**
```java
public class TradingOptimization {
    enum TradeType { EQUITY, OPTION, FUTURES }

    // Encode all conditions into an array index
    // [type][highVolume][institutional] = fee rate
    static final double[][][] FEE_TABLE = new double[3][2][2];
    static {
        FEE_TABLE[0][1][1] = 0.001; // EQUITY, high volume, institutional
        FEE_TABLE[0][1][0] = 0.002; // EQUITY, high volume, retail
        FEE_TABLE[0][0][1] = 0.005; // EQUITY, low volume, institutional
        FEE_TABLE[0][0][0] = 0.005; // EQUITY, low volume, retail
        FEE_TABLE[1][1][0] = 0.50;  // OPTION, high volume
        FEE_TABLE[1][0][0] = 0.75;  // OPTION, low volume
        FEE_TABLE[2][0][0] = 1.25;  // FUTURES
        FEE_TABLE[2][1][0] = 1.25;  // FUTURES
    }

    static double calculateFeeOptimized(int typeOrdinal, boolean highVolume, boolean institutional, double value) {
        double rate = FEE_TABLE[typeOrdinal][highVolume ? 1 : 0][institutional ? 1 : 0];
        return value * rate; // single multiplication, no branches
    }

    public static void main(String[] args) {
        double fee = calculateFeeOptimized(
            TradeType.EQUITY.ordinal(), true, true, 100_000.0
        );
        System.out.printf("Fee: $%.2f%n", fee); // $100.00
    }
}
```

**3. Optimization B — Order conditions by frequency:**
If 80% of trades are EQUITY, check it first. The JIT profiler does this automatically, but explicit ordering helps the interpreter phase.

**4. Optimization C — Batch processing by type:**
```java
// Pre-sort trades by type, then process in monomorphic loops
Map<TradeType, List<Trade>> grouped = trades.stream()
    .collect(Collectors.groupingBy(Trade::getType));

// Each loop is branch-predictor-friendly (same path every time)
for (Trade t : grouped.get(TradeType.EQUITY)) { /* ... */ }
for (Trade t : grouped.get(TradeType.OPTION)) { /* ... */ }
```

**5. Measure with JMH:**
```java
@Benchmark
public double benchmarkOriginal() { return calculateFee(trade); }

@Benchmark
public double benchmarkLookupTable() { return calculateFeeOptimized(type, high, inst, val); }
```

Typical improvements: 2-5x for lookup table, 10-50x for batched processing in tight loops.
</details>

---

## FAQ

### Q: What types of questions about conditionals are most commonly asked in Java interviews?

**A:** At the junior level, interviewers focus on syntax (`if-else`, `switch`, ternary), common mistakes (missing `break`, `==` vs `.equals()`), and understanding of boolean logic. At the middle level, expect questions about switch expressions (Java 14+), pattern matching (Java 16+), null handling, and when to use `switch` vs `if-else`. Senior interviews focus on JVM bytecode (`tableswitch` vs `lookupswitch`), performance optimization, design patterns for complex conditional logic, and sealed classes.

### Q: How much should I know about modern Java features like switch expressions and pattern matching?

**A:** It depends on the company and the Java version they use. For companies using Java 17+ (most modern projects), you should be comfortable with switch expressions, pattern matching for `instanceof`, and sealed classes. For legacy codebases (Java 8-11), focus on traditional `switch`, `Optional` for null safety, and polymorphism as a replacement for complex conditionals. Always mention you know about newer features, even if the codebase does not use them yet.

### Q: Should I write switch expressions or traditional switch statements in coding interviews?

**A:** If the interviewer does not specify a Java version, ask which version the team uses. If Java 14+, prefer switch expressions — they demonstrate modern knowledge, are more concise, and the compiler enforces exhaustiveness. If unsure, write the traditional form first and then mention: "With Java 14+, I would use a switch expression here for better safety and readability."

### Q: What makes a great answer to conditional-related interview questions?

**A:** Key evaluation criteria:
- **Junior:** Correct syntax, awareness of common pitfalls (`==` vs `.equals()`, fall-through), ability to write working code
- **Middle:** Understanding of when to use which conditional construct, null safety patterns, familiarity with modern Java features (switch expressions, pattern matching)
- **Senior:** Knowledge of JVM internals (bytecode, JIT optimization), ability to design extensible conditional logic (strategy pattern, sealed classes), performance awareness, and ability to articulate trade-offs between different approaches

### Q: How important is it to know about branch prediction and JIT optimizations?

**A:** For junior and middle positions, it is rarely asked. For senior and staff-level positions, understanding how the JVM optimizes conditionals is a strong differentiator. You do not need to memorize CPU pipeline details, but knowing that (1) the JIT profiles branches and optimizes hot paths, (2) sorted data improves branch prediction, and (3) lookup tables can replace branches in hot paths demonstrates deep understanding of systems-level thinking.
