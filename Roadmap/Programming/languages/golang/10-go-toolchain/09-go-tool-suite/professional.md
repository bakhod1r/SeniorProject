# go tool — Professional

## 1. How the suite is built and shipped

The Go distribution bootstraps itself through `cmd/dist`. In source, every helper tool lives under `src/cmd/<name>/`:

```
src/cmd/asm/       src/cmd/buildid/  src/cmd/cgo/        src/cmd/compile/
src/cmd/cover/     src/cmd/dist/     src/cmd/fix/        src/cmd/link/
src/cmd/nm/        src/cmd/objdump/  src/cmd/pack/       src/cmd/pprof/
src/cmd/test2json/ src/cmd/trace/    src/cmd/addr2line/  ...
```

`cmd/dist` is special: it is the bootstrap builder that compiles all other tools and lays them down in `$GOROOT/pkg/tool/<GOOS_GOARCH>/`. The `go` driver locates them by reading `$GOTOOLDIR` (default: `$GOROOT/pkg/tool/<host>`). That is the entire installation mechanism — there is no plugin registry, no path manipulation, no environment magic beyond two variables.

```bash
go env GOROOT GOTOOLDIR
```

---

## 2. Why some tools are "internal-only" in spirit

`compile`, `link`, `asm`, `pack`, `cgo` are part of the **build contract**: they accept very specific inputs that the `go` driver constructs (`-importcfg` files listing every imported package's archive path, `-buildid` strings, search paths, etc.). They are public in the sense that you can run them, but their command line is a private interface between `cmd/go` and the toolchain. Two consequences for a professional:

- Treat their flags as **unstable** across Go releases. Each release can rearrange them. Even `go tool compile -h` warns you off direct use.
- If you must intercept them (e.g., for caching, distributed builds, instrumentation), the supported entry is **`go build -toolexec=PROGRAM`** — `cmd/go` invokes `PROGRAM <tool> <args...>`, letting you wrap each call without owning the action graph.

```bash
go build -toolexec='/usr/local/bin/my-wrapper' ./...
```

---

## 3. Sources and architectural notes

A few worth reading in source when you operate at this level:

| Path | Why |
|------|-----|
| `src/cmd/go/internal/work/exec.go` | The action graph: who calls `compile`, who calls `link`, in what order |
| `src/cmd/dist/build.go` | How the toolchain is bootstrapped and installed into `pkg/tool/` |
| `src/cmd/cover/` | How `-cover` instrumentation rewrites packages at build time |
| `src/cmd/pprof/` | A thin wrapper around `github.com/google/pprof` (vendored) |
| `src/cmd/trace/` | The HTTP server + frontend for runtime traces |

Reading `exec.go` once is high leverage: it makes every later "what does `go build` actually do?" question concrete.

---

## 4. `pprof` and `trace` are thin façades

`go tool pprof` is a vendored copy of [google/pprof](https://github.com/google/pprof) with a Go-toolchain entrypoint. Behavior, flags, and the interactive prompt are upstream's. A standalone `pprof` you install from upstream is broadly compatible; the Go-bundled one is **pinned** to a version known to work with that toolchain release.

`go tool trace` is a small HTTP server that parses the runtime trace format (`runtime/trace.Start`) and serves the interactive viewer. The trace format is **versioned**; new Go releases evolve it (notably the rewrite around Go 1.21–1.22), and traces collected on a newer runtime may not open in an older `go tool trace`. Document the Go version next to any archived trace.

---

## 5. Deprecation lifecycle

Tools come and go across releases. Two examples to keep in mind:

- **`go tool vet`** — gone. Vet is now an analyzer suite invoked by `go vet` (or `go test`, which runs a vet subset automatically). Older scripts that call `go tool vet` will fail.
- **`go tool yacc`** — removed long ago; replaced by external `goyacc`.
- **`covdata`** — added with the integration-coverage rework around Go 1.20; older toolchains do not have it.

The right policy is to assume `go tool` is **toolchain-versioned**: build a tool catalog test in CI that asserts the tools you rely on are present in the pinned toolchain.

```bash
go tool 2>/dev/null | grep -E '^(pprof|trace|cover|nm|objdump|buildid)$' \
  | wc -l | xargs -I{} test {} -eq 6
```

---

## 6. Wrappers, intercepts, and caches

Three professional patterns for plugging into the suite:

1. **`-toolexec`** — wrap every per-tool invocation. Used by tools like `xcaddy`, custom code-signing, deterministic-builder sandboxes, and remote-build systems.
2. **`GOTOOLCHAIN`** — pin the exact toolchain (e.g., `GOTOOLCHAIN=go1.22.3`) so the entire suite (including pprof/trace) is reproducible across machines.
3. **`GOFLAGS`** — global defaults for every `go` invocation (e.g., `GOFLAGS=-trimpath -buildvcs=false`) that propagate to `go tool ...` where applicable.

```bash
export GOTOOLCHAIN=go1.22.3
export GOFLAGS="-trimpath -mod=readonly"
```

---

## 7. Distribution sanity in CI

Some failures are not "your code is wrong" but "the toolchain on this runner is not what you think":

```bash
go version
go env GOROOT GOTOOLDIR GOTOOLCHAIN GOFLAGS
ls "$(go env GOTOOLDIR)"
```

Print this at the top of CI jobs that use `go tool ...` extensively. It saves hours when a runner image silently upgrades Go and removes a tool you depended on.

---

## 8. Security posture

The tools execute as the invoking user with full filesystem access. Hardening points:

- **Untrusted inputs**: `pprof` and `trace` parse externally-provided files; treat profiles/traces from outside your org as untrusted input. The viewer also opens an HTTP server on localhost — make sure it is bound to loopback in shared environments.
- **`-toolexec` programs** receive every compile/link invocation. They are an excellent supply-chain choke point and also an excellent attack surface; review them carefully.
- **`buildid` lying** — `go tool buildid -w` can rewrite the build ID of an artifact, which downstream tools may use for identity. Treat build-id as advisory, not authenticating; for true authentication, sign artifacts.

---

## 9. Onboarding & docs policy

A short page in your internal docs that says:

- which toolchain version is pinned;
- which `go tool` subcommands are part of the standard workflow (and which are explicitly out-of-scope);
- where profiles/traces are stored and how to open them locally;
- a copy-pasteable `-toolexec` wrapper template if your build needs one.

This is cheaper than every engineer rediscovering `go tool pprof -http=:8080 cpu.out`.

---

## 10. Summary

`go tool` is a discoverable façade over per-tool binaries laid out by `cmd/dist` in `$GOROOT/pkg/tool/<host>/`. Build-internal tools (`compile`, `link`, `asm`, `cgo`, `pack`) have unstable command lines and should be intercepted only via `-toolexec`. User-facing tools (`pprof`, `trace`, `cover`, `nm`, `objdump`, `addr2line`, `test2json`, `dist list`, `buildid`) are stable enough to script against. Pin `GOTOOLCHAIN`, version-check your tool catalog in CI, and treat profiles/traces from outside your perimeter as untrusted input.

---

## Further reading
- `cmd/go` action graph: https://github.com/golang/go/blob/master/src/cmd/go/internal/work/exec.go
- `cmd/dist`: https://github.com/golang/go/tree/master/src/cmd/dist
- `-toolexec` flag: `go help build`
- google/pprof: https://github.com/google/pprof
