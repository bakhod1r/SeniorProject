# Java Language Specification — Type Casting
## Source: https://docs.oracle.com/javase/specs/jls/se21/html/jls-5.html

---

## 1. Spec Reference

- **JLS Chapter 5**: Conversions and Contexts — https://docs.oracle.com/javase/specs/jls/se21/html/jls-5.html
- **JLS §5.1**: Kinds of Conversion
- **JLS §5.1.1**: Identity Conversion
- **JLS §5.1.2**: Widening Primitive Conversion
- **JLS §5.1.3**: Narrowing Primitive Conversion
- **JLS §5.1.4**: Widening and Narrowing Primitive Conversion
- **JLS §5.1.5**: Widening Reference Conversion
- **JLS §5.1.6**: Narrowing Reference Conversion
- **JLS §5.1.7**: Boxing Conversion
- **JLS §5.1.8**: Unboxing Conversion
- **JLS §5.1.9**: Unchecked Conversion
- **JLS §5.1.10**: Capture Conversion
- **JLS §5.2**: Assignment Contexts
- **JLS §5.3**: Invocation Contexts
- **JLS §5.4**: String Contexts
- **JLS §5.5**: Casting Contexts
- **JLS §5.6**: Numeric Contexts
- **JLS §15.16**: Cast Expressions

---

## 2. Formal Grammar (BNF from JLS)

```
-- JLS §15.16: Cast Expressions --
CastExpression:
    ( PrimitiveType ) UnaryExpression
    ( ReferenceType {AdditionalBound} ) UnaryExpressionNotPlusMinus
    ( ReferenceType {AdditionalBound} ) LambdaExpression

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

ReferenceType:
    ClassOrInterfaceType
    TypeVariable
    ArrayType

AdditionalBound:
    & InterfaceType

-- JLS §5.5: Casting Contexts --
-- Legal cast conversions:
--   identity conversion
--   widening primitive conversion
--   narrowing primitive conversion
--   widening and narrowing primitive conversion (byte→char)
--   widening reference conversion
--   narrowing reference conversion
--   boxing conversion
--   unboxing conversion
--   unchecked conversion

-- JLS §15.20.2: The instanceof Operator --
RelationalExpression:
    RelationalExpression instanceof ReferenceType
    RelationalExpression instanceof Pattern

Pattern:
    TypePattern
    RecordPattern   (Java 21)

TypePattern:
    {TypePatternModifier} ReferenceType Identifier

RecordPattern:
    ReferenceType ( [PatternList] )

PatternList:
    Pattern { , Pattern }
```

---

## 3. Core Rules & Constraints

### 3.1 Widening Primitive Conversions (JLS §5.1.2)
The following 19 widening primitive conversions are defined:
```
byte   → short, int, long, float, double
short  → int, long, float, double
char   → int, long, float, double
int    → long, float, double
long   → float, double
float  → double
```
- These conversions are performed implicitly in assignment, invocation, and numeric contexts.
- **Information loss may occur**: `int` to `float` may lose precision for values > 2^24.
- All widening primitive conversions to a larger integer type are lossless.

### 3.2 Narrowing Primitive Conversions (JLS §5.1.3)
```
short  → byte, char
char   → byte, short
int    → byte, short, char
long   → byte, short, char, int
float  → byte, short, char, int, long
double → byte, short, char, int, long, float
```
- Requires **explicit cast** syntax.
- May produce unexpected results: truncation, sign change, magnitude loss.
- Special rule: `byte` → `char` is a widening-and-narrowing conversion (widened to `int` first, then narrowed to `char`).

### 3.3 Widening Reference Conversions (JLS §5.1.5)
- Any class to a superclass or superinterface.
- Any interface to `Object`.
- Array type `T[]` to `Object`, `Cloneable`, `Serializable`.
- `null` to any reference type.
- No runtime check needed; always safe.

### 3.4 Narrowing Reference Conversions (JLS §5.1.6)
- Requires explicit cast and may throw `ClassCastException` at runtime.
- A cast from `Object` to `String`: checked at runtime via `checkcast` bytecode.
- The compiler allows the cast if the types are not provably incompatible.
- **Unchecked** casts involving generic types generate compiler warnings.

### 3.5 Boxing and Unboxing (JLS §5.1.7, §5.1.8)
| Primitive | Wrapper |
|-----------|---------|
| `boolean` | `Boolean` |
| `byte` | `Byte` |
| `char` | `Character` |
| `short` | `Short` |
| `int` | `Integer` |
| `long` | `Long` |
| `float` | `Float` |
| `double` | `Double` |

- Autoboxing: `int` → `Integer` via `Integer.valueOf(int)`.
- Autounboxing: `Integer` → `int` via `Integer.intValue()`.
- Unboxing `null` throws `NullPointerException`.
- Integer caching: values -128 to 127 are cached (same object).

---

## 4. Type Rules

### 4.1 Cast Expression Rules (JLS §5.5)
- A cast `(T) e` is legal if:
  1. There exists a legal conversion sequence from `e`'s type to `T`, OR
  2. Both types are reference types and one could be a subtype of the other.
- A cast is a **compile-time error** if the types are provably disjoint (e.g., casting `String` to `Integer` — both are final).

### 4.2 Numeric Promotion (JLS §5.6)
Numeric promotion applies in binary numeric operations:
1. If either operand is `double`, the other is widened to `double`.
2. Else if either operand is `float`, the other is widened to `float`.
3. Else if either operand is `long`, the other is widened to `long`.
4. Otherwise, both are widened to `int`.

This means `byte + byte` produces `int`, not `byte`.

### 4.3 String Conversion (JLS §5.4)
- In string concatenation (`+`), any operand not already a `String` is converted via `toString()` or `String.valueOf()`.
- `null` is converted to the string `"null"`.
- This applies recursively to all components of a concatenation chain.

### 4.4 `instanceof` Type Check (JLS §15.20.2)
- `obj instanceof T` returns `true` if `obj` is non-null and is an instance of `T`.
- The compile-time type of `obj` must be a reference type.
- Java 16+: `obj instanceof T t` declares pattern variable `t` of type `T`.
- Java 21: `obj instanceof R(T1 t1, T2 t2)` — record pattern deconstruction.

### 4.5 Unchecked Conversions (JLS §5.1.9)
- From raw type to parameterized type: `List` → `List<String>`.
- Generates unchecked warning; the cast is allowed but unsafe.
- Type safety can be compromised — may cause `ClassCastException` at unexpected points.

---

## 5. Behavioral Specification

### 5.1 Narrowing Primitive Conversion Details (JLS §5.1.3)
**Integer narrowing:**
- Discards all bits except the lowest N bits (where N is the width of the target type).
- `(byte) 300` = `44` (300 = 0b1_0010_1100, keep low 8 bits = 0b0010_1100 = 44).

**Floating-point to integer narrowing:**
- If the value is NaN → 0.
- If the value is too large for the int range → `Integer.MAX_VALUE` or `Integer.MIN_VALUE`.
- If the value is too small (close to 0) → 0.
- Otherwise: truncate toward zero (round toward zero, NOT toward nearest).

### 5.2 Runtime Cast Check (JLS §5.5.1)
- `checkcast` JVM instruction verifies that an object is an instance of the target type.
- If check fails: `ClassCastException` is thrown.
- `ClassCastException` carries a message naming the actual type and the expected type (Java 14+, JEP 358).

### 5.3 Autoboxing/Unboxing in Expressions
- Autoboxing/unboxing is inserted by `javac` transparently.
- Example: `Integer i = 5;` → `Integer i = Integer.valueOf(5);`
- Example: `int j = i;` → `int j = i.intValue();`
- Unboxing null reference: `Integer n = null; int m = n;` → NPE at `n.intValue()`.

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior per JLS |
|-----------|-----------------|
| `(byte) 300` | `44` (bit truncation, defined) |
| `(int) Double.NaN` | `0` (defined in §5.1.3) |
| `(int) Double.POSITIVE_INFINITY` | `Integer.MAX_VALUE` |
| `(int) Double.NEGATIVE_INFINITY` | `Integer.MIN_VALUE` |
| `(int) 1.9` | `1` (truncation toward zero) |
| `(int) -1.9` | `-1` (truncation toward zero) |
| `ClassCastException` at runtime | Object is not instance of target type |
| Unchecked cast warning | Compiler warning; allowed but unsafe |
| Unboxing `null` | `NullPointerException` |
| `Integer.valueOf(127) == Integer.valueOf(127)` | `true` (cached) |
| `Integer.valueOf(200) == Integer.valueOf(200)` | `false` (not cached) |
| `int` → `float` (large value) | May lose precision (defined, warned) |

---

## 7. Edge Cases from Spec

### 7.1 Bit Truncation in Narrowing
```java
int i = 300;
byte b = (byte) i;   // 300 = 256 + 44; low 8 bits = 44
System.out.println(b);   // 44

int j = -129;
byte b2 = (byte) j;  // -129 mod 256 = 127
System.out.println(b2);  // 127
```

### 7.2 float-to-int Truncation
```java
System.out.println((int) 1.9999);   // 1 (truncated, not rounded)
System.out.println((int) -1.9999);  // -1 (toward zero, not -2)
System.out.println((int) Float.NaN); // 0
System.out.println((int) 1e18);     // 1000000000 (capped at MAX_VALUE... wait)
// Actually: (int) 1e18 is Integer.MAX_VALUE = 2147483647
```

### 7.3 Integer Caching Trap
```java
Integer a = 127;
Integer b = 127;
System.out.println(a == b);    // true (cached)

Integer c = 128;
Integer d = 128;
System.out.println(c == d);    // false (NOT cached — different objects)
System.out.println(c.equals(d)); // true
```

### 7.4 byte+byte = int
```java
byte x = 10;
byte y = 20;
// byte z = x + y;   // COMPILE ERROR: int cannot be converted to byte
byte z = (byte)(x + y);  // explicit cast required
int sum = x + y;         // widened to int automatically
```

### 7.5 Unchecked Cast Warning
```java
@SuppressWarnings("unchecked")
List<String> strings = (List<String>) getRawList();  // unchecked cast
// ClassCastException may occur much later when iterating
```

### 7.6 Record Pattern Deconstruction (Java 21)
```java
record Point(int x, int y) {}
Object obj = new Point(3, 4);
if (obj instanceof Point(int x, int y)) {
    System.out.println("x=" + x + " y=" + y);  // deconstructs record
}
```

---

## 8. Version History

| Java Version | Change | JEP/Reference |
|-------------|--------|---------------|
| Java 1.0 | Primitive casts, widening/narrowing defined | JLS 1st ed. |
| Java 5 | Autoboxing/unboxing; generics unchecked casts | JSR 14, JSR 201 |
| Java 8 | Cast context for lambda expressions | JEP 126 |
| Java 14 | Helpful ClassCastException messages | JEP 358 |
| Java 16 | Pattern matching `instanceof` (standard) — TypePattern | JEP 394 |
| Java 17 | Sealed classes interplay with casting | JEP 409 |
| Java 21 | Pattern matching `switch`; record patterns (standard) | JEP 440, JEP 441 |
| Java 21 | Unnamed patterns and variables (preview) | JEP 443 |

---

## 9. Implementation-Specific Behavior (JVM-Specific)

### 9.1 JVM Bytecode for Casting
| Cast | Bytecode |
|------|---------|
| `(int) longVal` | `l2i` |
| `(long) intVal` | `i2l` |
| `(float) intVal` | `i2f` |
| `(double) intVal` | `i2d` |
| `(int) floatVal` | `f2i` |
| `(int) doubleVal` | `d2i` |
| `(byte) intVal` | `i2b` |
| `(char) intVal` | `i2c` |
| `(short) intVal` | `i2s` |
| Reference cast | `checkcast #TypeRef` |

### 9.2 JIT Optimization of Casts
- HotSpot JIT may eliminate `checkcast` instructions if the type is provably correct through type profiling.
- Speculative inlining can cause deoptimization if a surprising type appears at a cast.

### 9.3 Autoboxing Performance
- Frequent autoboxing in tight loops causes many small heap allocations.
- JIT's escape analysis may eliminate some boxing (stack-allocated `Integer` objects).
- Prefer primitive types in performance-critical code; use `IntStream` over `Stream<Integer>`.

### 9.4 Generics Type Erasure at Runtime
- Cast `(List<String>) obj` compiles to `(List) obj` + no runtime type parameter check.
- Only the raw type `List` is checked at runtime.
- Type parameter checks must be done manually via `instanceof` on each element.

---

## 10. Spec Compliance Checklist

- [ ] Widening conversions used without cast where applicable
- [ ] Narrowing conversions use explicit cast syntax
- [ ] `byte`/`short` arithmetic result cast back if `byte`/`short` result is needed
- [ ] Floating-point to integer: truncation toward zero is intended behavior
- [ ] `NaN` → `int` = `0` is handled correctly
- [ ] Autoboxing `null` checked before unboxing
- [ ] Integer wrapper `==` comparison uses `.equals()` for non-cached range
- [ ] `instanceof` before narrowing reference cast
- [ ] Unchecked cast warnings suppressed only when heap pollution is documented
- [ ] Pattern variables used with correct scope after `instanceof`

---

## 11. Official Examples (Compilable Java 21 Code)

```java
// Example 1: Widening and Narrowing Primitives
// File: PrimitiveCasts.java
public class PrimitiveCasts {
    public static void main(String[] args) {
        // Widening (implicit)
        byte b = 42;
        short s = b;   // byte → short
        int i = s;     // short → int
        long l = i;    // int → long
        float f = l;   // long → float (potential precision loss!)
        double d = f;  // float → double

        System.out.println("double: " + d);

        // Narrowing (requires explicit cast)
        double pi = 3.14159;
        int piInt = (int) pi;       // truncation: 3
        byte piByte = (byte) piInt; // truncation: 3 (fits)

        System.out.println("pi truncated: " + piInt);

        // Tricky narrowing
        int big = 300;
        byte small = (byte) big;   // 44 (bit truncation)
        System.out.println("300 as byte: " + small);

        // float-to-int truncation (not rounding)
        System.out.println("(int) 2.9 = " + (int) 2.9);    // 2
        System.out.println("(int) -2.9 = " + (int) -2.9);  // -2

        // Special float values to int
        System.out.println("NaN→int: " + (int) Double.NaN);                    // 0
        System.out.println("Inf→int: " + (int) Double.POSITIVE_INFINITY);      // 2147483647
        System.out.println("-Inf→int: " + (int) Double.NEGATIVE_INFINITY);     // -2147483648
    }
}
```

```java
// Example 2: Reference Casting
// File: ReferenceCasts.java
public class ReferenceCasts {

    static class Animal {
        String sound() { return "..."; }
    }

    static class Dog extends Animal {
        @Override String sound() { return "Woof"; }
        String fetch() { return "Fetching!"; }
    }

    static class Cat extends Animal {
        @Override String sound() { return "Meow"; }
    }

    public static void main(String[] args) {
        Animal a = new Dog();  // widening (upcasting) — no cast needed

        // Narrowing (downcasting) — needs explicit cast
        Dog d = (Dog) a;       // safe: a IS a Dog
        System.out.println(d.fetch());

        // ClassCastException at runtime
        Animal c = new Cat();
        try {
            Dog d2 = (Dog) c;   // Cat is not a Dog!
        } catch (ClassCastException e) {
            System.out.println("Cast failed: " + e.getMessage());
        }

        // Safe pattern: instanceof before cast
        Animal[] animals = { new Dog(), new Cat(), new Dog() };
        for (Animal animal : animals) {
            if (animal instanceof Dog dog) {  // pattern variable (Java 16+)
                System.out.println("Dog says: " + dog.fetch());
            }
        }
    }
}
```

```java
// Example 3: Autoboxing and Unboxing
// File: AutoboxingDemo.java
import java.util.ArrayList;
import java.util.List;

public class AutoboxingDemo {
    public static void main(String[] args) {
        // Autoboxing: int → Integer
        Integer boxed = 42;              // Integer.valueOf(42)
        int unboxed = boxed;             // boxed.intValue()

        // Caching: -128 to 127
        Integer a = 127;
        Integer b = 127;
        System.out.println(a == b);      // true (cached)

        Integer c = 200;
        Integer d = 200;
        System.out.println(c == d);      // false (different objects)
        System.out.println(c.equals(d)); // true (same value)

        // Null unboxing → NullPointerException
        Integer n = null;
        try {
            int x = n;  // n.intValue() → NPE
        } catch (NullPointerException e) {
            System.out.println("Unboxed null! " + e.getMessage());
        }

        // Mixed arithmetic triggers unboxing
        Integer sum = 10;
        sum = sum + 5;  // unboxed to int, added, re-boxed
        System.out.println("sum: " + sum);

        // Collections require reference types
        List<Integer> numbers = new ArrayList<>();
        numbers.add(1);  // autoboxed
        numbers.add(2);
        int total = 0;
        for (int num : numbers) {  // autounboxed in each iteration
            total += num;
        }
        System.out.println("total: " + total);
    }
}
```

```java
// Example 4: Numeric Promotion
// File: NumericPromotion.java
public class NumericPromotion {
    public static void main(String[] args) {
        // byte + byte = int (promotion!)
        byte x = 10;
        byte y = 20;
        // byte result = x + y;  // COMPILE ERROR
        int result = x + y;      // OK: both promoted to int
        byte cast = (byte)(x + y); // explicit cast back

        // char arithmetic
        char c1 = 'A';  // 65
        char c2 = 'B';  // 66
        // char sum = c1 + c2;  // COMPILE ERROR: result is int
        int charSum = c1 + c2;    // 131
        System.out.println("A+B = " + charSum);

        // Mixed int and long
        int i = Integer.MAX_VALUE;
        long l = i + 1L;    // i promoted to long first
        System.out.println("int max + 1L = " + l);  // not overflow

        // int + int overflow (no long promotion)
        long bad = i + 1;   // i+1 computed as int (overflow!), then stored to long
        System.out.println("int overflow + long store = " + bad);  // -2147483648

        // float vs double precision
        float f = 1.0f / 3.0f;
        double d = 1.0 / 3.0;
        System.out.printf("float:  %.20f%n", (double) f);
        System.out.printf("double: %.20f%n", d);
    }
}
```

```java
// Example 5: Pattern Matching — instanceof and switch (Java 21)
// File: PatternCasting.java
public class PatternCasting {

    sealed interface Expr permits Num, Add, Mul {}
    record Num(int value) implements Expr {}
    record Add(Expr left, Expr right) implements Expr {}
    record Mul(Expr left, Expr right) implements Expr {}

    static int eval(Expr expr) {
        return switch (expr) {
            case Num(int v)             -> v;
            case Add(Expr l, Expr r)    -> eval(l) + eval(r);
            case Mul(Expr l, Expr r)    -> eval(l) * eval(r);
        };
    }

    static String format(Expr expr) {
        return switch (expr) {
            case Num(int v)             -> String.valueOf(v);
            case Add(Expr l, Expr r)    -> "(" + format(l) + " + " + format(r) + ")";
            case Mul(Expr l, Expr r)    -> "(" + format(l) + " * " + format(r) + ")";
        };
    }

    public static void main(String[] args) {
        // (2 + 3) * 4
        Expr expr = new Mul(new Add(new Num(2), new Num(3)), new Num(4));
        System.out.println(format(expr) + " = " + eval(expr));  // (2 + 3) * 4 = 20
    }
}
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| JLS §5 | Conversions and Contexts | https://docs.oracle.com/javase/specs/jls/se21/html/jls-5.html |
| JLS §5.1.2 | Widening Primitive Conversion | https://docs.oracle.com/javase/specs/jls/se21/html/jls-5.html#jls-5.1.2 |
| JLS §5.1.3 | Narrowing Primitive Conversion | https://docs.oracle.com/javase/specs/jls/se21/html/jls-5.html#jls-5.1.3 |
| JLS §5.1.7 | Boxing Conversion | https://docs.oracle.com/javase/specs/jls/se21/html/jls-5.html#jls-5.1.7 |
| JLS §5.5 | Casting Contexts | https://docs.oracle.com/javase/specs/jls/se21/html/jls-5.html#jls-5.5 |
| JLS §15.16 | Cast Expressions | https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html#jls-15.16 |
| JLS §15.20 | Relational Operators (instanceof) | https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html#jls-15.20 |
| JVMS §6 | checkcast Instruction | https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-6.html |
| JEP 394 | Pattern Matching instanceof | https://openjdk.org/jeps/394 |
| JEP 440 | Record Patterns | https://openjdk.org/jeps/440 |
| JEP 441 | Pattern Matching switch | https://openjdk.org/jeps/441 |
