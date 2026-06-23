# Organizing Data — Interview Q&A

> 50+ questions covering the 15 techniques.

---

## Conceptual (Q1–Q15)

**Q1.** What is the "Organizing Data" category about?
A. Reshape how state is represented — encapsulation, type promotion, identity, and shape changes.

**Q2.** What's Self Encapsulate Field?
A. Use accessors (getters/setters) even from inside the same class, to prepare for subclass overrides or future shape changes.

**Q3.** What's Replace Data Value with Object?
A. Promote a primitive (`String`, `int`) to a proper class so it can carry behavior and invariants.

**Q4.** What's the difference between Change Value to Reference and Change Reference to Value?
A. Value to Reference makes one shared instance per identity (entity). Reference to Value makes equality content-based, eliminating shared identity.

**Q5.** What's Replace Array with Object?
A. Replace an index-positional array (where each slot has a different meaning) with a class with named fields.

**Q6.** What's Encapsulate Field?
A. Make a field private, expose accessors. The basic OO encapsulation step.

**Q7.** What's Encapsulate Collection?
A. Don't expose a mutable collection externally — return immutable views or copies, and provide controlled add/remove methods.

**Q8.** What's a Type Code?
A. An integer constant standing in for a kind ("status = 1 for active, 2 for inactive"). Almost always a smell.

**Q9.** What are the three Replace Type Code variants?
A. Replace Type Code with **Class** (just want type safety), with **Subclasses** (behavior differs by code), with **State/Strategy** (type changes at runtime).

**Q10.** What's Replace Subclass with Fields?
A. Collapse subclasses that differ only by data (no behavior overrides) into a single class with fields.

**Q11.** What's Replace Magic Number with Symbolic Constant?
A. Give a literal a name. `1.785` → `GST_RATE`.

**Q12.** What's Change Unidirectional to Bidirectional Association?
A. Add a back-pointer. `Order.customer` → also `Customer.orders`.

**Q13.** What's Duplicate Observed Data?
A. Move (or copy) domain data out of UI widgets into the domain model.

**Q14.** What's the unidirectional inverse of bidirectional?
A. Change Bidirectional to Unidirectional Association — drop the unneeded back-pointer.

**Q15.** What is Self Encapsulate Field a precondition for?
A. Many other refactorings — Replace Data Value with Object, Replace Type Code, Move Field, etc.

---

## When to apply (Q16–Q30)

**Q16.** When does Replace Data Value with Object pay off?
A. When the primitive carries semantic meaning (Email, Money) — you want type safety and behavior on it.

**Q17.** When is Inline Class (the inverse) the right move on a value object?
A. When the wrapper class adds nothing — no validation, no behavior beyond getter/setter.

**Q18.** When do you choose enum vs. subclass?
A. Enum for closed sets with simple data; subclass for richer behavior. Enum with abstract methods covers many "subclass-like" cases.

**Q19.** When do you choose State/Strategy over Subclasses?
A. When the type can change during the object's lifetime (Order: DRAFT → SHIPPED).

**Q20.** When is Replace Subclass with Fields a trap?
A. When the subclasses encode planned behavioral differences that haven't materialized yet — collapsing now means rebuilding later.

**Q21.** When should a magic number become configuration instead of a constant?
A. When ops needs to tune it per environment without redeploying.

**Q22.** When does bidirectional association pay off?
A. When traversal both ways is frequent and the alternative (a query) is expensive.

**Q23.** When should you drop bidirectional?
A. When one direction is rarely used or causes serialization / ORM headaches.

**Q24.** When does Encapsulate Collection matter most?
A. When the class enforces invariants on the collection (no duplicates, max size, sorted order).

**Q25.** When is exposing a mutable collection acceptable?
A. Almost never in a public API. Acceptable only as a deliberate, documented, package-private hand-off.

**Q26.** When does Change Value to Reference apply?
A. When two instances representing the "same logical thing" are diverging in state (loyalty points, etc.).

**Q27.** When is Change Reference to Value the right move?
A. For small immutable concepts (Money, Color, ZIP code) where identity carries no meaning.

**Q28.** When can a String stay a String (not be promoted to Object)?
A. When it's purely a label with no invariants — log messages, display strings, debug output.

**Q29.** Why is Replace Type Code with Subclasses also a Switch Statements cure?
A. Polymorphism replaces the switch — each subclass implements its own variant.

**Q30.** When should you keep `getXxx()/setXxx()` instead of using records / properties?
A. When you have additional logic in accessors (validation, lazy init, derived values), or when stuck on older language versions.

---

## Code-smell mapping (Q31–Q40)

**Q31.** Which technique cures Primitive Obsession?
A. Replace Data Value with Object, Replace Type Code with Class, Replace Array with Object.

**Q32.** Which technique cures Switch Statements (driven by type code)?
A. Replace Type Code with Subclasses, Replace Type Code with State/Strategy.

**Q33.** Which technique cures Inappropriate Intimacy?
A. Encapsulate Field, Encapsulate Collection, Change Bidirectional to Unidirectional Association.

**Q34.** Which technique cures Lazy Class?
A. Replace Subclass with Fields (when the lazy class is a near-identical subclass).

**Q35.** Which technique addresses Magic Numbers?
A. Replace Magic Number with Symbolic Constant (or move to configuration).

**Q36.** Why is Encapsulate Field NOT optional in modern code?
A. It's required for any meaningful evolution: validation, lazy init, subclass override, observability.

**Q37.** Which Organizing Data technique often follows Extract Class?
A. Encapsulate Field on the new class's fields (then Move Field to populate).

**Q38.** What's a typical sequence to fix a Type Code?
A. Self Encapsulate Field → Replace Type Code with Class → if behavior differs, evolve to Subclasses → if state changes, evolve to State/Strategy.

**Q39.** Which technique helps with the "Data Class" smell?
A. Move Method (from Moving Features) — give the data class behavior. Replace Data Value with Object also helps when the data class is just a primitive holder.

**Q40.** How does Replace Magic Number relate to the Comments smell?
A. Naming a constant often replaces a comment ("// 0.65 is the conversion factor" → `CONVERSION_FACTOR = 0.65`).

---

## Architecture & data shape (Q41–Q50)

**Q41.** Why does data shape determine architecture?
A. The shape determines what operations are easy and hard. Bad shape locks in bad code patterns.

**Q42.** Compare UUID v4 and UUID v7.
A. v4 is fully random — terrible for B-tree insert locality. v7 is timestamp-prefixed — sortable, retains distribution.

**Q43.** What's the expand-contract migration pattern?
A. Add new shape alongside old; dual-write; backfill; switch reads; deprecate old.

**Q44.** When does a closed set deserve an enum vs. a database table?
A. Enum if values rarely change (status types, blood groups). Table if ops needs to add new values without redeploy.

**Q45.** Why should DTOs differ from domain objects?
A. They serve different audiences: domain objects encapsulate logic, DTOs serialize for transport. Coupling them leaks internal state.

**Q46.** What's the "type-driven design" approach to validation?
A. Encode invariants in types (`Email`, `NonEmpty<String>`) so invalid states are unrepresentable.

**Q47.** What's the cost of Encapsulate Collection on a hot path?
A. Each call allocates a new collection (or wrapper). View-based encapsulation (`unmodifiableList`) avoids the copy.

**Q48.** How does Project Valhalla change Replace Data Value with Object?
A. Future Java value classes will let you wrap primitives without paying allocation overhead — making the refactor essentially free.

**Q49.** Why is `__slots__` important when applying Replace Data Value with Object in Python?
A. Without `__slots__`, every instance has its own dict — significant memory at scale.

**Q50.** What's the "type code zombie"?
A. Code uses an enum but the database column is still INT — two systems of record. Migrate the schema or write a strict converter.

---

## Bonus (Q51–Q60)

**Q51.** What's a Brand type in TypeScript?
A. A nominal-style wrapper using a unique symbol so the compiler distinguishes `Email` from plain `string` without runtime cost.

**Q52.** What's a "newtype" in Rust?
A. A tuple struct with one field, often used to add type safety without runtime overhead.

**Q53.** What's a Java record?
A. An immutable data carrier with auto-generated equals/hashCode/toString. Modern replacement for many "Replace Data Value with Object" cases.

**Q54.** Why does ORM make bidirectional associations tricky?
A. The owning side must be declared explicitly; both sides must be kept consistent in setters; lazy loading and serialization can cycle.

**Q55.** What's the difference between an entity and a value object in DDD?
A. Entity: identity (id), mutable state. Value object: equality by content, immutable.

**Q56.** Why is Encapsulate Field "free" at runtime in modern JVMs?
A. JIT inlines the trivial accessor; resulting machine code is identical to direct field access.

**Q57.** When is Defensive Copy in Encapsulate Collection too expensive?
A. Hot paths with thousands of calls per request. Use unmodifiable views or streams instead.

**Q58.** What's `Collections.unmodifiableList(list)` vs. `List.copyOf(list)`?
A. `unmodifiableList` is a view — sharing storage, no copy, but mutation through the view is blocked. `List.copyOf` makes a true immutable copy.

**Q59.** When does a "registry singleton" implementation of Change Value to Reference become a problem?
A. In tests (state pollution between tests), in concurrency (race on init), in long-lived processes (memory leak as registry grows).

**Q60.** What's the difference between an enum and a constant class in Java?
A. Enum has static type-checked constants, exhaustive switch, ordinal/values methods. Constant class is just `public static final` fields — no type safety.

---

## Next

- Practice: [tasks.md](tasks.md), [find-bug.md](find-bug.md), [optimize.md](optimize.md)
- Recap: [junior.md](junior.md) → [middle.md](middle.md) → [senior.md](senior.md) → [professional.md](professional.md)
