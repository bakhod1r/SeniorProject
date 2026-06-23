# Math Operations — Optimize the Code

Optimize the slow or inefficient code in each exercise. Each snippet works correctly but has performance issues.

---

## Easy (4)

### Optimize 1: Repeated BigDecimal Object Creation

```java
import java.math.BigDecimal;
import java.math.RoundingMode;

public class Main {
    public static BigDecimal calculateTotal(double[] prices) {
        BigDecimal total = new BigDecimal("0");
        for (double price : prices) {
            BigDecimal bdPrice = new BigDecimal(String.valueOf(price));
            BigDecimal tax = new BigDecimal(String.valueOf(price))
                .multiply(new BigDecimal("0.08"))
                .setScale(2, RoundingMode.HALF_UP);
            total = total.add(bdPrice).add(tax);
        }
        return total.setScale(2, RoundingMode.HALF_UP);
    }

    public static void main(String[] args) {
        double[] prices = new double[100_000];
        for (int i = 0; i < prices.length; i++) prices[i] = 19.99;

        long start = System.nanoTime();
        BigDecimal result = calculateTotal(prices);
        long elapsed = System.nanoTime() - start;

        System.out.println("Total: " + result);
        System.out.printf("Time: %,d ms%n", elapsed / 1_000_000);
    }
}
```

<details>
<summary>Optimized Solution</summary>

**Problems:**
1. Creating `BigDecimal` from `String.valueOf(price)` twice per iteration
2. Creating `new BigDecimal("0.08")` every iteration
3. Creating `new BigDecimal("0")` instead of using `BigDecimal.ZERO`

**Optimized code:**

```java
import java.math.BigDecimal;
import java.math.RoundingMode;

public class Main {
    private static final BigDecimal TAX_RATE = new BigDecimal("0.08");
    private static final BigDecimal ONE_PLUS_TAX = BigDecimal.ONE.add(TAX_RATE);

    public static BigDecimal calculateTotal(double[] prices) {
        BigDecimal total = BigDecimal.ZERO;
        for (double price : prices) {
            BigDecimal bdPrice = BigDecimal.valueOf(price);  // more efficient than String.valueOf
            total = total.add(bdPrice.multiply(ONE_PLUS_TAX));
        }
        return total.setScale(2, RoundingMode.HALF_UP);
    }

    public static void main(String[] args) {
        double[] prices = new double[100_000];
        for (int i = 0; i < prices.length; i++) prices[i] = 19.99;

        long start = System.nanoTime();
        BigDecimal result = calculateTotal(prices);
        long elapsed = System.nanoTime() - start;

        System.out.println("Total: " + result);
        System.out.printf("Time: %,d ms%n", elapsed / 1_000_000);
    }
}
```

**Improvements:**
- Cache `TAX_RATE` and `ONE_PLUS_TAX` as constants (avoid per-iteration allocation)
- Use `BigDecimal.valueOf(double)` instead of `new BigDecimal(String.valueOf(double))`
- Single multiplication instead of separate price + tax calculation
- Use `BigDecimal.ZERO` instead of `new BigDecimal("0")`
</details>

---

### Optimize 2: Math.pow for Small Integer Powers

```java
public class Main {
    public static double sumOfSquares(double[] values) {
        double sum = 0;
        for (double v : values) {
            sum += Math.pow(v, 2);
        }
        return sum;
    }

    public static double sumOfCubes(double[] values) {
        double sum = 0;
        for (double v : values) {
            sum += Math.pow(v, 3);
        }
        return sum;
    }

    public static void main(String[] args) {
        double[] values = new double[10_000_000];
        for (int i = 0; i < values.length; i++) values[i] = Math.random() * 100;

        long start = System.nanoTime();
        double squares = sumOfSquares(values);
        System.out.printf("Sum of squares: %.2f (%,d ms)%n",
            squares, (System.nanoTime() - start) / 1_000_000);

        start = System.nanoTime();
        double cubes = sumOfCubes(values);
        System.out.printf("Sum of cubes:   %.2f (%,d ms)%n",
            cubes, (System.nanoTime() - start) / 1_000_000);
    }
}
```

<details>
<summary>Optimized Solution</summary>

**Problem:** `Math.pow(v, 2)` is a general-purpose power function (~12 ns/op). Simple multiplication `v * v` is ~2 ns/op — 6x faster.

**Optimized code:**

```java
public class Main {
    public static double sumOfSquares(double[] values) {
        double sum = 0;
        for (double v : values) {
            sum += v * v;  // 6x faster than Math.pow(v, 2)
        }
        return sum;
    }

    public static double sumOfCubes(double[] values) {
        double sum = 0;
        for (double v : values) {
            sum += v * v * v;  // faster than Math.pow(v, 3)
        }
        return sum;
    }

    public static void main(String[] args) {
        double[] values = new double[10_000_000];
        for (int i = 0; i < values.length; i++) values[i] = Math.random() * 100;

        long start = System.nanoTime();
        double squares = sumOfSquares(values);
        System.out.printf("Sum of squares: %.2f (%,d ms)%n",
            squares, (System.nanoTime() - start) / 1_000_000);

        start = System.nanoTime();
        double cubes = sumOfCubes(values);
        System.out.printf("Sum of cubes:   %.2f (%,d ms)%n",
            cubes, (System.nanoTime() - start) / 1_000_000);
    }
}
```

**Rule of thumb:** Use direct multiplication for powers 2-4. Use `Math.pow()` only for variable or large exponents.
</details>

---

### Optimize 3: Autoboxing in Accumulation Loop

```java
public class Main {
    public static void main(String[] args) {
        Integer sum = 0;
        long start = System.nanoTime();

        for (int i = 0; i < 10_000_000; i++) {
            sum += i;  // autoboxing: unbox, add, rebox
        }

        long elapsed = System.nanoTime() - start;
        System.out.printf("Sum: %d (%,d ms)%n", sum, elapsed / 1_000_000);
    }
}
```

<details>
<summary>Optimized Solution</summary>

**Problem:** `Integer sum += i` involves:
1. Unbox `sum` from `Integer` to `int`
2. Add `i`
3. Box result back to `Integer` (creates new object)

This creates ~10 million `Integer` objects, causing massive GC pressure.

**Optimized code:**

```java
public class Main {
    public static void main(String[] args) {
        int sum = 0;  // use primitive int
        long start = System.nanoTime();

        for (int i = 0; i < 10_000_000; i++) {
            sum += i;  // pure primitive arithmetic, no allocation
        }

        long elapsed = System.nanoTime() - start;
        System.out.printf("Sum: %d (%,d ms)%n", sum, elapsed / 1_000_000);
    }
}
```

**Improvement:** ~10-20x faster due to zero object allocation and no GC overhead.
</details>

---

### Optimize 4: Inefficient Max/Min Finding

```java
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        int[] values = new int[10_000_000];
        for (int i = 0; i < values.length; i++) {
            values[i] = (int) (Math.random() * 1_000_000);
        }

        // Finding max by sorting
        long start = System.nanoTime();
        List<Integer> list = new ArrayList<>();
        for (int v : values) list.add(v);
        Collections.sort(list);
        int max = list.get(list.size() - 1);
        int min = list.get(0);
        long elapsed = System.nanoTime() - start;

        System.out.printf("Max: %d, Min: %d (%,d ms)%n", max, min, elapsed / 1_000_000);
    }
}
```

<details>
<summary>Optimized Solution</summary>

**Problem:** Sorting is O(n log n) + autoboxing 10M ints. Finding min/max only needs O(n) with a single pass and no object allocation.

**Optimized code:**

```java
public class Main {
    public static void main(String[] args) {
        int[] values = new int[10_000_000];
        for (int i = 0; i < values.length; i++) {
            values[i] = (int) (Math.random() * 1_000_000);
        }

        long start = System.nanoTime();
        int max = Integer.MIN_VALUE;
        int min = Integer.MAX_VALUE;
        for (int v : values) {
            if (v > max) max = v;
            if (v < min) min = v;
        }
        long elapsed = System.nanoTime() - start;

        System.out.printf("Max: %d, Min: %d (%,d ms)%n", max, min, elapsed / 1_000_000);
    }
}
```

**Improvements:**
- O(n) instead of O(n log n) — single pass
- No autoboxing — uses primitive `int` throughout
- No `ArrayList` allocation — zero heap allocation
- Expected speedup: ~50-100x
</details>

---

## Medium (4)

### Optimize 5: Naive Floating-Point Summation

```java
public class Main {
    public static void main(String[] args) {
        int n = 50_000_000;
        double[] values = new double[n];
        for (int i = 0; i < n; i++) values[i] = 0.1;

        long start = System.nanoTime();
        double sum = 0;
        for (double v : values) {
            sum += v;  // accumulates rounding error
        }
        long elapsed = System.nanoTime() - start;

        System.out.printf("Sum: %.20f (error: %.2e) [%,d ms]%n",
            sum, Math.abs(sum - 5_000_000.0), elapsed / 1_000_000);
    }
}
```

<details>
<summary>Optimized Solution</summary>

**Problem:** Naive summation accumulates floating-point rounding errors, producing increasingly inaccurate results as the array grows.

**Optimized code (Kahan summation):**

```java
public class Main {
    public static void main(String[] args) {
        int n = 50_000_000;
        double[] values = new double[n];
        for (int i = 0; i < n; i++) values[i] = 0.1;

        long start = System.nanoTime();
        double sum = 0.0;
        double compensation = 0.0;
        for (double v : values) {
            double y = v - compensation;
            double t = sum + y;
            compensation = (t - sum) - y;
            sum = t;
        }
        long elapsed = System.nanoTime() - start;

        System.out.printf("Sum: %.20f (error: %.2e) [%,d ms]%n",
            sum, Math.abs(sum - 5_000_000.0), elapsed / 1_000_000);
    }
}
```

**Note:** This optimization targets **accuracy**, not speed. The Kahan version is slightly slower (~1.5x) but dramatically more precise (error reduced from ~10^-8 to ~10^-16).
</details>

---

### Optimize 6: BigDecimal in Hot Loop

```java
import java.math.BigDecimal;
import java.math.RoundingMode;

public class Main {
    // Simulate pricing engine — 1M calculations
    public static void main(String[] args) {
        int n = 1_000_000;
        BigDecimal[] prices = new BigDecimal[n];
        for (int i = 0; i < n; i++) {
            prices[i] = new BigDecimal(String.format("%.2f", Math.random() * 100));
        }

        long start = System.nanoTime();
        BigDecimal total = BigDecimal.ZERO;
        BigDecimal taxRate = new BigDecimal("0.085");

        for (BigDecimal price : prices) {
            BigDecimal tax = price.multiply(taxRate).setScale(2, RoundingMode.HALF_UP);
            BigDecimal priceWithTax = price.add(tax);
            total = total.add(priceWithTax);
        }
        total = total.setScale(2, RoundingMode.HALF_UP);

        long elapsed = System.nanoTime() - start;
        System.out.printf("Total: %s (%,d ms)%n", total, elapsed / 1_000_000);
    }
}
```

<details>
<summary>Optimized Solution</summary>

**Problem:** Each iteration creates multiple temporary `BigDecimal` objects (multiply, setScale, add). For 1M iterations, this is millions of heap allocations.

**Optimized code (fixed-point long):**

```java
import java.math.BigDecimal;
import java.math.RoundingMode;

public class Main {
    public static void main(String[] args) {
        int n = 1_000_000;

        // Store prices as cents (long)
        long[] priceCents = new long[n];
        for (int i = 0; i < n; i++) {
            priceCents[i] = Math.round(Math.random() * 10000);  // 0 to $100.00
        }

        long start = System.nanoTime();
        long totalCents = 0;
        // Tax rate: 8.5% = 85/1000
        // price + tax = price * 1085 / 1000

        for (long price : priceCents) {
            totalCents += (price * 1085 + 500) / 1000;  // rounded
        }

        BigDecimal total = BigDecimal.valueOf(totalCents, 2);

        long elapsed = System.nanoTime() - start;
        System.out.printf("Total: %s (%,d ms)%n", total, elapsed / 1_000_000);
    }
}
```

**Improvements:**
- Zero heap allocation in the hot loop
- Pure `long` arithmetic (10-100x faster than `BigDecimal`)
- Convert to `BigDecimal` only for display
- Expected speedup: ~50-80x
</details>

---

### Optimize 7: AtomicLong Under High Contention

```java
import java.util.concurrent.atomic.AtomicLong;

public class Main {
    public static void main(String[] args) throws InterruptedException {
        AtomicLong counter = new AtomicLong();
        int threadCount = 16;
        int opsPerThread = 10_000_000;

        long start = System.nanoTime();
        Thread[] threads = new Thread[threadCount];
        for (int t = 0; t < threadCount; t++) {
            threads[t] = new Thread(() -> {
                for (int i = 0; i < opsPerThread; i++) {
                    counter.incrementAndGet();
                }
            });
            threads[t].start();
        }
        for (Thread thread : threads) thread.join();
        long elapsed = System.nanoTime() - start;

        System.out.printf("Count: %d (%,d ms)%n", counter.get(), elapsed / 1_000_000);
    }
}
```

<details>
<summary>Optimized Solution</summary>

**Problem:** `AtomicLong` uses a single shared variable with CAS. Under 16-thread contention, most CAS attempts fail and retry, causing severe performance degradation.

**Optimized code (LongAdder):**

```java
import java.util.concurrent.atomic.LongAdder;

public class Main {
    public static void main(String[] args) throws InterruptedException {
        LongAdder counter = new LongAdder();
        int threadCount = 16;
        int opsPerThread = 10_000_000;

        long start = System.nanoTime();
        Thread[] threads = new Thread[threadCount];
        for (int t = 0; t < threadCount; t++) {
            threads[t] = new Thread(() -> {
                for (int i = 0; i < opsPerThread; i++) {
                    counter.increment();
                }
            });
            threads[t].start();
        }
        for (Thread thread : threads) thread.join();
        long elapsed = System.nanoTime() - start;

        System.out.printf("Count: %d (%,d ms)%n", counter.sum(), elapsed / 1_000_000);
    }
}
```

**Improvements:**
- `LongAdder` uses striped cells — each thread writes to its own cell, reducing contention
- Expected speedup: 5-10x under 16 threads
- Trade-off: `sum()` is not atomic (acceptable for write-heavy, read-infrequent workloads)
</details>

---

### Optimize 8: Redundant Math.sqrt in Distance Comparison

```java
public class Main {
    static double distance(double x1, double y1, double x2, double y2) {
        return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    }

    // Find all points within radius of origin
    public static void main(String[] args) {
        int n = 10_000_000;
        double[][] points = new double[n][2];
        for (int i = 0; i < n; i++) {
            points[i][0] = Math.random() * 200 - 100;
            points[i][1] = Math.random() * 200 - 100;
        }

        double radius = 50.0;
        long start = System.nanoTime();

        int count = 0;
        for (double[] p : points) {
            if (distance(0, 0, p[0], p[1]) <= radius) {
                count++;
            }
        }

        long elapsed = System.nanoTime() - start;
        System.out.printf("Points within radius: %d (%,d ms)%n", count, elapsed / 1_000_000);
    }
}
```

<details>
<summary>Optimized Solution</summary>

**Problems:**
1. `Math.sqrt()` is expensive (~15 cycles) and unnecessary for comparison — compare squared distances instead
2. `Math.pow(x, 2)` is slower than `x * x`

**Optimized code:**

```java
public class Main {
    // Find all points within radius of origin
    public static void main(String[] args) {
        int n = 10_000_000;
        double[][] points = new double[n][2];
        for (int i = 0; i < n; i++) {
            points[i][0] = Math.random() * 200 - 100;
            points[i][1] = Math.random() * 200 - 100;
        }

        double radius = 50.0;
        double radiusSquared = radius * radius;  // compare squared distances
        long start = System.nanoTime();

        int count = 0;
        for (double[] p : points) {
            double dx = p[0];
            double dy = p[1];
            if (dx * dx + dy * dy <= radiusSquared) {  // no sqrt, no pow
                count++;
            }
        }

        long elapsed = System.nanoTime() - start;
        System.out.printf("Points within radius: %d (%,d ms)%n", count, elapsed / 1_000_000);
    }
}
```

**Improvements:**
- Eliminated `Math.sqrt()` — compare squared distances (mathematically equivalent for comparison)
- Replaced `Math.pow(x, 2)` with `x * x` — 6x faster
- Eliminated method call overhead (`distance()` function call)
- Expected speedup: ~3-5x
</details>

---

## Hard (4)

### Optimize 9: Naive Fibonacci with BigInteger

```java
import java.math.BigInteger;

public class Main {
    // Naive recursive Fibonacci — exponential time!
    public static BigInteger fibonacci(int n) {
        if (n <= 1) return BigInteger.valueOf(n);
        return fibonacci(n - 1).add(fibonacci(n - 2));
    }

    public static void main(String[] args) {
        long start = System.nanoTime();
        BigInteger result = fibonacci(40);
        long elapsed = System.nanoTime() - start;
        System.out.printf("fib(40) = %s (%,d ms)%n", result, elapsed / 1_000_000);
    }
}
```

<details>
<summary>Optimized Solution</summary>

**Problem:** Naive recursion has O(2^n) time complexity. `fib(40)` makes ~1 billion recursive calls.

**Optimized code (iterative — O(n)):**

```java
import java.math.BigInteger;

public class Main {
    public static BigInteger fibonacci(int n) {
        if (n <= 1) return BigInteger.valueOf(n);

        BigInteger prev = BigInteger.ZERO;
        BigInteger curr = BigInteger.ONE;
        for (int i = 2; i <= n; i++) {
            BigInteger next = prev.add(curr);
            prev = curr;
            curr = next;
        }
        return curr;
    }

    // For very large n, use matrix exponentiation — O(log n)
    public static BigInteger fibonacciMatrix(int n) {
        if (n <= 1) return BigInteger.valueOf(n);

        BigInteger[][] matrix = {{BigInteger.ONE, BigInteger.ONE},
                                  {BigInteger.ONE, BigInteger.ZERO}};
        BigInteger[][] result = matrixPow(matrix, n - 1);
        return result[0][0];
    }

    private static BigInteger[][] matrixPow(BigInteger[][] m, int power) {
        BigInteger[][] result = {{BigInteger.ONE, BigInteger.ZERO},
                                  {BigInteger.ZERO, BigInteger.ONE}};
        while (power > 0) {
            if ((power & 1) == 1) result = matrixMultiply(result, m);
            m = matrixMultiply(m, m);
            power >>= 1;
        }
        return result;
    }

    private static BigInteger[][] matrixMultiply(BigInteger[][] a, BigInteger[][] b) {
        return new BigInteger[][] {
            {a[0][0].multiply(b[0][0]).add(a[0][1].multiply(b[1][0])),
             a[0][0].multiply(b[0][1]).add(a[0][1].multiply(b[1][1]))},
            {a[1][0].multiply(b[0][0]).add(a[1][1].multiply(b[1][0])),
             a[1][0].multiply(b[0][1]).add(a[1][1].multiply(b[1][1]))}
        };
    }

    public static void main(String[] args) {
        long start = System.nanoTime();
        BigInteger result = fibonacci(40);
        long elapsed = System.nanoTime() - start;
        System.out.printf("fib(40) iterative = %s (%,d ms)%n", result, elapsed / 1_000_000);

        start = System.nanoTime();
        BigInteger result2 = fibonacciMatrix(1000);
        elapsed = System.nanoTime() - start;
        System.out.printf("fib(1000) matrix = %s... (%d digits, %,d ms)%n",
            result2.toString().substring(0, 20), result2.toString().length(), elapsed / 1_000_000);
    }
}
```

**Improvements:**
- Iterative: O(n) time, O(1) space — handles millions instantly
- Matrix exponentiation: O(log n) — computes fib(1,000,000) in milliseconds
</details>

---

### Optimize 10: Repeated Division by Constant

```java
public class Main {
    // Convert array of bytes to percentages (0-100)
    public static double[] toPercentages(int[] values) {
        double[] result = new double[values.length];
        for (int i = 0; i < values.length; i++) {
            result[i] = values[i] / 255.0 * 100.0;
        }
        return result;
    }

    public static void main(String[] args) {
        int[] values = new int[50_000_000];
        for (int i = 0; i < values.length; i++) values[i] = (int)(Math.random() * 256);

        long start = System.nanoTime();
        double[] result = toPercentages(values);
        long elapsed = System.nanoTime() - start;

        System.out.printf("First 5: %.2f, %.2f, %.2f, %.2f, %.2f (%,d ms)%n",
            result[0], result[1], result[2], result[3], result[4], elapsed / 1_000_000);
    }
}
```

<details>
<summary>Optimized Solution</summary>

**Problem:** Division is ~4x slower than multiplication. `values[i] / 255.0 * 100.0` performs a division each iteration. Pre-compute the reciprocal.

**Optimized code:**

```java
public class Main {
    public static double[] toPercentages(int[] values) {
        double[] result = new double[values.length];
        double factor = 100.0 / 255.0;  // pre-compute: division -> multiplication
        for (int i = 0; i < values.length; i++) {
            result[i] = values[i] * factor;
        }
        return result;
    }

    public static void main(String[] args) {
        int[] values = new int[50_000_000];
        for (int i = 0; i < values.length; i++) values[i] = (int)(Math.random() * 256);

        long start = System.nanoTime();
        double[] result = toPercentages(values);
        long elapsed = System.nanoTime() - start;

        System.out.printf("First 5: %.2f, %.2f, %.2f, %.2f, %.2f (%,d ms)%n",
            result[0], result[1], result[2], result[3], result[4], elapsed / 1_000_000);
    }
}
```

**Note:** The JIT compiler often performs this optimization automatically (strength reduction). However, explicitly pre-computing constants makes code clearer and guarantees the optimization regardless of JIT behavior.
</details>

---

### Optimize 11: Inefficient GCD Calculation

```java
import java.math.BigInteger;

public class Main {
    // Naive GCD — Euclidean algorithm but using BigInteger unnecessarily
    public static long gcd(long a, long b) {
        BigInteger bigA = BigInteger.valueOf(Math.abs(a));
        BigInteger bigB = BigInteger.valueOf(Math.abs(b));
        return bigA.gcd(bigB).longValueExact();
    }

    // Find GCD of all pairs in array
    public static void main(String[] args) {
        int n = 10000;
        long[] values = new long[n];
        for (int i = 0; i < n; i++) values[i] = (long)(Math.random() * 1_000_000) + 1;

        long start = System.nanoTime();
        long totalGcds = 0;
        for (int i = 0; i < n; i++) {
            for (int j = i + 1; j < n; j++) {
                totalGcds += gcd(values[i], values[j]);
            }
        }
        long elapsed = System.nanoTime() - start;

        System.out.printf("Total GCDs sum: %d (%,d ms)%n", totalGcds, elapsed / 1_000_000);
    }
}
```

<details>
<summary>Optimized Solution</summary>

**Problem:** Creating two `BigInteger` objects per GCD call (50M pairs = 100M objects). For values that fit in `long`, use pure primitive arithmetic.

**Optimized code:**

```java
public class Main {
    // Pure primitive GCD — no heap allocation
    public static long gcd(long a, long b) {
        a = Math.abs(a);
        b = Math.abs(b);
        while (b != 0) {
            long temp = b;
            b = a % b;
            a = temp;
        }
        return a;
    }

    // Binary GCD (Stein's algorithm) — even faster, avoids division
    public static long binaryGcd(long a, long b) {
        if (a == 0) return Math.abs(b);
        if (b == 0) return Math.abs(a);
        a = Math.abs(a);
        b = Math.abs(b);

        int shift = Long.numberOfTrailingZeros(a | b);
        a >>= Long.numberOfTrailingZeros(a);

        do {
            b >>= Long.numberOfTrailingZeros(b);
            if (a > b) { long t = a; a = b; b = t; }
            b -= a;
        } while (b != 0);

        return a << shift;
    }

    public static void main(String[] args) {
        int n = 10000;
        long[] values = new long[n];
        for (int i = 0; i < n; i++) values[i] = (long)(Math.random() * 1_000_000) + 1;

        long start = System.nanoTime();
        long totalGcds = 0;
        for (int i = 0; i < n; i++) {
            for (int j = i + 1; j < n; j++) {
                totalGcds += gcd(values[i], values[j]);
            }
        }
        long elapsed = System.nanoTime() - start;

        System.out.printf("Total GCDs sum: %d (%,d ms)%n", totalGcds, elapsed / 1_000_000);
    }
}
```

**Improvements:**
- Zero heap allocation (pure primitive arithmetic)
- Binary GCD avoids expensive division operations, using only shifts and subtraction
- Expected speedup: 10-30x
</details>

---

### Optimize 12: Parallel Sum with Shared Mutable State

```java
public class Main {
    static double sharedSum = 0;  // not thread-safe!

    public static void main(String[] args) throws InterruptedException {
        double[] values = new double[100_000_000];
        for (int i = 0; i < values.length; i++) values[i] = Math.random();

        int threadCount = 8;
        Thread[] threads = new Thread[threadCount];
        int chunkSize = values.length / threadCount;

        long start = System.nanoTime();
        for (int t = 0; t < threadCount; t++) {
            final int from = t * chunkSize;
            final int to = (t == threadCount - 1) ? values.length : from + chunkSize;
            threads[t] = new Thread(() -> {
                for (int i = from; i < to; i++) {
                    synchronized (Main.class) {  // locks on every addition!
                        sharedSum += values[i];
                    }
                }
            });
            threads[t].start();
        }
        for (Thread thread : threads) thread.join();
        long elapsed = System.nanoTime() - start;

        System.out.printf("Sum: %.2f (%,d ms)%n", sharedSum, elapsed / 1_000_000);
    }
}
```

<details>
<summary>Optimized Solution</summary>

**Problems:**
1. `synchronized` on every single addition — makes it effectively single-threaded (worse, due to lock contention)
2. Shared mutable state is a design anti-pattern for parallel computation

**Optimized code (local accumulation, single merge):**

```java
public class Main {
    public static void main(String[] args) throws InterruptedException {
        double[] values = new double[100_000_000];
        for (int i = 0; i < values.length; i++) values[i] = Math.random();

        int threadCount = 8;
        Thread[] threads = new Thread[threadCount];
        double[] partialSums = new double[threadCount];  // each thread has its own slot
        int chunkSize = values.length / threadCount;

        long start = System.nanoTime();
        for (int t = 0; t < threadCount; t++) {
            final int idx = t;
            final int from = t * chunkSize;
            final int to = (t == threadCount - 1) ? values.length : from + chunkSize;
            threads[t] = new Thread(() -> {
                double localSum = 0;  // thread-local accumulator
                for (int i = from; i < to; i++) {
                    localSum += values[i];
                }
                partialSums[idx] = localSum;  // single write, no contention
            });
            threads[t].start();
        }
        for (Thread thread : threads) thread.join();

        // Merge partial sums (single-threaded, trivial)
        double totalSum = 0;
        for (double ps : partialSums) totalSum += ps;

        long elapsed = System.nanoTime() - start;
        System.out.printf("Sum: %.2f (%,d ms)%n", totalSum, elapsed / 1_000_000);
    }
}
```

**Improvements:**
- Zero contention — each thread accumulates into a local variable
- Single merge step at the end (8 additions)
- Expected speedup: ~6-8x on 8 cores (near-linear scaling)
- Could also use parallel streams: `Arrays.stream(values).parallel().sum()`
</details>
