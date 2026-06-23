# `GOMAXPROCS` — Specification

## Table of Contents
1. [Scope](#scope)
2. [Public API](#public-api)
3. [Default Behaviour](#default-behaviour)
4. [Environment Variable](#environment-variable)
5. [Precedence Rules](#precedence-rules)
6. [Cgroup Detection](#cgroup-detection)
7. [STW Semantics](#stw-semantics)
8. [Concurrency Guarantees](#concurrency-guarantees)
9. [Platform-Specific Behaviour](#platform-specific-behaviour)
10. [Compatibility and History](#compatibility-and-history)
11. [Self-Assessment](#self-assessment)

---

## Scope

This document specifies the observable behaviour of `runtime.GOMAXPROCS` and the runtime mechanisms that derive its default. It covers Go 1.5 through Go 1.23, calling out version-introduction points for changes. It does not document internal runtime data structures (`p`, `allp`); see [professional.md](professional.md) for that.

The specification reflects the documented `runtime` package, the `GODEBUG` envvar reference, and observable runtime behaviour. Where the source disagrees with the documentation, the source wins — but those cases are rare and noted.

---

## Public API

The function lives in `runtime`:

```go
func GOMAXPROCS(n int) int
```

**Contract:**

- If `n > 0`, the function sets the parallelism cap to `n` and returns the previous value.
- If `n <= 0`, the function returns the current value without changing it.
- The returned value is always the value that was in effect immediately before the call.
- Setting to the current value is a no-op (no STW, no observable change).

**Thread safety:** the function is safe to call from any goroutine. Internally it acquires `sched.lock` briefly.

**Return value precondition:** the return value is meaningful only after `main.main` has started. Before that (during `runtime.main` initialisation), the value may be the unconfigured default.

---

## Default Behaviour

### Before Go 1.5

The default value was **`1`**. Programs needed to explicitly call `runtime.GOMAXPROCS(N)` or set the env var to enable parallelism.

### Go 1.5 and later

The default value is `runtime.NumCPU()`.

**`runtime.NumCPU()` definition:**

- On Linux: the number of logical CPUs available to the calling thread, as returned by `sched_getaffinity` — **and** as constrained by the process's CPU cgroup quota, since Go 1.16 (cgroup v1) / 1.18 (cgroup v2).
- On Darwin (macOS): the number of logical CPUs visible to the process, as returned by `sysctlbyname("hw.logicalcpu")`.
- On Windows: the number of logical processors in the active processor group.
- On other platforms: the platform-native CPU count.

`NumCPU()` is computed once at startup and cached. Subsequent calls return the cached value.

---

## Environment Variable

`GOMAXPROCS` may be set via the `GOMAXPROCS` environment variable:

- Read by the runtime once at startup.
- Parsed as a base-10 signed integer.
- If the value is a positive integer, it is used as the initial `GOMAXPROCS`, overriding the cgroup-derived default.
- If the value is zero, negative, or unparsable, it is **ignored** and the default is used.
- The env var is honoured before any code in `main.main` runs.

**Important:** if `GOMAXPROCS` env var is set, it overrides cgroup detection. A pod with `cpu: 1` but `GOMAXPROCS=64` will see `runtime.GOMAXPROCS(0) == 64`.

---

## Precedence Rules

In order from highest precedence to lowest:

1. **Explicit calls to `runtime.GOMAXPROCS(n)`** in user code. Last write wins.
2. **`GOMAXPROCS` environment variable** at process startup.
3. **Cgroup-derived default** (Linux ≥ 1.16/1.18). Computed from `cpu.max` or `cpu.cfs_quota_us` / `cpu.cfs_period_us`.
4. **CPU affinity (`sched_getaffinity`)** if cgroup detection produces no usable result.
5. **Platform CPU count** as a final fallback.

`automaxprocs` operates at level 1 (it calls `runtime.GOMAXPROCS`) but in an `init()` function — so it runs before `main.main`, after the env-var-derived default has been applied. If the env var is set, `automaxprocs` does not override (by default).

---

## Cgroup Detection

### cgroup v1

The runtime reads:

- `/sys/fs/cgroup/cpu,cpuacct/<group>/cpu.cfs_quota_us`
- `/sys/fs/cgroup/cpu,cpuacct/<group>/cpu.cfs_period_us`

The `<group>` path is determined by parsing `/proc/self/cgroup` and `/proc/self/mountinfo`.

- If `cpu.cfs_quota_us` is `-1`, no quota; fall back to affinity.
- Otherwise, `ceil(quota_us / period_us)`, clamped to `>= 1`.

Introduced in Go 1.16 (February 2021).

### cgroup v2

The runtime reads:

- `/sys/fs/cgroup/cpu.max` (or the subpath determined from `/proc/self/cgroup`).

Format: two space-separated tokens — `<quota> <period>`. A quota of `max` means no limit.

If a quota is set, compute `ceil(quota / period)`, clamped to `>= 1`.

Introduced in Go 1.18 (March 2022).

### Failure modes

If cgroup files are unreadable (permission errors, missing mounts), the runtime falls back silently to affinity-based detection. There is no error or warning surfaced to user code.

The `automaxprocs` library will optionally log a warning. The standard runtime will not.

---

## STW Semantics

Calling `runtime.GOMAXPROCS(n)` with `n > 0` and `n != current`:

- Triggers a stop-the-world pause.
- All running goroutines are paused at safe points.
- The runtime resizes the internal P table (adds or removes `p` structs).
- The world is restarted.

**Cost:** typically tens to hundreds of microseconds for a healthy process. The cost grows with the number of goroutines (more safe points to wait for) and is bounded by async preemption (Go 1.14+).

**Visibility in traces:** STW for `GOMAXPROCS` is recorded with reason `stwGOMAXPROCS`. Visible in `runtime/trace` and `GODEBUG=gctrace=1` output.

**No-op fast path:** `runtime.GOMAXPROCS(n)` with `n == current` does **not** STW. It only acquires `sched.lock` briefly to read the current value.

**Special platforms:**

- On `wasip1` and `js/wasm`, `GOMAXPROCS` is always 1; the function returns 1 and ignores the argument.

---

## Concurrency Guarantees

- Multiple goroutines may call `GOMAXPROCS` concurrently. The runtime serialises them via `sched.lock`. Each call sees a consistent snapshot.
- Reads from `runtime.GOMAXPROCS(0)` are atomic and lock-free in the fast path (the lock is acquired only to provide the precise "previous value" semantics on writes).
- A call to `runtime.GOMAXPROCS(0)` is **guaranteed** to return a value consistent with the most recent completed write across all goroutines.

---

## Platform-Specific Behaviour

### Linux

Full support. cgroup-aware defaults. `sched_getaffinity` respected.

### Darwin (macOS)

No cgroup detection (the OS does not use cgroups). `NumCPU` returns logical CPUs as visible to the process. Default `GOMAXPROCS = NumCPU`.

### Windows

No cgroup equivalent. `NumCPU` returns the count from `GetActiveProcessorCount`. Default `GOMAXPROCS = NumCPU`.

Windows job objects can limit CPU; Go does not detect this. Set `GOMAXPROCS` manually.

### FreeBSD, OpenBSD, NetBSD

`NumCPU` returns the platform-native count. No quota detection.

### `wasip1`, `js/wasm`

Always single-threaded. `GOMAXPROCS = 1`, immutable.

### Solaris / illumos

`NumCPU` via `sysconf(_SC_NPROCESSORS_ONLN)`. No quota detection.

### Android

Same as Linux for cgroup detection. App-level CPU governors are not detected.

---

## Compatibility and History

| Version | Date | Change |
|---|---|---|
| 1.0 | 2012-03 | `GOMAXPROCS` exists; default = 1. |
| 1.1 | 2013-04 | GMP scheduler; P count tracks `GOMAXPROCS`. |
| 1.5 | 2015-08 | Default = `NumCPU()`. |
| 1.14 | 2020-02 | Async preemption bounds STW for `GOMAXPROCS` resizes. |
| 1.16 | 2021-02 | cgroup v1 quota detection on Linux. |
| 1.18 | 2022-03 | cgroup v2 quota detection on Linux. |
| 1.21 | 2023-08 | `runtime/metrics` exposes `/sched/gomaxprocs:threads`. |
| 1.22 | 2024-02 | Minor improvements to cgroup parsing robustness. |
| 1.23 | 2024-08 | Documentation clarifications; no behaviour change. |

**Deprecation guarantees:** the Go 1 compatibility promise covers `runtime.GOMAXPROCS`. The function will not be removed. Its semantics may be refined but not broken.

---

## Self-Assessment

- [ ] I can state the default `GOMAXPROCS` value for each Go version 1.0 to 1.23.
- [ ] I know the precedence order: explicit call → env var → cgroup → affinity → CPU count.
- [ ] I know which cgroup files Go reads and when (v1 from 1.16, v2 from 1.18).
- [ ] I can describe the STW semantics including the no-op fast path.
- [ ] I know platform-specific defaults for Linux, Darwin, Windows, and wasm.
- [ ] I can read `runtime.GOMAXPROCS(0)` and explain why the argument must be non-positive.

---

This specification is the contract; the runtime is the implementation. When the two disagree, file an issue at golang.org/issue. As of Go 1.23, the contract above is accurate.
