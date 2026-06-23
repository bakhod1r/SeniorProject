# Assembler & Object Files — Professional

This tier is about shipping and maintaining hand-written Go assembly in a real codebase: the few places it actually pays off (crypto, SIMD), how to keep `.s` files correct across `GOARCH`, the correctness contract of `//go:noescape`, the ABI traps that bite production code, leaning on `go vet`'s `asmdecl` check, vendoring concerns, and a tour of real-world cases and footguns.

## 1. Where production assembly actually lives

Hand-written assembly is a liability — unportable, hard to review, easy to get subtly wrong. It earns its place only where the payoff is large and the surface is small:

- **Cryptography.** `crypto/aes`, `crypto/sha256`, `crypto/elliptic`, and especially `golang.org/x/crypto` use assembly for AES-NI, SHA extensions, AVX2, NEON, and constant-time big-integer math. Here asm is also a *security* requirement (data-independent timing), not only speed.
- **SIMD / bulk data.** `bytes`, `strings`, `runtime.memmove`, `internal/bytealg` (IndexByte, Compare, Equal) use vector instructions to process many bytes per iteration.
- **`math` and `runtime` primitives.** `Sqrt`, atomic ops, the scheduler's `gogo`/`mcall`, signal trampolines — things with no Go expression at all.

If your candidate isn't in this category, you almost certainly want Go (often with the compiler's intrinsics) instead. The optimize tier covers the decision in depth.

## 2. Multi-arch: file naming and build constraints

A `.s` file is architecture-specific. Two mechanisms select the right one:

1. **GOOS/GOARCH file suffixes.** `add_amd64.s` is compiled only for `amd64`; `add_arm64.s` only for `arm64`. The build system applies this automatically from the filename.
2. **Build constraints** at the top of a `.s` file: `//go:build amd64 && !purego` (the `.s` file equivalent uses the same `//go:build` lines as Go).

A typical portable package has this shape:

```
add.go            // func Add(a, b int) int  (the stub, all arches)
add_amd64.s       //go:build amd64
add_arm64.s       //go:build arm64
add_generic.go    //go:build !amd64 && !arm64   — pure-Go fallback
```

`add_generic.go` provides a normal Go body for architectures you didn't hand-write; `add.go` then must *not* declare the function (you'd get a duplicate). A common idiom:

```go
// add.go
//go:build amd64 || arm64
package mathx
func Add(a, b int) int   // asm-provided
```

```go
// add_generic.go
//go:build !amd64 && !arm64
package mathx
func Add(a, b int) int { return a + b }
```

Always provide a pure-Go fallback (often gated by a `purego` build tag too) so the package builds on architectures you never optimized — and so it can be fuzzed/tested against the reference implementation.

## 3. `//go:noescape` and its correctness contract

When the compiler sees a body-less function (assembly-provided), it has **no body to analyze for escape analysis**, so it conservatively assumes any pointer argument *might escape to the heap*. That forces heap allocation at call sites and kills performance.

`//go:noescape`, placed on the **Go declaration**, asserts: *"this function does not let any of its pointer arguments escape — it does not store them anywhere that outlives the call."*

```go
//go:noescape
func xorBytes(dst, a, b *byte, n int)
```

This is a **promise you must keep**. If the assembly actually does retain a pointer (stashes it in a global, passes it to something that does), `//go:noescape` is a lie and you get **memory corruption / use-after-free** that the GC and race detector cannot easily catch. Rules:

- Only use it when the asm genuinely treats pointers as read-during-call-only.
- It does *not* mean "no allocations" — it means "args don't escape." Different claim.
- It pairs with `//go:noescape`-compatible signatures: pass `*byte`/`unsafe.Pointer`/slices whose backing array you only touch during the call.

Related pragmas you'll see near asm stubs: `//go:nosplit` (Go-side analog of the asm NOSPLIT flag), `//go:linkname` (to bind a Go name to a symbol defined elsewhere — used sparingly and is fragile across versions).

## 4. ABI traps in production

The ABI0/ABIInternal split (senior tier) is the richest source of production asm bugs:

- **Silent arg corruption.** You write `TEXT ·f(SB), NOSPLIT, $0-24` (defaults to ABI0, args on stack via `FP`) but the surrounding code expects ABIInternal. The linker inserts a wrapper and it works — *until* someone marks it `ABIInternal` for speed and the asm keeps reading `FP`. Now args come in registers but you read stack garbage.
- **Register clobbering.** Under ABIInternal you must preserve the registers the callee-save rules require and must not clobber the ones holding incoming args before you've spilled them. ABI0 (stack args) sidesteps this — another reason most hand asm stays ABI0.
- **Frame/args size drift.** If you change the Go signature (add an argument) and forget the `.s` `-argsize`, the GC's stack map is wrong → can crash during GC or stack growth. `go vet` catches the mismatch (next section); never skip it.

**Pragmatic stance:** prefer **ABI0** for hand-written asm unless you have measured that the wrapper overhead matters. ABI0 + a good test suite is far safer than chasing ABIInternal register layout by hand.

## 5. `go vet`'s `asmdecl` check

`go vet` runs an analyzer called **`asmdecl`** that cross-checks every `.s` `TEXT` against its Go prototype. It verifies:

- The argument frame size in `$frame-args` matches the Go signature.
- Each `name+offset(FP)` reference uses the correct offset, size, and (for multi-word types like strings/slices/interfaces) the correct sub-field suffix (`_base`, `_len`, `_cap`, etc.).
- Reads/writes are the right width (`MOVQ` for 8 bytes, `MOVL` for 4, ...).

```bash
$ go vet ./...
# example failure:
add_amd64.s:5: [amd64] Add: invalid offset b+4(FP); expected b+8(FP)
```

This check is **not optional discipline — it's your primary safety net.** Wire `go vet` into CI for any package containing assembly. It cannot verify the *logic* of your asm, but it catches the entire class of frame/offset/width mistakes that otherwise corrupt the stack silently. The implementation is [`golang.org/x/tools/go/analysis/passes/asmdecl`](https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/asmdecl).

## 6. Testing strategy for asm

Because asm bugs are silent, test aggressively:

- **Differential testing:** keep the pure-Go fallback and assert `asmImpl(x) == goImpl(x)` over many inputs.
- **Fuzzing:** `go test -fuzz` the asm against the reference for all sizes/alignments — alignment and tail-handling bugs love odd lengths.
- **Run on every target arch in CI:** `GOARCH=arm64 go vet`, plus actual execution under `qemu` or native runners. An `amd64`-only test suite gives false confidence about your `arm64` `.s`.
- **`-race` and `-msan`** where applicable to catch escape/aliasing mistakes from a bad `//go:noescape`.

## 7. Vendoring and module concerns

- `.s` files vendor like any other source — `go mod vendor` copies them. No special handling, but the *constraints* matter: if a dependency's asm lacks a fallback for your `GOARCH`, your build breaks. Check `purego` tags.
- Cross-compiling (`GOARCH=...` `go build`) uses the asm for the *target*, not the host — so a host-only test won't exercise it. Build all targets in CI.
- CGo is a different world; Go assembly is *not* CGo and needs no C toolchain. Don't confuse `.s` (Go/Plan 9 asm, handled by `cmd/asm`) with C `.s`/`.c` files in a `cgo` package (handled by the C compiler).

## 8. Real cases and footguns

| Case | What went wrong | Lesson |
|------|-----------------|--------|
| `internal/bytealg` tail bug (class) | SIMD loop handles 16-byte chunks; tail of `n%16` bytes mishandled at buffer end → out-of-bounds read | Always test odd lengths and near-page-boundary buffers. |
| `//go:noescape` over-promise | Asm passed a pointer to a callee that retained it; `noescape` told the compiler it was safe to stack-allocate → corruption | Only assert `noescape` when *no* pointer outlives the call. |
| ABI mismatch after Go 1.17 | Old asm assumed stack args; register ABI rollout exposed asm that read `FP` while the symbol was ABIInternal | Pin to ABI0 explicitly, or audit during ABI migrations. |
| Missing `NOPTR` on a table | A `DATA` table of offsets lacked `NOPTR`; GC scanned the bytes as pointers → crash | Flag pointer-free data `NOPTR`; put constants in `RODATA`. |
| `nosplit stack overflow` | A chain of NOSPLIT helpers exceeded the nosplit budget | Drop NOSPLIT on the deepest frame, or shrink frames. |
| Wrong relocation for global | Referenced an `(SB)` symbol with an absolute form where PIE needs PC-relative | Match the relocation form the arch/linkmode expects; let the assembler pick when possible. |

## 9. Summary

Hand-written Go assembly belongs only in crypto, SIMD, and irreducible runtime/math primitives, and even there it must ship with a **pure-Go fallback** gated by `GOARCH` suffixes and `//go:build`/`purego` constraints. Body-less stubs need `//go:noescape` to avoid forced heap allocation — but only if the assembly truly never lets a pointer escape; lying corrupts memory. The ABI0/ABIInternal split is the main production hazard: prefer ABI0 unless you've measured that wrapper overhead matters, and re-audit asm during ABI migrations. Make `go vet`'s **`asmdecl`** check mandatory in CI — it's the only automatic guard against the frame/offset/width mistakes that silently smash the stack — and back it with differential tests and fuzzing against the Go fallback on **every** target architecture.

## Further reading

- [A Quick Guide to Go's Assembler](https://go.dev/doc/asm) — including the register-ABI notes.
- [`go vet` `asmdecl` analyzer](https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/asmdecl).
- [Go compiler pragmas (`//go:noescape`, `//go:nosplit`, ...)](https://github.com/golang/go/blob/master/src/cmd/compile/internal/types2/../../doc.go) and [the unofficial pragma list](https://dave.cheney.net/2018/01/08/gos-hidden-pragmas).
- [`golang.org/x/crypto`](https://pkg.go.dev/golang.org/x/crypto) and [`crypto` stdlib](https://github.com/golang/go/tree/master/src/crypto) — real production assembly with fallbacks.
- [`internal/bytealg`](https://github.com/golang/go/tree/master/src/internal/bytealg) — multi-arch SIMD with Go fallbacks.
