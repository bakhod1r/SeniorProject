# Live Reload — Middle

## 1. The `.air.toml` you will actually edit

`air init` writes a default file. The interesting knobs:

```toml
root = "."
tmp_dir = "tmp"

[build]
  cmd = "go build -o ./tmp/server ./cmd/server"
  bin = "./tmp/server"
  full_bin = "APP_ENV=dev ./tmp/server --port 8080"
  include_ext = ["go", "tpl", "tmpl", "html"]
  exclude_dir = ["assets", "tmp", "vendor", "node_modules", ".git"]
  include_dir = ["internal", "cmd", "pkg"]
  exclude_regex = ["_test\\.go$"]
  delay = 200          # debounce window in ms
  stop_on_error = true
  kill_delay = "500ms" # grace period between SIGINT and SIGKILL

[log]
  time = true

[misc]
  clean_on_exit = true
```

Things to know:
- `cmd` is your **build** step. It is just a shell command, so you can run `templ generate && go build ...` if you have a code-gen step.
- `bin` is what gets executed *unless* `full_bin` is set; `full_bin` lets you forward env vars and CLI flags.
- `include_dir` / `exclude_dir` are evaluated relative to `root`.
- `delay` is the debounce: many editors save with multiple FS events (write + rename + chmod) and you do not want to rebuild three times.

---

## 2. Building only what you ship

For a service in `cmd/api`, narrow the build to that package and the watched paths to its dependencies:

```toml
[build]
  cmd = "go build -o ./tmp/api ./cmd/api"
  bin = "./tmp/api"
  include_dir = ["cmd/api", "internal"]
  exclude_dir = ["docs", "scripts", "deploy", "web/node_modules"]
```

Watching everything under `.` is the most common cause of *thrash* (rebuild loops) and *latency* (slow rebuilds). Less surface area = faster, more predictable reloads.

---

## 3. Templates, `templ`, `htmx`, and SPA front-ends

A common Go web stack looks like: `templ` (or `html/template`) for HTML + `htmx` on the client + a Vite/webpack pipeline for CSS/JS. There are two reload paths to coordinate:

1. **Server reload** — rebuild Go on `.go` changes.
2. **Asset/template reload** — refresh the browser when `.templ`, `.html`, `.css`, or `.js` changes.

Two clean approaches:

```toml
# A) templates are baked into the binary — rebuild on template changes too
include_ext = ["go", "templ", "html", "tmpl", "css", "js"]
cmd = "templ generate && go build -o ./tmp/web ./cmd/web"
```

```toml
# B) templates are read from disk at request time — no rebuild needed
include_ext = ["go"]
# run a separate watcher (entr, browser-sync) for templates/assets
```

Pattern A is simpler but every CSS tweak triggers a Go rebuild. Pattern B is faster but needs a second watcher and templates loaded from disk.

For SPAs, run the front-end dev server (`vite dev`) in its own terminal and let `air` worry only about Go.

---

## 4. Restart latency vs build latency

Total reload time = `debounce + build + process start + readiness`.

| Stage | Typical cost | What you can do |
|-------|-------------|-----------------|
| Debounce | 100–300ms | Tune `delay`; lower = snappier, higher = fewer duplicate builds |
| `go build` | 100ms–several s | Narrow packages, warm `GOCACHE`, `CGO_ENABLED=0`, `-buildvcs=false` |
| Process start | 10–200ms | Lazy-init expensive things; reduce init() work |
| Readiness | depends | Make the HTTP listener bind early; warm caches after `ListenAndServe` |

If a developer's reload feels slow, profile which stage owns the time before tuning blindly.

---

## 5. Forwarding environment variables

`air` runs your binary as a subprocess and inherits your shell environment by default. To set env vars only for the watched process, use `full_bin`:

```toml
full_bin = "APP_ENV=dev LOG_LEVEL=debug DATABASE_URL=postgres://localhost/dev ./tmp/api"
```

Or load from a `.env` file before launching `air`:

```bash
set -a; source .env; set +a
air
```

A subtle point: env vars referenced inside `cmd` are evaluated at **build** time, not at **run** time. Use `full_bin` for run-time env, `cmd` for build-time env (`CGO_ENABLED=0`, `GOFLAGS`).

---

## 6. The port-reuse pitfall (graceful shutdown)

The most common live-reload bug:

```
listen tcp :8080: bind: address already in use
```

`air` sends SIGINT (then SIGKILL after `kill_delay`) to the old process and immediately launches the new one. If the old process did not actually close its listener, the new one cannot bind the port. You must implement graceful shutdown:

```go
srv := &http.Server{Addr: ":8080", Handler: r}

go func() {
    if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
        log.Fatal(err)
    }
}()

ctx, stop := signal.NotifyContext(context.Background(),
    os.Interrupt, syscall.SIGTERM)
defer stop()
<-ctx.Done()

shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
defer cancel()
_ = srv.Shutdown(shutdownCtx)
```

`http.Server.Shutdown` closes the listener and waits for in-flight requests. Pair this with `kill_delay = "2s"` in `.air.toml` so `air` waits long enough for the shutdown to finish before SIGKILLing.

On Linux you can also enable `SO_REUSEADDR`/`SO_REUSEPORT` via a custom `net.ListenConfig` so the new process can bind before the old socket's `TIME_WAIT` clears — useful but not a substitute for graceful shutdown.

---

## 7. Watching only the right things

Defaults watch too broadly. Tighten them:

```toml
exclude_dir   = ["assets", "tmp", "vendor", "node_modules", ".git", "dist", "build", ".idea", ".vscode"]
exclude_regex = ["_test\\.go$", "_gen\\.go$", "\\.pb\\.go$"]
exclude_file  = ["openapi.yaml"]
follow_symlink = false
```

Watching test files causes rebuilds when you only adjusted a `_test.go`. Excluding generated files (`*_gen.go`, `*.pb.go`) prevents loops where generation re-triggers the watcher.

---

## 8. Running `air` from a subdirectory

`air` runs from the directory where you invoke it. Two patterns:

```bash
# A) one .air.toml per service, invoke air from that service's dir
cd cmd/api && air

# B) one .air.toml at the repo root, point cmd at the service
air -c .air.api.toml
```

Pattern B works well in a monorepo when paired with `air -c <file>` per service. Avoid running two `air` instances against the **same** binary path or temp dir — they will fight.

---

## 9. Trade-offs summary

| Concern | `go run` loop | `air`-style live reload |
|---------|---------------|--------------------------|
| Setup | None | Config file |
| Restart on save | Manual | Automatic |
| Build cost | Same `go build` cost | Same + debounce + process restart |
| State preserved | No (you killed it) | No (full restart) |
| Production-safe | No | No, ever |
| Multi-service repo | Painful | Multiple `air` configs |

---

## 10. Summary

Edit your `.air.toml` to narrow what is watched and what is built, route env vars through `full_bin`, and pair it with `http.Server.Shutdown` plus a generous `kill_delay` so port-reuse errors never appear. Coordinate template/asset reloads explicitly: bake them and rebuild, or load from disk and run a separate watcher. The goal is a sub-second edit → reload cycle, and most slowness comes from watching too much or shutting down too slowly.

---

## Further reading
- `air` config reference: https://github.com/air-verse/air/blob/master/air_example.toml
- `http.Server.Shutdown`: https://pkg.go.dev/net/http#Server.Shutdown
- `templ`: https://templ.guide/
