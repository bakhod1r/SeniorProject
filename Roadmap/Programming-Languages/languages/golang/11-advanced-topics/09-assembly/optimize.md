# Go Assembly — Optimize

## 1. When assembly actually wins

The Go compiler is good, often unreasonably good. Before reaching for `.s`, exhaust the easier wins:

- Profile-driven inlining (small functions inline; large ones can be split).
- Allocation reduction (`-benchmem`, pool, preallocation).
- Bounds-check elimination via clear index patterns.
- Algorithmic improvements (the wrong algorithm in assembly is still wrong).

Assembly wins meaningfully when:

1. **SIMD is available** and the loop is data-parallel (vector add, hash blocks, byte scanning).
2. **Constant-time guarantees** are required (crypto), which the compiler can't promise.
3. **A specific CPU instruction** (AES-NI, SHA-NI, PCLMULQDQ, CRC32, POPCNT) replaces dozens of scalar ops.
4. **Bounds checks are unavoidable** in Go's safety model but provably impossible in your loop — assembly skips them.

Three of those four reduce to "I have wider data parallelism than the Go scalar code can express". The fourth is a small percentage win on top of all the others.

---

## 2. Measure first — `pprof` and `objdump`

```bash
# Where does time actually go?
go test -bench=BenchmarkHash -cpuprofile=cpu.out
go tool pprof -top -cum cpu.out

# What does the compiler produce?
go build -gcflags='-S' ./pkg 2> asm.txt

# Disassemble the final binary
go tool objdump -s 'pkg\.Hash' ./binary

# Side-by-side with source
go tool objdump -gnu -s 'pkg\.Hash' ./binary
```

If `pprof` says your hot loop is 5% of total runtime, even a 10× speedup gives you 4.5%. Often not worth it. Aim for kernels at 30%+ of runtime; those are where assembly is defensible.

`-gcflags='-S'` is gold for spotting compiler hesitation — missing inlining, surprise bounds checks (`runtime.panicIndex`), unwanted allocation (`runtime.newobject`). Fixing those in Go often makes the assembly step unnecessary.

---

## 3. Bench harness

```go
func BenchmarkSumScalar(b *testing.B) {
    xs := makeData(1 << 20)
    b.SetBytes(int64(len(xs) * 8))
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = SumScalar(xs)
    }
}

func BenchmarkSumAVX2(b *testing.B) {
    xs := makeData(1 << 20)
    b.SetBytes(int64(len(xs) * 8))
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _ = SumAVX2(xs)
    }
}
```

`b.SetBytes` converts ns/op into MB/s — much easier to reason about against memory bandwidth. A scalar sum running at 10 GB/s already saturates a typical DDR4 channel; SIMD won't help. A sum at 2 GB/s has headroom.

Run with `-count=10` for stability, compare with `benchstat`:

```bash
go test -bench=Sum -benchmem -count=10 ./... | tee new.txt
benchstat baseline.txt new.txt
```

A "5% faster" reading from a single run is noise. From 10 runs with `benchstat`, it's a signal.

---

## 4. The vectorization pattern

Most SIMD loops look the same:

```
1. Compute vector_count = n / lanes
2. Compute tail_count = n % lanes
3. Vector loop: process lanes elements per iteration
4. Scalar tail: process the leftover one element at a time
```

In assembly:

```
// func SumAVX2(xs []int64) int64
TEXT ·SumAVX2(SB), NOSPLIT, $0-32
    MOVQ xs_base+0(FP), SI
    MOVQ xs_len+8(FP), CX
    VPXOR Y0, Y0, Y0           // accumulator = 0
    MOVQ CX, AX
    SHRQ $2, AX                // AX = CX / 4 (lanes=4)
    JZ   tail
vec:
    VPADDQ (SI), Y0, Y0
    ADDQ $32, SI
    DECQ AX
    JNZ vec
    // Reduce Y0 to a scalar
    VEXTRACTI128 $1, Y0, X1
    VPADDQ X0, X1, X0
    VPSHUFD $0xEE, X0, X1
    VPADDQ X0, X1, X0
    MOVQ X0, BX
    ANDQ $3, CX                // CX = remainder
    JZ done
tail:
    MOVQ (SI), R8
    ADDQ R8, BX
    ADDQ $8, SI
    DECQ CX
    JNZ tail
done:
    MOVQ BX, ret+24(FP)
    VZEROUPPER                 // avoid AVX-SSE transition penalty
    RET
```

Key practices visible here:

- **`VZEROUPPER` before returning** when you've used Y/Z registers. Mixing AVX state with surrounding SSE code costs hundreds of cycles per transition.
- **Reduce vector → scalar carefully.** `VEXTRACTI128` + `VPSHUFD` is the standard 4-lane reduction.
- **Scalar tail loop** handles non-multiple-of-lanes lengths.

---

## 5. avo for SIMD generation

For anything beyond a trivial loop, `avo` is the right tool:

```go
package main

import . "github.com/mmcloughlin/avo/build"

func main() {
    TEXT("SumAVX2", NOSPLIT, "func(xs []int64) int64")
    p := Load(Param("xs").Base(), GP64())
    n := Load(Param("xs").Len(), GP64())
    acc := YMM()
    VPXOR(acc, acc, acc)

    blocks := GP64()
    MOVQ(n, blocks)
    SHRQ(Imm(2), blocks)
    JZ(LabelRef("tail"))

    Label("vec")
    VPADDQ(Mem{Base: p}, acc, acc)
    ADDQ(Imm(32), p)
    DECQ(blocks)
    JNZ(LabelRef("vec"))

    // ... reduce, tail, return ...
    Generate()
}
```

avo handles:
- FP offset bookkeeping per parameter.
- Register allocation (`GP64()`, `YMM()` returns a fresh register).
- Mnemonic encoding including AVX-512 EVEX bytes.
- Stub `.go` file with `//go:noescape` and signatures.

`klauspost/compress`, `klauspost/reedsolomon`, `minio/sha256-simd` are all avo-generated. Reading their `gen.go` files is the fastest way to learn avo idioms.

---

## 6. Loop unrolling

Unrolling reduces loop-overhead instructions (decrement, branch) per data element. A 4× unroll:

```
loop:
    VPADDQ 0(SI), Y0, Y0
    VPADDQ 32(SI), Y1, Y1
    VPADDQ 64(SI), Y2, Y2
    VPADDQ 96(SI), Y3, Y3
    ADDQ $128, SI
    SUBQ $16, CX        // 4 vectors × 4 lanes
    JG loop
```

Four accumulators (`Y0..Y3`) feed independent dependency chains; the CPU's out-of-order engine processes them in parallel, hiding the latency of `VPADDQ` (~1 cycle, throughput limited).

Diminishing returns past 4–8×. Beyond that, you exhaust the renaming registers and saturate the dispatch slots. Bench every unroll factor; the optimum is workload-specific.

---

## 7. Register pressure

amd64 has 16 GP registers and 16 Y registers (32 in AVX-512). For most kernels, this is plenty — but tight kernels can spill, which is fatal for performance.

Indicators of pressure:
- `MOVQ` between two non-arg registers (likely a spill or move-to-temporary).
- `MOVQ AX, 0(SP)` followed later by `MOVQ 0(SP), AX` (definite spill).
- The compiler's `-gcflags='-S'` output shows the same.

Mitigations:
- Fewer accumulators in unrolling.
- Reuse registers across phases.
- Use AVX (three-operand non-destructive) to avoid `MOV` for preserving operands.

For Go-generated code, register pressure is the compiler's problem. For assembly, it's yours.

---

## 8. Latency vs throughput

Each instruction has two key numbers from Agner Fog or `uops.info`:

- **Latency** — cycles from issue to result available to a dependent instruction.
- **Throughput** — cycles between successive issues (often <1 for fast ALU ops).

A 5-latency, 1-throughput instruction means: in a dependency chain, you can issue one per 5 cycles; in independent chains, you can issue one per cycle. This is why multiple accumulators help — they create independent chains.

For `VPADDQ` on Skylake: 1 cycle latency, 0.33 cycle throughput (3 ports). Three independent `VPADDQ` per cycle is the theoretical maximum. Code that achieves this is bandwidth-bound, not compute-bound.

---

## 9. Cache effects

A 64 KiB L1, 1 MiB L2, 32 MiB L3 hierarchy means:

| Working set | Bandwidth ceiling |
|-------------|-------------------|
| ≤ 32 KiB | ~1 TB/s (L1 hits) |
| ≤ 512 KiB | ~500 GB/s (L2) |
| ≤ 16 MiB | ~150 GB/s (L3) |
| > L3 | ~30–60 GB/s (DRAM) |

A SIMD sum loop on a 1 GiB array tops out at DRAM bandwidth — say, 40 GB/s. With 8-byte int64s, that's 5 G ops/s. No vector width helps past that point; you're memory-bound.

Implications:

- For data that fits in L1 (small batches), SIMD width matters.
- For streaming data, prefetch (`PREFETCHNTA`, `PREFETCHT0`) can squeeze 10–20% out.
- For *very* large data, consider streaming stores (`MOVNTQ`) that bypass cache.

`perf stat -e cache-misses,cache-references` quantifies. If misses are <1% of references, you're cache-resident.

---

## 10. Avoid the cost of NOSPLIT misuse

`NOSPLIT` skips the stack-growth prologue (~5 instructions on amd64). For a 3-instruction function, the prologue is significant overhead. For a 100-instruction SIMD kernel, it's negligible.

Apply `NOSPLIT` only when:
- The function is a leaf (no `CALL` to anything that might `morestack`).
- The frame size is small (<792 bytes on amd64; less elsewhere).
- The function is called in tight loops.

If you have `NOSPLIT` chains (A → B → C, all `NOSPLIT`), the linker checks transitive frame sums. Adding a local variable to a deep `NOSPLIT` function can break the chain budget and fail the build elsewhere.

For long kernels that you want preemption-friendly, *don't* `NOSPLIT`. The prologue cost is in the noise.

---

## 11. Constant-time idioms

For crypto kernels, time must not depend on secrets:

```
// Constant-time conditional select: dst = mask ? a : b
// mask is 0 or -1 (all bits set)
MOVQ mask, CX
ANDQ CX, AX           // AX = mask & a
NOTQ CX
ANDQ CX, BX           // BX = ~mask & b
ORQ BX, AX            // AX = (mask & a) | (~mask & b)
```

Or use `CMOVQ`:

```
CMPQ flag, $0
CMOVQNE BX, AX        // if flag != 0, AX = BX
```

Both branches execute as a single straight-line sequence; no branch predictor leaks secret data. `crypto/subtle` documents these patterns; `golang.org/x/crypto/internal/subtle` is the modern home.

Verify the final binary has no secret-dependent branch via `go tool objdump`.

---

## 12. Real-world example: klauspost/compress

`klauspost/compress` (deflate, gzip, zstd, snappy) generates almost all its hot paths via avo:

```
gen/
├── gen_amd64.go      // avo program
├── gen_arm64.go      // avo program
├── matchlen_amd64.s  // generated
├── matchlen_arm64.s  // generated
```

The `matchlen` function — find the longest common prefix of two byte slices — uses `PCMPEQB` + `PMOVMSKB` + `BSF` to find the first non-matching byte in 16-byte chunks. Speedup over the pure-Go scalar version: ~4× on uncompressible data, ~10× on long matches.

Lessons from reading the code:

- avo `gen.go` is the source of truth; `.s` is generated.
- Every `.s` has a matching pure-Go reference in `_generic.go`.
- Tests run both implementations on random inputs and compare.
- Benchmarks include `b.SetBytes` and gate releases.

---

## 13. Real-world example: crypto/sha256

The block function processes 64-byte SHA-256 blocks. The pure-Go scalar version does 64 rounds of message schedule + compression. The AVX2 version processes **two blocks in parallel**, exploiting that two SHA-256 instances share no state during a single block.

```go
// sha256block_amd64.go (excerpt)
func block(dig *digest, p []byte) {
    if useSHA {
        blockSHA(dig, p)        // SHA-NI hardware path, ~10×
    } else if useAVX2 {
        blockAVX2(dig, p)       // AVX2 software path, ~2×
    } else {
        blockGeneric(dig, p)    // pure Go
    }
}
```

The SHA-NI path is dramatically simpler — six instructions per round (`SHA256MSG1`, `SHA256MSG2`, `SHA256RNDS2`) replace the scalar bit-manipulation sequence. When the CPU has SHA-NI (Intel Goldmont/Cannon Lake+, AMD Zen+), you get near-hardware-speed hashing.

---

## 14. Real-world example: math/big

`math/big` is multiprecision arithmetic — operations on arrays of `uint64` "words". The core kernels:

- `addVV(z, x, y)` — element-wise add with carry propagation.
- `mulAddVWW(z, x, y, r)` — multiply each `x[i]` by `y`, add `r`, propagate carry.

These are tight loops over the array, doing what the CPU's `ADC` (add with carry), `ADX` (extended ADC), `MULX` (BMI2 multiply with no flags) excel at:

```
// math/big addVV_amd64.s (sketch)
TEXT ·addVV(SB), NOSPLIT, $0-...
    // z, x, y are slices; n is len
    XORQ CX, CX           // clear carry by XOR (sets CF=0)
    MOVQ n, BP
loop:
    MOVQ (SI)(CX*8), AX
    ADCQ (DI)(CX*8), AX
    MOVQ AX, (R8)(CX*8)
    INCQ CX
    DECQ BP
    JNZ loop
    ...
```

The pure-Go version can't express "add with carry" without an extra compare per iteration. Assembly's 4×+ speedup makes `math/big` competitive with GMP for medium-size numbers.

---

## 15. Profile-guided optimization

Go 1.20+ supports PGO (profile-guided optimization): collect a CPU profile in production, feed it to the build, the compiler uses it for inlining and code layout decisions. For pure Go, this is often 5–15% on hot services.

PGO does **not** vectorize. Your assembly is still your assembly. But the *surrounding* Go code that calls your assembly can be tightened by PGO — better inlining of the dispatcher, better code layout around the `CALL`. The two layer cleanly.

---

## 16. Diminishing returns and knowing when to stop

After avo, alignment, unrolling, and constant-time hygiene, the marginal gains shrink fast. Spend two days getting 5%; spend a week getting 1%. There's a point where the engineer-hours-per-percent crosses below the value of those hours used on something else.

Signals you're past the point:
- Bench results are within `benchstat`'s noise floor.
- You're tweaking instruction scheduling that the CPU's reorder buffer handles anyway.
- The dependency chain analysis is yielding "this is bandwidth-limited" — assembly can't fix that.

Stop, ship the wins, move on. The 30% wins are the ones that pay for assembly's overhead; the last 2% rarely are.

---

## 17. Summary

Assembly optimizes by exploiting SIMD width, special instructions, and predictable execution. The workflow: measure, decide, generate with avo, test against a Go fallback, bench with `-count=10` and `benchstat`, ship. Common wins live in vectorizable loops (sums, dot products, hashing, codec inner loops) and CPU-feature-specific ops (AES-NI, SHA-NI, PCLMULQDQ). Common pitfalls: ignoring `VZEROUPPER`, mis-applying `NOSPLIT`, optimizing past memory bandwidth, hand-rolling what avo generates better. The professional posture is "let the compiler do its job, and use assembly only where the compiler structurally cannot match the hardware's potential". From here, [find-bug.md](find-bug.md) walks through what goes wrong when this discipline lapses.

---

## Further reading
- `avo`: https://github.com/mmcloughlin/avo
- Agner Fog's optimization manuals: https://www.agner.org/optimize/
- `uops.info` instruction tables: https://uops.info
- `klauspost/compress`: https://github.com/klauspost/compress
- `minio/sha256-simd`: https://github.com/minio/sha256-simd
- Go PGO guide: https://go.dev/doc/pgo
- Intel optimization reference manual: https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html
