# switch Statement — Tasks & Exercises

## Table of Contents
1. [Junior Tasks](#junior-tasks)
2. [Middle Tasks](#middle-tasks)
3. [Senior Tasks](#senior-tasks)
4. [Questions](#questions)
5. [Mini Projects](#mini-projects)
6. [Challenge](#challenge)

---

## Junior Tasks

### Task 1: Day Classifier

**Type:** Coding Exercise
**Goal:** Practice basic switch syntax and multiple-value cases

**Starter code:**
```go
package main

import "fmt"

// Use switch to implement these functions:

// dayType returns "weekday", "weekend", or "unknown"
// for day names like "Monday", "Saturday", etc.
func dayType(day string) string {
    // TODO: use switch with multiple values in one case
    return ""
}

// season returns "Spring", "Summer", "Autumn", "Winter", or "Unknown"
// for month numbers 1-12
func season(month int) string {
    // TODO: use switch with multiple integer values per case
    // Spring: 3,4,5 | Summer: 6,7,8 | Autumn: 9,10,11 | Winter: 12,1,2
    return ""
}

func main() {
    days := []string{"Monday", "Wednesday", "Saturday", "Sunday", "Holiday"}
    for _, d := range days {
        fmt.Printf("%s: %s\n", d, dayType(d))
    }

    for month := 1; month <= 12; month++ {
        fmt.Printf("Month %2d: %s\n", month, season(month))
    }
}
```

**Expected output:**
```
Monday: weekday
Wednesday: weekday
Saturday: weekend
Sunday: weekend
Holiday: unknown
Month  1: Winter
Month  2: Winter
Month  3: Spring
...
Month 12: Winter
```

**Evaluation criteria:**
- Uses `switch` (not if-else)
- Uses multiple values in one case (`case "Mon", "Tue":`)
- Includes `default` case for unknown values

---

### Task 2: Type Describer

**Type:** Coding Exercise
**Goal:** Write a type switch that handles multiple types

**Starter code:**
```go
package main

import "fmt"

// describe returns a human-readable description of any value
// Must handle: int, float64, string, bool, []int, nil
// For unknown types, return "unknown: <type>"
func describe(v interface{}) string {
    // TODO: implement using type switch
    return ""
}

func main() {
    values := []interface{}{
        42,
        3.14,
        "hello",
        true,
        []int{1, 2, 3},
        nil,
        struct{ X int }{X: 5},
    }

    for _, v := range values {
        fmt.Println(describe(v))
    }
}
```

**Expected output:**
```
integer: 42
float: 3.14
string: "hello" (5 chars)
bool: true
int slice: [1 2 3] (3 elements)
nil
unknown: struct { X int }
```

**Evaluation criteria:**
- Uses type switch with `switch v := i.(type)`
- Handles all required types
- `default` uses `%T` to show type name
- Each case formats output correctly

---

### Task 3: Calculator

**Type:** Coding Exercise
**Goal:** Use switch to dispatch arithmetic operations

```go
package main

import (
    "errors"
    "fmt"
)

// calculate performs the operation on a and b
// Supported: "+", "-", "*", "/"
// Returns error for division by zero or unknown operator
func calculate(a float64, op string, b float64) (float64, error) {
    // TODO: use switch on op
    return 0, nil
}

func main() {
    operations := []struct {
        a, b float64
        op   string
    }{
        {10, 5, "+"},
        {10, 5, "-"},
        {10, 5, "*"},
        {10, 5, "/"},
        {10, 0, "/"},
        {10, 5, "%"},
    }

    for _, o := range operations {
        result, err := calculate(o.a, o.op, o.b)
        if err != nil {
            fmt.Printf("%.0f %s %.0f = ERROR: %v\n", o.a, o.op, o.b, err)
        } else {
            fmt.Printf("%.0f %s %.0f = %.2f\n", o.a, o.op, o.b, result)
        }
    }
}
```

**Expected output:**
```
10 + 5 = 15.00
10 - 5 = 5.00
10 * 5 = 50.00
10 / 5 = 2.00
10 / 0 = ERROR: division by zero
10 % 5 = ERROR: unknown operator: %
```

**Evaluation criteria:**
- Uses switch on operator string
- Returns appropriate errors
- All operations correct

---

## Middle Tasks

### Task 4: HTTP Router with Type Switch

**Type:** Design and Implementation
**Goal:** Build a simple HTTP-like router using type switch for request dispatch

```go
package main

import "fmt"

// Request types
type GetRequest struct {
    Path   string
    Params map[string]string
}

type PostRequest struct {
    Path string
    Body []byte
}

type DeleteRequest struct {
    Path string
}

type PutRequest struct {
    Path string
    Body []byte
}

type Request interface{ isRequest() }

func (GetRequest) isRequest()    {}
func (PostRequest) isRequest()   {}
func (DeleteRequest) isRequest() {}
func (PutRequest) isRequest()    {}

// Response represents an HTTP response
type Response struct {
    StatusCode int
    Body       string
}

// Router handles requests using type switch
type Router struct{}

// Handle dispatches the request and returns a response
func (r *Router) Handle(req Request) Response {
    // TODO: use type switch to dispatch to the correct handler
    // GET /users -> list users
    // POST /users -> create user (use req.Body)
    // DELETE /users -> clear all users
    // PUT /users -> update (use req.Body)
    // For unknown paths: 404
    return Response{}
}

func main() {
    router := &Router{}

    requests := []Request{
        GetRequest{Path: "/users", Params: map[string]string{"limit": "10"}},
        PostRequest{Path: "/users", Body: []byte(`{"name":"Alice"}`)},
        DeleteRequest{Path: "/users"},
        PutRequest{Path: "/users", Body: []byte(`{"name":"Bob"}`)},
        GetRequest{Path: "/unknown"},
    }

    for _, req := range requests {
        resp := router.Handle(req)
        fmt.Printf("Status: %d, Body: %s\n", resp.StatusCode, resp.Body)
    }
}
```

**Expected output:**
```
Status: 200, Body: List users (limit: 10)
Status: 201, Body: Created user: {"name":"Alice"}
Status: 204, Body: All users deleted
Status: 200, Body: Updated: {"name":"Bob"}
Status: 404, Body: Not found: /unknown
```

**Evaluation criteria:**
- Uses type switch for dispatch
- Each request type correctly processed
- Default handles 404 for unknown paths
- Status codes are appropriate

---

### Task 5: State Machine

**Type:** Design and Implementation
**Goal:** Implement a connection state machine using switch

```go
package main

import (
    "errors"
    "fmt"
)

type State string
type Event string

const (
    StateDisconnected State = "disconnected"
    StateConnecting   State = "connecting"
    StateConnected    State = "connected"
    StateClosing      State = "closing"
)

const (
    EventConnect    Event = "connect"
    EventConnected  Event = "connected"
    EventDisconnect Event = "disconnect"
    EventClosed     Event = "closed"
    EventError      Event = "error"
)

type Connection struct {
    state State
}

func NewConnection() *Connection {
    return &Connection{state: StateDisconnected}
}

// Transition applies an event to the current state
// Returns error if the transition is not valid
func (c *Connection) Transition(event Event) error {
    // TODO: implement state machine using nested switch
    // StateDisconnected + connect -> StateConnecting
    // StateConnecting + connected -> StateConnected
    // StateConnecting + error -> StateDisconnected
    // StateConnected + disconnect -> StateClosing
    // StateClosing + closed -> StateDisconnected
    // Any other combination -> error "invalid transition"
    return nil
}

func (c *Connection) State() State { return c.state }

func main() {
    conn := NewConnection()
    fmt.Println("Initial:", conn.State())

    events := []Event{EventConnect, EventConnected, EventDisconnect, EventClosed}
    for _, event := range events {
        if err := conn.Transition(event); err != nil {
            fmt.Printf("Event %s: ERROR — %v\n", event, err)
        } else {
            fmt.Printf("Event %s: -> %s\n", event, conn.State())
        }
    }

    // Test invalid transition
    conn2 := NewConnection()
    if err := conn2.Transition(EventDisconnect); err != nil {
        fmt.Println("Invalid:", err)
    }
}
```

**Expected output:**
```
Initial: disconnected
Event connect: -> connecting
Event connected: -> connected
Event disconnect: -> closing
Event closed: -> disconnected
Invalid: invalid transition: disconnected cannot handle disconnect
```

---

### Task 6: Expressionless Switch Refactor

**Type:** Refactoring
**Goal:** Refactor a long if-else chain to an expressionless switch

The following function uses a complex if-else chain. Refactor it to use an expressionless switch that is more readable:

```go
// BEFORE: convert this to use expressionless switch
func categorizeAge(age int) string {
    var result string
    if age < 0 {
        result = "invalid"
    } else if age >= 0 && age <= 2 {
        result = "infant"
    } else if age > 2 && age <= 12 {
        result = "child"
    } else if age > 12 && age <= 17 {
        result = "teenager"
    } else if age > 17 && age <= 25 {
        result = "young adult"
    } else if age > 25 && age <= 64 {
        result = "adult"
    } else if age > 64 && age <= 120 {
        result = "senior"
    } else {
        result = "invalid"
    }
    return result
}
```

**Expected output (same as before):**
```go
categorizeAge(-1) == "invalid"
categorizeAge(0)  == "infant"
categorizeAge(5)  == "child"
categorizeAge(15) == "teenager"
categorizeAge(22) == "young adult"
categorizeAge(40) == "adult"
categorizeAge(70) == "senior"
categorizeAge(150) == "invalid"
```

**Evaluation criteria:**
- Uses expressionless `switch { case ...: }` form
- Removes redundant lower-bound checks (since cases are checked in order)
- Code is shorter and cleaner than the original
- All edge cases preserved

**Solution:**
```go
func categorizeAge(age int) string {
    switch {
    case age < 0:
        return "invalid"
    case age <= 2:
        return "infant"
    case age <= 12:
        return "child"
    case age <= 17:
        return "teenager"
    case age <= 25:
        return "young adult"
    case age <= 64:
        return "adult"
    case age <= 120:
        return "senior"
    default:
        return "invalid"
    }
}
```

---

## Senior Tasks

### Task 7: Exhaustive Switch Checker

**Type:** Architecture
**Goal:** Build a code analysis tool that detects non-exhaustive switches

```go
package main

import (
    "fmt"
    "go/ast"
    "go/parser"
    "go/token"
    "strings"
)

// Find all switch statements in the given Go source code
// that switch on a variable of a known type but have no default case.
// Return a list of warnings.

func analyzeSwitch(src string) []string {
    fset := token.NewFileSet()
    f, err := parser.ParseFile(fset, "input.go", src, 0)
    if err != nil {
        return []string{"parse error: " + err.Error()}
    }

    var warnings []string

    ast.Inspect(f, func(n ast.Node) bool {
        sw, ok := n.(*ast.SwitchStmt)
        if !ok {
            return true
        }

        // Check if switch has a default case
        hasDefault := false
        for _, stmt := range sw.Body.List {
            cc := stmt.(*ast.CaseClause)
            if cc.List == nil {  // nil List means default:
                hasDefault = true
                break
            }
        }

        if !hasDefault {
            pos := fset.Position(sw.Switch)
            warnings = append(warnings,
                fmt.Sprintf("line %d: switch has no default case", pos.Line))
        }

        return true
    })

    return warnings
}

func main() {
    src := `package main
func process(x int) {
    switch x {
    case 1:
        doA()
    case 2:
        doB()
    }  // no default!
}
func classify(s string) string {
    switch s {
    case "a":
        return "alpha"
    default:
        return "other"  // has default — OK
    }
}`

    warnings := analyzeSwitch(src)
    if len(warnings) == 0 {
        fmt.Println("No warnings found")
    } else {
        for _, w := range warnings {
            fmt.Println("WARNING:", w)
        }
    }
}
```

**Expected output:**
```
WARNING: line 3: switch has no default case
```

**Evaluation criteria:**
- Uses go/ast to traverse the AST
- Correctly identifies switches without default
- Does not false-positive on switches with default
- Works for both expression and expressionless switches

---

### Task 8: Protocol Decoder

**Type:** Implementation
**Goal:** Decode a binary protocol using nested switches

```go
package main

import (
    "encoding/binary"
    "errors"
    "fmt"
)

// Binary protocol:
// Byte 0: message type (1=ping, 2=data, 3=close, 4=error)
// Byte 1: encoding (0=raw, 1=json, 2=msgpack)
// Bytes 2-3: payload length (big endian uint16)
// Bytes 4+: payload

type MessageType uint8
type Encoding uint8

const (
    TypePing  MessageType = 1
    TypeData  MessageType = 2
    TypeClose MessageType = 3
    TypeError MessageType = 4
)

const (
    EncodingRaw     Encoding = 0
    EncodingJSON    Encoding = 1
    EncodingMsgpack Encoding = 2
)

type Message struct {
    Type     MessageType
    Encoding Encoding
    Payload  []byte
}

type DecodedMessage struct {
    Summary string
    Data    interface{}
}

func decode(msg Message) (*DecodedMessage, error) {
    // TODO: use nested switch
    // Outer switch: msg.Type
    // Inner switch: msg.Encoding (for TypeData only)
    // TypePing: return "PING" summary
    // TypeClose: return "CLOSE" summary
    // TypeError: return "ERROR: <payload as string>" summary
    // TypeData + EncodingJSON: parse JSON payload
    // TypeData + EncodingRaw: return raw bytes
    // TypeData + EncodingMsgpack: return "msgpack data" (simulated)
    // Unknown type or encoding: return error
    return nil, nil
}

func main() {
    messages := []Message{
        {Type: TypePing, Encoding: EncodingRaw, Payload: nil},
        {Type: TypeData, Encoding: EncodingJSON, Payload: []byte(`{"key":"value"}`)},
        {Type: TypeData, Encoding: EncodingRaw, Payload: []byte{0x01, 0x02, 0x03}},
        {Type: TypeError, Encoding: EncodingRaw, Payload: []byte("connection refused")},
        {Type: TypeClose, Encoding: EncodingRaw, Payload: nil},
        {Type: 99, Encoding: EncodingRaw, Payload: nil},
    }

    for _, msg := range messages {
        if decoded, err := decode(msg); err != nil {
            fmt.Println("Error:", err)
        } else {
            fmt.Println(decoded.Summary)
        }
    }
}
```

**Expected output:**
```
PING
DATA (json): {"key":"value"}
DATA (raw): [1 2 3]
ERROR: connection refused
CLOSE
Error: unknown message type: 99
```

---

## Questions

1. **What is the difference between `switch x { case 1, 2: }` and two separate `case 1: case 2:` clauses?** Are they functionally equivalent?

2. **Why does Go NOT have automatic fallthrough like C? What problem does this solve?** Give a real example of a C bug that Go's design prevents.

3. **Explain when the Go compiler generates a jump table vs binary search for an integer switch.** What is the "density" heuristic?

4. **A switch inside a for loop uses `break`. What does it break — the switch or the loop? How do you break the loop?** Provide code examples for both behaviors.

5. **What happens when you use a type switch on a nil interface? What is the `case nil:` syntax?** Show an example where missing `case nil:` causes unexpected behavior.

---

## Mini Projects

### Mini Project 1: Expression Parser

Build a simple infix expression evaluator using switch for operator dispatch:

```go
// Parse and evaluate expressions like: "3 + 4 * 2"
// Operator precedence: * and / before + and -
// Use switch for operator dispatch in the evaluation

package main

import (
    "fmt"
    "strconv"
    "strings"
)

func evalBinary(a float64, op string, b float64) (float64, error) {
    switch op {
    case "+": return a + b, nil
    case "-": return a - b, nil
    case "*": return a * b, nil
    case "/":
        if b == 0 {
            return 0, fmt.Errorf("division by zero")
        }
        return a / b, nil
    default:
        return 0, fmt.Errorf("unknown operator: %s", op)
    }
}

// Simple evaluator for "a op b" expressions (no precedence for simplicity)
func eval(expr string) (float64, error) {
    parts := strings.Fields(expr)
    if len(parts) != 3 {
        return 0, fmt.Errorf("expected 'num op num'")
    }
    a, err := strconv.ParseFloat(parts[0], 64)
    if err != nil {
        return 0, err
    }
    b, err := strconv.ParseFloat(parts[2], 64)
    if err != nil {
        return 0, err
    }
    return evalBinary(a, parts[1], b)
}

func main() {
    exprs := []string{"3 + 4", "10 / 2", "5 * 6", "8 - 3", "10 / 0", "5 ^ 2"}
    for _, e := range exprs {
        if result, err := eval(e); err != nil {
            fmt.Printf("%s = ERROR: %v\n", e, err)
        } else {
            fmt.Printf("%s = %.2f\n", e, result)
        }
    }
}
```

### Mini Project 2: JSON Value Inspector

Use a type switch to inspect `interface{}` values decoded from JSON:

```go
package main

import (
    "encoding/json"
    "fmt"
)

func inspectValue(key string, val interface{}, depth int) {
    indent := strings.Repeat("  ", depth)

    switch v := val.(type) {
    case nil:
        fmt.Printf("%s%s: null\n", indent, key)
    case bool:
        fmt.Printf("%s%s: bool = %t\n", indent, key, v)
    case float64:
        if v == float64(int(v)) {
            fmt.Printf("%s%s: int = %d\n", indent, key, int(v))
        } else {
            fmt.Printf("%s%s: float = %g\n", indent, key, v)
        }
    case string:
        fmt.Printf("%s%s: string = %q\n", indent, key, v)
    case []interface{}:
        fmt.Printf("%s%s: array[%d]\n", indent, key, len(v))
        for i, item := range v {
            inspectValue(fmt.Sprintf("[%d]", i), item, depth+1)
        }
    case map[string]interface{}:
        fmt.Printf("%s%s: object\n", indent, key)
        for k, item := range v {
            inspectValue(k, item, depth+1)
        }
    default:
        fmt.Printf("%s%s: unknown %T\n", indent, key, v)
    }
}

func main() {
    data := `{
        "name": "Alice",
        "age": 30,
        "score": 9.5,
        "active": true,
        "tags": ["go", "developer"],
        "address": null
    }`

    var m map[string]interface{}
    json.Unmarshal([]byte(data), &m)
    inspectValue("root", m, 0)
}
```

---

## Challenge

### Challenge: Build a Mini Interpreter

Implement a simple stack-based interpreter that uses switch to dispatch opcodes:

```go
package main

import (
    "errors"
    "fmt"
)

type OpCode int

const (
    OpPush  OpCode = iota  // push value onto stack
    OpPop                   // pop and discard
    OpAdd                   // pop two, push sum
    OpSub                   // pop two, push difference
    OpMul                   // pop two, push product
    OpDiv                   // pop two, push quotient
    OpDup                   // duplicate top of stack
    OpSwap                  // swap top two elements
    OpPrint                 // print top of stack
    OpHalt                  // stop execution
)

type Instruction struct {
    Op  OpCode
    Arg int  // used by OpPush
}

type VM struct {
    stack []int
    pc    int
}

// Execute runs the program and returns any error
func (vm *VM) Execute(program []Instruction) error {
    // TODO: implement using switch on instruction.Op
    // Handle all 10 opcodes
    // Return error for: stack underflow, division by zero, unknown opcode
    return nil
}

func main() {
    // Program: compute (3 + 4) * 2
    program := []Instruction{
        {OpPush, 3},
        {OpPush, 4},
        {OpAdd, 0},
        {OpPush, 2},
        {OpMul, 0},
        {OpPrint, 0},
        {OpHalt, 0},
    }

    vm := &VM{}
    if err := vm.Execute(program); err != nil {
        fmt.Println("Error:", err)
    }
    // Output: 14
}
```

**Evaluation criteria:**
- All 10 opcodes implemented via switch
- Default case returns error for unknown opcodes
- Stack underflow and division by zero handled
- Clean, readable switch with one case per opcode
- Bonus: add OpJumpIf (conditional jump) opcode
