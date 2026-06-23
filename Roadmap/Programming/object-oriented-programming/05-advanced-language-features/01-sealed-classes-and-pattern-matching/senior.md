# Sealed Classes and Pattern Matching — Senior

> **What?** The senior-level decisions: when sealing is right and when it traps you, how `non-sealed` provides an escape hatch with costs, the runtime lowering of pattern-match `switch` through `SwitchBootstraps.typeSwitch` and `invokedynamic`, why closed-world dispatch helps the JIT, and the binary-compatibility implications of changing a `permits` clause across releases.
> **How?** Treat `permits` as an API surface, not an implementation detail. Decide *closed-world vs open-world* per type, *intra-module vs cross-module* per boundary, *application code vs library code* per audience. Use sealed types where the answer to "who else extends this?" is "nobody, ever". Use `non-sealed` only when you have a concrete and justified extension point.

---

## 1. The senior decision — when to seal

Sealing has costs: the parent's source file now lists every child, adding a child is a deliberate edit at a single declared point, and downstream consumers writing exhaustive switches will recompile when you add one. These costs are *acceptable when you control all the variants and want completeness checking*, and *unacceptable when you want callers to extend your type freely*.

| Situation                                  | Seal?                                              |
|--------------------------------------------|----------------------------------------------------|
| AST nodes inside a compiler/interpreter    | Yes — closed set, exhaustive walks are the point   |
| Application command/event types            | Yes — every variant is a deliberate addition       |
| Library spi for plugins (e.g. payment methods) | No — sealing forbids your users from extending |
| `java.util.List`/`Collection`-style API    | No — open for third-party implementations          |
| `Optional`-like result/either types        | Yes — two or three variants, exhaustive handling   |
| Domain-model entities with reflection scan | Maybe — see section 5                              |

The rule of thumb: seal a type when you can name every reasonable variant *and* you want callers to break loudly when a new variant arrives. Open the type when callers will (now or later) need to add their own.

---

## 2. Sealing in libraries vs application code

In **application code** you own all the call sites. Adding a permit is "my problem"; you also own every switch that needs updating. Sealing is mostly upside.

In **library code** that you publish, sealing imposes a contract on downstream consumers. Every exhaustive `switch` they wrote against your sealed type is part of *their* binary that depends on *your* `permits` list. Add a permit and you have broken them.

```java
// In your library, version 1
public sealed interface Event permits Created, Updated, Deleted {}

// In consumer's code, written against version 1
String describe(Event e) {
    return switch (e) {
        case Created c -> "created";
        case Updated u -> "updated";
        case Deleted d -> "deleted";
    };       // no default — relies on Event having exactly these three permits
}

// Library version 2 adds:
public sealed interface Event permits Created, Updated, Deleted, Archived {}
```

The consumer's switch compiles green against version 1, then *throws* `MatchException` (since Java 19, JEP 427) when it encounters an `Archived` event at runtime under version 2 — because the compiled code carries the original exhaustiveness assumption.

For libraries, treat `permits` as part of the public API. Adding a permit is a major-version-only change, in the same bucket as removing a method or changing a return type. We expand on the deprecation cycle in [professional.md](professional.md).

---

## 3. `non-sealed` — the escape hatch and its cost

`non-sealed` says "this child re-opens the hierarchy for arbitrary extension". It lets you have *partial* closure: most children are sealed and exhaustive, one is an open extension point.

```java
public sealed interface Notification permits Email, Sms, Push, Custom {}

public record Email(String to, String body)  implements Notification {}
public record Sms(String to, String body)    implements Notification {}
public record Push(String deviceId, String body) implements Notification {}

public non-sealed interface Custom extends Notification {
    String render();
}
```

Anyone may now implement `Custom`. The compiler still requires every `switch (n)` over `Notification` to handle the `Custom` branch — but inside that branch, you cannot pattern-match further on which specific custom type it is. The escape hatch costs you the *exhaustiveness on the open side*.

Use `non-sealed` when:

- The set of children is *almost* closed, with one well-defined plugin slot.
- The plugin slot is a stable interface that downstream consumers implement.
- You explicitly want extension without sealing.

Do *not* use `non-sealed` to silence "this isn't sealed/final" compile errors. That defeats the entire purpose of the feature. If you find yourself adding `non-sealed` because the compiler told you to, your hierarchy probably should not be sealed at all.

---

## 4. Closed-world dispatch — why the JIT loves sealed types

A virtual call on `interface Foo` is *open-world* — any classloader anywhere may load a new `Foo` implementation tomorrow. HotSpot must keep this assumption alive: it uses *Class Hierarchy Analysis* (CHA) to discover the currently-known implementers, inlines the monomorphic or bimorphic case, and installs a *dependency* that deoptimizes the compiled code if a new implementer appears.

A sealed type is *closed-world* — the JVM knows the full set of permitted children at link time, recorded in the `PermittedSubclasses` class-file attribute (JVMS §4.7.31). The JIT can:

- Devirtualize *every* call site on the sealed parent: the receiver belongs to a known finite set.
- Lower a pattern-match `switch` into a small chain of `instanceof` checks, often a `tableswitch`/`lookupswitch` on a synthetic type tag, with no itable walk.
- Inline the body of each branch using each child's concrete shape.

```java
public sealed interface Op permits Add, Sub, Mul {}
public record Add(long a, long b) implements Op {}
public record Sub(long a, long b) implements Op {}
public record Mul(long a, long b) implements Op {}

public static long eval(Op op) {
    return switch (op) {
        case Add(long a, long b) -> a + b;
        case Sub(long a, long b) -> a - b;
        case Mul(long a, long b) -> a * b;
    };
}
```

The JIT-compiled body of `eval` is, after inlining, roughly:

```
if (op instanceof Add)        return ((Add)op).a + ((Add)op).b;
else if (op instanceof Sub)   return ((Sub)op).a - ((Sub)op).b;
else                          return ((Mul)op).a * ((Mul)op).b;   // proven exhaustive
```

No virtual call, no itable lookup, all three branches inlined. We measure this in [optimize.md](optimize.md).

---

## 5. Pattern-match switch internals — `SwitchBootstraps.typeSwitch`

Pattern-match `switch` is *not* the same as classical `switch` at the bytecode level. The compiler emits an `invokedynamic` call site bound to `java.lang.runtime.SwitchBootstraps.typeSwitch`. The bootstrap method receives the case label list and returns a `CallSite` whose `MethodHandle` answers "given the scrutinee, which case index matches?"

A simplified view of what `javac` generates for:

```java
return switch (op) {
    case Add a -> ...
    case Sub s -> ...
    case Mul m -> ...
};
```

is:

```
aload   op
iconst_0                                // restart index
invokedynamic typeSwitch(Object, int)I  // returns the matching case index
tableswitch
    0:  goto add_branch
    1:  goto sub_branch
    2:  goto mul_branch
    default: athrow MatchException
```

The `typeSwitch` bootstrap looks up the scrutinee's class against the labels (`Add.class`, `Sub.class`, `Mul.class`) and returns the index of the first matching label. The bootstrap is invoked *once per call site*; subsequent invocations are cheap because `invokedynamic` caches the resolved `MethodHandle`.

This lowering has several implications:

- **Cost is `O(N)` in the number of cases, not `O(depth)`** as a naïve `instanceof` chain would be — the JIT can specialize or hash.
- **`MatchException`** (introduced in JEP 427 preview, in `java.lang.MatchException` since Java 19) is thrown if no case matches *and* the switch is supposed to be exhaustive. This is the runtime safety net for the binary-compat scenario in section 2.
- **Guards** are inlined inside the matching branch, *after* the type test. A failing guard does *not* fall through to other cases; it raises `MatchException` if exhaustiveness depended on the guarded case.

`SwitchBootstraps.typeSwitch` is a JDK-internal API. You don't call it; `javac` does. But knowing it exists explains the bytecode you'll see in `javap -c` for any pattern-match switch.

---

## 6. Binary compatibility — adding a permit is breaking

The class-file `PermittedSubclasses` attribute is part of the parent's binary contract. Three consequences:

**Adding a permit can break consumers' compiled switches.** As shown in section 2, a downstream `switch` compiled against the older `permits` list silently encodes an exhaustiveness assumption. The synthesized `MatchException` will fire if a new variant appears at runtime.

**Removing a permit is binary-breaking.** Old binaries that *reference* the now-removed type by name will fail to load.

**Reordering `permits` is binary-safe.** The order in the source is recorded, but no consumer should depend on it.

**Replacing `sealed` with `non-sealed` (loosening)** is *source-compatible* but breaks exhaustiveness in downstream switches in the same way as adding a permit.

**Tightening from `non-sealed` to `sealed`** is binary-breaking for anyone who extended the open child.

For library authors:

```java
// SemVer guidance
// Major bump:    add or remove a permit
// Major bump:    change sealed ↔ non-sealed on a published type
// Minor bump:    add a method to a sealed parent (only if every child is yours and final)
// Patch:         refactor inside a permitted child without changing its shape
```

In practice the cleanest design is to commit upfront: *seal once, never expand*. If you might want more variants, do not seal in version 1.

---

## 7. Module-system constraints (cross-reference)

`permits` may not name a class in a different *module*. The rule (JLS §8.1.6) restricts permitted subclasses to:

- The same compilation unit (named or unnamed), or
- The same package within a named module, or
- A different package within the same named module, *only* if both packages are exported or one is internal to the other.

Same *unnamed* module: a permit may name a class in any package of the unnamed module.

This rule keeps `permits` testable and self-contained. A library cannot accidentally seal across consumer modules; a consumer cannot inject into a library's closed set.

In multi-module projects this means: keep the sealed parent and all of its permits in one module, and *expose* the sealed type through the module's exported package. The implementations may be in non-exported packages within the same module — they will still be visible to the JLS check at compile time. See [../02-jpms-modules/](../02-jpms-modules/) for module mechanics.

---

## 8. Pattern matching exhaustiveness — what the compiler checks

JLS §14.11.1.2 defines *exhaustiveness* for a switch over a sealed type. The compiler considers a switch exhaustive when, after analysing all `case` labels, every value the scrutinee can take has at least one matching label. The analysis is *static* — it walks the `permits` graph.

For nested sealed types:

```java
public sealed interface Animal permits Mammal, Bird {}
public sealed interface Mammal extends Animal permits Dog, Cat {}
public record Dog() implements Mammal {}
public record Cat() implements Mammal {}
public record Bird() implements Animal {}

public static String name(Animal a) {
    return switch (a) {
        case Dog d  -> "dog";
        case Cat c  -> "cat";
        case Bird b -> "bird";
    };
}
```

The compiler walks `Animal -> {Mammal, Bird}`, then `Mammal -> {Dog, Cat}`, and confirms that `{Dog, Cat, Bird}` covers `Animal`. You may also handle the intermediate level explicitly:

```java
return switch (a) {
    case Mammal m -> "mammal";
    case Bird b   -> "bird";
};
```

Either form is exhaustive. The compiler does not require leaf-only or intermediate-only — any cover of the sum is accepted.

`null` is *not* automatically covered. If the scrutinee can be null, write `case null -> ...` or accept that the switch will throw NPE. Pre-21 `switch` always NPE'd on null; pattern-match switch lets you handle it explicitly.

---

## 9. Application-code vs library-code sealing — a worked decision

You are designing a payments module. Three roles:

1. **Internal to the payments service** — a `PaymentMethod` sealed type with `Card`, `Bank`, `Wallet`. The payments service owns every variant; sealing is correct. Adding `Crypto` later is one PR.
2. **Cross-service event types** — `OrderEvent` shared between order-service and reporting-service. Both services compile against a common artifact. Sealing here makes adding a new event type a coordinated change across both services. Acceptable if the services release together; risky if they don't.
3. **Plugin SPI** — `RiskCheck` extension point that third parties may implement. Do not seal. Use an open interface.

The same `interface` keyword can be a closed-world design tool or an open-world extension point. `sealed` is the modifier that distinguishes them.

A pragmatic test: would you rather a new variant cause a compile error in every consumer (sealed) or be silently accepted as a new instance (open)? For domain models in your service, the former is what you want. For SPIs and public collections frameworks, the latter is.

---

## 10. Pattern-match `switch` deoptimizations

A few performance edges worth knowing:

- **Many cases.** Beyond ~8 distinct types, the bootstrap may switch from a linear chain to a hash-based dispatch. The crossover is implementation-defined; trust JMH on your JDK.
- **Generic patterns.** A `case List<String> ls -> ...` is rejected at compile time (un-reifiable). `case List<?> ls -> ...` works and the JIT can specialize the body if the actual element type is monomorphic.
- **Guards with side effects.** A `case Foo f when expensiveCheck(f) -> ...` runs `expensiveCheck` on the matching branch. If `expensiveCheck` has side effects (logging, counters), they fire only when the case applies — which is rarely what the author intends. See [find-bug.md](find-bug.md).
- **Sealed + final children.** When every child is `final` (records are), the JIT's CHA assumption is permanent — no new subtype can appear, no deoptimization is needed. Sealed + non-sealed introduces a *partial* CHA dependency that the JIT must track.

We measure all of these in [optimize.md](optimize.md).

---

## 11. Reflection over `permits`

The class `Class<?>` has supported sealed inspection since Java 17:

```java
Class<?> cls = Shape.class;
if (cls.isSealed()) {
    for (Class<?> permitted : cls.getPermittedSubclasses()) {
        System.out.println(permitted.getName());
    }
}
```

`getPermittedSubclasses()` returns the `permits` list as declared. This is useful for:

- Test runners that want to verify every variant is covered by some test.
- Code generators that emit a switch over every permit.
- Documentation tools that render the full sum.

It is *not* a safe foundation for runtime dispatch — you should still use pattern matching, which the compiler validates. Reflection over `permits` is *post-hoc* introspection; pattern matching is *static* correctness.

Note: `getPermittedSubclasses()` returns `null` for non-sealed types and an empty array for sealed types with no declared permits (in source: a sealed type whose permits are inferred from the same compilation unit will still report them here).

---

## 12. Quick rules

- [ ] **Seal** when you own every variant and want callers to break loudly on new ones.
- [ ] **Don't seal** an SPI or a public extension point — that's what open interfaces are for.
- [ ] Treat `permits` as part of the API surface. Adding a permit is a major-version change in libraries.
- [ ] Use `non-sealed` only when you have a documented and justified extension slot.
- [ ] Closed-world dispatch lets the JIT devirtualize completely — sealed + record + pattern switch is the fast path.
- [ ] `SwitchBootstraps.typeSwitch` is the runtime; `MatchException` is its safety net when binary versions drift.
- [ ] Keep the sealed parent and all permits in the **same module**. The compiler enforces it.
- [ ] Cover nulls explicitly with `case null` when null is a meaningful input.
- [ ] Walk the permits with `Class#getPermittedSubclasses` for tooling, never for dispatch.
- [ ] When variants are open, prefer the visitor pattern or open interfaces — sealed is not a universal answer.

---

## 13. What's next

| Topic                                                              | File              |
| ------------------------------------------------------------------ | ----------------- |
| Code-review vocabulary, ArchUnit rules, deprecation cycles          | `professional.md`  |
| JLS §8.1.1.2, §9.1.1.4, JVMS §4.7.31, JEPs 360/397/409/394/406/440/441 | `specification.md` |
| Sealed and pattern-match hazards in production                       | `find-bug.md`      |
| typeSwitch lowering, JIT inlining, JMH benchmarks                   | `optimize.md`      |
| Hands-on refactors                                                  | `tasks.md`         |
| Interview Q&A                                                       | `interview.md`     |

Cross-references: closed-world dispatch internals are deepened in [../../06-method-dispatch-and-internals/01-jvm-method-dispatch/](../../06-method-dispatch-and-internals/01-jvm-method-dispatch/); module rules for `permits` are in [../02-jpms-modules/](../02-jpms-modules/); the design trade-off against open hierarchies sits with [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/).

---

**Memorize this:** sealing is *closed-world dispatch as an API choice*. The compiler enforces `permits` at compile time, the class file records it via `PermittedSubclasses`, and `SwitchBootstraps.typeSwitch` plus `invokedynamic` lowers your pattern switches to JIT-friendly type dispatches. The cost is that `permits` becomes part of your binary contract — adding a permit can break downstream switches across version boundaries. Seal where you own all the variants; open where you publish an SPI.
