# Class Loading and Initialization — Interview Q&A

20 questions covering the three phases, the classloader hierarchy, `<clinit>` semantics, thread safety, leaks, AppCDS, JPMS, `ServiceLoader`, and the common bug patterns from `find-bug.md`.

---

## Q1. What are the three phases of class loading in the JVM?

The JVM spec (JVMS §5) splits a class's lifecycle into **loading**, **linking**, and **initialization**. Loading finds the `.class` bytes and builds an in-memory `Class<?>`. Linking has three substeps — verification (bytecode is type-safe), preparation (static fields allocated and zero-initialized), resolution (symbolic references resolved to direct ones). Initialization runs `<clinit>` — static field assignments and `static` blocks. The order is fixed and lazy: a class is initialized only on first *active use* (JLS §12.4.1).

**Follow-up:** "What's the difference between preparation and initialization?" Preparation assigns *default* values (`0`, `null`); initialization runs your initializers. Reading a static field before `<clinit>` returns the default — that's the source of the cyclic-init "silent zero" bug.

---

## Q2. Describe the classloader hierarchy in modern Java.

Since Java 9 (JEP 261) there are three built-in loaders: **bootstrap** (native code, loads `java.*`, `getClassLoader()` returns `null`), **platform** (Java SE modules outside `java.*`: `java.sql`, `java.xml`, `jdk.*`), and **application** (your classpath / module path). The pre-Java 9 "extension classloader" is gone; the platform loader replaces it. Delegation is parent-first by default — the application loader asks platform asks bootstrap; only if the parents fail does the requesting loader search itself. This protects `java.lang.String` from being shadowed by a malicious classpath entry.

**Trap:** Saying "bootstrap, extension, application" — that's Java 8 vocabulary. Modern Java is bootstrap → platform → application.

---

## Q3. When does `<clinit>` actually run?

JLS §12.4.1 enumerates the triggers: first instance creation, first static method call, first static field read (except compile-time constants), first `Class.forName(name)` (default initialize=true), the JVM starting on a class containing `main`, or a subclass being initialized (recurses upward). Class literal `MyClass.class` and `ClassLoader.loadClass(name)` *do not* initialize — they only load. The JVM guarantees `<clinit>` runs exactly once per classloader and is implicitly synchronized.

```java
Class<?> c = MyClass.class;          // loads, does NOT initialize
ClassLoader.getSystemClassLoader().loadClass("MyClass");  // same
Class.forName("MyClass");            // INITIALIZES (default)
new MyClass();                        // INITIALIZES
```

**Follow-up:** "What if I read a `static final int X = 42;` field?" That's a compile-time constant (JLS §4.12.4) — javac inlines `42` at the use site, no initialization happens.

---

## Q4. What's the difference between `Class.forName(name)` and `ClassLoader.loadClass(name)`?

`Class.forName(name)` by default *initializes* the class — runs `<clinit>`. `ClassLoader.loadClass(name)` only loads and links — `<clinit>` does not run. The three-argument `Class.forName(name, initialize, loader)` exposes the toggle: `Class.forName("Foo", false, loader)` behaves like `loadClass`. Use `loadClass` when scanning for plugins (you want metadata without running constructors or DB connections in static blocks); use `forName` when you actually want the class live.

```java
Class<?> a = ClassLoader.getSystemClassLoader().loadClass("Foo");   // <clinit> doesn't run
Class<?> b = Class.forName("Foo");                                  // <clinit> runs
```

**Trap:** Saying "they do the same thing". They differ in exactly one observable way — but that one difference is what causes "first deploy of a plugin runs `<clinit>` and fails on a missing DB".

---

## Q5. What is `<clinit>`?

`<clinit>` is a synthetic JVM method (JVMS §2.9) that contains every static field initializer and every `static { ... }` block, concatenated in textual order. It has descriptor `()V` (no args, returns void) and is `ACC_STATIC`. The angle brackets make its name an illegal Java identifier, so you can't write it manually — javac generates it. The JVM calls `<clinit>` once per classloader on first active use, holding a per-class initialization lock. After it returns, every thread observing the class as initialized has a happens-before relationship with the writes made inside `<clinit>` — that's the foundation of the Initialization-on-demand Holder idiom.

**Follow-up:** "Can `<clinit>` throw?" Yes. The JVM wraps the throwable in `ExceptionInInitializerError`. The class becomes permanently erroneous; every later access throws `NoClassDefFoundError` (with no cause attached).

---

## Q6. Is `<clinit>` thread-safe?

Yes — implicitly. JLS §12.4.2 specifies a per-class lock the JVM acquires before running `<clinit>`. If two threads ask to initialize the same class concurrently, one wins the lock and runs `<clinit>`; the other waits until completion. After completion, both threads see all writes through a happens-before edge — no explicit synchronization needed. This is what makes the Holder idiom thread-safe:

```java
public final class Heavy {
    private Heavy() {}
    private static class Holder { static final Heavy INSTANCE = new Heavy(); }
    public static Heavy instance() { return Holder.INSTANCE; }
}
```

**Trap:** Some candidates think this still needs `volatile` or double-checked locking. It doesn't — the JVM's per-class lock plus the happens-before guarantee are the entire mechanism.

---

## Q7. Why is "don't start threads in `<clinit>`" a hard rule?

Because the per-class init lock creates deadlock potential. If `<clinit>` of `A` spawns a thread that *also* needs to initialize `A`, the new thread blocks waiting for `A`'s lock — held by the original thread. If the original thread `join`s the new thread (waiting for it to finish), deadlock. Even without `join`, the new thread sees `A` as not-yet-initialized (default static-field values) until the original thread returns. Production stories: library startup hangs, JDBC driver init deadlocks, logging frameworks deadlocking against their own metric registries.

```java
class Bomb {
    static {
        Thread t = new Thread(() -> { int x = Bomb.SOMETHING; });
        t.start();
        try { t.join(); } catch (InterruptedException ignored) {}      // deadlock
    }
    static int SOMETHING = 42;
}
```

**Follow-up:** "What's a safe alternative?" Move the work to a `start()` method called from the composition root after the class is initialized.

---

## Q8. What is `ExceptionInInitializerError` and why is its successor `NoClassDefFoundError`?

JLS §12.4.2 step 10: if `<clinit>` throws, the JVM wraps the original exception in `ExceptionInInitializerError` and marks the class as in an *erroneous state*. Subsequent attempts to use the class don't re-run `<clinit>`; they throw `NoClassDefFoundError` with the message "Could not initialize class X" and **no cause**. This is the "permanently bricked class" problem — and why I/O in static initializers is dangerous. If the I/O fails, the class is dead for the lifetime of the JVM, and stack traces after the first failure don't carry the original cause.

**Trap:** Catching `ExceptionInInitializerError` and assuming you can recover. You can't — the class is poisoned.

---

## Q9. What is a classloader leak, and how do you debug one?

A classloader leak is when a classloader (typically a per-app `WebappClassLoader`) cannot be garbage-collected after the app is undeployed, because something outside it still holds a strong reference to one of its classes or instances. Every redeploy creates a new loader; old loaders pile up; Metaspace grows (since Java 8, replacing the pre-Java-8 PermGen problem). Common roots: `ThreadLocal` values on container threads, `DriverManager`-registered JDBC drivers, JNDI bindings, unstopped scheduled tasks, third-party logger contexts.

Debug it: heap dump (`jcmd PID GC.heap_dump`), open in MAT or VisualVM, search for instances of the container's loader class, run "Path to GC root, excluding weak references". The path points at the root — fix at that root (clear the thread-local, deregister the driver, stop the executor).

**Follow-up:** "Why PermGen vs Metaspace?" Java 8 removed PermGen (JEP 122). Class metadata moved to Metaspace, defaulting to *unbounded* native memory. The leak still exists; it now consumes native memory until OS OOM, not heap.

---

## Q10. Two classloaders load the same class. Are the resulting `Class<?>` objects equal?

No. Class identity is `(defining-loader, fully-qualified-name)` (JVMS §5.3). Two loaders defining the same class produce two distinct `Class<?>` objects: `==` returns `false`, `equals` returns `false`, `isAssignableFrom` returns `false`. Casting an instance loaded by loader A to a type seen via loader B throws `ClassCastException` with a confusing message like `com.acme.X cannot be cast to com.acme.X`. The parenthetical loader names in modern JVM messages give the game away.

The fix: communicate across loaders through a *shared* type defined by a parent loader they both delegate to. Plugin APIs are deliberately separated into "API JARs" (parent loader) and "plugin JARs" (child loaders) for this reason.

---

## Q11. What is AppCDS and how do you use it?

**Application Class Data Sharing** (JEP 310, Java 10) extends the JDK's class-data-sharing mechanism to user classes. It caches the parsed, verified, prepared form of classes in a `.jsa` archive file, which the JVM memory-maps at startup. The result: faster cold start (skip parsing and verification) and lower per-process memory (the archive is shared across JVM instances). Typical wins are 25–40% startup reduction for Spring-Boot-class apps.

The Java 13+ flow (JEP 350) is one command line each:

```
# Record
java -XX:ArchiveClassesAtExit=app.jsa -jar app.jar

# Use
java -XX:SharedArchiveFile=app.jsa -jar app.jar
```

For containers, the archive is baked into the image at build time. AppCDS doesn't save `<clinit>` execution time or JIT warm-up — only the load/link cost.

**Follow-up:** "What about the JDK side?" JEP 341 ships default JDK CDS archives; JEP 388 makes them universal. Default JVMs run with `-Xshare:auto`; disabling CDS is almost always wrong.

---

## Q12. What changed about classloaders in Java 9?

JEP 261 introduced the **Java Platform Module System** and renamed the middle loader. Pre-Java 9: bootstrap → extension (`jre/lib/ext/`) → application. Java 9+: bootstrap → platform → application. The extension mechanism is gone. The platform loader loads Java SE modules outside `java.*` (`java.sql`, `java.xml`, `jdk.*`). Additionally:

- Every `Class<?>` now belongs to a `Module` (named or unnamed).
- `ModuleLayer` is a new abstraction *above* classloaders, supporting per-module loaders or shared loaders.
- `ServiceLoader.load(C.class)` respects `provides`/`uses` for named modules — it doesn't always go through `META-INF/services` files.
- Strong encapsulation: a class in an unexported package is invisible at runtime, not just at compile time.

For application code that doesn't use JPMS, classes still load from the application loader as unnamed-module code. The visible difference is mainly the platform-vs-extension naming.

---

## Q13. How does `ServiceLoader` work?

`java.util.ServiceLoader` discovers implementations of an interface lazily. For *classpath* (unnamed-module) code: it reads `META-INF/services/<interface-fqn>` files, each listing implementor class names. For *named modules*: it walks the module graph for `provides X with Y` declarations. By default it uses the **thread context classloader**, which is the per-app loader in containerised settings and the application loader in plain `main`. Each provider is instantiated lazily on first iteration:

```java
for (PaymentGateway g : ServiceLoader.load(PaymentGateway.class)) {
    // g.getClass() is loaded *now*, on first iteration that reaches it
}
```

**Trap:** In a named module, forgetting `uses X;` in `module-info.java` causes `ServiceLoader.load(X.class)` to return zero providers, silently — no exception, no warning. The opposite trap: relying on `META-INF/services` from inside a named module — those files are ignored, only `provides` works.

---

## Q14. How can you build a custom classloader?

Extend `ClassLoader` and override `findClass(name)` (the simple recipe) or `loadClass(name, resolve)` (when you need to change delegation policy). `findClass` reads the bytes, calls `defineClass` to turn them into a `Class<?>`. The default `loadClass` does **parent-first delegation** — that's usually what you want for safety, but plugin systems often override with **child-first** for non-`java.*` classes so each plugin can use its own library versions.

```java
public class JarLoader extends ClassLoader {
    public JarLoader(Path jar, ClassLoader parent) {
        super("jar:" + jar, parent);
        this.jar = jar;
    }
    @Override protected Class<?> findClass(String name) throws ClassNotFoundException {
        byte[] bytes = readFromJar(name);
        return defineClass(name, bytes, 0, bytes.length);
    }
}
```

Two extras: implement `Closeable` so file handles release deterministically, and use `getClassLoadingLock(name)` (the parallel-capable lock) to avoid concurrent-load races.

---

## Q15. What's the difference between a compile-time constant and a `static final` field?

A *constant variable* (JLS §4.12.4) is a `static final` field of **primitive type or `String`** initialized with a **constant expression**. Only these are inlined by javac at every call site — reading them never triggers `<clinit>`. A `static final` field of any other type (`Integer`, `BigDecimal`, `LocalDate`, `Pattern`) is *not* a constant variable, even if it's logically constant — reading it triggers `<clinit>`.

```java
public class Config {
    static final int PORT = 8080;                       // compile-time constant
    static final String HOST = "localhost";             // compile-time constant
    static final Integer BOXED_PORT = 8080;             // NOT a compile-time constant
    static final Pattern P = Pattern.compile("\\d+");   // NOT a compile-time constant
    static { System.out.println("Config <clinit>"); }
}
```

Reading `Config.PORT` doesn't print; reading `Config.BOXED_PORT` does.

**Follow-up:** "Why does this matter for performance?" Compile-time constants let you have effectively-free constants without paying any `<clinit>` cost. They're also robust to refactoring across JARs because the value is *inlined* in callers.

---

## Q16. What is the Initialization-on-demand Holder idiom?

A thread-safe, lazy singleton pattern that relies on the JVM's per-class initialization lock:

```java
public final class Singleton {
    private Singleton() {}
    private static class Holder { static final Singleton INSTANCE = new Singleton(); }
    public static Singleton instance() { return Holder.INSTANCE; }
}
```

`Singleton.<clinit>` is empty — referencing `Singleton.class` or the outer class doesn't construct the instance. `Holder.<clinit>` runs only when `Singleton.instance()` is first called. The JVM guarantees `<clinit>` runs once and that all later threads see the result through happens-before. No `synchronized`, no `volatile`, no double-checked locking.

**Follow-up:** "How does this compare to `enum`-based singletons?" `enum Singleton { INSTANCE; ... }` is also lazy (initializes when the enum class is first used), thread-safe, and serialization-safe — both are good. Holder is more flexible (can take constructor args via reflection-free patterns); enum is more idiomatic for true singletons.

---

## Q17. What is the order of initialization between a class and its superclass?

Superclass first. If `B extends A` and you trigger `B`'s initialization, the JVM initializes `A` (and `A`'s superclass, and so on, up to `Object`) before running `B`'s `<clinit>` (JLS §12.4.1). Instance initialization (`new B()`) is similar but interleaved: the JVM calls `B`'s `<init>`, which first invokes `super()` to run `A`'s `<init>` (including `A`'s instance field initializers), and then runs `B`'s instance initializers and constructor body.

```java
class A { static { System.out.println("A static"); } { System.out.println("A instance"); } }
class B extends A { static { System.out.println("B static"); } { System.out.println("B instance"); } }

new B();
// Output: A static, B static, A instance, B instance
```

**Trap:** Calling overridable methods from a constructor — they dispatch to the subclass, which hasn't yet run its instance initializers. The classic "fields are null" bug (see `find-bug.md` Bug 2 and the Fragile Base Class topic).

---

## Q18. What is the parent-first delegation model, and why is it the default?

When a classloader is asked to load a class, the default `ClassLoader.loadClass` first asks its **parent** to load it; only if the parent fails does the classloader search itself. This means `java.lang.String` always comes from the bootstrap loader, even if a malicious classpath entry places a `java/lang/String.class` on the application classpath — the parent loader finds the real one first, and the application loader never gets a chance to define a shadowing class.

Plugin systems often invert this: a **child-first** loader searches itself before delegating to the parent, so each plugin can use its own version of a shared library. The tradeoff is loader-scoped class identity (the same FQN can mean two different classes across two plugin loaders) — a feature for isolation, a hazard for cross-plugin communication.

**Follow-up:** "What are the safety reasons for parent-first?" Two: (1) trust — core JDK classes can't be shadowed; (2) consistency — every classloader sees the same `String`, `Object`, etc., so cross-loader interop on those types works.

---

## Q19. Walk through what happens when you do `new MyClass()` and `MyClass` has never been touched.

In order:

1. **Loading.** JVM asks the classloader for `MyClass.class`. The loader follows delegation (parent-first by default), eventually a loader finds and `defineClass`-es the bytes. `Class<?>` exists.
2. **Linking.** Verification (bytecode safety). Preparation (static fields exist at zero / null). Resolution (constant pool symbolic references may be eagerly or lazily turned into direct refs).
3. **Initialization (`<clinit>`).** JVM acquires the per-class lock. Initializes superclasses recursively. Runs static field assignments and `static` blocks in textual order. Marks the class initialized. Releases the lock.
4. **Allocation.** JVM allocates memory for the new instance (the `new` bytecode). All instance fields are zeroed.
5. **Instance initialization (`<init>`).** Calls `super(...)` (which recursively initializes the parent instance), runs instance field initializers and instance blocks in textual order, runs the constructor body.
6. **Returns.** The reference is yours.

Steps 1–3 happen once per classloader; steps 4–5 happen every `new`. Confusing the two leads to "why is my static field being reset?" (it isn't — instance fields are).

---

## Q20. Name three classloading bugs you've seen or heard about, and what fixed them.

Strong answers reference concrete patterns. Examples:

- **`ExceptionInInitializerError` from missing config file.** A static initializer did `Files.newBufferedReader(...)`. The fix was to move the load out of `<clinit>` into a constructor called from the composition root; first failure became catchable, recoverable, testable.

- **`ClassCastException: com.acme.X cannot be cast to com.acme.X`.** Same class loaded by two different plugin loaders. The fix was to push the shared interface into a "plugin API" JAR loaded by the parent loader, so both plugins see the same `Class<?>`.

- **Metaspace growth across redeploys.** A `ThreadLocal` on a long-lived container thread held a value loaded by the webapp loader. Heap dump + MAT identified the root; the fix was a `try/finally` clearing the thread-local plus a `contextDestroyed` cleanup hook.

- **`ServiceLoader` finds zero providers in production.** Mixed classpath/module-path; the application module didn't declare `uses X;` in `module-info.java`. The fix was the missing directive.

- **`NoSuchMethodError` weeks after deploy.** Resolution is lazy; the bad code path didn't run until a specific input arrived. The fix was switching to a build-once-deploy-everywhere artifact (Docker image) so the production classpath couldn't drift.

**Trap:** Answering with textbook examples ("Square-Rectangle") instead of classloading-specific cases. Pick three real ones; even if they're someone else's stories, having them at the tip of your tongue beats abstractions.

---

**Use this list:** alternate questions across the phases — Q1 (phases), Q4/Q5 (`<clinit>`), Q9 (leaks), Q11 (AppCDS), Q13 (ServiceLoader), Q15 (compile-time constants), Q20 (war stories). Strong candidates link each rule to a real bug or a real production lever; weak candidates recite definitions without ever saying "here's the stack trace this produces" or "here's how I'd debug it".
