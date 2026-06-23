# Variables and Scopes — Find the Bug

> **Practice finding and fixing bugs in Java code related to Variables and Scopes.**
> Each exercise contains buggy code — your job is to find the bug, explain why it happens, and fix it.

---

## How to Use

1. Read the buggy code carefully
2. Try to find the bug **without** looking at the hint
3. Write the fix yourself before checking the solution
4. Understand **why** the bug happens — not just how to fix it

### Difficulty Levels

| Level | Description |
|:-----:|:-----------|
| Easy | Common beginner mistakes, shadowing, uninitialized locals |
| Medium | Scope leaks, static vs instance confusion, incorrect initialization order |
| Hard | Subtle JVM behavior, closure capture, memory leaks from scope misuse |

---

## Bug 1: The Shadowed Counter

**What the code should do:** Increment the instance counter and print the updated value.

```java
public class Main {
    static int count = 0;

    public static void increment() {
        int count = 0;
        count++;
        System.out.println("Count: " + count);
    }

    public static void main(String[] args) {
        increment();
        increment();
        increment();
        System.out.println("Final count: " + count);
    }
}
```

**Expected output:**
```
Count: 1
Count: 2
Count: 3
Final count: 3
```

**Actual output:**
```
Count: 1
Count: 1
Count: 1
Final count: 0
```

<details>
<summary>Hint</summary>

Look at the `increment()` method. Is `count` inside the method the same variable as the field `count`?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** The local variable `int count = 0` inside `increment()` shadows the static field `count`. Each call creates a new local, increments it to 1, and discards it. The field is never modified.
**Why it happens:** Java allows local variables to have the same name as fields. The local takes precedence within its scope (JLS 6.4.1).
**Impact:** The static field `count` stays 0 forever; the method always prints 1.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    static int count = 0;

    public static void increment() {
        // Remove the local declaration — use the static field directly
        count++;
        System.out.println("Count: " + count);
    }

    public static void main(String[] args) {
        increment();
        increment();
        increment();
        System.out.println("Final count: " + count);
    }
}
```

**What changed:** Removed the local `int count = 0` declaration so the method modifies the static field instead.

</details>

---

## Bug 2: The Uninitialized Local

**What the code should do:** Determine discount based on membership level and print it.

```java
public class Main {
    public static void main(String[] args) {
        int discount;
        String level = "gold";

        if (level.equals("gold")) {
            discount = 20;
        } else if (level.equals("silver")) {
            discount = 10;
        }

        System.out.println("Discount: " + discount + "%");
    }
}
```

**Expected output:**
```
Discount: 20%
```

**Actual output:**
```
Compilation error: variable discount might not have been initialized
```

<details>
<summary>Hint</summary>

The compiler does not evaluate `level.equals("gold")` at compile time. What if none of the conditions is true?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** Local variables in Java are not automatically initialized. The compiler sees a code path where neither `if` nor `else if` is true, leaving `discount` unassigned.
**Why it happens:** Unlike fields (which get default values), local variables must be definitely assigned before use (JLS 16). The compiler performs definite assignment analysis and rejects the code.
**Impact:** Compilation failure — the code does not even run.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        int discount = 0; // Default value ensures definite assignment
        String level = "gold";

        if (level.equals("gold")) {
            discount = 20;
        } else if (level.equals("silver")) {
            discount = 10;
        }

        System.out.println("Discount: " + discount + "%");
    }
}
```

**What changed:** Initialized `discount` to `0` at declaration, ensuring it always has a value regardless of which branch executes.

</details>

---

## Bug 3: The Escaped Variable

**What the code should do:** Print the sum of numbers 1 through 5.

```java
public class Main {
    public static void main(String[] args) {
        for (int i = 1; i <= 5; i++) {
            int sum = 0;
            sum += i;
        }
        System.out.println("Sum: " + sum);
    }
}
```

**Expected output:**
```
Sum: 15
```

**Actual output:**
```
Compilation error: cannot find symbol: variable sum
```

<details>
<summary>Hint</summary>

Where is `sum` declared? What is its scope?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `sum` is declared inside the for-loop body. It is created and destroyed each iteration. Outside the loop, `sum` does not exist.
**Why it happens:** A variable declared inside a block `{ }` is only visible within that block (JLS 14.4). The `println` after the loop cannot see it.
**Impact:** Compilation failure. Even if it compiled, `sum` would be reset to 0 each iteration.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        int sum = 0; // Declare outside the loop so it persists
        for (int i = 1; i <= 5; i++) {
            sum += i;
        }
        System.out.println("Sum: " + sum);
    }
}
```

**What changed:** Moved `int sum = 0` before the loop so it lives in the method scope and accumulates values across all iterations.

</details>

---

## Bug 4: Static Access Confusion

**What the code should do:** Track how many `User` objects have been created and display the count.

```java
public class Main {
    int userCount = 0;

    public Main() {
        userCount++;
    }

    public static void main(String[] args) {
        Main u1 = new Main();
        Main u2 = new Main();
        Main u3 = new Main();
        System.out.println("Total users: " + u1.userCount);
    }
}
```

**Expected output:**
```
Total users: 3
```

**Actual output:**
```
Total users: 1
```

<details>
<summary>Hint</summary>

Is `userCount` shared across all instances or does each instance have its own copy?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `userCount` is an instance field, not a static field. Each `Main` object has its own `userCount` initialized to 0 and incremented to 1 in the constructor.
**Why it happens:** Instance fields belong to each object individually. To share state across all instances, the field must be `static`.
**Impact:** `u1.userCount` is 1, `u2.userCount` is 1, `u3.userCount` is 1. None shows 3.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    static int userCount = 0; // static — shared across all instances

    public Main() {
        userCount++;
    }

    public static void main(String[] args) {
        Main u1 = new Main();
        Main u2 = new Main();
        Main u3 = new Main();
        System.out.println("Total users: " + Main.userCount);
    }
}
```

**What changed:** Made `userCount` static so all instances share the same counter. Access via `Main.userCount` for clarity.

</details>

---

## Bug 5: Final Reassignment Trap

**What the code should do:** Update the tax rate based on region and compute the final price.

```java
public class Main {
    public static void main(String[] args) {
        final double taxRate = 0.10;
        String region = "EU";

        if (region.equals("EU")) {
            taxRate = 0.20;
        }

        double price = 100.0;
        double total = price + (price * taxRate);
        System.out.println("Total: $" + total);
    }
}
```

**Expected output:**
```
Total: $120.0
```

**Actual output:**
```
Compilation error: cannot assign a value to final variable taxRate
```

<details>
<summary>Hint</summary>

What does the `final` keyword mean for a local variable? Can you reassign it?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `taxRate` is declared `final`, which means it can only be assigned once. The `if` block tries to reassign it.
**Why it happens:** `final` local variables must be assigned exactly once (JLS 4.12.4). The compiler rejects any attempt to write to them again.
**Impact:** Compilation failure.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        String region = "EU";

        // Use final with a single conditional assignment
        final double taxRate;
        if (region.equals("EU")) {
            taxRate = 0.20;
        } else {
            taxRate = 0.10;
        }

        double price = 100.0;
        double total = price + (price * taxRate);
        System.out.println("Total: $" + total);
    }
}
```

**What changed:** Declared `final double taxRate` without initializing it, then assigned it exactly once inside an if/else. The compiler can verify definite single assignment (blank final).

</details>

---

## Bug 6: The Scope Leak in Try-Catch

**What the code should do:** Parse a string to an integer and use the result after the try block.

```java
public class Main {
    public static void main(String[] args) {
        try {
            int number = Integer.parseInt("42");
        } catch (NumberFormatException e) {
            System.out.println("Invalid number");
        }

        System.out.println("Parsed number: " + number);
    }
}
```

**Expected output:**
```
Parsed number: 42
```

**Actual output:**
```
Compilation error: cannot find symbol: variable number
```

<details>
<summary>Hint</summary>

Where is `number` declared? Is it accessible outside the `try` block?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `number` is declared inside the `try` block, so its scope ends with the closing brace of the `try`. The `println` statement is outside that scope.
**Why it happens:** Variables declared inside a block `{ }` are local to that block (JLS 14.4). The `try` block is a regular block scope.
**Impact:** Compilation error — `number` is not visible outside the try block.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        int number = 0; // Declare outside try with a default value
        try {
            number = Integer.parseInt("42");
        } catch (NumberFormatException e) {
            System.out.println("Invalid number");
        }

        System.out.println("Parsed number: " + number);
    }
}
```

**What changed:** Declared `number` before the `try` block so it is visible after it. Initialized with a default value (0) in case the parse fails.

</details>

---

## Bug 7: Parameter Shadowing Gone Wrong

**What the code should do:** Create a `Rectangle` with width 5 and height 10, then print the area.

```java
public class Main {
    int width;
    int height;

    public Main(int width, int height) {
        width = width;
        height = height;
    }

    public int area() {
        return width * height;
    }

    public static void main(String[] args) {
        Main rect = new Main(5, 10);
        System.out.println("Area: " + rect.area());
    }
}
```

**Expected output:**
```
Area: 50
```

**Actual output:**
```
Area: 0
```

<details>
<summary>Hint</summary>

In the constructor, what does `width = width;` actually do? Which `width` is being assigned to which?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** The constructor parameters shadow the instance fields. `width = width;` assigns the parameter to itself. The instance field `this.width` remains 0 (default for `int`).
**Why it happens:** When a parameter has the same name as a field, the parameter takes precedence within the method scope. You must use `this.` to refer to the field (JLS 6.4.1).
**Impact:** Both fields remain 0, so `area()` returns 0 * 0 = 0.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    int width;
    int height;

    public Main(int width, int height) {
        this.width = width;   // Use 'this' to reference the field
        this.height = height;
    }

    public int area() {
        return width * height;
    }

    public static void main(String[] args) {
        Main rect = new Main(5, 10);
        System.out.println("Area: " + rect.area());
    }
}
```

**What changed:** Added `this.` prefix to disambiguate the field from the constructor parameter.

</details>

---

## Bug 8: Null Reference from Uninitialized Field

**What the code should do:** Build a comma-separated string of items and print the result.

```java
import java.util.List;

public class Main {
    String result;

    public void buildList(List<String> items) {
        for (String item : items) {
            result = result + ", " + item;
        }
    }

    public static void main(String[] args) {
        Main builder = new Main();
        builder.buildList(List.of("apple", "banana", "cherry"));
        System.out.println(builder.result);
    }
}
```

**Expected output:**
```
apple, banana, cherry
```

**Actual output:**
```
null, apple, null, apple, banana, null, apple, banana, cherry
```

Wait, actually:
```
null, apple, null, apple, banana, null, apple, banana, cherry
```

No — the real actual output is:
```
null, apple, null, apple, banana, null, apple, banana, cherry
```

Corrected actual output:
```
null, apple, null, apple, banana, null, apple, banana, cherry
```

<details>
<summary>Hint</summary>

What is the default value of a `String` field in Java? What happens when you concatenate `null + ", " + "apple"`?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** The `String result` field defaults to `null` (not `""`). When `result + ", " + item` is evaluated, it starts with `"null, apple"`. Java converts `null` to the literal string `"null"` during string concatenation (JLS 15.18.1).
**Why it happens:** Instance fields of reference type default to `null`. String concatenation with `null` produces `"null"` instead of throwing an exception.
**Impact:** The output starts with `"null, apple, null, apple, banana..."` — corrupted data with the word "null" embedded.

</details>

<details>
<summary>Fixed Code</summary>

```java
import java.util.List;
import java.util.StringJoiner;

public class Main {
    public void buildList(List<String> items) {
        StringJoiner joiner = new StringJoiner(", ");
        for (String item : items) {
            joiner.add(item);
        }
        System.out.println(joiner.toString());
    }

    public static void main(String[] args) {
        Main builder = new Main();
        builder.buildList(List.of("apple", "banana", "cherry"));
    }
}
```

**What changed:** Used `StringJoiner` to properly handle comma-separated joining. Alternatively, initialize `result = ""` and handle the leading comma, but `StringJoiner` is the idiomatic approach.

</details>

---

## Bug 9: Lambda Captures and Effectively Final

**What the code should do:** Filter a list of numbers, keeping only those greater than a dynamically changing threshold.

```java
import java.util.List;
import java.util.stream.Collectors;

public class Main {
    public static void main(String[] args) {
        List<Integer> numbers = List.of(1, 5, 10, 15, 20, 25);
        int threshold = 5;

        // First filter: > 5
        List<Integer> filtered1 = numbers.stream()
            .filter(n -> n > threshold)
            .collect(Collectors.toList());
        System.out.println("Above " + threshold + ": " + filtered1);

        threshold = 15;

        // Second filter: > 15
        List<Integer> filtered2 = numbers.stream()
            .filter(n -> n > threshold)
            .collect(Collectors.toList());
        System.out.println("Above " + threshold + ": " + filtered2);
    }
}
```

**Expected output:**
```
Above 5: [10, 15, 20, 25]
Above 15: [20, 25]
```

**Actual output:**
```
Compilation error: local variables referenced from a lambda expression must be final or effectively final
```

<details>
<summary>Hint</summary>

A lambda can only capture local variables that are effectively final (never reassigned after initialization). What happens when `threshold` is modified?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** The lambda `n -> n > threshold` captures the local variable `threshold`. Since `threshold` is reassigned (`threshold = 15`), it is no longer effectively final and cannot be captured by a lambda.
**Why it happens:** JLS 15.27.2 requires that local variables referenced in lambdas must be effectively final. This prevents confusing behavior where the lambda might see the variable at different points in time.
**Impact:** Compilation failure.

</details>

<details>
<summary>Fixed Code</summary>

```java
import java.util.List;
import java.util.stream.Collectors;

public class Main {
    public static void main(String[] args) {
        List<Integer> numbers = List.of(1, 5, 10, 15, 20, 25);

        // Use separate effectively-final variables for each lambda
        final int threshold1 = 5;
        List<Integer> filtered1 = numbers.stream()
            .filter(n -> n > threshold1)
            .collect(Collectors.toList());
        System.out.println("Above " + threshold1 + ": " + filtered1);

        final int threshold2 = 15;
        List<Integer> filtered2 = numbers.stream()
            .filter(n -> n > threshold2)
            .collect(Collectors.toList());
        System.out.println("Above " + threshold2 + ": " + filtered2);
    }
}
```

**What changed:** Used separate `final` variables (`threshold1`, `threshold2`) instead of reassigning a single variable. Each lambda captures its own effectively final value.

</details>

---

## Bug 10: Instance Initializer Order Surprise

**What the code should do:** Initialize a configuration object with default settings and print them.

```java
public class Main {
    int maxRetries = initDefault();
    int timeout;

    {
        // Instance initializer block
        timeout = maxRetries * 1000;
        System.out.println("Initializer: timeout=" + timeout + ", maxRetries=" + maxRetries);
    }

    static int initDefault() {
        System.out.println("initDefault called");
        return 3;
    }

    public Main() {
        System.out.println("Constructor: timeout=" + timeout + ", maxRetries=" + maxRetries);
    }

    public static void main(String[] args) {
        Main config = new Main();
    }
}
```

**Expected output (what developer intended):**
```
initDefault called
Initializer: timeout=3000, maxRetries=3
Constructor: timeout=3000, maxRetries=3
```

**Actual output:**
```
initDefault called
Initializer: timeout=3000, maxRetries=3
Constructor: timeout=3000, maxRetries=3
```

Now change the field order:

```java
public class Main {
    int timeout;

    {
        // Instance initializer block
        timeout = maxRetries * 1000;
        System.out.println("Initializer: timeout=" + timeout + ", maxRetries=" + maxRetries);
    }

    int maxRetries = initDefault();

    static int initDefault() {
        System.out.println("initDefault called");
        return 3;
    }

    public Main() {
        System.out.println("Constructor: timeout=" + timeout + ", maxRetries=" + maxRetries);
    }

    public static void main(String[] args) {
        Main config = new Main();
    }
}
```

**Actual output now:**
```
Initializer: timeout=0, maxRetries=0
initDefault called
Constructor: timeout=0, maxRetries=3
```

<details>
<summary>Hint</summary>

Instance field initializers and instance initializer blocks run in the order they appear in the source code (top to bottom), before the constructor body. What is the value of `maxRetries` when the initializer block runs first?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** When the initializer block appears before the `maxRetries` field declaration, `maxRetries` is still 0 (default int value) because it has not been initialized yet. The computation `timeout = maxRetries * 1000` produces 0. Then `maxRetries` is initialized to 3, but `timeout` is never recalculated.
**Why it happens:** JLS 8.3.3 — instance field initializers and instance initializer blocks are executed in textual order. The field declaration `int maxRetries = initDefault()` below the block has not yet run.
**Impact:** `timeout` is 0 instead of 3000. The constructor sees stale/incorrect values. This bug is silent — no exception, just wrong data.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    // Ensure fields that depend on others are declared AFTER their dependencies
    int maxRetries = initDefault();
    int timeout;

    {
        // Instance initializer block — runs after maxRetries is initialized
        timeout = maxRetries * 1000;
        System.out.println("Initializer: timeout=" + timeout + ", maxRetries=" + maxRetries);
    }

    static int initDefault() {
        System.out.println("initDefault called");
        return 3;
    }

    public Main() {
        System.out.println("Constructor: timeout=" + timeout + ", maxRetries=" + maxRetries);
    }

    public static void main(String[] args) {
        Main config = new Main();
    }
}
```

**What changed:** Moved `maxRetries` declaration above the initializer block so it is initialized before the block computes `timeout`.
**Alternative fix:** Compute `timeout` in the constructor body instead of the initializer block, where all fields are guaranteed to be initialized.

</details>

---

## Bug 11: The Vanishing Loop Variable

**What the code should do:** Find the index of the first negative number in an array.

```java
public class Main {
    public static void main(String[] args) {
        int[] numbers = {3, 7, -2, 5, -8, 1};
        int index = -1;

        for (int i = 0; i < numbers.length; i++) {
            if (numbers[i] < 0) {
                int index = i;
                break;
            }
        }

        if (index == -1) {
            System.out.println("No negative numbers found");
        } else {
            System.out.println("First negative at index: " + index);
        }
    }
}
```

**Expected output:**
```
First negative at index: 2
```

**Actual output:**
```
Compilation error: variable index is already defined in method main(String[])
```

<details>
<summary>Hint</summary>

Look inside the `if` block. Is `int index = i;` declaring a new variable or assigning to the existing one?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `int index = i;` inside the `if` block declares a **new** local variable `index` that shadows the outer `index`. In Java, unlike some other languages, you cannot redeclare a local variable in an inner block if one with the same name exists in the enclosing method scope (JLS 14.4.2). This results in a compilation error.
**Why it happens:** Java disallows local variable shadowing within the same method to prevent exactly this kind of confusion.
**Impact:** Compilation error. Even in languages where this compiles, the outer `index` would remain -1.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        int[] numbers = {3, 7, -2, 5, -8, 1};
        int index = -1;

        for (int i = 0; i < numbers.length; i++) {
            if (numbers[i] < 0) {
                index = i; // Assign to existing variable, don't redeclare
                break;
            }
        }

        if (index == -1) {
            System.out.println("No negative numbers found");
        } else {
            System.out.println("First negative at index: " + index);
        }
    }
}
```

**What changed:** Removed the `int` keyword — use `index = i` (assignment) instead of `int index = i` (new declaration).

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
| 11 | Hard | ☐ | ☐ | ☐ |

### Rating:
- **11/11 without hints** — Senior-level understanding of Java variable scoping
- **8-10/11** — Solid middle-level understanding
- **5-7/11** — Good junior, keep practicing
- **< 5/11** — Review the topic fundamentals first
