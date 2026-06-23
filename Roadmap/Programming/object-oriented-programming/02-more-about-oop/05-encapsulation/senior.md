# Encapsulation — Senior

> **What?** The runtime cost (or lack of it) of encapsulation: getter/setter inlining, private field access, the JIT's view of `final` fields, JPMS modules at runtime, and the design balance between hiding too much vs not enough.
> **How?** By understanding which encapsulation primitives the JIT eliminates, which add overhead, and how modern Java features (records, sealed types, modules) push encapsulation forward without ceremony.

---

## 1. Encapsulation is (almost) free at runtime

A getter:
```java
public int x() { return x; }
```

After JIT, this is one field load. No overhead vs direct field access.

A setter with no validation:
```java
public void setX(int v) { x = v; }
```

After JIT, equivalent to direct field write.

Validating setters add the cost of the validation. If validation is a single bounds check, it's still nearly free.

**Conclusion:** worry about correctness and design; the JIT handles performance.

---

## 2. `final` fields are JIT-friendly

`final` fields can be:
- Treated as constants (load once, hoist out of loops)
- Used in escape-analysis decisions (immutable types more likely scalarized)
- Safely published across threads (JLS §17.5)

Make fields `final` whenever possible. Don't reassign just because Java syntax allows it.

---

## 3. Records: zero-cost encapsulation

```java
public record Point(double x, double y) { }
```

Compiles to:
- `final` class extending `java.lang.Record`
- `private final` fields
- Public accessors `x()`, `y()`
- Auto-generated `equals`, `hashCode`, `toString`

The accessors are inlined by the JIT. Records are as fast as hand-written immutable classes — usually slightly faster because the JVM can apply Record-specific optimizations.

---

## 4. JPMS at runtime

When a module declares `exports com.example.api;`, only that package is visible to other modules. Internal packages produce `IllegalAccessException` at runtime if accessed via reflection (without `--add-opens`).

This is *enforced* — not just a compile-time check. The JVM checks at every cross-module access.

Cost: a small runtime check per access, but the JIT inlines it so effective cost is zero in steady state.

---

## 5. Reflection and encapsulation

`Field.setAccessible(true)` historically bypassed access checks. Java 9+ requires `--add-opens` for cross-module access. In strict mode, even within a module, opening to reflection is explicit.

For encapsulation purposes:
- Don't write code that relies on reflection bypassing private
- Don't use `setAccessible` on internals you don't own
- Frameworks (Hibernate, Jackson, Spring) need `--add-opens` to function on internal types

---

## 6. The "open module" trade-off

JPMS gives you four choices per package:

| Setting        | Reflective access | Code access |
|----------------|------------------|-------------|
| Not exported   | No               | No          |
| `exports`      | Yes              | Yes         |
| `opens`        | Yes              | No (compile-time check) |
| `exports + opens` | Yes           | Yes         |

`opens` is the framework-friendly choice — it lets reflection in but blocks API dependency. `exports` makes things compilable against.

---

## 7. Static factories vs constructors

Static factories (Effective Java Item 1) provide more control:

```java
public static Currency of(String code) {
    Currency cached = CACHE.get(code);
    if (cached != null) return cached;
    return CACHE.computeIfAbsent(code, Currency::new);
}
```

- Can return cached/canonical instances
- Can return subclass types
- Can do validation outside the constructor's restrictions
- Have meaningful names (`Optional.of` vs `Optional.empty`)

The cost is one method call. Modern JITs inline it.

---

## 8. Records and varargs

```java
public record Tags(String... values) {
    public Tags {
        values = values.clone();   // defensive copy
    }
    @Override
    public boolean equals(Object o) {
        return o instanceof Tags t && Arrays.equals(values, t.values);
    }
}
```

The compact constructor (with defensive copy) ensures encapsulation. Without it, an external caller could keep a reference to the same array and mutate it.

---

## 9. Encapsulating mutability

For an inherently mutable class, encapsulate the mutation primitives:

```java
public class Cache<K, V> {
    private final Map<K, V> data = new ConcurrentHashMap<>();
    public V get(K k) { return data.get(k); }
    public void put(K k, V v) { data.put(k, v); }
    public int size() { return data.size(); }
}
```

Don't expose `data`. Callers shouldn't be able to clear, replace, or iterate it directly. They use the methods, which the class can change later (LRU, time-based eviction, weak refs) without breaking callers.

---

## 10. Encapsulation breakage patterns

Common ways encapsulation fails:

1. **Public fields** — direct mutation
2. **Returning mutable collections** — caller mutates internals
3. **Storing mutable input by reference** — caller mutates from outside
4. **Leaking `this` in constructor** — partial state observable
5. **Inner class capturing outer's `this`** — outer's lifecycle pinned
6. **Reflection** — bypasses access checks (Java 8 and earlier, weakened in 9+)
7. **Serialization** — reads/writes private fields (mitigated by `transient` + custom readObject/writeObject)
8. **`clone()`** — creates copies bypassing constructor invariants

Each requires a different fix; we cover them in `find-bug.md`.

---

## 11. The "tell don't ask" payoff

Compare:

```java
// Asking
if (account.balance() >= amount && !account.isFrozen()) {
    account.setBalance(account.balance() - amount);
}
```

```java
// Telling
account.withdraw(amount);   // throws if frozen or insufficient
```

The "telling" version:
- Hides the rule inside the object
- Won't drift if rule changes (only one place to update)
- Is testable in isolation (mock the account, assert the call)
- Is thread-safe (the account can synchronize internally)

This is encapsulation paying off in the form of fewer bugs and clearer code.

---

## 12. Private static helpers

```java
public class StringFormatter {
    public String format(String s) {
        return capitalize(trim(s));
    }
    private String trim(String s) { /* ... */ }
    private String capitalize(String s) { /* ... */ }
}
```

Private helpers are completely free at runtime — JIT inlines them. They make code readable without exposing internals.

If a helper is only called from one method, consider inlining it. If called from many, keep it private.

---

## 13. Encapsulation of side effects

```java
public class Service {
    private final Database db;
    private final EventBus events;
    public void create(User u) {
        db.save(u);
        events.publish(new UserCreated(u));
    }
}
```

Side effects (DB write, event publish) are *encapsulated* in `create`. Callers don't know which collaborators are involved. The implementation can swap dependencies without breaking the API.

This is encapsulation extending beyond data — to behavior.

---

## 14. Practical checklist

- [ ] All fields are `private` (or `private final` where possible)
- [ ] No setter exists unless it has a real reason to be public
- [ ] Mutable inputs are defensively copied
- [ ] Mutable outputs are wrapped in unmodifiable views or copies
- [ ] Validation happens at boundaries (constructor, public methods)
- [ ] Records are used for data carriers
- [ ] `final` is the default for classes; `sealed` for closed hierarchies
- [ ] Modules declare `exports` only for genuine API
- [ ] Reflection access is minimized; `setAccessible` is justified

---

## 15. What's next

| Topic                          | File              |
|--------------------------------|-------------------|
| Bytecode of access modifiers   | `professional.md`  |
| JLS access rules               | `specification.md` |
| Encapsulation interview Q&A    | `interview.md`     |

---

**Memorize this**: encapsulation costs nothing at runtime. The JIT inlines getters/setters. The cost is design effort: choose what to expose, what to hide, and document invariants. Records, sealed types, modules, and immutable types are modern Java's encapsulation toolkit.
