# SSA Backend — Middle

You can already dump `ssa.html`. This tier teaches you to *read it across passes*,
to recognize the optimizations that matter for performance (BCE, nil-check
elimination, CSE, constant folding), and to write Go that lets those passes fire.

## 1. Reading ssa.html across passes

`GOSSAFUNC=Name go build` produces a horizontal table. Each column is the function
after one named pass; columns appear in the same order as the `passes` list in
`cmd/compile/internal/ssa/compile.go`. A column you almost always care about:

| Column | What it shows |
| --- | --- |
| `start` | SSA straight out of IR construction (very verbose) |
| `opt` | after the main generic rewrite rules (folding, simplification) |
| `prove` | after the prover — **BCE and range facts applied here** |
| `lower` | generic ops replaced by **arch-specific** ops (`ADDQ`, `MOVQload`…) |
| `regalloc` | values assigned to registers / stack slots |
| `genssa` | final pseudo-assembly handed to the obj writer |

Practical reading workflow:

1. Click a value id (`v12`) — all uses highlight across every column.
2. A value that exists in `start` but is **absent** later was optimized away.
3. Greyed-out values are dead (kept for display, not emitted).
4. Blocks ending in `If … goto bN else bM` are conditional branches; a block that
   calls `panicIndex`/`panicSlice` is a bounds-check failure path.

To narrow the dump to one phase, name the pass:

```shell
GOSSAFUNC=hotLoop go build .            # all passes
GOSSAFUNC="hotLoop:prove" go build .    # only the prove column (faster to scan)
```

## 2. BCE patterns you can rely on

The **`prove`** pass (`cmd/compile/internal/ssa/prove.go`) derives integer ranges
and relations, then the generic rules in `_gen/generic.rules` fold the resulting
`IsInBounds`/`IsSliceInBounds` ops into `ConstBool [true]`, deleting the panic
branch. Patterns that reliably eliminate the check:

```go
// 1. range over the same slice
for i := range s { _ = s[i] }            // proven: 0 <= i < len(s)

// 2. range with value (no index op at all)
for _, v := range s { use(v) }           // nothing to check

// 3. length-derived bound checked once
if len(s) >= 4 {
    _ = s[0]; _ = s[1]; _ = s[2]; _ = s[3] // all four checks dropped
}

// 4. "BCE hint" — hoist the bound so later indices are free
func f(s []int, i int) {
    s = s[:i+1]   // or:  _ = s[i]
    _ = s[i]      // now proven in range
}
```

A real rule from `_gen/generic.rules` shows the shape:

```
(IsInBounds (ZeroExt8to64 _) (Const64 [c])) && (1 << 8) <= c => (ConstBool [true])
(IsInBounds x x)                                              => (ConstBool [false])
```

The first says: an index that is a zero-extended byte (0..255) against a length of
at least 256 is *always* in bounds — fold to `true`, drop the check.

Patterns that **defeat** BCE:

```go
for i := 0; i <= len(s); i++ { _ = s[i] }   // off-by-one: i can equal len(s)
_ = s[j]                                     // j unrelated to s — cannot prove
_ = s[i&mask]                                // mask not provably < len(s)
```

## 3. Nil-check elimination

Dereferencing a pointer in Go is checked: the hardware fault on a nil deref is
turned into a `nil pointer dereference` panic, and the compiler inserts explicit
`NilCheck` values where needed. The **`nilcheckelim`** pass
(`cmd/compile/internal/ssa/nilcheck.go`) removes redundant ones: once a pointer has
been checked (or dereferenced) on a path, later checks of the same pointer that
dominate-down are dropped.

```go
func f(p *T) int {
    a := p.x   // NilCheck on p here
    b := p.y   // redundant — p already known non-nil; check eliminated
    return a + b
}
```

In `ssa.html` look at the `nilcheckelim` column: a `NilCheck v3` present before and
gone after means it was removed. Help the pass by **not** hiding the pointer behind
an interface or a reassignment between uses.

## 4. CSE — Common Subexpression Elimination

The **`generic cse`** pass (`cmd/compile/internal/ssa/cse.go`) finds values that
compute the *same thing* and keeps one. SSA makes this trivial: two `Add64` values
with identical args are provably equal.

```go
func g(a, b int) int {
    x := (a + b) * 2
    y := (a + b) * 3   // (a+b) computed once; CSE shares it
    return x + y
}
```

In the dump, after `opt`/`generic cse` you will see a single `Add64` feeding both
`Mul64`s. CSE only merges *pure* values — anything touching memory (loads through
possibly-aliasing pointers, calls) is not blindly merged.

## 5. Constant folding

Generic rewrite rules fold constant arithmetic at compile time. From
`_gen/generic.rules`:

```
(Add64 (Const64 [c]) (Const64 [d])) => (Const64 [c+d])
(Mul64 (Const64 [c]) (Const64 [d])) => (Const64 [c*d])
```

So `2 + 3` never becomes an `ADDQ` — it is already `Const64 [5]` by the `opt`
column. The newer **`sccp`** pass (Sparse Conditional Constant Propagation,
`cmd/compile/internal/ssa/sccp.go`) folds constants that flow across branches and
phis, catching cases simple peephole rules miss.

```go
const k = 1 << 20
func h(n int) int { return n * k }   // k folded to a shift, not a multiply
```

## 6. How to help the optimizer

| Goal | Do this |
| --- | --- |
| Enable BCE | Index with the `range` variable; hoist `len` checks; slice to the needed length up front. |
| Enable nil-check elim | Don't round-trip a pointer through an interface between uses. |
| Enable CSE | Compute a subexpression once into a local; the compiler will share it anyway, but it costs nothing and aids readability. |
| Enable inlining (feeds SSA) | Keep hot functions small; check with `-gcflags=-m`. |
| Verify, don't guess | Read `ssa.html`; confirm with `objdump`. |

Two indispensable flags:

```shell
go build -gcflags='-m' .                          # inlining + escape decisions
go build -gcflags='-d=ssa/check_bce/debug=1' .    # report bounds checks NOT removed
go build -gcflags='-S' . 2>asm.s                  # final assembly
```

## 7. Summary

- Read `ssa.html` left-to-right; a value that vanishes between columns was
  optimized away. Use `Name:pass` to isolate a phase.
- **BCE** lives in `prove` + generic rules; `range` indexing and hoisted `len`
  checks are the reliable patterns.
- **Nil-check elimination** drops redundant `NilCheck`s once a pointer is known
  non-nil on the path.
- **CSE** and **constant folding/sccp** are nearly free wins that SSA makes safe.
- Help the optimizer by writing provable code, then *verify* with the bce-debug
  flag and assembly.

## Further reading

- `prove.go`, `nilcheck.go`, `cse.go`, `sccp.go` in
  `$(go env GOROOT)/src/cmd/compile/internal/ssa/`
- Generic rewrite rules: `_gen/generic.rules` (search `IsInBounds`)
- Go wiki, Compiler And Runtime Optimizations: <https://go.dev/wiki/CompilerOptimizations>
- Dave Cheney, "Bounds check elimination in Go": <https://dave.cheney.net/2014/06/07/five-things-that-make-go-fast>
- `cmd/compile/README.md` in the Go source tree.
