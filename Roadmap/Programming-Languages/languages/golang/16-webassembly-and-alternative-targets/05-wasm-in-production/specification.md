# Wasm in Production — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Where "Production Wasm" Is Specified](#where-production-wasm-is-specified)
3. [The `application/wasm` Media Type (IANA / W3C)](#the-applicationwasm-media-type-iana--w3c)
4. [Streaming Compilation Requirements (W3C / WHATWG)](#streaming-compilation-requirements-w3c--whatwg)
5. [HTTP Headers Governing Delivery](#http-headers-governing-delivery)
6. [The `js/wasm` Runtime Contract (`wasm_exec.js`)](#the-jswasm-runtime-contract-wasm_execjs)
7. [The `wasip1` / WASI Preview 1 Contract](#the-wasip1--wasi-preview-1-contract)
8. [wazero's Specified Behaviour](#wazeros-specified-behaviour)
9. [Differences Across Go Versions](#differences-across-go-versions)
10. [References](#references)

---

## Introduction

There is no single "Wasm in production" specification. The behaviour you rely on in production is governed by a stack of independent specs: the **WebAssembly core spec** (the bytecode and its semantics), **W3C Web platform specs** (the JS API and streaming compilation), **IANA/RFC** (the media type and HTTP semantics), the **WASI** specification (the server-side syscall surface), and the **Go toolchain's** documented behaviour for its two targets. This file separates what is formally specified from what is convention or implementation detail.

Sources of truth, by domain:

1. **Bytecode & semantics** — WebAssembly Core Specification (`webassembly.github.io/spec`).
2. **Browser JS API & streaming** — W3C *WebAssembly JavaScript Interface* and *Web API* specs; MDN as the practical reference.
3. **Media type & HTTP** — IANA media-types registry; RFC 9110/9111 for HTTP semantics and caching.
4. **Server interface** — WASI Preview 1 (`wasip1`) spec.
5. **Go behaviour** — Go toolchain docs and source (`misc/wasm`, `lib/wasm`, `cmd/compile`, runtime).
6. **wazero** — `wazero.io` docs and the godoc for `github.com/tetratelabs/wazero`.

---

## Where "Production Wasm" Is Specified

| Concern | Governing spec | Status |
|---------|----------------|--------|
| `.wasm` bytecode format | WebAssembly Core Spec | W3C Recommendation |
| `WebAssembly.instantiateStreaming` | WebAssembly JS Interface (W3C) | Standard |
| `application/wasm` media type | IANA media types registry | Registered |
| Streaming requires correct MIME | WebAssembly Web API (W3C) | Normative |
| HTTP caching (`Cache-Control`, `ETag`, `Vary`) | RFC 9111 | Standard |
| Content coding (`gzip`, `br`) | RFC 9110 §8.4; RFC 7932 (brotli) | Standard |
| WASI syscall surface | WASI Preview 1 | Snapshot spec |
| `wasm_exec.js` bridge | Go toolchain (not a public spec) | Implementation-defined |
| wazero host API | wazero godoc / docs | Library API |

The takeaway: the *bytecode and the browser/HTTP delivery* are formally standardized; the *Go bridge* and the *host runtime API* are implementation contracts you pin to a version.

---

## The `application/wasm` Media Type (IANA / W3C)

`application/wasm` is the official IANA-registered media type for WebAssembly modules. The WebAssembly Web API spec makes serving this type **normative** for streaming compilation: a conforming engine *must* reject `compileStreaming`/`instantiateStreaming` when the response's `Content-Type` is not `application/wasm`.

- There is no charset parameter — Wasm is binary.
- The registration references the WebAssembly core spec as the format definition.
- Servers and CDNs must be configured to emit it for `.wasm` files. Go's `mime` package maps `.wasm → application/wasm` since Go 1.17, so `net/http`'s `FileServer` is conformant by default; many other servers are not.

---

## Streaming Compilation Requirements (W3C / WHATWG)

`WebAssembly.instantiateStreaming(source, importObject)` and `WebAssembly.compileStreaming(source)` are specified in the WebAssembly JavaScript Interface. The normative requirements that affect production:

- `source` is a `Response` or a `Promise<Response>` (typically `fetch(url)`).
- The engine inspects the response's MIME type; if it is not `application/wasm`, the operation **rejects** with a `TypeError`. This is specified, not engine-specific.
- Compilation may proceed concurrently with the response body streaming in (the spec permits incremental compilation).
- The non-streaming `WebAssembly.instantiate(bufferSource, importObject)` takes bytes already in memory and has **no** MIME requirement — which is why it is the valid fallback when MIME cannot be fixed.

`Content-Encoding` (gzip/brotli) is handled at the Fetch/HTTP layer: the browser decodes the body before the WebAssembly engine sees it, so streaming compilation observes the decoded `application/wasm` stream. Compression and streaming are orthogonal and compose.

---

## HTTP Headers Governing Delivery

Production delivery relies on standard HTTP semantics (RFC 9110, RFC 9111):

| Header | Spec | Production role |
|--------|------|-----------------|
| `Content-Type: application/wasm` | RFC 9110 §8.3 | Required for streaming compile |
| `Content-Encoding: br` / `gzip` | RFC 9110 §8.4 | Declares the body's compression |
| `Vary: Accept-Encoding` | RFC 9110 §12.5.5 | Tells caches the response varies by encoding — required to avoid serving the wrong variant |
| `Cache-Control: public, max-age=…, immutable` | RFC 9111 §5.2; `immutable` per RFC 8246 | Long-lived caching of content-hashed files |
| `ETag` / `If-None-Match` | RFC 9110 §8.8.3 / §13.1.2 | Cheap `304` revalidation for unhashed names |

`immutable` (RFC 8246) is the directive that tells the browser not to revalidate during the freshness lifetime even on reload — the basis of the content-hash caching strategy.

---

## The `js/wasm` Runtime Contract (`wasm_exec.js`)

`wasm_exec.js` is **not** a public specification — it is part of the Go toolchain and its contract is defined by the matching Go runtime. It lives at `$(go env GOROOT)/lib/wasm/wasm_exec.js` (Go 1.24+) or `misc/wasm/wasm_exec.js` (earlier). It:

- defines the `Go` class and the `importObject` the module expects;
- implements the host-side functions the Go runtime imports (timers, `syscall/js` bridge, the event loop driver, randomness, time);
- is **version-locked** to the runtime that built the `.wasm`. The set of imports and their signatures change between Go releases, so a mismatched shim violates the contract — sometimes loudly, sometimes silently.

Because it is implementation-defined, the only specification you can rely on is "use the shim from the exact toolchain that built the binary." This is why the build pipeline pins them as a pair.

---

## The `wasip1` / WASI Preview 1 Contract

`GOOS=wasip1 GOARCH=wasm` targets **WASI Preview 1** (also called `wasi_snapshot_preview1`), a specified module interface of syscall-like imports: file descriptors with capability-based access (preopens), clocks, randomness, environment, args, and process exit. Specified properties relevant to production:

- **Capability-based, no ambient authority.** A guest can only access filesystem paths granted as *preopens*; there is no global root.
- **No sockets.** WASI Preview 1 specifies **no** general networking syscalls. A guest cannot open a TCP/UDP socket; network access must be provided by the host out-of-band (a host function).
- **`_start` entry** for command modules; reactor-style exported functions (Go's `//go:wasmexport`, 1.24+) for library modules a host calls repeatedly.

WASI Preview 2 / the component model supersede Preview 1 with a richer, typed interface (including sockets via `wasi-sockets`), but standard Go's primary, stable target as of Go 1.21–1.24 is `wasip1`. Component-model targeting from Go proper is still maturing; TinyGo currently leads there (sibling [03-tinygo-for-wasm-and-embedded](../03-tinygo-for-wasm-and-embedded/specification.md)).

---

## wazero's Specified Behaviour

[wazero](https://wazero.io)'s contract is its godoc and documentation, not a formal standard. The production-relevant guarantees:

- **Pure Go, zero dependencies, no CGo** — it implements the WebAssembly Core Spec and `wasi_snapshot_preview1` in Go.
- **Two engines** — an optimizing compiler (amd64/arm64) and a portable interpreter, selected via `RuntimeConfig`.
- **Deny-by-default capabilities** — a default `ModuleConfig` grants no filesystem, no clock-of-record beyond what you configure, no env; you opt in (`WithFS`, `WithSysWalltime`, `WithEnv`, …).
- **Resource controls** — `WithMemoryLimitPages` (linear-memory ceiling) and `WithCloseOnContextDone` (context-cancellation interrupts running guest code).
- **Lifecycle objects** — `Runtime`, `CompiledModule` (reusable), `Module` (per-instance), as documented.

Because these are library APIs, pin the wazero version and read its CHANGELOG before upgrading; behaviour like compiler support and config knobs evolve across releases.

---

## Differences Across Go Versions

| Go version | Production-relevant change |
|------------|----------------------------|
| 1.17 | `mime` package maps `.wasm → application/wasm`; `FileServer` becomes conformant by default |
| 1.21 | `GOOS=wasip1 GOARCH=wasm` target added — standard Go runs server-side on WASI runtimes |
| 1.21 | `toolchain` directive in `go.mod` (pin the exact toolchain → stable `wasm_exec.js`) |
| 1.24 | `wasm_exec.js` moves from `misc/wasm/` to `lib/wasm/`; `//go:wasmexport` lets `wasip1` modules export functions (reactor/plugin pattern) |

These boundaries explain most "works on my machine" reports: a `wasip1` binary needs Go 1.21+, the shim path moved in 1.24, and `//go:wasmexport` (the basis of in-process plugins) is 1.24+.

---

## References

- **WebAssembly Core Specification** — https://webassembly.github.io/spec/core/
- **WebAssembly JavaScript Interface / Web API (W3C)** — https://webassembly.github.io/spec/js-api/ and /web-api/
- **MDN: `instantiateStreaming`** — https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/instantiateStreaming_static
- **MDN: Loading and running WebAssembly** — https://developer.mozilla.org/en-US/docs/WebAssembly/Loading_and_running
- **IANA media types** — https://www.iana.org/assignments/media-types/ (`application/wasm`)
- **RFC 9110 (HTTP Semantics)**, **RFC 9111 (HTTP Caching)**, **RFC 8246 (`immutable`)**, **RFC 7932 (Brotli)**
- **WASI Preview 1** — https://github.com/WebAssembly/WASI
- **Go WebAssembly wiki** — https://github.com/golang/go/wiki/WebAssembly
- **wazero documentation** — https://wazero.io and https://pkg.go.dev/github.com/tetratelabs/wazero
