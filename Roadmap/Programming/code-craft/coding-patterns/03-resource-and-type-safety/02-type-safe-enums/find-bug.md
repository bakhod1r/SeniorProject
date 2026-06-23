# Type-Safe Enums — Find the Bug

> **Category:** [Resource & Type-Safety Patterns](../README.md) — the recurring ways enum code quietly defeats its own type safety.

12 buggy snippets across Go, Java, Python.

---

## Bug 1: Persisting the Ordinal (Java)

```java
enum Status { PENDING, PAID, SHIPPED }

db.save(order.id, order.status.ordinal());   // BUG: stores 0,1,2

// Later, someone alphabetizes:
enum Status { CANCELLED, PAID, PENDING, SHIPPED }
Status restored = Status.values()[storedOrdinal];   // wrong constant now
```

**Symptoms:** After reordering constants, every persisted record maps to the wrong status.

<details><summary>Find the bug</summary>

`ordinal()` is declaration position. Reordering changes the int→constant mapping while stored bytes stay the same — silent corruption.

</details>

### Fix

```java
db.save(order.id, order.status.name());                 // store name
Status restored = Status.valueOf(storedName);           // resolve by name
```

### Lesson

Never persist ordinals. Store the name or an explicit stable code.

---

## Bug 2: Stringly-Typed Comparison Sneaks Back In (Python)

```python
class Status(Enum):
    PENDING = "pending"; PAID = "paid"

def is_paid(s: Status) -> bool:
    return str(s) == "paid"   # BUG: str(Status.PAID) == "Status.PAID"
```

**Symptoms:** `is_paid(Status.PAID)` returns `False` — `str(enum)` is `"Status.PAID"`, not `"paid"`.

<details><summary>Find the bug</summary>

Comparing the enum's string form to a raw literal reintroduces stringly-typed fragility — and `str(member)` isn't the value anyway.

</details>

### Fix

```python
def is_paid(s: Status) -> bool:
    return s is Status.PAID   # compare to the enum member
```

### Lesson

Compare enums to enum members (`is`/`==`), never to string literals.

---

## Bug 3: Go Accepts an Illegal Value (Go)

```go
type Status int
const ( Pending Status = iota; Paid; Shipped )

func process(s Status) {
    // assumes s is one of the three
}

process(99)   // BUG: compiles and runs
```

**Symptoms:** `process(99)` proceeds with a nonsense status; downstream logic misbehaves.

<details><summary>Find the bug</summary>

Go's named-int "enum" accepts any int. There's no compile-time closed-set check.

</details>

### Fix

```go
func process(s Status) error {
    if !s.Valid() { return fmt.Errorf("invalid status %d", s) }
    // ...
    return nil
}
func (s Status) Valid() bool { return s >= Pending && s <= Shipped }
```

### Lesson

In Go, validate enum values at entry. The type alone guarantees nothing.

---

## Bug 4: Blanket `default:` Hides a New Case (Java)

```java
int discount(Tier t) {
    switch (t) {
        case BRONZE: return 0;
        case SILVER: return 5;
        default:     return 0;   // BUG: GOLD silently gets 0
    }
}
// Later: enum Tier { BRONZE, SILVER, GOLD }
```

**Symptoms:** Adding `GOLD` compiles cleanly; gold customers silently get a 0% discount.

<details><summary>Find the bug</summary>

The `default:` swallows the new constant. Exhaustiveness checking is disabled by the catch-all.

</details>

### Fix

```java
int discount(Tier t) {
    return switch (t) {          // switch expression, no default
        case BRONZE -> 0;
        case SILVER -> 5;
        case GOLD   -> 10;
    };
    // Adding a constant now fails to compile until handled.
}
```

### Lesson

Don't use `default:` over your own closed enum — it disables the compiler's help.

---

## Bug 5: Python Enum Alias Swallows a Member (Python)

```python
class Color(Enum):
    RED = 1
    GREEN = 2
    CRIMSON = 1   # BUG: same value as RED → becomes an alias, not a member
```

**Symptoms:** `Color.CRIMSON is Color.RED` is `True`; iterating `Color` yields only RED and GREEN. `CRIMSON` isn't a distinct member.

<details><summary>Find the bug</summary>

Two members with the same value: the second is an alias of the first, silently collapsing the intended distinct constant.

</details>

### Fix

```python
from enum import Enum, unique

@unique          # raises ValueError on duplicate values
class Color(Enum):
    RED = 1
    GREEN = 2
    CRIMSON = 3
```

### Lesson

Use `@unique` to catch accidental aliasing of enum members.

---

## Bug 6: Parallel Array Keyed by Ordinal (Java)

```java
enum Day { MON, TUE, WED }
static final String[] LABELS = {"Monday", "Tuesday", "Wednesday"};

String label(Day d) { return LABELS[d.ordinal()]; }   // BUG: fragile coupling
```

**Symptoms:** Add `SUN` at the front of `Day`, and every label shifts by one.

<details><summary>Find the bug</summary>

The label array is indexed by ordinal. Reordering or inserting constants desyncs labels from days.

</details>

### Fix

```java
enum Day {
    MON("Monday"), TUE("Tuesday"), WED("Wednesday");
    private final String label;
    Day(String label) { this.label = label; }
    public String label() { return label; }
}
```

### Lesson

Move associated data *into* the enum; never key a parallel array by ordinal.

---

## Bug 7: Unknown Deserialized Value Masquerades as Valid (Java)

```java
Status status = Status.values()[jsonInt];   // BUG: no bounds check
```

**Symptoms:** A producer on a newer version sends `jsonInt = 4`; `values()[4]` throws `ArrayIndexOutOfBoundsException` — or worse, an off-by-one maps to the wrong constant.

<details><summary>Find the bug</summary>

Trusting external input as an ordinal index. Unknown/forward values aren't handled explicitly.

</details>

### Fix

```java
Status fromWire(String name) {
    try { return Status.valueOf(name); }
    catch (IllegalArgumentException e) { return Status.UNKNOWN; } // explicit
}
```

### Lesson

Decode unknown values explicitly (UNKNOWN or fail fast). Never index `values()` with untrusted input.

---

## Bug 8: Go Closure Captures Loop Variable Over Enum (Go)

```go
var handlers []func() Status
for s := Pending; s <= Shipped; s++ {
    handlers = append(handlers, func() Status { return s })   // BUG pre-Go 1.22
}
// every handler returns Shipped+1
```

**Symptoms:** All handlers return the same (final) status.

<details><summary>Find the bug</summary>

Pre-Go 1.22 the loop variable `s` is shared; all closures capture the same `s`, which is past `Shipped` after the loop.

</details>

### Fix

```go
for s := Pending; s <= Shipped; s++ {
    s := s   // shadow per iteration
    handlers = append(handlers, func() Status { return s })
}
```

### Lesson

Shadow loop variables captured in closures (or use Go 1.22+).

---

## Bug 9: Mutable State on an Enum Constant (Java)

```java
enum Counter {
    INSTANCE;
    private int count = 0;          // BUG: shared mutable global state
    public void inc() { count++; }
}
```

**Symptoms:** Because the constant is a singleton, `count` is global mutable state — racy under concurrency, surprising across the app.

<details><summary>Find the bug</summary>

Enum constants are effectively global singletons. Mutable fields make them shared mutable global state.

</details>

### Fix

```java
// Keep enums immutable; store mutable per-thing state elsewhere.
enum Counter { INSTANCE }
// counting belongs in a regular object, not an enum constant.
```

### Lesson

Enum constants should be immutable. They're singletons — mutable fields are global state.

---

## Bug 10: StrEnum Compared to Wrong Case (Python)

```python
from enum import StrEnum

class Color(StrEnum):
    RED = "red"

if user_input == Color.RED:    # user_input = "RED"
    ...                        # BUG: "RED" != "red"
```

**Symptoms:** Case-mismatched input silently fails to match, because `StrEnum` compares by its (lowercase) value.

<details><summary>Find the bug</summary>

`StrEnum` equals its string value (`"red"`). Comparing to `"RED"` fails. Worse, `StrEnum`'s loose `str` equality invites exactly this stringly-typed slip.

</details>

### Fix

```python
try:
    color = Color(user_input.lower())   # normalize + parse at boundary
except ValueError:
    raise ValueError(f"unknown color {user_input!r}")
```

### Lesson

Normalize and parse into the enum at the boundary; don't lean on `StrEnum`'s loose equality.

---

## Bug 11: Sealed Interface Not Actually Sealed (Go)

```go
type Shape interface{ Area() float64 }   // BUG: any type can implement this

func describe(s Shape) string {
    switch s.(type) {
    case Circle: return "circle"
    case Rect:   return "rect"
    default:     return "???"   // a new external Shape lands here silently
    }
}
```

**Symptoms:** Anyone outside the package can implement `Shape`; the `switch` can't be exhaustive and the linter can't help.

<details><summary>Find the bug</summary>

The interface has only an exported method, so it's open. There's no `isShape()` sealing method limiting implementors to this package.

</details>

### Fix

```go
type Shape interface { Area() float64; isShape() }   // unexported method seals it
func (Circle) isShape() {}
func (Rect) isShape()   {}
```

### Lesson

Seal a Go sum-type interface with an unexported method; then `go-check-sumtype` can verify exhaustiveness.

---

## Bug 12: protobuf Enum Zero Value Means Something (proto/Java)

```protobuf
enum Status {
  PENDING = 0;   // BUG: zero value is a meaningful state
  PAID = 1;
}
```

```java
// A message that never sets status:
Order o = Order.newBuilder().build();
o.getStatus();   // returns PENDING — but it was never set!
```

**Symptoms:** Absent `status` fields silently read as `PENDING`; "not set" is indistinguishable from "pending."

<details><summary>Find the bug</summary>

Proto3 uses the enum's zero value as the default for unset fields. Assigning a real state to 0 makes "unset" masquerade as that state.

</details>

### Fix

```protobuf
enum Status {
  STATUS_UNSPECIFIED = 0;   // reserve zero for "unknown"
  STATUS_PENDING = 1;
  STATUS_PAID = 2;
}
```

### Lesson

In protobuf, the zero value must be `UNSPECIFIED` so absent fields are detectable.

---

## Practice Tips

1. **Grep for `.ordinal()` and `values()[`** — both are persistence/indexing landmines.
2. **Run the `exhaustive` linter** on Go switches; add `assert_never` in Python.
3. **Test deserialization of an unknown value** explicitly.
4. **Apply `@unique`** to Python enums to catch aliasing.
5. **Audit every `default:`** over a closed enum — it usually shouldn't exist.

---

[← Tasks](tasks.md) · [Resource & Type-Safety](../README.md) · [Roadmap](../../../README.md) · **Next:** [Optimize](optimize.md)
</content>
