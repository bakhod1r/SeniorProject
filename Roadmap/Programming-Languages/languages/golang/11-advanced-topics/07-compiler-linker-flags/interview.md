# Compiler & Linker Flags — Interview

Common interview questions on Go's build flags.

---

## Q1. What do `-s` and `-w` ldflags do?

`-s` removes the symbol table; `-w` removes DWARF debug info. Combined, they reduce binary size by 10–20%. Use for release builds where you don't need source-level debugging.

---

## Q2. How do you inject a version string at build time?

```bash
go build -ldflags="-X main.version=1.2.3" ./cmd/app
```

The Go variable `main.version` must be a `var` of type `string`. Constants and non-strings aren't injectable.

---

## Q3. What does `-trimpath` do?

Removes file system paths from the resulting binary. Stack traces show package paths instead of absolute paths. Used for reproducible builds and to avoid leaking developer paths.

---

## Q4. How do you build a debugger-friendly binary?

```bash
go build -gcflags='all=-N -l' ./cmd/app
```

`-N` disables optimizations; `-l` disables inlining. The resulting binary maps clearly to source for `delve`.

---

## Q5. What's PGO and how do you use it?

Profile-guided optimization. The compiler uses a CPU profile to make better inlining and devirtualization decisions. Workflow: capture a profile via `pprof`, save as `default.pgo` next to main, build with `-pgo=auto`.

Typical gains: 5–10% CPU.

---

## Q6. What's the difference between `-gcflags` and `-ldflags`?

`-gcflags` passes flags to the Go compiler (per-package compile time). `-ldflags` passes flags to the linker (final binary assembly). They act at different stages of the build.

---

## Q7. How do you build for a different OS/arch?

```bash
GOOS=linux GOARCH=arm64 go build ./...
```

Set `GOOS` and `GOARCH` environment variables. Build flags work the same as for the host build. With cgo, you also need a cross C toolchain.

---

## Q8. What's the difference between `-buildmode=exe`, `c-archive`, and `c-shared`?

- `exe`: a standalone Go executable (default).
- `c-archive`: a `.a` file callable from C, with a generated `.h`.
- `c-shared`: a `.so`/`.dylib` callable from C, with a generated `.h`.

Used to expose Go code to C/C++ programs.

---

## Q9. How do you produce a reproducible binary?

```bash
go build -trimpath -buildvcs=false \
  -ldflags="-buildid='' -s -w" \
  ./...
```

Plus: pin the Go toolchain version, pin `CGO_ENABLED`, identical `GOOS`/`GOARCH`, no time-dependent `-X` values. Two such builds produce byte-identical binaries.

---

## Q10. What does `-race` do?

Enables Go's race detector. Each memory access is instrumented; the runtime reports data races as they happen. Runtime cost: 2–20× slowdown. Use in tests and dev, not in production.

---

## Q11. What's the `package=flags` syntax in `-gcflags`?

```bash
go build -gcflags='pattern=flags' ./...
```

Selects which packages receive the flags. `all=...` applies to every package; `main=...` only to main; `example.com/...=...` to a path prefix. Without a pattern, flags apply only to the top-level package being built.

---

## Q12. How do you see what `go build` is actually doing?

`-x` prints the compile/link commands. `-work` keeps the temporary work directory. Combined: `-x -work`.

---

## Q13. Why might `-X` injection fail silently?

Common causes:

- The target isn't a `var` (constants aren't injectable).
- The target isn't `string`-typed.
- The package qualifier is wrong (need full import path).
- The variable was inlined and folded by the compiler (rare).

The linker doesn't error on a miss; the variable simply keeps its compile-time value.

---

## Q14. How do you make a static cgo binary?

```bash
CGO_ENABLED=1 go build -ldflags='-linkmode=external -extldflags="-static"' ./...
```

Plus the C libraries you depend on must be available as static archives. Alpine + musl is the easiest setup.

---

## Q15. What's `-spectre=all` for?

Adds Spectre v1 mitigations to compiled code. Slight performance cost (~1–5%). Enable in multi-tenant or untrusted-code environments.

---

## Q16. What does `go version -m binary` show?

The build settings embedded in the binary: Go version, target platform, tags, flags, VCS metadata. Useful for verifying production builds and triaging "what version is this?"

---

## Q17. Why might two builds of the same source produce different binaries?

Possible causes:

- Different toolchain versions.
- Different file system paths (no `-trimpath`).
- VCS-info embedding includes commit hash + dirty state.
- Random build ID (use `-buildid=''` to clear).
- Time-dependent `-X` injections.
- Different `GOPROXY` resolutions for unpinned modules.

The reproducible-build checklist addresses each.

---

## Q18. What's the cost of `-N -l`?

The resulting binary is 2–3× slower in hot paths and 30%+ larger. Only useful for debugging. Never deploy with these flags.

---

## Q19. What does `-buildvcs` do?

Controls whether Go embeds VCS metadata (commit hash, dirty flag, etc.) into the binary. Default `auto` embeds when building inside a clean git repo. `=false` disables; `=true` requires it.

---

## Q20. Bonus — describe your release-build incantation.

Open-ended. A senior candidate has a Makefile target like:

```bash
go build \
  -trimpath \
  -ldflags="-s -w \
    -X 'example.com/pkg/buildinfo.Version=$(VERSION)' \
    -X 'example.com/pkg/buildinfo.Commit=$(COMMIT)' \
    -X 'example.com/pkg/buildinfo.BuildTime=$(BUILD_TIME)'" \
  -o ./bin/app ./cmd/app
```

And explains each component.

---

## Cheat sheet

- `-s -w` strip; `-trimpath` clean paths.
- `-X pkg.var=val` inject string.
- `-gcflags='all=-N -l'` debug.
- `-gcflags='-m'` escape decisions.
- `-pgo=auto` PGO.
- `-race` data races.
- `-buildmode=...` for c-archive, c-shared, pie, plugin.
- `GOOS`/`GOARCH` for cross.
- `go version -m` to inspect.

---

## Further reading
- `go help buildflags`
- `cmd/compile`, `cmd/link` documentation
