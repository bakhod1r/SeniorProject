# Go Assembly — Professional

## 1. The production framing

Hand-written assembly in a real Go codebase is a **liability with a benefit**. The benefit: 2–10× speedups on hot kernels (crypto, codecs, compression, hashing). The liability: per-architecture maintenance, security audit obligations for crypto code, brittleness against Go's evolving ABI, and a small population of engineers who can review changes. The professional job is to weigh the two — and when assembly wins, to ship it with the same discipline you'd apply to a production database driver.

The rest of this file is what that discipline looks like: tooling, CI matrix, fallback strategy, audit posture, reproducibility, and what to do when an `.s` file becomes a bottleneck on the team.

---

## 2. Which stdlib packages ship assembly (and why)

| Package | What's in assembly | Why |
|---------|-------------------|-----|
| `crypto/aes` | AES rounds, GCM | AES-NI hardware support; ~10× scalar |
| `crypto/sha256`, `crypto/sha512`, `crypto/sha1` | Block function | SHA-NI, AVX2, SSSE3, NEON |
| `crypto/elliptic/internal/nistec` | P-256/P-384 field ops | Constant-time Montgomery multiply |
| `crypto/chacha20`, `crypto/poly1305` | Core round/MAC | SIMD over 4 or 8 blocks at once |
| `math/big` | `addVV`, `mulAddVWW` | CPU-native multiprecision arithmetic |
| `internal/bytealg` | `IndexByte`, `Equal`, `Compare` | Vectorized memmem |
| `hash/crc32`, `hash/crc64` | Slice-by-16, PCLMULQDQ | ~5× over the table approach |
| `encoding/base64` | Decoder fast path | AVX2 lookup-and-shuffle |
| `runtime` | Context switch, write barrier, atomics | ABI integration; no other way |

The pattern: small, hot, well-defined function with a known instruction set advantage. Each is paired with a pure-Go fallback for portability.

---

## 3. avo — the assembly generator

Writing 200 lines of Plan 9 AVX-512 by hand is masochistic. The community settled on [`avo`](https://github.com/mmcloughlin/avo) — a Go DSL that emits `.s` files:

```go
//go:generate go run gen.go -out add_amd64.s -stubs stub_amd64.go

func main() {
    TEXT("AddVec", NOSPLIT, "func(a, b, dst []uint64)")
    a := Mem{Base: Load(Param("a").Base(), GP64())}
    b := Mem{Base: Load(Param("b").Base(), GP64())}
    dst := Mem{Base: Load(Param("dst").Base(), GP64())}
    n := Load(Param("a").Len(), GP64())

    Label("loop")
    CMPQ(n, Imm(0))
    JE(LabelRef("done"))

    x := YMM()
    VMOVDQU(a.Offset(0), x)
    VPADDQ(b.Offset(0), x, x)
    VMOVDQU(x, dst.Offset(0))

    ADDQ(Imm(32), a.Base)
    ADDQ(Imm(32), b.Base)
    ADDQ(Imm(32), dst.Base)
    SUBQ(Imm(4), n)
    JMP(LabelRef("loop"))

    Label("done")
    RET()
    Generate()
}
```

`avo` handles:
- FP offset bookkeeping (no more `a_base+0(FP)`).
- Register allocation hints (pick a fresh GP64 or YMM).
- Label generation and scoping.
- Stub `.go` file with the right `//go:noescape` declarations.
- AVX/AVX-512 mnemonics with the right encoding bytes.

Most modern Go assembly — `klauspost/compress`, `klauspost/reedsolomon`, `minio/sha256-simd` — is generated, not hand-written. Hand-written assembly is for the runtime and for crypto code where every byte is audited.

---

## 4. The CI matrix

If your package has assembly, your CI must build and test on every supported architecture. Minimal matrix:

```yaml
# .github/workflows/test.yml
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest]
        goarch: [amd64, arm64, 386, riscv64]
        go: ['1.22', '1.23', '1.24']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: ${{ matrix.go }}
      - run: GOARCH=${{ matrix.goarch }} go vet ./...
      - if: matrix.goarch == 'amd64'
        run: go test -race ./...
      - if: matrix.goarch != 'amd64'
        run: GOARCH=${{ matrix.goarch }} go build ./...
```

Two practical realities:

- **Cross-arch testing requires emulation.** GitHub-hosted runners don't have native arm64; use `qemu-user-static` via Docker, or self-hosted ARM runners.
- **`go vet` catches FP offset mistakes** without running the code, so cross-`go vet` is a cheap correctness check even when you can't execute the binary.

---

## 5. The fallback strategy

Every assembly-shipping package needs a pure-Go fallback. The pattern:

```go
// pkg.go
package pkg

func Sum(xs []uint64) uint64 {
    return sumGeneric(xs)   // dispatcher
}
```

```go
// pkg_amd64.go
//go:build amd64

package pkg

import "internal/cpu"

func init() {
    if cpu.X86.HasAVX2 {
        Sum = sumAVX2
    } else {
        Sum = sumGeneric
    }
}

//go:noescape
func sumAVX2(xs []uint64) uint64
```

```go
// pkg_other.go
//go:build !amd64

package pkg

var Sum = sumGeneric
```

Three reasons the fallback is non-negotiable:

1. **Architectures you haven't covered.** Someone will compile your code on `darwin/arm64`, `linux/riscv64`, `js/wasm`.
2. **Old CPUs.** AVX2 dispatch on a 2010 Xeon falls through to generic. SHA-NI is post-2017.
3. **Correctness reference.** The generic version is what you test against — assembly results must match bit-for-bit.

Property-based tests against the generic version catch most assembly bugs without you reading a single instruction.

---

## 6. Reproducible builds with assembly

Assembly files are part of the source; the linker output is deterministic given:

- Same Go toolchain version (`go.sum` includes `go.mod`'s `go` directive).
- Same `GOOS`, `GOARCH`, `GOAMD64`, `GOARM` levels.
- `-trimpath` and `-buildvcs=false` to strip build-host metadata.
- No timestamps in assembly (you write none, but check generated `.s` files don't either).

```bash
go build -trimpath -buildvcs=false \
    -ldflags="-s -w -buildid=" \
    -o server ./cmd/server
sha256sum server   # same hash on every build host
```

`-buildid=` clears the link-stage build ID so the binary hash is genuinely identical. Useful for supply-chain attestation (SLSA, sigstore).

For projects that ship assembly via `go generate`, **commit the generated `.s` file**. Don't regenerate at build time — that's both slower and a vector for supply-chain attacks if the generator code is later subverted.

---

## 7. The `GOAMD64` micro-architecture levels

Go 1.18 added `GOAMD64=v1..v4`:

| Level | Includes | Default since |
|-------|----------|---------------|
| `v1` | Baseline x86-64 | always |
| `v2` | + SSE3, SSSE3, SSE4.1, SSE4.2, POPCNT | manual |
| `v3` | + AVX, AVX2, BMI1, BMI2, FMA | manual |
| `v4` | + AVX-512F, CD, BW, DQ, VL | manual |

If your service targets fleet hardware from 2017+, set `GOAMD64=v3` in the deploy. The compiler then uses AVX2 instructions in *its own* code generation, not just your assembly. Your assembly's runtime dispatch still works, but the surrounding Go code is faster too.

Similar levers exist as `GOARM=7`, `GOAMD64=v3`, `GOARM64=v8.2` etc. Production deployments usually bump these from the conservative defaults.

---

## 8. Security audit posture for crypto assembly

If you ship crypto in assembly:

1. **Maintain a "constant-time invariants" doc.** List every secret-dependent value and assert no branch or memory access depends on it.
2. **Run `dudect` or `ctgrind`** — tools that statistically check timing dependence on input.
3. **Get an external review.** Constant-time bugs are subtle; the `crypto/elliptic` code in stdlib has had multiple constant-time fixes over the years.
4. **Diff against upstream references.** Many Go crypto assembly files are ports from BoringSSL or OpenSSL; mark the source revision in a comment and re-port on upstream changes.
5. **CVE-ready release notes.** If a timing flaw lands, you need to publish a CVE, version the fix, and have a migration path.

Most teams should *not* roll their own crypto assembly. Use `crypto/...`, use `golang.org/x/crypto/...`, use a well-known library. Roll your own only if you have a specialized primitive (post-quantum, hardware-specific) and a budget for the audit treadmill.

---

## 9. Maintenance burden — the realistic accounting

When someone proposes "let's add assembly here", price it honestly:

| Cost | Recurring? |
|------|-----------|
| Initial write (avo-generated) | One-time, ~1 week for a kernel |
| Initial write (hand-rolled SIMD) | One-time, ~2–4 weeks |
| Cross-arch ports (arm64, ...) | Per-arch, ~half the initial cost |
| Fallback Go implementation + tests | One-time, ~2 days |
| CI matrix setup | One-time, ~1 day |
| Maintenance per Go release | ~half a day, mostly checking ABI didn't change |
| Audit (if crypto) | Recurring, $5–20k per major change |
| On-call when assembly crashes prod | Rare but expensive |

A team of ten engineers with one assembly module is fine. A team of fifty with twenty modules is paying the cost continuously and probably hasn't accounted for it.

The deciding question: **is the speedup worth the cost?** For a hashing function called billions of times a day at the edge, yes. For a JSON encoder used in a back-office report, no — profile first, optimize the algorithm, and only then consider SIMD.

---

## 10. When to *remove* assembly

Reverse migration is rare but worth knowing about:

- Go compiler improvements. The compiler now auto-vectorizes some patterns; assembly that was once 3× faster might be 1.1× faster, below maintenance threshold.
- Architecture pivots. Removing 32-bit `386` assembly is cheap if no production deploys use it.
- Crypto upgrades. Replacing a custom AES with `crypto/aes` (which has its own assembly) is usually a win — fewer lines to audit.

Mark assembly modules with a date and "review for removal" target. A `_amd64.s` file in the repo for five years without measurement is technical debt.

---

## 11. ABI stability across Go versions

The internal ABI (ABIInternal) is **not stable**. Go has changed it (register order, which registers are caller-saved) between versions. Your assembly survives because:

- ABI0 (stack-based) **is** stable. Stick with it for hand-written code.
- The toolchain inserts wrappers automatically; you write ABI0, callers think they're using ABIInternal.

Pin the `go` directive in `go.mod`:

```
go 1.22
```

This signals which language semantics and runtime ABI compatibility you've tested against. Bumping the directive should trigger your full test matrix.

For ABIInternal-using assembly (`func·Name<ABIInternal>(SB)`), expect breakage on Go upgrades. Rare in user code; common in runtime patches.

---

## 12. Inspecting what shipped

```bash
# What architectures does this package include?
ls -la pkg/*.s

# What does the AMD64 binary actually use?
go tool objdump -s 'pkg\.HashAVX2' ./binary | head -50

# Did the build pick up the right CPU dispatch?
GODEBUG=cpu.all=off ./binary --selftest
GODEBUG=cpu.avx2=off ./binary --selftest   # force fallback
```

`GODEBUG=cpu.X=off` (Go 1.17+) lets you disable specific CPU features at runtime. Useful for:

- Confirming your fallback works.
- Investigating "fast on one machine, slow on another".
- Reproducing a CVE in a SIMD-only code path.

In production, `GODEBUG=cpu.avx2=off` is sometimes a mitigation lever if a specific vector codepath has a bug.

---

## 13. Release engineering for assembly modules

A typical release flow:

1. **PR includes both `.s` and `_test.go` changes.** Tests assert bit-equal output vs. the pure-Go path on random inputs.
2. **CI runs cross-arch.** vet + build on all targets, test where emulation is feasible.
3. **Benchmark gates.** A regression of more than 5% on `Benchmark*AVX2` fails the merge.
4. **Tag and release.** Semver with a "minor bump on new arch added, patch on perf fix".
5. **Downstream pin notification.** Major bumps notify pinning users (vuln-db entries are appropriate for crypto).

For libraries like `klauspost/compress`, this flow is mature and visible in commit history — instructive to read through.

---

## 14. Working with assembly-heavy dependencies

If you pull in `golang.org/x/sys`, `klauspost/compress`, or similar:

- **Pin minor versions.** A patch release adding AVX-512 may regress on older hardware.
- **Cross-test on your deploy targets.** Assembly bugs are arch-specific; tests on a developer's Mac don't cover the Linux/amd64 production CPU.
- **Watch the vendor's `GOAMD64` matrix.** Some libraries require `GOAMD64=v2` for full speed; deploying with `v1` silently uses fallbacks.

---

## 15. A migration story

A real pattern: you write a hot loop in Go, profile shows 30% in that loop. You consider assembly. The professional checklist:

1. Run with `go build -gcflags='-S'` — what is the compiler producing?
2. Apply standard Go optimizations: reduce allocations, inline aggressively, use `unsafe` slice tricks, vectorization-friendly loops.
3. Re-benchmark. Often 30% becomes 10%.
4. Now ask: is 10% worth the asm? If your service has 100 servers, 10% of a $200k compute bill is $20k/year. Maintenance is likely $10k/year. Marginal but defensible.
5. Use `avo`. Hand-rolling is for last-percentage-point cases.
6. Ship with the fallback, the dispatcher, the benchmarks, the audit doc.

The discipline isn't writing assembly; it's choosing when to.

---

## 16. Summary

Production-grade Go assembly is a small, audited, well-tested set of `.s` files paired with a generator (`avo`), a pure-Go fallback, a CI matrix, and a maintenance budget. The stdlib's crypto and `internal/bytealg` are the reference for how this looks done well. Reach for assembly when you've optimized the Go and still need 2–10×; reach for `avo` rather than hand-rolling; reach for a removal review when the Go compiler catches up. From here, [optimize.md](optimize.md) covers the specific techniques that pay off, and [find-bug.md](find-bug.md) walks through realistic ways assembly goes wrong.

---

## Further reading
- `avo`: https://github.com/mmcloughlin/avo
- `klauspost/compress`: https://github.com/klauspost/compress
- BoringSSL constant-time guide: https://github.com/google/boringssl/blob/master/PORTING.md
- SLSA build provenance: https://slsa.dev
- `internal/cpu`: https://pkg.go.dev/internal/cpu
- Go ABI internal: https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md
- `GOAMD64` levels: https://go.dev/wiki/MinimumRequirements#amd64
