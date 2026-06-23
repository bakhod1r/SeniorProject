# Stack Traces & Debugging — Interview Questions

> Cross-level interview prep. Easy at the top, hardest at the bottom. Each question has the question, a short answer, and (where useful) the depth a stronger answer would add.

---

## Junior

### Q1. How do you trigger a stack trace in a Go program?
**Short answer:** Either let the program panic (the runtime prints one automatically) or call `runtime/debug.PrintStack()` / `debug.Stack()` explicitly.

**Stronger answer:** Add `runtime.Stack(buf, all)` for full control, or send `SIGQUIT` (Ctrl-\) to the running process to get a goroutine dump without code changes.

---

### Q2. What is `runtime.Caller` used for?
It returns the caller's PC, file, and line. The argument `skip` selects how many frames to ascend: `Caller(0)` is the line where `Caller` was called, `Caller(1)` is the line that called *that* function.

```go
pc, file, line, ok := runtime.Caller(1)
```

---

### Q3. What is the difference between `runtime.Caller` and `runtime.Callers`?
- **`Caller(skip)`** — returns *one* frame, already symbolized.
- **`Callers(skip, pcs)`** — fills a slice with *many* PCs, no symbolization.

Use `Caller` for "where am I"; use `Callers` + `CallersFrames` for full traces.

---

### Q4. What does `runtime/debug.Stack()` return?
It returns a `[]byte` containing a formatted stack trace of the *current* goroutine (only). For all goroutines, use `runtime.Stack(buf, true)` directly.

---

### Q5. Do Go errors carry stack traces by default?
**No.** Wrapping with `fmt.Errorf("...: %w", err)` propagates the error chain but no location info. Adding stacks to errors requires a custom type or a third-party library like `cockroachdb/errors`.

---

### Q6. What does `GOTRACEBACK` do?
It controls how much the runtime prints when the program panics. Values:
- `none` — print no traceback.
- `single` (default) — only the panicking goroutine.
- `all` — every user-created goroutine.
- `system` — also runtime-internal goroutines.
- `crash` — like `system`, then abort (writes a core dump on supported OSes).

---

### Q7. How do you get a goroutine dump from a running program?
Three options:
1. Send `SIGQUIT` (Ctrl-\) — runtime prints all goroutines and exits.
2. Call `runtime.Stack(buf, true)` programmatically.
3. Hit `/debug/pprof/goroutine?debug=2` if `net/http/pprof` is mounted.

---

## Middle

### Q8. Why does my stack trace lack a function I expected to see?
Most likely **inlining**. The Go compiler inlined the small function into its caller, so a single PC now corresponds to a position inside both functions. To see all inlined frames, use `runtime.CallersFrames`, not `runtime.FuncForPC`. To disable inlining, build with `-gcflags='all=-l'`.

---

### Q9. What is the difference between capturing PCs and resolving them?
`runtime.Callers` collects raw PC values — fast (~150 ns for 8 frames) and allocation-free with a caller-supplied buffer. `runtime.CallersFrames` resolves each PC into a `(function, file, line)` — slower (~100-300 ns per frame) and allocates strings. The split lets you capture cheaply at the error origin and resolve only when something prints the trace.

---

### Q10. How would you build an error type that carries a stack trace?
```go
type stackErr struct {
    msg string
    err error
    pcs []uintptr
}
func (e *stackErr) Error() string { return e.msg }
func (e *stackErr) Unwrap() error { return e.err }

func New(msg string) error {
    pcs := make([]uintptr, 32)
    n := runtime.Callers(2, pcs)
    return &stackErr{msg: msg, pcs: pcs[:n]}
}
```

Capture at construction; format when consumed.

---

### Q11. What is `pkg/errors` and why is it deprecated?
`github.com/pkg/errors` (Dave Cheney) was the de-facto stack-tracing error package before Go 1.13. It introduced `errors.Wrap`, `WithStack`, and the `StackTrace()` method. It is now archived. New projects use the standard library plus, if needed, `github.com/cockroachdb/errors`.

---

### Q12. What is the `skip` parameter in `runtime.Callers` actually counting?
The number of frames to *omit* from the top of the slice. With `skip=2`, the slice starts after `runtime.Callers` itself and after your wrapper function. Off-by-one is the most common mistake — the wrong skip will include either an extra wrapper frame or the wrong starting function.

---

### Q13. How do you find which goroutine is leaking?
Capture a goroutine dump with `runtime.Stack(buf, true)`, then look for repeated `created by` lines. A goroutine leak typically shows N goroutines blocked at the same instruction with the same `created by` callsite. Tools like [`go.uber.org/goleak`](https://github.com/uber-go/goleak) automate this in tests.

---

### Q14. What does pprof capture on the heap profile?
`/debug/pprof/heap` samples *live* allocations: which call sites are responsible for currently-live heap memory. With `?gc=1` it forces a GC first, so you see retained objects only. `allocs` is the cumulative version (all allocations since process start).

---

### Q15. How do you enable block and mutex profiling?
```go
runtime.SetBlockProfileRate(1)         // every block event
runtime.SetMutexProfileFraction(1)     // every contention
```

Both default to disabled. Both have measurable overhead — set higher rates (e.g., 100, 1000 = sample every Nth) in production.

---

## Senior

### Q16. How do you architect debugging for a production Go service?
Four things to wire in at design time:
1. **Identity propagation** — a request/trace ID at every layer.
2. **`net/http/pprof`** mounted on a private port.
3. **Structured logging** with stacks as a structured field, correlated by trace ID.
4. **A panic-recovery middleware** that captures the stack before responding 500.

Add continuous profiling (Pyroscope, Phlare, or a vendor) for transient issues.

---

### Q17. How do distributed traces relate to stack traces?
A *trace* shows how a request flowed across services and spans of work; a *stack* shows where execution sat inside a single goroutine. They are complementary. Best practice: when an error occurs, attach the stack as a span event so the trace UI can surface both views together.

```go
span.RecordError(err)
span.AddEvent("stack", trace.WithAttributes(
    attribute.String("trace", string(debug.Stack()))))
```

---

### Q18. What is `GOTRACEBACK=crash` good for?
On panic, instead of cleanly exiting the runtime calls `abort()`, which on Linux (with `ulimit -c unlimited` and a writable core_pattern) generates a core dump. You can then analyze it with `dlv core ./mybinary corefile` and inspect every variable and goroutine at the moment of crash. The closest thing Go has to gdb-style postmortem analysis.

---

### Q19. When would you use `delve` instead of logs and stacks?
- When the bug is reproducible and you want to step through it.
- When you need to inspect deep struct fields without instrumenting.
- When debugging optimizer-related issues (build with `-gcflags='-N -l'`).
- For a remote production process when logs are insufficient and a goroutine dump is not enough — but be aware `dlv attach` freezes the process.

---

### Q20. Why is logging the stack on *every* error a bad idea?
- **CPU cost** — `debug.Stack` is microseconds, allocations included.
- **Log volume** — stacks are kilobytes; high-rate errors blow up the log pipeline.
- **Information redundancy** — five wraps capturing five stacks repeats the same frames.
- **Operator fatigue** — operators learn to skip the stacks because most are noise.

Capture at the *origin* of failures; format and log at a single boundary.

---

### Q21. How do you debug a Go service that hangs in production?
1. **Send `SIGQUIT`** (`kill -QUIT <pid>` on Linux) — gives a full goroutine dump and exits.
2. **Hit `/debug/pprof/goroutine?debug=2`** if you need to keep the process alive.
3. **Look for goroutines stuck in `chan receive` or `select`** — usually a missed close or a deadlock.
4. **Compare two dumps** taken minutes apart — shows what is making progress vs stuck.

---

### Q22. What is `-trimpath` and why does it matter for stacks?
`-trimpath` strips the build-host's filesystem prefix from compiled paths. Stack traces print module-relative paths (`mymod/foo.go`) instead of `/Users/alice/go/.../mymod/foo.go`. Recommended for any binary you ship outside your laptop — hides the build environment and makes traces consistent across CI/build hosts.

---

## Professional

### Q23. What is the cost model of capturing a stack?
- **Frame walk** (`runtime.Callers` with caller-supplied buffer): ~150 ns for 8 frames, 0 allocations.
- **Symbolize** (`runtime.CallersFrames`): ~100-300 ns per frame, allocates strings for `Function` and `File`.
- **Format** (`debug.Stack`): 5-10 µs, multiple allocations.
- **Goroutine dump** (`runtime.Stack(buf, true)`): tens of µs to milliseconds depending on goroutine count.

The split between capture and symbolize lets you pay only what you need.

---

### Q24. How does the runtime walk a stack?
On amd64/arm64 since Go 1.21, **frame-pointer-based unwinding**: read SP/BP, follow the chain of saved BPs, read the saved return PC at each frame. On older versions or stripped builds, it falls back to **PC tables** stored in `pclntab` — at each PC, metadata says where the caller's BP and return PC live. Both produce the same PC slice.

---

### Q25. Why do inlined functions sometimes show, sometimes not?
- **`runtime.FuncForPC`** does not understand inlining — it returns the outer function only.
- **`runtime.CallersFrames`** *does* understand inlining — for a single PC inside an inlined region, it emits one Frame per inlined call site.

Always prefer `CallersFrames` for new code. The runtime's own panic traceback uses inlining metadata correctly.

---

### Q26. What happens if you strip a binary with `-ldflags='-s'`?
The Go symbol table is removed. Stack traces show mostly hex addresses; `runtime.FuncForPC` returns placeholders; `CallersFrames` cannot resolve. **Never use `-s` for production binaries that need diagnostic stacks.** `-w` (strips DWARF for `dlv`) is the more reasonable optimization.

---

### Q27. How does pprof use stacks?
Pprof samples are *labeled stack traces*. The CPU profile takes a stack sample every ~10ms; the heap profile labels each allocation with the stack at allocation time. Aggregating the samples produces flame graphs and call-graph views. Internally pprof uses the same `runtime.CallersFrames` path that error-stack capture does — same cost characteristics.

---

### Q28. What is the maximum stack depth Go supports for traces?
There is no hard limit on goroutine stack depth (stacks grow dynamically up to `GoroutineStackLimit`, default 1 GB). For traces, `runtime.Callers` only fills the buffer you give it; pass a slice of any size. `runtime.Stack` truncates to the buffer you provide. For ad-hoc dumps, 64 KB or 1 MB are typical.

---

### Q29. How do signals interact with stacks?
The Go runtime installs signal handlers for fatal signals (SIGSEGV, SIGBUS, etc.) that convert them into runtime panics with traces. SIGQUIT (Ctrl-\) prints all goroutine stacks and exits. SIGABRT (when `GOTRACEBACK=crash`) prints, then aborts for a core dump. User signal handlers via `os/signal` can intercept most signals but not the panic-on-segfault behavior.

---

### Q30. What is `runtime.SetPanicOnFault`?
By default, faulting at a non-nil address (e.g., dereferencing into mmap'd memory that became unmapped) crashes the program. `SetPanicOnFault(true)` makes such faults a normal panic, recoverable with `recover()`. Used in code that maps memory unsafely (databases, FFI). Comes with risk: a recovered fault may leave shared state corrupted.

---

## Behavioral / Code Review

### Q31. You see `debug.Stack()` inside a tight loop in a PR. What do you say?
Reject. `debug.Stack()` allocates, walks the runtime, and formats — easily 5-10 µs per call. Inside a hot loop the cost is huge. Suggestions:
- Capture only on actual failure paths.
- Use `runtime.Callers` with a stack-allocated array if a stack is genuinely needed.
- Move the capture to the top of the operation, not inside the loop.

---

### Q32. A team asks: "Should we add stack traces to every error?"
Probably not. Trade-offs:
- **Pro**: faster diagnosis when errors do reach humans.
- **Con**: ~µs and several allocations per error. Five wraps = five stacks = redundant data.

Better: capture at error *origin* (deepest point), keep wraps cheap, log at the boundary. A library like `cockroachdb/errors` does this; rolling your own is straightforward (~30 lines).

---

### Q33. How would you debug "the service is using 8 GB of RAM"?
1. Hit `/debug/pprof/heap` — see what is currently allocated.
2. Hit `/debug/pprof/heap?gc=1` — see what is *retained* after a GC.
3. Compare two heap snapshots taken 10 minutes apart — find the growing block.
4. If it is goroutines, hit `/debug/pprof/goroutine?debug=2` and look for repeated `created by` lines.
5. If it is unbounded slices/maps, the source listing in pprof points at the offending line.

Result: read the flame graph, find the wide block, fix that line.

---

### Q34. A junior asks: "Why does Go not have stack traces in errors like Java?"
- Errors in Go are *expected* outcomes; pre-capturing a stack on every nil-comparison is wasteful.
- Capture is opt-in so the cost is paid only when needed.
- Wrapping with `%w` is idiomatic and carries semantic context — usually enough for debugging when paired with structured logs.
- For panics (truly exceptional), the runtime *does* print a trace automatically.

The model is "stacks for exceptions, context strings for normal failures" — the opposite of Java's default.

---

### Q35. You are asked to debug a hung service in production. What is your plan?
1. **Confirm**: the process is alive but not progressing — check metrics, then `top`.
2. **Check goroutines**: hit `/debug/pprof/goroutine?debug=2` (or send SIGQUIT if no pprof endpoint).
3. **Look for blocked patterns**: many goroutines stuck on the same channel, the same mutex, the same syscall.
4. **Cross-check with traces**: which trace IDs went silent at the time the hang started? Their last span tells you who was holding what.
5. **Take a CPU profile** (`/debug/pprof/profile?seconds=10`) — even if hung, it tells you whether the GC or scheduler is busy.
6. **Decide**: if a fix is obvious, deploy. If not, rotate the pod and capture a core for postmortem (`GOTRACEBACK=crash`).

The key is to gather evidence *before* killing the process — once it is gone, the goroutine dump is gone too.
