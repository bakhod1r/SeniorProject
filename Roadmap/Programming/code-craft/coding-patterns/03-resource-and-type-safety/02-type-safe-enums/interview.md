# Type-Safe Enums — Interview Questions

> **Category:** [Resource & Type-Safety Patterns](../README.md) — model a fixed set of choices as a real type the compiler can check.

---

## Junior Questions (10)

### J1. What is a type-safe enum?

**Answer:** A dedicated type whose values are a fixed, named set, so the compiler rejects any value outside that set — unlike `int`/`String` constants.

### J2. What anti-pattern does it replace?

**Answer:** The "int enum" (and "stringly-typed") anti-pattern: using raw `int`/`String` constants for a closed set, which allows illegal values, has no namespace, and gives no compiler help.

### J3. Why is `process(7)` a problem with int constants?

**Answer:** `int` accepts any integer, so `7` (or a negative, or an unrelated int) compiles even though it's not a valid status. An enum type only has its declared constants.

### J4. What is "exhaustiveness"?

**Answer:** The compiler verifying that a `switch`/`match` handles every constant of the enum, so adding a new constant produces compile errors at the sites you forgot.

### J5. Give three real examples where an enum fits.

**Answer:** Days of the week, HTTP methods, log levels, card suits, order status — any closed, compile-time-known set.

### J6. Why is Go's enum weaker than Java's?

**Answer:** Go has no real enum — just a named `int` type with `iota`. Any int is assignable (`Status(99)` compiles), and there's no exhaustiveness check.

### J7. Where should you convert a raw string to an enum?

**Answer:** At the boundary (parsing JSON/DB/CLI input), once. After that, the typed value flows through the code.

### J8. Are enum constants namespaced?

**Answer:** Yes — `Status.PAID` lives inside the type, so it can't collide with `Color.RED` or a bare global `PAID`.

### J9. Should you use a boolean or an enum for two states?

**Answer:** A boolean is fine for genuinely true/false. Use an enum when named states read better (`Mode.LIGHT`/`Mode.DARK` beats `boolean isDark`) or when a third state might appear.

### J10. What's a common enum mistake?

**Answer:** Comparing the enum to a raw string (`s.toString().equals("paid")`) or sprinkling string literals around, defeating the type safety.

---

## Middle Questions (10)

### M1. When should you NOT use an enum?

**Answer:** When the set is open / runtime-extensible (plugins, config-defined categories). Use polymorphism or a registry instead of an enum you must recompile to extend.

### M2. Can enums carry data?

**Answer:** Yes — Java enums can have fields, constructors, and methods (`Planet.EARTH.surfaceGravity()`). The enum becomes the data table, avoiding parallel arrays keyed by ordinal.

### M3. What is strategy-per-constant?

**Answer:** Each enum constant overrides an abstract method with its own behavior (`Operation.PLUS.apply`). It's the Strategy pattern collapsed into a closed, exhaustive enum; adding a constant forces implementing the method.

### M4. Why is persisting `ordinal()` dangerous?

**Answer:** Ordinal is declaration position. Reordering constants changes every constant's ordinal, silently corrupting all previously stored values. Persist the name or an explicit stable code instead.

### M5. What's the difference between `IntEnum` and `Enum` in Python?

**Answer:** `IntEnum` members *are* ints (compare/order like ints, JSON/DB friendly) at the cost of a weaker type boundary. Plain `Enum` members are distinct objects with no implicit int behavior.

### M6. How do you make Go enums safer?

**Answer:** Add a `String()` method (via `stringer`), a `Valid()`/parse function, an unexported upper-bound sentinel, and an exhaustiveness linter (`exhaustive`) in CI.

### M7. What's a flag/bitset enum?

**Answer:** An enum whose values combine — `READ | WRITE`. Java `EnumSet`, Python `enum.Flag`, Go `1 << iota`. Models a *set* of choices, type-safely.

### M8. Why avoid a blanket `default:` over a closed enum?

**Answer:** A `default:` catch-all suppresses exhaustiveness checking — adding a constant won't trigger a compile error where you needed one.

### M9. How do you handle an unknown value when deserializing?

**Answer:** Explicitly: fail fast, or map to a designated `UNKNOWN`/`UNSPECIFIED` constant. Never let an unrecognized value masquerade as a valid one.

### M10. boolean parameter vs enum parameter?

**Answer:** A boolean argument (`render(true)`) is opaque at the call site (a Flag Argument smell). `render(Mode.PREVIEW)` is self-documenting — enums cure flag arguments.

---

## Senior Questions (10)

### S1. When do you outgrow a flat enum for a sum type?

**Answer:** When cases need *different* data shapes (`Circle{radius}` vs `Rectangle{w,h}`). A flat enum forces nullable fields; a sum type / sealed hierarchy lets each case carry only its own data.

### S2. Explain the expression problem in enum vs polymorphism terms.

**Answer:** Enum+switch makes adding *operations* easy and adding *cases* hard; polymorphism makes adding *cases* easy and adding *operations* hard. Choose by which axis changes more often.

### S3. How do you get exhaustiveness in TypeScript?

**Answer:** The `never`-assertion idiom: assign the switched value to a `never` in the `default` branch, so an unhandled case becomes a compile error.

### S4. How do you keep an enum's wire format stable?

**Answer:** Treat source and wire as separate contracts: assign explicit, stable codes; reserve retired values (protobuf `reserved`); make the zero value `UNSPECIFIED`; decode unknown values explicitly.

### S5. Why is `enum Singleton { INSTANCE; }` the best Singleton in Java?

**Answer:** The JVM guarantees one instance per constant, and enum serialization/deserialization preserves that singleton even against reflection — closing the loopholes a hand-written Singleton leaves open.

### S6. How does an enum model a state machine safely?

**Answer:** Each state defines its legal transitions (e.g., `next()` returning an `EnumSet`), and `transitionTo` fails fast on illegal moves. The transition graph lives in the type; adding a state forces defining its transitions.

### S7. What's the cost difference between `EnumSet` and `HashSet<Enum>`?

**Answer:** `EnumSet` is a bit vector (one `long` for ≤64 constants): O(1) bitwise ops, allocation-free, ~8× faster than `HashSet`'s hash+bucket lookup.

### S8. How do you migrate int constants to an enum without breaking persisted data?

**Answer:** Add the enum; keep a parse function mapping old persisted ints to constants; deprecate the constants; convert call sites; then remove the constants — keeping the int↔enum bridge until all data is migrated.

### S9. What's the smell that an enum was the wrong choice?

**Answer:** Every switch ends in `default: throw`, and you keep shipping "forgot to handle the new type" bugs — the set is actually open; invert to polymorphism/registry.

### S10. Why should the protobuf enum zero value be `UNSPECIFIED`?

**Answer:** Proto3 uses the zero value as the implicit default for absent fields. If zero means a real state, absent fields silently become that state; reserving zero for "unspecified" makes "not set" detectable.

---

## Professional Questions (10)

### P1. What does a Java enum compile to?

**Answer:** A `final` class extending `java.lang.Enum`, with each constant a `public static final` singleton instance created in the static initializer, plus a `$VALUES` array, `values()`, and `valueOf()`.

### P2. Why is `==` correct (and preferred) for enums?

**Answer:** Constants are singletons, so reference equality equals value equality. `==` is also null-safe (won't NPE) and faster than `equals`.

### P3. How is `EnumSet` represented in memory?

**Answer:** As a single `long` bit vector (`RegularEnumSet`) for ≤64 constants, or a `long[]` (`JumboEnumSet`) beyond that. Each constant's ordinal is a bit position.

### P4. What does `switch` on an enum compile to?

**Answer:** A synthetic `int[]` `$SwitchMap$` mapping ordinal → case label, then a `tableswitch` on that dense int — O(1) dispatch.

### P5. How does Python implement enum singletons?

**Answer:** The `EnumMeta` metaclass intercepts class creation, converts members into singleton instances stored in `_member_map_`/`_value2member_map_`, so `Status(2) is Status.PAID`.

### P6. What is enum aliasing in Python?

**Answer:** Two members with the same value — the second becomes an alias of the first, not a distinct member. `@enum.unique` forbids it.

### P7. How does `stringer` implement `String()` efficiently?

**Answer:** It generates a single concatenated name string plus an index/offset table, returning a substring with zero allocation and O(1) lookup, with a fallback for out-of-range values.

### P8. How does Java serialize enums?

**Answer:** By *name*, via `Enum.writeObject`/`valueOf` — robust to reordering, broken by renaming. `readResolve` is ignored to preserve the singleton.

### P9. What's the performance trap with `values()`?

**Answer:** It clones the backing array on every call (defensive copy). On hot paths, cache it once in a `static final` array.

### P10. Why is `EnumMap` faster than `HashMap<Enum,V>`?

**Answer:** `EnumMap` is an `Object[]` indexed by ordinal — array indexing, no hashing, perfect locality, declaration-order iteration.

---

## Coding Tasks (5)

### C1. Java enum with associated data.

```java
public enum HttpStatus {
    OK(200), NOT_FOUND(404), SERVER_ERROR(500);
    private final int code;
    HttpStatus(int code) { this.code = code; }
    public int code() { return code; }
}
```

### C2. Strategy-per-constant.

```java
public enum Op {
    ADD { int apply(int a, int b) { return a + b; } },
    MUL { int apply(int a, int b) { return a * b; } };
    abstract int apply(int a, int b);
}
```

### C3. Python parse-at-boundary.

```python
from enum import Enum

class Status(Enum):
    PENDING = "pending"; PAID = "paid"

def parse(raw: str) -> Status:
    try:    return Status(raw)
    except ValueError:
        raise ValueError(f"unknown status {raw!r}")
```

### C4. Go enum done right.

```go
type Status int
const ( Pending Status = iota; Paid; statusEnd )

func (s Status) Valid() bool { return s >= Pending && s < statusEnd }
func (s Status) String() string {
    return [...]string{"pending", "paid"}[s]
}
```

### C5. Exhaustive switch in TypeScript.

```ts
type Shape = { k: "circle"; r: number } | { k: "square"; s: number };
function area(x: Shape): number {
  switch (x.k) {
    case "circle": return Math.PI * x.r ** 2;
    case "square": return x.s ** 2;
    default: { const _: never = x; return _; }
  }
}
```

---

## Trick Questions (5)

### T1. Is a Go `iota` enum type-safe?

**No.** It's a named `int`; `Status(99)` compiles. You must add validation and a linter.

### T2. Can two Python enum members share a value?

**Yes** — the second becomes an *alias*, unless you apply `@enum.unique`.

### T3. Is it safe to store an enum's ordinal in a database?

**No.** Ordinal is declaration order; reordering constants corrupts stored values. Store the name or an explicit code.

### T4. Does adding a `default:` branch make a switch "safer"?

**No** — it *removes* exhaustiveness checking over a closed enum, hiding the next missed case.

### T5. Is `boolean` always worse than a two-value enum?

**No.** For genuinely true/false meaning, `boolean` is clearer. Enums win when the two states aren't naturally boolean or a third may appear.

---

## Behavioral Questions (5)

### B1. Tell me about replacing stringly-typed code with enums.

**Sample:** "Our event pipeline keyed on `event_type` strings; typos shipped to prod regularly. We introduced an `EventType` enum, parsed once at ingestion, and the typo class of bug vanished — the build caught them."

### B2. When did an enum become a liability?

**Sample:** "We modelled payment providers as an enum with a giant `default: throw` switch. Each new provider needed edits across 8 switches. We inverted to a `PaymentProvider` interface with a registry; adding a provider became one class."

### B3. Describe an ordinal serialization incident.

**Sample:** "Someone alphabetized an enum for tidiness. We persisted ordinals. Overnight, thousands of orders showed the wrong status. Fix: migrate to name-based storage and add a test asserting ordinal stability."

### B4. How do you decide enum vs sum type?

**Sample:** "If every case has the same shape, an enum. The moment cases need different fields, I move to a sealed hierarchy so I don't end up with a bag of nullable companion fields."

### B5. How do you enforce enum safety in a Go codebase?

**Sample:** "We standardized on `stringer`, a `Valid()` method, and the `exhaustive` linter in CI. The linter is the part that actually catches the missed-case bugs the compiler won't."

---

## Tips for Answering

1. **Lead with the cured anti-pattern:** int enum / stringly-typed.
2. **Name the four benefits:** illegal states unrepresentable, namespacing, exhaustiveness, attached behavior.
3. **Be honest about Go** — it's not type-safe by default.
4. **Mention sum types** as the strong generalization.
5. **Always flag the ordinal/serialization trap.**

---

[← Professional](professional.md) · [Resource & Type-Safety](../README.md) · [Roadmap](../../../README.md) · **Next:** [Tasks](tasks.md)
</content>
