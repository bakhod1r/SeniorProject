# Live Reload — Specification

> **Focus:** Reference for the Go live-reload tooling ecosystem — feature matrix, config schemas, CLI flags, environment, behavioral guarantees, and non-goals.
>
> **Sources:**
> - `air`: https://github.com/air-verse/air
> - `reflex`: https://github.com/cespare/reflex
> - `entr`: https://eradman.com/entrproject/
> - `CompileDaemon`: https://github.com/githubnemo/CompileDaemon
> - `watchexec`: https://watchexec.github.io/
> - `fsnotify`: https://github.com/fsnotify/fsnotify

---

## 1. Tool feature matrix

| Capability | `air` | `reflex` | `entr` | `CompileDaemon` | `watchexec` |
|-----------|:-----:|:--------:|:------:|:---------------:|:-----------:|
| Go-aware build step | yes | no | no | yes | no |
| Config file | `.air.toml` | inline or `reflex.conf` | none (stdin pipe) | flags only | flags or `.watchexec.toml` |
| Per-pattern command pairs | limited | yes | no | no | yes (`--filter`) |
| Debounce control | `delay` (ms) | implicit | implicit | `-graceful-kill` only | `--debounce` |
| Event coalescing | yes | yes | yes | yes | yes |
| Signal forwarding to child | yes (process group) | yes | yes (`-r`) | yes | yes (`--signal`) |
| Graceful kill before SIGKILL | `kill_delay` | `-s` | `-r` restart | `-graceful-timeout` | `--stop-timeout` |
| Linux | yes | yes | yes | yes | yes |
| macOS | yes | yes | yes | yes | yes |
| Windows | yes | yes | no | yes | yes |
| BSD | yes | yes | yes | yes | yes |
| Polling fallback | no | no | no | no | `--poll <dur>` |
| Maintenance status (2026) | active | active | active | sparse | active |
| Install path | `go install` | `go install` | package manager | `go install` | cargo / package manager |

---

## 2. `.air.toml` schema overview

```toml
root        = "."         # base directory (default: ".")
tmp_dir     = "tmp"       # where air writes its working files
testdata_dir = "testdata" # excluded from watching by default

[build]
  cmd            = "go build -o ./tmp/main ."   # build command (sh -c)
  bin            = "./tmp/main"                  # binary to execute after build
  full_bin       = ""                            # if set, replaces bin (allows env vars/flags)
  args_bin       = []                            # extra args appended to bin
  include_ext    = ["go", "tpl", "tmpl", "html"] # file extensions that trigger rebuild
  include_dir    = []                            # explicit dirs to watch (empty = all under root)
  include_file   = []                            # explicit files to watch (in addition)
  exclude_dir    = ["assets", "tmp", "vendor", "testdata"]
  exclude_file   = []
  exclude_regex  = ["_test\\.go$"]
  exclude_unchanged = false                       # skip rebuild if content hash unchanged
  follow_symlink = false
  log            = "build-errors.log"            # build error log file
  poll           = false                          # use polling instead of fsnotify
  poll_interval  = 500                            # ms, if poll = true
  delay          = 1000                           # debounce, ms
  stop_on_error  = true                           # if build fails, keep old binary running?
  send_interrupt = false                          # send SIGINT first (Unix); else SIGTERM
  kill_delay     = "500ms"                        # grace before SIGKILL
  rerun          = false                          # rerun without rebuild on each iteration
  rerun_delay    = 500                            # ms

[log]
  time = false              # prepend timestamps to log lines
  main_only = false         # log only from main package

[color]
  main    = "magenta"
  watcher = "cyan"
  build   = "yellow"
  runner  = "green"

[misc]
  clean_on_exit = false     # remove tmp_dir on exit

[screen]
  clear_on_rebuild = false
```

Notes:
- `cmd` is `sh -c` on Unix and `cmd /c` on Windows.
- `bin` and `full_bin` are mutually exclusive in practice — `full_bin` wins if set.
- `include_dir` empty means "everything under root not in `exclude_dir`."
- `delay`'s unit changed across versions — current `air` uses milliseconds for `delay`, durations like `"500ms"` for `kill_delay`.

---

## 3. `reflex` CLI flags

```
reflex [flags] -- <command>
```

| Flag | Effect |
|------|--------|
| `-r <regex>` | Match files by regex (path); can be repeated |
| `-R <regex>` | Inverse regex — exclude matches |
| `-g <glob>` | Match files by glob |
| `-G <glob>` | Inverse glob |
| `-s` | Treat the command as a service: kill and restart on change |
| `-d <none\|fancy\|plain>` | Decoration of output lines |
| `-t <duration>` | Time to wait for a graceful exit before SIGKILL (default `500ms`) |
| `-c <file>` | Read multiple `(pattern, command)` pairs from a config file |
| `--` | Separator; everything after is the command and its args |

Config file (`reflex.conf`) example:

```
-r '\.go$' -s -- sh -c 'go build -o tmp/api ./cmd/api && tmp/api'
-r '\.html$' -- sh -c 'kill -HUP $(pgrep -x api)'
-r '_test\.go$' -- go test ./...
```

`reflex` defaults to coalescing rapid events; it waits for the previous command to *exit* before firing again (`-s` makes the previous command get SIGTERM first).

---

## 4. `entr` CLI flags

```
<file-list-cmd> | entr [flags] <command>
```

| Flag | Effect |
|------|--------|
| `-r` | Reload (kill and restart) the persistent child on each change |
| `-s` | Run the command via `$SHELL -c` |
| `-c` | Clear the screen before running |
| `-p` | Postpone the first execution until a file changes |
| `-d` | Track the **directory** of each file; exit if a file is added/removed |
| `-n` | Non-interactive (no TTY required) |
| `-z` | Exit after the command exits |

Key behaviors:
- The file list is **fixed at pipe time**. New files do not become watched. Use `-d` to detect adds/removes and re-invoke the wrapper.
- Unix only (`inotify` on Linux, `kqueue` on BSD/macOS). No Windows build.

Example:

```bash
find . -name '*.go' -not -path './tmp/*' | entr -r sh -c 'go build -o tmp/api ./cmd/api && tmp/api'
```

---

## 5. `watchexec` CLI flags (selected)

```
watchexec [flags] -- <command>
```

| Flag | Effect |
|------|--------|
| `-w <path>` | Watch only this path (can be repeated) |
| `-e <ext>` | Filter by extension |
| `-i <glob>` | Ignore glob |
| `--filter <glob>` | Match glob |
| `--debounce <dur>` | Debounce window (default `100ms`) |
| `-r` / `--restart` | Restart the child on change |
| `-s <signal>` / `--signal <signal>` | Signal to send (default SIGTERM) |
| `--stop-timeout <dur>` | Grace period before SIGKILL |
| `--poll <dur>` | Use polling at the given interval instead of fs events |
| `-N` / `--notify` | Desktop notification on each run |
| `--no-vcs-ignore` | Do not honor `.gitignore` |

`watchexec` honors `.gitignore`/`.ignore` by default, which is often what you want and worth knowing.

---

## 6. `CompileDaemon` CLI flags

```
CompileDaemon [flags]
```

| Flag | Effect |
|------|--------|
| `-build "..."` | Build command (default `go build`) |
| `-command "..."` | Command to run after a successful build |
| `-directory <path>` | Directory to watch (default `.`) |
| `-pattern <regex>` | File-name regex to watch (default `(.+\.go|.+\.c)$`) |
| `-exclude-dir <dir>` | Directory exclusion (repeatable) |
| `-exclude <name>` | File exclusion (repeatable) |
| `-recursive=true` | Recurse into subdirs (default true) |
| `-graceful-kill=true` | Send SIGTERM before SIGKILL |
| `-graceful-timeout <s>` | Seconds to wait before SIGKILL (default 3) |
| `-polling` | Poll the FS instead of using events |
| `-polling-interval <ms>` | Poll interval |
| `-color` | Colorize output |

Less maintained than `air`/`reflex`/`watchexec`; new projects should not adopt it.

---

## 7. Environment variables

| Variable | Affects | Role |
|----------|---------|------|
| `GOCACHE` | build step in every tool | location of compiled object cache; warm = fast reloads |
| `GOFLAGS` | build step | default `go` flags (e.g., `-mod=readonly`) |
| `CGO_ENABLED` | build step | `0` uses internal linker, faster reloads |
| `GOMAXPROCS` | running binary | unchanged by watchers |
| `AIR_WD` | `air` | override working directory |
| `AIR_TMP_DIR` | `air` | override `tmp_dir` |
| `TERM`, `NO_COLOR` | all | terminal color behavior |
| `EDITOR` | irrelevant | watchers do not invoke an editor |
| `WATCHEXEC_*` | `watchexec` | set by `watchexec` for the child (e.g., `WATCHEXEC_COMMON_PATH`) |

`fs.inotify.max_user_watches` (sysctl) and `ulimit -n` (open files) are kernel-side knobs that constrain how many paths any watcher can observe.

---

## 8. Behavioral guarantees

- **Full process restart.** Every reload is kill-old + exec-new. There is no code hot-swap in Go.
- **Build runs before run.** A non-zero build exit code aborts the cycle; whether the previous binary keeps running is controlled by `stop_on_error` (`air`) or analogous flags.
- **Signal forwarding.** Watchers forward `SIGTERM`/`SIGINT` to the watched child and propagate the child's exit code to the watcher's parent (the shell).
- **Process group ownership.** On Unix, watchers create a new process group for the child so the watcher can signal grandchildren too.
- **FS event delivery is best-effort.** Coalescing under load, atomic-replace inode loss, and overflow are possible; tools mitigate with re-watching but do not guarantee zero missed events.
- **Module mode honored.** The build step is a regular `go build`; it obeys `go.mod`, `GOPROXY`, `GOFLAGS`, etc.

---

## 9. Non-goals / limitations

- **Not hot code reload.** Go cannot replace functions in a running process; live reload is always a restart.
- **Not for CI/production.** Watchers are persistent daemons; CI runs to completion. Use `go build && ./bin/app` or `go test` in CI.
- **Not a debugger replacement.** For deep iteration with state continuity, attach Delve to a long-running process instead of restarting on every save.
- **Not a substitute for tests.** Live reload tells you the server compiled and is running; it does not tell you it is correct.
- **Not reliable on every filesystem.** Remote FS (NFS/SMB), some container bind mounts, and very large watch trees may need polling.
- **Not a static analyzer.** A build error is reported but no linting/formatting/checks are run unless you chain them in `cmd`.

---

## 10. Related references
- `fsnotify` (shared library underneath most tools): https://github.com/fsnotify/fsnotify
- `inotify(7)` (Linux): https://man7.org/linux/man-pages/man7/inotify.7.html
- `kqueue(2)` (macOS/BSD): https://www.freebsd.org/cgi/man.cgi?query=kqueue
- `ReadDirectoryChangesW` (Windows): https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw
- `net/http` graceful shutdown: https://pkg.go.dev/net/http#Server.Shutdown
- `os/signal` notify pattern: https://pkg.go.dev/os/signal#NotifyContext
- `air` config example: https://github.com/air-verse/air/blob/master/air_example.toml
