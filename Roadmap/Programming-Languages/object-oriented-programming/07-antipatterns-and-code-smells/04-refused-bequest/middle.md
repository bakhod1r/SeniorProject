# Refused Bequest — Middle

> **What?** Refused bequest doesn't appear in code because developers want broken types. It appears because several reasonable-looking pressures push them into bad inheritance: a class that already has 80% of what they need, a framework that demands `extends BaseActivity`, a vocabulary that conflates *reuse* with *is-a*. This file catalogues *why* the smell appears and *how* to refactor it once you've found it.
> **How?** For each cause, there is a refactoring move: replace inheritance with composition, push methods down to subclasses that actually want them, pull methods up only when they belong to every subclass, or split a fat parent into focused interfaces. Most real fixes combine two of these moves.

---

## 1. Five reasons refused bequest appears

### 1.1 Inheritance for implementation reuse

The developer needs *part* of what some class does — a hash table, a list, a queue — and reaches for `extends` because it's the fastest path to "I already have it".

```java
// "I need set-style behaviour plus uniqueness by ID."
public class UserSet extends HashSet<User> {
    public Optional<User> findById(long id) {
        return stream().filter(u -> u.id() == id).findFirst();
    }
    // ... but the caller can still .add(null), .remove(...), call .iterator() and mutate.
}
```

The developer wanted `HashSet`'s *implementation*. They got its *whole public contract*, including methods they didn't think about. That contract leaks out the moment any caller treats `UserSet` as a `Set<User>`.

### 1.2 Framework subclassing

Many Java frameworks force `extends`:

```java
public class CreateInvoiceJob extends QuartzJobBean {
    @Override protected void executeInternal(JobExecutionContext ctx) { ... }
    // inherited: setApplicationContext, isVolatile, etc. — most of which we never touch.
}
```

You don't *want* to inherit. The framework gives you no other lever. Refused bequest here is partially the framework's fault — but it's still a smell, because methods you didn't override still exist on your class's surface area.

### 1.3 IS-A confusion

A developer writes `class Square extends Rectangle` because "a square *is* a rectangle". Geometrically yes, in the type system no — because `Rectangle`'s contract permits independent width and height changes. The mental model of *is-a* in the real world doesn't translate to *is-a* in the type system. When the subclass has to override behaviour to lie about that contract, you have refused bequest.

### 1.4 Modeling a narrower variant

`ImmutableList extends ArrayList`. The author wanted "a list, but immutable". They modelled "narrower" as "subclass with some methods disabled". This is exactly backwards — narrower variants should *not* be subtypes of broader variants, because subtypes must accept everything the supertype accepts (Liskov).

### 1.5 Default no-op overrides for "optional" callbacks

```java
public abstract class LifecycleAware {
    public void onStart()  {}
    public void onStop()   {}
    public void onPause()  {}
    public void onResume() {}
}
```

Here the parent *invites* refusal — the base class provides empty defaults so subclasses only override what they care about. This is the most defensible form of refused bequest, but it still leaves you with subclasses whose `@Override onPause(){}` says nothing about whether they meant "I don't care" or "I forgot".

---

## 2. The five refactoring moves

Once you've identified refused bequest, you have a small toolkit. Pick the one that matches the cause.

### 2.1 Replace Inheritance with Composition

The bread-and-butter fix. Move from `class Child extends Parent` to `class Child { private Parent delegate; }`.

```java
// Before: refused-bequest UserSet
public class UserSet extends HashSet<User> {
    public Optional<User> findById(long id) { ... }
}

// After: composition
public final class UserDirectory {
    private final Set<User> users = new HashSet<>();

    public void add(User u)             { users.add(u); }
    public boolean contains(User u)     { return users.contains(u); }
    public int size()                   { return users.size(); }
    public Optional<User> findById(long id) {
        return users.stream().filter(u -> u.id() == id).findFirst();
    }
    public Stream<User> stream()        { return users.stream(); }
}
```

Now the public API is exactly what `UserDirectory` *wants* to offer. No `removeIf`, no `iterator`, no `retainAll` unless you choose to expose them.

### 2.2 Extract a narrower interface

When the parent is too fat, define the slice you actually want and have callers depend on that.

```java
// Parent (existing): List<T> — 30+ methods.
// What you really want: a read-only sequence.

public interface ReadSequence<T> extends Iterable<T> {
    int size();
    T get(int index);
    Stream<T> stream();
}

public final class ImmutableSequence<T> implements ReadSequence<T> {
    private final List<T> data;
    public ImmutableSequence(Collection<? extends T> source) { this.data = List.copyOf(source); }
    public int size()           { return data.size(); }
    public T get(int index)     { return data.get(index); }
    public Stream<T> stream()   { return data.stream(); }
    public Iterator<T> iterator() { return data.iterator(); }
}
```

Now no mutating method can be called because none is on the type.

### 2.3 Push Down Method

If the parent has a method only *some* subclasses want, the right place is *in those subclasses*, not in the parent.

```java
// Before: refused bequest, every Animal has fly()
abstract class Animal {
    public void fly() { throw new UnsupportedOperationException(); }   // smell
}
class Bird   extends Animal { @Override public void fly() { ... } }
class Dog    extends Animal { /* inherits the throwing fly() */ }

// After: push fly() down to Bird
abstract class Animal { }
class Bird extends Animal { public void fly() { ... } }
class Dog  extends Animal { }
```

Now no animal has a `fly()` method that throws. Code that needs `fly` takes `Bird`, not `Animal`.

### 2.4 Pull Up Method (the inverse)

Sometimes refused bequest exists because *two* subclasses both override a parent method to do nothing, while *one* subclass uses it. The fix is the opposite of pushing down: move the *useful* method *out* of the shared parent and back into the single subclass that wants it. The other two subclasses lose their no-op overrides because the method no longer exists in their hierarchy.

### 2.5 Sealed hierarchy with explicit cases

For modeling-driven refused bequest, modern Java offers sealed types.

```java
public sealed interface Shape permits Circle, Rectangle, Square {}

public record Circle(double radius)          implements Shape {}
public record Rectangle(double w, double h)  implements Shape {}
public record Square(double side)            implements Shape {}

// callers pattern-match:
double area(Shape s) {
    return switch (s) {
        case Circle c    -> Math.PI * c.radius() * c.radius();
        case Rectangle r -> r.w() * r.h();
        case Square sq   -> sq.side() * sq.side();
    };
}
```

No inheritance, no refused bequest, exhaustive at compile time.

---

## 3. A worked refactor

Suppose you find this class in a code review:

```java
public class CachedMap<K, V> extends LinkedHashMap<K, V> {

    private final int maxEntries;

    public CachedMap(int maxEntries) {
        super(maxEntries, 0.75f, true);   // access-order
        this.maxEntries = maxEntries;
    }

    @Override protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
        return size() > maxEntries;
    }

    @Override public V put(K k, V v) {
        if (v == null) throw new IllegalArgumentException("null forbidden");
        return super.put(k, v);
    }

    @Override public V remove(Object key) {
        throw new UnsupportedOperationException("entries are evicted by LRU policy");
    }

    @Override public void clear() {
        throw new UnsupportedOperationException("entries are evicted by LRU policy");
    }
}
```

The smell: `remove` and `clear` are refused. But callers who type their variable as `Map<K, V>` will not see this — they will call `remove` and crash.

Refactor: replace inheritance with composition, and design the public surface deliberately.

```java
public final class LruCache<K, V> {

    private final LinkedHashMap<K, V> map;

    public LruCache(int maxEntries) {
        this.map = new LinkedHashMap<>(maxEntries, 0.75f, true) {
            @Override protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
                return size() > maxEntries;
            }
        };
    }

    public V get(K key)            { return map.get(key); }
    public void put(K key, V value) {
        if (value == null) throw new IllegalArgumentException("null forbidden");
        map.put(key, value);
    }
    public int size()              { return map.size(); }
    public boolean contains(K key) { return map.containsKey(key); }
}
```

Now:

- `LruCache` does not extend `Map`. Callers can't type-coerce to `Map<K, V>` and call `remove`.
- The eviction policy is internal — callers don't see `removeEldestEntry`.
- No `throw new UnsupportedOperationException`. The smell is gone.
- We kept the `LinkedHashMap` *implementation*, just hid it behind a focused API.

---

## 4. When refused bequest is acceptable

Three cases come up in real codebases:

1. **The empty default in an optional-callback base class.** When a base class provides empty implementations of lifecycle methods so subclasses only override what they care about (e.g., `WindowAdapter` in `java.awt.event`), the empty method is a deliberate hook, not refused bequest. Document it as such with Javadoc.
2. **Framework lock-in you can't break.** If `extends QuartzJobBean` is mandatory and the inherited surface has 12 methods you don't touch, the refused bequest exists but your hands are tied. Mitigate by keeping your subclass thin and delegating real work to a composed service.
3. **JDK collections views.** `Collections.unmodifiableList`, `Collections.emptyList`, etc., throw on mutation. They're a *language convention* baked into the JDK. You can't escape them, but you can prevent your own code from spreading the pattern.

---

## 5. The cost of getting it wrong

A refused-bequest class typically causes one of four production incidents:

- **The "it worked in unit tests" bug.** Unit tests used `ArrayList`. Production used your `ImmutableList`. A previously fine `list.add(...)` line now throws.
- **The serialization landmine.** A subclass that inherits but refuses some fields serializes (Jackson, default) the parent's fields anyway — including ones the subclass treats as illegal.
- **The reflective surprise.** A library scans methods via reflection (`getDeclaredMethods` or `getMethods`) and invokes them. The refused method throws, the library crashes.
- **The IDE auto-complete trap.** A developer types `imm.` and sees `add`, `remove`, `clear` in autocomplete (because they're inherited). They use one. CI passes (the unit test mocks the list). Prod fails.

Each of these costs more than the refactor.

---

## 6. Decision flow

When you spot a parent-child pair that looks suspicious, walk this flow:

1. Does the child override `@Override` methods to throw or no-op? **Yes** → refused bequest.
2. If yes, *why* does the child inherit?
   - Implementation reuse → **Replace with composition** (§2.1).
   - Modeling a narrower variant → **Extract narrower interface** (§2.2).
   - Some subclasses need the method, some don't → **Push Down** (§2.3).
   - One subclass needs it, others don't → **Pull Up out of the parent** (§2.4).
   - Multiple disjoint variants → **Sealed hierarchy** (§2.5).
3. Apply the move. Re-run tests. Look for new compile errors — they reveal callers that depended on the now-removed parent type.

---

## 7. Quick rules

- [ ] If you override a method to throw, ask "should this class inherit at all?"
- [ ] Prefer wrapping a concrete class over extending it when you only want *some* of its behaviour.
- [ ] Narrower variants are not subtypes of broader variants — make them separate types.
- [ ] Push optional behaviour *down* into the subclass that wants it, not *up* into the parent.
- [ ] Don't conflate "this thing in the real world is a kind of that" with "this Java type should extend that Java type".

---

## 8. What's next

| Topic                                                              | File              |
| ------------------------------------------------------------------ | ----------------- |
| Liskov lens, JDK trade-offs, Pull/Push Down formally               | `senior.md`        |
| ArchUnit detection, legacy migration playbooks                     | `professional.md`  |
| NOM metric, PMD/SonarJava rules                                    | `specification.md` |
| 10 diagnosis scenarios with fixes                                  | `find-bug.md`      |
| Performance angle (JIT, vtable)                                    | `optimize.md`      |
| Hands-on exercises                                                 | `tasks.md`         |
| 20 Q&A                                                             | `interview.md`     |

Related:

| Topic                          | Path                                                          |
| ------------------------------ | ------------------------------------------------------------- |
| Composition over Inheritance   | `../../03-design-principles/02-composition-over-inheritance/`  |
| Liskov Substitution Principle  | `../../03-design-principles/01-solid-principles/`              |
| Fragile Base Class             | `../../03-design-principles/05-fragile-base-class/`            |

---

**Memorize this:** Refused bequest is rarely a coding mistake — it's a *modeling* mistake. The developer reached for `extends` when they wanted `has-a`, or modelled a narrower variant as a subtype of a broader one. Five refactor moves cover most cases: replace inheritance with composition, extract a narrower interface, push down, pull up, or convert to a sealed hierarchy. Pick the move that matches the *cause*, not the smell.
