# Simplifying Method Calls — Senior Level

> API design at scale, semantic versioning, deprecation strategies, and how method-call refactorings ripple through systems.

---

## Table of Contents

1. [The cost of breaking changes](#the-cost-of-breaking-changes)
2. [Semantic versioning and method changes](#semantic-versioning-and-method-changes)
3. [Strangler Fig at the method level](#strangler-fig-at-the-method-level)
4. [API design principles](#api-design-principles)
5. [Wide-to-narrow refactoring](#wide-to-narrow-refactoring)
6. [Migrating exception-based to Result-based](#migrating-exception-based-to-result-based)
7. [Renames at scale: codemods and tooling](#renames-at-scale-codemods-and-tooling)
8. [Cross-language API consistency](#cross-language-api-consistency)
9. [Anti-patterns at scale](#anti-patterns-at-scale)
10. [Review questions](#review-questions)

---

## The cost of breaking changes

In a small codebase, Rename Method is one IDE keystroke. In a public library:

- Every consumer must update their code.
- Build/dependency tools must be updated.
- Major version bump required (per semver).
- Migration guide written.
- Support burden during transition.

Senior engineers calibrate refactoring ambition by **blast radius**:

| Scope | Cost of refactor |
|---|---|
| Within a class | Free |
| Within a module | Cheap |
| Within a service | Medium |
| Across services | High |
| Public API consumed by others | Very high |
| Library on Maven Central | Career-impacting |

Within-service: rename freely. Public API: consider 5×.

---

## Semantic versioning and method changes

[Semantic Versioning](https://semver.org/): MAJOR.MINOR.PATCH.

| Method change | Version impact |
|---|---|
| Rename method | MAJOR (breaking) |
| Add parameter (non-default) | MAJOR |
| Add overload (preserving old) | MINOR |
| Remove parameter | MAJOR |
| Tighten parameter type (e.g., String → URI) | MAJOR |
| Loosen return type (e.g., concrete → interface) | MINOR (sometimes) |
| Add throws of unchecked exception | depends on documentation |
| Hide method (public → private) | MAJOR |
| Add public method | MINOR |
| Bug fix | PATCH |

In Java, even adding a default method to an interface is technically MINOR but can break consumers compiling against older versions.

### Spring's pattern

Spring Framework deprecates a method in version N, removes in N+1. Their `@Deprecated(since = ..., forRemoval = true)` is the canonical pattern.

### Library migration

For widely-used libraries, plan migrations on a 12-month timeline:
- v5.0: deprecate.
- v5.x: deprecation notes in changelog.
- v6.0: remove.

---

## Strangler Fig at the method level

When you can't atomically rename or change a public method:

```java
// Old API — kept around
@Deprecated
public Money getCharge() { return totalIncludingTax(); }

// New API
public Money totalIncludingTax() { ... }
```

Internal consumers migrate. External consumers see deprecation warnings. Eventually, the old is removed.

For breaking signature changes:

```java
// v5.x:
public Result process(Order o) { ... }

// v5.0 → 6.0 transition:
public Result process(Order o, Policy p) { ... }   // new
@Deprecated public Result process(Order o) {        // old delegates
    return process(o, defaultPolicy());
}

// v6.0:
public Result process(Order o, Policy p) { ... }    // only this remains
```

---

## API design principles

When crafting a new method (or refactoring an existing one):

### 1. Hard to misuse

```java
sendEmail(to, subject, body, attachments, urgent, retry);   // ❌ booleans
```

vs.

```java
EmailRequest.builder().to(addr).subject(s).body(b).urgent().send();   // ✓ named, fluent
```

### 2. Consistent

If `getX()` exists, also have `setX()` (or none). If `withPolicy(...)` returns a new instance, all `with*` methods do.

### 3. Minimal

Default to private. Only expose what consumers genuinely need.

### 4. Honest

Method name reflects effect. `getX()` doesn't mutate. `applyDiscount()` does mutate (or returns new).

### 5. Pit of success

The default invocation is the right one. `Logger.info(...)` is harmless. Hard cases require deliberate setup (`Logger.atSensitiveLevel().with(...)`).

> Reference: Joshua Bloch's *Effective Java*, Item 2 (Builder pattern), Item 51 (API design).

---

## Wide-to-narrow refactoring

When a method's parameter type is too wide:

```java
public void process(Object o) { ... }
```

is "polite" — accepts anything — but **forces** internal type checking and downcasting. Replacing with a narrower type:

```java
public void process(Order o) { ... }
```

Pushes the type discipline outward, making bugs visible at compile time.

### Trade-off

- Narrow types fail-fast at the boundary; wide types push failures into the body.
- Generic / parameterized types let you have your cake and eat it: `<T>` constrained where needed.

### When wide is right

- True polymorphism where any type is acceptable (e.g., `Object.equals(Object)`).
- Generic containers (`List<E>` as a parameter — accept any list).

---

## Migrating exception-based to Result-based

In some Java codebases, consumers want explicit error handling without exceptions. The `Result<T, E>` type (from Vavr, Cats, or hand-rolled):

```java
public Result<Money, ChargeError> charge(Card c, Money amount) {
    if (!c.isValid()) return Result.err(ChargeError.INVALID_CARD);
    if (amount.isNegative()) return Result.err(ChargeError.INVALID_AMOUNT);
    return Result.ok(processCharge(c, amount));
}
```

### When to migrate

- Heavy exception use is hurting performance (deep stack capture).
- Errors are part of normal flow (validation, business rules).
- You want compile-time enforcement of error handling.

### When to stay with exceptions

- Most consumers expect exception-based APIs.
- Errors really are exceptional.
- Migration cost outweighs benefit.

### Migration approach

1. Add the Result-returning version alongside the throwing version.
2. Internally, the throwing version delegates to the Result version with `.getOrThrow()`.
3. Migrate callers gradually.
4. Eventually deprecate the throwing version.

---

## Renames at scale: codemods and tooling

For renaming a method across 200 microservices, IDE refactor isn't enough.

### OpenRewrite

```yaml
type: specs.openrewrite.org/v1beta/recipe
name: com.example.RenameOrderTotalMethod
displayName: Rename Order.getCharge to Order.totalIncludingTax
recipeList:
  - org.openrewrite.java.ChangeMethodName:
      methodPattern: "com.example.Order getCharge()"
      newMethodName: "totalIncludingTax"
```

Run via Maven plugin across all consumer repos.

### ast-grep

For polyglot codebases:
```bash
ast-grep --pattern '$X.getCharge()' --rewrite '$X.totalIncludingTax()' **/*.java
```

### jscodeshift / TypeScript transforms

For frontend / Node.js codebases.

### IDE batch refactoring

IntelliJ "Migrate to..." commands handle some standard library migrations (e.g., Java's `Files.readString` instead of `Files.readAllBytes`).

---

## Cross-language API consistency

When the same domain is exposed in multiple languages (Java SDK, Python SDK, Go SDK):

### Naming

- Same conceptual operation should have the same method name across languages: `client.send_message` (Python) ↔ `client.sendMessage` (Java) ↔ `client.SendMessage` (Go).
- Idiomatic capitalization per language.

### Errors

- Java: throws `MessageException`.
- Python: raises `MessageError`.
- Go: returns `error`.
- Rust: returns `Result<_, MessageError>`.

Each language uses its native idiom; the *information* conveyed is consistent.

### Result types

OpenAPI / Protobuf / GraphQL schemas often serve as the canonical contract. Codegen produces SDKs in each language consistently.

---

## Anti-patterns at scale

### 1. The renamed method graveyard

A class has `process()`, `processV2()`, `processNew()`, `processNewV2()`. Each was the "right" version at some point. Pick one; deprecate the rest.

### 2. Too many overloads

```java
public Result process(Order o);
public Result process(Order o, Policy p);
public Result process(Order o, Policy p, Clock c);
public Result process(Order o, Policy p, Clock c, Logger l);
```

You've created the overload combinatorial explosion. Use parameter object or builder.

### 3. Exception soup

```java
public Order place(...) throws ValidationException, NetworkException, DBException, AuthException;
```

Five different concerns. Either unify behind a domain exception (`OrderException`), use `Result<Order, OrderError>`, or split the method.

### 4. Lying names

`Customer.deleteAccount()` that... soft-deletes by setting a flag. Rename to `markDeleted()` or actually delete.

### 5. Permanent deprecation

`@Deprecated` since 2018. Either remove or undeprecate. Permanent deprecation is noise.

---

## Review questions

1. What's the cost calibration for refactoring depending on scope?
2. What's the semver impact of common method changes?
3. What's Strangler Fig at the method level?
4. What are 5 principles of good API design?
5. Why is "wide-to-narrow" parameter typing a refactoring direction?
6. When migrate from exceptions to Result types?
7. What is OpenRewrite useful for?
8. Why use ast-grep for polyglot rename?
9. Why do SDKs in different languages keep names consistent across capitalization?
10. What's the anti-pattern of "permanent deprecation"?
