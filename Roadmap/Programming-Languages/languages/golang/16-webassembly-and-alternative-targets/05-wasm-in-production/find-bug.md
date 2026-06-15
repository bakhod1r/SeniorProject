# Wasm in Production — Find the Bug

> Each scenario contains a real-world bug in shipping Go-compiled WebAssembly — browser delivery or server-side embedding with [wazero](https://wazero.io). For each: the **symptom** you'd see, the **root cause**, and the **fix**. These are the failures that fill Wasm incident channels; learn to recognize them from the symptom alone.

---

## Bug 1 — Wrong MIME type breaks streaming compilation

```nginx
location /static/ {
    root /var/www;
    # .wasm served with the default type
}
```

```
# Browser console:
TypeError: Failed to execute 'compileStreaming' on 'WebAssembly':
Incorrect response MIME type. Expected 'application/wasm'.
```

**Symptom:** the page fails to load the module; works on the dev machine (Go's `FileServer` sends the right type) but breaks behind nginx/S3/CDN.

**Root cause:** the static server sends `.wasm` as `application/octet-stream` (or `text/plain`). `WebAssembly.instantiateStreaming` *requires* `application/wasm` per spec and rejects otherwise.

**Fix:** declare the type at the server:

```nginx
types { application/wasm wasm; }
# or: location ~ \.wasm$ { default_type application/wasm; }
```

For S3/CDN, set the object's `Content-Type` metadata on upload. Verify with `curl -sI .../app.wasm | grep -i content-type`.

---

## Bug 2 — Stale `wasm_exec.js` after a Go upgrade

```bash
# CI was upgraded from Go 1.23 to Go 1.24, rebuilds the binary,
# but wasm_exec.js is checked into the repo and never updated.
$ git ls-files | grep wasm_exec
public/wasm_exec.js          # committed once, long ago
```

**Symptom:** blank page, no obvious error (or a cryptic runtime error). The build succeeded; the binary is fresh.

**Root cause:** `wasm_exec.js` is version-locked to the runtime that built the binary. The new Go runtime imports a different set of host functions than the old shim provides — the contract is broken.

**Fix:** copy the shim from the building toolchain on every build, never commit a hand-maintained copy:

```bash
SHIM="$(go env GOROOT)/lib/wasm/wasm_exec.js"          # Go 1.24+
[ -f "$SHIM" ] || SHIM="$(go env GOROOT)/misc/wasm/wasm_exec.js"
cp "$SHIM" public/
```

Content-hash it as a pair with the binary so drift is impossible.

---

## Bug 3 — Multi-megabyte payload served uncompressed

```go
http.Handle("/static/", http.StripPrefix("/static/",
    http.FileServer(http.Dir("public"))))   // serves raw app.wasm, 6 MB
```

**Symptom:** slow first load (seconds on mobile), large transfer in the Network tab matching the raw file size; no `Content-Encoding` header on the `.wasm` response.

**Root cause:** the binary is served uncompressed. Wasm compresses to ~30%; 6 MB should be ~1.6 MB on the wire.

**Fix:** pre-compress at build time and serve the variant matching `Accept-Encoding`, with `Vary`:

```go
w.Header().Set("Content-Type", "application/wasm")
w.Header().Add("Vary", "Accept-Encoding")
if strings.Contains(r.Header.Get("Accept-Encoding"), "br") {
    w.Header().Set("Content-Encoding", "br")
    http.ServeFile(w, r, "public/app.wasm.br")
    return
}
http.ServeFile(w, r, "public/app.wasm")
```

(Or `brotli_static on; gzip_static on;` in nginx.)

---

## Bug 4 — Missing `Vary: Accept-Encoding` corrupts cached responses

```go
if strings.Contains(r.Header.Get("Accept-Encoding"), "br") {
    w.Header().Set("Content-Encoding", "br")
    http.ServeFile(w, r, "public/app.wasm.br")
}
// no Vary header set anywhere
```

**Symptom:** *intermittent* failures — some users get a corrupt-module / decode error, others are fine. Correlates with a CDN/proxy in front.

**Root cause:** without `Vary: Accept-Encoding`, a shared cache stores one response and serves it to everyone — handing brotli-encoded bytes to a client that only sent `Accept-Encoding: gzip` (or none), which then mis-decodes.

**Fix:** always `w.Header().Add("Vary", "Accept-Encoding")` when content varies by encoding, and confirm the CDN includes `Accept-Encoding` in its cache key.

---

## Bug 5 — Double compression

```go
mux.Handle("/static/", gzipMiddleware(http.FileServer(http.Dir("public"))))
// public/ contains app.wasm.gz, and the handler serves it with Content-Encoding: gzip,
// THEN gzipMiddleware gzips the response body again.
```

**Symptom:** payload is *larger* than the raw file, or the browser fails to decode; `Content-Encoding: gzip` present but body is double-gzipped.

**Root cause:** a generic compression middleware re-compresses an already-compressed response.

**Fix:** never run compression middleware over pre-compressed assets. Exclude the static-wasm route, or compress only at build time and disable runtime compression for it.

---

## Bug 6 — Unhashed filename with a long cache lifetime

```go
w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
http.ServeFile(w, r, "public/main.wasm")   // filename never changes
```

**Symptom:** after a deploy, users run the *old* code for days; bug fixes don't reach them; hard refresh "fixes" it for one user.

**Root cause:** `immutable, max-age=1yr` on a stable filename tells the browser to never revalidate. The new build reuses `main.wasm`, so the cached old bytes win.

**Fix:** content-hash the filename (`app.<sha>.wasm`) so each build is a new URL; keep the long cache only on hashed names; serve the referencing HTML `no-cache`.

---

## Bug 7 — Loading the `.wasm` on every page

```html
<!-- in the shared site header, on every page -->
<script src="wasm_exec.js"></script>
<script>WebAssembly.instantiateStreaming(fetch("/app.wasm"), new Go().importObject)</script>
```

**Symptom:** every page (including the marketing homepage) downloads 1.6 MB and runs the Go runtime, hurting LCP/INP everywhere.

**Root cause:** the module is loaded eagerly, site-wide, even where its feature is never used.

**Fix:** lazy-load on the route/feature that needs it, once:

```js
let inst;
async function ensureWasm() {
  if (inst) return inst;
  const go = new Go();
  ({ instance: inst } = await WebAssembly.instantiateStreaming(fetch("/app.<hash>.wasm"), go.importObject));
  go.run(inst);
  return inst;
}
```

---

## Bug 8 — No loading state or failure handling

```js
WebAssembly.instantiateStreaming(fetch("/app.wasm"), go.importObject)
  .then(r => go.run(r.instance));
// no spinner, no .catch
```

**Symptom:** blank page for seconds on slow networks; on a 404 or MIME error, a permanently dead page with only a console error.

**Root cause:** no loading UX and no rejection handler.

**Fix:** render a spinner *before* the fetch, remove it on success, and handle failure visibly and retryably:

```js
showSpinner();
WebAssembly.instantiateStreaming(fetch(url), go.importObject)
  .then(r => { hideSpinner(); go.run(r.instance); })
  .catch(e => showError("Failed to load module", e));
```

---

## Bug 9 — Assuming a `js/wasm` binary runs in wazero

```bash
$ GOOS=js GOARCH=wasm go build -o guest.wasm .
$ ./host    # wazero host loading guest.wasm
panic: module[env] not instantiated   # (or: missing import "go"/"runtime.wasmExit")
```

**Symptom:** the host fails to instantiate the module, complaining about missing imports it doesn't recognize.

**Root cause:** a `GOOS=js` binary expects the `wasm_exec.js` JS bridge (imports like `runtime.wasmExit`, `syscall/js.*`). wazero implements `wasi_snapshot_preview1`, not the Go JS bridge.

**Fix:** build the server-side guest for WASI:

```bash
GOOS=wasip1 GOARCH=wasm go build -o guest.wasm .
```

The two targets are not interchangeable (see [02-wasi-and-wasip1](../02-wasi-and-wasip1/middle.md)).

---

## Bug 10 — Recompiling the guest on every request

```go
func handler(w http.ResponseWriter, r *http.Request) {
    rt := wazero.NewRuntime(ctx)            // new runtime every request
    defer rt.Close(ctx)
    mod, _ := rt.Instantiate(ctx, guestBytes) // compiles every request
    mod.ExportedFunction("process").Call(ctx, arg)
}
```

**Symptom:** high, flat per-request latency; CPU dominated by compilation; p99 cliff under load.

**Root cause:** `Instantiate` compiles the module each call. Compilation is the expensive step; it's being paid per request.

**Fix:** compile once, instantiate per request:

```go
// startup:
rt := wazero.NewRuntime(ctx)
compiled, _ := rt.CompileModule(ctx, guestBytes)

// per request:
mod, _ := rt.InstantiateModule(ctx, compiled, wazero.NewModuleConfig().WithName(""))
defer mod.Close(ctx)
mod.ExportedFunction("process").Call(ctx, arg)
```

---

## Bug 11 — Unbounded guest memory crashes the host

```go
rt := wazero.NewRuntime(ctx)   // default config: no memory limit
mod, _ := rt.InstantiateModule(ctx, compiled, wazero.NewModuleConfig())
// guest does: make([]byte, 4<<30) and grows linear memory unbounded
```

**Symptom:** host OOM-killed under a malicious or buggy guest; sporadic crashes that take down all tenants in the process.

**Root cause:** no cap on guest linear-memory growth.

**Fix:** cap pages on the runtime config:

```go
rt := wazero.NewRuntimeWithConfig(ctx,
    wazero.NewRuntimeConfig().WithMemoryLimitPages(256)) // 16 MiB ceiling
```

Now `memory.grow` past the cap fails *inside* the guest; the host stays up.

---

## Bug 12 — Timeout that can't interrupt a compute loop

```go
rt := wazero.NewRuntime(ctx)   // WithCloseOnContextDone NOT set
callCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
defer cancel()
fn.Call(callCtx, arg)          // guest runs `for {}` — never returns
```

**Symptom:** request hangs forever despite the 50 ms deadline; a worker goroutine is stuck; eventually the pool is exhausted.

**Root cause:** without `WithCloseOnContextDone`, the deadline is only observed at host-function boundaries. A pure CPU loop never hits one, so cancellation never takes effect.

**Fix:** enable context-driven interruption:

```go
rt := wazero.NewRuntimeWithConfig(ctx,
    wazero.NewRuntimeConfig().WithCloseOnContextDone(true))
```

Now the compiled/interpreted code polls for cancellation and the loop is interrupted.

---

## Bug 13 — Guest trap crashes the host

```go
_, err := fn.Call(ctx, arg)
if err != nil {
    panic(err)   // a guest trap takes down the whole server
}
```

**Symptom:** one bad input to one tenant's guest crashes the entire host process, dropping all in-flight requests.

**Root cause:** a guest trap (out-of-bounds, `unreachable`, divide-by-zero, deadline) surfaces as a Go `error`. Treating it as fatal lets an untrusted guest DoS the host.

**Fix:** handle the error as data; the boundary is a trust boundary:

```go
res, err := fn.Call(ctx, arg)
if err != nil {
    log.Warn("guest trap", "digest", p.Digest, "tenant", tenant, "err", err)
    return errGuestFailed   // typed, non-fatal
}
```

---

## Bug 14 — Granting an ambient capability "to make it work"

```go
cfg := wazero.NewModuleConfig().
    WithFS(os.DirFS("/"))   // gave the guest the entire filesystem, read access
```

**Symptom:** a security review (or a malicious guest) finds the guest can read `/etc/passwd`, secrets, other tenants' data on disk.

**Root cause:** debugging a "file not found" was "fixed" by granting the whole root FS — ambient authority, the opposite of deny-by-default.

**Fix:** grant the narrowest preopen the guest actually needs, read-only, scoped to its own data:

```go
cfg := wazero.NewModuleConfig().
    WithFS(os.DirFS("/var/data/tenants/"+tenantID))  // only this subtree
```

Better: provide data through a scoped host function instead of a filesystem at all.

---

## Bug 15 — Unchecked guest pointer/length read

```go
results, _ := fn.Call(ctx, arg)          // guest returns a (ptr, len)
ptr, n := uint32(results[0]>>32), uint32(results[0])
buf, _ := mod.Memory().Read(ptr, n)      // ignores the ok return
process(buf)                              // buf may be nil / wrong
```

**Symptom:** garbage output, a panic in `process`, or reading unintended guest memory — depending on what the guest returned.

**Root cause:** `Memory().Read(ptr, n)` returns `(buf, ok)`; `ok` is `false` when `(ptr, n)` is out of range. A malicious guest can return an out-of-bounds region; ignoring `ok` trusts the guest's pointers.

**Fix:** always honor `ok` and bound the length:

```go
buf, ok := mod.Memory().Read(ptr, n)
if !ok || n > maxResultBytes {
    return errBadGuestOutput
}
```

---

## Bug 16 — Stale memory view after the guest grew memory

```go
in, _ := mod.Memory().Read(inPtr, inLen)   // view into linear memory
mod.ExportedFunction("transform").Call(ctx, ...) // guest grows memory here
use(in)                                     // `in` may now point at moved/old memory
```

**Symptom:** intermittent corruption; works for small inputs, fails for large ones that trigger a `memory.grow` inside the call.

**Root cause:** a `memory.grow` can relocate/resize linear memory, invalidating byte slices read beforehand.

**Fix:** read from guest memory *after* any call that can grow it, and don't hold long-lived views across guest calls. Copy out what you need immediately:

```go
buf, ok := mod.Memory().Read(ptr, n)   // read AFTER the call returns
cp := append([]byte(nil), buf...)       // own a copy if you'll keep it
```

---

## Bug 17 — Reusing a named module instance across requests

```go
mod, _ := rt.InstantiateModule(ctx, compiled, wazero.NewModuleConfig().WithName("plugin"))
// stored globally and reused for every request, every tenant
```

**Symptom:** either a `module "plugin" already instantiated` error on the second instance, or — worse — data from tenant A visible to tenant B.

**Root cause:** a single shared instance carries one linear memory; reusing it leaks state across calls/tenants. A fixed name also prevents instantiating a second copy.

**Fix:** instantiate a fresh, anonymous module per request and close it after:

```go
mod, _ := rt.InstantiateModule(ctx, compiled, wazero.NewModuleConfig().WithName(""))
defer mod.Close(ctx)
```

Share the immutable `compiled` module; never the mutable instance.

---

## Bug 18 — CDN strips or rewrites the `Content-Type`

```
$ curl -sI https://cdn.example.com/app.<hash>.wasm
HTTP/2 200
content-type: application/octet-stream        # origin sent application/wasm
```

**Symptom:** works from origin, breaks through the CDN; streaming compile rejects only in production.

**Root cause:** the object storage / CDN stored or normalized the type to `application/octet-stream` (common with S3 when metadata isn't set on upload).

**Fix:** set `Content-Type: application/wasm` on the object at upload time and confirm the CDN forwards it; some CDNs need an explicit content-type rule for `.wasm`.

---

## Bug 19 — Progress bar computed against the wrong length

```js
const total = +resp.headers.get("Content-Length");  // compressed length
let received = 0;
for (;;) { const {done,value}=await reader.read(); if(done)break;
  received += value.length;                          // DECOMPRESSED bytes
  setProgress(received/total); }                     // >1.0, or stalls
```

**Symptom:** the progress bar overshoots 100%, jumps erratically, or finishes early.

**Root cause:** when the browser transparently decompresses (`Content-Encoding: br`), `Content-Length` is the *encoded* size but the reader yields *decoded* bytes — mismatched units.

**Fix:** measure against the encoded stream you actually read, or prefer `instantiateStreaming` (which needs no manual progress) for moderate sizes. If you need a true progress bar, fetch the raw bytes without transparent decode and decompress yourself, or report indeterminate progress.

---

## Bug 20 — `_start` re-run instead of a reactor export

```go
// guest built as a WASI command (func main), host calls _start repeatedly
start := mod.ExportedFunction("_start")
for _, in := range inputs { start.Call(ctx) }   // re-runs main each time
```

**Symptom:** global state in the guest accumulates or resets unexpectedly; `os.Exit`-style termination after the first call; can't pass per-call input cleanly.

**Root cause:** a WASI *command* (`func main`) is meant to run once via `_start` and exit. Driving it repeatedly is the wrong model for a plugin.

**Fix:** build the guest as a reactor/library and export an entry point (Go 1.24+):

```go
//go:wasmexport process
func process(ptr, n uint32) uint64 { /* ... */ }
```

Call `mod.ExportedFunction("process")` per request; reserve `_start`/`main` for one-shot commands.

---

## Bug 21 — Wrong Go version for `wasip1` / `wasmexport`

```bash
$ go version
go version go1.20.10
$ GOOS=wasip1 GOARCH=wasm go build .
go: unsupported GOOS/GOARCH pair wasip1/wasm
```

**Symptom:** the build refuses `wasip1` (pre-1.21), or `//go:wasmexport` is ignored / errors (pre-1.24), or CI can't find `wasm_exec.js` at `lib/wasm/` (it's at `misc/wasm/` before 1.24).

**Root cause:** version-gated features: `wasip1` is Go 1.21+, `//go:wasmexport` and the `lib/wasm/` shim path are Go 1.24+.

**Fix:** pin the toolchain in `go.mod` (`toolchain go1.24.0`), and make the shim-copy path-agnostic:

```bash
SHIM="$(go env GOROOT)/lib/wasm/wasm_exec.js"
[ -f "$SHIM" ] || SHIM="$(go env GOROOT)/misc/wasm/wasm_exec.js"
```

---

## Bug 22 — No per-tenant concurrency limit (noisy neighbour)

```go
func Invoke(tenant string, in []byte) ([]byte, error) {
    // any number of concurrent calls per tenant; no limit
    return run(tenant, in)
}
```

**Symptom:** one tenant's burst of heavy invocations inflates p99 latency for *every* tenant; the worker pool and host memory are monopolized.

**Root cause:** no fairness control. Each live instance holds memory and a worker; an unbounded tenant starves the rest.

**Fix:** a per-tenant concurrency semaphore (and ideally per-tenant rate limits + instruction budgets):

```go
sem := tenantSem[tenant]            // semaphore.NewWeighted(maxPerTenant)
if err := sem.Acquire(ctx, 1); err != nil { return nil, err }
defer sem.Release(1)
return run(tenant, in)
```

Size `maxConcurrentInstances × memCapPages` to fit host headroom.

---

## Recap Table

| # | Symptom | Root cause | Fix |
|---|---------|-----------|-----|
| 1 | MIME-type error, streaming fails | `.wasm` not `application/wasm` | set type at server/CDN |
| 2 | Blank page after Go upgrade | stale `wasm_exec.js` | copy shim from building toolchain |
| 3 | Slow multi-MB load | uncompressed binary | pre-compress + negotiate |
| 4 | Intermittent corrupt decode | missing `Vary` | add `Vary: Accept-Encoding` |
| 5 | Body larger / undecodable | double compression | don't re-compress pre-compressed |
| 6 | Users on stale code | unhashed name + long cache | content-hash filenames |
| 7 | Slow everywhere | eager site-wide load | lazy-load per feature |
| 8 | Blank/dead page | no spinner / no `.catch` | loading state + error path |
| 9 | Missing-imports panic | `js/wasm` in wazero | build `GOOS=wasip1` |
| 10 | Per-request latency cliff | recompiling each request | compile once, instantiate per call |
| 11 | Host OOM | no memory cap | `WithMemoryLimitPages` |
| 12 | Request hangs | deadline can't interrupt loop | `WithCloseOnContextDone(true)` |
| 13 | Host crash on bad input | trap treated as fatal | handle guest error as data |
| 14 | Guest reads secrets | whole-FS grant | narrow read-only preopen |
| 15 | Garbage / panic on output | unchecked `Memory().Read` ok | honor `ok`, bound length |
| 16 | Large-input corruption | stale memory view after grow | read after call; copy out |
| 17 | Cross-tenant data / name clash | reused named instance | fresh anon instance per call |
| 18 | Works at origin, not CDN | CDN normalized `Content-Type` | set type on object + forward |
| 19 | Progress bar overshoots | length vs decoded-bytes mismatch | measure encoded stream / use streaming |
| 20 | Guest state weirdness | re-running `_start` | reactor `//go:wasmexport` |
| 21 | Build refuses target | Go version gate | pin toolchain; path-agnostic shim |
| 22 | Noisy-neighbour p99 | no per-tenant limit | per-tenant semaphore + budget |
