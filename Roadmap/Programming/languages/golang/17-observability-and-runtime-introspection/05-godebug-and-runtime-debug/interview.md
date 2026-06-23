# GODEBUG & `runtime/debug` — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is `GODEBUG` and when is it read?

**Model answer.** `GODEBUG` is an environment variable holding a comma-separated list of `name=value` settings that tweak runtime and standard-library behavior — for example `gctrace=1`, `schedtrace=1000`, `inittrace=1`. The runtime reads it **once, at program startup**. Setting or changing it after the program is running has no effect on already-resolved settings; you must restart. It requires no recompile, which makes it a diagnostic dial you can flip on a binary you already shipped.

**Common wrong answers.**
- "You set it in code." (You can set the env var, but the runtime already read it at startup; use `runtime/debug` for in-process control.)
- "It needs a special debug build." (No — every Go binary honors it.)
- "It's re-read continuously." (No — once at startup.)

**Follow-up.** *What happens if you misspell a setting?* — It is silently ignored; no error, no output.

---

### Q2. Read me this `gctrace` line: `gc 5 @1.2s 4%: 0.1+3+0.05 ms clock, ..., 50->52->30 MB, 60 MB goal, 8 P`.

**Model answer.** Cycle 5, started 1.2s after start, 4% cumulative CPU on GC, phase timings in ms, the heap was **50 MB** before GC, **52 MB** at mark termination, and **30 MB** live after; the goal that triggered it was 60 MB; 8 processors. The number that matters most is the last in the triple — 30 MB is the live heap.

**Common wrong answer.** "50 MB is the live heap." (No — the live heap is the third number, 30 MB.)

**Follow-up.** *Is the 4% the cost of this one cycle?* — No, it is cumulative GC CPU since start.

---

### Q3. What does `debug.SetMemoryLimit` do, and is it a hard cap?

**Model answer.** It sets a **soft** target for the runtime's total memory (heap, stacks, runtime metadata), equivalent to the `GOMEMLIMIT` environment variable. The runtime runs GC more aggressively as memory approaches the limit, trading CPU to respect it — but it never refuses an allocation, so it can overshoot. It is not a hard cap and not a substitute for the container's hard memory limit.

**Follow-up.** *What if the live set exceeds the limit?* — The runtime GCs continuously trying to reach an unreachable target — the GC death spiral.

---

### Q4. How do you print the commit a binary was built from, in code?

**Model answer.** `debug.ReadBuildInfo()`. It returns `(*BuildInfo, bool)`; check the bool. Iterate `info.Settings` for `vcs.revision` (commit), `vcs.time`, and `vcs.modified`. This is the programmatic equivalent of `go version -m ./binary`.

**Common wrong answer.** "Read it from a global variable I set with ldflags." (That works too, but `ReadBuildInfo` needs no build-time wiring for VCS data.)

**Follow-up.** *When does the bool come back false?* — Under `go run`, some test modes, or `-buildvcs=false`.

---

### Q5. What's the difference between `GOGC` and `GOMEMLIMIT`?

**Model answer.** `GOGC` is a *ratio* — how much the heap may grow relative to the live set before the next GC (default 100 = let it double). `GOMEMLIMIT` is an *absolute* memory target in bytes. They cooperate: normally the ratio drives collection, but as memory nears the limit, the limit takes over and GC runs more often. The runtime triggers at `min(ratio goal, limit goal)`.

**Follow-up.** *What does `GOGC=off` with a limit do?* — GC runs only to respect the limit; the heap grows freely up to it. A throughput-maximising configuration.

---

## Middle

### Q6. Since Go 1.21, `GODEBUG` does something beyond diagnostics. What?

**Model answer.** It is the mechanism for the **compatibility system**: every backward-incompatible behavior change ships behind a named GODEBUG setting with old/new values. The default is derived from the main module's `go` line, so a binary built by a new toolchain from an old `go.mod` keeps the old behavior. You override via (increasing precedence) the `go` line → `godebug` directive in `go.mod` → `//go:debug` in `package main` → the `GODEBUG` env var. Examples: `panicnil`, `tlsrsakex`, `x509sha1`.

**Common wrong answer.** "The toolchain version sets the defaults." (No — the `go` line does, deliberately, so toolchain upgrades stay compatible.)

**Follow-up.** *Why is that design important?* — It lets the Go team fix defaults without breaking programs that haven't opted in.

---

### Q7. Where must a `//go:debug` directive go, and why?

**Model answer.** In a comment immediately above `package main`, with no blank line between, in the `main` package. It is permitted only there because these directives configure an *executable's* default behavior, not a library's. A `//go:debug` line in a library package is a compile error.

**Follow-up.** *And the `godebug` directive in `go.mod`?* — That sets module-wide defaults (Go 1.23+), lower precedence than `//go:debug`, higher than the `go` line.

---

### Q8. Explain the interaction between `SetMemoryLimit` and `SetGCPercent`.

**Model answer.** `SetGCPercent` sets a ratio goal; `SetMemoryLimit` sets an absolute goal. The pacer triggers GC at whichever goal is reached first. With a comfortable limit, the ratio drives normal collection; as memory approaches the limit, the limit goal dominates and GC frequency rises. The limit is soft, bounded by a ~50% GC-CPU guard — past that, the runtime lets memory exceed the limit rather than starve the program.

**Follow-up.** *What's the failure mode of a too-tight limit?* — The GC death spiral: constant GC, high CPU, collapsed throughput, but no OOM — so RSS dashboards look fine.

---

### Q9. How do you know which compatibility behaviors your program actually relies on?

**Model answer.** The `runtime/metrics` counters `/godebug/non-default-behavior/<name>:events`. Each increments when code takes the old (non-default) path for that setting. Enumerate them with `metrics.All()`, read with `metrics.Read`. A nonzero counter means real reliance on the old behavior — load-bearing, you can't just drop the setting.

**Common wrong answer.** "A zero counter proves it's safe to upgrade." (No — zero means "not exercised in this run," not "not depended upon.")

**Follow-up.** *Why don't diagnostic settings like `gctrace` have such a counter?* — They only emit output; there's no "non-default behavior" to count. The counter exists only where stdlib code calls `IncNonDefault()`.

---

### Q10. What's the cost of `FreeOSMemory`, and when should you call it?

**Model answer.** It forces a full GC and then eagerly returns freed pages to the OS. The full GC is expensive, so never call it in a request handler or loop. The legitimate use is once after a large one-off allocation spike (e.g., the end of a batch phase) when you want resident memory to drop promptly. For steady-state memory control, prefer `GOMEMLIMIT`, and `GODEBUG=madvdontneed=1` if you need RSS to reflect freed memory.

**Follow-up.** *Why might RSS not drop even after freeing?* — On Linux the default `MADV_FREE` leaves pages counted until kernel pressure; `madvdontneed=1` returns them eagerly.

---

### Q11. Walk through what `debug.Stack()` gives you versus a full goroutine dump.

**Model answer.** `debug.Stack()` returns only the **current** goroutine's stack as `[]byte`; `debug.PrintStack()` writes it to stderr — ideal inside a `recover()`. For **all** goroutines you use `runtime.Stack(buf, true)` or send the process `SIGQUIT`, which the runtime handles by dumping every goroutine. The verbosity of a crash traceback is controlled by `SetTraceback`/`GOTRACEBACK` (`single`, `all`, `system`, `crash`).

**Follow-up.** *How do you capture the traceback of a fatal, unrecoverable crash durably?* — `SetTraceback("all")` plus `SetCrashOutput(file, ...)` (Go 1.23) to route it to durable storage.

---

### Q12. A teammate set `GOMEMLIMIT=1500MiB` but it seems to have no effect. What might be happening?

**Model answer.** Most likely `main` calls `debug.SetMemoryLimit(...)` with a hard-coded value, which runs after the env var was applied at startup and overrides it. The env var and the call set the same dial; the last setter wins. Pick one source of truth — if ops should control the limit, read it from the environment, don't also hard-code a call.

**Follow-up.** *Other reasons a limit "doesn't work"?* — The process has large cgo/mmap memory the limit doesn't account for, or the live set exceeds the limit so it can't be honored.

---

## Senior

### Q13. Design a safe Go-version upgrade for a large fleet.

**Model answer.** Separate the two risk classes. (1) Upgrade the **toolchain** while keeping the `go` line — this banks compiler/runtime/security improvements with zero behavior change, because the `go` line pins compatibility defaults. Soak it. (2) Before raising the `go` line, run a canary with the *new* defaults via the `GODEBUG` env override and watch `/godebug/non-default-behavior/*` counters. (3) Raise the `go` line; for each flagged setting, either fix the root cause or temporarily pin with `//go:debug name=old` plus a tracking ticket. (4) Retire pins over subsequent releases, confirming via counters. The goal is to turn an invisible all-at-once change into observable, reversible steps.

**Common wrong answer.** "Bump the toolchain and `go` line together, run tests, ship." (Tests don't cover every gated path; this is how a TLS or `panic(nil)` change slips into production.)

**Follow-up.** *What CI guard would you add?* — Flag any change to the `go` line for extra review; it is a behavior change, not a version bump.

---

### Q14. How do you choose a `GOMEMLIMIT` value for a container?

**Model answer.** `GOMEMLIMIT = container hard limit − non-Go memory − overshoot headroom`. Non-Go memory is cgo, mmap'd files, off-heap caches — the limit doesn't see them. Overshoot headroom (5–10%) accounts for the soft limit being exceeded during bursts. For a 2 GiB container with modest cgo, ~1.6–1.8 GiB. Setting it *at* the hard limit invites the OOM killer during overshoot; setting it below the working set causes the death spiral. Pair it with a deliberate `GOGC` choice: default-plus-limit for safety, or `GOGC=off`-plus-limit to maximise throughput while still capping memory.

**Follow-up.** *How do you monitor for the death spiral?* — Alert on GC CPU fraction (`/cpu/classes/gc/total:cpu-seconds` or the `gctrace` `%`), not just RSS — RSS stays capped during a spiral, so an RSS-only alert misses it entirely.

---

### Q15. How would you wire crash handling for a production service?

**Model answer.** Two layers. For **recoverable** panics inside workers: `recover()` + `debug.Stack()` to log the goroutine and continue. For the **fatal**, unrecoverable crash of the whole process: `SetTraceback("all")` so every goroutine is dumped, plus `SetCrashOutput(file, ...)` (Go 1.23) to route the traceback to a durable sink — a file or pipe a sidecar tails — so it survives even if the logging buffer never flushed. Crashes are the events you least want to lose, and they often bypass the normal log path.

**Follow-up.** *Why not just rely on stderr?* — Stderr may be lost or unbuffered-but-truncated on a hard crash; an explicit durable fd plus a tailing sidecar gives reliable capture and alerting.

---

### Q16. Why is `vcs.modified=true` operationally significant?

**Model answer.** It means the binary was built from a tree with uncommitted changes, so its `vcs.revision` does not fully describe it — it is unreproducible. A dirty-tree build should never reach production. Surface the flag in build info and enforce a policy: fail the deploy, or at least alert. During an incident, knowing the exact, reproducible build is the first question, and a dirty build undermines that.

**Follow-up.** *Where do you surface build info?* — Structured startup logs, a `build_info` metric label, and an auth-gated `/version` endpoint. Don't expose the full `Deps` list publicly — it's a CVE-matching inventory for attackers.

---

### Q17. A compatibility setting you depend on — what's the long-term risk?

**Model answer.** Compatibility GODEBUG settings are removed after a deprecation window (typically a few releases). A setting you pinned and forgot will eventually stop existing, and then the old behavior is simply gone. So each reliance is technical debt with a known expiry. The discipline: inventory reliance via the non-default-behavior counters, track each pin to a removal date with a ticket, prefer fixing the root cause (an outdated dependency or latent bug), and watch the GODEBUG history table. The security-relevant ones — `tlsrsakex`, `x509sha1` — are most likely to bite, because they sit between "must upgrade for security" and "upgrade removes behavior we need."

**Follow-up.** *Is pinning ever the right final answer?* — No. It's always a bridge with a countdown, never a destination.

---

### Q18. You enable `gctrace=1` to investigate, but on the whole fleet. What goes wrong, and how should you have done it?

**Model answer.** Fleet-wide `gctrace` floods the log pipeline with a line per GC cycle per replica — at worst it rate-limits or drowns application logs. Diagnostic GODEBUG should be enabled **per-replica** (or on a canary), captured to a **dedicated** stderr stream, **time-boxed**, and then disabled. Because GODEBUG is startup-only, enabling it requires restarting the targeted replica — so don't trace your only replica, and plan for the connection drain. `allocfreetrace` fleet-wide would be far worse — it can take a service down.

**Follow-up.** *What's the structured alternative for continuous data?* — `runtime/metrics`; the `gctrace` text format isn't a stable API and shouldn't be parsed for dashboards.

---

## Staff / Architect

### Q19. Explain, end to end, how a GODEBUG compatibility setting's value is determined for a running binary.

**Model answer.** At **build** time, the compiler resolves the effective default from (increasing precedence) the main module's `go` line → `godebug` directives in `go.mod` → `//go:debug` lines in `package main`, against the toolchain's per-release default table. The linker embeds that as the `DefaultGODEBUG` build setting in the binary (visible via `go version -m`). At **startup**, the runtime overlays the `GODEBUG` environment variable, per-setting, on those embedded defaults. Standard-library code reads the resolved value through the `internal/godebug` registry's `Setting.Value()` and branches; when it takes the old path it calls `IncNonDefault()`, which drives `/godebug/non-default-behavior/<name>:events`. The key invariant: behavior is a pure function of (source + go.mod + GODEBUG env), independent of the toolchain version — that's the compatibility guarantee.

**Follow-up.** *Why compute defaults at build time, not run time?* — The `go.mod` isn't present at runtime; the binary must carry the resolved defaults. `DefaultGODEBUG` in the build block is how.

---

### Q20. Build observability/upgrade-safety tooling around these mechanisms. What do you build?

**Model answer.** (1) **Provenance**: scrape `debug.ReadBuildInfo` into startup logs and a `build_info` metric; use `debug/buildinfo.ReadFile` to extract module versions from artifacts in CI without invoking the toolchain (feeds SBOM/CVE scanning). (2) **Upgrade safety**: continuously scrape `/godebug/non-default-behavior/*` across all environments; alert on any counter going zero→nonzero, especially post-deploy; gate `go`-line bumps on "no surprising counters in the canary under new defaults." (3) **Memory health**: alert on GC CPU fraction and cycle rate from `runtime/metrics`, not just RSS, to catch the death spiral. (4) **Build policy**: fail deploys on `vcs.modified=true` and diff the `DefaultGODEBUG` build setting across releases to detect unintended behavior changes. Throughout, read the toolchain's *outputs* (build block, metrics), don't re-derive defaults from `go.mod`.

**Follow-up.** *Why not parse `go.mod` to compute defaults yourself?* — It drifts from the actual binary across Go releases; the embedded `DefaultGODEBUG` is authoritative.

---

### Q21. When does `SetMemoryLimit` fail to keep a container under its limit despite being set correctly?

**Model answer.** The limit accounts only for runtime-managed memory — heap, stacks, runtime metadata. It is blind to: cgo allocations, mmap'd files, off-heap caches, and OS page cache attributed to the cgroup. A cgo-heavy process can satisfy its Go memory limit while total cgroup memory exceeds the container limit and triggers the OOM killer. The fix is to size the Go limit as `container − non-Go memory − headroom` and to track non-Go memory separately (e.g., cgo allocator metrics). Also, the limit is soft and bounded by the ~50% GC-CPU guard, so under extreme pressure the runtime lets memory exceed the limit rather than starve the mutator — the symptom can flip from high-GC-CPU to overshoot.

**Follow-up.** *How does `madvdontneed` relate?* — It doesn't change the limit, but it makes RSS reflect freed memory promptly, so cgroup accounting and OOM decisions aren't misled by `MADV_FREE`'s lazy reclaim.

---

### Q22. Contrast `GODEBUG` and `runtime/debug` as control surfaces and say when each is the right tool.

**Model answer.** `GODEBUG` is **external, startup-time, operator-facing**: an environment knob (plus source-level `//go:debug`/`go.mod` pins) read once at startup, no recompile, ideal for diagnostics on a deployed binary and for the compatibility contract. `runtime/debug` is **internal, any-time, program-facing**: function calls the program makes to tune the GC, cap memory, dump stacks, route crashes, and read provenance — used when the program itself must decide or react. They overlap deliberately on some controls (`GOGC`/`SetGCPercent`, `GOMEMLIMIT`/`SetMemoryLimit`): use the env var when operators should tune without a build, the call when the program computes the value. Compatibility behavior lives in `GODEBUG`; introspection and dynamic tuning live in `runtime/debug`.

**Follow-up.** *One sentence rule?* — External + startup + ops → `GODEBUG`; internal + any-time + program → `runtime/debug`.

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| When is `GODEBUG` read? | Once, at startup. |
| Change it on a running process? | No — restart. |
| What selects compatibility defaults? | The `go` line (since 1.21). |
| `//go:debug` allowed where? | Only `package main`. |
| Is `SetMemoryLimit` a hard cap? | No — soft target. |
| `GOGC` vs `GOMEMLIMIT`? | Ratio vs absolute target. |
| Reliance on old behavior, how to see? | `/godebug/non-default-behavior/*` counters. |
| `FreeOSMemory` cost? | A full GC — call sparingly. |
| `ReadBuildInfo` ok=false when? | `go run`, some tests, `-buildvcs=false`. |
| Durable crash capture? | `SetTraceback("all")` + `SetCrashOutput`. |

---

## Mock Interview Pacing

A 30-minute interview on this topic might cover:

- 0–5 min: warm-up — Q1, Q2, Q4.
- 5–15 min: middle — Q6, Q8, Q9, Q12.
- 15–25 min: a senior scenario — Q13, Q14, or Q17.
- 25–30 min: a curveball — Q19 or Q21.

If the candidate claims production Go experience, drive straight to Q14 (memory-limit sizing) and Q13 (safe upgrade) — both are field-test questions that separate readers from operators. If they have only used `gctrace` casually, stay in middle territory and probe whether they understand the compatibility system (Q6) and the limit/ratio interaction (Q8). A staff candidate should reach the end-to-end resolution (Q19) within fifteen minutes and not confuse the `go` line with the toolchain version.
