# 8.9 `embed` and `//go:embed` — Tasks

> Hands-on exercises. Each has a clear goal, hints, and acceptance
> criteria. Do them in a fresh module so the directory layout is
> obvious.

## Task 1 — Embed a version string

**Goal.** Print the version from a file embedded in the binary.

**Setup.** Create `main.go` and `version.txt` in the same directory.
`version.txt` contains the single line `1.0.0`.

**Requirements.**
- The version variable is of type `string`.
- The program prints the version followed by a newline.
- After `go build`, deleting `version.txt` does not affect the
  binary's output.

**Hints.**
- Don't forget `import _ "embed"`.
- The file content includes whatever whitespace is in `version.txt`;
  use `strings.TrimSpace` if needed.

**Acceptance.** `./bin && rm version.txt && ./bin` prints the same
value both times.

## Task 2 — Embed a binary asset and write it back to disk

**Goal.** Embed a small image (e.g., a `.png`) and write it to a
caller-specified path.

**Requirements.**
- The asset is stored as `[]byte`.
- The output path is taken from `os.Args[1]`.
- The file is written with permissions `0o644`.

**Hints.**
- Use `os.WriteFile`.
- Use any small PNG; a 1x1 pixel works.

**Acceptance.** `./bin out.png` produces a file whose bytes match the
embedded asset exactly. `cmp out.png assets/pixel.png` exits zero.

## Task 3 — Embed a directory tree and walk it

**Goal.** Embed a directory of mixed files and print every path with
its size.

**Requirements.**
- Use `embed.FS`.
- Print one line per file: `path size_bytes`.
- Skip directories in the output.
- Output sorted by path.

**Hints.**
- `fs.WalkDir` already visits in lexical order — no extra sort
  needed.
- `d.Info()` returns the `fs.FileInfo` for the entry.

**Acceptance.** Adding a new file to the directory and rebuilding
shows the new file in the output. Removing the source directory after
the build does not change the output.

## Task 4 — Serve a static directory over HTTP

**Goal.** Serve an embedded `static/` directory at `/`.

**Requirements.**
- Listen on `:8080`.
- A request to `/main.css` returns the embedded file
  `static/main.css`.
- A request to `/missing.css` returns 404.

**Hints.**
- `fs.Sub(myFS, "static")` to drop the directory prefix.
- `http.FS` wraps `fs.FS` for `http.FileServer`.

**Acceptance.** `curl -i localhost:8080/main.css` returns 200 with the
embedded bytes. `curl -i localhost:8080/missing.css` returns 404.

## Task 5 — Parse and render embedded templates

**Goal.** Build a tiny page rendering an embedded template with data.

**Requirements.**
- Templates live in `templates/*.html`.
- One template `index.html` with a placeholder for a `Name`.
- HTTP handler at `/` renders `index.html` with `Name` derived from
  the `name` query parameter (default `World`).

**Hints.**
- `template.Must(template.ParseFS(fsys, "templates/*.html"))`.
- Use `html/template`, not `text/template`, for HTML content.

**Acceptance.** `curl 'localhost:8080/?name=Ada'` produces output
containing `Hello, Ada`.

## Task 6 — Hidden files with `all:`

**Goal.** Include a `.htaccess` file in an embedded directory.

**Requirements.**
- Directory `assets/` contains `assets/main.css` and
  `assets/.htaccess`.
- The program prints the names of all embedded files.
- Without `all:`, only `assets/main.css` is listed.
- With `all:`, both files are listed.

**Hints.**
- Toggle by changing the directive between `//go:embed assets` and
  `//go:embed all:assets`.

**Acceptance.** Two builds, with and without `all:`, demonstrate the
difference.

## Task 7 — Dual-mode dev/prod loading

**Goal.** Build two binaries that serve the same content from
different sources: live disk in dev, embedded in prod.

**Requirements.**
- Two files with build tags: `assets_dev.go` (`//go:build dev`) and
  `assets_prod.go` (`//go:build !dev`).
- Each exports a function `Assets() fs.FS`.
- Dev returns `os.DirFS("./assets")`.
- Prod returns the embedded `embed.FS` (with `fs.Sub` if needed).
- The HTTP server code uses only `Assets()`.

**Hints.**
- Build with `go build -tags dev -o devbin` and
  `go build -o prodbin`.

**Acceptance.** Modifying `./assets/main.css` and refreshing changes
the dev server's response without rebuilding. The prod server's
response does not change without a rebuild.

## Task 8 — Embedded SQL migrations

**Goal.** Apply embedded SQL files to a SQLite database in lexical
order.

**Requirements.**
- Migrations live in `migrations/*.sql` with names like
  `001_init.sql`, `002_add_users.sql`.
- A table `schema_versions(version TEXT PRIMARY KEY)` records applied
  versions.
- Already-applied migrations are skipped on re-run.
- Each migration runs in its own transaction.

**Hints.**
- `database/sql` with `modernc.org/sqlite` (pure Go) avoids cgo.
- `fs.ReadDir` returns entries in lexical order.
- Use `errors.Is` to handle `sql.ErrNoRows`.

**Acceptance.** Running the program twice does not re-run the
migrations the second time. Adding a new migration file and rerunning
applies only the new one.

## Task 9 — ETag from build ID

**Goal.** Serve embedded assets with an ETag derived from a build-time
variable.

**Requirements.**
- A package-level `var BuildID = "dev"` overridable via `-ldflags`.
- The HTTP handler sets `ETag: "<BuildID>"` and
  `Cache-Control: public, max-age=31536000, immutable` on every
  response.
- A request with matching `If-None-Match` header gets a 304 response.

**Hints.**
- Implement the conditional check yourself before delegating to
  `http.FileServer`.

**Acceptance.** With `go build -ldflags "-X main.BuildID=abc123"`,
all responses set ETag `"abc123"`. A request with
`If-None-Match: "abc123"` returns 304.

## Task 10 — Test fixtures via `embed`

**Goal.** Replace a `testdata/` directory loaded via `os.ReadFile`
with embedded fixtures.

**Requirements.**
- Tests run from any working directory without breaking.
- Fixture files live at `testdata/golden/*.json`.
- Each test loads its expected output from the embedded FS.

**Hints.**
- `//go:embed testdata/golden/*.json` works inside test files
  (filename `*_test.go`).
- Use `t.Run(name, ...)` to create one subtest per fixture.

**Acceptance.** `cd /tmp && go test ./pathtopackage/...` passes.

## Task 11 — Compress before embedding

**Goal.** Embed a gzipped JSON file and decompress at startup.

**Requirements.**
- A 1+ MiB JSON file is gzipped at build time (via a `Makefile` or
  `go generate` step).
- The program embeds only the `.gz` variant.
- The decompressed JSON is parsed once at init and stored in a
  package-level map.
- The compressed bytes are dropped (set to `nil`) after decompression.

**Hints.**
- `compress/gzip` to decompress.
- `runtime.GC()` after dropping the compressed slice if you want to
  see the savings in `pprof`.

**Acceptance.** The binary is smaller than embedding the uncompressed
file. The map is populated correctly. After init, the compressed slice
is unreferenced.

## Task 12 — `fstest.TestFS` for an embed

**Goal.** Validate the file set in an `embed.FS`.

**Requirements.**
- `embed.FS` covers `templates/*.html` (4 files).
- A test calls `fstest.TestFS(myFS, "templates/index.html",
  "templates/admin.html", ...)`.
- The test fails if any expected file is missing or if any file is
  unreadable.

**Hints.**
- `testing/fstest.TestFS` does conformance checking; expected names
  are *required* names.

**Acceptance.** Removing one of the 4 templates and rebuilding causes
the test to fail with a clear message.

## Task 13 — Pattern that matches nothing

**Goal.** Demonstrate the build-time error for an unmatched pattern.

**Requirements.**
- Source file with `//go:embed nothing/*.xyz`.
- The package compiles when at least one matching file exists.
- The package fails to compile when no matching file exists.

**Hints.**
- This is a brief drill — read the error message and describe what it
  says.

**Acceptance.** A short note in your answer that quotes the error
message and identifies the rule violated.

## Task 14 — Multi-tenant assets via build tags

**Goal.** Two binaries with the same source, different embedded
asset bundles.

**Requirements.**
- Directories `assets/acme/` and `assets/widgets/`.
- File `branding_acme.go` (`//go:build branding_acme`) embeds
  `all:assets/acme`.
- File `branding_widgets.go` (`//go:build branding_widgets`) embeds
  `all:assets/widgets`.
- A default file with `//go:build !branding_acme && !branding_widgets`
  embeds a default bundle.
- Each file exports the same `Assets fs.FS`.

**Hints.**
- Each tagged file declares the same package-level variable; only
  one is compiled in any given build.

**Acceptance.** Three binaries from the same source produce three
different served asset sets.

## Task 15 — Find what was embedded with `go list`

**Goal.** Use the toolchain to inspect embedded files without
running the program.

**Requirements.**
- Run `go list -f '{{.EmbedFiles}}' ./...` for a package with at
  least two `//go:embed` directives.
- Capture the output.

**Hints.**
- `go list -json ./...` also exposes `EmbedFiles` if you want
  structured output.

**Acceptance.** A short note showing the command's output and
identifying which directive contributed which files.

## Task 16 — Recursive template parsing

**Goal.** Parse all `.html` templates under `templates/`, including
subdirectories, despite the lack of a `**` glob.

**Requirements.**
- Templates live in `templates/`, with subdirectories
  `templates/admin/` and `templates/email/`.
- A function `loadTemplates(fsys fs.FS) (*template.Template, error)`
  walks the FS and parses every `.html` file.
- Templates are addressable by their full path inside the FS.

**Hints.**
- `fs.WalkDir` plus `template.New(path).Parse(string(bytes))`.
- `tpl.ExecuteTemplate(w, "templates/admin/edit.html", data)`.

**Acceptance.** A template file at any depth renders by full path.

## Task 17 — Drain HTTP body when serving

**Goal.** Confirm the HTTP server pattern doesn't leak connections.

**Requirements.**
- Set up the static-file server from Task 4.
- Issue 1000 requests in a loop with `httptest`.
- After the loop, `runtime.NumGoroutine()` returns to baseline.

**Hints.**
- `http.FileServer` already handles this for you; the goal is to
  confirm by measurement.

**Acceptance.** No goroutine leak after 1000 requests.

## Task 18 — Pre-gzipped HTTP serving

**Goal.** Serve a `.gz` variant when the client supports gzip.

**Requirements.**
- `static/main.css` and `static/main.css.gz` both embedded.
- Request with `Accept-Encoding: gzip` gets the `.gz` bytes plus
  `Content-Encoding: gzip` and `Vary: Accept-Encoding`.
- Request without `Accept-Encoding: gzip` gets the plain bytes.

**Hints.**
- See the pattern in `professional.md`.
- Use `fs.Stat` to check whether the `.gz` variant exists.

**Acceptance.** `curl -H 'Accept-Encoding: gzip' --compressed
localhost:8080/main.css` returns the same uncompressed body as
`curl localhost:8080/main.css`, but with different transfer encoding.

## Task 19 — Index.html fallback for SPA

**Goal.** Wrap an embedded asset server so that any path that doesn't
match a file falls back to `index.html`.

**Requirements.**
- Asset directory contains `index.html` and a few other files.
- Request to a real file path returns that file.
- Request to a non-existent path returns the `index.html` content
  with status 200.

**Hints.**
- `fs.Stat(myFS, path)` returns `fs.ErrNotExist` for missing files.
- Use `errors.Is`.

**Acceptance.** Both `curl /` and `curl /any/random/path` return the
contents of `index.html`.

## Task 20 — Audit: what's in the binary?

**Goal.** Print the total size of all embedded data in a binary.

**Requirements.**
- Walk `embed.FS` at startup, sum `info.Size()` across every file.
- Log `embedded N files, total M bytes`.

**Hints.**
- Skip directories.
- This is what `go tool nm -size <binary>` shows from the outside;
  the program shows it from the inside.

**Acceptance.** The reported total matches the file-system byte count
of the embedded directory before build.
