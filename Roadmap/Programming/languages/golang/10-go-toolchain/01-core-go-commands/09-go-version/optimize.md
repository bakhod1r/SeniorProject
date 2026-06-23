# go version — Optimization

`go version` is a reporting command, so "optimization" means avoiding wasted toolchain downloads, faster CI version handling, and cheap automated provenance checks. Numbers are illustrative.

---

## Exercise 1: Avoid surprise toolchain downloads in CI

**Before** — `GOTOOLCHAIN=auto` plus a `toolchain` directive newer than the CI image triggers a download on every cold job.

**After** — provision the matching toolchain in the image and pin it:

```bash
go env -w GOTOOLCHAIN=local   # use the provisioned version; fail fast if wrong
```

| Metric | auto-download per job | provisioned + local |
|--------|-----------------------|---------------------|
| Per-job toolchain fetch | ~10–30s | 0 |
| Network dependency | yes | none |

Match the CI image to the `toolchain` directive so no download is needed.

---

## Exercise 2: Cache the downloaded toolchain (when using auto)

**Before** — `GOTOOLCHAIN=auto` re-downloads the toolchain each ephemeral CI job.

**After** — cache the toolchain modules (they live in the module cache):

```yaml
- uses: actions/cache@v4
  with:
    path: ~/go/pkg/mod/golang.org/toolchain*
    key: toolchain-${{ hashFiles('go.mod') }}
```

| Metric | re-download | cached |
|--------|-------------|--------|
| Toolchain setup | ~20s | ~1s |

Keyed on `go.mod` (which holds the `toolchain` directive), it invalidates only on version bumps.

---

## Exercise 3: Fast version assertion instead of a full build

**Before** — discovering a wrong toolchain only after a long build fails.

**After** — assert up front, cheaply:

```bash
[ "$(go version | awk '{print $3}')" = "go1.23.1" ] || exit 1
```

| Metric | discover after build | assert first |
|--------|----------------------|--------------|
| Time to detect mismatch | minutes | <1s |

Fail fast on version drift before paying for compilation.

---

## Exercise 4: Automated provenance scan with `-m`

**Before** — manually inspecting release binaries for dependency/VCS info.

**After** — script it in the release gate:

```bash
go version -m dist/app | grep -q 'vcs.modified=false' || { echo "dirty build"; exit 1; }
```

| Metric | manual audit | automated gate |
|--------|--------------|----------------|
| Coverage | ad hoc | every release |
| Effort | high | near zero |

---

## Exercise 5: Binary-mode vulnerability scan reuses embedded versions

**Before** — re-resolving the module graph to scan for vulnerabilities.

**After** — scan the binary's embedded versions directly:

```bash
govulncheck -mode=binary dist/app
```

| Metric | source-mode re-resolve | binary-mode |
|--------|------------------------|-------------|
| Inputs needed | full source/graph | just the binary |
| Use case | pre-build | shipped artifact audit |

Binary mode reads what `go version -m` reports — fast and works on artifacts you did not build.

---

## Exercise 6: Right-size the GOTOOLCHAIN policy

**Before** — every developer fetches toolchains on demand, multiplying downloads.

**After** — pick the policy that fits the environment:

```bash
# fast/connected dev: auto (cached)
# locked-down CI: local + provisioned image
```

| Environment | Policy | Why |
|-------------|--------|-----|
| Connected dev | `auto` (cached) | convenience, low cost after first fetch |
| Air-gapped/CI | `local` | no surprise downloads, deterministic |

---

## Measurement checklist
- [ ] Match the CI image to the `toolchain` directive; prefer `local` to avoid downloads.
- [ ] Cache toolchain modules when using `auto` in ephemeral CI.
- [ ] Assert the toolchain version first, before building.
- [ ] Gate releases on `go version -m` provenance (`vcs.modified=false`).
- [ ] Use `govulncheck -mode=binary` to audit shipped artifacts.
- [ ] Choose `auto` vs `local` per environment.
