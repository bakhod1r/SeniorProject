# 8.9 `embed` and `//go:embed` — Professional

> **Audience.** You operate a service that depends on embedded assets
> in production. You care about deploy artifacts, binary size,
> versioning, observability, and the boundary where embed-the-binary
> meets ship-via-CDN. This file is for the choices you make once you've
> moved past "does this compile."

## 1. The deployment shape question

Before you decide *how* to embed, decide *what* belongs in the binary
and what doesn't. The default categories:

| Content | Embed? | Why |
|---------|--------|-----|
| HTML/text templates the binary owns | Yes | Tightly versioned with code |
| SQL migrations | Yes | Run by the binary, version-locked |
| Default config / fallback fixtures | Yes | Ship with the program |
| TLS root CA bundle (if you need to override system) | Yes | Reproducibility, no PKI surprises |
| Frontend bundle (`.js`, `.css`) | Maybe | Embed if low-traffic; CDN if high-traffic |
| User uploads | Never | Not present at build time |
| Marketing images, big media | Rarely | Better via CDN with cache headers |
| Localization files | Yes | Small, version-locked |
| OpenAPI / GraphQL schema | Yes | Consumed by the binary itself |

The rule of thumb: embed content that's coupled to the code's
version. Don't embed content that has its own lifecycle.

## 2. Versioning embedded assets

Embedded assets share the binary's version. That is the feature *and*
the cost. The cost: a CSS-only fix requires a binary release. The
feature: there is no version skew between code and assets.

When you need to expose the version externally (cache busting, API
responses), stamp it once and reuse:

```go
// version.go
package main

var (
    BuildID    = "dev"   // -ldflags
    BuildTime  = ""      // -ldflags
    GoVersion  = ""      // -ldflags or runtime.Version()
)
```

```bash
go build \
    -ldflags "-X 'main.BuildID=$(git rev-parse --short HEAD)' \
              -X 'main.BuildTime=$(date -u +%Y-%m-%dT%H:%M:%SZ)'" \
    -o app ./...
```

Every embedded asset effectively has the version `BuildID`. Use it as
the basis for cache headers, ETag values, and asset URLs:

```go
http.Handle("/assets/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
    w.Header().Set("ETag", `"`+BuildID+`"`)
    fileServer.ServeHTTP(w, r)
}))
```

For cache-busting URLs, prefix the asset path with the version:

```go
http.Handle("/assets/v"+BuildID+"/", http.StripPrefix("/assets/v"+BuildID+"/", fileServer))
```

Templates reference `/assets/v{{.BuildID}}/main.css`; old URLs 404
naturally as old binaries shut down.

## 3. Compressing for size

`embed` stores raw bytes. For large textual assets (JSON datasets,
GeoIP tables, stop-word lists), pre-compression cuts binary size 3x or
more. The pattern:

```go
//go:embed cities.json.zst
var citiesZst []byte

var cities = mustDecodeZstd(citiesZst)

func mustDecodeZstd(b []byte) []byte {
    dec, err := zstd.NewReader(bytes.NewReader(b))
    if err != nil { panic(err) }
    defer dec.Close()
    out, err := io.ReadAll(dec)
    if err != nil { panic(err) }
    return out
}
```

Trade-offs:

- **Binary size.** Smaller. Big win for large text.
- **Startup time.** A few ms per MiB of decompression. Usually fine.
- **Heap usage.** The decompressed data lives in heap, doubling
  resident memory if you keep the compressed copy too. Free the
  compressed slice if you don't need it again:
  `citiesZst = nil` after init.

For HTTP-served assets, an even better play is to pre-compress to
`.gz` and serve those bytes directly when the client supports gzip,
saving both binary size *and* per-request CPU.

## 4. Pre-compressed HTTP assets

The pattern for sub-megabyte sites:

```go
//go:embed all:dist
var distFS embed.FS

func staticHandler() http.Handler {
    sub, err := fs.Sub(distFS, "dist")
    if err != nil { log.Fatal(err) }
    fileServer := http.FileServer(http.FS(sub))
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        accepts := r.Header.Get("Accept-Encoding")
        gzPath := r.URL.Path + ".gz"
        if strings.Contains(accepts, "gzip") {
            if _, err := fs.Stat(sub, strings.TrimPrefix(gzPath, "/")); err == nil {
                w.Header().Set("Content-Encoding", "gzip")
                w.Header().Set("Vary", "Accept-Encoding")
                r2 := r.Clone(r.Context())
                r2.URL.Path = gzPath
                fileServer.ServeHTTP(w, r2)
                return
            }
        }
        fileServer.ServeHTTP(w, r)
    })
}
```

A build step generates `main.css` *and* `main.css.gz`. Both are
embedded. The handler picks the right one per request, sets the
encoding header, and lets `http.FileServer` do the rest.

Don't forget `Vary: Accept-Encoding` — without it, downstream caches
may serve the gzipped bytes to clients that don't support gzip.

## 5. Migrations: idempotent, ordered, embedded

Embedded SQL migrations need three properties: ordered, idempotent,
recorded. The standard implementation:

```go
//go:embed migrations/*.sql
var migrationFS embed.FS

func runMigrations(ctx context.Context, db *sql.DB) error {
    if _, err := db.ExecContext(ctx, `
        CREATE TABLE IF NOT EXISTS schema_versions (
            version TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`); err != nil {
        return err
    }

    entries, err := fs.ReadDir(migrationFS, "migrations")
    if err != nil { return err }
    sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })

    for _, e := range entries {
        if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") { continue }
        version := strings.TrimSuffix(e.Name(), ".sql")

        var exists bool
        if err := db.QueryRowContext(ctx,
            `SELECT EXISTS(SELECT 1 FROM schema_versions WHERE version=$1)`,
            version).Scan(&exists); err != nil {
            return err
        }
        if exists { continue }

        sqlBytes, err := fs.ReadFile(migrationFS, "migrations/"+e.Name())
        if err != nil { return err }

        tx, err := db.BeginTx(ctx, nil)
        if err != nil { return err }
        if _, err := tx.ExecContext(ctx, string(sqlBytes)); err != nil {
            tx.Rollback()
            return fmt.Errorf("migration %s: %w", version, err)
        }
        if _, err := tx.ExecContext(ctx,
            `INSERT INTO schema_versions(version) VALUES ($1)`, version); err != nil {
            tx.Rollback()
            return err
        }
        if err := tx.Commit(); err != nil { return err }
        log.Printf("applied migration %s", version)
    }
    return nil
}
```

Naming convention: `001_init.sql`, `002_add_index.sql`, etc. Lexical
sort matches numerical order if you zero-pad. For library-grade
tooling, `golang-migrate/migrate` with the `iofs` source consumes
your `embed.FS` directly and adds rollback, locking, and dirty-state
detection.

## 6. Frontend integration: SPA serving

A common shape: a `frontend/` directory built by `npm` or similar,
output goes to `frontend/dist/`, the Go service embeds and serves it.

```go
//go:embed all:frontend/dist
var frontendFS embed.FS

func newFrontendHandler() http.Handler {
    sub, err := fs.Sub(frontendFS, "frontend/dist")
    if err != nil { log.Fatal(err) }
    fileServer := http.FileServer(http.FS(sub))
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // SPA fallback: any path that doesn't match a file serves index.html
        if _, err := fs.Stat(sub, strings.TrimPrefix(r.URL.Path, "/")); errors.Is(err, fs.ErrNotExist) {
            r2 := r.Clone(r.Context())
            r2.URL.Path = "/"
            fileServer.ServeHTTP(w, r2)
            return
        }
        fileServer.ServeHTTP(w, r)
    })
}
```

Build pipeline:

```bash
(cd frontend && npm ci && npm run build)
go build -o app ./...
```

`go:generate` can wrap that:

```go
//go:generate sh -c "cd frontend && npm ci && npm run build"
```

Now `go generate ./... && go build` produces a single, deployable
binary that serves the entire SPA.

## 7. Observability: log what you embedded

For services where missing assets would be a serious bug, log the
embedded set at startup:

```go
func logEmbeddedAssets(fsys fs.FS) {
    var count int
    var total int64
    fs.WalkDir(fsys, ".", func(path string, d fs.DirEntry, err error) error {
        if err != nil || d.IsDir() { return nil }
        info, err := d.Info()
        if err == nil {
            count++
            total += info.Size()
        }
        return nil
    })
    log.Printf("embedded assets: %d files, %d bytes", count, total)
}
```

For deeper visibility, expose `/debug/embed` returning the file tree:

```go
http.HandleFunc("/debug/embed", func(w http.ResponseWriter, r *http.Request) {
    fs.WalkDir(myFS, ".", func(path string, d fs.DirEntry, err error) error {
        fmt.Fprintln(w, path)
        return nil
    })
})
```

Gate the endpoint behind auth. Use it to confirm what's actually in a
production binary when a user reports a missing asset.

## 8. Build constraints for asset variants

For multi-tenant or white-label products, build constraints let you
swap embedded asset bundles per build:

```go
// branding_acme.go
//go:build branding_acme

package branding

import "embed"

//go:embed all:assets/acme
var Assets embed.FS
```

```go
// branding_default.go
//go:build !branding_acme

package branding

import "embed"

//go:embed all:assets/default
var Assets embed.FS
```

```bash
go build -tags branding_acme -o app-acme
go build -o app-default
```

Each binary has only its tenant's assets — no cross-customer leakage,
no runtime branding lookup. The trade-off is one binary per tenant
instead of one binary plus configuration. For B2B SaaS where
customers run their own deployments, this often comes out ahead.

## 9. Test fixtures via embed

For complex test fixtures (golden files, large JSON inputs), embedding
keeps tests hermetic:

```go
package myservice

import (
    "embed"
    "testing"
)

//go:embed testdata/golden/*.json
var goldenFS embed.FS

func TestProcess(t *testing.T) {
    entries, _ := goldenFS.ReadDir("testdata/golden")
    for _, e := range entries {
        e := e
        t.Run(e.Name(), func(t *testing.T) {
            input, err := goldenFS.ReadFile("testdata/golden/" + e.Name())
            if err != nil { t.Fatal(err) }
            // ... assertions
        })
    }
}
```

Tests no longer depend on the test runner's working directory or on
the layout of `testdata` relative to where `go test` was invoked.
Ten years later, when the build system has moved twice, the tests
still find their fixtures.

The conventional `testdata` directory is excluded from package builds
by `go build` but included by `go test`. The compiler still respects
`//go:embed testdata/*` because `embed` evaluation happens at compile
time regardless of the directory's special status.

## 10. Container images: still rely on `go build`

When you put `embed` in a containerized service, the Dockerfile gets
simpler, not more complex. A minimal multistage build:

```dockerfile
FROM golang:1.22 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags "-s -w -X main.BuildID=$(git rev-parse HEAD)" -o /out/app ./cmd/app

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/app /app
ENTRYPOINT ["/app"]
```

The runtime image has no shell, no package manager, no asset volume —
just the binary. Embedded assets ride along. The `-s -w` ldflags
strip debug info to keep the binary smaller.

Image scanning tools see the embedded files as binary contents, not
as separate filesystem entries. That can simplify CVE management
(fewer filesystem layers) but means traditional file-level scanners
won't catch a vulnerable JS bundle inside the binary.

## 11. Trade-off: embed vs. separate filesystem layer

The argument for embedding is simplicity. The argument against is
deployability. Some real considerations:

- **Hot patching.** If you can't ship a new binary in seconds, the
  ability to drop a fixed CSS file into a running container matters.
  With embedded assets, no — you redeploy.
- **Per-tenant config.** A binary per tenant is fine for ten
  customers, painful for ten thousand.
- **Delta updates.** A 100 MiB binary change is one full download per
  rolling update host. A 100 KiB CSS change to a CDN is a few cents.
- **Asset CDN economics.** CDNs are cheap for bytes, expensive per
  request. Embedded HTTP serving avoids the CDN cost for low-traffic
  assets, costs you origin bandwidth for popular ones.

For most internal services, embed everything. For anything serving
the public web at scale, embed templates and code-coupled assets,
push the rest to a CDN.

## 12. Security considerations

Embedded assets are tamper-proof relative to the binary itself —
modifying them requires modifying the binary. Two consequences:

- **Code signing covers them.** If your binary is signed, the embed
  contents are signed by transitivity. No need to sign each asset
  separately.
- **You can't rotate them without a new binary.** A leaked TLS root
  baked into the binary is a binary vulnerability, not a config
  rotation. Plan accordingly: keep secrets out of embed, prefer
  config files for anything you might need to rotate.

Things you should *never* embed:

- Production credentials of any kind.
- Private keys (TLS server keys, signing keys).
- API tokens.
- User-supplied data — embeds are build-time, by definition.

Things you can usually embed:

- Public certificate bundles (root CAs, expected fingerprints).
- Default policy files where the policy itself is part of the
  product.
- Database schemas and migrations.

## 13. CI considerations

Embedding pulls files into the build. CI implications:

- **Asset generation must run before `go build`.** If you have a
  `make assets` step, it sequences before `make build`. `go generate`
  inside the build is the cleanest way to enforce this.
- **Test data is part of the source tree.** Don't `.gitignore` it
  unless you're sure tests don't embed it.
- **Build cache invalidation.** Changing an embedded file invalidates
  the binary cache for the package containing the directive. For
  monorepos with many small embeds, this can cause unexpectedly large
  rebuilds. The fix is usually to give large embeds their own
  package, so only that package rebuilds.

## 14. What to read next

- [specification.md](specification.md) — the formal grammar and rules
  in condensed form.
- [interview.md](interview.md) — common interview questions on `embed`
  with model answers.
- [optimize.md](optimize.md) — minimizing binary size, allocation,
  and first-byte latency.
