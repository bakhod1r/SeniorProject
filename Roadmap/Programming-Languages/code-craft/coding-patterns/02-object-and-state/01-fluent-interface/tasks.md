# Fluent Interface — Practice Tasks

> **Category:** [Object & State Patterns](../README.md) — chain calls that each return the receiver, producing a readable mini-DSL.

10 practice tasks with full Go, Java, and Python solutions.

---

## Table of Contents

1. [Task 1: Fluent String/Report Builder](#task-1-fluent-stringreport-builder)
2. [Task 2: Fluent SQL Query DSL](#task-2-fluent-sql-query-dsl)
3. [Task 3: Immutable Wither Chain](#task-3-immutable-wither-chain)
4. [Task 4: Error-Accumulating Validator](#task-4-error-accumulating-validator)
5. [Task 5: Railway / Sticky-Error Chain](#task-5-railway-sticky-error-chain)
6. [Task 6: Staged Interface (Type-State)](#task-6-staged-interface-type-state)
7. [Task 7: Refactor Imperative Setters to Fluent](#task-7-refactor-imperative-setters-to-fluent)
8. [Task 8: Go Receiver Chain vs Functional Options](#task-8-go-receiver-chain-vs-functional-options)
9. [Task 9: Fluent Assertion Mini-DSL](#task-9-fluent-assertion-mini-dsl)
10. [Task 10: Lazy Pipeline Chain](#task-10-lazy-pipeline-chain)

---

## Task 1: Fluent String/Report Builder

Build a report by chaining; the terminal returns the rendered text.

### Java
```java
public final class Report {
    private final StringBuilder b = new StringBuilder();
    public Report title(String t) { b.append("# ").append(t).append("\n"); return this; }
    public Report line(String s)  { b.append("- ").append(s).append("\n"); return this; }
    public String render()        { return b.toString(); }   // terminal
}
String out = new Report().title("Daily").line("3 deploys").line("0 incidents").render();
```

### Python
```python
from typing import Self
class Report:
    def __init__(self): self._parts: list[str] = []
    def title(self, t: str) -> Self: self._parts.append(f"# {t}"); return self
    def line(self, s: str) -> Self:  self._parts.append(f"- {s}"); return self
    def render(self) -> str:         return "\n".join(self._parts)
out = Report().title("Daily").line("3 deploys").line("0 incidents").render()
```

### Go
```go
type Report struct{ b strings.Builder }
func (r *Report) Title(t string) *Report { fmt.Fprintf(&r.b, "# %s\n", t); return r }
func (r *Report) Line(s string) *Report  { fmt.Fprintf(&r.b, "- %s\n", s); return r }
func (r *Report) Render() string         { return r.b.String() } // terminal
// new(Report).Title("Daily").Line("3 deploys").Render()
```

---

## Task 2: Fluent SQL Query DSL

`SELECT`/`FROM` required, `WHERE`/`ORDER BY`/`LIMIT` optional.

### Java
```java
public final class Sql {
    private String cols, table, where, orderBy;
    private Integer limit;
    public static Sql select(String cols) { Sql s = new Sql(); s.cols = cols; return s; }
    public Sql from(String t)    { this.table = t; return this; }
    public Sql where(String w)   { this.where = w; return this; }
    public Sql orderBy(String o) { this.orderBy = o; return this; }
    public Sql limit(int n)      { this.limit = n; return this; }
    public String build() {
        StringBuilder q = new StringBuilder("SELECT ").append(cols).append(" FROM ").append(table);
        if (where != null)   q.append(" WHERE ").append(where);
        if (orderBy != null) q.append(" ORDER BY ").append(orderBy);
        if (limit != null)   q.append(" LIMIT ").append(limit);
        return q.toString();
    }
}
String sql = Sql.select("id, name").from("users").where("active").limit(10).build();
```

### Python
```python
class Sql:
    def __init__(self, cols): self.cols, self.table, self.where_, self.order, self.lim = cols, None, None, None, None
    @staticmethod
    def select(cols): return Sql(cols)
    def from_(self, t):   self.table = t; return self
    def where(self, w):   self.where_ = w; return self
    def order_by(self, o):self.order = o; return self
    def limit(self, n):   self.lim = n; return self
    def build(self):
        q = f"SELECT {self.cols} FROM {self.table}"
        if self.where_: q += f" WHERE {self.where_}"
        if self.order:  q += f" ORDER BY {self.order}"
        if self.lim is not None: q += f" LIMIT {self.lim}"
        return q
```

### Go
```go
type Sql struct{ cols, table, where, order string; lim int; hasLim bool }
func Select(cols string) *Sql        { return &Sql{cols: cols} }
func (s *Sql) From(t string) *Sql    { s.table = t; return s }
func (s *Sql) Where(w string) *Sql   { s.where = w; return s }
func (s *Sql) Limit(n int) *Sql      { s.lim, s.hasLim = n, true; return s }
func (s *Sql) Build() string {
    q := "SELECT " + s.cols + " FROM " + s.table
    if s.where != "" { q += " WHERE " + s.where }
    if s.hasLim { q += " LIMIT " + strconv.Itoa(s.lim) }
    return q
}
```

---

## Task 3: Immutable Wither Chain

Each step returns a fresh copy; the base is never mutated.

### Java
```java
public record Config(String region, Duration timeout, int retries) {
    public Config withRegion(String r)    { return new Config(r, timeout, retries); }
    public Config withTimeout(Duration t) { return new Config(region, t, retries); }
    public Config withRetries(int n)      { return new Config(region, timeout, n); }
}
Config base = new Config("us-east-1", Duration.ofSeconds(5), 3);
Config eu   = base.withRegion("eu-west-1").withRetries(5);   // base untouched
```

### Python
```python
from dataclasses import dataclass, replace
@dataclass(frozen=True)
class Config:
    region: str
    timeout: float = 5.0
    retries: int = 3
    def with_region(self, r):  return replace(self, region=r)
    def with_retries(self, n): return replace(self, retries=n)
base = Config("us-east-1")
eu = base.with_region("eu-west-1").with_retries(5)   # base untouched
```

### Go
```go
type Config struct{ Region string; Timeout time.Duration; Retries int }
func (c Config) WithRegion(r string) Config  { c.Region = r; return c }  // value receiver = copy
func (c Config) WithRetries(n int) Config    { c.Retries = n; return c }
// base := Config{Region: "us-east-1", Retries: 3}
// eu := base.WithRegion("eu-west-1").WithRetries(5)  // base untouched (value semantics)
```
> Go value receivers copy the struct, giving wither semantics for free.

---

## Task 4: Error-Accumulating Validator

Collect *all* errors, report at the terminal.

### Java
```java
public final class Check<T> {
    private final T value; private final List<String> errs = new ArrayList<>();
    private Check(T v) { this.value = v; }
    public static <T> Check<T> that(T v) { return new Check<>(v); }
    public Check<T> require(Predicate<T> p, String msg) {
        if (!p.test(value)) errs.add(msg); return this;
    }
    public T orThrow() {
        if (!errs.isEmpty()) throw new IllegalArgumentException(String.join("; ", errs));
        return value;
    }
}
String name = Check.that(input)
    .require(Objects::nonNull, "required")
    .require(s -> s != null && s.length() <= 50, "too long")
    .orThrow();
```

### Python
```python
class Check:
    def __init__(self, v): self.v, self.errs = v, []
    def require(self, pred, msg):
        if not pred(self.v): self.errs.append(msg)
        return self
    def or_throw(self):
        if self.errs: raise ValueError("; ".join(self.errs))
        return self.v
name = Check(raw).require(bool, "required").require(lambda s: len(s) <= 50, "too long").or_throw()
```

### Go
```go
type Check struct{ errs []string }
func (c *Check) Require(ok bool, msg string) *Check {
    if !ok { c.errs = append(c.errs, msg) }
    return c
}
func (c *Check) Err() error {
    if len(c.errs) > 0 { return errors.New(strings.Join(c.errs, "; ")) }
    return nil
}
```

---

## Task 5: Railway / Sticky-Error Chain

Each step short-circuits after the first failure.

### Python
```python
class Result:
    def __init__(self, value=None, error=None): self.value, self.error = value, error
    def then(self, fn):
        if self.error is not None: return self          # skip
        try: return Result(value=fn(self.value))
        except Exception as e: return Result(error=e)
out = Result(value=raw).then(parse).then(validate).then(normalize)
```

### Go (sticky error)
```go
type Pipe struct{ v int; err error }
func (p *Pipe) Then(fn func(int) (int, error)) *Pipe {
    if p.err != nil { return p }                        // skip
    p.v, p.err = fn(p.v)
    return p
}
// out := (&Pipe{v: raw}).Then(parse).Then(validate)
// if out.err != nil { ... }
```

### Java (Optional as railway)
```java
Optional<Integer> out = Optional.of(raw)
    .map(Fns::parse)
    .filter(Fns::isValid)
    .map(Fns::normalize);   // empty short-circuits remaining maps
```

---

## Task 6: Staged Interface (Type-State)

Enforce required step order at compile time.

### Java
```java
public final class Email {
    public interface FromStep    { ToStep from(String a); }
    public interface ToStep      { SubjectStep to(String a); }
    public interface SubjectStep { Sendable subject(String s); }
    public interface Sendable    { Sendable cc(String a); Email build(); }

    public static FromStep builder() { return new Impl(); }
    private static final class Impl implements FromStep, ToStep, SubjectStep, Sendable {
        String from, to, subject; List<String> cc = new ArrayList<>();
        public ToStep      from(String a)    { this.from = a; return this; }
        public SubjectStep to(String a)      { this.to = a; return this; }
        public Sendable    subject(String s) { this.subject = s; return this; }
        public Sendable    cc(String a)      { cc.add(a); return this; }
        public Email       build()           { return new Email(from, to, subject, List.copyOf(cc)); }
    }
    private Email(String f, String t, String s, List<String> cc) { /* ... */ }
}
// Email.builder().from("a@x").to("b@y").subject("Hi").build();
// builder().to(...) -> compile error
```

### Python (runtime staged)
```python
class EmailBuilder:
    _required = {"from_addr", "to", "subject"}
    def __init__(self): self._d, self._set = {}, set()
    def from_addr(self, a): self._d["from_addr"] = a; self._set.add("from_addr"); return self
    def to(self, a):        self._d["to"] = a;        self._set.add("to");        return self
    def subject(self, s):   self._d["subject"] = s;   self._set.add("subject");   return self
    def build(self):
        missing = self._required - self._set
        if missing: raise ValueError(f"missing: {sorted(missing)}")
        return self._d
```

---

## Task 7: Refactor Imperative Setters to Fluent

### Before (Java)
```java
Notification n = new Notification();
n.setTo("a@x"); n.setTitle("Hi"); n.setBody("...");
n.send();
```

### After (Java)
```java
public final class Notification {
    private String to, title, body;
    public Notification to(String t)    { this.to = t; return this; }
    public Notification title(String t) { this.title = t; return this; }
    public Notification body(String b)  { this.body = b; return this; }
    public void send() { /* dispatch */ }   // terminal (void here — nothing to return)
}
new Notification().to("a@x").title("Hi").body("...").send();
```

---

## Task 8: Go Receiver Chain vs Functional Options

Same configuration, two styles.

### Receiver chain
```go
type Server struct{ addr string; timeout time.Duration; tls bool }
func New(addr string) *Server                 { return &Server{addr: addr, timeout: 30 * time.Second} }
func (s *Server) Timeout(t time.Duration) *Server { s.timeout = t; return s }
func (s *Server) TLS(v bool) *Server          { s.tls = v; return s }
// s := New(":8080").Timeout(5*time.Second).TLS(true)
```

### Functional options (idiomatic)
```go
type Option func(*Server)
func WithTimeout(t time.Duration) Option { return func(s *Server) { s.timeout = t } }
func WithTLS(v bool) Option              { return func(s *Server) { s.tls = v } }
func NewOpt(addr string, opts ...Option) *Server {
    s := &Server{addr: addr, timeout: 30 * time.Second}
    for _, o := range opts { o(s) }
    return s
}
// s := NewOpt(":8080", WithTimeout(5*time.Second), WithTLS(true))
```
> Prefer options for config; the receiver chain is fine when you're *accumulating* (e.g. a query string).

---

## Task 9: Fluent Assertion Mini-DSL

Build a tiny `assertThat`.

### Java
```java
public final class Assert<T> {
    private final T actual;
    private Assert(T a) { this.actual = a; }
    public static <T> Assert<T> assertThat(T a) { return new Assert<>(a); }
    public Assert<T> isNotNull() {
        if (actual == null) throw new AssertionError("expected non-null"); return this;
    }
    public Assert<T> isEqualTo(T expected) {
        if (!actual.equals(expected)) throw new AssertionError("expected " + expected + " but was " + actual);
        return this;
    }
}
// assertThat(x).isNotNull().isEqualTo(y);
```

### Python
```python
class Assert:
    def __init__(self, actual): self.actual = actual
    def is_not_none(self):
        assert self.actual is not None, "expected non-None"; return self
    def is_equal_to(self, expected):
        assert self.actual == expected, f"expected {expected} but was {self.actual}"; return self
def assert_that(a): return Assert(a)
# assert_that(x).is_not_none().is_equal_to(y)
```

---

## Task 10: Lazy Pipeline Chain

Intermediate steps record; the terminal runs them once.

### Python
```python
from typing import Self, Callable
class Lazy:
    def __init__(self, src): self._src, self._ops = src, []
    def map(self, fn: Callable) -> Self:    self._ops.append(("map", fn)); return self
    def filter(self, pred: Callable) -> Self: self._ops.append(("filter", pred)); return self
    def to_list(self) -> list:              # terminal: single pass
        out = []
        for x in self._src:
            keep = True
            for kind, fn in self._ops:
                if kind == "map": x = fn(x)
                elif kind == "filter" and not fn(x): keep = False; break
            if keep: out.append(x)
        return out
# Lazy(range(10)).map(lambda x: x*2).filter(lambda x: x > 5).to_list()
```

### Java (Streams — lazy by design)
```java
List<Integer> out = IntStream.range(0, 10).boxed()
    .map(x -> x * 2)
    .filter(x -> x > 5)
    .collect(Collectors.toList());   // terminal triggers single fused pass
```

---

## Practice Tips

1. **Every non-terminal step returns the receiver (or a copy).** Forget once and the chain breaks.
2. **Give exactly one terminal** that returns the real product.
3. **Choose mutable vs wither deliberately** — wither for shared/templated objects.
4. **In Go, default to functional options for config**; chain for accumulation.
5. **For order-sensitive APIs, write a staged interface** so misuse is a compile error.

---

[← Interview](interview.md) · [Object & State](../README.md) · [Coding Patterns](../../README.md) · **Next:** [Find-Bug](find-bug.md)
