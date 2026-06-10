# Static Keyword — Junior

> **What?** `static` makes a member belong to the **class itself**, not to any individual object. There is one copy, shared by every instance — and you can use it without creating an object.
> **How?** Place `static` before a field, method, nested class, or initializer block. Access it via the class name: `ClassName.member`.

---

## 1. Instance vs static — the core idea

```java
class Counter {
    int    count;          // instance — one copy per object
    static int total;      // static   — one copy across all objects
}

Counter a = new Counter();
Counter b = new Counter();

a.count = 1;
b.count = 5;
Counter.total = 6;

// a.count → 1, b.count → 5, Counter.total → 6
```

`a` and `b` each have their own `count`. There is exactly *one* `total`, owned by the class. Reassigning `Counter.total` is visible to every method, every thread, every part of the program.

That's the entire mental model: **`static` = "lives on the class, not on the object."**

---

## 2. Where can `static` appear?

```java
public class Library {

    public static final int    MAX_BOOKS = 1000;       // 1. static field
    private static int         loanCount = 0;

    public static int loansThisYear() {                 // 2. static method
        return loanCount;
    }

    static {                                            // 3. static initializer
        System.out.println("Library class loaded");
    }

    public static class Builder {                       // 4. static nested class
        public Library build() { ... }
    }
}
```

The four uses:

1. **Static field** — class-level data (counters, constants, caches).
2. **Static method** — operations that don't need an instance.
3. **Static initializer block** — code that runs once when the class is loaded.
4. **Static nested class** — a class scoped inside another, *without* a hidden reference to an outer instance.

(`static` cannot appear on top-level classes, local variables, instance methods of a class, or constructors. The compiler rejects all four.)

---

## 3. Static fields — one copy for the whole program

```java
public class Counter {
    private static int instanceCount = 0;

    public Counter() {
        instanceCount++;
    }

    public static int howMany() {
        return instanceCount;
    }
}

new Counter(); new Counter(); new Counter();
Counter.howMany();   // 3
```

`instanceCount` is shared. Every constructor call mutates the same field; every reader sees the latest value (with the usual concurrency caveats — see §11).

Static fields live in the **class data area** (specifically, attached to the class metadata in *metaspace*). They exist as soon as the class is loaded and survive until the class is unloaded — which usually means "forever, for the lifetime of the JVM."

---

## 4. `static final` constants — the most common use

```java
public class HttpStatus {
    public static final int OK             = 200;
    public static final int NOT_FOUND      = 404;
    public static final int INTERNAL_ERROR = 500;
}

if (response.status() == HttpStatus.OK) { ... }
```

`static final` primitives (and `String` literals) are **compile-time constants**. The compiler may inline their values directly into the reading bytecode. This is why constants like `Integer.MAX_VALUE` are essentially free at runtime.

Convention: name constants in `UPPER_SNAKE_CASE` to distinguish them from regular fields.

> Modern style: prefer `enum` for closed sets of named values (`enum HttpStatus { OK, NOT_FOUND, ... }`) — type-safe, exhaustive, more flexible.

---

## 5. Static methods — utilities and factories

```java
public class Math {
    public static int max(int a, int b) {
        return a > b ? a : b;
    }
}

int m = Math.max(3, 5);   // call via class name
```

Static methods cannot use `this` — there is no current instance. They can only:

- Read/write *static* fields of the class.
- Take their input from parameters.
- Call other static methods (or instance methods on an explicit object).

That makes them a natural fit for:

- Utility functions (`Math.abs`, `Strings.reverse`).
- Factory methods (`Integer.valueOf`, `List.of`, `Optional.empty`).
- Pure operations that don't need state.

`main` is the most famous static method:

```java
public static void main(String[] args) { ... }
```

It must be `static` because the JVM needs to call it *before* any object exists.

---

## 6. Calling static members

Two styles:

```java
int m = Math.max(3, 5);          // ✓ via class name (preferred)
Math math = null;
int n = math.max(3, 5);           // ✓ but misleading — no instance is needed
```

You *can* call a `static` method through an instance reference, but it's misleading — readers think it's an instance call. **Always call statics via the class name.** Most IDEs flag the second form as a warning.

A subtle point: even though `math` is `null` in the second example, the call doesn't throw an `NPE`. Static methods don't dereference the receiver — the reference is just used to find the class. Don't rely on this; the warning is right.

---

## 7. Static initializer blocks

A `static { ... }` block runs **once**, when the class is first loaded:

```java
public class LookupTable {
    private static final int[] PRIMES = new int[100];

    static {
        for (int i = 0; i < 100; i++) {
            PRIMES[i] = computeNthPrime(i);
        }
    }

    private static int computeNthPrime(int n) { ... }
}
```

When the JVM first uses `LookupTable` (creates an instance, calls a static method, reads a non-final static field), it:

1. Loads and verifies the class.
2. Sets all static fields to their defaults.
3. Runs the static initializer block + initializer expressions, in source order.

After that, the static block never runs again. The class is *initialized*.

You can have multiple `static { ... }` blocks — they run in source order, interleaved with static field initializers.

---

## 8. Static nested classes

```java
public class Outer {
    public static class Nested {            // static — no implicit reference to Outer
        public void hello() { System.out.println("hi"); }
    }
}

Outer.Nested n = new Outer.Nested();         // construct without an Outer
n.hello();
```

A *static* nested class is essentially a top-level class scoped inside another. It does *not* hold a reference to an enclosing `Outer` instance.

Compare with a non-static **inner class**:

```java
public class Outer {
    public class Inner {                     // non-static — implicit reference to Outer
        public void hello() { ... }
    }
}

Outer outer = new Outer();
Outer.Inner i = outer.new Inner();           // needs an outer instance
```

Inner classes carry a hidden `Outer.this` reference. Static nested classes don't. **Default to static** when creating nested classes — only drop the `static` if you actually need access to the enclosing instance.

A `Builder` is the canonical static nested class:

```java
public class Order {
    public static class Builder {
        public Order build() { ... }
    }
}
Order.Builder b = new Order.Builder();
```

---

## 9. Static imports

Normal:

```java
import java.lang.Math;
double r = Math.sqrt(2);
```

With static import:

```java
import static java.lang.Math.sqrt;
double r = sqrt(2);
```

Or import all static members from a class:

```java
import static java.lang.Math.*;
double r = sqrt(2);
double a = abs(-5);
```

Use sparingly. Heavy `import static` makes call sites ambiguous — readers can't tell at a glance which class a method belongs to.

Common acceptable uses:

- Test assertions: `import static org.junit.jupiter.api.Assertions.*;`
- Math utilities in math-heavy code.
- DSL-style fluent APIs.

Don't import static for general utility classes — keep `Strings.reverse(s)` over `reverse(s)`.

---

## 10. Static factory methods

A static method that returns a new instance:

```java
public class Money {
    private final long cents;
    private final String currency;

    private Money(long cents, String currency) {       // private ctor
        this.cents = cents;
        this.currency = currency;
    }

    public static Money usd(long cents)  { return new Money(cents, "USD"); }
    public static Money eur(long cents)  { return new Money(cents, "EUR"); }
}

Money lunch = Money.usd(1500);
```

Why bother instead of `new Money(1500, "USD")`?

- **Names** describe intent (`Money.usd(1500)` is clearer than `new Money(1500, "USD")`).
- **Caching** — return existing instances when possible (`Boolean.valueOf` always returns one of two cached `Boolean` instances).
- **Subtype freedom** — the factory can return *any subtype* without callers caring.

Common factory names: `of`, `valueOf`, `from`, `getInstance`, `newInstance`, `create`.

---

## 11. Static + threads = shared mutable state

Because static fields are shared by every thread, mutating them from multiple threads requires care:

```java
public class Counter {
    private static int count = 0;

    public static void increment() { count++; }   // ⚠ NOT thread-safe
}
```

`count++` is read-modify-write, not atomic. Two threads can both read `count = 5` and both write `6`, losing one increment.

Fixes:

```java
private static volatile int count;             // visibility, not atomicity (still bad for ++)
private static final AtomicInteger count;      // ✓ atomic increment
private static synchronized void increment();  // ✓ correct but coarse
```

Static state magnifies threading hazards because there's only one copy and every thread can reach it. Treat any static mutable field as a concurrency landmine.

---

## 12. Static method cannot access instance state

```java
public class User {
    private String name;

    public static String greeting() {
        return "Hello, " + name;       // ❌ compile error: cannot reference 'name' in a static context
    }
}
```

A static method has no `this`; it doesn't know *which* `User`'s name to use. Either:

- Make the method instance: `public String greeting() { return "Hello, " + name; }`
- Pass the instance: `public static String greeting(User u) { return "Hello, " + u.name; }`

The error message — "cannot reference X from a static context" — is one of the most common Java compile errors a beginner sees.

---

## 13. Quick rules of thumb

| Question                                              | Answer                       |
|-------------------------------------------------------|------------------------------|
| It's a constant?                                      | `public static final`         |
| It's a counter or shared state?                       | Almost always *don't* — try instance state and dependency injection first |
| It's a stateless utility (no instance state)?         | `static` method on a utility class |
| It's a factory?                                       | `static` method, often paired with `private` constructor |
| It's a nested class with no need for outer reference? | `static` nested class         |
| It's `main`?                                          | `static` (required by JVM)    |

---

## 14. Common beginner mistakes

| Mistake                                              | Symptom                                | Fix                              |
|------------------------------------------------------|----------------------------------------|----------------------------------|
| `public static String name` on a "user model" class  | All users share one name               | Make it instance                 |
| Calling `static` method via an instance              | IDE warning; misleading reading        | Call via class name              |
| Forgetting `static` on `main`                         | `Main method not found`                | `public static void main(...)`   |
| Mutating static state from multiple threads          | Race conditions, visibility bugs       | `Atomic*` / synchronized / `volatile` |
| Static field initializer that references a later static | Sees default value, not the initialized one | Reorder declarations |
| Inner class that should be static                    | Memory leaks (outer instance retained) | Add `static`                     |

---

## 15. Cheat sheet

```java
// Static field
public static int count;
public static final int MAX = 100;

// Static method
public static int add(int a, int b) { return a + b; }

// Static initializer
static { /* runs once when class loads */ }

// Static nested class
static class Helper { }

// Calling
ClassName.field
ClassName.method(args)
ClassName.NestedClass instance = new ClassName.NestedClass();

// Static import
import static java.lang.Math.PI;
import static org.junit.jupiter.api.Assertions.*;
```

`static` is the keyword that breaks the "everything belongs to an object" rule. Use it deliberately — for true class-level data and behavior — and avoid the temptation to make global state easier to reach by sprinkling `static` everywhere.
