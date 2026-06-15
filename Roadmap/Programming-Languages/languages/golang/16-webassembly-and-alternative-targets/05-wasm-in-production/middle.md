# Wasm in Production — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Content Negotiation: Serving Pre-Compressed `.wasm`](#content-negotiation-serving-pre-compressed-wasm)
3. [How Well Does Go Wasm Compress? (Numbers)](#how-well-does-go-wasm-compress-numbers)
4. [Content-Hashed Filenames and Cache Headers](#content-hashed-filenames-and-cache-headers)
5. [CDN Placement and the `Vary` Trap](#cdn-placement-and-the-vary-trap)
6. [Lazy-Loading Wasm Per Route](#lazy-loading-wasm-per-route)
7. [Loading UX for a Multi-Megabyte Download](#loading-ux-for-a-multi-megabyte-download)
8. [Pinning `wasm_exec.js` as a Build Artefact](#pinning-wasm_execjs-as-a-build-artefact)
9. [Server-Side: Compile Once, Instantiate Many (wazero)](#server-side-compile-once-instantiate-many-wazero)
10. [Memory Limits and Execution Timeouts](#memory-limits-and-execution-timeouts)
11. [Host Functions: Giving the Guest Controlled Capabilities](#host-functions-giving-the-guest-controlled-capabilities)
12. [Edge and Serverless: Where Go Runs Today](#edge-and-serverless-where-go-runs-today)
13. [Versioning and Rolling Back a Wasm Artefact](#versioning-and-rolling-back-a-wasm-artefact)
14. [Common Errors and Their Real Causes](#common-errors-and-their-real-causes)
15. [Self-Assessment](#self-assessment)
16. [Summary](#summary)

---

## Introduction

The junior file gave you the rules: serve `application/wasm`, compress, show a loading state, pin `wasm_exec.js`, sandbox the guest. The middle-level question is *how those rules become a repeatable production pipeline* — content negotiation that actually serves the Brotli variant, cache headers that never strand users on a stale build, a wazero host that does not recompile on every request, and limits that survive a hostile guest.

This file is operational. It assumes you have shipped a `.wasm` once and now have to do it reliably, for real traffic, with a deploy story and a rollback story.

After reading this you will:
- Configure correct content negotiation for pre-compressed `.wasm`
- Quantify Go Wasm compression and size budgets
- Set cache headers that make repeat visits free without serving stale code
- Lazy-load Wasm so only the routes that need it pay the download
- Build a wazero host that compiles once and enforces memory + time limits
- Expose host functions as the guest's only door to the outside world

---

## Content Negotiation: Serving Pre-Compressed `.wasm`

Compressing on every request burns CPU for a payload that never changes. The production pattern is to **compress once at build time** and serve the right variant based on the client's `Accept-Encoding`.

Build produces three files:

```
public/app.wasm        5.0 MB   (fallback)
public/app.wasm.gz      1.6 MB   (gzip -9)
public/app.wasm.br      1.3 MB   (brotli -q 11)
```

The server inspects `Accept-Encoding` and serves the smallest variant the client accepts, echoing the encoding in the response:

```go
func serveWasm(w http.ResponseWriter, r *http.Request, base string) {
	w.Header().Set("Content-Type", "application/wasm")
	w.Header().Add("Vary", "Accept-Encoding")

	ae := r.Header.Get("Accept-Encoding")
	switch {
	case strings.Contains(ae, "br") && fileExists(base+".br"):
		w.Header().Set("Content-Encoding", "br")
		http.ServeFile(w, r, base+".br")
	case strings.Contains(ae, "gzip") && fileExists(base+".gz"):
		w.Header().Set("Content-Encoding", "gzip")
		http.ServeFile(w, r, base+".gz")
	default:
		http.ServeFile(w, r, base) // uncompressed fallback
	}
}
```

Two non-obvious points:

- **You set `Content-Encoding` manually and serve the already-compressed bytes.** The browser decompresses transparently; `instantiateStreaming` still sees `application/wasm`. Do **not** also run a gzip middleware over this handler, or you will double-compress.
- **`Vary: Accept-Encoding` is mandatory.** Without it, a shared cache (CDN, proxy) may serve the Brotli bytes to a client that only sent `Accept-Encoding: gzip`, producing a corrupt decode.

`nginx` does the same with `gzip_static on;` / `brotli_static on;` — it auto-serves `app.wasm.br` when the client supports it. If you front your Go server with nginx, let nginx do negotiation and have Go serve only the raw file with the correct MIME.

---

## How Well Does Go Wasm Compress? (Numbers)

Wasm is a dense bytecode with high redundancy (repeated opcodes, name sections, the Go runtime's regular structure), so it compresses unusually well. Representative figures for standard-Go browser binaries:

| Stage | Size | Ratio vs raw |
|-------|------|--------------|
| Raw `.wasm` (hello world) | ~2.0 MB | 100% |
| Raw `.wasm` (medium app) | ~6–8 MB | 100% |
| gzip `-9` | ~28–32% of raw | ~0.30× |
| brotli `-q 11` | ~24–28% of raw | ~0.26× |
| `go build -ldflags="-s -w"` then brotli | a few % smaller still | — |

Concretely: a 6 MB binary lands around **1.6 MB gzipped, ~1.5 MB brotli**. Brotli typically beats gzip by 10–15% on Wasm — meaningful on mobile, and free once it is pre-built.

The runtime floor matters: standard Go bakes the GC, scheduler, and reflection into every binary, so you cannot compress below ~2 MB raw / ~600 KB compressed for *anything*. If that floor is unacceptable (a tiny widget, a constrained edge platform), that is the TinyGo case — a different toolchain, covered in sibling [03-tinygo-for-wasm-and-embedded](../03-tinygo-for-wasm-and-embedded/middle.md). This file stays on standard Go. Module-level size tactics live in [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/middle.md) and in [optimize.md](optimize.md).

---

## Content-Hashed Filenames and Cache Headers

The two cache goals are in tension: you want repeat visits to be *instant* (cache forever) but you must never serve *stale* code after a deploy. The resolution is the standard static-asset pattern:

1. Name the file by a hash of its contents: `app.9f2c1a.wasm`.
2. Serve it with `Cache-Control: public, max-age=31536000, immutable` (one year).
3. Reference the hashed name from an HTML/JS file that is itself served with `Cache-Control: no-cache` (revalidate every load).

```go
// Long-lived, content-addressed: safe to cache forever.
w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
```

When you ship a new build, the hash changes, the filename changes, and browsers fetch the new file because they have never seen that URL. The old `app.<oldhash>.wasm` can keep being cached harmlessly; nothing points at it anymore.

The cardinal sin is serving `main.wasm` (an unhashed name) with a long `max-age`. Users then run the *old* code until the cache expires — sometimes for days. If you cannot hash filenames, set `Cache-Control: no-cache` and accept a revalidation round-trip on every load, or use an `ETag` and let the browser send `If-None-Match` for a cheap `304`.

Hash the `wasm_exec.js` too. It changes when you bump Go, and a stale glue file against a fresh binary is the silent-blank-page failure from the junior file.

---

## CDN Placement and the `Vary` Trap

Put the `.wasm` (and its compressed variants) on a CDN so the multi-megabyte download is served from an edge POP near the user, not from your origin. Three CDN-specific gotchas:

- **Confirm the CDN forwards/preserves `Content-Type: application/wasm`.** Some object stores (S3 static hosting, older bucket configs) default to `application/octet-stream` for `.wasm`. Set the metadata explicitly on upload.
- **Confirm the CDN compresses or passes through your pre-compressed variant.** Many CDNs only auto-compress text MIME types and skip `application/wasm`. If yours skips it, upload the `.br`/`.gz` yourself and set `Content-Encoding`.
- **Respect `Vary: Accept-Encoding` in the cache key.** A CDN that ignores `Vary` can serve Brotli bytes to a gzip-only client. Either set `Vary` correctly and trust the CDN, or use distinct URLs per encoding.

With content-hashed filenames + a CDN + `immutable`, the steady state is: first visit pays one edge-served compressed download; every later visit pays nothing.

---

## Lazy-Loading Wasm Per Route

A multi-megabyte module should download only when the feature that needs it is reached — never on the marketing homepage. In a SPA, fetch the `.wasm` on route entry; in an MPA, load it only on the page that uses it.

```js
let goInstance = null;

async function ensureWasm() {
  if (goInstance) return goInstance;          // load once, reuse
  showSpinner();
  const go = new Go();
  const resp = await fetch("/static/app.9f2c1a.wasm");
  const { instance } = await WebAssembly.instantiateStreaming(resp, go.importObject);
  go.run(instance);                            // starts the Go runtime
  goInstance = instance;
  hideSpinner();
  return instance;
}

document.querySelector("#open-editor").addEventListener("click", async () => {
  await ensureWasm();    // pay the download on first use of the editor only
  openImageEditor();
});
```

Lazy-loading turns the Wasm payload from a page-load cost into a feature-activation cost. Combine it with a prefetch hint (`<link rel="prefetch" href="/static/app.9f2c1a.wasm">`) on pages where you *predict* the user will need it, so the download warms the cache during idle time without blocking initial render.

---

## Loading UX for a Multi-Megabyte Download

Even compressed, 1.5 MB on a slow connection is several seconds. A blank page reads as "broken." Three UX levels, in order of effort:

1. **A static spinner with copy** — "Loading editor (~1.5 MB)…" rendered *before* the fetch. The floor.
2. **A real progress bar** — stream the response and report bytes received against `Content-Length`:

```js
const resp = await fetch(url);
const total = +resp.headers.get("Content-Length");
const reader = resp.body.getReader();
let received = 0, chunks = [];
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  chunks.push(value); received += value.length;
  setProgress(received / total);              // 0..1
}
const bytes = new Blob(chunks);
const { instance } = await WebAssembly.instantiate(await bytes.arrayBuffer(), go.importObject);
```

   Note: manual streaming with a progress bar gives up `instantiateStreaming`'s overlap of download and compile. For payloads over a few MB the progress feedback usually wins; for smaller ones keep `instantiateStreaming`. Measure both.

3. **Prefetch during idle** so the module is already cached when the user clicks — the best UX is no visible wait at all.

Always wire the failure path (404, MIME error, decode failure) to a visible, retryable error — never a dead page.

---

## Pinning `wasm_exec.js` as a Build Artefact

`wasm_exec.js` is part of the toolchain and version-matched to the binary. Treat it like a generated artefact, copied fresh on every build, never checked in by hand:

```bash
#!/usr/bin/env bash
set -euo pipefail

SHIM="$(go env GOROOT)/lib/wasm/wasm_exec.js"          # Go 1.24+
[ -f "$SHIM" ] || SHIM="$(go env GOROOT)/misc/wasm/wasm_exec.js"  # older Go

GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o build/app.wasm .

HASH="$(shasum -a 256 build/app.wasm | cut -c1-6)"
cp build/app.wasm "public/app.${HASH}.wasm"
cp "$SHIM"        "public/wasm_exec.${HASH}.js"
brotli -q 11 -k   "public/app.${HASH}.wasm"
gzip   -9   -k    "public/app.${HASH}.wasm"

echo "built app.${HASH}.wasm with $(go version)"
```

The single most reliable rule: **the shim and the binary ship as one hashed pair, produced by one script, in one CI step.** Drift between them is undebuggable from the symptom alone.

---

## Server-Side: Compile Once, Instantiate Many (wazero)

On the server with [wazero](https://wazero.io), the expensive step is *compilation* — translating the guest's Wasm bytecode into the host's executable form. Doing it per request is the dominant server-side Wasm performance bug. Compile once at startup; instantiate a cheap, isolated module per request:

```go
// Startup: compile the guest ONCE.
runtime := wazero.NewRuntimeWithConfig(ctx,
	wazero.NewRuntimeConfig().WithCloseOnContextDone(true))
compiled, err := runtime.CompileModule(ctx, guestBytes)   // expensive, once
// ... handle err

// Per request: instantiate a FRESH module (cheap, fully isolated).
func handle(ctx context.Context) error {
	mod, err := runtime.InstantiateModule(ctx, compiled,
		wazero.NewModuleConfig().WithName("")) // anon: allows many instances
	if err != nil {
		return err
	}
	defer mod.Close(ctx)        // free this request's guest memory
	_, err = mod.ExportedFunction("process").Call(ctx, arg)
	return err
}
```

A fresh instance per request gives each call its own clean linear memory — no state bleeds between tenants or invocations. `WithCloseOnContextDone(true)` lets a cancelled/timed-out `context` interrupt a running guest (the basis of timeouts, below).

---

## Memory Limits and Execution Timeouts

An untrusted guest will, eventually, try to exhaust your host. Two limits are non-negotiable.

**Memory cap.** Wasm memory is paged in 64 KiB units. Cap the maximum pages so a runaway guest cannot allocate gigabytes:

```go
cfg := wazero.NewRuntimeConfig().
	WithMemoryLimitPages(256)   // 256 * 64 KiB = 16 MiB ceiling
```

When the guest tries to `memory.grow` past the cap, the grow fails inside the guest (it sees an allocation error), and your host stays up.

**Execution timeout.** A guest can spin forever in a tight loop. Bound every call with a `context` deadline, and configure the runtime to honor cancellation:

```go
runtime := wazero.NewRuntimeWithConfig(ctx,
	wazero.NewRuntimeConfig().WithCloseOnContextDone(true))

callCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
defer cancel()
_, err := fn.Call(callCtx, arg)   // returns an error when the deadline trips
```

`WithCloseOnContextDone(true)` makes the interpreter/compiler check for context cancellation, so a CPU-bound guest is interrupted rather than ignoring the deadline. Without it, the deadline only fires between host-function calls — useless against a pure compute loop.

For finer-grained budgeting (count guest "ticks" / instructions), wazero exposes a listener/`sys` hook; "fuel"-style metering is more involved and is treated at [professional.md](professional.md). At this level: **never run an untrusted guest without both a memory cap and a context deadline.**

---

## Host Functions: Giving the Guest Controlled Capabilities

A sandboxed guest with no capabilities can only compute on its own memory. To let it *do* anything — log, read a config value, call back into your domain — you export **host functions**: Go functions the host registers into a module the guest imports. This is the controlled door.

```go
_, err := runtime.NewHostModuleBuilder("env").
	NewFunctionBuilder().
	WithFunc(func(ctx context.Context, m api.Module, ptr, length uint32) {
		buf, _ := m.Memory().Read(ptr, length)   // read a string OUT of guest memory
		log.Printf("guest says: %s", buf)
	}).
	Export("log").
	Instantiate(ctx)
```

The guest declares `//export`-style imports (or, for guests built by Go itself, uses `//go:wasmimport env log`). Two principles:

- **Capabilities are explicit and minimal.** The guest gets exactly the host functions you register — no filesystem, no network, no clock unless you grant it. This is the deny-by-default sandbox from the junior file, made concrete.
- **The boundary is bytes.** You pass numbers and (pointer, length) pairs into guest linear memory; you read results back the same way. Structured data crosses as serialized bytes. The ergonomics and cost of that boundary are the subject of [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/middle.md).

For WASI guests (`GOOS=wasip1`), wazero provides `wasi_snapshot_preview1` and `WithFS`/preopens to grant a scoped, read-only filesystem view — covered in [02-wasi-and-wasip1](../02-wasi-and-wasip1/middle.md).

---

## Edge and Serverless: Where Go Runs Today

Wasm's microsecond-to-millisecond cold start (versus hundreds of milliseconds to boot a container) makes it attractive for edge/serverless. The honest state of Go support in 2025:

| Platform | Go support | Notes |
|----------|-----------|-------|
| **Fastly Compute** | wasip1 / WASI | Standard Go targets WASI; works for compute, no raw sockets. |
| **Spin / Fermyon** | wasip1 (component model emerging) | Spin runs WASI modules; Go via wasip1, components increasingly via TinyGo. |
| **wasmCloud** | component model | Actor model over Wasm components; Go support via TinyGo / wit-bindgen leading edge. |
| **Cloudflare Workers** | limited / TinyGo | Workers' Wasm path is JS-host-bound; practical Go use is small and often TinyGo. |

The pattern: **standard Go works well where the target is plain `wasip1`** (Fastly, Spin, self-hosted wazero). Platforms built around the **component model** or with tight size limits often require **TinyGo** today — note this honestly and point readers to sibling [03-tinygo-for-wasm-and-embedded](../03-tinygo-for-wasm-and-embedded/middle.md). The cold-start advantage is real, but `wasip1`'s lack of sockets (see [02-wasi-and-wasip1](../02-wasi-and-wasip1/middle.md)) means networking happens through host-provided functions, not `net.Dial`.

---

## Versioning and Rolling Back a Wasm Artefact

A `.wasm` is a deployable artefact — version it like one.

- **Browser:** content-hashed filenames *are* your version. Rollback = re-point the HTML/manifest at the previous hash. Because old hashed files stay cached and on the CDN, rollback is instant and requires no rebuild.
- **Server plugins:** store guest modules with an explicit version (`policy-v3.wasm`, or a digest), record which version is active, and keep the previous one loadable. A bad guest rollout becomes "activate the previous digest," not "redeploy the host." Validate a guest at load time (compile + a smoke call) before promoting it to active.
- **Embed an identifier in the module.** Have the guest export a `version()` function or a custom section so the host can log exactly which artefact handled a request — essential when correlating an error to a specific rollout.

Treat host and guest as independently versioned. The host's import contract (the host functions it offers) and the guest's expected imports form an interface; document it and bump deliberately, exactly as you would an API.

---

## Common Errors and Their Real Causes

| Error / symptom | Real cause | Fix |
|-----------------|-----------|-----|
| `Incorrect response MIME type` | server/CDN sends `octet-stream` for `.wasm` | set `Content-Type: application/wasm` at origin and CDN |
| Corrupt module / decode failure intermittently | shared cache ignored `Vary`, served `br` to a gzip-only client | add `Vary: Accept-Encoding`, fix CDN cache key |
| Double-sized payload | gzip middleware compressed an already-`.br` file | serve pre-compressed bytes directly, disable middleware on that route |
| Users on old code after deploy | unhashed `main.wasm` with long `max-age` | content-hash filenames, `immutable` only on hashed names |
| Server p99 latency spikes per request | guest recompiled every request | `CompileModule` once, `InstantiateModule` per request |
| Host OOM under load | no memory cap on guest | `WithMemoryLimitPages` |
| Request hangs forever | guest infinite loop, no deadline honored | context deadline + `WithCloseOnContextDone(true)` |
| Blank page after Go upgrade | stale `wasm_exec.js` | re-copy & re-hash the shim in the build script |

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Configure pre-compressed content negotiation with correct `Content-Encoding` and `Vary`
- [ ] State realistic gzip/brotli ratios for standard Go Wasm and the runtime size floor
- [ ] Design a content-hash + `immutable` caching scheme and explain why it never serves stale code
- [ ] List the three CDN gotchas (MIME, compression pass-through, `Vary` in cache key)
- [ ] Lazy-load a `.wasm` on route/feature entry and load it exactly once
- [ ] Build a wazero host that compiles once and instantiates per request
- [ ] Enforce a memory cap and a context-deadline timeout that interrupts a CPU-bound guest
- [ ] Expose a host function as the guest's only controlled capability
- [ ] State which edge platforms run standard Go vs require TinyGo
- [ ] Version and roll back both a browser `.wasm` and a server-side guest module

---

## Summary

Middle-level "Wasm in production" is two repeatable pipelines. In the **browser**, the pipeline is delivery engineering: pre-compress the binary once (gzip to ~30%, brotli a bit smaller, against a ~2 MB standard-Go floor), serve it with `application/wasm` + correct `Content-Encoding` + `Vary`, address it by content hash so it caches `immutable` yet never goes stale, push it to a CDN, lazy-load it per route, and wrap the multi-megabyte download in real loading UX — with `wasm_exec.js` pinned to the binary as one hashed artefact. On the **server**, the pipeline is isolation engineering with [wazero](https://wazero.io): compile the guest once, instantiate a fresh isolated module per request, cap its memory, bound its runtime with a context deadline that can actually interrupt a compute loop, and hand it capabilities only through explicit host functions. Standard Go covers browser and `wasip1` targets; some component-model and size-constrained edge platforms still want TinyGo. Version host and guest independently, and rollback becomes re-pointing at a previous hash or digest.
