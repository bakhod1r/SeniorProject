# Debugging with Delve — Optimization

Delve sessions can become painfully slow: hot-path breakpoints, deep pointer chases, rebuilds on every restart, scanning thousands of goroutines. These exercises cut common time sinks. Numbers are illustrative; measure on your own program.

---

## Exercise 1: Use `dlv test` for tests instead of `dlv debug`

**Before** — debugging a test by running the whole binary:

```bash
dlv debug ./cmd/server      # compiles the full server, then you have to hit the right code path
```

**After** — debug exactly the test you care about:

```bash
dlv test ./internal/parser -- -test.run TestParseDate -test.v
```

| Metric | `dlv debug` (full server) | `dlv test` (single test) |
|--------|---------------------------|--------------------------|
| Build size | full binary | test binary for one package |
| Time to reach the bug | seconds + manual setup | breakpoint fires on test entry |
| Restart cost | full server reinit | one test re-runs |

`dlv test` is almost always faster and clearer when the bug lives in code with test coverage.

---

## Exercise 2: Headless + DAP keeps the editor responsive

**Before** — VS Code launches `dlv` itself on every F5; the editor stalls while Delve compiles.

**After** — run a long-lived headless DAP server outside the editor, and `attach` from VS Code:

```bash
dlv dap --listen=127.0.0.1:38697
```

```json
{ "name": "attach", "type": "go", "request": "attach", "mode": "remote", "port": 38697 }
```

| Metric | inline launch | long-lived DAP attach |
|--------|---------------|----------------------|
| Editor UI latency on F5 | seconds (compile + spawn) | instant (just RPC) |
| Restart workflow | full restart | `restart` in the session |

This pays off most on large codebases where the rebuild dominates.

---

## Exercise 3: Avoid `-trimpath` while debugging

**Before** — your release build uses `-trimpath`. Debug sessions show gray ("unverified") breakpoints in the editor; manual breakpoints need full module paths.

**After** — build a separate debug binary without `-trimpath`:

```bash
go build -gcflags='all=-N -l' -o app-debug ./cmd/server
```

| Metric | release build (`-trimpath`) | debug build |
|--------|-----------------------------|-------------|
| Breakpoint setup | needs `substitutePath` mapping | works out of the box |
| Stack frame paths | `module/pkg/file.go` | absolute workspace paths |

Keep `-trimpath` for release; do not pay its cost during development.

---

## Exercise 4: Use `print -follow_pointers` selectively

**Before** — printing the whole world to "see what's in there":

```text
(dlv) print -follow_pointers root        # 200 MB tree, traversed in full → seconds
```

**After** — name the fields you need:

```text
(dlv) print root.Left.Key
(dlv) print root.Right.Children[0].ID
(dlv) config max-variable-recurse 1      # default depth
(dlv) config max-array-values 64
```

| Metric | unconstrained dump | targeted field |
|--------|--------------------|----------------|
| Latency | seconds to tens of seconds | milliseconds |
| Output size | hundreds of KB | a single value |

For deep structures, set conservative `max-variable-recurse` / `max-array-values` once and override per-command when you really need depth.

---

## Exercise 5: Shorter breakpoint expressions on hot paths

**Before** — a breakpoint on a request handler with a heavy condition:

```text
(dlv) break handler.go:42 if strings.Contains(r.URL.Path, "alice") && len(r.Header.Get("X-Trace")) > 0
```

Condition is evaluated on every request → the server stalls.

**After** — narrow the condition to one cheap check; do the rest with `print` after stopping:

```text
(dlv) break handler.go:42 if r.URL.Path == "/users/alice"
```

| Metric | heavy condition | cheap condition |
|--------|-----------------|-----------------|
| Per-hit cost | string ops + map lookup | pointer + string compare |
| Server throughput while debugging | tanks | survives |

Conditions are Go expressions evaluated synchronously while the process is paused; treat them like inner-loop code.

---

## Exercise 6: Use `goroutine N` instead of scanning all stacks

**Before** — you suspect a leak and dump every stack:

```text
(dlv) goroutines -t          # 10,000 stacks; terminal floods, hard to read
```

**After** — first ask Delve for a summary, then jump to the suspect:

```text
(dlv) goroutines             # one line per goroutine
(dlv) goroutines -s waitreason | head    # group by state if your build supports it
(dlv) goroutine 4231          # switch to the interesting one
(dlv) bt                       # only this stack
```

| Metric | full stack dump | targeted inspection |
|--------|-----------------|---------------------|
| Terminal output | tens of thousands of lines | dozens |
| Time to find the leak | minutes of scrolling | seconds |

Often the leak is "all goroutines blocked on the same channel" — visible from the summary line alone.

---

## Exercise 7: Postmortem with a core dump instead of live attach

**Before** — you keep attaching to a flaky service, missing the crash window:

```bash
dlv attach $(pgrep server)     # the bug already happened five minutes ago
```

**After** — let the kernel write a core on crash and debug offline:

```bash
ulimit -c unlimited
# in /etc/systemd/coredump.conf or /proc/sys/kernel/core_pattern
dlv core ./app /var/lib/systemd/coredump/core.app.1.0123...
```

| Metric | live attach | core dump |
|--------|-------------|-----------|
| Reproducibility | flaky; need to be online during failure | always; explore at leisure |
| Production impact | pauses live process | none (post-crash) |
| Inspect what was alive at crash | yes (briefly) | yes (frozen forever) |

Cores are read-only — no stepping — but they preserve exactly the state at the moment of death.

---

## Exercise 8: Disable cgo if your debug target does not need it

**Before** — `dlv debug` rebuilds with cgo enabled by default, using the slower external linker.

**After:**

```bash
CGO_ENABLED=0 dlv debug ./cmd/server
```

| Metric | cgo on | cgo off |
|--------|--------|---------|
| Build time per `restart` | seconds | sub-second |
| Linker | external | internal |

For pure-Go programs, turning cgo off makes the inner debug loop noticeably snappier — especially on macOS where the external linker is slower.

---

## Measurement checklist
- [ ] Use `dlv test` for test-scoped bugs; do not debug the whole binary.
- [ ] Run a long-lived headless DAP server and attach from the editor.
- [ ] Build a non-`-trimpath`, un-stripped binary for debug.
- [ ] Set `config max-variable-recurse` low; print specific fields.
- [ ] Keep breakpoint conditions cheap on hot paths.
- [ ] Summarize goroutines first, then switch to the suspect.
- [ ] Prefer `dlv core` for postmortem over live attach.
- [ ] `CGO_ENABLED=0` if you do not need cgo.
