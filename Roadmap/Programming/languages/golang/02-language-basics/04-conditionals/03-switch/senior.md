# switch Statement — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Architectural Role of switch](#architectural-role-of-switch)
3. [Compiler Internals](#compiler-internals)
4. [Type Switch Deep Dive](#type-switch-deep-dive)
5. [Large-Scale Patterns](#large-scale-patterns)
6. [Postmortems & Real Failures](#postmortems-real-failures)
7. [Performance Benchmarks](#performance-benchmarks)
8. [Advanced Testing](#advanced-testing)
9. [Concurrency Considerations](#concurrency-considerations)
10. [Linting and Static Analysis](#linting-and-static-analysis)
11. [Test](#test)
12. [Tricky Questions](#tricky-questions)
13. [Summary](#summary)
14. [Further Reading](#further-reading)

---

## Introduction

At the senior level, `switch` is understood as an architectural decision tool that enforces exhaustiveness, communicates intent, and enables safe evolution of code. The difference between a `switch` and an `if-else` chain is not just style — it signals to the reader that you are matching a discriminated value with mutually exclusive, exhaustive cases. This signal matters during code reviews and maintenance.

The senior engineer's most important insight about `switch` is: **an unhandled default is a design smell**. When you write `switch state { case A: ... case B: ... }` without a `default:`, you are implicitly saying "I don't care what happens for unknown states." This is often wrong. Exhaustive `switch` statements — either by handling all cases or by making the `default` an explicit error — are a hallmark of robust production code.

---

## Architectural Role of switch

### switch as a discriminated union handler

In Go, the common pattern of iota-based enums + switch creates a discriminated union:

```go
type EventType int

const (
    EventCreated EventType = iota
    EventUpdated
    EventDeleted
    EventArchived
)

// Exhaustive switch — all EventTypes handled
func handleEvent(e Event) error {
    switch e.Type {
    case EventCreated:
        return onCreated(e)
    case EventUpdated:
        return onUpdated(e)
    case EventDeleted:
        return onDeleted(e)
    case EventArchived:
        return onArchived(e)
    default:
        return fmt.Errorf("unhandled event type: %d", e.Type)
    }
}
```

When a new `EventType` is added, the `default` case catches it immediately in tests, forcing the developer to handle it.

### switch in the visitor pattern

```go
type Node interface{ isNode() }
type IntLiteral struct{ Value int }
type StringLiteral struct{ Value string }
type BinaryExpr struct{ Left, Right Node; Op string }

func (IntLiteral) isNode()    {}
func (StringLiteral) isNode() {}
func (BinaryExpr) isNode()    {}

func evaluate(node Node) (interface{}, error) {
    switch n := node.(type) {
    case IntLiteral:
        return n.Value, nil
    case StringLiteral:
        return n.Value, nil
    case BinaryExpr:
        left, err := evaluate(n.Left)
        if err != nil {
            return nil, err
        }
        right, err := evaluate(n.Right)
        if err != nil {
            return nil, err
        }
        switch n.Op {
        case "+":
            return left.(int) + right.(int), nil
        case "*":
            return left.(int) * right.(int), nil
        default:
            return nil, fmt.Errorf("unknown operator: %s", n.Op)
        }
    default:
        return nil, fmt.Errorf("unknown node type: %T", n)
    }
}
```

### State machine with switch

```go
type State string

const (
    StateIdle     State = "idle"
    StateFetching State = "fetching"
    StateSuccess  State = "success"
    StateError    State = "error"
)

type Event string

const (
    EventFetch   Event = "fetch"
    EventSuccess Event = "success"
    EventError   Event = "error"
    EventReset   Event = "reset"
)

func transition(current State, event Event) (State, error) {
    switch current {
    case StateIdle:
        switch event {
        case EventFetch:
            return StateFetching, nil
        default:
            return current, fmt.Errorf("idle cannot handle %s", event)
        }

    case StateFetching:
        switch event {
        case EventSuccess:
            return StateSuccess, nil
        case EventError:
            return StateError, nil
        default:
            return current, fmt.Errorf("fetching cannot handle %s", event)
        }

    case StateSuccess, StateError:
        switch event {
        case EventReset:
            return StateIdle, nil
        default:
            return current, fmt.Errorf("%s cannot handle %s", current, event)
        }

    default:
        return current, fmt.Errorf("unknown state: %s", current)
    }
}
```

---

## Compiler Internals

### How the Go compiler lowers switch

The Go compiler chooses different code generation strategies based on the number and type of cases:

**1. Linear scan (2-4 cases):** Generates a sequence of comparisons, similar to if-else. Fastest for few cases.

**2. Binary search (5-8 cases):** Sorts cases by value, generates a binary search tree. O(log n) comparisons.

**3. Jump table (dense integer cases):** When cases are consecutive integers (e.g., 0,1,2,3,4), generates an array of jump targets. O(1) dispatch.

```go
// Jump table candidate: consecutive integers
func dayName(d int) string {
    switch d {
    case 0: return "Sunday"
    case 1: return "Monday"
    case 2: return "Tuesday"
    case 3: return "Wednesday"
    case 4: return "Thursday"
    case 5: return "Friday"
    case 6: return "Saturday"
    default: return "Unknown"
    }
}
// Compiler generates: jmp table[d] — single instruction dispatch
```

```go
// Binary search: non-consecutive integers
func classify(x int) string {
    switch x {
    case 1, 10, 100, 1000, 10000:
        return "power of 10"
    case 2, 4, 8, 16, 32:
        return "power of 2"
    default:
        return "other"
    }
}
// Compiler generates a binary search over sorted case values
```

To observe the generated code:
```bash
GOSSAFUNC=dayName go build -v .
```

### String switch optimization

For string switches, the compiler uses hash-based dispatch:

```go
switch method {
case "GET", "HEAD":
    return true
case "POST", "PUT", "PATCH", "DELETE":
    return false
}
```

The compiler may hash the method string and use a jump table on the hash, with fallback linear comparison for collisions.

### Type switch and itab

A type switch `switch v := i.(type)` requires runtime type information. The compiler generates code that reads the `itab` pointer (type descriptor) from the interface and compares it to the type descriptors of each case. This is O(n) in the number of cases but each comparison is a pointer comparison — very fast.

---

## Type Switch Deep Dive

### Type assertions vs type switches

```go
// Type assertion: panics if wrong type (use with caution)
s := i.(string)  // panics if i is not a string

// Type assertion with ok: safe, but verbose for many types
s, ok := i.(string)
if ok {
    // use s
}

// Type switch: clean, safe for multiple types
switch v := i.(type) {
case string:
    fmt.Println("string:", v)
case int:
    fmt.Println("int:", v)
case []byte:
    fmt.Println("bytes:", v)
case nil:
    fmt.Println("nil interface")
default:
    fmt.Printf("unknown: %T\n", v)
}
```

### Type switch for interface implementation checking

```go
func describeCapabilities(v interface{}) {
    switch t := v.(type) {
    case interface{ Read([]byte) (int, error) }:
        fmt.Println("Is a Reader")
        _ = t
    case interface{ Write([]byte) (int, error) }:
        fmt.Println("Is a Writer")
    default:
        fmt.Printf("Unknown: %T\n", v)
    }
}
```

### Type switch with embedded interface dispatch

```go
type Formatter interface {
    Format() string
}

type JSONFormatter struct{}
type XMLFormatter struct{}
type CSVFormatter struct{}

func (j JSONFormatter) Format() string { return "json" }
func (x XMLFormatter) Format() string  { return "xml" }
func (c CSVFormatter) Format() string  { return "csv" }

func export(data interface{}, f Formatter) string {
    switch formatter := f.(type) {
    case JSONFormatter:
        return exportJSON(data, formatter)
    case XMLFormatter:
        return exportXML(data, formatter)
    case CSVFormatter:
        return exportCSV(data, formatter)
    default:
        return formatter.Format()
    }
}
```

---

## Large-Scale Patterns

### Exhaustiveness checking with linter

```go
// Using "exhaustive" linter: https://github.com/nishanths/exhaustive
//go:generate stringer -type=Status
type Status int

const (
    StatusPending Status = iota
    StatusActive
    StatusInactive
    StatusBanned
)

func processUser(s Status) {
    switch s {
    case StatusPending:
        sendWelcomeEmail()
    case StatusActive:
        processRequest()
    case StatusInactive:
        sendReactivationEmail()
    case StatusBanned:
        logBannedAttempt()
    default:
        panic(fmt.Sprintf("unhandled Status: %d", s))
    }
}
```

### Command pattern using switch

```go
type CommandType string

const (
    CmdCreate CommandType = "create"
    CmdUpdate CommandType = "update"
    CmdDelete CommandType = "delete"
)

func buildCommand(cmdType CommandType, params map[string]interface{}) (Command, error) {
    switch cmdType {
    case CmdCreate:
        return &CreateCommand{params: params}, nil
    case CmdUpdate:
        return &UpdateCommand{params: params}, nil
    case CmdDelete:
        return &DeleteCommand{params: params}, nil
    default:
        return nil, fmt.Errorf("unknown command type: %s", cmdType)
    }
}
```

### Protocol handler using switch

```go
type MessageType uint8

const (
    MsgPing  MessageType = 1
    MsgPong  MessageType = 2
    MsgData  MessageType = 3
    MsgClose MessageType = 4
)

func handleMessage(conn net.Conn, msgType MessageType, payload []byte) error {
    switch msgType {
    case MsgPing:
        return sendPong(conn)
    case MsgPong:
        updateLastSeen(conn)
        return nil
    case MsgData:
        return processData(conn, payload)
    case MsgClose:
        return conn.Close()
    default:
        return fmt.Errorf("unknown message type: %d", msgType)
    }
}
```

---

## Postmortems & Real Failures

### Case 1: Missing default caused silent data corruption

**What happened:** A payment state machine had a switch over payment states. A new `StateRefunding` was added but not to the switch. Without a `default:`, the switch did nothing for refunding payments — they were silently ignored and timed out as "pending."

```go
// BEFORE: no default, missing new state
func processPayment(p *Payment) error {
    switch p.State {
    case StatePending:
        return initiate(p)
    case StateCompleted:
        return notify(p)
    case StateFailed:
        return retry(p)
    // StateRefunding added but not handled — silent do-nothing
    }
    return nil
}

// AFTER: explicit error for unknown states
func processPayment(p *Payment) error {
    switch p.State {
    case StatePending:
        return initiate(p)
    case StateCompleted:
        return notify(p)
    case StateFailed:
        return retry(p)
    case StateRefunding:
        return processRefund(p)
    default:
        return fmt.Errorf("processPayment: unhandled state %v for payment %s", p.State, p.ID)
    }
}
```

**Lesson:** Always add `default:` with an error or panic for switches over enums.

### Case 2: fallthrough caused unintended audit log behavior

**What happened:** A developer used `fallthrough` to share logging code. A later refactor changed case order, and the `fallthrough` fell into the wrong case, causing incorrect audit records.

```go
// DANGEROUS: fallthrough with case reordering risk
switch action {
case "create":
    createResource()
    fallthrough  // fell into wrong case after refactor
case "update":
    logAudit("resource modified")
}

// SAFE: explicit calls
switch action {
case "create":
    createResource()
    logAudit("resource created")
case "update":
    updateResource()
    logAudit("resource modified")
}
```

---

## Performance Benchmarks

```go
package switch_test

import "testing"

func dispatchSwitch(cmd string) int {
    switch cmd {
    case "a": return 1
    case "b": return 2
    case "c": return 3
    default:  return 0
    }
}

var handlers = map[string]func() int{
    "a": func() int { return 1 },
    "b": func() int { return 2 },
    "c": func() int { return 3 },
}

func dispatchMap(cmd string) int {
    if fn, ok := handlers[cmd]; ok {
        return fn()
    }
    return 0
}

func BenchmarkSwitch3(b *testing.B) {
    for i := 0; i < b.N; i++ { _ = dispatchSwitch("b") }
}

func BenchmarkMap3(b *testing.B) {
    for i := 0; i < b.N; i++ { _ = dispatchMap("b") }
}

// Results (3 cases):
// BenchmarkSwitch3: ~2.1 ns/op
// BenchmarkMap3:    ~8.5 ns/op — map overhead dominates for few cases
```

---

## Advanced Testing

### Table-driven testing for exhaustiveness

```go
func TestHandleEvent_AllCases(t *testing.T) {
    allEventTypes := []EventType{
        EventCreated,
        EventUpdated,
        EventDeleted,
        EventArchived,
    }

    for _, et := range allEventTypes {
        t.Run(fmt.Sprintf("EventType_%d", et), func(t *testing.T) {
            event := Event{Type: et, Data: "test"}
            err := handleEvent(event)
            if err != nil && strings.Contains(err.Error(), "unhandled event type") {
                t.Errorf("EventType %v is not handled in switch", et)
            }
        })
    }
}
```

---

## Concurrency Considerations

```go
// DATA RACE: reading shared state without lock
switch conn.state {
case StateConnected:
    send(data)
}

// CORRECT: read under lock
conn.mu.Lock()
state := conn.state
conn.mu.Unlock()
switch state {
case StateConnected:
    send(data)
}
```

Even if reading is atomic, the value can change between the switch and the action. Use mutexes for invariants that span reading and acting.

---

## Linting and Static Analysis

| Tool | What it catches for switch |
|------|--------------------------|
| `exhaustive` | Missing enum cases without default |
| `staticcheck` | Unreachable cases, duplicate cases |
| `go vet` | Duplicate case values |
| `revive` | fallthrough in last case, empty cases |

```yaml
# .golangci.yml
linters:
  enable:
    - exhaustive
    - gocritic

linters-settings:
  exhaustive:
    default-signifies-exhaustive: false
```

---

## Test

**1. What code generation strategy does the Go compiler use for 6 consecutive integer cases?**
- A) Linear scan
- B) Binary search
- C) Jump table — O(1) dispatch ✓
- D) Hash table

**2. What is the primary benefit of `default: return fmt.Errorf("unhandled: %v", x)`?**
- A) Performance improvement
- B) Forces future code to handle new enum values ✓
- C) Faster compilation
- D) Prevents nil pointer dereferences

**3. Which is typically faster for 3 string cases?**
- A) Map — hash lookup is O(1)
- B) Switch — avoids hash computation overhead ✓
- C) They are always identical
- D) Depends only on string length

**4. What is the risk of using `fallthrough` in production code?**
- A) Compile error in some cases
- B) Refactoring case order can silently change behavior ✓
- C) Increases memory usage
- D) Prevents default case from running

**5. How does the `exhaustive` linter help?**
- A) Measures switch performance
- B) Ensures all enum values are handled in switch ✓
- C) Removes duplicate cases
- D) Converts if-else to switch

---

## Tricky Questions

**Q1: Can the Go compiler prove a type switch is exhaustive?**

No. Unlike Rust's `match`, Go has no compiler-level exhaustiveness checking for type switches. The `exhaustive` linter adds this externally.

**Q2: What happens when you switch on a nil interface?**

A type switch has a special `case nil:` that matches a nil interface value. Without it, nil falls to `default`.

**Q3: How does switching on a struct differ from an interface?**

Struct equality requires all fields comparable — direct struct switch is rare. Type switch works on interfaces. For value-based dispatch on structs, use an expressionless switch with conditions.

**Q4: Performance tradeoffs: switch vs map for 50+ cases?**

For 50+ cases, map dispatch often matches or beats switch: switch uses O(log n) binary search for non-consecutive values (~6 comparisons for 50 cases), while map uses O(1) hash lookup (~8ns). Map also allows runtime extension without recompilation.

---

## Summary

At senior level, `switch` enforces safe, exhaustive discriminated dispatch. Critical practices: always add `default:` with explicit errors for enum switches, use the `exhaustive` linter, understand jump table vs binary search vs linear scan generation, avoid `fallthrough` in production code, and design state machines as exhaustive switches. Type switches provide clean, safe polymorphism without reflection overhead.

---

## Further Reading

- [Go Specification: Switch statements](https://go.dev/ref/spec#Switch_statements)
- [exhaustive linter](https://github.com/nishanths/exhaustive)
- [Go compiler SSA optimizations](https://github.com/golang/go/tree/master/src/cmd/compile/internal/ssa)
- [Effective Go: Switch](https://go.dev/doc/effective_go#switch)
