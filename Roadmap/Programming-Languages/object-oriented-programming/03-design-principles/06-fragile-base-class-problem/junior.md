# Fragile Base Class Problem — Junior

> **What?** The *Fragile Base Class Problem* (FBCP) is the observation that a *working* subclass can break when its *superclass* changes — even if the superclass's change looks completely internal and the subclass author hasn't touched a line. The subclass inherits not only the parent's public API but the *implementation details* the parent uses to fulfil that API, including which methods call which.
> **How?** Recognise FBCP by noticing how much information the subclass author needs about the parent's *internals*. If the override would behave differently when the parent reorganizes its method calls, the relationship is fragile. The fixes are: make the parent's contract explicit and frozen (document self-use), prohibit inheritance with `final`, or replace inheritance with composition.

---

## 1. The smell, in one snippet

A counting variant of `ArrayList`:

```java
public class CountingList<E> extends ArrayList<E> {
    private int addCount = 0;

    @Override public boolean add(E e) {
        addCount++;
        return super.add(e);
    }

    @Override public boolean addAll(Collection<? extends E> c) {
        addCount += c.size();              // count once for the bulk add
        return super.addAll(c);
    }

    public int addCount() { return addCount; }
}
```

Today this works:

```java
CountingList<String> list = new CountingList<>();
list.addAll(List.of("a", "b", "c"));
list.addCount();                  // 6, not 3
```

`addAll` returns `6` because the *implementation* of `ArrayList.addAll` calls `add(e)` internally for each element. The subclass's `addAll` adds `+= c.size()` *and* the inherited self-use of `add` triggers `addCount++` three times. The override double-counts.

Worse: the bug only exists *because* of the parent's internal call pattern. The parent's author could change `addAll` tomorrow to use `System.arraycopy(...)` instead — and the subclass's count would become *correct again*. The subclass's behaviour depends on private details of the parent's implementation.

That's the Fragile Base Class Problem in 30 lines.

---

## 2. Why it's called "fragile"

The subclass is "fragile" because:

- A change inside the parent — *which the parent's author considers internal* — silently changes the subclass's behaviour.
- The subclass author has no way to defend against it without reading the parent's source.
- Bug reports look like "we didn't change anything and now our tests fail".

The fragility is *not* in any one line of code; it's in the *contract* between parent and subclass. Inheritance committed both to *every method the parent has*, and *every internal call pattern the parent uses today*. The latter isn't even part of the parent's documentation.

---

## 3. The everyday analogy

Imagine you bought a toaster designed in 2020. You modify it by replacing one component (say, the heating element) with your own. It works fine. In 2024, the manufacturer "updates" the toaster's internal wiring — same exterior, same buttons, same toasting behaviour — but the new wiring routes power to your replacement component differently. Your modification, untouched, now smokes the kitchen.

You didn't change anything. The manufacturer made an *internal* change that they consider invisible from outside. But your modification reached into the *internal* wiring; the change affected you.

Inheritance lets you reach into the wiring. Composition would have built the new toaster from scratch, with a documented interface (a power plug) — the manufacturer can change anything internal without affecting you.

---

## 4. Joshua Bloch's three FBCP forms

*Effective Java* (item 18) identifies three concrete failure modes:

**Form 1 — Self-use changes.** The parent's method calls another of the parent's methods that the subclass has overridden. When the parent refactors to *stop* calling it (or to call a *different* one), the subclass's override stops firing.

```java
class Parent {
    public void doWork() { log(); save(); }     // self-use of save()
    public void save() { /* ... */ }
}
class Child extends Parent {
    @Override public void save() { /* extra step */ super.save(); }
}
// Parent v2: removes save() from doWork, saves elsewhere
// Child's extra step now silently doesn't run for doWork() calls
```

**Form 2 — New methods on parent.** The parent adds a new method with the same signature as one the subclass already had as a private helper. The subclass's helper now accidentally overrides the parent's method, with unexpected results.

**Form 3 — Removed methods on parent.** The parent removes (or deprecates) a method the subclass relied on via `super.x()`. The subclass either fails to compile or, worse, silently does nothing.

Each form arises from inheritance forcing the subclass into a contract about the parent's *implementation*, not just its API.

---

## 5. A worked example — `Stack extends Vector`

The classic FBCP in the JDK itself: `java.util.Stack` extends `java.util.Vector`.

```java
Stack<Integer> stack = new Stack<>();
stack.push(1); stack.push(2); stack.push(3);
stack.add(0, 99);              // legal — Vector exposes random-access mutation
stack.peek();                  // returns 3, as if nothing happened
stack.pop();                   // pops 3
stack.peek();                  // returns 2
stack.size();                  // 3 — there's still the rogue 99 at position 0
```

`Stack` inherits *every* `Vector` method, including `add(int, E)` for indexed insertion, `set(int, E)`, `remove(int)`, `clear()`, `subList()`. None of these have any business being on a stack. The stack invariant (LIFO order) is violated by every caller who can name `Vector.add(int, E)`.

The JDK has lived with this since 1.0. The fix would be a `Stack` that *composes* a `Vector` (or `ArrayDeque`) and exposes only `push`, `pop`, `peek`, `size`, `empty`. Modern code uses `Deque<E> stack = new ArrayDeque<>();` for exactly this reason — `Deque` doesn't have FBCP exposure to `Vector`'s history.

---

## 6. The cure — `final`, composition, or careful design

Three ways to avoid FBCP:

**Mark your class `final`.** If your class isn't designed for inheritance, mark it `final`. Java compiler refuses any subclass; FBCP is impossible. Joshua Bloch's rule: *design and document for inheritance, or prohibit it*. `final` is the prohibition.

```java
public final class CountingList<E> { /* fully isolated */ }
```

**Compose, don't inherit.** Hold the would-be parent as a field and forward only the methods you mean to expose.

```java
public final class CountingList<E> {
    private final List<E> backing = new ArrayList<>();
    private int addCount = 0;
    public boolean add(E e)                 { addCount++; return backing.add(e); }
    public boolean addAll(Collection<? extends E> c) {
        addCount += c.size();
        return backing.addAll(c);
    }
    // no access to add(int, E) — not exposed
}
```

The composition isolates you from the wrapped class's internal self-use. The `List` is a black box; your wrapper sees only its public API.

**Design the parent for inheritance.** When you genuinely need the parent to be extended, document its self-use, mark non-extension methods `final`, and provide explicit hook methods. We'll cover this in [`middle.md`](middle.md) and [`senior.md`](senior.md).

---

## 7. Common newcomer mistakes

**Mistake 1: extending JDK collections.**

```java
public class UserList extends ArrayList<User> { ... }
```

The instinct ("I want a list of users with extra methods") leads to FBCP. Use composition; hold an `ArrayList<User>` privately.

**Mistake 2: "I'll just call `super.method()` carefully."**

The override's correctness depends on which other methods `super.method()` calls. You don't control that, and the parent's author doesn't promise it.

**Mistake 3: copy-pasting the parent's code into the override.**

A common "fix" — re-implement the parent's `addAll` so you can control which sub-calls happen. Now your override is duplicated parent code that drifts out of sync as the parent evolves.

**Mistake 4: ignoring `@Override`.**

Without `@Override`, a typo in the method name silently produces an inheritance miss (a private helper instead of an override). Always annotate.

---

## 8. Quick rules

- [ ] Inherits from a class you don't control? You've signed up for FBCP.
- [ ] Subclass overrides a parent method? Read the parent's source for self-use.
- [ ] Mark classes `final` unless designed for inheritance.
- [ ] Default: compose, don't inherit. See [../02-composition-over-inheritance/](../02-composition-over-inheritance/).
- [ ] If you must extend, prefer extending classes *designed* for it (e.g., `AbstractList` has documented hooks, unlike `ArrayList`).
- [ ] `@Override` everywhere — typos and missed overrides become compile errors.

---

## 9. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Worked FBCP refactors and parent-design recipes             | `middle.md`        |
| Self-use contracts, version evolution, mitigations          | `senior.md`        |
| Driving FBCP awareness across a team                        | `professional.md`  |
| JLS rules on overriding, sealed types, final                | `specification.md` |
| Spotting FBCP-shaped runtime bugs                           | `find-bug.md`      |
| Performance: virtual calls, devirtualization, CHA           | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** the Fragile Base Class Problem is what makes inheritance dangerous: a subclass's correctness depends not only on the parent's *API* but on the parent's *implementation* — specifically, on which internal methods call which. The cures are `final` (prohibit inheritance), composition (avoid the contract entirely), or careful parent design (make the contract explicit). Modern Java leans toward `final` + composition by default.
