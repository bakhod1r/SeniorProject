# Java Language Specification — Math Operations
## Source: https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html

---

## 1. Spec Reference

- **JLS Chapter 15**: Expressions — https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html
- **JLS §15.14**: Postfix Expressions (`x++`, `x--`)
- **JLS §15.15**: Unary Operators (`+x`, `-x`, `++x`, `--x`, `~`, `!`)
- **JLS §15.17**: Multiplicative Operators (`*`, `/`, `%`)
- **JLS §15.18**: Additive Operators (`+`, `-`)
- **JLS §15.19**: Shift Operators (`<<`, `>>`, `>>>`)
- **JLS §15.20**: Relational Operators (`<`, `>`, `<=`, `>=`, `instanceof`)
- **JLS §15.21**: Equality Operators (`==`, `!=`)
- **JLS §15.22**: Bitwise and Logical Operators (`&`, `|`, `^`)
- **JLS §15.23**: Conditional-And Operator (`&&`)
- **JLS §15.24**: Conditional-Or Operator (`||`)
- **JLS §15.25**: Conditional Operator (`? :`)
- **JLS §15.26**: Assignment Operators (`=`, `+=`, `-=`, etc.)
- **JLS §4.2.2**: Integer Operations
- **JLS §4.2.4**: Floating-Point Operations

---

## 2. Formal Grammar (BNF from JLS)

```
-- JLS §15: Operator Precedence (high to low) --
-- 1. Postfix:           expr++  expr--
-- 2. Unary:             ++expr  --expr  +expr  -expr  ~  !
-- 3. Cast:              (type) expr
-- 4. Multiplicative:    *  /  %
-- 5. Additive:          +  -
-- 6. Shift:             <<  >>  >>>
-- 7. Relational:        <  >  <=  >=  instanceof
-- 8. Equality:          ==  !=
-- 9. Bitwise AND:       &
-- 10. Bitwise XOR:      ^
-- 11. Bitwise OR:       |
-- 12. Logical AND:      &&
-- 13. Logical OR:       ||
-- 14. Ternary:          ? :
-- 15. Assignment:       =  +=  -=  *=  /=  %=  &=  |=  ^=  <<=  >>=  >>>=

-- JLS §15.17: Multiplicative Operators --
MultiplicativeExpression:
    UnaryExpression
    MultiplicativeExpression * UnaryExpression
    MultiplicativeExpression / UnaryExpression
    MultiplicativeExpression % UnaryExpression

-- JLS §15.18: Additive Operators --
AdditiveExpression:
    MultiplicativeExpression
    AdditiveExpression + MultiplicativeExpression
    AdditiveExpression - MultiplicativeExpression

-- JLS §15.19: Shift Operators --
ShiftExpression:
    AdditiveExpression
    ShiftExpression << AdditiveExpression
    ShiftExpression >> AdditiveExpression
    ShiftExpression >>> AdditiveExpression

-- JLS §15.22: Bitwise and Logical Operators --
AndExpression:
    EqualityExpression
    AndExpression & EqualityExpression

ExclusiveOrExpression:
    AndExpression
    ExclusiveOrExpression ^ AndExpression

InclusiveOrExpression:
    ExclusiveOrExpression
    InclusiveOrExpression | ExclusiveOrExpression

-- JLS §15.26: Assignment Operators --
AssignmentOperator: one of
    =  *=  /=  %=  +=  -=  <<=  >>=  >>>=  &=  ^=  |=

-- JLS §15.25: Conditional (Ternary) Operator --
ConditionalExpression:
    ConditionalOrExpression
    ConditionalOrExpression ? Expression : ConditionalExpression
    ConditionalOrExpression ? Expression : LambdaExpression

-- JLS §15.14.2: Postfix Increment Operator --
PostfixExpression:
    Primary
    ExpressionName
    PostIncrementExpression
    PostDecrementExpression

PostIncrementExpression:
    PostfixExpression ++

PostDecrementExpression:
    PostfixExpression --
```

---

## 3. Core Rules & Constraints

### 3.1 Operator Associativity (JLS §15)
- Most binary operators are **left-associative**: `a - b - c` = `(a - b) - c`.
- Assignment operators are **right-associative**: `a = b = c` = `a = (b = c)`.
- The ternary `? :` is **right-associative**.
- Precedence is fixed; use parentheses to override.

### 3.2 Integer Arithmetic Rules (JLS §4.2.2)
- Integer division truncates toward zero: `7 / 2 = 3`, `-7 / 2 = -3`.
- Modulo `%` satisfies: `(a/b)*b + (a%b) == a` for all `a`, `b` where `b != 0`.
- Division by zero for integer types → `ArithmeticException`.
- No implicit overflow detection; result wraps around (two's complement).
- The `%` result has the same sign as the dividend (not divisor).

### 3.3 Floating-Point Arithmetic Rules (JLS §4.2.4)
- IEEE 754-2019 standard.
- `1.0 / 0.0` → `+Infinity` (no exception).
- `0.0 / 0.0` → `NaN`.
- `NaN` comparison with any value (including itself) returns `false`, except `!=`.
- Java uses round-to-nearest-even as default rounding mode.

### 3.4 Shift Operator Rules (JLS §15.19)
- Left shift `<<`: `a << n` = `a * 2^n` (modular).
- Signed right shift `>>`: fills with sign bit (arithmetic shift).
- Unsigned right shift `>>>`: fills with 0 (logical shift).
- RHS is masked: `int << n` uses `n % 32`; `long << n` uses `n % 64`.
- Shift operators promote operands to at least `int`.

### 3.5 Bitwise Operator Rules (JLS §15.22)
- `&` (AND), `|` (OR), `^` (XOR), `~` (NOT — unary complement).
- Applied to `boolean`: no short-circuit (evaluates both sides).
- Applied to integers: bitwise operation on all bits.
- `~n` = `-n - 1` for any integer `n` (bitwise NOT = two's complement inversion).

### 3.6 Short-Circuit Evaluation (JLS §15.23, §15.24)
- `&&`: right side evaluated only if left side is `true`.
- `||`: right side evaluated only if left side is `false`.
- This is critical for null-safe patterns: `obj != null && obj.method()`.

---

## 4. Type Rules

### 4.1 Numeric Promotion in Operators (JLS §5.6)
- Unary numeric promotion: `byte`, `short`, `char` → `int`.
- Binary numeric promotion:
  - Either `double` → both `double`.
  - Else either `float` → both `float`.
  - Else either `long` → both `long`.
  - Otherwise → both `int`.

### 4.2 Integer vs Floating-Point Division
- `int / int` → integer division (no fractional part).
- `int / double` → `double` division (one operand widened).
- Force floating-point division: `(double) a / b` or `a * 1.0 / b`.

### 4.3 Compound Assignment Type Rules (JLS §15.26.2)
- `x += e` is equivalent to `x = (T)(x + e)` where `T` is the type of `x`.
- Implicit narrowing cast is performed: `byte b = 5; b += 3;` is legal (equivalent to `b = (byte)(b+3)`).
- This makes compound assignments on `byte`/`short` legal without explicit cast.

### 4.4 `Math` Class (Static Methods)
- `Math.abs(n)`: absolute value. Note: `Math.abs(Integer.MIN_VALUE)` returns `Integer.MIN_VALUE` (overflow!).
- `Math.max(a, b)` / `Math.min(a, b)`: maximum/minimum.
- `Math.pow(a, b)`: `a^b` as `double`.
- `Math.sqrt(n)`: square root as `double`. `sqrt(-1.0)` → `NaN`.
- `Math.log(n)`: natural logarithm. `log(0)` → `-Infinity`.
- `Math.log10(n)`: base-10 logarithm.
- `Math.floor(d)`, `Math.ceil(d)`, `Math.round(d)`: rounding functions.
- `Math.PI`, `Math.E`: double constants.

---

## 5. Behavioral Specification

### 5.1 Pre/Post Increment Behavior (JLS §15.14, §15.15)
- `x++`: evaluates to the **old** value of `x`, then increments `x`.
- `++x`: increments `x` first, then evaluates to the **new** value.
- `x--` and `--x` analogously for decrement.
- These operators have side effects and should not be used with aliased expressions.

### 5.2 Integer Modulo Semantics (JLS §15.17.3)
- `a % b` where `a` and `b` are integers:
  - `5 % 3 = 2`
  - `-5 % 3 = -2` (result sign follows dividend)
  - `5 % -3 = 2`
  - `-5 % -3 = -2`
- For floating-point `%`: uses `Math.IEEEremainder()` for IEEE remainder; `%` operator gives "truncated" remainder.

### 5.3 Bitwise Shift Behavior (JLS §15.19)
- For `int x = 1`:
  - `x << 1` = 2
  - `x << 31` = `Integer.MIN_VALUE` (sign bit set)
  - `x << 32` = 1 (32 mod 32 = 0, no shift)
  - `-1 >> 1` = -1 (arithmetic shift right, fills with 1)
  - `-1 >>> 1` = `Integer.MAX_VALUE` (logical shift right, fills with 0)

### 5.4 IEEE 754 Rounding Modes
- Java always uses round-to-nearest-even (banker's rounding) for floating-point.
- `strictfp` was used to force IEEE 754 strict evaluation (obsolete since Java 17).
- FPU fused multiply-add (FMA): `Math.fma(a, b, c)` = `a*b+c` with single rounding (Java 9+).

---

## 6. Defined vs Undefined Behavior

| Expression | Result | Reference |
|-----------|--------|-----------|
| `7 / 0` (int) | `ArithmeticException` | JLS §15.17.2 |
| `7.0 / 0.0` | `Infinity` | JLS §4.2.4 |
| `0 / 0` (int) | `ArithmeticException` | JLS §15.17.2 |
| `0.0 / 0.0` | `NaN` | JLS §4.2.4 |
| `7 % 0` (int) | `ArithmeticException` | JLS §15.17.3 |
| `Integer.MAX_VALUE + 1` | `-2147483648` (wrap) | JLS §4.2.2 |
| `1 << 32` | `1` (shift mod 32) | JLS §15.19 |
| `~0` | `-1` | JLS §15.15.5 |
| `Math.abs(Integer.MIN_VALUE)` | `Integer.MIN_VALUE` | java.lang.Math API |
| `-7 % 3` | `-1` | JLS §15.17.3 |
| `true & false` | `false` (no short-circuit) | JLS §15.22.2 |
| `true && false` | `false` (short-circuit) | JLS §15.23 |

---

## 7. Edge Cases from Spec

### 7.1 Integer Overflow Silently Wraps
```java
int max = Integer.MAX_VALUE;
System.out.println(max + 1);          // -2147483648 (no exception)
System.out.println(max * 2);          // -2 (wrap)

// Safe: Math.addExact throws ArithmeticException on overflow
int safe = Math.addExact(max, 1);     // throws ArithmeticException
```

### 7.2 Shift by Modular Amount
```java
int x = 1;
System.out.println(x << 32);   // 1 (not 0! — 32 mod 32 == 0)
System.out.println(x << 33);   // 2 (33 mod 32 == 1)
long y = 1L;
System.out.println(y << 64);   // 1L (64 mod 64 == 0)
```

### 7.3 Compound Assignment with Narrowing
```java
byte b = 100;
b += 50;  // legal: equivalent to b = (byte)(b + 50) = (byte)150 = -106
System.out.println(b);   // -106 (not a compile error!)
```

### 7.4 String Concatenation Operator Precedence
```java
System.out.println(1 + 2 + " apples");    // "3 apples" (1+2=3, then concat)
System.out.println("apples: " + 1 + 2);   // "apples: 12" (concat left to right)
System.out.println("apples: " + (1 + 2)); // "apples: 3"
```

### 7.5 Short-Circuit Evaluation Side Effects
```java
int count = 0;
boolean result = true || (++count > 0);  // right side NOT evaluated
System.out.println(count);  // 0 (not 1)

boolean result2 = false && (++count > 0); // right side NOT evaluated
System.out.println(count);  // still 0
```

### 7.6 `Math.abs` Overflow
```java
System.out.println(Math.abs(Integer.MIN_VALUE));  // -2147483648 (overflow!)
System.out.println(Math.abs(Long.MIN_VALUE));      // -9223372036854775808 (overflow!)
// Use Math.absExact() (Java 15+) for overflow detection:
Math.absExact(Integer.MIN_VALUE);  // throws ArithmeticException
```

---

## 8. Version History

| Java Version | Change | JEP/Reference |
|-------------|--------|---------------|
| Java 1.0 | All basic operators; `Math` class; IEEE 754 | JLS 1st ed. |
| Java 5 | `Math.log10()`, improved precision | JDK 5 API |
| Java 8 | `Math.addExact()`, `Math.subtractExact()`, `Math.multiplyExact()`, `Math.toIntExact()` | JDK 8 API |
| Java 9 | `Math.fma()` (fused multiply-add); `Math.multiplyHigh()` | JEP 215 |
| Java 14 | `Math.absExact()` (Java 15 actually) | JDK API |
| Java 15 | `Math.absExact(int)`, `Math.absExact(long)` | JDK-15 API |
| Java 17 | `strictfp` obsolete — IEEE 754 strict is now default for all | JEP 306 |
| Java 18 | `Math.clamp()` (preview in discussions) | JDK-21 |
| Java 21 | `Math.clamp(value, min, max)` — clamp to range | JDK-21 API |

---

## 9. Implementation-Specific Behavior (JVM-Specific)

### 9.1 JVM Bytecode for Arithmetic
| Operation | `int` bytecode | `long` bytecode | `float` | `double` |
|-----------|---------------|-----------------|---------|---------|
| add | `iadd` | `ladd` | `fadd` | `dadd` |
| sub | `isub` | `lsub` | `fsub` | `dsub` |
| mul | `imul` | `lmul` | `fmul` | `dmul` |
| div | `idiv` | `ldiv` | `fdiv` | `ddiv` |
| rem | `irem` | `lrem` | `frem` | `drem` |
| neg | `ineg` | `lneg` | `fneg` | `dneg` |
| shl | `ishl` | `lshl` | — | — |
| shr | `ishr` | `lshr` | — | — |
| ushr | `iushr` | `lushr` | — | — |
| and | `iand` | `land` | — | — |
| or | `ior` | `lor` | — | — |
| xor | `ixor` | `lxor` | — | — |

### 9.2 JIT Optimization of Arithmetic
- HotSpot JIT replaces `Math.abs(x)` with CPU `abs` instruction on x86.
- Integer multiply by 2 may compile to `shl 1` (left shift).
- Division by constant is replaced by multiply-and-shift sequence.
- Overflow checks (`Math.addExact`) are intrinsified by JIT.

### 9.3 Floating-Point Hardware
- x86/x64 JVMs use SSE2/AVX for `float` and `double` operations.
- Prior to Java 17, x87 FPU could produce 80-bit intermediate results; `strictfp` forced 64-bit.
- Java 17+ (JEP 306): always uses SSE2+; `strictfp` is a no-op.

### 9.4 `Math.random()` vs `ThreadLocalRandom`
- `Math.random()` uses a shared `Random` instance — contention under parallelism.
- `ThreadLocalRandom.current().nextDouble()` is preferred for concurrent use.
- `Math.random()` is seeded from `System.nanoTime()` by default.

---

## 10. Spec Compliance Checklist

- [ ] Integer division by zero is caught or prevented
- [ ] Integer overflow uses `Math.*Exact()` or intentional wraparound is documented
- [ ] Floating-point comparison avoids `==` for computed values; uses epsilon or `compareTo`
- [ ] `NaN` comparisons use `Double.isNaN()` not `==`
- [ ] Shift amounts are understood to be modular (mod 32 for int, mod 64 for long)
- [ ] `%` result sign follows dividend (negative dividend → negative result)
- [ ] Short-circuit operators (`&&`, `||`) used for null-safe chains
- [ ] `Math.abs(Integer.MIN_VALUE)` edge case handled
- [ ] Compound assignment (`+=`, etc.) implicit narrowing cast is intentional
- [ ] Operator precedence made explicit via parentheses when non-obvious

---

## 11. Official Examples (Compilable Java 21 Code)

```java
// Example 1: Arithmetic Operators
// File: ArithmeticOps.java
public class ArithmeticOps {
    public static void main(String[] args) {
        int a = 17, b = 5;

        System.out.println("a + b = " + (a + b));    // 22
        System.out.println("a - b = " + (a - b));    // 12
        System.out.println("a * b = " + (a * b));    // 85
        System.out.println("a / b = " + (a / b));    // 3 (integer division)
        System.out.println("a % b = " + (a % b));    // 2

        // Negative modulo
        System.out.println("-17 % 5 = " + (-17 % 5));  // -2 (sign of dividend)
        System.out.println("17 % -5 = " + (17 % -5));  // 2

        // Pre/post increment
        int x = 10;
        System.out.println(x++);   // 10 (old value)
        System.out.println(x);     // 11
        System.out.println(++x);   // 12 (new value)
        System.out.println(x);     // 12

        // Overflow
        int max = Integer.MAX_VALUE;
        System.out.println("MAX + 1 = " + (max + 1));  // -2147483648 (wrap)

        // Checked arithmetic (Java 8+)
        try {
            Math.addExact(Integer.MAX_VALUE, 1);
        } catch (ArithmeticException e) {
            System.out.println("Overflow: " + e.getMessage());
        }

        // clamp (Java 21+)
        int value = 150;
        int clamped = Math.clamp(value, 0, 100);
        System.out.println("clamp(150, 0, 100) = " + clamped);  // 100
    }
}
```

```java
// Example 2: Bitwise and Shift Operators
// File: BitwiseOps.java
public class BitwiseOps {
    public static void main(String[] args) {
        int a = 0b1100;  // 12
        int b = 0b1010;  // 10

        System.out.printf("a & b  = %4d  (%s)%n", a & b,  Integer.toBinaryString(a & b));  // 8  1000
        System.out.printf("a | b  = %4d  (%s)%n", a | b,  Integer.toBinaryString(a | b));  // 14 1110
        System.out.printf("a ^ b  = %4d  (%s)%n", a ^ b,  Integer.toBinaryString(a ^ b));  // 6  0110
        System.out.printf("~a     = %4d%n", ~a);     // -13

        // Shifts
        int n = 1;
        System.out.println("1 << 3 = " + (n << 3));    // 8
        System.out.println("8 >> 1 = " + (8 >> 1));    // 4
        System.out.println("-8 >> 1 = " + (-8 >> 1));  // -4 (arithmetic: fill with 1)
        System.out.println("-8 >>> 1 = " + (-8 >>> 1)); // large positive (logical: fill with 0)

        // Useful bit tricks
        int flags = 0;
        int FLAG_A = 1 << 0;  // bit 0
        int FLAG_B = 1 << 1;  // bit 1
        int FLAG_C = 1 << 2;  // bit 2

        flags |= FLAG_A;                              // set FLAG_A
        flags |= FLAG_C;                              // set FLAG_C
        System.out.println("FLAG_A set: " + ((flags & FLAG_A) != 0));  // true
        System.out.println("FLAG_B set: " + ((flags & FLAG_B) != 0));  // false
        flags ^= FLAG_A;                              // toggle FLAG_A
        System.out.println("FLAG_A after toggle: " + ((flags & FLAG_A) != 0));  // false
    }
}
```

```java
// Example 3: Math Class Usage
// File: MathDemo.java
public class MathDemo {
    public static void main(String[] args) {
        // Basic Math
        System.out.println(Math.abs(-42));            // 42
        System.out.println(Math.abs(Integer.MIN_VALUE)); // -2147483648 (edge case!)
        System.out.println(Math.max(10, 20));          // 20
        System.out.println(Math.min(10, 20));          // 10

        // Powers and roots
        System.out.println(Math.pow(2, 10));           // 1024.0
        System.out.println(Math.sqrt(144));            // 12.0
        System.out.println(Math.cbrt(27));             // 3.0
        System.out.println(Math.sqrt(-1));             // NaN

        // Rounding
        System.out.println(Math.floor(3.7));           // 3.0
        System.out.println(Math.ceil(3.2));            // 4.0
        System.out.println(Math.round(3.5));           // 4
        System.out.println(Math.round(3.4));           // 3
        System.out.println(Math.round(-3.5));          // -3 (rounds toward +infinity)

        // Logarithms and trig
        System.out.println(Math.log(Math.E));          // 1.0
        System.out.println(Math.log10(1000));          // 3.0
        System.out.printf("sin(90°) = %.2f%n", Math.sin(Math.PI / 2));  // 1.00
        System.out.printf("cos(0°)  = %.2f%n", Math.cos(0));            // 1.00

        // Constants
        System.out.println("PI = " + Math.PI);
        System.out.println("E  = " + Math.E);

        // FMA (Java 9+) — fused multiply-add, single rounding
        double fma = Math.fma(2.0, 3.0, 4.0);  // 2.0*3.0 + 4.0 = 10.0
        System.out.println("fma(2, 3, 4) = " + fma);

        // clamp (Java 21)
        System.out.println(Math.clamp(5.5, 0.0, 10.0));   // 5.5
        System.out.println(Math.clamp(-3.0, 0.0, 10.0));  // 0.0
        System.out.println(Math.clamp(15.0, 0.0, 10.0));  // 10.0
    }
}
```

```java
// Example 4: Operator Precedence and Short-Circuit
// File: OperatorPrecedence.java
public class OperatorPrecedence {

    static int sideEffect(String label, int value) {
        System.out.println("Evaluating: " + label);
        return value;
    }

    public static void main(String[] args) {
        // Precedence: * before +
        int result = 2 + 3 * 4;
        System.out.println(result);            // 14 (not 20)

        // Left-to-right evaluation for + with strings
        System.out.println(1 + 2 + "3");      // "33" (1+2=3, then "3"+"3"="33")
        System.out.println("1" + 2 + 3);      // "123" (string concat left-to-right)
        System.out.println("1" + (2 + 3));    // "15" (parentheses override)

        // Short-circuit: second operand not evaluated
        System.out.println("--- Short-circuit AND ---");
        boolean r1 = false && (sideEffect("right-AND", 1) > 0);  // right NOT evaluated
        System.out.println("result: " + r1);

        System.out.println("--- Short-circuit OR ---");
        boolean r2 = true || (sideEffect("right-OR", 1) > 0);   // right NOT evaluated
        System.out.println("result: " + r2);

        System.out.println("--- Non-short-circuit ---");
        boolean r3 = false & (sideEffect("right-&", 1) > 0);   // right IS evaluated
        System.out.println("result: " + r3);

        // Ternary operator
        int x = 7;
        String category = x > 5 ? "big" : x > 2 ? "medium" : "small";  // right-assoc
        System.out.println(category);  // "big"

        // Assignment operators
        int n = 10;
        n += 5;   System.out.println(n);   // 15
        n -= 3;   System.out.println(n);   // 12
        n *= 2;   System.out.println(n);   // 24
        n /= 4;   System.out.println(n);   // 6
        n %= 4;   System.out.println(n);   // 2
        n <<= 3;  System.out.println(n);   // 16
        n >>= 1;  System.out.println(n);   // 8
    }
}
```

```java
// Example 5: Floating-Point Arithmetic
// File: FloatArithmetic.java
public class FloatArithmetic {
    public static void main(String[] args) {
        // Precision issues
        System.out.println(0.1 + 0.2);             // 0.30000000000000004
        System.out.println(0.1 + 0.2 == 0.3);      // false!

        // Use epsilon comparison
        double a = 0.1 + 0.2;
        double b = 0.3;
        double eps = 1e-9;
        System.out.println(Math.abs(a - b) < eps);  // true

        // Use BigDecimal for exact decimal arithmetic
        java.math.BigDecimal bd1 = new java.math.BigDecimal("0.1");
        java.math.BigDecimal bd2 = new java.math.BigDecimal("0.2");
        System.out.println(bd1.add(bd2));           // 0.3 (exact)

        // Rounding modes
        double val = 2.5;
        System.out.println(Math.round(val));        // 3 (rounds to nearest, ties up)
        System.out.println(Math.rint(val));         // 2.0 (rounds to nearest, ties to even)
        System.out.println(Math.round(3.5));        // 4
        System.out.println(Math.rint(3.5));         // 4.0 (even)
        System.out.println(Math.rint(4.5));         // 4.0 (even, not 5!)

        // Special values
        double posInf = 1.0 / 0.0;
        double negInf = -1.0 / 0.0;
        double nan = 0.0 / 0.0;

        System.out.println(posInf > Double.MAX_VALUE);  // true
        System.out.println(negInf < -Double.MAX_VALUE); // true
        System.out.println(nan == nan);                  // false
        System.out.println(Double.isNaN(nan));           // true
        System.out.println(posInf + 1);                  // Infinity
        System.out.println(posInf - posInf);             // NaN
    }
}
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| JLS §4.2.2 | Integer Operations | https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html#jls-4.2.2 |
| JLS §4.2.4 | Floating-Point Operations | https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html#jls-4.2.4 |
| JLS §15.14 | Postfix Expressions | https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html#jls-15.14 |
| JLS §15.17 | Multiplicative Operators | https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html#jls-15.17 |
| JLS §15.18 | Additive Operators | https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html#jls-15.18 |
| JLS §15.19 | Shift Operators | https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html#jls-15.19 |
| JLS §15.22 | Bitwise Operators | https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html#jls-15.22 |
| JLS §15.23 | Conditional-And | https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html#jls-15.23 |
| JLS §15.26 | Assignment Operators | https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html#jls-15.26 |
| JEP 306 | Restore Always-Strict FP | https://openjdk.org/jeps/306 |
