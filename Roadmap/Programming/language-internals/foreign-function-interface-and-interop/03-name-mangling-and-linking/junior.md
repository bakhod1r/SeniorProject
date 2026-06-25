# Name Mangling & Linking — Junior Level

> **Topic:** [Name Mangling & Linking](README.md)
> **Focus:** Why your function has a weird name inside the binary, and how the linker finds it when one file calls another.

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

> Focus: **What is a "symbol" in a compiled program, why does C++ turn `add(int, int)` into something like `_Z3addii`, and how does the linker turn a pile of `.o` files into one working program?**

When you split a program across files, one file *calls* a function that lives in *another* file. The compiler that builds `caller.c` has never seen the body of `add` — it only knows there's *something* named `add` it must jump to. So it leaves a blank: "here, call whatever `add` is; the linker will fill in the address." When you build `math.c`, the compiler emits the actual machine code for `add` and records "I define a thing called `add` at this location." The **linker** is the program that later matches every blank ("I need `add`") against every definition ("I have `add`") and patches in the real addresses.

The names the linker matches on are called **symbols**. In C, the symbol for `add` is, near enough, just `add`. Simple. But in C++ you can have *three different functions all spelled* `add` — `add(int, int)`, `add(double, double)`, and `Vector::add(const Vector&)`. They are different functions and need different machine code, so they need *different linker symbols*. The compiler solves this by **mangling**: it encodes the full signature — name, namespace, parameter types — into a single ugly string. `add(int, int)` becomes `_Z3addii`. That mangling is the bridge between "what you wrote in source" and "what the linker sees."

This page is the ground floor: what a symbol is, what the linker actually does, why C++ mangles and C does not, and how to read those scary `undefined reference to ...` errors. The reason this matters even at junior level is that **the two most common link errors a beginner hits — "undefined reference" and "multiple definition" — are both symbol problems**, and once you see linking as "matching names," they stop being magic.

> 🎓 **Why this matters for a junior:** You will spend real hours fighting linker errors. People who don't understand symbols stab randomly at flags and `#include`s. People who *do* understand symbols run `nm` on the object file, see the symbol is missing or misspelled, and fix it in one minute. Learning to think in symbols is the single highest-leverage build-debugging skill there is.

This page covers C and C++ at a basic level. `middle.md` decodes the full Itanium mangling grammar and visibility; `senior.md` covers MSVC and Rust mangling, weak/COMDAT symbols, and ABI mismatch; `professional.md` covers symbol versioning, export control at scale, and load-time cost.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to compile and run a small program in C or C++ (`gcc`, `g++`, or `clang`).
- **Required:** The idea of splitting a program into multiple `.c`/`.cpp` files plus header files.
- **Required:** What a function declaration vs a function definition is (a header *declares*; a `.c` file *defines*).
- **Helpful:** A vague sense that a program becomes machine code in a file (an "executable" or "binary").
- **Helpful:** Having seen an `undefined reference` error at least once and been confused by it.

You do **not** need to know:

- The full Itanium C++ ABI mangling grammar (that's `middle.md`).
- MSVC or Rust mangling, weak symbols, or COMDAT folding (that's `senior.md`).
- Symbol versioning or dynamic loading internals (that's `professional.md`).
- Assembly. We'll show a few symbol names, never assembly.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Symbol** | A name in a compiled object that the linker can refer to — usually a function or a global variable. The "label" on a piece of code or data. |
| **Object file** (`.o`, `.obj`) | The compiler's output for one source file: machine code plus a list of symbols it *defines* and symbols it *needs*. |
| **Defined symbol** | A symbol this object file *provides* — it has the actual code/data for it. |
| **Undefined symbol** | A symbol this object file *uses* but does not provide; the linker must find it elsewhere. |
| **Linker** | The tool (`ld`, `lld`, MSVC `link.exe`) that combines object files and libraries, resolving every undefined symbol against a definition. |
| **Linking** | The whole process of stitching object files into one executable or library and patching in addresses. |
| **Name mangling** | Encoding extra information (parameter types, namespace, class) into a symbol name so distinct functions get distinct symbols. C++ does this; C does not. |
| **Demangling** | Decoding a mangled symbol back to a human-readable signature (`c++filt` does this). |
| **Relocation** | A "fill this address in later" note left in an object file; the linker resolves it. |
| **`extern "C"`** | A C++ instruction: "compile this with C linkage — do **not** mangle the name." The key to FFI. |
| **Undefined reference** | The error you get when the linker needs a symbol nobody defined. |
| **Multiple definition** | The error when two object files both define the same symbol. |
| **ODR (One Definition Rule)** | The C/C++ rule that each entity has exactly one definition across the whole program. |
| **`nm`** | A command-line tool that lists the symbols in an object file or library. Your X-ray glasses. |
| **`c++filt`** | A command-line tool that turns mangled symbols back into readable names. |

---

## Core Concepts

### 1. A program is built in two phases: compile, then link

When you run `gcc main.c math.c -o app`, two distinct things happen:

```text
  main.c  ──compile──►  main.o   (machine code + symbol list)
  math.c  ──compile──►  math.o   (machine code + symbol list)
                           │
                           ▼
              ──link──►  app    (one executable, all symbols resolved)
```

The **compiler** works on *one file at a time*. It never sees the other files. The **linker** works on *all the object files at once* and is the only stage that can connect a call in `main.o` to a function defined in `math.o`.

This split is why "it compiles but won't link" is a thing. Compiling checks one file's syntax and types. Linking checks that every name you *used* actually *exists* somewhere.

### 2. A symbol is just a name with an address (eventually)

Inside an object file there is a **symbol table**: a list of names. Each name is either:

- **Defined** — "I have the code/data for this; it lives at offset X in my code section."
- **Undefined** — "I use this name but I don't have it; somebody please supply it."

When `main.c` calls `add(2, 3)`, the compiler emits a `call` instruction with a *blank* destination and records an **undefined** symbol `add`. When `math.c` compiles `add`, it records a **defined** symbol `add`. The linker's whole job is matching the blanks to the definitions.

### 3. What the linker actually does

The linker performs three core jobs:

1. **Symbol resolution.** For every undefined symbol, find the one object file or library that defines it. If none defines it → *undefined reference*. If two define it → *multiple definition*.
2. **Relocation.** Once it knows the final address of `add`, it goes back and patches the blank in `main.o`'s `call` instruction to point there.
3. **Section merging.** It concatenates all the code sections, all the data sections, etc., into one layout, then writes the final executable.

That's it. Linking feels mysterious until you see it's just "match names, then patch addresses."

### 4. C does not mangle (much)

In C, a function name maps almost directly to its symbol name. `int add(int, int)` produces the symbol `add`. (On some older platforms a leading underscore is added — `_add` — but that's a platform convention, not encoding of types.)

This works because **C has no function overloading**. You cannot have two functions named `add` in one program. One name, one function, one symbol. The symbol name carries *no type information* because it doesn't need to.

The price: the linker cannot tell if you call `add` with the wrong arguments. If `main.c` thinks `add` takes two `int`s and `math.c` actually defined it to take two `double`s, the symbol `add` matches, the link succeeds, and you get *silent garbage at runtime*. C trades safety for simplicity.

### 5. C++ must mangle

C++ has features C lacks, and every one of them creates a "two things spelled the same" problem the linker can't handle with plain names:

- **Overloading:** `add(int,int)` and `add(double,double)` are different functions, same source name.
- **Namespaces:** `audio::process` and `video::process` are different functions, same source name.
- **Member functions:** `Vector::size()` and `String::size()` are different functions, same source name.
- **Templates:** `max<int>` and `max<double>` are different *instantiations*, same source name.

The compiler resolves all of this by **mangling**: it builds a symbol name that encodes the function's *full identity*. So:

```text
   add(int, int)             →  _Z3addii
   add(double, double)       →  _Z3adddd
   audio::process()          →  _ZN5audio7processEv
   Vector::size() const      →  _ZNK6Vector4sizeEv
```

Now every distinct function gets a distinct symbol, and the linker can keep them apart. You don't have to *read* these yet — `middle.md` decodes the grammar. For now, just internalize: **the ugly name is the compiler encoding the signature into the symbol.**

### 6. `extern "C"` turns mangling off

Because C symbols are simple and stable, C is the **lingua franca of FFI** — every language knows how to call a C function. So when you want a C++ function to be callable from C (or Python, or Rust, or anything), you tell the C++ compiler: *don't mangle this one*:

```cpp
extern "C" int add(int a, int b) {
    return a + b;
}
```

Now the symbol is plain `add`, not `_Z3addii`, and any C-aware tool can find and call it. The cost: an `extern "C"` function *cannot be overloaded* (there's only one symbol name to go around). That's the whole trade — you give up C++ features at the boundary in exchange for a stable, callable name.

### 7. The One Definition Rule (ODR), briefly

Every function and global must be **defined exactly once** across the whole program. Define it twice → *multiple definition* error. Define it zero times but use it → *undefined reference*. This is why putting a non-`inline` function body in a header that's `#include`d by two `.c` files breaks the build: now two object files define the same symbol.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Symbol** | A person's full name on a contact list. |
| **Undefined symbol** | "Call Bob" written in your notebook — but you don't have Bob's number yet. |
| **Defined symbol** | An entry in the phone book: "Bob → 555-0100." |
| **Linker** | The assistant who goes through your "call Bob" notes and fills in every number from the phone book. |
| **Undefined reference** | "Call Bob" but Bob isn't in any phone book you have. The assistant gives up. |
| **Multiple definition** | Two phone books both list a different "Bob." The assistant doesn't know which to use. |
| **C name (no mangling)** | A small village where everyone has a unique first name. "Bob" is enough. |
| **C++ mangling** | A big city where you must write "Bob Smith, 12 Oak St, accountant" because there are forty Bobs. |
| **`extern "C"`** | Agreeing to use just first names at the village gate so visitors who only know first names can still find people. |
| **Relocation** | The blank line "Call ____" that the assistant fills in once the number is known. |
| **`nm` / `c++filt`** | A magnifying glass that lets you read the phone book, and a decoder that turns "Bob Smith, accountant" back from the city's coded shorthand. |

---

## Mental Models

### The "Fill in the Blanks" Model

Compiling one file is like writing a letter with blanks: *"Then call ____ and pass it 2 and 3."* The compiler can't fill the blank because the destination lives in another file. It just labels the blank with a name: `add`. Linking is the editor going through every letter, finding the real address for each labeled blank, and writing it in. An *undefined reference* is a blank whose label matches nothing the editor has.

### The "Phone Book" Model

Think of every object file as having two lists: **"numbers I know"** (defined symbols) and **"people I need to call"** (undefined symbols). The linker is the operator who merges all the "numbers I know" lists into one big phone book, then resolves everyone's "need to call" list against it. C names are like first-name-only entries — fine in a small town. C++ mangled names are full address-and-occupation entries — necessary when many people share a first name.

### The "Mangling Encodes the Signature" Model

Don't read `_Z3addii` as noise. Read it as a *compression of the declaration*. The compiler took `add(int, int)` and squeezed every distinguishing fact — the name `add`, the two `int` parameters — into one string. If you change the parameters to `add(int, long)`, the string changes too. Same source name, different signature, different symbol. The mangled name *is* the signature, just written in the linker's alphabet.

---

## Code Examples

We'll use C and C++ and inspect real symbols with `nm` and `c++filt`. Run these yourself — seeing the actual symbols is the whole lesson.

### The classic two-file C program

```c
/* math.c */
int add(int a, int b) {
    return a + b;
}
```

```c
/* main.c */
#include <stdio.h>
int add(int a, int b);   /* declaration only — no body */

int main(void) {
    printf("%d\n", add(2, 3));
    return 0;
}
```

Compile each to an object file *without linking* and inspect symbols:

```text
$ gcc -c math.c -o math.o
$ gcc -c main.c -o main.o

$ nm math.o
0000000000000000 T add        ← 'T' = defined, in text (code) section

$ nm main.o
                 U add         ← 'U' = undefined (needs it from elsewhere)
                 U printf      ← also undefined; comes from libc
0000000000000000 T main
```

`main.o` has `U add` (it *needs* `add`); `math.o` has `T add` (it *provides* `add`). Linking matches them:

```text
$ gcc main.o math.o -o app
$ ./app
5
```

Note the C symbol is just `add`. No types. That's no-mangling in action.

### The undefined-reference error, on purpose

Link `main.o` *alone* and the linker can't find `add`:

```text
$ gcc main.o -o app
main.o: in function `main':
main.c: undefined reference to `add'
```

Read it literally: *"`main` uses a symbol `add` and nobody supplied it."* The fix is to provide the definition — link `math.o` too. This is the most common beginner link error, and now you can read it.

### C++ mangling, made visible

```cpp
// shapes.cpp
namespace geo {
    double area(double r)        { return 3.14159 * r * r; }
    double area(double w, double h) { return w * h; }   // overload
}
```

```text
$ g++ -c shapes.cpp -o shapes.o
$ nm shapes.o
0000000000000000 T _ZN3geo4areaEd      ← geo::area(double)
0000000000000018 T _ZN3geo4areaEdd     ← geo::area(double, double)
```

Two functions named `area`, two distinct symbols. Notice the single `d` vs double `dd` — that's the parameter list encoded. Now demangle them:

```text
$ nm shapes.o | c++filt
0000000000000000 T geo::area(double)
0000000000000018 T geo::area(double, double)
```

`c++filt` reverses the mangling. The encoding round-trips perfectly because it's a precise scheme, not a hash.

### Making a C++ function callable from C

```cpp
// lib.cpp
extern "C" int add(int a, int b) {   // C linkage: do NOT mangle
    return a + b;
}

int add(int a, int b, int c) {       // normal C++ linkage: WILL mangle
    return a + b + c;
}
```

```text
$ g++ -c lib.cpp -o lib.o
$ nm lib.o
0000000000000000 T add              ← extern "C": plain symbol
000000000000001a T _Z3addiii        ← C++ overload: mangled
```

The `extern "C"` function exposes the plain symbol `add`, which a C program (or any FFI caller) can link against. The C++ overload keeps its mangled name. This is exactly how you build a C-callable wrapper around a C++ library.

### The header pattern that wraps a C++ API for C

```cpp
// engine.h — included by both C and C++ code
#ifdef __cplusplus
extern "C" {
#endif

int engine_start(void);
void engine_stop(void);

#ifdef __cplusplus
}
#endif
```

The `#ifdef __cplusplus` guard means: *when a C++ compiler reads this header, wrap the declarations in `extern "C"` so the symbols stay unmangled; when a C compiler reads it, the guard is invisible and it's plain C.* This is the standard idiom you'll see at the top of nearly every C-facing header in the world (look at any system header).

### Demangling a crash, in practice

When a C++ program crashes, the stack trace often shows mangled names:

```text
#3  0x0000abcd in _ZN6Parser5parseERKNSt7__cxx1112basic_stringIcEE
```

Pipe it through `c++filt` and it becomes readable:

```text
$ echo '_ZN6Parser5parseERKNSt7__cxx1112basic_stringIcEE' | c++filt
Parser::parse(std::__cxx11::basic_string<char> const&)
```

Suddenly the crash is in `Parser::parse(const std::string&)`. Many debuggers demangle automatically, but when you're staring at a raw log, `c++filt` is the tool.

---

## Pros & Cons

### Name mangling (the C++ approach)

| Aspect | Pros | Cons |
|--------|------|------|
| **Expressiveness** | Lets overloading, namespaces, templates, and member functions coexist by giving each a unique symbol. | Symbols are unreadable to humans without a demangler. |
| **Type safety at link** | A signature change usually changes the symbol, so a stale caller fails to link instead of silently misbehaving. | The error messages contain scary mangled (or verbose demangled) names. |
| **Portability** | Within one compiler/ABI, mangling is consistent and predictable. | Mangling schemes differ across compilers (GCC/Clang vs MSVC) — you can't directly link C++ across them. |

### No mangling (the C approach)

| Aspect | Pros | Cons |
|--------|------|------|
| **Simplicity** | The symbol is just the name. Every language and tool can interoperate with it. | No overloading — one name, one function. |
| **FFI** | C is the universal calling convention; everything speaks C. | No type checking at the link boundary — wrong-argument mismatches link cleanly and crash later. |
| **Stability** | The symbol name is an obvious, stable contract. | You must hand-manage uniqueness (prefix your functions: `mylib_init`, not `init`). |

---

## Use Cases

You meet name mangling and linking whenever you:

- **Build any C or C++ program with more than one source file.** Every cross-file call is a symbol resolved at link time.
- **Hit an `undefined reference` or `multiple definition` error.** These *are* symbol-resolution failures; reading them is a daily skill.
- **Expose a C++ library to other languages.** You wrap the public API in `extern "C"` so callers see stable, unmangled symbols.
- **Read a stack trace or profiler output.** Mangled names appear; you demangle to understand them.
- **Link against a third-party library.** You're matching your undefined symbols against the library's defined ones — and version/ABI mismatches show up as link errors.
- **Debug "it works on my machine" link failures.** Often a missing `extern "C"`, a header included for C++ that wasn't guarded, or two libraries built with different compilers.

---

## Coding Patterns

### Pattern 1: Guard C-facing headers with `extern "C"`

```cpp
#ifdef __cplusplus
extern "C" {
#endif
    /* declarations usable from both C and C++ */
#ifdef __cplusplus
}
#endif
```

The one idiom to memorize. It makes a header safe to include from either language and keeps the symbols unmangled.

### Pattern 2: Inspect before you guess

When a link error appears, don't randomly add flags. Look:

```text
$ nm yourfile.o | c++filt | grep theFunction
```

If the symbol shows `U` (undefined) you forgot to link its definition. If you expected `extern "C"` and see a mangled name, your guard didn't apply.

### Pattern 3: Prefix C symbols to avoid collisions

Because C has no namespaces, give every public C function a library prefix:

```c
int  png_read_header(...);
void png_destroy(...);
```

Not `read_header` / `destroy` — those will collide with someone else's symbols at link time.

### Pattern 4: Declare in a header, define in exactly one `.c`

```c
/* widget.h */ int widget_count(void);          /* declaration */
/* widget.c */ int widget_count(void) { ... }   /* the single definition */
```

The header *declares* (creates an undefined reference wherever included); one `.c` *defines* (satisfies it). One definition, ODR happy.

---

## Best Practices

- **Read the linker error literally.** "undefined reference to `X`" means *nobody defined `X`* — find or link `X`'s definition. "multiple definition of `X`" means *two files defined it* — make one of them `static`, `inline`, or remove the duplicate.
- **Use `nm` as your first move on any symbol problem.** `nm file.o` shows defined (`T`/`D`) vs undefined (`U`) symbols. It answers "is it there?" instantly.
- **Always demangle C++ symbols.** Pipe through `c++filt` or use `nm -C` / `nm --demangle`. Reading raw mangled names by hand is for `middle.md`, not for debugging.
- **Guard every header that C might include** with the `extern "C"` / `__cplusplus` idiom.
- **Never put a non-`inline` function body in a header.** It causes multiple-definition errors when the header is included by more than one `.c`. Bodies go in `.c`/`.cpp`; only declarations (and `inline`/templates) go in headers.
- **Prefix your public C symbols** with a library name to avoid global namespace collisions.
- **Link the libraries that define your undefined symbols, in the right order** (with classic `ld`, libraries that *provide* a symbol must come *after* the object that *needs* it on the command line).

---

## Edge Cases & Pitfalls

- **Forgetting `extern "C"` when calling C++ from C.** The C side looks for `add`; the C++ side defined `_Z3addii`. Symbols don't match → `undefined reference to add`. Add `extern "C"` on the C++ definition.
- **Forgetting the `extern "C"` guard in a header.** A C++ caller mangles the declaration, the C library defines the plain name, they don't match. The guard fixes it.
- **Putting a function body in a header.** Two `.c` files include it → two definitions of the same symbol → multiple-definition error. Use a declaration in the header, definition in one `.c`.
- **Mismatched declaration and definition in C.** Because C doesn't encode types in the symbol, declaring `int add(int,int)` while the real `add` takes `double`s *links fine* and corrupts at runtime. The symbol matched; the types didn't. This is the dark side of no-mangling.
- **Library order on the link line (classic `ld`).** `gcc -lmath main.o` can fail where `gcc main.o -lmath` succeeds, because the old linker only pulls symbols a library needs *as of the point it appears*. Put libraries after the objects that use them.
- **Assuming `nm` shows everything.** Stripped binaries and some dynamic symbols won't show with plain `nm`; you may need `nm -D` for dynamic symbols. (More in `professional.md`.)
- **Confusing "compiles" with "links."** A missing definition is a *link* error, not a *compile* error. If the message mentions `undefined reference`, look at linking and symbols, not at your syntax.

---

## Test Yourself

1. Compile `math.c` and `main.c` from the examples to `.o` files. Run `nm` on each. Which symbol is `U` in `main.o` and `T` in `math.o`? Explain what `U` and `T` mean.
2. Link `main.o` by itself (no `math.o`). Read the error. Which symbol is missing and why?
3. Write a C++ file with two overloads of `area`. Run `nm` then `nm | c++filt`. How do the two mangled symbols differ, and what part of them encodes the parameters?
4. Add `extern "C"` to one of the two overloads. What happens — and why is it actually a compile error if you try to make *both* overloads `extern "C"`?
5. Take a mangled symbol from a real C++ binary (`nm /path/to/any/c++/program | head`) and run it through `c++filt`. What function did it name?
6. Put a non-`inline` function *body* in a header, include it from two `.c` files, and build. What error appears, and which rule (ODR) did you break?
7. In C, declare `int f(int)` in `main.c` but define `double f(double)` in `other.c`. Does it link? What happens at runtime? Why does the linker not catch this?

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                  NAME MANGLING & LINKING (JUNIOR)                │
├──────────────────────────────────────────────────────────────────┤
│ Build phases:  compile (per file) → link (all files together)    │
│ Compiler sees ONE file. Linker sees ALL files + libraries.       │
├──────────────────────────────────────────────────────────────────┤
│ Symbol = a name the linker matches on (function or global)       │
│   Defined   (nm: T/D/B)  "I have this"                           │
│   Undefined (nm: U)      "I need this from elsewhere"            │
├──────────────────────────────────────────────────────────────────┤
│ Linker's job:                                                    │
│   1. resolve  every U against a definition                       │
│   2. relocate patch in the real addresses                        │
│   3. merge    sections into one binary                           │
├──────────────────────────────────────────────────────────────────┤
│ C   : symbol = the name (maybe a leading _). NO overloading.     │
│ C++ : symbol = mangled signature. add(int,int) → _Z3addii        │
│ extern "C" : turn mangling OFF → stable, C-callable symbol       │
├──────────────────────────────────────────────────────────────────┤
│ The two classic errors:                                          │
│   undefined reference to X  → nobody DEFINED X (link its .o/lib) │
│   multiple definition of X  → TWO files defined X (dedupe)       │
├──────────────────────────────────────────────────────────────────┤
│ Tools:                                                           │
│   nm file.o          list symbols                                │
│   nm -C / c++filt    demangle C++ names                          │
│   objdump -t         symbol table                                │
├──────────────────────────────────────────────────────────────────┤
│ Header idiom (memorize):                                         │
│   #ifdef __cplusplus                                             │
│   extern "C" {                                                   │
│   #endif    ...declarations...                                   │
│   #ifdef __cplusplus                                             │
│   }                                                              │
│   #endif                                                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A program is built in **two phases**: the **compiler** processes each source file alone; the **linker** combines all object files and resolves cross-file references.
- A **symbol** is a name (a function or global) the linker matches on. Each object file has **defined** symbols ("I have this") and **undefined** symbols ("I need this").
- The **linker's job** is symbol resolution (match every undefined name to a definition), relocation (patch in real addresses), and merging sections into the final binary.
- **C does not mangle**: the symbol is essentially the name, because C has no overloading. This makes C the universal FFI language — but the linker can't catch wrong-argument mismatches.
- **C++ must mangle**: overloading, namespaces, member functions, and templates all need distinct symbols, so the compiler encodes the full signature into the name (`add(int,int)` → `_Z3addii`).
- **`extern "C"`** turns mangling off for a declaration, exposing a stable, C-callable symbol — the foundation of cross-language interop.
- The two classic link errors — **undefined reference** and **multiple definition** — are both symbol problems, readable once you think in symbols.
- The **One Definition Rule** says each entity is defined exactly once: declare in headers, define in exactly one `.c`/`.cpp`.
- Your tools are **`nm`** (list symbols), **`c++filt`** (demangle), and **`objdump`** (inspect). Reach for them *before* guessing.

---

## Further Reading

- *Linkers and Loaders* — John R. Levine. The friendly, definitive book on what the linker actually does.
- *Computer Systems: A Programmer's Perspective* (CSAPP) — Bryant & O'Hallaron, Chapter 7 ("Linking"). The best textbook treatment for beginners.
- *The `nm` and `c++filt` man pages* — `man nm`, `man c++filt`. Short and worth reading once.
- *"Beginner's Guide to Linkers"* — David Drysdale. A clear, short online article aimed exactly at this level.
- *The C++ FAQ* — entries on `extern "C"` and mixing C and C++. https://isocpp.org/wiki/faq/mixing-c-and-cpp
- *GCC manual* — the section on `-c`, `-l`, and link order.
