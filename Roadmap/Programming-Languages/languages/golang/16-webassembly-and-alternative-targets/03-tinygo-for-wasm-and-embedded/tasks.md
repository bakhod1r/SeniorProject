# TinyGo for Wasm & Embedded — Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are at the end. Tasks marked **(board)** need physical hardware; every one of them has a no-hardware fallback via [play.tinygo.org](https://play.tinygo.org) or a Wasm/WASI runtime, so the whole sheet is completable on a laptop.

---

## Table of Contents

- [Easy](#easy)
  - [Task 1 — Install TinyGo and survey the target matrix](#task-1--install-tinygo-and-survey-the-target-matrix)
  - [Task 2 — Hello-world Wasm in the browser](#task-2--hello-world-wasm-in-the-browser)
  - [Task 3 — Blink an LED](#task-3--blink-an-led)
  - [Task 4 — Read a button with an internal pull-up](#task-4--read-a-button-with-an-internal-pull-up)
  - [Task 5 — `tinygo run` on the host](#task-5--tinygo-run-on-the-host)
- [Medium](#medium)
  - [Task 6 — Export a Go function to JavaScript](#task-6--export-a-go-function-to-javascript)
  - [Task 7 — Read an ADC and map it to PWM brightness](#task-7--read-an-adc-and-map-it-to-pwm-brightness)
  - [Task 8 — Read an I2C sensor with a `tinygo.org/x/drivers` driver](#task-8--read-an-i2c-sensor-with-a-tinygoorgxdrivers-driver)
  - [Task 9 — Build a WASI module and run it in wazero](#task-9--build-a-wasi-module-and-run-it-in-wazero)
  - [Task 10 — Binary-size shootout: standard Go vs TinyGo](#task-10--binary-size-shootout-standard-go-vs-tinygo)
- [Hard](#hard)
  - [Task 11 — Pick the right `-scheduler` for a goroutine Wasm app](#task-11--pick-the-right--scheduler-for-a-goroutine-wasm-app)
  - [Task 12 — Choose a `-gc` mode for a short-lived MCU program](#task-12--choose-a--gc-mode-for-a-short-lived-mcu-program)
  - [Task 13 — Hunt allocations with `-print-allocs`](#task-13--hunt-allocations-with--print-allocs)
  - [Task 14 — Stream UART telemetry and read it with `tinygo monitor`](#task-14--stream-uart-telemetry-and-read-it-with-tinygo-monitor)
  - [Task 15 — On-target debugging with `tinygo gdb`](#task-15--on-target-debugging-with-tinygo-gdb)
- [Bonus / Stretch](#bonus--stretch)
  - [Task 16 — Bidirectional JS interop: callbacks and the DOM](#task-16--bidirectional-js-interop-callbacks-and-the-dom)
  - [Task 17 — One codebase, two targets, behind build tags](#task-17--one-codebase-two-targets-behind-build-tags)
  - [Task 18 — Ship a WASI module to a plugin host](#task-18--ship-a-wasi-module-to-a-plugin-host)
  - [Task 19 — Define a custom target JSON](#task-19--define-a-custom-target-json)
  - [Task 20 — Decide: standard Go Wasm or TinyGo?](#task-20--decide-standard-go-wasm-or-tinygo)
- [Solutions (sketched)](#solutions-sketched)
- [Checkpoints](#checkpoints)

---

## Easy

### Task 1 — Install TinyGo and survey the target matrix

Install TinyGo (Homebrew, the official `.deb`/`.tar.gz`, or the Docker image `tinygo/tinygo`). Confirm the toolchain works and explore what it can target:

```bash
tinygo version
tinygo targets
```

Skim the output. Find these four lines: `wasm`, `wasi` (alias for `wasip1`), `pico`, and one Arduino target. For each, note that a "target" bundles a CPU triple, a linker script, default flags, and a flash method.

**Goal.** Establish that TinyGo is a *separate compiler* with its own target list, not a flag you pass to `go build`. See sibling [01-goos-js-wasm-browser](../01-goos-js-wasm-browser/) for how standard Go's `GOOS=js GOARCH=wasm` differs.

---

### Task 2 — Hello-world Wasm in the browser

Build a Wasm module and run it in a browser. The single most common beginner failure is using the wrong `wasm_exec.js`, so be deliberate:

```bash
tinygo build -o main.wasm -target wasm ./
cp "$(tinygo env TINYGOROOT)/targets/wasm_exec.js" .
```

Write a minimal `index.html` that loads `wasm_exec.js`, instantiates `main.wasm`, and serve it over HTTP (`python3 -m http.server`). Open the page and confirm your `println` shows in the devtools console.

**Goal.** Internalise the rule: **TinyGo Wasm requires TinyGo's own version-matched `wasm_exec.js`** — the one shipped with the Go SDK will fail at instantiation because the import/export ABI differs.

---

### Task 3 — Blink an LED

Toggle the on-board LED once per second. No hardware? Paste it into [play.tinygo.org](https://play.tinygo.org), pick a board, and watch the simulated LED.

```go
package main

import (
	"machine"
	"time"
)

func main() {
	led := machine.LED
	led.Configure(machine.PinConfig{Mode: machine.PinOutput})
	for {
		led.High()
		time.Sleep(500 * time.Millisecond)
		led.Low()
		time.Sleep(500 * time.Millisecond)
	}
}
```

On real hardware: `tinygo flash -target=pico ./`.

**Goal.** Learn the `machine.Pin` lifecycle — `Configure(PinConfig{Mode:...})` then `High()`/`Low()` — and that an MCU `main` never returns.

---

### Task 4 — Read a button with an internal pull-up

Wire a push-button between a GPIO pin and ground (or use the simulator). Configure the pin as an input with the internal pull-up so it reads `true` when released and `false` when pressed. Mirror the button state onto the LED.

```go
btn := machine.GP15
btn.Configure(machine.PinConfig{Mode: machine.PinInputPullup})
// pressed == !btn.Get()  because pull-up means released reads High
```

**Goal.** Understand `PinInputPullup` vs `PinInput`, and why a floating input without a pull resistor reads garbage.

---

### Task 5 — `tinygo run` on the host

Not every program needs to flash or run in a browser. Run a CPU-only program directly:

```bash
tinygo run ./
```

Take a small numeric program (a Fibonacci loop, a sort) and run it under both `go run` and `tinygo run`. Confirm identical output. Then add a `fmt.Printf` with `%v` on a struct and note any formatting differences.

**Goal.** Use `tinygo run` as a fast feedback loop, and discover that TinyGo's `reflect`/`fmt` support is real but narrower than standard Go's — verify before relying on it.

---

## Medium

### Task 6 — Export a Go function to JavaScript

Expose an `add(a, b)` function that JavaScript can call. The canonical pattern is `//export`:

```go
package main

//export add
func add(a, b int32) int32 { return a + b }

func main() {} // required entry point; keeps the module alive
```

```bash
tinygo build -o main.wasm -target wasm ./
```

In JS, after instantiation, call `instance.exports.add(2, 3)`. Confirm it returns `5`.

**Goal.** Learn the `//export name` directive for raw Wasm exports, and why `main()` must exist even when empty. Contrast with the `syscall/js` value-marshalling approach in [01-goos-js-wasm-browser](../01-goos-js-wasm-browser/) — `//export` is leaner but only passes numeric/pointer types.

---

### Task 7 — Read an ADC and map it to PWM brightness

Read an analog input (a potentiometer) and use it to set LED brightness via PWM. Simulator works for this too.

```go
machine.InitADC()
adc := machine.ADC{Pin: machine.ADC0}
adc.Configure(machine.ADCConfig{})

pwm := machine.PWM0 // adjust to your board's PWM peripheral
pwm.Configure(machine.PWMConfig{Period: 1e9 / 500}) // 500 Hz
ch, _ := pwm.Channel(machine.GP16)
for {
	v := adc.Get()                       // 0..65535
	pwm.Set(ch, uint32(v)*(pwm.Top()/0xFFFF))
	time.Sleep(10 * time.Millisecond)
}
```

**Goal.** Wire two peripherals together: `machine.ADC` (16-bit reads) feeding `machine.PWM` (duty cycle scaled to the channel's `Top()`).

---

### Task 8 — Read an I2C sensor with a `tinygo.org/x/drivers` driver

Don't bit-bang a sensor protocol — use the driver ecosystem. Read temperature/pressure from a BMP280 (or any sensor you own).

```go
import (
	"machine"
	"tinygo.org/x/drivers/bmp280"
)

machine.I2C0.Configure(machine.I2CConfig{Frequency: 400 * machine.KHz})
sensor := bmp280.New(machine.I2C0)
sensor.Configure(bmp280.Config{})
t, _ := sensor.ReadTemperature() // milli-degrees C
```

```bash
go get tinygo.org/x/drivers
tinygo flash -target=pico ./
```

**Goal.** Learn the layered model: `machine.I2C0.Configure(...)` + `Tx(...)` is the transport; `tinygo.org/x/drivers/*` packages sit on top so you never hand-write register maps. See [tinygo.org/x/drivers](https://github.com/tinygo-org/drivers) for the catalogue.

---

### Task 9 — Build a WASI module and run it in wazero

Produce a standalone WASI binary and run it in a server-side runtime — no browser, no `wasm_exec.js`.

```bash
tinygo build -o app.wasm -target wasi ./
wasmtime app.wasm          # or:
wazero run app.wasm
```

Write a program that reads `os.Args`, reads stdin, and writes to stdout — all of which WASI provides. Confirm it behaves like a normal CLI under the runtime.

**Goal.** See that `-target wasi` (equivalently `-target wasip1`) produces a host-runtime module governed by the WASI ABI, not the browser ABI. This is the foundation for sibling [02-wasi-and-wasip1](../02-wasi-and-wasip1/).

---

### Task 10 — Binary-size shootout: standard Go vs TinyGo

Quantify the size story that makes TinyGo worth using. Take the Task 9 program and build it four ways:

```bash
GOOS=wasip1 GOARCH=wasm go build -o std.wasm ./        # standard Go
tinygo build -o tg.wasm        -target wasi ./          # TinyGo default
tinygo build -o tg-opt.wasm    -target wasi -opt=z ./   # optimise for size
tinygo build -o tg-min.wasm    -target wasi -opt=z -no-debug ./
ls -la *.wasm
```

Record all four sizes. Expect standard Go to be an order of magnitude larger, and `-opt=z -no-debug` to shave a further chunk off the TinyGo build.

**Goal.** Get hard numbers for the size argument, and learn the two cheapest size levers: `-opt=z` (optimise aggressively for size) and `-no-debug` (strip DWARF). Feeds the production trade-offs in [05-wasm-in-production](../05-wasm-in-production/).

---

## Hard

### Task 11 — Pick the right `-scheduler` for a goroutine Wasm app

Write a Wasm program that launches a goroutine which sleeps and posts a result back. Build it three ways and observe behaviour:

```bash
tinygo build -o s-none.wasm     -target wasm -scheduler=none ./
tinygo build -o s-tasks.wasm    -target wasm -scheduler=tasks ./
tinygo build -o s-asyncify.wasm -target wasm -scheduler=asyncify ./
```

`-scheduler=none` will fail or hang the moment you block on a channel or `time.Sleep` from a goroutine. Determine which scheduler actually lets goroutines + `time.Sleep` work under Wasm, and write one sentence explaining the cost of the others.

**Goal.** Understand that the scheduler choice is a hard correctness constraint, not a tuning knob: `none` has zero concurrency, `tasks` uses real stacks (unavailable on Wasm), and `asyncify` rewrites the module so blocking yields back to the JS event loop — the default and usually only viable choice for goroutine-using browser Wasm.

---

### Task 12 — Choose a `-gc` mode for a short-lived MCU program

Write an MCU program that runs a bounded amount of work and then halts (e.g. read a sensor 100 times, average, then loop forever doing nothing). Build with each GC and compare size and behaviour:

```bash
tinygo build -target=pico -gc=conservative -o gc-cons.elf ./
tinygo build -target=pico -gc=leaking      -o gc-leak.elf ./
tinygo build -target=pico -gc=precise      -o gc-prec.elf ./
```

Argue which is correct here. For a program with a *bounded, non-growing* allocation profile, `-gc=leaking` (never frees) can be the right call: smallest code, zero collector pauses, and it never runs out of RAM because total allocation is capped.

**Goal.** Learn the GC spectrum: `leaking` (alloc-only, smallest/fastest, only safe with bounded allocation), `conservative` (scans without type info — safe default), `precise` (uses type info to avoid false retention). Match the GC to the allocation lifetime, not to habit.

---

### Task 13 — Hunt allocations with `-print-allocs`

Heap allocation is the enemy on a microcontroller. Find yours statically:

```bash
tinygo build -target=pico -print-allocs=. -o /dev/null ./ 2>&1 | head -40
```

Each line tells you a source location that escapes to the heap. Take a function that builds a string with `fmt.Sprintf` inside a hot loop and rewrite it to reuse a `[]byte` buffer / `strconv.AppendInt`. Re-run and confirm the allocation line is gone.

**Goal.** Use `-print-allocs=<pkg-pattern>` as a static escape-analysis report, then eliminate hot-path heap allocations so even the leaking GC stays bounded.

---

### Task 14 — Stream UART telemetry and read it with `tinygo monitor`

Have the board print structured telemetry over the default UART, then read it on the host. **(board)** — or use the simulator's serial console.

```go
machine.Serial.Configure(machine.UARTConfig{BaudRate: 115200})
for {
	fmt.Printf("t=%d temp=%d\n", time.Now().Unix(), readTemp())
	time.Sleep(time.Second)
}
```

```bash
tinygo flash -target=pico ./
tinygo monitor -target=pico        # or: tinygo monitor -baudrate 115200
```

**Goal.** Learn that `machine.Serial` / `UART` is the on-device logging channel, and `tinygo monitor` is the matching host-side serial reader — your `println`-style debugging when no debugger is attached.

---

### Task 15 — On-target debugging with `tinygo gdb`

Set a breakpoint on real silicon. **(board)** This needs a debug probe (the Pico's second Pico as a `picoprobe`, a J-Link, or an ST-Link), but it is the skill that separates blink-tinkering from real firmware work.

```bash
tinygo gdb -target=pico ./
# in gdb:
(gdb) break main.main
(gdb) continue
(gdb) print someVariable
(gdb) step
```

Build *without* `-no-debug` (you need the DWARF info you stripped in Task 10). Set a breakpoint, inspect a variable, single-step.

**Goal.** Connect the dots: `-no-debug` removes the very symbols `tinygo gdb` needs, so debug and release builds diverge. Learn to drive a hardware breakpoint over a probe.

---

## Bonus / Stretch

### Task 16 — Bidirectional JS interop: callbacks and the DOM

Go beyond `//export`. Use `syscall/js` to register a Go function as a DOM click handler that mutates the page, and call a JS API (`fetch`, `document.getElementById`) from Go.

```go
import "syscall/js"

func main() {
	cb := js.FuncOf(func(this js.Value, args []js.Value) any {
		js.Global().Get("document").Call("getElementById", "out").
			Set("innerText", "clicked from Go")
		return nil
	})
	js.Global().Get("document").Call("getElementById", "btn").
		Call("addEventListener", "click", cb)
	select {} // keep the module alive so the callback survives
}
```

**Goal.** Learn the `syscall/js` value bridge and why `select{}` (or a channel) is needed to stop `main` from returning and tearing down your callbacks. This is the same `syscall/js` surface used in [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/).

---

### Task 17 — One codebase, two targets, behind build tags

Build a single repo that targets both a browser (`-target wasm`) and a microcontroller (`-target=pico`), sharing the business logic and isolating platform code with build constraints:

```
sensorlib/         // pure Go, no machine, no syscall/js — builds everywhere
cmd/web/main.go    //go:build tinygo.wasm
cmd/firmware/main.go
```

Use `//go:build` tags so the `machine`-using file never compiles for Wasm and the `syscall/js`-using file never compiles for the MCU.

**Goal.** Structure portable embedded/Wasm code: keep the core target-agnostic, push `machine` and `syscall/js` to the edges behind tags. Verify both `tinygo build` invocations succeed from the same tree.

---

### Task 18 — Ship a WASI module to a plugin host

Treat a TinyGo WASI module as a sandboxed plugin. Build a module that exports a `transform(ptr, len) -> ptr` function, then load and call it from a Go host using `wazero` as an embedded runtime (no external process).

```bash
tinygo build -o plugin.wasm -target wasi -scheduler=none -gc=leaking ./plugin
```

Pass a string from host to guest through linear memory, transform it, read the result back. Note the memory-ownership contract: who allocates, who frees.

**Goal.** Understand the plugin pattern that makes TinyGo+WASI compelling — capability-sandboxed, polyglot extension points — and the manual memory marshalling it demands. Connects to [05-wasm-in-production](../05-wasm-in-production/).

---

### Task 19 — Define a custom target JSON

Read an existing target definition and clone it for a board TinyGo doesn't ship. Inspect a built-in:

```bash
cat "$(tinygo env TINYGOROOT)/targets/pico.json"
```

Note the fields: `inherits`, `cpu`, `build-tags`, `linkerscript`, `flash-method`, default flags. Write `myboard.json` that inherits from an existing chip family and overrides the LED pin / linker script, then `tinygo build -target=./myboard.json ./`.

**Goal.** Demystify what a "target" is — a JSON bundle of compiler/linker/flash settings — so an unsupported board is a configuration problem, not a dead end.

---

### Task 20 — Decide: standard Go Wasm or TinyGo?

Take a real Wasm requirement and write a one-page recommendation. Build the same non-trivial program both ways and gather evidence:

- Binary size (`GOOS=js GOARCH=wasm go build` vs `tinygo build -target wasm -opt=z -no-debug`).
- Language coverage: does your code use reflection-heavy libraries, `cgo`, large parts of the stdlib, or goroutine patterns the `asyncify` scheduler handles poorly?
- Startup time and memory footprint in the browser.

Recommend one, with the trade-off stated explicitly: TinyGo wins on size and is mandatory for MCUs; standard Go wins on full language/stdlib fidelity and goroutine performance.

**Goal.** Make the compiler a deliberate, evidence-backed choice. Pairs with the production decision matrix in [05-wasm-in-production](../05-wasm-in-production/).

---

## Solutions (sketched)

### Solution 1
`tinygo targets` enumerates everything from `wasm`/`wasi` to dozens of boards. Each entry is a JSON file under `$(tinygo env TINYGOROOT)/targets/`. The key insight: TinyGo is a distinct compiler (LLVM-based), so `go build` flags and TinyGo flags are not interchangeable.

### Solution 2
```bash
tinygo build -o main.wasm -target wasm ./
cp "$(tinygo env TINYGOROOT)/targets/wasm_exec.js" .
python3 -m http.server 8080
```
If instantiation throws `LinkError`/import-mismatch, you copied the Go SDK's `wasm_exec.js` instead of TinyGo's. They are not interchangeable and must match the compiler *and* its version.

### Solution 3
`machine.LED` is a per-board alias. The `Configure(PinConfig{Mode: PinOutput})` → `High()`/`Low()` cycle is the universal output idiom. On the simulator the LED animates; on hardware `tinygo flash -target=pico ./` programs the chip. The infinite `for` loop is mandatory — returning from `main` halts the MCU.

### Solution 4
`PinInputPullup` ties the pin High through an internal resistor, so an open button reads `true` and a pressed (to-ground) button reads `false` — hence `pressed := !btn.Get()`. With plain `PinInput` and no external resistor the line floats and reads noise.

### Solution 5
`tinygo run ./` compiles for the host and executes immediately — great for logic that has no peripherals. Output matches `go run` for plain numeric code. Watch for `fmt`/`reflect` gaps: complex `%+v` on nested structs or interface reflection may render differently or be unsupported.

### Solution 6
```go
//export add
func add(a, b int32) int32 { return a + b }
func main() {}
```
`//export add` names the Wasm export; `instance.exports.add(2,3)` returns `5`. `main()` must exist (even empty) as the module entry point. Only numeric and pointer types cross this boundary — strings/structs need manual memory marshalling (Task 18).

### Solution 7
`InitADC()` + `ADC{Pin: ADC0}.Configure(...)` gives 16-bit reads via `Get()` (0–65535). PWM is configured with a `Period`, a `Channel(pin)`, and `Set(ch, duty)` where duty is scaled against `pwm.Top()`. The mapping `v * (Top/0xFFFF)` rescales the 16-bit ADC reading into the PWM channel's resolution.

### Solution 8
`machine.I2C0.Configure(I2CConfig{Frequency: 400*KHz})` sets up the bus; the `bmp280` driver wraps `Tx` calls into `ReadTemperature()` etc. The lesson is layering: never hand-roll register reads when a `tinygo.org/x/drivers` package exists. `go get tinygo.org/x/drivers` pulls the whole driver module.

### Solution 9
```bash
tinygo build -o app.wasm -target wasi ./
wasmtime app.wasm
```
`-target wasi` == `-target wasip1`. The module imports the WASI ABI (args, env, fd I/O, clocks) instead of the browser's JS glue, so `os.Args`/stdin/stdout work under `wasmtime` or `wazero` with no `wasm_exec.js`.

### Solution 10
Typical ratios: standard Go Wasm is multi-MB; TinyGo default is hundreds of KB; `-opt=z` trims more; `-no-debug` removes DWARF for a final cut. The two size levers to remember are `-opt=z` and `-no-debug` — but `-no-debug` is what breaks `tinygo gdb` later (Task 15).

### Solution 11
`-scheduler=asyncify` is the working choice for goroutines + blocking under browser Wasm: it rewrites the module so a blocking call unwinds back to the JS event loop and resumes later. `-scheduler=tasks` needs real OS-style stacks (fine on MCUs, not on Wasm). `-scheduler=none` has no concurrency at all and deadlocks/aborts the moment you block.

### Solution 12
For a bounded, non-growing allocation profile, `-gc=leaking` is legitimately optimal: smallest binary, no collector code, no pauses, and it never exhausts RAM because total allocation is capped. `conservative` is the safe general default; `precise` uses type information to avoid retaining objects via false pointers. Choose by allocation lifetime.

### Solution 13
```bash
tinygo build -target=pico -print-allocs=. -o /dev/null ./
```
Each reported line is a heap escape. Replacing `fmt.Sprintf` in a hot loop with a reused buffer + `strconv.AppendInt` removes the escape; re-running `-print-allocs` shows the line gone. Static, build-time, no device needed.

### Solution 14
`machine.Serial.Configure(UARTConfig{BaudRate:115200})` plus `fmt.Printf` sends framed lines over UART. `tinygo monitor -target=pico` (or `-baudrate 115200`) opens the host serial port and prints them. This is the no-debugger logging path.

### Solution 15
```bash
tinygo gdb -target=pico ./       # build WITHOUT -no-debug
(gdb) break main.main
(gdb) continue
(gdb) print x
```
Requires a debug probe (picoprobe / J-Link / ST-Link). The catch: `-no-debug` strips the DWARF symbols `gdb` relies on, so your release build can't be debugged — keep a debug build for this.

### Solution 16
`js.FuncOf` wraps a Go closure as a callable JS function; register it with `addEventListener`. Reach into the page with `js.Global().Get("document").Call(...)`. `select{}` blocks `main` forever so the runtime doesn't tear down the registered callbacks. Remember to `cb.Release()` if you ever unregister.

### Solution 17
Keep `sensorlib/` free of `machine` and `syscall/js`. Guard `cmd/firmware` with the absence of the Wasm tag and `cmd/web` with `//go:build tinygo.wasm` (or `js`). Both `tinygo build -target wasm ./cmd/web` and `tinygo build -target=pico ./cmd/firmware` then compile cleanly from one tree.

### Solution 18
```bash
tinygo build -o plugin.wasm -target wasi -scheduler=none -gc=leaking ./plugin
```
Host (`wazero`) instantiates the module, writes the input string into the guest's linear memory at a guest-allocated offset, calls `transform(ptr,len)`, then reads the returned `(ptr,len)`. The contract — guest allocates, host reads, who frees — must be explicit; `-gc=leaking` is fine for a short-lived per-call invocation.

### Solution 19
`pico.json` shows the schema: `inherits` (chip family), `cpu`, `build-tags`, `linkerscript`, `flash-method`, plus default flags. A custom board JSON inherits a known chip and overrides only what differs (LED pin, linker script). Build with `-target=./myboard.json`. An "unsupported board" is therefore just a missing JSON.

### Solution 20
TinyGo: far smaller binaries, mandatory for microcontrollers, but partial `reflect`/`fmt`/stdlib and `asyncify`-mediated goroutines. Standard Go Wasm: full language and stdlib fidelity, better goroutine throughput, much larger output. Decide from measured size + a concrete language-coverage audit of your dependencies, not from preference.

---

## Checkpoints

After completing the easy tasks: you can install TinyGo, read `tinygo targets`, ship a browser Wasm module with the correct `wasm_exec.js`, and drive GPIO (LED out, button in) on a board or the simulator.

After completing the medium tasks: you can export functions to JS, combine ADC + PWM, read an I2C sensor through a real driver, produce and run a WASI module, and quantify the binary-size win with `-opt=z` and `-no-debug`.

After completing the hard tasks: you can choose `-scheduler` and `-gc` from first principles, eliminate hot-path allocations with `-print-allocs`, stream telemetry over UART with `tinygo monitor`, and set hardware breakpoints with `tinygo gdb`.

After completing the bonus tasks: you can build full bidirectional JS interop, share one codebase across Wasm and MCU targets behind build tags, embed a WASI module as a sandboxed plugin, author a custom target JSON, and defend the standard-Go-vs-TinyGo decision with evidence.

## Further Reading

- TinyGo documentation — <https://tinygo.org/docs/>
- TinyGo online playground / board simulator — <https://play.tinygo.org>
- Driver catalogue — <https://github.com/tinygo-org/drivers> (`tinygo.org/x/drivers`)
