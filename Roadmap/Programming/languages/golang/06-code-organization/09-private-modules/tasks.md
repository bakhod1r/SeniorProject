# Private Modules — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to set up, what success looks like, and a hint or expected outcome. Solutions are at the end.

---

## Easy

### Task 1 — Reproduce the `410 Gone` error

In a fresh module, try to import a private repo (your own GitHub, must be set Private) without any configuration:

```bash
mkdir /tmp/tasktest && cd /tmp/tasktest
go mod init demo
echo 'package main; import _ "github.com/your-username/your-private-repo"; func main() {}' > main.go
go mod tidy
```

**Expected.** Failure with `410 Gone` from `proxy.golang.org`. Capture the exact error.

**Goal.** See the canonical "private module not configured" failure.

---

### Task 2 — Fix it with `GOPRIVATE`

In the same project from Task 1, set `GOPRIVATE`:

```bash
go env -w GOPRIVATE='github.com/your-username/*'
go mod tidy
```

**Expected.** Either it works (you have valid Git creds), or you get a Git auth error. Note which one.

**Goal.** See `GOPRIVATE` flip the routing.

---

### Task 3 — Configure HTTPS via `.netrc`

Create a GitHub classic PAT with `repo` scope. Add it to `~/.netrc`:

```
machine github.com
  login your-username
  password ghp_<your-token>
```

`chmod 600 ~/.netrc`. Re-run `go mod tidy`. Confirm success.

**Goal.** Practise the most common credential mechanism.

---

### Task 4 — Configure SSH

Generate a fresh SSH key (or use an existing one). Add the public half to GitHub. Add this to `~/.gitconfig`:

```
[url "git@github.com:"]
    insteadOf = https://github.com/
```

Remove the `.netrc` you set up in Task 3. Re-run `go mod tidy`. Confirm success.

**Goal.** Confirm you can use either auth method interchangeably.

---

### Task 5 — Inspect the module cache

After Task 3 or 4, look inside the cache:

```bash
ls -la ~/go/pkg/mod/cache/download/github.com/
ls -la ~/go/pkg/mod/cache/download/github.com/your-username/your-private-repo/@v/
```

Identify each file: `.info`, `.mod`, `.zip`, `.ziphash`, `.lock`.

**Goal.** Realise the cache layout is identical to public deps.

---

## Medium

### Task 6 — A second org with a different glob

Imagine you have two private orgs, `acme-corp` and `widgets-inc`, both on GitHub. Configure `GOPRIVATE` for both:

```bash
go env -w GOPRIVATE='github.com/acme-corp/*,github.com/widgets-inc/*'
```

Confirm with `go env GOPRIVATE`. Try `go env GONOPROXY` and `go env GONOSUMDB` — what do they show?

**Goal.** Understand inheritance from `GOPRIVATE`.

---

### Task 7 — `replace` for local development

Clone a private dep to a local directory:

```bash
git clone https://github.com/your-username/your-private-repo /tmp/local-fork
```

In a consumer project, add a `replace` directive:

```
replace github.com/your-username/your-private-repo => /tmp/local-fork
```

Make a deliberate edit in `/tmp/local-fork`. Build the consumer; confirm the change is observable. Now temporarily *unset* `GOPRIVATE`. Does the build still work?

**Hint.** `replace` short-circuits the fetch entirely — `GOPRIVATE` is irrelevant for replaced paths.

**Goal.** Internalise that `replace` overrides everything else.

---

### Task 8 — A working GitHub Actions pipeline

Create a workflow that pulls a private dep on push:

```yaml
name: ci
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - name: Configure private modules
        run: |
          git config --global url."https://x-access-token:${{ secrets.GITHUB_TOKEN }}@github.com/".insteadOf "https://github.com/"
          go env -w GOPRIVATE='github.com/${{ github.repository_owner }}/*'
      - run: go mod download
      - run: go build ./...
```

Push it. Confirm it succeeds.

**Goal.** Stand up a CI that handles private modules correctly.

---

### Task 9 — Cache the module download

Extend the workflow with a cache step:

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/go-build
      ~/go/pkg/mod
    key: go-${{ runner.os }}-${{ hashFiles('**/go.sum') }}
    restore-keys: |
      go-${{ runner.os }}-
```

Run twice. Time the second run. Should be measurably faster.

**Goal.** Practise CI optimisation.

---

### Task 10 — Build a Docker image with private modules

Write a `Dockerfile` that pulls a private dep using BuildKit secret mount:

```dockerfile
# syntax=docker/dockerfile:1.4
FROM golang:1.22 AS builder
ENV GOPRIVATE=github.com/your-username/*
WORKDIR /src
COPY . .
RUN --mount=type=secret,id=netrc,target=/root/.netrc \
    --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/root/go/pkg/mod \
    go build -o /out/app ./...
```

Build:

```bash
DOCKER_BUILDKIT=1 docker build --secret id=netrc,src=$HOME/.netrc -t myapp .
```

Inspect the image: `docker history myapp`. Confirm there is no layer containing your `.netrc`.

**Goal.** Build a private dep into a container without leaking the token.

---

### Task 11 — Migrate from HTTPS to SSH (or vice versa)

You currently use HTTPS + PAT. Switch the entire team to SSH for the same private dep without changing `go.mod`. The `insteadOf` rewrite is the trick:

```bash
git config --global url."git@github.com:".insteadOf "https://github.com/"
```

Confirm the original HTTPS-style import still resolves; the rewrite happens transparently.

**Goal.** Demonstrate that auth method is independent of `import` paths.

---

## Hard

### Task 12 — Run a local Athens proxy

Stand up Athens locally:

```bash
docker run -d --name athens \
  -p 3000:3000 \
  -v athens-storage:/var/lib/athens \
  -e ATHENS_DISK_STORAGE_ROOT=/var/lib/athens \
  -e ATHENS_STORAGE_TYPE=disk \
  gomods/athens:latest
```

Configure your toolchain:

```bash
go env -w GOPROXY='http://localhost:3000,direct'
```

Run `go build` on a fresh project. Watch Athens logs (`docker logs -f athens`). Confirm requests are flowing through Athens.

**Goal.** See the proxy protocol in action.

---

### Task 13 — Configure Athens to authenticate to private repos

Edit Athens' netrc and config so it can pull private modules on behalf of clients:

```bash
cat > /tmp/athens-netrc <<EOF
machine github.com login x-access-token password ghp_xxxxxxxx
EOF
chmod 600 /tmp/athens-netrc

docker rm -f athens
docker run -d --name athens \
  -p 3000:3000 \
  -v athens-storage:/var/lib/athens \
  -v /tmp/athens-netrc:/etc/athens/netrc:ro \
  -e ATHENS_DISK_STORAGE_ROOT=/var/lib/athens \
  -e ATHENS_NETRC_PATH=/etc/athens/netrc \
  -e ATHENS_STORAGE_TYPE=disk \
  gomods/athens:latest
```

In your client, *do not* set `GOPRIVATE`. Try `go get` against your private repo. The fetch should now succeed via Athens.

**Goal.** Centralise auth on the proxy; keep developer machines credential-free.

---

### Task 14 — Simulate an air-gapped install

In a project with private deps, run:

```bash
go mod download
go mod vendor
git add vendor go.sum
git commit -m "vendor"
```

Now simulate offline:

```bash
GOPROXY=off go build -mod=vendor ./...
```

Confirm the build succeeds with no network access. Then disconnect the network and run again. Confirm.

**Goal.** Have a working air-gapped build.

---

### Task 15 — Pre-warm the cache for an air-gapped CI

Build the cache on a connected machine:

```bash
GOMODCACHE=/tmp/cache go mod download
tar czf cache.tar.gz -C /tmp cache
```

Transfer `cache.tar.gz` to an air-gapped machine. Build there:

```bash
mkdir -p /tmp/cache && tar xzf cache.tar.gz -C /tmp
GOMODCACHE=/tmp/cache GOPROXY=off go build ./...
```

**Goal.** Bypass network entirely without committing `vendor/`.

---

### Task 16 — Audit: list every dep and its source

Write a script that, for every entry in `go.mod`, prints the import path, version, and whether it matches `GOPRIVATE`. Hint: `go list -m all` and pattern-match.

```bash
go list -m -json all | jq -r '. | "\(.Path) \(.Version)"'
```

Compare each path against your `GOPRIVATE` glob.

**Goal.** Build the start of an internal audit tool.

---

### Task 17 — Simulate a force-pushed branch

In a private dep, create a branch, push a commit, pin a downstream project to the SHA via pseudo-version. Then force-push the branch with a different commit. Re-run `go build` in the consumer.

**Expected.** Failure with "unknown revision." Recover by re-pinning to the new SHA.

**Goal.** Internalise why pinning to mutable refs is fragile.

---

### Task 18 — Reproduce an intentional checksum mismatch

Modify your `go.sum` by hand (change a single character of one hash). Run `go build`.

**Expected.** "verifying ...: checksum mismatch" with the canonical SECURITY ERROR banner. Restore from `git checkout go.sum && go mod tidy`.

**Goal.** Recognise the sumdb-failure error message and the canonical recovery.

---

## Solutions

### Solution 1
Verbatim error you should see:

```
go: github.com/your-username/your-private-repo:
    reading https://proxy.golang.org/github.com/your-username/your-private-repo/@v/list:
    410 Gone
```

If you see `404 Not Found` instead, the repo path is wrong; if you see `403`, the public proxy explicitly denied it (rare).

### Solution 2
Either succeeds (Git auth was already configured) or fails with one of:

- `terminal prompts disabled` — no creds in scope.
- `Permission denied (publickey)` — SSH key not loaded.
- `fatal: Authentication failed` — wrong token.

### Solution 3
On macOS, you may need to additionally tell `git` not to use the keychain helper, otherwise it ignores `.netrc`:

```bash
git config --global --unset credential.helper
```

### Solution 6
`go env GONOPROXY` and `GONOSUMDB` both display the same string as `GOPRIVATE` — they inherit by default.

### Solution 7
Yes, the build still works without `GOPRIVATE`. `replace` directives bypass the fetch pipeline entirely.

### Solution 9
First run: ~30s. Second run: ~3-5s. The cache key is keyed on `go.sum`; any dep change invalidates it.

### Solution 10
`docker history myapp` shows layers. Look for any layer mentioning `.netrc` or your token. With BuildKit secret mounts, you should see none.

### Solution 14
`-mod=vendor` is automatically active when `vendor/modules.txt` exists. The toolchain reads from `vendor/` exclusively; `GOPROXY=off` makes any unexpected network call fatal.

### Solution 15
This is what some companies do as their CI strategy: a connected "warm" job populates the cache; downstream isolated jobs reuse it. Saves egress costs on cloud CI.

### Solution 17
The toolchain's pseudo-version hash includes the commit SHA. A force-pushed branch removes the original commit. The toolchain's only recourse is to ask the proxy if it has a cached copy; if not, the build fails until you re-pin.

### Solution 18
The exact error:

```
verifying github.com/...@v...: checksum mismatch
        downloaded: h1:<real hash>
        go.sum:     h1:<edited hash>

SECURITY ERROR
This download does NOT match an earlier download recorded in go.sum.
```

Recovery is always `git checkout -- go.sum && go mod tidy`.
