# Live Reload — Interview Q&A

A mix of conceptual and practical questions, labeled by level. Answers are concise; expand with examples in a real interview.

---

## Junior

**Q1. What is live reload in a Go context?**
A development tool that watches your source files and, on change, rebuilds your program and restarts the process. Tools like `air`, `reflex`, `entr`, `CompileDaemon`, and `watchexec` provide this. It is not built into the Go toolchain.

**Q2. Is Go's live reload the same as Java hot reload?**
No. Java/JVM tools can swap class definitions inside a running process. Go always does a **full process restart** — the old binary is killed and a new one is launched. In-memory state is lost on every reload.

**Q3. Why doesn't `go run` do live reload by itself?**
`go run` is one-shot: compile, run, exit on completion. It has no file watcher. A live-reload tool wraps `go build` + executing the result and re-invokes that cycle on file changes.

**Q4. Name three live-reload tools for Go.**
`air` (the most popular Go-aware option), `reflex` (generic, regex/command pairs), `entr` (Unix one-liner). Also: `CompileDaemon` (older Go-specific) and `watchexec` (Rust-based, language-agnostic).

---

## Middle

**Q5. What is in `.air.toml`?**
The build command (`build.cmd`), the output binary path (`build.bin`/`full_bin`), watched directories and extensions (`include_dir`, `include_ext`), exclusions (`exclude_dir`, `exclude_regex`), the debounce window (`delay`), and the grace period before SIGKILL (`kill_delay`). Plus logging and misc options.

**Q6. Why does live reload often fail with `address already in use`?**
The old process did not release its TCP listener before the new one tried to bind it. Fix: implement graceful shutdown with `http.Server.Shutdown` on `SIGINT`/`SIGTERM`, and set `kill_delay` in `.air.toml` long enough for that shutdown to finish.

**Q7. How do you stop a live reloader from rebuilding on template changes if templates aren't compiled in?**
Remove the template extension from `include_ext` (or add it to `exclude_regex`). Load templates from disk at request time so a save instantly shows up without restarting the server. Alternatively, send the running process a `SIGHUP` to re-read templates without exiting.

**Q8. How do you forward environment variables to the watched binary in `air`?**
Use `full_bin`: `full_bin = "APP_ENV=dev DATABASE_URL=... ./tmp/server"`. Vars referenced in `cmd` are evaluated at build time; vars in `full_bin` are evaluated at run time.

---

## Senior

**Q9. You see a rebuild loop — `air` rebuilds non-stop. What are the likely causes?**
The build writes output **inside** a watched directory (e.g., `./bin/app` while `./bin` is watched), or a generator (`go generate`, `templ generate`) writes into a watched tree, or a save-time formatter touches every `.go` file. Fix: exclude the output directory (default is `tmp/`), exclude generated files (`_gen.go`, `*.pb.go`), disable format-on-save, or move generation outside the loop.

**Q10. Compare `air`, `reflex`, and `entr`.**
`air` is Go-aware with a TOML config and a built-in build step. `reflex` is generic: you pair regex patterns to commands and it runs them. `entr` is a tiny Unix-only utility that takes a file list on stdin and runs a command on change. Use `air` as a default for Go web services, `reflex` when you want per-pattern actions, `entr` for one-liners.

**Q11. Should live reload run in CI?**
No. CI runs a fixed workload to completion; a watcher holds the job open and adds no value. Also, file events behave poorly on some container filesystems. CI should `go build && ./bin/app` for smoke tests and `go test ./...` for verification.

**Q12. Your debounce is set to 50ms and you sometimes see two rebuilds per save. Why?**
Editors emit a burst of FS events on save (write + rename + chmod + temp cleanup). 50ms is too short to coalesce them. Raise `delay` to 150–300ms. Below 100ms you start firing on noise; above 500ms it feels laggy.

---

## Professional

**Q13. Which OS API does `fsnotify` use on each platform, and what is one limit of each?**
Linux: `inotify` — watches are per-directory, not recursive; system-wide watch caps (`fs.inotify.max_user_watches`) can be exhausted by `node_modules`. macOS/BSD: `kqueue` — opens a file descriptor per watched path; constrained by `ulimit -n`. Windows: `ReadDirectoryChangesW` — coalesces events at the OS level, so you receive fewer notifications than writes.

**Q14. Why might a save sometimes not trigger a rebuild on Linux?**
The editor wrote a temp file and `rename()`d it over the original (atomic replace). The original inode is gone; your `inotify` watch is on a deleted inode. `fsnotify` re-watches on `RENAME`/`REMOVE`, but there is a race window in which a save can be missed. Disable atomic-write in the editor, or fall back to polling.

**Q15. When would you use polling instead of kernel FS events?**
On NFS/SMB/sshfs (kernel events only see local writes), on Docker Desktop bind mounts on macOS/Windows (notoriously unreliable), on very large trees that exceed the watch cap. Polling with a 500ms–2s `stat` interval is slower but reliable. `watchexec --poll` and similar provide this.

**Q16. Walk through the race condition between `air`'s SIGINT and the new binary's `Listen`.**
`air` sends SIGINT, waits `kill_delay`, then SIGKILLs. The new binary execs and calls `net.Listen(":8080")` immediately. If the old binary's graceful shutdown is still draining a slow request when the new one tries to bind, you get `EADDRINUSE`. Mitigations: raise `kill_delay` above worst-case shutdown time; use `SO_REUSEPORT` so both can hold the port briefly; shorten dev-mode shutdown timeout.

---

## Common traps

- Calling live reload "hot reload" — it is a full restart, not class swapping.
- Watching `./bin` or `./tmp` and triggering rebuild loops.
- Forgetting graceful shutdown → `address already in use`.
- Using `air` in a Dockerfile or CI script.
- Not excluding `node_modules`/`.git`/`vendor` and exhausting `inotify` watches.
- Pointing `cmd` at the wrong package (e.g., `./...`) so every change rebuilds the world.
- Setting `delay = 0` and rebuilding 3x per save.
- Putting env vars in `cmd` (build-time) when you wanted them at run-time (`full_bin`).
- Expecting in-memory state (caches, sessions) to survive a reload — it does not.
- Using `@latest` for a tool invoked by `cmd` and getting non-reproducible builds.
