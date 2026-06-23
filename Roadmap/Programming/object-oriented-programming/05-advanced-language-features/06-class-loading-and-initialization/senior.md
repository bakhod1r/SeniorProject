# Class Loading and Initialization — Senior

> **What?** The parts of class loading that show up in incidents: the three substeps of *linking* (verification, preparation, resolution); the thread-safety guarantees of `<clinit>` and the deadlocks that can still happen at its edges; classloader leaks that survive redeploy and devour Metaspace; custom classloaders for plugin systems and isolation; AppCDS as a real production startup optimisation; and the JPMS module-layer model that finally gives classloaders a clean topology.
> **How?** Each section is a problem you will eventually meet in a JVM running real workloads. Read the section, then think about where in your own stack the same shape exists.

---

## 1. Linking — the three quiet substeps (JVMS §5.4)

The JLS and JVMS split *linking* into three substeps that almost no application developer ever observes directly, but every JVM does:

| Substep         | What the JVM does                                                                 | Errors you may see                          |
|-----------------|-----------------------------------------------------------------------------------|---------------------------------------------|
| **Verification** (§5.4.1) | Checks the bytecode is structurally and type-safely valid.                | `VerifyError`                               |
| **Preparation** (§5.4.2)  | Allocates storage for static fields and assigns *default values* (`0`, `null`). | (none — silent)                             |
| **Resolution** (§5.4.3)   | Replaces symbolic references in the constant pool with concrete pointers.  | `NoClassDefFoundError`, `NoSuchMethodError`, `IncompatibleClassChangeError` |

Verification is what makes the JVM safe even when running bytecode from untrusted sources. It walks the bytecode of every method and verifies the type-flow invariants (no `ALOAD` into an `int` slot, no jump outside method bounds, every `RETURN` has an appropriate stack frame, etc.). HotSpot caches verification results in CDS archives — see section 7.

Preparation is the source of one of the more subtle JLS rules. After preparation, a static field of type `int` exists, set to `0`. Code that reads the field before `<clinit>` runs (e.g., through reflection during loading, or via the cyclic-init pattern from `middle.md`) sees that `0`. The field is *physically* there; it just hasn't been *initialized*.

Resolution is what turns a constant-pool entry like `Methodref(class=Foo, name=bar, descriptor=()I)` into an actual pointer to method code. Resolution can be deferred until first use of the symbolic reference (`-XX:-EagerXrunCheck` and friends), or eager. Crucially, **resolution failures show up at use, not at load**. If `Foo` was compiled against `Bar.baz(int)` and the deployed `Bar` only has `baz(long)`, the missing-method failure does not fire until something actually calls `Foo`'s code path that touches it — sometimes weeks after deploy.

---

## 2. `<clinit>` thread safety — the implicit lock (JLS §12.4.2)

`<clinit>` is implicitly synchronized. The JVM guarantees:

- Exactly one thread runs `<clinit>` for a given `Class<?>`.
- All other threads attempting to initialize the same class **block** on the per-class lock until that thread finishes.
- After `<clinit>` returns, all blocked threads see the writes through a happens-before edge — no `volatile` or explicit synchronization is required to publish static fields written in `<clinit>`.

This is the foundation of the *initialization-on-demand holder* idiom (Bill Pugh's idiom), the canonical thread-safe singleton in Java:

```java
public final class Heavy {
    private Heavy() {}
    private static class Holder { static final Heavy INSTANCE = new Heavy(); }
    public static Heavy instance() { return Holder.INSTANCE; }
}
```

`Holder` is a nested class — `Heavy`'s `<clinit>` does *not* touch `Holder`, so `Holder` is loaded only when `instance()` is first called. The JVM's per-class lock makes the first call thread-safe; subsequent calls see the already-initialized class and do a cheap field read. No `synchronized`, no `volatile`, no double-checked locking, no race.

But the lock can be the source of *initialization deadlocks*:

```java
class A {
    static B b = new B();
    static int after = 1;
}
class B {
    static int x = doIt();
    static int doIt() {
        Thread t = new Thread(() -> A.after = 2);   // (*)
        t.start();
        try { t.join(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        return 1;
    }
}
```

Two threads:

- **Main** is initializing `A` → enters `A`'s lock → calls `new B()` → starts initializing `B`.
- `B`'s `<clinit>` spawns a new thread (`*`) which then accesses `A.after`. The new thread enters `A`'s initialization lock → blocks because `A` is still being initialized by main.
- `B`'s `<clinit>` calls `t.join()` → main thread is now stuck waiting for the new thread, which is stuck waiting for main's lock.

Classic deadlock. The "do not start threads in static initializers" rule is a direct consequence of this trap, and a real story behind several library-startup-deadlock CVEs over the years.

---

## 3. Classloader leaks — Metaspace edition

In Java 8 and earlier, "classloader leak" meant *PermGen exhaustion*. PermGen was a fixed-size region of the heap that held `Class<?>` objects, interned strings, and class metadata. A web app that redeployed N times with a classloader leak would eventually hit `OutOfMemoryError: PermGen space` and OOM the whole container.

Java 8 removed PermGen (JEP 122) and moved class metadata into native memory (Metaspace), defaulting to *unbounded*. The leak still exists; it now consumes native memory until the OS OOM-killer fires. Set `-XX:MaxMetaspaceSize=512m` so you crash deterministically in development.

The mechanism is always the same. A redeployed web app's `WebappClassLoader` is *supposed* to become unreachable after the redeploy completes, so GC can collect every class it loaded. But if anything outside that loader still holds a strong reference to *one* class loaded by *that* loader, the whole loader and *every* class it loaded survives.

Common holders:

- **`ThreadLocal` set by app code on a long-lived container thread.** The thread is in the container's pool, lives across redeploys. The thread-local map holds a key that is a `Class<?>` from the old loader. The old loader cannot be collected.
- **JDBC drivers registered through `DriverManager`.** The driver is held by `DriverManager` (a class in `java.sql`, loaded by the platform loader). The driver instance was loaded by the webapp loader. The driver's class — and through it the whole webapp loader — survives. Tomcat 8+ explicitly deregisters drivers at undeploy for this reason.
- **JNDI bindings registered by the app and not unregistered.**
- **Static `Logger` references in third-party libraries**, when the library is on the container's classpath but holds a per-thread context referring to webapp classes.
- **Custom `Timer` / `ScheduledExecutorService` threads** started by the app and never stopped.

Diagnosis is mechanical. Take a heap dump (`jcmd PID GC.heap_dump /tmp/dump.hprof`), open in MAT or VisualVM, search for instances of `WebappClassLoader`, and use *"Path to GC Root, excluding weak references"*. The path you find is the leak.

```
WebappClassLoader (webapp-v1)
    <- referenced by Thread "Catalina-utility-1" 
    <- field "threadLocals" of class ThreadLocalMap
    <- entry whose key is class com.acme.RequestContextHolder
```

The fix is always at the point of root reference: clear the thread-local in a `ServletContextListener.contextDestroyed`, deregister the driver explicitly, stop the scheduled task. The class loader itself is innocent — it just got stuck.

---

## 4. Custom classloaders for plugin isolation

Most applications never need a custom classloader — the application loader works fine. Plugin systems, app servers, IDE workspaces, and OSGi-style runtimes are the exception. The standard recipe overrides `findClass` (loading) and sometimes `loadClass` (delegation).

```java
public final class PluginClassLoader extends ClassLoader {
    private final Path pluginJar;

    public PluginClassLoader(Path pluginJar, ClassLoader parent) {
        super("plugin:" + pluginJar.getFileName(), parent);
        this.pluginJar = pluginJar;
    }

    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        try (JarFile jar = new JarFile(pluginJar.toFile())) {
            JarEntry entry = jar.getJarEntry(name.replace('.', '/') + ".class");
            if (entry == null) throw new ClassNotFoundException(name);
            byte[] bytes = jar.getInputStream(entry).readAllBytes();
            return defineClass(name, bytes, 0, bytes.length);
        } catch (IOException e) {
            throw new ClassNotFoundException(name, e);
        }
    }
}
```

Three subtleties:

**1. Delegation direction.** The default parent-first delegation means the plugin loader asks its parent before searching its own JAR. If two plugins bundle different versions of `commons-logging`, both get the *parent's* version (the host app's choice). To allow per-plugin library versions, override `loadClass` and do **child-first** (or "self-first") delegation for non-`java.*` classes — this is what Tomcat does for `WebappClassLoader`.

```java
@Override
protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
    synchronized (getClassLoadingLock(name)) {
        Class<?> c = findLoadedClass(name);
        if (c == null) {
            if (name.startsWith("java.") || name.startsWith("javax.")) {
                c = getParent().loadClass(name);     // always parent for core
            } else {
                try { c = findClass(name); }
                catch (ClassNotFoundException e) { c = getParent().loadClass(name); }
            }
        }
        if (resolve) resolveClass(c);
        return c;
    }
}
```

The break from strict parent-first is what gives plugins their isolation. It is also what creates ClassCastException-across-loaders bugs (see `find-bug.md`).

**2. Class identity is loader-scoped.** Two plugin loaders that both define `com.shared.Marker` produce two distinct `Class<?>` instances. Cross-plugin communication must go through a *shared* type defined by the **parent** loader.

**3. Closeability.** Since Java 7, `URLClassLoader` implements `Closeable`. Custom loaders should too — when a plugin is uninstalled, you want every file handle the loader opened to be closed deterministically, not at GC's whim.

---

## 5. AppCDS — production startup optimisation (JEP 310, JEP 350)

Class Data Sharing has been in HotSpot since Java 5, but it only covered the JDK's own classes. **JEP 310 (Java 10)** extended it to *application* classes — Application Class Data Sharing, or AppCDS. **JEP 350 (Java 13)** made the archive generation automatic at exit, so you no longer need a two-step build. **JEP 388 (Java 15)** unified CDS / AppCDS and let it cover the JDK's class list without a custom JDK build.

What's actually cached:

- Parsed class metadata (each `Class<?>` representation in Metaspace).
- Verification results.
- The constant pool, in a form ready for the JVM to point at.
- Optionally, an interpreter-friendly code cache snapshot.

What's *not* cached: your `<clinit>` results, JIT compilation output (that's a separate `-XX:ArchiveClassesAtExit` plus AOT story).

Real numbers: a Spring Boot 3 application that takes 4.2s to first-request without CDS often takes 2.8–3.2s with AppCDS, on the same hardware, with no code changes. The savings are concentrated in the first hundreds of milliseconds — parsing thousands of `.class` files is gone.

How to enable, the Java 13+ way:

```
# 1. Run with -XX:ArchiveClassesAtExit to record what classes get loaded
java -XX:ArchiveClassesAtExit=app.jsa -jar app.jar
# (do something representative, then Ctrl-C or rely on graceful shutdown)

# 2. Future starts use the archive
java -XX:SharedArchiveFile=app.jsa -jar app.jar
```

In a containerised setting, the archive is part of the image — built once at image-build time, mounted read-only at run time. Every container instance benefits from the same archive.

Caveats (handle in production):

- Archive is JVM-version-specific. Rebuild on JDK upgrade.
- Classpath order matters; the archive records the loader chain. A different classpath at run time falls back to non-shared loading for the divergent classes.
- Modules loaded dynamically (e.g., reflection, ServiceLoader at runtime) are *not* in the archive unless they were touched during recording.

---

## 6. JPMS module layers and classloaders

JEP 261 (Java 9) introduced a layer of organisation **above** classloaders: the **module layer** (`java.lang.ModuleLayer`). A layer is a resolved set of named modules; it sits on top of one or more classloaders.

The boot layer is constructed at JVM startup from the boot modules and is the parent of all user-created layers. Application code can create child layers programmatically:

```java
ModuleLayer parent = ModuleLayer.boot();

ModuleFinder finder = ModuleFinder.of(Path.of("plugins"));
Configuration cfg = parent.configuration()
                          .resolve(finder, ModuleFinder.of(), Set.of("acme.plugin"));

ModuleLayer pluginLayer = parent.defineModulesWithOneLoader(cfg, this.getClass().getClassLoader());
```

`defineModulesWithOneLoader` creates *one* classloader for all modules in the layer; `defineModulesWithManyLoaders` creates one classloader per module (strict isolation).

The layer system gives `ServiceLoader` more discoverable structure: `ServiceLoader.load(Layer, Class)` finds providers in a specific layer, not "whatever the thread context loader thinks". Hot-deploy of a plugin becomes "drop the old layer, build a new one" — no per-plugin classloader plumbing.

For application code, the practical takeaway is: **on JDK 9+, prefer building plugin systems on top of `ModuleLayer` rather than raw classloaders.** The layer abstracts the loader management, gives you `provides`/`uses` declarations, and integrates with the module graph.

---

## 7. AppCDS + JPMS — the combined startup story

Modern JVMs combine CDS with JPMS aggressively. The default CDS archive shipped with the JDK already covers the boot layer modules. JEP 388 extended this to a "default CDS archive for unmodified JDK class lists" — meaning you get JDK class sharing for free, without recording anything.

To extend it to your modules:

```
java -XX:ArchiveClassesAtExit=app.jsa --module-path mods -m com.acme.app
# later
java -XX:SharedArchiveFile=app.jsa --module-path mods -m com.acme.app
```

The archive captures the module graph as it stood during the recording. Adding modules at run time falls back to non-shared loading; removing modules from the path produces a startup error (the archive references modules that aren't present).

For containerised services, the practical recipe is:

1. Build the application image.
2. In a *training* container, run a smoke test that exercises the major code paths.
3. `-XX:ArchiveClassesAtExit=` captures the archive.
4. Bake the archive into a final image layer.
5. Production containers run with `-XX:SharedArchiveFile=`.

A typical Spring Boot service drops a second off cold start with this. For serverless / scale-to-zero workloads where cold start is the user-visible latency, that second is real money.

---

## 8. Bytecode introspection during loading — agents and instrumentation

Class loading is the JVM's natural extension point. The `java.lang.instrument` API (`-javaagent:agent.jar`) lets a Java agent transform every `.class` file *between* its arrival from the classloader and its `defineClass` call:

```java
public class TracingAgent {
    public static void premain(String args, Instrumentation inst) {
        inst.addTransformer((loader, name, classBeingRedefined, pd, classfile) -> {
            if (name.startsWith("com/acme/")) return rewrite(classfile);
            return null;
        });
    }
    static byte[] rewrite(byte[] in) { /* ASM or ByteBuddy */ return in; }
}
```

The transformer sees every class load. It can rewrite bytecode (add instrumentation, add tracing, even change method bodies). Glowroot, OpenTelemetry's Java agent, Datadog APM, and JaCoCo all work this way.

Implications for class loading:

- Verification runs **after** transformation — your agent's output must produce verifiable bytecode.
- Transformed classes are still loaded by the same classloader that asked. The agent doesn't insert a new loader.
- CDS archives are aware of agents; a class transformed by an agent will not be served from a non-matching CDS archive (the cached bytes wouldn't match). This is a real reason agents disable CDS for the classes they touch.

For most application engineers, the agent layer is invisible. For someone reading a strange method body in a debugger, it explains the surprise: the source says one thing, the runtime bytes say another.

---

## 9. Eager vs lazy — design choices for static state

Knowing the mechanics, you can deliberately choose when classes pay their cost.

**Eager.** Use a `@Configuration` class that touches every component in the composition root. Spring Boot's `eagerInitialization=true` does this for you. Trade more startup time for fewer surprise pauses later.

```java
@Configuration
public class EagerWiring {
    public EagerWiring(MetricsRegistry m, FeatureFlags f, JdbcTemplate j) {
        // every service mentioned here is initialized at startup.
    }
}
```

**Lazy.** Use the Initialization-on-demand Holder idiom for heavy singletons. The first call pays the cost; subsequent calls are free.

**Explicit.** When the cost is significant and the timing matters (cold-start latency budget, blue-green deploy), call `Class.forName(...)` from a warm-up routine that runs before the load balancer routes traffic.

Common mistakes:

- **I/O inside `<clinit>`.** A static initializer that reads a config file is a classloading time bomb — if the file is missing on a particular environment, the class becomes permanently broken (`ExceptionInInitializerError` once, then `NoClassDefFoundError` for every later attempt — see `find-bug.md`). Initialize from a constructor or a Spring `@PostConstruct`, not a static block.
- **Starting threads or pools in `<clinit>`.** Section 2's deadlock. Always defer thread creation to a method, ideally one called explicitly by your composition root.
- **Network calls in `<clinit>`.** Tests run on laptops with no network. Production hosts have firewalls. Static initializers that contact other services on first load make those classes impossible to test in isolation and ridiculous to debug.

---

## 10. The composite picture — a senior's mental model

```
   .class file  --[ class loader.loadClass ]-->  loaded
        loaded  --[ verify, prepare, resolve ]--> linked
        linked  --[ <clinit> on first active use ]--> initialized
   initialized  --[ <init> per new instance ]--> running
```

- Each classloader has its own copy of every class.
- Each `Class<?>` has its own `<clinit>` lock; `<clinit>` runs once, with happens-before for every later thread.
- The classloader hierarchy (bootstrap, platform, application, plus your custom ones) determines who finds the bytes.
- AppCDS skips the load+link work between JVM runs.
- JPMS module layers organize classloaders into a graph and give `ServiceLoader` deterministic, layered discovery.
- Hot deploy works because dropping a classloader (and waiting for GC) drops every class and every static it loaded.

---

## 11. Quick rules

- Verification, preparation, resolution are the three substeps of linking — only the resolution failures (`NoClassDefFoundError`, `NoSuchMethodError`) usually escape into application logs.
- `<clinit>` is implicitly synchronized; the Initialization-on-demand Holder idiom is the cheapest thread-safe singleton.
- Never spawn threads or do I/O in a static initializer — deadlocks and `ExceptionInInitializerError` follow.
- Classloader leaks survive redeploy. The usual roots are thread locals on container threads, JDBC drivers, JNDI, and scheduled tasks. Heap-dump-and-MAT is the canonical workflow.
- Custom classloaders need a delegation policy and `Closeable` semantics. Parent-first for safety, child-first for plugin version isolation.
- AppCDS + `-XX:ArchiveClassesAtExit` (Java 13+) cuts cold-start time measurably with zero code changes.
- JPMS `ModuleLayer` is the modern abstraction for plugin systems; build above the layer, not the raw classloader.
- Class identity is loader-scoped — `Class<?>` `==` comparisons across loaders return `false` even for the same FQN.

---

## 12. What's next

| Topic                                                       | File              |
|-------------------------------------------------------------|-------------------|
| Code review, ArchUnit rules, leak debugging recipes         | `professional.md`  |
| JLS / JVMS / JEP references                                 | `specification.md` |
| 10 bug snippets with stack traces                           | `find-bug.md`      |
| AppCDS, dynamic CDS, GraalVM native image, AOT              | `optimize.md`      |
| Hands-on labs (custom loader, leak, plugin system)          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

Cross-references:

- [../02-jpms-modules/](../02-jpms-modules/) — `ModuleLayer` builds directly on the classloader model.
- [../../03-design-principles/06-fragile-base-class-problem/](../../03-design-principles/06-fragile-base-class-problem/) — static state in inheritance amplifies fragility.
- [../../06-method-dispatch-and-internals/04-object-memory-layout/](../../06-method-dispatch-and-internals/04-object-memory-layout/) — what the `Class<?>` and Metaspace look like.

---

**Memorize this:** linking is **verify, prepare, resolve**; resolution failures (`NoClassDefFoundError`, `NoSuchMethodError`) are the ones you see. `<clinit>` is implicitly synchronized — use the Holder idiom for singletons, never start threads or do I/O inside it. Classloader leaks are *Metaspace* now; the usual roots are thread locals, JDBC drivers, and unstopped tasks. AppCDS plus `-XX:ArchiveClassesAtExit` is the modern startup lever. JPMS `ModuleLayer` is the right plugin substrate on JDK 9+ — build above the loader, not on it.
