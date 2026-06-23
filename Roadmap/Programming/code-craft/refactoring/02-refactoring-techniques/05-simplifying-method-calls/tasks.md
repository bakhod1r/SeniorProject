# Simplifying Method Calls — Tasks

> 12 hands-on exercises.

---

## Task 1 ⭐ — Rename Method (Java)

```java
class Order {
    public Money getCharge() { return total.plus(tax).plus(shipping); }
}
```

`getCharge` is vague.

<details><summary>Solution</summary>

```java
class Order {
    public Money totalIncludingTax() { return total.plus(tax).plus(shipping); }
}
```
</details>

---

## Task 2 ⭐ — Introduce Parameter Object (Java)

```java
public boolean overlaps(Date startA, Date endA, Date startB, Date endB) { ... }
```

<details><summary>Solution</summary>

```java
public record DateRange(Date start, Date end) {}
public boolean overlaps(DateRange a, DateRange b) { ... }
```
</details>

---

## Task 3 ⭐ — Replace Parameter with Explicit Methods (Java)

```java
public Result process(Order o, boolean express) {
    if (express) return expressFlow(o);
    return standardFlow(o);
}
```

<details><summary>Solution</summary>

```java
public Result processExpress(Order o) { return expressFlow(o); }
public Result processStandard(Order o) { return standardFlow(o); }
```
</details>

---

## Task 4 ⭐⭐ — Separate Query from Modifier (Java)

```java
String getTotalAndSetReady() {
    String result = computeTotal();
    readyForSummary = true;
    return result;
}
```

<details><summary>Solution</summary>

```java
String totalOutstanding() { return computeTotal(); }
void setReadyForSummary() { readyForSummary = true; }
```
</details>

---

## Task 5 ⭐⭐ — Replace Constructor with Factory Method (Java)

```java
class Employee {
    public Employee(int type) { this.type = type; }
    static final int ENGINEER = 0, MANAGER = 1;
}
```

<details><summary>Solution</summary>

```java
abstract class Employee {
    public static Employee createEngineer() { return new Engineer(); }
    public static Employee createManager() { return new Manager(); }
}
class Engineer extends Employee {}
class Manager extends Employee {}
```
</details>

---

## Task 6 ⭐⭐ — Replace Error Code with Exception (Java)

```java
int withdraw(double amount) {
    if (amount > balance) return -1;
    balance -= amount;
    return 0;
}
```

<details><summary>Solution</summary>

```java
public class InsufficientFundsException extends RuntimeException {}

void withdraw(double amount) {
    if (amount > balance) throw new InsufficientFundsException();
    balance -= amount;
}
```
</details>

---

## Task 7 ⭐⭐ — Replace Exception with Test (Java)

```java
double getValueForPeriod(int p) {
    try { return values[p]; }
    catch (ArrayIndexOutOfBoundsException e) { return 0; }
}
```

<details><summary>Solution</summary>

```java
double getValueForPeriod(int p) {
    if (p < 0 || p >= values.length) return 0;
    return values[p];
}
```
</details>

---

## Task 8 ⭐⭐ — Hide Method (Java)

```java
public class OrderService {
    public Money internalRoundingHelper(Money m) { ... }   // only used internally
}
```

<details><summary>Solution</summary>

```java
public class OrderService {
    private Money internalRoundingHelper(Money m) { ... }
}
```
</details>

---

## Task 9 ⭐⭐⭐ — Builder pattern for long parameter list (Java)

```java
new HttpRequest("GET", "/api/users", headers, body, 5000, 3, true, true, false);
```

<details><summary>Solution</summary>

```java
public class HttpRequest {
    private final String method;
    private final String url;
    private final Map<String, String> headers;
    // ...

    public static class Builder {
        private String method = "GET";
        private String url;
        private Map<String, String> headers = new HashMap<>();
        // ...

        public Builder method(String m) { this.method = m; return this; }
        public Builder url(String u) { this.url = u; return this; }
        public Builder header(String k, String v) { headers.put(k, v); return this; }
        public Builder timeout(Duration d) { ... }

        public HttpRequest build() {
            Objects.requireNonNull(url, "url required");
            return new HttpRequest(this);
        }
    }
}

// Usage:
HttpRequest req = new HttpRequest.Builder()
    .method("GET")
    .url("/api/users")
    .header("Authorization", "Bearer ...")
    .timeout(Duration.ofSeconds(5))
    .build();
```
</details>

---

## Task 10 ⭐⭐ — Functional Options (Go)

```go
func NewServer(addr string, port int, tls bool, timeout time.Duration) *Server {
    return &Server{addr: addr, port: port, tls: tls, timeout: timeout}
}
```

<details><summary>Solution</summary>

```go
type Option func(*Server)

func WithPort(p int) Option { return func(s *Server) { s.port = p } }
func WithTLS() Option { return func(s *Server) { s.tls = true } }
func WithTimeout(d time.Duration) Option { return func(s *Server) { s.timeout = d } }

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{addr: addr, port: 8080}
    for _, o := range opts { o(s) }
    return s
}

// Usage:
srv := NewServer("0.0.0.0", WithPort(443), WithTLS())
```
</details>

---

## Task 11 ⭐⭐ — Remove Setting Method (Java)

```java
class Customer {
    private String id;
    public Customer(String id) { this.id = id; }
    public void setId(String id) { this.id = id; }
}
```

<details><summary>Solution</summary>

```java
class Customer {
    private final String id;
    public Customer(String id) { this.id = id; }
    public String id() { return id; }
}
```
</details>

---

## Task 12 ⭐⭐⭐ — Combined refactoring (Python)

```python
def send(user_email: str,
         subject: str,
         body: str,
         html: bool,
         retry: bool,
         track: bool):
    if retry:
        ...
    if html:
        ...
    if track:
        ...
```

Apply 3+ refactorings.

<details><summary>Solution</summary>

```python
from dataclasses import dataclass
from enum import Flag, auto

class EmailFlag(Flag):
    NONE = 0
    HTML = auto()
    RETRY = auto()
    TRACK = auto()

@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    body: str
    flags: EmailFlag = EmailFlag.NONE

def send(email: Email):
    if EmailFlag.RETRY in email.flags: ...
    if EmailFlag.HTML in email.flags: ...
    if EmailFlag.TRACK in email.flags: ...

# Usage:
send(Email(
    to="user@example.com",
    subject="...",
    body="...",
    flags=EmailFlag.HTML | EmailFlag.TRACK
))
```

Applied: Introduce Parameter Object (Email dataclass), Replace Parameter with Object (flags as Flag enum vs. 3 booleans), Rename (clearer signature).
</details>

---

## Self-check

- ☑ I can rename methods safely.
- ☑ I can introduce parameter objects.
- ☑ I can split queries from modifiers.
- ☑ I can replace booleans with explicit methods.
- ☑ I can pick between exception and Test for error reporting.

---

## Next

- [find-bug.md](find-bug.md), [optimize.md](optimize.md), [interview.md](interview.md)
