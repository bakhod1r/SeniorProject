# Debugging with Delve — Find the Bug

Each scenario shows a Delve session or setup that looks fine but misbehaves. Find the defect, explain it, and fix it.

---

## Bug 1 — Locals shown as `<optimized out>`

```text
$ dlv exec ./app
(dlv) break main.process
(dlv) continue
(dlv) print user
Command failed: could not find symbol value for user
(dlv) locals
(unreadable: optimized out)
```

**Bug:** the binary was built with optimizations and inlining on, so `user` does not exist as a memory location.
**Fix:** rebuild with debug flags, including the `all=` prefix so dependencies are covered:

```bash
go build -gcflags='all=-N -l' -o app ./cmd/server
dlv exec ./app
```

`dlv debug` / `dlv test` do this automatically; only `dlv exec` against your own build needs it.

---

## Bug 2 — `dlv attach` fails with "operation not permitted"

```bash
$ dlv attach 12345
could not attach to pid 12345: operation not permitted
```

**Bug:** Linux `ptrace_scope` (Yama) blocks attaching to a sibling process you did not spawn. Default on modern distros is 1.
**Fix:** for a one-off, run Delve with `sudo`. For a development machine, temporarily relax it:

```bash
echo 0 | sudo tee /proc/sys/kernel/yama/ptrace_scope
```

In a container, add `--cap-add=SYS_PTRACE` (Docker) or `securityContext.capabilities.add: ["SYS_PTRACE"]` (Kubernetes), and review the seccomp profile so `ptrace` is not blocked.

---

## Bug 3 — `dlv exec` vs `dlv debug` confusion

```bash
$ dlv exec ./cmd/server
could not launch process: fork/exec ./cmd/server: permission denied
```

**Bug:** `dlv exec` expects a path to a **built binary**. `./cmd/server` is a directory (a package path). The user meant `dlv debug ./cmd/server`.
**Fix:** pick the right mode:

```bash
dlv debug ./cmd/server       # compile + debug a package
dlv exec ./bin/server        # debug an existing binary
```

Mnemonic: `debug` builds for you, `exec` does not.

---

## Bug 4 — Stripped binary has no symbols

```text
(dlv) break main.main
Command failed: could not find function main.main
(dlv) funcs
(empty)
```

**Bug:** the binary was linked with `-ldflags="-s -w"` which strips symbol tables and DWARF. Delve cannot resolve any function or line number.
**Fix:** build a debug variant without `-s -w` (and without `-trimpath`) for debugging:

```bash
go build -gcflags='all=-N -l' -o app-debug ./cmd/server
dlv exec ./app-debug
```

Keep an un-stripped copy of every production build (or a DWARF sidecar) so you can pair it with a core later.

---

## Bug 5 — Breakpoint never fires because of build tags

```go
//go:build experimental

func handleRequest(w http.ResponseWriter, r *http.Request) {
    // breakpoint here
}
```

```text
(dlv) break ./handler.go:7
Breakpoint 1 set at 0x... for main.handleRequest() ./handler.go:7
(dlv) continue
... breakpoint never hits, requests are served by the stub instead
```

**Bug:** the file is gated behind `//go:build experimental`. Without `-tags=experimental` at build time, Delve compiled a different version of the package that excludes this function, and a stub matched the same name elsewhere.
**Fix:** pass the tag through `--build-flags`:

```bash
dlv debug --build-flags='-tags=experimental' ./cmd/server
```

Confirm with `funcs ^main\.handleRequest$` that the right symbol exists.

---

## Bug 6 — Breakpoint inside an inlined function

```text
(dlv) break helper.Increment
Breakpoint 1 set at 0x... for github.com/me/app/helper.Increment() ./helper/inc.go:5
(dlv) continue
... program runs to completion, breakpoint never hits
```

**Bug:** `helper.Increment` is small enough that the inliner inlined it everywhere. Its function symbol exists, but the actual call sites no longer have a distinct entry to break on. With optimizations on, you stepped through inlined code without stopping.
**Fix:** disable inlining (Delve's `dlv debug` already does, but `dlv exec` against your own build does not):

```bash
go build -gcflags='all=-N -l' -o app .
```

Alternatively, set the breakpoint at a caller line and step in, which works for inlined frames via DWARF inline records.

---

## Bug 7 — `-trimpath` strips source paths so breakpoints are gray

```bash
$ go build -trimpath -gcflags='all=-N -l' -o app .
$ dlv exec ./app
(dlv) break /home/me/proj/main.go:10
Command failed: could not find file /home/me/proj/main.go
```

**Bug:** `-trimpath` rewrote `/home/me/proj` to the module path (`github.com/me/app`) in DWARF. Your absolute breakpoint path no longer matches.
**Fix:** either drop `-trimpath` for debug builds, or set breakpoints by the path Delve actually sees:

```text
(dlv) break github.com/me/app/main.go:10   # or
(dlv) break main.main
```

In editor DAP configs, use `substitutePath` to map the trimmed prefix back to the workspace.

---

## Bug 8 — Mixed stack with cgo frames

```text
(dlv) bt
0  0x... in github.com/me/app/native._Cfunc_run at _cgo_gotypes.go:42
1  0x... in github.com/me/app/native.Run at native.go:18
... [no further frames]
```

**Bug:** the stack walks Go frames but cuts off where C code begins. Delve cannot natively unwind C frames inside a cgo call; the C portion is opaque without C debug info.
**Fix:** when you must debug into C, build the C code with `-g -O0` (CGO_CFLAGS), and use an external C debugger (gdb/lldb) attached separately, or rely on the C stack from a core dump. For pure-Go work, structure your code so cgo calls are leaf operations and the bug is debuggable on the Go side of the boundary.

---

## Bug 9 — `quit` on attach killed production

```text
(dlv) quit
Would you like to kill the process? [Y/n]
$ # ...service is down
```

**Bug:** the engineer pressed Enter (default Y) at the prompt; `dlv attach` defaults to killing the process on quit.
**Fix:** use `detach` to leave the program running. If you do `quit`, answer `n` explicitly. For headless DAP, the editor's "Stop" can also kill the program; check `launch.json` `stopOnEntry` and similar options.

---

## Bug 10 — Watchpoint stops firing mid-session

```text
(dlv) watch -w counter
Watchpoint 1 set at 0xc0000a8000
(dlv) continue
... fires twice, then stops firing even though counter keeps changing
```

**Bug:** `counter` was on the goroutine's stack; the stack was copied to a new location when the goroutine grew (or GC moved a heap object). The watchpoint still watches the old address, which is now unused or reused.
**Fix:** watch a heap-allocated, stable address — for example, a field of a struct that stays alive on the heap, or a package-level variable. Hardware watchpoints are also limited (typically 4 on x86); do not over-allocate them.

---

## How to approach these
1. Symbols/locals missing? → debug-mode build (`-gcflags='all=-N -l'`), no `-s -w`, careful with `-trimpath`.
2. Attach denied? → `ptrace_scope` on Linux, entitlement on macOS, `SeDebugPrivilege` on Windows, `SYS_PTRACE` in containers.
3. Breakpoint never fires? → check build tags, inlining, and that you used the right launch mode.
4. Attached process killed? → `detach`, not `quit`.
5. Watchpoint silent? → only watch stable heap addresses, mind hardware limits.
6. Confused by `exec` vs `debug`? → `debug` takes a package, `exec` takes a binary.
