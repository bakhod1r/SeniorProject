# Name Mangling & Linking — Middle Level

> **Topic:** [Name Mangling & Linking](README.md)
> **Focus:** Decoding the Itanium C++ ABI mangling by hand, how the linker resolves symbols against archives and shared objects, and the first layer of symbol visibility control.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction

> Focus: **How do you read `_ZN3foo3barEi` without a demangler? How does the linker decide which definition wins when a symbol appears in multiple places? And how do you stop your library from leaking every internal symbol?**

At junior level you learned that C++ mangles a function's signature into its symbol, and that `c++filt` decodes it. At middle level you stop treating mangling as a black box and learn to *read it by hand* — because the **Itanium C++ ABI** mangling scheme is a precise, documented grammar, and being able to decode `_ZN3foo3barEi` → `foo::bar(int)` in your head turns linker errors from terrifying to trivial. (The Itanium ABI is what GCC and Clang use on Linux, macOS, the BSDs — essentially everywhere except Windows/MSVC.)

You also go deeper on the linker itself. A real program doesn't just link a handful of `.o` files; it links against **static archives** (`.a`) and **shared objects** (`.so`/`.dylib`), and the rules for *which definition is pulled in and which one wins* are subtle. An archive is pulled in member-by-member, only when needed. A shared object contributes symbols at *load time*, not at *link time*. Getting these wrong produces the confusing class of bugs where "it links but crashes," or "it links in one order but not another."

Finally, you meet **symbol visibility** — the difference between a symbol that's part of your library's public contract and one that's an internal implementation detail. By default, on most Unix toolchains, *every non-static symbol is exported*, which bloats your dynamic symbol table, slows load time, and freezes internal functions into your ABI. `-fvisibility=hidden` plus `__attribute__((visibility("default")))` lets you export only what you mean to. This is the first real "designing an ABI surface" skill.

> 🎓 **Why this matters at middle level:** The jump from "I can fix a missing-symbol error" to "I can reason about *why* this symbol is or isn't visible, which definition the linker chose, and what that means for my library's interface" is the jump from someone who *uses* the toolchain to someone who *understands* it. Decoding mangled names by sight and reading `nm`/`readelf` output fluently is a marker of a mid-to-senior systems engineer.

This page covers Itanium mangling decoding, archive vs shared-object resolution, and basic visibility. `senior.md` adds MSVC and Rust mangling, weak/COMDAT/vague linkage, and ABI-mismatch debugging. `professional.md` covers symbol versioning, export-map design, and load-time cost at scale.

---

## Prerequisites

- **Required:** Everything in `junior.md` — symbols, the compile-then-link split, `extern "C"`, `nm`, `c++filt`, undefined/multiple-definition errors.
- **Required:** Comfort building C++ with `g++`/`clang++`, including `-c`, `-shared`, `-fPIC`, and linking against `-l` libraries.
- **Required:** Knowing the difference between a static library (`.a`) and a shared library (`.so`).
- **Helpful:** Having run `readelf` or `objdump` at least once.
- **Helpful:** Familiarity with C++ namespaces, overloading, `const` member functions, and references.

You do **not** need:

- The MSVC or Rust mangling schemes (that's `senior.md`).
- Weak symbols, COMDAT folding, or template-instantiation linkage details (that's `senior.md`).
- Symbol versioning (`GLIBC_2.x`) or version scripts (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Itanium C++ ABI** | The C++ ABI (including the mangling scheme) used by GCC, Clang, and most non-Windows toolchains. Named for the Itanium architecture it was first specified on; now near-universal off Windows. |
| **Mangling grammar** | The formal, documented rules that turn a C++ entity into a symbol string. Deterministic and reversible. |
| **`_Z` prefix** | The marker that begins every Itanium-mangled C++ symbol. Tells the demangler "this is mangled." |
| **Nested name** (`N...E`) | The Itanium encoding for a qualified name like `foo::bar`: `N` … `E` brackets the components. |
| **Substitution** (`S_`, `S0_`, …) | A compression mechanism: repeated name components are encoded as back-references to save space. |
| **Static archive** (`.a`) | A bundle of `.o` files. The linker pulls in *only the members that satisfy an undefined symbol*. |
| **Shared object** (`.so`, `.dylib`) | A library linked at *load time*. Contributes symbols to the dynamic symbol table, not copied into the executable. |
| **Symbol visibility** | Whether a symbol is exported from a shared object (`default`) or kept internal (`hidden`/`internal`). |
| **`-fvisibility=hidden`** | A compiler flag making all symbols hidden by default; you opt specific ones back in. |
| **`__attribute__((visibility("default")))`** | The GCC/Clang attribute that marks a symbol as exported. |
| **Dynamic symbol table** (`.dynsym`) | The list of symbols a shared object exports/imports at load time. Inspect with `nm -D` or `readelf --dyn-syms`. |
| **`readelf`** | A tool to inspect ELF object/binary structure, including symbol tables and relocations. |
| **PIC** (Position-Independent Code) | Code (`-fPIC`) that works at any load address — required for shared objects. |
| **Local vs global symbol** | A `static`/anonymous-namespace symbol is *local* (invisible to the linker across files); a normal one is *global*. |

---

## Core Concepts

### 1. The Itanium mangling grammar, decoded by hand

Every Itanium-mangled name starts with `_Z`. After that, the scheme is a small grammar. Learn these building blocks and you can decode most real symbols:

```text
_Z   <- "this is a mangled C++ name"

Names:
  3foo            <length><identifier>   →  foo  (3 chars)
  N ... E         nested (qualified) name: foo::bar
  St              std::

Type codes (parameters):
  i   int            l   long       x   long long    s   short
  c   char           b   bool       f   float        d   double
  v   void           Pi  pointer to int (P = pointer)
  Ri  reference to int (R = reference)
  Ki  const int      (K = const qualifier)
```

Now decode the canonical example, `_ZN3foo3barEi`:

```text
_Z          mangled C++ name
N           start of nested name
  3foo      "foo"   (3 letters)
  3bar      "bar"   (3 letters)
E           end of nested name  →  foo::bar
i           one parameter: int
                                  →  foo::bar(int)
```

So `_ZN3foo3barEi` = **`foo::bar(int)`**. Verify it:

```text
$ echo _ZN3foo3barEi | c++filt
foo::bar(int)
```

A few more, worked:

```text
_Z3addii            add  + i + i              →  add(int, int)
_ZN5audio7processEv N 5audio 7process E + v    →  audio::process()
_ZNK6Vector4sizeEv  NK 6Vector 4size E + v     →  Vector::size() const   (K after N = const member)
_Z3maxIiET_S0_S0_   max + I i E (template <int>) →  int max<int>(int, int)  (templates get hairy)
```

The pattern: **`N…E` wraps a qualified name; the letters after it are the parameter types; `K`/`R`/`P` are qualifiers and indirection.** You won't decode every template by sight — those get genuinely complex — but plain functions and methods become readable fast.

### 2. Why `const` and references change the symbol

Because the symbol *is* the signature, anything the overload-resolution rules consider part of the signature gets encoded:

- `void f(int)` → `_Z1fi`
- `void f(const int&)` → `_Z1fRKi` (`R` ref, `K` const)
- `void f(int*)` → `_Z1fPi` (`P` pointer)
- A `const` member function gets `K` right after the `N`.

This is *why* changing a parameter from `int` to `long`, or adding `const`, silently produces a *different symbol* — and why a caller compiled against the old header gets `undefined reference` when the definition's signature changed. The symbol mismatch is the signature mismatch, made mechanical.

### 3. Substitutions: the compression you'll see in real output

Real mangled names contain `S_`, `S0_`, `St`, etc. These are **substitutions** — back-references to previously-seen name components, so a long type isn't repeated. `St` is the special abbreviation for `std::`. You don't need to fully decode substitutions to read a symbol (let `c++filt` expand them), but recognize that `S...` is *compression*, not a separate function — it's why `std::string` appears as cryptic `NSt7__cxx1112basic_string...`.

### 4. Static archives are pulled in member-by-member

A `.a` file is just a bundle of `.o` files with an index. When the linker processes an archive, it does **not** include the whole thing. It includes *only the member object files that define a currently-undefined symbol*. This has two big consequences:

- **Link order matters (classic `ld`).** The linker walks the command line left to right. When it reaches an archive, it only pulls members satisfying symbols that are *undefined so far*. So a library must appear *after* the object that needs it: `gcc main.o -lfoo`, not `gcc -lfoo main.o`.
- **Unused members are dropped.** Code in an archive that nothing references doesn't bloat your binary — which is one reason static linking can produce a *smaller* binary than you'd expect.

### 5. Shared objects resolve at load time

A shared object (`.so`/`.dylib`) is different. At *link* time, the linker only checks that the symbol *exists* in the `.so` and records a dependency. The actual binding happens at *load* time (or lazily on first call) by the dynamic loader. Consequences:

- The symbol's code is **not copied** into your executable; it's shared in memory across processes.
- The whole `.so` is loaded if you use *any* symbol from it — there's no member-by-member pull.
- A symbol that exists at link time but is *missing or renamed at runtime* gives a *runtime* error (`symbol not found`), not a link error. This is the source of "compiled fine, crashes on the user's machine with a different library version." (The deep runtime-loading mechanics are a topic of their own; here we just note the link-time vs load-time split.)

### 6. Visibility: not everything should be exported

By default on most Unix toolchains, **every global (non-`static`) symbol in a shared object is exported** into the dynamic symbol table. That is almost always wrong for a real library:

- It **bloats `.dynsym`**, slowing the dynamic loader (more symbols to hash and relocate at load time).
- It **freezes internals into your ABI** — anyone can link against `internal_helper`, so you can't change it without breaking them.
- It risks **symbol collisions** with other libraries that happen to use the same internal name.

The fix is to compile with `-fvisibility=hidden` (everything internal by default) and explicitly mark the public API:

```cpp
#define API __attribute__((visibility("default")))

API int  lib_public_function(void);   // exported
       int internal_helper(void);     // hidden (not exported)
```

Now only `lib_public_function` appears in `.dynsym`. This is the first step toward *designing* an ABI surface rather than leaking one.

### 7. `static` and anonymous namespaces make symbols local

Independently of visibility, `static` at file scope (C and C++) and the **anonymous namespace** (C++) give a symbol *internal linkage* — it's *local* to its object file, invisible to the linker for cross-file resolution:

```cpp
static int helper(int x) { ... }   // C-style internal linkage
namespace { int helper2(int x); }  // C++ anonymous-namespace internal linkage
```

Local symbols (`nm` shows them lowercase: `t`, `d`, `b`) never participate in cross-object resolution and never collide. Use them for everything that doesn't need to be seen outside the file.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Mangling grammar** | A standardized shipping label: country code, postal code, street, name — each field in a fixed slot you can parse by eye. |
| **`N…E` nested name** | Parentheses around a full bureaucratic title: "(Department of (Audio), function (process))." |
| **Substitution (`S_`)** | "Same as above" / "ditto" marks on a form to avoid rewriting the same long address. |
| **Static archive** | A box of spare parts; the mechanic takes *only* the parts the repair needs, leaves the rest. |
| **Shared object** | A utility line (water, power) the building taps at occupancy time, shared with neighbors — not copied into each apartment. |
| **Symbol visibility** | The difference between a company's published phone directory (default) and its internal extensions (hidden). |
| **`static` / anonymous namespace** | A nickname used only inside one room — meaningless and invisible to the rest of the building. |
| **Link-time vs load-time** | Checking a recipe lists "flour" (link time) versus actually having flour in the pantry when you cook (load time). |

---

## Mental Models

### The "Mangled Name Is a Sentence" Model

Read a mangled name left to right like a sentence with grammar: `_Z` is the opening quote, `N…E` is a clause naming the function's full path, and the trailing letters are the argument list. Once you've parsed `_ZN3foo3barEi` once by hand, the structure clicks and you stop reaching for `c++filt` on simple names. The grammar is small; the scary part is just unfamiliarity.

### The "Pull on Demand" Model for Archives

Picture the linker holding a shopping list of undefined symbols, walking past shelves (object files and archives) left to right. At each archive it checks: "does this shelf have anything on my list?" If yes, it takes that member (which may add *new* items to the list). If no, it walks past. This is exactly why a library placed *before* the code that needs it is walked past with an empty list — and why link order bites you.

### The "Exported vs Internal" Model for Visibility

Think of your shared library as a building with a front desk. **Exported (default-visibility)** symbols are the people the front desk will page for outside visitors. **Hidden** symbols are staff who exist and work but whom outsiders can't summon. By default the front desk pages *everyone* (every global symbol exported) — chaotic and slow. `-fvisibility=hidden` flips it: nobody is pageable unless you put them on the public list. You design the public list; you don't leak it.

---

## Code Examples

### Decoding by hand, then checking

```text
$ echo _ZN3foo3barEi | c++filt
foo::bar(int)

$ echo _ZNK6Vector4sizeEv | c++filt
Vector::size() const

$ echo _Z3addii | c++filt
add(int, int)

$ echo _Z1fRKi | c++filt
f(int const&)
```

Practice: cover the right column, decode the left by hand using the type-code table, then reveal.

### Generating real symbols and inspecting them

```cpp
// lib.cpp
namespace net {
    class Socket {
    public:
        int  send(const char* data, unsigned len);
        void close();
    };
    int  Socket::send(const char* d, unsigned l) { return 0; }
    void Socket::close() {}
}
```

```text
$ g++ -c lib.cpp -o lib.o
$ nm lib.o
0000000000000000 T _ZN3net6Socket4sendEPKcj
0000000000000020 T _ZN3net6Socket5closeEv

$ nm -C lib.o          # -C demangles inline
0000000000000000 T net::Socket::send(char const*, unsigned int)
0000000000000020 T net::Socket::close()
```

Decode `_ZN3net6Socket4sendEPKcj` by hand: `N` `3net` `6Socket` `4send` `E` `PKc` (pointer-to-const-char) `j` (unsigned int) → `net::Socket::send(const char*, unsigned int)`. It matches.

### Archive link order, demonstrated

```text
$ ar rcs libmath.a math.o          # build a static archive

# WRONG order — library before the object that needs it (classic ld):
$ gcc -L. -lmath main.o -o app
main.o: undefined reference to `add'

# RIGHT order — object first, library after:
$ gcc main.o -L. -lmath -o app
$ ./app
5
```

When the linker reached `-lmath` in the wrong-order case, *nothing was undefined yet* (it hadn't seen `main.o`), so it pulled in no members. Then `main.o` introduced an undefined `add` that was never satisfied.

### Visibility: before and after

```cpp
// shared.cpp
int public_api(int x)    { return x * 2; }
int internal_helper(int x){ return x + 1; }
```

```text
# Default: BOTH symbols exported
$ g++ -shared -fPIC shared.cpp -o libshared.so
$ nm -D libshared.so | c++filt
0000000000001119 T internal_helper(int)
0000000000001109 T public_api(int)
```

Now mark only the public API and hide the rest:

```cpp
// shared2.cpp
#define API __attribute__((visibility("default")))
API int public_api(int x)     { return x * 2; }
    int internal_helper(int x){ return x + 1; }
```

```text
$ g++ -shared -fPIC -fvisibility=hidden shared2.cpp -o libshared2.so
$ nm -D libshared2.so | c++filt
0000000000001109 T public_api(int)
# internal_helper is gone from .dynsym — hidden, not exported.
```

The dynamic symbol table shrank to exactly the intended interface.

### Local symbols never collide

```cpp
// a.cpp
static int helper() { return 1; }   // local to a.o
int from_a() { return helper(); }
```

```cpp
// b.cpp
static int helper() { return 2; }   // local to b.o — same name, no clash
int from_b() { return helper(); }
```

```text
$ g++ -c a.cpp b.cpp
$ nm a.o b.o
a.o:
0000000000000000 t _ZL6helperv     ← lowercase 't' = local symbol
0000000000000010 T _Z6from_av
b.o:
0000000000000000 t _ZL6helperv     ← same name, but local: no conflict
0000000000000010 T _Z6from_bv
```

Two `helper`s, no multiple-definition error, because internal linkage keeps each one private to its object file. (Note `_ZL` — the `L` marks internal linkage in the mangling.)

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Readable mangling grammar** | A deterministic scheme you can decode by hand and that round-trips perfectly. | Templates and `std::` types produce long, substitution-heavy names that are hard to read raw. |
| **Archive member pulling** | Only needed code is linked → smaller binaries; unused library code is free. | Link order sensitivity (classic `ld`) is a recurring source of confusing errors. |
| **Shared-object load-time binding** | Code shared across processes, smaller executables, library can be patched without relinking apps. | Link-time success doesn't guarantee runtime success; version drift causes "symbol not found" at startup. |
| **Visibility control** | Smaller ABI surface → faster load, freedom to change internals, fewer collisions. | Requires discipline and per-symbol annotation; getting it wrong hides a symbol you needed. |

---

## Use Cases

- **Decoding a build or crash log by sight** when you don't have `c++filt` handy or want to skim quickly.
- **Diagnosing `undefined reference` after a signature change** — the mangled name in the error *is* the expected signature; compare it to what's actually defined with `nm -C`.
- **Fixing link-order failures** against static libraries.
- **Designing a shared library's public interface** by hiding internals with visibility flags — smaller, faster-loading, more maintainable libraries.
- **Avoiding symbol collisions** between two libraries by keeping internals `static`/hidden.
- **Understanding why a link succeeds but the program fails at startup** with a missing dynamic symbol.

---

## Coding Patterns

### Pattern 1: Decode-then-verify

When you see a mangled symbol in an error, decode the *structure* by eye to understand the shape (function? method? what parameters?), then confirm with `c++filt`. Over time the eye-decode becomes instant for the common cases.

### Pattern 2: Export-macro for the public API

```cpp
#if defined(_WIN32)
#  define API __declspec(dllexport)
#else
#  define API __attribute__((visibility("default")))
#endif

API int  lib_init(void);
API void lib_shutdown(void);
```

A single `API` macro marks every public symbol, compiled with `-fvisibility=hidden`. Everything else is hidden automatically. (The Windows half previews `senior.md`.)

### Pattern 3: Internal linkage by default for file-local helpers

```cpp
namespace {                 // anonymous namespace: internal linkage
    int compute_checksum(...);
    struct ParseState { ... };
}
```

Put every helper that doesn't need cross-file visibility in an anonymous namespace (C++) or mark it `static` (C). Smaller global symbol table, zero collision risk.

### Pattern 4: Libraries after objects on the link line

```text
$(CC) $(OBJECTS) $(LDLIBS) -o $@      # objects first, -l... last
```

Make it a habit in every Makefile/build script: objects and their consumers come first, the `-l` libraries that *satisfy* them come last.

---

## Best Practices

- **Learn the type-code table** (`i l c b f d v`, `P` pointer, `R` ref, `K` const, `N…E` nested). It pays for itself the first time you read a link error without tooling.
- **Always prefer `nm -C` / `nm --demangle`** for inspection, but understand the raw form so the demangled output makes sense.
- **Compile shared libraries with `-fvisibility=hidden`** and explicitly export only the public API. Treat every exported symbol as a permanent promise.
- **Mark file-local helpers `static` or put them in an anonymous namespace.** Smaller symbol tables, no collisions, faster links.
- **Put libraries after the objects that use them** on the link command line.
- **Remember the link-time/load-time gap for shared objects.** A clean link is necessary but not sufficient; test against the actual runtime library versions.
- **Use `readelf --dyn-syms` (or `nm -D`) to audit exactly what your `.so` exports.** Surprises in that list are bugs waiting to bite.

---

## Edge Cases & Pitfalls

- **A signature change makes the symbol change, so a stale object can't link.** If you change `f(int)` to `f(long)` in the definition but a caller still has the old header, you get `undefined reference to f(int)` — the symbols `_Z1fi` and `_Z1fl` differ. Rebuild the caller.
- **Link order with archives.** A library before its consumer pulls in nothing. Objects first, `-l` after.
- **Visibility hides a symbol you needed.** Compile with `-fvisibility=hidden` but forget to mark a public function `default` → callers get `undefined symbol` at load time. Audit `.dynsym` after enabling hidden visibility.
- **`static` in a header.** A `static` function defined in a header gives *each* including translation unit its *own private copy* — usually not what you want, and it bloats the binary. Headers should declare, not define (except `inline`/templates).
- **Substitutions make symbols longer than the source.** `std::string` parameters explode into `NSt7__cxx11...` — don't panic; that's compression artifacts plus the real `std` type name, not a bug.
- **Demangling the wrong scheme.** `c++filt` decodes Itanium by default. Feed it an MSVC-mangled name and it returns garbage or the input unchanged. Know which compiler produced the symbol (that's `senior.md`).
- **`nm` vs `nm -D` confusion.** Plain `nm` reads the *static* symbol table (often stripped in shipping `.so`s); `nm -D` reads the *dynamic* one. If `nm` shows "no symbols," try `nm -D`.

---

## Test Yourself

1. Decode `_ZN5audio7processEv` by hand using the type-code table. What namespace, function, and parameters? Confirm with `c++filt`.
2. Decode `_Z3addRKiS0_` by hand. (Hint: `R`, `K`, and `S0_` is a substitution.) Confirm with `c++filt`.
3. Compile a class with two member functions and run `nm -C`. Identify which part of each mangled name is the class, which is the method, and which is the parameter list.
4. Build a static archive `libfoo.a` and link it *before* and *after* the object that uses it. Which order fails, and exactly why does the linker pull in no members in the failing case?
5. Compile a shared library with two functions, once with default visibility and once with `-fvisibility=hidden` (marking only one `default`). Compare `nm -D` output. Which symbol disappeared and what does that mean for callers?
6. Put two different `static helper()` functions in two files and link them. Why is there no multiple-definition error? What does the lowercase `t` in `nm` tell you?
7. Take a parameter from `int` to `const std::string&` and look at how the mangled name changes with `nm` (not `-C`). Why is the new name so much longer?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│              ITANIUM MANGLING + LINKING (MIDDLE)                 │
├──────────────────────────────────────────────────────────────────┤
│ Every mangled C++ symbol starts with  _Z                         │
│   <n><name>   e.g. 3foo = "foo"                                  │
│   N ... E     nested/qualified name: N3foo3barE = foo::bar       │
│   St          std::                                              │
│   S_ S0_ ...  substitutions (back-references / "ditto")          │
├──────────────────────────────────────────────────────────────────┤
│ Type codes (parameter list):                                     │
│   v void  b bool  c char  i int  l long  x longlong              │
│   f float d double                                               │
│   P ptr   R ref   K const   (prefix the type: PKc = const char*) │
├──────────────────────────────────────────────────────────────────┤
│ Worked: _ZN3foo3barEi = foo::bar(int)                            │
│         _ZNK6Vector4sizeEv = Vector::size() const  (K=const mbr) │
├──────────────────────────────────────────────────────────────────┤
│ Static archive (.a): pulls ONLY members satisfying current       │
│   undefineds. → put libraries AFTER objects on the link line.    │
│ Shared object (.so): binds at LOAD time. Link-time OK does not   │
│   guarantee runtime OK (version drift → "symbol not found").     │
├──────────────────────────────────────────────────────────────────┤
│ Visibility:                                                      │
│   default: every global symbol exported (bad for libraries)      │
│   -fvisibility=hidden + __attribute__((visibility("default")))   │
│   static / anonymous namespace → LOCAL (lowercase in nm)         │
├──────────────────────────────────────────────────────────────────┤
│ Inspect: nm -C (demangle)  nm -D (dynamic syms)                  │
│          readelf --dyn-syms   objdump -t                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- The **Itanium C++ ABI** mangling is a small, deterministic grammar you can decode by hand: `_Z` opens it, `N…E` brackets a qualified name, length-prefixed identifiers name the parts, and trailing type codes (`i`, `d`, `P`, `R`, `K`, …) encode the parameter list.
- Because the symbol *is* the signature, `const`, references, and pointers all change the symbol — which is exactly why a signature change breaks a stale caller's link.
- **Substitutions** (`S_`, `St`, …) are compression of repeated name components; let `c++filt` expand them.
- A **static archive** (`.a`) is pulled in **member-by-member**, only to satisfy currently-undefined symbols — so libraries must come *after* their consumers on the link line.
- A **shared object** (`.so`) binds at **load time**, not link time; a clean link does not guarantee the runtime library will have the symbol, which is the root of version-drift startup failures.
- **Symbol visibility** controls the ABI surface: by default every global symbol is exported (bloated, fragile), so compile libraries with `-fvisibility=hidden` and explicitly mark the public API `default`.
- **`static` and anonymous namespaces** give *internal linkage* — local symbols that never collide and never participate in cross-file resolution.
- Fluency with **`nm -C`**, **`nm -D`**, and **`readelf`** turns symbol problems from guesswork into reading.

---

## Further Reading

- *Itanium C++ ABI* — the official mangling specification. https://itanium-cxx-abi.github.io/cxx-abi/abi.html#mangling — surprisingly readable; the mangling section is a reference you'll return to.
- *Computer Systems: A Programmer's Perspective* (CSAPP) — Chapter 7 on linking, now revisited with archives and shared objects in mind.
- *How To Write Shared Libraries* — Ulrich Drepper. The definitive paper on visibility, symbol tables, and load-time cost on ELF systems.
- *GCC Visibility wiki* — https://gcc.gnu.org/wiki/Visibility — practical recipes for `-fvisibility=hidden` and export macros.
- *`readelf` and `nm` man pages* — especially `nm -C`, `nm -D`, `readelf --dyn-syms`.
- *Linkers and Loaders* — John R. Levine, chapters on archives and shared libraries.
