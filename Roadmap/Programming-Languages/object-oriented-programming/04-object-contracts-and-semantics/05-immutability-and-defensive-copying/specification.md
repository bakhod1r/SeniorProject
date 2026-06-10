# Immutability and Defensive Copying — Specification Reading Guide

> Immutability is a *programming idiom* — but the guarantees that make it work in Java are *language and memory-model rules*. This file maps the idiom to the binding spec text: the `final`-field publication semantics of JLS §17.5, the definite-assignment rules of §16 that let the compiler trust `final`, the record specification of JLS §8.10 (JEP 395), the value-class preview of JEP 401 that points at where the language is heading, and the JDK methods (`List.copyOf`, `Map.copyOf`, `Set.copyOf`) that depend on those guarantees.

---

## 1. Where to find the canonical text

| Concept                                              | Authoritative source                              |
|------------------------------------------------------|---------------------------------------------------|
| Final fields, semantics during/after construction    | **JLS §17.5** — *Final Field Semantics*           |
| Final field declarations and modifiers               | JLS §8.3.1.2, §8.3.1.3                            |
| Definite assignment                                  | **JLS §16** — *Definite Assignment*               |
| Constructors                                         | JLS §8.8                                          |
| Class declarations, `final` and `sealed` modifiers   | JLS §8.1.1.2                                      |
| Records                                              | **JLS §8.10** — *Record Classes* (JEP 395)        |
| Record canonical and compact constructors            | JLS §8.10.4                                       |
| Record accessors                                     | JLS §8.10.3                                       |
| Frozen arrays / immutable types (value classes)      | **JEP 401** (preview) — *Value Classes and Objects* |
| Java Memory Model overview                           | JLS §17                                           |
| Happens-before                                       | JLS §17.4.5                                       |
| `List.copyOf`, `Set.copyOf`, `Map.copyOf`            | Javadoc of `java.util.List`, `Set`, `Map` (Java 10+) |
| `Collections.unmodifiableList`                       | Javadoc of `java.util.Collections`                |

The **JLS** is what `javac` enforces; the **JVMS** is what the JVM enforces; the **Javadoc** is what the JDK library promises. Immutability draws from all three.

---

## 2. JLS §17.5 — the final-field publication guarantee

The single most important paragraph in the language specification for immutability is JLS §17.5. Verbatim (slightly trimmed):

> *"An object is considered to be completely initialized when its constructor finishes. A thread that can only see a reference to an object after that object has been completely initialized is guaranteed to see the correctly initialized values for that object's final fields."*

The guarantee has three parts.

1. **Final fields, set during construction, are visible to all threads that see the reference afterwards.** Without `final`, the JMM only promises this if you publish through a happens-before edge (a `volatile` write, a `synchronized` block, an `Atomic*.set`, etc.).
2. **No synchronization is required for this guarantee.** A plain field read of a `final` field of a properly published object yields the initialised value, full stop.
3. **The guarantee applies *only* if `this` does not escape the constructor.** If the constructor publishes `this` (via a listener registration, a thread start, a static-field store) before returning, the guarantee is forfeited.

The implementation mechanism is a *store-store barrier* at the end of every constructor that writes a `final` field. The JIT respects it; the JVMS requires it. The result is that all `final`-field writes are visible before the reference becomes reachable.

```java
public final class Snapshot {
    private final long version;
    private final Map<String, Integer> data;

    public Snapshot(long version, Map<String, Integer> data) {
        this.version = version;
        this.data = Map.copyOf(data);
        // The store-store barrier here is guaranteed by JLS §17.5.
    }
}
```

This is why you do *not* need `volatile` on a field of `Snapshot` even when that field is read from multiple threads — provided you publish the `Snapshot` reference safely.

---

## 3. JLS §16 — definite assignment makes `final` trustworthy

JLS §16 — *Definite Assignment* — is what lets the compiler refuse a class where a `final` field could be read before it is assigned. The relevant rule: *"For every access of a final field, the compiler must prove that the field has been definitely assigned."*

```java
public final class Money {
    private final long cents;
    private final Currency currency;
    public Money(long cents, Currency c) {
        if (c == null) throw new NullPointerException();   // legal — no field read yet
        this.cents = cents;
        this.currency = c;
        // At this point, both fields are definitely assigned.
    }
}
```

Two consequences:

- **The compiler refuses to leave a `final` field unassigned.** A constructor that doesn't assign every `final` field on every code path is a compile error.
- **The compiler refuses to assign a `final` field twice.** A constructor that conditionally re-assigns is a compile error.

This is what makes the §17.5 guarantee actually buy you something — `final` is more than a politeness; the compiler enforces single-assignment so the runtime can rely on a stable value at the publication barrier.

---

## 4. JLS §8.10 — records and JEP 395

Records, introduced as a preview in JEP 359 (Java 14) and finalised as JEP 395 (Java 16), are defined in JLS §8.10 — *Record Classes*. The relevant rules:

- **A record class is implicitly `final` (§8.10.1).** No subclass can change the behaviour of the record.
- **Each record component declares a corresponding `private final` field (§8.10.2).** You cannot declare these fields explicitly; the compiler generates them.
- **A record has a canonical constructor whose parameter list matches the component list (§8.10.4).** You can write it explicitly, or the compiler generates it.
- **A compact constructor (§8.10.4.2) elides the parameter list and the implicit field assignments. The body runs *before* the implicit assignments.**

```java
public record Order(long id, List<LineItem> items) {
    public Order {                                          // compact constructor
        items = List.copyOf(items);
        // implicit: this.id = id; this.items = items;
    }
}
```

The compact-constructor form is the specification's blessing for defensive copying. You modify the parameter; the implicit assignment that follows stores the modified value into the `final` field.

- **A record has an accessor method for each component (§8.10.3).** The default returns `this.<component>`. You can override the accessor:

```java
public record Period(LocalDate start, LocalDate end) {
    // override to enforce some invariant
    public LocalDate end() {
        return end == null ? LocalDate.MAX : end;
    }
}
```

In practice, overriding accessors is rarely needed for immutability — the default accessor returns the `final` field, which is already safe.

- **A record cannot extend another class (§8.10.5).** It implicitly extends `java.lang.Record`. It *may* implement interfaces.
- **A record's `equals`, `hashCode`, `toString` are derived from the components (§8.10.3).** The compiler generates them; you can override but rarely should.

The whole point of §8.10 is that the language enforces four of Bloch's five rules. Rule 5 — defensive copying of mutable components — lives in the compact constructor.

---

## 5. JEP 401 — value classes (preview)

JEP 401 (preview, available in Java 23+) introduces *value classes and value objects* — a long-running thread of Project Valhalla. The key spec changes:

- **`value class` modifier.** A class declared `value` has *no identity*. There is no `==` test that can distinguish two value objects with the same fields; there is no `System.identityHashCode` that returns different values for them; there is no `synchronized(valueObject)` that has meaning.
- **All fields are implicitly `final`.** A value class cannot have mutable state.
- **No `wait`/`notify`/`notifyAll`/`synchronized` on a value object.** The intent is to allow the JVM to flatten value instances into arrays and into fields of other classes, without an object header.
- **A value class can extend a regular abstract class** with no fields and a specific `value` modifier, allowing polymorphism over values.

```java
// JEP 401 syntax — preview
public value class Point implements Comparable<Point> {
    public Point(double x, double y) { ... }
    public double x() { ... }
    public double y() { ... }
    public int compareTo(Point o) { ... }
}
```

For immutability, JEP 401 is the next chapter:

- **No copy-on-write needed.** A value object passed to a method *is* the value; there is no shared reference to defend.
- **No defensive copy needed for arrays of value objects.** A `Point[]` holds the points inline; mutating one element doesn't affect another. The "two threads see two values" guarantee is even stronger than `final` publication, because there is no reference to publish.
- **`List<Point>` becomes much cheaper.** No boxing, no per-element object header.
- **Records under JEP 401 become value records** (a subsequent JEP extends record semantics to value classes), eliminating the last bit of overhead for `record`-shaped immutables.

Today (Java 23 preview, Java 24 onward), JEP 401 is in preview. Treat it as where the language is going. The advice from `senior.md` — "design with records as if Valhalla were imminent" — relies on §8.10 and JEP 401 converging.

---

## 6. `final` field semantics in detail (JLS §17.5.1, §17.5.2)

The full §17.5 is broken into subsections worth knowing about.

- **§17.5.1 — Semantics of final fields.** Defines the freeze action that happens at the end of every constructor invocation in which a `final` field is set.
- **§17.5.2 — Reading final fields during construction.** Inside the constructor, before the freeze, a `final` field's value can be read normally — but other threads have no publication guarantee yet. This matters if you call a method on `this` from the constructor and that method reads `final` fields.

```java
public final class Bad {
    private final int x;
    public Bad(int x) {
        new Thread(this::reportX).start();           // `this` escapes!
        this.x = x;                                  // freeze happens AFTER thread start
    }
    public void reportX() {
        System.out.println(x);                       // could print 0
    }
}
```

The reporting thread can run before the freeze, see the default value `0`, and print it. The §17.5 guarantee does not protect this code because `this` escaped the constructor (line 4) before construction finished (line 5).

- **§17.5.3 — Subsequent modification of final fields.** A `final` field, after construction, *may* be modified by reflection (`Field.setAccessible(true); Field.set(...)`). The spec is unusually candid: "*If a final field is modified after construction... the new value of the final field may not be visible to other threads...*". Reflection breaks the §17.5 guarantee. Don't.

---

## 7. `List.copyOf` / `Set.copyOf` / `Map.copyOf` semantics

The Javadoc of `java.util.List.copyOf(Collection)` (Java 10+) specifies:

> *"Returns an unmodifiable List containing the elements of the given Collection, in its iteration order. The given Collection must not be null, and it must not contain any null elements. If the given Collection is subsequently modified, the returned List will not reflect such modifications."*

Three properties matter:

1. **Returned list is unmodifiable.** Calls to `add`, `remove`, `set` throw `UnsupportedOperationException`.
2. **Snapshot semantics.** Subsequent mutations to the source are *not* visible.
3. **Null intolerance.** A `null` element throws `NullPointerException` — defensible defensive copy by default.

The implementation has a performance fast-path: if the argument is already an unmodifiable List (one of the JDK's internal `ImmutableCollections.ListN` variants returned by `List.of`, `List.copyOf`, `Stream.toList`, etc.), `List.copyOf` returns the same instance. So:

```java
List<String> a = List.of("x", "y");
List<String> b = List.copyOf(a);
System.out.println(a == b);                  // true — no allocation
```

`Set.copyOf` and `Map.copyOf` have analogous semantics.

The semantic distinction with `Collections.unmodifiableList(List)`:

- `Collections.unmodifiableList` *wraps* — the wrapper is unmodifiable, but the underlying list can still be mutated by anyone holding the original reference.
- `List.copyOf` *snapshots* — the new list is independent.

For immutability, use `List.copyOf`. For "expose a read-only view of a list I own and continue to mutate", use `Collections.unmodifiableList`.

---

## 8. JLS §8.3.1.2 / §8.3.1.3 — what `final` actually means on fields

JLS §8.3.1.2 covers `volatile`; §8.3.1.3 covers `final` on fields. The key rules:

- **A `final` field must be definitely assigned at the end of every constructor of the class that declares it (§16.9).**
- **A blank `final` field — declared `final` without an initializer — must be assigned in every constructor.**
- **A `final` field that has an initializer is assigned at the point of declaration; it may not be re-assigned in a constructor.**

```java
public final class Cache {
    private final Map<String, String> store = new ConcurrentHashMap<>();    // initialised at declaration
    private final long capacity;                                            // blank final

    public Cache(long capacity) {
        this.capacity = capacity;                                           // must be assigned here
        // this.store = ...;                                                // would not compile — already initialised
    }
}
```

- **`static final` fields follow the same rules but the initialiser runs in `<clinit>` (§8.7).** A `static final` field that holds an immutable value (a `Map.copyOf(...)` of a constant) is fully initialised before any thread can see the class.

The combination — definite assignment, single assignment, store-store barrier at constructor exit — is what makes `final` fields a *language-level* guarantee rather than a politeness.

---

## 9. JLS §17.4.5 — happens-before for safe publication

For *non-final* fields, you need an explicit happens-before edge to safely publish a constructed object. JLS §17.4.5 enumerates the relations that establish happens-before:

- **Volatile write happens-before subsequent volatile read of the same variable.**
- **`Thread.start()` happens-before the started thread's first action.**
- **A monitor unlock happens-before every subsequent lock of the same monitor.**
- **Constructor of an object completes happens-before any thread observing the object through a `final` field.** (This is §17.5 in another guise.)
- **All actions in a thread happen-before any other thread successfully returning from `Thread.join()` on that thread.**

For immutable types with `final` fields, you do not need to invoke any of these; §17.5 gives you the guarantee for free. For *effectively immutable* types (mutable type, no actual mutation post-publication), you need one of the edges above.

```java
// Effectively immutable with safe publication via AtomicReference (volatile semantics)
public class EffectivelyImmutableHolder {
    private final AtomicReference<Map<String, String>> ref = new AtomicReference<>();

    public void publish(Map<String, String> data) {
        ref.set(Map.copyOf(data));                     // volatile write — happens-before
    }

    public Map<String, String> read() {
        return ref.get();                              // volatile read — sees the published state
    }
}
```

The `AtomicReference.set`/`get` establishes happens-before; the `Map.copyOf` makes the published value structurally immutable. The combination matches what `final`-field publication gives you for free in a record.

---

## 10. JEP references and immutability

| JEP            | Feature                                       | Relevance to immutability                       |
|----------------|-----------------------------------------------|-------------------------------------------------|
| JEP 269        | `List.of`, `Set.of`, `Map.of` (Java 9)        | Immutable factory methods for small collections |
| JEP 269 + JDK  | `List.copyOf`, `Set.copyOf`, `Map.copyOf` (Java 10) | Snapshot defensive copy                    |
| JEP 359, 384, 395 | Records (preview → final, Java 14 → 16)    | Rules 1-4 of Bloch's recipe automated           |
| JEP 405, 441   | Pattern matching for records and switch       | Read components without breaking immutability   |
| JEP 401 (preview) | Value classes                              | Identity-free values; immutability without overhead |
| JEP 466 (preview) | Class-File API                              | Tooling for verifying immutability invariants   |
| JEP 442 (preview) | Foreign Function & Memory API                | Off-heap immutable data; `MemorySegment` is treatable as immutable |

Modern Java is the most immutability-friendly the language has ever been. Records collapse the boilerplate; `List.copyOf` makes defensive snapshots one call; JEP 401 will eventually remove the last allocation cost for value-shaped types.

---

## 11. Reading list

1. **JLS §17.5** — *Final Field Semantics*. The single most important section for immutability and concurrency.
2. **JLS §16** — *Definite Assignment*. The compiler-side enforcement that makes `final` trustworthy.
3. **JLS §8.10** — *Record Classes*. Defines records, canonical and compact constructors, accessors.
4. **JLS §8.3.1.3** — *Final Fields*. The field modifier rules.
5. **JLS §17.4** — *Memory Model*. Read §17.4.5 (happens-before) for the broader concurrency context.
6. **JEP 395** — *Records (Standard)*. The motivating document for records.
7. **JEP 401** — *Value Classes and Objects* (preview). Where the language is heading.
8. **Joshua Bloch — *Effective Java* (3rd ed.).** Item 17: "Minimize mutability". Item 50: "Make defensive copies when needed". Item 1: "Static factory methods" (safe publication idiom).
9. **Brian Goetz et al. — *Java Concurrency in Practice*.** Chapters 3 ("Sharing Objects") and 4 ("Composing Objects"); these are the canonical treatment of `final`-field publication and safe-publication idioms.
10. **Doug Lea — *Concurrent Programming in Java* (2nd ed.).** The grandfather text. Predates many of the modern JEPs but the design ideas are the same.
11. **Aleksey Shipilëv — *Java Memory Model Pragmatics*** (online lecture notes). The clearest non-spec explanation of JLS §17 currently available.
12. **JDK Javadoc** — `java.util.List.copyOf`, `java.util.Set.copyOf`, `java.util.Map.copyOf`, `java.util.Collections.unmodifiableList`. The methods you use most often; read their full contracts.

The spec sections do not *teach* immutability — they give you the vocabulary to point at when defending a design. When a reviewer asks "why does this not need `volatile`?", you cite JLS §17.5 and the absence of `this` escape. When a junior asks "why is `record` enough?", you cite JLS §8.10. When a security review asks "what about reflection?", you cite §17.5.3 and the JPMS `opens` rules. Immutability is judgement; the spec gives you the levers.
