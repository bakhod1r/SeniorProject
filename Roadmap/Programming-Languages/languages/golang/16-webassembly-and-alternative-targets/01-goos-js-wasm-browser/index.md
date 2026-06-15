---
layout: default
title: GOOS=js/wasm in the Browser
parent: WebAssembly & Alternative Targets
grand_parent: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/16-webassembly-and-alternative-targets/01-goos-js-wasm-browser/
---

# GOOS=js/wasm in the Browser

[← Back](../)

We explore compiling Go to WebAssembly for the browser with `GOOS=js GOARCH=wasm`: the build command, the `wasm_exec.js` glue, the HTML/JS bootstrap, the `syscall/js` bridge for talking to the DOM and JavaScript, the single-threaded execution model that forces `select{}` to keep the program alive, and the cost of crossing the Go↔JS boundary.

## Sub-pages

- [junior.md](junior.md) — First build, the glue file, the bootstrap, and a working DOM example
- [middle.md](middle.md) — `syscall/js` in depth, callbacks, the event loop, keeping the program alive
- [senior.md](senior.md) — Boundary cost, Promises, goroutines on wasm, leak and deadlock pitfalls
- [professional.md](professional.md) — Runtime internals, the JS bridge ABI, memory model, production constraints
- [specification.md](specification.md) — Formal reference for `syscall/js`, the port's guarantees, version notes
- [interview.md](interview.md) — Interview questions from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard)
- [find-bug.md](find-bug.md) — Bug-finding exercises with broken wasm scenarios
- [optimize.md](optimize.md) — Binary size, boundary crossings, and load-time optimizations
