# Plugins & Dynamic Loading — Hands-on Tasks

Work through these. Linux or macOS required for the `plugin` package tasks.

---

## Task 1: First plugin

Create a host and a plugin where the plugin exports `Greet(name string) string`.

**Acceptance criteria**
- [ ] Plugin builds with `go build -buildmode=plugin`.
- [ ] Host loads and calls it via `plugin.Open` + `Lookup`.
- [ ] You document the build steps.

---

## Task 2: Multiple plugins

Build two plugins (`english.so`, `uzbek.so`) that both export `Greet`. The host loads both and prints two greetings.

**Acceptance criteria**
- [ ] Each plugin produces a different greeting.
- [ ] The host discovers plugins from a directory.
- [ ] You note that you cannot unload a plugin once opened.

---

## Task 3: Type-safe plugin interface

Define a shared `pluginapi` package with a `Plugin` interface. Make a plugin export `New() Plugin`.

**Acceptance criteria**
- [ ] Host imports `pluginapi`.
- [ ] Plugin imports the same `pluginapi`.
- [ ] Host treats the loaded plugin as `pluginapi.Plugin` (no `*concreteType` knowledge).

---

## Task 4: Cross-platform via subprocess

Build a "plugin" that's actually an executable. Communicate via stdin/stdout JSON.

**Acceptance criteria**
- [ ] Works on Windows, Linux, macOS.
- [ ] Host can call any plugin matching the protocol.
- [ ] Latency per call is measurable (likely a few ms).

---

## Task 5: gRPC plugin with `go-plugin`

Set up a minimal `hashicorp/go-plugin` example with one method.

**Acceptance criteria**
- [ ] Host can call the plugin via gRPC.
- [ ] Plugin runs as a separate subprocess.
- [ ] If the subprocess crashes, the host detects it gracefully.

---

## Task 6: WASM plugin with wazero

Write a tiny WASM module (in Rust or AssemblyScript) and host it with wazero in a Go program.

**Acceptance criteria**
- [ ] Host loads the `.wasm` file.
- [ ] Calls an exported function and gets the expected result.
- [ ] You document the WASM compilation toolchain you used.

---

## Task 7: Plugin reload

For your subprocess or RPC plugin, implement a `Reload` operation that swaps the plugin without restarting the host.

**Acceptance criteria**
- [ ] In-flight requests against the old plugin complete.
- [ ] New requests use the new plugin.
- [ ] You verify the old plugin's process exits.

---

## Task 8: Plugin discovery

Implement a `Registry` that scans a directory and loads all plugins it finds.

**Acceptance criteria**
- [ ] Drops bad plugins gracefully (with a log message).
- [ ] Calls a `Register(registry)` symbol on each successful load.
- [ ] You add a CLI command to list all loaded plugins.

---

## Task 9: Plugin crash isolation

Write a plugin that intentionally panics. Run it both as an in-process plugin and as a subprocess plugin.

**Acceptance criteria**
- [ ] In-process: host crashes too (you've verified).
- [ ] Subprocess: only the plugin dies; host survives and reports the error.
- [ ] You write a paragraph explaining the trade-off.

---

## Task 10: Plugin version negotiation

For your RPC plugin, add a `Capabilities()` method that returns supported feature flags.

**Acceptance criteria**
- [ ] Host calls `Capabilities()` first.
- [ ] If a required capability is missing, host refuses to use the plugin.
- [ ] You add at least two capabilities and version a third.

---

## Task 11: Observability

Add metrics, logs, and trace spans for every plugin call.

**Acceptance criteria**
- [ ] Counter `plugin_calls_total{plugin, method, status}`.
- [ ] Histogram `plugin_call_duration_seconds`.
- [ ] OpenTelemetry span per call, with attributes.

---

## Task 12: Resource limits

Apply a 10 MiB memory cap and a 5-second timeout to your subprocess plugin.

**Acceptance criteria**
- [ ] On Linux, `setrlimit` or cgroups applied.
- [ ] Timeout enforced via `exec.CommandContext`.
- [ ] You verify both limits trigger with deliberate misuse.

---

## Stretch — Task 13: Multi-language WASM plugin

Build the same plugin in two different languages (e.g., Go via TinyGo, and Rust). Both export the same function.

**Acceptance criteria**
- [ ] Both `.wasm` files run with the same host code.
- [ ] You document the build commands for each.
- [ ] You bench both and report the difference.

---

## Submission

Code + brief writeup per task. The goal: an informed understanding of when each plugin mechanism is appropriate.
