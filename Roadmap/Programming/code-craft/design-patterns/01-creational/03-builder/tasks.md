# Builder — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/builder](https://refactoring.guru/design-patterns/builder)

10 practice tasks with full Go, Java, Python solutions.

---

## Table of Contents

1. [Task 1: HTTP Request Builder](#task-1-http-request-builder)
2. [Task 2: SQL Query Builder](#task-2-sql-query-builder)
3. [Task 3: Email with Optional CC/BCC](#task-3-email-with-optional-ccbcc)
4. [Task 4: Step Builder for Required Fields](#task-4-step-builder-for-required-fields)
5. [Task 5: Director + Multiple Concrete Builders](#task-5-director-multiple-concrete-builders)
6. [Task 6: Test Data Builder](#task-6-test-data-builder)
7. [Task 7: HTML Document Tree Builder](#task-7-html-document-tree-builder)
8. [Task 8: Functional Options in Go](#task-8-functional-options-in-go)
9. [Task 9: toBuilder() for Modify-a-Copy](#task-9-tobuilder-for-modify-a-copy)
10. [Task 10: Refactor Telescoping Constructors](#task-10-refactor-telescoping-constructors)

---

## Task 1: HTTP Request Builder

### Java

```java
public final class HttpRequest {
    private final String url, method;
    private final Map<String, String> headers;
    private final Duration timeout;
    private final byte[] body;

    private HttpRequest(Builder b) {
        this.url     = Objects.requireNonNull(b.url);
        this.method  = b.method;
        this.headers = Map.copyOf(b.headers);
        this.timeout = b.timeout;
        this.body    = b.body == null ? new byte[0] : b.body.clone();
    }

    public static Builder builder() { return new Builder(); }

    public static final class Builder {
        private String url, method = "GET";
        private final Map<String, String> headers = new HashMap<>();
        private Duration timeout = Duration.ofSeconds(30);
        private byte[] body;

        public Builder url(String url)        { this.url = url; return this; }
        public Builder method(String m)       { this.method = m; return this; }
        public Builder header(String k, String v) { headers.put(k, v); return this; }
        public Builder timeout(Duration t)    { this.timeout = t; return this; }
        public Builder body(byte[] b)         { this.body = b.clone(); return this; }

        public HttpRequest build() { return new HttpRequest(this); }
    }
}
```

### Python (dataclass-based)

```python
from dataclasses import dataclass, field
from datetime import timedelta

@dataclass(frozen=True)
class HttpRequest:
    url: str
    method: str = "GET"
    headers: dict[str, str] = field(default_factory=dict)
    timeout: timedelta = timedelta(seconds=30)
    body: bytes = b""

class HttpRequestBuilder:
    def __init__(self):
        self._url = None; self._method = "GET"
        self._headers = {}; self._timeout = timedelta(seconds=30); self._body = b""
    def url(self, u):        self._url = u; return self
    def method(self, m):     self._method = m; return self
    def header(self, k, v):  self._headers[k] = v; return self
    def timeout(self, t):    self._timeout = t; return self
    def body(self, b):       self._body = b; return self
    def build(self):
        if self._url is None: raise ValueError("url required")
        return HttpRequest(self._url, self._method, dict(self._headers), self._timeout, self._body)
```

### Go (functional options)

```go
type Request struct {
    url     string
    method  string
    headers map[string]string
    timeout time.Duration
    body    []byte
}

type Option func(*Request)

func Method(m string) Option         { return func(r *Request) { r.method = m } }
func Header(k, v string) Option      { return func(r *Request) { r.headers[k] = v } }
func Timeout(t time.Duration) Option { return func(r *Request) { r.timeout = t } }
func Body(b []byte) Option           { return func(r *Request) { r.body = b } }

func NewRequest(url string, opts ...Option) *Request {
    r := &Request{url: url, method: "GET", headers: map[string]string{}, timeout: 30 * time.Second}
    for _, o := range opts { o(r) }
    return r
}
```

---

## Task 2: SQL Query Builder

### Java

```java
public final class Sql {
    public static SelectBuilder select(String... cols) { return new SelectBuilder(cols); }

    public static final class SelectBuilder {
        private final List<String> cols;
        private String table;
        private final List<String> joins = new ArrayList<>();
        private String where;
        private String orderBy;
        private Integer limit;

        SelectBuilder(String[] cols) { this.cols = List.of(cols); }

        public SelectBuilder from(String t)            { this.table = t; return this; }
        public SelectBuilder join(String j)            { joins.add(j); return this; }
        public SelectBuilder where(String w)           { this.where = w; return this; }
        public SelectBuilder orderBy(String o)         { this.orderBy = o; return this; }
        public SelectBuilder limit(int n)              { this.limit = n; return this; }

        public String build() {
            StringBuilder sb = new StringBuilder("SELECT ");
            sb.append(String.join(", ", cols)).append(" FROM ").append(table);
            for (String j : joins) sb.append(" ").append(j);
            if (where != null) sb.append(" WHERE ").append(where);
            if (orderBy != null) sb.append(" ORDER BY ").append(orderBy);
            if (limit != null) sb.append(" LIMIT ").append(limit);
            return sb.toString();
        }
    }
}

// Usage
String sql = Sql.select("id", "name").from("users").where("active = true").limit(10).build();
```

---

## Task 3: Email with Optional CC/BCC

### Python

```python
@dataclass(frozen=True)
class Email:
    sender: str
    to: list[str]
    subject: str
    body: str
    cc: list[str] = field(default_factory=list)
    bcc: list[str] = field(default_factory=list)
    attachments: list[bytes] = field(default_factory=list)

class EmailBuilder:
    def __init__(self):
        self._sender = None; self._to = []; self._subject = None; self._body = None
        self._cc = []; self._bcc = []; self._attachments = []
    def sender(self, s):      self._sender = s; return self
    def to(self, addr):       self._to.append(addr); return self
    def subject(self, s):     self._subject = s; return self
    def body(self, b):        self._body = b; return self
    def cc(self, addr):       self._cc.append(addr); return self
    def bcc(self, addr):      self._bcc.append(addr); return self
    def attach(self, data):   self._attachments.append(data); return self
    def build(self):
        for f in ("sender", "subject", "body"):
            if getattr(self, f"_{f}") is None: raise ValueError(f"{f} required")
        if not self._to: raise ValueError("at least one to: required")
        return Email(self._sender, list(self._to), self._subject, self._body,
                     list(self._cc), list(self._bcc), list(self._attachments))
```

---

## Task 4: Step Builder for Required Fields

### Java

```java
public final class Connection {
    public interface UrlStep      { UserStep url(String url); }
    public interface UserStep     { PasswordStep user(String user); }
    public interface PasswordStep { OptionalStep password(String pw); }
    public interface OptionalStep {
        OptionalStep timeout(Duration t);
        OptionalStep ssl(boolean s);
        Connection build();
    }

    public static UrlStep builder() { return new BuilderImpl(); }

    private static class BuilderImpl
        implements UrlStep, UserStep, PasswordStep, OptionalStep {
        String url, user, password;
        Duration timeout = Duration.ofSeconds(5);
        boolean ssl = true;

        public UserStep url(String u)              { this.url = u; return this; }
        public PasswordStep user(String u)         { this.user = u; return this; }
        public OptionalStep password(String p)     { this.password = p; return this; }
        public OptionalStep timeout(Duration t)    { this.timeout = t; return this; }
        public OptionalStep ssl(boolean s)         { this.ssl = s; return this; }
        public Connection build()                  { return new Connection(url, user, password, timeout, ssl); }
    }

    private Connection(String url, String user, String password, Duration timeout, boolean ssl) { /* ... */ }
}

// Compile-time enforced order
Connection c = Connection.builder().url("...").user("...").password("...").build();
// .url(...).build() → compile error: UrlStep has no build()
```

---

## Task 5: Director + Multiple Concrete Builders

### Java

```java
interface CarBuilder {
    void reset();
    void setSeats(int n);
    void setEngine(String e);
    void setSpoiler(boolean s);
}

class StandardCarBuilder implements CarBuilder {
    private Car car = new Car();
    public void reset()                  { this.car = new Car(); }
    public void setSeats(int n)          { car.seats = n; }
    public void setEngine(String e)      { car.engine = e; }
    public void setSpoiler(boolean s)    { car.spoiler = s; }
    public Car getCar()                  { Car r = car; reset(); return r; }
}

class CarManualBuilder implements CarBuilder {
    private StringBuilder doc = new StringBuilder();
    public void reset()                  { this.doc = new StringBuilder(); }
    public void setSeats(int n)          { doc.append("Seats: ").append(n).append("\n"); }
    public void setEngine(String e)      { doc.append("Engine: ").append(e).append("\n"); }
    public void setSpoiler(boolean s)    { doc.append("Spoiler: ").append(s).append("\n"); }
    public String getManual()            { String r = doc.toString(); reset(); return r; }
}

class Director {
    public void buildSportsCar(CarBuilder b) {
        b.reset(); b.setSeats(2); b.setEngine("V8"); b.setSpoiler(true);
    }
    public void buildSUV(CarBuilder b) {
        b.reset(); b.setSeats(7); b.setEngine("V6"); b.setSpoiler(false);
    }
}

// Usage
Director d = new Director();
StandardCarBuilder cb = new StandardCarBuilder();
d.buildSportsCar(cb);
Car sportsCar = cb.getCar();

CarManualBuilder mb = new CarManualBuilder();
d.buildSportsCar(mb);
String manual = mb.getManual();
```

---

## Task 6: Test Data Builder

### Java

```java
public final class UserTestBuilder {
    private String name      = "Test User";
    private String email     = "test@example.com";
    private String role      = "user";
    private Instant created  = Instant.now();
    private boolean active   = true;

    public static UserTestBuilder aUser() { return new UserTestBuilder(); }

    public UserTestBuilder withName(String n)      { this.name = n; return this; }
    public UserTestBuilder withEmail(String e)     { this.email = e; return this; }
    public UserTestBuilder withRole(String r)      { this.role = r; return this; }
    public UserTestBuilder withCreated(Instant c)  { this.created = c; return this; }
    public UserTestBuilder inactive()              { this.active = false; return this; }

    public User build() { return new User(name, email, role, created, active); }
}

// Tests
@Test
void adminCanDelete() {
    User admin = aUser().withRole("admin").build();
    // ...
}

@Test
void inactiveUserCannotLogin() {
    User u = aUser().inactive().build();
    // ...
}
```

---

## Task 7: HTML Document Tree Builder

### Python (Composite + Builder)

```python
from dataclasses import dataclass, field

@dataclass
class Node:
    tag: str
    text: str = ""
    children: list["Node"] = field(default_factory=list)

class HtmlBuilder:
    def __init__(self, tag: str):
        self._node = Node(tag=tag)

    def text(self, t: str):
        self._node.text = t
        return self

    def child(self, child_builder: "HtmlBuilder"):
        self._node.children.append(child_builder.build())
        return self

    def build(self) -> Node:
        return self._node

# Usage
html = (HtmlBuilder("html")
        .child(HtmlBuilder("head")
            .child(HtmlBuilder("title").text("Page")))
        .child(HtmlBuilder("body")
            .child(HtmlBuilder("h1").text("Hello"))
            .child(HtmlBuilder("p").text("World"))))
tree = html.build()
```

---

## Task 8: Functional Options in Go

```go
type GrpcServer struct {
    addr        string
    tls         *tls.Config
    interceptor func(ctx context.Context, ...) error
    keepalive   time.Duration
    maxMsg      int
}

type ServerOption func(*GrpcServer)

func Addr(a string) ServerOption                    { return func(s *GrpcServer) { s.addr = a } }
func TLS(c *tls.Config) ServerOption               { return func(s *GrpcServer) { s.tls = c } }
func KeepAlive(t time.Duration) ServerOption       { return func(s *GrpcServer) { s.keepalive = t } }
func MaxMessageSize(b int) ServerOption            { return func(s *GrpcServer) { s.maxMsg = b } }
func Interceptor(fn func(...) error) ServerOption  { return func(s *GrpcServer) { s.interceptor = fn } }

func NewGrpcServer(opts ...ServerOption) *GrpcServer {
    s := &GrpcServer{
        addr: ":8080", keepalive: 30 * time.Second, maxMsg: 4 * 1024 * 1024,
    }
    for _, o := range opts { o(s) }
    return s
}

// Usage
s := NewGrpcServer(
    Addr(":443"),
    TLS(loadCerts()),
    KeepAlive(60*time.Second),
    MaxMessageSize(16*1024*1024),
)
```

---

## Task 9: toBuilder() for Modify-a-Copy

### Java

```java
public final class HttpRequest {
    public final String url, method;
    public final Map<String, String> headers;

    private HttpRequest(Builder b) { /* ... */ }

    public Builder toBuilder() {
        Builder b = new Builder();
        b.url     = this.url;
        b.method  = this.method;
        b.headers.putAll(this.headers);
        return b;
    }

    public static class Builder { /* ... */ }
}

// Usage: derive variants
HttpRequest base = HttpRequest.builder().url("/api").header("Auth", "Bearer X").build();
HttpRequest get  = base.toBuilder().method("GET").build();
HttpRequest post = base.toBuilder().method("POST").body("...").build();
```

---

## Task 10: Refactor Telescoping Constructors

### Before

```java
public class Pizza {
    public Pizza(int size, boolean cheese, boolean pepperoni, boolean mushrooms,
                 boolean olives, boolean onions, boolean peppers, boolean ham) {
        // ...
    }
    public Pizza(int size) { this(size, true, false, false, false, false, false, false); }
    public Pizza(int size, boolean cheese) { this(size, cheese, false, false, false, false, false, false); }
    // ... 6 more overloads
}

// Usage — unreadable
Pizza p = new Pizza(12, true, true, false, true, false, false, false);
```

### After

```java
public final class Pizza {
    public final int size;
    public final boolean cheese, pepperoni, mushrooms, olives, onions, peppers, ham;

    private Pizza(Builder b) { /* assign */ }

    public static Builder builder(int size) { return new Builder(size); }

    public static final class Builder {
        private final int size;
        private boolean cheese = true;
        private boolean pepperoni, mushrooms, olives, onions, peppers, ham;

        Builder(int size) { this.size = size; }

        public Builder cheese(boolean c)    { this.cheese = c; return this; }
        public Builder pepperoni()          { this.pepperoni = true; return this; }
        public Builder mushrooms()          { this.mushrooms = true; return this; }
        public Builder olives()             { this.olives = true; return this; }
        public Builder onions()             { this.onions = true; return this; }
        public Builder peppers()            { this.peppers = true; return this; }
        public Builder ham()                { this.ham = true; return this; }
        public Pizza build()                { return new Pizza(this); }
    }
}

// Usage — self-documenting
Pizza p = Pizza.builder(12).pepperoni().olives().build();
```

---

## Practice Tips

1. **Use Lombok** in Java tasks if available — focus on design, not boilerplate.
2. **Prefer dataclass + Builder hybrid** in Python.
3. **Default to functional options** in Go.
4. **Always make Product immutable.** Final fields, copied collections.
5. **Validate in `build()`.** Required fields, cross-field constraints.

---

[← Interview](interview.md) · [Creational](../README.md) · [Roadmap](../../../README.md) · **Next:** [Find-Bug](find-bug.md)
