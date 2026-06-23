# Access Specifiers — Senior

> **How to optimize?** Treat access modifiers as a *physical layout* problem: minimize the public surface, group cooperating internals into the same package, and use modules to forbid the kind of leaks that classpath-era libraries inflicted on their consumers. Less surface ≡ less maintenance, faster JIT, fewer security holes.
> **How to architect?** Decide the access boundary at three scales — class, package, module — and align the project's directory structure with those boundaries. The hardest tightening you'll ever do is from `public` back to `private`; design it right the first time.

---

## 1. Three scales of encapsulation

| Scale     | Boundary                       | Java mechanism                              |
|-----------|--------------------------------|---------------------------------------------|
| Class     | Single type's internals         | `private`                                    |
| Package   | A cluster of cooperating types  | Package-private (no keyword)                 |
| Module    | A deployable unit (jar)         | `module-info.java` `exports` / `opens`       |

A senior architect picks all three deliberately:

- *Inside* the class: everything `private` unless an internal collaborator absolutely needs to see it.
- *Within the package*: cooperating types share package-private state; no public type leaves the package unless it's part of the package's API.
- *At the module*: `exports` only the API packages; everything else (utilities, internal protocols, vendor-specific glue) stays unreachable from outside the module.

Most legacy Java codebases (pre-9, monolithic jars, every type `public`) violate all three. Modernizing them is mostly an access-shrinking exercise.

---

## 2. Public surface = perpetual contract

Every public element has the cost profile of a long-running database table:

- It is **observable** from anywhere.
- Removing it is a **breaking change**.
- Renaming it is a breaking change.
- Changing its types is a breaking change.
- Tightening its preconditions or weakening its postconditions is a breaking change.
- Replacing it with a different implementation is generally fine — but only because the *public surface* hasn't changed.

So when you mark something `public`, you are committing to a maintenance burden that lasts as long as the API does.

The architectural counterpart: **a class with 30 public methods is a class with 30 ongoing maintenance commitments**. Reducing that to 5 well-chosen ones is one of the highest-ROI refactors in any codebase.

---

## 3. The "API class / Impl class" pattern

A senior pattern, especially in libraries:

```java
// Public, exported
public interface PaymentService {
    PaymentResult charge(PaymentRequest request);
}

// Package-private, NOT exported
final class DefaultPaymentService implements PaymentService {
    private final TaxClient tax;
    private final TransactionLog log;
    DefaultPaymentService(TaxClient tax, TransactionLog log) { ... }
    @Override
    public PaymentResult charge(PaymentRequest request) { ... }
}

// Public factory
public final class Payment {
    private Payment() {}
    public static PaymentService create(TaxClient tax, TransactionLog log) {
        return new DefaultPaymentService(tax, log);
    }
}
```

Callers see two `public` types: the interface and the factory. The implementation is invisible. You can rename, restructure, replace the implementation without breaking a single caller. The JIT can also more aggressively optimize calls into a `final` package-private class.

This is how `java.util` types like `List.of(...)` work — you get a `List` interface back; the actual `ImmutableCollections.ListN` is hidden.

---

## 4. Static factory methods are an access-control lever

A `public` constructor commits you to:

- Returning an instance of *exactly that class*.
- Always allocating a new object.
- Accepting whatever parameters you declared, in that order, forever.

A `public` static factory + `private` constructor commits to none of these. You can:

- Return a subtype, an existing cached instance, or `null` (well — please don't).
- Cache instances (`Boolean.valueOf`, `Integer.valueOf`).
- Lazy-construct.
- Add new factory methods without touching existing ones.

For library code, prefer factories. For application code, constructors are usually fine — you're the only consumer.

---

## 5. Stable public API = small public API

A useful exercise: write a one-page "API document" for each public class. List every public method, every public field, every public constructor. If the page exceeds a screen, the API is too big.

The Spec/JDK design ethos:

- `String` has ~70 public methods — and it represents one of the most basic types in the language.
- `List` interface has ~25 public methods.
- `HashMap` has ~10 unique methods beyond `Map`.

A new domain class with 50+ public methods is almost always solving the wrong problem (or solving the right problem at the wrong scale — split it).

---

## 6. Inheritance vs access: avoid `protected` for state

State should not cross inheritance boundaries through `protected` fields. The contract is too fragile:

```java
public abstract class Connection {
    protected boolean open;        // any subclass anywhere can set this
}
```

Subclasses can:

- Forget to update `open` after closing.
- Update it without coordinating with other state.
- Race with parent code that reads it.

Worse, the *parent* class now depends on subclass behavior — Liskov substitution becomes hopeful rather than enforced.

The senior fix: **state is private; subclasses interact via `protected` (or even `public abstract`) methods**. The parent owns `open`; subclasses get protected accessors and mutators with the right invariants.

```java
public abstract class Connection {
    private boolean open;
    protected final boolean isOpen()        { return open; }
    protected final void    markOpen(boolean v) { open = v; }   // controlled, final
}
```

The pattern: `protected final` *methods*, never `protected` fields.

---

## 7. The "sealed" architectural lever

Java 17's sealed classes give you a **closed set** of subtypes:

```java
public sealed interface AuthResult permits Allowed, Denied, NeedsMfa {}
```

This is access control over *extensibility*. Combined with pattern-matching `switch`, it gives the compiler exhaustiveness checking — adding a new variant forces every `switch` to update.

Use sealed when:

- You're modeling a state machine, AST, or result type.
- The set of subtypes is genuinely closed and known at design time.
- You want compile-time guarantees about handling every case.

Don't use sealed for:

- Open-ended hierarchies that third parties might extend (e.g., a plugin interface).
- Types where adding variants in patches is part of the design.

For library code, sealed is sometimes paired with `non-sealed` to allow controlled re-opening:

```java
public sealed class Shape permits Circle, Polygon {}
public non-sealed class Polygon extends Shape {}     // Polygon is open for extension
public final class Circle extends Shape {}
```

---

## 8. Modules: the deployable boundary

Java 9's module system formalized something the classpath couldn't:

- A `public` type in a non-exported package is invisible outside the module.
- Access to internals via reflection requires explicit `opens` declarations.
- Dependencies must be declared with `requires`.

The architectural payoff:

- You can write a *truly* internal helper class with confidence that no one outside your module is using it. (On the classpath, "everything `public` is fair game" was the de-facto rule, and JDK internals like `sun.misc.Unsafe` got abused for years.)
- You can refactor freely behind your `exports`.
- You can split a single jar into "API surface" and "implementation," with strong runtime enforcement.

The cost:

- Existing classpath-era code may need module fixups.
- Reflection-heavy frameworks need `opens` directives.
- Build tooling (Maven, Gradle) needs configuration.

Most internal applications don't bother with modules — JPMS is most valuable for **libraries** that need to publish a stable API. But every architect should know how it works.

---

## 9. Designing for evolution: add, don't change

The senior strategy for keeping public APIs stable while still evolving:

**(a)** **Add new methods**, don't change old ones. Even if they're slight tweaks, expose them as new names; deprecate old.

**(b)** **Use parameter objects** so adding a parameter doesn't change the signature:

```java
public PaymentResult charge(PaymentRequest request);  // request is a record — extensible
```

**(c)** **Use default methods on interfaces** — adding one doesn't break implementers.

**(d)** **Use the `Builder` pattern** for highly configurable APIs — adding a builder method doesn't break existing usage.

**(e)** **Mark experimental APIs**. Annotations (`@Experimental`, `@Beta`, `@PreviewFeature`) tell consumers "this may change." Less binding than `public`.

**(f)** **Defer `public` until forced**. New APIs often start package-private or as internal interfaces; only when a real client needs them are they widened.

---

## 10. The cost of `public final class` vs `public class`

Two architecturally meaningful decisions:

- `public class` (non-final): subclassing is part of your contract. Every internal call is potentially polymorphic. Every refactor must consider subclasses.
- `public final class`: subclassing is forbidden. You can refactor internals freely. The JIT can inline more aggressively (no CHA dependency).

For value types (immutable carriers), `public final class` is almost always right.

For framework base classes, `public class` is right — but document and design for it (template method pattern, `protected` final hooks, no overridable methods called from `<init>`).

For application service classes (`UserService`, `PaymentProcessor`), `public final class` is usually right — services aren't meant to be extended; injection of alternative implementations goes through interface boundaries.

---

## 11. Visibility and security

Access modifiers are *not* a security boundary against malicious code. They're enforced by the compiler and verifier, but:

- Reflection (`setAccessible(true)`) bypasses them — unless `opens` is restricted in JPMS.
- Native code or unsafe code (`sun.misc.Unsafe`) can read/write any memory.
- A subclass loaded by a different class loader may see a different version of a class than the calling code expects.

For real security boundaries, use:

- **Module strong encapsulation** (JPMS) — the only enforced cross-class boundary in modern Java.
- **Security Manager** (deprecated in 17, removed in 24) — was the legacy mechanism.
- **Process isolation** — separate JVMs / containers when you need real isolation.

So "this method is `private`" doesn't mean "an attacker can't call it." It means "trustworthy code that goes through normal language mechanisms can't call it."

---

## 12. Refactoring access — the playbook

A common refactor: *reduce* the visibility of an existing member.

The pattern:

1. **Identify** the member (`public` field, `public` method, `public` class).
2. **Survey callers**. IDE → "Find Usages." If the only callers are within the class, fine — make it `private`. If the only callers are within the package, fine — make it package-private. Else, look harder.
3. **For each external caller**: either the caller's needs are met by an existing public method (refactor the caller to use it), or the public method is missing (add one, deprecate the field, then change visibility in the next major version).
4. **Run the build**. Static analysis catches what you missed.
5. **Run the tests** — including integration and reflection-based ones, since access changes can break framework integrations.
6. **Document** the change in the changelog. If it's a `public → private` change, that's a breaking change; bump the major version.

This is patient work. The reward: years of cheaper future changes.

---

## 13. "Why is this `public`?" review checklist

For any new `public` declaration in a code review, ask:

1. Is there a *concrete external caller*? Name them.
2. Could the caller go through an existing public method instead?
3. Could the caller be in the same package? (Then package-private would do.)
4. Will this be stable for the next year? Five years?
5. Is the name something you can defend? Will it still be honest after refactors?
6. Is the parameter list extensible (parameter object) or rigid?
7. Is the return type the *minimum* that callers need (interface, not concrete class)?

If any answer is uncertain, push back. Public surface is permanent.

---

## 14. The common access architecture sins

| Sin                                      | Symptom                                          | Fix                                       |
|------------------------------------------|--------------------------------------------------|-------------------------------------------|
| All-`public` codebase                    | Every refactor breaks callers                    | Tighten incrementally, starting at fields |
| `protected` mutable fields               | Subclasses corrupt parent state                  | `private` field + `protected final` accessor |
| Test classes in a different package      | Production code ends up over-public              | Move tests to the same package            |
| Library with no internal package         | All implementations leak                         | Split `api` and `internal` packages       |
| One-class-per-package                    | Everything must be `public`                      | Group cooperating classes                 |
| Module with `exports` of `internal.*`    | Internals leak; no JPMS benefit                  | Don't export internal packages            |
| `setAccessible(true)` in production code | Future-fragile, JPMS-incompatible                | Use `MethodHandles.privateLookupIn(...)`  |

---

## 15. The senior checklist

For every public element on a code review:

1. **Necessary?** Concrete external caller named.
2. **Stable?** Will not change for foreseeable future.
3. **Minimal?** Smallest signature that satisfies the caller.
4. **Documented?** Nullability, exceptions, threading, lifecycle.
5. **Replaceable?** Could be redirected to internal implementation later.
6. **Extension-safe?** If subclassing is allowed, base class respects Liskov; if not, class is `final`.

For the package as a whole:

7. **API surface** is one or two types; rest is package-private.
8. **No `protected` mutable fields**.
9. **Test access** is via same-package tests, not by widening production access.

For the module / library:

10. **`exports`** only `api` packages.
11. **`opens`** only what reflection-using consumers explicitly need.
12. **No public types in `internal.*`**.

Senior architecture is *quiet*: things are easy to use, hard to misuse, and easy to change later. Aggressive use of access modifiers is the cheapest way to get there.
