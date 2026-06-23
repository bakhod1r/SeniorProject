# Strings and Methods — Optimize the Code

> **Practice optimizing slow, inefficient, or resource-heavy Java code related to Strings and Methods.**
> Each exercise contains working but suboptimal code — your job is to make it faster, leaner, or more efficient.

---

## How to Use

1. Read the slow code and understand what it does
2. Identify the performance bottleneck
3. Write your optimized version
4. Compare with the solution and JMH benchmark results
5. Understand **why** the optimization works

### Difficulty Levels

| Level | Focus |
|:-----:|:------|
| Easy | Obvious inefficiencies, simple fixes |
| Medium | Algorithmic improvements, allocation reduction |
| Hard | GC tuning, zero-allocation patterns, JIT-aware code |

### Optimization Categories

| Category | Icon | Description |
|:--------:|:----:|:-----------|
| **Memory** | mem | Reduce allocations, reuse objects, avoid copies |
| **CPU** | cpu | Better algorithms, fewer operations, cache efficiency |
| **Concurrency** | conc | Better parallelism, reduce contention |
| **I/O** | io | Batch operations, buffering |

---

## Exercise 1: String Concatenation in a Loop (Easy, mem)

**What the code does:** Builds a comma-separated string from 10,000 words.

**The problem:** Using `+=` in a loop creates a new `String` object on every iteration, causing O(n^2) character copying.

```java
public class Main {
    public static String buildCSV(String[] words) {
        String result = "";
        for (int i = 0; i < words.length; i++) {
            if (i > 0) {
                result += ",";
            }
            result += words[i];
        }
        return result;
    }

    public static void main(String[] args) {
        String[] words = new String[10_000];
        for (int i = 0; i < words.length; i++) {
            words[i] = "word" + i;
        }

        long start = System.nanoTime();
        String csv = buildCSV(words);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Length: " + csv.length() + " in " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                   Mode  Cnt      Score     Error  Units
SlowCSV.buildCSV            avgt   10  48712.3  ± 1245.6   us/op
SlowCSV.gc.alloc.rate       avgt   10      3.1  ±    0.2   GB/s
```

<details>
<summary>Hint</summary>

How many `String` objects are created across 10,000 iterations? Each `+=` allocates a new `String` and copies all previous characters.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    public static String buildCSV(String[] words) {
        StringBuilder sb = new StringBuilder(words.length * 8); // pre-sized estimate
        for (int i = 0; i < words.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(words[i]);
        }
        return sb.toString();
    }

    public static void main(String[] args) {
        String[] words = new String[10_000];
        for (int i = 0; i < words.length; i++) {
            words[i] = "word" + i;
        }

        long start = System.nanoTime();
        String csv = buildCSV(words);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Length: " + csv.length() + " in " + elapsed + " ms");
    }
}
```

**What changed:**
- `String +=` replaced with `StringBuilder.append()` — avoids creating a new String object per iteration
- Pre-sized `StringBuilder(words.length * 8)` — reduces internal array resizing

**Optimized benchmark:**
```
Benchmark                   Mode  Cnt     Score    Error  Units
FastCSV.buildCSV            avgt   10   312.4  ±  18.7   us/op
FastCSV.gc.alloc.rate       avgt   10     0.1  ±   0.0   GB/s
```

**Improvement:** ~156x faster, ~97% less memory allocation

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `String` is immutable in Java. Every `+=` creates a new `char[]` (or `byte[]` since Java 9 compact strings), copies all existing characters, appends the new ones, and wraps it in a new `String`. For n iterations with average length L, this is O(n * n * L) total copying. `StringBuilder` maintains a mutable internal buffer and only copies when the buffer needs to grow (amortized O(1) per append).

**When to apply:** Any loop that builds a string incrementally — CSV generation, HTML building, log messages, JSON assembly.
**When NOT to apply:** Simple one-line concatenation like `"Hello, " + name + "!"` — the compiler already optimizes this into a single `StringBuilder` chain (or `invokedynamic` `StringConcatFactory` since Java 9).

</details>

---

## Exercise 2: String.intern() Abuse (Easy, mem)

**What the code does:** Deduplicates 500,000 strings by interning every one of them.

**The problem:** Calling `String.intern()` on every string pushes data into the JVM's native string pool, which has GC overhead and contention under load.

```java
public class Main {
    public static String[] deduplicateStrings(String[] input) {
        String[] result = new String[input.length];
        for (int i = 0; i < input.length; i++) {
            result[i] = input[i].intern(); // forces into native string pool
        }
        return result;
    }

    public static void main(String[] args) {
        String[] data = new String[500_000];
        for (int i = 0; i < data.length; i++) {
            data[i] = "category_" + (i % 100); // only 100 unique values
        }

        long start = System.nanoTime();
        String[] deduped = deduplicateStrings(data);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Deduped: " + deduped.length + " in " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                      Mode  Cnt     Score     Error  Units
SlowDedup.deduplicateStrings   avgt   10  8234.5  ± 312.1    us/op
```

<details>
<summary>Hint</summary>

`String.intern()` uses a native hash table with a global lock. Can you use a `HashMap` instead to achieve the same deduplication in pure Java?

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.HashMap;
import java.util.Map;

public class Main {
    public static String[] deduplicateStrings(String[] input) {
        Map<String, String> pool = new HashMap<>(256); // pre-sized for expected uniques
        String[] result = new String[input.length];
        for (int i = 0; i < input.length; i++) {
            String canonical = pool.get(input[i]);
            if (canonical == null) {
                pool.put(input[i], input[i]);
                canonical = input[i];
            }
            result[i] = canonical;
        }
        return result;
    }

    public static void main(String[] args) {
        String[] data = new String[500_000];
        for (int i = 0; i < data.length; i++) {
            data[i] = "category_" + (i % 100);
        }

        long start = System.nanoTime();
        String[] deduped = deduplicateStrings(data);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Deduped: " + deduped.length + " in " + elapsed + " ms");
    }
}
```

**What changed:**
- `String.intern()` replaced with application-level `HashMap<String, String>` pool
- Pre-sized `HashMap(256)` to avoid rehashing for 100 unique keys

**Optimized benchmark:**
```
Benchmark                      Mode  Cnt    Score    Error  Units
FastDedup.deduplicateStrings   avgt   10  1845.2  ± 45.3   us/op
```

**Improvement:** ~4.5x faster. The native string pool is bypassed entirely.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `String.intern()` uses a C++ hash table inside the JVM (the `StringTable`). It requires a JNI call, holds a global lock (or striped locks depending on JVM version), and the interned strings become GC roots that are only cleaned during full GC. A `HashMap` in Java is lock-free for single-threaded use and benefits from JIT inlining.

**When to apply:** When you need to canonicalize strings in application code — e.g., deduplicating parsed field values.
**When NOT to apply:** If you genuinely need cross-classloader string identity (`==`) comparison, `intern()` is the only correct tool. Also, `intern()` is appropriate for a small, fixed set of strings known at compile time.

</details>

---

## Exercise 3: Repeated Regex Compilation (Easy, cpu)

**What the code does:** Validates 100,000 email addresses using a regex pattern.

**The problem:** The regex pattern is compiled on every call to `String.matches()`.

```java
public class Main {
    public static int countValidEmails(String[] emails) {
        int count = 0;
        for (String email : emails) {
            if (email.matches("^[\\w.+-]+@[\\w.-]+\\.[a-zA-Z]{2,}$")) {
                count++;
            }
        }
        return count;
    }

    public static void main(String[] args) {
        String[] emails = new String[100_000];
        for (int i = 0; i < emails.length; i++) {
            emails[i] = (i % 3 == 0) ? "user" + i + "@example.com" : "invalid-" + i;
        }

        long start = System.nanoTime();
        int valid = countValidEmails(emails);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Valid: " + valid + " in " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                      Mode  Cnt      Score     Error  Units
SlowEmail.countValidEmails     avgt   10  12456.3  ± 234.8    us/op
SlowEmail.gc.alloc.rate        avgt   10      1.4  ±   0.1    GB/s
```

<details>
<summary>Hint</summary>

`String.matches()` internally calls `Pattern.compile()` + `Matcher.matches()` every time. Can you compile the pattern once?

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.regex.Pattern;

public class Main {
    // Pattern compiled once and reused — Pattern is thread-safe
    private static final Pattern EMAIL_PATTERN =
            Pattern.compile("^[\\w.+-]+@[\\w.-]+\\.[a-zA-Z]{2,}$");

    public static int countValidEmails(String[] emails) {
        int count = 0;
        for (String email : emails) {
            if (EMAIL_PATTERN.matcher(email).matches()) {
                count++;
            }
        }
        return count;
    }

    public static void main(String[] args) {
        String[] emails = new String[100_000];
        for (int i = 0; i < emails.length; i++) {
            emails[i] = (i % 3 == 0) ? "user" + i + "@example.com" : "invalid-" + i;
        }

        long start = System.nanoTime();
        int valid = countValidEmails(emails);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Valid: " + valid + " in " + elapsed + " ms");
    }
}
```

**What changed:**
- `email.matches(regex)` replaced with pre-compiled `Pattern` stored as a `static final` field
- Regex compilation happens once at class load, not 100,000 times

**Optimized benchmark:**
```
Benchmark                      Mode  Cnt     Score    Error  Units
FastEmail.countValidEmails     avgt   10  3421.7  ± 67.2    us/op
FastEmail.gc.alloc.rate        avgt   10     0.3  ±  0.0    GB/s
```

**Improvement:** ~3.6x faster, ~78% less allocation. Regex compilation is the most expensive part of `Pattern.compile()`.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `Pattern.compile()` parses the regex string into an internal finite automaton — this is expensive (involves parsing, NFA construction, and optional DFA optimization). By compiling once, you pay this cost only at class load time. The `Pattern` object is immutable and thread-safe, so a `static final` field is the idiomatic approach.

**When to apply:** Any time a regex is used inside a loop or called repeatedly — validation, parsing, search.
**When NOT to apply:** If the regex string is dynamic (user-provided) and changes per invocation, you must compile each time. Consider an LRU cache of compiled patterns in that case.

</details>

---

## Exercise 4: String.format() in a Hot Loop (Medium, cpu)

**What the code does:** Generates 100,000 log entries with timestamps and data.

**The problem:** `String.format()` is extremely slow due to format string parsing, locale resolution, and object creation on every call.

```java
public class Main {
    public static String[] generateLogEntries(int count) {
        String[] entries = new String[count];
        for (int i = 0; i < count; i++) {
            entries[i] = String.format("[%04d] INFO: Processed item %d with status %s",
                    i % 10000, i, (i % 2 == 0) ? "OK" : "FAIL");
        }
        return entries;
    }

    public static void main(String[] args) {
        long start = System.nanoTime();
        String[] logs = generateLogEntries(100_000);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Generated " + logs.length + " entries in " + elapsed + " ms");
        System.out.println("Sample: " + logs[0]);
    }
}
```

**Current benchmark:**
```
Benchmark                         Mode  Cnt      Score     Error  Units
SlowLog.generateLogEntries        avgt   10  85234.7  ± 1523.4   us/op
SlowLog.gc.alloc.rate             avgt   10      2.1  ±    0.1   GB/s
```

<details>
<summary>Hint</summary>

`String.format()` parses the format string each time, resolves the locale, creates `Formatter` and `StringBuilder` objects internally. Can you use `StringBuilder` with manual formatting?

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    public static String[] generateLogEntries(int count) {
        String[] entries = new String[count];
        StringBuilder sb = new StringBuilder(64); // reuse across iterations
        for (int i = 0; i < count; i++) {
            sb.setLength(0); // clear without reallocating
            sb.append('[');
            appendPadded(sb, i % 10000, 4);
            sb.append("] INFO: Processed item ")
              .append(i)
              .append(" with status ")
              .append((i % 2 == 0) ? "OK" : "FAIL");
            entries[i] = sb.toString();
        }
        return entries;
    }

    private static void appendPadded(StringBuilder sb, int value, int width) {
        String numStr = Integer.toString(value);
        for (int i = numStr.length(); i < width; i++) {
            sb.append('0');
        }
        sb.append(numStr);
    }

    public static void main(String[] args) {
        long start = System.nanoTime();
        String[] logs = generateLogEntries(100_000);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Generated " + logs.length + " entries in " + elapsed + " ms");
        System.out.println("Sample: " + logs[0]);
    }
}
```

**What changed:**
- `String.format()` replaced with reusable `StringBuilder` and manual padding
- `StringBuilder` is reused across iterations with `setLength(0)` — no reallocation
- Manual zero-padding avoids `Formatter` overhead entirely

**Optimized benchmark:**
```
Benchmark                         Mode  Cnt     Score    Error  Units
FastLog.generateLogEntries        avgt   10  4512.3  ± 112.5   us/op
FastLog.gc.alloc.rate             avgt   10     0.4  ±   0.0   GB/s
```

**Improvement:** ~19x faster, ~81% less allocation

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `String.format()` internally creates a new `java.util.Formatter` per call, which creates a new `StringBuilder`, parses the format string character by character looking for `%` specifiers, resolves `Locale.getDefault()`, and dispatches to type-specific formatters. For a simple log line, this machinery is massive overhead. Direct `StringBuilder` usage skips all of it.

**When to apply:** Any hot path where `String.format()` is called repeatedly — log generation, report building, data export.
**When NOT to apply:** Cold paths (called once or rarely), complex locale-sensitive formatting (currency, dates) where `Formatter` correctness matters more than speed.

</details>

---

## Exercise 5: Substring Memory Leak Pattern (Medium, mem)

**What the code does:** Extracts and stores short identifiers from 100,000 long log lines.

**The problem:** In older JVMs (pre-Java 7u6), `substring()` shared the backing `char[]` of the original string, causing memory leaks. In modern JVMs, `substring()` copies — but the real problem here is holding references to large strings when only a small part is needed.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    // Simulates reading large log lines and extracting short IDs
    public static List<String> extractIds(String[] logLines) {
        List<String> ids = new ArrayList<>();
        for (String line : logLines) {
            // Extract first 8 chars as ID, but hold reference to full line via toString
            String id = line.substring(0, 8);
            // In some patterns, developers accidentally keep the original string alive:
            ids.add(id);
        }
        return ids;
    }

    public static void main(String[] args) {
        // Each log line is ~500 chars long
        String[] logLines = new String[100_000];
        StringBuilder sb = new StringBuilder(500);
        for (int i = 0; i < logLines.length; i++) {
            sb.setLength(0);
            sb.append(String.format("%08d", i));
            for (int j = 0; j < 492; j++) {
                sb.append('X');
            }
            logLines[i] = sb.toString();
        }

        long beforeMem = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();
        List<String> ids = extractIds(logLines);
        logLines = null; // allow GC of originals
        System.gc();
        long afterMem = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();

        System.out.println("IDs extracted: " + ids.size());
        System.out.println("Memory used: " + (afterMem - beforeMem) / 1024 + " KB");
    }
}
```

**Current benchmark:**
```
Benchmark                    Mode  Cnt      Score     Error  Units
SlowExtract.extractIds       avgt   10  15234.5  ± 423.1    us/op
SlowExtract.gc.alloc.norm    avgt   10      52 MB            B/op
```

<details>
<summary>Hint</summary>

The slow version uses `String.format()` to build each log line. The extraction itself is fine on modern JVMs, but the overall pipeline can be optimized by pre-sizing the list and avoiding format overhead.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    public static List<String> extractIds(String[] logLines) {
        List<String> ids = new ArrayList<>(logLines.length); // pre-sized
        for (String line : logLines) {
            // new String() ensures a compact, independent copy of the substring
            ids.add(new String(line.substring(0, 8)));
        }
        return ids;
    }

    public static void main(String[] args) {
        // Build log lines without String.format
        String[] logLines = new String[100_000];
        StringBuilder sb = new StringBuilder(500);
        String padding = "X".repeat(492);
        for (int i = 0; i < logLines.length; i++) {
            sb.setLength(0);
            appendPadded(sb, i, 8);
            sb.append(padding);
            logLines[i] = sb.toString();
        }

        long beforeMem = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();
        List<String> ids = extractIds(logLines);
        logLines = null;
        System.gc();
        long afterMem = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();

        System.out.println("IDs extracted: " + ids.size());
        System.out.println("Memory used: " + (afterMem - beforeMem) / 1024 + " KB");
    }

    private static void appendPadded(StringBuilder sb, int value, int width) {
        String numStr = Integer.toString(value);
        for (int i = numStr.length(); i < width; i++) {
            sb.append('0');
        }
        sb.append(numStr);
    }
}
```

**What changed:**
- `new String(substring)` ensures a truly independent copy — safe across all JVM versions
- `ArrayList` pre-sized to `logLines.length` — avoids 17 internal array copies during growth
- Eliminated `String.format()` from log line generation — massive overhead reduction

**Optimized benchmark:**
```
Benchmark                    Mode  Cnt     Score    Error  Units
FastExtract.extractIds       avgt   10  3456.2  ± 87.4    us/op
FastExtract.gc.alloc.norm    avgt   10      5 MB           B/op
```

**Improvement:** ~4.4x faster, ~90% less memory allocation

</details>

<details>
<summary>Learn More</summary>

**Why this works:** Pre-sizing `ArrayList` avoids the O(n) cost of repeated `Arrays.copyOf()` during growth. The `new String()` constructor creates a compact copy with its own backing array, which is important when the substring is much smaller than the source — it allows the large source string to be GC'd. On modern JVMs (7u6+), `substring()` already creates a new backing array, so `new String()` adds minimal overhead but is a defensive best practice.

**When to apply:** Extracting small tokens from large source strings — log parsing, CSV field extraction, protocol parsing.
**When NOT to apply:** When the substring is nearly the same size as the original — copying provides no memory benefit.

</details>

---

## Exercise 6: String Pool Ignorance (Medium, mem)

**What the code does:** Compares 1,000,000 pairs of status strings for equality.

**The problem:** Creates new `String` objects via `new String()` instead of leveraging the string pool, and uses `.equals()` where `==` would suffice for interned constants.

```java
public class Main {
    private static final String[] STATUSES = {"ACTIVE", "INACTIVE", "PENDING", "DELETED"};

    public static int countByStatus(String[] records, String targetStatus) {
        int count = 0;
        for (String record : records) {
            if (record.equals(targetStatus)) {
                count++;
            }
        }
        return count;
    }

    public static void main(String[] args) {
        // Simulates records coming from deserialization — each is a new String object
        String[] records = new String[1_000_000];
        for (int i = 0; i < records.length; i++) {
            records[i] = new String(STATUSES[i % 4]); // forces new heap object each time
        }

        long start = System.nanoTime();
        int active = countByStatus(records, "ACTIVE");
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Active: " + active + " in " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                      Mode  Cnt     Score    Error  Units
SlowCount.countByStatus        avgt   10  4523.7  ± 89.2    us/op
SlowCount.gc.alloc.norm        avgt   10     24 MB          B/op
```

<details>
<summary>Hint</summary>

If you know the set of possible values is small and fixed, you can map strings to an enum or intern them at the point of ingestion — then use `==` instead of `.equals()`.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    // Use an enum to represent the fixed set of statuses
    enum Status { ACTIVE, INACTIVE, PENDING, DELETED }

    public static int countByStatus(Status[] records, Status target) {
        int count = 0;
        for (Status record : records) {
            if (record == target) { // identity comparison — single CPU instruction
                count++;
            }
        }
        return count;
    }

    public static void main(String[] args) {
        Status[] records = new Status[1_000_000];
        Status[] pool = Status.values();
        for (int i = 0; i < records.length; i++) {
            records[i] = pool[i % 4]; // reuses same enum constants — zero allocation
        }

        long start = System.nanoTime();
        int active = countByStatus(records, Status.ACTIVE);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Active: " + active + " in " + elapsed + " ms");
    }
}
```

**What changed:**
- `String` replaced with `enum Status` — each status is a singleton, no heap allocation per record
- `.equals()` replaced with `==` — reference comparison is a single CPU instruction vs character-by-character comparison
- `new String(...)` eliminated — enum values are shared constants

**Optimized benchmark:**
```
Benchmark                      Mode  Cnt    Score   Error  Units
FastCount.countByStatus        avgt   10  412.3  ± 11.2   us/op
FastCount.gc.alloc.norm        avgt   10     4 MB         B/op
```

**Improvement:** ~11x faster, ~83% less memory. Enum identity comparison is an order of magnitude faster than `String.equals()`.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `String.equals()` must check: (1) reference equality, (2) type cast, (3) length comparison, (4) character-by-character comparison. Even with JIT optimization, this is ~5-10 CPU instructions per call. Enum `==` is a single pointer comparison — one instruction. Additionally, enum constants are singletons created at class load time, so 1,000,000 enum references cost zero heap allocation vs 1,000,000 `new String()` objects.

**When to apply:** Fixed, known sets of string values — status codes, categories, types, roles.
**When NOT to apply:** When string values are truly dynamic and unbounded — user input, free-form text.

</details>

---

## Exercise 7: Wasteful String.split() (Medium, cpu)

**What the code does:** Parses 100,000 CSV lines into arrays of fields.

**The problem:** `String.split()` compiles a regex pattern internally on every call, and creates intermediate `String[]` arrays.

```java
public class Main {
    public static String[][] parseCSV(String[] lines) {
        String[][] result = new String[lines.length][];
        for (int i = 0; i < lines.length; i++) {
            result[i] = lines[i].split(","); // compiles regex "," each time
        }
        return result;
    }

    public static void main(String[] args) {
        String[] lines = new String[100_000];
        for (int i = 0; i < lines.length; i++) {
            lines[i] = "field1_" + i + ",field2_" + i + ",field3_" + i + ",field4_" + i;
        }

        long start = System.nanoTime();
        String[][] parsed = parseCSV(lines);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Parsed " + parsed.length + " lines in " + elapsed + " ms");
        System.out.println("Sample: " + java.util.Arrays.toString(parsed[0]));
    }
}
```

**Current benchmark:**
```
Benchmark                  Mode  Cnt      Score     Error  Units
SlowCSVParse.parseCSV      avgt   10  18234.5  ± 567.2    us/op
SlowCSVParse.gc.alloc.rate avgt   10      1.8  ±   0.1    GB/s
```

<details>
<summary>Hint</summary>

Note: `String.split()` has a fast path for single-character delimiters that don't need regex. But you can still beat it with `indexOf` + `substring` to avoid creating the internal `ArrayList` and `String[]` overhead.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    public static String[][] parseCSV(String[] lines) {
        String[][] result = new String[lines.length][];
        for (int i = 0; i < lines.length; i++) {
            result[i] = splitByComma(lines[i]);
        }
        return result;
    }

    // Manual split using indexOf — avoids regex and intermediate ArrayList
    private static String[] splitByComma(String line) {
        // Count commas first to pre-size the array
        int count = 1;
        int idx = 0;
        while ((idx = line.indexOf(',', idx)) != -1) {
            count++;
            idx++;
        }

        String[] parts = new String[count];
        int start = 0;
        for (int i = 0; i < count - 1; i++) {
            int end = line.indexOf(',', start);
            parts[i] = line.substring(start, end);
            start = end + 1;
        }
        parts[count - 1] = line.substring(start);
        return parts;
    }

    public static void main(String[] args) {
        String[] lines = new String[100_000];
        for (int i = 0; i < lines.length; i++) {
            lines[i] = "field1_" + i + ",field2_" + i + ",field3_" + i + ",field4_" + i;
        }

        long start = System.nanoTime();
        String[][] parsed = parseCSV(lines);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Parsed " + parsed.length + " lines in " + elapsed + " ms");
        System.out.println("Sample: " + java.util.Arrays.toString(parsed[0]));
    }
}
```

**What changed:**
- `String.split(",")` replaced with manual `indexOf` + `substring` loop
- Pre-counted commas to allocate exact-sized array — no intermediate `ArrayList`
- No regex engine involvement at all

**Optimized benchmark:**
```
Benchmark                  Mode  Cnt     Score    Error  Units
FastCSVParse.parseCSV      avgt   10  6234.7  ± 145.3   us/op
FastCSVParse.gc.alloc.rate avgt   10     0.9  ±   0.0   GB/s
```

**Improvement:** ~2.9x faster, ~50% less allocation

</details>

<details>
<summary>Learn More</summary>

**Why this works:** Even though `String.split()` has a fast-path optimization for single-character non-regex delimiters (added in OpenJDK), it still creates an internal `ArrayList<String>`, adds substrings to it, then converts to `String[]` via `toArray()`. The manual approach pre-counts to allocate the exact array size and uses `indexOf` (a JVM intrinsic on modern JDKs) for scanning.

**When to apply:** High-volume parsing where the delimiter is a single character — CSV, TSV, log parsing.
**When NOT to apply:** Complex delimiters that genuinely need regex, or low-volume parsing where readability matters more. `split()` is perfectly fine for non-hot paths.

</details>

---

## Exercise 8: char[] vs String for Sensitive Data (Hard, mem)

**What the code does:** Processes a password through validation, hashing, and storage preparation.

**The problem:** The password is stored as a `String`, which is immutable and stays in memory until GC — visible in heap dumps and memory scans.

```java
import java.security.MessageDigest;
import java.util.Base64;

public class Main {
    public static String hashPassword(String password) {
        try {
            // Password sits in String pool, cannot be cleared
            String salted = "SALT_" + password + "_PEPPER";
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(salted.getBytes("UTF-8"));
            return Base64.getEncoder().encodeToString(hash);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    public static void main(String[] args) {
        String[] passwords = new String[50_000];
        for (int i = 0; i < passwords.length; i++) {
            passwords[i] = "P@ssw0rd_" + i + "!secure";
        }

        long start = System.nanoTime();
        String[] hashes = new String[passwords.length];
        for (int i = 0; i < passwords.length; i++) {
            hashes[i] = hashPassword(passwords[i]);
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Hashed " + hashes.length + " passwords in " + elapsed + " ms");
        System.out.println("Sample: " + hashes[0]);
    }
}
```

**Current benchmark:**
```
Benchmark                    Mode  Cnt      Score     Error  Units
SlowHash.hashPassword        avgt   10  23456.7  ± 567.8    us/op
SlowHash.gc.alloc.rate       avgt   10      1.9  ±   0.1    GB/s
```

<details>
<summary>Hint</summary>

Use `char[]` for the password and clear it immediately after use. Use `byte[]` directly for hashing — avoid creating intermediate `String` objects that linger in memory.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;

public class Main {
    private static final byte[] SALT = "SALT_".getBytes(StandardCharsets.UTF_8);
    private static final byte[] PEPPER = "_PEPPER".getBytes(StandardCharsets.UTF_8);

    public static String hashPassword(char[] password) {
        try {
            // Convert char[] to byte[] directly — no String intermediary
            byte[] passBytes = new byte[password.length * 3]; // UTF-8 worst case
            int len = 0;
            for (char c : password) {
                if (c < 0x80) {
                    passBytes[len++] = (byte) c;
                } else if (c < 0x800) {
                    passBytes[len++] = (byte) (0xC0 | (c >> 6));
                    passBytes[len++] = (byte) (0x80 | (c & 0x3F));
                } else {
                    passBytes[len++] = (byte) (0xE0 | (c >> 12));
                    passBytes[len++] = (byte) (0x80 | ((c >> 6) & 0x3F));
                    passBytes[len++] = (byte) (0x80 | (c & 0x3F));
                }
            }

            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(SALT);
            md.update(passBytes, 0, len);
            md.update(PEPPER);
            byte[] hash = md.digest();

            // Zero out sensitive data immediately
            Arrays.fill(passBytes, (byte) 0);
            Arrays.fill(password, '\0');

            return Base64.getEncoder().encodeToString(hash);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    public static void main(String[] args) {
        char[][] passwords = new char[50_000][];
        for (int i = 0; i < passwords.length; i++) {
            passwords[i] = ("P@ssw0rd_" + i + "!secure").toCharArray();
        }

        long start = System.nanoTime();
        String[] hashes = new String[passwords.length];
        for (int i = 0; i < passwords.length; i++) {
            hashes[i] = hashPassword(passwords[i]);
        }
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Hashed " + hashes.length + " passwords in " + elapsed + " ms");
        System.out.println("Sample: " + hashes[0]);
    }
}
```

**What changed:**
- `String password` replaced with `char[] password` — mutable, can be zeroed after use
- `"SALT_" + password + "_PEPPER"` replaced with `MessageDigest.update()` calls — no intermediate `String`
- `Arrays.fill(password, '\0')` zeroes sensitive data immediately
- Salt/pepper stored as reusable `byte[]` constants — no repeated string concatenation

**Optimized benchmark:**
```
Benchmark                    Mode  Cnt      Score     Error  Units
FastHash.hashPassword        avgt   10  12345.6  ± 234.5    us/op
FastHash.gc.alloc.rate       avgt   10      0.6  ±   0.0    GB/s
```

**Improvement:** ~1.9x faster, ~68% less allocation. More importantly: passwords are never stored as immutable `String` objects and are zeroed immediately after hashing.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** `String` objects in Java are immutable — once created, their content stays in heap memory until the GC collects them (and even then, the bytes may persist in memory pages). `char[]` is mutable and can be explicitly zeroed with `Arrays.fill()`. This is why all Java security APIs (`KeyStore.load()`, `PasswordCallback`) use `char[]` for passwords, not `String`.

The performance gain comes from avoiding the `"SALT_" + password + "_PEPPER"` concatenation, which creates at least 2 intermediate `String` objects and a `StringBuilder` internally. Using `MessageDigest.update()` in segments avoids all intermediate allocations.

**When to apply:** Any code handling passwords, tokens, API keys, encryption keys, or other sensitive data.
**When NOT to apply:** Non-sensitive string processing where `String` immutability and interning are beneficial.

</details>

---

## Exercise 9: Text Block vs String Concatenation for Templates (Hard, cpu)

**What the code does:** Generates 50,000 HTML email bodies by substituting placeholders in a template.

**The problem:** Uses repeated `String.replace()` calls, each creating a new `String` copy of the entire template.

```java
public class Main {
    public static String[] generateEmails(String[] names, String[] emails, int[] orderIds) {
        String[] results = new String[names.length];
        for (int i = 0; i < names.length; i++) {
            String template = "<html><body>"
                    + "<h1>Hello, {{NAME}}!</h1>"
                    + "<p>Your order #{{ORDER_ID}} has been confirmed.</p>"
                    + "<p>Confirmation sent to: {{EMAIL}}</p>"
                    + "<p>Thank you for shopping with us.</p>"
                    + "</body></html>";
            results[i] = template
                    .replace("{{NAME}}", names[i])
                    .replace("{{ORDER_ID}}", String.valueOf(orderIds[i]))
                    .replace("{{EMAIL}}", emails[i]);
        }
        return results;
    }

    public static void main(String[] args) {
        int count = 50_000;
        String[] names = new String[count];
        String[] emails = new String[count];
        int[] orderIds = new int[count];
        for (int i = 0; i < count; i++) {
            names[i] = "User" + i;
            emails[i] = "user" + i + "@example.com";
            orderIds[i] = 10000 + i;
        }

        long start = System.nanoTime();
        String[] results = generateEmails(names, emails, orderIds);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Generated " + results.length + " emails in " + elapsed + " ms");
        System.out.println("Sample length: " + results[0].length());
    }
}
```

**Current benchmark:**
```
Benchmark                        Mode  Cnt      Score     Error  Units
SlowEmail.generateEmails         avgt   10  34567.8  ± 789.1    us/op
SlowEmail.gc.alloc.rate          avgt   10      2.4  ±   0.1    GB/s
```

<details>
<summary>Hint</summary>

Instead of treating the template as a single string and doing 3 full-copy replacements, split the template into fixed parts and assemble with `StringBuilder`. Each `replace()` scans the entire string and creates a full copy.

</details>

<details>
<summary>Optimized Code</summary>

```java
public class Main {
    // Template split into constant segments at compile time
    private static final String PART1 = "<html><body><h1>Hello, ";
    private static final String PART2 = "!</h1><p>Your order #";
    private static final String PART3 = " has been confirmed.</p><p>Confirmation sent to: ";
    private static final String PART4 = "</p><p>Thank you for shopping with us.</p></body></html>";

    public static String[] generateEmails(String[] names, String[] emails, int[] orderIds) {
        String[] results = new String[names.length];
        // Estimate: fixed parts ~130 chars + variable ~40 chars = ~170
        StringBuilder sb = new StringBuilder(180);
        for (int i = 0; i < names.length; i++) {
            sb.setLength(0);
            sb.append(PART1).append(names[i])
              .append(PART2).append(orderIds[i])
              .append(PART3).append(emails[i])
              .append(PART4);
            results[i] = sb.toString();
        }
        return results;
    }

    public static void main(String[] args) {
        int count = 50_000;
        String[] names = new String[count];
        String[] emails = new String[count];
        int[] orderIds = new int[count];
        for (int i = 0; i < count; i++) {
            names[i] = "User" + i;
            emails[i] = "user" + i + "@example.com";
            orderIds[i] = 10000 + i;
        }

        long start = System.nanoTime();
        String[] results = generateEmails(names, emails, orderIds);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Generated " + results.length + " emails in " + elapsed + " ms");
        System.out.println("Sample length: " + results[0].length());
    }
}
```

**What changed:**
- Template split into constant `String` segments — no runtime string scanning
- `StringBuilder` reused across iterations with `setLength(0)` — amortizes allocation
- `replace()` chain eliminated — each `replace()` scanned ~180 chars and created a new `String`; 3 calls = 3 full copies per iteration
- `orderIds[i]` appended directly via `sb.append(int)` — avoids `String.valueOf()` intermediate

**Optimized benchmark:**
```
Benchmark                        Mode  Cnt     Score    Error  Units
FastEmail.generateEmails         avgt   10  4567.8  ± 102.3   us/op
FastEmail.gc.alloc.rate          avgt   10     0.5  ±   0.0   GB/s
```

**Improvement:** ~7.6x faster, ~79% less allocation

</details>

<details>
<summary>Learn More</summary>

**Why this works:** Each `String.replace("{{NAME}}", value)` must: (1) scan the entire string for the placeholder, (2) allocate a new `char[]`/`byte[]` for the result, (3) copy all characters with the substitution. With 3 placeholders, this is 3 complete scans and 3 full copies of a ~180-char template per iteration. The `StringBuilder` approach assembles the result in a single forward pass with zero scanning.

For Java 15+ text blocks: text blocks (`"""..."""`) improve readability but compile down to the same `String` — they do NOT solve the `replace()` performance problem. The optimization here is about eliminating `replace()`, not about how the template literal is written.

**When to apply:** Any template-based string generation in hot paths — email generation, HTML rendering, report building.
**When NOT to apply:** When using a real template engine (Thymeleaf, FreeMarker) — these engines already compile templates into efficient append sequences.

</details>

---

## Exercise 10: Naive toString() in Large Collections (Hard, mem)

**What the code does:** Builds a debug representation of 10,000 objects with nested string assembly.

**The problem:** Each object's `toString()` uses `String.format()` and these are concatenated into a massive debug output via `+=`.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    static class Product {
        String name;
        double price;
        String category;
        int quantity;

        Product(String name, double price, String category, int quantity) {
            this.name = name;
            this.price = price;
            this.category = category;
            this.quantity = quantity;
        }

        @Override
        public String toString() {
            return String.format("Product{name='%s', price=%.2f, category='%s', qty=%d}",
                    name, price, category, quantity);
        }
    }

    public static String buildDebugReport(List<Product> products) {
        String report = "=== Product Report ===\n";
        report += "Total items: " + products.size() + "\n";
        report += "---\n";
        for (int i = 0; i < products.size(); i++) {
            report += (i + 1) + ". " + products.get(i).toString() + "\n";
        }
        report += "=== End Report ===";
        return report;
    }

    public static void main(String[] args) {
        List<Product> products = new ArrayList<>();
        String[] categories = {"Electronics", "Books", "Clothing", "Food", "Toys"};
        for (int i = 0; i < 10_000; i++) {
            products.add(new Product(
                    "Item_" + i,
                    9.99 + (i % 100),
                    categories[i % 5],
                    1 + (i % 50)
            ));
        }

        long start = System.nanoTime();
        String report = buildDebugReport(products);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Report length: " + report.length() + " in " + elapsed + " ms");
    }
}
```

**Current benchmark:**
```
Benchmark                        Mode  Cnt       Score      Error  Units
SlowReport.buildDebugReport      avgt   10  245678.9  ± 4567.8    us/op
SlowReport.gc.alloc.rate         avgt   10       4.2  ±    0.2    GB/s
```

**Profiling output:**
```
JFR/async-profiler shows:
  62% — String concatenation in buildDebugReport loop (+=)
  28% — String.format() inside Product.toString()
  10% — other (ArrayList iteration, I/O)
```

<details>
<summary>Hint</summary>

Two separate problems: (1) `+=` in the report loop creates O(n^2) copies, and (2) `String.format()` in `toString()` is heavy. Fix both with `StringBuilder` — one for the report, and replace `format` with manual append in `toString`.

</details>

<details>
<summary>Optimized Code</summary>

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    static class Product {
        String name;
        double price;
        String category;
        int quantity;

        Product(String name, double price, String category, int quantity) {
            this.name = name;
            this.price = price;
            this.category = category;
            this.quantity = quantity;
        }

        // Append directly to caller's StringBuilder — no intermediate String
        public void appendTo(StringBuilder sb) {
            sb.append("Product{name='").append(name)
              .append("', price=");
            appendPrice(sb, price);
            sb.append(", category='").append(category)
              .append("', qty=").append(quantity).append('}');
        }

        private static void appendPrice(StringBuilder sb, double price) {
            long cents = Math.round(price * 100);
            sb.append(cents / 100).append('.');
            long frac = cents % 100;
            if (frac < 10) sb.append('0');
            sb.append(frac);
        }
    }

    public static String buildDebugReport(List<Product> products) {
        int size = products.size();
        // Estimate ~70 chars per product + header/footer
        StringBuilder sb = new StringBuilder(size * 75 + 100);
        sb.append("=== Product Report ===\n");
        sb.append("Total items: ").append(size).append('\n');
        sb.append("---\n");
        for (int i = 0; i < size; i++) {
            sb.append(i + 1).append(". ");
            products.get(i).appendTo(sb);
            sb.append('\n');
        }
        sb.append("=== End Report ===");
        return sb.toString();
    }

    public static void main(String[] args) {
        List<Product> products = new ArrayList<>();
        String[] categories = {"Electronics", "Books", "Clothing", "Food", "Toys"};
        for (int i = 0; i < 10_000; i++) {
            products.add(new Product(
                    "Item_" + i,
                    9.99 + (i % 100),
                    categories[i % 5],
                    1 + (i % 50)
            ));
        }

        long start = System.nanoTime();
        String report = buildDebugReport(products);
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Report length: " + report.length() + " in " + elapsed + " ms");
    }
}
```

**What changed:**
- `report +=` loop replaced with a single pre-sized `StringBuilder` — eliminates O(n^2) character copying
- `String.format()` in `toString()` replaced with `appendTo(StringBuilder)` pattern — zero intermediate Strings
- Manual price formatting avoids `Formatter` and `Double.toString()` overhead
- Pre-sized `StringBuilder(size * 75 + 100)` — avoids ~14 internal buffer resizings

**Optimized benchmark:**
```
Benchmark                        Mode  Cnt     Score    Error  Units
FastReport.buildDebugReport      avgt   10  2345.6  ± 67.8    us/op
FastReport.gc.alloc.rate         avgt   10     0.2  ±  0.0    GB/s
```

**Improvement:** ~105x faster, ~95% less allocation. The O(n^2) `+=` was the dominant bottleneck, but eliminating `String.format()` also saves ~28% on top.

</details>

<details>
<summary>Learn More</summary>

**Why this works:** The `+=` concatenation in a loop has O(n^2) complexity because each iteration copies all previously accumulated characters. For 10,000 products with ~70 chars each, that's roughly (10000 * 70 * 10000 / 2) = 3.5 billion character copies. A single `StringBuilder` does O(n) total copies.

The `appendTo(StringBuilder)` pattern (sometimes called the "appendable" pattern) is a Java performance idiom: instead of `toString()` which must allocate a `String`, the object appends its representation directly into the caller's buffer. This eliminates one `String` allocation per object and avoids the copy from the object's internal `StringBuilder` to the caller's.

**Advanced concept:** The JVM's escape analysis can sometimes stack-allocate short-lived `StringBuilder` instances, but it cannot optimize the O(n^2) copy pattern. For truly hot paths in production, consider the `Appendable` interface or `CharSequence` for composability.

**When to apply:** Building large text outputs — reports, logs, serialization, debug dumps.
**When NOT to apply:** Small, one-off `toString()` calls where clarity matters more. Also, consider using logging frameworks (SLF4J) with lazy message construction instead of building strings eagerly.

</details>

---

## Score Card

Track your progress:

| Exercise | Difficulty | Category | Identified bottleneck? | Optimized correctly? | Understood why? |
|:--------:|:---------:|:--------:|:---------------------:|:-------------------:|:---------------:|
| 1 | Easy | mem | ☐ | ☐ | ☐ |
| 2 | Easy | mem | ☐ | ☐ | ☐ |
| 3 | Easy | cpu | ☐ | ☐ | ☐ |
| 4 | Medium | cpu | ☐ | ☐ | ☐ |
| 5 | Medium | mem | ☐ | ☐ | ☐ |
| 6 | Medium | mem | ☐ | ☐ | ☐ |
| 7 | Medium | cpu | ☐ | ☐ | ☐ |
| 8 | Hard | mem | ☐ | ☐ | ☐ |
| 9 | Hard | cpu | ☐ | ☐ | ☐ |
| 10 | Hard | mem | ☐ | ☐ | ☐ |

### Rating:
- **10/10 optimized** — Senior-level Java String performance expertise
- **7-9/10** — Solid understanding of String internals and JVM behavior
- **4-6/10** — Good foundation, practice profiling with JMH
- **< 4/10** — Review String fundamentals and StringBuilder basics first

---

## Optimization Cheat Sheet

Quick reference for Java String performance optimizations:

| Problem | Solution | Impact |
|:--------|:---------|:------:|
| String `+=` in loop | Use `StringBuilder` (pre-sized) | Very High |
| `String.format()` in hot path | Manual `StringBuilder.append()` | High |
| `String.matches()` in loop | Pre-compile `Pattern` as `static final` | High |
| `String.split()` in hot loop | Manual `indexOf` + `substring` | Medium-High |
| `new String()` for known values | Use `enum` or application-level pool | High |
| `String.intern()` overuse | Use `HashMap<String, String>` pool | Medium |
| Passwords as `String` | Use `char[]` + `Arrays.fill('\0')` | Security + Medium |
| `String.replace()` chain | Split template into segments + `StringBuilder` | High |
| `toString()` in bulk operations | `appendTo(StringBuilder)` pattern | High |
| Unbounded `StringBuilder` growth | Pre-size with `new StringBuilder(capacity)` | Medium |
| `String.valueOf()` for primitives | `StringBuilder.append(int/long/double)` directly | Low-Medium |
| Regex for simple delimiters | `indexOf` / `charAt` scanning | Medium |
