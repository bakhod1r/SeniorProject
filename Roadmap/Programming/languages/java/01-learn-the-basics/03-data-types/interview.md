# Data Types — Interview Questions

## Table of Contents

1. [Junior Level](#junior-level)
2. [Middle Level](#middle-level)
3. [Senior Level](#senior-level)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level

### 1. What are the 8 primitive data types in Java?

**Answer:**
Java has 8 primitive types divided into 4 categories:
- **Integer types:** `byte` (1 byte), `short` (2 bytes), `int` (4 bytes), `long` (8 bytes)
- **Floating-point types:** `float` (4 bytes), `double` (8 bytes)
- **Character type:** `char` (2 bytes, unsigned, represents Unicode characters)
- **Boolean type:** `boolean` (true or false)

```java
int age = 25;
double price = 19.99;
char grade = 'A';
boolean isActive = true;
```

---

### 2. What is the difference between `int` and `Integer`?

**Answer:**
`int` is a primitive type — it stores the value directly and cannot be null. `Integer` is a wrapper class — it's an object that wraps an `int` value, can be null, and can be used with collections and generics.

```java
int primitive = 42;        // stored on stack, cannot be null
Integer wrapper = 42;      // object on heap, can be null
List<Integer> list = new ArrayList<>(); // generics require Integer, not int
```

---

### 3. What is autoboxing and unboxing?

**Answer:**
Autoboxing is the automatic conversion from a primitive to its wrapper class. Unboxing is the reverse — wrapper to primitive. Java does this automatically since Java 5.

```java
Integer x = 42;     // autoboxing: int -> Integer (calls Integer.valueOf(42))
int y = x;          // unboxing: Integer -> int (calls x.intValue())
```

---

### 4. What are default values for primitive types in Java?

**Answer:**
Instance and static fields get default values automatically. Local variables do NOT get defaults — they must be initialized before use.

| Type | Default |
|------|---------|
| `byte`, `short`, `int` | `0` |
| `long` | `0L` |
| `float` | `0.0f` |
| `double` | `0.0d` |
| `char` | `'\u0000'` |
| `boolean` | `false` |
| Reference types (String, Integer, etc.) | `null` |

---

### 5. Why should you not use `float` or `double` for money?

**Answer:**
`float` and `double` use binary floating-point (IEEE 754) which cannot represent some decimal fractions exactly:

```java
System.out.println(0.1 + 0.2); // 0.30000000000000004 (not 0.3!)
```

For money, use `BigDecimal` with the String constructor:

```java
BigDecimal price = new BigDecimal("19.99");
BigDecimal tax = new BigDecimal("0.08");
BigDecimal total = price.multiply(BigDecimal.ONE.add(tax));
```

---

### 6. What happens when you compare two Integer objects with `==`?

**Answer:**
`==` compares references (memory addresses), not values. It works for values -128 to 127 because Java caches those Integer objects. For values outside this range, `==` returns `false` even if the values are equal.

```java
Integer a = 127;
Integer b = 127;
System.out.println(a == b);    // true (cached)

Integer c = 128;
Integer d = 128;
System.out.println(c == d);    // false (different objects!)
System.out.println(c.equals(d)); // true (correct way)
```

Always use `.equals()` to compare wrapper objects.

---

### 7. What is the range of `byte` and why does overflow happen silently?

**Answer:**
`byte` ranges from -128 to 127. Java does not throw an exception on integer overflow — it wraps around silently:

```java
byte b = 127;
b++;
System.out.println(b); // -128 (wrapped around!)
```

This is because Java uses two's complement representation. To detect overflow, use `Math.addExact()`:

```java
try {
    int result = Math.addExact(Integer.MAX_VALUE, 1); // throws ArithmeticException
} catch (ArithmeticException e) {
    System.out.println("Overflow detected!");
}
```

---

## Middle Level

### 8. Explain the Integer cache mechanism. How does it affect `==` behavior?

**Answer:**
Java caches `Integer` objects for values -128 to 127 (specified in JLS 5.1.7). When `Integer.valueOf()` is called with a value in this range, it returns a cached instance instead of creating a new object.

```java
// Inside Integer.valueOf() (simplified):
public static Integer valueOf(int i) {
    if (i >= -128 && i <= 127)
        return IntegerCache.cache[i + 128]; // return cached instance
    return new Integer(i); // create new object
}
```

The cache upper bound can be extended with `-XX:AutoBoxCacheMax=N`. Other wrapper caches:
- `Byte`, `Short`, `Long`: -128 to 127 (fixed)
- `Character`: 0 to 127 (fixed)
- `Boolean`: `TRUE` and `FALSE` (always cached)

This is why `==` is unreliable for wrappers — it depends on whether the value is in the cache range.

---

### 9. What is the difference between widening and narrowing conversions? When is precision lost?

**Answer:**
- **Widening:** smaller type to larger type — happens automatically, usually safe
- **Narrowing:** larger type to smaller type — requires explicit cast, may lose data

However, some widening conversions lose precision:
- `int` to `float`: `float` has only 24 bits of mantissa, but `int` has 32 bits
- `long` to `float`: even worse precision loss
- `long` to `double`: `double` has 53 bits of mantissa, but `long` has 64 bits

```java
int big = 16_777_217; // 2^24 + 1
float f = big;         // widening — compiles without cast
System.out.println((int) f == big); // false! Precision lost.
```

---

### 10. How do you handle nullable numeric values in Spring Boot REST APIs?

**Answer:**
Use wrapper types (`Integer`, `Long`) for nullable parameters and `Optional` / `OptionalInt` in service layer:

```java
@GetMapping("/users")
public List<User> getUsers(
    @RequestParam(required = false) Integer minAge,  // nullable
    @RequestParam(defaultValue = "0") int page       // non-nullable with default
) {
    OptionalInt age = (minAge != null) ? OptionalInt.of(minAge) : OptionalInt.empty();
    return userService.findUsers(age, page);
}
```

For JPA entities, match Java type nullability to database column:
- NOT NULL column → `int`, `long` (primitive)
- Nullable column → `Integer`, `Long` (wrapper)
- Primary key before save → `Long id` (null = unsaved)

---

### 11. What are the special floating-point values in Java? How do they affect computation?

**Answer:**
IEEE 754 defines special values:
- `Double.NaN` (Not a Number) — result of `0.0/0.0`, `Math.sqrt(-1)`
- `Double.POSITIVE_INFINITY` — result of `1.0/0.0`
- `Double.NEGATIVE_INFINITY` — result of `-1.0/0.0`
- Positive zero (`0.0`) and negative zero (`-0.0`)

Critical behavior:
```java
Double.NaN == Double.NaN          // false (IEEE 754 rule!)
Double.isNaN(Double.NaN)          // true (correct check)
new Double(Double.NaN).equals(new Double(Double.NaN)) // true (for HashMap consistency)
0.0 == -0.0                       // true
Double.compare(0.0, -0.0)         // 1 (not equal!)
```

NaN propagates through calculations: any arithmetic with NaN produces NaN. This can silently corrupt entire computation chains if not validated at input boundaries.

---

### 12. When should you use `BigDecimal` vs `long` for monetary values?

**Answer:**

| Aspect | `BigDecimal` | `long` (cents) |
|--------|-------------|----------------|
| Precision | Arbitrary decimal precision | Fixed (smallest unit = 1 cent) |
| Performance | Slower (object allocation, immutable) | Faster (primitive arithmetic) |
| Readability | `new BigDecimal("19.99")` | `1999` (needs context) |
| Max value | Unlimited | ~92 quadrillion cents |
| Sub-cent amounts | Yes (e.g., gas prices: $3.499) | No (without multiplying) |

**Rule of thumb:**
- High-throughput trading system: `long` cents (performance > readability)
- E-commerce application: `BigDecimal` (correctness > performance)
- Both: Never `double` or `float`

---

### 13. Explain type promotion rules in Java expressions.

**Answer:**
When different numeric types appear in an expression, Java promotes smaller types to larger types:

```
byte → short → int → long → float → double
       char ↗
```

Key rules:
1. `byte`, `short`, `char` are always promoted to `int` in arithmetic
2. If either operand is `double`, the other is promoted to `double`
3. If either operand is `float`, the other is promoted to `float`
4. If either operand is `long`, the other is promoted to `long`

```java
byte a = 10;
byte b = 20;
// byte c = a + b;  // COMPILE ERROR: a + b is int, not byte
int c = a + b;       // OK: result is int
```

---

## Senior Level

### 14. How does autoboxing affect GC performance in high-throughput systems? How would you diagnose and fix it?

**Answer:**
Each autoboxing outside the Integer cache creates a new heap object (16 bytes for Integer). In hot loops processing millions of operations:

**Diagnosis:**
1. Run `async-profiler -e alloc -f alloc.html <pid>` to get allocation flamegraph
2. Look for `Integer.valueOf`, `Long.valueOf` in the top allocation frames
3. Check JFR recording: Memory > Object Allocation > Hot Methods

**Fixes (in order of impact):**
1. Replace `Long sum = 0L` with `long sum = 0L` in accumulators
2. Replace `Stream<Integer>` with `IntStream` / `LongStream` for bulk operations
3. Replace `HashMap<Integer, T>` with primitive-backed collections (Eclipse Collections `IntObjectHashMap`)
4. Extend Integer cache: `-XX:AutoBoxCacheMax=N` if values are in a known range
5. For extreme cases: use off-heap memory (ByteBuffer, Chronicle Map)

**Benchmark impact:**
```
Before: 2 GB/s allocation rate, GC every 500ms (200ms pause)
After:  50 MB/s allocation rate, GC every 30s (5ms pause)
```

---

### 15. Explain escape analysis in the context of autoboxing. When does it work and when does it fail?

**Answer:**
Escape analysis is a JIT compiler optimization (C2) that determines whether an object's lifetime is confined to the current method. If an `Integer` doesn't "escape," the JIT replaces it with scalar values on the stack (scalar replacement) — eliminating the heap allocation.

**Works (object doesn't escape):**
```java
public int compute(int x) {
    Integer temp = x * 2; // JIT eliminates this allocation
    return temp + 1;      // scalar replacement: temp treated as int
}
```

**Fails (object escapes):**
```java
// 1. Stored in field
this.cached = Integer.valueOf(42);       // escapes to heap

// 2. Returned from method
return Integer.valueOf(42);              // escapes to caller

// 3. Stored in array
array[0] = Integer.valueOf(42);          // arrays are heap objects

// 4. Passed to non-inlined method
unknownMethod(Integer.valueOf(42));      // JIT can't prove safety

// 5. Used as monitor
synchronized(integerObj) { ... }         // identity required
```

**Verification:**
```bash
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations MyApp
# Look for: "++ eliminated allocation of java.lang.Integer"
```

---

### 16. How would you design a type system for a financial application that prevents precision bugs at compile time?

**Answer:**
Use domain-specific wrapper types (value objects) to prevent primitive obsession:

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount, "amount");
        Objects.requireNonNull(currency, "currency");
        if (amount.scale() > currency.getDefaultFractionDigits()) {
            throw new IllegalArgumentException("Too many decimal places");
        }
    }

    public Money add(Money other) {
        if (!this.currency.equals(other.currency)) {
            throw new CurrencyMismatchException(this.currency, other.currency);
        }
        return new Money(amount.add(other.amount), currency);
    }

    // Prevents: money.add(quantity) — type safety!
}

public record Quantity(int value) {
    public Quantity {
        if (value < 0) throw new IllegalArgumentException("Quantity < 0");
    }
}

// Usage:
Money price = new Money(new BigDecimal("19.99"), Currency.getInstance("USD"));
Quantity qty = new Quantity(3);
// price.add(qty); // COMPILE ERROR — type safety!
```

This pattern prevents:
- Mixing money with quantities
- Adding different currencies
- Precision bugs from using `double`

---

### 17. What is Project Valhalla and how will it change Java's type system?

**Answer:**
Project Valhalla introduces **value types** (value classes) — user-defined types that:
- Have no identity (like primitives)
- Are stack-allocated and flat in arrays (no pointer indirection)
- Can be used as generic type parameters (`List<int>`)

**Current problem:**
```java
// Today: List<Integer> stores pointers to heap objects
// Each Integer: 16 bytes + 4 byte pointer = 20 bytes per element
// For 1M elements: ~20 MB
List<Integer> list = new ArrayList<>(1_000_000);
```

**Valhalla future:**
```java
// Future: List<int> stores values inline
// Each int: 4 bytes (no header, no pointer)
// For 1M elements: ~4 MB (5x less memory)
List<int> list = new ArrayList<>(1_000_000);
```

**Impact:**
- Eliminates the primitive-object duality
- Enables `HashMap<int, int>` — no boxing overhead
- Flat arrays for value types — better cache locality
- Java closes the performance gap with C/Rust for numeric workloads

---

### 18. How do you handle numeric type conversions safely across microservice boundaries?

**Answer:**
At service boundaries (REST, gRPC, Kafka), numeric types can lose precision or overflow:

```java
// Problem: JavaScript (JSON) uses IEEE 754 double for ALL numbers
// Max safe integer in JavaScript: 2^53 - 1 = 9,007,199,254,740,991
// Java long max: 2^63 - 1 = 9,223,372,036,854,775,807

// ❌ This long value is silently truncated in JavaScript
long javaLong = 9_007_199_254_740_993L; // > 2^53
// Frontend receives: 9007199254740992 (wrong! precision lost)

// ✅ Solution 1: Serialize longs as strings in JSON
@JsonSerialize(using = ToStringSerializer.class)
private Long orderId;

// ✅ Solution 2: Use protobuf/gRPC with explicit int64 type
// message Order { int64 order_id = 1; }
```

**Boundary checklist:**
- JSON `number` → Java `long`: check for JavaScript safe integer range
- Java `int` → protobuf `int32`: safe (same range)
- Database `DECIMAL(10,2)` → Java: use `BigDecimal`, not `double`
- Java `float` → anything: avoid — use `double` or `BigDecimal`

---

### 19. Explain the memory layout differences between `int[]`, `Integer[]`, and `ArrayList<Integer>`.

**Answer:**

```
int[1000]:
Memory: 16 (header) + 4000 (data) = 4016 bytes
Layout: [header][0][1][2]...[999] — contiguous, cache-friendly
Access: arr[i] = single array bounds check + direct offset

Integer[1000] (all non-null):
Memory: 16 (array header) + 4000 (references) + 1000 × 16 (Integer objects) = 20016 bytes
Layout: [header][ref0][ref1]...[ref999] → [Integer0][Integer1]...[Integer999]
Access: arr[i] = array bounds check + pointer dereference + field offset
Cache misses: objects scattered across heap

ArrayList<Integer>(1000):
Memory: 40 (ArrayList object) + 16 (internal Object[] header) + 4000 (references)
        + 1000 × 16 (Integer objects) = ~20056 bytes
Layout: [ArrayList] → [Object[]] → [ref0][ref1]... → [Integer0][Integer1]...
Access: Extra indirection through ArrayList → internal array → Integer object
```

For 1M elements, memory usage:
- `int[]`: ~4 MB
- `Integer[]`: ~20 MB (5x more)
- `ArrayList<Integer>`: ~20 MB + ArrayList overhead

---

## Scenario-Based Questions

### 20. Your Spring Boot API returns incorrect totals for large orders. The total should be $45,000.50 but shows $44,999.98. What's the likely cause?

**Answer:**
The likely cause is using `double` or `float` for monetary calculations:

```java
// ❌ Bug: double accumulates rounding errors
double total = 0.0;
for (OrderItem item : items) {
    total += item.getPrice() * item.getQuantity(); // floating-point error compounds
}
```

**Fix:**
```java
// ✅ Use BigDecimal
BigDecimal total = BigDecimal.ZERO;
for (OrderItem item : items) {
    BigDecimal itemTotal = item.getPrice()
        .multiply(BigDecimal.valueOf(item.getQuantity()));
    total = total.add(itemTotal);
}
```

**Prevention:**
- Store prices as `BigDecimal` in entities
- Database column: `DECIMAL(19,4)` not `DOUBLE`
- Add code review rule: no `float`/`double` in financial domain classes

---

### 21. You observe 2 GB/s object allocation rate in production JFR recording. The top allocator is `java.lang.Long.valueOf`. What's your investigation and fix plan?

**Answer:**

**Investigation:**
1. Get allocation flamegraph: `async-profiler -d 30 -e alloc -f alloc.html <pid>`
2. Identify the calling code path — likely a hot loop with `Long` accumulator or `Map<Long, X>` operations
3. Check if the values are in the cache range (-128..127) — if not, every `valueOf` creates a new object

**Fix plan (ordered by impact):**
1. **Quick win:** Change `Long sum = 0L` to `long sum = 0L` in accumulator loops
2. **Medium effort:** Replace `HashMap<Long, T>` with primitive map (Eclipse Collections `LongObjectHashMap`)
3. **JVM tuning:** If values are in a predictable range, use `-XX:AutoBoxCacheMax=N`
4. **Architecture:** Consider primitive streams: `LongStream` instead of `Stream<Long>`
5. **Verify:** Re-run JFR and confirm allocation rate dropped to < 200 MB/s

---

### 22. A developer on your team argues that `Integer` and `int` are interchangeable thanks to autoboxing. How do you respond?

**Answer:**
They are NOT interchangeable. Key differences that matter in production:

1. **Nullability:** `Integer` can be `null`; `int` cannot → unboxing `null` causes `NullPointerException`
2. **Identity:** `new Integer(5) == new Integer(5)` is `false`; `5 == 5` is `true`
3. **Performance:** `Integer` is a heap object (16 bytes + GC overhead); `int` is 4 bytes on stack
4. **Collections:** `List<int>` is illegal; `List<Integer>` is required
5. **Generics:** `Optional<int>` doesn't compile; use `OptionalInt` or `Optional<Integer>`
6. **Serialization:** JSON `null` maps to `Integer null`, but `int` defaults to 0 → data loss

**Rule:** Use `int` by default. Use `Integer` only when null is semantically meaningful.

---

### 23. Your team is migrating from Java 8 to Java 21. What data-type-related improvements should you leverage?

**Answer:**
- **Records (Java 16):** Replace verbose value-holding classes with `record Money(BigDecimal amount, String currency) {}`
- **Pattern matching for instanceof (Java 16):** `if (obj instanceof Integer i) { use(i); }` — eliminates cast
- **Sealed classes (Java 17):** Restrict type hierarchies for domain types
- **`Math.absExact()` (Java 15):** Detect `Math.abs(Integer.MIN_VALUE)` overflow
- **Helpful NullPointerExceptions (Java 14):** Better error messages for unboxing NPE: `"Cannot invoke Integer.intValue() because x is null"`
- **ZGC improvements:** Sub-millisecond pauses even with heavy wrapper allocation
- **Text blocks (Java 13):** Not directly related, but helps with SQL queries that interact with numeric types

---

## FAQ

### Q: What do interviewers look for when asking about Data Types in Java?

**A:** Key evaluation criteria:
- **Junior:** Can name all 8 primitives, knows `int` vs `Integer`, understands autoboxing basics
- **Middle:** Can explain Integer cache, chooses correct types for production (nullable vs non-nullable), knows `BigDecimal` for money
- **Senior:** Can discuss GC impact of boxing, escape analysis, memory layout, designs type contracts across service layers

### Q: Should I memorize the exact ranges of all primitive types?

**A:** No. Interviewers care that you know:
- `byte`: about -128 to 127
- `int`: about +/- 2 billion
- `long`: very large (enough for timestamps, IDs)
- `float` vs `double`: precision difference (~7 vs ~15 digits)
- How to check: `Integer.MAX_VALUE`, `Long.MIN_VALUE`, etc.

### Q: Is it true that `var` weakens Java's type system?

**A:** No. `var` (Java 10+) is a compile-time feature — the compiler infers the exact type. `var x = 42` is compiled as `int x = 42`. It doesn't change runtime behavior, just reduces boilerplate. However, avoid `var` when the type isn't obvious from the right-hand side:

```java
var list = new ArrayList<String>(); // OK — type is obvious
var result = service.process(data); // Bad — unclear what type 'result' is
```

### Q: How does `char` relate to Unicode in modern Java?

**A:** `char` is 2 bytes (16 bits) and represents a UTF-16 code unit. For characters outside the Basic Multilingual Plane (BMP) — like emojis — a single character requires two `char` values (a surrogate pair). This means `"😀".length()` returns 2, not 1. Use `String.codePointCount()` for the true character count.
