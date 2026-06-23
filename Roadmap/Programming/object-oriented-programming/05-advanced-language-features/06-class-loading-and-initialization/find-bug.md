# Class Loading and Initialization — Find the Bug

> 10 buggy snippets, each with the stack trace it produces, the JLS / JVMS rule that explains it, and the fix. Read the code, predict the symptom, decide which rule was misapplied. Then read the explanation. The lessons compound — most production classloading incidents are a small re-mix of these patterns.

---

## Bug 1 — I/O in `<clinit>` bricks the class

```java
public final class RouteRegistry {
    public static final Map<String, Route> ROUTES = load();

    private static Map<String, Route> load() {
        try (var in = Files.newBufferedReader(Path.of("/etc/app/routes.yml"))) {
            return YamlParser.parse(in);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(RouteRegistry.ROUTES.size());
        // ... 5 minutes later, after operator notices an exception:
        System.out.println(RouteRegistry.ROUTES.size());
    }
}
```

**Symptom.** First call fails with a startup error, second call fails with a different one:

```
Exception in thread "main" java.lang.ExceptionInInitializerError
    at Main.main(Main.java:3)
Caused by: java.io.UncheckedIOException: java.nio.file.NoSuchFileException: /etc/app/routes.yml
    at RouteRegistry.load(RouteRegistry.java:9)
    at RouteRegistry.<clinit>(RouteRegistry.java:2)
```

After the operator drops the file in place and retries, the *second* call (in the same JVM, if it survived) throws:

```
Exception in thread "main" java.lang.NoClassDefFoundError: Could not initialize class RouteRegistry
    at Main.main(Main.java:5)
```

Note the second error has no `Caused by`. The class is *permanently* in the erroneous state defined by JLS §12.4.2 step 5; no later attempt will retry `<clinit>`.

**Rule.** `<clinit>` runs once per loader. If it throws, the JVM remembers the failure forever — every later access to that class fails with `NoClassDefFoundError` with the original cause *lost*.

**Fix.** Move I/O out of `<clinit>`. Make the registry a normal object, build it once at the composition root, and pass it where it's needed. Failures become catchable at the *call site*, with the original `IOException` intact.

```java
public final class RouteRegistry {
    private final Map<String, Route> routes;
    public RouteRegistry(Map<String, Route> r) { this.routes = Map.copyOf(r); }
    public static RouteRegistry fromYaml(Path p) throws IOException {
        try (var in = Files.newBufferedReader(p)) { return new RouteRegistry(YamlParser.parse(in)); }
    }
}
```

---

## Bug 2 — virtual call in constructor sees null subclass fields

```java
class Base {
    Base() { onInit(); }                        // (*) called during construction
    protected void onInit() { /* default */ }
}

class Derived extends Base {
    private final List<String> log = new ArrayList<>();
    @Override
    protected void onInit() {
        log.add("starting");                    // NPE: log is still null when Base's ctor runs
    }
}

public class Demo {
    public static void main(String[] a) {
        new Derived();
    }
}
```

**Symptom.**

```
Exception in thread "main" java.lang.NullPointerException: 
    Cannot invoke "java.util.List.add(Object)" because "this.log" is null
    at Derived.onInit(Derived.java:5)
    at Base.<init>(Base.java:2)
    at Derived.<init>(Derived.java:1)
    at Demo.main(Demo.java:3)
```

**Rule.** JLS §12.5: when `new Derived()` runs, the JVM allocates the object (all fields zeroed), then `<init>` of `Derived` calls `super()` *before* running `Derived`'s field initializers. The virtual call `onInit()` dispatches to `Derived.onInit` — but `log` hasn't been assigned yet. This is the same trap as the Fragile Base Class problem (`[../../03-design-principles/06-fragile-base-class-problem/](../../03-design-principles/06-fragile-base-class-problem/)`), seen through the classloading lens: instance initialization order is *not* the order you might naively expect.

**Fix.** Don't call overridable methods from constructors. Either mark `onInit` `final`, or move the call out of the constructor into a deliberate `start()` method.

---

## Bug 3 — same class, two loaders, `==` fails

```java
// In a plugin loader:
PluginClassLoader cl1 = new PluginClassLoader(pluginJar);
PluginClassLoader cl2 = new PluginClassLoader(pluginJar);

Class<?> a = cl1.loadClass("com.acme.plugin.Handler");
Class<?> b = cl2.loadClass("com.acme.plugin.Handler");

System.out.println(a == b);                       // false
System.out.println(a.isAssignableFrom(b));        // false

Object instanceFromA = a.getDeclaredConstructor().newInstance();
Handler h = (Handler) instanceFromA;              // ClassCastException if Handler came from cl2
```

**Symptom.**

```
Exception in thread "main" java.lang.ClassCastException:
    class com.acme.plugin.Handler cannot be cast to class com.acme.plugin.Handler
    (com.acme.plugin.Handler is in unnamed module of loader 
    'plugin:plugin.jar' @1234; com.acme.plugin.Handler is in unnamed module of loader
    'plugin:plugin.jar' @5678)
```

The message reads like a typo (same name on both sides). The two parenthetical loader IDs are the giveaway.

**Rule.** JVMS §5.3: class identity is `(defining-loader, name)`. Two loaders that both define the same class produce two distinct `Class<?>` instances, even if the bytes are byte-identical.

**Fix.** Communicate across plugins through a *shared* type defined by the **parent** loader — typically a marker interface or DTO in a "plugin API" JAR loaded once at the application loader:

```java
// plugin-api.jar — loaded by the application loader, shared by every plugin loader
public interface Handler { void handle(Request r); }

// In the plugin loader, Handler is asked for and found at the PARENT (parent-first delegation).
// Both plugins see the SAME Handler interface, even though their implementations differ.
```

If you must compare or cast across loaders, go through serialization or `Object` + reflection — never direct cross-loader casts of plugin-defined types.

---

## Bug 4 — reflection sets a static field, but `<clinit>` ordering is wrong

```java
public final class FeatureFlags {
    public static final boolean DEBUG_MODE = computeDebug();
    private static boolean computeDebug() {
        return Boolean.parseBoolean(System.getProperty("acme.debug", "false"));
    }
}

public class Test {
    public static void main(String[] args) throws Exception {
        // Test author wants debug mode on, sets the system property after JVM start
        Field f = FeatureFlags.class.getDeclaredField("DEBUG_MODE");
        f.setAccessible(true);
        // Remove the final modifier — pre-Java 17 trick
        Field mod = Field.class.getDeclaredField("modifiers");
        mod.setAccessible(true);
        mod.setInt(f, f.getModifiers() & ~Modifier.FINAL);
        f.setBoolean(null, true);
        
        if (FeatureFlags.DEBUG_MODE) System.out.println("debug on");
        else                          System.out.println("debug off");   // !
    }
}
```

**Symptom.** Prints `debug off`. Even worse, on JDK 17+, the reflection trick fails with `InaccessibleObjectException` because the `modifiers` field is no longer accessible by default.

**Rule.** Two layers:

1. **Compile-time constant inlining (JLS §13.1).** Because `DEBUG_MODE` is `static final boolean` initialized to a `boolean` expression, the *callers* compiled against `DEBUG_MODE` may have *inlined* the value `false` at the call site. The branch `if (FeatureFlags.DEBUG_MODE)` may be compiled as `if (false)` — completely independent of the field's actual value.

   Wait — `computeDebug()` is a method call, not a constant expression, so this particular field is *not* a compile-time constant. The branch reads the field at runtime. But the *next* engineer who refactors `DEBUG_MODE = false;` makes it constant and the reflective trick stops working invisibly.

2. **JLS §12.4 timing.** `<clinit>` runs the *first time* the class is actively used — which, in the snippet, is `getDeclaredField("DEBUG_MODE")`. By the time the reflection runs, `<clinit>` has already executed and set `DEBUG_MODE` to its computed value. Setting the property *after* class init has no effect.

**Fix.** Don't try to override `<clinit>` results with reflection. If you need runtime configuration, read it from a method, not a `static final` field. If you must mutate static state in tests, do it before any code path triggers `<clinit>` — typically by setting the system property *before* the JVM starts (`-Dacme.debug=true`), not after.

---

## Bug 5 — ServiceLoader returns no providers in a modular app

```java
// module com.example.app
module com.example.app {
    requires com.example.api;
    // forgot:  uses com.example.api.PaymentGateway;
}

public class App {
    public static void main(String[] args) {
        ServiceLoader<PaymentGateway> loaded = ServiceLoader.load(PaymentGateway.class);
        loaded.forEach(g -> System.out.println(g.name()));
        // Prints nothing.
    }
}
```

**Symptom.** Zero providers found. No exception. Provider modules `com.example.payments.stripe` and `com.example.payments.paypal` declare `provides com.example.api.PaymentGateway with ...`, are on the module path, and resolve at compile time.

**Rule.** JLS §7.7.4: a *named* module that wants to consume services from `ServiceLoader.load(C.class)` must declare `uses C` in its `module-info.java`. Without `uses`, the module system reports zero providers — the API treats the consumer as not opting in.

**Fix.** Add the directive:

```java
module com.example.app {
    requires com.example.api;
    uses     com.example.api.PaymentGateway;
}
```

Note that this is *only* required for named modules. Classpath / unnamed-module code finds providers via `META-INF/services` files and doesn't need `uses`. A common variant of this bug: project mixes classpath and module-path (e.g. main code is modular, tests are on classpath); the test finds providers but production doesn't.

---

## Bug 6 — Tomcat classloader leak via `ThreadLocal`

```java
public final class RequestContext {
    private static final ThreadLocal<UserPrincipal> CURRENT = new ThreadLocal<>();
    public static void set(UserPrincipal u) { CURRENT.set(u); }
    public static UserPrincipal get()       { return CURRENT.get(); }
    public static void clear()              { CURRENT.remove(); }
}

public class AuthFilter implements Filter {
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        UserPrincipal u = authenticate((HttpServletRequest) req);
        RequestContext.set(u);
        chain.doFilter(req, res);
        // forgot:  RequestContext.clear();
    }
}
```

**Symptom.** Tomcat redeploys `app-v1.war` → `app-v2.war`. Metaspace climbs by ~40 MB per redeploy. After 12 redeploys, OOM kills Tomcat. A heap dump shows multiple `WebappClassLoader` instances, each with a "Path to GC root" of:

```
WebappClassLoader (webapp v1)
  <- contextClassLoader of Thread "http-nio-8080-exec-7"
  <- entry of ThreadLocalMap whose KEY is class UserPrincipal (loaded by WebappClassLoader v1)
```

**Rule.** `ThreadLocal`'s value is keyed by a `WeakReference` to the `ThreadLocal` *object*, but the *value* is a strong reference. If the value's class was loaded by a per-app `WebappClassLoader`, that loader is reachable from the value, from the thread's `ThreadLocalMap`, from the thread (a long-lived container thread). The loader cannot be GC'd; nor can any class it loaded.

**Fix.** Always `clear()` after use, and (defensively) at undeploy:

```java
public void doFilter(...) {
    try {
        RequestContext.set(u);
        chain.doFilter(req, res);
    } finally {
        RequestContext.clear();   // mandatory
    }
}

@WebListener
public class ClearOnUndeploy implements ServletContextListener {
    public void contextDestroyed(ServletContextEvent e) {
        RequestContext.clear();
        // also: deregister any drivers, stop any executors, etc.
    }
}
```

The `try/finally` solves the per-request leak. The `contextDestroyed` listener handles threads that may still be pooled across redeploys.

---

## Bug 7 — Circular static initialization

```java
public class A {
    public static final int X = B.Y + 1;
    public static final int Y = 100;
}

public class B {
    public static final int Y = A.Y + 1;
}

public class CircularDemo {
    public static void main(String[] args) {
        System.out.println("A.X=" + A.X + " A.Y=" + A.Y + " B.Y=" + B.Y);
    }
}
```

**Symptom.** Prints `A.X=1 A.Y=100 B.Y=1`. The author expected `A.X=102` (`B.Y + 1 = 101 + 1 = 102`) and `B.Y=101`.

**Rule.** JLS §12.4.2 step 2. The chain:

1. `main` reads `A.X` → triggers `A`'s `<clinit>`.
2. `A.X = B.Y + 1` → triggers `B`'s `<clinit>`.
3. `B.Y = A.Y + 1`. `A` is currently being initialized by *this thread* → step 2 returns immediately. `A.Y` is read at its *default* value `0`. So `B.Y = 0 + 1 = 1`.
4. `B`'s `<clinit>` completes. Back in `A`: `A.X = 1 + 1 = 2`. (Wait — let's re-check the example. `B.Y = 1`, so `A.X = B.Y + 1 = 2`.)
5. `A.Y = 100` runs next.
6. Output is `A.X=2 A.Y=100 B.Y=1`.

(Adjust your prediction: the bug is the silent `0`, regardless of the exact arithmetic.)

**Fix.** Eliminate the cycle. Extract shared constants into a third class that neither depends on the others, or compute the value lazily:

```java
public class Constants {
    public static final int Y = 100;
}
public class A { public static final int X = Constants.Y + 1; }   // 101
public class B { public static final int Y = Constants.Y + 1; }   // 101
```

The cycle never forms because no class needs another class's state during its own `<clinit>`.

---

## Bug 8 — `final` non-primitive constant triggers initialization

```java
public class TaxRates {
    static { System.out.println("TaxRates <clinit>"); }
    public static final int STANDARD_INT      = 20;            // compile-time constant
    public static final Integer STANDARD_BOXED = 20;            // NOT a compile-time constant
    public static final BigDecimal STANDARD_BD = new BigDecimal("0.20");
}

public class Demo {
    public static void main(String[] args) {
        System.out.println(TaxRates.STANDARD_INT);    // prints 20.    No <clinit>.
        System.out.println(TaxRates.STANDARD_BOXED);  // prints 20.    <clinit> ran.
        System.out.println(TaxRates.STANDARD_BD);     // prints 0.20.  <clinit> ran (already).
    }
}
```

**Symptom.** The first read should not trigger `<clinit>` (so no print), but the second and third should. Output:

```
20
TaxRates <clinit>
20
0.20
```

Engineers expect *all three* to be "compile-time constants" because they say `static final`. They are not.

**Rule.** JLS §4.12.4 defines a *constant variable*: a `final` variable of *primitive type or `String`* initialized with a *constant expression*. Only those are inlined by javac and skip initialization. `Integer` (boxed) and `BigDecimal` are not in the set; reading them triggers `<clinit>` just like any other static.

**Fix.** This isn't a bug per se — it's a misconception. The implication: do not rely on "constant" being free if the type isn't primitive or `String`. If you want lazy "constants" that don't drag `<clinit>` along, the Holder idiom is the right tool.

---

## Bug 9 — `<clinit>` deadlock between two threads

```java
public class A {
    static B b = new B();
    static int after = 1;
}
public class B {
    static {
        Thread t = new Thread(() -> {
            int x = A.after;                       // triggers A's <clinit> — but it's already in flight
            System.out.println("got " + x);
        }, "B-spawned");
        t.start();
        try { t.join(); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
    }
}
public class Deadlock {
    public static void main(String[] args) {
        new A();                                    // triggers A's <clinit>, which constructs B
    }
}
```

**Symptom.** The JVM hangs. `jstack` shows:

```
"main" prio=5 ... waiting on object monitor (B's <clinit> calling t.join())
   at java.lang.Thread.join(...)
   at B.<clinit>(B.java:6)
   at A.<clinit>(A.java:2)

"B-spawned" prio=5 ... waiting for class initialization
   at A.<clinit>(A.java:?)   [waiting for A's init lock — held by "main"]
```

Two threads, two locks (`A`'s init lock and the new thread's join handle), classic deadlock.

**Rule.** JLS §12.4.2 step 3: a thread that requests initialization of a class being initialized by another thread *blocks* on that class's lock. A `<clinit>` that starts a new thread which then accesses *its own currently-initializing* class — and waits for that thread — deadlocks.

**Fix.** Never start threads in `<clinit>`. If a class needs a background worker, expose a `start()` method called from the composition root after the class is fully initialized.

---

## Bug 10 — resolution-time `NoSuchMethodError` after partial deploy

```java
// app.jar (compiled against utils.jar v2 which has:)
public class Utils { public static int compute(long x) { return ...; } }   // v2

// Production has accidentally deployed utils.jar v1:
public class Utils { public static int compute(int x)  { return ...; } }   // v1

// app.jar calls:
int r = Utils.compute(42L);                                                  // <-- bytecode says invokestatic Utils.compute(J)I
```

**Symptom.**

```
Exception in thread "main" java.lang.NoSuchMethodError:
    'int Utils.compute(long)'
    at App.main(App.java:5)
```

No `ClassNotFoundException`, no `NoClassDefFoundError`. The class loaded fine; the *method* resolution failed at first use.

**Rule.** JVMS §5.4.3: resolution is lazy. `app.jar` compiles a symbolic reference `Methodref(Utils, compute, (J)I)`. The JVM only resolves it the first time `App.main` is executed and reaches the `invokestatic` instruction. The resolution fails because the loaded `Utils` has `compute(I)I`, not `compute(J)I`.

A worse variant: the missing method is in a code path that runs only on Mondays. The bug ships, and you discover it during the Monday batch — six days after deploy, with the deploy long-since "verified" by Tuesday's smoke tests.

**Fix.** Two angles:

1. **Defensive deploys.** Pin the dependency versions; never let the production classpath drift from what the binary was compiled against. Build-once-deploy-everywhere artifacts (jlink images, Docker images, GraalVM native images) eliminate this class of bug.
2. **Early detection.** Compile-time-only `tools.jar`-style binary compatibility checks (`japicmp`, `revapi`) flag binary breakage in CI. A pre-deploy smoke test that calls every public entry point once would also fire — but coverage is hard.

---

## Pattern summary

| Bug type                                          | Spec rule                                    | Symptom shape                                            |
|---------------------------------------------------|-----------------------------------------------|-----------------------------------------------------------|
| I/O in `<clinit>` (Bug 1)                         | JLS §12.4.2 step 10 + step 5                 | `ExceptionInInitializerError` then permanent `NoClassDefFoundError` |
| Virtual call in constructor (Bug 2)               | JLS §12.5                                     | NPE in subclass method called from super `<init>`         |
| Loader-scoped identity (Bug 3)                    | JVMS §5.3                                     | `ClassCastException: X cannot be cast to X`               |
| Reflection vs `<clinit>` timing (Bug 4)           | JLS §12.4 + constant inlining (§13.1)         | Reflection "doesn't take effect"                          |
| Missing `uses` for ServiceLoader (Bug 5)          | JLS §7.7.4                                    | `ServiceLoader` finds zero providers, no error            |
| ThreadLocal classloader leak (Bug 6)              | JLS §12.4 per-loader statics                  | Metaspace growth across redeploys                          |
| Circular `<clinit>` (Bug 7)                       | JLS §12.4.2 step 2                            | Silent default value (`0` / `null`)                       |
| `final` non-primitive constant (Bug 8)            | JLS §4.12.4                                   | `<clinit>` runs when you didn't expect it                 |
| `<clinit>` deadlock (Bug 9)                       | JLS §12.4.2 step 3                            | JVM hangs; `jstack` shows wait-for-init                   |
| Lazy resolution (Bug 10)                          | JVMS §5.4.3                                   | `NoSuchMethodError` long after deploy                      |

The unifying theme: classloading bugs do not produce *compile* errors. They produce *runtime* errors whose causes look unrelated to classloading until you know the rule. Each rule in this file maps a stack-trace shape to its underlying spec section — that mapping is what separates "I can read this trace" from "I have no idea what's happening".

---

**Memorize this:** `<clinit>` runs once and a failure is permanent — keep I/O and threads out of it. `Class<?>` identity is `(loader, name)` — two loaders mean two classes. Forward references and cycles return default values, not errors. ServiceLoader in named modules needs `uses`. Resolution is lazy — `NoSuchMethodError` is the JVM saying "this method should exist, but doesn't, *now that I tried to call it*". The shape of the stack trace is enough to point at the rule.
