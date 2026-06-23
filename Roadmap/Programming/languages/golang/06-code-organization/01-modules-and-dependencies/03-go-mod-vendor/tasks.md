# `go mod vendor` — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are at the end.

---

## Easy

### Task 1 — Vendor a fresh project

Create a new module `example.com/vendordemo`. Add a single dependency: `github.com/google/uuid`. Write a `main.go` that prints `uuid.New().String()`. Run `go mod tidy`, then run `go mod vendor`.

Inspect the result:

- `vendor/` directory exists at the module root.
- `vendor/github.com/google/uuid/` contains the dependency's Go source files.
- `vendor/modules.txt` exists.

**Goal.** See what `go mod vendor` actually produces on disk.

---

### Task 2 — Read `vendor/modules.txt` line by line

Open the `vendor/modules.txt` file from Task 1. Identify each line's role:

- `# <module> <version>` — a module header.
- `## explicit` — this module appears in your `go.mod`'s `require` block (not transitive).
- `<package-path>` — a package within the module that is actually imported.

Now add a transitive dependency (e.g. add a small library that itself depends on something else). Re-run `go mod vendor`. Compare the new `modules.txt` and identify the line that no longer has `## explicit`.

**Goal.** Read the format until you can predict its output before running the command.

---

### Task 3 — Build with vendor (offline)

After Task 1, simulate offline mode:

```bash
GOFLAGS=-mod=vendor GOPROXY=off go build .
```

Confirm the binary builds successfully and never reaches out to the proxy. Then in a different module *without* a `vendor/` directory, run the same command and observe the error.

**Goal.** Internalise that vendoring eliminates network dependency.

---

### Task 4 — Build with `-mod=mod` to bypass vendor

In the same project, run:

```bash
go build -mod=mod .
```

Compare the behaviour with the implicit (vendored) build. With `-mod=mod`, the toolchain consults the module cache and proxy instead of `vendor/`. Try editing one file in `vendor/github.com/google/uuid` and rebuild with both modes; observe which mode actually picks up your change.

**Goal.** Understand the three values of `-mod`: `mod`, `readonly`, `vendor` — and that vendor is the default when `vendor/modules.txt` exists and `go.mod`'s `go` line is `1.14+`.

---

### Task 5 — Stale-vendor detection

Without re-running `go mod vendor`, edit `main.go` and add a brand-new import like `github.com/sirupsen/logrus`. Run `go mod tidy`. Then run `go build .`. You will see something like:

```
go: inconsistent vendoring in /path/to/project:
        github.com/sirupsen/logrus@vX.Y.Z: is explicitly required in go.mod, but not marked as explicit in vendor/modules.txt
        run 'go mod vendor' to sync
```

Run `go mod vendor` to fix. Confirm the build succeeds.

**Goal.** Recognise the stale-vendor error message and the one-command fix.

---

## Medium

### Task 6 — Vendor a project with `replace`

Create a tiny module `example.com/forked-uuid` somewhere local on disk. Make it a drop-in replacement for `github.com/google/uuid` (keep the same package name and exported `New` function — return a fixed string for a sanity check).

In your main project, add to `go.mod`:

```
replace github.com/google/uuid => ../forked-uuid
```

Run `go mod vendor`. Inspect `vendor/github.com/google/uuid/` and confirm it contains *your* code, not the upstream. Note that `vendor/modules.txt` records the replace directive.

**Goal.** Understand that `replace` is honoured when vendoring.

---

### Task 7 — Multi-platform imports

Create a project with build-constrained files:

```
//go:build linux
package foo
// uses golang.org/x/sys/unix
```

```
//go:build darwin
package foo
// uses golang.org/x/sys/unix (different symbols)
```

Run `go mod vendor`. Inspect `vendor/golang.org/x/sys/`. Notice that `go mod vendor` copies the *files needed by all GOOS/GOARCH combinations declared in your sources*, not only the host platform. Use `find vendor/golang.org/x/sys -name '*_linux.go'` and similar to verify.

**Goal.** Know that vendoring is platform-agnostic by design.

---

### Task 8 — `go mod verify` after vendor

Run `go mod verify` in a vendored project. It checks the *module cache*, not `vendor/`. So vendoring does not bypass checksum verification of the cache. Try this:

1. Touch a file in `vendor/` (add a comment).
2. Run `go mod verify`. It still passes.
3. Run `go build .`. With vendor mode, the tampered comment compiles into the binary.

**Goal.** Understand that `vendor/` is not protected by `go.sum` once copied — auditing is on you.

---

### Task 9 — Docker build with vendor (no network)

Write a `Dockerfile`:

```dockerfile
FROM golang:1.22 AS build
WORKDIR /src
COPY go.mod go.sum ./
COPY vendor ./vendor
COPY . .
RUN GOFLAGS=-mod=vendor GOPROXY=off go build -o /out/app .

FROM gcr.io/distroless/base-debian12
COPY --from=build /out/app /app
ENTRYPOINT ["/app"]
```

Build with `docker build --network=none .` once you have already pulled the base images. Confirm the build succeeds with no network access during the Go compile step.

**Goal.** Build hermetic CI/CD pipelines with vendored dependencies.

---

### Task 10 — CI vendor-drift gate

Add a GitHub Actions step:

```yaml
- run: |
    go mod vendor
    git diff --exit-code vendor/ go.mod go.sum
```

Push a PR that adds a new import without re-vendoring. Confirm CI catches the drift and fails the PR.

**Goal.** Build the canonical vendor-discipline guard for a team repo.

---

## Hard

### Task 11 — Vendor and go offline

Vendor a non-trivial project (10+ direct deps). Then physically disconnect from the network or set:

```bash
export GOPROXY=off
export GOFLAGS=-mod=vendor
go clean -modcache
```

Build the project. It must succeed. If anything fails, identify which step tried to hit the network and why.

**Goal.** Test the offline guarantee end-to-end. The module cache being wiped is the strongest test.

---

### Task 12 — Patch a dependency via `replace` + vendor

Find a real library you depend on (e.g. `github.com/spf13/cobra`). You discover a small bug. Procedure:

1. Fork the library on GitHub.
2. `git clone` your fork to `../cobra-fork`.
3. Apply your patch.
4. In your project's `go.mod`, add `replace github.com/spf13/cobra => ../cobra-fork`.
5. Run `go mod vendor`.
6. Verify `vendor/github.com/spf13/cobra/` contains your patched code.
7. Build. The patch is now shipped *with* your project, no upstream dependency.

**Goal.** Use vendor as a patching mechanism for emergencies (CVE response, blocked-on-upstream).

---

### Task 13 — Multi-module monorepo with per-module vendor

Set up:

```
mono/
├── service-api/
│   ├── go.mod
│   └── vendor/
├── service-worker/
│   ├── go.mod
│   └── vendor/
└── shared/
    └── go.mod
```

Each service vendors independently. CI matrix runs `go build -mod=vendor ./...` per module. Demonstrate that updating `shared` requires re-vendoring both consumers.

**Goal.** Work with vendor in a polyrepo-in-monorepo style.

---

### Task 14 — Vendor-drift scanner across many repos

Write a Go (or shell) tool that, given a directory of git repos, for each repo:

1. Clones it (or `git pull`).
2. Runs `go mod vendor` in each module root.
3. Reports `git status --porcelain vendor/ go.mod go.sum`.
4. Flags repos with non-empty output as "drifted".

Run it across an organisation's repos. Identify the worst offenders.

**Goal.** Operational tooling for dependency hygiene at scale.

---

### Task 15 — Parse `vendor/modules.txt` programmatically

Write a Go program that opens `vendor/modules.txt` and emits a JSON list of `{module, version, explicit, packages: []}`. Feed it through `jq` to answer questions like:

- How many transitive deps?
- Which deps contribute the most packages?
- Are there unused (no-package-listed) modules?

**Goal.** Understand the format well enough to script around it.

---

## Bonus / Stretch

### Task 16 — Forensics on a stale `vendor/`

You inherit a repo where `vendor/` is months out of date and someone has been hand-editing `go.mod` without re-vendoring. Procedure:

1. `git stash` any local changes.
2. `cp -r vendor /tmp/vendor-old`.
3. `go mod vendor`.
4. `diff -r /tmp/vendor-old vendor/` to enumerate every drift.
5. Categorise: removed deps, added deps, version bumps, hand-edits inside `vendor/`.

**Goal.** Diagnose what a sloppy team did to the tree.

---

### Task 17 — Vendor differ tool

Build a `vendordiff` CLI: given two `vendor/` trees (e.g. `git checkout main -- vendor/` vs current), produce a summary:

```
+ github.com/foo/bar v1.2.0  (added)
- github.com/baz/old v0.9.1  (removed)
~ github.com/qux/lib v1.0.0 -> v1.1.0  (bumped)
```

Use `vendor/modules.txt` from each side as the source of truth. Bonus: emit the changelog-impact (CVE-fixed, breaking changes) by querying GitHub releases.

**Goal.** Build the missing UX layer around vendor diffs.

---

### Task 18 — Re-vendor to fix a CVE

Pick a real CVE in a Go library (search `pkg.go.dev/vuln`). Reproduce:

1. Pin the project to the vulnerable version.
2. `govulncheck ./...` confirms the vulnerability.
3. Bump in `go.mod` to a fixed version.
4. `go mod vendor`.
5. `govulncheck ./...` is clean.
6. Commit `go.mod`, `go.sum`, and `vendor/`.

**Goal.** Use vendor as the artifact that proves the fix is shipped.

---

### Task 19 — Vendor to a non-default location

Read `go help mod vendor`. Use `-o` to vendor to a custom path:

```bash
go mod vendor -o third_party
```

Note: when `-o` is used, the toolchain does *not* automatically pick up the alternate location for builds. You must either symlink, or accept this only as an export step (e.g. for code-review tooling, or to feed an SBOM scanner). Document the limitation.

**Goal.** Know the flag and its real-world utility (and limits).

---

### Task 20 — Repo size with and without vendor

For a real project:

1. `du -sh .` (with vendor).
2. `du -sh --exclude vendor .` (without).
3. Compute the ratio.

For each "factor of N" your repo grows when vendoring, weigh it against the offline-build guarantee. Make a written recommendation: "we should/should not vendor this repo". Examples of inputs to the decision:

- Build-server network reliability.
- CVE response time targets.
- Whether this repo ships binaries to airgapped environments.

**Goal.** Make vendor a deliberate choice, not a default.

---

## Solutions (sketched)

### Solution 1
```bash
mkdir vendordemo && cd vendordemo
go mod init example.com/vendordemo
cat > main.go <<'EOF'
package main
import ("fmt"; "github.com/google/uuid")
func main() { fmt.Println(uuid.New().String()) }
EOF
go mod tidy
go mod vendor
ls vendor/github.com/google/uuid
cat vendor/modules.txt
```

### Solution 2
The format:
```
# github.com/google/uuid v1.6.0
## explicit; go 1.19
github.com/google/uuid
```
A transitive dep loses the `## explicit` tag because nothing in your `go.mod`'s `require` block names it directly.

### Solution 3
With vendor + `GOPROXY=off`, the build never touches the network. Without `vendor/`, the same flags fail with a "module lookup disabled" error.

### Solution 4
`-mod=mod` reads from the module cache, ignoring `vendor/`. Vendor edits are silently invisible. `-mod=vendor` (or default with `vendor/modules.txt` present) reads from disk and your edits compile in.

### Solution 5
The error message includes the offending module and the fix command. `go mod vendor` rewrites both `vendor/modules.txt` and the file tree.

### Solution 6
`vendor/modules.txt` will contain a line like:
```
# github.com/google/uuid v0.0.0-00010101000000-000000000000 => ../forked-uuid
## explicit; go 1.22
```
The actual files come from your fork.

### Solution 7
`go mod vendor` copies build-constrained files for *every* `(GOOS, GOARCH)` discovered in your code, plus all the standard ones for the modules. It does *not* prune by host platform.

### Solution 8
`go mod verify` checks `$GOMODCACHE` against `go.sum`. It does not hash anything inside `vendor/`. After vendoring, your `vendor/` tree is a regular checked-in directory; protect it via code review.

### Solution 9
Key flags: `GOFLAGS=-mod=vendor`, `GOPROXY=off`. Use `--network=none` on `docker build` to *prove* hermeticity.

### Solution 10
```yaml
- name: Vendor drift gate
  run: |
    go mod vendor
    git diff --exit-code vendor/ go.mod go.sum || \
      (echo "Run 'go mod vendor' before pushing" && exit 1)
```

### Solution 11
Disconnect, wipe `$GOMODCACHE`, set `GOPROXY=off`. The build must succeed purely from `vendor/`. If it fails, look for: build tools (e.g. `go run tool.go`) reaching for a module not in `vendor/`, code-generation steps, or `tools.go` patterns.

### Solution 12
After `replace` + vendor, the patch lives in `vendor/<original-path>/`. Build artifacts are fully self-contained. To upstream the fix later, send a PR from `../cobra-fork` and revert the `replace` once it's merged.

### Solution 13
Run `go mod vendor` separately in each module. CI matrix:
```yaml
strategy:
  matrix:
    module: [service-api, service-worker]
steps:
  - run: cd ${{ matrix.module }} && go build -mod=vendor ./...
```
A bump in `shared` requires re-vendoring in both consumers — vendor surfaces the discipline cost.

### Solution 14
```bash
for repo in repos/*; do
  (cd "$repo" && go mod vendor && \
    git status --porcelain vendor/ go.mod go.sum)
done
```
Wrap in a Go program for parallelism, retries, and structured output.

### Solution 15
```go
import "bufio"; import "strings"
// each module starts with "# "; "## explicit" line is metadata;
// other non-comment lines are package import paths within the current module.
```
Walk the file with a small state machine.

### Solution 16
Hand-edits inside `vendor/` are the worst kind of drift — they look like upstream code but aren't. After re-vendoring, those edits silently disappear unless they were also reflected in a `replace` directive.

### Solution 17
Compare two `vendor/modules.txt` files. Treat each as a map from module path to version. Set difference for added/removed; intersection with version-mismatch for bumped.

### Solution 18
The chain `govulncheck` -> bump -> `go mod vendor` -> commit is the canonical CVE-response workflow. The committed `vendor/` makes the fix auditable in the same PR as the version bump.

### Solution 19
```bash
go mod vendor -o third_party
```
The `-o` form is not picked up by `-mod=vendor`. Treat as export-only.

### Solution 20
```bash
du -sh .                    # 480M
du -sh --exclude vendor .   # 12M
```
Factor 40x. For an airgapped deploy target, worth it. For a small tool with two deps, probably not.

---

## Checkpoints

After completing the easy tasks: you can vendor a project, read `modules.txt`, and recognise the stale-vendor error.
After completing the medium tasks: you can vendor with `replace`, vendor cross-platform, build hermetic Docker images, and gate vendor drift in CI.
After completing the hard tasks: you can run offline builds, ship CVE patches via `replace`+vendor, manage per-module vendor in monorepos, and parse `vendor/modules.txt` programmatically.
After completing the bonus tasks: you have built tooling around vendor — drift detection, vendor-diff, CVE response — and you can defend (or refuse) the decision to vendor on a per-repo basis.
