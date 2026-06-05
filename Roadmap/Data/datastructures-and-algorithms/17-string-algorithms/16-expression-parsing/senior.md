# Expression Parsing & Evaluation — Senior Level

> A toy calculator parses `3 + 4 * 2`; a production expression engine parses untrusted formulas from spreadsheet cells, alert rules, query filters, and config files — at scale, with variables and functions, with error messages a human can act on, and **without becoming a remote-code-execution hole**. At this level the parser algorithm is the easy part; the hard parts are extensibility, robust error reporting and recovery, security, performance, and testing.

## Table of Contents
1. [Introduction](#1-introduction)
2. [Pratt Parsing / Precedence Climbing](#2-pratt-parsing--precedence-climbing)
3. [Extensibility: Functions, Variables, and Operators](#3-extensibility-functions-variables-and-operators)
4. [Robust Error Reporting and Recovery](#4-robust-error-reporting-and-recovery)
5. [Security: Never `eval` Untrusted Input](#5-security-never-eval-untrusted-input)
6. [Performance Engineering](#6-performance-engineering)
7. [Code Examples](#7-code-examples)
8. [Testing Strategy](#8-testing-strategy)
9. [Failure Modes](#9-failure-modes)
10. [Summary](#10-summary)

---

## 1. Introduction

A production expression evaluator typically lives in one of these shapes:

1. **Formula engine** — spreadsheet cells, low-code rule builders, pricing rules. Expressions reference named cells/variables and call functions (`SUM`, `IF`, `ROUND`).
2. **Filter / query DSL** — `status == "open" && age > 30`. Boolean and comparison operators join the arithmetic ones.
3. **Configurable thresholds** — alerting/monitoring rules `cpu > 0.9 || mem > 0.8` evaluated per data point, millions of times.

All of them want the same core: a parser that handles precedence/associativity, an extensible operator/function set, an evaluator over an environment of variables, precise errors, and a hard security boundary. The senior decisions are: **which parser** (recursive descent, Shunting-yard, or Pratt), **how to extend it** without rewriting, **how to fail safely and informatively**, and **how to keep untrusted input from executing code**.

---

## 2. Pratt Parsing / Precedence Climbing

Recursive descent's weakness is the long rule chain `expr → term → power → unary → primary`: every new precedence level adds a rule. With ten operators that chain is unwieldy. **Pratt parsing** (top-down operator precedence) and the closely related **precedence climbing** keep recursive descent's clarity but make precedence **data-driven**.

### 2.1 The precedence-climbing core

A single recursive function `parseExpr(minPrec)` parses an expression whose operators all have precedence `>= minPrec`:

```
parseExpr(minPrec):
    left = parseAtom()                      # number, unary, or ( expr )
    while next is a binary operator op with prec(op) >= minPrec:
        consume op
        nextMin = prec(op) + (1 if left-assoc else 0)
        right = parseExpr(nextMin)          # recurse with raised minimum
        left = makeNode(op, left, right)    # or apply(op, left, right)
    return left
```

The trick is `nextMin`: for a **left-associative** operator we recurse with `prec+1`, so an operator of *equal* precedence on the right does not get swallowed into the right operand (it stays for the loop, giving left grouping). For a **right-associative** operator we recurse with the same `prec`, so equal-precedence operators *do* nest on the right. This one `+1`/`+0` choice replaces the entire `>=`-vs-`>` Shunting-yard subtlety.

### 2.2 Pratt parsing (null/left denotations)

Pratt generalizes further: each token has a **prefix handler** (`nud`, "null denotation" — numbers, unary operators, `(`) and an **infix handler** (`led`, "left denotation" — binary operators) plus a **binding power**. The main loop calls the prefix handler, then repeatedly calls infix handlers while the next token's binding power exceeds the current minimum. Adding a new operator is registering a handler and a binding power — **no grammar rewrite**. This is why Pratt parsing powers many real language front-ends (e.g. parts of `JSLint`, Go's `go/parser` uses a precedence-climbing variant, many scripting languages).

### 2.3 A precedence-climbing trace

To see why the `+1`/`+0` choice works, trace `parseExpr(0)` on `2 + 3 * 4 - 1` (all left-associative, `prec(+)=prec(-)=1`, `prec(*)=2`):

```
parseExpr(0)
  left = 2
  see '+' (prec 1 >= 0): consume; right = parseExpr(2)   # 1+1, raised minimum
     parseExpr(2): left = 3
       see '*' (prec 2 >= 2): consume; right = parseExpr(3)
          parseExpr(3): left = 4; see '-' (prec 1 < 3) → return 4
       left = 3*4 = 12; see '-' (prec 1 < 2) → return 12
  left = 2 + 12 = 14
  see '-' (prec 1 >= 0): consume; right = parseExpr(2)
     parseExpr(2): left = 1; eof → return 1
  left = 14 - 1 = 13
return 13
```

The raised minimum `parseExpr(2)` after `+` is what stops the inner call from swallowing the trailing `-` into the right operand of `+`; the `-` bubbles back up and is handled left-to-right by the outer loop, giving left-associativity `((2 + 3*4) - 1)`. For a right-associative operator we would recurse with the *same* minimum, letting an equal-precedence operator nest on the right instead.

### 2.4 Equivalence

Precedence climbing, Pratt parsing, and Shunting-yard compute the **same parse** for the same operator table — they are different control structures over identical precedence/associativity data. Choose by ergonomics: Shunting-yard if you want an iterative, stack-only evaluator; precedence climbing/Pratt if you want a recursive AST builder that scales to many operators. `professional.md` proves this equivalence (Theorem 9.1).

---

## 3. Extensibility: Functions, Variables, and Operators

### 3.1 Variables

A variable is an identifier token resolved against an **environment** (a `map[string]float64` or richer value type) at evaluation time. Parsing produces an `Identifier` node; evaluation looks it up and errors on "undefined variable: x". Keeping resolution at *eval* time (not parse time) lets you parse once and evaluate many times with different bindings — the key reason to build an AST.

### 3.2 Functions

A function call `name ( arg1 , arg2 , … )` extends the grammar's `primary`:

```
primary = NUMBER | IDENT | IDENT "(" [ args ] ")" | "(" expr ")"
args    = expr { "," expr }
```

When `primary` sees an identifier followed by `(`, it parses a comma-separated argument list and builds a `Call(name, args)` node. Evaluation looks the function up in a **registry** (`map[string]func([]float64) float64`), checks arity, and applies it. The registry is the extension point: add `sqrt`, `min`, `max`, `if` without touching the parser.

In Shunting-yard, functions are handled by pushing the function token onto the operator stack like a high-precedence operator, treating `,` as a separator that flushes operators back to the `(`, and emitting the function when its `)` is reached.

### 3.3 Custom operators and precedence

With Pratt/precedence climbing, a new operator (say `%` modulo, or `**` power, or `&&`) is a registry entry: a binding power and an evaluation rule. This is the extensibility payoff over the fixed `expr/term/factor` chain. Keep the operator table as **data** so it can be validated, documented, and even configured.

### 3.4 Extending to a comparison / boolean DSL

Filter and rule languages need comparisons and boolean combinators on top of arithmetic. The clean way is to add **lower** precedence levels below `+ -`:

```
binding powers (low → high):
   ||            1
   &&            2
   == != < <= > >=   3
   + -          4
   * /          5
   ^            7 (right)
   unary - !    6
```

Because `||` and `&&` are lowest, an expression like `a + 1 > b && c == 0` parses as `((a+1) > b) && (c == 0)` — arithmetic binds tighter than comparison, which binds tighter than boolean. The evaluator's carrier becomes a small tagged value (number or boolean); each operator validates operand types and the result type. This is still one `parseExpr(minPrec)` function plus a wider binding-power table — no structural change. Short-circuit semantics for `&&`/`||` are implemented by evaluating the right operand lazily (only when needed), which the AST form makes natural: the node holds unevaluated subtrees.

### 3.5 Right-associative and prefix entries

The binding-power table also encodes associativity and prefix forms uniformly:

- **Right-associative** (`^`, assignment `=` in some DSLs): the infix handler recurses with the operator's own binding power, not `+1`.
- **Prefix** (unary `-`, logical `!`): registered as a `nud` with its own binding power; `-2^2` parsing depends on whether unary binds tighter or looser than `^` — a policy you must declare and test (`-2^2` is `-(2^2) = -4` in most languages, meaning unary `-` is *looser* than `^`).

---

## 4. Robust Error Reporting and Recovery

### 4.1 Carry positions through tokens

Tokens must carry their **source offset** (and ideally line/column). Then every error is anchored: "unexpected `)` at column 9". A token that is just a string loses this; a token struct `{kind, text, start, end}` keeps it. This single decision is the difference between "syntax error" and an actionable message.

### 4.2 Classify failures

| Phase | Error class | Example | Message should say |
|-------|-------------|---------|--------------------|
| Lexing | illegal character | `3 @ 4` | "unexpected character `@` at col 3" |
| Parsing | unexpected token | `3 + * 4` | "expected operand, found `*` at col 5" |
| Parsing | unbalanced parens | `(1 + 2` | "missing `)` to match `(` at col 1" |
| Parsing | trailing input | `1 + 2 3` | "unexpected `3` after expression at col 7" |
| Eval | undefined name | `x + 1` (no `x`) | "undefined variable `x`" |
| Eval | arity mismatch | `sqrt(1, 2)` | "`sqrt` expects 1 argument, got 2" |
| Eval | domain/zero | `1 / 0`, `sqrt(-1)` | "division by zero" / "sqrt of negative" |

Separating **lex / parse / eval** errors makes them testable and lets the UI react differently (syntax highlight vs runtime warning).

### 4.3 Error recovery

Interactive editors want to report **multiple** errors, not stop at the first. Techniques:

- **Panic-mode recovery:** on a parse error, skip tokens until a synchronizing token (`)`, `,`, end), record the error, and continue. You get several diagnostics per parse.
- **Insertion/deletion repair:** assume the most likely missing token (e.g. a missing `)`), report it, and continue parsing as if it were present.

For a batch evaluator, fail fast with one precise error; for an IDE-like surface, recover and collect.

---

## 5. Security: Never `eval` Untrusted Input

The single most important senior rule: **do not pass untrusted expression strings to your language's `eval`.** `eval("__import__('os').system('rm -rf /')")` is a real attack. The whole point of writing a parser is to define a **closed, safe language** that can *only* do arithmetic over a controlled function/variable set.

Concrete guidance:

- **No host `eval`.** Implement the evaluator yourself (AST walk or RPN). It can only perform the operations you coded.
- **Whitelist functions and variables.** The function registry and the environment are the *only* capabilities. There is no path to the filesystem, network, or reflection.
- **Bound resource use.** Cap expression length, token count, parenthesis nesting depth (to prevent stack-overflow DoS), and numeric magnitude/iteration in any function. `9^9^9^9` should be rejected or capped, not allowed to hang or overflow.
- **Bound recursion.** A deeply nested `((((((…))))))` can blow a recursive-descent stack. Either convert to an explicit stack, or enforce a max-depth limit and return a clean error.
- **Sandbox side effects.** Functions in the registry must be pure (or carefully audited). Never register a function that reads files, makes network calls, or mutates global state unless that is an explicit, reviewed capability.
- **Validate numeric edge cases.** Decide policy for division by zero, overflow, NaN/Inf, and very large exponents — and apply it uniformly.

A correctly built expression evaluator is a **capability sandbox**: untrusted users can express arithmetic over a fixed vocabulary and *nothing else*.

---

## 6. Performance Engineering

### 6.1 Parse once, evaluate many

If the same formula is evaluated repeatedly (spreadsheet recalculation, per-row filtering, per-data-point alerting), **parse to an AST or to RPN once**, cache it keyed by the formula string, and re-evaluate against changing variables. Re-tokenizing and re-parsing per evaluation is the most common performance regression.

### 6.2 Compile to a flat form

For hot loops, an AST walk has pointer-chasing and virtual-dispatch overhead. Faster targets:

- **RPN / bytecode array:** flatten the AST to a postfix instruction list and evaluate with a value stack. Cache-friendly, branch-predictable.
- **Closure compilation:** compile each node to a Go/Java closure / Python function that takes the environment and returns a value; composing them removes per-eval interpretation overhead.

### 6.3 Avoid per-token allocation

Represent tokens as `{kind enum, numericValue, startOffset}` rather than freshly allocated substrings. Intern identifier names. Reuse the value-stack buffer across evaluations.

### 6.4 Constant folding

At parse time, fold subtrees with only literal children (`2 * 3` → `6`). For formulas evaluated millions of times this removes work permanently. A simple post-parse pass: walk the AST bottom-up; if a node's children are all literals, evaluate it and replace the node with a literal. This is sound because evaluation of a closed subterm is environment-independent (the homomorphism argument in `professional.md`, Section 14).

### 6.5 Measuring before optimizing

Before reaching for bytecode compilation, profile. For many real workloads the dominant cost is *tokenizing*, not evaluation, because formulas are short and re-tokenized per call. The single highest-leverage change is almost always **caching the parsed form** (Section 6.1); flattening and closure compilation matter only once parsing is already cached and the AST walk itself is the bottleneck (tight inner loops over millions of rows). Order of attack: cache parse → constant-fold → flatten to RPN/bytecode → SIMD/batch only if a profiler proves the AST walk dominates.

---

## 7. Code Examples

### 7.1 Go — precedence-climbing evaluator with variables and functions

```go
package main

import (
	"fmt"
	"math"
	"strconv"
)

type Token struct {
	kind string // "num","ident","op","(",")",","
	text string
	pos  int
}

type Env struct {
	vars  map[string]float64
	funcs map[string]func([]float64) float64
}

var binPrec = map[string]int{"+": 1, "-": 1, "*": 2, "/": 2, "^": 4}
var rightAssoc = map[string]bool{"^": true}

type Parser struct {
	toks []Token
	pos  int
	env  *Env
	err  error
}

func (p *Parser) peek() Token {
	if p.pos < len(p.toks) {
		return p.toks[p.pos]
	}
	return Token{kind: "eof"}
}
func (p *Parser) next() Token { t := p.peek(); p.pos++; return t }

func (p *Parser) parseExpr(minPrec int) float64 {
	left := p.parseAtom()
	for {
		t := p.peek()
		prec, ok := binPrec[t.text]
		if t.kind != "op" || !ok || prec < minPrec {
			break
		}
		p.next()
		nextMin := prec + 1
		if rightAssoc[t.text] {
			nextMin = prec
		}
		right := p.parseExpr(nextMin)
		left = apply(t.text, left, right)
	}
	return left
}

func (p *Parser) parseAtom() float64 {
	t := p.next()
	switch {
	case t.kind == "op" && (t.text == "-" || t.text == "+"):
		v := p.parseExpr(3) // unary binds tighter than * /, looser than ^
		if t.text == "-" {
			return -v
		}
		return v
	case t.kind == "num":
		n, _ := strconv.ParseFloat(t.text, 64)
		return n
	case t.kind == "ident":
		if p.peek().kind == "(" { // function call
			p.next()
			var args []float64
			if p.peek().kind != ")" {
				args = append(args, p.parseExpr(1))
				for p.peek().kind == "," {
					p.next()
					args = append(args, p.parseExpr(1))
				}
			}
			p.next() // ")"
			return p.env.funcs[t.text](args)
		}
		return p.env.vars[t.text]
	case t.kind == "(":
		v := p.parseExpr(1)
		p.next() // ")"
		return v
	}
	if p.err == nil {
		p.err = fmt.Errorf("unexpected token %q at col %d", t.text, t.pos)
	}
	return 0
}

func apply(op string, a, b float64) float64 {
	switch op {
	case "+":
		return a + b
	case "-":
		return a - b
	case "*":
		return a * b
	case "/":
		return a / b
	case "^":
		return math.Pow(a, b)
	}
	return 0
}

func lex(s string) []Token {
	var ts []Token
	i := 0
	for i < len(s) {
		c := s[i]
		switch {
		case c == ' ':
			i++
		case c >= '0' && c <= '9' || c == '.':
			j := i
			for j < len(s) && (s[j] >= '0' && s[j] <= '9' || s[j] == '.') {
				j++
			}
			ts = append(ts, Token{"num", s[i:j], i})
			i = j
		case c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z':
			j := i
			for j < len(s) && (s[j] >= 'a' && s[j] <= 'z' || s[j] >= 'A' && s[j] <= 'Z') {
				j++
			}
			ts = append(ts, Token{"ident", s[i:j], i})
			i = j
		case c == '(':
			ts = append(ts, Token{"(", "(", i})
			i++
		case c == ')':
			ts = append(ts, Token{")", ")", i})
			i++
		case c == ',':
			ts = append(ts, Token{",", ",", i})
			i++
		default:
			ts = append(ts, Token{"op", string(c), i})
			i++
		}
	}
	return ts
}

func main() {
	env := &Env{
		vars:  map[string]float64{"x": 3, "pi": math.Pi},
		funcs: map[string]func([]float64) float64{"sqrt": func(a []float64) float64 { return math.Sqrt(a[0]) }},
	}
	p := &Parser{toks: lex("sqrt(x*x + 4*4) + 2^3^2"), env: env}
	fmt.Println(p.parseExpr(1)) // sqrt(25)+512 = 5 + 512 = 517
	if p.err != nil {
		fmt.Println("error:", p.err)
	}
}
```

### 7.2 Java — AST nodes with safe evaluation (no host eval)

```java
import java.util.*;
import java.util.function.Function;

interface Node { double eval(Map<String, Double> env); }

class Num implements Node {
    final double v; Num(double v) { this.v = v; }
    public double eval(Map<String, Double> env) { return v; }
}
class Var implements Node {
    final String name; Var(String n) { this.name = n; }
    public double eval(Map<String, Double> env) {
        Double v = env.get(name);
        if (v == null) throw new RuntimeException("undefined variable: " + name);
        return v;
    }
}
class Bin implements Node {
    final char op; final Node a, b;
    Bin(char op, Node a, Node b) { this.op = op; this.a = a; this.b = b; }
    public double eval(Map<String, Double> env) {
        double x = a.eval(env), y = b.eval(env);
        switch (op) {
            case '+': return x + y;
            case '-': return x - y;
            case '*': return x * y;
            case '/':
                if (y == 0) throw new ArithmeticException("division by zero");
                return x / y;
            case '^': return Math.pow(x, y);
        }
        throw new IllegalStateException("bad op " + op);
    }
}

public class SafeEval {
    // Parsing omitted for brevity; build the AST then:
    public static void main(String[] args) {
        // (x + 2) * 3, with x = 4
        Node ast = new Bin('*', new Bin('+', new Var("x"), new Num(2)), new Num(3));
        Map<String, Double> env = new HashMap<>();
        env.put("x", 4.0);
        System.out.println(ast.eval(env)); // 18.0  — no host eval, fully sandboxed
    }
}
```

### 7.3 Python — caching parsed forms and bounding depth

```python
import functools

MAX_DEPTH = 200  # reject pathologically nested input (DoS guard)


class ParseError(Exception):
    pass


def check_depth(expr):
    depth = best = 0
    for c in expr:
        if c == "(":
            depth += 1
            best = max(best, depth)
        elif c == ")":
            depth -= 1
            if depth < 0:
                raise ParseError("unbalanced ')'")
    if depth != 0:
        raise ParseError("unbalanced '('")
    if best > MAX_DEPTH:
        raise ParseError("expression nesting too deep")


@functools.lru_cache(maxsize=1024)
def parse_cached(expr):
    check_depth(expr)
    # ... tokenize + precedence-climb into an AST (returns a callable) ...
    # Returned object is reusable across evaluations with different envs.
    return compile_to_ast(expr)


def evaluate(expr, env):
    ast = parse_cached(expr)     # parsed once per unique string
    return ast.eval(env)         # cheap re-eval with changing variables
```

---

## 8. Testing Strategy

| Test class | What it catches |
|------------|-----------------|
| Golden expressions vs trusted reference | precedence/associativity transcription bugs (compare only on safe inputs) |
| Property: random valid expressions | `parse(print(ast)) == ast` round-trip; result matches a reference evaluator |
| Associativity pins | `2^3^2 == 512`, `8/4/2 == 1`, `5-2-1 == 2` |
| Unary cases | `-3`, `3*-2`, `--5`, `-(2+1)` |
| Error cases | each row of the Section 4.2 table produces the right error *class* and position |
| Fuzzing | random/garbage strings never crash, never hang, never `panic`/`exception` outside the error channel |
| Security | injection attempts (`__import__`, backticks, `;`) are tokenizer/parser errors, never executed |
| Depth/limits | deeply nested and huge inputs are rejected within bounds |

The most valuable senior tests are the **fuzz + security** pair: throw millions of random and adversarial strings and assert the evaluator only ever returns a number or a typed error — never a crash, hang, or side effect.

---

## 9. Failure Modes

### 9.1 Host `eval` injection
Passing user input to `eval`/`Function`/`exec` turns a calculator into RCE. Mitigation: implement the evaluator; never touch host eval.

### 9.2 Stack overflow on deep nesting
Recursive descent on `((((…))))` blows the call stack. Mitigation: depth limit + clean error, or an explicit-stack (iterative) parser.

### 9.3 Unbounded computation
`9^9^9` or a recursive user function can hang or overflow. Mitigation: cap magnitudes, exponents, argument counts, and total work; reject early.

### 9.4 Silent associativity bug
`^` implemented left-associative ships and quietly returns `64` for `2^3^2`. Mitigation: associativity pin tests in CI.

### 9.5 Lost error positions
Tokens-as-strings can't report where a fault is, so users get "syntax error" with no location. Mitigation: carry source offsets on every token.

### 9.6 Re-parsing per evaluation
A formula re-tokenized and re-parsed on every row/data point dominates runtime. Mitigation: cache the parsed AST/RPN keyed by the formula string.

### 9.7 Unary/binary minus mis-detection
Treating every `-` as binary breaks `-3` and `3*-2`; treating every `-` as unary breaks `3-2`. Mitigation: decide by context (start / after operator / after `(`) and test both.

### 9.8 Floating-point surprises
`0.1 + 0.2 != 0.3`, and integer-vs-float division policy leaks bugs. Mitigation: document numeric type and division semantics; use decimals where exactness matters (money).

---

## 10. Summary

- **Pratt parsing / precedence climbing** keep recursive descent's clarity while making precedence and associativity **data-driven**: `parseExpr(minPrec)` with `prec+1` (left-assoc) or `prec` (right-assoc) on the recursive call replaces the whole rule chain and the `>=`-vs-`>` subtlety. Shunting-yard, precedence climbing, and Pratt all compute the same parse.
- **Extensibility** lives in registries: variables resolved against an environment at eval time, functions in a function table, operators as binding-power entries. Parse once, evaluate many.
- **Error reporting** depends on carrying source positions on tokens and classifying lex/parse/eval failures; recovery (panic-mode, repair) lets editors report several errors per parse.
- **Security** is the headline senior concern: never host-`eval` untrusted input; your evaluator is a **capability sandbox** that can only do arithmetic over a whitelisted vocabulary. Bound length, depth, recursion, and magnitudes against DoS.
- **Performance** comes from parse-once caching, flattening to RPN/bytecode or compiled closures, constant folding, and avoiding per-token allocation.
- **Testing** leans on a trusted reference oracle, associativity/unary pins, the full error-class table, and especially **fuzzing + security** assertions that the engine only ever yields a number or a typed error.

### Decision summary

- **Few operators, pure arithmetic, one-shot** → Shunting-yard or the two-stack evaluator: iterative, compact, no recursion limit.
- **Need an AST / variables / reuse** → recursive descent building a tree, evaluated against an environment.
- **Many operators / configurable precedence** → Pratt / precedence climbing with a binding-power table.
- **Untrusted input** → never host-`eval`; hand-written evaluator as a capability sandbox, with length/depth/magnitude caps.
- **Hot path, repeated evaluation** → parse once, cache by formula string, constant-fold, and flatten to RPN/bytecode only if profiling proves the AST walk dominates.

References: Vaughan Pratt, "Top Down Operator Precedence" (1973); Theodore Norvell's precedence-climbing notes; the Dragon Book on lexing/parsing/error recovery; OWASP guidance on avoiding `eval` and building expression sandboxes; sibling files `middle.md` (recursive descent, AST) and `professional.md` (grammar formalization and LL(1) analysis).
