# GODEBUG & `runtime/debug` — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The `go` Line as a Behavior Contract](#the-go-line-as-a-behavior-contract)
3. [Designing a Go-Version Upgrade That Cannot Surprise You](#designing-a-go-version-upgrade-that-cannot-surprise-you)
4. [Memory Limits in Production: the Real Model](#memory-limits-in-production-the-real-model)
5. [The GC Death Spiral and How to Detect It](#the-gc-death-spiral-and-how-to-detect-it)
6. [`SetCrashOutput` and Crash Pipelines](#setcrashoutput-and-crash-pipelines)
7. [Build Provenance as an Operational Asset](#build-provenance-as-an-operational-asset)
8. [Operating Diagnostic GODEBUG Safely](#operating-diagnostic-godebug-safely)
9. [Compatibility Settings as Risk Management](#compatibility-settings-as-risk-management)
10. [Non-Default-Behavior Telemetry](#non-default-behavior-telemetry)
11. [Guardrails: `SetMaxThreads`, `SetMaxStack`, `SetPanicOnFault`](#guardrails-setmaxthreads-setmaxstack-setpaniconfault)
12. [Anti-Patterns](#anti-patterns)
13. [Senior-Level Checklist](#senior-level-checklist)
14. [Summary](#summary)

---

## Introduction

A senior engineer's relationship with these mechanisms is not "which function do I call" but "what do these knobs let me promise about a fleet, and what failure modes do they introduce." `GODEBUG` and `runtime/debug` are small APIs, but they sit on the two most operationally sensitive surfaces a Go service has: the garbage collector and the language's backward-compatibility contract. Misconfigure the memory limit and you trade an OOM for a latency cliff; misunderstand the `go` line and a routine toolchain bump quietly changes TLS behavior across production.

This file is about the *design and the trade-offs*. The mechanics are in [junior.md](junior.md) and [middle.md](middle.md).

After reading this you will:
- Treat the `go` line as a reviewable behavior contract and design upgrades around it
- Configure memory limits with a model of the death-spiral failure, not folklore
- Wire crash output and build provenance into your incident pipeline
- Operate diagnostic GODEBUG across a fleet without self-inflicted incidents
- Use non-default-behavior telemetry to de-risk compatibility decisions

---

## The `go` Line as a Behavior Contract

The single most important senior insight in this topic: since Go 1.21, the `go` directive in `go.mod` is a *behavior baseline selector*, not merely a minimum-version floor.

Concretely, a binary compiled by Go 1.23 from a module whose `go.mod` says `go 1.20` will, for every GODEBUG-gated decision, behave like Go 1.20. The TLS cipher suite list, `panic(nil)` semantics, `Content-Length` parsing strictness, `os/exec` path resolution — all of these resolve to their Go 1.20 defaults, regardless of the toolchain that built the binary.

The implications for how you run an organisation:

- **Toolchain upgrades become safe and boring.** You can roll the build toolchain forward across the fleet without changing any runtime behavior, because behavior is pinned by the `go` line. This decouples "use the latest compiler/security fixes/performance" from "accept new defaults."
- **`go` line changes become the audited event.** The diff that raises `go 1.20` → `go 1.23` is where compatibility risk lives. It deserves the scrutiny you would give a config change to production, not the rubber stamp a version bump usually gets.
- **Behavior is now partly declared in source.** `//go:debug` and the `godebug` go.mod directive make the old-behavior dependencies explicit and reviewable, which is strictly better than discovering them via a production incident.

A senior engineer codifies this: a CI rule that flags any change to the `go` line for extra review, plus a runbook entry explaining that toolchain bumps and `go` line bumps are *different risk classes*.

---

## Designing a Go-Version Upgrade That Cannot Surprise You

The naive upgrade ("bump the toolchain and the `go` line together, run tests, ship") works until the day a compatibility-gated change in a code path your tests do not cover reaches production. Design the upgrade so that cannot happen.

A staged approach:

1. **Upgrade the toolchain, keep the `go` line.** Build the fleet with the new Go, no behavior change. Bank the compiler, runtime, and security improvements with zero compatibility risk. Soak it.
2. **Instrument before raising the `go` line.** Before bumping the `go` line, deploy with the *new* defaults in a canary using the GODEBUG environment override, and watch the `/godebug/non-default-behavior/*` counters. A nonzero counter for a setting you are about to change is a flashing light: real code depends on the old behavior.
3. **Raise the `go` line, pin what you must.** Bump the `go` line; for each setting the canary flagged, either fix the dependency or temporarily pin it with `//go:debug name=oldval`. Pinning is a bridge, with a tracking ticket, not a destination.
4. **Remove pins deliberately.** Over subsequent releases, retire each pin as the underlying code is fixed, confirming via the counters that the old path is no longer taken.

The point is to convert an invisible, all-at-once behavior change into a sequence of small, observable, reversible steps. The `non-default-behavior` counters are what make step 2 possible — without them you are upgrading blind.

---

## Memory Limits in Production: the Real Model

`GOMEMLIMIT` / `SetMemoryLimit` is the most valuable and most misused knob here. The senior model:

The runtime targets keeping *total* memory (heap, stacks, runtime metadata) near the limit. It is **soft**: the runtime trades CPU (more frequent GC) to respect it, but never refuses an allocation to honor it. If your live working set exceeds the limit, the limit cannot be met and the GC runs continuously.

This produces a precise design rule for containers:

```
GOMEMLIMIT  =  container hard limit  −  non-Go memory  −  overshoot headroom
```

- **Non-Go memory** is anything the GC does not manage: cgo allocations, mmap'd files, OS page cache attributed to the cgroup, off-heap caches. The Go memory limit knows nothing about these; you must subtract them.
- **Overshoot headroom** accounts for the fact that the limit is soft and a burst can momentarily exceed it. Leave 5–10%.

For a 2 GiB container with modest cgo, a limit around 1.6–1.8 GiB is typical. Setting it *at* the container limit invites the OOM killer during overshoot; setting it far below wastes memory and risks the death spiral.

The complementary decision is what to do with `GOGC`:

- **Keep `GOGC` at default and add a limit:** normal ratio-driven GC, with the limit as a backstop. Safe default.
- **Set `GOGC=off` (or `SetGCPercent(-1)`) and rely solely on the limit:** the GC runs *only* to respect the limit. This maximises throughput (the heap is allowed to grow freely until it nears the ceiling) while still capping memory. Powerful for batch and throughput-bound services, but it means the heap will routinely sit near the limit — there is no "low water mark."

Both are documented, deliberate configurations. The mistake is choosing neither consciously.

---

## The GC Death Spiral and How to Detect It

The failure mode that turns the memory limit from an asset into an incident: set the limit below the program's live working set, and the runtime GCs back-to-back trying to reach a target it can never hit. CPU goes to GC, throughput collapses, latency spikes — but the process does *not* OOM, so naive memory dashboards look fine.

Detection, in order of preference:

1. **`/gc/cycles/total:gc-cycles` and GC CPU from `runtime/metrics`.** A sudden, sustained rise in GC cycle rate or `/cpu/classes/gc/total:cpu-seconds` is the signal. This is the production-grade detector.
2. **The leading `%` in `gctrace`.** If you have a replica with `gctrace=1`, a cumulative GC CPU percentage climbing into double digits after a limit change is the same signal, human-readable.
3. **`ReadGCStats` pause history.** Frequent, closely-spaced cycles in `GCStats.PauseEnd` corroborate it.

The runtime has a partial safety valve: it will not spend *more* than roughly 50% of CPU on GC to honor the limit — beyond that it lets memory exceed the limit rather than starve the program entirely. So in extremis the symptom may flip from "100% GC" to "memory creeping past the limit." Either way, the root cause is the same: the limit is below the working set.

The senior practice is to alert on GC CPU fraction, not just RSS. An RSS-only alert misses the death spiral entirely, because the whole point of the spiral is that memory stays capped while the service degrades.

---

## `SetCrashOutput` and Crash Pipelines

`runtime/debug.SetCrashOutput` (Go 1.23) lets you redirect the runtime's *crash output* — the traceback the runtime writes when a program crashes (unrecovered panic, fatal runtime error) — to a file descriptor of your choice, in addition to stderr.

```go
f, err := os.OpenFile("/var/log/app/crash.log",
    os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
if err == nil {
    debug.SetCrashOutput(f, debug.CrashOptions{})
}
```

Why this matters operationally:

- **Crashes are the events you least want to lose.** Normal logs go through your logging library; a hard crash may bypass that buffer. `SetCrashOutput` guarantees the traceback lands somewhere durable.
- **It enables a crash-monitoring sidecar.** Point the crash output at a pipe or a file a sidecar tails, and you get structured crash capture without instrumenting every panic site.
- **It composes with `SetTraceback`.** Set `SetTraceback("all")` so the captured crash includes every goroutine, then `SetCrashOutput` to route it to durable storage and your alerting pipeline.

This rounds out a crash-handling design: `recover()` + `debug.Stack()` for *recoverable* panics inside workers, and `SetTraceback` + `SetCrashOutput` for the *unrecoverable* crash of the whole process. The two cover different failure classes; a serious service uses both.

---

## Build Provenance as an Operational Asset

`ReadBuildInfo` is not a developer convenience — it is the spine of release identification. During an incident the first question is "what exactly is running?" and build info answers it authoritatively.

A senior service wires it into three places:

1. **Structured logs at startup.** Emit `vcs.revision`, `vcs.time`, `vcs.modified`, `GoVersion`, and the main module version once, at boot, in the standard log format. Now every log line is correlatable to an exact build.
2. **A metrics label.** A `build_info{revision="...", go_version="..."} 1` gauge (the Prometheus convention) lets dashboards and alerts pivot on build, and makes "which builds are in the fleet right now" a query.
3. **A `/version` (or `/debug/buildinfo`) endpoint** — auth-gated. It returns the full `BuildInfo`, including dependency versions, for forensic use.

The `vcs.modified=true` flag deserves a policy: a dirty-tree build should never reach production. Enforce it — fail the deploy, or at minimum alert — because a modified-tree binary is unreproducible and its `vcs.revision` does not fully describe it.

Security caveat repeated from junior level but with more weight at scale: the full `BuildInfo.Deps` list is a dependency inventory. Exposed publicly, it is a gift to anyone matching your versions against known CVEs. Gate the detailed endpoint; expose only a short revision publicly if anything.

---

## Operating Diagnostic GODEBUG Safely

Turning on `gctrace`, `schedtrace`, or `allocfreetrace` across a fleet is an operation, not a console command. Principles:

- **Per-replica, never fleet-wide.** Enable the trace on *one* replica (or a canary), capture, analyse, then disable. Fleet-wide `gctrace` floods your log pipeline; fleet-wide `allocfreetrace` will take a service down.
- **Capture to a dedicated stream.** Route stderr to a separate sink for the traced replica so the diagnostic noise does not pollute or rate-limit your application logs.
- **It requires a restart.** `GODEBUG` is startup-only, so enabling a trace means restarting the targeted replica. Plan for the connection drain and the loss of warm state; do not trace your only replica.
- **Have an exit plan.** A traced replica is a degraded replica (extra I/O, larger logs). Time-box it; restart back to clean config on a schedule, not "when someone remembers."

For settings you anticipate needing, expose them through your deployment config (e.g., a per-replica `GODEBUG` override surfaced in your orchestration) rather than ad-hoc `kubectl exec` edits, so the change is auditable and revertible.

---

## Compatibility Settings as Risk Management

Treat the compatibility GODEBUG settings as a risk register, not trivia. Each one your code depends on is a piece of technical debt with a known expiry: the Go team removes settings after a deprecation window (typically a few releases). A setting you pinned and forgot will, eventually, *stop existing*, and then the old behavior is simply gone.

The senior workflow:

- **Inventory your reliance.** Use the `non-default-behavior` counters in every environment to discover which compatibility paths your code actually exercises. The list is rarely what you would guess.
- **Track each reliance to a removal date.** When you pin `//go:debug x509sha1=1`, file a ticket referencing the deprecation timeline. The pin is a countdown, not a fix.
- **Prefer fixing the root cause.** Relying on SHA-1 certs, RSA key exchange, or `panic(nil)` is usually a symptom of an outdated dependency or a latent bug. The pin buys time to fix it; it does not absolve you.
- **Watch the GODEBUG history table.** `go.dev/doc/godebug` documents every setting, its default per `go` line, and its planned removal. It is release-engineering reading, not optional.

The settings most likely to bite a real service are the security-relevant ones — `tlsrsakex`, `x509sha1`, `tls10server`, and similar — because they sit between "we must upgrade for security" and "the upgrade removes a behavior we depend on." That is precisely the conflict these settings exist to manage gracefully, and precisely where ignoring them creates an outage.

---

## Non-Default-Behavior Telemetry

The `/godebug/non-default-behavior/<name>:events` counters deserve first-class telemetry treatment, not a one-off script.

- **Scrape them continuously.** Feed them into your metrics system alongside the rest of `runtime/metrics`. A counter going from zero to nonzero is a behavioral event worth a low-severity alert: "this process just took the old code path for `<name>`."
- **Correlate with deploys.** A non-default-behavior counter that lights up right after a dependency bump tells you the new dependency depends on old behavior — useful before that becomes a removal-window incident.
- **Use them as upgrade gates.** In the staged upgrade (above), the gate to raise the `go` line is "no surprising non-default-behavior counters in the canary under new defaults." That is a measurable, automatable criterion.

The subtlety to communicate to your team: a *zero* counter means "not exercised in this process's lifetime," not "not depended upon." Code paths that run only under specific inputs may never increment the counter in a short canary. Interpret zeros as "no evidence of reliance," not "proof of safety."

---

## Guardrails: `SetMaxThreads`, `SetMaxStack`, `SetPanicOnFault`

Three `runtime/debug` functions are guardrails — they convert silent runaway into loud, early failure, which is exactly what you want in production.

- **`SetMaxThreads(n)`** caps OS threads; exceeding it aborts the program with a clear message. The classic trigger is a goroutine leak where the leaked goroutines block in syscalls (each needing an OS thread). Without the cap, the process slowly exhausts the host's thread limit and takes neighbours down; with it, the offending process dies fast and observably. Set it generously above your real maximum but below "this will hurt the host."
- **`SetMaxStack(n)`** caps a single goroutine's stack. Runaway recursion otherwise grows a stack until the process is killed; with the cap, the offending goroutine aborts the program at a defined point. The default is already large (1 GB on 64-bit); lower it only with a specific reason.
- **`SetPanicOnFault(true)`** turns an unexpected memory fault (touching an unmapped page) into a recoverable panic on the faulting goroutine instead of a process crash. The real use case is memory-mapped files: if the file is truncated under you, you can recover and degrade gracefully rather than crash. Scope it tightly — set it around the mmap-touching code and reset it after.

These are not tuning knobs; they are blast-radius limiters. A senior service sets `SetMaxThreads` defensively, leaves `SetMaxStack` at default unless profiling says otherwise, and uses `SetPanicOnFault` only where mmap'd memory is genuinely in play.

---

## Anti-Patterns

- **Bumping the `go` line and the toolchain in one unreviewed commit.** Conflates two risk classes; the behavior change rides in unnoticed.
- **Setting `GOMEMLIMIT` at the container's hard limit.** No overshoot headroom; the OOM killer wins during bursts.
- **Setting `GOMEMLIMIT` below the working set.** Trades an OOM for a GC death spiral that RSS dashboards do not show.
- **Alerting on RSS but not GC CPU fraction.** Misses the death spiral entirely.
- **Calling `FreeOSMemory` on a timer.** Forces full GCs that fight the collector; `GOMEMLIMIT` + `madvdontneed` is the right lever.
- **Pinning a compatibility GODEBUG and forgetting it.** The setting will be removed after its deprecation window; the pin is a countdown without a ticket.
- **Disabling GC (`SetGCPercent(-1)`) in a long-lived service.** Memory grows unbounded; this is for short-lived tools.
- **Enabling `gctrace`/`allocfreetrace` fleet-wide.** Floods logs at best, takes the service down at worst.
- **Exposing full `BuildInfo.Deps` publicly.** Hands attackers a CVE-matching inventory.
- **Shipping a `vcs.modified=true` build.** Unreproducible; its revision does not describe it.
- **Treating `non-default-behavior` zeros as proof of safety.** They mean "not exercised," not "not depended upon."
- **Hard-coding `SetMemoryLimit` while ops also sets `GOMEMLIMIT`.** The call overrides the operator's knob silently.

---

## Senior-Level Checklist

- [ ] Treat the `go` line as a reviewed behavior contract; flag its changes in CI
- [ ] Stage Go upgrades: toolchain first, `go` line second, instrument in between
- [ ] Set `GOMEMLIMIT` = hard limit − non-Go memory − overshoot headroom
- [ ] Choose `GOGC` default-plus-limit vs `GOGC=off`-plus-limit deliberately
- [ ] Alert on GC CPU fraction, not just RSS, to catch the death spiral
- [ ] Wire `SetCrashOutput` + `SetTraceback("all")` into a durable crash sink
- [ ] Emit build provenance to logs, a metric, and an auth-gated endpoint
- [ ] Enforce "no `vcs.modified=true` in production"
- [ ] Run diagnostic GODEBUG per-replica, time-boxed, on a dedicated log stream
- [ ] Inventory compatibility-setting reliance via non-default-behavior counters
- [ ] Track each pinned compatibility setting to a removal date with a ticket
- [ ] Set `SetMaxThreads` as a defensive blast-radius limiter

---

## Summary

At senior level, `GODEBUG` and `runtime/debug` are two operationally loaded surfaces dressed as small APIs. The defining insight is that the `go` line is a *behavior contract*: it pins every compatibility-gated default, which makes toolchain upgrades safe and `go`-line bumps the real risk event — to be staged, instrumented with `non-default-behavior` counters, and pinned-then-unpinned deliberately. The memory limit is a soft target whose correct value is the container limit minus non-Go memory minus overshoot headroom; set it too low and you swap an OOM for a GC death spiral that only a GC-CPU alert (not an RSS alert) will catch. `SetCrashOutput` and `SetTraceback` route unrecoverable crashes to durable storage; `ReadBuildInfo` anchors every log and incident to an exact, reproducible build; and the guardrail functions (`SetMaxThreads`, `SetMaxStack`, `SetPanicOnFault`) cap blast radius.

The through-line: external operator-facing control lives in `GODEBUG` and the `go` line; internal program-facing control lives in `runtime/debug`. A senior engineer designs both into the service from the start — provenance, memory policy, crash capture, and a measured upgrade process — so that the runtime is observable and steerable *before* the incident that requires it, not improvised during one.
