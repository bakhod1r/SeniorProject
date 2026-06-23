# Moving Features Between Objects — Senior Level

> Architecture-scale impact, multi-repo migrations, the relationship between Move Method/Field and microservice boundaries, and tooling for safe class-level refactoring.

---

## Table of Contents

1. [From local moves to architecture](#from-local-moves-to-architecture)
2. [Move Method as a service-extraction precursor](#move-method-as-a-service-extraction-precursor)
3. [Extract Class → Extract Module → Extract Service](#extract-class-extract-module-extract-service)
4. [Tooling: IntelliJ, Eclipse, OpenRewrite, and ast-grep](#tooling-intellij-eclipse-openrewrite-and-ast-grep)
5. [Cross-module refactoring with Bazel and Maven multi-module](#cross-module-refactoring-with-bazel-and-maven-multi-module)
6. [Strangler Fig at the class boundary](#strangler-fig-at-the-class-boundary)
7. [Move Method under live traffic](#move-method-under-live-traffic)
8. [The Anti-Corruption Layer pattern](#the-anti-corruption-layer-pattern)
9. [Conway's Law and code organization](#conways-law-and-code-organization)
10. [Anti-patterns at scale](#anti-patterns-at-scale)
11. [Review questions](#review-questions)

---

## From local moves to architecture

A senior's lens on Moving Features:

> The placement of a method tells you what's coupled to what. The placement of a class tells you what changes together. Moving Features is how you **change those couplings on purpose**.

Three architecture-relevant outcomes from this category:

| Local refactor | Architecture-level signal |
|---|---|
| Move Method on a hot loop | The owning module is wrong → service boundary is wrong |
| Extract Class on a god class | A new module / package / library wants to be born |
| Hide Delegate across many call sites | A new public API is consolidating |
| Inline Class on a thin wrapper | An over-eager early abstraction reverts |

These are the small moves that, accumulated, look like *re-architecting* — without ever needing a 6-month rewrite.

---

## Move Method as a service-extraction precursor

The path from a method to its own microservice:

1. **Move Method** to the right class.
2. **Extract Class** so the method has a focused home.
3. **Move the class** to its own package / module.
4. **Move the module** to its own library / build target.
5. **Promote the library** to its own service (with an HTTP/gRPC API).
6. **Replace the method calls** with API calls (via Strangler Fig).

Every step is small, behavior-preserving, and reversible. The terrifying "let's extract a microservice" project becomes a 3-week stream of 5-line PRs.

> **Lesson:** if a method is on the wrong class, you don't have a method-placement problem. You have an *embryonic service-boundary* problem. Treat it accordingly.

---

## Extract Class → Extract Module → Extract Service

These are the three nested rings.

### 1. Extract Class

Same package, same JAR, same process. Pure refactoring, no deployment risk.

### 2. Extract Module / Package

Move to a sub-package; potentially make it a separate Maven module / Gradle subproject / Bazel target. New visibility constraints — only public methods are reachable across the boundary. **This is the moment when you discover what the class's public API actually is.**

### 3. Extract Service

Move to a separate process; communicate over the network. Adds latency, failure modes, deployment coupling — but unlocks independent scaling, language choice, team ownership.

### When to stop at each ring

- Stop at Extract Class if the boundary is mostly about cognitive load (one team, one repo).
- Stop at Extract Module if multiple teams own the codebase but share infra.
- Move to Extract Service if independent deploy, scaling, or language is required.

> **Microservice anti-pattern:** jumping from monolithic class to service in one step. You skip the class- and module-level refactorings and end up with a "distributed monolith" — services that change together, deploy together, and fail together. See [Couplers — middle.md](../../01-code-smells/05-couplers/middle.md).

---

## Tooling: IntelliJ, Eclipse, OpenRewrite, and ast-grep

### IntelliJ IDEA

| Refactoring | Shortcut (Mac) |
|---|---|
| Move Class | F6 |
| Move Method | F6 (caret on method) |
| Move Field | F6 (caret on field) |
| Extract Class | Refactor → Extract → Class... |
| Inline Class | ⌘⌥N (when caret on class name) |
| Change Signature | ⌘F6 |

IntelliJ runs static analysis to confirm the move is safe — including reflection-related warnings (Spring `@Autowired`, `Class.forName`).

### Eclipse JDT

Eclipse's "Move Members" wizard handles cross-package moves with explicit "fix imports" prompts. JDT was the original automated refactoring engine; it's still the gold standard for batch moves.

### OpenRewrite (Java/Kotlin/Groovy)

Recipes-as-code: declarative descriptions of refactorings that run as a build step.

```yaml
type: specs.openrewrite.org/v1beta/recipe
name: com.example.MoveDateUtilToShared
recipeList:
  - org.openrewrite.java.ChangePackage:
      oldPackageName: com.example.app.util
      newPackageName: com.shared.date
```

Run via Maven plugin: `mvn rewrite:run`. Used at scale by Spring upgrade tooling, JDK migration, and library deprecation cleanup.

### ast-grep / Comby

Language-agnostic structural search-and-replace. Useful when the refactoring is too custom for OpenRewrite recipes.

```bash
ast-grep --pattern 'getDepartment().getManager()' \
         --rewrite 'manager()' \
         **/*.java
```

### Codemod (Meta) / jscodeshift

JavaScript/TypeScript codemods. Used by Meta to refactor React's millions-of-lines codebase.

---

## Cross-module refactoring with Bazel and Maven multi-module

When the move crosses a build boundary, the build system enforces the constraint:

### Maven multi-module

Moving a class from `app-core` to `app-shared` means:
1. Add `app-shared` as a dependency of `app-core` (avoid cycles).
2. Move the class.
3. Update imports in `app-core`.

Maven's `<dependencies>` graph won't let you create a cycle. **The build system is your safety net.**

### Bazel

Even stricter: each `BUILD` file declares visibility (`//visibility:public`, `//some/package:__pkg__`). Moving a class requires updating both `BUILD` files. Bazel's `genquery` and `kind` tools help find every call site.

### Gradle

Similar to Maven but with `implementation` vs. `api` visibility — `api` exposes a transitive dependency, `implementation` doesn't. Moving a class to a module that's not exposed `api` will fail downstream builds — exactly the warning you want.

### Practical takeaway

> Build-system structure is **load-bearing** for refactoring at scale. Use it to your advantage — don't fight it.

---

## Strangler Fig at the class boundary

When you can't atomically move a class (too many callers, in-flight feature work, multiple teams):

1. Create the new class with the new API.
2. Have the old class delegate to the new one.
3. Migrate callers one by one (`OldThing.method()` → `NewThing.method()`).
4. When all callers migrated, mark `OldThing` deprecated.
5. After a soak period, remove `OldThing`.

This is **Strangler Fig at the class level**. Total disruption per PR is small; the bigger project happens in the background.

```java
@Deprecated // since 2026-Q2; use NewPricer
public class OldPricer {
    private final NewPricer delegate = new NewPricer();
    public Money price(Order o) { return delegate.priceFor(o); }
}
```

---

## Move Method under live traffic

When the method represents a service-level operation under load, you can't just rename it — callers break. Use Branch by Abstraction:

1. Define an interface that both old and new implementations can satisfy.
2. Inject the impl via DI (Spring, Guice, manual).
3. Toggle between impls with a feature flag.
4. Run shadow traffic on the new impl; compare results.
5. Cut over fully when confidence is high.
6. Delete old.

For pure refactoring (no behavior change intended), this is overkill — but for moves that *might* alter behavior (e.g., moving an order calculation between services), it's the safe path.

---

## The Anti-Corruption Layer pattern

When you Move a class across a bounded context (e.g., from `marketing` to `billing`), the two contexts may have **different mental models** of the same concept. A "Customer" in marketing has email + preferences; in billing it has billing address + tax id.

The Anti-Corruption Layer (ACL) is a translator class that lives at the boundary:

```java
class BillingCustomerFromMarketingTranslator {
    BillingCustomer translate(MarketingCustomer m) { ... }
}
```

This prevents the marketing model from leaking into billing's domain logic. Move Method/Field across contexts should typically pass through an ACL, not directly.

---

## Conway's Law and code organization

> "Organizations design systems that mirror their communication structure." — Melvin Conway, 1968.

If your `Pricing` team is in one timezone and your `Inventory` team is in another, the Pricing class and Inventory class **should not share state**. Move Method/Field across that boundary will regress next quarter when the teams diverge.

The senior move: identify Conway's-Law boundaries early, and use Moving Features to align code with team ownership. Tools:

- **Code-frequency-by-team analysis** (CodeScene, code-maat) — who changes what.
- **CODEOWNERS** files — explicit per-file ownership.
- **Service-team mapping** — each service has one owning team.

When Move Method would cross a team boundary, **stop**. Either the teams should merge (rare), or the code shouldn't be coupled (more often: extract a service).

---

## Anti-patterns at scale

### 1. The "feature manager" class

You created a `FeatureManager` to coordinate 12 services. Every new feature adds methods. The class is now 4000 lines. You're back to a god class — Extract every domain into its own thing.

### 2. Move Method orphans

You moved a method from A to B but left a stub in A that "just delegates." Six months later, the stub is the standard call path; nobody calls B directly. You've added a Middle Man without realizing.

### 3. Cross-module imports for Hide Delegate

You added a delegate method on `Person` that calls `Department.getManager()` — but `Department` lives in another module. Now `Person`'s module depends on `Department`'s module. If you intended to *break* the dependency, Hide Delegate is the wrong tool.

### 4. Extract Class without test coverage

Extract Class assumes you can verify behavior. Without tests, the move's correctness is opinion. Always characterize first.

### 5. Cyclic re-introduction

You moved a method from A to B last quarter; this quarter, you moved it back. Either the boundary is wrong, or the team's understanding shifted. Have a postmortem before the third move.

---

## Review questions

1. How does Move Method fit into the path from monolith to microservice?
2. What three nested rings of "Extract" exist (class, module, service)?
3. Why is build-system structure load-bearing for class moves at scale?
4. How does Strangler Fig apply at the class level?
5. What's an Anti-Corruption Layer? When does Move Method need one?
6. How does Conway's Law inform Move Method decisions?
7. What's a "Move Method orphan"? How do you avoid it?
8. Why might Hide Delegate make module dependencies *worse*?
9. When is "extract via Strangler Fig" overkill?
10. What tooling do you use for cross-repo moves?
