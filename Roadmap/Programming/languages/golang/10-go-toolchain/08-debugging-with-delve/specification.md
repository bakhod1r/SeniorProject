# Delve — Specification

> **Focus:** Precise reference for the `dlv` command — synopsis, subcommands, flags, REPL commands, environment, protocols, and guarantees.
>
> **Sources:**
> - `dlv help` and `dlv help <subcommand>`
> - Delve documentation: https://github.com/go-delve/delve/tree/master/Documentation
> - CLI reference: https://github.com/go-delve/delve/blob/master/Documentation/cli/README.md

---

## 1. Synopsis

```
dlv [global flags] <command> [command flags] [package | binary | pid] [-- program-args...]
```

`dlv` is the Go debugger. The `command` selects a launch mode (`debug`, `test`, `exec`, `attach`, `core`, `connect`, `dap`, `trace`, `version`). Everything after `--` is passed to the target program.

---

## 2. Subcommands

| Command | Purpose |
|---------|---------|
| `debug [package]` | Compile the package with debug flags and start debugging |
| `test [package]` | Compile the test binary and start debugging |
| `exec <binary>` | Debug an already-built binary |
| `attach <pid> [binary]` | Attach to a running process |
| `core <binary> <core>` | Open a core file (read-only postmortem) |
| `connect <addr>` | Connect to a headless Delve server (JSON-RPC) |
| `dap` | Start a DAP server (for editor integration) |
| `trace [package] <regex>` | Set non-stopping tracepoints; print call args/returns |
| `version` | Print Delve version |
| `replay <trace-directory>` | Replay an `rr` recording (Linux x86_64) |

Mode-specific flags follow the subcommand; build flags go through `--build-flags`.

---

## 3. Global / shared flags

| Flag | Effect |
|------|--------|
| `--headless` | Run as a server (no terminal UI); pair with `--listen` |
| `--listen=ADDR` | Address to listen on (`127.0.0.1:2345`, `:2345`, `unix:/tmp/dlv.sock`) |
| `--api-version={1,2}` | API protocol version (use `2`) |
| `--accept-multiclient` | Keep the server alive across client disconnects |
| `--continue` | Continue the debugged process immediately on launch |
| `--allow-non-terminal-interactive` | Force interactive REPL even without a TTY |
| `--build-flags='...'` | Build flags passed to the Go toolchain (`-tags`, `-race`, `-ldflags`, `-gcflags`) |
| `--init=FILE` | Run commands from FILE on startup (rc-style) |
| `--log` / `--log-output=...` | Enable internal logging (`debugger`, `gdbwire`, `lldbout`, `rpc`, `dap`) |
| `--backend={default,native,lldb,rr}` | Choose the debug backend |
| `--check-go-version` | Verify the binary's Go version matches Delve's expectations |
| `--only-same-user` | Only allow clients running as the same user (headless) |
| `--disable-aslr` | Disable ASLR on launch (Linux; useful for reproducible addresses) |
| `--wd=DIR` | Set the working directory for the launched program |

---

## 4. The interactive REPL

Inside `(dlv)` the following commands are available (abbreviated names in parentheses):

**Execution control**

| Command | Effect |
|---------|--------|
| `continue` (c) | Run until next breakpoint or program end |
| `next` (n) | Step one source line, stepping over calls |
| `step` (s) | Step one source line, descending into the next call |
| `stepout` (so) | Run until the current function returns |
| `step-instruction` (si) | Step a single machine instruction |
| `restart` (r) | Rebuild (in debug/test mode) and restart |
| `rewind` | Reverse to start of `rr` recording |
| `reverse-step` / `reverse-next` / `reverse-continue` | Reverse equivalents (rr backend) |

**Breakpoints and tracepoints**

| Command | Effect |
|---------|--------|
| `break <loc>` (b) | Set a breakpoint at `file:line`, `func`, or `pkg.func` |
| `break <loc> if <expr>` | Conditional breakpoint |
| `break -r <regex>` | Break on every function matching the regex |
| `breakpoints` (bp) | List breakpoints |
| `clear <id>` | Remove a breakpoint by ID |
| `clearall` | Remove all breakpoints |
| `condition <id> <expr>` | Set/replace a breakpoint's condition |
| `condition -hitcount <id> <op> <n>` | Hit-count condition |
| `trace <loc>` | Non-stopping tracepoint that prints args/return |
| `watch [-r|-w|-rw] <expr>` | Hardware watchpoint on a memory address |

**Inspection**

| Command | Effect |
|---------|--------|
| `print <expr>` (p) | Evaluate a Go expression |
| `print -follow_pointers <expr>` | Follow pointers when printing |
| `display <expr>` | Auto-print on every stop |
| `locals` | Print local variables in current frame |
| `args` | Print function arguments in current frame |
| `vars <regex>` | Print package variables matching regex |
| `whatis <expr>` | Type of expression |
| `funcs <regex>` | List functions matching regex |
| `types <regex>` | List types matching regex |
| `sources <regex>` | List source files matching regex |
| `list [<loc>]` (ls) | Show source around current/specified location |
| `disassemble [-a start end]` (disass) | Disassemble |
| `examinemem <addr>` (x) | Examine raw memory |
| `regs` | Print CPU registers |

**Stack and goroutines**

| Command | Effect |
|---------|--------|
| `stack [n]` (bt) | Print the current stack (up to n frames) |
| `frame <n> [cmd]` | Switch to frame n (optionally run a command in it) |
| `up [n]` / `down [n]` | Move up/down the stack |
| `goroutines [-t]` (grs) | List goroutines (`-t` includes user stacks) |
| `goroutine <n>` (gr) | Switch to goroutine n |
| `threads` / `thread <n>` | OS thread list / switch |

**Session control**

| Command | Effect |
|---------|--------|
| `detach` | Detach from process (leaves it running) |
| `quit` (q) | Exit Delve (will prompt to kill attached processes) |
| `kill` | Kill the inferior process |
| `config <key> <value>` | Adjust REPL config (`max-string-len`, `max-array-values`, `max-variable-recurse`, `show-location-expr`, `aliases`, ...) |
| `help [command]` | Help text |
| `source <file>` | Run commands from a file |

---

## 5. Argument forms

| Form | Meaning |
|------|---------|
| `dlv debug` | The `main` package in the current directory |
| `dlv debug ./cmd/x` | Relative path to a `main` package |
| `dlv debug example.com/cmd/x` | Import path to a `main` package |
| `dlv test ./pkg` | Test binary for that package |
| `dlv exec ./bin/app` | Existing binary file |
| `dlv attach 12345 [./bin/app]` | Running PID; optional binary helps symbol resolution |
| `dlv core ./bin/app /tmp/core` | Core file plus matching binary |
| `dlv connect 127.0.0.1:2345` | Headless Delve server |
| `dlv dap` | Spawn a DAP server (use `--listen`) |
| `-- arg1 arg2` | Anything after `--` is passed to the target program |

---

## 6. Environment variables

| Variable | Role |
|----------|------|
| `DELVE_EDITOR` | Editor invoked by `(dlv) edit` command |
| `XDG_CONFIG_HOME` | Location of `dlv/config.yml` (defaults to `~/.config/dlv/config.yml`) |
| `GODEBUG` | Forwarded to the inferior; affects runtime behavior |
| `GOFLAGS`, `GOMODCACHE`, `GOPATH` | Forwarded to the Go toolchain during `debug`/`test` builds |
| `CGO_ENABLED`, `CC`, `CXX` | Affect debug-mode compilation (turn off cgo for faster links) |
| `GOOS`, `GOARCH` | Cross-compile (then `--backend=gdbserver` or an emulator runner is needed) |
| `DLV_API_VERSION` (some setups) | Default API version for clients |

The persistent REPL config lives at `~/.config/dlv/config.yml` and is loaded on each interactive session.

---

## 7. Protocols

| Protocol | Server | Client(s) | Notes |
|----------|--------|-----------|-------|
| JSON-RPC v2 (Delve native) | `dlv --headless` | `dlv connect`, GoLand (partly), scripts | Newline-delimited JSON over TCP/Unix socket |
| DAP (Debug Adapter Protocol) | `dlv dap` | VS Code, Neovim, generic DAP clients | Microsoft DAP spec; not interchangeable with JSON-RPC |
| gdb remote serial | `--backend=lldb`/`gdbserial` | external use, rr backend | Used for `rr` time-travel |

Protocol type schemas:
- JSON-RPC: `service/api` package in the Delve source.
- DAP: https://microsoft.github.io/debug-adapter-protocol/

---

## 8. Behavioral guarantees

- **Goroutine-aware** stacks, breakpoints, and inspection — backed by walking `runtime.allgs`.
- **Builds with `-N -l` for `debug`/`test`** so locals are inspectable; preserved across `restart`.
- **Source-line breakpoints survive `restart`** when lines still resolve; line shifts may invalidate them with a warning.
- **`detach` is non-destructive**; `quit` will prompt before killing an attached process.
- **`core` mode is read-only** — no execution commands.
- **`--accept-multiclient` keeps the server alive** across client disconnects.
- **Signals to the inferior** are forwarded (configurable via `config` and per-signal handling).

---

## 9. Non-goals / limitations

- Not a profiler (use `pprof`, `runtime/trace`).
- Not a logger (use structured logging; `dlv trace` is the rough printf-without-rebuild equivalent).
- Not a substitute for the race detector for race *detection* (use `-race`); Delve helps you *investigate* a race once found.
- Cross-architecture remote debug requires an emulator/runner and the `gdbserial` backend; not a first-class workflow.
- C frames from cgo are not fully unwound; pair with a C debugger when needed.
- Watchpoints depend on hardware debug registers and on the address staying valid.

---

## 10. Related references
- Delve docs: https://github.com/go-delve/delve/tree/master/Documentation
- JSON-RPC API: https://github.com/go-delve/delve/blob/master/Documentation/api/json-rpc/README.md
- DAP server: https://github.com/go-delve/delve/blob/master/Documentation/api/dap/README.md
- VS Code Go debugging: https://github.com/golang/vscode-go/blob/master/docs/debugging.md
- rr project: https://rr-project.org/
- Microsoft DAP spec: https://microsoft.github.io/debug-adapter-protocol/
