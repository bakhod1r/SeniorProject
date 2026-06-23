# Java Language Specification — Conditionals
## Source: https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html

---

## 1. Spec Reference

- **JLS Chapter 14**: Blocks, Statements, and Patterns — https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html
- **JLS §14.9**: The `if` Statement
- **JLS §14.10**: The `assert` Statement
- **JLS §14.11**: The `switch` Statement
- **JLS §15.25**: The Conditional Operator (`? :`)
- **JLS §15.28**: Switch Expressions (Java 14+)
- **JLS §14.30**: Patterns
- **JLS §14.30.1**: Type Patterns
- **JLS §14.30.2**: Record Patterns (Java 21)
- **JLS §15.20.2**: The `instanceof` Operator
- **JLS §6.3.2.3**: Pattern Variable Declaration Scope

---

## 2. Formal Grammar (BNF from JLS)

```
-- JLS §14.9: if Statement --
IfThenStatement:
    if ( Expression ) Statement

IfThenElseStatement:
    if ( Expression ) StatementNoShortIf else Statement

IfThenElseStatementNoShortIf:
    if ( Expression ) StatementNoShortIf else StatementNoShortIf

-- JLS §14.11: switch Statement --
SwitchStatement:
    switch ( Expression ) SwitchBlock

SwitchBlock:
    { SwitchBlockStatementGroup* SwitchLabel* }
    { SwitchRule* }

SwitchBlockStatementGroup:
    SwitchLabel+ BlockStatements

SwitchLabel:
    case CaseConstant { , CaseConstant }  :
    case null  :
    case null , default  :
    default  :

SwitchRule:
    SwitchLabel -> Expression ;
    SwitchLabel -> Block
    SwitchLabel -> ThrowStatement

CaseConstant:
    ConditionalExpression

-- JLS §15.28: switch Expression --
SwitchExpression:
    switch ( Expression ) SwitchBlock

-- Note: SwitchBlock for expressions uses same grammar as switch statement
-- but each arm must produce a value or throw.

-- JLS §14.30: Patterns --
Pattern:
    TypePattern
    RecordPattern

TypePattern:
    {TypePatternModifier} ReferenceType Identifier

TypePatternModifier:
    Annotation

RecordPattern:
    ReferenceType ( [PatternList] )

PatternList:
    Pattern { , Pattern }

-- JLS §15.25: Conditional Operator --
ConditionalExpression:
    ConditionalOrExpression
    ConditionalOrExpression ? Expression : ConditionalExpression
    ConditionalOrExpression ? Expression : LambdaExpression

-- JLS §14.10: assert Statement --
AssertStatement:
    assert Expression ;
    assert Expression : Expression ;
```

---

## 3. Core Rules & Constraints

### 3.1 `if` Statement Rules (JLS §14.9)
- The condition must be a `boolean` expression — NOT an integer.
- `if (x = 5)` is a compile error (assignment in condition requires boolean result; `int` is not boolean).
- The then-branch and else-branch are any single statement or block.
- The **dangling else** problem: `else` always belongs to the nearest preceding `if`.
- Short-hand without braces `{}` is legal but the body is a single statement only.

### 3.2 `switch` Statement Rules (JLS §14.11)
**Classic switch (pre-Java 14):**
- Expression type must be `byte`, `short`, `char`, `int`, their wrappers (`Byte`, `Short`, `Character`, `Integer`), `String`, or an enum type.
- `long`, `float`, `double`, `boolean` are NOT valid switch types.
- Case labels must be compile-time constant expressions (literals, `final` fields).
- `default` is optional and can appear in any position.
- Fall-through: without `break`, execution falls to the next case block.

**Switch expressions (Java 14+):**
- `switch (expr) { case v -> result; ... }` — no fall-through with arrow syntax.
- Arrow cases: exactly one of: expression, block, or throw statement.
- Colon cases in switch expression: `break value;` returns a value; fall-through still possible.
- Switch expression must be exhaustive (cover all possible values).

### 3.3 Pattern Matching in `switch` (Java 21, JLS §14.11)
- Type patterns: `case String s -> ...`
- Guarded patterns: `case String s when s.length() > 5 -> ...`
- Null handling: `case null -> ...` (only in switch — instanceof never matches null)
- `default` dominance: `default` must come after all patterns (else compile error).
- Exhaustiveness: for sealed classes, compiler can verify all subtypes are covered.

### 3.4 Ternary Operator Rules (JLS §15.25)
- Condition must be `boolean`.
- Type of entire expression is determined by both branches together (numeric promotion or common supertype).
- `null ? x : y` — `null` literal as condition is a compile error (null is not boolean).
- Can be nested (right-associative).

### 3.5 `assert` Statement Rules (JLS §14.10)
- Assertions are disabled by default at runtime (enabled with `-ea` flag).
- `assert condition` — throws `AssertionError` if `condition` is `false`.
- `assert condition : message` — error message expression; evaluated only if assertion fails.
- Should not be used for argument validation (use `Objects.requireNonNull`, `IllegalArgumentException`).
- `AssertionError` extends `Error` — should not be caught in application code.

---

## 4. Type Rules

### 4.1 Condition Type Rules
- `if` condition: must be exactly `boolean` or `Boolean` (auto-unboxed).
- `Boolean` unboxing: `Boolean b = null; if (b)` → NullPointerException.
- `while`, `for`, `do-while` conditions: same rule.

### 4.2 Switch Expression Type Rules (JLS §15.28)
- The type of a switch expression is:
  - If all arms produce values of the same type: that type.
  - Otherwise: numeric promotion or widest common supertype applies.
- `yield` keyword exits a block-form arm with a value.
- Switch expressions can appear anywhere an expression can appear.

### 4.3 Pattern Compatibility Rules (JLS §14.30)
- A `case` pattern `T t` is applicable to switch expression type `S` if `S` is a subtype of `T`, or `T` is a subtype of `S` (one must be able to be a subtype of the other).
- If `S` is a subtype of `T`, the pattern is guaranteed to match (except null) — compiler may warn about dominance.
- Patterns dominate other patterns below them if they cover all cases the lower pattern would match.

### 4.4 Exhaustiveness (JLS §14.11.1)
- Switch expressions must be exhaustive.
- For `enum`: all enum constants must be covered (or `default` present).
- For sealed types: all permitted subtypes must be covered.
- For `Object`, `String`, or other non-sealed types: `default` is required.

---

## 5. Behavioral Specification

### 5.1 `if-else if` Chain Evaluation
- Conditions are evaluated **top-to-bottom, left-to-right**.
- The first matching condition executes its body; others are skipped.
- After one branch executes, the rest of the chain is skipped.
- Only one branch executes per evaluation of the `if-else if` chain.

### 5.2 Switch Fall-Through Behavior (JLS §14.11)
- After executing a case block without `break`, execution continues to the next case.
- This is a source of bugs — usually unintentional.
- Java 17 introduced strict fall-through with `--enable-preview` labeling.
- Arrow-form switch rules have no fall-through at all (each arm is independent).

### 5.3 `yield` in Switch Expressions (JLS §14.21)
- `yield expr;` exits a block-form switch arm and returns `expr` as the switch result.
- `yield` is a contextual keyword (valid only inside switch blocks that are expressions).
- `break`, `continue`, `return` cannot exit a switch expression; `yield` is required.

### 5.4 Guarded Patterns (Java 21)
- `case T t when condition` — evaluates `condition` only if the type match succeeds.
- `when` guard can reference the pattern variable.
- Guards are evaluated in order; first matching guard wins.
- A case with no guard dominates a case with same pattern but with a guard.

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior per JLS |
|-----------|-----------------|
| `if (x = true)` | Compile error: assignment is `boolean` — actually this IS legal (assigns and checks) |
| `if (x = 5)` | Compile error: `int` not `boolean` |
| `switch` on `null` string (classic) | `NullPointerException` at runtime |
| `switch` on `null` (Java 21 with `case null`) | Handled by `case null` |
| `switch` on `long` | Compile error: `long` not a valid switch type |
| Fall-through in switch | Defined behavior: execution continues to next case |
| Missing `yield` in block-form switch expression | Compile error: must produce a value |
| Non-exhaustive switch expression | Compile error for sealed types; runtime `MatchException` for others |
| `assert` with `null` message | `AssertionError` with no detail message |
| `Boolean` null unboxed in `if` | `NullPointerException` |

---

## 7. Edge Cases from Spec

### 7.1 Dangling Else
```java
// This code is ambiguous-looking but well-defined:
if (x > 0)
    if (y > 0)
        System.out.println("both positive");
else
    System.out.println("else");  // belongs to inner if (y > 0), NOT outer if
// Use braces to make intent clear
```

### 7.2 Switch Fall-Through
```java
int day = 3;
switch (day) {
    case 1:
    case 2:
    case 3:
        System.out.println("Early week");  // falls through from 1 and 2
        break;
    case 4:
    case 5:
        System.out.println("Late week");
        break;
    default:
        System.out.println("Weekend");
}
```

### 7.3 Switch Expression with yield
```java
int value = 2;
int result = switch (value) {
    case 1 -> 10;
    case 2 -> {
        int temp = value * 20;
        yield temp + 1;         // yield exits the block
    }
    default -> 0;
};
System.out.println(result);  // 41
```

### 7.4 Sealed Class Exhaustiveness
```java
sealed interface Animal permits Dog, Cat {}
record Dog(String name) implements Animal {}
record Cat(String name) implements Animal {}

Animal a = new Dog("Rex");
// Switch is exhaustive — no default needed
String sound = switch (a) {
    case Dog d -> "Woof from " + d.name();
    case Cat c -> "Meow from " + c.name();
};
System.out.println(sound);  // Woof from Rex
```

### 7.5 Null in Classic Switch vs Java 21 Switch
```java
String s = null;
// Classic switch: NullPointerException
// switch (s) { case "a": ... }  // NPE at runtime

// Java 21 switch with null handling:
String result = switch (s) {
    case null -> "null value";
    case "a"  -> "letter a";
    default   -> "other";
};
System.out.println(result);  // null value
```

### 7.6 Ternary Type Promotion
```java
int a = 1;
double b = 2.0;
var result = true ? a : b;   // result type is double (a promoted to double)
System.out.println(result);  // 1.0

Object obj = true ? "hello" : 42;  // String or Integer → Object
System.out.println(obj.getClass().getSimpleName());  // String
```

---

## 8. Version History

| Java Version | Change | JEP/Reference |
|-------------|--------|---------------|
| Java 1.0 | `if`, `switch` (byte/short/char/int), `?:` | JLS 1st ed. |
| Java 5 | `switch` on `enum` | JDK 5 |
| Java 7 | `switch` on `String` | JDK 7 / JLS §14.11 |
| Java 13 | Switch expressions (preview): arrow syntax, `yield` | JEP 354 |
| Java 14 | Switch expressions (standard) | JEP 361 |
| Java 14 | Pattern matching `instanceof` (preview): TypePattern | JEP 305 |
| Java 16 | Pattern matching `instanceof` (standard) | JEP 394 |
| Java 17 | Sealed classes (standard) — enables exhaustive switch | JEP 409 |
| Java 18 | Pattern matching for `switch` (2nd preview) | JEP 420 |
| Java 19 | Pattern matching for `switch` (3rd preview) | JEP 427 |
| Java 20 | Pattern matching for `switch` (4th preview) | JEP 433 |
| Java 21 | Pattern matching for `switch` (standard); Record patterns (standard) | JEP 441, JEP 440 |

---

## 9. Implementation-Specific Behavior (JVM-Specific)

### 9.1 JVM Switch Bytecode
- `tableswitch`: used when case values form a dense range (O(1) lookup via jump table).
- `lookupswitch`: used when case values are sparse (binary search — O(log n)).
- `javac` chooses automatically based on the density of case values.
- String switch: compiled to `hashCode()` then `equals()` check.

### 9.2 Branch Prediction
- Modern CPUs predict branch outcomes; mispredictions cause pipeline stalls.
- `switch` with `tableswitch` is predictable; large `if-else if` chains are not.
- JIT's profile-guided optimization uses branch frequency data to reorder code.

### 9.3 Pattern Matching JVM Internals (Java 21)
- Pattern matching in switch uses `invokedynamic` via `ClassFilePreviewer` / `TypeSwitchCallSite`.
- The JVM generates a dispatch table based on the pattern types.
- `MatchException` is thrown for non-exhaustive switch at runtime (replaces `IncompatibleClassChangeError` in older previews).

### 9.4 Assertion Performance
- Disabled assertions: `assert` compiles to a conditional check on a static boolean field.
- On modern JVMs, disabled assertions incur near-zero overhead due to JIT dead-code elimination.
- Enabled assertions (`-ea`): check is always executed.

---

## 10. Spec Compliance Checklist

- [ ] `if` condition is `boolean`, not `int` or nullable `Boolean`
- [ ] Classic `switch` uses only valid types: `byte`, `short`, `char`, `int`, wrappers, `String`, `enum`
- [ ] `switch` statement: `break` used intentionally to prevent fall-through
- [ ] Switch expressions: all arms produce a value or throw; no fall-through
- [ ] Switch expressions are exhaustive (all cases covered or `default` present)
- [ ] `yield` used in block-form switch expression arms (not `return`, `break`)
- [ ] Pattern variable scope used only within proven match branch
- [ ] Guarded patterns with `when` do not produce side effects in guards
- [ ] Classic switch on `String`/reference does not assume non-null (NPE possible)
- [ ] `assert` not used for runtime argument validation (only for debugging invariants)

---

## 11. Official Examples (Compilable Java 21 Code)

```java
// Example 1: if-else Fundamentals
// File: IfElseDemo.java
public class IfElseDemo {
    public static void main(String[] args) {
        // Basic if-else
        int score = 75;
        if (score >= 90) {
            System.out.println("A");
        } else if (score >= 80) {
            System.out.println("B");
        } else if (score >= 70) {
            System.out.println("C");
        } else {
            System.out.println("D");
        }
        // Output: C

        // Short-circuit in condition
        String str = null;
        if (str != null && str.length() > 0) {
            System.out.println("Non-empty string");
        } else {
            System.out.println("Null or empty");
        }
        // Output: Null or empty (no NPE due to &&)

        // Ternary operator
        int abs = score < 0 ? -score : score;
        System.out.println("abs: " + abs);

        // Nested ternary (right-associative)
        String category = score >= 90 ? "A"
                        : score >= 80 ? "B"
                        : score >= 70 ? "C"
                        : "D";
        System.out.println("Grade: " + category);
    }
}
```

```java
// Example 2: Classic Switch Statement
// File: SwitchStatement.java
public class SwitchStatement {
    enum Day { MON, TUE, WED, THU, FRI, SAT, SUN }

    public static void main(String[] args) {
        // int switch
        int month = 4;
        int daysInMonth;
        switch (month) {
            case 1: case 3: case 5: case 7:
            case 8: case 10: case 12:
                daysInMonth = 31;
                break;
            case 4: case 6: case 9: case 11:
                daysInMonth = 30;
                break;
            case 2:
                daysInMonth = 28;  // ignoring leap years
                break;
            default:
                throw new IllegalArgumentException("Invalid month: " + month);
        }
        System.out.println("April has " + daysInMonth + " days");  // 30

        // String switch (Java 7+)
        String command = "start";
        switch (command) {
            case "start":
                System.out.println("Starting...");
                break;
            case "stop":
                System.out.println("Stopping...");
                break;
            default:
                System.out.println("Unknown command: " + command);
        }

        // Enum switch
        Day today = Day.WED;
        switch (today) {
            case SAT: case SUN:
                System.out.println("Weekend!");
                break;
            default:
                System.out.println("Weekday: " + today);
        }
    }
}
```

```java
// Example 3: Switch Expressions (Java 14+)
// File: SwitchExpressions.java
public class SwitchExpressions {

    enum Season { SPRING, SUMMER, FALL, WINTER }

    public static void main(String[] args) {
        // Arrow-form switch expression (no fall-through)
        Season season = Season.SUMMER;
        String activity = switch (season) {
            case SPRING -> "Gardening";
            case SUMMER -> "Swimming";
            case FALL   -> "Hiking";
            case WINTER -> "Skiing";
        };
        System.out.println(activity);  // Swimming

        // Block-form with yield
        int temp = 35;
        String recommendation = switch (season) {
            case SUMMER -> {
                if (temp > 30) {
                    yield "Stay hydrated! " + temp + "°C";
                } else {
                    yield "Nice summer day";
                }
            }
            default -> "Enjoy the season";
        };
        System.out.println(recommendation);

        // Multiple labels per case
        int day = 6;
        boolean isWeekend = switch (day) {
            case 1, 7 -> true;
            default   -> false;
        };
        System.out.println("Is weekend: " + isWeekend);  // true

        // Switch expression as argument
        System.out.println("Months in " + season + ": " + switch (season) {
            case SPRING, SUMMER, FALL -> 3;
            case WINTER               -> 3;
        });
    }
}
```

```java
// Example 4: Pattern Matching Switch (Java 21)
// File: PatternSwitch.java
public class PatternSwitch {

    sealed interface Shape permits Circle, Rectangle, Triangle {}
    record Circle(double radius) implements Shape {}
    record Rectangle(double width, double height) implements Shape {}
    record Triangle(double base, double height) implements Shape {}

    static double area(Shape shape) {
        return switch (shape) {
            case Circle c       -> Math.PI * c.radius() * c.radius();
            case Rectangle r    -> r.width() * r.height();
            case Triangle t     -> 0.5 * t.base() * t.height();
        };
    }

    static String classify(Object obj) {
        return switch (obj) {
            case null                         -> "null";
            case Integer i when i < 0         -> "negative int: " + i;
            case Integer i when i == 0        -> "zero";
            case Integer i                    -> "positive int: " + i;
            case String s when s.isBlank()    -> "blank string";
            case String s                     -> "string: " + s;
            case int[] arr                    -> "int array of length " + arr.length;
            default                           -> "other: " + obj.getClass().getSimpleName();
        };
    }

    public static void main(String[] args) {
        System.out.printf("Circle area: %.2f%n", area(new Circle(5)));
        System.out.printf("Rect area: %.2f%n", area(new Rectangle(4, 6)));
        System.out.printf("Tri area: %.2f%n", area(new Triangle(3, 8)));

        System.out.println(classify(null));
        System.out.println(classify(-5));
        System.out.println(classify(0));
        System.out.println(classify(42));
        System.out.println(classify(""));
        System.out.println(classify("hello"));
        System.out.println(classify(new int[]{1, 2, 3}));
    }
}
```

```java
// Example 5: Record Patterns and Nested Patterns (Java 21)
// File: RecordPatterns.java
public class RecordPatterns {

    record Point(int x, int y) {}
    record Line(Point start, Point end) {}

    sealed interface Expr permits Const, Add, Mul {}
    record Const(int value) implements Expr {}
    record Add(Expr left, Expr right) implements Expr {}
    record Mul(Expr left, Expr right) implements Expr {}

    static int eval(Expr expr) {
        return switch (expr) {
            case Const(int v)             -> v;
            case Add(Expr l, Expr r)      -> eval(l) + eval(r);
            case Mul(Expr l, Expr r)      -> eval(l) * eval(r);
        };
    }

    static String describePoint(Object obj) {
        return switch (obj) {
            case Point(int x, int y) when x == 0 && y == 0 -> "origin";
            case Point(int x, int y) when x == 0 -> "on y-axis at " + y;
            case Point(int x, int y) when y == 0 -> "on x-axis at " + x;
            case Point(int x, int y)              -> "point at (" + x + "," + y + ")";
            default                               -> "not a point";
        };
    }

    static boolean isHorizontal(Line line) {
        return switch (line) {
            case Line(Point(int x1, int y1), Point(int x2, int y2)) -> y1 == y2;
        };
    }

    public static void main(String[] args) {
        System.out.println(describePoint(new Point(0, 0)));    // origin
        System.out.println(describePoint(new Point(0, 5)));    // on y-axis at 5
        System.out.println(describePoint(new Point(3, 4)));    // point at (3,4)

        // (2 + 3) * 4
        Expr expr = new Mul(new Add(new Const(2), new Const(3)), new Const(4));
        System.out.println("Result: " + eval(expr));           // 20

        Line h = new Line(new Point(0, 5), new Point(10, 5));
        System.out.println("Is horizontal: " + isHorizontal(h));  // true
    }
}
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| JLS §14.9 | if Statement | https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.9 |
| JLS §14.11 | switch Statement | https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.11 |
| JLS §14.30 | Patterns | https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html#jls-14.30 |
| JLS §15.25 | Conditional Operator | https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html#jls-15.25 |
| JLS §15.28 | Switch Expressions | https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html#jls-15.28 |
| JEP 361 | Switch Expressions (standard) | https://openjdk.org/jeps/361 |
| JEP 394 | Pattern Matching instanceof | https://openjdk.org/jeps/394 |
| JEP 440 | Record Patterns | https://openjdk.org/jeps/440 |
| JEP 441 | Pattern Matching for switch | https://openjdk.org/jeps/441 |
| JEP 409 | Sealed Classes | https://openjdk.org/jeps/409 |
