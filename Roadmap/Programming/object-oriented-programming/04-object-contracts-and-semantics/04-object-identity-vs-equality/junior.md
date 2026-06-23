# Object Identity vs Equality — Junior

> **What?** Java has two distinct questions: *"are these the same object?"* (identity) and *"do these two objects mean the same thing?"* (equality). The operator `==` answers the first; the method `.equals()` answers the second. For reference types, mixing them up is the single most common source of "looks right, breaks silently" bugs in the language.
> **How?** For every comparison between two reference variables, decide which question you actually want. If you mean "same instance in memory" — keep `==`. If you mean "same value, regardless of which object holds it" — use `.equals()`. For primitives, `==` *is* value comparison; there is no `.equals()` to call.

---

## 1. Two questions, one syntax mistake

Take this:

```java
String a = "user-42";
String b = "user-42";
if (a == b) { ... }                 // works today, breaks tomorrow
```

Today `a == b` is `true`, because both literals share the same entry in the JVM's string pool. Tomorrow somebody reads the same value from a database:

```java
String a = "user-42";
String b = new String(loadFromDatabase("user.id"));   // fresh object, not pooled
if (a == b) { ... }                 // false
```

Same characters, different object, `==` returns `false`. The bug is silent: nothing throws, the `if` simply doesn't execute. The fix is `.equals()`:

```java
if (a.equals(b)) { ... }           // true regardless of where b came from
```

This is the canonical trap. `==` on reference types asks *"is this the same object?"*. `.equals()` (when properly overridden, as it is on `String`) asks *"is this the same value?"*. You almost always want the second.

The reason juniors get bitten is that Java *allows* `==` between any two reference types, and the compiler will not warn. The code reads like Python or JavaScript, but the semantics are sharper: the operator is asking a different question than the eye expects.

---

## 2. The Integer cache trap

Java boxes small integers in a cache. The same value comes back as the same object — until it doesn't.

```java
Integer a = 100;
Integer b = 100;
System.out.println(a == b);        // true

Integer c = 200;
Integer d = 200;
System.out.println(c == d);        // false
```

Both `Integer.valueOf` calls return cached objects for `100` because `100` falls inside the `-128..127` range that `Integer` caches eagerly. For `200`, the JVM allocates two distinct `Integer` objects — `==` compares the references, sees they are different, returns `false`.

The trap is that *the code reads identically*. Two `Integer` variables, two equal numeric values, one `==`. The answer flips at the boundary `127 → 128`:

```java
Integer.valueOf(127) == Integer.valueOf(127);    // true
Integer.valueOf(128) == Integer.valueOf(128);    // false
```

The cure is the same as for strings: stop comparing wrapper types with `==`.

```java
if (a.equals(b)) { ... }                  // compares values
if (Objects.equals(a, b)) { ... }         // also null-safe
if (a.intValue() == b.intValue()) { ... } // unbox to primitives and compare
```

The same cache exists, by spec, for `Boolean`, `Byte`, `Character` (`0..127`), `Short`, and `Long`. It does **not** exist for `Float` and `Double`. So `Boolean.TRUE == Boolean.TRUE` is `true` (a single shared instance), but `Double.valueOf(1.0) == Double.valueOf(1.0)` is `false`. Don't rely on either; use `.equals()`.

---

## 3. `==` is fine for primitives

The `==` operator changes meaning depending on the operands' type. For primitive types (`int`, `long`, `double`, `boolean`, `char`, `byte`, `short`, `float`), `==` compares *values* — there are no references to compare.

```java
int x = 127, y = 127;
System.out.println(x == y);        // true — value comparison

double a = 0.1 + 0.2, b = 0.3;
System.out.println(a == b);        // false — but for a different reason (FP precision)
```

`x == y` works because `int` is a value type. The `double` example fails not because of identity vs equality, but because `0.1 + 0.2` does not equal `0.3` in IEEE-754 — a different topic ([../../../06-numerical-types-precision/](../../../06-numerical-types-precision/)).

The rule of thumb is binary: **primitive operand → value comparison; reference operand → identity comparison.** When in doubt about which world you are in, look at the declared type. `int` is value; `Integer` is reference.

---

## 4. Auto-unboxing changes the question

The rule above gets cloudy because of auto-unboxing. If one operand is primitive and the other is a wrapper, the wrapper is *unboxed* to a primitive, and `==` becomes value comparison.

```java
Integer wrapped = 200;
int primitive = 200;
System.out.println(wrapped == primitive);     // true — wrapped is unboxed
```

But if *both* sides are wrappers, no unboxing happens — and `==` is identity.

```java
Integer a = 200;
Integer b = 200;
System.out.println(a == b);                   // false — both reference types
```

This mix is why senior code reviewers go cold whenever they see `==` near a wrapper type. The compiler will not warn. The *only* safe rule for `Integer`, `Long`, `Boolean`, `Double` and friends is: never use `==` on them. Always `.equals()` or `Objects.equals()`. The same goes for `String`, `BigDecimal`, `BigInteger`, `LocalDate`, `UUID`, and every other reference type you might absent-mindedly compare with `==`.

---

## 5. `Objects.equals` for null-safe comparison

Calling `.equals()` directly throws `NullPointerException` if the left side is `null`:

```java
String a = null;
String b = "abc";
if (a.equals(b)) { ... }           // NPE
```

`java.util.Objects.equals(a, b)` (since Java 7) handles both nulls correctly:

```java
import java.util.Objects;

if (Objects.equals(a, b)) { ... }  // false (one null, one not), no exception
if (Objects.equals(null, null)) { ... } // true
```

The implementation is two lines:

```java
public static boolean equals(Object a, Object b) {
    return (a == b) || (a != null && a.equals(b));
}
```

It first uses `==` as a fast-path: if both references are the same (including both being `null`), return `true` without touching `.equals`. Then it null-checks `a` and delegates to `a.equals(b)`. This is the idiomatic Java way to ask "are these two possibly-null values equal?" — every code review will flag a raw `.equals()` on a value that could be `null`.

Use `Objects.equals` everywhere you'd write `.equals()` *unless* you have already null-checked the receiver. In modern code, it's the default.

---

## 6. Working domain example — order IDs

You have an `Order` class with an `orderId` field. Two parts of the system both load the same order:

```java
public final class Order {
    private final String orderId;
    private final BigDecimal total;
    /* constructor, getters */
}

Order fromDb     = orderRepository.findById("ORD-2026-0019");
Order fromCache  = orderCache.peek("ORD-2026-0019");
```

When you ask "is this the same order?", you almost certainly mean *same logical order*, not *same Java object*. The cache and the database returned two separate `Order` instances, so:

```java
if (fromDb == fromCache) { ... }                     // false — two objects
if (fromDb.equals(fromCache)) { ... }                // depends on equals() override
if (fromDb.orderId().equals(fromCache.orderId())) { ... }  // explicit and safe
```

If you wrote `Order.equals` to compare by `orderId`, the middle line works. If you didn't, `equals` falls back to `Object.equals`, which is just `==`, and you get the wrong answer silently. This is exactly why the next section in this roadmap — [../01-equals-hashcode-tostring-contracts/](../01-equals-hashcode-tostring-contracts/) — is mandatory reading for every reference type that participates in equality.

The safer working pattern, when you control the type and equality is well-defined, is to override `.equals()` once and use it everywhere. Until you do, `==` will sometimes accidentally work (same instance, e.g., from a cache hit) and sometimes accidentally fail (fresh instances from different sources). Tests written one way will succeed; the production path will fail.

---

## 7. Strings — the easiest trap to walk into

Strings deserve their own paragraph because they look like values but are reference objects.

```java
String a = "abc";                  // pooled literal
String b = "abc";                  // same pool entry
String c = new String("abc");      // fresh object
String d = a + "";                 // concatenation result, fresh

System.out.println(a == b);        // true
System.out.println(a == c);        // false
System.out.println(a == d);        // false
System.out.println(a.equals(c));   // true
System.out.println(a.equals(d));   // true
```

`a == b` works only because *both* operands are compile-time string literals, and the JVM keeps one shared object per literal value. The instant you build a string from anything — a database row, a JSON body, a concatenation, a `new String(...)`, a substring — you get a fresh object and `==` returns `false`.

The rule for strings is the same as for every other reference type: **use `.equals()`**. If `==` happened to work for you once, it was a coincidence of the pool.

There is one exception: comparing a string to `null` with `==` is fine and idiomatic (`if (s == null)`). `null` is not a value, so `.equals()` cannot be applied to it.

---

## 8. Where identity is actually what you want (briefly)

There are real cases where `==` is the right operator, and they're worth naming so you know when *not* to reach for `.equals()`:

- **`null` checks.** `if (x == null)` is always correct and idiomatic.
- **`enum` constants.** Each `enum` value is a singleton per JVM. `Status.OPEN == Status.OPEN` is `true`, faster than `.equals`, and immune to null surprises. Senior code uses `==` for enums.
- **Sentinel objects.** A library might define `public static final Object MISSING = new Object();` and ask you to check `if (result == MISSING)`. That's identity comparison and the *intent*.
- **Identity-based collections** (rare). `IdentityHashMap`, `Collections.newSetFromMap(new IdentityHashMap<>())`. These exist specifically when you want to track distinct objects regardless of equality — for example, when checking for cycles in a graph.

`senior.md` goes deep on each. For now, the rule for juniors is simple: **outside `null` checks, enums, and explicit sentinels, never use `==` on reference types**.

---

## 9. Quick rules

- [ ] For primitives (`int`, `long`, `double`, ...): `==` is value comparison; there is no `.equals`.
- [ ] For reference types: `==` is identity (same object), `.equals()` is value equality.
- [ ] On `String`, `Integer`, `Boolean`, `BigDecimal`, `LocalDate`, etc., always use `.equals()` or `Objects.equals()`.
- [ ] Use `Objects.equals(a, b)` when either side could be `null`.
- [ ] `Integer.valueOf(127) == Integer.valueOf(127)` is `true`, `Integer.valueOf(128) == Integer.valueOf(128)` is `false` — the boxing cache covers `-128..127` only.
- [ ] Comparing strings with `==` may work today and break tomorrow when one operand stops being a literal.
- [ ] `enum` constants are the one reference type where `==` is preferred over `.equals` — singleton-per-JVM by spec.
- [ ] `null` checks (`x == null`) always use `==` — `.equals` would throw.

---

## 10. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Refactoring `==` to `.equals`, identity collections         | `middle.md`        |
| When identity is the right contract, intern pools, classloaders | `senior.md`        |
| Code-review vocabulary, Sonar/ArchUnit rules, mentoring     | `professional.md`  |
| JLS §15.21, §5.1.7 boxing cache, identity hash specification | `specification.md` |
| 10 buggy snippets, identity-vs-equality bug taxonomy        | `find-bug.md`      |
| Cost of `==` vs `.equals`, intern pool footprint, JIT fast-paths | `optimize.md`      |
| 8 hands-on refactors and design exercises                   | `tasks.md`         |
| 20 interview Q&A                                            | `interview.md`     |

---

**Memorize this:** `==` asks *"same object?"*. `.equals()` asks *"same value?"*. For primitives, those questions collapse into one and `==` is right. For reference types — `String`, `Integer`, `BigDecimal`, your own domain classes — they are different questions, and the second one is almost always the one you want. The Integer cache and the string pool make `==` *occasionally* give the right answer for the wrong reason; that is the trap. Use `.equals()` (or `Objects.equals()` when nulls are possible), reserve `==` for `null` checks, `enum` constants, and explicit identity comparisons, and your reference-type bugs vanish.
