# Math Operations — Find the Bug

> **Practice finding and fixing bugs in Java code related to Math Operations.**
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
| Easy | Common beginner mistakes — integer overflow, basic operator precedence, division truncation |
| Medium | BigDecimal misuse, modulo with negatives, floating-point comparison traps |
| Hard | Math.abs edge cases, overflow in midpoint calculation, accumulated rounding in financial math |

---

## Bug 1: Integer Overflow in Multiplication Easy

**What the code should do:** Calculate the total number of milliseconds in 50 days.

```java
public class Main {
    public static void main(String[] args) {
        int days = 50;
        int hoursPerDay = 24;
        int minutesPerHour = 60;
        int secondsPerMinute = 60;
        int millisecondsPerSecond = 1000;

        int totalMillis = days * hoursPerDay * minutesPerHour
                        * secondsPerMinute * millisecondsPerSecond;

        System.out.println("Milliseconds in " + days + " days: " + totalMillis);
    }
}
```

**Expected output:**
```
Milliseconds in 50 days: 4320000000
```

**Actual output:**
```
Milliseconds in 50 days: 25033728
```

<details>
<summary>Hint</summary>

All variables are `int`. The result `50 * 24 * 60 * 60 * 1000 = 4,320,000,000` — is that within the range of `Integer.MAX_VALUE` (2,147,483,647)?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** Integer overflow. The result `4,320,000,000` exceeds `Integer.MAX_VALUE` (2,147,483,647). Java performs all arithmetic in `int` since every operand is `int`, and the multiplication wraps around silently.

**Why it happens:** Java does not throw an exception on integer overflow. The 32-bit result wraps via two's complement arithmetic (JLS 15.17.1).

**Impact:** The computed value is completely wrong — a small positive number instead of 4.3 billion.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        long days = 50;
        long hoursPerDay = 24;
        long minutesPerHour = 60;
        long secondsPerMinute = 60;
        long millisecondsPerSecond = 1000;

        long totalMillis = days * hoursPerDay * minutesPerHour
                         * secondsPerMinute * millisecondsPerSecond;

        System.out.println("Milliseconds in " + days + " days: " + totalMillis);
        // Output: Milliseconds in 50 days: 4320000000
    }
}
```

**What changed:** Use `long` instead of `int` for all variables involved in the multiplication chain. Alternatively, use `Math.multiplyExact()` to detect overflow at runtime.

</details>

---

## Bug 2: Floating-Point Equality Comparison Easy

**What the code should do:** Check if a shopping cart total equals $1.00 after adding ten items at $0.10 each.

```java
public class Main {
    public static void main(String[] args) {
        double cartTotal = 0.0;
        for (int i = 0; i < 10; i++) {
            cartTotal += 0.1;
        }

        if (cartTotal == 1.0) {
            System.out.println("Cart total is $1.00 — proceed to checkout");
        } else {
            System.out.println("Cart total is NOT $1.00: " + cartTotal);
        }
    }
}
```

**Expected output:**
```
Cart total is $1.00 — proceed to checkout
```

**Actual output:**
```
Cart total is NOT $1.00: 0.9999999999999999
```

<details>
<summary>Hint</summary>

Can `0.1` be represented exactly in IEEE 754 binary floating-point? What happens when you add an inexact value ten times?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `0.1` cannot be represented exactly in IEEE 754 double-precision. Each addition introduces a small rounding error, and after 10 iterations the accumulated error makes the total slightly less than `1.0`.

**Why it happens:** Binary floating-point can only represent fractions whose denominators are powers of 2. `0.1 = 1/10` has a non-terminating binary representation.

**Impact:** The `==` comparison fails even though the values are mathematically equal. This can break financial logic, threshold checks, and conditional branches.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    private static final double EPSILON = 1e-9;

    public static void main(String[] args) {
        double cartTotal = 0.0;
        for (int i = 0; i < 10; i++) {
            cartTotal += 0.1;
        }

        // Option 1: Epsilon comparison
        if (Math.abs(cartTotal - 1.0) < EPSILON) {
            System.out.println("Cart total is $1.00 — proceed to checkout");
        }

        // Option 2: Use BigDecimal for exact decimal arithmetic
        // BigDecimal total = BigDecimal.ZERO;
        // BigDecimal increment = new BigDecimal("0.1");
        // for (int i = 0; i < 10; i++) total = total.add(increment);
        // if (total.compareTo(BigDecimal.ONE) == 0) { ... }
    }
}
```

**What changed:** Never compare `double` values with `==`. Use epsilon-based comparison for approximate equality, or use `BigDecimal` when exact decimal arithmetic is required.

</details>

---

## Bug 3: Integer Division Truncation Easy

**What the code should do:** Calculate a student's score as a percentage.

```java
public class Main {
    public static void main(String[] args) {
        int correct = 17;
        int total = 20;
        double percentage = correct / total * 100;
        System.out.println("Score: " + percentage + "%");
    }
}
```

**Expected output:**
```
Score: 85.0%
```

**Actual output:**
```
Score: 0.0%
```

<details>
<summary>Hint</summary>

What is the result of `17 / 20` when both operands are `int`? The division happens before the multiplication by 100.

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `correct / total` is integer division: `17 / 20 = 0`. Then `0 * 100 = 0`, which is widened to `double` `0.0`. The fractional part is discarded before multiplication.

**Why it happens:** Java uses integer arithmetic when both operands are `int` (JLS 15.17.2). The result is truncated toward zero.

**Impact:** The percentage is always `0.0%` for any score less than 100%.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        int correct = 17;
        int total = 20;
        // Cast one operand to double BEFORE the division
        double percentage = (double) correct / total * 100;
        System.out.println("Score: " + percentage + "%");
        // Output: Score: 85.0%
    }
}
```

**What changed:** Cast `correct` to `double` before division so that floating-point division is performed instead of integer division.

</details>

---

## Bug 4: Division by Zero — NaN Propagation Medium

**What the code should do:** Calculate speed and apply a bonus based on the result.

```java
public class Main {
    public static void main(String[] args) {
        double distance = 0.0;
        double time = 0.0;

        double speed = distance / time;
        System.out.println("Speed: " + speed);

        // NaN propagates silently through all calculations
        double bonus = speed + 50;
        if (bonus > 100) {
            System.out.println("High bonus!");
        } else if (bonus <= 100) {
            System.out.println("Normal bonus");
        } else {
            System.out.println("This should never print... right?");
        }
    }
}
```

**Expected output:**
```
Speed: NaN
Normal bonus
```

**Actual output:**
```
Speed: NaN
This should never print... right?
```

<details>
<summary>Hint</summary>

`NaN + 50` is `NaN`. What does `NaN > 100` return? What does `NaN <= 100` return? All comparisons involving NaN return the same value.

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** Any comparison involving `NaN` returns `false` — including `NaN > 100`, `NaN <= 100`, and `NaN == NaN`. So both the `if` and `else if` are `false`, and execution falls through to the `else` block.

**Why it happens:** IEEE 754 specifies that NaN is unordered. All relational comparisons with NaN yield `false` (JLS 15.20.1).

**Impact:** NaN propagates silently through calculations and defeats all conditional checks, leading to unreachable-looking code branches being executed.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        double distance = 0.0;
        double time = 0.0;

        double speed = distance / time;

        // Always check for NaN before using the result
        if (Double.isNaN(speed)) {
            System.out.println("Invalid speed calculation (0/0)");
            speed = 0.0; // use a safe default
        } else if (Double.isInfinite(speed)) {
            System.out.println("Invalid speed calculation (division by zero)");
            speed = 0.0;
        }

        double bonus = speed + 50;
        if (bonus > 100) {
            System.out.println("High bonus!");
        } else {
            System.out.println("Normal bonus");
        }
    }
}
```

**What changed:** Check for `NaN` and `Infinity` using `Double.isNaN()` and `Double.isInfinite()` before using the result in conditional logic.

</details>

---

## Bug 5: Modulo with Negative Numbers Medium

**What the code should do:** Map any integer offset to a valid array index (0 to 6) for a circular buffer.

```java
public class Main {
    public static void main(String[] args) {
        String[] days = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};

        int[] offsets = {0, 3, 7, -1, -8, 14, -14};
        for (int offset : offsets) {
            int index = offset % 7;
            System.out.println("Offset " + offset + " -> " + days[index]);
        }
    }
}
```

**Expected output:**
```
Offset 0 -> Sun
Offset 3 -> Wed
Offset 7 -> Sun
Offset -1 -> Sat
Offset -8 -> Sat
Offset 14 -> Sun
Offset -14 -> Sun
```

**Actual output:**
```
Exception in thread "main" java.lang.ArrayIndexOutOfBoundsException: Index -1 out of bounds for length 7
```

<details>
<summary>Hint</summary>

In Java, `(-1) % 7` returns `-1`, not `6`. The `%` operator preserves the sign of the dividend.

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** Java's `%` operator returns a result with the same sign as the dividend. `-1 % 7 = -1`, `-8 % 7 = -1`. Negative indices cause `ArrayIndexOutOfBoundsException`.

**Why it happens:** JLS 15.17.3 defines the remainder operation such that `(a/b)*b + (a%b) == a`. Since `-1/7 = 0` in integer division, `-1 % 7 = -1`.

**Impact:** Any negative offset crashes the program.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        String[] days = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};

        int[] offsets = {0, 3, 7, -1, -8, 14, -14};
        for (int offset : offsets) {
            // Option 1: Manual fix — always non-negative
            int index = ((offset % 7) + 7) % 7;

            // Option 2: Math.floorMod (Java 8+)
            // int index = Math.floorMod(offset, 7);

            System.out.println("Offset " + offset + " -> " + days[index]);
        }
    }
}
```

**What changed:** Use `((n % m) + m) % m` to ensure the result is always non-negative, or use `Math.floorMod()` which handles negative dividends correctly.

</details>

---

## Bug 6: BigDecimal Created from double Medium

**What the code should do:** Calculate the total price of 3 items at $19.99 each with exact precision.

```java
import java.math.BigDecimal;

public class Main {
    public static void main(String[] args) {
        BigDecimal price = new BigDecimal(19.99);
        BigDecimal quantity = new BigDecimal(3);
        BigDecimal total = price.multiply(quantity);

        System.out.println("Unit price: $" + price);
        System.out.println("Total:      $" + total);
    }
}
```

**Expected output:**
```
Unit price: $19.99
Total:      $59.97
```

**Actual output:**
```
Unit price: $19.989999999999998437694739946164190769195556640625
Total:      $59.969999999999995313084219838492572307586669921875
```

<details>
<summary>Hint</summary>

What is the difference between `new BigDecimal(19.99)` and `new BigDecimal("19.99")`? The `double` constructor captures the exact IEEE 754 binary representation.

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `new BigDecimal(19.99)` takes the exact binary representation of the `double` literal `19.99`, which is `19.989999999999998437...`. The imprecision is baked into the BigDecimal.

**Why it happens:** The `double` value `19.99` is already imprecise before the `BigDecimal` constructor sees it. The constructor faithfully records that imprecise value.

**Impact:** All subsequent calculations carry and amplify the error. Financial reports show wrong totals.

</details>

<details>
<summary>Fixed Code</summary>

```java
import java.math.BigDecimal;

public class Main {
    public static void main(String[] args) {
        // Use String constructor for exact decimal values
        BigDecimal price = new BigDecimal("19.99");
        BigDecimal quantity = new BigDecimal("3");
        BigDecimal total = price.multiply(quantity);

        System.out.println("Unit price: $" + price);  // $19.99
        System.out.println("Total:      $" + total);   // $59.97

        // Alternative: BigDecimal.valueOf(19.99) also works
        // because it uses Double.toString(19.99) internally
    }
}
```

**What changed:** Use `new BigDecimal("19.99")` (String constructor) instead of `new BigDecimal(19.99)` (double constructor). The String constructor creates an exact representation.

</details>

---

## Bug 7: BigDecimal Division Without Rounding Mode Medium

**What the code should do:** Split a bill of $100 equally among 3 people.

```java
import java.math.BigDecimal;

public class Main {
    public static void main(String[] args) {
        BigDecimal total = new BigDecimal("100.00");
        BigDecimal people = new BigDecimal("3");

        BigDecimal share = total.divide(people);
        System.out.println("Each person pays: $" + share);
    }
}
```

**Expected output:**
```
Each person pays: $33.33
```

**Actual output:**
```
Exception in thread "main" java.lang.ArithmeticException: Non-terminating decimal expansion; no exact representable decimal result.
```

<details>
<summary>Hint</summary>

`100 / 3 = 33.333...` is a non-terminating decimal. `BigDecimal` refuses to produce an inexact result unless you explicitly tell it how to round.

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `BigDecimal.divide()` without a rounding mode throws `ArithmeticException` when the result is a non-terminating decimal. Unlike `double` which silently truncates, `BigDecimal` requires explicit precision decisions.

**Why it happens:** `BigDecimal` is designed for exact arithmetic. When an exact result is impossible, it refuses to guess how to round.

**Impact:** Runtime crash for any division that produces an infinite decimal (1/3, 1/7, 1/6, etc.).

</details>

<details>
<summary>Fixed Code</summary>

```java
import java.math.BigDecimal;
import java.math.RoundingMode;

public class Main {
    public static void main(String[] args) {
        BigDecimal total = new BigDecimal("100.00");
        BigDecimal people = new BigDecimal("3");

        // Specify scale (decimal places) and rounding mode
        BigDecimal share = total.divide(people, 2, RoundingMode.HALF_UP);
        System.out.println("Each person pays: $" + share); // $33.33

        // Verify: 33.33 * 3 = 99.99 — one cent short!
        BigDecimal remainder = total.subtract(share.multiply(people));
        System.out.println("Remainder: $" + remainder); // $0.01
        System.out.println("Last person pays: $" + share.add(remainder)); // $33.34
    }
}
```

**What changed:** Use the three-argument `divide(divisor, scale, roundingMode)` to specify how many decimal places and which rounding strategy to use.

</details>

---

## Bug 8: Math.round Edge Cases with float Precision Hard

**What the code should do:** Round values and convert between int and float without precision loss.

```java
public class Main {
    public static void main(String[] args) {
        // Bug 1: float cannot represent 16777217 exactly
        float value = 16777217f;
        int rounded = Math.round(value);
        System.out.println("round(16777217f) = " + rounded);

        // Bug 2: implicit int-to-float widening loses precision
        int bigNumber = 123456789;
        float asFloat = bigNumber;
        System.out.println("Original int:    " + bigNumber);
        System.out.println("As float:        " + asFloat);
        System.out.println("Back to int:     " + (int) asFloat);

        // Bug 3: Math.round(-0.5f) does not round to -1
        System.out.println("round(-0.5f) = " + Math.round(-0.5f));
        System.out.println("round(0.5f)  = " + Math.round(0.5f));
    }
}
```

**Expected output:**
```
round(16777217f) = 16777217
Original int:    123456789
As float:        1.23456789E8
Back to int:     123456789
round(-0.5f) = -1
round(0.5f)  = 1
```

**Actual output:**
```
round(16777217f) = 16777216
Original int:    123456789
As float:        1.23456792E8
Back to int:     123456792
round(-0.5f) = 0
round(0.5f)  = 1
```

<details>
<summary>Hint</summary>

A `float` has only 24 bits of mantissa (~7 decimal digits of precision). What happens when you assign a large `int` to a `float`? Also, `Math.round` uses `floor(a + 0.5)` semantics — check what happens at exactly `-0.5`.

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** Three separate precision issues:
1. `float` cannot represent `16777217` exactly (2^24 + 1 exceeds mantissa precision), so it rounds to `16777216`.
2. Widening `int` to `float` silently loses precision for values > 2^24. Java allows this widening without a cast (JLS 5.1.2).
3. `Math.round(-0.5f)` returns `0` (not `-1`) because the implementation adds 0.5 and floors: `floor(-0.5 + 0.5) = floor(0.0) = 0`.

**Why it happens:** IEEE 754 single-precision has only 23 explicit mantissa bits (24 with implicit leading 1). JLS 5.1.2 allows widening from `int` to `float` despite potential precision loss.

**Impact:** Subtle numerical errors in graphics, scientific computing, and financial calculations.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        // Fix 1: Use double instead of float for large values
        double value = 16777217.0;
        long rounded = Math.round(value);
        System.out.println("round(16777217.0) = " + rounded); // 16777217

        // Fix 2: Use double for int-to-floating-point conversion
        int bigNumber = 123456789;
        double asDouble = bigNumber; // double has 52-bit mantissa — safe for all int values
        System.out.println("Original int:    " + bigNumber);
        System.out.println("As double:       " + asDouble);
        System.out.println("Back to int:     " + (int) asDouble); // 123456789

        // Fix 3: Be aware of Math.round asymmetry at -0.5
        // For symmetric rounding, use custom logic
        System.out.println("custom(-0.5) = " + roundAwayFromZero(-0.5)); // -1
        System.out.println("custom(0.5)  = " + roundAwayFromZero(0.5));  // 1
    }

    static long roundAwayFromZero(double value) {
        return (long) (value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5));
    }
}
```

**What changed:** Use `double` instead of `float` when precision matters. Be explicit about rounding semantics and never rely on silent `int`-to-`float` widening for large values.

</details>

---

## Bug 9: Overflow in Midpoint Calculation Hard

**What the code should do:** Calculate the midpoint of two integer values without overflow (classic binary search bug).

```java
public class Main {
    public static int binarySearch(int[] sorted, int target) {
        int low = 0;
        int high = sorted.length - 1;

        while (low <= high) {
            int mid = (low + high) / 2;
            if (sorted[mid] == target) return mid;
            else if (sorted[mid] < target) low = mid + 1;
            else high = mid - 1;
        }
        return -1;
    }

    public static void main(String[] args) {
        // Demonstrate the overflow
        int low = Integer.MAX_VALUE - 2;  // 2147483645
        int high = Integer.MAX_VALUE;     // 2147483647

        int mid = (low + high) / 2;
        System.out.println("Midpoint: " + mid);
    }
}
```

**Expected output:**
```
Midpoint: 2147483646
```

**Actual output:**
```
Midpoint: -1
```

<details>
<summary>Hint</summary>

This is the famous bug discovered by Joshua Bloch in `java.util.Arrays.binarySearch`. It existed in the JDK from 1997 to 2006. `low + high` overflows when both are large positive integers.

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `low + high` overflows `Integer.MAX_VALUE` when both values are large. `2147483645 + 2147483647 = 4294967292`, which wraps to `-4` in two's complement. Then `-4 / 2 = -2`, which is a negative index.

**Why it happens:** Java does not detect integer overflow (JLS 15.18.2). This bug existed in the JDK's `Arrays.binarySearch` implementation for nearly a decade (bug 5045582).

**Impact:** Binary search produces wrong results or throws `ArrayIndexOutOfBoundsException` for arrays with more than ~1 billion elements.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    public static int binarySearch(int[] sorted, int target) {
        int low = 0;
        int high = sorted.length - 1;

        while (low <= high) {
            // Fix: overflow-safe midpoint calculation
            int mid = low + (high - low) / 2;
            // Alternative: int mid = (low + high) >>> 1; // unsigned right shift
            if (sorted[mid] == target) return mid;
            else if (sorted[mid] < target) low = mid + 1;
            else high = mid - 1;
        }
        return -1;
    }

    public static void main(String[] args) {
        int low = Integer.MAX_VALUE - 2;
        int high = Integer.MAX_VALUE;

        int mid = low + (high - low) / 2;
        System.out.println("Midpoint: " + mid); // 2147483646
    }
}
```

**What changed:** Replaced `(low + high) / 2` with `low + (high - low) / 2`. Since `high >= low`, the subtraction `high - low` is always non-negative and cannot overflow. The unsigned right shift alternative `(low + high) >>> 1` also works because it treats the bits as unsigned.

</details>

---

## Bug 10: Math.abs Returns Negative for Integer.MIN_VALUE Hard

**What the code should do:** Compute the absolute difference between two integers safely.

```java
public class Main {
    public static int absoluteDifference(int a, int b) {
        return Math.abs(a - b);
    }

    public static void main(String[] args) {
        System.out.println(absoluteDifference(10, 5));
        System.out.println(absoluteDifference(-5, 10));
        System.out.println(absoluteDifference(Integer.MIN_VALUE, 0));
        System.out.println(absoluteDifference(Integer.MIN_VALUE, 1));

        // Direct demonstration
        System.out.println("Math.abs(Integer.MIN_VALUE) = " + Math.abs(Integer.MIN_VALUE));
    }
}
```

**Expected output:**
```
5
15
2147483648
2147483649
Math.abs(Integer.MIN_VALUE) = 2147483648
```

**Actual output:**
```
5
15
-2147483648
2147483647
Math.abs(Integer.MIN_VALUE) = -2147483648
```

<details>
<summary>Hint</summary>

`Integer.MIN_VALUE` is `-2147483648` but `Integer.MAX_VALUE` is `2147483647`. There is no positive `int` that equals `2147483648`. What does `Math.abs` return when the result does not fit?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `Math.abs(Integer.MIN_VALUE)` returns `Integer.MIN_VALUE` — a negative number. The two's complement negation of `-2147483648` is `2147483648`, which overflows back to `-2147483648`. Additionally, `Integer.MIN_VALUE - 1` overflows to `Integer.MAX_VALUE`, giving `Math.abs(Integer.MAX_VALUE) = 2147483647` instead of the correct `2147483649`.

**Why it happens:** JLS 15.15.4 specifies that unary minus of `Integer.MIN_VALUE` overflows. `Math.abs` is defined as `(a < 0) ? -a : a`, and `-Integer.MIN_VALUE` overflows to `Integer.MIN_VALUE`.

**Impact:** Any code assuming `Math.abs()` always returns a non-negative value can produce negative array indices, incorrect sort orders, or wrong distance calculations.

**JVM spec reference:** JLS 15.15.4, Javadoc for `Math.abs(int)`.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    public static long absoluteDifference(int a, int b) {
        // Widen to long BEFORE subtraction to avoid overflow
        return Math.abs((long) a - (long) b);
    }

    public static void main(String[] args) {
        System.out.println(absoluteDifference(10, 5));                  // 5
        System.out.println(absoluteDifference(-5, 10));                 // 15
        System.out.println(absoluteDifference(Integer.MIN_VALUE, 0));   // 2147483648
        System.out.println(absoluteDifference(Integer.MIN_VALUE, 1));   // 2147483649

        // Java 15+: Math.absExact throws ArithmeticException on overflow
        // Math.absExact(Integer.MIN_VALUE) -> ArithmeticException
    }
}
```

**What changed:** Return `long` instead of `int`, and widen both operands to `long` before subtraction. This ensures the intermediate value and the absolute value both fit. In Java 15+, `Math.absExact()` throws `ArithmeticException` instead of returning a wrong value.

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
- **10/10 without hints** — Senior-level Java math debugging skills
- **7-9/10** — Solid middle-level understanding
- **4-6/10** — Good junior, keep practicing
- **< 4/10** — Review the topic fundamentals first
