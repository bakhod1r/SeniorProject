# Type-Safe Enums — Practice Tasks

> **Category:** [Resource & Type-Safety Patterns](../README.md) — model fixed sets as real types, with full Go, Java, Python solutions.

10 practice tasks with full Go, Java, Python solutions.

---

## Table of Contents

1. [Task 1: Replace Int Constants With an Enum](#task-1-replace-int-constants-with-an-enum)
2. [Task 2: Enum Carrying Associated Data](#task-2-enum-carrying-associated-data)
3. [Task 3: Strategy-Per-Constant](#task-3-strategy-per-constant)
4. [Task 4: Parse External Input at the Boundary](#task-4-parse-external-input-at-the-boundary)
5. [Task 5: Exhaustive Switch](#task-5-exhaustive-switch)
6. [Task 6: Go Enum Done Right](#task-6-go-enum-done-right)
7. [Task 7: Flag / Bitset Enum](#task-7-flag-bitset-enum)
8. [Task 8: Enum State Machine](#task-8-enum-state-machine)
9. [Task 9: Stable Serialization](#task-9-stable-serialization)
10. [Task 10: Sum Type Where Cases Differ](#task-10-sum-type-where-cases-differ)

---

## Task 1: Replace Int Constants With an Enum

Refactor `int` status constants into a real type.

### Java

```java
// Before
static final int PENDING = 0, PAID = 1, SHIPPED = 2;
void handle(int status) { ... }

// After
public enum Status { PENDING, PAID, SHIPPED }
void handle(Status status) { ... }
```

### Python

```python
from enum import Enum, auto

class Status(Enum):
    PENDING = auto()
    PAID = auto()
    SHIPPED = auto()

def handle(status: Status) -> None: ...
```

### Go

```go
type Status int
const (
    Pending Status = iota
    Paid
    Shipped
)
func handle(status Status) { /* ... */ }
```

---

## Task 2: Enum Carrying Associated Data

Model HTTP statuses with their numeric codes and a category.

### Java

```java
public enum HttpStatus {
    OK(200), CREATED(201), NOT_FOUND(404), SERVER_ERROR(500);

    private final int code;
    HttpStatus(int code) { this.code = code; }

    public int code()       { return code; }
    public boolean isError(){ return code >= 400; }
}
```

### Python

```python
from enum import Enum

class HttpStatus(Enum):
    OK = 200
    CREATED = 201
    NOT_FOUND = 404
    SERVER_ERROR = 500

    @property
    def is_error(self) -> bool:
        return self.value >= 400
```

### Go

```go
type HttpStatus int

const (
    OK          HttpStatus = 200
    Created     HttpStatus = 201
    NotFound    HttpStatus = 404
    ServerError HttpStatus = 500
)

func (h HttpStatus) IsError() bool { return h >= 400 }
```

---

## Task 3: Strategy-Per-Constant

Each operation computes differently; adding one must force implementing it.

### Java

```java
public enum Operation {
    PLUS  { public double apply(double a, double b) { return a + b; } },
    MINUS { public double apply(double a, double b) { return a - b; } },
    TIMES { public double apply(double a, double b) { return a * b; } },
    DIVIDE{ public double apply(double a, double b) { return a / b; } };

    public abstract double apply(double a, double b);
}

double r = Operation.TIMES.apply(6, 7); // 42.0
```

### Python

```python
from enum import Enum

class Operation(Enum):
    PLUS = "+"
    MINUS = "-"
    TIMES = "*"

    def apply(self, a: float, b: float) -> float:
        match self:
            case Operation.PLUS:  return a + b
            case Operation.MINUS: return a - b
            case Operation.TIMES: return a * b
```

### Go

```go
type Operation int
const ( Plus Operation = iota; Minus; Times )

func (o Operation) Apply(a, b float64) float64 {
    switch o {
    case Plus:  return a + b
    case Minus: return a - b
    case Times: return a * b
    default:    panic("unhandled operation")
    }
}
```

---

## Task 4: Parse External Input at the Boundary

Convert raw strings into the enum once, rejecting invalid input.

### Python

```python
from enum import Enum

class Level(Enum):
    DEBUG = "debug"; INFO = "info"; WARN = "warn"; ERROR = "error"

def parse_level(raw: str) -> Level:
    try:
        return Level(raw.lower())
    except ValueError:
        raise ValueError(f"unknown level {raw!r}")
```

### Java

```java
public enum Level {
    DEBUG, INFO, WARN, ERROR;

    public static Level parse(String raw) {
        try {
            return Level.valueOf(raw.toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("unknown level: " + raw);
        }
    }
}
```

### Go

```go
func ParseLevel(raw string) (Level, error) {
    switch strings.ToLower(raw) {
    case "debug": return Debug, nil
    case "info":  return Info, nil
    case "warn":  return Warn, nil
    case "error": return Error, nil
    default:      return 0, fmt.Errorf("unknown level %q", raw)
    }
}
```

---

## Task 5: Exhaustive Switch

Write a switch the compiler (or linter) checks for completeness.

### Java (switch expression — exhaustive)

```java
String label(Status s) {
    return switch (s) {            // no default: adding a constant won't compile
        case PENDING -> "Awaiting payment";
        case PAID    -> "Paid";
        case SHIPPED -> "Shipped";
    };
}
```

### Python (`assert_never`)

```python
from typing import assert_never

def label(s: Status) -> str:
    match s:
        case Status.PENDING: return "Awaiting payment"
        case Status.PAID:    return "Paid"
        case Status.SHIPPED: return "Shipped"
        case _: assert_never(s)   # mypy errors if a case is unhandled
```

### Go (linter-enforced — no `default`)

```go
// With //nolint discipline + the `exhaustive` linter, omit default:
func label(s Status) string {
    switch s { //exhaustive:enforce
    case Pending: return "Awaiting payment"
    case Paid:    return "Paid"
    case Shipped: return "Shipped"
    }
    return "" // unreachable if linter passes
}
```

---

## Task 6: Go Enum Done Right

Add the safety scaffolding Go's compiler omits.

```go
package order

import "fmt"

type Status int

const (
    Pending Status = iota
    Paid
    Shipped
    statusEnd // unexported upper bound
)

//go:generate stringer -type=Status

func (s Status) Valid() bool { return s >= Pending && s < statusEnd }

func ParseStatus(raw string) (Status, error) {
    switch raw {
    case "Pending": return Pending, nil
    case "Paid":    return Paid, nil
    case "Shipped": return Shipped, nil
    default:        return 0, fmt.Errorf("invalid status %q", raw)
    }
}
```

`stringer` generates `String()`; `Valid()` guards bounds; CI runs the `exhaustive` linter.

---

## Task 7: Flag / Bitset Enum

Model combinable permissions.

### Java (`EnumSet`)

```java
enum Perm { READ, WRITE, EXECUTE, DELETE }

EnumSet<Perm> perms = EnumSet.of(Perm.READ, Perm.WRITE);
boolean canWrite = perms.contains(Perm.WRITE);
perms.add(Perm.EXECUTE);
```

### Python (`enum.Flag`)

```python
from enum import Flag, auto

class Perm(Flag):
    READ = auto()
    WRITE = auto()
    EXECUTE = auto()

p = Perm.READ | Perm.WRITE
assert Perm.READ in p
```

### Go (bit shifts)

```go
type Perm uint
const (
    Read    Perm = 1 << iota
    Write
    Execute
)

p := Read | Write
canWrite := p&Write != 0
```

---

## Task 8: Enum State Machine

Encode legal transitions in the type.

### Java

```java
public enum State {
    PENDING { public Set<State> next() { return EnumSet.of(PAID, CANCELLED); } },
    PAID    { public Set<State> next() { return EnumSet.of(SHIPPED); } },
    SHIPPED { public Set<State> next() { return EnumSet.noneOf(State.class); } },
    CANCELLED { public Set<State> next() { return EnumSet.noneOf(State.class); } };

    public abstract Set<State> next();

    public State to(State target) {
        if (!next().contains(target))
            throw new IllegalStateException(this + " -> " + target + " illegal");
        return target;
    }
}
```

### Python

```python
from enum import Enum

class State(Enum):
    PENDING = "pending"; PAID = "paid"; SHIPPED = "shipped"; CANCELLED = "cancelled"

_TRANSITIONS = {
    State.PENDING: {State.PAID, State.CANCELLED},
    State.PAID:    {State.SHIPPED},
    State.SHIPPED: set(),
    State.CANCELLED: set(),
}

def transition(cur: State, target: State) -> State:
    if target not in _TRANSITIONS[cur]:
        raise ValueError(f"{cur} -> {target} illegal")
    return target
```

---

## Task 9: Stable Serialization

Persist a stable code, never the ordinal.

### Java

```java
public enum Status {
    PENDING("P"), PAID("A"), SHIPPED("S");

    private final String code;
    Status(String code) { this.code = code; }
    public String code() { return code; }

    private static final Map<String, Status> BY_CODE = new HashMap<>();
    static { for (Status s : values()) BY_CODE.put(s.code, s); }

    public static Status fromCode(String code) {
        Status s = BY_CODE.get(code);
        if (s == null) throw new IllegalArgumentException("unknown code: " + code);
        return s;
    }
}
```

### Python

```python
from enum import Enum

class Status(Enum):
    PENDING = "P"; PAID = "A"; SHIPPED = "S"

    @classmethod
    def from_code(cls, code: str) -> "Status":
        return cls(code)   # value IS the stable code

db_value = Status.PAID.value          # "A"
restored = Status.from_code(db_value) # Status.PAID
```

### Go

```go
var codeToStatus = map[string]Status{"P": Pending, "A": Paid, "S": Shipped}
var statusToCode = map[Status]string{Pending: "P", Paid: "A", Shipped: "S"}

func (s Status) Code() string { return statusToCode[s] }
func FromCode(c string) (Status, error) {
    s, ok := codeToStatus[c]
    if !ok { return 0, fmt.Errorf("unknown code %q", c) }
    return s, nil
}
```

---

## Task 10: Sum Type Where Cases Differ

When cases carry different data, promote past a flat enum.

### Java (sealed + records, Java 21)

```java
sealed interface Shape permits Circle, Rectangle {}
record Circle(double radius) implements Shape {}
record Rectangle(double w, double h) implements Shape {}

double area(Shape s) {
    return switch (s) {
        case Circle c    -> Math.PI * c.radius() * c.radius();
        case Rectangle r -> r.w() * r.h();
    };
}
```

### Python (dataclasses + match)

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Circle:    radius: float
@dataclass(frozen=True)
class Rectangle: w: float; h: float

Shape = Circle | Rectangle

def area(s: Shape) -> float:
    match s:
        case Circle(radius=r):       return 3.14159 * r * r
        case Rectangle(w=w, h=h):    return w * h
```

### Go (sealed interface)

```go
type Shape interface{ isShape() }
type Circle struct{ R float64 }
type Rect   struct{ W, H float64 }
func (Circle) isShape() {}
func (Rect) isShape()   {}

func Area(s Shape) float64 {
    switch v := s.(type) {
    case Circle: return math.Pi * v.R * v.R
    case Rect:   return v.W * v.H
    default:     panic("unhandled shape")
    }
}
```

---

## Practice Tips

1. **Always parse external input into the enum at the boundary**, then stay typed.
2. **Avoid `default:` over your own closed enums** so exhaustiveness checks keep working.
3. **Persist names or explicit codes, never ordinals.**
4. **In Go, pair every enum with `stringer`, `Valid()`, and the `exhaustive` linter.**
5. **When cases need different fields, switch from a flat enum to a sum type.**

---

[← Interview](interview.md) · [Resource & Type-Safety](../README.md) · [Roadmap](../../../README.md) · **Next:** [Find-Bug](find-bug.md)
</content>
