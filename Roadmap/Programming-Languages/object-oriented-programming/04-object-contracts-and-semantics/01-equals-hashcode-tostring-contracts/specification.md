# equals / hashCode / toString — Specification Reading Guide

> Unlike SOLID, the equality contract *is* normative. The five clauses, the agreement with `hashCode`, and the recommended `toString` format all live in the Javadoc of `java.lang.Object` — and the JDK collection framework assumes you respect them. This file maps each clause to the binding spec text, walks the `Objects` utility class (`java.util.Objects`), and covers the modern Java features (JEP 395 records, JEP 394 pattern-matching instanceof, JEP 409 sealed types) that change how you write the contract today.

---

## 1. Where to find the canonical text

| Concept                                       | Authoritative source                                |
|-----------------------------------------------|-----------------------------------------------------|
| `Object.equals(Object)` — the five clauses    | **`java.lang.Object` Javadoc**, `equals` method     |
| `Object.hashCode()` — the agreement rule      | **`java.lang.Object` Javadoc**, `hashCode` method   |
| `Object.toString()` — the convention          | **`java.lang.Object` Javadoc**, `toString` method   |
| `java.util.Objects` utility methods           | **`java.util.Objects` Javadoc** (Java 7+)           |
| Records — auto-generated contracts            | **JLS §8.10**, JEP 395                              |
| Pattern matching for `instanceof`             | JLS §14.30.1, **JEP 394**                           |
| Sealed classes — closed equality hierarchies  | **JLS §8.1.1.2**, JEP 409                           |
| `String.hashCode()` — the canonical algorithm | `String` Javadoc, `hashCode` method                 |
| `Comparable.compareTo` consistency note       | **`java.lang.Comparable` Javadoc**                  |
| `instanceof` null behaviour                   | JLS §15.20.2 — *"is null"* always false             |
| Bytecode for `instanceof`                     | JVMS §6.5.instanceof, §3.10 (verifier rules)        |
| `invokevirtual` for `equals`/`hashCode`       | JVMS §6.5.invokevirtual                             |
| Identity hash code (`System.identityHashCode`) | `System` Javadoc; HotSpot mark-word layout        |

The Javadoc of `Object` is the spec for this whole topic. Read it once per career — it is shorter than this file and authoritative.

---

## 2. The five clauses verbatim — `Object.equals(Object)`

The Javadoc text (from JDK 21, unchanged in meaningful ways since Java 1.0):

> The `equals` method implements an equivalence relation on non-null object references:
> - It is *reflexive*: for any non-null reference value `x`, `x.equals(x)` should return `true`.
> - It is *symmetric*: for any non-null reference values `x` and `y`, `x.equals(y)` should return `true` if and only if `y.equals(x)` returns `true`.
> - It is *transitive*: for any non-null reference values `x`, `y`, and `z`, if `x.equals(y)` returns `true` and `y.equals(z)` returns `true`, then `x.equals(z)` should return `true`.
> - It is *consistent*: for any non-null reference values `x` and `y`, multiple invocations of `x.equals(y)` consistently return `true` or consistently return `false`, provided no information used in `equals` comparisons on the objects is modified.
> - For any non-null reference value `x`, `x.equals(null)` should return `false`.

Every word is doing work:

- **"equivalence relation"** is the mathematical noun: a binary relation that is reflexive, symmetric, and transitive. The Javadoc adds consistency and non-null on top to handle Java's reference and mutability semantics.
- **"should return"** — not "must". The Javadoc is permissive in tone; in practice, the JDK collection framework treats these as *must*, and breaking them produces silent collection corruption rather than `IllegalStateException`.
- **"non-null reference values"** — the contract is *defined* over non-null references. The fifth clause covers null explicitly.
- **"provided no information used in `equals` comparisons on the objects is modified"** — this is the consistency carve-out that *permits* mutable fields in `equals` *if you also promise not to mutate them after putting the object in a collection*. In practice, this is a contract you cannot enforce, so the senior rule is "don't put mutable fields in `equals`".

The default implementation, from the same Javadoc:

> The `equals` method for class `Object` implements the most discriminating possible equivalence relation on objects; that is, for any non-null reference values `x` and `y`, this method returns `true` if and only if `x` and `y` refer to the same object (`x == y` has the value `true`).

This is identity equality. It satisfies all five clauses vacuously: a reference is equal only to itself.

---

## 3. The `hashCode` contract verbatim — `Object.hashCode()`

The Javadoc text:

> The general contract of `hashCode` is:
> - Whenever it is invoked on the same object more than once during an execution of a Java application, the `hashCode` method must consistently return the same integer, provided no information used in `equals` comparisons on the object is modified. This integer need not remain consistent from one execution of an application to another execution of the same application.
> - If two objects are equal according to the `equals(Object)` method, then calling the `hashCode` method on each of the two objects must produce the same integer result.
> - It is *not* required that if two objects are unequal according to the `equals(Object)` method, then calling the `hashCode` method on each of the two objects must produce distinct integer results. However, the programmer should be aware that producing distinct integer results for unequal objects may improve the performance of hash tables.

Two consequences:

- **Hashes may change across JVM runs.** A hash code from yesterday's process is not portable to today's. Don't serialise hash codes; don't store them in databases; don't expect a constant value.
- **Equal objects must hash the same; unequal objects may collide.** The asymmetry of the rule is the entire reason `HashMap` works — collisions are expected, the bucket logic walks them.

The default implementation:

> As far as is reasonably practical, the `hashCode` method defined by class `Object` returns distinct integers for distinct objects. This is typically implemented by converting the internal address of the object into an integer, but this implementation technique is not required by the Java™ programming language.

In HotSpot, the default `hashCode` is computed once on first use, stashed in the object header's mark word, and reused on subsequent calls. The bit-layout is documented in `markWord.hpp`; the algorithm has been Marsaglia's xor-shift for a long time. The takeaway: **the default `hashCode` is identity-based and stable for the object's lifetime**, but it is not the field-based hash you need for value classes.

`System.identityHashCode(Object)` returns exactly this default-implementation value, even for objects that have overridden `hashCode`. It is what `IdentityHashMap` keys on.

---

## 4. The `toString` convention — `Object.toString()`

The Javadoc text:

> Returns a string representation of the object. In general, the `toString` method returns a string that "textually represents" this object. The result should be a concise but informative representation that is easy for a person to read. It is recommended that all subclasses override this method.

This is recommendation, not contract. The default implementation:

```java
public String toString() {
    return getClass().getName() + "@" + Integer.toHexString(hashCode());
}
```

`Customer@7b3f8a2c`. Unhelpful in logs. The Javadoc recommends overriding *for every class*. The team policy in [./professional.md](./professional.md) section 8 expands the convention to include redaction rules — none of which the spec mandates.

---

## 5. `java.util.Objects` — the contract-friendly toolkit

`java.util.Objects` was added in Java 7 (JEP 142 work) and expanded since. The methods that matter for equality contracts:

```java
// Null-safe equals — handles null on either side, returns false if exactly one is null.
public static boolean equals(Object a, Object b) {
    return (a == b) || (a != null && a.equals(b));
}

// Null-safe hashCode — returns 0 if the argument is null.
public static int hashCode(Object o) {
    return o != null ? o.hashCode() : 0;
}

// Combine multiple field hashes — uses Arrays.hashCode internally.
public static int hash(Object... values) {
    return Arrays.hashCode(values);
}

// Null-safe toString with a default.
public static String toString(Object o, String nullDefault) {
    return o != null ? o.toString() : nullDefault;
}

// Null guard — throws NullPointerException with an optional message.
public static <T> T requireNonNull(T obj, String message) {
    if (obj == null) throw new NullPointerException(message);
    return obj;
}
```

Two design notes:

- **`Objects.hash` allocates an `Object[]` for the varargs call** and boxes primitives. For a single field, prefer `Objects.hashCode(field)`. For records, the compiler generates code that avoids the varargs allocation — that is one of the reasons records can be faster than IDE-generated `hashCode` in tight loops. See [./optimize.md](./optimize.md).
- **`Objects.equals` opens with `(a == b)`** — covers two cases at once: both null, or same reference. After that, it delegates to `a.equals(b)` only when `a` is non-null.

The class is `final` and has a private constructor — it is a utility class in the JDK sense. Static-import its methods (`import static java.util.Objects.*`) only if the team agrees; otherwise the `Objects.` prefix is the clearer style.

---

## 6. Records — JLS §8.10 and JEP 395

JLS §8.10 defines record classes. The key normative points:

- A record is **implicitly `final`** (§8.10.1). It cannot be extended.
- A record's components are **implicitly `final` private fields** (§8.10.3) plus a public accessor method for each.
- The compiler generates a **canonical constructor** matching the components.
- The compiler generates `equals(Object)`, `hashCode()`, and `toString()` based on *all* components (§8.10.3) unless you provide your own override.

The generated `equals` is approximately:

```java
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof MyRecord)) return false;
    MyRecord that = (MyRecord) o;
    return Objects.equals(this.field1, that.field1)
        && Objects.equals(this.field2, that.field2)
        && /* ... */;
    // For primitive fields, `==` is used directly (Float/Double use Float.compare).
}
```

Generated `hashCode`:

```java
public int hashCode() {
    int h = 0;
    h = 31 * h + Objects.hashCode(field1);
    h = 31 * h + Objects.hashCode(field2);
    // For primitives, the boxed hash is computed directly.
    return h;
}
```

(The exact bytecode uses `invokedynamic` with a `java.lang.runtime.ObjectMethods.bootstrap` call site, which generates an efficient implementation at link time. JEP 395 specifies the strategy without specifying the bytecode.)

Generated `toString`:

```java
public String toString() {
    return "MyRecord[field1=" + field1 + ", field2=" + field2 + "]";
}
```

You may override any of the three. If you override `equals`, you should also override `hashCode` to stay consistent — and the contract clauses still apply, you have just opted out of the auto-generated version.

The JLS prohibits explicit declaration of instance fields (§8.10.3) — a record's state is *exactly* its components. This is the structural fact that makes the auto-generated `equals` correct: there are no hidden fields to forget.

---

## 7. Pattern matching for `instanceof` — JEP 394 and JLS §14.30.1

The pattern variable form (final in Java 16):

```java
if (o instanceof Money m) {
    // m is in scope here, typed as Money
}
```

JLS §14.30.1 specifies the *pattern matching* form of `instanceof`. Semantically equivalent to:

```java
if (o instanceof Money) {
    Money m = (Money) o;
    /* ... */
}
```

But shorter, type-checked, and the binding `m` is *definitely assigned* only inside the `true` branch — the compiler refuses code that uses `m` in the `false` branch.

The bytecode-level instruction is still `instanceof` (JVMS §6.5.instanceof), which returns 0 or 1. The pattern-variable form emits the same `instanceof` plus a `checkcast` (which the verifier proves redundant) into the `true` branch. The runtime cost is the same as the classical form; the source-level safety is higher.

JLS §15.20.2 — *Type Comparison Operator instanceof* — defines the null case: **`null instanceof T` is always `false`, for every reference type `T`.** This is what makes `if (!(o instanceof Money m)) return false;` a null-safe one-liner. The earlier defensive pattern (`if (o == null) return false; if (!(o instanceof Money)) return false;`) is redundant because of this rule.

---

## 8. Sealed types — JLS §8.1.1.2 and JEP 409

Sealed classes (final in Java 17) close a type hierarchy at compile time:

```java
public sealed interface Shape permits Circle, Square, Triangle {}

public record Circle(double r)            implements Shape {}
public record Square(double s)            implements Shape {}
public record Triangle(double b, double h) implements Shape {}
```

The JLS §8.1.1.2 / §9.1.1.4 rules:

- A `sealed` type declares its permitted direct subtypes with `permits ...`.
- Each permitted subtype must be `final`, `sealed` (with its own `permits`), or `non-sealed`.
- The permitted set is checked by `javac` and recorded in the class file as a `PermittedSubclasses` attribute.
- A pattern-match `switch` over a sealed type is *exhaustive*: omitting any permitted subtype is a compile error.

For equality, the combination of *records implementing a sealed interface* produces a hierarchy where:

- Each leaf is `final` — no inheritance-based equality bugs possible.
- Components are `final` — no mutable-equality bugs possible.
- The compiler-generated `equals` per leaf is *strict*: a `Circle` is never equal to a `Square`, even with matching radius/side.
- The `permits` clause documents the full set of equality cases that will ever exist.

This idiom — sealed interface over records — is the modern equivalent of the senior-level `instanceof` vs `getClass()` debate. It dissolves both sides: each record's `equals` uses `instanceof` (vacuously, because the class is `final` and only one runtime type satisfies it), and the parent type cannot have its own `equals` body to make a cross-class comparison.

---

## 9. `String.hashCode()` — the canonical algorithm

`String.hashCode` is specified by the JDK Javadoc as:

> Returns a hash code for this string. The hash code for a `String` object is computed as
>
>     s[0]*31^(n-1) + s[1]*31^(n-2) + ... + s[n-1]
>
> using `int` arithmetic, where `s[i]` is the `i`th character of the string, `n` is the length of the string, and `^` indicates exponentiation. (The hash value of the empty string is zero.)

This is the *exact* formula. The "Bloch recipe" of `result = 31 * result + field.hashCode()` is the same arithmetic generalised to multiple fields. The constant 31 was chosen for arithmetic-encoding reasons (`31 * x == (x << 5) - x`) and because it is prime; the JDK has held to it for `String.hashCode` since Java 1.0, and `Objects.hash` uses the same multiplier internally.

Modern HotSpot intrinsifies `String.hashCode` with a SIMD-vectorised loop on x86-64 and AArch64; the formula is the spec, the implementation is much faster than a naive loop suggests. For your own hash codes via `Objects.hash`, the JIT will not vectorise but will inline the call.

---

## 10. `Comparable` consistency — `java.lang.Comparable` Javadoc

The `Comparable` Javadoc adds a *strong recommendation* (not a requirement):

> It is strongly recommended (though not required) that natural orderings be consistent with `equals`. This is so because sorted sets (and sorted maps) without explicit comparators behave "strangely" when they are used with elements (or keys) whose natural ordering is inconsistent with `equals`. In particular, such a sorted set (or sorted map) violates the general contract for set (or map), which is defined in terms of the `equals` method.

A class is *consistent with `equals`* if and only if `e1.compareTo(e2) == 0` has the same boolean value as `e1.equals(e2)`. The classic inconsistent type is `BigDecimal`:

```java
new BigDecimal("1.0").equals(new BigDecimal("1.00"));      // false
new BigDecimal("1.0").compareTo(new BigDecimal("1.00"));   // 0
```

`HashMap` uses `equals`; `TreeMap` uses `compareTo`. The same key behaves differently in the two collections. The Javadoc warns about this *by name* in the `BigDecimal` class documentation. For your own `Comparable` types, keep them consistent or accept the consequences.

---

## 11. JEP references and equality

| JEP            | Feature                                          | What it changes for equality contracts                            |
|----------------|--------------------------------------------------|-------------------------------------------------------------------|
| JEP 395        | Records (final in Java 16)                       | Auto-generates `equals`/`hashCode`/`toString` from components.    |
| JEP 394        | Pattern matching for `instanceof` (final, Java 16) | `o instanceof Money m` form for null-safe, typed equality bodies. |
| JEP 397, 409   | Sealed classes (preview → final in Java 17)      | Closed hierarchies; combined with records, removes inheritance/equality clash. |
| JEP 406, 420, 427, 441 | Pattern matching for `switch` (preview → final) | Exhaustive `switch` over sealed types — every equality case checked. |
| JEP 286        | Local-variable type inference (`var`)            | Encourages naming the type in the declaration; the `equals` body unaffected. |
| JEP 261        | Java Platform Module System                      | Equality across module boundaries; `ServiceLoader` cross-classloader implications. |
| JEP 401 (preview) | Value classes                                 | Future: identity-free value types — equality is *only* by content, no headers, no proxy issues. |

The trajectory is clear: each Java version moves equality contracts further into the type system. Records (16) handle the recipe; pattern `instanceof` (16) handles the type guard; sealed types (17) close the hierarchy; pattern `switch` (21) makes exhaustive dispatch over equality cases ergonomic; value classes (Valhalla, future) will collapse the identity-vs-content distinction.

---

## 12. The bytecode behind `instanceof` and `equals`

The `instanceof` instruction (JVMS §6.5.instanceof):

```
aload_1               ; load reference on stack
instanceof #2         ; #2 is the constant pool index of class Money
ifeq L_false          ; if the result is 0, jump to false branch
```

The verifier proves that the operand stack at every program point has compatible types. After a successful `instanceof` check followed by a `checkcast`, the verifier accepts a `Money` reference in the slot that previously held an `Object`.

The pattern-variable form `if (o instanceof Money m) { ... m.amount() ... }` compiles to:

```
aload_1
instanceof #2
ifeq L_false
aload_1
checkcast #2          ; checkcast is redundant — verifier could prove it, but javac emits it
astore_2              ; store as `m`
; ... use `m` ...
```

Modern javac (Java 21+) may elide the `checkcast` when the verifier accepts the proof; older versions emit it always. Either way, the runtime cost is *one* `instanceof` plus *at most one* `checkcast` per pattern match — both extremely cheap, both inlined by C2.

`invokevirtual` (JVMS §6.5.invokevirtual) is what invokes `equals` and `hashCode` on a reference. It looks up the method on the runtime class via the vtable. Because `Object.equals` and `Object.hashCode` are inherited, *every* call to them on *every* object goes through `invokevirtual` — and is therefore polymorphic. This is what makes `set.contains(x)` find the right `equals` body even when the set holds `Object` references.

---

## 13. Reading list

1. **`java.lang.Object` Javadoc** — the spec for `equals`, `hashCode`, `toString`. Read it once; reread when in doubt.
2. **`java.util.Objects` Javadoc** — the toolkit for null-safe contracts.
3. **JLS §8.10** — records.
4. **JLS §14.30.1** — pattern matching for `instanceof`.
5. **JLS §8.1.1.2 / §9.1.1.4** — sealed classes and interfaces.
6. **JEP 395** — records, including the rationale for `equals`/`hashCode` auto-generation.
7. **JEP 394** — pattern matching for `instanceof`.
8. **JEP 409** — sealed classes (final).
9. **Joshua Bloch — *Effective Java*, 3rd ed.** — Items 10 (`equals`), 11 (`hashCode`), 12 (`toString`), 14 (`compareTo`). The canonical treatment.
10. **Jan Ouwens — EqualsVerifier documentation** — every clause covered with examples of how to fail it.
11. **`Comparable` Javadoc** — the *consistent with `equals`* note that bites `BigDecimal` users.
12. **`String.hashCode()` Javadoc** — the canonical hash algorithm.

The spec sections do not *teach* equality — they give you the language to say "this code violates the symmetric clause of `Object.equals`'s contract" rather than "this code is wrong". When a coworker pushes back, you cite the Javadoc paragraph. When a reviewer asks "why does this matter?", you point at the JDK collection class that assumes the contract. The contract is judgement; the spec gives you the levers.
