# go version — Middle

## 1. Three things `go version` reports

```bash
go version                 # the running toolchain + platform
go version <binary>...      # the Go version that built each binary
go version -m <binary>...   # version + embedded module/build info
go version -v <files>       # also report files that are NOT Go binaries (with errors)
```

The binary-inspection forms work on any Go executable, even one you did not build, because the version is embedded at link time.

---

## 2. `go version -m`: the build manifest

`-m` prints the build information embedded by the toolchain (the same data `runtime/debug.ReadBuildInfo` exposes):

```bash
$ go version -m ./app
./app: go1.23.0
	path	example.com/app
	mod	example.com/app	v1.2.0	h1:...
	dep	github.com/google/uuid	v1.6.0	h1:...
	dep	golang.org/x/sys	v0.20.0	h1:...
	build	-trimpath=true
	build	CGO_ENABLED=0
	build	vcs.revision=9f3c1a...
	build	vcs.time=2026-05-01T10:00:00Z
	build	vcs.modified=false
```

Useful fields:
- `mod`/`dep` — the exact module versions that shipped.
- `build` settings — flags like `-trimpath`, `CGO_ENABLED`.
- `vcs.*` — the commit and dirty state (from VCS stamping).

This is the fastest way to answer "what exactly is in this deployed binary?"

---

## 3. The `go` directive vs the toolchain version

Two related but distinct version concepts:

- **`go version`** — the toolchain you have installed/are running.
- **`go 1.XX` in `go.mod`** — the *minimum* Go version your module requires (controls language features and module behavior).

```
// go.mod
go 1.22
```

If your installed toolchain is older than the `go` directive, modern Go will (by default) try to download and use a newer toolchain automatically — controlled by `GOTOOLCHAIN`.

---

## 4. GOTOOLCHAIN: automatic version selection (Go 1.21+)

Since Go 1.21, the toolchain can switch versions to satisfy a module's requirements:

```bash
go env GOTOOLCHAIN        # default: "auto"
```

| `GOTOOLCHAIN` value | Behavior |
|---------------------|----------|
| `auto` (default) | Download/use a newer toolchain if `go.mod`/`go.work` requires it |
| `local` | Always use the installed toolchain; error if it's too old |
| `go1.23.0` | Force a specific toolchain version |
| `path` | Use a toolchain found on `PATH` |

So `go version` may report a *different* version than the one you installed, if `auto` selected a newer one for the project.

---

## 5. The `toolchain` directive

`go.mod` can pin a toolchain explicitly:

```
go 1.22
toolchain go1.23.1
```

Here the module *requires* at least 1.22 but *suggests* building with 1.23.1. With `GOTOOLCHAIN=auto`, Go fetches 1.23.1 if not present. This pins the exact build toolchain for everyone, making `go version` consistent across the team.

---

## 6. Verifying deployed binaries

A common ops task:

```bash
go version -m /usr/local/bin/myservice
```

You can confirm:
- The Go version (security patches?).
- Dependency versions (did the vulnerable lib version ship?).
- Build flags and VCS commit (provenance).

No source needed — it is all embedded.

---

## 7. Cross-platform note

`go version` reports the platform the toolchain targets by default (`linux/amd64`), but you build for other platforms with `GOOS`/`GOARCH`. The *binary's* platform may differ from your toolchain's line:

```bash
GOOS=linux GOARCH=arm64 go build -o app .
go version app        # reports the Go version; the binary is linux/arm64
```

`go version <binary>` reports the Go version that built it, not the target platform (use `file` for that).

---

## 8. How it fits the workflow

- First thing on a new machine/project: `go version` to confirm the toolchain.
- Debugging a version-specific issue: share the `go version` line.
- Auditing a release: `go version -m <artifact>` for the full manifest.
- Ensuring team consistency: pin via the `toolchain` directive + `GOTOOLCHAIN`.

---

## 9. Trade-offs

| Setting | Pro | Con |
|---------|-----|-----|
| `GOTOOLCHAIN=auto` | builds "just work" with the right version | downloads toolchains automatically (network, surprise) |
| `GOTOOLCHAIN=local` | full control, no surprise downloads | build fails if too old |
| `toolchain` directive | reproducible builds team-wide | must bump deliberately |

---

## 10. Summary

`go version` reports the running toolchain (`go version goX.Y.Z os/arch`), the Go version that built a binary (`go version <bin>`), and the full embedded manifest (`go version -m <bin>` — modules, build flags, VCS). Distinguish the toolchain version from the `go.mod` `go` directive (minimum required). Since Go 1.21, `GOTOOLCHAIN` and the `toolchain` directive control automatic version selection, so the reported version may differ from what you installed.

---

## Further reading
- `go help version`
- Toolchain management: https://go.dev/doc/toolchain
- `runtime/debug.ReadBuildInfo`: https://pkg.go.dev/runtime/debug#ReadBuildInfo
