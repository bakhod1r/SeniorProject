# Plugins & Dynamic Loading — Find the Bug

Realistic plugin bugs with cause and fix.

---

## Bug 1: Type assertion panics on plugin load

```go
sym, _ := p.Lookup("Handler")
h := sym.(*Handler)   // panic: interface conversion
```

**Symptom.** Panic at type assertion.

**Cause.** The plugin's `*Handler` is a different type from the host's `*Handler` — they came from different vendored copies of the same package.

**Fix.** Ensure host and plugin use the **same on-disk copy** of the shared package. Build together from one module tree; don't vendor independently.

---

## Bug 2: `plugin.Open` fails with cryptic error

```
plugin.Open("foo.so"): plugin was built with a different version of package golang.org/x/sys/unix
```

**Cause.** Host and plugin built with different versions of a dependency.

**Fix.** Use a single `go.mod` for host and plugins. Build both with the same `go build -mod=readonly` invocation. Update both together when bumping dependencies.

---

## Bug 3: Plugin works on macOS, fails on Linux

```
plugin.Open("foo.so"): plugin.Open("foo"): /lib64/ld-linux-x86-64.so.2: bad ELF interpreter
```

**Cause.** Plugin built on macOS, deployed on Linux. Mach-O `.so` won't load on Linux.

**Fix.** Build plugins for the target platform:

```bash
GOOS=linux GOARCH=amd64 go build -buildmode=plugin -o foo-linux-amd64.so ./pkg/foo
```

---

## Bug 4: Plugin compiles but `Open` reports symbol missing

```
plugin: symbol Greet not found in plugin foo.so
```

**Cause.** The symbol isn't exported (lowercase) or wasn't compiled into the plugin (dead-code elimination removed it).

**Fix.** Ensure the symbol is capitalized, declared at package scope, and reachable from `init()` or referenced by another exported symbol.

---

## Bug 5: Plugin Init runs at unexpected time

```go
// plugin.go
func init() {
    db.Connect()    // runs at plugin.Open, before host has set up env
}
```

**Symptom.** Plugin's `init()` runs and fails because the host hasn't fully initialized.

**Cause.** `plugin.Open` invokes the plugin's `init()` synchronously.

**Fix.** Don't put startup logic in `init`. Use an explicit `Init()` function the host calls after `Open`.

---

## Bug 6: Old plugin loaded but new code expected

```go
plugin.Open("foo.so")
```

**Symptom.** Behavior matches the previous plugin version, not the latest.

**Cause.** The OS still has the old `.so` mapped in memory; reopening doesn't reload. Or you opened the wrong path.

**Fix.** Restart the host. For hot reload, use RPC plugins or WASM (both support genuine reloading).

---

## Bug 7: Plugin in panics; takes down host

```
panic: runtime error in plugin
```

**Symptom.** Host process dies because of a plugin panic.

**Cause.** In-process plugins (`plugin`, `c-shared`) share fate with the host. A panic in the plugin propagates.

**Fix.** Either:

- Wrap calls into the plugin with `recover()` (partial mitigation; can't recover from memory corruption).
- Move to out-of-process plugins (RPC, WASM, subprocess).

---

## Bug 8: gRPC plugin times out

```go
client := plugin.NewClient(&plugin.ClientConfig{...})
rpcClient, _ := client.Client()
// hangs here
```

**Symptom.** Host waits indefinitely.

**Cause.** Plugin subprocess crashed before completing the handshake, or the handshake config (`MagicCookieKey`/`Value`) doesn't match what the plugin expects.

**Fix.** Set the handshake config identically in host and plugin. Check the plugin process is actually launching (check its `os.Stderr`).

---

## Bug 9: Plugin reload leaves zombie subprocesses

```go
oldClient := s.client
s.client = newClient(...)
// forgot oldClient.Kill()
```

**Symptom.** Subprocess count grows over time.

**Cause.** Old `go-plugin` client wasn't `Kill()`ed.

**Fix.** Always `defer oldClient.Kill()` (or explicit kill before discard).

---

## Bug 10: WASM plugin reads garbage from host

```
goCallback called with len=42 from WASM
data: [random bytes]
```

**Cause.** Pointer/length pair passed from WASM uses WASM's linear memory; the host must read from `module.Memory()`, not from a Go pointer.

**Fix.**

```go
mem := mod.Memory()
data, ok := mem.Read(ptr, uint32(length))
if !ok { return errors.New("bad memory range") }
```

---

## Bug 11: Plugin's view of time differs from host

Plugin sees old time, host sees new. The plugin caches a `time.Time` at init.

**Cause.** `init()` ran when the plugin was loaded, not when used.

**Fix.** Refresh time on each call; don't cache time across calls.

---

## Bug 12: Different Go versions

```
plugin.Open: plugin was built with a different version of package runtime
```

**Cause.** Host uses Go 1.24; plugin built with 1.23.

**Fix.** Pin the Go toolchain version via `go.mod`'s `go` directive (and `GOTOOLCHAIN`). Build everything with the same version.

---

## Bug 13: Plugin runs but consumes 100% CPU

A plugin goroutine spins after the function returns.

**Cause.** The plugin spawned a background goroutine that nothing stops. In-process plugins share the goroutine namespace with the host.

**Fix.** Document the plugin contract: "must not leave goroutines running after a call". Or move to out-of-process plugins where the OS reaps the subprocess.

---

## 14. Summary

Plugin bugs cluster around: build-time mismatches (Go version, vendored deps), platform differences (Linux vs macOS .so), in-process fate-sharing (panics, goroutine leaks), and forgetting to kill old subprocesses. Each is a design issue; choose the right mechanism for the use case and build CI checks for version consistency.

---

## Further reading
- `plugin` package known issues: https://pkg.go.dev/plugin
- `go-plugin` troubleshooting
