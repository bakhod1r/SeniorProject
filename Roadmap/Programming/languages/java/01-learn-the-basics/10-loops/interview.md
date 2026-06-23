# Loops — Interview Questions

## Table of Contents

1. [Junior Level](#junior-level)
2. [Middle Level](#middle-level)
3. [Senior Level](#senior-level)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level

### 1. What are the four types of loops in Java? When would you use each?

**Answer:**

1. **`for` loop** — when you know the number of iterations in advance (e.g., iterating from 0 to n)
2. **`while` loop** — when the number of iterations is unknown and depends on a runtime condition (e.g., reading until EOF)
3. **`do-while` loop** — same as `while`, but guarantees at least one execution (e.g., menu prompt)
4. **Enhanced `for-each` loop** — for iterating over arrays or collections when you do not need the index

```java
// for — known count
for (int i = 0; i < 10; i++) { }

// while — unknown count
while (scanner.hasNext()) { }

// do-while — at least once
do { input = scanner.nextLine(); } while (!input.equals("quit"));

// for-each — collections
for (String name : names) { }
```

---

### 2. What is the difference between `break` and `continue`?

**Answer:**
- `break` immediately exits the **entire loop**. No more iterations are executed.
- `continue` skips the **rest of the current iteration** and jumps to the next one.

```java
for (int i = 0; i < 10; i++) {
    if (i == 3) continue; // Skips 3, continues with 4
    if (i == 7) break;    // Exits loop at 7
    System.out.print(i + " "); // Prints: 0 1 2 4 5 6
}
```

Both only affect the **innermost** loop. To affect an outer loop, use labeled `break`/`continue`.

---

### 3. What happens if you modify a `List` inside a `for-each` loop?

**Answer:**
You get a `ConcurrentModificationException`. The enhanced for-each loop uses an `Iterator` internally, and the iterator checks for structural modifications via the `modCount` field.

```java
List<String> list = new ArrayList<>(List.of("a", "b", "c"));
for (String s : list) {
    list.remove(s); // Throws ConcurrentModificationException!
}
```

**Safe alternatives:**
- Use `Iterator.remove()`
- Use `list.removeIf(predicate)` (Java 8+)
- Use a reverse index loop for `ArrayList`

---

### 4. What is an infinite loop? How can you create one intentionally?

**Answer:**
An infinite loop is a loop whose condition never becomes false. It runs until the program is forcefully stopped or a `break` statement is reached.

```java
// Intentional infinite loops:
while (true) { /* event loop */ }
for (;;) { /* server loop */ }

// Both are equivalent — the JVM generates identical bytecode (goto)
```

Infinite loops are used intentionally in server event loops, message consumers, and game loops. Always include a `break` condition or shutdown mechanism.

---

### 5. Can you declare multiple variables in a `for` loop header?

**Answer:**
Yes, but only variables of the **same type** can be declared in the initialization part. Multiple updates are also allowed, separated by commas.

```java
// ✅ Valid — same type
for (int i = 0, j = 10; i < j; i++, j--) {
    System.out.println(i + " " + j);
}

// ❌ Invalid — different types
// for (int i = 0, long j = 10; ...) — compile error
```

---

### 6. What is the output of the following code?

```java
for (int i = 0; i < 5; i++);
System.out.println(i);
```

**Answer:**
This code does **not compile**. The semicolon after `for (...)` makes the loop body empty. After the loop, the variable `i` is out of scope because it was declared in the `for` header. The compiler reports: "cannot find symbol: variable i".

If `i` were declared before the loop (`int i; for (i = 0; i < 5; i++);`), it would print `5`.

---

### 7. What is the difference between `while` and `do-while`?

**Answer:**

| Aspect | `while` | `do-while` |
|--------|---------|-----------|
| Condition check | Before each iteration | After each iteration |
| Minimum executions | 0 (may never run) | 1 (always runs once) |
| Syntax | `while (cond) { }` | `do { } while (cond);` |
| Common use | General-purpose | Input validation, menu loops |

```java
int x = 10;
while (x < 5) { System.out.println("while"); }   // Prints nothing
do { System.out.println("do-while"); } while (x < 5); // Prints once
```

---

## Middle Level

### 8. How does the enhanced `for-each` loop work internally for arrays vs collections?

**Answer:**

For **arrays**, the compiler generates equivalent code to a classic indexed `for` loop:

```java
// for (int n : arr) { sum += n; }
// Compiles to:
int[] $arr = arr;
int $len = $arr.length;
for (int $i = 0; $i < $len; $i++) {
    int n = $arr[$i];
    sum += n;
}
```

For **collections** (any `Iterable`), it uses the `Iterator` protocol:

```java
// for (String s : list) { process(s); }
// Compiles to:
Iterator<String> $it = list.iterator();
while ($it.hasNext()) {
    String s = $it.next();
    process(s);
}
```

The array version is more efficient — no virtual dispatch, no autoboxing for primitives, no `modCount` checking.

---

### 9. When should you prefer a loop over the Stream API, and vice versa?

**Answer:**

**Prefer loops when:**
- You need `break`/`continue` with complex conditions
- The body has side effects (logging, updating external state)
- Checked exceptions are thrown in the body
- Performance is critical and you want to avoid Stream pipeline overhead
- You need mutable accumulators (e.g., building a complex object step by step)

**Prefer Streams when:**
- The operation is a pure filter-map-reduce pipeline
- You might benefit from `parallelStream()` (CPU-bound, large dataset)
- Readability improves with method chaining
- You are composing operations from reusable `Predicate`/`Function` objects

**Key nuance:** In JMH benchmarks, loops are typically 2-5x faster than streams for primitive operations due to autoboxing and pipeline overhead. But for I/O-bound or database-bound operations, the difference is negligible.

---

### 10. What is `ConcurrentModificationException` and how do you avoid it?

**Answer:**
`ConcurrentModificationException` is thrown when a collection is structurally modified during iteration (via an enhanced for-each loop or explicit iterator). It is a **fail-fast** mechanism, not a thread-safety guarantee.

**It happens in single-threaded code too:**

```java
List<String> list = new ArrayList<>(List.of("a", "b", "c"));
for (String s : list) {
    if (s.equals("b")) list.remove(s); // CME!
}
```

**Safe alternatives:**

```java
// 1. Iterator.remove()
Iterator<String> it = list.iterator();
while (it.hasNext()) {
    if (it.next().equals("b")) it.remove();
}

// 2. removeIf() — most idiomatic
list.removeIf(s -> s.equals("b"));

// 3. CopyOnWriteArrayList — for concurrent access
List<String> cowList = new CopyOnWriteArrayList<>(list);
for (String s : cowList) {
    if (s.equals("b")) cowList.remove(s); // Safe — iterates over snapshot
}

// 4. Collect and remove separately
List<String> toRemove = new ArrayList<>();
for (String s : list) {
    if (s.equals("b")) toRemove.add(s);
}
list.removeAll(toRemove);
```

---

### 11. What is the performance difference between iterating a `LinkedList` with `get(i)` vs `for-each`?

**Answer:**

| Approach | Time Complexity | Why |
|----------|----------------|-----|
| `for (int i=0; i<list.size(); i++) list.get(i)` | **O(n^2)** | `get(i)` traverses from head each time |
| `for (String s : list)` | **O(n)** | Iterator maintains a pointer to current node |

For 10,000 elements:
- Indexed loop: ~50 million node traversals
- For-each loop: ~10,000 node traversals

This is one of the most common performance anti-patterns in Java. Always use `for-each` or `Iterator` for `LinkedList`.

---

### 12. How do labeled `break` and `continue` work? Give a practical example.

**Answer:**
Labels are identifiers placed before a loop statement. `break label` exits the labeled loop, and `continue label` skips to the next iteration of the labeled loop.

**Practical example — searching a 2D structure:**

```java
String[][] matrix = {
    {"a", "b", "c"},
    {"d", "target", "f"},
    {"g", "h", "i"}
};

boolean found = false;
search:
for (int i = 0; i < matrix.length; i++) {
    for (int j = 0; j < matrix[i].length; j++) {
        if (matrix[i][j].equals("target")) {
            System.out.println("Found at [" + i + "][" + j + "]");
            found = true;
            break search; // Exits BOTH loops
        }
    }
}
```

Without `break search`, only the inner loop exits and the outer loop continues — wasting time.

---

### 13. Explain the `Iterable` interface and how to make a custom class work with `for-each`.

**Answer:**
A class works with `for-each` if it implements `Iterable<T>`, which requires a single method: `Iterator<T> iterator()`.

```java
public class Fibonacci implements Iterable<Long> {
    private final int count;

    public Fibonacci(int count) { this.count = count; }

    @Override
    public Iterator<Long> iterator() {
        return new Iterator<>() {
            private int index = 0;
            private long a = 0, b = 1;

            @Override
            public boolean hasNext() { return index < count; }

            @Override
            public Long next() {
                if (!hasNext()) throw new NoSuchElementException();
                long result = a;
                long temp = a + b;
                a = b;
                b = temp;
                index++;
                return result;
            }
        };
    }
}

// Usage:
for (long fib : new Fibonacci(10)) {
    System.out.print(fib + " "); // 0 1 1 2 3 5 8 13 21 34
}
```

---

## Senior Level

### 14. What are "counted loops" in the JVM, and why do they matter for GC latency?

**Answer:**
A counted loop is one where the C2 JIT compiler can determine:
1. The loop variable is `int` (not `long`)
2. The stride is constant (usually +1 or -1)
3. The loop limit is loop-invariant

**Why it matters:** The JVM does **not** insert safepoint polls at the back-edge of counted loops. This means GC cannot pause the thread until the loop completes. For loops with millions of iterations, this can cause Time-To-Safepoint (TTSP) delays of hundreds of milliseconds — unacceptable for low-latency systems.

**Detection:**
```bash
java -Xlog:safepoint=info -jar app.jar
# Look for: "TTSP: 500ms" — indicates a long-running counted loop
```

**Mitigation:**
- Use `long` as the loop counter (makes it non-counted)
- Use `-XX:+UseCountedLoopSafepoints` (JDK 17+)
- Break long loops into chunks

---

### 15. How does the JIT compiler optimize array bounds checks in loops?

**Answer:**
The C2 compiler performs **range check elimination** by proving that the array index is always within bounds:

1. The compiler detects that `i` starts at 0 and increments by 1
2. The loop condition is `i < arr.length`
3. Therefore `0 <= i < arr.length` for all iterations
4. The bounds check before `arr[i]` is removed

This transforms:
```java
// Before optimization (conceptual):
if (i < 0 || i >= arr.length) throw new AIOOBE();
val = arr[i];

// After optimization:
val = arr[i]; // Direct memory access — no check
```

**When it fails:**
- The index expression is complex: `arr[i * 2 + offset]`
- The loop counter is not obviously bounded
- The array reference might change during the loop (aliasing)

In those cases, the bounds check remains, costing ~1 extra branch per access.

---

### 16. What is loop tiling and when would you use it?

**Answer:**
Loop tiling (or loop blocking) restructures nested loops to process data in small blocks that fit in the CPU's L1/L2 cache, improving cache hit rates.

```java
// Standard matrix multiply — cache-hostile for B
for (int i = 0; i < N; i++)
    for (int j = 0; j < N; j++)
        for (int k = 0; k < N; k++)
            C[i][j] += A[i][k] * B[k][j]; // B accessed column-wise

// Tiled version — cache-friendly
int T = 64;
for (int ii = 0; ii < N; ii += T)
    for (int jj = 0; jj < N; jj += T)
        for (int kk = 0; kk < N; kk += T)
            for (int i = ii; i < Math.min(ii+T, N); i++)
                for (int j = jj; j < Math.min(jj+T, N); j++)
                    for (int k = kk; k < Math.min(kk+T, N); k++)
                        C[i][j] += A[i][k] * B[k][j];
```

**When to use:** Matrix operations, image processing, any nested loop with large 2D data where inner loop accesses are not sequential.

**Typical improvement:** 3-10x for large matrices (1000x1000+).

---

### 17. How does escape analysis affect objects allocated inside loops?

**Answer:**
When an object is created inside a loop and does not "escape" (not stored in a field, not returned, not passed to a non-inlined method), the C2 JIT applies:

1. **Scalar replacement** — object fields become stack-local variables
2. **Allocation elimination** — no `new` instruction in compiled code
3. **Lock elision** — if the object had synchronized methods, the locks are removed

```java
for (int i = 0; i < 1_000_000; i++) {
    Point p = new Point(i, i * 2);  // Escape analysis proves p is local
    sum += p.getX() + p.getY();     // After optimization: sum += i + i * 2
}
// Zero heap allocations — Point never actually created on heap
```

**When escape analysis fails:**
- The object is stored in a collection: `list.add(new Point(...))`
- The method called with the object is too large to inline
- The object type is polymorphic (interface with multiple implementations)

---

### 18. Explain the difference between `parallelStream()` and manually parallelizing a loop.

**Answer:**

| Aspect | `parallelStream()` | Manual parallelization |
|--------|-------------------|----------------------|
| Thread pool | `ForkJoinPool.commonPool()` (shared!) | Dedicated `ExecutorService` |
| Granularity | Auto-split via `Spliterator` | Developer chooses chunk size |
| Exception handling | Wraps in `CompletionException` | Full control |
| Blocking operations | Starves common pool | Isolated pool |
| Backpressure | None | Can use bounded queue |

**The hidden danger:**
```java
// All requests share the same ForkJoinPool.commonPool()
// One slow parallelStream() blocks other parallelStream() calls
items.parallelStream()
    .map(item -> slowDatabaseCall(item)) // Blocks common pool threads!
    .collect(Collectors.toList());
```

**Safer approach:**
```java
ForkJoinPool customPool = new ForkJoinPool(4);
customPool.submit(() ->
    items.parallelStream()
        .map(item -> slowDatabaseCall(item))
        .collect(Collectors.toList())
).get();
```

---

### 19. What is false sharing and how can it affect parallel loops?

**Answer:**
False sharing occurs when two threads write to different variables that happen to reside on the same CPU cache line (typically 64 bytes). Each write invalidates the other thread's cached copy, causing constant cache line bouncing.

```java
// ❌ False sharing — adjacent int fields share a cache line
int[] counters = new int[numThreads]; // All 4 bytes apart

// Thread 0 writes counters[0], Thread 1 writes counters[1]
// Both are on the same 64-byte cache line → contention

// ✅ Padded — each counter on its own cache line
@Contended  // JDK internal annotation
long[] counters = new long[numThreads]; // + padding

// Or manually: counters[threadId * 16] (16 longs = 128 bytes apart)
```

**Impact:** False sharing can make parallel loops **slower** than single-threaded execution. Detection requires hardware counters (`perf c2c`) or JMH with varying thread counts.

---

## Scenario-Based Questions

### 20. Your application processes 10 million records from a database. The loop takes 5 minutes. How do you optimize it?

**Answer:**

Step-by-step approach:

1. **Profile first:** Use async-profiler to identify the bottleneck (CPU? I/O? GC?)
2. **Batch fetching:** Use cursor-based pagination (`WHERE id > last_id LIMIT 1000`) instead of loading all 10M records into memory
3. **Reduce per-iteration work:**
   - Avoid creating objects inside the loop (reuse buffers)
   - Pre-compile regex patterns, cache computed values
4. **Parallelize if CPU-bound:**
   - Use `CompletableFuture` with a fixed thread pool
   - Process batches in parallel: `executor.submit(() -> processBatch(chunk))`
5. **Use bulk operations:**
   - Batch inserts (`INSERT INTO ... VALUES (...), (...), (...)`)
   - Use `PreparedStatement.addBatch()` / `executeBatch()`
6. **Monitor GC:**
   - If GC pauses are frequent, increase young generation size
   - Use ZGC or Shenandoah for low-pause requirements

---

### 21. A junior developer wrote a loop that uses `list.get(i)` over a `LinkedList` of 100,000 elements. Users report slow performance. How do you diagnose and fix it?

**Answer:**

**Diagnosis:**
1. Check the collection type — if it is `LinkedList`, `get(i)` is O(n) per call
2. Total complexity: O(n^2) = 10 billion operations for 100K elements
3. Use a profiler to confirm the loop is the bottleneck

**Fix (in order of preference):**

```java
// 1. Change to for-each (O(n) total)
for (String item : list) { process(item); }

// 2. Change collection type to ArrayList (O(1) random access)
List<String> arrayList = new ArrayList<>(linkedList);
for (int i = 0; i < arrayList.size(); i++) { ... }

// 3. Use ListIterator if index is needed
ListIterator<String> it = list.listIterator();
while (it.hasNext()) {
    int index = it.nextIndex();
    String item = it.next();
    // ...
}
```

**Code review prevention:** Add a static analysis rule (SpotBugs/ErrorProne) to flag `LinkedList.get(int)` inside loops.

---

### 22. Your team argues about using `for` loops vs `Stream.forEach()` everywhere. How do you resolve this?

**Answer:**

1. **Establish team guidelines:** Create a decision matrix:
   - Pure transformations → Streams
   - Side effects → Loops
   - Performance-critical → Loops (with JMH evidence)
   - Complex control flow (`break`/`continue`) → Loops

2. **Back claims with data:** Run JMH benchmarks on representative scenarios
   - Small collections (<100 elements): loop is 2-5x faster
   - Large collections with parallelism potential: stream may win

3. **Avoid `Stream.forEach()` for side effects:**
   ```java
   // ❌ Anti-pattern — forEach with side effects
   list.stream().forEach(item -> {
       counter++;  // Modifying external state — breaks Stream contract
       results.add(transform(item));
   });

   // ✅ Use collect() for accumulation
   List<Result> results = list.stream()
       .map(this::transform)
       .collect(Collectors.toList());
   ```

4. **Agree on consistency:** Within a single method, do not mix styles randomly.

---

### 23. You notice GC pauses of 800ms in your application. You suspect a loop is causing high TTSP. How do you investigate?

**Answer:**

1. **Enable safepoint logging:**
   ```bash
   java -Xlog:safepoint=info -jar app.jar
   # Look for: "TTSP: 800ms"
   ```

2. **Identify the offending thread:**
   - Thread dump during the pause shows which thread has not reached safepoint
   - The thread is likely running a counted loop (int counter, no calls)

3. **Find the loop:**
   - Use async-profiler in CPU mode to identify the hottest method
   - Look for tight loops with `int` counters and no method calls inside

4. **Fix options:**
   ```java
   // Option A: Use long counter (non-counted → safepoint polls inserted)
   for (long i = 0; i < N; i++) { ... }

   // Option B: JVM flag (JDK 17+)
   -XX:+UseCountedLoopSafepoints

   // Option C: Manual safepoint injection
   for (int i = 0; i < N; i++) {
       if (i % 100_000 == 0) Thread.yield(); // Forces safepoint check
       ...
   }
   ```

---

### 24. Design a loop-based ETL pipeline that processes 1TB of log files. What are the key concerns?

**Answer:**

**Architecture:**
```java
public class LogETLPipeline {
    private static final int BUFFER_SIZE = 8 * 1024 * 1024; // 8MB read buffer
    private static final int BATCH_SIZE = 10_000;

    public void process(Path logDir) throws Exception {
        ExecutorService writers = Executors.newFixedThreadPool(4);
        List<Path> files = Files.list(logDir).collect(Collectors.toList());

        for (Path file : files) {
            try (BufferedReader reader = Files.newBufferedReader(file,
                    StandardCharsets.UTF_8)) {
                List<LogEntry> batch = new ArrayList<>(BATCH_SIZE);
                String line;

                while ((line = reader.readLine()) != null) {
                    LogEntry entry = parse(line);
                    if (entry != null) {
                        batch.add(entry);
                    }

                    if (batch.size() >= BATCH_SIZE) {
                        List<LogEntry> toWrite = batch;
                        batch = new ArrayList<>(BATCH_SIZE);
                        writers.submit(() -> writeBatch(toWrite));
                    }
                }

                if (!batch.isEmpty()) {
                    writers.submit(() -> writeBatch(batch));
                }
            }
        }
        writers.shutdown();
        writers.awaitTermination(1, TimeUnit.HOURS);
    }
}
```

**Key concerns:**
1. **Memory:** Buffer size controls memory usage; never load entire files
2. **GC:** Reuse batch lists; avoid String concatenation inside the parse loop
3. **I/O:** Use `BufferedReader` with large buffer; consider `MappedByteBuffer` for random access
4. **Parallelism:** Separate reading (I/O-bound) from writing (CPU/I/O-bound) with dedicated thread pools
5. **Error handling:** Log and skip bad lines; do not let one corrupted file stop the pipeline
6. **Progress tracking:** Log every N batches; allow resume from last checkpoint

---

## FAQ

### Q: Is `for-each` slower than a classic `for` loop?

**A:** For arrays, they compile to identical bytecode — no difference. For `ArrayList`, the for-each is equivalent (the JIT inlines the iterator). For `LinkedList`, for-each is **much faster** than indexed `for` because `get(i)` is O(n). In general, prefer `for-each` unless you need the index.

### Q: Should I always use `parallelStream()` for large collections?

**A:** No. `parallelStream()` uses the shared `ForkJoinPool.commonPool()`, which can cause thread starvation under load. It only helps for **CPU-bound** operations on large datasets (>10,000 elements). For I/O-bound operations (database, network), use explicit `ExecutorService` with a dedicated thread pool.

### Q: What do interviewers look for when asking about loops in Java?

**A:** Key evaluation criteria:
- **Junior:** Correct syntax, understanding of `break`/`continue`, ability to trace loop output
- **Middle:** Knowledge of `Iterator` protocol, `ConcurrentModificationException`, loop vs Stream trade-offs, `LinkedList.get(i)` anti-pattern
- **Senior:** JVM safepoint interaction, JIT optimizations (range check elimination, unrolling), cache effects, benchmarking with JMH, architectural patterns (event loop, batch processing)

### Q: Can a `for-each` loop iterate in reverse?

**A:** Not directly. The enhanced for-each always iterates forward using `Iterator`. For reverse iteration, use:

```java
// ArrayList — reverse indexed loop
for (int i = list.size() - 1; i >= 0; i--) { ... }

// Any List — ListIterator from end
ListIterator<String> it = list.listIterator(list.size());
while (it.hasPrevious()) { String s = it.previous(); }

// Java 21+ — reversed() view
for (String s : list.reversed()) { ... }
```

### Q: How do you prevent infinite loops in production?

**A:** Add safety mechanisms:
1. **Max iteration count:** `for (int i = 0; i < MAX_ITERATIONS; i++)`
2. **Timeout:** Check elapsed time in the loop body
3. **Thread interruption:** Check `Thread.currentThread().isInterrupted()`
4. **Circuit breaker pattern:** Track failures and stop after threshold
5. **Watchdog thread:** Monitor long-running loops from outside
