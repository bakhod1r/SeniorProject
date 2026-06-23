# Class Loading and Initialization — Optimize

> Class loading is on the *cold path*. By the time the JIT has warmed up, every class your steady state touches is already loaded, linked, and initialized. The optimisation problem is therefore "make the cold path shorter" — for cold starts, scale-out events, lambda invocations, CLI tools, and the first request after deploy. The levers are AppCDS, lazy initialization patterns, careful use of compile-time constants, and at the extreme, AOT compilation (GraalVM native image, JEP 483).

---

## 1. Where the time actually goes

A profile of a Spring Boot 3 app's cold start, broken down by phase:

| Phase                                        | Typical share of 4–5 s startup |
|----------------------------------------------|--------------------------------|
| JVM startup (mmap libs, parse CDS archive)   | 100–300 ms                     |
| JDK class loading + verification             | 300–600 ms                     |
| Application class loading                    | 500–1500 ms                    |
| Application `<clinit>` execution             | 500–2000 ms                    |
| Reflection / proxy generation (Spring)       | 500–1500 ms                    |
| JIT warm-up to steady state                  | 1000–3000 ms (overlapped)      |

The single largest reducible cost is "application class loading + verification" — *exactly* what AppCDS targets. The next is `<clinit>` execution, which you fix by writing static initializers that don't do work.

Numbers are illustrative — measure with `-Xlog:class+load=info:file=load.log:time:level,tags` plus a JFR profile for `<clinit>` execution time. Without measurement, you'll optimise the wrong thing.

---

## 2. AppCDS — the biggest single win (JEP 310, JEP 350)

Application Class Data Sharing caches the *parsed*, *verified*, *prepared* form of each `.class` file across JVM runs. Reading bytes from disk, verifying them, allocating Metaspace structures, building constant pools — all gone. The cache is the `.jsa` file, mmap'd into Metaspace at startup.

The Java 13+ "training" flow:

```
# 1. Record (does a real-ish run, captures classes loaded)
java -XX:ArchiveClassesAtExit=app.jsa -jar app.jar --smoke

# 2. Use
java -XX:SharedArchiveFile=app.jsa -jar app.jar
```

The training run can be the actual smoke test you already have. If your CI has an integration test that hits a few endpoints, that's perfect input — wrap it with the flag and you've built an archive.

What benefits and by how much:

- **Plain `main` Hello World:** ~50 ms saved (small absolute, but ~25%).
- **CLI tool with ~500 classes:** 200–400 ms saved.
- **Spring Boot REST service (~5000 classes):** 800 ms – 1.5 s saved.
- **Quarkus / Micronaut (already lean):** 100–300 ms saved (less, because they already avoided most of the work).

What CDS does not save:

- `<clinit>` execution time. The archive holds *loaded and linked* classes; the JVM still runs your static initializers.
- JIT warm-up. The archive is for the interpreter / cold path.
- Reflection-based proxy generation (Spring CGLIB, Hibernate). Those classes are generated at runtime; they aren't on disk, so CDS can't archive them. (See section 7 for AOT.)

**Container recipe.** Build the archive into the image:

```dockerfile
FROM eclipse-temurin:21-jdk AS train
WORKDIR /a
COPY app.jar .
RUN java -XX:ArchiveClassesAtExit=app.jsa -jar app.jar --train-and-exit

FROM eclipse-temurin:21-jre
COPY --from=train /a/app.jar /a/app.jsa /a/
ENTRYPOINT ["java", "-XX:SharedArchiveFile=/a/app.jsa", "-jar", "/a/app.jar"]
```

Bake once, run thousands of times. The archive is read-only and shared across container instances (the OS page cache caches the mmap).

---

## 3. The default CDS archive (JEP 341, JEP 388)

Since Java 12 the JDK ships with a precomputed CDS archive of its own classes. You don't have to do anything — `-Xlog:cds=info` will confirm:

```
[cds] Mapped class space at 0x800000000, size 1073741824
[cds] Loaded 1024 shared classes
```

JEP 388 (Java 15) extended this so the default archive covers the standard JDK class list across operating systems, with no per-JDK custom archive builds.

For most modern Java applications, **the JDK side is already optimised**. The remaining lever is the *application* side via JEP 310 / 350.

A surprise: turning off CDS deliberately makes a noticeable startup regression. Some operations teams disable it because they don't understand it, expecting a "safer" default. Don't.

```
java -Xshare:off ...                # turn it all off — your startup slows
java -Xshare:on  ...                # default; falls back gracefully if archive missing
java -Xshare:auto ...               # default in production JVMs
```

---

## 4. Lazy initialization — the Holder idiom

Static initializers run on first active use. If a class is *only* used in some code paths, its `<clinit>` shouldn't run for paths that don't need it.

**Wrong:** lifetime-of-app singleton built eagerly even for unrelated code paths:

```java
public final class Crypto {
    public static final KeyStore TRUSTSTORE = loadFromDisk();    // runs in <clinit>
    private static KeyStore loadFromDisk() { /* expensive */ }
}
```

Touching anything on `Crypto` runs `<clinit>` and pays the cost.

**Right:** Initialization-on-demand Holder:

```java
public final class Crypto {
    private Crypto() {}
    private static class Holder { static final KeyStore TRUSTSTORE = loadFromDisk(); }
    public static KeyStore trustStore() { return Holder.TRUSTSTORE; }
    private static KeyStore loadFromDisk() { /* expensive */ }
}
```

`Crypto`'s `<clinit>` is empty. `Holder`'s `<clinit>` runs only when `Crypto.trustStore()` is first called. Code paths that mention `Crypto` for unrelated reasons (e.g., logging its name) don't trigger the keystore load.

The JVM's per-class lock makes this thread-safe with zero application synchronization. No `volatile`, no `synchronized`, no double-checked locking.

---

## 5. Compile-time constants for cold-path elimination

A `static final` field of *primitive* type or `String`, initialized with a *constant expression*, is inlined by `javac` at every use site. Reading the field never triggers `<clinit>`:

```java
public final class Limits {
    public static final int MAX_RETRIES = 3;
    public static final String BASE_URL = "https://api.example.com";
    public static final long  TIMEOUT_MS = 30_000L;
}
```

Callers compiled against `Limits.MAX_RETRIES` carry the integer `3` in their own bytecode. Even deleting `Limits.class` after compilation does not break them. (Don't do this; the point is to understand the cost.)

Implications for cold start:

- A class that contains only compile-time constants pays *no* `<clinit>` cost at startup, because nothing ever triggers its initialization.
- Constants like `static final Pattern P = Pattern.compile("...");` look constant but aren't — `Pattern` is not in the constant-variable set, so `<clinit>` runs. If you have many such patterns and they're rarely used, push them behind Holders.

The class-data-sharing archive contains the constant pool, so compile-time constant *use* benefits from CDS even when the source class isn't loaded.

---

## 6. The cost of registries and static class lists

Code that drags in many classes during `<clinit>` is a startup tax for users who never need those classes.

```java
public final class SerializerRegistry {
    private static final Map<Class<?>, Serializer<?>> MAP = new HashMap<>();
    static {
        MAP.put(JsonNode.class,    new JsonSerializer());
        MAP.put(Document.class,    new XmlSerializer());
        MAP.put(ByteBuffer.class,  new ProtoSerializer());
        MAP.put(LocalDate.class,   new DateSerializer());
        MAP.put(BigDecimal.class,  new MoneySerializer());
        // ...30 more entries
    }
}
```

Touching `SerializerRegistry` once causes 30 implementations to load, link, and initialize, plus their key classes. Each of those classes may pull in more. Result: a developer reads a config file, the registry is mentioned, and a quarter of the application's class graph loads.

**Fix patterns:**

- **Lazy registration.** Each serializer registers itself when *first asked for*, not eagerly. `ServiceLoader` does this for free.
- **Class names instead of `Class<?>` references.** Hold strings; load on demand.
- **Split the registry.** Per-format registries that load only when their format is asked for.

```java
public final class SerializerRegistry {
    public Serializer<?> of(String formatName) {
        return switch (formatName) {
            case "json"  -> JsonSerializer.INSTANCE;     // Holder idiom internally
            case "xml"   -> XmlSerializer.INSTANCE;
            case "proto" -> ProtoSerializer.INSTANCE;
            default      -> throw new IllegalArgumentException(formatName);
        };
    }
}
```

The classes load only when their case branch executes.

---

## 7. AOT and GraalVM native image — eliminate classloading

At the extreme, classloading is *eliminated* from startup. GraalVM `native-image` compiles your application ahead of time into an OS executable. The "JVM" inside this binary is Substrate VM; it does no classloading at startup because every class is already there, statically baked in.

Numbers, for the same Spring Boot service:

| Mode                          | Cold start | RSS at first request |
|-------------------------------|------------|----------------------|
| Plain JVM                     | 4.0 s      | 350 MB               |
| JVM + AppCDS                  | 2.5 s      | 320 MB               |
| GraalVM native image          | 0.10 s     | 80 MB                |

The trade is significant:

- **No JIT.** Substrate VM uses precompiled code; long-running CPU-bound workloads underperform a warm JIT.
- **Reflection requires configuration.** Every class accessed reflectively must be declared in `reflect-config.json` at build time. Spring Boot's "native" support generates this for you; ad-hoc reflection in libraries can break.
- **Build time is long.** Native image builds take minutes; CI cost goes up.
- **Classloading at runtime is forbidden.** `Class.forName(...)` with a class not known at build time fails. `URLClassLoader` doesn't work the same way. Plugin systems that depend on dynamic loading don't work.

For "scale to zero" deployment models (AWS Lambda, Knative, Cloud Run), the 100 ms cold start is decisive — native image wins. For long-running services, the JIT's adaptive optimisations usually win — stay on the JVM and use AppCDS.

**JEP 483 (JDK 24)** introduces *Ahead-of-Time Class Loading & Linking* without sacrificing the JVM. It caches even more than CDS (the linked, partially-initialized state) and benefits any workload, not just AOT-compatible ones. Watch its GA status; it's the most interesting startup work the JVM has seen since CDS.

---

## 8. Measure, then optimise

Two tools you'll use, in order:

**`-Xlog:class+load=info:file=load.log:time:level,tags` (Java 9+, replaces `-verbose:class`)** emits one line per class load with a timestamp. Post-process to find:

- Classes loaded but never used (dead code).
- Long pauses between class loads (a `<clinit>` doing real work).
- Bursts of related classes loaded together (a registry that drags in everything at once).

```
[0.234s][info][class,load] org.springframework.beans.factory.support.DefaultListableBeanFactory
[0.241s][info][class,load] org.springframework.beans.factory.support.AbstractBeanFactory
[0.247s][info][class,load] org.springframework.beans.factory.support.AbstractAutowireCapableBeanFactory
```

Three classes in 13 ms — normal. A 200 ms gap between two lines means a `<clinit>` did something expensive.

**JFR for `<clinit>` time.** JDK Flight Recorder captures `jdk.ClassLoad` events. Open in JMC and filter for the slowest classes. The output gives you a leaderboard of "static initializers that took more than 10 ms" — the top of that list is what you fix.

```
public final class StartupProfiler {
    public static void main(String[] args) {
        // Pre-baked JFR-recording wrapper
    }
}
```

Run with `-XX:StartFlightRecording=filename=startup.jfr,duration=30s` and analyse afterwards.

---

## 9. Practical recipes

**Recipe 1: shave 500 ms off a Spring Boot cold start.**

1. Add AppCDS to the image build. Expect 600–900 ms reduction depending on app size.
2. Disable Spring Boot's eager `@Configuration` initialization for beans only used after readiness.
3. Wrap heavy `@Bean` methods in `@Lazy`.
4. Remove `static` registry classes that load implementations eagerly; switch to `ServiceLoader`.
5. Use `-XX:+UseSerialGC` for CLIs and tiny services (faster startup, equivalent throughput at low scale).

**Recipe 2: a CLI tool whose first run is annoying.**

A CLI loaded fresh on every invocation has *no* hot path at all — it is *all* cold. AppCDS helps; GraalVM native image helps more. For Java-based CLIs (`jbang`, custom tools), native image is almost always the right answer — 80–100 ms vs 1.5–2 s startup is the difference between "fast" and "I'll use the Go version."

**Recipe 3: a lambda function on a 100 ms cold-start budget.**

Native image plus AWS SnapStart-like checkpoints. AppCDS alone usually isn't enough.

**Recipe 4: a long-running service where JIT throughput matters.**

Stay on the JVM. Use AppCDS to minimise the unavoidable cold start. Don't reach for native image — you'd give up the JIT's adaptive optimisations for a one-time startup win.

---

## 10. Quick rules

- [ ] Measure cold start with `-Xlog:class+load` and JFR `<clinit>` events *before* optimising.
- [ ] Apply AppCDS first — biggest single win, no code changes.
- [ ] Use the Initialization-on-demand Holder idiom for lazy singletons.
- [ ] Make registries lazy — `ServiceLoader` or `switch`-on-name beats eager `static { MAP.put(...); }` blocks.
- [ ] Compile-time constants (primitive / `String`) cost zero `<clinit>`; use them for true constants.
- [ ] Never put expensive work — I/O, reflection, network, parsing — in `<clinit>`.
- [ ] For < 200 ms startup budgets (lambdas, CLIs), evaluate GraalVM native image.
- [ ] Watch JEP 483 for the next-generation JVM AOT story.

---

## 11. What's next

| Topic                                                       | File              |
|-------------------------------------------------------------|-------------------|
| Exercises (AppCDS, custom loader, leak)                     | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

Cross-references:

- [../02-jpms-modules/](../02-jpms-modules/) — `jlink` produces minimised runtimes that pair with CDS.
- [../../06-method-dispatch-and-internals/04-object-memory-layout/](../../06-method-dispatch-and-internals/04-object-memory-layout/) — Metaspace and `Class<?>` layout.

---

**Memorize this:** **AppCDS first** (free 25–40% cold start reduction, no code changes). **Holder idiom** for lazy singletons (zero synchronisation, JVM-provided thread safety). **No work in `<clinit>`** — push it to the composition root. **Compile-time constants** are free; non-primitive "constants" still trigger `<clinit>`. For sub-200ms cold-start budgets, **GraalVM native image** eliminates class loading at startup entirely. **JEP 483** is the JVM's answer for the long-running case.
