# The `plugin` Package — Hands-on Tasks

Linux, macOS, or FreeBSD required. These tasks build practical understanding of the `plugin` package's behavior, including the failure modes that bite teams in production.

---

## Task 1: First plugin and host

Create a `plugin/` package exporting `Greet(name string) string` and a host that loads and calls it.

**Acceptance criteria**
- [ ] Plugin builds with `go build -buildmode=plugin -o greeter.so ./plugin`.
- [ ] Host loads via `plugin.Open` and calls via `Lookup` + type assertion.
- [ ] You document the exact build commands.
- [ ] You confirm both binaries were built with the same `go version` output.

---

## Task 2: Design the shared API package

Set up a project with the layout: `go.mod` / `pluginapi/` / `cmd/host/` / `plugins/alpha/` / `plugins/beta/`. Define `pluginapi.Plugin` as an interface with `Name() string` and `Handle(in string) string`.

**Acceptance criteria**
- [ ] Both plugins implement `pluginapi.Plugin`.
- [ ] Each plugin exports a `New() pluginapi.Plugin` factory.
- [ ] Host treats loaded values as `pluginapi.Plugin` only; no concrete-type references.
- [ ] A Makefile or shell script builds host and both plugins in one invocation.

---

## Task 3: Directory-based plugin discovery

Extend the previous host to scan a `plugins/` directory and load every `.so` it finds. Print each loaded plugin's `Name()`.

**Acceptance criteria**
- [ ] Bad `.so` files (e.g. a renamed non-plugin binary) are skipped with a log message, not a crash.
- [ ] Missing `New` symbol is treated as a skip, not a fatal error.
- [ ] You verify a wrong-signature plugin (e.g. `New() string` instead of `New() pluginapi.Plugin`) is rejected cleanly.

---

## Task 4: Demonstrate type identity failure

Intentionally create two copies of `pluginapi` on disk and observe the panic.

**Setup:** Build a plugin from one module checkout. In a separate module, create a `pluginapi` package with the same import path but slightly different bytes (add a comment or whitespace inside a struct). Build the host from the second module.

**Acceptance criteria**
- [ ] `plugin.Open` either fails or `Lookup` succeeds but the type assertion panics.
- [ ] You capture the exact error or panic message.
- [ ] You write a paragraph explaining why the panic happens at the byte level.

---

## Task 5: Demonstrate Go-version mismatch

Build the plugin with one Go version (e.g., `go1.22.3`) and the host with another (e.g., `go1.22.5`). Use `GOTOOLCHAIN=go1.22.3 go build ...` to install a specific toolchain.

**Acceptance criteria**
- [ ] `plugin.Open` fails with a "different version of package runtime" error.
- [ ] You capture the message verbatim.
- [ ] You document the fix: pinning the toolchain in `go.mod`.

---

## Task 6: Observe `init` order

Add `log.Println("plugin init")` in your plugin's `init` and `log.Println("host main start")` at the top of the host's `main`. Place `log.Println("after Open")` after the `plugin.Open` call.

**Acceptance criteria**
- [ ] The output shows "host main start" first, "plugin init" second (inside Open), "after Open" third.
- [ ] You verify the same ordering with two plugins; each plugin's `init` runs at its own `Open`.
- [ ] You write one sentence on why this matters for plugins doing I/O in `init`.

---

## Task 7: Shared variable across the boundary

Export `var Counter int64` from a plugin and a function `Inc()` that increments it. Have the host call `Inc()` three times, then read `Counter` directly via `Lookup`.

**Acceptance criteria**
- [ ] Host reads `*int64` and sees value 3 after three increments.
- [ ] If you spawn 10 host goroutines all calling `Inc()` concurrently, `Counter` reaches 10 (use `atomic`).
- [ ] You write a paragraph on why this works (shared memory) and what it implies for plugin authors (concurrency contract).

---

## Task 8: Cached function-value pattern

Build a benchmark comparing three call patterns: (a) `Lookup` + type assertion every call, (b) cached function value, (c) cached interface value.

**Acceptance criteria**
- [ ] You use Go's `testing.B` benchmark framework.
- [ ] You report ns/op for each pattern.
- [ ] You confirm (b) and (c) are at least 100× faster than (a).
- [ ] You write a one-paragraph explanation of why.

---

## Task 9: Build ID verification

Add a `BuildID` string variable to your `pluginapi` package set via `-ldflags="-X ..."`. Build host and plugin with the same build ID; verify at load time.

**Acceptance criteria**
- [ ] Host refuses any plugin whose BuildID doesn't match.
- [ ] You intentionally build a plugin with a different ID and confirm the host rejects it cleanly.
- [ ] You document the `-ldflags` commands.

---

## Task 10: Lazy load

Implement a `lazyPlugin` wrapper that calls `plugin.Open` only on first use. Time host startup with eager loading vs lazy loading for 10 plugins.

**Acceptance criteria**
- [ ] Lazy loading reduces startup time measurably.
- [ ] First-call latency is correspondingly higher for lazy plugins.
- [ ] You implement it with `sync.Once` to keep concurrent first-callers safe.

---

## Task 11: Cannot unload — confirm it

Build a plugin. Load it. Modify the source. Rebuild the `.so`. Call `plugin.Open` again on the same path. Confirm the host still sees the old behavior.

**Acceptance criteria**
- [ ] You observe that the second `Open` returns the cached `*Plugin`.
- [ ] You verify the plugin's behavior matches the original build, not the rebuilt one.
- [ ] You document the path forward: restart the process.

---

## Task 12: Symbol-not-found diagnosis

Create three failure cases and capture the exact error message for each:

1. A symbol declared with lowercase (`apply` instead of `Apply`).
2. A symbol that's only referenced inside another unexported function (potential dead-code elimination).
3. A symbol that doesn't exist at all (typo in the host's `Lookup` call).

**Acceptance criteria**
- [ ] You capture all three error messages.
- [ ] You explain why case 2 may or may not fail depending on linker behavior.
- [ ] You demonstrate the fix for case 2 by referencing the symbol from an exported variable.

---

## Stretch — Task 13: Real plugin ecosystem

Build a small text-processing pipeline where the host loads N plugins, each implementing `pluginapi.Processor` with `Process(s string) string`. The host pipes input through every loaded plugin in sequence.

**Acceptance criteria**
- [ ] At least three distinct plugins (e.g., uppercase, reverse, base64).
- [ ] Plugins are loaded from a directory at startup.
- [ ] Order of application matches alphabetical filename order (deterministic).
- [ ] You add structured logging for each load (path, build ID, name) and each call.
- [ ] You measure the per-call overhead and report it.

---

## Submission

For each task, submit: (a) the code, (b) the build commands you ran, (c) any output you captured (especially error messages — they are part of the learning), (d) a short writeup of what surprised you.

The goal of these tasks is not to ship plugin-based software, but to build the muscle memory for diagnosing the `plugin` package's failure modes — so you can recognize them on sight when they appear in real codebases.
