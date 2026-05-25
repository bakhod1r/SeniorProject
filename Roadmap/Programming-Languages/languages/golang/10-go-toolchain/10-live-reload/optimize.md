# Live Reload — Optimization

A reload cycle is `debounce + build + shutdown + start + ready`. These exercises shave time off each stage. Numbers are illustrative; measure with `[log] time = true` in `.air.toml` or `time` on the shell.

---

## Exercise 1: Narrow watched paths

**Before** — `air` watches everything under the repo root:

```toml
root = "."
include_dir = []   # implicit: everything except excludes
```

Every save in `web/`, `docs/`, `scripts/` triggers a rebuild check, and `fsnotify` is holding watches on thousands of directories.

**After:**

```toml
include_dir = ["cmd/api", "internal"]
exclude_dir = ["tmp", "vendor", "node_modules", ".git", "web", "docs", "scripts", "deploy"]
```

| Metric | All paths | Narrowed |
|--------|-----------|----------|
| Watch descriptors held | ~12,000 | ~200 |
| False rebuilds per hour | ~30 | 0 |
| `air` startup time | ~3s | ~0.2s |

---

## Exercise 2: Exclude generated and vendored files

**Before** — `air` watches `*.go` everywhere; `go generate` or `protoc` runs touch `*.pb.go`/`*_gen.go` and re-trigger a rebuild, sometimes in a loop.

**After:**

```toml
exclude_regex = ["_test\\.go$", "_gen\\.go$", "\\.pb\\.go$", "_mock\\.go$"]
exclude_dir   = ["vendor"]
```

| Metric | Default | With exclusions |
|--------|---------|-----------------|
| Rebuilds after `go generate ./...` | 1 + N (loop risk) | 1 |
| Rebuild after editing a `_test.go` | Yes | No |

Test files do not change the binary; rebuilding for them only loses your in-memory dev state.

---

## Exercise 3: `-buildvcs=false` to skip VCS stamping

**Before** — `go build` calls `git status` to embed VCS info into the binary. In large repos with many submodules or detached worktrees this adds 100–400ms per build.

**After:**

```toml
[build]
  cmd = "go build -buildvcs=false -o ./tmp/api ./cmd/api"
```

| Metric | Default | `-buildvcs=false` |
|--------|---------|-------------------|
| Build wall time (warm cache, large repo) | 850ms | 520ms |
| VCS info in dev binary | Present | Absent |

You never need VCS stamping for dev binaries. Keep it on for release builds only.

---

## Exercise 4: Disable cgo when you don't need it

**Before** — `CGO_ENABLED=1` (the default with a C toolchain installed) invokes the external system linker on every reload.

**After:**

```toml
[build]
  cmd = "CGO_ENABLED=0 go build -buildvcs=false -o ./tmp/api ./cmd/api"
```

| Metric | cgo on | cgo off |
|--------|--------|---------|
| Link time per reload | 1.1s | 0.25s |
| Reload feels | Sluggish | Snappy |

Pure-Go programs gain nothing from cgo. If you do need cgo (`sqlite3`, `librdkafka`, etc.), accept the cost or split the cgo-using package into a separate process you reload less often.

---

## Exercise 5: Share `GOCACHE` across all watchers and tools

**Before** — every developer has the default `GOCACHE` but CI uses its own ephemeral cache; the first reload after `git pull` recompiles many packages.

**After** — keep `GOCACHE` warm:

```bash
# locally, default $HOME/Library/Caches/go-build (macOS) or $HOME/.cache/go-build (Linux) is fine
# but make sure it is not on a slow volume
go env GOCACHE
# in CI: cache it between jobs
```

Within a single dev session, `air` already benefits because successive builds reuse cache entries. The optimization is: do not blow it away.

| Metric | Cold cache | Warm cache |
|--------|-----------|-----------|
| First reload after `go clean -cache` | 6s | 0.5s |
| Subsequent reloads | 0.5s | 0.5s |

Never `go clean -cache` casually — it converts a fast loop into a cold-cache loop for the rest of the session.

---

## Exercise 6: Tune the debounce window

**Before** — `delay = 0` (no debounce). A single save fires 2–4 rebuilds because editors emit write + rename + chmod events in rapid succession.

**After:**

```toml
[build]
  delay = 200   # ms
```

| Metric | `delay = 0` | `delay = 200` |
|--------|-------------|---------------|
| Rebuilds per save | 2–4 | 1 |
| Perceived lag | None | ~200ms |

200ms is the sweet spot for most editors. If you can feel the lag (you can, slightly), 150ms. If you save with formatters that take a while to settle, 300ms. Below 100ms you start firing on temp-file noise.

---

## Exercise 7: One watcher per service in a multi-service repo

**Before** — a single `air` rebuilds *every* service on any change because `cmd = "go build ./cmd/..."` builds them all.

**After:**

```toml
# .air.api.toml
[build]
  cmd = "go build -o ./tmp/api ./cmd/api"
  bin = "./tmp/api"
  include_dir = ["cmd/api", "internal/auth", "internal/storage"]
```

```toml
# .air.worker.toml
[build]
  cmd = "go build -o ./tmp/worker ./cmd/worker"
  bin = "./tmp/worker"
  include_dir = ["cmd/worker", "internal/queue", "internal/storage"]
```

Run with `overmind start -f Procfile.dev`. Now editing `cmd/api/handler.go` rebuilds only the API; editing `internal/storage` rebuilds both (because both lists include it), which is correct.

| Metric | Single watcher | One per service |
|--------|----------------|-----------------|
| Build time for an API-only change | 4.2s (all services) | 0.6s (api only) |
| Restart blast radius | All services | One service |

---

## Exercise 8: Prefer template hot-reload over rebuild for HTML changes

**Before** — templates are `embed.FS`-baked into the binary. Every CSS/HTML save triggers a Go rebuild (`include_ext = ["go", "html"]`).

**After** — load templates from disk in dev mode:

```go
var tmpl *template.Template

func loadTemplates() {
    tmpl = template.Must(template.ParseGlob("templates/*.html"))
}

func main() {
    loadTemplates()
    sighup := make(chan os.Signal, 1)
    signal.Notify(sighup, syscall.SIGHUP)
    go func() {
        for range sighup { loadTemplates() }
    }()
    // ...
}
```

```bash
# pair with a tiny watcher that just sends SIGHUP
ls templates/*.html | entr -p kill -HUP $(pgrep -x api)
```

```toml
include_ext = ["go"]   # html no longer triggers a rebuild
```

| Metric | Rebuild on HTML | SIGHUP reload |
|--------|-----------------|---------------|
| Time from save to visible change | 700ms (build + restart) | 30ms (template reparse) |
| In-memory state preserved | No | Yes |

---

## Measurement checklist
- [ ] `[log] time = true` so reload timestamps are visible.
- [ ] `include_dir` is the smallest set that contains the service.
- [ ] `exclude_dir` covers `tmp`, `vendor`, `node_modules`, `.git`, and build output.
- [ ] `exclude_regex` covers `_test.go`, `_gen.go`, `*.pb.go`.
- [ ] `cmd` uses `CGO_ENABLED=0 go build -buildvcs=false ...` unless cgo is required.
- [ ] `delay` is between 150ms and 300ms.
- [ ] One `air` config per service in a monorepo.
- [ ] Templates that change frequently are disk-loaded with a SIGHUP-driven reload, not rebuilt.
