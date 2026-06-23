# Code Generation — Optimize

Squeezing a hot path at the codegen level. The premise: you have a profile (`go test -cpuprofile`, production pprof) pointing at a specific function, and you want to make the *generated instructions* better — or prove they're already optimal. Always measure; never optimize on a hunch.

---

## 1. First, confirm the intrinsics fired

Before any clever work, make sure the cheap wins are present. Intrinsics turn library calls into single instructions; a missing one is free performance left on the table.

```bash
go build -gcflags=-S ./pkg 2>&1 | grep -A8 'pkg\.Hot STEXT'
```

Look for the expected instruction:

| Source | Want to see | Bad sign |
| --- | --- | --- |
| `bits.OnesCount64` | `POPCNT` (GOAMD64≥v2) | `CALL math/bits.OnesCount64` |
| `bits.LeadingZeros64` | `LZCNT` (v3) or `BSRQ` (v1) | a `CALL` |
| `bits.RotateLeft64` | `ROLQ` | a `CALL` |
| `atomic.AddInt64` | `LOCK XADDQ` | a `CALL` |
| `math.Sqrt` | `SQRTSD` | a `CALL` |

If you see a `CALL`, the intrinsic was blocked — usually by an interface boundary, a `//go:noinline`, or an inadequate `GOAMD64`. Fix that *first*; it's often a larger win than anything below.

---

## 2. Reduce spills (register pressure)

Spills (`MOVQ reg, n(SP)` then `MOVQ n(SP), reg`) appear when a region needs more live values than there are registers. On a hot loop they add memory traffic.

Levers:

- **Shorten live ranges.** Compute and consume values close together so fewer overlap.
- **Avoid keeping many values live across a call.** A call clobbers caller-saved registers, forcing the allocator to spill everything live around it. Hoist calls out of the inner loop, or compute call args last.
- **Split the function.** A smaller function has fewer simultaneous live values; the inliner can still fuse it back if profitable.
- **Use fewer wide temporaries.** Large structs passed by value occupy several registers each.

Confirm by diffing `-S` before/after and counting `(SP)` spills in the loop body. Then confirm it *matters* with `pprof -disasm` — if the spill never showed up as samples, leave it alone.

---

## 3. GOAMD64 / GOARM64 levels

Raising the microarchitecture baseline lets the compiler use newer instructions across the whole binary.

```bash
GOAMD64=v3 go build -o app ./cmd/app    # AVX2, BMI2, LZCNT, FMA
```

| Level | Notable codegen gains |
| --- | --- |
| `v2` | `POPCNT`, better atomics, SSE4 |
| `v3` | `LZCNT`/`TZCNT`, AVX2 vectorization opportunities, FMA, `MOVBE` |
| `v4` | AVX-512 |

The trade: the binary won't start on CPUs below the level (checked at startup). Choose the highest level your *entire* fleet supports, pin it in CI, and re-verify intrinsics under that level. arm64 has the analogous `GOARM64` (e.g. `v8.0`/`v9.0`).

---

## 4. Branch layout and predictability

The compiler lays out blocks so the common path falls through (no taken branch) and cold paths (panics, error returns, slow cases) are pushed to the end. You can help it:

- **Make the hot path the straight-line one.** Put the rare condition in the `if`, return/continue early, leave the common case as fall-through.
- **Hoist invariant checks out of loops** so the loop body is branch-light.
- **Avoid unpredictable data-dependent branches** in tight loops; sometimes a branchless form (a `CMOV`-friendly select, or arithmetic) is faster. Check whether the compiler already emitted `CMOVxx` (it does for simple `min`/`max`/select patterns).

Inspect block order in `-S`: cold blocks (with `runtime.panic…` relocations) should sit after the `RET`, reached only by forward jumps.

---

## 5. Eliminate bounds checks on the hot path

Each `s[i]` may carry a `CMPQ`/`JCC` to `runtime.panicIndex`. The compiler removes them when it can prove the index is in range (BCE). Help it:

```go
// Before: two separate bounds checks per iteration
for i := 0; i < len(a); i++ { sum += a[i] + b[i] }

// After: reslice so both share a provable length; range gives a proven index
b = b[:len(a)]
for i := range a { sum += a[i] + b[i] }
```

Audit with:

```bash
go build -gcflags='-d=ssa/check_bce/debug=1' ./pkg   # reports remaining checks
```

A common idiom is `_ = s[n-1]` early to hoist a single check the compiler can reuse. Verify the `panicIndex` relocations disappeared from `-S`.

---

## 6. When to drop to assembly (and the cost)

Hand-written `.s` is the last resort, justified only when:

- A profile proves the function dominates and the win is large (typically SIMD: process 4–8 lanes per instruction with AVX2/NEON).
- The compiler demonstrably can't match it (Go does **not** auto-vectorize).

The cost is real and permanent:

- **Unportable** — one `.s` per arch, plus a pure-Go fallback.
- **Unchecked** — no type safety across the boundary; wrong `(FP)` offsets read garbage (`go vet`'s `asmdecl` catches some).
- **ABI-fragile** — ABI0 stack layout, must preserve `g`/`BP`.
- **Frozen** — it won't benefit from future compiler improvements, and may *lose* to them in a few releases.

Benchmark the assembly version against the Go version on the target arch under `benchstat`; keep it only if the win survives realistic inputs.

---

## 7. Measuring: objdump + benchmarks together

The loop that closes the optimization:

```bash
# baseline
go test -run=^$ -bench=Hot -count=10 -cpuprofile=base.out ./pkg | tee base.txt

# ...make a change...

go test -run=^$ -bench=Hot -count=10 -cpuprofile=new.out ./pkg | tee new.txt
benchstat base.txt new.txt           # is the delta real and significant?

# why? attribute time to instructions
go tool pprof -disasm='pkg\.Hot' pkg.test new.out
```

Rules:

- **`benchstat` decides** whether a change is significant; a single run is noise.
- **`pprof -disasm`** tells you *which instruction* costs — spill reload, bounds branch, a stray `CALL`.
- **Pin GOAMD64/GOARCH** identical across baseline and new, matching production.
- Disable frequency scaling / use a quiet machine; otherwise the numbers lie.

---

## 8. Checklist

1. Profile points at this function (don't optimize blind).
2. Intrinsics confirmed via `-S` (no stray `CALL`).
3. `GOAMD64`/`GOARM64` set to the production level and pinned in CI.
4. Hot-path bounds checks eliminated (`check_bce` clean, no `panicIndex`).
5. Spills on the hot path reduced — and confirmed they showed up as samples.
6. Branch layout: common path falls through, cold blocks after `RET`.
7. Assembly only if a profile proves it and the win survives `benchstat`.
8. Verified with `benchstat` over `-count≥10`, same arch/flags as prod.

---

## 9. Summary

- Start by **confirming intrinsics fired** — the biggest cheap win.
- **Reduce register pressure** (shorter live ranges, fewer values across calls) to cut spills *that actually show up in the profile*.
- Raise **GOAMD64/GOARM64** to unlock `POPCNT`/`LZCNT`/AVX/FMA, pinned in CI.
- Help **BCE** and **branch layout** so the hot path is straight-line and check-free.
- Drop to **assembly** only with profiler proof; it's unportable, unchecked, and frozen.
- Close the loop with **objdump/pprof-disasm + benchstat** on the production arch.

---

## Further reading

- [GOAMD64 microarchitecture levels](https://go.dev/wiki/MinimumRequirements#amd64)
- [Bounds Check Elimination](https://go101.org/article/bounds-check-elimination.html)
- [`benchstat` documentation](https://pkg.go.dev/golang.org/x/perf/cmd/benchstat)
- [`go tool pprof` disassembly](https://github.com/google/pprof/blob/main/doc/README.md)
- [A Quick Guide to Go's Assembler](https://go.dev/doc/asm)
- Go source: [`cmd/compile/internal/ssa`](https://github.com/golang/go/tree/master/src/cmd/compile/internal/ssa) — passes incl. BCE and branch elimination
