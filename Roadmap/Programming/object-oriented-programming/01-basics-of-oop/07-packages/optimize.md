# Packages — Optimize the Code

> 12 exercises showing how package design affects maintainability, build times, and runtime behavior. Wins are mostly architectural, not microbenchmark-level.

---

## Optimization 1 — Reduce public surface

**Slow (in maintenance):**

A package with 30 `public` classes. Every refactor potentially breaks external callers; every API change requires deprecation cycles.

**Better:**

Audit usages. Reduce to 3 `public` API entry points; everything else package-private. Internal refactors stop breaking callers.

**Why.** The maintenance cost of `public` is forever. Reducing public surface is the single highest-leverage refactor in any large Java codebase.

---

## Optimization 2 — Package by feature, not layer

**Slow:**

```
com.example.controller (everything)
com.example.service (everything)
com.example.repository (everything)
```

Adding a feature touches every package. Every package has 50+ classes. No internal cohesion.

**Better:**

```
com.example.users (User-related: controller, service, repo, domain)
com.example.orders (Order-related)
com.example.payments (Payment-related)
```

Each feature is self-contained. Easier to understand, refactor, extract.

**Why.** Vertical slices scale better than horizontal layers as features multiply. Most modern Java codebases lean this way.

---

## Optimization 3 — API/internal split

**Slow:**

A library exposes all classes as `public` in flat packages. Consumers reflect on internals. Refactoring is impossible without breaking customers.

**Better:**

```
com.example.lib.api      (public API — exported)
com.example.lib.internal  (impl — NOT exported)
```

With JPMS:

```java
module com.example.lib {
    exports com.example.lib.api;
}
```

Consumers see only the API. Internal refactors are safe.

**Why.** Library evolution depends on hiding internals. Strong encapsulation enables version freedom.

---

## Optimization 4 — Reduce wildcard import noise

**Slow:**

```java
import java.util.*;
import java.io.*;
import java.nio.*;
import com.example.banking.*;
```

Hard to tell at a glance which class comes from where. Risk of subtle ambiguities.

**Better:**

Single imports:

```java
import java.util.List;
import java.util.Map;
import java.io.IOException;
import com.example.banking.BankAccount;
```

IDE auto-import handles them; readers see exactly what's used.

**Why.** Code readability. Most modern Java style guides require single imports.

---

## Optimization 5 — Detect cycles with ArchUnit

**Slow (in failure):**

A subtle cyclic dependency between packages causes:
- Tests can't run independently.
- Refactoring one module breaks another.
- Build tools occasionally produce surprising results.

**Better:**

Add an ArchUnit test:

```java
@Test
void no_cycles_in_features() {
    slices().matching("com.example.(*)..").should().beFreeOfCycles().check(...);
}
```

CI fails when a new PR introduces a cycle.

**Why.** Cycles silently degrade architecture. Automated detection prevents regression.

---

## Optimization 6 — Trim transitive `requires`

**Slow:**

```java
module com.example.app {
    requires transitive com.example.lib;
}
```

Consumers of `com.example.app` automatically get all of `com.example.lib`. Compile classpath grows; build time slows.

**Better:**

Use `transitive` only when `lib`'s types are part of `app`'s public API. Otherwise plain `requires`:

```java
module com.example.app {
    requires com.example.lib;
}
```

**Why.** Smaller transitive scope = faster compilation, smaller `jlink` images, less surprise for consumers.

---

## Optimization 7 — Use `jlink` for smaller distributions

**Slow:**

A 200 MB JDK + your 5 MB app = 205 MB to ship.

**Better:**

```
jlink --module-path mods --add-modules com.example.app --output dist
```

Produces a custom runtime with only the modules your app needs — typically 30-50 MB.

**Why.** Smaller container images, faster downloads, less attack surface. Especially valuable for cloud / serverless deploys.

---

## Optimization 8 — Speed up compilation with smaller packages

**Slow (in build time):**

A package with 200 classes. Touching one triggers recompilation of dependents — Gradle/Maven incremental builds re-process the whole package.

**Better:**

Split into smaller packages by sub-feature. Each contains 20-30 classes. Incremental builds touch only the modified sub-package.

**Why.** Build tools' incremental compilation works at the package level. Smaller packages = less re-work.

---

## Optimization 9 — Replace static imports with method calls in hot code

**Slow (in readability):**

```java
import static com.example.utils.MathUtils.*;
import static com.example.utils.StringUtils.*;
import static java.lang.Math.*;
import static org.assertj.core.api.Assertions.*;

double r = abs(sqrt(square(x)));
```

Hard to tell which `abs` is which.

**Better:**

```java
import java.lang.Math;
import com.example.utils.MathUtils;

double r = Math.abs(Math.sqrt(MathUtils.square(x)));
```

Slight verbosity, much clearer.

**Why.** Production code is read more than written. Clarity wins.

---

## Optimization 10 — Consolidate "util" packages

**Slow:**

```
com.example.util/
├── StringUtils
├── DateUtils
├── JsonUtils
├── DBUtils
└── ... 30 more
```

A junk drawer. Nothing inside cooperates. Hard to discover; easy to duplicate.

**Better:**

Move utilities to their domains:
- `JsonUtils` → `com.example.serialization`.
- `DBUtils` → `com.example.persistence`.
- `StringUtils` → if widely used, `com.example.shared.text`; otherwise feature-specific.

**Why.** Cohesion: each package contains classes that work together. No junk drawer.

---

## Optimization 11 — Use `module-info.java` to enforce dependencies

**Slow (in architectural drift):**

A monorepo where every project depends on every other through compile-time classpath discipline. New developers add unintended dependencies.

**Better:**

Each project gets a `module-info.java`:

```java
module com.example.users {
    requires com.example.shared;
    // not requires com.example.payments — users shouldn't depend on payments
}
```

The compiler enforces the dependency graph. Architectural rules become physical constraints.

**Why.** Makes architecture executable. Drift is impossible without explicit module change.

---

## Optimization 12 — Co-locate tests with production for tight access

**Slow:**

Tests in `com.example.app.test`, production in `com.example.app`. Tests use only public API or `setAccessible(true)`.

**Better:**

```
src/main/java/com/example/app/Foo.java
src/test/java/com/example/app/FooTest.java       (same package)
```

Tests reach package-private members directly. No production access widening, no reflection.

**Why.** Faster, cleaner tests. Production code stays tightly encapsulated.

---

## Methodology recap

For every change:

1. **Survey usages** before reducing access. IDE "Find Usages."
2. **Run `jdeps`** to verify dependency graph after refactoring.
3. **ArchUnit tests** in CI for ongoing enforcement.
4. **Build time** measurement before/after package consolidation.
5. **Module count** trimmed via `jlink`.

The biggest "performance" wins from package design are *engineering* time saved — fewer breakages, faster builds, easier refactoring. Per-class runtime benefits are minor; the macro benefits are huge.
