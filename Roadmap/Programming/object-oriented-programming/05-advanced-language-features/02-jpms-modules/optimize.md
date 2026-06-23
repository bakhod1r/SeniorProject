# JPMS — Optimize

> JPMS is a *design* feature first. But the module graph is also a powerful input to the JVM's optimization pipeline: smaller runtime images via `jlink`, faster startup via AppCDS keyed per module, AOT compilation that knows the closed module set, and reduced class-loader churn. This file walks ten optimization angles where modularised code can be made measurably faster, smaller, or cheaper to run. All numbers are illustrative; verify in your environment.

---

## 1. `jlink` image size — the headline win

A full JDK installation is typically 250–350 MB. Most apps use 5–10 of its modules. `jlink` (**JEP 282**) walks your module graph, picks exactly the JDK modules you transitively need, and writes a self-contained runtime image.

```
jdeps --print-module-deps --ignore-missing-deps app.jar
> java.base,java.logging,java.net.http,java.sql,java.management

jlink --module-path "$JAVA_HOME/jmods:libs" \
      --add-modules java.base,java.logging,java.net.http,java.sql,java.management,com.example.app \
      --launcher app=com.example.app/com.example.app.Main \
      --strip-debug --no-header-files --no-man-pages --compress=2 \
      --output dist/app
```

Typical results for a Spring Boot-equivalent microservice:

| Image                                                          | Size       |
|----------------------------------------------------------------|------------|
| Full Oracle/OpenJDK 21                                         | ~310 MB    |
| `jlink` with all JDK modules                                   | ~200 MB    |
| `jlink` with only required modules + `--compress=2`            | ~85 MB     |
| `jlink` + `--strip-debug` + `--no-man-pages` + `--no-header-files` | ~45 MB |
| Distroless container with the above image                      | ~50 MB total |

Three caveats:

- **No automatic modules.** `jlink` refuses to link an automatic module. Every JAR on the path must have a real `module-info.class`. This is the single largest reason to push library authors toward shipping modular JARs.
- **`--compress=2` trades startup for size.** Modules are stored compressed; the JIT decompresses on first touch. Most apps don't notice; ultra-latency-sensitive services should benchmark with and without.
- **Strip what you don't need.** `jconsole`, `keytool`, `jdeps` themselves are JDK tools that `jlink` *can* include. For production, omit them.

---

## 2. AppCDS keyed per module — startup-time wins

Class Data Sharing (CDS) and Application CDS (AppCDS) share class metadata across JVM instances. With a modular app, CDS can be even more targeted: each module's classes can be archived independently, with the boot layer already resolved at build time.

```
# Step 1: record a class list during a representative run
java -XX:DumpLoadedClassList=classes.txt --module-path mods -m com.example.app

# Step 2: build a CDS archive
java -Xshare:dump -XX:SharedClassListFile=classes.txt \
     -XX:SharedArchiveFile=app.jsa \
     --module-path mods -m com.example.app

# Step 3: run with the archive
java -XX:SharedArchiveFile=app.jsa --module-path mods -m com.example.app
```

Typical startup-time improvements for a modular app:

| Setup                           | Cold start | Hot start |
|---------------------------------|------------|-----------|
| Default JVM, no CDS             | 1500 ms    | 600 ms    |
| AppCDS, classlist captured      | 700 ms     | 300 ms    |
| `jlink` image + AppCDS archive  | 450 ms     | 220 ms    |

The dynamic-CDS feature (JEP 310, JEP 350) makes step 1+2 collapse to a single launch — the JVM records the class list and writes the archive on shutdown when you pass `-XX:ArchiveClassesAtExit=app.jsa`.

CDS knows about modules: the boot layer's module resolution is part of the archive. Cold-start savings stack with `jlink`'s smaller-image savings.

---

## 3. Module-aware AOT compilation

GraalVM's `native-image` and the OpenJDK AOT efforts (Project Leyden) both benefit from a *closed* module graph. The reason: AOT compilation wants to know every class that might be loaded; a JPMS-modular app *tells* it.

For native-image with a modular app:

```
native-image \
  --module-path mods \
  --module com.example.app/com.example.app.Main \
  -H:Name=app
```

What the closed module graph buys:

- **Reachability analysis is bounded.** Without modules, native-image scans the entire classpath. With modules, only the transitively required modules are scanned. Build times drop substantially.
- **Reflection metadata can be inferred from `opens`.** Packages that aren't `opens`d don't need reflection metadata; native-image can omit them.
- **Resource embedding is module-scoped.** `module/resource/x.txt` resolves to a specific module's `lib/modules` entry, not a classpath search.

A well-modularised app typically goes from a ~5 minute native-image build (classpath) to ~2 minutes (module path), with the resulting binary 20–40% smaller because dead modules are pruned.

---

## 4. Reduced runtime module graph at startup

The JVM resolves the module graph at boot. The cost is roughly linear in *graph size* — every module's `module-info.class` is parsed, every `requires`/`exports`/`opens` is recorded, the access tables are populated.

A graph of 600 modules (typical for a large Spring app on classpath, automatically converted to automatic modules) takes ~80–150 ms to resolve. A real modular graph of 20–40 modules resolves in 15–30 ms. The difference shows up on every JVM start — including in serverless cold-start latency.

How to keep the graph small:

- **Don't over-split.** A module per package is a 600-module graph waiting to happen.
- **Combine adapters.** If you have one Postgres adapter and one Kafka adapter, those can be one *infrastructure* module rather than two — unless they're versioned independently.
- **Avoid `requires` chains.** If A requires B requires C requires D, every consumer transitively loads D. Some chains are unavoidable; others are an artefact of "I added an interface module per layer".
- **Profile with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintFlagsFinal` plus `--show-module-resolution`** to see how long resolution takes and which modules came in.

---

## 5. Class-loader reduction

JPMS allows multiple modules to share a single class loader (the default for `ModuleLayer.defineModulesWithOneLoader`). This is dramatically faster than the classic *one classloader per module* pattern of OSGi-style systems:

- **Single loader** — one `Class<?>` resolution per name, one PerfData entry. Fast.
- **Loader-per-module** — each loader has its own bookkeeping, its own class cache, its own GC root chain. A 200-module app with loader-per-module can spend 20+ MB on loader overhead alone.

For 99% of apps, stick with `defineModulesWithOneLoader`. Use loader-per-module only when you genuinely need plugin isolation (e.g., tenant boundaries where two tenants might bring conflicting JAR versions).

---

## 6. Strong encapsulation and JIT optimization

Strong encapsulation tells the JIT something it couldn't know on the classpath: *no one outside this module is reaching into private state*. That changes which optimizations are safe:

- **Final-field treatment.** A `final` field on an *exported but not opened* class is genuinely final — no reflection can rewrite it. The JIT folds reads of such fields into compile-time constants more aggressively.
- **Devirtualization across module boundaries.** A `sealed` interface in an exported package has a known set of implementations (only those in its compilation unit and dependent modules). Combined with module-graph closure, the JIT can devirtualise the call site.
- **Escape-analysis trust.** A record exported but not opened can't escape via reflection. EA's "this never escapes" proof gets stronger.

These are micro-optimisations relative to algorithmic wins, but they accumulate. A `final`-fielded record in a strongly-encapsulated package is the friendliest shape the JIT will ever see.

---

## 7. `--strip-debug` and the cost of debug info

Modules carry `LineNumberTable` and `LocalVariableTable` attributes by default. Stripping them at `jlink` time reduces image size and slightly improves startup (less data to load and parse):

```
jlink ... --strip-debug --output dist/app
```

The trade is that production stack traces lose line numbers — `at com.example.Foo.bar(Foo.java)` instead of `at com.example.Foo.bar(Foo.java:42)`. For most production logs this is fine; for some you want to keep line numbers and only strip everything else:

```
# Less aggressive: keep line numbers, drop locals and sourcefile
jlink ... --strip-java-debug-attributes --output dist/app
```

(`--strip-java-debug-attributes` is the precise plug-in name; the older `--strip-debug` is more aggressive.)

A typical 45 MB image drops to ~38 MB with debug stripped. Container layers benefit proportionally.

---

## 8. Memory: smaller perm-equivalent and metaspace

JDK classes loaded by the platform/boot loader live in metaspace. A `jlink` image with fewer JDK modules loads fewer classes — and reserves less metaspace.

| Image                                  | Loaded classes at startup | Metaspace used |
|----------------------------------------|---------------------------|-----------------|
| Full JDK 21 + Spring Boot app          | ~14,000                   | ~120 MB         |
| `jlink` with only required JDK modules | ~6,500                    | ~55 MB          |
| Same + AppCDS                          | ~6,500 (shared)           | ~22 MB          |

For services running tens of small JVMs (microservices, serverless), the per-instance memory footprint is dominated by metaspace and class metadata. JPMS-driven trimming directly reduces this — often more than tuning `-Xmx`.

---

## 9. Cold-start at scale — combining the wins

A typical "max-optimised" modular service combines four levers:

```
# 1. jlink image with only the modules the app uses
jlink --module-path "$JAVA_HOME/jmods:libs" \
      --add-modules $(jdeps --print-module-deps app.jar),com.example.app \
      --strip-debug --no-man-pages --no-header-files --compress=2 \
      --output dist/runtime

# 2. AppCDS archive captured during a warm-up run
dist/runtime/bin/java -XX:ArchiveClassesAtExit=app.jsa \
      -m com.example.app/com.example.app.Main --warmup

# 3. Production launch with the archive
dist/runtime/bin/java -XX:SharedArchiveFile=app.jsa \
      -m com.example.app/com.example.app.Main
```

Cumulative results on a representative web service:

| Lever                                   | Image size | Cold start | Hot start | Metaspace |
|-----------------------------------------|-----------:|-----------:|----------:|----------:|
| Default JDK + classpath                 | 310 MB     | 1850 ms    | 700 ms    | 120 MB    |
| + jlink minimal modules                 |  85 MB     | 1100 ms    | 500 ms    |  55 MB    |
| + AppCDS                                |  85 MB     |  500 ms    | 280 ms    |  22 MB    |
| + `--strip-debug` and `--compress=2`    |  45 MB     |  520 ms    | 290 ms    |  22 MB    |

Cold-start drops by 3–4×; image size by 7×; metaspace by 5×. Combined with native-image for full AOT, cold-start of 50–150 ms is achievable.

---

## 10. When *not* to optimise

The JPMS optimisation toolkit pays for itself in three settings:

- **Serverless / FaaS** — cold-start dominates user-perceived latency.
- **Container-dense deployments** — image size and per-instance memory drive density.
- **Edge / IoT** — disk, memory, and bandwidth are constrained.

It does *not* pay for itself in:

- **Long-running batch jobs.** Startup is amortised over hours; image size doesn't matter; metaspace is dwarfed by heap.
- **Development environments.** A `jlink` image without dev tools cannot run profilers, debuggers, or `jcmd`. Keep a full JDK for dev.
- **Hot-reload scenarios.** `jlink` images are immutable; reload-driven workflows want the unrestricted JDK.

The decision matrix: optimise for production *runtime* characteristics, not for the dev loop. Build pipelines should produce both shapes — a full-JDK image for tests, a `jlink` image for prod.

---

## 11. Quick rules — measuring, not guessing

- [ ] **Profile first.** Use `--show-module-resolution` to see how long module resolution takes; only optimise if it's >5% of cold start.
- [ ] **`jlink` only if every dependency is a real named module.** Automatic modules are blockers — fix them first.
- [ ] **Use `jdeps --print-module-deps` to compute the minimum module set.** Don't add modules speculatively.
- [ ] **`-XX:ArchiveClassesAtExit` for one-step AppCDS.** Skip the two-step dump on Java 13+.
- [ ] **`--compress=2` is the right default for most apps.** Only skip if measured startup regresses.
- [ ] **`--strip-debug` only in production images.** Keep the dev image debuggable.
- [ ] **One class loader for the whole layer** unless you genuinely need plugin isolation.
- [ ] **Sealed types + module path = best devirtualisation conditions** the JIT will ever see.
- [ ] **Track image size in CI.** A regression of 10 MB usually means a new automatic module sneaked in.
- [ ] **Native-image is the next level**; modular code is a prerequisite. Get the module graph right first.

---

## 12. What's next

| Topic                                                                   | File              |
| ----------------------------------------------------------------------- | ----------------- |
| Plain-English first encounter with modules                              | [junior.md](junior.md)            |
| Practical refactors: classpath → modules, service loader, `jlink`       | [middle.md](middle.md)            |
| Strong encapsulation, frameworks, JEP 396 / 403, layers                 | [senior.md](senior.md)            |
| Library authoring, ArchUnit module rules, `--add-opens` policy          | [professional.md](professional.md)      |
| JLS / JVMS hooks, all the JEPs                                          | [specification.md](specification.md)     |
| Ten module-system bugs and their fixes                                  | [find-bug.md](find-bug.md)          |
| Hands-on exercises                                                      | [tasks.md](tasks.md)             |
| Interview Q&A on modules                                                | [interview.md](interview.md)         |

Related sections:

- Sibling: [../01-sealed-classes-and-pattern-matching/](../01-sealed-classes-and-pattern-matching/)
- Cohesion at the module level: [../../03-design-principles/04-cohesion-and-coupling/](../../03-design-principles/04-cohesion-and-coupling/)
- The roadmap's general modules section: [../../../../07-modules/](../../../../07-modules/)

---

**Memorize this:** modularise *first*; optimise *second*. With every JAR on the module path as a real named module, `jlink` shrinks images by 5–7×, AppCDS halves cold-start, native-image gets a 30–40% smaller binary. Strong encapsulation feeds the JIT better assumptions (final-field constancy, devirtualisation, EA). Don't `--compress` and `--strip-debug` blindly — measure each lever; track image size in CI. Optimisation is for production runtime characteristics; keep the dev image full.
