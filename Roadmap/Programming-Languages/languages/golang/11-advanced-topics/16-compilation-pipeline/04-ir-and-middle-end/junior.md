# IR & Middle-End — Junior

## 1. What is an IR?

When you run `go build`, the compiler does not jump straight from your source code to machine instructions. In between it builds an **IR** — an *intermediate representation*. An IR is a data structure (usually a tree or a graph of nodes) that represents your program in a form that is easier for the compiler to analyze and transform than raw text.

Think of it like this:

```
source text  →  tokens  →  syntax tree (AST)  →  typed IR  →  optimizations  →  SSA  →  machine code
```

The IR sits in the middle. After the front-end has parsed your code and checked its types, the program is turned into IR. Then a series of **machine-independent** passes — the *middle-end* — clean it up and optimize it before the back-end turns it into assembly.

In the Go compiler (the `gc` compiler, which lives in `cmd/compile`), the IR node types live in the package `cmd/compile/internal/ir`. Every expression and statement becomes an `ir.Node`. A function is an `ir.Func`, a variable is an `ir.Name`, a function call is an `ir.CallExpr`, and an addition `a + b` is a node with the operation `ir.OADD`.

---

## 2. Why compilers use an IR

A few concrete reasons:

- **Uniformity.** `a + b`, `x * y`, and `p && q` all become nodes with an `Op` field. A pass can walk the tree without caring about source syntax.
- **Analysis.** Questions like "does this pointer escape the function?" or "is this function small enough to inline?" are answered by walking the IR.
- **Transformation.** The compiler rewrites high-level constructs (a `range` loop, a `map` access, an `append`) into simpler operations and runtime calls. This is called **desugaring**.
- **Reuse.** One IR can be lowered to many CPU architectures. The middle-end optimizations are written once and benefit every target.

You rarely touch the IR directly as an application programmer. But you can *observe its decisions*, and that is where it gets useful.

---

## 3. Seeing escape analysis with `-gcflags=-m`

**Escape analysis** is a middle-end pass (`cmd/compile/internal/escape`) that decides whether a value can live on the **stack** (cheap, freed automatically when the function returns) or must go on the **heap** (managed by the garbage collector). The `-m` flag prints those decisions.

The flag is passed *through* `go build` using `-gcflags`:

```bash
go build -gcflags=-m ./...
```

Note: it is `-gcflags=-m`, **not** `go build -m`. The `-m` is a flag for the compiler `gc`, and `-gcflags` forwards it.

Try this program:

```go
package main

func stays() int {
    x := 42 // lives on the stack
    return x
}

func leaks() *int {
    y := 42 // escapes: we return its address
    return &y
}

func main() {
    _ = stays()
    _ = leaks()
}
```

```bash
$ go build -gcflags=-m ./main.go
./main.go:9:2: moved to heap: y
```

The compiler tells you `y` "moved to heap" because you returned a pointer to it. `x` is silent — it stayed on the stack. Stack allocation is free; heap allocation costs a GC-tracked allocation. Fewer heap allocations usually means a faster program.

---

## 4. Seeing inlining decisions

**Inlining** copies the body of a small function into its caller, removing the call overhead and opening up further optimization. The same `-m` flag prints inlining decisions:

```go
package main

func add(a, b int) int { return a + b } // tiny → inlinable

func main() {
    _ = add(1, 2)
}
```

```bash
$ go build -gcflags=-m ./main.go
./main.go:3:6: can inline add
./main.go:6:11: inlining call to add
```

`can inline add` means the function is small enough. `inlining call to add` means a specific call site got the body pasted in. Inlining is handled by `cmd/compile/internal/inline`.

---

## 5. Desugaring: a `range` loop before and after

The middle-end pass **`walk`** (`cmd/compile/internal/walk`) rewrites convenient Go syntax into simpler operations. You write this:

```go
for i, v := range s {
    use(i, v)
}
```

Conceptually, `walk` turns a slice `range` into an ordinary counted loop, roughly:

```go
for i_ := 0; i_ < len(s); i_++ {
    v := s[i_]
    use(i_, v)
}
```

Map ranges, channel ranges, `append`, type switches, and many other constructs are similarly lowered — often into calls to functions in the `runtime` package (for example a map iteration becomes calls to `runtime.mapiterinit` / `runtime.mapiternext`). You did not write those calls; `walk` inserted them. This is why a single line of Go can become a surprising amount of machine code.

---

## 6. Common misconceptions

| Misconception | Reality |
|---|---|
| "`new` always heap-allocates, `:=` always stack-allocates." | Allocation site is decided by escape analysis, not by the keyword. `new(T)` can stay on the stack; a `:=` value can escape. |
| "`-m` is a flag for `go`." | It is a flag for the compiler. Use `-gcflags=-m`. |
| "Inlining always makes code faster." | Usually, but over-inlining bloats the binary and can hurt instruction cache. The compiler uses a budget. |
| "Escape analysis is the garbage collector." | No. Escape analysis runs at *compile time* and decides *where* values live. The GC runs at *runtime*. |
| "The IR is just the AST." | The typed IR is built from the syntax tree but is a distinct, lower-level structure that gets progressively desugared. |

---

## 7. Things to do today

1. Write the `stays`/`leaks` example above and run `go build -gcflags=-m`. Watch which variable moves to the heap.
2. Add a function that returns a pointer to a local struct. Confirm it escapes.
3. Write a one-line `add` function and confirm `can inline add`.
4. Add `//go:noinline` on the line above `add` and re-run — the inline message disappears.
5. Run `go build -gcflags=-m ./...` on a small real project and skim the output. Notice how much escapes.

---

## 8. Summary

- An **IR** is the compiler's internal program representation; Go's lives in `cmd/compile/internal/ir`, where every node has an `Op` such as `ir.OADD`.
- The **middle-end** is the set of machine-independent passes between type-checking and SSA: inlining, escape analysis, and `walk` (desugaring), among others.
- **`go build -gcflags=-m`** shows escape and inline decisions — your main window into these passes.
- **Escape analysis** decides stack vs heap; staying on the stack avoids GC pressure.
- **`walk`** desugars `range`, `map`, `append`, and friends into simpler ops and runtime calls.

---

## Further reading

- Go source: [`cmd/compile/internal/ir`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/ir)
- Go source: [`cmd/compile/internal/escape`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/escape)
- [`cmd/compile` README](https://github.com/golang/go/blob/master/src/cmd/compile/README.md) — overview of the compiler phases
- [Go FAQ: Why are my variables allocated on the heap?](https://go.dev/doc/faq#stack_or_heap)
- `go doc cmd/compile` and `go tool compile -help` for the flag list
