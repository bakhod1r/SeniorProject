# Using Third-Party Packages — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are at the end.

---

## Easy

### Task 1 — Your first dependency

In a fresh module, add `github.com/google/uuid`. Write a `main.go` that generates a UUID v4 and prints it. Confirm:

- `go.mod` contains a `require github.com/google/uuid` line.
- `go.sum` was created and lists the module + its checksum.
- The program prints a 36-character UUID like `a1b2c3d4-...`.

**Goal.** Walk the smallest possible "import a library" path end-to-end.

---

### Task 2 — A "hello" CLI with cobra

Add `github.com/spf13/cobra`. Build a CLI with one root command `hello` that prints `Hello, world!`. Then add a sub-command `hello name <yourname>` that prints `Hello, <yourname>!`. Confirm `go run . hello name Alice` works.

**Goal.** Use a real third-party framework — feel the difference between the standard library's `flag` and a full CLI library.

---

### Task 3 — Pin a specific version

Add `github.com/spf13/viper` *not* at latest, but at exactly `v1.18.2`. Use:

```bash
go get github.com/spf13/viper@v1.18.2
```

Open `go.mod` and confirm the version is exactly `v1.18.2` (no `+incompatible`, no pseudo-version). Then re-run `go get github.com/spf13/viper@v1.18.2` and confirm nothing changes.

**Goal.** Practise version-locking — the foundation of reproducibility.

---

### Task 4 — Inspect every module in your build

Run:

```bash
go list -m all
```

Pick five modules from the list that you did *not* explicitly add. For each, identify whether it is a transitive dependency or a tool dep. Use `go mod why <module>` to confirm.

**Goal.** Realise how much you implicitly pull in.

---

### Task 5 — Removing a dependency

You added `github.com/spf13/viper` in Task 3. Now remove it cleanly:

```bash
go get github.com/spf13/viper@none
```

Confirm:

- `go.mod` no longer mentions viper.
- Any code that imported `viper` now fails to compile (delete or rewrite it).
- After `go mod tidy`, `go.sum` is also clean of viper.

**Goal.** Learn the canonical "remove a dep" command.

---

## Medium

### Task 6 — Minor-version upgrade

Pick a dep, e.g. `github.com/google/uuid`. Lock it at an older version (e.g. `v1.3.0`). Run:

```bash
go get github.com/google/uuid@v1.6.0
go mod tidy
```

Capture the diff of `go.mod` and `go.sum`. Were any *transitive* deps also bumped? Did any new deps appear?

**Goal.** Watch a single bump cascade through the graph.

---

### Task 7 — Why is this package here?

In a real project (or one with a few deps), pick a transitive package you do not recognise. Run `go mod why <package>`. Read the output: it shows the import chain from your code to that package. Pick the *shortest* such chain in your project.

**Goal.** Develop the reflex of asking "why is this in my build?"

---

### Task 8 — Local fork via `replace`

Pick a dep your project uses. Clone its repo to a local directory (e.g. `/tmp/uuid-fork`). In your project's `go.mod`, add:

```
replace github.com/google/uuid => /tmp/uuid-fork
```

Make a deliberate edit in the local fork (e.g., change a string the library logs). Build your project. Confirm the change is observable. Then drop the `replace`. Confirm the original behaviour returns.

**Goal.** Use `replace` as a development-time fork mechanism.

---

### Task 9 — Vulnerability scan

Install `govulncheck`:

```bash
go install golang.org/x/vuln/cmd/govulncheck@latest
```

Run `govulncheck ./...` against a project that depends on slightly old libraries. Pick one finding. Read the advisory link. Either:

1. Bump to a fixed version, or
2. Document why the path is not actually reachable in your code.

Re-run `govulncheck` and confirm the finding is gone (or annotated).

**Goal.** Use the official Go vulnerability tool.

---

### Task 10 — Major version migration

Take a project that imports `github.com/spf13/cobra` at `v1.x`. Imagine a hypothetical `v2.0.0` (or pick a real library that has done v2: e.g. `github.com/go-redis/redis/v9`). Walk through the migration:

1. Update the import path: `github.com/foo/bar` → `github.com/foo/bar/v2`.
2. Run `go get github.com/foo/bar/v2@latest`.
3. Run `go mod tidy`. The old version disappears from `go.mod`.
4. Fix any breaking-API call sites.

**Goal.** Internalise the SIV (semantic import versioning) rule.

---

## Hard

### Task 11 — A real CLI with three deps

Build a small CLI named `siteping` that:

- Uses `github.com/spf13/cobra` for command parsing.
- Uses `github.com/spf13/viper` to read a config file (`siteping.yaml`) listing URLs to ping.
- Uses `go.uber.org/zap` for structured logging.

Write a `make verify` target (or shell script) that runs:

```bash
go mod tidy
go build ./...
go test ./...
go list -m all | wc -l
```

Confirm the dep count is what you expect — surprisingly large because zap and viper pull in many transitive packages.

**Goal.** Feel the weight of "just three direct deps."

---

### Task 12 — Run your own GOPROXY with Athens

Install [Athens](https://docs.gomods.io/) locally (Docker is fine). Configure your project to use it:

```bash
export GOPROXY=http://localhost:3000,direct
```

Build your project. Watch Athens log requests. Disconnect from the internet. Build again — it must succeed because Athens has cached the modules.

**Goal.** Run the proxy that hyperscalers run for their internal monorepos.

---

### Task 13 — Generate an SBOM

Install `cyclonedx-gomod`:

```bash
go install github.com/CycloneDX/cyclonedx-gomod/cmd/cyclonedx-gomod@latest
```

Generate an SBOM for your project:

```bash
cyclonedx-gomod mod -json -output sbom.json .
```

Open `sbom.json`. Identify:

- The list of every component (direct + transitive).
- The licence field (if present).
- The PURL (package URL) for each component.

Optionally do the same with `syft` and compare.

**Goal.** Produce a deliverable that supply-chain auditors expect.

---

### Task 14 — License audit with `go-licenses`

Install:

```bash
go install github.com/google/go-licenses@latest
```

Run:

```bash
go-licenses report ./... > licenses.csv
```

Open `licenses.csv`. Confirm every dep has a known SPDX licence. Flag any `Unknown` rows and find their licence manually. Also try `go-licenses check ./... --disallowed_types=forbidden` to refuse GPL-style licences if your project requires it.

**Goal.** Build the licence-audit muscle.

---

### Task 15 — Adapter for a 3rd-party HTTP client

Pick a 3rd-party HTTP client library (e.g. `github.com/go-resty/resty/v2`). Build a thin adapter:

```go
package httpx

type Client interface {
    Get(ctx context.Context, url string) (Response, error)
}

type Response struct {
    Status int
    Body   []byte
}
```

Implement `Client` using `resty` *internally*, but ensure no caller of your `httpx` package needs to import `resty`. Test that swapping the implementation to `net/http` is a single-file change.

**Goal.** Practise the Adapter pattern as a defence against vendor lock-in.

---

## Bonus / Stretch

### Task 16 — Typosquat awareness

Try to add a package whose name is suspiciously close to a real one — for instance a fake `github.com/typotest/uuid` (or a real misspelt account you find on the proxy). Capture what `go get` does:

- Does the proxy resolve it?
- Does `go.sum` look any different?
- Would your IDE highlight anything?

Then revert. Note in your README what you would have caught with a `govulncheck` + SBOM gate.

**Goal.** Prove to yourself that typosquats are *not* automatically blocked. Vigilance is the gate.

---

### Task 17 — Automated dep updates

In a public GitHub repo, enable Dependabot (commit a `.github/dependabot.yml` for ecosystem `gomod`). Wait a day or two. Observe:

- The auto-PRs it opens.
- The cadence (daily / weekly).
- Group rules — try setting `groups:` to lump minor bumps together.

Alternatively, set up [Renovate](https://renovate.com/) and compare its UX.

**Goal.** Make dependency hygiene a cron job, not a hero job.

---

### Task 18 — Heavy dep — measure the cost

Build a hello-world program twice:

1. Pure stdlib `fmt.Println("hello")`.
2. Same program but importing `go.uber.org/zap` and using it for the log line.

Build both with `go build -ldflags="-s -w" -trimpath` and compare binary sizes. Document the delta. (Expect 2–10 MB.)

**Goal.** Develop a feel for the cost of adoption.

---

### Task 19 — A malformed `replace`

Create a `replace` directive that points to a module whose `go.mod` declares a *different* module path:

```
// in your go.mod:
replace github.com/google/uuid => /tmp/not-uuid
// where /tmp/not-uuid/go.mod says:
// module example.com/wrong
```

Run `go build`. Capture the error. Read it carefully — this is the toolchain protecting you against the most common `replace` mistake.

**Goal.** Memorise an error message you *will* see in real life.

---

### Task 20 — Audit a real OSS project

Pick a popular Go OSS project (e.g. one of your own dependencies). Run:

```bash
go mod graph
go list -m -u all
```

For each direct dep, check:

- When was the last commit / release?
- Is the repo archived?
- Is the maintainer responsive on issues?

Score each dep "alive / quiet / dead." This is the manual version of what tools like [deps.dev](https://deps.dev) and `osv-scanner` automate.

**Goal.** Practise the oldest skill in dependency management — judgment.

---

## Solutions (sketched)

### Solution 1
```bash
go mod init example.com/uuiddemo
go get github.com/google/uuid
cat > main.go <<'EOF'
package main
import (
  "fmt"
  "github.com/google/uuid"
)
func main() { fmt.Println(uuid.NewString()) }
EOF
go run .
```

### Solution 2
Two `cobra.Command{}` literals; a parent `rootCmd` and a `nameCmd` added with `rootCmd.AddCommand(nameCmd)`. `nameCmd.Args = cobra.ExactArgs(1)`.

### Solution 3
```bash
go get github.com/spf13/viper@v1.18.2
grep viper go.mod   # → github.com/spf13/viper v1.18.2
```
A second `go get` at the same version is a no-op.

### Solution 4
`go list -m all` prints one line per module; the first line is your module. Indirect deps lack an explicit `// indirect` only if they are not currently in `go.mod`. `go mod why pkg` prints `# pkg\n<chain>` showing the import path.

### Solution 5
```bash
go get github.com/spf13/viper@none
go mod tidy
grep viper go.mod go.sum   # → no matches
```

### Solution 6
Diff will show `uuid v1.3.0` → `v1.6.0` plus possibly bumped sub-deps (UUID is light). Heavier libraries like `cobra` or `viper` will pull in *many* transitive bumps.

### Solution 7
`go mod why golang.org/x/sys` typically shows
```
# golang.org/x/sys
yourmod
yourmod/internal/foo
github.com/foo/bar
golang.org/x/sys/unix
```
Read it bottom-up: which of *your* packages is closest to the dep?

### Solution 8
```
replace github.com/google/uuid => /tmp/uuid-fork
```
Then in `/tmp/uuid-fork`, edit `version4.go`'s `String()` method. Your project's binary now embeds the fork's behaviour.

### Solution 9
```bash
govulncheck ./...
# → Vulnerability #1: GO-2024-XXXX
go get module/with/fix@v1.2.3
go mod tidy
govulncheck ./...   # → No vulnerabilities found.
```

### Solution 10
For real `redis/v9` migration:
```bash
go get github.com/redis/go-redis/v9@latest
# update imports: "github.com/go-redis/redis/v8" → "github.com/redis/go-redis/v9"
go mod tidy
```
The old major silently drops out of `go.mod`.

### Solution 11
Module layout:
```
siteping/
├── go.mod
├── main.go              (cobra root)
├── cmd/
│   └── ping.go          (cobra command)
├── config/
│   └── config.go        (viper)
├── log/
│   └── log.go           (zap)
└── siteping.yaml
```
`go list -m all | wc -l` typically shows 50–80 modules.

### Solution 12
`docker run -p 3000:3000 gomods/athens:latest`. Then `GOPROXY=http://localhost:3000,direct go build`. Athens caches under `/var/lib/athens` (or whatever you mounted). Offline build proves the cache works.

### Solution 13
The `sbom.json` is CycloneDX 1.5. Each `component` has `type: library`, `name`, `version`, `purl: pkg:golang/...`. Optional `evidence.licenses` for licence detection.

### Solution 14
```csv
module,licence,confidence
github.com/google/uuid,BSD-3-Clause,1.0
github.com/spf13/cobra,Apache-2.0,1.0
...
```
`Unknown` rows usually mean no `LICENSE` file at the repo root — investigate manually.

### Solution 15
```go
package httpx

import "github.com/go-resty/resty/v2"

type restyClient struct{ c *resty.Client }

func New() Client { return &restyClient{c: resty.New()} }

func (r *restyClient) Get(ctx context.Context, url string) (Response, error) {
    resp, err := r.c.R().SetContext(ctx).Get(url)
    if err != nil { return Response{}, err }
    return Response{Status: resp.StatusCode(), Body: resp.Body()}, nil
}
```
Callers do `httpx.New()` — they never see `resty`.

### Solution 16
Typosquats are *not* blocked by the proxy. The only signal is a low star count and a fresh module. Real defences: pinning, SBOM diff in CI, `govulncheck`, an internal allow-list.

### Solution 17
```yaml
version: 2
updates:
  - package-ecosystem: "gomod"
    directory: "/"
    schedule:
      interval: "weekly"
    groups:
      go-deps:
        patterns: ["*"]
        update-types: ["minor", "patch"]
```

### Solution 18
Typical results:
- stdlib hello: 1.5–2.0 MB.
- with zap: 5–8 MB.
The delta is mostly zap's reflection-free encoder + atomic-level core.

### Solution 19
```
go: github.com/google/uuid@v0.0.0-... (replaced by /tmp/not-uuid):
  parsing /tmp/not-uuid/go.mod: module declares its path as: example.com/wrong
              but was required as: github.com/google/uuid
```

### Solution 20
For each direct dep, check:
- GitHub: last commit, last release, open-issue count, archived banner.
- `go list -m -u all` — flags upgrades available.
- deps.dev — gives security advisories + "Open Source Insights" graph.

---

## Checkpoints

After completing the easy tasks: you can confidently add, pin, inspect, and remove third-party libraries.
After completing the medium tasks: you can perform minor and major version upgrades, fork via `replace`, and run vulnerability scans.
After completing the hard tasks: you can build production CLIs, run a private proxy, generate SBOMs, and audit licences.
After completing the bonus tasks: you understand supply-chain hygiene at the level of running it for a team.
