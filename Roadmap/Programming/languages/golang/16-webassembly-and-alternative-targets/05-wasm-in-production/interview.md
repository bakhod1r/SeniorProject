# Wasm in Production — Interview Questions

> Practice questions ranging from junior to staff-level, covering both browser delivery and server-side embedding of Go-compiled WebAssembly. Each has a model answer, common wrong answers, and follow-up probes. A quick-fire round closes the file.

---

## Junior

### Q1. What `Content-Type` must a server send for a `.wasm` file, and why does it matter?

**Model answer.** `Content-Type: application/wasm`. The browser's fast path, `WebAssembly.instantiateStreaming(fetch(url), …)`, compiles the module as it downloads — but the spec requires the response MIME type to be exactly `application/wasm`, or it rejects with a `TypeError`. The wrong type forces a slower buffered fallback or a hard failure.

**Common wrong answers.** "`application/octet-stream` is fine" (rejects streaming); "the browser sniffs the type" (it does not, for streaming compile).

**Follow-up.** *Does Go's `http.FileServer` get this right?* — Yes, since Go 1.17 the `mime` package maps `.wasm` correctly; but nginx, S3, and many CDNs do not, so verify in DevTools.

---

### Q2. Why are Go-compiled `.wasm` files large, and what do you do about it?

**Model answer.** Standard Go bakes the runtime — GC, scheduler, reflection — into every binary, so even hello-world is ~2 MB. The fix is compression: Wasm compresses to ~28–32% with gzip, a bit smaller with brotli, so a 6 MB binary lands around 1.5–1.6 MB. Compress once at build time and serve the pre-compressed variant.

**Common wrong answers.** "Just minify it" (Wasm isn't text); "compression is the CDN's job" (many CDNs skip `application/wasm`).

**Follow-up.** *What if 2 MB is still too big?* — That's the TinyGo case (a different toolchain, smaller binaries, language/library limits), or reconsider whether Wasm fits.

---

### Q3. What is `wasm_exec.js` and why must it match your Go version?

**Model answer.** It's the JavaScript glue from the Go toolchain that implements the host functions the Go runtime imports — timers, the `syscall/js` bridge, the event loop. Its contract is version-locked to the runtime that built the binary; the set of imports changes between Go releases, so a stale shim breaks the contract, often as a silent blank page.

**Follow-up.** *How do you prevent drift?* — Copy the shim from `$(go env GOROOT)/lib/wasm/` on every build in a script, and ship the shim and binary as one (ideally content-hashed) pair.

---

### Q4. In the browser, can a Go `.wasm` read the user's files or open arbitrary sockets?

**Model answer.** No more than JavaScript can. It runs in the browser's sandbox under the same-origin policy: filesystem only via user-initiated pickers, network only through `fetch`/JS. The browser protects the user from the page.

**Common wrong answer.** "Wasm is native code so it has more access" — false; it's confined to the page's existing boundary.

---

## Middle

### Q5. Walk through correct content negotiation for a pre-compressed `.wasm`.

**Model answer.** Build produces `app.wasm`, `app.wasm.br`, `app.wasm.gz`. The server reads `Accept-Encoding`, serves the smallest variant the client accepts, sets `Content-Type: application/wasm`, sets `Content-Encoding: br`/`gzip` to match the bytes it sends, and adds `Vary: Accept-Encoding`. The browser decompresses transparently and streaming compilation still sees `application/wasm`.

**Common wrong answers.** Omitting `Vary` (a shared cache may hand brotli bytes to a gzip-only client → corrupt decode); running a gzip middleware over the already-compressed file (double compression).

**Follow-up.** *Where does this happen with nginx?* — `brotli_static on; gzip_static on;` auto-serves `app.wasm.br`/`.gz`; let nginx negotiate and have Go serve only the raw file with the MIME type.

---

### Q6. Design a caching scheme that's instant on repeat visits but never serves stale code.

**Model answer.** Content-hash the filename (`app.9f2c1a.wasm`), serve it `Cache-Control: public, max-age=31536000, immutable`, and reference it from an HTML/manifest served `no-cache`. A new build changes the hash → a new URL the browser has never cached → it fetches fresh. Old hashed files stay harmlessly cached. Hash `wasm_exec.js` too.

**Common wrong answer.** Long `max-age` on an unhashed `main.wasm` — strands users on old code until the cache expires.

---

### Q7. On the server with wazero, what's the single biggest performance mistake, and the fix?

**Model answer.** Recompiling the guest on every request. Compilation (Wasm → native) is the expensive step; instantiation is cheap. Fix: `CompileModule` once at startup, then `InstantiateModule` a fresh instance per request. The fresh instance also gives per-request memory isolation.

**Follow-up.** *Why a fresh instance per request rather than pooling instances?* — A pooled instance carries residual linear-memory state, which breaks isolation between tenants/calls. Share the immutable compiled module; isolate the mutable instance.

---

### Q8. How do you stop an untrusted server-side guest from hanging or OOM-ing the host?

**Model answer.** Two limits. Memory: `WithMemoryLimitPages` caps linear-memory growth so `memory.grow` fails inside the guest, not in the host. Time: wrap the call in a `context` deadline and configure the runtime with `WithCloseOnContextDone(true)` so a CPU-bound loop is actually interrupted — without that, the deadline only fires at host-function boundaries.

**Common wrong answer.** "A context timeout alone stops it" — not against a pure compute loop unless `WithCloseOnContextDone` is set.

---

### Q9. How does a sandboxed guest do anything useful (log, read config) if it has no capabilities?

**Model answer.** Through *host functions*: Go functions the host registers into a module the guest imports (`NewHostModuleBuilder`). The guest calls them; data crosses as `(pointer, length)` into guest linear memory. Capabilities are explicit and minimal — the guest gets exactly the functions you grant, nothing ambient.

---

## Senior

### Q10. When is Wasm the right tool in production, and when is it over-engineering?

**Model answer.** Two justifications: portable near-native compute in a host you don't control (browser — image/video processing, in-browser data tools, privacy-preserving on-device work) and in-process isolation of code you don't trust (server — customer plugins, policy engines, sandboxed user code). It's over-engineering for ordinary CRUD, light interactivity, or server logic you wrote and trust — there you pay the boundary's cost (size, serialization, debugging friction) for nothing.

**Follow-up.** *Discriminating question for the server side?* — "Do you need to run code you didn't write?" If no, a plain function call beats a sandbox.

---

### Q11. Architect a multi-tenant plugin system on wazero. What are the layers and the isolation rules?

**Model answer.** Layers: a versioned ABI contract (`//go:wasmexport`/`//go:wasmimport`), a registry that compiles each module once and keys it by content digest with load-time validation, an execution layer that instantiates fresh per call with per-call limits, a capability layer that injects tenant-scoped host functions, and a limits/policy layer (memory cap, deadline, per-tenant concurrency, rate limit). Isolation rule: **share the immutable compiled module; never pool mutable instances across tenants.** Worst-case host memory ≈ concurrent_instances × max_pages; size concurrency from that.

---

### Q12. Give the capability threat model for running untrusted modules.

**Model answer.** The guest is the adversary. CPU DoS → deadline + `WithCloseOnContextDone` + instruction budget + per-tenant concurrency. Memory DoS → page cap + bounded concurrency. Data exfiltration → grant no IO capability by default; scope every host function to the tenant. Sandbox escape → keep wazero current and run the host process itself with least privilege (defense in depth). Supply-chain → sign and digest-pin modules. Deny-by-default is the design; every granted host function is reviewed attack surface.

---

### Q13. Is Wasm at the edge actually faster than containers? Be honest.

**Model answer.** For cold start and density, yes: a module instantiates in microseconds-to-low-milliseconds from a pre-compiled artefact versus hundreds of ms to seconds for a container, enabling scale-to-zero and dense multi-tenant packing. Caveats: the *first compile* is the real cold start, so the win assumes the platform's compiled-artefact cache is warm; `wasip1` has no sockets, so network IO goes through platform host functions; and standard Go works on `wasip1` platforms (Fastly, Spin) while component-model/size-tight ones (wasmCloud, Cloudflare Workers) often need TinyGo today. Use containers when you need full POSIX or sockets.

---

### Q14. How do you make the host/guest boundary observable, and roll a guest back?

**Model answer.** The boundary is opaque — a trap is one Go `error`. Log from the guest via a host function tagged with module digest + tenant; define a structured error channel in the ABI distinct from hard traps; emit per-module/tenant metrics (invocations, latency, deadline-trip rate, cap-hit rate) and alert on trip/cap spikes; record which digest handled each request. Rollback: register by digest, canary new versions, promote/roll back by flipping the active digest; keep N previous versions loadable; treat the ABI as a versioned interface requiring coordinated changes.

---

## Staff

### Q15. A team proposes rewriting their server-rendered CRUD admin panel in Go+Wasm "for performance and code sharing." How do you respond?

**Model answer.** Push back. CRUD has no real client-side compute and no untrusted-code isolation need — the two things Wasm uniquely provides. They'd ship a multi-MB runtime to replace kilobytes of HTML/JS, hurt LCP/INP, and inherit debugging friction, for code-sharing they could get with a thin shared validation module loaded lazily on the few forms that need it. Recommend: keep server-rendered pages, and if validation-drift is the real pain, ship one small lazy-loaded Wasm validation module — not a full rewrite. Decide the runtime-size budget *before* building.

---

### Q16. You run a multi-tenant policy engine on wazero; one tenant's policies intermittently spike host CPU and p99 for everyone. Diagnose and fix.

**Model answer.** Noisy neighbour. Diagnose with per-tenant metrics: which digest's invocations correlate with the deadline-trip-rate and CPU spikes. Likely a policy with pathological input causing heavy compute. Fixes, layered: short per-call deadlines with `WithCloseOnContextDone` so spins are interrupted; a per-tenant concurrency semaphore so one tenant can't monopolise the worker pool; instruction-budget metering for deterministic, load-independent fairness (wall-clock varies with host load); per-tenant rate limits; and capacity-size the instance concurrency so worst-case `instances × mem-cap` fits host headroom. Long term, consider isolating the highest-risk tenant in a separate process.

---

### Q17. Design the deploy/version story so a bad Go upgrade can't ship a broken `.wasm` to users.

**Model answer.** Pin the toolchain (`toolchain go1.x` in `go.mod`) so `wasm_exec.js` and the ABI are stable. Build the binary and copy the *matching* shim in one hermetic CI step, content-hash both as a pair, pre-compress, and strip. Gate the artefact behind validation (smoke-instantiate, a load test). In the browser, the content hash is the version; rollback re-points the manifest at the previous hash (still CDN-cached) — instant, no rebuild. For server guests, register by digest, canary, and flip the active digest to roll back. The shim/binary pairing and the toolchain pin are what prevent the "rebuilt with new Go, stale shim, blank page" class of incident.

---

## Quick-Fire Round

- **Streaming compile requires which header?** → `Content-Type: application/wasm`.
- **Which header stops a cache serving the wrong compression variant?** → `Vary: Accept-Encoding`.
- **Rough gzip ratio for Go Wasm?** → ~30% of raw (~28–32%); brotli a bit smaller.
- **Standard-Go binary size floor?** → ~2 MB raw / ~600 KB compressed (runtime baked in).
- **wazero in one phrase?** → pure-Go, zero-dependency, in-process Wasm runtime.
- **Compile vs instantiate — which is expensive?** → Compile. Do it once.
- **Pool the compiled module or the instance?** → The compiled module (immutable, shared); never the instance.
- **Two limits every untrusted guest needs?** → Memory page cap + interruptible context deadline.
- **What makes the deadline interrupt a compute loop?** → `WithCloseOnContextDone(true)`.
- **Does `wasip1` have sockets?** → No. Network via host functions.
- **Go version for `wasip1`?** → 1.21+.
- **Go version for `//go:wasmexport`?** → 1.24+ (and shim moved to `lib/wasm/`).
- **Browser-only target?** → `GOOS=js GOARCH=wasm`.
- **Browser threads for goroutines?** → No true parallelism under `GOOS=js`.
- **Fallback when MIME can't be fixed?** → buffered `WebAssembly.instantiate(arrayBuffer)`.
- **Where does TinyGo come in?** → smaller binaries, component-model/size-tight edge platforms; different toolchain (sibling 03).
- **Cache directive for hashed `.wasm`?** → `public, max-age=31536000, immutable`.
- **First thing to check on a blank page after a Go upgrade?** → stale `wasm_exec.js`.
- **Browser sandbox vs wazero sandbox?** → browser protects the user from the page; wazero protects the host from the guest — different boundaries.
- **One-line reason most apps shouldn't use Wasm?** → No real client compute and no untrusted code to isolate.
