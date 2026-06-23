# Java Conditionals — Find the Bug

> Find and fix the bugs in each code snippet. Each exercise has exactly one (or more) bugs. Try to find them before looking at the answer.

---

## Scoring

| Difficulty | Points per bug |
|:----------:|:--------------:|
| Easy | 1 point |
| Medium | 2 points |
| Hard | 3 points |

**Total possible: 20 points**

| Score | Level |
|:-----:|:-----:|
| 0-6 | Beginner — review conditional basics |
| 7-12 | Intermediate — good foundation |
| 13-17 | Advanced — strong understanding |
| 18-20 | Expert — you know conditionals deeply |

---

## Easy Bugs (3)

### Bug 1: String Comparison with ==

```java
public class Main {
    public static void main(String[] args) {
        String status = new String("active");

        if (status == "active") {
            System.out.println("User is active");
        } else {
            System.out.println("User is inactive");
        }
    }
}
```

**Expected output:**
```
User is active
```

**Actual output:**
```
User is inactive
```

<details>
<summary>Hint</summary>

How does `==` compare objects in Java? Does it check the content or something else?

</details>

<details>
<summary>Answer</summary>

**Bug:** `==` compares object references, not string content. `new String("active")` creates a new object on the heap, so its reference differs from the string literal `"active"` in the string pool.

**Fix:**
```java
public class Main {
    public static void main(String[] args) {
        String status = new String("active");

        if (status.equals("active")) { // use .equals() for content comparison
            System.out.println("User is active");
        } else {
            System.out.println("User is inactive");
        }
    }
}
```

**What changed:** Replaced `==` with `.equals()` to compare string content instead of references.

</details>

---

### Bug 2: Missing Break in Switch

```java
public class Main {
    public static void main(String[] args) {
        int day = 3;

        switch (day) {
            case 1:
                System.out.println("Monday");
            case 2:
                System.out.println("Tuesday");
            case 3:
                System.out.println("Wednesday");
            case 4:
                System.out.println("Thursday");
            case 5:
                System.out.println("Friday");
            default:
                System.out.println("Weekend");
        }
    }
}
```

**Expected output:**
```
Wednesday
```

**Actual output:**
```
Wednesday
Thursday
Friday
Weekend
```

<details>
<summary>Hint</summary>

What happens in a switch statement when there is no `break` after a matching case?

</details>

<details>
<summary>Answer</summary>

**Bug:** Without `break` statements, execution falls through every subsequent case after the match. This is called "fall-through" behavior in Java switch statements.

**Fix:**
```java
public class Main {
    public static void main(String[] args) {
        int day = 3;

        switch (day) {
            case 1:
                System.out.println("Monday");
                break;
            case 2:
                System.out.println("Tuesday");
                break;
            case 3:
                System.out.println("Wednesday");
                break;
            case 4:
                System.out.println("Thursday");
                break;
            case 5:
                System.out.println("Friday");
                break;
            default:
                System.out.println("Weekend");
                break;
        }
    }
}
```

**What changed:** Added `break` after each case to prevent fall-through.

</details>

---

### Bug 3: Wrong Operator in Condition

```java
public class Main {
    public static void main(String[] args) {
        int score = 85;
        String grade;

        if (score >= 90) {
            grade = "A";
        } else if (score >= 80 & score < 90) {
            grade = "B";
        } else if (score >= 70 & score < 80) {
            grade = "C";
        } else {
            grade = "F";
        }

        System.out.println("Grade: " + grade);
    }
}
```

**Expected output:**
```
Grade: B
```

**Actual output:**
```
Grade: B
```

<details>
<summary>Hint</summary>

The output looks correct here, but what happens if `score` comes from a method that has a side effect, or if the left side is a null check? Think about the difference between `&` and `&&`.

</details>

<details>
<summary>Answer</summary>

**Bug:** `&` is the bitwise AND operator — it always evaluates **both** sides. `&&` is the logical short-circuit AND — it skips the right side if the left is `false`. While the output is the same in this case, using `&` instead of `&&` can cause problems when the right side has side effects or when the left side is a guard condition (e.g., null check). This is a correctness and safety bug.

**Fix:**
```java
public class Main {
    public static void main(String[] args) {
        int score = 85;
        String grade;

        if (score >= 90) {
            grade = "A";
        } else if (score >= 80 && score < 90) { // use && for short-circuit
            grade = "B";
        } else if (score >= 70 && score < 80) { // use && for short-circuit
            grade = "C";
        } else {
            grade = "F";
        }

        System.out.println("Grade: " + grade);
    }
}
```

**What changed:** Replaced `&` with `&&` to ensure short-circuit evaluation, which is safer and the standard practice for logical conditions.

</details>

---

## Medium Bugs (4)

### Bug 4: NullPointerException from Wrong Null Check Order

```java
public class Main {
    public static void main(String[] args) {
        String username = null;

        if (username.equals("admin")) {
            System.out.println("Welcome, admin!");
        } else if (username == null) {
            System.out.println("No username provided");
        } else {
            System.out.println("Welcome, " + username);
        }
    }
}
```

**Expected output:**
```
No username provided
```

**Actual output:**
```
Exception in thread "main" java.lang.NullPointerException
```

<details>
<summary>Hint</summary>

What happens when you call a method on a `null` reference? Which condition should be checked first?

</details>

<details>
<summary>Answer</summary>

**Bug:** `username.equals("admin")` is evaluated before the null check. Calling `.equals()` on a `null` reference throws `NullPointerException`. The null check must come first, or use the constant on the left side of `.equals()`.

**Fix:**
```java
public class Main {
    public static void main(String[] args) {
        String username = null;

        if (username == null) {                     // check null FIRST
            System.out.println("No username provided");
        } else if (username.equals("admin")) {
            System.out.println("Welcome, admin!");
        } else {
            System.out.println("Welcome, " + username);
        }
    }
}
```

**Alternative fix using Yoda condition:**
```java
if ("admin".equals(username)) { // null-safe: "admin" is never null
```

**What changed:** Moved the null check before the `.equals()` call to prevent NullPointerException.

</details>

---

### Bug 5: Integer Autoboxing Comparison

```java
public class Main {
    public static void main(String[] args) {
        Integer a = 200;
        Integer b = 200;

        if (a == b) {
            System.out.println("a and b are equal");
        } else {
            System.out.println("a and b are NOT equal");
        }

        Integer c = 100;
        Integer d = 100;

        if (c == d) {
            System.out.println("c and d are equal");
        } else {
            System.out.println("c and d are NOT equal");
        }
    }
}
```

**Expected output:**
```
a and b are equal
c and d are equal
```

**Actual output:**
```
a and b are NOT equal
c and d are equal
```

<details>
<summary>Hint</summary>

Java caches `Integer` objects for values in a specific range. What is that range? What happens outside of it?

</details>

<details>
<summary>Answer</summary>

**Bug:** `==` on `Integer` objects compares references, not values. Java caches `Integer` values from -128 to 127 (JLS 5.1.7), so `c == d` works because both point to the same cached object. But 200 is outside the cache range, so `a` and `b` are different objects.

**Fix:**
```java
public class Main {
    public static void main(String[] args) {
        Integer a = 200;
        Integer b = 200;

        if (a.equals(b)) {  // use .equals() for Integer comparison
            System.out.println("a and b are equal");
        } else {
            System.out.println("a and b are NOT equal");
        }

        Integer c = 100;
        Integer d = 100;

        if (c.equals(d)) {  // consistent: always use .equals()
            System.out.println("c and d are equal");
        } else {
            System.out.println("c and d are NOT equal");
        }
    }
}
```

**What changed:** Replaced `==` with `.equals()` for `Integer` comparison to avoid reference comparison traps.

</details>

---

### Bug 6: Ternary Operator Precedence Trap

```java
public class Main {
    public static void main(String[] args) {
        int x = 5;
        int y = 10;

        String result = "Result: " + x > y ? "x is greater" : "y is greater";
        System.out.println(result);
    }
}
```

**Expected output:**
```
Result: y is greater
```

**Actual output:**
```
Compilation error or unexpected behavior
```

<details>
<summary>Hint</summary>

What is the precedence of `+` vs `>` vs `?:` in Java? How does the compiler parse this expression?

</details>

<details>
<summary>Answer</summary>

**Bug:** The `+` operator has higher precedence than `>`, so the expression is parsed as `("Result: " + x) > y ? ... : ...`. This means `"Result: 5" > 10` which tries to compare a `String` with an `int` — a compilation error.

**Fix:**
```java
public class Main {
    public static void main(String[] args) {
        int x = 5;
        int y = 10;

        String result = "Result: " + (x > y ? "x is greater" : "y is greater");
        System.out.println(result);
    }
}
```

**What changed:** Added parentheses around the ternary expression to ensure correct evaluation order.

</details>

---

### Bug 7: Switch with Null String (Java 14+)

```java
public class Main {
    public static void main(String[] args) {
        String command = getCommand();

        switch (command) {
            case "start":
                System.out.println("Starting...");
                break;
            case "stop":
                System.out.println("Stopping...");
                break;
            case "restart":
                System.out.println("Restarting...");
                break;
            default:
                System.out.println("Unknown command");
                break;
        }
    }

    static String getCommand() {
        // Simulates reading from config — might return null
        return null;
    }
}
```

**Expected output:**
```
Unknown command
```

**Actual output:**
```
Exception in thread "main" java.lang.NullPointerException
```

<details>
<summary>Hint</summary>

What happens when `switch` receives a `null` value? Does it go to `default`?

</details>

<details>
<summary>Answer</summary>

**Bug:** A `switch` statement on a `String` throws `NullPointerException` if the expression evaluates to `null`. The `default` case does NOT catch null — Java calls `.hashCode()` on the string internally, which fails on null.

**Fix:**
```java
public class Main {
    public static void main(String[] args) {
        String command = getCommand();

        if (command == null) {               // guard against null BEFORE switch
            System.out.println("Unknown command");
            return;
        }

        switch (command) {
            case "start":
                System.out.println("Starting...");
                break;
            case "stop":
                System.out.println("Stopping...");
                break;
            case "restart":
                System.out.println("Restarting...");
                break;
            default:
                System.out.println("Unknown command");
                break;
        }
    }

    static String getCommand() {
        return null;
    }
}
```

**What changed:** Added a null check before the switch statement to prevent NullPointerException.

</details>

---

## Hard Bugs (3)

### Bug 8: Short-Circuit Evaluation Side Effect Trap

```java
public class Main {
    static int counter = 0;

    public static void main(String[] args) {
        boolean a = true;
        boolean b = false;

        // Developer expects both increment() calls to execute
        if (a || increment()) {
            System.out.println("First condition passed");
        }

        if (b && increment()) {
            System.out.println("Second condition passed");
        }

        System.out.println("Counter: " + counter);
        // Developer expects counter to be 2
    }

    static boolean increment() {
        counter++;
        return true;
    }
}
```

**Expected output (developer's expectation):**
```
First condition passed
Counter: 2
```

**Actual output:**
```
First condition passed
Counter: 0
```

<details>
<summary>Hint</summary>

With `||`, if the left operand is `true`, does Java evaluate the right operand? With `&&`, if the left operand is `false`, does Java evaluate the right operand?

</details>

<details>
<summary>Answer</summary>

**Bug:** Short-circuit evaluation means:
- `a || increment()`: since `a` is `true`, `increment()` is **never called** (short-circuited)
- `b && increment()`: since `b` is `false`, `increment()` is **never called** (short-circuited)

So `counter` remains 0. Code that relies on side effects inside short-circuit conditions is inherently fragile.

**Fix:**
```java
public class Main {
    static int counter = 0;

    public static void main(String[] args) {
        boolean a = true;
        boolean b = false;

        // Call increment() separately — don't rely on short-circuit side effects
        boolean resultA = increment();
        if (a || resultA) {
            System.out.println("First condition passed");
        }

        boolean resultB = increment();
        if (b && resultB) {
            System.out.println("Second condition passed");
        }

        System.out.println("Counter: " + counter);
    }

    static boolean increment() {
        counter++;
        return true;
    }
}
```

**What changed:** Extracted the side-effect-producing method calls out of the conditional expression so they always execute regardless of short-circuit behavior.

</details>

---

### Bug 9: Fall-Through with Return Values in Switch Expression

```java
public class Main {
    public static void main(String[] args) {
        String input = "  hello  ";

        // Clean up user input based on mode
        int mode = 3;
        String result;

        switch (mode) {
            case 1:
                result = input.trim();
                break;
            case 2:
                result = input.toLowerCase();
                break;
            case 3:
                result = input.trim();
                // Developer forgot break — intended to only trim
            case 4:
                result = input.toUpperCase();
                break;
            default:
                result = input;
                break;
        }

        System.out.println("[" + result + "]");
    }
}
```

**Expected output:**
```
[hello]
```

**Actual output:**
```
[  HELLO  ]
```

<details>
<summary>Hint</summary>

Look at case 3 carefully. Is there a `break`? What happens to `result` when execution falls through to case 4?

</details>

<details>
<summary>Answer</summary>

**Bug:** Case 3 is missing a `break` statement. After `result = input.trim()` assigns `"hello"`, execution falls through to case 4 which reassigns `result = input.toUpperCase()`, producing `"  HELLO  "` (the original untrimmed, uppercased string). The trimmed value is lost.

This is particularly insidious because the code compiles without warnings and the variable IS assigned in case 3 — it is just immediately overwritten.

**Fix:**
```java
public class Main {
    public static void main(String[] args) {
        String input = "  hello  ";

        int mode = 3;
        String result;

        switch (mode) {
            case 1:
                result = input.trim();
                break;
            case 2:
                result = input.toLowerCase();
                break;
            case 3:
                result = input.trim();
                break;                      // added missing break
            case 4:
                result = input.toUpperCase();
                break;
            default:
                result = input;
                break;
        }

        System.out.println("[" + result + "]");
    }
}
```

**What changed:** Added `break` after case 3 to prevent fall-through to case 4.

</details>

---

### Bug 10: Nested Ternary with Autoboxing Null Trap

```java
public class Main {
    public static void main(String[] args) {
        Boolean userPreference = null; // not set by user

        // If preference is TRUE -> "enabled"
        // If preference is FALSE -> "disabled"
        // If preference is null -> "default"
        String setting = userPreference ? "enabled"
                       : userPreference == null ? "default"
                       : "disabled";

        System.out.println("Setting: " + setting);
    }
}
```

**Expected output:**
```
Setting: default
```

**Actual output:**
```
Exception in thread "main" java.lang.NullPointerException
```

<details>
<summary>Hint</summary>

When `Boolean` (wrapper) is used in a condition, Java auto-unboxes it to `boolean`. What happens when you auto-unbox `null`?

</details>

<details>
<summary>Answer</summary>

**Bug:** `userPreference` is `Boolean` (wrapper, not primitive). When used directly in the ternary condition, Java auto-unboxes it by calling `userPreference.booleanValue()`. Since `userPreference` is `null`, this throws `NullPointerException`. The null check on the right side of the ternary never gets reached because the NPE happens first.

**Fix:**
```java
public class Main {
    public static void main(String[] args) {
        Boolean userPreference = null;

        // Check null FIRST, then safely unbox
        String setting;
        if (userPreference == null) {
            setting = "default";
        } else if (userPreference) {
            setting = "enabled";
        } else {
            setting = "disabled";
        }

        System.out.println("Setting: " + setting);
    }
}
```

**What changed:** Replaced the nested ternary with an if-else chain that checks for `null` before auto-unboxing, preventing the NullPointerException.

</details>

---

## Score Card

Track your progress:

| Bug | Difficulty | Found without hint? | Understood why? | Fixed correctly? |
|:---:|:---------:|:-------------------:|:---------------:|:----------------:|
| 1 | Easy | ☐ | ☐ | ☐ |
| 2 | Easy | ☐ | ☐ | ☐ |
| 3 | Easy | ☐ | ☐ | ☐ |
| 4 | Medium | ☐ | ☐ | ☐ |
| 5 | Medium | ☐ | ☐ | ☐ |
| 6 | Medium | ☐ | ☐ | ☐ |
| 7 | Medium | ☐ | ☐ | ☐ |
| 8 | Hard | ☐ | ☐ | ☐ |
| 9 | Hard | ☐ | ☐ | ☐ |
| 10 | Hard | ☐ | ☐ | ☐ |

### Rating:
- **10/10 without hints** — Senior-level Java debugging skills
- **7-9/10** — Solid middle-level understanding
- **4-6/10** — Good junior, keep practicing
- **< 4/10** — Review the topic fundamentals first
