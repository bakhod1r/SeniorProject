# SSA Backend — Professional

This tier is a production playbook: drive a real performance investigation from
benchmark to `ssa.html` to `objdump`, *prove* that a bounds check is gone (or find
out why it isn't), analyze hot-path codegen, recognize where the compiler cannot
help, and — at a high level — contribute a rewrite rule upstream. Throughout, the
rule is **measure, read the SSA/asm, change one thing, re-measure.**

## 1. The investigation loop

```
benchmark (-bench, -benchmem)      → is it actually slow / allocating?
   → pprof / -gcflags=-m            → where, and is it inlined / escaping?
      → GOSSAFUNC ssa.html          → what did the optimizer do?
         → go tool objdump          → what machine code shipped?
            → change code/flag, GOTO benchmark
```

```shell
go test -run=^$ -bench=BenchmarkSum -benchmem -count=10 ./... | tee old.txt
# ...edit...
go test -run=^$ -bench=BenchmarkSum -benchmem -count=10 ./... | tee new.txt
benchstat old.txt new.txt          # statistically sound comparison
```

Never trust a single run; `benchstat` (golang.org/x/perf/cmd/benchstat) tells you
whether a delta is noise.

## 2. Proving BCE with three tools that must agree

A claim like "this loop has no bounds checks" needs evidence from independent
sources:

**(a) The bce-debug flag** — reports every check that survived:

```shell
go build -gcflags='-d=ssa/check_bce/debug=1' ./pkg
# Each printed "Found IsInBounds" / "Found IsSliceInBounds" is a check that was
# NOT eliminated, with file:line. Silence for a line = check removed.
```

**(b) GOSSAFUNC** — watch `IsInBounds` vanish across `prove`:

```shell
GOSSAFUNC=Sum go build ./pkg && open ssa.html
# In 'prove' column the IsInBounds value folds to ConstBool[true]; the panic
# block (calls panicIndex) becomes unreachable and is deadcode'd.
```

**(c) objdump / -S** — confirm no compare-and-branch-to-panic in the hot block:

```shell
go build -gcflags=-S ./pkg 2>asm.s          # textual asm with line numbers
go tool objdump -s 'pkg\.Sum' ./binary      # disassemble a built binary
# A surviving check looks like:  CMPQ AX, CX;  JCC ok;  CALL runtime.panicIndex
```

When all three agree, you have *proven* it. Example that passes all three:

```go
func Sum(s []int) (t int) {
    for i := range s {       // i provably in [0, len(s))
        t += s[i]
    }
    return
}
```

## 3. Hot-path codegen analysis

Reading `-S` output, watch for these red flags in inner loops:

| Red flag in asm | Means | Often fixable by |
| --- | --- | --- |
| `CALL runtime.panicIndex` reachable in loop | bounds check kept | hoist `len`, slice up front, use `range` |
| `CALL runtime.gcWriteBarrier` | pointer store hitting heap | store non-pointer, reuse backing array |
| `CALL runtime.convT*` / `runtime.mallocgc` | escape / boxing | avoid `interface{}` in hot path, `-m` to confirm escape |
| repeated identical `MOVQ (mem)` loads | a load CSE/`memcombine` missed (aliasing) | copy to a local outside the loop |
| `CALL runtime.morestack` cost suspicion | stack growth | usually fine; only chase if profiler points here |

Confirm inlining and escape first, because they gate everything downstream:

```shell
go build -gcflags='-m -m' ./pkg 2>&1 | grep -E 'inlin|escapes|moved to heap'
```

A function that *didn't* inline doesn't get its values folded into the caller's SSA,
so a "missed" optimization is frequently really a missed inline.

## 4. When the compiler genuinely can't help

Be honest about limits; rewriting code is pointless if the barrier is fundamental:

- **Aliasing through pointers.** The compiler must assume two `*int` may alias, so
  it can't hoist a load past a store. Break the dependency by copying into a local.
- **Calls clobber memory.** Any non-inlined call forces reloads of memory-backed
  values afterward (CSE won't cross it).
- **Dynamic bounds it can't relate.** `s[f(i)]` where `f` is opaque — no range
  fact exists, the check stays. This is correct, not a bug.
- **Interface dispatch.** A method call through an interface is an indirect call;
  it is not inlined and not devirtualized unless the concrete type is provable.
- **Floating point reassociation.** The compiler won't reassociate FP math (it
  would change results); `(a+b)+c` is not turned into `a+(b+c)`.

If you've confirmed the limit, the fix is algorithmic or a manual rewrite, not a
compiler flag.

## 5. Contributing a rewrite rule (high level)

Suppose you find a generic simplification the compiler misses. The path:

1. Express it as a rule in `cmd/compile/internal/ssa/_gen/generic.rules` (or
   `<ARCH>.rules` for a lowering/peephole). Example pattern shape:

   ```
   (Mul64 x (Const64 [c])) && isPowerOfTwo(c) => (Lsh64x64 x (Const64 [log2(c)]))
   ```

   (Strength reduction; the real tree uses helpers like `isPowerOfTwo` defined in
   `rewrite.go`.)

2. Regenerate the matchers:

   ```shell
   cd $(go env GOROOT)/src/cmd/compile/internal/ssa/_gen && go run *.go
   # or: go generate within the ssa package
   ```

   This rewrites `rewriteValuegeneric.go` / `rewriteValue<ARCH>.go`.

3. Rebuild the toolchain (`src/make.bash`), add a codegen test in
   `test/codegen/` asserting the expected asm (`// amd64: -"IMULQ"`), and run
   `cmd/compile`'s tests plus `ssa` package tests.

4. Verify with `GOSSAFUNC` on a sample that the new rule fires and `checkLower`
   still passes (every value must lower on every arch you touched).

The discipline is: rules must be *sound on all inputs* (mind overflow, signedness,
NaN), and every generic op you produce must have a lowering on every architecture.

## 6. Footguns

- **`GOSSAFUNC` matches the linker symbol.** For methods use `GOSSAFUNC='(*T).M'`;
  for generics the dump may show the shape-instantiation name.
- **`ssa.html` overwrites silently** each build; you only get the *last* matched
  function unless you set `GOSSAFUNC='f1 f2'` (space list → one file per func via
  `GOSSADIR`).
- **`-S` line numbers can mislead** after inlining — a panic call may be attributed
  to the inlined callee's line.
- **Benchmarks lie without `-count` and `benchstat`**; a "10% win" is often noise.
- **The dead-code'd value still shows** greyed in `ssa.html`; presence ≠ emitted.
- **Disabling a pass to "see the effect"** (`-d=ssa/prove/off=1`) changes other
  passes' inputs — useful for diagnosis, never a shipping config.

## 7. Summary

- Run the loop benchmark → `-m` → `ssa.html` → `objdump`, comparing with
  `benchstat`.
- Prove BCE with **all three**: `check_bce/debug=1`, the `prove` column, and the
  absence of a `panicIndex` branch in `-S`.
- Read hot-path asm for panic/write-barrier/alloc calls; gate everything on
  inlining and escape analysis.
- Know the hard limits (aliasing, calls, opaque indices, interfaces, FP order) and
  stop fighting them.
- A rewrite rule lives in `_gen/*.rules`, is regenerated by `rulegen`, and must be
  sound on every input and lowerable on every arch.

## Further reading

- `_gen/generic.rules`, `_gen/AMD64.rules`, `rewrite.go` in
  `$(go env GOROOT)/src/cmd/compile/internal/ssa/`
- Codegen tests (great worked examples): `$(go env GOROOT)/test/codegen/`
- `go tool objdump` and `compile` flags: `go doc cmd/compile`,
  `go tool compile -d help`
- benchstat: <https://pkg.go.dev/golang.org/x/perf/cmd/benchstat>
- Go compiler contribution guide: `cmd/compile/README.md`
