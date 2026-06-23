# The Linker — Specification

A reference card for `cmd/link`: every flag that matters, the linkmodes and
buildmodes, the section list of a Go ELF binary, the deadcode rules, the
runtime tables (`.gopclntab`, buildinfo), and the tooling. Keep this open while
building release pipelines.

---

## 1. `-ldflags` reference

Flags are passed via `go build -ldflags="..."`. The string is split and handed
to `cmd/link`. Most-used flags:

| Flag | Effect |
| --- | --- |
| `-s` | Omit the symbol table and debug info (smaller binary). |
| `-w` | Omit DWARF debug info. Common pair: `-s -w`. |
| `-X importpath.name=value` | Set package-level **`string` var** `name` in package `importpath` to `value` at link time. Ignored if target isn't a string var. |
| `-X 'pkg.Var=has spaces'` | Quote the whole `-X` argument when the value contains spaces. |
| `-linkmode=<mode>` | `internal` / `external` / `auto` (default). Choose Go's linker or the host linker. |
| `-extld=<prog>` | Host linker to use for external linking (default `gcc`/`clang`). |
| `-extldflags='<flags>'` | Flags passed to the host linker (e.g. `-static`, `-Wl,...`). |
| `-buildmode=<mode>` | Output kind (also a `go build` flag). See §3. |
| `-buildid=` | Set/clear the build ID. Empty value aids byte-reproducibility. |
| `-r <dir>` | Set the ELF dynamic linker search path (rpath). |
| `-H <type>` | Header/output type (rarely set by hand; chosen by GOOS/buildmode). |
| `-v` | Verbose: print phases, host-link command, timings. |
| `-tmpdir=<dir>` | Where external-link temporaries go. |
| `-dumpdep` | Print the symbol dependency edges from deadcode (size debugging). |
| `-checklinkname=0` | Relax `//go:linkname` restrictions (Go 1.23+ tightened these). |
| `-X` on a `const` | **No-op, no error.** Frequent silent bug. |

`go build -ldflags` vs `go tool link`: `go build` is what you normally use; the
raw `go tool link object.o` requires already-compiled objects.

---

## 2. Linkmodes (`-linkmode`)

| Mode | Who links | Notes |
| --- | --- | --- |
| `auto` (default) | linker decides | Internal for pure-Go `exe`; external when cgo objects or certain modes require the host linker. |
| `internal` | `cmd/link` | No system `ld` needed; enables trivial cross-compilation. May fail if external-only inputs are present. |
| `external` | host linker (`gcc`/`clang` → `ld`) | Required for cgo-with-C-objects and for `c-shared`/`c-archive`/`plugin`/`shared`, often `pie`. |

**External-link triggers:** non-trivial cgo, `-buildmode` in
{`c-shared`,`c-archive`,`plugin`,`shared`,`pie` (most platforms)}, explicit
`-linkmode=external`, or `-extldflags`/`-extld`.

---

## 3. Buildmodes (`-buildmode`)

| Mode | Output | Linking | Platforms / notes |
| --- | --- | --- | --- |
| `exe` (default) | executable | internal (pure Go) | normal apps |
| `pie` | position-independent exe | usually external | ASLR hardening |
| `c-archive` | `.a` + `.h` | external | embed Go statically in C |
| `c-shared` | `.so`/`.dll` + `.h` | external | call Go from C/other langs |
| `shared` | Go shared lib | external | share std lib across Go bins (rare) |
| `plugin` | `.so` | external | runtime `plugin.Open`; Linux/macOS only |
| `archive` | `.a` | n/a | package archive |
| `default` | per-platform default | — | usually `exe` |

---

## 4. Sections of a Go ELF binary

(Listed with `readelf -S app`; Mach-O/PE have analogues.)

| Section | Contents | Stripped by |
| --- | --- | --- |
| `.text` | machine code | — |
| `.rodata` | string/RO constants, jump tables | — |
| `.typelink` | sorted list of `*runtime._type` | — |
| `.itablink` | list of `*runtime.itab` | — |
| `.gosymtab` | (legacy, usually empty) | — |
| `.gopclntab` | PC→func/line/GC tables (runtime-critical) | not by `-s -w` |
| `.go.buildinfo` | module + build settings | — |
| `.noptrdata` | initialized data without pointers | — |
| `.data` | initialized data with pointers | — |
| `.bss` | zeroed data with pointers (no file bytes) | — |
| `.noptrbss` | zeroed data without pointers | — |
| `.symtab` / `.strtab` | symbol table | `-s` |
| `.debug_info`/`_line`/`_frame`/... | DWARF | `-w` (and `-s`) |

Key: the pointer/no-pointer split (`.data` vs `.noptrdata`, `.bss` vs
`.noptrbss`) lets the GC skip scanning pointer-free regions.

---

## 5. Deadcode rules (summary)

Implemented in `src/cmd/link/internal/ld/deadcode.go`.

1. **Roots**: runtime entry, `main.main`/`main.init`, runtime-required symbols,
   exported symbols (for shared/c-shared builds).
2. A symbol is **live** iff reachable via relocations from a root.
3. **Direct calls** keep the callee.
4. **Methods** are kept when their type is converted to an interface **and** a
   reachable call site invokes an interface method of matching name+signature.
5. A method on a type **never boxed** into an interface and **never called
   directly** is **dropped**.
6. If `reflect.Value.Method`/`MethodByName` is reachable, **method pruning is
   disabled** — full method sets of reflectable types are retained.
7. Type metadata (names, fields, tags) is kept when reachable via reflection or
   needed for interface/itab construction.

---

## 6. Runtime tables

### `.gopclntab`

- Generated by `pcln.go`. Maps PC → function, file:line, stack/GC pointer maps,
  inlining tree.
- Used by: panic unwinding, `runtime.Callers`/`Caller`/`FuncForPC`, GC stack
  scanning, profilers.
- **Survives `-s -w`** (runtime needs it).

### `.go.buildinfo`

- Module path, main version, dependency versions, build settings, VCS info.
- Read with `go version -m <binary>` or `debug/buildinfo.ReadFile`.
- VCS stamping (`vcs.revision`, `vcs.time`, `vcs.modified`) added automatically
  since Go 1.18 when building from a clean VCS checkout (toggle with
  `-buildvcs`).

---

## 7. Tooling reference

| Tool / command | Purpose |
| --- | --- |
| `go build -ldflags="..."` | Link with custom flags. |
| `go tool link` | Invoke the linker directly on objects. |
| `go tool nm <bin\|.a>` | List symbols (addr, type, name). |
| `go tool nm -size -sort size <bin>` | Symbols ranked by size. |
| `go tool objdump <bin>` | Disassemble; map code to source. |
| `go version -m <bin>` | Print embedded build/module info. |
| `go build -trimpath` | Strip absolute build paths (reproducibility). |
| `go build -buildvcs=false` | Disable VCS stamping. |
| `go build -ldflags=-dumpdep` | Dump deadcode dependency edges. |
| `go build -ldflags=-v` | Verbose linker (phases, host link cmd). |
| `readelf -S` / `otool -l` / `dumpbin` | OS-native section inspection (ELF/Mach-O/PE). |
| `bloaty <bin>` | Third-party size breakdown by section/symbol/package. |
| `debug/buildinfo` (pkg) | Programmatic buildinfo reading. |

---

## 8. Quick recipes

```bash
# Release: stripped, trimmed, version-stamped
go build -trimpath -ldflags="-s -w -X main.version=$(git describe --tags)" -o app ./cmd/app

# Reproducible (byte-identical)
go build -trimpath -ldflags="-s -w -buildid=" -o app ./cmd/app

# Static with cgo
CGO_ENABLED=1 go build -ldflags='-linkmode=external -extldflags=-static' -o app ./cmd/app

# Inspect
go version -m app
go tool nm -size -sort size app | tail -20
readelf -S app | grep -E 'gopclntab|buildinfo|debug'
```

---

## Further reading

- [`cmd/link` command docs (all flags)](https://pkg.go.dev/cmd/link)
- [`go help buildmode` / build modes](https://pkg.go.dev/cmd/go#hdr-Build_modes)
- [`deadcode.go` source](https://github.com/golang/go/blob/master/src/cmd/link/internal/ld/deadcode.go)
- [`debug/buildinfo`](https://pkg.go.dev/debug/buildinfo)
- [`go tool nm`](https://pkg.go.dev/cmd/nm)
