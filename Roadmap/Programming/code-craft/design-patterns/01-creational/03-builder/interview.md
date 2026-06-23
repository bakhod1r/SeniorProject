# Builder — Interview Preparation

> **Source:** [refactoring.guru/design-patterns/builder](https://refactoring.guru/design-patterns/builder)

---

## Junior Questions (10)

### J1. What is Builder?

**Answer:** A creational pattern that constructs complex objects step by step, allowing the same construction code to produce different representations.

### J2. What problem does Builder solve?

**Answer:** Telescoping constructors — overloaded constructors with progressively more parameters. Builder replaces them with a fluent, named-step API.

### J3. What's a fluent interface?

**Answer:** An API where each method returns the receiver (this/self), enabling method chaining: `builder.a(1).b(2).c(3)`.

### J4. What's the role of Director?

**Answer:** It encapsulates the *recipe* — what steps to call in what order. Different Directors can drive the same Builder for different products.

### J5. Why use Builder over a constructor?

**Answer:** When the constructor would have many parameters, especially many optional ones. Builder's named steps are more readable.

### J6. Give a real-world Builder example.

**Answer:** `OkHttpClient.Builder`, Java 11 `HttpClient.newBuilder()`, AWS SDK clients, SQL query builders.

### J7. Why are Builders awkward in Go?

**Answer:** Go has no inheritance, but Builder works fine as a struct with fluent methods. The idiomatic Go alternative is **functional options** (composable functions configuring a struct).

### J8. What's the difference between Builder and Factory?

**Answer:** Factory creates one product in one step. Builder creates one product in many steps with optional configuration.

### J9. Should the Product be mutable or immutable?

**Answer:** **Immutable** — final fields, copied collections. Otherwise the "build then freeze" intent is lost.

### J10. What's a common Builder mistake?

**Answer:** Returning the Product from each step instead of the Builder, breaking chaining. Or sharing mutable collections between Product and Builder, leaking mutations.

---

## Middle Questions (10)

### M1. When should you use Builder vs constructor?

**Answer:** Builder when 4+ optional fields, multiple representations, complex validation, or step-by-step construction is natural. Constructor for 2-3 fields, mostly required.

### M2. What's the Step Builder pattern?

**Answer:** Each step returns a different *interface* representing the next allowed state, threading required fields through the type system. Compile-time enforcement of order/required.

### M3. How does Lombok `@Builder` work?

**Answer:** Annotation processor generates the Builder class at compile time. Same as hand-written; less code to maintain. `@Singular` adds `addX(...)` for collections; `@Builder.Default` sets defaults.

### M4. What's the difference between Builder and DSL?

**Answer:** A DSL is Builder dressed in syntactic sugar. Kotlin scope functions, Groovy method-missing, Scala implicits all enable DSLs that read like configuration files but behave like Builders.

### M5. How do you validate in a Builder?

**Answer:** Two layers:
- **Per-step:** validate field-level constraints in setter methods.
- **In `build()`:** validate cross-field constraints (e.g., "if SSL, password required").

### M6. What's Test Data Builder?

**Answer:** A pattern where tests use a Builder pre-configured with sane defaults. Tests change only what differs:

```java
User u = aUser().role("admin").build();
```

Reduces test boilerplate; one source of truth for "valid User."

### M7. How do you implement immutable Builder?

**Answer:** Each step returns a *new* Builder (not `this`). The state is never mutated; copies are made.

```scala
def withUrl(u: String): Builder = copy(url = u)
```

### M8. When should a Builder be a Singleton?

**Answer:** Almost never. Builders accumulate state for one Product. Sharing across constructions causes data leaks. Each Product → its own Builder.

### M9. What are functional options in Go?

**Answer:** A pattern where each option is a function `Option = func(*T) error`. `New(opts ...Option)` applies them in order. Composable, type-safe, idiomatic in Go.

### M10. What's the cost of Builder vs direct constructor?

**Answer:** After JIT, near-zero in Java (escape analysis stack-allocates the Builder). In Go, ~10-15 ns per construction (closure allocation). In Python, 2-3× slower than direct dataclass. Negligible for application code.

---

## Senior Questions (10)

### S1. How do you design a Builder API?

**Answer:**
- Required fields enforced via Step Builder or runtime check.
- Optional fields with defaults.
- Validation at both layers (per-step + build).
- Product immutable.
- Provide `toBuilder()` for "modify a copy."
- Document the contract (one-shot? Reusable?).

### S2. How does Lombok `@Builder` interact with inheritance?

**Answer:** `@SuperBuilder` (Lombok) generates Builder for parent + subclass with proper hierarchy. Plain `@Builder` doesn't handle inheritance well — generated Builders are independent per class.

### S3. Compare Step Builder, mutable Builder, and immutable Builder.

**Answer:**
| | Step Builder | Mutable | Immutable |
|---|---|---|---|
| Required fields | Compile-time | Runtime | Runtime |
| Allocation | 1 builder | 1 builder | N builders |
| Reuse | Risky | Possible | Always safe |
| Verbose | Yes | No | Medium |

### S4. How do you migrate a constructor-heavy class to Builder?

**Answer:**
1. Add Builder + `builder()` static.
2. Mark old constructors `@Deprecated`.
3. Old constructors call new Builder internally for backward compat.
4. Migrate callers PR-by-PR.
5. Delete old constructors.

### S5. When does Builder become an anti-pattern?

**Answer:** When the Product has 2-3 fields, all required. Builder adds boilerplate without benefit. Use named-argument constructor or record/dataclass.

### S6. How do you handle complex validation in Builder?

**Answer:** Aggregate errors:

```java
public Product build() {
    List<String> errs = new ArrayList<>();
    if (url == null) errs.add("url required");
    if (timeout.isNegative()) errs.add("timeout >= 0");
    if (!errs.isEmpty()) throw new IllegalStateException(String.join(", ", errs));
    return new Product(...);
}
```

Better UX than failing on the first error.

### S7. How do you make a Builder thread-safe?

**Answer:** Don't share Builders across threads. Builders are inherently single-use, single-threaded. If you must, synchronize each setter and `build()`. But the Product (built result) should be immutable and inherently thread-safe.

### S8. How does Builder compose with Factory?

**Answer:** Multiple ways:
- A Factory returns a configured Builder: `factory.newBuilder()`.
- A Builder's `build()` calls a Factory to create the Product.
- Both: configure builder via factory; build via builder.

### S9. How do you test a Builder?

**Answer:**
- Each setter returns the Builder (chainability).
- Required fields enforce in `build()`.
- Defaults are correct.
- Cross-field validation works.
- Built Product matches expectations.
- Builder reuse semantics documented.

### S10. What's the cost of immutable Builder vs mutable?

**Answer:** Immutable allocates N+1 objects (one per step + Product). Mutable allocates 2 (Builder + Product). For 10-step construction: ~5× allocations. JIT often elides intermediate mutable Builders; less so for immutable. Use mutable for hot paths; immutable for FP-style ergonomics.

---

## Professional Questions (10)

### P1. Walk me through Lombok-generated Builder bytecode.

**Answer:** Lombok runs as an annotation processor. For `@Builder`, it generates:
- Static `builder()` method on the class.
- Inner `Builder` class with package-private fields.
- One setter per field returning `this` (for chaining).
- A `build()` method calling the all-args constructor.

Bytecode is identical to hand-written; Lombok is purely a build-time tool.

### P2. How does HotSpot's escape analysis affect Builders?

**Answer:** If the Builder doesn't escape its caller's stack frame (typical for `builder().url("/x").build()`), HotSpot may stack-allocate it — eliminating heap pressure. The chained calls are inlined; the final `new Product(...)` is the only heap allocation.

### P3. Why is Go's functional options pattern preferred over Builder structs?

**Answer:**
- Composable: pass `[]Option` around, layer defaults.
- No mutable state visible to caller.
- Type-safe via `Option = func(*T) error`.
- Idiomatic in Go ecosystem (`net/http`, `grpc`, AWS SDK).
- Each option is small and testable independently.

### P4. How do persistent data structures help immutable Builders?

**Answer:** They share internal structure between versions. Adding to a HAMT-backed map is O(log n) instead of O(n). For Builders with large collections (e.g., a 1000-entry headers map), persistent data structures avoid full copies. Used in Scala's `immutable.Map`, Clojure's data structures, Vavr in Java.

### P5. How does Java records change the Builder calculus?

**Answer:** Records are immutable by default; constructors are concise. For 4-5 fields, records replace Builder. For more fields with optional defaults, Builder is still useful but the record is the Product (compact).

### P6. What's the cost of Lombok `@With`?

**Answer:** Each `withX(...)` allocates a new Product copy. For a 10-field Product, that's a full copy per modification. JIT may elide intermediate copies if escape analysis cooperates.

### P7. How does Jackson use Builder for deserialization?

**Answer:** With `@JsonDeserialize(builder = X.Builder.class)`, Jackson invokes Builder setters via reflection (cached after first call), then `build()`. Lets the Product remain immutable (no setters) while still being JSON-deserializable.

### P8. How do you optimize a hot-path Builder?

**Answer:**
- Use direct constructor for the hot config; Builder for less-frequent variants.
- Pool Builders with explicit `reset()`.
- Lazy-initialize Builder fields.
- Profile with JFR / pprof / py-spy to confirm Builder is the bottleneck (rarely is).

### P9. What's the memory profile of functional options in Go?

**Answer:** Each option is a closure. Closures with captures escape to heap (~16-32 bytes each). For 10 options: ~200 bytes per construction. The variadic `[]Option` slice is small and often stack-allocated.

### P10. How do you handle generic Builders in Java with type erasure?

**Answer:** Generic `Builder<T>` works, but `T` is erased. To recover `T`, pass `Class<T>` explicitly. Or use TypeToken (super-type token from Guava). For most practical Builders, erasure isn't a problem.

---

## Coding Tasks (5)

### C1. Implement a Java Builder with required and optional fields.

```java
public final class Email {
    public final String from, to, subject, body;
    public final List<String> cc;

    private Email(Builder b) {
        this.from = b.from; this.to = b.to;
        this.subject = b.subject; this.body = b.body;
        this.cc = List.copyOf(b.cc);
    }

    public static Builder builder() { return new Builder(); }

    public static final class Builder {
        private String from, to, subject, body;
        private final List<String> cc = new ArrayList<>();

        public Builder from(String f)    { this.from = f; return this; }
        public Builder to(String t)      { this.to = t; return this; }
        public Builder subject(String s) { this.subject = s; return this; }
        public Builder body(String b)    { this.body = b; return this; }
        public Builder cc(String addr)   { this.cc.add(addr); return this; }

        public Email build() {
            if (from == null || to == null || subject == null || body == null)
                throw new IllegalStateException("from/to/subject/body required");
            return new Email(this);
        }
    }
}
```

### C2. Implement a Step Builder.

```java
public final class HttpRequest {
    public interface UrlStep      { MethodStep url(String url); }
    public interface MethodStep   { OptionalStep get(); OptionalStep post(String body); }
    public interface OptionalStep {
        OptionalStep header(String k, String v);
        HttpRequest build();
    }

    public static UrlStep builder() { return new BuilderImpl(); }

    private static class BuilderImpl implements UrlStep, MethodStep, OptionalStep {
        String url, method, body;
        Map<String, String> headers = new HashMap<>();
        public MethodStep url(String u)               { this.url = u; return this; }
        public OptionalStep get()                     { this.method = "GET"; return this; }
        public OptionalStep post(String b)            { this.method = "POST"; this.body = b; return this; }
        public OptionalStep header(String k, String v) { headers.put(k, v); return this; }
        public HttpRequest build()                    { return new HttpRequest(url, method, body, Map.copyOf(headers)); }
    }
}
```

### C3. Functional options in Go.

```go
type Server struct {
    addr    string
    tlsCert string
    tlsKey  string
    timeout time.Duration
}

type Option func(*Server)

func WithTLS(cert, key string) Option { return func(s *Server) { s.tlsCert, s.tlsKey = cert, key } }
func WithTimeout(t time.Duration) Option { return func(s *Server) { s.timeout = t } }

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{addr: addr, timeout: 30 * time.Second}
    for _, o := range opts { o(s) }
    return s
}
```

### C4. Director-driven Builder.

```python
class CarBuilder:
    def __init__(self):
        self._reset()
    def _reset(self):
        self._seats = 4; self._engine = "I4"; self._spoiler = False; self._awd = False
    def seats(self, n): self._seats = n; return self
    def engine(self, e): self._engine = e; return self
    def spoiler(self, v): self._spoiler = v; return self
    def awd(self, v): self._awd = v; return self
    def build(self): r = (self._seats, self._engine, self._spoiler, self._awd); self._reset(); return r

class Director:
    def sports_car(self, b): b.seats(2).engine("V8").spoiler(True)
    def suv(self, b): b.seats(7).engine("V6").awd(True)

d = Director(); b = CarBuilder()
d.sports_car(b); car1 = b.build()   # (2, V8, True, False)
d.suv(b);        car2 = b.build()   # (7, V6, False, True)
```

### C5. Test Data Builder.

```java
public final class UserTestBuilder {
    private String name = "Test User";
    private String email = "test@example.com";
    private String role = "user";
    private Instant createdAt = Instant.now();

    public static UserTestBuilder aUser() { return new UserTestBuilder(); }

    public UserTestBuilder withName(String n) { this.name = n; return this; }
    public UserTestBuilder withEmail(String e) { this.email = e; return this; }
    public UserTestBuilder withRole(String r) { this.role = r; return this; }

    public User build() { return new User(name, email, role, createdAt); }
}

@Test
void adminHasFullAccess() {
    User admin = aUser().withRole("admin").build();
    // ... test
}
```

---

## Trick Questions (5)

### T1. Can a Builder return different concrete types from `build()`?

**Yes**, but it's unusual. Each Concrete Builder may produce a different Product (Car, Manual). Coordinator (Director) often handles dispatch.

### T2. Is Builder always implemented with mutable state?

**No.** Immutable Builders return a new Builder per step (Scala/Clojure idiom). More allocations, simpler reasoning.

### T3. Can the same Builder be used twice?

**Depends on implementation.** Mutable Builders need `reset()` between uses. Immutable ones are safe by design. **Document the contract.**

### T4. Is functional options the same as Builder?

**Functionally yes** (both configure a Product). Structurally different — no Builder struct, just functions. Idiomatic Go uses functional options.

### T5. Should `build()` return a fresh Product every time?

**Yes** by convention. Returning shared Products from a Builder leads to surprising mutations. Document if you do otherwise.

---

## Behavioral Questions (5)

### B1. Tell me about Builder in production.

**Sample:** "We had a `ConfigBuilder` for our distributed tracing setup with 25+ optional fields. Replacing the old 8-overload constructor with a Builder cut user errors at the call site. Lombok `@Builder` generated the boilerplate."

### B2. When did Builder add more pain than gain?

**Sample:** "A team built a Builder for a 3-field DTO. The Builder was 50 lines for what should have been a record. We collapsed it to a record with named-argument constructor."

### B3. How do you decide between Builder and named arguments?

**Sample:** "If validation is complex or there are multiple representations, Builder. If it's just configuration with safe defaults, named arguments (Python/Kotlin). The deciding factor is whether construction itself deserves to be a separate concern."

### B4. Describe a Builder bug you've debugged.

**Sample:** "A Builder reused across constructions leaked state — a header set in one construction appeared in the next. Fix: defensive copy in the constructor; add `reset()` for explicit reuse."

### B5. How do you handle Builder's verbosity?

**Sample:** "Use Lombok in Java, dataclass-with-builder in Python, or skip Builder when records suffice. For Go, use functional options. The pattern's spirit (clear, validated construction) matters more than the form."

---

## Tips for Answering

1. **Lead with the problem:** telescoping constructors, multi-step construction.
2. **Compare with Factory.** Builder is multi-step; Factory is one-step.
3. **Mention DSL as the evolved form.**
4. **Know language idioms:** Lombok, dataclass, functional options.
5. **Acknowledge cost vs benefit:** Builder is overkill for simple objects.

---

[← Senior Singleton interview](../05-singleton/interview.md) · [Creational](../README.md) · [Roadmap](../../../README.md) · **Next:** [Tasks](tasks.md)
