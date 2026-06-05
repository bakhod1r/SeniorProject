# IR & Middle-End — Senior

## 1. The unified IR mental model

Modern `gc` (Go 1.18+) uses a single IR — the **unified IR** — produced by `cmd/compile/internal/noder`. The pipeline is:

```
parser (syntax) → types2 type-checker → unified IR export data →
noder reads it back → ir.Node tree → middle-end → ssagen → SSA → back-end
```

Two things are worth internalizing.

**Everything is an `ir.Node` with an `Op`.** The `Op` enum (`ir.OADD`, `ir.OCALLFUNC`, `ir.ORANGE`, `ir.OAS`, `ir.OINLCALL`, …) is the discriminator. Concrete node structs (`ir.BinaryExpr`, `ir.CallExpr`, `ir.Func`, `ir.Name`, `ir.AssignStmt`, …) implement the `ir.Node` interface and carry typed children. A `*ir.Func` holds the body and metadata (inline cost, escape results, ABI info). An `ir.Name` is a named entity — a variable, constant, function, or type — with class info (`PAUTO`, `PPARAM`, `PEXTERN`, …) telling you whether it is a local, a parameter, or a global.

**The unified IR is also the export/import format.** What used to be two things — the on-disk package export data and the in-memory IR — were unified. `noder.LoadPackage` / the unified reader reconstruct IR for the package being compiled *and* lazily for imported packages. This is what makes **cross-package inlining** and **cross-package devirtualization** practical: the inliner can pull a callee's body out of imported package data, not just from the current file.

---

## 2. Pass ordering of the middle-end

After IR is built, the machine-independent passes run roughly in this order (see `cmd/compile/internal/gc/main.go` and the per-package drivers):

1. **Early dead-code / typecheck finalization** — IR is fully typed.
2. **Inlining** (`inline.InlinePackage`) — decide costs, then inline eligible call sites (including mid-stack and PGO-guided).
3. **Devirtualization** (`devirtualize`) — turn interface calls into direct calls where the concrete type is known; PGO can devirtualize on profile evidence.
4. **Escape analysis** (`escape.Funcs`) — whole-batch analysis over the call graph SCCs; assigns stack/heap and records `leaking param` tags. Runs *after* inlining so it sees the post-inline shapes.
5. **`walk`** (`walk.Walk`) per function — desugars high-level ops into runtime calls and near-final IR; `order` normalizes evaluation order and introduces temporaries.
6. **ssagen** (`ssagen.Compile`) — converts walked IR into SSA, then the SSA back-end takes over.

Ordering is load-bearing. Inlining **before** escape analysis is deliberate: inlining exposes allocations to the analyzer in the caller's context, often letting them stay on the stack. Devirtualization before inlining lets a now-direct call also become an inline candidate.

---

## 3. Inlining heuristics and mid-stack inlining

The inliner has two phases:

**Cost computation.** `inline.CanInline` walks each function body once, summing node costs into a budget (`inlineMaxBudget`, ~80). Certain nodes set a "cannot inline" flag outright (`select`, some `defer`/`recover` shapes, calls to non-inlinable runtime panics, etc.). The result is stored on the `*ir.Func` as its inline body + cost.

**Call-site substitution.** `inline.InlineCalls` walks call sites; for each it checks the callee's recorded cost against the available budget at that site (mid-stack inlining tracks a per-site budget so deeply nested inlining does not explode). Eligible sites are rewritten to `ir.OINLCALL`, splicing the callee body with parameter→argument bindings and renamed locals.

**Mid-stack inlining** (Go 1.9+) removed the old "leaf functions only" restriction. A function that calls other functions can be inlined as long as its own cost fits. This is why idiomatic Go — lots of tiny accessor/wrapper methods — has low overhead: the wrappers fold away through several layers.

Heuristic refinements over time: hairiness penalties for big switches and panics, a bonus for functions that are likely to enable further optimization after inlining, and (Go 1.22+) a **call-site scoring** heuristic that prefers inlining call sites more likely to pay off.

---

## 4. Devirtualization

`cmd/compile/internal/devirtualize` converts an **interface method call** into a **direct (static) call** when the compiler can prove the dynamic type.

```go
type Reader interface{ Read([]byte) (int, error) }

func use(r Reader, b []byte) { r.Read(b) }

func main() {
    var f *os.File = openIt()
    use(f, buf) // after inlining 'use', r's concrete type is *os.File → devirtualize Read
}
```

Two flavors:

- **Static devirtualization** — when inlining or local analysis makes the concrete type evident, the interface call becomes a direct call to the concrete method, which is then itself an inline candidate. Removing the indirect call also helps branch prediction and unlocks escape analysis on the now-known body.
- **Profile-guided devirtualization (PGO)** — when a profile shows a virtual call site is dominated by one concrete type, the compiler inserts a type check plus a direct (often inlined) call for the hot type, falling back to the interface call otherwise.

Devirtualization is cheap leverage: an interface call is an indirect jump through the itab; turning the hot ones direct removes that indirection and chains into inlining.

---

## 5. How IR feeds SSA

`walk` is the bridge. By the time `walk` finishes, the IR is "lowered": no more `range` sugar, map indexing has become runtime calls, multi-value assignments are split, evaluation order is fixed, and temporaries are explicit. `ssagen` (`cmd/compile/internal/ssagen`) then walks this near-final IR and emits SSA values block by block (`ssa.NewFunc`, `state.stmt`, `state.expr`).

Key handoff facts:

- Escape decisions are already baked in: an `ir.Name` that escaped is marked so ssagen emits a `runtime.newobject` (heap) rather than a stack slot.
- Inlined bodies are already spliced; ssagen sees one flattened function, but inline frame markers are preserved so the back-end and tracebacks can attribute code to the original functions.
- From here everything is machine-independent SSA first (generic rules), then lowered to architecture-specific SSA — but that is the back-end's job (the next topic).

---

## 6. PGO-guided inlining

Profile-Guided Optimization (`-pgo`) became the default-on mechanism in Go 1.21: if a file named `default.pgo` sits next to `main`, `go build` uses it automatically; otherwise pass `-pgo=path/to/profile.pprof`.

```bash
# 1. collect a CPU profile from a representative run (net/http/pprof or runtime/pprof)
# 2. drop it as default.pgo in the main package, or:
go build -pgo=cpu.pprof ./...
```

What it changes in the middle-end:

- **Hotter inline budget.** Call sites that the profile marks hot get a larger inline budget, so functions normally just over the threshold get inlined on hot paths while staying out-of-line on cold paths. This keeps the binary from bloating everywhere.
- **Profile-guided devirtualization** (above) on hot interface calls.
- Typical reported wins are a few percent (often 2–7%) on CPU-bound services, mostly from the inline + devirtualize combination opening downstream optimization.

PGO profiles are robust to source drift — a slightly stale profile still helps and never miscompiles; the profile only influences heuristics, never correctness.

---

## 7. Summary

- **Unified IR** (`noder`): one `ir.Node`/`Op`-based representation that doubles as export data, enabling cross-package inlining and devirtualization.
- Middle-end order: **inline → devirtualize → escape → walk/order → ssagen**, and the order is deliberate (inline before escape; devirtualize before inline benefits).
- **Mid-stack inlining** makes tiny wrappers free; cost budget ~80 with hairiness penalties and modern call-site scoring.
- **Devirtualization** turns interface calls direct (statically or via PGO), chaining into inlining.
- **`walk`** lowers IR so `ssagen` can emit SSA; escape/inline results are already baked in.
- **PGO** raises inline budgets on hot sites and devirtualizes hot interface calls — a safe, profile-driven few-percent win.

---

## Further reading

- Go source: [`cmd/compile/internal/noder`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/noder)
- Go source: [`cmd/compile/internal/devirtualize`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/devirtualize)
- [Profile-guided optimization](https://go.dev/doc/pgo) — official PGO guide
- [Profile-guided optimization in Go 1.21 (blog)](https://go.dev/blog/pgo)
- [`cmd/compile` README](https://github.com/golang/go/blob/master/src/cmd/compile/README.md)
