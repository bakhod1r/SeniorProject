# Refused Bequest — Junior

> **What?** *Refused Bequest* is the code smell that appears when a subclass inherits methods and fields from its parent but *refuses* most of them — by overriding them to throw `UnsupportedOperationException`, by leaving the body empty, or by quietly doing nothing. The subclass takes the inheritance "bequest" the parent leaves it, then declines to use it. The classic example is an `ImmutableList` that extends `ArrayList` and throws on every mutating method.
> **How?** When you see `throw new UnsupportedOperationException()` inside an override, or an `@Override` method whose body is `{ /* no-op */ }`, you are almost certainly looking at refused bequest. The fix is rarely "fill in the body". The fix is usually to *stop inheriting* — replace `extends` with composition, or split the parent into smaller interfaces the subclass actually wants.

---

## 1. The smell in one paragraph

Inheritance gives a child class *everything* the parent has: fields, methods, contracts, exceptions. That's the bequest. Refused bequest happens when the child accepts the syntactic form of inheritance (it compiles, it passes `instanceof`, it can be assigned to a parent variable) but *rejects the behavioural form* — it doesn't want `add` to actually add, doesn't want `setEnabled(false)` to actually disable, doesn't want `start()` to actually start. The result is a type that lies: callers think they have a `List`, but `list.add(x)` blows up.

This is one of the most important smells in Java because the JDK itself ships textbook examples — `Stack extends Vector`, `Properties extends Hashtable<Object,Object>`, `Collections.unmodifiableList` — and they cause real bugs in production code that copies the pattern.

---

## 2. The canonical example: ImmutableList extends ArrayList

```java
public class ImmutableList<T> extends ArrayList<T> {

    public ImmutableList(Collection<? extends T> source) {
        super(source);
    }

    @Override public boolean add(T element) {
        throw new UnsupportedOperationException("immutable");
    }
    @Override public T remove(int index) {
        throw new UnsupportedOperationException("immutable");
    }
    @Override public T set(int index, T element) {
        throw new UnsupportedOperationException("immutable");
    }
    @Override public void clear() {
        throw new UnsupportedOperationException("immutable");
    }
    // ... and 8 more mutating methods, all refusing the bequest.
}
```

What's wrong:

1. **It lies about its type.** `ImmutableList<T>` *is-a* `ArrayList<T>` *is-a* `List<T>`. The `List` contract permits `add`. A method that takes `List<T>` and calls `add` is *correct* — and crashes when you hand it an `ImmutableList`.
2. **It violates Liskov substitution.** You cannot substitute `ImmutableList` for `ArrayList` without breaking callers. The whole point of subtyping is broken.
3. **The failure mode is runtime, not compile-time.** The compiler is happy. The user sees `UnsupportedOperationException` in production logs.
4. **It carries dead inheritance baggage.** `ImmutableList` inherits `elementData`, `modCount`, `size` — internal `ArrayList` machinery it doesn't need. Memory wasted, behaviour ambiguous (what does `modCount` mean for an immutable list?).

---

## 3. What the JDK itself does — and why it's still a smell

Look at `java.util.Collections#unmodifiableList`:

```java
// Inside java.util.Collections (simplified):
static class UnmodifiableList<E> extends UnmodifiableCollection<E>
                                  implements List<E> {
    public boolean add(E e)              { throw new UnsupportedOperationException(); }
    public E remove(int index)           { throw new UnsupportedOperationException(); }
    public E set(int index, E element)   { throw new UnsupportedOperationException(); }
    // ...
}
```

The JDK chose this design in Java 1.2 (1998) and we're stuck with it. Modern Java code that needs immutability uses `List.of(...)` — which *still* throws `UnsupportedOperationException` on mutation, because there is no `ImmutableList` interface separate from `List` in the JDK. The smell is baked into the standard library.

The lesson is not "the JDK does it, so it's fine". The lesson is: **the JDK got this wrong, and the cost of fixing it would break too much existing code**. In *your* code, where you don't have 28 years of backwards-compatibility debt, do better.

---

## 4. Two more textbook cases

### 4.1 `Stack extends Vector`

```java
Stack<Integer> stack = new Stack<>();
stack.push(1);
stack.push(2);
stack.push(3);
stack.add(0, 99);       // legal — Vector.add(index, element) is inherited
System.out.println(stack.pop());   // 3 — but the stack is now corrupted
```

`Stack` is meant to be LIFO. But because it inherits from `Vector`, callers can call `add(int, E)`, `remove(int)`, `insertElementAt`, and reach into the middle of the stack. The bequest `Stack` *should* refuse is most of `Vector`'s API. It doesn't refuse it — it just hopes you won't notice. That's even worse than throwing.

### 4.2 `Properties extends Hashtable<Object, Object>`

```java
Properties props = new Properties();
props.setProperty("host", "localhost");
props.put(42, new Date());            // legal — Hashtable.put accepts any Object
String h = props.getProperty("host");  // "localhost"
String d = props.getProperty("42");    // null — keys must be Strings to be visible
```

`Properties` is *meant* to be `Map<String, String>`. But it extends `Hashtable<Object, Object>`, so callers can put any object as key or value. `Properties` accepts the bequest only by *convention*, not by type. The JDK now formally discourages `Hashtable` methods on `Properties` but cannot remove them.

---

## 5. The fix: composition over inheritance

For `ImmutableList`, don't extend `ArrayList`. *Wrap* it.

```java
public final class ImmutableList<T> implements Iterable<T> {

    private final List<T> backing;

    public ImmutableList(Collection<? extends T> source) {
        this.backing = List.copyOf(source);   // defensive copy + already immutable
    }

    public int size()       { return backing.size(); }
    public T   get(int i)   { return backing.get(i); }
    public boolean contains(Object o) { return backing.contains(o); }

    @Override public Iterator<T> iterator() {
        return Collections.unmodifiableList(backing).iterator();
    }

    public Stream<T> stream() { return backing.stream(); }
}
```

Now:

- There is no `add` method to refuse. The class doesn't lie.
- A caller who has an `ImmutableList<T>` *cannot* try to mutate it — the compiler stops them.
- The Liskov question doesn't arise — `ImmutableList` isn't a subtype of `List`.
- You picked exactly the operations you want to expose.

The trade-off: you lose the ability to pass `ImmutableList` to a method that takes `List<T>`. If that matters, expose a read-only view via `List.copyOf(backing)` from a method like `asList()`.

---

## 6. How to recognise it in code review

The strongest signals, ordered by severity:

1. **`throw new UnsupportedOperationException(...)` inside `@Override`** — almost always refused bequest. Search for it in your codebase.
2. **Empty overrides** — `@Override void onResume() {}` in a framework subclass. The subclass *says* it handles `onResume` but actually doesn't. This is a softer refused bequest.
3. **Overrides whose body is `// intentionally left blank`** — same pattern, just commented.
4. **`@Deprecated` overrides** — the parent has a method, the subclass overrides it to do nothing and marks it deprecated so callers stop using it. The deprecation is an admission the bequest was unwanted.
5. **Class-level Javadoc that says "do not call methods X, Y, Z"** — if the documentation has to warn callers off inherited methods, those inherited methods are refused.

---

## 7. Why it's worse than other smells

Most code smells (long method, large class, duplicate code) make code *harder to read*. Refused bequest is different — it makes code *lie about its type*. The type system is supposed to be your safety net. A class that throws on inherited methods turns the safety net into a tripwire.

The consequences:

- **Static analysis is fooled.** Tools that check "does this code call `List.add`?" say yes. They cannot tell that this specific `List` will throw.
- **Polymorphism is poisoned.** Any code that takes a `List` parameter must now defensively avoid the throwing methods, or wrap calls in try/catch.
- **Refactoring is dangerous.** "Extract this method to take a `Collection` instead of a `List`" might suddenly work in tests and break in production because production passed an immutable list.

---

## 8. A first-day rule

If you're about to write `extends SomeConcreteClass`, ask:

> Will I use *every* method I'm inheriting?

If the answer is "no, I'll override a few to throw" — stop. You don't want inheritance. You want composition, or you want a narrower interface. Inheritance is for *is-a*. If you find yourself refusing the parent's bequest, you don't have an *is-a* relationship. You have a *has-a* or a *behaves-like-some-of* relationship, and Java has cleaner tools for both.

---

## 9. Quick checklist

- [ ] No `throw new UnsupportedOperationException()` in `@Override` methods in production code.
- [ ] No empty `@Override` bodies that aren't documented as deliberate hooks.
- [ ] If you `extends` a concrete class, you use *all* of its public methods meaningfully.
- [ ] Immutable variants do not extend mutable parents.
- [ ] When in doubt, prefer composition + a narrow interface over inheritance.

---

## 10. What's next

| Topic                                                              | File              |
| ------------------------------------------------------------------ | ----------------- |
| Why refused bequest happens; refactoring playbook                  | `middle.md`        |
| LSP lens, Pull/Push Down Method, JDK trade-offs                    | `senior.md`        |
| Detection (ArchUnit), legacy migration                             | `professional.md`  |
| Formal definition, NOM thresholds, PMD/SonarJava rules             | `specification.md` |
| 10 numbered diagnosis scenarios                                    | `find-bug.md`      |
| JIT inlining, vtable cost, deopt risk                              | `optimize.md`      |
| 8 practice exercises with validation                               | `tasks.md`         |
| 20 Q&A interview prep                                              | `interview.md`     |

Related smells and principles:

| Topic                          | Path                                                      |
| ------------------------------ | --------------------------------------------------------- |
| Fragile Base Class Problem     | `../../03-design-principles/05-fragile-base-class/`        |
| Liskov Substitution Principle  | `../../03-design-principles/01-solid-principles/`          |
| Composition over Inheritance   | `../../03-design-principles/02-composition-over-inheritance/` |

---

**Memorize this:** Refused bequest is a subclass that throws or no-ops on methods it inherited. It lies about its type, breaks Liskov substitution, and the type system stops protecting callers. The fix is rarely "fill the body" — the fix is to stop inheriting. Wrap instead of extend; pick the operations you want; let the compiler enforce the rest.
