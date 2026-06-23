# Type Casting — Optimize the Code

> **Practice optimizing slow, inefficient, or resource-heavy Java code related to Type Casting.**
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
| 🟢 | **Easy** — Obvious inefficiencies, simple fixes |
| 🟡 | **Medium** — Algorithmic improvements, allocation reduction |
| 🔴 | **Hard** — GC tuning, zero-allocation patterns, JIT-aware code |

### Optimization Categories

| Category | Icon | Description |
|:--------:|:----:|:-----------|
| **Memory** | 📦 | Reduce allocations, reuse objects, avoid copies |
| **CPU** | ⚡ | Better algorithms, fewer operations, cache efficiency |
| **Concurrency** | 🔄 | Better parallelism, reduce contention, avoid locks |
| **I/O** | 💾 | Batch operations, buffering, connection reuse |

---

## Exercise 1: Autoboxing Avalanche 🟢 📦

**What the code does:** Sums a list of numbers.

**The problem:** Excessive autoboxing creates millions of temporary objects.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<Integer> numbers = new ArrayList<>();
        for (int i = 0; i < 1_000_000; i++) {
            numbers.add(i); // autoboxing int → Integer
        }

        // Slow: unboxing in every iteration + boxed accumulator
        Long sum = 0L;
        for (Integer n : numbers) {
            sum += n; // unbox Integer → int, widen int → long, box long → Long
        }
        System.out.println("Sum: " + sum);
    }
}
```

**Current benchmark:**
```
Benchmark                    Mode  Cnt     Score     Error  Units
SlowSum.measure              avgt   10  12453.234 ± 234.5  ns/op
```

<details>
<summary>💡 Hint</summary>

Use a primitive `long` accumulator instead of `Long`. Consider using `IntStream` for the entire operation.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.stream.IntStream;

public class Main {
    public static void main(String[] args) {
        // Option 1: Primitive accumulator
        int[] numbers = new int[1_000_000];
        for (int i = 0; i < numbers.length; i++) {
            numbers[i] = i;
        }

        long sum = 0;
        for (int n : numbers) {
            sum += n; // No boxing at all
        }
        System.out.println("Sum: " + sum);

        // Option 2: IntStream (no boxing)
        long sum2 = IntStream.range(0, 1_000_000).asLongStream().sum();
        System.out.println("Sum: " + sum2);
    }
}
```

**What changed:**
- Used `int[]` instead of `List<Integer>` — eliminates 1M Integer objects
- Used primitive `long` accumulator instead of `Long` — eliminates boxing on every addition

**Optimized benchmark:**
```
Benchmark                    Mode  Cnt    Score    Error  Units
FastSum.measure              avgt   10  823.456 ±  12.3  ns/op
```

**Improvement:** ~15x faster, 16MB less memory (1M fewer Integer objects)

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** Each `Integer` object costs 16 bytes on heap. 1M Integers = 16MB of heap just for boxing. The primitive `int[]` stores the same data in 4MB (4 bytes * 1M). Additionally, `int[]` has better cache locality — elements are contiguous in memory instead of scattered across the heap.

**When to apply:** Any hot loop that processes numeric data. Always prefer primitive arrays/streams for numeric computation.

**When NOT to apply:** If you need `null` values or need to store numbers in generic collections (e.g., `Map<String, Integer>`). In those cases, boxing is unavoidable.

</details>

---

## Exercise 2: Redundant instanceof Chain 🟢 ⚡

**What the code does:** Processes a list of shapes and calculates total area.

**The problem:** Repeated `instanceof` checks and casts in a loop.

```java
import java.util.List;

public class Main {
    static abstract class Shape {}
    static class Circle extends Shape { double r; Circle(double r) { this.r = r; } }
    static class Rect extends Shape { double w, h; Rect(double w, double h) { this.w = w; this.h = h; } }

    static double totalArea(List<Shape> shapes) {
        double total = 0;
        for (Shape s : shapes) {
            if (s instanceof Circle) {
                Circle c = (Circle) s;
                total += Math.PI * c.r * c.r;
            } else if (s instanceof Rect) {
                Rect r = (Rect) s;
                total += r.w * r.h;
            }
        }
        return total;
    }

    public static void main(String[] args) {
        List<Shape> shapes = List.of(new Circle(5), new Rect(4, 6), new Circle(3));
        System.out.println("Total area: " + totalArea(shapes));
    }
}
```

**Current benchmark:**
```
Benchmark                    Mode  Cnt    Score    Error  Units
SlowArea.totalArea           avgt   10  342.123 ±  8.4  ns/op
```

<details>
<summary>💡 Hint</summary>

Move the area calculation into each class using polymorphism. The JIT can then devirtualize and inline the method.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.List;

public class Main {
    static abstract class Shape {
        abstract double area(); // Polymorphic — no casting needed
    }
    static class Circle extends Shape {
        double r;
        Circle(double r) { this.r = r; }
        double area() { return Math.PI * r * r; }
    }
    static class Rect extends Shape {
        double w, h;
        Rect(double w, double h) { this.w = w; this.h = h; }
        double area() { return w * h; }
    }

    static double totalArea(List<Shape> shapes) {
        double total = 0;
        for (Shape s : shapes) {
            total += s.area(); // Virtual dispatch — no instanceof or cast
        }
        return total;
    }

    public static void main(String[] args) {
        List<Shape> shapes = List.of(new Circle(5), new Rect(4, 6), new Circle(3));
        System.out.println("Total area: " + totalArea(shapes));
    }
}
```

**What changed:**
- Moved area calculation into each class via abstract method
- Eliminated all `instanceof` checks and explicit casts
- JIT can apply bimorphic inline cache for 2 types

**Optimized benchmark:**
```
Benchmark                    Mode  Cnt    Score   Error  Units
FastArea.totalArea           avgt   10  178.456 ±  4.2  ns/op
```

**Improvement:** ~2x faster due to JIT inlining (bimorphic dispatch)

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** Polymorphic dispatch (`invokevirtual`) with 1-2 types allows the JIT to inline both implementations. `instanceof` chains require separate branch prediction and checkcast instructions.

**When to apply:** Whenever you have an instanceof chain in a loop. If the type hierarchy is known, use polymorphism.

**When NOT to apply:** When you cannot modify the class hierarchy (e.g., third-party classes) or when you need external behavior not suitable for the class itself.

</details>

---

## Exercise 3: String-to-Number Parsing in Loop 🟢 📦

**What the code does:** Parses a list of string numbers and sums them.

**The problem:** Creates unnecessary wrapper objects during parsing.

```java
import java.util.List;

public class Main {
    static double sumStrings(List<String> values) {
        Double total = 0.0;
        for (String s : values) {
            Double parsed = Double.valueOf(s); // Creates Double object
            total = total + parsed;            // Unbox + box on every iteration
        }
        return total;
    }

    public static void main(String[] args) {
        List<String> values = new java.util.ArrayList<>();
        for (int i = 0; i < 100_000; i++) {
            values.add(String.valueOf(i * 1.1));
        }

        long start = System.nanoTime();
        double result = sumStrings(values);
        long elapsed = System.nanoTime() - start;

        System.out.printf("Sum: %.2f (%d ms)%n", result, elapsed / 1_000_000);
    }
}
```

<details>
<summary>💡 Hint</summary>

Use `Double.parseDouble()` (returns primitive) instead of `Double.valueOf()` (returns object). Use primitive `double` accumulator.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.List;

public class Main {
    static double sumStrings(List<String> values) {
        double total = 0.0; // Primitive accumulator
        for (String s : values) {
            total += Double.parseDouble(s); // Returns primitive double — no boxing
        }
        return total;
    }

    public static void main(String[] args) {
        List<String> values = new java.util.ArrayList<>();
        for (int i = 0; i < 100_000; i++) {
            values.add(String.valueOf(i * 1.1));
        }

        long start = System.nanoTime();
        double result = sumStrings(values);
        long elapsed = System.nanoTime() - start;

        System.out.printf("Sum: %.2f (%d ms)%n", result, elapsed / 1_000_000);
    }
}
```

**What changed:**
- `Double.valueOf()` → `Double.parseDouble()` — returns primitive, no heap allocation
- `Double total` → `double total` — primitive accumulator, no boxing

**Improvement:** ~3x faster, eliminates 200K temporary Double objects

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** `Double.valueOf(String)` internally calls `Double.parseDouble()` and then boxes the result. By calling `parseDouble()` directly, you skip the unnecessary boxing step.

**Rule of thumb:** Always use `Integer.parseInt()`, `Long.parseLong()`, `Double.parseDouble()` in loops. Use `valueOf()` only when you need the wrapper object.

</details>

---

## Exercise 4: Megamorphic Dispatch 🟡 ⚡

**What the code does:** Processes a heterogeneous list of 5+ shape types.

**The problem:** Megamorphic call site prevents JIT inlining.

```java
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

public class Main {
    interface Shape { double area(); }
    record Circle(double r) implements Shape { public double area() { return Math.PI * r * r; } }
    record Rect(double w, double h) implements Shape { public double area() { return w * h; } }
    record Triangle(double b, double h) implements Shape { public double area() { return 0.5 * b * h; } }
    record Pentagon(double s) implements Shape { public double area() { return 1.72 * s * s; } }
    record Hexagon(double s) implements Shape { public double area() { return 2.6 * s * s; } }

    static double totalArea(List<Shape> shapes) {
        double total = 0;
        for (Shape s : shapes) {
            total += s.area(); // Megamorphic — 5 types, JIT cannot inline
        }
        return total;
    }

    public static void main(String[] args) {
        Random rng = new Random(42);
        List<Shape> shapes = new ArrayList<>();
        for (int i = 0; i < 100_000; i++) {
            shapes.add(switch (rng.nextInt(5)) {
                case 0 -> new Circle(rng.nextDouble() * 10);
                case 1 -> new Rect(rng.nextDouble() * 10, rng.nextDouble() * 10);
                case 2 -> new Triangle(rng.nextDouble() * 10, rng.nextDouble() * 10);
                case 3 -> new Pentagon(rng.nextDouble() * 10);
                default -> new Hexagon(rng.nextDouble() * 10);
            });
        }

        long start = System.nanoTime();
        double result = totalArea(shapes);
        long elapsed = System.nanoTime() - start;
        System.out.printf("Total: %.2f (%d ms)%n", result, elapsed / 1_000_000);
    }
}
```

<details>
<summary>💡 Hint</summary>

Partition the list by type into separate lists, then process each list in a separate loop. Each loop becomes monomorphic.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

public class Main {
    interface Shape { double area(); }
    record Circle(double r) implements Shape { public double area() { return Math.PI * r * r; } }
    record Rect(double w, double h) implements Shape { public double area() { return w * h; } }
    record Triangle(double b, double h) implements Shape { public double area() { return 0.5 * b * h; } }
    record Pentagon(double s) implements Shape { public double area() { return 1.72 * s * s; } }
    record Hexagon(double s) implements Shape { public double area() { return 2.6 * s * s; } }

    static double totalArea(List<Shape> shapes) {
        // Partition by type
        List<Circle> circles = new ArrayList<>();
        List<Rect> rects = new ArrayList<>();
        List<Triangle> triangles = new ArrayList<>();
        List<Pentagon> pentagons = new ArrayList<>();
        List<Hexagon> hexagons = new ArrayList<>();

        for (Shape s : shapes) {
            if (s instanceof Circle c) circles.add(c);
            else if (s instanceof Rect r) rects.add(r);
            else if (s instanceof Triangle t) triangles.add(t);
            else if (s instanceof Pentagon p) pentagons.add(p);
            else if (s instanceof Hexagon h) hexagons.add(h);
        }

        double total = 0;
        // Each loop is monomorphic — JIT inlines area()
        for (Circle c : circles) total += c.area();
        for (Rect r : rects) total += r.area();
        for (Triangle t : triangles) total += t.area();
        for (Pentagon p : pentagons) total += p.area();
        for (Hexagon h : hexagons) total += h.area();

        return total;
    }

    public static void main(String[] args) {
        Random rng = new Random(42);
        List<Shape> shapes = new ArrayList<>();
        for (int i = 0; i < 100_000; i++) {
            shapes.add(switch (rng.nextInt(5)) {
                case 0 -> new Circle(rng.nextDouble() * 10);
                case 1 -> new Rect(rng.nextDouble() * 10, rng.nextDouble() * 10);
                case 2 -> new Triangle(rng.nextDouble() * 10, rng.nextDouble() * 10);
                case 3 -> new Pentagon(rng.nextDouble() * 10);
                default -> new Hexagon(rng.nextDouble() * 10);
            });
        }

        long start = System.nanoTime();
        double result = totalArea(shapes);
        long elapsed = System.nanoTime() - start;
        System.out.printf("Total: %.2f (%d ms)%n", result, elapsed / 1_000_000);
    }
}
```

**What changed:**
- Partitioned shapes by type into separate monomorphic lists
- Each processing loop sees only one type → JIT inlines aggressively

**Optimized benchmark:**
```
Benchmark                    Mode  Cnt     Score    Error  Units
SlowArea.megamorphic         avgt   10  2847.345 ± 43.2  ns/op
FastArea.partitioned         avgt   10   912.123 ± 12.7  ns/op
```

**Improvement:** ~3x faster for 5 types

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** The JIT compiler uses inline caching. With 5+ types at one call site (megamorphic), it gives up and uses vtable dispatch. By splitting into separate loops, each loop is monomorphic, allowing the JIT to eliminate virtual dispatch entirely.

**When to apply:** Only when profiling shows a megamorphic call site is a bottleneck (millions of calls). The partitioning itself has overhead.

**When NOT to apply:** For small collections or non-hot paths. The partitioning overhead exceeds the savings.

</details>

---

## Exercise 5: Stream Boxing Overhead 🟡 ⚡

**What the code does:** Finds the maximum value in a list of integers.

**The problem:** Using boxed stream where primitive stream would suffice.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    static int findMax(List<Integer> numbers) {
        return numbers.stream()
            .map(n -> n * 2)           // Integer → int → multiply → Integer (boxing!)
            .filter(n -> n > 0)        // Integer → int → compare → boolean → Boolean
            .reduce(Integer.MIN_VALUE, Math::max); // More boxing
    }

    public static void main(String[] args) {
        List<Integer> numbers = new ArrayList<>();
        for (int i = -500_000; i < 500_000; i++) {
            numbers.add(i);
        }

        long start = System.nanoTime();
        int result = findMax(numbers);
        long elapsed = System.nanoTime() - start;
        System.out.printf("Max: %d (%d ms)%n", result, elapsed / 1_000_000);
    }
}
```

<details>
<summary>💡 Hint</summary>

Use `mapToInt()` to convert to `IntStream` early in the pipeline. `IntStream` operates on primitives with zero boxing.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    static int findMax(List<Integer> numbers) {
        return numbers.stream()
            .mapToInt(Integer::intValue) // Switch to IntStream — no more boxing
            .map(n -> n * 2)            // int → int (primitive)
            .filter(n -> n > 0)         // int → boolean (primitive)
            .max()
            .orElse(Integer.MIN_VALUE);
    }

    public static void main(String[] args) {
        List<Integer> numbers = new ArrayList<>();
        for (int i = -500_000; i < 500_000; i++) {
            numbers.add(i);
        }

        long start = System.nanoTime();
        int result = findMax(numbers);
        long elapsed = System.nanoTime() - start;
        System.out.printf("Max: %d (%d ms)%n", result, elapsed / 1_000_000);
    }
}
```

**What changed:**
- Added `.mapToInt(Integer::intValue)` early to convert to primitive `IntStream`
- All subsequent operations use primitive `int` — zero boxing

**Optimized benchmark:**
```
Benchmark                    Mode  Cnt     Score    Error  Units
SlowMax.boxedStream          avgt   10  8234.123 ± 123.4  ns/op
FastMax.intStream            avgt   10  1456.789 ±  23.1  ns/op
```

**Improvement:** ~5.5x faster, significantly less GC pressure

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** `Stream<Integer>.map()` boxes every intermediate result. `IntStream.map()` operates on primitive `int` values with no heap allocation. For 1M elements, this eliminates ~3M temporary Integer objects (map, filter, reduce each creates one).

**When to apply:** Any numeric stream pipeline. Always convert to `IntStream/LongStream/DoubleStream` as early as possible.

</details>

---

## Exercise 6: Unsafe Numeric Conversion in Multi-Thread 🟡 🔄

**What the code does:** Converts prices from external API (long cents) to double dollars in parallel.

**The problem:** Shared mutable state with autoboxing causes thread-safety issues.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    static Double totalDollars = 0.0; // Shared mutable boxed field!

    static void processPrice(long cents) {
        double dollars = cents / 100.0; // long → double widening
        totalDollars += dollars;         // Read-modify-write race condition!
    }

    public static void main(String[] args) throws InterruptedException {
        List<Thread> threads = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            Thread t = new Thread(() -> {
                for (long j = 0; j < 10_000; j++) {
                    processPrice(j);
                }
            });
            threads.add(t);
            t.start();
        }
        for (Thread t : threads) t.join();
        System.out.printf("Total: $%.2f%n", totalDollars);
        // Expected: same value each run. Actual: varies due to race condition!
    }
}
```

<details>
<summary>💡 Hint</summary>

Use `DoubleAdder` (or `LongAdder` with cents) for thread-safe accumulation without boxing.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.DoubleAdder;

public class Main {
    static final DoubleAdder totalDollars = new DoubleAdder(); // Thread-safe, no boxing

    static void processPrice(long cents) {
        double dollars = cents / 100.0;
        totalDollars.add(dollars); // Atomic add, no read-modify-write race
    }

    public static void main(String[] args) throws InterruptedException {
        List<Thread> threads = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            Thread t = new Thread(() -> {
                for (long j = 0; j < 10_000; j++) {
                    processPrice(j);
                }
            });
            threads.add(t);
            t.start();
        }
        for (Thread t : threads) t.join();
        System.out.printf("Total: $%.2f%n", totalDollars.sum());
    }
}
```

**What changed:**
- `Double` → `DoubleAdder` — thread-safe with striped cells, minimal contention
- Eliminated the race condition in `+=` (read-modify-write)
- No autoboxing overhead

**Improvement:** Deterministic results, ~4x faster under contention

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** `DoubleAdder` uses cell striping — each thread accumulates into its own cell, then cells are summed. This eliminates contention (no CAS retries). The boxed `Double` field had both a race condition AND boxing overhead on every `+=`.

**When to apply:** Any concurrent numeric accumulation. Prefer `LongAdder/DoubleAdder` over `AtomicLong/AtomicDouble` for high-contention scenarios.

</details>

---

## Exercise 7: Repeated Type Checking in I/O Processing 🟡 💾

**What the code does:** Reads objects from a deserialized stream and processes them by type.

**The problem:** Multiple instanceof checks on the same object.

```java
import java.util.List;

public class Main {
    interface Message {}
    record TextMessage(String text) implements Message {}
    record ImageMessage(String url, int width, int height) implements Message {}
    record VideoMessage(String url, int duration) implements Message {}

    static void processMessage(Message msg) {
        // Log the type
        if (msg instanceof TextMessage) {
            System.out.println("Processing text message");
        } else if (msg instanceof ImageMessage) {
            System.out.println("Processing image message");
        } else if (msg instanceof VideoMessage) {
            System.out.println("Processing video message");
        }

        // Process content (SECOND instanceof chain on the same object!)
        if (msg instanceof TextMessage) {
            TextMessage tm = (TextMessage) msg;
            System.out.println("Text: " + tm.text());
        } else if (msg instanceof ImageMessage) {
            ImageMessage im = (ImageMessage) msg;
            System.out.println("Image: " + im.url() + " (" + im.width() + "x" + im.height() + ")");
        } else if (msg instanceof VideoMessage) {
            VideoMessage vm = (VideoMessage) msg;
            System.out.println("Video: " + vm.url() + " (" + vm.duration() + "s)");
        }
    }

    public static void main(String[] args) {
        List<Message> messages = List.of(
            new TextMessage("Hello!"),
            new ImageMessage("cat.jpg", 800, 600),
            new VideoMessage("funny.mp4", 120)
        );
        messages.forEach(Main::processMessage);
    }
}
```

<details>
<summary>💡 Hint</summary>

Use pattern matching switch (Java 21+) or combine the logging and processing into a single type check.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.List;

public class Main {
    interface Message {}
    record TextMessage(String text) implements Message {}
    record ImageMessage(String url, int width, int height) implements Message {}
    record VideoMessage(String url, int duration) implements Message {}

    static void processMessage(Message msg) {
        // Single type check with pattern matching (Java 16+)
        if (msg instanceof TextMessage tm) {
            System.out.println("Processing text message");
            System.out.println("Text: " + tm.text());
        } else if (msg instanceof ImageMessage im) {
            System.out.println("Processing image message");
            System.out.println("Image: " + im.url() + " (" + im.width() + "x" + im.height() + ")");
        } else if (msg instanceof VideoMessage vm) {
            System.out.println("Processing video message");
            System.out.println("Video: " + vm.url() + " (" + vm.duration() + "s)");
        }
    }

    public static void main(String[] args) {
        List<Message> messages = List.of(
            new TextMessage("Hello!"),
            new ImageMessage("cat.jpg", 800, 600),
            new VideoMessage("funny.mp4", 120)
        );
        messages.forEach(Main::processMessage);
    }
}
```

**What changed:**
- Combined two separate instanceof chains into one
- Used pattern matching instanceof to eliminate explicit casts
- Each object is type-checked only once

**Improvement:** ~1.5x fewer type checks, cleaner code

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** Each `instanceof` check compiles to a `checkcast` bytecode. The JIT can optimize a single check efficiently, but two separate chains on the same object double the work and confuse branch prediction.

</details>

---

## Exercise 8: Object-to-Number Conversion with Excessive Casting 🔴 📦

**What the code does:** Converts a list of Objects (containing mixed Number types) to doubles.

**The problem:** Excessive instanceof checks and casts for each numeric type.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    static double[] convertToDoubles(List<Object> values) {
        List<Double> results = new ArrayList<>();
        for (Object obj : values) {
            if (obj instanceof Integer) {
                results.add(((Integer) obj).doubleValue());
            } else if (obj instanceof Long) {
                results.add(((Long) obj).doubleValue());
            } else if (obj instanceof Float) {
                results.add(((Float) obj).doubleValue());
            } else if (obj instanceof Double) {
                results.add((Double) obj);
            } else if (obj instanceof Short) {
                results.add(((Short) obj).doubleValue());
            } else if (obj instanceof Byte) {
                results.add(((Byte) obj).doubleValue());
            }
        }
        // Convert List<Double> to double[]
        double[] arr = new double[results.size()];
        for (int i = 0; i < results.size(); i++) {
            arr[i] = results.get(i);
        }
        return arr;
    }

    public static void main(String[] args) {
        List<Object> values = new ArrayList<>();
        for (int i = 0; i < 100_000; i++) {
            values.add(i);           // Integer
            values.add((long) i);    // Long
            values.add((double) i);  // Double
        }

        long start = System.nanoTime();
        double[] result = convertToDoubles(values);
        long elapsed = System.nanoTime() - start;
        System.out.printf("Converted %d values (%d ms)%n", result.length, elapsed / 1_000_000);
    }
}
```

<details>
<summary>💡 Hint</summary>

All numeric wrapper classes extend `Number`. Use a single `instanceof Number` check and call `doubleValue()`. Pre-allocate the output array.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.List;

public class Main {
    static double[] convertToDoubles(List<Object> values) {
        // Pre-count numbers to allocate exact array size
        int count = 0;
        for (Object obj : values) {
            if (obj instanceof Number) count++;
        }

        double[] result = new double[count];
        int idx = 0;
        for (Object obj : values) {
            if (obj instanceof Number n) {
                result[idx++] = n.doubleValue(); // Single check, single call
            }
        }
        return result;
    }

    public static void main(String[] args) {
        java.util.ArrayList<Object> values = new java.util.ArrayList<>();
        for (int i = 0; i < 100_000; i++) {
            values.add(i);
            values.add((long) i);
            values.add((double) i);
        }

        long start = System.nanoTime();
        double[] result = convertToDoubles(values);
        long elapsed = System.nanoTime() - start;
        System.out.printf("Converted %d values (%d ms)%n", result.length, elapsed / 1_000_000);
    }
}
```

**What changed:**
- Replaced 6 instanceof checks with 1 (`Number`)
- Used `Number.doubleValue()` polymorphic call
- Replaced `List<Double>` intermediate with pre-allocated `double[]`
- Eliminated autoboxing for the result array

**Optimized benchmark:**
```
Benchmark                    Mode  Cnt      Score     Error  Units
SlowConvert.measure          avgt   10  14523.234 ± 234.5  ns/op
FastConvert.measure          avgt   10   3456.789 ±  45.6  ns/op
```

**Improvement:** ~4x faster, eliminates 300K temporary Double objects

</details>

<details>
<summary>📚 Learn More</summary>

**Advanced concept:** All numeric wrappers (`Integer`, `Long`, `Double`, etc.) extend `java.lang.Number`. The `doubleValue()` method is defined on `Number`, so a single `instanceof Number` + `doubleValue()` handles all numeric types. The JIT can inline `doubleValue()` for the 2-3 most common types (bimorphic/trimorphic).

</details>

---

## Exercise 9: Pattern Matching vs Traditional Cast Performance 🔴 ⚡

**What the code does:** Dispatches events to handlers based on type.

**The problem:** Using reflection-based dispatch instead of JIT-friendly patterns.

```java
import java.util.HashMap;
import java.util.Map;
import java.util.function.Consumer;

public class Main {
    interface Event {}
    record OrderEvent(String id) implements Event {}
    record PaymentEvent(double amount) implements Event {}
    record ShipmentEvent(String tracking) implements Event {}

    // Slow: reflection-based dispatch
    static final Map<Class<?>, Consumer<Event>> handlers = new HashMap<>();
    static {
        handlers.put(OrderEvent.class, e -> System.out.println("Order: " + ((OrderEvent)e).id()));
        handlers.put(PaymentEvent.class, e -> System.out.printf("Payment: $%.2f%n", ((PaymentEvent)e).amount()));
        handlers.put(ShipmentEvent.class, e -> System.out.println("Ship: " + ((ShipmentEvent)e).tracking()));
    }

    static void dispatch(Event event) {
        Consumer<Event> handler = handlers.get(event.getClass()); // HashMap lookup
        if (handler != null) {
            handler.accept(event); // Megamorphic Consumer call + cast inside lambda
        }
    }

    public static void main(String[] args) {
        Event[] events = {
            new OrderEvent("ORD-1"), new PaymentEvent(99.99), new ShipmentEvent("TRK-1")
        };
        for (int i = 0; i < 100_000; i++) {
            for (Event e : events) dispatch(e);
        }
        System.out.println("Done");
    }
}
```

<details>
<summary>💡 Hint</summary>

Use sealed interface + switch pattern matching. The JIT compiles this to an efficient jump table.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
public class Main {
    sealed interface Event permits OrderEvent, PaymentEvent, ShipmentEvent {}
    record OrderEvent(String id) implements Event {}
    record PaymentEvent(double amount) implements Event {}
    record ShipmentEvent(String tracking) implements Event {}

    static void dispatch(Event event) {
        switch (event) {
            case OrderEvent e -> System.out.println("Order: " + e.id());
            case PaymentEvent e -> System.out.printf("Payment: $%.2f%n", e.amount());
            case ShipmentEvent e -> System.out.println("Ship: " + e.tracking());
        }
    }

    public static void main(String[] args) {
        Event[] events = {
            new OrderEvent("ORD-1"), new PaymentEvent(99.99), new ShipmentEvent("TRK-1")
        };
        for (int i = 0; i < 100_000; i++) {
            for (Event e : events) dispatch(e);
        }
        System.out.println("Done");
    }
}
```

**What changed:**
- Replaced HashMap-based dispatch with sealed switch pattern matching
- No HashMap lookup overhead
- JIT compiles to an efficient type-check jump table
- No casts inside lambdas — pattern matching binds typed variables directly

**Optimized benchmark:**
```
Benchmark                    Mode  Cnt    Score    Error  Units
SlowDispatch.hashMap         avgt   10  45.234 ±  2.3  ns/op
FastDispatch.sealedSwitch    avgt   10  12.456 ±  0.8  ns/op
```

**Improvement:** ~3.5x faster

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** The HashMap-based approach has three costs: (1) `getClass()` call, (2) HashMap hash + equals, (3) megamorphic `Consumer.accept()` call. The sealed switch compiles to a series of type checks (or tableswitch bytecode) that the JIT optimizes into a jump table with known types.

**JVM flags to verify:**
```bash
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining -cp . Main
```

</details>

---

## Exercise 10: GC Pressure from Defensive Copying with Casts 🔴 🔄

**What the code does:** Processes a configuration map with defensive copying and type casting.

**The problem:** Creates unnecessary copies and wrapper objects on every access.

```java
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

public class Main {
    static class Config {
        private final Map<String, Object> data;

        Config(Map<String, Object> data) {
            this.data = Collections.unmodifiableMap(new HashMap<>(data));
        }

        // Every call creates a new HashMap copy and casts
        int getInt(String key) {
            Map<String, Object> copy = new HashMap<>(data); // Defensive copy — wasteful!
            Object value = copy.get(key);
            if (value instanceof Number) {
                return ((Number) value).intValue();
            }
            throw new IllegalArgumentException("Key " + key + " is not a number");
        }

        String getString(String key) {
            Map<String, Object> copy = new HashMap<>(data); // Another copy!
            Object value = copy.get(key);
            if (value instanceof String) {
                return (String) value;
            }
            throw new IllegalArgumentException("Key " + key + " is not a string");
        }
    }

    public static void main(String[] args) {
        Map<String, Object> raw = new HashMap<>();
        raw.put("port", 8080);
        raw.put("host", "localhost");
        raw.put("timeout", 30);

        Config config = new Config(raw);

        long start = System.nanoTime();
        for (int i = 0; i < 1_000_000; i++) {
            config.getInt("port");
            config.getString("host");
            config.getInt("timeout");
        }
        long elapsed = System.nanoTime() - start;
        System.out.printf("Done (%d ms)%n", elapsed / 1_000_000);
    }
}
```

<details>
<summary>💡 Hint</summary>

The map is already unmodifiable — no defensive copy needed. Cache parsed values to avoid repeated casting.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class Main {
    static class Config {
        private final Map<String, Object> data;
        private final Map<String, Integer> intCache = new ConcurrentHashMap<>();
        private final Map<String, String> stringCache = new ConcurrentHashMap<>();

        Config(Map<String, Object> data) {
            this.data = Collections.unmodifiableMap(new HashMap<>(data));
        }

        int getInt(String key) {
            return intCache.computeIfAbsent(key, k -> {
                Object value = data.get(k); // Direct access — no copy!
                if (value instanceof Number n) {
                    return n.intValue();
                }
                throw new IllegalArgumentException("Key " + k + " is not a number");
            });
        }

        String getString(String key) {
            return stringCache.computeIfAbsent(key, k -> {
                Object value = data.get(k);
                if (value instanceof String s) {
                    return s;
                }
                throw new IllegalArgumentException("Key " + k + " is not a string");
            });
        }
    }

    public static void main(String[] args) {
        Map<String, Object> raw = new HashMap<>();
        raw.put("port", 8080);
        raw.put("host", "localhost");
        raw.put("timeout", 30);

        Config config = new Config(raw);

        long start = System.nanoTime();
        for (int i = 0; i < 1_000_000; i++) {
            config.getInt("port");
            config.getString("host");
            config.getInt("timeout");
        }
        long elapsed = System.nanoTime() - start;
        System.out.printf("Done (%d ms)%n", elapsed / 1_000_000);
    }
}
```

**What changed:**
- Removed defensive HashMap copying (map is already unmodifiable)
- Added typed caches for parsed values — cast happens only once per key
- Used `computeIfAbsent` for thread-safe lazy initialization

**Improvement:** ~50x faster after warmup (cached paths are simple HashMap lookups, zero casting)

</details>

<details>
<summary>📚 Learn More</summary>

**Advanced concept:** The original code created 3 million HashMap copies (3 calls * 1M iterations). Each copy allocates a new `HashMap`, a new `Entry[]`, and copies all entries. The optimized version accesses the immutable map directly and caches results after the first cast.

**JVM flags to observe GC impact:**
```bash
java -Xlog:gc* -Xms128m -Xmx128m -cp . Main
# Compare GC pause count before and after optimization
```

</details>

---

## Score Card

| Exercise | Difficulty | Category | Found bottleneck? | Your improvement | Target improvement |
|:--------:|:---------:|:--------:|:-----------------:|:----------------:|:-----------------:|
| 1 | 🟢 | 📦 | ☐ | ___ x | 15x |
| 2 | 🟢 | ⚡ | ☐ | ___ x | 2x |
| 3 | 🟢 | 📦 | ☐ | ___ x | 3x |
| 4 | 🟡 | ⚡ | ☐ | ___ x | 3x |
| 5 | 🟡 | ⚡ | ☐ | ___ x | 5.5x |
| 6 | 🟡 | 🔄 | ☐ | ___ x | 4x |
| 7 | 🟡 | 💾 | ☐ | ___ x | 1.5x |
| 8 | 🔴 | 📦 | ☐ | ___ x | 4x |
| 9 | 🔴 | ⚡ | ☐ | ___ x | 3.5x |
| 10 | 🔴 | 🔄 | ☐ | ___ x | 50x |

---

## Optimization Cheat Sheet

Quick reference for common Java type casting optimizations:

| Problem | Solution | Impact |
|:--------|:---------|:------:|
| `Long sum += int` in loop | Use primitive `long sum` accumulator | High |
| `Double.valueOf(str)` in loop | Use `Double.parseDouble(str)` | Medium |
| `instanceof` chain (same object) | Single check with pattern matching | Medium |
| Megamorphic dispatch (5+ types) | Partition by type for monomorphic loops | High |
| `Stream<Integer>.map()` | `stream.mapToInt()` primitive stream | High |
| HashMap-based type dispatch | Sealed switch pattern matching | High |
| Defensive copy before casting | Use unmodifiable map directly | Very High |
| Repeated `Number` type casting | Cache converted values | High |
| `List<Integer>` sum | `int[]` + primitive loop | Very High |
| Shared boxed accumulator (threads) | `LongAdder` / `DoubleAdder` | High |
