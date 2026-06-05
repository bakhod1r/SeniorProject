# Code Generation — Tasks

Thirteen hands-on tasks. Each can be done with the standard toolchain — no patched compiler. Work through them in order; later tasks build on earlier ones. Keep a scratch module:

```bash
mkdir cgtasks && cd cgtasks && go mod init cgtasks
```

---

## Task 1 — Dump a trivial function's assembly

Write `func Add(a, b int) int { return a + b }` with `//go:noinline`, called from `main`. Run:

```bash
go build -gcflags=-S . 2>&1 | sed -n '/main\.Add STEXT/,/^$/p'
```

**Goal:** Find the single `ADDQ BX, AX` and the `RET`. Identify which register holds `a`, which holds `b`, and where the result is.

---

## Task 2 — Disassemble the linked binary

Build a binary and disassemble the same function:

```bash
go build -o prog . && go tool objdump -s 'main\.Add' prog
```

**Goal:** Confirm the same two instructions appear, now with absolute addresses. Note the difference from Task 1's pre-link offsets.

---

## Task 3 — Watch inlining make a function disappear

Remove `//go:noinline` from `Add`, rebuild with `-gcflags=-S`, and search for `main.Add`.

**Goal:** Observe that `main.Add` no longer has its own `STEXT` — it was inlined into `main`. Confirm with `go build -gcflags='-m' .` (look for `inlining call to Add`).

---

## Task 4 — Find an intrinsic firing

Write `func Lead(x uint64) int { return bits.LeadingZeros64(x) }` (`//go:noinline`). Dump its assembly.

**Goal:** Confirm there is **no `CALL`**. On amd64 v1 find `BSRQ`; rebuild with `GOAMD64=v3` and find `LZCNT` instead.

---

## Task 5 — Break the intrinsic and watch the CALL appear

Put `bits.LeadingZeros64` behind an interface method and call it dynamically (see find-bug Bug 1). Dump the assembly of the caller.

**Goal:** See `CALL math/bits.LeadingZeros64` reappear because the interface call blocked inlining. Then fix it and confirm the intrinsic returns.

---

## Task 6 — Compare amd64 vs arm64 output

For the same `Add` function:

```bash
GOARCH=amd64 go build -gcflags=-S . 2>&1 | grep -A3 'main\.Add STEXT'
GOARCH=arm64 go build -gcflags=-S . 2>&1 | grep -A3 'main\.Add STEXT'
```

**Goal:** Note `ADDQ BX, AX` (amd64, two-operand) vs `ADD R1, R0, R0` (arm64, three-operand) and the `RET` vs `RET (R30)`.

---

## Task 7 — Read a stack frame and prologue

Write a function that calls another function (so it gets a frame), e.g. `func F(n int) int { return G(n) + 1 }` with `G` `//go:noinline`. Dump `F`.

**Goal:** Identify the `CMPQ SP, 16(R14)` + `JLS` stack-bound check, the `PUSHQ BP`/`MOVQ SP, BP` prologue, and the `POPQ BP` epilogue. Read the `$frame-argsize` on the `TEXT` line.

---

## Task 8 — Find a write barrier

Write `func Store(t *T, p *int){ t.p = p }` storing a pointer into a heap struct. Dump it.

**Goal:** Locate `CMPL runtime.writeBarrier(SB), $0` and `CALL runtime.gcWriteBarrier2(SB)`. Then change the field to an `int` and confirm the barrier vanishes (no barrier for non-pointer stores).

---

## Task 9 — Spot the morestack tail

In the `Store` (or any framed) function's `-S`, scroll to the very end.

**Goal:** Find the `CALL runtime.morestack_noctxt(SB)` tail and the `JMP 0` back to entry. Note the `rel … t=R_CALL runtime.morestack_noctxt` relocation. Explain why a `nosplit` leaf function lacks this.

---

## Task 10 — Read the GC metadata

In any function's `-S` output, find the `FUNCDATA` and `PCDATA` directives.

**Goal:** Identify `FUNCDATA $0`/`$1` (the local/argument pointer maps = stack maps) and a `PCDATA $0`/`$1`. Confirm they emit **no machine-code bytes** (no hex line follows them). Cross-check against `go tool objdump` where they don't appear at all.

---

## Task 11 — Count instructions on a hot path

Write a `Sum(s []int) int` loop. Count its real instructions two ways:

```bash
go build -gcflags=-S . 2>&1 | sed -n '/main\.Sum STEXT/,/^$/p' | grep -vE 'PCDATA|FUNCDATA|STEXT|TEXT|rel |^\s+0x[0-9a-f]+ ([0-9a-f]{2} )+'
go tool objdump -s 'main\.Sum' prog | grep -c '^\s'
```

**Goal:** Reconcile the two counts. Understand why filtering PCDATA/FUNCDATA from `-S` is necessary for an honest count.

---

## Task 12 — Eliminate a bounds check

Write a dot-product loop over two slices indexed by the same `i`. Dump it and find `runtime.panicIndex` relocations. Then reslice (`b = b[:len(a)]`) and range over `a`.

**Goal:** Watch the `panicIndex` branches disappear. Verify with `go build -gcflags='-d=ssa/check_bce/debug=1' .`.

---

## Task 13 — Measure a GOAMD64 difference

Take the `OnesCount64` function. Build and benchmark it at `GOAMD64=v1` and `GOAMD64=v2`:

```bash
GOAMD64=v1 go test -bench=PopCount -count=8 ./... | tee v1.txt
GOAMD64=v2 go test -bench=PopCount -count=8 ./... | tee v2.txt
benchstat v1.txt v2.txt
```

**Goal:** Confirm `-S` shows the software path at v1 and `POPCNT` at v2, and that `benchstat` reports a real difference (when the host supports POPCNT).

---

## Completion checklist

- [ ] Dumped and read a trivial function (`-S` and objdump).
- [ ] Watched inlining remove a function.
- [ ] Found an intrinsic firing — and broke it via an interface.
- [ ] Compared amd64 vs arm64 instruction forms.
- [ ] Identified prologue/epilogue, stack-bound check, and morestack tail.
- [ ] Located a write barrier and made it vanish.
- [ ] Distinguished PCDATA/FUNCDATA from real instructions.
- [ ] Counted hot-path instructions honestly.
- [ ] Eliminated a bounds check and verified with `check_bce`.
- [ ] Measured a GOAMD64-level codegen difference with `benchstat`.

---

## Further reading

- [A Quick Guide to Go's Assembler](https://go.dev/doc/asm)
- [Go internal ABI specification](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md)
- [GOAMD64 levels](https://go.dev/wiki/MinimumRequirements#amd64)
- Go source: [`cmd/compile/internal/ssagen/intrinsics.go`](https://github.com/golang/go/blob/master/src/cmd/compile/internal/ssagen/intrinsics.go)
- [`benchstat`](https://pkg.go.dev/golang.org/x/perf/cmd/benchstat)
