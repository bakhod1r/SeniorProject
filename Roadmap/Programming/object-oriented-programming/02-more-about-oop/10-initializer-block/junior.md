# Initializer Block — Junior

> **What?** An *initializer block* is a chunk of code inside a class — outside any method or constructor — that runs as part of object or class initialization. Java has two kinds: **instance initializer blocks** (run for every `new`) and **static initializer blocks** (run once, when the class is loaded).
> **How?** Curly braces `{ ... }` inside the class body. Prefix with `static` for static initializer.

---

## 1. The simplest examples

**Instance initializer:**

```java
class Bag {
    List<String> items;
    {
        items = new ArrayList<>();
        items.add("default");
    }
}

Bag b = new Bag();
b.items;    // ["default"]
```

The `{ ... }` block runs every time you call `new Bag()`. It's like part of the constructor that runs in every constructor.

**Static initializer:**

```java
class Catalog {
    static Map<String, Product> byCode;
    static {
        byCode = new HashMap<>();
        byCode.put("ABC", new Product("A"));
        byCode.put("DEF", new Product("D"));
    }
}
```

The `static { ... }` block runs once, when `Catalog` is first used (loaded by the JVM). It initializes `byCode` before any other code can read it.

---

## 2. When initializer blocks run

**Instance initializer** runs:
1. After the implicit/explicit `super(...)` call returns.
2. Before the constructor body of *this* class runs.
3. Once per `new` call, regardless of which constructor was invoked.

**Static initializer** runs:
1. Once, when the class is first loaded by the JVM.
2. In the order they appear in the source code (multiple static blocks).
3. Together with static field initializers, in source order.

---

## 3. Why instance initializer blocks exist

If you have *multiple constructors* and *common setup logic*, an instance initializer block runs for all of them:

```java
class Server {
    private final List<String> peers;
    private final Logger log;

    // runs for every constructor
    {
        peers = new ArrayList<>();
        log = LoggerFactory.getLogger(getClass());
    }

    Server() { /* ... */ }
    Server(String name) { /* ... */ }
    Server(String name, int port) { /* ... */ }
}
```

Every `new Server(...)` runs the `{}` block, then the matching constructor. No code duplication.

In practice, you can usually avoid instance blocks by chaining constructors via `this(...)`. They're rare in modern Java.

---

## 4. Why static initializer blocks exist

When a static field needs *complex initialization* that doesn't fit on one line:

```java
class Lookup {
    static final Map<String, Integer> ROMAN_NUMERALS;
    static {
        var m = new HashMap<String, Integer>();
        m.put("I", 1);
        m.put("V", 5);
        m.put("X", 10);
        // ... 50 more entries ...
        ROMAN_NUMERALS = Map.copyOf(m);
    }
}
```

A `static` field initializer can only be a single expression. A static block lets you run any code, including loops, exception handling, etc.

---

## 5. Order of initialization

For a single class with both kinds of initializers:

```java
class C {
    static int s = compute("s");                 // static field init
    static { System.out.println("static block"); }  // static block

    int x = compute("x");                         // instance field init
    { System.out.println("instance block"); }      // instance block

    C() { System.out.println("ctor"); }

    static int compute(String name) {
        System.out.println("compute " + name);
        return 0;
    }
}

new C();
```

Output:
```
compute s
static block
compute x
instance block
ctor
```

Static parts run first (once, at class load). Then instance parts run for the `new`.

For inheritance, parent's static + instance run before subclass's. We dive deeper in `middle.md`.

---

## 6. The classic use case for static blocks

Pre-Java 8, complex collection initialization:

```java
static final List<String> NAMES;
static {
    List<String> list = new ArrayList<>();
    list.add("Alice");
    list.add("Bob");
    list.add("Charlie");
    NAMES = Collections.unmodifiableList(list);
}
```

Java 9+:
```java
static final List<String> NAMES = List.of("Alice", "Bob", "Charlie");
```

The factory methods (`List.of`, `Map.of`, `Set.of`) often replace static blocks for simple cases.

---

## 7. Static blocks for native libraries

Loading a JNI library:

```java
class NativeOps {
    static {
        System.loadLibrary("nativeops");
    }
    public static native int compute(int x);
}
```

The library is loaded once, when the class is first used. All native methods become callable.

---

## 8. Static blocks for resource setup

Loading config from a file at class init:

```java
class Config {
    static final Properties PROPS;
    static {
        try (var in = Config.class.getResourceAsStream("/app.properties")) {
            PROPS = new Properties();
            PROPS.load(in);
        } catch (IOException e) {
            throw new ExceptionInInitializerError(e);
        }
    }
}
```

If the file is missing, the class fails to initialize — every subsequent reference fails with `NoClassDefFoundError`. This is sometimes good (fail fast); sometimes bad (lazy loading is preferable).

---

## 9. Common newcomer mistakes

**Mistake 1: forward reference**

```java
class Bad {
    static int a = b;     // ERROR — b not yet declared
    static int b = 10;
}
```

Static field initializers and static blocks run in source order. Forward references to later fields are forbidden.

**Mistake 2: instance block referencing later instance fields**

```java
class Bad {
    int a = b;           // b is 0 (default) at this point
    int b = 10;
}
```

This compiles but is misleading. Field initializers run in source order; reading `b` before its initializer gives the default.

**Mistake 3: using static block for what should be a method**

```java
static {
    db.connect();        // runs at class load — surprising!
    db.runMigrations();
}
```

If the user just wants to use a different method, they're now paying for full initialization. Defer to first actual use.

---

## 10. Quick reference

| Element                        | Modifier | When it runs                |
|--------------------------------|----------|-----------------------------|
| Static field initializer       | `static` | Once, at class load          |
| Static initializer block       | `static` | Once, at class load          |
| Instance field initializer     | (none)   | Every `new`                  |
| Instance initializer block     | (none)   | Every `new`                  |
| Constructor body                | (none)   | Every `new` (after blocks)   |

---

## 11. When NOT to use initializer blocks

- The work could be done in a constructor (use that — clearer).
- The work could be a static factory method that builds the value lazily.
- The work has side effects (logging, IO) better deferred to first use.
- The work might fail and you want to handle it gracefully.

---

## 12. What's next

| Topic                                   | File              |
|-----------------------------------------|-------------------|
| Order with inheritance                   | `middle.md`        |
| `<clinit>` and `<init>` in bytecode      | `professional.md`  |
| JLS rules on initialization              | `specification.md` |
| Common initializer bugs                  | `find-bug.md`      |

---

**Memorize this**: initializer blocks are syntactic sugar for "run this code as part of class or instance initialization." Static blocks run once at class load; instance blocks run per `new`. Use them when the work doesn't fit on a single field-initializer line. Prefer constructor or factory methods for clarity.
