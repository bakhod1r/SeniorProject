# TinyGo for Wasm & Embedded — Optimization

> Honest framing first: TinyGo already produces binaries that are one to two orders of magnitude smaller than the standard `gc` toolchain, because it pairs LLVM with a stripped-down runtime and a different garbage collector. So "optimization" here is rarely about clever code — it is about choosing the right *build configuration* for the *target*. A `.wasm` blob shipped over the wire and a firmware image flashed to a 64 KB-flash microcontroller pull on overlapping but distinct levers: both care about code size, but the MCU also cares about RAM, stack depth, and power, while the browser cares about wire size after compression and instantiation latency.
>
> Each entry below states the problem, shows a "before" configuration, an "after" configuration, and the realistic gain — and, crucially, how to *measure* it, because a flag that "should" shrink the binary sometimes does not on your particular code. The closing sections cover the `gc`-vs-TinyGo size comparison methodology and the cases where these tradeoffs quietly break correctness.

---

## Optimization 1 — Optimize for size with `-opt=z`

**Problem:** The default optimization level balances size and speed. For Wasm download size and for MCU flash budgets, every kilobyte of code is a hard constraint, and you almost always want the compiler to favour smaller code over marginally faster code.

**Before:**
```bash
tinygo build -o app.wasm -target=wasm ./main.go   # default -opt=2
```

**After:**
```bash
tinygo build -o app.wasm -target=wasm -opt=z ./main.go
```
The levels run `-opt=1`, `2`, `s` (size-conscious but still speed-aware), and `z` (aggressively minimise size). `z` instructs LLVM to drop size-expensive transforms like loop unrolling and aggressive inlining.

**Why it works:** `-opt=z` is LLVM's "minimum size at almost any speed cost" setting. On code dominated by control flow rather than hot numeric loops, the speed penalty is negligible while the size win is real.

**How to measure:** Build at `-opt=2` and `-opt=z`, then compare. For Wasm also measure the *compressed* size, since that is what users download (see Optimization 7):
```bash
tinygo build -o a2.wasm -target=wasm -opt=2 ./main.go
tinygo build -o az.wasm -target=wasm -opt=z ./main.go
ls -l a2.wasm az.wasm
```

**Expected gain:** Commonly 5–20% smaller `.text`. Verify per project — on allocation-light, branch-heavy code the win is larger; on tight numeric kernels `-opt=z` can occasionally *cost* size by foregoing a simplifying unroll.

---

## Optimization 2 — Strip debug info with `-no-debug`

**Problem:** TinyGo, like any LLVM front end, embeds DWARF debug information by default. For Wasm this lands in a custom section; for embedded targets it is stripped from the flashed image but bloats the ELF you inspect and link. The DWARF is frequently *larger than the code itself*.

**Before:**
```bash
tinygo build -o app.wasm -target=wasm -opt=z ./main.go
```

**After:**
```bash
tinygo build -o app.wasm -target=wasm -opt=z -no-debug ./main.go
```

**Why it works:** `-no-debug` omits DWARF generation entirely. Nothing about the executed program changes — you simply lose the ability to set source-line breakpoints or get symbolised stack traces.

**How to measure:** The `.wasm` shrinks immediately; confirm the section is gone:
```bash
tinygo build -o dbg.wasm  -target=wasm -opt=z          ./main.go
tinygo build -o slim.wasm -target=wasm -opt=z -no-debug ./main.go
ls -l dbg.wasm slim.wasm
wasm-objdump -h slim.wasm | grep -i name   # custom name/debug sections gone
```

**Expected gain:** Often the single biggest size lever — DWARF can account for 30–60% of an unstripped `.wasm`. Reserve debug builds for development; ship `-no-debug`.

---

## Optimization 3 — Pick the right garbage collector with `-gc`

**Problem:** The default `conservative` GC scans the stack and heap without precise type information, which is safe but spends cycles and code on collection logic. Different programs want different collectors, and the wrong default leaves both size and runtime on the table.

**Before:**
```bash
tinygo build -o app.wasm -target=wasm -opt=z ./main.go   # -gc=conservative
```

**After (short-lived program — a one-shot Wasm function, a CLI, a boot-to-compute MCU task):**
```bash
tinygo build -o app.wasm -target=wasm -opt=z -gc=leaking ./main.go
```

**Why it works:** `-gc=leaking` never frees memory — `malloc` is a bump pointer and there is no collector at all. That removes the collector's code and all its runtime overhead, producing the smallest, fastest binary. `-gc=conservative` (default) reclaims memory by scanning roots imprecisely; `-gc=precise` uses type-accurate stack maps so it collects more aggressively and scans less, at some code cost.

**How to measure:**
```bash
for gc in leaking conservative precise; do
  tinygo build -o "g-$gc.wasm" -target=wasm -opt=z -no-debug -gc=$gc ./main.go
done
ls -l g-*.wasm
```
For embedded, also watch peak RAM: a leaking GC's heap grows monotonically, so profile total allocations (Optimization 5) before trusting it on a long-running device.

**Expected gain:** `leaking` shaves both code and per-allocation cost; for genuinely short-lived programs it is strictly better. **Correctness caveat:** never use `leaking` for a long-running service, a continuously-running firmware loop, or a Wasm module reused across many calls — it will exhaust memory. For those, stay on `conservative` or move to `precise`.

---

## Optimization 4 — Drop the scheduler with `-scheduler=none`

**Problem:** TinyGo ships a cooperative scheduler so goroutines, channels, `time.Sleep`, and `select` work. If your program has no goroutines, you are linking and running a scheduler you never use.

**Before:**
```bash
tinygo build -o app.wasm -target=wasm -opt=z ./main.go   # -scheduler=tasks (or asyncify on wasm)
```

**After (no goroutines anywhere in the reachable graph):**
```bash
tinygo build -o app.wasm -target=wasm -opt=z -scheduler=none ./main.go
```

**Why it works:** `-scheduler=none` removes the scheduler runtime entirely. The other modes — `tasks` (stack switching, common on MCUs) and `asyncify` (LLVM pass that lets a single-threaded Wasm host suspend/resume, the typical Wasm default) — exist only to multiplex goroutines. With none of them you cannot use `go`, channels, or blocking `time.Sleep`, but you also pay nothing for them.

**How to measure:** Build with and without and diff. If the build *fails* with `-scheduler=none`, that failure is itself information — something in your dependency graph (often a driver or a `context` deadline) spawns a goroutine you did not know about.
```bash
tinygo build -o sched.wasm -target=wasm -opt=z -no-debug ./main.go
tinygo build -o none.wasm  -target=wasm -opt=z -no-debug -scheduler=none ./main.go && ls -l sched.wasm none.wasm
```

**Expected gain:** Removes scheduler code plus its goroutine-stack management; on Wasm, skipping `asyncify` also speeds up instantiation and execution because the Asyncify transform instruments every function that might suspend. See sibling [04-wasm-interop-and-performance](../04-wasm-interop-and-performance) for the call-overhead implications.

---

## Optimization 5 — Find and eliminate heap allocations with `-print-allocs`

**Problem:** On a 32 KB-RAM MCU, or in a Wasm module called millions of times, every heap allocation costs collector pressure (or, with leaking GC, permanent memory). You cannot fix allocations you cannot see.

**Before:** Guessing which lines allocate, then sprinkling `sync.Pool` (which TinyGo barely benefits from) and hoping.

**After:**
```bash
tinygo build -o app.wasm -target=wasm -print-allocs=. ./main.go
```
TinyGo prints each heap allocation it could *not* prove stack-safe, with file and line. Fix the hot ones by:
- returning values instead of pointers so they stay on the stack,
- avoiding interface boxing — assigning a concrete value to an `interface{}` (or `error`, or a `fmt`-style `...any`) forces a heap allocation,
- pre-sizing slices/maps so they do not grow-and-reallocate,
- replacing string concatenation in loops with a pre-allocated `[]byte`.

**Why it works:** `-print-allocs` reports exactly where escape analysis failed. Each eliminated escape moves an object from heap to stack, removing both the allocation and the future collection.

**How to measure:** Count the reported lines before and after; on device, confirm the heap high-water mark dropped (many boards expose remaining heap, or read the linker's `.bss`/heap region size).

**Expected gain:** Highly code-dependent, but eliminating allocations in a hot loop can turn a stuttering, GC-thrashing firmware loop into a flat-memory one — and is the prerequisite for safely using `-gc=leaking`.

---

## Optimization 6 — Avoid `reflect`, `fmt`, and `encoding/json`

**Problem:** These three packages are the classic TinyGo size traps. `reflect` drags in type metadata for every reachable type; `fmt` pulls in `reflect` plus formatting machinery; `encoding/json` pulls in `reflect` *and* `fmt`. A single `fmt.Printf` can balloon a 10 KB binary into 100 KB+.

**Before:**
```go
fmt.Printf("temp=%d humidity=%d\n", t, h)   // pulls reflect + fmt
```

**After:**
```go
println("temp=", t, " humidity=", h)        // builtin, no reflect

// or, for structured output, a hand-rolled writer:
var buf [16]byte
n := strconv.AppendInt(buf[:0], int64(t), 10)
uart.Write(n)
```
For serialization, prefer a code-generated or hand-written encoder over `encoding/json`; for logging on-device, use `println` (builtin, no import) or a minimal `machine.UART` writer.

**Why it works:** Reachability drives TinyGo's size. Removing the *only* call to `fmt` lets dead-code elimination drop `fmt`, `reflect`, and their transitive type tables entirely.

**How to measure:** Grep the symbol table or just build before/after — the cliff is obvious:
```bash
tinygo build -o app.wasm -target=wasm -opt=z -no-debug ./main.go
ls -l app.wasm   # delete the last fmt call, rebuild, compare
```

**Expected gain:** Removing the last `reflect`/`fmt`/`json` dependency is frequently a 30–80 KB drop — often the difference between fitting in flash and not.

---

## Optimization 7 — Compress the `.wasm` for delivery (gzip / brotli)

**Problem:** The byte count that matters for a browser-delivered module is the *compressed transfer size*, not the on-disk `.wasm`. Wasm is highly compressible, and serving it uncompressed wastes most of the win you fought for with `-opt=z` and `-no-debug`.

**Before:** The server sends `app.wasm` raw; the browser downloads the full file.

**After (build-time or server-level):**
```bash
# Pre-compress at build time
brotli -q 11 -o app.wasm.br app.wasm
gzip -9 -k app.wasm                  # fallback for clients without brotli
```
Serve with `Content-Encoding: br` (or `gzip`) and `Content-Type: application/wasm`, and use `WebAssembly.instantiateStreaming` so decode overlaps download. This is a delivery concern owned by sibling [05-wasm-in-production](../05-wasm-in-production); coordinate the build artifact and the serving headers there.

**Why it works:** Wasm's bytecode has high redundancy (repeated opcodes, leb128 patterns), so brotli at max quality routinely hits 3–4× compression.

**How to measure:**
```bash
ls -l app.wasm app.wasm.br app.wasm.gz   # transfer size = the .br number
```

**Expected gain:** Typically 60–75% reduction in transfer bytes. Note this is orthogonal to embedded targets — MCUs flash the raw image, so compression does not apply there.

---

## Optimization 8 — Dead-code elimination via build tags

**Problem:** A driver library or your own package compiles platform code, debug helpers, or optional features that a given target never uses. Even with whole-program DCE, code that is *referenced* (e.g. behind a runtime `if debug`) stays in the binary.

**Before:**
```go
func read() int {
    if debugLogging {           // runtime flag — both branches compiled in
        fmt.Println("reading")  // drags in fmt even in production
    }
    return sensor.Value()
}
```

**After (compile-time exclusion):**
```go
//go:build debug
package main
func log(s string) { println(s) }
```
```go
//go:build !debug
package main
func log(string) {}             // empty; DCE removes calls entirely
```
Build production without the tag so the logging path — and any heavy imports it pulled — is never compiled.

**Why it works:** Build tags remove code *before* the linker sees it, so it cannot anchor a heavy transitive dependency. This converts a runtime branch (always linked) into a compile-time choice (linked only when wanted).

**How to measure:** Build with and without the tag; the `fmt`-style cliff from Optimization 6 appears or disappears.

**Expected gain:** Eliminates whole feature trees and the libraries they anchor; pairs with Optimization 6 to keep `fmt`/`reflect` out of release builds.

---

## Optimization 9 — Tune `-stack-size` to avoid overflow without waste

**Problem:** Goroutine and task stacks are fixed-size on TinyGo. Too small and a deep call chain silently corrupts memory (stack overflow on an MCU rarely faults cleanly); too large and you waste scarce RAM that could be heap.

**Before:** Default stack size, then mysterious hard faults or corrupted globals under deep recursion / large local arrays.

**After:**
```bash
tinygo flash -target=pico -stack-size=2KB ./main.go     # raise to fix overflow
# or, once measured safe, lower to reclaim RAM:
tinygo flash -target=pico -stack-size=1KB ./main.go
```
Reduce stack *demand* first: avoid large local arrays (move them to package-level statics or the heap), and avoid deep recursion on MCUs.

**Why it works:** The stack is carved from a fixed RAM budget. Right-sizing it is a direct RAM-for-safety trade; the goal is the smallest stack that never overflows under worst-case call depth plus a margin.

**How to measure:** Fill the stack region with a sentinel pattern at boot, run the worst-case workload, then inspect how far the sentinel was overwritten (high-water marking). Many RTOS-style helpers and `tinygo.org/x/drivers` examples include this; absent that, bisect `-stack-size` downward until you see corruption, then add a safety margin.

**Expected gain:** Not a size win — a *correctness and RAM* win. Correct stack sizing is what lets you spend reclaimed RAM on the heap your driver code needs.

---

## Optimization 10 — `-panic=trap` instead of printing panics

**Problem:** The default panic handler formats and prints the panic message and a stack trace. That formatting path drags in print/format code and string machinery you may not want in a tiny release image.

**Before:**
```bash
tinygo build -o app.wasm -target=wasm -opt=z ./main.go   # -panic=print
```

**After:**
```bash
tinygo build -o app.wasm -target=wasm -opt=z -panic=trap ./main.go
```

**Why it works:** `-panic=trap` replaces the print-and-abort handler with a bare trap instruction (an `unreachable` on Wasm, a fault on MCU). It removes the panic-formatting code path, which can in turn let more print/format code be eliminated.

**How to measure:** Build both ways and compare size. Confirm behaviour: with `trap`, a panic now aborts with no message — acceptable for production where a watchdog or host-side supervisor handles the trap, but it removes your last on-device diagnostic.

**Expected gain:** A few KB, more if `-panic=trap` was the last thing anchoring the formatting code. **Correctness caveat:** you lose panic diagnostics — keep `-panic=print` for development and on devices where you cannot attach a debugger.

---

## Optimization 11 — Use drivers and peripherals efficiently

**Problem:** Naive peripheral code burns CPU (and power) busy-polling, allocates buffers per read, and reconfigures hardware redundantly. On an MCU the runtime cost is also a *battery* cost.

**Before:**
```go
for {
    if uart.Buffered() > 0 {        // tight busy-poll, CPU pinned at 100%
        b, _ := uart.ReadByte()
        process(b)
    }
}
```

**After:**
```go
buf := make([]byte, 64)             // one allocation, reused
for {
    n, _ := uart.Read(buf)          // block/yield instead of spin
    process(buf[:n])
}
```
Prefer interrupt- or DMA-driven I/O where the board supports it, reuse a single buffer rather than allocating per read, and use the batched `Read`/`Write` on `tinygo.org/x/drivers` interfaces instead of byte-at-a-time calls.

**Why it works:** Batched I/O amortises per-call overhead and a reused buffer removes per-iteration allocation (verify with `-print-allocs`, Optimization 5). Yielding instead of spinning frees the CPU to idle.

**How to measure:** Watch the allocation count (`-print-allocs`), measure throughput (bytes/sec), and on battery-powered boards measure current draw with a power meter.

**Expected gain:** Lower CPU utilization, fewer allocations, and a direct path to the low-power patterns in the next optimization.

---

## Optimization 12 — Sleep instead of spin for low power on MCUs

**Problem:** A busy-wait loop keeps the core at full clock indefinitely. On a coin-cell or battery device this is the difference between weeks and hours of runtime — and it is pure waste, since the core does nothing useful between events.

**Before:**
```go
for {
    reading := sensor.Read()
    transmit(reading)
    // immediately loops — core never sleeps
}
```

**After:**
```go
for {
    reading := sensor.Read()
    transmit(reading)
    time.Sleep(10 * time.Second)    // scheduler can idle the core
}
```
Drive work from interrupts where possible (sensor data-ready pin, RTC alarm) and let the core enter a low-power state between events rather than polling. Note this requires a scheduler — it is in tension with `-scheduler=none` (Optimization 4), so choose per workload: a pure compute kernel wants no scheduler, an event-driven sensor node wants sleep.

**Why it works:** A sleeping or interrupt-woken core draws a fraction of the current of a spinning one. The energy saved is roughly proportional to the duty cycle reduction.

**How to measure:** A current meter / power profiler on the supply rail, integrated over a representative cycle, gives average current → battery life. There is no software-only substitute for measuring real draw.

**Expected gain:** Often 10–100× lower average current for low-duty-cycle workloads. Irrelevant for Wasm targets, which have no power dimension.

---

## Optimization 13 — Trim the reachable import graph

**Problem:** Convenience imports — a logging framework, a config loader, a "just for this one helper" library — anchor their entire transitive trees. TinyGo's DCE is whole-program, but it cannot remove a package that something still references.

**Before:** `import "github.com/some/heavy/logger"` used once, pulling its own deps (often `reflect`/`fmt`) into a 200-line firmware.

**After:** Replace the single use with `println` or a 5-line local helper, delete the import, and let DCE collapse the tree. Audit what survives:
```bash
tinygo build -o app -target=pico -opt=z -no-debug ./main.go
tinygo build -size=full -o app -target=pico ./main.go   # per-package size breakdown
```
`-size=full` (and `-size=short`) attributes flash/RAM to each package so you can see which import is expensive, not just guess.

**Why it works:** Removing the last reference to a package makes the whole package — and anything only it referenced — unreachable, so the linker drops it.

**How to measure:** `-size=full` before and after; the offending package's line disappears.

**Expected gain:** Varies wildly — a single convenience import can be the majority of a tiny binary. `-size=full` turns "what is big?" from speculation into a sorted list.

---

## Optimization 14 — Compare `gc` vs TinyGo deliberately (and measure both)

**Problem:** Teams reach for TinyGo assuming it is always the right Wasm/embedded toolchain, but the size win comes with real tradeoffs: incomplete stdlib, no full `reflect`, slower compilation, and runtime semantics differences (especially around GC and goroutines). The decision should be measured, not assumed.

**Before:** "We use TinyGo because it's smaller" — with no number attached, and a `reflect`-heavy codebase that fights the toolchain at every step.

**After (a reproducible comparison harness):**
```bash
# Standard toolchain
GOOS=wasip1 GOARCH=wasm go build -o std.wasm ./main.go

# TinyGo, fully optimized
tinygo build -o tiny.wasm -target=wasi -opt=z -no-debug \
  -gc=leaking -scheduler=none -panic=trap ./main.go

ls -l std.wasm tiny.wasm
brotli -q11 -kf std.wasm tiny.wasm && ls -l *.br   # compare transfer size
```
Then also compare *correctness and speed*: run the test suite under both, and benchmark the hot path — TinyGo's smaller GC can be faster for short-lived work but the standard `gc` runtime is more mature for sustained throughput.

**Why it works:** The right answer depends on your code. `gc` (`GOOS=js`/`wasip1`) gives full language support and a battle-tested runtime at large size; TinyGo gives tiny size at the cost of coverage. Only a side-by-side measurement on *your* program decides it.

**How to measure:** Three axes — compressed size (`ls -l *.br`), correctness (`go test` vs `tinygo test`), and hot-path latency (a benchmark run under both). For embedded there is no `gc` alternative, so the comparison is TinyGo-config-vs-TinyGo-config.

**Expected gain:** Clarity. Sometimes the answer is "stay on standard `gc`" — e.g. a `reflect`/`encoding/json`-heavy module where TinyGo's restrictions cost more engineering time than the bytes are worth. See sibling [01-goos-js-wasm-browser](../01-goos-js-wasm-browser) and [02-wasi-and-wasip1](../02-wasi-and-wasip1) for the standard-toolchain baseline.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. For TinyGo the signals that matter are size, allocations, RAM/flash, and (on MCUs) power:

```bash
# On-disk size — the headline number for both Wasm and embedded code
tinygo build -o app.wasm -target=wasm -opt=z -no-debug ./main.go
ls -l app.wasm

# Per-package flash/RAM attribution — find the expensive import
tinygo build -size=full -o app -target=pico ./main.go

# Heap allocations the compiler could not stack-allocate
tinygo build -print-allocs=. -o app -target=pico ./main.go

# Wasm transfer size — what users actually download
brotli -q11 -kf app.wasm && ls -l app.wasm.br

# Wasm section breakdown — is DWARF still in there?
wasm-objdump -h app.wasm

# Sweep the big levers and read the size column
for opt in 2 s z; do
  tinygo build -o "o-$opt.wasm" -target=wasm -opt=$opt -no-debug ./main.go
done
ls -l o-*.wasm

# Embedded RAM: stack high-water (sentinel fill) + reported free heap on-device
# Embedded power: current meter on the supply rail, integrated over one duty cycle
```

Track these before and after each change. Pay attention to two things in particular: the *compressed* Wasm size (the wire cost that `-opt=z`/`-no-debug` target) and, on MCUs, peak RAM and average current — a build that is smaller in flash but overflows the stack or exhausts a leaking heap is not an optimization, it is a regression with a smaller binary.

---

## When NOT to Over-Optimize

These levers have sharp edges. Reach for them with a reason, not reflexively.

- **`-gc=leaking` in anything long-running.** It never frees. A web service, a firmware main loop, or a Wasm module reused across many host calls will exhaust memory and crash. Use it only for genuinely one-shot programs. For sustained workloads use `conservative` or `precise`.
- **`-scheduler=none` when something spawns goroutines.** The build fails or the program misbehaves. If a driver, a `context` timeout, or a channel is in the reachable graph, you need a scheduler. Do not force `none` to save bytes at the cost of a broken program.
- **`-panic=trap` on a device you cannot debug.** You lose every panic diagnostic. Keep `-panic=print` until you have host-side or watchdog handling of traps.
- **`-no-debug` during development.** Stripping DWARF removes breakpoints and symbolised traces. Ship it; do not develop with it.
- **Hand-rolling encoders to avoid `encoding/json` on code that is not size-critical.** If the binary already fits with room to spare, the maintenance cost of a bespoke serializer is not worth a few KB.
- **TinyGo at all, for a `reflect`-heavy program.** If your code leans on `reflect`/full `encoding/json`/the rich stdlib, the standard `gc` Wasm toolchain (sibling 01/02) may cost less engineering time than fighting TinyGo's restrictions — the bytes are not always worth it.

Measure first. Apply the cheap, universally-safe levers (`-opt=z`, `-no-debug`, compression, removing `fmt`/`reflect`) before the ones with correctness tradeoffs (`-gc=leaking`, `-scheduler=none`, `-panic=trap`). And when a build is already small enough for its target, stop — the next kilobyte is rarely worth a subtle runtime bug.

---

## Summary

TinyGo optimization is configuration, not cleverness. The safe, high-leverage wins are `-opt=z` and `-no-debug` for raw size, removing `fmt`/`reflect`/`encoding/json` to collapse code cliffs, and brotli/gzip for Wasm delivery. The tradeoff levers — `-gc=leaking`, `-scheduler=none`, `-panic=trap` — are powerful but each removes a safety net, so apply them only when the program's lifetime and structure permit. On embedded targets, add the dimensions Wasm does not have: right-size the stack to avoid silent overflow, watch peak RAM (especially under a leaking GC), use batched/interrupt-driven I/O, and sleep instead of spin to save power. Above all, measure on *your* code with `ls -l`, `-size=full`, `-print-allocs`, and a real power meter — and decide deliberately whether TinyGo or the standard `gc` toolchain is even the right target before tuning either.

## Further Reading

- TinyGo documentation — build options, GC modes, schedulers, targets: https://tinygo.org/docs/
- Sibling: [01-goos-js-wasm-browser](../01-goos-js-wasm-browser) — standard `gc` Wasm baseline for the browser
- Sibling: [02-wasi-and-wasip1](../02-wasi-and-wasip1) — standard `gc` WASI baseline
- Sibling: [04-wasm-interop-and-performance](../04-wasm-interop-and-performance) — call overhead and the cost of Asyncify
- Sibling: [05-wasm-in-production](../05-wasm-in-production) — compression, content-encoding headers, and streaming instantiation
