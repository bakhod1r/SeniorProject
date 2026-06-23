# Attributes and Methods — Senior

> **How to optimize?** Reduce surface area. Fewer fields, fewer methods, fewer parameters, fewer modes — every removal makes the next change cheaper. Performance optimizations follow naturally once the API is small enough to reason about.
> **How to architect?** Treat each public method as a *capability* the class offers and each public field as a *fact* the class exposes. Then ask: would I commit to this fact, this capability, for the next five years? If not, push it private or remove it.

---

## 1. The public surface is the contract

Everything `public` is the contract. A field, a method, a return type, a thrown exception — once it ships, callers depend on it. Each one becomes a constraint on what you can change without breaking them.

Senior class design is a permanent fight to keep this surface small:

- Hide fields behind methods (or behind nothing — make them internal).
- Hide collaborators behind interfaces.
- Hide construction behind static factories.
- Hide variants behind a sealed hierarchy with one entry point.

The ratio of **public surface to behavior** is a rough quality signal. A class with 30 public methods and 2 actual capabilities is over-exposed. A class with 3 public methods that wrap a powerful internal pipeline is well-encapsulated.

---

## 2. Field design: the smallest faithful model

Every field is a commitment to *remembering* something. Each one:

- Costs heap memory (4–8 B per reference, plus padding).
- Costs cognitive load (one more piece of state to reason about during every method).
- Costs concurrency safety (every mutable field needs a story).
- Costs persistence work (mappers, serializers, migrations).

So the discipline: **minimum fields necessary for the methods to do their job correctly**.

Three smells you should fix immediately:

**(a)** **Derivable field.** `subtotal` stored alongside `lines`. Drop it; compute on demand or memoize.

**(b)** **Flag field.** `boolean isShipped` next to `OrderStatus status`. The flag duplicates an enum's information; one of them will eventually disagree with the other.

**(c)** **Optional-shaped field.** `User assignee` that may be `null`. Sometimes that's right; often it's a missing concept ("unassigned" is a state, not a null).

The architecturally satisfying answer is usually "model the missing concept." Replace `null` with a `Sentinel`/empty-state instance (Null Object pattern), or replace flags with a sealed status type.

---

## 3. Encapsulation past the textbook (again)

The textbook view: hide fields, expose getters/setters. The senior view: **expose capabilities, not data shape.**

```java
// data-shape API
order.setStatus(SHIPPED);
order.setShippedAt(now);
order.getLines().forEach(l -> l.setShipped(true));
// caller now responsible for: order; only ship after payment; lines must agree

// capability API
order.ship();
// caller responsibility: just call ship() at the right time
```

In the second version, the *invariant* — "shipping flips the status, sets the timestamp, marks each line, all atomically" — lives inside the class. There is no way for the caller to do part of the work and not the rest. That's encapsulation actually doing its job.

Test: count how many things a caller has to remember to do in the right order. Every "remember to" is a code-review checklist item the caller will eventually forget.

---

## 4. Method cohesion: every method earns its keep

The Single Responsibility Principle, applied at method level: **each method does one thing at one level of abstraction**.

Heuristics:

- **Read the body.** If you write *and then* twice in the natural-language description, it's two methods.
- **Look at indentation.** Two nested `if`s at four levels deep usually means a sub-step is hiding inside.
- **Try to name it.** If the only honest name is `processData`, you have a method; if you can call it `validateThenSaveAndNotify`, you have three.

Extract early. The *cost* of extraction is one indirection. The *value* is a name in your method directory and a unit of testable behavior.

A useful rule of thumb at the senior level: **the longer the method, the higher the ratio of bugs found per LOC**. Long methods hide bugs in their middle.

---

## 5. Method ordering and naming as documentation

The class body is read top to bottom. Order says something:

```java
public class Order {
    // 1. fields
    private final OrderId id;
    private OrderStatus status;
    private final List<OrderLine> lines = new ArrayList<>();

    // 2. constructor(s)
    public Order(OrderId id) { this.id = id; this.status = OrderStatus.DRAFT; }

    // 3. queries (no side effects)
    public OrderStatus status()      { return status; }
    public List<OrderLine> lines()   { return Collections.unmodifiableList(lines); }
    public Money total()             { return ... }

    // 4. commands (mutate state)
    public void addLine(OrderLine l) { ... }
    public void place()              { ... }
    public void ship()               { ... }

    // 5. private helpers
    private void requireStatus(OrderStatus expected) { ... }

    // 6. equals/hashCode/toString
    @Override public boolean equals(Object o) { ... }
}
```

The *physical layout* tells the reader: data first, then construction, then queries (safe, idempotent), then commands (mutate), then internals. A reader who hasn't seen the file before can find what they need by guessing the section.

This is not just style. It's an architectural signal that you understand the difference between query and command, between contract and implementation.

---

## 6. Designing for evolution: add, don't change

Once a method is public, the most painful change is to its signature. To soften this:

**(a)** **Take a parameter object** — adding a field to it doesn't break anyone:

```java
// before: hard to extend
public PaymentResult pay(long cents, String currency, String method);

// after: extensible
public record PaymentRequest(Money amount, PaymentMethod method, String idempotencyKey) {}
public PaymentResult pay(PaymentRequest req);
```

**(b)** **Return a result object** — you can add new fields to the response without changing the call site:

```java
public record PaymentResult(TransactionId id, PaymentStatus status, Optional<Receipt> receipt) {}
```

**(c)** **Use named factory methods** instead of new constructor overloads — they're easier to deprecate:

```java
HttpRequest.newBuilder()...  // method factory, can grow
```

**(d)** **Default methods for interface evolution** — adding a default method on an interface doesn't break implementers (Java 8+).

Architecture's job is to make tomorrow's change a single-call addition, not a multi-file refactor.

---

## 7. Behavior over data

A common refactoring in mature codebases: **move logic onto the type that owns the data**.

```java
// procedural: BookingService computes everything from raw fields
public class BookingService {
    public long nightCountFor(Booking b) {
        return ChronoUnit.DAYS.between(b.checkIn(), b.checkOut());
    }
    public Money priceFor(Booking b) {
        return b.room().nightlyRate().times(nightCountFor(b));
    }
}

// behavioral: Booking knows what a booking *is*
public final class Booking {
    public long nights()   { return ChronoUnit.DAYS.between(checkIn, checkOut); }
    public Money price()   { return room.nightlyRate().times(nights()); }
}
```

When behavior travels with data, *every* caller writes shorter code, and the rules ("a price is the rate times the number of nights") only exist in one place. The opposite — *anemic* domain models, where classes are just bags of getters and a service does all the thinking — is the most common architectural failure mode in Java apps.

When *not* to move behavior onto the type:

- Cross-aggregate orchestration (composing multiple bookings, talking to a payment processor) — that's a service.
- Side effects (sending email, writing to DB) — keep those out of domain types.

The rule: **state and the rules that govern it belong in one class; orchestration and integration belong in another.**

---

## 8. Mutability: pick a shape, not a mix

Three coherent shapes for any class:

**(a) Fully immutable.** All fields `final`. Any "modification" returns a new instance. Records are the canonical form.

**(b) Mutable with a controlled lifecycle.** Constructor sets the identity; specific commands transition state through documented phases. Often an aggregate root with an internal state machine.

**(c) Builder + immutable result.** A throwaway mutable builder constructs the immutable target. Useful for objects too complex for a single constructor call.

**Anti-pattern:** halfway mutable. A class with seven `final` fields and three setters. The reader has no idea which fields can change after construction. Pick one shape and commit.

---

## 9. Methods are where threading happens

Concurrency lives at the method boundary:

- A class is *immutable* → every method is thread-safe by construction.
- A class is *confined* → all methods assume single-thread access; every public method documents this.
- A class is *thread-safe via internal sync* → every public method is atomic with respect to the others; document the lock or guarantee.

Mixing these — half the methods are atomic, half assume single-thread — guarantees a race condition. The architecture decision lives at the class level; the methods follow.

A subtle but common mistake: assuming `synchronized` on individual setters makes the whole class thread-safe. It makes each call atomic, but compound operations (read-then-write) still race:

```java
synchronized public int  get()       { return x; }
synchronized public void set(int v)  { x = v; }

// caller race:
if (counter.get() < 100) counter.set(counter.get() + 1);   // ❌ check-then-act
```

Either expose only the atomic compound operation (`incrementIfBelow(int)`) or the caller must lock — but then your `synchronized` on individual methods is just lock-on-lock cost.

---

## 10. The "tell, don't ask" principle

A public method should let callers *tell the object what to do*, not *ask for its data and decide for them*.

```java
// asking
if (account.getBalance() >= amount) {
    account.setBalance(account.getBalance() - amount);
}

// telling
account.withdraw(amount);
```

Why it matters:

- Atomicity: `withdraw` can be `synchronized`/transactional; the asking version cannot.
- Maintainability: when withdraw rules change, only `Account` changes.
- Semantics: the call site reads as the business operation, not as plumbing.

There are exceptions — pure data structures (`List`, `Map`, `Tree`) are fine to "ask." But for domain objects, *tell don't ask* is the architectural default.

---

## 11. Designing for performance — without micro-optimizing

A few class/method-level decisions that have outsize performance impact:

- **Avoid boxing in hot fields.** `int` not `Integer` when null is meaningless.
- **Use the most specific collection.** `EnumMap` for enum keys, `IntStream` for primitive ranges, `LinkedHashSet` only when insertion order matters.
- **Don't store both a value and its derived form.** Compute the derived form at use.
- **Memoize lazily and unconditionally; don't cache eagerly.** Most cached values aren't needed.
- **Mark methods `final`** when they're hot and not designed for override — easier inlining.
- **Don't synchronize public collections externally** if a `ConcurrentXxx` exists for your access pattern.

These aren't tricks. They're consequences of treating attributes and methods as a *cost* — every one is paid every time, by every caller, on every call.

---

## 12. Refactoring playbook

Common moves at the method level:

| Smell                                          | Refactoring                              |
|------------------------------------------------|------------------------------------------|
| Method does X *and then* Y                      | **Extract method**                       |
| Method's parameter list keeps growing          | **Introduce parameter object**           |
| Same calculation in two places                 | **Extract method** + move to owning type |
| Method uses another class's data more than its own | **Move method**                       |
| Boolean parameter changes mode                 | **Replace parameter with method** (split into two) |
| Method has many short variants (`createA`, `createB`) | **Replace with factory + enum**     |
| Long if/else on a `String` or `int` field      | **Replace conditional with polymorphism** or sealed switch |
| Method returning `null` vs. throwing inconsistently | **Replace with Optional / explicit exception** |

These are the *daily* refactorings. They don't appear in PRs as "refactor" — they're the work of keeping a class clean while you add a feature.

---

## 13. The architectural readme for a public class

When you write a public class meant for others, the implicit contract you commit to:

1. **What's the class's job?** One sentence.
2. **What invariants does it own?** What can never be true after construction.
3. **Is it mutable?** If yes, what's the lifecycle? If no, how do you "modify" it?
4. **Is it thread-safe?** What's the policy?
5. **Equality semantics?** Reference, identity-based, or field-based?
6. **What are the costs?** Heavy fields? Allocation per call? I/O per method?

If a maintainer can answer all six from reading the class once, the design is solid. If they have to dig, the design is leaking.

---

## 14. Senior-level checklist

For each public attribute or method, ask:

1. **Necessary?** Could the API work without it?
2. **Honest?** Does the name match exactly what it does?
3. **Total?** Defined for every input it might receive?
4. **Stable?** Could you commit to this signature for years?
5. **Pure-ish?** If side-effecting, is the side effect named and scoped?
6. **Defensive?** Inputs validated; outputs immutable or copied?
7. **Substitutable?** Could a subclass override it without breaking callers? Or is it `final`?
8. **Testable?** Could you test it without faking the universe?
9. **Documented?** Nullability, exceptions, threading?
10. **Cheap?** Or expensive in a documented way?

Senior class design is fluent, almost dull. The class reads like a list of capabilities a domain expert would describe; the methods are short and verb-shaped; the fields are minimal; the surface is small. The interesting work is what's *not* there — the fields you didn't add, the methods you kept private, the modes you merged into one capability.
