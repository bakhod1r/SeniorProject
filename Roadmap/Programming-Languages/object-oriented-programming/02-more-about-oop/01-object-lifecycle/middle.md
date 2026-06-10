# Object Lifecycle — Middle

> **What?** The exact ordering and rules that govern initialization (static + instance), the role of `<init>` vs `<clinit>` in bytecode, why constructors can throw and what happens when they do, and how objects become eligible for GC.
> **How?** By tracing the bytecode `javac` emits, observing the order initialization actually runs, and learning the legal interactions between fields, initializer blocks, constructor calls, and inheritance.

---

## 1. The complete initialization order

When you write `new SubClass(args)`, Java executes phases in a strictly defined order:

### Class load phase (once per class)

1. Load `Object`, then each ancestor of `SubClass`, then `SubClass` itself.
2. For each class, in top-down order, run **`<clinit>`**:
   - static field initializers, in source order
   - `static { }` blocks, in source order

### Instance creation phase (every `new`)

3. JVM allocates memory for the entire object (all fields including inherited).
4. JVM zero-fills the entire object.
5. **Constructor chain executes top-down:**
   - For `Object` first, then `SuperClass`, then `SubClass`:
     a. Implicit `super(...)` runs first (or your explicit one).
     b. Then *that class's* instance field initializers run, in source order.
     c. Then *that class's* `{ }` instance initializer blocks, in source order.
     d. Then the rest of the constructor body.

```java
class Parent {
    int p = init("Parent.p");
    { System.out.println("Parent {} block"); }
    Parent() { System.out.println("Parent ctor"); }

    static int init(String name) { System.out.println("init " + name); return 0; }
}

class Child extends Parent {
    int c = init("Child.c");
    { System.out.println("Child {} block"); }
    Child() { System.out.println("Child ctor"); }
}

new Child();
```

Output:

```
init Parent.p
Parent {} block
Parent ctor
init Child.c
Child {} block
Child ctor
```

The pattern: **for each class up the chain, fields → `{}` → ctor body**. Never interleaved.

---

## 2. `<init>` vs `<clinit>` in bytecode

Java uses two synthetic methods in the class file:

| Method      | When it runs                            | What it contains                         |
|-------------|-----------------------------------------|------------------------------------------|
| `<clinit>`  | Once, at class initialization time      | Static field inits + `static { }` blocks |
| `<init>`    | Once per `new`, for each class in chain | `super()` call + instance inits + `{ }` + ctor body |

A class with no static state has **no `<clinit>`** at all. A class with no constructors gets a synthesized `<init>()V` that just calls `super()`.

```java
class Box {
    int width = 10;
    Box(int w) { this.width = w; }
}
```

Compiles to roughly:

```
public Box(int);
  Code:
     0: aload_0
     1: invokespecial #1   // Method java/lang/Object."<init>":()V
     4: aload_0
     5: bipush        10
     7: putfield      #2   // width = 10  (the field initializer)
    10: aload_0
    11: iload_1
    12: putfield      #2   // width = w   (constructor body)
    15: return
```

Notice the field initializer (`= 10`) is **inlined into every constructor** as bytecode. If you have three constructors, the field-init bytecode is emitted three times.

---

## 3. The `super(...)` rule

The very first instruction in a constructor must be either:

- `super(...)` — call a parent constructor, **or**
- `this(...)` — call another constructor in the same class (which itself ends in `super(...)`)

If you write neither, the compiler inserts an implicit `super()` (no args). This means the parent must have a no-arg constructor, otherwise the compiler errors.

```java
class A { A(int x) { } }      // no no-arg
class B extends A {           // compile error: implicit super() not found
    B() { }
}
```

Fix:

```java
class B extends A {
    B() { super(0); }
}
```

You **cannot** put any statement before `super(...)` (Java 22 introduces a limited form of this, but for now treat the rule as absolute).

---

## 4. Field init vs constructor: who wins?

```java
class C {
    int x = 1;        // field initializer
    C() { x = 2; }    // ctor body
}
new C().x;            // 2
```

The constructor body always runs *after* the field initializer for the same class. If both touch the same field, the constructor wins (it ran later).

But for inherited fields, the parent's field initializers + constructor have already run before the child's:

```java
class Parent { int x = 1; Parent() { x = 2; } }
class Child extends Parent { Child() { x = 3; } }
new Child().x;        // 3 — but Parent's field init still ran first
```

Order: `Parent.x = 1`, then `Parent ctor sets x = 2`, then `Child ctor sets x = 3`.

---

## 5. Instance initializer blocks: why they exist

```java
class Server {
    private final List<String> peers;
    {
        peers = new ArrayList<>();
        peers.add("default");
    }
    Server() { /* ... */ }
    Server(String name) { /* ... */ }
}
```

The `{ }` block runs in **every** constructor before the constructor body. Use it when you have multi-statement initialization that you'd otherwise duplicate across all constructors.

In practice, `{}` blocks are rare — most code uses `this(...)` chaining or factory methods. They show up most often in anonymous-class initializers (the "double-brace" idiom, which is generally discouraged).

---

## 6. Constructors and exceptions

A constructor can throw. If it does, the object is **never returned** to the caller and is eligible for GC immediately.

```java
class FileParser {
    private final FileInputStream stream;
    FileParser(String path) throws IOException {
        this.stream = new FileInputStream(path);    // can throw
        // if FileInputStream succeeded but next line throws,
        // we have a half-constructed object with an open file!
        validate();
    }
}
```

This is a **resource leak hazard**. If `validate()` throws, the `FileInputStream` is open but unreachable — the GC may close it eventually via the file's own cleaner, but you cannot rely on it. Use `try-with-resources` in the caller, or restructure with a static factory:

```java
static FileParser open(String path) throws IOException {
    var stream = new FileInputStream(path);
    try {
        return new FileParser(stream);
    } catch (Throwable t) {
        stream.close();
        throw t;
    }
}
```

---

## 7. The `this` reference during construction

Inside a constructor, `this` already refers to the partially constructed object. Methods called on `this` see fields in their *current* state — possibly defaults, possibly set by earlier statements.

```java
class Bad {
    int x;
    Bad() {
        printX();   // x is 0, the default — not what you might expect
        x = 42;
    }
    void printX() { System.out.println(x); }
}
```

Worse: a polymorphic call from a parent constructor can land in a child method that sees defaults:

```java
class Parent {
    Parent() { init(); }       // virtual dispatch → Child.init()
    void init() { }
}
class Child extends Parent {
    int value = 100;
    @Override void init() {
        System.out.println(value);   // prints 0! Child fields not initialized yet
    }
}

new Child();
```

Order: `Parent` ctor runs first, calls `init()`, dispatch resolves to `Child.init()`, but `value = 100` hasn't run yet (it runs *after* `super()` returns). So `value` is still 0.

**Rule:** never call overridable methods from a constructor.

---

## 8. Eligible-for-GC: the precise rule

An object becomes eligible for GC when **no GC root has a reference path to it**. GC roots include:

- Static fields of loaded classes
- Local variables on any thread's call stack (including parameters)
- Active threads themselves
- JNI references held by native code
- Synchronized monitors currently held

Common cases that make objects unreachable:

```java
{
    var x = new Foo();
}                       // x out of scope → Foo unreachable

list.set(0, null);      // overwrote the only reference

cache.remove(key);      // removed from a Map
```

Cases that surprisingly *don't*:

```java
Foo a = new Foo();
Foo b = a;
a = null;               // b still refers — Foo is alive
```

```java
class Listener {
    Listener() { eventBus.register(this); }   // eventBus holds 'this' forever → leak
}
```

---

## 9. Reachability vs liveness

The GC works on **reachability**, but what your program actually needs is **liveness** (will it use the object again). The GC is conservative: a reachable object that you'll never use again is still kept alive.

This is why memory leaks in Java aren't "freeing twice" — they're "holding references in collections, listeners, ThreadLocals, or static fields longer than you should."

---

## 10. The cost of object creation

It's cheaper than you think:

- TLAB allocation: bump-pointer in a thread-local buffer ≈ 5-10 ns
- Default-init: filled by the GC during TLAB allocation (region is pre-zeroed)
- Constructor: depends on what you put in it

For most short-lived objects, the cost is dominated by GC pressure, not allocation itself. Modern G1 / ZGC handle young-generation collection in microseconds for typical workloads.

It's also more expensive than you think when:

- Objects survive into the old generation (promotion has overhead)
- You allocate in tight loops causing GC churn
- You allocate large arrays (>1/2 of TLAB → goes directly to slow path)

We dive into this in `senior.md` and `optimize.md`.

---

## 11. Object identity and equality

Every object has an identity hash code (lazily assigned, stored in the header). Two `new Foo()` calls always produce two distinct objects with distinct identities, even if their fields are equal.

```java
new String("x") == new String("x");        // false: distinct identities
new String("x").equals(new String("x"));   // true: equal content
```

`==` compares references. `.equals()` compares content (if overridden). Records auto-override `equals` based on components.

---

## 12. What's next

| Topic                                                | File              |
|------------------------------------------------------|-------------------|
| GC algorithms (G1, ZGC), escape analysis, finalizers | `senior.md`        |
| Bytecode internals, class loading, OopMap            | `professional.md`  |
| JLS §12, JVMS §5, exact spec wording                 | `specification.md` |
| Design questions on lifecycle                        | `interview.md`     |
| Practice writing safe constructors                   | `tasks.md`         |

---

**Memorize this**: For any class chain `Object → A → B → C`, calling `new C()` runs: `<clinit>` for each class (once ever, top-down), then `<init>` for each class (top-down for every `new`), where each `<init>` does `super()` + field inits + `{}` blocks + ctor body. Anything that escapes a partially built `this` is a bug waiting to happen.
