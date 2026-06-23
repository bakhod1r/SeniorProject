# Class Loading and Initialization — Practice Tasks

Eight hands-on exercises that force you to confront the rules in `junior.md` through `optimize.md`. Each task is a small program (or pair) that you can run from `main` in 50–150 lines. Predict the output before you run, then explain the difference.

For each task: (1) read the prompt, (2) write the code, (3) run it, (4) write down which JLS / JVMS rule explains the observed behaviour.

---

## Task 1 — Observe initialization order with logging in `static` blocks

Build a program that prints, in real time, exactly which classes initialize and in what order across two scenarios.

**Setup.**

```java
public class A {
    static { System.out.println("A.<clinit>"); }
    public static int x = log("A.x", 1);
    static int log(String n, int v) { System.out.println("init " + n + " = " + v); return v; }
}

public class B extends A {
    static { System.out.println("B.<clinit>"); }
    public static int y = log("B.y", A.x + 10);
}

public class C {
    public static final int CONSTANT = 42;       // compile-time constant
    static { System.out.println("C.<clinit>"); }
}

public class Demo {
    public static void main(String[] args) {
        System.out.println("--- step 1: read C.CONSTANT ---");
        System.out.println(C.CONSTANT);

        System.out.println("--- step 2: get B.class literal ---");
        Class<?> bClass = B.class;

        System.out.println("--- step 3: access B.y ---");
        System.out.println(B.y);
    }
}
```

**Predict.** Write down what should print at each step. Be explicit about whether `<clinit>` runs.

**Objective.** Confirm the rule: compile-time constants skip initialization; class literals load but don't initialize; static field access triggers initialization (and the superclass first).

**Acceptance criteria.**

- Step 1 prints `42` and nothing from `C`'s `<clinit>`. Explain why.
- Step 2 prints nothing (just loads the class).
- Step 3 triggers `A.<clinit>` first, then `B.<clinit>`, then prints `B.y` (compute the value from the source).

**Stretch.** Add `D extends B` and read `D.y` instead. Predict and verify.

---

## Task 2 — Demonstrate `ExceptionInInitializerError` and its permanent aftermath

Reproduce the "class permanently errored" state from JLS §12.4.2 step 5.

**Setup.**

```java
public class TimeBomb {
    public static final int BOOM = explode();
    private static int explode() {
        throw new IllegalStateException("boom in <clinit>");
    }
}

public class Demo {
    public static void main(String[] args) {
        for (int i = 1; i <= 3; i++) {
            System.out.println("--- attempt " + i + " ---");
            try {
                System.out.println(TimeBomb.BOOM);
            } catch (Throwable t) {
                System.out.println("got: " + t.getClass().getSimpleName() + ": " + t.getMessage());
                if (t.getCause() != null) {
                    System.out.println("   caused by: " + t.getCause().getClass().getSimpleName()
                                       + ": " + t.getCause().getMessage());
                }
            }
        }
    }
}
```

**Objective.** Show that:

- Attempt 1 throws `ExceptionInInitializerError` with `IllegalStateException` as the cause.
- Attempts 2 and 3 throw `NoClassDefFoundError` with **no cause** (or with `Could not initialize class TimeBomb`).

**Acceptance criteria.** All three attempts fail, but the first error carries the original cause and the rest don't. Explain why (JLS §12.4.2 step 5: class is in an erroneous state; `<clinit>` does not re-run).

**Stretch.** Catch `ExceptionInInitializerError` once, then access an *unrelated* static field of `TimeBomb`. Confirm it still throws `NoClassDefFoundError`. The whole class is poisoned, not just the field that failed.

---

## Task 3 — Build a custom classloader from scratch

Write a `JarPluginLoader` that loads classes from a JAR file you control. Demonstrate parent-first vs child-first delegation.

**Setup.**

```java
public final class JarPluginLoader extends ClassLoader {
    private final Path jar;
    private final boolean childFirst;

    public JarPluginLoader(Path jar, ClassLoader parent, boolean childFirst) {
        super("plugin:" + jar.getFileName(), parent);
        this.jar = jar;
        this.childFirst = childFirst;
    }

    @Override
    protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
        synchronized (getClassLoadingLock(name)) {
            Class<?> c = findLoadedClass(name);
            if (c != null) return c;

            if (childFirst && !name.startsWith("java.") && !name.startsWith("javax.")) {
                try { c = findClass(name); } catch (ClassNotFoundException ignored) {}
            }
            if (c == null) c = getParent().loadClass(name);
            if (resolve) resolveClass(c);
            return c;
        }
    }

    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        try (JarFile jf = new JarFile(jar.toFile())) {
            JarEntry e = jf.getJarEntry(name.replace('.', '/') + ".class");
            if (e == null) throw new ClassNotFoundException(name);
            byte[] bytes = jf.getInputStream(e).readAllBytes();
            return defineClass(name, bytes, 0, bytes.length);
        } catch (IOException ex) {
            throw new ClassNotFoundException(name, ex);
        }
    }
}
```

**Objective.**

- Package a `com.acme.plugin.Hello` class into `plugin.jar` (use the `jar` tool).
- Load it via `JarPluginLoader`, reflectively call `Hello.greet()`.
- Print `Hello.class.getClassLoader()` — confirm it is the `JarPluginLoader`, not the application loader.

**Acceptance criteria.**

- Loading succeeds.
- The loader name printed includes "plugin:plugin.jar".
- Repeating the load with `childFirst=true` and a JAR containing a JDK class (e.g. `java.util.ArrayList` — copy the bytes, place under `java/util/ArrayList.class`) demonstrates that the parent loader's version still wins (parent-first protection of `java.*`).

**Stretch.** Add a second `JarPluginLoader` for the same JAR. Compare the `Class<?>` objects for the same FQN — confirm `!=`. Try a cast across them and observe the `ClassCastException`.

---

## Task 4 — Load a class twice with two classloaders

Closely related to Task 3, but focused on the identity rule.

**Setup.**

```java
public class IdentityTest {
    public static void main(String[] args) throws Exception {
        URL pluginUrl = Path.of("plugin.jar").toUri().toURL();
        URLClassLoader cl1 = new URLClassLoader("cl1", new URL[]{pluginUrl}, IdentityTest.class.getClassLoader());
        URLClassLoader cl2 = new URLClassLoader("cl2", new URL[]{pluginUrl}, IdentityTest.class.getClassLoader());

        Class<?> c1 = cl1.loadClass("com.acme.plugin.Hello");
        Class<?> c2 = cl2.loadClass("com.acme.plugin.Hello");

        System.out.println("c1 == c2 ? " + (c1 == c2));
        System.out.println("c1.getName().equals(c2.getName()) ? " + c1.getName().equals(c2.getName()));
        System.out.println("c1.getClassLoader() = " + c1.getClassLoader());
        System.out.println("c2.getClassLoader() = " + c2.getClassLoader());

        Object o1 = c1.getDeclaredConstructor().newInstance();
        try {
            Object castedToC2 = c2.cast(o1);                  // boom
        } catch (ClassCastException e) {
            System.out.println("ClassCastException: " + e.getMessage());
        }

        cl1.close();
        cl2.close();
    }
}
```

**Objective.** Observe the same FQN producing different `Class<?>` objects with different loaders, and the cross-loader cast failing.

**Acceptance criteria.**

- `c1 == c2` is `false`.
- The names match; the loaders differ.
- The cross-loader cast throws `ClassCastException` with a message like `com.acme.plugin.Hello cannot be cast to com.acme.plugin.Hello`.

**Stretch.** Move `Hello` into the *parent* loader (i.e., place `plugin.jar` on the main classpath). Re-run. The two loaders now find `Hello` via parent-first delegation; `c1 == c2` becomes `true`.

---

## Task 5 — Use AppCDS to measure startup

Build an AppCDS archive for a small Spring Boot or plain `main` program. Compare cold start with and without.

**Setup.**

```bash
# Build a small JAR. For a plain main:
javac -d out Demo.java
jar --create --file demo.jar --main-class=Demo -C out .

# 1. Baseline
time java -jar demo.jar

# 2. Record archive
time java -XX:ArchiveClassesAtExit=demo.jsa -jar demo.jar

# 3. Use archive
time java -XX:SharedArchiveFile=demo.jsa -jar demo.jar

# 4. Confirm it's loaded
java -Xlog:cds -XX:SharedArchiveFile=demo.jsa -jar demo.jar 2>&1 | head -20
```

**Objective.** Quantify the startup difference.

**Acceptance criteria.**

- Baseline run: record the time in seconds.
- Archive-enabled run: record the time. Expect a measurable reduction (typically 100–500 ms for a small program; up to 1.5 s for a large Spring Boot app).
- `-Xlog:cds` output shows lines like `[cds] Mapped class space at 0x... size ...`.

**Stretch.** Repeat with `time java -Xshare:off -jar demo.jar` (CDS fully disabled) to see the *baseline* cost of class loading without any caching. The gap between `-Xshare:off` and `-Xshare:on` is the JDK CDS contribution; the gap between `-Xshare:on` (no app archive) and the `-XX:SharedArchiveFile=app.jsa` run is the AppCDS contribution.

---

## Task 6 — Debug a classloader leak

Create a deliberate leak, then debug it with a heap dump.

**Setup.**

A simulated container that "redeploys" by discarding and rebuilding a child classloader. Inside the simulated app, a `ThreadLocal` is set on a long-lived "container thread" and never cleared.

```java
public class FakeContainer {
    static final Thread containerThread = new Thread(() -> {
        try { Thread.sleep(Long.MAX_VALUE); } catch (InterruptedException ignored) {}
    }, "container-thread");

    static final ThreadLocal<Object> LEAK = new ThreadLocal<>();

    public static void main(String[] args) throws Exception {
        containerThread.setDaemon(true);
        containerThread.start();

        URL appUrl = Path.of("app.jar").toUri().toURL();

        for (int i = 1; i <= 5; i++) {
            URLClassLoader app = new URLClassLoader("webapp-v" + i, new URL[]{appUrl},
                                                    FakeContainer.class.getClassLoader());
            Class<?> appClass = app.loadClass("com.acme.App");
            Object instance = appClass.getDeclaredConstructor().newInstance();

            // Simulate: the "container thread" does work for the app, which sets a thread-local
            Runnable r = (Runnable) appClass.getMethod("buildWorkUnit").invoke(instance);
            // Pretend the container thread received r; we just set the leak from here for simplicity:
            LEAK.set(r);                                  // (*) leak: r is loaded by the webapp loader

            // App "shuts down": webapp loader should be collectible. But isn't.
            app.close();
            instance = null;
            appClass = null;
            app = null;
            System.gc();
            System.out.println("redeploy " + i + " done");
        }

        // Take a heap dump:
        ((com.sun.management.HotSpotDiagnosticMXBean)
            ManagementFactory.getPlatformMXBean(com.sun.management.HotSpotDiagnosticMXBean.class))
            .dumpHeap("/tmp/leak.hprof", true);
        System.out.println("heap dumped to /tmp/leak.hprof");
    }
}
```

**Objective.**

- Open `/tmp/leak.hprof` in Eclipse MAT or VisualVM.
- Find five `URLClassLoader` instances named `webapp-v1` through `webapp-v5`.
- Use "Path to GC root, excluding weak references" — confirm the path goes through `LEAK` (the `ThreadLocal`) → main thread's `ThreadLocalMap` → main thread.

**Acceptance criteria.** Identify the exact root reference (the `ThreadLocal` value). Comment out line `(*)`, re-run, confirm no leak.

**Stretch.** Modify so the leak goes through a `DriverManager`-registered `Driver` subclass loaded by the webapp loader. Observe the same pattern with a different root.

---

## Task 7 — Design a plugin system with `ServiceLoader`

Build a small plugin SPI plus two providers, wired through `ServiceLoader`.

**Setup.**

```java
// In project "plugin-api":
package com.example.plugins;
public interface Greeting {
    String greet(String name);
}

// In project "plugin-formal":
package com.example.plugins.formal;
import com.example.plugins.Greeting;
public final class FormalGreeting implements Greeting {
    public String greet(String name) { return "Good evening, " + name + "."; }
}
// META-INF/services/com.example.plugins.Greeting contains:
//   com.example.plugins.formal.FormalGreeting

// In project "plugin-casual":
package com.example.plugins.casual;
import com.example.plugins.Greeting;
public final class CasualGreeting implements Greeting {
    public String greet(String name) { return "Hey, " + name + "!"; }
}
// META-INF/services/com.example.plugins.Greeting contains:
//   com.example.plugins.casual.CasualGreeting

// In project "host":
public class Host {
    public static void main(String[] args) {
        for (Greeting g : ServiceLoader.load(Greeting.class)) {
            System.out.println(g.getClass().getSimpleName() + " -> " + g.greet("Pat"));
        }
    }
}
```

Build three JARs. Put `plugin-api.jar` and both provider JARs on the classpath. Run `Host`.

**Objective.** Run twice — once with both provider JARs on the classpath, once with only one — and confirm `ServiceLoader` discovers them dynamically.

**Acceptance criteria.**

- Both providers print when both JARs are on the classpath.
- Removing one JAR removes it from the output without recompilation.
- A `loadClass` of one of the provider classes does *not* trigger `<clinit>` until you call `g.greet(...)`. Confirm by adding a `System.out.println("FormalGreeting <clinit>")` to a `static { }` block.

**Stretch.** Convert all three to JPMS modules. Add `provides Greeting with FormalGreeting;` and `uses Greeting;`. Confirm the classpath `META-INF/services` files are no longer consulted for the modular configuration.

---

## Task 8 — `Class.forName` vs `loadClass` — empirical proof

Demonstrate the side-effect difference.

**Setup.**

```java
public final class Loud {
    static { System.out.println("Loud <clinit> running"); }
    public static String greet() { return "hi"; }
}

public class Demo {
    public static void main(String[] args) throws Exception {
        System.out.println("--- via loadClass (no init) ---");
        ClassLoader cl = Demo.class.getClassLoader();
        Class<?> c1 = cl.loadClass("Loud");
        System.out.println("loaded, name=" + c1.getName());

        System.out.println("--- via Class.forName(name, false, cl) ---");
        Class<?> c2 = Class.forName("Loud", false, cl);
        System.out.println("loaded, name=" + c2.getName());
        System.out.println("c1 == c2 ? " + (c1 == c2));

        System.out.println("--- via Class.forName(name) ---");
        Class<?> c3 = Class.forName("Loud");
        System.out.println("loaded, name=" + c3.getName());

        System.out.println("--- via direct field/method access ---");
        Loud.greet();
    }
}
```

**Objective.** Demonstrate that only `Class.forName(name)` (default initialize=true) and the direct static call trigger `<clinit>`.

**Acceptance criteria.**

- The two-arg `forName` and `loadClass` produce the same `Class<?>` and do not print `Loud <clinit> running`.
- The default `forName(name)` prints `Loud <clinit> running` exactly once.
- The subsequent `Loud.greet()` does *not* print again — `<clinit>` already ran.

**Stretch.** Make `Loud` extend `LoudBase`, with `LoudBase` also having a noisy static block. Re-run. Observe that `LoudBase.<clinit>` runs before `Loud.<clinit>` when `Loud` is initialized (the superclass-first rule from `middle.md`).

---

## Validation

| Task | How to verify                                                                                            |
|------|----------------------------------------------------------------------------------------------------------|
| 1    | The output sequence matches your prediction at every step.                                               |
| 2    | First attempt has a `Caused by`; later attempts have none.                                               |
| 3    | The class's loader is your `JarPluginLoader`; child-first changes the resolution of non-`java.*` classes.|
| 4    | `c1 == c2` is `false`; the cross-loader cast throws `ClassCastException`.                                |
| 5    | The archive run is measurably faster; `-Xlog:cds` confirms.                                              |
| 6    | MAT's "Path to GC root" terminates at your `ThreadLocal` field.                                          |
| 7    | Providers appear / disappear with classpath changes; no recompilation.                                   |
| 8    | Only `forName(name)` and direct use trigger `<clinit>`.                                                  |

---

## Worked solution sketch — Task 1 expected output

Walk through it before running.

```
--- step 1: read C.CONSTANT ---
42
--- step 2: get B.class literal ---
--- step 3: access B.y ---
A.<clinit>
init A.x = 1
B.<clinit>
init B.y = 11
11
```

Why:

- **Step 1.** `C.CONSTANT` is a compile-time constant (`static final int = 42`). Javac inlined `42` at the call site. `C` is never loaded; `C.<clinit>` never runs.
- **Step 2.** `B.class` is a class literal — it triggers *loading* but not *initialization* (JLS §12.4.1).
- **Step 3.** Reading `B.y` triggers `B`'s initialization, which first initializes `A` (superclass), then runs `B`'s `<clinit>`. `A.x = 1` from `log("A.x", 1)`. `B.y = A.x + 10 = 11` from `log("B.y", 11)`.

If your output doesn't match this prediction, re-read the JLS §12.4.1 trigger list and find the rule you missed. That habit — predict, run, reconcile — is the only way the rules become reflex.

---

**Memorize this:** the rules are mechanical; the surprises come from misreading them. Each task here is an experiment that turns a rule into a memory. Run them locally, change one variable at a time, predict the new output. After eight tasks you will read a `<clinit>` stack trace and know which spec section it points to without thinking.
