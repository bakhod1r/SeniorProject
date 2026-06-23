# Packages — Senior

> **How to optimize?** Use packages as the *architectural backbone*. A clean package structure prevents the codebase from devolving into a flat soup of classes; a clean dependency graph keeps refactoring affordable.
> **How to architect?** Group classes by *bounded context* (DDD), separate API from implementation, enforce dependency direction, and graduate to JPMS modules when shipping as a library or when strong encapsulation is required.

---

## 1. Packages as bounded contexts

In Domain-Driven Design, a *bounded context* is a self-contained area of the domain with its own model and language. In Java, **packages are the natural unit for bounded contexts**:

```
com.example.payments          (Payment, PaymentMethod, PaymentService)
com.example.users             (User, UserService, UserRepository)
com.example.notifications     (Notification, EmailSender, NotificationService)
```

Each package owns its model. Cross-package interactions go through *clearly defined APIs* — typically a small number of public types.

Anti-pattern: a single `com.example.model` package containing every domain class. The package is just a junk drawer; nothing inside cooperates by design.

---

## 2. Dependency direction is architecture

A clean codebase has its package dependencies form a DAG (directed acyclic graph). The direction usually follows:

```
api / domain                        (high-level abstractions)
  ↓
infrastructure / persistence       (implementation details)
  ↓
external / framework                (third-party adapters)
```

Higher-level packages depend on lower-level ones — never the reverse. This is the *Dependency Inversion Principle* applied at the package level.

Cycles between packages are an architectural smell. They mean two packages have intertwined concerns. The fix is usually:

- Extract shared types into a separate package.
- Introduce an interface in one package that the other implements.
- Merge the two packages if they're really one concern.

Use `jdeps`, `archunit`, or IntelliJ's "Dependency Structure Matrix" to detect cycles.

---

## 3. The "API / impl / domain" tripartite

For each feature/module, a senior structure:

```
com.example.payments/
├── api/                              (exported, public)
│   ├── PaymentRequest.java            (record — input DTO)
│   ├── PaymentResult.java             (sealed interface — output)
│   ├── PaymentService.java            (interface)
│   └── package-info.java
├── domain/                           (mostly public; pure types)
│   ├── Money.java                      (value)
│   ├── PaymentId.java                  (value)
│   └── PaymentMethod.java              (enum/sealed)
└── internal/                         (NOT exported)
    ├── DefaultPaymentService.java    (package-private impl)
    ├── TransactionLog.java
    ├── RetryPolicy.java
    └── PaymentDispatcher.java
```

Three responsibilities:

- `api`: what consumers see — interfaces, DTOs.
- `domain`: stable value/entity types that may be shared with other features.
- `internal`: implementation details, hidden.

External callers `import com.example.payments.api.*` and `com.example.payments.domain.*`. They never touch `internal/*`.

---

## 4. The "shared kernel" pattern

When multiple features share a small set of value types, extract them into a *shared kernel* package:

```
com.example.shared/
├── Money.java
├── Email.java
├── PhoneNumber.java
└── Result.java
```

This package is depended on by many but depends on nothing. Keep it small — the more it grows, the more it becomes a god-package.

Shared kernels often contain:

- Cross-domain value types (`Money`, `Email`).
- Generic abstractions (`Result<T,E>`, `Either<L,R>`).
- Common exceptions.

Don't put domain-specific types here. `User` belongs in `users`, not in `shared`.

---

## 5. Package-private as the default access

A senior architectural principle: **everything is package-private until proven otherwise public**. Each `public` is a permanent maintenance commitment.

Practical consequences:

- A "public" class in your codebase is one of perhaps a dozen API entry points per feature.
- Most classes are package-private — only siblings see them.
- Tests live in the same package, accessing internals naturally.
- Refactoring internal classes doesn't ripple beyond the package.

Codebases that follow this rule have *much* smaller public surfaces — often 5-10x fewer public classes than typical "everything public" codebases.

---

## 6. Module boundaries vs package boundaries

Two scales:

- **Package**: enforced by `javac` and the JVM verifier. Package-private members are unreachable from outside.
- **Module** (JPMS): enforced at runtime. Even `public` types are unreachable from outside if the package isn't `exported`.

When to use each:

- Packages alone: applications, internal tools, services. The classpath model is fine.
- Modules: libraries that publish a stable API; multi-team monorepos with strict separation; security-sensitive code.

For libraries, modules are increasingly the right answer. They let you confidently mark "internal" packages truly internal.

---

## 7. The classpath / modulepath migration

A real-world migration path from classpath to JPMS:

1. **Stage 0**: classpath app, no `module-info.java`.
2. **Stage 1**: add `module-info.java` to your library jars. Apps can still consume them on the classpath.
3. **Stage 2**: apps add their own `module-info.java`. Now everything runs as named modules.

Most enterprise apps stop at stage 0 or 1. Library authors typically reach stage 1 (and modular consumers reach stage 2).

The benefit of stage 1: you control what your library exports. Consumers using reflection on internal packages get errors, forcing them to use the documented API.

---

## 8. Strict-by-default access discipline

Every senior codebase trends toward strict access:

| Element             | Default                         | Loosen when                            |
|---------------------|----------------------------------|----------------------------------------|
| Class               | package-private                  | API entry point                        |
| Field               | private                          | rarely loosen                          |
| Method              | package-private                  | API method                             |
| Constructor         | package-private or private       | API construction                       |
| Nested class        | private static                   | API helper                             |

The codebase has 5-10% public classes; the rest are package-private or nested-private. This isn't aesthetic — it directly correlates with refactoring cost.

---

## 9. Naming the package hierarchy

Reverse-DNS prefix + project + module + sub-module:

```
com.acme.fintech.payments
com.acme.fintech.payments.api
com.acme.fintech.payments.internal
com.acme.fintech.users
com.acme.fintech.shared
```

Architectural rules:

- Top-level prefix is your organization (`com.acme.fintech`).
- Project namespace below (`payments`, `users`, `shared`).
- Sub-packages for sub-concerns (`api`, `internal`, `domain`).
- 2-4 levels of nesting; deeper hierarchies become hard to navigate.

For multi-product organizations, add product after company: `com.acme.fintech.product1.feature`.

---

## 10. The "vertical slice" architecture

Trends in modern web app design favor *vertical slice architecture* — each feature is a self-contained vertical:

```
com.example.app/
├── users/
│   ├── api/                    (REST controllers)
│   ├── domain/                  (User entity, value types)
│   ├── service/                 (UserService — orchestration)
│   └── persistence/            (repositories, DB mapping)
├── payments/
│   ├── api/
│   ├── domain/
│   ├── service/
│   └── persistence/
└── shared/                       (kernel)
```

Each top-level directory is a slice. Slices don't depend on each other directly — they communicate via well-defined APIs (or events).

This contrasts with *horizontal layers* (`controllers`, `services`, `repositories` as top-level). Vertical slices scale better as features multiply.

---

## 11. Architectural tests with ArchUnit

Senior codebases enforce architectural rules in tests:

```java
@Test
void services_should_only_depend_on_apis_or_domain() {
    classes()
        .that().resideInAPackage("..service..")
        .should().onlyDependOnClassesThat()
        .resideInAnyPackage("..api..", "..domain..", "java..", "javax..")
        .check(importedClasses);
}

@Test
void no_cycles_between_features() {
    slices().matching("com.example.(*)..").should().beFreeOfCycles().check(...);
}

@Test
void controllers_should_be_in_api_packages() {
    classes().that().areAnnotatedWith(RestController.class)
        .should().resideInAPackage("..api..")
        .check(...);
}
```

ArchUnit (or jQAssistant, Sonargraph) makes architecture *executable*. New PRs that violate the rules fail CI.

---

## 12. The "split package" anti-pattern

Two jars contributing classes to the *same* package:

```
lib-a.jar:  com.example.shared.Foo
lib-b.jar:  com.example.shared.Bar
```

Pre-modules: legal but confusing — depends on classpath order.
Post-modules: explicitly forbidden. Each package must be in exactly one module.

If you find a split package, consolidate or rename. Package boundaries are meaningful only when they're respected.

---

## 13. Package documentation

Senior packages have a `package-info.java`:

```java
/**
 * Payment processing domain.
 *
 * <h2>Public API</h2>
 * <ul>
 *   <li>{@link PaymentService} — primary entry point</li>
 *   <li>{@link PaymentRequest} — input DTO</li>
 *   <li>{@link PaymentResult} — sealed result type</li>
 * </ul>
 *
 * <h2>Threading</h2>
 * All public APIs are thread-safe.
 *
 * <h2>Stability</h2>
 * API stable since 1.0; experimental classes are marked {@code @Beta}.
 */
@NonNullByDefault
package com.example.payments;
```

This is the package's manifest. New developers reading the package learn the contract from `package-info.java` before reading individual classes.

---

## 14. The senior architectural moves

When designing a new module:

1. **Bounded context**: identify the feature's domain.
2. **Package by feature**: one top-level package per context.
3. **API/internal split**: sub-packages for clarity.
4. **Access defaults**: package-private; loosen only with cause.
5. **Document**: `package-info.java` with public API summary.
6. **Test co-location**: same package as production.
7. **Architecture tests**: enforce rules in CI.
8. **Modules** (if library): `module-info.java` with explicit `exports`.

When refactoring legacy:

- Identify packages with high public-surface ratios; tighten.
- Find utility packages; redistribute classes by feature.
- Detect cycles; break by inverting one direction.
- Consolidate split packages.
- Add `package-info.java` to undocumented packages.

---

## 15. The senior checklist

For each package:

1. **Cohesion**: classes inside cooperate; nothing unrelated.
2. **API surface**: 1-3 public types max.
3. **Internal hiding**: implementation in `internal` sub-package.
4. **Naming**: clear, hierarchical, lowercase.
5. **Documentation**: `package-info.java` with summary.
6. **Tests**: same-package, no production access widening.
7. **Dependencies**: DAG; no cycles.

For the codebase as a whole:

8. **Vertical slices** preferred over horizontal layers.
9. **Architecture tests** in CI.
10. **JPMS modules** for libraries; classpath for apps.
11. **Shared kernel** for truly cross-cutting types.
12. **Naming hierarchy** mirrors organizational structure.

The senior mantra: **packages are the architecture**. Every other architectural decision flows from how the packages are structured. Get this layer right and the codebase scales; get it wrong and every feature fights the structure.
