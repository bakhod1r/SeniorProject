# Clone and Copy Semantics — Specification Reading Guide

> Copy semantics in Java is partly *spec-defined* and partly *idiomatic*. `Object.clone()` and the `Cloneable` marker have a JLS-described contract; copy constructors and `copyOf` static factories are pure library idioms with no special spec status. This file maps each copy mechanism to the binding text — JLS §java.lang.Object.clone, JLS §java.lang.Cloneable, JLS §11.2.3 (CloneNotSupportedException), JLS §8.3.1.3 (final field semantics), JLS §17.5 (final field publication), JEP 395 (records), and JEP 401 (value classes preview) — so you can argue from primary sources, not folklore.

---

## 1. Where to find the canonical text

| Concept                                                  | Authoritative source                                       |
|----------------------------------------------------------|------------------------------------------------------------|
| `Object.clone()` semantics                               | **API spec: `java.lang.Object#clone()`**                   |
| `java.lang.Cloneable` marker                             | **API spec: `java.lang.Cloneable`**                        |
| `CloneNotSupportedException`                             | API spec: `java.lang.CloneNotSupportedException`           |
| Covariant return types (for `clone()` overrides)         | JLS §8.4.5                                                 |
| Final fields and definite assignment                     | JLS §8.3.1.3, §16                                          |
| Final field publication / memory model                   | **JLS §17.5**                                              |
| Constructors                                             | JLS §8.8                                                   |
| Records (immutable value carriers)                       | **JLS §8.10**, JEP 395                                     |
| Pattern matching for records (for `withers`)             | JLS §14.30, JEP 440/441                                    |
| `List.copyOf`, `Set.copyOf`, `Map.copyOf`                | API spec: `java.util.List#copyOf(Collection)`, etc.        |
| `Map.entry(K, V)`                                        | API spec: `java.util.Map#entry(Object, Object)`            |
| Value classes (preview)                                  | JEP 401, JEP 402                                           |
| Native methods (`Object.clone` is `native`)              | JLS §8.4.3.4, JVMS §2.11.10                                |

The `clone()` and `Cloneable` text lives in the **API specification** (Javadoc), not the JLS proper — a quirk of Java's history. The semantic statements that bind every implementation come from there.

---

## 2. The `Object.clone()` API spec — read it once, carefully

The canonical text (paraphrased; the live source is the JDK Javadoc for `java.lang.Object#clone`):

> Creates and returns a copy of this object. The precise meaning of "copy" may depend on the class of the object. The general intent is that, for any object `x`, the expression `x.clone() != x` will be true, `x.clone().getClass() == x.getClass()` will be true, and `x.clone().equals(x)` will be true; these are *not absolute requirements*. By convention, the returned object should be obtained by calling `super.clone()`. If a class and all of its superclasses (except `Object`) obey this convention, it will be the case that `x.clone().getClass() == x.getClass()`. By convention, the object returned by this method should be independent of this object (which is being cloned).
>
> If the class of this object does not implement the interface `Cloneable`, then a `CloneNotSupportedException` is thrown.
>
> The method `clone` for class `Object` performs a specific cloning operation. First, if the class of this object does not implement the interface `Cloneable`, then a `CloneNotSupportedException` is thrown. Otherwise, this method creates a new instance of the class of this object and initializes all its fields with exactly the contents of the corresponding fields of this object, as if by assignment; the contents of the fields are not themselves cloned. Thus, this method performs a "shallow copy" of this object, not a "deep copy" operation.

Three load-bearing phrases worth highlighting:

1. *"By convention, the returned object should be obtained by calling `super.clone()`"* — the protocol-level requirement. Not enforced by `javac`.
2. *"By convention, the object returned by this method should be independent of this object"* — the deep-copy responsibility. Not enforced by anything.
3. *"as if by assignment; the contents of the fields are not themselves cloned"* — the shallow-by-default rule. Enforced by the JVM (`JVM_Clone` does `memcpy`).

The word *convention* appears twice. That word is the spec admitting: most of the contract isn't a rule, it's a hope. Bloch's *Effective Java* item 13 is largely a tour of what goes wrong when authors deviate from these conventions in ways the spec doesn't prevent.

---

## 3. The `Cloneable` marker — the entire spec

`java.lang.Cloneable` is the shortest interface in the JDK:

```java
public interface Cloneable {
}
```

Its API spec (paraphrased):

> A class implements the `Cloneable` interface to indicate to the `Object.clone()` method that it is legal for that method to make a field-for-field copy of instances of that class. Invoking `Object`'s `clone` method on an instance that does not implement the `Cloneable` interface results in the exception `CloneNotSupportedException` being thrown.
>
> By convention, classes that implement this interface should override `Object.clone` (which is `protected`) with a `public` method.

Notice what's *not* there:

- No abstract `clone()` method. The interface declares zero methods.
- No reference to deep copy. The interface promises *field-for-field*, which is shallow.
- No guidance on `final` fields, on cyclic graphs, on subclass obligations.

The interface is a *behaviour-bit* for `Object.clone()`, nothing more. It is — in Bloch's words — an "extralinguistic mechanism": the JDK uses a type to communicate something to a method, but the type itself doesn't declare what it requires. This is the unique structural oddity that makes `Cloneable` unlike every other interface in the JDK.

A class can also "implement `Cloneable`" without overriding `clone()`. Such a class's `clone()` is `Object.clone()` itself — `protected`, returns `Object`, throws `CloneNotSupportedException`. Other classes outside the package cannot call it. This is a valid configuration that does almost nothing useful.

---

## 4. `CloneNotSupportedException` semantics (JLS §11)

`CloneNotSupportedException` is a *checked* exception declared by `Object.clone()`'s signature. Every override must declare it or catch it.

```java
@Override
public MyClass clone() throws CloneNotSupportedException {
    return (MyClass) super.clone();
}
```

In practice, *the exception is unreachable in any class that implements `Cloneable` and calls `super.clone()`*. The JLS-mandated behaviour is to throw it when the receiver's class does not implement `Cloneable`; since the class containing the override implements it (otherwise the override would be useless), the throw never fires. So every clone override in practice is:

```java
@Override
public MyClass clone() {
    try {
        return (MyClass) super.clone();
    } catch (CloneNotSupportedException impossible) {
        throw new AssertionError(impossible);
    }
}
```

The exception is a vestige of an earlier design where `Cloneable` was the runtime check. It is now a piece of ceremony every implementer writes and every caller catches without insight. JEP 401 (value classes preview) explicitly discusses retiring this corner; for now, the ceremony stays.

A class can choose *not* to implement `Cloneable` and override `clone()` to throw `CloneNotSupportedException` deliberately — the canonical way to say "don't clone me". This is rarely useful: the same intent is better expressed by simply not implementing `Cloneable` at all, or by overriding to throw `UnsupportedOperationException`.

---

## 5. The field-by-field rule — JVM behaviour, not Java behaviour

The spec says "as if by assignment; the contents of the fields are not themselves cloned". The actual implementation in HotSpot is the `JVM_Clone` native function in `src/hotspot/share/prims/jvm.cpp`. It:

1. Looks up the receiver's class.
2. Allocates a new instance of that class with the receiver's exact size.
3. `memcpy`-copies the receiver's instance fields into the new instance.
4. Runs no constructor; runs no field initialiser; runs no instance initializer block.

Steps 3 and 4 are the *semantic* implications of `as if by assignment`. They have practical consequences:

- **Final fields are copied directly.** The Java source-level `final` modifier prevents you from reassigning `c.someFinalField = ...` after `super.clone()`, but the `final` field was already copied (by `memcpy`) from the receiver. You cannot use `clone()` to deep-copy a `final` field in your subclass override without dropping `final` or using reflection.

- **`transient` fields are copied.** Unlike serialization, `clone()` does not honour `transient`. A `transient` cache field is copied along with everything else.

- **Constructor side effects are skipped.** A constructor that registers the new object somewhere (`Registry.register(this)`), allocates a unique id, opens a resource, or runs `requireNonNull` — none of it runs on the clone.

This last point is the most surprising in practice. Consider:

```java
public class IdAssigningWidget {
    private static final AtomicLong IDS = new AtomicLong();
    private final long id;
    public IdAssigningWidget() { this.id = IDS.incrementAndGet(); }
}
```

`new IdAssigningWidget()` gives you a unique id. `widget.clone()` gives you a widget with *the same* id. The constructor's contract — "every instance has a unique id" — is silently violated by `clone()`. A copy constructor doesn't have this problem because it *is* a constructor.

---

## 6. Covariant return for `clone()` — JLS §8.4.5

Pre-Java 5, every override of `clone()` returned `Object`. Callers had to cast:

```java
Foo f = (Foo) other.clone();
```

JLS §8.4.5 (covariant return types) lets a subclass override declare a more specific return:

```java
@Override
public Foo clone() {        // covariant: Object -> Foo
    return (Foo) super.clone();
}
```

Callers then write `Foo f = other.clone();` without a cast. This is the one ergonomic improvement modern Java offered the `Cloneable` story — every subsequent improvement went to copy constructors, records, and `copyOf` factories instead.

Note that the cast *inside* the override is still required: `super.clone()` is statically typed `Object`. Forget the cast and you fall back to `Object`. SpotBugs's `CN_IDIOM` family catches this.

---

## 7. JLS §8.3.1.3 — `final` fields and their incompatibility with `clone()`

A `final` field must be definitely assigned before any constructor returns (JLS §16). Once assigned, it cannot be reassigned (JLS §8.3.1.3) — at the language level. The compiler enforces this for source-level writes.

Now `Object.clone()` writes to `final` fields by `memcpy`. This isn't a *language-level* write, so it doesn't violate the rule. But the *value* of those final fields is whatever the original had — including references to mutable objects you wanted to deep-copy.

```java
public class Customer implements Cloneable {
    private final List<Order> orders;

    public Customer(List<Order> orders) {
        this.orders = new ArrayList<>(orders);
    }

    @Override
    public Customer clone() {
        try {
            Customer c = (Customer) super.clone();
            c.orders = new ArrayList<>(this.orders);   // COMPILE ERROR — c.orders is final
            return c;
        } catch (CloneNotSupportedException e) { throw new AssertionError(e); }
    }
}
```

The fix paths the spec gives you are all bad: drop `final` (losing JLS §17.5 publication guarantees), use reflection, or skip `Cloneable` entirely. The third is the only sane choice.

JLS §17.5 also matters here: a `final` field set in the constructor is guaranteed to be visible to any thread that observes the constructed object — *provided* `this` doesn't escape the constructor. A copy constructor preserves this guarantee. `Object.clone()` does too, *for the fields that were already final in the original*, because the publication act is the cross-thread observation of the constructed object's reference. But the deep-copy logic you need to run *after* `super.clone()` cannot reassign those final fields, so the publication guarantee is moot — you've already lost the ability to do the deep copy at all.

---

## 8. JLS §8.10 — records and the spec-blessed alternative

JEP 395 (Records, finalised in Java 16, specified in JLS §8.10) gives you the immutable value carrier the language always lacked. The relevant guarantees:

- **Implicitly final class.** No subclass can sneak in mutable state (`senior.md` section 6).
- **All fields `private final`.** Set exactly once during construction; not reassignable.
- **Canonical constructor.** Exposes the component values; you can attach validation via a *compact constructor* that runs before assignment.
- **Auto-generated `equals`, `hashCode`, `toString`** based on the components.
- **No `clone()` method generated.** Records don't implement `Cloneable`.

The spec text (paraphrased): *"A record class declaration declares a class that is final, in which the constructor, accessor methods, and `equals`, `hashCode`, `toString` methods are generated automatically."* The "final" plus "no `clone()`" combination is the spec's way of saying: *records are the recommended shape; copy is unnecessary; reuse is safe.*

For variants you use the standard "wither" pattern:

```java
public record Order(long id, OrderStatus status, List<LineItem> lines) {
    public Order {
        lines = List.copyOf(lines);      // compact constructor — defensive copy on construction
    }
    public Order withStatus(OrderStatus s) {
        return new Order(id, s, lines);   // 'lines' shared — already unmodifiable
    }
}
```

The canonical constructor's *compact* form (the no-parameter-list constructor body in the record header) is the only place where the language lets you adjust a parameter before it is assigned to the component. This is the recommended hook for defensive copies, validation, and normalisation — exactly the things you would otherwise do in a copy constructor.

Records do everything `Cloneable` was supposed to do and more, with one third the code and full language enforcement. The spec is telling you which idiom is supported in the modern era.

---

## 9. `List.copyOf`, `Set.copyOf`, `Map.copyOf` — API spec

The JDK 10+ `copyOf` factories are precisely specified:

- **`List.copyOf(Collection<? extends E> coll)`** — *"Returns an unmodifiable List containing the elements of the given Collection, in its iteration order. The given Collection must not be null, and it must not contain any null elements. If the given Collection is subsequently modified, the returned List will not reflect such modifications. If the given Collection is already an unmodifiable List, it may be returned directly."*

- **`Set.copyOf(Collection)`** — analogous, semantically a set (duplicates removed via `equals`).

- **`Map.copyOf(Map<? extends K, ? extends V> map)`** — analogous, "unmodifiable Map containing the entries of the given Map".

Three points to internalise:

1. **Unmodifiable, not unmodifiable view.** The returned collection is a true unmodifiable structure with its own backing storage (unless the input was already one). Mutation of the input doesn't leak in; you don't need an additional `Collections.unmodifiableList(...)` wrap.

2. **Null hostile.** All three throw `NullPointerException` for null elements/keys/values. The legacy `Collections.unmodifiableList(new ArrayList<>(list))` allowed nulls. The `copyOf` factories make a stronger contract — which is usually what you want.

3. **May return the input directly.** When the input is already an unmodifiable result from a previous `copyOf` (or `List.of`, etc.), the method may skip copying. This means `List.copyOf(List.copyOf(list))` allocates once, not twice — the inner result is the outer's return.

The factories are the spec-blessed defensive-copy idiom for collection fields. The `middle.md` examples lean on them heavily.

---

## 10. JEP 401 — value classes (preview) and the future of copy

JEP 401 (preview in JDK 21+) introduces *value classes*: classes whose instances have no identity, no `==` semantics beyond field-by-field equality, and which the JVM may flatten into containers.

```java
value class Point {
    private final double x;
    private final double y;
    // canonical constructor, accessors auto-generated
}
```

For copy semantics, value classes erase the question entirely:

- **No identity** means there's no notion of "a different instance with the same fields". Two `Point` values with the same `x` and `y` *are* the same value.
- **Flat storage** means `Point[]` may be implemented as `[x0 y0 x1 y1 ...]` — no per-element heap object, no copy-vs-share question at the storage level.
- **No `clone()`**. Value classes don't carry the `Cloneable` mechanism at all.

JEP 401 is the spec's strongest signal that the future of Java's value semantics lies away from `clone()`. The discipline you build today on records carries forward to value classes essentially unchanged — the same compact constructors, the same `with...` accessors, the same defensive-copy patterns at the boundaries.

For now, value classes are preview-only. Treat them as the direction-of-travel proof: design with immutability and `with...` accessors today, and the migration to value classes when they finalise will be a one-line change (`record` → `value record` or `class` → `value class`).

---

## 11. Native methods and `clone()` — JLS §8.4.3.4

`Object.clone()` is declared `native`. JLS §8.4.3.4 governs `native` methods: *"A native method has an implementation, written in a language other than Java, that is platform-dependent."* The JVMS (§2.11.10) describes how the JVM finds and calls native methods.

The senior-level takeaway: `clone()`'s implementation is not in the JDK source you can browse on GitHub at the Java level. It's in HotSpot's C++ codebase (`src/hotspot/share/prims/jvm.cpp`, function `JVM_Clone`). This has three implications:

- You cannot step into `super.clone()` in a Java debugger. The call disappears into native land and reappears with a new object.
- You cannot easily test or mock the underlying allocation. The `memcpy` is opaque from Java.
- You cannot extend the behaviour. There is no `clone hook` extension point.

By contrast, a copy constructor is plain Java. It steps through in the debugger, every assignment is visible, every test can verify a specific field's copy intent. This is the engineering reason senior teams prefer copy constructors even ignoring all the design objections — *they are debuggable Java code*.

---

## 12. Reading list

1. **API spec: `java.lang.Object#clone()`** — the canonical text on what `clone()` promises and does not promise. Read it whole; it is the foundation.
2. **API spec: `java.lang.Cloneable`** — the empty interface and the paragraph that explains why it exists. Three minutes of reading; the most surprising design in the JDK.
3. **API spec: `java.lang.CloneNotSupportedException`** — the checked exception every override has to acknowledge.
4. **JLS §8.4.5** — covariant return types. The one good thing modern Java did for the `clone()` story.
5. **JLS §8.3.1.3** — final fields. The compatibility problem with `Object.clone()`.
6. **JLS §17.5** — final field publication. Why immutable types with constructor injection are thread-safe without locks.
7. **JLS §8.10** — records. The spec-blessed replacement for value-carrier `clone()`.
8. **JEP 395** — records, the JEP that introduced them.
9. **JEP 401** — value classes (preview); the future of `clone()`-free value semantics.
10. **API spec: `java.util.List#copyOf(Collection)`** (and the analogous `Set`/`Map`/`Map.entry`) — the JDK's defensive-copy primitives.
11. **Joshua Bloch — *Effective Java***, item 13 ("Override `clone` judiciously"). The book-length critique of `Cloneable`; mandatory.
12. **Joshua Bloch — *Effective Java***, item 17 ("Minimize mutability") — companion piece on why immutability removes the copy question.
13. **Brian Goetz et al. — *Java Concurrency in Practice***, §3.5 ("Safe publication"). The thread-safety implications of `final` fields and constructor injection — relevant to *why* copy constructors win over `Object.clone()`.

The API spec, JLS, and one or two Bloch items together cover the whole topic. Most "folklore" on Java copying comes from people who haven't read the API spec for `clone()` straight through; the cure is to read it once and decide for yourself.

---

**Memorize this:** `Cloneable` is a marker that changes a `native` method's behaviour; the marker is empty and the protocol is convention. `final` fields are incompatible with `Object.clone()`'s deep-copy story. Records (§8.10) and `copyOf` factories are the spec-blessed modern idioms — implicitly final, with all the safety the `clone()` chain only hoped for. Value classes (JEP 401) point at a future where the copy question disappears at the language level; until then, design as if records were your value types and copy constructors your only fallback, because they are.
