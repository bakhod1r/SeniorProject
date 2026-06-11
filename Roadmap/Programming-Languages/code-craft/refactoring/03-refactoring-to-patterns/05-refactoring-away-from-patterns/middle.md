# Refactoring Away From Patterns — Middle Level

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); Sandi Metz, "The Wrong Abstraction" (2016).

[Junior](junior.md) covered the three removals you'll do most: Inline Singleton, collapse a one-product Factory, and inline a single-implementation Strategy. This level adds three harder removals — flattening a Decorator chain, collapsing a one-implementation interface, and inlining a needless Observer — and then arms you with the two tools that make any removal safe and defensible: the **Rule of Three** as a decision procedure, and **characterization tests** as a safety net. We finish with a concrete **cost model of indirection** so "this is over-engineered" stops being a vibe and becomes an argument.

## Removal 4 — Collapse a one-deep Decorator chain

> Cross-reference: [Decorator pattern](../../../design-patterns/02-structural/04-decorator/junior.md).

### Starting situation

The [Decorator pattern](../../../design-patterns/02-structural/04-decorator/junior.md) lets you stack optional behaviors around a core object at runtime. Its power is *combinatorial*: with N independent decorators you get 2^N combinations without 2^N classes. The smell is a decorator infrastructure wrapping exactly one embellishment that is *always* applied.

```java
public interface PriceSource { BigDecimal price(String sku); }

public class BasePriceSource implements PriceSource {
    public BigDecimal price(String sku) { return lookup(sku); }
}

// The one and only decorator, applied unconditionally everywhere:
public class RoundingPriceSource implements PriceSource {
    private final PriceSource delegate;
    public RoundingPriceSource(PriceSource delegate) { this.delegate = delegate; }
    public BigDecimal price(String sku) {
        return delegate.price(sku).setScale(2, RoundingMode.HALF_UP);
    }
}

// Construction, identical at every call site:
PriceSource prices = new RoundingPriceSource(new BasePriceSource());
```

### Motivation

There is exactly one decorator and it is *never optional* — every construction wraps `BasePriceSource` in `RoundingPriceSource`. So there is no combination to vary; the "round the price" behavior is simply part of what pricing means in this system. The Decorator gives you a `PriceSource` interface, two classes, and a wrapping ritual at every call site, in exchange for flexibility nobody uses. Folding the rounding into the base collapses three types to one.

### Mechanical steps

1. **Confirm the decorator is always applied and there are no other decorators.** Grep construction sites: every `PriceSource` must be built as `new RoundingPriceSource(new BasePriceSource())`. If any site skips the rounding, the optionality is real — stop.
2. **Move the decorator's added behavior into the core class.** Copy the `setScale(...)` step into `BasePriceSource.price`.
3. **Replace every `new RoundingPriceSource(new BasePriceSource())` with `new BasePriceSource()`.** Run tests after each.
4. **Delete `RoundingPriceSource`.**
5. **If `PriceSource` now has one implementor and no caller needs the seam, collapse the interface too** (next removal). Otherwise keep it.

### After

```java
public class BasePriceSource implements PriceSource {
    public BigDecimal price(String sku) {
        return lookup(sku).setScale(2, RoundingMode.HALF_UP);
    }
}

PriceSource prices = new BasePriceSource();
```

### When the Decorator WAS justified — keep it

Keep it the moment embellishments become *independently optional and composable*: rounding **or** currency conversion **or** a logging wrapper **or** a caching wrapper, chosen per context. As soon as some call sites want rounding-without-caching and others want caching-without-rounding, the combinatorial argument returns and the Decorator is the right tool — re-introduce it via [Refactoring to Structural patterns](../03-structural/junior.md). The smell is strictly the **single, always-on** decorator.

## Removal 5 — Collapse a one-implementation interface

### Starting situation

```java
public interface UserRepository {
    User findById(long id);
    void save(User user);
}

public class JdbcUserRepository implements UserRepository {
    public User findById(long id) { /* ... */ }
    public void save(User user)  { /* ... */ }
}
```

One interface, one implementor, no second implementor in production *or* in tests (tests use a real database, or there are no tests). This is textbook **speculative generality** — see the [Dispensables / Speculative Generality smell](../../01-code-smells/04-dispensables/junior.md).

### Motivation

The "always code to an interface" advice is widely overapplied. An interface earns its keep when it has (or imminently will have) more than one implementor, or when it's the seam a test double plugs into. A `UserRepository` with one JDBC implementor and no test fake is two files where one would do, plus an indirection every reader must resolve. Collapsing it removes a type and an "go-to-implementation" hop.

### Mechanical steps

1. **Verify there is exactly one implementor everywhere** — production *and* test code. The most common reason to *keep* this interface is a test that swaps in an in-memory fake; check for that first.
2. **Rename the concrete class to the interface's intended name** if the interface had the "nice" name (`JdbcUserRepository` → `UserRepository`). Use the IDE's safe rename.
3. **Make call sites depend on the concrete type.** Change field and parameter types from the interface to the class. The IDE's "inline interface" or find-and-replace handles this.
4. **Delete the now-empty interface.** Run tests.

### After

```java
public class UserRepository {           // was the interface name; now the only type
    public User findById(long id) { /* ... */ }
    public void save(User user)  { /* ... */ }
}
```

### When the one-implementation interface WAS justified — keep it

Three legitimate reasons to keep an interface with one production implementor:

- **A test fake plugs into it.** A second "implementor" exists — your `InMemoryUserRepository` for fast tests. The seam earns its keep. (Though consider whether you truly need it; sometimes a real in-memory DB or testcontainer is simpler than maintaining a fake.)
- **It crosses an architectural boundary.** In Ports-and-Adapters / Hexagonal architecture, the interface is a *port* the domain owns so it doesn't depend on infrastructure. The single implementor is the adapter. Here the interface encodes a dependency-direction rule, which is a real benefit even with one adapter.
- **It's a published API / plugin point** other teams or packages implement, even if your repo ships one implementor.

If none of these hold, the interface is speculation — collapse it.

## Removal 6 — Inline a needless Observer

> Cross-reference: [Observer pattern](../../../design-patterns/03-behavioral/06-observer/junior.md).

### Starting situation

The [Observer pattern](../../../design-patterns/03-behavioral/06-observer/junior.md) decouples a subject from its listeners: the subject fires events, and zero-to-many observers, registered at runtime, react. The smell is the full registration/notification apparatus serving exactly **one** listener that is **always** present and reacts **synchronously**.

```java
public interface OrderListener { void onPlaced(Order order); }

public class OrderService {
    private final List<OrderListener> listeners = new ArrayList<>();
    public void addListener(OrderListener l) { listeners.add(l); }

    public void place(Order order) {
        repository.save(order);
        for (OrderListener l : listeners) l.onPlaced(order);   // exactly one, always
    }
}

public class EmailReceiptListener implements OrderListener {
    public void onPlaced(Order order) { mailer.sendReceipt(order); }
}

// Wiring, done once, in exactly one way:
service.addListener(new EmailReceiptListener());
```

### Motivation

Observer pays for itself when the *set* of listeners varies — multiple, optional, registered/unregistered at runtime, or decoupled across module boundaries. Here there's one listener, always registered, called synchronously in line. The list, the interface, the `addListener` ritual, and the registration step all exist to support a fan-out of one. Worse, the indirection *hides control flow*: reading `place()`, you can't see that an email gets sent — you have to find the registration to know what's in the list. Inlining makes the side effect visible.

### Mechanical steps

1. **Confirm there is exactly one listener type, always registered, invoked synchronously, and order/multiplicity never matters.** If listeners are registered conditionally or there are several, stop — the decoupling is real.
2. **Give `OrderService` a direct reference to the collaborator** the listener wrapped (here, the `Mailer`), injected via the constructor.
3. **Replace the notification loop with a direct call** to the collaborator's method.
4. **Delete `addListener`, the `listeners` list, the `OrderListener` interface, and `EmailReceiptListener`.** Run tests after each deletion.

### After

```java
public class OrderService {
    private final Mailer mailer;
    public OrderService(Repository repo, Mailer mailer) { /* ... */ this.mailer = mailer; }

    public void place(Order order) {
        repository.save(order);
        mailer.sendReceipt(order);          // the side effect is now visible
    }
}
```

### When the Observer WAS justified — keep it

Keep it when *any* of these hold: multiple listeners react to the same event; listeners are optional or registered at runtime; the reaction should be asynchronous (queued, off the request thread); or the subject must not know its listeners (true decoupling across a module boundary, e.g., a domain firing events an infrastructure layer subscribes to). The smell is specifically **one synchronous always-present listener** — at that point Observer is just an obfuscated method call. Re-introduce it via [Refactoring to Behavioral patterns](../04-behavioral/junior.md) when the second listener appears.

## The Rule of Three as a decision procedure

The Rule of Three (Fowler, *Refactoring*) is the antidote to both premature abstraction *and* premature removal:

1. **First time** you write something, just write it. One implementation is a method, not a pattern.
2. **Second time** you need something similar, note the duplication but *resist abstracting* — two points don't reliably tell you the shape of the abstraction. As Metz puts it, prefer the duplication for now.
3. **Third time**, you have enough real examples to see what genuinely varies versus what's incidental. *Now* introduce the abstraction (Strategy, Factory, Template Method), shaped by three concrete cases instead of one imagined one.

For *removal*, run the rule backward: if a pattern's seam has dropped from three real cases to one (two strategies got deleted, leaving one), the abstraction has lost its justification. The pattern that was right at three cases is over-engineering at one. Designs are not permanent; the right structure changes as the count of real variations changes.

## Characterization tests before removing

You usually inherit over-engineered code *without* tests (or with tests so coupled to the pattern that they fight the removal). Before you collapse anything, pin the current behavior with **characterization tests** — Michael Feathers' term for tests that document *what the code does now*, regardless of whether that's correct.

The technique:

1. **Write an assertion you know is wrong**, e.g. `assertEquals(0, cart.total())`.
2. **Run it.** The failure message tells you the real value: `expected 0 but was 4500`.
3. **Replace the wrong expectation with the observed value:** `assertEquals(4500, cart.total())`. The test now *characterizes* the behavior.
4. **Repeat for the important input ranges and edge cases** the pattern touches (the rounding boundary, the discount applied/not-applied, the listener's side effect).

Now you can inline the Singleton, collapse the Decorator, or remove the Observer, and the suite will scream if any observable behavior changed. The test doesn't care that you deleted three classes — it cares that `total()` still returns 4500. After the removal succeeds, you can *promote* the characterization tests into proper unit tests (they're often clearer to write once the indirection is gone).

A subtlety: tests that mock the *pattern's own seam* (`mock(DiscountStrategy.class)`) are not characterization tests — they test the wiring, not the behavior, and they'll break the moment you remove the seam. Characterize at the *boundary you'll keep* (the public method's result, the visible side effect), not at the seam you're about to delete.

## The cost model of indirection

To argue a pattern isn't earning its keep, name the costs it imposes. Each layer of needless indirection charges you on several axes:

- **Reading cost (the big one).** Every indirection is a hop: to understand `cart.total()` you open `DiscountStrategy`, find the one implementor, confirm there's only one, then read it. Three jumps to learn one fact. Code is read far more than written; this tax is paid on every read, forever.
- **Onboarding cost.** A new teammate must learn *your* indirections before they can change anything. A factory, a strategy interface, and an abstract base for a feature with one behavior is three concepts to absorb for zero variation. Multiply across a codebase full of pattern fever.
- **Change-amplification cost.** Add a field to the product and you touch the interface, the implementor, the factory, and possibly a base class — four edits where a direct class needs one. The pattern that was supposed to *ease* change now amplifies it (this is the [Change Preventers](../../01-code-smells/03-change-preventers/junior.md) smell wearing a pattern's clothes).
- **Test-friction cost.** Needless seams demand needless mocks; a Singleton demands static resets between tests. The scaffolding exists only to satisfy the pattern.
- **Runtime cost (usually small, sometimes not).** Each layer is an extra virtual dispatch and often an extra allocation (the wrapper, the strategy object). Negligible per call; measurable in a hot loop running millions of times. (Quantified in [professional.md](professional.md).)

The decisive question is always the same: **what change does this indirection make easier, and does that change actually happen?** If you can name the change and it's real and recurring, the costs above are rent well paid. If you can't, you're paying rent on an empty room.

## Next

- [senior.md](senior.md) — essential vs accidental complexity, the wrong-abstraction tax, sequencing a large simplification, getting a team to agree.
- [professional.md](professional.md) — measuring carrying cost, tech-debt framing, measured performance wins, risk management for widely-used seams.
- [junior.md](junior.md) — the foundational removals (Singleton, Factory, Strategy) and the "earning its keep" checklist.
- [interview.md](interview.md) · [tasks.md](tasks.md) · [find-bug.md](find-bug.md) · [optimize.md](optimize.md)
- Related: [Refactoring to Structural patterns](../03-structural/junior.md) · [Refactoring to Behavioral patterns](../04-behavioral/junior.md) · [Change Preventers smell](../../01-code-smells/03-change-preventers/junior.md)
