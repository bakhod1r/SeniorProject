# Type Casting — Find the Bug

> **Practice finding and fixing bugs in Java code related to Type Casting.**
> Each exercise contains buggy code — your job is to find the bug, explain why it happens, and fix it.

---

## How to Use

1. Read the buggy code carefully
2. Try to find the bug **without** looking at the hint
3. Write the fix yourself before checking the solution
4. Understand **why** the bug happens — not just how to fix it

### Difficulty Levels

| Level | Description |
|:-----:|:-----------|
| 🟢 | **Easy** — Common beginner mistakes, basic casting errors |
| 🟡 | **Medium** — Autoboxing traps, type promotion surprises, precision loss |
| 🔴 | **Hard** — Type erasure, bridge methods, JVM-level casting behavior |

---

## Bug 1: Lost Decimal 🟢

**What the code should do:** Calculate the average of two integers and print the result with decimals.

```java
public class Main {
    public static void main(String[] args) {
        int a = 7;
        int b = 2;
        double average = a / b;
        System.out.println("Average: " + average);
    }
}
```

**Expected output:**
```
Average: 3.5
```

**Actual output:**
```
Average: 3.0
```

<details>
<summary>💡 Hint</summary>

Look at the division `a / b` — what types are the operands?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** Integer division is performed before the widening cast to `double`.
**Why it happens:** Both `a` and `b` are `int`, so `a / b` performs integer division (result is `int` 3). Only then is the result widened to `double` 3.0.
**Impact:** The decimal part is lost — all integer divisions produce truncated results.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        int a = 7;
        int b = 2;
        double average = (double) a / b; // Cast one operand to double BEFORE division
        System.out.println("Average: " + average);
    }
}
```

**What changed:** Cast `a` to `double` before division, forcing floating-point division.

</details>

---

## Bug 2: The Overflowing Byte 🟢

**What the code should do:** Add two bytes and store the result in a byte.

```java
public class Main {
    public static void main(String[] args) {
        byte x = 100;
        byte y = 100;
        byte sum = x + y;
        System.out.println("Sum: " + sum);
    }
}
```

**Expected output:**
```
Sum: 200
```

**Actual output:**
```
Compilation error: incompatible types: possible lossy conversion from int to byte
```

<details>
<summary>💡 Hint</summary>

What type does `byte + byte` produce in Java?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `byte + byte` is promoted to `int` by Java's type promotion rules.
**Why it happens:** The JVM operand stack uses minimum `int`-sized slots. All `byte`, `short`, and `char` operands are promoted to `int` before arithmetic.
**Impact:** Compilation error because `int` cannot be assigned to `byte` without explicit cast.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        byte x = 100;
        byte y = 100;
        byte sum = (byte)(x + y); // Explicit cast — but beware: 200 overflows byte!
        System.out.println("Sum: " + sum); // Prints -56 (overflow!)

        // Better approach: use int to avoid overflow
        int safeSum = x + y;
        System.out.println("Safe sum: " + safeSum); // Prints 200
    }
}
```

**What changed:** Added explicit cast `(byte)` to compile. Note that 200 overflows `byte` range (-128 to 127), resulting in -56. The safer fix is to use `int`.

</details>

---

## Bug 3: ClassCastException Surprise 🟢

**What the code should do:** Process an animal based on its type.

```java
public class Main {
    static class Animal { String name; Animal(String n) { name = n; } }
    static class Dog extends Animal { Dog(String n) { super(n); } void bark() { System.out.println(name + " barks!"); } }
    static class Cat extends Animal { Cat(String n) { super(n); } void meow() { System.out.println(name + " meows!"); } }

    public static void main(String[] args) {
        Animal animal = new Cat("Whiskers");
        Dog dog = (Dog) animal;
        dog.bark();
    }
}
```

**Expected output:**
```
Whiskers barks!
```

**Actual output:**
```
Exception in thread "main" java.lang.ClassCastException: Main$Cat cannot be cast to Main$Dog
```

<details>
<summary>💡 Hint</summary>

What is the actual runtime type of `animal`?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** Downcasting a `Cat` object to `Dog` — they are siblings, not in the same hierarchy path.
**Why it happens:** The compiler allows the cast because `Animal` could theoretically be a `Dog`. But at runtime, the object is a `Cat`, which cannot be cast to `Dog`.
**Impact:** `ClassCastException` at runtime.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    static class Animal { String name; Animal(String n) { name = n; } }
    static class Dog extends Animal { Dog(String n) { super(n); } void bark() { System.out.println(name + " barks!"); } }
    static class Cat extends Animal { Cat(String n) { super(n); } void meow() { System.out.println(name + " meows!"); } }

    public static void main(String[] args) {
        Animal animal = new Cat("Whiskers");

        // Safe approach: check type before casting
        if (animal instanceof Dog dog) {
            dog.bark();
        } else if (animal instanceof Cat cat) {
            cat.meow();
        }
    }
}
```

**What changed:** Added `instanceof` checks before downcasting to prevent ClassCastException.

</details>

---

## Bug 4: Precision Trap 🟡

**What the code should do:** Check if a large long value is preserved after conversion to double and back.

```java
public class Main {
    public static void main(String[] args) {
        long original = 9007199254740993L; // 2^53 + 1
        double d = original;               // Widening — should be safe?
        long restored = (long) d;

        System.out.println("Original: " + original);
        System.out.println("Restored: " + restored);
        System.out.println("Equal: " + (original == restored));
    }
}
```

**Expected output:**
```
Original: 9007199254740993
Restored: 9007199254740993
Equal: true
```

**Actual output:**
```
Original: 9007199254740993
Restored: 9007199254740992
Equal: false
```

<details>
<summary>💡 Hint</summary>

How many bits of mantissa does `double` have? Is it enough for all `long` values?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `long → double` widening loses precision for values larger than 2^53.
**Why it happens:** `double` has 52 bits of mantissa (53 including implicit leading 1). Values beyond 2^53 cannot be represented exactly — they are rounded to the nearest representable value.
**Impact:** Silent data corruption — the value changes without any exception or warning.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
import java.math.BigDecimal;

public class Main {
    public static void main(String[] args) {
        long original = 9007199254740993L;

        // Use BigDecimal for lossless conversion
        BigDecimal bd = BigDecimal.valueOf(original);
        long restored = bd.longValueExact();

        System.out.println("Original: " + original);
        System.out.println("Restored: " + restored);
        System.out.println("Equal: " + (original == restored));
    }
}
```

**What changed:** Used `BigDecimal` instead of `double` to preserve exact `long` values.

</details>

---

## Bug 5: The Null Unboxing 🟡

**What the code should do:** Calculate total price from a nullable discount.

```java
public class Main {
    public static void main(String[] args) {
        double basePrice = 100.0;
        Integer discountPercent = getDiscount(); // May return null
        double finalPrice = basePrice * (1 - discountPercent / 100.0);
        System.out.println("Final price: " + finalPrice);
    }

    static Integer getDiscount() {
        return null; // No discount available
    }
}
```

**Expected output:**
```
Final price: 100.0
```

**Actual output:**
```
Exception in thread "main" java.lang.NullPointerException
```

<details>
<summary>💡 Hint</summary>

What happens when Java tries to unbox a `null` `Integer` to use in arithmetic?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** Unboxing `null` `Integer` to `int` causes `NullPointerException`.
**Why it happens:** When `discountPercent` (which is `null`) is used in arithmetic, Java tries to auto-unbox it to `int`. Unboxing `null` throws NPE.
**Impact:** Runtime crash in any arithmetic involving nullable wrapper types.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        double basePrice = 100.0;
        Integer discountPercent = getDiscount();

        // Safe: check for null before unboxing
        int discount = (discountPercent != null) ? discountPercent : 0;
        double finalPrice = basePrice * (1 - discount / 100.0);
        System.out.println("Final price: " + finalPrice);
    }

    static Integer getDiscount() {
        return null;
    }
}
```

**What changed:** Added null check before unboxing. Alternatively, use `Optional.ofNullable(getDiscount()).orElse(0)`.

</details>

---

## Bug 6: Integer Cache Gotcha 🟡

**What the code should do:** Compare two Integer values for equality.

```java
public class Main {
    public static void main(String[] args) {
        Integer a = 127;
        Integer b = 127;
        System.out.println("127 == 127: " + (a == b));

        Integer c = 128;
        Integer d = 128;
        System.out.println("128 == 128: " + (c == d));
    }
}
```

**Expected output:**
```
127 == 127: true
128 == 128: true
```

**Actual output:**
```
127 == 127: true
128 == 128: false
```

<details>
<summary>💡 Hint</summary>

Java caches `Integer` objects for values -128 to 127. What happens outside this range?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `==` compares object references, not values, for `Integer` objects.
**Why it happens:** For values -128 to 127, `Integer.valueOf()` returns cached objects, so `==` works. For values outside this range, new objects are created, so `==` compares different references.
**Impact:** Inconsistent equality behavior depending on the value — extremely confusing bug.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        Integer a = 127;
        Integer b = 127;
        System.out.println("127 equals 127: " + a.equals(b)); // true

        Integer c = 128;
        Integer d = 128;
        System.out.println("128 equals 128: " + c.equals(d)); // true

        // Or use intValue() for primitive comparison
        System.out.println("128 == 128: " + (c.intValue() == d.intValue())); // true
    }
}
```

**What changed:** Used `.equals()` or `.intValue()` for value comparison instead of `==`.

</details>

---

## Bug 7: Wrong Remove 🟡

**What the code should do:** Remove the value 3 from a list of integers.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<Integer> numbers = new ArrayList<>(List.of(1, 2, 3, 4, 5));
        System.out.println("Before: " + numbers);
        numbers.remove(3);
        System.out.println("After removing 3: " + numbers);
    }
}
```

**Expected output:**
```
Before: [1, 2, 3, 4, 5]
After removing 3: [1, 2, 4, 5]
```

**Actual output:**
```
Before: [1, 2, 3, 4, 5]
After removing 3: [1, 2, 3, 5]
```

<details>
<summary>💡 Hint</summary>

`List` has two `remove` methods: `remove(int index)` and `remove(Object o)`. Which one is called with `3`?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `numbers.remove(3)` calls `remove(int index)` — removes element at index 3 (which is `4`), not the value `3`.
**Why it happens:** Java prefers `remove(int)` over autoboxing to `remove(Integer)` because widening/exact match takes priority over boxing in method resolution.
**Impact:** Wrong element removed — data corruption.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<Integer> numbers = new ArrayList<>(List.of(1, 2, 3, 4, 5));
        System.out.println("Before: " + numbers);
        numbers.remove(Integer.valueOf(3)); // Explicitly box to call remove(Object)
        System.out.println("After removing 3: " + numbers);
    }
}
```

**What changed:** Used `Integer.valueOf(3)` to explicitly call `remove(Object)` instead of `remove(int index)`.

</details>

---

## Bug 8: Generic Type Erasure Cast 🔴

**What the code should do:** Store and retrieve typed values from a generic container.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    @SuppressWarnings("unchecked")
    public static void main(String[] args) {
        List rawList = new ArrayList();
        rawList.add(42);
        rawList.add("hello");

        List<String> strings = rawList; // Unchecked assignment
        for (String s : strings) {      // Where does the ClassCastException happen?
            System.out.println(s.toUpperCase());
        }
    }
}
```

**Expected output:**
```
42
HELLO
```

**Actual output:**
```
Exception in thread "main" java.lang.ClassCastException: java.lang.Integer cannot be cast to java.lang.String
```

<details>
<summary>💡 Hint</summary>

Where does the hidden `checkcast` instruction appear in the bytecode? It is not at the assignment line.

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** Raw type `List` bypasses generic type checking. The `ClassCastException` occurs at the for-each loop, where the compiler inserts a hidden `checkcast String` during the `Iterator.next()` call.
**Why it happens:** Type erasure removes generic info at runtime. The raw list accepts `Integer` and `String`. When iterating as `List<String>`, the compiler-generated cast fails on the `Integer`.
**Impact:** `ClassCastException` at a line with no visible cast — very confusing to debug.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        // Option 1: Use proper generics from the start
        List<Object> items = new ArrayList<>();
        items.add(42);
        items.add("hello");

        for (Object item : items) {
            if (item instanceof String s) {
                System.out.println(s.toUpperCase());
            } else {
                System.out.println(item);
            }
        }

        // Option 2: Use Collections.checkedList() to catch early
        List<String> safeStrings = java.util.Collections.checkedList(
            new ArrayList<>(), String.class);
        // safeStrings.add(42); // Throws ClassCastException immediately!
    }
}
```

**What changed:** Used proper generics and `instanceof` checks. For legacy code, `Collections.checkedList()` provides runtime type safety.

</details>

---

## Bug 9: Double Cast Surprise 🔴

**What the code should do:** Unbox an Object containing an Integer to a long.

```java
public class Main {
    public static void main(String[] args) {
        Object obj = 42; // Autoboxed to Integer
        long value = (long) obj;
        System.out.println("Value: " + value);
    }
}
```

**Expected output:**
```
Value: 42
```

**Actual output:**
```
Exception in thread "main" java.lang.ClassCastException: java.lang.Integer cannot be cast to java.lang.Long
```

<details>
<summary>💡 Hint</summary>

`(long) obj` tries to cast `Object` to `Long` (unboxing), not widening from `Integer`.

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `(long) obj` attempts to cast `Object` to `Long`, then unbox to `long`. But the actual object is `Integer`, not `Long`.
**Why it happens:** You cannot unbox an `Integer` to `long` — you must first unbox to `int`, then widen to `long`. The JVM performs at most one implicit conversion at a time.
**Impact:** `ClassCastException` that is confusing because the syntax looks like a primitive cast but is actually a reference cast + unboxing.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        Object obj = 42;

        // Option 1: Cast to Integer first, then widen
        long value1 = (Integer) obj;
        System.out.println("Value: " + value1);

        // Option 2: Use Number for flexibility
        long value2 = ((Number) obj).longValue();
        System.out.println("Value: " + value2);
    }
}
```

**What changed:** Cast to `Integer` first (matching the actual type), then let widening convert to `long`. Or use `Number.longValue()` for any numeric type.

</details>

---

## Bug 10: NaN Comparison Trap 🔴

**What the code should do:** Detect if a cast result is valid by comparing with the original.

```java
public class Main {
    public static void main(String[] args) {
        double value = Double.NaN;
        int cast = (int) value;

        // Validate the cast
        if (cast == (int) value) {
            System.out.println("Cast is valid: " + cast);
        } else {
            System.out.println("Cast is invalid");
        }

        // Detect NaN
        if (value == Double.NaN) {
            System.out.println("Value is NaN");
        } else {
            System.out.println("Value is not NaN"); // Surprise!
        }
    }
}
```

**Expected output:**
```
Cast is invalid
Value is NaN
```

**Actual output:**
```
Cast is valid: 0
Value is not NaN
```

<details>
<summary>💡 Hint</summary>

NaN is never equal to anything — including itself. And `(int) NaN` produces 0 per the JLS.

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** Two issues:
1. `(int) NaN` produces `0` (JLS 5.1.3), so `cast == (int) value` is `0 == 0` → true.
2. `value == Double.NaN` is always `false` because NaN is not equal to anything, including itself. This is per IEEE 754 specification.

**Why it happens:** NaN has special comparison semantics in IEEE 754. All comparisons with NaN return false, including `NaN == NaN`.
**Impact:** NaN values slip through validation, and casts of NaN produce 0 without warning.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        double value = Double.NaN;

        // Detect NaN FIRST using the correct method
        if (Double.isNaN(value)) {
            System.out.println("Value is NaN — cannot cast safely");
        } else {
            int cast = (int) value;
            System.out.println("Cast is valid: " + cast);
        }
    }
}
```

**What changed:** Used `Double.isNaN()` instead of `==` comparison. Always check for NaN before casting floating-point to integer types.

</details>

---

## Bug 11: Ternary Type Widening 🔴

**What the code should do:** Return either an int or a double based on a condition.

```java
public class Main {
    public static void main(String[] args) {
        boolean useWhole = true;
        Object result = useWhole ? 42 : 3.14;
        System.out.println("Result: " + result);
        System.out.println("Type: " + result.getClass().getSimpleName());
    }
}
```

**Expected output:**
```
Result: 42
Type: Integer
```

**Actual output:**
```
Result: 42.0
Type: Double
```

<details>
<summary>💡 Hint</summary>

In a ternary expression with numeric operands of different types, binary numeric promotion applies to BOTH sides.

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** The ternary operator applies binary numeric promotion — since one operand is `int` (42) and the other is `double` (3.14), the `int` is widened to `double`. Both branches produce `double`.
**Why it happens:** JLS 15.25.2 — conditional expression type is determined by the types of BOTH branches, not just the selected one.
**Impact:** The result is always `Double`, even when the `int` branch is selected.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    public static void main(String[] args) {
        boolean useWhole = true;

        // Use separate variables to avoid type promotion
        if (useWhole) {
            int result = 42;
            System.out.println("Result: " + result);
            System.out.println("Type: int");
        } else {
            double result = 3.14;
            System.out.println("Result: " + result);
            System.out.println("Type: double");
        }

        // Or use Number as the common type
        Number result = useWhole ? Integer.valueOf(42) : Double.valueOf(3.14);
        System.out.println("Result: " + result);
        System.out.println("Type: " + result.getClass().getSimpleName());
    }
}
```

**What changed:** Avoided mixing numeric types in a ternary expression. Used explicit boxing or separate branches.

</details>

---

## Score Card

| Bug | Difficulty | Topic | Found it? | Understood why? |
|:---:|:---------:|:-----:|:---------:|:---------------:|
| 1 | 🟢 | Integer division before widening | ☐ | ☐ |
| 2 | 🟢 | Type promotion in byte arithmetic | ☐ | ☐ |
| 3 | 🟢 | Unsafe downcast without instanceof | ☐ | ☐ |
| 4 | 🟡 | Precision loss in long→double | ☐ | ☐ |
| 5 | 🟡 | Null unboxing NPE | ☐ | ☐ |
| 6 | 🟡 | Integer cache boundary | ☐ | ☐ |
| 7 | 🟡 | List.remove(int) vs remove(Object) | ☐ | ☐ |
| 8 | 🔴 | Generic type erasure hidden cast | ☐ | ☐ |
| 9 | 🔴 | Object→long cast mismatch | ☐ | ☐ |
| 10 | 🔴 | NaN comparison and cast behavior | ☐ | ☐ |
| 11 | 🔴 | Ternary operator type promotion | ☐ | ☐ |
