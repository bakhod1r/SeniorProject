# Python Basic Syntax — Language Specification

## 1. Spec Reference

- **Primary source:** Python Language Reference, Chapter 2 — Lexical Analysis
  https://docs.python.org/3/reference/lexical_analysis.html
- **Chapter 6** — Expressions: https://docs.python.org/3/reference/expressions.html
- **Chapter 7** — Simple Statements: https://docs.python.org/3/reference/simple_stmts.html
- **Chapter 8** — Compound Statements: https://docs.python.org/3/reference/compound_stmts.html
- **Python 3.12 standard:** All rules here apply to CPython 3.12 unless otherwise noted.

---

## 2. Formal Grammar (EBNF)

The following EBNF is excerpted directly from the Python Language Reference (Python 3.12).

### 2.1 Encoding Declaration
```
encoding_decl ::= "# -*- coding:" encoding_name "*-*"
                | "# coding:" encoding_name
                | "# coding=" encoding_name
encoding_name ::= any combination of letters, digits, hyphens, underscores
```

### 2.2 Physical Lines and Logical Lines
```
physical_line    ::= any sequence of characters ending with a newline (NEWLINE)
logical_line     ::= one or more physical lines joined by line continuation
line_join        ::= "\" NEWLINE
implicit_join    ::= open bracket (  [  { ... close bracket ) ] }
```

### 2.3 Indentation
```
indent_rule ::= INDENT logical_line+ DEDENT
INDENT      ::= increase in indentation level (relative to enclosing block)
DEDENT      ::= decrease in indentation level to a previous level
```

### 2.4 Identifiers
```
identifier  ::= xid_start xid_continue*
xid_start   ::= "_" | Lu | Ll | Lt | Lm | Lo | Nl | Other_ID_Start
xid_continue::= xid_start | Mn | Mc | Nd | Pc | Other_ID_Continue
```
Where Lu, Ll, Lt, Lm, Lo, Nl are Unicode categories (Uppercase/Lowercase/Titlecase/Modifier/Other Letter, Letter Number).

### 2.5 Keywords
```
keyword ::= "False" | "None" | "True" | "and" | "as" | "assert" | "async"
          | "await" | "break" | "class" | "continue" | "def" | "del"
          | "elif" | "else" | "except" | "finally" | "for" | "from"
          | "global" | "if" | "import" | "in" | "is" | "lambda"
          | "nonlocal" | "not" | "or" | "pass" | "raise" | "return"
          | "try" | "while" | "with" | "yield"
```

### 2.6 Soft Keywords (Python 3.10+)
```
soft_keyword ::= "match" | "case" | "type"
```
Soft keywords are only reserved in specific syntactic positions; they may be used as identifiers elsewhere.

### 2.7 Literals
```
literal     ::= stringliteral | bytesliteral | integer | floatnumber | imagnumber
stringliteral ::= [stringprefix] (shortstring | longstring)
stringprefix  ::= "r" | "u" | "R" | "U" | "f" | "F" | "fr" | "Fr" | "fR"
                | "FR" | "rf" | "rF" | "Rf" | "RF" | "b" | "B" | "br"
                | "Br" | "bR" | "BR" | "rb" | "rB" | "Rb" | "RB"
shortstring   ::= "'" shortstringitem* "'" | '"' shortstringitem* '"'
longstring    ::= "'''" longstringitem* "'''" | '"""' longstringitem* '"""'
shortstringitem ::= shortstringchar | stringescapeseq
longstringitem  ::= longstringchar | stringescapeseq
stringescapeseq ::= "\" <any source character>
```

### 2.8 Integer Literals
```
integer      ::= decinteger | bininteger | octinteger | hexinteger
decinteger   ::= nonzerodigit (["_"] digit)* | "0"+ (["_"] "0")*
bininteger   ::= "0" ("b"|"B") (["_"] bindigit)+
octinteger   ::= "0" ("o"|"O") (["_"] octdigit)+
hexinteger   ::= "0" ("x"|"X") (["_"] hexdigit)+
nonzerodigit ::= "1"..."9"
digit        ::= "0"..."9"
bindigit     ::= "0" | "1"
octdigit     ::= "0"..."7"
hexdigit     ::= digit | "a"..."f" | "A"..."F"
```

### 2.9 Float Literals
```
floatnumber  ::= pointfloat | exponentfloat
pointfloat   ::= [digitpart] fraction | digitpart "."
exponentfloat::= (digitpart | pointfloat) exponent
digitpart    ::= digit (["_"] digit)*
fraction     ::= "." digitpart
exponent     ::= ("e"|"E") ["+" | "-"] digitpart
```

### 2.10 Imaginary Literals
```
imagnumber ::= (floatnumber | digitpart) ("j" | "J")
```

### 2.11 Operators and Delimiters
```
operator    ::= "+" | "-" | "*" | "**" | "/" | "//" | "%" | "@"
              | "<<" | ">>" | "&" | "|" | "^" | "~" | ":="
              | "<" | ">" | "<=" | ">=" | "==" | "!="
delimiter   ::= "(" | ")" | "[" | "]" | "{" | "}"
              | "," | ":" | "!" | "." | ";" | "@" | "="
              | "+=" | "-=" | "*=" | "/=" | "//=" | "%=" | "@="
              | "&=" | "|=" | "^=" | ">>=" | "<<=" | "**="
```

### 2.12 Statement Grammar
```
simple_stmt  ::= small_stmt (";" small_stmt)* [";"] NEWLINE
small_stmt   ::= expr_stmt | assert_stmt | pass_stmt | del_stmt
               | return_stmt | raise_stmt | break_stmt | continue_stmt
               | import_stmt | global_stmt | nonlocal_stmt
compound_stmt::= if_stmt | while_stmt | for_stmt | try_stmt | with_stmt
               | funcdef | classdef | async_stmt | match_stmt
```

---

## 3. Core Rules and Constraints

### 3.1 Encoding
- Default source file encoding: **UTF-8** (PEP 3120, Python 3.0+).
- Encoding declaration must appear on line 1 or line 2 if line 1 is a shebang (`#!`).
- If encoding declaration is absent, the file is decoded as UTF-8.
- A BOM (U+FEFF) at the start of a UTF-8 file implicitly declares UTF-8 encoding.

### 3.2 Indentation Rules
- Indentation uses spaces **or** tabs — never both in the same block (raises `TabError`).
- The `INDENT` token is generated when indentation increases; `DEDENT` when it decreases.
- Indentation level must exactly match a previous level on `DEDENT`, otherwise `IndentationError` is raised.
- Consistent indentation is enforced at compile time, not runtime.
- The interactive interpreter uses a special rule: a blank line terminates a compound statement.
- The `-t` and `-tt` flags (Python 2) that warned/errored on mixed tabs/spaces are removed in Python 3 — mixed tabs/spaces always raise `TabError`.

### 3.3 Line Continuation
- **Explicit:** A backslash `\` at the end of a physical line joins it with the next physical line. The resulting logical line must not carry a comment after the `\`.
- **Implicit:** Open brackets `(`, `[`, `{` cause implicit line joining until the matching closing bracket. Comments may appear on any physical line inside an implicit join.
- A logical line can span multiple physical lines via either mechanism.

### 3.4 Blank Lines
- In an interactive session, a blank line terminates a multi-line compound statement.
- In source files, blank lines are ignored except that they separate logical lines and help the parser when indentation-based blocks end.

### 3.5 Comments
- Start with `#` anywhere a `#` is not inside a string literal.
- Extend to the end of the physical line.
- Comments are stripped before tokenization.
- A comment cannot follow an explicit line continuation `\`.

### 3.6 Identifier Normalization
- Python 3 applies NFKC normalization to identifiers. Two identifiers that normalize to the same string are considered the same identifier.
- Identifiers are **case-sensitive**.

### 3.7 Reserved Words
- The 35 keywords listed in section 2.5 cannot be used as identifiers.
- `_` (single underscore) is a legal identifier with special conventions (ignored in `for _ in ...`, interactive result, private by convention, etc.) but is not a keyword.
- Double-underscore names (`__dunder__`) are reserved by the Python implementation.

### 3.8 Statement Termination
- A logical line is a complete statement.
- Multiple statements may appear on one logical line separated by `;`, but this is discouraged by PEP 8.
- Compound statement headers end with `:`.

---

## 4. Type Rules (Dunder Methods and Protocols)

### 4.1 Object Protocol
Every object in Python has:
- `__class__` — reference to its type
- `__dict__` — attribute namespace (not present for slots-only objects)
- `__doc__` — docstring or `None`

### 4.2 String Representation Protocol
```
object.__repr__(self)   -> str   # unambiguous; used by repr() and as fallback for str()
object.__str__(self)    -> str   # human-readable; used by str() and print()
object.__format__(self, format_spec) -> str  # used by format() and f-strings
object.__bytes__(self)  -> bytes # used by bytes()
```

### 4.3 Boolean Protocol
```
object.__bool__(self) -> bool   # called by bool(); if absent, __len__ is tried
object.__len__(self)  -> int    # if non-zero, object is truthy; must return >= 0
```

### 4.4 Identity and Equality
- `is` / `is not` test **object identity** (same `id()`), never call dunders.
- `==` / `!=` call `__eq__` / `__ne__`.
- Default `__eq__` (from `object`) falls back to identity comparison.

### 4.5 Attribute Access Protocol
```
object.__getattribute__(self, name) -> value  # called for every attribute access
object.__getattr__(self, name) -> value       # called only when normal lookup fails
object.__setattr__(self, name, value)
object.__delattr__(self, name)
```

---

## 5. Behavioral Specification

### 5.1 Name Binding and Scopes (LEGB Rule)
Python uses **lexical scoping** with four scope levels:
1. **L**ocal — names bound in the current function body
2. **E**nclosing — names in enclosing function scopes (for nested functions)
3. **G**lobal — names at the module level
4. **B**uilt-in — names in the `builtins` module

Name lookup proceeds L → E → G → B. Assignment in a function creates a local binding unless `global` or `nonlocal` declares otherwise.

### 5.2 Statement Execution Model
- Statements are executed in order from top to bottom within a block.
- A compound statement consists of one or more **clauses**, each with a **header** and a **suite**.
- A suite is either a single simple statement on the same line as the header, or an indented block of statements on subsequent lines.

### 5.3 The `pass` Statement
`pass` is a null operation; execution continues with the next statement. Used as a placeholder where a statement is syntactically required.

### 5.4 The `del` Statement
```python
del target_list
```
- Removes the binding of a name in the current scope (or an item/slice from a container).
- Does **not** necessarily free memory (reference counting handles that).
- After `del name`, the name is unbound; accessing it raises `NameError`.

### 5.5 The `assert` Statement
```python
assert expression [, message]
```
- If `__debug__` is `True` (default) and `expression` is falsy, raises `AssertionError(message)`.
- When Python is run with `-O` (optimize), `assert` statements are **removed** at compile time.
- `assert (expr1, expr2)` is always truthy (non-empty tuple) — a common mistake.

### 5.6 Import System
```python
import_stmt ::= "import" module ("," module)* | "from" relative_module "import" names
```
- `import foo` executes `foo.py` (or `foo/__init__.py`) once and binds the name `foo`.
- `from foo import bar` executes `foo.py` and binds only `bar` in the current namespace.
- `import *` from a module imports all names not starting with `_`, or all names listed in `__all__`.

---

## 6. Defined vs Undefined Behavior

### 6.1 Defined
- Evaluation order of expressions: **left-to-right** (with exceptions for augmented assignment targets).
- Short-circuit evaluation: `and` evaluates right operand only if left is truthy; `or` only if left is falsy.
- Integer division `//` truncates toward negative infinity.
- `divmod(a, b)` is equivalent to `(a // b, a % b)`.

### 6.2 Undefined / Implementation-Defined
- **Evaluation order of function arguments** in CPython: left-to-right, but the spec says "implementation-defined before Python 3.8 for keyword arguments". From Python 3.8 onward, positional and keyword argument values are evaluated left-to-right.
- **`id()` uniqueness:** Two objects with non-overlapping lifetimes may have the same `id()`. The spec guarantees uniqueness only for simultaneously live objects.
- **`__hash__` randomization:** Since Python 3.3, hash values of `str`, `bytes`, and `datetime` objects are randomized by default (PYTHONHASHSEED). Code must not rely on stable hash values across interpreter invocations.
- **Object finalization order:** The order in which objects are finalized at interpreter shutdown is not guaranteed.
- **`__del__` invocation:** CPython uses reference counting so `__del__` is called promptly when refcount reaches 0. PyPy and Jython use garbage collection — `__del__` may be delayed or never called.

---

## 7. Edge Cases from the Spec (CPython-Specific Notes)

### 7.1 Semicolons and Multiple Statements
Multiple statements on one line are legal but PEP 8 discourages them:
```python
x = 1; y = 2; z = 3  # legal but discouraged
```

### 7.2 Trailing Commas
A trailing comma after the last element is legal in all comma-separated sequences (tuples, lists, dicts, function args, imports):
```python
t = (1, 2, 3,)      # legal
f(a, b, c,)          # legal
from os import (path, getcwd,)  # legal
```

### 7.3 Empty Suite
A suite cannot be empty; use `pass`:
```python
if condition:
    pass  # required; an empty suite is a SyntaxError
```

### 7.4 Walrus Operator Scoping
`:=` (walrus) binds in the **enclosing function or module** scope, not in comprehension scope:
```python
results = [y := f(x), y**2, y**3]  # y is bound in enclosing scope
```

### 7.5 Star Expressions
```python
first, *rest = [1, 2, 3, 4]   # rest = [2, 3, 4]
*start, last = [1, 2, 3, 4]   # start = [1, 2, 3]
a, *b, c = [1, 2, 3, 4, 5]    # b = [2, 3, 4]
```
Only one starred expression is allowed per assignment target.

### 7.6 Encoding BOM
A UTF-8 BOM (`\xef\xbb\xbf`) at the start of a file is allowed and treated as a UTF-8 encoding declaration; the BOM character itself is stripped.

### 7.7 Numeric Literal Underscores
```python
x = 1_000_000       # valid (PEP 515, Python 3.6+)
y = 0x_FF_FF        # valid
z = 0b_1010_0101    # valid
# Leading/trailing or consecutive underscores in literals are SyntaxError:
# bad = _1000        # This is an identifier, not a literal
# bad2 = 1__000     # SyntaxError
```

---

## 8. Version History (PEPs and Python Versions)

| Feature | PEP | Version |
|---------|-----|---------|
| UTF-8 default source encoding | PEP 3120 | Python 3.0 |
| `print` becomes a function | PEP 3105 | Python 3.0 |
| Unicode identifiers | PEP 3131 | Python 3.0 |
| `nonlocal` statement | PEP 3104 | Python 3.0 |
| Underscores in numeric literals | PEP 515 | Python 3.6 |
| f-strings | PEP 498 | Python 3.6 |
| Walrus operator `:=` | PEP 572 | Python 3.8 |
| Positional-only parameters `/` | PEP 570 | Python 3.8 |
| `match`/`case` soft keywords | PEP 634 | Python 3.10 |
| `type` statement (type aliases) | PEP 695 | Python 3.12 |
| f-string nesting/multiline | PEP 701 | Python 3.12 |
| Exception groups `except*` | PEP 654 | Python 3.11 |

---

## 9. Implementation-Specific Behavior

### 9.1 CPython
- Reference implementation; behavior described in this document is CPython behavior unless noted.
- Uses reference counting + cyclic garbage collector.
- Small integer cache: integers in range [-5, 256] are pre-allocated singletons; `is` comparison may return `True` unexpectedly for these.
- String interning: short identifier-like strings may be interned; `is` comparison may succeed.
- `.pyc` bytecode cache files are stored in `__pycache__/` with version and platform tags.

### 9.2 PyPy
- JIT-compiled implementation; generally faster for CPU-bound code.
- Tracing JIT: warm-up time before JIT kicks in.
- `id()` values differ from CPython — objects may be moved in memory.
- `__del__` not guaranteed to be called promptly or at all.
- Some CPython C extension modules are incompatible without the `cffi` bridge.

### 9.3 MicroPython
- Targets microcontrollers; subset of Python 3.
- No full `decimal` module, limited `os` module, no `multiprocessing`.
- Integer size may be limited (platform word size).

### 9.4 Jython
- Python on the JVM; largely Python 2 compatible, Python 3 support incomplete.
- Uses Java GC; `__del__` behavior follows Java finalization semantics.

---

## 10. Spec Compliance Checklist

- [ ] Source file is valid UTF-8 (or declares correct encoding)
- [ ] No mixed tabs and spaces in indentation
- [ ] All `DEDENT` levels match a previous `INDENT` level
- [ ] No keywords used as identifiers
- [ ] Backslash continuation does not have trailing whitespace after `\`
- [ ] `assert` uses `assert expr` not `assert(expr1, expr2)` (tuple is always truthy)
- [ ] `-O` flag behavior considered: assert statements are stripped
- [ ] Hash randomization considered: no cross-invocation hash comparisons
- [ ] All star expressions in assignment targets are singular per target list
- [ ] Walrus operator scope understood (enclosing function/module, not comprehension)
- [ ] Numeric literal underscores: no leading, trailing, or consecutive underscores
- [ ] Encoding BOM handled if file uses BOM

---

## 11. Official Examples (Runnable Python 3.10+)

```python
# -------------------------------------------------------
# Encoding declaration (first or second line)
# -*- coding: utf-8 -*-
# -------------------------------------------------------

# 1. Indentation: four spaces per level (PEP 8 recommendation)
def greet(name: str) -> str:
    if name:
        return f"Hello, {name}!"
    else:
        return "Hello, World!"

print(greet("Python"))   # Hello, Python!
print(greet(""))         # Hello, World!


# 2. Line continuation — explicit and implicit
total = (1 + 2 +
         3 + 4 +
         5)              # implicit join via parentheses
print(total)             # 15

long_string = "first part " \
              "second part"   # explicit join
print(long_string)       # first part second part


# 3. Multiple statements (legal, not recommended by PEP 8)
x = 1; y = 2; z = x + y
print(z)   # 3


# 4. Walrus operator
import re
if m := re.search(r"\d+", "abc123def"):
    print(m.group())   # 123


# 5. Star unpacking
first, *middle, last = [10, 20, 30, 40, 50]
print(first, middle, last)   # 10 [20, 30, 40] 50


# 6. Numeric literal underscores (PEP 515)
population = 8_100_000_000
pi_approx  = 3.141_592_653
mask       = 0xFF_FF_FF_FF
print(population, pi_approx, mask)


# 7. assert statement
def divide(a, b):
    assert b != 0, "Divisor must not be zero"
    return a / b

print(divide(10, 2))   # 5.0
# divide(10, 0)        # AssertionError: Divisor must not be zero


# 8. del statement
data = [1, 2, 3]
del data[1]
print(data)   # [1, 3]

name = "Alice"
del name
# print(name)   # NameError: name 'name' is not defined


# 9. f-strings with nested expressions (PEP 701, Python 3.12)
items = [1, 2, 3]
print(f"Sum: {sum(items)}, Max: {max(items)}")   # Sum: 6, Max: 3


# 10. Soft keyword 'match' as identifier (still valid in Python 3.10+)
match = "pattern string"   # 'match' used as identifier — legal outside match stmt
print(match)


# 11. LEGB scoping
x = "global"

def outer():
    x = "enclosing"
    def inner():
        nonlocal x
        x = "modified enclosing"
    inner()
    print(x)   # modified enclosing

outer()
print(x)   # global


# 12. Boolean protocol
class AlwaysFalsy:
    def __bool__(self):
        return False

obj = AlwaysFalsy()
print(bool(obj))   # False
if not obj:
    print("falsy!")   # falsy!
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| §2.1 | Line structure | https://docs.python.org/3/reference/lexical_analysis.html#line-structure |
| §2.3 | Identifiers and keywords | https://docs.python.org/3/reference/lexical_analysis.html#identifiers |
| §2.4 | Literals | https://docs.python.org/3/reference/lexical_analysis.html#literals |
| §2.6 | Tokens | https://docs.python.org/3/reference/lexical_analysis.html#tokens |
| §3.1 | Objects, values, types | https://docs.python.org/3/reference/datamodel.html#objects-values-and-types |
| §3.2 | Standard type hierarchy | https://docs.python.org/3/reference/datamodel.html#the-standard-type-hierarchy |
| §4.1 | Name binding | https://docs.python.org/3/reference/executionmodel.html#naming-and-binding |
| §4.2.2 | Scopes and namespaces | https://docs.python.org/3/reference/executionmodel.html#resolution-of-names |
| §7 | Simple statements | https://docs.python.org/3/reference/simple_stmts.html |
| §8 | Compound statements | https://docs.python.org/3/reference/compound_stmts.html |
| PEP 8 | Style guide | https://peps.python.org/pep-0008/ |
| PEP 572 | Walrus operator | https://peps.python.org/pep-0572/ |
| PEP 695 | Type parameter syntax | https://peps.python.org/pep-0695/ |
| PEP 701 | f-string improvements | https://peps.python.org/pep-0701/ |
