# Sealed Classes and Pattern Matching — Interview Q&A

20 questions covering `sealed`, `permits`, `non-sealed`, type patterns, record patterns, exhaustiveness, binary compatibility, JEP timeline, and the `SwitchBootstraps.typeSwitch` lowering. Each answer is concise; the trap or follow-up flags what a stronger candidate adds.

---

## Q1. What does the `sealed` modifier do, and in what JEP did it become final?

`sealed` on a class or interface means it has an explicit, *closed* list of permitted direct subtypes — declared in a `permits` clause (or inferred from the same compilation unit). Every permitted child must itself declare `final`, `sealed` (with its own `permits`), or `non-sealed`. The compiler refuses any other extension. Sealed classes were previewed in Java 15 (JEP 360), refined in Java 16 (JEP 397), and finalised in Java 17 (JEP 409). The closure is recorded at the bytecode level in the `PermittedSubclasses` attribute (JVMS §4.7.31), and the JVM enforces it at class load — sealing is not just a compile-time check.

**Follow-up:** "What if you omit `permits`?" The compiler infers it from the same compilation unit. Useful for nested types.

---

## Q2. Why must every permitted subclass declare `final`, `sealed`, or `non-sealed`?

The closure of a sealed type must be exact: either the leaf is final (no further children), or it itself is sealed (deeper closure), or it is explicitly opened with `non-sealed`. A subclass that left the question undefined would leak the closure — someone could extend it without permission. The compiler refuses such a declaration. The three modifiers are an *exhaustiveness contract on the hierarchy itself*, mirroring the exhaustiveness check on pattern-match switches: every variant must be defined.

**Trap:** Saying "the compiler just enforces it" without naming the design reason — the JLS rule is there because closure has to be *recursive*.

---

## Q3. Explain `non-sealed`. When would you use it?

`non-sealed` re-opens a sealed branch for arbitrary extension. The parent stays closed, but this particular child accepts new subclasses from anywhere. Use it when you have a *mostly* closed hierarchy with one well-defined plugin slot — for example, `sealed interface Notification permits Email, Sms, Custom` where `Custom` is `non-sealed` for plugins. Use it sparingly: every `non-sealed` branch loses the exhaustiveness payoff downstream, because a pattern-match switch cannot enumerate the now-open subhierarchy.

**Trap:** Reaching for `non-sealed` because "the compiler insisted". If the compiler insists, your hierarchy probably should not be sealed at all — open the parent instead.

---

## Q4. What is pattern matching for `instanceof`? Which JEP, which Java version?

Pattern matching for `instanceof` (JEP 394, final in Java 16) introduced the *type pattern*: `if (obj instanceof Foo f) { ... }` binds `f` to `obj` cast to `Foo`, *only* inside the branch where the test succeeded. The redundant cast that pre-Java-16 code had to write disappears. The pattern variable's scope is flow-sensitive (JLS §6.3) — after `if (!(obj instanceof Foo f)) return;`, `f` lives in the remainder of the method because the test must have passed.

```java
if (obj instanceof String s && !s.isEmpty()) { ... }   // s in scope here
```

**Follow-up:** "What about nullability?" `instanceof Foo f` returns false for null without binding — no NPE.

---

## Q5. Critique this code for exhaustiveness.

```java
public sealed interface Shape permits Circle, Square, Triangle {}

public double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.r() * c.r();
        case Square q -> q.s() * q.s();
        default       -> 0.0;
    };
}
```

Two problems. First, the `default` defeats the compiler's exhaustiveness check — the switch compiles even though `Triangle` is missing. Second, when someone later adds `Pentagon` to `permits`, this method *silently* returns 0.0 for pentagons rather than failing to compile. The fix is to delete the `default` and let the compiler force you to handle every variant. The whole point of sealing is to make forgetting impossible; the `default` reintroduces the possibility.

**Trap:** Defending the `default` as "safety". With a sealed type, the compiler is the safety; the `default` removes it.

---

## Q6. What are record patterns? When did they ship?

Record patterns (JEP 440, final in Java 21) let you destructure a record directly in a `case` label or `instanceof` test:

```java
case Add(Expr left, Expr right) -> eval(left) + eval(right);
```

The compiler calls the record's accessors and binds each component to its named variable. Patterns can nest: `case Login(User(long id, String name), Instant at) -> ...`. The shape and order of the destructure must match the record's declared components — you cannot skip, reorder, or rename.

**Follow-up:** "What about unnamed components?" Java 22+ has the unnamed pattern (`_`) for ignoring components you don't need. Pre-22, bind to `var _` or a throwaway name.

---

## Q7. Walk me through what `javac` emits for a pattern-match `switch`.

For a pattern-match `switch` over a sealed type, `javac` emits an `invokedynamic` call site bound to `java.lang.runtime.SwitchBootstraps.typeSwitch`. The bootstrap receives the case label list (`Class<?>` objects, integer/string constants, record-pattern handles) and returns a `CallSite` whose `MethodHandle` answers "given the scrutinee and a start index, which case matches?" The method handle is cached after the first invocation; subsequent calls reuse it. The branches themselves are a `tableswitch` over the returned case index, with a synthesised throw of `MatchException` if no case matches.

```
invokedynamic typeSwitch:(LScrutinee;I)I
tableswitch
    0: goto case_0
    1: goto case_1
    ...
    default: athrow MatchException
```

**Follow-up:** "When does `MatchException` actually fire?" When a switch was compiled as exhaustive but runtime-reaches an unmatched case — typically because the sealed type's `permits` grew in a separately-compiled artifact.

---

## Q8. Is adding a new permit to a sealed type binary-compatible?

No. Downstream code that compiled an exhaustive `switch` over the old `permits` list encodes the assumption that the original list was complete. At runtime, encountering a new variant throws `MatchException`. Adding a permit must be treated as a major-version event in a published library: bump the major version, write a CHANGELOG entry, and either provide a migration tool or guide. Consumers who must straddle versions can add a `default` to their switches — sacrificing exhaustiveness for future-compatibility, deliberately.

**Trap:** "Source compatibility is the same as binary compatibility." It isn't, and sealed types are a textbook case where the two diverge.

---

## Q9. Where can a permitted subclass live? Module, package, file?

JLS §8.1.6 (for classes) and §9.1.4 (for interfaces) require permitted subclasses to:

- Live in the **same module** as the sealed type (named module), or
- Live in the **same package** within the unnamed module, or
- Be in the **same compilation unit** (then `permits` may be omitted entirely).

Cross-module sealing is forbidden. The rule keeps the closure verifiable by `javac` without loading the entire module graph, and prevents downstream modules from forcing themselves into a closed set.

**Follow-up:** "What if I split the sealed root and its permits across two packages?" Allowed if both packages are in the same module; the `permits` clause must name each by its fully-qualified type.

---

## Q10. Compare sealed types with the visitor pattern.

Both solve the same problem — exhaustive dispatch over a closed set of variants. The visitor pattern uses double dispatch: each variant has an `accept(Visitor)` method, the visitor has one `visit(VariantX)` per variant. Adding a new variant breaks every visitor (good — that's the safety). Sealed + pattern switch achieves the same payoff with no double-dispatch boilerplate: a single `switch` lists the variants directly, the compiler enforces exhaustiveness, and adding a permit breaks every switch the same way. Sealed types win on conciseness, readability, and JIT-friendliness (full devirtualization). Visitors retain one advantage: an *open* hierarchy where variants change rarely but operations multiply unboundedly.

**Follow-up:** "When would you still use the visitor pattern in modern Java?" Open variant sets, libraries published for extension, or codebases that pre-date Java 21 and aren't ready to migrate.

---

## Q11. Explain exhaustiveness checking for sealed-type switches.

JLS §14.11.1.2 defines exhaustiveness: a `switch` is exhaustive over a sealed type T if every direct permitted subtype of T is covered by some case label, either explicitly or transitively through a covering supertype. The compiler walks the `permits` graph statically and proves coverage; non-exhaustive switches fail to compile. `default` always satisfies exhaustiveness, but is unnecessary (and counter-productive) on a sealed scrutinee. Nested sealed types are handled recursively: `sealed interface Animal permits Mammal, Bird; sealed interface Mammal permits Dog, Cat` — a switch can cover via `{Dog, Cat, Bird}` or via `{Mammal, Bird}`.

**Trap:** Thinking exhaustiveness covers `null`. It does not. Add `case null` if `null` is a meaningful scrutinee value.

---

## Q12. What is `MatchException`, when does it fire?

`java.lang.MatchException` (since Java 19) is the runtime safety net for pattern-match `switch`. It fires when a switch was *compiled* as exhaustive but at runtime no case matches. Typical causes:

- Binary-version mismatch: a sealed type gained a permit in a separately-compiled artifact, and the old switch doesn't have a case for it.
- All guards are false in a switch where exhaustiveness depended on at least one guarded case matching.

`MatchException` is a `RuntimeException`. Don't catch it in production code — its appearance signals a binary or semantic break that the compiler couldn't catch.

**Follow-up:** "How do you prevent it?" Treat `permits` changes as binary-breaking; recompile consumers when sealing changes; avoid guards that exhaust completeness coverage.

---

## Q13. How do sealed types support algebraic data types (ADTs)?

`sealed interface` + `record` together give you ADTs as Java spells them. A `sealed interface Result<T> permits Ok, Err` is the *sum* (a value is one of these); each record `Ok(T value)` and `Err(String error)` is a *product* (a value bundles fields). Pattern matching over the sum gives exhaustive destructuring. This is the same shape as Haskell's `data Result a = Ok a | Err String`, Rust's `enum Result<T, E> { Ok(T), Err(E) }`, OCaml's variants. The Java syntax is more verbose, but the type-system guarantees are equivalent: compile-time completeness, immutable data, exhaustive switching.

```java
public sealed interface Result<T> permits Result.Ok, Result.Err {
    record Ok<T>(T value)        implements Result<T> {}
    record Err<T>(String message) implements Result<T> {}
}
```

**Follow-up:** "How does this differ from an `enum`?" Enums are *finite, named constants*; sealed + record is *finite, parameterised variants*. A `Currency` is an enum; an `Event = Created | Updated | Deleted` carrying data is sealed + record.

---

## Q14. What is `SwitchBootstraps.typeSwitch`?

`java.lang.runtime.SwitchBootstraps.typeSwitch` is the JDK bootstrap method that lowers pattern-match `switch` at the bytecode level. `javac` emits an `invokedynamic` call site whose bootstrap is this method. It receives the case labels (class objects, constants, record-pattern handles), constructs a `MethodHandle` that answers "which case matches?", and installs it as the call site's target. The bootstrap is invoked once per call site; afterwards the call site is a cheap `invokedynamic` invocation that dispatches through the cached handle.

```java
public static CallSite typeSwitch(
    MethodHandles.Lookup lookup, String invocationName, MethodType invocationType, Object... labels);
```

**Follow-up:** "Why `invokedynamic`?" It lets the JDK evolve the dispatch implementation (linear chain, hash table, type table) without changing the compiled bytecode of consumer code.

---

## Q15. When is sealing wrong?

Sealing is wrong whenever the hierarchy is meant to be *open*. SPIs and plugin extension points, public framework interfaces (think `Collection`, `Comparator`), and types that third parties are expected to implement should all stay open. Sealing them imposes a closed contract on every downstream consumer; future variant additions become major-version events. The honest test: would you rather a new variant cause compile errors across all consumers (sealed) or be silently accepted (open)? For SPIs the latter is the only sane answer; for application-internal closed sets the former is.

**Trap:** "Always seal for safety." Sealing has costs — binary compat, deprecation cycles, no third-party extension. Apply it where the safety pays back; skip it where openness is the point.

---

## Q16. What is the performance impact of sealed + pattern switch vs polymorphism?

For monomorphic call sites (one observed receiver type), both are roughly equivalent — the JIT inlines both fully (~0.5 ns/op on modern x64 JDKs). For megamorphic call sites (3+ receiver types), polymorphism *loses* — virtual call through itable, no inlining, ~6 ns/op. Sealed + pattern switch is consistent regardless of distribution because the closure is baked into the compiled code: HotSpot's CHA proves no new subtypes can appear, the switch lowers to a chain of `instanceof` checks, and each branch inlines independently. Sealed switch is *never slower* than polymorphism and frequently faster.

**Trap:** "Polymorphism is always slower." Wrong — monomorphic virtual is as fast as anything. Sealed wins on *consistency*, not on the monomorphic case.

---

## Q17. Can pattern variables interact with generics?

Partially. Type patterns must be *reifiable* — the runtime must be able to test them. `instanceof List<String> ls` is forbidden (erasure). `instanceof List<?> ls` works and `ls` is typed `List<?>`. Inside the bound scope, you can iterate `ls` but you cannot safely cast the elements without an unchecked cast. Generic parameters of records work fine in record patterns: `case Box<T>(T value) -> ...` if the outer scope knows `T`.

**Follow-up:** "What about wildcards in nested patterns?" `case Pair<?, ?>(var first, var second) -> ...` is fine; `first` and `second` are typed `Object`.

---

## Q18. What's the deprecation cycle for adding a permit to a library?

A four-step cycle. **One:** in the previous minor release, add a deprecation note in `package-info.java` and the CHANGELOG warning that the next major release will add a permit. **Two:** ship the new permit in the major release, bumping `1.x.x` to `2.0.0`. **Three:** provide a migration tool (OpenRewrite recipe, annotation processor, or scripted grep) that locates exhaustive switches in consumer code. **Four:** track adoption via telemetry on `MatchException` thrown in consumers running mismatched binaries; treat it as a release-management indicator. The whole cycle assumes you treat `permits` as part of the public API surface — because it is.

**Follow-up:** "What if consumers can't recompile?" They add a `default` to their switches, accepting permanent loss of exhaustiveness for forward-compat.

---

## Q19. Explain `case null` and the change in switch-on-null behaviour.

Pre-Java-21 `switch` threw `NullPointerException` if the scrutinee was null and no special handling existed. Pattern-match `switch` (final in Java 21) keeps this default but adds the option of `case null`:

```java
return switch (s) {
    case null     -> "no value";
    case String x -> "string: " + x;
    case Integer i -> "int: " + i;
    default       -> "other";
};
```

If you write `case null`, the switch handles null without throwing. If you don't, it still throws NPE on null. The design choice is opt-in handling: most callers don't want null to be silently accepted, so the default stays "throw"; callers who want null-handling write the case explicitly. You can also combine `case null, default -> ...` to handle null and the catch-all together.

**Trap:** Assuming sealed switches make null safe automatically. They don't — handle it explicitly or guard at the call site.

---

## Q20. When would you choose an enum over a sealed type?

When the variants are *finite named constants without data*. An enum gives you `valueOf`, ordinal-based dispatch, EnumSet/EnumMap for cheap collections, automatic `name()`/`values()` reflection, and a built-in `switch` (which is exhaustive over enums since well before pattern matching). For example, `enum Color { RED, GREEN, BLUE }` or `enum HttpStatus { OK, NOT_FOUND, ... }`. A sealed type wins when variants *carry data*: `sealed interface Event permits Created(User u), Updated(User u, Instant at), Deleted(long id)` cannot be an enum because each variant has its own field set. The two features are complementary; choose by whether the variants are *constants* or *records*.

**Follow-up:** "Can a sealed type contain an enum as one of its permits?" Yes — `sealed interface Notification permits Email, Sms, Status` where `enum Status implements Notification { ACK, NACK }`. Useful for hybrid sums of records and named constants.

---

**Use this list:** rotate one question from each cluster — definitions (Q1, Q3, Q6), exhaustiveness and JLS rules (Q5, Q11, Q19), runtime mechanics (Q7, Q12, Q14), design judgement (Q10, Q13, Q15, Q20), and binary compatibility (Q8, Q18). Strong candidates can name a JEP number, the JLS section, and the failure mode the feature prevents, all in one answer.
