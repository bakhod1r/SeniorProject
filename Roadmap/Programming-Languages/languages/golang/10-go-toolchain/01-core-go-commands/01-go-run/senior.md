# go run — Senior

## 1. The execution model precisely

`go run` performs four phases:

1. **Resolve** the named package/files in module-aware mode (consults `go.mod`, the module cache, and the build list).
2. **Compile** all required packages, reusing `GOCACHE` entries where inputs are unchanged.
3. **Link** a final executable into a temporary work directory (`$TMPDIR/go-build*` by default, overridable with `GOTMPDIR`).
4. **Exec** that binary, forward stdin/stdout/stderr and signals, then **remove** the work directory on exit.

Only the link output and work directory are temporary. Compiled package archives persist in the build cache, which is why latency is dominated by the link step on warm caches.

---

## 2. Caching interactions

Because package compilation is cached, the cost of `go run` on a warm cache is roughly: cache lookups + final link + process startup. Things that *bust* the cache and force recompilation:

- Source changes (obviously).
- Changing build flags (`-tags`, `-gcflags`, `-ldflags`, `-race`) — each flag combination is a distinct cache key.
- Changing the Go toolchain version.
- Changing relevant environment (`GOOS`, `GOARCH`, `CGO_ENABLED`, `CC` for cgo).

Practical consequence: alternating `go run .` and `go run -race .` keeps **two** sets of cached objects warm; you do not pay full recompilation each time you switch, but you do pay the first time.

```bash
go env GOCACHE       # where compiled objects live
go env GOTMPDIR      # where the temp work dir/binary goes (empty = system temp)
```

---

## 3. Reproducibility and the temp binary

`go run` is not meant for reproducible artifacts — the binary is deleted. If you need to inspect the exact binary (for `go version -m`, for size analysis, or for a debugger), use `go build -o` instead. A subtle point: because the binary path is temporary and changes per run, attaching a debugger or profiler to a `go run` process is fragile. Seniors build a stable binary for those workflows.

`GOFLAGS` still applies: a global `GOFLAGS=-mod=readonly` will be inherited by `go run`, which can surprise people who expect `go run` to silently update `go.mod`.

---

## 4. Signals, stdin, and being a faithful parent

`go run` execs your program as a child process and forwards signals. However, the child is **not** PID 1 of your shell — `go run` sits in between. This matters in containers and process managers:

- In a container with `go run` as the entrypoint, signals like `SIGTERM` are forwarded to your program, but you now have an extra process in the tree and a slower startup (compile + link on every container start).
- For production containers, **never** use `go run` as the entrypoint. Build a binary in a multi-stage Dockerfile and run that. `go run` in production means shipping the compiler and recompiling on every start.

```dockerfile
# build stage
RUN CGO_ENABLED=0 go build -o /app ./cmd/server
# final stage runs /app directly — not `go run`
```

---

## 5. Where `go run` surprises people

- **Stale file lists.** `go run main.go` silently omitting sibling files leads to "undefined" errors that vanish with `go run .`.
- **Flag ordering.** Build flags after the path are passed to the program; the race detector silently does nothing if misplaced.
- **`@version` requires module mode.** `go run tool@latest` ignores your local `go.mod` requirements for that tool and resolves independently; it can pick a different version than your project pins.
- **CGO and slow links.** With `CGO_ENABLED=1`, linking invokes the system linker and is noticeably slower per run — painful in a tight `go run` loop. Set `CGO_ENABLED=0` when you do not need cgo.
- **Working directory.** Your program's `os.Getwd()` is the directory you invoked `go run` from, not where the source lives. Relative paths in code resolve against the caller's CWD.

---

## 6. CI usage (and when not to)

`go run` is appropriate in CI for **one-off tooling** invoked via `@version`:

```bash
go run honnef.co/go/tools/cmd/staticcheck@v0.5.1 ./...
go run golang.org/x/vuln/cmd/govulncheck@latest ./...
```

This pins the tool version reproducibly without polluting `go.mod` (versus adding tools as dependencies). For the **application under test**, CI should `go build` (or `go test`), not `go run` it repeatedly — building once and reusing the binary avoids paying the link cost per step.

---

## 7. Debugging what `go run` does

```bash
go run -x .            # print every exec'd command (compile, link, run, cleanup)
go run -work .         # keep the work directory and print its path (do not delete)
```

`-work` is the senior trick: it prints `WORK=/tmp/go-build...` and **leaves it behind**, so you can inspect the exact linked binary, its size, and its temporary layout. Pair with `go build -o` when you need that binary to persist.

---

## 8. Cross-compiling with `go run`?

You can *build* for another platform, but you cannot *run* a foreign binary on your host without an emulator:

```bash
GOOS=linux GOARCH=arm64 go run .   # builds linux/arm64, then tries to exec it locally → fails on macOS/amd64
```

`go run` always tries to execute the result on the current machine. Cross-platform work belongs to `go build`. (An exception: with an `exec` wrapper via `-exec`, e.g., running under `qemu` or `wasmtime`, `go run` can hand the binary to a runner — used for WASM and remote testing.)

```bash
GOOS=wasip1 GOARCH=wasm go run -exec="$(go env GOROOT)/lib/wasm/go_js_wasm_exec" .
```

---

## 9. Summary

`go run` is a thin compile-link-exec-delete wrapper that shares the build cache with `go build` and faithfully forwards signals, stdin/stdout, and exit codes. It is ideal for the inner loop and for version-pinned one-off tools (`tool@version`), but the temporary binary makes it unsuitable for debugging, profiling, deployment, container entrypoints, and reproducible artifacts. Use `-x`/`-work` to see and keep what it produces, and reach for `go build -o` when you need a stable executable.

---

## Further reading
- `go help run`, `go help build`
- Build cache design: https://pkg.go.dev/cmd/go#hdr-Build_and_test_caching
- Environment variables: `go help environment`
