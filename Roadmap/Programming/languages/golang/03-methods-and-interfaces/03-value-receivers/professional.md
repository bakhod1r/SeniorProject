# Value Receivers — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Domain-Driven Design with Value Objects](#domain-driven-design-with-value-objects)
3. [API Design — Value vs Pointer](#api-design-value-vs-pointer)
4. [Library Design Conventions](#library-design-conventions)
5. [Testing Value-Receiver Methods](#testing-value-receiver-methods)
6. [Production Patterns](#production-patterns)
7. [Migration Strategies](#migration-strategies)
8. [Documentation Standards](#documentation-standards)
9. [Cheat Sheet](#cheat-sheet)

---

## Introduction

At the professional level, value receivers cover:
- The value object pattern in DDD
- API design decisions and stability
- Library design conventions
- Production-grade testing and documentation

---

## Domain-Driven Design with Value Objects

### Value object definition

In DDD, a **value object** has no identity (different instances may be equal), is immutable, and equality is determined by its fields.

```go
type Money struct {
    amount int64
    currency Currency
}

// Immutable — Add returns a new Money
func (m Money) Add(o Money) (Money, error) {
    if m.currency != o.currency {
        return Money{}, ErrCurrencyMismatch
    }
    return Money{amount: m.amount + o.amount, currency: m.currency}, nil
}

func (m Money) Format() string { ... }
func (m Money) IsZero() bool { return m.amount == 0 }
```

### Aggregate vs value object

| Concept | Receiver |
|---------|----------|
| **Aggregate root** (Order, User, Account) — has identity, mutable | Pointer |
| **Value object** (Money, Address, Coordinate) — no identity, immutable | Value |
| **Domain event** (OrderPlaced, UserRegistered) | Value (immutable) |
| **Specification/Policy** | Value (stateless logic) |

### Equality

```go
type Address struct {
    street, city, zip string
}

// `==` works — all fields are comparable
addr1 := Address{"Main St", "NY", "10001"}
addr2 := Address{"Main St", "NY", "10001"}
fmt.Println(addr1 == addr2)  // true
```

### Validation in constructor

```go
type Email struct{ value string }

func NewEmail(s string) (Email, error) {
    if !strings.Contains(s, "@") {
        return Email{}, errors.New("invalid email")
    }
    return Email{value: s}, nil
}

func (e Email) String() string { return e.value }
func (e Email) Domain() string { ... }
```

Constructor validation — an invalid Email cannot be constructed.

---

## API Design — Value vs Pointer

### Library API choice

```go
// time package — value receiver
func Now() Time
func (t Time) Add(d Duration) Time
func (t Time) Before(u Time) bool

// http package — pointer receiver
func NewClient() *Client
func (c *Client) Do(req *Request) (*Response, error)
```

### Choice criteria

| Criterion | Value | Pointer |
|-----------|-------|---------|
| Immutable? | Yes | No |
| Hashable? | Yes | Yes (pointer is comparable) |
| Concurrent safe? | Yes | Sync required |
| Resource holder? | No | Yes |
| Big struct? | No | Yes |

### Stability

Value vs pointer is a public API decision. Changing it is breaking:

```go
// v1
func (m Money) Add(o Money) Money

// v2 (BREAKING)
func (m *Money) Add(o Money) // method set + caller
```

---

## Library Design Conventions

### Convention 1: Small + immutable → value

```go
type Color struct{ R, G, B, A uint8 }
func (c Color) Brighten() Color { ... }
```

### Convention 2: Constructor returns a value

```go
func NewColor(r, g, b uint8) Color {
    return Color{R: r, G: g, B: b, A: 255}
}
```

### Convention 3: Stringer/Equal — value receiver

```go
type Status int
func (s Status) String() string { ... }
func (s Status) Equals(o Status) bool { return s == o }
```

### Convention 4: `Add`/`Sub` — return a new value

```go
func (a Vec) Add(b Vec) Vec { return Vec{a.X + b.X, a.Y + b.Y} }
```

`Add` — fluent and immutable.

### Convention 5: Boolean — `Is`/`Has`/`Can`

```go
func (e Email) IsValid() bool { ... }
func (m Money) IsZero() bool { ... }
```

### Convention 6: Hashable for map keys

A value object can serve as a map key:

```go
type Currency string

balances := map[Currency]Money{}
balances[USD] = Money{amount: 100, currency: USD}
```

---

## Testing Value-Receiver Methods

### Pure function — clean unit test

```go
func TestMoney_Add(t *testing.T) {
    a := Money{amount: 100, currency: USD}
    b := Money{amount: 50, currency: USD}
    sum, err := a.Add(b)
    if err != nil { t.Fatalf("unexpected error: %v", err) }
    if sum.amount != 150 { t.Errorf("got %d, want 150", sum.amount) }

    // Immutability check
    if a.amount != 100 { t.Errorf("a was mutated: %d", a.amount) }
    if b.amount != 50 { t.Errorf("b was mutated: %d", b.amount) }
}
```

### Table-driven

```go
func TestMoney_Format(t *testing.T) {
    tests := []struct {
        m    Money
        want string
    }{
        {Money{amount: 0, currency: USD},   "0.00 USD"},
        {Money{amount: 100, currency: USD}, "1.00 USD"},
        {Money{amount: -50, currency: USD}, "-0.50 USD"},
    }
    for _, tc := range tests {
        if got := tc.m.Format(); got != tc.want {
            t.Errorf("Format(%v) = %q, want %q", tc.m, got, tc.want)
        }
    }
}
```

### Property-based testing

```go
import "testing/quick"

func TestMoney_AddCommutative(t *testing.T) {
    f := func(a, b int64) bool {
        x := Money{amount: a, currency: USD}
        y := Money{amount: b, currency: USD}
        sum1, _ := x.Add(y)
        sum2, _ := y.Add(x)
        return sum1 == sum2
    }
    if err := quick.Check(f, nil); err != nil {
        t.Error(err)
    }
}
```

Value receiver — pure function — ideal for property-based tests.

---

## Production Patterns

### Pattern 1: Money / Decimal

```go
type Money struct{ amount int64; currency Currency }

func New(amount int64, c Currency) Money { return Money{amount, c} }
func (m Money) Add(o Money) (Money, error) { ... }
func (m Money) Sub(o Money) (Money, error) { ... }
func (m Money) Mul(factor int64) Money    { return Money{m.amount * factor, m.currency} }
func (m Money) Format() string { ... }
func (m Money) Marshal() ([]byte, error) { ... }
```

### Pattern 2: ID/UUID wrapper

```go
type UserID struct{ uuid uuid.UUID }

func NewUserID() UserID                  { return UserID{uuid: uuid.New()} }
func ParseUserID(s string) (UserID, error) { ... }
func (id UserID) String() string         { return id.uuid.String() }
func (id UserID) IsZero() bool           { return id.uuid == uuid.Nil }
```

### Pattern 3: Coordinate/Vector

```go
type Vec2 struct{ X, Y float64 }

func (v Vec2) Add(o Vec2) Vec2     { return Vec2{v.X + o.X, v.Y + o.Y} }
func (v Vec2) Scale(s float64) Vec2 { return Vec2{v.X * s, v.Y * s} }
func (v Vec2) Length() float64     { return math.Hypot(v.X, v.Y) }
func (v Vec2) Normalize() Vec2     { l := v.Length(); return v.Scale(1/l) }
```

### Pattern 4: Domain event

```go
type OrderPlaced struct {
    OrderID   string
    UserID    string
    Total     Money
    OccurredAt time.Time
}

func (e OrderPlaced) EventName() string { return "OrderPlaced" }
func (e OrderPlaced) Marshal() ([]byte, error) { return json.Marshal(e) }
```

A domain event is immutable (it has already happened).

### Pattern 5: Specification (filter)

```go
type AgeAbove struct{ Min int }

func (s AgeAbove) IsSatisfiedBy(u User) bool { return u.Age >= s.Min }

type And struct{ A, B Specification }
func (s And) IsSatisfiedBy(u User) bool {
    return s.A.IsSatisfiedBy(u) && s.B.IsSatisfiedBy(u)
}
```

Specifications are values that work through composition.

---

## Migration Strategies

### V1: Value → V2: Pointer (BREAKING)

```go
// v1
func (c Counter) Inc() Counter { ... }   // immutable

// v2 — breaking
func (c *Counter) Inc() { ... }          // mutable
```

Migration:
1. Create a new type or new package
2. Keep the old API alongside (v1.x)
3. Make the breaking change in a major version

### V1: Pointer → V2: Value (BREAKING)

Rare — moving from pointer to value is usually breaking. Proceed with caution.

### Soft migration

```go
// v1.x — support both
type CounterV2 struct{ ... }
func (c CounterV2) Inc() CounterV2 { ... }

// v1.5 — new type added, old one still adequate
// v2 — old one removed
```

---

## Documentation Standards

### Public method comment

```go
// Add returns a new Money equal to m + o.
// It returns an error if the currencies do not match.
//
// Add does not modify m or o.
func (m Money) Add(o Money) (Money, error) { ... }
```

### Immutability disclaimer

```go
// Money represents an amount of money in a specific currency.
//
// Money is immutable. All methods return new Money values without
// modifying the receiver.
//
// Money is comparable using ==.
type Money struct { ... }
```

### Equality semantics

```go
// Two Address values are equal if all their fields are equal.
// Use the == operator or call Equals.
type Address struct { ... }
```

---

## Cheat Sheet

```
DDD VALUE OBJECT
─────────────────────────────
No identity → equality by fields
Immutable → every method returns a new value
Constructor validation
Comparable for map keys

API DESIGN
─────────────────────────────
Small + immutable → value
Resource/state → pointer
Public API stability — avoid breaking changes

CONVENTIONS
─────────────────────────────
Stringer/Equal → value
Add/Sub/Mul → return new
Is/Has/Can → boolean
Constructor returns value

TESTING
─────────────────────────────
Pure unit test
Table-driven
Property-based (quick.Check)

PATTERNS
─────────────────────────────
Money, ID, Vec — value object
Domain event — immutable
Specification — value compose

DOCUMENTATION
─────────────────────────────
Write "Immutable"
Explain equality semantics
Concurrency safety — implicit (immutable is safe)
```

---

## Summary

Professional value receivers:
- The DDD value object pattern
- Library API decisions and stability
- Conventions — Stringer, Add, Is/Has/Can
- Tests — pure, table-driven, property-based
- Production patterns — Money, ID, Vec, event, specification
- Documentation — immutability, equality, concurrency safety

A value receiver is a simple, powerful, reliable tool in Go. It is ideal for expressing immutable value objects in domain modelling — fewer bugs, more tests, and concurrency concerns become straightforward.
