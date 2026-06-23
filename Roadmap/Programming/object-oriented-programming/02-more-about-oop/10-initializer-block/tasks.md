# Initializer Block — Practice Tasks

Twelve exercises in initializer block usage and order.

---

## Task 1 — Trace the order

```java
class A {
    static { System.out.println("A static"); }
    { System.out.println("A instance"); }
    A() { System.out.println("A ctor"); }
}
class B extends A {
    static { System.out.println("B static"); }
    { System.out.println("B instance"); }
    B() { System.out.println("B ctor"); }
}

new B();
new B();
```

Predict the output. Then run.

---

## Task 2 — Static block for lookup map

Create a `class Country` with constants `US`, `UK`, `JP` (using a record or enum). Add a static block that builds a `Map<String, Country>` keyed by country code.

---

## Task 3 — Lazy holder vs static init

Implement two singletons:
- `EagerSingleton` using static field init.
- `LazySingleton` using lazy holder idiom.

Add a `Thread.sleep(100)` in the constructor. Measure startup time of each.

---

## Task 4 — Static block exception

Write a class whose static block throws an exception. Try to access a field of that class twice. Observe `ExceptionInInitializerError` then `NoClassDefFoundError`.

---

## Task 5 — Forward reference

Predict: does this compile?
```java
class C {
    static int a = b + 1;
    static int b = 10;
}
```

If not, why? How would you fix it?

---

## Task 6 — Multiple instance blocks

```java
class C {
    int a = 1;
    { System.out.println("first block, a=" + a); }
    int b = 2;
    { System.out.println("second block, a=" + a + ", b=" + b); }
    C() { System.out.println("ctor, a=" + a + ", b=" + b); }
}

new C();
```

Predict.

---

## Task 7 — Constant variable trigger

```java
class A {
    static { System.out.println("A init"); }
    public static final int X = 10;
    public static final Integer Y = 20;
}

System.out.println(A.X);
System.out.println(A.Y);
```

Predict the output. Why is the behavior different for `X` vs `Y`?

---

## Task 8 — Initializer block in enum

```java
enum Color {
    RED(0xFF0000), GREEN(0x00FF00), BLUE(0x0000FF);

    static final Map<Integer, Color> BY_RGB;
    static {
        BY_RGB = Arrays.stream(values()).collect(Collectors.toMap(Color::rgb, c -> c));
    }

    private final int rgb;
    Color(int rgb) { this.rgb = rgb; }
    public int rgb() { return rgb; }
    public static Color fromRgb(int rgb) { return BY_RGB.get(rgb); }
}
```

Verify `Color.fromRgb(0xFF0000) == Color.RED`.

---

## Task 9 — Static init from a file

Write a class that loads a properties file in a static block. Handle the `IOException` by wrapping in `ExceptionInInitializerError`. Test with both a valid and missing file.

---

## Task 10 — Avoid double-brace

```java
Map<String, Integer> m = new HashMap<>() {{
    put("a", 1);
    put("b", 2);
}};
```

Refactor to avoid the double-brace pattern. Explain why double-brace is undesirable.

---

## Task 11 — Constructor delegation skips prologue

```java
class C {
    int a = 1;
    { System.out.println("instance block"); }
    C() { this(0); System.out.println("no-arg ctor"); }
    C(int x) { System.out.println("int ctor, x=" + x); }
}

new C();
```

Predict the output. Note: the instance block runs only once (in the target ctor), even though we go through two constructors.

---

## Task 12 — Replace static block with modern factory

```java
public class Catalog {
    public static final List<String> ITEMS;
    static {
        ITEMS = new ArrayList<>();
        ITEMS.add("a");
        ITEMS.add("b");
        ITEMS = Collections.unmodifiableList(ITEMS);
    }
}
```

Refactor to use `List.of(...)`. Discuss when each form is appropriate.

---

## Validation

| Task | How |
|------|-----|
| 1 | "A static, B static" once; "A instance, A ctor, B instance, B ctor" twice |
| 2 | `Country.byCode("US")` returns the correct constant |
| 3 | EagerSingleton initializes at first reference; LazySingleton at first `get()` |
| 4 | First access prints `ExceptionInInitializerError`; second prints `NoClassDefFoundError` |
| 5 | Compiles (a is read after b's declaration in source order — wait, actually `a = b + 1` reads b before its initializer; b is 0 default; a = 1) |
| 6 | "first block, a=1"; "second block, a=1, b=2"; "ctor, a=1, b=2" |
| 7 | `X` doesn't trigger init (constant variable); `Y` does (boxed Integer not constant variable) |
| 8 | `Color.fromRgb(0xFF0000) == Color.RED` — true |
| 9 | Valid file: properties loaded; missing file: ExceptionInInitializerError |
| 10 | Refactored uses `Map.of(...)` or builder pattern |
| 11 | "instance block, int ctor x=0, no-arg ctor" — block runs once via the int ctor |
| 12 | List.of is cleaner; static block needed for complex/conditional init |

---

**Memorize this**: static parts run once per class load; instance parts run per `new`. Constant variables don't trigger init. Failed static init poisons the class. Modern factories (`List.of`, `Map.of`) replace many static blocks. Constructor delegation via `this(...)` skips the instance prologue.
