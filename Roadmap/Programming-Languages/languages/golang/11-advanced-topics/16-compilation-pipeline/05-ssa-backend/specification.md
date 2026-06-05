# SSA Backend — Specification

A reference for the `gc` SSA backend: the value/block/op model, a representative
pass list with one-line purposes, rewrite-rule syntax, `GOSSAFUNC` usage, and the
generic→arch lowering concept. Pass names and rules track a specific Go release;
the authoritative source is `cmd/compile/internal/ssa/compile.go` in your tree
(examples here reflect Go 1.25).

## 1. The SSA model

| Type | File | Holds |
| --- | --- | --- |
| `ssa.Func` | `func.go` | one function: entry block, all blocks, `*Config`, name |
| `ssa.Block` | `block.go` | basic block: `Kind`, `Values`, `Controls`, succ/pred edges |
| `ssa.Value` | `value.go` | `ID`, `Op`, `*types.Type`, `AuxInt`, `Aux`, `Args []*Value` |
| `ssa.Op` | `op.go`/`opGen.go` | the operation enum (generic + per-arch) |

Invariants:

- **Single assignment**: each `Value.ID` is defined exactly once.
- **Phi**: `OpPhi` values sit at a block's start; arg *i* corresponds to
  predecessor edge *i*.
- **Block kinds**: `BlockPlain` (one succ), `BlockIf` (two succs on a bool
  control), `BlockRet`, `BlockExit`, plus arch-specific branch kinds after lowering
  (`BlockAMD64EQ`, …).
- **Aux/AuxInt**: encode immediates, symbols, types-of-interest for an op.

## 2. Representative pass list (purpose in one line)

From the `passes` slice in `compile.go`. Order matters; `required` passes always
run.

| Pass | Purpose |
| --- | --- |
| number lines | attach line numbers for debug info |
| early phielim and copyelim | drop trivial phis/copies from construction |
| early deadcode | remove obviously dead generated code |
| decompose user | split structs/strings/slices/interfaces into scalar parts |
| opt | apply generic rewrite rules (fold, simplify, strength-reduce) |
| zero arg cse / generic cse | merge identical pure values |
| phiopt | simplify phis into selects/bool ops where possible |
| nilcheckelim | remove redundant nil checks |
| prove | derive integer ranges/relations → **bounds-check elimination** |
| expand calls | lower the abstract call op to ABI register/stack moves |
| late opt | second generic-rewrite round after expansion |
| sccp | sparse conditional constant propagation |
| branchelim | turn small if/else into branchless `CondSelect` |
| check bce | (debug) report remaining bounds checks |
| dse | dead-store elimination |
| memcombine | combine adjacent loads/stores into wider ops |
| writebarrier | expand GC write barriers |
| **lower** | rewrite **generic ops → arch ops** (machine boundary) |
| addressing modes | fold address arithmetic into arch addressing modes |
| late lower / pair | further arch peepholes; pair loads/stores |
| lowered cse | CSE again on lowered ops |
| critical | split critical edges (so phi moves have a home) |
| layout | order blocks |
| schedule | order values within each block |
| flagalloc | allocate the condition-flags register |
| regalloc | assign registers + spill slots |
| trim / stackalloc | remove empty blocks; lay out the stack frame |

## 3. Rewrite-rule syntax

Rules live in `cmd/compile/internal/ssa/_gen/`:
`generic.rules` (machine-independent) and `<ARCH>.rules` (lowering). Form:

```
(OpName <type> [auxint] {aux} arg0 arg1 ...) [&& condition] => (Replacement ...)
```

- Lowercase tokens (`x`, `c`, `d`) bind subtrees, AuxInts (`[c]`), or Aux (`{s}`).
- `<t>` binds/asserts the value's type; `_` matches anything.
- `&& goExpr` is a Go boolean guard evaluated on the bound names.
- `=>` is the standard rewrite; `->` (typed) historically required an explicit
  type. A `(...)` on the right may nest to build a tree.

Examples (verbatim from `_gen/generic.rules`):

```
(Add64 (Const64 [c]) (Const64 [d]))                         => (Const64 [c+d])
(Mul64 (Const64 [c]) (Const64 [d]))                         => (Const64 [c*d])
(IsInBounds x x)                                             => (ConstBool [false])
(IsInBounds (ZeroExt8to64 _) (Const64 [c])) && (1<<8) <= c  => (ConstBool [true])
(Sub64 x (Const64 <t> [c])) && x.Op != OpConst64            => (Add64 (Const64 <t> [-c]) x)
```

Op definitions (arg count, commutativity, type) are in `genericOps.go` /
`<ARCH>Ops.go`, e.g. `{name: "Add64", argLength: 2, commutative: true}`.

## 4. rulegen

`_gen/main.go` + `rulegen.go` (the **`rulegen`** program) read every `.rules` file
and emit the matcher functions `rewriteValuegeneric.go`, `rewriteValue<ARCH>.go`,
`rewriteBlock<ARCH>.go`. The `opt`/`lower` passes call these generated functions in
a fixpoint loop until no rule fires. Regenerate with `go generate` (or
`go run *.go`) inside `_gen/`. Generated files are never hand-edited.

## 5. GOSSAFUNC

```
GOSSAFUNC=<func>            go build .     # dump all passes for <func> to ssa.html
GOSSAFUNC=<func>:<pass>     go build .     # dump only that one pass column
GOSSAFUNC='f1 f2'          go build .      # multiple funcs (see GOSSADIR)
GOSSADIR=dir GOSSAFUNC=...                 # write per-function files into dir
```

- `<func>` is the linker symbol: `Name`, `(*T).Method`, `pkg.Name`.
- Output `ssa.html`: leftmost column = source; each subsequent column = SSA after
  one pass; click a value to highlight all uses; greyed = dead.

Related compile debug flags (`-gcflags='-d=...'`):

| Flag | Effect |
| --- | --- |
| `ssa/check_bce/debug=1` | print bounds checks NOT eliminated |
| `ssa/prove/debug=1` | trace the prove pass's deductions |
| `ssa/<pass>/off=1` | disable a pass (diagnosis only) |
| `-m` / `-m -m` | report inlining and escape decisions |
| `-S` | print final assembly |

## 6. Generic → arch lowering

Before `lower`, values use **generic ops** with no register/addressing concept.
The `lower` pass applies `<ARCH>.rules` to map each generic op to one or more arch
ops; the `addressing modes` pass then folds address math into the target's modes.

```
generic:            v = Add64 a b
amd64 (post-lower): v = ADDQ a b
arm64 (post-lower): v = ADD  a b

generic:            Load (PtrIndex base idx) mem
amd64 (folded):     MOVQloadidx8 base idx mem
```

Every generic op must have a lowering on every supported architecture; `checkLower`
enforces that no generic op survives into codegen. After lowering, scheduling,
flag/register allocation, and stack layout, the obj writer emits machine code.

## Further reading

- `compile.go`, `func.go`, `block.go`, `value.go`, `op.go`, `README.md` in
  `$(go env GOROOT)/src/cmd/compile/internal/ssa/`
- `_gen/README`, `_gen/generic.rules`, `_gen/<ARCH>.rules`, `_gen/main.go`
- `go doc cmd/compile`; `go tool compile -d help` (debug flag list)
- Compiler overview: `$(go env GOROOT)/src/cmd/compile/README.md`
