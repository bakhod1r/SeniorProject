# The `plugin` Package — Find the Bug

Specific, realistic bugs that surface only when using the `plugin` package. For each: the symptom, the root cause, and the fix.

---

## Bug 1: "plugin was built with a different version of package X"

```
plugin.Open("./filter.so"): plugin was built with a different version of package myproject/pluginapi
```

**Symptom.** `Open` fails immediately.

**Cause.** The bytes of `pluginapi` seen by the plugin compiler differ from the bytes seen by the host compiler. Common reasons:

- Two `go.mod` files vendoring the same module separately.
- A `replace` directive in one module but not the other.
- Stale generated code (e.g., `protoc-gen-go` output) committed in one tree but not the other.
- The plugin was rebuilt after a `pluginapi` change but the host wasn't.

**Fix.** Build host and plugin from a single module checkout, in the same CI step, with identical flags. Bump both whenever `pluginapi` changes.

---

## Bug 2: Symbol not found despite being in the source

```
plugin: symbol Apply not found in plugin filter.so
```

**Symptom.** `Lookup("Apply")` fails.

**Cause.** One of:

- `Apply` is lowercase (`apply`) — Go's normal export rules apply.
- `Apply` is declared at file scope inside a struct method, not at package scope.
- The linker dead-code eliminated `Apply` because nothing in the plugin references it.

**Fix.** Capitalize. Move to package scope. Reference it from an exported holder so the linker keeps it:

```go
// Keep Apply reachable from an exported variable so the linker keeps it.
var _ = Apply

func Apply(r *Request) (*Response, error) { ... }
```

---

## Bug 3: Type assertion panics at "X is not X"

```
panic: interface conversion: ... is myproject/pluginapi.Plugin, not myproject/pluginapi.Plugin
```

**Symptom.** A loaded value cannot be asserted to its declared interface, even though the names match.

**Cause.** Two distinct copies of `pluginapi` were compiled into host and plugin. The runtime sees two `*runtime._type` values for what looks like the same type.

**Fix.** Find the duplicate. Use:

```bash
go build -buildmode=plugin -gcflags="all=-m=2" -o filter.so ./plugins/filter 2>&1 | grep pluginapi
```

Hunt down the second copy (`vendor/` directory, replaced module, alternative build root). Eliminate it. Only one copy of `pluginapi` may exist on disk per build.

---

## Bug 4: Plugin `Open` succeeds but `init` panicked

```
panic: dial tcp: connect: connection refused

goroutine 1 [running]:
myproject/plugins/sink.init.0()
        plugins/sink/sink.go:23 +0x...
plugin.lastmoduleinit(...)
plugin.Open(...)
main.main()
```

**Symptom.** Host crashes at startup. Stack trace shows the panic came from `plugin.Open` but the actual cause is in the plugin's `init`.

**Cause.** The plugin's `init` connected to an external service that wasn't ready. `Open` runs `init` synchronously; a panic in `init` propagates out.

**Fix.** Move I/O out of `init`. Expose an explicit `Initialize(ctx context.Context) error` symbol that the host calls after `Open`:

```go
func Initialize(ctx context.Context) error {
    conn, err := net.DialContext(ctx, "tcp", "sink:9000")
    if err != nil { return err }
    // ...
    return nil
}
```

---

## Bug 5: Plugin compiles but host's `plugin.Open` fails with "no such file or directory"

```
plugin.Open("./filter.so"): realpath failed
```

**Symptom.** The file is right there in `ls`, but `Open` can't find it.

**Cause.** Path resolution is relative to the **process's current working directory**, not the host binary's directory. The same `./filter.so` works in one shell and fails in another.

**Fix.** Always pass absolute paths to `plugin.Open`. If you need the binary's directory:

```go
exePath, _ := os.Executable()
exeDir := filepath.Dir(exePath)
pluginPath := filepath.Join(exeDir, "plugins", "filter.so")
p, err := plugin.Open(pluginPath)
```

---

## Bug 6: Two plugins export the same symbol; only one wins

```go
// plugin alpha
func Init() { registry.Register("alpha", ...) }

// plugin beta — same Init name
func Init() { registry.Register("beta", ...) }
```

**Symptom.** Both plugins load, both `Lookup("Init")` calls succeed, but only one plugin appears in the registry.

**Cause.** Confusion in the host code that "reuses" a single `Init` symbol name. Each plugin's `Init` is a *different* function — they don't conflict at the linker level — but if the host calls `Init` only once for some reason, only one runs.

**Fix.** Always namespace by plugin handle:

```go
for _, path := range paths {
    p, _ := plugin.Open(path)
    sym, _ := p.Lookup("Init")
    sym.(func())()
}
```

Each `sym` is bound to its own plugin; no symbol is "shared".

---

## Bug 7: Stale `.so` on disk after rebuild

```bash
go build -buildmode=plugin -o filter.so ./plugins/filter
./host
# behavior is from the OLD filter.so
```

**Symptom.** You edited the plugin, rebuilt, and ran the host — but the host's output proves it loaded the previous version.

**Cause.** Possibilities:

1. The build didn't actually emit a new `filter.so` (compile error swallowed somewhere).
2. The host loaded `filter.so` from a different directory than the one you rebuilt into.
3. A copy step in your `Makefile` failed silently.

**Fix.** Diagnose mechanically:

```bash
stat -f "%m %N" filter.so   # macOS; check mtime
md5sum filter.so            # Linux; check content hash
```

If the mtime is old, your build didn't run. If the hash is wrong, you're loading the wrong file. Always pass absolute paths and log them at `Open` time.

---

## Bug 8: "plugin already loaded" error on re-open

```go
p1, _ := plugin.Open("./filter.so")
p2, _ := plugin.Open("./filter.so")
// p2 == p1, no error — but you wanted a "fresh" copy
```

**Symptom.** You hoped to reload an edited `.so`; instead the host still sees the old code.

**Cause.** `plugin.Open` is idempotent. Once a path is loaded, subsequent calls return the cached `*Plugin`. The OS does not reload the file.

**Fix.** There is **no way** to reload a plugin in the same process. You must restart the host. If you need hot reload, use a different mechanism (RPC subprocess, WASM) — see [08-plugins-dynamic-loading](../08-plugins-dynamic-loading/).

---

## Bug 9: Plugin built on macOS, deployed on Linux

```
plugin.Open("./filter.so"): plugin.Open("filter"): /lib64/ld-linux-x86-64.so.2: bad ELF interpreter
```

**Symptom.** Works on developer's MacBook, fails in the production Linux container.

**Cause.** The plugin is a Mach-O binary; the Linux dynamic loader rejects it.

**Fix.** Build for the deployment target:

```bash
GOOS=linux GOARCH=amd64 \
    go build -buildmode=plugin -o filter-linux-amd64.so ./plugins/filter
```

Or, simpler, do all builds in a Linux CI runner that matches production.

---

## Bug 10: Reflection-based code path fails on plugin types

```go
// host
sym, _ := p.Lookup("Settings")
settings := sym.(*pluginapi.Settings)

t := reflect.TypeOf(settings).Elem()
fields := reflect.VisibleFields(t)
// fields look right...

val := reflect.New(t).Elem()
// ...but assigning val back to settings panics
```

**Symptom.** Reflection sees what looks like the same type, but using it produces "assignment to entry in nil map" or "wrong type" panics.

**Cause.** Two non-unified type pointers for `pluginapi.Settings`. They print the same name but compare unequal via `==`. The reflection allocation came from the host's type; the plugin's pointer came from the plugin's type.

**Fix.** Don't allocate plugin-defined types from the host via reflection. Let the plugin allocate via its own `New() *Settings` function, and treat the value as opaque (only call its methods).

---

## Bug 11: Plugin file `Open` succeeds but link error during first call

```
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=0x...]
```

**Symptom.** `Open` reports success, `Lookup` reports success, but the very first call segfaults.

**Cause.** Most commonly: the plugin imports a package that the host does not, and that package's `init` is required for the function to work — but a hash mismatch silently caused the runtime to skip re-initialization. The looked-up function references an uninitialized global.

**Fix.** Audit the imports. The plugin should import only what the host imports, plus whatever the plugin uniquely needs. Use `go list -deps ./plugins/filter` and `go list -deps ./cmd/host` and compare.

---

## Bug 12: Different Go toolchain versions

```
plugin.Open: plugin was built with a different version of package runtime
```

**Symptom.** `Open` fails with `runtime` named explicitly as the mismatching package.

**Cause.** Host built with one Go version (say, 1.22.3), plugin built with another (1.22.5). The `runtime` package's bytes change between minor versions.

**Fix.** Pin the toolchain. In `go.mod`:

```
go 1.22.5
toolchain go1.22.5
```

In CI, use `go-version-file: 'go.mod'`. For local development, install via `GOTOOLCHAIN=go1.22.5 go build ...` and document this in `CONTRIBUTING.md`.

---

## Bug 13: Plugin leaves a goroutine running after each call

```go
// plugin
func Apply(r *Request) *Response {
    ch := make(chan *Response, 1)
    go func() {
        ch <- compute(r)
    }()
    return <-ch    // looks fine, but ...
}
```

**Symptom.** After many calls the process has thousands of goroutines and slow growing memory. `pprof goroutine` shows them all blocked in the plugin's code.

**Cause.** A subtle goroutine leak (here, contrived — but real plugins often start background workers and forget to stop them). Because there is no unload, every plugin-leaked goroutine accumulates forever.

**Fix.** Audit plugin code for goroutine ownership. Every spawned goroutine must have a deterministic exit. Pass a `context.Context` to plugin entry points so the plugin can shut down cooperatively. Add a periodic `runtime.NumGoroutine()` log in the host to detect drift.

---

## 14. Summary

The plugin package's bugs cluster around (1) byte-level mismatches in shared packages, (2) symbol visibility and dead-code elimination, (3) `init` doing too much, (4) platform mismatches, and (5) the "no unload" rule biting workflows that assumed reloads were possible. Most can be prevented by strict build pipeline discipline; the rest by reading error messages literally and remembering that "different version" means "different bytes".

---

## Further reading
- `plugin` package known issues: https://pkg.go.dev/plugin
- Broader plugin survey: [08-plugins-dynamic-loading](../08-plugins-dynamic-loading/)
- Go toolchain pinning: https://go.dev/doc/toolchain
