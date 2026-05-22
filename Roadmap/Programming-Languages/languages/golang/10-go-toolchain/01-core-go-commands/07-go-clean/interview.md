# go clean — Interview Q&A

Labeled by level. Concise answers.

---

## Junior

**Q1. What does `go clean` do?**
It removes files the Go tools generate — leftover build outputs and, with flags, the build/test/module caches.

**Q2. How do you force tests to re-run when they show `(cached)`?**
`go clean -testcache` (expire all results) or `go test -count=1` (bypass for this run).

**Q3. How do you reclaim disk used by downloaded dependencies?**
`go clean -modcache` deletes the entire module download cache.

**Q4. How do you preview what a clean would remove?**
`go clean -n ...` prints the actions without performing them.

---

## Middle

**Q5. What is the difference between `-cache`, `-testcache`, and `-modcache`?**
`-cache` wipes the build cache (compiled objects); `-testcache` expires cached test results; `-modcache` deletes the downloaded module source cache. They operate globally.

**Q6. Why use `go clean -modcache` instead of `rm -rf`?**
Module cache files are stored read-only to prevent mutation; `rm -rf` hits permission errors, while `go clean -modcache` handles the read-only bits correctly.

**Q7. `-testcache` vs `-count=1`?**
`-testcache` globally expires all cached results for future runs; `-count=1` bypasses the cache for the current run only. Use `-count=1` for a targeted re-run.

**Q8. What does `-i` do?**
Removes the installed binary/archive (what `go install` produced) for the named packages, in addition to local build outputs.

---

## Senior

**Q9. Why do you almost never need `go clean -cache`?**
The build cache is content-addressed: every input is in the cache key, so a stale result is impossible under correct use. A clean "fixing" a build usually masks env/toolchain drift, which will recur.

**Q10. Does the build cache grow without bound?**
No — modern Go trims the cache automatically based on usage. Unbounded growth is mostly a non-issue; `-cache` is a blunt full reset, not routine maintenance.

**Q11. When is wiping the module cache genuinely needed?**
Disk reclamation on long-lived runners, or recovering from a corrupted/checksum-failing cache entry (then `go mod download` + `go mod verify`). Not for normal builds.

**Q12. Why is cleaning caches per CI job an anti-pattern?**
If you persist caches for speed, cleaning them per job defeats that, slowing every build. Clean only on a schedule or in a dedicated cold-build verification job.

---

## Professional

**Q13. How do you verify a repo builds reproducibly from a cold cache?**
A dedicated job: `go clean -cache && go generate ./... && go build ./... && go test ./... && git diff --exit-code`. This catches hidden warm-cache dependence and non-reproducible generation.

**Q14. A teammate says `go clean -cache` fixed their build. What do you do?**
Investigate the real cause — environment drift (`GOFLAGS`, tags, `GOOS/GOARCH`), nondeterministic generation, or toolchain mismatch — because the content-addressed cache cannot serve a stale result; the problem will recur.

---

## Common traps

- Running `go clean -cache` reflexively to "fix" builds.
- `rm -rf $GOMODCACHE` failing on read-only files (use `go clean -modcache`).
- Wiping `-modcache` before an offline build.
- Confusing `-testcache` (expire) with `-cache` (wipe build objects).
- Cleaning caches per CI job while also caching them.
- Expecting bare `go clean` to "clean the build" (it rarely removes anything today).
