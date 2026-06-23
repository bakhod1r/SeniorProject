# Data Types — Find the Bug

> **Practice finding and fixing bugs in Java code related to Data Types.**
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
| Easy | Common beginner mistakes, basic logic errors |
| Medium | Autoboxing pitfalls, precision loss, overflow |
| Hard | Subtle JVM behavior, concurrency, silent data corruption |

---

## Bug 1: The Mysterious Loop

**What the code should do:** Print numbers from 0 to 200.

```java
public class Main {
    public static void main(String[] args) {
        for (byte i = 0; i <= 200; i++) {
            System.out.println(i);
        }
    }
}
```

**Expected output:**
```
0
1
2
...
200
```

**Actual output:**
```
0
1
...
127
-128
-127
...
(infinite loop!)
```

<details>
<summary>Hint</summary>

What is the maximum value of `byte`? What happens when it overflows?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `byte` max value is 127. When `i` reaches 127 and increments, it wraps to -128. Since -128 <= 200, the condition is always true.
**Why it happens:** Java `byte` is a signed 8-bit type (-128 to 127). Overflow wraps silently.
**Impact:** Infinite loop — program never terminates.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        // Use int for loop counters — JVM is optimized for int
        for (int i = 0; i <= 200; i++) {
            System.out.println(i);
        }
    }
}
```

**What changed:** Replaced `byte i` with `int i`. Always use `int` or `long` for loop variables.

</details>

---

## Bug 2: Equal but Not Equal

**What the code should do:** Check if two amounts are equal and print "Match".

```java
public class Main {
    public static void main(String[] args) {
        Integer price1 = 500;
        Integer price2 = 500;

        if (price1 == price2) {
            System.out.println("Match");
        } else {
            System.out.println("No match");
        }
    }
}
```

**Expected output:**
```
Match
```

**Actual output:**
```
No match
```

<details>
<summary>Hint</summary>

How does `==` work for `Integer` objects? What is the Integer cache range?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `==` compares object references, not values. `Integer` cache only covers -128 to 127. Since 500 > 127, two separate `Integer` objects are created.
**Why it happens:** `Integer.valueOf(500)` creates a new object each time (not cached).
**Impact:** Price comparison fails — customers could be overcharged or undercharged.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        Integer price1 = 500;
        Integer price2 = 500;

        // Use .equals() for value comparison
        if (price1.equals(price2)) {
            System.out.println("Match");
        } else {
            System.out.println("No match");
        }
    }
}
```

**What changed:** Replaced `==` with `.equals()` for value comparison.

</details>

---

## Bug 3: The Missing Penny

**What the code should do:** Calculate the total of 3 items priced at $0.10 each.

```java
public class Main {
    public static void main(String[] args) {
        double total = 0.0;
        for (int i = 0; i < 3; i++) {
            total += 0.10;
        }

        if (total == 0.30) {
            System.out.println("Total is $0.30");
        } else {
            System.out.println("Total is $" + total + " (unexpected!)");
        }
    }
}
```

**Expected output:**
```
Total is $0.30
```

**Actual output:**
```
Total is $0.30000000000000004 (unexpected!)
```

<details>
<summary>Hint</summary>

Can `double` represent 0.1 exactly in binary?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `double` uses IEEE 754 binary floating-point. 0.1 cannot be represented exactly in binary, so small rounding errors accumulate.
**Why it happens:** 0.1 in binary is a repeating fraction (like 1/3 in decimal). Each addition compounds the error.
**Impact:** Financial miscalculation — pennies lost or gained in every transaction.

</details>

<details>
<summary>Fixed Code</summary>

```java
import java.math.BigDecimal;

public class Main {
    public static void main(String[] args) {
        BigDecimal total = BigDecimal.ZERO;
        BigDecimal itemPrice = new BigDecimal("0.10"); // String constructor!

        for (int i = 0; i < 3; i++) {
            total = total.add(itemPrice);
        }

        if (total.compareTo(new BigDecimal("0.30")) == 0) {
            System.out.println("Total is $" + total);
        }
    }
}
```

**What changed:** Replaced `double` with `BigDecimal` using String constructor for exact decimal arithmetic.

</details>

---

## Bug 4: The Null Surprise

**What the code should do:** Calculate total price from a list of optional discounts.

```java
import java.util.Arrays;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<Integer> discounts = Arrays.asList(10, 20, null, 15);

        int totalDiscount = 0;
        for (Integer discount : discounts) {
            totalDiscount += discount; // unboxing
        }

        System.out.println("Total discount: " + totalDiscount);
    }
}
```

**Expected output:**
```
Total discount: 45
```

**Actual output / exception:**
```
Exception in thread "main" java.lang.NullPointerException
```

<details>
<summary>Hint</summary>

What happens when Java tries to unbox `null` to `int`?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** The list contains `null`. When `totalDiscount += discount` executes for the `null` element, Java calls `discount.intValue()` which throws `NullPointerException`.
**Why it happens:** Unboxing a null wrapper calls a method on null — automatic unboxing is syntactic sugar for `discount.intValue()`.
**Impact:** Application crash on any null value in the collection.

</details>

<details>
<summary>Fixed Code</summary>

```java
import java.util.Arrays;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<Integer> discounts = Arrays.asList(10, 20, null, 15);

        int totalDiscount = 0;
        for (Integer discount : discounts) {
            if (discount != null) {        // null check before unboxing
                totalDiscount += discount;
            }
        }

        System.out.println("Total discount: " + totalDiscount); // 45
    }
}
```

**What changed:** Added null check before unboxing. Alternative: `discounts.stream().filter(Objects::nonNull).mapToInt(Integer::intValue).sum()`

</details>

---

## Bug 5: The Year 2038 Problem

**What the code should do:** Calculate a timestamp 50 years from now.

```java
public class Main {
    public static void main(String[] args) {
        int currentTimeSeconds = (int)(System.currentTimeMillis() / 1000);
        int fiftyYearsInSeconds = 50 * 365 * 24 * 60 * 60;
        int futureTime = currentTimeSeconds + fiftyYearsInSeconds;

        System.out.println("Current: " + currentTimeSeconds);
        System.out.println("50 years later: " + futureTime);
        System.out.println("Time went backwards? " + (futureTime < currentTimeSeconds));
    }
}
```

**Expected output:**
```
Current: 1774000000
50 years later: 3350000000
Time went backwards? false
```

**Actual output:**
```
Current: 1774000000
50 years later: -something negative
Time went backwards? true
```

<details>
<summary>Hint</summary>

What is `50 * 365 * 24 * 60 * 60` computed as? What type are the literals?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** Two issues:
1. `50 * 365 * 24 * 60 * 60 = 1,576,800,000` — fits in `int`, but adding it to currentTimeSeconds (~1.77 billion) overflows `int` (max ~2.14 billion)
2. Even if the multiplication itself didn't overflow, the sum does.

**Why it happens:** All literals are `int`, so arithmetic is done in `int` range.
**Impact:** Timestamp goes negative — future date becomes a date in the past (1901).

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        long currentTimeSeconds = System.currentTimeMillis() / 1000; // long
        long fiftyYearsInSeconds = 50L * 365 * 24 * 60 * 60;        // L suffix!
        long futureTime = currentTimeSeconds + fiftyYearsInSeconds;

        System.out.println("Current: " + currentTimeSeconds);
        System.out.println("50 years later: " + futureTime);
        System.out.println("Time went backwards? " + (futureTime < currentTimeSeconds));
    }
}
```

**What changed:** Used `long` for all timestamp variables. Added `L` suffix to the first literal to force `long` arithmetic.

</details>

---

## Bug 6: The Phantom Duplicate

**What the code should do:** Count unique numbers in a list using a Set.

```java
import java.util.HashSet;
import java.util.Set;

public class Main {
    public static void main(String[] args) {
        Set<Short> numbers = new HashSet<>();

        for (int i = 0; i < 100; i++) {
            numbers.add((short) i);       // add Short
            numbers.remove(i);             // try to remove... but what type?
        }

        System.out.println("Size: " + numbers.size());
    }
}
```

**Expected output:**
```
Size: 0
```

**Actual output:**
```
Size: 100
```

<details>
<summary>Hint</summary>

What type does `numbers.remove(i)` autobox to? Is it `Short` or `Integer`?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `numbers.remove(i)` autoboxes `int i` to `Integer`, not `Short`. The set contains `Short` objects. `Integer(5).equals(Short(5))` is `false` — different wrapper types are never equal. So `remove()` never finds a match.
**Why it happens:** Autoboxing `int` always produces `Integer`, not `Short`. The set's `remove(Object)` method compares using `.equals()`, which checks type first.
**Impact:** Set keeps growing — memory leak in long-running applications.

</details>

<details>
<summary>Fixed Code</summary>

```java
import java.util.HashSet;
import java.util.Set;

public class Main {
    public static void main(String[] args) {
        Set<Short> numbers = new HashSet<>();

        for (int i = 0; i < 100; i++) {
            numbers.add((short) i);
            numbers.remove((short) i);    // explicit cast to short before autoboxing
        }

        System.out.println("Size: " + numbers.size()); // 0
    }
}
```

**What changed:** Cast `i` to `short` before passing to `remove()`, so it autoboxes to `Short` instead of `Integer`.

</details>

---

## Bug 7: The Slow Accumulator

**What the code should do:** Sum numbers from 0 to 9,999,999 efficiently.

```java
public class Main {
    public static void main(String[] args) {
        long start = System.nanoTime();

        Long sum = 0L;
        for (int i = 0; i < 10_000_000; i++) {
            sum += i;
        }

        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Sum: " + sum);
        System.out.println("Time: " + elapsed + " ms");
    }
}
```

**Expected output:**
```
Sum: 49999995000000
Time: ~50 ms
```

**Actual output:**
```
Sum: 49999995000000
Time: ~800 ms  (much slower than expected!)
```

<details>
<summary>Hint</summary>

Look at the type of `sum`. What happens on every `+=` operation?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `sum` is `Long` (wrapper), not `long` (primitive). Each `sum += i` involves: unbox `sum` to `long`, add `i`, rebox result to `Long`. This creates ~10 million `Long` objects.
**Why it happens:** `Long sum = 0L` declares a wrapper, not a primitive. The `+=` operator doesn't change the declaration.
**Impact:** 10-20x slower due to autoboxing overhead and GC pressure.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        long start = System.nanoTime();

        long sum = 0L;  // primitive long — no boxing
        for (int i = 0; i < 10_000_000; i++) {
            sum += i;
        }

        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Sum: " + sum);
        System.out.println("Time: " + elapsed + " ms");
    }
}
```

**What changed:** Changed `Long sum` to `long sum`. One character (`L` → `l`) = 15x performance improvement.

</details>

---

## Bug 8: The Silent Overflow

**What the code should do:** Calculate total bytes for a large file buffer.

```java
public class Main {
    public static void main(String[] args) {
        int width = 65536;
        int height = 65536;
        int bytesPerPixel = 4;

        int totalBytes = width * height * bytesPerPixel;

        System.out.println("Buffer size: " + totalBytes + " bytes");
        System.out.println("Buffer size: " + (totalBytes / 1024 / 1024) + " MB");

        byte[] buffer = new byte[totalBytes];
        System.out.println("Allocated successfully");
    }
}
```

**Expected output:**
```
Buffer size: 17179869184 bytes
Buffer size: 16384 MB
Allocated successfully
```

**Actual output:**
```
Buffer size: 0 bytes
Buffer size: 0 MB
Allocated successfully (or NegativeArraySizeException for other values)
```

<details>
<summary>Hint</summary>

What is 65536 * 65536 * 4 in `int` arithmetic? Does it overflow?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `65536 * 65536 = 4,294,967,296` which exceeds `Integer.MAX_VALUE` (2,147,483,647). The multiplication overflows and wraps to 0. Then `0 * 4 = 0`.
**Why it happens:** All operands are `int`, so the multiplication is done in 32-bit arithmetic. The result overflows silently.
**Impact:** Zero-sized buffer allocated — subsequent writes go out of bounds, or for slightly different values, `NegativeArraySizeException` is thrown.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        int width = 65536;
        int height = 65536;
        int bytesPerPixel = 4;

        // Use long arithmetic and overflow detection
        long totalBytes = (long) width * height * bytesPerPixel;

        if (totalBytes > Integer.MAX_VALUE) {
            System.out.println("Buffer too large for single array: " + totalBytes + " bytes");
            System.out.println("Consider using memory-mapped file or chunked allocation");
        } else {
            byte[] buffer = new byte[(int) totalBytes];
            System.out.println("Allocated " + totalBytes + " bytes");
        }
    }
}
```

**What changed:** Cast first operand to `long` before multiplication. Added overflow check before array allocation.
**Alternative fix:** `Math.multiplyExact(width, height)` throws `ArithmeticException` on overflow.

</details>

---

## Bug 9: The NaN Trap

**What the code should do:** Find the minimum value in an array, ignoring invalid entries.

```java
public class Main {
    public static void main(String[] args) {
        double[] temperatures = {23.5, Double.NaN, 18.2, 25.0, Double.NaN, 15.8};

        double min = Double.MAX_VALUE;
        for (double temp : temperatures) {
            if (temp < min) {
                min = temp;
            }
        }

        System.out.println("Minimum temperature: " + min);
    }
}
```

**Expected output:**
```
Minimum temperature: 15.8
```

**Actual output:**
```
Minimum temperature: 15.8
```

Wait — it seems correct! But try this input:

```java
double[] temperatures = {Double.NaN, 23.5, 18.2};
```

**Actual output:**
```
Minimum temperature: 1.7976931348623157E308
```

<details>
<summary>Hint</summary>

What does `NaN < anything` evaluate to? What if NaN is the first element and min starts at MAX_VALUE?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `NaN < x` is always `false` (IEEE 754 rule). If NaN appears before any valid value updates `min`, NaN comparisons silently skip. But the deeper bug: if ALL values are NaN, `min` stays at `Double.MAX_VALUE`. And if NaN is first, valid values that ARE less than MAX_VALUE still work — but the bug manifests when you expect NaN to be "less than" everything.

The real insidious bug: `Math.min(NaN, 5.0)` returns `NaN`, but `NaN < 5.0` is `false`. So manual comparison and `Math.min` behave differently with NaN.

**Why it happens:** IEEE 754 defines NaN as "unordered" — all comparisons except `!=` return `false`.
**Impact:** Silently returns wrong minimum when NaN is involved. In weather/sensor data, this corrupts analysis.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        double[] temperatures = {Double.NaN, 23.5, 18.2, 25.0, Double.NaN, 15.8};

        double min = Double.MAX_VALUE;
        boolean found = false;

        for (double temp : temperatures) {
            if (!Double.isNaN(temp) && temp < min) {
                min = temp;
                found = true;
            }
        }

        if (found) {
            System.out.println("Minimum temperature: " + min);
        } else {
            System.out.println("No valid temperatures found");
        }
    }
}
```

**What changed:** Added `!Double.isNaN(temp)` check before comparison. Added `found` flag for all-NaN case.
**Alternative fix:** Use streams: `Arrays.stream(temps).filter(d -> !Double.isNaN(d)).min()`

</details>

---

## Bug 10: The Race Condition Wrapper

**What the code should do:** Safely increment a shared counter using Integer wrapper.

```java
public class Main {
    private static Integer counter = 0;

    public static void main(String[] args) throws InterruptedException {
        Thread t1 = new Thread(() -> {
            for (int i = 0; i < 100_000; i++) {
                synchronized (counter) {
                    counter++;
                }
            }
        });

        Thread t2 = new Thread(() -> {
            for (int i = 0; i < 100_000; i++) {
                synchronized (counter) {
                    counter++;
                }
            }
        });

        t1.start();
        t2.start();
        t1.join();
        t2.join();

        System.out.println("Counter: " + counter);
        System.out.println("Expected: 200000");
    }
}
```

**Expected output:**
```
Counter: 200000
Expected: 200000
```

**Actual output:**
```
Counter: ~150000-199000 (inconsistent, race condition)
Expected: 200000
```

<details>
<summary>Hint</summary>

What object does `synchronized(counter)` lock on? Does `counter++` change which object `counter` refers to?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `counter++` is equivalent to `counter = Integer.valueOf(counter.intValue() + 1)`. This creates a NEW `Integer` object and assigns it to `counter`. So `synchronized(counter)` locks on DIFFERENT objects each iteration — the lock is useless.

**Why it happens:** `Integer` is immutable. `counter++` doesn't modify the existing object — it replaces the reference. Each thread may lock on a different object simultaneously.

**Impact:** Race condition — final count is less than expected. This is a concurrency bug that only manifests under load.

**JVM spec reference:** JLS 14.19 — synchronized statement locks on the object that the expression evaluates to at the time of entry.

</details>

<details>
<summary>Fixed Code</summary>

```java
import java.util.concurrent.atomic.AtomicInteger;

public class Main {
    private static final AtomicInteger counter = new AtomicInteger(0);

    public static void main(String[] args) throws InterruptedException {
        Thread t1 = new Thread(() -> {
            for (int i = 0; i < 100_000; i++) {
                counter.incrementAndGet(); // atomic, lock-free
            }
        });

        Thread t2 = new Thread(() -> {
            for (int i = 0; i < 100_000; i++) {
                counter.incrementAndGet();
            }
        });

        t1.start();
        t2.start();
        t1.join();
        t2.join();

        System.out.println("Counter: " + counter.get());   // 200000
        System.out.println("Expected: 200000");
    }
}
```

**What changed:** Replaced `Integer` with `AtomicInteger` which provides atomic increment without locking issues.
**Alternative fix:** Use a dedicated `final Object lock = new Object()` and synchronize on that.

</details>

---

## Bug 11: The Widening Trap

**What the code should do:** Calculate the average of two integers.

```java
public class Main {
    public static void main(String[] args) {
        int a = 7;
        int b = 2;

        double average = (a + b) / 2;

        System.out.println("Average of " + a + " and " + b + ": " + average);
    }
}
```

**Expected output:**
```
Average of 7 and 2: 4.5
```

**Actual output:**
```
Average of 7 and 2: 4.0
```

<details>
<summary>Hint</summary>

What is `(7 + 2) / 2` in integer arithmetic? When does the conversion to `double` happen?

</details>

<details>
<summary>Bug Explanation</summary>

**Bug:** `(a + b) / 2` performs integer division: `9 / 2 = 4` (truncated). The result `4` is then widened to `double` `4.0`. The division happens BEFORE the assignment to `double`.
**Why it happens:** All operands are `int`, so Java uses integer arithmetic. The `double` type of the variable only affects the final assignment, not the calculation.
**Impact:** Incorrect averages — could affect statistical computations, grading systems, etc.

</details>

<details>
<summary>Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        int a = 7;
        int b = 2;

        double average = (a + b) / 2.0; // 2.0 forces double division

        System.out.println("Average of " + a + " and " + b + ": " + average); // 4.5
    }
}
```

**What changed:** Changed `/ 2` to `/ 2.0`. The `double` literal forces the entire expression to use floating-point division. Alternative: `(double)(a + b) / 2`.

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
| 11 | Easy | ☐ | ☐ | ☐ |

### Rating:
- **11/11 without hints** → Senior-level Java debugging skills
- **8-10/11** → Solid middle-level understanding
- **5-7/11** → Good junior, keep practicing
- **< 5/11** → Review the topic fundamentals first
