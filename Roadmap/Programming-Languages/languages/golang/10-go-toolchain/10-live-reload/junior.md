# Live Reload — Junior

## 1. What is live reload?

Live reload is a development helper that **watches your source files** and, when something changes, **rebuilds the program and restarts it** automatically. You save a `.go` file in your editor; a second later the process is running the new code. You did not type `go build` or `Ctrl+C` and rerun anything.

In the Go world there is no "hot code swap" (no replacing classes in a running JVM, no swapping a Python module in place). Live reload is always **kill old process → recompile → start new process**. It is fast enough to feel instant for small programs.

---

## 2. Why it matters

You feel it most when running an HTTP or gRPC server:

```bash
# without a watcher
go run ./cmd/server     # edit code, Ctrl+C, run again, edit, Ctrl+C, run again ...
```

Every change costs you two keystrokes and a few seconds of context switching. For a long debugging session that is hundreds of restarts.

```bash
# with a watcher
air                     # edit code, save, the server is already restarted
```

Live reload is most useful for:

- Long-running servers (HTTP, gRPC, queue consumers).
- Apps with templates / static assets you tweak frequently.
- Daemons that take measurable time to set up state before they are usable.

It is **not** useful for:

- CLIs that exit immediately (you would just rerun them).
- Batch jobs.
- Anything in CI or production.

---

## 3. The popular tools (Go ecosystem)

| Tool | What it is | Config |
|------|-----------|--------|
| `air` | Go-specific live reload daemon; rebuilds and restarts | `.air.toml` |
| `reflex` | Generic file watcher that runs any command | CLI flags |
| `entr` | Tiny Unix utility that runs a command when files change | stdin pipe |
| `CompileDaemon` | Older Go-specific watcher; less maintained | CLI flags |
| `watchexec` | Generic cross-platform watcher in Rust | CLI flags or `.toml` |

For most Go projects, `air` is the default starting point: it is Go-aware, has a sensible config, forwards signals, and handles the build step.

---

## 4. Install `air`

```bash
go install github.com/air-verse/air@latest
# binary lands in $GOBIN (often ~/go/bin); make sure that's on PATH
air -v
```

If you have never used `go install` for a binary tool, this is exactly what it is for.

---

## 5. The simplest workflow

In a project with a `main` package at the root:

```bash
cd ./cmd/server
air init           # generates a default .air.toml
air                # starts watching, builds, runs your binary
```

You will see something like:

```
watching .
building...
running...
```

Edit any `.go` file, save, and `air` will print `building...` and `running...` again with the new code already live. Ctrl+C stops `air` (which stops your binary).

If you do not want a config at all, the defaults often work:

```bash
air -c ""
```

---

## 6. Contrast with `go run`

```bash
go run .       # compiles, runs, exits when you Ctrl+C — does NOT watch files
```

`go run` is one-shot. It has no file watcher. You restart it manually for every change. `air` (and friends) wrap `go build` + executing the result and re-run that cycle on every save.

| Action | `go run` | `air` |
|--------|----------|-------|
| Run program once | Yes | Yes |
| Watch files | No | Yes |
| Auto-rebuild on save | No | Yes |
| Auto-restart on rebuild | No | Yes |
| Useful for production | No | No (ever) |

---

## 7. It is *not* Java-style hot reload

Coming from Java/Spring DevTools, JRebel, or Node `nodemon` + ESM HMR, it is tempting to assume live reload "swaps" code into a running process. In Go it does not. The process is **killed and a new one is launched**. The implications:

- Any in-memory state (caches, sessions, open connections) is lost on every reload.
- A 200ms TCP listener cleanup matters: if your old process did not release the port, the new one cannot bind it (`address already in use`).
- Singletons re-initialize. Database pools reconnect.

For servers behind a load balancer this is fine because the dev server is for one developer. For tight inner loops where you really need state continuity, attach a debugger to a long-running process instead.

---

## 8. A tiny end-to-end example

`./cmd/server/main.go`:

```go
package main

import (
    "fmt"
    "net/http"
)

func main() {
    http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "hello v1")
    })
    http.ListenAndServe(":8080", nil)
}
```

```bash
cd cmd/server
air
# in another terminal:
curl localhost:8080         # hello v1
# edit main.go, change "v1" -> "v2", save
curl localhost:8080         # hello v2 — no manual restart
```

---

## 9. Common beginner mistakes

- Running `air` from the wrong directory (it has no main package there).
- Forgetting to add `~/go/bin` to `PATH` after `go install`.
- Expecting live reload to preserve memory (it does not).
- Watching `node_modules/` or `.git/` and wondering why the CPU is at 100%.
- Using `air` in a Dockerfile or CI script — live reload is a local-dev tool only.

---

## 10. Summary

Live reload watches your source, rebuilds, and restarts your program on every save. Pick `air` for the default Go experience, use `air init` to scaffold a config, and remember that this is always a full process restart — not a hot code swap. Reach for it whenever you are iterating on a long-lived server; skip it for CLIs, jobs, and anything in CI or production.

---

## Further reading
- `air` docs: https://github.com/air-verse/air
- `reflex`: https://github.com/cespare/reflex
- `entr`: https://eradman.com/entrproject/
- `watchexec`: https://watchexec.github.io/
