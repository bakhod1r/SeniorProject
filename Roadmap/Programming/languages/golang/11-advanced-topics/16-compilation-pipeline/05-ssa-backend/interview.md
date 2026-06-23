# SSA Backend — Interview

About 20 questions and answers on the gc SSA backend: SSA itself, phi functions,
the pass pipeline, BCE and nil-check elimination, rewrite rules, `GOSSAFUNC`, and
lowering. Answers are concise but specific enough to defend in a follow-up.

---

**Q1. What does SSA stand for and what is its defining property?**
Static Single Assignment. Every value is assigned exactly once; reassignments in
source are renamed into distinct versions. This makes data-flow trivial — each
value has exactly one definition.

**Q2. Why does single assignment help the optimizer?**
Use-def is exact: "where did this come from?" has one answer. Equal ops with equal
args are provably equal (easy CSE), values with zero uses are trivially dead (easy
DCE), and range/non-nil facts propagate cleanly down dominators (easy prove).

**Q3. What is a phi (φ) function and where does it appear?**
A pseudo-op at the start of a control-flow *merge* block that selects which
incoming version of a value to use. Argument *i* corresponds to predecessor edge
*i*. It is the only construct that depends on which edge control arrived from.

**Q4. How are phis placed during construction?**
Using dominance frontiers (Cytron et al.): a variable defined in some blocks needs
a phi in every block on the dominance frontier of those definitions. Go's
construction lives in `cmd/compile/internal/ssagen`; dominators in `ssa/dom.go`.

**Q5. Do phi functions cost runtime instructions?**
No. They're resolved before codegen — phi-elimination/copy-elim turn them into
moves on the incoming edges (which is why critical edges must be split first). The
final machine code has no "phi instruction."

**Q6. Name the three core SSA types in `cmd/compile/internal/ssa`.**
`ssa.Func` (a function), `ssa.Block` (a basic block with a kind and edges), and
`ssa.Value` (one SSA value: an `Op`, type, `AuxInt`/`Aux`, and `Args`). Each
`Value` has a unique `ID`.

**Q7. What's the difference between a generic op and an arch op?**
Generic ops (`Add64`, `Load`, `IsInBounds`, `Phi`) are machine-independent. Arch
ops (`AMD64ADDQ`, `ARM64MOVDload`) are target-specific and appear only after the
`lower` pass. `checkLower` enforces no generic op survives to codegen.

**Q8. Where is the pass pipeline defined?**
The `passes` slice in `cmd/compile/internal/ssa/compile.go`. It runs in order;
passes marked `required: true` always run, others can be toggled.

**Q9. Roughly split the pipeline into two halves.**
Machine-independent optimization *before* `lower` (opt/rewrite, cse, nilcheckelim,
prove, sccp, deadcode, …) and machine-dependent work *from* `lower` on (lowering to
arch ops, addressing modes, scheduling, flagalloc, regalloc, stack layout).

**Q10. Which pass does bounds-check elimination, and how?**
The `prove` pass (`ssa/prove.go`) derives integer ranges and relations between
values. When it can show an index is within `[0, len)`, the generic rewrite rules
fold the `IsInBounds`/`IsSliceInBounds` op to `ConstBool [true]`, and deadcode
removes the now-unreachable panic branch.

**Q11. Give two code patterns that reliably enable BCE.**
`for i := range s { _ = s[i] }` (range gives `0 <= i < len(s)`), and hoisting the
bound: `if len(s) >= 4 { _ = s[0]; ...; _ = s[3] }` so one check covers several
indices. Pinning length with `s = s[:n]` also helps masked indices.

**Q12. Give a pattern that defeats BCE and why.**
`for i := 0; i <= len(s); i++ { _ = s[i] }` — with `<=`, `i` can equal `len(s)`, so
the in-range condition is not provable (it's false). Also `s[j]` with `j` unrelated
to `s` — no fact ties them.

**Q13. How do you verify BCE without reading HTML?**
`go build -gcflags='-d=ssa/check_bce/debug=1' .` prints every bounds check that was
*not* eliminated, with file:line. Silence on a line means the check was removed.

**Q14. What is nil-check elimination and which pass does it?**
`nilcheckelim` (`ssa/nilcheck.go`) removes redundant `NilCheck` values: once a
pointer is checked or dereferenced on a path, later checks that it dominates are
dropped. Round-tripping the pointer through an interface or reassigning it can
defeat this.

**Q15. What are rewrite rules and where do they live?**
Declarative `(pattern) [&& cond] => (replacement)` rules in
`cmd/compile/internal/ssa/_gen/`: `generic.rules` (machine-independent) and
`<ARCH>.rules` (lowering). Op definitions are in `genericOps.go`/`<ARCH>Ops.go`.

**Q16. Show a constant-folding rule.**
`(Add64 (Const64 [c]) (Const64 [d])) => (Const64 [c+d])` and
`(Mul64 (Const64 [c]) (Const64 [d])) => (Const64 [c*d])`. Lowercase names bind
subtrees/AuxInts; `&&` adds a Go guard; `_` matches anything.

**Q17. What is rulegen?**
The program (`_gen/main.go` + `rulegen.go`) that reads the `.rules` files and
*generates* the Go matcher functions (`rewriteValuegeneric.go`,
`rewriteValue<ARCH>.go`) the `opt`/`lower` passes call in a fixpoint loop. You edit
`.rules` and regenerate; you never hand-edit the generated files.

**Q18. What does GOSSAFUNC do and how do you read its output?**
`GOSSAFUNC=Name go build` writes `ssa.html`: leftmost column is your source, each
column to the right is the SSA after one pass. Click a value to highlight all uses;
greyed values are dead. Use `Name:pass` to dump a single column, and quote method
symbols, e.g. `GOSSAFUNC='(*T).M'`.

**Q19. What is lowering and where is the boundary?**
The `lower` pass rewrites generic ops into arch ops using `<ARCH>.rules`; the
`addressing modes` pass folds address arithmetic into the target's addressing
modes. After lowering, each value maps to ~one machine instruction, enabling
scheduling and register allocation.

**Q20. Give a high-level summary of Go's register allocation.**
`regalloc.go` uses a fast linear-scan-style allocator (not graph coloring), tuned
for compile speed. It spills to the stack under pressure, rematerializes cheap
values (constants) instead of spilling, runs after `flagalloc` (the flags
register), and resolves phis into edge moves — which is why `critical` splits
critical edges first.

**Q21. Why won't the compiler reassociate floating-point math or merge a load
across a call?**
FP reassociation would change IEEE-rounded results, so it's disallowed. A load
isn't merged across a call (or a store through a possibly-aliasing pointer) because
the memory it reads may have changed; the compiler must assume the worst about
aliasing.

## Further reading

- `compile.go`, `prove.go`, `nilcheck.go`, `cse.go`, `regalloc.go`, `README.md` in
  `$(go env GOROOT)/src/cmd/compile/internal/ssa/`
- Rules & rulegen: `_gen/generic.rules`, `_gen/AMD64.rules`, `_gen/main.go`
- Construction: `cmd/compile/internal/ssagen/ssa.go`
- Go wiki Compiler Optimizations: <https://go.dev/wiki/CompilerOptimizations>
- Cytron et al., "Efficiently Computing Static Single Assignment Form" (1991)
