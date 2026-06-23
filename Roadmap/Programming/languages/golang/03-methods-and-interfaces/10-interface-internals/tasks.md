# Interface Internals — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end. Every example here centers on the runtime layout of `iface` and `eface`, the `itab` cache, boxing behaviour, and `reflect` plumbing.

---

## Easy 🟢

### Task 1 — Print the size of an interface header
Use `unsafe.Sizeof` to print the size of a `fmt.Stringer` and an `any`. Confirm that both occupy two machine words.

```go
var s fmt.Stringer
var a any
// Write — print unsafe.Sizeof(s) and unsafe.Sizeof(a)
```

### Task 2 — eface vs iface field names
Define a struct that mirrors `runtime.eface` (two `unsafe.Pointer` fields). Cast an `any` into this struct via `unsafe.Pointer` and print the two pointers.

### Task 3 — reflect.TypeOf returns nil for nil interface
Show that `reflect.TypeOf((any)(nil)) == nil`, but `reflect.TypeOf((*int)(nil)) != nil`.

### Task 4 — Boxing an int
Place an `int` into an `any`. Use `runtime.KeepAlive` and check with `runtime.MemStats` whether boxing caused a heap allocation.

### Task 5 — Compare two interface values
Compare two `any` values that hold the same `int(5)`. Print the result of `==`. Then compare two `any` values that hold a `[]int` and observe the panic.

### Task 6 — Read the dynamic type name
Given `var v any = 42`, print the name of the dynamic type with `reflect.TypeOf(v).String()`.

---

## Medium 🟡

### Task 7 — Typed nil trap
Build a function that returns an `error`. Inside, declare `var e *MyErr`, do not assign it, and `return e`. Show that the caller's `err != nil` check passes even though the underlying pointer is nil.

```go
type MyErr struct{ msg string }
func (e *MyErr) Error() string { return e.msg }

func do() error {
    var e *MyErr
    return e
}
// Write — main with err != nil check
```

### Task 8 — Inspect itab via unsafe
Define an interface `Speaker { Speak() string }` and a type `Dog`. Cast a `Speaker` into a struct with two `unsafe.Pointer` fields (the iface header). Print the first word — the `*itab`.

### Task 9 — Confirm itab is cached
Assign the same concrete type to the same interface twice in different statements. Inspect the iface header in both cases and confirm that the `*itab` word is identical (the runtime cache returns the same itab).

### Task 10 — Boxing escape
Write a benchmark for `func box(x int) any { return x }`. Verify with `-benchmem` and `-gcflags='-m'` that `x` escapes to the heap.

### Task 11 — Avoid boxing with a pointer
Compare two functions:

```go
func boxValue(x int) any { return x }
func boxPointer(x *int) any { return x }
```

Benchmark both. Explain why the pointer version avoids the heap copy.

### Task 12 — reflect.ValueOf on an interface
Given `var v any = MyStruct{N: 7}`, use `reflect.ValueOf(v).FieldByName("N").Int()` to recover the field. Print it.

### Task 13 — Comparing uncomparable types
Build a slice of `any` containing a mix of `int`, `string`, and `[]byte`. Loop over pairs. Catch the panic from `[]byte == []byte` with `recover` and report the offending pair.

---

## Hard 🔴

### Task 14 — Read itab fields via unsafe
The `runtime.itab` struct (Go 1.21+) is roughly:

```
type itab struct {
    inter *interfacetype
    _type *_type
    hash  uint32
    _     [4]byte
    fun   [1]uintptr
}
```

Write a Go program that mirrors that layout, takes an interface value, and prints the `hash` field of the corresponding itab.

### Task 15 — Detect a typed nil at runtime
Write `IsTypedNil(v any) bool` — return true when the interface holds a non-nil type descriptor but a nil data pointer. Use `reflect.ValueOf(v).IsNil()` guarded by `Kind() == reflect.Ptr`.

### Task 16 — Reduce itab pressure with a switch
You have a hot loop dispatching across 50 different concrete types behind one interface. Show with a benchmark that an explicit `switch v := x.(type)` for the 3 most common types beats interface dispatch.

### Task 17 — reflect.New + Interface round-trip
Take a `reflect.Type`, call `reflect.New`, populate fields, then call `.Interface()` to recover an `any`. Print and JSON-marshal the result.

### Task 18 — Panic-safe interface compare
Write `SafeEqual(a, b any) (eq bool, ok bool)` — return `(false, false)` when comparison would panic (uncomparable types) and `(a == b, true)` otherwise.

### Task 19 — Measure dispatch cost
Benchmark three implementations of `Sum(items []Adder) int`:
1. `Adder` is an interface.
2. `Adder` is a concrete struct.
3. `Adder` is a generic type parameter `[T Adder]`.

Report nanoseconds per element and explain the gap.

---

## Expert 🟣

### Task 20 — Forge an interface header by hand
Construct an interface value of static type `fmt.Stringer` from raw `unsafe.Pointer` words: get the `*itab` from a real binding, then assemble a fresh header that points at a different concrete instance. Call `String()` on it. (This is unsafe and educational only.)

### Task 21 — Shrink boxing with a pool
A hot path produces `any` values from `int64`. Replace boxing with a `sync.Pool` of `*int64` and measure allocations before/after.

### Task 22 — itab hash distribution
For 1000 random `(interface, concrete)` pairs, compute the runtime hash (use the runtime's `getitab` indirectly by triggering a real assignment, then read `itab.hash` via unsafe). Plot a histogram of bucket distribution.

### Task 23 — Generic interface caller without itab
Build `Call[T any, F func(T) string](v T, f F) string`. Compare its allocation profile to the equivalent `func Call(v any, f func(any) string) string`.

---

## Solutions

### Solution 1

```go
package main

import (
    "fmt"
    "unsafe"
)

func main() {
    var s fmt.Stringer
    var a any
    fmt.Println(unsafe.Sizeof(s)) // 16 on amd64
    fmt.Println(unsafe.Sizeof(a)) // 16 on amd64
}
```

Both interface headers are two words: `(tab, data)` for iface, `(_type, data)` for eface.

### Solution 2

```go
type eface struct {
    typ  unsafe.Pointer
    data unsafe.Pointer
}

func main() {
    var a any = 42
    e := *(*eface)(unsafe.Pointer(&a))
    fmt.Printf("typ=%p data=%p\n", e.typ, e.data)
}
```

### Solution 3

```go
fmt.Println(reflect.TypeOf((any)(nil)) == nil)    // true
fmt.Println(reflect.TypeOf((*int)(nil)) == nil)   // false: *int still has a type
```

### Solution 4

```go
var before, after runtime.MemStats
runtime.ReadMemStats(&before)
var sink any
for i := 0; i < 1_000_000; i++ {
    sink = i // boxes — heap alloc
}
runtime.KeepAlive(sink)
runtime.ReadMemStats(&after)
fmt.Println(after.Mallocs - before.Mallocs)
```

### Solution 5

```go
var a any = 5
var b any = 5
fmt.Println(a == b) // true

defer func() {
    if r := recover(); r != nil { fmt.Println("panic:", r) }
}()
var x any = []int{1}
var y any = []int{1}
fmt.Println(x == y) // panic: runtime error: comparing uncomparable type []int
```

### Solution 6

```go
var v any = 42
fmt.Println(reflect.TypeOf(v).String()) // int
```

### Solution 7

```go
type MyErr struct{ msg string }
func (e *MyErr) Error() string { return e.msg }

func do() error {
    var e *MyErr
    return e // wraps (typ=*MyErr, data=nil)
}

func main() {
    err := do()
    if err != nil {
        fmt.Println("oops, looks non-nil:", err) // prints
    }
}
```

The interface header has `typ != nil` (it knows about `*MyErr`), so `err != nil` is true even when the data pointer is nil.

### Solution 8

```go
type Speaker interface{ Speak() string }
type Dog struct{ name string }
func (d *Dog) Speak() string { return "woof" }

type iface struct{ tab, data unsafe.Pointer }

func main() {
    var s Speaker = &Dog{name: "rex"}
    h := *(*iface)(unsafe.Pointer(&s))
    fmt.Printf("itab=%p data=%p\n", h.tab, h.data)
}
```

### Solution 9

```go
var s1 Speaker = &Dog{}
var s2 Speaker = &Dog{}
h1 := *(*iface)(unsafe.Pointer(&s1))
h2 := *(*iface)(unsafe.Pointer(&s2))
fmt.Println(h1.tab == h2.tab) // true — itab is cached per (interface, concrete) pair
```

### Solution 10

```go
func box(x int) any { return x }

func BenchmarkBox(b *testing.B) {
    for i := 0; i < b.N; i++ { _ = box(i) }
}
// go test -bench . -benchmem -gcflags='-m'
// box(...) leaks param: x to heap — boxing forces allocation
```

### Solution 11

```go
func boxValue(x int) any   { return x }
func boxPointer(x *int) any { return x }

// boxPointer reuses an existing heap pointer — interface data is the pointer itself.
// boxValue must allocate space for x on the heap so the data word can hold its address.
```

### Solution 12

```go
type MyStruct struct{ N int }
var v any = MyStruct{N: 7}
n := reflect.ValueOf(v).FieldByName("N").Int()
fmt.Println(n) // 7
```

### Solution 13

```go
items := []any{1, "x", []byte("a"), []byte("b")}
for i := 0; i < len(items); i++ {
    for j := i + 1; j < len(items); j++ {
        func(a, b any) {
            defer func() {
                if r := recover(); r != nil {
                    fmt.Printf("compare panic at (%d,%d): %v\n", i, j, r)
                }
            }()
            _ = a == b
        }(items[i], items[j])
    }
}
```

### Solution 14

```go
type _type struct{ /* opaque */ }
type interfacetype struct{ /* opaque */ }
type itab struct {
    inter *interfacetype
    typ   *_type
    hash  uint32
    _     [4]byte
    fun   [1]uintptr
}
type iface struct{ tab *itab; data unsafe.Pointer }

var s fmt.Stringer = myStringer{}
h := *(*iface)(unsafe.Pointer(&s))
fmt.Println(h.tab.hash)
```

The hash is what the runtime uses to look up the itab in `itabTable`.

### Solution 15

```go
func IsTypedNil(v any) bool {
    if v == nil { return false } // both words zero — untyped nil
    rv := reflect.ValueOf(v)
    switch rv.Kind() {
    case reflect.Ptr, reflect.Map, reflect.Slice, reflect.Chan, reflect.Func:
        return rv.IsNil()
    }
    return false
}
```

### Solution 16

```go
type Op interface{ Run(int) int }

func dispatch(op Op, x int) int { return op.Run(x) }

func dispatchSwitch(op Op, x int) int {
    switch v := op.(type) {
    case AddOne: return v.Run(x) // inlined
    case Double: return v.Run(x)
    case Square: return v.Run(x)
    default:     return op.Run(x) // fallback through itab
    }
}
```

The type-switch shortcut hits a known concrete type, allowing the compiler to inline and skip the itab indirection.

### Solution 17

```go
t := reflect.TypeOf(MyStruct{})
v := reflect.New(t).Elem()
v.FieldByName("N").SetInt(99)
out := v.Interface() // any backed by MyStruct{N:99}
b, _ := json.Marshal(out)
fmt.Println(string(b))
```

### Solution 18

```go
func SafeEqual(a, b any) (eq, ok bool) {
    defer func() {
        if r := recover(); r != nil {
            eq, ok = false, false
        }
    }()
    return a == b, true
}
```

### Solution 19

```go
type Adder interface{ Add(int) int }
type Inc struct{ d int }
func (i Inc) Add(x int) int { return x + i.d }

func sumIface(items []Adder) int { /* itab dispatch */ }
func sumConcrete(items []Inc) int { /* static call */ }
func sumGeneric[T Adder](items []T) int { /* monomorphised */ }
```

Concrete is fastest; generics on a struct type are close behind; the interface version pays for itab lookup plus an indirect call per element.

### Solution 20

```go
type iface struct{ tab, data unsafe.Pointer }

type real struct{ s string }
func (r *real) String() string { return r.s }

func main() {
    var orig fmt.Stringer = &real{s: "original"}
    h := *(*iface)(unsafe.Pointer(&orig))

    other := &real{s: "forged"}
    forged := iface{tab: h.tab, data: unsafe.Pointer(other)}

    var s fmt.Stringer = *(*fmt.Stringer)(unsafe.Pointer(&forged))
    fmt.Println(s.String()) // "forged"
}
```

The itab is stable for a `(fmt.Stringer, *real)` pair, so reusing it is safe — only the data word changes.

### Solution 21

```go
var pool = sync.Pool{New: func() any { return new(int64) }}

func boxed(x int64) any {
    p := pool.Get().(*int64)
    *p = x
    return p
}

// Callers must Put p back when done. Removes one alloc per box at the cost of complexity.
```

### Solution 22

```go
buckets := make(map[uint32]int)
for i := 0; i < 1000; i++ {
    var s fmt.Stringer = randomStringer(i)
    h := *(*iface)(unsafe.Pointer(&s))
    buckets[h.tab.hash & 0xff]++
}
fmt.Println(buckets) // expect roughly even distribution
```

### Solution 23

```go
func CallGeneric[T any](v T, f func(T) string) string { return f(v) }
func CallAny(v any, f func(any) string) string        { return f(v) }
```

The generic version specialises per `T` — no boxing, no itab. The `any` version boxes both the value and the function call site.

---

## Cheat Sheet

```
INTERFACE LAYOUT
─────────────────────────────
iface  = (*itab, data unsafe.Pointer)   // 2 words
eface  = (*_type, data unsafe.Pointer)  // 2 words (any)

itab   = inter, _type, hash, fun[...]    // method table cache

BOXING RULES
─────────────────────────────
non-pointer concrete → heap alloc to back data
pointer concrete     → data = the pointer (no copy)
nil concrete pointer → typed-nil trap

REFLECT
─────────────────────────────
TypeOf((any)(nil))    == nil
TypeOf((*T)(nil))     != nil  // type known
ValueOf(v).IsNil()    requires Kind in {Ptr, Map, Slice, Chan, Func}

COMPARISON
─────────────────────────────
==  on iface compares (type, data)
panic when underlying type is uncomparable: slice, map, func
```
