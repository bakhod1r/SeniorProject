# go install — Find the Bug

Each scenario looks fine but misbehaves. Find the defect, explain it, fix it.

---

## Bug 1 — "command not found" after a successful install

```bash
$ go install honnef.co/go/tools/cmd/staticcheck@v0.5.1
$ staticcheck ./...
zsh: command not found: staticcheck
```

**Bug:** the install succeeded, but the bin directory (`$GOPATH/bin`) is not on `PATH`.
**Fix:** `export PATH="$PATH:$(go env GOPATH)/bin"` (add to your shell profile).

---

## Bug 2 — Remote install without a version

```bash
$ go install honnef.co/go/tools/cmd/staticcheck
go: 'go install' requires a version when current directory is not in a module
```

**Bug:** modern Go requires `@version` to install a package outside your own module.
**Fix:** `go install honnef.co/go/tools/cmd/staticcheck@v0.5.1`.

---

## Bug 3 — Non-reproducible CI from `@latest`

```bash
go install honnef.co/go/tools/cmd/staticcheck@latest
```

**Bug:** `@latest` resolves to whatever is newest at run time; a new release can change results and break CI.
**Fix:** pin an exact version: `@v0.5.1`.

---

## Bug 4 — Expecting `-o` to rename

```bash
$ go install -o mytool .
flag provided but not defined: -o
```

**Bug:** `go install` has no `-o`; the binary is named after the package path.
**Fix:** use `go build -o mytool .` (and place it on PATH manually), or rename after install.

---

## Bug 5 — Tool ignores project's dependency versions

```bash
go install example.com/cmd/gen@v1.0.0   # built with v1.0.0's own deps
```

A developer expected `gen` to use the project's pinned version of a shared library.

**Bug:** `@version` installs run in isolated module mode and ignore your `go.mod`; the tool uses its own dependencies.
**Fix:** if the tool must build against your module's deps, add it as a `tool` directive / build it from within your module (`go install ./...` with the tool vendored), rather than `@version`.

---

## Bug 6 — Cross-installed binary "missing"

```bash
$ GOOS=linux GOARCH=arm64 go install .
$ ls "$(go env GOPATH)/bin"
# native binary present, but no linux/arm64 one here
```

**Bug:** cross-compiled installs go to `$GOPATH/bin/<goos>_<goarch>/`, not directly in `bin/`.
**Fix:** look in `$(go env GOPATH)/bin/linux_arm64/`, or set `GOBIN` to a directory of your choice.

---

## Bug 7 — Install fails under vendor mode

```bash
$ GOFLAGS=-mod=vendor go install example.com/cmd/tool@v1.0.0
go: -mod=vendor cannot be used with ...@version
```

**Bug:** a global `GOFLAGS=-mod=vendor` conflicts with the module-mode `@version` install.
**Fix:** unset `GOFLAGS` (or use `-mod=mod`) for the install: `GOFLAGS= go install example.com/cmd/tool@v1.0.0`.

---

## Bug 8 — `go install` used to "deploy" the app in Docker

```dockerfile
RUN go install ./cmd/server   # then no clear path to the binary in the final stage
```

**Bug:** `go install` hides the binary in `$GOPATH/bin`, complicating the multi-stage copy and bloating intent.
**Fix:** `RUN go build -o /out/server ./cmd/server` then `COPY --from=build /out/server /server` — explicit and predictable.

---

## Bug 9 — Two engineers get different lint results

Both ran `go install staticcheck@latest` weeks apart.

**Bug:** version drift — each machine has a different `@latest` snapshot.
**Fix:** pin versions centrally (Makefile or `go.mod` `tool` directive) so everyone installs the same version.

---

## How to approach these
1. "not found"? → PATH and the bin directory.
2. Install rejected? → add `@version`.
3. Different results across machines/CI? → pin versions, never `@latest`.
4. Tool behaving with the wrong deps? → `@version` ignores your `go.mod`.
5. Binary "missing"? → check the cross-arch subdirectory.
