# Class Loading and Initialization — Middle

> **What?** Initialization order rules from JLS §12.4 worked through realistic examples — static fields mixed with static blocks, inheritance, circular references, and multi-classloader environments such as web apps. Plus the two everyday APIs that every Java developer eventually touches: `ServiceLoader` and the `Class.forName` / `loadClass` pair.
> **How?** Run each snippet (or read it carefully) and predict the output before scrolling down. The order is mechanical once you know the rules; the bugs all come from getting one rule wrong.

---

## 1. Initialization order — the full rule (JLS §12.4.2)

When the JVM decides class `C` must be initialized, it runs an internal protocol that is worth memorising verbatim. Stripped to essentials:

1. **Acquire the per-class initialization lock.** The JVM owns one lock per `Class<?>` object. Other threads asking to initialize `C` will block on this lock.
2. **If `C` is already initialized, release the lock and return.** Cheap, common case.
3. **If `C` is currently being initialized by *this* thread**, release the lock and return (this is how recursive triggers — see section 5 — succeed instead of deadlocking).
4. **Mark `C` as being initialized by this thread.**
5. **Initialize the direct superclass recursively.** If `C` has interfaces with default methods, the interfaces are initialized too (JLS §12.4.1, refined in Java 8+).
6. **Execute static field initializers and `static { ... }` blocks in textual order** — this is `<clinit>`.
7. **Mark `C` as initialized.** Notify any other threads blocked on the lock.

Step 6 is the one programmers usually mean when they say "initialization order". Static initializers and static-field assignments are intermixed in *the order they appear in source*. That order matters, and it bites people whose mental model is "all the fields, then all the blocks".

---

## 2. Worked example 1 — fields and blocks interleaved

```java
public class Mix {
    static int a = init("a", 1);
    static { System.out.println("block1, a=" + a); }
    static int b = init("b", a + 10);
    static { System.out.println("block2, a=" + a + " b=" + b); }
    static int c = init("c", b + 100);

    static int init(String name, int v) {
        System.out.println("init " + name + " = " + v);
        return v;
    }

    public static void main(String[] args) {
        System.out.println("a=" + a + " b=" + b + " c=" + c);
    }
}
```

Predicted output (in textual order, fields and blocks interleaved):

```
init a = 1
block1, a=1
init b = 11
block2, a=1 b=11
init c = 111
a=1 b=11 c=111
```

If you wrote `static { System.out.println(b); }` *before* the line that declares `b`, you'd be reading a not-yet-assigned static — meaning the default value (`0` for `int`, `null` for references). This is the **forward-reference problem**:

```java
public class Forward {
    static { System.out.println(b); }   // prints 0 — b not yet assigned
    static int b = 99;
}
```

JLS §8.3.3 limits forward references — but only at compile time and only inside the same class. Read-before-assignment via a method call is allowed, and is one of the most common static-init bugs.

---

## 3. Worked example 2 — inheritance

```java
class Parent {
    static int p = init("Parent.p", 1);
    static { System.out.println("Parent block, p=" + p); }
    Parent() { System.out.println("Parent()"); }

    static int init(String n, int v) { System.out.println(n + " = " + v); return v; }
}

class Child extends Parent {
    static int c = init("Child.c", p + 10);
    static { System.out.println("Child block, c=" + c); }
    Child() { System.out.println("Child()"); }
}

public class InheritDemo {
    public static void main(String[] args) {
        new Child();
        System.out.println("---");
        new Child();
    }
}
```

Output:

```
Parent.p = 1
Parent block, p=1
Child.c = 11
Child block, c=11
Parent()
Child()
---
Parent()
Child()
```

Two facts to lock in:

- **Static initialization of the superclass completes before the subclass's static initialization starts** (step 5 of the protocol). The dashes show that the second `new Child()` runs no `<clinit>` at all — both classes were already initialized.
- **Static initialization happens *once*, then every `new Child()` runs the instance initialization (`<init>`) again.** Instance initialization is a different mechanism (JLS §12.5) — superclass constructor first, then instance field initializers and instance blocks, then the body of `<init>`.

---

## 4. Worked example 3 — interfaces with default methods

JLS was updated in Java 8 to require that initializing a class also initialize any *direct or indirect* superinterface that declares a `default` method. Interfaces without default methods are *not* initialized when implementing classes are.

```java
interface Plain { int X = init("Plain", 1); static int init(String n, int v) { System.out.println(n); return v; } }
interface WithDefault {
    int X = Plain.X + 10;     // calling Plain.init implicitly through Plain.X
    default void hi() {}
    static int init(String n, int v) { System.out.println(n); return v; }
}
class Concrete implements WithDefault {}

public class IfaceDemo {
    public static void main(String[] args) {
        new Concrete();   // initializes WithDefault (has a default), and Plain (referenced by X)
    }
}
```

Default methods make interfaces "behavioural" in a way that requires their static fields to be present, hence the initialization rule. Marker interfaces (no methods) and plain SAMs continue to skip initialization when implementors are initialized.

---

## 5. Circular static dependencies

Two classes that touch each other's statics during their own `<clinit>` form a cycle. The JVM does not deadlock — it returns a *partially initialized* class to the thread that is mid-init.

```java
class A {
    static int a = B.b + 1;
    static { System.out.println("A done, a=" + a); }
}
class B {
    static int b = A.a + 1;
    static { System.out.println("B done, b=" + b); }
}
public class Cycle {
    public static void main(String[] a) {
        System.out.println("A.a=" + A.a + " B.b=" + B.b);
    }
}
```

What happens:

1. `main` reads `A.a` → JVM starts initializing `A`.
2. `A`'s initializer evaluates `B.b + 1` → triggers initialization of `B`.
3. `B`'s initializer evaluates `A.a + 1`. The JVM sees that `A` is already being initialized *by this same thread* and skips the recursive init (protocol step 3). `A.a` is read at its *default* value (`0`).
4. `B.b` is set to `0 + 1 = 1`. `B` finishes. Print: `B done, b=1`.
5. Control returns to `A`'s initializer. `A.a = 1 + 1 = 2`. `A` finishes. Print: `A done, a=2`.
6. `main` prints `A.a=2 B.b=1`.

The bug isn't a crash; it's the silent `0`. If you've ever seen production logs say a constant is `0` when you "know" it's not, this is the pattern. Break the cycle: extract shared constants into a third class, or compute them lazily.

---

## 6. Multi-classloader scenarios — web apps

A servlet container hosts multiple web apps in one JVM. Each WAR gets its own classloader (Tomcat calls it `WebappClassLoader`); they share the platform classloader for Java SE and the container's classloader for the servlet API.

```
                     +-------------------------+
                     |  application loader     |   container (Tomcat itself)
                     +-----------+-------------+
                                 |
        +------------------------+------------------------+
        |                                                 |
+-------+---------+                              +--------+--------+
| WebappLoader A  |                              | WebappLoader B  |
|  app-a.war      |                              |  app-b.war      |
+-----------------+                              +-----------------+
```

Two consequences that catch developers off guard:

**Consequence 1: each app has its own copy of every static field.**

```java
public final class Counter {
    public static int n = 0;
}
```

If `app-a.war` and `app-b.war` both bundle the same JAR containing `Counter`, they have two distinct `Counter` classes. `Counter.n` in app A is independent of `Counter.n` in app B. Even though `Counter.class.getName()` returns the same string, `appAClass != appBClass`. This is the *foundational reason* hot-deploy works at all: redeploy `app-a.war` and the old `WebappLoader A` is discarded with all its statics.

**Consequence 2: `==` on `Class<?>` objects can fail across classloaders.**

```java
Class<?> a = appALoader.loadClass("com.shared.Marker");
Class<?> b = appBLoader.loadClass("com.shared.Marker");
a == b;              // false
a.getName().equals(b.getName());   // true
a.isAssignableFrom(b);             // false
```

This is the source of `ClassCastException: com.shared.X cannot be cast to com.shared.X` — same fully qualified name, different `Class<?>` instances, different loaders, different identities.

Defensive code that serializes/deserializes across loader boundaries must either (a) use a *parent* classloader that hosts the shared type, or (b) communicate through `Object` with reflection / serialization, never through direct casts.

---

## 7. `Class.forName` vs `ClassLoader.loadClass` revisited

`Class.forName` was the JDBC 3 idiom for loading drivers:

```java
Class.forName("org.postgresql.Driver");
// triggers <clinit>, which calls DriverManager.registerDriver(new Driver())
// after JDBC 4 (Java 6+), the ServiceLoader-based driver discovery
// makes this call unnecessary.
```

`Class.forName` has three overloads (JDK `java.lang.Class`):

```java
public static Class<?> forName(String name);                                  // initialize=true, caller's classloader
public static Class<?> forName(String name, boolean initialize, ClassLoader); // explicit
public static Class<?> forName(Module module, String name);                   // since Java 9
```

`ClassLoader.loadClass(String)` *only* runs through the loading + linking phases:

```java
ClassLoader cl = MyClass.class.getClassLoader();
Class<?> c = cl.loadClass("com.acme.Plugin");
// c is loaded; static initializer has not run.
```

Picking the wrong one is one of the easiest bugs to ship. A plugin scanner that needs to *discover* plugins (read annotations, find marker interfaces) should use `loadClass` — running a plugin's `<clinit>` during scanning is a classic source of "first request after deploy is slow" or "deploy fails because a plugin couldn't connect to its DB at scan time".

```java
// SCAN — should NOT init plugins
for (String name : pluginNames) {
    Class<?> c = cl.loadClass(name);
    if (Plugin.class.isAssignableFrom(c)) candidates.add(c);
}

// LATER — when actually using a chosen plugin
Plugin p = (Plugin) Class.forName(chosen.getName(), true, cl)
                         .getDeclaredConstructor().newInstance();
```

---

## 8. `ServiceLoader` and the classloader it uses

`java.util.ServiceLoader` (Java 6+, modularised in Java 9) is the JDK's built-in plugin discovery mechanism. It reads `META-INF/services/<interface-fqn>` files (classpath) and `provides ... with ...` declarations (JPMS modules), then *lazily* instantiates each service provider.

```java
public interface PaymentGateway {
    String name();
    Receipt charge(BigDecimal amount);
}

ServiceLoader<PaymentGateway> services = ServiceLoader.load(PaymentGateway.class);
for (PaymentGateway g : services) {
    System.out.println(g.name());
}
```

Two facts about its classloader behaviour:

**Fact 1: by default, ServiceLoader uses the *thread context classloader* (TCCL).**

```java
ServiceLoader.load(Cls.class);
// internally: ServiceLoader.load(Cls.class, Thread.currentThread().getContextClassLoader())
```

In a web container, the TCCL is the per-app `WebappClassLoader`. In a plain `main`, it is the application loader. If you load a service from a thread whose TCCL is wrong, you may load *no* providers, or providers from the wrong app.

**Fact 2: when modules are in play, ServiceLoader walks the *module layer*, not the classpath.**

```java
// module-info.java in com.example.checkout
module com.example.checkout {
    uses com.example.payments.api.PaymentGateway;
}

// module-info.java in com.example.payments.stripe
module com.example.payments.stripe {
    provides com.example.payments.api.PaymentGateway
        with com.example.payments.stripe.StripeGateway;
}
```

A modular ServiceLoader does *not* look at `META-INF/services` files inside a *named* module — it uses the `provides` declaration. Mixing classpath services and module services in the same app is a fast way to ship code that "works" in IntelliJ (mixed classpath/module-path) and "finds zero providers" in production (pure module path).

---

## 9. Lazy classloading and startup time

The lazy nature of classloading is what makes large JVM apps start at all. A Spring Boot app has thousands of classes on its classpath; only a few hundred are loaded by the time `/actuator/health` returns 200. The rest are pulled in on demand — the first request that needs a JPA mapper triggers Hibernate's class generation, the first request that touches Kafka loads the producer, and so on.

There are two implications:

**1. The first request is always slower than the steady state.** You can prove this with a single curl command on a freshly deployed pod. Warm-up routines that hit each major endpoint during readiness are the standard mitigation.

**2. Startup-time profiling needs `-Xlog:class+load=info` (or the older `-verbose:class`).** Run a small representative workload, dump the log, count classes loaded per second, identify the long tail. A class your steady state never uses but a static initializer drags in is dead weight.

```
[0.123s][info][class,load] java.lang.String source: jrt:/java.base
[0.124s][info][class,load] com.acme.HelloController source: file:/app.jar
```

`senior.md` and `optimize.md` build on this — AppCDS (JEP 310) and dynamic CDS (JEP 350) cache the load+link work between JVM runs.

---

## 10. Bytecode peek — what `<clinit>` looks like

```java
public class Tiny {
    static final int A = 1 + 2;       // compile-time constant — folded into callers
    static int B = computeB();        // runtime — goes into <clinit>
    static { System.out.println(B); }
    static int computeB() { return 7; }
}
```

`javap -c -p Tiny.class` shows the synthetic method:

```
static {};
  descriptor: ()V
  flags: (0x0008) ACC_STATIC
  Code:
     0: invokestatic  #6   // computeB
     3: putstatic     #2   // B
     6: getstatic     #11  // System.out
     9: getstatic     #2   // B
    12: invokevirtual #17  // PrintStream.println(int)
    15: return
```

Three observations:

- `<clinit>` has descriptor `()V` (no args, returns `void`) and is `static`.
- The order of operations matches source order.
- `A` is nowhere — javac inlined it.

Looking at `<clinit>` once in your career, even on a toy example, removes most of the mystique. It is just a method the JVM calls for you on first active use, exactly once.

---

## 11. Putting it together — initialization order checklist

A handy decision tree when reading or writing static code:

1. Is the symbol a *compile-time constant*? If yes, no initialization happens — the literal is inlined.
2. Otherwise, is the symbol accessed at all? If never, `<clinit>` never runs.
3. On first active use:
   - Initialize the superclass (recursively).
   - Initialize any superinterface with a `default` method.
   - Run `<clinit>` — interleaved field assignments and `static { ... }` blocks in textual order.
4. If `<clinit>` calls into a *not-yet-initialized* class, recurse from step 1.
5. If `<clinit>` calls into a class *currently being initialized by this thread*, it gets partial state (default values for fields not yet assigned).
6. If `<clinit>` calls into a class *being initialized by another thread*, this thread blocks on the per-class lock.

The last two cases are where multi-threaded bootstraps go wrong; we'll see one in `find-bug.md`.

---

## 12. Quick rules

- [ ] Static fields and `static { ... }` blocks execute in **source order**, interleaved.
- [ ] Superclass `<clinit>` runs before subclass; interfaces with default methods initialize before implementors.
- [ ] Forward-referenced static fields are *not* a compile error if accessed via a method call — they return default values.
- [ ] Circular static references do not deadlock; the second class sees a partially-initialized first class and reads defaults.
- [ ] Each web app has its own classloader; each classloader has its own copy of every class and its static state.
- [ ] `Class<?>` identity is loader-scoped: same FQN under two loaders gives two `Class<?>` objects and a `ClassCastException`.
- [ ] `Class.forName` initializes; `loadClass` does not — pick deliberately for plugin scanning.
- [ ] `ServiceLoader.load(C.class)` uses the thread context classloader by default and respects JPMS `provides`/`uses` for modular code.

---

## 13. What's next

| Topic                                                                | File              |
|----------------------------------------------------------------------|-------------------|
| Linking phases, `<clinit>` thread safety, classloader leaks, AppCDS  | `senior.md`        |
| Code review and team-level hygiene                                   | `professional.md`  |
| JLS §12.4 / §12.5, JVMS §5 / §2.9, JEP 261 / 310 / 350               | `specification.md` |
| 10 stack-trace-driven bugs                                           | `find-bug.md`      |
| AppCDS, dynamic CDS, GraalVM native image, AOT                       | `optimize.md`      |
| Exercises (custom loader, leak, ServiceLoader plugin)                | `tasks.md`         |
| Interview Q&A                                                        | `interview.md`     |

Cross-references:

- [../02-jpms-modules/](../02-jpms-modules/) — `provides`/`uses` and module layers feed straight into `ServiceLoader`.
- [../03-reflection-and-annotations/](../03-reflection-and-annotations/) — `Class.forName` is reflection's entry point.

---

**Memorize this:** initialization order is **superclass first, then static fields and `static` blocks in textual order, exactly once per classloader**. `Class.forName` initializes; `loadClass` does not. Each web app's classloader has its own statics, and `Class<?>` identity is per-loader. Forward references and cycles produce silent default values, not exceptions — the JVM never deadlocks itself, but it will happily hand you a `0` you weren't expecting.
