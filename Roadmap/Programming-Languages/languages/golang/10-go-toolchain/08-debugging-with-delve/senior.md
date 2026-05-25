# Debugging with Delve — Senior

## 1. Optimized binaries and why locals vanish

A release-mode Go binary has been through the inliner and the register allocator. Variables you wrote in source may not exist as memory locations at runtime — they live in registers, get folded into other expressions, or never exist at all. In Delve you see:

```text
(dlv) print sum
Command failed: could not find symbol value for sum
(dlv) locals
(unreadable: optimized out)
```

`dlv debug` and `dlv test` already add `-gcflags='all=-N -l'` for you (`-N` disables optimizations, `-l` disables inlining). For `dlv exec` against your own build, do the same:

```bash
go build -gcflags='all=-N -l' -o app ./cmd/server
dlv exec ./app
```

The `all=` prefix is essential — without it, only your top-level package gets the flags, not its dependencies, and call frames inside `net/http` (or wherever the bug is) still look optimized.

Trade-off: these binaries are slower and larger. Never ship them. But for any serious debugging, you want them.

---

## 2. Headless mode

Headless mode separates Delve into a server you can talk to over the network or a Unix socket. It is how editors attach to a remote target, and how you build CI-friendly debug workflows.

```bash
# Start a headless server, do not pause at entry
dlv debug ./cmd/server --headless --listen=:2345 --api-version=2 --accept-multiclient

# In another terminal, connect a CLI client
dlv connect :2345
```

Notable flags:
- `--headless` — no terminal UI; only the JSON-RPC / DAP server.
- `--listen=ADDR` — where to listen (`:2345` for any interface; prefer `127.0.0.1:2345` locally).
- `--api-version=2` — the modern API; v1 is legacy.
- `--accept-multiclient` — keep the server alive across client disconnects (lets you reconnect from VS Code without restarting the program).
- `--continue` — start the program immediately instead of stopping at entry.

For DAP specifically, use `dlv dap --listen=:2345`. Editors using DAP will not speak JSON-RPC, so the two protocols are not interchangeable.

---

## 3. Remote debugging in containers

A typical pattern in development clusters: build a debug binary, run it under headless Delve, expose the port, attach from your editor.

```dockerfile
FROM golang:1.23 AS build
WORKDIR /src
COPY . .
RUN go install github.com/go-delve/delve/cmd/dlv@latest
RUN go build -gcflags='all=-N -l' -o /out/app ./cmd/server

FROM debian:bookworm-slim
COPY --from=build /go/bin/dlv /usr/local/bin/dlv
COPY --from=build /out/app /app
EXPOSE 2345
ENTRYPOINT ["dlv", "--listen=:2345", "--headless=true", "--api-version=2", \
            "--accept-multiclient", "exec", "/app", "--continue"]
```

Then in the editor:

```json
{
  "name": "Attach to remote",
  "type": "go",
  "request": "attach",
  "mode": "remote",
  "remotePath": "/src",
  "port": 2345,
  "host": "127.0.0.1",
  "substitutePath": [{"from": "${workspaceFolder}", "to": "/src"}]
}
```

The `substitutePath` mapping is what lets your local editor map breakpoints to the container's source paths. Forgetting it is the most common reason "my breakpoints are gray."

Containers usually drop `SYS_PTRACE` — Delve needs it. Add `--cap-add=SYS_PTRACE` (Docker) or `securityContext.capabilities.add: ["SYS_PTRACE"]` (Kubernetes) and disable seccomp if it blocks `ptrace`.

---

## 4. Time-travel debugging via rr

On Linux x86_64, Delve can record an execution with `rr` and let you step **backward**. This is transformative for "how did we get into this state" bugs.

```bash
# Record an execution
dlv debug --backend=rr ./cmd/server

# Later in the session:
(dlv) reverse-step
(dlv) reverse-next
(dlv) reverse-continue
(dlv) rewind            # back to start of recording
```

Requirements: `rr` installed, kernel `perf_event_paranoid <= 1`, x86_64 only. The recording overhead is roughly 1.5–3x. It is unbeatable for race conditions you can reproduce once but not on demand — record, then explore.

---

## 5. Debugging in production: when and how

`dlv attach PID` works on a live production process, but:

- It **pauses** the program at every breakpoint. A breakpoint in a hot path stops all goroutines.
- ptrace acquires the process; signal delivery and certain syscalls behave differently while attached.
- A crashed Delve leaves the process in odd states (sometimes still ptraced).

Rules of thumb for production:

1. **Prefer non-invasive tools first** — `pprof`, structured logging, runtime metrics, `gops`, `runtime/trace`, `GODEBUG=gctrace=1`. Use Delve only when those cannot answer the question.
2. **Take a core dump** rather than attaching, then debug offline with `dlv core`.
3. If you must attach: use a canary instance, attach with `--accept-multiclient`, set breakpoints with **conditions** that fire only for the failing case, and `detach` (never `quit`) when done.
4. Long-form: cordon the node / drain traffic, attach, do your work, detach, return to service.

---

## 6. Cores and post-mortem debugging

For Linux/macOS:

```bash
# 1. Make sure cores are written (ulimit + kernel core_pattern)
ulimit -c unlimited

# 2. Reproduce the crash, or generate a core from a live process:
gcore -o core 12345        # uses gdb's gcore wrapper

# 3. Open the core in Delve (need the matching binary)
dlv core ./app core.12345
(dlv) goroutines
(dlv) bt
```

Notes:
- The binary must match the core exactly (same build, same flags).
- Stripped binaries debug poorly even with a core — keep an un-stripped copy or DWARF sidecar for production builds you might need to debug.
- Cores are **read-only**: no `continue`, no `next`. Only inspection.

---

## 7. Delve vs pprof vs logging — choosing the tool

| Question | Best tool |
|----------|-----------|
| "Why is this goroutine stuck right now?" | `dlv attach` or `dlv core` + `goroutines` |
| "Where is my CPU going?" | `pprof` CPU profile |
| "Where is my memory going?" | `pprof` heap profile |
| "What happened in this 5-second slow request?" | `runtime/trace` |
| "What did the program do in production yesterday?" | Logs / traces / metrics |
| "What was in this variable at the moment of the crash?" | `dlv core` |
| "Why does this test fail intermittently?" | `dlv test --backend=rr` (record, then explore) |

Delve is precision: it shows you the exact state of a paused program. pprof is aggregate: it shows where time/memory go across many calls. Logging is history: it shows what happened. Use the right one; reaching for Delve first when pprof would answer the question wastes hours.

---

## 8. Race detector and sanitizers under Delve

`-race` instruments memory accesses and reports a stack on the first race. Combined with Delve:

```bash
dlv debug --build-flags='-race' ./cmd/server
```

When the race detector reports a stack, set a breakpoint at the offending line and run again. Race reports are non-deterministic — re-running may not hit the same race. The `rr` backend is the cure: record one execution that does race, then reverse-step from the race report into the conflicting access.

`-msan`/`-asan` need cgo + matching libclang, and are mostly useful for cgo-heavy code. They work the same way under `--build-flags`.

---

## 9. Summary

Senior Delve usage is about *when* and *how* — debug binaries built with `-gcflags='all=-N -l'`, headless mode for remote and CI workflows, containers with `SYS_PTRACE`, `rr` backend for record-and-replay on Linux, and `dlv core` for post-mortem. In production, prefer pprof/tracing/logging first and reach for `dlv attach` only with a plan to `detach`. Pick the tool that matches the question; Delve is precision, not coverage.

---

## Further reading
- Headless server: https://github.com/go-delve/delve/blob/master/Documentation/usage/dlv.md
- rr backend: https://github.com/go-delve/delve/blob/master/Documentation/usage/dlv_replay.md
- Core dumps: https://github.com/go-delve/delve/blob/master/Documentation/usage/dlv_core.md
- pprof and runtime/trace: https://pkg.go.dev/runtime/pprof, https://pkg.go.dev/runtime/trace
