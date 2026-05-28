# Programming Language Syntax — Specification

> **Official / Authoritative Reference**
> Source: [Chomsky (1956) "Three Models for the Description of Language"](https://chomsky.info/1956__01/) — §2–4;
> [Python Language Reference — Full Grammar](https://docs.python.org/3/reference/grammar.html) — §Full Grammar Specification;
> [NIST DADS — Formal Language](https://xlinux.nist.gov/dads/HTML/formallanguage.html)

---

## Table of Contents

1. [Reference](#1-reference)
2. [Formal Definition / Grammar](#2-formal-definition-grammar)
3. [Core Rules & Constraints](#3-core-rules-constraints)
4. [Type / Category Rules (Chomsky Hierarchy)](#4-type-category-rules-chomsky-hierarchy)
5. [Behavioral Specification](#5-behavioral-specification)
6. [Defined vs Undefined Behavior](#6-defined-vs-undefined-behavior)
7. [Edge Cases](#7-edge-cases)
8. [Version / Evolution History](#8-version-evolution-history)
9. [Implementation Notes](#9-implementation-notes)
10. [Compliance Checklist](#10-compliance-checklist)
11. [Official Examples](#11-official-examples)
12. [Related Topics](#12-related-topics)

---

## 1. Reference

| Attribute       | Value                                                                              |
|-----------------|------------------------------------------------------------------------------------|
| Formal Name     | Formal Grammar / Context-Free Grammar (CFG)                                        |
| Standard        | Chomsky Hierarchy (1956, 1959); ISO/IEC 14977 (EBNF Standard, 1996)               |
| Primary Source  | Chomsky, N. (1956). "Three Models for the Description of Language." IRE Trans.     |
| Secondary       | Backus, J. (1959). "The syntax and semantics of the proposed international language"|
| Python Ref      | https://docs.python.org/3/reference/grammar.html                                   |
| NIST DADS       | https://xlinux.nist.gov/dads/HTML/formallanguage.html                              |

A **formal language** is a set of strings over a finite alphabet Σ. A **grammar** G is a 4-tuple:

```
G = (V, Σ, R, S)
```

Where:
- **V** — finite set of **non-terminal** symbols (variables)
- **Σ** — finite set of **terminal** symbols (alphabet), V ∩ Σ = ∅
- **R** — finite set of **production rules** of the form α → β, where α ∈ (V ∪ Σ)⁺ and β ∈ (V ∪ Σ)*
- **S** — start symbol, S ∈ V

The **language generated** by G:
```
L(G) = { w ∈ Σ* | S ⟹* w }
```
where ⟹* denotes zero or more derivation steps.

---

## 2. Formal Definition / Grammar

### 2.1 BNF (Backus-Naur Form)

BNF was introduced by John Backus to describe ALGOL 58/60. Notation:

```
<symbol>  ::= <expression1> | <expression2>
```

- `<symbol>` — non-terminal enclosed in angle brackets
- `::=`       — "is defined as"
- `|`         — alternative (OR)
- Terminals   — literal characters/tokens written without angle brackets

**BNF for a simple arithmetic expression:**

```bnf
<expr>   ::= <expr> "+" <term>
           | <expr> "-" <term>
           | <term>

<term>   ::= <term> "*" <factor>
           | <term> "/" <factor>
           | <factor>

<factor> ::= "(" <expr> ")"
           | <number>

<number> ::= <digit>
           | <number> <digit>

<digit>  ::= "0" | "1" | "2" | "3" | "4"
           | "5" | "6" | "7" | "8" | "9"
```

### 2.2 EBNF (Extended BNF — ISO/IEC 14977:1996)

EBNF extends BNF with shorthand notations to eliminate explicit recursion:

| Notation   | Meaning                          | BNF Equivalent              |
|------------|----------------------------------|-----------------------------|
| `{x}`      | Zero or more repetitions of x    | x* (Kleene star)            |
| `[x]`      | Optional x (zero or one)         | x? (Kleene question)        |
| `(a | b)`  | Grouping with alternatives       | —                           |
| `"text"`   | Terminal string literal          | Same in BNF                 |
| `,`        | Concatenation                    | Juxtaposition in BNF        |
| `;`        | Rule terminator                  | Newline in BNF              |

**EBNF for arithmetic expression (equivalent to BNF above):**

```ebnf
expr    = term { ("+" | "-") term } ;
term    = factor { ("*" | "/") factor } ;
factor  = "(" expr ")" | number ;
number  = digit { digit } ;
digit   = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;
```

### 2.3 Python Grammar (Official — CPython 3.12)

From https://docs.python.org/3/reference/grammar.html (PEG grammar format):

```peg
if_stmt:
    | 'if' named_expr ':' block elif_stmt
    | 'if' named_expr ':' block [else_block]

elif_stmt:
    | 'elif' named_expr ':' block elif_stmt
    | 'elif' named_expr ':' block [else_block]

else_block: 'else' ':' block

while_stmt:
    | 'while' named_expr ':' block [else_block]

for_stmt:
    | 'for' star_targets 'in' ~ star_expressions ':' [TYPE_COMMENT] block [else_block]

funcdef:
    | decorators 'def' NAME '(' [params] ')' ['->' expression] ':' [func_type_comment] block

classdef:
    | decorators 'class' NAME ['(' [arguments] ')'] ':' block
```

---

## 3. Core Rules & Constraints

### 3.1 Terminals vs Non-Terminals

| Concept         | Definition                                                          | Example              |
|-----------------|----------------------------------------------------------------------|----------------------|
| **Terminal**    | Atomic symbol of the alphabet; appears in final string              | `"if"`, `"+"`, digit |
| **Non-terminal**| Variable representing a syntactic category; must be expanded        | `<expr>`, `<stmt>`   |
| **Start Symbol**| The non-terminal from which all derivations begin                   | `<program>`          |
| **Sentential Form** | Any string derivable from S using zero or more production rules | `<expr> + 3`         |

### 3.2 Derivation

A **derivation** is a sequence of sentential forms:

```
S ⟹ α₁ ⟹ α₂ ⟹ ... ⟹ w
```

- **Leftmost derivation**: At each step, replace the leftmost non-terminal.
- **Rightmost derivation**: At each step, replace the rightmost non-terminal.
- These produce different parse trees for ambiguous grammars.

**Example — leftmost derivation of `3 + 4 * 2`:**

```
<expr>
⟹ <expr> "+" <term>               [expr → expr "+" term]
⟹ <term> "+" <term>               [expr → term]
⟹ <factor> "+" <term>             [term → factor]
⟹ <number> "+" <term>             [factor → number]
⟹ "3" "+" <term>                  [number → digit → "3"]
⟹ "3" "+" <term> "*" <factor>     [term → term "*" factor]
⟹ "3" "+" <factor> "*" <factor>   [term → factor]
⟹ "3" "+" "4" "*" "2"             [...]
```

### 3.3 Parse Tree vs Abstract Syntax Tree (AST)

| Property        | Parse Tree                            | AST                                  |
|-----------------|---------------------------------------|--------------------------------------|
| Content         | Includes every grammar symbol         | Compresses away non-essential nodes  |
| Size            | Larger, follows grammar exactly       | Smaller, captures semantics          |
| Terminals       | All terminals present as leaves       | Only semantically relevant ones      |
| Use             | Grammar validation                    | Compilation, interpretation          |

**Parse tree for `3 + 4`:**

```
        <expr>
       /   |   \
  <expr>  "+"  <term>
     |              |
  <term>         <factor>
     |              |
  <factor>       <number>
     |              |
  <number>        "4"
     |
    "3"
```

**AST for `3 + 4`:**

```
    (+)
   /   \
  3     4
```

---

## 4. Type / Category Rules (Chomsky Hierarchy)

Chomsky (1959) classified grammars into four nested classes:

```
Type 3  ⊂  Type 2  ⊂  Type 1  ⊂  Type 0
Regular ⊂  CFG     ⊂  CSG     ⊂  Unrestricted
```

### Type 0 — Unrestricted Grammar
- **Production rules**: α → β, where α ∈ (V ∪ Σ)⁺ (no restriction)
- **Recognized by**: Turing Machine
- **Language class**: Recursively enumerable languages
- **Example**: Post correspondence problem

### Type 1 — Context-Sensitive Grammar (CSG)
- **Production rules**: αAβ → αγβ, where |γ| ≥ 1 (A can only be replaced in context of α, β)
- **Recognized by**: Linear-bounded automaton
- **Language class**: Context-sensitive languages
- **Example**: `{aⁿbⁿcⁿ | n ≥ 1}`

### Type 2 — Context-Free Grammar (CFG)
- **Production rules**: A → β, where A ∈ V, β ∈ (V ∪ Σ)*
- **Recognized by**: Pushdown automaton (PDA)
- **Language class**: Context-free languages
- **Most programming languages use CFG for syntax**
- **Example**: `{aⁿbⁿ | n ≥ 0}`, arithmetic expressions, Python syntax

### Type 3 — Regular Grammar
- **Production rules**: A → aB or A → a (right-linear), or A → Ba or A → a (left-linear)
- **Recognized by**: Finite automaton (DFA/NFA)
- **Language class**: Regular languages
- **Use**: Lexical analysis (tokenization/scanning)
- **Example**: Identifiers `[a-zA-Z_][a-zA-Z0-9_]*`, string literals

| Type | Grammar       | Automaton              | Language Class         | Closure under ∪ ∩ · * |
|------|---------------|------------------------|------------------------|------------------------|
| 0    | Unrestricted  | Turing Machine         | Recursively enumerable | Partial                |
| 1    | Context-Sens. | Linear-bounded         | Context-sensitive      | Yes (∪, ·, *)          |
| 2    | Context-Free  | Pushdown automaton     | Context-free           | Yes (∪, ·, *)          |
| 3    | Regular       | Finite automaton       | Regular                | Yes (all)              |

---

## 5. Behavioral Specification

### 5.1 Scanning (Lexical Analysis)

The **lexer** (scanner) converts source text into a token stream:

```
Source code  →  [Lexer]  →  Token stream  →  [Parser]  →  Parse tree / AST
```

- Uses **regular grammar** (Type 3) / regular expressions
- Recognizes: keywords, identifiers, literals, operators, delimiters
- Discards: whitespace, comments (context-dependent)

**Python tokenization — token types (from `tokenize` module):**

```python
import tokenize, io

code = "x = 3 + 4"
tokens = list(tokenize.generate_tokens(io.StringIO(code).readline))
# Output:
# TokenInfo(type=1 (NAME), string='x', ...)
# TokenInfo(type=54 (OP), string='=', ...)
# TokenInfo(type=2 (NUMBER), string='3', ...)
# TokenInfo(type=54 (OP), string='+', ...)
# TokenInfo(type=2 (NUMBER), string='4', ...)
```

### 5.2 Parsing

**Parsing** determines whether a token stream conforms to a grammar and builds a parse tree.

#### LL(k) Parsing (Top-Down)
- Reads input **Left-to-right**, builds **Leftmost** derivation, k tokens of lookahead
- **LL(1)**: Uses a predictive parsing table; each entry (non-terminal, terminal) → unique rule
- **Condition**: Grammar must have no left recursion and must be left-factored
- **First(A)**: set of terminals that begin strings derivable from A
- **Follow(A)**: set of terminals that can appear after A in a sentential form

```
Predictive parse table M[A, a]:
  If a ∈ First(α), add A → α to M[A, a]
  If ε ∈ First(α) and a ∈ Follow(A), add A → α to M[A, a]
```

#### LR(k) Parsing (Bottom-Up)
- Reads input **Left-to-right**, builds **Rightmost** derivation in reverse, k tokens of lookahead
- **LR(0), SLR(1), LALR(1), LR(1)** — increasing power
- **LALR(1)**: Used by yacc/bison; most practical balance of power and table size
- **LR(1)**: Most powerful; used by some modern parsers

| Parser   | Table Size | Power         | Used by              |
|----------|-----------|---------------|----------------------|
| LL(1)    | O(|V|×|Σ|) | Less powerful | Recursive descent, ANTLR |
| SLR(1)   | Compact    | Moderate      | Teaching parsers     |
| LALR(1)  | Compact    | High          | yacc, bison, Ruby    |
| LR(1)    | Large      | Most powerful | Some production parsers |
| PEG      | O(n×|G|)   | Ordered choice | Python 3.9+ (PEG parser) |

### 5.3 Ambiguous Grammars

A grammar G is **ambiguous** if there exists a string w ∈ L(G) with two or more distinct parse trees.

**Ambiguous grammar example (dangling else):**

```bnf
<stmt> ::= "if" <expr> "then" <stmt>
         | "if" <expr> "then" <stmt> "else" <stmt>
         | <other>
```

For `if E1 then if E2 then S1 else S2`, both parse trees are valid:
- Tree 1: else matches outer if
- Tree 2: else matches inner if (conventional resolution)

**Resolution**: Most languages define that `else` binds to the nearest unmatched `if` (rule-based disambiguation), or restructure the grammar to be unambiguous.

---

## 6. Defined vs Undefined Behavior

| Category                | Status    | Notes                                                            |
|-------------------------|-----------|------------------------------------------------------------------|
| Well-formed sentence    | Defined   | String w ∈ L(G) — grammar accepts it                            |
| Ill-formed sentence     | Defined   | String w ∉ L(G) — syntax error, rejected by parser              |
| Ambiguous parse         | Defined*  | Grammar is ambiguous; behavior depends on parser disambiguation  |
| Left-recursive LL parse | Undefined | LL parsers loop infinitely on left-recursive rules               |
| Empty string ε          | Defined   | May or may not be in L(G); depends on whether S ⟹* ε            |
| Right-recursive depth   | Impl-def  | Stack depth limited by implementation                            |

---

## 7. Edge Cases

### 7.1 Left Recursion (LL Parsers)

**Problem**: Rule `<expr> ::= <expr> "+" <term>` causes infinite loop in LL parsers.

**Elimination via left-factoring:**
```
Original:   A → A α | β

Transformed:
  A  → β A'
  A' → α A' | ε
```

**Applied to arithmetic:**
```
Before:   expr → expr "+" term | term
After:    expr  → term expr'
          expr' → "+" term expr' | ε
```

### 7.2 Empty Productions (ε-rules)

A production `A → ε` means A can derive the empty string.
- Increases expressiveness (optional constructs)
- Complicates LL(1) table construction (requires Follow sets)
- **Nullable**: non-terminal A is nullable if A ⟹* ε

### 7.3 Chomsky Normal Form (CNF)

Every CFG can be converted to **Chomsky Normal Form**:
- All rules of the form: `A → BC` or `A → a`
- Required by **CYK algorithm** (O(n³) parsing for any CFG)

### 7.4 Operator Precedence and Associativity

Grammar encodes precedence through rule hierarchy:
```
<expr>   → <expr> "+" <term>    [lowest precedence, left-assoc]
<term>   → <term> "*" <factor>  [higher precedence, left-assoc]
<factor> → "(" <expr> ")" | NUM [highest precedence]
```

Precedence: `*` > `+`; Associativity: left-to-right for both.

---

## 8. Version / Evolution History

| Year | Event                                                                           |
|------|---------------------------------------------------------------------------------|
| 1956 | Chomsky publishes "Three Models" — introduces the grammar hierarchy             |
| 1959 | Backus introduces BNF to describe ALGOL 58; Chomsky formalizes grammar types    |
| 1960 | ALGOL 60 report by Naur — first use of BNF in a language standard               |
| 1969 | Knuth introduces LR(k) parsing                                                  |
| 1977 | Johnson writes yacc (yet another compiler-compiler) using LALR(1)               |
| 1996 | ISO/IEC 14977 standardizes EBNF                                                 |
| 2002 | Ford introduces PEG (Parsing Expression Grammars) — ordered choice, no ambiguity|
| 2004 | ANTLR v3 — LL(*) parser generator                                               |
| 2020 | CPython switches from LL(1) to PEG parser (Python 3.9, PEP 617)                 |
| 2022 | ANTLR v4 — Adaptive LL(*) parsing                                               |

---

## 9. Implementation Notes

### 9.1 Recursive Descent Parser

A direct implementation of an LL grammar — one function per non-terminal:

```python
# Recursive descent parser for: expr → term { ("+" | "-") term }
class Parser:
    def __init__(self, tokens):
        self.tokens = tokens
        self.pos = 0

    def current(self):
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def consume(self, expected=None):
        tok = self.current()
        if expected and tok != expected:
            raise SyntaxError(f"Expected {expected}, got {tok}")
        self.pos += 1
        return tok

    def parse_expr(self):
        """expr → term { ('+' | '-') term }"""
        left = self.parse_term()
        while self.current() in ('+', '-'):
            op = self.consume()
            right = self.parse_term()
            left = (op, left, right)   # AST node
        return left

    def parse_term(self):
        """term → factor { ('*' | '/') factor }"""
        left = self.parse_factor()
        while self.current() in ('*', '/'):
            op = self.consume()
            right = self.parse_factor()
            left = (op, left, right)
        return left

    def parse_factor(self):
        """factor → '(' expr ')' | NUMBER"""
        tok = self.current()
        if tok == '(':
            self.consume('(')
            node = self.parse_expr()
            self.consume(')')
            return node
        elif tok is not None and tok.isdigit():
            return int(self.consume())
        else:
            raise SyntaxError(f"Unexpected token: {tok}")
```

### 9.2 Python `ast` Module (Standard Library)

```python
import ast

source = "x = 3 + 4 * 2"
tree = ast.parse(source)
print(ast.dump(tree, indent=2))
# Module(
#   body=[
#     Assign(
#       targets=[Name(id='x', ctx=Store())],
#       value=BinOp(
#         left=Constant(value=3),
#         op=Add(),
#         right=BinOp(
#           left=Constant(value=4),
#           op=Mult(),
#           right=Constant(value=2))))],
#   type_ignores=[])
```

### 9.3 Time/Space Complexity of Parsing Algorithms

| Algorithm         | Time       | Space      | Notes                            |
|-------------------|-----------|-----------|----------------------------------|
| Recursive descent | O(n)      | O(n)      | For LL(1) grammars               |
| LL(1) table       | O(n)      | O(|G|)    | Table-driven predictive parsing  |
| LALR(1)           | O(n)      | O(|G|²)   | yacc/bison; linear in input size |
| Earley            | O(n³)     | O(n²)     | Any CFG; O(n²) for unambiguous   |
| CYK               | O(n³|G|)  | O(n²|V|)  | CNF required; all CFGs           |
| PEG (packrat)     | O(n·|G|)  | O(n·|G|)  | Memoized; linear but high memory |

---

## 10. Compliance Checklist

- [ ] Grammar is formally specified as G = (V, Σ, R, S)
- [ ] All non-terminals appear on the left-hand side of at least one rule
- [ ] All non-terminals are reachable from the start symbol S
- [ ] No unreachable productions exist
- [ ] No left recursion exists (for LL parsers)
- [ ] Grammar is unambiguous (or disambiguation rules are specified)
- [ ] First and Follow sets are computable (no circular ε-dependencies)
- [ ] Lexer (Type 3) and parser (Type 2) layers are separated
- [ ] Operator precedence and associativity are explicitly encoded in grammar
- [ ] AST node types are documented with field names and types
- [ ] Parser handles all edge cases: empty input, single token, deeply nested expressions
- [ ] Error recovery strategy is defined (panic mode, phrase-level, etc.)

---

## 11. Official Examples

### 11.1 Python `if` Statement — Full Grammar (PEG, Python 3.12)

```peg
if_stmt[stmt_ty]:
    | a='if' b=named_expr ':' c=block d=elif_stmt {
        _PyAST_If(b, c, CHECK(asdl_stmt_seq*, _PyPegen_singleton_seq(p, d)), EXTRA) }
    | a='if' b=named_expr ':' c=block d=[else_block] {
        _PyAST_If(b, c, d, EXTRA) }
```

### 11.2 Java — Simple Grammar Fragment (JLS §19)

```bnf
ClassDeclaration ::= NormalClassDeclaration | EnumDeclaration

NormalClassDeclaration ::=
    {ClassModifier} "class" TypeIdentifier [TypeParameters]
    [Superclass] [Superinterfaces] ClassBody

MethodDeclaration ::=
    {MethodModifier} MethodHeader MethodBody

MethodHeader ::=
    Result MethodDeclarator [Throws]
  | TypeParameters {Annotation} Result MethodDeclarator [Throws]
```

### 11.3 Simple Expression — Complete Parse Table (LL(1))

Grammar (left-recursion eliminated):
```
E  → T E'
E' → + T E' | ε
T  → F T'
T' → * F T' | ε
F  → ( E ) | id
```

Parse table M[A, a]:

| NT  | id      | +        | *        | (       | )   | $   |
|-----|---------|----------|----------|---------|-----|-----|
| E   | E→TE'   | —        | —        | E→TE'   | —   | —   |
| E'  | —       | E'→+TE'  | —        | —       | E'→ε| E'→ε|
| T   | T→FT'   | —        | —        | T→FT'   | —   | —   |
| T'  | —       | T'→ε     | T'→*FT'  | —       | T'→ε| T'→ε|
| F   | F→id    | —        | —        | F→(E)   | —   | —   |

---

## 12. Related Topics

| Topic                    | Relationship                                                   | Where to Study           |
|--------------------------|----------------------------------------------------------------|--------------------------|
| Regular Expressions      | Type 3 grammar; used in lexical analysis                       | `re` module docs         |
| Finite Automata (DFA/NFA)| Recognize regular languages; automaton for Type 3 grammars    | NIST DADS                |
| Pushdown Automata         | Recognize context-free languages; automaton for Type 2 grammars| Sipser — Theory of Computation |
| AST / CST                | Output of parsing; used by compilers and interpreters          | CPython `ast` module     |
| Compilers                | Full pipeline: scan → parse → semantic analysis → codegen      | Aho et al. "Dragon Book" |
| Pseudocode               | Informal language with defined syntactic conventions           | `../02-pseudo-code/`     |
| Control Structures       | Syntactic categories in most grammars                          | `../03-control-structures/` |
| Type Systems             | Semantic layer on top of syntax                                | Pierce "Types and Programming Languages" |
