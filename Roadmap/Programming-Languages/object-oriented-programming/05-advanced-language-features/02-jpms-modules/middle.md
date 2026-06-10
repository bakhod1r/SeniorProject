# JPMS — Java Platform Module System — Middle

> **What?** Concrete, hands-on JPMS work: turning a classpath project into modules, splitting your code with qualified `exports`, choosing between `requires` and `requires transitive`, wiring `ServiceLoader` providers, building a minimal `jlink` runtime image, and getting Maven and Gradle to cooperate.
> **How?** Each section is a transformation — *I had this shape, here's the smallest move that gave me a working module graph*. None of the moves require a framework or a new dependency; JPMS is a `javac` + `java` feature first, build-tool plumbing second.

---

## 1. Why one transformation per section beats abstract definitions

Junior-level JPMS lists keywords. Middle-level JPMS is *motion*: I have a classpath app, I want a module graph; I have one fat module, I need to split it; I want a framework to hydrate my entities reflectively without exporting them to the world. Until you can perform these moves on your own code, the keywords are slogans.

Every section follows the same rhythm: the starting shape, the smell, then the smallest change that fixes it. Worked examples use realistic domains — ledger, ticketing, geo, fleet — drawn from systems you might plausibly meet.

---

## 2. Converting a multi-package classpath app to modules

You inherit a single-JAR app with five packages, built against the classpath:

```
ledger.jar
  com/example/ledger/api/         (public API the rest of the company calls)
  com/example/ledger/domain/      (entities, value objects)
  com/example/ledger/internal/    (mappers, helpers — "do not use" by convention)
  com/example/ledger/persistence/ (JDBC code)
  com/example/ledger/web/         (HTTP handlers)
```

A move to JPMS makes the "do not use" comment enforceable. The smallest first step is to *modularise the JAR as a single module*, only exporting what the company already calls:

```java
// src/com.example.ledger/module-info.java
module com.example.ledger {
    requires java.sql;             // persistence uses JDBC
    requires java.net.http;        // web layer uses HttpClient
    exports com.example.ledger.api;
    // domain, internal, persistence, web stay unexported
}
```

Compile and ship. Every existing caller still compiles, because they only ever imported from `com.example.ledger.api`. The `internal` package — previously "please don't" — is now *unreachable* from outside the module. A senior engineer who had been quietly importing `com.example.ledger.internal.Mapper` from another team's repo gets a compile error and a polite conversation.

That single-step modularisation is most of the value. You can split this one module into many later, but you don't have to do it on day one.

---

## 3. Splitting an over-grown module — qualified exports for shared internals

A year later, `com.example.ledger` is 60k lines and three teams edit it. You decide to split it into three modules:

```
com.example.ledger.api          (the public surface)
com.example.ledger.core         (domain + internal)
com.example.ledger.persistence  (JDBC adapters)
```

`core` has helpers that `persistence` legitimately needs, but you don't want those helpers exposed to the rest of the company. Use a **qualified export**:

```java
module com.example.ledger.core {
    exports com.example.ledger.domain;
    exports com.example.ledger.internal to com.example.ledger.persistence;
    //                                  ^^ visible only to the persistence module
}

module com.example.ledger.persistence {
    requires com.example.ledger.core;
    exports com.example.ledger.persistence.api;
}

module com.example.ledger.api {
    requires transitive com.example.ledger.core;     // see §4
    exports com.example.ledger.api;
}
```

A new module `com.example.reporting` may `requires com.example.ledger.api` but can never see `com.example.ledger.internal` — the qualified `exports … to` restricts the visibility to just the persistence module. The "do not use" convention is now JVM-level.

Qualified exports are the right tool for the *friend-package* relationship: two modules that need to share an implementation surface, with no one else looking in. Use them sparingly — most modules should either export a package fully or not at all.

---

## 4. `requires transitive` — when a dependency belongs to your API

Plain `requires Y` says "I depend on `Y` internally". Consumers of *your* module do **not** automatically see `Y`. That's usually what you want — keeps your dependencies private.

But sometimes a type from `Y` appears in your own public API. If `com.example.ledger.api.LedgerService.list()` returns a `com.example.money.Money`, every caller of `LedgerService` needs to see `Money`. If you say `requires com.example.money`, callers get a compile error: their module doesn't know about `Money`. They'd have to add `requires com.example.money` themselves — a leaky requirement.

The fix is `requires transitive`:

```java
module com.example.ledger.api {
    requires transitive com.example.money;   // re-export to my consumers
    exports com.example.ledger.api;
}
```

Now any module that `requires com.example.ledger.api` *also* implicitly reads `com.example.money` — exactly because `Money` appears in `LedgerService`'s signatures.

The rule of thumb: **if a type from another module appears in your exported API's signatures, use `requires transitive` for that module. Otherwise, plain `requires`.**

A useful spec hook: `java.sql` itself `requires transitive java.xml` and `requires transitive java.logging`, because its API uses XML types and `Logger`. You inherit those reads automatically when you `requires java.sql`.

---

## 5. The service-loader pattern — `uses` and `provides`

A module wants to talk to a *plugin* whose implementations it doesn't know about at compile time. JPMS blesses `ServiceLoader` for this — the same API that has existed since Java 6, now wired into the module graph.

A real example: a notification module that supports email, SMS, and Slack channels, with each channel as a separate module.

```java
// API module — declares the abstraction
module com.example.notify.api {
    exports com.example.notify.api;
}
```

```java
// com/example/notify/api/Notifier.java
package com.example.notify.api;
public interface Notifier {
    String channelId();
    void send(String to, String message);
}
```

```java
// Consumer module — uses the abstraction
module com.example.notify.dispatcher {
    requires com.example.notify.api;
    uses com.example.notify.api.Notifier;   // I will load these at runtime
    exports com.example.notify.dispatcher;
}
```

```java
// com/example/notify/dispatcher/Dispatcher.java
package com.example.notify.dispatcher;
import com.example.notify.api.Notifier;
import java.util.ServiceLoader;

public class Dispatcher {
    public void notifyAll(String channelId, String to, String message) {
        for (Notifier n : ServiceLoader.load(Notifier.class)) {
            if (n.channelId().equals(channelId)) {
                n.send(to, message);
                return;
            }
        }
        throw new IllegalArgumentException("no notifier for " + channelId);
    }
}
```

```java
// Provider module — provides an implementation
module com.example.notify.email {
    requires com.example.notify.api;
    requires jakarta.mail;
    provides com.example.notify.api.Notifier
        with com.example.notify.email.EmailNotifier;
}
```

```java
// com/example/notify/email/EmailNotifier.java
package com.example.notify.email;
import com.example.notify.api.Notifier;

public class EmailNotifier implements Notifier {
    public String channelId() { return "email"; }
    public void send(String to, String message) { /* SMTP send */ }
}
```

Add `com.example.notify.sms` and `com.example.notify.slack` modules with their own `provides`. The dispatcher doesn't import any of them. Drop a new provider JAR on the module path, and `ServiceLoader.load(Notifier.class)` finds it automatically.

Three rules to remember:

- The consumer says `uses S;`. Without that line, `ServiceLoader.load(S.class)` returns an empty iterator — a silent surprise.
- The provider says `provides S with Impl;`. The implementation must either be `public` with a public no-arg constructor, or provide a `public static S provider()` factory method.
- The consumer module never names the provider module. That's the whole point — DIP at the deployment level, see [../../03-design-principles/04-cohesion-and-coupling/](../../03-design-principles/04-cohesion-and-coupling/).

---

## 6. `jlink` — a minimal custom runtime image

`jlink` (introduced by **JEP 282** in Java 9) takes a set of modules and produces a self-contained runtime image — a directory tree that contains a JVM, the modules you asked for, and *nothing else*. No `corba`, no `jdk.compiler`, no `jdk.localedata` if you don't need it.

```
jlink \
  --module-path "${JAVA_HOME}/jmods:out" \
  --add-modules com.example.app \
  --launcher app=com.example.app/com.example.app.Main \
  --strip-debug \
  --no-header-files \
  --no-man-pages \
  --compress=2 \
  --output dist/app-runtime
```

What this gives you:

- `dist/app-runtime/bin/java` — a JVM compiled with exactly the modules your app transitively requires.
- `dist/app-runtime/bin/app` — a launcher that runs `com.example.app/Main` directly. No `-cp`, no `-jar`, no `-p`.
- A directory typically **40 to 70 MB** (vs 200+ MB for a full JDK). For containerised microservices the image shrinks substantially when you copy this into a `distroless` base.

`jlink` only works when *every* module on the path is a real named module — automatic modules are not allowed. That's another reason library authors should ship a real `module-info.java`.

---

## 7. Build tool integration — Maven

Maven supports modules from `maven-compiler-plugin` 3.6+. The structure is the same as classpath builds; the plugin detects `module-info.java` and switches to module-path mode.

```xml
<!-- pom.xml — module 'com.example.ledger.api' -->
<project>
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.example</groupId>
    <artifactId>ledger-api</artifactId>
    <version>1.0.0</version>
    <build>
        <plugins>
            <plugin>
                <artifactId>maven-compiler-plugin</artifactId>
                <version>3.13.0</version>
                <configuration>
                    <release>17</release>
                </configuration>
            </plugin>
        </plugins>
    </build>
    <dependencies>
        <dependency>
            <groupId>com.example</groupId>
            <artifactId>ledger-core</artifactId>
            <version>1.0.0</version>
        </dependency>
    </dependencies>
</project>
```

```
src/main/java/
  module-info.java
  com/example/ledger/api/LedgerService.java
```

Two things that catch newcomers out:

- **Test sources are a different module.** Maven puts test sources in a *patch* module — code under `src/test/java` gets implicitly added to the production module at test time. You don't need a `module-info.java` under `src/test/java`. If you need extra `requires` for tests (e.g., JUnit), Maven adds them via `--add-reads` and `--add-modules`.
- **Mixed Maven graphs sometimes need automatic modules.** A third-party dependency that doesn't yet have `module-info` gets an automatic name. If two such JARs export the same package, Maven happily builds; your runtime fails with a split-package error. Audit the resolution graph early.

---

## 8. Build tool integration — Gradle

Gradle's `java` plugin understands `module-info.java` from Gradle 6.4 onward, but you may need to nudge the source set:

```gradle
plugins {
    id 'java'
}

java {
    modularity.inferModulePath = true     // since Gradle 6.4
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

dependencies {
    implementation project(':ledger-core')
}
```

```
src/main/java/
  module-info.java
  com/example/ledger/api/LedgerService.java
```

For multi-module Gradle builds, each subproject has its own `module-info.java`. Cross-subproject dependencies use `project(':...')` as usual; Gradle puts them on the module path.

Gradle's *application* plugin can run `jlink` indirectly via `org.beryx.jlink`:

```gradle
plugins {
    id 'application'
    id 'org.beryx.jlink' version '3.0.1'
}

application {
    mainModule = 'com.example.app'
    mainClass  = 'com.example.app.Main'
}

jlink {
    options = ['--strip-debug', '--compress=2', '--no-header-files', '--no-man-pages']
    launcher { name = 'app' }
}
```

`./gradlew jlink` produces a runtime image directly under `build/image/`.

---

## 9. Worked transition — from a fat JAR to a three-module graph

A ticketing system has grown out of a single JAR. The team agrees on a target:

```
com.example.tickets.api       — public surface
com.example.tickets.core      — domain + business logic
com.example.tickets.adapter   — JDBC and REST adapters
```

Step-by-step:

1. **Cut the source tree.** Move existing packages into three module roots. Keep the package names; only the source location moves.
2. **Write three minimal `module-info.java` files.** Each module starts with `requires java.base` (implicit) and the bare minimum it needs.

```java
module com.example.tickets.core {
    exports com.example.tickets.core.api;
}

module com.example.tickets.api {
    requires transitive com.example.tickets.core;
    exports com.example.tickets.api;
}

module com.example.tickets.adapter {
    requires com.example.tickets.core;
    requires java.sql;
    requires java.net.http;
    provides com.example.tickets.core.api.TicketRepository
        with com.example.tickets.adapter.jdbc.JdbcTicketRepository;
}
```

3. **Compile, fix the "package not visible" errors.** Each error points at a missing `requires` or `exports`. Adding them is mechanical.
4. **Run tests.** A `NullPointerException` from `ServiceLoader.load(TicketRepository.class)` means the consumer module forgot `uses TicketRepository`. Add the `uses` line.
5. **Audit the exports.** Run `jdeps --module-path … --check com.example.tickets.api` — `jdeps` prints suggested `module-info.java` based on your actual usage. Compare against your declarations and tighten.

A migration like this typically takes one to three days for ~100k LOC. The compile errors are loud, deterministic, and instructive.

---

## 10. `requires static` — compile-only dependencies

Annotations and optional integrations should be `requires static`:

```java
module com.example.ledger.core {
    requires static org.jetbrains.annotations;   // @Nullable, compile-time only
    requires static com.fasterxml.jackson.databind; // optional JSON support
    exports com.example.ledger.core.api;
}
```

`requires static` means:

- **Compile time** — the module is resolved; you can `import` from it.
- **Runtime** — the module may or may not be present. If absent, the code that referenced it is dead-code-eliminated by the JVM's lazy linking; if present, it's used normally.

The classic use case is *optional* features: ship a single JAR that integrates with Jackson if Jackson is on the module path, but doesn't pull Jackson in if it isn't. Beware: reflective use of an absent module *will* `ClassNotFoundException` at runtime — `requires static` doesn't make the dependency truly optional for everyone, only for the type-checker.

---

## 11. Layered module graphs and how to read them

Once your project has 6–8 modules, sketch the graph. `jdeps --module-path mods --check com.example.app` prints something like:

```
com.example.app -> com.example.ledger.api
com.example.app -> com.example.notify.api
com.example.ledger.api -> com.example.ledger.core
com.example.ledger.api -> com.example.money
com.example.ledger.core -> java.base
com.example.notify.api -> java.base
```

Two heuristics to apply:

- **Arrows should point *toward* abstractions.** If `core` points at `adapter`, you've inverted the dependency the wrong way — refactor.
- **No cycles.** JPMS itself refuses cyclic `requires` at compile time. If you find yourself wanting one, the two modules are *one* module pretending to be two.

---

## 12. Mistakes typical of "I just modularised my app"

**Re-exporting everything via `requires transitive`.** It feels safe — your downstream consumers always see your dependencies — but it leaks implementation choices into your API. Use `requires transitive` only when the dependency's *types* are in your exported signatures.

**Exporting `internal` packages "for now".** They never become un-exported later, because someone always finds them and imports from them. If you export it, you own it as API.

**Opening everything.** `opens com.example.ledger;` (unqualified) defeats half the point of modules. Use `opens X to <framework-module>` and list the frameworks. See [find-bug.md](find-bug.md) bug 9.

**Skipping `uses`.** `ServiceLoader.load(...)` returns an empty iterator silently if the consumer module forgot `uses`. Always declare it.

**Splitting a package across modules.** JPMS refuses to start when two modules both export the same package. The fix is a rename or a merge, not an `--add-exports` workaround.

**Treating `automatic-module-name` as final.** Setting `Automatic-Module-Name: com.example.x` in your JAR's manifest *names* the module but doesn't make it a real named module — the JAR still has no `module-info`, so it still has the relaxed automatic-module rules. It's a migration aid; eventually, ship a real module declaration.

---

## 13. Quick rules

- [ ] Start by modularising the whole JAR into one module that exports only its public API.
- [ ] Split into multiple modules only when stakeholders or change axes diverge.
- [ ] Use **qualified exports** (`exports X to Y`) for friend-package relationships, not unqualified exports.
- [ ] `requires transitive` only when the dependency's types appear in your *exported* API signatures.
- [ ] `requires static` for annotations and optional integrations.
- [ ] `uses` plus `provides` is the canonical cross-module plugin mechanism — don't roll your own.
- [ ] `jlink` shrinks runtime images by 60 %+; reserve a Friday afternoon to try it on your app.
- [ ] Maven and Gradle both understand `module-info.java`; don't fight the toolchain.
- [ ] Audit the graph with `jdeps` after every refactor.

---

## 14. What's next

| Topic                                                                   | File              |
| ----------------------------------------------------------------------- | ----------------- |
| Strong encapsulation, frameworks, jlink runtimes, JEP 396 / 403         | [senior.md](senior.md)            |
| Library authoring, ArchUnit module rules, `--add-opens` policy          | [professional.md](professional.md)      |
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

**Memorize this:** modularisation is a sequence of *small moves*. Modularise the whole JAR first, exporting only what the world already calls. Split *when* you have two stakeholders, not before. `requires transitive` for API surface, `requires static` for optional and annotations, qualified `exports … to` for friend-package, `uses` plus `provides` for plugins. `jlink` once everything is named. The build tools cooperate — fight the design, not the tooling.
