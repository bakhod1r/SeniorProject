# Clone and Copy Semantics — Interview Q&A

20 questions covering each copy idiom and its trade-offs: definitions, the `Cloneable` critique, shallow vs deep, copy constructors and `copyOf`, records, common bugs, the protocol nature of `clone()`, FBCP interactions, cyclic graphs.

---

## Q1. Why is `Cloneable` considered broken?

Five reasons, layered. **First**, `Cloneable` is a marker interface that changes the behaviour of a `native` method (`Object.clone()`) — every other interface in the JDK declares methods, but `Cloneable` declares nothing. Using a type as a behaviour-bit for an inherited method is unique and surprising. **Second**, `Object.clone()` bypasses the constructor, so any invariant established by a constructor is silently violated by `clone()`. **Third**, it returns `Object` and throws `CloneNotSupportedException`, both of which require ceremony at every call site. **Fourth**, the protocol requires every level of the hierarchy to call `super.clone()` and deep-copy *its own* mutable fields — a Fragile Base Class problem where one missing line in a subclass breaks the chain silently. **Fifth**, `Cloneable` is incompatible with `final` fields (you can't reassign them after `super.clone()` to deep-copy mutable references). Joshua Bloch's *Effective Java* item 13 covers all of this; the practical conclusion is: don't use `Cloneable` in new code.

**Follow-up:** "Then why is it still in the JDK?" Removing it would break vast amounts of legacy code, including JDK classes (`GregorianCalendar`, `ArrayList`, etc.). It's stuck for compatibility, not because anyone defends it.

---

## Q2. Explain shallow vs deep copy.

A **shallow copy** duplicates the fields of an object but reuses the objects those fields point to. A **deep copy** also duplicates the pointed-to objects, recursively, until everything reachable is freshly allocated. For primitive fields and immutable types (`String`, `BigDecimal`, records, `LocalDate`), shallow is correct — sharing immutable references is safe. For mutable fields (`ArrayList`, `byte[]`, `java.util.Date`, custom mutable classes), shallow is dangerous: a caller's later mutation of the original leaks into the "copy".

```java
this.lines = other.lines;                       // shallow — same List instance shared
this.lines = new ArrayList<>(other.lines);      // shallow list copy, elements shared
this.lines = other.lines.stream()
    .map(LineItem::deepCopy).collect(toList()); // deep copy of list and its elements
```

The depth of your copy is the depth of mutability in your object graph. Flatten by making leaves immutable (records, JDK `java.time` types); then most "deep" questions become "share the reference".

**Trap:** Confusing "shallow copy of a list" with "shallow copy of an object". Shallow at the object level means fields share references; shallow at the list level can also mean "elements are not copied" — both apply.

---

## Q3. What are the benefits of a copy constructor over `Object.clone()`?

Five concrete benefits. **Goes through `<init>`** — constructor invariants and side effects run on the copy. **Returns the correct type** — `new Foo(other)` returns `Foo`, no cast required. **No checked exception** — no `CloneNotSupportedException` ceremony. **Compatible with `final` fields** — the copy constructor *is* the construction site, so it can assign every `final` field with whatever deep-copy logic it likes. **Composes cleanly across inheritance** — each class owns its own copy constructor, no chain dependency. The trade-off: a copy constructor on a base class doesn't get the runtime concrete type for free (it builds an instance of the declared class). If you need polymorphic copy, pair the copy constructor with a `copy()` method whose covariant return is overridden per subclass.

```java
public final class Customer {
    public Customer(Customer other) { /* explicit field-by-field */ }
}
```

**Follow-up:** "When would you still use `Cloneable`?" Practically never in your own code. If you must call `.clone()` on a JDK type that ships it correctly (`GregorianCalendar`, `Date`), do so — but don't add it to your own classes.

---

## Q4. Records as an alternative to copy methods — explain.

Records (JEP 395, JLS §8.10) are immutable by language design — implicitly `final`, all fields `private final`, accessors and `equals`/`hashCode`/`toString` auto-generated. *You don't copy a record; you reuse it.* If you need a variant with one field changed, use the `with...` idiom:

```java
public record Order(long id, OrderStatus status, List<LineItem> lines) {
    public Order { lines = List.copyOf(lines); }       // compact constructor — defensive copy
    public Order withStatus(OrderStatus s) {
        return new Order(id, s, lines);                 // shares 'lines' by reference; safe
    }
}
```

`withStatus` allocates exactly one new `Order`; the unchanged `lines` is reused by reference (it's already an unmodifiable list, so sharing is safe). This is the dominant copy idiom in modern Java — and it uses no `clone()` at all.

**Trap:** Implementing `Cloneable` on a record. It works but is pointless (records are immutable; copying just allocates a useless second instance).

---

## Q5. Critique this snippet.

```java
public final class Token {
    private final byte[] bytes;
    public Token(byte[] bytes) { this.bytes = bytes; }
    public byte[] bytes() { return bytes; }
}
```

Two leaks. **Inbound:** the constructor stores the caller's `byte[]` reference. A caller who mutates the array after construction silently mutates the token. **Outbound:** the accessor returns the same reference. Anyone calling `token.bytes()` and writing to the result mutates the token's internal state. SpotBugs's `EI_EXPOSE_REP` and `EI_EXPOSE_REP2` both fire on this pattern. Fix:

```java
public Token(byte[] bytes) { this.bytes = bytes.clone(); }
public byte[] bytes() { return bytes.clone(); }
```

Or — better for hot paths — wrap in a `ByteBuffer.wrap(bytes.clone()).asReadOnlyBuffer()` once at construction, expose `ByteBuffer` views from the accessor. No per-call allocation, no mutable array exposed.

**Follow-up:** "What if the caller documents 'I won't mutate this'?" Then add a javadoc note declaring the contract, but understand that you've made an *informal* defensive-copy contract — the next maintainer who forgets the doc will re-introduce the bug.

---

## Q6. Why does the `Cloneable` protocol require `super.clone()`?

Because `Object.clone()`'s native implementation (`JVM_Clone`) allocates a new instance of the *runtime* class of the receiver — not the declared class. If a subclass's `clone()` calls `new Subclass(...)` instead of `super.clone()`, the chain breaks: callers of *its* subclasses get an instance of the wrong class back, and `(GrandSubclass) x.clone()` throws `ClassCastException`. The contract says "by convention, the returned object should be obtained by calling `super.clone()`" — that's the only way to preserve the runtime type through the chain. The word *convention* matters: nothing enforces it. Forgetting `super.clone()` is one of the most common bugs in `Cloneable` implementations.

```java
class Parent implements Cloneable {
    public Parent clone() { return new Parent(this); }  // BREAKS the protocol
}
class Child extends Parent { /* clone returns Parent, not Child */ }
```

**Trap:** Thinking `super.clone()` is a stylistic choice. It's a hard contract requirement of `Object.clone()`.

---

## Q7. What's the FBCP angle on `Cloneable`?

The Fragile Base Class Problem: a subclass's correctness depends on the base class doing specific things, and on every future subclass continuing to do them. `Cloneable` is FBCP par excellence — each level of the hierarchy must (a) call `super.clone()`, (b) cast the result, and (c) deep-copy its own mutable fields. If any level forgets one of the three, the bug is silent. The parent's clone implementation can be perfect, and a single forgotten line in a leaf subclass produces shared mutable state. With copy constructors, the analogous mistake is *visible* — the constructor body lists every field, and a missing field is reviewable. With `Cloneable`, the missing field hides behind `super.clone()`.

**Follow-up:** "How does the copy-constructor pattern avoid FBCP?" Each class's copy constructor is a local contract — it doesn't require the parent to play along correctly. A subclass calls `super(other)` and then assigns its own fields; both pieces are inspectable.

---

## Q8. Explain `super.clone()` and covariant return.

`super.clone()` calls `Object.clone()`, which is declared to return `Object`. Pre-Java 5, every override had to cast: `Foo f = (Foo) super.clone();`. JLS §8.4.5 (covariant return) lets a subclass override declare a more specific return type, so:

```java
@Override
public Foo clone() {
    try { return (Foo) super.clone(); }    // cast still required *inside* the override
    catch (CloneNotSupportedException e) { throw new AssertionError(e); }
}
```

Callers now write `Foo f = other.clone()` without a cast. The covariant return moves the cast to one place — inside the override — where it's correct by construction (the receiver's runtime class is `Foo` or a subclass, by virtue of `Cloneable`'s protocol). The same trick applies to copy methods: a `copy()` method declared on a base can be overridden with a covariant return per subclass, giving polymorphic copy without `Cloneable`.

**Trap:** Forgetting the cast inside the override. Without it, the return falls back to `Object` and callers re-cast.

---

## Q9. How do you deep-copy a graph with cycles?

Track visited nodes in an `IdentityHashMap<Object, Object>` that maps each original to its copy, and check the map *before* recursing into a node:

```java
private static Node deepCopy(Node src, Map<Object, Object> seen) {
    Node existing = (Node) seen.get(src);
    if (existing != null) return existing;       // already copied — reuse
    Node copy = new Node(src.label);
    seen.put(src, copy);                          // mark BEFORE recursing
    for (Node child : src.children) copy.children.add(deepCopy(child, seen));
    return copy;
}
```

The `seen.put(src, copy)` *before* the recursive descent is the crucial step — it makes the cycle terminate the next time the walk encounters the same original. `IdentityHashMap` (not `HashMap`) is required because we're tracking by identity (`==`), not by `equals` — two distinct `Node` instances with equal labels are still different objects for the purpose of cycle detection.

**Follow-up:** "Why not just serialize?" Java's `ObjectInputStream`/`ObjectOutputStream` does the same identity tracking internally and produces a deep copy as a side effect. But it's 10–100× slower than a hand-rolled copy, brittle to `Serializable` boundaries, and a security risk if the bytes ever come from untrusted sources.

---

## Q10. What does `super.clone()` actually do at the JVM level?

`Object.clone()` is a `native` method whose implementation is in HotSpot's `JVM_Clone` function. The JVM (1) checks the receiver implements `Cloneable` (throws `CloneNotSupportedException` if not), (2) allocates a new object of the receiver's runtime class with the same size as the receiver, (3) `memcpy`-copies the receiver's instance fields into the new memory. It does *not* run any `<init>` method, does *not* run field initialisers, does *not* run instance initializer blocks. This is the structural reason `clone()` and constructor invariants are incompatible — anything established by the constructor is silently skipped by the clone path.

A copy constructor doesn't have this gap because it *is* a constructor. The `<init>` runs, every field initialiser fires, every requireNonNull check executes. The bug class of "the clone doesn't satisfy the invariants" doesn't exist for copy constructors.

**Trap:** Thinking `super.clone()` is "just like calling the constructor". It isn't — it's a `memcpy` plus a `Cloneable` check, nothing else.

---

## Q11. Why is `Cloneable` incompatible with `final` fields?

Because `Object.clone()` bypasses the constructor and `memcpy`-copies the fields, including final ones. After `super.clone()` returns, the copy's `final` fields have the same references as the original. To deep-copy a mutable field, you'd want `c.address = new Address(this.address)` — but that's a source-level write to a `final` field, which `javac` refuses. The fix paths are all bad: drop `final` (losing JLS §17.5 publication guarantees), use reflection (`Field.setAccessible(true).set(...)`), or use `sun.misc.Unsafe`. The clean answer is to drop `Cloneable` and use a copy constructor — which assigns every `final` field exactly once during `<init>` with whatever deep-copy logic you choose, and the field stays `final`.

This is why Bloch concludes that `Cloneable` and immutable design are fundamentally at odds.

**Follow-up:** "What about `final` fields with immutable types?" Those are fine — sharing the reference is safe, so `super.clone()`'s `memcpy` is correct. The incompatibility is only with `final` fields of *mutable* types.

---

## Q12. When is a defensive copy unnecessary?

When the field's type is *deeply immutable* — every reachable object cannot be mutated by any caller, ever. Concretely:

- **Primitives** — `int`, `long`, etc. Not objects, can't be mutated.
- **`String`, `BigDecimal`, `BigInteger`** — JDK-managed immutability.
- **`java.time` types** — `LocalDate`, `Instant`, `Duration`, etc., are all immutable.
- **`enum`** — exactly one instance per value, fields typically final.
- **`record`** — implicitly final, all fields private final.
- **`Optional`** — if it wraps an immutable type.
- **Unmodifiable views from `List.copyOf` / `Map.copyOf`** — collection-level immutability.

For these, `this.field = other.field` is correct and a defensive copy would just waste an allocation. The conversion table in `middle.md` section 11 captures the per-type rules.

**Trap:** Defensively copying `String` (`new String(other.name)`) is a common newcomer mistake — it allocates a useless second instance. Strings are immutable.

---

## Q13. `List.copyOf` vs `new ArrayList<>(list)` — when to use each?

`List.copyOf(list)` returns an **unmodifiable** list (throws on `add`/`remove`/`set`). It is the right choice for fields you want to be sealed against mutation in both directions: the caller can't mutate via the input reference, and consumers of an accessor that returns the list directly can't mutate it either. It also short-circuits when the input is already an unmodifiable result, avoiding an allocation.

`new ArrayList<>(list)` returns a **mutable** list. It's the right choice when your class needs to mutate the list later (add items, remove items) but wants to isolate that internal mutation from the caller's view. The accessor in this case must wrap with `Collections.unmodifiableList(...)` or expose a different shape.

```java
this.lines = List.copyOf(lines);                    // immutable internal state; return directly
this.lines = new ArrayList<>(lines);                // mutable internal state; wrap on accessor
```

A second dimension: `List.copyOf` is null-hostile (NPE on null elements), `new ArrayList<>` tolerates them. For invariants like "no null line items", `List.copyOf` gives you the check for free.

**Follow-up:** "When does `List.copyOf` not allocate at all?" When the input is already a result of `List.of` / `List.copyOf` / similar JDK unmodifiable list — the factory returns the input directly.

---

## Q14. Why is `clone()` slower than a copy constructor in practice?

Two reasons. **First**, `super.clone()` is a native call into `JVM_Clone`, and the C2 JIT treats native boundaries as black boxes — it can't see across them. A copy constructor is plain Java; the JIT inlines its body, propagates constants, and lets escape analysis prove the result doesn't escape (eliminating the allocation in tight loops). **Second**, `clone()` produces an object that the JIT didn't watch being constructed — it's harder to specialise downstream code on its type and field values. Microbenchmarks consistently show copy constructors at roughly 2× the throughput of `clone()` for trivial objects, and the gap widens when EA can eliminate the constructor's allocation entirely.

```
new Pojo(other)   — ~5 ns/op,  eliminable in hot loops
other.clone()     — ~12 ns/op, rarely eliminated
```

For high-frequency copy code paths, this matters. For most application code, it doesn't.

**Trap:** Picking `clone()` for performance is exactly wrong — it's the slower of the two idioms.

---

## Q15. What's Bloch's recommendation on `Cloneable`?

Item 13 of *Effective Java* concludes: *"Override `clone` judiciously."* The summary: prefer a copy constructor or a copy factory; reserve `clone()` for classes that already implement `Cloneable` and need to preserve the legacy interface for callers. New classes should not implement `Cloneable`. If you must (because of legacy interop), implement it correctly: call `super.clone()`, cast to the right type, deep-copy every mutable field, use covariant return, never throw `CloneNotSupportedException`. Bloch's deeper point: the protocol is so fragile that *getting it right is harder than rewriting your code to use copy constructors*. The cost-benefit ratio doesn't work for new code.

**Follow-up:** "Is there a JEP to retire `Cloneable`?" Not formally. JEP 401 (value classes, preview) sidesteps it for new code; legacy `Cloneable` stays for compatibility.

---

## Q16. Explain copy semantics in a polymorphic class hierarchy.

A copy constructor doesn't dispatch polymorphically — `new Account(account)` always builds an `Account`, even if `account` is actually a `PremiumAccount`. This trims subclass fields. To get polymorphic copy, declare an abstract `copy()` method on the base and have each subclass override it with a covariant return that calls its own copy constructor:

```java
public abstract class Vehicle {
    protected Vehicle(Vehicle other) { /* copy base fields */ }
    public abstract Vehicle copyOf();
}
public final class Car extends Vehicle {
    private Car(Car other) { super(other); /* copy Car fields */ }
    @Override public Car copyOf() { return new Car(this); }
}
```

Callers write `vehicle.copyOf()` and dispatch finds the right constructor. This is the modern equivalent of `Object.clone()`'s "preserve runtime type" promise, achieved without `Cloneable`'s protocol fragility.

**Trap:** Assuming `new BaseClass(subclassInstance)` returns a subclass instance. It doesn't — it returns a `BaseClass` with the base's fields only.

---

## Q17. How does serialization-based deep copy work, and why avoid it?

`ObjectOutputStream` writes an object graph to bytes; `ObjectInputStream` reconstructs it. Used as a deep-copy trick:

```java
ByteArrayOutputStream bos = new ByteArrayOutputStream();
new ObjectOutputStream(bos).writeObject(src);
return (T) new ObjectInputStream(new ByteArrayInputStream(bos.toByteArray())).readObject();
```

It produces a true deep copy because the serialization protocol handles cyclic graphs via internal identity tracking. But it's:

- **Slow.** 10–100× slower than a hand-rolled copy constructor.
- **Brittle.** A single non-`Serializable` field crashes the whole walk.
- **A security risk.** If `src` comes from untrusted input, deserialization is an RCE vector (CVE-2015-7501 and many others).
- **Decoupled from your design.** Adds a `Serializable` requirement that affects every field's type.

Use it only when you genuinely need a bytes-on-wire representation; never as a "fast deep copy".

**Follow-up:** "Is there a safer JDK alternative?" `java.io.Externalizable` gives more control; `java.io.Serializable` with `readObject`/`writeObject` lets you customise. Both are still slower and more fragile than a copy constructor.

---

## Q18. When should you reach for a persistent data structure?

When the workload is "many copies of large collections per second with small deltas". Persistent (structurally sharing) collections — Vavr's `io.vavr.collection.List`, Eclipse Collections's `ImmutableList`, PCollections's `PVector` — implement append/prepend/update in `O(log32 n)` time by sharing most of the underlying trie between the original and the modified copy. Compare to `List.copyOf`, which is `O(n)` per copy.

Concrete scenarios: event sourcing with frequent snapshots; undo/redo stacks; functional-style pipelines that derive many states from one source; lock-free reads via `AtomicReference<PersistentMap>` swaps. For typical application code, the JDK's `copyOf` is fine; reach for persistent collections when copy frequency or collection size makes flat copies a bottleneck.

**Trap:** Importing a library for one use case. If a single hot path needs persistent semantics, sometimes the right answer is "AtomicReference<Map<K,V>> swapped via `Map.copyOf`" — same idea, no new dependency.

---

## Q19. What does "defensive copy at the boundary" mean?

It's the rule: *take a copy whenever a mutable value crosses a class's wall*. Two boundaries to watch:

- **Constructor boundary.** A constructor that stores a caller's mutable value as a field must copy it. Otherwise the caller still owns a reference and can mutate the stored state from outside.
- **Accessor boundary.** A method that returns an internal mutable field to a caller must copy it (or return an unmodifiable view). Otherwise the caller can mutate the internal state via the returned reference.

```java
public final class Booking {
    private final List<Guest> guests;
    public Booking(List<Guest> guests) { this.guests = List.copyOf(guests); }   // boundary in
    public List<Guest> guests() { return guests; }                              // already unmodifiable
}
```

The "boundary" framing is sibling content with [../05-immutability-and-defensive-copying/](../05-immutability-and-defensive-copying/) — that section covers *when* to copy at boundaries, this section covers *how*. The two work together.

**Follow-up:** "Is defensive copy necessary if the caller is trusted?" The boundary isn't about trust; it's about *capability*. Even a perfectly trusted caller can later be refactored to mutate the input — the copy makes that future refactor safe by construction.

---

## Q20. Summarise the modern Java copy decision tree.

In order of preference:

1. **Make the type a record.** No copy needed — sharing immutable instances is safe. For variants, use `with...` accessors.
2. **If the type must be a class (entity with identity, mutability requirements), write a copy constructor.** `public Foo(Foo other) { /* explicit field-by-field */ }`. Take defensive copies of mutable fields per the per-field conversion table.
3. **If callers prefer a named method, expose a static factory `Foo.copyOf(other)`.** Same idiom as the JDK's `List.copyOf`.
4. **For collection fields, use `List.copyOf` / `Set.copyOf` / `Map.copyOf` at constructors and return them directly from accessors.** Unmodifiable in both directions, zero allocation if input is already unmodifiable.
5. **For arrays, use `array.clone()` at constructors and accessors.** Or wrap in `ByteBuffer.asReadOnlyBuffer()` to expose an immutable view.
6. **For cyclic graphs, deep-copy with an `IdentityHashMap<Object, Object>` of already-copied nodes.**
7. **For high-frequency snapshots, use a persistent collection library or AtomicReference<Map>.**
8. **Do not implement `Cloneable` in new code.** Migrate existing `Cloneable` to copy constructors per class.

The decision tree is short because the modern answer is short: *records first, copy constructors second, `Cloneable` never*.

**Follow-up:** "What changes when Valhalla ships?" Records migrate to value classes with a one-line change; everything else stays the same. The discipline you build today on records carries forward unchanged.

---

**Use this list:** rotate one question from `Cloneable` critique (Q1, Q6, Q7, Q11, Q15), one on shallow/deep mechanics (Q2, Q9, Q12), one on modern idioms (Q4, Q13, Q20), and one on performance or design pressure (Q14, Q18, Q19). Strong candidates apply copy semantics as judgement — they walk a field list against the conversion table, pick the right idiom per field, and can defend the choice without dogma.
