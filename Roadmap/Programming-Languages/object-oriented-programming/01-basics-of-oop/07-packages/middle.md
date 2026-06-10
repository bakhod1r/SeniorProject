# Packages — Middle

> **Why?** Packages are the architectural unit of code organization in Java. They group cooperating classes, define the boundary of "internal" vs "external," and shape how the codebase scales with size. Pick the right package structure and the codebase stays tractable; pick wrong and every file becomes painful.
> **When?** Design package boundaries when introducing a new feature or module. Refactor existing packages when their public surface grows or when import statements get noisy.

---

## 1. Packages are units of cohesion

A well-designed package contains classes that *belong together* — they cooperate on one concern, share package-private helpers, and share a single public API.

Anti-pattern: a `util` package with 50 unrelated classes (`StringUtils`, `DateUtils`, `IOUtils`, `JsonUtils`...). It's a junk drawer; nothing inside cooperates with anything else.

The fix: **package by feature**, not by layer. `com.example.banking`, `com.example.payments`, `com.example.users` — each contains everything needed for that feature.

When packages are right:

- The package's public API is 1-3 entry-point classes.
- Internal helpers are package-private and unreachable from outside.
- Names within the package are *short* and *unambiguous* (`Service`, `Repository` rather than `BankingService`, `BankingRepository`).
- Tests in the same package see internals without weakening production access.

---

## 2. Package by feature vs package by layer

Two opposing organizational philosophies:

**Package by layer** (older Java style):

```
com.example.controller       (UserController, OrderController, ...)
com.example.service          (UserService, OrderService, ...)
com.example.repository       (UserRepository, OrderRepository, ...)
com.example.model             (User, Order, ...)
```

**Package by feature** (modern style):

```
com.example.user             (UserController, UserService, UserRepository, User)
com.example.order            (OrderController, OrderService, OrderRepository, Order)
```

Trade-offs:

- *By layer*: easy to see all "controllers" or all "repositories" in one place. Bad: every cross-cutting feature touches every package; no internal cohesion.
- *By feature*: each package is self-contained. Easier to extract into a microservice. Better encapsulation. Slight downside: harder to find "all controllers" — but IDE search handles it.

For new projects, **package by feature** is almost always the better choice.

---

## 3. The "API / internal" split

For each feature package, separate API from implementation:

```
com.example.banking/
├── api/                              (exported, public API)
│   ├── BankAccount.java                (public)
│   ├── TransferService.java            (public interface)
│   └── package-info.java
├── internal/                          (NOT exported)
│   ├── DefaultTransferService.java    (package-private)
│   ├── TransactionLog.java
│   └── RetryPolicy.java
└── package-info.java
```

External code uses `com.example.banking.api.*`. The implementation in `internal/*` is invisible.

Combined with JPMS modules (Java 9+), the `exports` clause makes this enforceable at the runtime level:

```java
module com.example.banking {
    exports com.example.banking.api;
    // not exporting internal — strong encapsulation
}
```

---

## 4. Package boundaries are encapsulation boundaries

A class declared package-private (`class Foo`) is invisible outside its package. A class declared `public` is visible from anywhere.

So the package boundary controls what consumers see. Designing a feature:

1. List the public types — these are the contract.
2. Make everything else package-private.
3. Group public types in the API package; internals in the internal package.

The discipline: **fewer public types = smaller maintenance commitment**. Each `public` is a forever-API.

---

## 5. Cross-package references should follow the dependency direction

Package dependencies should form a *DAG* (directed acyclic graph). If `payments` depends on `users`, then `users` should *not* depend on `payments`. Cycles between packages signal poor separation.

To keep dependencies clean:

- Higher-level packages depend on lower-level ones (api, then domain, then infrastructure).
- Use interfaces in the higher level, concrete impls in the lower.
- Move shared types into a separate "common" or "shared" package.

Tools like `jdeps` or `archunit` can detect cyclic package dependencies in CI.

---

## 6. Package-info: documentation and annotations

A `package-info.java` file documents the package and may carry package-level annotations:

```java
/**
 * Banking domain types and operations.
 *
 * <p>Public API: {@link BankAccount}, {@link TransferService}.
 *
 * <p>This package is thread-safe.
 */
@NonNullByDefault
package com.example.banking;
```

Common annotations applied at package level:

- `@NonNullByDefault` (JSpecify, Eclipse): every reference type in the package is non-null unless marked `@Nullable`.
- `@Beta`, `@Experimental`: signal API stability.

The `package-info.java` is the canonical place for package documentation. Use it for:

- Brief overview.
- Public API summary.
- Threading guarantees.
- Stability commitments.

---

## 7. Wildcard imports — the trade-off

```java
import java.util.*;
import com.example.banking.*;
```

Pros:

- Less import noise.
- Adding a new class doesn't require a new import line.

Cons:

- Hides which classes are actually used.
- Can introduce ambiguity when two packages have a class with the same name.
- IDE auto-import works fine for single imports.

Most modern Java style guides prefer single imports. Ambiguity (`java.util.Date` vs `java.sql.Date`) is the classic wildcard nightmare.

A common compromise: allow wildcards only for `static` imports of test assertions.

---

## 8. Package-private constructor for sealed-by-convention

Pre-Java 17 sealed classes, you could "seal" a hierarchy by making all constructors package-private:

```java
package com.example.shapes;

public abstract class Shape {
    Shape() { }                          // package-private — only same-package can subclass
}

public final class Circle extends Shape { ... }     // same package
public final class Square extends Shape { ... }     // same package
```

External code can't subclass `Shape` (no accessible constructor). The hierarchy is sealed by convention.

Java 17+ sealed classes formalize this:

```java
public sealed class Shape permits Circle, Square { ... }
```

Sealed is enforced by the compiler and verifier. Package-private constructors are enforced only by access rules. Both work; sealed is stronger and clearer.

---

## 9. Static imports for test readability

Test code commonly uses static imports:

```java
import static org.junit.jupiter.api.Assertions.*;
import static org.assertj.core.api.Assertions.assertThat;

@Test
void test() {
    assertEquals(2, add(1, 1));
    assertThat(list).contains("a");
}
```

This is one of the few cases where wildcard static imports are idiomatic. The assertion methods (`assertEquals`, `assertThat`, etc.) are widely understood; full qualification (`Assertions.assertEquals(...)`) is just noise.

For non-test code, prefer specific static imports.

---

## 10. The "fluent API" via static imports

Some libraries use static imports for fluent DSLs:

```java
import static com.example.querydsl.QUser.user;

selectFrom(user).where(user.active.eq(true));
```

Fine when the DSL is the dominant style. Don't import-static for general utility functions — clarity suffers.

---

## 11. Naming clashes: how to resolve

When two packages have classes with the same name:

```java
import java.util.Date;
import java.sql.Date;          // ❌ compile error: ambiguous
```

Resolutions:

- Single import for one, fully qualify the other:

```java
import java.util.Date;

public void process(Date utilDate, java.sql.Date sqlDate) { ... }
```

- Move them apart conceptually — if your code juggles both, model better.
- Use `import` aliasing? Java doesn't have it (unlike Kotlin's `import x.y as z`). You can extend or alias only via subclassing or type parameters.

Named clashes are a code smell. Often the fix is to clarify intent by introducing a wrapper type.

---

## 12. Module-level vs package-level encapsulation

Pre-Java 9 (classpath era):

- Public types are visible from anywhere on the classpath.
- Package-private is the only access boundary above private.

Java 9+ (modules):

- Public types are visible only within the module unless the package is `exported`.
- Package-private remains as before.

For **applications**, you usually don't need modules — the classpath model is fine. For **libraries** that publish stable APIs and want to hide internals, JPMS modules are the right tool.

A typical library structure:

```
com.example.lib            (api types — exported)
com.example.lib.internal    (impl types — NOT exported)
```

With `module-info.java`:

```java
module com.example.lib {
    exports com.example.lib;
    // internal stays hidden
}
```

---

## 13. Tests in the same package as production

Standard layout (Maven, Gradle):

```
src/main/java/com/example/banking/BankAccount.java        (production)
src/test/java/com/example/banking/BankAccountTest.java    (test)
```

Both compile to classes in `com.example.banking`. The test sees package-private members of production. **Don't widen production access for tests** — co-locate tests instead.

---

## 14. The middle-level checklist

For each new feature:

1. **Pick a package name** — reverse-DNS + feature name.
2. **Decide API vs internal** — split into sub-packages if needed.
3. **Default to package-private** — only API types are public.
4. **Add `package-info.java`** — document the public API and conventions.
5. **Test classes in same package** — preserve production access tightness.
6. **No cyclic dependencies** — check with `jdeps` or `archunit`.

For an existing codebase under refactor:

7. **Audit the public surface** — which classes have callers outside the package? Reduce.
8. **Consolidate "util" packages** — move utilities to their domain.
9. **Split overgrown packages** — if a package has 30+ classes, look for sub-features.
10. **Introduce module boundaries** if shipping as a library.

---

## 15. Summary

Packages are the architectural unit of Java. They:

- Provide a namespace.
- Define an access boundary.
- Group cooperating classes.
- Form the basis for module boundaries.

Pick package names deliberately. Default to package-private. Co-locate tests with production. Use sub-packages (api/internal) for libraries. The codebase that follows these rules is easier to read, refactor, test, and ship.
