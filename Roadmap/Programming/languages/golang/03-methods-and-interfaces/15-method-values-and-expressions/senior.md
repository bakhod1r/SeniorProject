# Method Values and Method Expressions — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Closure Layout of a Method Value](#closure-layout-of-a-method-value)
3. [Method Expression as a Bare Code Pointer](#method-expression-as-a-bare-code-pointer)
4. [Escape Analysis](#escape-analysis)
5. [Goroutine Capture — A Subtle Bug Source](#goroutine-capture-a-subtle-bug-source)
6. [Method Values vs Interface Dispatch](#method-values-vs-interface-dispatch)
7. [Generics + Method Values](#generics-method-values)
8. [Reflect Equivalents](#reflect-equivalents)
9. [Plumbing — Method Tables and Hand-Rolled Dispatch](#plumbing-method-tables-and-hand-rolled-dispatch)
10. [Mutation Semantics Revisited](#mutation-semantics-revisited)
11. [Inlining and Devirtualization](#inlining-and-devirtualization)
12. [Comparison: C++ Pointer-to-Member, Java Method Reference](#comparison-c-pointer-to-member-java-method-reference)
13. [Decision Matrix](#decision-matrix)
14. [Summary](#summary)

---

## Introduction

The senior view of method values and expressions stops asking "what does this print?" and starts asking "where does this allocate, when is the receiver evaluated, and how does it interact with the rest of the runtime?". The two forms are simple syntactically but they reach into:

- Closure construction in the compiler frontend
- Escape analysis
- Goroutine scheduling and lifetime
- Interface itab and devirtualization
- Generics monomorphization
- Reflection

This file walks through each angle with the level of detail an architect needs for design and code review.

---

## Closure Layout of a Method Value

A method value compiles roughly to this pseudo-Go:

```go
// Source
fn := t.M

// Equivalent (rough)
fn := &methodValueClosure{
    receiver: t,                  // copy or pointer
    code:     <code address of M>,
}
// Calling fn(args...) does: dispatch(closure.code, closure.receiver, args...)
```

For value receivers, `closure.receiver` is a shallow copy of `t` at the moment of creation. For pointer receivers, it's the pointer.

### A concrete view in the runtime

The Go runtime closure layout (informally) is `(funcptr, captured...)`. A method value usually takes one heap slot for the closure header plus the receiver. You can see this with:

```bash
go build -gcflags='-m=2' main.go
```

Output snippet for a method value of pointer-receiver method:

```
./main.go:14:11: leaking param: s
./main.go:14:11: s.Handle escapes to heap
./main.go:14:11: &{...} escapes to heap
```

### Implication

A method value is, for all practical purposes, a closure capturing exactly one variable: the receiver. There is no other kind of capture happening. Knowing that, you can predict: any optimization that would apply to "single-variable closure" applies to method values.

---

## Method Expression as a Bare Code Pointer

A method expression, by contrast, produces a function whose type already contains the receiver as a parameter. The Go compiler typically synthesizes a tiny **wrapper function** that:

1. Receives the receiver as the first parameter.
2. Calls the actual method via direct call (or auto-`&` for pointer receivers).

This wrapper has a fixed code address. There's no per-call allocation, no closure header — it's just a function. Assigning it to a variable copies a single function pointer.

```go
type T struct{ n int }
func (t *T) M(x int) int { return t.n + x }

f := (*T).M    // assignment of a function pointer; no allocation
```

Compared with a closure-based equivalent, the method expression saves one allocation **and** one indirection (you call the wrapper directly, not through a closure header).

---

## Escape Analysis

Whether a method value escapes depends on how it's used:

```go
func staysOnStack() int {
    s := &Service{n: 1}
    f := s.Handle      // method value
    return f(42)       // call locally — both s and f may stay on stack
}

func escapes() func(int) int {
    s := &Service{n: 1}
    return s.Handle    // f outlives the function — both s and f escape
}
```

The compiler treats the method value's receiver capture as a closure capture, applying ordinary escape analysis rules. The receiver tags along with the closure: if the closure escapes, so does the receiver.

### Key knobs

- `go build -gcflags='-m'` — escape analysis output.
- `-gcflags='-m=2'` — more verbose.
- `go test -bench=. -benchmem` — counts allocations per op.

### Practical guidance

- **Pass directly** when you don't need the value to outlive the call.
- **Pre-bind once**, then call many times, when you do.
- **Use method expressions** in tight loops to avoid per-iteration closures.
- **Beware of registries**: storing method values in long-lived maps keeps every receiver alive — a cousin of memory leaks.

---

## Goroutine Capture — A Subtle Bug Source

```go
type Worker struct{ id int }
func (w *Worker) Run() { fmt.Println("running", w.id) }

func main() {
    workers := []*Worker{{1}, {2}, {3}}
    var wg sync.WaitGroup
    for _, w := range workers {
        wg.Add(1)
        go func() {
            defer wg.Done()
            w.Run()    // captures the loop variable w
        }()
    }
    wg.Wait()
}
```

### Pre-Go 1.22

`w` is a single variable reused across iterations. The goroutine captures `w` by reference (closure-style), so by the time goroutines run, `w` may already be the last element. Output: prints `3` three times.

### Go 1.22+

Per-iteration `w`. Each goroutine captures its own. Output: 1, 2, 3 (in some order).

### The method-value variant

```go
for _, w := range workers {
    cb := w.Run        // pre-Go 1.22: captures the same w; cb takes a copy of *Worker pointer at this moment
    go cb()
}
```

Here the situation flips. **`cb := w.Run`** evaluates `w` *now* and captures it. So even pre-1.22, each goroutine sees a different receiver — because the method value form snapshots `w` at creation time. This is a case where the method-value form is **safer** than the closure form.

### Rule of thumb

If you intend the goroutine to see the per-iteration value, prefer one of:
- Use Go 1.22+ semantics.
- Pre-bind a method value: `cb := obj.Method; go cb()`.
- Shadow the variable: `w := w; go func() { w.Run() }()`.
- Pass it as an argument: `go func(w *Worker) { w.Run() }(w)`.

---

## Method Values vs Interface Dispatch

Both are forms of indirect dispatch. They differ in *what* is held:

| Mechanism | Holds | Lookup cost |
|-----------|-------|------------|
| Method value | (receiver, code ptr) — concrete code | indirect call |
| Interface | (type+itab ptr, data ptr) — runtime resolves method | itab lookup + indirect call |
| Method expression | code ptr only | indirect call (caller passes receiver) |

So a method value is *cheaper* than interface dispatch (no itab lookup), but has the closure cost. A method expression is the cheapest of the three but the caller has to know the concrete type.

### Use case map

- Stable plug-in surface, many implementations: **interface**.
- One specific object's behavior, no polymorphism: **method value**.
- Many objects of one known type: **method expression** + table lookup.

---

## Generics + Method Values

Go 1.18 generics interact with method values in three places:

### 1. Generic type instantiation gives a concrete method type

```go
type Stack[T any] struct{ items []T }
func (s *Stack[T]) Push(x T) { s.items = append(s.items, x) }

s := &Stack[int]{}
push := s.Push           // type: func(int) — fully concrete
```

Once you instantiate `Stack[int]`, methods on it have non-generic signatures. The method value behaves exactly like in pre-generic Go.

### 2. Method expression on a generic type requires instantiation

```go
pushExpr := (*Stack[int]).Push   // OK
// pushExpr2 := (*Stack).Push     // ERROR — Stack alone is not a type
```

### 3. Methods cannot have their own type parameters

This is a deliberate language design decision. So you can never write `t.M[U]` to instantiate a method's type parameters. If you need that, lift to a top-level generic function:

```go
func Map[T, U any](s *Stack[T], f func(T) U) *Stack[U] {
    out := &Stack[U]{}
    for _, x := range s.items { out.Push(f(x)) }
    return out
}
```

You can then take `Map[int, string]` (with explicit args) as a function value — but it's a *function* value, not a method value.

---

## Reflect Equivalents

Reflection offers two cousins:

```go
import "reflect"

type T struct{ n int }
func (t T) M(x int) int { return t.n + x }

t := T{n: 10}

// reflect.Value.Method — the reflective method value
m := reflect.ValueOf(t).MethodByName("M")
// m.Kind() == reflect.Func
// m.Type() == func(int) int   — receiver bound, just like t.M

result := m.Call([]reflect.Value{reflect.ValueOf(5)})
fmt.Println(result[0].Int()) // 15
```

```go
// reflect.Type.Method — the reflective method expression
mt, _ := reflect.TypeOf(t).MethodByName("M")
// mt.Func.Type() == func(T, int) int  — receiver as first arg
// mt.Func can be Call()-ed, passing t as the first reflect.Value
result2 := mt.Func.Call([]reflect.Value{reflect.ValueOf(t), reflect.ValueOf(5)})
```

This mirror is exact:
- `reflect.Value.Method(i)` ↔ `t.M` — bound.
- `reflect.Type.Method(i).Func` ↔ `T.M` — unbound.

This is sometimes useful for plugin systems and serialization libraries that want to dispatch by name without writing a giant switch.

---

## Plumbing — Method Tables and Hand-Rolled Dispatch

For high-throughput systems where you can't afford interface dispatch, a manual method table is a powerful option:

```go
type Action func(*Engine, []byte) error

var actions = [256]Action{
    0x01: (*Engine).cmdConnect,
    0x02: (*Engine).cmdDisconnect,
    0x10: (*Engine).cmdRead,
    0x11: (*Engine).cmdWrite,
    // ...
}

func (e *Engine) Dispatch(op byte, payload []byte) error {
    if fn := actions[op]; fn != nil {
        return fn(e, payload)
    }
    return ErrUnknownOp
}
```

This pattern:
- Skips the `switch` overhead.
- Skips interface itab cost (no interface involved).
- Compiles to a single indirect call.
- Builds the dispatch table at init, not per request.

It's the same shape as a C function-pointer table, but using method expressions Go gives you static type checking — no `void*` casts needed.

---

## Mutation Semantics Revisited

This is the most error-prone area at the senior level.

```go
type T struct{ n int }
func (t T)  M_value()   int { return t.n }
func (t *T) M_pointer() int { return t.n }

t := T{n: 10}
fv := t.M_value    // captures a COPY of t
fp := t.M_pointer  // captures the pointer &t (Go takes &t automatically)

t.n = 99
fmt.Println(fv()) // 10  — copy was captured
fmt.Println(fp()) // 99  — pointer follows the original
```

### Implication for design

If you publish a callback registry, decide:
- Do callbacks need to see updates? **Pointer receivers** + method value.
- Do callbacks need to be a snapshot? **Value receivers** + method value.
- Mixed semantics in one type are confusing — be consistent.

### The trap of map-element method values

```go
m := map[string]T{"a": {n: 1}}
fn := m["a"].M_value
m["a"] = T{n: 99}
fmt.Println(fn()) // 1
```

Map elements are not addressable, but `m["a"]` returns a value. The method value captures that returned copy. Subsequent `m["a"] = ...` changes the map but not the captured copy.

For pointer-receiver methods this would be a compile error: `cannot take the address of m["a"]`.

---

## Inlining and Devirtualization

The compiler's go-to optimizations interact with our forms:

### Direct call → may inline
```go
t.M()    // candidate for inlining if M is small
```

### Method value → not inlined through the closure
```go
f := t.M
f()      // indirect call; no inlining of M
```

### Method expression → not inlined through the wrapper
```go
f := T.M
f(t)     // indirect call; no inlining of M either
```

### Interface call → may be devirtualized

When the compiler can prove the concrete type at the call site, it can replace an interface call with a direct call (and then maybe inline). Profile-guided optimization (PGO) in recent Go versions can do this for hot paths.

In practice: keep hot loops on direct calls. Method values and expressions are great for setup but lose inlining opportunities.

---

## Comparison: C++ Pointer-to-Member, Java Method Reference

### C++ pointer-to-member function

```cpp
class T {
public:
    int M(int x) const { return x; }
};

int (T::*pmf)(int) const = &T::M;   // pointer-to-member
T t;
int r = (t.*pmf)(5);                // bizarre call syntax
```

The C++ form is the closest analog to Go's `(*T).M` method expression — except C++ requires the `.*` or `->*` operators to call. Go just uses normal call syntax.

C++ also has `std::bind(&T::M, &t)` and `[&]() { t.M(); }` for method values. Both allocate (lambdas may not, depending on captures).

### Java method reference

```java
Supplier<String> bound   = obj::greet;   // bound — like Go's t.M
Function<Obj, String> unbound = Obj::greet;   // unbound — like Go's T.M
```

Java's syntax `obj::greet` vs `T::greet` is conceptually identical to Go's `t.M` vs `T.M`. The compile-time semantics are similar: bound captures the receiver, unbound takes it as the first argument.

Where Go differs: no autoboxing, no "captured this", and no functional-interface coercion magic. The Go form is more transparent.

---

## Decision Matrix

| Scenario | Form to use |
|----------|------------|
| Register callback for a specific service | `service.Method` (method value) |
| Build a `map[string]func(*T, ...)` dispatch | `(*T).Method` (method expression) |
| Pass to `sort.Slice` | method value |
| Pass to `http.HandleFunc` | method value |
| Goroutine entry point (Go 1.21 and earlier) | method value (snapshots receiver at creation) |
| Hot loop, no closure desired | direct call or method expression |
| Plugin system, runtime lookup | reflect or `map[string]MethodExpr` |
| Receiver must be re-supplied each call | method expression |
| Mutation must persist | pointer receiver + method value (or expression) |
| Snapshot semantics required | value receiver + method value |

---

## Summary

At the senior level the two forms become an architectural lever:

1. **Method value** = `(receiver, code)` closure. Pays one alloc, but binds the receiver — perfect for callbacks tied to a particular instance.
2. **Method expression** = a function pointer plus a wrapper. Zero closure cost, but the caller supplies the receiver — perfect for tables and plumbing.
3. **Generics + methods** is a tiny universe with a strict rule: methods inherit the receiver's type parameters and cannot add their own.
4. **Reflection** mirrors both forms exactly: `reflect.Value.Method` for bound, `reflect.Type.Method().Func` for unbound.
5. **Goroutines + method values** are usually safer than goroutines + closures because the method value snapshots the receiver, side-stepping the loop-variable issue (in older Go versions).
6. **Hot paths** prefer direct calls or method expressions; method values shine for one-off registrations.

In short: **method values bind, method expressions defer**. Choose by who owns the receiver at the moment of dispatch.
