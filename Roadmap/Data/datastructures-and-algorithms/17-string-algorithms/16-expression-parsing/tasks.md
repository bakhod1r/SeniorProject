# Expression Parsing & Evaluation — Practice Tasks

> All tasks must be solved in Go, Java, and Python.
> Each task ships with a precise spec and starter code in all three languages.
> **Always test against a trusted reference (your language's own arithmetic, on small *safe* inputs) before trusting your evaluator. Never run host `eval` on untrusted input.**

---

## Beginner Tasks (5)

### Task 1 — Tokenize an arithmetic string

**Problem.** Implement `tokenize(s)` that turns an expression string into a list of tokens: multi-digit integers grouped as one token, single-char operators `+ - * / ^`, and parentheses `( )`. Skip whitespace. Reject any other character with an error.

**Input / Output spec.**
- Input: a string, e.g. `"12 + 3*45"`.
- Output: a list of token strings, e.g. `["12","+","3","*","45"]`.

**Constraints.**
- `0 ≤ len(s) ≤ 10^4`. Only digits, `+ - * / ^ ( )`, and spaces are legal.

**Hint.** Walk an index `i`; on a digit, advance while the next char is a digit and slice out the whole number.

**Starter — Go.**
```go
func tokenize(s string) []string {
	// TODO: group digit runs; emit single-char operators/parens; skip spaces
	return nil
}
```

**Starter — Java.**
```java
static java.util.List<String> tokenize(String s) {
    // TODO
    return new java.util.ArrayList<>();
}
```

**Starter — Python.**
```python
def tokenize(s):
    # TODO: group digit runs; emit single-char operators/parens; skip spaces
    return []
```

---

### Task 2 — Evaluate RPN (postfix)

**Problem.** Given a list of RPN tokens, evaluate it with a value stack. Operators `+ - * /`; integer division truncates toward zero.

**Input / Output spec.**
- Input: `["2","1","+","3","*"]`. Output: `9`.

**Constraints.**
- Valid RPN; `1 ≤ #tokens ≤ 10^4`. Result fits in 64-bit.

**Hint.** The **second** pop is the left operand: compute `a OP b`, not `b OP a`.

**Starter — Go.**
```go
func evalRPN(tokens []string) int {
	// TODO: push numbers; on operator pop b then a, push a OP b
	return 0
}
```

**Starter — Java.**
```java
static int evalRPN(String[] tokens) {
    // TODO
    return 0;
}
```

**Starter — Python.**
```python
def eval_rpn(tokens):
    # TODO
    return 0
```

---

### Task 3 — Validate parentheses

**Problem.** Given an expression string, return whether its parentheses are balanced and properly nested (ignore everything except `(` and `)`).

**Input / Output spec.**
- `"(1+(2*3))"` → `true`; `"(1+2))"` → `false`; `"((1)"` → `false`.

**Constraints.**
- `0 ≤ len(s) ≤ 10^4`.

**Hint.** Counter starting at 0: `+1` on `(`, `-1` on `)`; fail if it ever goes negative; succeed iff it ends at 0.

**Starter — Go.**
```go
func balanced(s string) bool {
	// TODO: running depth counter
	return false
}
```

**Starter — Java.**
```java
static boolean balanced(String s) {
    // TODO
    return false;
}
```

**Starter — Python.**
```python
def balanced(s):
    # TODO
    return False
```

---

### Task 4 — Two-number, two-operator precedence

**Problem.** Evaluate expressions of the exact form `a OP1 b OP2 c` (three single-digit numbers, two operators from `+ - * /`), respecting precedence (`*`/`/` before `+`/`-`). No parentheses.

**Input / Output spec.**
- `"2+3*4"` → `14`; `"2*3+4"` → `10`; `"8-4/2"` → `6`.

**Constraints.**
- Always exactly three operands and two operators. Integer arithmetic.

**Hint.** If `OP1` is `+`/`-` and `OP2` is `*`/`/`, compute `b OP2 c` first; otherwise left to right.

**Starter — Go.**
```go
func evalThree(s string) int {
	// TODO: parse a,op1,b,op2,c; apply precedence
	return 0
}
```

**Starter — Java.**
```java
static int evalThree(String s) {
    // TODO
    return 0;
}
```

**Starter — Python.**
```python
def eval_three(s):
    # TODO
    return 0
```

---

### Task 5 — Precedence lookup table

**Problem.** Implement `prec(op)` returning the precedence of `+ - * / ^` (`+ -`→1, `* /`→2, `^`→4) and `isRightAssoc(op)` returning true only for `^`. These power every later task.

**Input / Output spec.**
- `prec("*")` → `2`; `prec("^")` → `4`; `isRightAssoc("^")` → `true`; `isRightAssoc("+")` → `false`.

**Constraints.**
- Operators limited to the five above; return `0` / `false` for anything else.

**Hint.** Use a map/switch; keep it as the single source of truth for precedence.

**Starter — Go.**
```go
func prec(op string) int       { /* TODO */ return 0 }
func isRightAssoc(op string) bool { /* TODO */ return false }
```

**Starter — Java.**
```java
static int prec(String op) { /* TODO */ return 0; }
static boolean isRightAssoc(String op) { /* TODO */ return false; }
```

**Starter — Python.**
```python
def prec(op):
    # TODO
    return 0

def is_right_assoc(op):
    # TODO
    return False
```

---

## Intermediate Tasks (5)

### Task 6 — Infix → Postfix with Shunting-yard

**Problem.** Convert an infix expression (multi-digit numbers, `+ - * / ^`, parentheses) to a space-separated postfix string. `^` is right-associative; all others left-associative.

**Input / Output spec.**
- `"3 + 4 * 2"` → `"3 4 2 * +"`; `"2 ^ 3 ^ 2"` → `"2 3 2 ^ ^"`; `"( 1 + 2 ) * 3"` → `"1 2 + 3 *"`.

**Constraints.**
- Valid expressions; `#tokens ≤ 10^4`.

**Hint.** Pop while `prec(top) > prec(o)` or (`prec(top) == prec(o)` and `o` is left-associative). `(` is a barrier.

**Starter — Go.**
```go
func toPostfix(tokens []string) []string {
	// TODO: Shunting-yard; use prec + isRightAssoc from Task 5
	return nil
}
```

**Starter — Java.**
```java
static java.util.List<String> toPostfix(java.util.List<String> tokens) {
    // TODO
    return new java.util.ArrayList<>();
}
```

**Starter — Python.**
```python
def to_postfix(tokens):
    # TODO
    return []
```

---

### Task 7 — Two-stack infix evaluator with parentheses

**Problem.** Evaluate an infix string with non-negative integers, `+ - * /`, parentheses, and spaces using the **direct two-stack** method (no postfix intermediate). Integer division truncates toward zero.

**Input / Output spec.**
- `"2*(3+4)-5"` → `9`; `"10 + 2 * 6"` → `22`.

**Constraints.**
- `#tokens ≤ 10^4`; result fits in 64-bit.

**Hint.** `applyTop()` pops one operator and two values, pushes `a OP b`. On `)`, apply until `(`.

**Starter — Go.**
```go
func calculate(s string) int {
	// TODO: values stack + operators stack
	return 0
}
```

**Starter — Java.**
```java
static int calculate(String s) {
    // TODO
    return 0;
}
```

**Starter — Python.**
```python
def calculate(s):
    # TODO
    return 0
```

---

### Task 8 — Recursive-descent calculator (float)

**Problem.** Implement a recursive-descent evaluator for `expr → term {(+|-) term}`, `term → factor {(*|/) factor}`, `factor → NUMBER | (expr) | -factor`. Return a double. Support unary minus and multi-digit/decimal numbers.

**Input / Output spec.**
- `"-3 + 4 * 2"` → `5`; `"(1+2)*3-4"` → `5`; `"10/(2+3)"` → `2`.

**Constraints.**
- Well-formed input. Floating-point result.

**Hint.** One function per grammar rule; `factor` handles unary `-`, parentheses, and numbers.

**Starter — Go.**
```go
type Parser struct{ toks []string; pos int }
func (p *Parser) expr() float64   { /* TODO */ return 0 }
func (p *Parser) term() float64   { /* TODO */ return 0 }
func (p *Parser) factor() float64 { /* TODO */ return 0 }
```

**Starter — Java.**
```java
class Parser {
    java.util.List<String> toks; int pos;
    double expr()   { /* TODO */ return 0; }
    double term()   { /* TODO */ return 0; }
    double factor() { /* TODO */ return 0; }
}
```

**Starter — Python.**
```python
class Parser:
    def __init__(self, toks): self.toks, self.pos = toks, 0
    def expr(self):   ...   # TODO
    def term(self):   ...   # TODO
    def factor(self): ...   # TODO
```

---

### Task 9 — Right-associative exponent

**Problem.** Extend the recursive-descent evaluator (or Shunting-yard) to support `^` as a **right-associative** operator with the highest precedence. Verify `2^3^2 == 512` (not 64) and `2^2^3 == 256`.

**Input / Output spec.**
- `"2^3^2"` → `512`; `"2^2^3"` → `256`; `"(2^3)^2"` → `64`.

**Constraints.**
- Non-negative integer or float bases/exponents.

**Hint.** Grammar: `power → unary ["^" power]` (recurse on the right). In Shunting-yard use strict `>` for `^`.

**Starter — Go.**
```go
func (p *Parser) power() float64 {
	// TODO: v = unary(); if next is '^' return pow(v, power())
	return 0
}
```

**Starter — Java.**
```java
double power() {
    // TODO
    return 0;
}
```

**Starter — Python.**
```python
def power(self):
    # TODO: right recursion for '^'
    return 0
```

---

### Task 10 — Build and evaluate an AST

**Problem.** Have the parser build an AST (`Num` leaves, `BinOp` internal nodes) instead of returning a value, then evaluate the tree with a post-order walk. Support `+ - * /`, parentheses, and unary minus.

**Input / Output spec.**
- Parse `"(1+2)*3-4"` to a tree, then `eval(tree)` → `5`. `printPostfix(tree)` → `"1 2 + 3 * 4 -"`.

**Constraints.**
- Well-formed input. The tree must be reusable (evaluate twice → same result).

**Hint.** Node interface with `eval()`; `BinOp.eval` recurses into children then combines.

**Starter — Go.**
```go
type Node interface{ Eval() float64 }
type Num struct{ V float64 }
type BinOp struct{ Op byte; A, B Node }
func (n Num) Eval() float64   { return n.V }
func (b BinOp) Eval() float64 { /* TODO */ return 0 }
```

**Starter — Java.**
```java
interface Node { double eval(); }
class Num implements Node { double v; Num(double v){this.v=v;} public double eval(){return v;} }
class BinOp implements Node {
    char op; Node a, b;
    BinOp(char op, Node a, Node b){this.op=op;this.a=a;this.b=b;}
    public double eval() { /* TODO */ return 0; }
}
```

**Starter — Python.**
```python
class Num:
    def __init__(self, v): self.v = v
    def eval(self): return self.v

class BinOp:
    def __init__(self, op, a, b): self.op, self.a, self.b = op, a, b
    def eval(self):
        # TODO
        return 0
```

---

## Advanced Tasks (5)

### Task 11 — Variables and functions

**Problem.** Extend the evaluator to support named variables (resolved against an environment map at eval time) and single/multi-argument functions (`sqrt`, `min`, `max`) from a registry. Error on undefined names and arity mismatch.

**Input / Output spec.**
- env `{x:3}`: `"x*x + 1"` → `10`; `"sqrt(16) + max(2, 5)"` → `9`; `"y"` (undefined) → error.

**Constraints.**
- Identifiers are letters; functions take 1–2 args. Parse once, evaluate against different envs.

**Hint.** In `primary`, if an identifier is followed by `(`, parse a comma-separated arg list and call the registered function; otherwise look up the variable.

**Starter — Go.**
```go
type Env struct {
	Vars  map[string]float64
	Funcs map[string]func([]float64) float64
}
// extend primary(): identifier -> var lookup or function call
```

**Starter — Java.**
```java
class Env {
    java.util.Map<String, Double> vars = new java.util.HashMap<>();
    java.util.Map<String, java.util.function.Function<double[], Double>> funcs = new java.util.HashMap<>();
}
// extend primary()
```

**Starter — Python.**
```python
class Env:
    def __init__(self, vars=None, funcs=None):
        self.vars = vars or {}
        self.funcs = funcs or {}
# extend primary(): handle IDENT and IDENT "(" args ")"
```

---

### Task 12 — Full error reporting with positions

**Problem.** Make the parser report precise errors: mismatched parentheses, unexpected token, missing operand, and trailing input — each with a character position. Tokens must carry their source offset.

**Input / Output spec.**
- `"(1+2"` → error "missing ')' to match '(' at col 0".
- `"1 + * 2"` → error "expected operand at col 4".
- `"1 2"` → error "unexpected token '2' at col 2".

**Constraints.**
- Return a typed error/exception with a message and position; do not crash.

**Hint.** A token is `{kind, text, pos}`. In `primary`, when no operand is found, raise with `peek().pos`. After top-level `expr`, assert all tokens consumed.

**Starter — Go.**
```go
type Token struct{ Kind, Text string; Pos int }
type ParseError struct{ Msg string; Pos int }
func (e *ParseError) Error() string { return fmt.Sprintf("%s at col %d", e.Msg, e.Pos) }
// thread ParseError through the parser
```

**Starter — Java.**
```java
class Token { String kind, text; int pos; }
class ParseException extends RuntimeException {
    int pos;
    ParseException(String m, int pos){ super(m + " at col " + pos); this.pos = pos; }
}
```

**Starter — Python.**
```python
class Token:
    def __init__(self, kind, text, pos): self.kind, self.text, self.pos = kind, text, pos

class ParseError(Exception):
    def __init__(self, msg, pos): super().__init__(f"{msg} at col {pos}"); self.pos = pos
```

---

### Task 13 — Pratt / precedence-climbing parser

**Problem.** Implement a single `parseExpr(minPrec)` precedence-climbing parser that handles `+ - * / ^` with correct precedence and associativity (left for `+ - * /`, right for `^`) plus unary minus and parentheses, driven by a binding-power table.

**Input / Output spec.**
- `"2 + 3 * 4 - 1"` → `13`; `"2 ^ 3 ^ 2"` → `512`; `"-2 ^ 2"` → depends on chosen unary precedence (document it).

**Constraints.**
- Adding a new operator must be a table edit, not a structural change.

**Hint.** Loop while `prec(next) >= minPrec`; recurse with `prec+1` (left-assoc) or `prec` (right-assoc). Atom parses numbers, unary `-`, and `(expr)`.

**Starter — Go.**
```go
var binPrec = map[string]int{"+": 1, "-": 1, "*": 2, "/": 2, "^": 4}
var rightAssoc = map[string]bool{"^": true}
func (p *Parser) parseExpr(minPrec int) float64 {
	// TODO: precedence climbing
	return 0
}
```

**Starter — Java.**
```java
static final java.util.Map<String,Integer> BIN_PREC = java.util.Map.of("+",1,"-",1,"*",2,"/",2,"^",4);
double parseExpr(int minPrec) {
    // TODO
    return 0;
}
```

**Starter — Python.**
```python
BIN_PREC = {"+": 1, "-": 1, "*": 2, "/": 2, "^": 4}
RIGHT_ASSOC = {"^"}
def parse_expr(self, min_prec):
    # TODO
    return 0
```

---

### Task 14 — Safe evaluator with resource limits

**Problem.** Harden the evaluator against malicious input: reject expressions over a length cap, over a nesting-depth cap, and reject huge exponents (e.g. `9^9^9`). Ensure no host `eval` is used and the evaluator only ever returns a number or a typed error — never crashes or hangs.

**Input / Output spec.**
- `"(((((((((((1)))))))))))"` with depth cap 8 → error "nesting too deep".
- `"9^9^9"` with exponent cap → error "exponent too large".
- A 10^6-char string → error "expression too long".

**Constraints.**
- Constant-bounded memory/time per evaluation. Pure functions only in the registry.

**Hint.** Pre-scan for length and paren depth before parsing; clamp/validate exponent operands at the `^` node; convert deep recursion to an explicit stack or enforce a depth counter.

**Starter — Go.**
```go
const (MaxLen = 10000; MaxDepth = 64; MaxExp = 1000)
func safeEval(s string) (float64, error) {
	// TODO: validate length, depth, exponent; then parse+eval
	return 0, nil
}
```

**Starter — Java.**
```java
static final int MAX_LEN = 10000, MAX_DEPTH = 64, MAX_EXP = 1000;
static double safeEval(String s) {
    // TODO: validate then evaluate; throw typed errors
    return 0;
}
```

**Starter — Python.**
```python
MAX_LEN, MAX_DEPTH, MAX_EXP = 10000, 64, 1000
def safe_eval(s):
    # TODO: validate length, depth, exponent; then parse+eval
    return 0.0
```

---

### Task 15 — Parse-once, evaluate-many with caching

**Problem.** Build a small formula engine: `compile(formula)` returns a reusable object that, given an environment of variable values, evaluates fast. Cache compiled forms by formula string. Demonstrate evaluating one formula against 100k different variable bindings without re-parsing.

**Input / Output spec.**
- `f = compile("a*a + b*b")`; `f.eval({a:3,b:4})` → `25`; `f.eval({a:5,b:12})` → `169`.
- Compiling the same string twice returns the cached compiled form.

**Constraints.**
- Compilation parses to AST or RPN once; evaluation does no tokenizing/parsing.

**Hint.** `compile` → AST; `eval(env)` → post-order walk resolving variables. Wrap `compile` in an LRU/dict cache keyed by the formula string.

**Starter — Go.**
```go
type Compiled struct{ root Node }
var cache = map[string]*Compiled{}
func compile(formula string) *Compiled {
	// TODO: parse to AST once, memoize in cache
	return nil
}
func (c *Compiled) Eval(env map[string]float64) float64 { /* TODO */ return 0 }
```

**Starter — Java.**
```java
class Compiled {
    Node root;
    static final java.util.Map<String, Compiled> CACHE = new java.util.HashMap<>();
    static Compiled compile(String formula) { /* TODO */ return null; }
    double eval(java.util.Map<String, Double> env) { /* TODO */ return 0; }
}
```

**Starter — Python.**
```python
import functools

@functools.lru_cache(maxsize=1024)
def compile_formula(formula):
    # TODO: parse to AST once; return reusable object
    ...

def evaluate(formula, env):
    return compile_formula(formula).eval(env)
```

---

## Evaluation Criteria

- **Correctness:** results match a trusted reference on small safe inputs; precedence, associativity, parentheses, and unary minus all correct.
- **Associativity pins:** `8/4/2 == 1`, `5-2-1 == 2`, `2^3^2 == 512` (advanced).
- **Robustness:** malformed input yields a clear, positioned error — never a crash, hang, or host `eval`.
- **Linearity:** the pipeline is `O(n)` in token count; repeated evaluation reuses the parsed form.
- **Three languages:** each task implemented and tested in Go, Java, and Python.
