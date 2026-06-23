# Live Reload — Find the Bug

Each scenario shows a setup that looks fine but misbehaves. Find the defect, explain it, and fix it.

---

## Bug 1 — Port stays bound after reload

```
[air] running...
[air] building...
[api] listen tcp :8080: bind: address already in use
```

```go
func main() {
    http.HandleFunc("/", handler)
    http.ListenAndServe(":8080", nil)   // no shutdown handler
}
```

**Bug:** the old process never closed its listener. `air` sent SIGINT, the program ignored it (default behavior is exit, but the listener is closed only by `Shutdown`), and the new instance cannot bind.
**Fix:** use `http.Server.Shutdown` driven by `signal.NotifyContext(SIGINT, SIGTERM)` and raise `kill_delay = "2s"` so `air` waits for the drain.

```go
srv := &http.Server{Addr: ":8080"}
ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer stop()
go srv.ListenAndServe()
<-ctx.Done()
sCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
defer cancel()
srv.Shutdown(sCtx)
```

---

## Bug 2 — `air` rebuilds in a loop, never stops

```
[air] building...
[air] running...
[air] building...
[air] running...
...
```

```toml
[build]
  cmd = "go build -o ./api ./cmd/api"   # output is at repo root
  bin = "./api"
```

**Bug:** the binary is written to the watched root directory. Every build re-creates `./api`, the watcher sees a write, debounces, and rebuilds again — forever.
**Fix:** write to an excluded directory:

```toml
[build]
  cmd = "go build -o ./tmp/api ./cmd/api"
  bin = "./tmp/api"
  exclude_dir = ["tmp", "vendor", "node_modules", ".git"]
```

---

## Bug 3 — `node_modules` thrash

```
$ air
[air] watching .
# CPU pegged at 100%, fans spin, occasional ENOSPC: too many open files
```

**Bug:** `node_modules/` was not excluded. `fsnotify` tried to watch every nested directory; on Linux you exhaust `fs.inotify.max_user_watches`, on macOS you exhaust `ulimit -n`.
**Fix:** exclude it and bump the inotify cap as backstop:

```toml
exclude_dir = ["node_modules", "vendor", ".git", "tmp", "dist"]
```

```bash
sudo sysctl -w fs.inotify.max_user_watches=524288
```

---

## Bug 4 — Edits show old templates after rebuild

```go
//go:embed templates/*.html
var tmplFS embed.FS
var tmpl = template.Must(template.ParseFS(tmplFS, "templates/*.html"))
```

You edit `templates/home.html`, `air` rebuilds, the browser still shows the old HTML.

**Bug:** templates are `embed.FS`-baked into the binary at **build** time. `include_ext` did not list `html`, so `air` rebuilt only on `.go` changes; the `.html` edit alone did not trigger a rebuild, and even if it did the embed snapshot is taken at compile time, not run time.
**Fix:** either include `html` in `include_ext` (so a save *does* trigger a rebuild that re-embeds), or switch to disk-loaded templates in dev:

```toml
include_ext = ["go", "html", "tmpl"]
```

```go
if dev {
    tmpl = template.Must(template.ParseGlob("templates/*.html"))
}
```

---

## Bug 5 — A save sometimes does nothing (Linux)

You save `foo.go` in Vim with `:w`. Most of the time `air` rebuilds. Occasionally it does not.

**Bug:** Vim's default save uses `writebackup` — write to `foo.go~`, then `rename("foo.go~", "foo.go")`. The original inode is destroyed. The `inotify` watch was on the *original* inode; subsequent edits hit a different inode and emit no events. `fsnotify` re-watches on `RENAME`, but there is a race.
**Fix:** in Vim, `:set nowritebackup nobackup` (or `:set backupcopy=yes` which writes in place). Or fall back to a polling watcher (e.g., `watchexec --poll 500ms`).

---

## Bug 6 — `air` running in CI

```yaml
# .github/workflows/integration.yml
- run: air
```

The job never finishes; the runner times out at 60 minutes.

**Bug:** `air` is a daemon. It does not exit. CI invoked it as a step and waited forever.
**Fix:** never use a watcher in CI. Use `go build && ./bin/app &` for smoke tests, or — better — `go test ./...` with an in-process server. Watchers are local-dev only.

---

## Bug 7 — `CompileDaemon` legacy gotcha

```bash
CompileDaemon -build="go build -o app" -command="./app"
# segfaults after a few reloads, or two copies of ./app running
```

**Bug:** `CompileDaemon` (https://github.com/githubnemo/CompileDaemon) is older and less maintained; it has known issues with signal forwarding to grandchildren and with leaking child processes when `-command` starts a shell. Repeated reloads can leave orphan processes holding the port.
**Fix:** migrate to `air` (or `reflex`). If you must keep `CompileDaemon`, pass `-graceful-kill=true -graceful-timeout=3` and verify with `ps` that only one child is alive after several reloads.

---

## Bug 8 — Env vars not forwarded to the reloaded binary

```toml
[build]
  cmd = "DATABASE_URL=postgres://localhost/dev go build -o ./tmp/api ./cmd/api"
  bin = "./tmp/api"
```

The binary panics at startup: `DATABASE_URL is empty`.

**Bug:** `DATABASE_URL` was set on the **build** command (`cmd`), not on the **run** command. `go build` ignores it; the running binary never sees it.
**Fix:** put run-time env in `full_bin`, or set it in your shell before launching `air`:

```toml
[build]
  cmd = "go build -o ./tmp/api ./cmd/api"
  full_bin = "DATABASE_URL=postgres://localhost/dev ./tmp/api"
```

---

## Bug 9 — Atomic-replace of a watched directory

A bind-mounted dev directory inside Docker Desktop on macOS: the host editor writes a new directory and `mv`s it over the old one (some build pipelines do this). After the swap, `air` stops noticing any further changes inside.

**Bug:** the OS watch was tied to the original directory's inode. After `rename()`, that inode is gone; the new directory has its own inode that nobody is watching.
**Fix:** restart `air` after a directory swap; better, switch to polling on Docker Desktop bind mounts (`watchexec --poll 1s` or a polling-capable watcher). Avoid atomic directory replacement in your build pipeline if at all possible.

---

## Bug 10 — Tests in a `_test.go` file trigger app rebuild

You save `internal/auth/auth_test.go`. `air` rebuilds the server. Nothing about the server changed.

**Bug:** default `include_ext = ["go"]` matches `_test.go`. The build itself excludes tests, so the binary is byte-identical, but `air` still rebuilds and restarts — losing your in-memory dev state for nothing.
**Fix:** exclude test files via `exclude_regex`:

```toml
exclude_regex = ["_test\\.go$"]
```

Run tests with a separate watcher (`reflex -r '_test\.go$' -- go test ./...`) instead.

---

## How to approach these
1. Port stuck? → graceful shutdown + adequate `kill_delay`.
2. Infinite rebuilds? → check that build output is outside watched dirs.
3. CPU pegged on startup? → exclude `node_modules`/`vendor`/`.git`; check inotify caps.
4. Stale templates? → are they embedded (rebuild needed) or disk-loaded (reload at runtime)?
5. Save sometimes does nothing on Linux? → editor atomic-write replacing the inode.
6. Watcher in CI? → never; replace with `go build` + run, or `go test`.
7. Legacy tool flakiness? → migrate to `air` rather than fight `CompileDaemon`.
8. Env vars empty? → set them in `full_bin` (run-time), not `cmd` (build-time).
9. Tests rebuilding the app? → exclude `_test.go` from the watcher.
