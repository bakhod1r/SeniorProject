# Object Identity vs Equality — Middle

> **What?** Real refactors that pull production code from `==` toward `.equals` and `Objects.equals`, plus the cases where you *want* identity comparison and how to use `IdentityHashMap` and `Collections.newSetFromMap(new IdentityHashMap<>())` to express it explicitly.
> **How?** Each section starts from a faulty class (a cache that compares strings with `==`, an order-tracker that double-counts because it uses `HashMap` for object identity, a cycle-detector that misses cycles), names the smell, and walks through the smallest change that removes it. Cross-reference [../01-equals-hashcode-tostring-contracts/](../01-equals-hashcode-tostring-contracts/) for the equality side.

---

## 1. Refactor 1 — A customer cache that compares with `==`

A caching layer in front of a customer-lookup service:

```java
public final class CustomerLookup {

    private final CustomerRepository repo;
    private final Map<String, Customer> cache = new ConcurrentHashMap<>();

    public Customer find(String email) {
        for (Map.Entry<String, Customer> e : cache.entrySet()) {
            if (e.getKey() == email) {                      // (*)
                return e.getValue();
            }
        }
        Customer c = repo.findByEmail(email);
        cache.put(email, c);
        return c;
    }
}
```

The cache passes its own unit tests — those construct the cache with hard-coded literal strings, so `==` succeeds by pool coincidence. In production, `email` comes from an HTTP request (`request.getParameter("email")`) or a database row, so it is a fresh object every time. The cache lookup at line `(*)` always misses, every call hits the database, and the cache exists only to consume memory.

**Fix.** Use `.equals()` — or, better, use the map's own lookup, which uses `hashCode` + `equals`:

```java
public Customer find(String email) {
    return cache.computeIfAbsent(email, repo::findByEmail);
}
```

`computeIfAbsent` looks up the key by `hashCode` + `.equals`, which is what you wanted all along. The hand-rolled iteration was both incorrect (used `==`) and slow (linear scan). The diff is six lines for one.

The wider lesson: the moment you reach for `==` on a `String` key, ask whether the standard library already does the lookup you are reinventing. `Map.get`, `Set.contains`, `List.indexOf`, `equals(...)` on a record — all use `.equals` and `hashCode` for you.

---

## 2. Refactor 2 — Replacing `==` with `Objects.equals` in null-prone paths

A user profile screen compares optional fields like the previous and current value of a phone number:

```java
public void onProfileEdit(UserProfile before, UserProfile after) {
    if (before.phone() != after.phone()) {       // (*) wrong
        audit.recordPhoneChanged(before.phone(), after.phone());
    }
    if (before.address() != after.address()) {   // (*) wrong
        audit.recordAddressChanged(before.address(), after.address());
    }
}
```

Two bugs at once:

- `phone()` returns `String`; `!=` is identity comparison. Two different `String` objects holding `"+1-555-0100"` will register as a change every time the user re-saves the same number.
- `phone()` might return `null` (the user has no phone). If you naively rewrite to `!before.phone().equals(after.phone())`, you get an `NPE` whenever the previous value is null.

**Fix.** `Objects.equals` is the null-safe equality, and `!Objects.equals` reads as "really changed":

```java
import static java.util.Objects.equals;

public void onProfileEdit(UserProfile before, UserProfile after) {
    if (!equals(before.phone(), after.phone())) {
        audit.recordPhoneChanged(before.phone(), after.phone());
    }
    if (!equals(before.address(), after.address())) {
        audit.recordAddressChanged(before.address(), after.address());
    }
}
```

`Objects.equals(a, b)` is `true` if both are null, `false` if exactly one is null, and otherwise delegates to `a.equals(b)`. It is the right tool for any pair of values that *might* be null but you would still call equal-if-both-null. The static import (`import static java.util.Objects.equals`) is idiomatic — a one-word call site keeps the diff small.

---

## 3. Refactor 3 — Identity vs equality in collections

You want a `Set` of all the `Document` objects you've already processed in this run. The naïve choice:

```java
private final Set<Document> processed = new HashSet<>();

public void process(Document d) {
    if (processed.contains(d)) return;
    processed.add(d);
    // do work...
}
```

This uses `Document.equals` for membership. That is right *if* you mean "I have already processed a document logically equal to this one" — for example, two `Document` objects that share the same content hash should be deduplicated.

But suppose your `Document.equals` is the default `Object.equals` (which is `==`), or your `Document` is mutable and `equals` is fragile. Or, more often, suppose you genuinely want *identity*: "I have already seen *this exact* Java object". A real use case is the JSON-serialiser side of an object graph walk — you want to skip the same object on a second visit, but two distinct objects with equal fields are still two separate visits.

**Fix.** Switch to an identity-based set:

```java
private final Set<Document> processed =
    Collections.newSetFromMap(new IdentityHashMap<>());
```

`IdentityHashMap` uses `==` for key equality and `System.identityHashCode` for hashing. Wrapping it in `Collections.newSetFromMap` gives you a `Set<Document>` that asks "have I seen *this* object?" rather than "have I seen *something equal to* this object?".

Both have legitimate uses. The pick depends on what *"same"* means in your context. Don't reach for `IdentityHashMap` reflexively to "avoid equals bugs" — that's choosing the wrong contract for the wrong reason.

---

## 4. Refactor 4 — Cycle detection in a graph walk

Serialise an arbitrary object graph (think Jackson, Gson, Kryo). Without cycle detection, an `Employee` that references their `Manager` who references the `Employee` will recurse forever. The wrong way to detect cycles:

```java
public void serialise(Object root, JsonWriter out, Set<Object> seen) {
    if (seen.contains(root)) {                    // (*) uses Object.equals
        out.writeReference(root);
        return;
    }
    seen.add(root);
    /* write fields, recurse */
}
```

What's `Set<Object> seen` here? If it's a `HashSet`, you call `equals` and `hashCode` on whatever objects you traverse. Two different `Employee` instances with equal IDs would be treated as the *same* cycle node, and you'd start emitting `writeReference` for objects you have never actually visited — silently corrupting the serialised output.

**Fix.** A cycle detector must compare by *identity*: have I been at *this exact* object before?

```java
public void serialise(Object root, JsonWriter out,
                      Set<Object> seen) {   // built from new IdentityHashMap<>()
    if (seen.contains(root)) {
        out.writeReference(root);
        return;
    }
    seen.add(root);
    /* recurse */
}

Set<Object> seen = Collections.newSetFromMap(new IdentityHashMap<>());
serialise(root, writer, seen);
```

Identity is the right contract: a cycle in the graph is a *backward edge* through the *same object*, not through any object that happens to compare equal. Jackson uses `IdentityHashMap` internally for exactly this reason (see `com.fasterxml.jackson.databind.SerializerProvider`'s anti-cycle code).

The cycle-detection use case is also the canonical answer to the interview question *"name a legitimate use for `IdentityHashMap`."*

---

## 5. Refactor 5 — A token registry mistakenly keyed by identity

The opposite mistake — using identity when you wanted equality — happens in caching code. A token-issuance service:

```java
private final Map<UserSession, AccessToken> issued = new IdentityHashMap<>();

public AccessToken tokenFor(UserSession session) {
    return issued.computeIfAbsent(session, this::mint);
}
```

Suppose `UserSession` is a record with one field (`String sessionId`). Two distinct `UserSession` objects representing the same session — one parsed from a cookie on the first request, another deserialised from the cache layer on a subsequent request — *are not* the same Java object. `IdentityHashMap` treats them as different keys, mints a fresh token for each request, and the original token never gets reused. Memory grows unboundedly.

**Fix.** Use the equality-based map, which respects the record's auto-generated `equals` over the `sessionId` field:

```java
private final Map<UserSession, AccessToken> issued = new ConcurrentHashMap<>();
```

The general rule: pick the map by the **contract you want for "same key"**. If two objects with equal fields should be treated as the same key, use a `HashMap` / `ConcurrentHashMap` / `LinkedHashMap`. If only the same Java object should be treated as the same key, use `IdentityHashMap`. Either one is wrong for the opposite use case.

The performance section in `optimize.md` covers why `IdentityHashMap` is often faster — its identity hash is one shift, its lookup is `==` (one machine instruction) instead of an `equals` call. But "faster" doesn't justify "wrong". Pick the contract first.

---

## 6. Refactor 6 — A "did this change?" check that fires every render

A reactive UI library re-renders a component when its props change. The check is:

```java
public void render(Props next) {
    if (this.props == next) return;        // (*) identity comparison
    this.props = next;
    component.redraw(next);
}
```

If `Props` is a record with three fields, the calling code typically builds a fresh `Props` per render — `new Props(currentUser, theme, locale)`. Even when nothing logical has changed, the new object is `!=` the old one, the check fails, and the component redraws on every frame.

**Fix.** Compare by value:

```java
public void render(Props next) {
    if (Objects.equals(this.props, next)) return;
    this.props = next;
    component.redraw(next);
}
```

Records auto-generate `.equals`, so `Objects.equals(this.props, next)` returns `true` whenever all three fields are equal. The redraw fires only when something actually changed.

This is the React-style *value equality memoisation* pattern, and the identity vs equality distinction is exactly the bug it's working around. The same lesson applies to *any* memoisation: by default, equality is what you mean, and identity is a special optimisation you turn on with care.

---

## 7. Refactor 7 — A logger that prints object identity by accident

A diagnostic statement:

```java
log.info("Account state: {}", account);
```

prints `Account@5e7c5dee` instead of a human-readable representation. The class never overrode `toString()`, so the default `Object.toString()` returns `getClass().getName() + "@" + Integer.toHexString(hashCode())`. That hex string at the end is the *identity hash* — yet another place where identity sneaks into your code uninvited.

**Fix.** Override `toString` deliberately. For records, you get a sensible one for free:

```java
public record Account(long id, BigDecimal balance, String currency) {}
// Account[id=42, balance=120.50, currency=USD]
```

For classes with mutable state, write one explicitly:

```java
@Override
public String toString() {
    return "Account[id=" + id + ", balance=" + balance + ", currency=" + currency + "]";
}
```

This is also a useful sanity check for an entire codebase: grep your logs for `@[0-9a-f]+$`. Every match is a class missing `toString`. Many of those classes also lack `equals` and `hashCode` — the identity-vs-equality work is half-done across the system.

See [../01-equals-hashcode-tostring-contracts/](../01-equals-hashcode-tostring-contracts/) for the full set of three contracts that travel together.

---

## 8. Refactor 8 — `BigDecimal` and the `equals`-vs-`compareTo` gotcha

A different identity-vs-equality trap, one level up. `BigDecimal` has an `equals` that *also* considers scale, not just numeric value:

```java
BigDecimal a = new BigDecimal("1.0");
BigDecimal b = new BigDecimal("1.00");

a == b                  // false  (different objects)
a.equals(b)             // false  (different scale)
a.compareTo(b) == 0     // true   (same numeric value)
```

So even `.equals()` doesn't always answer "are these numerically equal?" for `BigDecimal`. You need `compareTo(...) == 0`. This is documented behaviour, and senior code reviewers will catch a `bigDecimalA.equals(bigDecimalB)` that meant "same amount of money".

The takeaway: the *type's* notion of equality is what `.equals()` returns. For most types, equality is what you'd intuitively expect ("same content"). For `BigDecimal`, it's narrower than you expect. Always read the class's `equals` javadoc when working with a value-bearing type you didn't author.

This bug also belongs to the broader equality contract topic — see [../01-equals-hashcode-tostring-contracts/](../01-equals-hashcode-tostring-contracts/).

---

## 9. Refactor 9 — Identity in a thread-tracking map

You write a debugging map that records the wall-clock time at which each thread last touched a critical section:

```java
private final Map<Thread, Instant> lastSeen = new ConcurrentHashMap<>();

public void enter() {
    lastSeen.put(Thread.currentThread(), Instant.now());
    /* do work */
}
```

`Thread` is a class without a custom `equals` — its `.equals` falls back to `Object.equals`, which is `==`. So `HashMap` keyed by `Thread` already behaves like identity. Switching to `IdentityHashMap` here is a code-clarity win (the intent is explicit), not a behaviour change:

```java
private final Map<Thread, Instant> lastSeen =
    Collections.synchronizedMap(new IdentityHashMap<>());
```

This refactor is purely about *naming the contract*. A future reader sees `IdentityHashMap<Thread, Instant>` and immediately understands that thread identity, not any logical "equal threads" notion, is what's being tracked. The `HashMap` version reads ambiguously — the reader has to know that `Thread` doesn't override `equals`.

`Collections.synchronizedMap` here, by the way, because `IdentityHashMap` is not concurrent. If contention matters, the standard pattern is `ConcurrentHashMap` keyed by `Thread.threadId()` (a `long`) instead. Identity-based concurrent maps don't exist in the JDK.

---

## 10. Refactor 10 — `LinkedHashSet` vs `IdentityHashSet` for insertion-order tracking

Suppose you want to track the order in which `Customer` objects entered a queue, where two customer objects with the same ID *should* count as the same entry:

```java
private final Set<Customer> queue = Collections.newSetFromMap(new IdentityHashMap<>());
```

The identity choice is wrong: when the same customer is re-added (a fresh `Customer` object loaded from the database), the queue treats it as a new entry. Use `LinkedHashSet` for value-equality with insertion-order semantics:

```java
private final Set<Customer> queue = new LinkedHashSet<>();
```

The wider point: there are *three* "same-key" notions in the JDK, and you should pick consciously.

| Map / Set                                              | "Same key" means          | Use when                                                  |
|--------------------------------------------------------|---------------------------|-----------------------------------------------------------|
| `HashMap`, `LinkedHashMap`, `TreeMap`, `ConcurrentHashMap` | `.equals()` (with `.hashCode()`) | Value equality (the normal case)                          |
| `IdentityHashMap`                                      | `==`                      | Cycle detection, object-tracking, identity-keyed lookups   |
| `TreeMap` with a `Comparator`                          | `compareTo` / comparator returns 0 | Sorted by a custom ordering (e.g., `BigDecimal` by value) |

`TreeMap` with `Comparator.naturalOrder()` over `BigDecimal` is the cleanest fix for the §8 numeric-equality trap: it uses `compareTo`, so `1.0` and `1.00` count as one key.

---

## 11. When you genuinely want identity — the short list

To balance the "use `.equals` everywhere" message: there are cases where `==` and identity-collections are the right contract.

- **Cycle detection in object graphs** (Refactor 4).
- **Per-instance state tracking** when the object's identity is what matters, not its data — e.g., a `Map<Thread, ThreadLocalState>`, or a `WeakHashMap<ClassLoader, Cache>` (the latter using `WeakHashMap`, which is identity-keyed in spirit since `ClassLoader` doesn't override `equals`).
- **Sentinel values.** A library defines `public static final Object EMPTY = new Object();` and asks you to compare with `==`. Equality wouldn't make sense (there's no value to compare).
- **Enum constants.** `if (status == OPEN)` is idiomatic and recommended. Enum constants are spec-guaranteed singletons.
- **Caches keyed on object identity** to avoid recomputation for the same object reference — e.g., `MethodHandle` lookup tables.

In every other case — `String`, `Integer`, `BigDecimal`, your own domain entities — `.equals()` is the contract, and `==` is a bug waiting to happen.

`senior.md` goes deeper on the architecture-level identity questions (intern pools, deserialised singletons, classloader boundaries).

---

## 12. The contract picker — a decision flow

For any new comparison you write between two reference-type values, walk through:

1. **Is either side a primitive?** Then `==` is value comparison; you're done.
2. **Is either side maybe `null`?** Use `Objects.equals(a, b)`.
3. **Are both sides `enum` constants of the same type?** Use `==`.
4. **Are both sides `String` / `Integer` / `BigDecimal` / a record / a domain type with a sensible `equals`?** Use `.equals()`.
5. **Are you implementing cycle detection, identity-keyed cache, sentinel check?** Then `==` (or `IdentityHashMap`) is intentional — document it.

The picker is short because the *most common* case is step 4 — domain types with value equality — and the *most common bug* is reaching for `==` there.

---

## 13. Refactoring checklist

When you take over a codebase and want to clean up identity-vs-equality bugs:

- [ ] Grep for `== ` and `!= ` adjacent to types you suspect (`String`, `Integer`, `Long`, `Boolean`, `BigDecimal`, `LocalDate`, `UUID`, your domain entities). Most static analysers flag this (Sonar S4973 for strings, NumberCompareEquality for boxed numerics).
- [ ] Look for `IdentityHashMap` usages — confirm the intent really is identity.
- [ ] Look for `HashMap<Thread, ...>`, `Map<ClassLoader, ...>`, `Map<Class<?>, ...>` — these are *de facto* identity maps. Decide whether to label them explicitly with `IdentityHashMap`.
- [ ] Look for classes without `toString` (you'll see `ClassName@hexhash` in logs) — those classes often lack `equals` and `hashCode` too.
- [ ] Check every `new String(...)` call — almost always a mistake; the constructor creates an unpooled copy and is only useful for very specific scenarios (defensive copying of a substring's char array prior to JDK 7u6).

The grep + IDE inspection pass is usually the first 80% of the cleanup. The remaining 20% is judgement calls: when is identity *intentional* (Thread maps, sentinels) and when is it a leftover bug.

---

## 14. Quick rules

- [ ] Replace `s1 == s2` with `Objects.equals(s1, s2)` for any String comparison.
- [ ] Replace `i1 == i2` with `i1.intValue() == i2.intValue()` or `Objects.equals(i1, i2)` for any `Integer`/`Long`/`Boolean` comparison.
- [ ] Use `IdentityHashMap` (or `Collections.newSetFromMap(new IdentityHashMap<>())`) only when identity is the *contract*, not when it's *accidentally faster*.
- [ ] Cycle detection in graph walks always uses identity.
- [ ] Cache lookups always use equality — `computeIfAbsent` does the right thing for you.
- [ ] Defaults: `HashMap` for value-keyed lookup, `IdentityHashMap` for object-keyed tracking, `TreeMap` for ordering.
- [ ] When in doubt, use `Objects.equals` — it's the null-safe, idiomatic equality call.

---

## 15. What's next

| Topic                                                          | File              |
|----------------------------------------------------------------|-------------------|
| When identity is the right contract, intern pools, classloaders | `senior.md`        |
| Code-review vocabulary, Sonar/ArchUnit, mentoring              | `professional.md`  |
| JLS hooks for `==`, the Integer cache, identityHashCode        | `specification.md` |
| 10 buggy snippets, identity-vs-equality bug taxonomy           | `find-bug.md`      |
| Cost of `==` vs `.equals`, intern pool footprint, JIT fast-paths | `optimize.md`      |
| 8 hands-on refactors and design exercises                      | `tasks.md`         |
| 20 interview Q&A                                               | `interview.md`     |

---

**Memorize this:** every reference-type comparison forces a choice: do I mean *same object* or *same value*? Refactor `==` to `.equals` (or `Objects.equals` for null-safety) by default. Reach for `IdentityHashMap` only when identity is the *contract* — cycle detection, per-instance tracking, sentinels — not because it happens to be faster. The standard library does the right thing if you stop hand-rolling lookups: `Map.computeIfAbsent`, `Set.contains`, `Optional.equals` already use `.equals` and `hashCode` correctly.
