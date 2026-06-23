# Java Language Specification — Data Types
## Source: https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html

---

## 1. Spec Reference

- **JLS Chapter 4**: Types, Values, and Variables — https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html
- **JLS §4.1**: The Kinds of Types and Values
- **JLS §4.2**: Primitive Types and Values
- **JLS §4.2.1**: Integral Types and Values
- **JLS §4.2.2**: Integer Operations
- **JLS §4.2.3**: Floating-Point Types, Formats, and Values
- **JLS §4.2.4**: Floating-Point Operations
- **JLS §4.2.5**: The boolean Type and boolean Values
- **JLS §4.3**: Reference Types and Values
- **JLS §4.3.1**: Objects
- **JLS §4.3.2**: The Class Object
- **JLS §4.3.3**: The Class String
- **JLS §4.3.4**: When Reference Types Are the Same
- **JLS §4.4**: Type Variables
- **JLS §4.5**: Parameterized Types
- **JLS §4.8**: Raw Types
- **JLS §4.9**: Intersection Types
- **JLS §4.10**: Subtyping
- **JLS §4.12**: Variables

---

## 2. Formal Grammar (BNF from JLS)

```
-- JLS §4.1: Types --
Type:
    PrimitiveType
    ReferenceType

-- JLS §4.2: Primitive Types --
PrimitiveType:
    {Annotation} NumericType
    {Annotation} boolean

NumericType:
    IntegralType
    FloatingPointType

IntegralType: one of
    byte  short  int  long  char

FloatingPointType: one of
    float  double

-- JLS §4.3: Reference Types --
ReferenceType:
    ClassOrInterfaceType
    TypeVariable
    ArrayType

ClassOrInterfaceType:
    ClassType
    InterfaceType

ClassType:
    {Annotation} TypeIdentifier [TypeArguments]
    PackageName . {Annotation} TypeIdentifier [TypeArguments]
    ClassOrInterfaceType . {Annotation} TypeIdentifier [TypeArguments]

InterfaceType:
    ClassType

TypeVariable:
    {Annotation} TypeIdentifier

ArrayType:
    PrimitiveType Dims
    ClassOrInterfaceType Dims
    TypeVariable Dims

Dims:
    {Annotation} [ ] {{Annotation} [ ]}

-- JLS §4.4: Type Variables --
TypeParameter:
    {TypeParameterModifier} TypeIdentifier [TypeBound]

TypeBound:
    extends TypeVariable
    extends ClassOrInterfaceType {AdditionalBound}

AdditionalBound:
    & InterfaceType

-- JLS §4.5: Parameterized Types --
TypeArguments:
    < TypeArgumentList >

TypeArgumentList:
    TypeArgument { , TypeArgument }

TypeArgument:
    ReferenceType
    Wildcard

Wildcard:
    {Annotation} ? [WildcardBounds]

WildcardBounds:
    extends ReferenceType
    super ReferenceType

-- JLS §3.10: Literals (associated with types) --
IntegerLiteral:
    DecimalIntegerLiteral
    HexIntegerLiteral
    OctalIntegerLiteral
    BinaryIntegerLiteral

FloatingPointLiteral:
    DecimalFloatingPointLiteral
    HexadecimalFloatingPointLiteral

BooleanLiteral:
    true
    false

NullLiteral:
    null
```

---

## 3. Core Rules & Constraints

### 3.1 Primitive Type Sizes (JLS §4.2)
| Type | Width | Min Value | Max Value | Default |
|------|-------|-----------|-----------|---------|
| `byte` | 8-bit signed | -128 | 127 | 0 |
| `short` | 16-bit signed | -32,768 | 32,767 | 0 |
| `int` | 32-bit signed two's complement | -2^31 | 2^31 - 1 | 0 |
| `long` | 64-bit signed two's complement | -2^63 | 2^63 - 1 | 0L |
| `float` | 32-bit IEEE 754 | ~1.4E-45 | ~3.4E+38 | 0.0f |
| `double` | 64-bit IEEE 754 | ~4.9E-324 | ~1.8E+308 | 0.0d |
| `char` | 16-bit unsigned Unicode | '\u0000' (0) | '\uFFFF' (65535) | '\u0000' |
| `boolean` | JVM-dependent size | false | true | false |

### 3.2 `boolean` Type (JLS §4.2.5)
- Only two values: `true` and `false`.
- `boolean` is NOT a numeric type; cannot be cast to/from numeric types.
- In arrays: JVM may represent each `boolean` as 1 byte.
- `Boolean.parseBoolean("TRUE")` returns `true` (case-insensitive for "true").

### 3.3 `char` Type (JLS §4.2.1)
- Represents a single 16-bit Unicode code unit (UTF-16).
- Supplementary characters (code points > U+FFFF) require two `char` values (a surrogate pair).
- `char` is an unsigned numeric type; it can participate in arithmetic.
- `char` widening: `char` → `int` → `long` → `float` → `double` (JLS §5.1.2).

### 3.4 Reference Types (JLS §4.3)
- Reference types include class types, interface types, array types, and type variables.
- Default value for any reference type is `null`.
- `null` is not an instance of any type, but is assignable to any reference type.
- Two reference type variables are equal (`==`) only if they refer to the same object.

### 3.5 Type Compatibility and Subtyping (JLS §4.10)
- Every class type is a subtype of `Object`.
- An array type `T[]` is a subtype of `Object`, `Cloneable`, and `Serializable`.
- If `S` is a subtype of `T`, then `S[]` is a subtype of `T[]` (array covariance — JLS §4.10.3).
- Covariance is a potential source of `ArrayStoreException` at runtime.

---

## 4. Type Rules

### 4.1 Widening and Narrowing (JLS §5.1)
- **Widening primitive conversions** (no explicit cast needed):
  `byte → short → int → long → float → double`
  `char → int → long → float → double`
- **Narrowing** requires explicit cast and may lose information.
- `byte` and `short` are widened to `int` before arithmetic operations.

### 4.2 Floating-Point Special Values (JLS §4.2.3)
- IEEE 754 defines: positive infinity, negative infinity, NaN, positive zero, negative zero.
- `NaN != NaN` is `true` (the only value not equal to itself).
- `0.0 == -0.0` is `true`.
- `Double.isNaN()`, `Double.isInfinite()` for checks.
- `Float.NaN`, `Double.NaN`, `Float.POSITIVE_INFINITY`, `Double.NEGATIVE_INFINITY` are constants.

### 4.3 Integer Overflow (JLS §4.2.2)
- Integer arithmetic is modular (two's complement wraparound).
- `Integer.MAX_VALUE + 1 == Integer.MIN_VALUE` — no exception thrown.
- Use `Math.addExact()` etc. for overflow-checked arithmetic (Java 8+).

### 4.4 Generic Types and Erasure (JLS §4.5, §4.8)
- Generic type parameters are erased at compile time.
- `List<String>` and `List<Integer>` are both `List` at runtime.
- Cannot use `instanceof` with parameterized types: `obj instanceof List<String>` is a compile error.
- Raw types (`List` without type arg) generate unchecked warnings.

### 4.5 Array Types (JLS §10.1)
- `new int[n]` creates an array of `n` `int`s, each initialized to `0`.
- Array length is final after creation; stored in `length` field.
- `array.length` is not a method call; it is a field access (JLS §10.7).
- Multi-dimensional arrays are arrays of arrays: `int[][] grid = new int[3][4]`.

---

## 5. Behavioral Specification

### 5.1 Integer Operations (JLS §4.2.2)
- Division by zero: `int x = 5 / 0;` → throws `ArithmeticException`.
- Modulo by zero: `int x = 5 % 0;` → throws `ArithmeticException`.
- Shift operators: `<<`, `>>`, `>>>` use only the 5 low-order bits of the RHS for `int` (6 bits for `long`).
  - `1 << 33` is same as `1 << 1` = `2` (33 mod 32 = 1).
- Unsigned right shift `>>>` fills with zeros (sign bit not extended).

### 5.2 Floating-Point Operations (JLS §4.2.4)
- `1.0 / 0.0` → `Double.POSITIVE_INFINITY` (no exception).
- `0.0 / 0.0` → `Double.NaN`.
- `Math.sqrt(-1.0)` → `Double.NaN`.
- Floating-point results are rounded to nearest, ties to even (IEEE 754 default mode).
- `strictfp` (obsolete Java 17+) enforced IEEE 754 strict evaluation; now default everywhere.

### 5.3 `null` Reference Behavior (JLS §4.1)
- Dereferencing `null` throws `NullPointerException`.
- Java 14+ NPEs include helpful null-detail messages (JEP 358).
- `null instanceof T` always returns `false` without throwing.

### 5.4 String Interning (JLS §3.10.5)
- String literals are interned — all references to `"hello"` point to the same `String` object.
- `new String("hello")` creates a new object (not interned by default).
- `String.intern()` returns the canonical interned version.

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior per JLS |
|-----------|-----------------|
| Integer division by zero | `ArithmeticException` thrown (JLS §15.17.2) |
| Floating-point division by zero | Returns infinity or NaN (JLS §4.2.3) |
| Integer overflow | Silent wraparound (two's complement) |
| `NaN == NaN` | `false` (always, per IEEE 754) |
| `null == null` | `true` |
| `null instanceof Foo` | `false` (JLS §15.20.2) |
| Array access out of bounds | `ArrayIndexOutOfBoundsException` |
| Negative array size | `NegativeArraySizeException` |
| `char` arithmetic | Promoted to `int`; result is `int` not `char` |
| `long` literal without `L` > `int` range | Compile-time error |

---

## 7. Edge Cases from Spec

### 7.1 Integer Shift Edge Cases
```java
int x = 1;
System.out.println(x << 32);  // == 1 (32 mod 32 == 0, not 0!)
System.out.println(x << 33);  // == 2 (33 mod 32 == 1)
long y = 1L;
System.out.println(y << 64);  // == 1L (64 mod 64 == 0)
```

### 7.2 `char` as Integer
```java
char c = 'A';           // 65
int i = c + 1;          // 66 (int, not char)
char next = (char)(c + 1); // 'B' — explicit cast back to char
System.out.println('a' + 'b'); // prints 195 (int arithmetic)
```

### 7.3 Floating-Point Precision
```java
System.out.println(0.1 + 0.2);      // 0.30000000000000004 (IEEE 754)
System.out.println(0.1f + 0.2f);    // 0.3 (float rounds differently)
System.out.println(1.0 / 0.0);      // Infinity
System.out.println(-1.0 / 0.0);     // -Infinity
System.out.println(0.0 / 0.0);      // NaN
System.out.println(Double.NaN == Double.NaN); // false
```

### 7.4 Negative Zero
```java
double nz = -0.0;
double pz = 0.0;
System.out.println(nz == pz);       // true
System.out.println(1.0 / nz);       // -Infinity
System.out.println(1.0 / pz);       // +Infinity
```

### 7.5 Array Covariance Trap
```java
String[] strings = new String[3];
Object[] objects = strings;          // legal at compile time (covariance)
objects[0] = new Integer(42);        // compiles but throws ArrayStoreException at runtime
```

### 7.6 `boolean` Is Not Numeric
```java
// boolean cannot be compared with 0 or 1
boolean b = true;
// if (b == 1) { }  // COMPILE ERROR: incompatible types
// int n = b ? 1 : 0;  // OK — ternary operator
```

---

## 8. Version History

| Java Version | Change | JEP/Reference |
|-------------|--------|---------------|
| Java 1.0 | All 8 primitive types defined; `Object`, arrays | JLS 1st ed. |
| Java 5 | Autoboxing/unboxing; generics with type erasure | JSR 14, JSR 201 |
| Java 5 | Enhanced for loop over arrays and `Iterable` | JSR 201 |
| Java 7 | Binary literals (`0b101`); underscores in literals | JLS §3.10.1 |
| Java 8 | `Integer.parseUnsignedInt()`, `Long.compareUnsigned()` | JDK-8 API |
| Java 9 | `var` in limited contexts (not data type per se) | — |
| Java 10 | `var` for local variable type inference | JEP 286 |
| Java 14 | Helpful NullPointerException messages | JEP 358 |
| Java 15 | Text blocks: `String` with multiline literal | JEP 378 |
| Java 16 | Records: transparent data carrier types | JEP 395 |
| Java 17 | `strictfp` obsolete (IEEE 754 default everywhere) | JEP 306 |
| Java 21 | Pattern matching for `switch` (standard) | JEP 441 |

---

## 9. Implementation-Specific Behavior (JVM-Specific)

### 9.1 `boolean` in JVM
- JVM Spec §2.3.4: `boolean` has no dedicated bytecode type.
- `boolean` arrays use `baload`/`bastore` (byte instructions).
- `boolean` values are represented as `int` 0 (`false`) and 1 (`true`) in most contexts.

### 9.2 `float` vs `double` Performance
- On modern 64-bit JVMs, `double` operations are not significantly slower than `float`.
- `float` saves memory in arrays (4 bytes vs 8 bytes per element).
- Avoid mixing `float` and `double` arithmetic — implicit widening occurs.

### 9.3 Integer Caching
- `Integer.valueOf(n)` caches instances for values -128 to 127 (JLS §5.1.7, autoboxing).
- `new Integer(n)` always creates a new object (deprecated Java 9+).
- This makes `Integer.valueOf(127) == Integer.valueOf(127)` true, but `Integer.valueOf(128) == Integer.valueOf(128)` potentially false.

### 9.4 String Pool
- HotSpot JVM maintains a string pool (interned strings) in the Heap (moved from PermGen in Java 8).
- String literals are automatically interned at load time.
- `String.intern()` can place any string in the pool.

---

## 10. Spec Compliance Checklist

- [ ] Integer literals > `int` range use `L` suffix (e.g., `long x = 3000000000L`)
- [ ] Floating-point literals use `f`/`F` for `float`, `d`/`D` or nothing for `double`
- [ ] `char` arithmetic results are `int` — cast back to `char` if needed
- [ ] `NaN` comparisons use `Double.isNaN()` / `Float.isNaN()`, not `==`
- [ ] Array bounds are checked at runtime (no off-by-one assumptions)
- [ ] `boolean` cannot be cast to/from numeric types
- [ ] Narrowing conversions use explicit cast
- [ ] Generic type information is erased at runtime — no runtime `instanceof` with type parameters
- [ ] `null` check before method calls on reference types
- [ ] Integer overflow is silent — use `Math.*Exact()` for checked arithmetic

---

## 11. Official Examples (Compilable Java 21 Code)

```java
// Example 1: Primitive Type Ranges
// File: PrimitiveTypes.java
public class PrimitiveTypes {
    public static void main(String[] args) {
        // Integer types
        byte b = Byte.MAX_VALUE;           // 127
        short s = Short.MAX_VALUE;         // 32767
        int i = Integer.MAX_VALUE;         // 2147483647
        long l = Long.MAX_VALUE;           // 9223372036854775807

        // Floating-point types
        float f = Float.MAX_VALUE;         // ~3.4028235E38
        double d = Double.MAX_VALUE;       // ~1.7976931348623157E308

        // char
        char c = Character.MAX_VALUE;      // '\uFFFF' = 65535
        System.out.println("char max: " + (int) c);

        // boolean
        boolean flag = true;

        // Binary and hex literals (Java 7+)
        int binary = 0b1010_1010;          // 170
        int hex = 0xFF_00_FF;              // 16711935
        long bigNum = 1_000_000_000L;      // 1 billion

        System.out.println("binary: " + binary);
        System.out.println("hex: " + hex);
        System.out.println("bigNum: " + bigNum);
    }
}
```

```java
// Example 2: Floating-Point Special Values
// File: FloatingPointEdges.java
public class FloatingPointEdges {
    public static void main(String[] args) {
        // IEEE 754 special values
        double posInf  = Double.POSITIVE_INFINITY;  // 1.0/0.0
        double negInf  = Double.NEGATIVE_INFINITY;  // -1.0/0.0
        double nan     = Double.NaN;                // 0.0/0.0
        double negZero = -0.0;

        System.out.println("1.0 / 0.0 = " + (1.0 / 0.0));       // Infinity
        System.out.println("-1.0 / 0.0 = " + (-1.0 / 0.0));     // -Infinity
        System.out.println("0.0 / 0.0 = " + (0.0 / 0.0));       // NaN
        System.out.println("NaN == NaN: " + (nan == nan));       // false
        System.out.println("isNaN: " + Double.isNaN(nan));       // true
        System.out.println("-0.0 == 0.0: " + (negZero == 0.0)); // true
        System.out.println("1/-0.0: " + (1.0 / negZero));       // -Infinity
        System.out.println("Infinity + 1: " + (posInf + 1));    // Infinity
        System.out.println("Infinity - Infinity: " + (posInf - posInf)); // NaN
    }
}
```

```java
// Example 3: Integer Overflow and Checked Arithmetic
// File: IntegerOverflow.java
public class IntegerOverflow {
    public static void main(String[] args) {
        // Silent overflow (wraparound)
        int maxInt = Integer.MAX_VALUE;
        System.out.println(maxInt + 1);   // -2147483648 (wraps!)

        // Checked arithmetic (Java 8+)
        try {
            int result = Math.addExact(Integer.MAX_VALUE, 1);
        } catch (ArithmeticException e) {
            System.out.println("Overflow detected: " + e.getMessage());
        }

        // Unsigned operations (Java 8+)
        int unsignedMax = -1;  // all bits set = max unsigned value
        System.out.println(Integer.toUnsignedString(unsignedMax)); // 4294967295
        System.out.println(Integer.compareUnsigned(-1, 1));        // positive (−1 > 1 unsigned)
    }
}
```

```java
// Example 4: Reference Types and Null
// File: ReferenceTypes.java
import java.util.List;
import java.util.ArrayList;

public class ReferenceTypes {
    public static void main(String[] args) {
        // null is the default reference
        String s = null;
        System.out.println(s instanceof String); // false (not an NPE)

        // Helpful NPE messages (Java 14+, JEP 358)
        try {
            String str = null;
            int len = str.length();  // NPE with detail message
        } catch (NullPointerException e) {
            System.out.println("NPE: " + e.getMessage());
        }

        // Array covariance
        String[] strings = {"a", "b"};
        Object[] objects = strings;  // widening — OK at compile time
        try {
            objects[0] = 42;  // ArrayStoreException at runtime
        } catch (ArrayStoreException e) {
            System.out.println("ArrayStoreException: " + e.getMessage());
        }

        // Generic type erasure
        List<String> strList = new ArrayList<>();
        List<Integer> intList = new ArrayList<>();
        System.out.println(strList.getClass() == intList.getClass()); // true — same raw type
    }
}
```

```java
// Example 5: char Arithmetic and Unicode
// File: CharTypes.java
public class CharTypes {
    public static void main(String[] args) {
        char a = 'A';
        char z = 'z';

        // char arithmetic produces int
        int diff = z - a;
        System.out.println("z - A = " + diff);          // 57

        // Casting back to char
        char next = (char)(a + 1);
        System.out.println("A + 1 = " + next);          // B

        // Unicode supplementary character (requires two chars)
        String emoji = "\uD83D\uDE00";  // Grinning face U+1F600
        System.out.println("Emoji length: " + emoji.length());       // 2 (two char code units)
        System.out.println("Emoji codePointCount: " +
            emoji.codePointCount(0, emoji.length()));                 // 1

        // char as unsigned integer
        char max = '\uFFFF';
        System.out.println("char max as int: " + (int) max);        // 65535

        // Iterating code points (handles supplementary chars)
        "Hello\uD83D\uDE00".codePoints()
            .forEach(cp -> System.out.printf("U+%04X ", cp));
        System.out.println();
    }
}
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| JLS §4 | Types, Values, Variables | https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html |
| JLS §5 | Conversions and Contexts | https://docs.oracle.com/javase/specs/jls/se21/html/jls-5.html |
| JLS §10 | Arrays | https://docs.oracle.com/javase/specs/jls/se21/html/jls-10.html |
| JLS §15.17 | Multiplicative Operators (division by zero) | https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html#jls-15.17 |
| JVMS §2.3 | Primitive Types | https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-2.html#jvms-2.3 |
| JVMS §2.4 | Reference Types | https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-2.html#jvms-2.4 |
| JEP 358 | Helpful NullPointerExceptions | https://openjdk.org/jeps/358 |
| JEP 395 | Records | https://openjdk.org/jeps/395 |
| JEP 441 | Pattern Matching for switch | https://openjdk.org/jeps/441 |
