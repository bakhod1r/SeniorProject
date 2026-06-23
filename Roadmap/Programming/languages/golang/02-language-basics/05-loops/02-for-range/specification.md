# for-range Statement — Specification
> Source: [Go Language Specification](https://go.dev/ref/spec) — §For_range

---

## 1. Spec Reference

The `for-range` statement is a specialized form of the `for` statement defined in the Go Language Specification at:

https://go.dev/ref/spec#For_range

Official spec text:
> "A 'for' statement with a 'range' clause iterates through all entries of an array, slice, string or map, receives values sent on a channel, or iterates from 0 up to a given integer value. For each entry it assigns iteration values to corresponding iteration variables if present and then executes the block."

The range clause was introduced in Go 1.0. Integer range was added in **Go 1.22**.

---

## 2. Formal Grammar

From the Go Language Specification:

```ebnf
ForStmt     = "for" [ Condition | ForClause | RangeClause ] Block .
RangeClause = [ ExpressionList "=" | IdentifierList ":=" ] "range" Expression .
```

The `Expression` on the right of `range` must evaluate to one of:
- array
- pointer to array
- slice
- string
- map
- channel (receive direction allowed: `chan T` or `<-chan T`)
- integer (Go 1.22+)

Valid forms of the range clause:

```go
for i, v := range x { }   // short variable declaration — declares i and v
for i, v = range x { }    // assignment — i and v must already be declared
for i := range x { }      // only first iteration variable
for i = range x { }       // only first iteration variable, assignment form
for range x { }           // no iteration variables (Go 1.4+)
for _, v := range x { }   // blank identifier discards index/key
```

---

## 3. Core Rules & Constraints

1. The range expression is evaluated **exactly once** before the loop begins.
2. For arrays and slices, a copy of the array header (len + cap + pointer) is made before iteration — mutations to the slice header inside the loop do not affect iteration count.
3. For maps, iteration visits each key-value pair **once**, but order is **not guaranteed**.
4. For strings, iteration is over Unicode code points (runes), not bytes. The index is the byte position of the rune's first byte.
5. For channels, the loop receives values until the channel is closed.
6. For integer `n`, the loop iterates from `0` to `n-1` (inclusive).
7. If `n <= 0`, the integer range loop body is never executed.
8. The blank identifier `_` may be used to discard either the index or the value.
9. Using `_` for both variables (`for _, _ = range x`) is valid but `for range x` is preferred.
10. Variables declared with `:=` in the range clause are **new variables scoped to the for block**; they do not escape the loop.

---

## 4. Type Rules

### Range expression types and iteration variables

| Range Expression Type | 1st Iteration Variable | 2nd Iteration Variable |
|-----------------------|------------------------|------------------------|
| `[n]T` (array)        | index `int`            | element copy `T`       |
| `*[n]T` (ptr to array)| index `int`            | element copy `T`       |
| `[]T` (slice)         | index `int`            | element copy `T`       |
| `string`              | byte index `int`       | rune (decoded) `rune`  |
| `map[K]V`             | key `K`                | value copy `V`         |
| `chan T` / `<-chan T`  | element `T`            | (none — only 1 var)    |
| `integer` (Go 1.22+)  | `0..n-1` (same type)   | (none — only 1 var)    |

The types of the iteration variables are **inferred** from the range expression — they cannot be declared with explicit types in the range clause.

### Assignment compatibility

When using assignment form (`=` instead of `:=`), the existing variables must be assignable from the iteration variable types:

```go
var idx int
var val string
for idx, val = range []string{"a", "b"} {
    _ = idx
    _ = val
}
```

---

## 5. Behavioral Specification

### Array and slice iteration

```go
s := []int{10, 20, 30}
for i, v := range s {
    // i is index: 0, 1, 2
    // v is a COPY of s[i]
    // modifying v does NOT modify s
}
```

The range expression `s` is evaluated once. The length is fixed at that moment. Appending to `s` inside the loop does **not** add more iterations.

### String iteration (rune decoding)

The range over a string decodes UTF-8 sequences. Each iteration yields:
- `i`: byte offset of the start of the rune
- `v`: the decoded `rune` value

Invalid UTF-8 sequences produce the replacement character `\uFFFD` (U+FFFD) and advance by one byte.

```go
s := "hello, 世界"
for i, r := range s {
    // "世" starts at byte index 7, r == '世' (rune value 19990)
    _ = i
    _ = r
}
```

To iterate over **bytes**, use an index loop: `for i := 0; i < len(s); i++`.

### Map iteration

Order is **randomized**. The spec explicitly guarantees that iteration order is not defined. This randomization is intentional and has been in place since Go 1.0 to prevent programs from accidentally depending on map ordering.

### Channel iteration

A `for range` over a channel receives values until the channel is **closed**. If the channel is never closed, the loop runs forever (blocks waiting for more values). A nil channel blocks forever too.

```go
ch := make(chan int)
go func() {
    for i := 0; i < 5; i++ {
        ch <- i
    }
    close(ch)
}()
for v := range ch {
    fmt.Println(v) // 0 1 2 3 4
}
```

### Integer iteration (Go 1.22+)

```go
for i := range 5 {
    fmt.Print(i, " ") // 0 1 2 3 4
}

// Type of i matches the type of the integer expression
var n int64 = 10
for i := range n {
    // i is int64
}
```

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| Range over nil slice | Defined — zero iterations |
| Range over nil map | Defined — zero iterations |
| Range over nil channel | Defined — blocks forever (deadlock if no sender) |
| Range over closed channel | Defined — drains buffered values, then exits |
| Range over empty string | Defined — zero iterations |
| Range over negative integer | Defined — zero iterations (Go 1.22+) |
| Modifying slice elements during range | Defined — modifications to `s[i]` are visible (value copy `v` still holds old value) |
| Appending to slice during range | Defined — extra elements are NOT visited (range saw original length) |
| Adding map keys during range | **Partially defined** — added keys may or may not be visited |
| Deleting map keys during range | Defined — deleted keys not yet visited will NOT be produced |
| Concurrent map read/write during range | **Undefined (data race)** — detected by race detector, may panic |
| Assigning to range variable `v` | Defined — only changes local copy, does not affect source |

---

## 7. Edge Cases from Spec

### Modifying slice through index vs value copy

```go
s := []int{1, 2, 3}
for i, v := range s {
    s[i] = v * 2   // modifies original slice — visible to next iterations
    v = 999        // modifies only the local copy — no effect on s
}
fmt.Println(s) // [2 4 6]
```

### Range evaluates expression once

```go
s := []int{1, 2, 3}
for i := range s {
    if i == 0 {
        s = append(s, 4, 5) // replaces s with a new slice
    }
    fmt.Println(s[i]) // still iterates 3 times (original length was 3)
}
```

### Pointer to array

```go
arr := [3]int{10, 20, 30}
p := &arr
for i, v := range p { // valid: range over *[3]int
    fmt.Println(i, v)
}
```

### Range and closures (classic gotcha, fixed in Go 1.22)

```go
// Go 1.21 and earlier: all closures capture the same loop variable
funcs := make([]func(), 3)
for i, v := range []int{1, 2, 3} {
    i, v := i, v // re-declare to capture distinct copies (pre-1.22 workaround)
    funcs[i] = func() { fmt.Println(v) }
}

// Go 1.22+: each iteration has its OWN i and v variables
// No re-declaration needed
for i, v := range []int{1, 2, 3} {
    funcs[i] = func() { fmt.Println(v) } // v is per-iteration in 1.22+
}
```

This behavior change in Go 1.22 is controlled by the `go` directive in `go.mod`. Modules with `go 1.22` or later get the new per-iteration variable semantics.

### String with invalid UTF-8

```go
s := "a\xffb" // \xff is invalid UTF-8
for i, r := range s {
    fmt.Printf("%d: %c (%d)\n", i, r, r)
    // 0: a (97)
    // 1: <replacement char> (65533)  ← \xff decoded as U+FFFD
    // 2: b (98)
}
```

### Range over integer type

```go
type MyInt int

func main() {
    var n MyInt = 5
    for i := range n {
        fmt.Println(i) // i is MyInt: 0, 1, 2, 3, 4
    }
}
```

---

## 8. Version History

| Version | Change |
|---------|--------|
| Go 1.0  | `for-range` introduced for arrays, slices, strings, maps, channels |
| Go 1.4  | `for range x { }` with no variables allowed |
| Go 1.22 | Range over integers added |
| Go 1.22 | Per-iteration loop variable semantics for range loops (breaking change, opt-in via go.mod) |
| Go 1.23 | Range over functions (iterator protocol) added |

---

## 9. Implementation-Specific Behavior

### Map iteration randomization

The Go runtime seeds map iteration with a random start position and traverses bucket slots in an unpredictable order. The exact algorithm is **not part of the spec** and has changed between Go versions. Do not write code that depends on map iteration order, even within a single run.

### Range variable storage

The Go compiler may allocate range variables on the stack or heap depending on escape analysis. In Go 1.22+, each iteration's variables are logically distinct, but the compiler may still optimize them into a single stack slot if no closures capture them.

### Integer range type

For `for i := range n`, the type of `i` is **the same type as `n`**. If `n` is `int64`, `i` is `int64`. This is resolved at compile time.

---

## 10. Spec Compliance Checklist

- [ ] Range over a nil map/slice is handled gracefully (zero iterations, no panic)
- [ ] Map iteration order is never assumed to be consistent
- [ ] Range variable `v` is not modified expecting source to change
- [ ] Closures in range loops capture per-iteration variables (or re-declare in pre-1.22 code)
- [ ] Channel range loops always have a corresponding `close(ch)` to avoid deadlock
- [ ] String range uses byte index (not character index) for `i`
- [ ] Invalid UTF-8 in string range is handled (produces U+FFFD replacement)
- [ ] Integer range (Go 1.22+) not used in codebases with `go` directive < 1.22
- [ ] `for range x {}` (no variables) used when index and value are both unneeded

---

## 11. Official Examples

### Range over slice

```go
package main

import "fmt"

func main() {
    primes := []int{2, 3, 5, 7, 11}

    // Both index and value
    for i, p := range primes {
        fmt.Printf("primes[%d] = %d\n", i, p)
    }

    // Only index
    for i := range primes {
        fmt.Printf("index: %d\n", i)
    }

    // Only value (discard index)
    for _, p := range primes {
        fmt.Printf("prime: %d\n", p)
    }

    // Neither (count iterations)
    count := 0
    for range primes {
        count++
    }
    fmt.Println("count:", count) // 5
}
```

### Range over string

```go
package main

import "fmt"

func main() {
    s := "Go: 世界"

    fmt.Println("Rune iteration:")
    for i, r := range s {
        fmt.Printf("  byte[%d] = U+%04X %c\n", i, r, r)
    }

    fmt.Println("\nByte iteration:")
    for i := 0; i < len(s); i++ {
        fmt.Printf("  byte[%d] = %02x\n", i, s[i])
    }
}
```

### Range over map

```go
package main

import (
    "fmt"
    "sort"
)

func main() {
    m := map[string]int{
        "apple":  5,
        "banana": 3,
        "cherry": 8,
    }

    // Order is NOT guaranteed
    fmt.Println("Unordered:")
    for k, v := range m {
        fmt.Printf("  %s: %d\n", k, v)
    }

    // To iterate in sorted order, sort keys first
    keys := make([]string, 0, len(m))
    for k := range m {
        keys = append(keys, k)
    }
    sort.Strings(keys)

    fmt.Println("Sorted:")
    for _, k := range keys {
        fmt.Printf("  %s: %d\n", k, m[k])
    }
}
```

### Range over channel

```go
package main

import "fmt"

func generate(nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        for _, n := range nums {
            out <- n
        }
        close(out) // must close to terminate range loop
    }()
    return out
}

func main() {
    for v := range generate(2, 3, 5, 7) {
        fmt.Println(v)
    }
}
```

### Range over integer (Go 1.22+)

```go
package main

import "fmt"

func main() {
    // Print 0 through 4
    for i := range 5 {
        fmt.Println(i)
    }

    // Build a slice of squares
    squares := make([]int, 10)
    for i := range 10 {
        squares[i] = i * i
    }
    fmt.Println(squares) // [0 1 4 9 16 25 36 49 64 81]
}
```

---

## 12. Related Spec Sections

| Section | URL |
|---------|-----|
| For statements | https://go.dev/ref/spec#For_statements |
| For range | https://go.dev/ref/spec#For_range |
| Range over integers (1.22) | https://go.dev/ref/spec#For_range |
| String types | https://go.dev/ref/spec#String_types |
| Map types | https://go.dev/ref/spec#Map_types |
| Channel types | https://go.dev/ref/spec#Channel_types |
| Blank identifier | https://go.dev/ref/spec#Blank_identifier |
| Short variable declarations | https://go.dev/ref/spec#Short_variable_declarations |
| Go 1.22 release notes | https://go.dev/doc/go1.22 |
| Go 1.23 release notes (range over func) | https://go.dev/doc/go1.23 |
