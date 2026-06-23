# Closure Internals — Senior

Author: Bakhodir Yashin Mansur

This file walks the compiler and runtime code that implements Go closures. You should be comfortable reading `cmd/compile` source and runtime SSA before reading it; otherwise [middle.md](middle.md) is the right place. Paths cited are relative to `https://github.com/golang/go/blob/master/src/`.

---

## 1. Source map

The closure pipeline touches several compiler packages:

| File | Role |
|------|------|
| `cmd/compile/internal/ir/func.go` | Defines `ir.Func`, the IR node for any function, including closures. |
| `cmd/compile/internal/ir/name.go` | `ir.Name` with `OnHeap` flag flipped by escape analysis. |
| `cmd/compile/internal/typecheck/func.go` | Resolves which identifiers in a closure are captured. |
| `cmd/compile/internal/escape/escape.go` | Decides which captures must go to the heap. |
| `cmd/compile/internal/walk/closure.go` | Builds the env struct and emits the `OCLOSURE` lowering. |
| `cmd/compile/internal/ssagen/ssa.go` | Lowers the closure call into an indirect call through the funcval. |
| `runtime/runtime2.go` | Defines `funcval` (one field: `fn uintptr`). |
| `runtime/proc.go` | Goroutine startup reads `fn` from `funcval`. |
| `reflect/makefunc.go` | Builds funcvals dynamically for `reflect.MakeFunc`. |

`runtime/funcdata.go` and `cmd/link/internal/ld/` participate too — the linker emits the static funcval symbols for closures that capture nothing.

---

## 2. The funcval type

```go
// runtime/runtime2.go
type funcval struct {
    fn uintptr
    // Variable-size environment follows.
}
```

Only one field declared. The closure environment (captured variables) follows in memory, accessed through compiler-generated offsets. From the runtime's point of view, a closure value is just a `*funcval`. The compiler is responsible for knowing the layout of what comes after `fn`.

A bare `func()` variable is one word (machine pointer to funcval). The pointed-at funcval is two words *if there are no captures* (`fn` plus padding/nothing) or more if captures exist. For a closure capturing nothing, the entire funcval lives in `.rodata` — a single global per closure literal — and `fn` points at the body.

You can list them in a binary:

```bash
go tool nm ./bin | grep '·f$'
```

The trailing `·f` (a U+00B7 middle dot) marks function-pointer symbols emitted by the compiler.

---

## 3. The `OCLOSURE` IR node

`ir.OCLOSURE` represents a function literal in the IR. Its key fields:

```go
type ClosureExpr struct {
    miniExpr
    Func *Func
}

type Func struct {
    Body Nodes
    ClosureVars []*Name   // free variables captured
    OClosure *ClosureExpr // back-pointer to the OCLOSURE that created this Func
    // ...
}
```

`ClosureVars` is built during typecheck. Each `*Name` in it is annotated with three pieces of information:

- The original outer-scope `*Name` it refers to (`n.Defn`).
- Whether the closure mutates it (`n.Byval()` returns the opposite).
- Whether it must be heap-allocated (set by escape analysis).

`OClosure` is the back-pointer used by `walk/closure.go` to know which env struct to build for each function body.

---

## 4. Resolving captures: `typecheck/func.go`

In `(*tcCloseFunc)`:

```go
// Pseudocode of typecheck flow
func tcClosure(clo *ir.ClosureExpr) {
    fn := clo.Func
    for _, ln := range fn.ClosureVars {
        outer := ln.Defn
        if mutated(ln) {
            outer.SetAddrtaken(true) // forces heap if also escapes
            ln.SetByval(false)
        } else {
            // optimisation candidate: copy by value
            ln.SetByval(true)
        }
    }
}
```

"Mutated" includes assignment, taking the address, or passing to a function that escapes the address. The flag `Addrtaken` later interacts with escape analysis: any variable whose address is taken AND which escapes its frame ends up `OnHeap`.

A captured variable's compile-time type is unchanged; only its storage class moves.

---

## 5. Escape analysis on closures

`escape.go` models a closure's body as a separate subgraph of its caller. The analysis answers two questions:

1. Does the funcval escape?
2. For each captured variable, does its reference inside the closure cause the variable to escape?

### Funcval escape

A funcval escapes when the closure literal is:

- Returned from the enclosing function.
- Stored in a heap object.
- Passed to a parameter marked "escapes" (`go func`, channel send, `reflect`, interface conversion, etc.).
- Started as a goroutine.

If none of these apply, the funcval stays on the stack. `walk/closure.go` will emit it as a stack-allocated 2-word value.

### Captured-variable escape

Capture-by-reference combined with funcval-escapes means the variable escapes too. Logic in `escape.go`:

```go
// pseudocode
if closureEscapes {
    for _, cv := range fn.ClosureVars {
        if !cv.Byval() {
            cv.Defn.SetEsc(EscHeap)
        }
    }
}
```

Even byval-captured variables are followed: if their *value* contains pointers that the closure might cause to escape, escape analysis propagates that information into the outer scope.

You can dump the decisions:

```bash
go build -gcflags='-m=2 -d=escapehash=1' ./...
```

`escapehash=1` prints a hash per source location so you can correlate later runs.

---

## 6. Building the env struct: `walk/closure.go`

The relevant entry point is `walkClosure`:

```go
// cmd/compile/internal/walk/closure.go (simplified)
func walkClosure(clo *ir.ClosureExpr, init *ir.Nodes) ir.Node {
    fn := clo.Func

    // 1. Build the closure-struct type.
    fields := make([]*types.Field, 0, len(fn.ClosureVars))
    for _, cv := range fn.ClosureVars {
        typ := cv.Type()
        if !cv.Byval() {
            typ = types.NewPtr(typ)
        }
        fields = append(fields, types.NewField(cv.Pos(), cv.Sym(), typ))
    }
    cstruct := types.NewStruct(fields)

    // 2. Allocate it. On heap if escapes, on stack otherwise.
    var cstructPtr ir.Node
    if clo.Esc() == ir.EscHeap {
        cstructPtr = ir.NewCallExpr(base.Pos, ir.ONEW, ir.TypeNode(cstruct), nil)
    } else {
        cstructPtr = stackTemp(cstruct)
    }

    // 3. Fill fields.
    init.Append(initialiseFields(cstructPtr, fn.ClosureVars))

    // 4. Combine code pointer + env into a funcval.
    return wrapAsFuncval(fn.Nname, cstructPtr)
}
```

Key observations:

- **Field order matches `ClosureVars` order**, which is the order the closure body references them. This is what later lets the body access them by offset.
- **Byval fields are stored directly**; byref fields are stored as pointers. The compiler emits an `&x` for byref captures so the closure body can dereference and read the *current* value of `x`.
- **Stack allocation** uses `stackTemp`, which carves space out of the caller's frame. The funcval is then a 2-word region inside the frame.

For a closure capturing nothing, `walkClosure` short-circuits to a precomputed static funcval symbol — no allocation, no field-copy.

---

## 7. Lowering closure calls

Once an env struct exists, the IR turns `c()` (where `c` is `func()`) into roughly:

```
fn := *(*uintptr)(c)        // load code pointer
fn(c, ...args)              // indirect call, c serves as receiver
```

The closure body's prologue is generated by `ssagen/ssa.go` to access captured variables via offsets from the receiver (`c` in pseudocode). For a body that needs the captured `x`:

```
arg0 := c                   // funcval pointer
x := *(arg0 + 8)            // skip fn word, dereference env field 0
```

This is similar to a method call, except the receiver is the funcval rather than a value of a declared type. The same calling convention applies: the closure's first hidden parameter (called "closure" in compiler talk) is the funcval pointer.

### Indirect call cost

An indirect call through a funcval costs:

- One load of the code pointer (~3–5 ns including branch mispredict in cold paths).
- One indirect branch (CPU prediction usually masks this for repeated calls).
- One extra register live across the call (the closure pointer).

Direct calls are typically 1–2 ns cheaper. Inlinable callees become 5–10 ns cheaper if the call were direct, because inlining wins back the prologue/epilogue.

The compiler cannot inline through a closure indirection. Loop-bodies that call a closure thousands of times pay this every iteration.

---

## 8. The Go ABI and closure calls

Since Go 1.17 the regabi (register-based ABI) passes arguments in registers when possible. Closures complicate this: the "closure context" (funcval pointer) is itself a register-passed value. On amd64 it lives in `DX` (the "closure register"). On arm64 it's `R26`.

This is why you sometimes see `MOVQ DX, X` in disassembly of closure bodies: the body squirrels the funcval pointer away before doing other register juggling. The body uses `DX` for its env-access prologue and then frees it.

If a closure is created and called within a single function with no escapes, the compiler may keep the funcval pointer in a callee-saved register and elide the env-struct allocation entirely — fully scalarising the captured variables. This optimisation is fragile; small changes to the closure can disable it. Measure, don't assume.

---

## 9. `reflect.MakeFunc` and dynamic funcvals

`reflect.MakeFunc(typ, fn)` constructs a closure at runtime. The signature comes from `typ`; the body is the Go function `fn`. Under the hood (`reflect/makefunc.go`):

```go
type makeFuncImpl struct {
    code   uintptr        // pointer to runtime/asm_<arch>.s adapter
    stack  *bitVector
    argLen uintptr
    ftyp   *funcType
    fn     func([]Value) []Value
}
```

`code` points at architecture-specific assembly (`runtime.makeFuncStub`) that:

1. Reads the funcval's `fn` field.
2. Builds a `[]reflect.Value` from the call's arguments using `argLen` and `stack`.
3. Invokes the user-supplied `fn`.
4. Writes the returned `[]reflect.Value` back into the caller's result slots.

The interesting point: a `reflect.MakeFunc` result IS a funcval. The compiler doesn't know about it; the runtime fabricates it. This is the same shape as a compiler-generated closure — the unification of "closure" and "function pointer" runs all the way down to the ABI.

---

## 10. Calling-convention edge cases

### Recursive closures and the captured-variable trick

The pattern from middle.md:

```go
var f func(int) int
f = func(n int) int { ... f(n-1) ... }
```

The IR for the inner body captures `f` (the variable) by reference. The env struct is `{ f *func(int)int }`. At call time, the body loads `f` from the env, then loads the funcval pointer from `*f`, then makes the indirect call. Two loads vs. one — that's the cost of recursion via variable capture.

### Closures used as goroutine entry points

`go f()` becomes `runtime.newproc(fn, args)`. The runtime copies `args` onto the new goroutine's stack and starts it. For `go func(){...}()` with captures, the funcval is in `DX` and `runtime.newproc` is told the size of arguments (zero) plus the closure pointer. The new goroutine starts at `runtime.goexit`'s neighbour, which sets up the frame and invokes the funcval.

This is why `go func(){...}()` always allocates the funcval on the heap: it must outlive the parent frame, and the new goroutine must be able to read the env via `DX`.

---

## 11. Linker treatment of static funcvals

For a closure that captures nothing, the linker emits a single rodata symbol:

```
go:.f.main.func1·f
```

The symbol is the address of a 1-word funcval (just `fn`). All references to that closure value share it.

For closures with captures, no static symbol exists for the funcval — it's heap- or stack-allocated. But the linker still emits a single symbol for the body function: `main.func1` (no `·f` suffix). The body is referenced indirectly through the funcvals built at runtime.

Listing closure bodies:

```bash
go tool nm ./bin | awk '$3 ~ /\.func[0-9]+$/ {print}'
```

---

## 12. Debugging closures with `delve`

```bash
dlv debug ./cmd/myprog
(dlv) break main.go:42
(dlv) print f
*main.someFn = (*main.someFn)(0x4501c0)
(dlv) print *(*[2]uintptr)(0x4501c0)
[2]uintptr [0x42a5e0, 0x4525a0]
```

The first word is the code pointer (look it up with `funclist`); the second is the env. `print *(*envType)(env)` if you know the env's struct layout — usually you don't, but you can read the disassembly of the closure body to recover offsets.

For one-off inspection, `runtime.FuncForPC(*(*uintptr)(unsafe.Pointer(&f))).Name()` prints the body's symbol. This works even in production-built binaries (no DWARF needed).

---

## 13. Version-by-version changes

| Version | Closure-relevant change |
|---------|-------------------------|
| 1.0 | Closures introduced as part of base spec; env is heap. |
| 1.1 | `defer` and `go` of closure literals optimised. |
| 1.7 | SSA backend; many closure call paths replaced with direct loads. |
| 1.13 | Escape analysis upgrades reduce funcval-on-heap rate. |
| 1.14 | Open-coded defers — `defer` of a closure no longer allocates a `_defer` record in the common case. |
| 1.17 | Register-based ABI; closure pointer moves to `DX` (amd64). |
| 1.18 | Generics; type-parameterised funcvals (instantiated like normal funcvals). |
| 1.22 | Per-iteration loop variable scope; closure capture in loops becomes safe. |
| 1.23 | More devirtualisation of method-value closures. |

---

## 14. Reading checklist

If you want to internalise this material, read these in order:

1. `runtime/runtime2.go` — find `funcval` and read the comment.
2. `cmd/compile/internal/ir/func.go` — read `Func` and `ClosureExpr`.
3. `cmd/compile/internal/walk/closure.go` — trace `walkClosure` end-to-end.
4. `cmd/compile/internal/ssagen/ssa.go` — search for `OCLOSURE` and `closurecontext`.
5. `runtime/asm_amd64.s` — search for `makeFuncStub` to see how `reflect` invokes funcvals.

After that you'll be able to reason about any closure cost question by reading source.

---

## 15. Summary

A senior view of Go closures connects three layers. The compiler synthesises an env struct in `walk/closure.go` and lowers closure calls to indirect calls through a funcval in `ssagen/ssa.go`. The runtime knows nothing about closure semantics — it only sees `funcval{fn uintptr}` with whatever bytes follow. The escape analyser decides whether the funcval and env live on the stack or the heap. Method values, `defer` closures, goroutine entry points, and `reflect.MakeFunc` all converge on the same funcval shape. Once you can read the relevant compiler and runtime source, the cost of any specific closure becomes calculable rather than guessable. [professional.md](professional.md) takes this knowledge into real codebases.

---

## Further reading

- `cmd/compile/internal/walk/closure.go`: https://github.com/golang/go/blob/master/src/cmd/compile/internal/walk/closure.go
- `cmd/compile/internal/escape/escape.go`: https://github.com/golang/go/blob/master/src/cmd/compile/internal/escape/escape.go
- `cmd/compile/internal/ssagen/ssa.go`: https://github.com/golang/go/blob/master/src/cmd/compile/internal/ssagen/ssa.go
- `runtime/runtime2.go` (funcval): https://github.com/golang/go/blob/master/src/runtime/runtime2.go
- `reflect/makefunc.go`: https://github.com/golang/go/blob/master/src/reflect/makefunc.go
- Go internal ABI design: https://go.googlesource.com/proposal/+/refs/heads/master/design/27539-internal-abi.md
- Open-coded defers proposal: https://go.googlesource.com/proposal/+/refs/heads/master/design/34481-opencoded-defers.md
- Sibling: [interface-internals](../../../03-methods-and-interfaces/10-interface-internals/), [escape-analysis](../../../11-advanced-topics/02-escape-analysis/)
