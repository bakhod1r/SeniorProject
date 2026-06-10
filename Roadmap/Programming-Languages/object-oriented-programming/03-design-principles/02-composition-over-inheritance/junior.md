# Composition Over Inheritance — Junior

> **What?** *Composition over inheritance* is the design heuristic: when you need to reuse behaviour, prefer assembling objects out of smaller cooperating parts (**has-a**) over deriving new classes from a parent (**is-a**). Inheritance is one tool for reuse, but it locks the child into a contract with its parent. Composition keeps that coupling explicit and changeable.
> **How?** Before writing `class B extends A`, ask: "Is every B *really* an A, in every way A is used? Or do I just want to *reuse a few methods*?" If it's reuse you want, give B a *field* of type A (or an interface implemented by A) and delegate. The decision usually comes down to whether you need substitutability or just behaviour sharing.

---

## 1. The slogan in one example

You're building an `Stack` and you'd like to reuse `ArrayList`'s storage.

**Inheritance approach (tempting, wrong):**

```java
public class Stack<T> extends ArrayList<T> {
    public void push(T t) { add(t); }
    public T pop()        { return remove(size() - 1); }
    public T peek()       { return get(size() - 1); }
}
```

This compiles. It even works — until someone does this:

```java
Stack<String> s = new Stack<>();
s.push("a"); s.push("b"); s.push("c");
s.add(0, "X");                        // ← ArrayList API still public
s.remove(1);                          // ← also still public
```

Your stack has just leaked every `ArrayList` method. Random code can insert at index 0, remove anywhere, sort, clear, sublist — none of which a stack should permit. The class extends `ArrayList`, so it *is* an `ArrayList`, so callers can use it as one.

**Composition approach:**

```java
public class Stack<T> {
    private final ArrayList<T> storage = new ArrayList<>();    // has-a

    public void push(T t) { storage.add(t); }
    public T pop()        { return storage.remove(storage.size() - 1); }
    public T peek()       { return storage.get(storage.size() - 1); }
    public int size()     { return storage.size(); }
}
```

Now the public API is *only* `push`, `pop`, `peek`, `size`. The `ArrayList` is an implementation detail. Nobody can call `add(0, …)` because nobody can see the list. You can swap the storage to `ArrayDeque`, a primitive array, or a linked structure without breaking a single caller.

---

## 2. "Is-a" vs "Has-a"

The traditional rule of thumb:

| Relationship | Modeled as          | Example                                  |
| ------------ | ------------------- | ---------------------------------------- |
| **is-a**     | `class Sub extends Super` | `Square is a Shape`; `ArrayList is a List` |
| **has-a**    | A field of that type, or an interface field, with delegation | `Car has an Engine`; `Order has a Customer` |

The trick: "is-a" is much narrower than it sounds. `Stack is a kind of ArrayList` *sounds* OK in English, but the contracts are different. Real "is-a" requires *behavioural compatibility* (Liskov Substitution — see [../01-solid-principles/](../01-solid-principles/)). Most reuse situations aren't true is-a; they're "I want this object to know how to do X, like that other one does".

---

## 3. Why inheritance over-couples

When `Child extends Parent`:

- **Every public method of `Parent` is public on `Child`.** You inherit the whole API surface whether you want to or not.
- **Internal changes in `Parent` ripple to `Child`.** A new method, a renamed method, a stricter precondition — they can break the subclass silently. This is the Fragile Base Class problem (see [../06-fragile-base-class-problem/](../06-fragile-base-class-problem/)).
- **`Child` cannot opt out** of a parent's method without throwing — which violates LSP.
- **Single inheritance forces a tree.** Java only allows one superclass. If you want to "combine" two parents' behaviour, you can't (with classes). Composition has no such limit.

Composition keeps these costs explicit: the relationship lives in a *field*, and you choose which of the field's methods to expose by writing your own forwarding methods.

---

## 4. The Decorator pattern — composition as a superpower

```java
public interface Notifier {
    void notify(String message);
}

public class EmailNotifier implements Notifier {
    public void notify(String message) { /* send email */ }
}

// Add SMS *without* editing EmailNotifier:
public class SmsNotifier implements Notifier {
    private final Notifier delegate;
    public SmsNotifier(Notifier delegate) { this.delegate = delegate; }
    public void notify(String message) {
        delegate.notify(message);             // delegate first
        /* also send SMS */
    }
}

// Add Slack on top:
Notifier full = new SlackNotifier(new SmsNotifier(new EmailNotifier()));
full.notify("Server down");                    // email + SMS + Slack
```

This is the Decorator pattern. It would be a *nightmare* with inheritance — you'd need `EmailNotifier`, `EmailAndSmsNotifier`, `EmailAndSlackNotifier`, `EmailAndSmsAndSlackNotifier`, `SmsAndSlackNotifier`, … combinatorial explosion. Composition replaces it with one chain per use case.

---

## 5. The Strategy pattern — pluggable behaviour

```java
public interface ShippingCost {
    Money calculate(Order order);
}

public class StandardShippingCost implements ShippingCost { ... }
public class ExpressShippingCost  implements ShippingCost { ... }
public class FreeShippingCost     implements ShippingCost { ... }

public class Cart {
    private final ShippingCost shipping;          // has-a strategy
    public Cart(ShippingCost shipping) { this.shipping = shipping; }
    public Money totalWithShipping() {
        return subtotal().plus(shipping.calculate(this));
    }
}
```

`Cart` doesn't *inherit* a particular shipping rule. It *has* one and delegates. Today's cart can use `StandardShippingCost`; tomorrow you swap to `FreeShippingCost` for a promotion — without touching `Cart` or rewriting class hierarchies.

---

## 6. When inheritance *is* the right tool

This isn't "never use inheritance". Inheritance shines when:

- **You actually need substitutability** — a `Shape` hierarchy where polymorphic dispatch (`shape.area()`) matters and every subclass *is* a shape behaviourally.
- **You're modeling a stable, narrow type hierarchy** — sealed types in Java 21 give you closed, exhaustive hierarchies (`Vehicle = Car | Truck | Bike`).
- **The parent is designed for inheritance** — explicitly. Joshua Bloch's *Effective Java* rule: "Design for inheritance, or prohibit it." If a class wasn't designed to be subclassed, mark it `final` and use composition.
- **You're using a framework that demands it** — JPA entities, Spring's parent abstract classes, exception hierarchies.

A heuristic test: can the child override one of the parent's methods *without breaking* any code that uses the parent? If yes, inheritance is fine. If your override has to violate the parent's contract (throw new exceptions, return surprising values), you're abusing inheritance.

---

## 7. Java idioms that prefer composition

Many things you might reach for inheritance to do, Java already supports compositionally:

| Goal                                         | Composition idiom                                  |
| -------------------------------------------- | -------------------------------------------------- |
| Add cross-cutting behaviour (logging, retry) | Decorator + interface                              |
| Pluggable algorithm                          | Strategy: interface field, swappable               |
| Share behaviour across unrelated types       | Default methods on a small interface               |
| Reuse a complex collaborator                 | Field + delegate; or constructor-inject            |
| Build a type from parts                      | Record with multiple field types                   |

Default methods (Java 8+) deserve a special mention — they let an *interface* carry a small amount of shared code without forcing class inheritance. They're a thin form of composition in the type system.

---

## 8. Common newcomer mistakes

**Mistake 1: extending utility classes.**

```java
public class UserList extends ArrayList<User> { ... }
public class StringMap extends HashMap<String, String> { ... }
```

You inherit `add`, `remove`, `clear`, `subList`, etc. — every collection mutator. A user of `UserList` can `clear()` it. Use composition: hold an `ArrayList<User>` privately, expose only the methods that make sense.

**Mistake 2: extending domain classes to "specialize".**

```java
public class PremiumCustomer extends Customer { ... }
```

If "premium" is a state, model it as a flag or a value object. If it's a different role with completely different invariants, it should probably be its own class with its own interface. Inheritance ties the two together permanently — flexible state changes are gone.

**Mistake 3: extending for code reuse alone.**

If you just want one method from a parent, give your class a *field* of that type and call it. Don't drag in the whole class.

**Mistake 4: refusing inheritance everywhere.**

The slogan is *composition over inheritance*, not *composition instead of inheritance*. Sealed type hierarchies, polymorphic dispatch for closed sets of variants, and well-designed abstract classes are still legitimate. Reflexive rejection costs you readable, working idioms.

---

## 9. Quick rules

- [ ] Default to "has-a". Use a field, delegate, expose only what callers need.
- [ ] Use inheritance only when you need *behavioural* substitutability.
- [ ] If you can't substitute the child for the parent everywhere, it's not real inheritance.
- [ ] Prefer interfaces + composition for cross-cutting behaviour.
- [ ] Mark classes `final` unless designed for extension.
- [ ] Sealed types are inheritance done safely — use them for closed type families.

---

## 10. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Worked refactors from inheritance to composition            | `middle.md`        |
| Decorator/Strategy in depth; framework-driven inheritance   | `senior.md`        |
| Driving the rule across a team and a codebase               | `professional.md`  |
| JLS support for sealed types, final, interfaces             | `specification.md` |
| Spotting subtle "is-a" abuse                                | `find-bug.md`      |
| JIT, dispatch cost, allocation: composition vs inheritance  | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** ask whether you need *substitutability* or just *behaviour sharing*. If sharing, use composition — a field plus delegation. Inheritance is a contract with the parent; only sign it when the child can keep the contract everywhere the parent is used.
