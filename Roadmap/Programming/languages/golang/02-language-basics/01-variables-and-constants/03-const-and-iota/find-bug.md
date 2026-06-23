# const and iota — Find the Bug

## Overview

This file contains 12 buggy Go programs. Each bug is related to `const` and `iota`. Your task is to:
1. Read the code and the described symptom
2. Identify the bug without looking at the hint
3. Open the `<details>` block to check your answer

Bugs range from compile errors to silent logic errors — the most dangerous kind.

---

## Bug 1 — Trying to Assign to a Constant

### Code

```go
package main

import "fmt"

const MaxRetries = 3

func main() {
    MaxRetries = 5 // attempt to increase retries at runtime
    fmt.Println("Max retries:", MaxRetries)
}
```

### Symptom
This code does not compile.

### What's Wrong?
Find the bug before opening the hint.

<details>
<summary>Hint</summary>
Constants are immutable. You cannot reassign a value to a constant after it is declared.
</details>

<details>
<summary>Bug & Fix</summary>

**Bug**: `MaxRetries = 5` on line 8 tries to assign to a constant.

**Error message**:
```
cannot assign to MaxRetries (declared const)
```

**Fix**: If the value needs to change at runtime, use `var`:
```go
var MaxRetries = 3

func main() {
    MaxRetries = 5
    fmt.Println("Max retries:", MaxRetries)
}
```

Or, if 5 is always the value, change the constant declaration:
```go
const MaxRetries = 5
```
</details>

---

## Bug 2 — iota Used Outside a const Block

### Code

```go
package main

import "fmt"

var (
    A = iota
    B = iota
    C = iota
)

func main() {
    fmt.Println(A, B, C)
}
```

### Symptom
Compile error.

### What's Wrong?

<details>
<summary>Hint</summary>
`iota` is only valid inside `const` blocks, not `var` blocks.
</details>

<details>
<summary>Bug & Fix</summary>

**Bug**: `iota` is used inside a `var` block. This causes a compile error:
```
undefined: iota
```

`iota` is a predeclared identifier available exclusively inside `const` blocks.

**Fix**: Change `var` to `const`:
```go
const (
    A = iota // 0
    B        // 1
    C        // 2
)

func main() {
    fmt.Println(A, B, C) // 0 1 2
}
```

Or if mutable variables are needed, assign them manually:
```go
var (
    A = 0
    B = 1
    C = 2
)
```
</details>

---

## Bug 3 — Wrong Assumption About iota Reset

### Code

```go
package main

import "fmt"

const (
    Red = iota // 0
    Green      // 1
    Blue       // 2
)

const (
    Small  = iota + Red   // developer expects: Red + 0 = 0
    Medium                 // developer expects: Red + 1 = 1
    Large                  // developer expects: Red + 2 = 2
)

func main() {
    fmt.Println("Red:", Red)
    fmt.Println("Small:", Small)
    fmt.Println("Medium:", Medium)
    fmt.Println("Large:", Large)
}
```

### Symptom
The developer expected `Small`, `Medium`, `Large` to be 0, 1, 2 (same as `Red`, `Green`, `Blue`). But the output is unexpected.

### What is the actual output? What's wrong?

<details>
<summary>Hint</summary>
`iota` resets to 0 in each new const block. What does `iota + Red` evaluate to in the second block?
</details>

<details>
<summary>Bug & Fix</summary>

**Bug**: The developer misunderstood how `iota + Red` works in the second const block.

In the second block:
- `Small = iota + Red` → `iota=0`, `Red=0` → `Small = 0 + 0 = 0` ✓
- `Medium` repeats expression `iota + Red` with `iota=1` → `Medium = 1 + 0 = 1` ✓
- `Large` repeats expression `iota + Red` with `iota=2` → `Large = 2 + 0 = 2` ✓

Actually in this specific case the output happens to be correct. The real bug would appear if `Red` were non-zero:

**Real demonstration of the bug**:
```go
const (
    _ = iota // skip 0
    Red       // 1
    Green     // 2
    Blue      // 3
)

const (
    Small  = iota + Red // iota=0, Red=1 → Small = 1 (not 0!)
    Medium              // iota=1, Red=1 → Medium = 2 (not 1!)
    Large               // iota=2, Red=1 → Large = 3 (not 2!)
)
```

**Fix**: Don't mix iota from different blocks in expressions unless intentional. Be explicit:
```go
const (
    Small  = 0
    Medium = 1
    Large  = 2
)
```
</details>

---

## Bug 4 — Typed Constant Assignment Mismatch

### Code

```go
package main

import "fmt"

const MaxSize int = 100

func allocate(size int8) {
    fmt.Println("Allocating", size, "units")
}

func main() {
    allocate(MaxSize)
}
```

### Symptom
Compile error when calling `allocate`.

### What's Wrong?

<details>
<summary>Hint</summary>
`MaxSize` is a typed constant of type `int`. The function expects `int8`. Typed constants do not automatically convert.
</details>

<details>
<summary>Bug & Fix</summary>

**Bug**: `MaxSize` is declared as `const MaxSize int = 100`. When you pass it to a function expecting `int8`, Go does not automatically convert typed constants — this is different from untyped constants.

**Error**:
```
cannot use MaxSize (type int) as type int8 in argument to allocate
```

**Fix Option 1**: Make `MaxSize` an untyped constant (remove the explicit type):
```go
const MaxSize = 100 // untyped — fits in int8 at the call site
```

**Fix Option 2**: Explicit conversion at the call site:
```go
allocate(int8(MaxSize))
```

**Fix Option 3**: Change the function signature:
```go
func allocate(size int) { ... }
```

The underlying value `100` fits in `int8` (range -128 to 127), so all three fixes work.
</details>

---

## Bug 5 — Zero Value of Enum Is a Valid "Admin" State

### Code

```go
package main

import "fmt"

type Role int

const (
    Admin Role = iota // 0
    Editor            // 1
    Viewer            // 2
)

func checkAccess(r Role) {
    if r == Admin {
        fmt.Println("Full access granted")
    } else {
        fmt.Println("Limited access")
    }
}

func main() {
    var r Role // uninitialized — defaults to 0
    checkAccess(r)
}
```

### Symptom
An uninitialized `Role` variable grants full admin access. This is a silent security bug — no error, no warning.

### What's Wrong?

<details>
<summary>Hint</summary>
The zero value of `int` in Go is `0`. What is `Admin`'s value?
</details>

<details>
<summary>Bug & Fix</summary>

**Bug**: `Admin = iota` assigns the value `0` to `Admin`. In Go, the zero value of `Role` (an `int`) is `0`. Any uninitialized `Role` variable is automatically `Admin` — which is the most privileged role.

**Silent output**: `Full access granted` — even for a zero-value (uninitialized) role.

**Fix**: Ensure the zero value is the LEAST privileged or unknown state:
```go
type Role int

const (
    RoleUnknown Role = 0  // explicit: zero = unauthorized
    RoleViewer  Role = 1
    RoleEditor  Role = 2
    RoleAdmin   Role = 3
)
```

Or use iota + 1:
```go
const (
    _           Role = iota // skip 0 — zero = uninitialized
    RoleViewer              // 1
    RoleEditor              // 2
    RoleAdmin               // 3
)
```

Now `var r Role` has value `0` which matches no named constant — access is correctly denied.
</details>

---

## Bug 6 — Array Index Out of Bounds in String()

### Code

```go
package main

import "fmt"

type Season int

const (
    Spring Season = iota
    Summer
    Autumn
    Winter
)

func (s Season) String() string {
    return [...]string{"Spring", "Summer", "Autumn"}[s] // only 3 entries!
}

func main() {
    fmt.Println(Spring) // OK
    fmt.Println(Summer) // OK
    fmt.Println(Autumn) // OK
    fmt.Println(Winter) // PANIC!
}
```

### Symptom
The program panics when printing `Winter`.

### What's Wrong?

<details>
<summary>Hint</summary>
Count the elements in the string array. Count the Season constants. Do they match?
</details>

<details>
<summary>Bug & Fix</summary>

**Bug**: The `String()` method uses an array of 3 strings but there are 4 Season constants (Spring=0, Summer=1, Autumn=2, Winter=3). When `Winter` (value 3) is used as an index into a 3-element array, the index is out of bounds and the program panics.

**Panic message**:
```
runtime error: index out of range [3] with length 3
```

**Fix Option 1**: Add the missing element:
```go
func (s Season) String() string {
    return [...]string{"Spring", "Summer", "Autumn", "Winter"}[s]
}
```

**Fix Option 2**: Add bounds checking:
```go
func (s Season) String() string {
    names := [...]string{"Spring", "Summer", "Autumn", "Winter"}
    if s < 0 || int(s) >= len(names) {
        return fmt.Sprintf("Season(%d)", int(s))
    }
    return names[s]
}
```

**Fix Option 3**: Use the sentinel pattern for compile-time safety:
```go
const (
    Spring Season = iota
    Summer
    Autumn
    Winter
    seasonCount
)

var seasonNames = [seasonCount]string{"Spring", "Summer", "Autumn", "Winter"}
// Compile error if array size != seasonCount
```
</details>

---

## Bug 7 — iota Values Shifted After Inserting a New Constant

### Code

```go
// version 1 of the package
package main

import "fmt"

type Color int

const (
    Red   Color = iota // 0
    Green              // 1
    Blue               // 2
)

// Values stored in database: Red=0, Green=1, Blue=2

// Later, developer inserts Yellow between Red and Green:
// const (
//     Red    Color = iota // 0
//     Yellow              // 1 — NEW
//     Green               // 2 — was 1, now 2!
//     Blue                // 3 — was 2, now 3!
// )

func loadFromDB(stored int) Color {
    return Color(stored)
}

func main() {
    // Simulating loading old data: "1" was Green
    c := loadFromDB(1)
    fmt.Println(c) // originally prints "Green"
    // After adding Yellow: prints "Yellow" — WRONG!
}
```

### Symptom
After inserting `Yellow`, all stored database values that were `Green` (1) now load as `Yellow`, and `Blue` (2) loads as `Green`. Silent data corruption.

### What's Wrong?

<details>
<summary>Hint</summary>
`iota` values depend on insertion order. Inserting a constant shifts all following values.
</details>

<details>
<summary>Bug & Fix</summary>

**Bug**: Using `iota` for constants that are stored in a database makes them order-dependent. Inserting `Yellow` at position 1 shifts `Green` from 1 to 2 and `Blue` from 2 to 3. Any row in the database with value `1` (originally meaning "Green") now means "Yellow".

**Fix**: Use explicit integer values for constants that are stored externally:
```go
type Color int

const (
    Red    Color = 1
    Green  Color = 2
    Blue   Color = 3
    Yellow Color = 4 // added later, safe — doesn't shift others
)
```

Now you can add `Yellow` at any value without affecting existing database rows.
</details>

---

## Bug 8 — Checking Bit Flags with `==` Instead of `&`

### Code

```go
package main

import "fmt"

type Permission int

const (
    Read    Permission = 1 << iota // 1
    Write                          // 2
    Execute                        // 4
)

func canRead(p Permission) bool {
    return p == Read // BUG: should use bitwise AND
}

func main() {
    perm := Read | Write // 3
    fmt.Println(canRead(perm)) // developer expects true — gets false!
}
```

### Symptom
`canRead(Read | Write)` returns `false` even though the user has read permission.

### What's Wrong?

<details>
<summary>Hint</summary>
`Read | Write` equals `3`. Is `3 == Read` (which is `1`)? What operator checks whether a specific bit is set?
</details>

<details>
<summary>Bug & Fix</summary>

**Bug**: `p == Read` checks whether `p` is *exactly* equal to `Read` (1). But `perm = Read | Write = 3`, and `3 != 1`, so `canRead` returns `false`.

To check whether a flag is **set** in a bitmask, you must use the bitwise AND operator:

**Fix**:
```go
func canRead(p Permission) bool {
    return p&Read != 0
}
```

Explanation: `3 & 1 = 1` (binary: `011 & 001 = 001`). Since `1 != 0`, the Read bit is set — correctly returns `true`.

**General rule**:
- `p == flag` → checks if p is EXACTLY that one flag and nothing else
- `p & flag != 0` → checks if the flag bit is SET within p (which may have other flags too)
</details>

---

## Bug 9 — Constant Cannot Hold a Runtime Value

### Code

```go
package main

import (
    "fmt"
    "os"
)

const HomeDir = os.Getenv("HOME")

func main() {
    fmt.Println("Home directory:", HomeDir)
}
```

### Symptom
Compile error.

### What's Wrong?

<details>
<summary>Hint</summary>
Can `os.Getenv` be called at compile time? Constants must be determinable at compile time.
</details>

<details>
<summary>Bug & Fix</summary>

**Bug**: `os.Getenv("HOME")` is a runtime function call. `const` values must be computable at compile time. The compiler cannot evaluate `os.Getenv` during compilation.

**Error**:
```
const initializer os.Getenv("HOME") is not a constant
```

**Fix**: Use `var` for values that are determined at runtime:
```go
var HomeDir = os.Getenv("HOME")

func main() {
    fmt.Println("Home directory:", HomeDir)
}
```

Or fetch it inside the function:
```go
func main() {
    home := os.Getenv("HOME")
    fmt.Println("Home directory:", home)
}
```
</details>

---

## Bug 10 — Missing Case Silently Ignored in Switch

### Code

```go
package main

import "fmt"

type Status int

const (
    StatusPending  Status = iota
    StatusActive
    StatusClosed
    StatusRefunded // added recently
)

func describe(s Status) string {
    switch s {
    case StatusPending:
        return "Waiting for payment"
    case StatusActive:
        return "Order is being processed"
    case StatusClosed:
        return "Order completed"
    // developer forgot to add StatusRefunded
    }
    return "" // silently returns empty string for StatusRefunded
}

func main() {
    fmt.Println(describe(StatusActive))
    fmt.Println(describe(StatusRefunded)) // silently returns ""
}
```

### Symptom
`describe(StatusRefunded)` returns an empty string. No error, no warning, no panic. The bug could go unnoticed for a long time.

### What's Wrong?

<details>
<summary>Hint</summary>
Go's `switch` does not require exhaustive cases. When a new constant is added to an enum, all existing switches need to be updated manually.
</details>

<details>
<summary>Bug & Fix</summary>

**Bug**: A new constant `StatusRefunded` was added to the `Status` enum, but the `describe` function's `switch` was not updated. The switch falls through to `return ""`, silently returning an empty string.

**Fix Option 1**: Add the missing case:
```go
case StatusRefunded:
    return "Order has been refunded"
```

**Fix Option 2**: Add a `default` that panics or returns an error for unknown values:
```go
default:
    panic(fmt.Sprintf("unhandled Status value: %d", s))
```

**Fix Option 3**: Use the `exhaustive` linter in CI:
```bash
go install github.com/nishanths/exhaustive/cmd/exhaustive@latest
exhaustive ./...
```

The linter will flag any non-exhaustive switches over named iota types.

**Prevention**: Always add a `default` case that signals a problem when new enum values are unhandled.
</details>

---

## Bug 11 — Using AND-NOT Wrong (Using XOR Instead)

### Code

```go
package main

import "fmt"

type Flag uint

const (
    FlagA Flag = 1 << iota // 1
    FlagB                   // 2
    FlagC                   // 4
)

func removeFlag(perm, flag Flag) Flag {
    return perm ^ flag // developer used XOR instead of AND-NOT
}

func main() {
    perm := FlagA | FlagB | FlagC // 7 = 0b111

    // Remove FlagB
    perm = removeFlag(perm, FlagB)
    fmt.Println(perm) // developer expects 5 (0b101), gets 5 — seems OK

    // Remove FlagB again (already removed)
    perm = removeFlag(perm, FlagB)
    fmt.Println(perm) // developer expects 5 (still 5 — FlagB wasn't set)
                      // but gets 7 (0b111) — FlagB was RE-ADDED!
}
```

### Symptom
Removing a flag that is already absent using XOR adds the flag back. The function is incorrect for idempotent removal.

### What's Wrong?

<details>
<summary>Hint</summary>
XOR (`^`) toggles bits: if a bit is 0, it becomes 1; if it's 1, it becomes 0. This is not "remove flag" — it's "toggle flag". What operator *clears* bits unconditionally?
</details>

<details>
<summary>Bug & Fix</summary>

**Bug**: `perm ^ flag` (XOR) toggles the flag's bit. If the bit was set, it clears it. If the bit was NOT set, it SETS it — adding the flag back!

First removal: `0b111 ^ 0b010 = 0b101` (5) — correct, FlagB removed.
Second removal: `0b101 ^ 0b010 = 0b111` (7) — WRONG! FlagB was just added back.

**Fix**: Use `&^` (bitwise AND-NOT / bit clear) to unconditionally clear bits:
```go
func removeFlag(perm, flag Flag) Flag {
    return perm &^ flag
}
```

- First removal:  `0b111 &^ 0b010 = 0b101` (5) — correct
- Second removal: `0b101 &^ 0b010 = 0b101` (5) — correct, idempotent

`&^` is the correct operator for "remove flag regardless of current state".
</details>

---

## Bug 12 — Untyped Constant Overflow Detected Late

### Code

```go
package main

import "fmt"

// Developer calculates max array size for a memory limit
const MaxArraySize = 1 << 32 // 4 billion elements

func allocate() [MaxArraySize]byte {
    var buf [MaxArraySize]byte
    return buf
}

func main() {
    buf := allocate()
    fmt.Println(len(buf))
}
```

### Symptom
On a 32-bit platform (or when `int` is 32-bit), this may cause a compile error. On 64-bit, it compiles but may cause memory issues. The root issue is using an untyped constant without thinking about the target type.

### What's Wrong?

<details>
<summary>Hint</summary>
`1 << 32` is `4294967296`. What is the maximum `int` value on a 32-bit system? What is the maximum size of a Go array?
</details>

<details>
<summary>Bug & Fix</summary>

**Bug**: `1 << 32` as a constant is fine (untyped constants have arbitrary precision). However:
1. On 32-bit platforms, `int` is 32 bits and cannot hold `4294967296` (which requires 33 bits).
2. `[MaxArraySize]byte` with 4 billion bytes = 4GB of stack allocation — this will overflow the stack or be rejected by the compiler.
3. Go arrays cannot have a size that overflows `int`.

**Fix Option 1**: Use a smaller size:
```go
const MaxArraySize = 1 << 20 // 1MB — reasonable
var buf [MaxArraySize]byte
```

**Fix Option 2**: Use a slice on the heap instead:
```go
const MaxSize = 1 << 32 // still valid as constant
buf := make([]byte, MaxSize) // heap-allocated, but still 4GB!
```

**Fix Option 3**: Rethink the design — 4 billion elements is almost certainly too large for a single array. Consider streaming, chunking, or limiting the design.

**Lesson**: Just because a constant can hold a large value doesn't mean it can be used everywhere. Always consider the target context when using large constants.
</details>

---

## Summary Table

| Bug | Type | Danger Level |
|-----|------|-------------|
| 1 | Assigning to a constant | Compile error (safe) |
| 2 | iota in var block | Compile error (safe) |
| 3 | Mixing iota across blocks | Logic error (silent) |
| 4 | Typed constant mismatch | Compile error (safe) |
| 5 | Zero value = admin role | Security bug (dangerous) |
| 6 | String() array too short | Runtime panic |
| 7 | Storing iota values in DB | Data corruption (dangerous) |
| 8 | `==` instead of `&` for flags | Logic error (silent) |
| 9 | Runtime value in const | Compile error (safe) |
| 10 | Missing switch case | Silent wrong output |
| 11 | XOR instead of AND-NOT | Logic error (silent) |
| 12 | Constant overflow in context | Platform-dependent error |

**Most dangerous bugs**: 5, 7, 8, 10, 11 — they produce no error but cause incorrect behavior.

**Key takeaways**:
- Zero value of enum should mean "unknown/unauthorized", not the most powerful role.
- Never store iota-based values in persistent storage without explicit values.
- Always use `&flag != 0` (not `== flag`) for bit flag checks.
- Use `&^` (AND-NOT) not `^` (XOR) for flag removal.
- Use the `exhaustive` linter to catch missing switch cases.
