# The Linker — Middle

At the junior tier you stripped a binary and stamped a version. Now we go one
level deeper: **how** the linker decides what to keep, **why** reflection makes
binaries fat, **what** the sections of a Go binary are, and the build modes /
flags you'll meet in real projects.

---

## 1. Symbol resolution — the intuition

Every function, method, global variable, and string constant the compiler emits
becomes a **symbol** with a name like `fmt.Println`, `runtime.mallocgc`, or
`main.main`. An object file has two lists:

- **Defined symbols** — "I provide the code/data for this name."
- **Referenced (undefined) symbols** — "I need this name; someone else
  defines it."

The linker walks every object file and archive, builds one global table, and
**resolves** each reference to a definition. If a reference has no definition,
you get the classic:

```
undefined: github.com/foo/bar.MissingFunc
```

(In pure Go this almost never happens — the compiler already checked. It shows
up mostly with cgo, assembly stubs, or `//go:linkname` tricks.)

Resolution also handles **ABI wrappers**. Go has two calling ABIs: `ABI0`
(stack-based, used by assembly and cgo) and `ABIInternal` (register-based, used
by normal Go). When a symbol is needed in the *other* ABI, the linker generates
a small **wrapper** symbol to bridge them. You'll see names like
`fmt.Println.abiinternal` in `nm` output — that's this machinery.

---

## 2. Dead-code elimination — keep only what's reachable

A Go program imports `fmt`, which imports `os`, `reflect`, `strconv`, ... If the
linker kept *everything* in every imported package, binaries would be enormous.
Instead `cmd/link` runs **dead-code elimination**: starting from the entry
point, it marks every symbol **reachable** and discards the rest.

The pass lives in
[`src/cmd/link/internal/ld/deadcode.go`](https://github.com/golang/go/blob/master/src/cmd/link/internal/ld/deadcode.go).
The mental model is a graph reachability (mark-and-sweep):

1. **Roots**: the runtime entry, `main.main`, `main.init`, exported symbols for
   shared libs, and a handful of runtime-required symbols.
2. **Mark**: follow every relocation (call, address-of) from a live symbol to
   the symbols it references; mark those live; repeat until nothing new is
   marked.
3. **Sweep**: anything unmarked is never written to the output.

So if you write a helper function and never call it (and it isn't reachable via
any reachable path), it simply **does not exist** in the binary. This is also
why `go tool nm` won't show a function you "know you wrote" — it got eliminated.

### Methods are special

A plain function is easy: either something calls it or nothing does. **Methods**
are harder because they can be called *indirectly* through an **interface**:

```go
var w io.Writer = os.Stdout
w.Write(p)   // which concrete Write? linker can't always prove it
```

The linker tracks which **interfaces** are used and which **concrete types** are
ever converted to an interface. If type `T` is assigned to *any* interface and
the program uses interfaces with a `Write` method, then `T.Write` must be kept
alive — the linker can't prove the indirect call won't reach it. Go's deadcode
pass is fairly precise here: it correlates the **method set** of types that
"escape" into interfaces with the **method names** actually called through
interfaces.

---

## 3. Why reflection bloats binaries

`reflect.Value.Call`, `reflect.Value.MethodByName`, and friends can invoke a
method **by name at runtime**. The linker cannot see, statically, which method a
reflective call will hit. To stay correct, the moment the program can reflect on
methods, the linker becomes **conservative**: it keeps the **full method set**
of every type that might be reflected upon, plus the type metadata
(`runtime._type`, names, field tags) needed to do reflection.

Concretely:

- Using `reflect.Value.Method`/`MethodByName` flips a flag (the linker sees the
  `reflect.Value.Method` symbol become reachable) that **prevents method
  pruning**, so methods that *would* have been dead-code-eliminated are kept.
- Type names, struct field names, and tags are kept as data so `reflect` can
  read them. Strip-friendly programs that avoid reflection have far less of
  this.

Practical consequence: a JSON-heavy service using `encoding/json` (which uses
reflection) carries more type metadata than a program that hand-writes its
encoders. You'll see this in the size analysis later.

---

## 4. The sections of a Go binary

The linker lays surviving symbols into **sections**. On Linux these are ELF
sections; the names are familiar from C plus Go-specific ones:

| Section | Holds |
| --- | --- |
| `.text` | executable machine code (functions) |
| `.rodata` | read-only data: string constants, jump tables, RO globals |
| `.data` | initialized writable globals |
| `.bss` | zero-initialized globals (takes no file space, just a size) |
| `.noptrdata` / `.noptrbss` | Go split: data/bss with **no pointers** (GC skips scanning) |
| `.gopclntab` | **PC→line table**: maps program counters to func names + source lines (panics, `runtime.Callers`, profilers) |
| `.go.buildinfo` | embedded build info: module path, deps, build settings (read by `go version -m`) |
| `.typelink` / `.itablink` | tables of type and itab pointers (interface dispatch, reflection) |
| `.symtab` / `.strtab` | symbol table (removed by `-s`) |
| `.debug_*` | DWARF debug info (removed by `-w`) |

You can list them:

```bash
go build -o app ./...
go tool objdump -s '^main\.' app | head     # disassemble main.* funcs
# Or use the platform tool:
readelf -S app        # Linux ELF sections
otool -l app          # macOS Mach-O load commands / sections
```

`.gopclntab` is the one to remember: it's why a Go panic shows function names
and line numbers **even after `-s -w`**. DWARF (`.debug_*`) is for debuggers and
*is* removed by `-w`; the pclntab is separate and stays.

---

## 5. `-buildmode` overview

`go build -buildmode=<mode>` changes what the linker produces:

| `-buildmode` | Output | Use case |
| --- | --- | --- |
| `exe` (default) | normal executable | apps |
| `pie` | **position-independent executable** | ASLR hardening; some distros default to this |
| `c-archive` | `.a` + header | link Go into a C program statically |
| `c-shared` | `.so`/`.dll` + header | call Go from C/Python/etc. as a shared lib |
| `shared` | Go shared library | share Go std across binaries (rare) |
| `plugin` | `.so` loadable via `plugin` package | runtime-loaded Go plugins (Linux/macOS) |
| `archive` | `.a` | package archive |

`pie`, `c-shared`, `c-archive`, `shared`, and `plugin` typically force or
involve **external linking** and/or position-independent code. Plain `exe` on
pure Go stays internal.

---

## 6. `-trimpath` — strip absolute paths

By default the binary embeds **absolute file paths** from the build machine
(e.g. `/Users/you/go/src/...`) inside `.gopclntab` and DWARF, so panics show
real paths. That:

- leaks your username / directory layout, and
- makes builds **non-reproducible** (two machines produce different bytes).

`-trimpath` rewrites those to module-relative paths:

```bash
go build -trimpath -o app ./...
```

After this, a panic shows `github.com/you/app/handler.go:42` instead of
`/Users/you/code/.../handler.go:42`. It's a standard part of release builds and
a prerequisite for reproducible builds (covered in the professional tier).

---

## 7. Reading symbols with `nm`

`go tool nm` lists the symbols in a binary or archive: address, type code, name.

```bash
go tool nm app | head
#   401000 T main.main
#   401120 T fmt.Println
#   ...
```

Type codes (subset): `T`/`t` text (code, upper = exported-ish/global),
`D`/`d` data, `B`/`b` bss, `R`/`r` rodata, `U` undefined.

Find the **biggest** contributors by symbol — a quick bloat probe. `nm` doesn't
print sizes, but you can sort by address to eyeball clustering, or use
`go tool nm -size` (size column) where supported, then sort:

```bash
go tool nm -size app | sort -k2 -n -r | head -20
```

This surfaces which functions/types dominate `.text` and `.rodata` — your first
clue when a binary is unexpectedly large.

---

## 8. Summary

- The linker builds a global **symbol table**, resolves references, and inserts
  **ABI wrappers** where calling conventions differ.
- **Dead-code elimination** (`deadcode.go`) keeps only symbols **reachable**
  from roots; unused funcs/methods vanish from the binary.
- **Reflection** forces the linker to be conservative — it keeps full method
  sets and type metadata, which inflates size.
- A Go binary has standard sections (`.text`, `.rodata`, `.data`, `.bss`) plus
  Go-specific ones (`.gopclntab`, `.go.buildinfo`, type/itab tables).
- `-buildmode` selects the output kind; `-trimpath` strips absolute paths for
  reproducibility; `go tool nm` lets you inspect and size-rank symbols.

---

## Further reading

- [`deadcode.go` in `cmd/link/internal/ld`](https://github.com/golang/go/blob/master/src/cmd/link/internal/ld/deadcode.go)
- [Go ABI internals (register-based ABIInternal)](https://github.com/golang/go/blob/master/src/cmd/compile/abi-internal.md)
- [`go tool nm`](https://pkg.go.dev/cmd/nm)
- [`go build -trimpath` and reproducible builds](https://go.dev/ref/mod#build-commands)
- [`-buildmode` documentation (`go help buildmode`)](https://pkg.go.dev/cmd/go#hdr-Build_modes)
