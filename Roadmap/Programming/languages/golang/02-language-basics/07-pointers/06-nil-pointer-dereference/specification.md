# Go Specification: Nil Pointer Dereference

**Source:** https://go.dev/ref/spec#Pointer_types
**Sections:** Pointer types; Run-time panics; Method sets

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Pointer types** | https://go.dev/ref/spec#Pointer_types |
| **Run-time panics** | https://go.dev/ref/spec#Run_time_panics |
| **Method sets** | https://go.dev/ref/spec#Method_sets |
| **Runtime errors** | https://pkg.go.dev/runtime#hdr-Runtime_errors |
| **Go Versions** | Go 1.0 (the panic itself); Go 1.21 (`*runtime.PanicNilError`) |

Official text (Pointer types):
> "A pointer type denotes the set of all pointers to variables of a given type, called the base type of the pointer. The value of an uninitialized pointer is nil."

Official text (Run-time panics):
> "Execution errors such as attempting to index an array out of bounds trigger a run-time panic equivalent to a call of the built-in function panic with a value of the implementation-defined interface type runtime.Error."

---

## 2. Definition

A **nil pointer dereference** is the runtime panic that occurs when a Go program attempts to load from or store to the address contained in a `nil` pointer. It is a special case of the general "run-time panic" mechanism described in the spec.

The panic message is:
```
runtime error: invalid memory address or nil pointer dereference
```

Since Go 1.21, the panic value is `*runtime.PanicNilError`, a typed implementation of `runtime.Error`. Before Go 1.21, the value was an untyped string-based error.

---

## 3. Core Rules & Constraints

### 3.1 Zero Value of Pointer Types is `nil`

Every pointer type's zero value is `nil`:

```go
var p *int        // p == nil
var q *MyStruct   // q == nil
```

This applies to:
- Pointers to all types: `*int`, `*string`, `*MyStruct`, etc.
- Function values: `var f func()` is nil.
- Interface values: `var i interface{}` is nil.
- Maps, slices, channels: nil zero values.

For pointer types, dereferencing the zero value triggers the panic.

### 3.2 What Counts as a Dereference

The following operations dereference a pointer:
- `*p` — explicit indirection.
- `p.Field` — implicit dereference for struct field access.
- `p.Method()` — implicit dereference for value-receiver methods.
- `p.Method()` where Method has pointer receiver AND body reads/writes a field.
- `(*p)[i]` — index after dereference.
- `f()` where `f` is a nil function value (loads the funcval's code pointer).
- `i.M()` where `i` is a nil interface (loads the interface's type word).

### 3.3 What Does NOT Dereference

The following operations do NOT dereference and do not panic on nil:
- `p == nil`, `p != nil` — comparisons.
- `q := p` — copying the pointer value.
- `&p` — taking the address of the pointer variable (the variable, not what it points to).
- `fmt.Println(p)` — prints `<nil>` without loading.
- `func(p *T) { ... }(nil)` — passing nil as an argument.

### 3.4 Methods on Nil Receivers

A method with a pointer receiver may be called on a nil receiver. The method dispatch itself does not require dereferencing the receiver. The body's safety depends on whether it reads any fields:

```go
type Counter struct{ n int }

func (c *Counter) Type() string { return "Counter" } // safe on nil
func (c *Counter) Get() int     { return c.n }       // panics on nil

var c *Counter
c.Type() // OK
c.Get()  // PANIC
```

Methods with value receivers always dereference (to copy the receiver), so calling them on nil pointers always panics.

### 3.5 Nil Map vs Nil Slice vs Nil Pointer

These are distinct cases with distinct error messages:

```go
var m map[string]int
v := m["k"]      // OK — returns zero V
m["k"] = 1       // panic: assignment to entry in nil map

var s []int
fmt.Println(len(s))  // 0
v := s[0]            // panic: index out of range [0] with length 0

var p *int
*p                   // panic: invalid memory address or nil pointer dereference
```

### 3.6 Typed Nil in Interface

A non-nil concrete pointer type (`*T`) wrapped in an interface (e.g., `error`) produces an interface value that is non-nil even when the pointer is nil:

```go
var p *MyErr
var e error = p
fmt.Println(e == nil)   // false
```

The interface compares equal to `nil` only when both the type word and data word are nil. Assigning a typed nil populates the type word.

### 3.7 Nil Function Value

A function value (`func(...)`) at runtime contains a code pointer. A nil function value's code pointer is nil. Calling it loads from address 0 and faults — a nil pointer dereference.

```go
var f func()
f() // panic: invalid memory address or nil pointer dereference
```

### 3.8 Recovery

A nil pointer panic is recoverable via `recover()` in a deferred function in the same goroutine:

```go
defer func() {
    if r := recover(); r != nil {
        // r is the panic value
    }
}()
```

Recovery prevents process termination. It does not undo any side effects of partially-completed operations.

---

## 4. Type Rules

### 4.1 Pointer Types

A pointer type `*T` is the type of pointers to values of type `T`. It is comparable; two pointers are equal iff they point to the same variable or are both nil.

```go
var p, q *int
p == q // true (both nil)
```

### 4.2 Conversion to Interface

Assigning `*T` to an interface variable creates an interface value with type tag `*T` and data pointer equal to the pointer value (which may be nil):

```go
var p *T
var i any = p
// i has type tag *T, data nil
```

### 4.3 Method Set Implications

The method set of `*T` includes methods declared with both value and pointer receivers. Calling any of these on a nil pointer is a runtime concern (not a type-system one).

---

## 5. Behavioral Specification

### 5.1 Panic Value (Go 1.21+)

The runtime panics with a value of type `*runtime.PanicNilError`:

```go
import "runtime"

defer func() {
    if r := recover(); r != nil {
        if _, ok := r.(*runtime.PanicNilError); ok {
            // specifically nil
        }
    }
}()
```

`*runtime.PanicNilError` implements the `runtime.Error` interface and the `error` interface, with the message "invalid memory address or nil pointer dereference".

### 5.2 Panic Message Format

The runtime emits a stack trace like:

```
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=0x...]
```

`addr` reports the offending address (often 0, but may be a small positive integer for field-offset accesses).

### 5.3 Stack Unwinding

After the panic, deferred functions in the panicking goroutine run in LIFO order. Each may recover. If none does, the runtime calls `fatalpanic`, which prints the trace for all goroutines and exits.

### 5.4 Goroutine Isolation

A panic in goroutine A does not directly affect goroutine B. But an unrecovered panic terminates the entire process, so all goroutines stop indirectly.

### 5.5 Multi-Word Loads

For struct fields at offsets larger than the protected nil page (typically 64 KB), the compiler emits an explicit nil check. Otherwise, the load itself faults via the MMU.

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior |
|-----------|----------|
| Dereferencing nil `*T` | Defined — panic |
| Calling pointer-receiver method on nil with non-field-touching body | Defined — runs body safely |
| Calling pointer-receiver method on nil with field access | Defined — panic when the field is loaded |
| Calling value-receiver method on nil pointer | Defined — panic at receiver copy |
| Reading nil map | Defined — returns zero V |
| Writing nil map | Defined — panic |
| Indexing nil slice | Defined — panic, "index out of range" |
| Calling nil function value | Defined — panic |
| Comparing nil pointer to nil | Defined — true |
| Comparing typed nil in interface to nil | Defined — false (data word nil but type word non-nil) |
| Recovery in deferred function | Defined — catches the panic |
| Recovery outside deferred function | Defined — recover returns nil immediately |

---

## 7. Edge Cases from Spec

### 7.1 Method Value on Nil

```go
type T struct{}
func (t *T) M() {}
var t *T
m := t.M // method value — captures nil receiver
m()      // call — does not panic if M's body doesn't access fields
```

### 7.2 Embedded Nil Field

```go
type Inner struct{ v int }
type Outer struct{ *Inner }

var o *Outer
_ = o.v // panic: dereferences o
```

### 7.3 Slice of Pointers

```go
items := make([]*int, 5) // all nil
fmt.Println(*items[0])   // panic
```

### 7.4 Map of Pointers

```go
m := map[string]*int{}
v := m["k"]  // v is nil
*v           // panic
```

### 7.5 Nil Function in Slice

```go
fns := []func(){nil, func() {}}
fns[0]() // panic
fns[1]() // OK
```

### 7.6 `panic(nil)` (Go 1.21+)

`panic(nil)` is now equivalent to `panic(*runtime.PanicNilError{})` — recover returns a non-nil value. Before 1.21, recover returned nil after `panic(nil)`, making it indistinguishable from "no panic in flight".

### 7.7 Type Assertion on Nil Interface

```go
var i interface{}
v := i.(*T) // panic: interface conversion: interface is nil, not *T
```

The error message differs from nil pointer dereference because it's a different runtime check.

### 7.8 Zero Value of Struct Fields

```go
type T struct{ p *int }
t := T{}    // t.p is nil
*t.p        // panic
```

### 7.9 Nil Channel Send / Receive

```go
var ch chan int
ch <- 1 // blocks forever; no panic
<-ch    // blocks forever; no panic
close(ch) // panic: close of nil channel
```

Distinct from nil pointer dereference.

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | Nil pointer dereference panic via `runtime.Error` with generic message |
| Go 1.14 | Open-coded defers reduce overhead of `defer recover()` |
| Go 1.21 | `*runtime.PanicNilError` introduced; `panic(nil)` now produces this typed value |
| Go 1.22 | (No specific changes to nil semantics, but improvements in error wrapping documentation) |
| Go 1.23 | (No specific changes) |

Backward compatibility: code that compares panic values via string still works post-1.21, since `*runtime.PanicNilError`'s `Error()` returns the same message.

---

## 9. Implementation-Specific Behavior

### 9.1 Signal Handler

The Go runtime installs a SIGSEGV handler at process start. The handler identifies nil-page faults and converts them to panics.

Source: `src/runtime/signal_unix.go`, `src/runtime/signal_amd64.go` (per-arch).

### 9.2 `panicmem` Function

The runtime entry point for nil panics:

```go
// src/runtime/panic.go
func panicmem() {
    panicCheck1(getcallerpc(), "invalid memory address or nil pointer dereference")
    panic(memoryError) // or *PanicNilError post-1.21
}
```

### 9.3 Compiler-Emitted Nil Checks

The compiler emits explicit nil checks (SSA op `OpNilCheck`) when:
- The dereference offset exceeds the protected nil page size.
- The pointer cannot be proven non-nil by SSA passes.
- An interface method dispatch requires it.

The `nilcheckelim` and `prove` SSA passes eliminate redundant checks.

Source: `src/cmd/compile/internal/ssa/nilcheck.go`, `src/cmd/compile/internal/ssa/prove.go`.

### 9.4 Low-Memory Protection

Go relies on the OS mapping the first N kilobytes of the address space as inaccessible. Linux's `vm.mmap_min_addr` (typically 65536) enforces this. Without it, nil deref might not fault.

### 9.5 `recover` Implementation

`recover` is implemented as a runtime intrinsic. It checks whether the current goroutine is panicking and whether the current frame is a deferred function. If both, it consumes the panic and returns its value.

Source: `src/runtime/panic.go` (`gorecover`, `gopanic`).

---

## 10. Spec Compliance Checklist

- [ ] Pointer zero value is nil
- [ ] Dereference of nil panics with the standard message
- [ ] Methods on nil pointers run only if their body doesn't access fields
- [ ] Nil maps allow read but not write
- [ ] Nil slices allow len/range/append but not indexing
- [ ] Typed nil in interface produces non-nil interface value
- [ ] Nil function variable call panics
- [ ] `recover()` in deferred function catches the panic
- [ ] Go 1.21+: panic value is `*runtime.PanicNilError`

---

## 11. Official Examples

### Example 1: Direct Dereference Panic

```go
package main

func main() {
    var p *int
    _ = *p
}
```

Output:
```
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=...]
```

### Example 2: Recover

```go
package main

import "fmt"

func main() {
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()
    var p *int
    _ = *p
}
```

Output:
```
recovered: runtime error: invalid memory address or nil pointer dereference
```

### Example 3: Nil-Safe Method

```go
package main

import "fmt"

type T struct{ v int }

func (t *T) Show() {
    if t == nil {
        fmt.Println("<nil>")
        return
    }
    fmt.Println(t.v)
}

func main() {
    var t *T
    t.Show()
}
```

Output:
```
<nil>
```

### Example 4: Typed Nil in Interface

```go
package main

import "fmt"

type MyErr struct{ msg string }

func (e *MyErr) Error() string { return e.msg }

func op() error {
    var e *MyErr
    return e
}

func main() {
    err := op()
    fmt.Println(err == nil) // false
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Pointer types | https://go.dev/ref/spec#Pointer_types | Defines pointer semantics |
| Run-time panics | https://go.dev/ref/spec#Run_time_panics | Panic mechanism |
| Method sets | https://go.dev/ref/spec#Method_sets | Method dispatch on pointers |
| Selectors | https://go.dev/ref/spec#Selectors | Field/method access (auto-deref) |
| Interface types | https://go.dev/ref/spec#Interface_types | Interface representation |
| `runtime` package | https://pkg.go.dev/runtime | `PanicNilError`, `Error` interface |
| `errors` package | https://pkg.go.dev/errors | `errors.As` for safe type extraction |
| FAQ — nil error | https://go.dev/doc/faq#nil_error | The typed-nil-in-interface gotcha |
