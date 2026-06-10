# Method Chaining — Middle

> **What?** The patterns that turn chaining into reliable, well-typed APIs: classic Builder, staged Builder (compile-time enforcement of required fields), fluent DSLs, immutable transformation chains, and the trade-offs of each.
> **How?** By choosing what kind of receiver each method returns: `this`, a new instance, a different state-token type, or a completely different stage of a multi-step DSL.

---

## 1. Classic Builder

```java
public final class HttpRequest {
    private final String url;
    private final String method;
    private final Map<String, String> headers;
    private final byte[] body;

    private HttpRequest(Builder b) {
        this.url = b.url;
        this.method = b.method;
        this.headers = Map.copyOf(b.headers);
        this.body = b.body;
    }

    public static Builder builder(String url) { return new Builder(url); }

    public static class Builder {
        private final String url;
        private String method = "GET";
        private Map<String, String> headers = new LinkedHashMap<>();
        private byte[] body;

        Builder(String url) { this.url = url; }

        public Builder method(String m) { this.method = m; return this; }
        public Builder header(String k, String v) { headers.put(k, v); return this; }
        public Builder body(byte[] b) { this.body = b; return this; }
        public HttpRequest build() { return new HttpRequest(this); }
    }
}

HttpRequest r = HttpRequest.builder("https://api.example.com")
    .method("POST")
    .header("Content-Type", "application/json")
    .body(payload)
    .build();
```

The result is immutable; the builder is throwaway. Most production builders look exactly like this.

---

## 2. Staged Builder

A weakness of the classic builder: nothing forces the caller to set required fields before `build()`. Solution: each step returns a *different type*, exposing only the methods valid at that stage.

```java
public final class Email {
    private Email(String to, String subject, String body) { /* ... */ }

    public static ToStage builder() { return new Steps(); }

    public interface ToStage    { SubjectStage to(String to); }
    public interface SubjectStage { BodyStage subject(String s); }
    public interface BodyStage  { BuildStage body(String b); }
    public interface BuildStage { Email build(); }

    private static class Steps implements ToStage, SubjectStage, BodyStage, BuildStage {
        String to, subject, body;
        public SubjectStage to(String to) { this.to = to; return this; }
        public BodyStage subject(String s) { this.subject = s; return this; }
        public BuildStage body(String b) { this.body = b; return this; }
        public Email build() { return new Email(to, subject, body); }
    }
}

Email e = Email.builder().to("alice@example.com").subject("hi").body("...").build();
```

The compiler now enforces order. Skip any step → won't compile.

Trade-off: each new field requires a new interface stage. Don't use this for builders with 20 fields; use it for highly-typed APIs (e.g., HTTP DSLs).

---

## 3. Fluent DSL

When the chain itself becomes a domain language, you can design types so the API reads almost like English:

```java
Specification<User> spec = where(User::age).greaterThan(18)
    .and(User::country).equalTo("USA")
    .or(User::role).equalTo("admin");
```

Each call is typed for the next allowed call. Used in JOOQ, Spring Data Specifications, jOOQ DSL, kotlinx.serialization, and many query DSLs.

The cost is API design effort: many tiny types per "node" of the grammar.

---

## 4. Self-typing for chainable inheritance

A classic problem: a base class wants to provide chainable methods, but a subclass wants its own chainable methods *and* the inherited ones still typed as the subclass.

```java
class Animal<T extends Animal<T>> {
    protected T self() { return (T) this; }
    public T name(String n) { this.name = n; return self(); }
}

class Dog extends Animal<Dog> {
    public Dog bark() { /* ... */ return this; }
}

new Dog().name("Rex").bark();    // works — name() returns Dog
```

The trick: parametrize the base class with the subclass type. Lombok's `@SuperBuilder` does this automatically.

---

## 5. Functional chaining via immutability

Records, immutable types, and copy-with semantics produce naturally chainable APIs without `return this`:

```java
public record Money(long cents, String currency) {
    public Money plus(Money other) {
        return new Money(this.cents + other.cents, currency);
    }
    public Money times(int factor) {
        return new Money(cents * factor, currency);
    }
}

Money total = wage.times(40).plus(bonus);
```

Each call returns a fresh `Money`. The chain works because each return value is again a `Money`.

---

## 6. Stream-style lazy chains

`Stream<T>` operations are lazy: `filter`, `map`, `flatMap` return new `Stream<T>` configured but not executed. Only the terminal operation (`forEach`, `collect`, `toList`) actually runs.

```java
Stream<User> base = users.stream();
Stream<User> adults = base.filter(u -> u.age() >= 18);
List<String> names = adults.map(User::name).toList();   // executes here
```

Each intermediate stream wraps the previous one. Internally the JVM fuses the operations, often into a single loop.

---

## 7. Method chaining with errors

Two strategies for error-bearing chains:

### A. Optional / Result types
```java
Optional<String> email = findUser(id)
    .map(User::contactInfo)
    .map(ContactInfo::email);
```
Empty propagates through the chain; the caller picks it up at the end.

### B. Throw at end with cumulative context
```java
new RequestValidator(req)
    .nonEmpty(Field::name)
    .matchesEmail(Field::email)
    .lessThan(Field::age, 150)
    .throwIfErrors();
```
The chain accumulates errors internally; the terminal `throwIfErrors()` raises them all at once. Useful for form validation.

---

## 8. Chainable mutators on collections

A common temptation: extending Java collections to support chaining.

```java
class FluentList<E> extends ArrayList<E> {
    public FluentList<E> push(E e) { add(e); return this; }
}
```

Works, but creates a non-standard type that doesn't interop well. Better:

```java
List<Integer> nums = Stream.of(1, 2, 3)
    .map(x -> x * 2)
    .toList();
```

Or use `Collectors.toCollection(...)` if you need a specific collection.

---

## 9. The chained-then-build pattern

A common variant: the builder accumulates state, then `build()` produces the final immutable object. Some teams skip the intermediate `Builder` class and use the target itself as a builder:

```java
class Range {
    int start, end;
    public Range start(int s) { start = s; return this; }
    public Range end(int e) { end = e; return this; }
}

Range r = new Range().start(0).end(10);
```

This works but loses immutability. For shared/long-lived objects, prefer a separate builder.

---

## 10. Chaining and thread safety

Mutating chains are inherently thread-unsafe — the receiver mutates between calls. Don't share builders across threads.

Functional chains are inherently thread-safe — each call returns a new object. The only shared state is the receiver, which the chain reads but doesn't mutate.

---

## 11. Designing chainable APIs — checklist

- [ ] Decide: mutating or functional chain?
- [ ] If mutating: every method returns `this`. The builder is throwaway.
- [ ] If functional: every method returns a new immutable instance.
- [ ] Document any required fields. Use staged builder if order matters.
- [ ] Provide a `build()` or terminal step that returns the "final" type.
- [ ] If errors are possible mid-chain, decide: Optional, Result type, or accumulated throw.
- [ ] Avoid mixing mutation and creation in the same chain.

---

## 12. Common chain anti-patterns

**Anti-pattern: train wreck**

```java
order.getCustomer().getAddress().getCity().getCountry().getCurrency();
```

This violates the Law of Demeter (we'll cover it in *Couplers*). Each intermediate call exposes structural detail. Refactor to delegate:

```java
order.customerCurrency();    // hides the chain
```

**Anti-pattern: side-effects in functional chains**

```java
users.stream()
    .map(u -> { logger.info(u.name()); return u; })   // side effect in map!
    .toList();
```

Functional chains should be pure. Use `peek()` only for debugging, never as production logic.

---

## 13. What's next

| Question                                       | File              |
|------------------------------------------------|-------------------|
| JIT inlining of chains                         | `senior.md`        |
| Bytecode produced by `return this`             | `professional.md`  |
| Designing fluent APIs at scale                  | `interview.md`     |
| Common chain bugs                              | `find-bug.md`      |

---

**Memorize this**: chaining is a return-type contract. Mutating chains return `this`; functional chains return a new instance. Use staged builders for compile-time required-field enforcement. Avoid Demeter violations. Pure chains are thread-safe; mutating chains are not.
