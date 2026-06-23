# Type Casting — Interview Questions

## Table of Contents

1. [Junior Level](#junior-level)
2. [Middle Level](#middle-level)
3. [Senior Level](#senior-level)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level

### 1. What is type casting in Java?

**Answer:**
Type casting is the process of converting a value from one data type to another. Java supports two kinds of type casting:
- **Implicit casting (widening):** Automatic conversion from a smaller type to a larger type — no data loss.
- **Explicit casting (narrowing):** Manual conversion from a larger type to a smaller type — may lose data.

```java
// Implicit casting (widening): int -> double
int num = 42;
double d = num; // 42.0 — automatic, safe

// Explicit casting (narrowing): double -> int
double price = 9.99;
int rounded = (int) price; // 9 — decimal part is truncated, not rounded!
```

---

### 2. What is the difference between widening and narrowing casting?

**Answer:**
**Widening (implicit)** converts a smaller type to a larger type. It is done automatically because there is no risk of data loss:

```
byte -> short -> int -> long -> float -> double
        char  /
```

**Narrowing (explicit)** converts a larger type to a smaller type. It requires a cast operator because data can be lost:

```java
// Widening — automatic
int i = 100;
long l = i;       // int -> long, no cast needed

// Narrowing — manual
long l2 = 100L;
int i2 = (int) l2; // long -> int, cast required
```

---

### 3. What happens when you cast a `double` to an `int`?

**Answer:**
The fractional part is **truncated** (chopped off), not rounded. The value is simply cut at the decimal point:

```java
double a = 9.99;
int b = (int) a;
System.out.println(b); // 9 (not 10!)

double c = -3.7;
int d = (int) c;
System.out.println(d); // -3 (not -4!)
```

If you need rounding, use `Math.round()`:

```java
double val = 9.99;
int rounded = (int) Math.round(val); // 10
```

---

### 4. Can you cast `boolean` to `int` in Java?

**Answer:**
No. Java does **not** allow casting between `boolean` and any other type. This is different from C/C++ where `true`/`false` map to `1`/`0`.

```java
boolean flag = true;
// int num = (int) flag;   // COMPILE ERROR: incompatible types
// boolean b = (boolean) 1; // COMPILE ERROR: incompatible types
```

If you need to convert, do it explicitly:

```java
int num = flag ? 1 : 0;        // boolean to int
boolean b = (num != 0);        // int to boolean
```

---

### 5. What is the difference between implicit casting and explicit casting? Give examples.

**Answer:**

| Aspect | Implicit (Widening) | Explicit (Narrowing) |
|--------|-------------------|---------------------|
| Direction | Smaller to Larger | Larger to Smaller |
| Syntax | Automatic | Requires `(type)` |
| Data loss | Generally safe | May lose data |
| Compiler | No warning | Mandatory cast |

```java
// Implicit — compiler does it automatically
byte b = 10;
int i = b;        // byte -> int, no cast
float f = i;      // int -> float, no cast

// Explicit — you must tell the compiler
double d = 3.14;
int x = (int) d;  // double -> int, cast required (loses 0.14)
int big = 300;
byte small = (byte) big; // int -> byte, cast required (overflows to 44)
```

---

### 6. What happens when you cast a value that exceeds the target type's range?

**Answer:**
The value **wraps around** (overflows) silently. Java does not throw an exception — it takes the lower-order bits that fit in the target type:

```java
int value = 300;
byte b = (byte) value;
System.out.println(b); // 44

// Why 44? 300 in binary: 100101100
// byte takes lowest 8 bits: 00101100 = 44
```

```java
int big = 130;
byte small = (byte) big;
System.out.println(small); // -126

// 130 = 10000010 in binary
// As signed byte: -126 (two's complement)
```

This silent overflow is a common source of bugs. Always validate ranges before narrowing:

```java
if (value >= Byte.MIN_VALUE && value <= Byte.MAX_VALUE) {
    byte safe = (byte) value;
}
```

---

### 7. How do you cast between `char` and numeric types?

**Answer:**
`char` is an unsigned 16-bit integer (0 to 65535) representing a Unicode code point. It can be cast to/from numeric types:

```java
// char to int — widening, automatic
char ch = 'A';
int ascii = ch;
System.out.println(ascii); // 65

// int to char — narrowing, requires cast
int code = 66;
char letter = (char) code;
System.out.println(letter); // 'B'

// Arithmetic with char
char c = 'a';
char upper = (char) (c - 32); // 'A' — manual case conversion
System.out.println(upper);    // A
```

Note: `byte` and `short` to `char` require explicit cast because `char` is unsigned:

```java
byte b = 65;
// char ch = b;       // COMPILE ERROR
char ch = (char) b;   // OK: 'A'
```

---

## Middle Level

### 8. Explain type promotion rules in expressions. Why does `byte + byte` result in `int`?

**Answer:**
Java promotes all `byte`, `short`, and `char` operands to `int` before performing arithmetic. This is part of the **binary numeric promotion** rules (JLS 5.6.2):

1. If either operand is `double`, the other is promoted to `double`
2. Otherwise, if either is `float`, the other is promoted to `float`
3. Otherwise, if either is `long`, the other is promoted to `long`
4. **Otherwise, both are promoted to `int`** (even if both are `byte`)

```java
byte a = 10;
byte b = 20;
// byte c = a + b;     // COMPILE ERROR: a + b evaluates to int
byte c = (byte) (a + b); // OK: explicit cast back to byte
int d = a + b;            // OK: result is already int

short s1 = 1;
short s2 = 2;
// short s3 = s1 + s2; // COMPILE ERROR: result is int
short s3 = (short) (s1 + s2); // OK
```

**Why?** The JVM operates on 32-bit and 64-bit values internally. There are no bytecodes for `byte` or `short` arithmetic — they all use `iadd`, `imul`, etc. (integer operations).

---

### 9. What is the compound assignment casting trick? Why does `x += y` differ from `x = x + y`?

**Answer:**
Compound assignment operators (`+=`, `-=`, `*=`, etc.) include an **implicit narrowing cast**. This is defined in JLS 15.26.2:

`E1 op= E2` is equivalent to `E1 = (T) ((E1) op (E2))` where T is the type of E1.

```java
byte b = 10;
// b = b + 5;    // COMPILE ERROR: b + 5 is int, cannot assign to byte
b += 5;          // OK: compiler inserts (byte)(b + 5)

short s = 100;
// s = s * 2;    // COMPILE ERROR: s * 2 is int
s *= 2;          // OK: compiler inserts (short)(s * 2)

// Dangerous case — silent overflow:
byte x = 127;
x += 1;                    // No error! Equivalent to x = (byte)(x + 1)
System.out.println(x);     // -128 (silent overflow!)

// vs the explicit version catches the problem:
// x = x + 1;              // COMPILE ERROR: int cannot be assigned to byte
```

This is a frequent interview trick question. The compound operator hides potential data loss.

---

### 10. How does casting work with object types (upcasting and downcasting)?

**Answer:**
Object casting follows the class hierarchy:

- **Upcasting:** child to parent. Implicit, always safe.
- **Downcasting:** parent to child. Explicit, may throw `ClassCastException` at runtime.

```java
class Animal { void eat() { System.out.println("eating"); } }
class Dog extends Animal { void bark() { System.out.println("woof"); } }

// Upcasting — automatic, safe
Dog dog = new Dog();
Animal animal = dog; // upcasting — implicit, always safe
animal.eat();        // OK
// animal.bark();    // COMPILE ERROR: Animal doesn't have bark()

// Downcasting — explicit, risky
Animal a = new Dog();        // actual object is Dog
Dog d = (Dog) a;             // downcasting — OK because a IS a Dog
d.bark();                    // OK

Animal a2 = new Animal();
// Dog d2 = (Dog) a2;        // ClassCastException at runtime!
```

**Safe downcasting with `instanceof`:**

```java
// Traditional
if (a instanceof Dog) {
    Dog d = (Dog) a;
    d.bark();
}

// Java 16+ pattern matching
if (a instanceof Dog d) {
    d.bark(); // d is already cast
}
```

---

### 11. What precision is lost in widening conversions? Give specific examples.

**Answer:**
Not all widening conversions are lossless. Three widening conversions can lose precision:

| Conversion | Why |
|-----------|-----|
| `int` to `float` | `float` has 24-bit mantissa, `int` has 32 bits |
| `long` to `float` | `float` has 24-bit mantissa, `long` has 64 bits |
| `long` to `double` | `double` has 53-bit mantissa, `long` has 64 bits |

```java
// int -> float: loses precision for large values
int bigInt = 16_777_217; // 2^24 + 1
float f = bigInt;        // widening — compiles without cast
System.out.println(f);                   // 1.6777216E7
System.out.println((int) f == bigInt);   // false! Precision lost.

// long -> double: loses precision for large values
long bigLong = (1L << 53) + 1; // 9007199254740993
double d = bigLong;             // widening — compiles without cast
System.out.println((long) d);  // 9007199254740992 (off by 1)

// long -> float: worst case
long huge = Long.MAX_VALUE;
float fHuge = huge;
System.out.println((long) fHuge == huge); // false
```

**Lesson:** Widening does NOT guarantee value preservation — only that no `ClassCastException` or compile error occurs.

---

### 12. How does casting interact with Java generics and type erasure?

**Answer:**
Due to type erasure, the JVM has no knowledge of generic type parameters at runtime. The compiler inserts **implicit casts** (synthetic `checkcast` instructions) at generic boundaries:

```java
List<String> list = new ArrayList<>();
list.add("hello");
String s = list.get(0); // Compiler inserts: (String) list.get(0)
```

**Unsafe raw type usage can break this:**

```java
List rawList = new ArrayList();
rawList.add(42);                 // compiles! (adds Integer)
List<String> typed = rawList;    // unchecked warning
String s = typed.get(0);         // ClassCastException at runtime!
// The compiler-inserted cast (String) fails on Integer
```

**Unchecked casts with generics:**

```java
// This is an unchecked cast — compiler warns but cannot verify
@SuppressWarnings("unchecked")
List<String> list = (List<String>) someObject; // no runtime check of <String>

// The cast only checks List, not the type parameter
// Failure happens later when you read from the list
```

**Safe pattern:**

```java
// Use bounded wildcards instead of casting
public void process(List<? extends Number> numbers) {
    for (Number n : numbers) { // safe — no cast needed
        System.out.println(n.doubleValue());
    }
}
```

---

### 13. How do you safely convert `long` to `int` in production code?

**Answer:**
Never use a bare `(int) longValue` cast — it silently truncates. Use one of these approaches:

```java
// 1. Math.toIntExact() — throws ArithmeticException on overflow (Java 8+)
int safe = Math.toIntExact(longValue);

// 2. Manual range check
if (longValue < Integer.MIN_VALUE || longValue > Integer.MAX_VALUE) {
    throw new IllegalArgumentException("Value out of int range: " + longValue);
}
int safe = (int) longValue;

// 3. Clamp to range (if truncation is acceptable)
int clamped = (int) Math.max(Integer.MIN_VALUE, Math.min(Integer.MAX_VALUE, longValue));
```

Always prefer `Math.toIntExact()` — it is concise, standard, and fails loudly.

---

## Senior Level

### 14. How does the JIT compiler optimize type casting at runtime?

**Answer:**
The C2 JIT compiler applies several optimizations to eliminate or reduce the cost of type casts:

**1. Redundant cast elimination:**
```java
// Before JIT:
Object obj = getAnimal();
if (obj instanceof Dog) {
    Dog d = (Dog) obj;  // JIT knows obj IS Dog from the instanceof check
    d.bark();           // cast is eliminated — direct dispatch
}
```

**2. Speculative type profiling (inline caching):**
The JIT profiles the actual types flowing through a call site:
- **Monomorphic (1 type):** Eliminates type check, inlines the method. Cast becomes a simple pointer comparison: `cmp [obj+klass_offset], expected_klass`.
- **Bimorphic (2 types):** Generates a conditional branch with both paths inlined. Still fast.
- **Megamorphic (3+ types):** Falls back to vtable/itable lookup. 2-5x slower.

**3. Numeric cast elimination:**
```java
byte b = getData();
int i = b;              // On x86, b is already in a 32/64-bit register
int result = i + 100;   // No actual conversion needed — JIT eliminates
```

**Verification with JIT logging:**
```bash
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintCompilation \
     -XX:+LogCompilation -XX:LogFile=compilation.log MyApp
```
Then analyze `compilation.log` with JITWatch to see which casts are eliminated.

---

### 15. How would you design a safe type conversion framework for a large-scale application?

**Answer:**
A robust conversion framework prevents `ClassCastException`, data truncation, and precision loss:

```java
// 1. Define a generic Converter interface
@FunctionalInterface
public interface TypeConverter<S, T> {
    T convert(S source);
}

// 2. Registry for converters with fail-fast on missing converters
public class ConversionService {
    private final Map<ConversionKey, TypeConverter<?, ?>> converters =
        new ConcurrentHashMap<>();

    public <S, T> void register(Class<S> source, Class<T> target,
                                TypeConverter<S, T> converter) {
        converters.put(new ConversionKey(source, target), converter);
    }

    @SuppressWarnings("unchecked")
    public <S, T> T convert(S source, Class<T> targetType) {
        if (source == null) return null;
        if (targetType.isInstance(source)) return targetType.cast(source);

        ConversionKey key = new ConversionKey(source.getClass(), targetType);
        TypeConverter<S, T> converter = (TypeConverter<S, T>) converters.get(key);
        if (converter == null) {
            throw new ConversionException(
                "No converter: " + source.getClass() + " -> " + targetType);
        }
        return converter.convert(source);
    }

    private record ConversionKey(Class<?> source, Class<?> target) {}
}

// 3. Safe numeric converter with range validation
public class SafeNumericConverters {
    public static final TypeConverter<Long, Integer> LONG_TO_INT = value -> {
        if (value < Integer.MIN_VALUE || value > Integer.MAX_VALUE) {
            throw new ArithmeticException("Long " + value + " overflows int range");
        }
        return value.intValue();
    };

    public static final TypeConverter<Double, BigDecimal> DOUBLE_TO_DECIMAL = value -> {
        if (Double.isNaN(value) || Double.isInfinite(value)) {
            throw new ArithmeticException("Cannot convert " + value + " to BigDecimal");
        }
        return BigDecimal.valueOf(value);
    };
}
```

**Key design decisions:**
- Fail-fast on overflow instead of silent truncation
- Thread-safe registry with `ConcurrentHashMap`
- Null-safe by default
- Identity optimization (skip conversion if already the right type)
- Spring's `ConversionService` follows this exact pattern

---

### 16. Explain how `ClassCastException` propagates in complex systems (generics, proxies, serialization). How do you prevent it?

**Answer:**

**1. Generics + raw types (heap pollution):**
```java
// Library code accepts raw type
void legacyMethod(List list) { list.add(42); }

// Caller expects List<String>
List<String> names = new ArrayList<>();
legacyMethod(names);
// No error yet... CCE happens when reading:
String name = names.get(0); // ClassCastException: Integer cannot be cast to String
// Stack trace points HERE, not where the bug was introduced
```

**2. Dynamic proxies:**
```java
// AOP proxy wraps the service
@Transactional
public UserDTO getUser(long id) { ... }

// If injecting concrete class instead of interface:
// ClassCastException: com.sun.proxy.$Proxy72 cannot be cast to UserServiceImpl
```

**3. Serialization/deserialization:**
```java
// Jackson deserialization with wrong type
ObjectMapper mapper = new ObjectMapper();
Map<String, Object> map = mapper.readValue(json, Map.class);
// map.get("age") could be Integer, Long, or Double depending on JSON parser
Integer age = (Integer) map.get("age"); // CCE if value is Long
```

**Prevention strategy:**
```java
// 1. Compile-time: enable -Xlint:unchecked and treat warnings as errors
// javac -Xlint:unchecked -Werror *.java

// 2. Runtime: always use instanceof before casting
// 3. APIs: accept the widest type, return the narrowest
// 4. Serialization: use typed DTOs, not raw Maps
// 5. Testing: add integration tests that exercise full serialization round-trips
```

---

### 17. How do casting and type checks affect performance in hot paths? Compare `instanceof`, casting, and pattern matching.

**Answer:**

**Bytecode comparison:**
```java
// Traditional instanceof + cast — TWO type checks
if (obj instanceof String) {       // INSTANCEOF bytecode
    String s = (String) obj;       // CHECKCAST bytecode (redundant check)
    s.length();
}

// Pattern matching (Java 16+) — ONE type check
if (obj instanceof String s) {     // INSTANCEOF + implicit cast (no CHECKCAST)
    s.length();
}
```

**JIT optimization:**
The JIT compiler eliminates the redundant `CHECKCAST` after `INSTANCEOF` in the traditional pattern. So at runtime, there is **no measurable performance difference**. However, pattern matching produces cleaner bytecode and is less error-prone.

**Performance hierarchy:**
1. **Virtual method dispatch** (polymorphism): fastest — JIT inlines monomorphic/bimorphic calls
2. **`instanceof` chain** (2-3 types): fast — JIT profiles and orders checks
3. **`instanceof` chain** (many types): slower — branch mispredictions
4. **Reflection `Class.isInstance()`**: slowest — limited JIT optimization

**Recommendation:**
```java
// Prefer polymorphism for hot paths
sealed interface Shape permits Circle, Square, Triangle {
    double area(); // virtual dispatch — JIT-friendly
}

// Use pattern matching switch (Java 21) for cold/warm paths
double area = switch (shape) {
    case Circle c   -> Math.PI * c.radius() * c.radius();
    case Square s   -> s.side() * s.side();
    case Triangle t -> 0.5 * t.base() * t.height();
};
```

---

### 18. What happens when you cast `null` in Java? How does `checkcast` handle it vs `instanceof`?

**Answer:**
- `checkcast` on `null` **always succeeds** — null can be cast to any reference type (JVM spec)
- `instanceof` on `null` **always returns false** — null is not an instance of anything

```java
String s = (String) null;           // OK — no exception
boolean b = null instanceof String; // false
```

At bytecode level:
- `checkcast`: if operand is null, skip the type check and push null
- `instanceof`: if operand is null, push 0 (false)

This difference matters in pattern matching:

```java
Object obj = null;
if (obj instanceof String s) {
    // Never entered — instanceof rejects null
}
// But:
String s = (String) obj; // No exception — null passes checkcast
s.length();              // NullPointerException here!
```

---

## Scenario-Based Questions

### 19. A junior developer writes `short result = shortA + shortB;` and gets a compile error. They are confused because both operands are `short`. How do you explain and fix this?

**Answer:**

**Explanation:**
Java promotes `byte`, `short`, and `char` to `int` before any arithmetic operation. So `shortA + shortB` evaluates to `int`, which cannot be assigned to `short` without an explicit cast.

**Step-by-step:**
1. Explain the type promotion rule: all sub-int types widen to `int` in expressions
2. Show the fix:

```java
short a = 10;
short b = 20;

// Option 1: Cast the result
short result = (short) (a + b);

// Option 2: Use int (often the better choice)
int result = a + b;

// Option 3: Compound assignment (includes implicit cast)
short result = a;
result += b; // equivalent to result = (short)(result + b)
```

3. Explain **why** Java does this: overflow prevention. `short` max is 32,767. Two shorts can add up to 65,534, which overflows `short` but fits in `int`.
4. Mention that this applies to all operators: `+`, `-`, `*`, `/`, `%`, `&`, `|`, `^`, `<<`, `>>`, `>>>`

---

### 20. Your production service receives JSON data where an `age` field is sometimes an integer and sometimes a string (e.g., `"25"` or `25`). How do you handle this safely?

**Answer:**

**Investigation:**
1. Check API contract — is the sender supposed to send int or string?
2. Log a sample of incoming requests to understand the distribution

**Solution — Custom Jackson deserializer:**

```java
public class FlexibleIntDeserializer extends JsonDeserializer<Integer> {
    @Override
    public Integer deserialize(JsonParser p, DeserializationContext ctx)
            throws IOException {
        switch (p.currentToken()) {
            case VALUE_NUMBER_INT:
                return p.getIntValue();
            case VALUE_STRING:
                String text = p.getText().trim();
                if (text.isEmpty()) return null;
                try {
                    return Integer.parseInt(text);
                } catch (NumberFormatException e) {
                    throw new InvalidFormatException(
                        p, "Cannot parse '" + text + "' as integer",
                        text, Integer.class);
                }
            case VALUE_NULL:
                return null;
            default:
                throw ctx.wrongTokenException(p, Integer.class,
                    p.currentToken(),
                    "Expected int or string, got " + p.currentToken());
        }
    }
}

// Usage in DTO:
public class UserDTO {
    @JsonDeserialize(using = FlexibleIntDeserializer.class)
    private Integer age;
}
```

**Prevention:**
- Add input validation with Bean Validation: `@Min(0) @Max(150) Integer age`
- Log warnings when string-to-int conversion happens (track sender compliance)
- Add contract tests to catch schema drift early

---

### 21. After migrating from 32-bit IDs (`int`) to 64-bit IDs (`long`), some downstream services report incorrect IDs. What happened?

**Answer:**

**Root cause analysis:**
1. **JavaScript frontends:** JSON numbers are IEEE 754 doubles with 53-bit mantissa. IDs larger than `2^53 - 1` (9,007,199,254,740,991) lose precision.
2. **Old database columns:** If downstream DB column is still `INT`, values over 2,147,483,647 are silently truncated.
3. **Cached serialized data:** Old cached objects with `int` fields being deserialized into `long` fields may cause data corruption.
4. **Protocol buffers:** If `.proto` was not updated from `int32` to `int64`, values are truncated.

**Fix plan:**
```java
// 1. Serialize long IDs as strings in JSON responses
@JsonSerialize(using = ToStringSerializer.class)
private Long id;

// 2. Add range validation at service boundaries
public void validateId(long id) {
    if (id <= 0) throw new IllegalArgumentException("ID must be positive");
    if (id > 9_007_199_254_740_991L) {
        log.warn("ID {} exceeds JavaScript safe integer range", id);
    }
}

// 3. Database migration: ALTER TABLE users MODIFY id BIGINT NOT NULL;
// 4. Invalidate all caches during deployment
// 5. Update .proto files: int32 -> int64
// 6. Add integration tests with IDs > Integer.MAX_VALUE
```

---

### 22. Your team's code review reveals `(int)(object)` double-casting pattern throughout the codebase. What are the risks and how do you address this?

**Answer:**

**The pattern and its risks:**
```java
// Double cast: Object -> unbox to primitive
Object value = getFromMap("count"); // could be Integer, Long, String, null...
int count = (int) value;            // actually: (int)(Integer) value — two casts

// Risk 1: ClassCastException if value is Long
Map<String, Object> map = new HashMap<>();
map.put("count", 42L);                  // stored as Long
int count = (int) map.get("count");     // CCE: Long cannot be cast to Integer

// Risk 2: NullPointerException if value is null
map.put("count", null);
int count = (int) map.get("count");     // NPE: cannot unbox null

// Risk 3: ClassCastException if value is String
map.put("count", "42");
int count = (int) map.get("count");     // CCE: String cannot be cast to Integer
```

**Safe replacement utility:**
```java
public final class SafeCast {
    public static int toInt(Object value, int defaultValue) {
        if (value == null) return defaultValue;
        if (value instanceof Number n) return n.intValue();
        if (value instanceof String s) {
            try { return Integer.parseInt(s.trim()); }
            catch (NumberFormatException e) { return defaultValue; }
        }
        return defaultValue;
    }
}

// Usage:
int count = SafeCast.toInt(map.get("count"), 0);
```

**Address the root cause:**
1. Replace `Map<String, Object>` with typed DTOs
2. Add static analysis rule (ErrorProne/SonarQube) to flag `(int) objectRef` patterns
3. Code review checklist: "No raw Object casting — use typed accessors"

---

### 23. You notice high GC pause times in a data processing pipeline that converts between numeric types. What do you investigate?

**Answer:**

**Step-by-step:**

1. **Enable GC logging:** `-Xlog:gc*:file=gc.log`
2. **Check autoboxing allocations:**
   ```bash
   ./profiler.sh -e alloc -d 30 -f alloc.html <pid>
   ```
   Look for `Integer.valueOf`, `Long.valueOf`, `Double.valueOf` in the flamegraph.
3. **Identify boxing sources:**
   - `Stream.map()` instead of `Stream.mapToInt()`
   - `List<Integer>` instead of `int[]`
   - `HashMap<Integer, Double>` instead of primitive map implementations
   - `Long sum = 0L` accumulator creating a new object on each `+=`
4. **Replace with primitive alternatives:**
   - Use `IntStream`, `LongStream`, `DoubleStream`
   - Use Eclipse Collections: `IntArrayList`, `IntDoubleHashMap`
   - Replace `Long sum = 0L` with `long sum = 0L`
5. **Validate:** Compare GC pause times and allocation rate before/after

---

## FAQ

### Q: What do interviewers look for when asking about Type Casting in Java?

**A:** Key evaluation criteria:
- **Junior:** Can explain widening vs narrowing, knows `instanceof`, understands truncation vs rounding, knows `boolean` cannot be cast
- **Middle:** Understands type promotion rules, knows about precision loss in widening, can explain object upcasting/downcasting, understands generics and type erasure implications, knows safe conversion utilities (`Math.toIntExact`)
- **Senior:** Can discuss JIT optimization of checkcast/instanceof, designs safe conversion frameworks, understands casting across system boundaries (JSON, JNI, gRPC), knows performance implications of type checks in hot paths

### Q: What are the most common type casting mistakes in production Java code?

**A:**
1. **Unboxing null:** `int x = (Integer) null;` causes `NullPointerException`
2. **Silent narrowing overflow:** `byte b = (byte) 300;` gives 44, not 300
3. **Wrong wrapper type from Map:** `(Integer) map.get("key")` fails if value is `Long`
4. **Precision loss in widening:** `float f = 16_777_217;` loses the last digit
5. **`==` on cast wrappers:** `(Integer) 128 == (Integer) 128` is `false`

### Q: Should I always use explicit casting or are there better alternatives?

**A:** Prefer alternatives to explicit casting when possible:
- **Polymorphism** instead of `instanceof` + cast chains
- **Generics** instead of casting from `Object`
- **Pattern matching** (`instanceof Type var`) instead of separate cast statements
- **Conversion methods** (`Integer.parseInt()`, `String.valueOf()`) instead of raw casts
- **Typed DTOs** instead of `Map<String, Object>` + casting

Explicit casting should be a last resort, indicating either a design limitation or a boundary between typed and untyped systems.

### Q: How important is type casting knowledge for real-world Java development?

**A:** Very important. Type casting touches:
- **API design:** choosing between primitives and wrappers, handling nullable values
- **Performance:** autoboxing overhead in hot paths, primitive streams vs object streams
- **Data integrity:** precision loss when converting between numeric types, safe ID migration
- **Debugging:** understanding `ClassCastException` in generics, proxies, and serialization
- **Interoperability:** JSON number handling, database type mapping, cross-language calls

### Q: What is the difference between `Class.cast()` and the cast operator `(Type)`?

**A:**

```java
// Cast operator — resolved at compile time
String s = (String) obj; // compiler checks type compatibility

// Class.cast() — resolved at runtime
String s = String.class.cast(obj); // equivalent, but works with Class<?> variables

// Key difference: Class.cast() is useful with generics
public <T> T convert(Object obj, Class<T> type) {
    return type.cast(obj); // cannot use (T) obj — type erasure makes it unchecked
}
```

Both throw `ClassCastException` if the cast fails. Use `Class.cast()` when the target type is a variable (`Class<T>`), use the cast operator `(Type)` for static, known types.
