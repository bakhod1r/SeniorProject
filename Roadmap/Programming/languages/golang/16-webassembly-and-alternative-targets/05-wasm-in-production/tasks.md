# Wasm in Production — Hands-on Tasks

> Practical exercises from easy to hard, covering browser delivery and server-side embedding. Each task states what to build, what success looks like, and a hint or expected outcome. Sketched solutions follow each tier. Assumes Go 1.21+ (1.24+ for `//go:wasmexport` tasks) and [wazero](https://wazero.io) for the server-side tasks.

---

## Easy

### Task 1 — Serve a `.wasm` with the correct MIME and prove it

Build a `js/wasm` hello-world, serve it from a Go HTTP server, and verify in DevTools (or `curl -I`) that the `.wasm` response carries `Content-Type: application/wasm`. Then deliberately break it (serve `text/plain`) and observe `instantiateStreaming` reject.

**Goal.** Internalize that the MIME type is load-bearing, not cosmetic.

### Task 2 — Pre-compress and measure the ratio

Compress your binary with `gzip -9` and `brotli -q 11`. Record raw / gzip / brotli sizes and the ratios. State the runtime size floor you observe.

**Goal.** Get real numbers for Go Wasm compression.

### Task 3 — Content-hash the filename and set cache headers

Rename the binary to `app.<sha8>.wasm`, serve it `Cache-Control: public, max-age=31536000, immutable`, and serve the HTML `no-cache`. Reload and confirm (DevTools Network) the `.wasm` is served from cache while the HTML revalidates.

**Goal.** See the never-stale caching pattern work.

### Task 4 — A minimal wazero host

Compile a tiny `wasip1` guest exporting `add(a, b)`. Write a Go host that loads it, calls `add(2,3)`, prints `5`. Confirm the guest cannot read a file (it has no FS capability).

**Goal.** Run your first sandboxed guest.

**Solutions (Easy).**
- *T1:* Set `w.Header().Set("Content-Type","application/wasm")` for `.wasm` paths (or rely on Go 1.17+ `mime`). `curl -sI .../app.wasm | grep -i content-type`. With `text/plain`, `instantiateStreaming` throws `Incorrect response MIME type`.
- *T2:* Typical hello-world ~2 MB → ~600 KB gzip → slightly less brotli (~28–32% / ~24–28%). Floor ≈ 2 MB raw because the runtime is baked in.
- *T3:* `Cache-Control: public, max-age=31536000, immutable` on the hashed file; `no-cache` on `index.html`. New build → new hash → fresh fetch.
- *T4:* `rt := wazero.NewRuntime(ctx); defer rt.Close(ctx); mod,_ := rt.Instantiate(ctx, bytes); mod.ExportedFunction("add").Call(ctx,2,3)`. No `WithFS` → no filesystem.

---

## Medium

### Task 5 — Content negotiation with `Vary`

Extend Task 2's server to serve `.br` to brotli-capable clients, `.gz` to gzip clients, raw otherwise, setting `Content-Encoding` and `Vary: Accept-Encoding`. Test with `curl --compressed` and `curl -H 'Accept-Encoding: gzip'`.

**Goal.** Correct, cache-safe pre-compressed delivery.

### Task 6 — Lazy-load on feature activation

Build a page where the `.wasm` loads only when a button is clicked, exactly once, with a spinner during the download. Confirm via Network that nothing loads on initial page load.

**Goal.** Turn page-load cost into feature-activation cost.

### Task 7 — Progress bar via streamed fetch

Replace `instantiateStreaming` with a manual streamed `fetch` that reports bytes-received against `Content-Length`, drives a progress bar, then `WebAssembly.instantiate(buffer)`. Note the tradeoff you gave up.

**Goal.** Real loading UX for a multi-MB download; understand the streaming-vs-progress tradeoff.

### Task 8 — Compile once, instantiate per request

Build a wazero-backed HTTP server that exposes a guest's `process(input)` over `POST /run`. Compile the module once at startup; instantiate a fresh module per request and close it after.

**Goal.** The core server-side performance pattern.

### Task 9 — A build script that pins the shim

Write one script that strips, builds, copies the *matching* `wasm_exec.js`, content-hashes both as a pair, and pre-compresses. Run it under two Go versions and confirm the shim hash changes.

**Goal.** Eliminate shim/binary drift mechanically.

**Solutions (Medium).**
- *T5:* `switch` on `strings.Contains(ae,"br")`/`"gzip")`; set `Content-Encoding` + `Vary`. Serve already-compressed bytes; do **not** also run a gzip middleware.
- *T6:* Cache the instance in a module-level variable; `ensureWasm()` loads on first click only.
- *T7:* Read `resp.body.getReader()` in a loop, accumulate `received/total`. You lose `instantiateStreaming`'s download/compile overlap — justified for large payloads.
- *T8:* `CompileModule` once; per request `InstantiateModule(...)` then `defer mod.Close(ctx)`; marshal input into guest memory, call, read result back.
- *T9:* `SHIM=$(go env GOROOT)/lib/wasm/wasm_exec.js`; `H=$(shasum -a 256 app.wasm|cut -c1-8)`; copy to `app.$H.wasm` + `wasm_exec.$H.js`; `brotli`/`gzip`. Different Go → different binary → different hash.

---

## Hard

### Task 10 — Enforce memory cap and interruptible timeout

Write a wazero host that runs a guest with `WithMemoryLimitPages(256)` and a 50 ms context deadline with `WithCloseOnContextDone(true)`. Feed it (a) a guest that allocates unboundedly and (b) a guest that loops forever. Confirm the host survives both with a typed error per call.

**Goal.** Prove your sandbox withstands a hostile guest.

### Task 11 — Host functions as the only capability

Give the guest a single host function `log(ptr,len)` (read a string from guest memory, write to the host logger tagged with a tenant ID). Confirm the guest can log but still cannot touch files or network.

**Goal.** The deny-by-default capability door, concretely.

### Task 12 — A digest-keyed plugin registry

Build a registry that compiles each guest once, keys it by content SHA-256, validates at load (compile + a smoke `process` call), and exposes `Invoke(digest, input)`. Add a second version of the guest and switch the "active" digest at runtime.

**Goal.** The versioning/rollback backbone of a plugin system.

### Task 13 — Multi-tenant fairness

Run 3 tenants concurrently; one runs a heavy guest. Add a per-tenant concurrency semaphore and per-tenant deadlines. Measure p99 of the well-behaved tenants with and without the semaphore.

**Goal.** Demonstrate noisy-neighbour mitigation with numbers.

### Task 14 — Observability across the boundary

Instrument Task 12: per-digest/tenant metrics (invocations, p50/p99 latency, deadline-trip rate, mem-cap-hit rate), a structured error channel in the ABI distinct from traps, and a log line recording which digest handled each request. Trigger a guest trap and confirm it surfaces as a typed error, not a host panic.

**Goal.** Make the opaque boundary debuggable and incident-ready.

### Task 15 — Honest decision memo

Pick a real feature in a project you know. In one page, decide whether to use Wasm: name the compute or the isolation need, the alternative it must beat, the size budget impact, and the debugging cost. Conclude with a recommendation. (Most honest answers are "no.")

**Goal.** Practice the senior judgement that precedes any of the above.

**Solutions (Hard).**
- *T10:* `WithMemoryLimitPages(256)` → guest `grow` fails internally; `context.WithTimeout` + `WithCloseOnContextDone(true)` → the loop call returns a deadline error; host stays up. Map both to typed host errors; never `panic`.
- *T11:* `NewHostModuleBuilder("env").NewFunctionBuilder().WithFunc(...).Export("log")`. No `WithFS`/no network host fn → guest is confined to compute + logging.
- *T12:* `map[string]CompiledModule`; on register: `CompileModule`, run smoke `process`, store by digest; an atomic/`RWMutex`-guarded `active` digest; `Invoke` instantiates from the compiled module.
- *T13:* `semaphore.NewWeighted(n)` per tenant; acquire before `Invoke`. Without it the heavy tenant inflates everyone's p99; with it, well-behaved tenants stay flat.
- *T14:* Wrap `Invoke` with metrics; define a return convention `(code, errPtr, errLen)` for guest-reported errors; recover-free host that logs the wazero error from `Call`. Tag every log with digest + tenant.
- *T15:* The memo must reject Wasm if it can't name real client compute or untrusted-code isolation; otherwise weigh the ~2 MB floor and debugging friction against the win.
