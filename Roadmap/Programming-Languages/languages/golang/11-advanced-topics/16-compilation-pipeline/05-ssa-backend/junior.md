# SSA Backend — Junior

The Go compiler (`gc`, the one you get with `go build`) does not turn your source
straight into machine code. After type-checking and an early intermediate
representation, it converts each function into **SSA form** — *Static Single
Assignment* — and runs dozens of optimization passes over it before emitting
assembly. This tier is about *seeing* that form, not memorizing it.

## 1. What "Static Single Assignment" means

SSA has one rule that changes everything: **every variable is assigned exactly
once.** If your source reassigns a variable, SSA renames each assignment into a
fresh version.

```go
x := 1   // x_1 = 1
x = x + 2 // x_2 = x_1 + 2
x = x * 3 // x_3 = x_2 * 3
```

Because each name has exactly one definition, the compiler can answer "where did
this value come from?" instantly — there is only one possible answer. That single
property is what makes most optimizations easy to write and safe to apply.

## 2. The phi (φ) function

Single-assignment breaks down at a control-flow *merge*: if a value comes from one
of two branches, which version is it?

```go
var x int
if cond {
    x = 10   // x_1
} else {
    x = 20   // x_2
}
use(x)       // x_3 = φ(x_1, x_2)
```

SSA inserts a **phi function** at the merge block. `x_3 = φ(x_1, x_2)` means
"pick `x_1` if we came from the first branch, `x_2` if from the second." Phi nodes
live at the *top* of a block and have one argument per incoming edge. They are the
only construct in SSA that "looks back" at where control came from. In the dump
you will see them written as `Phi <int> v5 v7`.

## 3. See it yourself: GOSSAFUNC

The single most useful tool in the entire backend is the `GOSSAFUNC` environment
variable. Set it to a function name, build, and the compiler writes an
**`ssa.html`** file showing the function at every pass.

```go
// file: demo.go
package main

func Add(a, b int) int {
    return a + b
}

func main() { println(Add(2, 3)) }
```

```shell
GOSSAFUNC=Add go build demo.go
# wrote ssa.html
open ssa.html        # macOS;  use xdg-open on Linux
```

Open the file. It is a wide table: the **leftmost column is your Go source**, and
each column to the right is the SSA after one pass ("start", "opt", "lower",
"regalloc", "genssa", …). Click a value (like `v5`) and every occurrence
highlights, so you can trace it across passes.

## 4. A real bounds check, then gone

Indexing a slice in Go is memory-safe: the compiler inserts a check that panics if
the index is out of range. But it can often *prove* the check is unnecessary and
delete it. That deletion is **Bounds-Check Elimination (BCE)**.

```go
func sum(s []int) int {
    total := 0
    for i := range s {   // i is always a valid index of s
        total += s[i]    // BCE removes the bounds check here
    }
    return total
}
```

```shell
GOSSAFUNC=sum go build demo2.go && open ssa.html
```

In an early pass you will see an `IsInBounds` value feeding a block that branches
to a `panicIndex` call. After the **`prove`** pass, that check disappears: the
compiler knows `i` comes from `range s`, so `0 <= i < len(s)` always holds. No
check, no branch, faster loop. A quicker way to confirm BCE without reading HTML:

```shell
go build -gcflags='-d=ssa/check_bce/debug=1' demo2.go
# prints "Found IsInBounds" only for checks that were NOT eliminated
```

## 5. Misconceptions

| Belief | Reality |
| --- | --- |
| "SSA is a language feature." | It is purely internal to the compiler. You never write it. |
| "GOSSAFUNC needs a special build of Go." | No — it works with the normal toolchain on any function. |
| "The bounds check is always there, just hidden." | Often it is genuinely *deleted*; the machine code has no check at all. |
| "Phi nodes cost runtime instructions." | They are removed before codegen (phi-elimination); they are bookkeeping. |
| "`a + b` becomes one `Add` instruction." | First a generic `Add64`, then it is *lowered* to an arch op like AMD64's `ADDQ`. |

## 6. Things to do today

1. Build the `Add` example with `GOSSAFUNC=Add` and open `ssa.html`. Find `v` for
   `a`, `b`, and the result.
2. Add the `sum` loop. Diff the SSA columns "before opt" vs "after prove" and spot
   the `IsInBounds` value disappearing.
3. Run the `-d=ssa/check_bce/debug=1` flag on a loop that *does* keep its check
   (e.g. index a slice with an unrelated variable) and watch it report the check.
4. Read the first screen of `$(go env GOROOT)/src/cmd/compile/internal/ssa/README.md`.

## 7. Summary

- SSA = every value defined once; renaming makes data-flow trivial to follow.
- **Phi (φ)** functions merge versions at control-flow joins.
- `GOSSAFUNC=Name go build` dumps **`ssa.html`**, one column per pass — your X-ray.
- The **`prove`** pass does **bounds-check elimination**; `range` loops are the
  easiest case to see it work.
- `gc` lowers generic ops to architecture ops before emitting machine code.

## Further reading

- SSA package README: `$(go env GOROOT)/src/cmd/compile/internal/ssa/README.md`
- Source: <https://github.com/golang/go/tree/master/src/cmd/compile/internal/ssa>
- Compiler overview README: `$(go env GOROOT)/src/cmd/compile/README.md`
- "Bounds Check Elimination" — Go docs & wiki: <https://go.dev/wiki/CompilerOptimizations>
- Wikipedia, Static Single Assignment: <https://en.wikipedia.org/wiki/Static_single-assignment_form>
