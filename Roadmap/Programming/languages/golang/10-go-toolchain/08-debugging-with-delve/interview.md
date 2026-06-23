# Debugging with Delve — Interview Q&A

A mix of conceptual and practical questions, labeled by level. Answers are concise; expand with examples in a real interview.

---

## Junior

**Q1. What is Delve and why prefer it to gdb for Go?**
Delve (`dlv`) is the Go-aware debugger. It understands goroutines, the scheduler, slices, maps, interfaces, and the runtime; gdb does not, and its Go support is limited and often misleading. For real Go debugging, use Delve.

**Q2. How do you install Delve?**
`go install github.com/go-delve/delve/cmd/dlv@latest`. Confirm with `dlv version`. Requires Go 1.21+ for modern Delve releases.

**Q3. What is the difference between `dlv debug`, `dlv test`, `dlv exec`, and `dlv attach`?**
- `dlv debug` — compiles a package with debug flags and starts debugging it.
- `dlv test` — compiles the test binary for a package and debugs it.
- `dlv exec` — debugs an already-built binary.
- `dlv attach PID` — attaches to a running process.

**Q4. Name the five commands you use most often.**
`break` (b), `continue` (c), `next` (n), `step` (s), `print` (p). Add `stack` (bt) and `goroutines` for concurrency.

---

## Middle

**Q5. How do you set a conditional breakpoint?**
`break main.go:42 if x > 5 && name == "alice"` — the condition is a Go expression evaluated each hit. Keep it cheap on hot paths.

**Q6. How do you debug a specific test by name?**
`dlv test ./pkg -- -test.run TestX -test.v`. Anything after `--` is passed to the test binary; before `--` is for Delve.

**Q7. Why do my locals show `<optimized out>` in `dlv exec`?**
The binary was built with optimizations and inlining on, so the variables do not exist as memory locations. Rebuild with `go build -gcflags='all=-N -l'` (the `all=` prefix is essential to cover dependencies). `dlv debug` and `dlv test` already do this.

**Q8. What is the difference between `next` and `step`?**
`next` executes the current line as a single step, treating function calls as atomic. `step` descends into the next function call. `stepout` runs until the current function returns.

**Q9. How do you pass build tags or `-race` to `dlv debug`?**
Use `--build-flags`: `dlv debug --build-flags='-tags=integration -race' ./cmd/server`. Putting these after the package path passes them to your program instead.

---

## Senior

**Q10. What is headless mode and when do you use it?**
`dlv --headless --listen=:2345 --api-version=2 --accept-multiclient` starts Delve as a network server speaking JSON-RPC; `dlv dap` starts the DAP variant. Use it for remote debugging (containers, other hosts) and editor integration. `--accept-multiclient` keeps the server alive across client disconnects.

**Q11. What does `--backend=rr` give you?**
Time-travel debugging via the `rr` recorder on Linux x86_64. You can `reverse-step`, `reverse-next`, `reverse-continue`, and `rewind`. Indispensable for intermittent races: record once, then explore deterministically.

**Q12. How do you safely debug a production process?**
Prefer non-invasive tools first (pprof, runtime/trace, logs). If you must use Delve, attach with `--accept-multiclient` to a canary instance, use conditional breakpoints to filter, and always `detach` (not `quit`) so the program continues. Better yet, capture a core (`gcore`) and use `dlv core` offline.

**Q13. Your editor's breakpoints are gray ("unverified") when attaching remotely. Why?**
The remote source paths do not match the local ones. In VS Code, set `substitutePath` (or `remotePath`) so the editor's file paths map to the binary's compile-time paths. `-trimpath` exacerbates this by stripping the paths entirely.

---

## Professional

**Q14. Which OS APIs does Delve use to control the process?**
Linux/FreeBSD: `ptrace` + `/proc/<pid>/mem`. macOS: Mach exception ports + `task_for_pid` (requires a code-signing entitlement). Windows: `DebugActiveProcess` / `WaitForDebugEvent` / `ReadProcessMemory`. Failures on attach are usually permission-related: `ptrace_scope`, missing entitlement, or `SeDebugPrivilege`.

**Q15. How does Delve list goroutines?**
It walks `runtime.allgs` and reads each `runtime.g`'s status, wait reason, and saved PC/SP. For running goroutines it reads live registers from the executing thread. That is why Delve sees goroutines while gdb only sees OS threads.

**Q16. What is the difference between `dlv connect` and `dlv dap` clients?**
`dlv connect` speaks Delve's native JSON-RPC v2 protocol; `dlv dap` speaks the Debug Adapter Protocol used by VS Code and most modern editors. They are not interchangeable — the server side has to match: `dlv --headless` for JSON-RPC, `dlv dap` for DAP.

---

## Common traps

- Debugging a stripped binary (`-ldflags="-s -w"`) and being surprised that symbols are missing.
- Using `-trimpath` and then wondering why breakpoints do not map to source.
- Forgetting the `all=` prefix in `-gcflags='all=-N -l'` so only your top package is unoptimized.
- `quit` on an attached process — it kills the process. Use `detach`.
- Setting a breakpoint inside an inlined function and seeing it "never fire" — disable inlining or break at the caller.
- Hot-path breakpoint with no condition that hangs the whole program.
- Running Delve in a container without `SYS_PTRACE` and getting `operation not permitted`.
- Mixing up `--build-flags='-race'` (correct) with `-race` after the package (passed to your program).
- Expecting watchpoints to follow a stack-allocated variable — they watch addresses, which become invalid.
- Forgetting that `dlv core` is read-only: no stepping, only inspection.
