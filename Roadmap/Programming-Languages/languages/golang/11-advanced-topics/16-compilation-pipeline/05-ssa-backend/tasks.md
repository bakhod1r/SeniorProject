# SSA Backend — Tasks

Hands-on exercises. Each is concrete and verifiable with the standard toolchain
(no special build of Go). Work in a scratch module; keep a notebook of what each
pass column showed. Helper commands:

```shell
GOSSAFUNC=Fn go build . && open ssa.html        # xdg-open on Linux
go build -gcflags='-d=ssa/check_bce/debug=1' .   # surviving bounds checks
go build -gcflags='-m -m' .                       # inlining + escape
go build -gcflags=-S . 2>asm.s                     # final assembly
```

---

1. **Dump your first function.** Write `func Add(a, b int) int { return a + b }`,
   run `GOSSAFUNC=Add go build`, open `ssa.html`. Identify the `Arg` values for `a`
   and `b`, the `Add64`, and the column where `Add64` becomes an arch op.

2. **Trace one value across passes.** In the dump above, click the result value and
   note every column it appears in. Record where it changes op name (the `lower`
   column).

3. **Watch a bounds check disappear.** Write `func sum(s []int) (t int) { for i :=
   range s { t += s[i] } ; return }`. Find the `IsInBounds` value in the `opt`
   column and confirm it is **gone** in the `prove` column.

4. **Confirm BCE with the debug flag.** Run `check_bce/debug=1` on the `sum` above
   and verify it prints **nothing** for the `s[i]` line. Then change `range s` to a
   `for i := 0; i <= len(s); i++` loop and watch the flag report the surviving
   check.

5. **Make a hoist fix.** Write a function reading `s[0]..s[3]` with the length guard
   *after* the reads. Confirm checks survive, move the guard (`if len(s) < 4`) to
   the top, and confirm all four checks now fold.

6. **Pin a masked index.** Write `func bucket(t []int, h uint) int { return
   t[h&0xff] }`. Show the check survives. Add `t = t[:256]` and show it folds (this
   exercises the `(IsInBounds (And ...) (Const ...))` rule).

7. **Find a phi.** Write a function with `if cond { x = 10 } else { x = 20 };
   return x`. In `ssa.html` locate the `Phi` value at the merge block and confirm it
   has two args, one per predecessor edge.

8. **See nil-check elimination.** Write `func f(p *T) int { return p.x + p.y }`.
   In the `nilcheckelim` column confirm the second `NilCheck` is removed. Then break
   it by round-tripping `p` through an `any` between the reads and observe the
   change.

9. **Observe constant folding.** Write `func k() int { return 2*3 + 4 }`. Confirm
   no `ADD`/`IMUL` survives — it's a single `Const` by the `opt` column.

10. **Catch a missed CSE.** Write two calls to the same impure function separated by
    another call; read `-S` and confirm both calls are emitted. Then make the value
    pure (a local arithmetic expression) and confirm CSE merges it.

11. **Compare two implementations.** Implement the same routine two ways (e.g.
    index loop vs `range` loop). Dump both with `GOSSAFUNC`, diff the `prove` and
    `genssa` columns, and write down which produced fewer values/branches.

12. **Read the assembly for a write barrier.** Write a loop that stores `&nodes[i]`
    into a `[]*Node`. Find `runtime.gcWriteBarrier` in `-S`. Rewrite to store
    indices and confirm the barrier disappears.

13. **Disable a pass for diagnosis.** Build the `sum` function with
    `-gcflags='-d=ssa/prove/off=1'` and confirm the bounds check reappears in `-S`.
    Note that this is a diagnosis tool only, not a config.

14. **Find a lowering rule.** Open
    `$(go env GOROOT)/src/cmd/compile/internal/ssa/_gen/AMD64.rules`, locate the
    rule that lowers a generic `Add64` to `ADDQ`, and the matching op definition in
    `AMD64Ops.go`. Then find the corresponding generic constant-fold rule for
    `Add64` in `generic.rules`.

---

**Stretch:** pick a function from a real dependency, run `GOSSAFUNC` on it, and
write a one-paragraph report: which checks were eliminated, which survived and why,
and one change that would help the optimizer.

## Further reading

- SSA README & rules: `$(go env GOROOT)/src/cmd/compile/internal/ssa/README.md`,
  `_gen/generic.rules`, `_gen/AMD64.rules`
- Codegen test examples: `$(go env GOROOT)/test/codegen/`
- Go wiki Compiler Optimizations: <https://go.dev/wiki/CompilerOptimizations>
