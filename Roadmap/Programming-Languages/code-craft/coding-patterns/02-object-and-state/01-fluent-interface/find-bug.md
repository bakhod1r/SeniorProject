# Fluent Interface — Find the Bug

> **Category:** [Object & State Patterns](../README.md) — chain calls that each return the receiver, producing a readable mini-DSL.

11 buggy snippets across Go, Java, Python.

---

## Bug 1: Method Returns `void` / `None` Instead of the Receiver (Python)

```python
class Query:
    def __init__(self): self._parts = []
    def select(self, cols):
        self._parts.append(f"SELECT {cols}")    # BUG: no return self
    def from_(self, t):
        self._parts.append(f"FROM {t}"); return self

q = Query().select("id").from_("users")          # AttributeError
```

**Symptoms:** `AttributeError: 'NoneType' object has no attribute 'from_'`.

<details><summary>Find the bug</summary>

`select` mutates state but doesn't `return self`, so it returns `None`. The next call `.from_(...)` is called on `None`.

</details>

### Fix
```python
def select(self, cols):
    self._parts.append(f"SELECT {cols}"); return self
```

### Lesson
Every non-terminal step must return the receiver. In Python this fails at the *call site*, not the definition.

---

## Bug 2: Mutable Chain Aliasing a Shared Base (Java)

```java
Config base = new Config().url("/api");   // setters return this, mutate in place
Config a = base.timeout(t1);
Config b = base.timeout(t2);
// expected: a has t1, b has t2
```

**Symptoms:** `a`, `b`, and `base` are the **same object**; both have `t2`.

<details><summary>Find the bug</summary>

Mutable fluent setters return `this`. `base.timeout(t1)` and `base.timeout(t2)` mutate and return the *same* `base`. There's only one object.

</details>

### Fix — immutable wither
```java
public Config withTimeout(Duration t) {
    return new Config(this.url, t, this.retries);   // fresh copy
}
Config a = base.withTimeout(t1);   // base untouched
Config b = base.withTimeout(t2);   // distinct objects
```

### Lesson
Don't share a mutable fluent object as a template. Use a wither chain for shared/templated config.

---

## Bug 3: No Terminal — Caller Gets the Builder, Not the Product (Java)

```java
public final class Sql {
    public Sql select(String c) { /*...*/ return this; }
    public Sql from(String t)   { /*...*/ return this; }
    // no build()!
}
String sql = Sql.select("id").from("t");   // compile error: Sql is not String
```

**Symptoms:** Type mismatch — there's no way to extract the result.

<details><summary>Find the bug</summary>

Every step returns the builder; there's no terminal that returns the real product (the SQL `String`).

</details>

### Fix
```java
public String build() { return render(); }   // terminal returns the product
String sql = Sql.select("id").from("t").build();
```

### Lesson
A fluent chain needs exactly one terminal that returns the real result.

---

## Bug 4: Terminal Returns `this` Instead of the Product (Java)

```java
public Sql build() { render(); return this; }   // BUG: returns Sql, discards the String
```

**Symptoms:** Callers get the builder back; the rendered SQL is computed and thrown away.

<details><summary>Find the bug</summary>

`build()` is the terminal but returns `this` like a non-terminal step. The rendered product is lost.

</details>

### Fix
```java
public String build() { return render(); }
```

### Lesson
Non-terminal steps return the receiver; the terminal returns the **product**.

---

## Bug 5: Staged Interface Bypassed via Cast (Java)

```java
public class Impl implements UrlStep, MethodStep, OptionalStep {   // BUG: public
    public MethodStep   url(String u)    { return this; }
    public OptionalStep method(String m) { return this; }
    public Email        build()          { return new Email(...); }
}
public static UrlStep builder() { return new Impl(); }

// Caller skips required steps by casting:
((Impl) builder()).build();   // url/method never called
```

**Symptoms:** Type-state enforcement is defeated; required steps skipped.

<details><summary>Find the bug</summary>

`Impl` is `public` and implements every stage interface. Callers cast back to `Impl` and call any method, bypassing the staged ordering.

</details>

### Fix
```java
private static final class Impl implements UrlStep, MethodStep, OptionalStep { ... }
```

### Lesson
A staged interface's implementation class must be `private`. Expose only the stage interfaces.

---

## Bug 6: Sharing a Mutable Collection Between Builder and Product (Java)

```java
public final class Email {
    public final List<String> cc;
    private Email(Builder b) { this.cc = b.cc; }   // BUG: same reference
    public static final class Builder {
        final List<String> cc = new ArrayList<>();
        public Builder cc(String a) { cc.add(a); return this; }
        public Email build() { return new Email(this); }
    }
}
Builder b = new Email.Builder().cc("a@x");
Email e = b.build();
b.cc("d@y");   // BUG: also appears in e.cc
```

**Symptoms:** The "built" email's `cc` grows when the builder is reused.

<details><summary>Find the bug</summary>

`Email.cc` shares the same `List` reference as the builder. Mutating one mutates both.

</details>

### Fix
```java
private Email(Builder b) { this.cc = List.copyOf(b.cc); }
```

### Lesson
Defensive-copy mutable inputs at the terminal. A fluent chain mutating a collection must not leak that collection into the product.

---

## Bug 7: Chaining a Genuine Query (CQS Violation) (Java)

```java
boolean added = list.add(x);              // add returns boolean (query: changed?)
int n = list.add(x).size();               // BUG: won't compile — boolean has no size()
```

**Symptoms:** Doesn't compile; the attempt to chain reveals the design issue.

<details><summary>Find the bug</summary>

`add` is intentionally a command-*and*-query (returns whether the set changed). It can't be chained like a fluent setter — and shouldn't be, to honor Command-Query Separation.

</details>

### Fix
```java
list.add(x);
int n = list.size();   // query separate from command
```

### Lesson
Keep genuine queries out of the chain. Fluent steps should be commands that return the receiver, not data.

---

## Bug 8: Returning `null` Mid-Chain (Java)

```java
public Step header(String k, String v) {
    if (k == null) return null;            // BUG
    headers.put(k, v); return this;
}
builder().header(null, "v").build();       // NullPointerException
```

**Symptoms:** `NullPointerException` on `.build()`, with a trace pointing at the whole chain.

<details><summary>Find the bug</summary>

A chainable method returns `null` on bad input. The next call NPEs with no clear culprit.

</details>

### Fix
```java
public Step header(String k, String v) {
    if (k == null) throw new IllegalArgumentException("header key required");
    headers.put(k, v); return this;
}
```

### Lesson
Never return `null` from a chainable method — return the receiver or throw with a clear message.

---

## Bug 9: Loop Variable Captured in Options (Go)

```go
opts := []Option{}
for i := 0; i < 3; i++ {
    opts = append(opts, func(s *Server) { s.id = i })   // BUG (Go pre-1.22)
}
s := New(opts...)   // s.id == 3, not the per-iteration value
```

**Symptoms:** Every option sets `id` to `3`.

<details><summary>Find the bug</summary>

Pre-Go 1.22, the loop variable `i` is shared across iterations; all closures capture the same `i`, which is `3` after the loop. Go 1.22+ gives per-iteration variables, but legacy code still bites.

</details>

### Fix
```go
for i := 0; i < 3; i++ {
    i := i                                   // shadow
    opts = append(opts, func(s *Server) { s.id = i })
}
```

### Lesson
In Go pre-1.22, shadow loop variables before capturing them in option closures.

---

## Bug 10: Wither Mutates the Receiver Instead of Copying (Go)

```go
type Config struct{ Region string; Retries int }
func (c *Config) WithRegion(r string) *Config { c.Region = r; return c }  // BUG: pointer receiver mutates

base := &Config{Region: "us-east-1"}
eu := base.WithRegion("eu-west-1")
// base.Region is now "eu-west-1" too — it's the same pointer
```

**Symptoms:** The "wither" mutates `base`; `eu` and `base` alias the same struct.

<details><summary>Find the bug</summary>

A wither must return a *copy*. With a pointer receiver, `c` is the original; mutating it changes the base. The pointer is then returned, so both names alias it.

</details>

### Fix — value receiver
```go
func (c Config) WithRegion(r string) Config { c.Region = r; return c }  // c is a copy
```

### Lesson
For wither semantics in Go, use a **value receiver** so the struct is copied; return the modified copy.

---

## Bug 11: Side Effect in the Option Factory Instead of the Closure (Go)

```go
func WithLogger(log *Logger) Option {
    log.Info("logger registered")           // BUG: runs at option creation, not on apply
    return func(s *Server) { s.log = log }
}
opts := []Option{WithLogger(l)}              // "registered" already logged, before New()
```

**Symptoms:** The side effect fires when the option is *created*, possibly twice, before the server exists.

<details><summary>Find the bug</summary>

The `log.Info` call is in `WithLogger` itself, not inside the returned closure, so it runs eagerly when the option is built.

</details>

### Fix
```go
func WithLogger(log *Logger) Option {
    return func(s *Server) {
        log.Info("logger registered")        // inside the closure
        s.log = log
    }
}
```

### Lesson
Options must be **pure factories**. Side effects belong inside the returned function, applied at construction time.

---

## Practice Tips

1. **Trace the return type of every step** — a `void`/`None`/wrong type breaks the chain.
2. **Test aliasing explicitly:** derive two variants from one base and assert they differ.
3. **Run `go test -race`** on receiver chains shared across goroutines.
4. **For staged interfaces, try to cast back to the impl** — if you can, it's not `private`.
5. **Assert mutating the input collection doesn't change the built product.**

---

[← Tasks](tasks.md) · [Object & State](../README.md) · [Coding Patterns](../../README.md) · **Next:** [Optimize](optimize.md)
