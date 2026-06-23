# Builder — Find the Bug

> **Source:** [refactoring.guru/design-patterns/builder](https://refactoring.guru/design-patterns/builder)

12 buggy snippets across Go, Java, Python.

---

## Bug 1: Setter Returns Product Instead of Builder (Java)

```java
public Builder url(String url) {
    this.url = url;
    return new Product(this.url);   // BUG
}
```

**Symptoms:** Compile error: `Builder` expected, got `Product`. Or, with type erasure / casting, runtime error.

<details><summary>Find the bug</summary>

Setter returns the Product instead of `this`. Chain breaks immediately.

</details>

### Fix

```java
public Builder url(String url) { this.url = url; return this; }
```

### Lesson

Every setter returns the Builder. Last step (`build()`) returns the Product.

---

## Bug 2: Builder Doesn't Copy Mutable Collections (Java)

```java
public final class Email {
    public final List<String> cc;
    private Email(Builder b) { this.cc = b.cc; }   // BUG: same reference

    public static class Builder {
        private final List<String> cc = new ArrayList<>();
        public Builder cc(String addr) { cc.add(addr); return this; }
        public Email build() { return new Email(this); }
    }
}

Builder b = new Email.Builder().cc("a@b.c");
Email e = b.build();
b.cc("d@e.f");   // BUG: mutates email's cc too!
```

**Symptoms:** "Frozen" Email's CC list grows when builder is reused.

<details><summary>Find the bug</summary>

The Email shares the same `List` reference with the Builder. Mutating either mutates both.

</details>

### Fix

```java
private Email(Builder b) {
    this.cc = List.copyOf(b.cc);   // immutable copy
}
```

### Lesson

Defensive copy mutable inputs in `build()` (or in the constructor). Use immutable collections.

---

## Bug 3: Required Field Not Validated (Java)

```java
public Email build() {
    return new Email(this);   // BUG: no validation
}
```

**Symptoms:** `Email.builder().build()` succeeds with `null` `to:` and `null` `subject`. Crashes downstream when fields are accessed.

<details><summary>Find the bug</summary>

`build()` doesn't enforce required fields. Errors surface late, far from the construction site.

</details>

### Fix

```java
public Email build() {
    if (sender == null) throw new IllegalStateException("sender required");
    if (to.isEmpty())   throw new IllegalStateException("to required");
    if (subject == null) throw new IllegalStateException("subject required");
    return new Email(this);
}
```

### Lesson

Validate in `build()`. Fail fast and loudly.

---

## Bug 4: Builder State Leaks Across Builds (Java)

```java
public class CarBuilder {
    private Car car = new Car();
    public CarBuilder seats(int n) { car.seats = n; return this; }
    public Car build() { return car; }   // BUG: returns the same car
}

CarBuilder b = new CarBuilder();
Car c1 = b.seats(2).build();
Car c2 = b.seats(7).build();   // BUG: c1.seats == 7 too!
```

**Symptoms:** `c1` and `c2` are the same object. Setting `seats(7)` on the second build affects both.

<details><summary>Find the bug</summary>

Builder doesn't reset between builds. Both `build()` calls return the same `Car` reference. The second `seats()` mutates `c1`'s state.

</details>

### Fix — Reset

```java
public Car build() {
    Car result = car;
    car = new Car();   // reset for next use
    return result;
}
```

### Fix — Construct fresh

```java
private final List<Consumer<Car>> setters = new ArrayList<>();
public CarBuilder seats(int n) { setters.add(c -> c.seats = n); return this; }
public Car build() {
    Car c = new Car();
    setters.forEach(s -> s.accept(c));
    return c;
}
```

### Lesson

Builder reuse semantics matter. Either reset state or document one-shot use.

---

## Bug 5: Functional Option Captures Wrong Variable (Go)

```go
opts := []Option{}
for i := 0; i < 3; i++ {
    opts = append(opts, func(s *Server) { s.id = i })   // BUG (Go pre-1.22)
}
s := New(opts...)   // s.id = 3, not 0/1/2
```

**Symptoms:** All servers have `id == 3`.

<details><summary>Find the bug</summary>

Pre-Go 1.22, the `i` variable is shared across iterations. All closures capture the *same* `i`, which is `3` after the loop. Go 1.22+ fixes this with per-iteration variables, but legacy code still bites.

</details>

### Fix

```go
for i := 0; i < 3; i++ {
    i := i   // shadow with local
    opts = append(opts, func(s *Server) { s.id = i })
}
```

### Lesson

In Go pre-1.22, range/loop variables in closures are common gotcha. Shadow with local copy.

---

## Bug 6: Director Forgot to Reset Builder (Java)

```java
class Director {
    public void buildSportsCar(CarBuilder b) {
        // BUG: no reset
        b.setSeats(2); b.setEngine("V8"); b.setSpoiler(true);
    }
}

Director d = new Director();
CarBuilder b = new CarBuilder();
d.buildSportsCar(b);          // sets seats, engine, spoiler
Car sportsCar = b.build();    // OK
d.buildSUV(b);                // sets seats=7, engine=V6 — but spoiler still true!
Car suv = b.build();          // SUV has a spoiler!
```

**Symptoms:** Second build inherits state from first.

<details><summary>Find the bug</summary>

Director doesn't reset Builder before configuring. Old state persists.

</details>

### Fix

```java
public void buildSportsCar(CarBuilder b) {
    b.reset();   // ensure clean slate
    b.setSeats(2); b.setEngine("V8"); b.setSpoiler(true);
}
public void buildSUV(CarBuilder b) {
    b.reset();
    b.setSeats(7); b.setEngine("V6"); b.setAWD(true);
}
```

### Lesson

When sharing a Builder across calls, always reset.

---

## Bug 7: Step Builder Type-State Mistake (Java)

```java
public interface UrlStep   { MethodStep url(String u); }
public interface MethodStep { OptionalStep method(String m); }
public interface OptionalStep { Email build(); }

public class BuilderImpl implements UrlStep, MethodStep, OptionalStep {
    public MethodStep url(String u)        { return this; }
    public OptionalStep method(String m)   { return this; }
    public Email build()                   { return new Email(...); }   // BUG: no validation
}

// All callers can do:
UrlStep step = builder();
((BuilderImpl) step).build();   // BUG: bypassing the type-state by casting
```

**Symptoms:** Type-state is bypassable via casts. Required fields can be skipped.

<details><summary>Find the bug</summary>

The `BuilderImpl` is publicly accessible and implements all interfaces. Casting allows skipping steps.

</details>

### Fix

```java
private static class BuilderImpl implements UrlStep, MethodStep, OptionalStep { ... }

public static UrlStep builder() { return new BuilderImpl(); }
```

Make the impl `private`. Callers can't cast to it. Step ordering is enforced.

### Lesson

Step Builder requires hiding the implementation class. Otherwise the type system lies.

---

## Bug 8: Python `__init__` Re-runs After `__new__` (Python)

```python
class Builder:
    _instance = None
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        self._url = None   # BUG: resets on every Builder() call
        self._method = "GET"
```

**Symptoms:** Reusing `Builder()` resets all state.

<details><summary>Find the bug</summary>

`__init__` runs every time `Builder()` is called, even when `__new__` returns existing instance. Reinitializes the singleton-like Builder.

</details>

### Fix

```python
def __init__(self):
    if not hasattr(self, "_initialized"):
        self._url = None; self._method = "GET"
        self._initialized = True
```

But really: don't make Builders singletons. They're per-construction.

### Lesson

`__new__` + `__init__` interaction is subtle. Builders should be plain instances.

---

## Bug 9: Builder Validates But Builder Returns Anyway (Java)

```java
public Email build() {
    if (sender == null) System.err.println("sender required");   // BUG: log instead of throw
    return new Email(this);
}
```

**Symptoms:** Invalid Email returned with `null` sender. Errors deferred to runtime.

<details><summary>Find the bug</summary>

Validation logs but doesn't fail. Construction proceeds with invalid state.

</details>

### Fix

```java
if (sender == null) throw new IllegalStateException("sender required");
```

### Lesson

Validation must fail. A logged warning isn't a guarantee.

---

## Bug 10: Mutating Product After Build (Python)

```python
@dataclass  # BUG: not frozen
class HttpRequest:
    url: str
    headers: dict[str, str] = field(default_factory=dict)

class HttpRequestBuilder:
    def __init__(self): self._url = None; self._headers = {}
    def url(self, u): self._url = u; return self
    def header(self, k, v): self._headers[k] = v; return self
    def build(self):
        return HttpRequest(self._url, self._headers)   # BUG: shares _headers

req = HttpRequestBuilder().url("/x").header("X", "Y").build()
req.headers["Z"] = "Q"                                    # BUG: mutates! also mutates builder's _headers
```

**Symptoms:** Mutations on built object propagate to the builder. Frozen Product not frozen.

<details><summary>Find the bug</summary>

Two issues:
1. `@dataclass` (not frozen) lets `req.headers["Z"]` work.
2. `req.headers` and `_headers` are the same dict object.

</details>

### Fix

```python
@dataclass(frozen=True)
class HttpRequest:
    url: str
    headers: dict[str, str] = field(default_factory=dict)

def build(self):
    return HttpRequest(self._url, dict(self._headers))   # copy
```

### Lesson

Make Product immutable. Defensive copy mutable inputs.

---

## Bug 11: Functional Option With Side Effect (Go)

```go
func WithLogger(log *Logger) Option {
    log.Info("registered logger")    // BUG: side effect at option creation
    return func(s *Server) { s.log = log }
}

// Caller
opts := []Option{WithLogger(myLogger)}
// Logger.Info has already fired even before New() is called
```

**Symptoms:** Side effects happen before Server construction. If `WithLogger` is called twice, the log fires twice.

<details><summary>Find the bug</summary>

The side effect is in `WithLogger` itself, not inside the returned closure. It runs as soon as the option is created.

</details>

### Fix

```go
func WithLogger(log *Logger) Option {
    return func(s *Server) {
        log.Info("registered logger")   // inside the closure
        s.log = log
    }
}
```

### Lesson

Options should be **pure factories** — side effects belong inside the returned function, not in the option-creating function.

---

## Bug 12: Builder Inherits Wrong Way (Java)

```java
public class HttpRequestBuilder {
    public HttpRequestBuilder url(String u) { ... return this; }
}

public class GetRequestBuilder extends HttpRequestBuilder {
    public GetRequestBuilder cache(boolean c) { ... return this; }
}

GetRequestBuilder b = new GetRequestBuilder().url("/x").cache(true);   // compile error
```

**Symptoms:** `url()` returns `HttpRequestBuilder` (parent), losing access to `GetRequestBuilder`'s `cache()`.

<details><summary>Find the bug</summary>

Setter return type isn't covariant. After `.url(...)`, the chain returns `HttpRequestBuilder`, not `GetRequestBuilder`.

</details>

### Fix — Recursive generics (curiously recurring template pattern)

```java
public class HttpRequestBuilder<B extends HttpRequestBuilder<B>> {
    @SuppressWarnings("unchecked")
    public B url(String u) { ... return (B) this; }
}

public class GetRequestBuilder extends HttpRequestBuilder<GetRequestBuilder> {
    public GetRequestBuilder cache(boolean c) { ... return this; }
}

GetRequestBuilder b = new GetRequestBuilder().url("/x").cache(true);   // OK
```

### Lesson

Builder inheritance + fluent chaining requires recursive generics or covariant returns. Lombok `@SuperBuilder` handles this.

---

## Practice Tips

1. **Run `go test -race`** for Go Builder code.
2. **Use `assertImmutable`** test helpers for Java records / frozen dataclasses.
3. **Test Builder reuse explicitly:** `b.build()` twice with different state.
4. **Test that mutating the input collection doesn't affect the built object.**

---

[← Tasks](tasks.md) · [Creational](../README.md) · [Roadmap](../../../README.md) · **Next:** [Optimize](optimize.md)
