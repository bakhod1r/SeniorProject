# JPMS — Practice Tasks

Eight exercises that force JPMS's mechanics to bite. Most are small projects you can run end-to-end in 30–90 minutes. Domains are drawn from systems you may plausibly meet: notifications, billing, inventory, fleet.

Work each task in three passes: (1) write the `module-info.java` files first, on paper, before touching code; (2) implement the smallest version that compiles and runs; (3) write one test (or one command-line check) that would catch a regression in the module structure.

---

## Task 1 — Convert a small classpath project to JPMS

You have this classpath project:

```
src/
  com/example/calc/api/Calculator.java
  com/example/calc/api/Result.java
  com/example/calc/internal/BigCalc.java   // implementation detail
  com/example/app/Main.java                // uses Calculator
build.gradle (or pom.xml)
```

```java
// com/example/calc/api/Calculator.java
package com.example.calc.api;
public interface Calculator {
    Result eval(String expr);
}
```

```java
// com/example/app/Main.java
package com.example.app;
import com.example.calc.api.Calculator;
import com.example.calc.internal.BigCalc;   // ← reaching into internal!

public class Main {
    public static void main(String[] args) {
        Calculator c = new BigCalc();
        System.out.println(c.eval("1+1").value());
    }
}
```

**Objective.** Split the project into two modules, `com.example.calc` and `com.example.app`. After the migration, `Main` must no longer reach into `com.example.calc.internal`.

**Constraints.**
- Each module gets its own source root and its own `module-info.java`.
- `com.example.calc` exports only `com.example.calc.api`.
- `com.example.app` must instantiate `Calculator` *without* directly naming `BigCalc`.
- The build runs with `--module-path` (no classpath).

**Acceptance criteria.**
- `import com.example.calc.internal.BigCalc;` in `Main.java` produces a compile error.
- `com.example.calc.internal` is not visible to any module that `requires com.example.calc`.
- The app prints `2` when run.
- `jdeps --check com.example.app` shows no unused or excessive requires.

**Hint.** Use `ServiceLoader` plus `uses` / `provides` to instantiate `Calculator` across the module boundary (see Task 2).

---

## Task 2 — Create a service-loader provider

Reuse the modules from Task 1. The objective is to make `BigCalc` discoverable as a `Calculator` provider without `Main` ever naming it.

**Objective.** Wire `ServiceLoader` so `Main` does `Calculator c = ServiceLoader.load(Calculator.class).findFirst().orElseThrow();`.

**Constraints.**
- `com.example.calc`'s `module-info.java` declares `provides com.example.calc.api.Calculator with com.example.calc.internal.BigCalc;`.
- `com.example.app`'s `module-info.java` declares `uses com.example.calc.api.Calculator;`.
- `BigCalc` stays in the `internal` package and is **not** exported.

**Acceptance criteria.**
- `Main.java` has no `import com.example.calc.internal.*;`.
- Running the app prints `2` again — the loader finds `BigCalc` through the module graph.
- Deleting the `provides` line from `module-info.java` causes `ServiceLoader.load(Calculator.class).findFirst()` to return `Optional.empty()`.
- A second implementation `FastCalc` added in a new module `com.example.fast` with its own `provides` is automatically discovered when its JAR is on the module path — no `Main` edits.

**Hint.** `BigCalc` must have a public no-arg constructor, *or* a `public static Calculator provider()` factory method.

---

## Task 3 — Build a minimal `jlink` image

Take a small Spring-free, JDK-only app:

```java
module com.example.helloweb {
    requires java.net.http;
    requires java.logging;
}

// com/example/helloweb/Main.java
package com.example.helloweb;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;

public class Main {
    public static void main(String[] args) throws Exception {
        HttpServer s = HttpServer.create(new InetSocketAddress(8080), 0);
        s.createContext("/", ex -> {
            byte[] body = "hello from jlink\n".getBytes();
            ex.sendResponseHeaders(200, body.length);
            ex.getResponseBody().write(body);
            ex.close();
        });
        s.start();
    }
}
```

**Objective.** Produce a self-contained runtime image with `jlink` that boots the app via a single launcher script.

**Constraints.**
- Use `jdeps --print-module-deps` to compute the minimum module set (don't list modules by hand).
- Strip debug info, compress, omit headers and man pages.
- Provide a `--launcher` flag so the image creates `bin/helloweb`.
- The image must run on a machine with no JDK installed.

**Acceptance criteria.**
- `du -sh dist/helloweb/` shows under 60 MB.
- `dist/helloweb/bin/helloweb` starts the server and responds on `:8080`.
- `dist/helloweb/lib/modules` contains only the modules you actually need — verify with `dist/helloweb/bin/java --list-modules`.
- `dist/helloweb` does not contain `jconsole`, `keytool`, or `jdeps`.

**Hint.** `com.sun.net.httpserver` lives in the `jdk.httpserver` module — `jdeps` will tell you.

---

## Task 4 — Add `opens` so Spring can hydrate a config

You inherit a module that won't start under Spring Boot 3:

```java
module com.example.shop {
    requires spring.context;
    requires spring.boot;
    requires spring.boot.autoconfigure;
    requires spring.beans;
    exports com.example.shop;
    exports com.example.shop.config;
}
```

```java
// com/example/shop/config/ShopProperties.java
package com.example.shop.config;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "shop")
public class ShopProperties {
    private String region;
    private int maxOrders;
    // getters / setters
}
```

On startup, Spring throws:

```
InaccessibleObjectException: module com.example.shop does not "opens com.example.shop.config" to spring.core
```

**Objective.** Add the minimal `opens` directives so the app starts, without opening anything to ALL-UNNAMED.

**Constraints.**
- Only the *specific* packages Spring needs to reflect on should be opened.
- Each `opens` must be qualified to a specific Spring module (e.g., `spring.core`, `spring.beans`).
- No `--add-opens` in the JVM launch arguments.

**Acceptance criteria.**
- The app starts successfully and reads `shop.region` from `application.yml`.
- `module-info.java` has at most two `opens` lines, both qualified.
- Removing the `opens` re-introduces the `InaccessibleObjectException` — verify by deleting and rerunning.
- Other consumers of `com.example.shop` that don't use Spring cannot reflect into `com.example.shop.config`.

**Hint.** Spring Boot's docs (and the exception message) name the specific module that needs access.

---

## Task 5 — Resolve a split-package conflict

You have three modules:

```java
module com.example.utils.legacy {
    exports com.example.utils;       // ← same package
}

module com.example.utils.modern {
    exports com.example.utils;       // ← same package
}

module com.example.app {
    requires com.example.utils.legacy;
    requires com.example.utils.modern;
}
```

The runtime fails with `LayerInstantiationException`.

**Objective.** Resolve the split package without losing functionality from either module.

**Constraints.**
- You may not introduce module layers (overkill for this case).
- Pick one of three resolutions: rename, merge, or extract. Justify the choice.
- After the fix, both halves of `com.example.utils` are still reachable from `com.example.app`.

**Acceptance criteria.**
- `java --module-path mods -m com.example.app/...` starts without error.
- The app calls one method from each former half and gets the expected result.
- A regression test exists: running `java --validate-modules --module-path mods` reports no errors.
- A one-paragraph rationale is committed to the README explaining the choice (rename vs merge vs extract).

**Hint.** Run `jar -tf` on each module to see what's actually inside; sometimes "the package is split" is a build artefact, not a design choice.

---

## Task 6 — Design a multi-module library with qualified exports

You are authoring a small billing library. The team agrees on the structure:

- `com.example.billing.api` — public API: `Invoice`, `LineItem`, `Tax`, `BillingService`.
- `com.example.billing.core` — implementation: `DefaultBillingService`, internal helpers `Mappers`, `TaxRules`.
- `com.example.billing.testkit` — fixtures and assertions used by consumers' tests, including some access to internal builders.

**Objective.** Write three `module-info.java` files that:
- export only the API from `com.example.billing.api`,
- expose `Mappers` from `core` *only* to `testkit` (qualified export),
- ensure `testkit` is a transitive consumer of `api` (so test code that `requires com.example.billing.testkit` automatically sees `Invoice`),
- use `requires static` for the optional Jackson integration in `core`.

**Constraints.**
- No package may be unqualified-exported except the API package.
- No `opens` declarations (this is a non-reflective library).
- `core` provides `BillingService` via `ServiceLoader`.

**Acceptance criteria.**
- A consumer module that `requires com.example.billing.api` can call `BillingService` (via `ServiceLoader`).
- A consumer module that `requires com.example.billing.testkit` automatically reads `api` and can call its types.
- A consumer module that does *not* require `testkit` cannot import `com.example.billing.core.internal.Mappers`.
- With Jackson absent at runtime, the core module still loads (test by removing the Jackson JAR from the module path).

**Hint.** `requires transitive` is the tool for "consumers of mine implicitly see this other module".

---

## Task 7 — Debug a missing `requires`

Given this code, the build fails:

```java
// module-info.java
module com.example.report {
    exports com.example.report;
}
```

```java
// com/example/report/MonthlyReport.java
package com.example.report;
import java.sql.Connection;
import java.time.YearMonth;

public class MonthlyReport {
    public void run(Connection c, YearMonth ym) {
        // ...
    }
}
```

```
error: package java.sql is not visible
  (package java.sql is declared in module java.sql, which is not in the module graph)
```

**Objective.** Make the code compile *and* document what was wrong.

**Constraints.**
- Add the minimum `requires` necessary.
- Do not import unrelated modules.
- The `Connection` type appears in a *public method signature* — think about whether `requires` or `requires transitive` is appropriate.

**Acceptance criteria.**
- The module compiles.
- Consumers of `com.example.report` that call `monthlyReport.run(c, ym)` can pass a `Connection` from `java.sql` without adding `requires java.sql` themselves.
- `jdeps --check com.example.report` reports no missing or unused requires.

**Hint.** The signature-rule: if a type appears in your *exported* API's public signatures, `requires transitive` is usually right.

---

## Task 8 — ArchUnit test for module structure

Take the modules from Task 6 (`api`, `core`, `testkit`). Write an ArchUnit test suite that enforces the following invariants:

**Objective.**
- No class in `com.example.billing.api..` may import from `com.example.billing.core..`.
- No class outside `com.example.billing.core.internal..` may import from `com.example.billing.core.internal..`.
- Every class in `com.example.billing.api..` whose name ends in `Service` must be an `interface`.
- The module-info.class of `core` must `provides` exactly one `BillingService` implementation.

**Constraints.**
- Use ArchUnit 1.x.
- The test must run as a normal JUnit 5 test.
- Failure output should clearly name the offending class and the rule it broke.

**Acceptance criteria.**
- Inserting an `import com.example.billing.core.DefaultBillingService;` into the `api` package fails the build.
- Renaming `BillingService` interface to a concrete class fails the build.
- Adding a second `provides` line for `BillingService` fails the build.
- The CI pipeline runs the ArchUnit tests on every PR.

**Hint.** ArchUnit's `classes().that().resideInAPackage(...)` matchers are sufficient for the import rules; the `provides` check needs reading the `Module` attribute directly via `ClassFileImporter` or by parsing `module-info.class` with `java.lang.module.ModuleDescriptor.read(...)`.

---

## Validation

| Task | How to verify the fix |
|------|----------------------|
| 1 | `import com.example.calc.internal.*` in `Main.java` is a compile error. |
| 2 | `Main.java` contains no reference to `BigCalc`; deleting `provides` breaks the program at the `ServiceLoader` call. |
| 3 | `dist/helloweb/` is under 60 MB and runs without an installed JDK. |
| 4 | The app starts under Spring Boot; no `ALL-UNNAMED` in any `opens`. |
| 5 | `java --validate-modules --module-path mods` reports no errors. |
| 6 | Consumer that requires only `api` cannot see `core.internal.Mappers`; consumer that requires `testkit` can. |
| 7 | `jdeps --check com.example.report` reports no missing requires; consumers don't need to add `requires java.sql`. |
| 8 | Each invariant violation produces a clearly named ArchUnit failure. |

---

## Worked solution sketch — Task 2 (service-loader provider)

```java
// com.example.calc/module-info.java
module com.example.calc {
    exports com.example.calc.api;
    provides com.example.calc.api.Calculator
        with com.example.calc.internal.BigCalc;
}
```

```java
// com.example.calc/com/example/calc/internal/BigCalc.java
package com.example.calc.internal;
import com.example.calc.api.Calculator;
import com.example.calc.api.Result;

public class BigCalc implements Calculator {
    public BigCalc() { }              // required: public no-arg constructor
    public Result eval(String expr) {
        // dumb parser for "<int>+<int>"
        String[] parts = expr.split("\\+");
        long sum = Long.parseLong(parts[0]) + Long.parseLong(parts[1]);
        return new Result(sum);
    }
}
```

```java
// com.example.app/module-info.java
module com.example.app {
    requires com.example.calc;
    uses com.example.calc.api.Calculator;
}
```

```java
// com.example.app/com/example/app/Main.java
package com.example.app;
import com.example.calc.api.Calculator;
import java.util.ServiceLoader;

public class Main {
    public static void main(String[] args) {
        Calculator c = ServiceLoader.load(Calculator.class)
                                    .findFirst()
                                    .orElseThrow();
        System.out.println(c.eval("1+1").value());
    }
}
```

Build and run:

```
javac -d out --module-source-path src $(find src -name "*.java")
java --module-path out --module com.example.app/com.example.app.Main
# prints: 2
```

Now add a second module `com.example.fast` with its own `provides com.example.calc.api.Calculator with com.example.fast.FastCalc;`. Drop its JAR on the module path. `ServiceLoader.load(Calculator.class)` returns both, and `findFirst()` picks whichever the loader saw first. Add `priority()` to the API if you want deterministic order. No edits to `Main`.

Three structural points to absorb from this exercise:

1. The consumer module names the *abstraction* (`com.example.calc.api.Calculator`); it never names a concrete.
2. The implementation lives in an *unexported* package (`com.example.calc.internal`), but the SPI still finds it because `provides` is a module-level declaration, not a package-export.
3. Adding a new provider is a new module — *zero edits* to the consumer or the API module. Open/closed at the deployment level.

---

**Memorize this:** every JPMS task is a sequence of small `module-info.java` decisions. Walk the four keywords for each module — `requires`, `exports`, `opens`, `uses`/`provides` — answer them on paper before touching code, and the implementation falls out. If your `module-info.java` is short and self-evident, the module is right-sized. If it's a wall of `transitive`/`opens`/`exports` lines, the module probably shouldn't exist as one module.
