---
layout: default
title: Wasm in Production
parent: WebAssembly & Alternative Targets
grand_parent: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/16-webassembly-and-alternative-targets/05-wasm-in-production/
---

# Wasm in Production

[← Back](../)

We explore what it takes to run Go-compiled WebAssembly in production — on both sides of the boundary. In the browser, that means serving `.wasm` with the right MIME type, enabling streaming compilation, compressing multi-megabyte payloads, caching with content hashes, and pinning `wasm_exec.js`. On the server, it means embedding untrusted Wasm *inside* a Go host with [wazero](https://wazero.io) — a sandboxed, fuel-limited, capability-scoped plugin runtime — and shipping Wasm to edge/serverless platforms. Throughout, the focus is the operational reality: observability, rollout, security, and the honest limits of where Wasm belongs.

## Sub-pages

- [junior.md](junior.md) — What "Wasm in production" means; serving, compressing, and loading a `.wasm` in the browser, end to end
- [middle.md](middle.md) — Delivery mechanics, `wasm_exec.js` versioning, lazy loading, and the wazero host/plugin model
- [senior.md](senior.md) — The sandbox as a feature, multi-tenant plugin architecture, edge/serverless tradeoffs, when NOT to use Wasm
- [professional.md](professional.md) — Streaming-compile internals, capability threat model, fuel/memory/timeout enforcement, supply chain, observability
- [specification.md](specification.md) — MIME, streaming-compile rules, wasip1 surface, wazero config knobs, edge platform support matrix
- [interview.md](interview.md) — Interview questions and answers from junior to staff/architect
- [tasks.md](tasks.md) — Hands-on exercises (easy → hard): serve, compress, lazy-load, embed wazero plugins, sandbox limits
- [find-bug.md](find-bug.md) — Bug-finding exercises: wrong MIME, stale `wasm_exec.js`, uncompressed payloads, unbounded plugins
- [optimize.md](optimize.md) — Delivery, size, and runtime optimizations for production Wasm
