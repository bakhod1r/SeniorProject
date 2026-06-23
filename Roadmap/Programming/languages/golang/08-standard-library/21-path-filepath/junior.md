# 8.21 `path` and `path/filepath` — Junior

> **Audience.** You can open a file with `os.Open` and you've written
> string literals like `"config/app.yaml"`. Now you're hitting bugs on
> Windows, seeing mysterious double-slashes, or reading code that uses
> `path.Join` and `filepath.Join` interchangeably — and you want to
> know exactly which one to use and why. By the end of this file you'll
> understand the two-package split, know every everyday function in
> both packages, and avoid the most common cross-platform path bugs.

## 1. The one rule that explains everything

Go ships two packages:

| Package | Separator | Use for |
|---------|-----------|---------|
| `path` | always `/` | URL paths, `io/fs` virtual paths, anything not on disk |
| `path/filepath` | OS-specific (`/` on Unix, `\` on Windows) | Real file system paths |

The mistake every beginner makes is using `path` for file system work
because the forward-slash "works on my Mac" — and then the program
breaks on Windows. Or using `filepath` for URL segments and getting
backslashes in a web path.

The mental model: if a path is going to be passed to an `os.*` function
(`os.Open`, `os.Stat`, `os.MkdirAll`, …) use `filepath`. If a path
stays inside `io/fs`, URLs, or any virtual namespace, use `path`.

```go
package main

import (
    "fmt"
    "path"
    "path/filepath"
)

func main() {
    // Building a URL path: use path
    urlPath := path.Join("api", "v2", "users")
    fmt.Println(urlPath) // api/v2/users — always, on every OS

    // Building a file system path: use filepath
    fsPath := filepath.Join("config", "app", "settings.yaml")
    fmt.Println(fsPath)
    // config/app/settings.yaml  on Linux/macOS
    // config\app\settings.yaml  on Windows
}
```

## 2. `filepath.Join` — the right way to build paths

Never concatenate file system paths with `+` or `fmt.Sprintf`.
`filepath.Join` handles the OS separator, cleans the result, and
deals with edge cases you haven't thought of yet.

```go
package main

import (
    "fmt"
    "path/filepath"
)

func main() {
    // These are all equivalent on Linux/macOS:
    a := filepath.Join("home", "alice", ".config", "app")
    b := filepath.Join("/home/alice", ".config/app")
    c := filepath.Join("/home/alice/.config", "app")

    fmt.Println(a) // home/alice/.config/app
    fmt.Println(b) // /home/alice/.config/app
    fmt.Println(c) // /home/alice/.config/app

    // Join cleans automatically:
    d := filepath.Join("foo", "", "bar", ".")
    fmt.Println(d) // foo/bar
}
```

What string concatenation gets wrong:

```go
// BAD — hardcoded slash breaks on Windows
bad := "config" + "/" + "app.yaml"

// BAD — double slash if dir ends with /
dir := "/home/alice/"
bad2 := dir + "file.txt" // "/home/alice//file.txt"

// GOOD
good := filepath.Join(dir, "file.txt") // "/home/alice/file.txt"
```

`Join` cleans the result automatically (see section 6), so you never
get double slashes or trailing separators.

## 3. `filepath.Split` — directory and file name in one call

`filepath.Split(path)` returns `(dir, file)`. The `dir` always ends
with a separator (or is empty). The `file` is the last element with
no separator.

```go
package main

import (
    "fmt"
    "path/filepath"
)

func main() {
    dir, file := filepath.Split("/home/alice/docs/report.pdf")
    fmt.Printf("dir:  %q\n", dir)  // "/home/alice/docs/"
    fmt.Printf("file: %q\n", file) // "report.pdf"

    dir2, file2 := filepath.Split("report.pdf")
    fmt.Printf("dir:  %q\n", dir2)  // ""
    fmt.Printf("file: %q\n", file2) // "report.pdf"

    dir3, file3 := filepath.Split("/etc/")
    fmt.Printf("dir:  %q\n", dir3)  // "/etc/"
    fmt.Printf("file: %q\n", file3) // ""
}
```

`Split` is the inverse of `Join(dir, file)`, with one caveat: the
trailing separator on `dir`. Usually you want either `Dir` or `Base`
individually (next section).

## 4. `filepath.Dir`, `filepath.Base`, `filepath.Ext`

These three cover 90% of the "take a path apart" use cases.

```go
package main

import (
    "fmt"
    "path/filepath"
)

func main() {
    p := "/home/alice/docs/report.pdf"

    fmt.Println(filepath.Dir(p))  // /home/alice/docs
    fmt.Println(filepath.Base(p)) // report.pdf
    fmt.Println(filepath.Ext(p))  // .pdf

    // Base of a directory path:
    fmt.Println(filepath.Base("/home/alice/docs/")) // docs
    fmt.Println(filepath.Dir("/home/alice/docs/"))  // /home/alice

    // Ext returns everything from the last dot:
    fmt.Println(filepath.Ext("archive.tar.gz")) // .gz (not .tar.gz)
    fmt.Println(filepath.Ext("Makefile"))        // "" (no dot)
    fmt.Println(filepath.Ext(".hidden"))          // "" (leading dot only)

    // Stripping the extension:
    name := filepath.Base("report.pdf")
    stem := name[:len(name)-len(filepath.Ext(name))]
    fmt.Println(stem) // report
}
```

`Dir` is equivalent to `Split`'s first return value, minus the
trailing separator. `Base` is equivalent to `Split`'s second return
value. `Ext` is defined as the suffix beginning at the final dot in
the last element; if there's no dot, it returns `""`.

## 5. `filepath.Abs` — make relative paths absolute

`filepath.Abs` joins the path with the process's current working
directory (from `os.Getwd`) and then cleans the result. Call it once
at program startup to canonicalize user-supplied paths.

```go
package main

import (
    "fmt"
    "path/filepath"
)

func main() {
    abs, err := filepath.Abs("config/app.yaml")
    if err != nil {
        panic(err)
    }
    fmt.Println(abs)
    // e.g. /home/alice/myapp/config/app.yaml
    // (depends on process cwd)

    // Already absolute: Abs just cleans it.
    abs2, _ := filepath.Abs("/etc/hosts")
    fmt.Println(abs2) // /etc/hosts

    // Relative with ..:
    abs3, _ := filepath.Abs("../sibling/file.txt")
    fmt.Println(abs3) // e.g. /home/alice/sibling/file.txt
}
```

`filepath.Abs` can fail only if `os.Getwd` fails (unusual: the cwd
was deleted while the program ran). The error is almost always safe
to check once and ignore thereafter if you canonicalize at startup.

## 6. `filepath.Clean` — normalize paths

`filepath.Clean` applies a deterministic set of rewrite rules to
produce the shortest equivalent path:

1. Replace multiple separators with one.
2. Eliminate `.` (current directory) elements.
3. Eliminate each `..` and the non-`..` element that precedes it.
4. Eliminate `..` at the root.

```go
package main

import (
    "fmt"
    "path/filepath"
)

func main() {
    paths := []string{
        "foo//bar",
        "foo/./bar",
        "foo/../bar",
        "/foo/../../../bar",
        "./config/app/../app.yaml",
        ".",
        "",
    }
    for _, p := range paths {
        fmt.Printf("%-30q -> %q\n", p, filepath.Clean(p))
    }
}
```

Output:
```
"foo//bar"                     -> "foo/bar"
"foo/./bar"                    -> "foo/bar"
"foo/../bar"                   -> "bar"
"/foo/../../../bar"            -> "/bar"
"./config/app/../app.yaml"     -> "config/app.yaml"
"."                            -> "."
""                             -> "."
```

`filepath.Join` calls `Clean` internally, so joined paths are always
clean. Call `Clean` explicitly only when you have a path string that
arrived from outside your code (user input, config file, environment
variable).

## 7. `path.Join`, `path.Dir`, `path.Base`, `path.Ext` — for URL paths

The `path` package mirrors `filepath` but always uses `/` and never
touches the OS. Use these when you're working with:
- URL paths in HTTP handlers
- `io/fs` virtual paths (which mandate forward-slash per the spec)
- Template asset paths

```go
package main

import (
    "fmt"
    "path"
)

func main() {
    // URL path construction:
    u := path.Join("api", "v2", "users", "42")
    fmt.Println(u) // api/v2/users/42

    // Extracting URL components:
    fmt.Println(path.Dir("/api/v2/users/42"))  // /api/v2/users
    fmt.Println(path.Base("/api/v2/users/42")) // 42
    fmt.Println(path.Ext("report.2024.pdf"))   // .pdf

    // Clean works the same way:
    fmt.Println(path.Clean("api//v2/./users/../admin")) // api/v2/admin
}
```

An HTTP handler that strips a prefix and then reassembles the URL
path should use `path.Join`, not `filepath.Join` — even on Linux
where they produce the same output. On Windows a server binary
built with `filepath.Join` would put backslashes in URLs.

## 8. `filepath.Separator` and `filepath.ListSeparator`

Two constants tell you the OS at runtime:

```go
package main

import (
    "fmt"
    "path/filepath"
)

func main() {
    fmt.Printf("Separator:     %c\n", filepath.Separator)     // / on Unix, \ on Windows
    fmt.Printf("ListSeparator: %c\n", filepath.ListSeparator) // : on Unix, ; on Windows
}
```

`ListSeparator` is what `$PATH` and `$GOPATH` use between entries.
If you need to split `$PATH`, use `filepath.SplitList` (covered in
middle.md) rather than `strings.Split(os.Getenv("PATH"), ":")`.

Rarely need `Separator` directly — `filepath.Join` handles it for
you. A legitimate use: building a path that you then inspect
character-by-character, or writing a custom splitter.

## 9. Common mistakes at this level

### Mistake 1: using `path` for file system work

```go
// BAD — breaks on Windows
import "path"
p := path.Join(homeDir, ".config", "app.yaml")
os.Open(p) // homeDir may be "C:\Users\alice"; path.Join won't add \

// GOOD
import "path/filepath"
p := filepath.Join(homeDir, ".config", "app.yaml")
```

### Mistake 2: hardcoding the slash separator

```go
// BAD
p := dir + "/" + file

// GOOD
p := filepath.Join(dir, file)
```

Even on Linux this matters — `dir` might end with a `/`, giving
`foo//bar`, which is technically valid but ugly and occasionally
breaks tools.

### Mistake 3: using `filepath` for `io/fs` paths

```go
// BAD — on Windows this produces backslashes, which fs.FS rejects
name := filepath.Join("templates", "index.html")
fs.ReadFile(fsys, name) // fails on Windows

// GOOD — io/fs always uses forward-slash
name := "templates/index.html"
// or:
name = path.Join("templates", "index.html")
```

### Mistake 4: forgetting that `filepath.Ext` includes the dot

```go
ext := filepath.Ext("photo.jpg") // ".jpg", not "jpg"
// Comparison:
if ext == "jpg" { ... }   // never true!
if ext == ".jpg" { ... }  // correct
// or:
if strings.TrimPrefix(ext, ".") == "jpg" { ... }
```

### Mistake 5: not cleaning user-supplied paths

```go
// BAD — user passes "../../etc/passwd"
func openConfig(name string) (*os.File, error) {
    return os.Open(filepath.Join(configDir, name))
}

// GOOD — clean and validate before joining
func openConfig(name string) (*os.File, error) {
    clean := filepath.Clean(name)
    if filepath.IsAbs(clean) || strings.HasPrefix(clean, "..") {
        return nil, fmt.Errorf("invalid config name: %q", name)
    }
    return os.Open(filepath.Join(configDir, clean))
}
```

Full path traversal security is covered in senior.md. At this level:
always `Clean` user input before joining with a base directory.

## 10. Quick-reference table

| Goal | Function |
|------|----------|
| Join OS path segments | `filepath.Join(elem...)` |
| Split into dir + file | `filepath.Split(path)` |
| Directory part | `filepath.Dir(path)` |
| Filename part | `filepath.Base(path)` |
| Extension (with dot) | `filepath.Ext(path)` |
| Make absolute | `filepath.Abs(path)` |
| Clean/normalize | `filepath.Clean(path)` |
| Join URL/fs path segments | `path.Join(elem...)` |
| URL directory part | `path.Dir(path)` |
| URL filename part | `path.Base(path)` |
| URL extension | `path.Ext(path)` |
| OS separator rune | `filepath.Separator` |
| PATH list separator | `filepath.ListSeparator` |

## 11. Putting it together: a config file locator

```go
package main

import (
    "fmt"
    "os"
    "path/filepath"
    "runtime"
)

// configDir returns the platform-appropriate config directory.
func configDir(app string) string {
    switch runtime.GOOS {
    case "windows":
        base := os.Getenv("APPDATA")
        if base == "" {
            base = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Roaming")
        }
        return filepath.Join(base, app)
    case "darwin":
        home, _ := os.UserHomeDir()
        return filepath.Join(home, "Library", "Application Support", app)
    default: // linux and others
        if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
            return filepath.Join(xdg, app)
        }
        home, _ := os.UserHomeDir()
        return filepath.Join(home, ".config", app)
    }
}

func main() {
    dir := configDir("myapp")
    cfg := filepath.Join(dir, "config.toml")
    fmt.Println("Config file:", cfg)

    // Check if it exists
    if _, err := os.Stat(cfg); os.IsNotExist(err) {
        fmt.Println("No config file found; using defaults")
    }
}
```

Notice: every path operation uses `filepath` because these are real
OS paths. The `app` argument uses simple string joining — no path
package needed for a single segment.

## 12. What to read next

- [middle.md](middle.md) — directory traversal with `WalkDir`, glob
  patterns, resolving symlinks, computing relative paths.
- [senior.md](senior.md) — security, symlink loop detection,
  cross-compilation, `filepath.Localize`.
- [`../05-os/`](../05-os/) — the `os` package functions that consume
  the paths you build here.
- [`../14-io-fs/`](../14-io-fs/junior.md) — why `io/fs` uses `path`
  rules, not `filepath` rules.
