# The Linker — Tasks

Hands-on exercises. Do them on a small real program (a CLI with `fmt`,
`net/http`, and one struct you JSON-encode is a good sandbox). Each task names
the **goal**, the **commands**, and what to **observe**. No solutions handed to
you — the point is to *see* the linker behave.

---

## Task 1 — Strip and measure

```bash
go build -o app-full ./cmd/app
go build -ldflags="-s -w" -o app-stripped ./cmd/app
ls -l app-full app-stripped
```

**Observe:** the percentage drop. Note which is bigger: the `-s` or the `-w`
contribution (rebuild with only `-w`, then only `-s`).

---

## Task 2 — Stamp a version with `-X`

Add `var version = "dev"` to `main`. Then:

```bash
go build -ldflags="-X main.version=$(git describe --tags --always)" -o app ./cmd/app
./app --version    # (wire version into your flag)
```

**Observe:** the value changes. Now intentionally change it to a `const` and
confirm the flag is **silently ignored**.

---

## Task 3 — Verify the stamp landed in buildinfo

```bash
go version -m app | grep -i ldflags
```

**Observe:** the `-X` you passed is recorded in `.go.buildinfo`. This is how you
audit what flags produced a shipped binary.

---

## Task 4 — List the largest symbols

```bash
go tool nm -size -sort size app | tail -25
```

**Observe:** which functions/types dominate. Map a couple back to packages
(`reflect.*`, `runtime.*`, your own).

---

## Task 5 — Inspect embedded build info

```bash
go version -m app
```

**Observe:** module path, main version, every dependency + hash, and the
`vcs.revision` / `vcs.time` / `vcs.modified` lines. Make an uncommitted change
and rebuild — watch `vcs.modified` flip to `true`.

---

## Task 6 — Read buildinfo programmatically

Write a tiny tool using `debug/buildinfo`:

```go
info, _ := buildinfo.ReadFile("./app")
fmt.Println(info.GoVersion, info.Main.Path, info.Main.Version)
```

**Observe:** you can extract version info from *any* Go binary without running
it.

---

## Task 7 — Find a dead-code-eliminated function

Add an exported but **uncalled** function `func Unused() {}`. Build, then:

```bash
go tool nm app | grep -i Unused      # likely no output
```

**Observe:** it's gone. Now call it from `main` and rebuild — it appears. That's
deadcode reachability in action.

---

## Task 8 — Watch reflection keep methods alive

Create a type with a method called only via `reflect.Value.MethodByName`. Build
and grep `nm` for the method. Then remove the reflective call (call nothing) and
confirm the method disappears.

```bash
go tool nm app | grep -i '\.YourMethod'
```

**Observe:** the method survives only while reflection (or an interface
conversion) keeps it reachable.

---

## Task 9 — Dump the dependency edges

```bash
go build -ldflags=-dumpdep -o app ./cmd/app 2>deps.txt
wc -l deps.txt
grep -i 'regexp' deps.txt | head
```

**Observe:** the linker's reachability graph. Trace why a package you didn't
expect got linked in.

---

## Task 10 — Compare sections

```bash
go build -o app ./cmd/app
# Linux:
readelf -S app | grep -E 'gopclntab|buildinfo|debug|text|rodata'
# macOS:
otool -l app | grep -A2 -i gopclntab
```

**Observe:** `.gopclntab` and `.go.buildinfo` exist. Rebuild with `-s -w` and
confirm `.debug_*` is gone but `.gopclntab` remains.

---

## Task 11 — Build a plugin

```bash
go build -buildmode=plugin -o handler.so ./plugins/handler
```

Then `plugin.Open("handler.so")` and `Lookup` an exported symbol from a host.
**Observe:** it works only when host and plugin share Go version + deps. Bump a
dependency in one and watch `plugin was built with a different version`.

---

## Task 12 — Force external linking

```bash
go build -ldflags='-linkmode=external -v' -o app ./cmd/app 2>&1 | grep -i 'host link'
```

**Observe:** the actual host-linker (`gcc`/`clang`) command line the Go linker
invoked. Compare against a default `auto` build of a pure-Go program (which
stays internal — no host link line).

---

## Task 13 — Build a static cgo binary

```bash
CGO_ENABLED=1 go build -ldflags='-linkmode=external -extldflags=-static' -o app ./cmd/app
file app        # should say "statically linked"
ldd app         # "not a dynamic executable"
```

**Observe:** the difference vs a default cgo build (`ldd` lists `libc`). Note any
missing-static-lib errors and what they teach about your build environment.

---

## Task 14 — Reproducible build check

```bash
go build -trimpath -ldflags="-s -w -buildid=" -o a1 ./cmd/app
go build -trimpath -ldflags="-s -w -buildid=" -o a2 ./cmd/app
sha256sum a1 a2
```

**Observe:** identical hashes. Now drop `-trimpath`, build in two different
directories, and watch the hashes diverge (embedded paths differ).

---

## Stretch

- Run `bloaty -d compileunits app` and write down your three heaviest packages.
- Try `upx --best app` and measure the on-disk size drop **and** the startup
  time change (`time ./app --version`).
- Build the same program with `CGO_ENABLED=0` vs `=1` and compare size, `ldd`
  output, and whether it runs on a `scratch`/Alpine container.

---

## Further reading

- [`go tool nm`](https://pkg.go.dev/cmd/nm)
- [`go version -m` / build info](https://pkg.go.dev/cmd/go#hdr-Print_Go_environment_information)
- [`debug/buildinfo`](https://pkg.go.dev/debug/buildinfo)
- [`plugin` package](https://pkg.go.dev/plugin)
- [bloaty](https://github.com/google/bloaty)
