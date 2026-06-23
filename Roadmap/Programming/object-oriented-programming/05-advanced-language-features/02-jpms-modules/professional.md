# JPMS — Java Platform Module System — Professional

> **What?** The code-review vocabulary, the static-analysis you wire into CI, the mentoring conversations around `--add-opens`, the library-author discipline that ships *well-modularised* JARs, and the strangler-fig pattern for migrating legacy classpath applications onto JPMS.
> **How?** Treat the module graph as *infrastructure*: it has owners, a CI gate, deprecation cycles, and a checklist. The job is to make the graph stable enough that juniors don't accidentally undo it.

---

## 1. Code-review vocabulary — name the keyword

Module reviews are short when you say the right word. Five sentences cover most of them:

> **"This `requires transitive` leaks an implementation choice."** When a `requires transitive` adds a non-API dependency to consumers' module graph. Make it plain `requires` unless the type is actually in your exported signatures.

> **"This `exports` should be qualified."** When an export targets one known consumer module (a friend-package). Use `exports X to Y` so the rest of the world can't import.

> **"This `opens` should be qualified."** When a package is opened to `ALL-UNNAMED` (or unqualified). Restrict to the framework module that needs it.

> **"This module is missing `uses`."** When you see `ServiceLoader.load(X.class)` in code but no `uses X;` in the `module-info.java`. The loader returns empty silently — file the line.

> **"This is an automatic module — let's plan to fix it."** When a `requires` resolves to an automatic module name. Add an issue with a deadline; auto-module names are not stable.

Each comment names exactly one keyword and proposes the smallest change. That's the shape of useful module-review feedback.

```java
// PR diff:
module com.example.payments {
    requires transitive com.fasterxml.jackson.databind;   // ← reviewer flags this
    exports com.example.payments.api;
    opens   com.example.payments.entity;                  // ← reviewer flags this too
}
```

> **Reviewer:** Two notes. (1) `requires transitive jackson.databind` leaks Jackson into every consumer — they now have to upgrade Jackson when we do. Drop the `transitive` unless our API returns Jackson types. (2) The unqualified `opens com.example.payments.entity` exposes every entity field to every classpath JAR. Restrict to `opens … to org.hibernate.orm.core, com.fasterxml.jackson.databind`.

---

## 2. ArchUnit module rules — let CI enforce the boundary

ArchUnit can verify the module graph as a test:

```java
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

@AnalyzeClasses(packages = "com.example.shop")
class ModuleArchTest {

    @ArchTest
    static final ArchRule domain_does_not_depend_on_infrastructure =
        noClasses().that().resideInAPackage("com.example.shop.domain..")
                   .should().dependOnClassesThat()
                   .resideInAnyPackage(
                       "com.example.shop.adapter..",
                       "com.example.shop.web..");

    @ArchTest
    static final ArchRule internal_packages_not_used_across_modules =
        noClasses().that().resideOutsideOfPackage("com.example.shop.payments..")
                   .should().dependOnClassesThat()
                   .resideInAPackage("com.example.shop.payments.internal..");

    @ArchTest
    static final ArchRule adapters_implement_a_port =
        classes().that().resideInAPackage("com.example.shop.adapter..")
                 .and().areTopLevelClasses()
                 .should().beAssignableTo(
                     com.example.shop.domain.api.OrderRepository.class
                         .getInterfaces().getClass());
}
```

ArchUnit catches the architectural shape of the module graph. The bytecode-level checks complement the `javac` module check: `javac` knows what you `requires` and `exports`; ArchUnit knows what you *actually use* across package boundaries. Both fire in CI.

A senior practice: any new module gets an ArchUnit rule pinning its inbound dependencies. The rule's *failure* is the conversation — "do we really want this new edge in the module graph?"

---

## 3. The `--add-opens` policy — make the debt visible

`--add-opens` is the runtime escape hatch for libraries that need reflective access the module graph doesn't grant. Each `--add-opens` is a tracked debt. A reasonable team policy:

1. **`--add-opens` lives in one place.** A `JAVA_OPTS_OPENS` env var or a single config file, never sprinkled across launch scripts.
2. **Each line carries a comment.** The library that needs it, the upstream issue link, and a deadline. If there's no upstream issue, file one.
3. **CI fails when the count goes up.** Add a check that counts lines in the opens file; PRs that increase the count without a linked ticket are blocked.
4. **Audit per release.** When you upgrade a library, re-run without its opens lines. If it still works, delete them.

```
# JAVA_OPTS_OPENS — every line is a tracked debt
# https://github.com/X/X/issues/123 — pinned X 5.7.1, fixed in 5.8 (target Q3)
--add-opens java.base/java.lang=org.apache.commons.lang3

# https://github.com/Y/Y/issues/456 — Y has no module-info yet
--add-opens java.base/java.util=ALL-UNNAMED
```

A few patterns that disqualify `--add-opens`:

- **App code reaching into JDK internals.** `--add-opens java.base/sun.nio=…` for your own code is a smell, not a workaround. Find the supported API.
- **Reflective frameworks against your own modules.** If Spring needs `opens com.example.shop.config to spring.core`, that goes in your `module-info.java`, not in `--add-opens` on the command line.
- **Test-only opens shipped to prod.** Mockito sometimes needs `--add-opens java.base/java.lang=ALL-UNNAMED`. That belongs in test JVM args, not in your prod launcher.

---

## 4. Mentoring without dogma

A junior who has just learned JPMS will do three things, in order:

1. Add `module-info.java` to every JAR in the repo, including throwaway scripts.
2. Set every `requires` to `requires transitive` "to be safe".
3. Open every package "in case a framework needs it".

The mentor's move is to anchor each move to a *concrete pain* the junior has felt.

> **Mentor:** Remember when we accidentally upgraded Jackson and the auth-service compile broke because we exposed a Jackson type in our API? That's why `requires transitive` is dangerous — the package across the wire feels our internals. Make it plain `requires`; if a consumer needs Jackson, they say so themselves.

> **Junior:** Should we `opens` every package so Spring doesn't break?
> **Mentor:** Only the packages Spring actually instantiates. Constructor injection avoids the requirement entirely for service beans. For `@ConfigurationProperties`, yes — `opens com.example.shop.config to spring.core`. For domain entities, no — they have no Spring annotations.

The rule of thumb: teach JPMS *retrospectively*, attached to a concrete pain. Teach it *prospectively* only in design reviews where a new module is being proposed.

---

## 5. Library authoring — what a "well-modularised" JAR looks like

If you ship a library — open source, internal, vendor — your module declaration is part of the *binary contract* for the next 5+ years. The checklist:

- **A real `module-info.java`, not just `Automatic-Module-Name` in the manifest.** Automatic-Module-Name is for the day you publish without modularising; ship a real declaration as soon as you can.
- **Module name follows reverse-DNS.** `com.acme.foo`, not `foo` or `acme-foo`. The name is a deployment identifier; treat it like a Maven `groupId:artifactId` and never change it.
- **`exports` only your API packages.** Resist exporting `*.internal`, `*.util`, `*.spi`. Once exported, you own them as API.
- **Use qualified `exports … to` for friend-package patterns** (companion libraries that need your internals).
- **`requires transitive` only for types in your exported signatures.** Test: would removing the `transitive` cause consumers' compiles to fail? If yes, keep it; if no, drop it.
- **Provide an SPI module separate from the implementation module.** `com.acme.foo.api` for the abstractions, `com.acme.foo.core` for the implementation. Consumers depend on `api`; implementations are loaded via `ServiceLoader`.
- **Document `--add-opens` requirements upfront.** If your library reflects, tell consumers what to add. Ship a `JAVA_OPTS_OPENS.example` in the JAR.
- **CI rule: the exported package set changes only in major versions.** Use `jdeps --api-only --module-path …` to print the API surface; check it into the repo; fail the build when it diverges without a version bump.

```java
// Well-modularised SPI module declaration
module com.acme.notifications.api {
    exports com.acme.notifications.api;
    uses    com.acme.notifications.api.Channel;
}

// Implementation module
module com.acme.notifications.core {
    requires transitive com.acme.notifications.api;  // API types appear in our signatures
    requires java.net.http;
    exports com.acme.notifications.core;
    provides com.acme.notifications.api.Channel
        with com.acme.notifications.core.EmailChannel,
             com.acme.notifications.core.SmsChannel;
}
```

A library that does this is reachable from any modular consumer without a single `--add-opens`. That's the goal.

---

## 6. Migrating a legacy classpath application — strangler fig

You inherit a 200k-LOC monolith running on Java 17, all classpath, no `module-info.java`. The temptation is a rewrite. Don't. Use the *strangler fig*: grow a modular spine around the classpath, redirect responsibilities to it, until the classpath portion shrinks to nothing.

The phased plan:

1. **Set the JVM to module-aware classpath mode.** All existing JARs go on `--class-path` and form the unnamed module. Verify everything still runs identically. (It should — JPMS does not break classpath apps that don't reflect into JDK internals.)
2. **Pick a slice with a clean API boundary.** Often the deepest leaf module — a math library, a string utility, a domain value object collection. Carve it into a real module:
   ```java
   module com.example.legacy.money {
       exports com.example.legacy.money;
   }
   ```
   Put it on `--module-path`. Everything on the classpath still sees it (the unnamed module reads every module by default).
3. **Add an ArchUnit rule.** "No new code in `com.example.legacy.money` accesses classpath-only packages." This locks in the migration.
4. **Walk outward.** Each subsequent slice consumes a module that's already migrated. The module graph grows; the classpath portion shrinks. Each PR migrates one package or one sub-library.
5. **Plug-in points become `uses`/`provides`.** Where the classpath app had `ServiceLoader` already, add the `uses` / `provides` declarations. Where it had `Class.forName` with class names, refactor to `ServiceLoader`.
6. **Modularise the entry point last.** When most of the graph is modules, give the app its own `module-info.java` with `requires` on each slice and a `main` class. Now everything is on the module path.
7. **Adopt `jlink`.** With a real module graph, `jlink` works. Build the runtime image, deploy it, measure the size and startup gains (see [optimize.md](optimize.md)).

> **Lead to team:** No big-bang. Each sprint, one slice goes from classpath to module path. The success metric is the number of remaining classpath JARs trending toward zero. We don't touch the entry point until everything else is modularised.

The strangler-fig is JPMS applied as *motion through time*. Each carved module is a SOLID step too — see the parallel in [../../03-design-principles/01-solid-principles/professional.md](../../03-design-principles/01-solid-principles/professional.md).

---

## 7. Tooling shortlist

A short list of tools every JPMS-aware team should run regularly:

- **`jdeps`** (in the JDK). `jdeps --print-module-deps <jar>` prints the minimum module set; `jdeps --check <module>` validates declared vs actual dependencies; `jdeps --api-only` prints the public API surface.
- **`jmod`** (in the JDK). Creates `.jmod` files for `jlink` and inspects existing ones.
- **`jlink`** (in the JDK). Builds custom runtime images, see [optimize.md](optimize.md).
- **ArchUnit** for graph-level rules in test code.
- **`maven-enforcer-plugin`** with `dependencyConvergence` to catch shaded automatic modules.
- **Gradle `modularity.inferModulePath`** plus `org.beryx.jlink` for end-to-end modular packaging.
- **moditect** for retrofitting `module-info.java` into legacy JARs you don't own.

None of these are exotic. They are the toolchain a modular Java project lives in; budget for them.

---

## 8. CI gates for module hygiene

Three CI gates pay for themselves:

```yaml
# 1. The exported package surface is stable
- name: api-surface
  run: |
    jdeps --module-path mods --api-only com.example.shop > api.txt
    git diff --exit-code api.txt   # fails if API surface changed without commit
```

```yaml
# 2. No automatic modules in production
- name: no-automatic-modules
  run: |
    jdeps --module-path mods --check com.example.app | \
      grep "automatic" && exit 1 || exit 0
```

```yaml
# 3. --add-opens count does not increase
- name: opens-debt
  run: |
    cur=$(wc -l < JAVA_OPTS_OPENS)
    base=$(git show origin/main:JAVA_OPTS_OPENS | wc -l)
    test "$cur" -le "$base"
```

The first locks API stability; the second prevents new automatic modules from sneaking in; the third pins the encapsulation debt. They are 20 lines of YAML and protect months of architecture work.

---

## 9. Anti-patterns to flag in review

**Pattern:** `requires transitive` on every dependency.
**Diagnosis:** the author hasn't decided what their API surface is. Half of their dependencies are leaking.
**Fix:** drop `transitive` everywhere; let consumers fail to compile; add `transitive` back only where the API actually returns those types.

**Pattern:** an `internal` package that is exported.
**Diagnosis:** the name is a comment, the export is the truth — and the truth wins. Consumers will import from `internal` and break in v2.
**Fix:** rename the package back to internal-meaningful (`com.example.shop.persistence.impl`) and remove the export.

**Pattern:** `opens X;` (unqualified).
**Diagnosis:** the author wanted to "make Hibernate work" without knowing which module Hibernate is.
**Fix:** find the framework module name and qualify.

**Pattern:** module name that doesn't match the Maven `groupId.artifactId`.
**Diagnosis:** the module name was invented; it will drift from the Maven coordinates.
**Fix:** align both. The naming convention is reverse-DNS, same as packages.

**Pattern:** `requires` on an SPI implementation module instead of its API module.
**Diagnosis:** the consumer is bypassing `ServiceLoader` and depending on a concrete.
**Fix:** `requires` the API module only, use `uses` to resolve.

**Pattern:** `module-info.java` under `src/test/java`.
**Diagnosis:** the author thought tests needed their own module declaration. They don't — tests run as a patch module.
**Fix:** delete it; configure `maven-surefire-plugin` / Gradle test task to handle the patch.

---

## 10. Quick rules

- [ ] In review, **name the keyword** and propose **one** concrete change.
- [ ] Wire ArchUnit rules for inbound dependencies on every module.
- [ ] Maintain a single `JAVA_OPTS_OPENS` file; CI fails when it grows.
- [ ] Library authors: ship a real `module-info.java`, not just `Automatic-Module-Name`. Qualify exports and opens. Pin the API surface in CI.
- [ ] Migrate legacy via strangler-fig: one slice per sprint, ArchUnit guards each new module, modularise the entry point *last*.
- [ ] Module names use reverse-DNS, aligned with the Maven coordinates.
- [ ] Teach JPMS retrospectively, anchored to felt pain. Never as a mantra over greenfield code.

---

## 11. What's next

| Topic                                                                   | File              |
| ----------------------------------------------------------------------- | ----------------- |
| Plain-English first encounter with modules                              | [junior.md](junior.md)            |
| Practical refactors: classpath → modules, service loader, `jlink`       | [middle.md](middle.md)            |
| Strong encapsulation, frameworks, JEP 396 / 403, layers                 | [senior.md](senior.md)            |
| JLS / JVMS hooks, all the JEPs                                          | [specification.md](specification.md)     |
| Ten module-system bugs and their fixes                                  | [find-bug.md](find-bug.md)          |
| jlink images, AppCDS per module, startup gains                          | [optimize.md](optimize.md)          |
| Hands-on exercises                                                      | [tasks.md](tasks.md)             |
| Interview Q&A on modules                                                | [interview.md](interview.md)         |

Related sections:

- Sibling: [../01-sealed-classes-and-pattern-matching/](../01-sealed-classes-and-pattern-matching/)
- Cohesion at the module level: [../../03-design-principles/04-cohesion-and-coupling/](../../03-design-principles/04-cohesion-and-coupling/)
- The roadmap's general modules section: [../../../../07-modules/](../../../../07-modules/)

---

**Memorize this:** the module graph is *infrastructure*. It needs owners, an ArchUnit gate, a CI rule against automatic-module regressions, and a one-place inventory of `--add-opens` debt. Library authors ship a real `module-info.java` with qualified exports and opens. Legacy migrations are strangler-fig, never big-bang. Your job as a senior is to make the graph *survive* the next ten juniors — by name-the-keyword reviews, by tooling, and by anchoring every mentoring conversation to a felt pain.
