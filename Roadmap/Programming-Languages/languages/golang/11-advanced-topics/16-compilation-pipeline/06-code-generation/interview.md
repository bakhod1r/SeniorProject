# Code Generation — Interview

Twenty questions and answers on register allocation, the Go ABI, intrinsics, the inspection tooling, GC metadata, and write barriers. Answers are short enough to say out loud but precise.

---

### Q1. What does the code-generation stage of the Go compiler actually do?

It turns **lowered, arch-specific SSA** into real machine instructions. Concretely: register allocation (`ssa/regalloc.go`), then per-arch instruction emission (`ssaGenValue`/`ssaGenBlock` in `cmd/compile/internal/amd64`, `arm64`, …) that builds a list of `obj.Prog`, which the obj backend assembles into bytes plus relocations for the linker.

---

### Q2. How do you dump the assembly for a function?

`go build -gcflags=-S .` prints the compiler's listing (to **stderr**). `go tool objdump -s 'regexp' binary` disassembles a linked binary. `go tool compile -S file.go` works for a single self-contained file. `go tool pprof -disasm` annotates disassembly with profile samples.

---

### Q3. What's the difference between `-S` output and `objdump` output?

`-S` is **pre-link**: branch targets are byte offsets within the function, addresses are zero-based, and it includes PCDATA/FUNCDATA and `rel` relocation notes. `objdump` is **post-link**: absolute addresses, resolved branch targets, no PCDATA/FUNCDATA. Don't compare addresses across them.

---

### Q4. Describe Go's register-based calling convention.

Since Go 1.17, **ABIInternal** passes the first integer/pointer arguments in registers — `AX, BX, CX, DI, SI, R8, R9, R10, R11` on amd64; `R0`–`R15` on arm64 — and floats in `X*`/`F*` registers. Results come back in the same registers. Overflow spills to the stack. It replaced the old all-on-the-stack scheme and made calls noticeably cheaper.

---

### Q5. What is ABI0 and when is it used?

ABI0 is the older, **stack-based** convention: all arguments and results live on the stack, addressed as `name+offset(FP)`. It's used at the **assembly boundary** — hand-written `.s` files default to ABI0 — and it's the *stable*, documented ABI, whereas ABIInternal is internal and may change between releases. The linker inserts wrappers to bridge the two.

---

### Q6. What is the `g` register?

A reserved register holding the **current goroutine pointer** — `R14` on amd64, `R28` on arm64 under ABIInternal. The runtime relies on it for stack-bound checks, preemption, and GC. Clobbering it in assembly corrupts the runtime.

---

### Q7. Walk through a function prologue.

For a splittable, framed function: `CMPQ SP, 16(R14)` compares the stack pointer against the goroutine's stack limit; `JLS` jumps to the morestack tail if the stack is too small; then `PUSHQ BP` / `MOVQ SP, BP` saves and sets the frame pointer. The epilogue does `POPQ BP` then `RET`. Tiny leaf functions are `nosplit`/`NOFRAME` and skip all of this.

---

### Q8. What does `morestack` do?

When the prologue check finds insufficient stack, the function jumps to a tail that spills live registers and calls `runtime.morestack_noctxt`, which **grows the goroutine's stack** (copies it to a larger one, adjusting pointers), then re-enters the function. This is why Go goroutines start with tiny stacks.

---

### Q9. What is register allocation and what is spilling?

Register allocation maps SSA values onto the finite hardware registers (Go uses a fast linear-scan-style allocator in `ssa/regalloc.go`). When more values are live simultaneously than there are registers, the allocator **spills** one to a stack slot (`MOVQ reg, n(SP)`) and reloads it later. Spills add memory traffic and grow the frame.

---

### Q10. How would you reduce spills on a hot path?

Lower register pressure: shorten live ranges, avoid keeping many values live across a call (calls clobber caller-saved registers), split a large function, and avoid wide by-value struct temporaries. But verify with `pprof -disasm` that the spill actually costs samples before optimizing — many spills are harmless.

---

### Q11. What are compiler intrinsics? Give examples.

Intrinsics (`cmd/compile/internal/ssagen/intrinsics.go`) replace certain standard-library *calls* with SSA ops that lower to **single instructions**. Examples: `bits.OnesCount64` → `POPCNT`, `bits.LeadingZeros64` → `BSRQ`/`LZCNT`, `bits.RotateLeft64` → `ROLQ`, `atomic.AddInt64` → `LOCK XADDQ`, `math.Sqrt` → `SQRTSD`.

---

### Q12. Why might an intrinsic *not* fire?

Three common reasons: (1) it's behind an **interface or no-inline boundary** so the body isn't inlined to the call site; (2) the target **GOAMD64 level** is too low (e.g. `POPCNT` needs v2, `LZCNT` needs v3); (3) the type isn't the intrinsic's exact type. You confirm by grepping `-S` for the expected instruction vs a `CALL`.

---

### Q13. What is GOAMD64 and how does it affect codegen?

`GOAMD64` (v1–v4) sets the x86-64 feature baseline the compiler may assume. Higher levels unlock newer instructions: v2 → `POPCNT`/SSE4, v3 → `LZCNT`/`TZCNT`/AVX2/FMA, v4 → AVX-512. The binary refuses to start on a CPU below the chosen level. arm64 has the analogous `GOARM64`.

---

### Q14. What are PCDATA and FUNCDATA?

Side tables emitted with the code that carry **no machine instructions**. `FUNCDATA` attaches per-function tables — most importantly the **stack maps** (`$0`/`$1`, which slots hold pointers). `PCDATA` is PC-indexed and **selects which row** of a FUNCDATA table applies at the current instruction (e.g. the live stack-map index, which changes as the function runs). The runtime uses them for precise GC scanning, stack growth, and tracebacks.

---

### Q15. Why does Go need stack maps?

For a **precise** garbage collector. When a goroutine is stopped, the GC must know exactly which stack slots and argument slots hold pointers so it scans real references and ignores non-pointer data. Stack maps (via FUNCDATA/PCDATA) provide that bitmap, indexed by program counter — enabling precise, non-conservative collection and accurate stack copying during growth.

---

### Q16. What is a write barrier and who inserts it?

A **write barrier** is code around a pointer store that informs the concurrent GC of the new reference so it doesn't miss a reachable object. The **compiler** inserts it (SSA `writebarrier` pass), not the programmer. In assembly it appears as `CMPL runtime.writeBarrier(SB), $0` gating a `CALL runtime.gcWriteBarrier2(SB)`; when the GC's barriers are off, it falls through to a plain store. Only typed pointer stores to heap-reachable locations get them.

---

### Q17. Why can hiding a pointer in a `uintptr` be dangerous?

`uintptr` is **not** a pointer type, so the compiler emits a plain store with **no write barrier** and the GC doesn't track it; nor does it keep the pointee alive or update it if the object moves. If a `uintptr` is the only reference, the object can be collected. Always keep references as `*T`/`unsafe.Pointer` and use `runtime.KeepAlive`.

---

### Q18. What's the difference between `ssaGenValue` and `ssaGenBlock`?

Both are in the per-arch compiler backend. `ssaGenValue` translates one lowered SSA **value** (e.g. `OpAMD64ADDQ`) into one or more `obj.Prog` instructions. `ssaGenBlock` translates an SSA **block** boundary into control flow — conditional/unconditional jumps and the `RET`.

---

### Q19. What are `obj.Prog` and `obj.LSym`?

`obj.Prog` (in `cmd/internal/obj`) is one **symbolic instruction**: opcode `As`, operands `From`/`To`, and a `Link` to the next — registers resolved but bytes and final addresses not yet. `obj.LSym` is a **linker symbol** (function or global); a function's `obj.Prog` list and metadata hang off it. The obj backend assembles the list into bytes and emits relocations.

---

### Q20. You read assembly on your Mac and it looks great, but production is slow. What happened?

Your Mac builds **arm64** natively; production is likely **linux/amd64** at some `GOAMD64` level, where the *same source* compiles to different instructions (e.g. `CLZ` on arm64 vs a `BSRQ`+fix-up on amd64 v1). Always cross-build to the deployment target — `GOOS=linux GOARCH=amd64 GOAMD64=vN go build -gcflags=-S` — before drawing conclusions.

---

### Q21. In Go assembly syntax, which operand is the destination?

The **right** one. `ADDQ BX, AX` means `AX = AX + BX`; `MOVQ AX, ret+8(FP)` stores `AX` into the result slot. This is Plan 9 / AT&T-style ordering (source, then destination), the opposite of Intel syntax. It's a frequent source of confusion when reading or writing `.s` files.

---

### Q22. What do `(SB)`, `(FP)`, and `(SP)` mean in Go assembly?

They're **pseudo-registers**. `SB` is the *static base* — `sym(SB)` names a global symbol or function address. `FP` is the *frame pointer* for **arguments**: `x+0(FP)` is the first argument. `SP` (the pseudo `SP`, distinct from the hardware SP) addresses **local** stack slots. The assembler resolves these to real addressing modes; mixing up `FP` (args) and `SP` (locals) is a classic bug.

---

### Q23. Why does Go not auto-vectorize, and what do you do about it?

The `gc` compiler's SSA backend does scalar instruction selection and doesn't generate SIMD loops automatically. If you need SSE/AVX/NEON, you write a `.s` kernel (ABI0, careful `(FP)` offsets, preserve `g`/`BP`) and call it from a body-less Go function, with a pure-Go fallback for other arches. It's a last resort justified by a profile, because it's unportable, unchecked, and frozen against future compiler improvements.

---

### Q24. How do relocations connect codegen to the linker?

When the obj backend assembles an instruction whose target address isn't known yet — a call to another function, a reference to a global, the write-barrier flag — it emits an `obj.Reloc` instead of final bytes: a record of *where* to patch, *what type* (`R_CALL`, `R_PCREL`, `R_ADDR`), and *which symbol*. In `-S` these show as `rel off+sz t=… sym+add` lines. The linker resolves them once every symbol's final address is known.

---

## Further reading

- [Go internal ABI specification](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md)
- [A Quick Guide to Go's Assembler](https://go.dev/doc/asm)
- Go source: [`cmd/compile/internal/ssa/regalloc.go`](https://github.com/golang/go/blob/master/src/cmd/compile/internal/ssa/regalloc.go)
- Go source: [`cmd/compile/internal/ssagen/intrinsics.go`](https://github.com/golang/go/blob/master/src/cmd/compile/internal/ssagen/intrinsics.go)
- Go source: [`runtime/funcdata.h`](https://github.com/golang/go/blob/master/src/runtime/funcdata.h)
- [GOAMD64 microarchitecture levels](https://go.dev/wiki/MinimumRequirements#amd64)
