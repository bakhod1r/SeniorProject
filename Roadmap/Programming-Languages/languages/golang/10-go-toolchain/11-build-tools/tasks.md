# Build Tools — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. You need Go 1.21+ and the tools installed (`brew install make go-task mage goreleaser ko bufbuild/buf/buf` or your platform's equivalent).

---

## Task 1: Write a Makefile

Start with a small program at `./cmd/server/main.go` that prints `"server v" + version`. Write a `Makefile` with these targets:

- `build` — produce `bin/server` with `-X main.version=$(git describe --tags --always)`.
- `test` — `go test -race ./...`.
- `lint` — `go vet ./...`.
- `clean` — `rm -rf bin/`.

**Acceptance criteria**
- [ ] `make build` produces `bin/server`; running it prints the git-derived version.
- [ ] `make build test lint` runs all three in order.
- [ ] The Makefile uses `.PHONY` correctly and a `VERSION ?=` variable that you can override (`make build VERSION=foo`).
- [ ] `make clean` removes the binary.

---

## Task 2: Port it to a Taskfile

Translate the Makefile to `Taskfile.yml` (`task` v3). Keep behaviour identical.

**Acceptance criteria**
- [ ] `task build`, `task test`, `task lint`, `task clean` all work.
- [ ] `task --list` shows each task with a `desc:`.
- [ ] `build` uses `sources:`/`generates:` so a second `task build` with no source changes prints "task: Task `build` is up to date".
- [ ] `task default` runs `build`.

---

## Task 3: Port it to a magefile

Translate the same workflow to a `magefile.go` with `//go:build mage`.

**Acceptance criteria**
- [ ] `mage -l` lists `Build`, `Test`, `Lint`, `Clean`.
- [ ] `mage build` produces an identical `bin/server` (same flags, same version embedding).
- [ ] `Build` declares a dependency on `Lint` via `mg.Deps(Lint)`; running `mage build` runs lint first.
- [ ] `go build ./...` in the repo still succeeds (the mage tag prevents compilation conflicts).

---

## Task 4: Minimal `goreleaser` config

Add `.goreleaser.yaml` to build `cmd/server` for `(linux, darwin) x (amd64, arm64)`.

**Acceptance criteria**
- [ ] `goreleaser check` reports no errors.
- [ ] `goreleaser release --snapshot --clean` produces a `dist/` with 4 binaries, 4 archives, and `checksums.txt`.
- [ ] Each binary, when run on the matching platform, prints the correct version.
- [ ] Embedded `-ldflags` use `-s -w -X main.version={{.Version}} -X main.commit={{.Commit}}`.
- [ ] No actual publish happened (you used `--snapshot`).

---

## Task 5: Build an OCI image with `ko`

Add a `.ko.yaml` if you need custom config. Set `KO_DOCKER_REPO=ko.local` (local mode) or your real registry.

**Acceptance criteria**
- [ ] `ko build --local --bare ./cmd/server` produces a local image; `docker images` (or `crane manifest`) shows it.
- [ ] The image has only one application layer (your binary).
- [ ] Running `docker run --rm ko.local/server` prints the version line.
- [ ] You rebuilt from the same commit twice and the resulting image **digest is identical**.

---

## Task 6: Generate Go from a proto with `buf`

Create `proto/v1/hello.proto` defining `service HelloService { rpc SayHi(...) returns (...) }`. Add `buf.yaml`, `buf.gen.yaml`.

**Acceptance criteria**
- [ ] `buf lint` passes (you fixed any style issues it reported).
- [ ] `buf generate` produces `gen/go/v1/hello.pb.go` and `gen/go/v1/hello_grpc.pb.go`.
- [ ] `go build ./...` compiles after generation.
- [ ] `buf.lock` is committed.
- [ ] Plugin versions in `buf.gen.yaml` are pinned (no `latest`).

---

## Task 7: Wire one tool into GitHub Actions

Pick **one** of the above (recommendation: `goreleaser`) and write `.github/workflows/release.yml` that triggers on git tags `v*`.

**Acceptance criteria**
- [ ] Workflow uses `actions/checkout@v4` with `fetch-depth: 0`.
- [ ] `actions/setup-go@v5` pins the Go version.
- [ ] `goreleaser/goreleaser-action@v6` is pinned and uses `args: release --clean`.
- [ ] The `GITHUB_TOKEN` is passed via `env:`, not hard-coded.
- [ ] Pushing a tag (or running locally with `act`) successfully produces release artifacts.

---

## Task 8: Unify the front door

Reduce duplication: keep one Makefile as the human entry point and have it delegate to `goreleaser build --snapshot --single-target` so `make build` and `goreleaser release` produce identical binaries.

**Acceptance criteria**
- [ ] `make build` calls `goreleaser build --snapshot --single-target` (not a direct `go build`).
- [ ] `sha256sum bin/server` and `sha256sum dist/server_*_$(uname -s | tr A-Z a-z)_$(uname -m | sed 's/x86_64/amd64/')/server` match.
- [ ] No `-ldflags` is written in the Makefile — all flags live in `.goreleaser.yaml`.

---

## Task 9: Add a generate-then-build pipeline

Wire `buf generate` into your build tool of choice (Make, Task, or Mage) so that `make build` (or equivalent) runs `buf generate` first **only if** any `.proto` file changed since the last generation.

**Acceptance criteria**
- [ ] First `make build` after editing a `.proto` runs `buf generate`, then `go build`.
- [ ] A second `make build` with no `.proto` change skips `buf generate`.
- [ ] CI runs `buf generate && git diff --exit-code` to fail when someone forgot to regenerate.
- [ ] Generated code under `gen/go/` is committed (or excluded — your call, but document it).
