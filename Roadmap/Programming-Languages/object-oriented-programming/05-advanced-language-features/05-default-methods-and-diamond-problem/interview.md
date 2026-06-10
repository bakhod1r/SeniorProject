# Default Methods and the Diamond Problem — Interview Q&A

20 questions covering default methods, diamond resolution, JLS rules, FBCP, records, mixins, static and private interface methods, and binary compatibility. Snippet critiques and judgement calls feature alongside definitions.

---

## Q1. What is a default method and why was it added to Java 8?

A *default method* is an interface method declared with the `default` keyword and a body. The method is implicitly `public` and is inherited by every class implementing the interface that does not override it. Default methods were added in Java 8 (JEP 126) primarily to allow *interface evolution without breaking implementors*. Before defaults, adding a new method to an interface broke every existing class that implemented it — the JDK couldn't add `forEach`, `stream`, `getOrDefault`, or any of the new Java 8 helpers to `Collection`/`Map` without this feature. The secondary motivation was supporting *functional-interface combinators* (`Predicate.and`, `Comparator.thenComparing`).

**Follow-up:** "What's the difference between a default method and an abstract one?" — abstract has no body and forces implementors to provide one; default has a body and is optional to override.

---

## Q2. What is the diamond problem and how does Java handle it?

The diamond problem is what happens when one type inherits two conflicting implementations of the same method via different interface inheritance paths. C++ has it for class-level multiple inheritance; Java has it for interface defaults. Java's solution is *explicit disambiguation*: when two unrelated interfaces both supply a `default` for the same method and neither is more specific, the implementer *must* override the method and choose. The compiler refuses to pick silently and emits an error citing both candidates. You resolve it with `InterfaceName.super.method(...)` syntax to call a specific default.

```java
public class Duck implements Walker, Swimmer {
    @Override
    public String describe() {
        return Walker.super.describe() + " " + Swimmer.super.describe();
    }
}
```

**Trap:** "Java just picks the first interface in the implements clause." It does not — that would silently break implementations on declaration-order changes.

---

## Q3. State Java's three resolution rules for default methods.

1. **Classes win over interfaces.** A method inherited from a superclass always beats any interface default with the same signature (JLS §8.4.8).
2. **More specific interfaces win.** If interface `B extends A` and both supply a default for `m()`, `B`'s default is preferred (JLS §9.4.1.2).
3. **Otherwise, conflict.** If no class method applies and no interface is more specific, the implementer must override and use `Interface.super.m()` to disambiguate (JLS §9.4.1.4).

The order matters: Rule 1 applies first and is absolute. The interface ladder only matters when no class-side method exists.

**Follow-up:** "What if the class inherits the method from a far-away superclass?" — same answer. Class wins, regardless of distance up the class hierarchy.

---

## Q4. Why can't a default method override `equals`, `hashCode`, or `toString`?

JLS §9.4.1.3 explicitly forbids it: *"It is a compile-time error if a default method has the same signature as a non-private method of `java.lang.Object`."* The rationale: every class already inherits these methods from `Object`, so under Rule 1 ("classes win") the default would be unreachable. Allowing the declaration would let library authors believe they were providing fallback behaviour they could never actually deliver. The compiler stops them upfront. The same ban applies to `getClass`, `notify`, `notifyAll`, and `wait`.

```java
public interface Named {
    default String toString() { return "named"; }   // §9.4.1.3 compile error
}
```

**Trap:** "I'll just call it differently then." Yes — name the method `describe()`, `display()`, or anything other than `Object`'s public methods.

---

## Q5. Can a default method be `static`?

No — `default` and `static` are mutually exclusive on an interface method. They mean different things: `default` is *inherited and dispatched virtually*, `static` is *not inherited and namespace-scoped*. A `static` interface method is called via `Interface.method(args)` — never on an instance:

```java
public interface Comparator<T> {
    static <T extends Comparable<? super T>> Comparator<T> naturalOrder() { ... }
    int compare(T a, T b);
}
```

`static` methods on interfaces (also Java 8) replaced the historical pattern of writing a sibling utility class like `Collections` or `Arrays`. They're useful for factories and pure utilities that conceptually belong to the type but don't need a receiver.

**Follow-up:** "What about private static interface methods?" — added in Java 9 (JEP 213) as helpers for default/static methods. Not inherited, not visible to implementors.

---

## Q6. What are private interface methods and why were they added?

Private interface methods were added in Java 9 as part of JEP 213 (*Milling Project Coin*). They allow factoring shared logic out of `default` and `static` methods on an interface without exposing it as part of the public API. Two flavours:

- `private` instance method — callable from `default` methods.
- `private static` method — callable from both `default` and `static` methods.

```java
public interface NameValidator {
    default boolean isValidFirst(String s) { return notBlank(s) && allLetters(s); }
    default boolean isValidLast(String s)  { return notBlank(s) && allLettersOrHyphen(s); }
    private static boolean notBlank(String s) { return s != null && !s.isBlank(); }
    private boolean allLetters(String s) { return s.chars().allMatch(Character::isLetter); }
    private boolean allLettersOrHyphen(String s) { ... }
}
```

Implementors cannot see or call these helpers. They are internal to the interface itself, exactly like `private` methods on a class.

**Trap:** "I'll use them as a shared utility namespace." No — they're only callable from inside the declaring interface.

---

## Q7. What happens in this code?

```java
public class Base { public String describe() { return "[base]"; } }
public interface Animal { default String describe() { return "[animal]"; } }
public interface Dog extends Animal { default String describe() { return "[dog]"; } }
public class Beagle extends Base implements Dog { }

new Beagle().describe();   // ?
```

`new Beagle().describe()` returns `"[base]"`. Rule 1 (classes win) is absolute — the class method from `Base` beats *every* interface default in the hierarchy, including the more specific `Dog.describe()`. This is the most surprising consequence of the resolution rules: the interface ladder doesn't matter once a class method exists. To reach the interface defaults, `Beagle` would need to either not extend `Base`, or override `describe` and call `Dog.super.describe()` explicitly.

**Follow-up:** "How would I get `[dog]` from the call?" Override `describe` in `Beagle` with `return Dog.super.describe();` — but `Dog` must be a direct superinterface (it is, via the `implements` clause).

---

## Q8. Is adding a default method to an interface backward-compatible?

Yes — *individually*. Adding a `default` method to an existing interface is binary-compatible per JLS §13.5: existing implementors inherit the new method without recompilation, and existing callers continue to link. There is one important caveat: if a downstream class implements *another* interface that already has a same-signature default, adding the new default creates a real diamond at runtime, producing `IncompatibleClassChangeError` on first invocation. This is *binary-incompatibility by composition*. Library authors should announce new defaults in release notes for exactly this reason.

```java
// v1.0
public interface Cleanup { default void close() { } }
public interface Closeable { }
public class Connection implements Cleanup, Closeable { }   // fine

// v1.1 — Closeable adds default void close()
// Connection.class compiled against v1.0 fails to load:
// IncompatibleClassChangeError at first close() call.
```

**Trap:** "I added a default, it's binary-compatible." Only without the composition diamond. Check downstream.

---

## Q9. What's wrong with this default method?

```java
public interface Cache<K, V> {
    V get(K key);
    void put(K key, V value);
    default void delete(K key) { throw new UnsupportedOperationException(); }
}
```

The default fakes an "optional" method by throwing — an LSP violation baked into the interface itself. Every caller against `Cache<K, V>` writes `cache.delete(key)` expecting it to work. The interface *promises* it works (the default body is syntactically valid). Implementations that inherit the default crash at runtime when callers reach for `delete`. The fix is to split the interface: `Cache<K, V>` for read-only, `MutableCache<K, V> extends Cache<K, V>` for read-write. Now the type system communicates which implementors support `delete` and which don't.

**Follow-up:** "Why is this worse than just throwing in a concrete class?" — because the interface invites all callers to assume the method works. A concrete class throwing is local; an interface default throwing is systemic.

---

## Q10. How do records interact with default methods?

A record (JEP 395) implementing an interface gets the default methods for free — *except* when a default's name matches a record component. The record's implicit component accessor is a class method, and under Rule 1 (classes win) it shadows the default.

```java
public interface Named {
    default String name() { return "anonymous"; }
}
public record Person(String name, int age) implements Named { }

new Person("Sam", 30).name();   // "Sam" — accessor wins
new Person(null, 30).name();    // null   — default never reached
```

This is silent and easy to miss. The lesson: if you ship default methods named `name`, `id`, `value`, `type`, `count`, `key` — any plausible record-component name — implementors using records will silently shadow them. Pick distinctive method names (`displayName`, `primaryKey`) when designing for record adoption.

**Trap:** "Records can't override interface methods unless I write `@Override`." Yes they can — the implicit accessors satisfy override obligations automatically.

---

## Q11. Are default methods a form of multiple inheritance?

They're multiple inheritance of *behaviour*, not of *state*. Java has always allowed multiple inheritance of *type* — a class can implement many interfaces. Java 8 added inheritance of *behaviour* through default methods — a class can pick up bodies from many interfaces. What Java still forbids is multiple inheritance of *state* — interfaces cannot have instance fields. The diamond problem with state (the historical C++ pain) doesn't exist in Java because there is no state to ambiguously inherit. The diamond problem with behaviour exists but is bounded: Java's three resolution rules (or explicit override with `Interface.super.m()`) make every case deterministic.

**Follow-up:** "So this is like C++ virtual inheritance?" — different mechanism. C++ uses `virtual` to share a base subobject. Java doesn't have the subobject problem because interfaces don't carry data.

---

## Q12. What's the Fragile Base Class Problem in the context of default methods?

FBCP is the hazard that changes to a base class silently break subclasses — especially when subclasses rely on overridable methods or internal call sequences. Default methods bring FBCP to interfaces. Once a library ships a `default` that calls another `default` (or an abstract method), the *call graph* is public API. Refactoring one body can break implementors who overrode the other. The mitigation: document call graphs with `@implSpec`, treat default-method changes as semver-meaningful, and prefer `sealed` interfaces where you control every implementor. See `senior.md` §1 for a worked example.

**Trap:** "FBCP is about classes, not interfaces." It was originally about classes. Java 8 brought it to interfaces — same dynamic, same mitigations.

---

## Q13. When should I use a default method versus a static utility method?

Use `default` when:
- The method depends on instance state read through abstract methods (e.g., `default String greet() { return "Hello, " + name(); }`).
- You're adding a method to a published interface and want backward compatibility.
- The method is a combinator on a functional interface (e.g., `Predicate.and`).

Use `static` when:
- The method does not need a receiver — it's a pure function or factory.
- The method should not be polymorphic (no override semantics needed).
- You want to provide a namespaced helper (`Comparator.naturalOrder()`).

A useful rule: if the method body never references `this`, make it `static`. The JIT prefers `invokestatic` (cheaper than `invokeinterface` in megamorphic contexts), and the method signals its intent — "this doesn't depend on receiver state".

**Follow-up:** "What if I'm not sure?" — start `static`. Promote to `default` only when you need polymorphism or receiver state.

---

## Q14. Critique this snippet for default-method discipline.

```java
public interface Service {
    default void run() {
        long t0 = System.nanoTime();
        try { doRun(); }
        finally { Metrics.timer("service.run").record(System.nanoTime() - t0); }
    }
    void doRun();
}
```

Three issues. (1) The default introduces an implicit dependency on `Metrics` for every implementor — they inherit a hidden coupling they didn't sign up for. (2) The default uses `System.nanoTime()` directly, making `run()` untestable without time control. (3) The default conflates orchestration (when to call `doRun`) with cross-cutting concern (metrics). The fix is a decorator: `MetricsTimedService` wraps a `Service` and records timing externally. The interface stays clean (`Service` just has `run` and `doRun` — or only `run`). Cross-cutting concerns belong in collaborators, not in interface defaults.

**Follow-up:** "Why doesn't this work as a default?" — because every implementor inherits the metrics call, including ones running in environments where `Metrics` isn't on the classpath. A decorator lets the caller decide.

---

## Q15. How does the JIT handle default-method calls?

Default-method calls compile to `invokeinterface` and the JIT handles them like any other virtual call. For monomorphic call sites (one observed receiver type), C2 inlines the default's body directly. For bimorphic sites (two types), C2 emits a type check plus two inlined bodies. For megamorphic sites (three or more), C2 falls back to a real `invokeinterface` through the receiver's itable — a few nanoseconds more than `invokevirtual` but still very cheap. `Interface.super.method()` compiles to `invokespecial`, the cheapest dispatch, because it's resolved statically to a specific method declaration. In practice, default-method performance is virtually identical to virtual-method performance.

**Follow-up:** "When does default-method dispatch matter for performance?" — only in megamorphic hot paths. Hoist the dispatch out of the loop or use a `sealed` type with pattern matching.

---

## Q16. What does `Interface.super.method()` actually do, bytecode-wise?

It compiles to `invokespecial` against the specific interface's method declaration. `invokespecial` dispatches *statically* — to exactly the method named, with no further virtual lookup. That makes it deterministic: even if a sub-interface or sub-class overrides `method`, `Walker.super.describe()` always reaches `Walker`'s body. JLS §15.12.1 constrains the syntax: `T.super.method()` is only legal if `T` is a *direct* superinterface of the current type (declared in the `implements` clause). Indirect superinterfaces are not reachable — you'd need to add them to `implements` (even redundantly) to call them.

```
0: aload_0
1: invokespecial #4   // InterfaceMethod Walker.describe:()Ljava/lang/String;
```

**Trap:** "It's like `super.method()` for classes." Almost — it's the interface analogue, and the same syntactic constraints apply.

---

## Q17. Why are default methods a feature of *interfaces* and not *abstract classes*?

The design intent (JEP 126) was *library evolution*. Existing implementors of an interface needed a way to pick up new methods without code changes. Abstract classes already had this — adding a non-abstract method to a base class is backward-compatible because subclasses inherit. The problem was specific to interfaces, so the solution was specific to interfaces. A secondary reason: interfaces in Java have always supported multiple inheritance of *type*, so adding behaviour to interfaces extends multiple-inheritance-of-type to multiple-inheritance-of-behaviour. Abstract classes don't support multiple inheritance, so defaults there wouldn't have unlocked anything new.

**Follow-up:** "Couldn't we just have abstract classes do everything?" — interfaces let unrelated types implement common roles. Abstract classes are tied to single inheritance.

---

## Q18. Can a default method be `final`?

No. The `final` and `default` modifiers cannot coexist on an interface method. The rationale: `default` exists to provide a *fallback* that implementors are free to override; `final` exists to *prevent* override. The two contradict. If you want a "this method's implementation is part of the interface contract and must not be overridden", Java has no syntactic way to express it — you can write a `default` and hope implementors don't override, or use a `final` method on an abstract class. Some libraries work around it by giving the `default` an unusual name and then using a `private` helper internally — but the override is still legal at the language level.

**Follow-up:** "What about `synchronized` on a default?" — also disallowed. Interfaces can't carry implementation locks.

---

## Q19. How would you migrate a fat interface to a set of role interfaces using defaults?

Three steps. **One:** identify the cohesive roles (e.g., `Printer`, `Scanner`, `Fax` from a `MultifunctionDevice` interface). **Two:** add the new role interfaces, each with the methods belonging to that role. **Three:** make the old fat interface *extend* all the role interfaces, with `default` methods forwarding to the role-interface methods where signatures differ. Old implementors continue to implement the fat interface; new code depends on the narrower roles. Over time, deprecate the fat interface and migrate callers. This is the strangler-fig pattern applied to interface design — old and new coexist, callers migrate at their own pace, the old type is eventually deleted. See `professional.md` §6 for the full deprecation cycle.

**Trap:** "Just delete the fat interface and force everyone to migrate." That's a breaking change; the whole point of defaults is to avoid that.

---

## Q20. When should you reach for defaults vs composition?

Defaults are for *small derived behaviour* on a type — a calculation or a combinator that depends on one or two abstract methods the implementor provides. Composition is for *collaborators with state, lifecycle, or side effects* — anything that wants a field, a constructor, or a teardown. The honest rule: if the default body has more than two abstract-method calls or wants something the interface can't supply (a `Clock`, a `Logger`, an `EventBus`), you wanted composition. Trying to express composition through defaults leads to FBCP, hidden globals, and tangled call graphs. See [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/) for the deeper treatment.

```java
// Default — small derived behaviour
public interface Greeter { String name(); default String greet() { return "Hi, " + name(); } }

// Composition — collaborator with state
public final class Greeter {
    private final Clock clock;
    private final Locale locale;
    public Greeter(Clock clock, Locale locale) { /* ... */ }
    public String greet(String name) { /* uses clock + locale */ }
}
```

**Follow-up:** "What's the smell that tells me I crossed the line?" — three or more abstract-method calls in one default, or a default that wants to inject a collaborator.

---

**Use this list:** rotate one question per category — definition (Q1, Q2), rules (Q3, Q7), constraints (Q4, Q5, Q6), interactions (Q10, Q11), design judgement (Q13, Q14, Q20), specification (Q8, Q15, Q16). Strong candidates treat defaults as a library-evolution feature with team discipline, not as a free way to add methods everywhere — they can name when *not* to add a default and back it with a binary-compat, FBCP, or LSP argument.
