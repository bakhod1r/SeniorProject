# Assembler & Object Files — Optimize

Assembly is the heaviest optimization tool Go gives you, and the one most likely to make your code *slower to maintain and easier to break* for no real win. This tier is about the decision: **when assembly is worth it, how to measure that it actually helped, how to keep the asm surface minimal, and how to package it so the rest of the world still builds.**

## 1. The decision: should this be assembly at all?

Start from the assumption **"no."** Reach for assembly only when *all* of these hold:

1. The function is genuinely hot (profile it — `pprof` shows it dominating CPU).
2. The Go compiler *cannot* reach the needed instructions, and intrinsics don't either.
3. The win is large (often 2×+), not a few percent.
4. The function is small and stable (you won't be editing it monthly).

Before writing a single `.s` line, exhaust the cheaper options:

| Cheaper than asm | What it gets you |
|------------------|------------------|
| Better algorithm / fewer allocations | Usually the biggest win, in pure Go |
| Compiler **intrinsics** | `math/bits` (`bits.TrailingZeros`, `OnesCount`, `RotateLeft`) lower to `BSF`/`POPCNT`/`ROL`; `sync/atomic` lowers to LOCK-prefixed ops; `math.Sqrt` → `SQRTSD` |
| `internal/cpu` feature detection + Go fast paths | Pick a code path without leaving Go |
| Bounds-check / inlining hints | Eliminate overhead the compiler already handles |

Many things people reach to asm for (popcount, rotate, byteswap, sqrt, atomics) are **already** single instructions via intrinsics. Check `math/bits` and `sync/atomic` first.

## 2. Measure against Go + intrinsics, not against naive Go

The honest baseline is *the best Go you can write*, including intrinsics — not a strawman. Benchmark all candidates:

```go
func BenchmarkXorGo(b *testing.B)   { /* pure Go loop */ }
func BenchmarkXorBits(b *testing.B) { /* Go using unsafe/word-at-a-time */ }
func BenchmarkXorAsm(b *testing.B)  { /* the .s implementation */ }
```

```bash
$ go test -run=^$ -bench=Xor -benchmem -count=10 > new.txt
$ benchstat old.txt new.txt
```

Use `benchstat` (`golang.org/x/perf/cmd/benchstat`) to get statistically meaningful deltas; a single run is noise. Demand a clear, repeatable win across realistic input sizes — including the small and odd-length cases where SIMD tail-handling often erases the gain. If asm only wins on 1 MB buffers but your real inputs are 32 bytes, it's not worth it.

## 3. Keep the assembly minimal

Every line of asm is unportable, unreviewable-by-most, and a candidate for a silent stack-smash. Minimize the surface:

- **Asm does the hot kernel only.** Argument validation, edge cases, and slow paths stay in Go. Let Go call into a small asm core.
- **One job per `.s` function.** Don't build control flow / state machines in asm; do the tight loop and return.
- **Prefer leaf functions** (no calls out). Leaf + small frame lets you use `NOSPLIT` safely and avoids ABI-call hazards entirely.
- **Prefer ABI0.** Stack-passed args (the `FP` view) are far easier to get right than register-passed ABIInternal. Only go ABIInternal if you measured the wrapper cost mattering.

A good shape: a Go function checks lengths/alignment and dispatches to `asmCore(p, n)` for the bulk, falling back to a Go loop for tiny tails.

## 4. Build tags per architecture with a Go fallback

Asm is per-`GOARCH`. To stay buildable everywhere, always ship a pure-Go fallback:

```
xor.go             //go:build amd64 || arm64   — declares the asm-backed func
xor_amd64.s        //go:build amd64
xor_arm64.s        //go:build arm64
xor_generic.go     //go:build !amd64 && !arm64 — pure-Go body
```

```go
// xor.go
//go:build amd64 || arm64
package xorx
//go:noescape
func xorBytes(dst, a, b *byte, n int)
```
```go
// xor_generic.go
//go:build !amd64 && !arm64
package xorx
func xorBytes(dst, a, b *byte, n int) { /* portable loop */ }
```

Add a `purego` tag so users can force the Go path (useful for platforms, debugging, or `wasm`):

```go
// xor_amd64.s   //go:build amd64 && !purego
// xor_generic.go //go:build (!amd64 && !arm64) || purego
```

This is exactly how `internal/bytealg` and `golang.org/x/crypto` structure their packages. The fallback is also your **differential-test oracle**: `xorBytes_asm == xorBytes_go` for all inputs.

## 5. The NOSPLIT cost/benefit

`NOSPLIT` removes the per-call stack-growth preamble — a small but real saving on a hot leaf called billions of times. The trade-off:

- **Benefit:** a handful of instructions saved per call; no chance of a mid-function stack grow.
- **Cost/risk:** consumes the limited nosplit budget; misuse → `nosplit stack overflow` at link time. Only safe for **small leaf frames** (`$0` or a few bytes, no outgoing calls).

For an asm kernel that is a tiny leaf, `NOSPLIT` is appropriate and slightly faster. Do **not** add it to grow your "optimization" if the function has a real frame or calls out — the link will fail or the runtime will break.

## 6. Don't forget DWARF / debuggability cost

Hand-written asm degrades the debugging and profiling experience: `pprof` attributes time to the asm symbol but can't show source-level detail; stack traces through asm are coarser; `delve` stepping is limited. Factor this maintenance/observability tax into the decision — it's a recurring cost, not a one-time write.

## 7. Optimization checklist

Before committing assembly:

- [ ] Profiled and confirmed this function is a real hotspot (not a guess).
- [ ] Tried `math/bits` / `sync/atomic` intrinsics and better Go first.
- [ ] Benchmarked asm vs **best Go** with `benchstat`, `-count>=10`, across realistic input sizes (incl. small/odd lengths).
- [ ] The win is large and repeatable, not marginal.
- [ ] Asm is a minimal leaf kernel; edge cases stay in Go.
- [ ] Pure-Go fallback exists for every other `GOARCH`, plus a `purego` tag.
- [ ] Differential test: asm == Go fallback over fuzzed inputs.
- [ ] `go vet` (asmdecl) passes in CI on every target arch.
- [ ] `//go:noescape` present *and truthful*; no pointer retained past the call.
- [ ] ABI0 unless register-ABI was measured to matter.
- [ ] `NOSPLIT` only on a small leaf frame; no `nosplit stack overflow`.

## 8. Summary

Default to *not* writing assembly: profile first, exhaust intrinsics (`math/bits`, `sync/atomic`) and better Go, and only proceed when a hot, small, stable function shows a *large, repeatable* win measured with `benchstat` against the best Go — including small and odd-length inputs. Keep the asm a minimal leaf kernel with edge cases in Go, prefer ABI0, use `NOSPLIT` only on tiny leaf frames, and always ship a pure-Go fallback gated by `GOARCH` suffixes and a `purego` tag so the package builds everywhere and you have a differential-test oracle. Wire `go vet`'s `asmdecl` into CI on every target architecture. Assembly is a power tool with a permanent maintenance and debuggability tax; pay it only when the measurement justifies it.

## Further reading

- [`math/bits`](https://pkg.go.dev/math/bits) and [`sync/atomic`](https://pkg.go.dev/sync/atomic) — intrinsics that often replace hand asm.
- [`benchstat`](https://pkg.go.dev/golang.org/x/perf/cmd/benchstat) — statistically sound benchmark comparison.
- [`internal/bytealg`](https://github.com/golang/go/tree/master/src/internal/bytealg) — model multi-arch asm + Go fallback structure.
- [A Quick Guide to Go's Assembler](https://go.dev/doc/asm).
- [Profiling Go Programs (pprof)](https://go.dev/blog/pprof) — confirm the hotspot before optimizing.
