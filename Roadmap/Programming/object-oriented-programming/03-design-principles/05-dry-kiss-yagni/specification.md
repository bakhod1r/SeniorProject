# DRY, KISS, YAGNI — Specification Reading Guide

> DRY, KISS, and YAGNI are *design heuristics*; none appears in the JLS or JVMS. But the spec provides the *features* that make minimalism cheap: records (§8.10), `final` classes (§8.1.1.2), sealed types (§8.1.1.2), `var` for local-variable type inference (§14.4.2), method references (§15.13), default methods (§9.4.3), and pattern matching for `switch` (§14.11). This file maps each heuristic to the binding spec text that lets you write minimum-viable Java without sacrificing safety.

---

## 1. Where to find the canonical text

| Concept                                       | Authoritative source                              |
|-----------------------------------------------|---------------------------------------------------|
| Class modifiers (`final`, `sealed`, `abstract`) | **JLS §8.1.1**                                  |
| Constructors                                  | JLS §8.8                                          |
| `final` fields                                | JLS §8.3.1.3                                      |
| Records                                       | **JLS §8.10** (JEP 395)                          |
| Sealed types                                  | JLS §8.1.1.2, §9.1.1.4 (JEP 409)                  |
| Default methods                               | JLS §9.4.3                                        |
| Interface declarations                        | JLS §9                                            |
| `var` local-variable type inference           | **JLS §14.4** (JEP 286)                           |
| Method references                             | JLS §15.13 (JEP 126)                              |
| Lambda expressions                            | JLS §15.27 (JEP 126)                              |
| Pattern matching for `switch`                 | **JLS §14.11**, §15.28 (JEP 406, JEP 441)         |
| `instanceof` pattern matching                 | JLS §14.30.2 (JEP 394)                            |
| Text blocks                                   | JLS §3.10.6 (JEP 378)                             |
| `try-with-resources`                          | JLS §14.20.3                                      |
| `enhanced for` loop                           | JLS §14.14.2                                      |

These features collectively let Java code be small and direct without losing type safety or readability.

---

## 2. Records (JLS §8.10) — DRY for value carriers

A record reduces a value class to one line:

```java
public record Address(String street, String city, String zip) { }
```

JLS §8.10 specifies what `javac` generates automatically:

- Private final fields per component.
- Public accessor methods.
- Implicit canonical constructor.
- `equals`, `hashCode`, `toString` from the components.
- Implicit `final` class.

This is *real* DRY at the language level: the *piece of knowledge* "an address has these three components" lives in one place. The compiler generates the boilerplate. Changing the components is one edit; every derived behaviour updates.

Compare with the pre-record DRY violation:

```java
public final class Address {
    private final String street, city, zip;
    public Address(String street, String city, String zip) {
        this.street = street; this.city = city; this.zip = zip;
    }
    public String street() { return street; }
    public String city() { return city; }
    public String zip() { return zip; }
    @Override public boolean equals(Object o) { /* 8 lines */ }
    @Override public int hashCode()           { /* 1 line */ }
    @Override public String toString()        { /* 1 line */ }
}
```

The same knowledge expressed in 12 lines instead of 1, with three places it could drift (constructor, accessors, `equals`).

---

## 3. `var` (JLS §14.4 / JEP 286) — KISS at the local scope

Local-variable type inference removes redundant type declarations:

```java
// Pre-Java 10
List<Map<String, Set<Order>>> ordersByCustomer = new HashMap<>();

// Java 10+
var ordersByCustomer = new HashMap<String, Set<Order>>();
```

JLS §14.4.2: the compiler infers the type from the initializer; the inferred type is the *static* type of the variable. No runtime cost.

`var` doesn't reduce DRY in the design sense — it removes *syntactic* redundancy at the local scope. The KISS benefit is real: shorter, more readable code without sacrificing static typing.

Use it for *local* type clarity. Don't use it where the type is non-obvious from context (`var x = method()` when `method()`'s return type isn't apparent at the call site).

---

## 4. Method references and lambdas (JLS §15.13, §15.27) — eliminate small wrappers

Lambdas (JEP 126) replace anonymous inner classes for single-method interfaces. Method references go further: when the lambda body is just a call, the reference itself names it.

```java
// Verbose
list.stream().map(o -> o.id()).toList();

// Method reference
list.stream().map(Order::id).toList();
```

The method reference *is* the function value; no wrapper class is needed. JLS §15.13 specifies how `Order::id` resolves to a callable matching `Function<Order, OrderId>`.

For DRY: lambdas eliminate the *small adapter wrapper* — instead of writing `class IdExtractor implements Function<Order, OrderId> { public OrderId apply(Order o) { return o.id(); } }`, you write `Order::id`. The knowledge ("extract id") lives at the call site, expressed minimally.

For KISS: at the call site, the method reference is more direct than a class declaration. The wrapper class is the over-engineering YAGNI strips.

---

## 5. Pattern matching for `switch` (JLS §14.11, §15.28) — KISS for ADTs

Sealed types plus pattern-matching switch (JEP 406, 441) collapse the dispatch ceremony:

```java
public sealed interface Result<T> permits Success, Failure { }
public record Success<T>(T value)        implements Result<T> { }
public record Failure<T>(Throwable cause) implements Result<T> { }

public static <T> Optional<T> recover(Result<T> r) {
    return switch (r) {
        case Success<T> s -> Optional.of(s.value());
        case Failure<T> f -> Optional.empty();
    };
}
```

JLS §14.11 specifies *exhaustiveness*: when the switch's selector is a sealed type, the compiler verifies every permitted case is handled. Add a third variant to `Result`, and the switch fails to compile until you add the case.

For YAGNI: you don't add a fourth variant "for the future"; you add it when needed, and the compiler reminds every switch to handle it. The minimal shape stays minimal until requirements grow.

For DRY: the *dispatch logic* is centralized in one switch per consumer; the *type information* is centralized in the sealed declaration. Two pieces of knowledge, two places.

For KISS: no `Visitor` pattern, no `if/else` chains on `instanceof`, no enum-with-switch ceremony. Just `case Success<T> s -> ...`.

---

## 6. Text blocks (JLS §3.10.6 / JEP 378) — KISS for multiline strings

Text blocks let you write multiline strings without escape soup:

```java
// Pre-Java 15
String json = "{\n" +
              "  \"id\": " + id + ",\n" +
              "  \"name\": \"" + name + "\"\n" +
              "}";

// Java 15+
String json = """
        {
          "id": %d,
          "name": "%s"
        }""".formatted(id, name);
```

JLS §3.10.6: the text block preserves whitespace and line breaks naturally. No `\n`, no escape doubling, no concatenation.

KISS at the syntactic level. The pre-block version is "simple" in line count but cognitively expensive to parse; the block version is direct.

---

## 7. `try-with-resources` (JLS §14.20.3) — KISS for cleanup

```java
// Pre-Java 7 — manual cleanup
Connection conn = null;
try {
    conn = DriverManager.getConnection(url);
    conn.prepareStatement(...).execute();
} finally {
    if (conn != null) conn.close();
}

// Java 7+
try (Connection conn = DriverManager.getConnection(url)) {
    conn.prepareStatement(...).execute();
}
```

JLS §14.20.3 generates the `finally` and the null check automatically. The resource implements `AutoCloseable`; the runtime calls `close()` correctly even on exception.

KISS at the structural level. The boilerplate is gone; the intent is visible.

---

## 8. Sealed types (JLS §8.1.1.2) — YAGNI for inheritance

Sealed types (JEP 409) let you declare the *exact* set of subtypes:

```java
public sealed interface PaymentMethod permits Card, Bank, Crypto { }
```

YAGNI relevance: the spec lets you start with `permits Card` only — one subtype, today's need — and add more later. The compiler doesn't force you to "design for unknown future variants". Adding `Bank` later is a deliberate change to `permits`, plus updates to every `switch`.

This is YAGNI made enforceable: you don't pre-build a plugin registry; you declare the closed set you need now, and grow it as requirements demand.

---

## 9. `final` (JLS §8.1.1.2, §8.4.3.4) — YAGNI for extension

Marking a class `final` says: *no subclass exists, none planned*. Joshua Bloch's *Effective Java* item 19: design and document for inheritance, or prohibit it.

```java
public final class OrderService { /* no one can extend */ }
```

YAGNI-aligned: you don't add `extends` ability "in case someone needs to subclass". When that someone arrives, they make the case, and you either redesign the class as extension-friendly or refuse and offer composition.

The JIT loves `final` (CHA-inlines aggressively); the design benefits even more (no fragile-base risk).

---

## 10. Default methods (JLS §9.4.3) — DRY for interface evolution

Default methods let an interface carry an implementation:

```java
public interface Sized {
    int size();
    default boolean isEmpty() { return size() == 0; }
}
```

DRY relevance: every implementor inherits `isEmpty()` without copying. The *knowledge* ("a Sized is empty when its size is zero") lives on the interface — one source of truth.

Use defaults sparingly:

- For *convenience methods* over a primitive abstract method (`isEmpty` over `size`).
- For *evolving an existing interface* without breaking implementors.

Don't use defaults for *substantial behaviour* — that's inheritance for code reuse, fragile across implementations.

---

## 11. JEP references

| JEP            | Feature                              | Slogan relevance                         |
|----------------|--------------------------------------|------------------------------------------|
| JEP 395        | Records                              | DRY for value classes                     |
| JEP 409        | Sealed classes                       | YAGNI for inheritance                     |
| JEP 286        | `var`                                | KISS at local scope                       |
| JEP 126        | Lambda expressions, method references | KISS via function values                 |
| JEP 378        | Text blocks                          | KISS for multiline strings                |
| JEP 213        | Try-with-resources                   | KISS for cleanup                          |
| JEP 406, 441   | Pattern matching for `switch`        | KISS for ADT dispatch                     |
| JEP 394        | Pattern matching for `instanceof`    | KISS for type checks                      |
| JEP 261        | Module system                        | YAGNI for cross-module coupling           |

Modern Java's evolution actively supports the three slogans: less boilerplate, less speculation, more direct expression.

---

## 12. Reading list

1. **JLS §8.10** — Records.
2. **JLS §8.1.1.2** — Class modifiers (`final`, `sealed`).
3. **JLS §9.4.3** — Default methods.
4. **JLS §14.4** — `var`.
5. **JLS §14.11** — Pattern matching for `switch`.
6. **JLS §15.13, §15.27** — Method references, lambdas.
7. **JEP 286, 395, 409, 441** — the high-impact modernization JEPs.
8. **Andy Hunt & Dave Thomas** — *The Pragmatic Programmer*, 1999. The original DRY treatment.
9. **Kent Beck** — *Extreme Programming Explained*, 1999. The original YAGNI treatment.
10. **Kelly Johnson** — "KISS" attributed to him from Skunk Works aircraft design (1960s); the phrase predates software.
11. **Sandi Metz** — *Practical Object-Oriented Design in Ruby*, 2012. "Duplication is far cheaper than the wrong abstraction" — the canonical mid-sentence on DRY misuse.
12. **Joshua Bloch** — *Effective Java*, 3rd ed., items 17 (minimize mutability), 19 (design for inheritance or prohibit it), 36 (use enums instead of int constants). Each is a DRY/KISS/YAGNI application.

The spec doesn't *teach* the slogans — it gives you the syntax that makes minimalism cheap. When a reviewer says "this is over-engineered", you reach for records, sealed types, `var`, `switch` patterns — the features that let you say more with less. The shape that compiles smaller is usually the shape that lives longer.
