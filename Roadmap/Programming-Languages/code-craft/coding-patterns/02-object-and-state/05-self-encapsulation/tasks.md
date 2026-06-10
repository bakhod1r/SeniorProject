# Self-Encapsulation — Practice Tasks

> **Category:** [Object & State Patterns](../README.md) — drills in routing internal field access through accessors and exploiting the resulting seam.

10 practice tasks with full Go, Java, and Python solutions.

---

## Table of Contents

1. [Task 1: Self-Encapsulate Field](#task-1-self-encapsulate-field)
2. [Task 2: Replace Stored with Computed](#task-2-replace-stored-with-computed)
3. [Task 3: Validating Setter](#task-3-validating-setter)
4. [Task 4: Subclass Overrides a "Field"](#task-4-subclass-overrides-a-field)
5. [Task 5: Lazy Field Behind an Accessor](#task-5-lazy-field-behind-an-accessor)
6. [Task 6: Python — Attribute to @property](#task-6-python--attribute-to-property)
7. [Task 7: Construct Through the Setter](#task-7-construct-through-the-setter)
8. [Task 8: Uniform Access Round-Trip](#task-8-uniform-access-round-trip)
9. [Task 9: Avoid the Constructor Hazard](#task-9-avoid-the-constructor-hazard)
10. [Task 10: Thread-Safe Lazy Accessor](#task-10-thread-safe-lazy-accessor)

---

## Task 1: Self-Encapsulate Field

**Goal:** Route every internal read/write of `total` through accessors.

### Java

```java
public class Order {
    private double total;

    public double getTotal()        { return total; }
    public void setTotal(double t)  { this.total = t; }

    public double withTax()      { return getTotal() * 1.2; }
    public double withDiscount() { return getTotal() * 0.9; }
    public void   addCharge(double c) { setTotal(getTotal() + c); }
}
```

### Python

```python
class Order:
    def __init__(self) -> None:
        self._total = 0.0

    @property
    def total(self) -> float:
        return self._total

    @total.setter
    def total(self, value: float) -> None:
        self._total = value

    def with_tax(self) -> float:      return self.total * 1.2
    def with_discount(self) -> float: return self.total * 0.9
    def add_charge(self, c: float) -> None:
        self.total += c
```

### Go

```go
type Order struct{ total float64 }

func (o *Order) Total() float64       { return o.total }
func (o *Order) SetTotal(t float64)   { o.total = t }
func (o *Order) WithTax() float64     { return o.Total() * 1.2 }
func (o *Order) AddCharge(c float64)  { o.SetTotal(o.Total() + c) }
```

---

## Task 2: Replace Stored with Computed

**Goal:** Turn `total` into a derived sum — change only the getter.

### Java

```java
public class Order {
    private final List<Double> lineItems = new ArrayList<>();

    public void add(double amount) { lineItems.add(amount); }

    // Was: return total;  Now: derived. Callers below are untouched.
    public double getTotal() {
        return lineItems.stream().mapToDouble(Double::doubleValue).sum();
    }
    public double withTax() { return getTotal() * 1.2; }  // unchanged
}
```

### Python

```python
class Order:
    def __init__(self) -> None:
        self._items: list[float] = []

    def add(self, amount: float) -> None:
        self._items.append(amount)

    @property
    def total(self) -> float:      # was self._total; now computed
        return sum(self._items)

    def with_tax(self) -> float:   # unchanged
        return self.total * 1.2
```

### Go

```go
type Order struct{ items []float64 }

func (o *Order) Add(amount float64) { o.items = append(o.items, amount) }

func (o *Order) Total() float64 {   // now computed
    var s float64
    for _, v := range o.items {
        s += v
    }
    return s
}
func (o *Order) WithTax() float64 { return o.Total() * 1.2 } // unchanged
```

---

## Task 3: Validating Setter

**Goal:** Make the setter the single guard for `0 ≤ percent ≤ 100`.

### Java

```java
public class Discount {
    private int percent;
    public int getPercent() { return percent; }
    public void setPercent(int p) {
        if (p < 0 || p > 100) throw new IllegalArgumentException("0..100");
        this.percent = p;
    }
    public void bump(int by) { setPercent(getPercent() + by); } // can't go illegal
}
```

### Python

```python
class Discount:
    def __init__(self) -> None:
        self._percent = 0

    @property
    def percent(self) -> int:
        return self._percent

    @percent.setter
    def percent(self, p: int) -> None:
        if not 0 <= p <= 100:
            raise ValueError("0..100")
        self._percent = p

    def bump(self, by: int) -> None:
        self.percent += by
```

### Go

```go
type Discount struct{ percent int }

func (d *Discount) Percent() int { return d.percent }
func (d *Discount) SetPercent(p int) error {
    if p < 0 || p > 100 {
        return errors.New("0..100")
    }
    d.percent = p
    return nil
}
func (d *Discount) Bump(by int) error { return d.SetPercent(d.Percent() + by) }
```

---

## Task 4: Subclass Overrides a "Field"

**Goal:** A `PremiumAccount` changes the rate by overriding an accessor.

### Java

```java
public class Account {
    private double rate = 0.02;
    protected double getRate() { return rate; }
    public double interest(double balance) { return balance * getRate(); }
}
public class PremiumAccount extends Account {
    @Override protected double getRate() { return 0.05; }
}
// new PremiumAccount().interest(1000) == 50.0
```

### Python

```python
class Account:
    def __init__(self) -> None:
        self._rate = 0.02

    @property
    def rate(self) -> float:
        return self._rate

    def interest(self, balance: float) -> float:
        return balance * self.rate

class PremiumAccount(Account):
    @property
    def rate(self) -> float:
        return 0.05
```

### Go

```go
// Go favors composition + interfaces over overriding.
type RateSource interface{ Rate() float64 }

type Account struct{ rate float64 }
func (a Account) Rate() float64 { return a.rate }

func Interest(rs RateSource, balance float64) float64 { return balance * rs.Rate() }

type Premium struct{}
func (Premium) Rate() float64 { return 0.05 }
// Interest(Premium{}, 1000) == 50.0
```

---

## Task 5: Lazy Field Behind an Accessor

**Goal:** Parse tokens on first access; callers unchanged.

### Java

```java
public class Document {
    private final String raw;
    private List<String> tokens;            // null until needed
    public Document(String raw) { this.raw = raw; }

    private List<String> getTokens() {
        if (tokens == null) tokens = Arrays.asList(raw.split("\\s+"));
        return tokens;
    }
    public int wordCount() { return getTokens().size(); }
}
```

### Python

```python
from functools import cached_property

class Document:
    def __init__(self, raw: str) -> None:
        self._raw = raw

    @cached_property
    def tokens(self) -> list[str]:   # computed once, then stored
        return self._raw.split()

    def word_count(self) -> int:
        return len(self.tokens)
```

### Go

```go
type Document struct {
    raw    string
    tokens []string
}
func (d *Document) Tokens() []string {
    if d.tokens == nil {
        d.tokens = strings.Fields(d.raw)
    }
    return d.tokens
}
func (d *Document) WordCount() int { return len(d.Tokens()) }
```

---

## Task 6: Python — Attribute to @property

**Goal:** Show the zero-cost upgrade path that makes Python special.

```python
# Version 1 — ship this. No accessors.
class Temperature:
    def __init__(self, celsius: float) -> None:
        self.celsius = celsius

# Version 2 — a requirement appears: reject below absolute zero.
# Callers using `t.celsius` do NOT change.
class Temperature:                       # noqa: F811
    def __init__(self, celsius: float) -> None:
        self.celsius = celsius           # routes through the setter below

    @property
    def celsius(self) -> float:
        return self._celsius

    @celsius.setter
    def celsius(self, value: float) -> None:
        if value < -273.15:
            raise ValueError("below absolute zero")
        self._celsius = value

    @property
    def fahrenheit(self) -> float:       # computed "field" — UAP
        return self.celsius * 9 / 5 + 32
```

`t.celsius` and `t.fahrenheit` read identically — the caller cannot tell stored from computed.

---

## Task 7: Construct Through the Setter

**Goal:** Enforce the invariant from creation.

### Java

```java
public final class Port {
    private int number;
    public Port(int number) { setNumber(number); }  // validate at construction
    public int getNumber() { return number; }
    public void setNumber(int n) {
        if (n < 1 || n > 65535) throw new IllegalArgumentException("1..65535");
        this.number = n;
    }
}
```

### Python

```python
class Port:
    def __init__(self, number: int) -> None:
        self.number = number          # runs the validating setter

    @property
    def number(self) -> int:
        return self._number

    @number.setter
    def number(self, n: int) -> None:
        if not 1 <= n <= 65535:
            raise ValueError("1..65535")
        self._number = n
```

### Go

```go
type Port struct{ number int }
func NewPort(n int) (*Port, error) {
    p := &Port{}
    if err := p.SetNumber(n); err != nil { // construct through setter
        return nil, err
    }
    return p, nil
}
func (p *Port) Number() int { return p.number }
func (p *Port) SetNumber(n int) error {
    if n < 1 || n > 65535 {
        return errors.New("1..65535")
    }
    p.number = n
    return nil
}
```

---

## Task 8: Uniform Access Round-Trip

**Goal:** Expose a value that may be stored *or* computed without callers caring.

### Python

```python
class Circle:
    def __init__(self, radius: float) -> None:
        self.radius = radius

    @property
    def area(self) -> float:        # computed; could be cached later, callers blind
        import math
        return math.pi * self.radius ** 2

c = Circle(2)
print(c.area)     # caller writes the same code whether area is stored or computed
```

### Java

```java
public class Circle {
    private final double radius;
    public Circle(double r) { this.radius = r; }
    public double getRadius() { return radius; }
    public double getArea() { return Math.PI * getRadius() * getRadius(); }
    // getArea() reads like getRadius() — same notation, UAP within reach
}
```

---

## Task 9: Avoid the Constructor Hazard

**Goal:** Prevent an overridable setter from running during construction.

### Java

```java
public class Base {
    private int level;
    public Base(int level) {
        this.level = level;          // set the RAW field, not setLevel()
    }
    public final void setLevel(int l) { this.level = l; } // final → can't override
    public int getLevel() { return level; }
}

public class Derived extends Base {
    private int doubled;
    public Derived(int level) {
        super(level);                // no overridable call during super()
        this.doubled = level * 2;    // safe: runs after Derived is set up
    }
}
```

If `setLevel` were overridable and called from the constructor, the override would run before `doubled` existed. Marking it `final` (or assigning the raw field) removes the hazard.

---

## Task 10: Thread-Safe Lazy Accessor

**Goal:** Make the lazy seam safe under concurrency.

### Java (double-checked locking)

```java
public class Config {
    private volatile Settings settings;
    public Settings getSettings() {
        Settings s = settings;
        if (s == null) {
            synchronized (this) {
                s = settings;
                if (s == null) settings = s = load();
            }
        }
        return s;
    }
    private Settings load() { /* expensive */ return new Settings(); }
}
```

### Go (`sync.Once`)

```go
type Config struct {
    once     sync.Once
    settings *Settings
}
func (c *Config) Settings() *Settings {
    c.once.Do(func() { c.settings = load() })
    return c.settings
}
```

### Python (lock-guarded)

```python
import threading

class Config:
    def __init__(self) -> None:
        self._settings = None
        self._lock = threading.Lock()

    @property
    def settings(self):
        if self._settings is None:
            with self._lock:
                if self._settings is None:
                    self._settings = self._load()
        return self._settings
```

---

## Practice Tips

1. **Route consistently** — never read the raw field in some methods and the getter in others.
2. **Change behind the getter** — practice swapping stored → computed → lazy without touching callers.
3. **In Python, start with attributes**; only reach for `@property` when a real need appears.
4. **In Go, add accessors only with an invariant or interface.**
5. **Watch constructors** — never call an overridable setter from one in Java/C#.

---

[← Interview](interview.md) · [Object & State](../README.md) · **Next:** [Find-Bug](find-bug.md)
