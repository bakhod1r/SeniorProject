# Debugging with Delve — Professional

## 1. How Delve controls a process

Per platform, Delve uses the OS-native debug API:

| OS | Mechanism |
|-----|-----------|
| Linux | `ptrace(PTRACE_ATTACH|PTRACE_SEIZE)` + `/proc/<pid>/mem` for memory, `waitpid` for events |
| macOS | Mach exception ports + `task_for_pid` (entitlement-gated); a signing identity is required |
| Windows | `DebugActiveProcess`, `WaitForDebugEvent`, `ReadProcessMemory` |
| FreeBSD | `ptrace` similar to Linux |

These APIs let Delve insert software breakpoints (writing the `INT3` byte on x86 or `BRK` on arm64 into the target instruction), single-step, read/write registers and memory, and observe signals. The Go-aware layer sits on top: Delve walks the runtime's structures to map instruction pointers to goroutines and stacks.

Knowing the substrate matters when things go wrong: on Linux, attach failures are almost always `ptrace_scope` or namespace/capability issues; on macOS, code-signing entitlements; on Windows, privileges or AV interference.

---

## 2. DWARF and the Go runtime

Delve reads the binary's **DWARF** debug information to map addresses to file/line/variable. Go emits DWARFv4 by default; `-trimpath` strips paths and `-ldflags="-s -w"` strips symbol tables — both make Delve much less useful.

Beyond DWARF, Delve also walks Go-specific runtime structures:

- `runtime.allgs` — the array of all `g` (goroutine) descriptors.
- `runtime.g` fields (`goid`, `atomicstatus`, `sched`, `stack`, `waitreason`).
- `runtime.m` and `runtime.p` — the M/P part of the M:N scheduler.
- Type descriptors (`*runtime._type`) for interface unboxing and reflection.

This is why Delve can answer "which goroutine is waiting on which channel" while gdb cannot — gdb sees threads, not goroutines.

Source references for the curious:
- `pkg/proc/proc.go` — the platform-independent debugger core
- `pkg/proc/native/` — ptrace/Mach/Win backends
- `pkg/proc/gdbserial/` — the gdb-remote-serial backend (used by rr and lldb-server)
- `pkg/dwarf/` — DWARF reader
- `service/api/` — JSON-RPC types
- `service/dap/` — DAP server

---

## 3. The service API: JSON-RPC and DAP

Delve exposes two protocols:

| Protocol | Started by | Used by |
|----------|------------|---------|
| JSON-RPC v2 (Delve native) | `dlv --headless --listen=...` or `dlv connect` | `dlv connect` CLI, GoLand (mixed), some scripts |
| DAP (Debug Adapter Protocol) | `dlv dap --listen=...` | VS Code, Neovim, any DAP-compatible editor |

JSON-RPC is line-delimited JSON over a TCP socket; the API is documented under `service/api`. DAP follows the Microsoft spec (HTTP-like headers, JSON body). They are **not** interchangeable — start the right one for the client.

A tiny JSON-RPC poke (after `dlv --headless`):

```bash
echo '{"method":"RPCServer.State","params":[{}],"id":1}' | nc 127.0.0.1 2345
```

Knowing this is what lets you automate Delve in CI: script a headless server, drive it via JSON-RPC, dump goroutine stacks on test failures.

---

## 4. Goroutine stack walking

When you type `goroutines`, Delve iterates `runtime.allgs`. For each `g`, it reads:

- `g.atomicstatus` — running, runnable, waiting, dead.
- `g.waitreason` — human-readable wait cause (`chan receive`, `select`, `IO wait`, `GC sweep wait`, ...).
- `g.sched.pc` and `g.sched.sp` — the PC and SP at the last scheduler stop.
- `g.stack.lo` / `g.stack.hi` — current stack bounds (stacks are growable in Go).

For a runnable goroutine actually executing on a thread (M), Delve reads the live PC/SP from the thread's registers instead of the saved `sched` values. The result is the stack you see in `bt`.

This is why **goroutine IDs are stable across Delve commands** even though Go does not expose them in source — Delve reads them from the runtime.

---

## 5. Security model: ptrace, entitlements, root

Production attach scenarios run into one of three walls:

**Linux `ptrace_scope`** (`/proc/sys/kernel/yama/ptrace_scope`):

| Value | Effect |
|-------|--------|
| 0 | Any process can ptrace any other owned by the same UID (legacy default) |
| 1 | Only a parent or `CAP_SYS_PTRACE` can ptrace (modern default) |
| 2 | Only `CAP_SYS_PTRACE` |
| 3 | ptrace disabled entirely |

`dlv attach` from a sibling shell typically needs value 0 or `sudo` / capability. For containers, grant `SYS_PTRACE` capability and disable the default seccomp profile (or use a profile that allows `ptrace`).

**macOS:** `task_for_pid` requires the calling binary to be signed with the `com.apple.security.cs.debugger` entitlement (Delve's release binaries are). Running an unsigned `dlv` will silently fail to attach. SIP also blocks debugging Apple-signed binaries.

**Windows:** the debugger process needs `SeDebugPrivilege`. Administrator usually has it; service accounts may not.

Document these in your runbook so on-call engineers do not stall during an incident trying to debug `ptrace: operation not permitted`.

---

## 6. Core dumps in detail

`dlv core` opens a core file plus the original binary. Core formats supported:

- **ELF cores** on Linux (the kernel's default format).
- **Mach-O cores** on macOS (less common; macOS does not write cores by default).
- **minidumps** on Windows.

Generating cores in production:

- Linux: set `ulimit -c unlimited`, configure `/proc/sys/kernel/core_pattern` (a path or piped handler), and ensure the working directory is writable. `systemd` units use `LimitCORE=infinity` and may route to `systemd-coredumpctl`.
- On-demand: `gcore PID` (Linux), `lldb -o "process save-core /tmp/core" -p PID` (macOS), `procdump64.exe` (Windows).
- Inside containers: cores land in the container filesystem unless `core_pattern` writes to a host-mounted path.

Tool-chain hygiene: keep an un-stripped copy of every production binary somewhere addressable (build cache, artifact store). When a core arrives, pair it with the matching un-stripped binary or DWARF sidecar. A core without symbols is barely better than a stack dump.

---

## 7. The trace subcommand and dynamic tracing

`dlv trace` sets non-stopping breakpoints (tracepoints) that print arguments and continue. It is a "structured printf without recompiling":

```bash
dlv trace ./cmd/server 'main.handleRequest'
> main.handleRequest(r *http.Request) at ./main.go:42 (called)
> main.handleRequest => () at ./main.go:42 (returned)
```

Useful when you want call traces from a binary that you do not want to rebuild. Slower than logging but zero source changes; great for "what is calling this function and with what args?"

---

## 8. Performance and pitfalls

| Symptom | Cause | Mitigation |
|---------|-------|------------|
| Stepping is slow on a large heap | `print -follow_pointers` chasing huge graphs | Limit depth via `config max-variable-recurse`, print specific fields |
| Hundreds of breakpoint hits/sec stall the program | Hot-path breakpoint without condition | Add a condition that filters most hits |
| Watchpoints stop firing | GC moved the value or stack-allocated variable escaped | Watch heap-allocated fields; use a guard variable |
| Attach fails in Kubernetes | Missing `SYS_PTRACE` or hardened seccomp | Add capability, override seccomp profile |
| Symbols missing | Binary stripped (`-s -w`) or `-trimpath` | Build a debug variant; use DWARF sidecar |
| DAP session hangs on disconnect | No `--accept-multiclient` | Add the flag for editor workflows |

---

## 9. Auditing and review for team workflows

Things to enforce in code review and runbooks:

- Production Dockerfiles **never** include Delve in the runtime image by default; they ship a separate "debug image" tag if needed.
- If Delve is in a runtime image, it is gated behind a build tag or separate image so it is not deployed accidentally.
- Headless Delve in production binds to `127.0.0.1` and is exposed only via `kubectl port-forward` (never a service IP).
- `--accept-multiclient` and `--continue` are the right defaults for remote attach so a flaky editor does not lose the session or freeze the program.
- A documented procedure for "I need to debug prod" — who approves, how to cordon traffic, how to detach safely.

---

## 10. Summary

Professional Delve usage means understanding the substrate (`ptrace`, Mach ports, Windows debug API), the DWARF + runtime walking that gives Go-awareness, the two service protocols (JSON-RPC, DAP), and the OS-level security gates (`ptrace_scope`, entitlements, `SeDebugPrivilege`). Operationally, keep un-stripped binaries paired with releases, prefer `dlv core` for post-mortem, gate any in-cluster Delve behind capability+localhost+approval, and use `dlv trace` for low-effort call tracing without rebuilds.

---

## Further reading
- Delve source tree: https://github.com/go-delve/delve
- JSON-RPC service: https://github.com/go-delve/delve/blob/master/Documentation/api/json-rpc/README.md
- DAP service: https://github.com/go-delve/delve/blob/master/Documentation/api/dap/README.md
- Go runtime overview: https://github.com/golang/go/blob/master/src/runtime/HACKING.md
- Linux ptrace: `man 2 ptrace`; `Documentation/security/Yama.txt` in the kernel tree
