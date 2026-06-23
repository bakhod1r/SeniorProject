# 8.9 `embed` and `//go:embed` — Interview

> Questions you should be able to answer about `embed`. Each item has a
> short answer suitable for a screening round and a deeper note for a
> follow-up. Use it to prepare or to run the interview.

## 1. What does `//go:embed` do, and when?

**Short.** It tells the compiler to read a named file (or set of
files) from the source tree and bake the bytes into the binary as
the value of the variable that follows the directive.

**Deeper.** It is purely compile-time; the file set is fixed when
`go build` completes. The variable is one of three types — `string`,
`[]byte`, or `embed.FS` — and the package must import `embed`. There
is no runtime I/O on the embedded data; it lives in the binary's
read-only data section and is exposed via the `io/fs` interfaces.

## 2. What are the three target types and when do you choose each?

**Short.** `string` for a single text file, `[]byte` for a single
binary file, `embed.FS` for one or more files / globs / trees.

**Deeper.** `string` and `[]byte` are restricted to one matched file.
`embed.FS` implements `fs.FS`, `fs.ReadFileFS`, and `fs.ReadDirFS`,
which is what makes it composable with `http.FS`, `template.ParseFS`,
and `testing/fstest`. If you need to embed more than one file, the
choice is forced: `embed.FS`.

## 3. Why does the directive require `import "embed"` even when using `string`?

**Short.** The compiler enforces it as a marker that `embed` is in
use; the runtime needs the package's init code regardless of which
target type you chose.

**Deeper.** The blank import `_ "embed"` is sufficient when you only
use `string` or `[]byte`. The actual `embed.FS` type is only needed if
your variable's type is `embed.FS`. Either way, the package import is
mandatory; the compiler emits an explicit error if it's missing.

## 4. Why doesn't `//go:embed ../templates/foo.html` work?

**Short.** The directive forbids `..` in paths. Patterns must resolve
inside the package's directory tree.

**Deeper.** The reason is reproducibility. The compiler computes the
embed file set lexically without filesystem traversal beyond the
package; allowing `..` would invite escapes outside the module and
make builds depend on cross-package layout. To embed files that live
elsewhere, copy them into the package or move the package.

## 5. What is `all:` for?

**Short.** It removes the default exclusion of files and directories
whose names start with `.` or `_`.

**Deeper.** Without `all:`, embed silently skips dotfiles and
underscore-prefixed entries because those are conventionally
"don't include." That skipping bites teams trying to embed `.well-known`
directories (for HTTPS challenges), `.eslintrc`, `.htaccess`, or
`_redirects`. `all:` is per-pattern, so you can mix `all:assets` with
`templates/*.html` in one directive.

## 6. What does `embed.FS` report for `ModTime()` and why does it matter?

**Short.** The zero `time.Time`. It matters because HTTP cache
validation (`Last-Modified` / `If-Modified-Since`) can't use it, so
clients revalidate every request.

**Deeper.** The remediation is to set explicit cache headers and an
ETag derived from a build ID baked in via `-ldflags`, or to compute
per-file SHA hashes at startup and use them as ETags. Either makes
the cache layer behave correctly without relying on file metadata that
embed deliberately doesn't track.

## 7. How do you serve embedded static files over HTTP?

**Short.** `http.FileServer(http.FS(myFS))`, usually wrapped in
`http.StripPrefix` and applied to a `fs.Sub` view.

**Deeper.** Three pieces: `fs.Sub(myFS, "static")` strips the
directory prefix inside the FS, `http.FS(...)` adapts an `fs.FS` into
an `http.FileSystem`, `http.StripPrefix("/static/", ...)` removes the
URL prefix before the file server sees it. Forgetting any of the
three causes 404s or path duplication.

## 8. How do you use embedded templates with `html/template`?

**Short.** `template.Must(template.ParseFS(fsys, patterns...))`.

**Deeper.** The patterns argument uses `path.Match` syntax. The
templates' names are the matching paths; you execute them by name
with `tpl.ExecuteTemplate(w, "templates/index.html", data)`. For
recursive parsing across subdirectories, walk the FS yourself and
call `tpl.New(path).Parse(string(bytes))` per file.

## 9. Can you embed files generated during the build?

**Short.** Yes, if `go generate` (or whatever produces them) runs
*before* the `go build` that sees the directive.

**Deeper.** `//go:embed` evaluates at compile time. The named files
must exist when the compiler reads the directive. The conventional
recipe is `//go:generate` adjacent to the `//go:embed`, run
`go generate ./...` to produce the generated files, then `go build`
to compile with embedding.

## 10. Why can't you put `//go:embed` inside a function?

**Short.** The directive only applies to package-level `var`
declarations. The compiler rejects function-local uses.

**Deeper.** Function-local variables are initialized at runtime with
function-scope semantics; embedded data is initialized once, at
program start. The constraint also keeps the embed file set
discoverable from a static scan of the source — which is what the
linker needs to size the binary section.

## 11. Is `embed.FS` safe for concurrent use?

**Short.** Yes — both the FS and any single `fs.File` returned from
`Open` are safe for concurrent reads via `ReadAt`. A single `fs.File`
is *not* safe for concurrent `Read` (it shares a position cursor),
just like `*os.File`.

**Deeper.** The data lives in the binary's read-only data segment.
Multiple goroutines can call `Open` independently and each gets its
own file handle. For random concurrent reads, prefer `ReadFile` (which
returns a fresh slice each call) or open separate handles per
goroutine.

## 12. What happens to file permissions and modification times?

**Short.** Permissions are not preserved. `Mode()` returns `0o444` for
files and `0o555|fs.ModeDir` for directories. `ModTime()` returns the
zero `time.Time`.

**Deeper.** The embed format records file contents, names, and the
directory hierarchy. Nothing else. Code that relies on `mtime`
(static-file caching, build systems, sorting) needs an alternative
signal — usually a build-time variable.

## 13. What are the trade-offs of compressing embedded data?

**Short.** Smaller binary, slower startup, more heap at runtime.

**Deeper.** `embed` does not compress. To shrink the binary, gzip or
zstd the file before embedding and decompress at startup. Trade-offs:
the compressed bytes still occupy heap if you keep the slice around;
decompression is a one-time cost (a few ms per MiB); startup latency
grows. For HTTP-served assets, pre-gzipping each file and serving
the `.gz` variant when the client supports gzip is usually a better
play — saves both binary size and per-request CPU.

## 14. How do you swap embedded vs. live-reload assets?

**Short.** Build tags. One file with `//go:build dev` exposes
`os.DirFS("./assets")`; another with `//go:build !dev` exposes the
embedded `embed.FS`. Both files export an `FS()` function returning
`fs.FS`.

**Deeper.** The rest of the program takes `fs.FS` and never knows
which it has. Build with `-tags dev` for live-reload, plain
`go build` for production. The same pattern works for any
build-time/runtime asset choice.

## 15. What's the difference between `path` and `path/filepath` in this context?

**Short.** `embed.FS` paths are always slash-separated. Use `path`
(or string concatenation) for embed paths and `path/filepath` only
for OS-native disk paths.

**Deeper.** Mixing them — using `filepath.Join("templates", "x")` on
Windows for an embed lookup — produces `templates\x`, which embed
rejects. The bridge for code that walks disk and queries embed is
`filepath.ToSlash`, which converts an OS path to slash form.

## 16. What does `go list -f '{{.EmbedFiles}}'` show you?

**Short.** The resolved list of files matched by `//go:embed`
directives in the package, computed by the toolchain.

**Deeper.** This is the canonical way to debug "did my pattern match?"
without compiling. If the file is in the list, the directive is
working; if it isn't, the pattern is wrong, the file is hidden, or
the file doesn't exist where you think it does.

## 17. Can `embed` follow symbolic links?

**Short.** No. The current toolchain rejects symbolic links during
embed resolution.

**Deeper.** Following symlinks would make builds platform-dependent
(some symlinks resolve differently across OSes) and is incompatible
with reproducible builds. To embed a file that lives via a symlink,
either remove the symlink and place the file directly, or copy the
contents.

## 18. What's a good test pattern for embedded assets?

**Short.** `testing/fstest.TestFS(myFS, expectedNames...)` to confirm
files are present; pass `fstest.MapFS` instead of `embed.FS` in unit
tests of code that takes an `fs.FS`.

**Deeper.** `TestFS` walks the FS, opens each named file, and runs
the conformance tests in `io/fs`. It catches missing patterns at test
time. For unit tests of business logic, the abstraction over `fs.FS`
means you don't need an `embed.FS` at all — `MapFS` is faster to
write and modify per-test.

## 19. Why might embedding *not* be the right call?

**Short.** Frequently-changing content, large media assets, anything
that should ship through a CDN, or assets that need rotation
independent of binary releases.

**Deeper.** Embedded means version-coupled with the binary. That is
the feature for templates and migrations; it's a cost for the rest.
For high-traffic public web assets, a CDN serves bytes more cheaply.
For per-customer config, embedding produces too many binaries.

## 20. What does the `embed` package's API consist of?

**Short.** One type, three methods: `embed.FS`, with `Open`,
`ReadDir`, and `ReadFile`.

**Deeper.** That's the full public surface. Everything else you do
with embedded data goes through `io/fs` package functions and through
downstream consumers (`http.FS`, `template.ParseFS`,
`fstest.TestFS`). The minimalism is by design — `embed` produces an
`fs.FS`; the standard library handles the rest.
