# TinyGo for Wasm & Embedded — Find the Bug

> Each snippet contains a real-world bug that surfaces when you swap the standard `gc` Go compiler for TinyGo. TinyGo is *not* a drop-in: it compiles a subset of the standard library, ships limited `reflect`, uses a cooperative scheduler you must opt into, offers several garbage-collector modes with very different lifetime semantics, and targets devices with kilobytes of RAM. Most bugs below come from assuming `gc` behavior on a TinyGo binary. Find the bug, explain the root cause, fix it.
>
> Cross-references: the browser `js/wasm` path lives in sibling `01-goos-js-wasm-browser`, WASI in `02-wasi-and-wasip1`, host/guest interop and bundle size in `04-wasm-interop-and-performance`, and shipping concerns in `05-wasm-in-production`.

---

## Table of Contents

1. [`encoding/json` into `map[string]any`](#bug-1--encodingjson-into-mapstringany)
2. [Goroutine + `time.Sleep` with `-scheduler=none`](#bug-2--goroutine--timesleep-with--schedulernone)
3. [Go's `gc` `wasm_exec.js` against a TinyGo binary](#bug-3--gos-gc-wasm_execjs-against-a-tinygo-binary)
4. [`-gc=leaking` in a long-running program](#bug-4---gcleaking-in-a-long-running-program)
5. [`Pin.High()` before `Pin.Configure()`](#bug-5--pinhigh-before-pinconfigure)
6. [Wrong `-target` for the board](#bug-6--wrong--target-for-the-board)
7. [Importing an unsupported package](#bug-7--importing-an-unsupported-package)
8. [Deep recursion overflowing MCU stack](#bug-8--deep-recursion-overflowing-mcu-stack)
9. [Blocking the single thread with a busy loop](#bug-9--blocking-the-single-thread-with-a-busy-loop)
10. [Assuming `GOMAXPROCS` parallelism](#bug-10--assuming-gomaxprocs-parallelism)
11. [`main` returns on wasm — exports vanish](#bug-11--main-returns-on-wasm--exports-vanish)
12. [`reflect`-based struct tags ignored](#bug-12--reflect-based-struct-tags-ignored)
13. [Channels under `-scheduler=asyncify`](#bug-13--channels-under--schedulerasyncify)
14. [I2C device unreachable — address & `Configure`](#bug-14--i2c-device-unreachable--address--configure)
15. [Reaching for `cgo`](#bug-15--reaching-for-cgo)
16. [Expecting `os` / a filesystem on bare metal](#bug-16--expecting-os--a-filesystem-on-bare-metal)
17. [Large global array blows the heap](#bug-17--large-global-array-blows-the-heap)
18. [`fmt` verbs on interfaces format as pointers](#bug-18--fmt-verbs-on-interfaces-format-as-pointers)
19. [`time.Now()` returns the epoch on bare metal](#bug-19--timenow-returns-the-epoch-on-bare-metal)
20. [Wasm exports stripped without `//export`](#bug-20--wasm-exports-stripped-without-export)
21. [`-scheduler=tasks` stack too small for a goroutine](#bug-21---schedulertasks-stack-too-small-for-a-goroutine)
22. [Mixing `gc` build cache with TinyGo](#bug-22--mixing-gc-build-cache-with-tinygo)
23. [Summary](#summary)

---

## Bug 1 — `encoding/json` into `map[string]any`

```go
package main

import (
	"encoding/json"
	"fmt"
)

func main() {
	var out map[string]any
	err := json.Unmarshal([]byte(`{"name":"sensor","id":7}`), &out)
	fmt.Println(out, err)
}
```

```bash
$ tinygo build -o app.wasm -target=wasi .
# compiles
$ wasmtime app.wasm
map[]  <nil>          # empty map, no error — data silently lost
```

**Bug:** TinyGo's `reflect` package is a subset of the standard library's. `encoding/json` leans hard on reflection to decode into *dynamic* targets — `interface{}`/`any`, `map[string]any`, and arbitrary nested types it must discover at runtime. TinyGo cannot fully reconstruct those types, so the decode either no-ops, returns garbage, or (on newer versions) errors. The program "works" enough to compile and run, which is the trap: you get an empty map and a `nil` error.

**Root cause:** dynamic, reflection-driven (de)serialization is the single most common standard-library feature that breaks on TinyGo. The same applies to many reflection-heavy libraries (validators, ORMs, generic mappers).

**Fix:** decode into a *concrete* struct so the compiler knows the shape statically:

```go
type Reading struct {
	Name string `json:"name"`
	ID   int    `json:"id"`
}

var r Reading
if err := json.Unmarshal(data, &r); err != nil { /* ... */ }
```

For genuinely dynamic payloads, prefer a TinyGo-friendly parser that does not require full reflection (a streaming/event tokenizer, or hand-written decoding). See `04-wasm-interop-and-performance` for passing structured data across the host boundary without JSON at all.

---

## Bug 2 — Goroutine + `time.Sleep` with `-scheduler=none`

```go
func main() {
	go worker()
	time.Sleep(time.Second) // wait for worker
	println("done")
}

func worker() { println("working") }
```

```bash
$ tinygo build -o app -target=microbit -scheduler=none .
# flashes, then:
# "done" prints, "working" never does — or the program faults
```

**Bug:** `-scheduler=none` compiles **without any scheduler**. With no scheduler there are no goroutines and no blocking primitives: `go worker()` cannot be scheduled, and `time.Sleep`, channel sends/receives, and `select` have nothing to drive them. Depending on version, `go` becomes a no-op or `time.Sleep` traps.

**Root cause:** TinyGo's concurrency is cooperative and opt-in. `-scheduler=none` is the smallest, fastest option (no scheduler overhead, smallest binary) but it forbids concurrency entirely.

**Fix:** pick a scheduler that matches the target:

```bash
# embedded / bare metal — task-based stackful coroutines
$ tinygo build -o app -target=microbit -scheduler=tasks .

# wasm — rewrite blocking points via Binaryen's asyncify
$ tinygo build -o app.wasm -target=wasi -scheduler=asyncify .
```

If you truly want `-scheduler=none` for size, restructure the code to be single-threaded and event-driven — no goroutines, no `time.Sleep`, no channels. See Bug 21 for sizing task stacks.

---

## Bug 3 — Go's `gc` `wasm_exec.js` against a TinyGo binary

```html
<script src="wasm_exec.js"></script> <!-- copied from $(go env GOROOT)/lib/wasm -->
<script>
  const go = new Go();
  WebAssembly.instantiateStreaming(fetch("app.wasm"), go.importObject)
    .then(r => go.run(r.instance));
</script>
```

```bash
$ tinygo build -o app.wasm -target=wasm .
# browser console:
LinkError: WebAssembly.instantiate(): Import #0 "gojs" "runtime.wasmExit":
  function import requires a callable
```

**Bug:** The page loads the *standard `gc` toolchain's* `wasm_exec.js`, but `app.wasm` was produced by TinyGo. TinyGo emits a different set of host imports (different runtime ABI, different function names and signatures) than `gc`. The `gc` loader supplies an `importObject` the TinyGo module never asked for, and is missing the ones it needs — instantiation fails with a `LinkError`.

**Root cause:** `wasm_exec.js` is part of the toolchain's runtime contract and is **version-matched to the compiler that produced the binary**. TinyGo ships its own.

**Fix:** use TinyGo's `wasm_exec.js`, regenerated whenever you upgrade TinyGo:

```bash
$ cp "$(tinygo env TINYGOROOT)/targets/wasm_exec.js" .
```

Do not mix loaders. The same rule applies to `js/wasm` builds in `01-goos-js-wasm-browser`: the JS shim must come from the same toolchain and version as the `.wasm`.

---

## Bug 4 — `-gc=leaking` in a long-running program

```go
func handle(req []byte) []byte {
	buf := make([]byte, len(req)*2) // allocates per request
	// ... transform ...
	return buf
}
```

```bash
$ tinygo build -o server.wasm -target=wasi -gc=leaking .
# runs fine for minutes, then RSS climbs without bound until OOM / trap
```

**Bug:** `-gc=leaking` is a real GC mode that **never frees**. Every allocation (`make`, `new`, string concatenation, boxing into an interface) permanently consumes heap. It is intended for short-lived, allocate-once programs and for measuring allocation behavior — never for servers, event loops, or anything that allocates per request/iteration.

**Root cause:** TinyGo's GC modes trade collection for size/speed. `leaking` is the extreme: zero collector code, fastest allocation, smallest binary — but memory only grows.

**Fix:** use a collecting GC for long-running code:

```bash
$ tinygo build -o server.wasm -target=wasi -gc=conservative .  # default
# or, if your types are GC-precise-safe:
$ tinygo build -o server.wasm -target=wasi -gc=precise .
```

`conservative` is the default and the safe choice. Reserve `leaking` for a `main` that runs once and exits, or for a function you call a bounded number of times. Independently, reduce per-request allocation (reuse buffers, `sync.Pool`-style patterns) to ease GC pressure — relevant on tiny heaps regardless of mode.

---

## Bug 5 — `Pin.High()` before `Pin.Configure()`

```go
import "machine"

func main() {
	led := machine.LED
	for {
		led.High()             // turn LED on
		time.Sleep(time.Second)
		led.Low()
		time.Sleep(time.Second)
	}
}
```

```bash
$ tinygo flash -target=arduino .
# board flashes successfully, but the LED never lights
```

**Bug:** The pin is driven (`High()`/`Low()`) but never **configured as an output**. A GPIO pin powers up in a default mode (often input/high-impedance). Writing a level to an unconfigured pin does nothing observable.

**Root cause:** in the `machine` package every pin must be `Configure`d with a `PinConfig` before use; the call wires up the pin's direction/mode in the MCU's peripheral registers.

**Fix:** configure the pin once before the loop:

```go
func main() {
	led := machine.LED
	led.Configure(machine.PinConfig{Mode: machine.PinOutput})
	for {
		led.High()
		time.Sleep(time.Second)
		led.Low()
		time.Sleep(time.Second)
	}
}
```

(This loop also requires `-scheduler=tasks` for `time.Sleep` to work — see Bug 2.) The same `Configure`-before-use rule applies to ADC, PWM, SPI, I2C, and UART peripherals; see Bug 14 for I2C.

---

## Bug 6 — Wrong `-target` for the board

```bash
$ tinygo flash -target=arduino .            # board is actually an Arduino Nano 33 BLE
# flashes "successfully", but the program misbehaves or the board hangs
```

**Bug:** `-target=arduino` selects the AVR ATmega328p (Uno/Nano classic). The Nano 33 BLE is an entirely different MCU (Nordic nRF52840, ARM Cortex-M4). The pin map, clock, peripherals, and even the instruction set differ. A binary built for the wrong target may flash via a compatible bootloader yet run garbage, peg the wrong pins, or fault immediately.

**Root cause:** a TinyGo `target` is a complete board description: CPU architecture, linker script, default clock, pin aliases (`machine.LED`, `machine.D13`, …), flashing method. It is not a hint — it determines code generation.

**Fix:** pick the exact target for your board:

```bash
$ tinygo targets | grep -i nano
$ tinygo flash -target=arduino-nano33 .
```

When unsure, `tinygo info -target=<name>` prints the resolved CPU, build tags, and defaults so you can confirm before flashing. Board-specific pin constants (`machine.D2`, `machine.A0`) only resolve correctly under the matching target.

---

## Bug 7 — Importing an unsupported package

```go
import (
	"net/http"
	"machine"
)
```

```bash
$ tinygo build -o app -target=microbit .
# error: package net/http is not supported on this target
# (or: undefined symbol / missing syscall during link)
```

**Bug:** TinyGo implements a *subset* of the standard library, and support varies **per target**. `net/http` (and most of `net`, `os/exec`, `database/sql`, `reflect`-heavy packages) is unavailable on bare-metal microcontrollers — there is no OS, no socket stack, no scheduler assumptions it can rely on. The build fails at compile or link time.

**Root cause:** the standard library assumes a hosted OS. On an MCU there isn't one; TinyGo only provides what makes sense for the target.

**Fix:** check support before depending on a package. TinyGo's docs publish a per-package/per-target support matrix:

- On microcontrollers, use `machine` for peripherals and lightweight TinyGo-compatible drivers (e.g. `tinygo.org/x/drivers`).
- If you need networking on an MCU, use a driver for a specific network co-processor, not `net/http`.
- For wasm/WASI targets, more of the library is available (see `02-wasi-and-wasip1`), but still not everything.

If an import is rejected, that is a design signal, not a flag to override.

---

## Bug 8 — Deep recursion overflowing MCU stack

```go
func sum(n uint32) uint32 {
	if n == 0 {
		return 0
	}
	return n + sum(n-1) // depth == n
}

func main() {
	println(sum(100000))
}
```

```bash
$ tinygo flash -target=microbit .
# board resets repeatedly, or the value printed is wrong / it hangs
```

**Bug:** Each recursive call pushes a frame. With `n == 100000` that is ~100k frames. An MCU like the micro:bit has **kilobytes** of RAM total and a stack measured in low-KB. The stack overflows into other memory (or triggers a hard fault and watchdog reset). There is no `runtime: goroutine stack exceeds` luxury message — on bare metal you just get a crash/reset.

**Root cause:** TinyGo on MCUs uses fixed, small stacks. Unbounded recursion, large stack-allocated arrays, and deep call chains overflow silently.

**Fix:** make the algorithm iterative (constant stack), or bound the depth:

```go
func sum(n uint32) uint32 {
	var total uint32
	for i := uint32(1); i <= n; i++ {
		total += i
	}
	return total
}
```

Where recursion is unavoidable, keep depth small and frames tiny, and size the stack deliberately (see Bug 21 for goroutine stacks). The same caution applies to large local arrays — prefer heap allocation or static buffers (Bug 17).

---

## Bug 9 — Blocking the single thread with a busy loop

```go
func main() {
	go blink()
	for { /* spin, "keep main alive" */ }
}

func blink() {
	led := machine.LED
	led.Configure(machine.PinConfig{Mode: machine.PinOutput})
	for {
		led.High(); time.Sleep(500 * time.Millisecond)
		led.Low();  time.Sleep(500 * time.Millisecond)
	}
}
```

```bash
$ tinygo flash -target=arduino-nano33 -scheduler=tasks .
# LED never blinks; the board appears frozen
```

**Bug:** The `for {}` busy loop in `main` never yields. TinyGo's scheduler is **cooperative** — goroutines only switch at yield points (`time.Sleep`, channel ops, `runtime.Gosched`). A tight loop with no yield monopolizes the single thread forever, so `blink` never runs. There is no preemption to rescue you.

**Root cause:** unlike the `gc` runtime, TinyGo does not preempt goroutines. A goroutine that never blocks starves all others.

**Fix:** block correctly instead of spinning. To keep `main` alive while goroutines run, park it:

```go
func main() {
	go blink()
	select {} // block forever, yielding the thread to the scheduler
}
```

If `main` itself needs a loop, insert a yield: `runtime.Gosched()` or a `time.Sleep`. Never busy-wait under a cooperative scheduler.

---

## Bug 10 — Assuming `GOMAXPROCS` parallelism

```go
func main() {
	runtime.GOMAXPROCS(4)
	results := make([]int, 4)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func(i int) { defer wg.Done(); results[i] = heavy(i) }(i)
	}
	wg.Wait()
	// expected: ~4x speedup
}
```

```bash
$ tinygo build -o app.wasm -target=wasi -scheduler=asyncify .
# correct results, but zero speedup — runs strictly serially
```

**Bug:** TinyGo provides **no parallelism**. Its scheduler is cooperative and single-threaded; `GOMAXPROCS` does not create OS threads or use multiple cores. The four goroutines interleave on one thread, so `heavy()` calls run one after another. Results are correct; the expected 4x speedup never materializes.

**Root cause:** TinyGo's concurrency model is concurrency-without-parallelism. Goroutines are coroutines on a single thread. `GOMAXPROCS` is effectively ignored for actual parallel execution.

**Fix:** do not rely on goroutines for compute speedup under TinyGo. Options:

- Restructure CPU-bound work to be sequential and tight (often faster anyway with no scheduler overhead).
- For wasm, push parallelism to the host: run multiple module instances in separate Web Workers / host threads and fan in results — see `04-wasm-interop-and-performance` and `05-wasm-in-production`.

Goroutines under TinyGo are for *structuring concurrent I/O and waiting*, not for using more cores.

---

## Bug 11 — `main` returns on wasm — exports vanish

```go
//go:wasmexport add
func add(a, b int32) int32 { return a + b }

func main() {} // empty
```

```javascript
const { instance } = await WebAssembly.instantiate(bytes, importObject);
instance.exports.add(2, 3);
// RuntimeError: unreachable / "Go program has already exited"
```

```bash
$ tinygo build -o app.wasm -target=wasm .
```

**Bug:** When `main` returns, the Go runtime considers the program **exited** and tears down its state. Subsequently calling an exported function on a "finished" instance traps. For a wasm module meant to be called repeatedly from the host (a library-style module), `main` must not return.

**Root cause:** wasm modules used as callable libraries have a lifecycle. With the JS host runtime (`go.run`), returning from `main` runs exit handlers; calling exports afterward is undefined/traps.

**Fix:** keep the instance alive by blocking `main`:

```go
func main() {
	select {} // never returns; runtime stays initialized
}
```

Now the host can call `add` as many times as it likes. (For a pure WASI *command* that runs once and exits, returning from `main` is correct — the distinction is library vs. command; see `02-wasi-and-wasip1`.)

---

## Bug 12 — `reflect`-based struct tags ignored

```go
type Config struct {
	Timeout int `validate:"min=1"`
}

// using a reflection-based validator library
err := validator.Struct(Config{Timeout: 0})
// expected: validation error; got: nil
```

```bash
$ tinygo build -o app.wasm -target=wasi .
# compiles, but validation does nothing
```

**Bug:** The validator inspects struct tags via `reflect` at runtime. TinyGo's `reflect` is limited — tag reading, `NumField`/`Field` walking, and `Kind` dispatch may be incomplete or absent for some types — so the library silently finds nothing to validate and returns `nil`. Same family of failure as Bug 1: reflection-driven libraries compile but misbehave.

**Root cause:** TinyGo cannot afford full runtime type information on small targets, so `reflect` covers only a subset of operations and types. Libraries built on heavy reflection (validators, mappers, generic serializers, DI containers) are unreliable.

**Fix:** prefer compile-time or explicit approaches under TinyGo:

```go
func (c Config) Validate() error {
	if c.Timeout < 1 {
		return errors.New("timeout must be >= 1")
	}
	return nil
}
```

Hand-written validation, code generation, or TinyGo-aware libraries avoid the reflection dependency entirely. Before adopting any library, check whether its core depends on `reflect`.

---

## Bug 13 — Channels under `-scheduler=asyncify`

```go
func main() {
	ch := make(chan int) // unbuffered
	go func() { ch <- compute() }()
	result := <-ch
	println(result)
}
```

```bash
$ tinygo build -o app.wasm -target=wasi .   # note: no -scheduler flag
# instantiation/run error, or the receive blocks forever
```

**Bug:** Channels are blocking primitives; they need a scheduler to suspend and resume the parties. On the wasm target the scheduler that supports blocking is **asyncify**, and it must be selected. Without it (or with `-scheduler=none`), the unbuffered send/receive has no machinery to park and wake the goroutines, so the receive deadlocks or the runtime traps.

**Root cause:** on wasm, cooperative blocking is implemented via Binaryen's *asyncify* transform, which rewrites the module so it can unwind and rewind the stack at blocking points. It is not free (size/speed cost) so you opt in.

**Fix:** build with the asyncify scheduler:

```bash
$ tinygo build -o app.wasm -target=wasi -scheduler=asyncify .
```

Buffering does not substitute for a scheduler: a buffered channel only avoids blocking *while the buffer has room*; the first full/empty operation still needs the scheduler to park a goroutine. If you must use `-scheduler=none`, remove channels and goroutines entirely and run straight-line code.

---

## Bug 14 — I2C device unreachable — address & `Configure`

```go
import "machine"

func main() {
	i2c := machine.I2C0
	buf := []byte{0x00}
	// read register 0x00 from a sensor at 8-bit address 0xEC
	i2c.Tx(0xEC, []byte{0x00}, buf)
	println(buf[0])
}
```

```bash
$ tinygo flash -target=arduino-nano33 .
# always reads 0x00 / 0xFF; device never responds
```

**Bug:** Two faults. (1) The I2C peripheral was never `Configure`d, so SCL/SDA and the bus clock are not set up. (2) The address `0xEC` is an **8-bit** (shifted, write-bit-included) address; TinyGo's `Tx` expects the **7-bit** address (`0xEC >> 1 == 0x76`). Passing the 8-bit form addresses the wrong (or no) device.

**Root cause:** like every peripheral, I2C must be `Configure`d before use (Bug 5's rule). And datasheets often quote 8-bit addresses while the API takes 7-bit — an off-by-shift that silently talks to nobody.

**Fix:**

```go
func main() {
	i2c := machine.I2C0
	if err := i2c.Configure(machine.I2CConfig{}); err != nil {
		println("i2c config:", err.Error())
		return
	}
	const addr = 0x76 // 7-bit (0xEC >> 1)
	buf := make([]byte, 1)
	if err := i2c.Tx(addr, []byte{0x00}, buf); err != nil {
		println("tx:", err.Error())
		return
	}
	println(buf[0])
}
```

Confirm the wiring and the 7-bit address with an I2C scan, and prefer a vendor driver from `tinygo.org/x/drivers` that already handles register layout.

---

## Bug 15 — Reaching for `cgo`

```go
/*
#include <math.h>
*/
import "C"

func fastSqrt(x float64) float64 {
	return float64(C.sqrt(C.double(x)))
}
```

```bash
$ tinygo build -o app.wasm -target=wasi .
# error: cgo is not fully supported / link failure for this target
```

**Bug:** TinyGo's cgo support is **limited and target-dependent**. It works in some configurations but not for bare-metal and not reliably for wasm; complex C interop, system headers, and arbitrary linking are commonly unsupported. The build fails at compile or link.

**Root cause:** cgo assumes a full C toolchain, a hosted libc, and a linking model that small/wasm targets do not provide. TinyGo deliberately constrains it.

**Fix:** stay in Go. For `math.Sqrt` here, just use the standard library, which TinyGo supports:

```go
import "math"

func fastSqrt(x float64) float64 { return math.Sqrt(x) }
```

When you genuinely need native code on a wasm target, expose it through **host imports** instead of cgo: declare the function and let the host (JS/runtime) provide it — covered in `04-wasm-interop-and-performance`. On MCUs, port the C logic to Go or call vendor peripherals via `machine`.

---

## Bug 16 — Expecting `os` / a filesystem on bare metal

```go
import "os"

func main() {
	data, err := os.ReadFile("/etc/config.json")
	if err != nil {
		println(err.Error())
		return
	}
	println(string(data))
}
```

```bash
$ tinygo flash -target=microbit .
# build error, or at runtime: always errors / file not found
```

**Bug:** A microcontroller has **no operating system and no filesystem**. `os.ReadFile`, `os.Open`, working directories, environment variables, and process APIs have nothing to talk to. On MCU targets these either fail to build or return errors at runtime; there is no `/etc`.

**Root cause:** `os` models a hosted OS. Bare metal isn't hosted. (WASI is different — it exposes a capability-based filesystem via the host; see `02-wasi-and-wasip1`. The bug is assuming MCU == hosted.)

**Fix:** embed configuration at build time and read from flash/RAM:

```go
import _ "embed"

//go:embed config.json
var configJSON []byte // baked into the firmware image

func main() {
	// parse configJSON into a concrete struct (see Bug 1)
}
```

For runtime-mutable data, write to on-chip flash or external storage via a `machine`/driver API, not `os`. Reserve `os` filesystem use for WASI/hosted targets.

---

## Bug 17 — Large global array blows the heap

```go
var frame [320 * 240]uint32 // 307,200 bytes ≈ 300 KB

func main() {
	render(&frame)
}
```

```bash
$ tinygo flash -target=microbit .
# link error: region RAM overflowed
# (or the board faults the instant it touches the buffer)
```

**Bug:** A 320×240 32-bit framebuffer needs ~300 KB of RAM. The micro:bit has on the order of **tens of KB** total. The allocation cannot fit; the linker reports a RAM region overflow, or a runtime allocation faults. MCUs are RAM-constrained by orders of magnitude compared to a server or browser.

**Root cause:** you must budget memory explicitly on MCUs. Large static arrays, big `make`s, and deep stacks (Bug 8) all compete for kilobytes.

**Fix:** size data to the device. Use a smaller buffer, a lower color depth, stream/tile the work, or push pixels incrementally to the display rather than holding a full frame:

```go
// 1-bit per pixel for a small mono display, or render in horizontal strips
var line [320]uint8
for y := 0; y < 240; y++ {
	renderLine(y, line[:])
	display.WriteLine(y, line[:])
}
```

Check the budget up front: `tinygo info -target=microbit` reports RAM size; the linker map shows where it went. For richer graphics, choose a target with more RAM.

---

## Bug 18 — `fmt` verbs on interfaces format as pointers

```go
type Temperature struct{ C float64 }

func (t Temperature) String() string {
	return fmt.Sprintf("%.1f°C", t.C)
}

func main() {
	var s fmt.Stringer = Temperature{C: 21.5}
	fmt.Printf("reading: %v\n", s)
}
```

```bash
$ tinygo build -o app.wasm -target=wasi .
# output: reading: {21.5}   (or an address-like value) — String() not called
```

**Bug:** `fmt`'s rich verb handling (`%v` honoring `Stringer`, `%+v`/`%#v` field names, `%T` type names) depends on runtime reflection and type metadata. With TinyGo's reduced `reflect`/RTTI, `fmt` may **not invoke `String()`** through an interface and falls back to a default rendering — so you see the raw struct or a pointer-ish value instead of `21.5°C`.

**Root cause:** same root as Bugs 1 and 12 — limited reflection/type information. `fmt`'s reflection-dependent paths degrade.

**Fix:** don't route formatting through reflection-heavy verbs on TinyGo. Call the method explicitly, or build the string yourself:

```go
fmt.Printf("reading: %s\n", s.String())   // or s.(Temperature).String()
// or, smaller still on MCUs, avoid fmt entirely:
println("reading:", Temperature{C: 21.5}.String())
```

On size-sensitive targets, prefer `strconv` and `println`/`String()` over `fmt`, which also pulls in significant code. Verify the exact output on the target rather than assuming `gc` semantics.

---

## Bug 19 — `time.Now()` returns the epoch on bare metal

```go
func main() {
	machine.InitADC()
	for {
		println(time.Now().Format(time.RFC3339), readSensor())
		time.Sleep(time.Second)
	}
}
```

```bash
$ tinygo flash -target=arduino-nano33 -scheduler=tasks .
# timestamps stuck at 1970-01-01T00:00:00Z (or nonsense)
```

**Bug:** A microcontroller has **no real-time clock and no wall-clock source** unless you provide one. `time.Now()` on bare metal has no calendar time to read — it returns the epoch or an undefined value. (Monotonic timing via `time.Sleep`/`time.Since` works because it's driven by a hardware timer; *wall-clock* time does not.)

**Root cause:** wall-clock time requires an RTC peripheral, an NTP/host sync, or a manually set base. TinyGo can't invent one.

**Fix:** use monotonic durations for delays/intervals, and source wall time explicitly:

```go
// monotonic timing works:
start := time.Now()
// ...
elapsed := time.Since(start)

// for calendar time, read an RTC or set a base from a trusted source:
base := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC) // e.g. from host/GPS/NTP
now := base.Add(time.Since(start))
```

On wasm/WASI the host supplies the clock, so `time.Now()` behaves normally there — another MCU-vs-hosted distinction (see `02-wasi-and-wasip1`).

---

## Bug 20 — Wasm exports stripped without `//export`

```go
package main

func multiply(a, b int32) int32 { return a * b } // intended to be callable from JS

func main() { select {} }
```

```javascript
instance.exports.multiply(6, 7);
// TypeError: instance.exports.multiply is not a function
```

```bash
$ tinygo build -o app.wasm -target=wasm .
```

**Bug:** Nothing told the compiler that `multiply` is a wasm export. Without an export directive, the function is an internal symbol and the optimizer/linker is free to inline or drop it — it does not appear in the module's export table, so the host can't find it.

**Root cause:** wasm exports are explicit. A plain Go function is not exported just because it's package-level.

**Fix:** annotate it for export:

```go
//go:wasmexport multiply
func multiply(a, b int32) int32 { return a * b }
```

```bash
$ tinygo build -o app.wasm -target=wasm .
```

Use wasm-ABI-friendly parameter/return types (integers, floats, pointers + lengths). Strings, slices, and structs need an explicit memory protocol across the boundary — see `04-wasm-interop-and-performance`. Confirm the export landed with `wasm-objdump -x app.wasm | grep -i export` or `wasm2wat`.

---

## Bug 21 — `-scheduler=tasks` stack too small for a goroutine

```go
func main() {
	go process() // process() declares a large local buffer
	select {}
}

func process() {
	var scratch [4096]byte // 4 KB on the goroutine's stack
	work(scratch[:])
}
```

```bash
$ tinygo flash -target=arduino-nano33 -scheduler=tasks .
# board hard-faults / resets when process() runs
```

**Bug:** Under `-scheduler=tasks`, each goroutine gets its **own fixed-size stack** carved from the small RAM budget. The default per-goroutine stack is on the order of a couple of KB. A goroutine that puts a 4 KB array (plus call frames) on its stack overruns it and corrupts adjacent memory or hard-faults. There is no automatic stack growth like the `gc` runtime.

**Root cause:** TinyGo goroutine stacks are fixed and small; they do not grow on demand. Large stack frames inside goroutines overflow.

**Fix:** shrink the goroutine's stack usage or enlarge its stack budget:

```go
// 1) Move the big buffer off the goroutine stack — make it static/heap:
var scratch [4096]byte // package-level, not on the goroutine stack
func process() { work(scratch[:]) }
```

```bash
# 2) Or raise the default goroutine stack size at build time:
$ tinygo flash -target=arduino-nano33 -scheduler=tasks \
    -stack-size=8kb .
```

Prefer (1): heap/static buffers keep goroutine stacks lean. Reserve stack-size bumps for cases you've measured, since every goroutine pays the cost out of scarce RAM.

---

## Bug 22 — Mixing `gc` build cache with TinyGo

```bash
$ go build ./...                    # standard toolchain, populates caches
$ tinygo build -o app.wasm -target=wasm .
# odd link errors, stale symbols, or a binary that uses gc wasm_exec.js semantics
$ # …or a teammate's CI invokes `go build` thinking it's equivalent to tinygo
```

**Bug:** `go build` and `tinygo build` are **different compilers** with different runtimes, ABIs, intrinsics, and standard-library subsets. They are not interchangeable. Running `go build` (the `gc` toolchain) on code intended for TinyGo produces a `gc` binary with a different wasm ABI — which then needs the `gc` `wasm_exec.js` and won't behave like the TinyGo build. Conversely, expecting TinyGo to honor `gc`-only constructs (full `reflect`, `net/http`, preemptive goroutines, growing stacks) leads to the failures throughout this file.

**Root cause:** treating `tinygo` as "`go` with a flag." It is a separate implementation with deliberate constraints.

**Fix:** be explicit and consistent about which toolchain owns each artifact:

```bash
$ tinygo version          # confirm you're using TinyGo
$ tinygo build -o app.wasm -target=wasm .
# pair with TinyGo's wasm_exec.js (Bug 3), TinyGo's support matrix (Bug 7),
# and TinyGo's scheduler/GC flags (Bugs 2, 4, 13).
```

In CI, separate `go`-toolchain jobs from `tinygo` jobs and never assume one's output is a substitute for the other. When porting `gc` code to TinyGo, audit for the limitations catalogued above before flashing.

---

## Summary

TinyGo lets Go run where the standard `gc` toolchain can't — browsers as tiny wasm, WASI runtimes, and microcontrollers with kilobytes of RAM — but it earns that reach by **constraining** the language runtime. Nearly every bug here is one assumption away from a `gc` mental model:

1. **`reflect` is a subset.** Dynamic `encoding/json`, struct-tag validators, generic mappers, and even rich `fmt` verbs depend on full reflection/RTTI and silently misbehave (Bugs 1, 12, 18). Decode into concrete types, validate by hand, format explicitly.

2. **Concurrency is cooperative, single-threaded, and opt-in.** Goroutines, `time.Sleep`, channels, and `select` need `-scheduler=tasks` (embedded) or `-scheduler=asyncify` (wasm); `-scheduler=none` forbids them; busy loops starve the scheduler; `GOMAXPROCS` buys no parallelism; goroutine stacks are fixed and small (Bugs 2, 9, 10, 13, 21).

3. **The GC mode changes lifetime semantics.** `-gc=leaking` never frees — fine for run-once programs, fatal for long-running ones. Use `conservative` (default) or `precise` for anything that allocates over time (Bug 4).

4. **The target is the platform.** The wrong `-target`, an unsupported package, `cgo`, `os`/filesystem on bare metal, missing `Pin.Configure`/I2C setup, large arrays, deep recursion, and missing wall-clock all stem from forgetting that an MCU is not a hosted OS (Bugs 5, 6, 7, 8, 14, 15, 16, 17, 19).

5. **Wasm has a runtime contract.** Use TinyGo's *own* version-matched `wasm_exec.js`, don't let `main` return for a library module, and mark exports explicitly (Bugs 3, 11, 20). Never confuse the `gc` and TinyGo toolchains (Bug 22).

Treat TinyGo's documentation — including the per-target standard-library support matrix and the scheduler/GC option reference — as required reading before you flash or ship. The constraints are the feature; design within them and TinyGo is remarkably capable.

## Further Reading

- TinyGo documentation: https://tinygo.org/docs/
- Sibling topics: `01-goos-js-wasm-browser` (the `js/wasm` browser path), `02-wasi-and-wasip1` (WASI and hosted-vs-bare-metal differences), `04-wasm-interop-and-performance` (host/guest interop, memory protocol, bundle size), `05-wasm-in-production` (shipping, sizing, and operating wasm/TinyGo binaries).
