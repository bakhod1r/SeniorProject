---
layout: default
title: WASI & GOOS=wasip1
parent: WebAssembly & Alternative Targets
grand_parent: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/16-webassembly-and-alternative-targets/02-wasi-and-wasip1/
---

# WASI & GOOS=wasip1

[← Back](../)

We explore WASI — the WebAssembly System Interface — and Go's `wasip1` port, added in Go 1.21. `GOOS=wasip1 GOARCH=wasm` compiles Go to a sandboxed `.wasm` module that runs *outside* the browser on host runtimes like Wasmtime, wazero, WasmEdge, and Node, with capabilities (files, env, args, stdio) granted explicitly rather than ambiently.

## Sub-pages

- [junior.md](junior.md) — What WASI is, building and running a `wasip1` module, the sandbox model
- [middle.md](middle.md) — Capabilities, preopens, what works and what does not, `go:wasmimport`
- [senior.md](senior.md) — wasip1 vs preview 2, plugin architectures, embedding with wazero, threat model
- [professional.md](professional.md) — ABI internals, `go:wasmexport`, runtime feature matrices, hermetic deployment
- [specification.md](specification.md) — Formal reference: port status, directives, version attribution
- [interview.md](interview.md) — Interview questions from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken-wasip1 scenarios
- [optimize.md](optimize.md) — Binary size, startup, and runtime optimizations for wasip1
