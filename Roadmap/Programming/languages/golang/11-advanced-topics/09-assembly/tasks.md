# Go Assembly — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.22+. You'll need `go tool objdump`, `go vet`, and a benchmark mindset. For SIMD tasks, an amd64 machine with AVX2 (anything post-2014) is sufficient.

---

## Task 1: A trivial assembly function

Implement `func Add(a, b int64) int64` in `pkg/fast/fast_amd64.s` and a matching declaration in `pkg/fast/fast.go`.

**Acceptance criteria**
- [ ] `fast.Add(2, 3)` returns 5.
- [ ] `go vet ./pkg/fast` reports no issues.
- [ ] The `.s` file is `<20` lines, uses named FP offsets (`a+0(FP)`, `b+8(FP)`, `ret+16(FP)`), and includes `#include "textflag.h"`.
- [ ] You build with `go build ./pkg/fast` and a unit test passes.

---

## Task 2: Observe the disassembly

Take your `Add` from Task 1, build a small binary that calls it, and disassemble.

**Acceptance criteria**
- [ ] `go tool objdump -s 'fast\.Add' ./binary` shows the assembly you wrote.
- [ ] `go build -gcflags='-S' ./pkg/fast 2>&1 | grep -A 10 fast.Add` shows the same body, with prologue/epilogue annotation.
- [ ] You can identify the FP offset accesses in the disassembly and match them to your source.

---

## Task 3: Sum a slice

Implement `func Sum(xs []int64) int64` in assembly. Loop through the elements using `(SI)(AX*8)` indexing.

**Acceptance criteria**
- [ ] `Sum([]int64{1,2,3,4})` returns `10`.
- [ ] `Sum([]int64{})` returns `0`.
- [ ] You handle the slice layout correctly: `xs_base+0(FP)`, `xs_len+8(FP)`, `xs_cap+16(FP)`, `ret+24(FP)`.
- [ ] `go vet` passes.
- [ ] You write a property test comparing against a pure-Go `Sum` on 1000 random inputs.

---

## Task 4: Port to a second architecture

Take your `Sum` from Task 3 and add `pkg/fast/fast_arm64.s` with the equivalent arm64 implementation.

**Acceptance criteria**
- [ ] `GOARCH=arm64 go build ./pkg/fast` succeeds (you may need an arm64 emulator or a Mac for execution).
- [ ] The arm64 version uses `MOVD` (not `MOVQ`) and arm64 mnemonics.
- [ ] You add `pkg/fast/fast_other.go` with `//go:build !amd64 && !arm64` and a pure-Go fallback.
- [ ] `GOARCH=386 go build ./pkg/fast` succeeds via the fallback.

---

## Task 5: Use avo to generate

Replace your hand-written `Add` (Task 1) with avo-generated code.

**Acceptance criteria**
- [ ] You create `pkg/fast/_asm/gen.go` that uses `github.com/mmcloughlin/avo/build` to define `Add`.
- [ ] A `go:generate` comment runs `go run ./_asm -out ../fast_amd64.s -stubs ../stub_amd64.go`.
- [ ] `go generate ./pkg/fast` produces `fast_amd64.s` and a stub.
- [ ] The generated code is byte-identical (or near-identical) to your hand-written version.
- [ ] You commit both the generator and the generated `.s`.

---

## Task 6: Bench assembly vs pure Go

Write benchmarks for both `Sum` (assembly) and `SumGo` (pure Go).

**Acceptance criteria**
- [ ] `go test -bench=Sum -benchmem -count=10` shows both with `b.SetBytes` set to `len(xs)*8`.
- [ ] You collect results into `baseline.txt` (pure Go) and `new.txt` (assembly).
- [ ] `benchstat baseline.txt new.txt` shows the speedup (likely small for scalar; assembly here is mostly an exercise).
- [ ] You write a one-paragraph note about *why* scalar assembly isn't dramatically faster than what the compiler emits.

---

## Task 7: A SIMD vector add

Implement `func AddVec(a, b, dst []int64)` using AVX2 (`VPADDQ` over 256-bit Y registers, 4 int64s per iteration).

**Acceptance criteria**
- [ ] Handles a vector loop (4 lanes per iteration) plus a scalar tail for remainder.
- [ ] Includes `VZEROUPPER` before `RET`.
- [ ] Correctness: results match `for i := range a { dst[i] = a[i] + b[i] }` on 1000 random inputs of sizes 0, 1, 3, 4, 7, 100, 1024.
- [ ] Benchmark with `b.SetBytes(int64(len(a)*8))`. Reports ≥2× MB/s vs the scalar version on a 1 MiB input.
- [ ] You document each line of the assembly with a short comment.

---

## Task 8: CPU feature dispatch

Add a runtime dispatcher that selects between `AddVecAVX2`, `AddVecSSE2`, and `AddVecGeneric` based on `golang.org/x/sys/cpu`.

**Acceptance criteria**
- [ ] An `init()` function picks the implementation.
- [ ] `GODEBUG=cpu.avx2=off` falls through to SSE2 (or generic), verified by benchmark.
- [ ] You add a test that runs the same input through all three implementations and asserts identical output.
- [ ] You document the dispatcher in a comment.

---

## Task 9: Spot a write barrier bug

Read the assembly file for `internal/bytealg/equal_amd64.s` in the Go source tree. Then construct a deliberately broken function that stores a pointer without calling `runtime.gcWriteBarrier`.

**Acceptance criteria**
- [ ] You produce a minimal failing example (Go declaration + `.s` file).
- [ ] Under `GOGC=10` and load, you observe a runtime panic or GC complaint.
- [ ] You explain in your own words why the bug manifests, citing the hybrid write barrier.
- [ ] You fix it by calling `runtime·gcWriteBarrier(SB)` correctly.

---

## Task 10: Use `go vet` to catch a signature mismatch

Take your `Sum` (Task 3). Change the Go signature to `func Sum(xs []int64, scale int64) int64` *without* updating the assembly.

**Acceptance criteria**
- [ ] `go vet ./...` reports the mismatch (frame size, return offset, or missing arg).
- [ ] You fix the assembly to match: update `$framesize-argsize`, add `scale+24(FP)`, shift the return slot.
- [ ] `go vet` passes; the unit test passes.
- [ ] You document the experience in a `BUG.md`: which messages vet emitted, and what each one meant.

---

## Task 11: Constant-time conditional select

Implement `func CTSelect(mask uint64, a, b uint64) uint64` that returns `a` if `mask == 0xFF...FF`, `b` if `mask == 0`, with no data-dependent branches.

**Acceptance criteria**
- [ ] No `JEQ`, `JNE`, `JLT`, or other conditional branches in the body. Use `ANDQ`, `NOTQ`, `ORQ`, or `CMOVQ`.
- [ ] `go tool objdump` confirms no conditional branches.
- [ ] You write a test that runs both branches at full speed and asserts the timing variance between `mask=0` and `mask=0xFF...FF` is below 5% of mean — i.e., constant-time in practice.
- [ ] You note the existence of `crypto/subtle.ConstantTimeSelect` and explain when you'd use it instead.

---

## Task 12: Find a bug via objdump

Build a release binary of `klauspost/compress` or any other assembly-using library. Disassemble one of its hot kernels.

**Acceptance criteria**
- [ ] You identify which CPU instruction sets it uses (SSE4, AVX2, AVX-512?).
- [ ] You locate a `VZEROUPPER` (or note its absence with reasoning).
- [ ] You identify the loop structure: vector body, scalar tail.
- [ ] You write a one-page summary of what the assembly does, in your own words.

---

## Task 13: A `//go:noescape` regression

Take an assembly function that operates on `[]byte`. Remove the `//go:noescape` annotation, run benchmarks with `-benchmem`, and observe the allocation behavior.

**Acceptance criteria**
- [ ] Without `//go:noescape`, `-benchmem` shows allocations per call.
- [ ] With `//go:noescape`, allocations drop to zero (for stack-allocatable slice arguments).
- [ ] You explain in a comment why this happens — the compiler can't see the assembly body and pessimizes.
- [ ] You add a `BenchmarkAllocations` that fails CI if allocs/op exceeds zero, as a regression gate.

---

## Submission

Each task should produce:

1. The code you wrote (`.s` and `.go`).
2. A short writeup (5–15 lines) of what you observed.
3. Benchmark output, `go vet` output, or disassembly excerpts where relevant.

These artifacts are what turn "I've read about Go assembly" into "I can read and write it competently". The first six tasks are foundation; 7–9 are intermediate; 10–13 are the kind of work a senior engineer ships in production.

---

## Further reading
- [middle.md](middle.md), [senior.md](senior.md), [optimize.md](optimize.md), [find-bug.md](find-bug.md), [interview.md](interview.md)
- `avo` examples: https://github.com/mmcloughlin/avo/tree/master/examples
- Go source `internal/bytealg`: https://github.com/golang/go/tree/master/src/internal/bytealg
- `klauspost/compress` for SIMD-by-example: https://github.com/klauspost/compress
