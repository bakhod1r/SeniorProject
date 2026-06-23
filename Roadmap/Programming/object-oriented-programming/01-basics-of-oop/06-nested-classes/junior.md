# Nested Classes — Junior

> **What?** A *nested class* is a class declared inside another class. Java has four kinds: **static nested classes**, **inner classes** (non-static nested), **local classes** (declared inside a method), and **anonymous classes** (declared and instantiated in one expression).
> **How?** Place a class declaration inside another class's body — or, for local/anonymous, inside a method.

---

## 1. The four kinds at a glance

```java
public class Outer {

    static class StaticNested { }                       // 1. static nested

    class Inner { }                                       // 2. inner (non-static)

    void method() {
        class Local { }                                   // 3. local

        Runnable r = new Runnable() {                     // 4. anonymous
            public void run() { ... }
        };
    }
}
```

| Kind             | Where declared      | Has access to enclosing instance? | Has access to enclosing locals? |
|------------------|---------------------|:---------------------------------:|:--------------------------------:|
| Static nested    | inside class body   | ❌ No                              | N/A                              |
| Inner (non-static) | inside class body | ✓ Yes                              | N/A                              |
| Local            | inside a method     | ✓ Yes                              | ✓ effectively final               |
| Anonymous        | inside a method     | ✓ Yes                              | ✓ effectively final               |

The big mental split: **static nested** vs **all the others**. Static nested classes are essentially top-level classes scoped inside another for organization; the rest carry a hidden reference to the enclosing instance.

---

## 2. Static nested class

```java
public class Outer {
    public static class Builder {
        public Outer build() { return new Outer(); }
    }
}

Outer.Builder b = new Outer.Builder();    // construct without an Outer
Outer o = b.build();
```

A static nested class:

- Is constructed via `new Outer.Builder()` — no enclosing instance needed.
- **Cannot** access non-static members of `Outer` (no `Outer.this`).
- Can access `Outer`'s `private static` members (same nest).
- Has its own access modifier independent of the outer class.

This is the **most common and least surprising** kind. Use it for builders, helper types, internal data structures.

---

## 3. Inner class (non-static)

```java
public class Outer {
    private int x = 10;

    public class Inner {
        public int doubled() {
            return x * 2;                  // ✓ accesses Outer's x
        }
    }
}

Outer o = new Outer();
Outer.Inner i = o.new Inner();             // unusual syntax — needs an outer instance
i.doubled();                                // 20
```

Inner classes:

- Hold an implicit reference to an enclosing `Outer` instance (`Outer.this`).
- Cannot exist without an `Outer` — `new Outer.Inner()` is illegal; you need `outer.new Inner()`.
- Can access `Outer`'s instance fields and methods directly.
- Cannot have `static` members (Java 16+ relaxed this for some cases).

The `Outer.this` reference can cause **memory leaks**: the inner instance keeps the outer alive even when the outer is logically discardable.

**When to use:** when the nested class genuinely *belongs* to a specific `Outer` instance — e.g., an iterator over an `Outer`'s data.

**Default rule:** start with `static`. Drop `static` only when you actually need the outer instance.

---

## 4. Local class

```java
public class Outer {
    public List<Integer> evens(List<Integer> nums) {
        class IsEven {                              // local class
            boolean test(int n) { return n % 2 == 0; }
        }
        IsEven check = new IsEven();
        return nums.stream().filter(n -> check.test(n)).toList();
    }
}
```

Local classes:

- Declared inside a method (or initializer block).
- Can access enclosing class's members (like inner classes).
- Can access enclosing method's *effectively final* local variables and parameters.
- Cannot have access modifiers (no `public`/`private`/etc.) — they're inherently scoped to the method.
- Cannot be `static` (until Java 16+ relaxed this slightly).

In modern Java, local classes are largely replaced by **lambdas** for behavior and **records** for data. They survive in legacy code.

---

## 5. Anonymous class

```java
public void register(Listener l) { ... }

register(new Listener() {                  // declare and instantiate in one go
    @Override
    public void onEvent(Event e) {
        System.out.println("got: " + e);
    }
});
```

Anonymous classes:

- Declared as part of a `new` expression.
- Implement an interface or extend a class — can do exactly one of these.
- Can capture effectively final locals and the enclosing instance.
- Cannot have a constructor (the `new` expression is the constructor call).
- Cannot be reused (each `new ... { }` creates a separate class).

For simple single-method interfaces, **lambdas are almost always cleaner**:

```java
register(e -> System.out.println("got: " + e));
```

Anonymous classes still apply when you need:

- Multiple methods (lambdas can implement only single-method interfaces).
- Initialization logic.
- A type that explicitly extends a class (lambdas can't).

---

## 6. Static nested vs inner — the most-asked question

```java
// Static nested
public class Outer {
    public static class Pair {
        int a, b;
        Pair(int a, int b) { this.a = a; this.b = b; }
    }
}
new Outer.Pair(1, 2);                       // works without Outer

// Inner
public class Outer {
    int total;
    public class Adder {
        void add(int n) { total += n; }     // mutates Outer's total
    }
}
new Outer.Adder();                           // ❌ compile error
new Outer().new Adder();                      // ✓ awkward but legal
```

The choice:

- Need to access enclosing instance? → **inner class**.
- Don't need it? → **static nested class** (always, by default).

Most beginners forget `static` and end up with inner classes by accident, causing memory leaks and instantiation friction. **Default to `static`.**

---

## 7. Real-world example: `Map.Entry` is a static nested interface

```java
public interface Map<K, V> {
    interface Entry<K, V> {           // static nested interface
        K getKey();
        V getValue();
    }
}
```

`Map.Entry` is a **static** nested interface (interfaces are implicitly `static`). It's used as `Map.Entry<String, Integer>` from anywhere — no `Map` instance needed for the type itself.

This is the pattern: **types tightly associated with another type's API**, scoped inside the parent class for organization.

---

## 8. Real-world example: `Builder` is a static nested class

```java
public final class HttpRequest {
    private final URI uri;
    // ...

    private HttpRequest(Builder b) { this.uri = b.uri; }

    public static Builder newBuilder() { return new Builder(); }

    public static final class Builder {
        URI uri;
        public Builder uri(URI u) { this.uri = u; return this; }
        public HttpRequest build() { return new HttpRequest(this); }
    }
}

HttpRequest req = HttpRequest.newBuilder()
    .uri(URI.create("https://x.com"))
    .build();
```

The builder is `static` because:

- It doesn't need access to a specific `HttpRequest` instance.
- Each `Builder` should be independent of any prior `HttpRequest`.
- Memory: a `static` builder doesn't retain a reference to its eventual `HttpRequest`.

---

## 9. Why memory leaks happen with inner classes

```java
public class Window {
    private final byte[] heavyData = new byte[10_000_000];   // 10 MB

    public ActionListener listener() {
        return new ActionListener() {                         // anonymous → inner-like
            @Override public void actionPerformed(ActionEvent e) {
                System.out.println("clicked");
            }
        };
    }
}

ActionListener l = new Window().listener();
// `l` holds a reference to the anonymous instance
// which holds a reference to its enclosing Window
// which holds 10 MB of heavyData
// → the Window can't be GC'd as long as `l` lives
```

Anonymous classes (and inner classes) capture the enclosing instance. If the enclosing instance is heavy, you've created a hidden retention path.

**Fixes:**

- Use a static nested class (no enclosing capture).
- Use a lambda (captures only what it explicitly references; the JIT often scalar-replaces the capture).
- Make the anonymous class extract only what it needs as a constructor parameter.

---

## 10. Accessing private members across nesting

```java
public class Outer {
    private int x = 10;

    public static class Helper {
        public int compute(Outer o) {
            return o.x * 2;                  // ✓ accesses private field
        }
    }
}
```

Static nested and inner classes can access each other's private members — they're in the same *nest* (Java 11+).

In older Java (pre-11), this required compiler-generated bridge methods. Modern Java accesses privates directly via `NestHost`/`NestMembers` class file attributes.

---

## 11. The `Outer.this` reference

Inside an inner class:

```java
public class Outer {
    int x = 10;
    public class Inner {
        int x = 20;
        public int sum() {
            return x + Outer.this.x;        // 20 + 10 = 30
        }
    }
}
```

`Outer.this` accesses the enclosing instance's field, distinguishing it from the inner class's own `x`. Without the qualifier, `x` refers to the closest scope (the inner class's `x` here).

---

## 12. Lambdas: the modern alternative

For most use cases that historically called for anonymous classes, **lambdas are cleaner**:

```java
// Old:
button.addActionListener(new ActionListener() {
    @Override public void actionPerformed(ActionEvent e) { ... }
});

// New:
button.addActionListener(e -> { ... });
```

Lambdas:

- Are syntactic sugar for `invokedynamic` + `LambdaMetafactory`.
- Capture *effectively final* locals (same rule as anonymous classes).
- Don't carry an implicit enclosing-instance reference (unless they reference `this` or instance members).
- Are JIT-friendlier — the JIT often eliminates the lambda allocation entirely (scalar replacement).

Use lambdas for single-abstract-method interfaces (`Runnable`, `Comparator`, `Function`, etc.). Reach for anonymous classes only when lambdas don't fit (multiple methods, explicit class extension).

---

## 13. Common mistakes

| Mistake                                          | Symptom                                | Fix                              |
|--------------------------------------------------|----------------------------------------|----------------------------------|
| Forgetting `static` on a builder/helper          | Memory leak via outer reference        | Add `static`                     |
| Trying to instantiate inner class without outer  | Compile error                          | Use `outer.new Inner()` or make it static |
| Using anonymous class for a one-method interface | Verbose                                | Lambda                           |
| Local class capturing a non-final local          | Compile error                          | Make local effectively final     |
| Hidden reference path causing OOM                | Memory leak, hard to diagnose          | Convert to static + explicit ref |

---

## 14. Quick rule of thumb

- **Static nested class**: default for any nested class that doesn't need outer access. Builders, helpers, data classes.
- **Inner class**: only when you need access to the enclosing instance. Iterators are the classic example.
- **Local class**: rare in modern code. Replaced by lambdas or extracted classes.
- **Anonymous class**: only when lambdas can't be used (multi-method interface, explicit class extension).

---

## 15. Cheat sheet

```java
public class Outer {
    static class StaticNested { }      // default for nested types

    class Inner { }                       // needs outer instance

    void method() {
        class Local { }                   // method-scoped
        Runnable r = new Runnable() { ... };  // anonymous
    }
}

// Static nested
new Outer.StaticNested();

// Inner — needs outer
new Outer().new Inner();

// Anonymous via lambda
Runnable r = () -> { /* body */ };
```

Master the four kinds and you can model any nesting relationship Java offers. The most important habit: **default to `static`** for nested classes. The second most important: **prefer lambdas** to anonymous classes when they fit.
