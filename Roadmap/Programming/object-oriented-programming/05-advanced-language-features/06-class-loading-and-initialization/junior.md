# Class Loading and Initialization — Junior

> **What?** Every Java class travels through three JVM phases — **loading**, **linking**, and **initialization** — before its first method ever runs. The classes that perform this travel are themselves objects, organised into a small hierarchy: **bootstrap**, **platform**, and **application**. Initialization is *lazy*: a class is touched only when actively used, runs `<clinit>` (the synthetic static initializer) exactly once per classloader, and is implicitly thread-safe.
> **How?** When you see `static { ... }` execute, or `ExceptionInInitializerError` in a stack trace, or `NoClassDefFoundError` after a hot-deploy, the classloading machinery is talking to you. Learn the three phases, learn the three loaders, and the rest of the chapter follows.

---

## 1. Why classloading matters before you write a single line

You can write Java for years without thinking about classloaders. Then one day a hot-deploy starts leaking memory, or `Class.forName("...")` works in unit tests but throws `ClassNotFoundException` in the WAR you just shipped, or `ExceptionInInitializerError` greets you in production with a `Caused by` you cannot reproduce locally. Every one of those is a classloader story.

Java does not load all classes when the JVM starts. It loads them on demand — the moment a method is called that mentions a type, the JVM goes off and finds, parses, verifies, prepares, resolves, and finally *initializes* that class. The mechanics of "finds" are the classloader hierarchy; the mechanics of everything after are JVMS §5.

Understanding even the basics changes how you read stack traces, how you write static initializers, and how you reason about plugin systems, web apps, and tests.

---

## 2. The three phases — loading, linking, initialization (JVMS §5)

The JVM specification splits the lifecycle of a class into three phases:

| Phase            | What happens                                                               | Spec               |
|------------------|----------------------------------------------------------------------------|--------------------|
| **Loading**      | A classloader finds the `.class` bytes and creates an in-memory `Class<?>`.| JVMS §5.3          |
| **Linking**      | The JVM verifies the bytecode, **prepares** static fields (default values), and **resolves** symbolic references. | JVMS §5.4 |
| **Initialization** | The JVM runs `<clinit>` — static initializers and static-field assignments — exactly once. | JVMS §5.5 |

The order is strict and the boundaries matter. After *preparation*, every static field exists at its default zero value (`0`, `0.0`, `false`, `null`). Only after *initialization* do the values you wrote in `static` blocks or after `=` appear. A class that is loaded but not yet initialized can still have its `Class<?>` object reflected on — but reading its static fields would give you the defaults, not your initializers.

```java
public class Counter {
    static int count = 42;      // assignment runs in <clinit>, during initialization
    static {
        System.out.println("Counter <clinit> running");
    }
}
```

Print statements inside `static` blocks are the cheapest possible way to watch the three phases unfold in real code.

---

## 3. The classloader hierarchy (since Java 9)

Every `Class<?>` object remembers the loader that loaded it. The loaders form a parent chain — three built-ins, plus any you create yourself.

```
+----------------------+
|   bootstrap loader   |   <-- written in C++, loads java.*  (returns null from getClassLoader())
+----------+-----------+
           |
+----------+-----------+
|   platform loader    |   <-- Java SE modules outside java.*: java.sql, java.xml, jdk.*
+----------+-----------+
           |
+----------+-----------+
|  application loader  |   <-- your classpath / module path (the one you usually mean)
+----------------------+
```

Before Java 9 the middle layer was called the **extension classloader** and used `jre/lib/ext/`. JEP 261 (Java Platform Module System) replaced it with the **platform classloader**, which loads the modular Java SE classes. The extension mechanism is gone; do not look for it in modern code.

```java
public class WhoLoadedYou {
    public static void main(String[] args) {
        System.out.println(String.class.getClassLoader());                  // null  (bootstrap)
        System.out.println(java.sql.Connection.class.getClassLoader());     // platform
        System.out.println(WhoLoadedYou.class.getClassLoader());            // app
    }
}
```

Bootstrap returns `null` from `getClassLoader()` because it is implemented in native code and has no Java representation. Anything you write yourself lives in the application loader unless you intentionally place it elsewhere.

The default lookup order is **parent-first delegation**: the application loader asks the platform loader, which asks the bootstrap loader; only if no parent has the class does the requesting loader look itself. This is what makes `java.lang.String` always come from the bootstrap loader, even if a malicious user puts a `java/lang/String.class` on the application classpath — it gets shadowed.

---

## 4. The `<clinit>` method — your first up-close look

When `javac` compiles a class, it gathers every static field initializer and every `static { ... }` block into a single synthetic method whose name is `<clinit>`. (You can never write a method called `<clinit>` yourself — the angle brackets make it an invalid Java identifier; the JVM accepts it because the rules for method names inside the JVM are wider than those in the language. JVMS §2.9.)

```java
public class Config {
    static final int PORT = 8080;                // compile-time constant — no <clinit>
    static String host = "localhost";            // assignment goes into <clinit>
    static final List<String> ROUTES = new ArrayList<>();   // runtime expression — into <clinit>

    static {
        ROUTES.add("/health");
        ROUTES.add("/metrics");
    }
}
```

Javac produces a `<clinit>` that runs, in source order:

1. `host = "localhost";`
2. `ROUTES = new ArrayList<>();`
3. `ROUTES.add("/health");`
4. `ROUTES.add("/metrics");`

`PORT` is a *compile-time constant* (`static final` initialized to a constant expression of a primitive or `String` type, JLS §4.12.4). It does **not** appear in `<clinit>`. The compiler inlines its value at every call site. That distinction matters more than it looks — you will meet it again in section 7.

---

## 5. Lazy initialization — when does `<clinit>` actually run?

JLS §12.4.1 names the exact triggers. A class `C` is initialized only when one of these happens *for the first time*:

- An instance of `C` is created (`new C()`).
- A static method of `C` is invoked.
- A static field of `C` is assigned or read — **except** if the field is a compile-time constant.
- `C` is the subject of an explicit `Class.forName("...")` (with `initialize = true`, the default).
- A subclass of `C` is initialized (initialization recurses upward — superclass first).
- The JVM starts and `C` is the entry-point class containing `main`.

Notably, the following do **not** trigger initialization:

- Loading `C.class` via `MyClass.class` — the `Class<?>` literal triggers loading but not initialization.
- Calling `ClassLoader.loadClass("C")` — explicitly skips initialization.
- Reading a *compile-time constant* — javac has inlined the value already.

```java
public class Greeter {
    static { System.out.println("Greeter <clinit>"); }
    public static final String NAME = "World";       // compile-time constant
    public static String greet() { return "Hello, " + NAME; }
}

public class Demo {
    public static void main(String[] args) {
        Class<?> c = Greeter.class;             // 1) loads, does NOT initialize
        System.out.println(Greeter.NAME);       // 2) compile-time constant, NO init
        Greeter.greet();                        // 3) static method call — NOW init runs
    }
}
```

Output:

```
Greeter <clinit>
```

The print appears only once, only when step 3 runs. Walk through this in your head until it is obvious — most of the "weird" classloading bugs in the next files are this same rule misapplied.

---

## 6. `Class.forName` vs `ClassLoader.loadClass`

Two ways to programmatically grab a `Class<?>`. They differ in one critical detail:

```java
Class<?> a = Class.forName("com.acme.Plugin");
// loads, links, AND initializes (default 3-arg overload uses initialize = true)

Class<?> b = Thread.currentThread()
                   .getContextClassLoader()
                   .loadClass("com.acme.Plugin");
// loads and links — but does NOT run <clinit>
```

The three-argument `Class.forName(name, initialize, loader)` exposes the toggle:

```java
Class<?> c = Class.forName("com.acme.Plugin", false, loader);
// loaded, not initialized — same effect as loadClass
```

Use `Class.forName` when you genuinely want the class to be live (e.g., registering a JDBC driver, the old `Class.forName("org.postgresql.Driver")` idiom). Use `loadClass` when you only need the metadata (reflection on annotations, plugin discovery that should not yet have side effects).

---

## 7. Common newcomer surprises

**Surprise 1: a `final` constant does not trigger initialization.**

```java
public class Holder {
    static { System.out.println("Holder loaded"); }
    public static final int ANSWER = 42;
}

public class Use {
    public static void main(String[] a) { System.out.println(Holder.ANSWER); }
    // prints 42, NOT "Holder loaded".
}
```

`ANSWER` is a compile-time constant; javac compiled the literal `42` directly into `Use`. You can even delete `Holder` from the classpath after compilation and `Use` still runs — the constant has been *inlined*.

**Surprise 2: a `final` *non-primitive* expression DOES trigger initialization.**

```java
public class Holder2 {
    static { System.out.println("Holder2 loaded"); }
    public static final Integer ANSWER = 42;        // boxed, not a compile-time constant
}
```

`Integer` is not in the "compile-time constant" set (JLS §4.12.4). Reading `Holder2.ANSWER` triggers `<clinit>`. The same trap applies to `String.valueOf(42)`, `new BigDecimal("0.01")`, `LocalDate.of(...)`, etc. Only primitives and `String` literals dodge initialization.

**Surprise 3: declaring `Class<?> c = MyClass.class;` does not init.**

The class literal triggers *loading*, not *initialization*. A `Class<?>` reference can exist without `<clinit>` ever running. This is sometimes surprising in test code that thinks `MyClass.class` is "the same as touching it".

**Surprise 4: superclass initializes before subclass.**

```java
class A { static { System.out.println("A"); } }
class B extends A { static { System.out.println("B"); } }

new B();   // prints A, then B
```

JLS §12.4.1 is explicit: a class is initialized by first initializing its direct superclass (recursively). Subclass code that depends on superclass static state can rely on the parent being ready.

**Surprise 5: `<clinit>` runs exactly once per classloader.**

If the same class file is loaded by two different classloaders, you get *two* `Class<?>` objects, *two* independent `<clinit>` runs, and *two* independent sets of static fields. This is why web containers (Tomcat, Jetty) can host multiple apps with conflicting library versions — each web app has its own classloader and its own copy of every class's statics. We come back to this in `middle.md`.

---

## 8. A first complete demo

```java
public class InitDemo {
    public static void main(String[] args) throws Exception {
        System.out.println("--- main start ---");
        Class<?> c = Class.forName("InitDemo$Greeter", false,
                                   InitDemo.class.getClassLoader());
        System.out.println("after forName(initialize=false): nothing printed yet");

        System.out.println("Greeter.WHO = " + Greeter.WHO);   // compile-time constant
        System.out.println("after reading WHO: still nothing");

        Greeter.greet();                                       // triggers <clinit>
    }

    static class Greeter {
        static { System.out.println("Greeter <clinit> running"); }
        public static final String WHO = "world";
        public static void greet() { System.out.println("hello, " + WHO); }
    }
}
```

Run it and watch the order. The `forName(..., false, ...)` call loads but does not initialize; reading the compile-time constant `WHO` also skips initialization; only the call to `greet()` triggers `<clinit>`.

---

## 9. Quick rules

- [ ] Three phases per class: **loading**, **linking** (verify + prepare + resolve), **initialization**.
- [ ] Three built-in loaders since Java 9: **bootstrap** (core), **platform** (Java SE modules), **application** (your code). No more "extension" loader.
- [ ] `<clinit>` runs once per classloader, on first *active use* of the class.
- [ ] Compile-time constants (`static final` primitives or `String` literals) do **not** trigger initialization.
- [ ] `Class.forName(name)` initializes by default; `ClassLoader.loadClass(name)` does not.
- [ ] `MyClass.class` triggers loading, not initialization.
- [ ] Superclass `<clinit>` always runs before subclass `<clinit>`.

---

## 10. What's next

| Topic                                                          | File              |
|----------------------------------------------------------------|-------------------|
| Initialization order, multi-classloader scenarios, ServiceLoader | `middle.md`        |
| Linking phases, thread safety, classloader leaks, AppCDS         | `senior.md`        |
| Code review, ArchUnit rules, leak debugging                      | `professional.md`  |
| JLS §12.4 / §12.5, JVMS §5 / §2.9, JEP 261 / 310 / 350           | `specification.md` |
| 10 bug snippets with stack traces                                | `find-bug.md`      |
| AppCDS, CDS, GraalVM native image                                | `optimize.md`      |
| Hands-on exercises                                               | `tasks.md`         |
| Interview Q&A                                                    | `interview.md`     |

Cross-references:

- [../02-jpms-modules/](../02-jpms-modules/) — module system and platform-loader interaction.
- [../03-reflection-and-annotations/](../03-reflection-and-annotations/) — `Class<?>`, `Class.forName`, reflection vs initialization.
- [../../03-design-principles/06-fragile-base-class-problem/](../../03-design-principles/06-fragile-base-class-problem/) — static state in inheritance is its own subspecies of fragility.
- [../../06-method-dispatch-and-internals/04-object-memory-layout/](../../06-method-dispatch-and-internals/04-object-memory-layout/) — what the `Class<?>` object looks like in memory.

---

**Memorize this:** every class runs **load → link → init**, in that order, lazily. The application loader asks the platform loader asks the bootstrap loader. `<clinit>` runs once per classloader, on first active use, and compile-time constants do not count as active use. `Class.forName` initializes; `loadClass` does not. Master those three sentences and the rest of class loading is detail.
