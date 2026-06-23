# Methods on Defined Types — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Methods on Function Types — http.HandlerFunc](#methods-on-function-types-httphandlerfunc)
3. [Anatomy of the HandlerFunc Adapter](#anatomy-of-the-handlerfunc-adapter)
4. [Methods on Slice Types — sort.IntSlice](#methods-on-slice-types-sortintslice)
5. [Methods on Map Types](#methods-on-map-types)
6. [Methods on Channel Types](#methods-on-channel-types)
7. [Generic Map Type — Set[T comparable]](#generic-map-type-sett-comparable)
8. [Defined Types and Interface Satisfaction](#defined-types-and-interface-satisfaction)
9. [Why Function-Type Methods Matter](#why-function-type-methods-matter)
10. [Method Promotion Through Defined Types](#method-promotion-through-defined-types)
11. [Coding Patterns](#coding-patterns)
12. [Common Mistakes at the Middle Level](#common-mistakes-at-the-middle-level)
13. [Test](#test)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)

---

## Introduction

The junior file covered methods on simple primitives: `int`, `string`, basic slices. At the middle level we go further:

- **Function types** as receivers — `http.HandlerFunc.ServeHTTP` is the canonical example
- **Slice types** that implement `sort.Interface`
- **Map types** with first-class methods (`http.Header`)
- **Channel types** that hide the channel mechanics behind methods
- **Generic map types** like `Set[T comparable]`

This file shows the patterns; the senior and professional files turn them into design-level arguments.

---

## Methods on Function Types — http.HandlerFunc

The single most quoted example of a method on a function type comes from `net/http`:

```go
// In net/http (paraphrased):
type HandlerFunc func(ResponseWriter, *Request)

// HandlerFunc.ServeHTTP turns an ordinary function into a Handler.
func (f HandlerFunc) ServeHTTP(w ResponseWriter, r *Request) {
    f(w, r)
}

type Handler interface {
    ServeHTTP(ResponseWriter, *Request)
}
```

There is something slightly mind-bending about this. Read the receiver carefully:

- `f` is the receiver
- Its type is `HandlerFunc`
- `HandlerFunc` is itself a **function type**
- So inside the method, `f` is a callable value
- `f(w, r)` calls that function

That is enough. With this one method, **any** function with the matching signature can be **converted** into a `HandlerFunc`, and instantly satisfies the `Handler` interface.

```go
package main

import (
    "fmt"
    "net/http"
)

func hello(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintln(w, "hello")
}

func main() {
    var h http.Handler = http.HandlerFunc(hello) // function -> HandlerFunc
    _ = h
}
```

Without `HandlerFunc`, you would have to wrap every plain function in a struct just to satisfy `http.Handler`. The defined function type makes the wrapping invisible.

---

## Anatomy of the HandlerFunc Adapter

This pattern is so important that it has its own name in the Go community: the **HandlerFunc adapter pattern**, sometimes called the "method-on-function" or "single-method interface bridge".

The recipe has five steps:

1. You have an **interface** with one method (`Handler { ServeHTTP(...) }`).
2. You declare a **defined function type** whose signature matches that single method (`HandlerFunc func(...)`).
3. You implement the interface method on the defined function type — and the body just **calls the receiver**.
4. Now any plain function with that signature converts into a value that satisfies the interface.
5. Callers do `Adapter(myFunc)` (or even rely on the conversion happening implicitly when the function's signature matches a parameter typed as `Adapter`).

You will see this pattern any time the standard library wants to let users pass either a struct or a plain function.

### Reusable example — error reporter

```go
package report

type Reporter interface {
    Report(err error)
}

type ReporterFunc func(error)

func (f ReporterFunc) Report(err error) { f(err) }
```

Now both styles work:

```go
type stderrReporter struct{}
func (stderrReporter) Report(err error) { fmt.Fprintln(os.Stderr, err) }

var r1 report.Reporter = stderrReporter{}                       // struct
var r2 report.Reporter = report.ReporterFunc(func(err error) {  // function
    log.Println(err)
})
```

### Variant — http.Handle vs http.HandleFunc

`net/http` exposes both registration forms because of `HandlerFunc`:

```go
// Accepts a Handler interface
http.Handle("/api", myHandler)

// Accepts a function with the right signature; uses HandlerFunc internally
http.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) { ... })
```

Reading the source of `HandleFunc`:

```go
// from net/http
func HandleFunc(pattern string, handler func(ResponseWriter, *Request)) {
    DefaultServeMux.HandleFunc(pattern, handler)
}

func (mux *ServeMux) HandleFunc(pattern string, handler func(ResponseWriter, *Request)) {
    if handler == nil { panic("...") }
    mux.Handle(pattern, HandlerFunc(handler)) // <-- the conversion
}
```

`HandlerFunc(handler)` is a **type conversion**, not a function call. The runtime cost is zero — it is just a relabel.

---

## Methods on Slice Types — sort.IntSlice

The other canonical example is `sort.IntSlice`:

```go
// In package sort (paraphrased):
type IntSlice []int

func (p IntSlice) Len() int           { return len(p) }
func (p IntSlice) Less(i, j int) bool { return p[i] < p[j] }
func (p IntSlice) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }

func (p IntSlice) Sort()                  { sort.Sort(p) }
func (p IntSlice) Search(x int) int       { return sort.SearchInts(p, x) }
```

`sort.IntSlice` satisfies `sort.Interface`:

```go
type Interface interface {
    Len() int
    Less(i, j int) bool
    Swap(i, j int)
}
```

Usage:

```go
nums := []int{3, 1, 4, 1, 5, 9}
sort.Sort(sort.IntSlice(nums))     // explicit conversion
fmt.Println(nums) // [1 1 3 4 5 9]
```

The same pattern shows up for `sort.StringSlice` and `sort.Float64Slice`.

### Building your own sortable slice

```go
package main

import (
    "fmt"
    "sort"
)

type ByLen []string

func (s ByLen) Len() int           { return len(s) }
func (s ByLen) Less(i, j int) bool { return len(s[i]) < len(s[j]) }
func (s ByLen) Swap(i, j int)      { s[i], s[j] = s[j], s[i] }

func main() {
    words := []string{"banana", "fig", "apple", "kiwi"}
    sort.Sort(ByLen(words))
    fmt.Println(words) // [fig kiwi apple banana]
}
```

Note that `Swap` mutates the slice in place. The slice value `s` is a copy of the header, but the **underlying array is shared** — so the swap is visible to the caller.

This is one of the most important sentences in this file: when a method on a slice type writes to `s[i]`, the caller sees the change because both share the array. When the method does `s = append(s, ...)`, the caller sees nothing — because `append` may allocate a new array, and `s` is the local copy of the header. We will revisit this in `find-bug.md` and `optimize.md`.

---

## Methods on Map Types

`http.Header` is a map type with a curated set of methods:

```go
// In net/http (paraphrased):
type Header map[string][]string

func (h Header) Get(key string) string  { ... }
func (h Header) Set(key, value string)  { h[textproto.CanonicalMIMEHeaderKey(key)] = []string{value} }
func (h Header) Add(key, value string)  { ... }
func (h Header) Del(key string)         { delete(h, textproto.CanonicalMIMEHeaderKey(key)) }
func (h Header) Values(key string) []string { ... }
```

The methods normalize keys (`Content-Type`, not `content-type`), guarantee semantically correct multi-value handling, and hide the underlying `map[string][]string`. Callers do `h.Set("X-Foo", "1")` and never have to know the storage shape.

### Why methods on maps are interesting

The map header itself is a tiny pointer-like value; copying a `http.Header` to call a method is cheap (the underlying hash table is shared). Mutations through `Set`/`Add`/`Del` are visible to the caller — exactly because the map header points to shared state.

### Build your own map type

```go
package main

import "fmt"

type Counts map[string]int

func (c Counts) Inc(key string)         { c[key]++ }
func (c Counts) Dec(key string)         { c[key]-- }
func (c Counts) Total() int {
    sum := 0
    for _, v := range c { sum += v }
    return sum
}

func main() {
    c := Counts{}
    c.Inc("apple")
    c.Inc("apple")
    c.Inc("orange")
    fmt.Println(c.Total()) // 3
}
```

---

## Methods on Channel Types

Channels are first-class types — and they too can be defined types with methods.

```go
package main

import "fmt"

type EventBus chan string

func (b EventBus) Send(msg string)          { b <- msg }
func (b EventBus) Recv() (string, bool)     { v, ok := <-b; return v, ok }
func (b EventBus) Close()                   { close(b) }

func main() {
    bus := make(EventBus, 4)
    bus.Send("hello")
    bus.Send("world")
    bus.Close()
    for {
        v, ok := bus.Recv()
        if !ok { break }
        fmt.Println(v)
    }
}
```

In practice, channel-typed wrappers are less common than function-type or slice-type wrappers, but they show that nothing in the language privileges structs as receivers.

---

## Generic Map Type — Set[T comparable]

Go 1.18 added generics, and a defined type can be parameterized:

```go
package set

type Set[T comparable] map[T]struct{}

func New[T comparable](xs ...T) Set[T] {
    s := make(Set[T], len(xs))
    for _, x := range xs { s[x] = struct{}{} }
    return s
}

func (s Set[T]) Add(x T)            { s[x] = struct{}{} }
func (s Set[T]) Remove(x T)         { delete(s, x) }
func (s Set[T]) Contains(x T) bool  { _, ok := s[x]; return ok }
func (s Set[T]) Len() int           { return len(s) }

func (s Set[T]) Union(other Set[T]) Set[T] {
    out := make(Set[T], s.Len()+other.Len())
    for x := range s     { out[x] = struct{}{} }
    for x := range other { out[x] = struct{}{} }
    return out
}
```

Usage:

```go
s := set.New(1, 2, 3)
s.Add(4)
fmt.Println(s.Contains(2)) // true
```

The receiver type is `Set[T]`, and the method must spell out the type parameter (without its constraint). You cannot add a method-level type parameter — `func (s Set[T]) Map[U any](...)` is illegal. (See section 15 / generics specification.)

The empty struct `struct{}{}` is the customary "no value" placeholder — it occupies zero bytes, so a `Set[T]` is just a hash-table of keys.

---

## Defined Types and Interface Satisfaction

Defined types satisfy interfaces exactly the way structs do — by having the right method set.

```go
type ErrCode int
func (e ErrCode) Error() string { return fmt.Sprintf("err-%d", int(e)) }

var _ error = ErrCode(0)   // OK — ErrCode satisfies error
```

```go
type Words []string
func (w Words) Len() int { return len(w) }
func (w Words) Less(i, j int) bool { return w[i] < w[j] }
func (w Words) Swap(i, j int) { w[i], w[j] = w[j], w[i] }

var _ sort.Interface = Words(nil)   // OK
```

```go
type Counter int
func (c Counter) String() string { return fmt.Sprintf("%d", int(c)) }

var _ fmt.Stringer = Counter(0)   // OK
```

The compiler does not care whether the receiver is a struct, an int, a slice, a map, or a function. It only checks the method set.

---

## Why Function-Type Methods Matter

The function-type-with-method pattern is rare in many languages but extremely natural in Go. It exists because:

1. Go's interfaces are **structural** — implementation is implicit. So a defined function type with one method "implements" any single-method interface that fits.
2. **Conversion is free** — `HandlerFunc(plainFunc)` produces a value with the right method set without copying any code.
3. It lets the standard library accept **either a function or a struct** without overloading or generic constraints.

Sometimes you see a more elaborate variant — the function type captures state via closure:

```go
type Middleware func(http.Handler) http.Handler

func (m Middleware) Then(h http.Handler) http.Handler { return m(h) }

func RequestID() Middleware {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            id := uuid.NewString()
            r = r.WithContext(context.WithValue(r.Context(), "rid", id))
            next.ServeHTTP(w, r)
        })
    }
}
```

`Middleware` is a function type with a `Then` method. Defining the type lets us bolt helpers (`Then`, `AndAlso`, etc.) onto a thing that is, fundamentally, just a function.

---

## Method Promotion Through Defined Types

A defined type does **not** inherit the methods of its underlying type. This is the crucial difference from "alias":

```go
type T struct{}
func (T) Hello() {}

type U T

var u U
// u.Hello()   // ERROR — Hello is on T, not U
```

But via embedding you can get the methods back:

```go
type U struct{ T }

var u U
u.Hello()      // OK — promoted from T
```

For non-struct defined types, this distinction matters with interfaces:

```go
type Buf bytes.Buffer

var b Buf
// b.WriteString("x")    // ERROR — methods of *bytes.Buffer aren't on *Buf

// To inherit *bytes.Buffer's method set:
type Buf struct{ *bytes.Buffer }
b := Buf{Buffer: new(bytes.Buffer)}
b.WriteString("x")        // OK
```

Wrapping with embedding promotes the methods. This becomes important when you want to extend a cross-package type — covered in section 18.

---

## Coding Patterns

### Pattern 1: Function adapter (HandlerFunc style)

```go
// 1. Single-method interface
type Validator interface { Validate(s string) error }

// 2. Function type with the same signature
type ValidatorFunc func(string) error

// 3. Method body just calls the receiver
func (f ValidatorFunc) Validate(s string) error { return f(s) }

// Now you can do:
var v Validator = ValidatorFunc(func(s string) error {
    if s == "" { return errors.New("empty") }
    return nil
})
```

### Pattern 2: Slice-of-T sortable

```go
type ByName []User
func (s ByName) Len() int           { return len(s) }
func (s ByName) Less(i, j int) bool { return s[i].Name < s[j].Name }
func (s ByName) Swap(i, j int)      { s[i], s[j] = s[j], s[i] }
```

For ad-hoc sorting, `sort.Slice(s, less)` is shorter, but `ByName` (a defined type) reads better when the comparison is reused across the codebase.

### Pattern 3: Value-object-style constants

```go
type LogLevel int

const (
    DEBUG LogLevel = iota
    INFO
    WARN
    ERROR
)

func (l LogLevel) String() string {
    switch l {
    case DEBUG: return "DEBUG"
    case INFO:  return "INFO"
    case WARN:  return "WARN"
    case ERROR: return "ERROR"
    }
    return "?"
}

func (l LogLevel) Above(min LogLevel) bool { return l >= min }
```

`fmt.Println(WARN)` prints `WARN` because `LogLevel` has a `String()` method.

### Pattern 4: Defined map for typed keys

```go
type EnvVars map[string]string

func (e EnvVars) Lookup(key string) (string, bool) { v, ok := e[key]; return v, ok }
func (e EnvVars) Set(key, value string)            { e[key] = value }
func (e EnvVars) Render() string {
    var lines []string
    for k, v := range e { lines = append(lines, k+"="+v) }
    sort.Strings(lines)
    return strings.Join(lines, "\n")
}
```

---

## Common Mistakes at the Middle Level

### Mistake 1: Trying to extend `[]int` directly

```go
// func (s []int) Sum() int { ... }   // ERROR
```

You must wrap: `type IntSlice []int`.

### Mistake 2: Method on `func(...)` literal

```go
// func (f func(int) int) Apply(x int) int { return f(x) }   // ERROR
```

You must define the type first: `type IntOp func(int) int`.

### Mistake 3: Ambiguous receiver in HandlerFunc-style code

```go
type Adapter func(int) int
func (f Adapter) Apply(x int) int { return f(x) }

// Trap — the method receiver name `f` shadows the package-level `f`
```

Pick a receiver name that does not collide with the function in scope.

### Mistake 4: Mutating a value-receiver slice and expecting the caller to see it

```go
type IntSlice []int
func (s IntSlice) Append(x int) { s = append(s, x) } // INSIDE-ONLY

nums := IntSlice{1, 2, 3}
nums.Append(4)
fmt.Println(nums) // [1 2 3] — Append did nothing visible
```

Two fixes:

```go
// Option A — return the new slice
func (s IntSlice) Append(x int) IntSlice { return append(s, x) }
nums = nums.Append(4)

// Option B — pointer receiver
func (s *IntSlice) Append(x int) { *s = append(*s, x) }
nums.Append(4)
```

This is a slice-specific pitfall, not a struct one.

### Mistake 5: Forgetting `byte`/`rune` are aliases

```go
// func (b byte) IsAlpha() bool { ... }  // ERROR — byte is alias for uint8
type MyByte byte                          // OK — defined type, distinct from byte
func (b MyByte) IsAlpha() bool { ... }
```

Same story for `rune` (alias of `int32`).

---

## Test

### 1. Why is `http.HandlerFunc` defined as a function type rather than a struct?

- a) Performance
- b) So that any plain function with the matching signature can be converted to it and gain the `ServeHTTP` method
- c) Function types are required by `net/http`
- d) To avoid garbage collection

**Answer: b**

### 2. What is the receiver type in `func (p IntSlice) Less(i, j int) bool`?

- a) `[]int`
- b) `IntSlice`
- c) `int`
- d) `sort.Interface`

**Answer: b** — the receiver is the defined type, not its underlying.

### 3. Will this code work?

```go
type Adder func(int, int) int
func (a Adder) Identity() func(int, int) int { return a }

f := Adder(func(x, y int) int { return x + y })
g := f.Identity()
fmt.Println(g(2, 3))
```

- a) Compile error
- b) Runtime panic
- c) Prints 5
- d) Prints 0

**Answer: c** — `f` is callable as a function, `Identity()` returns it, and we call it.

### 4. Sort the following slice with `sort.IntSlice`:

```go
nums := []int{3, 1, 4}
sort.Sort(sort.IntSlice(nums))
```

What is the value of `nums` after this call?

- a) `[1 3 4]`
- b) `[3 1 4]`
- c) Compile error
- d) Runtime panic

**Answer: a** — the slice is sorted in place because `Swap` mutates the shared array.

### 5. Which is the correct way to make `Set[T comparable] map[T]struct{}` and add an `Add` method?

```go
// (a)
type Set[T comparable] map[T]struct{}
func (s Set[T]) Add(x T) { s[x] = struct{}{} }

// (b)
type Set map[T]struct{}
func (s Set) Add[T comparable](x T) { s[x] = struct{}{} }
```

**Answer: a** — methods cannot have their own type parameters.

---

## Cheat Sheet

```
FUNCTION-TYPE METHOD (HandlerFunc style)
────────────────────────────────────────
type F func(...)
func (f F) MethodName(...) { f(...) }

Anchors:
* the receiver type IS the function
* inside the body, calling f(...) calls the receiver
* used to satisfy single-method interfaces with plain functions

SLICE-TYPE METHOD (sort.IntSlice style)
────────────────────────────────────────
type S []T
func (s S) Len() int           { return len(s) }
func (s S) Less(i, j int) bool { ... }
func (s S) Swap(i, j int)      { s[i], s[j] = s[j], s[i] }

WARNING — slice value receiver:
* s[i] = ... is visible to caller (shared array)
* s = append(s, x) is NOT visible (return or use pointer)

MAP-TYPE METHOD (http.Header style)
────────────────────────────────────────
type M map[K]V
func (m M) Get(k K) V    { return m[k] }
func (m M) Set(k K, v V) { m[k] = v }

* mutations are visible to the caller
* m["k"]'s pointer-receiver-method rule still applies (not addressable)

GENERIC MAP TYPE
────────────────────────────────────────
type Set[T comparable] map[T]struct{}
func (s Set[T]) Add(x T) { s[x] = struct{}{} }

* methods may use T (the receiver's type parameter)
* methods CANNOT introduce their own type parameter

CHANNEL-TYPE METHOD
────────────────────────────────────────
type Bus chan T
func (b Bus) Send(x T) { b <- x }

DEFINED-TYPE METHOD INHERITANCE
────────────────────────────────────────
type U T          U does NOT inherit T's methods
type U struct{T}  U promotes T's methods
```

---

## Summary

At the middle level, the key takeaways are:

1. **Function types as receivers** unlock the `HandlerFunc` adapter pattern. A defined function type plus one method bridges a single-method interface to plain functions.
2. **Slice types as receivers** are the standard way to satisfy `sort.Interface`, `flag.Value`, and similar interfaces. Watch the in-place mutation rules carefully.
3. **Map types as receivers** model collections with curated APIs (`http.Header`, custom counters, env-var collections).
4. **Channel types as receivers** are rarer but legal.
5. **Generic defined types** (`Set[T comparable]`) carry methods that can use the receiver's type parameters — but never their own.
6. **Defined types do not inherit methods** from their underlying type. Embedding gets you that promotion.

These are the concrete patterns. The senior file builds the design philosophy around them — domain primitives, type-safe IDs, ADT-like enums.
