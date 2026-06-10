# Special Case — Interview Questions

> **Category:** [Control-Flow Patterns](../README.md) — return a dedicated object for a recurring exceptional condition instead of branching for it at every call site.

---

## Junior Questions (10)

### J1. What is the Special Case pattern?

**Answer:** A dedicated object that encapsulates the behavior for a particular recurring condition (unknown customer, missing product, guest user), so callers don't repeat `if (special) {...}` everywhere.

### J2. How is it related to Null Object?

**Answer:** Null Object is the *specific* Special Case where the condition is "the value is absent." Special Case generalizes it to any condition — unknown, pending, deleted, guest. **Null Object ⊂ Special Case.**

### J3. Give a concrete example.

**Answer:** Instead of `if (customer == null) name = "occupant"` at every call site, the repository returns an `UnknownCustomer` whose `name()` returns `"occupant"` and whose `plan()` returns the basic plan.

### J4. Who decides whether to return a real object or a special case?

**Answer:** A boundary object — usually a repository or factory — decides once. Callers receive a usable object and never branch.

### J5. Why must the special case be the same type as the normal object?

**Answer:** So it fits everywhere the normal object is expected (same interface/subclass). Callers can use it polymorphically without knowing it's special.

### J6. Should the special case be mutable or immutable?

**Answer:** Immutable. Then a single instance can be shared safely (singleton), with no allocation per use and no thread-safety concerns.

### J7. What anti-pattern does Special Case replace?

**Answer:** Sentinel values — returning `null`, `-1`, or `""` to mean a special condition, forcing every caller to remember a check.

### J8. When should you NOT use it?

**Answer:** When the condition is a real error the caller must handle (auth failure, missing config, corrupt data). Use [Fail Fast](../02-fail-fast/junior.md) instead.

### J9. How does it keep the happy path clean?

**Answer:** It moves the condition check out of every call site and into the type system, so the normal code reads top-to-bottom with no `if`.

### J10. What's a common naming mistake?

**Answer:** Naming it after the mechanism (`NullCustomer`) instead of the meaning (`UnknownCustomer`, `GuestUser`).

---

## Middle Questions (10)

### M1. When does Special Case pay off over an inline `if`?

**Answer:** When the condition recurs at many call sites *and* there's a single sensible default. One occurrence is better served by a local `if`.

### M2. Can one type have multiple special cases?

**Answer:** Yes. `UnknownCustomer`, `PendingCustomer`, `DeletedCustomer` can all implement `Customer`, each with its own behavior, behind one interface.

### M3. How do you decide Special Case vs `Optional`/Result?

**Answer:** `Optional` *forces* the caller to handle absence — use it when the caller should decide. Special Case *removes* that obligation by supplying a default — use it when a default is correct. They are duals.

### M4. How do you implement it in Go without inheritance?

**Answer:** Define an interface; the real type and each special type both implement it. The special type is just another struct, often zero-field, shared as a package-level value.

### M5. What's the refactoring that introduces it?

**Answer:** Fowler's **Introduce Special Case** (originally "Introduce Null Object"): create the subtype, move the decision into the repository, delete branches at call sites.

### M6. How do you handle writes against a special case?

**Answer:** Reads default cleanly; writes are meaningless (`unknownCustomer.changeEmail(...)`). Make them no-op or throw — deliberately and documented — never silently swallow.

### M7. What's the risk of Special Case?

**Answer:** It can silently mask a real error (e.g., a broken foreign key returning `UnknownCustomer`). The defaulting that makes it convenient is exactly what hides corruption.

### M8. How does it interact with caching?

**Answer:** Cache special-case results too, or a missing row re-queries the DB on every access. But invalidate the cached special case when the real row later appears.

### M9. Why provide an `isUnknown()` method if callers shouldn't branch?

**Answer:** A few callers legitimately must distinguish (e.g., don't email an unknown customer). Provide the query for them while the majority stay branch-free. If *most* callers use it, the pattern isn't helping.

### M10. Where in the architecture should the decision live?

**Answer:** At the lowest layer that can correctly decide the default — usually the repository or an anti-corruption layer — so every layer above receives an already-correct object.

---

## Senior Questions (10)

### S1. The same condition can be a special case in one place and an error in another. Explain.

**Answer:** "Unknown currency" is fine on a read-only dashboard (neutral formatting) but catastrophic when moving money (wrong currency = financial bug). Because the correct behavior depends on context, the decision belongs near the use, not globally.

### S2. What's your heuristic for Special Case vs Fail Fast?

**Answer:** A special case is appropriate only when *behaving as if the condition were normal* yields a correct outcome. If the safe behavior is "stop," it's an error — fail fast.

### S3. How do special cases cross serialization boundaries safely?

**Answer:** They lie if serialized naively (an `UnknownCustomer` looks like a real one named "occupant"). Either tag the type explicitly (discriminator), or — preferred — transmit the raw condition (absence/status) and let each downstream service re-hydrate its own special case.

### S4. How do sealed/closed hierarchies improve Special Case?

**Answer:** A `sealed interface` (Java 17+) gives exhaustive `switch`. Callers who don't care still default; callers who must branch get compile-time enforcement that every case is handled — adding a new special case breaks non-exhaustive switches on purpose.

### S5. How do you keep a special case from masking corruption?

**Answer:** Instrument it. Increment a metric each time the special case is returned and alert on anomalies. The app stays up; the metric reveals the broken join.

### S6. Special Case vs modeling it as entity state?

**Answer:** If the variations are lifecycle states of one entity (active → frozen → closed), a state field/state machine may model it better. Special Case shines when the "case" is about *resolution failure* (unknown, missing) rather than a legitimate lifecycle state.

### S7. How would you migrate from a sentinel-null codebase?

**Answer:** Introduce the special case, make the repository return it (never null), then delete `if (x == null)` branches incrementally, leaving `isUnknown()` only where truly needed.

### S8. When would you reverse the pattern back to `Optional`?

**Answer:** When an audit shows callers genuinely need to handle absence differently. If they keep calling `isUnknown()` to branch, the default was wrong — return `Optional` and force the decision.

### S9. How do you test the pattern thoroughly?

**Answer:** Test the special case in isolation (its defaults), test the factory returns it for the right condition, and test that representative callers behave correctly without branching. Use the special case itself as a fixture.

### S10. What's the performance story?

**Answer:** It swaps a data-dependent branch for a virtual dispatch. When misses are unpredictable, the polymorphic version avoids branch mispredictions and is often *faster*. Monomorphic sites get devirtualized/inlined. Cost is negligible; the only real cost is allocating a per-call instance instead of sharing a singleton.

---

## Trick Questions (5)

### T1. Is Special Case the same as Null Object?

**No.** Null Object is the subset where the condition is "absent." Special Case generalizes to any recurring condition.

### T2. Does Special Case improve performance or hurt it?

**Usually improves or neutral.** It replaces an unpredictable data branch with a virtual dispatch that modern CPUs/JITs handle well (or inline away).

### T3. Should you always serialize the special case object?

**No.** Across a wire, prefer transmitting the raw condition and re-hydrating downstream, or tag the type — otherwise it impersonates a real object.

### T4. Can a special case have a `save()` that writes to the DB?

**No** — that's nonsense for an unknown/missing object. Make writes no-op or throw.

### T5. Is returning `UnknownCustomer` always safer than returning `null`?

**No.** It's safer for *valid* absence. For corruption or security boundaries, silently returning a defaulted object is *more* dangerous than a loud failure.

---

## Behavioral Questions (5)

### B1. Tell me about a time Special Case cleaned up a codebase.

**Sample:** "Our invoice renderer had `if (customer == null)` in eleven templates. We introduced `UnknownCustomer` returned by the repository and deleted all eleven branches. A whole class of NPEs disappeared and new templates 'just worked.'"

### B2. When did a Special Case hide a bug?

**Sample:** "An `UnknownProduct` masked a broken catalog sync — carts silently showed items as 'unavailable' instead of alerting us. We added a metric on special-case returns and caught the next sync failure in minutes."

### B3. How do you decide between Special Case and throwing?

**Sample:** "I ask: if this code behaves as though the condition were normal, is the result still correct? Anonymous user → guest defaults, yes. Payment with no account → no, that must fail loudly."

### B4. Describe explaining this pattern to a junior.

**Sample:** "I framed it as 'a letter to the occupant' — you don't know the name, so you address it to a stand-in that behaves sensibly. Then I showed Null Object as the specific 'nobody home' version of the same idea."

### B5. A teammate wants a special case for a security check. What do you say?

**Sample:** "I'd push back. Auth isn't a defaultable condition — a `GuestUser` with empty permissions is fine for *display*, but the authorization decision must be explicit and fail closed, not silently default."

---

## Tips for Answering

1. **Lead with the problem:** duplicated `if (special)` branches and sentinel checks.
2. **State the Null Object relationship:** it's the absence subset.
3. **Always raise the Fail-Fast trade-off** — interviewers want to see you know when *not* to use it.
4. **Mention boundary/serialization concerns** for senior signal.
5. **Name cases by meaning** (`GuestUser`), not mechanism (`NullUser`).

---

[← Professional](professional.md) · [Control Flow](../README.md) · [Roadmap](../../../README.md) · **Next:** [Tasks](tasks.md)
