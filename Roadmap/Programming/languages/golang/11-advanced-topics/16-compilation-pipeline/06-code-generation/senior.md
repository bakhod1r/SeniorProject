# Code Generation — Senior

## 1. Register allocation: the mental model

After SSA is lowered to arch-specific ops, every value still names an *abstract* result; the **register allocator** (`cmd/compile/internal/ssa/regalloc.go`) maps those values onto the finite set of hardware registers. Go uses a fast, linear-scan-style allocator that processes blocks in a layout order and, within each block, decides for every value which register (if any) holds it.

Key concepts:

- **Liveness.** A value is *live* from its definition to its last use. Two values whose live ranges do not overlap can share a register.
- **Spilling.** When more values are simultaneously live than there are registers, the allocator **spills** the least-needed value to a stack slot and reloads it later. Spills cost a store + a load and enlarge the frame. Reducing spills is a core optimization lever (see the optimize tier).
- **Register classes.** Integer/pointer values go in GP registers; floating-point values go in the XMM/V registers. The two pools are allocated separately.
- **Calling-convention constraints.** At a call site, arguments must be in the ABI-mandated registers and caller-saved registers may be clobbered, so the allocator must shuffle values into place and preserve anything live across the call (often by spilling).
- **Reserved registers.** Some registers are off-limits: `SP` (stack pointer), `BP` (frame pointer, when frame pointers are enabled), and the `g` register (`R14` amd64 / `R28` arm64). The allocator never assigns these to ordinary values.

You can see spilling directly. A function with many simultaneously-live values, or one that calls others mid-computation, will show `MOVQ <reg>, <n>(SP)` (spill) and a later `MOVQ <n>(SP), <reg>` (reload). If a hot loop is full of these, the allocator ran out of registers there.

The allocator runs *after* SSA scheduling and *before* `obj.Prog` emission, so by the time `ssaGenValue` runs, every value already knows its assigned register (`v.Reg()`). Two more details worth carrying in your head:

- **Phi resolution at block edges.** SSA φ-nodes (which merge values from predecessor blocks) don't correspond to real instructions; the allocator must emit `MOV`s on the incoming edges so the merged value ends up in the right register on every path. You sometimes see these as small register shuffles right after a label.
- **Caller-saved vs callee-saved.** Go's ABIInternal treats most registers as **caller-saved**: a call may clobber them, so anything live across a call is spilled by the allocator. There is no large callee-saved set to lean on, which is one reason call-heavy code shows more spills than you might expect from a register-rich ISA.

---

## 2. From lowered SSA to `obj.Prog`: the arch backend

Each architecture has a backend package — `cmd/compile/internal/amd64`, `arm64`, etc. — with two central functions:

- **`ssaGenValue`** translates one lowered SSA value into one (or a few) `obj.Prog` instructions. A `OpAMD64ADDQ` SSA value becomes an `ADDQ` `obj.Prog`; an `OpAMD64MOVQload` becomes a `MOVQ` from memory.
- **`ssaGenBlock`** translates an SSA *block* (the control-flow boundary) into branches: conditional/unconditional jumps, the `RET`, etc.

The compiler walks the scheduled, register-allocated SSA and calls these to build a **linked list of `obj.Prog`** — the architecture-neutral instruction representation. An `obj.Prog` (from `cmd/internal/obj`) holds an opcode (`As`), source/destination operands (`From`, `To` of type `obj.Addr`), and a `Link` to the next instruction. It is *symbolic*: registers and offsets are filled in, but final byte encodings and branch targets are not.

```
lowered SSA value  →  ssaGenValue  →  obj.Prog (As=AADDQ, From=BX, To=AX)
SSA block          →  ssaGenBlock  →  obj.Prog (As=AJMP / ARET / cond branch)
```

---

## 3. `obj.LSym` and how codegen feeds the assembler

Every function and global becomes an **`obj.LSym`** (linker symbol). The `obj.Prog` list for a function hangs off its `LSym`. Once the whole function's `Prog` list is built, the compiler hands it to the **obj-layer assembler backend** for that arch (`cmd/internal/obj/x86`, `cmd/internal/obj/arm64`, ...). That backend:

1. **Assembles** each `obj.Prog` into machine-code bytes (the `48 01 d8 c3` you saw for `Add`).
2. Resolves **branch offsets** within the function.
3. Emits **relocations** for anything whose final address is unknown until link time — calls to other functions, references to globals, the write-barrier flag. You see these in `-S` output as `rel` lines:

```
rel 25+4 t=R_CALL runtime.gcWriteBarrier2+0
rel 52+4 t=R_CALL runtime.morestack_noctxt+0
```

`R_CALL` means "patch this 4-byte field at offset 25 with the PC-relative address of `runtime.gcWriteBarrier2`." The **linker** later fills these in.

So the division of labor is: the *compiler front/middle/SSA* produces lowered SSA; *codegen* (`ssaGenValue`/`ssaGenBlock` + regalloc) produces the `obj.Prog` list; the *obj backend* turns it into bytes + relocations inside the object file; the *linker* resolves relocations across all objects.

One reason this layering matters: the `obj` layer is shared between the *compiler* and the *assembler* (`go tool asm`). When you hand-write a `.s` file, `go tool asm` parses your Plan 9 assembly into exactly the same `obj.Prog` list that `ssaGenValue` would produce, and the same obj backend assembles it. That is why compiler-generated and hand-written assembly interoperate seamlessly — they converge on one representation before bytes are emitted.

---

## 4. ABIInternal vs ABI0

Go has two ABIs and you must know which is in force:

| | **ABI0** | **ABIInternal** |
| --- | --- | --- |
| Argument passing | All on the **stack** (FP-relative) | First N args in **registers** |
| Used by | Hand-written `.s` assembly, the assembly↔Go boundary | Normal Go-to-Go calls (since Go 1.17) |
| Result passing | Stack | Registers |
| Stability | Stable, documented | Internal, may change between releases |

When a Go function is called from assembly (or vice versa), the linker inserts an **ABI wrapper** that shuffles arguments between the stack layout (ABI0) and the register layout (ABIInternal). This is why a runtime assembly function declared `TEXT runtime·foo(SB)` defaults to ABI0 and why you sometimes write `TEXT runtime·foo<ABIInternal>(SB)` to opt a hand-written stub into the register ABI.

The `-S` `TEXT` line tells you: an `ABIInternal` tag means register ABI; its absence (or an explicit `ABI0`) means stack-based. Symbols can even exist in *both* ABIs (you'll see `main.foo` and an `<ABIInternal>` variant), with the wrapper bridging them.

Why two ABIs at all? ABIInternal is fast (register passing) but the compiler team explicitly reserves the right to change it every release — the register order, the spill rules, all of it. Hand-written assembly and cgo boundaries need a **stable** contract that won't break when you upgrade Go, and that is ABI0. The cost of a wrapper at the boundary is tiny compared to freezing the internal ABI forever. You can inspect which wrappers exist with `go tool nm` (look for the `abi.RegArgs`-style shims) or by noticing duplicate `TEXT` entries for one source function in `-S`.

---

## 5. PCDATA, FUNCDATA, and stack maps

The instructions are only half the story. The runtime's garbage collector and stack-growth machinery need to know, **at any program counter**, which stack slots and registers hold live pointers. That metadata is emitted alongside the code as `PCDATA` and `FUNCDATA`:

- **`FUNCDATA`** attaches a *table* to the function. The important ones are the **stack maps** (`FUNCDATA $0, gclocals·…` and `FUNCDATA $1, …`): bitmaps describing which local/argument slots contain pointers, so the GC can scan a stopped goroutine's frame precisely. `FUNCDATA $5`/`$6` (`arginfo`/`argliveinfo`) describe argument liveness for tracebacks.
- **`PCDATA`** is a PC-indexed table that *selects which row* of a FUNCDATA table applies at the current instruction. `PCDATA $0` (stack-map index) and `PCDATA $1` (unsafe-point / preemption) change as the function progresses, because the set of live pointers changes from instruction to instruction.

```
FUNCDATA	$0, gclocals·g5+hNtRBP6YXNjfog7aZjQ==(SB)   // local pointer map
FUNCDATA	$1, gclocals·g5+hNtRBP6YXNjfog7aZjQ==(SB)   // arg pointer map
PCDATA	$0, $-2                                         // stack-map index here
```

None of these emit machine instructions; they build side tables the runtime consults. They are the reason Go can have a **precise, non-moving-then-moving** GC and **growable stacks** without conservative scanning.

---

## 6. Write barriers inserted for the GC

The compiler — not the programmer — inserts **write barriers** around pointer stores so the concurrent GC never loses track of a reachable object. Look at `Store(t *T, p *int) { t.p = p }`:

```
	CMPL	runtime.writeBarrier(SB), $0   // is the write barrier on?
	JEQ	plainstore                      // off → just store
	MOVQ	(AX), CX
	CALL	runtime.gcWriteBarrier2(SB)     // on → record via barrier
	MOVQ	BX, (R11)
	MOVQ	CX, 8(R11)
plainstore:
	MOVQ	BX, (AX)                        // the actual pointer store
```

The pattern is: cheaply test the global `runtime.writeBarrier` flag; when the GC has barriers enabled, route the store through `runtime.gcWriteBarrier2` so the collector observes the new pointer; otherwise do a plain store. Barriers are emitted only for *pointer* writes to heap-reachable locations — writing an `int` field, or a pointer that provably stays on the stack, needs no barrier. The relevant lowering happens in the SSA `writebarrier` pass before codegen.

---

## 7. Summary

- **Register allocation** (`ssa/regalloc.go`) maps SSA values to hardware registers, **spilling** to the stack when they outnumber registers; `SP`/`BP`/`g` are reserved.
- The **arch backend** (`ssaGenValue`/`ssaGenBlock`) turns lowered SSA into a linked list of **`obj.Prog`**; each function is an **`obj.LSym`**.
- The **obj backend** assembles `obj.Prog` to bytes and emits **relocations** (`R_CALL`, etc.) the linker resolves.
- **ABIInternal** (register, internal) vs **ABI0** (stack, stable) — wrappers bridge the assembly boundary.
- **PCDATA/FUNCDATA** carry stack maps and liveness for the GC and stack growth; they emit no code.
- The compiler inserts **write barriers** (`runtime.gcWriteBarrier2`, gated by `runtime.writeBarrier`) around heap pointer stores.

---

## Further reading

- [Go internal ABI specification](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md)
- Go source: [`cmd/compile/internal/ssa/regalloc.go`](https://github.com/golang/go/blob/master/src/cmd/compile/internal/ssa/regalloc.go)
- Go source: [`cmd/internal/obj`](https://github.com/golang/go/tree/master/src/cmd/internal/obj) — `Prog`, `LSym`, `Addr`
- [Go's work on the register-based calling convention (proposal 40724)](https://github.com/golang/go/issues/40724)
- Go source: [`cmd/compile/internal/ssa/writebarrier.go`](https://github.com/golang/go/blob/master/src/cmd/compile/internal/ssa/writebarrier.go)
- [Debugging the Go runtime: stack maps & PCDATA](https://go.dev/src/runtime/stack.go) (comments on stackmaps)
