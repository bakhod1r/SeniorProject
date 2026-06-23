# Basic Syntax — Find the Bug

> **Practice finding and fixing bugs in Java code related to Basic Syntax.**
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
| 🟢 | **Easy** — Common beginner mistakes, missing syntax, naming errors |
| 🟡 | **Medium** — Subtle logic errors, type inference issues, scope problems |
| 🔴 | **Hard** — Unicode escapes, edge cases, JVM-level behavior |

---

## Bug 1: Missing Return Type 🟢

**What the code should do:** Calculate and return the sum of two integers.

```java
public class Main {
    static add(int a, int b) {
        return a + b;
    }

    public static void main(String[] args) {
        System.out.println(add(3, 5));
    }
}
```

**Expected output:**
```
8
```

**Actual output:**
```
Compilation error: invalid method declaration; return type required
```

<details>
<summary>💡 Hint</summary>

Every method in Java must declare its return type. Look at the method signature — what's missing?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** The method `add` is missing a return type declaration.
**Why it happens:** Unlike some languages (Python, JavaScript), Java requires explicit return type for every method. The compiler cannot infer it.
**Impact:** The code does not compile.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    static int add(int a, int b) {  // Added return type 'int'
        return a + b;
    }

    public static void main(String[] args) {
        System.out.println(add(3, 5));
    }
}
```

**What changed:** Added `int` return type to the method signature.

</details>

---

## Bug 2: Wrong Class Name 🟢

**What the code should do:** Print a greeting message.

```java
// File name: Greeter.java
public class Greeting {
    public static void main(String[] args) {
        System.out.println("Welcome to Java!");
    }
}
```

**Expected output:**
```
Welcome to Java!
```

**Actual output:**
```
Compilation error: class Greeting is public, should be declared in a file named Greeting.java
```

<details>
<summary>💡 Hint</summary>

Compare the file name with the class name.

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** The file is named `Greeter.java` but the public class is named `Greeting`.
**Why it happens:** Java requires the public class name to exactly match the file name (case-sensitive).
**Impact:** The code does not compile.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
// File name: Greeting.java  (renamed from Greeter.java)
public class Greeting {
    public static void main(String[] args) {
        System.out.println("Welcome to Java!");
    }
}
```

**What changed:** Renamed the file to `Greeting.java` to match the class name. Alternatively, rename the class to `Greeter`.

</details>

---

## Bug 3: Static Context Error 🟢

**What the code should do:** Greet the user by name.

```java
public class Main {
    String name = "Alice";

    void greet() {
        System.out.println("Hello, " + name + "!");
    }

    public static void main(String[] args) {
        greet();
    }
}
```

**Expected output:**
```
Hello, Alice!
```

**Actual output:**
```
Compilation error: non-static method greet() cannot be referenced from a static context
```

<details>
<summary>💡 Hint</summary>

The `main` method is `static`. Can it directly call a non-static method?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** The `main` method is `static` and tries to call a non-static method `greet()` directly.
**Why it happens:** Static methods belong to the class, not to an instance. They cannot access instance methods or fields without creating an object.
**Impact:** The code does not compile.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    String name = "Alice";

    void greet() {
        System.out.println("Hello, " + name + "!");
    }

    public static void main(String[] args) {
        Main app = new Main();  // Create an instance
        app.greet();             // Call via instance
    }
}
```

**What changed:** Created an instance of `Main` and called `greet()` on it. Alternatively, make both `name` and `greet()` static.

</details>

---

## Bug 4: Semicolon After If 🟡

**What the code should do:** Print "Even" if the number is even, "Odd" otherwise.

```java
public class Main {
    public static void main(String[] args) {
        int num = 7;

        if (num % 2 == 0);
        {
            System.out.println("Even");
        }

        System.out.println("Odd");
    }
}
```

**Expected output:**
```
Odd
```

**Actual output:**
```
Even
Odd
```

<details>
<summary>💡 Hint</summary>

Look carefully at the semicolon after the `if` condition. What does it do?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** There is a semicolon `;` immediately after `if (num % 2 == 0)`, creating an empty statement.
**Why it happens:** The semicolon terminates the `if` statement with an empty body. The `{ System.out.println("Even"); }` block is just an independent code block that always executes.
**Impact:** "Even" is always printed regardless of the condition.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        int num = 7;

        if (num % 2 == 0) {  // Removed semicolon
            System.out.println("Even");
        } else {
            System.out.println("Odd");
        }
    }
}
```

**What changed:** Removed the semicolon after `if`, added `else` clause for proper branching.

</details>

---

## Bug 5: String Comparison with == 🟡

**What the code should do:** Check if two strings are equal and print the result.

```java
public class Main {
    public static void main(String[] args) {
        String input = new String("hello");
        String expected = new String("hello");

        if (input == expected) {
            System.out.println("Strings match!");
        } else {
            System.out.println("Strings don't match!");
        }
    }
}
```

**Expected output:**
```
Strings match!
```

**Actual output:**
```
Strings don't match!
```

<details>
<summary>💡 Hint</summary>

`==` compares references in Java, not content. How should you compare strings?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** Using `==` to compare `String` objects compares their memory references, not their content.
**Why it happens:** `new String("hello")` creates a new object on the heap each time. Even though both have the same content, they are different objects with different references.
**Impact:** The comparison always returns `false` for `new String()` instances.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        String input = new String("hello");
        String expected = new String("hello");

        if (input.equals(expected)) {  // Use .equals() for content comparison
            System.out.println("Strings match!");
        } else {
            System.out.println("Strings don't match!");
        }
    }
}
```

**What changed:** Replaced `==` with `.equals()` for string content comparison.

</details>

---

## Bug 6: Variable Scope 🟡

**What the code should do:** Find the maximum of three numbers and print it.

```java
public class Main {
    public static void main(String[] args) {
        int a = 10, b = 25, c = 15;

        if (a > b && a > c) {
            int max = a;
        } else if (b > c) {
            int max = b;
        } else {
            int max = c;
        }

        System.out.println("Maximum: " + max);
    }
}
```

**Expected output:**
```
Maximum: 25
```

**Actual output:**
```
Compilation error: cannot find symbol: variable max
```

<details>
<summary>💡 Hint</summary>

Where is `max` declared? Is it accessible outside the `if-else` block?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** The variable `max` is declared inside each `if/else` block, making it local to that block scope.
**Why it happens:** Variables declared inside braces `{ }` are only visible within those braces. Outside the if-else, `max` does not exist.
**Impact:** Compilation error — `max` is not in scope at the `println` line.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        int a = 10, b = 25, c = 15;

        int max;  // Declare outside the if-else blocks
        if (a > b && a > c) {
            max = a;
        } else if (b > c) {
            max = b;
        } else {
            max = c;
        }

        System.out.println("Maximum: " + max);
    }
}
```

**What changed:** Declared `max` before the `if-else` blocks so it is accessible after them.

</details>

---

## Bug 7: Missing Break in Switch 🟡

**What the code should do:** Print the name of the day for a given number (1=Monday, etc.).

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
<summary>💡 Hint</summary>

Traditional switch statements in Java have "fall-through" behavior. What's missing at the end of each case?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** Missing `break` statements in each `case`. Java switch statements fall through to the next case by default.
**Why it happens:** This is inherited from C syntax. Without `break`, execution continues into subsequent cases.
**Impact:** All cases from the matching one onward execute.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        int day = 3;

        // Option 1: Add break statements
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
        }

        // Option 2 (Better): Use switch expression (Java 14+)
        String name = switch (day) {
            case 1 -> "Monday";
            case 2 -> "Tuesday";
            case 3 -> "Wednesday";
            case 4 -> "Thursday";
            case 5 -> "Friday";
            default -> "Weekend";
        };
        System.out.println(name);
    }
}
```

**What changed:** Added `break` statements, or better — use switch expressions which don't fall through.

</details>

---

## Bug 8: Unicode Escape in Comment 🔴

**What the code should do:** Print "Hello" — the comment should be ignored.

```java
public class Main {
    public static void main(String[] args) {
        // This is a comment \u000A System.out.println("INJECTED!");
        System.out.println("Hello");
    }
}
```

**Expected output:**
```
Hello
```

**Actual output:**
```
INJECTED!
Hello
```

<details>
<summary>💡 Hint</summary>

Unicode escapes (`\uXXXX`) are processed before the Java compiler parses comments. What is `\u000A`?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `\u000A` is the Unicode escape for a newline character (`\n`). The Java compiler processes Unicode escapes in the very first phase of compilation, BEFORE parsing comments. So the comment effectively becomes:
```
// This is a comment
 System.out.println("INJECTED!");
```
**Why it happens:** JLS Section 3.3 — Unicode escapes are processed during lexical translation, before tokenization.
**Impact:** Code injection through comments — a security concern in code review.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        // This is a comment (no unicode escapes here)
        System.out.println("Hello");
    }
}
```

**What changed:** Removed the Unicode escape from the comment. Never use `\u` sequences in comments unless intentional.

</details>

---

## Bug 9: Integer Autoboxing Comparison 🔴

**What the code should do:** Compare two integers and print whether they are equal.

```java
public class Main {
    public static void main(String[] args) {
        Integer a = 127;
        Integer b = 127;
        Integer c = 128;
        Integer d = 128;

        System.out.println("127 == 127: " + (a == b));
        System.out.println("128 == 128: " + (c == d));
    }
}
```

**Expected output:**
```
127 == 127: true
128 == 128: true
```

**Actual output:**
```
127 == 127: true
128 == 128: false
```

<details>
<summary>💡 Hint</summary>

Java caches Integer objects for values -128 to 127. What happens with `==` for values outside this range?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** Using `==` to compare `Integer` wrapper objects compares references, not values. Java caches `Integer` objects for values -128 to 127 (Integer cache). For 127, both `a` and `b` reference the same cached object. For 128, new objects are created on the heap, so `==` returns false.
**Why it happens:** JLS 5.1.7 — boxing conversion caches values in the range -128 to 127.
**Impact:** Incorrect equality checks for `Integer` values > 127 or < -128.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        Integer a = 127;
        Integer b = 127;
        Integer c = 128;
        Integer d = 128;

        System.out.println("127 == 127: " + a.equals(b));  // Use .equals()
        System.out.println("128 == 128: " + c.equals(d));  // Use .equals()
    }
}
```

**What changed:** Replaced `==` with `.equals()` for `Integer` comparison.

</details>

---

## Bug 10: Array Index vs Length 🔴

**What the code should do:** Print all elements of an array.

```java
public class Main {
    public static void main(String[] args) {
        String[] fruits = {"Apple", "Banana", "Cherry"};

        for (int i = 0; i <= fruits.length; i++) {
            System.out.println(fruits[i]);
        }
    }
}
```

**Expected output:**
```
Apple
Banana
Cherry
```

**Actual output:**
```
Apple
Banana
Cherry
Exception in thread "main" java.lang.ArrayIndexOutOfBoundsException: Index 3 out of bounds for length 3
```

<details>
<summary>💡 Hint</summary>

Array indices go from 0 to `length - 1`. What does `<=` vs `<` do in the loop condition?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** The loop uses `i <= fruits.length` instead of `i < fruits.length`. Arrays are zero-indexed: a 3-element array has indices 0, 1, 2. `fruits.length` is 3, so `fruits[3]` throws `ArrayIndexOutOfBoundsException`.
**Why it happens:** Classic off-by-one error. Common when developers think of length as the last valid index.
**Impact:** Runtime exception — the program crashes after printing all valid elements.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        String[] fruits = {"Apple", "Banana", "Cherry"};

        // Option 1: Fix the condition
        for (int i = 0; i < fruits.length; i++) {  // < not <=
            System.out.println(fruits[i]);
        }

        // Option 2 (Better): Use enhanced for-each loop
        for (String fruit : fruits) {
            System.out.println(fruit);
        }
    }
}
```

**What changed:** Changed `<=` to `<` in the loop condition. The for-each loop is preferred as it eliminates index errors entirely.

</details>

---

## Score Card

Track your progress:

| Bug | Difficulty | Found without hint? | Understood why? | Fixed correctly? |
|:---:|:---------:|:-------------------:|:---------------:|:----------------:|
| 1 | 🟢 | ☐ | ☐ | ☐ |
| 2 | 🟢 | ☐ | ☐ | ☐ |
| 3 | 🟢 | ☐ | ☐ | ☐ |
| 4 | 🟡 | ☐ | ☐ | ☐ |
| 5 | 🟡 | ☐ | ☐ | ☐ |
| 6 | 🟡 | ☐ | ☐ | ☐ |
| 7 | 🟡 | ☐ | ☐ | ☐ |
| 8 | 🔴 | ☐ | ☐ | ☐ |
| 9 | 🔴 | ☐ | ☐ | ☐ |
| 10 | 🔴 | ☐ | ☐ | ☐ |

### Rating:
- **10/10 without hints** → Senior-level Java debugging skills
- **7-9/10** → Solid middle-level understanding
- **4-6/10** → Good junior, keep practicing
- **< 4/10** → Review the topic fundamentals first
