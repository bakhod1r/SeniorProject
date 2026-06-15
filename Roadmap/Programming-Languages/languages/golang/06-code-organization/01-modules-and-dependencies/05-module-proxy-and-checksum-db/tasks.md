# Module Proxy & Checksum Database — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are at the end.

---

## Easy

### Task 1 — Inspect your fetch configuration

Print and interpret your current settings:

```bash
go env GOPROXY GOSUMDB GOPRIVATE GONOPROXY GONOSUMDB GOMODCACHE
```

Write down, in plain English, what each value means: where modules come from, how integrity is checked, which paths are private, and where the cache lives.

**Goal.** Be able to read a Go environment and explain its supply-chain posture at a glance.

---

### Task 2 — Speak the proxy protocol with `curl`

Without using `go` at all, query the public proxy by hand:

```bash
base=https://proxy.golang.org
curl "$base/github.com/google/uuid/@v/list"
curl "$base/github.com/google/uuid/@v/v1.6.0.info"
curl "$base/github.com/google/uuid/@v/v1.6.0.mod"
curl "$base/github.com/google/uuid/@latest"
curl -sO "$base/github.com/google/uuid/@v/v1.6.0.zip" && ls -lh v1.6.0.zip
```

Identify what each endpoint returned and in what format.

**Goal.** Internalise that the proxy is just HTTP, and the five endpoints are the whole surface.

---

### Task 3 — Read a `go.sum` line by line

Create a module, add a dependency, and dissect `go.sum`:

```bash
mkdir sumread && cd sumread
go mod init example.com/sumread
cat > main.go <<'EOF'
package main
import ("fmt"; "github.com/google/uuid")
func main() { fmt.Println(uuid.New()) }
EOF
go mod tidy
cat go.sum
```

For each line, state whether it hashes the *zip* or the *`go.mod`*, and what the `h1:` prefix means.

**Goal.** Read the integrity record fluently and know there are two lines per version.

---

### Task 4 — Watch a fetch and a sumdb verification happen

Run a fresh fetch with the trace flag:

```bash
go clean -modcache
GOPROXY=https://proxy.golang.org,direct go get -x github.com/google/uuid@v1.6.0 2>&1 | head -40
```

Identify in the output: the proxy request(s), and (if visible) the sumdb verification. Then look at the cached sumdb state:

```bash
ls "$(go env GOMODCACHE)/cache/download/sumdb/"
```

**Goal.** See the proxy + sumdb machinery actually run, not just read about it.

---

### Task 5 — Prove an offline build

Warm the cache, then forbid the network and build:

```bash
go mod download
GOPROXY=off go build ./...
```

Then, in a *new* module with a dependency you have never fetched, run `GOPROXY=off go build ./...` and observe the error.

**Goal.** Distinguish "cached, builds offline" from "missing, fails loudly," and learn that `GOPROXY=off` proves hermeticity.

---

## Medium

### Task 6 — Serve the module cache as a `file://` proxy

The cache's `cache/download/` tree is the proxy protocol on disk. Use it directly:

```bash
go mod download                       # populate the cache
GOPROXY="file://$(go env GOMODCACHE)/cache/download" GOSUMDB=off \
  go build ./...
```

Confirm the build succeeds using only the local cache as a proxy. Then list the directory and match its layout to the protocol endpoints.

**Goal.** Understand that a "private proxy" can be as simple as a directory.

---

### Task 7 — Configure a private module path

Simulate a private setup. Set `GOPRIVATE` and observe how Go changes behaviour:

```bash
go env -w GOPRIVATE='github.com/yourco/*'
go env GONOPROXY GONOSUMDB     # both now inherit the GOPRIVATE value
```

Explain why setting only `GOPRIVATE` was enough to change both `GONOPROXY` and `GONOSUMDB`.

**Goal.** Know that `GOPRIVATE` is the one setting that seeds proxy and sumdb exclusion.

---

### Task 8 — Trigger and fix a `missing go.sum entry`

Cause the error deliberately:

```bash
mkdir misssum && cd misssum
go mod init example.com/misssum
cat > main.go <<'EOF'
package main
import ("fmt"; "github.com/google/uuid")
func main() { fmt.Println(uuid.New()) }
EOF
# Add the require but NOT the go.sum entry:
go mod edit -require=github.com/google/uuid@v1.6.0
go build ./...    # error: missing go.sum entry
```

Now fix it with `go mod tidy` (or `go mod download github.com/google/uuid`) and rebuild.

**Goal.** Recognise the missing-entry error and the one-command fix.

---

### Task 9 — Compute an `h1:` hash and compare it to `go.sum`

The toolchain stores the zip hash in a `.ziphash` file. Compare:

```bash
go mod download github.com/google/uuid@v1.6.0
cat "$(go env GOMODCACHE)/cache/download/github.com/google/uuid/@v/v1.6.0.ziphash"
grep '^github.com/google/uuid v1.6.0 ' go.sum
```

Confirm the `.ziphash` value matches the bare-version line in `go.sum` (not the `/go.mod` line).

**Goal.** Connect the `h1:` in `go.sum` to the actual cached artifact's hash.

---

### Task 10 — Compare comma vs pipe fall-forward

Set up a broken first proxy and observe the two behaviours:

```bash
# Comma: a non-404 error from the first proxy ABORTS
GOPROXY='http://127.0.0.1:1/,https://proxy.golang.org' \
  go get github.com/google/uuid@v1.6.0   # likely fails (connection refused, comma)

# Pipe: a non-404 error falls forward to the public proxy
GOPROXY='http://127.0.0.1:1/|https://proxy.golang.org' \
  go get github.com/google/uuid@v1.6.0   # succeeds (pipe forgives the error)
```

Explain why the comma case failed and the pipe case succeeded.

**Goal.** See the comma/pipe distinction with your own eyes, and understand its governance implication.

---

## Hard

### Task 11 — Build a minimal pass-through proxy

Write a small Go HTTP server that serves the proxy protocol by forwarding to `proxy.golang.org` and caching responses to a local directory. Then point `go` at it:

```bash
GOPROXY=http://localhost:8080 GOSUMDB=off go get github.com/google/uuid@v1.6.0
```

Confirm the fetch succeeds, the cache directory fills, and a second fetch is served locally.

**Goal.** Prove that the proxy protocol is trivial enough to implement, and that a pass-through proxy cannot corrupt content.

---

### Task 12 — Air-gapped build via cache transfer

Simulate an air-gap:

```bash
# Connected machine:
go mod download all
tar -czf modcache.tgz -C "$(go env GOMODCACHE)" cache/download

# "Air-gapped" machine (or a fresh GOMODCACHE):
mkdir /tmp/airgap && tar -xzf modcache.tgz -C /tmp/airgap
GOPROXY="file:///tmp/airgap/cache/download" GOSUMDB=off GOPROXY_OFF= \
  go build ./...
```

Confirm the build works with no access to `proxy.golang.org`.

**Goal.** Execute the canonical air-gap workflow: warm, transport, serve.

---

### Task 13 — Reproduce and reason about a checksum mismatch

Deliberately corrupt the cache and watch the security check fire:

```bash
go mod download github.com/google/uuid@v1.6.0
# Make the cache writable and corrupt the extracted source:
chmod -R u+w "$(go env GOMODCACHE)/github.com/google/uuid@v1.6.0"
echo "// tampered" >> "$(go env GOMODCACHE)/github.com/google/uuid@v1.6.0/uuid.go"
go mod verify     # should report the module as modified
```

Then recover:

```bash
go clean -modcache
go mod download github.com/google/uuid@v1.6.0
go mod verify     # clean again
```

**Goal.** See `go mod verify` detect tampering, and practice the safe recovery (never delete `go.sum`).

---

### Task 14 — Inspect the sumdb directly

Query the checksum database by hand and read a lookup record:

```bash
curl https://sum.golang.org/lookup/github.com/google/uuid@v1.6.0
curl https://sum.golang.org/latest
```

Identify in the `lookup` output: the two `go.sum` lines, the leaf index, and the signed tree head. Note that the response is a *signed note*.

**Goal.** See the sumdb's actual protocol — lookups, STHs, signatures — not just the abstraction.

---

### Task 15 — Verify a build is fully hermetic

For a non-trivial project (10+ deps), prove the build needs no network:

```bash
go mod download all          # warm everything
go clean -cache              # clear the BUILD cache (not the module cache)
GOPROXY=off GOSUMDB=off GOFLAGS=-mod=readonly time go build ./...
```

If anything fails, identify which step tried to reach the network and why (often `go generate`, a `tools.go` dependency, or a toolchain download). Pin the toolchain with `GOTOOLCHAIN=local` and retry.

**Goal.** Achieve and verify a hermetic build end-to-end.

---

## Bonus / Stretch

### Task 16 — Parse `go.sum` programmatically

Write a Go (or shell) tool that reads `go.sum` and emits JSON: `{module, version, zipHash, modHash}` per version. Then answer:

- How many distinct module versions are pinned?
- Are there any versions with only a `/go.mod` line (graph-only, never built)?

**Goal.** Understand the `go.sum` format well enough to script around it.

---

### Task 17 — Set up Athens locally

Run the open-source Athens proxy in Docker and point `go` at it:

```bash
docker run -d -p 3000:3000 -e ATHENS_DISK_STORAGE_ROOT=/tmp/athens \
  gomods/athens:latest
GOPROXY=http://localhost:3000 GONOSUMDB= go get github.com/google/uuid@v1.6.0
```

Confirm Athens caches the module on disk and serves a second fetch from cache. Explore its storage layout.

**Goal.** Operate a real self-hosted proxy, not just the `file://` shortcut.

---

### Task 18 — Measure proxy vs direct fetch time

Compare fetching the same module through the proxy versus `direct` VCS:

```bash
go clean -modcache
GOPROXY=https://proxy.golang.org time go get github.com/spf13/cobra@latest

go clean -modcache
GOPROXY=direct time go get github.com/spf13/cobra@latest
```

Record both times. Explain why `direct` is usually slower (full VCS clone vs cached zip).

**Goal.** Quantify why the proxy exists — speed, not just availability.

---

### Task 19 — Configure a private sumdb (custom key)

Read the `GOSUMDB` documentation for the `name+hash+key` form. Understand how an organisation would run its own transparency log:

```bash
go help environment   # find the GOSUMDB section
# GOSUMDB="sumdb.corp.example.com+<keyhash>+<publickey>"
```

Document how a private sumdb plus a private proxy (proxying `/sumdb/`) keeps integrity verification working entirely inside a corporate network.

**Goal.** Understand that the sumdb is replaceable, not hardwired to `sum.golang.org`.

---

### Task 20 — Privacy audit: what leaks to the public proxy?

For a project with both public and private imports, determine what fetch metadata would leak to `proxy.golang.org` / `sum.golang.org` if `GOPRIVATE` were unset:

```bash
go env GOPRIVATE        # check current setting
go list -m all          # the full module graph — these paths would be requested
```

Identify which module paths are internal/sensitive, then write the correct `GOPRIVATE` value to exclude them. Make a written recommendation.

**Goal.** Treat fetch metadata as a privacy/information-security concern, and configure `GOPRIVATE` deliberately.

---

## Solutions (sketched)

### Solution 1
`GOPROXY` = where modules come from; `GOSUMDB` = the global integrity oracle; `GOPRIVATE`/`GONOPROXY`/`GONOSUMDB` = which paths bypass the public infra; `GOMODCACHE` = on-disk cache location. Defaults: `https://proxy.golang.org,direct` and `sum.golang.org`.

### Solution 2
`list` → newline versions; `.info` → JSON `{Version, Time}`; `.mod` → the `go.mod`; `@latest` → JSON for the latest version; `.zip` → the source archive. All plain HTTP GET.

### Solution 3
Two lines per version: `... v1.6.0 h1:...` hashes the *zip*; `... v1.6.0/go.mod h1:...` hashes the *`go.mod`*. `h1:` names the hashing scheme (SHA-256 of a sorted per-file manifest, base64).

### Solution 4
You'll see GET requests to `proxy.golang.org/.../@v/...` and sumdb traffic under `cache/download/sumdb/`. The sumdb directory contains cached tiles, `latest` (STH), and `lookup/` records.

### Solution 5
With a warm cache, `GOPROXY=off` builds fine. In a module with an unfetched dep, it errors: `module lookup disabled by GOPROXY=off`. That error *is* the offline guarantee surfacing.

### Solution 6
The build succeeds reading from `cache/download/` over `file://`. The directory layout (`<M>/@v/list`, `.info`, `.mod`, `.zip`) matches the protocol endpoints exactly — that's why it works as a proxy.

### Solution 7
`GOPRIVATE` provides the *default* for both `GONOPROXY` (skip proxy, use VCS) and `GONOSUMDB` (skip the public checksum database). Setting it once covers both concerns.

### Solution 8
`go mod edit -require` adds a `require` without a `go.sum` entry, so the build fails with `missing go.sum entry`. `go mod tidy` (or `go mod download <module>`) fetches, verifies via the sumdb, and writes the entry.

### Solution 9
The `.ziphash` file holds the `h1:` of the zip — identical to the bare-version line in `go.sum`. The `/go.mod` line is a *different* hash (of the `go.mod` file only).

### Solution 10
Comma forgives only 404/410; a connection-refused error from the first proxy is *not* a 404, so the comma case aborts. Pipe forgives *any* error, so it falls forward to the public proxy and succeeds.

### Solution 11
A pass-through proxy maps the URL path to a cache file, serves it if present, else fetches upstream and tees to disk (temp + atomic rename). It cannot corrupt content — any alteration changes the `h1:` and fails verification. Second fetches are served locally.

### Solution 12
`go mod download all` populates `cache/download/`; tar it, move it, serve via `file://`. `GOSUMDB=off` (or proxy the sumdb tiles) since the global log is unreachable. Build needs no internet.

### Solution 13
`go mod verify` re-hashes the cache against `go.sum` and reports `dir has been modified`. Recovery: `go clean -modcache && go mod download`. Never delete `go.sum`.

### Solution 14
`/lookup/...` returns the two `go.sum` lines plus the leaf index, all wrapped in a signed note. `/latest` returns the signed tree head. The signature is verifiable against the sumdb's public key (baked into the toolchain).

### Solution 15
Warm everything, clear the *build* cache (not the module cache), then `GOPROXY=off` build. Failures usually come from `go generate`, `tools.go` deps, or a toolchain fetch — pin with `GOTOOLCHAIN=local`. Success proves hermeticity.

### Solution 16
Parse line by line: split on spaces; a `/go.mod` suffix on the version field marks the go.mod hash; otherwise it's the zip hash. Group by `(module, version)`. Versions with only a `/go.mod` line were in the graph but never built.

### Solution 17
Athens caches modules under its storage root and serves subsequent fetches from disk. It can also proxy the sumdb. It's the canonical self-hosted proxy when `file://` isn't enough.

### Solution 18
`direct` clones the full VCS history (slow); the proxy serves a cached, pre-packaged zip (fast). The gap widens for large repos with deep histories.

### Solution 19
`GOSUMDB="name+hash+key"` points Go at a private transparency log. Combined with a proxy that forwards `/sumdb/`, integrity verification works entirely inside the corporate network — no dependency on `sum.golang.org`.

### Solution 20
Without `GOPRIVATE`, every path from `go list -m all` would be requested from the public proxy/sumdb, leaking internal module names. Set `GOPRIVATE` to a glob covering all internal hosts/orgs; document which paths were sensitive and why exclusion matters.

---

## Checkpoints

After completing the easy tasks: you can read a Go fetch configuration, speak the proxy protocol with `curl`, dissect `go.sum`, and prove an offline build.
After completing the medium tasks: you can serve the cache as a proxy, configure private modules, compute and match `h1:` hashes, fix a missing-entry error, and demonstrate comma/pipe fall-forward.
After completing the hard tasks: you can build a minimal proxy, execute an air-gapped build, reason about a checksum mismatch safely, inspect the sumdb directly, and verify hermeticity end-to-end.
After completing the bonus tasks: you have operated Athens, scripted around `go.sum`, measured proxy-vs-direct cost, understood private sumdb keys, and performed a fetch-metadata privacy audit.
