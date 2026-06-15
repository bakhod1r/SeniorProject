# TinyGo for Wasm & Embedded — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Target System: How `-target` Resolves](#the-target-system-how-target-resolves)
3. [The `machine` Package in Depth](#the-machine-package-in-depth)
4. [GPIO: The Canonical Example](#gpio-the-canonical-example)
5. [I2C, SPI, ADC, PWM, UART](#i2c-spi-adc-pwm-uart)
6. [The Scheduler: `none`, `tasks`, `asyncify`](#the-scheduler-none-tasks-asyncify)
7. [Garbage Collector Modes](#garbage-collector-modes)
8. [Building and Serving Wasm with the Right `wasm_exec.js`](#building-and-serving-wasm-with-the-right-wasm_execjs)
9. [The Drivers Ecosystem (`tinygo.org/x/drivers`)](#the-drivers-ecosystem-tinygoorgxdrivers)
10. [The Build → Flash → Debug Workflow](#the-build--flash--debug-workflow)
11. [Optimisation and Size Flags](#optimisation-and-size-flags)
12. [Common Errors and Their Real Causes](#common-errors-and-their-real-causes)
13. [When TinyGo Is Right and When It Is Wrong](#when-tinygo-is-right-and-when-it-is-wrong)
14. [Best Practices](#best-practices)
15. [Pitfalls You Will Meet in Real Projects](#pitfalls-you-will-meet-in-real-projects)
16. [Self-Assessment](#self-assessment)
17. [Summary](#summary)

---

## Introduction

You already know the headline: TinyGo is an LLVM-based alternative compiler for Go that targets two worlds the standard `gc` compiler reaches poorly — tiny WebAssembly modules for the browser and edge, and bare-metal microcontrollers with kilobytes of RAM. You know `tinygo build -o main.wasm -target wasm` produces a fraction of the bytes `GOOS=js GOARCH=wasm go build` does, and that `tinygo flash` writes a binary onto a dev board.

The middle-level question is *how the machine works underneath those commands*: what `-target` actually selects, what the `machine` package abstracts and what it does not, how the three scheduler modes change the meaning of a goroutine, and how the GC mode you pick decides whether `make([]byte, n)` is safe in a hot loop on a chip with no MMU.

After reading this you will:
- Trace `-target` from a name to a CPU/board JSON, an LLVM triple, and a linker script
- Use the `machine` package for GPIO, I2C, ADC, and PWM from first principles
- Choose `-scheduler=none|tasks|asyncify` and predict its effect on goroutines, channels, and `time.Sleep`
- Choose a `-gc` mode and reason about its memory and pause behaviour
- Serve a wasm module with the *matching* `wasm_exec.js`, and explain why mixing it with Go's breaks silently
- Run the build → flash → debug loop with `tinygo monitor` and GDB

For the contrast with standard-Go wasm see [01-goos-js-wasm-browser](../01-goos-js-wasm-browser/) and [02-wasi-and-wasip1](../02-wasi-and-wasip1/); for the interop and perf details that apply to both compilers see [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/).

---

## The Target System: How `-target` Resolves

`-target` is the single most important flag in TinyGo, and it is not a hardcoded enum. It is a name that resolves to a layered JSON description.

When you run `tinygo build -target=arduino-nano33`, TinyGo loads `targets/arduino-nano33.json` from its install tree. That file `inherits` from a chain:

```
arduino-nano33.json
  └─ inherits: nrf52840
        └─ inherits: nrf52
              └─ inherits: cortex-m4
                    └─ inherits: cortex-m
```

Each layer fills in part of the picture:

| Layer | Supplies |
|-------|----------|
| Board (`arduino-nano33`) | Pin name → physical pin mapping, default UART/I2C/SPI buses, `serial` port glob for flashing. |
| Chip (`nrf52840`) | RAM/flash sizes, peripheral register addresses, the `machine` build tag set. |
| CPU family (`cortex-m4`) | LLVM target triple (`armv7em-none-eabi`), FPU flags, the libc to use (`picolibc`). |
| Generic (`cortex-m`) | Linker script template, the flash method (`mass-storage`, `openocd`, `bmp`…), startup assembly. |

The fields that matter most:

- `llvm-target` — the triple LLVM compiles for, e.g. `wasm32-unknown-wasi` or `armv6m-none-eabi`.
- `build-tags` — extra build tags, so `//go:build nrf52840` files compile in. This is how the `machine` package selects the right register layout.
- `linkerscript` — the `.ld` file that places `.text`, `.data`, `.bss`, and the stack/heap. For wasm there is no linker script; the wasm linker (`wasm-ld`) places sections itself.
- `flash-method` / `flash-command` — how `tinygo flash` writes the binary (copy to a USB mass-storage drive, call `openocd`, etc.).

Run `tinygo info -target=arduino-nano33` to print the resolved values without building. This is the fastest way to answer "what triple, what RAM, what default scheduler/GC does this board get?" — board JSONs frequently override `scheduler` and `gc`.

For wasm the targets are flatter: `wasm` (browser, `GOOS=js`), `wasi`/`wasip1` (server/edge, `GOOS=wasip1`). They differ chiefly in how the module talks to the host — DOM/JS glue versus the WASI syscall ABI — which is the subject of [02-wasi-and-wasip1](../02-wasi-and-wasip1/).

---

## The `machine` Package in Depth

`machine` is TinyGo's hardware abstraction layer. It is to embedded TinyGo what `os` and `net` are to standard Go: the boundary between portable code and the platform.

Two things make it unusual:

1. **It is build-tag selected, not interface-dispatched.** There is no runtime polymorphism. When you compile for `nrf52840`, the `machine` package you link is the nrf52840 variant — register addresses, pin tables, and peripheral structs baked in at compile time. Switch `-target` and you link a different `machine`. This is why a binary is locked to one chip and why there is zero abstraction overhead: `pin.High()` compiles down to a single store to a GPIO register.

2. **Pins are values, not handles.** `machine.D13` is a `machine.Pin`, which is just a `uint8` index into the chip's pin table. Configuring it does the register writes; the value itself is cheap to copy.

The package exposes:

- **GPIO** — `Pin.Configure`, `High`, `Low`, `Set`, `Get`, `SetInterrupt`.
- **Buses** — `I2C0`, `SPI0`, `UART0` as package-level peripheral instances you `Configure` then use.
- **Analog** — `ADC` for reading voltages, `PWM` groups for analog-like output.
- **Identity** — `machine.CPUFrequency()`, and board constants like `machine.LED`.

On wasm targets `machine` is mostly empty — there are no GPIO pins in a browser tab. The cross-target portability story is "drivers depend on `machine` interfaces; the chip variant fills them in."

---

## GPIO: The Canonical Example

The classic blink, written to show every mechanism:

```go
package main

import (
	"machine"
	"time"
)

func main() {
	led := machine.LED // board-defined alias, often machine.D13
	led.Configure(machine.PinConfig{Mode: machine.PinOutput})

	for {
		led.High()              // drive the pin to VCC
		time.Sleep(time.Second) // see the scheduler section for what this means
		led.Low()               // drive the pin to ground
		time.Sleep(time.Second)
	}
}
```

`Configure(PinConfig{Mode: PinOutput})` writes the pin direction register. `High`/`Low` write the output register. There is no syscall, no allocation, no scheduler involvement in the I/O itself — these are register stores inlined at the call site.

Reading a button with a pull-up and an interrupt:

```go
btn := machine.D2
btn.Configure(machine.PinConfig{Mode: machine.PinInputPullup})

// Polling
if !btn.Get() { // active-low: pressed reads false
	led.High()
}

// Or interrupt-driven (no busy loop, lets the CPU sleep)
btn.SetInterrupt(machine.PinFalling, func(p machine.Pin) {
	led.Set(!led.Get())
})
```

`SetInterrupt` registers a handler that fires from the chip's interrupt vector. The callback runs in interrupt context — keep it short, do not allocate, and do not block. This is the embedded equivalent of "don't do heavy work on the UI thread."

Flash and watch it run:

```bash
tinygo flash -target=arduino-nano33 ./blink
```

---

## I2C, SPI, ADC, PWM, UART

These follow the same `Configure`-then-use shape. Realistic snippets:

**I2C** — read a register from a sensor at address `0x68`:

```go
machine.I2C0.Configure(machine.I2CConfig{Frequency: 400 * machine.KHz})

// Write the register pointer (0x75), then read one byte back.
buf := make([]byte, 1)
err := machine.I2C0.Tx(0x68, []byte{0x75}, buf)
if err != nil {
	// bus NACK, wrong address, or wiring fault
}
whoAmI := buf[0]
```

`Tx(addr, w, r)` is the whole I2C protocol in one call: it does a START, writes `w`, does a repeated START, reads `len(r)` bytes, then STOP. Pass `nil` for either side to do a write-only or read-only transaction.

**SPI** — full-duplex byte exchange:

```go
machine.SPI0.Configure(machine.SPIConfig{Frequency: 8 * machine.MHz, Mode: 0})
cs := machine.D10
cs.Configure(machine.PinConfig{Mode: machine.PinOutput})

cs.Low()                          // assert chip-select (active low)
rx := make([]byte, 2)
machine.SPI0.Tx([]byte{0x0F, 0x00}, rx) // send 2 bytes, receive 2
cs.High()                         // deassert
```

SPI has no addressing — you select a device by pulling its chip-select line low yourself.

**ADC** — read an analog voltage as a 16-bit value:

```go
machine.InitADC()
sensor := machine.ADC{Pin: machine.A0}
sensor.Configure(machine.ADCConfig{})

raw := sensor.Get() // 0..65535, normalised to 16-bit regardless of native resolution
voltage := float32(raw) / 65535 * 3.3
```

`Get` always returns a 16-bit value even on a 10- or 12-bit ADC; TinyGo left-shifts to normalise, so the same code is portable across chips.

**PWM** — dim an LED to 25% duty cycle:

```go
pwm := machine.PWM0 // a timer/PWM peripheral
pwm.Configure(machine.PWMConfig{Period: 1e9 / 500}) // 500 Hz, period in ns
ch, _ := pwm.Channel(machine.D3)
pwm.Set(ch, pwm.Top()/4) // duty = quarter of the period
```

`Top()` is the counter wrap value derived from the period; `Set(ch, n)` sets the compare value. Duty cycle is `n / Top()`.

**UART** — print over the serial port (`machine.Serial` is the default UART, wired to the USB-CDC on most boards):

```go
machine.Serial.Configure(machine.UARTConfig{BaudRate: 115200})
machine.Serial.Write([]byte("boot ok\r\n"))
```

`fmt.Println` and `print` also route to `machine.Serial`, which is what `tinygo monitor` reads back.

---

## The Scheduler: `none`, `tasks`, `asyncify`

This flag decides what a goroutine *is*. It is the most conceptually important knob in TinyGo because it changes the semantics of code you thought you understood.

| `-scheduler` | Goroutines? | `time.Sleep`? | Where it fits |
|--------------|-------------|---------------|---------------|
| `none` | No. `go f()` is a compile error if it would need scheduling. | Becomes a busy-wait/`__wasm_export` style block or is unsupported. | Smallest binaries; pure compute; wasm modules that only export functions. |
| `tasks` | Yes — cooperative, stackful coroutines. | Yields to the scheduler. | Default for most microcontrollers. |
| `asyncify` | Yes — via LLVM's Asyncify pass that saves/restores the stack. | Yields by unwinding to the host event loop. | Default for `-target=wasm`; the only way to get goroutines + blocking in the browser. |

The mechanism matters:

- **`tasks`** gives each goroutine its own small stack and switches between them cooperatively at blocking points (`time.Sleep`, channel ops, `select`). There is no preemption — a goroutine that never blocks never yields. This is fine on a microcontroller where you control all the code.

- **`asyncify`** is the wasm trick. WebAssembly has no native way to suspend a call stack, so TinyGo runs LLVM's Asyncify transform, which rewrites functions to be able to unwind their state to the linear-memory heap and resume later. A blocking goroutine unwinds all the way out to the JS host, returns control to the browser event loop, and resumes on the next tick. This is what lets `time.Sleep` and channels work inside a single-threaded wasm module without freezing the page. The cost is larger, slower code — every potentially-suspending function carries extra prologue/epilogue.

- **`none`** removes the scheduler entirely. No goroutine machinery, no per-goroutine stacks, the smallest possible binary. Use it when your wasm module is a library of pure functions the host calls (`//export add`) and never needs concurrency, or for the leanest microcontroller firmware that runs one loop.

Concrete consequence: this code

```go
go func() { for { led.High(); time.Sleep(time.Second); led.Low(); time.Sleep(time.Second) } }()
```

compiles and runs under `tasks` and `asyncify`, and *fails or hangs* under `none`. If a wasm module mysteriously freezes the moment a goroutine sleeps, you built it with the wrong scheduler.

Override the board default explicitly when it matters: `tinygo build -scheduler=asyncify -target=wasm`.

---

## Garbage Collector Modes

TinyGo ships several GC implementations because "one GC" cannot serve both a browser tab and a chip with 4 KB of RAM.

| `-gc` | Frees memory? | How it works | Use when |
|-------|---------------|--------------|----------|
| `conservative` (default) | Yes | Mark-sweep; treats any word that *looks like* a pointer as one. No write barriers, no compaction. | General default; safe on most targets. |
| `precise` | Yes | Mark-sweep with accurate pointer maps from the compiler, so non-pointer data is never mistaken for a live reference. | Newer, preferred when supported; fewer false retentions than conservative. |
| `leaking` | **No** | `malloc` only — every allocation leaks forever. | Short-lived programs, one-shot wasm calls, or firmware that pre-allocates everything up front and never frees. |
| `none` | N/A | Allocation is a fatal error. | Hard-real-time/no-heap code; forces you to avoid all dynamic allocation. |

The trade-offs you actually feel:

- **`conservative`** can retain garbage when an integer happens to hold a bit pattern that points into the heap. On a tiny heap this matters; on a large wasm heap it is usually noise. It needs no compiler cooperation, which is why it is the safe default.

- **`precise`** uses the compiler's pointer information so it never makes that mistake. It is the direction TinyGo is moving and is worth selecting where the target supports it.

- **`leaking`** is genuinely useful, not a foot-gun, in two cases: (1) a wasm function the host calls once per request and then discards the whole instance — the leak dies with the instance; (2) firmware that allocates all its buffers in `init`/`main` and then loops forever without allocating. In both, you pay zero GC cost and never run a collector.

- **`none`** turns any heap allocation into a link/runtime error, which is exactly what you want when proving a code path is allocation-free for a hard-real-time loop. Pair it with `-print-allocs=.` to see where allocations come from.

Find your allocations before choosing:

```bash
tinygo build -print-allocs=main -target=wasm ./...
```

This prints each heap allocation the optimiser could not stack-allocate, with its source location. Drive that list to zero and `-gc=none` or `-gc=leaking` becomes viable.

---

## Building and Serving Wasm with the Right `wasm_exec.js`

A TinyGo wasm module for the browser needs a JavaScript shim that implements the host functions the module imports (the `syscall/js` bridge, `time`, `console`, etc.). That shim is `wasm_exec.js`.

**The single most common TinyGo wasm bug is using the wrong `wasm_exec.js`.** TinyGo's runtime and the standard Go runtime export and import *different* host functions, and the file is versioned to the compiler. Three rules:

1. Use **TinyGo's** `wasm_exec.js`, never Go's. It lives in the install tree:
   ```bash
   cp "$(tinygo env TINYGOROOT)/targets/wasm_exec.js" .
   ```
2. Use the one from **the same TinyGo version** you built with. Upgrading TinyGo can change the ABI; a stale `wasm_exec.js` produces cryptic "import not satisfied" instantiation errors or silent hangs.
3. The standard-Go `wasm_exec.js` (from `$(go env GOROOT)/lib/wasm/`) will *not* instantiate a TinyGo module, and vice versa. They are not interchangeable.

A minimal working page:

```bash
tinygo build -o main.wasm -target=wasm ./browser
cp "$(tinygo env TINYGOROOT)/targets/wasm_exec.js" .
```

```html
<!DOCTYPE html>
<script src="wasm_exec.js"></script>
<script>
  const go = new Go(); // defined by TinyGo's wasm_exec.js
  WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject)
    .then(result => go.run(result.instance));
</script>
```

Serve it over HTTP, not `file://` — `instantiateStreaming` requires the `application/wasm` MIME type and a real fetch:

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

For server/edge wasm you do not use `wasm_exec.js` at all. A `-target=wasip1` module talks to the host through the WASI ABI and runs under `wasmtime`, `wasmer`, or an edge runtime — covered in [02-wasi-and-wasip1](../02-wasi-and-wasip1/).

---

## The Drivers Ecosystem (`tinygo.org/x/drivers`)

The `machine` package gives you raw buses; it does not know what a temperature sensor or an OLED display is. That layer is `tinygo.org/x/drivers` — a large, community-maintained module of device drivers written against `machine`'s interfaces.

The design is deliberately decoupled: a driver takes a *bus* (something implementing `drivers.I2C` or `drivers.SPI`), not a concrete chip. So the same driver compiles for any board whose `machine` package provides a compatible bus.

```go
import (
	"machine"
	"tinygo.org/x/drivers/bme280" // temp/humidity/pressure sensor
)

func main() {
	machine.I2C0.Configure(machine.I2CConfig{})
	sensor := bme280.New(machine.I2C0) // driver takes the bus, not the chip
	sensor.Configure()

	temp, _ := sensor.ReadTemperature() // milli-degrees C
	println(temp)
}
```

Add it like any Go dependency:

```bash
go get tinygo.org/x/drivers@latest
```

The repository covers displays (SSD1306, ST7789), sensors (BME280, MPU6050, DHT), radios (LoRa, ESP-AT WiFi), storage, and network stacks. Because drivers depend only on the `machine` interfaces, porting your application from one board to another is usually just changing `-target` — the driver code does not change.

If a driver fails to compile for your board, the cause is almost always that the board's `machine` variant does not implement a method the driver expects (e.g., no hardware PWM), not a bug in the driver.

---

## The Build → Flash → Debug Workflow

The loop has three stages. Know what each does.

**Build** — produce a binary without writing it anywhere:

```bash
tinygo build -o firmware.hex -target=arduino-nano33 ./...
```

Useful for CI, for inspecting size, and for producing artefacts you flash with an external tool.

**Flash** — build *and* write to the connected board in one step:

```bash
tinygo flash -target=arduino-nano33 ./...
```

`flash` consults the target JSON's `flash-method`. For boards that mount as a USB drive it copies a `.uf2`/`.hex` file. For others it shells out to `openocd` or a Black Magic Probe. If it cannot find the board, check the serial port glob and that the board is in bootloader mode.

**Monitor** — read the serial output (anything written to `machine.Serial`, including `println`):

```bash
tinygo monitor -target=arduino-nano33
```

This is your `printf` debugging channel. Set the baud rate to match your `UARTConfig`.

**Debug** — for source-level stepping, `tinygo gdb` builds with debug info and launches GDB against the board through `openocd`:

```bash
tinygo gdb -target=arduino-nano33 ./...
```

You can then set breakpoints, inspect registers, and single-step. This requires a debug probe (built into many dev boards, external for others). When stepping is not available, fall back to `tinygo monitor` plus `println`.

Note the inverse relationship with size flags: `tinygo gdb` *needs* debug info, while `-no-debug` strips it for the smallest release binary. Keep two build configurations.

---

## Optimisation and Size Flags

For embedded and wasm, binary size is a first-class concern. The relevant flags:

| Flag | Effect |
|------|--------|
| `-opt=z` | Optimise aggressively for size (smallest). |
| `-opt=s` | Optimise for size, less aggressive than `z`. |
| `-opt=1` / `-opt=2` | Optimise for speed (2 is the default-ish performance target). |
| `-no-debug` | Strip DWARF debug info — significant size win for release builds. |
| `-stack-size=<n>` | Set the goroutine/main stack size (e.g. `-stack-size=2kb`). Too small → stack overflow; too big → wasted RAM. |
| `-print-allocs=<pattern>` | Report heap allocations matching the package pattern (use `.` for all). |

A typical release build for the browser:

```bash
tinygo build -o main.wasm -target=wasm -opt=z -no-debug ./browser
```

`-opt=z -no-debug` together commonly halve the `.wasm` size versus a debug build. Measure both — for the browser, the bytes-over-the-wire are what users pay for.

`-stack-size` is the one to remember on microcontrollers: a deep call chain or a large stack-allocated array can overflow a too-small stack, and the symptom is a hard fault or silent reboot, not a clean panic. If firmware crashes on a code path that uses a big local buffer, raise the stack size before suspecting anything else.

---

## Common Errors and Their Real Causes

A short field guide.

### Browser: `LinkError: import object field ... is not a Function`

The classic wrong-`wasm_exec.js` error. The JS shim does not provide a host function the module imports. Cause: you used Go's `wasm_exec.js`, or a different TinyGo version's. Fix: copy the one from `$(tinygo env TINYGOROOT)/targets/wasm_exec.js` of the *exact* compiler you built with.

### Browser: module loads but hangs the moment a goroutine sleeps

Built with `-scheduler=none` (or `tasks`) for a wasm target that needs `asyncify`. Cause: blocking has nowhere to yield. Fix: build with `-scheduler=asyncify` (the wasm default — you probably overrode it).

### Embedded: `go f()` won't compile

You built with `-scheduler=none`. Cause: no goroutine scheduler exists. Fix: `-scheduler=tasks`, or remove the goroutine.

### Embedded: hard fault / random reboot on a code path with a big local array

Stack overflow. Cause: default stack too small for the call depth or local allocation. Fix: raise `-stack-size`, or move the buffer to a package-level variable.

### `flash` cannot find the board

Serial port mismatch or board not in bootloader mode. Cause: the target JSON's serial glob does not match your OS's device path, or the board needs a double-tap reset to enter the bootloader. Fix: check `tinygo info -target=...` for the expected port and put the board in bootloader mode.

### `package machine` won't build for `-target=wasm`

You wrote GPIO/I2C code and tried to compile it for the browser. Cause: there is no hardware in a tab; `machine` is nearly empty on wasm. Fix: guard hardware code behind build tags, or keep firmware and wasm in separate packages.

### A driver from `tinygo.org/x/drivers` fails to compile for your board

The board's `machine` variant lacks a peripheral the driver needs (e.g. hardware PWM or a second I2C bus). Cause: not all chips implement every `machine` capability. Fix: pick a board that has the peripheral, or use a software/bit-banged alternative if the driver offers one.

---

## When TinyGo Is Right and When It Is Wrong

| Situation | TinyGo? | Why |
|-----------|---------|-----|
| Microcontroller firmware (nRF52, RP2040, SAMD, ESP32) | Yes | The only realistic way to run Go on the metal. |
| Browser wasm where bundle size matters | Yes | Far smaller `.wasm` than standard Go. |
| Edge/serverless wasm (WASI), cold-start sensitive | Yes | Tiny modules instantiate fast. |
| Plugin systems sandboxing untrusted Go as wasm | Yes | Small, fast-to-load modules. |
| Server-side Go using the full standard library / reflection | No | TinyGo's stdlib and `reflect` support are partial. |
| Code relying on heavy `reflect`, `text/template`, or cgo-heavy deps | No | May not compile or behave subtly differently. |
| Anything needing the standard `gc` scheduler's preemption guarantees | No | TinyGo scheduling is cooperative. |
| Large concurrent server workloads | No | Standard Go's runtime is built for that; TinyGo is not. |

The pattern: **TinyGo wins where bytes and metal matter and the standard runtime is too big or absent; it loses where you need the full standard library and runtime.** It is a different compiler with a different stdlib, not a drop-in replacement.

---

## Best Practices

1. **Pin the TinyGo version and keep `wasm_exec.js` next to it.** Commit a build script that copies `wasm_exec.js` from `$(tinygo env TINYGOROOT)` so the shim can never drift from the compiler.
2. **Choose the scheduler explicitly in build commands.** Relying on the board default works until you read a confusing freeze. State `-scheduler=asyncify` (wasm) or `-scheduler=tasks` (embedded) in your Makefile.
3. **Drive allocations to a known set with `-print-allocs`.** Then you can reason about `-gc=leaking`/`none` and avoid GC pauses in tight loops.
4. **Separate firmware code from portable code by package and build tag.** `machine`-using code must not leak into packages you also compile for wasm or the host.
5. **Keep two build profiles.** A debug profile with `tinygo gdb`/full debug info, and a release profile with `-opt=z -no-debug`.
6. **Depend on `tinygo.org/x/drivers` interfaces, not concrete buses, in your own code** so porting between boards is a `-target` change.
7. **Measure `.wasm` size in CI.** A size regression is a user-facing regression for browser modules; gate on it.
8. **Use `tinygo info -target=...` before debugging a target problem.** It answers the RAM/triple/default-scheduler/GC questions instantly.

---

## Pitfalls You Will Meet in Real Projects

### Pitfall 1 — Copying Go's `wasm_exec.js` out of habit

You scaffolded a wasm project from a standard-Go tutorial and reused its `wasm_exec.js`. The module fails to instantiate. Fix: always copy from `$(tinygo env TINYGOROOT)/targets/`.

### Pitfall 2 — Upgrading TinyGo without refreshing `wasm_exec.js`

A `brew upgrade tinygo` changed the runtime ABI; the committed shim is now stale and the page hangs or throws a `LinkError`. Fix: regenerate `wasm_exec.js` as part of every build, never commit it as a frozen file.

### Pitfall 3 — Goroutine freeze from the wrong scheduler

A wasm module worked until someone added a `time.Sleep` in a goroutine, and the tab froze. Cause: built with `-scheduler=none`. Fix: `-scheduler=asyncify`.

### Pitfall 4 — Allocating in an interrupt handler

A `SetInterrupt` callback called `fmt.Sprintf` or allocated a slice; the device locked up or corrupted the heap. Cause: the GC/allocator is not safe to run in interrupt context. Fix: do no allocation and no blocking in interrupt handlers; set a flag and handle it in the main loop.

### Pitfall 5 — Stack overflow from a large local buffer

A function declared `var buf [4096]byte` on a chip with a 2 KB default stack; the device reboots on that path. Cause: stack overflow with no clean panic. Fix: raise `-stack-size` or make the buffer package-level.

### Pitfall 6 — Assuming the full standard library

Code using `text/template`, deep `reflect`, or `net/http`'s server compiled fine with `go build` but fails or misbehaves with TinyGo. Cause: TinyGo's stdlib is a subset. Fix: check the support matrix on tinygo.org before depending on a package.

### Pitfall 7 — Trying to use `machine` in browser wasm

Hardware code (GPIO, I2C) was imported into a package also built for `-target=wasm`; it would not compile. Cause: `machine` is essentially empty on wasm. Fix: separate hardware and browser code by package and build tags.

### Pitfall 8 — Forgetting to serve wasm over HTTP

Opening `index.html` as `file://` gave a fetch/MIME error. Cause: `instantiateStreaming` needs a real HTTP server serving `application/wasm`. Fix: run a local server (`python3 -m http.server`).

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Explain how `-target` resolves through an inheritance chain to a triple, register layout, and linker script
- [ ] Describe why the `machine` package is build-tag selected rather than interface-dispatched
- [ ] Write runnable GPIO, I2C, ADC, and PWM code using `Configure`-then-use
- [ ] State what each `-scheduler` value does to goroutines, channels, and `time.Sleep`
- [ ] Explain why wasm goroutines need `asyncify` and what it costs
- [ ] Choose a `-gc` mode and justify it from an allocation profile
- [ ] Build and serve a browser wasm module with the correct, version-matched `wasm_exec.js`
- [ ] Add and use a `tinygo.org/x/drivers` driver and explain its bus-decoupled design
- [ ] Run the build → flash → monitor → gdb loop and pick size/debug flags appropriately
- [ ] Diagnose every error in the field guide from a one-line symptom

---

## Summary

TinyGo is a second Go compiler tuned for the two places the standard one fits badly: tiny wasm and bare metal. The middle-level mechanics are: `-target` resolves through an inheritance chain of board → chip → CPU → generic JSON into an LLVM triple, register map, and linker script; the `machine` package is a compile-time-selected HAL where pins are cheap values and I/O is inlined register stores; `-scheduler` redefines what a goroutine is (`none` = no concurrency and smallest code, `tasks` = cooperative coroutines for embedded, `asyncify` = stack-unwinding to the host event loop for wasm); `-gc` trades freeing for size and pauses (`conservative` default, `precise` accurate, `leaking` for one-shot/pre-allocated code, `none` for no-heap loops). Browser wasm lives or dies by using TinyGo's own version-matched `wasm_exec.js` over HTTP; the `tinygo.org/x/drivers` ecosystem layers bus-decoupled device drivers on top of `machine`; and the build → flash → monitor → gdb workflow, with `-opt=z -no-debug` for release and `-print-allocs`/`-stack-size` for tuning, is the daily loop. Reach for TinyGo when bytes and metal matter; reach for standard Go when the full runtime and standard library do.

## Further Reading

- TinyGo official documentation — https://tinygo.org/docs/
- Sibling topics: [01-goos-js-wasm-browser](../01-goos-js-wasm-browser/), [02-wasi-and-wasip1](../02-wasi-and-wasip1/), [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/), [05-wasm-in-production](../05-wasm-in-production/)
