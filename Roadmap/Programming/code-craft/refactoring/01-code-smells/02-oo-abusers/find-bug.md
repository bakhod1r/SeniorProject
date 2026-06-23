# OO Abusers — Find the Bug

> 12 buggy snippets where OO Abusers hide bugs. Diagnose; the fix often is the refactoring.

---

## Bug 1 — Missing case in switch (Java)

```java
public BigDecimal getCommission(Salesperson s) {
    switch (s.getTier()) {
        case "BRONZE":   return s.getRevenue().multiply(new BigDecimal("0.05"));
        case "SILVER":   return s.getRevenue().multiply(new BigDecimal("0.10"));
        case "GOLD":     return s.getRevenue().multiply(new BigDecimal("0.15"));
        case "PLATINUM": return s.getRevenue().multiply(new BigDecimal("0.20"));
        default: return BigDecimal.ZERO;
    }
}

// Three months later, marketing adds tier "DIAMOND" via a config change.
// No code changes accompanied it.
```

<details><summary>Diagnosis</summary>

`DIAMOND` falls through to `default`, returning `BigDecimal.ZERO`. Diamond salespeople silently get $0 commission. No exception, no log — the bug is invisible until someone notices their paycheck.

**Fix:** sealed types + pattern matching → compiler enforces exhaustiveness; missing case → compile error. Or, throw on `default` instead of returning a "safe" zero.

```java
public BigDecimal getCommission(Salesperson s) {
    return switch (s.getTier()) {
        case BRONZE   -> ...;
        case SILVER   -> ...;
        case GOLD     -> ...;
        case PLATINUM -> ...;
    };  // exhaustive on Tier enum — DIAMOND added → compile error here
}
```
</details>

---

## Bug 2 — Refused Bequest, exception leaks (Java)

```java
class ReadOnlyList<E> extends ArrayList<E> {
    @Override public boolean add(E e) {
        throw new UnsupportedOperationException();
    }
    
    public ReadOnlyList(Collection<? extends E> c) {
        super(c);  // populated once, then read-only
    }
}

// Used by:
List<String> all = new ReadOnlyList<>(List.of("a", "b", "c"));
all.sort(Comparator.naturalOrder());  // ArrayList.sort doesn't add()...
```

<details><summary>Diagnosis</summary>

`sort()` doesn't call `add()`. But it *does* call `set()`, which `ReadOnlyList` didn't override. Sorting silently mutates the "read-only" list.

**Fix:** don't extend `ArrayList`. Use composition + return an unmodifiable view:

```java
class ReadOnlyList<E> {
    private final List<E> backing;
    public ReadOnlyList(Collection<? extends E> c) { 
        this.backing = List.copyOf(c);  // immutable copy
    }
    public List<E> asList() { return backing; }
}
```

Or just use `List.copyOf(c)` directly — the JDK already provides immutable lists.

This is the Refused Bequest bug: extending a class to "remove" some operations leaks the un-overridden ones.
</details>

---

## Bug 3 — Temporary Field stale state (Python)

```python
class CSVProcessor:
    def __init__(self):
        self.headers = None
        self.row_count = 0
    
    def process(self, csv_path):
        with open(csv_path) as f:
            reader = csv.reader(f)
            self.headers = next(reader)
            for row in reader:
                self.row_count += 1
                self._handle_row(row)
        return self.row_count
    
    def _handle_row(self, row):
        # uses self.headers
        ...

processor = CSVProcessor()
n1 = processor.process("file1.csv")  # 1000 rows
n2 = processor.process("file2.csv")  # 500 rows
# Bug?
```

<details><summary>Diagnosis</summary>

`row_count` is initialized in `__init__` to 0 but **never reset between calls**. After processing file1 (1000 rows), `row_count = 1000`. Processing file2 adds 500 more → `row_count = 1500` → returned. The caller thinks file2 had 1500 rows.

**Fix:** the temporary field shouldn't be on the long-lived class — extract.

```python
class CSVProcessor:
    def process(self, csv_path):
        return _ProcessOperation(csv_path).run()

class _ProcessOperation:
    def __init__(self, csv_path):
        self.csv_path = csv_path
        self.headers = None
        self.row_count = 0
    
    def run(self):
        with open(self.csv_path) as f:
            reader = csv.reader(f)
            self.headers = next(reader)
            for row in reader:
                self.row_count += 1
                self._handle_row(row)
        return self.row_count
```

Each call creates fresh state. No leakage across calls.
</details>

---

## Bug 4 — Switch fall-through (Go)

```go
func PriorityScore(severity string) int {
    score := 0
    switch severity {
    case "CRITICAL":
        score += 100
        fallthrough
    case "HIGH":
        score += 50
        fallthrough
    case "MEDIUM":
        score += 20
    case "LOW":
        score += 5
    }
    return score
}
```

<details><summary>Diagnosis</summary>

`PriorityScore("MEDIUM")` returns `20` (no `fallthrough`). `PriorityScore("LOW")` returns `5`. But `PriorityScore("CRITICAL")` returns `100 + 50 + 20 = 170` due to deliberate fallthrough.

If the author intended cumulative scoring, the bug is that `LOW` doesn't have `fallthrough` from `MEDIUM`. If the author intended discrete scores, the `fallthrough`s are the bug.

Either way: the switch is unclear. Replace with sealed type or explicit table:

```go
var severityScore = map[string]int{
    "CRITICAL": 170,
    "HIGH":      70,
    "MEDIUM":    20,
    "LOW":        5,
}

func PriorityScore(severity string) int {
    return severityScore[severity]
}
```

Or, polymorphism:

```go
type Severity interface { Score() int }
type Critical struct{}
func (Critical) Score() int { return 170 }
// etc.
```

The smell hid the bug — a long switch with subtle control flow.
</details>

---

## Bug 5 — Alternative Classes diverge (Java)

```java
class EmailValidator {
    public boolean isValid(String email) {
        return email != null && email.contains("@") && email.contains(".");
    }
}

class SmsValidator {
    public boolean validatePhoneNumber(String number) {
        return number != null && number.matches("\\+?[0-9]{7,15}");
    }
}

// In a factory:
boolean valid;
if (channel.equals("email")) {
    valid = new EmailValidator().isValid(input);
} else {
    valid = new SmsValidator().validatePhoneNumber(input);
}
```

<details><summary>Diagnosis</summary>

The two validators have different method names, different validation rigor, different return semantics for `null`. The *if/else* is a Switch Statements smell waiting to grow.

Now imagine someone adds `WhatsAppValidator` — they need to remember the new class name and add the case. Three months later: `PushValidator.checkAddress(...)` is added, but the if/else is missed. Push notifications skip validation entirely.

**Fix:**

```java
interface Validator {
    boolean isValid(String input);
}

class EmailValidator implements Validator { ... }
class SmsValidator implements Validator { ... }

// Factory returns the right Validator; caller doesn't need to know which:
Validator v = ValidatorRegistry.forChannel(channel);
boolean valid = v.isValid(input);
```

Adding a new channel = registering a new Validator. No edits at every call site.
</details>

---

## Bug 6 — Refused Bequest hidden by overriding (Java)

```java
class HashSet<E> { /* ... */ }

class CountingHashSet<E> extends HashSet<E> {
    private int additions = 0;
    
    @Override public boolean add(E e) {
        additions++;
        return super.add(e);
    }
    
    public int additionCount() { return additions; }
}

// Usage:
CountingHashSet<String> set = new CountingHashSet<>();
set.addAll(List.of("a", "b", "c"));
System.out.println(set.additionCount());
// Expected: 3. Actual: ??
```

<details><summary>Diagnosis</summary>

`HashSet.addAll()` is implemented in `AbstractCollection` as a loop calling `add()` for each element. So `addAll` *does* increment the counter — three times — and returns `3`. ✓

But wait — let's check the actual JDK source. In some versions and implementations, `addAll` calls *internal* methods that bypass `add()`. If the JDK changes its `addAll` implementation, the counter silently breaks.

This is the **fragile base class problem** — a Refused Bequest variant. The subclass relies on the parent's *implementation details* (that `addAll` calls `add` internally). The parent's implementation is not part of its contract.

**Fix:** composition.

```java
class CountingSet<E> {
    private final Set<E> backing = new HashSet<>();
    private int additions = 0;
    
    public boolean add(E e) {
        if (backing.add(e)) {
            additions++;
            return true;
        }
        return false;
    }
    
    public boolean addAll(Collection<? extends E> c) {
        boolean changed = false;
        for (E e : c) if (add(e)) changed = true;
        return changed;
    }
    
    public int additionCount() { return additions; }
}
```

Composition explicitly defines the relationship. No surprises from parent's implementation choices.

(Joshua Bloch, *Effective Java*, Item 18: "Favor composition over inheritance.")
</details>

---

## Bug 7 — Switch on stringly-typed status (Python)

```python
def can_cancel(order):
    if order.status == "DRAFT":
        return True
    elif order.status == "PENDING":
        return True
    elif order.status == "CONFIRMED":
        return True
    elif order.status == "shipped":  # <-- lowercase
        return False
    elif order.status == "DELIVERED":
        return False
    return False

# Bug?
```

<details><summary>Diagnosis</summary>

`"shipped"` (lowercase) is compared against `order.status`, which is uppercase elsewhere. The comparison is `False`. Falls through to `return False`. So shipped orders return `False` — coincidentally correct in this case.

But: a future engineer adds:

```python
elif order.status == "PROCESSING":
    return True  # in process; can still cancel
```

And copies the lowercase typo accidentally:

```python
elif order.status == "processing":
    return True
```

Now `PROCESSING` orders fall through to `return False` — the bug is silently introduced.

**Fix:** enum (no string typos possible) + polymorphism.

```python
from enum import Enum

class OrderStatus(Enum):
    DRAFT = "DRAFT"
    PENDING = "PENDING"
    CONFIRMED = "CONFIRMED"
    PROCESSING = "PROCESSING"
    SHIPPED = "SHIPPED"
    DELIVERED = "DELIVERED"

def can_cancel(order):
    return order.status in {OrderStatus.DRAFT, OrderStatus.PENDING, 
                             OrderStatus.CONFIRMED, OrderStatus.PROCESSING}
```

Or (better) put it on the enum itself:

```python
class OrderStatus(Enum):
    DRAFT = "DRAFT"
    PENDING = "PENDING"
    # ...
    
    @property
    def can_cancel(self) -> bool:
        return self in {OrderStatus.DRAFT, OrderStatus.PENDING,
                        OrderStatus.CONFIRMED, OrderStatus.PROCESSING}
```

Use case: `order.status.can_cancel`.
</details>

---

## Bug 8 — Temporary Field shared between threads (Java)

```java
class ReportBuilder {
    private List<Section> sections;  // populated during build()
    private Stats stats;              // populated during build()
    
    public Report build(ReportRequest request) {
        sections = new ArrayList<>();
        stats = new Stats();
        addSummarySection(request);
        addDetailSection(request);
        return new Report(sections, stats);
    }
    
    private void addSummarySection(ReportRequest request) {
        sections.add(new SummarySection(request));
        stats.summaryCount++;
    }
    private void addDetailSection(ReportRequest request) { ... }
}

// Used as a Spring @Service singleton — multiple threads call build() concurrently.
```

<details><summary>Diagnosis</summary>

Threads share `sections` and `stats`. Thread A starts a build, writes `sections`. Thread B starts a build, **resets** `sections`. Thread A's `addSummarySection` now writes into Thread B's list. Race condition causes wildly wrong reports.

**Fix:** the temporary fields don't belong on a singleton. Extract to a per-build object.

```java
class ReportBuilder {
    public Report build(ReportRequest request) {
        return new BuildOperation(request).run();
    }
}

class BuildOperation {
    private final ReportRequest request;
    private final List<Section> sections = new ArrayList<>();
    private final Stats stats = new Stats();
    
    BuildOperation(ReportRequest request) { this.request = request; }
    
    Report run() {
        addSummarySection();
        addDetailSection();
        return new Report(sections, stats);
    }
    // ...
}
```

Each build has its own state. No sharing. No race.

Temporary Field on a singleton is one of the **most common concurrency bugs** in Java services — easy to introduce, hard to detect (manifests as occasional weird data, not a crash).
</details>

---

## Bug 9 — Switch on instanceof leaks subclass (Go)

```go
type Shape interface { Area() float64 }
type Circle struct{ R float64 }
type Square struct{ Side float64 }

func (c Circle) Area() float64 { return math.Pi * c.R * c.R }
func (s Square) Area() float64 { return s.Side * s.Side }

func Render(s Shape) string {
    switch v := s.(type) {
    case Circle:
        return fmt.Sprintf("circle r=%f", v.R)
    case Square:
        return fmt.Sprintf("square side=%f", v.Side)
    }
    return ""
}

// Later, someone adds:
type Triangle struct{ Base, Height float64 }
func (t Triangle) Area() float64 { return 0.5 * t.Base * t.Height }

// Render(Triangle{...}) returns "" — silently.
```

<details><summary>Diagnosis</summary>

The type switch has no `default` — adding a `Triangle` produces empty output. Even with a `default` returning `"unknown shape"`, the output is still wrong.

**Fix:** put `Render` on the interface.

```go
type Shape interface {
    Area() float64
    Render() string
}

func (c Circle) Render() string { return fmt.Sprintf("circle r=%f", c.R) }
func (s Square) Render() string { return fmt.Sprintf("square side=%f", s.Side) }

// Adding Triangle now requires Render() — compiler enforces.
func (t Triangle) Render() string { return fmt.Sprintf("triangle b=%f h=%f", t.Base, t.Height) }

// Caller:
func Render(s Shape) string { return s.Render() }
```

In Go, the interface method requirement is the closest thing to compile-time exhaustiveness. Use it.
</details>

---

## Bug 10 — Refused Bequest with frozen subclass state (Python)

```python
class Animal:
    def __init__(self, name, sound):
        self.name = name
        self.sound = sound
    
    def speak(self):
        return f"{self.name} says {self.sound}"

class Statue(Animal):
    def __init__(self, name):
        super().__init__(name, sound=None)  # statues don't make sound
    
    def speak(self):
        raise NotImplementedError("Statues are silent")

# Usage:
zoo = [Animal("Dog", "Woof"), Statue("LionStatue")]
for a in zoo:
    print(a.speak())  # crashes on the statue
```

<details><summary>Diagnosis</summary>

`Statue` is not really an `Animal` — it's a static object. Inheriting from `Animal` to reuse `name` is wrong. The for-loop crashes.

**Fix:** don't inherit. Each is its own concept.

```python
from dataclasses import dataclass

@dataclass
class Animal:
    name: str
    sound: str
    def describe(self): return f"{self.name} says {self.sound}"

@dataclass
class Statue:
    name: str
    def describe(self): return f"{self.name} stands silent"

# Common protocol if needed:
class Describable(Protocol):
    def describe(self) -> str: ...

zoo: list[Describable] = [Animal("Dog", "Woof"), Statue("LionStatue")]
for d in zoo:
    print(d.describe())
```

The "Statue is-a Animal" was wrong from the start. Refused Bequest is the symptom.
</details>

---

## Bug 11 — Long switch hides ordering issue (Java)

```java
public Result handleEvent(Event e) {
    switch (e.getType()) {
        case "ORDER_PLACED":
            return placeOrder(e);
        case "PAYMENT_RECEIVED":
            return payOrder(e);
        case "ORDER_PLACED_AND_PAID":  // legacy combined event
            return placeAndPay(e);
        case "ORDER_CANCELLED":
            return cancelOrder(e);
        // ... 10 more cases
        default:
            return Result.unknown();
    }
}
```

<details><summary>Diagnosis</summary>

The legacy `ORDER_PLACED_AND_PAID` event type is handled, but if `placeAndPay` internally fires *separate* `ORDER_PLACED` and `PAYMENT_RECEIVED` events (a common pattern when modernizing), the new events also flow through `handleEvent`. Now the order is processed three times: once via the legacy combined event, once via the new placed event, once via the new paid event.

**Why it hid:** the long switch makes it impossible to see the duplicated processing. Each case looks fine in isolation.

**Fix:** sealed event type + per-handler dispatch.

```java
sealed interface Event permits OrderPlaced, PaymentReceived, OrderCancelled, ... {
    Result handle();
}
```

The legacy combined event is removed (or wrapped to fire only the modern events). The structure makes the duplication impossible.
</details>

---

## Bug 12 — Alternative Classes silently diverge (Java)

```java
class JsonParser {
    public Map<String, Object> parse(String input) {
        if (input == null) return Collections.emptyMap();
        return /* ... actual parsing */;
    }
}

class XmlParser {
    public Map<String, Object> parse(String input) {
        return /* ... actual parsing */;  // throws NPE on null
    }
}

// Caller picks one based on content type:
String contentType = req.getHeader("Content-Type");
Map<String, Object> result;
if (contentType.contains("json")) {
    result = jsonParser.parse(req.getBody());
} else {
    result = xmlParser.parse(req.getBody());  // request without body → NPE
}
```

<details><summary>Diagnosis</summary>

`JsonParser` handles `null` body; `XmlParser` doesn't. They have the same signature but different null semantics. A bodyless XML request crashes; a bodyless JSON request returns empty.

**Fix:** common interface that documents the null contract.

```java
interface ContentParser {
    /** Returns empty map if input is null or empty. */
    Map<String, Object> parse(String input);
}

class JsonParser implements ContentParser { /* honors contract */ }
class XmlParser implements ContentParser {
    public Map<String, Object> parse(String input) {
        if (input == null || input.isEmpty()) return Collections.emptyMap();  // newly added
        // ...
    }
}
```

Codifying the contract in the interface forces both parsers to honor it.
</details>

---

> **Next:** [optimize.md](optimize.md) — inefficient implementations.
