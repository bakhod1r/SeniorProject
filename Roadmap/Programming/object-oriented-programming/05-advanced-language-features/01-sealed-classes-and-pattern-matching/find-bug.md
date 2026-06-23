# Sealed Classes and Pattern Matching — Find the Bug

> 10 buggy snippets, each illustrating a silent failure mode in sealed types or pattern matching that compiles, looks fine in review, and only bites at runtime, across modules, after a permits change, or under generic erasure. For each: read the code, identify the mechanism, find the runtime symptom (`MatchException`, `NullPointerException`, missing case, wrong dispatch), and write down the fix.

---

## Bug 1 — Adding a permit breaks every downstream consumer's switch

```java
// In library v1
public sealed interface OrderEvent permits Placed, Shipped, Cancelled {}
public record Placed(long id)    implements OrderEvent {}
public record Shipped(long id)   implements OrderEvent {}
public record Cancelled(long id) implements OrderEvent {}
```

```java
// In consumer code, compiled against library v1
public String describe(OrderEvent e) {
    return switch (e) {
        case Placed p    -> "placed " + p.id();
        case Shipped s   -> "shipped " + s.id();
        case Cancelled c -> "cancelled " + c.id();
    };          // no default — relies on exactly three permits
}
```

```java
// In library v2 (released six months later)
public sealed interface OrderEvent permits Placed, Shipped, Cancelled, Returned {}
public record Returned(long id) implements OrderEvent {}
```

**Symptom.** The consumer's binary, recompiled against neither library nor patched, throws at runtime the moment an `OrderEvent` instance is actually a `Returned`:

```
Exception in thread "events" java.lang.MatchException: Returned[id=42]
    at com.acme.events.Describer.describe(Describer.java:5)
```

The switch was *compiled* as exhaustive over `{Placed, Shipped, Cancelled}`, so `javac` emitted no default branch. The runtime adds a synthetic throw of `MatchException` for the unmatched case. The consumer's tests pass — none of them constructed a `Returned`. Only production traffic surfaces the bug.

**Violation.** Binary compatibility. Adding a permit is *not* source-compatible if downstream relies on exhaustiveness.

**Fix.** Choose one of:

1. **Library side:** treat the permit addition as a major-version event. Bump the library's major version; release notes warn consumers to recompile their exhaustive switches.
2. **Consumer side:** if the consumer must straddle versions, add a `default` branch — accepting that the switch loses exhaustiveness for *all future* additions, including the next one. Trade safety for compatibility, explicitly.
3. **Design side:** if the library is meant to be extended over time, do not seal in the first place. An open interface costs nothing to extend.

See [senior.md](senior.md) and [professional.md](professional.md) for the deprecation cycle.

---

## Bug 2 — `non-sealed` introduces an unexpected variant

```java
public sealed interface Notification permits Email, Sms, Internal {}

public record Email(String to, String body) implements Notification {}
public record Sms(String to, String body)   implements Notification {}
public non-sealed interface Internal extends Notification {
    String render();
}
```

```java
public BigDecimal cost(Notification n) {
    return switch (n) {
        case Email e -> EMAIL_COST;
        case Sms s   -> SMS_COST;
        case Internal i -> BigDecimal.ZERO;
    };
}
```

A junior, working in a separate module, adds:

```java
public class SmsLikeInternal implements Internal {
    @Override public String render() { return "internal-sms"; }
}
```

**Symptom.** Marketing reports complain that "internal SMS" sends count as free. The cost switch returns `BigDecimal.ZERO` for the new class because `SmsLikeInternal` is an `Internal`, not an `Sms` — the type that was meant to carry the SMS pricing.

**Violation.** `non-sealed` reopened the closure. The switch is *exhaustive* over `Notification`, but `Internal` is a wide door — the author of the switch didn't anticipate someone routing SMS-shaped notifications through it.

**Fix.** Either drop `non-sealed` (close the hierarchy back up) or split the pricing logic so that the `Internal` branch is not a sweeping `BigDecimal.ZERO`. Often the right move is to recognise that "internal" was the wrong sealed slot and demote it to an open interface that doesn't participate in dispatch:

```java
public sealed interface Notification permits Email, Sms {}
public interface Internal { String render(); }   // separate, open

// Notifications get costed; internal renderers don't go through the cost switch.
```

`non-sealed` is a permanent open door. Use it only when the door is part of the public contract.

---

## Bug 3 — `default` swallows the next permit

```java
public sealed interface Shape permits Circle, Square, Triangle {}
public record Circle(double r)             implements Shape {}
public record Square(double s)             implements Shape {}
public record Triangle(double b, double h) implements Shape {}

public double area(Shape s) {
    return switch (s) {
        case Circle c   -> Math.PI * c.r() * c.r();
        case Square sq  -> sq.s() * sq.s();
        case Triangle t -> 0.5 * t.b() * t.h();
        default         -> 0.0;          // "for safety"
    };
}
```

Six months later, a teammate adds `Pentagon` to `permits`:

```java
public sealed interface Shape permits Circle, Square, Triangle, Pentagon {}
public record Pentagon(double side) implements Shape {}
```

**Symptom.** No compile error. No test failure (no test constructed a `Pentagon`). The geometry library starts reporting *zero* area for every pentagon. The bug surfaces months later when a CAD operation produces a negative bounding box.

**Violation.** The `default` clause turned off the compiler's exhaustiveness check. When the new permit arrived, the switch didn't break — and so the new variant didn't get an `area` formula.

**Fix.** Delete the `default`. Let the switch be exhaustive. The next time someone adds a permit, this method turns red and forces a real decision.

```java
public double area(Shape s) {
    return switch (s) {
        case Circle c   -> Math.PI * c.r() * c.r();
        case Square sq  -> sq.s() * sq.s();
        case Triangle t -> 0.5 * t.b() * t.h();
        case Pentagon p -> 0.25 * Math.sqrt(5 * (5 + 2 * Math.sqrt(5))) * p.side() * p.side();
    };
}
```

ArchUnit-enforce "no `default` on a sealed switch" so this doesn't happen again. See [professional.md](professional.md).

---

## Bug 4 — Record pattern and null

```java
public sealed interface Either<L, R> permits Left, Right {}
public record Left<L, R>(L value)  implements Either<L, R> {}
public record Right<L, R>(R value) implements Either<L, R> {}

public static <L, R> String describe(Either<L, R> e) {
    return switch (e) {
        case Left(L v)  -> "left: " + v;
        case Right(R v) -> "right: " + v;
    };
}
```

```java
Either<String, Integer> e = null;
describe(e);
```

**Symptom.**

```
Exception in thread "main" java.lang.NullPointerException
    at com.acme.Either.describe(Either.java:5)
```

A `switch` over a sealed type throws `NullPointerException` if the scrutinee is `null` and no `case null` is present. The record pattern syntax (`Left(L v)`) does not change this. The author assumed the type system would guard against null because the parameter is a generic `Either<L, R>` — but Java references are nullable.

Worse: with record patterns, even a non-null `Left(null)` *also* throws NPE in some Java versions, because the record pattern calls the component accessor (`value()`) implicitly — and on Java 21+ a `case Left(L v)` where the component is null binds `v` to null and matches. The behaviour changed between previews; you must test on the JDK you ship.

**Violation.** The switch contract was "every value of `Either<L, R>` is handled". `null` is technically a value of every reference type.

**Fix.** Add `case null` explicitly when null is a meaningful input:

```java
return switch (e) {
    case null       -> "neither";
    case Left(L v)  -> "left: " + v;
    case Right(R v) -> "right: " + v;
};
```

Or document that the parameter must be non-null and guard with `Objects.requireNonNull(e)` at the entry of the method.

---

## Bug 5 — Reflection over `getPermittedSubclasses` outpaces the class loader

```java
public class SealedRegistry<T> {
    private final Map<Class<?>, Function<T, ?>> handlers = new HashMap<>();

    public SealedRegistry(Class<T> sealedRoot) {
        if (!sealedRoot.isSealed()) throw new IllegalArgumentException();
        for (Class<?> permitted : sealedRoot.getPermittedSubclasses()) {
            handlers.put(permitted, Function.identity());
        }
    }
}
```

Used like:

```java
public sealed interface Event permits Created, Updated, Deleted {}

new SealedRegistry<>(Event.class).handlers().keySet();
// Expected: {Created.class, Updated.class, Deleted.class}
```

**Symptom.** In a modular Java application, the registry behaves correctly during integration tests but loses entries in production:

```
{Created.class}    // only one of the three permits is present
```

`getPermittedSubclasses()` returns `Class<?>[]` from the `PermittedSubclasses` attribute (JVMS §4.7.31). The JVM resolves each class reference *lazily* — only when the class is actually used. If `Updated` and `Deleted` have not been loaded by the time `getPermittedSubclasses` is called, the returned `Class<?>` objects may be `null` (depending on JDK version and resolution strategy) or absent from the array.

**Violation.** Treating `getPermittedSubclasses` as a guaranteed-eager class loader.

**Fix.** Trigger class loading explicitly (e.g., a `ServiceLoader` configuration, or a `Class.forName(name)` over the canonical names), or stop relying on reflection for runtime dispatch. The pattern-match `switch` is the supported dispatch primitive for sealed types; reflection-based registries are best for tooling, documentation, and tests.

```java
// Force-load every permit at registry construction
for (Class<?> permitted : sealedRoot.getPermittedSubclasses()) {
    try { Class.forName(permitted.getName(), true, sealedRoot.getClassLoader()); }
    catch (ClassNotFoundException e) { throw new IllegalStateException(e); }
}
```

---

## Bug 6 — Sealed type and module boundaries

```java
// module: com.acme.core
package com.acme.core;
public sealed interface Account
    permits com.acme.checking.Checking, com.acme.savings.Savings {}
```

```java
// module: com.acme.checking
module com.acme.checking { requires com.acme.core; }

package com.acme.checking;
public record Checking(long id) implements com.acme.core.Account {}
```

**Symptom.**

```
error: class is not allowed to extend sealed class:
       com.acme.core.Account (in module com.acme.core)
```

The compiler refuses the declaration. `permits` may not name a class in a *different module* (JLS §8.1.6).

**Violation.** Cross-module sealing. The closure of `Account` is required to be verifiable inside one module so the JLS rule can run without loading the entire module graph.

**Fix.** Move all permits and the sealed root into one module, *or* expose the sealed root and its variants through a single `api` module that the consumers `require`. The consumers cannot themselves contribute to the closure.

```java
// One module that owns the sealed type and all its permits
module com.acme.accounts {
    exports com.acme.accounts.api;
}

package com.acme.accounts.api;
public sealed interface Account permits Checking, Savings {}
public record Checking(long id) implements Account {}
public record Savings(long id)  implements Account {}
```

The decision is: is this sealed type the design of *one* module or *several*? The compiler will not let you have it both ways. See [../02-jpms-modules/](../02-jpms-modules/).

---

## Bug 7 — Legacy code branches on `getClass().getSimpleName()`

```java
public BigDecimal taxFor(Product p) {
    String simple = p.getClass().getSimpleName();
    return switch (simple) {
        case "Book"       -> ZERO_TAX;
        case "Food"       -> REDUCED_TAX;
        case "Electronic" -> STANDARD_TAX;
        default           -> STANDARD_TAX;
    };
}
```

Later, you seal the type:

```java
public sealed interface Product permits Book, Food, Electronic {}
```

And someone adds a new variant:

```java
public record Subscription(String plan) implements Product {}
```

**Symptom.** Subscriptions are silently taxed at the *standard* rate because the string-keyed switch has no `Subscription` case and falls through to the `default`. Sealing the parent did nothing because the dispatch is via reflection over the simple name, not over the type system. Finance reports a tax shortfall.

**Violation.** The dispatch escaped the type system. Pattern-match `switch` would have flagged the missing case; string-keyed `switch` does not.

**Fix.** Replace the reflection dispatch with a pattern-match switch:

```java
public BigDecimal taxFor(Product p) {
    return switch (p) {
        case Book b         -> ZERO_TAX;
        case Food f         -> REDUCED_TAX;
        case Electronic e   -> STANDARD_TAX;
        case Subscription s -> SUBSCRIPTION_TAX;
    };
}
```

Now the next addition to `permits` produces a red compile and a real decision. See [middle.md](middle.md) for the broader refactor of string-keyed dispatch into sealed switches.

---

## Bug 8 — Pattern guard with a side effect

```java
public sealed interface Action permits Approve, Deny, Pending {}
public record Approve(String reason) implements Action {}
public record Deny(String reason)    implements Action {}
public record Pending(String reason) implements Action {}

public static String process(Action a, AuditLog audit) {
    return switch (a) {
        case Approve x when audit.recordApproval(x) -> "approved";
        case Deny x    when audit.recordDenial(x)   -> "denied";
        case Pending x                              -> "pending";
        case Approve x                              -> "approved (no audit)";
        case Deny x                                 -> "denied (no audit)";
    };
}
```

**Symptom.** Audit records appear for some actions but not others, and the pattern is impossible to predict. A `Deny` action whose `audit.recordDenial` returns `false` (audit log full, throttle hit) falls through to `case Deny x` (no audit). The author intended the second `Deny` case to be a fallback when audit *fails*; it actually fires when the guard returned `false`. The audit side effect ran anyway.

**Violation.** Guards are predicates. Putting side effects in a guard couples *the act of checking* to *the act of doing*, and the pattern-match semantics — try guards in order, fall through when a guard returns `false` — does not respect the side-effect ordering you might expect.

**Fix.** Pull the side effect out of the guard:

```java
public static String process(Action a, AuditLog audit) {
    return switch (a) {
        case Approve x -> {
            audit.recordApproval(x);
            yield "approved";
        }
        case Deny x -> {
            audit.recordDenial(x);
            yield "denied";
        }
        case Pending x -> "pending";
    };
}
```

The audit fires once, in a defined place, regardless of return value. The switch is exhaustive over the sealed type without overlapping cases.

---

## Bug 9 — `instanceof` pattern variable scope leak

```java
public void process(Request r) {
    if (!(r instanceof AuthorizedRequest auth)) {
        log.warn("unauthorized");
        return;
    }
    // auth is in scope here — fine
    if (auth.permissions().contains(Permission.ADMIN)) {
        applyAdmin(auth);
    }
    // ...later in the same method, 30 lines down:
    if (r instanceof AuditedRequest audited) {
        recordAudit(audited);
    }
    // The `auth` binding is still in scope. Did the author mean to use auth, or r, or audited?
    deliver(auth);   // uses the AuthorizedRequest aspect, even if r is also AuditedRequest
}
```

**Symptom.** Code reviewers and IDE quick-fixes incorrectly suggest "convert this `instanceof` to a pattern". The flow-sensitive scope of pattern variables (JLS §6.3) keeps `auth` alive far beyond the early return; subsequent reads of `auth` may not match the author's intent. The bug compiles, passes tests where `auth` happens to be the right binding, and fails in production when a request is *both* `AuthorizedRequest` and `AuditedRequest` and the audit-specific path was needed.

**Violation.** Flow-scope of pattern variables is *broader* than the reader's intuition. After an `if (!(r instanceof X x)) return;`, `x` lives in the rest of the method.

**Fix.** Either narrow the scope (move the cast inline with the use), or reach for a pattern-match `switch` that confines bindings to each case body:

```java
public void process(Request r) {
    switch (r) {
        case AuthorizedRequest auth -> processAuthorized(auth);
        case AuditedRequest audited -> processAudited(audited);
        case AuthorizedRequest auth && /* both */ -> processBoth(auth, (AuditedRequest)auth);
        default -> log.warn("unsupported");
    }
}
```

Pattern variables in `switch` cases are scoped to the case arm; there is no leak into the rest of the method.

---

## Bug 10 — Switch over sealed type with mismatched generics

```java
public sealed interface Box<T> permits StringBox, IntBox {}
public record StringBox(String value) implements Box<String> {}
public record IntBox(int value)       implements Box<Integer> {}

public static <T> T unwrap(Box<T> b) {
    return switch (b) {
        case StringBox s -> (T) s.value();   // unchecked cast
        case IntBox i    -> (T) (Integer) i.value();
    };
}
```

```java
Box<String> b = new IntBox(42);    // compile error? — no, raw use breaks it
```

**Symptom.** With raw types or unchecked warnings ignored, you can build a `Box<String>` that actually holds an `IntBox`. The `switch` then returns an `Integer` cast to `T`, and `T` is `String` at the call site. The `ClassCastException` fires in unrelated code:

```
Exception in thread "main" java.lang.ClassCastException:
    class java.lang.Integer cannot be cast to class java.lang.String
```

The sealed parent declares `Box<T>`, but the children declare *concrete* generic instantiations (`Box<String>`, `Box<Integer>`). Erasure means the runtime check inside `switch` cannot verify the generic match — it sees `Box`. The unchecked cast in each branch is the leak.

**Violation.** Sealed types do not interact cleanly with generic parameters at the children. The compile-time exhaustiveness check is *erasure-blind*; the runtime cast is unchecked.

**Fix.** Either match the generics at every level (children parameterised the same as the parent), or accept that the leaf types fix the generic and design the API around concrete leaf types:

```java
public sealed interface Box<T> permits StringBox, IntBox {}
public record StringBox(String value) implements Box<String> {}
public record IntBox(int value)       implements Box<Integer> {}

// Two separate APIs, one per concrete instantiation:
public static String unwrapString(Box<String> b) {
    return switch (b) {
        case StringBox s -> s.value();
        case IntBox i    -> throw new IllegalArgumentException();
    };
}
```

Or use a non-generic sealed type with leaf-specific accessors:

```java
public sealed interface Box permits StringBox, IntBox {}
// Caller pattern-matches and uses the concrete leaf type directly.
```

Mixing sealed types with generic specialisation per leaf is a known design hazard; the compiler will not save you from it. See JLS §14.30 and [senior.md](senior.md).

---

## Pattern summary

| Violation type                                | What to look for                                                |
|-----------------------------------------------|-----------------------------------------------------------------|
| Binary compat — new permit (Bugs 1, 3)        | Library `sealed` type, downstream exhaustive switches, no version-bump conversation |
| Open re-entry via `non-sealed` (Bug 2)        | `non-sealed` in a domain hierarchy, unexpected leaf class       |
| Default-clause smoke detector (Bug 3)         | `default -> ...` on a sealed switch — delete it                 |
| Null in pattern switch (Bug 4)                | Pattern switch without `case null`, nullable scrutinee          |
| Reflection over permits (Bug 5)               | `getPermittedSubclasses` used for runtime dispatch              |
| Cross-module permits (Bug 6)                  | `permits` listing types in another module — compiler refuses    |
| Type code in strings (Bug 7)                  | `switch (getClass().getSimpleName())` — bypasses sealing         |
| Side-effecting guards (Bug 8)                 | `when` clause that mutates audit/state/counters                  |
| Pattern variable scope leak (Bug 9)           | `instanceof` pattern with binding used far below the test       |
| Sealed + generics mismatch (Bug 10)           | Generic sealed parent, concrete generic children, unchecked casts |

These bugs are mostly *new* compared to pre-Java-17 hazards. Sealed types and pattern matching shift the failure mode from "missed `if` branch" to "missed permit, miscovered switch, mishandled null". The fixes are mechanical once you recognise the pattern; the prevention is ArchUnit rules plus reviewer attention on `default`, `non-sealed`, guards, and `permits` changes.
