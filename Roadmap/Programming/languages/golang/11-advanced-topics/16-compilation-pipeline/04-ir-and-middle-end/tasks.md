# IR & Middle-End — Tasks

Hands-on exercises. Each should take a few minutes; do them against a small scratch package or a real one. Diagnostics go to **stderr**, so add `2>&1` when piping.

---

## 1. Find what escapes in a package

```bash
go build -gcflags='-m' ./... 2>&1 | grep -E 'moved to heap|escapes to heap'
```

Pick one of your own packages. List every escape. For each, decide: is this lifetime *necessary* (returned/stored) or *accidental*?

---

## 2. Reproduce the classic "returned pointer escapes"

Write a `func New() *T` returning `&T{}`. Confirm `&T{} escapes to heap` with `-m`. Then change it to `func New() T` and confirm the message disappears at the call site after inlining. Note the difference in `-benchmem`.

---

## 3. Force a stack allocation

Take a function whose local currently escapes (e.g., because you return `&x`). Refactor so the value is returned **by value** or consumed locally, and confirm with `-m` that it now says `does not escape` (visible at `-m=2`).

---

## 4. Watch interface boxing escape

```go
func sink(v any) { global = v }
var global any
```

Call `sink(42)` and confirm `42 escapes to heap` (boxing). Then change `global` to `int` and pass by value; confirm the escape is gone.

---

## 5. Measure the inlining budget

Write a function and grow its body (add statements) until `-m` flips from `can inline f` to `cannot inline f: function too complex`. Approximate where the cutoff is. Then add a `defer` to a small function and watch it become non-inlinable.

```bash
go build -gcflags='-m=2' ./... 2>&1 | grep -E 'can inline|cannot inline|cost'
```

---

## 6. Use `//go:noinline` and see the difference

Add `//go:noinline` above an inlinable function. Confirm `can inline` disappears and `inlining call to` is gone at call sites. Benchmark with and without to feel the call overhead. Remove it afterward.

---

## 7. Disable inlining globally

```bash
go build -gcflags='all=-l' -o slow ./cmd/app
go build -o fast ./cmd/app
ls -l slow fast        # compare binary sizes
```

Compare binary size and (if you have a benchmark) speed with all inlining off. This shows how much the inliner contributes.

---

## 8. See `walk` output / lowered IR

```bash
go build -gcflags='-W' ./yourpkg 2>&1 | less   # dump IR trees (verbose)
```

Find a `for ... range` over a map in the dump and observe it becoming a loop around `runtime.mapiterinit`/`mapiternext`. (Use `-S` to see the final assembly form too.)

---

## 9. Confirm a runtime call from desugaring

```bash
go build -gcflags='-S' ./yourpkg 2>&1 | grep -E 'runtime\.(mapaccess|mapassign|growslice|convT)'
```

Write code with `m[k]`, `m[k]=v`, and `append`, then find the corresponding `runtime.*` calls in the assembly. Match each to the desugaring table.

---

## 10. Scope `-m` to one package

Run a bare `go build -gcflags=-m ./...` on a project with dependencies and note the noise. Then scope it: `go build -gcflags='yourmodule/pkg=-m' ./...`. Compare output volume.

---

## 11. Read an escape `flow:` chain at `-m=2`

Find a `moved to heap` line at `-m=2`. Locate the `flow:` lines above/near it and trace the pointer path from the local to the heap store that caused the escape. Write down the root cause (which assignment).

---

## 12. Catch a regression with `AllocsPerRun`

Write a test asserting a hot function does zero allocations:

```go
func TestZeroAllocs(t *testing.T) {
    if n := testing.AllocsPerRun(1000, func() { hot(input) }); n != 0 {
        t.Fatalf("got %.0f allocs/op", n)
    }
}
```

Now deliberately introduce an escape (box an arg into `any`) and confirm the test fails. Revert.

---

## 13. Enable PGO and compare

Collect a CPU profile from a representative run (`runtime/pprof` or `net/http/pprof`). Place it as `default.pgo` next to `main`, or build with `-pgo=cpu.pprof`. Compare `-m` inline output and benchmarks with and without:

```bash
go build -gcflags='-m' ./... 2>&1 | sort > nopgo.txt
go build -pgo=cpu.pprof -gcflags='-m' ./... 2>&1 | sort > pgo.txt
diff nopgo.txt pgo.txt   # new 'inlining call to' lines on hot paths
```

---

## 14. Devirtualization hunt

Write a function that calls an interface method where the concrete type is locally known (assign a `*bytes.Buffer` to an `io.Writer`, then call `Write`). Build with `-m=2` and look for devirtualization happening once the call site is inlined. Then hide the type behind a parameter and watch it stay an interface call.

---

## Summary

You've now driven every middle-end diagnostic by hand: `-m`/`-m=2` for escape and inline decisions, `-l`/`all=-l` to toggle inlining, `-W`/`-S` to see desugared IR and the resulting runtime calls, scoping with `pkg=-m`, regression gates via `AllocsPerRun`, and PGO before/after comparison. The throughline: the compiler tells you its decisions — read them, then change the code so the analyzer can keep values on the stack and the inliner can fold your hot functions.

---

## Further reading

- `go tool compile -help` — every `gc` flag for your installed version
- [Diagnostics](https://go.dev/doc/diagnostics)
- [Profile-guided optimization](https://go.dev/doc/pgo)
- [`testing.AllocsPerRun`](https://pkg.go.dev/testing#AllocsPerRun)
