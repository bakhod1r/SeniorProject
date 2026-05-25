# Live Reload — Senior

## 1. When live reload actually helps

Live reload pays off when the **edit-to-feedback** cycle is dominated by manual restart effort, not by build time. Map your services:

| Workload | Live reload value |
|----------|-------------------|
| HTTP / gRPC server | High — long-lived, dozens of restarts per session |
| Queue consumer / daemon | High — same reason, plus setup state is annoying to recreate |
| Template-heavy web app | High, especially with templates loaded from disk |
| CLI tool | Low — you would just re-invoke it; `go run .` is enough |
| Batch job / one-shot script | Low / negative — restarting mid-run is not what you want |
| Library code | None — exercise it through tests, not a watcher |

Default position: live reload is a tool for **servers**. For everything else, prefer `go run`, `go test -count=1 ./...`, or a debugger attached to a long-running process.

---

## 2. Graceful-restart patterns

The new instance cannot bind until the old one releases the port. Three reliable approaches, in order of effort:

1. **`http.Server.Shutdown` + adequate `kill_delay`.** Standard library, no extra deps.
2. **`SO_REUSEPORT`.** Kernel allows multiple processes to bind the same port; new instance starts before old one finishes. Linux/BSD; not on Windows. Useful for zero-downtime restarts in production, overkill for dev.
3. **Supervisor with socket activation** (systemd, `tableflip`). The supervisor owns the listener and hands it to child processes via FD passing. Production-grade, complex.

For local live reload, (1) is correct 99% of the time:

```go
ln, err := net.Listen("tcp", ":8080")
// ... pass ln to srv.Serve(ln); Shutdown releases it cleanly
```

If you genuinely need (2), `golang.org/x/sys/unix` lets you set `SO_REUSEPORT` via a `net.ListenConfig.Control`:

```go
lc := net.ListenConfig{
    Control: func(network, address string, c syscall.RawConn) error {
        var opErr error
        c.Control(func(fd uintptr) {
            opErr = unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_REUSEPORT, 1)
        })
        return opErr
    },
}
ln, _ := lc.Listen(context.Background(), "tcp", ":8080")
```

---

## 3. Debouncing rapid FS events

Editors emit bursts of events on a single save (write + rename + chmod + temp-file cleanup). Without debouncing you rebuild three or four times per save.

- `air` exposes `delay` (milliseconds).
- `reflex` waits for **completion** of the previous command before triggering again.
- `entr` triggers once per "settle" window; pair with `-r` to restart.
- `watchexec` has `--debounce`.

A 100–300ms debounce is the sweet spot. Below 100ms you re-fire on temp-file noise; above 500ms it feels laggy.

---

## 4. Watching the wrong tree → rebuild loops

A rebuild loop is when the build itself changes a file in the watched tree, the watcher sees it, rebuilds, that changes the file, and so on:

- Build output (`./tmp/`, `./bin/`) is **inside** a watched directory and not excluded.
- A code generator runs inside `cmd` and writes into `internal/` while watching `internal/`.
- A test run produces coverage profiles, JSON reports, or pprof dumps into the watched tree.
- A formatter (`gofmt`, `goimports`) on save touches every `.go` file even when content is identical.

Required excludes for any non-trivial repo:

```toml
exclude_dir   = ["tmp", "bin", "dist", "build", "vendor", "node_modules", ".git", ".idea"]
exclude_regex = ["_test\\.go$", "_gen\\.go$", "\\.pb\\.go$"]
```

Place the build output outside any watched directory (`./tmp/` works because `tmp` is excluded by default).

---

## 5. The dev loop in a monorepo

A monorepo with 5 services and shared `internal/` packages cannot use a single `air` instance — you do not want a one-line change in service A to restart all five.

Patterns that scale:

- **One `air` per service, run in tmux panes (or a Procfile via `overmind`/`hivemind`).** Each `.air.<service>.toml` includes `cmd/<service>` and the relevant `internal/...` subtrees.
- **Watch only the package you are working on.** If you spend the day in `cmd/api`, only run that service's `air`.
- **Avoid watching shared `internal/` everywhere.** Decide which services depend on which internal packages and reflect that in `include_dir`. A change to `internal/auth` should restart services that import it, not every service.

A `Procfile.dev`:

```
api:    air -c .air.api.toml
worker: air -c .air.worker.toml
web:    air -c .air.web.toml
```

`overmind start -f Procfile.dev` gives you one terminal with named panes per service.

---

## 6. Tool comparison: `air` vs `reflex` vs `entr` vs `CompileDaemon` vs `watchexec`

| Feature | `air` | `reflex` | `entr` | `CompileDaemon` | `watchexec` |
|---------|-------|----------|--------|------------------|-------------|
| Go-aware build step | Yes (`build.cmd`) | No (run any cmd) | No | Yes | No |
| Config file | `.air.toml` | flags | none | flags | flags or TOML |
| Cross-platform | Yes | Yes | Unix only | Yes | Yes |
| Per-pattern actions | Limited | Yes (regex + cmd pairs) | One stream per invocation | No | Yes (`--filter`) |
| Forwards signals | Yes | Yes | Yes (`-r`) | Yes | Yes |
| Debounce control | `delay` ms | implicit | implicit | basic | `--debounce` |
| Maintenance status | Active | Active | Active | Sparse | Active |

Rule of thumb:
- Default Go web service → `air`.
- Need per-pattern actions (rebuild Go on `*.go`, restart on `*.html`, rerun tests on `*_test.go`) → `reflex`.
- Want a one-liner with zero install on a Unix box → `entr`.
- Polyglot project (Rust + Go + Node) → `watchexec`.
- Legacy project already on `CompileDaemon` → migrate to `air` when convenient.

---

## 7. CI and live reload

**Never run live reload in CI.** Reasons:

- CI runs a fixed workload and exits; the value of a watcher is zero.
- A watcher process holds the job open indefinitely.
- File-event APIs behave differently in containerized CI runners (often disabled or unreliable on overlay filesystems).
- It hides real build failures behind the "build" log line in `air` output.

The CI equivalent of your local `air` flow is `go build && ./bin/app` for smoke tests, or `go test ./...` for verification. If a teammate added `air` to a CI script, reject it in review.

---

## 8. Live reload and tests

You can wire a watcher to **run tests** on save (`reflex -r '\.go$' -- go test ./...`), but think before you do:

- For a small package, tests run in 1–2 seconds — useful.
- For a 10-minute test suite, you do not want it triggering on every keystroke save. Scope to the package you are editing (`go test ./internal/auth/...`) or run on demand.

A common split: `air` rebuilds and runs the server in one pane; `reflex` runs focused tests in another.

---

## 9. Summary

Reach for live reload on servers and daemons; skip it for CLIs, jobs, and libraries. The two reliability foundations are **graceful shutdown** (so ports release in time) and **disciplined watch paths** (so you do not loop on your own build output). In monorepos, run one watcher per service via a Procfile. `air` is the default; `reflex`/`watchexec` cover per-pattern actions; `entr` is the Unix one-liner; `CompileDaemon` is legacy. And live reload belongs to local dev only — never CI, never production.

---

## Further reading
- `tableflip` (graceful restart): https://github.com/cloudflare/tableflip
- `SO_REUSEPORT` on Linux: https://lwn.net/Articles/542629/
- `overmind` / `hivemind`: https://github.com/DarthSim/overmind
- `air` vs alternatives: https://github.com/air-verse/air#alternatives
