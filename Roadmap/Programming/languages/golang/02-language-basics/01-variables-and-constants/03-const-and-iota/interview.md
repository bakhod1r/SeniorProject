# const and iota — Interview Questions

## Table of Contents
1. [Overview](#overview)
2. [Junior-Level Questions (Q1–Q7)](#junior-level-questions)
3. [Middle-Level Questions (Q8–Q14)](#middle-level-questions)
4. [Senior-Level Questions (Q15–Q22)](#senior-level-questions)
5. [Professional / Compiler Questions (Q23–Q27)](#professional-compiler-questions)
6. [Rapid-Fire Quiz](#rapid-fire-quiz)
7. [Coding Challenges](#coding-challenges)
8. [Interview Tips](#interview-tips)
9. [Red Flags in Answers](#red-flags-in-answers)
10. [Cheat Sheet for Review](#cheat-sheet-for-review)

---

## Overview

This file contains 27 Q&A pairs covering `const` and `iota` in Go at multiple interview levels — from junior to professional. Each question includes the expected answer, common follow-ups, and what interviewers are really testing.

---

## Junior-Level Questions

### Q1. What is a constant in Go? How do you declare one?

**Answer:**
A constant is a value that is fixed at compile time and cannot be changed at runtime. You declare it with the `const` keyword:

```go
const Pi = 3.14159
const Greeting = "Hello"
const MaxRetries int = 3
```

Constants must be computable at compile time. They cannot hold values computed at runtime (like the result of a function call).

**What the interviewer is testing:** Basic syntax knowledge. Can the candidate distinguish compile-time from runtime values?

**Common follow-up:** "Can you put a `time.Now()` in a const?" (No — it's a runtime function call.)

---

### Q2. What is the difference between `const` and `var` in Go?

**Answer:**

| Feature | `const` | `var` |
|---------|---------|-------|
| Mutability | Immutable — cannot be reassigned | Mutable — can be reassigned |
| When evaluated | Compile time | Runtime |
| Types allowed | Scalar: int, float, string, bool, rune | Any type including slice, map, struct |
| Can use function results | No | Yes |

```go
var x = 10
x = 20     // OK

const y = 10
y = 20     // ERROR: cannot assign to y (declared const)
```

**What the interviewer is testing:** Understanding of immutability and compile-time vs runtime semantics.

---

### Q3. What is `iota` and how does it work?

**Answer:**
`iota` is a predeclared identifier in Go that is only available inside `const` blocks. It represents the index (0-based) of the current constant specification (line) within the block. It starts at 0 for each new const block and increments by 1 for each spec.

```go
const (
    A = iota // 0
    B        // 1
    C        // 2
)
```

`iota` is not a function — it's a special identifier that the compiler replaces with an integer at compile time.

**What the interviewer is testing:** Fundamental understanding of `iota`. Can the candidate explain it without just saying "it auto-increments"?

---

### Q4. What happens to `iota` when you start a new `const` block?

**Answer:**
`iota` resets to 0 in every new `const` block. Each `const` block has its own `iota` counter starting from 0.

```go
const (
    A = iota // 0
    B        // 1
    C        // 2
)

const (
    X = iota // 0 — resets here
    Y        // 1
    Z        // 2
)
```

`A`, `B`, `C` have values 0, 1, 2.
`X`, `Y`, `Z` also have values 0, 1, 2.

**What the interviewer is testing:** Precision about `iota` scope. Many candidates mistakenly think `iota` is global.

---

### Q5. Can you use `iota` outside a `const` block?

**Answer:**
No. `iota` is only valid inside a `const` block. Using it anywhere else causes a compile error.

```go
var x = iota  // ERROR: iota is not in a const declaration
```

**What the interviewer is testing:** Knowing the precise scope of `iota`.

---

### Q6. What is the difference between a typed and an untyped constant?

**Answer:**

- **Typed constant**: Has an explicit type declared.

```go
const MaxItems int = 100
var x int8 = MaxItems // ERROR: type mismatch — int != int8
```

- **Untyped constant**: Has no explicit type. It has a "kind" (integer, float, string, etc.) but adapts to any compatible type at assignment.

```go
const MaxItems = 100  // untyped integer constant
var x int8   = MaxItems // OK
var y int64  = MaxItems // OK
var z float64 = MaxItems // OK
```

Untyped constants are more flexible. Typed constants are safer for preventing mixing of unrelated types.

**What the interviewer is testing:** Deep understanding of Go's type system. This is a key differentiator at the middle level.

---

### Q7. What is the zero value of an `iota`-based enum type, and why does it matter?

**Answer:**
The zero value of any integer type in Go is `0`. If the first constant in an iota enum is `0`, then an uninitialized variable of that type will equal the first constant — which may not represent "unset" or "unknown".

```go
type Status int
const (
    StatusPending  Status = iota // 0
    StatusActive                 // 1
)

var s Status // s == 0 == StatusPending — possibly unintentional
```

**Best practice**: Skip 0 with `_ = iota` or use `iota + 1`:

```go
const (
    _             Status = iota // skip 0
    StatusPending               // 1
    StatusActive                // 2
)
```

Now the zero value means "uninitialized".

**What the interviewer is testing:** Awareness of zero value implications for enum safety.

---

## Middle-Level Questions

### Q8. How do you implement a `String()` method for an iota enum?

**Answer:**
Implement the `fmt.Stringer` interface by defining `String() string` on the named type:

```go
type Direction int

const (
    North Direction = iota
    East
    South
    West
)

func (d Direction) String() string {
    return [...]string{"North", "East", "South", "West"}[d]
}
```

Or use a `switch` for out-of-range safety:

```go
func (d Direction) String() string {
    switch d {
    case North:
        return "North"
    case East:
        return "East"
    case South:
        return "South"
    case West:
        return "West"
    default:
        return fmt.Sprintf("Direction(%d)", int(d))
    }
}
```

The `go generate stringer` tool automates this.

**What the interviewer is testing:** Practical enum usage. Can the candidate connect `iota` to `fmt.Stringer`?

---

### Q9. How do you create bit flags using `iota`?

**Answer:**
Use the left-shift expression `1 << iota`:

```go
type Permission int

const (
    Read    Permission = 1 << iota // 1 (binary: 001)
    Write                          // 2 (binary: 010)
    Execute                        // 4 (binary: 100)
)

// Combine flags
userPerm := Read | Write // 3 (binary: 011)

// Check flag
if userPerm&Read != 0 {
    fmt.Println("can read")
}

// Remove flag
userPerm = userPerm &^ Write // 1 (binary: 001)
```

Each constant occupies a unique bit position.

**What the interviewer is testing:** Understanding of bit manipulation and the `1 << iota` pattern.

---

### Q10. What is the value of `D` in this code?

```go
const (
    A = iota  // 0
    B         // 1
    C = 10    // 10
    D         // ?
)
```

**Answer:**
`D = 10`.

When a const spec has no expression, it repeats the **last explicit expression** with the current `iota` value. The last explicit expression was `10` (a constant, not involving `iota`). So `D` is also `10`.

**What the interviewer is testing:** Precise understanding of the expression-repetition rule.

---

### Q11. How does the `_ = iota` blank identifier work in a const block?

**Answer:**
The blank identifier `_` in a const block is a spec that discards the value but still increments `iota`. It is used to skip values:

```go
const (
    _    = iota // iota=0, value discarded
    One         // iota=1 → 1
    Two         // iota=2 → 2
    Three       // iota=3 → 3
)
```

Common use: skip 0 so the zero value of the type represents "unset".

**What the interviewer is testing:** Understanding that `_` advances `iota` even though it doesn't bind a name.

---

### Q12. How do you create file size constants (KB, MB, GB) using `iota`?

**Answer:**

```go
const (
    _  = iota                    // skip 0
    KB = 1 << (10 * iota)        // 1 << 10 = 1024
    MB                            // 1 << 20 = 1048576
    GB                            // 1 << 30 = 1073741824
    TB                            // 1 << 40
)
```

Explanation: the expression `1 << (10 * iota)` is evaluated for each spec with the current `iota` value:
- `KB`: `iota=1` → `1 << 10` = 1024
- `MB`: `iota=2` → `1 << 20` = 1048576
- `GB`: `iota=3` → `1 << 30` = 1073741824

**What the interviewer is testing:** Ability to write non-trivial `iota` expressions.

---

### Q13. Can a constant be of type `[]int` or `map[string]int`?

**Answer:**
No. Go constants can only be of basic types: integer, float, complex, string, boolean, and rune. Slices, maps, arrays, and structs cannot be constants because they require runtime memory allocation and may contain mutable state.

```go
const s = []int{1, 2, 3}  // ERROR: const initializer [] is not a constant
const m = map[string]int{} // ERROR: const initializer {} is not a constant
```

For aggregate data that should not change, use a `var` and document it as immutable, or use a function that returns the value.

**What the interviewer is testing:** Understanding of what types can be compile-time constants.

---

### Q14. What does `iota` equal on the second line if the first line does NOT use `iota`?

```go
const (
    A = 5    // iota=0, A=5
    B = iota // iota=?, B=?
)
```

**Answer:**
`iota` is always the index of the spec in the block, regardless of whether it's used. On the second line, `iota = 1`. So `B = 1`.

`iota` counts lines (specs), not usages. Even lines that don't use `iota` still advance the counter.

**What the interviewer is testing:** Precise spec-level understanding of `iota` advancement.

---

## Senior-Level Questions

### Q15. Why should public API enum constants use explicit integer values instead of `iota`?

**Answer:**
`iota` values depend on the order of declaration. If a new constant is inserted in the middle of a const block in a future version, all following constants shift by 1. Any code that stored the old integer values (in a database, config file, network protocol, or serialized format) will silently misinterpret them.

```go
// v1: FeatureA=0, FeatureB=1, FeatureC=2
const (
    FeatureA Feature = iota
    FeatureB
    FeatureC
)

// v2: adding FeatureAB=0, FeatureA=1, FeatureB=2, FeatureC=3 — BREAKS stored values!
const (
    FeatureAB Feature = iota
    FeatureA
    FeatureB
    FeatureC
)
```

Safe approach: use explicit values.

```go
const (
    FeatureA Feature = 1
    FeatureB Feature = 2
    FeatureC Feature = 3
)
```

**What the interviewer is testing:** API design thinking and awareness of versioning constraints.

---

### Q16. How do you implement a compile-time bounds check that forces String() to stay synchronized with the enum?

**Answer:**
Use a sentinel constant and a fixed-size array:

```go
type Color int

const (
    Red Color = iota
    Green
    Blue
    colorCount // sentinel
)

// This will FAIL TO COMPILE if colorCount != 3
var colorNames = [colorCount]string{"Red", "Green", "Blue"}

func (c Color) String() string {
    if c < 0 || c >= colorCount {
        return fmt.Sprintf("Color(%d)", int(c))
    }
    return colorNames[c]
}
```

If you add `Purple` to the enum, `colorCount` becomes 4, but the array literal has 3 elements — compile error. This forces the developer to update `colorNames` whenever the enum changes.

**What the interviewer is testing:** Advanced pattern design. Can the candidate make the compiler enforce invariants?

---

### Q17. How do you remove a bit flag from a bitmask in Go?

**Answer:**
Use the `&^` (bitwise AND-NOT) operator:

```go
perm := Read | Write | Execute // 7 = 0b111
perm = perm &^ Write           // 5 = 0b101 (Write bit cleared)
```

`x &^ y` clears in `x` all bits that are set in `y`. This is distinct from XOR (`^`) which would toggle the bit even if it wasn't set.

**What the interviewer is testing:** Bit manipulation fluency and knowledge of the `&^` operator.

---

### Q18. What are the tradeoffs between bit flags and functional options for configuring a function?

**Answer:**

| | Bit Flags | Functional Options |
|--|-----------|-------------------|
| Syntax | `f(Read \| Write)` | `f(WithRead(), WithWrite())` |
| Parameters | Yes, if needed | Yes |
| Discoverability | Poor (need docs) | Good (IDE shows functions) |
| Extensibility | Good (new bits) | Excellent (new funcs) |
| Performance | Faster (integer ops) | Slower (function calls) |
| Default values | Harder | Easy |
| Best for | Binary, orthogonal options | Complex configurations |

**Use bit flags** when options are purely boolean and orthogonal (like file open modes).
**Use functional options** when options have parameters or complex interactions.

**What the interviewer is testing:** System design judgment.

---

### Q19. How do you design an enum that allows external packages to add new values?

**Answer:**
Use an interface instead of a typed integer constant:

```go
type EventType interface {
    Code() int
    Name() string
}

// Built-in events
type builtinEvent int

func (e builtinEvent) Code() int    { return int(e) }
func (e builtinEvent) Name() string { return builtinEventNames[e] }

const (
    EventCreated builtinEvent = iota + 1
    EventUpdated
    EventDeleted
)
```

External packages can define their own types implementing `EventType`. However, this approach loses exhaustive switch checking. Alternatively, document that your enum is closed and callers must have a default case.

**What the interviewer is testing:** API extensibility thinking and Go idioms.

---

### Q20. What is the `exhaustive` linter and why would you use it with iota enums?

**Answer:**
`exhaustive` is a Go static analysis tool that checks whether switch statements over typed iota enums handle all declared enum values. Without it, missing a case in a switch is not a compile error in Go — it's just silently ignored.

```go
switch direction {
case North:
    go("north")
case East:
    go("east")
// Missing South and West — exhaustive linter flags this
}
```

Using `exhaustive` in CI catches missing enum cases when new values are added to an enum.

**What the interviewer is testing:** Awareness of Go tooling ecosystem and practical quality concerns.

---

### Q21. What is the zero value problem with permission/role constants, and how do you prevent it?

**Answer:**
The zero value of any integer type is `0`. If `0` is assigned to the "most powerful" role (like `Admin`), then a freshly declared (uninitialized) variable is automatically an `Admin` — a security hole.

```go
// Dangerous
type Role int
const (
    Admin Role = iota // 0 — zero value is Admin!
    User              // 1
)

var r Role // r == 0 == Admin — unintentionally authorized
```

**Fix**: Make 0 mean "unknown" or "unauthorized":

```go
type Role int
const (
    RoleUnknown Role = 0  // zero value = unauthorized
    RoleUser    Role = 1
    RoleAdmin   Role = 2
)
```

Or use `iota + 1`:

```go
const (
    RoleUser  Role = iota + 1 // 1
    RoleAdmin                 // 2
)
// zero value Role(0) matches no named constant → unauthorized
```

**What the interviewer is testing:** Security awareness in API design.

---

### Q22. Can you store an enum value that was created with `iota` in a database? What are the risks?

**Answer:**
You can, but it's risky unless you use explicit values:

**Risks with iota**:
- Inserting a new constant shifts all following values
- Deleting a constant shifts following values
- Reordering constants changes all values
- Any stored rows become incorrect after such code changes

**Safe approach**: Use explicit values for database-persisted enums:

```go
type OrderStatus int

const (
    OrderStatusPending   OrderStatus = 1
    OrderStatusShipped   OrderStatus = 2
    OrderStatusDelivered OrderStatus = 3
    OrderStatusCancelled OrderStatus = 4
)
```

New values can be added at any number (e.g., `OrderStatusReturned = 5`) without affecting existing stored values.

**What the interviewer is testing:** Production systems thinking.

---

## Professional / Compiler Questions

### Q23. What is constant folding and how does it affect performance?

**Answer:**
Constant folding is a compiler optimization that evaluates constant expressions at compile time, replacing them with their computed value. This means the CPU never performs the computation — it sees only the final literal.

```go
const MB = 1 << 20
const BufSize = 8 * MB
```

After constant folding, `BufSize` is the literal `8388608` in the binary. No multiplication instruction is emitted.

**Performance impact**: Zero runtime overhead for constant expressions. Additionally, constant conditions enable dead code elimination:

```go
const debug = false
if debug { /* this block is removed from the binary */ }
```

**What the interviewer is testing:** Understanding of compiler optimizations and their practical impact.

---

### Q24. What is the internal precision of an untyped float constant in Go?

**Answer:**
Untyped float constants are stored with at least 256 bits of mantissa precision during compilation (the Go spec requires at least 256 bits). This is far more precise than `float64` (52-bit mantissa). Only when assigned to a `float32` or `float64` variable is the precision reduced.

```go
// This constant has more precision than float64
const Pi = 3.14159265358979323846264338327950288419716939937510

var f32 float32 = Pi  // rounded to ~7 decimal digits
var f64 float64 = Pi  // rounded to ~15 decimal digits
```

**What the interviewer is testing:** Deep knowledge of the Go spec's requirements for constant precision.

---

### Q25. Can `iota` be used in a function inside a `const` block?

**Answer:**
No. `iota` can only be used in the expression on the right-hand side of a const spec at the top level of a const block. It cannot be used inside a function literal or any nested expression that is not directly a const spec:

```go
const (
    A = iota                          // OK
    B = func() int { return iota }()  // ERROR: iota is not in a const declaration
)
```

`iota` is substituted by the type-checker at the const spec level. Inside a function literal, the type-checker does not have access to the outer const-block's `iota` counter.

**What the interviewer is testing:** Precise understanding of `iota`'s scope.

---

### Q26. Where are string constants stored in a Go binary, and what are the implications?

**Answer:**
String constants are stored in the **`.rodata` (read-only data) section** of the compiled binary. At runtime:

- The string bytes are at a fixed address in read-only memory.
- Any attempt to modify the bytes via `unsafe` causes a segmentation fault.
- The linker may deduplicate identical string constants across packages.
- Multiple `string` variables holding the same constant share the same underlying bytes.

Implication: string constants have zero runtime allocation cost (they're already in the binary). But you must never attempt to modify them, even via `unsafe`.

**What the interviewer is testing:** Systems-level understanding of binary layout.

---

### Q27. What Go standard library package can you use to evaluate constant expressions programmatically?

**Answer:**
The `go/constant` package provides types and functions for representing and evaluating compile-time constant values. It supports:

- Integer, float, complex, string, and boolean constants
- Arithmetic and bitwise operations
- Arbitrary-precision integer and float values
- Comparison operations

```go
import (
    "go/constant"
    "go/token"
    "fmt"
)

x := constant.MakeInt64(1024)
y := constant.Shift(x, token.SHL, 10) // 1024 << 10
fmt.Println(y) // 1048576
```

This package is used internally by the Go compiler's type-checker and is also useful for linters, code generators, and static analysis tools.

**What the interviewer is testing:** Awareness of Go's tooling ecosystem and internal packages.

---

## Rapid-Fire Quiz

These are yes/no or one-word questions for quick self-assessment:

| Question | Answer |
|---------|--------|
| Can a `const` hold a `[]int` value? | No |
| Does `iota` reset in each new `const` block? | Yes |
| What is the default type of the untyped constant `42`? | `int` |
| Can you use `iota` in a `var` block? | No |
| What operator removes a bit flag from a bitmask? | `&^` |
| Does assigning a constant to a variable create a copy? | N/A — constants have no address |
| Are constant expressions evaluated at compile time? | Yes |
| Can a typed `int` constant be assigned to `int8` without cast? | No |
| Can an untyped `100` be assigned to `int8`? | Yes (fits in int8) |
| Does `_` in a const block advance `iota`? | Yes |
| Is `iota` a function? | No |
| What is the first value of `iota` in every const block? | 0 |
| Can constants reference each other? | Yes |
| Can a `const` be declared inside a function? | Yes |

---

## Coding Challenges

### Challenge 1 — Write a permission system

Write a `Permission` type using `iota` with `Read`, `Write`, `Execute`, `Admin` flags. Implement `Has()`, `Add()`, `Remove()` methods and a `String()` method.

<details>
<summary>Solution</summary>

```go
type Permission uint

const (
    PermRead    Permission = 1 << iota // 1
    PermWrite                          // 2
    PermExecute                        // 4
    PermAdmin                          // 8
)

func (p Permission) Has(flag Permission) bool {
    return p&flag == flag
}

func (p Permission) Add(flag Permission) Permission {
    return p | flag
}

func (p Permission) Remove(flag Permission) Permission {
    return p &^ flag
}

func (p Permission) String() string {
    flags := map[Permission]string{
        PermRead:    "read",
        PermWrite:   "write",
        PermExecute: "execute",
        PermAdmin:   "admin",
    }
    result := ""
    for flag, name := range flags {
        if p.Has(flag) {
            if result != "" {
                result += "|"
            }
            result += name
        }
    }
    if result == "" {
        return "none"
    }
    return result
}
```
</details>

### Challenge 2 — Byte size constants with iota

Implement `ByteSize` constants KB, MB, GB, TB, PB using `iota` and add a `String()` method.

<details>
<summary>Solution</summary>

```go
type ByteSize float64

const (
    _           = iota
    KB ByteSize = 1 << (10 * iota)
    MB
    GB
    TB
    PB
)

func (b ByteSize) String() string {
    switch {
    case b >= PB:
        return fmt.Sprintf("%.2fPB", b/PB)
    case b >= TB:
        return fmt.Sprintf("%.2fTB", b/TB)
    case b >= GB:
        return fmt.Sprintf("%.2fGB", b/GB)
    case b >= MB:
        return fmt.Sprintf("%.2fMB", b/MB)
    case b >= KB:
        return fmt.Sprintf("%.2fKB", b/KB)
    }
    return fmt.Sprintf("%.2fB", b)
}
```
</details>

### Challenge 3 — Enum with compile-time safety

Create a `Status` enum with a sentinel `statusCount` and a `String()` array that fails to compile if the array size doesn't match.

<details>
<summary>Solution</summary>

```go
type Status int

const (
    StatusPending Status = iota
    StatusActive
    StatusClosed
    statusCount // unexported sentinel
)

// Compile-time check: array must have exactly statusCount entries
var statusNames = [statusCount]string{"pending", "active", "closed"}

func (s Status) String() string {
    if s < 0 || s >= statusCount {
        return fmt.Sprintf("Status(%d)", int(s))
    }
    return statusNames[s]
}
```
</details>

---

## Interview Tips

1. **Always explain WHY**, not just WHAT. Don't just say "iota starts at 0" — explain that it's a spec-level counter in the type-checker.

2. **Mention edge cases proactively**. If asked about iota, mention that it resets in each block and that `_` still advances it.

3. **Connect concepts**. Showing that you understand the link between `iota` → named type → `Stringer` → `go generate` demonstrates senior-level thinking.

4. **Use the zero value argument** for security. This shows practical awareness, not just syntax knowledge.

5. **Be ready to trace output by hand**. Interviewers often ask "what does this print?" — practice tracing `iota` values mentally.

6. **Know when NOT to use iota**. The strongest answers include the caveats: explicit values for stored/serialized enums.

---

## Red Flags in Answers

Watch out for these common mistakes in your answers:

| What you might say (wrong) | What to say instead |
|---------------------------|---------------------|
| "iota is a function that returns the next int" | "iota is a predeclared identifier, not a function" |
| "iota continues across const blocks" | "iota resets to 0 in each new const block" |
| "constants can hold any type" | "constants are limited to scalar types: int, float, string, bool, rune" |
| "typed and untyped constants work the same way" | "untyped constants are flexible across types; typed constants require exact type match" |
| "you can modify a constant with unsafe" | "attempting to modify a constant string causes a segfault; constants have no address" |

---

## Cheat Sheet for Review

```go
// Basic const
const Pi = 3.14159        // untyped float
const MaxItems int = 100  // typed int

// iota basics
const (
    A = iota  // 0
    B         // 1
    C         // 2
)

// iota resets
const (
    X = iota // 0 — new block
    Y        // 1
)

// Skip zero
const (
    _    = iota // 0, skipped
    One         // 1
    Two         // 2
)

// Bit flags
const (
    Read    = 1 << iota // 1
    Write               // 2
    Execute             // 4
)

// Check/add/remove flags
has := perm&Read != 0
add := perm | Write
rem := perm &^ Execute

// Byte sizes
const (
    _  = iota
    KB = 1 << (10 * iota) // 1024
    MB                     // 1048576
    GB                     // 1073741824
)

// Stringer
func (d Direction) String() string {
    return [...]string{"N","E","S","W"}[d]
}

// Compile-time array bounds check
var names = [colorCount]string{"red","green","blue"}
```
