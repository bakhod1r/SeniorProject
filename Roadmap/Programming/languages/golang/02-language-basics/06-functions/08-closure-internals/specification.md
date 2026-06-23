# Closure Internals — Specification

Author: Bakhodir Yashin Mansur

This file gathers the formal rules behind Go closures. Where the spec is silent, it cites the relevant runtime or compiler source. Each section ends with a primary URL so you can read the original.

---

## 1. The relevant spec sections

The Go language specification (https://go.dev/ref/spec) does not have a chapter titled "Closures". Closure behaviour is the combination of several rules:

- **Function literals** define the syntax of anonymous functions and state that they may capture variables. (https://go.dev/ref/spec#Function_literals)
- **Declarations and scope** define what "captured" means. (https://go.dev/ref/spec#Declarations_and_scope)
- **For statements** define loop variable scoping. (https://go.dev/ref/spec#For_statements)
- **Go statements** define how `go` interacts with the called function's arguments. (https://go.dev/ref/spec#Go_statements)
- **Defer statements** define how `defer` interacts with arguments and surrounding scope. (https://go.dev/ref/spec#Defer_statements)
- **Method values** and **method expressions** are two related forms that produce func-typed values. (https://go.dev/ref/spec#Method_values)

The runtime representation (`funcval`) and the calling convention (closure register, env struct) are not part of the spec. They are documented in compiler/runtime source: `runtime/runtime2.go`, `cmd/compile/internal/walk/closure.go`, and ABI design documents.

---

## 2. Function literals (spec quote)

> "A function literal represents an anonymous function. Function literals are closures: they may refer to variables defined in a surrounding function. Those variables are then shared between the surrounding function and the function literal, and they survive as long as they are accessible."

Two normative statements:

1. **"Shared"** — capture is by reference. The spec uses the word "shared" deliberately to forbid hidden copies.
2. **"Survive as long as they are accessible"** — the variable's lifetime is the union of all reachable references. The garbage collector, not the function frame, decides when it dies.

These two sentences are the entire formal basis for everything in this topic. Everything else is implementation detail of how the compiler realises them.

Reference: https://go.dev/ref/spec#Function_literals

---

## 3. Scope and the loop-variable rule (pre-1.22)

The original `for` rule:

> "Each ‘for' statement creates an implicit block; variables declared in the for clause and any range variables are scoped to that block."

Two distinct cases:

- `for i := 0; i < n; i++ { ... }` — `i` is declared in the for clause. One variable for the entire loop.
- `for i, v := range xs { ... }` — `i` and `v` are range variables. One variable each for the entire loop.

Combined with capture-by-reference, every closure created in the loop body captured **the same** `i`, `v`. After the loop ended, that variable held the loop's terminal value, and every captured closure observed it.

Reference (pre-1.22 spec text): https://go.dev/ref/spec#For_statements (historical)

---

## 4. Go 1.22 loop-variable change

Proposal #60078: "spec: less error-prone loop variable scoping".

> "In Go 1.22, each iteration of a ‘for' loop creates new variables, to avoid accidental sharing in closures."

Effect: variables declared in the `for` clause (`i := 0`) and range variables (`i, v := range xs`) are reset to fresh declarations on each iteration. Closures created in the loop body capture the iteration-specific instance.

The change is **per-module**, gated by the `go` directive in `go.mod`:

```
// go.mod
module example.com/x
go 1.22         // new semantics
```

```
module example.com/y
go 1.21         // old semantics, even when built with Go 1.22 toolchain
```

This is unusual: in Go, the `go` directive normally indicates the minimum toolchain version, not a language-semantics switch. Loop-variable scoping is one of the few cases where the directive controls runtime behaviour.

Detection: run `go build -gcflags='-d=loopvar=2' ./...` on Go 1.22+ to log every loop where the new scoping changes behaviour.

References:
- Proposal: https://github.com/golang/go/issues/60078
- Release notes: https://go.dev/doc/go1.22#language
- Background: https://go.dev/blog/loopvar-preview

---

## 5. Variable lifetime

Spec, "Declarations and scope":

> "A variable's lifetime is the period during which the variable is reachable from any point in the program."

For a captured variable, "reachable" includes:

- References from the enclosing function's still-live frame.
- References from any live closure that captured it.
- References from heap objects that transitively reach the closure (slices, maps, channels, other goroutines).

This is GC-style reachability, not stack-style scoping. A variable declared in `foo()` can outlive `foo`'s return if any closure captured it. The compiler's escape analysis is the implementation: variables flagged "escapes" are allocated on the heap so the GC can manage them.

Reference: https://go.dev/ref/spec#Declarations_and_scope

---

## 6. Method values

> "A method expression yields a function value that is callable as an ordinary function with an explicit receiver as its first argument; it has signature func(R, A) Y."
>
> "A method value is a function bound to a specific value, similar to a closure, with signature func(A) Y."

The spec is explicit: method values are closures. They have the same shape (funcval + env) and the same allocation behaviour. The env contains exactly one value: the receiver, of type `T` for `t.M` where `t : T`. For pointer-receiver methods, the captured value is `*T`.

Method **expressions** are not closures. They are top-level function values with an explicit receiver parameter. They allocate no env.

Reference: https://go.dev/ref/spec#Method_values

---

## 7. `go` statement and closure arguments

> "The function value and parameters are evaluated as usual in the calling goroutine, but unlike with a regular call, program execution does not wait for the invoked function to complete."

Two normative effects on closures:

1. **The function value and parameters are evaluated in the spawning goroutine.** If the entry is `go func(x int){...}(n)`, the value of `n` is read in the parent's frame and passed to the new goroutine. This is *not* capture — it's argument evaluation.
2. **The closure (if any) outlives the spawning frame.** The funcval and env must be allocated where the new goroutine can read them. In practice this means the heap.

The combination explains why `go f(currentValue)` is safe and `go func(){use(currentValue)}()` is risky: the first is argument evaluation (value copy); the second is capture (reference).

Reference: https://go.dev/ref/spec#Go_statements

---

## 8. `defer` statement and closure arguments

> "Each time a ‘defer' statement executes, the function value and parameters to the call are evaluated as usual and saved anew but the actual function is not invoked."

Same model as `go`:

- Parameters are snapshot at defer time.
- The function body runs at function exit and observes any captured (non-parameter) variables as they are at that moment.

Hence the idiom:

```go
defer func() { log.Printf("err=%v", err) }()    // sees final err
defer func(err error) { log.Printf("err=%v", err) }(err)   // sees err at defer time
```

The spec doesn't mention "closures" in the defer section, but the rule is consistent with capture-by-reference. The official examples in https://go.dev/ref/spec#Defer_statements include closures with captured loop variables, demonstrating the interaction.

Reference: https://go.dev/ref/spec#Defer_statements

---

## 9. Function types and identity

> "A function type denotes the set of all functions with the same parameter and result types. The value of an uninitialized variable of function type is nil."

The spec gives functions a type and a nil zero value. It does not specify:

- How `==` is defined on function values (in fact `==` is forbidden between two non-nil function values; only comparison to nil is allowed).
- Whether two closures with identical bodies are "the same" function value.

Hence:

```go
var f, g func() = func() {}, func() {}
f == g           // compile error: invalid operation
f == nil         // OK
```

The runtime *could* compare funcval pointers, but the language refuses to expose this. Reason: closure identity isn't a stable concept across optimisation levels (the compiler may share funcvals for non-capturing literals, or duplicate them).

Reference: https://go.dev/ref/spec#Comparison_operators

---

## 10. Closure types and generics

A function literal can use type parameters from the enclosing function (with constraints) but cannot introduce new type parameters of its own. Closures over generic functions instantiate to specific types at the call site:

```go
func MakeAdder[T constraints.Integer](base T) func(T) T {
    return func(x T) T { return base + x }
}

addInt := MakeAdder(5)        // instantiated with int
addInt(3)                     // 8
```

Internally, the compiler may produce a single shared instantiation (GCshape stenciling) for all integer types that share a "shape". The env struct is monomorphised per instantiation.

Reference: https://go.dev/ref/spec#Type_parameter_declarations and https://github.com/golang/proposal/blob/master/design/43651-type-parameters.md

---

## 11. The runtime representation

Not normative, but stable across versions:

```go
// runtime/runtime2.go
type funcval struct {
    fn uintptr
    // captured variables follow
}
```

The spec is silent on this. The ABI is documented in https://go.googlesource.com/proposal/+/refs/heads/master/design/27539-internal-abi.md.

Closure register (where the closure context pointer lives during a call):

| Arch | Register |
|------|----------|
| amd64 | `DX` |
| arm64 | `R26` |
| 386 | `DX` |
| riscv64 | `X29` |
| ppc64le | `R11` |

A closure body's prologue receives this pointer and uses it to access captured variables.

References:
- `runtime/runtime2.go`: https://github.com/golang/go/blob/master/src/runtime/runtime2.go
- Internal ABI: https://go.googlesource.com/proposal/+/refs/heads/master/design/27539-internal-abi.md

---

## 12. Reflection and dynamic closures

`reflect.MakeFunc` (https://pkg.go.dev/reflect#MakeFunc):

> "MakeFunc returns a new function of the given Type that wraps the function fn. When called, that new function does the following: ..."

The returned `reflect.Value` is callable as any function of that type. Internally it is a `*makeFuncImpl`, which has the funcval layout: first word is a code pointer (to an arch-specific assembly stub), followed by env (the wrapped Go `fn` and type info).

This makes `reflect.MakeFunc` the only spec-mentioned API that constructs closures dynamically. It is rarely used in application code; you see it in test frameworks and RPC stubs.

Reference: https://pkg.go.dev/reflect#MakeFunc

---

## 13. Compiler/runtime files at a glance

| File | What it specifies in practice |
|------|-------------------------------|
| `cmd/compile/internal/typecheck/func.go` | Identifies captured variables. |
| `cmd/compile/internal/escape/escape.go` | Decides heap vs. stack for funcval and env. |
| `cmd/compile/internal/walk/closure.go` | Builds env struct and lowers `OCLOSURE` IR. |
| `cmd/compile/internal/ssagen/ssa.go` | Generates closure-call lowering (indirect call + context). |
| `runtime/runtime2.go` | Declares `funcval`. |
| `runtime/proc.go` | Handles `go func()` startup — the new goroutine receives the funcval pointer. |
| `runtime/asm_*.s` | Per-arch assembly for closure prologues and `makeFuncStub`. |
| `reflect/makefunc.go` | Dynamic funcval construction. |

Each file links from the central Go source tree: https://github.com/golang/go/tree/master/src

---

## 14. Spec gaps and what the runtime fills in

| Question | Spec answer | Runtime answer |
|----------|------------|----------------|
| When does the env allocate? | Silent | Escape analysis decides; heap if escapes. |
| Are two closures equal? | Forbidden to compare | Funcval pointer equality, but not exposed. |
| What is a closure's size? | Silent | One machine word (pointer to funcval). |
| Can a closure outlive the enclosing function? | Yes ("survive as long as accessible") | Implemented via heap escape. |
| Are captured locals atomic? | No | No — user must synchronise. |
| Can a `defer` modify a named return? | Yes (named return is in scope) | Body captures by reference; compiler ensures assignment order. |
| Does `go` capture or copy? | Arguments are evaluated; body captures | Same. |

Knowing the gaps is part of being able to answer "is this guaranteed by the spec?" questions.

---

## 15. Comparison table — closures across languages (informative)

| Language | Capture mode | Lifetime mechanism |
|----------|--------------|--------------------|
| Go | By reference, always | GC + escape analysis |
| Rust | Choice: move, borrow, mutable-borrow | Compile-time lifetimes |
| Java (lambdas) | By value, only effectively-final variables | GC |
| Python | By reference | GC |
| C++ (lambdas) | Explicit capture list, by-value or by-reference | Caller-managed lifetime |
| JavaScript | By reference | GC |

Go's choice (by reference + GC) is closest to Python's and JavaScript's, which is why the loop-variable bug appeared in similar shape in those languages historically. Rust's compile-time model avoids the bug class entirely at the cost of more syntax.

---

## 16. Citing the spec in code reviews

When you reject a PR for a closure-related reason, link the exact rule:

- "Capture-by-reference: https://go.dev/ref/spec#Function_literals"
- "Per-iteration loop variable since Go 1.22: https://go.dev/doc/go1.22#language"
- "Method value vs. method expression: https://go.dev/ref/spec#Method_values"
- "Function values cannot be compared: https://go.dev/ref/spec#Comparison_operators"

This shifts the conversation from opinion to specification.

---

## 17. Summary

Go's closure semantics are spread across half a dozen short spec passages. The core normative rule is one sentence in "Function literals": captured variables are *shared* and live as long as accessible. Everything else — heap allocation, env struct layout, indirect calls, the loop-variable change in 1.22 — is implementation. The spec deliberately leaves the runtime free to choose representations as long as the observable semantics hold. Reading the spec passages directly is the fastest way to settle disputes about closure behaviour; reading the runtime source is the fastest way to settle disputes about performance.

---

## Further reading

- Go spec: https://go.dev/ref/spec
- Go 1.22 release notes: https://go.dev/doc/go1.22
- Loop variable proposal #60078: https://github.com/golang/go/issues/60078
- Internal ABI: https://go.googlesource.com/proposal/+/refs/heads/master/design/27539-internal-abi.md
- `runtime/runtime2.go`: https://github.com/golang/go/blob/master/src/runtime/runtime2.go
- `cmd/compile/internal/walk/closure.go`: https://github.com/golang/go/blob/master/src/cmd/compile/internal/walk/closure.go
- Sibling: [closures](../05-closures/), [defer-basics](../09-defer-basics/), [interface-internals](../../../03-methods-and-interfaces/10-interface-internals/)
