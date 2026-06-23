# Wasm in Production — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "I compiled a `.wasm` and it runs on my laptop — what changes when real users load it?"

By now you can run `GOOS=js GOARCH=wasm go build` and open the result in a browser, or build a `wasip1` module and run it with `wazero`. That is the *development* story. This file is about the *production* story: what changes the moment the module leaves your machine and a real server delivers it to a real user, or a real Go service loads someone else's module as a plugin.

The list of concerns is short but unforgiving:

- The server must serve `.wasm` files with the header `Content-Type: application/wasm`. Get this wrong and the browser refuses to *stream-compile* the module — it falls back to a slower path, or fails outright.
- A Go-compiled `.wasm` is **big** — typically a few megabytes. You must compress it (Gzip or Brotli) and show the user a loading indicator while it downloads.
- The little JavaScript glue file `wasm_exec.js` must match the exact Go version that built the module. A mismatch silently breaks things.
- On the server side, if you embed *other people's* Wasm inside your Go program, you are running untrusted code. It must be sandboxed: memory limits, time limits, no surprise file or network access.

After reading this file you will:
- Know what `Content-Type: application/wasm` is for and what breaks without it
- Serve a Go `.wasm` from a tiny Go HTTP server, compressed, with a loading indicator
- Understand why `wasm_exec.js` must be pinned to your Go version
- Have a first, honest picture of server-side Wasm with [wazero](https://wazero.io)
- Know when Wasm is the right tool — and when it is overkill

You do **not** yet need to understand fuel metering, capability threat models, or edge cold-start economics. Those are the next levels. This file is about the moment you say: "ship it."

---

## Prerequisites

- **Required:** You can already build a Go `.wasm` for the browser. See [01-goos-js-wasm-browser](../01-goos-js-wasm-browser/junior.md).
- **Required:** Basic HTTP knowledge — requests, responses, headers, status codes, and what a `Content-Type` header does.
- **Required:** Comfort writing a small Go HTTP server (`net/http`).
- **Helpful:** A first look at WASI / `wasip1`, the server-side Wasm target. See [02-wasi-and-wasip1](../02-wasi-and-wasip1/junior.md).
- **Helpful:** Familiarity with browser DevTools — the Network tab especially.

If you can build `main.wasm` and you know how to write `http.HandleFunc`, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`.wasm` file** | The compiled WebAssembly binary. For browser Go, produced by `GOOS=js GOARCH=wasm go build`. |
| **`Content-Type: application/wasm`** | The MIME type a server must send for `.wasm` files so the browser knows it is WebAssembly. |
| **Streaming compilation** | The browser compiling the module *while it downloads*, via `WebAssembly.instantiateStreaming`. Requires the correct MIME type. |
| **`wasm_exec.js`** | The JavaScript glue shipped with the Go toolchain that bridges the Go runtime to the browser. Must match the Go version. |
| **Gzip / Brotli** | HTTP compression schemes. Wasm compresses very well — often to 25–35% of original size. |
| **Content hash** | A filename like `app.a1b2c3.wasm` derived from the file's contents, so caches never serve a stale version. |
| **CDN** | Content Delivery Network — edge servers that cache and serve static assets close to users. |
| **wazero** | A pure-Go, zero-dependency WebAssembly runtime that lets a Go *host* program run Wasm *guest* modules. |
| **Host / Guest** | In server-side Wasm: the *host* is your Go program; the *guest* is the Wasm module it loads and runs. |
| **Sandbox** | The boundary that prevents a guest module from touching memory, files, or the network unless explicitly allowed. |
| **WASI / `wasip1`** | A standard system interface for Wasm outside the browser. `wasip1` is the version Go targets with `GOOS=wasip1 GOARCH=wasm`. |

---

## Core Concepts

### The MIME type is not cosmetic

When the browser fetches a `.wasm` file, it decides *how* to compile it based on the `Content-Type` header. The fast path — `WebAssembly.instantiateStreaming(fetch(url), importObject)` — compiles the module as the bytes arrive over the network, overlapping download and compilation. But it only works if the response says `Content-Type: application/wasm`.

If the server sends `application/octet-stream` or `text/plain`, the browser throws:

```
TypeError: Failed to execute 'compileStreaming' on 'WebAssembly':
Incorrect response MIME type. Expected 'application/wasm'.
```

Good code falls back to the non-streaming path (download fully, *then* compile) — but that is slower and wastes the streaming advantage. The fix is one line of server configuration. Always serve `.wasm` as `application/wasm`.

### Go `.wasm` files are large, and compression matters

A trivial "hello world" Go program compiled to browser Wasm is **~2 MB**. A real application can be 5–15 MB. That is because the Go runtime — the garbage collector, the scheduler, reflection — is baked into every binary.

The good news: WebAssembly is highly compressible. A 5 MB `.wasm` typically shrinks to **1.3–1.8 MB with Gzip**, and a bit smaller still with **Brotli**. Compression is the single highest-leverage thing you can do for load time. Serving a multi-megabyte `.wasm` *uncompressed* is the most common production mistake.

(If 2 MB for hello-world horrifies you, that is what TinyGo is for — it produces far smaller browser binaries by dropping parts of the runtime. TinyGo is a separate toolchain with its own tradeoffs; see [03-tinygo-for-wasm-and-embedded](../03-tinygo-for-wasm-and-embedded/junior.md). This file is about standard Go.)

### Show the user something while it loads

A 1.5 MB download on a slow connection takes seconds. During that time, an unstyled blank page is a bad experience. Always render a loading indicator *before* you start fetching the Wasm, and hide it once the module is running.

### `wasm_exec.js` must match your Go version

`wasm_exec.js` is the JavaScript shim that wires up the Go runtime: it implements the functions the Go `.wasm` calls to talk to the browser (console output, timers, the DOM bridge). It ships *inside* your Go installation:

```bash
# Go 1.24+
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" .
# Older Go (1.21–1.23)
cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" .
```

The shim and the `.wasm` are a matched pair. If you upgrade Go and rebuild the `.wasm` but keep an old `wasm_exec.js`, the runtime contract breaks — sometimes loudly, sometimes silently. **Copy a fresh `wasm_exec.js` every time you change Go versions, and pin both together.**

### Two very different "productions"

"Wasm in production" splits into two worlds that share almost nothing operationally:

1. **Browser delivery.** You build a `.wasm`, a web server (or CDN) ships it to browsers, and it runs in the page. The concerns are HTTP: MIME, compression, caching, loading UX.
2. **Server-side embedding.** Your Go service *loads* a `.wasm` module with wazero and runs it as a sandboxed plugin. The concerns are isolation: memory, time, and capability limits on untrusted code.

This file introduces both. Most teams need only one of them. Know which you are doing.

### Server-side Wasm: the host runs the guest

With wazero, a Go program is the *host*. It reads a `.wasm` file (the *guest*), instantiates it inside a sandbox, and calls its exported functions. The guest cannot read your files, open sockets, or see your memory — unless you explicitly grant it those capabilities. That deny-by-default isolation is the whole point: it lets you run code you did not write and do not fully trust, safely, in the same process.

---

## Real-World Analogies

**1. The shipping container.** A `.wasm` module is a sealed shipping container. It does not matter what is inside — the crane (the runtime) handles it the same way. The MIME type is the label on the side that tells the dock crane "this is a container, use the container crane (streaming)" rather than "unknown cargo, unload it by hand."

**2. Vacuum-packing for the journey.** A raw Go `.wasm` is a fluffy 5 MB. Compression vacuum-packs it to under 2 MB for transit, and the browser re-inflates it on arrival. Shipping it uncompressed is like mailing a pillow without packing it down — you pay for all that air.

**3. A guest in a glass room.** Server-side Wasm runs a guest module in a glass-walled room: you can watch it, it can do its work, but the doors are locked. It cannot wander into your kitchen (filesystem) or use your phone (network) unless you hand it a key. That is the sandbox.

**4. The matched key and lock.** `wasm_exec.js` and the `.wasm` are a key and its lock, cut from the same blank (your Go version). A key from a different blank may turn — or may jam in a way you only discover at the worst moment.

---

## Mental Models

### Model 1 — Production Wasm is a delivery problem first

In the browser, 90% of "production readiness" is HTTP hygiene: correct MIME, compression, caching, a loading state. The Go code barely changes between dev and prod; the *serving* is what makes or breaks the experience.

### Model 2 — The byte journey

```
[build] main.wasm (5 MB)
   │  brotli/gzip
   ▼
[ship]  main.wasm.br (1.6 MB) over HTTPS, Content-Type: application/wasm
   │  browser decompresses + streams-compiles
   ▼
[run]   instantiated module executing in the page
```

Every box in that chain is a place to get it right or wrong.

### Model 3 — Host owns the sandbox

Server-side, the host (your Go program) is the landlord. The guest module rents a room with exactly the furniture (memory, time, capabilities) the landlord provides — nothing more. Deny-by-default means the empty room is the *default*, and you add furniture deliberately.

### Model 4 — `wasm_exec.js` + `.wasm` = one artifact

Treat the glue file and the binary as a single deployable unit, versioned together. Never let them drift.

### Model 5 — Most apps do not need Wasm

A plain CRUD web app — forms, tables, server-rendered HTML — has no reason to ship a multi-megabyte Wasm runtime to the browser. Wasm earns its weight when you need *real compute* in the client (image processing, a parser, a simulation) or a *sandbox* on the server (untrusted plugins). If you cannot name the compute or the sandbox, you probably do not need Wasm.

---

## Pros & Cons

### Pros

- **Real CPU-bound work in the browser** — image filters, video frames, parsers, simulations — at near-native speed.
- **Reuse Go code on the client** — share validation, parsing, or domain logic between server and browser.
- **Safe extensibility on the server** — run third-party or user-supplied logic in a sandbox, in-process, without spinning up containers.
- **Portability** — the same `.wasm` runs in any compliant runtime (browser, wazero, edge platform).
- **Fast cold starts at the edge** — a Wasm module starts in microseconds-to-milliseconds, far faster than booting a container.

### Cons

- **Binary size.** Standard Go browser Wasm is multi-megabyte. Compression helps but does not erase it.
- **No threads (browser).** Go's goroutines run cooperatively on one OS thread under `GOOS=js`; no true parallelism in the browser.
- **Constrained I/O.** `wasip1` has no sockets by design; browser Wasm reaches the network only through JS.
- **Debugging is harder.** Stack traces, source maps, and profilers are less mature than for native code.
- **Operational overhead.** You must get MIME, compression, caching, and version pinning right, or users get a broken or slow experience.

The honest summary: Wasm is a power tool. Reach for it when the problem fits, not because it is new.

---

## Use Cases

Reach for production Wasm when:

- **Client-side media processing** — resize, crop, filter images or decode/encode video frames in the browser without a round-trip to the server.
- **In-browser data tools** — CSV/Parquet viewers, query engines, spreadsheet-grade calculation that runs locally.
- **Sharing Go logic with the frontend** — the exact same validation or parsing code in the browser and on the server.
- **Server-side plugin systems** — let customers extend your product with logic you run in a sandbox.
- **Policy engines** — evaluate untrusted rules (OPA-style) safely, in-process.
- **Sandboxed user code execution** — coding platforms, "run this snippet" features, multi-tenant compute.

Do **not** reach for Wasm when:

- The app is ordinary CRUD with server-rendered pages — the runtime weight buys you nothing.
- You only need a little interactivity that plain JavaScript handles in kilobytes.
- You need raw network access on the server (`wasip1` has none) — a normal process is simpler.

---

## Code Examples

### Example 1 — A correct static server for browser Wasm (Go)

The minimal production-shaped server: correct MIME, and (below) compression.

```go
package main

import (
	"log"
	"net/http"
)

func main() {
	fs := http.FileServer(http.Dir("./public"))

	http.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The one line everyone forgets:
		if len(r.URL.Path) > 5 && r.URL.Path[len(r.URL.Path)-5:] == ".wasm" {
			w.Header().Set("Content-Type", "application/wasm")
		}
		fs.ServeHTTP(w, r)
	}))

	log.Println("serving ./public on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
```

Note: Go's own `mime` package maps `.wasm` to `application/wasm` since Go 1.17, so a bare `http.FileServer` often does the right thing on modern Go. But many other servers (older nginx, some CDNs, S3 static hosting) do **not** — so always verify the header in DevTools.

### Example 2 — The HTML that loads it (streaming)

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><title>Go Wasm</title></head>
<body>
  <div id="loading">Loading… (downloading ~1.6 MB)</div>
  <script src="wasm_exec.js"></script>
  <script>
    const go = new Go();
    WebAssembly.instantiateStreaming(fetch("main.wasm"), go.importObject)
      .then((result) => {
        document.getElementById("loading").remove();
        go.run(result.instance);
      })
      .catch((err) => {
        document.getElementById("loading").textContent = "Failed to load: " + err;
      });
  </script>
</body>
</html>
```

`instantiateStreaming` is the streaming, fast path. If the MIME type is wrong, this rejects — which is why the `.catch` matters.

### Example 3 — Compress the `.wasm` at build time

Pre-compress once, serve the small file forever:

```bash
# Build, then compress
GOOS=js GOARCH=wasm go build -o public/main.wasm .
gzip  -9 -k public/main.wasm      # -> public/main.wasm.gz
# brotli, if available:
brotli -q 11 -k public/main.wasm  # -> public/main.wasm.br
```

Then serve the pre-compressed variant when the client supports it (see [middle.md](middle.md) for the full negotiation), or let the server compress on the fly with a compression middleware.

### Example 4 — Pin `wasm_exec.js` in your build script

```bash
#!/usr/bin/env bash
set -euo pipefail

# Copy the shim that MATCHES this Go toolchain:
if [ -f "$(go env GOROOT)/lib/wasm/wasm_exec.js" ]; then
  cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" public/   # Go 1.24+
else
  cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" public/  # older Go
fi

GOOS=js GOARCH=wasm go build -o public/main.wasm .
echo "Built with $(go version)"
```

Run this on every build so the shim and binary never drift.

### Example 5 — A first server-side Wasm host with wazero

The other production world: your Go program runs a guest `.wasm` in a sandbox.

```go
package main

import (
	"context"
	"fmt"
	"os"

	"github.com/tetratelabs/wazero"
)

func main() {
	ctx := context.Background()

	// The runtime is the sandbox. Closing it frees all guest memory.
	r := wazero.NewRuntime(ctx)
	defer r.Close(ctx)

	wasmBytes, err := os.ReadFile("guest.wasm")
	if err != nil {
		panic(err)
	}

	// Compile + instantiate the untrusted guest. By default it can do
	// NOTHING dangerous: no files, no network, no host memory access.
	mod, err := r.Instantiate(ctx, wasmBytes)
	if err != nil {
		panic(err)
	}

	// Call an exported function the guest provides.
	add := mod.ExportedFunction("add")
	results, err := add.Call(ctx, 2, 3)
	if err != nil {
		panic(err)
	}
	fmt.Println("guest add(2,3) =", results[0]) // 5
}
```

Notice what is *not* here: no permission to read your disk, open a socket, or touch your process memory. The guest is sandboxed by default. That deny-by-default posture is what makes server-side Wasm safe enough to run untrusted code.

---

## Coding Patterns

### Pattern: a build script, not a memorized command

Wrap the build, the shim copy, and the compression in one script (Example 4). Nobody should be hand-typing `GOOS=js GOARCH=wasm go build` and *separately* remembering to copy the shim.

### Pattern: always handle the load failure

`instantiateStreaming(...).catch(...)` is not optional. The wrong MIME type, a 404, or a corrupt file should produce a visible error, not a silently dead page.

### Pattern: loading indicator before the fetch

Render the spinner *first*, start the fetch *second*, remove the spinner in `.then`. Never fetch before showing the user that something is happening.

### Pattern: close the wazero runtime

`defer r.Close(ctx)` frees the sandbox's memory. For server-side hosts, the runtime is a resource — treat it like a file handle.

---

## Clean Code

- **Serve `.wasm` as `application/wasm` — verify it, do not assume it.** Open DevTools → Network → click the `.wasm` → check `Content-Type`.
- **Pre-compress in the build, do not compress per request** where you can — it is wasted CPU on every download otherwise.
- **Keep `wasm_exec.js` and `main.wasm` together** in the same deploy, built by the same script.
- **Always show a loading state** and always handle the failure path.
- **In a wazero host, name the capabilities you grant.** If you grant filesystem access, do it explicitly and narrowly — never "just to make it work."

---

## Product Use / Feature

For a product team, Wasm shows up as:

- **A faster, more private feature** — image editing that never uploads the photo, because the processing happens in the browser.
- **An extensibility story** — "bring your own logic" plugins your platform runs safely.
- **A shared-logic win** — one Go validation library, used identically on the server and in the form, so the rules never drift.

It also shows up as **a performance budget line**: a multi-megabyte download that the loading UX, compression, and caching strategy must manage. Treat the `.wasm` payload as a first-class part of your page-weight budget, the same way you treat images and JavaScript bundles.

---

## Error Handling

### "Incorrect response MIME type. Expected 'application/wasm'."

The server is not sending `Content-Type: application/wasm`. Fix the server config. As a stopgap, the client can fall back to non-streaming:

```js
async function loadGo(url, go) {
  try {
    const r = await WebAssembly.instantiateStreaming(fetch(url), go.importObject);
    return r.instance;
  } catch (e) {
    // Fallback: download fully, then compile (slower).
    const bytes = await (await fetch(url)).arrayBuffer();
    const r = await WebAssembly.instantiate(bytes, go.importObject);
    return r.instance;
  }
}
```

The fallback hides the symptom; fix the MIME type to actually solve it.

### A blank page, no errors

Often a `wasm_exec.js` mismatch after a Go upgrade. Re-copy the shim from the *current* `GOROOT` and rebuild.

### 404 on `main.wasm`

The file is not where the page expects it, or the deploy dropped it. Check the path and the build output.

### Guest `Call` returns an error (server-side)

A wazero guest function returning an error usually means a trap inside the guest (out-of-bounds memory, divide by zero, an unmet import). The host gets a Go `error` — log it, do not let it crash the host.

---

## Security Considerations

- **Browser Wasm runs in the browser's sandbox.** It cannot escape the page's security boundary any more than JavaScript can — same origin policy, same permissions. That is reassuring but also limiting (no raw sockets, no filesystem).
- **Server-side guests are untrusted by default — keep them that way.** With wazero, a guest can do nothing dangerous unless you grant it a capability. Grant the *minimum*.
- **Resource limits are security.** An untrusted guest can try to allocate gigabytes or spin forever. You must cap memory and impose a timeout (covered at [middle.md](middle.md) and [professional.md](professional.md)). At this level: know that an *unbounded* guest is a denial-of-service waiting to happen.
- **Serve over HTTPS.** A `.wasm` delivered over plain HTTP can be tampered with in transit. Production Wasm is HTTPS-only, no exceptions.
- **Know where your modules come from.** A `.wasm` you load is code you run. Treat third-party modules with the same supply-chain caution as any dependency.

---

## Performance Tips

- **Compression is the biggest win.** Gzip a 5 MB `.wasm` to ~1.6 MB; Brotli a little smaller. Do this first, always.
- **Stream-compile** by getting the MIME type right — overlaps download and compile.
- **Cache aggressively** with content-hashed filenames so repeat visits are instant (covered in [middle.md](middle.md)).
- **Lazy-load** the `.wasm` only on the routes that need it — do not pay the download on your marketing homepage.
- **For server-side hosts, compile once, instantiate many.** Compiling a module is the expensive step; reuse the compiled module across invocations.

---

## Best Practices

1. **Always serve `.wasm` as `application/wasm`, and verify in DevTools.**
2. **Always compress** the `.wasm` (Gzip at minimum, Brotli if you can).
3. **Always show a loading indicator** and handle the load-failure path.
4. **Pin `wasm_exec.js` to the building Go version** via a build script.
5. **Serve over HTTPS.**
6. **Lazy-load** Wasm only where it is needed.
7. **For wazero hosts, deny by default** — grant capabilities explicitly and minimally.
8. **Don't reach for Wasm unless the problem needs it** — name the compute or the sandbox.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Wrong MIME type breaks streaming

The single most common production bug. Symptom: a MIME-type error in the console, or a slow fallback path. Fix: serve `application/wasm`.

### Pitfall 2 — Shipping the `.wasm` uncompressed

A 5 MB download where 1.6 MB would do. Symptom: slow loads, especially on mobile. Fix: enable compression.

### Pitfall 3 — Stale `wasm_exec.js`

You upgraded Go, rebuilt the `.wasm`, but kept the old shim. Symptom: blank page or runtime errors. Fix: re-copy the shim on every build.

### Pitfall 4 — No loading UX

The page is blank for seconds while the multi-megabyte download runs. Users think it is broken. Fix: render a loading state before fetching.

### Pitfall 5 — Caching the wrong version

You deploy a new `.wasm` but users keep running the old one because a CDN cached `main.wasm` forever. Fix: content-hashed filenames (see [middle.md](middle.md)).

### Pitfall 6 — Assuming POSIX on the server

A `wasip1` guest cannot open a socket — there is no networking in `wasip1`. Code that assumes a normal OS will fail. Know the limits before you port.

### Pitfall 7 — Unbounded server-side guest

A wazero host that sets no memory or time limit will hang or OOM when a guest misbehaves. Even at junior level, never run an untrusted guest without *some* limit.

---

## Common Mistakes

- **Forgetting the MIME type** — the number-one issue.
- **Serving uncompressed Wasm** — the number-two issue.
- **Letting `wasm_exec.js` drift** from the Go version.
- **No loading indicator and no error handling** on the load path.
- **Loading Wasm on every page** instead of only where it is used.
- **Running a server-side guest with no resource limits.**
- **Using Wasm for an app that has no real compute or sandbox need.**

---

## Common Misconceptions

> *"Wasm is faster than JavaScript, so I should use it everywhere."*

For DOM manipulation and light glue, JavaScript is smaller and often faster end-to-end (no multi-megabyte download). Wasm wins for *compute*, not for everything.

> *"The browser figures out the file type automatically."*

For streaming compilation, it relies on the `Content-Type` header. Wrong header, no streaming.

> *"Compression is the CDN's job; I don't need to think about it."*

Many static hosts do **not** compress `.wasm` by default. Verify it, or pre-compress yourself.

> *"`wasm_exec.js` is generic — any copy works."*

It is version-matched to the Go runtime. A mismatch breaks the contract.

> *"Server-side Wasm needs Docker or a separate process."*

No — wazero runs the guest *in-process*, in pure Go, with no external runtime. That is its appeal.

> *"If it runs on my laptop, it is production-ready."*

Your laptop sends the right MIME, has the matching shim, and has a warm connection. Production has a CDN, a cold cache, and a phone on 4G.

---

## Tricky Points

- **Go's `mime` package maps `.wasm` correctly since Go 1.17**, so a bare Go `http.FileServer` often works — but nginx, S3, and older servers do not, so never *assume*.
- **`instantiateStreaming` rejects on wrong MIME**, but `instantiate` (from an `ArrayBuffer`) does not care — which is why the fallback path exists.
- **Compression ratio depends on the binary**, but 25–35% of original is a good rule of thumb for Go Wasm.
- **The browser sandbox and the wazero sandbox are different sandboxes** — one is the browser protecting the user from the page; the other is your Go host protecting itself from the guest.
- **TinyGo produces much smaller browser binaries** but is a different toolchain with library limits — a real option, not the default. See [03-tinygo-for-wasm-and-embedded](../03-tinygo-for-wasm-and-embedded/junior.md).

---

## Test

Try this end to end.

```bash
mkdir wasm-prod && cd wasm-prod
go mod init example.com/wasmprod
cat > main.go <<'EOF'
//go:build js && wasm
package main
import "fmt"
func main() { fmt.Println("hello from wasm") }
EOF
mkdir public
GOOS=js GOARCH=wasm go build -o public/main.wasm .
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" public/ 2>/dev/null || \
  cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" public/
ls -lh public/main.wasm   # note the size
gzip -9 -k public/main.wasm
ls -lh public/main.wasm.gz # note the compressed size
```

Now answer:
1. How big is the uncompressed `.wasm`? How big after Gzip? What ratio? (Answer: typically ~2 MB → ~600 KB, roughly 30%.)
2. What `Content-Type` must the server send for streaming to work? (Answer: `application/wasm`.)
3. What happens if you serve it as `text/plain` and use `instantiateStreaming`? (Answer: a MIME-type error.)
4. Why must `wasm_exec.js` come from the same Go version that built `main.wasm`? (Answer: it is the version-matched runtime shim.)
5. Could you run `main.wasm` on the server with wazero? (Answer: not this one — it is a `js/wasm` binary; you would build `GOOS=wasip1` for wazero.)

---

## Tricky Questions

**Q1.** My `.wasm` loads fine locally but fails on the deployed site. Why?

A. Almost always the MIME type. Your local Go server sends `application/wasm`; the deployed static host (nginx, S3, a CDN) does not. Check DevTools → Network → the `.wasm` response's `Content-Type`.

**Q2.** The page is blank after I upgraded Go. The build succeeded. What changed?

A. You rebuilt `main.wasm` with the new Go, but `wasm_exec.js` is still the old one. Re-copy the shim from `$(go env GOROOT)/lib/wasm/` (or `misc/wasm/` on older Go).

**Q3.** Do I need to compress if my CDN already does Gzip?

A. Verify it actually compresses `.wasm` — many CDNs only compress text MIME types by default and skip `application/wasm`. If it does, great. If not, pre-compress.

**Q4.** Can a `.wasm` running in the browser read the user's files or make arbitrary network calls?

A. No more than JavaScript can. It lives in the browser's sandbox — same-origin policy, file access only via user-initiated pickers, network only through `fetch`/JS. The browser protects the user.

**Q5.** Is server-side Wasm with wazero just running a subprocess?

A. No — the guest runs in-process, inside your Go program, with no external runtime, no container, no separate process. That is exactly why it is interesting for plugins.

**Q6.** Why is hello-world 2 MB?

A. The Go runtime (GC, scheduler, reflection) is compiled into every binary. TinyGo strips most of it for far smaller binaries, at the cost of language/library coverage.

**Q7.** My server-side guest hung the whole process. How do I prevent that?

A. Impose limits — a memory cap and an execution timeout (via a `context` with deadline, plus a memory-limited runtime config). Never run an untrusted guest unbounded. Details at [middle.md](middle.md) and [professional.md](professional.md).

**Q8.** Should every page on my site load the `.wasm`?

A. No. Lazy-load it only on the routes that use it. A marketing homepage should not download a 1.6 MB compute module nobody on that page needs.

---

## Cheat Sheet

```bash
# Build browser wasm + pin the matching shim
GOOS=js GOARCH=wasm go build -o public/main.wasm .
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" public/   # Go 1.24+
# (older Go: $(go env GOROOT)/misc/wasm/wasm_exec.js)

# Pre-compress
gzip   -9 -k public/main.wasm   # -> .gz
brotli -q 11 -k public/main.wasm # -> .br

# Verify the MIME type after deploy
curl -sI https://yoursite/main.wasm | grep -i content-type
# want: content-type: application/wasm
```

```
Browser load (the happy path):
  1. render loading indicator
  2. fetch main.wasm  (Content-Type: application/wasm, compressed)
  3. WebAssembly.instantiateStreaming(...)  ← streams while downloading
  4. remove indicator, go.run(instance)
  5. on error: show the failure, don't die silently
```

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| "Incorrect response MIME type" | server not sending `application/wasm` | fix server config |
| Slow multi-MB load | uncompressed `.wasm` | enable Gzip/Brotli |
| Blank page after Go upgrade | stale `wasm_exec.js` | re-copy the shim |
| Stale version served | cache without content hash | hash the filename |
| Server host hung | unbounded guest | memory cap + timeout |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Explain what `Content-Type: application/wasm` enables and what breaks without it
- [ ] Serve a Go `.wasm` from a small Go HTTP server with the correct MIME type
- [ ] Compress a `.wasm` and state the rough ratio for Go binaries
- [ ] Add a loading indicator and a load-failure handler to the page
- [ ] Explain why `wasm_exec.js` must match the building Go version
- [ ] Describe, in two sentences, the difference between browser delivery and server-side embedding
- [ ] Write a minimal wazero host that runs a guest function
- [ ] State why a server-side guest must have resource limits
- [ ] Decide whether a given feature actually needs Wasm

---

## Summary

"Wasm in production" is two stories. In the **browser**, it is mostly a delivery problem: serve the `.wasm` as `application/wasm` so the browser can stream-compile it, compress the multi-megabyte payload (Gzip to ~30% of original, a bit less with Brotli), show a loading indicator, handle failures, and keep `wasm_exec.js` pinned to the Go version that built the binary. On the **server**, it is an isolation problem: with [wazero](https://wazero.io), your Go host runs a guest `.wasm` in a deny-by-default sandbox, which is exactly what makes it safe to run untrusted plugin code in-process — provided you impose resource limits.

Most apps need neither. Wasm earns its weight when you have real client-side compute or a real server-side sandboxing need. Get the delivery hygiene right, keep the sandbox locked down, and ship deliberately.

---

## What You Can Build

After learning this:

- **A static site that serves a Go `.wasm` correctly** — right MIME, compressed, with a loading state.
- **An in-browser tool** (a small image filter, a CSV viewer) that does real compute client-side.
- **A first sandboxed plugin host** with wazero that runs a guest module's exported function safely.
- **A build script** that pins `wasm_exec.js` and compresses the binary so deploys are reproducible.

You cannot yet:
- Negotiate Brotli/Gzip per request or wire up content-hashed caching (next: [middle.md](middle.md))
- Build a real multi-tenant plugin architecture with fuel and memory limits (next: [middle.md](middle.md), [senior.md](senior.md))
- Reason about edge/serverless cold-start economics (next: [senior.md](senior.md))
- Design the capability threat model for untrusted modules (next: [professional.md](professional.md))

---

## Further Reading

- [wazero documentation](https://wazero.io) — the zero-dependency pure-Go Wasm runtime.
- [Go WebAssembly wiki](https://github.com/golang/go/wiki/WebAssembly) — official browser-Wasm guidance.
- [MDN: WebAssembly.instantiateStreaming](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/instantiateStreaming_static) — streaming compilation.
- [MDN: Loading and running WebAssembly code](https://developer.mozilla.org/en-US/docs/WebAssembly/Loading_and_running) — the MIME-type requirement.
- [WASI / wasip1 overview](https://github.com/golang/go/wiki/WebAssembly#wasi) — the server-side target.

---

## Related Topics

- [16.1 GOOS=js Wasm in the Browser](../01-goos-js-wasm-browser/junior.md) — building the browser `.wasm` you ship here
- [16.2 WASI and wasip1](../02-wasi-and-wasip1/junior.md) — the server-side target wazero runs
- [16.3 TinyGo for Wasm and Embedded](../03-tinygo-for-wasm-and-embedded/junior.md) — smaller browser binaries, different tradeoffs
- [16.4 Wasm Interop and Performance](../04-wasm-interop-and-performance/junior.md) — crossing the JS↔Go boundary efficiently

---

## Diagrams & Visual Aids

```
The two production worlds:

  BROWSER DELIVERY                    SERVER-SIDE EMBEDDING
  ----------------                    ---------------------
  Go build (js/wasm)                  Go build (wasip1/wasm) — the GUEST
        │                                   │
        ▼                                   ▼
  web server / CDN                    your Go service (the HOST + wazero)
   serves .wasm                        loads guest into a SANDBOX
   Content-Type: application/wasm      memory + time + capability limits
   compressed (gzip/brotli)                 │
        │                                   ▼
        ▼                            calls guest's exported functions
  browser stream-compiles                 (untrusted, isolated)
   + runs in the page
```

```
The byte journey (browser):

  main.wasm (5 MB)
       │  brotli -q 11
       ▼
  main.wasm.br (1.6 MB)
       │  HTTPS, Content-Type: application/wasm
       ▼
  browser: decompress + instantiateStreaming
       │
       ▼
  running module  ✓
```

```
The matched pair — never let them drift:

   Go 1.24 toolchain
        │
        ├── builds ──▶ main.wasm   ┐
        │                          ├── deploy together
        └── ships  ──▶ wasm_exec.js┘
```
