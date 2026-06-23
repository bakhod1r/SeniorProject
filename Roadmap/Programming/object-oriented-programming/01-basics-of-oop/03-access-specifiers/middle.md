# Access Specifiers — Middle

> **Why?** Access modifiers are how a class advertises its **contract surface**. Every `public` member is a promise; every `private` member is reserved for refactoring. The narrower you can make the surface, the more freedom you keep to change implementation later without breaking callers.
> **When?** Pick access *deliberately* per declaration: ask "who needs to call this?" and grant exactly that level — never broader. Default to `private` and widen only with cause.

---

## 1. Encapsulation as a maintenance tool

The textbook reason for access control is "data hiding." The *real* reason is much simpler: the narrower your public surface, the less code you can break.

When you change a `public` method's signature, every caller in the world has to change. When you change a `private` method, nobody outside this class even notices.

Concretely, a class with:

- 30 `public` methods → 30 contracts. Renaming any one is a breaking change.
- 30 `private` methods → 30 implementations. Restructure freely; no caller cares.

Access modifiers convert "an API change is a breaking change" into "an implementation change is just a commit." Use them aggressively.

---

## 2. The "tightest possible" rule

For every declaration, ask:

1. Does anything outside this *class* need to see it? If no → `private`.
2. Does anything outside this *package* need to see it? If no → package-private.
3. Does anything outside the inheritance hierarchy need to see it? If no → `protected`.
4. Does anything outside the *world* need to see it? Only then → `public`.

Most fields are at step 1. Most internal helpers stop at step 2. Most domain classes' methods either stay at step 2 or go straight to step 4.

The intermediate level — `protected` — is the most often *misused*. Read on.

---

## 3. Why `protected` is rarely the right answer

`protected` means "same package + subclasses (anywhere)." That's a curious union. In practice, it's right when:

- You're building a **template method** base class with hooks subclasses must implement (`AbstractList.removeRange`, `Reader.fillBuffer`).
- Your library has a known extension point and the documented way to extend it is by subclassing.

It's *wrong* when:

- You just want "package access" — use package-private (no keyword) instead. `protected` exposes the member to the entire world (any class anywhere can subclass and access it).
- You want "package access for me and my friends" — Java has no friend mechanism; the closest is package-private.
- You're using inheritance for code reuse, not subtype substitution. Replace with composition; access modifiers come along automatically.

A `protected` field is especially questionable. It exposes mutable state across an inheritance boundary, and subclasses outside your package can mutate it however they like — bypassing any invariant the base class might enforce.

---

## 4. Field access: nearly always `private`

Three reasons:

**(a)** **Invariants.** Once a field is non-`private`, you can't enforce that "balance is never negative" — anyone with the access can write `account.balance = -1000`.

**(b)** **Future flexibility.** A `private` field can change type, be removed, or be replaced by a computed accessor without touching any caller.

**(c)** **Concurrency control.** Cross-thread visibility (`volatile`, `synchronized`) is meaningful only for internal access. Once external code can read/write directly, you can't reason about ordering.

The exception: `public static final` *constants* (primitives or interned strings) are fine. They are *truly* immutable, the JVM may inline them at compile time, and exposing them is part of the API.

```java
public static final int  MAX_RETRIES = 5;          // ✓ — constant, primitive
public static final String DEFAULT_HOST = "localhost";  // ✓ — interned string

public static final List<String> ALLOWED_HOSTS = List.of(...);  // ⚠ — fine if truly never changed
public static final int[] PRIMES = {2, 3, 5, 7};      // ❌ — array is mutable, callers can write
```

For the array case, expose a method or use `List.of(...)`.

---

## 5. Method access: by *role*, not by reflex

Decide method access by its *role*:

- **API method**: callers outside the class will call it → `public`.
- **Subclass hook**: subclasses must implement / may override → `protected` (and only inside a class designed for inheritance).
- **Internal helper**: only this class needs it → `private`.
- **Package-internal collaborator**: only same-package classes call it → package-private.

The biggest mistake at this level is to mark every method `public` "for testing." See §11 — there are better ways.

---

## 6. Constructor access controls *who can create*

A `public` constructor: anyone can `new` your class.

A `private` constructor + static factory methods: you control instance creation.

A `private` constructor + no factories: nobody can instantiate. Useful for utility classes (all `static` members):

```java
public final class Strings {
    private Strings() {                       // prevent instantiation
        throw new AssertionError();           // also defends against reflection
    }

    public static String reverse(String s) { ... }
    public static int    countVowels(String s) { ... }
}
```

A package-private constructor: same-package code can create freely; outsiders can't. Common for sealed-by-convention class trees before Java 17 sealed classes.

A `protected` constructor: only subclasses + same-package can construct. Common for `abstract` base classes.

Constructor access is a quiet but critical lever. It governs the *whole lifecycle* of your class — once instances exist, they exist; controlling who can call `new` is half the encapsulation story.

---

## 7. Nested classes: each piece has its own access

A nested class has its own access modifier independent of the outer class:

```java
public class Outer {
    public  static class Public  { }    // exposed
    static  class PackagePrivate { }    // exposed within package
    private static class Private { }    // visible only inside Outer
}
```

Inner classes (non-static nested) get an implicit reference to the enclosing instance. Their visibility rules are the same — but watch for memory leaks (an inner instance keeps the outer alive).

A common pattern: builders as `public static` nested classes:

```java
public final class HttpRequest {
    private HttpRequest(Builder b) { ... }

    public static Builder newBuilder() { return new Builder(); }

    public static final class Builder {
        public Builder uri(URI uri)        { ... }
        public Builder header(String, String) { ... }
        public HttpRequest build()         { return new HttpRequest(this); }
    }
}
```

`HttpRequest`'s constructor is `private`; `Builder` is `public static`; `Builder`'s constructor is package-private (only `HttpRequest.newBuilder` can call it).

---

## 8. Test access — without weakening production access

A common but *wrong* pattern: making things `public` (or removing `private`) "for tests."

The *right* options:

**(a) Test in the same package.** Place your test class in the same package as the production class:

```
src/main/java/com/example/Order.java         (package-private hooks)
src/test/java/com/example/OrderTest.java     (same package — sees package-private)
```

This is the standard Maven / Gradle layout. Your tests reach package-private members; outsiders don't.

**(b) Use `@VisibleForTesting`** (Guava, Error Prone, AssertJ). It marks a method as deliberately broader-than-needed for testability, and Error Prone enforces "only test code calls it."

**(c) Test through the public surface.** If a piece of logic is hard to test through public methods, it's often a sign of a missing abstraction — extract a class with its own (more easily testable) public surface.

The goal: your test code mirrors the *trust boundary* of your production code, not weakens it.

---

## 9. Java 9+ modules: a new outermost level

Before Java 9: `public` meant "anywhere on the classpath."

Since Java 9 (JPMS — Java Platform Module System): `public` means "anywhere within this module — and only outside it if the package is **exported**."

```java
// module-info.java
module com.example.banking {
    exports com.example.banking;          // public types here are visible outside
    // not exporting com.example.banking.internal — even public types stay invisible
}
```

So a `public class` in a non-exported package is visible only within the same module. This is "strong encapsulation" — and the JDK itself uses it to hide internals (`sun.misc.*`, etc.) that used to be reachable.

Practically:

- Library authors should split into `api` (exported) and `internal` (not exported) packages.
- Application code typically lives in a single module that exports everything.
- `requires` declarations make module dependencies explicit.

Modules add a layer above package-private: even `public` types can be hidden from outside callers if their package isn't exported. Use this for libraries that publish a stable API.

---

## 10. Reflection respects access — by default

```java
Field f = MyClass.class.getDeclaredField("balance");
f.get(account);                           // throws IllegalAccessException
f.setAccessible(true);                    // bypass the check
f.get(account);                           // ✓
```

`setAccessible(true)` lets reflection ignore access control. This is how serialization, ORM, and DI frameworks read `private` fields.

Java 9+ tightens this for *modules*: cross-module reflective access requires the package to be `opens`-ed in `module-info.java`. Without `opens`, even `setAccessible(true)` fails.

```java
module com.example.app {
    requires com.fasterxml.jackson.databind;
    opens com.example.app to com.fasterxml.jackson.databind;
}
```

Modern frameworks declare what they need; you grant it explicitly.

For your own classes, treat `setAccessible(true)` as a "trusted superuser" mechanism. Don't design APIs that depend on it.

---

## 11. The `sealed` modifier extends access control

Java 17+ introduced `sealed` and `non-sealed`. They constrain *which classes can extend* a base type:

```java
public sealed interface Result permits Ok, Err {}
public record Ok(Object value)  implements Result {}
public record Err(String error) implements Result {}
```

- `sealed` means "only the listed classes can implement/extend this."
- `non-sealed` means "this branch is open again" (subclasses of a sealed parent can opt in to allowing further extension).

This is access control over *extension*, not over read/write. Combined with pattern matching, it lets the compiler enforce exhaustiveness — adding a new permitted subtype forces you to update every `switch`.

---

## 12. The "interface" question: do you need access modifiers on interface members?

Interface members have implicit access:

- Methods: `public abstract` (or `public default`/`public static`).
- Fields: `public static final`.
- Nested types: `public static`.

So `private` makes sense only for `private` methods (helpers used by `default` methods, since Java 9):

```java
public interface Parser {
    default int parseInt(String s) { return parseSigned(s, 1); }
    default int parseNeg(String s) { return parseSigned(s, -1); }
    private  int parseSigned(String s, int sign) { ... }       // shared helper, hidden
}
```

`protected` is illegal in interfaces. Package-private is also illegal — interface members are `public` by definition (the only narrower options are `private` for helpers, since 9).

---

## 13. Visibility and the package layout

A common antipattern: every class lives in its own package. Then *everything* must be `public` to communicate.

A better layout: group cooperating classes in the same package and rely on package-private visibility. The package becomes a *unit of encapsulation*:

```
com.example.payment/
├── PaymentService.java       (public — entry point)
├── PaymentProcessor.java     (package-private — internal)
├── RetryPolicy.java          (package-private)
└── TransactionLog.java       (package-private)
```

External code sees only `PaymentService`. Inside the package, everything collaborates freely. This is how the JDK organizes most APIs.

---

## 14. The middle-level checklist

For each declaration:

1. Could this be `private`? If yes → make it `private`.
2. If not, could this be package-private? If yes → no keyword.
3. If not, is this part of an inheritance contract that subclasses *must* see? If yes → `protected` (and document the contract).
4. Else → `public`. And know that you've now committed to a long-term contract.

Then for the package as a whole:

5. Are cooperating classes co-located in one package?
6. Is the package's public surface minimal — most types package-private, only the entry-points public?
7. If you're shipping a library, are you using JPMS modules (or at least documenting "internal" subpackages)?

---

## 15. The right way to think about access

Access modifiers are *promises about the future*:

- `private`: "I will probably refactor this. Don't depend on it."
- Package-private: "Only the package's authors should care."
- `protected`: "This is the official extension point."
- `public`: "I commit to keeping this stable."

Every member you declare is a future-self contract. The narrower the access, the less you'll have to apologize for later. Reach for the narrowest level that lets the code work, and revisit only when there's a concrete callable pulling you wider.
