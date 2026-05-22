# go clean — Professional

## 1. Policy: caching speed vs cleaning hygiene

The central team tension: you **persist** caches in CI for speed, but caches grow and occasionally need resetting. Resolve it with an explicit policy:

- **Per-job:** never `go clean -cache`/`-modcache` — it defeats the cache you persist.
- **Scheduled (e.g., nightly/weekly):** clean caches on long-lived self-hosted runners for disk hygiene.
- **Dedicated job:** a "cold build" job runs `go clean -cache && go build ./...` to catch hidden cache dependence.

Write this into your CI standards so contributors do not sprinkle cleans into normal pipelines.

---

## 2. Disk management on self-hosted runners

Ephemeral CI (fresh VM per job) needs no cleaning. Self-hosted/persistent runners accumulate caches:

```bash
# scheduled maintenance job
df -h "$(go env GOMODCACHE)" "$(go env GOCACHE)"
go clean -modcache     # biggest reclaim; handles read-only files
go clean -cache        # build cache (will rebuild next job)
```

Prefer `go clean -modcache` over `rm -rf` because module cache files are read-only and manual deletion fails or needs `chmod`. Monitor disk and clean on a threshold, not blindly.

---

## 3. Cold-build verification

A subtle class of bug: builds/tests that secretly depend on a warm cache (e.g., a generator that only ran once, an artifact left from a prior step). Catch it with a periodic clean build:

```bash
go clean -cache
go generate ./...
go build ./...
go test ./...
git diff --exit-code      # generated files must be reproducible from cold
```

This proves the repo builds reproducibly from nothing — important before releases.

---

## 4. Reproducible release builds

Before tagging a release, build from a clean state to ensure the artifact is reproducible:

```bash
go clean -cache
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o dist/app ./cmd/app
```

A clean build here removes any chance of a stale cached object contributing to the release artifact, which matters for byte-for-byte reproducibility and provenance.

---

## 5. Don't clean to "fix" — diagnose

Make it a review/incident norm: **a clean that "fixes" a build hides the real bug.** If a teammate says "I ran `go clean -cache` and it works now," investigate:

- Environment drift (`GOFLAGS`, tags, `GOOS/GOARCH`).
- Nondeterministic code generation.
- Toolchain version mismatch.

The content-addressed cache cannot serve a genuinely stale result, so a clean masking a problem means the problem is environmental and will recur.

---

## 6. Standardize the cache locations

For predictable CI caching and cleaning, pin cache locations explicitly:

```bash
export GOCACHE="$CI_CACHE/go-build"
export GOMODCACHE="$CI_CACHE/go-mod"
```

This makes both the cache-restore step and any scheduled `go clean`/volume-prune target the same, known paths, avoiding "cleaned the wrong directory" mistakes.

---

## 7. Reviewing for misuse

| Smell | Why it's wrong | Fix |
|-------|----------------|-----|
| `go clean -cache` in every CI job | defeats persisted cache; slow | clean only on schedule / cold-build job |
| `rm -rf $GOMODCACHE` in a script | fails on read-only files | `go clean -modcache` |
| Cleaning to fix a build | hides env/toolchain drift | diagnose the real cause |
| Wiping `-modcache` before an offline build | re-download fails | warm the cache first |
| Global `-testcache` where `-count=1` suffices | broader than needed | `go test -count=1 <pkg>` |

---

## 8. Documenting the runbook

Give the team a short runbook so cleaning is deliberate, not folkloric:

- **Tests stuck cached / external state changed:** `go test -count=1 <pkg>` (or `go clean -testcache`).
- **Runner disk full:** scheduled `go clean -modcache && go clean -cache`.
- **Verify reproducibility:** cold-build job (`go clean -cache && go build ./...`).
- **Fuzz corpus bloat:** `go clean -fuzzcache`.
- **Build "broken," suspect cache:** diagnose env/toolchain first; clean is a last resort.

---

## 9. Summary

At team scale, treat `go clean` as a deliberate maintenance and verification tool, not a routine fix. Persist caches for speed and clean only on a schedule (disk hygiene) or in a dedicated cold-build/release job that proves reproducibility. Use `go clean -modcache` (not `rm -rf`) for read-only module files, prefer `-count=1` over global `-testcache`, pin cache locations for predictable cleaning, and always diagnose environment/toolchain drift before blaming the content-addressed cache.

---

## Further reading
- Build and test caching: https://pkg.go.dev/cmd/go#hdr-Build_and_test_caching
- Reproducible builds: https://go.dev/blog/rebuild
- `go help clean`
