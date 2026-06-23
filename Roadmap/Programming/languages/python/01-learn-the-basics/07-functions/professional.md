# Python Functions & Builtin Functions — Professional / CPython Internals

## Table of Contents

1. [Introduction](#introduction)
2. [CALL_FUNCTION Bytecode Family](#call_function-bytecode-family)
3. [Frame Objects and the Call Stack](#frame-objects-and-the-call-stack)
4. [LEGB Scope Resolution at the C Level](#legb-scope-resolution-at-the-c-level)
5. [Closure Cells and Free Variables](#closure-cells-and-free-variables)
6. [Builtin Function Dispatch](#builtin-function-dispatch)
7. [Function Object Internals](#function-object-internals)
8. [Argument Parsing in CPython](#argument-parsing-in-cpython)
9. [Performance Implications](#performance-implications)
10. [Debugging with Internals](#debugging-with-internals)
11. [Code Examples](#code-examples)
12. [Cheat Sheet](#cheat-sheet)
13. [Further Reading](#further-reading)

---

## Introduction

This document goes **beneath the Python surface** into CPython's C implementation. We examine how function calls actually work at the bytecode and C level — from `CALL_FUNCTION` opcodes through frame creation, scope resolution via `LEGB` at the C level, closure cell mechanics, and how builtin functions are dispatched differently from user-defined ones.

> **Target audience:** Engineers who want to understand *why* Python behaves the way it does, optimize hot paths, contribute to CPython, or debug deeply.

> **CPython version reference:** 3.11+ (some opcodes changed significantly in 3.11 with adaptive specialization).

---

## CALL_FUNCTION Bytecode Family

### Evolution of Call Opcodes

In CPython 3.11+, the old `CALL_FUNCTION`, `CALL_FUNCTION_KW`, and `CALL_FUNCTION_EX` were replaced with a unified approach:

| CPython Version | Opcodes |
|---|---|
| 3.10 and earlier | `CALL_FUNCTION`, `CALL_FUNCTION_KW`, `CALL_FUNCTION_EX` |
| 3.11 | `PRECALL`, `CALL` (with adaptive specialization) |
| 3.12+ | `CALL` (PRECALL removed, further specialization) |

### Examining Bytecodes

```python
import dis
import sys

print(f"Python version: {sys.version}")

# Simple function call
def greet(name):
    return f"Hello, {name}"

print("=== Simple Call ===")
dis.dis(lambda: greet("World"))

# Call with keyword arguments
print("\n=== Keyword Call ===")
dis.dis(lambda: greet(name="World"))

# Call with *args
print("\n=== Star Args Call ===")
dis.dis(lambda: greet(*["World"]))

# Call with **kwargs
print("\n=== Double Star Kwargs Call ===")
dis.dis(lambda: greet(**{"name": "World"}))
```

### CALL Instruction Deep Dive (3.12+)

```python
import dis
import opcode

def example():
    len([1, 2, 3])        # builtin call
    print("hello")         # builtin with side effect
    sorted([3, 1, 2])     # builtin returning new object
    "hello".upper()        # method call
    max(1, 2, 3)          # builtin with varargs

print("=== Bytecode for mixed calls ===")
dis.dis(example)

# Inspect the code object directly
code = example.__code__
print(f"\nco_consts: {code.co_consts}")
print(f"co_names:  {code.co_names}")
print(f"co_stacksize: {code.co_stacksize}")

# Walk through instructions programmatically
print("\n=== Instruction details ===")
for instr in dis.get_instructions(example):
    if 'CALL' in instr.opname or 'LOAD' in instr.opname:
        print(f"  offset={instr.offset:3d}  {instr.opname:<25s} {instr.argrepr}")
```

### Adaptive Specialization (3.11+)

CPython 3.11 introduced **adaptive specialization** — the interpreter replaces generic opcodes with specialized faster versions after observing runtime types:

```python
import dis
import sys

def call_len_many_times():
    """After enough calls, CALL gets specialized to CALL_BUILTIN_O"""
    data = [1, 2, 3]
    for _ in range(100):
        len(data)

# Show the bytecode
dis.dis(call_len_many_times)

# After execution, specialized instructions may appear
call_len_many_times()

# In CPython 3.12+, you can see adaptive/specialized bytecodes:
if sys.version_info >= (3, 12):
    print("\n=== Adaptive/Specialized bytecode ===")
    dis.dis(call_len_many_times, adaptive=True)
```

<details>
<summary><strong>Specialized CALL variants in CPython 3.12+</strong></summary>

| Specialized Opcode | When Used |
|---|---|
| `CALL_BUILTIN_CLASS` | Calling a builtin type like `int()`, `list()` |
| `CALL_BUILTIN_O` | Builtin with exactly one positional arg (e.g., `len(x)`) |
| `CALL_BUILTIN_FAST` | Builtin using `METH_FASTCALL` |
| `CALL_BUILTIN_FAST_WITH_KEYWORDS` | Builtin with `METH_FASTCALL\|METH_KEYWORDS` |
| `CALL_PY_EXACT_ARGS` | Python function, exact positional match |
| `CALL_PY_WITH_DEFAULTS` | Python function with some defaults used |
| `CALL_BOUND_METHOD_EXACT_ARGS` | Bound method, exact args |
| `CALL_NO_KW_*` | Variants without keyword arguments |

</details>

---

## Frame Objects and the Call Stack

### Frame Object Structure

Every function call in CPython creates a **frame object** (`PyFrameObject`). In 3.11+, frames were significantly optimized.

```python
import sys
import inspect

def outer():
    x = 10
    def inner():
        y = 20
        frame = sys._getframe(0)  # current frame

        print("=== Current Frame (inner) ===")
        print(f"  f_code.co_name:     {frame.f_code.co_name}")
        print(f"  f_locals:           {frame.f_locals}")
        print(f"  f_lineno:           {frame.f_lineno}")
        print(f"  f_lasti:            {frame.f_lasti}")

        print("\n=== Parent Frame (outer) ===")
        parent = frame.f_back
        print(f"  f_code.co_name:     {parent.f_code.co_name}")
        print(f"  f_locals:           {parent.f_locals}")

        print("\n=== Grandparent Frame (module) ===")
        grandparent = parent.f_back
        print(f"  f_code.co_name:     {grandparent.f_code.co_name}")

        # Walk the entire call stack
        print("\n=== Full Call Stack ===")
        f = frame
        depth = 0
        while f is not None:
            print(f"  [{depth}] {f.f_code.co_filename}:{f.f_lineno} in {f.f_code.co_name}")
            f = f.f_back
            depth += 1

    inner()

outer()
```

### Frame Object Fields (C Struct Mapping)

```python
import sys
import ctypes

def inspect_frame_deeply():
    frame = sys._getframe(0)

    # Public attributes
    attrs = {
        'f_back':     'Link to caller frame (or None)',
        'f_code':     'Code object being executed',
        'f_locals':   'Local variables dict (snapshot)',
        'f_globals':  'Global variables dict (reference)',
        'f_builtins': 'Builtin variables dict',
        'f_lineno':   'Current source line number',
        'f_lasti':    'Index of last bytecode instruction',
        'f_trace':    'Trace function (or None)',
    }

    print("=== Frame Public Attributes ===")
    for attr, desc in attrs.items():
        val = getattr(frame, attr, 'N/A')
        if attr == 'f_globals':
            val = f"<dict with {len(val)} keys>"
        elif attr == 'f_builtins':
            val = f"<dict with {len(val)} keys>"
        print(f"  {attr:15s} = {val!r:50s}  # {desc}")

    # Code object details
    code = frame.f_code
    print("\n=== Code Object (co_*) ===")
    code_attrs = [
        'co_name', 'co_qualname', 'co_argcount', 'co_posonlyargcount',
        'co_kwonlyargcount', 'co_nlocals', 'co_stacksize',
        'co_flags', 'co_varnames', 'co_freevars', 'co_cellvars',
    ]
    for attr in code_attrs:
        val = getattr(code, attr, 'N/A')
        print(f"  {attr:25s} = {val!r}")

inspect_frame_deeply()
```

### 3.11+ Frame Internals: Localsplus

```python
"""
In CPython 3.11+, frames are allocated on a C stack (not the heap)
for most calls. This is a major performance optimization.

The internal layout of a frame's "localsplus" array:
  [ locals | cellvars | freevars | stack ]

  - locals:   co_nlocals slots for local variables
  - cellvars: co_ncellvars slots for variables captured by nested functions
  - freevars: co_nfreevars slots for variables captured from enclosing scope
  - stack:    co_stacksize slots for the evaluation stack
"""

def demonstrate_localsplus():
    """Show how localsplus is structured"""
    import dis

    def outer(a, b):
        x = 10         # local
        def inner():   # x becomes a cellvar in outer
            return x   # x is a freevar in inner
        return inner

    # outer's code object
    oc = outer.__code__
    print("=== outer ===")
    print(f"  co_varnames  (locals):   {oc.co_varnames}")
    print(f"  co_cellvars  (cells):    {oc.co_cellvars}")
    print(f"  co_freevars  (free):     {oc.co_freevars}")
    print(f"  co_nlocals:              {oc.co_nlocals}")
    print(f"  co_stacksize:            {oc.co_stacksize}")

    # inner's code object
    closure = outer(1, 2)
    ic = closure.__code__
    print("\n=== inner ===")
    print(f"  co_varnames  (locals):   {ic.co_varnames}")
    print(f"  co_cellvars  (cells):    {ic.co_cellvars}")
    print(f"  co_freevars  (free):     {ic.co_freevars}")
    print(f"  co_nlocals:              {ic.co_nlocals}")
    print(f"  co_stacksize:            {ic.co_stacksize}")

    print("\n=== outer bytecode ===")
    dis.dis(outer)

    print("\n=== inner bytecode ===")
    dis.dis(closure)

demonstrate_localsplus()
```

---

## LEGB Scope Resolution at the C Level

### How CPython Resolves Names

At the bytecode level, name resolution uses different opcodes for each scope:

| Scope | Opcode | C Implementation |
|---|---|---|
| **L**ocal | `LOAD_FAST` | Direct array index into `localsplus` |
| **E**nclosing | `LOAD_DEREF` | Follows cell/freevar reference |
| **G**lobal | `LOAD_GLOBAL` | Dict lookup in `f_globals`, then `f_builtins` |
| **B**uiltin | `LOAD_GLOBAL` (fallback) | Dict lookup in `f_builtins` |

```python
import dis

x_global = "global"

def demonstrate_legb():
    x_enclosing = "enclosing"

    def inner():
        x_local = "local"

        # Each of these uses a different opcode:
        a = x_local       # LOAD_FAST (Local)
        b = x_enclosing   # LOAD_DEREF (Enclosing)
        c = x_global      # LOAD_GLOBAL (Global)
        d = len           # LOAD_GLOBAL -> f_builtins (Builtin)

        return a, b, c, d

    return inner

closure = demonstrate_legb()

print("=== Bytecode showing LEGB opcodes ===")
dis.dis(closure)

# Verify with instruction objects
print("\n=== Load instructions only ===")
for instr in dis.get_instructions(closure):
    if instr.opname.startswith('LOAD'):
        print(f"  {instr.opname:20s} {instr.argrepr:20s}  (offset {instr.offset})")
```

### LOAD_FAST: Local Variable Access

```python
"""
LOAD_FAST is the fastest name lookup — it's a direct C array index.

In CPython C code (ceval.c):
    case TARGET(LOAD_FAST): {
        PyObject *value = GETLOCAL(oparg);  // localsplus[oparg]
        if (value == NULL) {
            // UnboundLocalError
        }
        Py_INCREF(value);
        PUSH(value);
        DISPATCH();
    }

This is O(1) — just an array dereference. No hash lookup at all.
"""

import dis
import timeit

def using_local():
    x = 42
    # Each access to x is LOAD_FAST
    return x + x + x + x + x

def using_global():
    # Each access to global_var is LOAD_GLOBAL (hash table lookup)
    return global_var + global_var + global_var + global_var + global_var

global_var = 42

print("=== LOAD_FAST (local) ===")
dis.dis(using_local)

print("\n=== LOAD_GLOBAL (global) ===")
dis.dis(using_global)

# Performance comparison
t_local = timeit.timeit(using_local, number=1_000_000)
t_global = timeit.timeit(using_global, number=1_000_000)
print(f"\nLocal  access: {t_local:.4f}s")
print(f"Global access: {t_global:.4f}s")
print(f"Ratio: {t_global/t_local:.2f}x slower for global")
```

### LOAD_GLOBAL with Inline Cache (3.11+)

```python
"""
In CPython 3.11+, LOAD_GLOBAL uses an inline cache for specialization:

  LOAD_GLOBAL can be specialized to:
    - LOAD_GLOBAL_MODULE:  cached version number + direct pointer
    - LOAD_GLOBAL_BUILTIN: cached version number + direct pointer

The version check avoids full dict lookup on subsequent calls.
"""

import dis
import sys

x_module_level = 100

def uses_globals():
    a = x_module_level   # LOAD_GLOBAL (module level)
    b = len              # LOAD_GLOBAL (builtin)
    c = print            # LOAD_GLOBAL (builtin)
    return a, b, c

print(f"Python {sys.version}")
print("\n=== Before execution (generic) ===")
dis.dis(uses_globals)

# Execute many times to trigger specialization
for _ in range(100):
    uses_globals()

if sys.version_info >= (3, 12):
    print("\n=== After execution (specialized) ===")
    dis.dis(uses_globals, adaptive=True)
```

### LOAD_DEREF: Closure Variable Access

```python
"""
LOAD_DEREF accesses a cell or free variable through a cell object.

In CPython C code:
    case TARGET(LOAD_DEREF): {
        PyObject *cell = GETLOCAL(oparg);  // Get the cell from localsplus
        PyObject *value = PyCell_GET(cell); // Dereference the cell
        if (value == NULL) {
            // NameError for free vars, UnboundLocalError for cell vars
        }
        Py_INCREF(value);
        PUSH(value);
        DISPATCH();
    }

This is O(1) but with an extra indirection through the cell object.
"""

import dis

def make_counter():
    count = 0  # This becomes a cell variable

    def increment():
        nonlocal count
        count += 1  # LOAD_DEREF + STORE_DEREF
        return count

    def get():
        return count  # LOAD_DEREF only

    return increment, get

inc, get = make_counter()

print("=== increment function ===")
dis.dis(inc)

print("\n=== get function ===")
dis.dis(get)

# Inspect the closure cells
print(f"\n=== Closure cells ===")
print(f"inc.__closure__: {inc.__closure__}")
print(f"Cell contents:   {inc.__closure__[0].cell_contents}")

inc()
inc()
print(f"After 2 increments: {inc.__closure__[0].cell_contents}")

# Both functions share the SAME cell
print(f"\nSame cell? {inc.__closure__[0] is get.__closure__[0]}")
```

---

## Closure Cells and Free Variables

### Cell Object Internals

```python
"""
A cell object is a simple container (PyCellObject in C):

    typedef struct {
        PyObject_HEAD
        PyObject *ob_ref;   // The actual value (or NULL)
    } PyCellObject;

When a local variable is captured by a nested function, CPython
replaces direct storage with a cell object. Both the enclosing
and nested function access the value through this shared cell.
"""

from types import CellType

# Create a cell manually
def make_cell(val):
    def inner():
        return val
    return inner.__closure__[0]

cell = make_cell(42)
print(f"Cell type:     {type(cell)}")
print(f"Cell contents: {cell.cell_contents}")

# Cell is mutable
cell2 = make_cell([1, 2, 3])
print(f"Cell contents: {cell2.cell_contents}")

# Empty cell raises ValueError
def make_empty_cell():
    def inner():
        return x  # noqa
    # Don't define x — the cell exists but is empty
    # This requires some trickery:
    pass

# Demonstrate shared cells
def shared_cell_demo():
    value = "original"

    def reader():
        return value

    def writer(new_val):
        nonlocal value
        value = new_val

    print(f"Before: {reader()}")
    writer("modified")
    print(f"After:  {reader()}")

    # Prove they share a cell
    r_cell = reader.__closure__[0]
    w_cell = writer.__closure__[0]
    print(f"Same cell object: {r_cell is w_cell}")  # True
    print(f"Cell id: {id(r_cell)}")

shared_cell_demo()
```

### Late Binding Closure Internals

```python
"""
The infamous late-binding closure issue, explained at the bytecode level.
"""

import dis

def late_binding_demo():
    funcs = []
    for i in range(3):
        funcs.append(lambda: i)
    return funcs

# All return 2 because they share the same cell for 'i'
results = late_binding_demo()
print("Late binding results:", [f() for f in results])  # [2, 2, 2]

# Look at the bytecode of the lambda
print("\n=== Lambda bytecode ===")
dis.dis(results[0])

# All three lambdas share the same closure cell
print("\n=== Closure analysis ===")
for idx, f in enumerate(results):
    cell = f.__closure__[0]
    print(f"  lambda[{idx}]: cell id={id(cell)}, contents={cell.cell_contents}")

# Fix 1: Default argument (evaluated at definition time)
def early_binding_default():
    funcs = []
    for i in range(3):
        funcs.append(lambda i=i: i)  # i=i captures current value
    return funcs

results_fixed = early_binding_default()
print("\nEarly binding (default arg):", [f() for f in results_fixed])

# The fixed version uses LOAD_FAST, not LOAD_DEREF
print("\n=== Fixed lambda bytecode (uses LOAD_FAST) ===")
dis.dis(results_fixed[0])
print(f"Closure: {results_fixed[0].__closure__}")  # None — no closure needed!

# Fix 2: functools.partial
from functools import partial

def early_binding_partial():
    funcs = []
    for i in range(3):
        funcs.append(partial(lambda i: i, i))
    return funcs

results_partial = early_binding_partial()
print("\nEarly binding (partial):", [f() for f in results_partial])
```

### MAKE_CELL and COPY_FREE_VARS Opcodes

```python
"""
In CPython 3.11+, there are explicit opcodes for cell setup:

  MAKE_CELL: Creates a cell object for a local that will be shared
  COPY_FREE_VARS: Copies free variable cells from the closure tuple
                  into the frame's localsplus array
"""

import dis

def outer():
    x = 10      # Will become a cell var
    y = 20      # Will become a cell var
    z = 30      # Pure local (not captured)

    def inner():
        return x + y  # x and y are free vars here

    return inner() + z

print("=== outer bytecode (look for MAKE_CELL) ===")
dis.dis(outer)

# Get inner's code
inner_code = None
for const in outer.__code__.co_consts:
    if hasattr(const, 'co_name') and const.co_name == 'inner':
        inner_code = const
        break

if inner_code:
    print("\n=== inner bytecode (look for COPY_FREE_VARS) ===")
    dis.dis(inner_code)
    print(f"\n  co_freevars: {inner_code.co_freevars}")
    print(f"  co_cellvars: {inner_code.co_cellvars}")
```

---

## Builtin Function Dispatch

### Builtin Function Types at the C Level

```python
"""
CPython has several types of callable C functions:

1. builtin_function_or_method (PyCFunctionObject)
   - METH_NOARGS:     f(self)
   - METH_O:          f(self, arg)
   - METH_VARARGS:    f(self, *args)  — uses a tuple
   - METH_FASTCALL:   f(self, *args, nargs)  — uses C array (fast!)
   - METH_KEYWORDS:   adds **kwargs support

2. method_descriptor (wraps C methods on types)

3. wrapper_descriptor (wraps slot functions like __add__)
"""

import types

# Examine builtin function types
builtins_to_check = [len, print, sorted, map, zip, range, int, list.append]

print("=== Builtin Callable Types ===")
for fn in builtins_to_check:
    print(f"  {str(fn):45s} type={type(fn).__name__}")

# Check method flags where possible
print("\n=== Distinguishing builtin categories ===")
print(f"  len     is builtin_function_or_method: {type(len).__name__}")
print(f"  int     is type:                       {type(int).__name__}")
print(f"  [].sort is builtin_function_or_method: {type([].sort).__name__}")
print(f"  list.sort is method_descriptor:        {type(list.sort).__name__}")
```

### How Builtin Calls Are Dispatched

```python
"""
When CPython executes a CALL instruction for a builtin:

1. Check the callable's type
2. If it's a PyCFunctionObject, check the method flags:
   - METH_O: Call directly with one arg (fastest for single-arg builtins)
   - METH_FASTCALL: Pass a C array of args (fast, no tuple creation)
   - METH_VARARGS: Pack args into a tuple, then call
3. If it's a type object, call tp_call (which calls tp_new + tp_init)
4. If it's any other object, look for __call__ and recurse
"""

import timeit

# Performance difference between calling conventions
def bench_len():
    """len() uses METH_O — single argument, very fast"""
    data = [1, 2, 3]
    for _ in range(1000):
        len(data)

def bench_sorted():
    """sorted() uses METH_FASTCALL|METH_KEYWORDS"""
    data = [3, 1, 2]
    for _ in range(1000):
        sorted(data)

def bench_isinstance():
    """isinstance() uses METH_FASTCALL"""
    for _ in range(1000):
        isinstance(42, int)

# Each has different dispatch overhead
print("=== Dispatch Performance ===")
for fn, name in [(bench_len, "len (METH_O)"),
                  (bench_sorted, "sorted (FASTCALL)"),
                  (bench_isinstance, "isinstance (FASTCALL)")]:
    t = timeit.timeit(fn, number=1000)
    print(f"  {name:30s}: {t:.4f}s")
```

### Vectorcall Protocol (PEP 590)

```python
"""
PEP 590 introduced the vectorcall protocol in Python 3.8.
It avoids creating temporary tuples/dicts for arguments.

The vectorcall signature:
    PyObject *vectorcall(PyObject *callable,
                         PyObject *const *args,
                         size_t nargsf,
                         PyObject *kwnames)

Where:
  - args is a C array of PyObject pointers
  - nargsf encodes the number of positional args (and a flag)
  - kwnames is a tuple of keyword argument names (or NULL)
  - Keyword argument values are at the end of the args array
"""

import sys

# Check if an object supports vectorcall
def check_vectorcall(obj, name):
    """In CPython, Py_TPFLAGS_HAVE_VECTORCALL is set on the type"""
    tp_flags = type(obj).__flags__
    # Py_TPFLAGS_HAVE_VECTORCALL = 1 << 11 (0x800)
    has_vectorcall = bool(tp_flags & (1 << 11))
    print(f"  {name:20s}: vectorcall={'Yes' if has_vectorcall else 'No'}")

print("=== Vectorcall Support ===")
check_vectorcall(len, "len")
check_vectorcall(print, "print")
check_vectorcall(int, "int")
check_vectorcall(list, "list")
check_vectorcall(dict, "dict")
check_vectorcall(type, "type")
check_vectorcall(lambda: None, "lambda")

def my_func():
    pass
check_vectorcall(my_func, "user function")

class MyCallable:
    def __call__(self):
        pass

check_vectorcall(MyCallable(), "instance __call__")
```

---

## Function Object Internals

### PyFunctionObject Structure

```python
"""
A Python function object (PyFunctionObject) contains:
  - func_code:       The code object (PyCodeObject)
  - func_globals:    The global namespace dict
  - func_defaults:   Default argument values (tuple or NULL)
  - func_kwdefaults: Default keyword-only argument values (dict or NULL)
  - func_closure:    Tuple of cell objects (or NULL)
  - func_name:       The function name (str)
  - func_qualname:   The qualified name (str)
  - func_dict:       The __dict__ for arbitrary attributes
  - func_annotations: Type annotations dict
  - func_module:     The __module__ attribute
"""

def example(a, b=10, *args, key="default", **kwargs):
    """An example function with all argument types"""
    x = 42
    return a + b

# Inspect all function attributes
print("=== Function Object Attributes ===")
print(f"  __name__:        {example.__name__!r}")
print(f"  __qualname__:    {example.__qualname__!r}")
print(f"  __module__:      {example.__module__!r}")
print(f"  __defaults__:    {example.__defaults__}")
print(f"  __kwdefaults__:  {example.__kwdefaults__}")
print(f"  __closure__:     {example.__closure__}")
print(f"  __annotations__: {example.__annotations__}")
print(f"  __dict__:        {example.__dict__}")
print(f"  __doc__:         {example.__doc__!r}")

# Code object details
code = example.__code__
print(f"\n=== Code Object ===")
print(f"  co_argcount:        {code.co_argcount}")
print(f"  co_posonlyargcount: {code.co_posonlyargcount}")
print(f"  co_kwonlyargcount:  {code.co_kwonlyargcount}")
print(f"  co_nlocals:         {code.co_nlocals}")
print(f"  co_varnames:        {code.co_varnames}")
print(f"  co_flags:           {code.co_flags:#x}")

# Decode co_flags
import inspect
print(f"\n=== co_flags decoded ===")
flag_names = [
    (0x01, 'CO_OPTIMIZED'),
    (0x02, 'CO_NEWLOCALS'),
    (0x04, 'CO_VARARGS'),
    (0x08, 'CO_VARKEYWORDS'),
    (0x20, 'CO_GENERATOR'),
    (0x40, 'CO_NOFREE'),
    (0x80, 'CO_COROUTINE'),
    (0x100, 'CO_ITERABLE_COROUTINE'),
    (0x200, 'CO_ASYNC_GENERATOR'),
]
for flag_val, flag_name in flag_names:
    if code.co_flags & flag_val:
        print(f"  {flag_name}")
```

### Function Creation at the Bytecode Level

```python
"""
When Python encounters a 'def' statement, it:
1. Loads the code object (LOAD_CONST)
2. Loads the function name (LOAD_CONST)
3. Creates the function (MAKE_FUNCTION)
4. Stores it (STORE_NAME/STORE_FAST)
"""

import dis

# Module-level function definition
source = '''
def simple():
    pass

def with_defaults(a, b=10):
    pass

def with_closure():
    x = 10
    def inner():
        return x
    return inner

def with_annotations(a: int, b: str = "hi") -> bool:
    pass
'''

code = compile(source, "<demo>", "exec")
print("=== Module-level bytecode ===")
dis.dis(code)
```

---

## Argument Parsing in CPython

### How Arguments Are Bound

```python
"""
CPython argument parsing goes through several stages:

1. Positional arguments are placed in order
2. *args collects extra positionals into a tuple
3. Keyword arguments are matched by name
4. **kwargs collects extra keywords into a dict
5. Missing arguments are filled from defaults
6. Any still-missing arguments raise TypeError

For C functions, this is done in C (fast).
For Python functions, this is done by _PyEval_MakeFrameVector (3.11+).
"""

import dis

def complex_sig(a, b, /, c, d=4, *args, e, f=6, **kwargs):
    """
    a, b: positional-only
    c: positional-or-keyword
    d: positional-or-keyword with default
    *args: var-positional
    e: keyword-only (required)
    f: keyword-only with default
    **kwargs: var-keyword
    """
    pass

# Inspect how Python sees this signature
import inspect
sig = inspect.signature(complex_sig)
print("=== Signature ===")
for name, param in sig.parameters.items():
    print(f"  {name:10s}: kind={param.kind.name:25s} default={param.default!r}")

# Show the code object's view
code = complex_sig.__code__
print(f"\n=== Code Object View ===")
print(f"  co_argcount:        {code.co_argcount}  (pos-only + pos-or-kw, not *args)")
print(f"  co_posonlyargcount: {code.co_posonlyargcount}")
print(f"  co_kwonlyargcount:  {code.co_kwonlyargcount}")
print(f"  co_varnames:        {code.co_varnames}")
print(f"  __defaults__:       {complex_sig.__defaults__}")
print(f"  __kwdefaults__:     {complex_sig.__kwdefaults__}")
print(f"  CO_VARARGS:         {bool(code.co_flags & 0x04)}")
print(f"  CO_VARKEYWORDS:     {bool(code.co_flags & 0x08)}")
```

### LOAD_FAST_CHECK (3.12+)

```python
"""
CPython 3.12 added LOAD_FAST_CHECK for cases where a local variable
might not be initialized (e.g., in exception handlers, with 'del').
Regular LOAD_FAST assumes the variable is always set.
"""

import dis
import sys

def might_be_unbound(condition):
    if condition:
        x = 42
    # x might not be defined here
    return x  # This needs LOAD_FAST_CHECK in 3.12+

print(f"Python {sys.version}")
print("\n=== Bytecode for potentially unbound local ===")
dis.dis(might_be_unbound)

# Contrast with always-bound
def always_bound():
    x = 42
    return x  # This uses plain LOAD_FAST

print("\n=== Bytecode for always-bound local ===")
dis.dis(always_bound)
```

---

## Performance Implications

### Measuring Call Overhead

```python
import timeit
from functools import partial

# 1. Bare function call
def bare_func(x):
    return x

# 2. Lambda
bare_lambda = lambda x: x

# 3. Callable class
class CallableClass:
    def __call__(self, x):
        return x

callable_obj = CallableClass()

# 4. Partial
def add(a, b):
    return a + b

partial_func = partial(add, 1)

# 5. Closure
def make_adder(n):
    def adder(x):
        return x + n
    return adder

closure_func = make_adder(1)

# Benchmark all
benchmarks = {
    "bare function":  lambda: bare_func(42),
    "lambda":         lambda: bare_lambda(42),
    "callable class": lambda: callable_obj(42),
    "partial":        lambda: partial_func(42),
    "closure":        lambda: closure_func(42),
    "builtin (len)":  lambda: len("hello"),
}

print("=== Call Overhead Comparison ===")
for name, fn in benchmarks.items():
    t = timeit.timeit(fn, number=1_000_000)
    print(f"  {name:20s}: {t:.4f}s")
```

### Local vs Global vs Builtin Lookup Speed

```python
import timeit
import math

# Builtin via LOAD_GLOBAL (two dict lookups: globals, then builtins)
def using_builtin_directly():
    for _ in range(1000):
        abs(-42)

# Builtin cached as local (LOAD_FAST)
def using_cached_builtin():
    _abs = abs  # Cache in local
    for _ in range(1000):
        _abs(-42)

# Module function via LOAD_GLOBAL
def using_module_func():
    for _ in range(1000):
        math.sqrt(42)

# Module function cached as local
def using_cached_module():
    _sqrt = math.sqrt
    for _ in range(1000):
        _sqrt(42)

print("=== Lookup Speed Comparison ===")
benchmarks = {
    "builtin (LOAD_GLOBAL)":       using_builtin_directly,
    "builtin cached (LOAD_FAST)":  using_cached_builtin,
    "module.func (LOAD_GLOBAL+ATTR)": using_module_func,
    "module.func cached (LOAD_FAST)": using_cached_module,
}

for name, fn in benchmarks.items():
    t = timeit.timeit(fn, number=10_000)
    print(f"  {name:40s}: {t:.4f}s")
```

---

## Debugging with Internals

### Using sys.settrace for Call Tracing

```python
import sys

def trace_calls(frame, event, arg):
    """Trace function that monitors calls and returns"""
    if event == 'call':
        code = frame.f_code
        print(f"  CALL  {code.co_name}() "
              f"[{code.co_filename}:{frame.f_lineno}] "
              f"locals={list(frame.f_locals.keys())}")
    elif event == 'return':
        print(f"  RETURN from {frame.f_code.co_name}() -> {arg!r}")
    return trace_calls

def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

print("=== Tracing factorial(4) ===")
sys.settrace(trace_calls)
result = factorial(4)
sys.settrace(None)
print(f"Result: {result}")
```

### Inspecting Live Frame State

```python
import sys
import traceback

def debug_frame_walker():
    """Walk the call stack and inspect each frame"""

    def level3():
        secret = "found_me"
        frame = sys._getframe(0)

        print("=== Walking frames from innermost to outermost ===")
        f = frame
        while f is not None:
            code = f.f_code
            local_names = list(f.f_locals.keys())
            print(f"\n  Frame: {code.co_name}")
            print(f"    File: {code.co_filename}:{f.f_lineno}")
            print(f"    Locals: {local_names[:10]}{'...' if len(local_names) > 10 else ''}")

            # Show cell and free vars if any
            if code.co_cellvars:
                print(f"    Cell vars: {code.co_cellvars}")
            if code.co_freevars:
                print(f"    Free vars: {code.co_freevars}")

            f = f.f_back

    def level2():
        middle_var = [1, 2, 3]
        level3()

    def level1():
        outer_var = {"key": "value"}
        level2()

    level1()

debug_frame_walker()
```

### Code Object Surgery

```python
"""
WARNING: Modifying code objects can crash the interpreter.
This is for educational purposes only.
"""

import types

def original(x):
    return x + 1

# Create a modified version by replacing the code object
new_code = original.__code__.replace(
    co_consts=(None, 100),  # Change the constant from 1 to 100
)

modified = types.FunctionType(
    new_code,
    original.__globals__,
    "modified"
)

print(f"original(5) = {original(5)}")   # 6
print(f"modified(5) = {modified(5)}")   # 105

# Inspect the difference
print(f"\noriginal co_consts: {original.__code__.co_consts}")
print(f"modified co_consts: {modified.__code__.co_consts}")
```

---

## Code Examples

### Complete Example: Building a Tracing Decorator with Frame Inspection

```python
import sys
import time
import functools
from collections import defaultdict

class FunctionProfiler:
    """
    A profiler that uses CPython internals to gather detailed
    information about function calls.
    """

    def __init__(self):
        self.call_counts = defaultdict(int)
        self.call_times = defaultdict(float)
        self.call_stack = []
        self.max_depth = 0

    def profile(self, func):
        """Decorator to profile a function"""
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            # Record call
            qualname = func.__qualname__
            self.call_counts[qualname] += 1
            self.call_stack.append(qualname)
            self.max_depth = max(self.max_depth, len(self.call_stack))

            # Inspect the calling frame
            caller_frame = sys._getframe(1)
            caller_name = caller_frame.f_code.co_name

            # Time the call
            start = time.perf_counter_ns()
            try:
                result = func(*args, **kwargs)
                return result
            finally:
                elapsed = time.perf_counter_ns() - start
                self.call_times[qualname] += elapsed / 1_000_000  # ms
                self.call_stack.pop()

        return wrapper

    def report(self):
        print("\n=== Function Profile Report ===")
        print(f"Max call depth: {self.max_depth}")
        print(f"\n{'Function':<30s} {'Calls':>8s} {'Total ms':>10s} {'Avg ms':>10s}")
        print("-" * 62)
        for name in sorted(self.call_counts.keys()):
            calls = self.call_counts[name]
            total = self.call_times[name]
            avg = total / calls
            print(f"{name:<30s} {calls:>8d} {total:>10.3f} {avg:>10.3f}")


# Usage
profiler = FunctionProfiler()

@profiler.profile
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

@profiler.profile
def process_data(data):
    return sorted(data, key=lambda x: -x)

# Run
fibonacci(12)
for _ in range(100):
    process_data([3, 1, 4, 1, 5, 9, 2, 6])

profiler.report()
```

### Complete Example: Custom Scope Inspector

```python
import dis
import types

def analyze_scoping(func):
    """
    Analyze a function's scoping behavior by inspecting
    its bytecode and code object.
    """
    code = func.__code__

    print(f"=== Scope Analysis: {func.__qualname__} ===\n")

    # 1. Variable classification
    print("Variable Classification:")
    print(f"  Locals (co_varnames):    {code.co_varnames}")
    print(f"  Cell vars (co_cellvars): {code.co_cellvars}")
    print(f"  Free vars (co_freevars): {code.co_freevars}")
    print(f"  Names (co_names):        {code.co_names}")

    # 2. Analyze load instructions
    loads = {'LOAD_FAST': [], 'LOAD_DEREF': [], 'LOAD_GLOBAL': [],
             'LOAD_FAST_CHECK': [], 'LOAD_CLOSURE': []}

    for instr in dis.get_instructions(func):
        if instr.opname in loads:
            loads[instr.opname].append(instr.argrepr)

    print("\nName Resolution Methods:")
    for opname, names in loads.items():
        if names:
            unique = sorted(set(names))
            print(f"  {opname:20s}: {', '.join(unique)}")

    # 3. Closure info
    if func.__closure__:
        print(f"\nClosure Cells ({len(func.__closure__)}):")
        for i, cell in enumerate(func.__closure__):
            try:
                val = cell.cell_contents
                print(f"  [{i}] {code.co_freevars[i]} = {val!r}")
            except ValueError:
                print(f"  [{i}] {code.co_freevars[i]} = <empty>")

    # 4. Nested functions
    nested = []
    for const in code.co_consts:
        if isinstance(const, types.CodeType):
            nested.append(const)

    if nested:
        print(f"\nNested Code Objects:")
        for nc in nested:
            print(f"  {nc.co_name}: freevars={nc.co_freevars}, cellvars={nc.co_cellvars}")

    print()

# Test it
x_global = 100

def outer(a, b):
    x = 10
    y = 20

    def middle():
        z = x + y  # x, y are free vars

        def inner():
            return z + x_global  # z is free var, x_global is global

        return inner

    return middle

analyze_scoping(outer)

mid = outer(1, 2)
analyze_scoping(mid)

inn = mid()
analyze_scoping(inn)
```

---

## Cheat Sheet

| Concept | Key Detail |
|---|---|
| `LOAD_FAST` | O(1) array index for locals — fastest lookup |
| `LOAD_DEREF` | O(1) array index + cell dereference for closures |
| `LOAD_GLOBAL` | Dict lookup in globals, then builtins (cached in 3.11+) |
| `CALL` | Unified call opcode (3.12+), with adaptive specialization |
| `MAKE_FUNCTION` | Creates PyFunctionObject from code object + globals |
| Cell object | Shared mutable container enabling closures |
| `co_cellvars` | Variables in this scope captured by nested functions |
| `co_freevars` | Variables in this scope captured from enclosing scope |
| Vectorcall | PEP 590 protocol avoiding tuple/dict creation for args |
| `METH_O` | C calling convention for single-argument builtins (fastest) |
| `METH_FASTCALL` | C calling convention using C array (no tuple) |
| Frame (3.11+) | Allocated on C stack, not heap — much faster creation |
| `sys._getframe()` | Access the live frame object (CPython specific) |
| `dis.dis()` | Disassemble bytecode — your primary debugging tool |

---

## Further Reading

- [CPython Source: ceval.c](https://github.com/python/cpython/blob/main/Python/ceval.c) — The bytecode evaluation loop
- [CPython Source: funcobject.c](https://github.com/python/cpython/blob/main/Objects/funcobject.c) — Function object implementation
- [CPython Source: frameobject.c](https://github.com/python/cpython/blob/main/Objects/frameobject.c) — Frame object implementation
- [PEP 590 – Vectorcall](https://peps.python.org/pep-0590/) — Fast calling protocol
- [PEP 659 – Specializing Adaptive Interpreter](https://peps.python.org/pep-0659/) — Adaptive specialization in 3.11
- [Python Developer Guide: Exploring CPython Internals](https://devguide.python.org/internals/)
- [Inside the Python Virtual Machine](https://leanpub.com/insidethepythonvirtualmachine/) — Deep dive book
- [CPython Internals Book (Real Python)](https://realpython.com/products/cpython-internals-book/)
