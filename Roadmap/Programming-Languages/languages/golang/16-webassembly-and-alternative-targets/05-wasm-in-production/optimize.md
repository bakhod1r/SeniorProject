# Wasm in Production — Optimization

> Honest framing first: most "Wasm performance" wins in production are not about the guest's compute — they are about *delivery* (getting a multi-megabyte binary to a browser fast) and *host efficiency* (running guests on the server without recompiling or over-allocating). Module-internal compute and the JS↔Go boundary are covered in sibling [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/optimize.md); this file optimizes the production envelope around the binary.
>
> Each entry states the problem, a "before" and "after", and the realistic gain. The closing sections cover measurement and when optimizing is the wrong move (sometimes the fix is "don't use Wasm here").

---

## Browser Delivery

### Optimization 1 — Pre-compress at build, not per request

**Problem:** compressing a 6 MB binary on every request burns origin CPU for bytes that never change.

**Before:** a gzip middleware compresses `app.wasm` on the fly for each download.

**After:** build emits `app.wasm.br` and `app.wasm.gz`; the server sends the pre-built variant matching `Accept-Encoding` with `Content-Encoding` + `Vary`.

**Gain:** origin CPU per download drops to ~0 (a static file send); brotli `-q 11` (affordable once, at build) beats on-the-fly gzip both in size and cost. Typical wire size: 6 MB → ~1.5 MB.

---

### Optimization 2 — Brotli over gzip for the binary

**Problem:** gzip is the default everywhere but leaves size on the table for Wasm's dense, regular bytecode.

**Before:** `gzip -9` → ~30% of raw.

**After:** `brotli -q 11` → ~24–28% of raw; ship both and let negotiation pick brotli for capable clients (the vast majority).

**Gain:** ~10–15% smaller transfer than gzip — meaningful on mobile, free once pre-built. Keep gzip as the fallback variant.

---

### Optimization 3 — Strip the binary before compression

**Problem:** debug info and symbol tables inflate the binary and leak local paths.

**Before:** `GOOS=js GOARCH=wasm go build -o app.wasm .`

**After:** `GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o app.wasm .`

**Gain:** a few hundred KB off the raw binary (and a bit off the compressed size); `-trimpath` removes machine-specific paths for reproducibility. Note: this strips DWARF, so native Wasm debugging gets harder — keep an unstripped build for debugging.

---

### Optimization 4 — Content-hash + `immutable` for free repeat visits

**Problem:** without long-lived caching, every visit re-downloads the binary.

**Before:** `Cache-Control: no-cache` on `app.wasm`.

**After:** `app.<sha>.wasm` served `public, max-age=31536000, immutable`; entry HTML stays `no-cache`.

**Gain:** repeat visits pay *zero* network for the binary, and deploys never serve stale code (new hash → new URL). This is the single biggest win for returning users.

---

### Optimization 5 — Push the binary to a CDN

**Problem:** every download traverses the network to your origin, far from the user.

**Before:** origin serves the binary worldwide.

**After:** the hashed, pre-compressed binary lives on a CDN edge; origin serves only the HTML/API.

**Gain:** download latency drops to the nearest POP RTT; origin bandwidth and load fall. Verify the CDN preserves `Content-Type`, passes through `Content-Encoding`, and keys on `Vary`.

---

### Optimization 6 — Lazy-load and prefetch

**Problem:** eager site-wide loading makes every page pay the binary, hurting LCP/INP where the feature isn't used.

**Before:** `<script>` loads the module in the shared header.

**After:** load on route/feature entry, once; `<link rel="prefetch">` the hashed binary during idle on pages where the user is *likely* to need it.

**Gain:** initial render is unblocked; the binary warms the cache during idle so activation feels instant. Turns a page-load cost into a (often hidden) feature-activation cost.

---

### Optimization 7 — Consolidate features into one module

**Problem:** multiple client-side Wasm features each re-pay the ~2 MB Go runtime floor.

**Before:** three separate `.wasm` modules, three runtimes downloaded.

**After:** one binary exporting the three features, loaded once per session.

**Gain:** the runtime floor is paid once, not three times — can save several MB of download for a multi-feature client. (If a feature is rarely used, weigh against lazy-loading it separately.)

---

## Server-Side (wazero)

### Optimization 8 — Compile once, instantiate per request

**Problem:** `Instantiate(bytes)` recompiles the guest every call; compilation dominates latency.

**Before:** per-request `rt.Instantiate(ctx, guestBytes)`.

**After:** `CompileModule` once at startup; `InstantiateModule(compiled)` per request.

**Gain:** per-request latency drops from "compile + run" to "instantiate + run" — instantiation is orders of magnitude cheaper than compilation. This is the highest-leverage server-side change.

---

### Optimization 9 — Choose the right engine for the call pattern

**Problem:** the optimizing compiler pays a high first-compile cost; for rarely-called guests that cost may never amortize.

**Before:** default compiler for a guest invoked a handful of times.

**After:** `NewRuntimeConfigInterpreter()` for short-lived/rarely-called guests; keep the compiler for hot, long-lived ones.

**Gain:** lower startup for cold workloads; faster steady-state for hot ones. Measure both with your guest — the crossover depends on invocation count and compute per call.

---

### Optimization 10 — Right-size the memory cap

**Problem:** an over-generous per-instance page cap multiplied by concurrency dictates worst-case host memory; too low causes guest allocation failures.

**Before:** default (unbounded) or a guessed 4 GiB cap with 200 concurrent instances → 800 GiB worst case (i.e., OOM risk uncapped).

**After:** measure the guest's real peak; set `WithMemoryLimitPages` to peak + headroom; size instance concurrency so `instances × cap` fits host RAM.

**Gain:** predictable, bounded host memory and a real DoS ceiling, without starving legitimate guests. This is capacity planning, not micro-tuning.

---

### Optimization 11 — Reuse the runtime; close instances promptly

**Problem:** creating a `Runtime` per request rebuilds host modules and engine state; not closing instances leaks memory.

**Before:** `rt := wazero.NewRuntime(ctx)` inside the handler.

**After:** one process-lifetime `Runtime` (host functions registered once); `defer mod.Close(ctx)` on every per-request instance.

**Gain:** removes redundant setup per request and bounds steady-state memory. Closing the instance frees its linear memory immediately rather than waiting on GC.

---

### Optimization 12 — Bound concurrency for fairness and memory

**Problem:** unbounded concurrent invocations let one tenant monopolize CPU/memory and spike everyone's p99.

**Before:** no limit; instances created on demand.

**After:** a global and per-tenant concurrency semaphore sized to host headroom and fairness goals.

**Gain:** flat p99 for well-behaved tenants under a noisy neighbour, and a hard cap on `instances × mem` worst case. Add instruction-budget metering for load-independent fairness.

---

### Optimization 13 — Cache compiled modules by digest

**Problem:** re-reading and recompiling the same guest across restarts/instances wastes startup time.

**Before:** compile from bytes on every process start, per module.

**After:** a registry keyed by content digest holds the `CompiledModule`; share it across all instances; (where the runtime supports it) persist/serialize the compiled form to skip recompilation on restart.

**Gain:** amortizes compilation across the module's whole lifetime and all tenants; faster cold start on platforms that cache compiled artefacts.

---

### Optimization 14 — Minimize boundary copies

**Problem:** marshaling large inputs/outputs across the host/guest boundary copies bytes twice (host→guest memory, guest→host).

**Before:** serialize a large struct to JSON, copy in, copy result out, deserialize.

**After:** use a compact binary encoding, agree on an allocator convention so the host writes directly into guest memory, and read results in place (honoring bounds). For very large payloads, stream in chunks.

**Gain:** lower latency and allocation for data-heavy guests. Deep treatment, including zero-copy patterns, in [04-wasm-interop-and-performance](../04-wasm-interop-and-performance/optimize.md).

---

## Measurement

Optimize against numbers, not intuition.

- **Browser delivery:** DevTools Network (transfer size, `Content-Encoding`, cache hit/miss), Lighthouse / Core Web Vitals (LCP, INP), and the `Server-Timing` header. Confirm the compressed size and the `immutable` cache hit on reload.
- **Compile vs run (server):** time `CompileModule` separately from `InstantiateModule` and `Call`; the split tells you whether you're paying the compile bug (Optimization 8).
- **Host memory:** track live instance count × cap and actual RSS; alert on cap-hit rate (a sign of under-sized caps or hostile guests).
- **Fairness:** per-tenant p50/p99 latency and deadline-trip rate; a noisy neighbour shows up as correlated spikes.
- **Always A/B the change:** measure before, apply one optimization, measure after. Wasm delivery numbers vary wildly by network and device — use percentiles, not a single laptop run.

---

## When Optimizing Is the Wrong Move

- **The binary is large because the app is CRUD.** No amount of compression fixes shipping a runtime nobody needs. The fix is *not using Wasm* for that page (see [senior.md](senior.md)).
- **You need below the ~2 MB floor.** Standard Go can't go there; that's a toolchain decision (TinyGo, sibling [03-tinygo-for-wasm-and-embedded](../03-tinygo-for-wasm-and-embedded/optimize.md)), not a delivery tweak.
- **Per-request latency is bound by guest compute, not framework.** If you've already compiled once and removed boundary copies, the remaining cost is the algorithm — optimize the guest's Go code, not the host.
- **Micro-optimizing a cold, rarely-called path.** Spend the effort where the traffic is; a feature loaded once per session rarely justifies shaving 50 KB.

The throughline: the durable wins are **pre-compress + content-hash + CDN + lazy-load** in the browser, and **compile-once + bounded memory + bounded concurrency** on the server. Get those right before reaching for anything subtler.
