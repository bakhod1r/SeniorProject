# go tool — Find the Bug

Each scenario shows a command or setup that looks fine but misbehaves. Find the defect, explain it, and fix it.

---

## Bug 1 — `go tool nm` on a stripped binary shows almost nothing

```bash
go build -ldflags='-s -w' -o app ./cmd/app
go tool nm app | wc -l
# 12          <- almost no symbols
```

**Bug:** `-s` strips the symbol table and `-w` strips DWARF; `nm` has nothing to print.
**Fix:** build without strip flags when you need to inspect symbols: `go build -o app ./cmd/app`. Keep a debug build alongside the release for forensics.

---

## Bug 2 — `objdump` on an optimized binary "loses" local variables

```bash
go build -o app ./cmd/app
go tool objdump -s '^pkg\.Foo$' app | grep -i local
# (nothing useful)
```

**Bug:** the optimizer inlines/registers locals away; the assembly is correct, but Go locals do not exist as discrete stack slots anymore.
**Fix:** build with `-gcflags='all=-N -l'` to disable optimization and inlining; you will then see the canonical stack layout. Re-enable optimizations for release builds.

---

## Bug 3 — `go tool cover` complains the profile is empty

```bash
go test ./...
go tool cover -func=cover.out
# open cover.out: no such file or directory
```

**Bug:** `-coverprofile=...` was not set on the test command, so no profile was written.
**Fix:** `go test -coverprofile=cover.out ./... && go tool cover -func=cover.out`. `cover` does not collect data; the test invocation must.

---

## Bug 4 — `addr2line` returns `??:0` after a `-trimpath` build

```bash
go build -trimpath -o app ./cmd/app
go tool addr2line app <<<'0x10a1234'
# ??
# 0
```

**Bug:** `-trimpath` rewrites source paths in the binary's debug info to short, anonymized forms; if you do not feed `addr2line` the same Go source tree (or use a debug build with original paths), it cannot resolve files.
**Fix:** keep an **untrimmed** debug build alongside the release (`go build -o app.debug ./cmd/app`) and resolve PCs against the debug build, or set up a source-map / build-info system that lets you reconstruct paths from the trimmed prefix.

---

## Bug 5 — Toolchain version mismatch silently changes output

```bash
# CI runner A
go tool pprof -top cpu.out      # using Go 1.21
# CI runner B
go tool pprof -top cpu.out      # using Go 1.23 — different sorting/labels
```

**Bug:** `go tool pprof` and `go tool trace` are versioned with the toolchain. Different runners can produce subtly different output formats and break downstream parsers.
**Fix:** pin a single toolchain (`GOTOOLCHAIN=go1.22.3` or the `toolchain` directive in `go.mod`) and assert `go version` at the top of each CI job.

---

## Bug 6 — Calling `compile` directly without `-importcfg`

```bash
go tool compile -o foo.o foo.go
# foo.go:3:8: could not import fmt (file not found)
```

**Bug:** `go tool compile` expects an `-importcfg` file mapping every imported package path to its compiled archive. The `go` driver normally builds this for you; calling `compile` raw skips that step.
**Fix:** do not invoke `compile` directly. Use `go build` (which constructs `-importcfg`), or use `go build -toolexec=YOUR_WRAPPER` to intercept the prebuilt invocation. For research, generate an `-importcfg` from `go list -export`.

---

## Bug 7 — `go tool link` fails the same way

```bash
go tool link -o app main.o
# missing entry symbol / cannot resolve imports
```

**Bug:** Same family as Bug 6: `link` needs `-importcfg` plus archives for every imported package; the runtime/main glue is also driver-supplied.
**Fix:** let `go build` handle it. If you must intercept, use `-toolexec`.

---

## Bug 8 — Using a tool removed in newer Go

```bash
go tool vet ./...
# go: no such tool "vet"
```

**Bug:** `vet` moved out of `go tool`; modern Go runs it via `go vet` (and a vet subset runs automatically during `go test`).
**Fix:** `go vet ./...`. Update CI scripts and docs to stop referencing `go tool vet`.

---

## Bug 9 — `buildid` says two artifacts are identical but they are not

```bash
go tool buildid out1/app
go tool buildid out2/app
# IDs match, but `cmp` shows the files differ
```

**Bug:** the build ID is content-derived from inputs the toolchain considers, not a hash of the final file. Post-link mutations (resource embedding, code signing, post-processing) change bytes without invalidating the ID. Also: `go tool buildid -w` can overwrite IDs.
**Fix:** for byte-level identity, compare with `sha256sum`. Use `buildid` to assert input identity (toolchain inputs + flags + sources), not output identity.

---

## Bug 10 — `pprof` UI shows wrong source

```bash
go tool pprof -http=:8080 cpu.out
# source view shows random lines / missing files
```

**Bug:** `pprof` needs access to the source tree of the binary that produced the profile. If you collected the profile in CI but opened it on a laptop with a different checkout (different commit, or `-trimpath` paths that do not exist locally), source overlays cannot resolve.
**Fix:** open the profile on a machine that has the exact source tree, or use `-source_path` / `-trim_path` flags to map paths. Better: archive the binary plus the source commit hash alongside any profile you intend to look at later.

---

## How to approach these
1. Empty/odd `nm`/`objdump` output? → check for `-s -w` or aggressive optimization (`-gcflags='all=-N -l'` to disable).
2. `cover` failing? → the *test* command, not the *cover* command, is what writes the profile.
3. `addr2line`/`pprof` showing `??`? → debug info or source tree is missing; keep an unstripped/untrimmed build for forensics.
4. Direct `compile`/`link` failures? → those tools assume `cmd/go` set up `-importcfg`. Use `go build`, or intercept via `-toolexec`.
5. Tool not found? → it may have been removed in your toolchain version; check `go tool` and `go help <name>`.
6. Output format unstable? → pin `GOTOOLCHAIN`.
