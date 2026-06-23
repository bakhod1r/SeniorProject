# SSA Backend — Senior

At this tier you should hold a correct *mental model* of the SSA backend: how the
IR becomes SSA, the shape of the pass pipeline, how rewrite rules and `rulegen`
work, where machine-independent optimization ends and **lowering** begins, and a
working understanding of register allocation. The goal is to reason about codegen
without dumping HTML for every question.

## 1. The SSA data model

Three types in `cmd/compile/internal/ssa` carry everything:

- **`ssa.Func`** (`func.go`) — one compiled function. Owns the blocks, an entry
  block, and the `*Config` describing the target architecture.
- **`ssa.Block`** (`block.go`) — a basic block: a list of `Values`, a `Kind`
  (`BlockPlain`, `BlockIf`, `BlockRet`, arch branch kinds…), and successor edges.
  Control flow lives in the block's kind and `Controls`.
- **`ssa.Value`** (`value.go`) — a single SSA value: an **`Op`**, a `*types.Type`,
  an `AuxInt`/`Aux` (immediates, symbols), and an `Args []*Value` list. Each value
  has a unique `ID`. *This* is the "defined once" object.

Ops are an enum (`Op`, generated into `opGen.go`). Generic ops (`Add64`,
`Load`, `IsInBounds`, `Phi`, `NilCheck`) are architecture-neutral; arch ops
(`AMD64ADDQ`, `ARM64MOVDload`) appear only after lowering. `Phi` is just an op
whose args line up with its block's predecessor edges.

## 2. Construction: IR → SSA (`ssagen`)

`cmd/compile/internal/ssagen/ssa.go` walks the typed IR (`ir.Node` tree) and emits
SSA. It builds blocks, threads values, and — crucially — handles the
SSA-construction problem of placing **phi functions** and renaming variables. Go
uses a variant of the classic *dominance-frontier* construction (Cytron et al.):
a variable assigned in multiple blocks needs a phi in every block on the dominance
frontier of those definitions. Dominator computation lives in `dom.go`. After this
pass the function is valid, *unoptimized* SSA — what you see in the `start` column.

## 3. The pass pipeline

The ordered list is the `passes` slice in `cmd/compile/internal/ssa/compile.go`.
Passes marked `required: true` run always; others can be disabled. The pipeline
splits cleanly into **machine-independent optimization** (before `lower`) and
**machine-dependent lowering + scheduling + allocation** (from `lower` on):

```
number lines → early phielim/copyelim → early deadcode → decompose user
opt (generic rewrite rules) → zcse → deadcode
generic cse → phiopt → nilcheckelim → prove        ← BCE / range facts
expand calls → late opt → sccp → deadcode
branchelim → check bce → dse → memcombine → writebarrier
--- machine boundary ---
lower (generic → arch ops) → addressing modes → late lower → pair
lowered cse → tighten tuple selectors → checkLower
late phielim/copyelim → tighten → critical (split critical edges)
layout (schedule blocks) → schedule (order values)
flagalloc → regalloc → loop rotate → trim → stackalloc → ...
```

(Names are verbatim from the source; the list evolves between releases — always
read `compile.go` for the version you ship.) Key passes to know by name:

| Pass | File | Purpose (one line) |
| --- | --- | --- |
| `opt` / `late opt` | `rewrite*.go` | apply generic rewrite rules: fold, simplify, strength-reduce |
| `generic cse` | `cse.go` | merge identical pure values |
| `nilcheckelim` | `nilcheck.go` | drop redundant nil checks |
| `prove` | `prove.go` | derive integer ranges → **bounds-check elimination** |
| `sccp` | `sccp.go` | sparse conditional constant propagation |
| `deadcode` | `deadcode.go` | remove unreachable/unused values & blocks |
| `lower` | generated `rewrite<ARCH>.go` | rewrite generic ops to arch ops |
| `schedule` | `schedule.go` | linearize values within each block |
| `regalloc` | `regalloc.go` | assign registers + spill/stack slots |
| `critical` | `critical.go` | split critical edges so phis are placeable |

## 4. Rewrite rules and rulegen

Most optimization and *all* lowering is expressed as **rewrite rules**, not
hand-written Go. Rules live in `cmd/compile/internal/ssa/_gen/`:

- `generic.rules` — machine-independent rewrites (folding, simplification, BCE).
- `<ARCH>.rules` (e.g. `AMD64.rules`, `ARM64.rules`) — lowering of generic ops to
  that architecture's ops.
- `genericOps.go` / `<ARCH>Ops.go` — the op *definitions* (arg count, types,
  commutativity, flags).

Rule syntax is `(pattern) [&& cond] => (replacement)`:

```
(Add64 (Const64 [c]) (Const64 [d])) => (Const64 [c+d])
(Mul64 (Const64 [c]) (Const64 [d])) => (Const64 [c*d])
(Sub64 x (Const64 <t> [c])) && x.Op != OpConst64 => (Add64 (Const64 <t> [-c]) x)
```

Lowercase identifiers (`x`, `c`) bind subtrees/AuxInts; `<t>` binds the type;
`&&` adds a Go boolean guard; `_` matches anything. The program **`rulegen`**
(`_gen/main.go` + `rulegen.go`) reads these `.rules` files and *generates* the Go
matcher functions `rewriteValuegeneric.go`, `rewriteValueAMD64.go`, etc., which the
`opt`/`lower` passes call. You never edit the generated files; you edit the
`.rules` and run `go generate` in the `ssa` directory.

## 5. Lowering: the machine boundary

Up to `lower`, the function speaks generic ops with no notion of registers or
addressing modes. The **`lower`** pass applies the `<ARCH>.rules` to replace each
generic op with one or more arch ops:

```
generic:  v10 = Add64 v8 v9
amd64:    v10 = ADDQ v8 v9          (after lower)
```

Lowering also collapses address arithmetic into the target's addressing modes
(`addressing modes` pass): a `Load (ADDQ ptr (SHLQconst idx)) ` becomes a single
`MOVQloadidx8`. After lowering, every value maps to (roughly) one machine
instruction, which is what makes scheduling and register allocation possible.

## 6. Register allocation (overview)

`regalloc.go` assigns each value a physical register, inserting **spills** to the
stack when registers run out. Go uses a fast, linear-scan-style allocator (not a
graph-coloring allocator) tuned for compile speed:

- Values flagged *rematerializable* (e.g. a constant) are recomputed instead of
  spilled — cheaper than a load.
- **`flagalloc`** runs first to handle the condition-flags "register," which is
  special because most arch ops clobber flags.
- The allocator respects calling-convention registers and clobbers around calls.
- `phi` values are resolved here into moves on the incoming edges (which is why
  `critical` must split critical edges first — there must be a block to put the
  move in).

After regalloc come stack-frame layout, final deadcode/trim, and the obj writer
that emits the actual machine encoding.

## 7. Why SSA enables all of this

Every pass above leans on the single-assignment invariant:

- **Folding/CSE**: equal ops with equal args are provably equal — no aliasing of
  *names* to worry about.
- **Prove/BCE**: a def has exactly one source, so range facts propagate cleanly
  down dominators.
- **Dead code**: a value with zero uses is trivially dead; use-counts are exact.
- **Register allocation**: live ranges are precise because each value has one def
  and well-defined uses.

The cost is phi management and edge splitting — a price the backend pays once at
construction and unwinds before codegen.

## Further reading

- `compile.go` (the `passes` list) and `README.md` in
  `$(go env GOROOT)/src/cmd/compile/internal/ssa/`
- `rulegen` and rules: `_gen/main.go`, `_gen/generic.rules`, `_gen/AMD64.rules`
- Construction: `cmd/compile/internal/ssagen/ssa.go`; dominators: `ssa/dom.go`
- Cytron et al., "Efficiently Computing Static Single Assignment Form" (1991)
- Keith Randall, "Go's SSA backend" talk & design notes: <https://go.dev/wiki/CompilerOptimizations>
