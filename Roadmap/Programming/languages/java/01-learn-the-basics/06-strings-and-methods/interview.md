# Strings and Methods — Interview Questions

---

## Junior Level (5-7 Questions)

### Q1: What is the difference between `==` and `.equals()` for Strings?

<details>
<summary>Answer</summary>

- `==` compares **references** (memory addresses) — checks if two variables point to the same object
- `.equals()` compares **content** — checks if two strings contain the same characters

```java
String a = "Hello";
String b = new String("Hello");

System.out.println(a == b);       // false — different objects
System.out.println(a.equals(b));  // true  — same content
```

**Always use `.equals()` for String content comparison.**
</details>

### Q2: What does it mean that Strings are immutable?

<details>
<summary>Answer</summary>

Immutability means once a String object is created, its value cannot be changed. Every method that appears to modify a String (like `toUpperCase()`, `replace()`, `concat()`) actually creates and returns a **new** String object.

```java
String s = "hello";
s.toUpperCase();           // creates "HELLO" but s is still "hello"
s = s.toUpperCase();       // now s points to "HELLO"
```

**Benefits of immutability:**
- Thread-safe without synchronization
- Safe to use as HashMap keys
- Enables the String Pool optimization
- Prevents accidental modification of shared data
</details>

### Q3: What is the String Pool?

<details>
<summary>Answer</summary>

The String Pool (String Intern Pool) is a special area in the Java heap where the JVM stores unique string literals. When you create a string literal, the JVM checks the pool first:
- If the same string exists, it returns a reference to the existing object
- If not, it creates a new string in the pool

```java
String a = "Hello";  // creates in pool
String b = "Hello";  // reuses from pool
System.out.println(a == b);  // true — same pool object
```

This saves memory when the same string value is used in multiple places.
</details>

### Q4: What is the difference between `String`, `StringBuilder`, and `StringBuffer`?

<details>
<summary>Answer</summary>

| Feature | String | StringBuilder | StringBuffer |
|---------|--------|---------------|-------------|
| Mutability | Immutable | Mutable | Mutable |
| Thread-safe | Yes (immutable) | No | Yes (synchronized) |
| Performance | Slow for concatenation | Fast | Slower than StringBuilder |
| When to use | Fixed text | Building strings (single thread) | Building strings (multi-thread) |

```java
// StringBuilder — fast, not thread-safe
StringBuilder sb = new StringBuilder();
sb.append("Hello").append(" World");

// StringBuffer — slower, thread-safe
StringBuffer sbuf = new StringBuffer();
sbuf.append("Hello").append(" World");
```
</details>

### Q5: How many String objects are created by `new String("Hello")`?

<details>
<summary>Answer</summary>

**1 or 2 objects:**

1. If `"Hello"` is **not** already in the String Pool, **2 objects** are created:
   - One in the String Pool (from the literal `"Hello"`)
   - One on the heap (from the `new` keyword)

2. If `"Hello"` is **already** in the pool, **1 object** is created:
   - Only the heap object (the pool already has it)

The `new` keyword **always** creates a new object on the heap, regardless of the pool.
</details>

### Q6: What does `intern()` do?

<details>
<summary>Answer</summary>

`intern()` returns the String Pool reference for a given string:
- If the string is already in the pool, it returns the existing reference
- If not, it adds the string to the pool and returns the new reference

```java
String s1 = new String("Hello");
String s2 = s1.intern();
String s3 = "Hello";

System.out.println(s1 == s3);  // false — s1 is on heap
System.out.println(s2 == s3);  // true  — both from pool
```
</details>

### Q7: What is the output of this code?

```java
String s1 = "Hello";
String s2 = "Hel" + "lo";
String s3 = "Hel";
String s4 = s3 + "lo";

System.out.println(s1 == s2);
System.out.println(s1 == s4);
```

<details>
<summary>Answer</summary>

```
true
false
```

- `s1 == s2` is **true** because the compiler performs **constant folding** — `"Hel" + "lo"` is computed at compile time to `"Hello"`, referencing the same pool object.
- `s1 == s4` is **false** because `s3 + "lo"` involves a **variable**, so the concatenation happens at runtime, creating a new object on the heap.
</details>

---

## Middle Level (4-6 Questions)

### Q1: Explain Compact Strings in Java 9+.

<details>
<summary>Answer</summary>

Before Java 9, Strings used `char[]` internally (2 bytes per character). Java 9 introduced Compact Strings:

- Strings are now backed by `byte[]` instead of `char[]`
- A `coder` field indicates the encoding:
  - `LATIN1` (0): 1 byte per character — for strings with only ISO-8859-1 characters
  - `UTF16` (1): 2 bytes per character — for strings with characters outside Latin-1

**Impact:**
- ~50% memory reduction for ASCII-heavy applications (most real-world apps)
- No API changes — completely transparent to application code
- Can be disabled with `-XX:-CompactStrings` if it causes issues

```java
String ascii = "Hello";       // LATIN1: 5 bytes for data
String emoji = "Hello \uD83D\uDE00"; // UTF16: 14 bytes for data
```
</details>

### Q2: Why should you compile regex patterns as `static final` fields?

<details>
<summary>Answer</summary>

Methods like `String.matches()`, `String.split()`, and `String.replaceAll()` compile the regex pattern on **every call**. This is expensive:

```java
// ❌ Compiles regex 10,000 times
for (String line : lines) {
    if (line.matches("\\d{4}-\\d{2}-\\d{2}")) { ... }
}

// ✅ Compiles regex ONCE
private static final Pattern DATE_PATTERN = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");

for (String line : lines) {
    if (DATE_PATTERN.matcher(line).matches()) { ... }
}
```

**Performance difference:** Pre-compiled patterns are **5-10x faster** for repeated use because `Pattern.compile()` is expensive (involves NFA construction).
</details>

### Q3: How does `invokedynamic` improve String concatenation in Java 9+?

<details>
<summary>Answer</summary>

Java 8 compiled `a + b` to:
```java
new StringBuilder().append(a).append(b).toString()
```

Java 9+ compiles it to an `invokedynamic` call that delegates to `StringConcatFactory`. The factory chooses the optimal strategy at runtime:

1. **Pre-sizes the result buffer** based on known parts
2. **May skip StringBuilder entirely** — directly constructs the result `byte[]`
3. **Adapts to runtime conditions** — the strategy is bound once and reused

Benefits:
- Fewer intermediate objects (less GC pressure)
- Better performance (especially for simple concatenations)
- Future JVM versions can improve the strategy without recompiling code
</details>

### Q4: What is the difference between `trim()` and `strip()` in Java 11+?

<details>
<summary>Answer</summary>

| Method | Characters Removed | Java Version |
|--------|--------------------|-------------|
| `trim()` | ASCII whitespace only (chars <= `\u0020`) | Java 1.0+ |
| `strip()` | All Unicode whitespace (`Character.isWhitespace()`) | Java 11+ |

```java
String s = "\u2003Hello\u2003"; // Em-space (Unicode)
System.out.println(s.trim().equals("Hello"));   // false — trim doesn't recognize em-space
System.out.println(s.strip().equals("Hello"));   // true  — strip handles Unicode

// Also available:
" hello ".stripLeading();  // "hello "
" hello ".stripTrailing(); // " hello"
```

**Best practice:** Always use `strip()` in Java 11+ for correct Unicode handling.
</details>

### Q5: Explain String deduplication in G1 GC.

<details>
<summary>Answer</summary>

G1 GC String deduplication (enabled with `-XX:+UseStringDeduplication`) works by:

1. During young generation GC, the collector identifies String objects
2. It computes a hash of the String's internal `byte[]` array
3. If another String with the same content exists, both Strings are updated to share the same `byte[]` array
4. The duplicate `byte[]` becomes eligible for garbage collection

**Key points:**
- It deduplicates the underlying `byte[]`, not the String objects themselves
- Two String objects will still exist, but share one array
- It runs concurrently on a low-priority thread — no application pause
- Only targets young-gen strings (configurable with `-XX:StringDeduplicationAgeThreshold`)
- No API or behavior change — completely transparent

**When to use:** Applications with many duplicate strings loaded from external sources (databases, files, network).
</details>

### Q6: What are the security implications of storing passwords as Strings?

<details>
<summary>Answer</summary>

Strings are a **security risk for sensitive data** because:

1. **Immutability:** You cannot overwrite the contents — the password remains in memory until GC
2. **String Pool:** If interned, the password may persist for the entire JVM lifetime
3. **Heap dumps:** Memory dumps expose all string values in plain text
4. **Core dumps:** OS-level crashes can write heap contents to disk

**Best practice — use `char[]`:**

```java
// ❌ Password as String
String password = "secret123";
// Cannot clear! "secret123" stays in memory

// ✅ Password as char[]
char[] password = {'s','e','c','r','e','t','1','2','3'};
// ... authenticate ...
Arrays.fill(password, '\0'); // zero out after use
```

This is why `JPasswordField.getPassword()` returns `char[]`, not `String`.
</details>

---

## Senior Level (4-6 Questions)

### Q1: How would you architect a high-throughput text processing pipeline in Java?

<details>
<summary>Answer</summary>

Key architectural decisions:

1. **Decode late:** Keep data as `byte[]` or `ByteBuffer` as long as possible. Decode to String only when text operations are needed.

2. **Use `CharSequence` in APIs:** Accept `CharSequence` instead of `String` to allow callers to pass `StringBuilder`, `CharBuffer`, etc. without conversion.

3. **Pool builders:** Use `ThreadLocal<StringBuilder>` to reuse StringBuilder instances, reducing allocation pressure.

4. **Pre-size buffers:** Estimate output size and pre-allocate StringBuilder capacity.

5. **Process in chunks:** Stream large files line-by-line instead of loading into a single String.

6. **Intern selectively:** Only intern strings used as lookup keys with high repetition (e.g., column names, status codes), never user-generated content.

```java
// Example: thread-local StringBuilder pool
private static final ThreadLocal<StringBuilder> SB_POOL =
    ThreadLocal.withInitial(() -> new StringBuilder(4096));

public String transform(CharSequence input) {
    StringBuilder sb = SB_POOL.get();
    sb.setLength(0);
    // ... process ...
    return sb.toString();
}
```

7. **Monitor allocation:** Use JFR or async-profiler to identify String allocation hotspots. In many services, Strings are 30-50% of total allocations.
</details>

### Q2: Explain the Rope data structure and when you would use it over String.

<details>
<summary>Answer</summary>

A **Rope** is a balanced binary tree where leaf nodes contain short string fragments. It provides:

| Operation | String | Rope |
|-----------|--------|------|
| Concatenation | O(N) — copy entire array | O(1) — create new branch node |
| Insertion at position | O(N) — shift and copy | O(log N) — split and rejoin |
| Deletion | O(N) — copy remaining | O(log N) — restructure tree |
| charAt | O(1) | O(log N) |
| toString | O(1) — return self | O(N) — traverse and collect |

**When to use Rope:**
- Text editors with frequent insert/delete operations
- Document processing systems
- Very large strings (MB+) with many modifications

**When NOT to use:**
- Small strings — overhead of tree structure exceeds benefit
- Read-heavy workloads — `charAt()` is O(log N) vs O(1)
- Applications that need the full String API
</details>

### Q3: How does the JIT compiler optimize String.equals()?

<details>
<summary>Answer</summary>

The HotSpot JIT compiler treats `String.equals()` as an **intrinsic** — replacing the bytecode with hand-tuned machine code:

1. **Reference check:** If `this == other`, return `true` immediately
2. **Type check:** If `other` is not a String, return `false`
3. **Length check:** Compare `value.length` (different lengths = not equal)
4. **Coder check:** Compare `coder` fields (LATIN1 vs UTF16 mismatch = not equal)
5. **Vectorized comparison:** Use SIMD instructions (SSE4.2 / AVX2) to compare 16-32 bytes at a time

On x86_64 with AVX2:
```assembly
; Compare 32 bytes at once
vmovdqu ymm0, [rdi+16]     ; load 32 bytes from string A
vpcmpeqb ymm0, [rsi+16]    ; compare with 32 bytes from string B
vpmovmskb eax, ymm0        ; extract comparison result
cmp eax, 0xFFFFFFFF         ; check all 32 bytes matched
```

This makes `equals()` significantly faster than the pure Java implementation, especially for long strings.
</details>

### Q4: What are the implications of StringTable sizing for application performance?

<details>
<summary>Answer</summary>

The `StringTable` is a hash table with a fixed number of buckets. Performance implications:

**Too small (default 65536 buckets):**
- Many hash collisions → long chains
- `intern()` degrades from O(1) to O(N) per lookup
- Constant pool resolution during class loading slows down

**Too large:**
- Wastes native memory
- Cache unfriendly if mostly empty

**Tuning approach:**

```bash
# 1. Profile current state
java -XX:+PrintStringTableStatistics MyApp
# Look at: average bucket size, maximum bucket size, variance

# 2. Set size to prime number ~2x entries
java -XX:StringTableSize=1000003 MyApp

# 3. For heavy interning (>100K entries):
java -XX:StringTableSize=10000019 MyApp
```

**Java 15+:** StringTable supports concurrent resizing, making manual tuning less critical.

**Key metric:** If maximum bucket size > 10, the table is too small.
</details>

### Q5: How would you diagnose and fix a memory issue caused by String retention?

<details>
<summary>Answer</summary>

**Diagnosis steps:**

1. **Heap dump analysis:**
   ```bash
   jmap -dump:live,format=b,file=heap.hprof <pid>
   # Open in Eclipse MAT or VisualVM
   # Look for: String dominator tree, retained size
   ```

2. **JFR allocation profiling:**
   ```bash
   java -XX:StartFlightRecording=filename=alloc.jfr,settings=profile MyApp
   # Analyze String allocation hotspots and call stacks
   ```

3. **String deduplication stats:**
   ```bash
   java -XX:+UseG1GC -XX:+UseStringDeduplication \
        -Xlog:stringdedup*=debug MyApp
   ```

**Common causes and fixes:**

| Cause | Fix |
|-------|-----|
| Substring holding reference to large parent string | Java 7+ fixed this; if using old libraries, copy with `new String(substring)` |
| Unbounded String cache | Use `WeakHashMap` or bounded cache (Caffeine) |
| Heavy interning of unique strings | Remove `intern()` calls, use application-level registry |
| Log message accumulation | Use parameterized logging, check log level before building |
| Large JSON/XML parsed to Strings | Stream-parse, avoid loading entire document as String |
</details>

---

## Scenario-Based Questions (3-5)

### Scenario 1: You notice your microservice has high memory usage. Heap dump shows 40% of heap is String objects with many duplicates. How do you fix this?

<details>
<summary>Answer</summary>

**Immediate actions:**
1. Enable G1 String Deduplication:
   ```bash
   java -XX:+UseG1GC -XX:+UseStringDeduplication MyApp
   ```
   This is zero-code-change and can reduce duplicate string memory by 20-40%.

2. Profile the source of duplicates:
   ```bash
   jfr print --events jdk.ObjectAllocationSample recording.jfr | grep String
   ```

**Code-level fixes based on source:**

- **Database queries returning repeated values:** Use a `StringRegistry` (ConcurrentHashMap-based canonicalization) for columns like status, country_code
- **JSON deserialization:** Configure Jackson to intern field names:
  ```java
  mapper.configure(JsonFactory.Feature.CANONICALIZE_FIELD_NAMES, true);
  ```
- **Logging:** Switch to parameterized logging, verify log levels

**Verify impact:**
```bash
java -XX:+PrintStringTableStatistics -Xlog:stringdedup*=info MyApp
```
</details>

### Scenario 2: Your REST API endpoint that generates CSV export is running out of memory for large datasets. The current code builds the entire CSV as a String before returning. How do you fix it?

<details>
<summary>Answer</summary>

**Problem:** Building a complete CSV String for 1M rows consumes gigabytes of heap.

**Solution: Stream the response instead of buffering:**

```java
@GetMapping(value = "/export", produces = "text/csv")
public ResponseEntity<StreamingResponseBody> exportCsv() {
    StreamingResponseBody stream = outputStream -> {
        BufferedWriter writer = new BufferedWriter(
            new OutputStreamWriter(outputStream, StandardCharsets.UTF_8));

        writer.write("id,name,email\n");

        // Stream from database in chunks
        try (Stream<User> users = userRepository.streamAll()) {
            users.forEach(user -> {
                try {
                    writer.write(user.getId() + "," +
                                 escape(user.getName()) + "," +
                                 escape(user.getEmail()) + "\n");
                    writer.flush(); // flush periodically
                } catch (IOException e) {
                    throw new UncheckedIOException(e);
                }
            });
        }
        writer.flush();
    };

    return ResponseEntity.ok()
        .header("Content-Disposition", "attachment; filename=export.csv")
        .body(stream);
}
```

**Key principles:**
- Never build the entire output as a String
- Stream data from the database (use `@QueryHints(@QueryHint(name = HINT_FETCH_SIZE, value = "1000"))`)
- Use `BufferedWriter` for efficient I/O
- Flush periodically to keep memory bounded
</details>

### Scenario 3: A developer on your team proposes using `String.intern()` for all user inputs to "save memory." What is your response?

<details>
<summary>Answer</summary>

**This is a bad idea.** Here is why:

1. **User inputs are mostly unique** — interning unique strings wastes memory (the pool keeps them forever) and adds lookup overhead (~800ns per `intern()` call for new strings)

2. **StringTable growth** — the intern pool has a fixed-size hash table. Flooding it with millions of unique strings causes:
   - Long hash chains → O(N) lookups instead of O(1)
   - Never garbage collected (weak refs are cleaned, but slowly)
   - Application-wide `intern()` calls slow down (global lock contention)

3. **Security risk** — interned user input persists in memory longer than necessary

**Better alternatives:**
- For high-repetition fields (status codes, country codes): use application-level `ConcurrentHashMap<String, String>` registry with bounded size
- For reducing duplicates generally: enable `-XX:+UseStringDeduplication` with G1 GC
- For memory optimization: profile first, optimize only proven hotspots
</details>

---

## FAQ

### Q: Is String concatenation with `+` always bad?

**A:** No. For simple expressions like `String msg = "Hello " + name + "!"`, the compiler optimizes this efficiently (especially with Java 9+ `invokedynamic`). It is only problematic **inside loops** where it creates O(N) temporary objects.

### Q: When should I use `StringBuffer` over `StringBuilder`?

**A:** Almost never. `StringBuffer` was the only option before Java 5. Today, use `StringBuilder` for single-threaded code (99% of cases). Use `StringBuffer` only when multiple threads are appending to the same builder — but even then, consider collecting per-thread and merging.

### Q: Does `substring()` share the underlying array?

**A:** In Java 6 and earlier, `substring()` shared the parent String's `char[]` array (which could cause memory leaks). Since **Java 7u6**, `substring()` creates a new array, eliminating this issue.

### Q: How does `String.format()` compare to `+` concatenation performance-wise?

**A:** `String.format()` is **3-5x slower** than `+` concatenation because it parses the format string at runtime. Use it for readability when performance is not critical. For high-performance code, use `StringBuilder`.

### Q: What is the maximum String length in Java?

**A:** Theoretically, `Integer.MAX_VALUE` (2^31 - 1 = ~2.1 billion characters). Practically, it is limited by available heap memory. A 2GB String requires ~2-4GB of heap space.
