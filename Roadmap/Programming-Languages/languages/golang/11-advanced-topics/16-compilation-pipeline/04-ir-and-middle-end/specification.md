# IR & Middle-End — Specification

A reference for the `gc` compiler's IR and machine-independent (middle-end) passes. Source paths are under `src/cmd/compile/internal/` in the Go tree. Names reflect Go 1.21+ and may drift across releases — treat as a map, not a contract.

---

## 1. The `ir.Op` taxonomy (by category)

Every IR node carries an `Op` (defined in `cmd/compile/internal/ir/node.go`, generated list in `op_string.go`). The enum is large; the useful grouping:

| Category | Representative `Op`s | Notes |
|---|---|---|
| Names / literals | `ONAME`, `ONONAME`, `OLITERAL`, `ONIL`, `OTYPE` | `ONAME` → `*ir.Name` (var/func/const). |
| Arithmetic | `OADD`, `OSUB`, `OMUL`, `ODIV`, `OMOD`, `ONEG` | Binary/unary numeric ops. |
| Bitwise / shift | `OAND`, `OOR`, `OXOR`, `OANDNOT`, `OLSH`, `ORSH`, `OBITNOT` | |
| Logical / compare | `OANDAND`, `OOROR`, `ONOT`, `OEQ`, `ONE`, `OLT`, `OLE`, `OGT`, `OGE` | |
| Addressing / deref | `OADDR`, `ODEREF`, `ODOT`, `ODOTPTR`, `OINDEX`, `OINDEXMAP` | `OINDEXMAP` is a map index, lowered by walk. |
| Calls | `OCALLFUNC`, `OCALLMETH`, `OCALLINTER`, `OINLCALL` | `OCALLINTER` = interface call (devirt target); `OINLCALL` = inlined body. |
| Builtins | `OAPPEND`, `OCOPY`, `ODELETE`, `OLEN`, `OCAP`, `OMAKE`, `ONEW`, `OPANIC`, `ORECOVER`, `OPRINT` | Lowered by walk to runtime calls or inline code. |
| Conversions | `OCONV`, `OCONVNOP`, `OCONVIFACE`, `OSLICE2ARR`, `OBYTES2STR`, `OSTR2BYTES`, `ORUNES2STR` | `OCONVIFACE` = interface boxing (common escape source). |
| Composite literals | `OSTRUCTLIT`, `OARRAYLIT`, `OSLICELIT`, `OMAPLIT`, `OPTRLIT` | |
| Statements | `OAS`, `OAS2`, `OASOP`, `OBLOCK`, `OIF`, `OFOR`, `ORANGE`, `OSWITCH`, `OSELECT`, `OGO`, `ODEFER`, `ORETURN`, `OBREAK`, `OCONTINUE`, `OGOTO`, `OLABEL`, `OFALL` | `OAS2` = multi-value assign. |
| Channels | `OSEND`, `ORECV`, `OCLOSE` | |
| Closures | `OCLOSURE`, `OCLOSUREREAD`, `OCFUNC` | |
| Misc / internal | `OINLMARK`, `OCHECKNIL`, `OGETG`, `ODYNAMICDOTTYPE`, `OTAILCALL` | `OINLMARK` preserves inlined-frame info. |

---

## 2. Node interfaces and key concrete types

Defined across `ir/node.go`, `ir/expr.go`, `ir/stmt.go`, `ir/func.go`, `ir/name.go`.

| Type / interface | Role |
|---|---|
| `ir.Node` (interface) | Base: `Op()`, `Type()`, `Pos()`, `Sym()`, `Edit/DoChildren` traversal. |
| `ir.Expr` (interface) | Expression nodes (have a type, produce a value). |
| `ir.Stmt` (interface) | Statement nodes. |
| `*ir.Name` | A named entity: var/const/func/type. Has `Class` (`PEXTERN`, `PAUTO`, `PPARAM`, `PPARAMOUT`, `PFUNC`) and escape flags. |
| `*ir.Func` | A function: `Body`, `Dcl`, `Inl` (inline body+cost), ABI, pragma flags. |
| `*ir.BinaryExpr` / `*ir.UnaryExpr` | `OADD`, `ONEG`, etc. |
| `*ir.CallExpr` | `OCALLFUNC`/`OCALLMETH`/`OCALLINTER`; holds `Fun`/`Args`. |
| `*ir.SelectorExpr` | `ODOT`/`ODOTPTR` field/method selection. |
| `*ir.IndexExpr` | `OINDEX`/`OINDEXMAP`. |
| `*ir.AssignStmt` / `*ir.AssignListStmt` | `OAS` / `OAS2`. |
| `*ir.RangeStmt`, `*ir.ForStmt`, `*ir.IfStmt`, `*ir.SwitchStmt`, `*ir.SelectStmt` | Control flow. |
| `*ir.ClosureExpr` + `*ir.Func` | A closure and its synthesized function. |
| `ir.Nodes` | A slice of `ir.Node` (statement lists, arg lists). |

Traversal helpers: `ir.Visit`, `ir.VisitList`, `ir.Any`, `ir.EditChildren`, `ir.DoChildren`.

---

## 3. Middle-end passes (one-line purpose each)

In approximate execution order. Drivers in `cmd/compile/internal/gc/main.go`.

| Pass | Package | Purpose |
|---|---|---|
| Unified IR read | `noder` | Build typed `ir.Node` tree from types2 export data (`LoadPackage`, unified reader). |
| Typecheck finalize | `typecheck` | Resolve remaining types, builtins, implicit conversions on IR. |
| Inlining | `inline` | Compute per-func cost; splice eligible call sites (mid-stack, PGO-aware). |
| Devirtualization | `devirtualize` | Turn `OCALLINTER` into direct calls when concrete type is known (static or PGO). |
| Escape analysis | `escape` | Whole-batch pointer-flow analysis; assign stack/heap, tag `leaking param`. |
| `walk` | `walk` | Desugar high-level ops (range/map/chan/append/type-switch) into runtime calls + near-final IR. |
| `order` | `walk` (`order.go`) | Normalize evaluation order; introduce temporaries; ensure side-effect sequencing. |
| ssagen | `ssagen` | Convert walked IR into SSA; hand off to the SSA back-end. |

Supporting machinery: `pgo`/`pgoir` (read pprof profiles, mark hot nodes), `reflectdata` (itabs, type descriptors), `staticinit` (static initialization of globals).

---

## 4. `-gcflags` diagnostics flag table

Pass via `go build -gcflags='[pattern=]flags'`. Compiler flags; see `go tool compile -help`.

| Flag | Effect |
|---|---|
| `-m` | Print optimization decisions: inlining + escape. Repeat (`-m -m`) or `-m=2` for more detail. |
| `-m=2` | Verbose escape reasoning (`flow:`, `leaks`) and inline cost accounting. |
| `-l` | Disable inlining. `-l -l` (or `-l=4`) tunes/forces more aggressive inlining (debug). |
| `-N` | Disable optimizations (used with `-l` for debugging: `-gcflags='all=-N -l'`). |
| `-S` | Print generated assembly (final codegen) to stderr. |
| `-d=...` | Debug knobs, e.g. `-d=ssa/...`, `-d=checkptr`. |
| `-W` | Dump the IR (debug parse/walk trees). |
| `-live` | Print liveness/GC-map debug info. |
| `-json=0,dir` | Emit compiler diagnostics as JSON (logopt) into `dir`. |

Module-wide vs scoped:

```bash
go build -gcflags='all=-m'          # every package (incl. std) — very noisy
go build -gcflags='-m'              # packages named on the command line
go build -gcflags='example.com/x=-m'  # only package x
```

Related (not `gc`): `-ldflags` (linker), `-asmflags` (assembler), `-pgo=FILE` / `-pgo=auto` (profile-guided optimization, top-level `go build` flag).

---

## 5. `walk` desugaring table (construct → lowering)

What `walk`/`order` rewrite high-level IR into. Runtime functions live in `src/runtime/`.

| Construct (`Op`) | Lowered to |
|---|---|
| `range` over slice/array | counted index loop with `s[i]` loads |
| `range` over map (`ORANGE`) | `runtime.mapiterinit` + loop on `runtime.mapiternext` |
| `range` over channel | loop on `runtime.chanrecv2` |
| `range` over string | loop with `runtime.decoderune` for runes |
| map read `v := m[k]` (`OINDEXMAP`) | `runtime.mapaccess1_*` |
| map read+ok `v,ok := m[k]` | `runtime.mapaccess2_*` |
| map write `m[k]=v` | `runtime.mapassign_*` (returns slot ptr) |
| `delete(m,k)` (`ODELETE`) | `runtime.mapdelete_*` |
| `make(map,...)` | `runtime.makemap` / `makemap_small` |
| `make([]T,n)` | `runtime.makeslice` (or stack array if bounded) |
| `append` (`OAPPEND`) | inline cap check + `runtime.growslice` on overflow |
| `copy` (`OCOPY`) | `runtime.memmove` / typed copy |
| channel send `ch<-v` (`OSEND`) | `runtime.chansend1` |
| channel recv `<-ch` (`ORECV`) | `runtime.chanrecv1` / `chanrecv2` |
| `close(ch)` (`OCLOSE`) | `runtime.closechan` |
| `select` (`OSELECT`) | `runtime.selectgo` + generated cases |
| type switch / assert (`OCONVIFACE`, `ODYNAMICDOTTYPE`) | itab compares, `runtime.assertE2I`, `typeAssert` |
| iface conversion `OCONVIFACE` | `runtime.convT*` (may allocate / heap box) |
| `string([]byte)` (`OBYTES2STR`) | `runtime.slicebytetostring` |
| `[]byte(string)` (`OSTR2BYTES`) | `runtime.stringtoslicebyte` |
| `panic` (`OPANIC`) | `runtime.gopanic` |
| `recover` (`ORECOVER`) | `runtime.gorecover` |
| `defer` (`ODEFER`) | open-coded defer record or `runtime.deferproc`/`deferreturn` |
| `go f()` (`OGO`) | `runtime.newproc` |
| closure creation (`OCLOSURE`) | closure struct build, `runtime.newobject` if escaping |
| `new(T)` (`ONEW`) | stack slot, or `runtime.newobject` if escaping |

---

## 6. Summary

- IR nodes are `ir.Node` discriminated by an `Op` enum across well-defined categories (names, arithmetic, calls, builtins, conversions, statements, channels, closures).
- Concrete types (`*ir.Name`, `*ir.Func`, `*ir.CallExpr`, …) implement `ir.Node`/`ir.Expr`/`ir.Stmt`.
- Middle-end order: noder → typecheck → **inline → devirtualize → escape → walk/order** → ssagen.
- Diagnostics: `-gcflags=-m[=2]` for inline/escape, `-l`/`-N` to disable opts, `-S` for asm; scope with `pattern=`.
- `walk` lowers nearly every high-level construct into a `runtime.*` call — the desugaring table is the map from "what you wrote" to "what runs".

---

## Further reading

- Go source: [`cmd/compile/internal/ir`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/ir) (`node.go`, `op_string.go`)
- [`cmd/compile` README](https://github.com/golang/go/blob/master/src/cmd/compile/README.md)
- `go tool compile -help` and `go doc cmd/compile` — authoritative flag list for your installed version
- Go source: [`cmd/compile/internal/walk`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/walk) and [`internal/escape`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/escape)
- [Compiler directives](https://pkg.go.dev/cmd/compile#hdr-Compiler_Directives)
