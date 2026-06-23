# Channel Direction — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [How the Compiler Represents Channel Direction](#how-the-compiler-represents-channel-direction)
3. [Direction in the Type Identity Algorithm](#direction-in-the-type-identity-algorithm)
4. [Assignability and Convertibility Rules](#assignability-and-convertibility-rules)
5. [Runtime: No Direction Anywhere](#runtime-no-direction-anywhere)
6. [`reflect.ChanDir` and Reflective Channels](#reflectchandir-and-reflective-channels)
7. [Codegen: What the Compiler Emits](#codegen-what-the-compiler-emits)
8. [Type Descriptors and Direction](#type-descriptors-and-direction)
9. [Direction with `unsafe` and `cgo`](#direction-with-unsafe-and-cgo)
10. [Generics: Type Parameters and Direction](#generics-type-parameters-and-direction)
11. [Edge Cases the Compiler Has to Handle](#edge-cases-the-compiler-has-to-handle)
12. [Self-Assessment](#self-assessment)
13. [Summary](#summary)

---

## Introduction

At professional level we go below the surface. The questions:

- Where in the compiler is direction tracked?
- What does the AST look like for `chan<- T`?
- How does the type checker reject a send on `<-chan T`?
- What does `reflect.TypeOf(chan<- T).ChanDir()` return, and where does that value come from?
- How does codegen differ — or not differ — for the three directions?

You should already understand directional channels at junior, middle, and senior levels. This file is about implementation, not usage.

References to source are based on Go 1.22 source tree. File paths are within `$GOROOT`. Line numbers drift; use grep to locate.

---

## How the Compiler Represents Channel Direction

The Go compiler (`cmd/compile`) holds channel types in a `*types2.Chan` value (for the new type-checker introduced in Go 1.18) and `*types.Chan` (older API used in some passes). Each carries:

```go
// src/go/types/type.go (simplified)
type Chan struct {
    dir  ChanDir       // SendRecv, SendOnly, RecvOnly
    elem Type
}

type ChanDir int

const (
    SendRecv ChanDir = iota
    SendOnly
    RecvOnly
)
```

The grammar in `src/go/parser/parser.go` produces an AST node `*ast.ChanType` for each channel type literal:

```go
type ChanType struct {
    Begin token.Pos
    Arrow token.Pos     // position of `<-`, or NoPos if absent
    Dir   ChanDir       // bitfield: SEND, RECV, SEND|RECV
    Value Expr          // element type
}
```

`ChanDir` in `ast` is a bitfield (`SEND | RECV` means bidirectional), while in `types` it is an enum. The type-checker maps from one to the other.

### Parsing a channel type

Three productions in the grammar:

```
ChannelType  = ( "chan" | "chan" "<-" | "<-" "chan" ) ElementType
```

When the parser sees `chan<-`, it sets `Dir = SEND`. When it sees `<-chan`, it sets `Dir = RECV`. Bare `chan` sets `Dir = SEND | RECV`.

### Right-to-left chaining

`chan<- <-chan T` parses as: outer `chan<-` with element type `<-chan T`. The parser is greedy left-to-right and prefers the inner `<-chan T` consumes the `<-` before `chan`. The Go spec is unambiguous because `<-` is left-associative when attached to `chan` from the left, so `chan<- <-chan T` parses uniquely.

The reverse-disambiguation case the spec calls out: `chan <- chan int`. With proper spacing, this is `chan<-` `chan int`, a send-only channel of bidirectional int channels. Without context, the parser would not know if `<-` belongs to the outer `chan` or to a hypothetical receive operation. The spec dictates that `<-` is associated with the *leftmost* possible `chan`, so the parse is `(chan<-) (chan int)`.

---

## Direction in the Type Identity Algorithm

The Go type system distinguishes types by *identity*, not just by structure. Two channel types are identical if:

1. They have the same direction.
2. Their element types are identical.

```go
// src/go/types/predicates.go (sketch)
func identical(x, y Type) bool {
    switch x := x.(type) {
    case *Chan:
        if y, ok := y.(*Chan); ok {
            return x.dir == y.dir && identical(x.elem, y.elem)
        }
    }
    return false
}
```

So `chan int` and `chan<- int` are not identical. They are also not *assignable* across the directional barrier (one direction only — covered below).

The identity check happens countless times: function call type-matching, return value verification, slice element type comparison. Each time, the direction must match exactly unless an assignability rule applies.

### Why no direction "subtype"

Go does not have a notion of structural subtyping for channels. There is no "`chan T` is a subtype of `chan<- T`." Instead, Go has an explicit assignability rule for channels that says "a `chan T` value is assignable to a `chan<- T` variable if T identifies." This is a one-off rule, not a general feature.

---

## Assignability and Convertibility Rules

The Go spec section on assignability (`go/ref/spec#Assignability`) has a specific clause for channels:

> *"V's type V and T are channel types with identical element types, V is a bidirectional channel, and at least one of V or T is not a named type."*

Reading carefully:

- The *value's* type V must be bidirectional.
- The *target* type T can be bidirectional, send-only, or receive-only.
- The element types must be identical (no covariance, no element-type widening).
- At least one of V or T must be unnamed.

That last clause excludes weirdness like:

```go
type RecvInt = <-chan int    // alias
type SendInt = chan<- int    // alias

var bi chan int = make(chan int)
var r RecvInt = bi           // works — RecvInt is an alias to an unnamed type
```

For a *defined* (not aliased) named type around a directional channel, the rule still permits assignment from bidirectional because the bidirectional `chan int` is unnamed.

### Explicit conversion: the same rule

Explicit conversions (`T(x)`) follow the same assignability rules for channel types. There is no separate "convertible but not assignable" set for channels. This is why `(chan int)(sendOnly)` does not compile — neither the assignability rule nor any conversion rule permits it.

### Cross-direction is not allowed

`chan<- T` to `<-chan T` (and vice versa) is *not* assignable. Both are directional; neither is bidirectional; the assignability rule requires the source to be bidirectional. The compiler refuses.

### Code in the compiler

The check happens in `src/go/types/operand.go`, function `assignableTo`:

```go
// Simplified
func (x *operand) assignableTo(check *Checker, T Type) (bool, ErrCode) {
    if /* ... other checks ... */ {
        return true, 0
    }
    // V is a channel type
    if Vch, ok := x.typ.(*Chan); ok {
        if Tch, ok := T.(*Chan); ok {
            if identical(Vch.elem, Tch.elem) && Vch.dir == SendRecv {
                return true, 0
            }
        }
    }
    return false, _IncompatibleAssign
}
```

The condition `Vch.dir == SendRecv` is the one-way restriction. Both checks must pass: same element type, source is bidirectional.

---

## Runtime: No Direction Anywhere

The Go runtime — `src/runtime/chan.go` — has no concept of direction. The `hchan` struct is:

```go
type hchan struct {
    qcount   uint           // total data in the queue
    dataqsiz uint           // size of the circular queue
    buf      unsafe.Pointer // buffer pointer
    elemsize uint16
    closed   uint32
    elemtype *_type         // element type
    sendx    uint           // send index
    recvx    uint           // receive index
    recvq    waitq          // list of recv waiters
    sendq    waitq          // list of send waiters
    lock     mutex
}
```

No `dir` field. The runtime sees only one kind of channel.

`runtime.chansend1`, `runtime.chanrecv1`, and `runtime.closechan` operate on `*hchan` directly. They do not check direction; they could not, because the value passed in is just a pointer.

This means: the *only* enforcement of direction is at compile time. The compiler refuses to generate a call to `chansend` when the source variable is `<-chan T`. The runtime cannot tell the difference.

### Implication for `unsafe`

If you cast `<-chan T` to `*hchan` and call `runtime.chansend1` directly via `linkname`, you can send on a "receive-only" channel at runtime. The compiler's check is gone; the runtime does not stop you. This is, of course, undefined-behaviour territory and a clear violation of the type system. Do not do it. But it shows the strict layering: direction is purely a static property.

---

## `reflect.ChanDir` and Reflective Channels

The `reflect` package mirrors the type system. Channel directions show up as:

```go
type ChanDir int

const (
    RecvDir ChanDir = 1 << iota
    SendDir
    BothDir = RecvDir | SendDir
)
```

Note that `reflect.ChanDir` is a bitfield (matching the AST), while `types.ChanDir` in `go/types` is an enum. They mean the same thing.

### `Type.ChanDir`

```go
t := reflect.TypeOf(make(chan int))           // chan int
fmt.Println(t.ChanDir())                      // chan -> BothDir
fmt.Println(t.ChanDir() == reflect.BothDir)   // true

var s chan<- int
ts := reflect.TypeOf(s)
fmt.Println(ts.ChanDir())                     // chan<- -> SendDir

var r <-chan int
tr := reflect.TypeOf(r)
fmt.Println(tr.ChanDir())                     // <-chan -> RecvDir
```

The `Type` value carries the direction. `Value.Recv()` works on `BothDir` and `RecvDir`; it panics on `SendDir`. `Value.Send()` works on `BothDir` and `SendDir`; it panics on `RecvDir`.

### Building directional types at runtime

```go
intType := reflect.TypeOf(0)
sendIntType := reflect.ChanOf(reflect.SendDir, intType)    // chan<- int

ch := reflect.MakeChan(reflect.ChanOf(reflect.BothDir, intType), 0)
ch.Send(reflect.ValueOf(42))
// Cannot do: reflect.MakeChan with SendDir/RecvDir would panic
```

`MakeChan` only accepts `BothDir`. This mirrors the rule that `make(chan T)` is the only way to create a channel — direction comes from assignment.

### Converting directionally via `reflect`

```go
biType := reflect.TypeOf(make(chan int))
sendType := reflect.ChanOf(reflect.SendDir, biType.Elem())
recvType := reflect.ChanOf(reflect.RecvDir, biType.Elem())

bi := reflect.MakeChan(biType, 0)
s := bi.Convert(sendType)           // OK
r := bi.Convert(recvType)           // OK

// Reverse?
s.Convert(biType)                   // panic: reflect.Value.Convert: type chan<- int cannot be converted to type chan int
```

`reflect.Value.Convert` follows the type-system rules. No back-conversion, no cross-conversion.

### `reflect.SelectCase` and direction

```go
case := reflect.SelectCase{
    Dir:  reflect.SelectRecv,
    Chan: someChanValue,
}
```

The `Dir` here is a different enum (`SelectRecv`, `SelectSend`, `SelectDefault`). It says what *operation* this select case performs. The `Chan` value's actual direction must be compatible: a `SelectSend` case requires a `BothDir` or `SendDir` channel; a `SelectRecv` case requires `BothDir` or `RecvDir`.

If you mismatch them (e.g., `SelectSend` on a `RecvDir` channel), `reflect.Select` panics at runtime.

---

## Codegen: What the Compiler Emits

For a send `ch <- v`, the compiler emits, after lowering:

```
CALL runtime.chansend1(SB)
```

Arguments: a `*hchan` (which is what `chan T` is at the runtime level — a pointer), the address of the value to send, and a flag indicating blocking.

For `<-ch`, it emits a call to `runtime.chanrecv1`. For `v, ok := <-ch`, it calls `runtime.chanrecv2`. For `close(ch)`, it calls `runtime.closechan`.

**Direction does not appear in the call.** A `chan<- int` and a `chan int`, when used in a send expression, both reduce to the same `runtime.chansend1` call. The directional type is purely for compile-time checking; once you reach SSA form and codegen, only the operations matter.

You can verify this with `-S`:

```bash
go build -gcflags="-S" prog.go 2>&1 | grep chansend
```

The output shows the same `runtime.chansend1` call regardless of whether the source had `chan int` or `chan<- int`.

### What about closing a send-only?

```go
var s chan<- int = make(chan int)
close(s)
```

Compiles. Codegen: `runtime.closechan(s)`. Same call as `close(chan int)`. The compiler does not emit a separate "close-send-only" instruction; there is no such thing.

### Direction in the ssa intermediate

In `cmd/compile/internal/ssa`, channels are just pointers. The SSA representation does not record direction. The type-checking is over by the time SSA construction begins.

---

## Type Descriptors and Direction

At runtime, every type has a `*_type` (`reflect.rtype` in the `reflect` package). For channel types, the descriptor includes:

```go
// src/runtime/type.go (sketch)
type chantype struct {
    typ      _type
    elem     *_type
    dir      uintptr      // 0=both, 1=send, 2=recv (matches reflect.ChanDir)
}
```

The `dir` field exists for `reflect.TypeOf(...).ChanDir()` to read. It is *not* used by `chansend`, `chanrecv`, or `closechan` — those operate on `*hchan`, not on the type descriptor.

When you write three different channel types in your source code, the compiler generates three distinct `chantype` descriptors. Each has the same `elem` but different `dir`. Type metadata size is small (~80 bytes per channel type), so no concern.

### Why the runtime keeps `dir` at all

For `reflect`. The `reflect` package needs to expose the direction to user code, so the metadata is needed. Without `reflect`, the runtime would not need to know.

---

## Direction with `unsafe` and `cgo`

### `unsafe.Pointer`

You can cast a `chan T` to `unsafe.Pointer` (it is internally a pointer to `hchan`). The cast strips all type information including direction. Casting back to a different direction is "allowed" by the unsafe rules but undefined behaviour by the spec:

```go
bi := make(chan int)
p := (unsafe.Pointer)(&bi)                  // address of the channel value
// ... reinterpret p as *chan<- int ...
```

The spec does not promise any of this works. The runtime does not check direction. Practically, the resulting `chan<- int` will function — but the spec does not guarantee it, and the compiler's check is bypassed.

Use only when you understand what the runtime does. In normal code, never.

### `cgo`

C does not have channel types. If you pass a Go channel through C (via `cgo`), you pass a pointer to `hchan`. The C side cannot do anything useful with it directly; you would call back into Go via `cgo.Handle` or similar.

Direction does not survive the round-trip into C. Back on the Go side, you cast to whatever channel type and proceed. Same caveats as `unsafe`.

---

## Generics: Type Parameters and Direction

Generics introduced in Go 1.18 interact cleanly with channel direction. The type parameter is the *element type*, not the *channel type*:

```go
func Pipe[T any](in <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for v := range in {
            out <- v
        }
    }()
    return out
}
```

`T` is whatever element type; the channel direction is concrete in the signature.

### Generalising over direction is not allowed

You cannot write a constraint that says "any direction of T." There is no syntax for it:

```go
// This is not legal Go
type AnyChan[T any] interface {
    chan T | chan<- T | <-chan T    // type set, but...
}
```

This syntax is permitted (Go's type-set constraint syntax accepts type lists), but it has limited utility. Inside a function with `C AnyChan[T]`, you cannot send or receive on a `C`, because the constraint set includes a type that forbids each direction. The compiler will not let you write `c <- v` because some C in the type set is `<-chan T`. So the constraint is effectively useless for channel operations.

You can use it for reflection: `reflect.TypeOf(c)` works on any direction. But you do not need generics for that.

### Generic pipelines

The patterns from senior level work directly:

```go
func Map[A, B any](in <-chan A, f func(A) B) <-chan B { ... }
func Filter[T any](in <-chan T, p func(T) bool) <-chan T { ... }
func Merge[T any](ins ...<-chan T) <-chan T { ... }
```

Each takes and returns receive-only channels. Direction is baked into the signatures; generics only abstracts the element type.

### Type inference

```go
ints := make(chan int)
strs := Map(ints, strconv.Itoa)
```

The compiler infers `A=int, B=string` from the call. The directional conversion (`chan int` to `<-chan int`) happens at the call site, same as for non-generic functions.

---

## Edge Cases the Compiler Has to Handle

### Empty struct elements

```go
done := make(chan struct{})
var r <-chan struct{} = done
```

Works. `struct{}` is the element type; direction wraps it normally.

### Element types that are themselves channels

```go
chan chan int
chan<- chan int
<-chan chan int
chan chan<- int
chan <-chan int
```

All legal. The element type can be a channel with any direction. The type identity check recurses.

### Element types that are interfaces

```go
type I interface{ M() }
var ch chan I = make(chan I)
var r <-chan I = ch
```

Works. The interface type is fine as a channel element type.

### Anonymous functions returning directional channels

```go
f := func() <-chan int {
    out := make(chan int)
    close(out)
    return out
}
```

Standard. The `chan int` inside widens to `<-chan int` on return.

### Direction in switch type cases

```go
switch x := i.(type) {
case chan int:
    // x is chan int
case <-chan int:
    // x is <-chan int
}
```

The cases must list the *exact* type. `chan int` does not satisfy a `<-chan int` case in a type switch — type switch compares dynamic types, and direction is part of identity.

### Channels in array and slice element positions

```go
var arr [3]chan int             // array of chan int
var arrR [3]<-chan int          // array of <-chan int
arrR = arr                       // compile error — array element types differ
```

The element type of an array or slice is exact. No implicit narrowing inside collections.

### Direction in map keys

```go
m := make(map[<-chan int]string)    // legal, but rare
m[someRecvOnlyChan] = "x"
```

Channels are comparable, so they can be map keys. Direction is part of the key type.

### Nil checks

```go
var ch chan<- int
if ch == nil { ... }                // legal, evaluates to true

var ch2 chan<- int = make(chan int)
if ch2 == nil { ... }               // false
```

Direction does not affect nil semantics.

### Comparing across directions

```go
var bi chan int = make(chan int)
var s chan<- int = bi
fmt.Println(bi == s)                // compile error: mismatched types
```

Cannot compare directly. Convert one to the other's type first (only possible to widen, so the comparison must happen at the narrower type or both at the same direction).

---

## Self-Assessment

- [ ] I can describe how the parser turns `<-chan T` into an AST node.
- [ ] I know that direction lives in `types.Chan.dir` (or `types2.Chan.dir`).
- [ ] I can explain why `chan T` to `chan<- T` is permitted but `chan<- T` to `chan T` is not, citing the assignability rule.
- [ ] I know the runtime `hchan` has no `dir` field.
- [ ] I can predict the output of `reflect.TypeOf(...).ChanDir()` for any channel type.
- [ ] I know that `reflect.MakeChan` only accepts `BothDir`.
- [ ] I understand that codegen for sends emits the same `chansend1` call regardless of source direction.
- [ ] I know what happens if you defeat direction with `unsafe` (it works but is UB).
- [ ] I understand how generics use type parameters for the element type, not the channel direction.
- [ ] I can read and explain a compiler error like "cannot use x (variable of type chan<- int) as <-chan int."

---

## Summary

At the implementation layer, direction is a compile-time tag on the type. The compiler stores it in the type representation, the type-checker compares it for identity, and the assignability rule allows a one-way widening. The AST node carries it; the type descriptor carries it; the runtime does not.

Codegen is direction-blind. The same `chansend1`/`chanrecv1` runtime functions handle every directional view. This is the strict layering: types are static, runtime is dynamic, and the bridge is the compile-time check.

`reflect` mirrors the type system: `ChanDir`, `ChanOf`, `MakeChan` all respect the same rules. You can build a `chan<- T` reflectively, but you cannot widen it back. Reflection is just a typed runtime API on top of the same metadata the compiler stored.

`unsafe` and `cgo` can defeat direction. The runtime has no enforcement. So *do not do that*: the entire safety value of directional types depends on not bypassing the type system.

This is the foundation that lets the upper levels — junior, middle, senior — promise that direction is a zero-cost, refactor-safe, design-time tool. The implementation is small and consistent. Cleanest part of the channel design, arguably.
