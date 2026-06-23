# Loops — Practical Tasks

## Table of Contents

1. [Junior Tasks](#junior-tasks)
2. [Middle Tasks](#middle-tasks)
3. [Senior Tasks](#senior-tasks)
4. [Questions](#questions)
5. [Mini Projects](#mini-projects)
6. [Challenge](#challenge)

---

## Junior Tasks

### Task 1: FizzBuzz

**Type:** Code

**Goal:** Practice basic `for` loop with conditionals.

**Description:** Print numbers from 1 to 100. But for multiples of 3, print "Fizz" instead, for multiples of 5 print "Buzz", and for multiples of both print "FizzBuzz".

**Expected output (first 15 lines):**
```
1
2
Fizz
4
Buzz
Fizz
7
8
Fizz
Buzz
11
Fizz
13
14
FizzBuzz
```

<details>
<summary>Solution</summary>

```java
public class FizzBuzz {
    public static void main(String[] args) {
        for (int i = 1; i <= 100; i++) {
            if (i % 15 == 0) {
                System.out.println("FizzBuzz");
            } else if (i % 3 == 0) {
                System.out.println("Fizz");
            } else if (i % 5 == 0) {
                System.out.println("Buzz");
            } else {
                System.out.println(i);
            }
        }
    }
}
```

**Key takeaway:** Check `% 15` first (or `% 3 && % 5`), otherwise "FizzBuzz" is never printed.

</details>

---

### Task 2: Reverse an Array In-Place

**Type:** Code

**Goal:** Practice `for` loop with two-pointer technique.

**Description:** Write a method that reverses an integer array in-place (without creating a new array). Use a single `for` loop.

```java
// Input:  [1, 2, 3, 4, 5]
// Output: [5, 4, 3, 2, 1]
```

<details>
<summary>Solution</summary>

```java
import java.util.Arrays;

public class ReverseArray {
    public static void reverse(int[] arr) {
        for (int i = 0; i < arr.length / 2; i++) {
            int j = arr.length - 1 - i;
            int temp = arr[i];
            arr[i] = arr[j];
            arr[j] = temp;
        }
    }

    public static void main(String[] args) {
        int[] data = {1, 2, 3, 4, 5};
        reverse(data);
        System.out.println(Arrays.toString(data)); // [5, 4, 3, 2, 1]
    }
}
```

</details>

---

### Task 3: Password Validator with Retry

**Type:** Code

**Goal:** Practice `do-while` loop with user input.

**Description:** Ask the user to enter a password. The password must be at least 8 characters and contain at least one digit. Keep asking until a valid password is entered. Limit to 5 attempts, then print "Account locked".

<details>
<summary>Solution</summary>

```java
import java.util.Scanner;

public class PasswordValidator {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        int attempts = 0;
        boolean valid = false;

        do {
            System.out.print("Enter password: ");
            String password = scanner.nextLine();
            attempts++;

            if (password.length() < 8) {
                System.out.println("Too short! Must be at least 8 characters.");
            } else if (!password.matches(".*\\d.*")) {
                System.out.println("Must contain at least one digit.");
            } else {
                valid = true;
                System.out.println("Password accepted!");
            }

            if (!valid && attempts >= 5) {
                System.out.println("Account locked after 5 failed attempts.");
                break;
            }
        } while (!valid);

        scanner.close();
    }
}
```

</details>

---

### Task 4: Diamond Pattern

**Type:** Code

**Goal:** Practice nested `for` loops.

**Description:** Print a diamond pattern of stars for a given odd number `n`. For `n = 5`:

```
  *
 ***
*****
 ***
  *
```

<details>
<summary>Solution</summary>

```java
public class Diamond {
    public static void printDiamond(int n) {
        int mid = n / 2;

        for (int i = 0; i < n; i++) {
            int stars;
            int spaces;

            if (i <= mid) {
                stars = 2 * i + 1;
                spaces = mid - i;
            } else {
                stars = 2 * (n - 1 - i) + 1;
                spaces = i - mid;
            }

            for (int s = 0; s < spaces; s++) {
                System.out.print(" ");
            }
            for (int s = 0; s < stars; s++) {
                System.out.print("*");
            }
            System.out.println();
        }
    }

    public static void main(String[] args) {
        printDiamond(5);
    }
}
```

</details>

---

## Middle Tasks

### Task 5: Custom Iterable Range

**Type:** Code + Design

**Goal:** Implement the `Iterable` interface to create a reusable range class that works with `for-each`.

**Requirements:**
- `Range(start, end)` — iterates from `start` (inclusive) to `end` (exclusive)
- `Range(start, end, step)` — iterates with a custom step
- Must work with `for-each`: `for (int i : new Range(0, 10, 2))`
- Must be lazy — does not create a list of all values

<details>
<summary>Solution</summary>

```java
import java.util.Iterator;
import java.util.NoSuchElementException;

public class Range implements Iterable<Integer> {
    private final int start;
    private final int end;
    private final int step;

    public Range(int start, int end) {
        this(start, end, 1);
    }

    public Range(int start, int end, int step) {
        if (step == 0) throw new IllegalArgumentException("Step cannot be 0");
        if (step > 0 && start > end) throw new IllegalArgumentException("Invalid range");
        if (step < 0 && start < end) throw new IllegalArgumentException("Invalid range");
        this.start = start;
        this.end = end;
        this.step = step;
    }

    @Override
    public Iterator<Integer> iterator() {
        return new Iterator<>() {
            private int current = start;

            @Override
            public boolean hasNext() {
                return step > 0 ? current < end : current > end;
            }

            @Override
            public Integer next() {
                if (!hasNext()) throw new NoSuchElementException();
                int value = current;
                current += step;
                return value;
            }
        };
    }

    public static void main(String[] args) {
        System.out.print("0 to 10 step 2: ");
        for (int i : new Range(0, 10, 2)) {
            System.out.print(i + " "); // 0 2 4 6 8
        }

        System.out.print("\n10 to 0 step -3: ");
        for (int i : new Range(10, 0, -3)) {
            System.out.print(i + " "); // 10 7 4 1
        }
    }
}
```

</details>

---

### Task 6: Batch Processor with Error Handling

**Type:** Code + Architecture

**Goal:** Implement a batch processing loop that handles errors gracefully.

**Requirements:**
- Process a list of items in batches of configurable size
- If an item fails, log the error and continue (do not stop the batch)
- Track success/failure counts
- Print a summary at the end

<details>
<summary>Solution</summary>

```java
import java.util.*;

public class BatchProcessor<T> {
    private final int batchSize;
    private int successCount = 0;
    private int failureCount = 0;
    private final List<String> errors = new ArrayList<>();

    public BatchProcessor(int batchSize) {
        this.batchSize = batchSize;
    }

    public interface ItemProcessor<T> {
        void process(T item) throws Exception;
    }

    public void processAll(List<T> items, ItemProcessor<T> processor) {
        int totalBatches = (items.size() + batchSize - 1) / batchSize;

        for (int batchNum = 0; batchNum < totalBatches; batchNum++) {
            int start = batchNum * batchSize;
            int end = Math.min(start + batchSize, items.size());
            List<T> batch = items.subList(start, end);

            System.out.printf("Processing batch %d/%d (%d items)...%n",
                    batchNum + 1, totalBatches, batch.size());

            for (int i = 0; i < batch.size(); i++) {
                try {
                    processor.process(batch.get(i));
                    successCount++;
                } catch (Exception e) {
                    failureCount++;
                    errors.add(String.format("Batch %d, item %d: %s",
                            batchNum + 1, i, e.getMessage()));
                }
            }
        }

        printSummary();
    }

    private void printSummary() {
        System.out.println("\n=== Processing Summary ===");
        System.out.printf("Total: %d | Success: %d | Failed: %d%n",
                successCount + failureCount, successCount, failureCount);
        if (!errors.isEmpty()) {
            System.out.println("Errors:");
            errors.forEach(e -> System.out.println("  - " + e));
        }
    }

    public static void main(String[] args) {
        List<String> data = List.of(
                "valid1", "valid2", "ERROR", "valid3", "valid4",
                "ERROR", "valid5", "valid6", "valid7", "valid8"
        );

        BatchProcessor<String> processor = new BatchProcessor<>(3);
        processor.processAll(data, item -> {
            if (item.equals("ERROR")) {
                throw new RuntimeException("Invalid item: " + item);
            }
            System.out.println("  Processed: " + item);
        });
    }
}
```

</details>

---

### Task 7: Implement a Retry Mechanism

**Type:** Code

**Goal:** Build a retry loop with exponential backoff, jitter, and max retries.

**Requirements:**
- Accept a `Callable<T>` and retry on failure
- Exponential backoff: delay = baseDelay * 2^attempt
- Add random jitter (0-50% of delay) to prevent thundering herd
- Max retries configurable
- Return result on success or throw last exception on max retries exceeded

<details>
<summary>Solution</summary>

```java
import java.util.concurrent.Callable;
import java.util.concurrent.ThreadLocalRandom;

public class Retry {

    public static <T> T withBackoff(Callable<T> task, int maxRetries,
                                     long baseDelayMs) throws Exception {
        Exception lastException = null;

        for (int attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return task.call();
            } catch (Exception e) {
                lastException = e;
                if (attempt == maxRetries) {
                    break;
                }

                long delay = baseDelayMs * (1L << attempt);
                long jitter = ThreadLocalRandom.current().nextLong(delay / 2);
                long totalDelay = delay + jitter;

                System.out.printf("Attempt %d failed (%s). Retrying in %d ms...%n",
                        attempt + 1, e.getMessage(), totalDelay);
                Thread.sleep(totalDelay);
            }
        }

        throw new RuntimeException("All " + (maxRetries + 1) +
                " attempts failed", lastException);
    }

    public static void main(String[] args) throws Exception {
        int[] counter = {0};

        String result = withBackoff(() -> {
            counter[0]++;
            if (counter[0] < 3) {
                throw new RuntimeException("Service unavailable");
            }
            return "Success on attempt " + counter[0];
        }, 5, 100);

        System.out.println(result); // Success on attempt 3
    }
}
```

</details>

---

## Senior Tasks

### Task 8: Lock-Free Ring Buffer with Busy-Spin Loop

**Type:** Code + Performance

**Goal:** Implement a single-producer, single-consumer ring buffer using atomic operations and busy-spin loops.

**Requirements:**
- Fixed-size circular buffer
- Producer writes to the next available slot
- Consumer spins waiting for data (no blocking/locking)
- Use `AtomicLong` for sequence tracking
- Include `Thread.onSpinWait()` for CPU-friendly spinning

<details>
<summary>Solution</summary>

```java
import java.util.concurrent.atomic.AtomicLong;

public class RingBuffer<T> {
    private final Object[] buffer;
    private final int mask;
    private final AtomicLong writeSequence = new AtomicLong(-1);
    private final AtomicLong readSequence = new AtomicLong(-1);

    public RingBuffer(int capacity) {
        if (Integer.bitCount(capacity) != 1) {
            throw new IllegalArgumentException("Capacity must be a power of 2");
        }
        this.buffer = new Object[capacity];
        this.mask = capacity - 1;
    }

    public boolean offer(T value) {
        long nextWrite = writeSequence.get() + 1;
        // Check if buffer is full
        if (nextWrite - readSequence.get() > mask) {
            return false; // Full
        }
        buffer[(int) (nextWrite & mask)] = value;
        writeSequence.lazySet(nextWrite); // Store-release semantics
        return true;
    }

    @SuppressWarnings("unchecked")
    public T poll() {
        long nextRead = readSequence.get() + 1;
        if (nextRead > writeSequence.get()) {
            return null; // Empty
        }
        T value = (T) buffer[(int) (nextRead & mask)];
        readSequence.lazySet(nextRead);
        return value;
    }

    public static void main(String[] args) throws InterruptedException {
        RingBuffer<Long> rb = new RingBuffer<>(1024);

        // Producer thread
        Thread producer = new Thread(() -> {
            for (long i = 0; i < 1_000_000; i++) {
                while (!rb.offer(i)) {
                    Thread.onSpinWait(); // Busy-spin until space available
                }
            }
        });

        // Consumer thread with busy-spin loop
        Thread consumer = new Thread(() -> {
            long expected = 0;
            while (expected < 1_000_000) {
                Long value = rb.poll();
                if (value == null) {
                    Thread.onSpinWait(); // Busy-spin until data available
                    continue;
                }
                if (value != expected) {
                    throw new RuntimeException("Out of order: expected " +
                            expected + " got " + value);
                }
                expected++;
            }
            System.out.println("All 1,000,000 messages received in order.");
        });

        long start = System.nanoTime();
        producer.start();
        consumer.start();
        producer.join();
        consumer.join();
        long elapsed = System.nanoTime() - start;

        System.out.printf("Throughput: %.2f million ops/sec%n",
                1_000_000.0 / (elapsed / 1_000_000_000.0) / 1_000_000);
    }
}
```

</details>

---

### Task 9: Implement a Chunked Parallel Processor

**Type:** Code + Architecture

**Goal:** Process a large dataset in parallel using chunked loops, with back-pressure and progress reporting.

**Requirements:**
- Split data into chunks
- Process chunks in parallel using a thread pool
- Limit concurrent chunks (back-pressure)
- Report progress after each chunk completes
- Handle errors per-chunk (continue processing remaining chunks)
- Use `CompletableFuture` for orchestration

<details>
<summary>Solution</summary>

```java
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.Function;

public class ChunkedParallelProcessor<T, R> {
    private final int chunkSize;
    private final int maxConcurrency;
    private final ExecutorService executor;

    public ChunkedParallelProcessor(int chunkSize, int maxConcurrency) {
        this.chunkSize = chunkSize;
        this.maxConcurrency = maxConcurrency;
        this.executor = Executors.newFixedThreadPool(maxConcurrency);
    }

    public List<R> process(List<T> items, Function<T, R> transformer) {
        List<R> results = Collections.synchronizedList(new ArrayList<>());
        AtomicInteger completedChunks = new AtomicInteger(0);
        AtomicInteger failedItems = new AtomicInteger(0);
        Semaphore semaphore = new Semaphore(maxConcurrency);

        int totalChunks = (items.size() + chunkSize - 1) / chunkSize;
        List<CompletableFuture<Void>> futures = new ArrayList<>();

        for (int i = 0; i < items.size(); i += chunkSize) {
            int start = i;
            int end = Math.min(i + chunkSize, items.size());
            List<T> chunk = items.subList(start, end);

            try {
                semaphore.acquire(); // Back-pressure
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }

            CompletableFuture<Void> future = CompletableFuture.runAsync(() -> {
                try {
                    for (T item : chunk) {
                        try {
                            R result = transformer.apply(item);
                            results.add(result);
                        } catch (Exception e) {
                            failedItems.incrementAndGet();
                        }
                    }
                    int done = completedChunks.incrementAndGet();
                    System.out.printf("\rProgress: %d/%d chunks (%.1f%%)    ",
                            done, totalChunks, 100.0 * done / totalChunks);
                } finally {
                    semaphore.release();
                }
            }, executor);

            futures.add(future);
        }

        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();

        System.out.printf("%nCompleted: %d items processed, %d failed%n",
                results.size(), failedItems.get());
        return results;
    }

    public void shutdown() {
        executor.shutdown();
    }

    public static void main(String[] args) {
        List<Integer> data = new ArrayList<>();
        for (int i = 0; i < 10_000; i++) data.add(i);

        ChunkedParallelProcessor<Integer, String> processor =
                new ChunkedParallelProcessor<>(500, 4);

        List<String> results = processor.process(data, num -> {
            if (num % 1000 == 999) {
                throw new RuntimeException("Bad number: " + num);
            }
            return "Result_" + (num * 2);
        });

        System.out.println("Total results: " + results.size());
        processor.shutdown();
    }
}
```

</details>

---

### Task 10: Safepoint-Aware Loop

**Type:** Code + Performance

**Goal:** Demonstrate the safepoint issue with counted loops and implement a fix.

**Requirements:**
- Create a tight counted loop that causes high TTSP
- Measure GC pause time impact
- Implement a fix using manual safepoint injection
- Compare TTSP before and after

<details>
<summary>Solution</summary>

```java
public class SafepointDemo {

    // Problem: counted loop with no safepoint
    public static long problematicLoop(int[] data) {
        long sum = 0;
        for (int i = 0; i < data.length; i++) { // Counted — no safepoint
            sum += data[i];
            // Simulate work
            sum ^= (sum << 3);
        }
        return sum;
    }

    // Fix: break into chunks with safepoint opportunities
    public static long safepointFriendlyLoop(int[] data) {
        long sum = 0;
        int chunkSize = 100_000; // Process in chunks

        for (int chunk = 0; chunk < data.length; chunk += chunkSize) {
            int end = Math.min(chunk + chunkSize, data.length);
            for (int i = chunk; i < end; i++) {
                sum += data[i];
                sum ^= (sum << 3);
            }
            // Between chunks: method return creates a safepoint opportunity
        }
        return sum;
    }

    // Alternative fix: use long counter (non-counted)
    public static long longCounterLoop(int[] data) {
        long sum = 0;
        for (long i = 0; i < data.length; i++) { // Non-counted — has safepoint
            sum += data[(int) i];
            sum ^= (sum << 3);
        }
        return sum;
    }

    public static void main(String[] args) {
        int[] data = new int[100_000_000];
        for (int i = 0; i < data.length; i++) data[i] = i;

        // Run with: java -Xlog:safepoint=info SafepointDemo
        System.out.println("Starting problematic loop...");
        long result1 = problematicLoop(data);

        System.out.println("Starting safepoint-friendly loop...");
        long result2 = safepointFriendlyLoop(data);

        System.out.println("Starting long-counter loop...");
        long result3 = longCounterLoop(data);

        System.out.printf("Results: %d, %d, %d%n", result1, result2, result3);
    }
}
```

</details>

---

## Questions

**1. What is the time complexity of iterating a `LinkedList` using `get(i)` in a for loop?**

<details>
<summary>Answer</summary>

O(n^2) — each `get(i)` call traverses from the head, costing O(n). Over n iterations, total is O(n^2). Use `for-each` or `Iterator` for O(n).

</details>

**2. Why does `for (;;)` compile to the same bytecode as `while (true)`?**

<details>
<summary>Answer</summary>

Both compile to a simple `goto` instruction back to the loop body. There is no condition to evaluate — the compiler recognizes both as unconditional loops.

</details>

**3. What is the maximum number of times a `for-each` loop can throw `ConcurrentModificationException`?**

<details>
<summary>Answer</summary>

Once — the first detected modification throws the exception and the loop terminates. The check happens inside `Iterator.next()`, so it occurs at most once per call to `next()`.

</details>

**4. Can you use `break` inside a `Stream.forEach()`?**

<details>
<summary>Answer</summary>

No — `break` and `continue` are loop-specific statements. Inside a lambda, they are not allowed. You can simulate early exit with `Stream.takeWhile()` (Java 9+) or by throwing a custom exception (not recommended).

</details>

**5. What happens if you call `iterator.remove()` twice without calling `next()` in between?**

<details>
<summary>Answer</summary>

`IllegalStateException` — `remove()` can only be called once per `next()` call. The iterator tracks whether `next()` has been called since the last `remove()`.

</details>

**6. Why is `removeIf()` preferred over manual iterator removal?**

<details>
<summary>Answer</summary>

`removeIf()` is more concise, less error-prone (no manual iterator management), and for `ArrayList` it is optimized — it shifts elements in bulk rather than one at a time.

</details>

**7. What is the performance impact of autoboxing in a loop?**

<details>
<summary>Answer</summary>

Each autoboxing operation creates an `Integer` object (or uses cache for -128 to 127). For 1M iterations, this creates ~1M short-lived objects, increasing GC pressure. Use primitive arrays (`int[]`) or `IntStream` to avoid it.

</details>

**8. How do you iterate over a `Map` using a for-each loop?**

<details>
<summary>Answer</summary>

```java
for (Map.Entry<String, Integer> entry : map.entrySet()) {
    String key = entry.getKey();
    Integer value = entry.getValue();
}
```

You cannot iterate over a `Map` directly — use `entrySet()`, `keySet()`, or `values()`.

</details>

---

## Mini Projects

### Mini Project: Log File Analyzer

**Goal:** Build a command-line tool that reads log files and produces statistics.

**Requirements:**
- Read a log file line by line using a `while` loop with `BufferedReader`
- Parse each line to extract: timestamp, log level (INFO, WARN, ERROR), message
- Count occurrences of each log level
- Find the most common error message
- Support multiple files (iterate with `for-each` over command-line arguments)
- Print a summary report

**Bonus:**
- Process files in parallel using threads
- Add a `--top N` flag to show top N error messages
- Support gzipped log files

<details>
<summary>Solution Skeleton</summary>

```java
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.regex.*;

public class LogAnalyzer {
    private final Map<String, Integer> levelCounts = new LinkedHashMap<>();
    private final Map<String, Integer> errorMessages = new HashMap<>();
    private int totalLines = 0;

    private static final Pattern LOG_PATTERN =
            Pattern.compile("^\\[(\\d{4}-\\d{2}-\\d{2})\\]\\s+(INFO|WARN|ERROR)\\s+(.+)$");

    public void analyzeFile(Path path) throws IOException {
        try (BufferedReader reader = Files.newBufferedReader(path)) {
            String line;
            while ((line = reader.readLine()) != null) {
                totalLines++;
                Matcher matcher = LOG_PATTERN.matcher(line);
                if (matcher.matches()) {
                    String level = matcher.group(2);
                    String message = matcher.group(3);

                    levelCounts.merge(level, 1, Integer::sum);

                    if ("ERROR".equals(level)) {
                        errorMessages.merge(message, 1, Integer::sum);
                    }
                }
            }
        }
    }

    public void printReport() {
        System.out.println("=== Log Analysis Report ===");
        System.out.println("Total lines: " + totalLines);
        System.out.println("\nLog levels:");
        for (Map.Entry<String, Integer> entry : levelCounts.entrySet()) {
            System.out.printf("  %s: %d%n", entry.getKey(), entry.getValue());
        }

        System.out.println("\nTop 5 error messages:");
        errorMessages.entrySet().stream()
                .sorted(Map.Entry.<String, Integer>comparingByValue().reversed())
                .limit(5)
                .forEach(e -> System.out.printf("  [%d] %s%n", e.getValue(), e.getKey()));
    }

    public static void main(String[] args) throws IOException {
        if (args.length == 0) {
            System.out.println("Usage: java LogAnalyzer <file1> [file2] ...");
            return;
        }

        LogAnalyzer analyzer = new LogAnalyzer();
        for (String arg : args) {
            Path path = Path.of(arg);
            if (Files.exists(path)) {
                System.out.println("Analyzing: " + path);
                analyzer.analyzeFile(path);
            } else {
                System.err.println("File not found: " + path);
            }
        }
        analyzer.printReport();
    }
}
```

</details>

---

## Challenge

### Challenge: Build a CSV Query Engine

**Difficulty:** Hard

**Goal:** Build a simple query engine that reads CSV files and supports filtering, sorting, and aggregation — all implemented using loops (no Stream API allowed).

**Requirements:**

1. **Parse CSV:** Read a CSV file line-by-line, handling quoted fields and commas within quotes
2. **SELECT columns:** Choose which columns to display
3. **WHERE clause:** Filter rows based on conditions (equals, greater than, contains)
4. **ORDER BY:** Sort results by a column (ascending/descending)
5. **GROUP BY + COUNT/SUM/AVG:** Aggregate functions
6. **LIMIT:** Return only first N rows

**Example usage:**
```
Query: SELECT name, age WHERE age > 25 ORDER BY age DESC LIMIT 10
Input: employees.csv
```

**Constraints:**
- No Stream API — use only loops
- Handle files with 100,000+ rows efficiently
- Use `StringBuilder` for output formatting (no string concatenation in loops)
- Implement proper error handling for malformed CSV

<details>
<summary>Solution Skeleton</summary>

```java
import java.io.*;
import java.nio.file.*;
import java.util.*;

public class CsvQueryEngine {

    private List<String> headers;
    private List<String[]> rows;

    public void load(String filePath) throws IOException {
        rows = new ArrayList<>();
        try (BufferedReader reader = Files.newBufferedReader(Path.of(filePath))) {
            String line = reader.readLine();
            if (line != null) {
                headers = Arrays.asList(parseCsvLine(line));
            }

            while ((line = reader.readLine()) != null) {
                rows.add(parseCsvLine(line));
            }
        }
        System.out.printf("Loaded %d rows, %d columns%n", rows.size(), headers.size());
    }

    private String[] parseCsvLine(String line) {
        List<String> fields = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean inQuotes = false;

        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (c == '"') {
                inQuotes = !inQuotes;
            } else if (c == ',' && !inQuotes) {
                fields.add(current.toString().trim());
                current.setLength(0);
            } else {
                current.append(c);
            }
        }
        fields.add(current.toString().trim());
        return fields.toArray(new String[0]);
    }

    public List<String[]> query(List<String> selectCols,
                                 String whereCol, String whereOp, String whereVal,
                                 String orderByCol, boolean ascending,
                                 int limit) {
        // Step 1: WHERE filter
        List<String[]> filtered = new ArrayList<>();
        int whereIdx = whereCol != null ? headers.indexOf(whereCol) : -1;

        for (String[] row : rows) {
            if (whereIdx == -1 || matchesCondition(row[whereIdx], whereOp, whereVal)) {
                filtered.add(row);
            }
        }

        // Step 2: ORDER BY (insertion sort for simplicity)
        if (orderByCol != null) {
            int orderIdx = headers.indexOf(orderByCol);
            filtered.sort((a, b) -> {
                int cmp = compareValues(a[orderIdx], b[orderIdx]);
                return ascending ? cmp : -cmp;
            });
        }

        // Step 3: LIMIT
        List<String[]> result = new ArrayList<>();
        int count = 0;
        for (String[] row : filtered) {
            if (limit > 0 && count >= limit) break;
            result.add(row);
            count++;
        }

        // Step 4: SELECT projection
        int[] selectIndices = new int[selectCols.size()];
        for (int i = 0; i < selectCols.size(); i++) {
            selectIndices[i] = headers.indexOf(selectCols.get(i));
        }

        List<String[]> projected = new ArrayList<>();
        for (String[] row : result) {
            String[] projectedRow = new String[selectIndices.length];
            for (int i = 0; i < selectIndices.length; i++) {
                projectedRow[i] = selectIndices[i] >= 0 ? row[selectIndices[i]] : "N/A";
            }
            projected.add(projectedRow);
        }

        return projected;
    }

    private boolean matchesCondition(String value, String op, String target) {
        switch (op) {
            case "=": return value.equals(target);
            case ">": return compareValues(value, target) > 0;
            case "<": return compareValues(value, target) < 0;
            case "contains": return value.contains(target);
            default: return true;
        }
    }

    private int compareValues(String a, String b) {
        try {
            return Double.compare(Double.parseDouble(a), Double.parseDouble(b));
        } catch (NumberFormatException e) {
            return a.compareTo(b);
        }
    }

    public void printResults(List<String> headers, List<String[]> results) {
        StringBuilder sb = new StringBuilder();
        // Header
        for (int i = 0; i < headers.size(); i++) {
            if (i > 0) sb.append(" | ");
            sb.append(String.format("%-15s", headers.get(i)));
        }
        sb.append('\n');
        // Separator
        for (int i = 0; i < headers.size(); i++) {
            if (i > 0) sb.append("-+-");
            sb.append("---------------");
        }
        sb.append('\n');
        // Rows
        for (String[] row : results) {
            for (int i = 0; i < row.length; i++) {
                if (i > 0) sb.append(" | ");
                sb.append(String.format("%-15s", row[i]));
            }
            sb.append('\n');
        }
        System.out.println(sb);
    }
}
```

</details>
