# Clone and Copy Semantics — Senior

> **What?** Why `Cloneable` is broken at the protocol level, not just stylistically: the `Object.clone()` contract, its native-method shape, its Fragile-Base-Class Problem (FBCP) dynamics, how cyclic object graphs ambush naive deep-copy, what to do about final fields, mutable subclasses, persistent (structural-sharing) data structures, and how copying interacts with immutability and the `04-object-contracts-and-semantics/` siblings.
> **How?** Treat `clone()` as a multi-level protocol where every class in the hierarchy is on the hook. Treat copy constructors and `copyOf` as *single-class* contracts that compose without depending on a chain. Treat persistent data structures as the place where copying disappears entirely — the topic exits the language and re-enters as a data-structure design question.

---

## 1. The `Object.clone()` contract, restated

`Object.clone()` is a `protected` `native` method whose JLS-described behaviour reads roughly as: *return a new object that is "equal to" the receiver in the sense of `Object.equals`, where each field of the new object is set to the same value as the corresponding field of the receiver, by simple field assignment* — i.e. a field-by-field, **shallow** copy. The method throws `CloneNotSupportedException` if the receiver's class does not implement the `Cloneable` marker.

Three structural oddities follow from that one paragraph:

1. **`Cloneable` is a marker that changes a `native` method's behaviour.** It does not declare a `clone()` method. The marker tells `Object.clone()` to copy the fields rather than throw. The interface is literally empty:

```java
public interface Cloneable { /* nothing — this is the entire spec */ }
```

2. **`Object.clone()` is `protected`.** A subclass that wants `clone()` to be callable from outside must override and widen the access. Forgetting this gives you a class that "implements `Cloneable`" but cannot be cloned from any other package.

3. **The copy is field-by-field and shallow by default.** Any mutable field — array, list, map, mutable custom object — is shared between the original and the clone. Making it deep is the programmer's job, executed *after* `super.clone()` returns and *before* the clone is returned to the caller.

This is the spec foundation. Everything Bloch calls "broken" stems from how these three points interact with subclassing, finality, and exceptions.

---

## 2. `Cloneable` and the Fragile Base Class Problem

The protocol depends on **every level of the hierarchy implementing `clone()` correctly**. A typical implementation looks like this:

```java
public class Person implements Cloneable {
    private String name;
    private List<String> aliases;

    @Override
    public Person clone() {
        try {
            Person c = (Person) super.clone();        // (1) chain up
            c.aliases = new ArrayList<>(this.aliases); // (2) deep-copy own mutable fields
            return c;                                  // (3) return covariant subtype
        } catch (CloneNotSupportedException e) {
            throw new AssertionError(e);
        }
    }
}
```

Now suppose a subclass adds its own mutable field:

```java
public class Employee extends Person {
    private List<Skill> skills;

    @Override
    public Employee clone() {
        Employee c = (Employee) super.clone();         // returns an Employee, but aliases is deep-copied
        c.skills = new ArrayList<>(this.skills);       // subclass must remember to copy its own
        return c;
    }
}
```

Every subclass must do three things in lockstep with every superclass: call `super.clone()`, cast the result, and deep-copy *its own* mutable fields. If any single level forgets, the bug is silent — `Employee.clone()` succeeds, callers think they have an independent copy, and the `skills` list is shared between original and clone.

This is the textbook **Fragile Base Class Problem**: the correctness of the subclass depends on the parent doing something specific, and on every future subclass continuing to do it. A pure language tool would let the compiler check the chain. Instead, the protocol is *convention*. See [../../07-antipatterns-and-code-smells/](../../07-antipatterns-and-code-smells/) and [../../03-design-principles/](../../03-design-principles/) for FBCP in general.

Worse: `Cloneable` is one of the rare cases where calling `super.clone()` is **required** rather than optional. A constructor doesn't need to chain to `Object()`; `equals`, `hashCode`, `toString` don't either. `clone` does — if you write `return new MyClass(...)` instead of `super.clone()`, callers of `MyClass`'s *subclasses* will get instances of the wrong class back. The protocol forces every level to play along *and* makes it easy to forget.

---

## 3. Native-method oddities

`Object.clone()` is declared `native`. That has two practical consequences senior engineers should understand:

- **No Java code body to read.** `super.clone()` is implemented in HotSpot's `JVM_Clone` (`src/hotspot/share/prims/jvm.cpp`). It allocates a new object with the same class as the receiver, then `memcpy`-copies the receiver's instance fields into the new memory. Reflection on the receiver's class chooses the size. There is no Java-level code path for you to step into in a debugger.

- **The copy bypasses the constructor.** `JVM_Clone` does not call any `<init>` method. Constructor invariants — null-checks, `requireNonNull`, side effects you do in a constructor — *do not run* on the clone. Any class that relies on the constructor having run to establish invariants is silently broken by `clone()`.

```java
public class Cache {
    private final Map<String, byte[]> store;

    public Cache(int capacity) {
        if (capacity <= 0) throw new IllegalArgumentException();
        this.store = new HashMap<>(capacity);
    }
}
```

A subclass that `implements Cloneable` and calls `super.clone()` on a `Cache` instance will get a new `Cache` whose `store` field points at the *same* `HashMap` (shallow), but whose constructor invariant ("capacity > 0") was never re-checked. If a future maintainer adds, say, `Objects.requireNonNull(...)` to the constructor, the clone path silently skips it. Copy constructors don't have this problem — they go through `<init>` like any other construction.

---

## 4. Cyclic object graphs — the deep-copy ambush

A simple deep-copy of an `Address ` doesn't recurse. A deep copy of a graph with back-pointers does — and naively, infinitely.

```java
public final class Customer {
    private final String name;
    private final List<Order> orders = new ArrayList<>();
}

public final class Order {
    private final long id;
    private final Customer customer;        // back-reference to the customer
}
```

A `Customer` has many `Order`s, each `Order` points back at its `Customer`. A naive deep-copy of `Customer` walks each `Order`, which walks `customer`, which walks each `Order` again, which walks `customer` ...

```java
public Customer deepCopy() {
    Customer copy = new Customer(this.name);
    for (Order o : this.orders) {
        copy.orders.add(new Order(o.id, o.customer.deepCopy()));   // infinite recursion
    }
    return copy;
}
```

The fix is an **identity map** — record each "original to copy" pair as you go, and reuse the existing copy when you encounter the same original:

```java
public Customer deepCopyWithCycles() {
    return deepCopy(this, new IdentityHashMap<>());
}

private static Customer deepCopy(Customer src, Map<Object, Object> seen) {
    Customer existing = (Customer) seen.get(src);
    if (existing != null) return existing;          // already copied — return the same copy

    Customer copy = new Customer(src.name);
    seen.put(src, copy);                            // mark BEFORE recursing

    for (Order o : src.orders) {
        copy.orders.add(deepCopy(o, seen));
    }
    return copy;
}

private static Order deepCopy(Order src, Map<Object, Object> seen) {
    Order existing = (Order) seen.get(src);
    if (existing != null) return existing;

    Customer copyCust = deepCopy(src.customer, seen);
    Order    copy     = new Order(src.id, copyCust);
    seen.put(src, copy);
    return copy;
}
```

Use `IdentityHashMap`, not `HashMap` — you want identity (`==`), not equality. Two `Order` instances may be equal-by-fields but distinct objects; only the latter matters for cycle detection.

The same problem afflicts serialization-based deep copy (`ObjectOutputStream` → `ObjectInputStream`). Java's serialization machinery does handle cycles internally — using exactly this identity-map pattern, baked into the protocol — which is why some legacy codebases use serialization as a deep-copy mechanism. The cost is performance (an order of magnitude slower than hand-rolled copy constructors) and brittleness (a single non-serializable field crashes the whole walk).

---

## 5. Cloning `final` fields — and why it's hard

A `final` field is set exactly once: during construction. `Object.clone()` bypasses the constructor, but it can still write to `final` fields because `JVM_Clone` is privileged native code — it does the `memcpy` directly. That sounds convenient until you realise it disables one of the strongest design tools you have.

Consider a class that wants to deep-copy a mutable `Address` field that is declared `final`:

```java
public final class Customer implements Cloneable {
    private final String name;
    private final Address address;                      // final, but mutable type
    private final List<String> tags;

    @Override
    public Customer clone() {
        try {
            Customer c = (Customer) super.clone();
            c.address = new Address(this.address);      // compile error — c.address is final
            c.tags    = new ArrayList<>(this.tags);     // compile error — c.tags is final
            return c;
        } catch (CloneNotSupportedException e) {
            throw new AssertionError(e);
        }
    }
}
```

`super.clone()` set the `final` fields by `memcpy`, so they hold the *same* references as the original. You cannot re-assign them — the language enforces `final` at the source level. To deep-copy, you would have to either drop `final` (giving up immutability and the safe-publication guarantee from JLS §17.5), or use reflection (`Field.setAccessible(true)` then `set`), or sidestep the language with `sun.misc.Unsafe`.

This is why Bloch concludes that `Cloneable` is *incompatible* with the `final` field idiom. A class that takes the disciplined route — every field `final`, all defensive copies in the constructor — cannot also use `Cloneable`. The two are at odds at the language level.

The copy-constructor route doesn't have this conflict: the copy constructor is a constructor, it runs `<init>`, it assigns `final` fields exactly once with whatever deep-copy logic the author chose. Everything you want from immutability survives.

---

## 6. Mutable subclasses of immutable parents

A subtler clone trap: when a subclass adds mutable state to a parent that is otherwise immutable, `clone()` on the parent silently produces an immutable copy with shared mutable subclass state.

```java
public class Point {                          // intended immutable
    private final int x, y;
    public Point(int x, int y) { this.x = x; this.y = y; }
    public Point clone() { /* ... super.clone() ... */ }   // shallow is fine — both fields are primitives
}

public class TaggedPoint extends Point {
    private final List<String> tags = new ArrayList<>();   // mutable!
    @Override
    public TaggedPoint clone() {
        TaggedPoint c = (TaggedPoint) super.clone();
        // OOPS — forgot to deep-copy tags
        return c;
    }
}
```

`Point` has done nothing wrong. `TaggedPoint.clone()` forgot one line. Now both the original and the clone share `tags`. The parent's immutability convinces reviewers that "this class is fine", but the subclass smuggles in shared mutable state.

The lesson is general: **immutability is not inherited; it must be re-established at every level**. With `Cloneable`, this is a chain that every author must enforce. With copy constructors, it is the local responsibility of the subclass author. Either way, *senior reviewers should always check the leaf class's mutable fields*, not just the parent.

A second lesson: this is one more argument for `final` classes. If `Point` were `final`, `TaggedPoint` couldn't exist, and the bug couldn't happen.

---

## 7. Covariant return — the one thing `clone()` got right

`Object.clone()` returns `Object`. Pre-Java 5, every caller had to cast: `Foo f = (Foo) other.clone();`. Java 5 added covariant return types (JLS §8.4.5), which let subclasses declare a more specific return:

```java
public class Order {
    @Override public Order clone() { return (Order) super.clone(); }   // covariant: Object -> Order
}
```

Callers write `Order o = orig.clone();` with no cast. The same mechanism powers the `copy()` idiom on copy-constructor hierarchies (see middle.md section 12), which is why the modern idiom doesn't lose anything in ergonomics.

Note that the `clone()` chain still requires a cast *inside* every override — `(Foo) super.clone()` — because `super.clone()` is statically typed `Object`. Forget that cast and you fall back to `Object`, callers fall back to casting, and the covariant-return benefit is lost.

---

## 8. Persistent data structures — copying that isn't copying

The most powerful answer to "how do I copy this large data structure?" is: don't. Use a structure where the original and the modified version *share most of their internals* — a **persistent** (immutable, structurally sharing) data structure.

The JDK's unmodifiable collections do not do this — `List.copyOf` produces a separate flat array each time. Library-level persistent collections (Vavr, PCollections, Eclipse Collections immutable family) do. A `PersistentVector<T>` storing a million items, after `vec.append(x)`, returns a new `PersistentVector` that shares most of the internal trie with the original; the per-append cost is `O(log32 n)` time and `O(log32 n)` extra memory rather than `O(n)`.

```java
// Vavr example
io.vavr.collection.List<Integer> base    = io.vavr.collection.List.of(1, 2, 3);
io.vavr.collection.List<Integer> updated = base.append(4);    // 'base' unchanged; shared spine
```

For Java built-ins, the practical "persistent" pattern is records plus structural sharing of immutable fields:

```java
public record Order(long id, List<LineItem> lines, OrderStatus status) {
    public Order withStatus(OrderStatus s) {
        return new Order(id, lines, s);          // 'lines' reference is shared; only one new Order allocated
    }
}
```

Sharing `lines` is safe because `List.copyOf` returns an unmodifiable list and `LineItem` is itself a record. The "copy" is a single small allocation; the gigabytes of underlying data don't move. Records, immutable collections, and disciplined sharing get you 80% of the persistent-data-structure benefit without a new library.

This is the design pattern the rest of [../05-immutability-and-defensive-copying/](../05-immutability-and-defensive-copying/) leans on: immutability turns most copy questions into *reference reuse*.

---

## 9. `Cloneable`, equality, and the `04-object-contracts-and-semantics/` siblings

Copying intersects with the other contracts in this section. A senior engineer should be able to predict the interactions.

- **`equals` / `hashCode`** ([../01-equals-hashcode-tostring-contracts/](../01-equals-hashcode-tostring-contracts/)). `Object.clone()` *spec*ifies that the result is `equals` to the receiver — for the default field-by-field copy, that's automatic for any reasonable `equals`. A copy constructor that respects "copy every field" preserves the same property. A copy that *changes* fields (a `with...` method) by definition produces a non-equal instance.

- **`Comparable`** ([../02-comparable-vs-comparator-contracts/](../02-comparable-vs-comparator-contracts/)). If `a.equals(a.clone())` is true, then `a.compareTo(a.clone()) == 0` should be true too (assuming `compareTo` is consistent with equals). Copy constructors that preserve every field preserve this naturally.

- **Object identity** ([../04-object-identity-vs-equality/](../04-object-identity-vs-equality/)). A copy is by definition `original != copy` — distinct identity. If your design uses identity as the meaning of "same object" (entity types with a database id, for example), don't *just* copy the fields; decide whether the identity should also be regenerated.

- **Defensive copying** ([../05-immutability-and-defensive-copying/](../05-immutability-and-defensive-copying/)). Copy semantics is half of defensive copying. The other half — *when* to copy, at which boundaries — is the topic of that sibling. The two work together: this file teaches the *mechanics*, the immutability section teaches the *policy*.

A class that gets all four contracts right tends to be small, final, immutable, and built on records or copy constructors. The convergence is not an accident: each contract pushes the design in the same direction.

---

## 10. When you genuinely need `Cloneable`

In practice there is one residual use case: when you must produce a copy of an instance of a class whose source you cannot edit (a third-party library) and whose author shipped `Cloneable` correctly. If `java.util.GregorianCalendar` is the class in question, calling its `.clone()` is fine — the JDK author has done the work. If `java.util.Date.clone()` is the option, same answer.

For your *own* classes, the case for `Cloneable` is essentially zero. Every advantage of `clone()` (covariant return, polymorphic copy) is available through a `copy()` method backed by a copy constructor. Every disadvantage (`super.clone()` chain, `CloneNotSupportedException`, native-method bypass of constructors, `final`-field incompatibility) is avoided.

Senior teams encode this as policy. ArchUnit rule (see `professional.md`): *no class in `com.acme..` may declare `implements Cloneable` in a class introduced after 2018*. That's the practical exit from `Cloneable` debt.

---

## 11. The cost of getting it wrong

The runtime symptoms of broken copy semantics are some of the hardest bugs to track because they are **silent**:

- Two threads "have their own copies" but one's mutation appears in the other's debugger.
- A test sets up a fixture, runs a method, asserts an unchanged input — and the assertion passes locally but fails in CI because of test ordering.
- A serialised snapshot taken at time *T1* reflects a state from time *T2* because the snapshot's `List` field is shared with a live object that's still being mutated.
- An audit log stores a `Reservation` object; the reservation is later cancelled (via a setter); the audit row appears to have been "cancelled retroactively".

None of these produce a stack trace at the *site of the bug*. They produce wrong values at the site of *observation*. The fixes are all the same patterns from `junior.md` and `middle.md`, but the time to *diagnose* is what makes the senior price tag worth paying. Most of the value of clean copy semantics is **the bug class you never have to debug**.

---

## 12. Quick rules

- [ ] `Cloneable` is a *protocol* every superclass and subclass must obey; copy constructors are a *single-class* contract. The latter composes; the former is fragile.
- [ ] `Object.clone()` bypasses `<init>` — constructor invariants never run on a clone. This is a real semantic gap, not a stylistic preference.
- [ ] `Cloneable` is incompatible with `final` fields. The disciplined immutability idiom and the legacy clone idiom cannot coexist in the same class.
- [ ] Deep copy of cyclic graphs requires an `IdentityHashMap` of "already copied". Anything else recurses forever.
- [ ] Records don't need a copy method — they need `with...` methods that share unchanged fields by reference.
- [ ] Persistent / structurally sharing data structures replace "copy" with "structural reuse"; reach for them when your data is large or your update rate is high.
- [ ] A correct clone protocol still loses to a correct copy constructor on every dimension — semantic clarity, exception story, type story, `final`-field compatibility, FBCP resistance.
- [ ] Most copy bugs are *silent*. Their diagnosis time, not their fix time, is the real cost.

---

## 13. What's next

| Topic                                                                  | File              |
| ---------------------------------------------------------------------- | ----------------- |
| Team policy, ArchUnit/Sonar rules, IDE traps, migration playbook       | `professional.md`  |
| JLS §Object.clone, §Cloneable, JEP 395 records                         | `specification.md` |
| Buggy snippets across clone/copy idioms                                | `find-bug.md`      |
| Native clone vs constructor; escape analysis; Valhalla flat copies     | `optimize.md`      |
| 8 hands-on copy and defensive-copy exercises                           | `tasks.md`         |
| Interview Q&A on clone and copy semantics                              | `interview.md`     |

---

**Memorize this:** `Cloneable` is a protocol that requires every class in the hierarchy to play along correctly, with a `native` method that skips constructors and fights `final` fields. Copy constructors and `copyOf` are local contracts that compose without depending on a chain. Cyclic graphs need an `IdentityHashMap`. Immutability — records and persistent collections — turns "deep copy" into "share the reference". When the senior question becomes *do I need a copy at all?*, the answer is usually *no* once the data is shaped correctly.
