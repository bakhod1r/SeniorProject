# WASI & `GOOS=wasip1` — Optimization

> Honest framing first: a `wasip1` module's runtime cost has three distinct phases that people routinely conflate — **delivery** (getting the multi-MB `.wasm` to where it runs), **compilation** (the runtime turning wasm bytecode into native machine code), and **instantiation + execution** (creating an instance and running your Go code inside the sandbox). Most "wasm is slow" complaints are actually about the first two, and they are fixed at the *host/runtime* layer, not in your Go code. The execution phase is where Go-side optimization lives, and there the dominant tax is the host-call boundary, not raw compute.
>
> Each entry below states the problem, shows a "before" and "after", and gives a realistic gain and a way to measure it. Because `wasip1` is a deny-by-default sandbox, several optimizations are also *security* improvements — scoping capabilities tightly is both faster and safer. The closing sections cover measuring before tuning, and the cases where `wasip1` is simply the wrong tool.

## Table of Contents
1. [Optimization 1 — Strip the binary with `-ldflags="-s -w"`](#optimization-1--strip-the-binary-with--ldflags-s--w)
2. [Optimization 2 — Reach for TinyGo when size is the constraint](#optimization-2--reach-for-tinygo-when-size-is-the-constraint)
3. [Optimization 3 — Precompile / AOT-cache the module to kill cold start](#optimization-3--precompile--aot-cache-the-module-to-kill-cold-start)
4. [Optimization 4 — Reuse the compiled module; pool instances in the host](#optimization-4--reuse-the-compiled-module-pool-instances-in-the-host)
5. [Optimization 5 — Minimize host-call / boundary crossings](#optimization-5--minimize-host-call--boundary-crossings)
6. [Optimization 6 — Buffer WASI I/O instead of chatty syscalls](#optimization-6--buffer-wasi-io-instead-of-chatty-syscalls)
7. [Optimization 7 — Scope preopens and capabilities tightly](#optimization-7--scope-preopens-and-capabilities-tightly)
8. [Optimization 8 — Compile out unsupported syscalls with build tags](#optimization-8--compile-out-unsupported-syscalls-with-build-tags)
9. [Optimization 9 — Cap memory growth with `GOMEMLIMIT`](#optimization-9--cap-memory-growth-with-gomemlimit)
10. [Optimization 10 — Design for one thread; don't pay for fake parallelism](#optimization-10--design-for-one-thread-dont-pay-for-fake-parallelism)
11. [Optimization 11 — Compress the `.wasm` for edge delivery](#optimization-11--compress-the-wasm-for-edge-delivery)
12. [Optimization 12 — Tune the GC for short-lived invocations](#optimization-12--tune-the-gc-for-short-lived-invocations)
13. [Optimization 13 — Benchmark `wasip1` vs native and across runtimes](#optimization-13--benchmark-wasip1-vs-native-and-across-runtimes)
14. [Optimization 14 — Enforce an artifact-size budget in CI](#optimization-14--enforce-an-artifact-size-budget-in-ci)
15. [Benchmarking and Measurement](#benchmarking-and-measurement)
16. [Measure First, Don't Over-Optimize](#measure-first-dont-over-optimize)
17. [Where `wasip1` Is the Wrong Tool](#where-wasip1-is-the-wrong-tool)
18. [Summary](#summary)

---

## Optimization 1 — Strip the binary with `-ldflags="-s -w"`

**Technique:** A default Go `wasip1` build embeds the DWARF debug data and the symbol table directly in the `.wasm`. Strip both with the linker flags `-s` (omit the symbol table) and `-w` (omit DWARF), and trim path metadata with `-trimpath`.

**Why:** A "hello world" `wasip1` module is multiple megabytes because the entire Go runtime is compiled in. Symbols and DWARF add a meaningful chunk on top of that — bytes you ship, store, and (depending on the runtime) parse at load. For edge and serverless deployment where the module is fetched per cold node, every byte is delivery latency.

**Before:**
```bash
GOOS=wasip1 GOARCH=wasm go build -o app.wasm ./cmd/app
```

**After:**
```bash
GOOS=wasip1 GOARCH=wasm go build \
  -trimpath \
  -ldflags="-s -w" \
  -o app.wasm ./cmd/app
```

**How to measure:**
```bash
ls -l app.wasm                         # raw byte size
GOOS=wasip1 GOARCH=wasm go build -o before.wasm ./cmd/app
GOOS=wasip1 GOARCH=wasm go build -ldflags="-s -w" -o after.wasm ./cmd/app
du -h before.wasm after.wasm           # side-by-side
```
Expect roughly a 15–25% reduction on a typical module. Confirm it still runs (`wasmtime after.wasm`) — stripping removes debug info, not behaviour. The trade is that stack traces lose symbol names, so keep an unstripped artifact for debugging.

---

## Optimization 2 — Reach for TinyGo when size is the constraint

**Technique:** When `-ldflags="-s -w"` is not enough, compile with TinyGo instead of the standard toolchain: `tinygo build -target=wasi -o app.wasm ./cmd/app`. TinyGo uses an LLVM backend and a minimal runtime, producing dramatically smaller `wasip1` modules — often tens of kilobytes where standard Go produces megabytes.

**Why:** The standard Go runtime, its garbage collector, and scheduler are the bulk of a `wasip1` binary, and stripping cannot remove them. TinyGo trades standard-library breadth and some language-feature completeness for a tiny footprint, which is decisive for size-sensitive edge platforms, browser-adjacent delivery, or embedding many modules in one host.

**Before:**
```bash
GOOS=wasip1 GOARCH=wasm go build -ldflags="-s -w" -o app.wasm .
# ~1.5–3 MB
```

**After:**
```bash
tinygo build -target=wasi -o app.wasm .
# frequently 20–200 KB for the same simple program
```

**How to measure:** Build both and `du -h` them; the ratio is usually an order of magnitude or more. **But measure correctness too** — TinyGo does not support the full standard library (reflection, some `encoding/*` paths, parts of `net`), and its GC and goroutine model differ. Run your full test suite under TinyGo before adopting it; a smaller binary that doesn't compile your code is not an optimization. This is a genuine fork in the road, not a flag — see the sibling topic [16.3 TinyGo for wasm & Embedded](../03-tinygo-for-wasm-and-embedded/optimize.md) for the full trade-off analysis.

---

## Optimization 3 — Precompile / AOT-cache the module to kill cold start

**Technique:** A WASI runtime must translate wasm bytecode into native machine code before it can execute. By default this *compilation* happens on every fresh process. Pay it once and reuse the result: precompile with the runtime's AOT step, or enable its on-disk compilation cache.

**Why:** For a multi-MB Go module, compilation is the single largest startup cost — far larger than instantiation. On a per-request edge platform or a CLI invoked repeatedly, recompiling the same module every time is pure waste.

**Before (Wasmtime, recompiling each run):**
```bash
wasmtime app.wasm        # compiles app.wasm to native code every invocation
```

**After (Wasmtime, compile once then reuse):**
```bash
wasmtime compile app.wasm -o app.cwasm     # AOT: produces a precompiled artifact
wasmtime run --allow-precompiled app.cwasm # skips the compile phase entirely
```

**After (wazero embedding, on-disk compilation cache):**
```go
cache, _ := wazero.NewCompilationCacheWithDir("/var/cache/wasm")
rtCfg := wazero.NewRuntimeConfig().WithCompilationCache(cache)
rt := wazero.NewRuntimeWithConfig(ctx, rtCfg)
// First process compiles and writes the cache; later processes read it.
```

**How to measure:**
```bash
# Cold (compile included) vs warm (precompiled):
time wasmtime app.wasm
time wasmtime run --allow-precompiled app.cwasm
```
The difference is the compilation cost you eliminated — commonly tens to hundreds of milliseconds for a Go module. Note the `.cwasm`/cache is tied to the runtime version and host architecture; regenerate it when either changes, and never ship a precompiled artifact to a different CPU.

---

## Optimization 4 — Reuse the compiled module; pool instances in the host

**Technique:** When *you* are the host (embedding wazero or Wasmtime's Go/Rust API), separate the three phases explicitly: **compile the module once** at startup, then **instantiate per request** from the already-compiled module, and pool or reset instances rather than recompiling.

**Why:** Compilation is expensive; instantiation is cheap (microseconds to low milliseconds). A host that calls `CompileModule` on every request throws away that asymmetry and turns a fast path into a slow one. Pooling instances avoids even the instantiation and linear-memory-allocation cost on the hot path.

**Before (recompiles on every request — anti-pattern):**
```go
func handle(ctx context.Context, wasmBytes []byte, in []byte) ([]byte, error) {
    rt := wazero.NewRuntime(ctx)            // new runtime per request
    defer rt.Close(ctx)
    mod, _ := rt.Instantiate(ctx, wasmBytes) // compiles AND instantiates every time
    return invoke(ctx, mod, in)
}
```

**After (compile once, instantiate per request):**
```go
// Startup: compile exactly once.
rt := wazero.NewRuntimeWithConfig(ctx,
    wazero.NewRuntimeConfig().WithCompilationCache(cache))
compiled, _ := rt.CompileModule(ctx, wasmBytes)

func handle(ctx context.Context, in []byte) ([]byte, error) {
    mod, _ := rt.InstantiateModule(ctx,
        compiled, wazero.NewModuleConfig().WithStdin(...).WithStdout(...))
    defer mod.Close(ctx)
    return invoke(ctx, mod, in)
}
```

**How to measure:** Benchmark the host handler with `go test -bench`. Compare `ns/op` for the recompile-per-request version against the compile-once version under realistic concurrency. The gap is usually one to two orders of magnitude. Watch instances for leaked linear memory — always `Close` what you instantiate, and consider a `sync.Pool` of warm instances if instantiation still shows up in the profile. The host boundary itself is covered in [16.4 wasm Interop & Performance](../04-wasm-interop-and-performance/optimize.md).

---

## Optimization 5 — Minimize host-call / boundary crossings

**Technique:** Each call across the guest/host boundary (`go:wasmimport`, or a WASI syscall) has fixed overhead: the runtime traps out of wasm, validates pointers, copies or maps linear memory, and returns. Batch work to cross the boundary fewer times — pass one large buffer instead of many small ones, return aggregated results, and avoid per-element host calls inside hot loops.

**Why:** The boundary crossing, not the work itself, dominates when calls are small and frequent. A loop that calls a host function per item pays the trap-and-marshal cost N times; the same work expressed as a single call over a batched buffer pays it once.

**Before (one host call per record):**
```go
//go:wasmimport env emit_record
func emitRecord(ptr unsafe.Pointer, n uint32)

for _, r := range records {        // N boundary crossings
    b := encode(r)
    emitRecord(unsafe.Pointer(&b[0]), uint32(len(b)))
}
```

**After (one host call for the whole batch):**
```go
//go:wasmimport env emit_batch
func emitBatch(ptr unsafe.Pointer, n uint32)

buf := encodeAll(records)          // single contiguous buffer
emitBatch(unsafe.Pointer(&buf[0]), uint32(len(buf)))  // 1 crossing
```

**How to measure:** Benchmark with `testing.B` comparing per-item vs batched, and profile the host side (e.g. wazero's call counters or a Wasmtime trace) to confirm the crossing count dropped. Expect the speedup to scale with batch size. Keep the backing slice alive across the call and use only allowed boundary types — the same memory-ownership rules from `go:wasmimport` apply; see [16.4](../04-wasm-interop-and-performance/optimize.md) for the deep treatment.

---

## Optimization 6 — Buffer WASI I/O instead of chatty syscalls

**Technique:** `os.Stdout.Write`, `os.Stdin.Read`, and file reads each lower to a WASI call (`fd_write`, `fd_read`). Wrap them in `bufio.Writer`/`bufio.Reader` so many small Go writes coalesce into few WASI syscalls.

**Why:** Every `fd_write` crosses the boundary (see Optimization 5). A program that prints byte-by-byte or line-by-line with `fmt.Println` in a tight loop pays that cost per call. Buffering turns thousands of crossings into a handful of flushes.

**Before:**
```go
for _, line := range lines {
    fmt.Println(line)        // one fd_write per line
}
```

**After:**
```go
w := bufio.NewWriter(os.Stdout)
defer w.Flush()             // flush remaining buffer before exit
for _, line := range lines {
    fmt.Fprintln(w, line)   // accumulates; flushes in large chunks
}
```

**How to measure:** Benchmark a program that emits many lines, comparing raw vs buffered, and time the run on a real runtime (`time wasmtime app.wasm`). The win grows with output volume and is often several-fold on I/O-heavy filters. Do not forget the final `Flush` — a forgotten flush silently drops the tail of the output, which looks like a correctness bug, not a performance one.

---

## Optimization 7 — Scope preopens and capabilities tightly

**Technique:** Grant the narrowest possible `--dir`, only the env vars actually consumed, and only the arguments needed. Never `--dir=/`. This is the deny-by-default model used as an optimization, not just a security control.

**Why:** A broad preopen does more than expose secrets — depending on the runtime it enlarges the directory namespace the module can traverse and the path-resolution work the host performs, and it inflates the attack surface that a security review must reason about. A tight grant is faster to set up, faster to resolve against, and trivially auditable. The performance gain is modest; the *security* gain is large, and the two move together.

**Before:**
```bash
wasmtime --dir=/ --env-inherit app.wasm    # entire FS + whole environment
```

**After:**
```bash
wasmtime \
  --dir=./data::/data \                    # exactly one directory, explicit guest path
  --env INPUT=/data/in.json \              # only the vars the program reads
  app.wasm
```

**How to measure:** This is primarily a correctness/security optimization — verify by *removing* a grant and confirming the program fails loudly (proving it needed exactly what you gave it). For the perf angle, on runtimes that walk preopen tables, time startup with a minimal vs maximal preopen set; the difference is usually small but real. The bigger payoff is review time: a one-line capability grant is auditable; `--dir=/` is not.

---

## Optimization 8 — Compile out unsupported syscalls with build tags

**Technique:** Networking calls (`net.Dial`, `net.Listen`), `os/exec`, and other preview-1-unsupported operations either fail at instantiation (`unknown import: ...sock_accept`) or block forever at run time. Fence them behind `//go:build !wasip1` and provide a `wasip1` path that returns a clear error immediately.

**Why:** An unsupported syscall that reaches the `wasip1` build is not just a correctness bug — a hung network read or a silently failing path *is* the worst possible performance outcome (infinite latency). Compiling the code out converts a hang into a fast, explicit failure and prevents a transitive dependency from dragging `net` into the import list.

**Before (a transitive `net` import breaks instantiation or hangs):**
```go
package transport
func Serve(addr string) error { /* net.Listen — unavailable on wasip1 */ }
```

**After:**
```go
//go:build !wasip1
package transport
func Serve(addr string) error { /* real net.Listen */ }
```
```go
//go:build wasip1
package transport
import "errors"
func Serve(addr string) error {
    return errors.New("transport.Serve: unsupported on wasip1 (no networking)")
}
```

**How to measure:** Confirm the module instantiates cleanly with `wasm-tools print app.wasm | grep import` — the import list should contain only `wasi_snapshot_preview1` entries you expect, with no stray `sock_*`. Add a CI step that builds `GOOS=wasip1` and fails on `unknown import`. The "gain" is the elimination of a hang or instantiation failure, which no micro-benchmark captures but every user notices.

---

## Optimization 9 — Cap memory growth with `GOMEMLIMIT`

**Technique:** wasm linear memory grows in pages and, in most runtimes, never shrinks within an instance's lifetime. A burst of allocation permanently inflates the instance's footprint. Set a soft memory ceiling with `GOMEMLIMIT` so the Go GC works harder before requesting more linear memory, and configure the runtime's own `max_memory` as a hard cap.

**Why:** Two distinct costs. First, every page the guest grows is host RAM the runtime must commit — critical when a host pools hundreds of instances. Second, because linear memory does not shrink, a transient spike becomes a permanent baseline. `GOMEMLIMIT` pressures the GC to reclaim before growing, keeping the high-water mark low.

**Before (memory grows unchecked to the runtime's max):**
```bash
wasmtime app.wasm        # guest grows linear memory freely
```

**After (soft GC ceiling + hard runtime cap):**
```bash
wasmtime --env GOMEMLIMIT=64MiB --max-memory 96MiB app.wasm
```
Or set it inside the program before heavy work:
```go
import "runtime/debug"
func init() { debug.SetMemoryLimit(64 << 20) } // 64 MiB soft limit
```

**How to measure:** Track the instance's peak linear-memory pages (wazero exposes memory size via its API; Wasmtime reports it through metrics/limits). Run a workload that spikes allocation with and without `GOMEMLIMIT` and compare the high-water mark. Tune the limit to your real working set — set it too low and you trade memory for excessive GC CPU, which is its own regression.

---

## Optimization 10 — Design for one thread; don't pay for fake parallelism

**Technique:** `wasip1` runs all goroutines cooperatively on a single OS thread; there is no multi-core parallelism. Stop spawning worker pools that exist only to parallelize CPU work — they add scheduling overhead with zero speedup. Keep goroutines for *structuring* I/O-bound concurrency, and do CPU-bound work in a straight line or with an algorithm that is fast single-threaded.

**Why:** A `for`-loop over `runtime.NumCPU()` worker goroutines is an optimization on `linux/amd64` and a pessimization on `wasip1`: the same cores do not exist, so the goroutines time-slice on one thread while paying channel/sync coordination costs. The native "parallelize the hot loop" instinct actively hurts here.

**Before (worker pool that buys nothing on wasip1):**
```go
n := runtime.NumCPU()                  // returns 1 on wasip1; pool is pointless
var wg sync.WaitGroup
jobs := make(chan task)
for i := 0; i < n; i++ {
    wg.Add(1)
    go func() { defer wg.Done(); for t := range jobs { compute(t) } }()
}
```

**After (straight-line, or concurrency only where it structures I/O):**
```go
for _, t := range tasks {
    compute(t)                         // no coordination overhead, same wall-clock
}
```

**How to measure:** Benchmark the worker-pool version against the straight-line version under `wasip1` (via the `go test` exec wrapper). On `wasip1` they tie at best, and the pool usually loses to coordination overhead. Confirm `runtime.NumCPU()` returns 1 and `GOMAXPROCS` is effectively 1. Reserve goroutines for overlapping blocking I/O, where cooperative scheduling genuinely helps.

---

## Optimization 11 — Compress the `.wasm` for edge delivery

**Technique:** When the module is fetched over the network (an edge platform pulling it to a cold node, a CDN serving it), serve it gzip- or brotli-compressed. wasm bytecode is highly compressible.

**Why:** After stripping (Optimization 1) and possibly TinyGo (Optimization 2), the remaining bottleneck for *delivery* is transfer time. wasm's repetitive instruction encoding compresses well — brotli typically beats gzip on `.wasm`. Smaller transfer means faster cold-node provisioning and lower egress cost, with the cost paid once at build/upload time, not per request (the runtime decompresses, or the CDN serves pre-compressed).

**Before:**
```bash
# Upload / serve the raw artifact
cp app.wasm /srv/edge/app.wasm         # full size over the wire
```

**After:**
```bash
gzip  -9 -k app.wasm                    # app.wasm.gz
brotli -q 11 -k app.wasm               # app.wasm.br  (usually smallest)
# Serve with Content-Encoding negotiated by the edge/CDN.
```

**How to measure:**
```bash
ls -l app.wasm app.wasm.gz app.wasm.br  # compare on-the-wire sizes
```
Expect brotli to shave a large fraction off the transfer. Measure the metric that matters — cold-node fetch time or CDN egress bytes — not just the compressed size on disk. Note this optimizes *delivery*, not compile or execution; decompression and compilation still happen on the node, so pair it with Optimization 3.

---

## Optimization 12 — Tune the GC for short-lived invocations

**Technique:** For a module invoked as a short-lived function (read input → transform → write output → exit), the GC may never need to run at all. Raise `GOGC` (or disable the GC for the invocation) so the program finishes before paying collection cost; for long-lived embedded instances, do the opposite and keep `GOGC` modest to bound memory.

**Why:** A `wasip1` filter that processes one input and exits is a textbook short-lived program. Default `GOGC=100` triggers collections that a sub-second process would never have needed — wasted CPU right on the latency path. Conversely, a pooled long-lived instance wants steady collection to keep linear memory from ratcheting up (see Optimization 9). The right setting depends entirely on instance lifetime.

**Before (default GC churns during a one-shot run):**
```bash
wasmtime app.wasm < input.json         # GOGC=100; collects mid-run
```

**After (one-shot: let it allocate and exit):**
```bash
wasmtime --env GOGC=off app.wasm < input.json
# or GOGC=400 to soften, paired with GOMEMLIMIT as a safety net
```

**How to measure:** Time the one-shot run with `GOGC=100`, `GOGC=400`, and `GOGC=off`, watching both wall-clock and peak memory (Optimization 9's high-water-mark check). `GOGC=off` is only safe when you *know* the working set fits the memory cap — always pair it with `GOMEMLIMIT` so a runaway allocation fails cleanly instead of exhausting host RAM. For long-lived instances, this optimization inverts: keep GC on.

---

## Optimization 13 — Benchmark `wasip1` vs native and across runtimes

**Technique:** Before optimizing, establish two baselines: how much slower is your code on `wasip1` than on `linux/amd64`, and how much do runtimes differ for *your* workload. Run the same `go test -bench` suite natively and under the `wasip1` exec wrapper, and run the produced `.wasm` on Wasmtime, wazero, and WasmEdge.

**Why:** The wasm overhead and the runtime ranking are workload-specific. A compute-bound kernel may run within 1.2–2× of native; an I/O- or boundary-heavy program may be far worse. Wasmtime (Cranelift) and wazero (its optimizing compiler) have different code-generation and startup characteristics. Choosing a runtime or accepting the wasm tax without data is guessing.

**Before (no baseline — optimizing blind):**
```bash
# "wasm felt slow so I rewrote the hot loop" — with no number to compare against
```

**After (measured baselines):**
```bash
# Native baseline
go test -bench=. -benchmem ./...

# wasip1 baseline via the exec wrapper
export GOOS=wasip1 GOARCH=wasm
export PATH="$PATH:$(go env GOROOT)/lib/wasm"
GOWASIRUNTIME=wasmtime go test -bench=. ./...
GOWASIRUNTIME=wazero   go test -bench=. ./...

# Same artifact, different runtimes, end-to-end
GOOS=wasip1 GOARCH=wasm go build -o bench.wasm ./cmd/bench
hyperfine 'wasmtime bench.wasm' 'wazero run bench.wasm' 'wasmedge bench.wasm'
```

**How to measure:** The commands above *are* the measurement. Record native-vs-`wasip1` ratio and the per-runtime numbers, then pin the runtime that wins on your workload and re-run after every dependency or toolchain bump. "It runs on my Wasmtime" is not a benchmark.

---

## Optimization 14 — Enforce an artifact-size budget in CI

**Technique:** Binary size silently creeps as dependencies accrete. Add a CI gate that builds the `wasip1` artifact, measures it, and fails the pipeline if it exceeds a budget you set deliberately.

**Why:** Optimizations 1, 2, and 11 reduce size once; a budget *keeps* it reduced. A single careless import (a heavy SDK, a reflection-driven library) can add a megabyte that nobody notices until cold-start latency regresses in production. A budget turns size into a reviewed, intentional decision.

**Before (size regresses unnoticed):**
```yaml
- run: GOOS=wasip1 GOARCH=wasm go build -ldflags="-s -w" -o app.wasm ./cmd/app
  # no one checks how big app.wasm got
```

**After (hard budget in CI):**
```yaml
- name: Build wasip1 artifact
  run: GOOS=wasip1 GOARCH=wasm go build -trimpath -ldflags="-s -w" -o app.wasm ./cmd/app
- name: Enforce size budget
  run: |
    BUDGET=$((3 * 1024 * 1024))                 # 3 MiB
    SIZE=$(wc -c < app.wasm)
    echo "wasm size: ${SIZE} bytes (budget ${BUDGET})"
    test "$SIZE" -le "$BUDGET" || { echo "::error::wasm exceeds size budget"; exit 1; }
```

**How to measure:** The gate is self-measuring. Track the reported size over time to spot the commit that moved it; when the budget legitimately needs raising, that should be a visible, reviewed change — not a silent drift. Pair with `go mod tidy` and an import audit (`go list -deps`) when the number jumps.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. The signals that actually matter for `wasip1`, mapped to the phase they belong to:

```bash
# --- DELIVERY (size on disk / on the wire) ---
ls -l app.wasm
du -h app.wasm app.wasm.br
wasm-tools print app.wasm | grep -c '(func'    # rough code-size proxy

# --- COMPILATION (runtime translating wasm -> native) ---
time wasmtime app.wasm                          # includes compile
time wasmtime run --allow-precompiled app.cwasm # excludes compile
# the difference == compilation cost you can cache away

# --- INSTANTIATION + EXECUTION ---
go test -bench=. -benchmem ./...                # native baseline
GOWASIRUNTIME=wasmtime go test -bench=. ./...   # wasip1, via exec wrapper
hyperfine 'wasmtime app.wasm' 'wazero run app.wasm'  # end-to-end, across runtimes

# --- MEMORY ---
# Watch peak linear-memory pages via the runtime's metrics/embedding API;
# re-run with and without GOMEMLIMIT to see the high-water mark move.

# --- HOST BOUNDARY (when embedding) ---
# Count boundary crossings before/after batching (Optimization 5) using the
# host's call instrumentation; a perf win that doesn't reduce the count is suspect.
```

Attribute every number to a phase. "wasm is slow" is meaningless until you know whether the cost is delivery (fix with size + compression), compilation (fix with AOT/cache), instantiation (fix with module reuse/pooling), the host boundary (fix with batching), or genuine compute (where you accept the wasm tax or reconsider the target).

---

## Measure First, Don't Over-Optimize

Most of these optimizations are cheap and safe (strip flags, buffering, tight preopens, a CI size budget) — apply those by default. The rest are conditional, and applying them blind can make things *worse*:

- **`GOGC=off`** (Optimization 12) is a footgun without `GOMEMLIMIT`: a long-running or large-input invocation will exhaust host memory. It is only correct for short-lived runs with a known working set.
- **TinyGo** (Optimization 2) is a different toolchain, not a flag. It can shrink the binary 10× and *also* fail to compile your code. Never adopt it without running the full test suite under it.
- **Worker pools removed** (Optimization 10) is right on `wasip1` and wrong everywhere else — guard the decision so the native build keeps its parallelism.
- **Precompiled artifacts** (Optimization 3) are tied to a runtime version and CPU architecture; shipping a stale or cross-arch `.cwasm` is a correctness bug, not a speedup.

The discipline: establish the native and `wasip1` baselines (Optimization 13) first, identify which *phase* dominates, optimize only that phase, and re-measure. A change that does not move the metric you set out to improve is not an optimization — revert it to keep the code simple.

---

## Where `wasip1` Is the Wrong Tool

No amount of tuning fixes a target mismatch. `wasip1` is the wrong choice — and you should optimize by *not using it* — when:

- **You need a network server.** No general TCP/UDP on preview 1. A program shaped like a daemon does not belong here; deploy it as a native binary or container. (See [16.5 wasm in Production](../05-wasm-in-production/optimize.md) for how edge platforms route requests *into* short-lived modules instead.)
- **You need multi-core CPU throughput.** Single-threaded execution caps you at one core; a compute-bound batch job will be faster as a native binary. Optimization 10 only stops you wasting effort — it cannot add cores.
- **You must spawn subprocesses.** No `fork`/`exec`. A pipeline that orchestrates other binaries is a native-host job.
- **Latency must beat native and the work is pure compute.** wasm carries a real translation and sandbox tax; if you are racing native for raw throughput with no need for portability or sandboxing, the sandbox is overhead you are paying for nothing.
- **The deployment target is the browser.** That is `GOOS=js GOARCH=wasm`, a different host and ABI entirely — see [16.1 js/wasm in the Browser](../01-goos-js-wasm-browser/optimize.md).

`wasip1` earns its place for function-shaped, sandbox-friendly, portable compute: plugins, edge/serverless functions, untrusted-code execution, and portable filters. Optimize hard *within* that envelope; outside it, the best optimization is a different target.

---

## Summary

A `wasip1` module's cost splits into delivery, compilation, and instantiation+execution, and most of the wins live outside your Go code. Shrink **delivery** with `-ldflags="-s -w"`, TinyGo where appropriate, and compression. Eliminate **compilation** cost by precompiling (Wasmtime `compile` / `--allow-precompiled`) or caching (wazero's compilation cache), and by compiling the module once in an embedding host and instantiating per request. On the **execution** path, the dominant tax is the guest/host boundary, so batch host calls and buffer WASI I/O; remember `wasip1` is single-threaded, so worker pools that parallelize CPU work are pessimizations. Cap memory with `GOMEMLIMIT`, tune `GOGC` to instance lifetime, scope preopens tightly for both speed and security, and compile out unsupported syscalls so a missing capability fails fast instead of hanging.

Above all: measure first. Establish native and `wasip1` baselines, attribute the cost to a phase, optimize only that phase, and enforce the gains with a CI size budget. And recognise the cases — servers, multi-core compute, subprocess orchestration — where the right optimization is to not use `wasip1` at all.
