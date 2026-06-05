# IR & Middle-End — Middle

## 1. Reading `-m` output in depth

`-gcflags=-m` is the single most useful diagnostic for understanding the middle-end. A few practical rules for invoking it:

```bash
# Whole module, both inline and escape decisions
go build -gcflags=-m ./...

# Pin it to one package and add level 2 for much more detail
go build -gcflags='-m=2' ./internal/parser

# Apply -m only to ONE package, not its dependencies
go build -gcflags='example.com/pkg=-m' ./...
```

That last form — `importpath=flags` — matters: a bare `-gcflags=-m` applies to every package being compiled, including any non-cached dependencies, which floods the output. Scoping it keeps the noise down.

The messages fall into a few families:

| Message | Meaning |
|---|---|
| `can inline f` | `f` is under the inline cost budget; eligible to be inlined at call sites. |
| `cannot inline f: <reason>` | `f` is too big or contains a non-inlinable construct. |
| `inlining call to f` | A specific call site got `f`'s body pasted in. |
| `moved to heap: x` | `x` had to be heap-allocated. |
| `escapes to heap` | An expression's result escapes the function. |
| `x does not escape` | Allocation stayed on the stack (only shown at `-m=2` for many cases). |
| `leaking param: p` | Parameter `p` (or what it points to) outlives the call — it flows to a result or a heap location. |
| `parameter p leaks to result ~r0` | Precise leak: `p` flows to the function's return value. |

A clean read habit: pipe through `grep` for the symbol you care about.

```bash
go build -gcflags=-m ./... 2>&1 | grep 'moved to heap'
```

`-m` output goes to **stderr**, hence the `2>&1`.

---

## 2. What inlines and what does not — the cost budget

The inliner (`cmd/compile/internal/inline`) assigns each function a **cost** by walking its body and summing per-node costs. A function whose cost is at or below the budget (the threshold, historically `80`, exposed as `inlineMaxBudget`) can be inlined. You can watch the accounting:

```bash
go build -gcflags='-m=2' ./pkg 2>&1 | grep -i 'cost\|inline'
```

Cheap things (arithmetic, field access, simple control flow) cost little. Some constructs are flatly **non-inlinable** and stop a function from ever being inlined, or raise its cost past the budget:

| Construct | Effect on inlining |
|---|---|
| `defer` (historically), `recover` | Blocks or heavily penalizes inlining. |
| `select` | Non-inlinable. |
| `go` statement / closures with captures | Raises cost; may block. |
| range-over-func / labeled loops in some forms | Can block. |
| Large bodies, big `switch`, many calls | Cost exceeds budget. |
| `//go:noinline` directive | Hard "never inline this". |
| Functions calling `runtime` panic helpers a lot | Higher cost. |

Two refinements matter in modern Go:

- **Mid-stack inlining** (since Go 1.9): a function that itself *calls other functions* can still be inlined, instead of only leaf functions. This makes small wrapper/forwarding functions essentially free.
- **PGO inlining** (since Go 1.20, stable 1.21): with a profile, hot call sites get a larger budget, so functions that are normally too big to inline get inlined on the hot path.

---

## 3. Escape analysis rules you can predict

Escape analysis (`cmd/compile/internal/escape`) builds a graph of how pointers flow and asks: does any value's lifetime exceed its stack frame? If yes, it heap-allocates. You do not have to read the graph; you can learn the common rules.

**Returning a pointer to a local → escapes.**

```go
func make1() *T {
    var t T
    return &t // moved to heap: t
}
```

**Storing into something that outlives the call → escapes.**

```go
var global *int
func keep(x int) {
    global = &x // x escapes: assigned to global
}
```

**Interface boxing → usually escapes.** Putting a concrete value into an `interface{}` (or `any`, or `error`) generally forces a heap allocation, because the interface stores a pointer to the data and the analyzer often cannot prove the boxed value's lifetime:

```go
func log(v any) { /* ... */ }
func main() {
    x := 42
    log(x) // x escapes to heap (boxed into 'any')
}
```

This is why `fmt.Println(x)` allocates: `x` is boxed into `...interface{}`. The classic micro-optimization of avoiding `fmt` in hot loops is rooted here.

**Closures that capture by reference → captured vars may escape.** If a closure outlives the enclosing function (e.g., it is returned or stored), the variables it captures move to the heap:

```go
func counter() func() int {
    n := 0          // moved to heap: closure outlives counter()
    return func() int { n++; return n }
}
```

**Slices that grow beyond a provable bound → escape.** If `append` may reallocate to a size the compiler cannot bound, or the slice is returned/stored, the backing array escapes. A slice with a compile-time-known small size used locally can stay on the stack.

**"Leaking param" ≠ "escapes".** `leaking param: p` means the *argument* the caller passes may outlive the call (because `p` flows to a result or a heap field). Whether that causes an allocation is decided at the *caller*. Reading both sides of the `-m` output tells the full story.

---

## 4. How `walk` desugars common constructs

`walk` (`cmd/compile/internal/walk`) runs late in the middle-end and lowers high-level IR into a near-runtime form. Knowing the rewrites explains a lot of "where did that allocation come from" mysteries.

| You write | `walk` roughly produces |
|---|---|
| `for i, v := range slice` | counted index loop reading `s[i]` |
| `for k, v := range m` | `runtime.mapiterinit` + loop on `runtime.mapiternext` |
| `for v := range ch` | loop calling `runtime.chanrecv2` |
| `m[k] = v` | `runtime.mapassign*` (returns pointer to slot) |
| `v, ok := m[k]` | `runtime.mapaccess2*` |
| `delete(m, k)` | `runtime.mapdelete*` |
| `s = append(s, x)` | inline grow check + `runtime.growslice` on overflow |
| `copy(dst, src)` | `runtime.memmove` / typed copy helper |
| `ch <- v` | `runtime.chansend1` |
| `<-ch` | `runtime.chanrecv1` |
| type switch `x.(type)` | type-hash compares + `runtime.assertE2I*` paths |
| `string([]byte)` conversion | `runtime.slicebytetostring` (may allocate) |
| `panic(x)` | `runtime.gopanic` |
| closure creation | builds a closure struct, may call `runtime.newobject` |

The takeaway: an innocent-looking `m[k] = v` in a hot loop is a function call into the runtime. That is not free — but it is also why the language feels high-level.

`order` (`cmd/compile/internal/walk/order.go`) runs alongside `walk` and reorders/normalizes evaluation so that side effects happen in the right sequence and temporaries are introduced where needed (for example, ensuring a map key is evaluated before the assignment runtime call).

---

## 5. `//go:noinline` and friends

Compiler directives are special comments with **no space** after `//`:

```go
//go:noinline
func doNotInlineMe() int { return 1 }
```

`//go:noinline` forces the function to never be inlined. Why would you want that?

- **Benchmark honesty.** You want to measure the *real* call, not a version the compiler folded away.
- **Stable stack traces / profiling.** Inlined frames are attributed to the caller; disabling inline keeps a function visible in profiles (though modern Go tracks inlined frames too).
- **Working around a codegen issue** (rare).

Related directives:

| Directive | Effect |
|---|---|
| `//go:noinline` | Never inline this function. |
| `//go:noescape` | Assert (for an assembly-implemented function) that its pointer args do not escape. Dangerous if wrong. |
| `//go:nosplit` | No stack-split check (low-level runtime use). |
| `//go:norace` | Skip race-detector instrumentation. |

Beware: scattering `//go:noinline` to "make benchmarks realistic" can mask the fact that production code *would* inline and be faster. Use it deliberately.

---

## 6. A worked reading

```go
package main

type Point struct{ X, Y int }

func newPoint(x, y int) *Point { return &Point{x, y} } // escapes?

func sum(p *Point) int { return p.X + p.Y }            // inlinable

func main() {
    p := newPoint(1, 2)
    println(sum(p))
}
```

```bash
$ go build -gcflags='-m=2' ./main.go
./main.go:5:6: can inline newPoint
./main.go:7:6: can inline sum
./main.go:10:18: inlining call to newPoint
./main.go:11:13: inlining call to sum
./main.go:5:35: &Point{...} escapes to heap   # (without inlining)
# after inlining into main, &Point{...} does not escape: stays on stack
```

This shows the interaction: `newPoint` *in isolation* would escape its return value, but once inlined into `main`, the compiler can prove `p` never leaves `main`, and the `Point` stays on the stack. Inlining and escape analysis cooperate — which is why inlining often *reduces* allocations, not just call overhead.

---

## 7. Summary

- `-gcflags=-m` (stderr) prints inline and escape decisions; scope it with `importpath=-m` and use `-m=2` for cost/escape detail.
- The inliner uses a **cost budget** (~80); `defer`/`select`/large bodies block it. **Mid-stack inlining** lets non-leaf functions inline; **PGO** raises the budget on hot paths.
- Escape rules you can predict: returned pointers, storing into globals/heap, **interface boxing**, returned closures, and unboundable slice growth all escape.
- `walk` desugars `range`/maps/channels/`append`/type-switch into runtime calls; that explains hidden costs.
- `//go:noinline` forces no inlining — use it for honest benchmarks, not as a habit.

---

## Further reading

- Go source: [`cmd/compile/internal/inline`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/inline)
- Go source: [`cmd/compile/internal/escape`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/escape)
- Go source: [`cmd/compile/internal/walk`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/walk)
- [Compiler directives](https://pkg.go.dev/cmd/compile#hdr-Compiler_Directives) — official `//go:` directive docs
- Dave Cheney, [Five things that make Go fast](https://dave.cheney.net/2014/06/07/five-things-that-make-go-fast) — escape analysis intuition
