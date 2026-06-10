# Self-Encapsulation — Interview Questions

> **Category:** [Object & State Patterns](../README.md) — accessing your own fields through accessors so representation can change behind one method.

---

## Junior Questions (10)

### J1. What is self-encapsulation?

**Answer:** A class accesses its **own** instance fields through accessor methods (getters/setters) rather than touching the raw fields directly — even from inside its other methods.

### J2. How does it differ from plain encapsulation?

**Answer:** Plain encapsulation hides fields from *outsiders*. Self-encapsulation routes the *class's own internal code* through accessors too. The field can even stay `private`; the point is internal routing, not visibility.

### J3. Why would you do this?

**Answer:** So the field's representation can change — become computed, lazy, or validated, or be overridden by a subclass — by editing one accessor instead of every internal call site.

### J4. Give a concrete payoff.

**Answer:** A stored `total` field becomes a computed sum of line items. If every method read `getTotal()`, only `getTotal()` changes; nothing else moves.

### J5. Who named the pattern?

**Answer:** Kent Beck coined it (*Smalltalk Best Practice Patterns*); Martin Fowler catalogued the "Self-Encapsulate Field" refactoring.

### J6. Is self-encapsulation free in Python?

**Answer:** Effectively yes. You start with a plain `self.x` attribute and later convert it to a `@property` with zero caller changes. So you don't write getters up front.

### J7. Does Go have a getter convention?

**Answer:** No. Go does not use `GetX` naming. You add accessor methods deliberately — when there's an invariant or interface contract — not reflexively.

### J8. What's the Uniform Access Principle?

**Answer:** Bertrand Meyer's rule that a caller shouldn't be able to tell whether a value is a stored field or a computed method. Self-encapsulation keeps that option open.

### J9. Where do you enforce an invariant under self-encapsulation?

**Answer:** In the setter. It becomes the single door through which all writes pass, so the invariant is enforced in one place.

### J10. When is it not worth it?

**Answer:** For pure data holders / DTOs whose fields will never become computed, validated, or overridden — the accessor is just noise.

---

## Middle Questions (10)

### M1. Walk me through the "Self-Encapsulate Field" refactoring.

**Answer:** (1) Add a getter and setter. (2) Find every internal raw-field reference. (3) Replace reads with the getter, writes with the setter, testing between. (4) Make the field private. (5) Now change the accessor (compute / lazy / validate).

### M2. How does self-encapsulation enable lazy initialization?

**Answer:** Because internal callers already go through `getValue()`, you can put "if null, create it" inside that one method. Callers written against a stored field keep working unchanged. See [Lazy Initialization](../02-lazy-initialization/junior.md).

### M3. Why is eager getter/setter writing an anti-idiom in Python?

**Answer:** `@property` makes the upgrade from attribute to accessor free and caller-transparent. Writing `get_x()`/`set_x()` up front adds ceremony Python never needs.

### M4. How does it support subclass overriding?

**Answer:** If the base class's methods call `getRate()` instead of reading `rate`, a subclass overrides `getRate()` and all that internal code transparently uses the new value.

### M5. What's the relationship to Tell-Don't-Ask?

**Answer:** Self-encapsulation governs *internal* access; Tell-Don't-Ask governs *what you expose*. They're complementary — you may self-encapsulate `rate` internally while exposing `interest(balance)` rather than `getRate()`.

### M6. Should you construct through setters?

**Answer:** Usually yes — it enforces invariants from creation. **But** beware calling an *overridable* setter from a constructor in Java/C#: the override runs before the subclass is initialized.

### M7. Is a `private` getter still self-encapsulation?

**Answer:** Yes. The defining trait is internal access through a method, regardless of the method's visibility.

### M8. When would you deliberately bypass self-encapsulation?

**Answer:** In a constructor, to avoid invoking an overridable accessor during construction — you set the raw field directly there.

### M9. How does Go decide field vs accessor?

**Answer:** Expose the field directly unless there's a reason — an invariant to guard, a future computed value, or an interface that requires a method. There's no Uniform Access in Go, so the choice is part of the API contract.

### M10. What smell does over-applying self-encapsulation create?

**Answer:** A bag of getters/setters with no real behavior — an [Anemic Domain Model](../../anti-patterns/02-design/01-oo-misuse/junior.md). Self-encapsulation is plumbing, not a substitute for behavior on the object.

---

## Senior Questions (10)

### S1. Explain self-encapsulation as a "seam."

**Answer:** A seam is a place to change behavior without editing callers. Routing internal reads through `getX()` manufactures a seam at the field level: you can later swap stored → computed → lazy → overridden behind it, and you can inject test doubles by overriding the accessor.

### S2. Detail the constructor hazard.

**Answer:** In Java/C#, a constructor that calls an overridable setter dispatches to the subclass override, which runs *before* the subclass's fields are initialized — it sees uninitialized state, and the subclass's later field init can clobber the override's work. Fix: set the raw field, or make the accessor `final`/`private`.

### S3. How does language affect whether you can defer self-encapsulation?

**Answer:** In Python/Ruby/Scala the field→method swap is source-transparent (UAP), so you defer safely. In Java a `public` field→method swap is an ABI break, so you self-encapsulate public API early. In Go field-vs-method is a hard contract decision with no UAP.

### S4. What does self-encapsulation do to thread-safety?

**Answer:** A read-only getter is trivially safe. The moment you exploit the seam for lazy-init or caching, the getter *writes*, introducing a race. Self-encapsulation doesn't make it safe — it gives you one place to add the lock (`synchronized`, double-checked `volatile`, `sync.Once`, `threading.Lock`).

### S5. Relate it to the Template Method pattern.

**Answer:** Template Method exposes overridable *behavior* steps; self-encapsulation exposes overridable *state* via accessors. A base algorithm reading `getCapacity()` lets subclasses substitute state, which is strictly more flexible than a `final` field.

### S6. When is the accessor NOT free at runtime?

**Answer:** When the call site is megamorphic (≥3 overriding subclasses observed) the JIT can't inline it and emits a vtable dispatch. In Go, an accessor reached through an interface can't be inlined. In Python, a `@property` is always a descriptor call, ~5× a bare attribute read.

### S7. How do you signal that a self-encapsulated getter is expensive?

**Answer:** Name it for the cost — `loadReport()`, `computeTotal()` — rather than `getReport()`. A getter that reads like a field but does I/O is a trap for callers who loop over it.

### S8. What's the danger of an overridable accessor's contract?

**Answer:** The base class may assume the accessor is cheap, pure, or stable and cache values derived from it. A subclass override that's expensive or non-deterministic breaks those assumptions. Document overridable-accessor contracts as strictly as abstract methods.

### S9. How does `cached_property` relate to self-encapsulation?

**Answer:** It's the Python expression of "lazy self-encapsulated field": first access computes and *stores* the value as a real attribute, so subsequent reads are bare-attribute speed. The seam (the property) disappears after first use.

### S10. Can equals/hashCode break self-encapsulation consistency?

**Answer:** Yes. If `equals`/`hashCode` read the raw field while other methods read a computed accessor, they can disagree about the object's identity. Keep both on the same side of the seam.

---

## Trick Questions (5)

### T1. Is self-encapsulation the same as making a field public?

**No.** It's about *internal* access through a method; the field (and the accessor) can be `private`.

### T2. Does self-encapsulation make a lazy field thread-safe?

**No.** It centralizes *where* you add synchronization; the laziness still races until you add a lock or `sync.Once`.

### T3. In Python, should you add getters to be "properly encapsulated"?

**No.** Plain attributes are correct; `@property` is added only when you actually need validation, computation, or laziness. Up-front getters are an anti-idiom.

### T4. Is calling a setter from a constructor always safe?

**No.** If the setter is overridable (Java/C#), the override runs during base construction before the subclass is initialized — a real bug.

### T5. Is the extra method call a performance concern?

**Almost never.** Monomorphic accessors are inlined to a raw field load by the JVM/Go compiler. The exceptions are megamorphic sites, interface calls in Go, and Python properties.

---

## Behavioral Questions (5)

### B1. Tell me about a time self-encapsulation saved a refactor.

**Sample:** "Our `Invoice.total` started as a stored column. When we added line-item editing, it had to become a live sum. Because every method read `getTotal()`, the change was one method body — and a cache behind it later, also one method."

### B2. When did self-encapsulation add noise?

**Sample:** "A new hire ported Java habits into our Python service — getters and setters on every dataclass field. We deleted them; plain attributes plus one `@property` where validation actually existed read far cleaner."

### B3. Describe a bug from misusing it.

**Sample:** "A base constructor called `setLevel()`, a subclass overrode it to also update a derived counter, and the counter was wiped by the subclass field initializer. We moved to setting the raw field in the constructor."

### B4. How do you decide whether to self-encapsulate a new field?

**Sample:** "I bet on change. If the field is likely to become derived, lazy, validated, or overridable, I route through an accessor now. If it's stable value-object data, I leave it raw — in Python especially, I know I can upgrade later for free."

### B5. How do you review for it?

**Sample:** "I flag two opposite smells: a Java class with overridable behavior reading raw fields (a missing seam), and reflexive getters in Python/Go (noise). And I check that a self-encapsulated getter doing I/O is *named* for its cost."

---

## Tips for Answering

1. **Lead with the seam idea:** one accessor = one place to change representation.
2. **Name the enabler relationship:** it's what makes lazy-init and memoization caller-free.
3. **Know the language split:** free in Python (`@property`), deliberate in Go, ABI-driven in Java.
4. **Cite the constructor hazard** — it's the senior differentiator.
5. **Acknowledge cost honestly:** boilerplate, surprising side effects, megamorphic/interface/property overhead.

---

[← Professional](professional.md) · [Object & State](../README.md) · **Next:** [Tasks](tasks.md)
