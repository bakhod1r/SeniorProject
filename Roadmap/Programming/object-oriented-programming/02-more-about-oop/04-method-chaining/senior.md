# Method Chaining — Senior

> **What?** The performance characteristics of fluent chains under JIT — how `return this` is essentially free, how stream pipelines fuse into loops, how to design a fluent API that doesn't pessimize the JIT, and when fluent APIs become a maintenance burden.
> **How?** By understanding inline caches, escape analysis, and the way `invokeinterface`/`invokevirtual` chains compose.

---

## 1. `return this` is free

A method whose body is just `field = arg; return this;` is trivially inlined by the JIT. After warmup, a long chain of setters reduces to a sequence of field stores in the caller — same machine code as if you'd written the assignments manually.

```java
public Builder size(String s) { this.size = s; return this; }
```

Compiles to ~5 bytecodes; JIT inlines after warmup; net cost ≈ 1 store. No vtable lookup overhead because the receiver type is known.

---

## 2. Stream fusion

Stream operations form a pipeline:

```java
list.stream().filter(p).map(f).reduce(...)
```

Internally, the JDK's stream impl uses lazy *Spliterator + Sink* pattern. The terminal operation pulls elements through the pipeline. The JIT often fuses the whole chain into a single tight loop.

Key constraint for fusion: keep lambdas non-capturing or stable. Capturing lambdas allocate per stream invocation.

```java
// non-capturing — JIT-friendly, no allocation per stream call
list.stream().filter(s -> !s.isEmpty()).count();

// capturing 'prefix' — allocates a new lambda per call
list.stream().filter(s -> s.startsWith(prefix)).count();
```

The capturing version isn't *slow*, but the lambda object is allocated each invocation.

---

## 3. Escape analysis and chained immutables

```java
Money total = wage.times(40).plus(bonus);
```

Each call returns a new `Money`. If `Money` is `final` and the temporaries don't escape (e.g. they aren't stored in a field or passed to another method), C2 can apply scalar replacement: the intermediate objects are never allocated. The fields live in registers.

This is why immutable functional chains aren't slower than mutating ones in modern JVMs — the JIT erases the intermediate allocations.

Verify with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations`.

---

## 4. Megamorphic chain hazard

```java
Stream<X> result = users.stream()
    .filter(p1)
    .filter(p2)
    .map(f)
    .filter(p3);
```

Every `filter` call has the same call site dispatching to the same method. If you have many similar pipelines across the codebase using *different* lambdas, the lambda's `accept` method becomes megamorphic — JIT can't inline.

Fix: extract repeated stream patterns into helper methods. Each helper has a single lambda site, monomorphic.

---

## 5. Builder allocation cost

A throw-away builder allocates one object that's garbage right after `build()`:

```java
HttpRequest r = HttpRequest.builder("...")
    .header("a", "1")
    .header("b", "2")
    .build();
```

The `Builder` instance, plus its internal `headers` map, plus all the boxed strings — all garbage after `build()` returns. The JIT can sometimes scalarize the builder if it doesn't escape, but typically not when the internal map is mutated.

For very hot paths, consider:
- Direct constructor with a varargs or `Map.of(...)`
- A mutable thread-local builder (rare; usually overkill)

For most code, builders are fine — millions per second is not unusual.

---

## 6. Fluent DSLs and the type complexity tax

Heavily-staged fluent DSLs (like jOOQ or Spring Data Specifications) require many small types. Each represents a "node" in the DSL grammar.

Trade-offs:
- **Pro:** compile-time enforcement, IDE autocomplete narrows to valid next steps.
- **Con:** API surface explodes; refactoring is painful; small types pollute javadoc.

Use sparingly. A simple builder is enough for 99% of APIs.

---

## 7. Records and copy-with chains

Records are immutable, but Java doesn't (yet) have a `with` syntax for "copy with one field changed." Common workaround:

```java
public record User(String name, int age, String email) {
    public User withName(String name)  { return new User(name, age, email); }
    public User withAge(int age)       { return new User(name, age, email); }
    public User withEmail(String e)    { return new User(name, age, e); }
}

User v2 = u.withAge(31).withEmail("x@y.com");
```

JEP 468 (or its successor) proposes built-in `with` syntax. Until then, write `withX` methods or use a builder.

---

## 8. Optional chains

```java
String email = findUser(id)
    .map(User::contactInfo)
    .map(ContactInfo::email)
    .orElse("none");
```

Each `map` returns a new `Optional`. JIT typically fuses Optional chains since `Optional` is final. But the allocations may not all be eliminated by EA, especially when the chain spans method boundaries.

If you're chaining 5+ Optionals in a hot path, consider explicit null checks or pattern matching.

---

## 9. CompletableFuture chains

```java
CompletableFuture<Result> result = fetch(id)
    .thenApply(this::parse)
    .thenCompose(this::loadDeps)
    .exceptionally(this::onError);
```

Each step constructs a new `CompletableFuture`. The chain has real allocation cost (vs sync code), but enables parallelism. Use it where async actually helps, not as a replacement for sequential calls.

For hot synchronous logic, prefer plain method calls.

---

## 10. Fluent API in libraries: case studies

| Library            | Chain style                                     |
|--------------------|-------------------------------------------------|
| StringBuilder       | Mutating, returns `this`                        |
| `java.time` API     | Functional, returns new instance                |
| Stream API          | Lazy, returns new stream view                   |
| Optional            | Functional, returns new Optional                |
| jOOQ                | Staged DSL, types narrow per stage              |
| Mockito            | Stateful builder, terminal `thenReturn(...)`    |
| AssertJ            | Stateful assertion accumulator                  |
| Spring WebClient    | Functional builder + reactor `Mono<T>`          |

Patterns to learn from: `java.time` for clean immutable chains; jOOQ for type-driven DSLs.

---

## 11. Debugging chains

A chain in a stack trace looks like one line; the failure can be anywhere. Strategies:

- Break the chain into named variables temporarily when debugging
- Use `peek` (Stream) or `tap` (custom) to log intermediate values
- Use `--enable-preview --release 21` for richer stack traces (helpful in pattern matching contexts)

Some teams wrap chains in helper methods that log on failure:

```java
class Trace {
    static <T> T tap(T value, String label) {
        System.out.println(label + ": " + value);
        return value;
    }
}

users.stream().map(u -> Trace.tap(u, "before")).map(...);
```

---

## 12. When chains hide complexity

A common smell: a chain that does too much.

```java
return svc.fetch(id)
    .filter(u -> u.active())
    .map(this::loadProfile)
    .flatMap(p -> validate(p))
    .map(this::persist)
    .map(this::audit)
    .orElseThrow(() -> new RuntimeException("nothing"));
```

This chain has business logic spread across 6 hops. Easier to read as a sequence of named methods or a well-named function:

```java
Optional<User> user = svc.fetch(id);
if (user.isEmpty() || !user.get().active()) throw ...;
Profile p = loadProfile(user.get());
validate(p);
persist(p);
audit(p);
return p;
```

Prefer chains for *transformation pipelines*. Use named statements for *workflow*.

---

## 13. Practical checklist

- [ ] Mutating chains use `return this`; document that the builder is single-use.
- [ ] Functional chains return new instances of an immutable type.
- [ ] Hot paths avoid per-call lambda capture.
- [ ] Long chains are broken into named intermediates if debugging matters.
- [ ] Streams are used for transformations, not workflow.
- [ ] Staged builders only when type-driven enforcement justifies the complexity.

---

**Memorize this**: chains are JIT-friendly when types are stable and the chain is monomorphic. Mutating chains are essentially free; functional chains often eliminate via EA. Streams fuse into loops when lambdas are non-capturing. Don't use chains as a substitute for clear workflow.
