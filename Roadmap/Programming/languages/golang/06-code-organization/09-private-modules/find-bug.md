# Private Modules — Find the Bug

> Each scenario contains a real-world bug related to private Go modules. Find it, explain it, fix it.

---

## Bug 1 — `GOPRIVATE` set, but `410 Gone` persists

```bash
$ go env GOPRIVATE
github.com/acme-corp/*

$ go get github.com/acme-corp/internal-auth
go: github.com/acme-corp/internal-auth:
    reading https://proxy.golang.org/github.com/acme-corp/internal-auth/@v/list:
    410 Gone
```

`GOPRIVATE` *looks* set. So why does the proxy still get hit?

**Bug.** `go env` writes to `~/.config/go/env`. But the user has *also* exported `GOPRIVATE=` (empty) in their shell profile, which overrides the file. Shell exports take precedence over `~/.config/go/env`.

**Fix.** Find the conflicting export:

```bash
$ env | grep GOPRIVATE
GOPRIVATE=

$ unset GOPRIVATE
$ go env GOPRIVATE
github.com/acme-corp/*
```

Then remove the line from `~/.zshrc` or `~/.bashrc`.

---

## Bug 2 — Glob covers the org but not v2 paths

```bash
$ go env GOPRIVATE
github.com/acme-corp/*

$ go get github.com/acme-corp/sdk/v2
go: github.com/acme-corp/sdk/v2: ...: 410 Gone
```

The org is in the glob. So why does `/v2` fail?

**Bug.** `*` in a `path.Match` glob matches one path segment. `github.com/acme-corp/*` matches `github.com/acme-corp/sdk` but **not** `github.com/acme-corp/sdk/v2` — the latter has an extra segment.

**Fix.** Add a second pattern:

```bash
go env -w GOPRIVATE='github.com/acme-corp/*,github.com/acme-corp/*/v?,github.com/acme-corp/*/v??'
```

Or, simpler in many setups, just match anything under the org:

```bash
go env -w GOPRIVATE='github.com/acme-corp,github.com/acme-corp/*,github.com/acme-corp/*/*'
```

The cleanest answer is "list every depth your org actually uses." There is no `**` glob.

---

## Bug 3 — `.netrc` ignored on macOS

```bash
$ cat ~/.netrc
machine github.com
  login alice
  password ghp_validToken12345

$ go get github.com/acme-corp/auth
fatal: could not read Username for 'https://github.com': terminal prompts disabled
```

The `.netrc` is correct. The token works. Why is it ignored?

**Bug.** macOS's `git` ships configured to use `osxkeychain` as the credential helper. The helper short-circuits before `git` ever consults `.netrc`. The keychain has no entry for the new token, so it falls through to the prompt — which is disabled.

**Fix.** Either remove the helper:

```bash
git config --global --unset credential.helper
```

Or store the token in the keychain instead:

```bash
git credential-osxkeychain store <<EOF
protocol=https
host=github.com
username=alice
password=ghp_validToken12345

EOF
```

Then `git` finds the credential without ever touching `.netrc`.

---

## Bug 4 — CI works locally but fails in Docker

`Dockerfile`:

```dockerfile
FROM golang:1.22
ENV GOPRIVATE=github.com/acme-corp/*
COPY .netrc /root/.netrc
RUN go build ./...
```

Build fails:

```
fatal: Authentication failed for 'https://github.com/acme-corp/auth.git/'
```

The same `.netrc` works on the developer's machine. Why?

**Bug.** Two layered bugs. (1) `COPY .netrc /root/.netrc` bakes the token into a Docker layer — a security violation, even when it works. (2) On Linux, `git` requires `.netrc` to be `0600`. The `COPY` preserves the source file's permissions, which from a fresh checkout are typically `0644`. Modern `git` refuses to read world-readable `.netrc` files.

**Fix.** Use BuildKit secret mounts; never `COPY` secrets:

```dockerfile
# syntax=docker/dockerfile:1.4
FROM golang:1.22
ENV GOPRIVATE=github.com/acme-corp/*
RUN --mount=type=secret,id=netrc,target=/root/.netrc \
    go build ./...
```

```bash
DOCKER_BUILDKIT=1 docker build --secret id=netrc,src=$HOME/.netrc -t app .
```

The mount provides the file read-only with mode `0600` for the duration of the `RUN`, never persisted in a layer.

---

## Bug 5 — `go.sum` mismatch after a colleague's PR

```bash
$ go build ./...
verifying github.com/acme-corp/auth@v1.4.0: checksum mismatch
        downloaded: h1:abcdEF...
        go.sum:     h1:zzzzZZ...

SECURITY ERROR
```

You pulled main, ran `go build`, and immediately got this. What likely happened?

**Bug.** A colleague resolved a merge conflict in `go.sum` by editing it manually. Either they kept the wrong side, or they accidentally re-typed a hash.

**Fix.** Never edit `go.sum`. Restore from a known-good commit:

```bash
$ git log --oneline go.sum | head
$ git checkout <commit-before-PR> -- go.sum
$ go mod tidy
$ git diff go.sum
```

If the diff is now sane, commit and move on. The proper resolution of a `go.sum` conflict is **always** "take both, run `go mod tidy`, commit the result."

---

## Bug 6 — Pseudo-version pinned to a force-pushed branch

`go.mod`:

```
require github.com/acme-corp/exp v0.0.0-20250408120102-deadbeefcafe
```

```bash
$ go build
go: github.com/acme-corp/exp@v0.0.0-20250408120102-deadbeefcafe:
    invalid version: unknown revision deadbeefcafe
```

The build worked yesterday.

**Bug.** Someone force-pushed the branch the pseudo-version pointed at. The original commit is gone from the remote, and the proxy/cache eventually drops it.

**Fix.** Re-pin to a tag if one exists, or to the new HEAD:

```bash
$ go get github.com/acme-corp/exp@latest
$ go mod tidy
```

Long-term: branch-protect your release branches against force-push, or pin only to tags.

---

## Bug 7 — `GOPROXY` chain hides an internal-only path

```bash
$ go env
GOPROXY=https://proxy.golang.org,direct
GOPRIVATE=github.com/acme-corp/*

$ go get github.com/acme-corp/auth
```

The fetch is unexpectedly slow — eight seconds. Then it succeeds.

**Bug.** The toolchain is *first* asking `proxy.golang.org` for the module (because `GOPRIVATE` was supposed to bypass it) — wait, no, it does bypass via `GONOPROXY`. The slowness must be elsewhere. On closer inspection: `GOPRIVATE` is set in `~/.config/go/env`, but the user is in a sub-shell that ran before that file was written. `GOPRIVATE` is empty in this shell. The toolchain dutifully asks the public proxy, gets `410`, falls through to `direct`, which works.

**Fix.** Confirm with `go env GOPRIVATE` *in the same shell*. If empty, restart the shell or `export GOPRIVATE=...` manually.

The lesson: errors that "succeed but slowly" are often misroutings.

---

## Bug 8 — `GOPRIVATE` typo with a hyphen vs underscore

```bash
$ go env GOPRIVATE
github.com/acme_corp/*

$ go get github.com/acme-corp/auth
go: ...: 410 Gone
```

The org is set as private. So why does the public proxy still get hit?

**Bug.** `acme_corp` is not the same as `acme-corp`. The glob doesn't match. Module paths preserve hyphens; underscores in repo names are forbidden in many Git hosts but not in Go module paths — so the glob is technically valid, just for a non-existent path.

**Fix.** Spell-check the glob:

```bash
go env -w GOPRIVATE='github.com/acme-corp/*'
```

---

## Bug 9 — `replace` to a relative path that doesn't exist in CI

`go.mod`:

```
require github.com/acme-corp/auth v1.0.0

replace github.com/acme-corp/auth => ../auth
```

Locally fine. In GitHub Actions:

```
go: github.com/acme-corp/auth@v1.0.0 (replaced by ../auth):
    reading ../auth/go.mod: open ../auth/go.mod: no such file or directory
```

**Bug.** The `replace` points at `../auth` — a sibling directory of the project. CI checks out only this repo; the sibling does not exist.

**Fix.** Three options:

1. Remove the replace before merging. Use `replace` only locally.
2. Use a Git path replace: `replace github.com/acme-corp/auth => github.com/acme-corp/auth-fork v1.0.0-fork.1` and ensure the fork is reachable.
3. Switch to a Go workspace (`go work init && go work use ../auth ./`) which is local-only and not committed.

---

## Bug 10 — SSH agent unused in CI

`.gitlab-ci.yml`:

```yaml
build:
  image: golang:1.22
  before_script:
    - mkdir -p ~/.ssh
    - echo "${SSH_PRIVATE_KEY}" > ~/.ssh/id_ed25519
    - chmod 600 ~/.ssh/id_ed25519
    - ssh-keyscan github.com >> ~/.ssh/known_hosts
  script:
    - go env -w GOPRIVATE=github.com/acme-corp/*
    - go build ./...
```

```
git@github.com: Permission denied (publickey).
```

The key file exists. Why is auth failing?

**Bug.** The SSH agent is not running, and `git`'s SSH transport is not picking up the key file by name unless it's `id_ed25519` (which it is) *and* an SSH agent is available *or* `IdentitiesOnly yes` is configured. In some images, the agent is missing entirely; the toolchain falls back to public-key probing, which can be inconsistent.

Also, `${SSH_PRIVATE_KEY}` from a CI variable may have lost its line breaks — the `echo` produced a one-line file that openssh refuses.

**Fix.**

```yaml
before_script:
  - eval $(ssh-agent -s)
  - echo "${SSH_PRIVATE_KEY}" | ssh-add -    # reads from stdin, preserves newlines
  - mkdir -p ~/.ssh && ssh-keyscan github.com >> ~/.ssh/known_hosts
```

`ssh-add -` reads the key from stdin and is robust to mangled newlines; the agent then serves it to `git`.

---

## Bug 11 — `GOSUMDB=off` swallows real tampering

A team set `GOSUMDB=off` "to fix a CI issue six months ago." Today, `go.sum` cleanly verifies a malicious tampered build with no warning. Why?

**Bug.** With `GOSUMDB=off`, the toolchain never asks the public sumdb whether `go.sum`'s hashes are *correct*. It only checks that downloaded bytes match `go.sum`. If an attacker compromised the upstream and `go.sum` was updated to match the bad bytes, every subsequent build verifies happily.

**Fix.** Restore `GOSUMDB`:

```bash
go env -u GOSUMDB     # back to default sum.golang.org
```

Then audit `go.sum` history: every change deserves a "did I review this?" question. Tools like `gosum-checkup` (homemade scripts that diff `go.sum` against `sum.golang.org` lookups) help.

The original CI issue was almost certainly fixable with `GONOSUMDB` for the private path, not by disabling sumdb wholesale.

---

## Bug 12 — `proxy.golang.org` cached an old `410`

A new public dep was renamed three months ago. Trying to add it:

```bash
$ go get github.com/old-name/lib@latest
go: github.com/old-name/lib@latest: 410 Gone
```

But the repo *is* still public — the team is just stuck mid-migration.

**Bug.** `proxy.golang.org` records "this module path is unavailable" for a period after a 410. New requests for the same path keep returning 410, even after the underlying repo issue is resolved.

**Fix.** Use the new path. If you genuinely must use the old path, set `GONOPROXY=github.com/old-name/*` to bypass the cached 410 and fetch directly. But ideally migrate `import` lines to the new module path.

---

## Bug 13 — Module path mismatch between `go.mod` and `import`

Repo `github.com/Acme-Corp/Auth` has `go.mod`:

```
module github.com/acme-corp/auth
```

Note the case difference. Consumer code:

```go
import "github.com/Acme-Corp/Auth"
```

Build:

```
go: module github.com/Acme-Corp/Auth: declares its path as github.com/acme-corp/auth
```

**Bug.** The module's declared path (in `go.mod`) is the canonical one. The import statement must match it exactly. Differing case causes a hard failure.

**Fix.** Update imports to match the canonical lowercase path. Then `GOPRIVATE` only matches the canonical form; if you set `GOPRIVATE=github.com/Acme-Corp/*`, it would not match the canonical path either. Use lowercase consistently.

---

## Bug 14 — Wrong glob host

```bash
$ go env GOPRIVATE
gitlab.com/*

$ go get gitlab.acme.io/team/auth
go: ...: 410 Gone
```

**Bug.** The repo lives on `gitlab.acme.io` (self-hosted), not `gitlab.com`. `GOPRIVATE` matches strict module paths; the host does not match.

**Fix.**

```bash
go env -w GOPRIVATE='gitlab.acme.io/*'
```

---

## Bug 15 — Token works for `git`, fails for `go`

```bash
$ git clone https://github.com/acme-corp/auth /tmp/test
Cloning into '/tmp/test'... done.

$ go get github.com/acme-corp/auth
fatal: could not read Username for 'https://github.com': terminal prompts disabled
```

`git` works directly, `go` fails. Why?

**Bug.** `git clone` succeeded because it fell back to a credential helper (e.g., `osxkeychain`) that has the cached token. `go` invokes `git` with a different environment — typically with the stdin/tty closed and `GIT_TERMINAL_PROMPT=0`. The credential helper's interactive flow (asking the keychain for permission) silently fails in non-interactive mode.

**Fix.** Move the credential into `.netrc` (which is fully non-interactive), or pre-authorise the keychain ("always allow") so future requests don't need user interaction.

---

## Bug 16 — Double-rewrite in `insteadOf`

`~/.gitconfig`:

```
[url "git@github.com:"]
    insteadOf = https://github.com/

[url "https://github.com/"]
    insteadOf = git@github.com:
```

Result: `go get github.com/acme/foo` hangs or rewrites in a loop.

**Bug.** The two `insteadOf` rules form a cycle. `git` does not detect this and may apply them in surprising orders.

**Fix.** Pick one direction and delete the other entry.

---

## Bug 17 — `GOPROXY` set to private proxy without `direct` fallback

```bash
$ go env GOPROXY
https://athens.acme.io
```

Athens is fine for normal deps, but for a brand-new module path that Athens has never proxied:

```
go: github.com/acme-corp/new-thing: 404 Not Found
```

**Bug.** Without `direct` fallback, when Athens 404s, the build fails. Athens may not have been told to proxy this new path yet.

**Fix.**

```bash
go env -w GOPROXY='https://athens.acme.io,direct'
```

Now if Athens 404s, the toolchain falls through to a Git clone. Athens picks up the path next time.

---

## Bug 18 — Stale module cache after upstream re-tag

After fixing Bug 6 (re-pinning to a tag), builds still fail with:

```
verifying ...: checksum mismatch
```

**Bug.** The local module cache has the *old* bytes for the version. When the upstream re-tagged (a bad practice), the proxy may have updated, but your cache held onto the old bytes.

**Fix.** Clear the specific cache entry:

```bash
chmod -R u+w ~/go/pkg/mod/github.com/acme-corp/exp@v1.4.0
rm -rf ~/go/pkg/mod/github.com/acme-corp/exp@v1.4.0
rm -rf ~/go/pkg/mod/cache/download/github.com/acme-corp/exp/@v/v1.4.0.*
go mod tidy
```

Or nuke the whole cache: `go clean -modcache`.

---

## Bug 19 — `go install` fails after `go get` succeeds

```bash
$ go get github.com/acme-corp/cli
$ go install github.com/acme-corp/cli@latest
go: github.com/acme-corp/cli@latest: ... 410 Gone
```

The `go get` worked. Why does `go install` fail?

**Bug.** `go install pkg@version` runs in a *clean* module context. It does not see your local module's `GOPRIVATE`. It uses your *global* `go env` settings. If `GOPRIVATE` is set per-project (in `.envrc`) but not in `~/.config/go/env`, `go install` misses it.

**Fix.** Set `GOPRIVATE` in the global config too:

```bash
go env -w GOPRIVATE='github.com/acme-corp/*'
```

Or pass it inline:

```bash
GOPRIVATE='github.com/acme-corp/*' go install github.com/acme-corp/cli@latest
```

---

## Bug 20 — Forgotten `GIT_CONFIG_GLOBAL` in CI

A pipeline sets up auth in one step and tries to use it in another:

```yaml
- run: git config --global url."https://x:${TOKEN}@github.com/".insteadOf "https://github.com/"
- run: go build ./...
```

It fails with `terminal prompts disabled`.

**Bug.** The two steps run in *different shells*. `git config --global` writes to `~/.gitconfig`. The second step's user has the same `$HOME`, so it should work — *unless* a prior step set `GIT_CONFIG_GLOBAL=/some/path` to redirect global config elsewhere. Then the rewrite writes to one file and the second step reads from another.

**Fix.** Audit for `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_NOSYSTEM`. If set, either consistently use the redirect or drop it.

---

## Bug 21 — `vendor/` out of sync with `go.mod`

```bash
$ go build -mod=vendor ./...
inconsistent vendoring in /path/to/project:
        github.com/acme-corp/auth@v1.4.0: is explicitly required in go.mod, but not marked as explicit in vendor/modules.txt
```

**Bug.** Someone updated `go.mod` (added or upgraded a dep) and forgot to re-run `go mod vendor`. The `vendor/modules.txt` is out of sync.

**Fix.**

```bash
go mod vendor
git add vendor go.mod go.sum
```

Add a CI step that runs `go mod vendor` and fails if `git diff vendor/` is non-empty.
