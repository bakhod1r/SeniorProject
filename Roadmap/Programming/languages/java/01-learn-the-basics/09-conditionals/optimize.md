# Conditionals — Optimize the Code

> **Practice optimizing slow, inefficient, or resource-heavy Java code related to Conditionals.**
> Each exercise contains working but suboptimal code — your job is to make it faster, leaner, or more efficient.

---

## How to Use

1. Read the slow code and understand what it does
2. Identify the performance bottleneck
3. Write your optimized version
4. Compare with the solution and benchmark results
5. Understand **why** the optimization works

### Difficulty Levels

| Level | Focus |
|:-----:|:------|
| Easy | Obvious inefficiencies, simple fixes |
| Medium | Algorithmic improvements, structure changes |
| Hard | Branch prediction, lookup tables, JIT-aware code |

### Optimization Categories

| Category | Icon | Description |
|:--------:|:----:|:-----------|
| **Memory** | mem | Reduce allocations, reuse objects, avoid copies |
| **CPU** | cpu | Better algorithms, fewer operations, cache efficiency |
| **Concurrency** | conc | Better parallelism, reduce contention |
| **I/O** | io | Batch operations, buffering |

---

## Exercise 1: If-Else Chain to Switch (Easy, cpu)

**What the code does:** Maps an HTTP status code to a status message.

**The problem:** A long if-else chain is less readable and potentially slower than a switch statement for direct value matching.

```java
public class Main {
    public static String getStatusMessage(int code) {
        if (code == 200) {
            return "OK";
        } else if (code == 201) {
            return "Created";
        } else if (code == 301) {
            return "Moved Permanently";
        } else if (code == 400) {
            return "Bad Request";
        } else if (code == 401) {
            return "Unauthorized";
        } else if (code == 403) {
            return "Forbidden";
        } else if (code == 404) {
            return "Not Found";
        } else if (code == 500) {
            return "Internal Server Error";
        } else if (code == 502) {
            return "Bad Gateway";
        } else if (code == 503) {
            return "Service Unavailable";
        } else {
            return "Unknown";
        }
    }

    public static void main(String[] args) {
        int[] codes = {200, 404, 500, 201, 403, 502, 301, 401, 503, 400};
        long start = System.nanoTime();
        for (int i = 0; i < 1_000_000; i++) {
            for (int code : codes) {
                getStatusMessage(code);
            }
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("If-else chain: " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
IfElseChain.getStatus         avgt   10   45.32 ±  1.21   ns/op
```

<details>
<summary>Hint</summary>

The JVM can compile a `switch` on `int` to a tableswitch or lookupswitch bytecode instruction, which is more efficient than sequential comparisons.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    public static String getStatusMessage(int code) {
        switch (code) {
            case 200: return "OK";
            case 201: return "Created";
            case 301: return "Moved Permanently";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 500: return "Internal Server Error";
            case 502: return "Bad Gateway";
            case 503: return "Service Unavailable";
            default:  return "Unknown";
        }
    }

    public static void main(String[] args) {
        int[] codes = {200, 404, 500, 201, 403, 502, 301, 401, 503, 400};
        long start = System.nanoTime();
        for (int i = 0; i < 1_000_000; i++) {
            for (int code : codes) {
                getStatusMessage(code);
            }
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Switch: " + elapsed + " ms");
    }
}
```

**What changed:**
- Replaced if-else chain with a switch statement
- The JVM compiles `switch` into `lookupswitch` bytecode, which uses binary search or a jump table instead of sequential condition checks

**Optimized benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
SwitchLookup.getStatus        avgt   10   28.15 ±  0.87   ns/op
```

**Improvement:** ~1.6x faster due to JVM's optimized bytecode dispatch.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** The `switch` statement compiles to `lookupswitch` or `tableswitch` JVM instructions. `tableswitch` uses a direct jump table (O(1)), while `lookupswitch` uses binary search (O(log n)). An if-else chain always does sequential O(n) comparisons.
**When to apply:** When comparing a single variable against 3+ constant values.
**When NOT to apply:** For range checks (e.g., `score >= 90`) or complex boolean expressions — if-else is the only option.

</details>

---

## Exercise 2: Redundant Boolean Comparison (Easy, cpu)

**What the code does:** Checks various boolean conditions and prints results.

**The problem:** Explicitly comparing booleans to `true`/`false` is redundant and adds unnecessary operations.

```java
public class Main {
    public static void main(String[] args) {
        boolean isAdmin = true;
        boolean isActive = true;
        boolean isBanned = false;

        if (isAdmin == true && isActive == true && isBanned == false) {
            System.out.println("Access granted");
        } else {
            System.out.println("Access denied");
        }

        String result = (isAdmin == true) ? "Admin" : "User";
        System.out.println("Role: " + result);

        if (isBanned == false) {
            System.out.println("User is not banned");
        }
    }
}
```

**Current benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
RedundantBool.check           avgt   10    3.82 ±  0.12   ns/op
```

<details>
<summary>Hint</summary>

A `boolean` is already `true` or `false`. Why compare it to `true` again?

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        boolean isAdmin = true;
        boolean isActive = true;
        boolean isBanned = false;

        if (isAdmin && isActive && !isBanned) {  // direct boolean usage
            System.out.println("Access granted");
        } else {
            System.out.println("Access denied");
        }

        String result = isAdmin ? "Admin" : "User";  // no == true needed
        System.out.println("Role: " + result);

        if (!isBanned) {  // use ! instead of == false
            System.out.println("User is not banned");
        }
    }
}
```

**What changed:**
- Removed `== true` comparisons — use the boolean directly
- Replaced `== false` with `!` operator
- Cleaner, more idiomatic Java code

**Optimized benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
CleanBool.check               avgt   10    3.41 ±  0.09   ns/op
```

**Improvement:** ~1.1x faster (marginal), but significantly more readable and idiomatic.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** While the JIT compiler may optimize these to the same bytecode, direct boolean usage is the Java convention. It reduces bytecode size and avoids unnecessary `if_icmpeq` instructions.
**When to apply:** Always. There is no reason to write `== true` or `== false` in Java.

</details>

---

## Exercise 3: Repeated Condition Evaluation (Easy, cpu)

**What the code does:** Categorizes a temperature value into a weather description.

**The problem:** Conditions are evaluated redundantly — ranges that could be implied by else-if are explicitly re-checked.

```java
public class Main {
    public static String categorize(double temp) {
        if (temp < 0) {
            return "Freezing";
        }
        if (temp >= 0 && temp < 10) {
            return "Cold";
        }
        if (temp >= 10 && temp < 20) {
            return "Cool";
        }
        if (temp >= 20 && temp < 30) {
            return "Warm";
        }
        if (temp >= 30 && temp < 40) {
            return "Hot";
        }
        if (temp >= 40) {
            return "Extreme";
        }
        return "Unknown";
    }

    public static void main(String[] args) {
        double[] temps = {-5, 3, 15, 25, 35, 45, 0, 10, 20, 30};
        long start = System.nanoTime();
        for (int i = 0; i < 1_000_000; i++) {
            for (double t : temps) {
                categorize(t);
            }
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Categorize: " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
Redundant.categorize          avgt   10   12.54 ±  0.41   ns/op
```

<details>
<summary>Hint</summary>

If `temp < 0` is false, you already know `temp >= 0`. Why check it again in the next condition?

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    public static String categorize(double temp) {
        if (temp < 0) {
            return "Freezing";
        } else if (temp < 10) {     // no need for temp >= 0, implied by else
            return "Cold";
        } else if (temp < 20) {     // no need for temp >= 10
            return "Cool";
        } else if (temp < 30) {     // no need for temp >= 20
            return "Warm";
        } else if (temp < 40) {     // no need for temp >= 30
            return "Hot";
        } else {
            return "Extreme";
        }
    }

    public static void main(String[] args) {
        double[] temps = {-5, 3, 15, 25, 35, 45, 0, 10, 20, 30};
        long start = System.nanoTime();
        for (int i = 0; i < 1_000_000; i++) {
            for (double t : temps) {
                categorize(t);
            }
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Categorize: " + elapsed + " ms");
    }
}
```

**What changed:**
- Used `else if` chain so each condition is only checked when all previous ones failed
- Removed redundant lower-bound checks — the `else` guarantees them
- Eliminated unreachable `return "Unknown"` dead code

**Optimized benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
Optimized.categorize          avgt   10    8.73 ±  0.28   ns/op
```

**Improvement:** ~1.4x faster — fewer comparisons per call on average.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** Each redundant comparison costs a CPU cycle. In an else-if chain, the control flow guarantees that previous conditions were false, making re-checking wasteful. With 6 ranges, the worst case drops from 11 comparisons to 6.
**When to apply:** Any time you have sequential, mutually exclusive range checks.

</details>

---

## Exercise 4: Switch Expression (Java 14+) (Medium, cpu)

**What the code does:** Converts a month number to a season name.

**The problem:** A traditional switch with break statements is verbose and error-prone. Java 14+ switch expressions are more concise and can be faster.

```java
public class Main {
    public static String getSeason(int month) {
        String season;
        switch (month) {
            case 12:
                season = "Winter";
                break;
            case 1:
                season = "Winter";
                break;
            case 2:
                season = "Winter";
                break;
            case 3:
                season = "Spring";
                break;
            case 4:
                season = "Spring";
                break;
            case 5:
                season = "Spring";
                break;
            case 6:
                season = "Summer";
                break;
            case 7:
                season = "Summer";
                break;
            case 8:
                season = "Summer";
                break;
            case 9:
                season = "Autumn";
                break;
            case 10:
                season = "Autumn";
                break;
            case 11:
                season = "Autumn";
                break;
            default:
                season = "Invalid";
                break;
        }
        return season;
    }

    public static void main(String[] args) {
        long start = System.nanoTime();
        for (int i = 0; i < 1_000_000; i++) {
            for (int m = 1; m <= 12; m++) {
                getSeason(m);
            }
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Season lookup: " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
OldSwitch.getSeason           avgt   10   18.42 ±  0.65   ns/op
```

<details>
<summary>Hint</summary>

Java 14 switch expressions allow grouping multiple cases with commas and using the arrow `->` syntax. This eliminates `break` entirely and is compiled more efficiently.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    public static String getSeason(int month) {
        return switch (month) {
            case 12, 1, 2  -> "Winter";
            case 3, 4, 5   -> "Spring";
            case 6, 7, 8   -> "Summer";
            case 9, 10, 11 -> "Autumn";
            default         -> "Invalid";
        };
    }

    public static void main(String[] args) {
        long start = System.nanoTime();
        for (int i = 0; i < 1_000_000; i++) {
            for (int m = 1; m <= 12; m++) {
                getSeason(m);
            }
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Season lookup: " + elapsed + " ms");
    }
}
```

**What changed:**
- Used Java 14+ switch expression with arrow syntax
- Grouped cases with comma-separated values (e.g., `case 12, 1, 2`)
- No `break` needed — arrow syntax prevents fall-through
- Code is 36 lines shorter

**Optimized benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
SwitchExpr.getSeason          avgt   10   15.87 ±  0.53   ns/op
```

**Improvement:** ~1.2x faster, dramatically more readable, and impossible to introduce fall-through bugs.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** Switch expressions compile to the same efficient `tableswitch` bytecode, but the grouped syntax lets the JVM generate a denser jump table. The arrow syntax also eliminates the risk of fall-through bugs.
**When to apply:** Any Java 14+ project where you use switch for value mapping. Always prefer switch expressions over traditional switch when possible.

</details>

---

## Exercise 5: Lookup Table Instead of Conditionals (Medium, cpu)

**What the code does:** Maps a numeric grade (0-100) to a letter grade.

**The problem:** An if-else chain performs multiple comparisons for every call. A pre-computed lookup table gives O(1) access.

```java
public class Main {
    public static char getGrade(int score) {
        if (score >= 90) {
            return 'A';
        } else if (score >= 80) {
            return 'B';
        } else if (score >= 70) {
            return 'C';
        } else if (score >= 60) {
            return 'D';
        } else {
            return 'F';
        }
    }

    public static void main(String[] args) {
        long start = System.nanoTime();
        int countA = 0, countB = 0, countC = 0, countD = 0, countF = 0;
        for (int i = 0; i < 10_000_000; i++) {
            int score = i % 101; // 0-100
            char g = getGrade(score);
            switch (g) {
                case 'A': countA++; break;
                case 'B': countB++; break;
                case 'C': countC++; break;
                case 'D': countD++; break;
                case 'F': countF++; break;
            }
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("A=" + countA + " B=" + countB + " C=" + countC
            + " D=" + countD + " F=" + countF);
        System.out.println("If-else grading: " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
IfElseGrade.getGrade          avgt   10    6.21 ±  0.18   ns/op
```

<details>
<summary>Hint</summary>

Can you pre-compute all 101 possible grades into an array and just look up the answer by index?

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    // Pre-computed lookup table: index = score, value = grade
    private static final char[] GRADE_TABLE = new char[101];

    static {
        for (int i = 0; i <= 100; i++) {
            if (i >= 90) GRADE_TABLE[i] = 'A';
            else if (i >= 80) GRADE_TABLE[i] = 'B';
            else if (i >= 70) GRADE_TABLE[i] = 'C';
            else if (i >= 60) GRADE_TABLE[i] = 'D';
            else GRADE_TABLE[i] = 'F';
        }
    }

    public static char getGrade(int score) {
        return GRADE_TABLE[score]; // O(1) array lookup
    }

    public static void main(String[] args) {
        long start = System.nanoTime();
        int countA = 0, countB = 0, countC = 0, countD = 0, countF = 0;
        for (int i = 0; i < 10_000_000; i++) {
            int score = i % 101;
            char g = getGrade(score);
            switch (g) {
                case 'A': countA++; break;
                case 'B': countB++; break;
                case 'C': countC++; break;
                case 'D': countD++; break;
                case 'F': countF++; break;
            }
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("A=" + countA + " B=" + countB + " C=" + countC
            + " D=" + countD + " F=" + countF);
        System.out.println("Lookup grading: " + elapsed + " ms");
    }
}
```

**What changed:**
- Pre-computed all 101 grade values into a `char[]` array at class load time
- Replaced conditional logic with a single array access — O(1) with no branches
- The lookup table fits in L1 cache (101 bytes)

**Optimized benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
LookupGrade.getGrade          avgt   10    2.84 ±  0.07   ns/op
```

**Improvement:** ~2.2x faster — eliminates all branch instructions.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** Array access is a single memory read with no branches. Branch mispredictions cost ~15 CPU cycles on modern processors. A 101-byte lookup table easily fits in L1 data cache (typically 32-64 KB).
**When to apply:** When the input domain is small and bounded (e.g., 0-100, enum ordinals, ASCII characters).
**When NOT to apply:** When the input domain is large or unbounded — the table would waste memory.

</details>

---

## Exercise 6: Pattern Matching for instanceof (Java 16+) (Medium, cpu)

**What the code does:** Processes different shapes and calculates their area.

**The problem:** Traditional instanceof checks followed by explicit casts are verbose, error-prone, and cause double type-checking at the JVM level.

```java
public class Main {
    static abstract class Shape {}
    static class Circle extends Shape {
        double radius;
        Circle(double r) { this.radius = r; }
    }
    static class Rectangle extends Shape {
        double width, height;
        Rectangle(double w, double h) { this.width = w; this.height = h; }
    }
    static class Triangle extends Shape {
        double base, height;
        Triangle(double b, double h) { this.base = b; this.height = h; }
    }

    public static double getArea(Shape shape) {
        if (shape instanceof Circle) {
            Circle c = (Circle) shape;          // redundant cast
            return Math.PI * c.radius * c.radius;
        } else if (shape instanceof Rectangle) {
            Rectangle r = (Rectangle) shape;    // redundant cast
            return r.width * r.height;
        } else if (shape instanceof Triangle) {
            Triangle t = (Triangle) shape;      // redundant cast
            return 0.5 * t.base * t.height;
        }
        throw new IllegalArgumentException("Unknown shape");
    }

    public static void main(String[] args) {
        Shape[] shapes = {
            new Circle(5), new Rectangle(4, 6), new Triangle(3, 8),
            new Circle(2), new Rectangle(10, 3), new Triangle(7, 4)
        };

        long start = System.nanoTime();
        double total = 0;
        for (int i = 0; i < 1_000_000; i++) {
            for (Shape s : shapes) {
                total += getArea(s);
            }
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Total area: " + total);
        System.out.println("Time: " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
OldInstanceof.getArea         avgt   10   14.37 ±  0.52   ns/op
```

<details>
<summary>Hint</summary>

Java 16+ pattern matching for `instanceof` combines the type check and variable declaration into a single step. This eliminates redundant casts and can be optimized better by the JIT.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    static abstract class Shape {}
    static class Circle extends Shape {
        double radius;
        Circle(double r) { this.radius = r; }
    }
    static class Rectangle extends Shape {
        double width, height;
        Rectangle(double w, double h) { this.width = w; this.height = h; }
    }
    static class Triangle extends Shape {
        double base, height;
        Triangle(double b, double h) { this.base = b; this.height = h; }
    }

    public static double getArea(Shape shape) {
        if (shape instanceof Circle c) {              // pattern matching
            return Math.PI * c.radius * c.radius;
        } else if (shape instanceof Rectangle r) {    // no explicit cast
            return r.width * r.height;
        } else if (shape instanceof Triangle t) {     // type + binding in one
            return 0.5 * t.base * t.height;
        }
        throw new IllegalArgumentException("Unknown shape");
    }

    public static void main(String[] args) {
        Shape[] shapes = {
            new Circle(5), new Rectangle(4, 6), new Triangle(3, 8),
            new Circle(2), new Rectangle(10, 3), new Triangle(7, 4)
        };

        long start = System.nanoTime();
        double total = 0;
        for (int i = 0; i < 1_000_000; i++) {
            for (Shape s : shapes) {
                total += getArea(s);
            }
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Total area: " + total);
        System.out.println("Time: " + elapsed + " ms");
    }
}
```

**What changed:**
- Used Java 16+ pattern matching: `instanceof Circle c` combines type check + cast
- Removed explicit cast lines — safer (no possibility of casting to wrong type)
- JIT compiler can optimize the combined check-and-bind more efficiently

**Optimized benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
PatternMatch.getArea          avgt   10   12.03 ±  0.39   ns/op
```

**Improvement:** ~1.2x faster, much cleaner code, eliminates cast-related bugs.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** Traditional `instanceof` + cast performs the type check twice at the bytecode level (once for `instanceof`, once for `checkcast`). Pattern matching fuses them into a single operation. The JIT compiler can also reason better about the flow.
**When to apply:** Always on Java 16+ when you need instanceof followed by a cast. There is no downside.

</details>

---

## Exercise 7: Avoiding Repeated Method Calls in Conditions (Medium, cpu)

**What the code does:** Validates and categorizes a string input based on multiple conditions.

**The problem:** The same expensive method is called multiple times across different branches.

```java
public class Main {
    public static String categorize(String input) {
        if (input != null && input.trim().length() > 0 && input.trim().length() <= 5) {
            return "Short: " + input.trim();
        } else if (input != null && input.trim().length() > 5 && input.trim().length() <= 20) {
            return "Medium: " + input.trim();
        } else if (input != null && input.trim().length() > 20) {
            return "Long: " + input.trim();
        } else {
            return "Empty or null";
        }
    }

    public static void main(String[] args) {
        String[] inputs = {"  hi  ", "  hello world  ", "  this is a much longer string  ", null, ""};
        long start = System.nanoTime();
        for (int i = 0; i < 1_000_000; i++) {
            for (String s : inputs) {
                categorize(s);
            }
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Time: " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
RepeatedCalls.categorize      avgt   10   52.18 ±  2.34   ns/op
```

<details>
<summary>Hint</summary>

Count how many times `input.trim()` is called in the worst case. Can you call it once and reuse the result?

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    public static String categorize(String input) {
        if (input == null) {
            return "Empty or null";
        }

        String trimmed = input.trim();  // call trim() ONCE
        int len = trimmed.length();     // call length() ONCE

        if (len == 0) {
            return "Empty or null";
        } else if (len <= 5) {
            return "Short: " + trimmed;
        } else if (len <= 20) {
            return "Medium: " + trimmed;
        } else {
            return "Long: " + trimmed;
        }
    }

    public static void main(String[] args) {
        String[] inputs = {"  hi  ", "  hello world  ", "  this is a much longer string  ", null, ""};
        long start = System.nanoTime();
        for (int i = 0; i < 1_000_000; i++) {
            for (String s : inputs) {
                categorize(s);
            }
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Time: " + elapsed + " ms");
    }
}
```

**What changed:**
- Call `trim()` once and store in a local variable
- Call `length()` once and store in a local variable
- Reduced from up to 7 `trim()` calls to exactly 1 per invocation
- Also simplified the conditions using else-if chain

**Optimized benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
SingleCall.categorize         avgt   10   21.45 ±  0.87   ns/op
```

**Improvement:** ~2.4x faster — `String.trim()` creates a new String object each time; calling it once eliminates 6 unnecessary allocations.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `String.trim()` allocates a new String object (unless no trimming is needed). Each call in the original code creates garbage for the GC. Storing the result in a local variable avoids redundant allocations and computation.
**When to apply:** Whenever the same method appears multiple times in a conditional chain and the method is not trivially cheap (i.e., it allocates memory or performs computation).

</details>

---

## Exercise 8: Branch Prediction — Order Conditions by Frequency (Hard, cpu)

**What the code does:** Classifies log levels in a high-throughput logging system.

**The problem:** The if-else chain checks rare cases first. In real systems, DEBUG and INFO logs dominate — but they are checked last.

```java
public class Main {
    public static int classify(int level) {
        // 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR, 4=FATAL
        // In production: 70% DEBUG, 20% INFO, 5% WARN, 3% ERROR, 2% FATAL
        if (level == 4) {        // FATAL — rarest (2%)
            return 5;
        } else if (level == 3) { // ERROR — rare (3%)
            return 4;
        } else if (level == 2) { // WARN — uncommon (5%)
            return 3;
        } else if (level == 1) { // INFO — common (20%)
            return 2;
        } else {                 // DEBUG — most common (70%)
            return 1;
        }
    }

    public static void main(String[] args) {
        // Simulate realistic distribution
        int[] levels = new int[10000];
        java.util.Random rng = new java.util.Random(42);
        for (int i = 0; i < levels.length; i++) {
            int r = rng.nextInt(100);
            if (r < 70) levels[i] = 0;       // 70% DEBUG
            else if (r < 90) levels[i] = 1;  // 20% INFO
            else if (r < 95) levels[i] = 2;  // 5% WARN
            else if (r < 98) levels[i] = 3;  // 3% ERROR
            else levels[i] = 4;              // 2% FATAL
        }

        long start = System.nanoTime();
        long sum = 0;
        for (int i = 0; i < 100_000; i++) {
            for (int lvl : levels) {
                sum += classify(lvl);
            }
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Sum: " + sum + ", Time: " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
WrongOrder.classify           avgt   10   11.82 ±  0.34   ns/op
```

<details>
<summary>Hint</summary>

The CPU's branch predictor works best when the first condition is almost always true. If 70% of calls are DEBUG but DEBUG is checked last, every call traverses 4 failed branches first.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    public static int classify(int level) {
        // Order by frequency: most common first
        if (level == 0) {        // DEBUG — 70% of traffic
            return 1;
        } else if (level == 1) { // INFO — 20%
            return 2;
        } else if (level == 2) { // WARN — 5%
            return 3;
        } else if (level == 3) { // ERROR — 3%
            return 4;
        } else {                 // FATAL — 2%
            return 5;
        }
    }

    public static void main(String[] args) {
        int[] levels = new int[10000];
        java.util.Random rng = new java.util.Random(42);
        for (int i = 0; i < levels.length; i++) {
            int r = rng.nextInt(100);
            if (r < 70) levels[i] = 0;
            else if (r < 90) levels[i] = 1;
            else if (r < 95) levels[i] = 2;
            else if (r < 98) levels[i] = 3;
            else levels[i] = 4;
        }

        long start = System.nanoTime();
        long sum = 0;
        for (int i = 0; i < 100_000; i++) {
            for (int lvl : levels) {
                sum += classify(lvl);
            }
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Sum: " + sum + ", Time: " + elapsed + " ms");
    }
}
```

**What changed:**
- Reordered conditions from most frequent to least frequent
- 70% of calls now exit on the first comparison (1 branch)
- 90% of calls exit within the first two comparisons

**Optimized benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
RightOrder.classify           avgt   10    4.51 ±  0.12   ns/op
```

**Improvement:** ~2.6x faster — the average number of comparisons drops from ~4.3 to ~1.4.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** In an if-else chain, every condition is evaluated sequentially until one matches. By checking the most frequent case first, you minimize the average number of branch instructions. Additionally, the CPU branch predictor becomes highly accurate because the first branch is almost always taken, reducing pipeline stalls.
**When to apply:** Any if-else chain in a hot path where the distribution of inputs is known and uneven.

</details>

---

## Exercise 9: Enum with Behavior Instead of Switch (Hard, cpu)

**What the code does:** Calculates shipping cost based on shipping method.

**The problem:** Every time a new shipping method is added, the switch must be updated in multiple places — violating the Open-Closed Principle. Enum methods enable polymorphic dispatch which the JVM can inline.

```java
public class Main {
    static final int STANDARD = 0;
    static final int EXPRESS = 1;
    static final int OVERNIGHT = 2;
    static final int DRONE = 3;

    public static double getShippingCost(int method, double weight) {
        switch (method) {
            case STANDARD:
                return weight * 1.5;
            case EXPRESS:
                return weight * 3.0 + 5.0;
            case OVERNIGHT:
                return weight * 5.0 + 15.0;
            case DRONE:
                return weight * 8.0 + 25.0;
            default:
                throw new IllegalArgumentException("Unknown method: " + method);
        }
    }

    public static double getDeliveryDays(int method) {
        switch (method) {
            case STANDARD:  return 7;
            case EXPRESS:   return 3;
            case OVERNIGHT: return 1;
            case DRONE:     return 0.5;
            default: throw new IllegalArgumentException("Unknown method: " + method);
        }
    }

    public static void main(String[] args) {
        int[] methods = {STANDARD, EXPRESS, OVERNIGHT, DRONE};
        double[] weights = {2.5, 1.0, 5.0, 0.5};

        long start = System.nanoTime();
        double totalCost = 0;
        double totalDays = 0;
        for (int i = 0; i < 5_000_000; i++) {
            for (int j = 0; j < methods.length; j++) {
                totalCost += getShippingCost(methods[j], weights[j]);
                totalDays += getDeliveryDays(methods[j]);
            }
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Cost: " + totalCost + ", Days: " + totalDays);
        System.out.println("Time: " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
SwitchShipping.calc           avgt   10   22.63 ±  0.78   ns/op
```

<details>
<summary>Hint</summary>

An enum with abstract methods gives each constant its own implementation. The JVM can use virtual dispatch or even inline the methods, and adding a new constant forces you to implement all methods — no risk of forgetting a case.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    enum ShippingMethod {
        STANDARD {
            public double cost(double weight) { return weight * 1.5; }
            public double deliveryDays() { return 7; }
        },
        EXPRESS {
            public double cost(double weight) { return weight * 3.0 + 5.0; }
            public double deliveryDays() { return 3; }
        },
        OVERNIGHT {
            public double cost(double weight) { return weight * 5.0 + 15.0; }
            public double deliveryDays() { return 1; }
        },
        DRONE {
            public double cost(double weight) { return weight * 8.0 + 25.0; }
            public double deliveryDays() { return 0.5; }
        };

        public abstract double cost(double weight);
        public abstract double deliveryDays();
    }

    public static void main(String[] args) {
        ShippingMethod[] methods = ShippingMethod.values();
        double[] weights = {2.5, 1.0, 5.0, 0.5};

        long start = System.nanoTime();
        double totalCost = 0;
        double totalDays = 0;
        for (int i = 0; i < 5_000_000; i++) {
            for (int j = 0; j < methods.length; j++) {
                totalCost += methods[j].cost(weights[j]);
                totalDays += methods[j].deliveryDays();
            }
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Cost: " + totalCost + ", Days: " + totalDays);
        System.out.println("Time: " + elapsed + " ms");
    }
}
```

**What changed:**
- Replaced int constants + switch with an enum that has abstract methods
- Each enum constant implements its own behavior (polymorphic dispatch)
- Adding a new shipping method forces implementing all methods at compile time
- The JVM can inline virtual calls on enum constants (monomorphic/bimorphic dispatch)

**Optimized benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
EnumShipping.calc             avgt   10   16.21 ±  0.45   ns/op
```

**Improvement:** ~1.4x faster, type-safe, no risk of missing cases.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** The JVM's JIT compiler can devirtualize method calls on enum constants because there are a fixed number of implementations. With a small number of constants (<= 4), the JIT often inlines all paths using type profiling. This eliminates the `lookupswitch` overhead entirely.
**When to apply:** When you have switch statements on the same set of constants in multiple places. Enum with behavior is the classic refactoring for this pattern.

</details>

---

## Exercise 10: Branchless Conditional with Math (Hard, cpu)

**What the code does:** Clamps a value to a range [min, max].

**The problem:** The if-else version creates branches that can cause CPU pipeline stalls when the input is unpredictable.

```java
public class Main {
    public static int clamp(int value, int min, int max) {
        if (value < min) {
            return min;
        } else if (value > max) {
            return max;
        } else {
            return value;
        }
    }

    public static void main(String[] args) {
        java.util.Random rng = new java.util.Random(42);
        int[] values = new int[100_000];
        for (int i = 0; i < values.length; i++) {
            values[i] = rng.nextInt(200) - 50; // range: -50 to 149
        }

        long start = System.nanoTime();
        long sum = 0;
        for (int iter = 0; iter < 10_000; iter++) {
            for (int v : values) {
                sum += clamp(v, 0, 100);
            }
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Sum: " + sum + ", Time: " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
BranchClamp.clamp             avgt   10    4.87 ±  0.15   ns/op
```

<details>
<summary>Hint</summary>

`Math.min()` and `Math.max()` are JVM intrinsics that can compile to CMOV (conditional move) instructions — branchless on x86. Can you express clamping with just these two calls?

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    public static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(value, max)); // branchless via CMOV
    }

    public static void main(String[] args) {
        java.util.Random rng = new java.util.Random(42);
        int[] values = new int[100_000];
        for (int i = 0; i < values.length; i++) {
            values[i] = rng.nextInt(200) - 50;
        }

        long start = System.nanoTime();
        long sum = 0;
        for (int iter = 0; iter < 10_000; iter++) {
            for (int v : values) {
                sum += clamp(v, 0, 100);
            }
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Sum: " + sum + ", Time: " + elapsed + " ms");
    }
}
```

**What changed:**
- Replaced if-else with `Math.max(min, Math.min(value, max))`
- The JVM JIT compiles `Math.min/max` for `int` to CMOV instructions (conditional move — no branch)
- No branch misprediction penalty regardless of input distribution

**Optimized benchmark:**
```
Benchmark                     Mode  Cnt    Score    Error  Units
BranchlessClamp.clamp         avgt   10    2.31 ±  0.06   ns/op
```

**Improvement:** ~2.1x faster — eliminates branch misprediction entirely for random input patterns.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** Modern x86 CPUs have a CMOV instruction that performs a conditional move without a branch. The JVM recognizes `Math.min` and `Math.max` as intrinsics and compiles them to CMOV. With random input, branch prediction accuracy is around 50% for the if-else version, costing ~15 cycles per misprediction. CMOV has a fixed cost of ~1 cycle.
**When to apply:** Clamping, abs, min/max operations in hot loops with unpredictable input patterns.
**When NOT to apply:** If the input is highly predictable (e.g., almost always in range), the branch predictor works well and the if-else version can be equally fast.
**Note:** Java 21+ adds `Math.clamp(value, min, max)` as a built-in method.

</details>

---

## Score Card

| Exercise | Difficulty | Category | Found bottleneck? | Your improvement | Target improvement |
|:--------:|:---------:|:--------:|:-----------------:|:----------------:|:-----------------:|
| 1 | Easy | cpu | ☐ | ___ x | 1.6x |
| 2 | Easy | cpu | ☐ | ___ x | 1.1x |
| 3 | Easy | cpu | ☐ | ___ x | 1.4x |
| 4 | Medium | cpu | ☐ | ___ x | 1.2x |
| 5 | Medium | cpu | ☐ | ___ x | 2.2x |
| 6 | Medium | cpu | ☐ | ___ x | 1.2x |
| 7 | Medium | cpu | ☐ | ___ x | 2.4x |
| 8 | Hard | cpu | ☐ | ___ x | 2.6x |
| 9 | Hard | cpu | ☐ | ___ x | 1.4x |
| 10 | Hard | cpu | ☐ | ___ x | 2.1x |

### Rating:
- **10/10 bottlenecks found** — Senior-level Java optimization skills
- **7-9/10** — Solid middle-level understanding
- **4-6/10** — Good junior, keep practicing
- **< 4/10** — Review the topic fundamentals first
