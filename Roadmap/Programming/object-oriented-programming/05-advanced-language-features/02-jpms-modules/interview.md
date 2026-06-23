# JPMS — Interview Q&A

20 questions on the Java Platform Module System: definitions, semantics of each directive, services, migration, `jlink`, JEPs 200 / 261 / 282 / 396 / 403, and senior-level judgement calls.

---

## Q1. What is JPMS and which JEP introduced it?

JPMS — the **Java Platform Module System** — is the Java language feature that introduces a *module* as a unit of code organisation above the package. A module groups packages, declares which it exposes, declares its dependencies on other modules, and may consume or provide services. JPMS was specified in **JEP 261** and shipped in Java 9. A companion effort, **JEP 200**, split the JDK itself into modules (`java.base`, `java.sql`, `java.xml`, etc.).

**Follow-up.** "Why did it ship?" To replace the JAR/classpath model where every `public` class was world-visible and "jar hell" was routine, with an explicit, enforceable boundary.

---

## Q2. What is `module-info.java` and where does it live?

It's a special compilation unit (the only one whose filename contains a hyphen by convention but is treated as `module-info`) located at the root of a module's source tree. It compiles to `module-info.class` and declares: the module's name, which other modules it `requires`, which packages it `exports` and `opens`, what services it `uses` and `provides`. The grammar is specified in **JLS §7.7**; the class-file representation in **JVMS §4.7.25** as the `Module` attribute.

```java
module com.example.shop {
    requires java.sql;
    exports com.example.shop.api;
}
```

---

## Q3. What's the difference between `exports` and `opens`?

`exports` makes a package visible to the *compile-time* type system: other modules can `import` `public` types from it. `opens` makes a package accessible to *runtime reflection*, including `setAccessible(true)` on private members. The two are independent: a package may be exported only (most public APIs), opened only (frameworks reflecting on private fields), both, or neither.

```java
exports com.example.shop.api;                          // compile-time
opens   com.example.shop.entity to org.hibernate.orm.core;  // reflection-only, qualified
```

**Trap.** Candidates often say "`opens` is just `exports` for reflection". It isn't — they're orthogonal dimensions, and consumers cannot `import` from an `opens`d-only package.

---

## Q4. Explain `requires`, `requires transitive`, and `requires static`.

- **`requires X;`** — compile-time **and** runtime read of module `X`. Plain dependency.
- **`requires transitive X;`** — same, **plus** any module that `requires` mine implicitly reads `X` too. Use when a type from `X` appears in your *exported* API signatures.
- **`requires static X;`** — compile-time only. `X` may be absent at runtime. Use for annotations (Lombok, JetBrains) or optional integrations.

The modifiers compose: `requires transitive static X;` is valid (compile-time re-export, optional at runtime).

---

## Q5. What is the module path and how does it differ from the classpath?

The **module path** (set via `--module-path` or `-p`) is the search path for *modules*. Each entry is a directory of modules or a single modular JAR. JARs without `module-info.class` placed on the module path become **automatic modules**.

The **classpath** still works for legacy code: JARs without `module-info.class` go on `--class-path` and end up in the **unnamed module**. The unnamed module reads every other module by default but cannot be `requires`d by any named module.

You may mix both: `java --module-path mods --class-path libs -m com.example.app/...`.

---

## Q6. What is an automatic module?

A JAR placed on the module path *without* a `module-info.class` becomes an automatic module. Its name is derived from the JAR's filename (or read from `Automatic-Module-Name` in the manifest, if the author set one). An automatic module:

- exports *every* package it contains (unqualified),
- reads *every* other module,
- can be `requires`d by named modules.

Automatic modules are a migration aid — they let you incrementally adopt JPMS while waiting for library authors to ship real `module-info.java`. They are **not** a long-term destination; production should avoid them where possible. `jlink` refuses to link an automatic module.

**Trap.** "Why is `jlink` refusing to build my image?" Almost always: an automatic module on the path.

---

## Q7. What is the unnamed module?

Every class loader has exactly one **unnamed module** (one per loader, distinct from "no module"). Classpath JARs and classes loaded from `--class-path` belong to their loader's unnamed module. The unnamed module reads *every* other module — including named ones — so classpath code can use modular libraries without changes. The reverse doesn't hold: a named module cannot `requires` the unnamed module by name.

This is what lets legacy classpath apps "just work" after JPMS shipped.

---

## Q8. Explain strong encapsulation. Why is it a runtime guarantee?

Strong encapsulation says: a `public` member of a class in a *non-exported, non-opened* package is **inaccessible** to code in any other module — and the JVM enforces this. `setAccessible(true)` throws `InaccessibleObjectException`. This is not a `SecurityManager` decision (now deprecated); it's the module system's own access check, performed during reflective access.

```java
// Module A:
package com.acme.secret;
public class Vault { public String value() { return "shh"; } }

// Module B:
Class<?> cls = Class.forName("com.acme.secret.Vault");   // succeeds
cls.getDeclaredConstructor().newInstance();              // throws InaccessibleObjectException
```

The architectural consequence: a library can publish an exported, non-opened type with private internals that are *genuinely* private — not even reflection can break in.

---

## Q9. What changed in JEP 396 and JEP 403?

JEP 396 (**Java 16**) flipped the default `--illegal-access` flag from `permit` to `deny`. Legacy reflective access to JDK internals that printed a warning in Java 11 now throws `InaccessibleObjectException` in Java 16.

JEP 403 (**Java 17**) removed `--illegal-access` entirely. There's no per-launch toggle anymore. Every reflective access to a non-opened JDK internal must be explicitly authorised via `--add-opens` at launch time.

The strategic implication: every `--add-opens` your launch script needs is a tracked debt — usually attributable to a third-party library that hasn't caught up. Track them, file upstream issues, watch them shrink.

---

## Q10. How does `ServiceLoader` work with modules?

In a *named* module:
- The consumer declares `uses S;` in its `module-info.java`.
- One or more provider modules declare `provides S with Impl;`.
- `ServiceLoader.load(S.class)` iterates over discovered providers.

Without the consumer's `uses` declaration, `ServiceLoader.load` returns an **empty iterator silently** — one of the classic JPMS bugs.

In the unnamed module (classpath), the legacy `META-INF/services/<service-type>` files are used. Modular and classpath-style providers can coexist.

```java
// Consumer
module com.example.app { requires com.example.payments.api; uses com.example.payments.api.Gateway; }
// Provider
module com.example.stripe { requires com.example.payments.api;
                            provides com.example.payments.api.Gateway with com.example.stripe.StripeGateway; }
```

---

## Q11. Critique this `module-info.java`:

```java
module com.example.shop {
    requires transitive com.fasterxml.jackson.databind;
    requires transitive org.slf4j;
    exports com.example.shop.api;
    exports com.example.shop.internal;
    opens   com.example.shop;
}
```

Four issues. **One**, `requires transitive` on Jackson and SLF4J leaks implementation choices into every consumer — they now have to upgrade Jackson when you do. Use plain `requires` unless types from those modules appear in your *exported* API signatures. **Two**, exporting `com.example.shop.internal` defeats the purpose of "internal" — the package name is a comment; the directive is the truth. **Three**, the unqualified `opens com.example.shop;` opens every member of the package to deep reflection from *any* module — usually too broad. Qualify it (`opens X to <framework-module>`) or remove. **Four**, no `uses`/`provides` despite the API package likely defining service interfaces — verify if the consumers expect `ServiceLoader` discovery.

---

## Q12. When should `requires transitive` be used?

When a *type from another module* appears in your *exported API's signatures*. If you expose `LedgerService.balance() : Money` and `Money` comes from `com.example.money`, your consumers need to see `Money` to use your API — so you re-export it via `requires transitive com.example.money;`. Otherwise, plain `requires` keeps the dependency private (and lets you upgrade or replace it without breaking consumers).

A useful concrete: `java.sql` `requires transitive java.logging` because `java.sql.DriverManager` returns/uses `Logger`. Consumers of `java.sql` inherit `java.logging` automatically.

**Trap.** Sprinkling `transitive` "to be safe" is the pattern most likely to cause downstream compile breakages on every release.

---

## Q13. How does JPMS interact with Spring, Hibernate, and Lombok?

- **Spring** (constructor injection) works without any `opens` — it uses public constructors of public classes in exported packages. Field injection and `@ConfigurationProperties` need `opens X to spring.core` because Spring reflectively sets private fields.
- **Hibernate** creates proxy subclasses and uses `setAccessible(true)` on entity fields. Needs `opens com.example.shop.entity to org.hibernate.orm.core;`.
- **Lombok** runs at compile time only. Declare it `requires static lombok;` — no runtime requirement, no `opens` needed.

The pattern: framework that *reflects* needs `opens` qualified to its module; framework that runs at compile time only needs `requires static`.

---

## Q14. Explain `jlink` and what it gives you.

`jlink` (**JEP 282**, Java 9) reads your modules from the module path and produces a self-contained runtime image: a directory containing a JVM compiled with exactly the JDK modules your app transitively needs, plus your modules, plus an optional launcher. No JDK install needed on the deployment host.

Typical wins for a small microservice:
- Image size 250–300 MB → 40–60 MB.
- Cold start 1500 ms → 500 ms (with AppCDS layered on top).
- Metaspace 120 MB → 22 MB.

`jlink` requires **every** module on the path to be a real named module — automatic modules are blockers. This is why library authors should ship `module-info.java` (not just `Automatic-Module-Name`).

---

## Q15. What's the difference between an exported package and an opened package, in one diagram?

|                   | `imports` work? | `setAccessible(true)` works? |
|-------------------|-----------------|-------------------------------|
| (neither)         | No              | No                            |
| `exports`         | Yes             | No (private members locked)   |
| `opens`           | No              | Yes (including private)       |
| `exports` + `opens` | Yes           | Yes                           |

`exports` is for the compiler; `opens` is for the runtime reflection system. Most public APIs are exports-only. Frameworks that reflect on private state need opens (typically qualified to the framework module).

---

## Q16. What is a split package and why is it forbidden?

A **split package** is the same Java package exported (or contained) by more than one module in the same module layer. JPMS refuses to start a layer that contains a split:

```
LayerInstantiationException: Package com.example.utils in both modules A and B
```

Splitting breaks the module system's invariant that each package has a single defining module. There's no `--allow-split-package` flag. Resolutions: rename one half, merge the two modules, or place them in separate `ModuleLayer`s (advanced; only justified for plugin/tenancy).

Splits used to be common with `javax.xml.bind` vs `jakarta.xml.bind`; the Jakarta EE migration to new packages was largely about fixing this.

---

## Q17. How do you migrate a large classpath app to JPMS?

Strangler-fig, not big-bang:

1. Run the app *as is* on Java 17, classpath only, verify it still works (JPMS doesn't break classpath apps that don't reflect into JDK internals).
2. Pick a leaf library — something with a clean API boundary and few dependents. Modularise it: add `module-info.java`, put it on `--module-path`, leave the rest on classpath.
3. Repeat outward: each newly modularised piece consumes already-modular ones. ArchUnit rules guard the new boundary.
4. Where the app reaches `Class.forName` on a class name, refactor to `ServiceLoader` (declare `uses`/`provides`).
5. Modularise the entry point last. When everything is on the module path, run `jlink` and measure.

Typical pace: one module per sprint for a mid-size project. The success metric is the count of classpath JARs trending toward zero.

---

## Q18. What is a `ModuleLayer` and when would you use one?

A **module layer** is a set of resolved modules sharing a class-loader scheme. The JVM starts with the **boot layer**; you can define additional layers programmatically via `ModuleLayer.defineModulesWithOneLoader(...)`. Layers are how JPMS supports:

- **Plugin systems** — load and unload plugins with their own dependency closures.
- **Multi-tenant isolation** — each tenant gets its own layer with its own customisations.
- **Hot-reload during development** — discard a layer when classes change.

Cost: each layer has its own class loaders; cross-layer references can leak, preventing GC. Use only when you genuinely need plugin/tenancy semantics; a normal `--module-path` is simpler and faster.

---

## Q19. When would you *not* use JPMS?

Three honest cases:

- **Tiny projects.** A 200-line CLI tool needs neither modules nor `jlink`. The ceremony exceeds the benefit.
- **Heavy dependency on a non-modular ecosystem.** Some legacy frameworks reflect into JDK internals; you'd accumulate `--add-opens` debt. Stay on classpath until the upstream catches up.
- **Hot-reload development workflows.** `jlink` images are immutable; reload-driven IDEs work better against a full JDK. Modularise for production; keep dev unrestricted.

JPMS pays off most for **libraries** (real boundaries, stable API contract, smaller consumer images) and **microservices** (small `jlink` images, fast cold start).

---

## Q20. What's the relationship between JPMS, OSGi, and Jigsaw?

- **Jigsaw** was the OpenJDK project (started ~2008) that designed and built JPMS. It shipped in Java 9 as JEP 261.
- **OSGi** is an older modular system (~2000) that predates JPMS and runs *on top of* the standard classpath via a container (Equinox, Felix). OSGi has stronger versioning support (multiple versions of the same module coexist) and dynamic lifecycle (start/stop bundles at runtime).
- **JPMS** has weaker dynamic support (no hot replace, no per-module versioning) but is built into the JVM — no container, no extra runtime.

Pragmatically: greenfield Java code uses JPMS; existing OSGi codebases stay on OSGi; new projects rarely adopt OSGi. JPMS is "good enough" for the 95% case and ships with the JDK.

**Follow-up.** "Could JPMS replace OSGi?" Not yet — OSGi's dynamic lifecycle and version multiplicity remain unique. For static deployments, JPMS wins on simplicity.

---

**Use this list:** rotate one question per area — definitions (Q1, Q2), keyword semantics (Q3, Q4, Q10), services (Q10, Q11), migration (Q17), JEP timeline (Q9, Q14), and judgement (Q12, Q19). Strong candidates can name the keyword that fixes a smell, recite the JEP numbers, and articulate when they would *not* modularise. The module graph is a long-lived contract; interviewees who understand that — not just the syntax — are who you want.
