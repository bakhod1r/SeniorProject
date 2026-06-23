# Initializer Block — Middle

> **What?** The complete order of initialization for class hierarchies, when static and instance initializers run, the interaction between field initializers and constructors, and the design considerations of static blocks.
> **How?** By tracing the JLS-defined sequence and observing how `javac` inlines field/block code into `<init>` and `<clinit>`.

---

## 1. Full initialization order

For `new C()` where `C extends B extends A extends Object`:

### Class load (once per class, top-down)

For each class in `A → B → C` order:
1. Run static field initializers in source order.
2. Run static initializer blocks in source order.

### Instance creation (every `new`, top-down)

For each class in `A → B → C` order, for that class:
1. Run super() (in C's case, calls B's `<init>`, which calls A's, which calls Object's).
2. Run instance field initializers in source order.
3. Run instance initializer blocks in source order.
4. Run constructor body (the rest of the constructor).

The implicit `super(...)` is what threads the initialization through the chain.

---

## 2. A complete example

```java
class A {
    static int sa = log("A.sa");
    static { log("A static block"); }
    int ia = log("A.ia");
    { log("A instance block"); }
    A() { log("A ctor"); }
    static int log(String s) { System.out.println(s); return 0; }
}

class B extends A {
    static int sb = log("B.sb");
    static { log("B static block"); }
    int ib = log("B.ib");
    { log("B instance block"); }
    B() { log("B ctor"); }
}

new B();
```

Output:
```
A.sa
A static block
B.sb
B static block
A.ia
A instance block
A ctor
B.ib
B instance block
B ctor
```

Static parts run once for each class (top-down). Instance parts run on every `new`.

---

## 3. Multiple static blocks

A class can have many static blocks. They run in source order, interleaved with static field initializers:

```java
class C {
    static int a = 1;
    static { System.out.println("block 1"); }
    static int b = 2;
    static { System.out.println("block 2"); }
}
```

Internally, the compiler synthesizes one `<clinit>` method that contains:
1. `a = 1`
2. `println("block 1")`
3. `b = 2`
4. `println("block 2")`

In source order. They're not "separate" at runtime — just one combined method.

---

## 4. Multiple instance blocks

Similarly, multiple instance blocks combine into the constructor's prologue (after super, before constructor body), in source order:

```java
class C {
    int a = 1;
    { System.out.println("block 1"); }
    int b = 2;
    { System.out.println("block 2"); }
    C() { System.out.println("ctor"); }
}
```

Combined into `<init>` after super():
1. `a = 1`
2. println("block 1")
3. `b = 2`
4. println("block 2")
5. println("ctor")

---

## 5. When does the static block run?

JLS §12.4.1 specifies the triggers:
- A `new` of the class.
- An invocation of a static method declared in the class.
- An assignment to a static field declared in the class.
- A read of a static field declared in the class (unless the field is a *constant variable* — `static final` of primitive or String type initialized to a constant expression).
- Initialization of a subclass (which triggers the parent's init).

```java
class Loaded {
    static { System.out.println("loaded"); }
    static final int X = 42;          // constant — reading doesn't trigger init
    static int Y = 10;                 // not constant — reading triggers
    static String S = "hi";            // constant — reading doesn't trigger
    static String T = compute();       // not constant
}

System.out.println(Loaded.X);    // doesn't print "loaded"
System.out.println(Loaded.Y);    // prints "loaded" first
```

---

## 6. Static block + constructor for singleton patterns

```java
class Database {
    private static final Database INSTANCE;
    static {
        try {
            INSTANCE = new Database();
        } catch (Exception e) {
            throw new ExceptionInInitializerError(e);
        }
    }
    private Database() { /* heavy work */ }
    public static Database get() { return INSTANCE; }
}
```

The static block can do complex initialization (handle exceptions, configure dependencies). Class loading semantics make this thread-safe.

Modern alternative: lazy holder idiom (defers init until first call).

---

## 7. Initializer block restrictions

**Static blocks cannot:**
- Throw checked exceptions (must wrap in `ExceptionInInitializerError`).
- Reference `this` (no instance exists yet).
- Reference instance fields.

**Instance blocks cannot:**
- Be `static`.
- Reference fields/locals declared *after* them in the source (forward reference rules apply).

```java
class C {
    static {
        throw new IOException();   // ERROR — checked exception
    }
}
```

Wrap:
```java
static {
    try {
        // ...
    } catch (IOException e) {
        throw new RuntimeException(e);   // or ExceptionInInitializerError
    }
}
```

---

## 8. Forward reference rules

JLS §8.3.3 forbids reading a static or instance field before its declaration if the declaration would assign to it later:

```java
class C {
    int x = y;       // ERROR — illegal forward reference
    int y = 5;
}
```

But you can write to a later field (assignment counts as definite assignment):

```java
class C {
    int x = init();
    int y = 5;
    int init() { y = 10; return 0; }   // y assigned via method — OK
}
```

The rule is subtle. In practice, declare fields in a sensible order.

---

## 9. Initializers and exceptions

If an instance initializer or constructor throws, the object construction fails. Any allocated resources before the throw are leaked unless cleaned up.

If a static initializer throws (or doesn't catch), the class is marked "erroneous." Subsequent attempts to use the class throw `NoClassDefFoundError` — *not* the original exception.

```java
class Bad {
    static {
        Object.requireNonNull(null);   // throws NPE
    }
    public static int x = 5;
}

Bad.x;    // first access: ExceptionInInitializerError(NPE)
Bad.x;    // subsequent: NoClassDefFoundError
```

This is famously confusing. The first access reports the cause; later accesses don't.

---

## 10. Static blocks for legacy compatibility

```java
class Logger {
    static {
        if (System.getenv("LOG_FORMAT") == null) {
            System.setProperty("log.format", "[%level] %message");
        }
    }
}
```

Sometimes used to set system properties at class load. Brittle — depends on class load order. Prefer dependency injection or explicit setup methods.

---

## 11. Static blocks vs static factory methods

```java
// static block
static final Map<String, X> CACHE;
static {
    CACHE = new HashMap<>();
    CACHE.put("a", new X("a"));
}

// static factory + lazy
private static volatile Map<String, X> cache;
public static Map<String, X> cache() {
    if (cache == null) {
        synchronized (Loader.class) {
            if (cache == null) cache = computeCache();
        }
    }
    return cache;
}
```

Static block: eager, simple, runs at class load.
Lazy factory: deferred, more complex, only initialized if used.

For optional/expensive init, prefer lazy. For required/cheap init, eager is fine.

---

## 12. Anonymous double-brace initialization

A trick using instance initializer in an anonymous subclass:

```java
Map<String, Integer> m = new HashMap<>() {{
    put("a", 1);
    put("b", 2);
}};
```

The outer `{}` is the anonymous subclass body; the inner `{}` is the instance initializer. Looks clever but:
- Creates an anonymous subclass per use site
- Captures outer `this` if used in inner classes
- Can confuse serialization/equals

Modern Java prefers `Map.of(...)` for static maps, builders for runtime construction. Avoid double-brace.

---

## 13. What's next

| Topic                          | File              |
|--------------------------------|-------------------|
| `<clinit>`, `<init>` bytecode   | `professional.md`  |
| JLS initialization spec         | `specification.md` |
| Interview prep                  | `interview.md`     |
| Common bugs                     | `find-bug.md`      |

---

**Memorize this**: static parts run once per class load, top-down through the hierarchy. Instance parts run per `new`. Field initializers and blocks combine in source order. Constants don't trigger class init. Failed static init poisons the class. Avoid double-brace; use modern factories.
