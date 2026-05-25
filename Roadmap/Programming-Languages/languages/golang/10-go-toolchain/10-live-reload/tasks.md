# Live Reload — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.21+ and the latest `air` (`go install github.com/air-verse/air@latest`).

---

## Task 1: Install and smoke-test `air`

Install `air`, verify it is on `PATH`, and confirm it can boot a trivial HTTP server.

**Acceptance criteria**
- [ ] `air -v` prints a version.
- [ ] In a directory with a one-file HTTP server (`main.go` listening on `:8080`), `air init && air` runs and serves traffic.
- [ ] Editing the response string, saving, and re-curling `localhost:8080` shows the new text within ~1 second — without you restarting anything.
- [ ] Ctrl+C on `air` stops the server (curl now refuses connection).

---

## Task 2: Trim `.air.toml` to watch only `internal/...` and `cmd/api`

Starting from `air init` defaults, narrow watched paths.

**Acceptance criteria**
- [ ] `include_dir = ["cmd/api", "internal"]` is set; root-level watching is off.
- [ ] A change inside `cmd/cli/main.go` does **not** trigger a rebuild.
- [ ] A change inside `internal/auth/auth.go` **does** trigger a rebuild.
- [ ] You can explain in one sentence why narrowing paths matters (rebuild loops, build speed).

---

## Task 3: Exclude templates from rebuild, reload via SIGHUP

Goal: HTML/templ changes do **not** rebuild Go; instead the running server re-reads templates when it receives `SIGHUP`.

**Acceptance criteria**
- [ ] `include_ext` does not include `html`/`tmpl`/`templ`.
- [ ] Your server installs a `signal.Notify(ch, syscall.SIGHUP)` handler that re-parses templates from disk.
- [ ] A small companion watcher (`reflex` or `entr`) sends `kill -HUP <pid>` on `*.html` change.
- [ ] Editing an HTML file changes the rendered output without `air` printing `building...`.

---

## Task 4: Graceful shutdown so the port is always free

Reproduce `bind: address already in use`, then fix it.

**Acceptance criteria**
- [ ] You first write a server that calls `http.ListenAndServe(...)` directly, with no shutdown handler. Save a change repeatedly to trigger `EADDRINUSE` at least once.
- [ ] Refactor to use `http.Server.Shutdown` driven by `signal.NotifyContext(SIGINT, SIGTERM)`.
- [ ] Set `kill_delay = "2s"` in `.air.toml`.
- [ ] After the fix, save 20 times in a row; you never see `address already in use`.

---

## Task 5: Swap to `reflex` and compare ergonomics

Install `reflex` (`go install github.com/cespare/reflex@latest`). Reproduce the live-reload loop with it.

**Acceptance criteria**
- [ ] A `reflex.conf` (or single command) rebuilds the binary on `*.go` change and starts it.
- [ ] `reflex` correctly restarts the previous binary (no orphan processes after a few iterations).
- [ ] You write 3–5 sentences comparing it to `air`: config style, per-pattern actions, signal handling.

Example one-liner to beat:
```
reflex -r '\.go$' -s -- sh -c 'go build -o ./tmp/app ./cmd/api && ./tmp/app'
```

---

## Task 6: Use `entr` for a one-liner alternative

On Linux/macOS, replicate the loop with `entr` (`brew install entr` or your package manager).

**Acceptance criteria**
- [ ] `find . -name '*.go' -not -path './tmp/*' | entr -r sh -c 'go build -o ./tmp/app ./cmd/api && ./tmp/app'` runs.
- [ ] Saving a `.go` file restarts the app.
- [ ] You note one limitation (e.g., it does not pick up *new* files added later, because the file list is fixed at pipe-time).

---

## Task 7: Make rebuilds faster

Apply at least three speed knobs to your `air` setup and measure.

**Acceptance criteria**
- [ ] `CGO_ENABLED=0` is set in `cmd` (or your shell env).
- [ ] `cmd` uses `go build -buildvcs=false -o ./tmp/app ./cmd/api`.
- [ ] `include_dir` is narrowed to the smallest set that contains your service's source.
- [ ] You measure before/after with `[log] time = true` and record the wall time between "building..." and "running...". Improvement is at least 25%.

---

## Task 8: Multi-service repo with one watcher per service

Set up two services (`cmd/api`, `cmd/worker`) in the same repo with independent live reloads.

**Acceptance criteria**
- [ ] Two configs: `.air.api.toml`, `.air.worker.toml`, each with its own `tmp_dir` and `bin` path.
- [ ] A change in `cmd/api` rebuilds only the API; a change in `cmd/worker` rebuilds only the worker.
- [ ] A change in a shared `internal/` package they both import rebuilds **both** services (because both `include_dir` lists contain `internal`).
- [ ] You launch both via `overmind start -f Procfile.dev` (or two tmux panes).

---

## Task 9: tmux pane workflow

Build a small tmux script that opens three panes: server (`air`), tests (`reflex` rerunning `go test ./...` on save), and a free shell for curl.

**Acceptance criteria**
- [ ] A single command (`./scripts/dev.sh` or `tmuxinator start dev`) creates the layout.
- [ ] Ctrl+C in the server pane only kills the server; the test pane keeps running.
- [ ] On every `.go` save you can see, in one window: the rebuild log, the test results, and the response of a manual curl.
