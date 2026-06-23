# Channel Direction — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Relevant Sections of the Go Spec](#relevant-sections-of-the-go-spec)
3. [Channel Types — Grammar and Semantics](#channel-types--grammar-and-semantics)
4. [Send Statements](#send-statements)
5. [Receive Operator](#receive-operator)
6. [Close](#close)
7. [Assignability](#assignability)
8. [Conversions](#conversions)
9. [Type Identity](#type-identity)
10. [Interaction with `select`](#interaction-with-select)
11. [Memory Model Implications](#memory-model-implications)
12. [`reflect` Specification](#reflect-specification)
13. [Compatibility Across Go Versions](#compatibility-across-go-versions)
14. [References](#references)

---

## Introduction

This file is a structured reading guide to the parts of the Go specification, runtime, and `reflect` package that define channel direction. Sections quote or paraphrase the spec and indicate the exact source. Use this as a quick reference when a question demands a citation, not a tutorial.

The Go specification lives at <https://go.dev/ref/spec>. Where this file paraphrases for clarity, it does so explicitly; otherwise excerpts are verbatim.

---

## Relevant Sections of the Go Spec

| Topic | Spec section | URL fragment |
|---|---|---|
| Channel types | Types > Channel types | `#Channel_types` |
| Make built-in | Built-in functions > Making slices, maps, and channels | `#Making_slices_maps_and_channels` |
| Send statements | Statements > Send statements | `#Send_statements` |
| Receive operator | Expressions > Receive operator | `#Receive_operator` |
| `close` built-in | Built-in functions > Close | `#Close` |
| Assignability | Properties of types > Assignability | `#Assignability` |
| Conversions | Expressions > Conversions | `#Conversions` |
| Type identity | Properties of types > Type identity | `#Type_identity` |
| `select` statement | Statements > Select statements | `#Select_statements` |
| Memory model | Memory model (separate document) | `https://go.dev/ref/mem` |

---

## Channel Types — Grammar and Semantics

From the spec (paraphrased):

```
ChannelType  = ( "chan" | "chan" "<-" | "<-" "chan" ) ElementType .
```

The three syntactic forms:

1. `chan T` — bidirectional.
2. `chan<- T` — send-only (the "arrow" goes into the channel).
3. `<-chan T` — receive-only (the "arrow" comes out of the channel).

Spec quote (verbatim):

> *"The optional `<-` operator specifies the channel direction, send or receive. If no direction is given, the channel is bidirectional. A channel may be constrained only to send or only to receive by assignment or explicit conversion."*

Two operational consequences:

- `make(chan T)` is bidirectional. There is no `make(chan<- T)` or `make(<-chan T)`.
- A directional channel is obtained by assignment or conversion from a bidirectional one (subject to the assignability rule below).

### Right-to-left associativity for nested types

> *"The `<-` operator associates with the leftmost `chan` possible."*

That clause disambiguates `chan <- chan int`. The leftmost `chan` consumes the `<-`, producing `chan<-` `chan int` (a send-only channel of bidirectional channels). The alternative parse `(chan) (<-chan int)` is rejected by the spec's associativity rule.

In practice, when nesting channel types, use parentheses for clarity:

```go
chan<- (chan int)
chan<- (<-chan int)
<-chan (chan<- int)
```

The parser does not require them, but readers thank you.

---

## Send Statements

Spec section: `#Send_statements`.

> *"A send statement sends a value on a channel. The channel expression's type must be a channel type, the channel direction must permit send operations, and the type of the value to be sent must be assignable to the channel's element type."*

Three required conditions for a legal send:

1. The expression is of channel type (or has a dynamic type that is a channel, in the case of interface values — though `select` cases need static channel types).
2. The channel direction permits sending: `chan T` or `chan<- T`. A `<-chan T` is rejected.
3. The value being sent is assignable to the element type `T`.

A send on a `<-chan T` is a *compile-time* error. The spec phrasing "channel direction must permit send operations" is the relevant constraint.

A send on a closed channel is a *runtime* panic. Direction does not affect this; a `chan<- T` can be closed and then sending on it panics just as on a closed bidirectional channel.

A send on a `nil` channel blocks forever. Direction does not change this; a `nil` `chan<- T` blocks the same.

---

## Receive Operator

Spec section: `#Receive_operator`.

> *"For an operand `ch` of channel type, the value of the receive operation `<-ch` is the value received from the channel `ch`. The channel direction must permit receive operations, and the type of the receive operation is the element type of the channel."*

Three required conditions:

1. The operand is a channel type.
2. The channel direction permits receiving: `chan T` or `<-chan T`. A `chan<- T` is rejected.
3. The result type is the element type `T`.

The two-value form `v, ok := <-ch` follows the same direction rules. The `ok` is `false` if and only if the channel is closed and the buffer is drained.

A receive on a `nil` channel blocks forever. Same as for sends.

A receive on a closed (drained) channel returns the element type's zero value and `ok=false`. Same regardless of direction.

---

## Close

Spec section: `#Close`.

> *"The built-in function `close` records that no more values will be sent on a channel. ... The argument must be a channel, and may not be a receive-only channel. Closing a `nil` channel or closing the channel a second time causes a run-time panic."*

Two rules of importance:

1. **Static rule.** The argument must be a channel type whose direction permits sending (or is bidirectional). `close(<-chan T)` is a compile error.
2. **Dynamic rules.** `close(nil-chan)` panics. Double-close panics. Send on closed panics.

The spec's reasoning: only the sender knows when no more values will arrive. The type system gives that authority to bidirectional and send-only references, not to receive-only ones.

A `chan<- T` *can* be closed even though it cannot receive. This is the asymmetry: closing is "no more sends," which is the sender's prerogative.

---

## Assignability

Spec section: `#Assignability`.

The relevant clause (verbatim, paraphrased for the channel rule):

> *"A value `x` of type `V` is assignable to a variable of type `T` ... if `V` and `T` are channel types with identical element types, `V` is a bidirectional channel, and at least one of `V` or `T` is not a named type."*

Three conditions for channel assignability across direction:

1. Source `V` and destination `T` are both channel types.
2. Their element types are *identical* (not "assignable" — strictly identical).
3. `V` is bidirectional.
4. At least one of `V`, `T` is unnamed.

The first three are intuitive. The fourth ("at least one unnamed") prevents weird cross-package directional widening of named types:

```go
package a
type SendCh chan<- int    // named, send-only

package b
import "a"
var bi chan int = make(chan int)
var s a.SendCh = bi       // bi is unnamed, so OK
```

In contrast, named-named-different is rejected:

```go
type Bi chan int
type S chan<- int
var b Bi
var s S = b               // compile error — both named, neither matches the rule
```

This rule is mostly academic; named channel types are rare in real code.

---

## Conversions

Spec section: `#Conversions`.

Channel conversions follow the assignability rule for channel types. The spec says:

> *"A non-constant value `x` can be converted to type `T` in any of these cases: ... `x`'s type and `T` are unnamed pointer types and their pointer base types have identical underlying types, ..."*

For channels, the conversion rule is the same as assignability — there is no separate "explicit but stronger conversion" path. You cannot use `(chan int)(sendOnly)` to widen back; the spec does not permit it.

The compiler error for an illegal channel conversion is the same as for an illegal assignment.

---

## Type Identity

Spec section: `#Type_identity`.

> *"Two channel types are identical if they have identical element types and the same direction."*

This is the rule the compiler uses to decide if two channel types are "the same." Both element type and direction must match. There is no relaxation for direction in identity — only in assignability.

Consequence: `chan int` and `chan<- int` are not identical types. They are also not assignable across the directional barrier (one way only, via the assignability rule). They are also not convertible (conversions defer to assignability for channels).

---

## Interaction with `select`

Spec section: `#Select_statements`.

Each case in a `select` is one of:

```
CommCase = SendStmt | RecvStmt | "default" .
```

The same send/receive rules apply to the cases as to standalone send statements and receive expressions:

- A send case `case ch <- v:` requires `ch` to be a channel that permits sends.
- A receive case `case x := <-ch:` requires `ch` to be a channel that permits receives.

Mismatches are compile-time errors. The spec is uniform here.

The `select` evaluation order is unrelated to direction. The runtime randomly picks a ready case. Direction does not influence selection.

---

## Memory Model Implications

The Go Memory Model (<https://go.dev/ref/mem>) defines happens-before relationships involving channels:

> *"The completion of a send on a channel is synchronized before the completion of the corresponding receive."*

> *"The closing of a channel is synchronized before a receive that returns because the channel is closed."*

> *"On an unbuffered channel, the completion of a receive is synchronized before the completion of the corresponding send."*

> *"On a buffered channel with capacity C, the kth send is synchronized before the (k+C)th receive."*

These rules talk about "sends" and "receives" without reference to direction. The directional type is invisible to the memory model — only the operation matters. A send on a `chan<- T` establishes the same happens-before as a send on a `chan T`.

This is consistent with the runtime view: directional types are erased before the memory model rules apply.

---

## `reflect` Specification

The `reflect` package documents:

```go
type ChanDir int

const (
    RecvDir ChanDir             // <-chan
    SendDir                     // chan<-
    BothDir = RecvDir | SendDir // chan
)

func (t Type) ChanDir() ChanDir         // panics if t is not a channel
func ChanOf(dir ChanDir, t Type) Type   // returns the channel type with the given direction
func MakeChan(typ Type, buffer int) Value  // typ.ChanDir() must be BothDir; otherwise panics
```

Methods on `reflect.Value` for channels:

- `Send(x Value)` — sends `x` on the channel. Panics if `Kind() != Chan` or `Type().ChanDir() == RecvDir`.
- `Recv() (Value, bool)` — receives. Panics if `Kind() != Chan` or `Type().ChanDir() == SendDir`.
- `Close()` — closes. Panics if `Type().ChanDir() == RecvDir`.
- `TrySend`, `TryRecv` — non-blocking variants. Same direction rules.

`reflect.Select` uses `SelectCase`:

```go
type SelectCase struct {
    Dir  SelectDir   // direction of case: SelectRecv, SelectSend, SelectDefault
    Chan Value       // channel
    Send Value       // value to send (only for SelectSend)
}
```

The case's `Dir` must be compatible with the channel's `Type().ChanDir()`. Mismatches panic at runtime (not compile time, because reflection is dynamic).

---

## Compatibility Across Go Versions

Channel direction has been in Go since Go 1.0 (March 2012). The semantics have not changed.

| Go version | Change |
|---|---|
| 1.0 | Channel types, send-only, receive-only introduced. |
| 1.5 | Internal: separate `chantype` descriptor in the runtime (no user-visible change). |
| 1.18 | Generics; channel direction interacts with type parameters as described in the professional file. |
| 1.21–1.22 | No relevant changes. |

The Go 1 Compatibility Promise (<https://go.dev/doc/go1compat>) covers channel direction. Any change would require a new major version of Go.

### `reflect.ChanDir` stability

The constants `reflect.RecvDir`, `reflect.SendDir`, `reflect.BothDir` are stable. Their numeric values (1, 2, 3 respectively) are documented and stable since Go 1.0.

---

## References

### Primary specification

- Go Programming Language Specification, *Channel types*: <https://go.dev/ref/spec#Channel_types>
- Go Programming Language Specification, *Send statements*: <https://go.dev/ref/spec#Send_statements>
- Go Programming Language Specification, *Receive operator*: <https://go.dev/ref/spec#Receive_operator>
- Go Programming Language Specification, *Close*: <https://go.dev/ref/spec#Close>
- Go Programming Language Specification, *Assignability*: <https://go.dev/ref/spec#Assignability>
- Go Programming Language Specification, *Conversions*: <https://go.dev/ref/spec#Conversions>
- Go Programming Language Specification, *Type identity*: <https://go.dev/ref/spec#Type_identity>
- Go Programming Language Specification, *Select statements*: <https://go.dev/ref/spec#Select_statements>

### Memory model

- The Go Memory Model: <https://go.dev/ref/mem>

### `reflect` package

- `reflect` package documentation: <https://pkg.go.dev/reflect>
- `reflect.ChanDir` type and constants: <https://pkg.go.dev/reflect#ChanDir>
- `reflect.Type.ChanDir` method: <https://pkg.go.dev/reflect#Type>
- `reflect.ChanOf` function: <https://pkg.go.dev/reflect#ChanOf>
- `reflect.MakeChan` function: <https://pkg.go.dev/reflect#MakeChan>

### Articles and talks

- Effective Go, *Channels*: <https://go.dev/doc/effective_go#channels>
- The Go Blog, *Pipelines and cancellation*: <https://go.dev/blog/pipelines>
- Rob Pike, *Go Concurrency Patterns*: <https://www.youtube.com/watch?v=f6kdp27TYZs>
- Sameer Ajmani, *Advanced Go Concurrency Patterns*: <https://www.youtube.com/watch?v=QDDwwePbDtw>

### Source code

- `src/runtime/chan.go` — runtime channel implementation (direction not present).
- `src/runtime/type.go` — type descriptors (`chantype` with `dir` field).
- `src/go/types/predicates.go` — type identity (`identical` for `*Chan`).
- `src/go/types/operand.go` — assignability rules (`assignableTo`).
- `src/reflect/type.go` — `ChanDir`, `ChanOf`, `MakeChan`.

### Compatibility

- Go 1 Compatibility Promise: <https://go.dev/doc/go1compat>
