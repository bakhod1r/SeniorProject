# Default Methods and the Diamond Problem — Middle

> **What?** Default methods in practice: evolving a published interface without breaking implementors, working through Java's three-rule resolution algorithm on concrete diamonds, combining `default` with `static` and (Java 9) `private` interface methods, and using defaults as a *mixin* mechanism — with the cases where you should reach for a class instead.
> **How?** Each section starts with code that compiles, names the resolution rule that fires, and shows the smallest change that fixes a real evolution or conflict problem. The cautions are concrete — when defaults stop helping and start hiding state, inheritance, or contract drift.

---

## 1. Evolving a library interface — the JDK 8 story, in miniature

You ship a library with this interface in 1.0:

```java
public interface Cache<K, V> {
    V    get(K key);
    void put(K key, V value);
    void remove(K key);
}
```

A year later, users ask for an "or compute" helper. Pre-Java-8, adding `getOrCompute` to `Cache` would have been a *breaking change*: every external class implementing `Cache` would fail to compile when they upgraded. Default methods make it backward-compatible:

```java
public interface Cache<K, V> {
    V    get(K key);
    void put(K key, V value);
    void remove(K key);

    default V getOrCompute(K key, Function<? super K, ? extends V> mapper) {
        V existing = get(key);
        if (existing != null) return existing;
        V computed = mapper.apply(key);
        put(key, computed);
        return computed;
    }
}
```

Existing implementors keep compiling — they inherit the default. Users who want a smarter version (atomic, single-flight) override it. This is the *exact* pattern used by `Collection.forEach`, `Map.getOrDefault`, `Iterator.remove` and dozens of others added in Java 8.

The discipline you must hold: the default must be *correct for every existing implementor*. If a sensible default does not exist — e.g., because some implementors can't honour the new method's contract at all — *don't add a default*. Add a *new sub-interface* instead (see section 7).

---

## 2. Resolution rules — worked examples

JLS §8.4.8 and §9.4.1 give Java's algorithm three rules. Stated tersely:

1. *Classes win over interfaces.*
2. *More specific interfaces win.*
3. *Otherwise, the implementer must override.*

Let's see each rule fire.

### Rule 1 — classes win

```java
public class BaseLogger {
    public void log(String msg) { System.out.println("[class] " + msg); }
}
public interface Logger {
    default void log(String msg) { System.out.println("[default] " + msg); }
}
public class ConsoleLogger extends BaseLogger implements Logger { }

new ConsoleLogger().log("hi");   // "[class] hi" — class wins
```

`BaseLogger.log` is *inherited from a superclass* and beats `Logger`'s default. No compile error. This rule applies even if the class method comes from far up the hierarchy (e.g., from `Object`) — see Rule 1' in section 3.

### Rule 2 — more specific interface wins

```java
public interface Animal {
    default String describe() { return "an animal"; }
}
public interface Dog extends Animal {
    default String describe() { return "a dog"; }
}
public class Beagle implements Dog { }

new Beagle().describe();   // "a dog" — Dog is more specific than Animal
```

`Dog extends Animal`, so `Dog`'s default is *more specific* and is preferred. No conflict, no compile error.

### Rule 3 — true conflict, explicit override

```java
public interface Walker {
    default String describe() { return "walks"; }
}
public interface Swimmer {
    default String describe() { return "swims"; }
}
public class Duck implements Walker, Swimmer {
    @Override
    public String describe() {
        return Walker.super.describe() + " and " + Swimmer.super.describe();
    }
}
```

Neither interface is more specific than the other, no class method exists, so the implementer must override. `Walker.super.describe()` reaches the specific default; `Swimmer.super.describe()` reaches the other one.

A useful mnemonic: *Class > more-specific interface > anything else, but only one anything-else may exist.*

---

## 3. The "class wins" trap

Rule 1 is the most surprising in practice because it applies even when you don't *see* the class method:

```java
public interface Named {
    default String toString() { return "named<" + hashCode() + ">"; }   // compile error
}
```

You can't even *declare* this — `toString` is a public method on `Object`, and JLS §9.4.3 explicitly forbids default methods with signatures from `Object` (`equals`, `hashCode`, `toString`, `getClass`, etc.). The compiler reports: *"default method tries to override a method from Object."* That single rule prevents Rule 1 from silently swallowing your interface contract — but it also means *you cannot deliver `toString` from an interface as a default*. If you want a printable default, give the method a different name (`describe()`, `display()`, `prettyPrint()`).

A subtler case: a *non-`Object`* class method also beats a more-specific interface default:

```java
public class Base {
    public String describe() { return "[base]"; }
}
public interface Animal {
    default String describe() { return "[animal]"; }
}
public interface Dog extends Animal {
    default String describe() { return "[dog]"; }
}
public class Beagle extends Base implements Dog { }

new Beagle().describe();   // "[base]" — class beats EVERY interface default
```

Rule 2 ("more specific wins") only fires *among interfaces*. The moment a class supplies the method, Rule 1 takes over and the interface ladder is irrelevant.

---

## 4. Static interface methods (Java 8)

Java 8 also allowed `static` methods on interfaces. They are *not* inherited and *not* polymorphic — they belong to the interface as a namespace.

```java
public interface Comparator<T> {
    static <T extends Comparable<? super T>> Comparator<T> naturalOrder() {
        return (a, b) -> a.compareTo(b);
    }
    int compare(T a, T b);
}

Comparator<Integer> c = Comparator.naturalOrder();
```

You call them as `Interface.method(args)`. You can't call them on an instance:

```java
class MyComparator implements Comparator<Integer> { ... }
new MyComparator().naturalOrder();   // compile error — static is not inherited
```

Static interface methods are useful for *factories* and *utilities* that conceptually belong to the type. Before Java 8 these lived in a sibling `Comparators` utility class — a common JDK pattern (`Collections`, `Arrays`, `Paths`) that the language only stopped requiring with this feature.

A static method on an interface cannot collide with a static method on another interface — static methods are not inherited, so there is no diamond to resolve.

---

## 5. Private interface methods (Java 9, JEP 213)

By Java 8 you could already have several `default` methods sharing logic — but no way to factor that shared logic into a helper, because every method on an interface was implicitly `public`. Java 9 fixed this with `private` interface methods (JEP 213):

```java
public interface NameValidator {
    default boolean isValidFirstName(String s) {
        return notBlank(s) && allLetters(s);
    }
    default boolean isValidLastName(String s) {
        return notBlank(s) && allLettersOrHyphen(s);
    }
    // Java 9 private helpers — invisible to implementors and callers:
    private static boolean notBlank(String s) { return s != null && !s.isBlank(); }
    private boolean allLetters(String s) {
        return s.chars().allMatch(Character::isLetter);
    }
    private boolean allLettersOrHyphen(String s) {
        return s.chars().allMatch(c -> Character.isLetter(c) || c == '-');
    }
}
```

`private` interface methods come in two flavours: instance (`private boolean allLetters(...)`) callable from defaults, and `private static` callable from both `default` and `static` interface methods. Implementors don't see them; they're internal to the interface, just like `private` methods in a class.

This is the modern shape of a well-factored default-method interface. Use it: a 20-line default split into two 10-line privates is much easier to read than one monolithic default.

---

## 6. Mixin-like patterns with default methods

Defaults give Java a controlled form of *mixin*: a small interface bundles a cohesive bit of behaviour, and any class can pick it up by implementing the interface. The shape is:

```java
public interface Auditable {
    Instant createdAt();          // abstract — implementer owns the state
    Instant updatedAt();          // abstract

    default Duration age(Clock clock) {
        return Duration.between(createdAt(), clock.instant());
    }
    default boolean isStale(Clock clock, Duration threshold) {
        return age(clock).compareTo(threshold) > 0;
    }
}

public final class Order implements Auditable {
    private final Instant createdAt;
    private final Instant updatedAt;
    /* ctor + accessors */
    public Instant createdAt() { return createdAt; }
    public Instant updatedAt() { return updatedAt; }
}
```

`Order` owns the timestamps (state is class-only, always). `Auditable` provides reusable behaviour built on those timestamps. Any other class — `Invoice`, `Shipment`, `Booking` — can `implements Auditable` and instantly gain `age()` and `isStale()`. This is what people mean by "Java 8 gave us mixins (sort of)".

**The boundary you must hold.** A mixin works as long as:

- The interface declares *abstract* methods for any state it needs.
- The default methods only call those abstracts (plus pure logic).
- The interface does not try to "carry" data.

The moment you find yourself wanting an instance field in the interface (a cached `Duration`, a counter), you've exceeded the mixin's design — that data belongs in the class. Composition (a `final` field of an `Auditor` collaborator) is the answer; see [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/).

---

## 7. Cautious use cases — when *not* to add a default

Default methods are tempting because they are cheap to write. The discipline of *not* using them is what separates good library design from messy library design.

**Don't add a default to convert an abstract method into "optional".**

```java
public interface Repository<T> {
    void save(T entity);
    default void delete(T entity) {
        throw new UnsupportedOperationException("not supported");   // smell
    }
}
```

You've just invented an LSP violation in the interface itself. Any caller that legitimately calls `delete` may crash on any implementation that "inherits" the default. If only some implementors can delete, split into `Repository` and `MutableRepository extends Repository`.

**Don't use defaults to inject cross-cutting concerns.**

```java
public interface Service {
    default void run() {
        long t0 = System.nanoTime();
        try {
            doRun();
        } finally {
            Metrics.timer("service.run").record(System.nanoTime() - t0);
        }
    }
    void doRun();
}
```

This couples the interface to a metrics library, breaks if `Metrics` isn't on the classpath, and bypasses every dependency-injection idiom in your stack. Cross-cutting concerns go in a decorator class, not in a default.

**Don't add a default to give an abstract method a "starter" implementation.**

If the default isn't going to be production-correct for *every* current and future implementor, do not add it. Otherwise you've shipped a contract bug — implementors silently inherit a wrong answer instead of getting a "must implement" compile error.

**Don't reach for defaults to avoid composition.**

A class that needs `age()` and `isStale()` and also `cache.invalidate()` and also `notifier.publish()` is asking for collaborators, not for three interfaces with defaults. Defaults are for *pure derived behaviour*; collaborators with state and side effects belong in fields, injected by the constructor.

---

## 8. Default methods and lambdas

The Java 8 design team added defaults together with lambdas (both shipped under JEP 126). The link is direct: lambdas need functional interfaces (one abstract method), and the JDK wanted to retrofit functional behaviour onto interfaces that already existed.

```java
@FunctionalInterface
public interface Predicate<T> {
    boolean test(T t);

    default Predicate<T> and(Predicate<? super T> other) {
        Objects.requireNonNull(other);
        return t -> test(t) && other.test(t);
    }
    default Predicate<T> or(Predicate<? super T> other) {
        Objects.requireNonNull(other);
        return t -> test(t) || other.test(t);
    }
    default Predicate<T> negate() {
        return t -> !test(t);
    }
}
```

`Predicate<T>` is still a single-abstract-method interface — lambdas remain valid (`Predicate<String> nonEmpty = s -> !s.isEmpty();`). The defaults add *combinators* without making the interface non-functional. This is the canonical pattern in `java.util.function`, `java.util.Comparator`, `java.util.stream.Collector`. For more, see [../04-functional-interfaces-and-lambdas/](../04-functional-interfaces-and-lambdas/).

The subtle constraint: a `@FunctionalInterface` may have *any number of default and static methods* but exactly one abstract method. Defaults don't break the SAM rule.

---

## 9. Default methods and `super` chaining

`Interface.super.method()` reaches *exactly that interface's default*, not a transitive one. If `Dog extends Animal` and you call `Dog.super.describe()` from a class that implements `Dog`, you reach `Dog`'s default. To reach `Animal`'s default explicitly, you'd write `Animal.super.describe()` — *but only if your class declares `implements Animal` directly* (or implements another sub-interface that allows the path).

```java
public interface Animal { default String describe() { return "animal"; } }
public interface Dog extends Animal {
    @Override
    default String describe() {
        return "dog (a kind of " + Animal.super.describe() + ")";
    }
}
public class Beagle implements Dog {
    @Override
    public String describe() {
        return "beagle (a " + Dog.super.describe() + ")";
        // Animal.super.describe() — would fail unless Beagle declares implements Animal directly.
    }
}
```

The rule is precise: `X.super.m()` is only legal if `X` is a *direct* superinterface in the textual `implements` clause of the current type. The compiler enforces this at the call site.

---

## 10. Mistakes that catch middle developers

**Adding a default with the wrong erased signature.** Default methods follow the same overriding rules as regular methods (JLS §8.4.8). If your default has a *return type* the existing abstract method didn't have, you've changed the contract — implementors that overrode the abstract still work, but your default conflicts with their override.

**Forgetting that a default is `public` by default.** All interface methods (default, abstract, static) are `public`. You cannot make a default `protected` or package-private. If you want narrower visibility, you need a class.

**Calling a private interface helper from outside the interface.** Java 9 `private` interface methods are *only* callable from inside the same interface — implementors can't see them, callers can't see them, and even sub-interfaces can't see them. They're for factoring helper code, not for inheritance.

**Expecting defaults to override `Object` methods.** They can't. `toString`, `equals`, `hashCode`, `getClass` are off-limits. Pick a different method name.

**Putting "state" in a default by abusing `ThreadLocal` or static fields.** A default method that mutates static state has just smuggled in shared mutable state via an interface. Don't.

---

## 11. Quick rules

- [ ] Use `default` to add a method to an interface *without breaking implementors* — never to make an abstract method optional.
- [ ] Memorize the three resolution rules: class wins, more-specific interface wins, otherwise conflict.
- [ ] The interface ladder doesn't matter once a class method exists — Rule 1 is absolute.
- [ ] `static` interface methods (Java 8) are *not* inherited; call them as `Interface.method()`.
- [ ] `private` interface methods (Java 9, JEP 213) factor helper logic out of defaults.
- [ ] Default methods can't override `Object` methods (`equals`, `hashCode`, `toString`, `getClass`).
- [ ] Defaults are for *derived behaviour*; if you need state, put it in a class (composition).
- [ ] Mixin via defaults works as long as the interface only stores no data and reads class-owned state through abstract methods.
- [ ] Don't add a default that some implementors can't honour — split the interface instead.
- [ ] Use `Interface.super.m()` only when `Interface` is a *direct* superinterface of the current type.

---

## 12. What's next

| Topic                                                                                | File              |
| ------------------------------------------------------------------------------------ | ----------------- |
| FBCP, binary compatibility, records, sealed types, generic defaults, `super` chains  | `senior.md`        |
| Review vocabulary, library evolution discipline, ArchUnit                            | `professional.md`  |
| JLS §9.4.3 / §8.4.8 / §9.4.1, JEP 126, JEP 213 — primary sources                     | `specification.md` |
| Ten broken default-method snippets                                                   | `find-bug.md`      |
| Bytecode for defaults, `invokeinterface`, JIT inlining                               | `optimize.md`      |
| Hands-on refactors                                                                   | `tasks.md`         |
| Interview Q&A                                                                        | `interview.md`     |

---

**Memorize this:** default methods exist to evolve interfaces without breaking implementors — that's the design intent, everything else is a consequence. The three resolution rules are class-wins, more-specific-wins, otherwise-conflict, in that order. `static` interface methods aren't inherited; `private` interface methods factor helpers. Defaults give you *behaviour reuse*, never *state* — the moment you want a field, you want a class.
