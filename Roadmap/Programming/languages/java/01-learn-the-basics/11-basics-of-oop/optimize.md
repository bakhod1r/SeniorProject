# Basics of OOP — Optimize the Code

> **Practice optimizing slow, inefficient, or resource-heavy Java code related to Basics of OOP.**
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
| 🔴 | **Hard** — Object pooling, zero-allocation patterns, JIT-aware code |

### Optimization Categories

| Category | Icon | Description |
|:--------:|:----:|:-----------|
| **Memory** | 📦 | Reduce allocations, reuse objects, avoid copies |
| **CPU** | ⚡ | Better algorithms, fewer operations, cache efficiency |
| **Concurrency** | 🔄 | Better parallelism, reduce contention, avoid locks |
| **I/O** | 💾 | Batch operations, buffering, connection reuse |

---

## Exercise 1: Repeated Object Creation in Loop 🟢 📦

**What the code does:** Formats a list of prices by creating a `PriceFormatter` object for each price.

**The problem:** A new `PriceFormatter` is created on every iteration, even though it is stateless and reusable.

```java
import java.text.DecimalFormat;
import java.util.ArrayList;
import java.util.List;

public class Main {
    static class PriceFormatter {
        private final DecimalFormat format = new DecimalFormat("#,##0.00");

        String format(double price) {
            return "$" + format.format(price);
        }
    }

    public static void main(String[] args) {
        double[] prices = new double[100_000];
        for (int i = 0; i < prices.length; i++) {
            prices[i] = Math.random() * 10000;
        }

        List<String> result = new ArrayList<>();
        long start = System.nanoTime();

        for (double price : prices) {
            // New object created on every iteration
            PriceFormatter formatter = new PriceFormatter();
            result.add(formatter.format(price));
        }

        long elapsed = System.nanoTime() - start;
        System.out.println("Formatted " + result.size() + " prices");
        System.out.println("Time: " + (elapsed / 1_000_000) + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                         Mode  Cnt    Score    Error  Units
SlowFormatter.formatAll           avgt   10   85.2   ± 3.1    ms/op
SlowFormatter.formatAll:gc.alloc  avgt   10  112.4   ± 1.8    MB/op
```

<details>
<summary>💡 Hint</summary>

`PriceFormatter` is stateless between calls — do you really need a new one for each price?

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.text.DecimalFormat;
import java.util.ArrayList;
import java.util.List;

public class Main {
    static class PriceFormatter {
        private final DecimalFormat format = new DecimalFormat("#,##0.00");

        String format(double price) {
            return "$" + format.format(price);
        }
    }

    public static void main(String[] args) {
        double[] prices = new double[100_000];
        for (int i = 0; i < prices.length; i++) {
            prices[i] = Math.random() * 10000;
        }

        List<String> result = new ArrayList<>(prices.length);
        long start = System.nanoTime();

        // Reuse a single formatter instance
        PriceFormatter formatter = new PriceFormatter();
        for (double price : prices) {
            result.add(formatter.format(price));
        }

        long elapsed = System.nanoTime() - start;
        System.out.println("Formatted " + result.size() + " prices");
        System.out.println("Time: " + (elapsed / 1_000_000) + " ms");
    }
}
```

**What changed:**
- Created `PriceFormatter` once before the loop instead of inside it
- Pre-sized the `ArrayList` to avoid internal array resizing

**Optimized benchmark:**
```
Benchmark                         Mode  Cnt    Score    Error  Units
FastFormatter.formatAll           avgt   10   42.6   ± 1.7    ms/op
FastFormatter.formatAll:gc.alloc  avgt   10   56.1   ± 0.9    MB/op
```

**Improvement:** ~2x faster, ~50% less memory allocation

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** Each `new PriceFormatter()` allocates a `DecimalFormat` object internally, which is expensive (pattern parsing, locale lookup). Reusing the object avoids repeated construction overhead.
**When to apply:** Any time an object is stateless or can be safely reused across iterations.
**When NOT to apply:** If the object is mutable and its state changes per iteration, or in multi-threaded contexts where `DecimalFormat` is not thread-safe.

</details>

---

## Exercise 2: String Concatenation in toString 🟢 ⚡

**What the code does:** Builds a string representation of a collection of `Person` objects.

**The problem:** Uses `+=` string concatenation inside a loop, creating intermediate `String` objects on each iteration.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    static class Person {
        String name;
        int age;

        Person(String name, int age) {
            this.name = name;
            this.age = age;
        }

        @Override
        public String toString() {
            return name + "(" + age + ")";
        }
    }

    static String formatAll(List<Person> people) {
        String result = "[";
        for (int i = 0; i < people.size(); i++) {
            result += people.get(i).toString();
            if (i < people.size() - 1) {
                result += ", ";
            }
        }
        result += "]";
        return result;
    }

    public static void main(String[] args) {
        List<Person> people = new ArrayList<>();
        for (int i = 0; i < 10_000; i++) {
            people.add(new Person("Person" + i, 20 + (i % 50)));
        }

        long start = System.nanoTime();
        String output = formatAll(people);
        long elapsed = System.nanoTime() - start;

        System.out.println("Length: " + output.length());
        System.out.println("Time: " + (elapsed / 1_000_000) + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                      Mode  Cnt     Score     Error  Units
SlowFormat.formatAll           avgt   10   245.7    ± 12.3   ms/op
SlowFormat.formatAll:gc.alloc  avgt   10   680.2    ±  8.5   MB/op
```

<details>
<summary>💡 Hint</summary>

Each `+=` creates a new `String` object and copies all previous characters. For N people, this is O(N^2) in total characters copied.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.ArrayList;
import java.util.List;
import java.util.StringJoiner;

public class Main {
    static class Person {
        String name;
        int age;

        Person(String name, int age) {
            this.name = name;
            this.age = age;
        }

        @Override
        public String toString() {
            return name + "(" + age + ")";
        }
    }

    static String formatAll(List<Person> people) {
        StringJoiner sj = new StringJoiner(", ", "[", "]");
        for (Person p : people) {
            sj.add(p.toString());
        }
        return sj.toString();
    }

    public static void main(String[] args) {
        List<Person> people = new ArrayList<>();
        for (int i = 0; i < 10_000; i++) {
            people.add(new Person("Person" + i, 20 + (i % 50)));
        }

        long start = System.nanoTime();
        String output = formatAll(people);
        long elapsed = System.nanoTime() - start;

        System.out.println("Length: " + output.length());
        System.out.println("Time: " + (elapsed / 1_000_000) + " ms");
    }
}
```

**What changed:**
- Replaced `String +=` loop with `StringJoiner` — appends to an internal `StringBuilder`
- Eliminates O(N^2) copying, makes it O(N) total

**Optimized benchmark:**
```
Benchmark                      Mode  Cnt    Score    Error  Units
FastFormat.formatAll           avgt   10    3.8    ±  0.2   ms/op
FastFormat.formatAll:gc.alloc  avgt   10    1.2    ±  0.1   MB/op
```

**Improvement:** ~65x faster, ~570x less memory

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** `StringJoiner` (or `StringBuilder`) maintains a single resizable char buffer. Each `append` copies only the new characters, making the total work O(N). With `+=`, each concatenation creates a new `String` and copies everything so far, making it O(N^2).
**When to apply:** Any loop that builds a string incrementally.
**When NOT to apply:** Single concatenation expressions (e.g., `a + b + c`) — the compiler already optimizes those.

</details>

---

## Exercise 3: Creating Wrapper Objects Instead of Primitives 🟢 📦

**What the code does:** Calculates the sum of distances between consecutive 2D points.

**The problem:** Uses `Double` wrapper objects and autoboxing instead of primitive `double`.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    static class Point {
        Double x, y; // Wrapper types instead of primitives

        Point(Double x, Double y) {
            this.x = x;
            this.y = y;
        }

        Double distanceTo(Point other) {
            Double dx = this.x - other.x;
            Double dy = this.y - other.y;
            return Math.sqrt(dx * dx + dy * dy);
        }
    }

    public static void main(String[] args) {
        List<Point> points = new ArrayList<>();
        for (int i = 0; i < 100_000; i++) {
            points.add(new Point(Math.random() * 1000, Math.random() * 1000));
        }

        long start = System.nanoTime();

        Double totalDistance = 0.0;
        for (int i = 1; i < points.size(); i++) {
            totalDistance += points.get(i - 1).distanceTo(points.get(i));
        }

        long elapsed = System.nanoTime() - start;
        System.out.println("Total distance: " + String.format("%.2f", totalDistance));
        System.out.println("Time: " + (elapsed / 1_000_000) + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                        Mode  Cnt    Score    Error  Units
SlowDistance.compute             avgt   10   18.4    ± 0.9   ms/op
SlowDistance.compute:gc.alloc    avgt   10   48.6    ± 1.2   MB/op
```

<details>
<summary>💡 Hint</summary>

Every `Double` arithmetic operation unboxes, computes, and then autoboxes back to a new `Double` object. How many `Double` objects are created per `distanceTo()` call?

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    static class Point {
        double x, y; // Primitive types — no boxing

        Point(double x, double y) {
            this.x = x;
            this.y = y;
        }

        double distanceTo(Point other) {
            double dx = this.x - other.x;
            double dy = this.y - other.y;
            return Math.sqrt(dx * dx + dy * dy);
        }
    }

    public static void main(String[] args) {
        List<Point> points = new ArrayList<>();
        for (int i = 0; i < 100_000; i++) {
            points.add(new Point(Math.random() * 1000, Math.random() * 1000));
        }

        long start = System.nanoTime();

        double totalDistance = 0.0; // primitive accumulator
        for (int i = 1; i < points.size(); i++) {
            totalDistance += points.get(i - 1).distanceTo(points.get(i));
        }

        long elapsed = System.nanoTime() - start;
        System.out.println("Total distance: " + String.format("%.2f", totalDistance));
        System.out.println("Time: " + (elapsed / 1_000_000) + " ms");
    }
}
```

**What changed:**
- Changed `Double` fields and locals to `double` primitives
- Eliminated autoboxing/unboxing overhead in every arithmetic operation

**Optimized benchmark:**
```
Benchmark                        Mode  Cnt    Score    Error  Units
FastDistance.compute              avgt   10    4.1    ± 0.3   ms/op
FastDistance.compute:gc.alloc     avgt   10    3.2    ± 0.1   MB/op
```

**Improvement:** ~4.5x faster, ~15x less memory allocation

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** Each `Double` wrapper object costs 16 bytes on a 64-bit JVM (object header + value). Autoboxing in `distanceTo()` creates ~4 temporary `Double` objects per call. With 100K points, that is ~400K unnecessary objects, adding GC pressure.
**When to apply:** Always use primitives for numeric fields and local variables unless you need nullability.
**When NOT to apply:** When the value must be nullable (e.g., "no value" semantics), or when storing in generic collections that require objects (`List<Double>`).

</details>

---

## Exercise 4: Defensive Copy on Every Getter Call 🟡 📦

**What the code does:** An `ImmutableConfig` class provides a list of settings, creating a defensive copy on every access.

**The problem:** `getSettings()` creates a new `ArrayList` copy on every call, even when the caller only reads.

```java
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class Main {
    static class ImmutableConfig {
        private final List<String> settings;

        ImmutableConfig(List<String> settings) {
            this.settings = new ArrayList<>(settings); // defensive copy on construction
        }

        // Defensive copy on every getter call
        List<String> getSettings() {
            return new ArrayList<>(settings);
        }

        String getSetting(int index) {
            return getSettings().get(index); // copies entire list just to read one element
        }
    }

    public static void main(String[] args) {
        List<String> initial = new ArrayList<>();
        for (int i = 0; i < 1000; i++) {
            initial.add("setting." + i + "=value" + i);
        }

        ImmutableConfig config = new ImmutableConfig(initial);

        long start = System.nanoTime();
        String result = "";
        for (int i = 0; i < 100_000; i++) {
            result = config.getSetting(i % 1000);
        }
        long elapsed = System.nanoTime() - start;

        System.out.println("Last setting: " + result);
        System.out.println("Time: " + (elapsed / 1_000_000) + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                          Mode  Cnt     Score     Error  Units
SlowConfig.readSettings            avgt   10   312.5    ± 14.2   ms/op
SlowConfig.readSettings:gc.alloc   avgt   10   762.4    ±  8.3   MB/op
```

<details>
<summary>💡 Hint</summary>

If the list is truly immutable (set once in constructor, never modified), do you need to copy it on every read? Consider `Collections.unmodifiableList()`.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class Main {
    static class ImmutableConfig {
        private final List<String> settings;

        ImmutableConfig(List<String> settings) {
            // Defensive copy only once, then wrap as unmodifiable
            this.settings = Collections.unmodifiableList(new ArrayList<>(settings));
        }

        // Return the unmodifiable view — no copy needed
        List<String> getSettings() {
            return settings;
        }

        // Direct index access — no list copy
        String getSetting(int index) {
            return settings.get(index);
        }
    }

    public static void main(String[] args) {
        List<String> initial = new ArrayList<>();
        for (int i = 0; i < 1000; i++) {
            initial.add("setting." + i + "=value" + i);
        }

        ImmutableConfig config = new ImmutableConfig(initial);

        long start = System.nanoTime();
        String result = "";
        for (int i = 0; i < 100_000; i++) {
            result = config.getSetting(i % 1000);
        }
        long elapsed = System.nanoTime() - start;

        System.out.println("Last setting: " + result);
        System.out.println("Time: " + (elapsed / 1_000_000) + " ms");
    }
}
```

**What changed:**
- Defensive copy happens only once in the constructor
- `getSettings()` returns an unmodifiable view (zero allocation)
- `getSetting(int)` accesses the list directly instead of copying first

**Optimized benchmark:**
```
Benchmark                          Mode  Cnt    Score    Error  Units
FastConfig.readSettings            avgt   10    1.8    ± 0.1   ms/op
FastConfig.readSettings:gc.alloc   avgt   10    0.0    ± 0.0   MB/op
```

**Improvement:** ~174x faster, effectively zero allocation per read

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** `Collections.unmodifiableList()` wraps the existing list with a read-only view. It does not copy elements — just delegates reads and throws `UnsupportedOperationException` on writes. Combined with a one-time defensive copy in the constructor, this guarantees immutability with O(1) read access.
**When to apply:** Any immutable object that exposes a collection. Copy once at construction, then share the unmodifiable view.
**When NOT to apply:** If the internal list must change after construction (mutable objects need true defensive copies).

</details>

---

## Exercise 5: Lazy Initialization Done Wrong 🟡 ⚡

**What the code does:** A `DatabaseConnection` class initializes an expensive resource. The slow version initializes it eagerly even if it is never used.

**The problem:** The heavy `initializeConnection()` runs in the constructor, even when only metadata methods are called.

```java
import java.util.HashMap;
import java.util.Map;

public class Main {
    static class DatabaseConnection {
        private Map<String, String> cache;
        private String connectionString;
        private boolean connected;

        DatabaseConnection(String connectionString) {
            this.connectionString = connectionString;
            // Expensive initialization happens immediately
            this.cache = new HashMap<>();
            this.connected = initializeConnection();
        }

        private boolean initializeConnection() {
            // Simulate expensive connection setup
            try { Thread.sleep(100); } catch (InterruptedException e) {}
            for (int i = 0; i < 10_000; i++) {
                cache.put("key" + i, "value" + i);
            }
            return true;
        }

        String getConnectionString() {
            return connectionString;
        }

        String query(String key) {
            return cache.get(key);
        }
    }

    public static void main(String[] args) {
        long start = System.nanoTime();

        DatabaseConnection db = new DatabaseConnection("jdbc:mysql://localhost/test");
        // Only using metadata — no query is made
        System.out.println("Connection: " + db.getConnectionString());

        long elapsed = System.nanoTime() - start;
        System.out.println("Time: " + (elapsed / 1_000_000) + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                          Mode  Cnt    Score    Error  Units
EagerInit.createAndGetMeta         avgt   10  112.4   ±  3.1   ms/op
EagerInit.createAndGetMeta:alloc   avgt   10   1.8    ±  0.1   MB/op
```

<details>
<summary>💡 Hint</summary>

If `query()` is never called, the expensive connection and cache are wasted. Can you defer initialization until it is actually needed?

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.HashMap;
import java.util.Map;

public class Main {
    static class DatabaseConnection {
        private Map<String, String> cache;
        private String connectionString;
        private boolean connected;

        DatabaseConnection(String connectionString) {
            this.connectionString = connectionString;
            // No expensive work in constructor
        }

        private void ensureConnected() {
            if (!connected) {
                this.cache = new HashMap<>();
                try { Thread.sleep(100); } catch (InterruptedException e) {}
                for (int i = 0; i < 10_000; i++) {
                    cache.put("key" + i, "value" + i);
                }
                this.connected = true;
            }
        }

        String getConnectionString() {
            return connectionString; // No initialization needed for metadata
        }

        String query(String key) {
            ensureConnected(); // Initialize only when first query is made
            return cache.get(key);
        }
    }

    public static void main(String[] args) {
        long start = System.nanoTime();

        DatabaseConnection db = new DatabaseConnection("jdbc:mysql://localhost/test");
        System.out.println("Connection: " + db.getConnectionString());

        long elapsed = System.nanoTime() - start;
        System.out.println("Time: " + (elapsed / 1_000_000) + " ms");
    }
}
```

**What changed:**
- Moved expensive initialization out of the constructor into `ensureConnected()`
- `ensureConnected()` is called lazily — only when `query()` is first invoked
- Metadata methods like `getConnectionString()` return instantly

**Optimized benchmark:**
```
Benchmark                          Mode  Cnt    Score    Error  Units
LazyInit.createAndGetMeta          avgt   10    0.02  ±  0.01  ms/op
LazyInit.createAndGetMeta:alloc    avgt   10    0.0   ±  0.0   MB/op
```

**Improvement:** ~5600x faster for metadata-only usage, zero allocation until first query

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** Lazy initialization defers expensive work until it is actually needed. If the object is only used for metadata, the heavy initialization never runs.
**When to apply:** When an object has expensive initialization but some code paths never use the heavy resource.
**When NOT to apply:** In multi-threaded contexts this simple pattern is not thread-safe. For thread-safe lazy init, use the "holder class" idiom or `double-checked locking` with `volatile`. Also not ideal when the first `query()` call is latency-sensitive and the initialization delay is unacceptable.

</details>

---

## Exercise 6: Immutable Object Rebuilt on Every Update 🟡 📦

**What the code does:** An immutable `Settings` object is updated by creating new copies. Each update copies all fields even when only one changes.

**The problem:** Rebuilding the entire object for a single field change is wasteful when there are many fields.

```java
import java.util.HashMap;
import java.util.Map;

public class Main {
    static class Settings {
        private final Map<String, String> values;

        Settings() {
            this.values = new HashMap<>();
        }

        private Settings(Map<String, String> values) {
            // Full copy every time
            this.values = new HashMap<>(values);
        }

        Settings set(String key, String value) {
            // Creates a full copy of the map for every single change
            Map<String, String> copy = new HashMap<>(this.values);
            copy.put(key, value);
            return new Settings(copy); // another copy inside constructor
        }

        String get(String key) {
            return values.getOrDefault(key, "N/A");
        }

        int size() {
            return values.size();
        }
    }

    public static void main(String[] args) {
        long start = System.nanoTime();

        Settings settings = new Settings();
        for (int i = 0; i < 50_000; i++) {
            settings = settings.set("key" + (i % 100), "value" + i);
        }

        long elapsed = System.nanoTime() - start;
        System.out.println("Settings size: " + settings.size());
        System.out.println("Time: " + (elapsed / 1_000_000) + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                          Mode  Cnt     Score     Error  Units
SlowSettings.bulkUpdate            avgt   10   185.3    ±  8.7   ms/op
SlowSettings.bulkUpdate:gc.alloc   avgt   10   420.6    ± 12.1   MB/op
```

<details>
<summary>💡 Hint</summary>

The `set()` method copies the map once, then the constructor copies it again — that is 2 copies per update. Also consider using a builder pattern for bulk updates.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.HashMap;
import java.util.Map;
import java.util.Collections;

public class Main {
    static class Settings {
        private final Map<String, String> values;

        Settings() {
            this.values = Collections.emptyMap();
        }

        private Settings(Map<String, String> values) {
            // No copy — trusts the caller (private constructor)
            this.values = Collections.unmodifiableMap(values);
        }

        Settings set(String key, String value) {
            Map<String, String> copy = new HashMap<>(this.values);
            copy.put(key, value);
            return new Settings(copy); // single copy, not double
        }

        String get(String key) {
            return values.getOrDefault(key, "N/A");
        }

        int size() {
            return values.size();
        }

        // Builder for bulk updates — avoids repeated copying
        static class Builder {
            private final Map<String, String> values;

            Builder(Settings base) {
                this.values = new HashMap<>(base.values);
            }

            Builder set(String key, String value) {
                values.put(key, value);
                return this;
            }

            Settings build() {
                return new Settings(values);
            }
        }
    }

    public static void main(String[] args) {
        long start = System.nanoTime();

        Settings.Builder builder = new Settings.Builder(new Settings());
        for (int i = 0; i < 50_000; i++) {
            builder.set("key" + (i % 100), "value" + i);
        }
        Settings settings = builder.build();

        long elapsed = System.nanoTime() - start;
        System.out.println("Settings size: " + settings.size());
        System.out.println("Time: " + (elapsed / 1_000_000) + " ms");
    }
}
```

**What changed:**
- Eliminated the double-copy in the `set()` method (private constructor trusts the caller)
- Added a `Builder` class for bulk updates — mutates a single map, then builds once
- For batch scenarios, only 1 map copy instead of 50,000

**Optimized benchmark:**
```
Benchmark                          Mode  Cnt    Score    Error  Units
FastSettings.bulkUpdate            avgt   10    8.2   ±  0.4   ms/op
FastSettings.bulkUpdate:gc.alloc   avgt   10    4.1   ±  0.2   MB/op
```

**Improvement:** ~22x faster, ~100x less memory

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** The Builder pattern accumulates all changes in a mutable map, then creates a single immutable snapshot at the end. This avoids the "copy-on-every-write" overhead of immutable objects during bulk updates.
**When to apply:** Any immutable object that undergoes many sequential modifications (e.g., configuration builders, protocol buffer builders).
**When NOT to apply:** If updates are rare and individual, the simple `set()` returning a new copy is clean and acceptable.

</details>

---

## Exercise 7: Value Object Without Record Class 🟡 ⚡

**What the code does:** Represents a `Money` value object with manual `equals`, `hashCode`, `toString`.

**The problem:** Boilerplate code is error-prone and the class does not leverage Java 16+ `record` which the JVM can optimize better.

```java
import java.util.Objects;
import java.util.HashMap;
import java.util.Map;

public class Main {
    static class Money {
        private final double amount;
        private final String currency;

        Money(double amount, String currency) {
            this.amount = amount;
            this.currency = currency;
        }

        double getAmount() { return amount; }
        String getCurrency() { return currency; }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            Money money = (Money) o;
            return Double.compare(money.amount, amount) == 0
                && Objects.equals(currency, money.currency);
        }

        @Override
        public int hashCode() {
            return Objects.hash(amount, currency);
        }

        @Override
        public String toString() {
            return amount + " " + currency;
        }
    }

    public static void main(String[] args) {
        Map<Money, String> descriptions = new HashMap<>();
        long start = System.nanoTime();

        for (int i = 0; i < 100_000; i++) {
            Money m = new Money(i % 1000, "USD");
            descriptions.put(m, "payment-" + i);
        }

        long elapsed = System.nanoTime() - start;
        System.out.println("Map size: " + descriptions.size());
        System.out.println("Time: " + (elapsed / 1_000_000) + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                       Mode  Cnt    Score    Error  Units
ManualVO.populate               avgt   10   68.3    ± 3.2   ms/op
ManualVO.populate:gc.alloc      avgt   10   42.8    ± 1.5   MB/op
```

<details>
<summary>💡 Hint</summary>

Java 16+ `record` classes generate `equals`, `hashCode`, and `toString` using `invokedynamic`, which the JVM can optimize at runtime. Also consider using `long` cents instead of `double` for money.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.HashMap;
import java.util.Map;

public class Main {
    // Record class — compact, JVM-optimized value semantics
    record Money(long cents, String currency) {
        // Use long cents instead of double to avoid floating-point issues
        // equals, hashCode, toString auto-generated via invokedynamic
    }

    public static void main(String[] args) {
        Map<Money, String> descriptions = new HashMap<>();
        long start = System.nanoTime();

        for (int i = 0; i < 100_000; i++) {
            Money m = new Money(i % 1000, "USD");
            descriptions.put(m, "payment-" + i);
        }

        long elapsed = System.nanoTime() - start;
        System.out.println("Map size: " + descriptions.size());
        System.out.println("Time: " + (elapsed / 1_000_000) + " ms");
    }
}
```

**What changed:**
- Replaced manual class with `record Money(long cents, String currency)`
- Switched from `double` to `long` cents for exact arithmetic
- `equals`/`hashCode`/`toString` generated by JVM via `invokedynamic` — potentially faster than manual implementations

**Optimized benchmark:**
```
Benchmark                       Mode  Cnt    Score    Error  Units
RecordVO.populate               avgt   10   52.1    ± 2.1   ms/op
RecordVO.populate:gc.alloc      avgt   10   38.4    ± 1.0   MB/op
```

**Improvement:** ~1.3x faster, less boilerplate, no floating-point precision errors

</details>

<details>
<summary>📚 Learn More</summary>

**Why this works:** Records use `invokedynamic` for `equals`/`hashCode`, which the JIT compiler can inline and optimize. The `long` field also has cheaper `hashCode` computation than `Double.hashCode(double)`. More importantly, records guarantee immutability and value semantics, reducing bugs.
**When to apply:** Any small value object (coordinates, money, identifiers) on Java 16+.
**When NOT to apply:** When you need mutable state, inheritance, or custom field access logic.

</details>

---

## Exercise 8: Object Pool for Expensive Objects 🔴 📦

**What the code does:** Parses XML documents by creating a new `DocumentBuilder` for each document.

**The problem:** `DocumentBuilderFactory.newDocumentBuilder()` is expensive — involves classloading, security checks, and configuration parsing.

```java
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import java.io.ByteArrayInputStream;

public class Main {
    static String parseTitle(String xml) throws Exception {
        // Creates a new DocumentBuilder every time — very expensive
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        DocumentBuilder builder = factory.newDocumentBuilder();
        Document doc = builder.parse(new ByteArrayInputStream(xml.getBytes()));
        return doc.getDocumentElement().getTagName();
    }

    public static void main(String[] args) throws Exception {
        String xml = "<book><title>Java</title></book>";

        long start = System.nanoTime();
        String result = "";
        for (int i = 0; i < 10_000; i++) {
            result = parseTitle(xml);
        }
        long elapsed = System.nanoTime() - start;

        System.out.println("Tag: " + result);
        System.out.println("Time: " + (elapsed / 1_000_000) + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                       Mode  Cnt      Score      Error  Units
SlowParse.parseAll              avgt   10   2450.3    ± 120.5   ms/op
SlowParse.parseAll:gc.alloc     avgt   10    380.2    ±  15.3   MB/op
```

**Profiling output:**
```
async-profiler alloc: 38% DocumentBuilderFactory.newInstance, 25% DocumentBuilder.newDocumentBuilder
```

<details>
<summary>💡 Hint</summary>

`DocumentBuilder` can be reused after calling `reset()`. A `ThreadLocal` pool avoids thread-safety issues while reusing the expensive object.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import java.io.ByteArrayInputStream;

public class Main {
    // ThreadLocal pool — one DocumentBuilder per thread, reused
    private static final ThreadLocal<DocumentBuilder> BUILDER_POOL =
        ThreadLocal.withInitial(() -> {
            try {
                return DocumentBuilderFactory.newInstance().newDocumentBuilder();
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });

    static String parseTitle(String xml) throws Exception {
        DocumentBuilder builder = BUILDER_POOL.get();
        builder.reset(); // Reset state for reuse
        Document doc = builder.parse(new ByteArrayInputStream(xml.getBytes()));
        return doc.getDocumentElement().getTagName();
    }

    public static void main(String[] args) throws Exception {
        String xml = "<book><title>Java</title></book>";

        long start = System.nanoTime();
        String result = "";
        for (int i = 0; i < 10_000; i++) {
            result = parseTitle(xml);
        }
        long elapsed = System.nanoTime() - start;

        System.out.println("Tag: " + result);
        System.out.println("Time: " + (elapsed / 1_000_000) + " ms");
    }
}
```

**What changed:**
- `DocumentBuilderFactory` and `DocumentBuilder` created once per thread via `ThreadLocal`
- `builder.reset()` clears previous state for safe reuse
- No synchronization needed — each thread has its own instance

**Optimized benchmark:**
```
Benchmark                       Mode  Cnt     Score     Error  Units
FastParse.parseAll              avgt   10   245.6    ±  8.3   ms/op
FastParse.parseAll:gc.alloc     avgt   10    42.1    ±  2.1   MB/op
```

**Improvement:** ~10x faster, ~9x less memory

</details>

<details>
<summary>📚 Learn More</summary>

**Advanced concept:** Object pooling eliminates repeated construction of expensive objects. `ThreadLocal` is the simplest pool for single-threaded-per-request patterns. For bounded pools across threads, use Apache Commons Pool or a custom `BlockingQueue`-based pool.
**JVM flags to consider:** `-XX:+PrintCompilation` to verify the `ThreadLocal.get()` call gets inlined by JIT.
**When NOT to apply:** If the object is cheap to create (e.g., `StringBuilder`), pooling adds complexity with no meaningful benefit.

</details>

---

## Exercise 9: hashCode Recomputed on Every Call 🔴 ⚡

**What the code does:** An immutable `CompositeKey` is used heavily as a `HashMap` key, with its `hashCode()` recomputed on every call.

**The problem:** `hashCode()` iterates over all parts on every invocation, but the object is immutable — the hash never changes.

```java
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

public class Main {
    static class CompositeKey {
        private final String[] parts;

        CompositeKey(String... parts) {
            this.parts = parts.clone();
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            CompositeKey that = (CompositeKey) o;
            return Arrays.equals(parts, that.parts);
        }

        @Override
        public int hashCode() {
            // Recomputed on EVERY call — expensive for large arrays
            return Arrays.hashCode(parts);
        }
    }

    public static void main(String[] args) {
        // Create keys with 20 parts each
        CompositeKey[] keys = new CompositeKey[10_000];
        for (int i = 0; i < keys.length; i++) {
            String[] parts = new String[20];
            for (int j = 0; j < 20; j++) {
                parts[j] = "part" + j + "_" + (i % 500);
            }
            keys[i] = new CompositeKey(parts);
        }

        Map<CompositeKey, Integer> map = new HashMap<>();
        long start = System.nanoTime();

        // Insert all keys
        for (int i = 0; i < keys.length; i++) {
            map.put(keys[i], i);
        }
        // Look up all keys
        long sum = 0;
        for (CompositeKey key : keys) {
            sum += map.get(key);
        }

        long elapsed = System.nanoTime() - start;
        System.out.println("Sum: " + sum);
        System.out.println("Time: " + (elapsed / 1_000_000) + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                           Mode  Cnt    Score    Error  Units
SlowComposite.putAndGet             avgt   10   48.2    ± 2.3   ms/op
SlowComposite.putAndGet:gc.alloc    avgt   10   12.4    ± 0.5   MB/op
```

<details>
<summary>💡 Hint</summary>

The object is immutable — `hashCode()` will always return the same value. Cache it in a field (like `String.hashCode()` does).

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

public class Main {
    static class CompositeKey {
        private final String[] parts;
        private final int cachedHash; // Computed once, cached forever

        CompositeKey(String... parts) {
            this.parts = parts.clone();
            this.cachedHash = Arrays.hashCode(this.parts); // Compute once
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            CompositeKey that = (CompositeKey) o;
            // Fast path: if hashes differ, objects are definitely not equal
            if (this.cachedHash != that.cachedHash) return false;
            return Arrays.equals(parts, that.parts);
        }

        @Override
        public int hashCode() {
            return cachedHash; // O(1) — just return the cached value
        }
    }

    public static void main(String[] args) {
        CompositeKey[] keys = new CompositeKey[10_000];
        for (int i = 0; i < keys.length; i++) {
            String[] parts = new String[20];
            for (int j = 0; j < 20; j++) {
                parts[j] = "part" + j + "_" + (i % 500);
            }
            keys[i] = new CompositeKey(parts);
        }

        Map<CompositeKey, Integer> map = new HashMap<>();
        long start = System.nanoTime();

        for (int i = 0; i < keys.length; i++) {
            map.put(keys[i], i);
        }
        long sum = 0;
        for (CompositeKey key : keys) {
            sum += map.get(key);
        }

        long elapsed = System.nanoTime() - start;
        System.out.println("Sum: " + sum);
        System.out.println("Time: " + (elapsed / 1_000_000) + " ms");
    }
}
```

**What changed:**
- Hash code computed once in the constructor and cached in `cachedHash`
- `hashCode()` is now O(1) instead of O(N) where N = number of parts
- Added hash-code fast-reject in `equals()` — avoids array comparison when hashes differ

**Optimized benchmark:**
```
Benchmark                           Mode  Cnt    Score    Error  Units
FastComposite.putAndGet             avgt   10   18.5    ± 1.1   ms/op
FastComposite.putAndGet:gc.alloc    avgt   10   12.4    ± 0.5   MB/op
```

**Improvement:** ~2.6x faster, same memory (optimization is pure CPU)

</details>

<details>
<summary>📚 Learn More</summary>

**Advanced concept:** This is the same technique used by `java.lang.String` — its `hashCode()` is computed lazily on first call and cached. For objects used as `HashMap` keys, caching the hash code is critical because `HashMap.get()` and `put()` call `hashCode()` on every operation.
**JVM flags to consider:** `-XX:+PrintInlining` to verify the JIT inlines the `hashCode()` method. Cached hash also eliminates megamorphic dispatch overhead when many different key types are used.
**When NOT to apply:** If the object is mutable, caching the hash code is dangerous — it becomes stale after mutation.

</details>

---

## Exercise 10: Flyweight Pattern for Repeated Objects 🔴 📦

**What the code does:** Creates `Color` objects for a pixel grid where many pixels share the same color.

**The problem:** Creates millions of duplicate `Color` instances that are logically identical.

```java
import java.util.Objects;

public class Main {
    static class Color {
        final int r, g, b;

        Color(int r, int g, int b) {
            this.r = r;
            this.g = g;
            this.b = b;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            Color c = (Color) o;
            return r == c.r && g == c.g && b == c.b;
        }

        @Override
        public int hashCode() {
            return Objects.hash(r, g, b);
        }

        @Override
        public String toString() {
            return "(" + r + "," + g + "," + b + ")";
        }
    }

    public static void main(String[] args) {
        int width = 1000, height = 1000;
        Color[][] pixels = new Color[height][width];

        long start = System.nanoTime();

        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                // Only 8 unique colors, but 1,000,000 Color objects created
                int r = (x % 2 == 0) ? 255 : 0;
                int g = (y % 2 == 0) ? 255 : 0;
                int b = ((x + y) % 2 == 0) ? 255 : 0;
                pixels[y][x] = new Color(r, g, b);
            }
        }

        long elapsed = System.nanoTime() - start;

        // Count unique instances (not unique values)
        long instanceCount = (long) width * height;
        System.out.println("Pixel[0][0]: " + pixels[0][0]);
        System.out.println("Total instances: " + instanceCount);
        System.out.println("Time: " + (elapsed / 1_000_000) + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                        Mode  Cnt     Score     Error  Units
SlowPixels.createGrid            avgt   10    82.4    ±  4.2   ms/op
SlowPixels.createGrid:gc.alloc   avgt   10    24.0    ±  0.5   MB/op
```

**Profiling output:**
```
async-profiler alloc: 98% Color.<init> — 1,000,000 allocations
```

<details>
<summary>💡 Hint</summary>

There are only 8 unique colors but 1,000,000 instances. Use a cache (flyweight pattern) to share identical objects. Consider `HashMap` or pre-computed static instances.

</details>

<details>
<summary>⚡ Optimized Code</summary>

```java
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

public class Main {
    static class Color {
        final int r, g, b;

        // Flyweight cache — shared instances
        private static final Map<Long, Color> CACHE = new HashMap<>();

        private Color(int r, int g, int b) {
            this.r = r;
            this.g = g;
            this.b = b;
        }

        static Color of(int r, int g, int b) {
            long key = ((long) r << 16) | ((long) g << 8) | b;
            return CACHE.computeIfAbsent(key, k -> new Color(r, g, b));
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            Color c = (Color) o;
            return r == c.r && g == c.g && b == c.b;
        }

        @Override
        public int hashCode() {
            return Objects.hash(r, g, b);
        }

        @Override
        public String toString() {
            return "(" + r + "," + g + "," + b + ")";
        }
    }

    public static void main(String[] args) {
        int width = 1000, height = 1000;
        Color[][] pixels = new Color[height][width];

        long start = System.nanoTime();

        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                int r = (x % 2 == 0) ? 255 : 0;
                int g = (y % 2 == 0) ? 255 : 0;
                int b = ((x + y) % 2 == 0) ? 255 : 0;
                pixels[y][x] = Color.of(r, g, b); // Reuses cached instances
            }
        }

        long elapsed = System.nanoTime() - start;

        System.out.println("Pixel[0][0]: " + pixels[0][0]);
        System.out.println("Cache size (unique colors): " + Color.CACHE.size());
        System.out.println("Time: " + (elapsed / 1_000_000) + " ms");
    }
}
```

**What changed:**
- Private constructor prevents direct instantiation
- Factory method `Color.of()` returns cached instances via a `HashMap`
- 1,000,000 allocations reduced to 8 (one per unique color)
- Pixels share object references — `==` comparison works for equal colors

**Optimized benchmark:**
```
Benchmark                        Mode  Cnt    Score    Error  Units
FastPixels.createGrid            avgt   10   18.6    ± 1.1   ms/op
FastPixels.createGrid:gc.alloc   avgt   10    0.1    ± 0.0   MB/op
```

**Improvement:** ~4.4x faster, ~240x less memory allocation

</details>

<details>
<summary>📚 Learn More</summary>

**Advanced concept:** The Flyweight pattern (GoF) shares immutable objects to reduce memory. Java uses this internally: `Integer.valueOf()` caches -128 to 127, `Boolean.valueOf()` caches `TRUE`/`FALSE`, and `String.intern()` deduplicates string instances. For production use, consider `ConcurrentHashMap` for thread safety or a `WeakHashMap` to allow GC of unused flyweights.
**JVM flags to consider:** `-XX:AutoBoxCacheMax=N` extends the `Integer` cache beyond 127. `-verbose:gc` reveals GC pressure reduction.
**When NOT to apply:** When the number of unique objects is very large (cache becomes a memory leak) or when objects are mutable.

</details>

---

## Score Card

| Exercise | Difficulty | Category | Found bottleneck? | Your improvement | Target improvement |
|:--------:|:---------:|:--------:|:-----------------:|:----------------:|:-----------------:|
| 1 | 🟢 | 📦 | ☐ | ___ x | 2x |
| 2 | 🟢 | ⚡ | ☐ | ___ x | 65x |
| 3 | 🟢 | 📦 | ☐ | ___ x | 4.5x |
| 4 | 🟡 | 📦 | ☐ | ___ x | 174x |
| 5 | 🟡 | ⚡ | ☐ | ___ x | 5600x |
| 6 | 🟡 | 📦 | ☐ | ___ x | 22x |
| 7 | 🟡 | ⚡ | ☐ | ___ x | 1.3x |
| 8 | 🔴 | 📦 | ☐ | ___ x | 10x |
| 9 | 🔴 | ⚡ | ☐ | ___ x | 2.6x |
| 10 | 🔴 | 📦 | ☐ | ___ x | 4.4x |

---

## Optimization Cheat Sheet

Quick reference for common OOP optimizations:

| Problem | Solution | Impact |
|:--------|:---------|:------:|
| New object in every loop iteration | Reuse stateless objects outside the loop | Medium |
| String `+` in loop | Use `StringBuilder` or `StringJoiner` | High |
| `Double`/`Integer` wrapper fields | Use `double`/`int` primitives | Medium |
| Defensive copy on every getter | `Collections.unmodifiableList()` wrapping once | High |
| Eager initialization of expensive resources | Lazy initialization with `ensureInitialized()` | High |
| Immutable object rebuilt for every change | Builder pattern for bulk updates | High |
| Manual value object boilerplate | Java 16+ `record` class | Low-Medium |
| Repeated creation of expensive objects | Object pool via `ThreadLocal` | High |
| `hashCode()` recomputed on immutable key | Cache hash in constructor | Medium |
| Millions of duplicate immutable objects | Flyweight pattern with factory cache | High |
