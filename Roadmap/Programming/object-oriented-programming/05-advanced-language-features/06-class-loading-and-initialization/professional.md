# Class Loading and Initialization — Professional

> **What?** The team-level discipline around classloading: vocabulary for code review, ArchUnit and SpotBugs rules that catch the worst static-initializer smells before merge, the leak-debugging runbook on-call needs, refactor strategies for legacy static state, and how to roll AppCDS into a deployment pipeline without surprises.
> **How?** Treat classloading as a *quiet* concern — code that breaks classloading rules compiles, passes unit tests, and only crashes in production. Push detection upstream of the bug: lint rules, architecture tests, deploy-time CDS validation, on-call playbooks.

---

## 1. Code review vocabulary — name the phase

Reviewers who have seen one classloader incident know to look for static initializers that touch I/O or threads. Most engineers haven't. A useful comment names the *phase* the code is touching and the *failure mode* it invites.

```java
// Under review:
public final class Config {
    public static final Properties P = load();

    private static Properties load() {
        try (InputStream in = Files.newInputStream(Path.of("/etc/app/config.yml"))) {
            Properties p = new Properties();
            p.load(in);
            return p;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
```

A reviewer who knows the phase model can write a short, surgical comment:

> **Reviewer:** This runs in `<clinit>`. If `/etc/app/config.yml` is missing in any environment, the first access throws `ExceptionInInitializerError`, the class is permanently "errored" (every future access is `NoClassDefFoundError`), and we have no way to recover without restarting the JVM. Move the load to a method called from the composition root, or behind a Holder idiom that surfaces failures lazily.

Versus an unhelpful "this is risky" without the mechanism.

Useful phrases the team should standardise on:

- **"runs in `<clinit>`"** — flags any static initializer logic, especially I/O or threads.
- **"permanently errored"** — names the post-`ExceptionInInitializerError` state.
- **"loader-scoped singleton"** — each classloader has its own static state; relevant for hot-deploy.
- **"forward reference"** — a static reads another static before it has been assigned.
- **"context classloader"** — usually wrong default for libraries; flag every `Thread.currentThread().getContextClassLoader()`.

Reviewers who reach for these terms find bugs without rewriting the code in the comments.

---

## 2. Static-analysis rules that catch real bugs

You cannot review every `static { ... }` block by hand. Push detection to CI.

**SonarQube** rules that map to classloading hygiene:

- `java:S2696` — instance methods should not write to static fields. Catches accidental static state.
- `java:S3010` — static fields should not be updated in constructors. Same.
- `java:S2438` — `Threads` should not be used where `Runnable` would suffice. Often a `new Thread(...).start()` in `<clinit>`.
- `java:S5993` — constructors of classes with `@Component` (etc.) should not throw — sister rule to "do not throw in `<clinit>`".

**SpotBugs** has a small set that targets static initialization:

- `SI_INSTANCE_BEFORE_FINALS_ASSIGNED` — an instance is constructed in `<clinit>` before all final fields are assigned.
- `LI_LAZY_INIT_STATIC` — non-thread-safe lazy init of a static field. The fix is usually the Holder idiom.
- `MS_PKGPROTECT` / `MS_FINAL` — mutable public static fields.
- `ST_WRITE_TO_STATIC_FROM_INSTANCE_METHOD` — instance methods that write static state.

**ArchUnit** is the most direct: encode classloading invariants as architecture tests.

```java
@ArchTest
static final ArchRule no_io_in_static_initializers =
    classes().should().notHaveACodePattern(  // pseudo-name; ArchUnit's actual rule is custom
        "any <clinit> calling java.nio.file.Files, java.net.Socket, java.sql.DriverManager, ...");
```

ArchUnit doesn't ship a built-in for "no I/O in `<clinit>`" — write a custom condition:

```java
@ArchTest
static final ArchRule no_io_in_clinit = classes().should(new ArchCondition<JavaClass>("not perform I/O in <clinit>") {
    @Override public void check(JavaClass clazz, ConditionEvents events) {
        clazz.getStaticInitializer().ifPresent(init -> {
            init.getMethodCallsFromSelf().stream()
                .filter(c -> c.getTarget().getOwner().isAssignableTo(java.io.InputStream.class)
                          || c.getTarget().getOwner().isAssignableTo(java.net.Socket.class)
                          || c.getTarget().getFullName().startsWith("java.nio.file.Files"))
                .forEach(c -> events.add(SimpleConditionEvent.violated(
                    clazz, clazz.getFullName() + " performs I/O in <clinit> via " + c.getTarget().getFullName())));
        });
    }
});
```

The team that adds this rule once will never again ship a class that does I/O on first touch.

A second ArchUnit rule worth shipping: **no `Thread.start()` inside `<clinit>`.** Section 2 of `senior.md` shows the deadlock. The rule mechanically blocks it.

---

## 3. Mentoring — "no I/O in static initializers"

A junior often introduces I/O in `<clinit>` because it "feels eager and clean". The mentoring move is to attach the rule to a real bug the team felt.

> **Mentor:** Last quarter the order-export job died in production every other day, and we couldn't reproduce locally. The bug was `<clinit>` of `RouteRegistry` reading `/etc/routes.yml`, which sometimes wasn't deployed yet. Once `<clinit>` failed, every code path that touched `RouteRegistry` threw `NoClassDefFoundError`, which is a *different* exception than the original `IOException`. The fix wasn't "fix the missing file" — the fix was "don't do I/O in `<clinit>`."

The general teaching:

- **`<clinit>` runs once per loader.** A failure is permanent.
- **`<clinit>` throws `ExceptionInInitializerError`** — wrapping the original exception. Every later access throws `NoClassDefFoundError`, with no original cause. The stack trace lies about the real problem.
- **`<clinit>` is on the path of every active use of the class.** A slow `<clinit>` slows down the first request, the first job, the first health check.

A class is initialized when actively used. Any *eagerness* you want — DB connect, config load, registry registration — belongs in a method called by the composition root, where exceptions are catchable and the order is deliberate.

---

## 4. Refactor strategy — moving logic out of `<clinit>`

You inherit a class with a static initializer that does I/O. The temptation is to delete the initializer; the constraint is that callers rely on the side effects. The strangler-fig version:

**Step 1.** Identify the side effects. List every action the initializer performs:

```java
public final class RouteRegistry {
    private static final Map<String, Route> ROUTES = loadFromDisk();

    private static Map<String, Route> loadFromDisk() {
        try (var in = Files.newBufferedReader(Path.of("/etc/routes.yml"))) {
            return YamlParser.parse(in);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
    public static Route lookup(String key) { return ROUTES.get(key); }
}
```

Side effects: reads `/etc/routes.yml`, parses, populates a static map. Visible API: `lookup`.

**Step 2.** Introduce a delegate the caller can construct.

```java
public final class RouteRegistry {
    private final Map<String, Route> routes;

    public RouteRegistry(Map<String, Route> routes) { this.routes = Map.copyOf(routes); }

    public static RouteRegistry fromDisk(Path file) throws IOException {
        try (var in = Files.newBufferedReader(file)) {
            return new RouteRegistry(YamlParser.parse(in));
        }
    }

    public Route lookup(String key) { return routes.get(key); }
}
```

**Step 3.** Migrate callers. Replace `RouteRegistry.lookup(...)` with `routeRegistry.lookup(...)`, injecting the registry from the composition root. The static map disappears.

**Step 4.** Delete the static `<clinit>`. The bug class becomes test-friendly: tests build a `RouteRegistry` from an in-memory `Map`; production builds it from disk in a deliberate place (Spring `@Bean`, `main`, etc.).

You have moved one class from "permanently errored at first touch" to "fails at the composition root, where the failure is catchable, recoverable, and testable".

---

## 5. Classloader-leak debugging — the runbook

Symptom: Metaspace climbs after each redeploy and eventually hits the configured limit. `jcmd` shows it; `gc.log` shows it; production OOMs at 3am.

The standard runbook:

**1. Confirm the leak is per-redeploy.** Trigger a redeploy on a non-production host, watch Metaspace before and after. If it grows by ~the size of the app's class metadata each time, you have a classloader leak.

**2. Take a heap dump after several redeploys.**

```bash
jcmd $PID GC.heap_dump /tmp/redeploy-leak.hprof
```

**3. Open in Eclipse Memory Analyzer (MAT)** or VisualVM. Search for instances of your container's loader class. For Tomcat:

```
class: org.apache.catalina.loader.ParallelWebappClassLoader
```

You expect *one* live instance (the current app). If you see N+1, the old ones are leaking.

**4. Run "Path to GC Root, excluding weak references"** on the oldest `WebappClassLoader`. The path you get is the leak. Typical shapes:

```
WebappClassLoader (webapp-v1)
  <- field "contextClassLoader" of Thread "scheduled-task-1"
  <- registered with ScheduledThreadPoolExecutor that was never shut down
```

```
WebappClassLoader (webapp-v1)
  <- field "loader" of class com.acme.RequestContextHolder
  <- value in ThreadLocalMap entry for thread "ajp-nio-8009-exec-3"
```

```
WebappClassLoader (webapp-v1)
  <- field "driver" of instance of org.postgresql.Driver
  <- registered with java.sql.DriverManager
```

**5. Match the root to a fix.** Patterns:

| Root reference                                    | Fix                                                                       |
|---------------------------------------------------|---------------------------------------------------------------------------|
| `ThreadLocal` on a container thread               | `ServletContextListener.contextDestroyed` clears every set thread-local. |
| `DriverManager`-registered JDBC driver            | `DriverManager.deregisterDriver` in `contextDestroyed`. Tomcat 8+ does this automatically; some non-Tomcat containers don't. |
| `ScheduledExecutorService` not shut down          | `ContextDestroyed` calls `shutdownNow()`.                                |
| `Logger` from a third-party lib pinning the app   | Move the library to the container's lib dir so the logger lives at the parent. |
| JNDI binding                                      | `Context.unbind` on undeploy.                                            |
| `Timer` instance                                  | `Timer.cancel()`.                                                        |

**6. Verify.** Redeploy after the fix. Heap dump again. Confirm Metaspace returns to baseline.

A good engineering culture documents each leak found and the fix applied — they recur in different libraries.

---

## 6. AppCDS rollout — a concrete deployment recipe

AppCDS is one of the cheapest startup wins available. Roll it out in stages.

**Stage 1: measure baseline.**

Capture cold-start time and steady-state RSS on a representative service for at least a week. Don't optimise what you haven't measured.

**Stage 2: training run in CI.**

Add a step to the image build:

```dockerfile
FROM eclipse-temurin:21-jdk AS training
WORKDIR /app
COPY app.jar .
# Run a smoke test (in-process or hit a few endpoints), then exit cleanly.
RUN java -XX:ArchiveClassesAtExit=/app/app.jsa -jar app.jar --smoke-test-and-exit

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=training /app/app.jar .
COPY --from=training /app/app.jsa .
ENTRYPOINT ["java", "-XX:SharedArchiveFile=app.jsa", "-jar", "app.jar"]
```

The training stage is deterministic (no network), runs in seconds, and produces an archive sized in the tens of MB.

**Stage 3: validate.** Compare cold-start of the new image against the baseline. A 25–40% reduction is typical for Spring Boot, Quarkus's standard mode, Micronaut.

**Stage 4: roll out gradually.** Canary first. Watch for:

- *Slower* startup on the first deploy with a new JDK (archive incompatible — JVM regenerates from scratch).
- Increased Metaspace utilisation (archived classes count toward Metaspace).
- Modules loaded at runtime that weren't in the training run (no benefit, no harm).

**Stage 5: enforce.** Make CDS opt-out, not opt-in. CI fails the build if the JSA wasn't produced. On-call runbook: "if startup is suddenly slow, check if the archive is being loaded — `-Xlog:cds=info` shows it."

**Pitfalls to budget for:**

- **JDK upgrades require new archives.** Bake the archive into the image; never reuse archives across JDK minor versions.
- **Reflection-heavy frameworks load classes after training.** Frameworks like Spring with `@Lazy` beans, conditional `@Bean`s, or `@EnableConfigurationProperties` see this. Re-record after major framework upgrades.
- **Classes loaded by a JVMTI agent are usually excluded from CDS.** APM agents (Datadog, NewRelic) often disable CDS for the classes they instrument.

For projects targeting JDK 21+, **JEP 483 (Ahead-of-Time Class Loading & Linking)** in JDK 24 EA caches even more (linking results in addition to metadata) and gives larger wins still. Track its GA status.

---

## 7. Anti-patterns to call out in review

**Anti-pattern 1: I/O in `<clinit>`.**

```java
public final class FeatureFlags {
    private static final Set<String> FLAGS = fetchFromHttp();   // ← never
    private static Set<String> fetchFromHttp() { /* HTTP call */ }
}
```

Class is permanently errored if the HTTP service is down at first touch.

**Anti-pattern 2: starting threads in `<clinit>`.**

```java
public final class HeartbeatBus {
    static {
        new Thread(HeartbeatBus::pumpForever, "heartbeat").start();   // ← deadlock risk
    }
}
```

See `senior.md` section 2 for the exact deadlock mechanism.

**Anti-pattern 3: registering with a global registry from `<clinit>`.**

```java
public final class XmlSerializer implements Serializer {
    static { SerializerRegistry.register(new XmlSerializer()); }
}
```

The registry now holds a reference to `XmlSerializer` (and through it, the loader that loaded it). If `XmlSerializer` was loaded by a webapp loader and the registry is at a higher loader, you have just built a guaranteed classloader leak.

**Anti-pattern 4: catching and ignoring `ExceptionInInitializerError`.**

```java
try { use(MyClass.class); }
catch (ExceptionInInitializerError ignored) {}
```

Every later access of `MyClass` throws `NoClassDefFoundError` with no cause. The application looks fine and behaves nonsensically.

**Anti-pattern 5: `Class.forName` in a tight loop.**

```java
for (String name : names) {
    Class<?> c = Class.forName(name);   // initializes the class!
    if (Plugin.class.isAssignableFrom(c)) candidates.add(c);
}
```

Replace with `loadClass` if you're scanning, then `forName` (initializing) only on the chosen plugin.

**Anti-pattern 6: relying on the thread context classloader.**

```java
ClassLoader cl = Thread.currentThread().getContextClassLoader();
return cl.loadClass(name);
```

In libraries this is almost always wrong. The TCCL is whatever the *calling* thread set, which the library has no control over. Prefer the class's own classloader (`Foo.class.getClassLoader()`) unless you have a *specific* reason to bridge loader boundaries.

---

## 8. The mentoring checklist for new joiners

Three questions a new engineer should be able to answer after two weeks on the team:

1. What is the difference between `Class.forName(name)` and `ClassLoader.loadClass(name)`?
2. Why do we have ArchUnit rules against I/O in `<clinit>`?
3. What is the classloader hierarchy in our deployment, and which loader owns the application code?

If they can answer these without hand-waving, they will not introduce the worst classloader bugs by accident. If they can't, you have a teaching opportunity attached to a real PR.

---

## 9. Quick rules

- [ ] Code review: name the phase (`<clinit>`, link, load), name the failure mode, propose the smallest move.
- [ ] CI gate: ArchUnit rule for "no I/O in `<clinit>`" and "no `Thread.start()` in `<clinit>`".
- [ ] CI gate: SpotBugs `LI_LAZY_INIT_STATIC` and `SI_INSTANCE_BEFORE_FINALS_ASSIGNED`.
- [ ] Refactor pattern: move static work into a constructor or factory method called from the composition root.
- [ ] Leak runbook: heap dump → MAT → "path to GC root excluding weak" → fix at the root reference.
- [ ] AppCDS rollout: training stage in image build, archive baked into image, opt-out (not opt-in) on the JVM command line.
- [ ] Reject PRs that catch and ignore `ExceptionInInitializerError`; the class is permanently broken.
- [ ] Library code uses `Foo.class.getClassLoader()`; *application* code may use TCCL, but only with a reason.

---

## 10. What's next

| Topic                                                       | File              |
|-------------------------------------------------------------|-------------------|
| JLS / JVMS / JEP references                                 | `specification.md` |
| 10 bug snippets with stack traces                           | `find-bug.md`      |
| AppCDS, dynamic CDS, GraalVM native image, AOT              | `optimize.md`      |
| Hands-on labs                                               | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

Cross-references:

- [../02-jpms-modules/](../02-jpms-modules/) — modules are the right substrate for the plugin systems mentioned above.
- [../03-reflection-and-annotations/](../03-reflection-and-annotations/) — review rules for `Class.forName` and reflective access.

---

**Memorize this:** classloading is *quiet* — bugs ship without warnings. Push detection to ArchUnit and SpotBugs; review against a vocabulary that names the phase; teach by anchoring rules to real outages. AppCDS is a free 25–40% cold-start win when baked into the image. Classloader leaks are a Metaspace problem now, debugged with a heap dump and the "path to GC root excluding weak references" view. Never do I/O or start threads in `<clinit>`. Move static work to a deliberate call from the composition root.
