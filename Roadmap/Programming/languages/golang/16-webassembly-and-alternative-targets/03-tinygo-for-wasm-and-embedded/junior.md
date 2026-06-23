# TinyGo for Wasm & Embedded — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What is TinyGo?" and "Why would I use a *different* Go compiler to make tiny WebAssembly modules and blink an LED on a microcontroller?"

When you write Go, you almost always use the official compiler — the one that ships with the Go distribution, internally called the `gc` toolchain. It is excellent at building servers, CLIs, and anything that runs on a normal computer. But it has two weaknesses that matter in two specific worlds:

1. **WebAssembly in the browser.** A "hello world" compiled with `GOOS=js GOARCH=wasm go build` produces a `.wasm` file that is *megabytes* in size — often 2 MB or more — because the Go runtime and garbage collector are bundled in. That is a lot to download just to print a string.
2. **Microcontrollers.** A typical microcontroller (the chip on an Arduino, a Raspberry Pi Pico, a BBC micro:bit) has *kilobytes* of RAM, not gigabytes. The standard Go runtime simply does not fit. There is no operating system there at all.

**TinyGo** exists to win in both of those worlds. It is an *alternative Go compiler* that reads the same Go source code you already write, but compiles it through a different backend (LLVM) to produce binaries that are dramatically smaller and can run where the standard runtime cannot.

```bash
# The same trivial program, two compilers:
tinygo build -o main.wasm -target wasm ./   # ~10–60 KB
GOOS=js GOARCH=wasm go build -o main.wasm    # ~2 MB+
```

That size difference — kilobytes versus megabytes — is the whole reason TinyGo exists for Wasm. And the ability to run with no operating system at all is the reason it exists for embedded.

After reading this file you will:
- Understand what TinyGo is and why it is a *separate* compiler from `gc`
- Quantify the binary-size motivation for WebAssembly
- Install TinyGo and verify it works
- Build your first `.wasm` module and run it in a browser
- Write your first "blink an LED" program and flash it to a microcontroller
- Know the most important build flags (`-target`, `-gc`, `-scheduler`, `-opt`)
- Understand clearly that **TinyGo is not a drop-in replacement** for the standard Go compiler

You do **not** yet need to understand the WASI ABI, advanced JS interop, or production deployment. This file is about the first time you say "I have Go code, and I want it to be *tiny* — small enough for a browser or a chip."

---

## Prerequisites

- **Required:** A working standard Go installation. TinyGo reuses Go's standard library source and tools. Check with `go version` (Go 1.18+ recommended).
- **Required:** Comfort writing and running a basic Go program (`package main`, `func main`, `go run`).
- **Required:** Comfort with a terminal — `cd`, `ls`, running commands, opening files.
- **Helpful for the Wasm half:** Knowing how to open an HTML file in a browser and read the browser's developer console.
- **Helpful for the embedded half:** A physical board (Raspberry Pi Pico, Arduino, BBC micro:bit) and a USB cable. You can read and understand the embedded section without hardware, but to actually `flash` you need a device.
- **Optional:** Familiarity with [01-goos-js-wasm-browser](../01-goos-js-wasm-browser/junior.md), which covers the standard-compiler path to browser Wasm. TinyGo is the leaner alternative.

If `go version` prints a recent version and you can install one CLI tool, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **TinyGo** | An alternative Go compiler built on the LLVM backend, optimized for small binaries on WebAssembly and microcontrollers. |
| **`gc` toolchain** | The *official* Go compiler that ships with the Go distribution. The default `go build` uses it. TinyGo is *not* this. |
| **LLVM** | A widely used compiler backend (also used by Rust, Swift, Clang). TinyGo compiles Go down to LLVM IR, then to machine/Wasm code. |
| **WebAssembly (Wasm)** | A compact binary instruction format that runs in browsers and other sandboxed runtimes at near-native speed. |
| **`-target`** | The single most important TinyGo flag. It selects *what* you are building for: `wasm`, `wasi`, `arduino`, `pico`, `microbit`, etc. |
| **`wasm_exec.js`** | A JavaScript "glue" file that loads a Go-compiled `.wasm` module in the browser. TinyGo ships its *own* version that must match the TinyGo binary. |
| **`machine` package** | TinyGo's hardware-access package: GPIO pins, I2C, SPI, ADC, PWM, UART. Has no equivalent in standard Go. |
| **GPIO** | "General-Purpose Input/Output" — a pin on a microcontroller you can set high (on) or low (off), or read. Driving an LED uses GPIO. |
| **Flash (verb)** | To write a compiled firmware image onto a microcontroller's persistent memory so it runs on power-up. `tinygo flash`. |
| **Bare metal** | Running directly on hardware with *no operating system* underneath. Microcontroller programs are bare metal. |
| **WASI** | "WebAssembly System Interface" — a standard that lets Wasm run *outside* the browser (server, edge) with file/clock access. Targets `wasi` / `wasip1`. |
| **Scheduler** | The mechanism that runs goroutines. TinyGo offers `none`, `tasks`, or `asyncify` — not the full `gc` scheduler. |
| **Conservative GC** | A garbage collector that does not know exactly which bytes are pointers, so it errs on the safe side. One of TinyGo's GC modes. |

---

## Core Concepts

### TinyGo is a *different compiler*, not a library

This is the single most important idea on the page. You do not `import "tinygo"`. You do not add a dependency. TinyGo is an entirely separate program — `tinygo` — that you install alongside Go. You point it at the *same Go source files* and it produces a *different, smaller* binary.

```bash
go build   ./...     # uses the official gc compiler
tinygo build ./...   # uses TinyGo (LLVM backend)
```

Because it is a separate compiler with its own runtime, it makes different choices: a smaller standard library, a simpler garbage collector, a cooperative scheduler. Those choices are exactly what buy you the small size — and exactly why some Go programs that compile with `gc` will *not* compile with TinyGo (more on that below).

### Why the size is so different (the LLVM + minimal-runtime story)

The standard `gc` Wasm binary bundles a full runtime: a sophisticated garbage collector, the full goroutine scheduler, reflection support, and a large slice of the standard library. All of that is necessary on a server but enormous in a browser.

TinyGo, by contrast:
- Uses LLVM's aggressive size optimizations (`-opt=z` means "optimize for size").
- Ships a minimal runtime and a simpler GC.
- Includes only the parts of the standard library your program actually uses.

The result is a `.wasm` that is **tens of kilobytes** where `gc` produces **megabytes**. For a download served to every visitor of a web page, that is the difference between "instant" and "noticeably slow."

### The two flagship targets

TinyGo shines in two places, and you select between them with `-target`:

**1. WebAssembly.**
- `-target wasm` — for the **browser**. Produces a module loaded by `wasm_exec.js`.
- `-target wasi` or `-target wasip1` — for running **outside the browser** (server, edge, plugins) using the WASI system interface.

**2. Microcontrollers (embedded).**
- `-target arduino`, `-target pico`, `-target microbit`, `-target esp32`, and many more.
- Each target encodes the chip, its memory layout, and how to flash it.

### `wasm_exec.js` must come from TinyGo — never mix it with Go's

Both the standard Go compiler and TinyGo ship a file called `wasm_exec.js`. **They are not interchangeable.** They define the exact set of host functions the Wasm module expects. If you load a TinyGo `.wasm` with the standard Go `wasm_exec.js` (or vice versa), it will fail in confusing ways.

Always copy TinyGo's copy:

```bash
cp "$(tinygo env TINYGOROOT)/targets/wasm_exec.js" .
```

Use the one that matches the compiler that built the `.wasm`. This is one of the most common beginner mistakes.

### The `machine` package: talking to hardware

Standard Go has no concept of a hardware pin — it assumes an operating system. TinyGo adds the `machine` package, which gives you direct access to the chip:

- `machine.Pin` — a single GPIO pin.
- `pin.Configure(...)` — set it as input or output.
- `pin.High()` / `pin.Low()` — drive an output pin on or off.
- `pin.Get()` — read an input pin.
- Plus `machine.I2C0`, `machine.SPI0`, ADC, PWM, UART for richer peripherals.

There is no OS, no `os.Open`, no network by default. You are writing directly to the silicon.

### TinyGo is *not* a drop-in replacement (read this twice)

TinyGo aims for high Go compatibility but does **not** support everything the `gc` compiler does:
- **Subset of the standard library.** Many packages work; some (especially networking and OS-heavy ones) do not, or only partially.
- **Limited `reflect`.** Code that leans heavily on reflection (some JSON libraries, ORMs) may fail to compile or behave differently.
- **Cooperative scheduler.** Goroutines exist but there is no true OS-thread parallelism; `runtime.GOMAXPROCS` does not give you multiple cores.
- **Different garbage collectors.** `conservative`, `leaking`, or `precise` — not the production `gc` collector.
- **Slower compiles.** LLVM optimization takes longer than `gc`'s fast compiler.
- **Not 100% compatible.** Some valid `gc` programs simply will not build under TinyGo.

The right mental stance: **use TinyGo for what it is good at** (tiny Wasm, embedded), and keep using the standard compiler for everything else.

---

## Real-World Analogies

**1. A folding travel toothbrush vs. an electric toothbrush.** The electric one (standard `gc` Go) has more features and is great at home. But you cannot pack it into a tiny carry-on or run it without a power outlet. The folding travel brush (TinyGo) does the essential job in a fraction of the space, exactly where space is scarce — your pocket, a browser tab, a chip.

**2. A pocket dictionary vs. the full encyclopedia.** Standard Go ships the whole encyclopedia (full runtime, full stdlib) so it is ready for anything. TinyGo ships just the words you actually used in *your* sentence. Much lighter to carry, but it will not have the entry you forgot to bring.

**3. A studio apartment vs. a mansion.** A microcontroller is a studio apartment with kilobytes of room. You cannot move a mansion's worth of furniture (the full Go runtime) into it. TinyGo packs only the essentials so the program fits.

**4. A translator who specializes.** The `gc` compiler is a general translator who handles every dialect. TinyGo is a specialist translator fluent in "small" — brilliant for two specific destinations (browser and bare metal), but it will politely refuse a few sentences the generalist would have translated.

---

## Mental Models

### Model 1 — Same source, different oven

Your `.go` files are the dough. `go build` and `tinygo build` are two different ovens. Same ingredients in; very different bread out. You do not rewrite the recipe — you choose which oven.

### Model 2 — `-target` is the destination address

Everything TinyGo does flows from `-target`. It is the one flag that decides: browser Wasm? server Wasm? which chip? what memory layout? how to flash? Pick the target first; the rest follows.

### Model 3 — Size is bought with subtraction

TinyGo's small binaries come from *removing* things: less runtime, simpler GC, pruned stdlib, no parallelism. Every kilobyte saved is a feature given up. That trade is great for browsers and chips and wrong for servers.

### Model 4 — The Wasm module is a guest; `wasm_exec.js` is the host's interpreter

The `.wasm` file cannot touch the browser directly. It speaks only to a host. `wasm_exec.js` is the interpreter standing between the guest module and the JavaScript world. Guest and interpreter must speak the *same* dialect — hence "never mix TinyGo's and Go's `wasm_exec.js`."

### Model 5 — On embedded, *you are the operating system*

There is no OS to call. No `println` to a terminal that exists. When you set a pin high and sleep, *your code* is the only thing running on the chip. The blink loop is literally the entire program the hardware executes, forever.

### Model 6 — Build sources, layered (where TinyGo fits)

```
Standard Go program
   └── go build (gc)  ──> native binary OR multi-MB wasm

Tiny / constrained target
   └── tinygo build (LLVM)
         ├── -target wasm      ──> KB-scale browser wasm
         ├── -target wasi      ──> server/edge wasm
         └── -target pico/...  ──> microcontroller firmware
```

---

## Pros & Cons

### Pros

- **Tiny WebAssembly.** Kilobytes instead of megabytes — fast to download, cache, and start.
- **Runs on microcontrollers.** Fits in kilobytes of RAM where standard Go cannot run at all.
- **Same language you know.** You write ordinary Go syntax; no new language to learn.
- **Rich hardware support.** The `machine` package plus drivers at `tinygo.org/x/drivers` cover hundreds of boards and peripherals.
- **One toolchain, two worlds.** Browser, server (WASI), and bare metal all from the same compiler.
- **LLVM optimizations.** Mature, aggressive size and speed optimization passes.

### Cons

- **Not 100% Go-compatible.** A subset of the standard library; some programs will not build.
- **Limited reflection.** Heavy `reflect` users (some serialization libs) may break.
- **No true parallelism.** Cooperative scheduler only; goroutines do not spread across cores.
- **Different GC behavior.** Conservative or leaking collectors have different memory characteristics.
- **Slower compiles.** LLVM is thorough but not fast.
- **A second toolchain to manage.** You install and version TinyGo separately from Go.

The trade is excellent when you *need* small or *need* bare metal. It is the wrong tool for a normal backend service.

---

## Use Cases

You should reach for TinyGo when:

- **You ship Go logic to the browser** and the standard `gc` Wasm binary is too large to download comfortably.
- **You build edge/serverless Wasm** (plugins, filters, functions) where startup time and module size matter — using the WASI targets.
- **You program microcontrollers** — Raspberry Pi Pico, Arduino, micro:bit, ESP32 — in Go instead of C.
- **You build IoT or hobby hardware** — sensors, LEDs, motors, displays — with `machine` and the driver library.
- **You want one language across web, edge, and device.**

You should **not** use TinyGo when:

- You are building a normal server, CLI, or desktop tool — use the standard compiler.
- Your program depends on packages or reflection TinyGo does not support.
- You need true multi-core parallelism.
- You need the exact runtime/GC behavior of production `gc` Go.

---

## Code Examples

### Example 1 — Install and verify

On macOS (Homebrew):

```bash
brew tap tinygo-org/tools
brew install tinygo
tinygo version
# tinygo version 0.x.y darwin/arm64 (using go version go1.x ...)
```

On Linux you can download a release binary from the TinyGo releases page and add it to your `PATH`. Then confirm the environment:

```bash
tinygo env TINYGOROOT
# /opt/homebrew/Cellar/tinygo/0.x.y/...   (path varies by install)
```

If `tinygo version` prints a version line, you are ready.

### Example 2 — Your first browser Wasm module

Create a fresh folder and a `main.go`. In the browser target, your program prints to the developer console.

```bash
mkdir tinywasm
cd tinywasm
go mod init example.com/tinywasm
```

```go
// main.go
package main

func main() {
    println("hello from TinyGo wasm")
}
```

Build it for the browser:

```bash
tinygo build -o main.wasm -target wasm ./
ls -lh main.wasm
# -rw-r--r--  ...  ~15K  main.wasm     <- kilobytes, not megabytes
```

Copy TinyGo's *own* glue file (never Go's):

```bash
cp "$(tinygo env TINYGOROOT)/targets/wasm_exec.js" .
```

Create `index.html` that loads both:

```html
<!doctype html>
<html>
  <head><meta charset="utf-8"><title>TinyGo Wasm</title></head>
  <body>
    <script src="wasm_exec.js"></script>
    <script>
      const go = new Go();
      WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject)
        .then((result) => go.run(result.instance));
    </script>
  </body>
</html>
```

Serve the folder (browsers will not `fetch` `.wasm` from `file://`):

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`, open the browser developer console, and you will see:

```
hello from TinyGo wasm
```

### Example 3 — Compare the size for yourself

Build the same `main.go` with both compilers and look:

```bash
tinygo build -o tiny.wasm -target wasm ./
GOOS=js GOARCH=wasm go build -o std.wasm ./

ls -lh tiny.wasm std.wasm
# tiny.wasm   ~15K
# std.wasm    ~2.0M
```

Two orders of magnitude. That gap is the entire reason TinyGo exists for the web.

### Example 4 — A WASI module (Wasm outside the browser)

For server/edge runtimes, target `wasi` (or `wasip1`). These modules can use a standard entry point and run under a Wasm runtime like `wasmtime`.

```go
// main.go
package main

import "fmt"

func main() {
    fmt.Println("hello from a WASI module")
}
```

```bash
tinygo build -o app.wasm -target wasi ./
wasmtime app.wasm
# hello from a WASI module
```

This is the gateway to edge functions and plugins; the dedicated topic is [02-wasi-and-wasip1](../02-wasi-and-wasip1/junior.md).

### Example 5 — Your first embedded program: blink an LED

This is the "hello world" of microcontrollers. The board's onboard LED turns on and off once per second, forever.

```go
// main.go
package main

import (
    "machine"
    "time"
)

func main() {
    led := machine.LED
    led.Configure(machine.PinConfig{Mode: machine.PinOutput})

    for {
        led.High()                 // LED on
        time.Sleep(time.Millisecond * 500)
        led.Low()                  // LED off
        time.Sleep(time.Millisecond * 500)
    }
}
```

Notes for a beginner reading this:
- `machine.LED` is a convenience constant for the board's built-in LED pin. On many boards it is the same as a numbered pin like `machine.GPIO25` on a Pico.
- `Configure` tells the chip the pin is an *output* (we drive it, we do not read it).
- `High()` sources voltage (LED on); `Low()` grounds it (LED off).
- The `for {}` loop never ends — there is no OS to return to. This loop *is* the program.

### Example 6 — Flash it to a real board

With a Raspberry Pi Pico connected over USB (in bootloader mode):

```bash
tinygo flash -target=pico ./
```

`flash` compiles *and* writes the firmware onto the device in one step. Other targets:

```bash
tinygo flash -target=arduino  ./
tinygo flash -target=microbit ./
tinygo flash -target=esp32     ./
```

If the LED starts blinking, you just ran Go on bare metal.

### Example 7 — Reading a button (GPIO input)

Output is half the story; here is reading a pin:

```go
package main

import (
    "machine"
    "time"
)

func main() {
    led := machine.LED
    led.Configure(machine.PinConfig{Mode: machine.PinOutput})

    button := machine.GP15 // a pin wired to a button (board-specific)
    button.Configure(machine.PinConfig{Mode: machine.PinInputPulldown})

    for {
        if button.Get() { // true when the button is pressed
            led.High()
        } else {
            led.Low()
        }
        time.Sleep(time.Millisecond * 10)
    }
}
```

`PinInputPulldown` keeps the pin at a known "low" when nothing is pressed, so `Get()` reads `false` until the button connects it to high.

---

## Coding Patterns

### Pattern: pick the target first, then write

Decide *where* the code runs (`wasm`, `wasi`, or a specific board) before you write. The available standard-library packages, the entry point, and even whether you can use `fmt` depend on the target.

### Pattern: the forever loop on embedded

Every bare-metal `main` ends in an infinite loop. If `main` returns, the chip has nothing to do — behavior is undefined or it halts. Always:

```go
for {
    // do work
    time.Sleep(...)
}
```

### Pattern: copy `wasm_exec.js` as a build step

Automate copying TinyGo's glue file so you never accidentally ship Go's version:

```Makefile
wasm:
	tinygo build -o main.wasm -target wasm ./
	cp "$$(tinygo env TINYGOROOT)/targets/wasm_exec.js" .
```

### Pattern: drivers for peripherals

Do not hand-roll I2C/SPI byte protocols. Use the maintained driver library:

```go
import "tinygo.org/x/drivers/ssd1306" // an OLED display driver
```

Browse `tinygo.org/x/drivers` for sensors, displays, and radios before writing your own.

### Pattern: optimize for size when shipping Wasm

For browser delivery, build with size optimization and strip debug info:

```bash
tinygo build -o main.wasm -target wasm -opt=z -no-debug ./
```

---

## Clean Code

- **Keep TinyGo and `gc` builds clearly labeled.** If a folder is meant for TinyGo, say so in the README and the build commands. Mixing expectations confuses contributors.
- **Use the correct `wasm_exec.js` and commit *the matching version*.** Re-copy it whenever you upgrade TinyGo.
- **Name pins with intent, not numbers.** Assign `led := machine.GP25` once with a meaningful name rather than sprinkling raw pin numbers through the loop.
- **Centralize sleep durations.** Use named constants (`const blinkInterval = 500 * time.Millisecond`) instead of magic numbers in the loop.
- **Do not paste server code into embedded `main`.** No `net/http`, no goroutine pools spanning cores — match the code to the constrained environment.

---

## Product Use / Feature

TinyGo shows up in real products in three shapes:

- **Lightweight web features.** Compute-heavy logic (parsers, validators, codecs) compiled to a tiny `.wasm` and called from JavaScript, without shipping a 2 MB runtime to every visitor.
- **Edge and plugin systems.** WASI modules used as filters, policies, or functions in proxies, CDNs, and FaaS platforms, where module size and cold-start time directly affect cost and latency.
- **Devices and IoT.** Firmware for sensors, controllers, wearables, and hobby electronics — written in Go instead of C, with the same language the team already uses on the backend.

For teams that already write Go, TinyGo lets them extend that single skillset to the browser, the edge, and the physical device without adopting C, Rust, or JavaScript build chains for those layers.

---

## Error Handling

TinyGo's most common errors are *build-time* and target-related, not runtime crashes.

### "package X is not supported" / undefined symbols

You imported a standard-library or third-party package TinyGo does not implement for your target. Fix: check whether the package is supported, or swap it for a TinyGo-friendly alternative. The networking and OS-heavy parts of stdlib are the usual culprits.

### Wasm loads but nothing happens / "WebAssembly.instantiate ... LinkError"

Almost always a **`wasm_exec.js` mismatch** — you used Go's glue file with a TinyGo module or an outdated TinyGo glue file. Fix:

```bash
cp "$(tinygo env TINYGOROOT)/targets/wasm_exec.js" .
```

### `.wasm` does not load at all (404 / CORS)

You opened `index.html` via `file://`, or the server is not serving `.wasm` correctly. Fix: serve over HTTP (`python3 -m http.server`) and confirm the browser's network tab shows `main.wasm` with status 200.

### `tinygo flash` cannot find the device

The board is not in bootloader mode, the cable is charge-only (no data lines), or the wrong `-target` was given. Fix: re-enter bootloader mode (often hold BOOTSEL while plugging in, for a Pico), use a data cable, and double-check the target name.

### `reflect`-related panics or compile failures

A library you imported relies on reflection TinyGo cannot fully support. Fix: choose a lighter library, or restructure to avoid heavy reflection (e.g., hand-written encoding instead of reflection-based JSON).

### Out-of-memory / device resets on embedded

You allocated too much for the chip's tiny RAM, or your GC mode is unsuitable. Fix: allocate less, reuse buffers, and consider `-gc=leaking` for short-lived programs or `-gc=conservative` as a default.

---

## Security Considerations

- **Wasm runs in a sandbox.** A browser `.wasm` cannot touch the filesystem or network except through the host (`wasm_exec.js` / JS) you explicitly wire up. That is a security *feature* — treat the boundary deliberately.
- **WASI grants capabilities explicitly.** Outside the browser, a WASI module only gets the files, env vars, and clocks the runtime hands it. Grant the minimum needed.
- **Match `wasm_exec.js` to the binary you trust.** A mismatched or tampered glue file changes the host interface; always copy it from your own verified TinyGo install.
- **Embedded code is the whole trust boundary.** On bare metal there is no OS to enforce permissions. A bug can drive any pin; physical safety (motors, heaters) depends on your code being correct.
- **Pin debug info from production Wasm.** Build with `-no-debug` so you do not ship symbol names and source paths to every visitor.
- **Validate input crossing the JS/Wasm boundary** just as you would any external input — the module is only as safe as the data the host feeds it.

---

## Performance Tips

- **Optimize for size on the web:** `-opt=z` (smallest) or `-opt=s` for shipped Wasm; `-opt=2` favors speed when size is less critical.
- **Strip debug info for delivery:** `-no-debug` shrinks the module further and removes metadata.
- **Compress on the wire.** Serve `.wasm` with gzip or Brotli; Wasm compresses well, multiplying TinyGo's size advantage.
- **Choose the right GC.** `-gc=leaking` is fastest and smallest for short-lived programs that never need to free memory; `-gc=conservative` is a safe general default; `-gc=precise` tracks pointers more accurately.
- **Pick the scheduler deliberately.** `-scheduler=none` removes goroutine machinery entirely (smallest, no concurrency); `-scheduler=tasks` enables cooperative goroutines; `-scheduler=asyncify` supports goroutines on Wasm.
- **Expect slower compiles.** LLVM optimization is thorough. This is a build-time cost, not a runtime one.
- **Reuse buffers on embedded.** Allocation pressure hurts on kilobytes of RAM; preallocate and reuse.

---

## Best Practices

1. **Always copy TinyGo's own `wasm_exec.js`** from `$(tinygo env TINYGOROOT)/targets/`. Never reuse Go's.
2. **Lead with `-target`.** It determines everything else; choose it consciously.
3. **Keep using the standard compiler for normal programs.** TinyGo is a specialist, not a replacement.
4. **Verify support before importing a library.** Especially anything network-, OS-, or reflection-heavy.
5. **Build shipped Wasm with `-opt=z -no-debug`** and serve it compressed.
6. **End every embedded `main` in a `for {}` loop.** Never let `main` return on bare metal.
7. **Prefer the official driver library** (`tinygo.org/x/drivers`) over hand-rolled peripheral code.
8. **Re-copy `wasm_exec.js` after every TinyGo upgrade.** Versions are matched.
9. **Test on the real device early.** Simulators help, but timing and pin behavior are best confirmed on hardware.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Mixing the two `wasm_exec.js` files

The classic. Go's glue file with a TinyGo module (or vice versa) produces cryptic link errors. Always copy from the *same* compiler that built the `.wasm`.

### Pitfall 2 — Forgetting it is a separate install

`go build` working does not mean `tinygo build` will — they are different programs. Install TinyGo explicitly and check `tinygo version`.

### Pitfall 3 — Assuming all stdlib works

`fmt` and `println` often work; large parts of `net`, `os`, and reflection-heavy packages may not. Check support per target before relying on a package.

### Pitfall 4 — `main` returning on a microcontroller

If your embedded `main` reaches the end, the program has nowhere to go. Always loop forever.

### Pitfall 5 — Wrong target for the board

`-target=pico` flashed onto an Arduino will not work. The target encodes the chip and its memory map. Match it exactly.

### Pitfall 6 — Serving Wasm from `file://`

Browsers block `fetch` of local files. The module appears to "not load." Serve over HTTP.

### Pitfall 7 — Charge-only USB cable

Many cheap cables carry power but not data. `tinygo flash` then cannot see the device. Use a known data cable.

### Pitfall 8 — Expecting parallel goroutines

TinyGo's scheduler is cooperative; goroutines interleave but do not run on multiple cores. CPU-bound parallel speedups will not appear.

### Pitfall 9 — Heavy allocation on a tiny chip

A few large slices can exhaust kilobytes of RAM and reset the board. Preallocate and reuse; watch your memory.

---

## Common Mistakes

- **Using Go's `wasm_exec.js` with a TinyGo module.** The number-one mistake. Copy TinyGo's.
- **Treating TinyGo as a drop-in replacement.** It is a specialist; some programs will not build.
- **Skipping `-target`.** Without the right target you build for the wrong destination — or fail outright.
- **Importing unsupported packages and blaming TinyGo.** Check support first.
- **Letting embedded `main` return.** Always loop forever.
- **Opening the HTML from disk** instead of serving over HTTP.
- **Shipping Wasm with debug info** instead of `-opt=z -no-debug`.
- **Hand-writing peripheral protocols** instead of using `tinygo.org/x/drivers`.
- **Forgetting to re-copy `wasm_exec.js` after upgrading TinyGo.**

---

## Common Misconceptions

> *"TinyGo is a library I import into my Go program."*

No. It is a separate compiler binary (`tinygo`). You point it at the same source files; you do not import anything.

> *"TinyGo replaces the standard Go compiler."*

No. It is for tiny Wasm and microcontrollers. For normal programs, keep using `gc`. They coexist.

> *"Any Go program will compile with TinyGo."*

No. TinyGo supports a *subset* — limited reflection, partial stdlib, a different scheduler. Some valid `gc` programs will not build.

> *"Go's `wasm_exec.js` and TinyGo's are the same file."*

No. They define different host interfaces and are not interchangeable. Use the one matching your compiler.

> *"Goroutines in TinyGo run in parallel like on a server."*

No. The scheduler is cooperative; there is no true multi-core parallelism.

> *"Embedded Go runs on top of an operating system."*

No. Microcontroller code is *bare metal* — no OS at all. Your loop is the only thing running.

> *"Smaller binaries mean TinyGo is just a better compiler."*

No. The small size comes from *removing* capabilities (runtime, GC features, stdlib, parallelism). It is a trade, ideal only for constrained targets.

---

## Tricky Points

- **`machine.LED` is a board-specific alias.** On a Pico it maps to a specific GPIO; on another board it may differ. The same source can light a different physical pin on different `-target`s.
- **`time.Sleep` works on embedded** — TinyGo implements it against the chip's timer — but there is no OS scheduler behind it.
- **`println` (builtin) and `fmt.Println` differ in cost.** The builtin `println` is cheaper and more widely available on constrained targets; `fmt` pulls in more code.
- **`-target wasi` vs `-target wasip1`.** Both target WebAssembly outside the browser; `wasip1` names the WASI Preview 1 ABI explicitly. For the browser you want `-target wasm`, which is different.
- **`tinygo flash` = build + write.** `tinygo build` only produces a file; `flash` also programs the device.
- **GC mode affects both size and behavior.** `-gc=leaking` never frees memory — perfectly fine for a program that runs once and exits, dangerous for a long-running loop.
- **`tinygo env TINYGOROOT`** is how you locate TinyGo's own files (including `wasm_exec.js`) regardless of how it was installed.

---

## Test

Try the Wasm half end to end in a scratch folder (requires TinyGo installed):

```bash
mkdir tinygo-test && cd tinygo-test
go mod init example.com/tt
cat > main.go <<'EOF'
package main

func main() {
    println("it works")
}
EOF
tinygo build -o main.wasm -target wasm ./
cp "$(tinygo env TINYGOROOT)/targets/wasm_exec.js" .
ls -lh main.wasm wasm_exec.js
```

Expected: a small `main.wasm` (tens of KB) and a `wasm_exec.js` copied from TinyGo's targets directory.

Now answer:
1. Roughly how large is a TinyGo "hello world" `.wasm` versus the standard `gc` one? (Answer: tens of KB vs. ~2 MB+.)
2. Which `wasm_exec.js` must you use with a TinyGo module? (Answer: the one shipped by TinyGo, from `$(tinygo env TINYGOROOT)/targets/`.)
3. What flag selects whether you are building for the browser, a server (WASI), or a specific board? (Answer: `-target`.)
4. What must every embedded `main` function end with, and why? (Answer: a `for {}` loop, because there is no OS to return to.)
5. Name two reasons TinyGo is *not* a drop-in replacement for `gc`. (Answer: subset of stdlib, limited reflection, cooperative scheduler, different GC — any two.)

---

## Tricky Questions

**Q1.** Why is the standard Go Wasm binary so much larger than TinyGo's?

A. The `gc` Wasm output bundles the full Go runtime — a sophisticated GC, the complete scheduler, reflection, and a large stdlib slice. TinyGo ships a minimal runtime, a simpler GC, prunes unused stdlib, and applies LLVM size optimization, yielding KB instead of MB.

**Q2.** I built a `.wasm` with TinyGo, used Go's `wasm_exec.js`, and the browser throws a `LinkError`. Why?

A. The glue files are not interchangeable. They declare different host functions. Copy TinyGo's `wasm_exec.js` from `$(tinygo env TINYGOROOT)/targets/`.

**Q3.** Can I run any of my existing Go services through TinyGo to make them smaller?

A. Generally no. Services rely on networking, the full scheduler, reflection-heavy libraries, and parallel goroutines — areas TinyGo limits or omits. TinyGo is for tiny Wasm and embedded, not general server binaries.

**Q4.** My embedded program runs once and the board seems to freeze. What happened?

A. Your `main` likely returned. On bare metal there is no OS to hand control back to. Wrap the work in an infinite `for {}` loop.

**Q5.** What is the difference between `-target wasm`, `-target wasi`, and `-target=pico`?

A. `wasm` targets the *browser* (loaded by `wasm_exec.js`). `wasi` targets Wasm *outside* the browser (server/edge) via the WASI interface. `pico` targets a *microcontroller* (the RP2040), producing firmware to flash. All three are TinyGo, selected purely by `-target`.

**Q6.** Why does `time.Sleep` work on a microcontroller if there is no OS?

A. TinyGo implements `time.Sleep` against the chip's hardware timer/clock in its runtime, so it works without an operating system. The mechanism differs from the OS-backed implementation in standard Go.

**Q7.** When would I choose `-gc=leaking`?

A. For short-lived programs that allocate, run, and exit (some Wasm functions, simple firmware that never needs to reclaim memory). It is the smallest and fastest GC because it simply never frees. For long-running loops it would eventually exhaust memory.

**Q8.** `tinygo flash` says it cannot find my device. Where do I start?

A. Confirm the cable carries data (not charge-only), put the board in bootloader mode, and verify the `-target` matches the actual board. These three cover the vast majority of cases.

**Q9.** Do goroutines work in TinyGo?

A. Yes, with the `tasks` or `asyncify` scheduler — but cooperatively, on a single core. There is no OS-thread parallelism, so CPU-bound work is not sped up by adding goroutines.

**Q10.** How do I find TinyGo's `wasm_exec.js` no matter how I installed it?

A. Run `tinygo env TINYGOROOT` to get the root, then look in `targets/wasm_exec.js` under it: `cp "$(tinygo env TINYGOROOT)/targets/wasm_exec.js" .`

---

## Cheat Sheet

```bash
# Install (macOS)
brew tap tinygo-org/tools && brew install tinygo
tinygo version

# Browser Wasm
tinygo build -o main.wasm -target wasm ./
cp "$(tinygo env TINYGOROOT)/targets/wasm_exec.js" .   # TinyGo's own glue!

# Wasm outside the browser (server/edge)
tinygo build -o app.wasm -target wasi ./       # or -target wasip1

# Embedded: build firmware
tinygo build -o firmware.uf2 -target=pico ./

# Embedded: build AND flash to the device
tinygo flash -target=pico ./
tinygo flash -target=arduino ./
tinygo flash -target=microbit ./

# Size-optimized, stripped Wasm for shipping
tinygo build -o main.wasm -target wasm -opt=z -no-debug ./

# Locate TinyGo's files
tinygo env TINYGOROOT
```

```
Key flags:
  -target      wasm | wasi | wasip1 | pico | arduino | microbit | esp32 | ...
  -gc          conservative | leaking | precise
  -scheduler   none | tasks | asyncify
  -opt         z (smallest) | s | 1 | 2 (fastest)
  -no-debug    strip debug info (smaller binary)
```

```
Minimal blink (embedded):

    led := machine.LED
    led.Configure(machine.PinConfig{Mode: machine.PinOutput})
    for {
        led.High(); time.Sleep(500 * time.Millisecond)
        led.Low();  time.Sleep(500 * time.Millisecond)
    }
```

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Wasm `LinkError` / won't run | Wrong `wasm_exec.js` | Copy TinyGo's from `targets/` |
| `.wasm` 404 / won't load | Opened via `file://` | Serve over HTTP |
| `package X not supported` | Unsupported stdlib/lib | Use a TinyGo-friendly alternative |
| Board not found on `flash` | Charge-only cable / wrong target / not in bootloader | Data cable, correct `-target`, bootloader mode |
| Embedded program freezes | `main` returned | End in `for {}` |
| Huge binary | Built with `gc`, or no size opts | Use TinyGo with `-opt=z -no-debug` |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Explain in one sentence what TinyGo is and how it differs from the `gc` toolchain
- [ ] Quantify the Wasm size difference (KB vs. MB) and explain *why*
- [ ] Install TinyGo and verify it with `tinygo version`
- [ ] Build a browser `.wasm` and run it with TinyGo's `wasm_exec.js`
- [ ] Explain why you must never mix Go's and TinyGo's `wasm_exec.js`
- [ ] Distinguish `-target wasm`, `-target wasi`, and a board target like `-target=pico`
- [ ] Write a blink-an-LED program using `machine.Pin`, `Configure`, `High`/`Low`, and `time.Sleep`
- [ ] Flash firmware to a device with `tinygo flash`
- [ ] Name the roles of `-target`, `-gc`, `-scheduler`, and `-opt`
- [ ] List at least three reasons TinyGo is not a drop-in replacement for `gc`
- [ ] Explain why an embedded `main` must loop forever

---

## Summary

TinyGo is an *alternative* Go compiler — built on the LLVM backend, not the official `gc` toolchain — that turns the Go code you already write into dramatically smaller binaries. It exists to win in two worlds the standard compiler struggles with: **tiny WebAssembly modules** (kilobytes instead of the multi-megabyte `gc` output) and **bare-metal microcontrollers** (running with no operating system in kilobytes of RAM).

You select what you are building for with one flag, `-target`: `wasm` for the browser, `wasi`/`wasip1` for server and edge Wasm, and board names like `pico`, `arduino`, and `microbit` for embedded. For the browser you load the module with TinyGo's *own* `wasm_exec.js` — never Go's. For hardware, the `machine` package gives you GPIO and peripherals, and `tinygo flash` programs the device. Flags like `-gc`, `-scheduler`, and `-opt` tune the size/behavior trade.

The non-negotiable caution: TinyGo is **not** a drop-in replacement. It supports a subset of the standard library, limits reflection, uses a cooperative scheduler with no true parallelism, and ships different garbage collectors. Use it for what it is great at — small Wasm and embedded — and keep the standard compiler for everything else.

---

## What You Can Build

After learning this:

- **A tiny browser Wasm widget** — Go logic served as a KB-scale module instead of a multi-MB one.
- **A blinking LED and a button reader** on a real microcontroller, written entirely in Go.
- **A first WASI module** runnable under `wasmtime` for edge/plugin experiments.
- **A size comparison demo** that proves the KB-vs-MB difference to your team.

You cannot yet:
- Wire rich JavaScript interop and call Go functions from JS efficiently (next: [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/junior.md))
- Use the full WASI capability model for files and clocks (see [02-wasi-and-wasip1](../02-wasi-and-wasip1/junior.md))
- Drive complex peripherals (I2C/SPI sensors, displays) with the driver library (middle level)
- Deploy and operate Wasm in production (see [05-wasm-in-production](../05-wasm-in-production/junior.md))

---

## Further Reading

- [TinyGo Documentation](https://tinygo.org/docs/) — official, authoritative; install guides, targets, and the `machine` package.
- [TinyGo Quick Install Guide](https://tinygo.org/getting-started/install/) — per-platform install instructions.
- [TinyGo WebAssembly Guide](https://tinygo.org/docs/guides/webassembly/) — browser and WASI Wasm in detail.
- [TinyGo Microcontrollers / Boards](https://tinygo.org/docs/reference/microcontrollers/) — the full list of supported targets.
- [tinygo.org/x/drivers](https://github.com/tinygo-org/drivers) — the peripheral driver library.

---

## Related Topics

- [16.1 GOOS=js Wasm in the Browser](../01-goos-js-wasm-browser/junior.md) — the standard-compiler path to browser Wasm; TinyGo is the leaner alternative
- [16.2 WASI and wasip1](../02-wasi-and-wasip1/junior.md) — running Wasm outside the browser, which TinyGo targets with `-target wasi`/`wasip1`
- [16.4 Wasm Interop and Performance](../04-wasm-interop-and-performance/junior.md) — calling between Go/Wasm and JavaScript, and tuning module performance
- [16.5 Wasm in Production](../05-wasm-in-production/junior.md) — deploying, serving, and operating Wasm modules in real systems

---

## Diagrams & Visual Aids

```
Same source, two compilers:

    main.go
       │
       ├── go build (gc, official) ───────> native binary
       │                              └────> GOOS=js GOARCH=wasm  ~2 MB .wasm
       │
       └── tinygo build (LLVM backend)
              ├── -target wasm   ──> ~15 KB browser .wasm
              ├── -target wasi   ──> server/edge .wasm
              └── -target pico   ──> microcontroller firmware
```

```
Browser Wasm wiring (must all match TinyGo):

    index.html
       │  <script src="wasm_exec.js">   <-- TinyGo's copy, not Go's
       │
       ▼
    new Go()  ──> go.importObject  ──┐
                                     ▼
    fetch("main.wasm") ──> WebAssembly.instantiateStreaming
                                     │
                                     ▼
                              go.run(instance)
                                     │
                                     ▼
                        println(...) -> dev console
```

```
Embedded blink — the entire program:

    machine.LED
        │ Configure(PinOutput)
        ▼
    ┌───────────────────────────┐
    │  for {                    │
    │     led.High()  ── on ──► │  LED lit
    │     sleep 500ms           │
    │     led.Low()   ── off ─► │  LED dark
    │     sleep 500ms           │
    │  }   (never returns)      │
    └───────────────────────────┘
        │
        ▼
    tinygo flash -target=pico ./   → runs forever on the chip
```

```
The size trade (why TinyGo is small):

    gc Wasm:    [ full runtime | full GC | scheduler | reflect | big stdlib ]   = MB
    TinyGo:     [ minimal RT | simple GC | pruned stdlib ] + LLVM -opt=z         = KB

    Every KB saved = a capability removed.
    Great for browser + chip.  Wrong for a server.
```
