---
layout: default
title: TinyGo for Wasm & Embedded
parent: WebAssembly & Alternative Targets
grand_parent: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/16-webassembly-and-alternative-targets/03-tinygo-for-wasm-and-embedded/
---

# TinyGo for Wasm & Embedded

[← Back](../)

We explore TinyGo, the LLVM-based alternative Go compiler built for places the standard `gc` toolchain cannot reach: kilobyte-sized WebAssembly modules and bare-metal microcontrollers. TinyGo trades full language and standard-library completeness for dramatically smaller binaries, making Go viable on edge runtimes, browsers where download size matters, and embedded boards with only a few kilobytes of RAM.

## Sub-pages

- [junior.md](junior.md) — What TinyGo is, installing it, and your first wasm and blinky builds
- [middle.md](middle.md) — Targets, flags, the `machine` package, schedulers, and GC modes
- [senior.md](senior.md) — Compatibility tradeoffs, when to choose TinyGo over `gc`, architecture decisions
- [professional.md](professional.md) — LLVM pipeline, ABI, size internals, drivers, production embedded/edge builds
- [specification.md](specification.md) — Reference: targets, flags, supported packages, divergences from `gc`
- [interview.md](interview.md) — Interview questions and answers from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken TinyGo scenarios
- [optimize.md](optimize.md) — Binary-size and runtime optimizations for wasm and embedded
