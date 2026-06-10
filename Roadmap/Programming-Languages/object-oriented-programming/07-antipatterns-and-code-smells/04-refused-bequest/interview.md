# Refused Bequest — Interview Questions

Twenty Q&A covering definition, detection, real JDK examples, refactoring, and trade-offs. Use these to prepare for senior backend, principal, or staff-level Java interviews where code-quality and OO design come up.

For each question, the expected depth of answer increases with the question number. The last five are "show your taste" questions where there is no single right answer — the interviewer is judging your reasoning.

---

### 1. What is refused bequest?

A code smell in which a subclass inherits methods, fields, or invariants from its parent that it does not want, refuses to honor (via empty overrides, `UnsupportedOperationException`, or no-op stubs), or contradicts. Coined by Martin Fowler in *Refactoring*; closely related to Liskov substitution violations.

---

### 2. Give a refused-bequest example from the JDK.

`java.util.Stack extends Vector`. Stack inherits Vector's full random-access API (`add(int, E)`, `remove(int)`, etc.), which contradicts the LIFO invariant. Joshua Bloch recommends `Deque` and `ArrayDeque` instead. Other examples: `Properties extends Hashtable<Object, Object>`, and `Collections.unmodifiableList(...)` which refuses every mutator.

---

### 3. Why is refused bequest a Liskov violation?

LSP states that subtypes must be substitutable for their base types without altering correctness. A refused method means there exists a call (the refused one) for which substitution fails — the subtype throws or no-ops while the supertype would have done real work. Therefore LSP is violated by definition.

---

### 4. Is throwing `UnsupportedOperationException` ever acceptable?

Yes, in specific cases:

- **Standard library mutator methods** on intentionally immutable collections (`Collections.unmodifiableList`, `List.of`), because `Collection`'s contract documents them as optional.
- **Test doubles** explicitly marked as partial.
- **Migration code** during refactoring, with a tracking ticket.

In application domain code, throwing UOE is almost always a design smell that should be replaced with a narrower type.

---

### 5. How do you detect refused bequest with static analyzers?

- **SonarJava `S1185`** — overriding methods that only call `super`.
- **SonarJava `S1186`** — empty method bodies.
- **PMD `EmptyMethodInAbstractClassShouldBeAbstract`** and `UncommentedEmptyMethodBody`.
- **Custom ArchUnit rule** forbidding `UnsupportedOperationException` in production packages.
- **Custom NORM (Number of Refused Methods) metric** with a CI threshold.

---

### 6. What is NORM and what's a healthy threshold?

NORM (Number Of Refused Methods) is the count of overridden methods in a class whose body is empty, single-throw, single-`return default`, or single-`super.foo()` delegation. Healthy: 0. Warning: 1. Smell: ≥ 2. The refusal ratio (`NORM / |M(parent)|`) is also useful — above 0.25 is a clear smell.

---

### 7. How is refused bequest different from inappropriate intimacy?

Inappropriate intimacy means two classes know too much about each other's internals (accessing each other's private state via reflection or friend-like patterns). Refused bequest is specifically about *inheritance* — a subclass receiving and rejecting parts of its parent's API. Different smells, different fixes (intimacy → encapsulation; refusal → composition or interface extraction).

---

### 8. Show me how to refactor refused bequest using composition.

```java
// Before — refusal
class ReadOnlyList<E> extends ArrayList<E> {
    @Override public boolean add(E e) { throw new UnsupportedOperationException(); }
}

// After — composition
public final class ReadOnlyList<E> implements Iterable<E> {
    private final List<E> backing;
    public ReadOnlyList(Collection<? extends E> src) { this.backing = List.copyOf(src); }
    public E get(int i) { return backing.get(i); }
    public int size()   { return backing.size(); }
    public Iterator<E> iterator() { return backing.iterator(); }
}
```

The composed version has no inheritance, no refusal, and is `final` for monomorphic JIT inlining.

---

### 9. When is inheritance still the right tool?

When the subtype is a true "is-a" specialization that **honors the entire supertype contract**, adds capability (does not remove), and the supertype was designed for extension (documented protected methods, sealed where appropriate). Examples done well: `BufferedReader extends Reader`, `LinkedHashMap extends HashMap`.

---

### 10. Why is `Properties extends Hashtable<Object, Object>` considered refused bequest?

`Properties` documents itself as `String -> String` but cannot enforce it because it inherits `put(Object, Object)` from `Hashtable`. Storing non-String values compiles, runs, and only blows up when `store(...)` writes to disk. The class refuses the supertype's type contract but lacks the means to enforce its narrower one.

---

### 11. What's the difference between a refused bequest and a Template Method's empty default?

A Template Method's empty default in the parent is a deliberate extension point: subclasses can opt out by inheriting the no-op. The parent's documentation says "subclasses *may* override." That is honored bequest, not refused.

Refused bequest is when the parent's contract *expects* meaningful behavior (per the documentation or invariants), and the subclass refuses to provide it.

---

### 12. How does `final` help mitigate refused bequest?

Marking a class `final` prevents further subclassing, so refused bequest cannot cascade from your refusing subclass to further descendants. Marking individual methods `final` prevents them from being overridden — and therefore from being refused — by subclasses you don't control. Both are core to defensive OO design.

---

### 13. What's the role of sealed classes (Java 17+) in preventing refused bequest?

Sealed hierarchies enumerate the permitted subclasses, giving you a closed world. You can:

- Verify at the type level that no rogue subclass joins the polymorphic set.
- Use exhaustive pattern matching, which forces handling of every permitted type.
- Help the JIT specialize calls (closed-world inlining).

Sealed doesn't *eliminate* refused bequest, but it bounds the damage and makes audits tractable.

---

### 14. Explain the Strangler Fig migration for refused-bequest legacy code.

1. Introduce new narrower interfaces alongside the old base class.
2. Make the old base class implement the new interfaces (adapter layer).
3. Migrate callers one by one to depend on the new interfaces.
4. Once all callers are migrated, delete the old class.
5. Add ArchUnit rules to prevent regression.

The advantage over a big-bang rewrite: each commit is small, reversible, and ships independently.

---

### 15. How does refused bequest affect JIT performance?

Three ways:

1. **Megamorphic dispatch** — refused subclasses join the receiver set, widening call sites from monomorphic to megamorphic and disabling inlining.
2. **Deoptimization** — class loading of a refused-bequest subclass invalidates JIT assumptions and triggers recompilation.
3. **UOE stack traces** — if a refused method is ever called, allocating the exception's stack trace dominates the cost (~10,000× a normal call).

Fixing refused bequest via composition usually improves performance because composed classes can be `final` and monomorphic.

---

### 16. A junior engineer says "we need to extend `ArrayList` to add tracking of last-modified time." How do you respond?

I'd push back on extending `ArrayList` for several reasons:

- All mutator methods would need overriding to capture the timestamp, and any missed one is a silent bug.
- `ArrayList`'s internal methods (`removeRange`, `ensureCapacityInternal`) can mutate state without going through the public mutators we override.
- The "tracked list" leaks `ArrayList`-specific methods (`trimToSize`, `ensureCapacity`) that aren't relevant.

I'd recommend composition: a `TrackedList<E> implements List<E>` that delegates to a `List<E>` field and updates a `lastModified` timestamp inside each mutator. Then return it as `List<E>` to callers, not `TrackedList`.

---

### 17. What's wrong with this pattern in tests?

```java
class FakeRepo extends RealRepo {
    @Override public User find(long id) { return memory.get(id); }
    @Override public void save(User u)  { memory.put(u.id(), u); }
    @Override public List<User> findByOrg(long o, Pageable p) {
        throw new UnsupportedOperationException("not needed");
    }
}
```

Three problems:

1. Each new method on `RealRepo` becomes a refused bequest in the fake — invisible until a test hits it.
2. If `RealRepo` is a class (not an interface), the fake might accidentally invoke real DB code via inherited methods that aren't overridden.
3. Callers depend on the concrete `RealRepo`, not on an abstraction — that's the deeper smell.

Fix: extract `UserRepository` as an interface, implement a full in-memory test double, and have production code depend on the interface.

---

### 18. How do you decide between extracting an interface vs. composing when refactoring refused bequest?

- **Extract an interface** when multiple subclasses share a *capability* you want to model (`Flyable`, `Refundable`). The subclasses still implement directly; the interface gives callers the right narrow view.
- **Compose** when one class needs the *behavior* of another but isn't substitutable. The composing class holds the delegate and exposes only what makes sense.

A good heuristic: if `instanceof` would be reasonable at call sites, extract an interface. If you'd never write `instanceof X`, compose.

---

### 19. Critique this design: `class CachingUserService extends UserService`.

Without seeing more, it's likely a refused-bequest waiting to happen. Concerns:

- Does `CachingUserService` override every read method to consult the cache? If only some, the cache leaks coverage.
- What happens if `UserService` adds a new method? The cache silently misses it.
- The "is-a" relationship is wrong: caching is an aspect, not a kind. `CachingUserService` is-a `UserService` only by coincidence.

Better: `class CachingUserService implements UserService { private final UserService delegate; ... }`. Now you decorate, the type relationship is clean, and adding methods to the interface forces explicit handling.

This is the **Decorator pattern**, which is the structural alternative to refused-bequest inheritance.

---

### 20. Walk me through a memorable refused-bequest bug you've found and fixed.

(Open-ended; here is a model answer.)

We had `OrderProcessor` extended by `RecurringOrderProcessor` and `OneTimeOrderProcessor`. The recurring one overrode `cancel(orderId)` to throw `UnsupportedOperationException` because "recurring orders can't be cancelled mid-cycle." A cron job iterated `for (Processor p : processors) p.cancel(orderId);` to clean up failed payments — and it had been silently crashing every night for six weeks, sending the team alerts that everyone had filtered out.

The fix:

1. Extract `Cancellable` interface.
2. `OneTimeOrderProcessor implements Processor, Cancellable`; `RecurringOrderProcessor implements Processor` only.
3. The cron job filters `processors.stream().filter(Cancellable.class::isInstance)`.
4. ArchUnit rule added: production code must not throw `UnsupportedOperationException`.

What I learned: refused bequest hides in **plain sight** in the type system. The compiler is happy, the tests are green, and the bug only surfaces when polymorphism meets the refused method on a path nobody profiled.

---

## Memorize this

> If you can recite the definition, name three JDK examples, compute NORM on a snippet in your head, describe the composition fix, and explain when you'd still use inheritance — you can hold up your end of any senior interview conversation on refused bequest. The interviewer is rarely testing whether you know the term; they're testing whether your instinct to reach for composition is sharper than your instinct to reach for `extends`.
