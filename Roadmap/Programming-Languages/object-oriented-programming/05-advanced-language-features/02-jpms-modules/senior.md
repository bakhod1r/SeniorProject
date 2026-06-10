# JPMS — Java Platform Module System — Senior

> **What?** The senior view of JPMS: strong encapsulation as a runtime guarantee, the framework compatibility wars (Spring, Hibernate, Lombok, Mockito), the Java 16/17 tightening (**JEP 396**, **JEP 403**), `jlink` and AppCDS at scale, multi-module test strategy, binary compatibility of module APIs, and layered class loaders.
> **How?** By treating the module system as *one more dimension* in the design — alongside packages, classes, and protection modifiers — and weighing each declaration as a long-lived API contract. Modules are versioned interfaces; once `exports`, always `exports` (without breakage).

---

## 1. Strong encapsulation is a runtime guarantee, not a compile-time hint

The single most important sentence in JPMS:

> A `public` member of a class in a non-exported (or non-opened) package is **inaccessible** to code outside the module — even via `setAccessible(true)`.

`setAccessible(true)` succeeds at the API level on a member of an exported-and-opened package; it throws `InaccessibleObjectException` on a non-opened package. This is not a `SecurityManager` decision (the `SecurityManager` is deprecated for removal); it is the module system's own access check, performed by the JVM during reflective access.

```java
// Module A: not opened
package com.acme.secret;
public class Vault {
    public String value() { return "shh"; }
}

// Module B, somewhere else:
Class<?> cls = Class.forName("com.acme.secret.Vault");   // succeeds — class loading
Object v = cls.getDeclaredConstructor().newInstance();   // throws InaccessibleObjectException
// "Unable to make ... accessible: module com.acme does not 'opens com.acme.secret' to module com.beta"
```

Three architectural consequences:

- **You can rely on `internal` being internal.** Code in another module cannot tunnel into your private fields, your unexported types, or your package-private classes.
- **Frameworks must declare themselves.** Spring, Hibernate, Jackson cannot magic-access an entity's private fields unless your module `opens` the package to *their* module. The boundary is two-way.
- **A library can publish stable invariants.** An exported `record` with private internals is genuinely immutable from outside — `setAccessible(true)` is not a tool to break it.

The flip side is that *legacy* code that depended on reflection-via-setAccessible-anywhere broke. The JDK accommodated this with `--add-opens` and the now-removed `--illegal-access` flag — temporary escape hatches, see §3.

---

## 2. Why `opens` and `exports` are *independent* dimensions

A common bug: declaring `opens` and assuming consumers can also `import` from that package. They cannot.

| Modifier        | Compile-time `import` works? | Reflective access works? |
|-----------------|------------------------------|---------------------------|
| (neither)       | No                           | No                        |
| `exports`       | Yes                          | No (only "shallow" access, no `setAccessible` on private members) |
| `opens`         | No                           | Yes (deep, including private members)                              |
| `exports` + `opens` | Yes                      | Yes                                                                |

The two dimensions answer different questions:

- **`exports`** — "is this package part of the *language-level* API?" Compile-time imports, public members visible.
- **`opens`** — "is this package available to *runtime reflection*?" `getDeclaredField`, `setAccessible(true)`, `Method.invoke` on private methods.

Hibernate needs `opens` (to set private fields of entities), not `exports` (you don't want consumers calling `new Order().setSecretField`). Jackson needs `opens` to read private fields during deserialisation. Spring needs `opens` to inject into private fields (constructor injection avoids the requirement, see §4).

```java
module com.example.shop.domain {
    exports com.example.shop.domain.api;
    opens   com.example.shop.domain.entity to
            org.hibernate.orm.core,
            com.fasterxml.jackson.databind;
}
```

The `api` package is real API; the `entity` package is shielded from the type system but reachable by exactly two named frameworks.

---

## 3. The JEP 396 / 403 tightening

Java 9 shipped JPMS with a relaxation knob: the `--illegal-access` flag. By default (`--illegal-access=permit`), JDK *internals* like `sun.misc.Unsafe` and `com.sun.crypto.*` were reflectively accessible from any module with only a warning printed to stderr. This kept Java 9 from breaking ~80% of the ecosystem on day one.

- **Java 9–15:** `--illegal-access=permit` (default). Reflective access to JDK internals works with a warning.
- **Java 16 (JEP 396):** the default flipped to `--illegal-access=deny`. Reflective access to JDK internals **fails** unless explicitly opened via `--add-opens`. You can still pass `--illegal-access=permit` to restore the old behaviour.
- **Java 17 (JEP 403):** `--illegal-access` is **removed**. The only way to break encapsulation of JDK internals is `--add-opens` at startup, listed explicitly.

```
# Java 17 — no implicit access, must be declared:
java --add-opens java.base/java.lang=ALL-UNNAMED \
     --add-opens java.base/java.util=com.example.legacy \
     -jar app.jar
```

This is why a perfectly working Java 8 codebase often fails on Java 17 with `InaccessibleObjectException`. The runtime hasn't changed its mind about the access; the *default policy* has tightened. The fix is mechanical (add `--add-opens` lines) and *visible* — the legacy reflection is now in the command line, where ops can audit it.

The strategic implication: every `--add-opens` your app needs is a debt marker. Most of them belong to libraries you don't own; track them, file upstream issues, and watch them shrink to zero over major releases.

---

## 4. Framework compatibility — Spring, Hibernate, Lombok, Mockito

### Spring Framework

Constructor injection works *without* `opens` — Spring uses public constructors of beans in your exported packages. The trouble starts with:

- **Field injection** (`@Autowired` on a private field) — needs `opens` for Spring to write the field. Constructor injection avoids this.
- **AOP proxies** of non-public classes — needs the package opened to `spring-core`.
- **`@ConfigurationProperties`** — uses setter or field access, which is reflective.

Spring Boot 3+ ships with `module-info`-ready behaviour; you typically need one `opens` per package that has injected fields:

```java
module com.example.shop {
    requires spring.context;
    requires spring.beans;
    exports com.example.shop.api;
    opens   com.example.shop.config to spring.core;
}
```

### Hibernate / JPA

Hibernate creates proxy subclasses of your `@Entity` classes (lazy loading), and uses `Field.setAccessible(true)` to set private fields on entities. It needs:

```java
module com.example.shop {
    requires java.persistence;
    requires org.hibernate.orm.core;
    opens com.example.shop.entity to org.hibernate.orm.core;
}
```

If you forget the `opens`, you get a crisp `InaccessibleObjectException` at the first entity load — much better than the silent `null` you used to get.

### Lombok

Lombok runs at compile time as an annotation processor. It does not need *runtime* access — it generates `.class` files. Your module declares the dependency as `requires static`:

```java
module com.example.shop {
    requires static lombok;
    // ... no `opens` needed for Lombok
}
```

### Mockito and other test frameworks

Mockito 4+ supports the module system; Mockito 5 is module-aware. Older versions sometimes need `--add-opens java.base/java.lang=ALL-UNNAMED` to mock things deep in the JDK. Use the inline mock-maker (`mockito-inline`) which works with sealed/`final` types without breaking encapsulation in production code.

---

## 5. `jlink` runtime images at scale

`jlink` (**JEP 282**) produces a self-contained runtime image. The senior version of this tooling involves:

- **Per-environment images.** Build a small image for production (no `jdk.compiler`, no `java.desktop`), and a larger one for dev (includes `jdk.jdi`, `jdk.jconsole`, `jdk.jcmd`). Don't ship the dev image to production.
- **`jdeps` to compute the module closure.** `jdeps --print-module-deps` walks your bytecode and tells you the minimum set of JDK modules needed.

```
jdeps --print-module-deps --ignore-missing-deps app.jar
> java.base,java.logging,java.net.http,java.sql
```

```
jlink --module-path "$JAVA_HOME/jmods:libs" \
      --add-modules java.base,java.logging,java.net.http,java.sql,com.example.app \
      --output dist/app
```

- **`--strip-debug` and `--compress=2`.** Strip line tables and compress modules. A typical microservice goes from 200 MB (full JDK) to 45 MB. With CDS-friendly compression and a thin app, 30 MB is reachable.
- **`--launcher` for a stable entry point.** `--launcher app=com.example.app/com.example.app.Main` writes `bin/app` so users run `./bin/app` rather than `./bin/java -m ...`.
- **`--strip-native-commands` for container images.** Don't ship `jconsole` and `keytool` to production.

### Native image vs jlink

`jlink` and GraalVM native-image are different products. `jlink` produces a *JVM-with-fewer-modules*; native-image AOT-compiles the bytecode to a single binary. JPMS makes both easier: a narrow module graph is exactly the input both tools want. If you can `jlink` cleanly, your project is in much better shape to native-image later.

---

## 6. Multi-module testing strategy

Tests need access to module internals — that's the whole point. Three patterns:

### Test in the same module (patch module)

Most build tools default to this. Test sources at `src/test/java` are compiled and run as if they were part of the production module, via `--patch-module`. Tests can call package-private methods of the module without any extra `opens`.

```
javac --patch-module com.example.shop=src/test/java/com/example/shop \
      -d test-classes ...
java --patch-module com.example.shop=test-classes \
     --add-modules ALL-MODULE-PATH \
     -m com.example.shop/com.example.shop.MyTest
```

Maven and Gradle handle this automatically with `maven-surefire-plugin` 3+ and Gradle 6.4+.

### Black-box test from a separate module

For integration / contract tests that should only see the public API, a separate test module:

```java
module com.example.shop.tests {
    requires com.example.shop.api;
    requires org.junit.jupiter.api;
    // Cannot import com.example.shop.internal — exactly as production callers can't.
}
```

Use this when you want the test to prove that the public API is *sufficient* and that internals can change without breaking consumers.

### Open testing for framework interaction

If a test needs deep reflective access (e.g., to verify a Hibernate mapping), open the package to the test framework module, or use `--add-opens` only in the test JVM:

```
mvn test -Dargline="--add-opens com.example.shop/com.example.shop.entity=ALL-UNNAMED"
```

Reserve this for tests; never bake `ALL-UNNAMED` opens into production launches.

---

## 7. Binary compatibility of a module API

A module's `exports` clause is a public commitment. Once you `exports com.example.shop.api`, downstream consumers compile against it. Changing the API later means binary compatibility rules — same as for any Java API, plus the module system adds three of its own:

- **Removing a package from `exports`** is a *breaking* change. Consumers stop compiling.
- **Adding a package to `exports`** is *not* breaking. Old consumers don't care; new ones see the new surface.
- **Removing `requires transitive Y;`** is breaking. Consumers that relied on the implicit `Y` re-export now have to add their own `requires Y`.
- **Adding `requires transitive Y;`** is *not* breaking, *unless* a package in `Y` conflicts with a package elsewhere on the consumer's module path (split package).
- **Renaming the module** is breaking. Module names are part of the deployment contract; treat them as semver-stable identifiers.

A senior practice: lock your module name and exported packages in a CI gate. The simplest implementation is a saved file `module-api.txt` (output of `jdeps --api-only`) compared against the freshly built one on each PR. Diff = needs human sign-off.

---

## 8. Layered class loaders and `ModuleLayer`

The classic Java class-loader hierarchy (bootstrap → platform → app) is still there, but JPMS introduces **module layers**: a layer is a set of resolved modules sharing a class loader scheme. The boot layer is what the JVM starts with; you can create additional layers programmatically.

```java
ModuleFinder finder = ModuleFinder.of(Path.of("plugins"));
ModuleLayer parent  = ModuleLayer.boot();
Configuration cfg   = parent.configuration().resolve(
    finder, ModuleFinder.of(), Set.of("com.example.plugin.audit"));
ModuleLayer plugin  = parent.defineModulesWithOneLoader(cfg, ClassLoader.getSystemClassLoader());
```

After this, the app's `ServiceLoader.load(Plugin.class, plugin)` sees the audit plugin's `provides`. Use cases for additional layers:

- **Plugin systems** — load and unload plugins without restart, with their own dependency closures.
- **Multi-tenant isolation** — each tenant gets a layer with its own customisations.
- **Hot-reload during development** — a new layer compiled per change, the old one GC'd when all references die.

Layers cost discipline: cross-layer references can leak loaders, preventing GC and producing classic *classloader leak* OOMs. Use them when you genuinely need plugin/tenancy semantics; don't reach for them when a normal module path will do.

---

## 9. Architecture-level use — hexagonal at the module boundary

Class-level DIP (constructor injection) is well understood. Module-level DIP is the version that scales. In a hexagonal layout the *domain* is one module, with its ports exposed; *adapters* are separate modules that `requires` the domain and `provides` implementations:

```java
module com.example.shop.domain {
    exports com.example.shop.domain.api;
    uses    com.example.shop.domain.api.OrderRepository;   // resolved via ServiceLoader
}

module com.example.shop.adapter.postgres {
    requires com.example.shop.domain;
    requires java.sql;
    provides com.example.shop.domain.api.OrderRepository
        with com.example.shop.adapter.postgres.PgOrderRepo;
}

module com.example.shop.app {
    requires com.example.shop.domain;
    requires com.example.shop.adapter.postgres;
}
```

The domain module *does not name* Postgres, JDBC, or any vendor. The dependency arrow at compile time goes *from the adapter to the domain*, not the reverse — DIP at the deployment level.

Swap Postgres for DynamoDB: write `com.example.shop.adapter.dynamodb`, point the launch at a different module path, the domain module is byte-identical.

A related read: [../../03-design-principles/04-cohesion-and-coupling/](../../03-design-principles/04-cohesion-and-coupling/) — the same forces operate at class and module level. JPMS gives them teeth.

---

## 10. Common senior anti-patterns

**Mega-module.** A single module exporting twenty packages and `requires`-ing thirty others. The graph collapses to one node; you've gained nothing over the classpath. Split along change-axis lines.

**`opens` to ALL-UNNAMED for one framework.** Opens to the entire unnamed module just to satisfy Hibernate. The result: any classpath JAR can also reflect into your internals. Always qualify: `opens X to org.hibernate.orm.core;`.

**Re-exports of every dependency.** Putting `requires transitive` on everything because it "works". You leak every internal version choice to your consumers; an upgrade in your adapter changes every downstream classpath.

**Automatic modules in production.** "We'll add `module-info.java` later." A year later, the automatic module's filename-derived name has changed (because someone shaded the JAR), and your consumers' `requires` no longer resolves. Treat automatic modules as a migration step with a sunset date.

**`--add-opens` proliferation in `JAVA_OPTS`.** Each `--add-opens` is a SOLID-style boundary violation. If your launch script lists ten, that's ten places where you've accepted "the library reaches into a JDK internal". File upstream bugs; pin the version that fixes them.

**Modules without exports.** A module with `requires` but no `exports` is a *terminal* module — only useful as an app entry point. It compiles fine, but if you intended it as a library, nobody can use it.

---

## 11. Quick rules

- [ ] `exports` and `opens` are independent. Pick the right one for each consumer's *actual* need.
- [ ] After Java 17, every `--add-opens` is a documented debt — track them down.
- [ ] Constructor injection (Spring, Guice) removes most `opens` requirements; field injection forces them.
- [ ] `jlink` images need every dependency on the module path to be a *real* named module — finish modularising before chasing image size.
- [ ] Test as a patch module by default; use a separate test module when you want black-box discipline.
- [ ] `requires transitive` is part of your API surface; remove and rename with the same care as a public method.
- [ ] Module layers are for plugin / tenancy systems, not for shaving startup time.
- [ ] Architecture-level DIP via modules: domain owns the ports, adapters `provides`, app composes.
- [ ] Audit your graph every quarter with `jdeps`. Sealed boundaries decay quickly without it.

---

## 12. What's next

| Topic                                                                   | File              |
| ----------------------------------------------------------------------- | ----------------- |
| Library authoring, ArchUnit module rules, `--add-opens` policy          | [professional.md](professional.md)      |
| Where JPMS lives in the JLS / JVMS, the relevant JEPs                   | [specification.md](specification.md)     |
| Ten module-system bugs and their fixes                                  | [find-bug.md](find-bug.md)          |
| jlink images, AppCDS per module, startup gains                          | [optimize.md](optimize.md)          |
| Hands-on exercises                                                      | [tasks.md](tasks.md)             |
| Interview Q&A on modules                                                | [interview.md](interview.md)         |

Related sections:

- Sibling: [../01-sealed-classes-and-pattern-matching/](../01-sealed-classes-and-pattern-matching/)
- Cohesion at the module level: [../../03-design-principles/04-cohesion-and-coupling/](../../03-design-principles/04-cohesion-and-coupling/)
- The roadmap's general modules section: [../../../../07-modules/](../../../../07-modules/)

---

**Memorize this:** JPMS gives you *runtime-enforced* encapsulation. `exports` is for the compile-time API; `opens` is for runtime reflection; both are *named* commitments to specific consumer modules. Spring, Hibernate, Jackson need `opens` (to the framework module, never to ALL-UNNAMED). Java 17 removed `--illegal-access`; every legacy `--add-opens` is a tracked debt. Architecture-level DIP runs through `uses` / `provides` and the `ServiceLoader`. The module graph is part of your public API — `jdeps` it on every release.
