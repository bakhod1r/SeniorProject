# Nested Classes — Find the Bug

> 12 buggy snippets where nested classes are the cause. Read each, identify why it bites, when it bites, and the fix.

---

## Bug 1 — Memory leak from anonymous inner class

```java
public class Window {
    private final byte[] heavyData = new byte[10_000_000];

    public Runnable refreshTask() {
        return new Runnable() {
            public void run() { /* doesn't use Window state */ }
        };
    }
}

scheduler.scheduleAtFixedRate(window.refreshTask(), 0, 1, TimeUnit.SECONDS);
// Window's 10 MB never gets GC'd
```

**Bug.** The anonymous class implicitly captures `Window.this`. Even though `run()` doesn't use any `Window` field, the captured reference keeps the `Window` (and its 10 MB) alive forever.

**Fix.**

```java
public Runnable refreshTask() {
    return () -> { /* lambda — no implicit this capture if not used */ };
}
```

Or:

```java
public static Runnable refreshTaskFor(SomeData data) {
    return () -> { /* uses data only */ };
}
```

**Lesson.** Non-static nested classes (including anonymous) capture the outer instance. For listeners and long-lived callbacks, prefer lambdas or static helpers.

---

## Bug 2 — Forgot `static` on builder

```java
public final class HttpRequest {
    public class Builder {                                  // ⚠ not static
        public HttpRequest build() { return new HttpRequest(this); }
    }
}

new HttpRequest.Builder();                                  // ❌ compile error
new HttpRequest().new Builder();                            // ✓ but every Builder retains an HttpRequest
```

**Bug.** The builder is non-static, so:
- It can't be instantiated with `new HttpRequest.Builder()`.
- Each builder retains a reference to a *previously constructed* `HttpRequest` (via `this$0`).
- The pattern is awkward and counterintuitive.

**Fix.**

```java
public static class Builder { ... }
```

Now `new HttpRequest.Builder()` works and each builder is independent.

**Lesson.** Builders should always be `static`. They don't need (and shouldn't have) a reference to a current outer instance.

---

## Bug 3 — Inner class can't be reused

```java
public class Tree {
    public class Node {
        Node left, right;
        // ...
    }
}

Tree.Node node1 = new Tree().new Node();
Tree.Node node2 = new Tree().new Node();
node1.left = node2;                    // ❌ different outer instances; logically wrong
```

**Bug.** Each `Node` is bound to its specific `Tree` instance via `this$0`. Linking nodes from different trees is structurally questionable — they're considered distinct.

**Fix.** Make `Node` `static`:

```java
public static class Node {
    Node left, right;
    Object value;
}
```

A node is conceptually a piece of tree structure, not bound to a specific tree instance.

**Lesson.** Data structures (nodes, entries) almost always belong as static nested. Use composition (Tree has Nodes), not encapsulation via inner.

---

## Bug 4 — Capture of mutable variable in anonymous class

```java
public List<Runnable> makeTasks() {
    List<Runnable> tasks = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
        tasks.add(new Runnable() {
            public void run() { System.out.println(i); }   // ❌ i not effectively final
        });
    }
    return tasks;
}
```

**Bug.** The loop variable `i` is reassigned on each iteration. Anonymous classes (and lambdas) can only capture *effectively final* variables. Compile error.

**Fix.** Capture a copy:

```java
for (int i = 0; i < 5; i++) {
    final int captured = i;
    tasks.add(new Runnable() {
        public void run() { System.out.println(captured); }
    });
}
```

Or use a stream:

```java
return IntStream.range(0, 5).mapToObj(i -> (Runnable)() -> System.out.println(i)).toList();
```

**Lesson.** Anonymous classes capture by value (not by reference). Loop variables are not effectively final.

---

## Bug 5 — Anonymous class instead of lambda — readability cost

```java
button.addActionListener(new ActionListener() {
    @Override public void actionPerformed(ActionEvent e) {
        System.out.println("clicked");
    }
});
```

**Bug.** Verbose for a single-method interface. Allocates an anonymous-class instance per registration. JIT can't easily scalar-replace it.

**Fix.**

```java
button.addActionListener(e -> System.out.println("clicked"));
```

**Lesson.** For single-method functional interfaces, lambdas are objectively better — shorter, faster (often zero allocation), more idiomatic.

---

## Bug 6 — Static nested cannot access outer instance

```java
public class Order {
    private long id;

    public static class Validator {
        public void validate() {
            if (id <= 0) throw new IllegalStateException();    // ❌ compile error
        }
    }
}
```

**Bug.** `Validator` is `static`, so it has no implicit `Order.this` reference. Trying to access `id` (an instance field of Order) is a compile error.

**Fix.** Either pass the data explicitly:

```java
public static class Validator {
    public void validate(Order o) {
        if (o.id <= 0) throw new IllegalStateException();
    }
}
```

Or convert `Validator` to a non-static inner class. (Usually the explicit-parameter form is cleaner.)

**Lesson.** Static nested cannot see outer instance state. Pick `static` + explicit, or inner + implicit, deliberately.

---

## Bug 7 — Anonymous class with multiple "captures" causing confusion

```java
public Runnable makeTask(String name, int priority) {
    return new Runnable() {
        public void run() {
            System.out.println(name + " " + priority);
        }
    };
}

Runnable r = makeTask("A", 5);
// later: name and priority are captured by-value at construction; the runnable retains them
```

**Bug.** Not technically a bug, but a common confusion: developers expect "live" captures (referring to the original variables) but get *snapshot* captures. If `name` were a mutable object, mutations would still be visible (the reference is captured); but if `name` is reassigned after `makeTask` returns, the lambda still has the original.

**Lesson.** Captures are by-value. The captured *reference* still points at the same object; mutations to that object are visible. Reassigning the original variable doesn't affect the lambda.

---

## Bug 8 — `Outer.this` shadowed by inner `this`

```java
public class Outer {
    int x = 10;
    public class Inner {
        int x = 20;
        public int total() {
            return x;                            // 20 — Inner's x
        }
    }
}
```

**Bug.** If the developer meant to access `Outer`'s `x`, the result is wrong (20 instead of 10). Easy to misread.

**Fix.** Rename the inner field, or qualify explicitly:

```java
public int total() { return Outer.this.x + this.x; }
```

**Lesson.** Same-named fields in nested scopes are shadowed by the inner. Use distinct names for clarity.

---

## Bug 9 — Anonymous class for type capture without TypeReference

```java
List<String> list = new ArrayList<String>() { };       // ⚠ anonymous class extending ArrayList
```

**Bug.** This creates an anonymous *subclass* of `ArrayList`. It works for `add`, `remove`, etc., but:
- It's a different class than `ArrayList` — `obj.getClass() != ArrayList.class`.
- Serialization breaks (the anonymous class isn't typically `Serializable`).
- Many frameworks check for exact `ArrayList` and behave unexpectedly.

**Fix.**

```java
List<String> list = new ArrayList<>();        // diamond operator, no anonymous subclass
```

**Lesson.** Don't accidentally subclass via anonymous class. The trailing `{ }` is the giveaway.

---

## Bug 10 — Local class with same name in nested method calls

```java
public class Outer {
    public void method1() {
        class Helper { int x = 1; }
        // ...
    }

    public void method2() {
        class Helper { int x = 2; }      // legal — different scope
        // ...
    }
}
```

**Bug.** Not a bug per se, but multiple `Helper` classes in different methods can confuse readers and obscure stack traces. Each compiles to a separate class file (`Outer$1Helper`, `Outer$2Helper`).

**Fix.** Either rename to be specific (`Method1Helper`, `Method2Helper`) or extract to top-level if reused.

**Lesson.** Local class names compete in mental scope, even when they don't compete in lexical scope. Use clear names.

---

## Bug 11 — Inner class iterator referencing wrong outer

```java
public class Container {
    private final List<E> items;

    public Iterator<E> iterator() {
        return new Iterator<>() {            // anonymous inner — captures outer
            int cursor = 0;
            public boolean hasNext() { return cursor < items.size(); }
            public E next() { return items.get(cursor++); }
        };
    }
}

Container c1 = new Container(...);
Container c2 = new Container(...);
Iterator<E> it = c1.iterator();
c1 = c2;                                   // doesn't affect it — it still references original c1
```

**Bug** (subtle). The iterator is bound to *this specific* container instance. Reassigning `c1` doesn't affect the iterator. This is *correct* behavior, but sometimes surprises beginners.

**Lesson.** Inner-class iterators capture the outer instance. They iterate the data of that specific instance, regardless of subsequent reassignments.

---

## Bug 12 — Inner class accidentally shadowing static method

```java
public class Outer {
    public static int compute() { return 42; }

    public class Inner {
        public int compute() { return 0; }     // not an override — instance method
        public int total() {
            return compute();                    // calls Inner.compute() = 0
        }
    }
}
```

**Bug.** Subtle. The inner class has its own `compute()` method that shadows the outer's static. `Inner.total()` calls the *instance* `compute()`, not the outer static. Reader expects 42, gets 0.

**Fix.** Either rename the inner method, or qualify explicitly:

```java
return Outer.compute();
```

**Lesson.** Same-named methods in nested scopes resolve to the closest scope. Be explicit when in doubt.

---

## Pattern summary

| Bug type                                         | Watch for                                     |
|--------------------------------------------------|-----------------------------------------------|
| Implicit outer capture (1, 2, 11)                | Non-static nested + long-lived references     |
| Memory leaks (1, 2)                              | Anonymous inner classes as listeners          |
| Static vs inner confusion (3, 6)                 | Wrong choice for data structures or builders   |
| Capture rules (4)                                 | Loop variables; mutated locals               |
| Anonymous vs lambda (5, 9)                        | Verbose code; accidental subclassing          |
| Naming and shadowing (8, 10, 12)                 | Same names across nesting scopes              |

These bugs come from misunderstanding how nested classes interact with their enclosing context. Most are caught by IDE inspections (IntelliJ flags "this could be static," "anonymous class can be lambda," etc.) — enable them.
