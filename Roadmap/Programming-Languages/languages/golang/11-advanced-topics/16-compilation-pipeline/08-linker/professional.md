# The Linker — Professional

This is the production playbook: **reproducible builds**, version-stamping
pipelines, **size budgets**, the buildmodes you actually ship (plugin,
c-shared, PIE), the static-vs-dynamic cgo decision, and the footguns that have
caused real outages. Everything here assumes you own the build/release pipeline.

---

## 1. Reproducible builds

A reproducible build means: the same source + same toolchain ⇒ **byte-identical**
binary, on any machine, any directory, any user. This matters for supply-chain
security (you can verify a published binary matches the source) and for caching.

The two things that break reproducibility by default:

1. **Absolute paths** embedded in pclntab/DWARF — fixed by `-trimpath`.
2. **Build metadata** drift — controlled via `buildinfo` and pinned toolchain.

```bash
# Reproducible release build
go build \
  -trimpath \
  -ldflags="-s -w -buildid=" \
  -o app ./cmd/app
```

Notes:

- `-trimpath` removes the machine's `GOPATH`/module root from embedded paths.
- `-buildid=` (empty) clears the content-hash build ID the linker normally
  stamps; it can vary and defeat bit-for-bit comparison in some pipelines. Only
  clear it when you specifically need byte-identity — it disables build caching
  benefits.
- Pin the **Go toolchain version** (e.g. via `go.mod`'s `go` directive +
  `GOTOOLCHAIN`); a different compiler/linker version produces different bytes.
- Avoid embedding timestamps. `go build` itself doesn't embed wall-clock time;
  *your* `-X` values must not include `date`.

Verify reproducibility:

```bash
go build -trimpath -ldflags="-s -w -buildid=" -o a1 ./cmd/app
go build -trimpath -ldflags="-s -w -buildid=" -o a2 ./cmd/app
sha256sum a1 a2     # must match
```

---

## 2. Build info — what's baked in, and how to read it

The linker embeds a `.go.buildinfo` section: module path, main module version,
dependency versions, and selected build settings. Read it without running the
binary:

```bash
go version -m ./app
# ./app: go1.22.3
#   path    github.com/you/app/cmd/app
#   mod     github.com/you/app   v1.4.2   h1:...
#   dep     github.com/x/y       v0.3.1   h1:...
#   build   -trimpath=true
#   build   -ldflags="-s -w -X main.version=1.4.2"
#   build   vcs.revision=abcdef1
#   build   vcs.time=2026-06-01T...
```

Since Go 1.18 the toolchain also stamps **VCS info** (`vcs.revision`,
`vcs.time`, `vcs.modified`) automatically when building from a git checkout —
you often don't need `-X` for the commit anymore. Read it at runtime:

```go
import "runtime/debug"

func version() string {
    if bi, ok := debug.ReadBuildInfo(); ok {
        for _, s := range bi.Settings {
            if s.Key == "vcs.revision" {
                return s.Value
            }
        }
    }
    return "unknown"
}
```

Or parse another binary's info programmatically with
[`debug/buildinfo`](https://pkg.go.dev/debug/buildinfo):

```go
info, _ := buildinfo.ReadFile("./app")
fmt.Println(info.GoVersion, info.Main.Version)
```

> **Footgun:** building in a CI container that does a shallow/dirty checkout sets
> `vcs.modified=true` or drops VCS stamping (e.g. when `.git` is absent or
> `-buildvcs=false`). If your release relies on `vcs.revision`, ensure the build
> context has `.git` and a clean tree, or fall back to `-X`.

---

## 3. Version-stamping pipeline (battle-tested pattern)

```makefile
VERSION  := $(shell git describe --tags --always --dirty)
COMMIT   := $(shell git rev-parse --short HEAD)
DATE     := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
PKG      := github.com/you/app/internal/build

LDFLAGS  := -s -w \
  -X '$(PKG).Version=$(VERSION)' \
  -X '$(PKG).Commit=$(COMMIT)' \
  -X '$(PKG).Date=$(DATE)'

build:
	go build -trimpath -ldflags="$(LDFLAGS)" -o bin/app ./cmd/app
```

Rules that prevent the most common failures:

- The target variables must be **package-level `var` of type `string`** in
  `internal/build`. Not `const`, not local, not `int`.
- Use the **full import path**: `github.com/you/app/internal/build.Version`, not
  `build.Version`.
- Quote each `-X` separately when the value has spaces (the date).
- Don't put `-X` on a `const` — the linker **silently ignores** it (no error),
  which is why people stare at `version = "dev"` for an hour.

For reproducible builds, **don't** stamp `date` — let buildinfo carry
`vcs.time` instead, or pass a fixed `SOURCE_DATE_EPOCH`.

---

## 4. Size budgets and analysis

Treat binary size as a tracked metric (e.g. fail CI if it grows > N%).

```bash
# Baseline
go build -ldflags="-s -w" -trimpath -o app ./cmd/app
ls -l app

# Rank symbols by size
go tool nm -size -sort size app | tail -30

# Per-package / section breakdown with bloaty (https://github.com/google/bloaty)
bloaty app                          # sections + symbols overview
bloaty -d sections app
bloaty -d symbols app | head -30
bloaty -d compileunits app          # which packages cost the most

# Dependency reachability dump from the linker itself
go build -ldflags="-dumpdep" -o app ./cmd/app 2>deps.txt
wc -l deps.txt                      # the live symbol dependency edges
```

`-ldflags=-dumpdep` makes the linker print the **dependency edges** it followed
during deadcode — invaluable for answering "why is `regexp` in my binary?" Grep
the output for a symbol and walk backwards to the root that kept it alive.

What typically dominates size: `reflect` + the type metadata of everything it
touches, `net/http` + TLS (`crypto/...`), `regexp`, `time/tzdata` (if embedded),
and large generated code.

---

## 5. Buildmodes you ship

### `-buildmode=pie`

Position-independent executable; pages can load at random addresses (ASLR).
Some distros (Alpine hardened, certain Linux policies) expect PIE. It usually
forces external linking and slightly larger binaries. Use when your security
baseline requires it:

```bash
go build -buildmode=pie -o app ./cmd/app
```

### `-buildmode=plugin`

Builds a `.so` you load at runtime with the `plugin` package
(Linux/macOS only; **no Windows**). Powerful but fragile:

```bash
go build -buildmode=plugin -o handler.so ./plugins/handler
```

```go
p, err := plugin.Open("handler.so")
sym, err := p.Lookup("Handler")
h := sym.(func(http.ResponseWriter, *http.Request))
```

> **Footgun (real, common):** the plugin and the host **must** be built with the
> *exact same* Go version, the *same* versions of every shared dependency, the
> same `GOOS/GOARCH`, and compatible build flags. Any skew yields
> `plugin was built with a different version of package ...`. Plugins also can't
> be unloaded and leak the whole transitive dependency set into the host.
> Most teams who try plugins eventually replace them with subprocess + RPC or
> WASM.

### `-buildmode=c-shared` / `c-archive`

Expose Go to C / Python / other runtimes. `c-shared` makes a `.so`/`.dll`;
`c-archive` makes a `.a` for static embedding. Exported funcs need `//export`
comments and cgo. These always use external linking.

```bash
go build -buildmode=c-shared -o libgo.so ./cmd/lib   # also emits libgo.h
```

---

## 6. Static vs dynamic with cgo

Pure-Go programs are **statically linked** by default — a single self-contained
binary, the reason Go is loved for containers (`FROM scratch`). The moment cgo
is on (e.g. `net` with the C resolver, `os/user`, sqlite drivers), you may get a
**dynamically linked** binary that needs `libc` at runtime — which breaks
`FROM scratch` and Alpine (musl vs glibc).

Decision table:

| Goal | Build |
| --- | --- |
| Static pure-Go (smallest, `scratch`-friendly) | `CGO_ENABLED=0 go build` |
| Static even with cgo | `CGO_ENABLED=1 go build -ldflags='-linkmode=external -extldflags=-static'` (needs static C libs present) |
| Use the pure-Go DNS resolver | `CGO_ENABLED=0`, or `-tags netgo`, or `GODEBUG=netdns=go` |

```bash
# Reproducible, static, stripped, version-stamped — the typical container build
CGO_ENABLED=0 go build -trimpath \
  -ldflags="-s -w -X main.version=$(git describe --tags --always)" \
  -o /out/app ./cmd/app
```

> **Footgun:** `CGO_ENABLED=1` (the default on native builds) + Alpine base image
> ⇒ binary linked against glibc but Alpine ships musl ⇒ `not found` at start.
> Set `CGO_ENABLED=0` for portable static binaries, or build on/for the right
> libc.

---

## 7. More footguns and real cases

- **`-X` set but value is `dev`** — target was a `const` or wrong import path,
  or you put `-X` in `GOFLAGS` where quoting got mangled. Verify with
  `go version -m app | grep ldflags`.
- **Stack traces "lost names" after `-w`** — they didn't; pclntab survives. If
  names truly vanished, something stripped pclntab post-build (e.g. running the
  system `strip` on the binary). Don't run external `strip` on Go binaries; use
  `-s -w` at link time.
- **`upx`-compressed binary flagged by AV / slow startup** — UPX trades disk for
  a decompress-on-exec cost and frequently triggers antivirus heuristics. Avoid
  for server binaries; maybe acceptable for hand-distributed CLIs.
- **Plugin `different version of package` in prod** — version skew (see above).
  Pin everything; build host and plugin in one CI job from one `go.sum`.
- **Reproducible build diff between CI and laptop** — different Go minor version
  or missing `-trimpath`/`-buildid=`. Pin `GOTOOLCHAIN` and compare
  `go version -m`.
- **Binary balloons after adding a "small" dependency** — it pulled in `reflect`
  or a big subtree. Use `-dumpdep` / bloaty to confirm and consider a lighter
  lib.

---

## 8. Summary

- **Reproducible builds**: `-trimpath`, optionally `-buildid=`, pinned
  toolchain; verify with `sha256sum` and `go version -m`.
- **Buildinfo + VCS stamping** (Go 1.18+) often replaces `-X` for commit/time;
  read via `runtime/debug` or `debug/buildinfo`.
- **Version stamping**: `-X full/import/path.Var=value`, target must be a
  package-level `string var`; quote values with spaces.
- **Size budgets**: rank with `nm -size`, break down with `bloaty`, trace with
  `-dumpdep`; reflection and crypto/net dominate.
- **Buildmodes**: `pie` for hardening, `plugin`/`c-shared`/`c-archive` for
  interop — all with sharp version/ABI edges.
- **cgo + libc** decides static vs dynamic: prefer `CGO_ENABLED=0` for portable
  static `scratch`/Alpine binaries.

---

## Further reading

- [`debug/buildinfo` package](https://pkg.go.dev/debug/buildinfo)
- [`runtime/debug.ReadBuildInfo`](https://pkg.go.dev/runtime/debug#ReadBuildInfo)
- [Go modules: VCS stamping / `-buildvcs`](https://go.dev/ref/mod#build-commands)
- [bloaty — size profiler for binaries](https://github.com/google/bloaty)
- [`plugin` package and its caveats](https://pkg.go.dev/plugin)
- [Reproducible builds with Go (`-trimpath`)](https://go.dev/blog/rebuild)
