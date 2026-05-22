# go build — Hands-on Tasks

Go 1.21+. Each task has explicit acceptance criteria.

---

## Task 1: First binary

Init a module, write a `main` that prints something, and build it.

**Acceptance criteria**
- [ ] `go mod init example.com/app` succeeds.
- [ ] `go build` creates an executable named after the directory.
- [ ] Running the executable prints your message without recompiling.

---

## Task 2: Output control

Build into a specific path and name.

**Acceptance criteria**
- [ ] `go build -o bin/myapp .` creates `bin/myapp`.
- [ ] `go build -o /dev/null ./...` compiles all packages and leaves no artifact.
- [ ] You can explain the difference between `-o dir/` and `-o file`.

---

## Task 3: Library vs main

Add a non-`main` package and build it.

**Acceptance criteria**
- [ ] `go build ./internal/yourpkg` exits 0 and writes no file.
- [ ] Introducing a type error makes that build fail.

---

## Task 4: Inject version info

Add `var version = "dev"` and override it.

**Acceptance criteria**
- [ ] `go build -o app . && ./app` prints `dev`.
- [ ] `go build -ldflags="-X main.version=1.0.0" -o app . && ./app` prints `1.0.0`.
- [ ] `go build -ldflags="-s -w" -o app .` produces a noticeably smaller binary (compare `ls -l`).

---

## Task 5: Cross-compile

Build for three platforms.

**Acceptance criteria**
- [ ] `GOOS=linux GOARCH=amd64 go build -o app-linux .` succeeds.
- [ ] `GOOS=windows GOARCH=amd64 go build -o app.exe .` succeeds.
- [ ] `file app-linux` (or equivalent) confirms the target architecture.
- [ ] `go tool dist list` shows the full set of valid targets.

---

## Task 6: Reproducible build

Make two identical builds.

**Acceptance criteria**
- [ ] `CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -buildid=" -o app1 .` then the same into `app2`.
- [ ] `cmp app1 app2` reports no differences (or you explain any remaining difference).
- [ ] `go version -m app1` shows no leaked absolute home-directory paths.

---

## Task 7: Static container build

Write a multi-stage Dockerfile producing a distroless image.

**Acceptance criteria**
- [ ] The build stage uses `CGO_ENABLED=0 go build`.
- [ ] The final image is `distroless/static` or `scratch`.
- [ ] The container runs and the image is small (compare to a `golang`-based image).

---

## Task 8: Inspect the cache

Observe caching behavior.

**Acceptance criteria**
- [ ] First `go build ./...` is slow; immediate rebuild is near-instant.
- [ ] `go build -x .` shows cache reuse for unchanged packages.
- [ ] Changing one source file rebuilds only the affected packages (observe with `-v`).
