# Go Commands & Documentation — Optimization Exercises

Each exercise presents a workflow or code with efficiency issues. Optimize it!

---

## Exercise 1 🟢 — Speed Up Repeated `go build` with Caching

**Original workflow:**

```bash
#!/bin/bash
# build.sh — run before every deployment test
go clean -cache          # always clean first!
go build -o ./bin/app .
```

**Problem:** The developer cleans the build cache before every build, thinking it ensures a fresh build. This makes every build take 45 seconds instead of 2 seconds.

**Task:** Fix the build script to use the cache properly while still ensuring correctness.

<details>
<summary>Solution</summary>

```bash
#!/bin/bash
# build.sh — fast incremental build

# The build cache is safe to use — it's keyed by content hash
# Only clean when debugging cache-related issues
go build -o ./bin/app .

# If you specifically need to verify no stale state:
# go build -a ./bin/app  # -a forces rebuild of all packages
# (rarely needed — the cache handles this correctly)
```

**When to actually clean:**
```bash
# After a Go version upgrade
go clean -cache

# When debugging unusual build behavior
go clean -cache

# In CI, sometimes useful to start fresh (but cache the result!)
```

**Expected improvement:**
```
Without cache: 45 seconds
With cache (no source changes): 1-2 seconds
With cache (changed 1 file): 3-5 seconds
```

**Why the cache is safe:** The cache is keyed by a SHA256 hash of all inputs (source files, flags, Go version). If anything changes, the affected packages are recompiled. `go clean -cache` should only be used for debugging.
</details>

---

## Exercise 2 🟢 — Parallelize Platform Builds

**Original build script:**

```bash
#!/bin/bash
# build-all-platforms.sh

GOOS=linux   GOARCH=amd64 go build -o dist/app-linux-amd64   .
GOOS=darwin  GOARCH=amd64 go build -o dist/app-darwin-amd64  .
GOOS=darwin  GOARCH=arm64 go build -o dist/app-darwin-arm64  .
GOOS=windows GOARCH=amd64 go build -o dist/app-windows.exe   .
# Total time: 40 seconds (sequential)
```

**Task:** Parallelize the builds. Each platform build is independent.

<details>
<summary>Solution</summary>

```bash
#!/bin/bash
# build-all-platforms-parallel.sh
set -e

mkdir -p dist

declare -A builds=(
    ["dist/app-linux-amd64"]="linux/amd64"
    ["dist/app-darwin-amd64"]="darwin/amd64"
    ["dist/app-darwin-arm64"]="darwin/arm64"
    ["dist/app-windows.exe"]="windows/amd64"
)

pids=()
for output in "${!builds[@]}"; do
    IFS='/' read -r GOOS GOARCH <<< "${builds[$output]}"
    GOOS=$GOOS GOARCH=$GOARCH go build -o "$output" . &
    pids+=($!)
    echo "Started build for $output (pid $!)"
done

# Wait for all parallel builds and collect exit codes
failed=0
for pid in "${pids[@]}"; do
    if ! wait "$pid"; then
        echo "Build failed (pid $pid)"
        failed=1
    fi
done

if [ $failed -eq 1 ]; then
    echo "One or more builds failed!"
    exit 1
fi

echo "All builds completed!"
ls -la dist/
```

**Alternative with `make -j`:**
```makefile
PLATFORMS := linux/amd64 darwin/amd64 darwin/arm64 windows/amd64

.PHONY: build-all
build-all: $(addprefix dist/, $(notdir $(PLATFORMS)))

dist/%:
    GOOS=$(word 1,$(subst /, ,$*)) \
    GOARCH=$(word 2,$(subst /, ,$*)) \
    go build -o dist/$* .

.PHONY: all-parallel
all-parallel:
    $(MAKE) -j4 build-all  # -j4 = 4 parallel jobs
```

**Expected improvement:**
```
Sequential: 40 seconds
Parallel (4 CPUs): ~12 seconds
```
</details>

---

## Exercise 3 🟢 — Optimize CI Module Download

**Original CI configuration:**

```yaml
# .github/workflows/ci.yml
jobs:
  test:
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-go@v4
        with:
          go-version: '1.21'
      # No caching — downloads all modules on every run!
      - run: go test ./...
```

**Problem:** Each CI run downloads all Go modules from the internet, adding 2-3 minutes to every build.

**Task:** Add module and build caching to reduce CI time.

<details>
<summary>Solution</summary>

```yaml
# .github/workflows/ci.yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - uses: actions/setup-go@v4
        with:
          go-version: '1.21'
          # actions/setup-go@v4 has built-in caching!
          cache: true  # caches $GOMODCACHE and $GOCACHE automatically

      # Alternative: manual caching for more control
      # - uses: actions/cache@v3
      #   with:
      #     path: |
      #       ~/go/pkg/mod
      #       ~/.cache/go-build
      #     key: ${{ runner.os }}-go-${{ hashFiles('**/go.sum') }}
      #     restore-keys: |
      #       ${{ runner.os }}-go-

      - run: go mod download  # download only (before cache key computation)
      - run: go test ./...

  # Separate job for builds — can reuse the same cache
  build:
    runs-on: ubuntu-latest
    needs: test  # only build if tests pass
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-go@v4
        with:
          go-version: '1.21'
          cache: true
      - run: go build -ldflags="-s -w" -o bin/app ./cmd/app
```

**Key insight:** The cache key uses `hashFiles('**/go.sum')` — the cache is invalidated when dependencies change, but reused when only source code changes.

**Expected improvement:**
```
Without cache:  2-3 minutes for module download + build
With module cache: 10-15 seconds (cache hit for unchanged go.sum)
With build cache:  5-10 seconds (only changed packages recompile)
```
</details>

---

## Exercise 4 🟡 — Optimize `go list` for Large Monorepos

**Original script:**

```bash
#!/bin/bash
# check-all-packages.sh

packages=$(go list ./...)
for pkg in $packages; do
    go vet "$pkg"
    go test "$pkg"
done
```

**Problem:** This calls `go vet` and `go test` once per package, starting fresh each time. For 200 packages, this takes 15 minutes.

**Task:** Reduce this to a few seconds by letting the tools handle parallelism internally.

<details>
<summary>Solution</summary>

```bash
#!/bin/bash
set -e

# Let go vet handle all packages at once (it's parallel internally)
echo "Running vet..."
go vet ./...

# Let go test run all packages with proper parallelism
echo "Running tests..."
go test -parallel=8 -count=1 ./...

# For even faster feedback on large codebases:
# Only test changed packages
CHANGED_PACKAGES=$(go list $(git diff --name-only HEAD~1 | grep '\.go$' | xargs -I{} dirname {} | sort -u | sed 's|^|./|'))
if [ -n "$CHANGED_PACKAGES" ]; then
    go test -parallel=8 $CHANGED_PACKAGES
fi
```

**Advanced: Selective testing based on changes:**
```bash
#!/bin/bash
# Only run tests for packages affected by changes

# Find changed files
CHANGED_FILES=$(git diff --name-only origin/main...HEAD)

# Get packages containing changed files
CHANGED_PKGS=$(echo "$CHANGED_FILES" | \
    grep '\.go$' | \
    xargs -I{} dirname {} | \
    sort -u | \
    xargs -I{} go list ./{} 2>/dev/null)

if [ -z "$CHANGED_PKGS" ]; then
    echo "No Go packages changed"
    exit 0
fi

echo "Testing changed packages:"
echo "$CHANGED_PKGS"

go test -parallel=8 $CHANGED_PKGS
```

**Expected improvement:**
```
Original (200 packages, loop): 15 minutes
Optimized (go test ./...): 2 minutes
Optimized (parallel): 30 seconds
Selective (only changed): 5-15 seconds
```
</details>

---

## Exercise 5 🟡 — Reduce Documentation Generation Time

**Original documentation workflow:**

```bash
#!/bin/bash
# generate-docs.sh — runs before every PR

# Re-generate everything from scratch
rm -rf docs/
go doc -all ./... > docs/all.txt  # this doesn't work as expected
godoc -url /pkg/ > docs/index.html
for pkg in $(go list ./...); do
    godoc -url /pkg/$pkg > docs/$pkg.html
done
```

**Problems:**
1. `go doc -all ./...` doesn't do what the developer thinks
2. Spawning godoc for each package is extremely slow
3. Documentation regenerated on every PR even if docs haven't changed

**Task:** Fix the approach and make it efficient.

<details>
<summary>Solution</summary>

```bash
#!/bin/bash
# generate-docs.sh — efficient documentation

set -e

# Check if documentation source has changed
# Only regenerate if .go files changed since last docs generation
LAST_DOCS_TIME=$(git log --format="%ct" -1 -- docs/ 2>/dev/null || echo 0)
LAST_CODE_TIME=$(git log --format="%ct" -1 -- '*.go' 2>/dev/null || echo 1)

if [ "$LAST_CODE_TIME" -le "$LAST_DOCS_TIME" ]; then
    echo "Documentation is up to date, skipping generation"
    exit 0
fi

echo "Generating documentation..."

# Option 1: Use pkgsite for static HTML (correct approach)
go install golang.org/x/pkgsite/cmd/pkgsite@latest
pkgsite -open=false &
PKGSITE_PID=$!
sleep 2  # wait for server to start

# Fetch all package pages
mkdir -p docs
packages=$(go list ./...)
for pkg in $packages; do
    pkg_path=$(echo $pkg | sed 's|github.com/||')
    curl -s "http://localhost:8080/$pkg" > "docs/${pkg_path//\//_}.html" 2>/dev/null || true
done

kill $PKGSITE_PID

# Option 2: Use go doc for each package (simpler, terminal-friendly)
mkdir -p docs/text
for pkg in $(go list ./...); do
    pkg_name=$(echo $pkg | tr '/' '_')
    go doc -all "$pkg" > "docs/text/${pkg_name}.txt"
done

echo "Documentation generated in docs/"
```

**Better approach: Use documentation tests instead of static generation:**
```bash
# For most projects, the best "documentation" is:
# 1. Well-written doc comments (checked by CI)
# 2. Running example tests
# 3. pkg.go.dev (automatic for public packages)

# CI check: verify all exported symbols are documented
go list -json ./... | jq -r '.GoFiles[]' | xargs -I{} sh -c 'go doc ./$(dirname {}) 2>&1' | grep -c "missing doc"
```
</details>

---

## Exercise 6 🟡 — Optimize golangci-lint Run Time

**Original `.golangci.yml`:**

```yaml
linters:
  enable-all: true  # Enable EVERY linter!

run:
  timeout: 30m
  concurrency: 1   # Single threaded!
```

**Problem:** CI lint step takes 20 minutes and often times out.

**Task:** Configure golangci-lint for a reasonable balance of coverage and speed.

<details>
<summary>Solution</summary>

```yaml
# .golangci.yml — optimized configuration

run:
  timeout: 5m
  concurrency: 0   # 0 = use all available CPUs
  
  # Cache results
  cache:
    path: ~/.cache/golangci-lint

linters:
  disable-all: true  # start clean
  enable:
    # Fast, high-value linters:
    - govet        # all go vet checks
    - errcheck     # unchecked errors (very important!)
    - staticcheck  # advanced static analysis
    - gosimple     # simplification suggestions
    - ineffassign  # unused assignments
    - unused       # unused code
    - gofmt        # formatting check
    - gocritic     # common mistakes

    # Optional: add these for stricter codebases
    # - gosec     # security issues
    # - dupl      # code duplication
    # - gocyclo   # complexity

linters-settings:
  errcheck:
    # Only check errors from important packages
    check-type-assertions: true
    check-blank: true

  govet:
    enable-all: true

issues:
  # Exclude generated files
  exclude-rules:
    - path: ".*_generated.*\\.go"
      linters:
        - errcheck
        - govet
    - path: "_test\\.go"
      linters:
        - gosec

  # Maximum issues to report (prevents slow output processing)
  max-issues-per-linter: 50
  max-same-issues: 10
```

**CI integration with caching:**
```yaml
- name: golangci-lint
  uses: golangci/golangci-lint-action@v3
  with:
    version: v1.55
    # Use action's built-in caching
    args: --timeout=5m

- name: Cache golangci-lint
  uses: actions/cache@v3
  with:
    path: ~/.cache/golangci-lint
    key: golangci-lint-${{ hashFiles('.golangci.yml') }}
```

**Expected improvement:**
```
enable-all + concurrency=1: 20+ minutes
Optimized config + max concurrency: 2-3 minutes
With caching (unchanged code): 30-60 seconds
```
</details>

---

## Exercise 7 🔴 — Eliminate Redundant `go build` Steps in CI

**Original CI pipeline (runs sequentially):**

```yaml
jobs:
  ci:
    steps:
      - run: go build ./...          # build: 60 seconds
      - run: go vet ./...            # vet: 30 seconds (rebuilds!)
      - run: go test ./...           # test: 120 seconds (rebuilds!)
      - run: go test -race ./...     # race test: 180 seconds (rebuilds!)
      # Total: ~390 seconds + all the rebuilds
```

**Problem:** Each `go build`, `go vet`, `go test` invocation rebuilds packages that haven't changed. There's also no parallelism between independent steps.

**Task:** Restructure the CI pipeline to minimize compilation time.

<details>
<summary>Solution</summary>

```yaml
# Optimized CI pipeline

jobs:
  # Run fast checks in parallel
  format-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-go@v4
        with: {go-version: '1.21', cache: true}
      - run: gofmt -l . | tee /tmp/fmt-issues.txt
      - run: test -z "$(cat /tmp/fmt-issues.txt)"

  vet:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-go@v4
        with: {go-version: '1.21', cache: true}
      - run: go vet ./...  # Fast: uses cached objects from format-check

  test:
    runs-on: ubuntu-latest
    # Run in parallel with vet and format-check!
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-go@v4
        with: {go-version: '1.21', cache: true}
      # -count=1 disables test caching (use when you want fresh results)
      # Remove -count=1 to use test caching (much faster if tests pass)
      - run: go test -count=1 ./...

  # Race tests can run in parallel with regular tests
  test-race:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-go@v4
        with: {go-version: '1.21', cache: true}
      - run: go test -race -count=1 ./...

  # Only build the final binary if all checks pass
  build:
    needs: [format-check, vet, test]  # all must pass
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-go@v4
        with: {go-version: '1.21', cache: true}
      - run: go build -ldflags="-s -w" -o bin/app ./cmd/app

# Why this is faster:
# - format-check, vet, test, test-race all run in PARALLEL
# - Each job uses the Go build cache
# - Total time ≈ max(individual job times), not sum
# Original: 390 seconds sequential
# Optimized: ~120 seconds (test-race is slowest, others run in parallel)
```
</details>

---

## Exercise 8 🔴 — Incremental Documentation

**Problem:** A large project with 100+ packages takes 5 minutes to regenerate documentation on every commit, even when only 2 packages changed.

**Task:** Write a script that only regenerates documentation for packages that have changed since the last documentation build.

<details>
<summary>Solution</summary>

```bash
#!/bin/bash
# incremental-docs.sh

set -e

DOCS_DIR="docs/api"
LAST_BUILD_FILE=".last-docs-build"

mkdir -p "$DOCS_DIR"

# Get the last documentation build commit
LAST_BUILD=""
if [ -f "$LAST_BUILD_FILE" ]; then
    LAST_BUILD=$(cat "$LAST_BUILD_FILE")
fi

# Find packages with changed .go files since last build
if [ -n "$LAST_BUILD" ]; then
    # Get files changed since last docs build
    CHANGED_FILES=$(git diff --name-only "$LAST_BUILD" HEAD -- '*.go' 2>/dev/null || echo "")
    
    if [ -z "$CHANGED_FILES" ]; then
        echo "No Go files changed since last docs build. Skipping."
        exit 0
    fi
    
    # Get unique package directories
    CHANGED_DIRS=$(echo "$CHANGED_FILES" | xargs -I{} dirname {} | sort -u)
    
    # Convert to Go package paths
    CHANGED_PKGS=""
    for dir in $CHANGED_DIRS; do
        pkg=$(go list "./$dir" 2>/dev/null || true)
        if [ -n "$pkg" ]; then
            CHANGED_PKGS="$CHANGED_PKGS $pkg"
        fi
    done
else
    # First run: build docs for all packages
    CHANGED_PKGS=$(go list ./...)
fi

if [ -z "$CHANGED_PKGS" ]; then
    echo "No packages to document"
    exit 0
fi

echo "Generating docs for changed packages:"
for pkg in $CHANGED_PKGS; do
    echo "  $pkg"
    # Safe filename from package path
    filename=$(echo "$pkg" | tr '/' '_' | tr ':' '_')
    go doc -all "$pkg" > "$DOCS_DIR/${filename}.txt" 2>/dev/null || \
        echo "  WARNING: Could not generate docs for $pkg"
done

# Update last build marker
git rev-parse HEAD > "$LAST_BUILD_FILE"

echo "Documentation updated in $DOCS_DIR"
echo "Packages documented: $(echo $CHANGED_PKGS | wc -w)"
```

**For even better incremental builds, use `make` with file dependencies:**
```makefile
PACKAGES := $(shell go list ./...)
DOC_FILES := $(patsubst %, docs/api/%.txt, $(subst /,_,$(PACKAGES)))

docs/api/%.txt: $(wildcard $(subst _,/,$(*))./*.go)
	@mkdir -p docs/api
	go doc -all $(subst _,/,$(*)) > $@ 2>/dev/null || true

docs: $(DOC_FILES)
	@echo "Documentation up to date"

.PHONY: docs
```
</details>

---

## Exercise 9 🔴 — Optimize `go test` for Fast Feedback

**Problem:** Running `go test ./...` takes 3 minutes. Developers don't run tests because they're too slow.

**Task:** Configure and restructure tests to provide fast feedback during development.

<details>
<summary>Solution</summary>

```bash
# Strategy 1: Run only the package you're working on
go test ./internal/auth/...  # just auth package

# Strategy 2: Use test caching
go test ./...  # first run: 3 minutes
go test ./...  # second run (no changes): 0.1 seconds (cached!)

# Strategy 3: Fail fast — stop on first failure
go test -failfast ./...

# Strategy 4: Run tests in parallel within packages
go test -parallel=8 ./...

# Strategy 5: Separate fast unit tests from slow integration tests
# Use build tags:

# fast_test.go (runs by default)
func TestUserLogin(t *testing.T) { ... }

// slow_test.go (only with -tags integration)
//go:build integration
func TestUserLoginDatabase(t *testing.T) { ... }

# In development: run only unit tests
go test ./...

# In CI: run all
go test -tags integration ./...
```

**Makefile for tiered testing:**
```makefile
# Fast tests for development (default)
test:
	go test -count=1 -failfast ./...

# Full tests for CI
test-full:
	go test -race -count=1 -tags integration ./...

# Watch mode (requires entr: brew install entr)
test-watch:
	find . -name '*.go' | entr -c go test -count=1 -failfast ./...

# Test specific package matching a pattern
test-pkg:
	go test -v -run $(PATTERN) ./$(PKG)/...
# Usage: make test-pkg PKG=internal/auth PATTERN=TestLogin
```

**Advanced: Use -run to filter tests:**
```bash
# Run only tests matching a pattern
go test -run TestUserLogin ./internal/auth

# Run benchmark tests
go test -bench=. -benchmem ./...

# Run with verbose output for debugging
go test -v -run TestSpecific ./pkg/...

# Run with timeout
go test -timeout 30s ./...
```
</details>

---

## Exercise 10 🔴 — Optimize Binary Size for Container Deployment

**Original build:**
```bash
go build -o app ./cmd/server
# Binary size: 15MB
# Docker image: 100MB (alpine + 15MB binary + other stuff)
```

**Task:** Reduce binary size for faster container builds and smaller deployments.

<details>
<summary>Solution</summary>

```bash
# Step 1: Strip debug symbols and DWARF
go build -ldflags="-s -w" -o app ./cmd/server
# Binary size: ~9MB (40% reduction)

# Step 2: Use UPX compression (optional, adds startup latency)
# upx --best --lzma app
# Binary size: ~4MB (but slower startup)

# Step 3: Static binary for minimal Docker image
CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w" \
    -o app \
    ./cmd/server
# Now you can use scratch or distroless image!

# Dockerfile for minimal image:
cat > Dockerfile << 'EOF'
# Build stage
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o app ./cmd/server

# Final stage — scratch or distroless
FROM gcr.io/distroless/static:nonroot
# or: FROM scratch (no shell, no utilities)
COPY --from=builder /app/app /app
ENTRYPOINT ["/app"]
EOF

# Docker image size comparison:
# golang:1.21 + binary:   ~900MB
# alpine + binary:        ~20MB
# distroless + binary:    ~11MB
# scratch + binary:       ~9MB

# Step 4: Check what's making your binary large
go tool nm app | sort -k 2 -r | head -20  # largest symbols
go tool nm app | grep "\.strtab\|\.symtab"  # debug data

# Use gosize to get a breakdown by package:
go install github.com/bradfitz/gosize@latest
gosize app
```

**Optimized multi-stage Dockerfile:**
```dockerfile
# syntax=docker/dockerfile:1

FROM golang:1.21-alpine AS build
WORKDIR /src

# Cache module downloads separately from source changes
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Build with all optimizations
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build \
    -ldflags="-s -w -extldflags '-static'" \
    -trimpath \
    -o /out/app \
    ./cmd/server

# -trimpath: removes file system paths from binary (privacy + size)

FROM gcr.io/distroless/static:nonroot-amd64
COPY --from=build /out/app /app
ENTRYPOINT ["/app"]
```

**Additional `-trimpath` benefit:** Removes your build machine's file paths from the binary, which:
1. Slightly reduces binary size
2. Prevents leaking internal directory structure
3. Makes builds reproducible across machines

**Expected results:**
```
go build (default):              15MB
go build -ldflags="-s -w":       9MB  (-40%)
go build -ldflags="-s -w" -trimpath: 8.5MB (-43%)
Docker image (alpine + 9MB):    20MB
Docker image (distroless + 8.5MB): 11MB (-45% vs alpine)
Docker image (scratch + 8.5MB):  8.5MB (-57% vs alpine)
```
</details>

---

## Benchmarking Reference

```bash
# Measure build time
time go build ./...
time go build ./... 2>&1 | grep "real"

# Measure test time by package
go test -v ./... 2>&1 | grep -E "^--- |^==="

# Profile the build itself
go build -x ./... 2>&1 | head -50  # verbose build steps

# Measure linting time
time golangci-lint run

# See which packages take longest to compile
go build -v ./... 2>&1 | head -30  # shows compilation order

# Cache effectiveness
go build ./... && go build ./...  # second should be near instant
```

## Summary: Optimization Techniques for Go Tooling

| Technique | When to Use | Expected Gain |
|-----------|------------|---------------|
| Don't clean cache unnecessarily | Always | 10x+ build speedup |
| Parallel platform builds | Cross-compilation scripts | 4x speedup |
| Cache GOMODCACHE in CI | Every CI setup | 2-3 min saved |
| Cache GOCACHE in CI | Every CI setup | 30-60 sec saved |
| Parallel CI jobs | Independent checks | Sum → max time |
| Selective testing (changed packages) | Large monorepos | 10-50x speedup |
| `-failfast` flag | Development testing | Faster feedback |
| Build tags for integration tests | Test suite separation | 10x faster unit tests |
| `-ldflags="-s -w"` | Production binaries | 40% size reduction |
| `-trimpath` | Container deployments | Reproducible + smaller |
| `CGO_ENABLED=0` | Container deployments | Enables scratch/distroless |
| `golangci-lint` caching | CI lint runs | 5-10x faster |
